import { TitleOverlay } from './title_overlay.js';
import { getLangString } from 'ui/_ui_system.js';
import { ColorSchemes } from 'display/theme_handler.js';
import { LayoutHandler } from 'ui/layout_handler.js';

export class CollectionOverlay extends TitleOverlay {
    constructor(TitleScene) {
        super(TitleScene);

        this.width = this.WW * 0.65;
        this.height = this.WH * 0.7;
        this._calculateGeometry();

        this.achievementProgress = 0;
        this.encyclopediaProgress = 0;

        this._generateLayout();
        this.open();
    }

    _generateLayout() {
        const handler = new LayoutHandler(this).horMargin("WW", 1.8)
            .item("margin").value("WH", 2.5)
            .item("text", "title_text").stylePreset("h1").text(getLangString('title_collection_title')).prop("fill", ColorSchemes.Title.TextDark)
            .item("margin").value("WH", 1.5)
            .item("line", "divider_line").width("parent", 100).prop("stroke", ColorSchemes.Overlay.Panel.Divider).prop("lineWidth", 1).align("center")
            .item("margin").value("OH", 6)

            .newItemGroup().justifyContent("space_evenly", "WW", 2).width("parent", 100).align("center")
            .groupItem("button", "achievement_btn").width("auto").height("OH", 65).prop("text", "").radius("preset", "overlay_panel_radius")
            .buttonColor(ColorSchemes.Overlay.Control).prop("enableHoverGradient", false)
            .innerItem("margin").value("parent", 20)
            .innerItem("text").text("🏆").prop("font", `${this.WW * 0.04 * this.uiScale}px "Pretendard Variable", arial`).align("center").prop("align", "center").prop("fill", ColorSchemes.Title.TextDark)
            .innerItem("margin").value("parent", 5)
            .innerItem("text").stylePreset("h3").text(getLangString('title_collection_achievements')).align("center").prop("align", "center").prop("fill", ColorSchemes.Title.TextDark)
            .innerItem("margin").value("parent", 25)
            .innerItem("progress_bar").width("parent", 70).height("WH", 0.8).prop("percent", this.achievementProgress).prop("baseColor", ColorSchemes.Overlay.Text.Item).prop("fillColor", ColorSchemes.Cursor.Active).align("center")
            .innerItem("margin").value("parent", 5)
            .innerItem("text").text(`${this.achievementProgress}%`).stylePreset("h4_bold").align("center").prop("align", "center").prop("fill", ColorSchemes.Cursor.Active)

            .groupItem("button", "encyclopedia_btn").width("auto").height("OH", 65).prop("text", "").radius("preset", "overlay_panel_radius")
            .buttonColor(ColorSchemes.Overlay.Control).prop("enableHoverGradient", false)
            .innerItem("margin").value("parent", 20)
            .innerItem("text").text("📖").prop("font", `${this.WW * 0.04 * this.uiScale}px "Pretendard Variable", arial`).align("center").prop("align", "center").prop("fill", ColorSchemes.Title.TextDark)
            .innerItem("margin").value("parent", 5)
            .innerItem("text").stylePreset("h3").text(getLangString('title_collection_encyclopedia')).align("center").prop("align", "center").prop("fill", ColorSchemes.Title.TextDark)
            .innerItem("margin").value("parent", 25)
            .innerItem("progress_bar").width("parent", 70).height("WH", 0.8).prop("percent", this.encyclopediaProgress).prop("baseColor", ColorSchemes.Overlay.Text.Item).prop("fillColor", ColorSchemes.Cursor.Active).align("center")
            .innerItem("margin").value("parent", 5)
            .innerItem("text").text(`${this.encyclopediaProgress}%`).stylePreset("h4_bold").align("center").prop("align", "center").prop("fill", ColorSchemes.Cursor.Active)

            .closeGroup()

            .bottomItem("margin").value("WH", 2.5)
            .bottomItem("button", "close_btn").stylePreset("overlay_interact_button").buttonText(getLangString('title_collection_close'))
            .onClick(this.close.bind(this)).align("right");

        if (getLangString("affirmative_icon") === "check") {
            handler.prop("iconType", "check").buttonColor(ColorSchemes.Overlay.Button.Confirm)
        } else {
            handler.prop("iconType", "confirm").buttonColor(ColorSchemes.Overlay.Button.Confirm)
        }

        const buildRes = handler.build();

        this.staticItems = buildRes.staticItems;
        this.dynamicItems = buildRes.dynamicItems;
    }
}
