import { TITLE_MENU_ICON_COLOR_TOKENS } from 'scene/title/menu/_title_menu_icon_assets.js';

const TITLE_MENU_ICON_DRAW_SCALE = Object.freeze({
    DEFAULT: Object.freeze({
        x: 1,
        y: 1,
        alignX: 'center'
    }),
    BY_ID: Object.freeze({
        research: Object.freeze({ x: 0.9, y: 1, alignX: 'left' }),
        records: Object.freeze({ x: 0.85, y: 0.85, alignX: 'center' })
    })
});

/**
 * 카드별 아이콘 실제 렌더 스케일을 반환합니다.
 * @param {string} iconId - 아이콘 식별자입니다.
 * @returns {{x:number, y:number, alignX:'left'|'center'}} 아이콘 축별 스케일 값입니다.
 */
export function getTitleMenuIconDrawScale(iconId) {
    return TITLE_MENU_ICON_DRAW_SCALE.BY_ID[iconId] || TITLE_MENU_ICON_DRAW_SCALE.DEFAULT;
}

/**
 * 타이틀 메뉴 아이콘 템플릿의 색상 토큰을 실제 색상으로 치환합니다.
 * @param {string} template - 색상 토큰이 포함된 SVG 템플릿입니다.
 * @param {string} fill - 아이콘 메인 채움 색상입니다.
 * @param {string} shadow - 아이콘 그림자 색상입니다.
 * @returns {string} 색상 치환이 완료된 SVG 문자열입니다.
 */
export function applyTitleMenuIconColorTemplate(template, fill, shadow) {
    return template
        .replaceAll(TITLE_MENU_ICON_COLOR_TOKENS.FILL, fill)
        .replaceAll(TITLE_MENU_ICON_COLOR_TOKENS.SHADOW, shadow);
}
