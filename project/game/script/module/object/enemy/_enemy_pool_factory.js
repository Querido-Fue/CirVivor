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
const ENEMY_CLASS_BY_TYPE = Object.freeze({
    square: SquareEnemy,
    triangle: TriangleEnemy,
    arrow: ArrowEnemy,
    hexa: HexaEnemy,
    hexa_hive: HexaHiveEnemy,
    penta: PentaEnemy,
    rhom: RhomEnemy,
    octa: OctaEnemy,
    gen: GenEnemy
});
const ENEMY_POOL_TYPES = Object.freeze([
    ...ENEMY_SHAPE_TYPES,
    getHexaHiveType()
]);

/**
 * 적 타입별 오브젝트 풀을 생성하고 워밍업합니다.
 * @returns {Record<string, ObjectPool>} 적 타입별 오브젝트 풀입니다.
 */
export function createEnemyPools() {
    const pools = {};
    for (const type of ENEMY_POOL_TYPES) {
        const EnemyClass = ENEMY_CLASS_BY_TYPE[type];
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
