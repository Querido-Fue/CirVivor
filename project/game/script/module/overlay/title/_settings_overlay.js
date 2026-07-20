import { TitleOverlay } from './_title_overlay.js';
import { getLangString } from 'ui/ui_system.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { getBaseWW, getBaseWH } from 'display/display_system.js';
import { previewSettingBatch, setSettingBatch, getSettingSchema } from 'save/save_system.js';
import { LayoutHandler } from 'ui/layout/_layout_handler.js';
import { releaseUIItem } from 'ui/_ui_pool.js';
import { getAvailableLanguages } from 'ui/lang/_language_handler.js';
import { getData } from 'data/data_handler.js';
import { createFontStringFromPreset } from 'util/font_util.js';
import { applyOverlayConfirmButtonIcon } from '../_overlay_confirm_icon.js';
import {
    SETTING_LABEL_KEYS,
    createSettingsInitialState,
    formatTooltipDelayValue,
    getChangedSettings,
    getRevertedSettings,
    getSettingLabelId,
    getSettingLabelText,
    hasSettingsChanges
} from './settings/_settings_state.js';
import { SettingsPreviewQueue } from './settings/_settings_preview_queue.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');
const THEME_OPTIONS = getData('THEME_OPTIONS');
const DEFAULT_THEME_KEY = getData('DEFAULT_THEME_KEY');
const TEXT_CONSTANTS = getData('TEXT_CONSTANTS');
const SETTING_ROLLBACK_ANIMATION = getData('UI_CONSTANTS').SETTING_ROLLBACK_ANIMATION;
const SETTINGS_LAYOUT = TITLE_CONSTANTS.TITLE_OVERLAY.SETTINGS.LAYOUT;
const UI_SCALE_COMPONENT_ID = 'control_uiScale';
const UI_SCALE_EPSILON = 0.000001;

/**
 * @class SettingsOverlay
 * @description 타이틀 화면의 설정 오버레이를 구성하고 변경된 옵션을 저장합니다.
 */
export class SettingsOverlay extends TitleOverlay {
    #pendingTransientUiScale = null;
    #transientUiScalePromise = null;
    #preservedComponentIds = new Set();
    #lastRuntimeUiScaleDisplayValue = null;
    #uiScaleCommitGeneration = 0;
    #uiScaleCommitPromise = null;
    #isCancelling = false;

    constructor(TitleScene) {
        super(TitleScene, { glOverlay: true, titleIconId: 'setting' });

        this.settingsChanged = false;
        this.settingComponents = {};
        this.rollbackOnClose = true;
        this.previewQueue = new SettingsPreviewQueue({
            applyRuntimeSettings: (changedSettings) => this.#applyPreviewRuntimeSettings(changedSettings)
        });
        const availableLanguages = getAvailableLanguages();
        this.availableLanguages = availableLanguages;
        this.tempSettings = createSettingsInitialState({
            availableLanguages,
            defaultThemeKey: DEFAULT_THEME_KEY
        });
        this.initialSettings = { ...this.tempSettings };
        this.#lastRuntimeUiScaleDisplayValue = this.tempSettings.uiScale;
    }

    /**
     * @override
     * 화면 크기에 비례하여 설정 메뉴 팝업 크기를 계산합니다.
     */
    _onResize() {
        this.width = this.UIWW * TITLE_CONSTANTS.TITLE_OVERLAY.SETTINGS.WIDTH_UIWW_RATIO;
        this.height = this.WH * TITLE_CONSTANTS.TITLE_OVERLAY.SETTINGS.HEIGHT_WH_RATIO;
    }

    /**
     * @override
     * UI 요소를 갱신한 뒤 uiScale slider의 보간 표시값을 런타임 레이아웃에 전달합니다.
     */
    update() {
        super.update();
        if (this.#isCancelling) {
            return;
        }
        this.#syncUiScaleDisplayPreview();
    }

    /**
     * @override
     * 화면 내 설정 항목들(왼쪽/오른쪽 단)을 배치하여 레이아웃을 빌드합니다.
     */
    _generateLayout() {
        const retainedComponents = this.#detachPreservedComponentsForRelayout();
        this._releaseElements();
        const { HEADER, LEFT_COLUMN, RIGHT_COLUMN, FOOTER } = SETTINGS_LAYOUT;
        const headerHandler = new LayoutHandler(this, this.positioningHandler)
            .layoutStartPos("OX", HEADER.START_X_OX, "OY", HEADER.START_Y_OY)
            .layoutSize("OW", HEADER.WIDTH_OW, "OH", HEADER.HEIGHT_OH)
            .paddingX("WW", HEADER.PADDING_X_WW)
            .space("WH", HEADER.TITLE_TOP_SPACE_WH)
            .item("text", "title_text").stylePreset("h1").text(getLangString('title_settings_title')).fill(ColorSchemes.Title.TextDark)
            .space("WH", HEADER.DIVIDER_TOP_SPACE_WH)
            .item("line", "divider_line").width("fill").stroke(ColorSchemes.Overlay.Panel.Divider).lineWidth(1).align("center");

        const leftHandler = new LayoutHandler(this, this.positioningHandler)
            .layoutStartPos("OX", LEFT_COLUMN.START_X_OX, "OY", LEFT_COLUMN.START_Y_OY)
            .layoutSize("OW", LEFT_COLUMN.WIDTH_OW, "OH", LEFT_COLUMN.HEIGHT_OH)
            .paddingX("absolute", 0);

        this._buildLeftColumn(leftHandler);

        const rightHandler = new LayoutHandler(this, this.positioningHandler)
            .layoutStartPos("OX", RIGHT_COLUMN.START_X_OX, "OY", RIGHT_COLUMN.START_Y_OY)
            .layoutSize("OW", RIGHT_COLUMN.WIDTH_OW, "OH", RIGHT_COLUMN.HEIGHT_OH)
            .paddingX("absolute", 0);

        this._buildRightColumn(rightHandler);

        const footHandler = new LayoutHandler(this, this.positioningHandler)
            .layoutStartPos("OX", FOOTER.START_X_OX, "OY", FOOTER.START_Y_OY)
            .layoutSize("OW", FOOTER.WIDTH_OW, "OH", FOOTER.HEIGHT_OH)
            .paddingX("WW", FOOTER.PADDING_X_WW);

        footHandler.bottomSpace("WH", FOOTER.BOTTOM_SPACE_WH)
            .bottomGroup().justifyContent("right", "WW", FOOTER.BUTTON_GAP_WW).align("right")
            .item("button", "cancel_btn").stylePreset("overlay_interact_button")
            .buttonText(getLangString('title_settings_cancel')).onClick(async () => {
                await this.#cancelChanges();
            })
            .buttonColor(ColorSchemes.Overlay.Button.Cancel).icon("deny")
            .item("button", "save_btn").stylePreset("overlay_interact_button")
            .buttonText(getLangString('title_settings_save')).onClick(async () => {
                await this.save();
                this.rollbackOnClose = false;
                this.close();
            });

        applyOverlayConfirmButtonIcon(footHandler);

        footHandler.endGroup();

        const resHead = headerHandler.build();
        const resLeft = leftHandler.build();
        const resRight = rightHandler.build();
        const resFoot = footHandler.build();

        this.#restorePreservedComponentsAfterRelayout(retainedComponents, [
            resHead,
            resLeft,
            resRight,
            resFoot
        ]);

        this.staticItems = [
            ...resHead.staticItems,
            ...resLeft.staticItems,
            ...resRight.staticItems,
            ...resFoot.staticItems
        ];

        this.dynamicItems = [
            ...resHead.dynamicItems,
            ...resLeft.dynamicItems,
            ...resRight.dynamicItems,
            ...resFoot.dynamicItems
        ];

        this.settingComponents = {
            ...resHead.components,
            ...resLeft.components,
            ...resRight.components,
            ...resFoot.components
        };

        this.#refreshChangedLabels();
    }

    /**
     * 런타임 relayout 동안 보존 대상으로 표시된 control을 풀 회수 대상에서 분리합니다.
     * @returns {Map<string, object>} component ID별 보존 control입니다.
     */
    #detachPreservedComponentsForRelayout() {
        const retainedComponents = new Map();
        for (const componentId of this.#preservedComponentIds) {
            const component = this.settingComponents?.[componentId];
            if (component) {
                retainedComponents.set(componentId, component);
            }
        }

        if (retainedComponents.size > 0) {
            const retainedItems = new Set(retainedComponents.values());
            this.dynamicItems = this.dynamicItems?.filter((entry) => !retainedItems.has(entry.item)) ?? this.dynamicItems;
        }
        return retainedComponents;
    }

    /**
     * 새 레이아웃의 배치·스타일을 기존 control에 이식하고 새 임시 control만 풀에 반환합니다.
     * 값·드래그·열림·보간 상태는 기존 인스턴스에 남아 첫 렌더 전 애니메이션 소실을 막습니다.
     * @param {Map<string, object>} retainedComponents - component ID별 보존 control입니다.
     * @param {Array<{dynamicItems: Array<object>, components: Record<string, object>}>} layoutResults - 전체 빌드 결과입니다.
     * @returns {void}
     */
    #restorePreservedComponentsAfterRelayout(retainedComponents, layoutResults) {
        for (const [componentId, retainedComponent] of retainedComponents) {
            const layoutResult = layoutResults.find((result) => result.components[componentId]);
            const replacement = layoutResult?.components[componentId];
            const replacementEntry = layoutResult?.dynamicItems.find((entry) => entry.item === replacement);
            if (!replacement
                || !replacementEntry
                || typeof retainedComponent.reconcileLayoutFrom !== 'function') {
                releaseUIItem(retainedComponent);
                continue;
            }

            retainedComponent.reconcileLayoutFrom(replacement);
            replacementEntry.item = retainedComponent;
            layoutResult.components[componentId] = retainedComponent;
            releaseUIItem(replacement);
        }
    }

    /**
     * 설정값 변경 여부에 맞춰 항목 라벨과 저장 가능 상태를 갱신합니다.
     */
    #refreshChangedLabels() {
        this.settingsChanged = hasSettingsChanges(this.initialSettings, this.tempSettings);

        for (const [settingKey, labelKey] of Object.entries(SETTING_LABEL_KEYS)) {
            const labelComponent = this.settingComponents[getSettingLabelId(settingKey)];
            if (!labelComponent) {
                continue;
            }
            labelComponent.text = getSettingLabelText(this.initialSettings, this.tempSettings, settingKey, labelKey);
        }
    }

    /**
     * 설정값 변경을 반영하고 관련 라벨 상태를 즉시 갱신합니다.
     * @param {keyof typeof SETTING_LABEL_KEYS} settingKey - 변경할 설정 키입니다.
     * @param {string|number|boolean} value - 새 설정 값입니다.
     */
    #handleSettingChange(settingKey, value) {
        this.tempSettings[settingKey] = value;
        this.#refreshChangedLabels();
    }

    /**
     * 설정값 변경을 미리보기까지 포함해 반영합니다.
     * @param {keyof typeof SETTING_LABEL_KEYS} settingKey - 변경할 설정 키입니다.
     * @param {string|number|boolean} value - 새 설정 값입니다.
     * @param {{preview?: boolean}} [options={}] - 미리보기 반영 여부입니다.
     */
    #handleSettingInput(settingKey, value, options = {}) {
        this.#handleSettingChange(settingKey, value);
        if (options.preview === false) {
            return;
        }
        this.#queuePreviewSettings({ [settingKey]: value });
    }

    /**
     * uiScale raw 목표값만 임시 상태에 반영하고 기존 commit을 무효화합니다.
     * @param {number} value - 정수 단위 uiScale 목표값입니다.
     * @returns {void}
     */
    #handleUiScaleChange(value) {
        this.#uiScaleCommitGeneration += 1;
        this.#handleSettingChange('uiScale', value);
    }

    /**
     * 표시값 보간이 끝난 뒤에만 기존 설정 미리보기 큐로 정수 uiScale을 commit합니다.
     * @param {number} value - commit할 정수 단위 uiScale입니다.
     * @returns {Promise<void>}
     */
    #handleUiScaleCommit(value) {
        this.#handleSettingChange('uiScale', value);
        const generation = ++this.#uiScaleCommitGeneration;
        const slider = this.settingComponents?.[UI_SCALE_COMPONENT_ID];

        const commit = (async () => {
            await slider?.waitForDisplayValueSettle?.();
            if (generation !== this.#uiScaleCommitGeneration) {
                return;
            }

            const finalDisplayValue = Number(slider?.displayValue ?? value);
            await this.#queueTransientUiScale(finalDisplayValue);
            await this.#flushTransientUiScale();
            if (generation !== this.#uiScaleCommitGeneration) {
                return;
            }

            await this.#queuePreviewSettings({ uiScale: value });
        })();

        const trackedCommit = commit.finally(() => {
            if (this.#uiScaleCommitPromise === trackedCommit) {
                this.#uiScaleCommitPromise = null;
            }
        });
        this.#uiScaleCommitPromise = trackedCommit;
        return trackedCommit;
    }

    /**
     * 현재 frame의 보간 표시값을 저장 상태를 건드리지 않는 런타임 갱신 큐에 넣습니다.
     * @returns {void}
     */
    #syncUiScaleDisplayPreview() {
        const displayValue = Number(this.settingComponents?.[UI_SCALE_COMPONENT_ID]?.displayValue);
        if (!Number.isFinite(displayValue) || displayValue <= 0) {
            return;
        }

        void this.#queueTransientUiScale(displayValue).catch((error) => {
            console.error('uiScale transient runtime preview failed.', error);
        });
    }

    /**
     * 저장 메모리를 변경하지 않고 최신 uiScale 표시값만 런타임에 순차 반영합니다.
     * @param {number} displayValue - 퍼센트 단위 보간 표시값입니다.
     * @returns {Promise<void>}
     */
    #queueTransientUiScale(displayValue) {
        const normalizedValue = Number(displayValue);
        if (!Number.isFinite(normalizedValue) || normalizedValue <= 0) {
            return Promise.resolve();
        }

        const isDuplicate = this.#lastRuntimeUiScaleDisplayValue !== null
            && Math.abs(this.#lastRuntimeUiScaleDisplayValue - normalizedValue) <= UI_SCALE_EPSILON;
        if (isDuplicate && this.#pendingTransientUiScale === null) {
            return this.#transientUiScalePromise ?? Promise.resolve();
        }

        this.#lastRuntimeUiScaleDisplayValue = normalizedValue;
        this.#pendingTransientUiScale = normalizedValue;
        this.#startTransientUiScaleDrain();
        return this.#transientUiScalePromise ?? Promise.resolve();
    }

    /**
     * 대기 중인 최신 표시값을 runtime 설정 경로에 전달하는 단일 drain을 시작합니다.
     * @returns {void}
     */
    #startTransientUiScaleDrain() {
        if (this.#transientUiScalePromise || this.#pendingTransientUiScale === null) {
            return;
        }

        const drain = (async () => {
            await Promise.resolve();
            while (this.#pendingTransientUiScale !== null) {
                const nextValue = this.#pendingTransientUiScale;
                this.#pendingTransientUiScale = null;
                await this.#applyRuntimeSettings(
                    { uiScale: nextValue },
                    [UI_SCALE_COMPONENT_ID]
                );
            }
        })();

        const trackedDrain = drain.finally(() => {
            if (this.#transientUiScalePromise === trackedDrain) {
                this.#transientUiScalePromise = null;
            }
            this.#startTransientUiScaleDrain();
        });
        this.#transientUiScalePromise = trackedDrain;
    }

    /**
     * transient uiScale 런타임 반영이 모두 끝날 때까지 기다립니다.
     * @returns {Promise<void>}
     */
    async #flushTransientUiScale() {
        while (this.#transientUiScalePromise || this.#pendingTransientUiScale !== null) {
            this.#startTransientUiScaleDrain();
            const pendingDrain = this.#transientUiScalePromise;
            if (pendingDrain) {
                await pendingDrain;
            }
        }
    }


    /**
     * 설정 미리보기 relayout 동안 변경을 시작한 control 인스턴스를 보존합니다.
     * @param {object} changedSettings - 변경된 설정 키와 값입니다.
     * @returns {Promise<void>}
     */
    #applyPreviewRuntimeSettings(changedSettings) {
        const preservedComponentIds = Object.keys(changedSettings)
            .map((settingKey) => `control_${settingKey}`)
            .filter((componentId) => (
                typeof this.settingComponents?.[componentId]?.reconcileLayoutFrom === 'function'
            ));
        return this.#applyRuntimeSettings(changedSettings, preservedComponentIds);
    }

    /**
     * 변경된 설정을 런타임에 즉시 반영하며 지정 control의 relayout 상태를 보존합니다.
     * @param {object} [changedSettings={}] - 변경된 설정 키와 값입니다.
     * @param {string[]} [preservedComponentIds=[]] - relayout 중 보존할 control component ID입니다.
     * @returns {Promise<void>}
     */
    async #applyRuntimeSettings(changedSettings = {}, preservedComponentIds = []) {
        for (const componentId of preservedComponentIds) {
            this.#preservedComponentIds.add(componentId);
        }
        try {
            const systemHandler = this.titleScene?.sceneSystem?.systemHandler;
            if (!systemHandler || typeof systemHandler.applyRuntimeSettings !== 'function') {
                return;
            }

            await systemHandler.applyRuntimeSettings(changedSettings);
        } finally {
            for (const componentId of preservedComponentIds) {
                this.#preservedComponentIds.delete(componentId);
            }
        }
    }

    /**
     * 이 호출 경로 자체에서 디스크를 쓰지 않는 미리보기를 현재 업데이트 루프를 끊지 않도록
     * 다음 마이크로태스크로 지연합니다.
     * @param {object} changedSettings - 반영할 설정 키와 값입니다.
     * @returns {Promise<void>}
     */
    #queuePreviewSettings(changedSettings) {
        return this.previewQueue.queue(changedSettings);
    }

    /**
     * 대기 중인 미리보기 반영 작업을 모두 끝낼 때까지 기다립니다.
     * @returns {Promise<void>}
     */
    async #flushPendingPreview() {
        while (this.#uiScaleCommitPromise) {
            await this.#uiScaleCommitPromise;
        }
        await this.#flushTransientUiScale();
        await this.previewQueue.flush();
    }

    /**
     * 마지막으로 요청한 transient 표시값이 초기 uiScale과 다른지 확인합니다.
     * @returns {boolean} 런타임 원복이 필요하면 true입니다.
     */
    #hasTransientUiScaleDrift() {
        const initialUiScale = Number(this.initialSettings.uiScale);
        const runtimeUiScale = Number(this.#lastRuntimeUiScaleDisplayValue);
        return Number.isFinite(initialUiScale)
            && Number.isFinite(runtimeUiScale)
            && Math.abs(initialUiScale - runtimeUiScale) > UI_SCALE_EPSILON;
    }

    /**
     * uiScale raw 값이 변경되지 않은 상태에서 남은 transient 런타임 배율을 초기값으로 되돌립니다.
     * @returns {Promise<void>}
     */
    async #restoreTransientUiScaleRuntime() {
        if (!this.#hasTransientUiScaleDrift()) {
            return;
        }

        await this.#queueTransientUiScale(this.initialSettings.uiScale);
        await this.#flushTransientUiScale();
    }

    /**
     * 메모리 원복 대상에 transient 전용 uiScale 원복값을 합쳐 런타임 원복 대상을 만듭니다.
     * @param {object} revertedSettings - 메모리에 되돌릴 설정입니다.
     * @returns {object} 런타임에 되돌릴 설정입니다.
     */
    #createRuntimeRevertedSettings(revertedSettings) {
        const runtimeSettings = { ...revertedSettings };
        if (runtimeSettings.uiScale === undefined && this.#hasTransientUiScaleDrift()) {
            runtimeSettings.uiScale = this.initialSettings.uiScale;
        }
        return runtimeSettings;
    }

    /**
     * control의 초기값 복귀와 overlay 닫기를 같은 프레임에 시작합니다.
     * 실제 메모리·런타임 원복은 닫기 완료 훅에서 처리합니다.
     * @returns {void}
     */
    #cancelChanges() {
        if (this.#isCancelling) {
            return;
        }

        this.#isCancelling = true;
        this.#uiScaleCommitGeneration += 1;
        void this.#animateControlsToInitialSettings();
        this.close();
    }

    /**
     * 취소 닫기와 동시에 모든 설정 control을 초기 스냅샷 값으로 복귀시킵니다.
     * @returns {Promise<void>} 시작한 control 애니메이션이 모두 끝나면 이행됩니다.
     */
    #animateControlsToInitialSettings() {
        const animations = [];
        for (const [settingKey, initialValue] of Object.entries(this.initialSettings)) {
            const component = this.settingComponents?.[`control_${settingKey}`];
            if (!component || typeof component.animateToValue !== 'function') {
                continue;
            }

            animations.push(component.animateToValue(initialValue, {
                duration: SETTING_ROLLBACK_ANIMATION.DURATION_SECONDS,
                easing: SETTING_ROLLBACK_ANIMATION.EASING,
                notify: false
            }));
        }
        return Promise.all(animations).then(() => undefined);
    }

    /**
     * 키 설정 overlay를 여는 진입점입니다.
     */
    #openKeybindings() {
    }

    /**
     * 현재 표시 설정 상태로 벤치마크 씬을 시작합니다.
     * @returns {Promise<void>}
     */
    async #startBenchmarkScene() {
        await this.#flushPendingPreview();
        this.rollbackOnClose = false;
        this.titleScene?.benchmarkStart?.();
    }

    /**
     * 왼쪽 설정 열의 디스플레이 항목을 구성합니다.
     * @param {LayoutHandler} handler - 왼쪽 열 레이아웃 핸들러입니다.
     */
    _buildLeftColumn(handler) {
        const { COLUMN, CONTROL, SLIDER } = SETTINGS_LAYOUT;
        const spacingScale = COLUMN.SPACING_SCALE;
        const controlWrapWidth = COLUMN.CONTROL_WRAP_WIDTH_PARENT;
        const controlMaxWidth = COLUMN.CONTROL_MAX_WIDTH_PARENT;
        const sliderValueFont = this._getTextPresetFont('SETTINGS_SLIDER_VALUE');

        this._addSectionHeader(handler, 'title_settings_section_display');
        handler.space("OH", COLUMN.SECTION_HEADER_BOTTOM_SPACE_OH * spacingScale);

        this._addItemHeader(handler, 'title_settings_window_mode', 'windowMode');
        const windowModeItems = [
            { label: getLangString('title_settings_window_mode_windowed'), value: 'windowed' },
            { label: getLangString('title_settings_window_mode_fullscreen'), value: 'fullscreen' }
        ];
        handler.width("parent", controlWrapWidth).item("dropdown", "control_windowMode").width("parent", controlMaxWidth).height("WH", CONTROL.DROPDOWN_HEIGHT_WH)
            .items(windowModeItems)
            .setValue(this.tempSettings.windowMode).stylePreset("h6_bold")
            .prop("openDirection", "down")
            .onChange((val) => { this.#handleSettingInput('windowMode', val); });
        this._addItemFooter(handler, null, spacingScale);

        this._addItemHeader(handler, 'title_settings_widescreen_support', 'widescreenSupport');
        handler.width("parent", controlWrapWidth)
            .group().justifyContent("left", "WW", 0).width("parent", controlMaxWidth)
            .item("toggle", "control_widescreenSupport").width("WW", CONTROL.TOGGLE_WIDTH_WW).height("WH", CONTROL.TOGGLE_HEIGHT_WH)
            .setValue(this.tempSettings.widescreenSupport)
            .onChange((val) => { this.#handleSettingInput('widescreenSupport', val); });
        handler.endGroup();
        this._addItemFooter(handler, 'title_settings_desc_widescreen_support', spacingScale);

        this._addItemHeader(handler, 'title_settings_render_scale', 'renderScale');
        const rsSchema = getSettingSchema('renderScale');
        handler.width("parent", controlWrapWidth).item("slider", "control_renderScale").width("parent", controlMaxWidth)
            .prop("trackHeight", this.WH * SLIDER.TRACK_HEIGHT_WH_RATIO * this.uiScale).prop("knobRadius", this.WH * SLIDER.KNOB_RADIUS_WH_RATIO * this.uiScale)
            .prop("min", rsSchema.min).prop("max", rsSchema.max).setValue(this.tempSettings.renderScale)
            .prop("valueSuffix", '%')
            .prop("valueOffsetX", this.UIWW * SLIDER.VALUE_OFFSET_X_UIWW_RATIO * this.uiScale)
            .prop("valueFont", sliderValueFont)
            .prop("valueOffsetY", this.WH * SLIDER.VALUE_OFFSET_Y_WH_RATIO * this.uiScale)
            .prop("valueFormatter", (v) => `${v}% (${Math.round(getBaseWW() * v / 100)}×${Math.round(getBaseWH() * v / 100)})`)
            .onChange((val) => { this.#handleSettingInput('renderScale', val, { preview: false }); })
            .onCommit((val) => { this.#handleSettingInput('renderScale', val); });
        this._addItemFooter(handler, 'title_settings_desc_render_scale', spacingScale);

        this._addItemHeader(handler, 'title_settings_ui_scale', 'uiScale');
        const usSchema = getSettingSchema('uiScale');
        handler.width("parent", controlWrapWidth).item("slider", "control_uiScale").width("parent", controlMaxWidth)
            .prop("trackHeight", this.WH * SLIDER.TRACK_HEIGHT_WH_RATIO * this.uiScale).prop("knobRadius", this.WH * SLIDER.KNOB_RADIUS_WH_RATIO * this.uiScale)
            .prop("min", usSchema.min).prop("max", usSchema.max).setValue(this.tempSettings.uiScale)
            .prop("valueSuffix", '%')
            .prop("valueOffsetX", this.UIWW * SLIDER.VALUE_OFFSET_X_UIWW_RATIO * this.uiScale)
            .prop("valueFont", sliderValueFont)
            .prop("valueOffsetY", this.WH * SLIDER.VALUE_OFFSET_Y_WH_RATIO * this.uiScale)
            .prop("valueFormatter", (v) => `${v}%`)
            .onChange((val) => { this.#handleUiScaleChange(val); })
            .onCommit((val) => { this.#handleUiScaleCommit(val); });
        this._addItemFooter(handler, 'title_settings_desc_ui_scale', spacingScale);

        this._addItemHeader(handler, 'title_settings_disable_transparency', 'disableTransparency');
        handler.width("parent", controlWrapWidth)
            .group().justifyContent("left", "WW", 0).width("parent", controlMaxWidth)
            .item("toggle", "control_disableTransparency").width("WW", CONTROL.TOGGLE_WIDTH_WW).height("WH", CONTROL.TOGGLE_HEIGHT_WH)
            .setValue(this.tempSettings.disableTransparency)
            .onChange((val) => { this.#handleSettingInput('disableTransparency', val); });
        handler.endGroup();
        this._addItemFooter(handler, 'title_settings_desc_transparency', spacingScale);

        this._addItemHeader(handler, 'title_settings_benchmark');
        handler.width("parent", controlWrapWidth)
            .group().justifyContent("left", "WW", 0).width("parent", controlMaxWidth)
            .item("button", "control_benchmark").stylePreset("overlay_link_button")
            .buttonText(getLangString('title_settings_benchmark_open'))
            .buttonColor(ColorSchemes.Overlay.Button.Link).icon("arrow")
            .onClick(async () => { await this.#startBenchmarkScene(); });
        handler.endGroup();
        this._addItemFooter(handler, null, spacingScale);

        handler.space("OH", COLUMN.COLUMN_END_SPACE_OH * spacingScale);
    }

    /**
     * 오른쪽 설정 열의 UI/사운드/조작 항목을 구성합니다.
     * @param {LayoutHandler} handler - 오른쪽 열 레이아웃 핸들러입니다.
     */
    _buildRightColumn(handler) {
        const { COLUMN, CONTROL, SLIDER } = SETTINGS_LAYOUT;
        const spacingScale = COLUMN.SPACING_SCALE;
        const controlWrapWidth = COLUMN.CONTROL_WRAP_WIDTH_PARENT;
        const controlMaxWidth = COLUMN.CONTROL_MAX_WIDTH_PARENT;
        const sliderValueFont = this._getTextPresetFont('SETTINGS_SLIDER_VALUE');

        this._addSectionHeader(handler, 'title_settings_section_ui');
        handler.space("OH", COLUMN.SECTION_HEADER_BOTTOM_SPACE_OH * spacingScale);

        this._addItemHeader(handler, 'title_settings_language', 'language');
        handler.width("parent", controlWrapWidth).item("dropdown", "control_language").width("parent", controlMaxWidth).height("WH", CONTROL.DROPDOWN_HEIGHT_WH)
            .items(this.availableLanguages.map((lang) => ({ label: lang.languageName, value: lang.key })))
            .setValue(this.tempSettings.language).stylePreset("h6_bold")
            .prop("openDirection", "down")
            .onChange((val) => { this.#handleSettingInput('language', val); });
        this._addItemFooter(handler, null, spacingScale);

        this._addItemHeader(handler, 'title_settings_theme', 'theme');
        const themeItems = THEME_OPTIONS.map((option) => ({
            label: getLangString(option.labelKey) || option.key,
            value: option.key
        }));
        handler.width("parent", controlWrapWidth).item("dropdown", "control_theme").width("parent", controlMaxWidth).height("WH", CONTROL.DROPDOWN_HEIGHT_WH)
            .items(themeItems)
            .setValue(this.tempSettings.theme).stylePreset("h6_bold")
            .prop("openDirection", "down")
            .onChange((val) => { this.#handleSettingInput('theme', val); });
        this._addItemFooter(handler, null, spacingScale);

        this._addItemHeader(handler, 'title_settings_tooltip_delay', 'tooltipDelaySeconds');
        const tooltipDelaySchema = getSettingSchema('tooltipDelaySeconds');
        handler.width("parent", controlWrapWidth).item("slider", "control_tooltipDelaySeconds").width("parent", controlMaxWidth)
            .prop("trackHeight", this.WH * SLIDER.TRACK_HEIGHT_WH_RATIO * this.uiScale).prop("knobRadius", this.WH * SLIDER.KNOB_RADIUS_WH_RATIO * this.uiScale)
            .prop("min", tooltipDelaySchema.min).prop("max", tooltipDelaySchema.max).prop("step", 0.1).setValue(this.tempSettings.tooltipDelaySeconds)
            .prop("valueOffsetX", this.UIWW * SLIDER.VALUE_OFFSET_X_UIWW_RATIO * this.uiScale)
            .prop("valueFont", sliderValueFont)
            .prop("valueOffsetY", this.WH * SLIDER.VALUE_OFFSET_Y_WH_RATIO * this.uiScale)
            .prop("valueFormatter", (v) => formatTooltipDelayValue(v, this.tempSettings.language))
            .onChange((val) => { this.#handleSettingInput('tooltipDelaySeconds', val); });
        this._addItemFooter(handler, 'title_settings_desc_tooltip_delay', spacingScale);

        handler.space("OH", COLUMN.SECTION_GROUP_GAP_OH * spacingScale);

        this._addSectionHeader(handler, 'title_settings_section_sound');
        handler.space("OH", COLUMN.SECTION_HEADER_BOTTOM_SPACE_OH * spacingScale);

        this._addItemHeader(handler, 'title_settings_bgm', 'bgmVolume');
        const bgmSchema = getSettingSchema('bgmVolume');
        handler.width("parent", controlWrapWidth).item("slider", "control_bgmVolume").width("parent", controlMaxWidth)
            .prop("trackHeight", this.WH * SLIDER.TRACK_HEIGHT_WH_RATIO * this.uiScale).prop("knobRadius", this.WH * SLIDER.KNOB_RADIUS_WH_RATIO * this.uiScale)
            .prop("min", bgmSchema.min).prop("max", bgmSchema.max).setValue(this.tempSettings.bgmVolume)
            .prop("valueOffsetX", this.UIWW * SLIDER.VALUE_OFFSET_X_UIWW_RATIO * this.uiScale)
            .prop("valueFont", sliderValueFont)
            .prop("valueOffsetY", this.WH * SLIDER.VALUE_OFFSET_Y_WH_RATIO * this.uiScale)
            .onChange((val) => { this.#handleSettingInput('bgmVolume', val); });
        this._addItemFooter(handler, null, spacingScale);

        this._addItemHeader(handler, 'title_settings_sfx', 'sfxVolume');
        const sfxSchema = getSettingSchema('sfxVolume');
        handler.width("parent", controlWrapWidth).item("slider", "control_sfxVolume").width("parent", controlMaxWidth)
            .prop("trackHeight", this.WH * SLIDER.TRACK_HEIGHT_WH_RATIO * this.uiScale).prop("knobRadius", this.WH * SLIDER.KNOB_RADIUS_WH_RATIO * this.uiScale)
            .prop("min", sfxSchema.min).prop("max", sfxSchema.max).setValue(this.tempSettings.sfxVolume)
            .prop("valueOffsetX", this.UIWW * SLIDER.VALUE_OFFSET_X_UIWW_RATIO * this.uiScale)
            .prop("valueFont", sliderValueFont)
            .prop("valueOffsetY", this.WH * SLIDER.VALUE_OFFSET_Y_WH_RATIO * this.uiScale)
            .onChange((val) => { this.#handleSettingInput('sfxVolume', val); });
        this._addItemFooter(handler, null, spacingScale);

        handler.space("OH", COLUMN.SECTION_GROUP_GAP_OH * spacingScale);

        this._addSectionHeader(handler, 'title_settings_section_controls');
        handler.space("OH", COLUMN.SECTION_HEADER_BOTTOM_SPACE_OH * spacingScale);

        this._addItemHeader(handler, 'title_settings_keybindings');
        handler.width("parent", controlWrapWidth)
            .group().justifyContent("left", "WW", 0).width("parent", controlMaxWidth)
            .item("button", "control_keybindings").stylePreset("overlay_link_button")
            .buttonText(getLangString('title_settings_keybindings_open'))
            .buttonColor(ColorSchemes.Overlay.Button.Link).icon("arrow")
            .onClick(() => { this.#openKeybindings(); });
        handler.endGroup();
        this._addItemFooter(handler, null, spacingScale);

        handler.space("OH", COLUMN.COLUMN_END_SPACE_OH * spacingScale);
    }

    /**
     * 설정 섹션 헤더를 추가합니다.
     * @param {LayoutHandler} handler - 레이아웃 핸들러입니다.
     * @param {string} labelKey - 다국어 라벨 키입니다.
     */
    _addSectionHeader(handler, labelKey) {
        const { ITEM_HEADER } = SETTINGS_LAYOUT;
        handler.group().justifyContent("space-between", "WW", ITEM_HEADER.CONTROL_GAP_WW).width("parent", 100).align("center")
            .item("text").text(getLangString(labelKey)).stylePreset("h3").fill(ColorSchemes.Overlay.Text.Section).vAlign("center")
            .item("line").width("fill").stroke(ColorSchemes.Overlay.Panel.Divider).lineWidth(1).vAlign("center")
            .endGroup();
    }
    /**
     * 설정 항목 헤더를 생성합니다.
     * @param {LayoutHandler} handler - 레이아웃 핸들러입니다.
     * @param {string} labelKey - 다국어 라벨 키입니다.
     * @param {keyof typeof SETTING_LABEL_KEYS|null} [settingKey=null] - 변경 상태를 추적할 설정 키입니다.
     */
    _addItemHeader(handler, labelKey, settingKey = null) {
        const { ITEM_HEADER } = SETTINGS_LAYOUT;
        const labelId = settingKey ? getSettingLabelId(settingKey) : null;
        const labelText = settingKey
            ? getSettingLabelText(this.initialSettings, this.tempSettings, settingKey, labelKey)
            : getLangString(labelKey);

        // 라벨 길이(언어별 차이)에 영향을 받지 않도록 라벨 영역을 고정 폭으로 분리
        handler.group().justifyContent("left", "WW", 0).width("parent", ITEM_HEADER.ROW_WIDTH_PARENT).align("center")
            .group().justifyContent("left", "WW", 0).width("parent", ITEM_HEADER.LABEL_WIDTH_PARENT).vAlign("center")
            .item("text", labelId).text(labelText).stylePreset("h5_bold").fill(ColorSchemes.Overlay.Text.Item).vAlign("center")
            .endGroup()
            .spacer()
            .group().justifyContent("right", "WW", ITEM_HEADER.CONTROL_GAP_WW).vAlign("center");
    }

    /**
     * 설정 항목 설명과 하단 간격을 추가합니다.
     * @param {LayoutHandler} handler - 레이아웃 핸들러입니다.
     * @param {string|null} descriptionKey - 설명 다국어 키입니다.
     * @param {number} spacingScale - 열 간격 배율입니다.
     */
    _addItemFooter(handler, descriptionKey, spacingScale) {
        const { ITEM_FOOTER } = SETTINGS_LAYOUT;
        handler.endGroup().endGroup();
        if (descriptionKey) {
            handler.space("OH", ITEM_FOOTER.DESCRIPTION_TOP_SPACE_OH);
            handler.group().justifyContent("left", "WW", 0).width("parent", ITEM_FOOTER.DESCRIPTION_WIDTH_PARENT).align("center")
                .item("text").text(getLangString(descriptionKey)).stylePreset("settings_desc").fill(ColorSchemes.Overlay.Text.Item).prop("alpha", ITEM_FOOTER.DESCRIPTION_ALPHA)
                .endGroup()
                .space("OH", ITEM_FOOTER.DESCRIPTION_BOTTOM_SPACE_MULTIPLIER * spacingScale);
        } else {
            handler.space("OH", ITEM_FOOTER.EMPTY_BOTTOM_SPACE_MULTIPLIER * spacingScale);
        }
    }

    /**
     * 텍스트 프리셋을 현재 UI 스케일에 맞는 Canvas font 문자열로 변환합니다.
     * @param {keyof typeof TEXT_CONSTANTS} presetKey - 텍스트 프리셋 키입니다.
     * @returns {string} Canvas font 속성 문자열입니다.
     */
    _getTextPresetFont(presetKey) {
        return createFontStringFromPreset(TEXT_CONSTANTS[presetKey], {
            fallbackData: TEXT_CONSTANTS.H6,
            defaultWeight: 400,
            resolveSizePx: (sizeData) => this.positioningHandler.parseUIData(sizeData, this.uiScale)
        });
    }

    /**
     * 대기 중인 미리보기를 모두 반영한 뒤 초기 상태와 다른 임시 설정 및
     * hidden `screenModeChanged=false`를 저장합니다.
     * @returns {Promise<Record<string, string|number|boolean>>} `screenModeChanged`를 제외한
     * 초기/임시 상태 비교 결과입니다. 비교 결과가 비어 있으면 파일을 쓰지 않고 빈 객체를 반환합니다.
     */
    async save() {
        await this.#flushPendingPreview();
        const changedSettings = getChangedSettings(this.initialSettings, this.tempSettings);
        if (changedSettings.uiScale === undefined) {
            await this.#restoreTransientUiScaleRuntime();
        }
        if (Object.keys(changedSettings).length === 0) {
            this.settingsChanged = false;
            return changedSettings;
        }

        await setSettingBatch({
            ...changedSettings,
            screenModeChanged: false
        });

        this.initialSettings = { ...this.tempSettings };
        this.#lastRuntimeUiScaleDisplayValue = this.tempSettings.uiScale;
        this.#refreshChangedLabels();
        return changedSettings;
    }

    /**
     * 런타임 설정 변경이 overlay 본인에게도 즉시 반영되도록 처리합니다.
     * @param {object} [changedSettings={}] - 변경된 설정 키와 값입니다.
     */
    applyRuntimeSettings(changedSettings = {}) {
        super.applyRuntimeSettings(changedSettings);
        if (changedSettings.theme !== undefined || changedSettings.language !== undefined) {
            this.resize();
        }
    }

    /**
     * overlay가 저장 없이 닫히는 경우 메모리·런타임 미리보기 설정을 디스크 쓰기 없이 원복합니다.
     * 비동기 원복 작업을 시작하고 즉시 반환합니다.
     * @returns {void}
     */
    onCloseComplete() {
        const hasPendingUiScale = this.#uiScaleCommitPromise !== null
            || this.#transientUiScalePromise !== null
            || this.#pendingTransientUiScale !== null
            || this.#hasTransientUiScaleDrift();
        if (!this.rollbackOnClose || (!this.settingsChanged && !hasPendingUiScale)) {
            return;
        }

        void (async () => {
            await this.#flushPendingPreview();
            const revertedSettings = getRevertedSettings(this.initialSettings, this.tempSettings);
            const runtimeRevertedSettings = this.#createRuntimeRevertedSettings(revertedSettings);
            if (Object.keys(revertedSettings).length > 0) {
                previewSettingBatch(revertedSettings);
            }
            if (Object.keys(runtimeRevertedSettings).length > 0) {
                await this.#applyRuntimeSettings(runtimeRevertedSettings);
            }
            this.#lastRuntimeUiScaleDisplayValue = this.initialSettings.uiScale;
        })();
    }
}
