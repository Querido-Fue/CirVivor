import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GAME_ROOT = fileURLToPath(new URL('../project/game/', import.meta.url));
const SCRIPT_ROOT = path.join(GAME_ROOT, 'script');
const ALIAS_ROOTS = Object.freeze({
    'animation/': path.join(SCRIPT_ROOT, 'module', 'animation'),
    'data/': path.join(SCRIPT_ROOT, 'data'),
    'debug/': path.join(SCRIPT_ROOT, 'module', 'debug'),
    'display/': path.join(SCRIPT_ROOT, 'module', 'display'),
    'game/': SCRIPT_ROOT,
    'input/': path.join(SCRIPT_ROOT, 'module', 'input'),
    'object/': path.join(SCRIPT_ROOT, 'module', 'object'),
    'overlay/': path.join(SCRIPT_ROOT, 'module', 'overlay'),
    'physics/': path.join(SCRIPT_ROOT, 'module', 'physics'),
    'save/': path.join(SCRIPT_ROOT, 'module', 'save'),
    'scene/': path.join(SCRIPT_ROOT, 'module', 'scene'),
    'simulation/': path.join(SCRIPT_ROOT, 'module', 'simulation'),
    'sound/': path.join(SCRIPT_ROOT, 'module', 'sound'),
    'ui/': path.join(SCRIPT_ROOT, 'module', 'ui'),
    'util/': path.join(SCRIPT_ROOT, 'util')
});

const LEGACY_BEGIN_PHASE = 'legacy-begin';
const CANDIDATE_BEGIN_PHASE = 'candidate-begin';
const LEGACY_BEGIN_CALL_NAMES = Object.freeze([
    'bindFramebuffer',
    'enable',
    'blendFunc',
    'useProgram',
    'uniform2f',
    'bindBuffer',
    'bindBuffer',
    'enableVertexAttribArray',
    'vertexAttribPointer',
    'enableVertexAttribArray',
    'vertexAttribPointer',
    'enableVertexAttribArray',
    'vertexAttribPointer'
]);
const LEGACY_SHAPE_ATLAS_PAGE_ZERO_ORDER = Object.freeze([
    'rect',
    'square',
    'circle',
    'triangle',
    'pentagon',
    'hexagon',
    'octagon',
    'arrow',
    'enemy_square',
    'enemy_triangle',
    'enemy_arrow',
    'enemy_hexa',
    'enemy_penta',
    'enemy_rhom',
    'enemy_octa',
    'enemy_gen'
]);

/**
 * ShapeTextureCache가 atlas를 만들 때 사용할 최소 DOM 대역을 생성합니다.
 * @returns {{createElement: (tagName:string)=>object}} 테스트 document입니다.
 */
function createTestDocument() {
    let canvasSerial = 0;
    return {
        createElement(tagName) {
            if (tagName !== 'canvas') {
                throw new Error(`지원하지 않는 테스트 요소입니다: ${tagName}`);
            }

            const context = {
                globalAlpha: 1,
                fillStyle: '#000000',
                clearRect() {},
                fillRect() {},
                beginPath() {},
                arc() {},
                moveTo() {},
                lineTo() {},
                closePath() {},
                fill() {},
                stroke() {},
                save() {},
                restore() {},
                translate() {},
                scale() {},
                setLineDash() {}
            };
            return {
                __traceValue: `atlas-canvas-${++canvasSerial}`,
                width: 0,
                height: 0,
                getContext(type) {
                    return type === '2d' ? context : null;
                }
            };
        }
    };
}

/**
 * enemy shape atlas 생성에 필요한 Path2D 최소 대역입니다.
 */
class TestPath2D {
    constructor(pathData = '') {
        this.pathData = pathData;
    }
}

const moduleContext = vm.createContext({
    console,
    document: createTestDocument(),
    Path2D: TestPath2D
});
const moduleCache = new Map();

/**
 * importmap 별칭 또는 상대 경로를 실제 게임 모듈 URL로 변환합니다.
 * @param {string} specifier - import specifier입니다.
 * @param {string} parentUrl - 요청한 모듈 URL입니다.
 * @returns {string} 해석한 파일 URL입니다.
 */
function resolveModuleUrl(specifier, parentUrl) {
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
        return new URL(specifier, parentUrl).href;
    }

    for (const [prefix, root] of Object.entries(ALIAS_ROOTS)) {
        if (specifier.startsWith(prefix)) {
            return pathToFileURL(path.join(root, specifier.slice(prefix.length))).href;
        }
    }

    throw new Error(`지원하지 않는 테스트 모듈 경로입니다: ${specifier}`);
}

/**
 * DOM 대역이 설치된 vm context에 프로덕션 ESM을 생성합니다.
 * @param {string} moduleUrl - 대상 파일 URL입니다.
 * @returns {Promise<vm.SourceTextModule>} 생성된 모듈입니다.
 */
async function createModuleByUrl(moduleUrl) {
    const source = await readFile(fileURLToPath(moduleUrl), 'utf8');
    return new vm.SourceTextModule(source, {
        context: moduleContext,
        identifier: moduleUrl,
        initializeImportMeta(meta) {
            meta.url = moduleUrl;
        }
    });
}

/**
 * 동일 URL의 프로덕션 모듈 생성 Promise를 재사용합니다.
 * @param {string} moduleUrl - 대상 파일 URL입니다.
 * @returns {Promise<vm.SourceTextModule>} 캐시된 모듈 Promise입니다.
 */
function getModuleByUrl(moduleUrl) {
    if (!moduleCache.has(moduleUrl)) {
        moduleCache.set(moduleUrl, createModuleByUrl(moduleUrl));
    }
    return moduleCache.get(moduleUrl);
}

/**
 * importmap 경로의 실제 게임 모듈 그래프를 링크하고 평가합니다.
 * @param {string} specifier - 게임 importmap 기준 경로입니다.
 * @returns {Promise<object>} 모듈 namespace입니다.
 */
async function loadGameModule(specifier) {
    const parentUrl = pathToFileURL(path.join(GAME_ROOT, 'index.html')).href;
    const moduleUrl = resolveModuleUrl(specifier, parentUrl);
    const module = await getModuleByUrl(moduleUrl);
    if (module.status === 'unlinked') {
        await module.link((childSpecifier, referencingModule) => {
            return getModuleByUrl(resolveModuleUrl(childSpecifier, referencingModule.identifier));
        });
    }
    if (module.status === 'linked') {
        await module.evaluate();
    }
    return module.namespace;
}

const { ColorUtil } = await loadGameModule('util/color_util.js');
new ColorUtil();
const { WebGLBatch } = await loadGameModule('display/webgl/_webgl_batch.js');

/**
 * trace에 저장할 GL handle을 결정적인 문자열로 변환합니다.
 * @param {object|null|undefined} handle - fake GL handle입니다.
 * @returns {string|null} 정규화한 handle입니다.
 */
function formatHandle(handle) {
    if (handle == null) {
        return null;
    }
    if (handle.__uniform === true) {
        return `uniform:${handle.name}@${formatHandle(handle.program)}`;
    }
    if (handle.__glHandle === true) {
        return `${handle.kind}#${handle.id}`;
    }
    if (typeof handle.__traceValue === 'string') {
        return handle.__traceValue;
    }
    return String(handle);
}

/**
 * 텍스처 업로드 인자를 realm과 객체 identity에 무관한 값으로 정규화합니다.
 * @param {*} value - 원본 인자입니다.
 * @returns {*} trace용 값입니다.
 */
function normalizeTraceValue(value) {
    if (value == null || typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
        return value;
    }
    if (value.__glHandle === true || value.__uniform === true || typeof value.__traceValue === 'string') {
        return formatHandle(value);
    }
    if (ArrayBuffer.isView(value)) {
        const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        return {
            type: value.constructor.name,
            bytes: Array.from(bytes)
        };
    }
    if (Array.isArray(value)) {
        return value.map(normalizeTraceValue);
    }
    if (value.complete === true && Number.isFinite(value.naturalWidth)) {
        return {
            type: 'ready-image',
            naturalWidth: value.naturalWidth,
            naturalHeight: value.naturalHeight
        };
    }
    return Object.fromEntries(
        Object.entries(value)
            .filter(([, entryValue]) => typeof entryValue !== 'function')
            .map(([key, entryValue]) => [key, normalizeTraceValue(entryValue)])
    );
}

/**
 * WebGLBatch의 호출 순서와 draw 시점 상태를 기록하는 fake WebGL context를 만듭니다.
 * @returns {object} fake WebGL context입니다.
 */
function createTraceGl() {
    const handleSerials = new Map();
    const enabledCaps = new Set();
    const uniformValues = new Map();
    const attributeStates = new Map();
    const textureBindings = new Map();
    let trace = [];
    let tracePhase = null;
    let boundFramebuffer = null;
    let currentProgram = null;
    let arrayBuffer = null;
    let elementArrayBuffer = null;
    let blendSource = null;
    let blendDestination = null;
    let activeTextureUnit = 0x84C0;

    const createHandle = (kind) => {
        const nextId = (handleSerials.get(kind) || 0) + 1;
        handleSerials.set(kind, nextId);
        return { __glHandle: true, kind, id: nextId };
    };
    const addTrace = (call) => {
        trace.push(tracePhase ? { phase: tracePhase, ...call } : call);
    };
    const getTextureBindingKey = (unit, target) => `${unit}:${target}`;
    const snapshotDrawState = () => ({
        framebuffer: formatHandle(boundFramebuffer),
        enabledCaps: [...enabledCaps].sort((left, right) => left - right),
        blendFunc: [blendSource, blendDestination],
        program: formatHandle(currentProgram),
        uniforms: [...uniformValues.entries()]
            .map(([location, value]) => [formatHandle(location), value])
            .sort(([left], [right]) => left.localeCompare(right)),
        arrayBuffer: formatHandle(arrayBuffer),
        elementArrayBuffer: formatHandle(elementArrayBuffer),
        attributes: [...attributeStates.entries()]
            .map(([index, state]) => ({
                index,
                enabled: state.enabled === true,
                pointer: state.pointer
                    ? { ...state.pointer, buffer: formatHandle(state.pointer.buffer) }
                    : null
            }))
            .sort((left, right) => left.index - right.index),
        activeTexture: activeTextureUnit,
        textureBindings: [...textureBindings.entries()]
            .map(([key, texture]) => [key, formatHandle(texture)])
            .sort(([left], [right]) => left.localeCompare(right))
    });

    const gl = {
        ARRAY_BUFFER: 0x8892,
        ELEMENT_ARRAY_BUFFER: 0x8893,
        DYNAMIC_DRAW: 0x88E8,
        STATIC_DRAW: 0x88E4,
        VERTEX_SHADER: 0x8B31,
        FRAGMENT_SHADER: 0x8B30,
        COMPILE_STATUS: 0x8B81,
        LINK_STATUS: 0x8B82,
        TEXTURE_2D: 0x0DE1,
        TEXTURE_WRAP_S: 0x2802,
        TEXTURE_WRAP_T: 0x2803,
        TEXTURE_MIN_FILTER: 0x2801,
        TEXTURE_MAG_FILTER: 0x2800,
        CLAMP_TO_EDGE: 0x812F,
        LINEAR: 0x2601,
        RGBA: 0x1908,
        UNSIGNED_BYTE: 0x1401,
        FRAMEBUFFER: 0x8D40,
        BLEND: 0x0BE2,
        ZERO: 0,
        ONE: 1,
        ONE_MINUS_SRC_ALPHA: 0x0303,
        FLOAT: 0x1406,
        TRIANGLES: 0x0004,
        UNSIGNED_SHORT: 0x1403,
        TEXTURE0: 0x84C0,

        __getTrace() {
            return trace;
        },
        __resetTrace() {
            trace = [];
        },
        __truncateTrace(length) {
            trace.length = length;
        },
        __withTracePhase(phase, callback) {
            const previousPhase = tracePhase;
            tracePhase = phase;
            try {
                callback();
            } finally {
                tracePhase = previousPhase;
            }
        },
        __makeHandle(kind) {
            return createHandle(kind);
        },

        createShader(type) {
            const shader = createHandle('shader');
            addTrace({ name: 'createShader', type, shader: formatHandle(shader) });
            return shader;
        },
        shaderSource(shader, source) {
            addTrace({ name: 'shaderSource', shader: formatHandle(shader), source });
        },
        compileShader(shader) {
            addTrace({ name: 'compileShader', shader: formatHandle(shader) });
        },
        getShaderParameter() {
            return true;
        },
        getShaderInfoLog() {
            return '';
        },
        deleteShader(shader) {
            addTrace({ name: 'deleteShader', shader: formatHandle(shader) });
        },
        createProgram() {
            const program = createHandle('program');
            addTrace({ name: 'createProgram', program: formatHandle(program) });
            return program;
        },
        attachShader(program, shader) {
            addTrace({
                name: 'attachShader',
                program: formatHandle(program),
                shader: formatHandle(shader)
            });
        },
        linkProgram(program) {
            addTrace({ name: 'linkProgram', program: formatHandle(program) });
        },
        getProgramParameter() {
            return true;
        },
        getProgramInfoLog() {
            return '';
        },
        deleteProgram(program) {
            addTrace({ name: 'deleteProgram', program: formatHandle(program) });
        },
        createBuffer() {
            const buffer = createHandle('buffer');
            addTrace({ name: 'createBuffer', buffer: formatHandle(buffer) });
            return buffer;
        },
        bindBuffer(target, buffer) {
            if (target === gl.ARRAY_BUFFER) {
                arrayBuffer = buffer;
            } else if (target === gl.ELEMENT_ARRAY_BUFFER) {
                elementArrayBuffer = buffer;
            }
            addTrace({ name: 'bindBuffer', target, buffer: formatHandle(buffer) });
        },
        bufferData(target, data, usage) {
            addTrace({
                name: 'bufferData',
                target,
                data: normalizeTraceValue(data),
                usage
            });
        },
        bufferSubData(target, offset, data) {
            const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
            addTrace({
                name: 'bufferSubData',
                target,
                offset,
                buffer: formatHandle(arrayBuffer),
                floatValues: Array.from(data),
                rawBytes: Array.from(bytes)
            });
        },
        getAttribLocation(_program, name) {
            return { a_position: 0, a_texCoord: 1, a_color: 2 }[name] ?? -1;
        },
        getUniformLocation(program, name) {
            return { __uniform: true, program, name };
        },
        createTexture() {
            const texture = createHandle('texture');
            addTrace({ name: 'createTexture', texture: formatHandle(texture) });
            return texture;
        },
        activeTexture(unit) {
            activeTextureUnit = unit;
            addTrace({ name: 'activeTexture', unit });
        },
        bindTexture(target, texture) {
            textureBindings.set(getTextureBindingKey(activeTextureUnit, target), texture);
            addTrace({
                name: 'bindTexture',
                unit: activeTextureUnit,
                target,
                texture: formatHandle(texture)
            });
        },
        texParameteri(target, parameter, value) {
            addTrace({ name: 'texParameteri', target, parameter, value });
        },
        texImage2D(...args) {
            addTrace({ name: 'texImage2D', args: args.map(normalizeTraceValue) });
        },
        bindFramebuffer(target, framebuffer) {
            boundFramebuffer = framebuffer;
            addTrace({
                name: 'bindFramebuffer',
                target,
                framebuffer: formatHandle(framebuffer)
            });
        },
        enable(capability) {
            enabledCaps.add(capability);
            addTrace({ name: 'enable', capability });
        },
        disable(capability) {
            enabledCaps.delete(capability);
            addTrace({ name: 'disable', capability });
        },
        blendFunc(source, destination) {
            blendSource = source;
            blendDestination = destination;
            addTrace({ name: 'blendFunc', source, destination });
        },
        useProgram(program) {
            currentProgram = program;
            addTrace({ name: 'useProgram', program: formatHandle(program) });
        },
        uniform2f(location, first, second) {
            uniformValues.set(location, [first, second]);
            addTrace({
                name: 'uniform2f',
                location: formatHandle(location),
                first,
                second
            });
        },
        uniform1i(location, value) {
            uniformValues.set(location, [value]);
            addTrace({ name: 'uniform1i', location: formatHandle(location), value });
        },
        enableVertexAttribArray(index) {
            const state = attributeStates.get(index) || {};
            state.enabled = true;
            attributeStates.set(index, state);
            addTrace({ name: 'enableVertexAttribArray', index });
        },
        disableVertexAttribArray(index) {
            const state = attributeStates.get(index) || {};
            state.enabled = false;
            attributeStates.set(index, state);
            addTrace({ name: 'disableVertexAttribArray', index });
        },
        vertexAttribPointer(index, size, type, normalized, stride, offset) {
            const state = attributeStates.get(index) || {};
            state.pointer = {
                size,
                type,
                normalized,
                stride,
                offset,
                buffer: arrayBuffer
            };
            attributeStates.set(index, state);
            addTrace({
                name: 'vertexAttribPointer',
                index,
                size,
                type,
                normalized,
                stride,
                offset,
                buffer: formatHandle(arrayBuffer)
            });
        },
        drawElements(mode, count, type, offset) {
            addTrace({
                name: 'drawElements',
                mode,
                count,
                type,
                offset,
                state: snapshotDrawState()
            });
        }
    };

    return gl;
}

/**
 * 숫자를 WebGL vertex buffer가 사용하는 Float32 bit pattern으로 변환합니다.
 * @param {number} value - 변환할 숫자입니다.
 * @returns {number} uint32 bit pattern입니다.
 */
function getFloat32Bits(value) {
    const buffer = new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT);
    new Float32Array(buffer)[0] = value;
    return new Uint32Array(buffer)[0];
}

test('shape atlas는 legacy 16칸 UV를 page 0에 보존하고 J를 overflow page에 둔다', () => {
    const gl = createTraceGl();
    const batch = new WebGLBatch(gl);
    const cache = batch.shapeCache;
    const size = 96;
    const pageWidth = size * 16;
    const halfTexelU = 0.5 / pageWidth;
    const halfTexelV = 0.5 / size;

    assert.deepEqual(Array.from(cache.shapeOrder.slice(0, 16)), LEGACY_SHAPE_ATLAS_PAGE_ZERO_ORDER);
    assert.equal(cache.shapeOrder[16], 'enemy_jorang');
    assert.equal(cache.atlasCanvases.length, 2);
    assert.ok(cache.atlasCanvases.every((canvas) => canvas.width === pageWidth));
    assert.ok(cache.atlasCanvases.every((canvas) => canvas.height === size));
    assert.equal(cache.atlasCanvas, cache.atlasCanvases[0]);
    assert.equal(cache.atlasContext, cache.atlasContexts[0]);

    const legacyTexture = cache.getTextureInfo('rect').texture;
    for (let index = 0; index < LEGACY_SHAPE_ATLAS_PAGE_ZERO_ORDER.length; index++) {
        const shape = LEGACY_SHAPE_ATLAS_PAGE_ZERO_ORDER[index];
        const textureInfo = cache.getTextureInfo(shape);
        const offsetX = index * size;
        assert.equal(textureInfo.texture, legacyTexture, `${shape} texture page가 달라졌습니다.`);
        assert.equal(
            getFloat32Bits(textureInfo.u0),
            getFloat32Bits((offsetX / pageWidth) + halfTexelU),
            `${shape} u0 Float32 ABI가 달라졌습니다.`
        );
        assert.equal(
            getFloat32Bits(textureInfo.u1),
            getFloat32Bits(((offsetX + size) / pageWidth) - halfTexelU),
            `${shape} u1 Float32 ABI가 달라졌습니다.`
        );
        assert.equal(getFloat32Bits(textureInfo.v0), getFloat32Bits(halfTexelV));
        assert.equal(getFloat32Bits(textureInfo.v1), getFloat32Bits(1 - halfTexelV));
    }

    const jorangTextureInfo = cache.getTextureInfo('enemy_jorang');
    assert.notEqual(jorangTextureInfo.texture, legacyTexture);
    assert.equal(getFloat32Bits(jorangTextureInfo.u0), getFloat32Bits(halfTexelU));
    assert.equal(
        getFloat32Bits(jorangTextureInfo.u1),
        getFloat32Bits((size / pageWidth) - halfTexelU)
    );
    assert.equal(cache.getTextureInfo('unknown-shape'), cache.getTextureInfo('rect'));
});

test('legacy→overflow→legacy shape 전환은 texture page마다 정확히 flush한다', () => {
    const gl = createTraceGl();
    const batch = new WebGLBatch(gl);
    const legacyTexture = formatHandle(batch.shapeCache.getTextureInfo('rect').texture);
    const overflowTexture = formatHandle(batch.shapeCache.getTextureInfo('enemy_jorang').texture);
    gl.__resetTrace();

    batch.begin(320, 180);
    batch.render({ shape: 'rect', x: 20, y: 20, w: 10, h: 10 });
    batch.render({ shape: 'enemy_jorang', x: 40, y: 20, w: 10, h: 10 });
    batch.render({ shape: 'circle', x: 60, y: 20, w: 10, h: 10 });
    batch.flush();

    const trace = gl.__getTrace();
    assert.deepEqual(getCalls(trace, 'drawElements').map((call) => call.count), [6, 6, 6]);
    assert.deepEqual(
        getCalls(trace, 'bindTexture').map((call) => call.texture),
        [legacyTexture, overflowTexture, legacyTexture]
    );
});

/**
 * 변경 전 begin()이 수행하던 13개 GL 상태 호출을 oracle로 재현합니다.
 * @param {WebGLBatch} batch - 실제 프로덕션 batch입니다.
 */
function applyLegacyBeginRenderState(batch) {
    const gl = batch.gl;
    const stride = batch.vertexSize * Float32Array.BYTES_PER_ELEMENT;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(batch.program);
    gl.uniform2f(batch.uResolution, batch.frameWidth, batch.frameHeight);
    gl.bindBuffer(gl.ARRAY_BUFFER, batch.positionBuffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, batch.indexBuffer);
    gl.enableVertexAttribArray(batch.aPosition);
    gl.vertexAttribPointer(batch.aPosition, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(batch.aTexCoord);
    gl.vertexAttribPointer(batch.aTexCoord, 2, gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT);
    gl.enableVertexAttribArray(batch.aColor);
    gl.vertexAttribPointer(batch.aColor, 4, gl.FLOAT, false, stride, 4 * Float32Array.BYTES_PER_ELEMENT);
}

/**
 * ready image texture 경로에 사용할 결정적 이미지 대역을 생성합니다.
 * @returns {object} 이미지 대역입니다.
 */
function createReadyImage() {
    return {
        __traceValue: 'ready-image-2x2',
        complete: true,
        naturalWidth: 2,
        naturalHeight: 2
    };
}

/**
 * oracle 또는 후보 모드로 하나의 렌더 시나리오를 실행합니다.
 * oracle 모드에서는 생산 begin의 현재 GL 호출을 버리고 legacy 블록 하나만 재현합니다.
 * @param {(context:object)=>void} scenario - 실행할 렌더 시나리오입니다.
 * @param {boolean} useLegacyOracle - legacy oracle 사용 여부입니다.
 * @returns {{trace:object[],legacyBlocks:object[][]}} 실행 결과입니다.
 */
function runScenario(scenario, useLegacyOracle) {
    const gl = createTraceGl();
    const batch = new WebGLBatch(gl);
    const legacyBlocks = [];
    gl.__resetTrace();

    const begin = (width, height) => {
        if (!useLegacyOracle) {
            gl.__withTracePhase(CANDIDATE_BEGIN_PHASE, () => {
                batch.begin(width, height);
            });
            return;
        }

        const traceLengthBeforeBegin = gl.__getTrace().length;
        batch.begin(width, height);
        gl.__truncateTrace(traceLengthBeforeBegin);
        const legacyBlockStart = gl.__getTrace().length;
        gl.__withTracePhase(LEGACY_BEGIN_PHASE, () => {
            applyLegacyBeginRenderState(batch);
        });
        legacyBlocks.push(gl.__getTrace().slice(legacyBlockStart));
    };

    scenario({ batch, begin, gl });
    return {
        trace: gl.__getTrace(),
        legacyBlocks
    };
}

/**
 * oracle trace에서 의도적으로 제거할 legacy begin 블록만 제외합니다.
 * @param {object[]} trace - oracle 전체 trace입니다.
 * @returns {object[]} 최적화 후 기대 trace입니다.
 */
function stripLegacyBeginCalls(trace) {
    return trace.filter((call) => call.phase !== LEGACY_BEGIN_PHASE);
}

/**
 * trace에서 특정 GL 호출만 반환합니다.
 * @param {object[]} trace - 전체 trace입니다.
 * @param {string} name - 찾을 호출 이름입니다.
 * @returns {object[]} 선택된 호출 목록입니다.
 */
function getCalls(trace, name) {
    return trace.filter((call) => call.name === name);
}

/**
 * legacy 블록 구조와 후보의 draw/upload 동일성을 먼저 확인한 뒤 전체 trace를 비교합니다.
 * @param {string} label - 시나리오 이름입니다.
 * @param {(context:object)=>void} scenario - 렌더 시나리오입니다.
 * @param {(trace:object[])=>void} [validateExpected] - 기대 trace 추가 검사입니다.
 */
function assertScenarioParity(label, scenario, validateExpected = () => {}) {
    const oracle = runScenario(scenario, true);
    const candidate = runScenario(scenario, false);

    assert.ok(oracle.legacyBlocks.length > 0, `${label}: legacy begin 블록이 없습니다.`);
    for (const block of oracle.legacyBlocks) {
        assert.deepEqual(
            block.map((call) => call.name),
            LEGACY_BEGIN_CALL_NAMES,
            `${label}: legacy begin 13-call 순서가 달라졌습니다.`
        );
    }

    const expectedTrace = stripLegacyBeginCalls(oracle.trace);
    validateExpected(expectedTrace);
    const candidateBeginCalls = candidate.trace.filter((call) => call.phase === CANDIDATE_BEGIN_PHASE);
    const candidateTraceWithoutBegin = candidate.trace.filter((call) => call.phase !== CANDIDATE_BEGIN_PHASE);
    assert.deepEqual(
        getCalls(candidateTraceWithoutBegin, 'drawElements'),
        getCalls(expectedTrace, 'drawElements'),
        `${label}: drawElements 시점 GL 상태가 다릅니다.`
    );
    assert.deepEqual(
        getCalls(candidateTraceWithoutBegin, 'bufferSubData'),
        getCalls(expectedTrace, 'bufferSubData'),
        `${label}: Float32 vertex 원시 바이트가 다릅니다.`
    );
    assert.deepEqual(
        candidateTraceWithoutBegin,
        expectedTrace,
        `${label}: legacy begin 블록 외 GL 호출 차이가 있습니다.`
    );
    assert.equal(
        candidateBeginCalls.length,
        0,
        `${label}: 후보 begin이 ${candidateBeginCalls.length}개 GL 호출을 남겼습니다: `
            + candidateBeginCalls.map((call) => call.name).join(', ')
    );
}

test('WebGLBatch.begin은 frame CPU 상태만 초기화하고 GL 호출을 만들지 않는다', () => {
    const gl = createTraceGl();
    const batch = new WebGLBatch(gl);
    batch.render({ shape: 'rect', x: 8, y: 9, w: 4, h: 6 });
    assert.equal(batch.spriteCount, 1);
    gl.__resetTrace();

    batch.begin(640, 360);

    assert.equal(batch.frameWidth, 640);
    assert.equal(batch.frameHeight, 360);
    assert.equal(batch.spriteCount, 0);
    assert.equal(batch.currentTexture, null);
    const beginTrace = gl.__getTrace();
    assert.equal(
        beginTrace.length,
        0,
        `후보 begin이 ${beginTrace.length}개 GL 호출을 남겼습니다: `
            + beginTrace.map((call) => call.name).join(', ')
    );
});

test('빈 frame은 legacy begin 블록 제거 외 호출 차이가 없다', () => {
    assertScenarioParity('empty-frame', ({ batch, begin }) => {
        begin(640, 360);
        batch.flush();
    }, (trace) => {
        assert.deepEqual(trace, []);
    });
});

test('shape/image/shape texture 전환의 trace와 vertex bytes가 정확히 같다', () => {
    assertScenarioParity('shape-image-shape', ({ batch, begin }) => {
        begin(640, 360);
        batch.render({
            shape: 'circle',
            x: 30.25,
            y: 40.5,
            radius: 12.75,
            rotation: 17,
            fill: '#336699',
            alpha: 0.625
        });
        batch.render({
            image: createReadyImage(),
            x: 72.5,
            y: 18.25,
            w: 33.5,
            h: 19.75,
            alpha: 0.5
        });
        batch.render({
            shape: 'hexagon',
            x: 140.5,
            y: 92.25,
            w: 27.5,
            h: 31.25,
            fill: 'rgba(200,40,10,0.75)'
        });
        batch.flush();
    }, (trace) => {
        const draws = getCalls(trace, 'drawElements');
        const uploads = getCalls(trace, 'bufferSubData');
        assert.deepEqual(draws.map((call) => call.count), [6, 6, 6]);
        assert.equal(uploads.length, 3);
        assert.ok(uploads.every((call) => call.rawBytes.length === 32 * Float32Array.BYTES_PER_ELEMENT));
    });
});

test('capacity 경계의 bulk instance flush trace와 vertex bytes가 정확히 같다', () => {
    assertScenarioParity('capacity-bulk', ({ batch, begin }) => {
        batch.maxSprites = 2;
        begin(512, 288);
        const writtenCount = batch.renderShapeInstances(
            {
                shape: 'triangle',
                w: 18,
                h: 22,
                rotationCos: Math.cos(Math.PI / 7),
                rotationSin: Math.sin(Math.PI / 7),
                fill: '#abcdef',
                alpha: 0.8
            },
            [
                { x: 0, y: 0 },
                null,
                { x: 1.25, y: -2.5 },
                { x: Number.NaN, y: 3 },
                { x: -4, y: 1.5 },
                { x: 8.5, y: 7.25 },
                { x: -9.5, y: -6.75 }
            ],
            220.5,
            130.25,
            3.5
        );
        assert.equal(writtenCount, 5);
        batch.flush();
    }, (trace) => {
        const draws = getCalls(trace, 'drawElements');
        const uploads = getCalls(trace, 'bufferSubData');
        assert.deepEqual(draws.map((call) => call.count), [12, 12, 6]);
        assert.deepEqual(uploads.map((call) => call.floatValues.length), [64, 64, 32]);
    });
});

test('shape instance cache miss와 동일 입력 cache hit은 비캐시 경로와 같은 vertex bytes를 제출한다', () => {
    const gl = createTraceGl();
    const batch = new WebGLBatch(gl);
    const options = {
        shape: 'hexagon',
        w: 18.5,
        h: 13.25,
        rotation: 21.5,
        fill: 'rgba(34,197,94,0.72)',
        alpha: 0.81
    };
    const localCenters = [
        { x: -1.5, y: 0.25 },
        { x: 0.5, y: -2.75 },
        { x: 3.25, y: 1.5 }
    ];
    const captureUpload = (cacheKey) => {
        gl.__resetTrace();
        batch.begin(640, 360);
        assert.equal(
            batch.renderShapeInstances(options, localCenters, 148.25, 93.5, 4.75, cacheKey),
            3
        );
        batch.flush();
        const uploads = getCalls(gl.__getTrace(), 'bufferSubData');
        assert.equal(uploads.length, 1);
        return uploads[0];
    };

    const uncached = captureUpload(null);
    const cacheKey = Object.freeze({ id: 'same-input' });
    const cacheMiss = captureUpload(cacheKey);
    const preparedRecord = batch.shapeInstanceVertexCache.get(cacheKey);
    const cacheHit = captureUpload(cacheKey);

    assert.equal(batch.shapeInstanceVertexCache.get(cacheKey), preparedRecord);
    assert.deepEqual(cacheMiss.floatValues, uncached.floatValues);
    assert.deepEqual(cacheMiss.rawBytes, uncached.rawBytes);
    assert.deepEqual(cacheHit.floatValues, uncached.floatValues);
    assert.deepEqual(cacheHit.rawBytes, uncached.rawBytes);
});

test('같은 shape instance cache key에서 fill과 origin이 바뀌면 새 vertex bytes를 제출한다', () => {
    const gl = createTraceGl();
    const batch = new WebGLBatch(gl);
    const localCenters = [
        { x: -2, y: -1 },
        { x: 1.5, y: 2.25 }
    ];
    const captureUpload = (options, originX, originY, cacheKey) => {
        gl.__resetTrace();
        batch.begin(640, 360);
        assert.equal(
            batch.renderShapeInstances(options, localCenters, originX, originY, 6, cacheKey),
            2
        );
        batch.flush();
        const uploads = getCalls(gl.__getTrace(), 'bufferSubData');
        assert.equal(uploads.length, 1);
        return uploads[0];
    };
    const initialOptions = {
        shape: 'triangle',
        w: 15,
        h: 19,
        rotation: -13,
        fill: '#f97316',
        alpha: 0.7
    };
    const changedOptions = { ...initialOptions, fill: '#38bdf8' };
    const cacheKey = Object.freeze({ id: 'rebuild-on-input-change' });

    const initial = captureUpload(initialOptions, 80, 55, cacheKey);
    const rebuilt = captureUpload(changedOptions, 124.5, 71.25, cacheKey);
    const uncachedChanged = captureUpload(changedOptions, 124.5, 71.25, null);

    assert.notDeepEqual(rebuilt.floatValues, initial.floatValues);
    assert.notDeepEqual(rebuilt.rawBytes, initial.rawBytes);
    assert.deepEqual(rebuilt.floatValues, uncachedChanged.floatValues);
    assert.deepEqual(rebuilt.rawBytes, uncachedChanged.rawBytes);
});

test('외부 GL 상태 오염 뒤 flush가 draw 상태를 정확히 복구한다', () => {
    assertScenarioParity('external-state-poison', ({ batch, begin, gl }) => {
        begin(960, 540);
        const externalFramebuffer = gl.__makeHandle('external-framebuffer');
        const externalProgram = gl.__makeHandle('external-program');
        const externalArrayBuffer = gl.__makeHandle('external-array-buffer');
        const externalElementBuffer = gl.__makeHandle('external-element-buffer');
        const externalTexture = gl.__makeHandle('external-texture');
        gl.bindFramebuffer(gl.FRAMEBUFFER, externalFramebuffer);
        gl.disable(gl.BLEND);
        gl.blendFunc(gl.ZERO, gl.ONE);
        gl.useProgram(externalProgram);
        gl.bindBuffer(gl.ARRAY_BUFFER, externalArrayBuffer);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, externalElementBuffer);
        gl.disableVertexAttribArray(batch.aPosition);
        gl.disableVertexAttribArray(batch.aTexCoord);
        gl.disableVertexAttribArray(batch.aColor);
        gl.activeTexture(gl.TEXTURE0 + 3);
        gl.bindTexture(gl.TEXTURE_2D, externalTexture);

        batch.render({
            shape: 'octagon',
            x: 480,
            y: 270,
            w: 80,
            h: 64,
            fill: '#fedcba'
        });
        batch.flush();
    }, (trace) => {
        const [draw] = getCalls(trace, 'drawElements');
        assert.ok(draw);
        assert.equal(draw.state.framebuffer, null);
        assert.ok(draw.state.enabledCaps.includes(0x0BE2));
        assert.deepEqual(draw.state.blendFunc, [1, 0x0303]);
        assert.equal(draw.state.program, 'program#1');
        assert.equal(draw.state.arrayBuffer, 'buffer#1');
        assert.equal(draw.state.elementArrayBuffer, 'buffer#2');
        assert.equal(draw.state.activeTexture, 0x84C0);
        assert.ok(draw.state.attributes.slice(0, 3).every((attribute) => attribute.enabled));
    });
});

test('resize begin은 이전 미제출 큐를 버리고 새 resolution과 한 sprite만 제출한다', () => {
    assertScenarioParity('resize-and-queue-reset', ({ batch, begin }) => {
        begin(320, 180);
        batch.render({
            shape: 'rect',
            x: 5,
            y: 7,
            w: 2,
            h: 4,
            fill: '#ff0000'
        });

        begin(801, 451);
        batch.render({
            shape: 'rect',
            x: 100,
            y: 90,
            w: 20,
            h: 10,
            fill: '#00ff00'
        });
        batch.flush();
    }, (trace) => {
        const draws = getCalls(trace, 'drawElements');
        const uploads = getCalls(trace, 'bufferSubData');
        assert.equal(draws.length, 1);
        assert.equal(draws[0].count, 6);
        assert.equal(uploads.length, 1);
        assert.deepEqual(
            uploads[0].floatValues.filter((_value, index) => index % 8 < 2),
            [90, 85, 110, 85, 110, 95, 90, 95]
        );
        const resolutionUniform = draws[0].state.uniforms.find(([name]) => name.startsWith('uniform:u_resolution@'));
        assert.deepEqual(resolutionUniform, ['uniform:u_resolution@program#1', [801, 451]]);
    });
});
