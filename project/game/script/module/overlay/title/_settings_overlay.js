import { TitleOverlay } from './_title_overlay.js';
import { getLangString } from 'ui/ui_system.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { getBaseWW, getBaseWH } from 'display/display_system.js';
import { previewSettingBatch, setSettingBatch, getSettingSchema } from 'save/save_system.js';
import { LayoutHandler } from 'ui/layout/_layout_handler.js';
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
const SETTINGS_LAYOUT = TITLE_CONSTANTS.TITLE_OVERLAY.SETTINGS.LAYOUT;

/**
 * @class SettingsOverlay
 * @description 타이틀 화면의 설정 오버레이를 구성하고 변경된 옵션을 저장합니다.
 */
export class SettingsOverlay extends TitleOverlay {
    constructor(TitleScene) {
        super(TitleScene, { glOverlay: true, titleIconId: 'setting' });

        this.settingsChanged = false;
        this.settingComponents = {};
        this.rollbackOnClose = true;
        this.previewQueue = new SettingsPreviewQueue({
            applyRuntimeSettings: (changedSettings) => this.#applyRuntimeSettings(changedSettings)
        });
        const availableLanguages = getAvailableLanguages();
        this.availableLanguages = availableLanguages;
        this.tempSettings = createSettingsInitialState({
            availableLanguages,
            defaultThemeKey: DEFAULT_THEME_KEY
        });
        this.initialSettings = { ...this.tempSettings };
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
     * 화면 내 설정 항목들(왼쪽/오른쪽 단)을 배치하여 레이아웃을 빌드합니다.
     */
    _generateLayout() {
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
                if (!this.settingsChanged) {
                    this.rollbackOnClose = false;
                    this.close();
                    return;
                }

                await this.#flushPendingPreview();
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
     * 저장 완료 후 변경된 설정을 런타임에 즉시 반영합니다.
     * @param {object} [changedSettings={}] - 변경된 설정 키와 값입니다.
     * @returns {Promise<void>}
     */
    async #applyRuntimeSettings(changedSettings = {}) {
        const systemHandler = this.titleScene?.sceneSystem?.systemHandler;
        if (!systemHandler || typeof systemHandler.applyRuntimeSettings !== 'function') {
            return;
        }

        await systemHandler.applyRuntimeSettings(changedSettings);
    }

    /**
     * 미리보기 반영이 현재 업데이트 루프를 끊지 않도록 다음 마이크로태스크로 지연합니다.
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
        await this.previewQueue.flush();
    }

    /**
     * 현재 미리보기 상태를 초기 스냅샷으로 되돌린 뒤 overlay를 닫습니다.
     * @returns {Promise<void>}
     */
    async #cancelChanges() {
        await this.#flushPendingPreview();
        const revertedSettings = getRevertedSettings(this.initialSettings, this.tempSettings);
        if (Object.keys(revertedSettings).length > 0) {
            previewSettingBatch(revertedSettings);
            await this.#applyRuntimeSettings(revertedSettings);
            this.tempSettings = { ...this.initialSettings };
            this.#refreshChangedLabels();
        }

        this.rollbackOnClose = false;
        this.close();
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
            .onChange((val) => { this.#handleSettingInput('uiScale', val, { preview: false }); })
            .onCommit((val) => { this.#handleSettingInput('uiScale', val); });
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
            .onChange((val) => { this.#handleSettingInput('tooltipDelaySeconds', val, { preview: false }); })
            .onCommit((val) => { this.#handleSettingInput('tooltipDelaySeconds', val); });
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
            .onChange((val) => { this.#handleSettingInput('bgmVolume', val, { preview: false }); })
            .onCommit((val) => { this.#handleSettingInput('bgmVolume', val); });
        this._addItemFooter(handler, null, spacingScale);

        this._addItemHeader(handler, 'title_settings_sfx', 'sfxVolume');
        const sfxSchema = getSettingSchema('sfxVolume');
        handler.width("parent", controlWrapWidth).item("slider", "control_sfxVolume").width("parent", controlMaxWidth)
            .prop("trackHeight", this.WH * SLIDER.TRACK_HEIGHT_WH_RATIO * this.uiScale).prop("knobRadius", this.WH * SLIDER.KNOB_RADIUS_WH_RATIO * this.uiScale)
            .prop("min", sfxSchema.min).prop("max", sfxSchema.max).setValue(this.tempSettings.sfxVolume)
            .prop("valueOffsetX", this.UIWW * SLIDER.VALUE_OFFSET_X_UIWW_RATIO * this.uiScale)
            .prop("valueFont", sliderValueFont)
            .prop("valueOffsetY", this.WH * SLIDER.VALUE_OFFSET_Y_WH_RATIO * this.uiScale)
            .onChange((val) => { this.#handleSettingInput('sfxVolume', val, { preview: false }); })
            .onCommit((val) => { this.#handleSettingInput('sfxVolume', val); });
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
     * 변경된 모든 임시 설정을 실제 세이브 데이터에 일괄 저장합니다.
     * @returns {Promise<object>} 실제로 변경되어 저장된 설정 키와 값입니다.
     */
    async save() {
        await this.#flushPendingPreview();
        const changedSettings = getChangedSettings(this.initialSettings, this.tempSettings);
        if (Object.keys(changedSettings).length === 0) {
            this.settingsChanged = false;
            return changedSettings;
        }

        await setSettingBatch({
            ...changedSettings,
            screenModeChanged: false
        });

        this.initialSettings = { ...this.tempSettings };
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
     * overlay가 저장 없이 닫히는 경우 미리보기 설정을 원복합니다.
     */
    onCloseComplete() {
        if (!this.rollbackOnClose || !this.settingsChanged) {
            return;
        }

        void (async () => {
            await this.#flushPendingPreview();
            const revertedSettings = getRevertedSettings(this.initialSettings, this.tempSettings);
            if (Object.keys(revertedSettings).length === 0) {
                return;
            }

            previewSettingBatch(revertedSettings);
            await this.#applyRuntimeSettings(revertedSettings);
        })();
    }
}
