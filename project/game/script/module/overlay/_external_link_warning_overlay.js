import { BaseOverlay } from './_base_overlay.js';
import { getLangString } from 'ui/ui_system.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { LayoutHandler } from 'ui/layout/_layout_handler.js';
import { runtimeTool } from 'util/runtime_tool.js';
import { getData } from 'data/data_handler.js';

const OVERLAY_LAYOUT_CONSTANTS = getData('OVERLAY_LAYOUT_CONSTANTS');
const TEXT_CONSTANTS = getData('TEXT_CONSTANTS');
const EXTERNAL_LINK_DISPLAY_MAX_LENGTH = 55;
const EXTERNAL_LINK_WARNING_HEIGHT_MULTIPLIER = 1.15;
const TRANSPARENT_COLOR = 'rgba(0, 0, 0, 0)';

/**
 * @class ExternalLinkWarningOverlay
 * @description 외부 링크 열기 전에 사용자 확인을 요청하는 오버레이입니다.
 */
export class ExternalLinkWarningOverlay extends BaseOverlay {
    /**
     * @param {string} url - 열기 확인 대상 URL입니다.
     */
    constructor(url) {
        super({
            layer: 15,
            dim: 0.28,
            transparent: true,
            blurUpdateMode: 'always'
        });

        this.url = typeof url === 'string' ? url.trim() : '';
    }

    /**
     * @override
     * 경고 팝업 크기를 화면 비율에 맞추어 조정합니다.
     */
    _onResize() {
        this.width = this.UIWW * OVERLAY_LAYOUT_CONSTANTS.EXIT.WIDTH_UIWW_RATIO;
        this.height = this.WH * OVERLAY_LAYOUT_CONSTANTS.EXIT.HEIGHT_WH_RATIO * EXTERNAL_LINK_WARNING_HEIGHT_MULTIPLIER;
    }

    /**
     * 표시용 링크 주소를 생성합니다.
     * @returns {string} 경고 문구에 사용할 축약된 링크 주소입니다.
     */
    _getDisplayURL() {
        const displaySource = this._getDisplayURLSource();
        if (displaySource.length <= EXTERNAL_LINK_DISPLAY_MAX_LENGTH) {
            return displaySource;
        }

        return `${displaySource.slice(0, EXTERNAL_LINK_DISPLAY_MAX_LENGTH)}...`;
    }

    /**
     * 표시용 링크 주소 원본을 정규화합니다.
     * @returns {string} 프로토콜을 제거한 표시용 주소입니다.
     */
    _getDisplayURLSource() {
        if (!this.url) {
            return '';
        }

        try {
            const parsedURL = new URL(this.url);
            const path = `${parsedURL.pathname}${parsedURL.search}${parsedURL.hash}`;
            const normalizedPath = path === '/' ? '' : path;
            return `${parsedURL.host}${normalizedPath}`;
        } catch {
            return this.url
                .replace(/^https?:\/\//i, '')
                .replace(/\/$/, '');
        }
    }

    /**
     * 링크 미리보기 버튼용 글꼴 크기를 반환합니다.
     * @returns {number} 버튼 텍스트 글꼴 크기입니다.
     */
    _getLinkPreviewFontSize() {
        return this.positioningHandler.parseUIData(TEXT_CONSTANTS.H5.FONT.SIZE, this.uiScale);
    }

    /**
     * 외부 링크 열기를 확정합니다.
     */
    _handleConfirm() {
        runtimeTool()?._openURLDirect?.(this.url);
        this.close();
    }

    /**
     * @override
     * 경고 제목, 본문, 확인/취소 버튼 레이아웃을 생성합니다.
     */
    _generateLayout() {
        this._releaseElements();
        const linkPreviewFontSize = this._getLinkPreviewFontSize();
        const handler = new LayoutHandler(this, this.positioningHandler).paddingX("WW", 1.5)
            .space("WH", 2.5)
            .item("text").stylePreset("h2").text(getLangString('external_link_warning_title')).fill(ColorSchemes.Title.TextDark)
            .space("WH", 1.4)
            .item("text").stylePreset("h4").text(getLangString('external_link_warning_body')).fill(ColorSchemes.Overlay.Text.Item)
            .space("WH", 0.8)
            .item("button", "external_link_preview")
            .width("content")
            .height("WH", 2.2)
            .buttonText(this._getDisplayURL())
            .buttonColor(TRANSPARENT_COLOR, TRANSPARENT_COLOR, ColorSchemes.Overlay.Text.Item)
            .prop("font", TEXT_CONSTANTS.H5_BOLD.FONT.FAMILY)
            .prop("fontWeight", TEXT_CONSTANTS.H5_BOLD.FONT.WEIGHT)
            .prop("size", linkPreviewFontSize)
            .prop("margin", 0)
            .prop("radius", 0)
            .onHover(() => { })
            .bottomSpace("WH", 2.5)
            .bottomGroup().justifyContent("right", "WW", 1).align("right");

        handler.item("button").stylePreset("overlay_interact_button").buttonText(getLangString("exit_no")).onClick(this.close.bind(this))
            .icon("deny").buttonColor(ColorSchemes.Overlay.Button.Cancel)
            .item("button").stylePreset("overlay_interact_button").buttonText(getLangString("exit_yes")).onClick(this._handleConfirm.bind(this));

        if (getLangString("affirmative_icon") === "check") {
            handler.icon("check").buttonColor(ColorSchemes.Overlay.Button.Confirm);
        } else {
            handler.icon("confirm").buttonColor(ColorSchemes.Overlay.Button.Confirm);
        }

        handler.endGroup();
        const buildRes = handler.build();

        this.dynamicItems = buildRes.dynamicItems;
        this.staticItems = buildRes.staticItems;
    }
}
