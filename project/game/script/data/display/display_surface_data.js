/**
 * display surface descriptor 생성과 정렬에 사용하는 정적 레이어 데이터입니다.
 */
export const DISPLAY_SURFACE_DATA = Object.freeze({
    WEBGL_LAYER_NAME_MAP: Object.freeze({
        main: 'object',
        mainGL: 'object',
        backgroundGL: 'background',
        effectGL: 'effect'
    }),
    NATIVE_2D_SURFACE_IDS: Object.freeze(['texteffect', 'ui', 'vignette', 'top']),
    STATIC_SURFACE_ORDER_MAP: Object.freeze({
        background: 0,
        object: 10,
        effect: 20,
        texteffect: 30,
        ui: 40,
        top: 1000
    })
});
