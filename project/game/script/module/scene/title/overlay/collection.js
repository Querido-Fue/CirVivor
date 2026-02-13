import { TitleOverlay } from './title_overlay.js';
import { ButtonElement } from '../../../ui/element/button.js';
import { getLangString } from '../../../ui/_ui_system.js';
import { ColorSchemes } from '../../../display/theme_handler.js';
import { render } from '../../../display/_display_system.js';

export class CollectionOverlay extends TitleOverlay {
    constructor(TitleScene) {
        super(TitleScene, '');

        this.collectionTitle = getLangString('title_collection_title');

        this.width = this.WW * 0.65;
        this.height = this.WH * 0.7;
        this.x = (this.WW - this.width) / 2;
        this.y = (this.WH - this.height) / 2;

        if (this.closeButton) {
            this.closeButton.destroy();
            this.closeButton = null;
        }

        this.achievementProgress = 0;
        this.encyclopediaProgress = 0;

        const cardW = this.width * 0.38;
        const cardH = this.height * 0.55;
        const cardY = this.y + this.height * 0.18;
        const gap = this.width * 0.06;
        const centerX = this.x + this.width / 2;

        this.achievementButton = new ButtonElement({
            parent: this,
            onClick: () => { },
            layer: "overlay",
            x: centerX - gap / 2 - cardW,
            y: cardY,
            width: cardW,
            height: cardH,
            text: '',
            idleColor: ColorSchemes.Overlay.Control.Inactive,
            hoverColor: ColorSchemes.Overlay.Control.Hover,
            enableHoverGradient: false,
            radius: 12
        });

        this.encyclopediaButton = new ButtonElement({
            parent: this,
            onClick: () => { },
            layer: "overlay",
            x: centerX + gap / 2,
            y: cardY,
            width: cardW,
            height: cardH,
            text: '',
            idleColor: ColorSchemes.Overlay.Control.Inactive,
            hoverColor: ColorSchemes.Overlay.Control.Hover,
            enableHoverGradient: false,
            radius: 12
        });

        const closeBtnW = this.WW * 0.08;
        const closeBtnH = this.WH * 0.04;

        this.closeBtnCustom = new ButtonElement({
            parent: this,
            onClick: this.close.bind(this),
            layer: "overlay",
            x: this.x + this.WW * 0.02,
            y: this.y + this.height - closeBtnH - this.WH * 0.03,
            width: closeBtnW,
            height: closeBtnH,
            text: getLangString('title_collection_close'),
            font: "Pretendard Variable, arial",
            fontWeight: 700,
            size: this.WW * 0.01,
            align: 'right',
            margin: closeBtnW * 0.12,
            color: '#ffffff',
            idleColor: '#166ffb',
            hoverColor: '#4d8ffc',
            enableHoverGradient: false,
            radius: 8
        });
    }

    update() {
        super.update();
        if (this.visible && this.alpha > 0) {
            this.closeBtnCustom.update();
            this.achievementButton.update();
            this.encyclopediaButton.update();
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
            const paddingX = scaledW * 0.03;

            render('overlay', {
                shape: 'text',
                text: this.collectionTitle,
                x: scaledX + paddingX,
                y: scaledY + scaledH * 0.06,
                font: `700 ${this.WW * 0.018 * this.scale}px "Pretendard Variable", arial`,
                fill: ColorSchemes.Title.TextDark,
                align: 'left',
                baseline: 'middle',
                alpha: this.alpha
            });

            render('overlay', {
                shape: 'line',
                x1: scaledX + paddingX,
                y1: scaledY + scaledH * 0.11,
                x2: scaledX + scaledW - paddingX,
                y2: scaledY + scaledH * 0.11,
                stroke: ColorSchemes.Overlay.Panel.Divider,
                lineWidth: 1,
                alpha: this.alpha
            });

            const cardW = scaledW * 0.38;
            const cardH = scaledH * 0.55;
            const cardY = scaledY + scaledH * 0.18;
            const gap = scaledW * 0.06;

            const achX = cx - gap / 2 - cardW;
            const encX = cx + gap / 2;

            this.achievementButton.x = achX;
            this.achievementButton.y = cardY;
            this.achievementButton.width = cardW;
            this.achievementButton.height = cardH;
            this.achievementButton.alpha = this.alpha;
            this.achievementButton.radius = 12 * this.scale;
            this.achievementButton.draw();

            this.encyclopediaButton.x = encX;
            this.encyclopediaButton.y = cardY;
            this.encyclopediaButton.width = cardW;
            this.encyclopediaButton.height = cardH;
            this.encyclopediaButton.alpha = this.alpha;
            this.encyclopediaButton.radius = 12 * this.scale;
            this.encyclopediaButton.draw();

            const iconSize = this.WW * 0.04 * this.scale;
            const titleSize = this.WW * 0.016 * this.scale;
            const progressSize = this.WW * 0.022 * this.scale;
            const subSize = this.WW * 0.009 * this.scale;

            // 실적 카드 내용
            const achCx = achX + cardW / 2;
            const achCy = cardY + cardH / 2;

            render('overlay', {
                shape: 'text',
                text: '🏆',
                x: achCx,
                y: achCy - cardH * 0.18,
                font: `${iconSize}px "Pretendard Variable", arial`,
                fill: ColorSchemes.Title.TextDark,
                align: 'center',
                baseline: 'middle',
                alpha: this.alpha
            });

            render('overlay', {
                shape: 'text',
                text: getLangString('title_collection_achievements'),
                x: achCx,
                y: achCy + cardH * 0.02,
                font: `700 ${titleSize}px "Pretendard Variable", arial`,
                fill: ColorSchemes.Title.TextDark,
                align: 'center',
                baseline: 'middle',
                alpha: this.alpha
            });

            this._drawProgressBar(achX + cardW * 0.12, achCy + cardH * 0.22, cardW * 0.76, this.achievementProgress);

            render('overlay', {
                shape: 'text',
                text: `${this.achievementProgress}%`,
                x: achCx,
                y: achCy + cardH * 0.34,
                font: `700 ${this.WW * 0.012 * this.scale}px "Pretendard Variable", arial`,
                fill: '#166ffb',
                align: 'center',
                baseline: 'middle',
                alpha: this.alpha
            });

            // 도감 카드 내용
            const encCx = encX + cardW / 2;
            const encCy = cardY + cardH / 2;

            render('overlay', {
                shape: 'text',
                text: '📖',
                x: encCx,
                y: encCy - cardH * 0.18,
                font: `${iconSize}px "Pretendard Variable", arial`,
                fill: ColorSchemes.Title.TextDark,
                align: 'center',
                baseline: 'middle',
                alpha: this.alpha
            });

            render('overlay', {
                shape: 'text',
                text: getLangString('title_collection_encyclopedia'),
                x: encCx,
                y: encCy + cardH * 0.02,
                font: `700 ${titleSize}px "Pretendard Variable", arial`,
                fill: ColorSchemes.Title.TextDark,
                align: 'center',
                baseline: 'middle',
                alpha: this.alpha
            });

            this._drawProgressBar(encX + cardW * 0.12, encCy + cardH * 0.22, cardW * 0.76, this.encyclopediaProgress);

            render('overlay', {
                shape: 'text',
                text: `${this.encyclopediaProgress}%`,
                x: encCx,
                y: encCy + cardH * 0.34,
                font: `700 ${this.WW * 0.012 * this.scale}px "Pretendard Variable", arial`,
                fill: '#166ffb',
                align: 'center',
                baseline: 'middle',
                alpha: this.alpha
            });

            // 닫기 버튼
            const closeBtnW = this.WW * 0.08 * this.scale;
            const closeBtnH = this.WH * 0.04 * this.scale;

            this.closeBtnCustom.x = scaledX + scaledW - closeBtnW - this.WW * 0.02 * this.scale;
            this.closeBtnCustom.y = scaledY + scaledH - closeBtnH - (this.WH * 0.03 * this.scale);
            this.closeBtnCustom.width = closeBtnW;
            this.closeBtnCustom.height = closeBtnH;
            this.closeBtnCustom.size = this.WW * 0.01 * this.scale;
            this.closeBtnCustom.alpha = this.alpha;
            this.closeBtnCustom.radius = 8 * this.scale;
            this.closeBtnCustom.draw();

            // X 아이콘
            const btnIconSize = closeBtnH * 0.4;
            const cancelIconX = this.closeBtnCustom.x + closeBtnW * 0.15;
            const cancelIconY = this.closeBtnCustom.y + closeBtnH / 2;
            const xSize = btnIconSize * 0.6;

            render('overlay', {
                shape: 'line',
                x1: cancelIconX - xSize / 2,
                y1: cancelIconY - xSize / 2,
                x2: cancelIconX + xSize / 2,
                y2: cancelIconY + xSize / 2,
                stroke: '#ffffff',
                lineWidth: 1.2 * this.scale,
                alpha: this.alpha,
                lineCap: 'round'
            });
            render('overlay', {
                shape: 'line',
                x1: cancelIconX + xSize / 2,
                y1: cancelIconY - xSize / 2,
                x2: cancelIconX - xSize / 2,
                y2: cancelIconY + xSize / 2,
                stroke: '#ffffff',
                lineWidth: 1.2 * this.scale,
                alpha: this.alpha,
                lineCap: 'round'
            });
        }
    }

    _drawProgressBar(x, y, w, percent) {
        const barH = this.WH * 0.008 * this.scale;
        const fillW = w * (percent / 100);

        render('overlay', {
            shape: 'roundRect',
            x: x,
            y: y - barH / 2,
            w: w,
            h: barH,
            radius: barH / 2,
            fill: ColorSchemes.Overlay.Text.Item,
            alpha: this.alpha
        });

        if (fillW > 0) {
            render('overlay', {
                shape: 'roundRect',
                x: x,
                y: y - barH / 2,
                w: fillW,
                h: barH,
                radius: barH / 2,
                fill: '#166ffb',
                alpha: this.alpha
            });
        }
    }

    destroy() {
        if (this.closeBtnCustom) this.closeBtnCustom.destroy();
        if (this.achievementButton) this.achievementButton.destroy();
        if (this.encyclopediaButton) this.encyclopediaButton.destroy();
        super.destroy();
    }
}
