import { getData } from 'data/data_handler.js';
import { ObjectPool } from '../_object_pool.js';
import { ArrowEnemy } from './_arrow_enemy.js';
import { GenEnemy } from './_gen_enemy.js';
import { HexaEnemy } from './_hexa_enemy.js';
import { HexaHiveEnemy } from './_hexa_hive_enemy.js';
import { OctaEnemy } from './_octa_enemy.js';
import { PentaEnemy } from './_penta_enemy.js';
import { RhomEnemy } from './_rhom_enemy.js';
import { SquareEnemy } from './_square_enemy.js';
import { TriangleEnemy } from './_triangle_enemy.js';
import { getHexaHiveType } from './_hexa_hive_layout.js';

const ENEMY_SHAPE_TYPES = getData('ENEMY_SHAPE_TYPES');
const ENEMY_CONSTANTS = getData('ENEMY_CONSTANTS');
const HEXA_HIVE_TYPE = getHexaHiveType();
const ENEMY_CLASS_BY_TYPE = Object.freeze({
    square: SquareEnemy,
    triangle: TriangleEnemy,
    arrow: ArrowEnemy,
    hexa: HexaEnemy,
    [HEXA_HIVE_TYPE]: HexaHiveEnemy,
    penta: PentaEnemy,
    rhom: RhomEnemy,
    octa: OctaEnemy,
    gen: GenEnemy
});
const ENEMY_POOL_TYPES = Object.freeze([
    ...ENEMY_SHAPE_TYPES,
    HEXA_HIVE_TYPE
]);

/**
 * 타입에 대응하는 적 클래스를 반환합니다.
 * @param {string} type - 적 타입 문자열입니다.
 * @returns {Function} 적 인스턴스 생성자입니다.
 * @throws {Error} 등록되지 않은 적 타입이면 예외를 던집니다.
 */
function resolveEnemyClass(type) {
    const EnemyClass = ENEMY_CLASS_BY_TYPE[type];
    if (typeof EnemyClass !== 'function') {
        throw new Error(`[EnemyPoolFactory] 알 수 없는 적 타입입니다: ${type}`);
    }
    return EnemyClass;
}

/**
 * 적 타입별 오브젝트 풀을 생성하고 워밍업합니다.
 * @returns {Record<string, ObjectPool>} 적 타입별 오브젝트 풀입니다.
 */
export function createEnemyPools() {
    const pools = {};
    for (const type of ENEMY_POOL_TYPES) {
        const EnemyClass = resolveEnemyClass(type);
        pools[type] = new ObjectPool(
            () => {
                const enemy = new EnemyClass();
                enemy.__poolType = type;
                return enemy;
            },
            (enemy) => enemy.reset(),
            `Enemy.${type}`
        );
        pools[type].warmUp(ENEMY_CONSTANTS.POOL_WARMUP_COUNT);
    }
    return pools;
}
