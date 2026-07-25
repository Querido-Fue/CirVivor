import { TITLE_CARD_MENU_CONSTANTS } from '../_title_runtime_constants.js';

/**
 * 비활성 legacy Magic Bento와 활성 카드 메뉴가 이름·값을 함께 쓰는 모션 상수입니다.
 * Magic Bento 전용 설정은 원본에도 존재하지 않으므로 근거가 있는 공통 필드만 노출합니다.
 */
export const TITLE_MAGIC_BENTO_SHARED_CONSTANTS = Object.freeze({
    APPEAR_START_DELAY_SECONDS: TITLE_CARD_MENU_CONSTANTS.APPEAR_START_DELAY_SECONDS,
    APPEAR_DURATION_SECONDS: TITLE_CARD_MENU_CONSTANTS.APPEAR_DURATION_SECONDS,
    ENTRANCE_START_SCALE: TITLE_CARD_MENU_CONSTANTS.ENTRANCE_START_SCALE,
    ENTRANCE_OFFSET_X_UIWW_RATIO: TITLE_CARD_MENU_CONSTANTS.ENTRANCE_OFFSET_X_UIWW_RATIO,
    ENTRANCE_OFFSET_Y_WH_RATIO: TITLE_CARD_MENU_CONSTANTS.ENTRANCE_OFFSET_Y_WH_RATIO
});

const TITLE_MAGIC_BENTO_REVEAL_KEYS = Object.freeze({
    play: 'start',
    quick: 'quick_start',
    records: 'records',
    deck: 'deck',
    research: 'research'
});

/**
 * Magic Bento 콘텐츠 ID에 대응하는 활성 카드 메뉴의 동일 등장 모션을 반환합니다.
 * @param {string} cardId - Magic Bento 카드 ID입니다.
 * @returns {object|null} legacy 카드 런타임이 소비하는 등장 모션입니다.
 */
export function getTitleMagicBentoEntranceMotion(cardId) {
    const revealKey = TITLE_MAGIC_BENTO_REVEAL_KEYS[cardId];
    const revealConfig = revealKey
        ? TITLE_CARD_MENU_CONSTANTS.REVEAL_CONFIGS[revealKey]
        : null;
    if (!revealConfig) {
        return null;
    }

    return {
        entranceDelaySeconds: revealConfig.delaySeconds,
        entranceDurationSeconds: revealConfig.durationSeconds,
        entranceOffsetXRatio: revealConfig.offsetXRatio,
        entranceOffsetYRatio: revealConfig.offsetYRatio,
        entranceScaleOffset: revealConfig.scaleOffset
    };
}
