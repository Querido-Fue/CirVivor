import { CollisionHandler } from './_collision_handler.js';

let physicsSystemInstance = null;

/**
 * @class PhysicsSystem
 * @description 고정 틱 물리 연산(충돌 판정/해소)을 담당합니다.
 */
export class PhysicsSystem {
    constructor() {
        physicsSystemInstance = this;
        this.collisionHandler = new CollisionHandler();
    }

    /**
     * 벽 충돌 체 목록을 설정합니다.
     * @param {object[]} walls
     */
    setWalls(walls = []) {
        this.collisionHandler.setWalls(walls);
    }

    /**
     * 등록된 벽 충돌체 목록을 반환합니다.
     * @returns {object[]}
     */
    getWalls() {
        return this.collisionHandler.getWalls();
    }

    /**
     * 고정 틱 충돌 통계 카운터를 초기화합니다.
     */
    beginFrame() {
        this.collisionHandler.resetFrameStats();
    }

    /**
     * 마지막 고정 틱 충돌 체크 통계를 반환합니다.
     * @returns {{collisionCheckCount:number, aabbPassCount:number, aabbRejectCount:number, circlePassCount:number, circleRejectCount:number, polygonChecks:number}}
     */
    getCollisionStats() {
        return this.collisionHandler.getFrameStats();
    }

    /**
     * 적 충돌을 해소합니다.
     * @param {object[]} enemies
     * @param {object} [options]
     * @returns {number}
     */
    resolveEnemyCollisions(enemies, options = {}) {
        return this.collisionHandler.resolveEnemyCollisions(enemies, options);
    }

    /**
     * 투사체 vs 적 충돌을 처리합니다.
     * @param {object[]} projectiles
     * @param {object[]} enemies
     * @param {number} delta
     * @returns {number}
     */
    resolveProjectileVsEnemies(projectiles, enemies, delta) {
        return this.collisionHandler.resolveProjectileVsEnemies(projectiles, enemies, delta);
    }
}

export const getPhysicsSystem = () => physicsSystemInstance;
