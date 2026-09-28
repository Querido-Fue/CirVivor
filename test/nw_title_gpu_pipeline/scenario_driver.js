import {
    getTitleRuntimeState,
    openExternalLinkWarning,
    openSettingsOverlay,
    openWindowModeDropdownThroughInput,
    pinOverlayForCycles,
    releasePinnedOverlay,
    setPanelBlurSigma,
    snapshotOverlayStack
} from './title_harness_adapter.js';
import { getDebugSystem } from 'debug/debug_system.js';
import { getCanvasOffsetX, getCanvasOffsetY, getScaleRatio } from 'display/display_system.js';
import { getTitleShaderSetting, resetTitleShaderSettings, TITLE_SHADER_SETTINGS, setTitleShaderSetting, saveTitleShaderSettings } from 'display/_title_shader_settings.js';
import { SettingHandler } from 'save/_setting_handler.js';
import { fsPromises, nw, path } from 'util/nw_bridge.js';

export const TITLE_SCENARIO_IDS = Object.freeze(['T0', 'T1', 'T2', 'T3', 'T4', 'T5']);
const PRESENTATION_EPSILON = 0.002;

function isOverlayFullyOpen(entry) {
    const controller = entry?.controller;
    return Boolean(controller)
        && Math.abs(controller.alpha - 1) <= PRESENTATION_EPSILON
        && Math.abs(controller.dimAlpha - 1) <= PRESENTATION_EPSILON
        && Math.abs(controller.contentScale - 1) <= PRESENTATION_EPSILON
        && Math.abs(controller.contentBlur) <= PRESENTATION_EPSILON;
}

async function waitFor(context, predicate, label, options = {}) {
    const maxFrames = options.maxFrames || 1800;
    let lastMetadata = null;
    for (let frame = 0; frame < maxFrames; frame++) {
        const value = predicate();
        if (value) {
            return value;
        }
        lastMetadata = options.metadata?.() ?? null;
        await context.nextFrame({
            collect: options.collect === true,
            phase: label,
            ...lastMetadata
        });
    }
    const lastState = lastMetadata === null
        ? ''
        : `; 마지막 상태=${JSON.stringify(lastMetadata)}`;
    throw new Error(`${label} 상태 대기 frame 한도를 초과했습니다: ${maxFrames}${lastState}`);
}

async function collectSteadyFrames(context, phase) {
    for (let index = 0; index < context.config.requestedSamples; index++) {
        await context.nextFrame({ collect: true, phase, sampleIndex: index });
    }
}

async function ensureTitleReady(context) {
    return waitFor(
        context,
        () => getTitleRuntimeState(context.game).menuReady,
        'title-menu-ready',
        { collect: false }
    );
}

async function ensureExternalOverlay(context) {
    if (!context.shared.externalEntry) {
        context.shared.externalEntry = openExternalLinkWarning(context.game);
    }
    await waitFor(
        context,
        () => isOverlayFullyOpen(context.shared.externalEntry),
        'external-open',
        { collect: false }
    );
    return context.shared.externalEntry;
}

async function runClosePhase(context, entry, scenarioId, cycle, sigmaSweep) {
    pinOverlayForCycles(entry);
    const targetGeneration = entry.__titleGpuCloseGeneration + 1;
    let collectedFrameCount = 0;
    entry.controller.close();
    await waitFor(context, () => entry.__titleGpuCloseGeneration >= targetGeneration, 'overlay-close', {
        collect: true,
        metadata: () => {
            collectedFrameCount += 1;
            const fade = Math.max(0, Math.min(1, Number(entry.controller.alpha) || 0));
            const sigma = sigmaSweep ? setPanelBlurSigma(entry, 0.1 + ((1 - fade) * 11.9)) : null;
            return { scenarioId, cycle, transition: 'close', fade, backdropSigma: sigma };
        }
    });
    return collectedFrameCount;
}

async function runOpenPhase(context, entry, scenarioId, cycle, sigmaSweep) {
    let collectedFrameCount = 0;
    entry.controller.open();
    await waitFor(context, () => isOverlayFullyOpen(entry), 'overlay-open', {
        collect: true,
        metadata: () => {
            collectedFrameCount += 1;
            const fade = Math.max(0, Math.min(1, Number(entry.controller.alpha) || 0));
            const sigma = sigmaSweep ? setPanelBlurSigma(entry, 0.1 + ((1 - fade) * 11.9)) : null;
            return { scenarioId, cycle, transition: 'open', fade, backdropSigma: sigma };
        }
    });
    if (sigmaSweep) {
        setPanelBlurSigma(entry, 0.1);
    }
    return collectedFrameCount;
}

async function runT0(context) {
    const checkpoints = new Set();
    await waitFor(context, () => {
        const state = getTitleRuntimeState(context.game);
        if (state.introStarted) checkpoints.add('loading-intro-started');
        if (state.handoffReady) checkpoints.add('loading-handoff-ready');
        if (state.sceneState === 'title') checkpoints.add('title-scene');
        if (state.transitionProgress !== null && state.transitionProgress >= 0.5) {
            checkpoints.add('title-intro-half');
        }
        return state.menuReady ? state : null;
    }, 'T0-loading-to-menu', {
        collect: true,
        metadata: () => {
            const state = getTitleRuntimeState(context.game);
            return {
                sceneState: state.sceneState,
                introStarted: state.introStarted,
                handoffReady: state.handoffReady,
                transitionProgress: state.transitionProgress,
                menuReady: state.menuReady
            };
        }
    });
    checkpoints.add('menu-ready');
    return { checkpoints: [...checkpoints] };
}

async function runT1(context) {
    await ensureTitleReady(context);
    const shaderEditor = context.config.profile === 'qa' ? await probeShaderEditor(context) : null;
    await collectSteadyFrames(context, 'title-steady');
    const titleState = getTitleRuntimeState(context.game);
    return {
        titleMenuLayers: titleState.titleMenu?.session?.getLayerIds?.() || null,
        shaderEditor
    };
}

/** QA-only production input probe; never changes timed performance scenarios. */
async function probeShaderEditor(context) {
    const debug = getDebugSystem();
    const previousMode = debug.debugModeEnabled;
    const previousControls = debug.getControlState();
    const menu = getTitleRuntimeState(context.game).titleMenu;
    const session = menu.session;
    const cards = menu.cards;
    const next = () => context.nextFrame({ collect: false, phase: 'shader-editor-probe' });
    const check = (condition, label) => { if (!condition) throw new Error('Shader editor: ' + label); };
    const point = (x, y) => ({
        clientX: x / getScaleRatio() + getCanvasOffsetX(),
        clientY: y / getScaleRatio() + getCanvasOffsetY()
    });
    const mouse = (type, p) => window.dispatchEvent(new MouseEvent(type, {
        bubbles: true, button: 0, buttons: type === 'mousedown' ? 1 : 0, ...p
    }));
    const click = async (x, y) => {
        const p = point(x, y);
        mouse('mousemove', p); await next();
        mouse('mousedown', p); await next();
        mouse('mouseup', p); await next(); await next();
    };
    const capture = async name => {
        if (!context.config.capture) return;
        context.game.stop();
        try {
            const buffer = await new Promise(resolve => nw.Window.get().capturePage(resolve, { format: 'png', datatype: 'buffer' }));
            const directory = process.env.CIRVIVOR_TITLE_GPU_ARTIFACT_DIR;
            await fsPromises.mkdir(directory, { recursive: true });
            await fsPromises.writeFile(path.join(directory, name + '.png'), buffer);
        } finally { context.game.start(); }
    };
    let first, last;
    try {
        debug.applyRuntimeSettings({ debugMode: true });
        for (const key of ['frameTime', 'poolInfo', 'hitboxes']) debug.setControlOption(key, false);
        const manager = context.game.systemHandler.overlayManager;
        const id = manager.openDebugOverlay(debug);
        const entry = manager.entries.get(id);
        await waitFor(context, () => isOverlayFullyOpen(entry), 'shader-debug-open');
        const toggle = entry.controller.dynamicItems.find(item => item.id === 'debug_control_titleShaderSettings')?.item;
        check(toggle, 'debug toggle missing');
        await click(toggle.x + toggle.width / 2, toggle.y + toggle.height / 2);
        check(debug.isControlOptionActive('titleShaderSettings'), 'debug toggle did not enable editor');
        entry.controller.close();
        await waitFor(context, () => !manager.hasAnyOverlay(), 'shader-debug-close');
        await next();
        check(menu.shaderEditor.active && !menu.pointerEnabled, 'menu input was not replaced');
        const editor = menu.shaderEditor;
        first = editor.rows[0].setting.id;
        const slider = editor.rows[0].slider;
        const previous = getTitleShaderSetting(first);
        await click(slider.x + slider.width * .75, slider.y + slider.height / 2 - slider.trackHeight / 2);
        await capture('shader-editor-top');
        check(getTitleShaderSetting(first) !== previous, 'slider did not update runtime value: ' + JSON.stringify({
            previous, current: getTitleShaderSetting(first), sliderValue: slider.value,
            dragging: slider.dragging, clickAble: slider.clickAble, layer: slider.layer
        }));
        const save = context.game.systemHandler.saveSystem;
        check(save.getSetting('titleShaderSettings')?.[first] === getTitleShaderSetting(first), 'slider commit was not autosaved');
        await saveTitleShaderSettings();
        const restored = new SettingHandler(save.dataDir);
        await restored.init();
        check(restored.get('titleShaderSettings')?.[first] === getTitleShaderSetting(first), 'saved file did not restore shader value');
        const p = point(editor.bounds.x + editor.bounds.w / 2, editor.bounds.y + editor.bounds.h / 2);
        mouse('mousemove', p); await next();
        for (let i = 0; i < TITLE_SHADER_SETTINGS.length; i++) {
            window.dispatchEvent(new WheelEvent('wheel', { deltaY: 400, deltaMode: 0, ...p }));
        }
        await next(); await next();
        last = editor.rows.at(-1).setting.id;
        check(last === TITLE_SHADER_SETTINGS.at(-1).id, 'wheel did not reach last setting');
        await capture('shader-editor-bottom');
        for (let i = 0; i < TITLE_SHADER_SETTINGS.length; i++) {
            window.dispatchEvent(new WheelEvent('wheel', { deltaY: -400, deltaMode: 0, ...p }));
        }
        await next(); await next();
        check(editor.first === 0, 'wheel did not return to first setting');
        const resetButton = editor.entries.find(entry => entry.id === 'reset_shader_settings').item;
        await click(resetButton.x + resetButton.width / 2, resetButton.y + resetButton.height / 2);
        check(getTitleShaderSetting(first) === previous, 'reset button did not restore defaults');
        // Resize must retain the control which currently owns a drag.
        const retainedSlider = editor.rows[0].slider;
        const dragPoint = point(retainedSlider.x + retainedSlider.width / 2,
            retainedSlider.y + retainedSlider.height / 2 - retainedSlider.trackHeight / 2);
        mouse('mousemove', dragPoint); await next();
        mouse('mousedown', dragPoint); await next();
        check(retainedSlider.dragging, 'drag did not start');
        menu.resize(menu.uiScale * .9); await next();
        check(editor.rows[0].slider === retainedSlider && retainedSlider.dragging, 'resize lost drag ownership');
        mouse('mouseup', dragPoint); await next();
        menu.resize(); await next();
        // Exercise legal extrema against real shader compilation/execution.
        for (const setting of TITLE_SHADER_SETTINGS) setTitleShaderSetting(setting.id, setting.max);
        await next(); await next();
        for (const setting of TITLE_SHADER_SETTINGS) setTitleShaderSetting(setting.id, setting.min);
        await next(); await next();
        resetTitleShaderSettings();
        debug.setControlOption('titleShaderSettings', false);
        await next(); await next();
        check(!editor.active && menu.pointerEnabled, 'menu was not restored');
        check(menu.cards === cards && menu.session === session, 'menu/session identities changed');
        check(editor.entries.length === 0, 'editor controls were not released');
        return { passed: true, count: TITLE_SHADER_SETTINGS.length, first, last,
            input: 'production DOM', extrema: true, reset: true, resizeDuringDrag: true, persistence: true };
    } finally {
        resetTitleShaderSettings();
        for (const [key, value] of Object.entries(previousControls)) debug.setControlOption(key, value);
        debug.applyRuntimeSettings({ debugMode: previousMode });
    }
}

async function runT2(context) {
    await ensureTitleReady(context);
    const entry = await ensureExternalOverlay(context);
    await collectSteadyFrames(context, 'external-steady');
    return { overlay: snapshotOverlayStack(context.game), layers: entry.session.getLayerIds() };
}

async function runT3(context) {
    const entry = pinOverlayForCycles(await ensureExternalOverlay(context));
    for (let cycle = 0; cycle < context.config.cycles; cycle++) {
        await runClosePhase(context, entry, 'T3', cycle, false);
        await runOpenPhase(context, entry, 'T3', cycle, false);
    }
    return { cycles: context.config.cycles, overlay: snapshotOverlayStack(context.game) };
}

async function runT4(context) {
    const entry = pinOverlayForCycles(await ensureExternalOverlay(context));
    let cycle = 0;
    let closeSampleFrames = 0;
    let openSampleFrames = 0;
    const maxCycles = Math.max(
        context.config.cycles * 4,
        context.config.requestedSamples + context.config.cycles
    );
    while (cycle < context.config.cycles
        || closeSampleFrames < context.config.requestedSamples
        || openSampleFrames < context.config.requestedSamples) {
        if (cycle >= maxCycles) {
            throw new Error('T4 open/close 표본 목표를 bounded cycle 안에 채우지 못했습니다.');
        }
        closeSampleFrames += await runClosePhase(context, entry, 'T4', cycle, true);
        openSampleFrames += await runOpenPhase(context, entry, 'T4', cycle, true);
        cycle += 1;
    }
    return {
        minimumCycles: context.config.cycles,
        actualCycles: cycle,
        closeSampleFrames,
        openSampleFrames,
        sigmaRange: [0.1, 12],
        overlay: snapshotOverlayStack(context.game)
    };
}

async function runT5(context) {
    if (context.shared.externalEntry) {
        releasePinnedOverlay(context.game, context.shared.externalEntry);
        context.shared.externalEntry = null;
        await context.nextFrame({ collect: false, phase: 'external-release' });
    }
    const entry = openSettingsOverlay(context.game);
    await waitFor(context, () => isOverlayFullyOpen(entry), 'settings-open', { collect: false });
    const dropdown = await openWindowModeDropdownThroughInput(entry, context.nextFrame);
    await waitFor(context, () => dropdown.openProgress >= 0.98, 'dropdown-progress', { collect: false });
    const layers = entry.session.getLayerIds();
    if (!layers.floatingEffectLayerId || !layers.floatingUILayerId) {
        throw new Error('Settings dropdown floating effect/UI surface가 생성되지 않았습니다.');
    }
    await collectSteadyFrames(context, 'settings-floating-steady');
    return { layers, dropdownOpenProgress: dropdown.openProgress, overlay: snapshotOverlayStack(context.game) };
}

const SCENARIO_RUNNERS = Object.freeze({
    T0: runT0,
    T1: runT1,
    T2: runT2,
    T3: runT3,
    T4: runT4,
    T5: runT5
});

/**
 * 지정 scenario를 production title/overlay API 위에서 실행합니다.
 * @param {string} scenarioId - T0~T5입니다.
 * @param {object} context - runner context입니다.
 * @returns {Promise<object>} scenario 상태 결과입니다.
 */
export async function runTitleScenario(scenarioId, context) {
    const runner = SCENARIO_RUNNERS[scenarioId];
    if (!runner) {
        throw new Error(`지원하지 않는 title scenario입니다: ${scenarioId}`);
    }
    return runner(context);
}

/** title steady 경계를 다른 profile도 재사용합니다. */
export { ensureTitleReady };
