import { TitleOverlay } from './_title_overlay.js';
import { getLangString } from 'ui/ui_system.js';
import { runtimeTool } from 'util/runtime_tool.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { LayoutHandler } from 'ui/layout/_layout_handler.js';
import { getData } from 'data/data_handler.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');

/**
 * @class CreditsOverlay
 * @description 타이틀 화면의 크레딧 오버레이를 구성합니다.
 */
export class CreditsOverlay extends TitleOverlay {
    constructor(TitleScene) {
        super(TitleScene, { titleIconId: 'credits' });
    }

    /**
         * @override
         * 크레딧 팝업 지정 비율에 따라 크기를 갱신합니다.
         */
    _onResize() {
        this.width = this.UIWW * TITLE_CONSTANTS.TITLE_OVERLAY.CREDITS.WIDTH_UIWW_RATIO;
        this.height = this.WH * TITLE_CONSTANTS.TITLE_OVERLAY.CREDITS.HEIGHT_WH_RATIO;
    }

    /**
         * @override
         * 만든 이, 제작 에셋 등 텍스트 노드가 포함된 레이아웃을 구성합니다.
         */
    _generateLayout() {
        this._releaseElements();
        const handler = new LayoutHandler(this, this.positioningHandler).paddingX("WW", 1.8)
            .space("WH", 2.5)
            .item("text", "title_text").stylePreset("h1").text(getLangString('title_credits_title')).fill(ColorSchemes.Title.TextDark)
            .space("WH", 1.5)
            .item("line", "divider_line").width("fill").stroke(ColorSchemes.Overlay.Panel.Divider).lineWidth(1).align("center")
            .space("OH", 6)

        // 소제목 - 제작
        handler.group().justifyContent("space-between", "WW", 1).width("parent", 100).align("center")
            .item("text").text(getLangString('title_credits_section_dev')).stylePreset("h3").fill(ColorSchemes.Overlay.Text.Section).vAlign("center")
            .item("line").width("fill").stroke(ColorSchemes.Overlay.Panel.Divider).lineWidth(1).vAlign("center")
            .endGroup()
            .space("OH", 4);

        // 제작자
        handler.group().justifyContent("space-between", "WW", 1).width("parent", 95).align("center")
            .item("text").text(getLangString('title_credits_dev_name')).stylePreset("h4").fill(ColorSchemes.Overlay.Text.Item).vAlign("center")
            .spacer()
            .group().justifyContent("space-between", "WW", 1).vAlign("center")
            .item("button", `btn_0`).stylePreset("overlay_link_button").buttonText(getLangString('title_credits_link_blog'))
            .onClick(() => runtimeTool().openURL('https://jukchang.com')).align("right").vAlign("center")
            .buttonColor(ColorSchemes.Overlay.Button.Link).icon("arrow")
            .item("button", `btn_1`).stylePreset("overlay_link_button").buttonText(getLangString('title_credits_link_github'))
            .onClick(() => runtimeTool().openURL('https://github.com/Querido-Fue/CirVivor')).align("right").vAlign("center")
            .buttonColor(ColorSchemes.Overlay.Button.Link).icon("arrow")
            .endGroup()
            .endGroup()
            .space("OH", 8);

        // 소제목 - 사용 소재
        handler.group().justifyContent("space-between", "WW", 1).width("parent", 100).align("center")
            .item("text").text(getLangString('title_credits_section_assets')).stylePreset("h3").fill(ColorSchemes.Overlay.Text.Section).vAlign("center")
            .item("line").width("fill").stroke(ColorSchemes.Overlay.Panel.Divider).lineWidth(1).vAlign("center")
            .endGroup()
            .space("OH", 4);

        handler.group().justifyContent("space-between", "WW", 1).width("parent", 95).align("center")
            .item("text").text('pretendard').stylePreset("h4").fill(ColorSchemes.Overlay.Text.Item).vAlign("center")
            .spacer()
            .item("button", `btn_2`).stylePreset("overlay_link_button").buttonText(getLangString('title_credits_link_github'))
            .onClick(() => runtimeTool().openURL('https://github.com/orioncactus/pretendard')).align("right").vAlign("center")
            .buttonColor(ColorSchemes.Overlay.Button.Link).icon("arrow")
            .endGroup()
            .space("OH", 3);

        handler.group().justifyContent("space-between", "WW", 1).width("parent", 95).align("center")
            .item("text").text('outfit').stylePreset("h4").fill(ColorSchemes.Overlay.Text.Item).vAlign("center")
            .spacer()
            .item("button", `btn_3`).stylePreset("overlay_link_button").buttonText(getLangString('title_credits_link_github'))
            .onClick(() => runtimeTool().openURL('https://github.com/Outfitio/Outfit-Fonts/tree/main')).align("right").vAlign("center")
            .buttonColor(ColorSchemes.Overlay.Button.Link).icon("arrow")
            .endGroup()
            .space("OH", 3);

        handler.group().justifyContent("space-between", "WW", 1).width("parent", 95).align("center")
            .item("text").text('react bits').stylePreset("h4").fill(ColorSchemes.Overlay.Text.Item).vAlign("center")
            .spacer()
            .item("button", `btn_3`).stylePreset("overlay_link_button").buttonText(getLangString('title_credits_link_github'))
            .onClick(() => runtimeTool().openURL('https://github.com/DavidHDev/react-bits')).align("right").vAlign("center")
            .buttonColor(ColorSchemes.Overlay.Button.Link).icon("arrow")
            .endGroup()
            .space("OH", 3);

        handler.bottomSpace("WH", 2.5)
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
