import { getLangString } from 'ui/ui_system.js';
import {
    drawTitleMenuCardIcon,
    drawTitleMenuIcon,
    drawTitleMenuPlaceholderIcon,
    getTitleMenuCardIconMetrics,
    getTitleMenuUtilityTileIconMetrics
} from './_title_menu_icon_render.js';
import { getTitleMenuTextPresetFontSize } from './_title_menu_text_layout.js';
import { drawTitleMenuWrappedText } from './_title_menu_text_render.js';
import {
    getMenuCardDescriptionColor,
    getMenuCardTitleColor,
    getMenuOpacity,
    menuForegroundWithAlpha
} from './_title_menu_theme.js';

/**
 * 유틸리티 타일 앞면 콘텐츠를 그립니다.
 * @param {object} options - 타일 콘텐츠 렌더 옵션입니다.
 * @param {CanvasRenderingContext2D} options.context - 대상 컨텍스트입니다.
 * @param {import('display/_svg_drawer.js').SVGDrawer} options.svgDrawer - SVG 캐시 드로어입니다.
 * @param {object} options.renderState - 타일 렌더 상태입니다.
 * @param {boolean} options.hovered - hover 여부입니다.
 * @param {object} options.titleCardMenu - 타이틀 카드 메뉴 상수입니다.
 * @param {number} [options.uiScale=1] - 현재 UI 스케일 배율입니다.
 * @returns {void}
 */
export function drawTitleMenuUtilityTileContent({
    context,
    svgDrawer,
    renderState,
    hovered,
    titleCardMenu,
    uiScale = 1
}) {
    const panelRect = renderState.panelRect;
    const resolvedUiScale = _normalizeTitleMenuUiScale(uiScale);
    const placeholderSize = Number.isFinite(renderState.placeholderSize)
        ? renderState.placeholderSize
        : Math.max(
            12 * resolvedUiScale,
            Math.min(panelRect.w, panelRect.h) * titleCardMenu.UTILITY_TILE_PLACEHOLDER_SCALE
        );
    const iconMetrics = getTitleMenuUtilityTileIconMetrics(panelRect, placeholderSize);
    const placeholderAlpha = hovered ? 1 : getMenuOpacity('Placeholder', 0.92);
    const placeholderRadius = Math.max(
        4 * resolvedUiScale,
        placeholderSize * titleCardMenu.UTILITY_TILE_PLACEHOLDER_RADIUS_RATIO
    );

    _drawTitleMenuInnerEdges(context, panelRect, hovered ? 0.16 : 0);
    if (drawTitleMenuIcon(context, svgDrawer, renderState.id, iconMetrics, placeholderAlpha)) {
        return;
    }

    drawTitleMenuPlaceholderIcon(context, iconMetrics, placeholderAlpha, placeholderRadius);
}

/**
 * 카드 앞면 콘텐츠를 그립니다.
 * @param {object} options - 카드 앞면 콘텐츠 렌더 옵션입니다.
 * @param {CanvasRenderingContext2D} options.context - 대상 컨텍스트입니다.
 * @param {import('display/_svg_drawer.js').SVGDrawer} options.svgDrawer - SVG 캐시 드로어입니다.
 * @param {object} options.card - 대상 카드입니다.
 * @param {object} options.renderState - 카드 렌더 상태입니다.
 * @param {object} options.textConstants - 텍스트 상수입니다.
 * @param {number} options.uiww - UI 기준 너비입니다.
 * @param {number} [options.uiScale=1] - 현재 UI 스케일 배율입니다.
 * @returns {void}
 */
export function drawTitleMenuCardFrontfaceContent({
    context,
    svgDrawer,
    card,
    renderState,
    textConstants,
    uiww,
    uiScale = 1
}) {
    const panelRect = renderState.panelRect;
    const resolvedUiScale = _normalizeTitleMenuUiScale(uiScale);
    const inset = Math.max(16 * resolvedUiScale, panelRect.w * 0.08);
    const title = getLangString(card.cardDefinition.titleKey);
    const description = card.cardDefinition.descriptionKey ? getLangString(card.cardDefinition.descriptionKey) : '';
    const isCompactHorizontalCard = card.cardDefinition.id === 'records';
    const iconMetrics = getTitleMenuCardIconMetrics(card.cardDefinition.id, panelRect, inset);
    const titleFontSize = Math.max(
        16 * resolvedUiScale,
        panelRect.w * (panelRect.h > panelRect.w * 0.7 ? 0.095 : 0.08),
        isCompactHorizontalCard ? panelRect.h * 0.28 : 0
    );
    const descriptionFontSize = getTitleMenuTextPresetFontSize(textConstants, uiww, 'H6', resolvedUiScale);
    const descriptionLineHeight = descriptionFontSize * 1.32;
    const titleLineHeight = titleFontSize * 1.06;
    const bottomPadding = inset * 0.8;
    const descriptionY = panelRect.h - bottomPadding - descriptionLineHeight;
    const titleY = description
        ? descriptionY - (descriptionLineHeight * 0.4928) - titleLineHeight
        : panelRect.h - bottomPadding - titleLineHeight;

    drawTitleMenuCardIcon(context, svgDrawer, card.cardDefinition.id, iconMetrics);
    _drawTitleMenuInnerEdges(context, panelRect, renderState.hoverProgress || 0);

    if (isCompactHorizontalCard) {
        const titleX = iconMetrics.x + iconMetrics.w + Math.max(14 * resolvedUiScale, panelRect.w * 0.06);
        drawTitleMenuWrappedText(context, {
            text: title,
            x: titleX,
            y: (panelRect.h - titleLineHeight) * 0.5,
            maxWidth: panelRect.w - titleX - inset,
            lineHeight: titleLineHeight,
            font: `700 ${titleFontSize}px "Pretendard Variable", arial`,
            fillStyle: getMenuCardTitleColor(),
            align: 'left'
        });
        return;
    }

    drawTitleMenuWrappedText(context, {
        text: title,
        x: inset,
        y: titleY,
        maxWidth: panelRect.w - (inset * 2),
        lineHeight: titleLineHeight,
        font: `700 ${titleFontSize}px "Pretendard Variable", arial`,
        fillStyle: getMenuCardTitleColor(),
        align: 'left'
    });

    if (description) {
        drawTitleMenuWrappedText(context, {
            text: description,
            x: inset,
            y: descriptionY,
            maxWidth: panelRect.w - (inset * 2),
            lineHeight: descriptionLineHeight,
            font: `500 ${descriptionFontSize}px "Pretendard Variable", arial`,
            fillStyle: getMenuCardDescriptionColor(),
            align: 'left'
        });
    }
}

/**
 * UI 스케일 입력값을 안전한 양수 배율로 정규화합니다.
 * @param {number} uiScale - 원본 UI 스케일 배율입니다.
 * @returns {number} 정규화된 UI 스케일 배율입니다.
 */
function _normalizeTitleMenuUiScale(uiScale) {
    return Number.isFinite(uiScale) && uiScale > 0 ? uiScale : 1;
}

/**
 * 카드 내부 장식선을 그립니다.
 * @param {CanvasRenderingContext2D} context - 대상 컨텍스트입니다.
 * @param {{w:number, h:number, radius:number}} panelRect - 카드 패널 영역입니다.
 * @param {number} emphasisProgress - 카드 강조 진행률입니다.
 * @returns {void}
 */
function _drawTitleMenuInnerEdges(context, panelRect, emphasisProgress) {
    context.save();
    context.strokeStyle = menuForegroundWithAlpha(
        getMenuOpacity('CardInnerLine', 0.08)
        + (emphasisProgress * getMenuOpacity('CardInnerLineFocusDelta', 0.08))
    );
    context.lineWidth = 1;
    context.beginPath();
    context.roundRect(1.5, 1.5, panelRect.w - 3, panelRect.h - 3, Math.max(8, panelRect.radius - 3));
    context.stroke();
    context.restore();
}
