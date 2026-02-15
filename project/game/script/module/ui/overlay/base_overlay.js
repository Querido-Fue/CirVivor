import { ButtonElement } from 'ui/element/button.js';
import { getWW, getWH, render, shadowOn, shadowOff, getBackgroundCanvas, getObjectCanvas, getEffectCanvas, getTextEffectCanvas, getUiCanvas, getOverlayCanvas } from 'display/_display_system.js';
import { ColorSchemes } from 'display/theme_handler.js';
import { animate, remove } from 'animation/_animation_system.js';
import { getLangString } from 'ui/_ui_system.js';
import { setMouseFocus, getMouseFocus } from 'input/_input_system.js';
import { getSetting } from 'save/_save_system.js';

/**
 * @class BaseOverlay
 * @description 게임 내 모든 오버레이(팝업)의 기본 클래스입니다.
 * 공통적인 열기/닫기 애니메이션, 배경 그리기(Glassmorphism) 등을 처리합니다.
 */
export class BaseOverlay {
    /**
     * @param {string} layer - 오버레이가 그려질 레이어 이름 (예: 'overlay', 'overlayhigh')
     */
    constructor(layer = 'overlay') {
        this.layer = layer;
        this.WW = getWW();
        this.WH = getWH();

        this.width = this.WW * 0.6;
        this.height = this.WH * 0.7;
        this.x = (this.WW - this.width) / 2;
        this.y = (this.WH - this.height) / 2;

        this.title = "";
        this.alpha = 0;
        this.scale = 0.9;
        this.visible = true;
        this.closeButton = null;
        this.previousFocus = 'ui'; // 기본값

        // 초기화 시 자동으로 열리지 않음. 상속받은 클래스에서 open() 호출 필요.
    }

    /**
     * 오버레이를 엽니다.
     */
    open() {
        this.visible = true;
        this.previousFocus = getMouseFocus(); // 현재 포커스 저장
        setMouseFocus(this.layer);
        animate(this, { variable: 'alpha', startValue: 0, endValue: 1, type: "easeOutExpo", duration: 0.3 });
        animate(this, { variable: 'scale', startValue: 0.9, endValue: 1, type: "easeOutExpo", duration: 0.3 });
    }

    /**
     * 오버레이를 닫습니다.
     */
    close() {
        animate(this, { variable: 'alpha', startValue: 1, endValue: 0, type: "easeInExpo", duration: 0.2 });
        animate(this, { variable: 'scale', startValue: 1, endValue: 0.9, type: "easeInExpo", duration: 0.2 }).promise.then(() => {
            this.onCloseComplete();
        });
    }

    /**
     * 닫기 애니메이션 완료 후 호출됩니다.
     */
    onCloseComplete() {
        setMouseFocus(this.previousFocus || 'ui'); // 이전 포커스로 복귀
        this.destroy();
    }

    update() {
        if (this.visible && this.alpha > 0) {
            if (this.closeButton) this.closeButton.update();
        }
    }

    /**
     * 배경과 기본 프레임을 그립니다.
     */
    draw() {
        if (!this.visible || this.alpha <= 0.01) return;

        const cx = this.WW / 2;
        const cy = this.WH / 2;
        const scaledW = this.width * this.scale;
        const scaledH = this.height * this.scale;
        const scaledX = cx - scaledW / 2;
        const scaledY = cy - scaledH / 2;

        // 1. 전체 화면 Dim 처리
        render(this.layer, {
            shape: 'rect',
            x: 0, y: 0,
            w: this.WW, h: this.WH,
            fill: ColorSchemes.Overlay.Panel.Dim,
            alpha: this.alpha
        });

        // Glassmorphism용 Canvas 소스 준비
        const sourceCanvases = [getBackgroundCanvas(), getObjectCanvas(), getEffectCanvas(), getTextEffectCanvas(), getUiCanvas()];

        // overlayhigh 레이어인 경우, 그 아래의 overlay 레이어도 블러 처리에 포함해야 자연스러움
        if (this.layer === 'overlayhigh') {
            sourceCanvases.push(getOverlayCanvas());
        }

        // 2. Glassmorphism 패널
        shadowOn(this.layer, 30, 'rgba(0,0,0,0.3)');
        render(this.layer, {
            shape: getSetting('disableTransparency') ? 'roundRect' : 'glassRect',
            x: scaledX,
            y: scaledY,
            w: scaledW,
            h: scaledH,
            radius: 15,
            image: sourceCanvases,
            blur: 10,
            fill: getSetting('disableTransparency') ? ColorSchemes.Overlay.Panel.Background : ColorSchemes.Overlay.Panel.GlassBackground,
            stroke: getSetting('disableTransparency') ? ColorSchemes.Overlay.Panel.Background : ColorSchemes.Overlay.Panel.GlassBorder,
            lineWidth: 1,
            alpha: this.alpha
        });
        shadowOff(this.layer);

        // 3. 제목 (있을 경우)
        if (this.title) {
            render(this.layer, {
                shape: 'text',
                text: this.title,
                x: scaledX + scaledW * 0.05,
                y: scaledY + scaledH * 0.1,
                font: `bold ${this.WW * 0.025}px Pretendard, arial`,
                fill: ColorSchemes.Title.TextDark,
                align: 'left',
                alpha: this.alpha
            });
        }

        // 4. 닫기 버튼 (있을 경우)
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
