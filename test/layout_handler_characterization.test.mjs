import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const LAYOUT_HANDLER_URL = new URL(
    '../project/game/script/module/ui/layout/_layout_handler.js',
    import.meta.url
);

/**
 * VM SyntheticModule을 LayoutHandler의 경계 의존성으로 만듭니다.
 * @param {vm.Context} context - VM 문맥입니다.
 * @param {string} identifier - 모듈 식별자입니다.
 * @param {object} exports - synthetic export입니다.
 * @returns {vm.SyntheticModule} 생성된 모듈입니다.
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
 * 테스트용 크기 규격을 픽셀 값으로 변환합니다.
 * @param {{unit:string,value:number}|undefined} metric - 레이아웃 크기 규격입니다.
 * @param {number} parentSize - parent 단위 기준 크기입니다.
 * @param {number} fallback - 규격이 없을 때 사용할 값입니다.
 * @returns {number} 변환된 크기입니다.
 */
function resolveTestMetric(metric, parentSize, fallback) {
    if (!metric) {
        return fallback;
    }
    if (metric.unit === 'fill') {
        return parentSize;
    }
    if (metric.unit === 'content') {
        return fallback;
    }
    if (metric.unit === 'parent') {
        return (metric.value / 100) * parentSize;
    }
    return Number.isFinite(metric.value) ? metric.value : fallback;
}

/**
 * 실제 LayoutHandler를 결정론적인 positioning/factory 경계와 함께 실행합니다.
 * @returns {Promise<object>} LayoutHandler와 관찰 기록을 가진 harness입니다.
 */
async function createLayoutHarness() {
    const factoryCalls = [];
    const releasedItems = [];
    const warnings = [];
    const trace = [];
    const intrinsicById = new Map();
    let generatedId = 0;
    let instanceId = 0;

    const context = vm.createContext({
        console: {
            log: (...args) => console.log(...args),
            error: (...args) => console.error(...args),
            warn: (...args) => {
                const message = args.map((value) => String(value)).join(' ');
                warnings.push(message);
                trace.push({ event: 'warn', message });
            }
        },
        crypto: {
            randomUUID() {
                generatedId += 1;
                return `generated-${generatedId}`;
            }
        }
    });

    class UIElementFactoryStub {
        /**
         * LayoutHandler가 넘긴 최종 폭과 item 크기 규격을 반영한 요소를 만듭니다.
         * @param {object} item - 레이아웃 아이템입니다.
         * @param {number} x - 생성 X 좌표입니다.
         * @param {number} y - 생성 Y 좌표입니다.
         * @param {number} parentW - 부모 너비입니다.
         * @param {number} parentH - 부모 높이입니다.
         * @param {number|undefined} forcedW - LayoutHandler가 강제한 너비입니다.
         * @param {object} layoutHandler - 원래 LayoutHandler facade입니다.
         * @returns {object} 테스트 요소입니다.
         */
        static create(
            item,
            x,
            y,
            parentW,
            parentH,
            forcedW,
            layoutHandler
        ) {
            const intrinsic = intrinsicById.get(item.id) || {};
            const width = Number.isFinite(forcedW)
                ? forcedW
                : resolveTestMetric(item.widthObj, parentW, intrinsic.width ?? 20);
            const height = resolveTestMetric(
                item.heightObj,
                parentH,
                intrinsic.height ?? 10
            );
            instanceId += 1;
            const element = {
                id: item.id,
                type: item.type,
                instanceId,
                x,
                y,
                width,
                height
            };
            const call = {
                item,
                element,
                id: item.id,
                instanceId,
                x,
                y,
                parentW,
                parentH,
                forcedW,
                layoutHandler
            };
            factoryCalls.push(call);
            trace.push({
                event: 'create',
                id: item.id,
                instanceId,
                forcedW
            });
            return element;
        }
    }

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
                    trace.push({
                        event: 'release',
                        id: item.id,
                        instanceId: item.instanceId
                    });
                }
            }
        )],
        ['ui/layout/_positioning_handler.js', createSyntheticModule(
            context,
            'ui/layout/_positioning_handler.js',
            { PositioningHandler: class PositioningHandlerStub {} }
        )],
        ['ui/style/_component_style_resolver.js', createSyntheticModule(
            context,
            'ui/style/_component_style_resolver.js',
            { resolveButtonStyle: () => ({ width: 10 }) }
        )],
        ['ui/style/component_styles.js', createSyntheticModule(
            context,
            'ui/style/component_styles.js',
            { isButtonStyleToken: () => false }
        )],
        ['ui/style/typography.js', createSyntheticModule(
            context,
            'ui/style/typography.js',
            { isTypographyToken: () => false }
        )]
    ]);
    const sourceModules = new Map();

    /**
     * LayoutHandler facade와 상대 경로 내부 모듈을 같은 VM 문맥에 재귀 로드합니다.
     * @param {URL} moduleUrl - 로드할 source module URL입니다.
     * @returns {Promise<vm.SourceTextModule>} 연결된 source module입니다.
     */
    async function loadLayoutSourceModule(moduleUrl) {
        const identifier = moduleUrl.href;
        const cachedModule = sourceModules.get(identifier);
        if (cachedModule) {
            return cachedModule;
        }

        const source = await readFile(moduleUrl, 'utf8');
        const sourceModule = new vm.SourceTextModule(source, {
            context,
            identifier
        });
        sourceModules.set(identifier, sourceModule);
        await sourceModule.link((specifier, referencingModule) => {
            const dependency = dependencies.get(specifier);
            if (dependency) {
                return dependency;
            }
            if (specifier.startsWith('.')) {
                return loadLayoutSourceModule(
                    new URL(specifier, referencingModule.identifier)
                );
            }
            throw new Error(`LayoutHandler 테스트 의존성이 없습니다: ${specifier}`);
        });
        return sourceModule;
    }

    const layoutModule = await loadLayoutSourceModule(LAYOUT_HANDLER_URL);
    await layoutModule.evaluate();

    return {
        LayoutHandler: layoutModule.namespace.LayoutHandler,
        factoryCalls,
        intrinsicById,
        releasedItems,
        trace,
        warnings,
        reset() {
            instanceId = 0;
            factoryCalls.length = 0;
            releasedItems.length = 0;
            trace.length = 0;
            warnings.length = 0;
            intrinsicById.clear();
        }
    };
}

const harness = await createLayoutHarness();

/**
 * 고정된 frame을 제공하는 테스트 positioning handler를 만듭니다.
 * @param {object} [overrides={}] - 기본 frame을 덮어쓸 값입니다.
 * @returns {object} positioning handler stub입니다.
 */
function createPositioningHandler(overrides = {}) {
    const frame = {
        startX: 0,
        startY: 0,
        layoutW: 100,
        layoutH: 100,
        innerX: 0,
        innerW: 100,
        ...overrides
    };

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
            return { ...frame };
        },
        resolveAlignedX(align, baseX, parentW, itemW) {
            if (align === 'center') {
                return baseX + ((parentW - itemW) / 2);
            }
            if (align === 'right') {
                return baseX + parentW - itemW;
            }
            return baseX;
        }
    };
}

/**
 * 독립된 LayoutHandler 인스턴스를 만듭니다.
 * @param {object} [frame={}] - positioning frame override입니다.
 * @returns {object} production LayoutHandler 인스턴스입니다.
 */
function createLayout(frame = {}) {
    return new harness.LayoutHandler(
        {
            layer: 'ui',
            uiScale: 1,
            x: 0,
            y: 0,
            width: 100,
            height: 100
        },
        createPositioningHandler(frame)
    );
}

/**
 * ID별 최종 요소의 핵심 geometry를 반환합니다.
 * @param {object} result - LayoutHandler.build() 결과입니다.
 * @param {string[]} ids - 조회할 component ID 목록입니다.
 * @returns {object} ID별 geometry입니다.
 */
function geometryById(result, ids) {
    return Object.fromEntries(ids.map((id) => {
        const item = result.components[id];
        return [id, {
            x: item.x,
            y: item.y,
            width: item.width,
            height: item.height
        }];
    }));
}

test('top과 bottom 항목은 서로 독립된 누적 cursor와 선언 순서를 유지한다', () => {
    harness.reset();
    const layout = createLayout({ startY: 20, layoutH: 100 });
    layout
        .item('line', 'top-a').width('absolute', 20).height('absolute', 10)
        .bottomItem('line', 'bottom-a').width('absolute', 20).height('absolute', 12)
        .item('line', 'top-b').width('absolute', 20).height('absolute', 15)
        .bottomItem('line', 'bottom-b').width('absolute', 20).height('absolute', 8);

    const result = layout.build();

    assert.deepEqual(
        geometryById(result, ['top-a', 'top-b', 'bottom-a', 'bottom-b']),
        {
            'top-a': { x: 0, y: 20, width: 20, height: 10 },
            'top-b': { x: 0, y: 30, width: 20, height: 15 },
            'bottom-a': { x: 0, y: 108, width: 20, height: 12 },
            'bottom-b': { x: 0, y: 100, width: 20, height: 8 }
        }
    );
    assert.deepEqual(
        [...result.staticItems].map(({ id }) => id),
        ['top-a', 'bottom-a', 'top-b', 'bottom-b']
    );
});

test('frame resolver가 handler를 교체하면 이후 parseUnit과 align은 최신 handler를 사용한다', () => {
    harness.reset();
    const calls = [];
    let layout;
    const handlerB = {
        resize() {
            calls.push('B.resize');
            return this;
        },
        parseUnit(_unit, value) {
            calls.push('B.parseUnit');
            return value + 5;
        },
        resolveLayoutFrame() {
            calls.push('B.frame');
            throw new Error('교체된 handler의 frame resolver는 호출되지 않아야 합니다.');
        },
        resolveAlignedX(_align, baseX, _parentW, itemW) {
            calls.push('B.align');
            return baseX + itemW;
        }
    };
    const handlerA = {
        resize() {
            calls.push('A.resize');
            return this;
        },
        parseUnit() {
            calls.push('A.parseUnit');
            return -1;
        },
        resolveLayoutFrame() {
            calls.push('A.frame');
            layout.positioningHandler = handlerB;
            return {
                get startX() {
                    calls.push('frame.startX');
                    return 0;
                },
                get startY() {
                    calls.push('frame.startY');
                    return 0;
                },
                get layoutH() {
                    calls.push('frame.layoutH');
                    return 100;
                },
                get innerW() {
                    calls.push('frame.innerW');
                    return 100;
                },
                get innerX() {
                    calls.push('frame.innerX');
                    return 7;
                }
            };
        },
        resolveAlignedX() {
            calls.push('A.align');
            return -1;
        }
    };

    layout = new harness.LayoutHandler(
        {
            layer: 'ui',
            uiScale: 1,
            x: 0,
            y: 0,
            width: 100,
            height: 100
        },
        handlerA
    );
    calls.length = 0;
    layout
        .item('line', 'live-handler')
        .width('absolute', 20)
        .height('absolute', 10);

    const result = layout.build();

    assert.deepEqual(calls, [
        'A.resize',
        'A.frame',
        'frame.startX',
        'frame.startY',
        'frame.layoutH',
        'frame.innerW',
        'frame.innerX',
        'B.parseUnit',
        'B.align'
    ]);
    assert.strictEqual(layout.positioningHandler, handlerB);
    assert.equal(result.components['live-handler'].width, 25);
    assert.equal(result.components['live-handler'].x, 32);
});

test('build는 미닫힌 중첩 group을 안쪽부터 닫고 모든 자식을 한 번만 finalize한다', () => {
    harness.reset();
    const layout = createLayout();
    layout
        .group('outer').width('absolute', 100).justifyContent('left', 'absolute', 0)
            .item('line', 'outer-a').width('absolute', 20).height('absolute', 10)
            .group('inner').width('absolute', 50).justifyContent('left', 'absolute', 0)
                .item('line', 'inner-a').width('absolute', 10).height('absolute', 6)
                .item('line', 'inner-b').width('absolute', 15).height('absolute', 8);

    const result = layout.build();

    assert.equal(harness.warnings.length, 1);
    assert.match(harness.warnings[0], /endGroup\(\)이 모두 호출되지 않은 상태/);
    assert.deepEqual(
        geometryById(result, ['outer-a', 'inner-a', 'inner-b']),
        {
            'outer-a': { x: 0, y: 0, width: 20, height: 10 },
            'inner-a': { x: 20, y: 0, width: 10, height: 6 },
            'inner-b': { x: 30, y: 0, width: 15, height: 8 }
        }
    );
    assert.deepEqual(
        [...result.staticItems].map(({ id }) => id),
        ['outer-a', 'inner-a', 'inner-b']
    );
});

test('hbox는 spacer와 fill에 남는 폭을 균등 분배하고 content intrinsic 폭을 보존한다', () => {
    harness.reset();
    harness.intrinsicById.set('content', { width: 30, height: 5 });
    const layout = createLayout();
    layout
        .group('flex-row').width('absolute', 100).justifyContent('left', 'absolute', 5)
            .item('line', 'fixed').width('absolute', 20).height('absolute', 10)
            .spacer()
            .item('line', 'fill').width('fill').height('absolute', 10)
            .item('line', 'tail').width('absolute', 10).height('absolute', 10)
        .endGroup()
        .item('line', 'content').width('content').height('absolute', 5).align('center');

    const result = layout.build();

    assert.deepEqual(
        geometryById(result, ['fixed', 'fill', 'tail', 'content']),
        {
            fixed: { x: 0, y: 0, width: 20, height: 10 },
            fill: { x: 57.5, y: 0, width: 27.5, height: 10 },
            tail: { x: 90, y: 0, width: 10, height: 10 },
            content: { x: 35, y: 10, width: 30, height: 5 }
        }
    );
});

test('hbox justifyContent 6종은 고정 폭 자식의 시작점과 간격을 보존한다', () => {
    const expectedXs = {
        left: [0, 30],
        center: [25, 55],
        right: [50, 80],
        'space-between': [0, 80],
        'space-around': [15, 65],
        'space-evenly': [20, 60]
    };

    for (const [justifyContent, expected] of Object.entries(expectedXs)) {
        harness.reset();
        const layout = createLayout();
        layout
            .group('row')
                .width('absolute', 100)
                .justifyContent(justifyContent, 'absolute', 10)
                .item('line', 'left-item').width('absolute', 20).height('absolute', 10)
                .item('line', 'right-item').width('absolute', 20).height('absolute', 10)
            .endGroup();

        const result = layout.build();
        assert.deepEqual(
            [
                result.components['left-item'].x,
                result.components['right-item'].x
            ],
            expected,
            justifyContent
        );
    }
});

test('root align과 hbox 자식 vAlign은 각 기준 영역에서 최종 좌표를 계산한다', () => {
    harness.reset();
    const rootLayout = createLayout({ innerX: 10, innerW: 100 });
    rootLayout
        .item('line', 'left').width('absolute', 20).height('absolute', 10).align('left')
        .item('line', 'center').width('absolute', 20).height('absolute', 10).align('center')
        .item('line', 'right').width('absolute', 20).height('absolute', 10).align('right');
    const rootResult = rootLayout.build();

    assert.deepEqual(
        geometryById(rootResult, ['left', 'center', 'right']),
        {
            left: { x: 10, y: 0, width: 20, height: 10 },
            center: { x: 50, y: 10, width: 20, height: 10 },
            right: { x: 90, y: 20, width: 20, height: 10 }
        }
    );

    harness.reset();
    const rowLayout = createLayout({ startY: 10 });
    rowLayout
        .group('row').width('absolute', 100).justifyContent('left', 'absolute', 0)
            .item('line', 'top').width('absolute', 20).height('absolute', 20).vAlign('top')
            .item('line', 'middle').width('absolute', 20).height('absolute', 10).vAlign('center')
            .item('line', 'bottom').width('absolute', 20).height('absolute', 5).vAlign('bottom')
        .endGroup();
    const rowResult = rowLayout.build();

    assert.deepEqual(
        geometryById(rowResult, ['top', 'middle', 'bottom']),
        {
            top: { x: 0, y: 10, width: 20, height: 20 },
            middle: { x: 20, y: 15, width: 20, height: 10 },
            bottom: { x: 40, y: 25, width: 20, height: 5 }
        }
    );
});

test('child finalize는 부모를 먼저 등록하고 자식 누적 높이를 다음 root 항목에 반영한다', () => {
    harness.reset();
    const layout = createLayout({ startX: 10, startY: 5, innerX: 10 });
    layout
        .item('line', 'parent').width('absolute', 40).height('absolute', 20)
            .child('line', 'child-center')
                .width('absolute', 10).height('absolute', 5).align('center')
            .child('line', 'child-right')
                .width('absolute', 8).height('absolute', 7).align('right')
        .item('line', 'after').width('absolute', 10).height('absolute', 4);

    const result = layout.build();

    assert.deepEqual(
        geometryById(result, ['parent', 'child-center', 'child-right', 'after']),
        {
            parent: { x: 10, y: 5, width: 40, height: 20 },
            'child-center': { x: 25, y: 5, width: 10, height: 5 },
            'child-right': { x: 42, y: 10, width: 8, height: 7 },
            after: { x: 10, y: 37, width: 10, height: 4 }
        }
    );
    assert.deepEqual(
        [...result.staticItems].map(({ id }) => id),
        ['parent', 'child-center', 'child-right', 'after']
    );
});

test('content 측정용 dummy 요소는 다음 생성 전에 같은 identity로 즉시 release된다', () => {
    harness.reset();
    harness.intrinsicById.set('content', { width: 30, height: 8 });
    const layout = createLayout();
    layout
        .item('line', 'content')
        .width('content')
        .height('absolute', 8);

    const result = layout.build();

    assert.equal(harness.factoryCalls.length, 3);
    assert.equal(harness.releasedItems.length, 2);
    for (const call of harness.factoryCalls) {
        assert.strictEqual(call.layoutHandler, layout);
    }
    assert.strictEqual(
        harness.releasedItems[0],
        harness.factoryCalls[0].element
    );
    assert.strictEqual(
        harness.releasedItems[1],
        harness.factoryCalls[1].element
    );
    assert.deepEqual(
        harness.trace.map(({ event, instanceId: id, forcedW }) => ({
            event,
            id,
            forcedW
        })),
        [
            { event: 'create', id: 1, forcedW: undefined },
            { event: 'release', id: 1, forcedW: undefined },
            { event: 'create', id: 2, forcedW: 30 },
            { event: 'release', id: 2, forcedW: undefined },
            { event: 'create', id: 3, forcedW: 30 }
        ]
    );
    assert.strictEqual(result.components.content, harness.factoryCalls[2].element);
});

test('custom render order는 전체 항목을 안정 정렬하고 중복만 경고한 뒤 연속 rank를 부여한다', () => {
    harness.reset();
    const layout = createLayout();
    layout
        .item('line', 'first-custom')
            .width('absolute', 10).height('absolute', 5).customRenderOrder(3)
        .item('line', 'first-natural')
            .width('absolute', 10).height('absolute', 5)
        .item('line', 'duplicate-custom')
            .width('absolute', 10).height('absolute', 5).customRenderOrder(3)
        .item('line', 'second-natural')
            .width('absolute', 10).height('absolute', 5);

    const result = layout.build();

    assert.deepEqual(
        [...result.staticItems].map(({ id, item }) => ({
            id,
            renderOrder: item.renderOrder
        })),
        [
            { id: 'first-natural', renderOrder: 0 },
            { id: 'second-natural', renderOrder: 1 },
            { id: 'first-custom', renderOrder: 2 },
            { id: 'duplicate-custom', renderOrder: 3 }
        ]
    );
    assert.equal(harness.warnings.length, 1);
    assert.match(harness.warnings[0], /customRenderOrder\(3\).*duplicate-custom/);
});
