import { renderGL } from 'display/display_system.js';
import { getObjectSystem } from 'object/object_system.js';
import {
    getSimulationObjectOffsetY,
    getSimulationObjectWH,
    getSimulationWW,
    isSimulationKeyboardPressed
} from 'simulation/simulation_runtime.js';
import { getFixedDelta, getFixedInterpolationAlpha } from 'game/time_handler.js';

/**
 * 현재 런타임 뷰포트를 호출자 소유 객체에 복사합니다.
 * @param {object} [out={}] - 값을 기록할 재사용 객체입니다.
 * @returns {{ww:number,objectWH:number,objectOffsetY:number}} 같은 결과 객체입니다.
 */
function getGameViewportSnapshot(out = {}) {
    out.ww = getSimulationWW();
    out.objectWH = getSimulationObjectWH();
    out.objectOffsetY = getSimulationObjectOffsetY();
    return out;
}

/**
 * 이전 placeholder/benchmark 전역 오브젝트를 비워 신규 플레이 월드를 보장합니다.
 * 이 포트는 전역 ObjectSystem cutover가 끝날 때 제거할 임시 호환 경계입니다.
 * @returns {void}
 */
function clearLegacyObjectWorld() {
    const objectSystem = getObjectSystem();
    if (!objectSystem) {
        return;
    }
    objectSystem.showcaseEnabled = false;
    objectSystem.clearEnemies?.();
    objectSystem.setPlayers?.([]);
    objectSystem.setItems?.([]);
    objectSystem.setProjectiles?.([]);
    objectSystem.setWalls?.([]);
}

/**
 * 플레이 GameScene과 GameSystem 사이의 엔진 adapter 묶음을 생성합니다.
 * @returns {object} GameSystem dependency bundle입니다.
 */
export function createGameSceneDependencies() {
    const circleRenderOptions = {
        shape: 'circle',
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        fill: null,
        alpha: 1
    };

    return {
        inputActionSource: {
            isPressed: isSimulationKeyboardPressed
        },
        timePort: {
            getFixedDelta,
            getFixedInterpolationAlpha
        },
        viewportPort: {
            getSnapshot: getGameViewportSnapshot
        },
        worldRenderPort: {
            drawCircle(options) {
                circleRenderOptions.x = options.x;
                circleRenderOptions.y = options.y;
                circleRenderOptions.w = options.diameter;
                circleRenderOptions.h = options.diameter;
                circleRenderOptions.fill = options.fill;
                circleRenderOptions.alpha = options.alpha;
                renderGL(options.layer, circleRenderOptions);
            }
        },
        legacyWorldPort: {
            clear: clearLegacyObjectWorld
        }
    };
}
