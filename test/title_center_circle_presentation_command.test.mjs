import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const CENTER_PATH = fileURLToPath(new URL(
    '../project/game/script/module/scene/title/_title_center_circle.js',
    import.meta.url
));
const COMMAND_PATH = fileURLToPath(new URL(
    '../project/game/script/module/scene/title/center_circle/_title_center_circle_render_command.js',
    import.meta.url
));
const [centerSource, commandSource] = await Promise.all([
    readFile(CENTER_PATH, 'utf8'),
    readFile(COMMAND_PATH, 'utf8')
]);

function createSyntheticModule(context, identifier, exports) {
    return new vm.SyntheticModule(Object.keys(exports), function initialize() {
        for (const [name, value] of Object.entries(exports)) {
            this.setExport(name, value);
        }
    }, { context, identifier });
}

async function loadCenterHarness() {
    const effectCanvas = { id: 'effect', style: { filter: 'sentinel-filter' } };
    const backgroundCanvas = { id: 'background' };
    const objectCanvas = { id: 'object' };
    const canvases = new Map([
        ['effect', effectCanvas],
        ['background', backgroundCanvas],
        ['object', objectCanvas]
    ]);
    const records = {
        getCanvasNames: [],
        renderCalls: []
    };
    const constants = Object.freeze({
        INTRO_BLUR_START_PX: 10,
        CIRCLE_CENTER_X_RATIO: 0.35,
        CIRCLE_CENTER_Y_RATIO: 0.5,
        CIRCLE_RADIUS_WH_RATIO: 0.115,
        CIRCLE_RADIUS_UIWW_RATIO: 0.22,
        OUTLINE_WIDTH_WH_RATIO: 0.00085,
        CIRCLE_SHADER: Object.freeze({
            ALPHA: 0.92,
            GLOW_STRENGTH: 0.12,
            GLOW_COMPENSATION_STRENGTH_SCALE: 0.08,
            GLASS_STRENGTH: 0.62,
            BRIGHTNESS_BOOST: 0.08,
            BODY_RADIUS_EXPAND_OUTLINE_RATIO: 0.58,
            BACKDROP_BLUR: 6.5,
            BACKDROP_BLUR_STRENGTH: 0.36,
            BACKDROP_REFRACTION_STRENGTH: 5.2,
            SCISSOR_PADDING_RADIUS_RATIO: 0.86,
            SCISSOR_PADDING_MIN_PX: 28
        })
    });
    const colors = Object.freeze({
        base: Object.freeze([0.1, 0.2, 0.3]),
        deep: Object.freeze([0.2, 0.3, 0.4]),
        rim: Object.freeze([0.3, 0.4, 0.5]),
        highlight: Object.freeze([0.8, 0.9, 1])
    });
    const context = vm.createContext({ console });
    const numberModule = createSyntheticModule(context, 'util/number_util.js', {
        clamp01: (value) => Math.max(0, Math.min(1, value)),
        clampFiniteNumber: (value, minimum, maximum, fallback) => (
            Number.isFinite(value)
                ? Math.max(minimum, Math.min(maximum, value))
                : fallback
        ),
        resolveFiniteNumber: (value, fallback) => Number.isFinite(value) ? value : fallback
    });
    const constantsModule = createSyntheticModule(context, '_title_runtime_constants.js', {
        TITLE_LOADING_CONSTANTS: constants
    });
    const modules = new Map([
        ['display/display_system.js', createSyntheticModule(context, 'display/display_system.js', {
            getCanvas(name) {
                records.getCanvasNames.push(name);
                return canvases.get(name) || null;
            },
            getUIOffsetX: () => 200,
            getUIWW: () => 1600,
            getWH: () => 1000,
            renderGL(layer, command) {
                records.renderCalls.push({ layer, command });
            }
        })],
        ['game/time_handler.js', createSyntheticModule(context, 'game/time_handler.js', {
            getDelta: () => 1 / 60
        })],
        ['util/number_util.js', numberModule],
        ['./_title_runtime_constants.js', constantsModule],
        ['../_title_runtime_constants.js', constantsModule],
        ['display/webgl/_webgl_constants.js', createSyntheticModule(
            context,
            'display/webgl/_webgl_constants.js',
            { EFFECT_TYPES: Object.freeze({ TITLE_LOADING_CIRCLE: 'titleLoadingCircle' }) }
        )],
        ['./_title_center_circle_theme.js', createSyntheticModule(
            context,
            '_title_center_circle_theme.js',
            { getLoadingCircleShaderColors: () => colors }
        )]
    ]);
    const commandModule = new vm.SourceTextModule(commandSource, {
        context,
        identifier: COMMAND_PATH
    });
    const centerModule = new vm.SourceTextModule(centerSource, {
        context,
        identifier: CENTER_PATH
    });
    modules.set('./center_circle/_title_center_circle_render_command.js', commandModule);
    await centerModule.link((specifier) => {
        const dependency = modules.get(specifier);
        if (!dependency) {
            throw new Error(`unknown dependency: ${specifier}`);
        }
        return dependency;
    });
    await centerModule.evaluate();
    return {
        TitleCenterCircle: centerModule.namespace.TitleCenterCircle,
        effectCanvas,
        backgroundCanvas,
        objectCanvas,
        colors,
        records
    };
}

test('presentation getter와 legacy draw는 같은 command authority를 사용하고 getter는 CSS blur를 건드리지 않는다', async () => {
    const harness = await loadCenterHarness();
    const circle = new harness.TitleCenterCircle();
    circle.glowPhase = 1.75;
    circle.glowCompensationScale = 2;
    circle.setVisualScale(0.5);
    circle.setPlacementProgress(0.25);
    circle.introBlur = 7;

    const command = circle.getPresentationCommand();
    assert.equal(harness.effectCanvas.style.filter, 'sentinel-filter');
    assert.deepEqual(harness.records.getCanvasNames, []);
    assert.deepEqual(Array.from(command.blurSourceCanvases), []);
    assert.deepEqual({
        effectType: command.effectType,
        x: command.x,
        y: command.y,
        radius: command.radius,
        outlineWidth: command.outlineWidth,
        time: command.time,
        alpha: command.alpha,
        glowStrength: command.glowStrength,
        glassStrength: command.glassStrength,
        brightnessBoost: command.brightnessBoost,
        bodyRadiusExpandOutlineRatio: command.bodyRadiusExpandOutlineRatio,
        backdropBlur: command.backdropBlur,
        backdropBlurStrength: command.backdropBlurStrength,
        backdropRefractionStrength: command.backdropRefractionStrength,
        scissorPaddingRatio: command.scissorPaddingRatio,
        scissorPaddingMin: command.scissorPaddingMin
    }, {
        effectType: 'titleLoadingCircle',
        x: 890,
        y: 500,
        radius: 57.5,
        outlineWidth: 1,
        time: 1.75,
        alpha: 0.92,
        glowStrength: 0.1296,
        glassStrength: 0.62,
        brightnessBoost: 0.08,
        bodyRadiusExpandOutlineRatio: 0.58,
        backdropBlur: 6.5,
        backdropBlurStrength: 0.36,
        backdropRefractionStrength: 5.2,
        scissorPaddingRatio: 0.86,
        scissorPaddingMin: 28
    });
    assert.deepEqual({
        base: Array.from(command.colors.base),
        deep: Array.from(command.colors.deep),
        rim: Array.from(command.colors.rim),
        highlight: Array.from(command.colors.highlight)
    }, harness.colors);

    const legacyCommand = circle.getPresentationCommand({ includeLegacyBlurSources: true });
    assert.equal(harness.effectCanvas.style.filter, 'sentinel-filter');
    assert.deepEqual(harness.records.getCanvasNames, ['background', 'object']);
    assert.deepEqual(Array.from(legacyCommand.blurSourceCanvases), [
        harness.backgroundCanvas,
        harness.objectCanvas
    ]);

    circle.draw();
    assert.equal(harness.effectCanvas.style.filter, 'blur(7px)');
    assert.deepEqual(harness.records.getCanvasNames, [
        'background',
        'object',
        'effect',
        'background',
        'object'
    ]);
    assert.equal(harness.records.renderCalls.length, 1);
    assert.equal(harness.records.renderCalls[0].layer, 'effect');
    assert.deepEqual(harness.records.renderCalls[0].command, legacyCommand);
});
