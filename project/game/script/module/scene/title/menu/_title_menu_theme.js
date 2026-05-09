import { ColorSchemes, getCurrentThemeKey } from 'display/_theme_handler.js';
import { colorUtil, formatRgba } from 'util/color_util.js';

/**
 * 메뉴 기본 전경색을 반환합니다.
 * @returns {string} 메뉴 기본 전경색
 */
export function getMenuForegroundColor() {
    return ColorSchemes?.Title?.Menu?.Foreground
        || ColorSchemes?.Title?.TextDark
        || ColorSchemes?.Title?.Button?.Text
        || ColorSchemes?.Title?.Menu?.Accent;
}

/**
 * 메뉴 액센트 색상을 반환합니다.
 * @returns {string} 메뉴 액센트 색상
 */
export function getMenuAccentColor() {
    return ColorSchemes?.Title?.Menu?.Accent
        || ColorSchemes?.Cursor?.Active
        || ColorSchemes?.Title?.Loading?.Accent
        || ColorSchemes?.Title?.TextDark;
}

/**
 * 카드 제목에 사용할 색상을 반환합니다.
 * @returns {string} 카드 제목 색상입니다.
 */
export function getMenuCardTitleColor() {
    return ColorSchemes?.Title?.Button?.Text || getMenuForegroundColor();
}

/**
 * 카드 설명에 사용할 색상을 반환합니다.
 * @returns {string} 카드 설명 색상입니다.
 */
export function getMenuCardDescriptionColor() {
    return ColorSchemes?.Overlay?.Text?.Item || getMenuForegroundColor();
}

/**
 * 테마를 고려해 메뉴 액센트/보더 색상을 반환합니다.
 * @returns {string} 테마 반응형 테두리 색상입니다.
 */
export function getThemeAwareMenuBorderColor() {
    const isDark = getCurrentThemeKey() === 'dark';
    return isDark
        ? (ColorSchemes?.Title?.Menu?.Accent || ColorSchemes?.Title?.TextDark || '#166ffb')
        : (ColorSchemes?.Title?.Menu?.Foreground || ColorSchemes?.Title?.TextDark || '#202020');
}

/**
 * 테마를 고려해 메뉴 패널 stroke 색상을 반환합니다.
 * @param {number} alpha - 적용할 알파값입니다.
 * @returns {string} 테마 반응형 스트로크 색상입니다.
 */
export function getMenuPanelStrokeColor(alpha) {
    return toMenuRgba(getThemeAwareMenuBorderColor(), alpha);
}

/**
 * 투명도 제거 상태의 메뉴 패널 stroke 색상을 반환합니다.
 * @returns {string} 불투명 패널용 스트로크 색상입니다.
 */
function getOpaqueMenuPanelStrokeColor() {
    return ColorSchemes?.Overlay?.Panel?.Border
        || ColorSchemes?.Overlay?.Panel?.Background
        || getThemeAwareMenuBorderColor();
}

/**
 * 메뉴 효과 알파값을 반환합니다.
 * @param {string} key - 메뉴 opacity 키
 * @param {number} fallback - 미설정 시 기본 알파
 * @returns {number} 알파 값
 */
export function getMenuOpacity(key, fallback = 0) {
    const opacity = ColorSchemes?.Title?.Menu?.Opacity?.[key];
    return Number.isFinite(opacity) ? opacity : fallback;
}

/**
 * 색상에 알파를 적용해 rgba 문자열로 반환합니다.
 * @param {string} color - 색상 문자열
 * @param {number} alpha - 알파 값
 * @returns {string} rgba 문자열
 */
export function toMenuRgba(color, alpha) {
    const safeAlpha = Number.isFinite(alpha) ? alpha : 0;
    const parsedColor = colorUtil().cssToRgb(color);
    if (!parsedColor) {
        const fallback = colorUtil().cssToRgb(getMenuForegroundColor());
        if (!fallback) {
            return 'transparent';
        }
        return formatRgba(fallback.r, fallback.g, fallback.b, safeAlpha);
    }

    return formatRgba(parsedColor.r, parsedColor.g, parsedColor.b, safeAlpha);
}

/**
 * 메뉴 전경색에 알파를 적용해 반환합니다.
 * @param {number} alpha - 알파 값
 * @returns {string} rgba 문자열
 */
export function menuForegroundWithAlpha(alpha) {
    return toMenuRgba(getMenuForegroundColor(), alpha);
}

/**
 * 메뉴 색상 문자열을 RGB 객체로 변환합니다.
 * @param {string} color - css 색상 문자열입니다.
 * @param {{r:number, g:number, b:number}|null} [fallbackRgb=null] - 변환 실패 시 반환할 색상입니다.
 * @returns {{r:number, g:number, b:number}|null} 변환된 RGB 색상입니다.
 */
export function resolveMenuColorRgb(color, fallbackRgb = null) {
    const parsedColor = colorUtil().cssToRgb(color);
    if (
        Number.isFinite(parsedColor?.r)
        && Number.isFinite(parsedColor?.g)
        && Number.isFinite(parsedColor?.b)
    ) {
        return parsedColor;
    }

    return fallbackRgb;
}

/**
 * 카드 효과용 RGB 색상을 반환합니다.
 * @returns {{r:number, g:number, b:number}} 효과 RGB 색상입니다.
 */
export function getMenuEffectColor() {
    const fallbackRgb = resolveMenuColorRgb(getMenuForegroundColor(), { r: 255, g: 255, b: 255 });
    const rgb = resolveMenuColorRgb(getMenuAccentColor(), fallbackRgb);
    return {
        r: rgb.r,
        g: rgb.g,
        b: rgb.b
    };
}

/**
 * 외곽 패널을 내부 카드선과 동일한 계열로 보이게 할 스트로크 색상을 반환합니다.
 * @returns {string} 내부 카드선 기준 스트로크 색상입니다.
 */
export function getUnifiedOuterPaneStrokeColor() {
    return menuForegroundWithAlpha(getMenuOpacity('CardInnerLine', 0.12));
}

/**
 * 카드 패널 스타일을 반환합니다.
 * @param {boolean} disableTransparency - 투명도 비활성화 여부입니다.
 * @returns {object} 패널 렌더 옵션입니다.
 */
export function getMenuPanelStyle(disableTransparency) {
    if (disableTransparency) {
        return {
            fill: ColorSchemes.Overlay.Panel.Background,
            stroke: getOpaqueMenuPanelStrokeColor(),
            sampleBackdrop: false,
            blur: 0,
            lineWidth: 1.35,
            tintColor: ColorSchemes.Overlay.Panel.GlassTint,
            edgeColor: ColorSchemes.Overlay.Panel.GlassEdge,
            tintStrength: 0,
            edgeStrength: 0,
            refractionStrength: 0
        };
    }

    return {
        fill: menuForegroundWithAlpha(getMenuOpacity('PanelFill', 0.035)),
        stroke: getMenuPanelStrokeColor(getMenuOpacity('PanelStroke', 0.26)),
        sampleBackdrop: false,
        blur: 0,
        lineWidth: 1.05,
        tintColor: menuForegroundWithAlpha(getMenuOpacity('PanelTint', 0.08)),
        edgeColor: menuForegroundWithAlpha(getMenuOpacity('PanelEdge', 0.22)),
        tintStrength: Math.max(0.02, ColorSchemes.Overlay.Panel.GlassTintStrength * 0.2),
        edgeStrength: Math.max(0.08, ColorSchemes.Overlay.Panel.GlassEdgeStrength * 1.2),
        refractionStrength: 0
    };
}

/**
 * 오른쪽 보조 glass 패널 스타일을 반환합니다.
 * @param {boolean} disableTransparency - 투명도 비활성화 여부입니다.
 * @param {string} unifiedStroke - 외곽 패널 공통 stroke 색상입니다.
 * @returns {object} 패널 렌더 옵션입니다.
 */
export function getMenuBackdropPaneStyle(disableTransparency, unifiedStroke) {
    if (disableTransparency) {
        return {
            fill: ColorSchemes.Overlay.Panel.Background,
            stroke: getOpaqueMenuPanelStrokeColor(),
            sampleBackdrop: false,
            blur: 0,
            lineWidth: 1.05,
            tintColor: ColorSchemes.Overlay.Panel.GlassTint,
            edgeColor: ColorSchemes.Overlay.Panel.GlassEdge,
            tintStrength: 0,
            edgeStrength: 0,
            refractionStrength: 0
        };
    }

    return {
        fill: ColorSchemes.Overlay.Panel.GlassBackground,
        stroke: unifiedStroke,
        sampleBackdrop: true,
        blur: 0.1,
        lineWidth: 1.05,
        tintColor: ColorSchemes.Overlay.Panel.GlassTint,
        edgeColor: ColorSchemes.Overlay.Panel.GlassEdge,
        tintStrength: ColorSchemes.Overlay.Panel.GlassTintStrength,
        edgeStrength: Math.max(0.06, ColorSchemes.Overlay.Panel.GlassEdgeStrength),
        refractionStrength: 0
    };
}

/**
 * 정적 텍스처에 영향을 주는 테마 값을 문자열로 묶습니다.
 * @returns {string} 테마 캐시 식별자입니다.
 */
export function buildMenuStaticTextureThemeSignature() {
    return [
        getCurrentThemeKey(),
        getMenuForegroundColor(),
        getMenuAccentColor(),
        getMenuCardTitleColor(),
        getMenuCardDescriptionColor(),
        getMenuOpacity('Placeholder', 0.92),
        getMenuOpacity('CardInnerLine', 0.08),
        getMenuOpacity('CardInnerLineFocusDelta', 0.08)
    ].join(':');
}
