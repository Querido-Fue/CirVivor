/**
 * Shop overlay가 gameplay authority에 요청할 수 있는 의미 명령입니다.
 * DOM key나 pointer 좌표는 이 경계를 통과하지 않습니다.
 */
export const SHOP_UI_COMMAND_TYPE = Object.freeze({
    BUY_OFFER: 'BUY_OFFER',
    REROLL: 'REROLL',
    SELECT_INVENTORY_WORD: 'SELECT_INVENTORY_WORD',
    PLACE_SUBJECT: 'PLACE_SUBJECT',
    PLACE_VERB: 'PLACE_VERB',
    PLACE_PAYLOAD: 'PLACE_PAYLOAD',
    ADD_MODIFIER: 'ADD_MODIFIER',
    REMOVE_MODIFIER: 'REMOVE_MODIFIER',
    UPGRADE_WORD: 'UPGRADE_WORD',
    APPLY_BOARD: 'APPLY_BOARD',
    DISCARD_DRAFT: 'DISCARD_DRAFT',
    CONTINUE: 'CONTINUE'
});

export const SHOP_UI_COMMAND_TYPES = Object.freeze(
    Object.values(SHOP_UI_COMMAND_TYPE)
);

/** GameSystem의 command adapter가 반환하는 UI 전용 결과 코드입니다. */
export const SHOP_UI_COMMAND_RESULT_CODE = Object.freeze({
    SELECTED: 'SELECTED',
    PLACED: 'PLACED',
    MODIFIER_ADDED: 'MODIFIER_ADDED',
    MODIFIER_REMOVED: 'MODIFIER_REMOVED',
    DRAFT_DISCARDED: 'DRAFT_DISCARDED',
    WRONG_PHASE: 'WRONG_PHASE',
    INVALID_COMMAND: 'INVALID_COMMAND',
    STALE_BOARD_REVISION: 'STALE_BOARD_REVISION',
    TRANSACTION_CONFLICT: 'TRANSACTION_CONFLICT',
    DESTROYED: 'DESTROYED'
});

/** @returns {boolean} 알려진 R8 Shop UI command인지 여부입니다. */
export function isShopUiCommandType(value) {
    return SHOP_UI_COMMAND_TYPES.includes(value);
}
