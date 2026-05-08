import { getSimulationObjectWH, getSimulationWW } from 'simulation/simulation_runtime.js';

/**
 * 적 ID를 직접 지정했는지 확인합니다.
 * @param {object} data - 적 생성 데이터입니다.
 * @returns {boolean}
 */
function hasExplicitEnemyId(data) {
    return Number.isInteger(data?.id) && data.id >= 0;
}

/**
 * 다음 적 ID와 갱신된 카운터를 계산합니다.
 * @param {object} data - 적 생성 데이터입니다.
 * @param {number} enemyIdCounter - 현재 적 ID 카운터입니다.
 * @returns {{enemyId: number, nextEnemyIdCounter: number}}
 */
function resolveObjectSystemEnemyId(data, enemyIdCounter) {
    const hasNumericId = hasExplicitEnemyId(data);
    const safeCounter = Number.isInteger(enemyIdCounter) ? enemyIdCounter : 0;
    const enemyId = hasNumericId ? data.id : safeCounter;
    const nextEnemyIdCounter = hasNumericId && data.id >= safeCounter
        ? data.id + 1
        : safeCounter + (hasNumericId ? 0 : 1);

    return {
        enemyId,
        nextEnemyIdCounter
    };
}

/**
 * 적 기본 위치를 생성합니다.
 * @returns {{x: number, y: number}}
 */
function createDefaultEnemyPosition() {
    return {
        x: getSimulationWW() * 0.5,
        y: getSimulationObjectWH() * 0.5
    };
}

/**
 * 풀에서 획득한 적 인스턴스에 생성 데이터를 주입합니다.
 * @param {object} enemy - 풀에서 획득한 적 인스턴스입니다.
 * @param {string} type - 적 타입입니다.
 * @param {object} data - 적 생성 데이터입니다.
 * @param {number} enemyId - 부여할 적 ID입니다.
 * @param {object} enemyDefaultWeight - 적 타입별 기본 무게입니다.
 * @returns {object}
 */
function initObjectSystemEnemy(enemy, type, data, enemyId, enemyDefaultWeight) {
    enemy.init({
        id: enemyId,
        type,
        hp: data.hp ?? 1,
        maxHp: data.maxHp ?? 1,
        atk: data.atk ?? 1,
        moveSpeed: data.moveSpeed ?? 0,
        accSpeed: data.accSpeed ?? 0,
        size: data.size ?? 1,
        weight: data.weight ?? enemyDefaultWeight?.[type] ?? 1,
        rotationResistance: data.rotationResistance,
        projectileHitsToKill: data.projectileHitsToKill ?? 0,
        position: data.position ?? createDefaultEnemyPosition(),
        speed: data.speed ?? { x: 0, y: 0 },
        acc: data.acc ?? { x: 0, y: 0 },
        status: data.status,
        ai: data.ai ?? null,
        fill: data.fill,
        alpha: data.alpha,
        rotation: data.rotation,
        angularVelocity: data.angularVelocity,
        angularDeceleration: data.angularDeceleration,
        mergeBaseMoveSpeed: data.mergeBaseMoveSpeed,
        hexaHiveLayout: data.hexaHiveLayout
    });
    return enemy;
}

/**
 * 적 풀에서 인스턴스를 획득하고 초기화합니다.
 * @param {{enemyPools: Record<string, object>, type: string, data?: object, enemyIdCounter: number, enemyDefaultWeight: object}} options - 적 획득 옵션입니다.
 * @returns {{enemy: object|null, enemyIdCounter: number}}
 */
export function acquireObjectSystemEnemy(options) {
    const type = options?.type;
    const enemyPools = options?.enemyPools;
    const pool = enemyPools?.[type];
    const currentCounter = Number.isInteger(options?.enemyIdCounter) ? options.enemyIdCounter : 0;
    if (!pool) {
        return {
            enemy: null,
            enemyIdCounter: currentCounter
        };
    }

    const data = options?.data ?? {};
    const { enemyId, nextEnemyIdCounter } = resolveObjectSystemEnemyId(data, currentCounter);
    const enemy = initObjectSystemEnemy(
        pool.get(),
        type,
        data,
        enemyId,
        options?.enemyDefaultWeight ?? {}
    );

    return {
        enemy,
        enemyIdCounter: nextEnemyIdCounter
    };
}

/**
 * 지정 수량만큼 적 ID를 예약합니다.
 * @param {number} enemyIdCounter - 현재 적 ID 카운터입니다.
 * @param {number} [count=1] - 예약할 ID 수량입니다.
 * @returns {{reservedIds: number[], nextEnemyIdCounter: number}}
 */
export function reserveObjectSystemEnemyIds(enemyIdCounter, count = 1) {
    const safeCount = Number.isInteger(count) ? Math.max(0, count) : 0;
    const reservedIds = [];
    let nextEnemyIdCounter = Number.isInteger(enemyIdCounter) ? enemyIdCounter : 0;
    for (let i = 0; i < safeCount; i++) {
        reservedIds.push(nextEnemyIdCounter++);
    }

    return {
        reservedIds,
        nextEnemyIdCounter
    };
}

/**
 * 적 인스턴스를 적절한 풀로 반납합니다.
 * @param {object|null|undefined} enemy - 반납할 적 인스턴스입니다.
 * @param {Record<string, object>} enemyPools - 적 타입별 풀입니다.
 * @param {Map<number, object>} enemyById - 적 ID 캐시입니다.
 * @returns {boolean}
 */
export function releaseObjectSystemEnemyToPool(enemy, enemyPools, enemyById) {
    if (!enemy) {
        return false;
    }

    if (enemy.id !== null && enemy.id !== undefined) {
        enemyById?.delete(enemy.id);
    }

    const pool = enemy.__poolType ? enemyPools?.[enemy.__poolType] : null;
    if (!pool) {
        return false;
    }

    enemy.release();
    pool.release(enemy);
    return true;
}
