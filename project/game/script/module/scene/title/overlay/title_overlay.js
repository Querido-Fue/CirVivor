import { ButtonElement } from '../../../ui/element/button.js';
import { getWW, getWH, render, shadowOn, shadowOff, getBackgroundCanvas, getMainCanvas } from '../../../display/_display_system.js';
import { ColorSchemes } from '../../../display/theme_handler.js';
import { animate, remove } from '../../../animation/_animation_system.js';
import { getLangString } from '../../../ui/_ui_system.js';
import { setMouseFocus } from '../../../input/_input_system.js';
import { getSetting } from '../../../save/_save_system.js';

/**
 * @class TitleOverlay
 * @description 타이틀 화면의 공통 팝업(오버레이) 클래스입니다.
 * @param {TitleScene} TitleScene - 타이틀 씬 인스턴스
 * @param {string} titleKey - 제목 언어 키
 */
export class TitleOverlay {
    constructor(TitleScene, titleKey) {
        this.TitleScene = TitleScene;
        this.WW = getWW();
        this.WH = getWH();

        this.width = this.WW * 0.6;
        this.height = this.WH * 0.7;
        this.x = (this.WW - this.width) / 2;
        this.y = (this.WH - this.height) / 2;

        this.title = getLangString(titleKey);
        this.alpha = 0;
        this.scale = 0.9;
        this.visible = true;

        // 닫기 버튼
        const btnHeight = this.WH * 0.08;
        const btnWidth = this.width * 0.5;
        this.closeButton = new ButtonElement({
            parent: this,
            onClick: this.close.bind(this),
            layer: "overlay",
            x: this.x + (this.width - btnWidth) / 2,
            y: this.y + this.height - btnHeight - this.WH * 0.02,
            width: btnWidth,
            height: btnHeight,
            text: getLangString("title_menu_close"),
            font: "arial",
            size: this.WW * 0.015,
            idleColor: 'rgba(0,0,0,0)',
            hoverColor: 'rgba(255,255,255,0.2)',
            enableHoverGradient: false,
            color: ColorSchemes.Title.TextDark,
        });

        this.open();
    }

    open() {
        this.visible = true;
        setMouseFocus('overlay');
        animate(this, { variable: 'alpha', startValue: 0, endValue: 1, type: "easeOutExpo", duration: 0.3 });
        animate(this, { variable: 'scale', startValue: 0.9, endValue: 1, type: "easeOutExpo", duration: 0.3 });
    }

    close() {
        animate(this, { variable: 'alpha', startValue: 1, endValue: 0, type: "easeInExpo", duration: 0.2 });
        animate(this.TitleScene, { variable: 'menuOpenAnimation', startValue: 1, endValue: 0, type: "linear", duration: 0.2 });
        animate(this, { variable: 'scale', startValue: 1, endValue: 0.9, type: "easeInExpo", duration: 0.2 }).promise.then(() => {
            setMouseFocus('main');
            this.destroy();
            this.TitleScene.menu = null;
            this.TitleScene.menuOpened = false;
            this.TitleScene.menuOpenAnimationInit = false;
        });
    }

    update() {
        if (this.visible && this.alpha > 0) {
            if (this.closeButton) this.closeButton.update();
        }
    }

    draw() {
        if (!this.visible || this.alpha <= 0.01) return;

        const cx = this.WW / 2;
        const cy = this.WH / 2;
        const scaledW = this.width * this.scale;
        const scaledH = this.height * this.scale;
        const scaledX = cx - scaledW / 2;
        const scaledY = cy - scaledH / 2;

        render('overlay', {
            shape: 'rect',
            x: 0, y: 0,
            w: this.WW, h: this.WH,
            fill: ColorSchemes.Overlay.Panel.Dim,
            alpha: this.alpha
        });

        shadowOn('overlay', 30, 'rgba(0,0,0,0.3)');
        render('overlay', {
            shape: getSetting('disableTransparency') ? 'roundRect' : 'glassRect',
            x: scaledX,
            y: scaledY,
            w: scaledW,
            h: scaledH,
            radius: 15,
            image: [getBackgroundCanvas(), getMainCanvas()],
            blur: 10,
            fill: getSetting('disableTransparency') ? ColorSchemes.Overlay.Panel.Background : ColorSchemes.Overlay.Panel.GlassBackground,
            stroke: getSetting('disableTransparency') ? ColorSchemes.Overlay.Panel.Background : ColorSchemes.Overlay.Panel.GlassBorder,
            lineWidth: 1,
            alpha: this.alpha
        });
        shadowOff('overlay');

        // 제목
        render('overlay', {
            shape: 'text',
            text: this.title,
            x: scaledX + scaledW * 0.05,
            y: scaledY + scaledH * 0.1,
            font: `bold ${this.WW * 0.025}px Pretendard, arial`,
            fill: ColorSchemes.Title.TextDark,
            align: 'left',
            alpha: this.alpha
        });

        // 닫기 버튼 (스케일 적용)
        if (this.closeButton) {
            const btnWidth = this.width * 0.5 * this.scale;
            const btnHeight = this.WH * 0.08 * this.scale;

            this.closeButton.width = btnWidth;
            this.closeButton.height = btnHeight;
            this.closeButton.x = scaledX + (scaledW - btnWidth) / 2;
            this.closeButton.y = scaledY + scaledH - btnHeight - (this.WH * 0.02 * this.scale);
            this.closeButton.size = this.WW * 0.015 * this.scale;
            this.closeButton.alpha = this.alpha;
            this.closeButton.draw();
        }
    }

    destroy() {
        if (this.closeButton) this.closeButton.destroy();
    }
}
