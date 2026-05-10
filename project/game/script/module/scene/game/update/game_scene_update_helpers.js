import { getData } from 'data/data_handler.js';
import {
    getSimulationMouseInput,
    hasSimulationMouseState
} from 'simulation/simulation_runtime.js';
import { isPointInRect } from 'util/geometry_util.js';

const PROJECTILE_CULL_MARGIN_RATIO = getData('GAME_SCENE_CONSTANTS').PROJECTILE.CULL_MARGIN_RATIO;
const GAME_SCENE_BUTTON_MOUSE_BUTTON = 'left';
const GAME_SCENE_BUTTON_CLICK_STATE = 'clicked';

/**
 * 버튼이 현재 마우스 위치에 닿아 있으면 클릭 콜백을 실행합니다.
 * @param {object|null|undefined} button - 벤치마크 버튼 데이터입니다.
 * @param {{x:number, y:number}} mousePos - 현재 마우스 위치입니다.
 * @returns {boolean} 클릭 콜백 실행 여부입니다.
 */
function triggerGameSceneButtonIfHit(button, mousePos) {
    if (!button || typeof button.onClick !== 'function') {
        return false;
    }
    if (!isPointInRect(mousePos.x, mousePos.y, button)) {
        return false;
    }

    button.onClick();
    return true;
}

/**
 * 로컬 투사체 제거 판정에 사용할 월드 경계를 계산합니다.
 * @param {object} scene - 게임 씬 인스턴스입니다.
 * @returns {{minX:number, maxX:number, minY:number, maxY:number}} 투사체 제거 경계입니다.
 */
function createProjectileCullBounds(scene) {
    return {
        minX: -scene.WW * PROJECTILE_CULL_MARGIN_RATIO,
        maxX: scene.WW * (1 + PROJECTILE_CULL_MARGIN_RATIO),
        minY: -scene.objectWH * PROJECTILE_CULL_MARGIN_RATIO,
        maxY: scene.objectWH * (1 + PROJECTILE_CULL_MARGIN_RATIO)
    };
}

/**
 * 로컬 투사체를 제거해야 하는지 확인합니다.
 * @param {object|null|undefined} projectile - 투사체 인스턴스입니다.
 * @param {{minX:number, maxX:number, minY:number, maxY:number}} bounds - 제거 경계입니다.
 * @returns {boolean} 제거 여부입니다.
 */
function shouldCullLocalProjectile(projectile, bounds) {
    if (!projectile || projectile.active === false || !projectile.position) {
        return true;
    }

    const x = projectile.position.x;
    const y = projectile.position.y;
    return x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY;
}

/**
 * 현재 마우스 입력으로 벤치마크 버튼 클릭을 처리합니다.
 * @param {object[]} buttons - 버튼 목록입니다.
 * @returns {boolean} 버튼 클릭 처리 여부입니다.
 */
export function updateGameSceneButtonInput(buttons) {
    const mousePos = getSimulationMouseInput('pos');
    const clicked = hasSimulationMouseState(GAME_SCENE_BUTTON_MOUSE_BUTTON, GAME_SCENE_BUTTON_CLICK_STATE);
    if (!clicked || !mousePos || !Array.isArray(buttons)) {
        return false;
    }

    for (let i = 0; i < buttons.length; i++) {
        if (triggerGameSceneButtonIfHit(buttons[i], mousePos)) {
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

    const bounds = createProjectileCullBounds(scene);
    for (let i = scene.projectiles.length - 1; i >= 0; i--) {
        if (shouldCullLocalProjectile(scene.projectiles[i], bounds)) {
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
