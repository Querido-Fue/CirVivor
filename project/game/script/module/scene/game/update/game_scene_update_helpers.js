import { getData } from 'data/data_handler.js';
import {
    getSimulationMouseInput,
    hasSimulationMouseState
} from 'simulation/simulation_runtime.js';
import { isPointInRect } from 'util/geometry_util.js';

const PROJECTILE_CULL_MARGIN_RATIO = getData('GAME_SCENE_CONSTANTS').PROJECTILE.CULL_MARGIN_RATIO;

/**
 * 현재 마우스 입력으로 벤치마크 버튼 클릭을 처리합니다.
 * @param {object[]} buttons - 버튼 목록입니다.
 * @returns {boolean} 버튼 클릭 처리 여부입니다.
 */
export function updateGameSceneButtonInput(buttons) {
    const mousePos = getSimulationMouseInput('pos');
    const clicked = hasSimulationMouseState('left', 'clicked');
    if (!clicked || !mousePos || !Array.isArray(buttons)) {
        return false;
    }

    for (let i = 0; i < buttons.length; i++) {
        const button = buttons[i];
        if (button && isPointInRect(mousePos.x, mousePos.y, button)) {
            button.onClick();
            return true;
        }
    }

    return false;
}

/**
 * 화면 밖으로 나가거나 비활성화된 로컬 투사체를 제거합니다.
 * @param {object} scene - 게임 씬 인스턴스입니다.
 */
export function cullLocalGameSceneProjectiles(scene) {
    if (!scene || !Array.isArray(scene.projectiles)) {
        return;
    }

    const cullMinX = -scene.WW * PROJECTILE_CULL_MARGIN_RATIO;
    const cullMaxX = scene.WW * (1 + PROJECTILE_CULL_MARGIN_RATIO);
    const cullMinY = -scene.objectWH * PROJECTILE_CULL_MARGIN_RATIO;
    const cullMaxY = scene.objectWH * (1 + PROJECTILE_CULL_MARGIN_RATIO);
    for (let i = scene.projectiles.length - 1; i >= 0; i--) {
        const projectile = scene.projectiles[i];
        if (!projectile || projectile.active === false) {
            scene.projectiles.splice(i, 1);
            continue;
        }

        const x = projectile.position.x;
        const y = projectile.position.y;
        if (x < cullMinX || x > cullMaxX || y < cullMinY || y > cullMaxY) {
            scene.projectiles.splice(i, 1);
        }
    }
}

/**
 * ObjectSystem의 최신 충돌 통계를 씬 상태로 동기화합니다.
 * @param {object} scene - 게임 씬 인스턴스입니다.
 */
export function syncGameSceneCollisionStats(scene) {
    if (scene?.objectSystem && typeof scene.objectSystem.getCollisionStats === 'function') {
        scene.collisionStats = scene.objectSystem.getCollisionStats();
    }
}
