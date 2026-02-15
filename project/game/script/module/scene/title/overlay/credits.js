import { TitleOverlay } from './title_overlay.js';
import { ButtonElement } from 'ui/element/button.js';
import { getLangString } from 'ui/_ui_system.js';
import { render, getWW, getWH, measureText } from 'display/_display_system.js';
import { ColorSchemes } from 'display/theme_handler.js';

function openURL(url) {
    try {
        nw.Shell.openExternal(url);
    } catch (e) {
        window.open(url, '_blank');
    }
}

export class CreditsOverlay extends TitleOverlay {
    constructor(TitleScene) {
        super(TitleScene, '');

        this.creditsTitle = getLangString('title_credits_title');

        this.width = this.WW * 0.4;
        this.height = this.WH * 0.55;
        this.x = (this.WW - this.width) / 2;
        this.y = (this.WH - this.height) / 2;

        if (this.closeButton) {
            this.closeButton.destroy();
            this.closeButton = null;
        }

        this.linkButtons = [];

        // 섹션 데이터
        this.sections = [
            {
                title: getLangString('title_credits_section_dev'),
                items: [
                    {
                        name: getLangString('title_credits_dev_name'),
                        links: [
                            { label: getLangString('title_credits_link_blog'), url: 'https://jukchang.com' },
                            { label: getLangString('title_credits_link_github'), url: 'https://github.com/Querido-Fue/CirVivor' }
                        ]
                    }
                ]
            },
            {
                title: getLangString('title_credits_section_assets'),
                items: [
                    {
                        name: 'Pretendard',
                        links: [
                            { label: getLangString('title_credits_link_pretendard'), url: 'https://github.com/orioncactus/pretendard' }
                        ]
                    },
                    {
                        name: 'React Bits',
                        links: [
                            { label: getLangString('title_credits_link_reactbits'), url: 'https://github.com/DavidHDev/react-bits' }
                        ]
                    }
                ]
            }
        ];

        // 링크 버튼 생성
        const linkBtnW = this.WW * 0.06;
        const linkBtnH = this.WH * 0.03;

        for (const section of this.sections) {
            for (const item of section.items) {
                for (const link of item.links) {
                    const btn = new ButtonElement({
                        parent: this,
                        onClick: () => openURL(link.url),
                        layer: "overlay",
                        x: 0,
                        y: 0,
                        width: linkBtnW,
                        height: linkBtnH,
                        text: link.label,
                        font: "Pretendard Variable, arial",
                        fontWeight: 500,
                        size: this.WW * 0.008,
                        align: 'right',
                        margin: linkBtnW * 0.1,
                        color: ColorSchemes.Overlay.Text.Item,
                        idleColor: ColorSchemes.Overlay.Control.Inactive,
                        hoverColor: ColorSchemes.Overlay.Control.Hover,
                        enableHoverGradient: false,
                        radius: 6
                    });
                    btn._linkRef = link;
                    this.linkButtons.push(btn);
                }
            }
        }

        // 닫기 버튼
        const btnWidth = this.width * 0.2;
        const btnHeight = this.WH * 0.04;
        const rightAnchor = this.x + this.width - this.width * 0.05;

        this.closeBtnCustom = new ButtonElement({
            parent: this,
            onClick: this.close.bind(this),
            layer: "overlay",
            x: rightAnchor - btnWidth,
            y: this.y + this.height - btnHeight - this.WH * 0.03,
            width: btnWidth,
            height: btnHeight,
            text: getLangString('title_credits_close'),
            font: "Pretendard Variable, arial",
            fontWeight: 700,
            size: this.WW * 0.01,
            align: 'right',
            margin: btnWidth * 0.12,
            color: ColorSchemes.Overlay.Button.Cancel.Text,
            idleColor: ColorSchemes.Overlay.Button.Cancel.Idle,
            hoverColor: ColorSchemes.Overlay.Button.Cancel.Hover,
            enableHoverGradient: false,
            radius: 8
        });
    }

    update() {
        super.update();
        if (this.visible && this.alpha > 0) {
            this.closeBtnCustom.update();
            for (const btn of this.linkButtons) btn.update();
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
            const paddingX = scaledW * 0.06;

            // 제목
            render('overlay', {
                shape: 'text',
                text: this.creditsTitle,
                x: scaledX + paddingX,
                y: scaledY + scaledH * 0.08,
                font: `700 ${this.WW * 0.018 * this.scale}px "Pretendard Variable", arial`,
                fill: ColorSchemes.Title.TextDark,
                align: 'left',
                baseline: 'middle',
                alpha: this.alpha
            });

            // 구분선
            render('overlay', {
                shape: 'line',
                x1: scaledX + paddingX,
                y1: scaledY + scaledH * 0.14,
                x2: scaledX + scaledW - paddingX,
                y2: scaledY + scaledH * 0.14,
                stroke: ColorSchemes.Overlay.Panel.Divider,
                lineWidth: 1,
                alpha: this.alpha
            });

            // 섹션 렌더링
            let cursorY = scaledY + scaledH * 0.22;
            const sectionGap = scaledH * 0.06;
            const itemGap = scaledH * 0.08;
            let linkBtnIdx = 0;

            const linkBtnW = this.WW * 0.06 * this.scale;
            const linkBtnH = this.WH * 0.03 * this.scale;
            const linkBtnGap = scaledW * 0.015;
            const arrowSize = this.WW * 0.004 * this.scale;

            for (const section of this.sections) {
                // 소제목
                render('overlay', {
                    shape: 'text',
                    text: section.title,
                    x: scaledX + paddingX,
                    y: cursorY,
                    font: `600 ${this.WW * 0.013 * this.scale}px "Pretendard Variable", arial`,
                    fill: ColorSchemes.Overlay.Text.Section,
                    align: 'left',
                    baseline: 'middle',
                    alpha: this.alpha
                });


                const font = `600 ${this.WW * 0.013 * this.scale}px "Pretendard Variable", arial`;
                const textWidth = measureText(section.title, font);

                const lineStartX = scaledX + paddingX + textWidth + (scaledW * 0.03);
                const lineEndX = scaledX + scaledW - paddingX;

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
                    // 항목 이름
                    render('overlay', {
                        shape: 'text',
                        text: item.name,
                        x: scaledX + paddingX + scaledW * 0.02,
                        y: cursorY,
                        font: `400 ${this.WW * 0.011 * this.scale}px "Pretendard Variable", arial`,
                        fill: ColorSchemes.Overlay.Text.Item,
                        align: 'left',
                        baseline: 'middle',
                        alpha: this.alpha
                    });

                    // 링크 버튼 (오른쪽 정렬)
                    let btnX = scaledX + scaledW - paddingX;
                    for (let i = item.links.length - 1; i >= 0; i--) {
                        btnX -= linkBtnW;
                        const btn = this.linkButtons[linkBtnIdx + i];
                        btn.width = linkBtnW;
                        btn.height = linkBtnH;
                        btn.x = btnX;
                        btn.y = cursorY - linkBtnH / 2;
                        btn.size = this.WW * 0.008 * this.scale;
                        btn.alpha = this.alpha;
                        btn.radius = 6 * this.scale;
                        btn.draw();

                        // → 화살표 아이콘
                        const arrowLeft = btnX;
                        const arrowY = cursorY;
                        const arrowRight = btnX + linkBtnW * 0.25;
                        const headSize = arrowSize * 0.9;

                        // 수평선
                        render('overlay', {
                            shape: 'line',
                            x1: arrowLeft,
                            y1: arrowY,
                            x2: arrowRight,
                            y2: arrowY,
                            stroke: ColorSchemes.Overlay.Text.Item,
                            lineWidth: 1.2 * this.scale,
                            alpha: this.alpha,
                            lineCap: 'round'
                        });
                        // 화살촉 위
                        render('overlay', {
                            shape: 'line',
                            x1: arrowRight - headSize,
                            y1: arrowY - headSize,
                            x2: arrowRight,
                            y2: arrowY,
                            stroke: ColorSchemes.Overlay.Text.Item,
                            lineWidth: 1.2 * this.scale,
                            alpha: this.alpha,
                            lineCap: 'round'
                        });
                        // 화살촉 아래
                        render('overlay', {
                            shape: 'line',
                            x1: arrowRight - headSize,
                            y1: arrowY + headSize,
                            x2: arrowRight,
                            y2: arrowY,
                            stroke: ColorSchemes.Overlay.Text.Item,
                            lineWidth: 1.2 * this.scale,
                            alpha: this.alpha,
                            lineCap: 'round'
                        });

                        btnX -= linkBtnGap;
                    }
                    linkBtnIdx += item.links.length;

                    cursorY += itemGap;
                }

                cursorY += sectionGap;
            }

            // 닫기 버튼 (스케일 적용)
            const btnWidth = this.width * 0.2 * this.scale;
            const btnHeight = this.WH * 0.04 * this.scale;
            const rightMargin = this.width * 0.05 * this.scale;
            const startX = (cx + scaledW / 2) - rightMargin;

            this.closeBtnCustom.width = btnWidth;
            this.closeBtnCustom.height = btnHeight;
            this.closeBtnCustom.x = startX - btnWidth;
            this.closeBtnCustom.y = scaledY + scaledH - btnHeight - (this.WH * 0.03 * this.scale);
            this.closeBtnCustom.size = this.WW * 0.01 * this.scale;
            this.closeBtnCustom.alpha = this.alpha;
            this.closeBtnCustom.radius = 8 * this.scale;
            this.closeBtnCustom.draw();

            // 닫기 버튼 X 아이콘
            const closeBtnX = this.closeBtnCustom.x + btnWidth * 0.18;
            const closeBtnY = this.closeBtnCustom.y + btnHeight / 2;
            const xSize = btnHeight * 0.2;

            render('overlay', {
                shape: 'line',
                x1: closeBtnX - xSize,
                y1: closeBtnY - xSize,
                x2: closeBtnX + xSize,
                y2: closeBtnY + xSize,
                stroke: ColorSchemes.Overlay.Button.Cancel.Text,
                lineWidth: 1.2 * this.scale,
                alpha: this.alpha,
                lineCap: 'round'
            });
            render('overlay', {
                shape: 'line',
                x1: closeBtnX + xSize,
                y1: closeBtnY - xSize,
                x2: closeBtnX - xSize,
                y2: closeBtnY + xSize,
                stroke: ColorSchemes.Overlay.Button.Cancel.Text,
                lineWidth: 1.2 * this.scale,
                alpha: this.alpha,
                lineCap: 'round'
            });
        }
    }

    destroy() {
        if (this.closeBtnCustom) this.closeBtnCustom.destroy();
        for (const btn of this.linkButtons) btn.destroy();
        super.destroy();
    }
}
