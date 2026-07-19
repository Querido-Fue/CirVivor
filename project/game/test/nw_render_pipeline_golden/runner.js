import {
    DisplaySystem,
    render,
    renderGL
} from 'display/display_system.js';
import { getCurrentThemeKey } from 'display/_theme_handler.js';
import { OverlaySession } from 'overlay/_overlay_session.js';
import { SaveSystem, getSetting } from 'save/save_system.js';
import { buildTitleCenterCircleRenderCommand } from 'scene/title/center_circle/_title_center_circle_render_command.js';
import { ColorUtil } from 'util/color_util.js';
import { fsPromises, nw, path } from 'util/nw_bridge.js';

const { Buffer } = window.require('buffer');
const { createHash } = window.require('crypto');
const fsSync = window.require('fs');

const FIXTURE_WIDTH = 640;
const FIXTURE_HEIGHT = 360;
const FIXTURE_SEED = 0x719;
const FIXTURE_TIME_MS = 123_456;
const EXPECTED_NW_VERSION = '0.108.0';
const FONT_FAMILY = 'Pretendard Variable';
const FONT_SPEC = `400 18px "${FONT_FAMILY}"`;
const GOLDEN_SCHEMA_VERSION = 1;
const EVENT_TIMEOUT_MS = 10_000;
const CHANNEL_NAMES = Object.freeze(['R', 'G', 'B', 'A']);
const SESSION_OPTIONS = Object.freeze({
    layer: 1,
    dim: 0.24,
    transparent: true,
    glOverlay: true,
    blurUpdateMode: 'dirty',
    effects: Object.freeze({}),
    orderSequence: 1,
    disableTransparency: false
});
const FIXTURE_METADATA = Object.freeze({
    name: 'canonical-overlay-v1',
    width: FIXTURE_WIDTH,
    height: FIXTURE_HEIGHT,
    seed: FIXTURE_SEED,
    timeMs: FIXTURE_TIME_MS,
    dpr: 1,
    theme: 'dark',
    renderScale: 100,
    uiScale: 100,
    font: FONT_SPEC
});
const statusElement = document.querySelector('#harness-status');

/**
 * launcher 제한시간 실패 시 마지막 정상 단계를 확인할 수 있도록 임시 progress 파일을 갱신합니다.
 * @param {string} stage - 현재 실행 단계입니다.
 * @returns {void}
 */
function recordProgress(stage) {
    const resultPath = process.env.CIRVIVOR_RENDER_GOLDEN_RESULT_PATH;
    if (resultPath) {
        fsSync.writeFileSync(`${resultPath}.progress`, `${stage}\n`, 'utf8');
    }
}

/**
 * 조건이 거짓이면 렌더 하네스 오류를 발생시킵니다.
 * @param {*} condition - 검사할 값입니다.
 * @param {string} message - 실패 메시지입니다.
 * @returns {void}
 */
function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

/**
 * DisplaySystem의 production surface 초기화는 유지하면서 OS 화면 측정만 고정합니다.
 * @returns {object} 640×360 고정 screen adapter입니다.
 */
function createFixedScreenHandler() {
    return {
        width: FIXTURE_WIDTH,
        height: FIXTURE_HEIGHT,
        baseWidth: FIXTURE_WIDTH,
        baseHeight: FIXTURE_HEIGHT,
        objectHeight: FIXTURE_HEIGHT,
        objectOffsetY: 0,
        uiWidth: FIXTURE_WIDTH,
        uiOffsetX: 0,
        viewportMode: 'native16by9',
        cssWidth: FIXTURE_WIDTH,
        cssHeight: FIXTURE_HEIGHT,
        cssLeft: 0,
        cssTop: 0,
        scaleRatio: 1,
        async init() {},
        resize() {
            return false;
        }
    };
}

/**
 * fixture용 xorshift32 난수 생성기를 만듭니다.
 * @param {number} seed - 32비트 seed입니다.
 * @returns {() => number} 0 이상 1 미만의 결정적 난수 함수입니다.
 */
function createFixtureRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return (state >>> 0) / 0x100000000;
    };
}

/**
 * 다음 animation frame까지 기다립니다.
 * @returns {Promise<void>}
 */
function yieldFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * 지정 DOM 이벤트를 제한시간 안에 한 번 기다립니다.
 * @param {EventTarget} target - 이벤트 대상입니다.
 * @param {string} eventName - 이벤트 이름입니다.
 * @param {number} [timeoutMs=EVENT_TIMEOUT_MS] - 제한시간입니다.
 * @returns {Promise<Event>} 수신한 이벤트입니다.
 */
function waitForEvent(target, eventName, timeoutMs = EVENT_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const onEvent = (event) => {
            clearTimeout(timeoutId);
            resolve(event);
        };
        const timeoutId = setTimeout(() => {
            target.removeEventListener(eventName, onEvent);
            reject(new Error(`${eventName} 이벤트 제한시간 초과: ${timeoutMs}ms`));
        }, timeoutMs);
        target.addEventListener(eventName, onEvent, { once: true });
    });
}

/**
 * 고정 번들 폰트가 실제 사용 가능한 상태인지 확인합니다.
 * @returns {Promise<void>}
 */
async function ensureFixtureFont() {
    await document.fonts.load(FONT_SPEC, '픽셀 골든');
    await document.fonts.ready;
    assert(document.fonts.check(FONT_SPEC, '픽셀 골든'), `번들 폰트 로드 실패: ${FONT_SPEC}`);
}

/**
 * WebGL 오류 코드를 사람이 읽을 수 있는 이름으로 바꿉니다.
 * @param {WebGLRenderingContext} gl - 대상 컨텍스트입니다.
 * @param {number} errorCode - 오류 코드입니다.
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
 * 대기 중인 WebGL 오류가 없는지 검사합니다.
 * @param {WebGLRenderingContext} gl - 대상 컨텍스트입니다.
 * @param {string} label - 오류 위치입니다.
 * @returns {void}
 */
function assertNoGlError(gl, label) {
    const errors = [];
    for (let index = 0; index < 32; index++) {
        const errorCode = gl.getError();
        if (errorCode === gl.NO_ERROR) {
            break;
        }
        errors.push(getGlErrorName(gl, errorCode));
    }
    if (errors.length > 0) {
        throw new Error(`${label}: WebGL 오류 ${errors.join(', ')}`);
    }
}

/**
 * 바이트 배열의 SHA-256을 계산합니다.
 * @param {Uint8Array|Buffer|string} value - 해시 입력입니다.
 * @returns {string} 64자리 16진 SHA-256입니다.
 */
function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}

/**
 * 파일명에 안전한 profile 구성 문자열로 변환합니다.
 * @param {string} value - 원본 문자열입니다.
 * @returns {string} 정규화한 문자열입니다.
 */
function sanitizePathPart(value) {
    return String(value).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * WebGL profile과 context attributes를 직렬화 가능한 값으로 수집합니다.
 * @param {WebGLRenderingContext} gl - 대상 컨텍스트입니다.
 * @returns {object} 컨텍스트 설명입니다.
 */
function describeWebGLContext(gl) {
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const attributes = gl.getContextAttributes();
    return {
        vendor: gl.getParameter(gl.VENDOR),
        renderer: gl.getParameter(gl.RENDERER),
        version: gl.getParameter(gl.VERSION),
        shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
        unmaskedVendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : null,
        unmaskedRenderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : null,
        attributes: attributes ? {
            alpha: attributes.alpha,
            antialias: attributes.antialias,
            depth: attributes.depth,
            failIfMajorPerformanceCaveat: attributes.failIfMajorPerformanceCaveat,
            premultipliedAlpha: attributes.premultipliedAlpha,
            preserveDrawingBuffer: attributes.preserveDrawingBuffer,
            stencil: attributes.stencil
        } : null
    };
}

/**
 * 현재 승인 profile 식별에 사용할 런타임 정보를 만듭니다.
 * @param {DisplaySystem} displaySystem - 초기화된 디스플레이 시스템입니다.
 * @param {OverlaySession} session - 초기화된 overlay session입니다.
 * @returns {object} profile 정보입니다.
 */
function createRuntimeProfile(displaySystem, session) {
    const backgroundContext = displaySystem.getSurface('background')?.context;
    const overlayContext = displaySystem.getSurface(session.effectLayerId)?.context;
    assert(backgroundContext, 'background WebGL 컨텍스트가 없습니다.');
    assert(overlayContext, 'overlay effect WebGL 컨텍스트가 없습니다.');

    const profileBase = {
        platform: process.platform,
        arch: process.arch,
        nw: process.versions.nw,
        chromium: process.versions.chrome,
        node: process.versions.node,
        dpr: window.devicePixelRatio,
        backgroundContext: describeWebGLContext(backgroundContext),
        overlayContext: describeWebGLContext(overlayContext)
    };
    const fingerprint = sha256(Buffer.from(JSON.stringify(profileBase), 'utf8')).slice(0, 12);
    return {
        id: [
            sanitizePathPart(profileBase.platform),
            sanitizePathPart(profileBase.arch),
            `nw${sanitizePathPart(profileBase.nw)}`,
            `dpr${sanitizePathPart(profileBase.dpr)}`,
            fingerprint
        ].join('-'),
        ...profileBase
    };
}

/**
 * 1단계 harness가 지원하는 결정적 실행 조건인지 확인합니다.
 * @returns {void}
 */
function assertSupportedEnvironment() {
    assert(process.platform === 'win32', `1단계 golden은 Windows만 지원합니다: ${process.platform}`);
    assert(
        process.versions.nw === EXPECTED_NW_VERSION,
        `지원 NW.js 버전 ${EXPECTED_NW_VERSION} != ${process.versions.nw}`
    );
    assert(window.devicePixelRatio === 1, `devicePixelRatio 1 != ${window.devicePixelRatio}`);
    assert(window.innerWidth === FIXTURE_WIDTH, `innerWidth ${FIXTURE_WIDTH} != ${window.innerWidth}`);
    assert(window.innerHeight === FIXTURE_HEIGHT, `innerHeight ${FIXTURE_HEIGHT} != ${window.innerHeight}`);
    assert(getCurrentThemeKey() === 'dark', `theme dark != ${getCurrentThemeKey()}`);
    assert(getSetting('renderScale') === 100, `renderScale 100 != ${getSetting('renderScale')}`);
    assert(getSetting('uiScale') === 100, `uiScale 100 != ${getSetting('uiScale')}`);
}

/**
 * canonical overlay fixture를 실제 production 렌더 API로 그립니다.
 * @param {DisplaySystem} displaySystem - 디스플레이 시스템입니다.
 * @param {OverlaySession} session - overlay session입니다.
 * @returns {void}
 */
function renderFixture(displaySystem, session) {
    displaySystem.drawHandler.clearAll();
    displaySystem.webGLHandler.clearAll();

    const random = createFixtureRandom(FIXTURE_SEED);
    const timeRotation = (FIXTURE_TIME_MS % 360_000) / 1000;

    renderGL('backgroundGL', {
        shape: 'rect',
        x: FIXTURE_WIDTH / 2,
        y: FIXTURE_HEIGHT / 2,
        w: FIXTURE_WIDTH,
        h: FIXTURE_HEIGHT,
        fill: '#101827'
    });
    for (let index = 0; index < 12; index++) {
        renderGL('backgroundGL', {
            shape: 'circle',
            x: 24 + (random() * (FIXTURE_WIDTH - 48)),
            y: 20 + (random() * (FIXTURE_HEIGHT - 40)),
            radius: 1.5 + (random() * 2.5),
            fill: index % 2 === 0 ? '#38bdf8' : '#a78bfa',
            alpha: 0.42 + (random() * 0.38)
        });
    }

    renderGL('mainGL', {
        shape: 'hexagon',
        x: 176,
        y: 184,
        w: 112,
        h: 98,
        rotation: timeRotation,
        fill: 'rgba(14,165,233,0.86)',
        alpha: 0.9
    });
    renderGL('mainGL', {
        shape: 'circle',
        x: 438,
        y: 151,
        radius: 58,
        fill: 'rgba(244,63,94,0.78)',
        alpha: 0.84
    });
    renderGL('mainGL', {
        shape: 'triangle',
        x: 349,
        y: 267,
        w: 74,
        h: 66,
        rotation: -27.5,
        fill: 'rgba(250,204,21,0.76)',
        alpha: 0.8
    });
    renderGL('effectGL', buildTitleCenterCircleRenderCommand({
        centerX: 438,
        centerY: 151,
        radius: 70,
        outlineWidth: 4,
        glowPhase: FIXTURE_TIME_MS / 1000,
        glowCompensationScale: 1,
        blurSourceCanvases: [
            displaySystem.getSurface('background').canvas,
            displaySystem.getSurface('object').canvas
        ]
    }));

    render('texteffect', {
        shape: 'text',
        x: 24,
        y: 44,
        text: 'NW PIXEL GOLDEN',
        fill: 'rgba(125,211,252,0.82)',
        font: `600 18px "${FONT_FAMILY}"`,
        align: 'left',
        baseline: 'middle'
    });
    render('ui', {
        shape: 'roundRect',
        x: 22,
        y: 302,
        w: 212,
        h: 38,
        radius: 10,
        fill: 'rgba(15,23,42,0.88)',
        stroke: 'rgba(125,211,252,0.8)',
        lineWidth: 2
    });
    render('ui', {
        shape: 'text',
        x: 128,
        y: 321,
        text: 'seed 0x719 · t 123456',
        fill: '#e0f2fe',
        font: `500 15px "${FONT_FAMILY}"`,
        align: 'center',
        baseline: 'middle'
    });
    displaySystem.drawVignettes();

    displaySystem.webGLHandler.flushAll();
    session.invalidateBlur();
    session.renderDim();
    session.renderGlassPanel({
        x: 246,
        y: 76,
        w: 318,
        h: 206,
        radius: 22,
        blur: 10,
        alpha: 0.97,
        lineWidth: 1.5,
        fill: 'rgba(255,255,255,0.045)',
        stroke: 'rgba(255,255,255,0.48)',
        tintColor: 'rgba(59,130,246,1)',
        tintStrength: 0.12,
        edgeColor: 'rgba(255,255,255,0.85)',
        edgeStrength: 0.16,
        refractionStrength: 0.012,
        shadowRadius: 12,
        shadowOffsetX: 0,
        shadowOffsetY: 8,
        shadowColor: 'rgba(0,0,0,0.38)',
        sampleBackdrop: true
    });
    session.renderPanel({
        shape: 'roundRect',
        x: 270,
        y: 102,
        w: 270,
        h: 154,
        radius: 16,
        fill: 'rgba(15,23,42,0.22)',
        stroke: 'rgba(191,219,254,0.45)',
        lineWidth: 1
    });
    session.renderPanel({
        shape: 'text',
        x: 405,
        y: 151,
        text: '결정적 오버레이',
        fill: '#f8fafc',
        font: `650 24px "${FONT_FAMILY}"`,
        align: 'center',
        baseline: 'middle'
    });
    session.renderPanel({
        shape: 'text',
        x: 405,
        y: 198,
        text: '2D + WebGL + compositor',
        fill: 'rgba(219,234,254,0.92)',
        font: `450 16px "${FONT_FAMILY}"`,
        align: 'center',
        baseline: 'middle'
    });
    render('top', {
        shape: 'circle',
        x: 606,
        y: 326,
        radius: 12,
        fill: 'rgba(74,222,128,0.92)',
        stroke: '#dcfce7',
        lineWidth: 2
    });

    displaySystem.webGLHandler.flushAll();
    for (const [surfaceId, gl] of displaySystem.webGLHandler.glContexts.entries()) {
        if (displaySystem.webGLHandler.contextLostLayers.has(surfaceId)) {
            continue;
        }
        gl.finish();
        assertNoGlError(gl, `${surfaceId}/fixture-finish`);
    }
}

/**
 * 저장할 semantic role과 실제 surface descriptor를 연결합니다.
 * @param {DisplaySystem} displaySystem - 디스플레이 시스템입니다.
 * @param {OverlaySession} session - 현재 overlay session입니다.
 * @returns {Array<{role:string, descriptor:object}>} 캡처 목록입니다.
 */
function resolveCaptureSurfaces(displaySystem, session) {
    const definitions = [
        ['background', 'background'],
        ['object', 'object'],
        ['effect', 'effect'],
        ['texteffect', 'texteffect'],
        ['ui', 'ui'],
        ['vignette', 'vignette'],
        ['overlay.dim', session.dimLayerId],
        ['overlay.effect', session.effectLayerId],
        ['overlay.ui', session.uiLayerId],
        ['top', 'top']
    ];
    return definitions.map(([role, surfaceId]) => {
        const descriptor = displaySystem.getSurface(surfaceId);
        assert(descriptor, `${role} surface를 찾지 못했습니다: ${surfaceId}`);
        return { role, descriptor };
    });
}

/**
 * WebGL default framebuffer를 읽고 top-left 기준 RGBA로 뒤집습니다.
 * @param {object} descriptor - WebGL surface descriptor입니다.
 * @param {string} role - semantic role입니다.
 * @returns {Uint8Array} top-left RGBA 바이트입니다.
 */
function readWebGLSurface(descriptor, role) {
    const gl = descriptor.context;
    const width = descriptor.canvas.width;
    const height = descriptor.canvas.height;
    assert(gl && !gl.isContextLost(), `${role}: WebGL context lost`);
    assert(
        gl.drawingBufferWidth === width && gl.drawingBufferHeight === height,
        `${role}: drawing buffer ${gl.drawingBufferWidth}x${gl.drawingBufferHeight} != ${width}x${height}`
    );

    const bottomLeftPixels = new Uint8Array(width * height * 4);
    const topLeftPixels = new Uint8Array(bottomLeftPixels.length);
    const rowByteLength = width * 4;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.finish();
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomLeftPixels);
    assertNoGlError(gl, `${role}/readPixels`);

    for (let row = 0; row < height; row++) {
        const sourceStart = (height - row - 1) * rowByteLength;
        topLeftPixels.set(
            bottomLeftPixels.subarray(sourceStart, sourceStart + rowByteLength),
            row * rowByteLength
        );
    }
    return topLeftPixels;
}

/**
 * production 2D canvas의 래스터 backend를 readback 모드로 전환하지 않도록 별도 canvas에서 읽습니다.
 * @param {object} descriptor - 2D surface descriptor입니다.
 * @param {string} role - semantic role입니다.
 * @returns {Uint8Array} top-left RGBA 바이트입니다.
 */
function read2DSurface(descriptor, role) {
    const width = descriptor.canvas.width;
    const height = descriptor.canvas.height;
    const readbackCanvas = document.createElement('canvas');
    readbackCanvas.width = width;
    readbackCanvas.height = height;
    const readbackContext = readbackCanvas.getContext('2d', { willReadFrequently: true });
    assert(readbackContext, `${role}: 2D readback context를 만들지 못했습니다.`);
    readbackContext.drawImage(descriptor.canvas, 0, 0);
    return new Uint8Array(readbackContext.getImageData(0, 0, width, height).data);
}

/**
 * 2D 또는 WebGL surface의 RGBA 바이트를 캡처합니다.
 * @param {string} role - semantic role입니다.
 * @param {object} descriptor - surface descriptor입니다.
 * @returns {object} 캡처 레코드입니다.
 */
function captureSurface(role, descriptor) {
    const width = descriptor.canvas.width;
    const height = descriptor.canvas.height;
    const bytes = descriptor.type === 'webgl'
        ? readWebGLSurface(descriptor, role)
        : read2DSurface(descriptor, role);
    assert(bytes.some((value) => value !== 0), `${role}: 캡처가 완전 투명합니다.`);
    return {
        role,
        sourceId: descriptor.id,
        type: descriptor.type,
        mode: descriptor.mode,
        width,
        height,
        bytes,
        sha256: sha256(bytes)
    };
}

/**
 * NW.js 최종 페이지를 무손실 PNG buffer로 캡처합니다.
 * @returns {Promise<Buffer>} PNG 바이트입니다.
 */
function capturePagePng() {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error(`NW capturePage 제한시간 초과: ${EVENT_TIMEOUT_MS}ms`));
        }, EVENT_TIMEOUT_MS);
        try {
            nw.Window.get().capturePage((data) => {
                clearTimeout(timeoutId);
                try {
                    if (typeof data === 'string') {
                        resolve(Buffer.from(data, 'base64'));
                        return;
                    }
                    resolve(Buffer.from(data));
                } catch (error) {
                    reject(error);
                }
            }, { format: 'png', datatype: 'buffer' });
        } catch (error) {
            clearTimeout(timeoutId);
            reject(error);
        }
    });
}

/**
 * PNG buffer를 canonical top-left RGBA로 디코딩합니다.
 * @param {Uint8Array} pngBytes - PNG 바이트입니다.
 * @returns {Promise<{width:number,height:number,bytes:Uint8Array}>} 디코딩 결과입니다.
 */
async function decodePngToRgba(pngBytes) {
    const blob = new Blob([pngBytes], { type: 'image/png' });
    const bitmap = await createImageBitmap(blob);
    try {
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(bitmap, 0, 0);
        return {
            width: bitmap.width,
            height: bitmap.height,
            bytes: new Uint8Array(context.getImageData(0, 0, bitmap.width, bitmap.height).data)
        };
    } finally {
        bitmap.close();
    }
}

/**
 * 전체 surface와 최종 compositor 출력을 한 번 캡처합니다.
 * @param {DisplaySystem} displaySystem - 디스플레이 시스템입니다.
 * @param {OverlaySession} session - overlay session입니다.
 * @returns {Promise<object>} 케이스 캡처입니다.
 */
async function renderAndCapture(displaySystem, session) {
    recordProgress('render-and-capture:draw');
    renderFixture(displaySystem, session);
    const surfaces = resolveCaptureSurfaces(displaySystem, session)
        .map(({ role, descriptor }) => captureSurface(role, descriptor));

    await yieldFrame();
    recordProgress('render-and-capture:capture-page');
    const pngBytes = await capturePagePng();
    recordProgress('render-and-capture:decode-page');
    const decoded = await decodePngToRgba(pngBytes);
    assert(
        decoded.width === FIXTURE_WIDTH && decoded.height === FIXTURE_HEIGHT,
        `최종 캡처 ${decoded.width}x${decoded.height} != ${FIXTURE_WIDTH}x${FIXTURE_HEIGHT}`
    );
    return {
        surfaces,
        final: {
            role: 'final',
            width: decoded.width,
            height: decoded.height,
            bytes: decoded.bytes,
            sha256: sha256(decoded.bytes),
            pngBytes
        }
    };
}

/**
 * 두 RGBA 배열의 상세 차이 통계를 만듭니다.
 * @param {Uint8Array} expected - 기준 바이트입니다.
 * @param {Uint8Array} actual - 실제 바이트입니다.
 * @param {number} width - 이미지 너비입니다.
 * @returns {object|null} 동일하면 null, 다르면 통계입니다.
 */
function analyzeByteDifference(expected, actual, width) {
    const differingLength = expected.length !== actual.length;
    const comparedLength = Math.min(expected.length, actual.length);
    let differingByteCount = Math.abs(expected.length - actual.length);
    let differingPixelCount = 0;
    let maxChannelDelta = 0;
    let lastDifferingPixel = -1;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -1;
    let maxY = -1;
    const firstDifferences = [];

    for (let byteIndex = 0; byteIndex < comparedLength; byteIndex++) {
        if (expected[byteIndex] === actual[byteIndex]) {
            continue;
        }
        differingByteCount += 1;
        const pixelIndex = Math.floor(byteIndex / 4);
        const x = pixelIndex % width;
        const y = Math.floor(pixelIndex / width);
        if (pixelIndex !== lastDifferingPixel) {
            differingPixelCount += 1;
            lastDifferingPixel = pixelIndex;
        }
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        const delta = Math.abs(expected[byteIndex] - actual[byteIndex]);
        maxChannelDelta = Math.max(maxChannelDelta, delta);
        if (firstDifferences.length < 20) {
            firstDifferences.push({
                x,
                y,
                channel: CHANNEL_NAMES[byteIndex & 3],
                expected: expected[byteIndex],
                actual: actual[byteIndex],
                delta
            });
        }
    }

    if (!differingLength && differingByteCount === 0) {
        return null;
    }
    return {
        expectedLength: expected.length,
        actualLength: actual.length,
        differingByteCount,
        differingPixelCount,
        maxChannelDelta,
        bounds: minX === Infinity ? null : { minX, minY, maxX, maxY },
        firstDifferences
    };
}

/**
 * RGBA 바이트를 진단용 PNG로 인코딩합니다.
 * @param {Uint8Array} bytes - top-left RGBA입니다.
 * @param {number} width - 너비입니다.
 * @param {number} height - 높이입니다.
 * @returns {Promise<Buffer>} PNG 바이트입니다.
 */
async function encodeRgbaToPng(bytes, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.putImageData(
        new ImageData(new Uint8ClampedArray(bytes), width, height),
        0,
        0
    );
    const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((value) => {
            if (value) {
                resolve(value);
            } else {
                reject(new Error('진단 PNG 인코딩 실패'));
            }
        }, 'image/png');
    });
    return Buffer.from(await blob.arrayBuffer());
}

/**
 * 절대 채널 차이를 확대해 표시하는 RGBA 이미지를 만듭니다.
 * @param {Uint8Array} expected - 기준 바이트입니다.
 * @param {Uint8Array} actual - 실제 바이트입니다.
 * @returns {Uint8Array} 증폭 diff RGBA입니다.
 */
function createAmplifiedDiff(expected, actual) {
    const diff = new Uint8Array(expected.length);
    for (let byteIndex = 0; byteIndex < expected.length; byteIndex += 4) {
        diff[byteIndex] = Math.min(255, Math.abs(expected[byteIndex] - actual[byteIndex]) * 8);
        diff[byteIndex + 1] = Math.min(255, Math.abs(expected[byteIndex + 1] - actual[byteIndex + 1]) * 8);
        diff[byteIndex + 2] = Math.min(255, Math.abs(expected[byteIndex + 2] - actual[byteIndex + 2]) * 8);
        diff[byteIndex + 3] = 255;
    }
    return diff;
}

/**
 * 픽셀 실패의 expected/actual/diff PNG와 JSON을 임시 artifacts에 기록합니다.
 * @param {string} caseName - 케이스 이름입니다.
 * @param {string} role - surface role입니다.
 * @param {Uint8Array} expected - 기준 바이트입니다.
 * @param {Uint8Array} actual - 실제 바이트입니다.
 * @param {number} width - 너비입니다.
 * @param {number} height - 높이입니다.
 * @param {object} difference - 차이 통계입니다.
 * @returns {Promise<string>} 진단 디렉터리입니다.
 */
async function writeDifferenceArtifacts(
    caseName,
    role,
    expected,
    actual,
    width,
    height,
    difference
) {
    const artifactRoot = process.env.CIRVIVOR_RENDER_GOLDEN_ARTIFACT_DIR;
    assert(artifactRoot, '실패 artifact 경로가 설정되지 않았습니다.');
    const directory = path.join(
        artifactRoot,
        sanitizePathPart(caseName),
        sanitizePathPart(role)
    );
    await fsPromises.mkdir(directory, { recursive: true });
    const details = {
        caseName,
        role,
        width,
        height,
        expectedSha256: sha256(expected),
        actualSha256: sha256(actual),
        ...difference
    };
    await fsPromises.writeFile(
        path.join(directory, 'details.json'),
        `${JSON.stringify(details, null, 4)}\n`,
        'utf8'
    );
    if (expected.length === width * height * 4 && actual.length === expected.length) {
        const diff = createAmplifiedDiff(expected, actual);
        const [expectedPng, actualPng, diffPng] = await Promise.all([
            encodeRgbaToPng(expected, width, height),
            encodeRgbaToPng(actual, width, height),
            encodeRgbaToPng(diff, width, height)
        ]);
        await Promise.all([
            fsPromises.writeFile(path.join(directory, 'expected.png'), expectedPng),
            fsPromises.writeFile(path.join(directory, 'actual.png'), actualPng),
            fsPromises.writeFile(path.join(directory, 'diff.png'), diffPng)
        ]);
    }
    return directory;
}

/**
 * 두 RGBA 배열을 byte-exact로 비교하고 실패 진단을 남깁니다.
 * @param {string} caseName - 케이스 이름입니다.
 * @param {string} role - surface role입니다.
 * @param {Uint8Array} expected - 기준 바이트입니다.
 * @param {Uint8Array} actual - 실제 바이트입니다.
 * @param {number} width - 너비입니다.
 * @param {number} height - 높이입니다.
 * @returns {Promise<void>}
 */
async function assertBytesExact(caseName, role, expected, actual, width, height) {
    const difference = analyzeByteDifference(expected, actual, width);
    if (!difference) {
        return;
    }
    const directory = await writeDifferenceArtifacts(
        caseName,
        role,
        expected,
        actual,
        width,
        height,
        difference
    );
    throw new Error(
        `${caseName}/${role}: RGBA 불일치 byte=${difference.differingByteCount}, `
        + `maxDelta=${difference.maxChannelDelta}, artifacts=${directory}`
    );
}

/**
 * 두 전체 case 캡처가 surface와 final 모두 완전히 같은지 검사합니다.
 * @param {string} caseName - 비교 케이스 이름입니다.
 * @param {object} expected - 기준 캡처입니다.
 * @param {object} actual - 실제 캡처입니다.
 * @returns {Promise<void>}
 */
async function assertCaptureExact(caseName, expected, actual) {
    assert(expected.surfaces.length === actual.surfaces.length, `${caseName}: surface 수 불일치`);
    for (let index = 0; index < expected.surfaces.length; index++) {
        const expectedSurface = expected.surfaces[index];
        const actualSurface = actual.surfaces[index];
        assert(expectedSurface.role === actualSurface.role, `${caseName}: surface role 불일치`);
        assert(expectedSurface.type === actualSurface.type, `${caseName}/${expectedSurface.role}: type 불일치`);
        assert(
            expectedSurface.width === actualSurface.width
            && expectedSurface.height === actualSurface.height,
            `${caseName}/${expectedSurface.role}: 크기 불일치`
        );
        await assertBytesExact(
            caseName,
            expectedSurface.role,
            expectedSurface.bytes,
            actualSurface.bytes,
            expectedSurface.width,
            expectedSurface.height
        );
    }
    await assertBytesExact(
        caseName,
        'final',
        expected.final.bytes,
        actual.final.bytes,
        expected.final.width,
        expected.final.height
    );
}

/**
 * 세 production WebGL renderer 모드를 강제 복구한 뒤 canonical scene의 byte-exact 동일성을 검사합니다.
 * @param {DisplaySystem} displaySystem - 디스플레이 시스템입니다.
 * @param {OverlaySession} session - 현재 overlay session입니다.
 * @param {object} canonical - 기준 캡처입니다.
 * @returns {Promise<object>} 복구 뒤 캡처입니다.
 */
async function runContextRestoreCase(displaySystem, session, canonical) {
    const targets = [
        ['background', displaySystem.getSurface('background')],
        ['effect', displaySystem.getSurface('effect')],
        ['overlay.effect', displaySystem.getSurface(session.effectLayerId)]
    ];
    for (const [role, descriptor] of targets) {
        const gl = descriptor?.context;
        assert(gl, `${role}: context restore 대상 WebGL 컨텍스트가 없습니다.`);
        const extension = gl.getExtension('WEBGL_lose_context');
        assert(extension, `${role}: 필수 WEBGL_lose_context extension을 지원하지 않습니다.`);

        const lostPromise = waitForEvent(descriptor.canvas, 'webglcontextlost');
        extension.loseContext();
        await lostPromise;
        assert(
            displaySystem.webGLHandler.contextLostLayers.has(descriptor.id),
            `${role}: context loss가 WebGLHandler에 반영되지 않았습니다.`
        );
        assert(descriptor.isEmpty === true, `${role}: context loss 뒤 surface가 empty가 아닙니다.`);
        await yieldFrame();

        const restoredPromise = waitForEvent(descriptor.canvas, 'webglcontextrestored');
        extension.restoreContext();
        await restoredPromise;
        await yieldFrame();
        assert(
            !displaySystem.webGLHandler.contextLostLayers.has(descriptor.id),
            `${role}: context restore 뒤 lost 상태가 남았습니다.`
        );
        assert(
            descriptor.context === gl,
            `${role}: context restore 뒤 WebGL context identity가 바뀌었습니다.`
        );
    }

    const restored = await renderAndCapture(displaySystem, session);
    await assertCaptureExact('context-restore', canonical, restored);
    return restored;
}

/**
 * dynamic surface release/reacquire와 재렌더 byte-exact 동일성을 검사합니다.
 * @param {DisplaySystem} displaySystem - 디스플레이 시스템입니다.
 * @param {OverlaySession} session - 회수할 session입니다.
 * @param {object} canonical - 기준 캡처입니다.
 * @returns {Promise<{session:OverlaySession,capture:object,poolReuse:object}>} 재획득 결과입니다.
 */
async function runReleaseReacquireCase(displaySystem, session, canonical) {
    const oldDimCanvas = session.dimSurface.canvas;
    const oldEffectCanvas = session.effectSurface.canvas;
    const oldEffectContext = session.effectSurface.context;
    const oldUiCanvas = session.uiSurface.canvas;
    const beforeStats = displaySystem.getCanvasPoolStats();
    session.release();

    const reacquiredSession = new OverlaySession({
        displaySystem,
        ...SESSION_OPTIONS
    });
    const afterStats = displaySystem.getCanvasPoolStats();
    assert(
        beforeStats.twoD.createdCount === afterStats.twoD.createdCount,
        '2D dynamic pool createdCount가 재획득 중 증가했습니다.'
    );
    assert(
        beforeStats.webgl.createdCount === afterStats.webgl.createdCount,
        'WebGL dynamic pool createdCount가 재획득 중 증가했습니다.'
    );
    const oldTwoDCanvases = new Set([oldDimCanvas, oldUiCanvas]);
    assert(
        oldTwoDCanvases.has(reacquiredSession.dimSurface.canvas)
        && oldTwoDCanvases.has(reacquiredSession.uiSurface.canvas)
        && reacquiredSession.dimSurface.canvas !== reacquiredSession.uiSurface.canvas,
        '2D dynamic canvas 두 개가 pool에서 재사용되지 않았습니다.'
    );
    assert(
        reacquiredSession.effectSurface.canvas === oldEffectCanvas,
        'WebGL dynamic canvas가 pool에서 재사용되지 않았습니다.'
    );
    assert(
        reacquiredSession.effectSurface.context === oldEffectContext,
        'WebGL dynamic context가 pool에서 재사용되지 않았습니다.'
    );

    const capture = await renderAndCapture(displaySystem, reacquiredSession);
    await assertCaptureExact('release-reacquire', canonical, capture);
    return {
        session: reacquiredSession,
        capture,
        poolReuse: {
            twoDCreatedCountBefore: beforeStats.twoD.createdCount,
            twoDCreatedCountAfter: afterStats.twoD.createdCount,
            webglCreatedCountBefore: beforeStats.webgl.createdCount,
            webglCreatedCountAfter: afterStats.webgl.createdCount,
            reusedTwoDCanvasSet: true,
            reusedWebGLCanvas: true,
            reusedWebGLContext: true
        }
    };
}

/**
 * capture의 해시만 보존하는 manifest case 레코드를 만듭니다.
 * @param {object} capture - 전체 캡처입니다.
 * @returns {object} case 요약입니다.
 */
function createCaseRecord(capture) {
    return {
        surfaces: capture.surfaces.map((surface) => ({
            role: surface.role,
            width: surface.width,
            height: surface.height,
            sha256: surface.sha256
        })),
        final: {
            width: capture.final.width,
            height: capture.final.height,
            sha256: capture.final.sha256
        }
    };
}

/**
 * semantic role을 canonical raw 파일명으로 바꿉니다.
 * @param {string} role - surface role입니다.
 * @returns {string} 상대 파일명입니다.
 */
function getSurfaceFileName(role) {
    return `canonical.${sanitizePathPart(role)}.rgba`;
}

/**
 * golden manifest 전체를 구성합니다.
 * @param {object} profile - 런타임 profile입니다.
 * @param {object} canonical - canonical 캡처입니다.
 * @param {object} restored - context restore 캡처입니다.
 * @param {object} reacquired - release/reacquire 캡처입니다.
 * @param {object} poolReuse - pool 검증 결과입니다.
 * @returns {object} manifest입니다.
 */
function createManifest(profile, canonical, restored, reacquired, poolReuse) {
    return {
        schemaVersion: GOLDEN_SCHEMA_VERSION,
        fixture: FIXTURE_METADATA,
        profile,
        canonical: {
            surfaces: canonical.surfaces.map((surface) => ({
                role: surface.role,
                sourceId: surface.sourceId,
                type: surface.type,
                mode: surface.mode,
                width: surface.width,
                height: surface.height,
                byteLength: surface.bytes.length,
                sha256: surface.sha256,
                file: getSurfaceFileName(surface.role)
            })),
            final: {
                width: canonical.final.width,
                height: canonical.final.height,
                byteLength: canonical.final.bytes.length,
                sha256: canonical.final.sha256,
                file: 'canonical.final.rgba',
                reviewPng: 'canonical.final.png',
                reviewPngSha256: sha256(canonical.final.pngBytes)
            }
        },
        cases: {
            canonical: createCaseRecord(canonical),
            contextRestore: createCaseRecord(restored),
            releaseReacquire: createCaseRecord(reacquired)
        },
        poolReuse
    };
}

/**
 * 현재 profile의 tracked golden을 명시적으로 갱신합니다.
 * @param {string} goldenRoot - golden 루트입니다.
 * @param {object} manifest - 기록할 manifest입니다.
 * @param {object} canonical - raw 파일 원본입니다.
 * @returns {Promise<string>} profile 디렉터리입니다.
 */
async function updateGolden(goldenRoot, manifest, canonical) {
    const profileDirectory = path.join(goldenRoot, manifest.profile.id);
    await fsPromises.mkdir(profileDirectory, { recursive: true });
    for (const surface of canonical.surfaces) {
        await fsPromises.writeFile(
            path.join(profileDirectory, getSurfaceFileName(surface.role)),
            Buffer.from(surface.bytes)
        );
    }
    await fsPromises.writeFile(
        path.join(profileDirectory, manifest.canonical.final.file),
        Buffer.from(canonical.final.bytes)
    );
    await fsPromises.writeFile(
        path.join(profileDirectory, manifest.canonical.final.reviewPng),
        canonical.final.pngBytes
    );
    await fsPromises.writeFile(
        path.join(profileDirectory, 'manifest.json'),
        `${JSON.stringify(manifest, null, 4)}\n`,
        'utf8'
    );
    return profileDirectory;
}

/**
 * JSON 직렬화 기준 완전 동일성을 검사합니다.
 * @param {string} label - 필드 이름입니다.
 * @param {*} expected - manifest 값입니다.
 * @param {*} actual - 실제 값입니다.
 * @returns {void}
 */
function assertJsonExact(label, expected, actual) {
    const expectedJson = JSON.stringify(expected);
    const actualJson = JSON.stringify(actual);
    assert(expectedJson === actualJson, `${label} 불일치\nexpected=${expectedJson}\nactual=${actualJson}`);
}

/**
 * 승인된 manifest/raw golden과 현재 세 케이스를 비교합니다.
 * @param {string} goldenRoot - golden 루트입니다.
 * @param {object} profile - 현재 runtime profile입니다.
 * @param {object} canonical - canonical 캡처입니다.
 * @param {object} restored - context restore 캡처입니다.
 * @param {object} reacquired - release/reacquire 캡처입니다.
 * @param {object} poolReuse - pool 검증 결과입니다.
 * @returns {Promise<object>} 읽은 manifest입니다.
 */
async function checkGolden(goldenRoot, profile, canonical, restored, reacquired, poolReuse) {
    const profileDirectory = path.join(goldenRoot, profile.id);
    const manifestPath = path.join(profileDirectory, 'manifest.json');
    let manifest;
    try {
        manifest = JSON.parse(await fsPromises.readFile(manifestPath, 'utf8'));
    } catch (error) {
        if (error?.code === 'ENOENT') {
            throw new Error(
                `승인된 golden profile이 없습니다: ${profile.id}. `
                + '검토 후 npm run update:render:golden을 명시적으로 실행해야 합니다.'
            );
        }
        throw error;
    }

    assert(manifest.schemaVersion === GOLDEN_SCHEMA_VERSION, 'golden schemaVersion 불일치');
    assertJsonExact('fixture', manifest.fixture, FIXTURE_METADATA);
    assertJsonExact('profile', manifest.profile, profile);
    assert(
        manifest.canonical?.surfaces?.length === canonical.surfaces.length,
        'canonical surface manifest 수 불일치'
    );

    for (let index = 0; index < canonical.surfaces.length; index++) {
        const actual = canonical.surfaces[index];
        const expectedRecord = manifest.canonical.surfaces[index];
        assert(expectedRecord.role === actual.role, `${actual.role}: manifest role 불일치`);
        assert(expectedRecord.type === actual.type, `${actual.role}: manifest type 불일치`);
        assert(expectedRecord.mode === actual.mode, `${actual.role}: manifest mode 불일치`);
        assert(
            expectedRecord.width === actual.width && expectedRecord.height === actual.height,
            `${actual.role}: manifest 크기 불일치`
        );
        const expectedBytes = new Uint8Array(
            await fsPromises.readFile(path.join(profileDirectory, expectedRecord.file))
        );
        assert(expectedBytes.length === expectedRecord.byteLength, `${actual.role}: golden byteLength 불일치`);
        assert(sha256(expectedBytes) === expectedRecord.sha256, `${actual.role}: golden SHA-256 손상`);
        await assertBytesExact(
            'golden-check',
            actual.role,
            expectedBytes,
            actual.bytes,
            actual.width,
            actual.height
        );
    }

    const finalRecord = manifest.canonical.final;
    const expectedFinal = new Uint8Array(
        await fsPromises.readFile(path.join(profileDirectory, finalRecord.file))
    );
    assert(expectedFinal.length === finalRecord.byteLength, 'final golden byteLength 불일치');
    assert(sha256(expectedFinal) === finalRecord.sha256, 'final golden SHA-256 손상');
    await assertBytesExact(
        'golden-check',
        'final',
        expectedFinal,
        canonical.final.bytes,
        canonical.final.width,
        canonical.final.height
    );
    const reviewPng = await fsPromises.readFile(
        path.join(profileDirectory, finalRecord.reviewPng)
    );
    assert(
        sha256(reviewPng) === finalRecord.reviewPngSha256,
        'final review PNG SHA-256 손상'
    );

    assertJsonExact('cases.canonical', manifest.cases.canonical, createCaseRecord(canonical));
    assertJsonExact('cases.contextRestore', manifest.cases.contextRestore, createCaseRecord(restored));
    assertJsonExact(
        'cases.releaseReacquire',
        manifest.cases.releaseReacquire,
        createCaseRecord(reacquired)
    );
    assertJsonExact('poolReuse', manifest.poolReuse, poolReuse);
    return manifest;
}

/**
 * launcher가 읽을 결과 JSON을 기록한 뒤 NW.js를 종료합니다.
 * @param {object} result - 직렬화할 결과입니다.
 * @returns {Promise<void>}
 */
async function finish(result) {
    const resultPath = process.env.CIRVIVOR_RENDER_GOLDEN_RESULT_PATH;
    assert(resultPath, 'launcher result 경로가 설정되지 않았습니다.');
    document.title = `${result.status.toUpperCase()} — Render pipeline pixel golden`;
    statusElement.textContent = result.status;
    await fsPromises.writeFile(resultPath, `${JSON.stringify(result, null, 4)}\n`, 'utf8');
    console[result.status === 'pass' ? 'log' : 'error'](JSON.stringify(result, null, 2));
    setTimeout(() => nw.App.quit(), 25);
}

/**
 * production DisplaySystem 기반 세 개의 pixel-golden 케이스를 실행합니다.
 * @returns {Promise<object>} launcher 결과입니다.
 */
async function run() {
    recordProgress('run:start');
    const mode = process.env.CIRVIVOR_RENDER_GOLDEN_MODE;
    const goldenRoot = process.env.CIRVIVOR_RENDER_GOLDEN_ROOT;
    const runRoot = process.env.CIRVIVOR_RENDER_GOLDEN_RUN_ROOT;
    assert(mode === 'check' || mode === 'update', `잘못된 실행 모드: ${mode}`);
    assert(goldenRoot, 'golden 루트가 설정되지 않았습니다.');
    assert(runRoot, '격리 실행 루트가 설정되지 않았습니다.');
    process.chdir(runRoot);

    new ColorUtil();
    const saveSystem = new SaveSystem();
    saveSystem.previewSettingBatch({
        theme: 'dark',
        disableTransparency: false,
        windowMode: 'windowed',
        widescreenSupport: true,
        width: FIXTURE_WIDTH,
        height: FIXTURE_HEIGHT,
        renderScale: 100,
        uiScale: 100
    });

    const displaySystem = new DisplaySystem();
    displaySystem.screenHandler = createFixedScreenHandler();
    await displaySystem.init();
    recordProgress('run:display-initialized');
    await ensureFixtureFont();
    recordProgress('run:font-ready');
    assertSupportedEnvironment();

    let session = new OverlaySession({
        displaySystem,
        ...SESSION_OPTIONS
    });
    recordProgress('run:session-created');
    const profile = createRuntimeProfile(displaySystem, session);
    recordProgress('run:warmup-capture');
    await renderAndCapture(displaySystem, session);
    const canonical = await renderAndCapture(displaySystem, session);
    recordProgress('run:canonical-captured');
    const restored = await runContextRestoreCase(displaySystem, session, canonical);
    recordProgress('run:context-restored');
    const reacquiredResult = await runReleaseReacquireCase(displaySystem, session, canonical);
    recordProgress('run:surface-reacquired');
    session = reacquiredResult.session;
    const reacquired = reacquiredResult.capture;
    const manifest = createManifest(
        profile,
        canonical,
        restored,
        reacquired,
        reacquiredResult.poolReuse
    );

    let goldenDirectory;
    if (mode === 'update') {
        goldenDirectory = await updateGolden(goldenRoot, manifest, canonical);
    } else {
        await checkGolden(
            goldenRoot,
            profile,
            canonical,
            restored,
            reacquired,
            reacquiredResult.poolReuse
        );
        goldenDirectory = path.join(goldenRoot, profile.id);
    }
    recordProgress('run:golden-finished');
    session.release();

    return {
        status: 'pass',
        mode,
        profileId: profile.id,
        goldenDirectory,
        surfaceCount: canonical.surfaces.length,
        caseCount: 3,
        finalSha256: canonical.final.sha256
    };
}

run()
    .then((result) => finish(result))
    .catch(async (error) => {
        try {
            await finish({
                status: 'fail',
                mode: process.env.CIRVIVOR_RENDER_GOLDEN_MODE || null,
                error: error?.stack ?? String(error)
            });
        } catch (finishError) {
            console.error(error?.stack ?? error);
            console.error(finishError?.stack ?? finishError);
            setTimeout(() => nw.App.quit(), 25);
        }
    });
