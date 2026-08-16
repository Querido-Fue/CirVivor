/**
 * 물리 입력과 분리된 전역 의미 입력 ID입니다.
 * GameSystem과 DebugSystem 같은 소비자는 DOM KeyboardEvent.code를 직접 참조하지 않습니다.
 */
export const INPUT_ACTION_IDS = Object.freeze({
    MOVE_UP: 'moveUp',
    MOVE_DOWN: 'moveDown',
    MOVE_LEFT: 'moveLeft',
    MOVE_RIGHT: 'moveRight',
    PRIMARY_ACTION: 'primaryAction',
    SKILL_SHIFT: 'skillShift',
    SKILL_SPACE: 'skillSpace',
    SKILL_Q: 'skillQ',
    SKILL_E: 'skillE',
    PAUSE: 'pause',
    RELOAD: 'reload',
    DEBUG_PAUSE: 'debugPause',
    DEBUG_STEP: 'debugStep'
});

/**
 * 사용자 설정 오버라이드가 없을 때 사용할 기본 키 배치입니다.
 * KeyboardEvent.code를 사용하므로 키보드 문자 배열이나 대소문자에 영향을 받지 않습니다.
 */
export const DEFAULT_KEYBOARD_BINDINGS = Object.freeze({
    [INPUT_ACTION_IDS.MOVE_UP]: Object.freeze(['KeyW', 'ArrowUp']),
    [INPUT_ACTION_IDS.MOVE_DOWN]: Object.freeze(['KeyS', 'ArrowDown']),
    [INPUT_ACTION_IDS.MOVE_LEFT]: Object.freeze(['KeyA', 'ArrowLeft']),
    [INPUT_ACTION_IDS.MOVE_RIGHT]: Object.freeze(['KeyD', 'ArrowRight']),
    [INPUT_ACTION_IDS.PRIMARY_ACTION]: Object.freeze(['Space']),
    [INPUT_ACTION_IDS.SKILL_SHIFT]: Object.freeze(['ShiftLeft', 'ShiftRight']),
    [INPUT_ACTION_IDS.SKILL_SPACE]: Object.freeze(['Space']),
    [INPUT_ACTION_IDS.SKILL_Q]: Object.freeze(['KeyQ']),
    [INPUT_ACTION_IDS.SKILL_E]: Object.freeze(['KeyE']),
    [INPUT_ACTION_IDS.PAUSE]: Object.freeze(['KeyP']),
    [INPUT_ACTION_IDS.RELOAD]: Object.freeze(['KeyR']),
    [INPUT_ACTION_IDS.DEBUG_PAUSE]: Object.freeze(['Slash']),
    [INPUT_ACTION_IDS.DEBUG_STEP]: Object.freeze(['Period'])
});

/**
 * 기존 의미 키 API를 새 action ID로 연결하는 임시 호환 별칭입니다.
 * 물리 키는 아니며 legacy/benchmark 호출부 cutover가 끝나면 제거할 수 있습니다.
 */
export const LEGACY_INPUT_ACTION_ALIASES = Object.freeze({
    up: INPUT_ACTION_IDS.MOVE_UP,
    down: INPUT_ACTION_IDS.MOVE_DOWN,
    left: INPUT_ACTION_IDS.MOVE_LEFT,
    right: INPUT_ACTION_IDS.MOVE_RIGHT,
    space: INPUT_ACTION_IDS.PRIMARY_ACTION
});
