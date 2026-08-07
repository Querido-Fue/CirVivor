import { BaseScene } from 'scene/_base_scene.js';
import { getObjectSystem } from 'object/object_system.js';
import {
    GPU_BODY_PRESENTATION_PROFILE
} from 'ingame/gpu_simulation_endpoint.js';
import { enqueueSimulationCommand } from 'simulation/simulation_command_queue.js';
import { GameScene } from '../game/_game_scene.js';
import { createGameSceneDependencies } from '../game/game_scene_dependency_factory.js';
import { createDefaultCollisionStats } from './benchmark_scene_snapshot_utils.js';
import {
    buildBenchmarkSceneResetAuxiliaryWorldCommands,
    buildBenchmarkSceneSpawnGpuEnemiesCommand,
    buildBenchmarkSceneSpawnGpuProjectileBatchCommand,
    buildBenchmarkSceneSpawnRandomBoxCommand
} from './commands/benchmark_scene_command_builder.js';
import {
    applyBenchmarkSceneCommandsToLocalState
} from './commands/benchmark_scene_command_apply_handlers.js';
import {
    BENCHMARK_SCENE_COMMAND_TYPES
} from './commands/benchmark_scene_command_protocol.js';
import {
    requestGpuBenchmarkEnemyBatch
} from './gpu_benchmark_enemy_spawn_adapter.js';
import {
    GPU_BENCHMARK_PLAYER_PROXY_KIND_ID,
    requestGpuBenchmarkPlayerProxy
} from './gpu_benchmark_player_proxy_spawn_adapter.js';
import {
    requestGpuBenchmarkProjectileBatch
} from './gpu_benchmark_projectile_spawn_adapter.js';
import {
    createGpuBenchmarkNavigationSource
} from './gpu_benchmark_navigation_source.js';
import { drawGameSceneButtons } from './render/benchmark_scene_button_renderer.js';
import { drawGpuBenchmarkHud } from './render/gpu_benchmark_hud_renderer.js';
import { drawGameSceneWorldObjects } from './render/benchmark_scene_world_renderer.js';
import {
    cullLocalGameSceneProjectiles,
    syncGameSceneCollisionStats,
    updateGameSceneButtonInput
} from './update/benchmark_scene_update_helpers.js';
import {
    getSimulationObjectOffsetY,
    getSimulationObjectWH,
    getSimulationWH,
    getSimulationWW
} from 'simulation/simulation_runtime.js';
import { beginPerformanceSection, endPerformanceSection } from 'debug/debug_system.js';
import {
    isReleaseSimulationProfilerCollecting,
    setReleaseSimulationProfilerEnabled
} from 'simulation/release_simulation_profiler.js';

const BENCHMARK_BUTTON_LAYOUT = Object.freeze({
    WIDTH_MIN: 210,
    WIDTH_WW_RATIO: 0.15,
    HEIGHT_MIN: 38,
    HEIGHT_WH_RATIO: 0.052,
    GAP_MIN: 10,
    GAP_HEIGHT_RATIO: 0.24,
    X_WW_RATIO: 0.03,
    Y_WH_RATIO: 0.08
});
const BENCHMARK_BUTTON_ACTION_TYPES = Object.freeze({
    SPAWN_ENEMIES: 'spawnEnemies',
    SPAWN_BOX: 'spawnBox',
    SPAWN_PROJECTILES: 'spawnProjectiles',
    RESTART_GPU_SESSION: 'restartGpuSession',
    SET_GPU_PRESENTATION_PROFILE: 'setGpuPresentationProfile',
    TOGGLE_RELEASE_PROFILER: 'toggleReleaseProfiler'
});
const BENCHMARK_BUTTON_ACTIONS = Object.freeze([
    Object.freeze({
        id: 'spawnEnemy100',
        label: 'Spawn 100 Enemies',
        type: BENCHMARK_BUTTON_ACTION_TYPES.SPAWN_ENEMIES,
        count: 100
    }),
    Object.freeze({
        id: 'spawnBox',
        label: 'Spawn Box',
        type: BENCHMARK_BUTTON_ACTION_TYPES.SPAWN_BOX
    }),
    Object.freeze({
        id: 'spawnProjectile10',
        label: 'Spawn 10 Projectiles',
        type: BENCHMARK_BUTTON_ACTION_TYPES.SPAWN_PROJECTILES
    }),
    Object.freeze({
        id: 'restartGpuSession',
        label: 'Restart GPU Session',
        type: BENCHMARK_BUTTON_ACTION_TYPES.RESTART_GPU_SESSION
    }),
    Object.freeze({
        id: 'referenceClock',
        label: 'Reference (Original, Reset)',
        type: BENCHMARK_BUTTON_ACTION_TYPES.SET_GPU_PRESENTATION_PROFILE,
        profile: GPU_BODY_PRESENTATION_PROFILE.REFERENCE_CLOCK_EXTRAPOLATION
    }),
    Object.freeze({
        id: 'strictInterpolation',
        label: 'Strict Interpolation (Reset)',
        type: BENCHMARK_BUTTON_ACTION_TYPES.SET_GPU_PRESENTATION_PROFILE,
        profile: GPU_BODY_PRESENTATION_PROFILE.STRICT_INTERPOLATION
    }),
    Object.freeze({
        id: 'cappedAccumulator',
        label: 'Capped Extrapolation (Reset)',
        type: BENCHMARK_BUTTON_ACTION_TYPES.SET_GPU_PRESENTATION_PROFILE,
        profile: GPU_BODY_PRESENTATION_PROFILE.CAPPED_ACCUMULATOR_EXTRAPOLATION
    }),
    Object.freeze({
        id: 'toggleReleaseProfiler',
        label: 'Toggle Profiler',
        type: BENCHMARK_BUTTON_ACTION_TYPES.TOGGLE_RELEASE_PROFILER
    })
]);
const BENCHMARK_DRAW_SECTIONS = Object.freeze({
    WORLD: 'scene.benchmark.drawWorld',
    BUTTONS: 'scene.benchmark.drawButtons',
    HUD: 'scene.benchmark.drawHud'
});
const BENCHMARK_SCENE_MODE = 'benchmark';
const BENCHMARK_CAMERA_ZOOM = 1;
export const BENCHMARK_SCENE_RUNTIME_MODES = Object.freeze({
    GPU_ONLY: 'gpu-only'
});
const GPU_PRESENTATION_PROFILES = new Set(
    Object.values(GPU_BODY_PRESENTATION_PROFILE)
);
const BENCHMARK_CHILD_LEGACY_WORLD_PORT = Object.freeze({
    clear() {
        // BenchmarkScene이 CPU 보조 월드를 소유하므로 자식의 play-world guard와 격리합니다.
    }
});
const BENCHMARK_CHILD_INPUT_ACTION_SOURCE = Object.freeze({
    isPressed() {
        return false;
    },
    getPointerPosition(out = {}) {
        out.x = 0;
        out.y = 0;
        return out;
    },
    isPrimaryPointerPressed() {
        return false;
    },
    getWheelTotals(out = {}) {
        out.x = 0;
        out.y = 0;
        return out;
    }
});

function requireGpuPresentationProfile(profile) {
    if (!GPU_PRESENTATION_PROFILES.has(profile)) {
        throw new RangeError(`지원하지 않는 GPU presentation profile입니다: ${profile}`);
    }
    return profile;
}

function createBenchmarkGameSceneDependencies(dependencies) {
    return {
        ...dependencies,
        inputActionSource: BENCHMARK_CHILD_INPUT_ACTION_SOURCE,
        legacyWorldPort: BENCHMARK_CHILD_LEGACY_WORLD_PORT
    };
}

function createBenchmarkButtonMetrics(scene) {
    const width = Math.max(
        BENCHMARK_BUTTON_LAYOUT.WIDTH_MIN,
        scene.WW * BENCHMARK_BUTTON_LAYOUT.WIDTH_WW_RATIO
    );
    const height = Math.max(
        BENCHMARK_BUTTON_LAYOUT.HEIGHT_MIN,
        scene.WH * BENCHMARK_BUTTON_LAYOUT.HEIGHT_WH_RATIO
    );
    const gap = Math.max(
        BENCHMARK_BUTTON_LAYOUT.GAP_MIN,
        height * BENCHMARK_BUTTON_LAYOUT.GAP_HEIGHT_RATIO
    );
    return {
        x: scene.WW * BENCHMARK_BUTTON_LAYOUT.X_WW_RATIO,
        y: scene.WH * BENCHMARK_BUTTON_LAYOUT.Y_WH_RATIO,
        w: width,
        h: height,
        rowStride: height + gap
    };
}

function createBenchmarkButtonClickHandler(scene, action) {
    if (action.type === BENCHMARK_BUTTON_ACTION_TYPES.SPAWN_ENEMIES) {
        return () => scene.queueSpawnEnemies(action.count);
    }
    if (action.type === BENCHMARK_BUTTON_ACTION_TYPES.SPAWN_BOX) {
        return () => scene.queueSpawnRandomBox();
    }
    if (action.type === BENCHMARK_BUTTON_ACTION_TYPES.SPAWN_PROJECTILES) {
        return () => scene.queueSpawnProjectileBurst();
    }
    if (action.type === BENCHMARK_BUTTON_ACTION_TYPES.RESTART_GPU_SESSION) {
        return () => scene.restartGpuVisualQa();
    }
    if (action.type === BENCHMARK_BUTTON_ACTION_TYPES.SET_GPU_PRESENTATION_PROFILE) {
        return () => scene.setGpuPresentationProfile(action.profile);
    }
    if (action.type === BENCHMARK_BUTTON_ACTION_TYPES.TOGGLE_RELEASE_PROFILER) {
        return () => scene.toggleReleaseProfiler();
    }
    return () => false;
}

function createBenchmarkButton(scene, action, metrics, index) {
    const activeProfile = action.profile === scene.enemyPresentationProfile;
    return {
        id: action.id,
        label: activeProfile ? `● ${action.label}` : action.label,
        x: metrics.x,
        y: metrics.y + (metrics.rowStride * index),
        w: metrics.w,
        h: metrics.h,
        onClick: createBenchmarkButtonClickHandler(scene, action)
    };
}

function enqueueBenchmarkCommand(command) {
    return command ? enqueueSimulationCommand(command) : false;
}

function createEmptySpawnBatchResult(reason = 'not-requested') {
    return Object.freeze({
        accepted: false,
        requestedCount: 0,
        queuedCount: 0,
        targetFixedTick: null,
        reason,
        nextSpawnSequence: 0
    });
}

function resolveGpuSimulationEndpoint(gameScene) {
    if (typeof gameScene?.getGpuSimulationEndpoint === 'function') {
        return gameScene.getGpuSimulationEndpoint();
    }
    return gameScene?.getEnemySimulationEndpoint?.() ?? null;
}

function normalizeTelemetryCount(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
}

function resolveRegistryKindCounts(endpoint, endpointStatus) {
    const fallbackTotal = normalizeTelemetryCount(endpointStatus?.activeCount);
    try {
        const registry = endpoint?.getRegistry?.();
        if (typeof registry?.getActiveCount !== 'function') {
            return {
                totalActiveCount: fallbackTotal,
                enemyActiveCount: fallbackTotal,
                projectileActiveCount: 0,
                playerProxyActiveCount: 0
            };
        }
        return {
            totalActiveCount: normalizeTelemetryCount(registry.getActiveCount()),
            enemyActiveCount: normalizeTelemetryCount(
                registry.getActiveCount('enemy')
            ),
            projectileActiveCount: normalizeTelemetryCount(
                registry.getActiveCount('projectile')
            ),
            playerProxyActiveCount: normalizeTelemetryCount(
                registry.getActiveCount(GPU_BENCHMARK_PLAYER_PROXY_KIND_ID)
            )
        };
    } catch {
        return {
            totalActiveCount: fallbackTotal,
            enemyActiveCount: fallbackTotal,
            projectileActiveCount: 0,
            playerProxyActiveCount: 0
        };
    }
}

function resolveGpuEventTelemetry(gpuStatus) {
    const events = gpuStatus?.events ?? gpuStatus?.eventReadback ?? null;
    const contact = gpuStatus?.contact ?? null;
    return {
        contactCount: normalizeTelemetryCount(
            events?.lastContactCount
                ?? events?.contactCount
                ?? gpuStatus?.lastContactCount
                ?? contact?.lastCount
        ),
        appliedEventCount: normalizeTelemetryCount(
            events?.lastAppliedEventCount
                ?? events?.lastAppliedCount
                ?? events?.appliedEventCount
                ?? gpuStatus?.lastAppliedEventCount
        ),
        deathEventCount: normalizeTelemetryCount(
            events?.lastDeathEventCount
                ?? events?.lastDeathCount
                ?? events?.deathEventCount
                ?? gpuStatus?.lastDeathEventCount
        ),
        contactOverflowCount: normalizeTelemetryCount(
            events?.lastContactOverflowCount
                ?? events?.contactOverflowCount
                ?? gpuStatus?.lastContactOverflowCount
                ?? contact?.lastOverflowCount
        ),
        appliedEventOverflowCount: normalizeTelemetryCount(
            events?.lastAppliedEventOverflowCount
                ?? events?.lastAppliedOverflowCount
                ?? events?.appliedEventOverflowCount
                ?? events?.eventOverflowCount
                ?? gpuStatus?.lastAppliedEventOverflowCount
        ),
        deathEventOverflowCount: normalizeTelemetryCount(
            events?.lastDeathEventOverflowCount
                ?? events?.lastDeathOverflowCount
                ?? events?.deathEventOverflowCount
                ?? gpuStatus?.lastDeathEventOverflowCount
        ),
        submittedTickWatermark: normalizeTelemetryCount(
            events?.lastSubmittedTick
                ?? events?.submittedTickWatermark
                ?? events?.lastEventReadbackSubmittedTick
                ?? gpuStatus?.lastEventReadbackSubmittedTick
        ),
        completedTickWatermark: normalizeTelemetryCount(
            events?.completedThroughTick
                ?? events?.lastCompletedTick
                ?? events?.completedTickWatermark
                ?? events?.lastEventReadbackCompletedTick
                ?? gpuStatus?.lastEventReadbackCompletedTick
        )
    };
}

/**
 * @class BenchmarkScene
 * @description CPU player/box 보조 기능은 유지하고 적·투사체 authority는 한 GPU endpoint로 고정합니다.
 */
export class BenchmarkScene extends BaseScene {
    /**
     * @param {object} sceneHandler
     * @param {{dependencies?:object,gameSceneFactory?:Function,enemyPresentationProfile?:string}} [options={}]
     */
    constructor(sceneHandler, options = {}) {
        super(sceneHandler);
        this.mode = BENCHMARK_SCENE_MODE;
        this.runtimeMode = BENCHMARK_SCENE_RUNTIME_MODES.GPU_ONLY;
        this.mapId = null;
        this.mapGeometry = null;
        this.objectSystem = getObjectSystem();
        this.gameSceneDependencies = createBenchmarkGameSceneDependencies(
            options.dependencies ?? createGameSceneDependencies()
        );
        this.gameSceneFactory = typeof options.gameSceneFactory === 'function'
            ? options.gameSceneFactory
            : (handler, gameSceneOptions) => new GameScene(handler, gameSceneOptions);
        this.enemyPresentationProfile = requireGpuPresentationProfile(
            options.enemyPresentationProfile
                ?? GPU_BODY_PRESENTATION_PROFILE.REFERENCE_CLOCK_EXTRAPOLATION
        );
        this.gpuGameScene = null;
        this.gpuSessionGeneration = 0;
        this.gpuSpawnBatchSequence = 0;
        this.gpuSpawnSequence = 0;
        this.totalQueuedGpuSpawnCount = 0;
        this.lastGpuSpawnBatchResult = createEmptySpawnBatchResult();
        this.lastGpuPlayerProxyResult = createEmptySpawnBatchResult();
        this.gpuProjectileSpawnBatchSequence = 0;
        this.gpuProjectileSpawnSequence = 0;
        this.totalQueuedGpuProjectileSpawnCount = 0;
        this.lastGpuProjectileSpawnBatchResult = createEmptySpawnBatchResult();
        this.destroyed = false;

        this.player = null;
        this.projectiles = [];
        this.staticWalls = [];
        this.boxWalls = [];
        this.buttons = [];
        this.collisionStats = createDefaultCollisionStats();
        this.worldDrawOptions = {
            sceneSnapshot: null,
            mapGeometry: null,
            staticWalls: this.staticWalls,
            boxWalls: this.boxWalls,
            player: null,
            projectiles: this.projectiles,
            objectOffsetY: 0
        };
        this.buttonDrawOptions = { ww: 0 };

        this.wallIdCounter = 1;
        this.#syncViewport();
        this.#createGpuGameScene();
        this.#resetAuxiliaryWorld();
        this.#buildButtons();
        setReleaseSimulationProfilerEnabled(true);
    }

    #syncViewport() {
        this.WW = getSimulationWW();
        this.WH = getSimulationWH();
        this.objectWH = getSimulationObjectWH();
        this.objectOffsetY = getSimulationObjectOffsetY();
    }

    #resetAuxiliaryWorld() {
        if (!this.objectSystem) return;
        this.wallIdCounter = 1;
        applyBenchmarkSceneCommandsToLocalState(
            this,
            buildBenchmarkSceneResetAuxiliaryWorldCommands(this)
        );
    }

    #destroyAuxiliaryWorld() {
        applyBenchmarkSceneCommandsToLocalState(this, [{
            type: BENCHMARK_SCENE_COMMAND_TYPES.DESTROY_AUXILIARY_WORLD
        }]);
    }

    #createGpuGameScene() {
        const gameScene = this.gameSceneFactory(this.sceneSystem, {
            mapId: this.mapId,
            dependencies: this.gameSceneDependencies,
            tileNavigationSource: createGpuBenchmarkNavigationSource(),
            enemyWaveEnabled: false,
            gameplayWorldActorsEnabled: false,
            enemyRecoveryEnabled: false,
            enemyPresentationProfile: this.enemyPresentationProfile,
            initialCameraZoom: BENCHMARK_CAMERA_ZOOM
        });
        const requiredMethods = [
            'fixedUpdate',
            'update',
            'draw',
            'drawEnemySimulation',
            'resize',
            'synchronizePresentation',
            'destroy',
            'getGameSystem'
        ];
        for (const methodName of requiredMethods) {
            if (typeof gameScene?.[methodName] !== 'function') {
                gameScene?.destroy?.();
                throw new TypeError(`GPU benchmark GameScene.${methodName}()가 필요합니다.`);
            }
        }
        if (typeof gameScene.getGpuSimulationEndpoint !== 'function'
            && typeof gameScene.getEnemySimulationEndpoint !== 'function') {
            gameScene.destroy?.();
            throw new TypeError(
                'GPU benchmark GameScene.getGpuSimulationEndpoint()가 필요합니다.'
            );
        }
        this.gpuGameScene = gameScene;
        this.gpuSessionGeneration++;
        this.gpuSpawnBatchSequence = 0;
        this.gpuSpawnSequence = 0;
        this.totalQueuedGpuSpawnCount = 0;
        this.lastGpuSpawnBatchResult = createEmptySpawnBatchResult('session-reset');
        this.gpuProjectileSpawnBatchSequence = 0;
        this.gpuProjectileSpawnSequence = 0;
        this.totalQueuedGpuProjectileSpawnCount = 0;
        this.lastGpuProjectileSpawnBatchResult = createEmptySpawnBatchResult(
            'session-reset'
        );
        this.lastGpuPlayerProxyResult = requestGpuBenchmarkPlayerProxy({
            gameScene,
            sessionGeneration: this.gpuSessionGeneration
        });
    }

    #destroyGpuGameScene() {
        this.gpuGameScene?.destroy();
        this.gpuGameScene = null;
    }

    #buildButtons() {
        const metrics = createBenchmarkButtonMetrics(this);
        this.buttons = BENCHMARK_BUTTON_ACTIONS.map((action, index) => (
            createBenchmarkButton(this, action, metrics, index)
        ));
    }

    #restartGpuSession(profile) {
        if (this.destroyed) return false;
        const resolvedProfile = requireGpuPresentationProfile(profile);
        this.#destroyGpuGameScene();
        this.enemyPresentationProfile = resolvedProfile;
        this.#createGpuGameScene();
        this.#resetAuxiliaryWorld();
        this.#buildButtons();
        return true;
    }

    /** 기존 호환 이름이며 CPU fallback 없이 GPU session만 다시 시작합니다. */
    activateGpuVisualQa(profile = this.enemyPresentationProfile) {
        return this.#restartGpuSession(profile);
    }

    restartGpuVisualQa() {
        return this.#restartGpuSession(this.enemyPresentationProfile);
    }

    setGpuPresentationProfile(profile) {
        return this.#restartGpuSession(profile);
    }

    getRuntimeMode() {
        return this.runtimeMode;
    }

    /**
     * GPU 적과 CPU 보조 월드가 공유할 자식 GameScene의 projection입니다.
     * @returns {object|null} 현재 IWorldViewProjection2D입니다.
     */
    getGpuWorldViewProjection() {
        return this.gpuGameScene
            ?.getGameSystem?.()
            ?.getObjectSystem?.()
            ?.getWorldViewProjection?.() ?? null;
    }

    queueSpawnEnemies(count) {
        return enqueueBenchmarkCommand(
            buildBenchmarkSceneSpawnGpuEnemiesCommand(count)
        );
    }

    queueSpawnRandomBox() {
        return enqueueBenchmarkCommand(
            buildBenchmarkSceneSpawnRandomBoxCommand(this)
        );
    }

    queueSpawnProjectileBurst() {
        return enqueueBenchmarkCommand(
            buildBenchmarkSceneSpawnGpuProjectileBatchCommand()
        );
    }

    /**
     * command drain에서만 호출되어 다음 fixed tick의 GPU spawn request를 예약합니다.
     * commit/fixed/presentation/draw는 자식 GameSystem만 소유합니다.
     * @param {number} count - 예약할 적 수입니다.
     * @returns {object} 불변 batch 결과입니다.
     */
    spawnGpuEnemyBatch(count) {
        if (this.destroyed) {
            return createEmptySpawnBatchResult('scene-destroyed');
        }
        if (this.lastGpuPlayerProxyResult?.accepted !== true) {
            return createEmptySpawnBatchResult(
                `player-proxy-${this.lastGpuPlayerProxyResult?.reason ?? 'unavailable'}`
            );
        }
        const result = requestGpuBenchmarkEnemyBatch({
            gameScene: this.gpuGameScene,
            count,
            sessionGeneration: this.gpuSessionGeneration,
            batchSequence: this.gpuSpawnBatchSequence,
            spawnSequence: this.gpuSpawnSequence
        });
        this.gpuSpawnBatchSequence++;
        this.lastGpuSpawnBatchResult = result;
        if (result.queuedCount > 0) {
            this.gpuSpawnSequence = result.nextSpawnSequence;
            this.totalQueuedGpuSpawnCount += result.queuedCount;
        }
        return result;
    }

    /** GPU projectile batch를 child mixed-body session의 다음 fixed tick에 예약합니다. */
    spawnGpuProjectileBatch(count) {
        if (this.destroyed) {
            return createEmptySpawnBatchResult('scene-destroyed');
        }
        const result = requestGpuBenchmarkProjectileBatch({
            gameScene: this.gpuGameScene,
            count,
            sessionGeneration: this.gpuSessionGeneration,
            batchSequence: this.gpuProjectileSpawnBatchSequence,
            spawnSequence: this.gpuProjectileSpawnSequence
        });
        this.gpuProjectileSpawnBatchSequence++;
        this.lastGpuProjectileSpawnBatchResult = result;
        if (result.queuedCount > 0) {
            this.gpuProjectileSpawnSequence = result.nextSpawnSequence;
            this.totalQueuedGpuProjectileSpawnCount += result.queuedCount;
        }
        return result;
    }

    toggleReleaseProfiler() {
        if (this.destroyed) return false;
        return setReleaseSimulationProfilerEnabled(
            !isReleaseSimulationProfilerCollecting()
        );
    }

    update(options = {}) {
        this.gpuGameScene?.update(options);
        cullLocalGameSceneProjectiles(this);
        syncGameSceneCollisionStats(this);
        updateGameSceneButtonInput(this.buttons);
    }

    fixedUpdate() {
        this.gpuGameScene?.fixedUpdate();
        // CPU 보조 player/projectile/wall은 전역 ObjectSystem fixed loop가 소유합니다.
    }

    applyRuntimeSettings() {
        // benchmark palette와 production GameScene renderer는 draw 시 live theme을 읽습니다.
    }

    resize() {
        this.#syncViewport();
        this.gpuGameScene?.resize();
        this.#resetAuxiliaryWorld();
        this.#buildButtons();
    }

    synchronizePresentation() {
        this.gpuGameScene?.synchronizePresentation();
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        setReleaseSimulationProfilerEnabled(false);
        this.#destroyGpuGameScene();
        this.#destroyAuxiliaryWorld();
        this.buttons = [];
    }

    applySimulationCommands(commands = []) {
        if (this.destroyed) return;
        applyBenchmarkSceneCommandsToLocalState(this, commands);
    }

    #drawAuxiliaryWorld() {
        const options = this.worldDrawOptions;
        options.mapGeometry = null;
        options.staticWalls = this.staticWalls;
        options.boxWalls = this.boxWalls;
        options.player = this.player;
        options.projectiles = this.projectiles;
        options.objectOffsetY = this.objectOffsetY;
        drawGameSceneWorldObjects(options);
    }

    #drawButtons() {
        this.buttonDrawOptions.ww = this.WW;
        drawGameSceneButtons(this.buttons, this.buttonDrawOptions);
    }

    /** GPU body readback 없이 endpoint/clock과 CPU 보조 도구 상태를 합친 HUD snapshot입니다. */
    getGpuVisualQaStatus() {
        const gameSystem = this.gpuGameScene?.getGameSystem?.() ?? null;
        const endpoint = resolveGpuSimulationEndpoint(this.gpuGameScene);
        const endpointStatus = endpoint?.getStatus?.() ?? null;
        const gpuStatus = endpointStatus?.backend?.gpu ?? null;
        const presentation = gpuStatus?.presentation ?? null;
        const kindCounts = resolveRegistryKindCounts(endpoint, endpointStatus);
        const eventTelemetry = resolveGpuEventTelemetry(gpuStatus);
        const recoveryStatus = this.gpuGameScene?.getEnemyRecoveryStatus?.() ?? null;
        let platformState = null;
        try {
            platformState = this.gameSceneDependencies?.webGpuPlatformPort?.getState?.() ?? null;
        } catch {
            platformState = null;
        }
        return Object.freeze({
            runtimeMode: this.runtimeMode,
            presentationProfile: presentation?.profile
                ?? this.enemyPresentationProfile,
            predictionDelta: presentation?.predictionDelta ?? 0,
            interpolationAlpha: presentation?.interpolationAlpha ?? 0,
            backendState: endpointStatus?.state ?? 'inactive',
            platformStatus: platformState?.status
                ?? (platformState?.ready === true ? 'ready' : 'unknown'),
            activeCount: kindCounts.totalActiveCount,
            enemyActiveCount: kindCounts.enemyActiveCount,
            projectileActiveCount: kindCounts.projectileActiveCount,
            playerProxyActiveCount: kindCounts.playerProxyActiveCount,
            reservedCount: endpointStatus?.reservedCount ?? 0,
            pendingCommandCount: endpointStatus?.pendingCommandCount ?? 0,
            totalQueuedEnemySpawnCount: this.totalQueuedGpuSpawnCount,
            totalQueuedProjectileSpawnCount:
                this.totalQueuedGpuProjectileSpawnCount,
            totalQueuedSpawnCount: this.totalQueuedGpuSpawnCount
                + this.totalQueuedGpuProjectileSpawnCount,
            fixedTick: gameSystem?.getFixedTick?.() ?? 0,
            overflowSmallCount: gpuStatus?.overflow?.lastSmallCount ?? 0,
            overflowBigCount: gpuStatus?.overflow?.lastBigCount ?? 0,
            recoveryRequired: endpointStatus?.recoveryRequired === true
                || gameSystem?.isEnemySimulationRecoveryRequired?.() === true,
            restartCount: recoveryStatus?.restartCount ?? 0,
            sessionGeneration: this.gpuSessionGeneration,
            projectileCount: this.projectiles.length,
            cpuProjectileCount: this.projectiles.length,
            boxCount: this.boxWalls.length,
            gpuContactCount: eventTelemetry.contactCount,
            gpuAppliedEventCount: eventTelemetry.appliedEventCount,
            gpuDeathEventCount: eventTelemetry.deathEventCount,
            gpuContactOverflowCount: eventTelemetry.contactOverflowCount,
            gpuAppliedEventOverflowCount:
                eventTelemetry.appliedEventOverflowCount,
            gpuDeathEventOverflowCount: eventTelemetry.deathEventOverflowCount,
            gpuEventSubmittedTickWatermark:
                eventTelemetry.submittedTickWatermark,
            gpuEventCompletedTickWatermark:
                eventTelemetry.completedTickWatermark,
            cpuCollisionCheckCount: this.collisionStats?.collisionCheckCount ?? 0,
            cpuAabbPassCount: this.collisionStats?.aabbPassCount ?? 0,
            cpuAabbRejectCount: this.collisionStats?.aabbRejectCount ?? 0,
            cpuCirclePassCount: this.collisionStats?.circlePassCount ?? 0,
            cpuCircleRejectCount: this.collisionStats?.circleRejectCount ?? 0,
            cpuPartChecks: this.collisionStats?.partChecks ?? 0,
            lastSpawnBatchReason: this.lastGpuSpawnBatchResult.reason,
            lastEnemySpawnBatchReason: this.lastGpuSpawnBatchResult.reason,
            lastPlayerProxyReason:
                this.lastGpuPlayerProxyResult?.reason ?? 'not-requested',
            lastProjectileSpawnBatchReason:
                this.lastGpuProjectileSpawnBatchResult.reason
        });
    }

    draw() {
        let startTime = beginPerformanceSection();
        this.gpuGameScene?.drawEnemySimulation();
        this.#drawAuxiliaryWorld();
        endPerformanceSection(BENCHMARK_DRAW_SECTIONS.WORLD, startTime);

        startTime = beginPerformanceSection();
        this.#drawButtons();
        endPerformanceSection(BENCHMARK_DRAW_SECTIONS.BUTTONS, startTime);

        startTime = beginPerformanceSection();
        drawGpuBenchmarkHud(this.getGpuVisualQaStatus(), {
            ww: this.WW,
            wh: this.WH
        });
        endPerformanceSection(BENCHMARK_DRAW_SECTIONS.HUD, startTime);
    }
}
