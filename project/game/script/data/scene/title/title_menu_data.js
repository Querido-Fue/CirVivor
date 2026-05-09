/**
 * 타이틀 카드 메뉴의 정적 구성 데이터입니다.
 */
export const TITLE_MENU_DATA = Object.freeze({
    CARD_DEFINITIONS: Object.freeze([
        Object.freeze({
            id: 'start',
            layoutSlot: 'start',
            titleKey: 'title_card_start_title',
            descriptionKey: null,
            actionType: 'scene',
            actionKey: 'gameStart',
            placeholder: false
        }),
        Object.freeze({
            id: 'quick_start',
            layoutSlot: 'quick_start',
            titleKey: 'title_card_quick_start_title',
            descriptionKey: 'title_card_quick_start_desc',
            actionType: 'overlay',
            actionKey: 'quickStart',
            placeholder: true
        }),
        Object.freeze({
            id: 'records',
            layoutSlot: 'records',
            titleKey: 'title_card_records_title',
            descriptionKey: null,
            actionType: 'overlay',
            actionKey: 'records',
            placeholder: true
        }),
        Object.freeze({
            id: 'deck',
            layoutSlot: 'deck',
            titleKey: 'title_card_deck_title',
            descriptionKey: 'title_card_deck_desc',
            actionType: 'overlay',
            actionKey: 'deck',
            placeholder: false
        }),
        Object.freeze({
            id: 'research',
            layoutSlot: 'research',
            titleKey: 'title_card_research_title',
            descriptionKey: 'title_card_research_desc',
            actionType: 'overlay',
            actionKey: 'research',
            placeholder: true
        })
    ]),
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
    }),
    OVERLAY_EFFECTS: Object.freeze({
        hoverTilt: Object.freeze({
            maxAngleDeg: 6,
            smoothing: 0.18,
            perspective: 1180
        }),
        hoverSpotlight: Object.freeze({
            radius: 280,
            opacity: 0.8,
            smoothing: 0.2
        }),
        hoverBorder: Object.freeze({
            radius: 280,
            opacity: 0.75,
            width: 1.2,
            hoverWidth: 2.4,
            falloff: 80,
            smoothing: 0.2
        }),
        clickRipple: Object.freeze({
            duration: 0.8
        }),
        hoverParticle: Object.freeze({
            count: 12,
            spawnInterval: 0.08,
            driftDistance: 84,
            minDuration: 1.8,
            maxDuration: 3.2
        })
    })
});
