import { TitleOverlay } from './_title_overlay.js';
import { getLangString } from 'ui/ui_system.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { LayoutHandler } from 'ui/layout/_layout_handler.js';
import { getData } from 'data/data_handler.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');

/**
 * @class DeckOverlay
 * @description 업적/도감 진행률을 표시하는 덱 오버레이입니다.
 */
export class DeckOverlay extends TitleOverlay {
    constructor(TitleScene) {
        super(TitleScene);

        this.achievementProgress = 0;
        this.encyclopediaProgress = 0;
    }

    /**
         * @override
         * 화면 크기 비율에 맞춰 오버레이 너비/높이를 재지정합니다.
         */
    _onResize() {
        this.width = this.UIWW * TITLE_CONSTANTS.TITLE_OVERLAY.DECK.WIDTH_UIWW_RATIO;
        this.height = this.WH * TITLE_CONSTANTS.TITLE_OVERLAY.DECK.HEIGHT_WH_RATIO;
    }

    /**
         * @override
         * 컬렉션 오버레이 내의 달성도 프로그레스 바 및 텍스트 레이아웃을 생성합니다.
         */
    _generateLayout() {
        this._releaseElements();
        const handler = new LayoutHandler(this, this.positioningHandler).paddingX("WW", 1.8)
            .space("WH", 2.5)
            .item("text", "title_text").stylePreset("h1").text(getLangString('title_deck_title')).fill(ColorSchemes.Title.TextDark)
            .space("WH", 1.5)
            .item("line", "divider_line").width("fill").stroke(ColorSchemes.Overlay.Panel.Divider).lineWidth(1).align("center")
            .space("OH", 6)

            .group().justifyContent("space-evenly", "WW", 2).width("parent", 100).align("center")
            .item("button", "achievement_btn").width("fill").height("OH", 65).prop("text", "").radius("preset", "overlay_panel_radius")
            .buttonColor(ColorSchemes.Overlay.Control).prop("enableHoverGradient", false)
            .childSpace("parent", 20)
            .child("text").text("🏆").prop("font", `${this.UIWW * 0.04 * this.uiScale}px "Pretendard Variable", arial`).align("center").fill(ColorSchemes.Title.TextDark)
            .childSpace("parent", 5)
            .child("text").stylePreset("h3").text(getLangString('title_deck_achievements')).align("center").fill(ColorSchemes.Title.TextDark)
            .childSpace("parent", 25)
            .child("progress_bar").width("parent", 70).height("WH", 0.8).prop("percent", this.achievementProgress).prop("baseColor", ColorSchemes.Overlay.Text.Item).prop("fillColor", ColorSchemes.Cursor.Active).align("center")
            .childSpace("parent", 5)
            .child("text").text(`${this.achievementProgress}%`).stylePreset("h4_bold").align("center").fill(ColorSchemes.Cursor.Active)

            .item("button", "encyclopedia_btn").width("fill").height("OH", 65).prop("text", "").radius("preset", "overlay_panel_radius")
            .buttonColor(ColorSchemes.Overlay.Control).prop("enableHoverGradient", false)
            .childSpace("parent", 20)
            .child("text").text("📖").prop("font", `${this.UIWW * 0.04 * this.uiScale}px "Pretendard Variable", arial`).align("center").fill(ColorSchemes.Title.TextDark)
            .childSpace("parent", 5)
            .child("text").stylePreset("h3").text(getLangString('title_deck_encyclopedia')).align("center").fill(ColorSchemes.Title.TextDark)
            .childSpace("parent", 25)
            .child("progress_bar").width("parent", 70).height("WH", 0.8).prop("percent", this.encyclopediaProgress).prop("baseColor", ColorSchemes.Overlay.Text.Item).prop("fillColor", ColorSchemes.Cursor.Active).align("center")
            .childSpace("parent", 5)
            .child("text").text(`${this.encyclopediaProgress}%`).stylePreset("h4_bold").align("center").fill(ColorSchemes.Cursor.Active)

            .endGroup()

            .bottomSpace("WH", 2.5)
            .bottomItem("button", "close_btn").stylePreset("overlay_interact_button").buttonText(getLangString('title_deck_close'))
            .onClick(this.close.bind(this)).align("right");

        if (getLangString("affirmative_icon") === "check") {
            handler.icon("check").buttonColor(ColorSchemes.Overlay.Button.Confirm)
        } else {
            handler.icon("confirm").buttonColor(ColorSchemes.Overlay.Button.Confirm)
        }

        const buildRes = handler.build();

        this.staticItems = buildRes.staticItems;
        this.dynamicItems = buildRes.dynamicItems;
    }
}
