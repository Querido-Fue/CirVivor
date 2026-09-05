import assert from 'node:assert/strict';
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

/**
 * constructor의 GL 초기화를 우회하고 actual prototype method만 사용하는 receiver를 생성합니다.
 * @param {object} [options] - receiver 필드입니다.
 * @param {*} [options.commands] - live command queue입니다.
 * @param {*} [options.width] - 현재 너비입니다.
 * @param {*} [options.height] - 현재 높이입니다.
 * @param {*} [options.effectPasses] - effect pass registry입니다.
 * @returns {EffectRenderer} 최소 receiver입니다.
 */
function createBareRenderer({
    commands = [],
    width = 16,
    height = 9,
    effectPasses = new Map()
} = {}) {
    const renderer = Object.create(EffectRenderer.prototype);
    renderer.commands = commands;
    renderer.width = width;
    renderer.height = height;
    renderer.effectPasses = effectPasses;
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

test('flush guards use strict empty length then width and height coercion in order before clearing', () => {
    {
        const trace = [];
        const backing = [];
        const commands = new Proxy(backing, {
            get(target, property, receiver) {
                if (property === 'length') {
                    trace.push(`length:get:${target.length}`);
                }
                return Reflect.get(target, property, receiver);
            },
            set(target, property, value, receiver) {
                if (property === 'length') {
                    trace.push(`length:set:${value}`);
                }
                return Reflect.set(target, property, value, receiver);
            }
        });
        const renderer = Object.create(EffectRenderer.prototype);
        Object.defineProperties(renderer, {
            commands: {
                get() {
                    trace.push('commands:get');
                    return commands;
                }
            },
            width: {
                get() {
                    throw new Error('empty queue must not read width');
                }
            },
            height: {
                get() {
                    throw new Error('empty queue must not read height');
                }
            },
            effectPasses: {
                get() {
                    throw new Error('empty queue must not read registry');
                }
            }
        });

        assert.equal(renderer.flush(), undefined);
        assert.deepEqual(trace, [
            'commands:get',
            'length:get:0',
            'commands:get',
            'length:set:0'
        ]);
    }

    {
        const trace = [];
        let lengthReads = 0;
        const commands = new Proxy({}, {
            get(target, property, receiver) {
                if (property === 'length') {
                    lengthReads += 1;
                    trace.push(`length:get:${lengthReads}`);
                    return '0';
                }
                return Reflect.get(target, property, receiver);
            },
            set(target, property, value, receiver) {
                trace.push(`length:set:${String(value)}`);
                return Reflect.set(target, property, value, receiver);
            }
        });
        const renderer = createBareRenderer({ commands });
        Object.defineProperty(renderer, 'effectPasses', {
            get() {
                throw new Error('coerced zero loop length must not enter the body');
            }
        });

        assert.equal(renderer.flush(), undefined);
        assert.deepEqual(trace, [
            'length:get:1',
            'length:get:2',
            'length:set:0'
        ]);
        assert.equal(lengthReads, 2, 'initial strict comparison and loop relational comparison are distinct reads');
    }

    {
        const trace = [];
        const commands = [{}];
        const width = {
            [Symbol.toPrimitive](hint) {
                trace.push(`width:coerce:${hint}`);
                return -0;
            }
        };
        const renderer = createBareRenderer({ commands, width });
        Object.defineProperty(renderer, 'height', {
            get() {
                throw new Error('width guard must short-circuit height');
            }
        });
        Object.defineProperty(renderer, 'effectPasses', {
            get() {
                throw new Error('width guard must short-circuit registry');
            }
        });

        assert.equal(renderer.flush(), undefined);
        assert.deepEqual(trace, ['width:coerce:number']);
        assert.equal(commands.length, 0);
    }

    {
        const trace = [];
        const commands = [{}];
        const height = {
            valueOf() {
                trace.push('height:valueOf');
                return '0';
            }
        };
        const renderer = createBareRenderer({ commands, width: 3, height });
        Object.defineProperty(renderer, 'effectPasses', {
            get() {
                throw new Error('height guard must short-circuit registry');
            }
        });

        assert.equal(renderer.flush(), undefined);
        assert.deepEqual(trace, ['height:valueOf']);
        assert.equal(commands.length, 0);
    }

    for (const [width, height] of [
        [Number.NaN, 10],
        [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
    ]) {
        const key = {};
        const command = { effectType: key };
        const calls = [];
        const renderer = createBareRenderer({
            commands: [command],
            width,
            height,
            effectPasses: new Map([[key, {
                draw(...args) {
                    calls.push(args);
                }
            }]])
        });

        assert.equal(renderer.flush(), undefined);
        assert.equal(calls.length, 1);
        assert.strictEqual(calls[0][0], command);
        assert.equal(Object.is(calls[0][1], width), true);
        assert.equal(Object.is(calls[0][2], height), true);
        assert.equal(renderer.commands.length, 0);
    }
});

test('nullish commands throw on property access while truthy primitives can miss and clear normally', () => {
    for (const command of [null, undefined]) {
        const queue = [command];
        const renderer = createBareRenderer({ commands: queue });
        const thrown = captureThrown(() => renderer.flush());
        assert.equal(thrown?.name, 'TypeError');
        assert.equal(queue.length, 1);
    }

    for (const command of [true, 1, 1n, 'command', Symbol('command')]) {
        const queue = [command];
        const renderer = createBareRenderer({ commands: queue, effectPasses: new Map() });
        assert.equal(renderer.flush(), undefined);
        assert.equal(queue.length, 0);
    }
});

test('flush resolves raw truthy effectType or fallback shape as an exact uncoerced Map key', () => {
    const objectKey = {
        [Symbol.toPrimitive]() {
            throw new Error('effect key must not be coerced');
        }
    };
    const objectCommand = {};
    Object.defineProperties(objectCommand, {
        effectType: {
            get() {
                return objectKey;
            }
        },
        shape: {
            get() {
                throw new Error('truthy effectType must short-circuit shape');
            }
        }
    });
    let objectDrawCalls = 0;
    const objectRenderer = createBareRenderer({
        commands: [objectCommand],
        effectPasses: new Map([[objectKey, {
            draw(command) {
                assert.strictEqual(command, objectCommand);
                objectDrawCalls += 1;
            }
        }]])
    });

    assert.equal(objectRenderer.flush(), undefined);
    assert.equal(objectDrawCalls, 1);

    const falsyEffectTypes = [undefined, null, false, 0, -0, 0n, Number.NaN, ''];
    for (const effectType of falsyEffectTypes) {
        const shapeKey = {};
        const command = { effectType, shape: shapeKey };
        let drawCalls = 0;
        const renderer = createBareRenderer({
            commands: [command],
            effectPasses: new Map([[shapeKey, {
                draw(receivedCommand) {
                    assert.strictEqual(receivedCommand, command);
                    drawCalls += 1;
                }
            }]])
        });

        assert.equal(renderer.flush(), undefined);
        assert.equal(drawCalls, 1, `falsy effectType ${String(effectType)}`);
        assert.equal(renderer.commands.length, 0);
    }

    for (const { storedKey, shapeKey } of [
        { storedKey: Number.NaN, shapeKey: Number.NaN },
        { storedKey: -0, shapeKey: +0 },
        { storedKey: Symbol.for('effect-shape'), shapeKey: Symbol.for('effect-shape') }
    ]) {
        let drawCalls = 0;
        const renderer = createBareRenderer({
            commands: [{ effectType: false, shape: shapeKey }],
            effectPasses: new Map([[storedKey, {
                draw() {
                    drawCalls += 1;
                }
            }]])
        });
        assert.equal(renderer.flush(), undefined);
        assert.equal(drawCalls, 1);
    }
});

test('missing, falsy, and first-read non-function passes are skipped without a second draw read', () => {
    const key = {};
    const falsyPasses = [undefined, null, false, 0, -0, 0n, Number.NaN, ''];
    for (const effectPass of falsyPasses) {
        const renderer = createBareRenderer({
            commands: [{ effectType: key }],
            effectPasses: new Map([[key, effectPass]])
        });
        assert.equal(renderer.flush(), undefined);
        assert.equal(renderer.commands.length, 0);
    }

    const missingRenderer = createBareRenderer({
        commands: [{ effectType: key }],
        effectPasses: new Map()
    });
    assert.equal(missingRenderer.flush(), undefined);
    assert.equal(missingRenderer.commands.length, 0);

    for (const nonFunction of [undefined, null, false, 0, '', {}, Symbol('draw')]) {
        let drawReads = 0;
        const effectPass = {};
        Object.defineProperty(effectPass, 'draw', {
            get() {
                drawReads += 1;
                if (drawReads > 1) {
                    throw new Error('non-function draw must not be read twice');
                }
                return nonFunction;
            }
        });
        const renderer = createBareRenderer({
            commands: [{ effectType: key }],
            effectPasses: new Map([[key, effectPass]])
        });

        assert.equal(renderer.flush(), undefined);
        assert.equal(drawReads, 1);
        assert.equal(renderer.commands.length, 0);
    }
});

test('live dispatch preserves lookup order, double draw getter, receivers, current dimensions, and discarded return', () => {
    const trace = [];
    const key = {};
    const command = {};
    Object.defineProperties(command, {
        effectType: {
            get() {
                trace.push('command:effectType:get');
                return key;
            }
        },
        shape: {
            get() {
                throw new Error('truthy effectType must skip shape');
            }
        }
    });

    const backingCommands = [command];
    const commands = new Proxy(backingCommands, {
        get(target, property, receiver) {
            if (property === 'length') {
                trace.push('commands:length:get');
            } else if (property === '0') {
                trace.push('commands:index:get:0');
            }
            return Reflect.get(target, property, receiver);
        },
        set(target, property, value, receiver) {
            if (property === 'length') {
                trace.push(`commands:length:set:${value}`);
            }
            return Reflect.set(target, property, value, receiver);
        }
    });

    const hostileThenable = {};
    Object.defineProperty(hostileThenable, 'then', {
        get() {
            throw new Error('draw return thenable must not be observed');
        }
    });
    let drawReads = 0;
    const effectPass = {};
    Object.defineProperty(effectPass, 'draw', {
        get() {
            drawReads += 1;
            trace.push(`pass.draw:get:${drawReads}`);
            if (drawReads === 1) {
                return function staleDraw() {
                    throw new Error('first draw lookup is only the typeof check');
                };
            }
            return function liveDraw(...args) {
                assert.strictEqual(this, effectPass);
                assert.equal(args.length, 3);
                assert.strictEqual(args[0], command);
                assert.equal(args[1], 32);
                assert.equal(args[2], 48);
                trace.push('pass.draw:call');
                return hostileThenable;
            };
        }
    });

    const registry = {};
    Object.defineProperty(registry, 'get', {
        get() {
            assert.strictEqual(this, registry);
            trace.push('registry.get:get');
            return function get(effectType) {
                assert.strictEqual(this, registry);
                assert.strictEqual(effectType, key);
                trace.push('registry.get:call');
                return effectPass;
            };
        }
    });

    const renderer = Object.create(EffectRenderer.prototype);
    let widthReads = 0;
    let heightReads = 0;
    Object.defineProperties(renderer, {
        commands: {
            get() {
                assert.strictEqual(this, renderer);
                trace.push('renderer:commands:get');
                return commands;
            }
        },
        width: {
            get() {
                assert.strictEqual(this, renderer);
                widthReads += 1;
                trace.push(`width:get:${widthReads}`);
                return widthReads === 1 ? 12 : 32;
            }
        },
        height: {
            get() {
                assert.strictEqual(this, renderer);
                heightReads += 1;
                trace.push(`height:get:${heightReads}`);
                return heightReads === 1 ? 18 : 48;
            }
        },
        effectPasses: {
            get() {
                assert.strictEqual(this, renderer);
                trace.push('renderer:effectPasses:get');
                return registry;
            }
        }
    });

    assert.equal(renderer.flush(), undefined);
    assert.deepEqual(trace, [
        'renderer:commands:get',
        'commands:length:get',
        'width:get:1',
        'height:get:1',
        'renderer:commands:get',
        'commands:length:get',
        'renderer:commands:get',
        'commands:index:get:0',
        'command:effectType:get',
        'renderer:effectPasses:get',
        'registry.get:get',
        'registry.get:call',
        'pass.draw:get:1',
        'pass.draw:get:2',
        'width:get:2',
        'height:get:2',
        'pass.draw:call',
        'renderer:commands:get',
        'commands:length:get',
        'renderer:commands:get',
        'commands:length:set:0'
    ]);
    assert.equal(backingCommands.length, 0);
});

test('append, truncate, reorder, and queue replacement are observed by the current live loop', () => {
    {
        const keys = { a: {}, b: {}, c: {} };
        const commands = {
            a: { effectType: keys.a },
            b: { effectType: keys.b },
            c: { effectType: keys.c }
        };
        const queue = [commands.a, commands.b];
        const trace = [];
        const renderer = createBareRenderer({ commands: queue });
        renderer.effectPasses = new Map([
            [keys.a, { draw() { trace.push('a'); renderer.commands.push(commands.c); } }],
            [keys.b, { draw() { trace.push('b'); } }],
            [keys.c, { draw() { trace.push('c'); } }]
        ]);

        assert.equal(renderer.flush(), undefined);
        assert.deepEqual(trace, ['a', 'b', 'c']);
        assert.equal(queue.length, 0);
    }

    {
        const keys = { a: {}, b: {}, c: {}, d: {} };
        const commands = Object.fromEntries(
            Object.entries(keys).map(([name, effectType]) => [name, { effectType }])
        );
        const queue = [commands.a, commands.b, commands.c];
        const trace = [];
        const renderer = createBareRenderer({ commands: queue });
        renderer.effectPasses = new Map([
            [keys.a, {
                draw() {
                    trace.push('a');
                    renderer.commands[1] = commands.d;
                }
            }],
            [keys.b, { draw() { trace.push('b'); } }],
            [keys.c, { draw() { trace.push('c'); } }],
            [keys.d, {
                draw() {
                    trace.push('d');
                    renderer.commands.length = 1;
                }
            }]
        ]);

        assert.equal(renderer.flush(), undefined);
        assert.deepEqual(trace, ['a', 'd']);
        assert.equal(queue.length, 0);
    }

    {
        const keys = { a: {}, b: {}, c: {} };
        const commands = {
            a: { effectType: keys.a },
            b: { effectType: keys.b },
            c: { effectType: keys.c }
        };
        const originalQueue = [commands.a, commands.b];
        const replacementQueue = [commands.c];
        const trace = [];
        const renderer = createBareRenderer({ commands: originalQueue });
        renderer.effectPasses = new Map([
            [keys.a, {
                draw() {
                    trace.push('a');
                    renderer.commands = replacementQueue;
                }
            }],
            [keys.b, { draw() { trace.push('b'); } }],
            [keys.c, { draw() { trace.push('c'); } }]
        ]);

        assert.equal(renderer.flush(), undefined);
        assert.deepEqual(trace, ['a']);
        assert.strictEqual(renderer.commands, replacementQueue);
        assert.equal(replacementQueue.length, 0);
        assert.equal(originalQueue.length, 2);
    }
});

test('later commands observe registry and dimensions replaced by an earlier draw', () => {
    const firstKey = {};
    const secondKey = {};
    const firstCommand = { effectType: firstKey };
    const secondCommand = { effectType: secondKey };
    const queue = [firstCommand, secondCommand];
    const trace = [];
    const renderer = createBareRenderer({ commands: queue, width: 10, height: 20 });
    const replacementRegistry = new Map([[secondKey, {
        draw(command, width, height) {
            assert.strictEqual(command, secondCommand);
            assert.equal(width, 30);
            assert.equal(height, 40);
            trace.push('second:replacement');
        }
    }]]);
    renderer.effectPasses = new Map([
        [firstKey, {
            draw(command, width, height) {
                assert.strictEqual(command, firstCommand);
                assert.equal(width, 10);
                assert.equal(height, 20);
                trace.push('first');
                renderer.width = 30;
                renderer.height = 40;
                renderer.effectPasses = replacementRegistry;
            }
        }],
        [secondKey, {
            draw() {
                throw new Error('stale second pass must not run');
            }
        }]
    ]);

    assert.equal(renderer.flush(), undefined);
    assert.deepEqual(trace, ['first', 'second:replacement']);
    assert.strictEqual(renderer.effectPasses, replacementRegistry);
    assert.strictEqual(renderer.commands, queue);
    assert.equal(queue.length, 0);
});

test('flush reentry has no guard and observes both same-queue clear and abandoned outer arrays', () => {
    {
        const key = {};
        const command = { effectType: key };
        const queue = [command];
        const trace = [];
        let didReenter = false;
        const renderer = createBareRenderer({ commands: queue });
        renderer.effectPasses = new Map([[key, {
            draw() {
                if (didReenter) {
                    trace.push('nested');
                    return;
                }
                didReenter = true;
                trace.push('outer:start');
                assert.equal(renderer.flush(), undefined);
                trace.push('outer:end');
            }
        }]]);

        assert.equal(renderer.flush(), undefined);
        assert.deepEqual(trace, ['outer:start', 'nested', 'outer:end']);
        assert.strictEqual(renderer.commands, queue);
        assert.equal(queue.length, 0, 'nested clear short-circuits the outer live loop');
    }

    {
        const outerKey = {};
        const nestedKey = {};
        const outerCommand = { effectType: outerKey };
        const nestedCommand = { effectType: nestedKey };
        const outerQueue = [outerCommand];
        const nestedQueue = [nestedCommand];
        const trace = [];
        const renderer = createBareRenderer({ commands: outerQueue });
        renderer.effectPasses = new Map([
            [outerKey, {
                draw() {
                    trace.push('outer:start');
                    renderer.commands = nestedQueue;
                    assert.equal(renderer.flush(), undefined);
                    trace.push('outer:end');
                }
            }],
            [nestedKey, {
                draw(command, width, height) {
                    assert.strictEqual(command, nestedCommand);
                    assert.equal(width, 16);
                    assert.equal(height, 9);
                    trace.push('nested');
                }
            }]
        ]);

        assert.equal(renderer.flush(), undefined);
        assert.deepEqual(trace, ['outer:start', 'nested', 'outer:end']);
        assert.strictEqual(renderer.commands, nestedQueue);
        assert.equal(nestedQueue.length, 0);
        assert.equal(outerQueue.length, 1);
    }
});

test('every live dispatch observation error preserves identity and skips final clear without rollback', () => {
    const cases = [
        {
            label: 'initial commands getter',
            setup(error) {
                const queue = [{ effectType: 'unused' }];
                const renderer = Object.create(EffectRenderer.prototype);
                Object.defineProperty(renderer, 'commands', { get() { throw error; } });
                return { renderer, queue };
            }
        },
        {
            label: 'initial length getter',
            setup(error) {
                const queue = [{ effectType: 'unused' }];
                const commands = new Proxy(queue, {
                    get(target, property, receiver) {
                        if (property === 'length') {
                            throw error;
                        }
                        return Reflect.get(target, property, receiver);
                    }
                });
                return { renderer: createBareRenderer({ commands }), queue };
            }
        },
        {
            label: 'effectType getter',
            setup(error) {
                const command = {};
                Object.defineProperty(command, 'effectType', { get() { throw error; } });
                const queue = [command];
                return { renderer: createBareRenderer({ commands: queue }), queue };
            }
        },
        {
            label: 'shape getter',
            setup(error) {
                const command = { effectType: 0 };
                Object.defineProperty(command, 'shape', { get() { throw error; } });
                const queue = [command];
                return { renderer: createBareRenderer({ commands: queue }), queue };
            }
        },
        {
            label: 'registry property getter',
            setup(error) {
                const queue = [{ effectType: 'key' }];
                const renderer = createBareRenderer({ commands: queue });
                Object.defineProperty(renderer, 'effectPasses', { get() { throw error; } });
                return { renderer, queue };
            }
        },
        {
            label: 'registry get getter',
            setup(error) {
                const queue = [{ effectType: 'key' }];
                const registry = {};
                Object.defineProperty(registry, 'get', { get() { throw error; } });
                return { renderer: createBareRenderer({ commands: queue, effectPasses: registry }), queue };
            }
        },
        {
            label: 'registry get call',
            setup(error) {
                const queue = [{ effectType: 'key' }];
                const registry = { get() { throw error; } };
                return { renderer: createBareRenderer({ commands: queue, effectPasses: registry }), queue };
            }
        },
        {
            label: 'first draw getter',
            setup(error) {
                const key = {};
                const queue = [{ effectType: key }];
                const effectPass = {};
                Object.defineProperty(effectPass, 'draw', { get() { throw error; } });
                return {
                    renderer: createBareRenderer({ commands: queue, effectPasses: new Map([[key, effectPass]]) }),
                    queue
                };
            }
        },
        {
            label: 'second draw getter',
            setup(error) {
                const key = {};
                const queue = [{ effectType: key }];
                let reads = 0;
                const effectPass = {};
                Object.defineProperty(effectPass, 'draw', {
                    get() {
                        reads += 1;
                        if (reads === 2) {
                            throw error;
                        }
                        return function draw() {};
                    }
                });
                return {
                    renderer: createBareRenderer({ commands: queue, effectPasses: new Map([[key, effectPass]]) }),
                    queue
                };
            }
        },
        {
            label: 'current width getter',
            setup(error) {
                const key = {};
                const queue = [{ effectType: key }];
                const renderer = createBareRenderer({
                    commands: queue,
                    effectPasses: new Map([[key, { draw() {} }]])
                });
                let reads = 0;
                Object.defineProperty(renderer, 'width', {
                    get() {
                        reads += 1;
                        if (reads === 2) {
                            throw error;
                        }
                        return 16;
                    }
                });
                return { renderer, queue };
            }
        },
        {
            label: 'current height getter',
            setup(error) {
                const key = {};
                const queue = [{ effectType: key }];
                const renderer = createBareRenderer({
                    commands: queue,
                    effectPasses: new Map([[key, { draw() {} }]])
                });
                let reads = 0;
                Object.defineProperty(renderer, 'height', {
                    get() {
                        reads += 1;
                        if (reads === 2) {
                            throw error;
                        }
                        return 9;
                    }
                });
                return { renderer, queue };
            }
        },
        {
            label: 'draw call',
            setup(error) {
                const key = {};
                const queue = [{ effectType: key }];
                const renderer = createBareRenderer({
                    commands: queue,
                    effectPasses: new Map([[key, { draw() { throw error; } }]])
                });
                return { renderer, queue };
            }
        }
    ];

    for (const errorCase of cases) {
        const error = Object.freeze({ stage: errorCase.label });
        const { renderer, queue } = errorCase.setup(error);
        assert.strictEqual(captureThrown(() => renderer.flush()), error, errorCase.label);
        assert.equal(queue.length, 1, `${errorCase.label} queue must not reach final clear`);
    }

    const guardError = Object.freeze({ stage: 'width coercion' });
    const guardQueue = [{ effectType: 'unused' }];
    let heightReads = 0;
    const guardRenderer = createBareRenderer({
        commands: guardQueue,
        width: {
            [Symbol.toPrimitive]() {
                throw guardError;
            }
        }
    });
    Object.defineProperty(guardRenderer, 'height', {
        get() {
            heightReads += 1;
            return 9;
        }
    });
    assert.strictEqual(captureThrown(() => guardRenderer.flush()), guardError);
    assert.equal(heightReads, 0);
    assert.equal(guardQueue.length, 1);

    const heightGuardError = Object.freeze({ stage: 'height coercion' });
    const heightGuardQueue = [{ effectType: 'unused' }];
    let registryReads = 0;
    const heightGuardRenderer = createBareRenderer({
        commands: heightGuardQueue,
        width: 1,
        height: {
            [Symbol.toPrimitive]() {
                throw heightGuardError;
            }
        }
    });
    Object.defineProperty(heightGuardRenderer, 'effectPasses', {
        get() {
            registryReads += 1;
            return new Map();
        }
    });
    assert.strictEqual(captureThrown(() => heightGuardRenderer.flush()), heightGuardError);
    assert.equal(registryReads, 0);
    assert.equal(heightGuardQueue.length, 1);
});

test('a draw failure leaves the whole live array so retry repeats already completed commands', () => {
    const firstKey = {};
    const secondKey = {};
    const queue = [
        { effectType: firstKey },
        { effectType: secondKey }
    ];
    const error = Object.freeze({ stage: 'second draw first attempt' });
    const trace = [];
    let shouldThrow = true;
    const renderer = createBareRenderer({
        commands: queue,
        effectPasses: new Map([
            [firstKey, { draw() { trace.push('first'); } }],
            [secondKey, {
                draw() {
                    trace.push(shouldThrow ? 'second:throw' : 'second:ok');
                    if (shouldThrow) {
                        shouldThrow = false;
                        throw error;
                    }
                }
            }]
        ])
    });

    assert.strictEqual(captureThrown(() => renderer.flush()), error);
    assert.deepEqual(trace, ['first', 'second:throw']);
    assert.equal(queue.length, 2);

    assert.equal(renderer.flush(), undefined);
    assert.deepEqual(trace, ['first', 'second:throw', 'first', 'second:ok']);
    assert.equal(queue.length, 0);
});

test('live queue index, loop length, and clear failures keep their exact partial state', () => {
    {
        const error = Object.freeze({ stage: 'index read' });
        const backing = [{ effectType: 'unused' }];
        const commands = new Proxy(backing, {
            get(target, property, receiver) {
                if (property === '0') {
                    throw error;
                }
                return Reflect.get(target, property, receiver);
            }
        });
        const renderer = createBareRenderer({ commands });
        assert.strictEqual(captureThrown(() => renderer.flush()), error);
        assert.equal(backing.length, 1);
    }

    {
        const error = Object.freeze({ stage: 'next loop length' });
        const key = {};
        const backing = [{ effectType: key }];
        let lengthReads = 0;
        let drawCalls = 0;
        const commands = new Proxy(backing, {
            get(target, property, receiver) {
                if (property === 'length') {
                    lengthReads += 1;
                    if (lengthReads === 3) {
                        throw error;
                    }
                }
                return Reflect.get(target, property, receiver);
            }
        });
        const renderer = createBareRenderer({
            commands,
            effectPasses: new Map([[key, { draw() { drawCalls += 1; } }]])
        });
        assert.strictEqual(captureThrown(() => renderer.flush()), error);
        assert.equal(drawCalls, 1);
        assert.equal(backing.length, 1);
    }

    {
        const error = Object.freeze({ stage: 'final clear' });
        const key = {};
        const backing = [{ effectType: key }];
        let drawCalls = 0;
        const commands = new Proxy(backing, {
            set(target, property, value, receiver) {
                if (property === 'length' && value === 0) {
                    throw error;
                }
                return Reflect.set(target, property, value, receiver);
            }
        });
        const renderer = createBareRenderer({
            commands,
            effectPasses: new Map([[key, { draw() { drawCalls += 1; } }]])
        });
        assert.strictEqual(captureThrown(() => renderer.flush()), error);
        assert.equal(drawCalls, 1);
        assert.equal(backing.length, 1);
    }

    for (const isGuardClear of [false, true]) {
        const key = {};
        const queue = [
            { effectType: key, id: 0 },
            { effectType: key, id: 1 },
            { effectType: key, id: 2 }
        ];
        Object.defineProperty(queue, '1', {
            configurable: false,
            enumerable: true,
            writable: true,
            value: queue[1]
        });
        let drawCalls = 0;
        const renderer = createBareRenderer({
            commands: queue,
            width: isGuardClear ? 0 : 16,
            effectPasses: new Map([[key, { draw() { drawCalls += 1; } }]])
        });

        const thrown = captureThrown(() => renderer.flush());
        assert.equal(thrown?.name, 'TypeError');
        assert.equal(drawCalls, isGuardClear ? 0 : 3);
        assert.equal(queue.length, 2, 'failed length shrink must preserve the language-defined partial length');
        assert.equal(Object.hasOwn(queue, 2), false, 'higher configurable element is deleted before index 1 blocks shrink');
    }
});

test('non-callable registry and second draw values throw at their exact stages', () => {
    {
        const queue = [{ effectType: 'key' }];
        const renderer = createBareRenderer({ commands: queue, effectPasses: { get: 0 } });
        const thrown = captureThrown(() => renderer.flush());
        assert.equal(thrown?.name, 'TypeError');
        assert.equal(queue.length, 1);
    }

    {
        const key = {};
        const queue = [{ effectType: key }];
        let drawReads = 0;
        let widthReads = 0;
        let heightReads = 0;
        const effectPass = {};
        Object.defineProperty(effectPass, 'draw', {
            get() {
                drawReads += 1;
                return drawReads === 1 ? function checkedDraw() {} : 0;
            }
        });
        const renderer = createBareRenderer({
            commands: queue,
            effectPasses: new Map([[key, effectPass]])
        });
        Object.defineProperties(renderer, {
            width: {
                get() {
                    widthReads += 1;
                    return 16;
                }
            },
            height: {
                get() {
                    heightReads += 1;
                    return 9;
                }
            }
        });

        const thrown = captureThrown(() => renderer.flush());
        assert.equal(thrown?.name, 'TypeError');
        assert.equal(drawReads, 2);
        assert.equal(widthReads, 2, 'call arguments are evaluated before non-callable rejection');
        assert.equal(heightReads, 2, 'call arguments are evaluated before non-callable rejection');
        assert.equal(queue.length, 1);
    }
});
