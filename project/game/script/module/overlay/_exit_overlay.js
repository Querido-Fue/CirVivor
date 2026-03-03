import { BaseOverlay } from './_base_overlay.js';
import { getLangString } from 'ui/ui_system.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { getSetting } from 'save/save_system.js';
import { LayoutHandler } from 'ui/_layout_handler.js';

/**
 * @class ExitOverlay
 * @description 게임 종료 확인 오버레이입니다.
 */
export class ExitOverlay extends BaseOverlay {
    constructor() {
        super('popup');
        this._onResize();
        this._calculateGeometry();

        this._generateLayout();
    }

    _onResize() {
        this.width = this.UIWW * 0.3;
        this.height = this.WH * 0.2;
    }

    _generateLayout() {
        this._releaseElements();
        const handler = new LayoutHandler(this, this.positioningHandler).horMargin("WW", 1.5)
            .item("margin").value("WH", 2.5)
            .item("text").stylePreset("h2").text(getLangString('exit_title')).prop("fill", ColorSchemes.Title.TextDark)
            .item("margin").value("WH", 1.2)
            .item("text").stylePreset("h4").text(getLangString('exit_query')).prop("fill", ColorSchemes.Overlay.Text.Item)
            .bottomItem("margin").value("WH", 2.5)
            .bottomItemGroup().justifyContent("right", "WW", 1).align("right");

        if (getSetting('debugMode')) {
            handler.groupItem("button").stylePreset("overlay_interact_button").buttonText("재시작").onClick(() => { location.reload(); })
                .prop("iconType", "deny").buttonColor(ColorSchemes.Overlay.Button.Cancel);
        }

        handler.groupItem("button").stylePreset("overlay_interact_button").buttonText(getLangString("exit_no")).onClick(this.close.bind(this))
            .prop("iconType", "deny").buttonColor(ColorSchemes.Overlay.Button.Cancel)

            .groupItem("button").stylePreset("overlay_interact_button").buttonText(getLangString("exit_yes")).onClick(() => { Game.close(); });

        if (getLangString("affirmative_icon") === "check") {
            handler.prop("iconType", "check").buttonColor(ColorSchemes.Overlay.Button.Confirm)
        } else {
            handler.prop("iconType", "confirm").buttonColor(ColorSchemes.Overlay.Button.Confirm)
        }

        handler.closeGroup();
        const buildRes = handler.build();

        this.dynamicItems = buildRes.dynamicItems;
        this.staticItems = buildRes.staticItems;
    }
}
