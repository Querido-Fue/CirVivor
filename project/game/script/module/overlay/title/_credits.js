import { TitleOverlay } from './_title_overlay.js';
import { getLangString } from 'ui/ui_system.js';
import { runtimeTool } from 'util/runtime_tool.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { LayoutHandler } from 'ui/_layout_handler.js';

/**
 * @class CreditsOverlay
 * @description 타이틀 화면의 크레딧 오버레이를 구성합니다.
 */
export class CreditsOverlay extends TitleOverlay {
    constructor(TitleScene) {
        super(TitleScene);

        this._onResize();
        this._calculateGeometry();

        this._generateLayout();
    }

    _onResize() {
        this.width = this.UIWW * 0.4;
        this.height = this.WH * 0.55;
    }

    _generateLayout() {
        this._releaseElements();
        const handler = new LayoutHandler(this, this.positioningHandler).horMargin("WW", 1.8)
            .item("margin").value("WH", 2.5)
            .item("text", "title_text").stylePreset("h1").text(getLangString('title_credits_title')).prop("fill", ColorSchemes.Title.TextDark)
            .item("margin").value("WH", 1.5)
            .item("line", "divider_line").width("parent", 100).prop("stroke", ColorSchemes.Overlay.Panel.Divider).prop("lineWidth", 1).align("center")
            .item("margin").value("OH", 6)

        // 소제목 - 제작
        handler.newItemGroup().justifyContent("space_between", "WW", 1).width("parent", 100).align("center")
            .groupItem("text").text(getLangString('title_credits_section_dev')).stylePreset("h3").prop("fill", ColorSchemes.Overlay.Text.Section).vAlign("center")
            .groupItem("line").width("auto").prop("stroke", ColorSchemes.Overlay.Panel.Divider).prop("lineWidth", 1).vAlign("center")
            .closeGroup()
            .item("margin").value("OH", 4);

        // 제작자
        handler.newItemGroup().justifyContent("space_between", "WW", 1).width("parent", 95).align("center")
            .groupItem("text").text(getLangString('title_credits_dev_name')).stylePreset("h4").prop("fill", ColorSchemes.Overlay.Text.Item).vAlign("center")
            .groupItem("horMargin").value("expand") // 여백 확장
            .groupItemGroup().justifyContent("space_between", "WW", 1).vAlign("center")
            .groupItem("button", `btn_0`).stylePreset("overlay_link_button").buttonText(getLangString('title_credits_link_blog'))
            .onClick(() => runtimeTool().openURL('https://jukchang.com')).align("right").vAlign("center")
            .buttonColor(ColorSchemes.Overlay.Button.Link).prop("iconType", "arrow")
            .groupItem("button", `btn_1`).stylePreset("overlay_link_button").buttonText(getLangString('title_credits_link_github'))
            .onClick(() => runtimeTool().openURL('https://github.com/Querido-Fue/CirVivor')).align("right").vAlign("center")
            .buttonColor(ColorSchemes.Overlay.Button.Link).prop("iconType", "arrow")
            .closeGroup()
            .closeGroup()
            .item("margin").value("OH", 8);

        // 소제목 - 사용 소재
        handler.newItemGroup().justifyContent("space_between", "WW", 1).width("parent", 100).align("center")
            .groupItem("text").text(getLangString('title_credits_section_assets')).stylePreset("h3").prop("fill", ColorSchemes.Overlay.Text.Section).vAlign("center")
            .groupItem("line").width("auto").prop("stroke", ColorSchemes.Overlay.Panel.Divider).prop("lineWidth", 1).vAlign("center")
            .closeGroup()
            .item("margin").value("OH", 4);

        handler.newItemGroup().justifyContent("space_between", "WW", 1).width("parent", 95).align("center")
            .groupItem("text").text('pretendard').stylePreset("h4").prop("fill", ColorSchemes.Overlay.Text.Item).vAlign("center")
            .groupItem("horMargin").value("expand") // 여백 확장
            .groupItem("button", `btn_2`).stylePreset("overlay_link_button").buttonText(getLangString('title_credits_link_github'))
            .onClick(() => runtimeTool().openURL('https://github.com/orioncactus/pretendard')).align("right").vAlign("center")
            .buttonColor(ColorSchemes.Overlay.Button.Link).prop("iconType", "arrow")
            .closeGroup()
            .item("margin").value("OH", 3);

        handler.newItemGroup().justifyContent("space_between", "WW", 1).width("parent", 95).align("center")
            .groupItem("text").text('react bits').stylePreset("h4").prop("fill", ColorSchemes.Overlay.Text.Item).vAlign("center")
            .groupItem("horMargin").value("expand") // 여백 확장
            .groupItem("button", `btn_3`).stylePreset("overlay_link_button").buttonText(getLangString('title_credits_link_github'))
            .onClick(() => runtimeTool().openURL('https://github.com/DavidHDev/react-bits')).align("right").vAlign("center")
            .buttonColor(ColorSchemes.Overlay.Button.Link).prop("iconType", "arrow")
            .closeGroup()
            .item("margin").value("OH", 3);

        handler.bottomItem("margin").value("WH", 2.5)
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
