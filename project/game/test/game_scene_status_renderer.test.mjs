import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const STATUS_RENDERER_SOURCE = await readFile(
    new URL(
        '../script/module/scene/game/render/game_scene_status_renderer.js',
        import.meta.url
    ),
    'utf8'
);

function createSyntheticModule(context, identifier, exports) {
    const exportNames = Object.keys(exports);
    return new vm.SyntheticModule(exportNames, function initialize() {
        for (const exportName of exportNames) {
            this.setExport(exportName, exports[exportName]);
        }
    }, { context, identifier });
}

async function createRendererHarness() {
    const calls = [];
    const layoutCalls = [];
    const positioningCalls = [];
    const releasedItems = [];
    const shopOverlaySessions = [];
    const colorSchemes = { Game: { Font: '#ddeeff' } };
    const controlToken = Object.freeze({ name: 'CONTROL' });
    let positioningSequence = 0;

    class TestPositioningHandler {
        constructor(parent, uiScale) {
            this.id = ++positioningSequence;
            this.resize(parent, uiScale);
            positioningCalls.push({
                type: 'construct',
                id: this.id,
                instance: this,
                parent,
                uiScale
            });
        }

        resize(parent, uiScale) {
            this.parent = parent;
            this.uiScale = uiScale;
            positioningCalls.push({
                type: 'resize',
                id: this.id,
                parent,
                uiScale
            });
            return this;
        }

        parseUnit(unit, value, refSize) {
            switch (unit) {
                case 'WW':
                    return (value / 100) * this.parent.scaledW * this.uiScale;
                case 'WH':
                    return (value / 100) * this.parent.scaledH * this.uiScale;
                case 'OW':
                    return (value / 100) * this.parent.scaledW;
                case 'OH':
                    return (value / 100) * this.parent.scaledH;
                case 'OX':
                    return this.parent.scaledX
                        + ((value / 100) * this.parent.scaledW);
                case 'OY':
                    return this.parent.scaledY
                        + ((value / 100) * this.parent.scaledH);
                case 'absolute':
                    return value * this.uiScale;
                case 'parent':
                    return (value / 100) * refSize;
                default:
                    return 0;
            }
        }
    }

    class TestLayoutHandler {
        constructor(parent, positioningHandler) {
            this.parent = parent;
            this.positioningHandler = positioningHandler;
            this.items = [];
            this.currentItem = null;
            this.layoutStart = null;
            this.layoutSizeValue = null;
            layoutCalls.push({
                type: 'construct',
                parent,
                positioningHandler
            });
        }

        layoutStartPos(...args) {
            this.layoutStart = args;
            layoutCalls.push({ type: 'layoutStartPos', args });
            return this;
        }

        layoutSize(...args) {
            this.layoutSizeValue = args;
            layoutCalls.push({ type: 'layoutSize', args });
            return this;
        }

        item(type, id) {
            this.currentItem = {
                type,
                id,
                text: '',
                fill: null,
                textStyle: null,
                height: null
            };
            this.items.push(this.currentItem);
            layoutCalls.push({ type: 'item', itemType: type, id });
            return this;
        }

        textStyle(token) {
            this.currentItem.textStyle = token;
            layoutCalls.push({ type: 'textStyle', token });
            return this;
        }

        text(value) {
            this.currentItem.text = value;
            return this;
        }

        fill(value) {
            this.currentItem.fill = value;
            return this;
        }

        height(unit, value) {
            this.currentItem.height = { unit, value };
            layoutCalls.push({ type: 'height', unit, value });
            return this;
        }

        build() {
            layoutCalls.push({ type: 'build' });
            const [xUnit, xValue, yUnit, yValue] = this.layoutStart;
            const x = this.positioningHandler.parseUnit(xUnit, xValue);
            let y = this.positioningHandler.parseUnit(yUnit, yValue);
            const components = {};
            const staticItems = this.items.map((item) => {
                const height = item.height
                    ? this.positioningHandler.parseUnit(
                        item.height.unit,
                        item.height.value
                    )
                    : this.positioningHandler.parseUnit('WW', 0.85);
                const command = {
                    shape: 'text',
                    text: item.text,
                    x,
                    y,
                    font: `control-${this.parent.scaledW}-${this.parent.uiScale}`,
                    fill: item.fill,
                    align: 'left',
                    baseline: 'top',
                    height
                };
                y += height;
                components[item.id] = command;
                return { id: item.id, item: command };
            });
            return {
                staticItems,
                dynamicItems: [],
                components
            };
        }
    }

    const context = vm.createContext({});
    const module = new vm.SourceTextModule(STATUS_RENDERER_SOURCE, {
        context,
        identifier: 'game_scene_status_renderer.js'
    });
    const dependencies = new Map([
        ['display/_theme_handler.js', createSyntheticModule(
            context,
            'theme_handler.js',
            { ColorSchemes: colorSchemes }
        )],
        ['display/display_system.js', createSyntheticModule(
            context,
            'display_system.js',
            {
                render(layer, options) {
                    calls.push({ layer, options: { ...options } });
                }
            }
        )],
        ['ui/_ui_pool.js', createSyntheticModule(
            context,
            'ui_pool.js',
            {
                releaseUIItem(item) {
                    releasedItems.push(item);
                }
            }
        )],
        ['ui/layout/_layout_handler.js', createSyntheticModule(
            context,
            'layout_handler.js',
            { LayoutHandler: TestLayoutHandler }
        )],
        ['ui/layout/_positioning_handler.js', createSyntheticModule(
            context,
            'positioning_handler.js',
            { PositioningHandler: TestPositioningHandler }
        )],
        ['ui/style/typography.js', createSyntheticModule(
            context,
            'typography.js',
            { TYPOGRAPHY: Object.freeze({ CONTROL: controlToken }) }
        )],
        ['../shop/shop_overlay_renderer.js', createSyntheticModule(
            context,
            'shop_overlay_renderer.js',
            {
                createShopOverlayRenderer(options) {
                    const session = {
                        options,
                        updateCalls: [],
                        drawCalls: [],
                        destroyed: false,
                        update(...args) {
                            this.updateCalls.push(args);
                            return true;
                        },
                        draw(...args) {
                            this.drawCalls.push(args);
                            return false;
                        },
                        drainCommands() {
                            return Object.freeze([{ type: 'REROLL' }]);
                        },
                        getStatus() {
                            return Object.freeze({ destroyed: this.destroyed });
                        },
                        destroy() {
                            this.destroyed = true;
                        }
                    };
                    shopOverlaySessions.push(session);
                    return session;
                }
            }
        )]
    ]);
    await module.link((specifier) => {
        const dependency = dependencies.get(specifier);
        if (!dependency) {
            throw new Error(`예상하지 못한 status renderer import입니다: ${specifier}`);
        }
        return dependency;
    });
    await module.evaluate();
    return {
        calls,
        colorSchemes,
        controlToken,
        createRenderer: module.namespace.createGameSceneStatusRenderer,
        layoutCalls,
        positioningCalls,
        releasedItems,
        shopOverlaySessions
    };
}

function createStatus(overrides = {}) {
    const tower = Object.freeze({
        available: true,
        state: 'ALIVE',
        alive: true,
        currentHp: 17,
        maxHp: 30,
        livingTowerCount: 1,
        ...overrides.tower
    });
    const core = Object.freeze({
        available: true,
        currentIntegrity: 100,
        maxIntegrity: 100,
        depleted: false,
        ...overrides.core
    });
    return Object.freeze({
        fixedTick: 61,
        recoveryRequired: false,
        tower,
        core,
        ...overrides,
        tower,
        core
    });
}

test('status renderer는 LayoutHandler와 PositioningHandler의 canonical UI 경로로 Tower/Core를 표시한다', async () => {
    const harness = await createRendererHarness();
    const renderer = harness.createRenderer();
    const status = createStatus();
    const viewport = Object.freeze({
        ww: 1600,
        wh: 900,
        uiww: 1440,
        uiOffsetX: 80,
        uiScale: 1.25
    });

    assert.equal(renderer.draw(status, viewport), true);
    assert.equal(
        harness.positioningCalls.filter(({ type }) => type === 'construct').length,
        1
    );
    const layoutConstruct = harness.layoutCalls.find(
        ({ type }) => type === 'construct'
    );
    assert.ok(layoutConstruct);
    assert.strictEqual(
        layoutConstruct.positioningHandler,
        harness.positioningCalls.find(({ type }) => type === 'construct')
            .instance
    );
    assert.deepEqual(
        harness.layoutCalls.find(({ type }) => type === 'layoutStartPos').args,
        ['OX', 3, 'OY', 4]
    );
    assert.deepEqual(
        harness.layoutCalls.find(({ type }) => type === 'layoutSize').args,
        ['OW', 94, 'OH', 20]
    );
    assert.equal(
        harness.layoutCalls.filter(({ type }) => type === 'textStyle')
            .every(({ token }) => token === harness.controlToken),
        true
    );
    assert.deepEqual(
        harness.layoutCalls.find(({ type }) => type === 'height'),
        { type: 'height', unit: 'WW', value: 1.0625 }
    );
    assert.equal(harness.calls.length, 2);
    assert.deepEqual(harness.calls.map(({ layer }) => layer), ['ui', 'ui']);
    assert.deepEqual(
        harness.calls.map(({ options }) => options.text),
        ['TOWER  17 / 30  ALIVE', 'CORE   100 / 100']
    );
    assert.ok(harness.calls.every(({ options }) => (
        Math.abs(options.x - 123.2) <= 1e-9
        && options.font === 'control-1440-1.25'
        && options.fill === '#ddeeff'
        && options.align === 'left'
        && options.baseline === 'top'
    )));
    assert.equal(harness.calls[0].options.y, 36);
    assert.equal(harness.calls[1].options.y, 55.125);
    assert.equal(status.tower.currentHp, 17);
    assert.equal(status.core.currentIntegrity, 100);

    harness.calls.length = 0;
    const initialStatus = createStatus({ tower: { currentHp: 30 } });
    assert.equal(renderer.draw(initialStatus, viewport), true);
    assert.equal(
        harness.layoutCalls.filter(({ type }) => type === 'build').length,
        1
    );
    assert.equal(harness.calls[0].options.text, 'TOWER  30 / 30  ALIVE');
    assert.equal(initialStatus.tower.currentHp, 30);
});

test('ALIVE→DEAD와 recovery·fallback 표시는 authority 입력을 변형하지 않는다', async () => {
    const harness = await createRendererHarness();
    const renderer = harness.createRenderer();
    const viewport = { ww: 1920, wh: 1080, uiww: 1920, uiOffsetX: 0 };
    const deadStatus = createStatus({
        recoveryRequired: true,
        tower: {
            state: 'DEAD',
            alive: false,
            currentHp: 0,
            livingTowerCount: 0
        }
    });

    assert.equal(renderer.draw(deadStatus, viewport), true);
    assert.equal(
        harness.calls[0].options.text,
        'TOWER  0 / 30  DEAD  · RECOVERY'
    );
    assert.equal(harness.calls[1].options.text, 'CORE   100 / 100');
    assert.equal(deadStatus.tower.currentHp, 0);
    assert.equal(deadStatus.recoveryRequired, true);

    harness.calls.length = 0;
    harness.colorSchemes.Game.Font = '#112233';
    const fallbackStatus = createStatus({
        tower: {
            available: false,
            state: 'N/A',
            alive: null,
            currentHp: null,
            maxHp: null,
            livingTowerCount: null
        }
    });
    assert.equal(renderer.draw(fallbackStatus, viewport), true);
    assert.equal(harness.calls[0].options.text, 'TOWER  N/A');
    assert.equal(harness.calls[1].options.text, 'CORE   100 / 100');
    assert.ok(harness.calls.every(({ options }) => options.fill === '#112233'));
});

test('resize는 layout을 재컴파일·반납하고 destroy는 session presentation만 정리한다', async () => {
    const harness = await createRendererHarness();
    const renderer = harness.createRenderer();
    const status = createStatus();

    assert.equal(renderer.draw(status, {
        ww: 1920,
        wh: 1080,
        uiww: 1920,
        uiOffsetX: 0,
        uiScale: 1
    }), true);
    assert.equal(renderer.draw(status, {
        ww: 1600,
        wh: 900,
        uiww: 1440,
        uiOffsetX: 80,
        uiScale: 1.25
    }), true);
    assert.equal(
        harness.layoutCalls.filter(({ type }) => type === 'build').length,
        2
    );
    assert.equal(
        harness.positioningCalls.filter(({ type }) => type === 'construct').length,
        2
    );
    assert.equal(harness.releasedItems.length, 2);

    renderer.destroy();
    renderer.destroy();
    assert.equal(harness.releasedItems.length, 4);
    const previousCallCount = harness.calls.length;
    assert.equal(renderer.draw(status, {
        ww: 1600,
        wh: 900,
        uiww: 1440,
        uiOffsetX: 80,
        uiScale: 1.25
    }), false);
    assert.equal(harness.calls.length, previousCallCount);
});

test('유효한 viewport가 없으면 canonical layout과 render command를 생성하지 않는다', async () => {
    const harness = await createRendererHarness();
    const renderer = harness.createRenderer();
    assert.equal(renderer.draw(createStatus(), {
        ww: 0,
        wh: 1080
    }), false);
    assert.equal(renderer.draw(createStatus(), {
        ww: 1920,
        wh: Number.NaN
    }), false);
    assert.equal(harness.calls.length, 0);
    assert.equal(harness.layoutCalls.length, 0);
    assert.equal(harness.positioningCalls.length, 0);
    assert.equal(harness.releasedItems.length, 0);
});

test('status renderer는 Shop overlay variable update/command/destroy port를 그대로 중계한다', async () => {
    const harness = await createRendererHarness();
    const options = Object.freeze({
        inputSource: Object.freeze({}),
        animationPort: Object.freeze({}),
        settingsSource: Object.freeze({})
    });
    const renderer = harness.createRenderer(options);
    const shop = harness.shopOverlaySessions[0];
    assert.strictEqual(shop.options.inputSource, options.inputSource);
    assert.strictEqual(shop.options.animationPort, options.animationPort);
    assert.strictEqual(shop.options.settingsSource, options.settingsSource);
    const status = createStatus();
    const viewport = Object.freeze({ ww: 1280, wh: 720 });
    assert.equal(renderer.update(status, viewport, 0.01), true);
    assert.equal(shop.updateCalls.length, 1);
    assert.deepEqual(
        Array.from(renderer.drainCommands(), (command) => ({ ...command })),
        [{ type: 'REROLL' }]
    );
    assert.equal(renderer.getShopOverlayStatus().destroyed, false);
    renderer.destroy();
    assert.equal(shop.destroyed, true);
    assert.deepEqual(Array.from(renderer.drainCommands()), []);
});
