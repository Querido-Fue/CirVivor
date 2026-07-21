import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const [settingsSource, baseOverlaySource, titleMenuSource, loadingSceneSource, presentationSource, loadingSequenceSource, titleContentSource] = await Promise.all([
    readFile(new URL('../script/module/overlay/title/_settings_overlay.js', import.meta.url), 'utf8'),
    readFile(new URL('../script/module/overlay/_base_overlay.js', import.meta.url), 'utf8'),
    readFile(new URL('../script/module/scene/title/_title_menu.js', import.meta.url), 'utf8'),
    readFile(new URL('../script/module/scene/loading/_loading_scene.js', import.meta.url), 'utf8'),
    readFile(new URL('../script/module/scene/title/_title_scene_presentation.js', import.meta.url), 'utf8'),
    readFile(new URL('../script/module/scene/title/_title_loading_sequence.js', import.meta.url), 'utf8'),
    readFile(new URL('../script/module/scene/title/_title_scene_content.js', import.meta.url), 'utf8')
]);

const runtimeCalls = [];
const memoryPreviewCalls = [];
const fileSaveCalls = [];
const releasedItems = [];
const rollbackAnimations = [];
let generatedId = 0;
let overlay;

const numericTree = new Proxy(function numericValue() {}, {
    get(_target, property) {
        if (property === Symbol.toPrimitive) return () => 1;
        if (property === 'valueOf') return () => 1;
        if (property === 'toString') return () => '1';
        return numericTree;
    }
});

const initialSettings = Object.freeze({
    windowMode: 'windowed',
    widescreenSupport: true,
    renderScale: 100,
    uiScale: 100,
    disableTransparency: false,
    language: 'en',
    theme: 'default',
    tooltipDelaySeconds: 0.5,
    bgmVolume: 50,
    sfxVolume: 50
});

function diffSettings(from, to, valueSource) {
    const result = {};
    for (const key of Object.keys(from)) {
        if (!Object.is(from[key], to[key])) {
            result[key] = valueSource[key];
        }
    }
    return result;
}

function releaseUIItem(item) {
    if (!item) return;
    item.released = true;
    releasedItems.push(item);
}

class TitleOverlayStub {
    constructor(titleScene) {
        this.titleScene = titleScene;
        this.uiScale = 1;
        this.WW = 1920;
        this.WH = 1080;
        this.UIWW = 1920;
        this.staticItems = [];
        this.dynamicItems = [];
        this.positioningHandler = { parseUIData: () => 12 };
        this.interactionsLocked = false;
        this.interactionLockAttempts = 0;
        this.closeCalls = 0;
    }

    update() {
        for (const entry of this.dynamicItems ?? []) {
            entry.item?.update?.();
        }
    }

    resize() {
        this._onResize?.();
        this._generateLayout?.();
    }

    applyRuntimeSettings(changedSettings = {}) {
        if (changedSettings.uiScale !== undefined) {
            const uiScale = Number(changedSettings.uiScale) / 100;
            if (Number.isFinite(uiScale) && uiScale > 0) {
                this.uiScale = uiScale;
            }
        }
        if (changedSettings.uiScale !== undefined
            || changedSettings.renderScale !== undefined
            || changedSettings.theme !== undefined
            || changedSettings.disableTransparency !== undefined) {
            this.resize();
        }
    }

    _releaseElements() {
        for (const entry of this.staticItems ?? []) releaseUIItem(entry.item);
        for (const entry of this.dynamicItems ?? []) releaseUIItem(entry.item);
        this.staticItems = null;
        this.dynamicItems = null;
    }

    lockInteractions() {
        this.interactionLockAttempts += 1;
        if (this.interactionsLocked) {
            return false;
        }
        this.interactionsLocked = true;
        return true;
    }

    close() {
        this.closeCalls += 1;
        this.closed = true;
    }
}

function createLayoutElement(type, id) {
    const element = {
        id: id ?? `generated-${generatedId++}`,
        __poolType: type,
        update() {},
        animateToValue(value, options) {
            rollbackAnimations.push({ id: this.id, value, options: { ...options } });
            this.value = value;
            if (this.displayValue !== undefined) {
                this.displayValue = value;
            }
            return Promise.resolve();
        }
    };
    if (type === 'slider' || type === 'toggle' || type === 'dropdown') {
        element.value = 0;
        if (type === 'slider') {
            element.displayValue = 0;
            element.dragging = false;
            element.waitForDisplayValueSettle = () => Promise.resolve();
        }
        element.reconcileLayoutFrom = function reconcileLayoutFrom(source) {
            this.onChange = source.onChange;
            this.onCommit = source.onCommit;
            this.layoutSource = source;
            this.reconcileCount = (this.reconcileCount ?? 0) + 1;
            return this;
        };
    }
    return element;
}

class LayoutHandlerStub {
    constructor() {
        this.entries = [];
        this.components = {};
        this.currentItem = null;
        return new Proxy(this, {
            get(target, property, receiver) {
                if (property in target) {
                    return Reflect.get(target, property, receiver);
                }
                return () => receiver;
            }
        });
    }

    item(type, id) {
        const item = createLayoutElement(type, id);
        this.currentItem = item;
        this.entries.push({ id: item.id, item, dynamic: true, orderInt: this.entries.length });
        if (id) this.components[id] = item;
        return this;
    }

    prop(name, value) {
        if (this.currentItem) this.currentItem[name] = value;
        return this;
    }

    setValue(value) {
        if (this.currentItem) {
            this.currentItem.value = value;
            this.currentItem.displayValue = value;
        }
        return this;
    }

    onChange(handler) {
        if (this.currentItem) this.currentItem.onChange = handler;
        return this;
    }

    onCommit(handler) {
        if (this.currentItem) this.currentItem.onCommit = handler;
        return this;
    }

    onClick(handler) {
        if (this.currentItem) this.currentItem.onClick = handler;
        return this;
    }

    build() {
        return {
            dynamicItems: this.entries,
            staticItems: [],
            components: this.components
        };
    }
}

class SettingsPreviewQueueStub {
    constructor({ applyRuntimeSettings }) {
        this.applyRuntimeSettings = applyRuntimeSettings;
        this.pending = Promise.resolve();
    }

    queue(changedSettings) {
        this.pending = this.pending.then(async () => {
            memoryPreviewCalls.push({ ...changedSettings });
            await this.applyRuntimeSettings(changedSettings);
        });
        return this.pending;
    }

    async flush() {
        await this.pending;
    }
}

function createSyntheticModule(context, exports) {
    return new vm.SyntheticModule(Object.keys(exports), function initialize() {
        for (const [name, value] of Object.entries(exports)) {
            this.setExport(name, value);
        }
    }, { context });
}

const context = vm.createContext({ console });
const settingsModule = new vm.SourceTextModule(settingsSource, {
    context,
    identifier: '_settings_overlay.js'
});
const dependencies = new Map([
    ['./_title_overlay.js', createSyntheticModule(context, { TitleOverlay: TitleOverlayStub })],
    ['ui/ui_system.js', createSyntheticModule(context, { getLangString: (key) => key })],
    ['display/_theme_handler.js', createSyntheticModule(context, { ColorSchemes: numericTree })],
    ['display/display_system.js', createSyntheticModule(context, {
        getBaseWW: () => 1920,
        getBaseWH: () => 1080
    })],
    ['save/save_system.js', createSyntheticModule(context, {
        previewSettingBatch: (settings) => memoryPreviewCalls.push({ ...settings }),
        setSettingBatch: async (settings) => { fileSaveCalls.push({ ...settings }); },
        getSettingSchema: () => ({ min: 50, max: 200 })
    })],
    ['ui/layout/_layout_handler.js', createSyntheticModule(context, { LayoutHandler: LayoutHandlerStub })],
    ['ui/_ui_pool.js', createSyntheticModule(context, { releaseUIItem })],
    ['ui/lang/_language_handler.js', createSyntheticModule(context, { getAvailableLanguages: () => [] })],
    ['data/data_handler.js', createSyntheticModule(context, {
        getData: (key) => {
            if (key === 'THEME_OPTIONS') return [];
            if (key === 'DEFAULT_THEME_KEY') return 'default';
            if (key === 'UI_CONSTANTS') {
                return {
                    SETTING_ROLLBACK_ANIMATION: {
                        DURATION_SECONDS: 0.4,
                        EASING: 'easeOutExpo'
                    }
                };
            }
            return numericTree;
        }
    })],
    ['util/font_util.js', createSyntheticModule(context, { createFontStringFromPreset: () => '12px sans-serif' })],
    ['../_overlay_confirm_icon.js', createSyntheticModule(context, { applyOverlayConfirmButtonIcon: () => {} })],
    ['./settings/_settings_state.js', createSyntheticModule(context, {
        SETTING_LABEL_KEYS: { uiScale: 'title_settings_ui_scale' },
        createSettingsInitialState: () => ({ ...initialSettings }),
        formatTooltipDelayValue: (value) => String(value),
        getChangedSettings: (initial, temporary) => diffSettings(initial, temporary, temporary),
        getRevertedSettings: (initial, temporary) => diffSettings(initial, temporary, initial),
        getSettingLabelId: (key) => `label_${key}`,
        getSettingLabelText: (_initial, _temporary, _key, label) => label,
        hasSettingsChanges: (initial, temporary) => Object.keys(diffSettings(initial, temporary, temporary)).length > 0
    })],
    ['./settings/_settings_preview_queue.js', createSyntheticModule(context, { SettingsPreviewQueue: SettingsPreviewQueueStub })]
]);

await settingsModule.link((specifier) => dependencies.get(specifier));
await settingsModule.evaluate();

const { SettingsOverlay } = settingsModule.namespace;
const titleScene = {
    sceneSystem: {
        systemHandler: {
            async applyRuntimeSettings(changedSettings) {
                runtimeCalls.push({ ...changedSettings });
                overlay.applyRuntimeSettings(changedSettings);
            }
        }
    }
};
overlay = new SettingsOverlay(titleScene);

overlay.resize();
const retainedRenderSlider = overlay.settingComponents.control_renderScale;
retainedRenderSlider.value = 125;
retainedRenderSlider.displayValue = 117;
retainedRenderSlider.dragging = true;
retainedRenderSlider.onChange(125);
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(memoryPreviewCalls, []);
assert.deepEqual(runtimeCalls, []);
assert.equal(typeof retainedRenderSlider.onCommit, 'function');

retainedRenderSlider.onCommit(125);
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(memoryPreviewCalls, [{ renderScale: 125 }]);
assert.deepEqual(runtimeCalls, [{ renderScale: 125 }]);
assert.strictEqual(overlay.settingComponents.control_renderScale, retainedRenderSlider);
assert.equal(retainedRenderSlider.displayValue, 117);
assert.equal(retainedRenderSlider.dragging, true);
assert.equal(retainedRenderSlider.reconcileCount, 1);
assert.equal(releasedItems.includes(retainedRenderSlider), false);

runtimeCalls.length = 0;
memoryPreviewCalls.length = 0;
releasedItems.length = 0;
const retainedTransparencyToggle = overlay.settingComponents.control_disableTransparency;
retainedTransparencyToggle.value = true;
retainedTransparencyToggle.onChange(true);
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(memoryPreviewCalls, [{ disableTransparency: true }]);
assert.deepEqual(runtimeCalls, [{ disableTransparency: true }]);
assert.strictEqual(overlay.settingComponents.control_disableTransparency, retainedTransparencyToggle);
assert.equal(retainedTransparencyToggle.reconcileCount, 1);
assert.equal(releasedItems.includes(retainedTransparencyToggle), false);

overlay.tempSettings.renderScale = 100;
runtimeCalls.length = 0;
memoryPreviewCalls.length = 0;
releasedItems.length = 0;

const retainedSlider = overlay.settingComponents.control_uiScale;
retainedSlider.value = 95;
retainedSlider.displayValue = 95;
retainedSlider.dragging = true;

overlay.update();
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(runtimeCalls, [{ uiScale: 95 }]);
assert.equal(memoryPreviewCalls.length, 0);
assert.strictEqual(overlay.settingComponents.control_uiScale, retainedSlider);
assert.equal(retainedSlider.dragging, true);
assert.equal(retainedSlider.reconcileCount, 1);
assert.equal(releasedItems.includes(retainedSlider), false);
assert.equal(releasedItems.includes(retainedSlider.layoutSource), true);

let settleDisplayValue;
const displaySettled = new Promise((resolve) => {
    settleDisplayValue = resolve;
});
retainedSlider.displayValue = 87;
retainedSlider.waitForDisplayValueSettle = () => displaySettled;
retainedSlider.onChange(87);
retainedSlider.onCommit(87);
await Promise.resolve();
assert.equal(memoryPreviewCalls.length, 0);
assert.equal(fileSaveCalls.length, 0);

settleDisplayValue();
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(memoryPreviewCalls, [{ uiScale: 87 }]);
assert.equal(fileSaveCalls.length, 0);
assert.deepEqual(runtimeCalls.map(({ uiScale }) => uiScale), [95, 87, 87]);
assert.strictEqual(overlay.settingComponents.control_uiScale, retainedSlider);
assert.equal(retainedSlider.reconcileCount, 3);
assert.equal(releasedItems.includes(retainedSlider), false);

await overlay.settingComponents.cancel_btn.onClick();
assert.equal(overlay.closed, true);
assert.deepEqual(
    rollbackAnimations.find(({ id }) => id === 'control_uiScale'),
    {
        id: 'control_uiScale',
        value: 100,
        options: { duration: 0.4, easing: 'easeOutExpo', notify: false }
    }
);
assert.deepEqual(memoryPreviewCalls.at(-1), { uiScale: 87 });
overlay.onCloseComplete();
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(memoryPreviewCalls.at(-1), { uiScale: 100, disableTransparency: false });
assert.deepEqual(runtimeCalls.at(-1), { uiScale: 100, disableTransparency: false });

const saveOverlay = new SettingsOverlay(titleScene);
saveOverlay.resize();
await Promise.all([
    saveOverlay.settingComponents.save_btn.onClick(),
    saveOverlay.settingComponents.save_btn.onClick()
]);
assert.equal(saveOverlay.interactionsLocked, true);
assert.equal(saveOverlay.interactionLockAttempts, 2);
assert.equal(saveOverlay.closeCalls, 1);

assert.match(baseOverlaySource, /const runtimeUiScale = Number\(changedSettings\.uiScale\) \/ 100;/);
assert.match(baseOverlaySource, /Number\.isFinite\(runtimeUiScale\) && runtimeUiScale > 0/);
assert.match(titleMenuSource, /resize\(Number\(changedSettings\.uiScale\) \/ 100\);/);
assert.match(loadingSceneSource, /this\.presentation\?\.applyRuntimeSettings\(changedSettings\);/);
assert.match(presentationSource, /this\.content\?\.applyRuntimeSettings\?\.\(changedSettings\);/);
assert.match(loadingSequenceSource, /this\.titleMenu\.applyRuntimeSettings\(changedSettings\);/);
assert.match(titleContentSource, /this\.titleMenu\.applyRuntimeSettings\(changedSettings\);/);
assert.match(
    settingsSource,
    /onChange\(\(val\) => \{ this\.#handleSettingInput\('renderScale', val, \{ preview: false \}\); \}\)[\s\S]*?onCommit\(\(val\) => \{ this\.#handleSettingInput\('renderScale', val\); \}\)/
);
for (const settingKey of ['tooltipDelaySeconds', 'bgmVolume', 'sfxVolume']) {
    assert.match(
        settingsSource,
        new RegExp(`onChange\\(\\(val\\) => \\{ this\\.#handleSettingInput\\('${settingKey}', val\\); \\}\\)`)
    );
}
assert.doesNotMatch(
    settingsSource,
    /onCommit\(\(val\) => \{ this\.#handleSettingInput\('(tooltipDelaySeconds|bgmVolume|sfxVolume)'/
);

console.log('ui scale live preview contract: ok');
