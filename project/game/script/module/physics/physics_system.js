import { CollisionHandler } from './_collision_handler.js';

let physicsSystemInstance = null;

/**
 * @class PhysicsSystem
 * @description 고정 틱 물리 연산(충돌 판정/해소)을 담당합니다.
 */
export class PhysicsSystem {
    /**
     * 충돌 핸들러를 생성하고 physics system singleton을 등록합니다.
     */
    constructor() {
        physicsSystemInstance = this;
        this.collisionHandler = new CollisionHandler();
    }

    /**
     * 벽 충돌체 목록의 live 참조를 설정하고 wall body cache를 무효화합니다.
     * @param {object[]} walls
     * @returns {void}
     */
    setWalls(walls = []) {
        this.collisionHandler.setWalls(walls);
    }

    /**
     * 등록된 벽 충돌체 목록을 반환합니다.
     * @returns {object[]} 등록 시 전달된 동일한 가변 배열 참조
     */
    getWalls() {
        return this.collisionHandler.getWalls();
    }

    /**
     * 새 고정 틱을 시작합니다. 프로파일링 활성 상태를 동기화하고 충돌 통계를
     * 초기화하며, enemy body cache 세대·fixed-frame token·pair-pass cursor를 전진시킵니다.
     * @returns {void}
     */
    beginFrame() {
        this.collisionHandler.resetFrameStats();
    }

    /**
     * 마지막 고정 틱의 기본 및 선택적 프로파일 충돌 통계 스냅샷을 반환합니다.
     * 설정된 모든 통계 필드는 유효한 숫자로 정규화됩니다.
     * @returns {Object.<string, number>}
     */
    getCollisionStats() {
        return this.collisionHandler.getFrameStats();
    }

    /**
     * contact와 본 solve가 공유할 enemy collision frame을 준비합니다.
     * @param {object[]} enemies - 현재 fixed tick의 전체 적 목록입니다.
     * @param {{delta?:number}} [options] - fixed step 옵션입니다.
     * @returns {number} 준비한 활성 enemy body 수입니다.
     */
    prepareEnemyCollisionFrame(enemies, options = {}) {
        return this.collisionHandler.prepareEnemyCollisionFrame(enemies, options);
    }

    /**
     * 적 충돌을 해소하고 전달된 충돌체의 위치·속도·회전 및 sleep 상태를 갱신합니다.
     * @param {object[]} enemies
     * @param {object} [options]
     * @param {number} [options.delta=1/60]
     * @param {object[]} [options.players=[]]
     * @returns {number} 처리된 충돌 건수
     */
    resolveEnemyCollisions(enemies, options = {}) {
        return this.collisionHandler.resolveEnemyCollisions(enemies, options);
    }

    /**
     * 고속 스윕으로 투사체 vs 적 충돌을 처리합니다. 중복 타격 상태와 피격 수를
     * 갱신하며, 임계치에 도달한 적은 비활성화될 수 있습니다.
     * @param {object[]} projectiles
     * @param {object[]} enemies
     * @param {number} [delta=1/60]
     * @returns {number} 처리된 신규 타격 건수
     */
    resolveProjectileVsEnemies(projectiles, enemies, delta) {
        return this.collisionHandler.resolveProjectileVsEnemies(projectiles, enemies, delta);
    }

    /**
     * 적 목록 중 실제 접촉 중인 적 쌍을 exact 판정으로 수집합니다.
     * @param {object[]} enemies
     * @param {{delta?: number}} [options]
     * @returns {{enemyA: object, enemyB: object}[]} 다음 contact 조회 전까지 유효한 재사용 결과 배열입니다.
     */
    collectEnemyContactPairs(enemies, options = {}) {
        return this.collisionHandler.collectEnemyContactPairs(enemies, options);
    }

    /**
     * ObjectSystem이 이번 fixed frame에 준비한 hexa merge 후보의 boolean contact를 수집합니다.
     * prepared cache miss는 기존 공개 contact 판정으로 복구합니다.
     * @internal
     * @param {object[]} enemies
     * @param {{delta?: number}} [options]
     * @returns {{enemyA: object, enemyB: object}[]} 다음 contact 조회 전까지 유효한 재사용 결과 배열입니다.
     */
    collectPreparedHexaHiveContactPairs(enemies, options = {}) {
        return this.collisionHandler.collectPreparedHexaHiveContactPairs(enemies, options);
    }
}

/**
 * 가장 최근 생성된 physics system을 반환합니다.
 * `PhysicsSystem` 생성 전에는 `null`입니다.
 * @returns {PhysicsSystem|null}
 */
export const getPhysicsSystem = () => physicsSystemInstance;
