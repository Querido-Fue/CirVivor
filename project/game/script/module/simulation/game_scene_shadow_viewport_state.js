import {
    getSimulationObjectOffsetY,
    getSimulationObjectWH,
    getSimulationWH,
    getSimulationWW
} from './simulation_runtime.js';

/**
 * 현재 런타임 뷰포트를 씬 스냅샷에 반영합니다.
 * @param {object|null|undefined} state - 갱신할 게임 씬 shadow 상태입니다.
 */
export function syncShadowStateViewportFromRuntime(state) {
    if (!state || typeof state !== 'object') {
        return;
    }

    state.viewport = state.viewport && typeof state.viewport === 'object'
        ? state.viewport
        : {
            ww: 0,
            wh: 0,
            objectWH: 0,
            objectOffsetY: 0
        };
    state.viewport.ww = getSimulationWW();
    state.viewport.wh = getSimulationWH();
    state.viewport.objectWH = getSimulationObjectWH();
    state.viewport.objectOffsetY = getSimulationObjectOffsetY();
}

/**
 * 뷰포트 스냅샷을 기존 객체에 in-place로 반영합니다.
 * @param {object} targetViewport - 갱신할 viewport 객체입니다.
 * @param {object|null|undefined} sourceViewport - 원본 viewport 스냅샷입니다.
 */
export function assignShadowViewport(targetViewport, sourceViewport) {
    if (!targetViewport || !sourceViewport || typeof sourceViewport !== 'object') {
        return;
    }

    if (Number.isFinite(sourceViewport.ww)) targetViewport.ww = sourceViewport.ww;
    if (Number.isFinite(sourceViewport.wh)) targetViewport.wh = sourceViewport.wh;
    if (Number.isFinite(sourceViewport.objectWH)) targetViewport.objectWH = sourceViewport.objectWH;
    if (Number.isFinite(sourceViewport.objectOffsetY)) targetViewport.objectOffsetY = sourceViewport.objectOffsetY;
}

/**
 * 카운터 스냅샷을 기존 객체에 in-place로 반영합니다.
 * @param {object} targetCounters - 갱신할 counter 객체입니다.
 * @param {object|null|undefined} sourceCounters - 원본 counter 스냅샷입니다.
 */
export function assignShadowCounters(targetCounters, sourceCounters) {
    if (!targetCounters || !sourceCounters || typeof sourceCounters !== 'object') {
        return;
    }

    if (Number.isInteger(sourceCounters.enemyIdCounter)) targetCounters.enemyIdCounter = sourceCounters.enemyIdCounter;
    if (Number.isInteger(sourceCounters.wallIdCounter)) targetCounters.wallIdCounter = sourceCounters.wallIdCounter;
    if (Number.isInteger(sourceCounters.projIdCounter)) targetCounters.projIdCounter = sourceCounters.projIdCounter;
}
