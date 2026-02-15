import { BaseOverlay } from './base_overlay.js';
import { ButtonElement } from 'ui/element/button.js';
import { getLangString } from 'ui/_ui_system.js';
import { render, getWW, getWH } from 'display/_display_system.js';
import { ColorSchemes } from 'display/theme_handler.js';
import { getSetting } from 'save/_save_system.js';

export class ExitOverlay extends BaseOverlay {
    constructor() {
        // 레이어는 항상 'overlayhigh'
        super('overlayhigh');

        this.exitTitle = getLangString('title_exit_title');
        this.title = ""; // BaseOverlay의 제목 기능 대신 커스텀 그리기 사용 (또는 BaseOverlay title을 사용해도 됨, 여기선 유지)

        this.width = this.WW * 0.32;
        this.height = this.WH * 0.2;
        this.x = (this.WW - this.width) / 2;
        this.y = (this.WH - this.height) / 2;

        // BaseOverlay의 닫기 버튼을 사용하지 않으므로 제거합니다.
        if (this.closeButton) {
            this.closeButton.destroy();
            this.closeButton = null;
        }

        this.queryText = getLangString('title_exit_query');

        const btnWidth = this.width * 0.25;
        const btnHeight = this.WH * 0.04;
        const gap = this.width * 0.05;
        const rightAnchor = this.x + this.width - this.width * 0.05;

        // 예 버튼
        this.yesButton = new ButtonElement({
            parent: this,
            onClick: () => {
                if (typeof window.close === 'function') {
                    window.close();
                } else if (typeof nw !== 'undefined') {
                    nw.Window.get().close();
                }
            },
            layer: this.layer,
            x: rightAnchor - btnWidth,
            y: this.y + this.height - btnHeight - this.WH * 0.03,
            width: btnWidth,
            height: btnHeight,
            text: getLangString("title_exit_yes_label"),
            font: "Pretendard Variable, arial",
            fontWeight: 700,
            size: this.WW * 0.01,
            align: 'right',
            margin: btnWidth * 0.1,
            color: ColorSchemes.Overlay.Button.Save.Text,
            idleColor: ColorSchemes.Overlay.Button.Save.Idle,
            hoverColor: ColorSchemes.Overlay.Button.Save.Hover,
            enableHoverGradient: false,
            radius: 8
        });

        // 아니오 버튼
        this.noButton = new ButtonElement({
            parent: this,
            onClick: this.close.bind(this),
            layer: this.layer,
            x: rightAnchor - btnWidth * 2 - gap,
            y: this.y + this.height - btnHeight - this.WH * 0.03,
            width: btnWidth,
            height: btnHeight,
            text: getLangString("title_exit_no_label"),
            font: "Pretendard Variable, arial",
            fontWeight: 700,
            size: this.WW * 0.01,
            align: 'right',
            margin: btnWidth * 0.1,
            color: ColorSchemes.Overlay.Button.Cancel.Text,
            idleColor: ColorSchemes.Overlay.Button.Cancel.Idle,
            hoverColor: ColorSchemes.Overlay.Button.Cancel.Hover,
            enableHoverGradient: false,
            radius: 8
        });

        this.yesButton.text = getLangString('title_exit_yes');
        this.noButton.text = getLangString('title_exit_no');

        // 디버그 전용: 새로고침 버튼
        if (getSetting('debugMode')) {
            this.refreshButton = new ButtonElement({
                parent: this,
                onClick: () => {
                    location.reload();
                },
                layer: this.layer,
                x: rightAnchor - btnWidth * 3 - gap * 2,
                y: this.y + this.height - btnHeight - this.WH * 0.03,
                width: btnHeight,
                height: btnHeight,
                text: "🔄",
                font: "Pretendard Variable, arial",
                size: this.WW * 0.015,
                align: 'center',
                margin: 0,
                color: ColorSchemes.Overlay.Button.Cancel.Text, // Replaced explicit colors
                idleColor: ColorSchemes.Overlay.Button.Cancel.Idle,
                hoverColor: ColorSchemes.Overlay.Button.Cancel.Hover,
                enableHoverGradient: false,
                radius: 8
            });
        }

        this.open();
    }

    onCloseComplete() {
        // TitleOverlay 로직 제거 -> 기본 동작만 수행 (destroy, focus reset)
        // 만약 global active overlay를 관리한다면 여기서 null 처리 필요
        super.onCloseComplete();
    }

    update() {
        super.update(); // BaseOverlay update (optional closeButton)
        if (this.visible && this.alpha > 0) {
            this.yesButton.update();
            this.noButton.update();
            if (this.refreshButton) this.refreshButton.update();
        }
    }

    draw() {
        if (!this.visible || this.alpha <= 0.01) return;

        super.draw(); // BaseOverlay draw (Backdrop + Glass Panel)

        const scaledW = this.width * this.scale;
        const scaledH = this.height * this.scale;
        const cx = this.WW / 2;
        const cy = this.WH / 2;
        const scaledX = cx - scaledW / 2;
        const scaledY = cy - scaledH / 2;

        if (this.alpha > 0) {
            // 제목 (BaseOverlay의 title을 안 썼으므로 직접 그림)
            render(this.layer, {
                shape: 'text',
                text: this.exitTitle,
                x: scaledX + scaledW * 0.06,
                y: scaledY + scaledH * 0.2,
                font: `700 ${this.WW * 0.016 * this.scale}px "Pretendard Variable", arial`,
                fill: ColorSchemes.Title.TextDark,
                align: 'left',
                baseline: 'middle',
                alpha: this.alpha
            });

            // 질문 텍스트
            render(this.layer, {
                shape: 'text',
                text: this.queryText,
                x: scaledX + scaledW * 0.06,
                y: scaledY + scaledH * 0.45,
                font: `700 ${this.WW * 0.011 * this.scale}px "Pretendard Variable", arial`,
                fill: ColorSchemes.Overlay.Text.Item,
                align: 'left',
                baseline: 'middle',
                alpha: this.alpha
            });

            // 버튼 레이아웃 (스케일 적용)
            const btnWidth = this.width * 0.25 * this.scale;
            const btnHeight = this.WH * 0.04 * this.scale;
            const gap = this.width * 0.05 * this.scale;
            const rightMargin = this.width * 0.05 * this.scale;
            const startX = (cx + scaledW / 2) - rightMargin;

            this.yesButton.width = btnWidth;
            this.yesButton.height = btnHeight;
            this.yesButton.x = startX - btnWidth;
            this.yesButton.y = scaledY + scaledH - btnHeight - (this.WH * 0.03 * this.scale);
            this.yesButton.size = this.WW * 0.01 * this.scale;
            this.yesButton.alpha = this.alpha;
            this.yesButton.radius = 8 * this.scale;
            this.yesButton.draw();

            this.noButton.width = btnWidth;
            this.noButton.height = btnHeight;
            this.noButton.x = startX - btnWidth * 2 - gap;
            this.noButton.y = scaledY + scaledH - btnHeight - (this.WH * 0.03 * this.scale);
            this.noButton.size = this.WW * 0.01 * this.scale;
            this.noButton.alpha = this.alpha;
            this.noButton.radius = 8 * this.scale;
            this.noButton.draw();

            const btnIconSize = btnHeight * 0.4;

            // 예 아이콘 (O)
            const yesIconX = this.yesButton.x + btnWidth * 0.15;
            const yesIconY = this.yesButton.y + btnHeight / 2;

            render(this.layer, {
                shape: 'circle',
                x: yesIconX,
                y: yesIconY,
                radius: btnIconSize / 2,
                fill: false,
                stroke: ColorSchemes.Overlay.Button.Save.Text,
                lineWidth: 1.2 * this.scale,
                alpha: this.alpha
            });

            // 아니오 아이콘 (X)
            const noIconX = this.noButton.x + btnWidth * 0.15;
            const noIconY = this.noButton.y + btnHeight / 2;
            const bxSize = btnIconSize * 0.6;

            render(this.layer, {
                shape: 'line',
                x1: noIconX - bxSize / 2,
                y1: noIconY - bxSize / 2,
                x2: noIconX + bxSize / 2,
                y2: noIconY + bxSize / 2,
                stroke: ColorSchemes.Overlay.Button.Cancel.Text,
                lineWidth: 1.2 * this.scale,
                alpha: this.alpha,
                lineCap: 'round'
            });
            render(this.layer, {
                shape: 'line',
                x1: noIconX + bxSize / 2,
                y1: noIconY - bxSize / 2,
                x2: noIconX - bxSize / 2,
                y2: noIconY + bxSize / 2,
                stroke: ColorSchemes.Overlay.Button.Cancel.Text,
                lineWidth: 1.2 * this.scale,
                alpha: this.alpha,
                lineCap: 'round'
            });

            if (this.refreshButton) {
                this.refreshButton.draw();
            }
        }
    }

    destroy() {
        if (this.yesButton) this.yesButton.destroy();
        if (this.noButton) this.noButton.destroy();
        if (this.refreshButton) this.refreshButton.destroy();
        super.destroy();
    }
}
