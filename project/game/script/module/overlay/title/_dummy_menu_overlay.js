import { ColorSchemes } from 'display/_theme_handler.js';
import { getData } from 'data/data_handler.js';
import { LayoutHandler } from 'ui/layout/_layout_handler.js';
import { getLangString } from 'ui/ui_system.js';
import { TitleOverlay } from './_title_overlay.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');

/**
 * @class DummyMenuOverlay
 * @description 카드 메뉴용 더미 overlay의 공통 베이스 클래스입니다.
 */
export class DummyMenuOverlay extends TitleOverlay {
    /**
     * @param {TitleScene} titleScene - 타이틀 씬 인스턴스입니다.
     * @param {object} [options={}] - 더미 overlay 옵션입니다.
     */
    constructor(titleScene, options = {}) {
        super(titleScene, options.overlayOptions || {});

        this.titleKey = options.titleKey || 'title_card_dummy_status';
        this.bodyKey = options.bodyKey || 'title_card_dummy_status';
        this.closeKey = options.closeKey || 'title_menu_close';
        this.widthRatio = Number.isFinite(options.widthRatio) ? options.widthRatio : TITLE_CONSTANTS.TITLE_OVERLAY.CREDITS.WIDTH_UIWW_RATIO;
        this.heightRatio = Number.isFinite(options.heightRatio) ? options.heightRatio : TITLE_CONSTANTS.TITLE_OVERLAY.CREDITS.HEIGHT_WH_RATIO;
    }

    /**
     * @override
     * overlay 크기를 현재 화면 비율에 맞게 갱신합니다.
     */
    _onResize() {
        this.width = this.UIWW * this.widthRatio;
        this.height = this.WH * this.heightRatio;
    }

    /**
     * @override
     * 더미 overlay 레이아웃을 생성합니다.
     */
    _generateLayout() {
        this._releaseElements();
        const handler = new LayoutHandler(this, this.positioningHandler)
            .paddingX('WW', 1.8)
            .space('WH', 2.4)
            .item('text', 'dummy_overlay_title')
            .stylePreset('h1')
            .text(getLangString(this.titleKey))
            .fill(ColorSchemes.Title.TextDark)
            .space('WH', 1.2)
            .item('line', 'dummy_overlay_divider')
            .width('fill')
            .stroke(ColorSchemes.Overlay.Panel.Divider)
            .lineWidth(1)
            .align('center')
            .space('WH', 2.2)
            .item('text', 'dummy_overlay_status')
            .stylePreset('h3')
            .text(getLangString('title_card_dummy_status'))
            .fill(ColorSchemes.Cursor.Active)
            .space('WH', 1.2)
            .item('text', 'dummy_overlay_body')
            .stylePreset('h5')
            .text(getLangString(this.bodyKey))
            .fill(ColorSchemes.Overlay.Text.Item)
            .bottomSpace('WH', 2.5)
            .bottomItem('button', 'dummy_overlay_close')
            .stylePreset('overlay_interact_button')
            .buttonText(getLangString(this.closeKey))
            .onClick(this.close.bind(this))
            .align('right');

        if (getLangString('affirmative_icon') === 'check') {
            handler.icon('check').buttonColor(ColorSchemes.Overlay.Button.Confirm);
        } else {
            handler.icon('confirm').buttonColor(ColorSchemes.Overlay.Button.Confirm);
        }

        const buildResult = handler.build();
        this.staticItems = buildResult.staticItems;
        this.dynamicItems = buildResult.dynamicItems;
    }
}
