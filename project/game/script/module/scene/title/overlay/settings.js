import { TitleOverlay } from './title_overlay.js';
import { ButtonElement } from 'ui/element/button.js';
import { SliderElement } from 'ui/element/slider.js';
import { ToggleElement } from 'ui/element/toggle.js';
import { SegmentControl } from 'ui/element/segment_control.js';
import { getLangString } from 'ui/_ui_system.js';
import { ColorSchemes } from 'display/theme_handler.js';
import { render, measureText, getBaseWW, getBaseWH } from 'display/_display_system.js';
import { getSetting, setSettingBatch } from 'save/_save_system.js';

export class SettingsOverlay extends TitleOverlay {
    constructor(TitleScene) {
        super(TitleScene, '');

        this.settingsTitle = getLangString('title_settings_title');

        this.width = this.WW * 0.65;
        this.height = this.WH * 0.7;
        this.x = (this.WW - this.width) / 2;
        this.y = (this.WH - this.height) / 2;
        this.settingsChanged = false;

        if (this.closeButton) {
            this.closeButton.destroy();
            this.closeButton = null;
        }

        // 임시 설정값 (저장 전까지 변경사항을 보관)
        this.tempSettings = {
            fullScreen: getSetting('fullScreen') || false,
            renderScale: getSetting('renderScale') || 100,
            language: getSetting('language') || 'korean',
            darkMode: getSetting('darkMode') || false,
            bgmVolume: getSetting('bgmVolume') !== undefined ? getSetting('bgmVolume') : 100,
            sfxVolume: getSetting('sfxVolume') !== undefined ? getSetting('sfxVolume') : 100,
            disableTransparency: getSetting('disableTransparency') || false,
            reducePhysics: getSetting('reducePhysics') || false,
            colorBlindMode: getSetting('colorBlindMode') || false,
            autoAttack: getSetting('autoAttack') || false,
            uiScale: getSetting('uiScale') || 100
        };

        // 왼쪽 열 섹션
        // 모든 설정 섹션 정의
        this.sections = [
            {
                key: 'accessibility', label: 'title_settings_section_accessibility', items: [
                    { type: 'toggle', label: 'title_settings_color_blind', settingKey: 'colorBlindMode' },
                    {
                        type: 'slider', label: 'title_settings_ui_scale', settingKey: 'uiScale', min: 75, max: 125, suffix: '%', description: 'title_settings_desc_ui_scale',
                        valueFormatter: (v) => `${v}%`
                    }
                ]
            },
            {
                key: 'display', label: 'title_settings_section_display', items: [
                    { type: 'toggle', label: 'title_settings_fullScreen', settingKey: 'fullScreen' },
                    {
                        type: 'slider', label: 'title_settings_render_scale', settingKey: 'renderScale', min: 75, max: 100, suffix: '%', description: 'title_settings_desc_render_scale',
                        valueFormatter: (v) => `${v}% (${Math.round(getBaseWW() * v / 100)}×${Math.round(getBaseWH() * v / 100)})`
                    },
                    { type: 'toggle', label: 'title_settings_disable_transparency', settingKey: 'disableTransparency', description: 'title_settings_desc_transparency' },
                    { type: 'toggle', label: 'title_settings_reduce_physics', settingKey: 'reducePhysics', description: 'title_settings_desc_physics' }
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

        // 설정 요소 초기화
        for (const sec of this.sections) {
            for (const item of sec.items) {
                if (item.type === 'toggle') {
                    item.toggleElement = new ToggleElement({
                        parent: this,
                        layer: 'overlay',
                        value: this.tempSettings[item.settingKey],
                        onChange: (val) => {
                            this.tempSettings[item.settingKey] = val;
                            this.settingsChanged = true;
                        }
                    });
                } else if (item.type === 'slider') {
                    item.sliderElement = new SliderElement({
                        parent: this,
                        layer: 'overlay',
                        x: 0,
                        y: 0,
                        width: 100,
                        height: this.WH * 0.04,
                        trackHeight: this.WH * 0.008,
                        knobRadius: this.WH * 0.009,
                        min: item.min,
                        max: item.max,
                        value: this.tempSettings[item.settingKey],
                        valueSuffix: item.suffix || '',
                        valueOffsetX: this.WW * 0.015,
                        valueFont: `400 ${this.WW * 0.008}px "Pretendard Variable", arial`,
                        valueFormatter: item.valueFormatter || null,
                        onChange: (val) => { this.tempSettings[item.settingKey] = val; this.settingsChanged = true; }
                    });
                } else if (item.type === 'segment') {
                    item.segmentControl = new SegmentControl({
                        parent: this,
                        layer: 'overlay',
                        x: 0, y: 0, width: 0, height: 0, // _drawSegments에서 설정됨
                        items: item.options.map(opt => ({ label: getLangString(opt.label), value: opt.value })),
                        value: this.tempSettings[item.settingKey],
                        onChange: (val) => {
                            this.tempSettings[item.settingKey] = val;
                            this.settingsChanged = true;
                        }
                    });
                } else if (item.type === 'button') {
                    item.buttonElement = new ButtonElement({
                        parent: this,
                        layer: 'overlay',
                        x: 0, y: 0,
                        width: this.WW * 0.06,
                        height: this.WH * 0.03,
                        text: getLangString(item.buttonLabel),
                        font: 'Pretendard Variable, arial',
                        fontWeight: 500,
                        size: this.WW * 0.008,
                        align: 'right',
                        margin: this.WW * 0.06 * 0.1,
                        color: ColorSchemes.Overlay.Text.Item,
                        idleColor: ColorSchemes.Overlay.Control.Inactive,
                        hoverColor: ColorSchemes.Overlay.Control.Hover,
                        enableHoverGradient: false,
                        radius: 6,
                        iconType: 'arrow',
                        onClick: item.onClick
                    });
                }
            }
        }

        // 버튼
        const btnWidth = this.WW * 0.08;
        const btnHeight = this.WH * 0.04;
        const gap = this.WW * 0.015;
        const rightAnchor = this.x + this.width - this.WW * 0.02;

        this.saveBtnCustom = new ButtonElement({
            parent: this,
            onClick: async () => { if (this.settingsChanged) { await this.save(); location.reload(); } else { this.close.bind(this)(); } },
            layer: "overlay",
            x: rightAnchor - btnWidth,
            y: this.y + this.height - btnHeight - this.WH * 0.03,
            width: btnWidth,
            height: btnHeight,
            text: getLangString('title_settings_save'),
            font: "Pretendard Variable, arial",
            fontWeight: 700,
            size: this.WW * 0.01,
            align: 'right',
            margin: btnWidth * 0.12,
            color: ColorSchemes.Overlay.Button.Confirm.Text,
            idleColor: ColorSchemes.Overlay.Button.Confirm.Idle,
            hoverColor: ColorSchemes.Overlay.Button.Confirm.Hover,
            enableHoverGradient: false,
            radius: 8,
            iconType: 'confirm'
        });

        this.cancelBtnCustom = new ButtonElement({
            parent: this,
            onClick: this.close.bind(this),
            layer: "overlay",
            x: rightAnchor - btnWidth * 2 - gap,
            y: this.y + this.height - btnHeight - this.WH * 0.03,
            width: btnWidth,
            height: btnHeight,
            text: getLangString('title_settings_cancel'),
            font: "Pretendard Variable, arial",
            fontWeight: 700,
            size: this.WW * 0.01,
            align: 'right',
            margin: btnWidth * 0.12,
            color: ColorSchemes.Overlay.Button.Cancel.Text,
            idleColor: ColorSchemes.Overlay.Button.Cancel.Idle,
            hoverColor: ColorSchemes.Overlay.Button.Cancel.Hover,
            enableHoverGradient: false,
            radius: 8,
            iconType: 'deny'
        });
    }

    _drawSlider(x, y, w, item) {
        const s = item.sliderElement;
        if (!s) return;

        const sliderW = w * 0.7;
        s.x = x;
        s.y = y; // SliderElement는 y를 중심으로 처리하므로 y를 그대로 사용
        s.width = sliderW;
        s.trackHeight = this.WH * 0.008 * this.scale;
        s.knobRadius = this.WH * 0.009 * this.scale;
        s.valueOffsetX = this.WW * 0.015 * this.scale;
        s.valueFont = `400 ${this.WW * 0.008 * this.scale}px "Pretendard Variable", arial`;
        s.alpha = this.alpha;
        s.value = this.tempSettings[item.settingKey]; // 값 동기화
        s.draw();
    }

    _drawOptions(x, y, w, item) {
        const currentValue = this.tempSettings[item.settingKey];
        const btnW = w * 0.48;
        const btnH = this.WH * 0.03 * this.scale;

        const rightBtnX = x + w - btnW;
        const leftBtnX = rightBtnX - btnW - (w * 0.04);

        if (item.options && item.options.length >= 2) {
            const opt1 = item.options[0];
            const btn1 = item.elementRef[0];
            const isSel1 = currentValue === opt1.value;

            btn1.x = leftBtnX;
            btn1.y = y - btnH / 2;
            btn1.width = btnW;
            btn1.height = btnH;
            btn1.alpha = this.alpha;

            btn1.idleColor = isSel1 ? ColorSchemes.Overlay.Button.Option.Active : ColorSchemes.Overlay.Control.Inactive;
            btn1.hoverColor = isSel1 ? ColorSchemes.Overlay.Button.Option.Active : ColorSchemes.Overlay.Control.Inactive;

            btn1.color = isSel1 ? ColorSchemes.Overlay.Button.Option.ActiveText : ColorSchemes.Overlay.Text.Item;
            btn1.draw();

            const opt2 = item.options[1];
            const btn2 = item.elementRef[1];
            const isSel2 = currentValue === opt2.value;

            btn2.x = rightBtnX;
            btn2.y = y - btnH / 2;
            btn2.width = btnW;
            btn2.height = btnH;
            btn2.alpha = this.alpha;

            btn2.idleColor = isSel2 ? ColorSchemes.Overlay.Button.Option.Active : ColorSchemes.Overlay.Control.Inactive;
            btn2.hoverColor = isSel2 ? ColorSchemes.Overlay.Button.Option.Active : ColorSchemes.Overlay.Control.Inactive;

            btn2.color = isSel2 ? ColorSchemes.Overlay.Button.Option.ActiveText : ColorSchemes.Overlay.Text.Item;
            btn2.draw();
        }
    }

    async save() {
        // 콜백을 통해 tempSettings의 값이 이미 업데이트됨
        await setSettingBatch({
            fullScreen: this.tempSettings.fullScreen,
            renderScale: this.tempSettings.renderScale,
            language: this.tempSettings.language,
            darkMode: this.tempSettings.darkMode,
            bgmVolume: this.tempSettings.bgmVolume,
            sfxVolume: this.tempSettings.sfxVolume,
            disableTransparency: this.tempSettings.disableTransparency,
            reducePhysics: this.tempSettings.reducePhysics,
            colorBlindMode: this.tempSettings.colorBlindMode,
            autoAttack: this.tempSettings.autoAttack,
            uiScale: this.tempSettings.uiScale
        });
    }

    update() {
        super.update();
        if (this.visible && this.alpha > 0) {
            this.saveBtnCustom.update();
            this.cancelBtnCustom.update();

            for (const sec of this.sections) {
                for (const item of sec.items) {
                    if (item.type === 'toggle' && item.toggleElement) {
                        item.toggleElement.update();
                    } else if (item.type === 'slider' && item.sliderElement) {
                        item.sliderElement.update();
                    } else if (item.type === 'segment' && item.segmentControl) {
                        item.segmentControl.update();
                    } else if (item.type === 'option' && item.elementRef) {
                        for (const btn of item.elementRef) {
                            btn.update();
                        }
                    }
                }
            }
        }
    }

    draw() {
        if (!this.visible || this.alpha <= 0.01) return;

        super.draw();

        const scaledW = this.width * this.scale;
        const scaledH = this.height * this.scale;
        const cx = this.WW / 2;
        const cy = this.WH / 2;
        const scaledX = cx - scaledW / 2;
        const scaledY = cy - scaledH / 2;

        if (this.alpha > 0) {
            // 레이아웃 상수 정의
            const outerPadding = scaledW * 0.045; // 전체 외곽 여백
            const innerPadding = scaledW * 0.025; // 내부 구성 요소 간 여백

            // 헤더 영역
            const headerY = scaledY + scaledH * 0.08;
            const titleX = scaledX + outerPadding;

            // 제목 렌더링
            render('overlay', {
                shape: 'text',
                text: this.settingsTitle,
                x: titleX,
                y: headerY,
                font: `700 ${this.WW * 0.018 * this.scale}px "Pretendard Variable", arial`,
                fill: ColorSchemes.Title.TextDark,
                align: 'left',
                baseline: 'middle',
                alpha: this.alpha
            });

            // 구분선 렌더링
            const lineY = scaledY + scaledH * 0.13;
            render('overlay', {
                shape: 'line',
                x1: scaledX + outerPadding,
                y1: lineY,
                x2: scaledX + scaledW - outerPadding,
                y2: lineY,
                stroke: ColorSchemes.Overlay.Panel.Divider,
                lineWidth: 1,
                alpha: this.alpha
            });

            // 본문 영역 (2단 컬럼)
            const contentStartX = scaledX + outerPadding;
            const contentWidth = scaledW - (outerPadding * 2);
            const colWidth = (contentWidth - innerPadding) / 2;

            const col1X = contentStartX;
            const col2X = contentStartX + colWidth + innerPadding;

            const contentStartY = scaledY + scaledH * 0.19;

            // 좌측 컬럼 (접근성, 디스플레이)
            const leftSections = this.sections.filter(s => ['accessibility', 'display'].includes(s.key));
            this._drawSections(leftSections, col1X, colWidth, contentStartY, scaledH);

            // 우측 컬럼 (UI, 사운드, 조작)
            const rightSections = this.sections.filter(s => !['accessibility', 'display'].includes(s.key));
            this._drawSections(rightSections, col2X, colWidth, contentStartY, scaledH);


            // 하단 버튼 영역
            const btnWidth = this.WW * 0.08 * this.scale;
            const btnHeight = this.WH * 0.04 * this.scale;
            const btnGap = this.width * 0.02 * this.scale;

            const saveBtnX = scaledX + scaledW - outerPadding - btnWidth;
            const cancelBtnX = saveBtnX - btnWidth - btnGap;
            const btnY = scaledY + scaledH - btnHeight - (this.WH * 0.03 * this.scale);

            // 저장 버튼
            this.saveBtnCustom.width = btnWidth;
            this.saveBtnCustom.height = btnHeight;
            this.saveBtnCustom.x = saveBtnX;
            this.saveBtnCustom.y = btnY;
            this.saveBtnCustom.size = this.WW * 0.01 * this.scale;
            this.saveBtnCustom.alpha = this.alpha;
            this.saveBtnCustom.radius = 8 * this.scale;
            this.saveBtnCustom.draw();

            // 취소 버튼
            this.cancelBtnCustom.width = btnWidth;
            this.cancelBtnCustom.height = btnHeight;
            this.cancelBtnCustom.x = cancelBtnX;
            this.cancelBtnCustom.y = btnY;
            this.cancelBtnCustom.size = this.WW * 0.01 * this.scale;
            this.cancelBtnCustom.alpha = this.alpha;
            this.cancelBtnCustom.radius = 8 * this.scale;
            this.cancelBtnCustom.draw();
        }
    }

    _drawSections(sections, startX, columnWidth, startY, scaledH) {
        let cursorY = startY;
        const sectionGap = scaledH * 0.04;
        const itemGap = scaledH * 0.07;
        const labelSize = this.WW * 0.013 * this.scale;
        const itemLabelSize = this.WW * 0.01 * this.scale;

        for (const section of sections) {
            const sectionTitle = getLangString(section.label);
            const font = `600 ${labelSize}px "Pretendard Variable", arial`;

            render('overlay', {
                shape: 'text',
                text: sectionTitle,
                x: startX,
                y: cursorY,
                font: font,
                fill: ColorSchemes.Overlay.Text.Section,
                align: 'left',
                baseline: 'middle',
                alpha: this.alpha
            });

            // 구분선 (텍스트 우측)
            const textWidth = measureText(sectionTitle, font);
            const lineStartX = startX + textWidth + (columnWidth * 0.05);
            const lineEndX = startX + columnWidth;

            if (lineEndX > lineStartX) {
                render('overlay', {
                    shape: 'line',
                    x1: lineStartX,
                    y1: cursorY,
                    x2: lineEndX,
                    y2: cursorY,
                    stroke: ColorSchemes.Overlay.Panel.Divider,
                    lineWidth: 1 * this.scale,
                    alpha: this.alpha * 0.5
                });
            }

            cursorY += itemGap;

            for (const item of section.items) {
                render('overlay', {
                    shape: 'text',
                    text: getLangString(item.label),
                    x: startX + columnWidth * 0.02,
                    y: cursorY,
                    font: `400 ${itemLabelSize}px "Pretendard Variable", arial`,
                    fill: ColorSchemes.Overlay.Text.Item,
                    align: 'left',
                    baseline: 'middle',
                    alpha: this.alpha
                });

                const controlX = startX + columnWidth * 0.55;
                const controlW = columnWidth * 0.55;

                if (item.type === 'toggle') {
                    this._drawToggle(controlX, cursorY, controlW, item);
                } else if (item.type === 'slider') {
                    this._drawSlider(controlX, cursorY, controlW, item);
                } else if (item.type === 'segment') {
                    this._drawSegment(controlX, cursorY, controlW, item);
                } else if (item.type === 'button') {
                    this._drawButton(controlX, cursorY, controlW, item);
                }

                cursorY += itemGap;

                if (item.description) {
                    render('overlay', {
                        shape: 'text',
                        text: getLangString(item.description),
                        x: startX + columnWidth * 0.02,
                        y: cursorY - (itemGap * 0.45), // 요소와 더 가깝게 배치
                        font: `400 ${this.WW * 0.008 * this.scale}px "Pretendard Variable", arial`,
                        fill: ColorSchemes.Overlay.Text.Control,
                        align: 'left',
                        baseline: 'middle',
                        alpha: this.alpha * 0.8
                    });
                    cursorY += itemGap * 0.4; // 설명 다음에 여백 추가
                }
            }

            cursorY += sectionGap;
        }
    }

    _drawToggle(x, y, w, item) {
        const toggle = item.toggleElement;
        if (!toggle) return;

        const toggleW = (this.WW * 0.03 * this.scale) * 0.85;
        const toggleH = this.WH * 0.02 * this.scale;

        toggle.width = toggleW;
        toggle.height = toggleH;
        toggle.x = x; // 왼쪽 정렬
        toggle.y = y - toggle.height / 2; // 수직 중앙 정렬
        toggle.alpha = this.alpha;
        toggle.isOn = this.tempSettings[item.settingKey]; // 상태 동기화

        toggle.draw();
    }

    _drawSegment(x, y, w, item) {
        const seg = item.segmentControl;
        if (!seg) return;

        const segW = w * 0.7;
        const segH = this.WH * 0.035 * this.scale;

        seg.width = segW;
        seg.height = segH;
        seg.x = x; // 왼쪽 정렬
        seg.y = y - segH / 2; // 중앙 정렬
        seg.alpha = this.alpha;
        seg.font = `600 ${this.WH * 0.015 * this.scale}px "Pretendard Variable", arial`;

        // 필요한 경우 값 동기화 (onChange에서 처리됨)
        if (seg.value !== this.tempSettings[item.settingKey]) {
            seg.value = this.tempSettings[item.settingKey];
        }

        seg.draw();
    }

    _drawButton(x, y, w, item) {
        const btn = item.buttonElement;
        if (!btn) return;

        const btnW = this.WW * 0.06 * this.scale;
        const btnH = this.WH * 0.03 * this.scale;

        btn.width = btnW;
        btn.height = btnH;
        btn.x = x + w * 0.7 - btnW;
        btn.y = y - btnH / 2;
        btn.size = this.WW * 0.008 * this.scale;
        btn.radius = 6 * this.scale;
        btn.alpha = this.alpha;
        btn.update();
        btn.draw();
    }

    _openKeybindings() {
        // TODO: 키 설정 오버레이 열기
    }

    destroy() {
        if (this.saveBtnCustom) this.saveBtnCustom.destroy();
        if (this.cancelBtnCustom) this.cancelBtnCustom.destroy();
        if (this.renderScaleSlider) this.renderScaleSlider.destroy();

        for (const sec of this.sections) {
            for (const item of sec.items) {
                if (item.toggleElement) item.toggleElement.destroy();
                if (item.segmentControl) item.segmentControl.destroy();
                if (item.buttonElement) item.buttonElement.destroy();
                if (item.elementRef) {
                    for (const btn of item.elementRef) btn.destroy();
                }
            }
        }

        super.destroy();
    }
}

