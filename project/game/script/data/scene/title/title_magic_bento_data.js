/**
 * 타이틀 매직 벤토 카드 정의 데이터입니다.
 */
export const TITLE_MAGIC_BENTO_DATA = Object.freeze({
    CARD_DEFINITIONS: Object.freeze([
        Object.freeze({
            id: 'play',
            icon: 'play',
            variant: 'hero',
            titleKey: 'title_bento_play_title',
            entranceDelaySeconds: 0,
            entranceDurationSeconds: 0.58,
            entranceOffsetXRatio: 0.01,
            entranceOffsetYRatio: 0.015,
            entranceScaleOffset: 0.06
        }),
        Object.freeze({
            id: 'quick',
            icon: 'fast-forward',
            variant: 'standard',
            titleKey: 'title_bento_quick_title',
            descriptionKey: 'title_bento_quick_desc',
            entranceDelaySeconds: 0.05,
            entranceDurationSeconds: 0.66,
            entranceOffsetXRatio: 0.03,
            entranceOffsetYRatio: -0.01,
            entranceScaleOffset: 0.04
        }),
        Object.freeze({
            id: 'records',
            icon: 'list',
            variant: 'compact',
            titleKey: 'title_bento_records_title',
            entranceDelaySeconds: 0.11,
            entranceDurationSeconds: 0.74,
            entranceOffsetXRatio: 0.04,
            entranceOffsetYRatio: 0.01,
            entranceScaleOffset: 0.02
        }),
        Object.freeze({
            id: 'deck',
            icon: 'deck',
            variant: 'standard',
            titleKey: 'title_bento_deck_title',
            descriptionKey: 'title_bento_deck_desc',
            entranceDelaySeconds: 0.14,
            entranceDurationSeconds: 0.82,
            entranceOffsetXRatio: 0.02,
            entranceOffsetYRatio: 0.03,
            entranceScaleOffset: 0.045
        }),
        Object.freeze({
            id: 'research',
            icon: 'flask',
            variant: 'standard',
            titleKey: 'title_bento_research_title',
            descriptionKey: 'title_bento_research_desc',
            entranceDelaySeconds: 0.19,
            entranceDurationSeconds: 0.9,
            entranceOffsetXRatio: 0.035,
            entranceOffsetYRatio: 0.04,
            entranceScaleOffset: 0.03
        })
    ])
});
