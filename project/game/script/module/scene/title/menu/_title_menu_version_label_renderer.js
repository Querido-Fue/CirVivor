import { clampNumber, lerpNumber, resolveFiniteNumber } from 'util/number_util.js';
import { TYPOGRAPHY } from 'ui/style/typography.js';
import { resolveTitleMenuTypography } from './_title_menu_text_layout.js';
import {
    buildTitleMenuVersionLabelLayout,
    getTitleMenuGameVersionText,
    getTitleMenuVersionLabelBlockHeight,
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
     */
    constructor({ globalConstants }) {
        this.globalConstants = globalConstants;
        this.measureCanvas = null;
        this.measureContext = null;
        this.measureWidthCache = new Map();
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
        this.measureWidthCache.clear();
    }

    /**
     * 현재 화면과 UI 배율에서 버전 정보 블록이 차지하는 세로 높이를 반환합니다.
     * @param {object} options - 버전 블록 높이 계산 옵션입니다.
     * @param {number} options.uiww - UI 기준 너비입니다.
     * @param {number} options.wh - 화면 높이입니다.
     * @param {number} [options.uiScale=1] - 현재 UI 스케일 배율입니다.
     * @returns {number} 버전 정보 블록 전체 높이입니다.
     */
    getBlockHeight({ uiww, wh, uiScale = 1 }) {
        if (!getTitleMenuGameVersionText(this.globalConstants)) {
            return 0;
        }

        const resolvedUiScale = this.#normalizeUiScale(uiScale);
        const linkText = getTitleMenuVersionHistoryLinkText();
        const versionTypography = resolveTitleMenuTypography(
            TYPOGRAPHY.H5,
            uiww,
            resolvedUiScale
        );
        const linkTypography = resolveTitleMenuTypography(
            TYPOGRAPHY.LABEL,
            uiww,
            resolvedUiScale
        );
        return getTitleMenuVersionLabelBlockHeight({
            wh,
            uiScale: resolvedUiScale,
            versionFontSize: versionTypography.size,
            linkText,
            linkFontSize: linkTypography.size
        });
    }

    /**
     * 버전 정보 블록의 텍스트, 폰트, hitbox를 계산합니다.
     * @param {object} options - 버전 정보 레이아웃 옵션입니다.
     * @param {object|null} [options.paneLayout=null] - 현재 오른쪽 패널 배치 정보입니다.
     * @param {number} options.uiww - UI 기준 너비입니다.
     * @param {number} options.wh - 화면 높이입니다.
     * @param {number} options.uiOffsetX - UI 기준 X 오프셋입니다.
     * @param {number} [options.uiScale=1] - 현재 UI 스케일 배율입니다.
     * @param {number} options.utilityPaneRevealEase - 하단 서브 메뉴 등장 이징 값입니다.
     * @returns {object|null} 버전 정보 블록 렌더 레이아웃입니다.
     */
    buildLayout({
        paneLayout = null,
        uiww,
        wh,
        uiOffsetX,
        uiScale = 1,
        utilityPaneRevealEase
    }) {
        const versionText = getTitleMenuGameVersionText(this.globalConstants);
        if (!versionText) {
            return null;
        }

        const resolvedUiScale = this.#normalizeUiScale(uiScale);
        const versionTypography = resolveTitleMenuTypography(
            TYPOGRAPHY.H5,
            uiww,
            resolvedUiScale
        );
        const linkTypography = resolveTitleMenuTypography(
            TYPOGRAPHY.LABEL,
            uiww,
            resolvedUiScale
        );
        const linkText = getTitleMenuVersionHistoryLinkText();
        const versionTextWidth = this.#measureTextWidth(
            versionText,
            versionTypography.font,
            uiww,
            resolvedUiScale,
            versionTypography.size
        );
        const linkTextWidth = linkText
            ? this.#measureTextWidth(
                linkText,
                linkTypography.font,
                uiww,
                resolvedUiScale,
                linkTypography.size
            )
            : 0;

        return buildTitleMenuVersionLabelLayout({
            paneLayout,
            uiww,
            wh,
            uiOffsetX,
            uiScale: resolvedUiScale,
            utilityPaneRevealEase,
            versionText,
            versionFont: versionTypography.font,
            versionFontSize: versionTypography.size,
            versionTextWidth,
            linkText,
            linkFont: linkTypography.font,
            linkFontSize: linkTypography.size,
            linkTextWidth
        });
    }

    /**
     * 우상단에 현재 게임 버전 라벨을 렌더링합니다.
     * @param {object} options - 버전 라벨 렌더 옵션입니다.
     * @param {import('overlay/_overlay_session.js').OverlaySession|null} options.session - 렌더 대상 세션입니다.
     * @param {object|null|undefined} [options.layout=undefined] - 같은 frame의 update에서 계산한 레이아웃입니다. undefined이면 직접 계산합니다.
     * @param {object|null} [options.paneLayout=null] - 현재 오른쪽 패널 배치 정보입니다.
     * @param {number} options.uiww - UI 기준 너비입니다.
     * @param {number} options.wh - 화면 높이입니다.
     * @param {number} options.uiOffsetX - UI 기준 X 오프셋입니다.
     * @param {number} [options.uiScale=1] - 현재 UI 스케일 배율입니다.
     * @param {number} options.utilityPaneRevealEase - 하단 서브 메뉴 등장 이징 값입니다.
     * @param {object|null} [options.linkButton=null] - 업데이트 링크 버튼입니다.
     */
    draw({
        session,
        layout: precomputedLayout = undefined,
        paneLayout = null,
        uiww,
        wh,
        uiOffsetX,
        uiScale = 1,
        utilityPaneRevealEase,
        linkButton = null
    }) {
        if (!session) {
            return;
        }

        const layout = precomputedLayout === undefined
            ? this.buildLayout({
                paneLayout,
                uiww,
                wh,
                uiOffsetX,
                uiScale,
                utilityPaneRevealEase
            })
            : precomputedLayout;
        if (!layout || layout.alpha <= 0.005) {
            return;
        }

        const linkHoverValue = clampNumber(linkButton?.hoverValue || 0, 0, 1);
        const linkColor = menuForegroundWithAlpha(lerpNumber(0.42, 1, linkHoverValue));
        const resolvedUiScale = this.#normalizeUiScale(uiScale);
        const textShadowBlur = Math.max(4 * resolvedUiScale, wh * 0.008 * resolvedUiScale);
        const textShadowColor = menuForegroundWithAlpha(0.08);

        if (session.contentBlur > 0.0001
            && layout.contentBounds?.width > 0
            && layout.contentBounds?.height > 0) {
            session.recordTitleWebGpuPanelContentBounds?.({
                ...layout.contentBounds,
                shadowBlur: textShadowBlur,
                shadowOffsetX: 0,
                shadowOffsetY: 0
            });
        }

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
     * @param {number} [uiScale=1] - 현재 UI 스케일 배율입니다.
     * @param {number|null} [fontSize=null] - 측정 실패 시 사용할 실제 typography 크기입니다.
     * @returns {number} 측정된 텍스트 폭입니다.
     * @private
     */
    #measureTextWidth(text, font, uiww, uiScale = 1, fontSize = null) {
        const normalizedText = String(text || '');
        const cacheKey = `${font}\u0000${normalizedText}`;
        const cachedWidth = this.measureWidthCache.get(cacheKey);
        if (cachedWidth !== undefined) {
            return cachedWidth;
        }

        const context = this.#getMeasureContext();
        let measuredWidth;
        if (!context) {
            const fallbackSize = Number.isFinite(fontSize) && fontSize > 0
                ? fontSize
                : resolveTitleMenuTypography(TYPOGRAPHY.H6, uiww, uiScale).size;
            measuredWidth = Math.max(
                1,
                normalizedText.length * fallbackSize * 0.6
            );
        } else {
            context.save();
            context.font = font;
            measuredWidth = context.measureText(normalizedText).width;
            context.restore();
        }

        const fontSet = typeof document === 'undefined' ? null : document.fonts;
        let fontReady = true;
        if (typeof fontSet?.check === 'function') {
            try {
                fontReady = fontSet.check(font, normalizedText) === true;
            } catch {
                fontReady = false;
            }
        }
        if (fontReady) {
            if (this.measureWidthCache.size >= 16) {
                this.measureWidthCache.clear();
            }
            this.measureWidthCache.set(cacheKey, measuredWidth);
        }
        return measuredWidth;
    }

    /**
     * UI 스케일 입력값을 안전한 양수 배율로 정규화합니다.
     * @param {number} uiScale - 원본 UI 스케일 배율입니다.
     * @returns {number} 정규화된 UI 스케일 배율입니다.
     * @private
     */
    #normalizeUiScale(uiScale) {
        const safeUiScale = resolveFiniteNumber(uiScale, 1);
        return safeUiScale > 0 ? safeUiScale : 1;
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
