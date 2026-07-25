import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { loadGameModule } from './support/source_module_loader.mjs';

const FACTORY_URL = new URL(
    '../script/module/ui/element/_ui_element_factory.js',
    import.meta.url
);
const factorySource = await readFile(FACTORY_URL, 'utf8');
const [
    typographyModule,
    typographyResolverModule,
    componentStylesModule,
    componentResolverModule,
    fontUtilModule
] = await Promise.all([
    loadGameModule('ui/style/typography.js'),
    loadGameModule('ui/style/_typography_resolver.js'),
    loadGameModule('ui/style/component_styles.js'),
    loadGameModule('ui/style/_component_style_resolver.js'),
    loadGameModule('util/font_util.js')
]);

/**
 * VM SyntheticModule을 production factory 의존성으로 만듭니다.
 * @param {vm.Context} context - VM 문맥입니다.
 * @param {string} identifier - 모듈 식별자입니다.
 * @param {object} exports - synthetic export입니다.
 * @returns {vm.SyntheticModule} 생성한 모듈입니다.
 */
function createSyntheticModule(context, identifier, exports) {
    return new vm.SyntheticModule(
        Object.keys(exports),
        function initialize() {
            for (const [name, value] of Object.entries(exports)) {
                this.setExport(name, value);
            }
        },
        { context, identifier }
    );
}

/**
 * 실제 UIElementFactory를 저수준 UI 요소 stub과 함께 로드합니다.
 * @returns {Promise<object>} factory와 관찰 기록입니다.
 */
async function createFactoryHarness() {
    const measureCalls = [];
    const textElementInits = [];
    const buttonInits = [];
    const sliderInits = [];
    const context = vm.createContext({ console });

    class IconStub {
        constructor(type, color) {
            this.type = type;
            this.color = color;
        }
    }

    class TextElementStub {
        init(properties) {
            Object.assign(this, properties);
            textElementInits.push(properties);
        }
    }

    class ButtonStub {
        init(properties) {
            this.properties = properties;
            buttonInits.push(properties);
        }
    }

    class SliderStub {
        init(properties) {
            Object.assign(this, properties);
            sliderInits.push(properties);
        }
    }

    const UIPool = {
        text: { get: () => ({}) },
        text_element: { get: () => new TextElementStub() },
        button: { get: () => new ButtonStub() },
        slider: { get: () => new SliderStub() }
    };
    const dependencies = new Map([
        ['display/display_system.js', createSyntheticModule(
            context,
            'display/display_system.js',
            {
                measureText(text, font) {
                    measureCalls.push({ text, font });
                    return 123;
                }
            }
        )],
        ['ui/element/_icon.js', createSyntheticModule(
            context,
            'ui/element/_icon.js',
            { Icon: IconStub }
        )],
        ['ui/_ui_pool.js', createSyntheticModule(
            context,
            'ui/_ui_pool.js',
            { UIPool }
        )],
        ['ui/style/_component_style_resolver.js', createSyntheticModule(
            context,
            'ui/style/_component_style_resolver.js',
            { resolveButtonStyle: componentResolverModule.resolveButtonStyle }
        )],
        ['ui/style/_typography_resolver.js', createSyntheticModule(
            context,
            'ui/style/_typography_resolver.js',
            { resolveTypography: typographyResolverModule.resolveTypography }
        )],
        ['util/font_util.js', createSyntheticModule(
            context,
            'util/font_util.js',
            { createFontString: fontUtilModule.createFontString }
        )]
    ]);
    const factoryModule = new vm.SourceTextModule(factorySource, {
        context,
        identifier: FACTORY_URL.href
    });
    await factoryModule.link((specifier) => {
        const dependency = dependencies.get(specifier);
        if (!dependency) {
            throw new Error(`UIElementFactory 테스트 의존성이 없습니다: ${specifier}`);
        }
        return dependency;
    });
    await factoryModule.evaluate();

    return {
        UIElementFactory: factoryModule.namespace.UIElementFactory,
        measureCalls,
        textElementInits,
        buttonInits,
        sliderInits
    };
}

const layoutHandler = Object.freeze({
    parent: Object.freeze({}),
    layer: 'ui',
    uiScale: 1,
    parseUnit(unit, value, referenceSize) {
        if (unit === 'WW') return value * 10;
        if (unit === 'WH') return value * 5;
        if (unit === 'absolute') return value;
        if (unit === 'parent') return (value / 100) * referenceSize;
        return 0;
    }
});

/**
 * 테스트 레이아웃과 같은 단위 문맥에서 토큰을 해석합니다.
 * @param {object} token - 타이포그래피 토큰입니다.
 * @returns {object} 해석된 메트릭입니다.
 */
function resolveForTestLayout(token) {
    return typographyResolverModule.resolveTypography(token, {
        resolveMetric: (metric) => layoutHandler.parseUnit(
            metric.BASE,
            metric.VALUE,
            500
        )
    });
}

test('text factory는 측정과 렌더에 같은 의미 토큰 폰트를 사용한다', async () => {
    const harness = await createFactoryHarness();
    const text = harness.UIElementFactory.create(
        {
            type: 'text',
            id: 'heading',
            textStyle: typographyModule.TYPOGRAPHY.H1,
            props: {
                text: '제목',
                fill: '#ffffff'
            }
        },
        10,
        20,
        500,
        300,
        undefined,
        layoutHandler
    );
    const expected = resolveForTestLayout(typographyModule.TYPOGRAPHY.H1);

    assert.equal(harness.measureCalls.length, 1);
    assert.equal(harness.measureCalls[0].font, expected.font);
    assert.equal(text.font, expected.font);
    assert.equal(text.width, 123);
    assert.equal(text.height, expected.size);
});

test('button style은 치수·타이포그래피·기본 아이콘을 한 계약으로 적용한다', async () => {
    const harness = await createFactoryHarness();
    const button = harness.UIElementFactory.create(
        {
            type: 'button',
            id: 'link',
            buttonStyle: componentStylesModule.BUTTON_STYLE.OVERLAY_LINK,
            props: {
                text: '링크',
                color: '#ffffff'
            }
        },
        0,
        0,
        500,
        300,
        undefined,
        layoutHandler
    );
    const expectedTypography = resolveForTestLayout(
        typographyModule.TYPOGRAPHY.BUTTON_LINK
    );
    const properties = harness.buttonInits[0];
    const textElement = properties.right[0];

    assert.equal(button.width, 60);
    assert.equal(button.height, 15);
    assert.equal(properties.margin, 6.5);
    assert.equal(properties.radius, 3);
    assert.equal(properties.left[0].type, 'arrow');
    assert.equal(textElement.font, expectedTypography.family);
    assert.equal(textElement.fontWeight, expectedTypography.weight);
    assert.equal(textElement.size, expectedTypography.size);
});

test('slider 값 폰트는 valueTextStyle 토큰에서만 생성된다', async () => {
    const harness = await createFactoryHarness();
    harness.UIElementFactory.create(
        {
            type: 'slider',
            id: 'volume',
            valueTextStyle: typographyModule.TYPOGRAPHY.SLIDER_VALUE,
            props: {}
        },
        0,
        0,
        500,
        300,
        undefined,
        layoutHandler
    );
    const expected = resolveForTestLayout(
        typographyModule.TYPOGRAPHY.SLIDER_VALUE
    );

    assert.equal(harness.sliderInits[0].valueFont, expected.font);
});

test('factory 직접 호출도 raw 타이포그래피 metadata를 거부한다', async () => {
    const harness = await createFactoryHarness();
    for (const propName of [
        'font',
        'fontSize',
        'fontWeight',
        'fontFamily',
        'size',
        'valueFont'
    ]) {
        assert.throws(
            () => harness.UIElementFactory.create(
                {
                    type: 'text',
                    id: `raw-${propName}`,
                    textStyle: typographyModule.TYPOGRAPHY.H1,
                    props: {
                        text: '금지',
                        [propName]: 'raw'
                    }
                },
                0,
                0,
                500,
                300,
                undefined,
                layoutHandler
            ),
            (error) => (
                error?.name === 'TypeError'
                && /raw typography prop/.test(error?.message || '')
            )
        );
    }
});
