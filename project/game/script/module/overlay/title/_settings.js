import { TitleOverlay } from './_title_overlay.js';
import { getLangString } from 'ui/ui_system.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { getBaseWW, getBaseWH } from 'display/display_system.js';
import { getSetting, previewSettingBatch, setSettingBatch, getSettingSchema } from 'save/save_system.js';
import { LayoutHandler } from 'ui/layout/_layout_handler.js';
import { getAvailableLanguages } from 'ui/lang/_language_handler.js';
import { getData } from 'data/data_handler.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');
const THEME_OPTIONS = getData('THEME_OPTIONS');
const DEFAULT_THEME_KEY = getData('DEFAULT_THEME_KEY');
const TEXT_CONSTANTS = getData('TEXT_CONSTANTS');
const SIMULATION_WORKER_SHADOW_SETTING_KEY = 'simulationWorkerShadowMode';
const SIMULATION_WORKER_PRESENTATION_SETTING_KEY = 'simulationWorkerPresentationMode';
const SIMULATION_WORKER_AUTHORITY_SETTING_KEY = 'simulationWorkerAuthorityMode';
const MULTICORE_SETTING_KEYS = Object.freeze([
    SIMULATION_WORKER_SHADOW_SETTING_KEY,
    SIMULATION_WORKER_PRESENTATION_SETTING_KEY,
    SIMULATION_WORKER_AUTHORITY_SETTING_KEY
]);
const SETTING_LABEL_KEYS = {
    windowMode: 'title_settings_window_mode',
    widescreenSupport: 'title_settings_widescreen_support',
    renderScale: 'title_settings_render_scale',
    uiScale: 'title_settings_ui_scale',
    disableTransparency: 'title_settings_disable_transparency',
    tooltipDelaySeconds: 'title_settings_tooltip_delay',
    physicsAccuracy: 'title_settings_physics_accuracy',
    multicoreSupport: 'title_settings_multicore_support',
    language: 'title_settings_language',
    theme: 'title_settings_theme',
    bgmVolume: 'title_settings_bgm',
    sfxVolume: 'title_settings_sfx'
};

/**
 * @class SettingsOverlay
 * @description 타이틀 화면의 설정 오버레이를 구성하고 변경된 옵션을 저장합니다.
 */
export class SettingsOverlay extends TitleOverlay {
    #openKeybindings;

    constructor(TitleScene) {
        super(TitleScene, { glOverlay: true, titleIconId: 'setting' });

        this.settingsChanged = false;
        this.settingComponents = {};
        this.rollbackOnClose = true;
        this.pendingPreviewSettings = {};
        this.previewFlushPromise = null;
        const savedWindowMode = getSetting('windowMode');
        const normalizedWindowMode = savedWindowMode === 'windowed' ? 'windowed' : 'fullscreen';
        const availableLanguages = getAvailableLanguages();
        this.availableLanguages = availableLanguages;
        const savedLanguage = getSetting('language');
        const fallbackLanguage = availableLanguages.length > 0 ? availableLanguages[0].key : 'korean';
        const normalizedLanguage = availableLanguages.some((lang) => lang.key === savedLanguage)
            ? savedLanguage
            : fallbackLanguage;

        this.tempSettings = {
            windowMode: normalizedWindowMode,
            widescreenSupport: getSetting('widescreenSupport') !== false,
            renderScale: getSetting('renderScale') || 100,
            uiScale: getSetting('uiScale') || 100,
            disableTransparency: getSetting('disableTransparency') || false,
            tooltipDelaySeconds: this.#normalizeTooltipDelaySeconds(
                getSetting('tooltipDelaySeconds') !== undefined ? getSetting('tooltipDelaySeconds') : 0.7
            ),
            physicsAccuracy: getSetting('physicsAccuracy') || 8,
            multicoreSupport: this.#isMulticoreEnabled(),
            language: normalizedLanguage,
            theme: getSetting('theme') || DEFAULT_THEME_KEY,
            bgmVolume: getSetting('bgmVolume') !== undefined ? getSetting('bgmVolume') : 100,
            sfxVolume: getSetting('sfxVolume') !== undefined ? getSetting('sfxVolume') : 100,
        };

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
        const headerHandler = new LayoutHandler(this, this.positioningHandler)
            .layoutStartPos("OX", 0, "OY", 0)
            .layoutSize("OW", 100, "OH", 19)
            .paddingX("WW", 1.8)
            .space("WH", 2.5)
            .item("text", "title_text").stylePreset("h1").text(getLangString('title_settings_title')).fill(ColorSchemes.Title.TextDark)
            .space("WH", 1.5)
            .item("line", "divider_line").width("fill").stroke(ColorSchemes.Overlay.Panel.Divider).lineWidth(1).align("center");

        const leftHandler = new LayoutHandler(this, this.positioningHandler)
            .layoutStartPos("OX", 3, "OY", 15)
            .layoutSize("OW", 44, "OH", 100)
            .paddingX("absolute", 0);

        this._buildLeftColumn(leftHandler);

        const rightHandler = new LayoutHandler(this, this.positioningHandler)
            .layoutStartPos("OX", 53, "OY", 15)
            .layoutSize("OW", 44, "OH", 100)
            .paddingX("absolute", 0);

        this._buildRightColumn(rightHandler);

        const footHandler = new LayoutHandler(this, this.positioningHandler)
            .layoutStartPos("OX", 0, "OY", 0)
            .layoutSize("OW", 100, "OH", 100)
            .paddingX("WW", 1.8);

        footHandler.bottomSpace("WH", 3)
            .bottomGroup().justifyContent("right", "WW", 1).align("right")
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

        if (getLangString("affirmative_icon") === "check") {
            footHandler.icon("check").buttonColor(ColorSchemes.Overlay.Button.Confirm);
        } else {
            footHandler.icon("confirm").buttonColor(ColorSchemes.Overlay.Button.Confirm);
        }

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
        this.settingsChanged = this.#hasSettingsChanges();

        for (const [settingKey, labelKey] of Object.entries(SETTING_LABEL_KEYS)) {
            const labelComponent = this.settingComponents[this.#getSettingLabelId(settingKey)];
            if (!labelComponent) {
                continue;
            }
            labelComponent.text = this.#getSettingLabelText(settingKey, labelKey);
        }
    }

    /**
     * 현재 임시 설정과 초기 설정의 차이를 판정합니다.
     * @returns {boolean} 하나라도 변경된 설정이 있으면 true를 반환합니다.
     */
    #hasSettingsChanges() {
        return Object.keys(this.initialSettings).some((settingKey) => this.tempSettings[settingKey] !== this.initialSettings[settingKey]);
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
     * 설정 항목 라벨의 UI 요소 id를 반환합니다.
     * @param {keyof typeof SETTING_LABEL_KEYS} settingKey - 설정 키입니다.
     * @returns {string} 라벨 UI 요소 id입니다.
     */
    #getSettingLabelId(settingKey) {
        return `setting_label_${settingKey}`;
    }

    /**
     * 설정 항목 라벨 텍스트를 변경 상태에 맞춰 반환합니다.
     * @param {keyof typeof SETTING_LABEL_KEYS} settingKey - 설정 키입니다.
     * @param {string} labelKey - 다국어 라벨 키입니다.
     * @returns {string} 표시할 라벨 텍스트입니다.
     */
    #getSettingLabelText(settingKey, labelKey) {
        const label = getLangString(labelKey);
        return this.tempSettings[settingKey] !== this.initialSettings[settingKey] ? `${label}*` : label;
    }

    /**
     * 초기 스냅샷 대비 실제로 변경된 설정만 추려 반환합니다.
     * @returns {object} 변경된 설정 키와 값입니다.
     */
    #getChangedSettings() {
        const changedSettings = {};

        for (const settingKey of Object.keys(this.initialSettings)) {
            if (this.tempSettings[settingKey] === this.initialSettings[settingKey]) {
                continue;
            }
            changedSettings[settingKey] = this.tempSettings[settingKey];
        }

        return changedSettings;
    }

    /**
     * 현재 저장된 워커 설정 기준으로 멀티코어 활성 여부를 반환합니다.
     * @returns {boolean}
     */
    #isMulticoreEnabled() {
        for (let i = 0; i < MULTICORE_SETTING_KEYS.length; i++) {
            if (getSetting(MULTICORE_SETTING_KEYS[i]) !== true) {
                return false;
            }
        }

        return true;
    }

    /**
     * 가상 설정 키를 실제 저장 키 묶음으로 확장합니다.
     * @param {object} changedSettings - UI에서 변경된 설정 객체입니다.
     * @returns {object} 저장/미리보기에 사용할 실제 설정 객체입니다.
     */
    #expandCompositeSettings(changedSettings = {}) {
        const expandedSettings = { ...changedSettings };
        if (expandedSettings.multicoreSupport === undefined) {
            return expandedSettings;
        }

        const enableMulticore = expandedSettings.multicoreSupport === true;
        delete expandedSettings.multicoreSupport;
        for (let i = 0; i < MULTICORE_SETTING_KEYS.length; i++) {
            expandedSettings[MULTICORE_SETTING_KEYS[i]] = enableMulticore;
        }

        return expandedSettings;
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
        Object.assign(this.pendingPreviewSettings, this.#expandCompositeSettings(changedSettings));

        if (!this.previewFlushPromise) {
            this.previewFlushPromise = Promise.resolve().then(async () => {
                const pending = this.pendingPreviewSettings;
                this.pendingPreviewSettings = {};

                if (Object.keys(pending).length > 0) {
                    previewSettingBatch(pending);
                    await this.#applyRuntimeSettings(pending);
                }

                this.previewFlushPromise = null;
                if (Object.keys(this.pendingPreviewSettings).length > 0) {
                    return this.#queuePreviewSettings({});
                }
            });
        }

        return this.previewFlushPromise;
    }

    /**
     * 대기 중인 미리보기 반영 작업을 모두 끝낼 때까지 기다립니다.
     * @returns {Promise<void>}
     */
    async #flushPendingPreview() {
        while (this.previewFlushPromise) {
            await this.previewFlushPromise;
        }

        if (Object.keys(this.pendingPreviewSettings).length > 0) {
            await this.#queuePreviewSettings({});
        }
    }

    /**
     * 현재 미리보기 상태를 초기 스냅샷으로 되돌린 뒤 overlay를 닫습니다.
     * @returns {Promise<void>}
     */
    async #cancelChanges() {
        await this.#flushPendingPreview();
        const revertedSettings = this.#expandCompositeSettings(this.#getRevertedSettings());
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
     * 현재 변경분을 초기 스냅샷 값으로 되돌리는 설정 객체를 반환합니다.
     * @returns {object} 복원할 설정 키와 값입니다.
     */
    #getRevertedSettings() {
        const revertedSettings = {};

        for (const settingKey of Object.keys(this.initialSettings)) {
            if (this.tempSettings[settingKey] === this.initialSettings[settingKey]) {
                continue;
            }
            revertedSettings[settingKey] = this.initialSettings[settingKey];
        }

        return revertedSettings;
    }

    _buildLeftColumn(handler) {
        const spacingScale = 0.9;
        const controlWrapWidth = 65;
        const controlMaxWidth = 66.66;
        const sliderValueFont = this._getTextPresetFont('SETTINGS_SLIDER_VALUE');

        // --- 디스플레이 섹션 ---
        this._addSectionHeader(handler, 'title_settings_section_display');
        handler.space("OH", 4 * spacingScale);

        // 창 모드
        this._addItemHeader(handler, 'title_settings_window_mode', 'windowMode');
        const windowModeItems = [
            { label: getLangString('title_settings_window_mode_windowed'), value: 'windowed' },
            { label: getLangString('title_settings_window_mode_fullscreen'), value: 'fullscreen' }
        ];
        handler.width("parent", controlWrapWidth).item("dropdown", "control_windowMode").width("parent", controlMaxWidth).height("WH", 3)
            .items(windowModeItems)
            .setValue(this.tempSettings.windowMode).stylePreset("h6_bold")
            .prop("openDirection", "down")
            .onChange((val) => { this.#handleSettingInput('windowMode', val); });
        this._addItemFooter(handler, null, spacingScale);

        // 와이드스크린 지원
        this._addItemHeader(handler, 'title_settings_widescreen_support', 'widescreenSupport');
        handler.width("parent", controlWrapWidth)
            .group().justifyContent("left", "WW", 0).width("parent", controlMaxWidth)
            .item("toggle", "control_widescreenSupport").width("WW", 2.55).height("WH", 2)
            .setValue(this.tempSettings.widescreenSupport)
            .onChange((val) => { this.#handleSettingInput('widescreenSupport', val); });
        handler.endGroup();
        this._addItemFooter(handler, 'title_settings_desc_widescreen_support', spacingScale);

        // 렌더 스케일
        this._addItemHeader(handler, 'title_settings_render_scale', 'renderScale');
        const rsSchema = getSettingSchema('renderScale');
        handler.width("parent", controlWrapWidth).item("slider", "control_renderScale").width("parent", controlMaxWidth)
            .prop("trackHeight", this.WH * 0.008 * this.uiScale).prop("knobRadius", this.WH * 0.009 * this.uiScale)
            .prop("min", rsSchema.min).prop("max", rsSchema.max).setValue(this.tempSettings.renderScale)
            .prop("valueSuffix", '%')
            .prop("valueOffsetX", this.UIWW * 0.015 * this.uiScale)
            .prop("valueFont", sliderValueFont)
            .prop("valueOffsetY", this.WH * 0.009 * this.uiScale)
            .prop("valueFormatter", (v) => `${v}% (${Math.round(getBaseWW() * v / 100)}×${Math.round(getBaseWH() * v / 100)})`)
            .onChange((val) => { this.#handleSettingInput('renderScale', val, { preview: false }); })
            .onCommit((val) => { this.#handleSettingInput('renderScale', val); });
        this._addItemFooter(handler, 'title_settings_desc_render_scale', spacingScale);

        // 인터페이스 스케일
        this._addItemHeader(handler, 'title_settings_ui_scale', 'uiScale');
        const usSchema = getSettingSchema('uiScale');
        handler.width("parent", controlWrapWidth).item("slider", "control_uiScale").width("parent", controlMaxWidth)
            .prop("trackHeight", this.WH * 0.008 * this.uiScale).prop("knobRadius", this.WH * 0.009 * this.uiScale)
            .prop("min", usSchema.min).prop("max", usSchema.max).setValue(this.tempSettings.uiScale)
            .prop("valueSuffix", '%')
            .prop("valueOffsetX", this.UIWW * 0.015 * this.uiScale)
            .prop("valueFont", sliderValueFont)
            .prop("valueOffsetY", this.WH * 0.009 * this.uiScale)
            .prop("valueFormatter", (v) => `${v}%`)
            .onChange((val) => { this.#handleSettingInput('uiScale', val, { preview: false }); })
            .onCommit((val) => { this.#handleSettingInput('uiScale', val); });
        this._addItemFooter(handler, 'title_settings_desc_ui_scale', spacingScale);

        // 투명도 비활성화
        this._addItemHeader(handler, 'title_settings_disable_transparency', 'disableTransparency');
        handler.width("parent", controlWrapWidth)
            .group().justifyContent("left", "WW", 0).width("parent", controlMaxWidth)
            .item("toggle", "control_disableTransparency").width("WW", 2.55).height("WH", 2)
            .setValue(this.tempSettings.disableTransparency)
            .onChange((val) => { this.#handleSettingInput('disableTransparency', val); });
        handler.endGroup();
        this._addItemFooter(handler, 'title_settings_desc_transparency', spacingScale);

        // 물리 연산 정확도
        this._addItemHeader(handler, 'title_settings_physics_accuracy', 'physicsAccuracy');
        const paSchema = getSettingSchema('physicsAccuracy');
        handler.width("parent", controlWrapWidth).item("slider", "control_physicsAccuracy").width("parent", controlMaxWidth)
            .prop("trackHeight", this.WH * 0.008 * this.uiScale).prop("knobRadius", this.WH * 0.009 * this.uiScale)
            .prop("min", paSchema.min).prop("max", paSchema.max).setValue(this.tempSettings.physicsAccuracy)
            .prop("valueOffsetX", this.UIWW * 0.015 * this.uiScale)
            .prop("valueFont", sliderValueFont)
            .prop("valueOffsetY", this.WH * 0.009 * this.uiScale)
            .onChange((val) => { this.#handleSettingInput('physicsAccuracy', val, { preview: false }); })
            .onCommit((val) => { this.#handleSettingInput('physicsAccuracy', val); })
            .prop("valueFormatter", (v) => {
                switch (v) {
                    case 2: return getLangString('title_settings_physics_accuracy_low');
                    case 3: return getLangString('title_settings_physics_accuracy_mid');
                    case 4: return getLangString('title_settings_physics_accuracy_high');
                }
            })
        this._addItemFooter(handler, 'title_settings_desc_physics_accuracy', spacingScale);

        // 멀티코어 지원
        this._addItemHeader(handler, 'title_settings_multicore_support', 'multicoreSupport');
        handler.width("parent", controlWrapWidth)
            .group().justifyContent("left", "WW", 0).width("parent", controlMaxWidth)
            .item("toggle", "control_multicoreSupport").width("WW", 2.55).height("WH", 2)
            .setValue(this.tempSettings.multicoreSupport)
            .onChange((val) => { this.#handleSettingInput('multicoreSupport', val); });
        handler.endGroup();
        this._addItemFooter(handler, 'title_settings_desc_multicore_support', spacingScale);

        handler.space("OH", 4 * spacingScale);
    }
    _buildRightColumn(handler) {
        const spacingScale = 0.9;
        const controlWrapWidth = 65;
        const controlMaxWidth = 66.66;
        const sliderValueFont = this._getTextPresetFont('SETTINGS_SLIDER_VALUE');

        // --- UI 섹션 ---
        this._addSectionHeader(handler, 'title_settings_section_ui');
        handler.space("OH", 4 * spacingScale);

        // 언어
        this._addItemHeader(handler, 'title_settings_language', 'language');
        handler.width("parent", controlWrapWidth).item("dropdown", "control_language").width("parent", controlMaxWidth).height("WH", 3)
            .items(this.availableLanguages.map((lang) => ({ label: lang.languageName, value: lang.key })))
            .setValue(this.tempSettings.language).stylePreset("h6_bold")
            .prop("openDirection", "down")
            .onChange((val) => { this.#handleSettingInput('language', val); });
        this._addItemFooter(handler, null, spacingScale);

        // 테마
        this._addItemHeader(handler, 'title_settings_theme', 'theme');
        const themeItems = THEME_OPTIONS.map((option) => ({
            label: getLangString(option.labelKey) || option.key,
            value: option.key
        }));
        handler.width("parent", controlWrapWidth).item("dropdown", "control_theme").width("parent", controlMaxWidth).height("WH", 3)
            .items(themeItems)
            .setValue(this.tempSettings.theme).stylePreset("h6_bold")
            .prop("openDirection", "down")
            .onChange((val) => { this.#handleSettingInput('theme', val); });
        this._addItemFooter(handler, null, spacingScale);

        // 툴팁 표시 시간
        this._addItemHeader(handler, 'title_settings_tooltip_delay', 'tooltipDelaySeconds');
        const tooltipDelaySchema = getSettingSchema('tooltipDelaySeconds');
        handler.width("parent", controlWrapWidth).item("slider", "control_tooltipDelaySeconds").width("parent", controlMaxWidth)
            .prop("trackHeight", this.WH * 0.008 * this.uiScale).prop("knobRadius", this.WH * 0.009 * this.uiScale)
            .prop("min", tooltipDelaySchema.min).prop("max", tooltipDelaySchema.max).prop("step", 0.1).setValue(this.tempSettings.tooltipDelaySeconds)
            .prop("valueOffsetX", this.UIWW * 0.015 * this.uiScale)
            .prop("valueFont", sliderValueFont)
            .prop("valueOffsetY", this.WH * 0.009 * this.uiScale)
            .prop("valueFormatter", (v) => this.#formatTooltipDelayValue(v))
            .onChange((val) => { this.#handleSettingInput('tooltipDelaySeconds', val, { preview: false }); })
            .onCommit((val) => { this.#handleSettingInput('tooltipDelaySeconds', val); });
        this._addItemFooter(handler, 'title_settings_desc_tooltip_delay', spacingScale);

        handler.space("OH", 4 * spacingScale);

        // --- 사운드 섹션 ---
        this._addSectionHeader(handler, 'title_settings_section_sound');
        handler.space("OH", 4 * spacingScale);

        // 배경음
        this._addItemHeader(handler, 'title_settings_bgm', 'bgmVolume');
        const bgmSchema = getSettingSchema('bgmVolume');
        handler.width("parent", controlWrapWidth).item("slider", "control_bgmVolume").width("parent", controlMaxWidth)
            .prop("trackHeight", this.WH * 0.008 * this.uiScale).prop("knobRadius", this.WH * 0.009 * this.uiScale)
            .prop("min", bgmSchema.min).prop("max", bgmSchema.max).setValue(this.tempSettings.bgmVolume)
            .prop("valueOffsetX", this.UIWW * 0.015 * this.uiScale)
            .prop("valueFont", sliderValueFont)
            .prop("valueOffsetY", this.WH * 0.009 * this.uiScale)
            .onChange((val) => { this.#handleSettingInput('bgmVolume', val, { preview: false }); })
            .onCommit((val) => { this.#handleSettingInput('bgmVolume', val); });
        this._addItemFooter(handler, null, spacingScale);

        // 효과음
        this._addItemHeader(handler, 'title_settings_sfx', 'sfxVolume');
        const sfxSchema = getSettingSchema('sfxVolume');
        handler.width("parent", controlWrapWidth).item("slider", "control_sfxVolume").width("parent", controlMaxWidth)
            .prop("trackHeight", this.WH * 0.008 * this.uiScale).prop("knobRadius", this.WH * 0.009 * this.uiScale)
            .prop("min", sfxSchema.min).prop("max", sfxSchema.max).setValue(this.tempSettings.sfxVolume)
            .prop("valueOffsetX", this.UIWW * 0.015 * this.uiScale)
            .prop("valueFont", sliderValueFont)
            .prop("valueOffsetY", this.WH * 0.009 * this.uiScale)
            .onChange((val) => { this.#handleSettingInput('sfxVolume', val, { preview: false }); })
            .onCommit((val) => { this.#handleSettingInput('sfxVolume', val); });
        this._addItemFooter(handler, null, spacingScale);

        handler.space("OH", 4 * spacingScale);

        // --- 조작 섹션 ---
        this._addSectionHeader(handler, 'title_settings_section_controls');
        handler.space("OH", 4 * spacingScale);

        // 키 설정
        this._addItemHeader(handler, 'title_settings_keybindings');
        handler.width("parent", controlWrapWidth)
            .group().justifyContent("left", "WW", 0).width("parent", controlMaxWidth)
            .item("button", "control_keybindings").stylePreset("overlay_link_button")
            .buttonText(getLangString('title_settings_keybindings_open'))
            .buttonColor(ColorSchemes.Overlay.Button.Link).icon("arrow")
            .onClick(() => { this.#openKeybindings(); });
        handler.endGroup();
        this._addItemFooter(handler, null, spacingScale);

        handler.space("OH", 4 * spacingScale);
    }
    _addSectionHeader(handler, labelKey) {
        handler.group().justifyContent("space-between", "WW", 1).width("parent", 100).align("center")
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
        const labelId = settingKey ? this.#getSettingLabelId(settingKey) : null;
        const labelText = settingKey ? this.#getSettingLabelText(settingKey, labelKey) : getLangString(labelKey);

        // 라벨 길이(언어별 차이)에 영향을 받지 않도록 라벨 영역을 고정 폭으로 분리
        handler.group().justifyContent("left", "WW", 0).width("parent", 94).align("center")
            .group().justifyContent("left", "WW", 0).width("parent", 35).vAlign("center")
            .item("text", labelId).text(labelText).stylePreset("h5_bold").fill(ColorSchemes.Overlay.Text.Item).vAlign("center")
            .endGroup()
            .spacer()
            .group().justifyContent("right", "WW", 1).vAlign("center");
    }
    _addItemFooter(handler, descriptionKey, spacingScale) {
        handler.endGroup().endGroup();
        if (descriptionKey) {
            handler.space("OH", 2.25);
            handler.group().justifyContent("left", "WW", 0).width("parent", 94).align("center")
                .item("text").text(getLangString(descriptionKey)).stylePreset("settings_desc").fill(ColorSchemes.Overlay.Text.Item).prop("alpha", 0.8)
                .endGroup()
                .space("OH", 4.5 * spacingScale);
        } else {
            handler.space("OH", 5 * spacingScale);
        }
    }
    _getTextPresetFont(presetKey) {
        const fallback = TEXT_CONSTANTS.H6;
        const preset = TEXT_CONSTANTS[presetKey] || fallback;
        const fontData = preset.FONT || fallback.FONT;
        const sizePx = this.positioningHandler.parseUIData(fontData.SIZE, this.uiScale);
        const weight = fontData.WEIGHT || 400;
        const family = this._normalizeFontFamily(fontData.FAMILY || 'Pretendard Variable, arial');
        return `${weight} ${sizePx}px ${family}`;
    }
    _normalizeFontFamily(fontFamily) {
        let familyStr = fontFamily;
        if (!familyStr.includes('"') && !familyStr.includes("'")) {
            const parts = familyStr.split(',');
            familyStr = `"${parts[0].trim()}"${parts[1] ? ',' + parts[1] : ''}`;
        }
        return familyStr;
    }

    /**
     * @private
     * 현재 언어 설정에 맞춰 툴팁 지연 시간을 포맷합니다.
     * @param {number} value - 표시할 지연 시간입니다.
     * @returns {string} 포맷된 표시 문자열입니다.
     */
    #formatTooltipDelayValue(value) {
        const normalizedValue = this.#normalizeTooltipDelaySeconds(value);
        const suffix = this.tempSettings.language === 'korean' ? '초' : 's';
        return `${normalizedValue.toFixed(1)}${suffix}`;
    }

    /**
     * @private
     * 툴팁 지연 시간을 0.1초 단위 값으로 정규화합니다.
     * @param {number} value - 정규화할 값입니다.
     * @returns {number} 0.1초 단위로 보정된 값입니다.
     */
    #normalizeTooltipDelaySeconds(value) {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return 0.7;
        }

        return Number(Math.max(0, Math.min(2, numericValue)).toFixed(1));
    }

    /**
         * 변경된 모든 임시 설정을 실제 세이브 데이터에 일괄 저장합니다.
         * @returns {Promise<object>} 실제로 변경되어 저장된 설정 키와 값입니다.
         */
    async save() {
        await this.#flushPendingPreview();
        const changedSettings = this.#getChangedSettings();
        if (Object.keys(changedSettings).length === 0) {
            this.settingsChanged = false;
            return changedSettings;
        }

        const persistedSettings = this.#expandCompositeSettings(changedSettings);
        await setSettingBatch({
            ...persistedSettings,
            screenModeChanged: false
        });

        this.initialSettings = { ...this.tempSettings };
        this.#refreshChangedLabels();
        return persistedSettings;
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
            const revertedSettings = this.#getRevertedSettings();
            if (Object.keys(revertedSettings).length === 0) {
                return;
            }

            previewSettingBatch(revertedSettings);
            await this.#applyRuntimeSettings(revertedSettings);
        })();
    }
}
