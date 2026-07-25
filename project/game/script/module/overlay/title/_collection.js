import { TitleOverlay } from './_title_overlay.js';
import { getLangString } from 'ui/ui_system.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { LayoutHandler } from 'ui/layout/_layout_handler.js';
import { UI_RADIUS } from 'ui/layout/layout_tokens.js';
import { TYPOGRAPHY } from 'ui/style/typography.js';
import { applyOverlayConfirmButtonIcon } from '../_overlay_confirm_icon.js';
import {
    addOverlayCloseFooter,
    addOverlayPageHeader
} from '../_overlay_layout_recipes.js';

const COLLECTION_OVERLAY_LAYOUT = Object.freeze({
    WIDTH_UIWW_RATIO: 0.65,
    HEIGHT_WH_RATIO: 0.7
});

/**
 * @class CollectionOverlay
 * @description 업적/도감 진행률을 표시하는 컬렉션 오버레이입니다.
 */
export class CollectionOverlay extends TitleOverlay {
    constructor(TitleScene) {
        super(TitleScene);

        this._onResize();
        this._calculateGeometry();

        this.achievementProgress = 0;
        this.encyclopediaProgress = 0;

        this._generateLayout();
    }

    /**
     * @override
     * 화면 크기 비율에 맞춰 오버레이 너비/높이를 재지정합니다.
     */
    _onResize() {
        this.width = this.UIWW * COLLECTION_OVERLAY_LAYOUT.WIDTH_UIWW_RATIO;
        this.height = this.WH * COLLECTION_OVERLAY_LAYOUT.HEIGHT_WH_RATIO;
    }

    /**
     * @override
     * 컬렉션 오버레이 내의 달성도 프로그레스 바 및 텍스트 레이아웃을 생성합니다.
     */
    _generateLayout() {
        this._releaseElements();
        const handler = addOverlayPageHeader(
            new LayoutHandler(this, this.positioningHandler),
            { title: getLangString('title_collection_title') }
        ).space("OH", 6)

            .group().justifyContent("space-evenly", "WW", 2).width("parent", 100).align("center")
            .item("button", "achievement_btn").width("fill").height("OH", 65).prop("text", "").radius(UI_RADIUS.OVERLAY_PANEL)
            .buttonColor(ColorSchemes.Overlay.Control).prop("enableHoverGradient", false)
            .childSpace("parent", 20)
            .child("text").text("🏆").textStyle(TYPOGRAPHY.DISPLAY_ICON).align("center").fill(ColorSchemes.Title.TextDark)
            .childSpace("parent", 5)
            .child("text").textStyle(TYPOGRAPHY.H3).text(getLangString('title_collection_achievements')).align("center").fill(ColorSchemes.Title.TextDark)
            .childSpace("parent", 25)
            .child("progress_bar").width("parent", 70).height("WH", 0.8).prop("percent", this.achievementProgress).prop("baseColor", ColorSchemes.Overlay.Text.Item).prop("fillColor", ColorSchemes.Cursor.Active).align("center")
            .childSpace("parent", 5)
            .child("text").text(`${this.achievementProgress}%`).textStyle(TYPOGRAPHY.PROGRESS_VALUE).align("center").fill(ColorSchemes.Cursor.Active)

            .item("button", "encyclopedia_btn").width("fill").height("OH", 65).prop("text", "").radius(UI_RADIUS.OVERLAY_PANEL)
            .buttonColor(ColorSchemes.Overlay.Control).prop("enableHoverGradient", false)
            .childSpace("parent", 20)
            .child("text").text("📖").textStyle(TYPOGRAPHY.DISPLAY_ICON).align("center").fill(ColorSchemes.Title.TextDark)
            .childSpace("parent", 5)
            .child("text").textStyle(TYPOGRAPHY.H3).text(getLangString('title_collection_encyclopedia')).align("center").fill(ColorSchemes.Title.TextDark)
            .childSpace("parent", 25)
            .child("progress_bar").width("parent", 70).height("WH", 0.8).prop("percent", this.encyclopediaProgress).prop("baseColor", ColorSchemes.Overlay.Text.Item).prop("fillColor", ColorSchemes.Cursor.Active).align("center")
            .childSpace("parent", 5)
            .child("text").text(`${this.encyclopediaProgress}%`).textStyle(TYPOGRAPHY.PROGRESS_VALUE).align("center").fill(ColorSchemes.Cursor.Active)

            .endGroup();

        addOverlayCloseFooter(handler, {
            id: 'close_btn',
            text: getLangString('title_collection_close'),
            onClick: this.close.bind(this)
        });
        applyOverlayConfirmButtonIcon(handler);

        const buildRes = handler.build();

        this.staticItems = buildRes.staticItems;
        this.dynamicItems = buildRes.dynamicItems;
    }
}
