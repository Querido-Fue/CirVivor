/**
 * 지원하는 이징(Easing) 함수 타입 이름 목록
 * @type {ReadonlyArray<string>}
 */
export const EASING_TYPES = Object.freeze([
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
]);

/**
 * 목표값을 초과하여(오버플로우) 움직이는 특성을 가진 이징 타입 목록
 * @type {ReadonlyArray<string>}
 */
export const OVERFLOW_TYPES = Object.freeze([
    'easeInBack',
    'easeOutBack',
    'easeInOutBack',
    'easeInElastic',
    'easeOutElastic',
    'easeInOutElastic'
]);

/**
 * 애니메이션이 사용하는 시간 축의 의미를 나타내는 안정적인 카테고리 ID입니다.
 * @type {Readonly<{UI:string, GAME_MECHANIC:string, EFFECT:string}>}
 */
export const ANIMATION_CATEGORY = Object.freeze({
    UI: 'ui',
    GAME_MECHANIC: 'game-mechanic',
    EFFECT: 'effect'
});

/**
 * 값이 지원되는 애니메이션 카테고리 ID인지 확인합니다.
 * @param {*} value - 확인할 값입니다.
 * @returns {boolean} 지원되는 카테고리이면 true입니다.
 */
export function isAnimationCategory(value) {
    return value === ANIMATION_CATEGORY.UI
        || value === ANIMATION_CATEGORY.GAME_MECHANIC
        || value === ANIMATION_CATEGORY.EFFECT;
}

/**
 * 애니메이션의 현재 실행 상태를 나타내는 열거형 상수
 * @type {Readonly<{IDLE:number, RUNNING:number, PAUSED:number, FINISHED:number}>}
 */
export const ANIMATION_STATE = Object.freeze({
    IDLE: 0,
    RUNNING: 1,
    PAUSED: 2,
    FINISHED: 3
});
