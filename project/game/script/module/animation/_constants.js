/**
 * 지원하는 이징(Easing) 함수 타입 이름 목록
 */
export const EASING_TYPES = [
    'linear',
    'easeIn',
    'easeOut',
    'easeInOut',
    'easeInSine',
    'easeOutSine',
    'easeInOutSine',
    'easeInCubic',
    'easeOutCubic',
    'easeInOutCubic',
    'easeInQuart',
    'easeOutQuart',
    'easeInOutQuart',
    'easeInQuint',
    'easeOutQuint',
    'easeInOutQuint',
    'easeInExpo',
    'easeOutExpo',
    'easeInOutExpo',
    'easeInCirc',
    'easeOutCirc',
    'easeInOutCirc',
    'easeInElastic',
    'easeOutElastic',
    'easeInOutElastic',
    'easeInBack',
    'easeOutBack',
    'easeInOutBack',
    'easeInBounce',
    'easeOutBounce',
    'easeInOutBounce'
];

/**
 * 목표값을 초과하여(오버플로우) 움직이는 특성을 가진 이징 타입 목록
 */
export const OVERFLOW_TYPES = [
    'easeInBack',
    'easeOutBack',
    'easeInOutBack',
    'easeInElastic',
    'easeOutElastic',
    'easeInOutElastic'
];

/**
 * 애니메이션의 현재 실행 상태를 나타내는 열거형 상수
 */
export const ANIMATION_STATE = {
    IDLE: 0,
    RUNNING: 1,
    PAUSED: 2,
    FINISHED: 3
};
