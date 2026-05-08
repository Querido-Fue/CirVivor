/**
 * 타이틀 카드 등장 순서입니다.
 * @type {readonly string[]}
 */
export const TITLE_MENU_CARD_REVEAL_ORDER = Object.freeze([
    'start',
    'quick_start',
    'records',
    'deck',
    'research'
]);

/**
 * 하단 보조 메뉴 항목 정의입니다.
 * @type {readonly object[]}
 */
export const TITLE_MENU_SECONDARY_ENTRIES = Object.freeze([
    Object.freeze({
        id: 'setting',
        textKey: 'title_settings_title',
        actionType: 'overlay',
        actionKey: 'setting'
    }),
    Object.freeze({
        id: 'credits',
        textKey: 'title_credits_title',
        actionType: 'overlay',
        actionKey: 'credits'
    }),
    Object.freeze({
        id: 'achievements',
        textKey: 'title_menu_achievements',
        actionType: 'overlay',
        actionKey: 'achievements'
    }),
    Object.freeze({
        id: 'exit',
        textKey: 'exit_title',
        actionType: 'exit',
        actionKey: null
    })
]);

const DEFAULT_ICON_DRAW_SCALE = Object.freeze({
    x: 1,
    y: 1,
    alignX: 'center'
});

const TITLE_MENU_ICON_DRAW_SCALES = Object.freeze({
    research: Object.freeze({ x: 0.9, y: 1, alignX: 'left' }),
    records: Object.freeze({ x: 0.85, y: 0.85, alignX: 'center' })
});

/**
 * 카드별 아이콘 실제 렌더 스케일을 반환합니다.
 * @param {string} cardId - 카드 식별자입니다.
 * @returns {{x:number, y:number, alignX:'left'|'center'}} 아이콘 축별 스케일 값입니다.
 */
export function getTitleMenuIconDrawScale(cardId) {
    return TITLE_MENU_ICON_DRAW_SCALES[cardId] || DEFAULT_ICON_DRAW_SCALE;
}
