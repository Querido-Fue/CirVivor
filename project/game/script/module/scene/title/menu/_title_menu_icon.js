import { getData } from 'data/data_handler.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import {
    applyTitleMenuIconColorTemplate,
    getTitleMenuIconTemplateKeys
} from 'util/title_menu_icon_util.js';

const TITLE_MENU_ICON_TEMPLATES = getData('TITLE_MENU_ICON_DATA').TEMPLATES;

/**
 * 메뉴 아이콘 렌더링에 사용할 색상값을 반환합니다.
 * @returns {{fill:string, shadow:string}} 아이콘 컬러 셋
 */
function getMenuIconColors() {
    const iconColor = ColorSchemes?.Title?.Menu?.Icon || {};
    const fill = iconColor.Fill
        || ColorSchemes?.Title?.Menu?.Foreground
        || ColorSchemes?.Title?.TextDark
        || ColorSchemes?.Title?.Button?.Text
        || ColorSchemes?.Title?.Menu?.Accent
        || ColorSchemes?.Cursor?.White;
    const shadow = iconColor.Shadow
        || ColorSchemes?.Title?.Menu?.Icon?.Shadow
        || ColorSchemes?.Title?.Menu?.Foreground
        || ColorSchemes?.Title?.TextDark
        || ColorSchemes?.Title?.Menu?.Accent;

    return {
        fill,
        shadow
    };
}

/**
 * 템플릿 문자열에 실제 색상을 주입해 SVG 소스를 만듭니다.
 * @param {string} template - 색상 토큰이 포함된 SVG 템플릿
 * @param {string} fill - 아이콘 메인 채움 색상
 * @param {string} shadow - 아이콘 그림자 색상
 * @returns {string} 색상 치환이 완료된 SVG 문자열
 */
/**
 * 색상 치환된 메뉴 아이콘 소스를 반환합니다.
 * @param {string} iconId - 메뉴 식별자입니다.
 * @returns {string|null} SVG 문자열 또는 null입니다.
 */
export function getTitleMenuIconSource(iconId) {
    const template = TITLE_MENU_ICON_TEMPLATES[iconId];
    if (!template) {
        return null;
    }

    const menuIconColors = getMenuIconColors();
    return applyTitleMenuIconColorTemplate(template, menuIconColors.fill, menuIconColors.shadow);
}

/**
 * 현재 테마 기준 모든 메뉴 아이콘 소스를 반환합니다.
 * @returns {string[]} 메뉴 아이콘 SVG 소스 목록
 */
export function getAllTitleMenuIconSources() {
    const menuIconColors = getMenuIconColors();
    return Object.keys(TITLE_MENU_ICON_TEMPLATES)
        .map((iconId) => applyTitleMenuIconColorTemplate(
            TITLE_MENU_ICON_TEMPLATES[iconId],
            menuIconColors.fill,
            menuIconColors.shadow
        ));
}

/**
 * 메뉴 식별자에 대응하는 타이틀 메뉴 아이콘 SVG 문자열의 템플릿 키를 반환합니다.
 * @returns {string[]} 아이콘 템플릿 키 목록
 */
export const TITLE_MENU_ICON_SOURCES = Object.freeze(getTitleMenuIconTemplateKeys());
