import { BaseOverlay } from './_base_overlay.js';
import { getLangString } from 'ui/ui_system.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { getSetting } from 'save/save_system.js';
import { LayoutHandler } from 'ui/layout/_layout_handler.js';
import { UI_SPACING } from 'ui/layout/layout_tokens.js';
import { BUTTON_STYLE } from 'ui/style/component_styles.js';
import { TYPOGRAPHY } from 'ui/style/typography.js';
import { applyOverlayConfirmButtonIcon } from './_overlay_confirm_icon.js';
import { EXIT_LAYOUT_CONSTANTS } from './_overlay_layout_constants.js';

/**
 * @class ExitOverlay
 * @description 게임 종료 확인 오버레이입니다.
 */
export class ExitOverlay extends BaseOverlay {
    constructor() {
        super({
            layer: 100,
            dim: 0.28,
            transparent: true,
            blurUpdateMode: 'always'
        });
    }

    /**
     * @override
     * 종료 확인 팝업 크기를 화면 비율에 맞추어 조정합니다.
     */
    _onResize() {
        this.width = this.UIWW * EXIT_LAYOUT_CONSTANTS.WIDTH_UIWW_RATIO;
        this.height = this.WH * EXIT_LAYOUT_CONSTANTS.HEIGHT_WH_RATIO;
    }

    /**
     * @override
     * 종료 의사를 묻는 텍스트와 예/아니오 버튼 레이아웃을 빌드합니다.
     */
    _generateLayout() {
        this._releaseElements();
        const handler = new LayoutHandler(this, this.positioningHandler).paddingX(UI_SPACING.DIALOG_PADDING_X)
            .space(UI_SPACING.OVERLAY_TITLE_TOP)
            .item("text").textStyle(TYPOGRAPHY.H2).text(getLangString('exit_title')).fill(ColorSchemes.Title.TextDark)
            .space(UI_SPACING.DIALOG_BODY_GAP)
            .item("text").textStyle(TYPOGRAPHY.H4).text(getLangString('exit_query')).fill(ColorSchemes.Overlay.Text.Item)
            .bottomSpace(UI_SPACING.OVERLAY_FOOTER_BOTTOM)
            .bottomGroup().justifyContent("right", "WW", 1).align("right");

        if (getSetting('debugMode')) {
            handler.item("button").buttonStyle(BUTTON_STYLE.OVERLAY_INTERACT).buttonText("재시작").onClick(() => { location.reload(); })
                .icon("deny").buttonColor(ColorSchemes.Overlay.Button.Cancel);
        }

        handler.item("button").buttonStyle(BUTTON_STYLE.OVERLAY_INTERACT).buttonText(getLangString("exit_no")).onClick(this.close.bind(this))
            .icon("deny").buttonColor(ColorSchemes.Overlay.Button.Cancel)

            .item("button").buttonStyle(BUTTON_STYLE.OVERLAY_INTERACT).buttonText(getLangString("exit_yes")).onClick(() => { Game.close(); });

        applyOverlayConfirmButtonIcon(handler);

        handler.endGroup();
        const buildRes = handler.build();

        this.dynamicItems = buildRes.dynamicItems;
        this.staticItems = buildRes.staticItems;
    }
}
