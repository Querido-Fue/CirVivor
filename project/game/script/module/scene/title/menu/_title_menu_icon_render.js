import { getTitleMenuIconDrawScale } from 'util/title_menu_icon_util.js';
import { getTitleMenuIconSource } from './_title_menu_icon.js';
import { clampNumber } from './_title_menu_motion.js';
import {
    getMenuOpacity,
    menuForegroundWithAlpha
} from './_title_menu_theme.js';

/**
 * 카드 좌상단 SVG 아이콘을 그립니다.
 * @param {CanvasRenderingContext2D} context - 대상 컨텍스트입니다.
 * @param {import('display/_svg_drawer.js').SVGDrawer} svgDrawer - SVG 캐시 드로어입니다.
 * @param {string} cardId - 카드 식별자입니다.
 * @param {{x:number, y:number, w:number, h:number}} iconMetrics - 아이콘 레이아웃 정보입니다.
 */
export function drawTitleMenuCardIcon(context, svgDrawer, cardId, iconMetrics) {
    if (drawTitleMenuIcon(context, svgDrawer, cardId, iconMetrics)) {
        return;
    }

    drawTitleMenuPlaceholderIcon(context, iconMetrics);
}

/**
 * 메뉴 식별자에 대응하는 SVG 아이콘을 그립니다.
 * @param {CanvasRenderingContext2D} context - 대상 컨텍스트입니다.
 * @param {import('display/_svg_drawer.js').SVGDrawer} svgDrawer - SVG 캐시 드로어입니다.
 * @param {string} iconId - 메뉴 식별자입니다.
 * @param {{x:number, y:number, w:number, h:number}} iconMetrics - 아이콘 레이아웃 정보입니다.
 * @param {number} [alpha=getMenuOpacity('Placeholder', 0.92)] - 아이콘 알파값입니다.
 * @returns {boolean} 렌더 성공 여부입니다.
 */
export function drawTitleMenuIcon(
    context,
    svgDrawer,
    iconId,
    iconMetrics,
    alpha = getMenuOpacity('Placeholder', 0.92)
) {
    const iconSource = getTitleMenuIconSource(iconId);
    const iconRecord = iconSource ? svgDrawer.getCachedSvgFile(iconSource) : null;
    if (!iconRecord?.image) {
        return false;
    }

    const drawRect = _getContainedTitleMenuIconRect(iconId, iconMetrics, iconRecord.aspectRatio);
    svgDrawer.drawLoadedSvgFile(context, iconRecord, {
        x: drawRect.x,
        y: drawRect.y,
        width: drawRect.w,
        height: drawRect.h,
        alpha
    });
    return true;
}

/**
 * SVG 아이콘이 준비되지 않았을 때 임시 플레이스홀더를 그립니다.
 * @param {CanvasRenderingContext2D} context - 대상 컨텍스트입니다.
 * @param {{x:number, y:number, w:number, h:number}} iconMetrics - 아이콘 레이아웃 정보입니다.
 * @param {number} [alpha=getMenuOpacity('Placeholder', 0.92)] - 플레이스홀더 알파값입니다.
 * @param {number} [cornerRadius=Math.max(4, iconMetrics.h * 0.18)] - 플레이스홀더 라운드 반경입니다.
 */
export function drawTitleMenuPlaceholderIcon(
    context,
    iconMetrics,
    alpha = getMenuOpacity('Placeholder', 0.92),
    cornerRadius = Math.max(4, iconMetrics.h * 0.18)
) {
    context.fillStyle = menuForegroundWithAlpha(alpha);
    context.beginPath();
    context.roundRect(
        iconMetrics.x,
        iconMetrics.y,
        iconMetrics.w,
        iconMetrics.h,
        cornerRadius
    );
    context.fill();
}

/**
 * 카드 종류에 맞는 아이콘 레이아웃 정보를 반환합니다.
 * @param {string} cardId - 카드 식별자입니다.
 * @param {{w:number, h:number}} panelRect - 카드 패널 영역입니다.
 * @param {number} inset - 카드 내부 여백입니다.
 * @returns {{x:number, y:number, w:number, h:number}} 아이콘 레이아웃 정보입니다.
 */
export function getTitleMenuCardIconMetrics(cardId, panelRect, inset) {
    const baseSize = Math.max(20, panelRect.w * 0.14);
    const iconWidth = cardId === 'quick_start' ? baseSize * 1.38 : baseSize;
    const iconHeight = baseSize;
    const iconY = cardId === 'records'
        ? (panelRect.h - iconHeight) * 0.5
        : inset;

    return {
        x: inset,
        y: iconY,
        w: iconWidth,
        h: iconHeight
    };
}

/**
 * 하단 보조 메뉴 타일에 사용할 아이콘 레이아웃 정보를 반환합니다.
 * @param {{w:number, h:number}} panelRect - 타일 패널 영역입니다.
 * @param {number} iconSize - 기준 아이콘 크기입니다.
 * @returns {{x:number, y:number, w:number, h:number}} 아이콘 레이아웃 정보입니다.
 */
export function getTitleMenuUtilityTileIconMetrics(panelRect, iconSize) {
    const maxSize = clampNumber(Math.min(panelRect.w, panelRect.h), 1, Infinity);
    const resolvedSize = clampNumber(iconSize, Math.min(12, maxSize), maxSize);

    return {
        x: (panelRect.w - resolvedSize) * 0.5,
        y: (panelRect.h - resolvedSize) * 0.5,
        w: resolvedSize,
        h: resolvedSize
    };
}

/**
 * 아이콘 영역 안에 원본 종횡비를 유지한 실제 그리기 영역을 계산합니다.
 * @param {string} iconId - 메뉴 식별자입니다.
 * @param {{x:number, y:number, w:number, h:number}} iconMetrics - 아이콘 레이아웃 정보입니다.
 * @param {number} aspectRatio - SVG 원본 종횡비입니다.
 * @returns {{x:number, y:number, w:number, h:number}} 실제 그리기 영역입니다.
 */
function _getContainedTitleMenuIconRect(iconId, iconMetrics, aspectRatio) {
    const safeAspectRatio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
    const drawScale = getTitleMenuIconDrawScale(iconId);
    const maxWidth = iconMetrics.w * 0.96;
    const maxHeight = iconMetrics.h * 0.96;
    let baseWidth = maxWidth;
    let baseHeight = baseWidth / safeAspectRatio;

    if (baseHeight > maxHeight) {
        baseHeight = maxHeight;
        baseWidth = baseHeight * safeAspectRatio;
    }

    const drawWidth = baseWidth * drawScale.x;
    const drawHeight = baseHeight * drawScale.y;

    return {
        x: drawScale.alignX === 'left'
            ? iconMetrics.x + (iconMetrics.w * 0.02)
            : iconMetrics.x + ((iconMetrics.w - drawWidth) * 0.5),
        y: iconMetrics.y + ((iconMetrics.h - drawHeight) * 0.5),
        w: drawWidth,
        h: drawHeight
    };
}
