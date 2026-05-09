const MOUSE_BUTTON_STATE_LISTS = Object.freeze({
    inactive: Object.freeze(['inactive']),
    idle: Object.freeze(['idle']),
    click: Object.freeze(['click', 'clicking']),
    clicking: Object.freeze(['clicking']),
    clicked: Object.freeze(['idle', 'clicked'])
});

const MOUSE_BUTTON_CODES = Object.freeze({
    0: 'left',
    1: 'middle',
    2: 'right'
});

/**
 * 마우스 버튼 상태머신에서 사용하는 정적 상태 목록과 DOM 버튼 코드 매핑입니다.
 */
export const MOUSE_BUTTON_INPUT_DATA = Object.freeze({
    STATE_LISTS: MOUSE_BUTTON_STATE_LISTS,
    BUTTON_CODES: MOUSE_BUTTON_CODES
});
