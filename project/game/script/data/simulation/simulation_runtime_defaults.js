/**
 * 시뮬레이션 런타임 스냅샷 정규화에 사용하는 기본값입니다.
 */
export const SIMULATION_RUNTIME_DEFAULTS = Object.freeze({
    MOUSE_BUTTON_STATE: Object.freeze(['idle']),
    FOCUS_LIST: Object.freeze(['ui', 'object']),
    MOUSE_POSITION: Object.freeze({
        x: 0,
        y: 0
    }),
    VIEWPORT: Object.freeze({
        ww: 0,
        wh: 0,
        objectWH: 0,
        objectOffsetY: 0,
        uiww: 0,
        uiOffsetX: 0
    })
});
