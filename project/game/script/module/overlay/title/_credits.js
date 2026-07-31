import { TitleOverlay } from './_title_overlay.js';
import { getLangString } from 'ui/ui_system.js';
import { runtimeTool } from 'util/runtime_tool.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { LayoutHandler } from 'ui/layout/_layout_handler.js';
import { BUTTON_STYLE } from 'ui/style/component_styles.js';
import { TYPOGRAPHY } from 'ui/style/typography.js';
import { applyOverlayConfirmButtonIcon } from '../_overlay_confirm_icon.js';
import {
    addOverlayCloseFooter,
    addOverlayPageHeader
} from '../_overlay_layout_recipes.js';

const CREDITS_OVERLAY_LAYOUT = Object.freeze({
    WIDTH_UIWW_RATIO: 0.4,
    HEIGHT_WH_RATIO: 0.55
});

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
        this.width = this.UIWW * CREDITS_OVERLAY_LAYOUT.WIDTH_UIWW_RATIO;
        this.height = this.WH * CREDITS_OVERLAY_LAYOUT.HEIGHT_WH_RATIO;
    }

    /**
     * @override
     * 만든 이, 제작 에셋 등 텍스트 노드가 포함된 레이아웃을 구성합니다.
     */
    _generateLayout() {
        this._releaseElements();
        const handler = addOverlayPageHeader(
            new LayoutHandler(this, this.positioningHandler),
            { title: getLangString('title_credits_title') }
        ).space("OH", 6);

        // 소제목 - 제작
        handler.group().justifyContent("space-between", "WW", 1).width("parent", 100).align("center")
            .item("text").text(getLangString('title_credits_section_dev')).textStyle(TYPOGRAPHY.H3).fill(ColorSchemes.Overlay.Text.Section).vAlign("center")
            .item("line").width("fill").stroke(ColorSchemes.Overlay.Panel.Divider).lineWidth(1).vAlign("center")
            .endGroup()
            .space("OH", 4);

        // 제작자
        handler.group().justifyContent("space-between", "WW", 1).width("parent", 95).align("center")
            .item("text").text(getLangString('title_credits_dev_name')).textStyle(TYPOGRAPHY.H4).fill(ColorSchemes.Overlay.Text.Item).vAlign("center")
            .spacer()
            .group().justifyContent("space-between", "WW", 1).vAlign("center")
            .item("button", `btn_0`).buttonStyle(BUTTON_STYLE.OVERLAY_LINK).buttonText(getLangString('title_credits_link_blog'))
            .onClick(() => runtimeTool().openURL('https://jukchang.com')).align("right").vAlign("center")
            .buttonColor(ColorSchemes.Overlay.Button.Link).icon("arrow")
            .item("button", `btn_1`).buttonStyle(BUTTON_STYLE.OVERLAY_LINK).buttonText(getLangString('title_credits_link_github'))
            .onClick(() => runtimeTool().openURL('https://github.com/Querido-Fue/CirVivor')).align("right").vAlign("center")
            .buttonColor(ColorSchemes.Overlay.Button.Link).icon("arrow")
            .endGroup()
            .endGroup()
            .space("OH", 8);

        // 소제목 - 사용 소재
        handler.group().justifyContent("space-between", "WW", 1).width("parent", 100).align("center")
            .item("text").text(getLangString('title_credits_section_assets')).textStyle(TYPOGRAPHY.H3).fill(ColorSchemes.Overlay.Text.Section).vAlign("center")
            .item("line").width("fill").stroke(ColorSchemes.Overlay.Panel.Divider).lineWidth(1).vAlign("center")
            .endGroup()
            .space("OH", 4);

        handler.group().justifyContent("space-between", "WW", 1).width("parent", 95).align("center")
            .item("text").text('SUIT Variable').textStyle(TYPOGRAPHY.H4).fill(ColorSchemes.Overlay.Text.Item).vAlign("center")
            .spacer()
            .item("button", `btn_2`).buttonStyle(BUTTON_STYLE.OVERLAY_LINK).buttonText(getLangString('title_credits_link_github'))
            .onClick(() => runtimeTool().openURL('https://github.com/sun-typeface/SUIT')).align("right").vAlign("center")
            .buttonColor(ColorSchemes.Overlay.Button.Link).icon("arrow")
            .endGroup()
            .space("OH", 3);

        handler.group().justifyContent("space-between", "WW", 1).width("parent", 95).align("center")
            .item("text").text('outfit').textStyle(TYPOGRAPHY.H4).fill(ColorSchemes.Overlay.Text.Item).vAlign("center")
            .spacer()
            .item("button", `btn_3`).buttonStyle(BUTTON_STYLE.OVERLAY_LINK).buttonText(getLangString('title_credits_link_github'))
            .onClick(() => runtimeTool().openURL('https://github.com/Outfitio/Outfit-Fonts/tree/main')).align("right").vAlign("center")
            .buttonColor(ColorSchemes.Overlay.Button.Link).icon("arrow")
            .endGroup()
            .space("OH", 3);

        handler.group().justifyContent("space-between", "WW", 1).width("parent", 95).align("center")
            .item("text").text('react bits').textStyle(TYPOGRAPHY.H4).fill(ColorSchemes.Overlay.Text.Item).vAlign("center")
            .spacer()
            .item("button", `btn_4`).buttonStyle(BUTTON_STYLE.OVERLAY_LINK).buttonText(getLangString('title_credits_link_github'))
            .onClick(() => runtimeTool().openURL('https://github.com/DavidHDev/react-bits')).align("right").vAlign("center")
            .buttonColor(ColorSchemes.Overlay.Button.Link).icon("arrow")
            .endGroup()
            .space("OH", 3);

        addOverlayCloseFooter(handler, {
            id: 'close_btn',
            text: getLangString('title_credits_close'),
            onClick: this.close.bind(this)
        });
        applyOverlayConfirmButtonIcon(handler);

        const buildRes = handler.build();

        this.staticItems = buildRes.staticItems;
        this.dynamicItems = buildRes.dynamicItems;
    }
}
