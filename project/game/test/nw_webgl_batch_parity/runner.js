import { WebGLBatch } from '../../script/module/display/webgl/_webgl_batch.js';
import { ColorUtil } from '../../script/util/color_util.js';

const statusElement = document.querySelector('#status');
const canvasHost = document.querySelector('#canvas-host');
const CHANNEL_NAMES = Object.freeze(['R', 'G', 'B', 'A']);
const CONTEXT_ATTRIBUTES = Object.freeze({
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
    failIfMajorPerformanceCaveat: false
});
const CLEAR_COLOR = Object.freeze([7 / 255, 11 / 255, 19 / 255, 0]);

const TEST_CASES = Object.freeze([
    Object.freeze({
        label: 'alpha-on-basic',
        alpha: true,
        width: 96,
        height: 72,
        actions: Object.freeze([
            renderAction({
                shape: 'rect',
                x: 28,
                y: 31,
                w: 31,
                h: 23,
                fill: '#f97316'
            }),
            renderAction({
                shape: 'circle',
                x: 59,
                y: 37,
                radius: 14,
                fill: 'rgba(34,197,94,0.8)',
                alpha: 0.75
            })
        ])
    }),
    Object.freeze({
        label: 'alpha-off-basic',
        alpha: false,
        width: 98,
        height: 74,
        actions: Object.freeze([
            renderAction({
                shape: 'square',
                x: 29,
                y: 27,
                w: 28,
                h: 28,
                fill: '#38bdf8'
            }),
            renderAction({
                shape: 'triangle',
                x: 62,
                y: 42,
                w: 37,
                h: 33,
                fill: 'rgba(244,63,94,0.65)',
                alpha: 0.6
            })
        ])
    }),
    Object.freeze({
        label: 'odd-resolution-fractional-transform',
        alpha: true,
        width: 101,
        height: 77,
        actions: Object.freeze([
            renderAction({
                shape: 'pentagon',
                x: 27.375,
                y: 31.625,
                w: 29.5,
                h: 24.25,
                rotation: 17.875,
                fill: '#a78bfa',
                alpha: 0.91
            }),
            renderAction({
                shape: 'arrow',
                x: 68.125,
                y: 42.375,
                w: 34.75,
                h: 27.5,
                rotation: -33.625,
                fill: 'rgba(250,204,21,0.72)',
                alpha: 0.67
            })
        ])
    }),
    Object.freeze({
        label: 'shape-overlap',
        alpha: true,
        width: 113,
        height: 79,
        actions: Object.freeze([
            renderAction({
                shape: 'rect',
                x: 54.5,
                y: 39.5,
                w: 66,
                h: 42,
                fill: 'rgba(239,68,68,0.82)',
                alpha: 0.72
            }),
            renderAction({
                shape: 'circle',
                x: 46.25,
                y: 39.75,
                radius: 23.5,
                fill: 'rgba(59,130,246,0.7)',
                alpha: 0.83
            }),
            renderAction({
                shape: 'hexagon',
                x: 68.75,
                y: 38.25,
                w: 45.5,
                h: 39.5,
                rotation: 21.5,
                fill: 'rgba(34,197,94,0.74)',
                alpha: 0.76
            })
        ])
    }),
    Object.freeze({
        label: 'capacity-auto-flush',
        alpha: true,
        width: 127,
        height: 83,
        maxSprites: 3,
        actions: Object.freeze([
            instanceAction(
                {
                    shape: 'hexagon',
                    w: 16.5,
                    h: 14.25,
                    rotation: 12.75,
                    fill: 'rgba(14,165,233,0.78)',
                    alpha: 0.82
                },
                Object.freeze([
                    Object.freeze({ x: -2, y: -1 }),
                    Object.freeze({ x: -1, y: -1 }),
                    Object.freeze({ x: 0, y: -1 }),
                    Object.freeze({ x: 1, y: -1 }),
                    Object.freeze({ x: 2, y: -1 }),
                    Object.freeze({ x: -1.5, y: 0.35 }),
                    Object.freeze({ x: -0.5, y: 0.35 }),
                    Object.freeze({ x: 0.5, y: 0.35 }),
                    Object.freeze({ x: 1.5, y: 0.35 })
                ]),
                63.5,
                43.25,
                17.125,
                9
            ),
            renderAction({
                shape: 'circle',
                x: 63.5,
                y: 43.25,
                radius: 11.25,
                fill: 'rgba(251,191,36,0.8)',
                alpha: 0.7
            })
        ])
    }),
    Object.freeze({
        label: 'external-state-pollution',
        alpha: true,
        width: 109,
        height: 75,
        polluteBeforeBegin: true,
        actions: Object.freeze([
            renderAction({
                shape: 'octagon',
                x: 35.25,
                y: 37.5,
                w: 42.5,
                h: 36.75,
                rotation: -14.5,
                fill: 'rgba(236,72,153,0.76)',
                alpha: 0.88
            }),
            renderAction({
                shape: 'triangle',
                x: 70.75,
                y: 38.125,
                w: 39.25,
                h: 34.5,
                rotation: 28.25,
                fill: 'rgba(45,212,191,0.7)',
                alpha: 0.79
            })
        ])
    })
]);

/**
 * 단건 WebGL batch render 명령을 만듭니다.
 * @param {object} options - production `WebGLBatch.render()` 옵션입니다.
 * @returns {{kind:'render', options:object}} 명령입니다.
 */
function renderAction(options) {
    return Object.freeze({ kind: 'render', options: Object.freeze(options) });
}

/**
 * bulk shape instance 명령을 만듭니다.
 * @param {object} options - 공통 shape 옵션입니다.
 * @param {Array<{x:number,y:number}>} localCenters - local center 목록입니다.
 * @param {number} originX - 월드 원점 X입니다.
 * @param {number} originY - 월드 원점 Y입니다.
 * @param {number} localScale - local center 배율입니다.
 * @param {number} expectedCount - 기록되어야 하는 sprite 수입니다.
 * @returns {object} 명령입니다.
 */
function instanceAction(options, localCenters, originX, originY, localScale, expectedCount) {
    return Object.freeze({
        kind: 'instances',
        options: Object.freeze(options),
        localCenters,
        originX,
        originY,
        localScale,
        expectedCount
    });
}

/**
 * WebGL 오류 코드를 읽기 쉬운 이름으로 변환합니다.
 * @param {WebGLRenderingContext} gl - 대상 컨텍스트입니다.
 * @param {number} errorCode - `getError()` 결과입니다.
 * @returns {string} 오류 이름입니다.
 */
function getGlErrorName(gl, errorCode) {
    const names = new Map([
        [gl.INVALID_ENUM, 'INVALID_ENUM'],
        [gl.INVALID_VALUE, 'INVALID_VALUE'],
        [gl.INVALID_OPERATION, 'INVALID_OPERATION'],
        [gl.INVALID_FRAMEBUFFER_OPERATION, 'INVALID_FRAMEBUFFER_OPERATION'],
        [gl.OUT_OF_MEMORY, 'OUT_OF_MEMORY'],
        [gl.CONTEXT_LOST_WEBGL, 'CONTEXT_LOST_WEBGL']
    ]);
    return names.get(errorCode) ?? `0x${errorCode.toString(16)}`;
}

/**
 * 대기 중인 WebGL 오류가 하나도 없는지 검사합니다.
 * @param {WebGLRenderingContext} gl - 대상 컨텍스트입니다.
 * @param {string} label - 오류 위치입니다.
 * @returns {void}
 */
function assertNoGlError(gl, label) {
    const errors = [];
    for (let index = 0; index < 32; index++) {
        const errorCode = gl.getError();
        if (errorCode === gl.NO_ERROR) break;
        errors.push(getGlErrorName(gl, errorCode));
    }
    if (errors.length > 0) {
        throw new Error(`${label}: WebGL 오류 ${errors.join(', ')}`);
    }
}

/**
 * 지정 alpha 속성의 테스트 컨텍스트와 production batch를 만듭니다.
 * @param {'reference'|'candidate'} role - 비교 역할입니다.
 * @param {boolean} alpha - default framebuffer alpha 사용 여부입니다.
 * @returns {object} 테스트 대상입니다.
 */
function createTarget(role, alpha) {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    canvas.dataset.role = role;
    canvas.dataset.alpha = String(alpha);
    canvasHost.appendChild(canvas);

    const gl = canvas.getContext('webgl', { ...CONTEXT_ATTRIBUTES, alpha });
    if (!gl) {
        throw new Error(`${role}/alpha=${alpha}: WebGL 1 컨텍스트 생성 실패`);
    }
    const actualAttributes = gl.getContextAttributes();
    if (!actualAttributes || actualAttributes.alpha !== alpha) {
        throw new Error(`${role}: 요청한 alpha=${alpha} 컨텍스트를 얻지 못했습니다.`);
    }

    const batch = new WebGLBatch(gl);
    if (
        !batch.program
        || !batch.positionBuffer
        || !batch.indexBuffer
        || batch.aPosition < 0
        || batch.aTexCoord < 0
        || batch.aColor < 0
        || !batch.uResolution
    ) {
        throw new Error(`${role}: legacy bind 재현에 필요한 production batch handle이 없습니다.`);
    }
    assertNoGlError(gl, `${role}/alpha=${alpha}/init`);

    return {
        role,
        alpha,
        canvas,
        gl,
        batch,
        defaultMaxSprites: batch.maxSprites,
        pollutionResources: null
    };
}

/**
 * 과거 `WebGLBatch.begin()`이 수행하던 13개 GL 상태 호출을 순서까지 그대로 재현합니다.
 * @param {WebGLBatch} batch - 기준 batch입니다.
 * @returns {number} 실행한 GL 호출 수입니다.
 */
function bindLegacyBeginRenderState(batch) {
    const gl = batch.gl;
    let callCount = 0;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null); callCount++;
    gl.enable(gl.BLEND); callCount++;
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); callCount++;
    gl.useProgram(batch.program); callCount++;
    gl.uniform2f(batch.uResolution, batch.frameWidth, batch.frameHeight); callCount++;
    gl.bindBuffer(gl.ARRAY_BUFFER, batch.positionBuffer); callCount++;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, batch.indexBuffer); callCount++;

    const stride = batch.vertexSize * Float32Array.BYTES_PER_ELEMENT;
    gl.enableVertexAttribArray(batch.aPosition); callCount++;
    gl.vertexAttribPointer(batch.aPosition, 2, gl.FLOAT, false, stride, 0); callCount++;
    gl.enableVertexAttribArray(batch.aTexCoord); callCount++;
    gl.vertexAttribPointer(
        batch.aTexCoord,
        2,
        gl.FLOAT,
        false,
        stride,
        2 * Float32Array.BYTES_PER_ELEMENT
    ); callCount++;
    gl.enableVertexAttribArray(batch.aColor); callCount++;
    gl.vertexAttribPointer(
        batch.aColor,
        4,
        gl.FLOAT,
        false,
        stride,
        4 * Float32Array.BYTES_PER_ELEMENT
    ); callCount++;

    return callCount;
}

/**
 * 과거 begin 경로를 production batch의 공개 상태에 재현합니다.
 * @param {WebGLBatch} batch - 기준 batch입니다.
 * @param {number} width - 프레임 너비입니다.
 * @param {number} height - 프레임 높이입니다.
 * @returns {void}
 */
function legacyBegin(batch, width, height) {
    batch.frameWidth = width;
    batch.frameHeight = height;
    const callCount = bindLegacyBeginRenderState(batch);
    if (callCount !== 13) {
        throw new Error(`legacy begin GL 호출 수 불일치: ${callCount}`);
    }
    batch.spriteCount = 0;
    batch.currentTexture = null;
}

/**
 * 테스트 default framebuffer를 결정적 clear 상태로 만듭니다.
 * @param {object} target - 테스트 대상입니다.
 * @param {number} width - drawing buffer 너비입니다.
 * @param {number} height - drawing buffer 높이입니다.
 * @returns {Uint8Array} clear 직후 RGBA 원시 바이트입니다.
 */
function prepareClearTarget(target, width, height) {
    const { canvas, gl } = target;
    canvas.width = width;
    canvas.height = height;
    if (gl.drawingBufferWidth !== width || gl.drawingBufferHeight !== height) {
        throw new Error(
            `${target.role}: drawing buffer ${gl.drawingBufferWidth}x${gl.drawingBufferHeight} `
            + `!= ${width}x${height}`
        );
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.colorMask(true, true, true, true);
    gl.clearColor(CLEAR_COLOR[0], CLEAR_COLOR[1], CLEAR_COLOR[2], CLEAR_COLOR[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.finish();
    assertNoGlError(gl, `${target.role}/clear`);
    return readPixels(target, width, height, 'clear-read');
}

/**
 * batch가 복구해야 하는 13-call 소유 상태와 texture unit을 외부 패스처럼 오염시킵니다.
 * @param {object} target - 테스트 대상입니다.
 * @returns {void}
 */
function polluteBatchRenderState(target) {
    const { gl, batch } = target;
    if (!target.pollutionResources) {
        const framebuffer = gl.createFramebuffer();
        const arrayBuffer = gl.createBuffer();
        const elementBuffer = gl.createBuffer();
        const texture = gl.createTexture();

        gl.bindBuffer(gl.ARRAY_BUFFER, arrayBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(32), gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elementBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2]), gl.STATIC_DRAW);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            1,
            1,
            0,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            new Uint8Array([255, 0, 255, 255])
        );
        target.pollutionResources = { framebuffer, arrayBuffer, elementBuffer, texture };
    }

    const resources = target.pollutionResources;
    gl.bindFramebuffer(gl.FRAMEBUFFER, resources.framebuffer);
    gl.disable(gl.BLEND);
    gl.blendFunc(gl.ZERO, gl.ONE);
    gl.useProgram(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, resources.arrayBuffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, resources.elementBuffer);
    gl.disableVertexAttribArray(batch.aPosition);
    gl.disableVertexAttribArray(batch.aTexCoord);
    gl.disableVertexAttribArray(batch.aColor);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, resources.texture);
    assertNoGlError(gl, `${target.role}/state-pollution`);
}

/**
 * 두 경로에 공통인 draw command를 실행합니다.
 * @param {WebGLBatch} batch - 대상 batch입니다.
 * @param {readonly object[]} actions - 동일 draw command 목록입니다.
 * @returns {void}
 */
function executeActions(batch, actions) {
    for (let index = 0; index < actions.length; index++) {
        const action = actions[index];
        if (action.kind === 'render') {
            batch.render(action.options);
            continue;
        }
        if (action.kind === 'instances') {
            const writtenCount = batch.renderShapeInstances(
                action.options,
                action.localCenters,
                action.originX,
                action.originY,
                action.localScale
            );
            if (writtenCount !== action.expectedCount) {
                throw new Error(
                    `bulk instance 기록 수 불일치: ${writtenCount} != ${action.expectedCount}`
                );
            }
            continue;
        }
        throw new Error(`알 수 없는 draw command: ${action.kind}`);
    }
}

/**
 * default framebuffer 전체를 RGBA 원시 바이트로 읽습니다.
 * @param {object} target - 테스트 대상입니다.
 * @param {number} width - 너비입니다.
 * @param {number} height - 높이입니다.
 * @param {string} phase - 오류 위치입니다.
 * @returns {Uint8Array} 픽셀 바이트입니다.
 */
function readPixels(target, width, height, phase) {
    const { gl } = target;
    if (gl.isContextLost()) {
        throw new Error(`${target.role}/${phase}: WebGL context lost`);
    }
    const pixels = new Uint8Array(width * height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    assertNoGlError(gl, `${target.role}/${phase}`);
    return pixels;
}

/**
 * 두 RGBA 결과를 모든 원시 바이트로 비교합니다.
 * @param {string} label - 케이스 이름입니다.
 * @param {Uint8Array} expected - 기준 바이트입니다.
 * @param {Uint8Array} actual - 후보 바이트입니다.
 * @param {number} width - 이미지 너비입니다.
 * @returns {void}
 */
function assertPixelByteParity(label, expected, actual, width) {
    if (expected.length !== actual.length) {
        throw new Error(`${label}: RGBA 길이 ${expected.length} != ${actual.length}`);
    }
    for (let byteIndex = 0; byteIndex < expected.length; byteIndex++) {
        if (expected[byteIndex] === actual[byteIndex]) continue;
        const pixelIndex = Math.floor(byteIndex / 4);
        const x = pixelIndex % width;
        const y = Math.floor(pixelIndex / width);
        const channel = CHANNEL_NAMES[byteIndex & 3];
        throw new Error(
            `${label}: (${x}, ${y}) ${channel} byte 불일치 `
            + `${expected[byteIndex]} != ${actual[byteIndex]}`
        );
    }
}

/**
 * draw 결과가 clear 화면과 실제로 달라졌는지 검사합니다.
 * @param {string} label - 케이스 이름입니다.
 * @param {Uint8Array} clearPixels - clear 직후 바이트입니다.
 * @param {Uint8Array} drawnPixels - draw 뒤 바이트입니다.
 * @returns {number} 변경된 픽셀 수입니다.
 */
function assertNonClearPixels(label, clearPixels, drawnPixels) {
    let changedPixelCount = 0;
    for (let byteIndex = 0; byteIndex < drawnPixels.length; byteIndex += 4) {
        if (
            drawnPixels[byteIndex] !== clearPixels[byteIndex]
            || drawnPixels[byteIndex + 1] !== clearPixels[byteIndex + 1]
            || drawnPixels[byteIndex + 2] !== clearPixels[byteIndex + 2]
            || drawnPixels[byteIndex + 3] !== clearPixels[byteIndex + 3]
        ) {
            changedPixelCount++;
        }
    }
    if (changedPixelCount === 0) {
        throw new Error(`${label}: 결과가 clear 화면과 완전히 같습니다.`);
    }
    return changedPixelCount;
}

/**
 * 결과 식별용 FNV-1a 해시를 계산합니다. 동일성 판정 자체는 전체 바이트 비교를 사용합니다.
 * @param {Uint8Array} bytes - 픽셀 바이트입니다.
 * @returns {string} 8자리 16진 해시입니다.
 */
function hashBytes(bytes) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < bytes.length; index++) {
        hash ^= bytes[index];
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

/**
 * 단일 픽셀 동일성 케이스를 실행합니다.
 * @param {object} testCase - 케이스 정의입니다.
 * @param {{reference:object,candidate:object}} pair - 같은 alpha 속성의 컨텍스트 쌍입니다.
 * @returns {object} 케이스 결과입니다.
 */
function runCase(testCase, pair) {
    const { width, height } = testCase;
    const referenceClear = prepareClearTarget(pair.reference, width, height);
    const candidateClear = prepareClearTarget(pair.candidate, width, height);
    assertPixelByteParity(`${testCase.label}/clear-control`, referenceClear, candidateClear, width);

    pair.reference.batch.maxSprites = testCase.maxSprites
        ?? pair.reference.defaultMaxSprites;
    pair.candidate.batch.maxSprites = testCase.maxSprites
        ?? pair.candidate.defaultMaxSprites;

    if (testCase.polluteBeforeBegin) {
        polluteBatchRenderState(pair.reference);
        polluteBatchRenderState(pair.candidate);
    }

    legacyBegin(pair.reference.batch, width, height);
    pair.candidate.batch.begin(width, height);
    assertNoGlError(pair.reference.gl, `${testCase.label}/reference-begin`);
    assertNoGlError(pair.candidate.gl, `${testCase.label}/candidate-begin`);

    executeActions(pair.reference.batch, testCase.actions);
    executeActions(pair.candidate.batch, testCase.actions);
    pair.reference.batch.flush();
    pair.candidate.batch.flush();
    pair.reference.gl.finish();
    pair.candidate.gl.finish();
    assertNoGlError(pair.reference.gl, `${testCase.label}/reference-flush`);
    assertNoGlError(pair.candidate.gl, `${testCase.label}/candidate-flush`);

    const referencePixels = readPixels(pair.reference, width, height, 'result-read');
    const candidatePixels = readPixels(pair.candidate, width, height, 'result-read');
    const referenceChangedPixels = assertNonClearPixels(
        `${testCase.label}/reference`,
        referenceClear,
        referencePixels
    );
    const candidateChangedPixels = assertNonClearPixels(
        `${testCase.label}/candidate`,
        candidateClear,
        candidatePixels
    );
    assertPixelByteParity(testCase.label, referencePixels, candidatePixels, width);
    if (referenceChangedPixels !== candidateChangedPixels) {
        throw new Error(
            `${testCase.label}: changed pixel 수 ${referenceChangedPixels} != ${candidateChangedPixels}`
        );
    }

    return {
        label: testCase.label,
        alpha: testCase.alpha,
        width,
        height,
        byteCount: referencePixels.length,
        changedPixelCount: referenceChangedPixels,
        hash: hashBytes(referencePixels)
    };
}

/**
 * 브라우저가 진행 상태를 표시할 기회를 제공합니다.
 * @returns {Promise<void>} 다음 animation frame 완료 Promise입니다.
 */
function yieldFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function run() {
    new ColorUtil();
    const pairs = new Map();
    const getPair = (alpha) => {
        if (!pairs.has(alpha)) {
            pairs.set(alpha, {
                reference: createTarget('reference', alpha),
                candidate: createTarget('candidate', alpha)
            });
        }
        return pairs.get(alpha);
    };

    const results = [];
    for (let index = 0; index < TEST_CASES.length; index++) {
        const testCase = TEST_CASES[index];
        statusElement.textContent = `${testCase.label} (${index + 1}/${TEST_CASES.length}) 실행 중…`;
        await yieldFrame();
        results.push(runCase(testCase, getPair(testCase.alpha)));
    }

    const totalBytes = results.reduce((sum, result) => sum + result.byteCount, 0);
    const totalChangedPixels = results.reduce(
        (sum, result) => sum + result.changedPixelCount,
        0
    );
    document.title = 'PASS — WebGL batch NW.js parity';
    statusElement.className = 'pass';
    statusElement.textContent = [
        'PASS',
        `동일성 케이스: ${results.length}`,
        `비교 단위: readPixels RGBA 전체 ${totalBytes.toLocaleString('en-US')}바이트`,
        `non-clear 픽셀 합계: ${totalChangedPixels.toLocaleString('en-US')}`,
        '기준: legacy begin 13-call bind 명시 재현',
        '후보: production WebGLBatch.begin()만 호출',
        ...results.map((result) => (
            `${result.label}: alpha=${result.alpha}, ${result.width}×${result.height}, `
            + `changed=${result.changedPixelCount}, fnv1a=${result.hash}`
        )),
        `엔진: ${navigator.userAgent}`
    ].join('\n');
}

run().catch((error) => {
    document.title = 'FAIL — WebGL batch NW.js parity';
    statusElement.className = 'fail';
    statusElement.textContent = `FAIL\n${error?.stack ?? error}`;
});
