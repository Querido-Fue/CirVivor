import { getData } from 'data/data_handler.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { applyTitleMenuIconColorTemplate } from 'util/title_menu_icon_util.js';

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
