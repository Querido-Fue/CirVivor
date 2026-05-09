import { enemyAI } from 'object/enemy/ai/_enemy_ai.js';
import { Player } from 'object/player/_player.js';
import { BaseProj } from 'object/proj/_base_proj.js';
import { BaseWall } from 'object/wall/_base_wall.js';
import { GAME_SCENE_COMMAND_TYPES } from 'simulation/game_scene_simulation_protocol.js';
import { applyGameSceneSimulationCommands } from './game_scene_command_dispatcher.js';

const GAME_SCENE_AI_BY_ID = Object.freeze({
    enemyAI,
    tempAI: enemyAI
});

/**
 * 벽 데이터로 벽 엔티티를 생성합니다.
 * @param {object} wallData - 벽 초기화 데이터입니다.
 * @returns {BaseWall}
 */
function createGameSceneWallEntity(wallData) {
    return new BaseWall().init(wallData);
}

/**
 * 플레이어 데이터로 플레이어 엔티티를 생성합니다.
 * @param {object} playerData - 플레이어 초기화 데이터입니다.
 * @returns {Player}
 */
function createGameScenePlayerEntity(playerData) {
    return new Player().init(playerData);
}

/**
 * 투사체 데이터로 투사체 엔티티를 생성합니다.
 * @param {object} projectileData - 투사체 초기화 데이터입니다.
 * @returns {BaseProj}
 */
function createGameSceneProjectileEntity(projectileData) {
    const projectile = new BaseProj().init(projectileData);
    projectile.clearHitHistory();
    return projectile;
}

/**
 * 적 AI ID에 맞는 구현을 반환합니다.
 * @param {string|undefined} aiId - 적 AI 식별자입니다.
 * @returns {object|null}
 */
function resolveGameSceneEnemyAI(aiId) {
    if (typeof aiId !== 'string' || aiId.length === 0) {
        return null;
    }
    return GAME_SCENE_AI_BY_ID[aiId] || null;
}

/**
 * 씬의 벽 목록을 ObjectSystem에 동기화합니다.
 * @param {object|null|undefined} scene - 게임 씬 인스턴스입니다.
 */
function syncGameSceneObjectSystemWalls(scene) {
    if (!scene?.objectSystem) {
        return;
    }

    scene.objectSystem.setWalls([...scene.staticWalls, ...scene.boxWalls]);
}

/**
 * 월드 교체 명령을 로컬 씬 상태에 적용합니다.
 * @param {object} scene - 게임 씬 인스턴스입니다.
 * @param {object} command - 월드 교체 명령입니다.
 */
function applyReplaceWorldCommand(scene, command) {
    scene.objectSystem.showcaseEnabled = false;
    scene.objectSystem.clearEnemies();

    scene.player = command.player ? createGameScenePlayerEntity(command.player) : null;
    scene.projectiles = Array.isArray(command.projectiles)
        ? command.projectiles.map((projectileData) => createGameSceneProjectileEntity(projectileData))
        : [];
    scene.staticWalls = Array.isArray(command.staticWalls)
        ? command.staticWalls.map((wallData) => createGameSceneWallEntity(wallData))
        : [];
    scene.boxWalls = Array.isArray(command.boxWalls)
        ? command.boxWalls.map((wallData) => createGameSceneWallEntity(wallData))
        : [];
    scene.wallIdCounter = Number.isInteger(command.nextWallIdCounter) ? command.nextWallIdCounter : scene.wallIdCounter;
    scene.projIdCounter = Number.isInteger(command.nextProjIdCounter) ? command.nextProjIdCounter : scene.projIdCounter;

    scene.objectSystem.setPlayers(scene.player ? [scene.player] : []);
    scene.objectSystem.setProjectiles(scene.projectiles);
    scene.objectSystem.setItems([]);
    syncGameSceneObjectSystemWalls(scene);
}

/**
 * 적 배치 생성 명령을 로컬 ObjectSystem에 적용합니다.
 * @param {object} scene - 게임 씬 인스턴스입니다.
 * @param {object} command - 적 생성 명령입니다.
 */
function applySpawnEnemyBatchCommand(scene, command) {
    const enemies = Array.isArray(command.enemies) ? command.enemies : [];
    for (let i = 0; i < enemies.length; i++) {
        const enemyData = enemies[i];
        if (!enemyData || typeof enemyData.type !== 'string') {
            continue;
        }

        scene.objectSystem.spawnEnemy(enemyData.type, {
            ...enemyData,
            ai: resolveGameSceneEnemyAI(enemyData.aiId)
        });
    }
}

/**
 * 박스 벽 추가 명령을 로컬 씬 상태에 적용합니다.
 * @param {object} scene - 게임 씬 인스턴스입니다.
 * @param {object} command - 박스 벽 추가 명령입니다.
 */
function applyAppendBoxWallsCommand(scene, command) {
    const walls = Array.isArray(command.walls) ? command.walls : [];
    for (let i = 0; i < walls.length; i++) {
        scene.boxWalls.push(createGameSceneWallEntity(walls[i]));
    }
    scene.wallIdCounter = Number.isInteger(command.nextWallIdCounter) ? command.nextWallIdCounter : scene.wallIdCounter;
    syncGameSceneObjectSystemWalls(scene);
}

/**
 * 투사체 추가 명령을 로컬 씬 상태에 적용합니다.
 * @param {object} scene - 게임 씬 인스턴스입니다.
 * @param {object} command - 투사체 추가 명령입니다.
 */
function applyAppendProjectilesCommand(scene, command) {
    const projectiles = Array.isArray(command.projectiles) ? command.projectiles : [];
    for (let i = 0; i < projectiles.length; i++) {
        scene.projectiles.push(createGameSceneProjectileEntity(projectiles[i]));
    }
    scene.projIdCounter = Number.isInteger(command.nextProjIdCounter) ? command.nextProjIdCounter : scene.projIdCounter;
    scene.objectSystem.setProjectiles(scene.projectiles);
}

/**
 * 월드 파괴 명령을 로컬 씬 상태에 적용합니다.
 * @param {object} scene - 게임 씬 인스턴스입니다.
 */
function applyDestroyWorldCommand(scene) {
    scene.objectSystem.setPlayers([]);
    scene.objectSystem.setProjectiles([]);
    scene.objectSystem.setItems([]);
    scene.objectSystem.setWalls([]);
    scene.objectSystem.clearEnemies();
    scene.player = null;
    scene.projectiles = [];
    scene.staticWalls = [];
    scene.boxWalls = [];
}

/**
 * 게임 씬 명령 목록을 로컬 씬 상태와 ObjectSystem에 적용합니다.
 * @param {object|null|undefined} scene - 게임 씬 인스턴스입니다.
 * @param {object[]} [commands=[]] - 적용할 명령 목록입니다.
 */
export function applyGameSceneCommandsToLocalState(scene, commands = []) {
    if (!scene?.objectSystem || !Array.isArray(commands) || commands.length === 0) {
        return;
    }

    applyGameSceneSimulationCommands(commands, {
        [GAME_SCENE_COMMAND_TYPES.REPLACE_WORLD]: (command) => applyReplaceWorldCommand(scene, command),
        [GAME_SCENE_COMMAND_TYPES.SPAWN_ENEMY_BATCH]: (command) => applySpawnEnemyBatchCommand(scene, command),
        [GAME_SCENE_COMMAND_TYPES.APPEND_BOX_WALLS]: (command) => applyAppendBoxWallsCommand(scene, command),
        [GAME_SCENE_COMMAND_TYPES.APPEND_PROJECTILES]: (command) => applyAppendProjectilesCommand(scene, command),
        [GAME_SCENE_COMMAND_TYPES.DESTROY_WORLD]: () => applyDestroyWorldCommand(scene)
    });
}
