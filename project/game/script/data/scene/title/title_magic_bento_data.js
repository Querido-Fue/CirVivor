/**
 * 타이틀 매직 벤토 카드 정의 데이터입니다.
 */
export const TITLE_MAGIC_BENTO_DATA = Object.freeze({
    CARD_DEFINITIONS: Object.freeze([
        Object.freeze({
            id: 'play',
            icon: 'play',
            variant: 'hero',
            titleKey: 'title_bento_play_title'
        }),
        Object.freeze({
            id: 'quick',
            icon: 'fast-forward',
            variant: 'standard',
            titleKey: 'title_bento_quick_title',
            descriptionKey: 'title_bento_quick_desc'
        }),
        Object.freeze({
            id: 'records',
            icon: 'list',
            variant: 'compact',
            titleKey: 'title_bento_records_title'
        }),
        Object.freeze({
            id: 'deck',
            icon: 'deck',
            variant: 'standard',
            titleKey: 'title_bento_deck_title',
            descriptionKey: 'title_bento_deck_desc'
        }),
        Object.freeze({
            id: 'research',
            icon: 'flask',
            variant: 'standard',
            titleKey: 'title_bento_research_title',
            descriptionKey: 'title_bento_research_desc'
        })
    ])
});
