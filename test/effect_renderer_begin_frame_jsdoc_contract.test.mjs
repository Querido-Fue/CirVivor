import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadGameModule } from './support/source_module_loader.mjs';

const EFFECT_RENDERER_SOURCE_PATH = fileURLToPath(new URL(
    '../project/game/script/module/display/webgl/_effect_renderer.js',
    import.meta.url
));
const effectRendererSource = await readFile(EFFECT_RENDERER_SOURCE_PATH, 'utf8');
const { EffectRenderer } = await loadGameModule('display/webgl/_effect_renderer.js');
const EXECUTABLE_SOURCE_HASH = '3061368b977709677eee734e14c12470c89cd325c3c658d9ec7d712c8076e439';

/**
 * JSDoc을 제거한 production 실행 소스의 안정적인 해시를 계산합니다.
 * @param {string} productionSource - production 소스입니다.
 * @returns {string} SHA-256 해시입니다.
 */
function hashExecutableSource(productionSource) {
    const allJsDocStarts = productionSource.match(/\/\*\*/g) ?? [];
    const standaloneJsDocStarts = productionSource.match(/^[ \t]*\/\*\*/gm) ?? [];
    assert.equal(
        standaloneJsDocStarts.length,
        allJsDocStarts.length,
        '해시 제거 대상이 아닌 문자열·인라인 JSDoc 표식이 있습니다.'
    );
    assert.equal(standaloneJsDocStarts.length, 9, 'production standalone JSDoc 개수가 바뀌었습니다.');
    const executableSource = productionSource
        .replace(/\/\*\*[\s\S]*?\*\//g, '')
        .replace(/\r\n/g, '\n');
    return createHash('sha256').update(executableSource).digest('hex');
}

/**
 * 특정 선언 바로 앞의 JSDoc 본문을 찾습니다.
 * @param {string} productionSource - 검색할 production 소스입니다.
 * @param {string} escapedDeclaration - 정규식용 선언 패턴입니다.
 * @returns {string} JSDoc 본문입니다.
 */
function findLeadingJsDoc(productionSource, escapedDeclaration) {
    const match = productionSource.match(
        new RegExp(`/\\*\\*((?:(?!\\*/)[\\s\\S])*)\\*/\\s*${escapedDeclaration}`)
    );
    assert.ok(match, `${escapedDeclaration} 선언 앞 JSDoc을 찾을 수 없습니다.`);
    return match[1];
}

/**
 * constructor의 GL 초기화를 우회하고 actual prototype method만 사용하는 receiver를 생성합니다.
 * @param {object} gl - 사용할 GL-like 객체입니다.
 * @param {Array<*>} [commands=[]] - 초기 명령 queue입니다.
 * @returns {EffectRenderer} 최소 receiver입니다.
 */
function createBareRenderer(gl, commands = []) {
    const renderer = Object.create(EffectRenderer.prototype);
    renderer.gl = gl;
    renderer.width = 0;
    renderer.height = 0;
    renderer.commands = commands;
    return renderer;
}

/**
 * 동기 호출에서 던져진 값을 반환합니다.
 * @param {Function} action - 실행할 동기 함수입니다.
 * @returns {*} 던져진 값입니다.
 */
function captureThrown(action) {
    let didThrow = false;
    let thrownValue;
    try {
        action();
    } catch (error) {
        didThrow = true;
        thrownValue = error;
    }
    assert.equal(didThrow, true, '동기 예외가 발생해야 합니다.');
    return thrownValue;
}

test('EffectRenderer executable source remains unchanged while beginFrame JSDoc is corrected', () => {
    assert.equal(hashExecutableSource(effectRendererSource), EXECUTABLE_SOURCE_HASH);
});

test('beginFrame JSDoc describes its live ordered GL setup, clear, partial-state, and return contracts', () => {
    const jsDoc = findLeadingJsDoc(effectRendererSource, 'beginFrame\\(width, height\\)');

    assert.match(jsDoc, /live `resize`를 현재 receiver와 원본 width·height 인수로 호출/u);
    assert.match(jsDoc, /반환값과 thenable은 관찰하지 않습니다/u);
    assert.match(jsDoc, /`drawingBufferWidth \|\| current width`/u);
    assert.match(jsDoc, /`drawingBufferHeight \|\| current height`/u);
    assert.match(jsDoc, /width를 먼저 정규화해 대입한 뒤 height를 처리/u);
    assert.match(jsDoc, /live `gl`에서 `bindFramebuffer`와 `FRAMEBUFFER`를 각각 조회/u);
    assert.match(jsDoc, /그 뒤 live `gl\.viewport\(0, 0, current width, current height\)`/u);
    assert.match(jsDoc, /마지막 current `commands\.length = 0`/u);
    assert.match(jsDoc, /frame serial을 직접 읽거나 갱신하지 않/u);
    assert.match(jsDoc, /재진입 guard(?:가|는) 없습니다/u);
    assert.match(jsDoc, /예외는 그대로 동기 전파/u);
    assert.match(jsDoc, /완료된 대입·GL 호출·queue 축소를 rollback하지/u);
    assert.match(jsDoc, /부분 length 상태/u);
    assert.match(jsDoc, /@param \{\*\} width/u);
    assert.match(jsDoc, /@param \{\*\} height/u);
    assert.match(jsDoc, /@returns \{undefined\}/u);
    assert.match(jsDoc, /최종 current queue의 `length = 0` 대입까지 정상 완료/u);
    assert.doesNotMatch(jsDoc, /프레임 시작 시 큐를 초기화합니다/u);
});

test('actual beginFrame follows the exact live access, assignment, GL call, and clear order', () => {
    const trace = [];
    const framebufferToken = Object.freeze({ kind: 'framebuffer target' });
    const widthArg = Object.freeze({ axis: 'width' });
    const heightArg = Object.freeze({ axis: 'height' });
    const commandBacking = [{ id: 1 }, { id: 2 }];
    Object.defineProperty(commandBacking, '0', {
        configurable: true,
        enumerable: true,
        get() {
            throw new Error('beginFrame must not read command entries');
        }
    });
    const commands = new Proxy(commandBacking, {
        set(target, property, value) {
            trace.push(`commands:set:${String(property)}:${String(value)}`);
            return Reflect.set(target, property, value, target);
        }
    });
    let gl;
    gl = new Proxy({
        drawingBufferWidth: 0,
        drawingBufferHeight: 23.9,
        FRAMEBUFFER: framebufferToken,
        bindFramebuffer(target, framebuffer) {
            assert.strictEqual(this, gl);
            assert.strictEqual(target, framebufferToken);
            assert.strictEqual(framebuffer, null);
            trace.push('gl:bindFramebuffer:call');
        },
        viewport(x, y, width, height) {
            assert.strictEqual(this, gl);
            assert.deepEqual([x, y, width, height], [0, 0, 11, 23]);
            trace.push('gl:viewport:call');
        },
        get clear() {
            throw new Error('EffectRenderer.beginFrame must not read gl.clear');
        }
    }, {
        get(target, property, receiver) {
            trace.push(`gl:get:${String(property)}`);
            return Reflect.get(target, property, receiver);
        }
    });

    const target = {
        width: 91,
        height: 92,
        gl,
        commands,
        resize(width, height) {
            assert.strictEqual(this, renderer);
            assert.strictEqual(width, widthArg);
            assert.strictEqual(height, heightArg);
            trace.push('resize:call');
            target.width = 11.9;
            target.height = 12.9;
        }
    };
    Object.defineProperty(target, 'frameSerial', {
        get() {
            throw new Error('EffectRenderer.beginFrame must not read frameSerial');
        },
        set() {
            throw new Error('EffectRenderer.beginFrame must not write frameSerial');
        }
    });
    Object.defineProperty(target, 'effectPasses', {
        get() {
            throw new Error('EffectRenderer.beginFrame must not read effectPasses');
        }
    });
    let renderer;
    renderer = new Proxy(target, {
        get(targetObject, property, receiver) {
            trace.push(`receiver:get:${String(property)}`);
            return Reflect.get(targetObject, property, receiver);
        },
        set(targetObject, property, value, setReceiver) {
            assert.strictEqual(setReceiver, renderer);
            trace.push(`receiver:set:${String(property)}:${String(value)}`);
            targetObject[property] = value;
            return true;
        }
    });

    assert.equal(
        Reflect.apply(EffectRenderer.prototype.beginFrame, renderer, [widthArg, heightArg]),
        undefined
    );
    assert.equal(target.width, 11);
    assert.equal(target.height, 23);
    assert.equal(commandBacking.length, 0);
    assert.deepEqual(trace, [
        'receiver:get:resize',
        'resize:call',
        'receiver:get:gl',
        'gl:get:drawingBufferWidth',
        'receiver:get:width',
        'receiver:set:width:11',
        'receiver:get:gl',
        'gl:get:drawingBufferHeight',
        'receiver:set:height:23',
        'receiver:get:gl',
        'gl:get:bindFramebuffer',
        'receiver:get:gl',
        'gl:get:FRAMEBUFFER',
        'gl:bindFramebuffer:call',
        'receiver:get:gl',
        'gl:get:viewport',
        'receiver:get:width',
        'receiver:get:height',
        'gl:viewport:call',
        'receiver:get:commands',
        'commands:set:length:0'
    ]);
});

test('drawing-buffer dimensions use logical-OR truthiness before the shared normalizer', () => {
    const falsyValues = [false, 0, -0, '', null, undefined, Number.NaN];
    for (const drawingBufferWidth of falsyValues) {
        const gl = {
            drawingBufferWidth,
            drawingBufferHeight: drawingBufferWidth,
            FRAMEBUFFER: 0x8D40,
            bindFramebuffer() {},
            viewport() {}
        };
        const renderer = createBareRenderer(gl);
        assert.equal(renderer.beginFrame(7.9, 8.9), undefined);
        assert.equal(renderer.width, 7, `width fallback for ${String(drawingBufferWidth)}`);
        assert.equal(renderer.height, 8, `height fallback for ${String(drawingBufferWidth)}`);
    }

    const coercionTrace = [];
    const truthyWidth = {
        [Symbol.toPrimitive](hint) {
            coercionTrace.push(`width:${hint}`);
            return '9.9';
        }
    };
    const truthyHeight = {
        valueOf() {
            coercionTrace.push('height:valueOf');
            return -2.5;
        }
    };
    const renderer = createBareRenderer({
        drawingBufferWidth: truthyWidth,
        drawingBufferHeight: truthyHeight,
        FRAMEBUFFER: 0x8D40,
        bindFramebuffer() {},
        viewport() {}
    });
    assert.equal(renderer.beginFrame(70, 80), undefined);
    assert.equal(renderer.width, 9);
    assert.equal(renderer.height, 1);
    assert.deepEqual(coercionTrace, ['width:number', 'height:valueOf']);
});

test('drawing-buffer truthiness and ToNumber failures preserve the exact axis prefix state', () => {
    {
        const renderer = createBareRenderer({
            drawingBufferWidth: 0n,
            drawingBufferHeight: 0n,
            FRAMEBUFFER: 0x8D40,
            bindFramebuffer() {},
            viewport() {}
        });
        assert.equal(renderer.beginFrame(7.9, 8.9), undefined);
        assert.equal(renderer.width, 7);
        assert.equal(renderer.height, 8);
    }

    const widthError = Object.freeze({ stage: 'width ToPrimitive' });
    const widthFailures = [
        Symbol('width'),
        1n,
        {
            [Symbol.toPrimitive]() {
                throw widthError;
            }
        }
    ];
    for (const invalidWidth of widthFailures) {
        let heightReads = 0;
        const queue = [{ id: 1 }];
        const gl = {
            drawingBufferWidth: invalidWidth,
            get drawingBufferHeight() {
                heightReads += 1;
                return 9;
            }
        };
        const renderer = createBareRenderer(gl, queue);
        const thrown = captureThrown(() => renderer.beginFrame(3.9, 4.9));
        if (typeof invalidWidth === 'object') {
            assert.strictEqual(thrown, widthError);
        } else {
            assert.equal(thrown?.name, 'TypeError');
        }
        assert.equal(renderer.width, 3);
        assert.equal(renderer.height, 4);
        assert.equal(heightReads, 0);
        assert.equal(queue.length, 1);
    }

    const heightError = Object.freeze({ stage: 'height ToPrimitive' });
    const heightFailures = [
        Symbol('height'),
        1n,
        {
            [Symbol.toPrimitive]() {
                throw heightError;
            }
        }
    ];
    for (const invalidHeight of heightFailures) {
        let bindReads = 0;
        const queue = [{ id: 1 }];
        const gl = {
            drawingBufferWidth: 8.9,
            drawingBufferHeight: invalidHeight,
            get bindFramebuffer() {
                bindReads += 1;
                return () => {};
            }
        };
        const renderer = createBareRenderer(gl, queue);
        const thrown = captureThrown(() => renderer.beginFrame(3.9, 4.9));
        if (typeof invalidHeight === 'object') {
            assert.strictEqual(thrown, heightError);
        } else {
            assert.equal(thrown?.name, 'TypeError');
        }
        assert.equal(renderer.width, 8);
        assert.equal(renderer.height, 4);
        assert.equal(bindReads, 0);
        assert.equal(queue.length, 1);
    }
});

test('every syntactic gl read stays live and GL methods keep their own base receiver', () => {
    const trace = [];
    const framebufferToken = Object.freeze({ kind: 'live FRAMEBUFFER' });
    const widthGl = { drawingBufferWidth: 41.9 };
    const heightGl = { drawingBufferHeight: 42.9 };
    const bindGl = {
        bindFramebuffer(target, framebuffer) {
            assert.strictEqual(this, bindGl);
            assert.strictEqual(target, framebufferToken);
            assert.strictEqual(framebuffer, null);
            trace.push('bind:call');
        }
    };
    const framebufferGl = { FRAMEBUFFER: framebufferToken };
    const viewportGl = {
        viewport(x, y, width, height) {
            assert.strictEqual(this, viewportGl);
            assert.deepEqual([x, y, width, height], [0, 0, 41, 42]);
            trace.push('viewport:call');
        }
    };
    const glSequence = [widthGl, heightGl, bindGl, framebufferGl, viewportGl];
    let glReadIndex = 0;
    const renderer = Object.create(EffectRenderer.prototype);
    renderer.width = 0;
    renderer.height = 0;
    renderer.commands = [{ id: 1 }];
    Object.defineProperty(renderer, 'gl', {
        get() {
            trace.push(`renderer:gl:${glReadIndex}`);
            return glSequence[glReadIndex++];
        }
    });

    assert.equal(renderer.beginFrame(5.9, 6.9), undefined);
    assert.equal(glReadIndex, 5);
    assert.equal(renderer.width, 41);
    assert.equal(renderer.height, 42);
    assert.equal(renderer.commands.length, 0);
    assert.deepEqual(trace, [
        'renderer:gl:0',
        'renderer:gl:1',
        'renderer:gl:2',
        'renderer:gl:3',
        'bind:call',
        'renderer:gl:4',
        'viewport:call'
    ]);
});

test('resize and GL return values including thenables are never observed', () => {
    let thenReads = 0;
    const ignoredThenable = {};
    Object.defineProperty(ignoredThenable, 'then', {
        get() {
            thenReads += 1;
            throw new Error('then must not be observed');
        }
    });
    const calls = [];
    const renderer = createBareRenderer({
        drawingBufferWidth: 0,
        drawingBufferHeight: 0,
        FRAMEBUFFER: 0x8D40,
        bindFramebuffer() {
            calls.push('bind');
            return ignoredThenable;
        },
        viewport() {
            calls.push('viewport');
            return ignoredThenable;
        }
    }, [{ id: 1 }]);
    renderer.resize = function resize(width, height) {
        assert.strictEqual(this, renderer);
        assert.equal(width, 13.9);
        assert.equal(height, 14.9);
        calls.push('resize');
        this.width = 13;
        this.height = 14;
        return ignoredThenable;
    };

    assert.equal(renderer.beginFrame(13.9, 14.9), undefined);
    assert.deepEqual(calls, ['resize', 'bind', 'viewport']);
    assert.equal(thenReads, 0);
    assert.equal(renderer.commands.length, 0);
});

test('resize lookup and call failures stop all later work without translating the error', () => {
    for (const failureKind of ['lookup', 'call']) {
        const error = Object.freeze({ stage: `resize ${failureKind}` });
        let glReads = 0;
        let commandsReads = 0;
        const renderer = Object.create(EffectRenderer.prototype);
        renderer.width = 21;
        renderer.height = 22;
        Object.defineProperty(renderer, 'resize', failureKind === 'lookup'
            ? { get() { throw error; } }
            : { value() { throw error; } });
        Object.defineProperty(renderer, 'gl', {
            get() {
                glReads += 1;
                return {};
            }
        });
        Object.defineProperty(renderer, 'commands', {
            get() {
                commandsReads += 1;
                return [];
            }
        });

        assert.strictEqual(captureThrown(() => renderer.beginFrame(1, 2)), error);
        assert.equal(glReads, 0);
        assert.equal(commandsReads, 0);
        assert.equal(renderer.width, 21);
        assert.equal(renderer.height, 22);
    }

    {
        const error = Object.freeze({ stage: 'resize partial mutation' });
        let glReads = 0;
        const queue = [{ id: 1 }];
        const renderer = Object.create(EffectRenderer.prototype);
        renderer.width = 21;
        renderer.height = 22;
        renderer.commands = queue;
        renderer.resize = function resize() {
            this.width = 31;
            this.height = 32;
            this.commands.push({ id: 2 });
            throw error;
        };
        Object.defineProperty(renderer, 'gl', {
            get() {
                glReads += 1;
                return {};
            }
        });

        assert.strictEqual(captureThrown(() => renderer.beginFrame(1, 2)), error);
        assert.equal(renderer.width, 31);
        assert.equal(renderer.height, 32);
        assert.equal(queue.length, 2);
        assert.equal(glReads, 0);
    }

    const nonCallableRenderer = Object.create(EffectRenderer.prototype);
    nonCallableRenderer.resize = 0;
    let nonCallableGlReads = 0;
    Object.defineProperty(nonCallableRenderer, 'gl', {
        get() {
            nonCallableGlReads += 1;
            return {};
        }
    });
    const thrown = captureThrown(() => nonCallableRenderer.beginFrame(1, 2));
    assert.equal(thrown?.name, 'TypeError');
    assert.equal(nonCallableGlReads, 0);
});

test('dimension and GL failures preserve exact completed prefix state and leave the queue pending', () => {
    {
        const error = Object.freeze({ stage: 'drawingBufferWidth' });
        let heightReads = 0;
        const queue = [{ id: 1 }];
        const gl = {
            get drawingBufferWidth() {
                throw error;
            },
            get drawingBufferHeight() {
                heightReads += 1;
                return 9;
            }
        };
        const renderer = createBareRenderer(gl, queue);
        assert.strictEqual(captureThrown(() => renderer.beginFrame(3.9, 4.9)), error);
        assert.equal(renderer.width, 3);
        assert.equal(renderer.height, 4);
        assert.equal(heightReads, 0);
        assert.equal(queue.length, 1);
    }

    {
        const error = Object.freeze({ stage: 'drawingBufferHeight' });
        let bindReads = 0;
        const queue = [{ id: 1 }];
        const gl = {
            drawingBufferWidth: 8.9,
            get drawingBufferHeight() {
                throw error;
            },
            get bindFramebuffer() {
                bindReads += 1;
                return () => {};
            }
        };
        const renderer = createBareRenderer(gl, queue);
        assert.strictEqual(captureThrown(() => renderer.beginFrame(3.9, 4.9)), error);
        assert.equal(renderer.width, 8);
        assert.equal(renderer.height, 4);
        assert.equal(bindReads, 0);
        assert.equal(queue.length, 1);
    }

    {
        const error = Object.freeze({ stage: 'bindFramebuffer call' });
        let viewportReads = 0;
        const queue = [{ id: 1 }];
        const gl = {
            drawingBufferWidth: 8.9,
            drawingBufferHeight: 9.9,
            FRAMEBUFFER: 0x8D40,
            bindFramebuffer() {
                throw error;
            },
            get viewport() {
                viewportReads += 1;
                return () => {};
            }
        };
        const renderer = createBareRenderer(gl, queue);
        assert.strictEqual(captureThrown(() => renderer.beginFrame(3.9, 4.9)), error);
        assert.equal(renderer.width, 8);
        assert.equal(renderer.height, 9);
        assert.equal(viewportReads, 0);
        assert.equal(queue.length, 1);
    }

    {
        const error = Object.freeze({ stage: 'viewport call' });
        let bindCalls = 0;
        const queue = [{ id: 1 }];
        const gl = {
            drawingBufferWidth: 8.9,
            drawingBufferHeight: 9.9,
            FRAMEBUFFER: 0x8D40,
            bindFramebuffer() {
                bindCalls += 1;
            },
            viewport() {
                throw error;
            }
        };
        const renderer = createBareRenderer(gl, queue);
        assert.strictEqual(captureThrown(() => renderer.beginFrame(3.9, 4.9)), error);
        assert.equal(bindCalls, 1);
        assert.equal(renderer.width, 8);
        assert.equal(renderer.height, 9);
        assert.equal(queue.length, 1);
    }
});

test('fallback dimension and GL property getter failures short-circuit with exact partial state', () => {
    {
        const error = Object.freeze({ stage: 'fallback width getter' });
        let heightBufferReads = 0;
        let widthSets = 0;
        const target = {
            commands: [{ id: 1 }],
            resize() {},
            gl: {
                drawingBufferWidth: 0,
                get drawingBufferHeight() {
                    heightBufferReads += 1;
                    return 9;
                }
            },
            height: 4
        };
        Object.defineProperty(target, 'width', {
            get() {
                throw error;
            },
            set() {
                widthSets += 1;
            }
        });

        assert.strictEqual(
            captureThrown(() => Reflect.apply(EffectRenderer.prototype.beginFrame, target, [1, 2])),
            error
        );
        assert.equal(widthSets, 0);
        assert.equal(heightBufferReads, 0);
        assert.equal(target.height, 4);
        assert.equal(target.commands.length, 1);
    }

    {
        const error = Object.freeze({ stage: 'fallback height getter' });
        let widthValue = 3;
        let bindReads = 0;
        const target = {
            commands: [{ id: 1 }],
            resize() {},
            gl: {
                drawingBufferWidth: 8.9,
                drawingBufferHeight: 0,
                get bindFramebuffer() {
                    bindReads += 1;
                    return () => {};
                }
            }
        };
        Object.defineProperties(target, {
            width: {
                get() {
                    return widthValue;
                },
                set(value) {
                    widthValue = value;
                }
            },
            height: {
                get() {
                    throw error;
                },
                set() {
                    throw new Error('height setter must not run');
                }
            }
        });

        assert.strictEqual(
            captureThrown(() => Reflect.apply(EffectRenderer.prototype.beginFrame, target, [1, 2])),
            error
        );
        assert.equal(widthValue, 8);
        assert.equal(bindReads, 0);
        assert.equal(target.commands.length, 1);
    }

    for (const failureStage of ['bindFramebuffer getter', 'FRAMEBUFFER getter', 'viewport getter']) {
        const error = Object.freeze({ stage: failureStage });
        const trace = [];
        const queue = [{ id: 1 }];
        const gl = {
            drawingBufferWidth: 8.9,
            drawingBufferHeight: 9.9,
            get bindFramebuffer() {
                trace.push('bindFramebuffer:get');
                if (failureStage === 'bindFramebuffer getter') {
                    throw error;
                }
                return function bindFramebuffer() {
                    trace.push('bindFramebuffer:call');
                };
            },
            get FRAMEBUFFER() {
                trace.push('FRAMEBUFFER:get');
                if (failureStage === 'FRAMEBUFFER getter') {
                    throw error;
                }
                return 0x8D40;
            },
            get viewport() {
                trace.push('viewport:get');
                if (failureStage === 'viewport getter') {
                    throw error;
                }
                return () => {};
            }
        };
        const renderer = createBareRenderer(gl, queue);

        assert.strictEqual(captureThrown(() => renderer.beginFrame(3.9, 4.9)), error);
        assert.equal(renderer.width, 8);
        assert.equal(renderer.height, 9);
        assert.equal(queue.length, 1);
        if (failureStage === 'bindFramebuffer getter') {
            assert.deepEqual(trace, ['bindFramebuffer:get']);
        } else if (failureStage === 'FRAMEBUFFER getter') {
            assert.deepEqual(trace, ['bindFramebuffer:get', 'FRAMEBUFFER:get']);
        } else {
            assert.deepEqual(trace, [
                'bindFramebuffer:get',
                'FRAMEBUFFER:get',
                'bindFramebuffer:call',
                'viewport:get'
            ]);
        }
    }
});

test('viewport dimension getter failures evaluate width before height and keep the queue', () => {
    for (const failureAxis of ['width', 'height']) {
        const error = Object.freeze({ stage: `viewport ${failureAxis}` });
        const trace = [];
        let widthValue = 3;
        let heightValue = 4;
        const target = {
            commands: [{ id: 1 }],
            resize() {},
            gl: {
                drawingBufferWidth: 8.9,
                drawingBufferHeight: 9.9,
                FRAMEBUFFER: 0x8D40,
                bindFramebuffer() {
                    trace.push('bind');
                },
                viewport() {
                    throw new Error('viewport call must not begin');
                }
            }
        };
        Object.defineProperties(target, {
            width: {
                get() {
                    trace.push('width:get');
                    if (failureAxis === 'width') {
                        throw error;
                    }
                    return widthValue;
                },
                set(value) {
                    widthValue = value;
                }
            },
            height: {
                get() {
                    trace.push('height:get');
                    if (failureAxis === 'height') {
                        throw error;
                    }
                    return heightValue;
                },
                set(value) {
                    heightValue = value;
                }
            }
        });

        assert.strictEqual(
            captureThrown(() => Reflect.apply(EffectRenderer.prototype.beginFrame, target, [1, 2])),
            error
        );
        assert.equal(widthValue, 8);
        assert.equal(heightValue, 9);
        assert.equal(target.commands.length, 1);
        assert.deepEqual(
            trace,
            failureAxis === 'width'
                ? ['bind', 'width:get']
                : ['bind', 'width:get', 'height:get']
        );
    }
});

test('non-callable GL methods still evaluate their call arguments before throwing', () => {
    {
        const trace = [];
        const queue = [{ id: 1 }];
        const gl = {};
        Object.defineProperties(gl, {
            drawingBufferWidth: {
                get() {
                    trace.push('drawingBufferWidth');
                    return 8.9;
                }
            },
            drawingBufferHeight: {
                get() {
                    trace.push('drawingBufferHeight');
                    return 9.9;
                }
            },
            bindFramebuffer: {
                get() {
                    trace.push('bindFramebuffer');
                    return 0;
                }
            },
            FRAMEBUFFER: {
                get() {
                    trace.push('FRAMEBUFFER');
                    return 0x8D40;
                }
            },
            viewport: {
                get() {
                    throw new Error('viewport must not be observed');
                }
            }
        });
        const renderer = createBareRenderer(gl, queue);

        const thrown = captureThrown(() => renderer.beginFrame(3.9, 4.9));
        assert.equal(thrown?.name, 'TypeError');
        assert.deepEqual(trace, [
            'drawingBufferWidth',
            'drawingBufferHeight',
            'bindFramebuffer',
            'FRAMEBUFFER'
        ]);
        assert.equal(queue.length, 1);
    }

    {
        const trace = [];
        let widthValue = 3;
        let heightValue = 4;
        const queue = [{ id: 1 }];
        const target = {
            commands: queue,
            resize() {
                widthValue = 3;
                heightValue = 4;
            },
            gl: {
                get drawingBufferWidth() {
                    trace.push('drawingBufferWidth');
                    return 8.9;
                },
                get drawingBufferHeight() {
                    trace.push('drawingBufferHeight');
                    return 9.9;
                },
                FRAMEBUFFER: 0x8D40,
                bindFramebuffer() {
                    trace.push('bindFramebuffer:call');
                },
                get viewport() {
                    trace.push('viewport:get');
                    return null;
                }
            }
        };
        Object.defineProperties(target, {
            width: {
                get() {
                    trace.push('width:get');
                    return widthValue;
                },
                set(value) {
                    trace.push(`width:set:${value}`);
                    widthValue = value;
                }
            },
            height: {
                get() {
                    trace.push('height:get');
                    return heightValue;
                },
                set(value) {
                    trace.push(`height:set:${value}`);
                    heightValue = value;
                }
            }
        });

        const thrown = captureThrown(() => Reflect.apply(
            EffectRenderer.prototype.beginFrame,
            target,
            [1, 2]
        ));
        assert.equal(thrown?.name, 'TypeError');
        assert.deepEqual(trace, [
            'drawingBufferWidth',
            'width:set:8',
            'drawingBufferHeight',
            'height:set:9',
            'bindFramebuffer:call',
            'viewport:get',
            'width:get',
            'height:get'
        ]);
        assert.equal(queue.length, 1);
    }
});

test('dimension assignment failures stop later observations and preserve earlier assignments', () => {
    {
        const error = Object.freeze({ stage: 'width assignment' });
        let heightReads = 0;
        const target = {
            commands: [{ id: 1 }],
            resize() {},
            gl: {
                drawingBufferWidth: 8.9,
                get drawingBufferHeight() {
                    heightReads += 1;
                    return 9.9;
                }
            }
        };
        Object.defineProperty(target, 'width', {
            get() {
                return 3;
            },
            set(value) {
                assert.equal(value, 8);
                throw error;
            }
        });
        target.height = 4;

        assert.strictEqual(
            captureThrown(() => Reflect.apply(EffectRenderer.prototype.beginFrame, target, [1, 2])),
            error
        );
        assert.equal(heightReads, 0);
        assert.equal(target.height, 4);
        assert.equal(target.commands.length, 1);
    }

    {
        const error = Object.freeze({ stage: 'height assignment' });
        let widthValue = 3;
        const target = {
            commands: [{ id: 1 }],
            resize() {},
            gl: {
                drawingBufferWidth: 8.9,
                drawingBufferHeight: 9.9
            }
        };
        Object.defineProperties(target, {
            width: {
                get() {
                    return widthValue;
                },
                set(value) {
                    widthValue = value;
                }
            },
            height: {
                get() {
                    return 4;
                },
                set(value) {
                    assert.equal(value, 9);
                    throw error;
                }
            }
        });

        assert.strictEqual(
            captureThrown(() => Reflect.apply(EffectRenderer.prototype.beginFrame, target, [1, 2])),
            error
        );
        assert.equal(widthValue, 8);
        assert.equal(target.height, 4);
        assert.equal(target.commands.length, 1);
    }
});

test('viewport can replace the current queue and only the replacement is cleared', () => {
    const originalQueue = [{ id: 'original' }];
    const replacementQueue = [{ id: 'replacement 1' }, { id: 'replacement 2' }];
    let renderer;
    const gl = {
        drawingBufferWidth: 0,
        drawingBufferHeight: 0,
        FRAMEBUFFER: 0x8D40,
        bindFramebuffer() {},
        viewport() {
            renderer.commands = replacementQueue;
        }
    };
    renderer = createBareRenderer(gl, originalQueue);

    assert.equal(renderer.beginFrame(16, 9), undefined);
    assert.strictEqual(renderer.commands, replacementQueue);
    assert.equal(replacementQueue.length, 0);
    assert.equal(originalQueue.length, 1);
});

test('a failed final queue shrink preserves language-defined partial length after completed GL setup', () => {
    const queue = [{ id: 0 }, { id: 1 }, { id: 2 }];
    Object.defineProperty(queue, '1', {
        configurable: false,
        enumerable: true,
        writable: true,
        value: queue[1]
    });
    const calls = [];
    const renderer = createBareRenderer({
        drawingBufferWidth: 20,
        drawingBufferHeight: 10,
        FRAMEBUFFER: 0x8D40,
        bindFramebuffer() {
            calls.push('bind');
        },
        viewport() {
            calls.push('viewport');
        }
    }, queue);

    const thrown = captureThrown(() => renderer.beginFrame(1, 1));
    assert.equal(thrown?.name, 'TypeError');
    assert.deepEqual(calls, ['bind', 'viewport']);
    assert.equal(renderer.width, 20);
    assert.equal(renderer.height, 10);
    assert.equal(queue.length, 2);
    assert.equal(Object.hasOwn(queue, 2), false);
});

test('final commands lookup and length assignment errors preserve identity and completed GL state', () => {
    const createGl = (calls) => ({
        drawingBufferWidth: 20,
        drawingBufferHeight: 10,
        FRAMEBUFFER: 0x8D40,
        bindFramebuffer() {
            calls.push('bind');
        },
        viewport() {
            calls.push('viewport');
        }
    });

    {
        const error = Object.freeze({ stage: 'commands getter' });
        const calls = [];
        let commandsReads = 0;
        const renderer = Object.create(EffectRenderer.prototype);
        renderer.gl = createGl(calls);
        renderer.width = 0;
        renderer.height = 0;
        Object.defineProperty(renderer, 'commands', {
            get() {
                commandsReads += 1;
                throw error;
            }
        });

        assert.strictEqual(captureThrown(() => renderer.beginFrame(1, 1)), error);
        assert.deepEqual(calls, ['bind', 'viewport']);
        assert.equal(commandsReads, 1);
        assert.equal(renderer.width, 20);
        assert.equal(renderer.height, 10);
    }

    {
        const error = Object.freeze({ stage: 'length setter' });
        const calls = [];
        const backing = [{ id: 1 }];
        const commands = new Proxy(backing, {
            set(target, property, value, receiver) {
                assert.equal(property, 'length');
                assert.equal(value, 0);
                assert.strictEqual(receiver, commands);
                throw error;
            }
        });
        const renderer = createBareRenderer(createGl(calls), commands);
        let commandsReads = 0;
        Object.defineProperty(renderer, 'commands', {
            configurable: true,
            get() {
                commandsReads += 1;
                return commands;
            }
        });

        assert.strictEqual(captureThrown(() => renderer.beginFrame(1, 1)), error);
        assert.deepEqual(calls, ['bind', 'viewport']);
        assert.equal(commandsReads, 1);
        assert.equal(backing.length, 1);
        assert.equal(renderer.width, 20);
        assert.equal(renderer.height, 10);
    }

    {
        const calls = [];
        const backing = [{ id: 1 }];
        const commands = new Proxy(backing, {
            set(_target, property, value, receiver) {
                assert.equal(property, 'length');
                assert.equal(value, 0);
                assert.strictEqual(receiver, commands);
                return true;
            }
        });
        const renderer = createBareRenderer(createGl(calls), commands);

        assert.equal(renderer.beginFrame(1, 1), undefined);
        assert.deepEqual(calls, ['bind', 'viewport']);
        assert.equal(backing.length, 1, 'successful exotic assignment need not shrink the target');
    }
});

test('drawing-buffer access can reenter beginFrame and the outer call resumes without a guard', () => {
    const trace = [];
    let didReenter = false;
    let renderer;
    const gl = {
        get drawingBufferWidth() {
            if (!didReenter) {
                didReenter = true;
                trace.push('outer-width:start');
                assert.equal(renderer.beginFrame(30.9, 40.9), undefined);
                trace.push(`outer-width:resume:${renderer.width}:${renderer.height}`);
            } else {
                trace.push('nested-width');
            }
            return 0;
        },
        get drawingBufferHeight() {
            trace.push('height');
            return 0;
        },
        FRAMEBUFFER: 0x8D40,
        bindFramebuffer() {
            trace.push('bind');
        },
        viewport(_x, _y, width, height) {
            trace.push(`viewport:${width}:${height}`);
        }
    };
    renderer = createBareRenderer(gl, [{ id: 1 }, { id: 2 }]);

    assert.equal(renderer.beginFrame(10.9, 20.9), undefined);
    assert.equal(renderer.width, 30);
    assert.equal(renderer.height, 40);
    assert.equal(renderer.commands.length, 0);
    assert.deepEqual(trace, [
        'outer-width:start',
        'nested-width',
        'height',
        'bind',
        'viewport:30:40',
        'outer-width:resume:30:40',
        'height',
        'bind',
        'viewport:30:40'
    ]);
});

test('beginFrame function shape remains a two-argument non-constructable class method', () => {
    const method = EffectRenderer.prototype.beginFrame;
    assert.equal(method.name, 'beginFrame');
    assert.equal(method.length, 2);
    assert.equal(Object.hasOwn(method, 'prototype'), false);

    const thrown = captureThrown(() => Reflect.construct(method, [1, 2]));
    assert.equal(thrown?.name, 'TypeError');
});
