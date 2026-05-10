import { BaseOverlay } from './_base_overlay.js';
import { getLangString } from 'ui/ui_system.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { getSetting } from 'save/save_system.js';
import { LayoutHandler } from 'ui/layout/_layout_handler.js';
import { getData } from 'data/data_handler.js';
import { applyOverlayConfirmButtonIcon } from './_overlay_confirm_icon.js';

const OVERLAY_LAYOUT_CONSTANTS = getData('OVERLAY_LAYOUT_CONSTANTS');
const EXIT_LAYOUT_CONSTANTS = OVERLAY_LAYOUT_CONSTANTS.EXIT;

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
        const handler = new LayoutHandler(this, this.positioningHandler).paddingX("WW", 1.5)
            .space("WH", 2.5)
            .item("text").stylePreset("h2").text(getLangString('exit_title')).fill(ColorSchemes.Title.TextDark)
            .space("WH", 1.4)
            .item("text").stylePreset("h4").text(getLangString('exit_query')).fill(ColorSchemes.Overlay.Text.Item)
            .bottomSpace("WH", 2.5)
            .bottomGroup().justifyContent("right", "WW", 1).align("right");

        if (getSetting('debugMode')) {
            handler.item("button").stylePreset("overlay_interact_button").buttonText("재시작").onClick(() => { location.reload(); })
                .icon("deny").buttonColor(ColorSchemes.Overlay.Button.Cancel);
        }

        handler.item("button").stylePreset("overlay_interact_button").buttonText(getLangString("exit_no")).onClick(this.close.bind(this))
            .icon("deny").buttonColor(ColorSchemes.Overlay.Button.Cancel)

            .item("button").stylePreset("overlay_interact_button").buttonText(getLangString("exit_yes")).onClick(() => { Game.close(); });

        applyOverlayConfirmButtonIcon(handler);

        handler.endGroup();
        const buildRes = handler.build();

        this.dynamicItems = buildRes.dynamicItems;
        this.staticItems = buildRes.staticItems;
    }
}
