import { getData } from 'data/data_handler.js';
import { GAME_SCENE_COMMAND_TYPES } from 'simulation/game_scene_simulation_protocol.js';
import {
    buildGameMapGeometry,
    resolveGameMapDefinition
} from '../map/game_map_grid.js';

const PLAY_MAP_CONSTANTS = getData('GAME_SCENE_CONSTANTS').PLAY_MAP;

/**
 * 컴파일된 맵 경계 벽에 씬 고유 ID를 부여합니다.
 * @param {object} scene - 게임 씬 인스턴스입니다.
 * @param {object} wall - 중심 좌표 기준 경계 벽입니다.
 * @returns {object} 시뮬레이션 명령에 넣을 벽 데이터입니다.
 */
function createGameMapWallData(scene, wall) {
    return {
        id: scene.wallIdCounter++,
        x: wall.x,
        y: wall.y,
        w: wall.w,
        h: wall.h,
        origin: 'center'
    };
}

/**
 * 선택한 그리드 맵으로 기본 플레이 월드를 교체하는 명령을 생성합니다.
 * @param {object} scene - 게임 씬 인스턴스입니다.
 * @param {string|null|undefined} mapId - 선택한 맵 ID입니다.
 * @returns {object[]} 월드 교체 명령 목록입니다.
 */
export function buildGameSceneResetPlayWorldCommands(scene, mapId = scene?.mapId) {
    const mapDefinition = resolveGameMapDefinition(mapId);
    const mapGeometry = buildGameMapGeometry(mapDefinition, {
        ww: scene?.WW,
        objectWH: scene?.objectWH
    });
    const playerData = {
        id: PLAY_MAP_CONSTANTS.PLAYER_ID,
        radius: mapGeometry.cellSize * PLAY_MAP_CONSTANTS.PLAYER_RADIUS_CELL_RATIO,
        position: {
            x: mapGeometry.playerSpawn.x,
            y: mapGeometry.playerSpawn.y
        },
        speed: { x: 0, y: 0 },
        weight: PLAY_MAP_CONSTANTS.PLAYER_WEIGHT
    };
    const staticWalls = mapGeometry.boundaryWalls.map((wall) => {
        return createGameMapWallData(scene, wall);
    });

    return [{
        type: GAME_SCENE_COMMAND_TYPES.REPLACE_WORLD,
        mapId: mapGeometry.mapId,
        mapGeometry,
        player: playerData,
        staticWalls,
        boxWalls: [],
        projectiles: [],
        nextWallIdCounter: scene.wallIdCounter,
        nextProjIdCounter: scene.projIdCounter
    }];
}
