/**
 * 오버레이 버튼에 공통으로 사용되는 테마 속성
 */
export const OVERLAY_BUTTON_COMMON = Object.freeze({
    Confirm: Object.freeze({
        Idle: '#166ffb',
        Hover: '#4d94ff',
        Text: '#ffffff'
    }),
    Cancel: Object.freeze({
        Idle: '#ff5050',
        Hover: '#ff7a7a',
        Text: '#ffffff'
    })
});

/**
 * 라이트 테마의 타이틀 버튼 마우스 오버 효과 스타일
 */
export const LIGHT_TITLE_BUTTON_HOVER = Object.freeze({
    type: 'linear',
    stops: [
        Object.freeze({ offset: 0, color: 'rgba(0, 0, 0, 0.1)' }),
        Object.freeze({ offset: 0.8, color: 'rgba(0, 0, 0, 0.1)' }),
        Object.freeze({ offset: 1, color: 'rgba(0, 0, 0, 0)' })
    ]
});

/**
 * 다크 테마의 타이틀 버튼 마우스 오버 효과 스타일
 */
export const DARK_TITLE_BUTTON_HOVER = Object.freeze({
    type: 'linear',
    stops: [
        Object.freeze({ offset: 0, color: 'rgba(255, 255, 255, 0.2)' }),
        Object.freeze({ offset: 0.8, color: 'rgba(255, 255, 255, 0.2)' }),
        Object.freeze({ offset: 1, color: 'rgba(255, 255, 255, 0)' })
    ]
});
