import { getSimulationObjectWH, getSimulationWW } from './simulation_runtime.js';
import { DEFAULT_OUTSIDE_CULL_RATIO } from './game_scene_shadow_enemy_system.js';

const PROJECTILE_CULL_MARGIN_RATIO = 0.2;

/**
 * 적의 렌더 좌표를 보간합니다.
 * @param {object|null|undefined} enemy - 적 상태입니다.
 * @param {number} alpha - 고정 스텝 보간 계수입니다.
 */
function interpolateShadowEnemyRenderPosition(enemy, alpha) {
    if (!enemy || typeof enemy !== 'object') {
        return;
    }

    const t = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
    enemy.renderPosition.x = enemy.prevPosition.x + ((enemy.position.x - enemy.prevPosition.x) * t);
    enemy.renderPosition.y = enemy.prevPosition.y + ((enemy.position.y - enemy.prevPosition.y) * t);
}

/**
 * 화면 밖으로 벗어난 적을 제거합니다.
 * @param {object} nextState - 게임 씬 shadow 상태입니다.
 */
export function cullAuthorityShadowEnemies(nextState) {
    const ww = Number.isFinite(nextState.viewport?.ww) ? nextState.viewport.ww : getSimulationWW();
    const objectWH = Number.isFinite(nextState.viewport?.objectWH) ? nextState.viewport.objectWH : getSimulationObjectWH();
    const outsideRatio = Number.isFinite(nextState.enemySystem?.enemyCullOutsideRatio)
        ? nextState.enemySystem.enemyCullOutsideRatio
        : DEFAULT_OUTSIDE_CULL_RATIO;
    const marginX = ww * outsideRatio;
    const marginY = objectWH * outsideRatio;

    let nextEnemyCount = 0;
    for (let i = 0; i < nextState.enemies.length; i++) {
        const enemy = nextState.enemies[i];
        if (!enemy || enemy.active === false) {
            continue;
        }

        const isOutside = enemy.position.x < -marginX
            || enemy.position.x > ww + marginX
            || enemy.position.y < -marginY
            || enemy.position.y > objectWH + marginY;
        if (isOutside) {
            continue;
        }

        nextState.enemies[nextEnemyCount] = enemy;
        nextEnemyCount++;
    }
    nextState.enemies.length = nextEnemyCount;
}

/**
 * 화면 밖으로 벗어난 투사체를 제거합니다.
 * @param {object} nextState - 게임 씬 shadow 상태입니다.
 */
export function cullAuthorityShadowProjectiles(nextState) {
    const ww = Number.isFinite(nextState.viewport?.ww) ? nextState.viewport.ww : getSimulationWW();
    const objectWH = Number.isFinite(nextState.viewport?.objectWH) ? nextState.viewport.objectWH : getSimulationObjectWH();
    const cullMinX = -ww * PROJECTILE_CULL_MARGIN_RATIO;
    const cullMaxX = ww * (1 + PROJECTILE_CULL_MARGIN_RATIO);
    const cullMinY = -objectWH * PROJECTILE_CULL_MARGIN_RATIO;
    const cullMaxY = objectWH * (1 + PROJECTILE_CULL_MARGIN_RATIO);

    let nextProjectileCount = 0;
    for (let i = 0; i < nextState.projectiles.length; i++) {
        const projectile = nextState.projectiles[i];
        if (!projectile || projectile.active === false) {
            continue;
        }

        const x = projectile.position.x;
        const y = projectile.position.y;
        const isOutside = x < cullMinX || x > cullMaxX || y < cullMinY || y > cullMaxY;
        if (isOutside) {
            continue;
        }

        nextState.projectiles[nextProjectileCount] = projectile;
        nextProjectileCount++;
    }
    nextState.projectiles.length = nextProjectileCount;
}

/**
 * 권한 모드 프레젠테이션용 렌더 좌표를 계산합니다.
 * @param {object} nextState - 게임 씬 shadow 상태입니다.
 * @param {number} fixedAlpha - 고정 스텝 보간 계수입니다.
 */
export function updateAuthorityPresentationState(nextState, fixedAlpha) {
    for (let i = 0; i < nextState.enemies.length; i++) {
        interpolateShadowEnemyRenderPosition(nextState.enemies[i], fixedAlpha);
    }
}
