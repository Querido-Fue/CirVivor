import { TitleOverlay } from './title_overlay.js';
import { getLangString } from 'ui/_ui_system.js';
import { ColorSchemes } from 'display/theme_handler.js';
import { getBaseWW, getBaseWH } from 'display/_display_system.js';
import { getSetting, setSettingBatch } from 'save/_save_system.js';
import { LayoutHandler } from 'ui/layout_handler.js';

// TODO: 설정 레이아웃 전면적인 수정

export class SettingsOverlay extends TitleOverlay {
    constructor(TitleScene) {
        super(TitleScene);

        this.width = this.WW * 0.65;
        this.height = this.WH * 0.7;
        this._calculateGeometry();

        this.settingsChanged = false;

        this.tempSettings = {
            windowMode: getSetting('windowMode') || 'fullscreen',
            renderScale: getSetting('renderScale') || 100,
            uiScale: getSetting('uiScale') || 100,
            disableTransparency: getSetting('disableTransparency') || false,
            physicsFps: getSetting('physicsFps') || 60,
            language: getSetting('language') || 'korean',
            darkMode: getSetting('darkMode') || false,
            bgmVolume: getSetting('bgmVolume') !== undefined ? getSetting('bgmVolume') : 100,
            sfxVolume: getSetting('sfxVolume') !== undefined ? getSetting('sfxVolume') : 100,
        };

        this.sections = [
            {
                key: 'display', label: 'title_settings_section_display', items: [
                    {
                        type: 'segment', label: 'title_settings_window_mode', settingKey: 'windowMode', options: [
                            { value: 'windowed', label: 'title_settings_window_mode_windowed' },
                            { value: 'borderless', label: 'title_settings_window_mode_borderless' },
                            { value: 'fullscreen', label: 'title_settings_window_mode_fullscreen' }
                        ]
                    },
                    {
                        type: 'slider', label: 'title_settings_render_scale', settingKey: 'renderScale', min: 75, max: 100, suffix: '%', description: 'title_settings_desc_render_scale',
                        valueFormatter: (v) => `${v}% (${Math.round(getBaseWW() * v / 100)}×${Math.round(getBaseWH() * v / 100)})`
                    },
                    {
                        type: 'slider', label: 'title_settings_ui_scale', settingKey: 'uiScale', min: 75, max: 125, suffix: '%', description: 'title_settings_desc_ui_scale',
                        valueFormatter: (v) => `${v}%`
                    },
                    { type: 'toggle', label: 'title_settings_disable_transparency', settingKey: 'disableTransparency', description: 'title_settings_desc_transparency' },
                    {
                        type: 'slider', label: 'title_settings_physics_fps', settingKey: 'physicsFps', min: 30, max: 120, description: 'title_settings_desc_physics_fps',
                        prefix: 'title_settings_physics_fps_slider_front', suffix: 'title_settings_physics_fps_slider_back'
                    }
                ]
            },
            {
                key: 'ui', label: 'title_settings_section_ui', items: [
                    { type: 'segment', label: 'title_settings_language', settingKey: 'language', options: [{ value: 'korean', label: 'title_settings_lang_ko' }, { value: 'english', label: 'title_settings_lang_en' }] },
                    { type: 'segment', label: 'title_settings_theme', settingKey: 'darkMode', options: [{ value: false, label: 'title_settings_theme_light' }, { value: true, label: 'title_settings_theme_dark' }] }
                ]
            },
            {
                key: 'sound', label: 'title_settings_section_sound', items: [
                    { type: 'slider', label: 'title_settings_bgm', settingKey: 'bgmVolume', min: 0, max: 100 },
                    { type: 'slider', label: 'title_settings_sfx', settingKey: 'sfxVolume', min: 0, max: 100 }
                ]
            },
            {
                key: 'controls', label: 'title_settings_section_controls', items: [
                    { type: 'button', label: 'title_settings_keybindings', buttonLabel: 'title_settings_keybindings_open', onClick: () => { this._openKeybindings(); } }
                ]
            }
        ];

        this._generateLayout();
        this.open();
    }

    _generateLayout() {
        const globalHorMarginPercent = 4;
        const innerPaddingPercent = 4;

        const headerHandler = new LayoutHandler(this)
            .layoutStartPos("OX", 0, "OY", 0)
            .layoutSize("OW", 100, "OH", 19)
            .horMargin("WW", 1.8)
            .item("margin").value("WH", 2.5)
            .item("text", "title_text").stylePreset("h1").text(getLangString('title_settings_title')).prop("fill", ColorSchemes.Title.TextDark)
            .item("margin").value("WH", 1.5)
            .item("line", "divider_line").width("parent", 100).prop("stroke", ColorSchemes.Overlay.Panel.Divider).prop("lineWidth", 1).align("center");

        const availableWPercent = 100 - (globalHorMarginPercent * 2);
        const colWPercent = (availableWPercent - innerPaddingPercent) / 2;
        const leftStartX = globalHorMarginPercent;
        const rightStartX = globalHorMarginPercent + colWPercent + innerPaddingPercent;
        const colStartY = 15;
        const colHeightY = 70;

        const leftHandler = new LayoutHandler(this)
            .layoutStartPos("OX", leftStartX, "OY", colStartY)
            .layoutSize("OW", colWPercent, "OH", colHeightY)
            .horMargin("absolute", 0);

        const leftSections = this.sections.filter(s => ['display'].includes(s.key));
        this._buildCol(leftHandler, leftSections, 1.65);

        const rightHandler = new LayoutHandler(this)
            .layoutStartPos("OX", rightStartX, "OY", colStartY)
            .layoutSize("OW", colWPercent, "OH", colHeightY)
            .horMargin("absolute", 0);

        const rightSections = this.sections.filter(s => !['display'].includes(s.key));
        this._buildCol(rightHandler, rightSections, 0.9);

        const footHandler = new LayoutHandler(this)
            .layoutStartPos("OX", 0, "OY", 0)
            .layoutSize("OW", 100, "OH", 100)
            .horMargin("WW", 1.8);

        footHandler.bottomItem("margin").value("WH", 2.5)
            .bottomItemGroup().justifyContent("right", "WW", 1).align("right")

            .groupItem("button", "cancel_btn").stylePreset("overlay_interact_button")
            .buttonText(getLangString('title_settings_cancel')).onClick(this.close.bind(this))
            .buttonColor(ColorSchemes.Overlay.Button.Cancel).prop("iconType", "deny")

            .groupItem("button", "save_btn").stylePreset("overlay_interact_button")
            .buttonText(getLangString('title_settings_save')).onClick(async () => { if (this.settingsChanged) { await this.save(); location.reload(); } else { this.close.bind(this)(); } });

        if (getLangString("affirmative_icon") === "check") {
            footHandler.prop("iconType", "check").buttonColor(ColorSchemes.Overlay.Button.Confirm)
        } else {
            footHandler.prop("iconType", "confirm").buttonColor(ColorSchemes.Overlay.Button.Confirm)
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

    _buildCol(handler, sections, spacingScale = 1) {
        for (const section of sections) {
            handler.newItemGroup().justifyContent("space_between", "WW", 1).width("parent", 100).align("center")
                .groupItem("text").text(getLangString(section.label)).stylePreset("h3").prop("fill", ColorSchemes.Overlay.Text.Section).vAlign("center")
                .groupItem("line").width("auto").prop("stroke", ColorSchemes.Overlay.Panel.Divider).prop("lineWidth", 1).vAlign("center")
                .closeGroup()
                .item("margin").value("OH", 4 * spacingScale);

            for (const item of section.items) {
                handler.newItemGroup().justifyContent("space_between", "WW", 1).width("parent", 95).align("center")
                    .groupItem("text").text(getLangString(item.label)).stylePreset("h5").prop("fill", ColorSchemes.Overlay.Text.Item).vAlign("center")
                    .groupItem("horMargin").value("expand")
                    .groupItemGroup().justifyContent("left", "WW", 1).vAlign("center");

                const controlKey = `control_${item.settingKey}`;
                if (item.type === 'toggle') {
                    handler.width("parent", 57).groupItem("toggle", controlKey).width("WW", 2.55).height("WH", 2)
                        .prop("value", this.tempSettings[item.settingKey])
                        .prop("onChange", (val) => { this.tempSettings[item.settingKey] = val; this.settingsChanged = true; });
                } else if (item.type === 'slider') {
                    handler.width("parent", 57).groupItem("slider", controlKey).width("parent", 99)
                        .prop("trackHeight", this.WH * 0.008 * this.uiScale).prop("knobRadius", this.WH * 0.009 * this.uiScale)
                        .prop("min", item.min).prop("max", item.max).prop("value", this.tempSettings[item.settingKey])
                        .prop("valuePrefix", item.prefix ? getLangString(item.prefix) : '')
                        .prop("valueSuffix", item.suffix ? getLangString(item.suffix) : '')
                        .prop("valueOffsetX", this.WW * 0.015 * this.uiScale)
                        .prop("valueFont", `400 ${this.WW * 0.008 * this.uiScale}px "Pretendard Variable", arial`)
                        .prop("valueOffsetY", this.WH * 0.009 * this.uiScale) // 값 텍스트 고려 약간 낮추기
                        .prop("valueFormatter", item.valueFormatter || null)
                        .prop("onChange", (val) => { this.tempSettings[item.settingKey] = val; this.settingsChanged = true; });
                } else if (item.type === 'segment') {
                    const segWidthPercent = item.options.length * 33.33;
                    handler.width("parent", 58).groupItem("segment_control", controlKey).width("parent", segWidthPercent).height("WH", 3)
                        .prop("items", item.options.map(opt => ({ label: getLangString(opt.label), value: opt.value })))
                        .prop("value", this.tempSettings[item.settingKey]).stylePreset("h6_bold")
                        .prop("onChange", (val) => { this.tempSettings[item.settingKey] = val; this.settingsChanged = true; });
                } else if (item.type === 'button') {
                    handler.width("parent", 57).groupItem("button", controlKey).stylePreset("overlay_link_button")
                        .buttonText(getLangString(item.buttonLabel))
                        .buttonColor(ColorSchemes.Overlay.Button.Link).prop("iconType", "arrow")
                        .onClick(item.onClick);
                }

                handler.closeGroup().closeGroup();

                if (item.description) {
                    handler.item("margin").value("OH", 2);
                    handler.newItemGroup().justifyContent("left", "WW", 0).width("parent", 95).align("center")
                        .groupItem("text").text(getLangString(item.description)).stylePreset("h6").prop("fill", ColorSchemes.Overlay.Text.Item).prop("alpha", 0.8)
                        .closeGroup()
                        .item("margin").value("OH", 3 * spacingScale);
                } else {
                    handler.item("margin").value("OH", 5.5 * spacingScale);
                }
            }
            handler.item("margin").value("OH", 4 * spacingScale);
        }
    }

    async save() {
        const currentWindowMode = getSetting('windowMode') || 'fullscreen';
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
            screenModeChanged: modeChanged
        });
    }
}
