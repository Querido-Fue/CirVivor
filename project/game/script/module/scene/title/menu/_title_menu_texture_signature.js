import { getLangString } from 'ui/ui_system.js';
import { resolveFiniteNumber } from 'util/number_util.js';
import { getTitleMenuIconSource } from './_title_menu_icon.js';
import { getTitleMenuTextPresetFontSize } from './_title_menu_text_layout.js';
import { buildMenuStaticTextureThemeSignature } from './_title_menu_theme.js';

/**
 * 카드 정적 텍스처 캐시 식별자를 생성합니다.
 * @param {object} options - 카드 캐시 식별자 생성 옵션입니다.
 * @param {object} options.card - 대상 카드입니다.
 * @param {object} options.renderState - 카드 렌더 상태입니다.
 * @param {number} options.uiww - UI 기준 너비입니다.
 * @param {number} options.wh - 화면 높이입니다.
 * @param {number} [options.uiScale=1] - 현재 UI 스케일 배율입니다.
 * @param {object} options.textConstants - 텍스트 상수입니다.
 * @param {import('display/_svg_drawer.js').SVGDrawer} options.svgDrawer - SVG 캐시 드로어입니다.
 * @returns {string} 캐시 식별자입니다.
 */
export function buildTitleMenuCardStaticTextureSignature({
    card,
    renderState,
    uiww,
    wh,
    uiScale = 1,
    textConstants,
    svgDrawer
}) {
    const panelRect = renderState.panelRect;
    const title = getLangString(card.cardDefinition.titleKey);
    const description = card.cardDefinition.descriptionKey ? getLangString(card.cardDefinition.descriptionKey) : '';

    return [
        'card',
        card.cardDefinition.id,
        Math.ceil(panelRect.w),
        Math.ceil(panelRect.h),
        Math.ceil(panelRect.radius),
        title,
        description,
        Math.round(uiww),
        Math.round(wh),
        _normalizeTitleMenuUiScale(uiScale).toFixed(3),
        getTitleMenuTextPresetFontSize(textConstants, uiww, 'H6', uiScale),
        buildMenuStaticTextureThemeSignature(),
        getTitleMenuIconTextureSignature(svgDrawer, card.cardDefinition.id)
    ].join('|');
}

/**
 * 유틸리티 타일 정적 텍스처 캐시 식별자를 생성합니다.
 * @param {object} options - 타일 캐시 식별자 생성 옵션입니다.
 * @param {object} options.renderState - 타일 렌더 상태입니다.
 * @param {object} options.runtimeState - 타일 런타임 상태입니다.
 * @param {number} options.uiww - UI 기준 너비입니다.
 * @param {number} options.wh - 화면 높이입니다.
 * @param {number} [options.uiScale=1] - 현재 UI 스케일 배율입니다.
 * @param {import('display/_svg_drawer.js').SVGDrawer} options.svgDrawer - SVG 캐시 드로어입니다.
 * @returns {string} 캐시 식별자입니다.
 */
export function buildTitleMenuUtilityTileStaticTextureSignature({
    renderState,
    runtimeState,
    uiww,
    wh,
    uiScale = 1,
    svgDrawer
}) {
    const panelRect = renderState.panelRect;
    return [
        'utility',
        renderState.id,
        Math.ceil(panelRect.w),
        Math.ceil(panelRect.h),
        Math.ceil(panelRect.radius),
        Number(runtimeState.hovered === true),
        Math.ceil(renderState.placeholderSize || 0),
        Math.round(uiww),
        Math.round(wh),
        _normalizeTitleMenuUiScale(uiScale).toFixed(3),
        buildMenuStaticTextureThemeSignature(),
        getTitleMenuIconTextureSignature(svgDrawer, renderState.id)
    ].join('|');
}

/**
 * 아이콘 로딩 상태를 정적 텍스처 캐시에 반영할 식별자로 변환합니다.
 * @param {import('display/_svg_drawer.js').SVGDrawer} svgDrawer - SVG 캐시 드로어입니다.
 * @param {string} iconId - 아이콘 식별자입니다.
 * @returns {string} 아이콘 캐시 식별자입니다.
 */
export function getTitleMenuIconTextureSignature(svgDrawer, iconId) {
    const iconSource = getTitleMenuIconSource(iconId) || '';
    const iconRecord = iconSource ? svgDrawer.getCachedSvgFile(iconSource) : null;
    return [
        iconSource,
        Number(Boolean(iconRecord?.image)),
        resolveFiniteNumber(iconRecord?.aspectRatio, 0)
    ].join(':');
}

/**
 * UI 스케일 입력값을 안전한 양수 배율로 정규화합니다.
 * @param {number} uiScale - 원본 UI 스케일 배율입니다.
 * @returns {number} 정규화된 UI 스케일 배율입니다.
 */
function _normalizeTitleMenuUiScale(uiScale) {
    const safeUiScale = resolveFiniteNumber(uiScale, 1);
    return safeUiScale > 0 ? safeUiScale : 1;
}
