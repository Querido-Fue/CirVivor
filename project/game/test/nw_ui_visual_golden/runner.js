import { SystemHandler } from 'game/module/system_handler.js';
import { TimeHandler } from 'game/time_handler.js';
import { compareDisplaySurfaceDescriptors } from 'display/display_surface_descriptor.js';
import { shouldShowHitboxes } from 'debug/debug_system.js';
import { getSetting } from 'save/save_system.js';
import { ColorUtil } from 'util/color_util.js';
import { MathUtil } from 'util/math_util.js';
import { RuntimeTool } from 'util/runtime_tool.js';
import { nw } from 'util/nw_bridge.js';

const { Buffer } = window.require('buffer');
const { createHash } = window.require('crypto');
const fs = window.require('fs');
const fsPromises = fs.promises;
const path = window.require('path');

const EXPECTED_NW_VERSION = '0.108.0';
const GOLDEN_SCHEMA_VERSION = 2;
const EVENT_TIMEOUT_MS = 15_000;
const FONT_FAMILY = 'Pretendard Variable';
const FONT_SPECS = Object.freeze([
    `400 18px "${FONT_FAMILY}"`,
    `600 18px "${FONT_FAMILY}"`,
    `700 24px "${FONT_FAMILY}"`
]);
const CHANNEL_NAMES = Object.freeze(['R', 'G', 'B', 'A']);
const SUPPORTED_ACTIONS = Object.freeze(new Set([
    'advanceFrames',
    'movePointerToTitleEntry',
    'openTitleOverlay',
    'closeTitleOverlay',
    'activateOverlayElement',
    'clickMouseButton',
    'flushAsyncJobs',
    'openExitOverlay',
    'openExternalLinkWarningOverlay'
]));
const statusElement = document.querySelector('#harness-status');

/** 조건이 거짓이면 하네스 오류를 발생시킵니다. */
function assert(condition, message) {
    if (!condition) throw new Error(message);
}

/** 바이트 또는 문자열의 SHA-256을 반환합니다. */
function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}

/** 파일명에 안전한 문자열로 정규화합니다. */
function sanitizePathPart(value) {
    return String(value).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

/** launcher 진단용 마지막 시나리오 단계를 기록합니다. */
function recordProgress(stage) {
    const resultPath = process.env.CIRVIVOR_UI_GOLDEN_RESULT_PATH;
    if (resultPath) fs.writeFileSync(`${resultPath}.progress`, `${stage}\n`, 'utf8');
}

/** xorshift32 결정적 난수 함수를 만듭니다. */
function createFixtureRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return (state >>> 0) / 0x100000000;
    };
}

/** 생산 코드가 관찰하는 시간·난수·rAF를 결정적으로 고정합니다. */
function installDeterministicRuntime(oracle) {
    const frameDurationMs = oracle.clock.frameDurationMs;
    const timeOriginMs = oracle.clock.timeOriginMs;
    const originalDate = window.Date;
    const originalPerformanceNow = window.performance.now.bind(window.performance);
    const originalRequestAnimationFrame = window.requestAnimationFrame.bind(window);
    const originalCancelAnimationFrame = window.cancelAnimationFrame.bind(window);
    const originalSetTimeout = window.setTimeout.bind(window);
    const originalClearTimeout = window.clearTimeout.bind(window);
    const clock = {
        frame: 0,
        nowMs: timeOriginMs,
        advanceFrame() {
            this.frame += 1;
            this.nowMs = timeOriginMs + (this.frame * frameDurationMs);
        }
    };

    Math.random = createFixtureRandom(oracle.random.seed);
    Object.defineProperty(window.performance, 'now', {
        configurable: true,
        value: () => clock.nowMs
    });
    class FixtureDate extends originalDate {
        constructor(...args) {
            super(...(args.length > 0 ? args : [clock.nowMs]));
        }

        static now() {
            return clock.nowMs;
        }
    }
    window.Date = FixtureDate;

    let nextRafId = 0;
    const pendingRaf = new Map();
    window.requestAnimationFrame = (callback) => {
        const id = ++nextRafId;
        pendingRaf.set(id, callback);
        queueMicrotask(() => {
            const pendingCallback = pendingRaf.get(id);
            if (!pendingCallback) return;
            pendingRaf.delete(id);
            pendingCallback(clock.nowMs);
        });
        return id;
    };
    window.cancelAnimationFrame = (id) => pendingRaf.delete(id);
    return {
        clock,
        originalRequestAnimationFrame,
        originalSetTimeout,
        originalClearTimeout,
        async drainRafQueue() {
            while (pendingRaf.size > 0) await Promise.resolve();
        },
        restoreNativeCaptureClock() {
            window.Date = originalDate;
            Object.defineProperty(window.performance, 'now', {
                configurable: true,
                value: originalPerformanceNow
            });
            window.requestAnimationFrame = originalRequestAnimationFrame;
            window.cancelAnimationFrame = originalCancelAnimationFrame;
        }
    };
}

/** 오디오·외부 프로세스 부작용을 기록만 하는 플랫폼 seam으로 바꿉니다. */
function installSideEffectStubs(runtimeTool, sideEffects) {
    class FixtureAudio {
        constructor(source) {
            this.src = source;
            this.loop = false;
            this.preload = 'none';
            this.volume = 1;
            this.currentTime = 0;
            this.paused = true;
        }

        async play() {
            sideEffects.audioPlayCalls += 1;
            this.paused = false;
        }

        pause() {
            sideEffects.audioPauseCalls += 1;
            this.paused = true;
        }
    }
    window.Audio = FixtureAudio;
    runtimeTool._openURLDirect = (url) => {
        sideEffects.externalOpenRequests.push(String(url));
        return true;
    };
    runtimeTool.openDebugWindow = () => {
        sideEffects.devToolsRequests += 1;
    };
    runtimeTool.closeWindow = () => {
        sideEffects.windowCloseRequests += 1;
    };
}

/** 번들 폰트의 주요 굵기가 실제 로드됐는지 확인합니다. */
async function ensureFixtureFont() {
    for (const fontSpec of FONT_SPECS) {
        await document.fonts.load(fontSpec, '타이틀 오버레이 픽셀 골든');
    }
    await document.fonts.ready;
    for (const fontSpec of FONT_SPECS) {
        assert(document.fonts.check(fontSpec, '타이틀 오버레이 픽셀 골든'), `번들 폰트 로드 실패: ${fontSpec}`);
    }
}

/** 브라우저 task queue에 한 번 양보합니다. */
function yieldTask(originalSetTimeout) {
    return new Promise((resolve) => originalSetTimeout(resolve, 0));
}

/** Chromium compositor가 현재 surface 스타일을 반영하도록 기회를 줍니다. */
function yieldNativeFrame(originalRequestAnimationFrame, originalSetTimeout, originalClearTimeout) {
    return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            originalClearTimeout(timeoutId);
            resolve();
        };
        const timeoutId = originalSetTimeout(finish, 250);
        originalRequestAnimationFrame(finish);
    });
}

/** 현재 title content에 연결된 생산 TitleMenu를 반환합니다. */
function getTitleMenu(systemHandler) {
    const scene = systemHandler.sceneSystem?.scene;
    return scene?.presentation?.content?.titleMenu
        || scene?.titleController?.loadingSequence?.titleMenu
        || null;
}

/** 현재 타이틀 controller를 반환합니다. */
function getTitleController(systemHandler) {
    const scene = systemHandler.sceneSystem?.scene;
    return scene?.titleController || scene?.presentation?.controller || null;
}

/** 비동기 preload 중인 production 타이틀 SVG 아이콘을 모두 기다립니다. */
async function ensureTitleIcons(systemHandler) {
    const titleMenu = getTitleMenu(systemHandler);
    if (!titleMenu) return;
    await Promise.all(
        titleMenu.titleMenuIconSources.map((source) => titleMenu.svgDrawer.loadSvgFile(source))
    );
}

/** DOM 포인터를 화면 좌표로 이동합니다. */
function movePointer(x, y) {
    window.dispatchEvent(new MouseEvent('mousemove', {
        clientX: x,
        clientY: y,
        bubbles: true
    }));
}

/** 생산 입력 상태머신과 overlay update를 통해 UI 요소를 한 번 클릭합니다. */
function activateOverlayElement(systemHandler, elementId, clock) {
    const entries = [...systemHandler.overlayManager.entries.values()]
        .sort((left, right) => right.sequence - left.sequence);
    let target = null;
    for (const entry of entries) {
        const component = entry.controller.settingComponents?.[elementId];
        if (component) {
            target = component;
            break;
        }
        const generated = entry.controller.dynamicItems?.find((itemEntry) => (
            itemEntry.id === elementId || itemEntry.item?.id === elementId
        ));
        if (generated?.item) {
            target = generated.item;
            break;
        }
    }
    assert(target, `overlay 요소를 찾지 못했습니다: ${elementId}`);
    const width = Number(target.width) || 1;
    const height = Number(target.height) || 1;
    movePointer((Number(target.x) || 0) + (width / 2), (Number(target.y) || 0) + (height / 2));

    const inputSystem = systemHandler.inputSystem;
    const stateMachine = inputSystem.mouseInputHandler.buttonStateMachine;
    stateMachine.queueButtonStateChange(0, 'press', clock.nowMs);
    inputSystem.update();
    systemHandler.overlayManager.update();
    stateMachine.queueButtonStateChange(0, 'release', clock.nowMs);
    inputSystem.update();
    systemHandler.overlayManager.update();
}

/** SystemHandler의 실제 60Hz tick 경로로 지정 프레임 수를 진행합니다. */
async function advanceFrames(systemHandler, frameCount, deterministicRuntime) {
    const fixedStepSeconds = 1 / 60;
    for (let frame = 0; frame < frameCount; frame++) {
        deterministicRuntime.clock.advanceFrame();
        systemHandler.tick({
            frameDeltaSeconds: fixedStepSeconds,
            fixedStepSeconds,
            fixedStepCount: 1,
            fixedAlpha: 0,
            debugFrameMode: 'running'
        });
        await Promise.resolve();
        if ((frame + 1) % 30 === 0) {
            await yieldTask(deterministicRuntime.originalSetTimeout);
        }
    }
}

/** 단일 manifest 의미 action을 production controller에 적용합니다. */
async function executeStep(systemHandler, step, deterministicRuntime) {
    assert(SUPPORTED_ACTIONS.has(step.action), `지원하지 않는 UI golden action: ${step.action}`);
    switch (step.action) {
        case 'advanceFrames':
            await advanceFrames(systemHandler, step.frames, deterministicRuntime);
            return;
        case 'movePointerToTitleEntry': {
            const titleMenu = getTitleMenu(systemHandler);
            const panelRect = titleMenu?.cardRenderMap?.get(step.entryId)?.panelRect;
            assert(panelRect, `타이틀 entry 렌더 rect를 찾지 못했습니다: ${step.entryId}`);
            movePointer(panelRect.x + (panelRect.w / 2), panelRect.y + (panelRect.h / 2));
            return;
        }
        case 'openTitleOverlay': {
            const controller = getTitleController(systemHandler);
            assert(controller, '타이틀 controller가 준비되지 않았습니다.');
            assert(controller.openTitleOverlay(step.menu), `타이틀 overlay를 열지 못했습니다: ${step.menu}`);
            return;
        }
        case 'closeTitleOverlay':
            getTitleController(systemHandler)?.closeTitleOverlay();
            return;
        case 'activateOverlayElement':
            activateOverlayElement(systemHandler, step.elementId, deterministicRuntime.clock);
            return;
        case 'clickMouseButton': {
            const code = step.button === 'middle' ? 1 : (step.button === 'right' ? 2 : 0);
            const stateMachine = systemHandler.inputSystem.mouseInputHandler.buttonStateMachine;
            stateMachine.queueButtonStateChange(code, 'press', step.eventTimeMs);
            stateMachine.queueButtonStateChange(code, 'release', step.eventTimeMs);
            return;
        }
        case 'flushAsyncJobs': {
            const debugToggle = systemHandler.inputSystem.mouseInputHandler
                .buttonStateMachine.debugModeToggleHandler;
            await debugToggle.toggleJob;
            await Promise.resolve();
            return;
        }
        case 'openExitOverlay':
            assert(systemHandler.overlayManager.openExitOverlay(), '종료 overlay를 열지 못했습니다.');
            return;
        case 'openExternalLinkWarningOverlay':
            assert(
                systemHandler.overlayManager.openExternalLinkWarningOverlay(step.url),
                '외부 링크 경고 overlay를 열지 못했습니다.'
            );
            return;
        default:
            throw new Error(`도달할 수 없는 action: ${step.action}`);
    }
}

/** 시나리오가 요청한 production controller·디버그 상태에 도달했는지 검사합니다. */
function assertScenarioReached(systemHandler, scenario, manifest) {
    if (scenario.coverageKey) {
        const coverage = manifest.coverage.titleOverlayFactory.find(({ key }) => key === scenario.coverageKey);
        assert(coverage, `${scenario.coverageKey} coverage 선언이 없습니다.`);
        const controllerClasses = [...systemHandler.overlayManager.entries.values()]
            .map(({ controller }) => controller.constructor.name);
        assert(
            controllerClasses.includes(coverage.controllerClass),
            `${scenario.id}: ${coverage.controllerClass} production controller에 도달하지 못했습니다.`
        );
    }
    if (scenario.expectedControllerClass) {
        const controllerClasses = [...systemHandler.overlayManager.entries.values()]
            .map(({ controller }) => controller.constructor.name);
        assert(
            controllerClasses.includes(scenario.expectedControllerClass),
            `${scenario.id}: ${scenario.expectedControllerClass} production controller에 도달하지 못했습니다.`
        );
    }
    if (scenario.expectedRuntimeState) {
        const expected = scenario.expectedRuntimeState;
        assert(getSetting('debugMode') === expected.debugMode, `${scenario.id}: debugMode 불일치`);
        assert(
            JSON.stringify(systemHandler.debugSystem.getControlState()) === JSON.stringify(expected.controlState),
            `${scenario.id}: debug control 상태 불일치`
        );
        assert(shouldShowHitboxes() === expected.hitboxesActive, `${scenario.id}: hitbox 상태 불일치`);
        assert(
            systemHandler.debugSystem.shouldTrackPerformance() === expected.performanceProfilerEnabled,
            `${scenario.id}: performance profiler 상태 불일치`
        );
        assert(
            systemHandler.debugSystem.isControlOptionActive('poolInfo') === expected.poolInfoVisible,
            `${scenario.id}: pool info 상태 불일치`
        );
    }
}

/** WebGL 오류 코드를 사람이 읽는 문자열로 바꿉니다. */
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

/** 대기 중인 WebGL 오류가 없는지 확인합니다. */
function assertNoGlError(gl, label) {
    const errors = [];
    for (let index = 0; index < 32; index++) {
        const errorCode = gl.getError();
        if (errorCode === gl.NO_ERROR) break;
        errors.push(getGlErrorName(gl, errorCode));
    }
    assert(errors.length === 0, `${label}: WebGL 오류 ${errors.join(', ')}`);
}

/** WebGL default framebuffer를 top-left RGBA로 읽습니다. */
function readWebGLSurface(descriptor, role) {
    const gl = descriptor.context;
    const width = descriptor.canvas.width;
    const height = descriptor.canvas.height;
    assert(gl && !gl.isContextLost(), `${role}: WebGL context lost`);
    const bottomLeft = new Uint8Array(width * height * 4);
    const topLeft = new Uint8Array(bottomLeft.length);
    const rowBytes = width * 4;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.finish();
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomLeft);
    assertNoGlError(gl, `${role}/readPixels`);
    for (let row = 0; row < height; row++) {
        const sourceStart = (height - row - 1) * rowBytes;
        topLeft.set(bottomLeft.subarray(sourceStart, sourceStart + rowBytes), row * rowBytes);
    }
    return topLeft;
}

/** production 2D canvas를 별도 readback canvas로 읽습니다. */
function read2DSurface(descriptor, role) {
    const width = descriptor.canvas.width;
    const height = descriptor.canvas.height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    assert(context, `${role}: 2D readback context 생성 실패`);
    context.drawImage(descriptor.canvas, 0, 0);
    return new Uint8Array(context.getImageData(0, 0, width, height).data);
}

/** 하나의 production surface raw RGBA를 캡처합니다. */
function captureSurface(role, descriptor) {
    const bytes = descriptor.type === 'webgl'
        ? readWebGLSurface(descriptor, role)
        : read2DSurface(descriptor, role);
    return {
        role,
        sourceId: descriptor.id,
        type: descriptor.type,
        mode: descriptor.mode,
        order: descriptor.order,
        sequence: descriptor.sequence || 0,
        width: descriptor.canvas.width,
        height: descriptor.canvas.height,
        bytes,
        sha256: sha256(bytes)
    };
}

/** NW 최종 페이지를 PNG로 캡처합니다. */
function capturePagePng(originalSetTimeout, originalClearTimeout) {
    return new Promise((resolve, reject) => {
        const timeoutId = originalSetTimeout(
            () => reject(new Error('NW capturePage 제한시간 초과')),
            EVENT_TIMEOUT_MS
        );
        nw.Window.get().capturePage((data) => {
            originalClearTimeout(timeoutId);
            try {
                resolve(typeof data === 'string' ? Buffer.from(data, 'base64') : Buffer.from(data));
            } catch (error) {
                reject(error);
            }
        }, { format: 'png', datatype: 'buffer' });
    });
}

/** PNG를 canonical top-left RGBA로 디코딩합니다. */
async function decodePngToRgba(pngBytes) {
    const bitmap = await createImageBitmap(new Blob([pngBytes], { type: 'image/png' }));
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

/** 현재 state를 update 없이 production draw 순서로 다시 제출합니다. */
function redrawCurrentState(systemHandler) {
    systemHandler.displaySystem.drawHandler.clearAll();
    systemHandler.displaySystem.webGLHandler.clearAll();
    systemHandler.draw(systemHandler.getFrameExecutionPolicy());
    systemHandler.displaySystem.webGLHandler.flushAll();
    for (const [surfaceId, gl] of systemHandler.displaySystem.webGLHandler.glContexts.entries()) {
        if (systemHandler.displaySystem.webGLHandler.contextLostLayers.has(surfaceId)) continue;
        gl.finish();
        assertNoGlError(gl, `${surfaceId}/final-finish`);
    }
}

/** 정적 7면, 모든 동적 면, 최종 compositor를 캡처합니다. */
async function captureScenario(systemHandler, manifest, deterministicRuntime) {
    recordProgress(`scenario:${process.env.CIRVIVOR_UI_GOLDEN_SCENARIO_ID}:capture:icons`);
    await ensureTitleIcons(systemHandler);
    recordProgress(`scenario:${process.env.CIRVIVOR_UI_GOLDEN_SCENARIO_ID}:capture:redraw`);
    redrawCurrentState(systemHandler);
    recordProgress(`scenario:${process.env.CIRVIVOR_UI_GOLDEN_SCENARIO_ID}:capture:static-readback`);
    const staticSurfaces = manifest.capture.staticSurfaceRoles.map((role) => {
        const descriptor = systemHandler.displaySystem.getSurface(role);
        assert(descriptor && descriptor.dynamic !== true, `정적 surface 누락: ${role}`);
        return captureSurface(role, descriptor);
    });
    const dynamicDescriptors = [...systemHandler.displaySystem.surfaceMap.values()]
        .filter((descriptor) => descriptor.dynamic === true)
        .sort(compareDisplaySurfaceDescriptors);
    recordProgress(`scenario:${process.env.CIRVIVOR_UI_GOLDEN_SCENARIO_ID}:capture:dynamic-readback`);
    const dynamicSurfaces = dynamicDescriptors.map((descriptor, index) => (
        captureSurface(`dynamic.${String(index).padStart(3, '0')}`, descriptor)
    ));

    recordProgress(`scenario:${process.env.CIRVIVOR_UI_GOLDEN_SCENARIO_ID}:capture:raf-drain`);
    await deterministicRuntime.drainRafQueue();
    deterministicRuntime.restoreNativeCaptureClock();
    const nwWindow = nw.Window.get();
    nwWindow.show();
    nwWindow.focus();
    await yieldNativeFrame(
        deterministicRuntime.originalRequestAnimationFrame,
        deterministicRuntime.originalSetTimeout,
        deterministicRuntime.originalClearTimeout
    );
    await yieldNativeFrame(
        deterministicRuntime.originalRequestAnimationFrame,
        deterministicRuntime.originalSetTimeout,
        deterministicRuntime.originalClearTimeout
    );
    recordProgress(`scenario:${process.env.CIRVIVOR_UI_GOLDEN_SCENARIO_ID}:capture:capture-page`);
    const pngBytes = await capturePagePng(
        deterministicRuntime.originalSetTimeout,
        deterministicRuntime.originalClearTimeout
    );
    recordProgress(`scenario:${process.env.CIRVIVOR_UI_GOLDEN_SCENARIO_ID}:capture:decode-page`);
    const decoded = await decodePngToRgba(pngBytes);
    assert(decoded.width === 1280 && decoded.height === 720, `최종 캡처 크기 불일치: ${decoded.width}x${decoded.height}`);
    return {
        staticSurfaces,
        dynamicSurfaces,
        final: {
            role: 'final',
            width: decoded.width,
            height: decoded.height,
            bytes: decoded.bytes,
            sha256: sha256(decoded.bytes),
            pngBytes,
            pngSha256: sha256(pngBytes)
        }
    };
}

/** 현재 WebGL context의 profile 필드를 직렬화합니다. */
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
        attributes
    };
}

/** OS/NW/Chromium/WebGL/번들 폰트를 묶은 same-profile 식별자를 만듭니다. */
async function createRuntimeProfile(systemHandler, deterministicRuntime) {
    const appRoot = process.env.CIRVIVOR_UI_GOLDEN_APP_ROOT;
    const fontPath = path.join(appRoot, 'game', 'font', 'PretendardVariable.woff2');
    const fontBytes = await fsPromises.readFile(fontPath);
    const backgroundGl = systemHandler.displaySystem.getSurface('background')?.context;
    const effectGl = systemHandler.displaySystem.getSurface('effect')?.context;
    assert(backgroundGl && effectGl, 'static WebGL profile context가 없습니다.');
    const base = {
        platform: process.platform,
        arch: process.arch,
        nw: process.versions.nw,
        chromium: process.versions.chrome,
        node: process.versions.node,
        userAgent: navigator.userAgent,
        dpr: window.devicePixelRatio,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        runtimeClock: {
            timeOriginMs: deterministicRuntime.clock.nowMs
                - (deterministicRuntime.clock.frame * (1000 / 60)),
            frameDurationMs: 1000 / 60
        },
        font: {
            family: FONT_FAMILY,
            file: 'game/font/PretendardVariable.woff2',
            byteLength: fontBytes.length,
            sha256: sha256(fontBytes),
            specs: FONT_SPECS
        },
        backgroundContext: describeWebGLContext(backgroundGl),
        effectContext: describeWebGLContext(effectGl)
    };
    const fingerprint = sha256(Buffer.from(JSON.stringify(base), 'utf8')).slice(0, 12);
    return {
        id: `${sanitizePathPart(base.platform)}-${sanitizePathPart(base.arch)}-nw${sanitizePathPart(base.nw)}-dpr${base.dpr}-${fingerprint}`,
        ...base
    };
}

/** 캡처 바이트를 제외한 manifest surface 레코드를 만듭니다. */
function createSurfaceRecord(surface) {
    return {
        role: surface.role,
        sourceId: surface.sourceId,
        type: surface.type,
        mode: surface.mode,
        order: surface.order,
        sequence: surface.sequence,
        width: surface.width,
        height: surface.height,
        byteLength: surface.bytes.length,
        sha256: surface.sha256
    };
}

/** 현재 production 도달 상태를 manifest에 기록할 값으로 만듭니다. */
function createReachRecord(systemHandler) {
    const scene = systemHandler.sceneSystem.scene;
    return {
        systemHandlerClass: systemHandler.constructor.name,
        initialSceneClass: 'LoadingScene',
        sceneState: systemHandler.sceneSystem.sceneState,
        currentSceneClass: scene?.constructor?.name || null,
        titleContentClass: scene?.presentation?.content?.constructor?.name || null,
        activeOverlays: [...systemHandler.overlayManager.entries.values()]
            .sort((left, right) => left.sequence - right.sequence)
            .map((entry) => ({
                key: entry.key,
                controllerClass: entry.controller.constructor.name,
                layer: entry.order,
                sequence: entry.sequence
            }))
    };
}

/** side-effect stub 호출 결과를 안정적인 manifest 값으로 만듭니다. */
function createSideEffectRecord(sideEffects) {
    return {
        externalOpenRequests: [...sideEffects.externalOpenRequests],
        devToolsRequests: sideEffects.devToolsRequests,
        gameCloseRequests: sideEffects.gameCloseRequests,
        windowCloseRequests: sideEffects.windowCloseRequests,
        audioPlayCalls: sideEffects.audioPlayCalls,
        audioPauseCalls: sideEffects.audioPauseCalls
    };
}

/** 단일 시나리오 manifest 레코드를 만듭니다. */
function createScenarioRecord(systemHandler, scenario, capture, sideEffects) {
    const scenarioId = scenario.id;
    return {
        id: scenarioId,
        definition: scenario,
        reach: createReachRecord(systemHandler),
        sideEffects: createSideEffectRecord(sideEffects),
        staticSurfaces: capture.staticSurfaces.map(createSurfaceRecord),
        dynamicSurfaces: capture.dynamicSurfaces.map(createSurfaceRecord),
        final: {
            width: capture.final.width,
            height: capture.final.height,
            byteLength: capture.final.bytes.length,
            sha256: capture.final.sha256,
            reviewPng: `${sanitizePathPart(scenarioId)}.final.png`,
            reviewPngByteLength: capture.final.pngBytes.length,
            reviewPngSha256: capture.final.pngSha256
        }
    };
}

/** update 모드에서 최종 review PNG만 임시 capture 디렉터리에 기록합니다. */
async function writeUpdateCapture(captureDirectory, scenarioRecord, capture) {
    await fsPromises.mkdir(captureDirectory, { recursive: true });
    await fsPromises.writeFile(
        path.join(captureDirectory, scenarioRecord.final.reviewPng),
        capture.final.pngBytes
    );
}

/** 두 RGBA 배열의 차이 통계를 계산합니다. */
function analyzeByteDifference(expected, actual, width) {
    const comparedLength = Math.min(expected.length, actual.length);
    let differingByteCount = Math.abs(expected.length - actual.length);
    let differingPixelCount = 0;
    let maxChannelDelta = 0;
    let lastPixel = -1;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -1;
    let maxY = -1;
    const firstDifferences = [];
    for (let byteIndex = 0; byteIndex < comparedLength; byteIndex++) {
        if (expected[byteIndex] === actual[byteIndex]) continue;
        differingByteCount += 1;
        const pixel = Math.floor(byteIndex / 4);
        const x = pixel % width;
        const y = Math.floor(pixel / width);
        if (pixel !== lastPixel) {
            differingPixelCount += 1;
            lastPixel = pixel;
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
    if (differingByteCount === 0) return null;
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

/** RGBA 배열을 PNG로 인코딩합니다. */
async function encodeRgbaToPng(bytes, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.putImageData(new ImageData(new Uint8ClampedArray(bytes), width, height), 0, 0);
    const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((value) => value ? resolve(value) : reject(new Error('진단 PNG 인코딩 실패')), 'image/png');
    });
    return Buffer.from(await blob.arrayBuffer());
}

/** 픽셀 차이를 8배 증폭한 RGBA를 만듭니다. */
function createAmplifiedDiff(expected, actual) {
    const length = Math.min(expected.length, actual.length);
    const diff = new Uint8Array(length);
    for (let index = 0; index + 3 < length; index += 4) {
        diff[index] = Math.min(255, Math.abs(expected[index] - actual[index]) * 8);
        diff[index + 1] = Math.min(255, Math.abs(expected[index + 1] - actual[index + 1]) * 8);
        diff[index + 2] = Math.min(255, Math.abs(expected[index + 2] - actual[index + 2]) * 8);
        diff[index + 3] = 255;
    }
    return diff;
}

/** expected/actual/diff raw와 PNG 및 통계를 실패 artifact로 보존합니다. */
async function writeDifferenceArtifacts(scenarioId, role, expected, actual, width, height, difference) {
    const artifactRoot = process.env.CIRVIVOR_UI_GOLDEN_ARTIFACT_DIR;
    const directory = path.join(artifactRoot, sanitizePathPart(scenarioId), sanitizePathPart(role));
    await fsPromises.mkdir(directory, { recursive: true });
    const diff = expected.length === actual.length ? createAmplifiedDiff(expected, actual) : new Uint8Array();
    await Promise.all([
        fsPromises.writeFile(path.join(directory, 'expected.rgba'), Buffer.from(expected)),
        fsPromises.writeFile(path.join(directory, 'actual.rgba'), Buffer.from(actual)),
        fsPromises.writeFile(path.join(directory, 'diff.rgba'), Buffer.from(diff)),
        fsPromises.writeFile(path.join(directory, 'details.json'), `${JSON.stringify({
            scenarioId,
            role,
            width,
            height,
            expectedSha256: sha256(expected),
            actualSha256: sha256(actual),
            ...difference
        }, null, 4)}\n`, 'utf8')
    ]);
    if (expected.length === width * height * 4 && actual.length === expected.length) {
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

/** raw RGBA를 byte-exact로 비교하고 실패 artifact를 남깁니다. */
async function assertBytesExact(scenarioId, role, expected, actual, width, height) {
    const difference = analyzeByteDifference(expected, actual, width);
    if (!difference) return;
    const directory = await writeDifferenceArtifacts(
        scenarioId,
        role,
        expected,
        actual,
        width,
        height,
        difference
    );
    throw new Error(
        `${scenarioId}/${role}: RGBA 불일치 byte=${difference.differingByteCount}, `
        + `maxDelta=${difference.maxChannelDelta}, artifacts=${directory}`
    );
}

/** JSON 직렬화 기준 완전 동일성을 검사합니다. */
function assertJsonExact(label, expected, actual) {
    const expectedJson = JSON.stringify(expected);
    const actualJson = JSON.stringify(actual);
    assert(expectedJson === actualJson, `${label} 불일치\nexpected=${expectedJson}\nactual=${actualJson}`);
}

/** raw를 저장하지 않는 표면 해시 불일치의 actual/메타 차이 artifact를 남깁니다. */
async function writeSurfaceHashArtifacts(
    scenarioId,
    category,
    index,
    expectedRecord,
    actualRecord,
    actualBytes
) {
    const artifactRoot = process.env.CIRVIVOR_UI_GOLDEN_ARTIFACT_DIR;
    const role = `${category}.${String(index).padStart(3, '0')}.${actualRecord?.role || expectedRecord.role}`;
    const directory = path.join(artifactRoot, sanitizePathPart(scenarioId), sanitizePathPart(role));
    await fsPromises.mkdir(directory, { recursive: true });
    const keys = [...new Set([...Object.keys(expectedRecord), ...Object.keys(actualRecord || {})])];
    const changedFields = Object.fromEntries(keys
        .filter((key) => JSON.stringify(expectedRecord[key]) !== JSON.stringify(actualRecord?.[key]))
        .map((key) => [key, {
            expected: expectedRecord[key] ?? null,
            actual: actualRecord?.[key] ?? null
        }]));
    const writes = [
        fsPromises.writeFile(
            path.join(directory, 'expected.json'),
            `${JSON.stringify(expectedRecord, null, 4)}\n`,
            'utf8'
        ),
        fsPromises.writeFile(
            path.join(directory, 'actual.json'),
            `${JSON.stringify(actualRecord, null, 4)}\n`,
            'utf8'
        ),
        fsPromises.writeFile(
            path.join(directory, 'diff.json'),
            `${JSON.stringify(changedFields, null, 4)}\n`,
            'utf8'
        ),
        fsPromises.writeFile(path.join(directory, 'actual.rgba'), Buffer.from(actualBytes))
    ];
    if (actualRecord.width * actualRecord.height * 4 === actualBytes.length) {
        writes.push(encodeRgbaToPng(actualBytes, actualRecord.width, actualRecord.height)
            .then((png) => fsPromises.writeFile(path.join(directory, 'actual.png'), png)));
    }
    await Promise.all(writes);
    return directory;
}

/** 승인 manifest의 표면 메타/길이/SHA-256을 실제 raw 결과와 exact 검증합니다. */
async function assertSurfaceRecordExact(
    scenarioId,
    category,
    index,
    expectedRecord,
    actualRecord,
    actualBytes
) {
    if (JSON.stringify(expectedRecord) === JSON.stringify(actualRecord)) return;
    const directory = await writeSurfaceHashArtifacts(
        scenarioId,
        category,
        index,
        expectedRecord,
        actualRecord,
        actualBytes
    );
    throw new Error(
        `${scenarioId}/${category}.${index}: surface hash/metadata 불일치, artifacts=${directory}`
    );
}

/** check 모드에서 승인 hash manifest와 최종 PNG RGBA를 exact 검증합니다. */
async function checkScenarioGolden(goldenRoot, profile, scenarioRecord, capture) {
    const profileDirectory = path.join(goldenRoot, profile.id);
    const manifestPath = path.join(profileDirectory, 'manifest.json');
    let goldenManifest;
    try {
        goldenManifest = JSON.parse(await fsPromises.readFile(manifestPath, 'utf8'));
    } catch (error) {
        if (error?.code === 'ENOENT') {
            throw new Error(`승인된 UI golden profile이 없습니다: ${profile.id}`);
        }
        throw error;
    }
    assert(goldenManifest.schemaVersion === GOLDEN_SCHEMA_VERSION, 'UI golden schemaVersion 불일치');
    assertJsonExact('profile', goldenManifest.profile, profile);
    const expectedRecord = goldenManifest.scenarios.find(({ id }) => id === scenarioRecord.id);
    assert(expectedRecord, `승인 manifest에 시나리오가 없습니다: ${scenarioRecord.id}`);

    assert(expectedRecord.staticSurfaces.length === capture.staticSurfaces.length, `${scenarioRecord.id}: static surface 수 불일치`);
    assert(expectedRecord.dynamicSurfaces.length === capture.dynamicSurfaces.length, `${scenarioRecord.id}: dynamic surface 수 불일치`);
    const pairs = [
        ...expectedRecord.staticSurfaces.map((expectedSurface, index) => ({
            category: 'static',
            index,
            expectedSurface,
            actualRecord: scenarioRecord.staticSurfaces[index],
            actualCapture: capture.staticSurfaces[index]
        })),
        ...expectedRecord.dynamicSurfaces.map((expectedSurface, index) => ({
            category: 'dynamic',
            index,
            expectedSurface,
            actualRecord: scenarioRecord.dynamicSurfaces[index],
            actualCapture: capture.dynamicSurfaces[index]
        }))
    ];
    for (const {
        category,
        index,
        expectedSurface,
        actualRecord,
        actualCapture
    } of pairs) {
        assert(actualRecord && actualCapture, `${scenarioRecord.id}/${category}.${index}: actual surface 누락`);
        await assertSurfaceRecordExact(
            scenarioRecord.id,
            category,
            index,
            expectedSurface,
            actualRecord,
            actualCapture.bytes
        );
    }

    const reviewPng = await fsPromises.readFile(
        path.join(profileDirectory, expectedRecord.final.reviewPng)
    );
    assert(reviewPng.length === expectedRecord.final.reviewPngByteLength, `${scenarioRecord.id}: review PNG byteLength 손상`);
    assert(sha256(reviewPng) === expectedRecord.final.reviewPngSha256, `${scenarioRecord.id}: review PNG SHA-256 손상`);
    const expectedFinal = await decodePngToRgba(reviewPng);
    assert(expectedFinal.width === expectedRecord.final.width, `${scenarioRecord.id}: review PNG width 불일치`);
    assert(expectedFinal.height === expectedRecord.final.height, `${scenarioRecord.id}: review PNG height 불일치`);
    assert(sha256(expectedFinal.bytes) === expectedRecord.final.sha256, `${scenarioRecord.id}: review PNG RGBA SHA-256 손상`);
    await assertBytesExact(
        scenarioRecord.id,
        'final',
        expectedFinal.bytes,
        capture.final.bytes,
        expectedRecord.final.width,
        expectedRecord.final.height
    );
    assertJsonExact(`scenario.${scenarioRecord.id}`, expectedRecord, scenarioRecord);
}

/** launcher 결과 파일을 쓴 뒤 NW 프로세스를 정상 종료합니다. */
async function finish(result) {
    const resultPath = process.env.CIRVIVOR_UI_GOLDEN_RESULT_PATH;
    assert(resultPath, 'launcher result 경로가 없습니다.');
    document.title = `${result.status.toUpperCase()} — ${result.scenarioId || 'UI golden'}`;
    statusElement.textContent = result.status;
    await fsPromises.writeFile(resultPath, `${JSON.stringify(result, null, 4)}\n`, 'utf8');
    console[result.status === 'pass' ? 'log' : 'error'](JSON.stringify(result, null, 2));
    setTimeout(() => nw.App.quit(), 25);
}

/** 지정된 UI 시나리오 하나를 깨끗한 production app state에서 실행합니다. */
async function run() {
    const mode = process.env.CIRVIVOR_UI_GOLDEN_MODE;
    const scenarioId = process.env.CIRVIVOR_UI_GOLDEN_SCENARIO_ID;
    const appRoot = process.env.CIRVIVOR_UI_GOLDEN_APP_ROOT;
    const runRoot = process.env.CIRVIVOR_UI_GOLDEN_SCENARIO_ROOT;
    const goldenRoot = process.env.CIRVIVOR_UI_GOLDEN_ROOT;
    const captureDirectory = process.env.CIRVIVOR_UI_GOLDEN_CAPTURE_DIR;
    assert(mode === 'check' || mode === 'update', `잘못된 모드: ${mode}`);
    assert(scenarioId && appRoot && runRoot && goldenRoot && captureDirectory, 'launcher 환경 변수가 누락되었습니다.');
    process.chdir(runRoot);
    recordProgress(`scenario:${scenarioId}:load-manifest`);
    const manifestPath = path.join(appRoot, 'game', 'test', 'fixtures', 'ui_visual', 'scenarios_v1.json');
    const manifestSource = await fsPromises.readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestSource);
    const scenario = manifest.scenarios.find(({ id }) => id === scenarioId);
    assert(scenario, `시나리오를 찾지 못했습니다: ${scenarioId}`);
    for (const step of scenario.steps) {
        assert(SUPPORTED_ACTIONS.has(step.action), `${scenarioId}: 지원하지 않는 action ${step.action}`);
    }
    assert(process.platform === 'win32', `UI golden은 Windows만 지원합니다: ${process.platform}`);
    assert(process.versions.nw === EXPECTED_NW_VERSION, `NW ${EXPECTED_NW_VERSION} != ${process.versions.nw}`);
    assert(window.devicePixelRatio === 1, `DPR 1 != ${window.devicePixelRatio}`);
    assert(window.innerWidth === 1280 && window.innerHeight === 720, `viewport 1280x720 != ${window.innerWidth}x${window.innerHeight}`);

    const deterministicRuntime = installDeterministicRuntime(manifest.oracle);
    const sideEffects = {
        externalOpenRequests: [],
        devToolsRequests: 0,
        gameCloseRequests: 0,
        windowCloseRequests: 0,
        audioPlayCalls: 0,
        audioPauseCalls: 0
    };
    new TimeHandler();
    new MathUtil();
    new ColorUtil();
    const runtimeTool = new RuntimeTool();
    installSideEffectStubs(runtimeTool, sideEffects);
    await ensureFixtureFont();

    recordProgress(`scenario:${scenarioId}:system-init`);
    const systemHandler = new SystemHandler();
    await systemHandler.init();
    assert(systemHandler.sceneSystem.scene?.constructor?.name === 'LoadingScene', '생산 초기 scene이 LoadingScene이 아닙니다.');
    window.Game = {
        systemHandler,
        close() {
            sideEffects.gameCloseRequests += 1;
        }
    };
    await ensureFixtureFont();
    assert(getSetting('theme') === (scenario.settingsOverride?.theme || manifest.oracle.settings.theme), 'theme 설정 불일치');
    assert(getSetting('renderScale') === 100, 'renderScale 설정 불일치');
    assert(getSetting('uiScale') === 100, 'uiScale 설정 불일치');

    for (let stepIndex = 0; stepIndex < scenario.steps.length; stepIndex++) {
        const step = scenario.steps[stepIndex];
        recordProgress(`scenario:${scenarioId}:step:${stepIndex}:${step.action}`);
        await executeStep(systemHandler, step, deterministicRuntime);
    }
    await ensureTitleIcons(systemHandler);
    assertScenarioReached(systemHandler, scenario, manifest);
    assert(sideEffects.externalOpenRequests.length === 0, `${scenarioId}: 외부 URL 부작용 요청이 발생했습니다.`);
    assert(sideEffects.devToolsRequests === 0, `${scenarioId}: DevTools 부작용 요청이 발생했습니다.`);
    assert(sideEffects.gameCloseRequests === 0, `${scenarioId}: 실제 게임 종료 요청이 발생했습니다.`);
    assert(sideEffects.windowCloseRequests === 0, `${scenarioId}: 실제 창 종료 요청이 발생했습니다.`);

    recordProgress(`scenario:${scenarioId}:capture`);
    const capture = await captureScenario(systemHandler, manifest, deterministicRuntime);
    const profile = await createRuntimeProfile(systemHandler, deterministicRuntime);
    const scenarioRecord = createScenarioRecord(systemHandler, scenario, capture, sideEffects);
    if (mode === 'update') {
        await writeUpdateCapture(captureDirectory, scenarioRecord, capture);
    } else {
        await checkScenarioGolden(goldenRoot, profile, scenarioRecord, capture);
    }
    recordProgress(`scenario:${scenarioId}:complete`);
    const rawByteLength = [
        ...scenarioRecord.staticSurfaces,
        ...scenarioRecord.dynamicSurfaces,
        scenarioRecord.final
    ].reduce((sum, record) => sum + record.byteLength, 0);
    return {
        status: 'pass',
        mode,
        scenarioId,
        suiteId: manifest.suiteId,
        suiteSourceSha256: sha256(Buffer.from(manifestSource, 'utf8')),
        profile,
        scenarioRecord,
        staticSurfaceCount: scenarioRecord.staticSurfaces.length,
        dynamicSurfaceCount: scenarioRecord.dynamicSurfaces.length,
        rawCaptureCount: scenarioRecord.staticSurfaces.length
            + scenarioRecord.dynamicSurfaces.length + 1,
        rawByteLength,
        pngByteLength: scenarioRecord.final.reviewPngByteLength,
        finalSha256: scenarioRecord.final.sha256
    };
}

run()
    .then((result) => finish(result))
    .catch(async (error) => {
        try {
            await finish({
                status: 'fail',
                mode: process.env.CIRVIVOR_UI_GOLDEN_MODE || null,
                scenarioId: process.env.CIRVIVOR_UI_GOLDEN_SCENARIO_ID || null,
                error: error?.stack ?? String(error)
            });
        } catch (finishError) {
            console.error(error?.stack ?? error);
            console.error(finishError?.stack ?? finishError);
            setTimeout(() => nw.App.quit(), 25);
        }
    });
