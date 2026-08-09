import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { loadGameModule } from './support/source_module_loader.mjs';

const SCRIPT_ROOT = fileURLToPath(new URL('../script/', import.meta.url));
const LAYOUT_HANDLER_PATH = path.join(
    SCRIPT_ROOT,
    'module',
    'ui',
    'layout',
    '_layout_handler.js'
);
const OVERLAY_LAYOUT_RECIPES_PATH = path.join(
    SCRIPT_ROOT,
    'module',
    'overlay',
    '_overlay_layout_recipes.js'
);
const SETTINGS_OVERLAY_PATH = path.join(
    SCRIPT_ROOT,
    'module',
    'overlay',
    'title',
    '_settings_overlay.js'
);
const LEGACY_UI_CONSTANTS_PATH = path.join(
    SCRIPT_ROOT,
    'module',
    'ui',
    '_ui_constants.js'
);
const FEATURE_ROOTS = Object.freeze([
    path.join(SCRIPT_ROOT, 'module', 'overlay'),
    path.join(SCRIPT_ROOT, 'module', 'ui', 'tooltip'),
    path.join(SCRIPT_ROOT, 'module', 'scene', 'title'),
    path.join(SCRIPT_ROOT, 'module', 'scene', 'game', 'render')
]);
const FEATURE_EXCLUDED_FILES = new Set([
    path.join(SCRIPT_ROOT, 'module', 'overlay', '_debug_overlay.js')
]);
const TYPOGRAPHY_ADAPTER_FILES = new Set([
    path.join(
        SCRIPT_ROOT,
        'module',
        'overlay',
        'title',
        '_title_overlay.js'
    ),
    path.join(
        SCRIPT_ROOT,
        'module',
        'ui',
        'tooltip',
        'ui_tooltip.js'
    ),
    path.join(
        SCRIPT_ROOT,
        'module',
        'scene',
        'title',
        'menu',
        '_title_menu_text_layout.js'
    )
]);
const TYPOGRAPHY_RESOLVER_IMPORT_PATTERN = /from\s*['"]ui\/style\/_typography_resolver\.js['"]/;
const FORBIDDEN_TYPOGRAPHY_PROPS = Object.freeze([
    'font',
    'fontSize',
    'fontWeight',
    'fontFamily',
    'size',
    'valueFont'
]);
const FEATURE_SOURCE_RULES = Object.freeze([
    Object.freeze({
        label: 'legacy TEXT_CONSTANTS 참조',
        pattern: /\bTEXT_CONSTANTS\b/
    }),
    Object.freeze({
        label: 'raw FONT.SIZE/WEIGHT/FAMILY 접근',
        pattern: /\.FONT\s*(?:(?:\?\.)|\.)\s*(?:SIZE|WEIGHT|FAMILY)\b|\.FONT\s*\[\s*['"](?:SIZE|WEIGHT|FAMILY)['"]\s*\]/
    }),
    Object.freeze({
        label: 'legacy stylePreset() 호출',
        pattern: /\.stylePreset\s*\(/
    }),
    Object.freeze({
        label: 'prop()을 통한 raw 타이포그래피 주입',
        pattern: /\.prop\s*\(\s*['"](?:font|fontSize|fontWeight|fontFamily|size|valueFont)['"]/
    }),
    Object.freeze({
        label: 'feature 코드의 createFontString import',
        pattern: /\bimport\s*\{[^}]*\bcreateFontString\b[^}]*\}\s*from\s*['"]util\/font_util\.js['"]/
    }),
    Object.freeze({
        label: 'feature 코드의 createFontString 직접 호출',
        pattern: /\bcreateFontString\s*\(/
    }),
    Object.freeze({
        label: 'feature 코드의 sizePx 폰트 생성',
        pattern: /\bsizePx\s*:/
    })
]);

/**
 * 디렉터리 아래 JavaScript 파일을 재귀적으로 수집합니다.
 * @param {string} directory - 검색할 디렉터리입니다.
 * @returns {Promise<string[]>} 정렬 전 JavaScript 파일 경로입니다.
 */
async function collectJavaScriptFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const nestedFiles = await Promise.all(entries.map(async (entry) => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            return collectJavaScriptFiles(entryPath);
        }
        if (entry.isFile() && entry.name.endsWith('.js')) {
            return [entryPath];
        }
        return [];
    }));
    return nestedFiles.flat();
}

/**
 * 정적 계약 위반의 파일과 첫 발생 줄을 사람이 읽을 수 있게 만듭니다.
 * @param {string} filePath - 검사 파일 경로입니다.
 * @param {string} source - 파일 소스입니다.
 * @param {{label:string,pattern:RegExp}} rule - 위반 규칙입니다.
 * @returns {string|null} 위반 설명 또는 null입니다.
 */
function findSourceViolation(filePath, source, rule) {
    const match = source.match(rule.pattern);
    if (!match || match.index === undefined) {
        return null;
    }
    const line = source.slice(0, match.index).split(/\r?\n/).length;
    const relativePath = path.relative(SCRIPT_ROOT, filePath);
    return `${relativePath}:${line} - ${rule.label}`;
}

/**
 * VM SyntheticModule을 테스트 export로 생성합니다.
 * @param {vm.Context} context - VM 문맥입니다.
 * @param {string} identifier - 모듈 식별자입니다.
 * @param {object} exports - export 이름과 값입니다.
 * @returns {vm.SyntheticModule} 생성된 synthetic 모듈입니다.
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
 * 브라우저/NW.js 의존성을 대체해 실제 LayoutHandler를 실행합니다.
 * 토큰 판별과 버튼 resolver는 production 모듈의 실제 export를 사용합니다.
 * @returns {Promise<object>} LayoutHandler 테스트 harness입니다.
 */
async function createLayoutHandlerHarness() {
    const [
        typographyModule,
        componentStylesModule,
        componentResolverModule
    ] = await Promise.all([
        loadGameModule('ui/style/typography.js'),
        loadGameModule('ui/style/component_styles.js'),
        loadGameModule('ui/style/_component_style_resolver.js')
    ]);
    const factoryCalls = [];
    const releasedItems = [];
    let generatedId = 0;
    const context = vm.createContext({
        console,
        crypto: {
            randomUUID() {
                generatedId += 1;
                return `generated-${generatedId}`;
            }
        }
    });

    class UIElementFactoryStub {
        static create(item, x, y, _parentW, _parentH, forcedW) {
            factoryCalls.push({ item, x, y, forcedW });
            return {
                id: item.id,
                x,
                y,
                width: Number.isFinite(forcedW) ? forcedW : 20,
                height: 10
            };
        }
    }

    class PositioningHandlerStub {}

    const dependencies = new Map([
        ['ui/element/_ui_element_factory.js', createSyntheticModule(
            context,
            'ui/element/_ui_element_factory.js',
            { UIElementFactory: UIElementFactoryStub }
        )],
        ['ui/_ui_pool.js', createSyntheticModule(
            context,
            'ui/_ui_pool.js',
            {
                releaseUIItem(item) {
                    releasedItems.push(item);
                }
            }
        )],
        ['ui/layout/_positioning_handler.js', createSyntheticModule(
            context,
            'ui/layout/_positioning_handler.js',
            { PositioningHandler: PositioningHandlerStub }
        )],
        ['ui/style/_component_style_resolver.js', createSyntheticModule(
            context,
            'ui/style/_component_style_resolver.js',
            {
                resolveButtonStyle: componentResolverModule.resolveButtonStyle
            }
        )],
        ['ui/style/component_styles.js', createSyntheticModule(
            context,
            'ui/style/component_styles.js',
            {
                isButtonStyleToken: componentStylesModule.isButtonStyleToken
            }
        )],
        ['ui/style/typography.js', createSyntheticModule(
            context,
            'ui/style/typography.js',
            {
                isTypographyToken: typographyModule.isTypographyToken
            }
        )]
    ]);
    const sourceModules = new Map();

    /**
     * LayoutHandler facade와 상대 경로 내부 모듈을 같은 VM 문맥에 재귀 로드합니다.
     * bare 의미 토큰 모듈은 dependencies의 동일 SyntheticModule을 재사용합니다.
     * @param {string} modulePath - 로드할 source module 절대 경로입니다.
     * @returns {Promise<vm.SourceTextModule>} 연결된 source module입니다.
     */
    async function loadLayoutSourceModule(modulePath) {
        const normalizedPath = path.resolve(modulePath);
        const cachedModule = sourceModules.get(normalizedPath);
        if (cachedModule) {
            return cachedModule;
        }

        const source = await readFile(normalizedPath, 'utf8');
        const sourceModule = new vm.SourceTextModule(source, {
            context,
            identifier: normalizedPath
        });
        sourceModules.set(normalizedPath, sourceModule);
        await sourceModule.link((specifier, referencingModule) => {
            const dependency = dependencies.get(specifier);
            if (dependency) {
                return dependency;
            }
            if (specifier.startsWith('.')) {
                return loadLayoutSourceModule(path.resolve(
                    path.dirname(referencingModule.identifier),
                    specifier
                ));
            }
            throw new Error(`LayoutHandler 테스트 의존성이 없습니다: ${specifier}`);
        });
        return sourceModule;
    }

    const layoutModule = await loadLayoutSourceModule(LAYOUT_HANDLER_PATH);
    await layoutModule.evaluate();

    return {
        LayoutHandler: layoutModule.namespace.LayoutHandler,
        TYPOGRAPHY: typographyModule.TYPOGRAPHY,
        BUTTON_STYLE: componentStylesModule.BUTTON_STYLE,
        factoryCalls,
        releasedItems
    };
}

const featureFiles = (
    await Promise.all(FEATURE_ROOTS.map(collectJavaScriptFiles))
).flat()
    .filter((filePath) => !FEATURE_EXCLUDED_FILES.has(filePath))
    .sort();
const featureSources = new Map(await Promise.all(
    featureFiles.map(async (filePath) => [
        filePath,
        await readFile(filePath, 'utf8')
    ])
));
const layoutHandlerSource = await readFile(LAYOUT_HANDLER_PATH, 'utf8');
const overlayLayoutRecipesSource = await readFile(
    OVERLAY_LAYOUT_RECIPES_PATH,
    'utf8'
);
const layoutHarness = await createLayoutHandlerHarness();

/**
 * LayoutHandler가 사용할 테스트 좌표 resolver를 생성합니다.
 * @returns {object} 좌표 resolver stub입니다.
 */
function createPositioningHandler() {
    return {
        resize() {
            return this;
        },
        parseUnit(unit, value, refSize) {
            if (unit === 'parent') {
                return (value / 100) * (refSize || 0);
            }
            return Number.isFinite(value) ? value : 0;
        },
        resolveLayoutFrame() {
            return {
                startX: 0,
                startY: 0,
                layoutW: 500,
                layoutH: 500,
                innerX: 0,
                innerW: 500
            };
        },
        resolveAlignedX(align, baseX, parentW, itemW) {
            if (align === 'center') {
                return baseX + (parentW - itemW) * 0.5;
            }
            if (align === 'right') {
                return baseX + parentW - itemW;
            }
            return baseX;
        }
    };
}

/**
 * 독립된 LayoutHandler 인스턴스를 생성합니다.
 * @returns {object} production LayoutHandler 인스턴스입니다.
 */
function createLayout() {
    return new layoutHarness.LayoutHandler(
        {
            layer: 'ui',
            uiScale: 1,
            x: 0,
            y: 0,
            width: 500,
            height: 500
        },
        createPositioningHandler()
    );
}

/**
 * VM realm의 오류 이름과 메시지를 검증합니다.
 * @param {string} expectedName - 기대 오류 이름입니다.
 * @param {RegExp} expectedMessage - 기대 메시지 패턴입니다.
 * @returns {(error: object) => boolean} assert.throws predicate입니다.
 */
function matchVmError(expectedName, expectedMessage) {
    return (error) => (
        error?.name === expectedName
        && expectedMessage.test(error?.message || '')
    );
}

test('production feature 코드는 의미 기반 토큰을 우회하지 않는다', () => {
    assert.ok(featureFiles.length > 0);
    const violations = [];

    for (const [filePath, source] of featureSources) {
        for (const rule of FEATURE_SOURCE_RULES) {
            const violation = findSourceViolation(filePath, source, rule);
            if (violation) {
                violations.push(violation);
            }
        }
        if (
            TYPOGRAPHY_RESOLVER_IMPORT_PATTERN.test(source)
            && !TYPOGRAPHY_ADAPTER_FILES.has(filePath)
        ) {
            violations.push(
                `${path.relative(SCRIPT_ROOT, filePath)} - 비승인 feature의 typography resolver 직접 import`
            );
        }
    }

    assert.deepEqual(violations, []);
});

test('실제 타이포그래피 메트릭 resolver는 승인된 adapter에서만 import한다', () => {
    const actualAdapterFiles = featureFiles.filter((filePath) => (
        TYPOGRAPHY_RESOLVER_IMPORT_PATTERN.test(featureSources.get(filePath))
    ));

    assert.deepEqual(
        actualAdapterFiles.sort(),
        [...TYPOGRAPHY_ADAPTER_FILES].sort()
    );
});

test('공용 overlay recipe는 합의한 header/footer/section/field-row 경계만 토큰화한다', () => {
    for (const recipeName of [
        'addOverlayPageHeader',
        'addOverlayCloseFooter',
        'addOverlaySectionHeader',
        'beginOverlayFieldRow',
        'endOverlayFieldRow'
    ]) {
        assert.match(
            overlayLayoutRecipesSource,
            new RegExp(`export function ${recipeName}\\(`)
        );
    }
    assert.match(
        overlayLayoutRecipesSource,
        /\.textStyle\(TYPOGRAPHY\.H1\)/
    );
    assert.match(
        overlayLayoutRecipesSource,
        /\.buttonStyle\(BUTTON_STYLE\.OVERLAY_INTERACT\)/
    );
    assert.match(
        overlayLayoutRecipesSource,
        /\.textStyle\(TYPOGRAPHY\.LABEL\)/
    );
    assert.match(
        overlayLayoutRecipesSource,
        /\.textStyle\(TYPOGRAPHY\.SETTINGS_DESCRIPTION\)/
    );

    const recipeConsumers = [...featureSources.entries()]
        .filter(([filePath]) => filePath !== OVERLAY_LAYOUT_RECIPES_PATH);
    assert.ok(
        recipeConsumers.filter(([, source]) => (
            /\baddOverlayPageHeader\s*\(/.test(source)
        )).length >= 2
    );
    assert.ok(
        recipeConsumers.filter(([, source]) => (
            /\baddOverlayCloseFooter\s*\(/.test(source)
        )).length >= 2
    );

    const settingsSource = featureSources.get(SETTINGS_OVERLAY_PATH);
    assert.match(settingsSource, /\bbeginOverlayFieldRow\s*\(/);
    assert.match(settingsSource, /\bendOverlayFieldRow\s*\(/);
});

test('legacy _ui_constants.js와 그 import 경로는 production에서 제거된다', async () => {
    await assert.rejects(
        readFile(LEGACY_UI_CONSTANTS_PATH, 'utf8'),
        (error) => error?.code === 'ENOENT'
    );

    const scriptFiles = (await collectJavaScriptFiles(SCRIPT_ROOT)).sort();
    const staleReferences = [];
    for (const filePath of scriptFiles) {
        const source = await readFile(filePath, 'utf8');
        if (/(?:^|[/\\])_ui_constants\.js\b/.test(source)) {
            staleReferences.push(path.relative(SCRIPT_ROOT, filePath));
        }
    }
    assert.deepEqual(staleReferences, []);
});

test('LayoutHandler 소스에는 legacy stylePreset() 공개 API가 없다', () => {
    assert.doesNotMatch(layoutHandlerSource, /\bstylePreset\s*\(/);
});

test('LayoutHandler.prop()은 모든 raw 타이포그래피 키를 즉시 거부한다', () => {
    for (const propName of FORBIDDEN_TYPOGRAPHY_PROPS) {
        const layout = createLayout();
        layout.item('text', `raw-${propName}`);
        assert.throws(
            () => layout.prop(propName, 'forbidden'),
            matchVmError('TypeError', /직접 타이포그래피 접근은 허용되지 않습니다/)
        );
    }

    const allowedLayout = createLayout();
    assert.doesNotThrow(() => {
        allowedLayout
            .item('text', 'allowed-color')
            .prop('color', '#fff')
            .textStyle(layoutHarness.TYPOGRAPHY.H1);
    });
});

test('LayoutHandler 의미 스타일 API는 위조 토큰과 잘못된 아이템 타입을 거부한다', () => {
    const forgedTypography = Object.freeze({ name: 'H1' });
    const forgedButtonStyle = Object.freeze({ name: 'OVERLAY_INTERACT' });

    assert.throws(
        () => createLayout()
            .item('text', 'forged-text')
            .textStyle(forgedTypography),
        matchVmError('TypeError', /TYPOGRAPHY 토큰만/)
    );
    assert.throws(
        () => createLayout()
            .item('slider', 'forged-value')
            .valueTextStyle(forgedTypography),
        matchVmError('TypeError', /TYPOGRAPHY 토큰만/)
    );
    assert.throws(
        () => createLayout()
            .item('button', 'forged-button')
            .buttonStyle(forgedButtonStyle),
        matchVmError('TypeError', /BUTTON_STYLE 토큰만/)
    );

    assert.throws(
        () => createLayout()
            .item('slider', 'wrong-text-target')
            .textStyle(layoutHarness.TYPOGRAPHY.H1),
        matchVmError('TypeError', /slider 아이템에 사용할 수 없습니다/)
    );
    assert.throws(
        () => createLayout()
            .item('text', 'wrong-value-target')
            .valueTextStyle(layoutHarness.TYPOGRAPHY.SLIDER_VALUE),
        matchVmError('TypeError', /text 아이템에 사용할 수 없습니다/)
    );
    assert.throws(
        () => createLayout()
            .item('text', 'wrong-button-target')
            .buttonStyle(layoutHarness.BUTTON_STYLE.OVERLAY_INTERACT),
        matchVmError('TypeError', /text 아이템에 사용할 수 없습니다/)
    );
});

test('LayoutHandler.build()는 텍스트 표시 아이템의 누락된 의미 스타일을 거부한다', () => {
    const invalidBuilders = [
        () => createLayout().item('text', 'missing-text-style').text('제목'),
        () => createLayout().item('button', 'missing-button-style').buttonText('확인'),
        () => createLayout().item('dropdown', 'missing-dropdown-style'),
        () => createLayout().item('segment_control', 'missing-segment-style'),
        () => createLayout().item('slider', 'missing-slider-value-style')
    ];

    for (const buildInvalidLayout of invalidBuilders) {
        const layout = buildInvalidLayout();
        assert.throws(
            () => layout.build(),
            matchVmError('TypeError', /(textStyle|buttonStyle|valueTextStyle)\(/)
        );
    }
});

test('LayoutHandler.build()는 production 토큰이 지정된 모든 텍스트 표시 타입을 허용한다', () => {
    layoutHarness.factoryCalls.length = 0;
    const layout = createLayout();
    layout
        .item('text', 'heading')
            .text('제목')
            .textStyle(layoutHarness.TYPOGRAPHY.H1)
        .item('button', 'confirm')
            .buttonText('확인')
            .buttonStyle(layoutHarness.BUTTON_STYLE.OVERLAY_INTERACT)
        .item('dropdown', 'dropdown')
            .items(['하나'])
            .textStyle(layoutHarness.TYPOGRAPHY.CONTROL)
        .item('segment_control', 'segment')
            .items(['하나'])
            .textStyle(layoutHarness.TYPOGRAPHY.CONTROL)
        .item('slider', 'slider')
            .valueTextStyle(layoutHarness.TYPOGRAPHY.SLIDER_VALUE);

    const result = layout.build();
    assert.deepEqual(
        Object.keys(result.components).sort(),
        ['confirm', 'dropdown', 'heading', 'segment', 'slider']
    );

    const latestItemById = new Map(
        layoutHarness.factoryCalls.map(({ item }) => [item.id, item])
    );
    assert.strictEqual(
        latestItemById.get('heading').textStyle,
        layoutHarness.TYPOGRAPHY.H1
    );
    assert.strictEqual(
        latestItemById.get('confirm').buttonStyle,
        layoutHarness.BUTTON_STYLE.OVERLAY_INTERACT
    );
    assert.strictEqual(
        latestItemById.get('slider').valueTextStyle,
        layoutHarness.TYPOGRAPHY.SLIDER_VALUE
    );
});
