import { lerpNumber } from 'overlay/_panel_effect_math.js';
import { clampNumber } from './_title_menu_motion.js';
import {
    getTitleMenuTextPresetFont,
    getTitleMenuTextPresetFontSize
} from './_title_menu_text_layout.js';
import {
    buildTitleMenuVersionLabelLayout,
    getTitleMenuGameVersionText,
    getTitleMenuVersionHistoryLinkText
} from './_title_menu_version_label.js';
import { drawTitleMenuVersionHistoryLinkArrow } from './_title_menu_version_link.js';
import { menuForegroundWithAlpha } from './_title_menu_theme.js';

/**
 * 타이틀 메뉴의 게임 버전 라벨 레이아웃과 렌더링을 담당합니다.
 */
export class TitleMenuVersionLabelRenderer {
    /**
     * @param {object} options - 버전 라벨 렌더러 옵션입니다.
     * @param {object} options.globalConstants - 전역 상수 객체입니다.
     * @param {object} options.textConstants - 텍스트 상수 객체입니다.
     */
    constructor({ globalConstants, textConstants }) {
        this.globalConstants = globalConstants;
        this.textConstants = textConstants;
        this.measureCanvas = null;
        this.measureContext = null;
    }

    /**
     * 버전 라벨 측정용 캔버스 리소스를 정리합니다.
     */
    destroy() {
        if (this.measureCanvas) {
            this.measureCanvas.width = 0;
            this.measureCanvas.height = 0;
            this.measureCanvas = null;
            this.measureContext = null;
        }
    }

    /**
     * 버전 정보 블록의 텍스트, 폰트, hitbox를 계산합니다.
     * @param {object} options - 버전 정보 레이아웃 옵션입니다.
     * @param {object|null} [options.paneLayout=null] - 현재 오른쪽 패널 배치 정보입니다.
     * @param {number} options.uiww - UI 기준 너비입니다.
     * @param {number} options.wh - 화면 높이입니다.
     * @param {number} options.uiOffsetX - UI 기준 X 오프셋입니다.
     * @param {number} options.utilityPaneRevealEase - 하단 서브 메뉴 등장 이징 값입니다.
     * @returns {object|null} 버전 정보 블록 렌더 레이아웃입니다.
     */
    buildLayout({
        paneLayout = null,
        uiww,
        wh,
        uiOffsetX,
        utilityPaneRevealEase
    }) {
        const versionText = getTitleMenuGameVersionText(this.globalConstants);
        if (!versionText) {
            return null;
        }

        const versionFontSize = getTitleMenuTextPresetFontSize(this.textConstants, uiww, 'H5');
        const linkFontSize = getTitleMenuTextPresetFontSize(this.textConstants, uiww, 'H5_BOLD');
        const versionFont = getTitleMenuTextPresetFont(this.textConstants, uiww, 'H5');
        const linkFont = getTitleMenuTextPresetFont(this.textConstants, uiww, 'H5_BOLD');
        const linkText = getTitleMenuVersionHistoryLinkText();
        const linkTextWidth = linkText ? this.#measureTextWidth(linkText, linkFont, uiww) : 0;

        return buildTitleMenuVersionLabelLayout({
            paneLayout,
            uiww,
            wh,
            uiOffsetX,
            utilityPaneRevealEase,
            versionText,
            versionFont,
            versionFontSize,
            linkText,
            linkFont,
            linkFontSize,
            linkTextWidth
        });
    }

    /**
     * 우상단에 현재 게임 버전 라벨을 렌더링합니다.
     * @param {object} options - 버전 라벨 렌더 옵션입니다.
     * @param {import('overlay/_overlay_session.js').OverlaySession|null} options.session - 렌더 대상 세션입니다.
     * @param {object|null} [options.paneLayout=null] - 현재 오른쪽 패널 배치 정보입니다.
     * @param {number} options.uiww - UI 기준 너비입니다.
     * @param {number} options.wh - 화면 높이입니다.
     * @param {number} options.uiOffsetX - UI 기준 X 오프셋입니다.
     * @param {number} options.utilityPaneRevealEase - 하단 서브 메뉴 등장 이징 값입니다.
     * @param {object|null} [options.linkButton=null] - 업데이트 링크 버튼입니다.
     */
    draw({
        session,
        paneLayout = null,
        uiww,
        wh,
        uiOffsetX,
        utilityPaneRevealEase,
        linkButton = null
    }) {
        if (!session) {
            return;
        }

        const layout = this.buildLayout({
            paneLayout,
            uiww,
            wh,
            uiOffsetX,
            utilityPaneRevealEase
        });
        if (!layout || layout.alpha <= 0.005) {
            return;
        }

        const linkHoverValue = clampNumber(linkButton?.hoverValue || 0, 0, 1);
        const linkColor = menuForegroundWithAlpha(lerpNumber(0.42, 1, linkHoverValue));
        const textShadowBlur = Math.max(4, wh * 0.008);
        const textShadowColor = menuForegroundWithAlpha(0.08);

        session.renderPanel({
            shape: 'text',
            text: layout.versionText,
            x: layout.versionX,
            y: layout.versionY,
            font: layout.versionFont,
            fill: menuForegroundWithAlpha(0.42),
            align: 'right',
            baseline: 'top',
            alpha: layout.alpha,
            shadowBlur: textShadowBlur,
            shadowColor: textShadowColor
        });

        if (!layout.linkText) {
            return;
        }

        drawTitleMenuVersionHistoryLinkArrow(session, layout, linkColor, textShadowBlur, textShadowColor);

        session.renderPanel({
            shape: 'text',
            text: layout.linkText,
            x: layout.linkTextX,
            y: layout.linkY,
            font: layout.linkFont,
            fill: linkColor,
            align: 'right',
            baseline: 'top',
            alpha: layout.alpha,
            shadowBlur: textShadowBlur,
            shadowColor: textShadowColor
        });
    }

    /**
     * 지정한 폰트 기준 텍스트 폭을 측정합니다.
     * @param {string} text - 측정할 텍스트입니다.
     * @param {string} font - 캔버스 폰트 문자열입니다.
     * @param {number} uiww - UI 기준 너비입니다.
     * @returns {number} 측정된 텍스트 폭입니다.
     * @private
     */
    #measureTextWidth(text, font, uiww) {
        const context = this.#getMeasureContext();
        if (!context) {
            return Math.max(
                1,
                String(text || '').length * getTitleMenuTextPresetFontSize(this.textConstants, uiww, 'H6') * 0.6
            );
        }

        context.save();
        context.font = font;
        const measuredWidth = context.measureText(String(text || '')).width;
        context.restore();
        return measuredWidth;
    }

    /**
     * 버전 라벨 텍스트 측정에 사용할 2D 컨텍스트를 반환합니다.
     * @returns {CanvasRenderingContext2D|null} 텍스트 측정용 컨텍스트입니다.
     * @private
     */
    #getMeasureContext() {
        if (this.measureContext) {
            return this.measureContext;
        }

        if (typeof document === 'undefined') {
            return null;
        }

        this.measureCanvas = document.createElement('canvas');
        this.measureContext = this.measureCanvas.getContext('2d');
        return this.measureContext;
    }
}
