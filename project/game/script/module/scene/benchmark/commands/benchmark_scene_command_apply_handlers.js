import { Player } from 'object/player/_player.js';
import { BaseWall } from 'object/wall/_base_wall.js';
import {
    BENCHMARK_SCENE_COMMAND_TYPES
} from './benchmark_scene_command_protocol.js';
import {
    applyBenchmarkSceneCommands
} from './benchmark_scene_command_dispatcher.js';

function createBenchmarkWallEntity(wallData) {
    return new BaseWall().init(wallData);
}

function createBenchmarkPlayerEntity(playerData) {
    return new Player().init(playerData);
}

function resolveNextCounter(nextValue, fallbackValue) {
    return Number.isInteger(nextValue) ? nextValue : fallbackValue;
}

function syncObjectSystemWalls(scene) {
    scene.objectSystem?.setWalls?.([...scene.staticWalls, ...scene.boxWalls]);
}

function applyReplaceAuxiliaryWorldCommand(scene, command) {
    scene.objectSystem.showcaseEnabled = false;
    scene.objectSystem.clearEnemies();
    scene.mapGeometry = null;
    scene.player = command.player
        ? createBenchmarkPlayerEntity(command.player)
        : null;
    scene.projectiles = [];
    scene.staticWalls = Array.isArray(command.staticWalls)
        ? command.staticWalls.map(createBenchmarkWallEntity)
        : [];
    scene.boxWalls = Array.isArray(command.boxWalls)
        ? command.boxWalls.map(createBenchmarkWallEntity)
        : [];
    scene.wallIdCounter = resolveNextCounter(
        command.nextWallIdCounter,
        scene.wallIdCounter
    );
    scene.objectSystem.setPlayers(scene.player ? [scene.player] : []);
    scene.objectSystem.setProjectiles([]);
    scene.objectSystem.setItems([]);
    syncObjectSystemWalls(scene);
}

function applySpawnGpuEnemyBatchCommand(scene, command) {
    scene.spawnGpuEnemyBatch(command.count);
}

function applySpawnGpuProjectileBatchCommand(scene, command) {
    scene.spawnGpuProjectileBatch(command.count);
}

function applyAppendBoxWallsCommand(scene, command) {
    const walls = Array.isArray(command.walls) ? command.walls : [];
    for (let i = 0; i < walls.length; i++) {
        scene.boxWalls.push(createBenchmarkWallEntity(walls[i]));
    }
    scene.wallIdCounter = resolveNextCounter(
        command.nextWallIdCounter,
        scene.wallIdCounter
    );
    syncObjectSystemWalls(scene);
}

function applyDestroyAuxiliaryWorldCommand(scene) {
    scene.objectSystem.setPlayers([]);
    scene.objectSystem.setProjectiles([]);
    scene.objectSystem.setItems([]);
    scene.objectSystem.setWalls([]);
    scene.objectSystem.clearEnemies();
    scene.player = null;
    scene.projectiles = [];
    scene.staticWalls = [];
    scene.boxWalls = [];
    scene.mapGeometry = null;
}

function createBenchmarkSceneCommandHandlers(scene) {
    return {
        [BENCHMARK_SCENE_COMMAND_TYPES.REPLACE_AUXILIARY_WORLD]: (command) => (
            applyReplaceAuxiliaryWorldCommand(scene, command)
        ),
        [BENCHMARK_SCENE_COMMAND_TYPES.SPAWN_GPU_ENEMY_BATCH]: (command) => (
            applySpawnGpuEnemyBatchCommand(scene, command)
        ),
        [BENCHMARK_SCENE_COMMAND_TYPES.SPAWN_GPU_PROJECTILE_BATCH]: (command) => (
            applySpawnGpuProjectileBatchCommand(scene, command)
        ),
        [BENCHMARK_SCENE_COMMAND_TYPES.APPEND_BOX_WALLS]: (command) => (
            applyAppendBoxWallsCommand(scene, command)
        ),
        [BENCHMARK_SCENE_COMMAND_TYPES.DESTROY_AUXILIARY_WORLD]: () => (
            applyDestroyAuxiliaryWorldCommand(scene)
        )
    };
}

/**
 * frame-boundary benchmark command를 GPU request 또는 CPU 보조 월드에 적용합니다.
 * CPU 적·투사체 생성 handler는 의도적으로 제공하지 않습니다.
 * @param {object|null|undefined} scene - BenchmarkScene입니다.
 * @param {object[]} [commands=[]] - 적용할 command 목록입니다.
 * @returns {void}
 */
export function applyBenchmarkSceneCommandsToLocalState(scene, commands = []) {
    if (!scene?.objectSystem || !Array.isArray(commands) || commands.length === 0) {
        return;
    }
    applyBenchmarkSceneCommands(
        commands,
        createBenchmarkSceneCommandHandlers(scene)
    );
}
