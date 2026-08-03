import { BaseOverlay } from './_base_overlay.js';
import { getLangString } from 'ui/ui_system.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { LayoutHandler } from 'ui/layout/_layout_handler.js';
import { UI_SPACING } from 'ui/layout/layout_tokens.js';
import { BUTTON_STYLE } from 'ui/style/component_styles.js';
import { TYPOGRAPHY } from 'ui/style/typography.js';
import { runtimeTool } from 'util/runtime_tool.js';
import { applyOverlayConfirmButtonIcon } from './_overlay_confirm_icon.js';
import { EXIT_LAYOUT_CONSTANTS } from './_overlay_layout_constants.js';

const EXTERNAL_LINK_WARNING_CONSTANTS = Object.freeze({
    DISPLAY_MAX_LENGTH: 55,
    HEIGHT_MULTIPLIER: 1.15,
    TRANSPARENT_COLOR: 'rgba(0, 0, 0, 0)'
});
const EXTERNAL_LINK_DISPLAY_MAX_LENGTH = EXTERNAL_LINK_WARNING_CONSTANTS.DISPLAY_MAX_LENGTH;
const EXTERNAL_LINK_WARNING_HEIGHT_MULTIPLIER = EXTERNAL_LINK_WARNING_CONSTANTS.HEIGHT_MULTIPLIER;
const TRANSPARENT_COLOR = EXTERNAL_LINK_WARNING_CONSTANTS.TRANSPARENT_COLOR;

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
            blurUpdateMode: 'always',
            // 이 overlay의 title/body/link/buttons는 모두 root panel layout 안에 있습니다.
            // 이 명시적 opt-in만 title WebGPU content-blur ROI authority가 됩니다.
            titleWebGpuContentBoundsAuthority: 'panels'
        });

        this.url = typeof url === 'string' ? url.trim() : '';
    }

    /**
     * @override
     * 경고 팝업 크기를 화면 비율에 맞추어 조정합니다.
     */
    _onResize() {
        this.width = this.UIWW * EXIT_LAYOUT_CONSTANTS.WIDTH_UIWW_RATIO;
        this.height = this.WH * EXIT_LAYOUT_CONSTANTS.HEIGHT_WH_RATIO * EXTERNAL_LINK_WARNING_HEIGHT_MULTIPLIER;
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
        const handler = new LayoutHandler(this, this.positioningHandler).paddingX(UI_SPACING.DIALOG_PADDING_X)
            .space(UI_SPACING.OVERLAY_TITLE_TOP)
            .item("text").textStyle(TYPOGRAPHY.H2).text(getLangString('external_link_warning_title')).fill(ColorSchemes.Title.TextDark)
            .space(UI_SPACING.DIALOG_BODY_GAP)
            .item("text").textStyle(TYPOGRAPHY.H4).text(getLangString('external_link_warning_body')).fill(ColorSchemes.Overlay.Text.Item)
            .space("WH", 0.8)
            .item("button", "external_link_preview")
            .width("content")
            .height("WH", 2.2)
            .textStyle(TYPOGRAPHY.LINK_PREVIEW)
            .buttonText(this._getDisplayURL())
            .buttonColor(TRANSPARENT_COLOR, TRANSPARENT_COLOR, ColorSchemes.Overlay.Text.Item)
            .prop("margin", 0)
            .radius("absolute", 0)
            .onHover(() => { })
            .bottomSpace(UI_SPACING.OVERLAY_FOOTER_BOTTOM)
            .bottomGroup().justifyContent("right", "WW", 1).align("right");

        handler.item("button").buttonStyle(BUTTON_STYLE.OVERLAY_INTERACT).buttonText(getLangString("exit_no")).onClick(this.close.bind(this))
            .icon("deny").buttonColor(ColorSchemes.Overlay.Button.Cancel)
            .item("button").buttonStyle(BUTTON_STYLE.OVERLAY_INTERACT).buttonText(getLangString("exit_yes")).onClick(this._handleConfirm.bind(this));

        applyOverlayConfirmButtonIcon(handler);

        handler.endGroup();
        const buildRes = handler.build();

        this.dynamicItems = buildRes.dynamicItems;
        this.staticItems = buildRes.staticItems;
    }
}
