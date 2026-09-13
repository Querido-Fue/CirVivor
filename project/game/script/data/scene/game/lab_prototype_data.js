import { CORRIDOR_EIGHT_MAP_DATA } from './corridor_eight_map_data.js';
import { BASIC_SQUARE_ENEMY_DATA, BASIC_TRIANGLE_ENEMY_DATA, BASIC_ARROW_ENEMY_DATA } from 'data/object/enemy/basic_circle_enemy_data.js';

const cells = [[0,0],[0,1],[0,2],[1,2],[2,2],[2,1],[2,0],[3,0],[4,0],[4,1],[4,2],[4,3],[4,4],[3,4],[2,4],[2,5],[2,6]];
export const LAB_PROTOTYPE_MAP = Object.freeze({
    id: 'lab-prototype-01',
    nameKey: 'lab-prototype',
    macroRows: 5,
    macroColumns: 7,
    pathWidthTiles: 3,
    directionBlueprint: Object.freeze(['abc####', '##d####', 'gfe#opq', 'h###n##', 'ijklm##']),
    coreMacroCell: Object.freeze([2, 6]),
    towerSpawnMacroCell: Object.freeze([4, 3]),
    enemyModifiers: CORRIDOR_EIGHT_MAP_DATA.enemyModifiers,
    enemySpawnRoutes: Object.freeze([Object.freeze({
        gateId: 'lab-entry', pathId: 'lab-serpentine',
        macroCells: Object.freeze(cells.map((cell) => Object.freeze(cell)))
    })])
});

export const LAB_PROTOTYPE_LOADS = Object.freeze([120, 1000, 10000]);

export function createLabPrototypeWave(count = 120) {
    if (!LAB_PROTOTYPE_LOADS.includes(count)) throw new RangeError('지원하지 않는 프로토타입 부하');
    const intervalTicks = count === 120 ? 15 : 1;
    return Object.freeze({
        waveId: `lab-wave-${count}`, mapId: LAB_PROTOTYPE_MAP.id,
        enemyModifiers: CORRIDOR_EIGHT_MAP_DATA.enemyModifiers,
        timeline: Object.freeze([Object.freeze({
            timelineEntryId: 'lab-stream', type: 'SPAWN_FOR_DURATION',
            durationSeconds: Math.ceil(count * intervalTicks / 60),
            spawnGroups: Object.freeze([Object.freeze({
                groupId: 'lab-shape-study',
                enemyDefinitionId: BASIC_SQUARE_ENEMY_DATA.id,
                enemyDefinitionIds: Object.freeze([BASIC_SQUARE_ENEMY_DATA.id, BASIC_TRIANGLE_ENEMY_DATA.id, BASIC_ARROW_ENEMY_DATA.id]),
                routeBinding: Object.freeze({ gateId: 'lab-entry', pathId: 'lab-serpentine' }),
                policyId: 'corebound', count, intervalTicks,
                laneOffsetsTiles: Object.freeze([-0.9, 0, 0.9])
            })])
        })])
    });
}
