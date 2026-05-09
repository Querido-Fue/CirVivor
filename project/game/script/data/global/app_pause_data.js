/**
 * 앱 레벨 일시정지 이유와 기본 정책 데이터입니다.
 */
export const APP_PAUSE_DATA = Object.freeze({
    REASONS: Object.freeze({
        APP_INACTIVE: 'app-inactive'
    }),
    INACTIVE_POLICY: Object.freeze({
        keepLoopRunning: false,
        pauseBgm: true,
        resetInputOnEnter: true,
        setMouseInactiveOnEnter: true
    })
});
