import { TitleOverlay } from './_title_overlay.js';
import { getLangString } from 'ui/ui_system.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { getBaseWW, getBaseWH } from 'display/display_system.js';
import { getSetting, setSettingBatch, getSettingSchema } from 'save/save_system.js';
import { LayoutHandler } from 'ui/_layout_handler.js';
import { getAvailableLanguages } from 'ui/lang/_language_handler.js';
import { isNwRuntime } from 'util/nw_bridge.js';

/**
 * @class SettingsOverlay
 * @description 타이틀 화면의 설정 오버레이를 구성하고 변경된 옵션을 저장합니다.
 */
export class SettingsOverlay extends TitleOverlay {
    constructor(TitleScene) {
        super(TitleScene);

        this._onResize();
        this._calculateGeometry();

        this.settingsChanged = false;
        this.isNwRuntime = isNwRuntime();

        this.tempSettings = {
            windowMode: getSetting('windowMode') || (this.isNwRuntime ? 'fullscreen' : 'browserMode'),
            renderScale: getSetting('renderScale') || 100,
            uiScale: getSetting('uiScale') || 100,
            disableTransparency: getSetting('disableTransparency') || false,
            physicsFps: getSetting('physicsFps') || 60,
            language: getSetting('language') || 'korean',
            darkMode: getSetting('darkMode') || false,
            bgmVolume: getSetting('bgmVolume') !== undefined ? getSetting('bgmVolume') : 100,
            sfxVolume: getSetting('sfxVolume') !== undefined ? getSetting('sfxVolume') : 100,
        };

        if (!this.isNwRuntime) {
            this.tempSettings.windowMode = 'browserMode';
        }

        this._generateLayout();
    }

    _onResize() {
        this.width = this.UIWW * 0.65;
        this.height = this.WH * 0.7;
    }

    _generateLayout() {
        this._releaseElements();
        const headerHandler = new LayoutHandler(this, this.positioningHandler)
            .layoutStartPos("OX", 0, "OY", 0)
            .layoutSize("OW", 100, "OH", 19)
            .horMargin("WW", 1.8)
            .item("margin").value("WH", 2.5)
            .item("text", "title_text").stylePreset("h1").text(getLangString('title_settings_title')).prop("fill", ColorSchemes.Title.TextDark)
            .item("margin").value("WH", 1.5)
            .item("line", "divider_line").width("parent", 100).prop("stroke", ColorSchemes.Overlay.Panel.Divider).prop("lineWidth", 1).align("center");

        const leftHandler = new LayoutHandler(this, this.positioningHandler)
            .layoutStartPos("OX", 3, "OY", 15)
            .layoutSize("OW", 44, "OH", 100)
            .horMargin("absolute", 0);

        this._buildLeftColumn(leftHandler);

        const rightHandler = new LayoutHandler(this, this.positioningHandler)
            .layoutStartPos("OX", 53, "OY", 15)
            .layoutSize("OW", 44, "OH", 100)
            .horMargin("absolute", 0);

        this._buildRightColumn(rightHandler);

        const footHandler = new LayoutHandler(this, this.positioningHandler)
            .layoutStartPos("OX", 0, "OY", 0)
            .layoutSize("OW", 100, "OH", 100)
            .horMargin("WW", 1.8);

        footHandler.bottomItem("margin").value("WH", 3)
            .bottomItemGroup().justifyContent("right", "WW", 1).align("right")
            .groupItem("button", "cancel_btn").stylePreset("overlay_interact_button")
            .buttonText(getLangString('title_settings_cancel')).onClick(this.close.bind(this))
            .buttonColor(ColorSchemes.Overlay.Button.Cancel).prop("iconType", "deny")
            .groupItem("button", "save_btn").stylePreset("overlay_interact_button")
            .buttonText(getLangString('title_settings_save')).onClick(async () => { if (this.settingsChanged) { await this.save(); location.reload(); } else { this.close.bind(this)(); } });

        if (getLangString("affirmative_icon") === "check") {
            footHandler.prop("iconType", "check").buttonColor(ColorSchemes.Overlay.Button.Confirm);
        } else {
            footHandler.prop("iconType", "confirm").buttonColor(ColorSchemes.Overlay.Button.Confirm);
        }

        footHandler.closeGroup();

        const resHead = headerHandler.build();
        const resLeft = leftHandler.build();
        const resRight = rightHandler.build();
        const resFoot = footHandler.build();

        this.staticItems = [
            ...Object.values(resHead.staticItems),
            ...Object.values(resLeft.staticItems),
            ...Object.values(resRight.staticItems),
            ...Object.values(resFoot.staticItems)
        ];

        this.dynamicItems = [
            ...Object.values(resHead.dynamicItems),
            ...Object.values(resLeft.dynamicItems),
            ...Object.values(resRight.dynamicItems),
            ...Object.values(resFoot.dynamicItems)
        ];
    }

    _buildLeftColumn(handler) {
        const spacingScale = 0.9;
        const controlWrapWidth = 65;
        const controlMaxWidth = 66.66;

        // --- 디스플레이 섹션 ---
        this._addSectionHeader(handler, 'title_settings_section_display');
        handler.item("margin").value("OH", 4 * spacingScale);

        // 창 모드
        this._addItemHeader(handler, 'title_settings_window_mode');
        const windowModeItems = this.isNwRuntime
            ? [
                { label: getLangString('title_settings_window_mode_windowed'), value: 'windowed' },
                { label: getLangString('title_settings_window_mode_borderless'), value: 'borderless' },
                { label: getLangString('title_settings_window_mode_fullscreen'), value: 'fullscreen' }
            ]
            : [
                { label: getLangString('title_settings_window_mode_browser'), value: 'browserMode' }
            ];
        handler.width("parent", controlWrapWidth).groupItem("dropdown", "control_windowMode").width("parent", controlMaxWidth).height("WH", 3)
            .prop("items", windowModeItems)
            .prop("value", this.tempSettings.windowMode).stylePreset("h6_bold")
            .prop("openDirection", "down")
            .prop("onChange", (val) => { this.tempSettings.windowMode = val; this.settingsChanged = true; });
        this._addItemFooter(handler, null, spacingScale);

        // 렌더 스케일
        this._addItemHeader(handler, 'title_settings_render_scale');
        const rsSchema = getSettingSchema('renderScale');
        handler.width("parent", controlWrapWidth).groupItem("slider", "control_renderScale").width("parent", controlMaxWidth)
            .prop("trackHeight", this.WH * 0.008 * this.uiScale).prop("knobRadius", this.WH * 0.009 * this.uiScale)
            .prop("min", rsSchema.min).prop("max", rsSchema.max).prop("value", this.tempSettings.renderScale)
            .prop("valueSuffix", '%')
            .prop("valueOffsetX", this.UIWW * 0.015 * this.uiScale)
            .prop("valueFont", `400 ${this.UIWW * 0.008 * this.uiScale}px "Pretendard Variable", arial`)
            .prop("valueOffsetY", this.WH * 0.009 * this.uiScale)
            .prop("valueFormatter", (v) => `${v}% (${Math.round(getBaseWW() * v / 100)}×${Math.round(getBaseWH() * v / 100)})`)
            .prop("onChange", (val) => { this.tempSettings.renderScale = val; this.settingsChanged = true; });
        this._addItemFooter(handler, 'title_settings_desc_render_scale', spacingScale);

        // 인터페이스 스케일
        this._addItemHeader(handler, 'title_settings_ui_scale');
        const usSchema = getSettingSchema('uiScale');
        handler.width("parent", controlWrapWidth).groupItem("slider", "control_uiScale").width("parent", controlMaxWidth)
            .prop("trackHeight", this.WH * 0.008 * this.uiScale).prop("knobRadius", this.WH * 0.009 * this.uiScale)
            .prop("min", usSchema.min).prop("max", usSchema.max).prop("value", this.tempSettings.uiScale)
            .prop("valueSuffix", '%')
            .prop("valueOffsetX", this.UIWW * 0.015 * this.uiScale)
            .prop("valueFont", `400 ${this.UIWW * 0.008 * this.uiScale}px "Pretendard Variable", arial`)
            .prop("valueOffsetY", this.WH * 0.009 * this.uiScale)
            .prop("valueFormatter", (v) => `${v}%`)
            .prop("onChange", (val) => { this.tempSettings.uiScale = val; this.settingsChanged = true; });
        this._addItemFooter(handler, 'title_settings_desc_ui_scale', spacingScale);

        // 투명도 비활성화
        this._addItemHeader(handler, 'title_settings_disable_transparency');
        handler.width("parent", controlWrapWidth)
            .groupItemGroup().justifyContent("left", "WW", 0).width("parent", controlMaxWidth)
            .groupItem("toggle", "control_disableTransparency").width("WW", 2.55).height("WH", 2)
            .prop("value", this.tempSettings.disableTransparency)
            .prop("onChange", (val) => { this.tempSettings.disableTransparency = val; this.settingsChanged = true; });
        handler.closeGroup();
        this._addItemFooter(handler, 'title_settings_desc_transparency', spacingScale);

        // 물리 연산 FPS
        this._addItemHeader(handler, 'title_settings_physics_fps');
        const pfSchema = getSettingSchema('physicsFps');
        handler.width("parent", controlWrapWidth).groupItem("slider", "control_physicsFps").width("parent", controlMaxWidth)
            .prop("trackHeight", this.WH * 0.008 * this.uiScale).prop("knobRadius", this.WH * 0.009 * this.uiScale)
            .prop("min", pfSchema.min).prop("max", pfSchema.max).prop("value", this.tempSettings.physicsFps)
            .prop("valueOffsetX", this.UIWW * 0.015 * this.uiScale)
            .prop("valueFont", `400 ${this.UIWW * 0.008 * this.uiScale}px "Pretendard Variable", arial`)
            .prop("valueOffsetY", this.WH * 0.009 * this.uiScale)
            .prop("valueFormatter", (v) => getLangString('title_settings_physics_fps_slider_front') + v + getLangString('title_settings_physics_fps_slider_back'))
            .prop("onChange", (val) => { this.tempSettings.physicsFps = val; this.settingsChanged = true; });
        this._addItemFooter(handler, 'title_settings_desc_physics_fps', spacingScale);

        handler.item("margin").value("OH", 4 * spacingScale);
    }

    _buildRightColumn(handler) {
        const spacingScale = 0.9;
        const controlWrapWidth = 65;
        const controlMaxWidth = 66.66;

        // --- UI 섹션 ---
        this._addSectionHeader(handler, 'title_settings_section_ui');
        handler.item("margin").value("OH", 4 * spacingScale);

        // 언어
        this._addItemHeader(handler, 'title_settings_language');
        handler.width("parent", controlWrapWidth).groupItem("dropdown", "control_language").width("parent", controlMaxWidth).height("WH", 3)
            .prop("items", getAvailableLanguages().map(lang => ({ label: getLangString(`title_settings_lang_${lang}`), value: lang })))
            .prop("value", this.tempSettings.language).stylePreset("h6_bold")
            .prop("openDirection", "down")
            .prop("onChange", (val) => { this.tempSettings.language = val; this.settingsChanged = true; });
        this._addItemFooter(handler, null, spacingScale);

        // 테마
        this._addItemHeader(handler, 'title_settings_theme');
        handler.width("parent", controlWrapWidth).groupItem("segment_control", "control_darkMode").width("parent", controlMaxWidth).height("WH", 3)
            .prop("items", [{ label: getLangString('title_settings_theme_light'), value: false }, { label: getLangString('title_settings_theme_dark'), value: true }])
            .prop("value", this.tempSettings.darkMode).stylePreset("h6_bold")
            .prop("onChange", (val) => { this.tempSettings.darkMode = val; this.settingsChanged = true; });
        this._addItemFooter(handler, null, spacingScale);

        handler.item("margin").value("OH", 4 * spacingScale);

        // --- 사운드 섹션 ---
        this._addSectionHeader(handler, 'title_settings_section_sound');
        handler.item("margin").value("OH", 4 * spacingScale);

        // 배경음
        this._addItemHeader(handler, 'title_settings_bgm');
        const bgmSchema = getSettingSchema('bgmVolume');
        handler.width("parent", controlWrapWidth).groupItem("slider", "control_bgmVolume").width("parent", controlMaxWidth)
            .prop("trackHeight", this.WH * 0.008 * this.uiScale).prop("knobRadius", this.WH * 0.009 * this.uiScale)
            .prop("min", bgmSchema.min).prop("max", bgmSchema.max).prop("value", this.tempSettings.bgmVolume)
            .prop("valueOffsetX", this.UIWW * 0.015 * this.uiScale)
            .prop("valueFont", `400 ${this.UIWW * 0.008 * this.uiScale}px "Pretendard Variable", arial`)
            .prop("valueOffsetY", this.WH * 0.009 * this.uiScale)
            .prop("onChange", (val) => { this.tempSettings.bgmVolume = val; this.settingsChanged = true; });
        this._addItemFooter(handler, null, spacingScale);

        // 효과음
        this._addItemHeader(handler, 'title_settings_sfx');
        const sfxSchema = getSettingSchema('sfxVolume');
        handler.width("parent", controlWrapWidth).groupItem("slider", "control_sfxVolume").width("parent", controlMaxWidth)
            .prop("trackHeight", this.WH * 0.008 * this.uiScale).prop("knobRadius", this.WH * 0.009 * this.uiScale)
            .prop("min", sfxSchema.min).prop("max", sfxSchema.max).prop("value", this.tempSettings.sfxVolume)
            .prop("valueOffsetX", this.UIWW * 0.015 * this.uiScale)
            .prop("valueFont", `400 ${this.UIWW * 0.008 * this.uiScale}px "Pretendard Variable", arial`)
            .prop("valueOffsetY", this.WH * 0.009 * this.uiScale)
            .prop("onChange", (val) => { this.tempSettings.sfxVolume = val; this.settingsChanged = true; });
        this._addItemFooter(handler, null, spacingScale);

        handler.item("margin").value("OH", 4 * spacingScale);

        // --- 조작 섹션 ---
        this._addSectionHeader(handler, 'title_settings_section_controls');
        handler.item("margin").value("OH", 4 * spacingScale);

        // 키 설정
        this._addItemHeader(handler, 'title_settings_keybindings');
        handler.width("parent", controlWrapWidth)
            .groupItemGroup().justifyContent("left", "WW", 0).width("parent", controlMaxWidth)
            .groupItem("button", "control_keybindings").stylePreset("overlay_link_button")
            .buttonText(getLangString('title_settings_keybindings_open'))
            .buttonColor(ColorSchemes.Overlay.Button.Link).prop("iconType", "arrow")
            .onClick(() => { this._openKeybindings(); });
        handler.closeGroup();
        this._addItemFooter(handler, null, spacingScale);

        handler.item("margin").value("OH", 4 * spacingScale);
    }

    _addSectionHeader(handler, labelKey) {
        handler.newItemGroup().justifyContent("space_between", "WW", 1).width("parent", 100).align("center")
            .groupItem("text").text(getLangString(labelKey)).stylePreset("h3").prop("fill", ColorSchemes.Overlay.Text.Section).vAlign("center")
            .groupItem("line").width("auto").prop("stroke", ColorSchemes.Overlay.Panel.Divider).prop("lineWidth", 1).vAlign("center")
            .closeGroup();
    }

    _addItemHeader(handler, labelKey) {
        // 라벨 길이(언어별 차이)에 영향을 받지 않도록 라벨 영역을 고정 폭으로 분리
        handler.newItemGroup().justifyContent("left", "WW", 0).width("parent", 94).align("center")
            .groupItemGroup().justifyContent("left", "WW", 0).width("parent", 35).vAlign("center")
            .groupItem("text").text(getLangString(labelKey)).stylePreset("h5 bold").prop("fill", ColorSchemes.Overlay.Text.Item).vAlign("center")
            .closeGroup()
            .groupItem("horMargin").value("expand")
            .groupItemGroup().justifyContent("right", "WW", 1).vAlign("center");
    }

    _addItemFooter(handler, descriptionKey, spacingScale) {
        handler.closeGroup().closeGroup();
        if (descriptionKey) {
            handler.item("margin").value("OH", 2.25);
            handler.newItemGroup().justifyContent("left", "WW", 0).width("parent", 94).align("center")
                .groupItem("text").text(getLangString(descriptionKey)).stylePreset("h6").prop("fill", ColorSchemes.Overlay.Text.Item).prop("alpha", 0.8)
                .closeGroup()
                .item("margin").value("OH", 4.5 * spacingScale);
        } else {
            handler.item("margin").value("OH", 5 * spacingScale);
        }
    }

    async save() {
        const currentWindowMode = getSetting('windowMode') || (this.isNwRuntime ? 'fullscreen' : 'browserMode');
        const modeChanged = currentWindowMode !== this.tempSettings.windowMode;

        await setSettingBatch({
            windowMode: this.tempSettings.windowMode,
            renderScale: this.tempSettings.renderScale,
            uiScale: this.tempSettings.uiScale,
            disableTransparency: this.tempSettings.disableTransparency,
            physicsFps: this.tempSettings.physicsFps,
            language: this.tempSettings.language,
            darkMode: this.tempSettings.darkMode,
            bgmVolume: this.tempSettings.bgmVolume,
            sfxVolume: this.tempSettings.sfxVolume,
            screenModeChanged: this.isNwRuntime ? modeChanged : false
        });
    }
}
