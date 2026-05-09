/**
 * 타이틀 카드 메뉴의 정적 구성 데이터입니다.
 */
export const TITLE_MENU_DATA = Object.freeze({
    CARD_REVEAL_ORDER: Object.freeze([
        'start',
        'quick_start',
        'records',
        'deck',
        'research'
    ]),
    SECONDARY_ENTRIES: Object.freeze([
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
    ]),
    ICON_DRAW_SCALE: Object.freeze({
        DEFAULT: Object.freeze({
            x: 1,
            y: 1,
            alignX: 'center'
        }),
        BY_ID: Object.freeze({
            research: Object.freeze({ x: 0.9, y: 1, alignX: 'left' }),
            records: Object.freeze({ x: 0.85, y: 0.85, alignX: 'center' })
        })
    }),
    LAYOUT: Object.freeze({
        CARD_MENU_SCALE: 0.848
    })
});
