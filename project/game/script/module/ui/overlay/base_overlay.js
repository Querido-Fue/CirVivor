import { getWW, getWH, render, shadowOn, shadowOff, getBehindCanvases, getCanvas, setDim } from 'display/_display_system.js';
import { ColorSchemes } from 'display/theme_handler.js';
import { animate } from 'animation/_animation_system.js';
import { setMouseFocus, getMouseFocus } from 'input/_input_system.js';
import { getSetting } from 'save/_save_system.js';
import { parseUIData } from '../_ui_system.js';

/**
 * @class BaseOverlay
 * @description 게임 내 모든 오버레이(팝업)의 기본 클래스입니다.
 * 공통적인 열기/닫기 애니메이션, 배경 그리기(Glassmorphism) 등을 처리합니다.
 */
export class BaseOverlay {
    /**
     * @param {string} layer - 오버레이가 그려질 레이어 이름
     */
    constructor(layer = 'overlay') {
        this.layer = layer;
        this.sourceCanvases = getBehindCanvases(layer);
        this.WW = getWW();
        this.WH = getWH();

        // 지오메트리 변수 초기화
        this.width = 0;
        this.height = 0;
        this.dx = 0;
        this.dy = 0;

        // UI 스케일 적용
        this.uiScale = getSetting('uiScale') / 100 || 1;

        // 애니메이션 처리
        this.animating = false;
        this.animScale = 0.9;
        this.dim = 0;
        this.alpha = 0;
    }

    _calculateGeometry() {
        this.scaledW = this.width * this.uiScale;
        this.scaledH = this.height * this.uiScale;
        this.scaledX = (this.WW - this.scaledW) / 2 + this.dx;
        this.scaledY = (this.WH - this.scaledH) / 2 + this.dy;
    }

    _generateLayout() {
        // override
    }

    /**
     * 오버레이를 엽니다.
     */
    open() {
        this.animating = true;
        this.previousFocus = getMouseFocus(); // 현재 포커스 저장
        setMouseFocus(this.layer);

        animate(this, { variable: 'alpha', startValue: 0, endValue: 1, type: "easeOutExpo", duration: 0.3 });
        animate(this, { variable: 'dim', startValue: "current", endValue: ColorSchemes.Overlay.Panel.Dim, type: "easeOutExpo", duration: 0.3 });
        animate(this, { variable: 'animScale', startValue: 0.9, endValue: 1.0, type: "easeOutExpo", duration: 0.4 }).promise.then(() => {
            this.animating = false;
            const canvas = getCanvas(this.layer);
            canvas.style.transform = `scale(1)`;
        });
    }

    /**
     * 오버레이를 닫습니다.
     */
    close() {
        this.animating = true;
        animate(this, { variable: 'alpha', startValue: 1, endValue: 0, type: "easeInExpo", duration: 0.3 });
        animate(this, { variable: 'animScale', startValue: 1.0, endValue: 0.9, type: "easeInExpo", duration: 0.3 }).promise.then(() => {
            setMouseFocus(this.previousFocus || ['ui', 'background']); // 이전 포커스로 복귀
            this.onCloseComplete();
            this.animating = false;
        });
        animate(this, { variable: 'dim', startValue: "current", endValue: 0, type: "easeInExpo", duration: 0.3 });
    }

    onCloseComplete() {
        // override
    }

    update() {
        setDim(this.layer, this.dim);
        if (this.dynamicItems) {
            for (const key in this.dynamicItems) {
                const item = this.dynamicItems[key].item;
                if (item.update) item.update();
            }
        }
        if (!this.animating) return;
        const canvas = getCanvas(this.layer);
        canvas.style.opacity = this.alpha;
        canvas.style.transform = `scale(${this.animScale})`;
    }

    /**
     * 배경과 기본 프레임을 그립니다.
     */
    draw() {
        if (this.alpha === 0) return;
        // Glassmorphism 패널
        shadowOn(this.layer, 30, ColorSchemes.Overlay.Panel.Shadow);
        render(this.layer, {
            shape: getSetting('disableTransparency') ? 'roundRect' : 'glassRect',
            x: this.scaledX,
            y: this.scaledY,
            w: this.scaledW,
            h: this.scaledH,
            radius: parseUIData("UI_CONSTANTS.OVERLAY_PANEL_RADIUS", this.uiScale),
            image: this.sourceCanvases,
            blur: 10,
            fill: getSetting('disableTransparency') ? ColorSchemes.Overlay.Panel.Background : ColorSchemes.Overlay.Panel.GlassBackground,
            stroke: getSetting('disableTransparency') ? ColorSchemes.Overlay.Panel.Background : ColorSchemes.Overlay.Panel.GlassBorder,
            lineWidth: 1,
        });
        shadowOff(this.layer);

        if (this.staticItems) {
            for (const key in this.staticItems) {
                render(this.layer, this.staticItems[key].item);
            }
        }
        if (this.dynamicItems) {
            for (const key in this.dynamicItems) {
                const item = this.dynamicItems[key].item;
                if (item.draw) item.draw();
            }
        }
    }
}
