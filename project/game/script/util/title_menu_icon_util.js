import { getData } from 'data/data_handler.js';

const TITLE_MENU_DATA = getData('TITLE_MENU_DATA');
const TITLE_MENU_ICON_DATA = getData('TITLE_MENU_ICON_DATA');

/**
 * 카드별 아이콘 실제 렌더 스케일을 반환합니다.
 * @param {string} iconId - 아이콘 식별자입니다.
 * @returns {{x:number, y:number, alignX:'left'|'center'}} 아이콘 축별 스케일 값입니다.
 */
export function getTitleMenuIconDrawScale(iconId) {
    const iconDrawScale = TITLE_MENU_DATA.ICON_DRAW_SCALE;
    return iconDrawScale.BY_ID[iconId] || iconDrawScale.DEFAULT;
}

/**
 * 타이틀 메뉴 아이콘 템플릿의 색상 토큰을 실제 색상으로 치환합니다.
 * @param {string} template - 색상 토큰이 포함된 SVG 템플릿입니다.
 * @param {string} fill - 아이콘 메인 채움 색상입니다.
 * @param {string} shadow - 아이콘 그림자 색상입니다.
 * @returns {string} 색상 치환이 완료된 SVG 문자열입니다.
 */
export function applyTitleMenuIconColorTemplate(template, fill, shadow) {
    const colorTokens = TITLE_MENU_ICON_DATA.COLOR_TOKENS;
    return template
        .replaceAll(colorTokens.FILL, fill)
        .replaceAll(colorTokens.SHADOW, shadow);
}
