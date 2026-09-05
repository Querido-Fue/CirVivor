import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { loadGameModule } from './support/source_module_loader.mjs';

const { SETTING_DEFINITIONS } = await loadGameModule(
    'data/settings/setting_definitions.js'
);
const {
    createSettingSchema,
    quantizeSettingNumericValue,
    SettingValueCoercer
} = await loadGameModule('save/setting/_setting_schema.js');

/**
 * VM 테스트 의존성을 제공하는 synthetic module을 생성합니다.
 * @param {vm.Context} context - 모듈 실행 문맥입니다.
 * @param {string} identifier - 모듈 식별자입니다.
 * @param {Record<string, *>} exports - 노출할 export입니다.
 * @returns {vm.SyntheticModule} 생성된 모듈입니다.
 */
function createSyntheticModule(context, identifier, exports) {
    return new vm.SyntheticModule(Object.keys(exports), function initialize() {
        for (const [name, value] of Object.entries(exports)) {
            this.setExport(name, value);
        }
    }, { context, identifier });
}

test('tooltip delay definition is the frozen 0.01-second canonical contract', () => {
    const definition = SETTING_DEFINITIONS.tooltipDelaySeconds;
    assert.equal(Object.isFrozen(definition), true);
    assert.deepEqual(
        {
            type: definition.type,
            defaultValue: definition.defaultValue,
            min: definition.min,
            max: definition.max,
            step: definition.step,
            precision: definition.precision,
            hidden: definition.hidden
        },
        {
            type: 'float',
            defaultValue: 0.3,
            min: 0,
            max: 2,
            step: 0.01,
            precision: 2,
            hidden: false
        }
    );

    const uiDurationScale = SETTING_DEFINITIONS.uiAnimationDurationScale;
    assert.equal(Object.isFrozen(uiDurationScale), true);
    assert.deepEqual(
        {
            type: uiDurationScale.type,
            defaultValue: uiDurationScale.defaultValue,
            min: uiDurationScale.min,
            max: uiDurationScale.max,
            hidden: uiDurationScale.hidden
        },
        {
            type: 'float',
            defaultValue: 1,
            min: 0.1,
            max: 4,
            hidden: true
        }
    );
});

test('setting coercion matches the Slider half-up step grid and preserves safe current values', () => {
    const schema = createSettingSchema('english');
    const coercer = new SettingValueCoercer();

    for (const [input, expected] of [
        [-1, 0],
        [0.004, 0],
        [0.005, 0.01],
        [0.014, 0.01],
        [0.015, 0.02],
        [0.345, 0.35],
        [2.001, 2]
    ]) {
        assert.equal(
            coercer.coerce(schema, 'tooltipDelaySeconds', input),
            expected,
            `${input}`
        );
    }

    schema.tooltipDelaySeconds.value = 0.27;
    assert.equal(
        coercer.coerce(schema, 'tooltipDelaySeconds', Number.NaN),
        0.27
    );

    assert.equal(coercer.coerce(schema, 'uiAnimationDurationScale', 'bad'), 1);
    assert.equal(coercer.coerce(schema, 'uiAnimationDurationScale', 0), 0.1);
    assert.equal(coercer.coerce(schema, 'uiAnimationDurationScale', 5), 4);
    assert.equal(coercer.coerce(schema, 'uiAnimationDurationScale', 0.5), 0.5);
});

async function createSettingsStateHarness() {
    const source = await readFile(
        new URL('../project/game/script/module/overlay/title/settings/_settings_state.js', import.meta.url),
        'utf8'
    );
    const settings = {
        windowMode: 'fullscreen',
        widescreenSupport: true,
        renderScale: 100,
        uiScale: 100,
        disableTransparency: false,
        tooltipDelaySeconds: 0.27,
        language: 'english',
        theme: 'dark',
        bgmVolume: 25,
        sfxVolume: 40
    };
    const context = vm.createContext({ console });
    const module = new vm.SourceTextModule(source, {
        context,
        identifier: '_settings_state.js'
    });
    const dependencies = new Map([
        ['ui/ui_system.js', createSyntheticModule(context, 'ui/ui_system.js', {
            getLangString: (key) => key
        })],
        ['save/save_system.js', createSyntheticModule(context, 'save/save_system.js', {
            getSetting: (key) => settings[key]
        })],
        ['data/settings/setting_definitions.js', createSyntheticModule(
            context,
            'data/settings/setting_definitions.js',
            { SETTING_DEFINITIONS }
        )],
        ['save/setting/_setting_schema.js', createSyntheticModule(
            context,
            'save/setting/_setting_schema.js',
            { quantizeSettingNumericValue }
        )],
        ['util/number_util.js', createSyntheticModule(context, 'util/number_util.js', {
            clampNumber: (value, min, max) => Math.max(min, Math.min(max, value))
        })]
    ]);
    await module.link((specifier) => dependencies.get(specifier));
    await module.evaluate();
    return { namespace: module.namespace, settings };
}

test('settings state normalizes and formats canonical English/Korean two-decimal values', async () => {
    const harness = await createSettingsStateHarness();
    const {
        createSettingsInitialState,
        formatTooltipDelayValue,
        normalizeTooltipDelaySeconds
    } = harness.namespace;

    const initial = createSettingsInitialState({
        availableLanguages: [{ key: 'english' }, { key: 'korean' }],
        defaultThemeKey: 'dark'
    });
    assert.equal(initial.tooltipDelaySeconds, 0.27);

    for (const [input, expected] of [
        [-1, 0],
        [0.004, 0],
        [0.005, 0.01],
        [0.014, 0.01],
        [0.015, 0.02],
        [0.345, 0.35],
        [2.001, 2],
        [Number.NaN, 0.3]
    ]) {
        assert.equal(normalizeTooltipDelaySeconds(input), expected, `${input}`);
    }

    for (const [value, english, korean] of [
        [0, '0.00s', '0.00초'],
        [0.01, '0.01s', '0.01초'],
        [0.3, '0.30s', '0.30초'],
        [1.27, '1.27s', '1.27초'],
        [2, '2.00s', '2.00초']
    ]) {
        assert.equal(formatTooltipDelayValue(value, 'english'), english);
        assert.equal(formatTooltipDelayValue(value, 'korean'), korean);
    }

    delete harness.settings.tooltipDelaySeconds;
    const fallback = createSettingsInitialState({
        availableLanguages: [{ key: 'english' }],
        defaultThemeKey: 'dark'
    });
    assert.equal(fallback.tooltipDelaySeconds, 0.3);
});

async function createTooltipHarness() {
    const source = await readFile(
        new URL('../project/game/script/module/ui/tooltip/ui_tooltip.js', import.meta.url),
        'utf8'
    );
    const runtime = {
        delta: 0.1,
        tooltipDelaySeconds: 0.3
    };
    const renderCalls = [];
    const context = vm.createContext({ console });
    const module = new vm.SourceTextModule(source, {
        context,
        identifier: 'ui_tooltip.js'
    });
    const dependencies = new Map([
        ['display/display_system.js', createSyntheticModule(
            context,
            'display/display_system.js',
            {
                getDisplaySystem: () => null,
                getWH: () => 1080,
                getWW: () => 1920,
                measureText: (text) => text.length * 8,
                render: (layer, command) => renderCalls.push({ layer, command })
            }
        )],
        ['display/_theme_handler.js', createSyntheticModule(
            context,
            'display/_theme_handler.js',
            {
                ColorSchemes: {
                    Overlay: {
                        Panel: { Background: '#000' },
                        Text: { Control: '#fff', Item: '#ddd' }
                    },
                    Title: { TextDark: '#fff' }
                }
            }
        )],
        ['game/time_handler.js', createSyntheticModule(context, 'game/time_handler.js', {
            getDelta: () => runtime.delta
        })],
        ['input/input_system.js', createSyntheticModule(context, 'input/input_system.js', {
            getMouseInput: () => 0
        })],
        ['save/save_system.js', createSyntheticModule(context, 'save/save_system.js', {
            getSetting: (key) => key === 'tooltipDelaySeconds'
                ? runtime.tooltipDelaySeconds
                : 100
        })],
        ['data/settings/setting_definitions.js', createSyntheticModule(
            context,
            'data/settings/setting_definitions.js',
            { SETTING_DEFINITIONS }
        )],
        ['ui/layout/_positioning_handler.js', createSyntheticModule(
            context,
            'ui/layout/_positioning_handler.js',
            {
                parseUIData: (metric) => typeof metric === 'number'
                    ? metric
                    : Number(metric?.VALUE ?? 10)
            }
        )],
        ['ui/style/_typography_resolver.js', createSyntheticModule(
            context,
            'ui/style/_typography_resolver.js',
            {
                resolveTypography: () => ({
                    font: '12px sans-serif',
                    size: 12,
                    lineHeight: 14
                })
            }
        )],
        ['ui/style/typography.js', createSyntheticModule(context, 'ui/style/typography.js', {
            TYPOGRAPHY: {
                TOOLTIP_TITLE: Object.freeze({}),
                TOOLTIP_BODY: Object.freeze({})
            }
        })],
        ['util/font_util.js', createSyntheticModule(context, 'util/font_util.js', {
            wrapTextByCharacters: (text) => [text]
        })],
        ['util/number_util.js', createSyntheticModule(context, 'util/number_util.js', {
            clampNumber: (value, min, max) => Math.max(min, Math.min(max, value))
        })]
    ]);
    await module.link((specifier) => dependencies.get(specifier));
    await module.evaluate();
    return {
        UITooltipSystem: module.namespace.UITooltipSystem,
        renderCalls,
        runtime
    };
}

function drawTooltipFrame(tooltip, content = 'tooltip') {
    tooltip.beginFrame();
    if (content !== null) {
        tooltip.request(content);
    }
    tooltip.draw();
}

test('tooltip runtime honors exact 0.27, canonical fallback, zero delay, and unchanged fade', async () => {
    const harness = await createTooltipHarness();

    harness.runtime.tooltipDelaySeconds = 0.27;
    harness.runtime.delta = 0.27;
    const exactTooltip = new harness.UITooltipSystem();
    exactTooltip.layer = 'tooltip';
    drawTooltipFrame(exactTooltip);
    assert.equal(exactTooltip.displayAlpha, 0);
    drawTooltipFrame(exactTooltip);
    assert.equal(exactTooltip.displayAlpha, 1);

    for (const invalidValue of [undefined, Number.NaN]) {
        harness.runtime.tooltipDelaySeconds = invalidValue;
        harness.runtime.delta = 0.29;
        const fallbackTooltip = new harness.UITooltipSystem();
        fallbackTooltip.layer = 'tooltip';
        drawTooltipFrame(fallbackTooltip);
        drawTooltipFrame(fallbackTooltip);
        assert.equal(fallbackTooltip.displayAlpha, 0);
        drawTooltipFrame(fallbackTooltip);
        assert.equal(fallbackTooltip.displayAlpha, 1);
    }

    harness.runtime.tooltipDelaySeconds = 0;
    harness.runtime.delta = 0.1;
    const immediateTooltip = new harness.UITooltipSystem();
    immediateTooltip.layer = 'tooltip';
    drawTooltipFrame(immediateTooltip);
    assert.equal(immediateTooltip.displayAlpha, 0.5);
    assert.ok(harness.renderCalls.length > 0);

    drawTooltipFrame(immediateTooltip, null);
    assert.equal(immediateTooltip.displayAlpha, 0);
    assert.equal(immediateTooltip.displayContent, null);
});
