import { BaseOverlay } from './base_overlay.js';
import { ButtonElement } from 'ui/element/button.js';
import { getLangString } from 'ui/_ui_system.js';
import { render } from 'display/_display_system.js';
import { ColorSchemes } from 'display/theme_handler.js';
import { getSetting } from 'save/_save_system.js';

export class ExitOverlay extends BaseOverlay {
    constructor() {
        super('overlayhigh');

        this.exitTitle = getLangString('title_exit_title');
        this.title = ""; // BaseOverlay의 제목 기능 대신 커스텀 그리기 사용 (또는 BaseOverlay title을 사용해도 됨, 여기선 유지)

        this.width = this.WW * 0.32;
        this.height = this.WH * 0.2;

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
                Game.close();
            },
            layer: this.layer,
            width: btnWidth,
            height: btnHeight,
            text: getLangString("title_exit_yes_label"),
            font: "Pretendard Variable, arial",
            fontWeight: 700,
            size: this.WW * 0.01,
            align: 'right',
            margin: btnWidth * 0.1,
            color: ColorSchemes.Overlay.Button.Confirm.Text,
            idleColor: ColorSchemes.Overlay.Button.Confirm.Idle,
            hoverColor: ColorSchemes.Overlay.Button.Confirm.Hover,
            enableHoverGradient: false,
            radius: 8,
            iconType: 'confirm'
        });

        // 아니오 버튼
        this.noButton = new ButtonElement({
            parent: this,
            onClick: this.close.bind(this),
            layer: this.layer,
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
            radius: 8,
            iconType: 'deny'
        });

        // 디버그 전용: 새로고침 버튼
        if (getSetting('debugMode')) {
            this.refreshButton = new ButtonElement({
                parent: this,
                onClick: () => {
                    location.reload();
                },
                layer: this.layer,
                width: btnWidth / 3,
                height: btnHeight,
                text: "🔄",
                font: "Pretendard Variable, arial",
                fontWeight: 700,
                size: this.WW * 0.01,
                align: 'center',
                margin: btnWidth * 0.1,
                color: ColorSchemes.Overlay.Button.Cancel.Text,
                idleColor: ColorSchemes.Overlay.Button.Cancel.Idle,
                hoverColor: ColorSchemes.Overlay.Button.Cancel.Hover,
                enableHoverGradient: false,
                radius: 8,
            });
        }

        this.yesButton.text = getLangString('title_exit_yes');
        this.noButton.text = getLangString('title_exit_no');

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
                y: scaledY + scaledH * 0.4,
                font: `300 ${this.WW * 0.011 * this.scale}px "Pretendard Variable", arial`,
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

            // 예/아니오 아이콘 - ButtonElement에서 처리됨

            if (this.refreshButton) {
                this.refreshButton.width = btnWidth / 3.5;
                this.refreshButton.height = btnHeight;
                this.refreshButton.x = (cx - scaledW / 2) + rightMargin;
                this.refreshButton.y = scaledY + scaledH - btnHeight - (this.WH * 0.03 * this.scale);
                this.refreshButton.size = this.WW * 0.01 * this.scale;
                this.refreshButton.alpha = this.alpha;
                this.refreshButton.radius = 8 * this.scale;
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
