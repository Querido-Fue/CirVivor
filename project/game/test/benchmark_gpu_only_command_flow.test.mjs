import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const COMMAND_MODULE_URLS = Object.freeze({
    apply: new URL(
        '../script/module/scene/benchmark/commands/benchmark_scene_command_apply_handlers.js',
        import.meta.url
    ),
    builder: new URL(
        '../script/module/scene/benchmark/commands/benchmark_scene_command_builder.js',
        import.meta.url
    ),
    dispatcher: new URL(
        '../script/module/scene/benchmark/commands/benchmark_scene_command_dispatcher.js',
        import.meta.url
    ),
    protocol: new URL(
        '../script/module/scene/benchmark/commands/benchmark_scene_command_protocol.js',
        import.meta.url
    )
});

function createSyntheticModule(context, identifier, exports) {
    const exportNames = Object.keys(exports);
    return new vm.SyntheticModule(exportNames, function initialize() {
        for (const exportName of exportNames) {
            this.setExport(exportName, exports[exportName]);
        }
    }, { context, identifier });
}

function isRectCircleOverlapping(rect, x, y, radius) {
    const nearestX = Math.max(rect.minX, Math.min(x, rect.maxX));
    const nearestY = Math.max(rect.minY, Math.min(y, rect.maxY));
    const dx = x - nearestX;
    const dy = y - nearestY;
    return ((dx * dx) + (dy * dy)) <= (radius * radius);
}

async function createCommandHarness() {
    const context = vm.createContext({ console });
    const [applySource, builderSource, dispatcherSource, protocolSource] = (
        await Promise.all([
            readFile(COMMAND_MODULE_URLS.apply, 'utf8'),
            readFile(COMMAND_MODULE_URLS.builder, 'utf8'),
            readFile(COMMAND_MODULE_URLS.dispatcher, 'utf8'),
            readFile(COMMAND_MODULE_URLS.protocol, 'utf8')
        ])
    );

    class Player {
        init(data) {
            Object.assign(this, data);
            return this;
        }
    }

    class BaseWall {
        init(data) {
            Object.assign(this, data);
            return this;
        }
    }

    const randomFractions = Object.freeze([
        0.08, 0.10,
        0.44, 0.10,
        0.65, 0.85,
        0.90, 0.12
    ]);
    let randomIndex = 0;
    const randomRange = (min, max) => {
        const fraction = randomFractions[randomIndex % randomFractions.length];
        randomIndex++;
        return min + ((max - min) * fraction);
    };

    const protocolModule = new vm.SourceTextModule(protocolSource, {
        context,
        identifier: 'benchmark_scene_command_protocol.js'
    });
    const dispatcherModule = new vm.SourceTextModule(dispatcherSource, {
        context,
        identifier: 'benchmark_scene_command_dispatcher.js'
    });
    const builderModule = new vm.SourceTextModule(builderSource, {
        context,
        identifier: 'benchmark_scene_command_builder.js'
    });
    const applyModule = new vm.SourceTextModule(applySource, {
        context,
        identifier: 'benchmark_scene_command_apply_handlers.js'
    });
    const playerModule = createSyntheticModule(context, 'object/player/_player.js', {
        Player
    });
    const wallModule = createSyntheticModule(context, 'object/wall/_base_wall.js', {
        BaseWall
    });
    const geometryModule = createSyntheticModule(context, 'util/geometry_util.js', {
        isRectCircleOverlapping
    });
    const randomModule = createSyntheticModule(context, 'util/random_util.js', {
        randomRange
    });
    const benchmarkArenaLayout = Object.freeze({
        worldBounds: Object.freeze({ width: 64, height: 36 }),
        targetPosition: Object.freeze({ x: 32, y: 18 }),
        staticWalls: Object.freeze([
            Object.freeze({ x: 16, y: 18, w: 2, h: 18 }),
            Object.freeze({ x: 48, y: 18, w: 2, h: 18 })
        ]),
        initialBoxes: Object.freeze([
            Object.freeze({ x: 25.5, y: 10.5, w: 3, h: 3 }),
            Object.freeze({ x: 38.5, y: 25.5, w: 3, h: 3 }),
            Object.freeze({ x: 23.5, y: 27.5, w: 3, h: 3 })
        ])
    });
    const navigationModule = createSyntheticModule(
        context,
        'gpu_benchmark_navigation_source.js',
        { GPU_BENCHMARK_ARENA_LAYOUT: benchmarkArenaLayout }
    );
    const entryModule = new vm.SourceTextModule(`
        export {
            buildBenchmarkSceneResetAuxiliaryWorldCommands,
            buildBenchmarkSceneSpawnGpuEnemiesCommand,
            buildBenchmarkSceneSpawnGpuProjectileBatchCommand,
            buildBenchmarkSceneSpawnRandomBoxCommand
        } from 'benchmark-command-builder';
        export {
            applyBenchmarkSceneCommandsToLocalState
        } from 'benchmark-command-apply';
        export {
            BENCHMARK_SCENE_COMMAND_TYPES
        } from 'benchmark-command-protocol';
    `, {
        context,
        identifier: 'benchmark_command_test_entry.mjs'
    });

    await entryModule.link((specifier) => {
        if (specifier === 'benchmark-command-builder') return builderModule;
        if (specifier === 'benchmark-command-apply') return applyModule;
        if (specifier === 'benchmark-command-protocol') return protocolModule;
        if (specifier === './benchmark_scene_command_protocol.js') {
            return protocolModule;
        }
        if (specifier === './benchmark_scene_command_dispatcher.js') {
            return dispatcherModule;
        }
        if (specifier === 'object/player/_player.js') return playerModule;
        if (specifier === 'object/wall/_base_wall.js') return wallModule;
        if (specifier === 'util/geometry_util.js') return geometryModule;
        if (specifier === 'util/random_util.js') return randomModule;
        if (specifier === '../gpu_benchmark_navigation_source.js') {
            return navigationModule;
        }
        throw new Error(`예상하지 못한 import입니다: ${specifier}`);
    });
    await entryModule.evaluate();

    return {
        ...entryModule.namespace,
        BaseWall,
        Player
    };
}

function createSceneFixture() {
    const trace = {
        clearEnemiesCount: 0,
        gpuSpawnCounts: [],
        gpuProjectileSpawnCounts: [],
        legacyCpuSpawnCounts: [],
        objectSystemCpuSpawnCounts: [],
        players: [],
        projectiles: [],
        items: [],
        walls: []
    };
    const objectSystem = {
        showcaseEnabled: true,
        cpuEnemyCount: 12,
        clearEnemies() {
            trace.clearEnemiesCount++;
            this.cpuEnemyCount = 0;
        },
        setPlayers(players) {
            trace.players.push([...players]);
        },
        setProjectiles(projectiles) {
            trace.projectiles.push([...projectiles]);
        },
        setItems(items) {
            trace.items.push([...items]);
        },
        setWalls(walls) {
            trace.walls.push([...walls]);
        },
        spawnEnemy(count) {
            trace.objectSystemCpuSpawnCounts.push(count);
        }
    };
    const scene = {
        WW: 1200,
        objectWH: 800,
        wallIdCounter: 1,
        projIdCounter: 100,
        objectSystem,
        mapGeometry: { id: 'stale-map' },
        player: null,
        projectiles: [],
        staticWalls: [],
        boxWalls: [],
        spawnGpuEnemyBatch(count) {
            trace.gpuSpawnCounts.push(count);
        },
        spawnGpuProjectileBatch(count) {
            trace.gpuProjectileSpawnCounts.push(count);
        },
        spawnEnemyBatch(count) {
            trace.legacyCpuSpawnCounts.push(count);
        }
    };
    return { objectSystem, scene, trace };
}

test('실제 명령 그래프는 enemy/projectile GPU spawn과 CPU 보조 box 경로만 유지한다', async () => {
    const harness = await createCommandHarness();
    const { objectSystem, scene, trace } = createSceneFixture();

    const resetCommands = harness.buildBenchmarkSceneResetAuxiliaryWorldCommands(scene);
    harness.applyBenchmarkSceneCommandsToLocalState(scene, resetCommands);

    assert.equal(trace.clearEnemiesCount, 1);
    assert.equal(objectSystem.cpuEnemyCount, 0);
    assert.equal(objectSystem.showcaseEnabled, false);
    assert.ok(scene.player instanceof harness.Player);
    assert.equal(scene.staticWalls.length, 2);
    assert.equal(scene.boxWalls.length, 3);
    assert.ok(scene.staticWalls.every((wall) => wall instanceof harness.BaseWall));
    assert.ok(scene.boxWalls.every((wall) => wall instanceof harness.BaseWall));
    assert.deepEqual(
        { x: scene.player.position.x, y: scene.player.position.y },
        { x: 600, y: 400 }
    );
    assert.deepEqual(
        scene.staticWalls.map(({ x, y, w, h }) => ({ x, y, w, h })),
        [
            { x: 300, y: 400, w: 37.5, h: 337.5 },
            { x: 900, y: 400, w: 37.5, h: 337.5 }
        ]
    );
    assert.equal(trace.players.at(-1).length, 1);
    assert.equal(trace.walls.at(-1).length, 5);
    assert.equal(trace.projectiles.at(-1).length, 0);
    assert.equal(trace.items.at(-1).length, 0);

    const gpuCommand = harness.buildBenchmarkSceneSpawnGpuEnemiesCommand(100);
    harness.applyBenchmarkSceneCommandsToLocalState(scene, [
        { type: 'benchmarkScene.unknownCommand' },
        gpuCommand,
        null,
        { malformed: true }
    ]);

    assert.deepEqual(trace.gpuSpawnCounts, [100]);
    assert.deepEqual(trace.legacyCpuSpawnCounts, []);
    assert.deepEqual(trace.objectSystemCpuSpawnCounts, []);
    assert.equal(objectSystem.cpuEnemyCount, 0);
    assert.equal(
        'SPAWN_ENEMY_BATCH' in harness.BENCHMARK_SCENE_COMMAND_TYPES,
        false
    );
    assert.equal(
        'APPEND_PROJECTILES' in harness.BENCHMARK_SCENE_COMMAND_TYPES,
        false
    );

    const boxCountBeforeAppend = scene.boxWalls.length;
    const wallRegistrationCount = trace.walls.length;
    const boxCommand = harness.buildBenchmarkSceneSpawnRandomBoxCommand(scene);
    assert.ok(boxCommand);
    harness.applyBenchmarkSceneCommandsToLocalState(scene, [boxCommand]);

    assert.equal(scene.boxWalls.length, boxCountBeforeAppend + 1);
    assert.ok(scene.boxWalls.at(-1) instanceof harness.BaseWall);
    assert.equal(trace.walls.length, wallRegistrationCount + 1);
    assert.equal(
        trace.walls.at(-1).length,
        scene.staticWalls.length + scene.boxWalls.length
    );

    const projectileCommand = (
        harness.buildBenchmarkSceneSpawnGpuProjectileBatchCommand()
    );
    assert.equal(
        projectileCommand.type,
        harness.BENCHMARK_SCENE_COMMAND_TYPES.SPAWN_GPU_PROJECTILE_BATCH
    );
    assert.equal(projectileCommand.count, 10);
    harness.applyBenchmarkSceneCommandsToLocalState(scene, [projectileCommand]);

    assert.deepEqual(trace.gpuProjectileSpawnCounts, [10]);
    assert.equal(scene.projectiles.length, 0);
    assert.equal(trace.projectiles.at(-1).length, 0);
    assert.deepEqual(trace.legacyCpuSpawnCounts, []);
    assert.deepEqual(trace.objectSystemCpuSpawnCounts, []);
    assert.equal(objectSystem.cpuEnemyCount, 0);
});

test('reset과 destroy는 CPU enemy를 제거하고 unknown 명령은 fail-closed로 무시한다', async () => {
    const harness = await createCommandHarness();
    const { objectSystem, scene, trace } = createSceneFixture();
    const { DESTROY_AUXILIARY_WORLD } = harness.BENCHMARK_SCENE_COMMAND_TYPES;

    harness.applyBenchmarkSceneCommandsToLocalState(
        scene,
        harness.buildBenchmarkSceneResetAuxiliaryWorldCommands(scene)
    );
    objectSystem.cpuEnemyCount = 7;
    scene.mapGeometry = { id: 'temporary-map' };

    harness.applyBenchmarkSceneCommandsToLocalState(scene, [
        { type: 'benchmarkScene.removedLegacyCpuSpawn', count: 999 },
        { type: DESTROY_AUXILIARY_WORLD },
        { type: 'benchmarkScene.alsoUnknown' }
    ]);

    assert.equal(trace.clearEnemiesCount, 2);
    assert.equal(objectSystem.cpuEnemyCount, 0);
    assert.equal(scene.player, null);
    assert.equal(scene.projectiles.length, 0);
    assert.equal(scene.staticWalls.length, 0);
    assert.equal(scene.boxWalls.length, 0);
    assert.equal(scene.mapGeometry, null);
    assert.equal(trace.players.at(-1).length, 0);
    assert.equal(trace.projectiles.at(-1).length, 0);
    assert.equal(trace.items.at(-1).length, 0);
    assert.equal(trace.walls.at(-1).length, 0);
    assert.deepEqual(trace.gpuSpawnCounts, []);
    assert.deepEqual(trace.gpuProjectileSpawnCounts, []);
    assert.deepEqual(trace.legacyCpuSpawnCounts, []);
    assert.deepEqual(trace.objectSystemCpuSpawnCounts, []);
});

test('CPU 보조 arena는 GPU child camera projection과 object canvas Y offset을 공유한다', async () => {
    const harness = await createCommandHarness();
    const camera = {
        getScale: () => 30,
        worldToViewport(x, y, out = {}) {
            out.x = 320 + (x * 30);
            out.y = y * 30;
            return out;
        }
    };
    const scene = {
        WW: 2560,
        objectWH: 1440,
        objectOffsetY: 180,
        wallIdCounter: 1,
        getGpuWorldViewProjection: () => camera
    };

    const [command] = harness.buildBenchmarkSceneResetAuxiliaryWorldCommands(
        scene
    );
    assert.deepEqual(
        { x: command.player.position.x, y: command.player.position.y - 180 },
        camera.worldToViewport(32, 18, {})
    );
    assert.deepEqual(
        command.staticWalls.map(({ x, y, w, h }) => ({
            x,
            y: y - 180,
            w,
            h
        })),
        [
            { x: 800, y: 540, w: 60, h: 540 },
            { x: 1760, y: 540, w: 60, h: 540 }
        ]
    );
});
