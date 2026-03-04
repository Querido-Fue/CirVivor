/**
 * 사운드 및 배경음악 설정 상수 모음
 */
export const SOUND_CONSTANTS = Object.freeze({
    BGM: Object.freeze({
        PATH: './audio/bgm.mp3',
        DEFAULT_VOLUME: 100,
        UNLOCK_EVENTS: Object.freeze(['pointerdown', 'keydown', 'touchstart'])
    })
});
