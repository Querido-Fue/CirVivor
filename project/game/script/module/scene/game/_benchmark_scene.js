import { ENEMY_SHAPE_TYPES } from 'data/object/enemy/enemy_catalog_data.js';
import { BaseScene } from 'scene/_base_scene.js';
import { getObjectSystem } from 'object/object_system.js';
import { GAME_SCENE_COMMAND_TYPES } from 'simulation/game_scene_simulation_protocol.js';
import { enqueueSimulationCommand } from 'simulation/simulation_command_queue.js';
import { createDefaultCollisionStats } from './game_scene_snapshot_utils.js';
import {
    buildGameSceneResetBenchmarkWorldCommands,
    buildGameSceneSpawnEnemiesCommand,
    buildGameSceneSpawnProjectileBurstCommand,
    buildGameSceneSpawnRandomBoxCommand
} from './commands/game_scene_benchmark_command_builder.js';
import { applyGameSceneCommandsToLocalState } from './commands/game_scene_command_apply_handlers.js';
import {
    getBenchmarkEnemyFill,
    normalizeOpaqueBenchmarkEnemyFill
} from './render/game_scene_benchmark_palette.js';
import { drawGameSceneButtons } from './render/game_scene_button_renderer.js';
import { drawGameSceneHud } from './render/game_scene_hud_renderer.js';
import { drawGameSceneWorldObjects } from './render/game_scene_world_renderer.js';
import {
    cullLocalGameSceneProjectiles,
    syncGameSceneCollisionStats,
    updateGameSceneButtonInput
} from './update/game_scene_update_helpers.js';
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

const GAME_SCENE_BUTTON_LAYOUT = Object.freeze({
    WIDTH_MIN: 160,
    WIDTH_WW_RATIO: 0.13,
    HEIGHT_MIN: 38,
    HEIGHT_WH_RATIO: 0.052,
    GAP_MIN: 10,
    GAP_HEIGHT_RATIO: 0.24,
    X_WW_RATIO: 0.03,
    Y_WH_RATIO: 0.08
});
const GAME_SCENE_BUTTON_ACTION_TYPES = Object.freeze({
    SPAWN_ENEMIES: 'spawnEnemies',
    SPAWN_BOX: 'spawnBox',
    SPAWN_PROJECTILES: 'spawnProjectiles',
    TOGGLE_RELEASE_PROFILER: 'toggleReleaseProfiler'
});
const GAME_SCENE_BUTTON_ACTIONS = Object.freeze([
    Object.freeze({
        id: 'spawnEnemy100',
        label: 'Spawn 100 Enemies',
        type: GAME_SCENE_BUTTON_ACTION_TYPES.SPAWN_ENEMIES,
        count: 100
    }),
    Object.freeze({
        id: 'spawnBox',
        label: 'Spawn Box',
        type: GAME_SCENE_BUTTON_ACTION_TYPES.SPAWN_BOX
    }),
    Object.freeze({
        id: 'spawnProjectile10',
        label: 'Spawn 10 Projectiles',
        type: GAME_SCENE_BUTTON_ACTION_TYPES.SPAWN_PROJECTILES
    }),
    Object.freeze({
        id: 'toggleReleaseProfiler',
        label: 'Toggle Profiler',
        type: GAME_SCENE_BUTTON_ACTION_TYPES.TOGGLE_RELEASE_PROFILER
    })
]);
const GAME_SCENE_DRAW_SECTIONS = Object.freeze({
    WORLD: 'scene.game.local.drawWorld',
    BUTTONS: 'scene.game.local.drawButtons',
    HUD: 'scene.game.local.drawHud'
});
const BENCHMARK_SCENE_MODE = 'benchmark';

/**
 * 벤치마크 버튼 배치 값을 계산합니다.
 * @param {object} scene - 게임 씬 인스턴스입니다.
 * @returns {{x:number, y:number, w:number, h:number, rowStride:number}} 버튼 배치 값입니다.
 */
function createGameSceneButtonMetrics(scene) {
    const width = Math.max(
        GAME_SCENE_BUTTON_LAYOUT.WIDTH_MIN,
        scene.WW * GAME_SCENE_BUTTON_LAYOUT.WIDTH_WW_RATIO
    );
    const height = Math.max(
        GAME_SCENE_BUTTON_LAYOUT.HEIGHT_MIN,
        scene.WH * GAME_SCENE_BUTTON_LAYOUT.HEIGHT_WH_RATIO
    );
    const gap = Math.max(
        GAME_SCENE_BUTTON_LAYOUT.GAP_MIN,
        height * GAME_SCENE_BUTTON_LAYOUT.GAP_HEIGHT_RATIO
    );

    return {
        x: scene.WW * GAME_SCENE_BUTTON_LAYOUT.X_WW_RATIO,
        y: scene.WH * GAME_SCENE_BUTTON_LAYOUT.Y_WH_RATIO,
        w: width,
        h: height,
        rowStride: height + gap
    };
}

/**
 * 버튼 action 데이터에 맞는 클릭 handler를 생성합니다.
 * @param {BenchmarkScene} scene - 벤치마크 씬 인스턴스입니다.
 * @param {object} action - 버튼 action 데이터입니다.
 * @returns {Function} 클릭 handler입니다.
 */
function createGameSceneButtonClickHandler(scene, action) {
    if (action.type === GAME_SCENE_BUTTON_ACTION_TYPES.SPAWN_ENEMIES) {
        return () => scene.queueSpawnEnemies(action.count);
    }
    if (action.type === GAME_SCENE_BUTTON_ACTION_TYPES.SPAWN_BOX) {
        return () => scene.queueSpawnRandomBox();
    }
    if (action.type === GAME_SCENE_BUTTON_ACTION_TYPES.SPAWN_PROJECTILES) {
        return () => scene.queueSpawnProjectileBurst();
    }
    if (action.type === GAME_SCENE_BUTTON_ACTION_TYPES.TOGGLE_RELEASE_PROFILER) {
        return () => scene.toggleReleaseProfiler();
    }
    return () => false;
}

/**
 * 벤치마크 버튼 데이터를 생성합니다.
 * @param {BenchmarkScene} scene - 벤치마크 씬 인스턴스입니다.
 * @param {object} action - 버튼 action 데이터입니다.
 * @param {{x:number, y:number, w:number, h:number, rowStride:number}} metrics - 버튼 배치 값입니다.
 * @param {number} index - 버튼 순서입니다.
 * @returns {object} 버튼 데이터입니다.
 */
function createGameSceneButton(scene, action, metrics, index) {
    return {
        id: action.id,
        label: action.label,
        x: metrics.x,
        y: metrics.y + (metrics.rowStride * index),
        w: metrics.w,
        h: metrics.h,
        onClick: createGameSceneButtonClickHandler(scene, action)
    };
}

/**
 * 시뮬레이션 명령을 큐에 적재합니다.
 * @param {object|null} command - 적재할 시뮬레이션 명령입니다.
 * @returns {boolean} 명령 적재 여부입니다.
 */
function enqueueGameSceneCommand(command) {
    return command ? enqueueSimulationCommand(command) : false;
}

/**
 * @class BenchmarkScene
 * @description 기존 성능 측정 월드와 제어 버튼을 보존하는 전용 벤치마크 씬입니다.
 */
export class BenchmarkScene extends BaseScene {
    /**
     * @param {object} sceneHandler
     */
    constructor(sceneHandler) {
        super(sceneHandler);

        this.mode = BENCHMARK_SCENE_MODE;
        this.mapId = null;
        this.mapGeometry = null;
        this.objectSystem = getObjectSystem();
        this.enemyTypes = Array.isArray(ENEMY_SHAPE_TYPES) && ENEMY_SHAPE_TYPES.length > 0
            ? ENEMY_SHAPE_TYPES
            : ['square'];

        this.projectiles = [];
        this.staticWalls = [];
        this.boxWalls = [];
        this.buttons = [];
        this.collisionStats = createDefaultCollisionStats();
        this.worldDrawOptions = {
            sceneSnapshot: null,
            mapGeometry: this.mapGeometry,
            staticWalls: this.staticWalls,
            boxWalls: this.boxWalls,
            player: null,
            projectiles: this.projectiles,
            objectOffsetY: 0
        };
        this.buttonDrawOptions = { ww: 0 };
        this.hudDrawOptions = {
            sceneSnapshot: null,
            collisionStats: this.collisionStats,
            objectSystem: this.objectSystem,
            ww: 0,
            wh: 0
        };
        setReleaseSimulationProfilerEnabled(this.#isBenchmarkMode());

        this.wallIdCounter = 1;
        this.projIdCounter = 1;
        this.#syncViewport();
        this.#resetWorld();
        this.#buildButtons();
    }

    /**
     * @private
     */
    #syncViewport() {
        this.WW = getSimulationWW();
        this.WH = getSimulationWH();
        this.objectWH = getSimulationObjectWH();
        this.objectOffsetY = getSimulationObjectOffsetY();
    }

    /**
     * @private
     */
    #resetWorld() {
        if (!this.objectSystem) return;

        this.wallIdCounter = 1;
        this.projIdCounter = 1;
        this.applySimulationCommands(buildGameSceneResetBenchmarkWorldCommands(this));
    }

    /**
     * @private
     */
    #buildButtons() {
        if (!this.#isBenchmarkMode()) {
            this.buttons = [];
            return;
        }

        const metrics = createGameSceneButtonMetrics(this);
        this.buttons = GAME_SCENE_BUTTON_ACTIONS.map((action, index) => {
            return createGameSceneButton(this, action, metrics, index);
        });
    }

    /**
     * 현재 씬이 벤치마크 모드인지 반환합니다.
     * @returns {boolean}
     * @private
     */
    #isBenchmarkMode() {
        return this.mode === BENCHMARK_SCENE_MODE;
    }

    /**
     * 적 스폰 명령을 큐에 적재합니다.
     * @param {number} [count] - 생성할 적 수입니다.
     * @returns {boolean}
     */
    queueSpawnEnemies(count) {
        return enqueueGameSceneCommand(buildGameSceneSpawnEnemiesCommand(this, count));
    }

    /**
     * 박스 벽 생성 명령을 큐에 적재합니다.
     * @returns {boolean}
     */
    queueSpawnRandomBox() {
        return enqueueGameSceneCommand(buildGameSceneSpawnRandomBoxCommand(this));
    }

    /**
     * 투사체 생성 명령을 큐에 적재합니다.
     * @returns {boolean}
     */
    queueSpawnProjectileBurst() {
        return enqueueGameSceneCommand(buildGameSceneSpawnProjectileBurstCommand(this));
    }

    /**
     * 벤치마크 세션의 릴리스 계측을 켜거나 끕니다.
     * @returns {boolean} 최종 계측 활성 상태입니다.
     */
    toggleReleaseProfiler() {
        if (!this.#isBenchmarkMode()) {
            return false;
        }
        return setReleaseSimulationProfilerEnabled(!isReleaseSimulationProfilerCollecting());
    }

    /**
     * @override
     */
    update() {
        const benchmarkMode = this.#isBenchmarkMode();
        if (benchmarkMode) {
            updateGameSceneButtonInput(this.buttons);
        }
        cullLocalGameSceneProjectiles(this);
        if (benchmarkMode) {
            syncGameSceneCollisionStats(this);
        }
    }

    /**
     * @override
     */
    fixedUpdate() {
        // 게임 씬의 고정 물리 루프는 ObjectSystem에서 처리됩니다.
    }

    /**
     * 런타임 설정 변경을 게임 씬에 반영합니다.
     * @param {object} [changedSettings={}] - 변경된 설정 키와 값입니다.
     */
    applyRuntimeSettings(changedSettings = {}) {
        if (changedSettings.theme !== undefined) {
            this.#refreshBenchmarkEnemyFills();
        }
    }

    /**
     * @override
     */
    resize() {
        this.#syncViewport();
        this.#resetWorld();
        this.#buildButtons();
    }

    /**
     * 씬 종료 시 객체 참조를 정리합니다.
     */
    destroy() {
        if (this.#isBenchmarkMode()) {
            setReleaseSimulationProfilerEnabled(false);
        }
        this.applySimulationCommands([{ type: GAME_SCENE_COMMAND_TYPES.DESTROY_WORLD }]);
    }

    /**
     * @override
     * @param {object[]} [commands=[]]
     */
    applySimulationCommands(commands = []) {
        applyGameSceneCommandsToLocalState(this, commands);
    }

    /**
     * 현재 테마의 벤치마크 적 색상을 기존 적 인스턴스에 반영합니다.
     * @private
     */
    #refreshBenchmarkEnemyFills() {
        const enemies = this.objectSystem && typeof this.objectSystem.getEnemies === 'function'
            ? this.objectSystem.getEnemies()
            : [];
        const fill = normalizeOpaqueBenchmarkEnemyFill(getBenchmarkEnemyFill());

        for (let i = 0; i < enemies.length; i++) {
            const enemy = enemies[i];
            if (enemy && enemy.active !== false) {
                enemy.fill = fill;
            }
        }
    }

    /**
     * @private
     */
    #drawWorldObjects(sceneSnapshot = null) {
        const options = this.worldDrawOptions;
        options.sceneSnapshot = sceneSnapshot;
        options.mapGeometry = this.mapGeometry;
        options.staticWalls = this.staticWalls;
        options.boxWalls = this.boxWalls;
        options.player = this.player;
        options.projectiles = this.projectiles;
        options.objectOffsetY = this.objectOffsetY;
        drawGameSceneWorldObjects(options);
    }

    /**
     * @private
     * @param {object[]|null} [buttons=null]
     */
    #drawButtons(buttons = null) {
        const buttonList = Array.isArray(buttons) ? buttons : this.buttons;
        this.buttonDrawOptions.ww = this.WW;
        drawGameSceneButtons(buttonList, this.buttonDrawOptions);
    }

    /**
     * @private
     */
    #drawHud(sceneSnapshot = null) {
        const options = this.hudDrawOptions;
        options.sceneSnapshot = sceneSnapshot;
        options.collisionStats = this.collisionStats;
        options.objectSystem = this.objectSystem;
        options.ww = this.WW;
        options.wh = this.WH;
        drawGameSceneHud(options);
    }

    /**
     * @override
     */
    draw() {
        let startTime = beginPerformanceSection();
        this.#drawWorldObjects();
        endPerformanceSection(GAME_SCENE_DRAW_SECTIONS.WORLD, startTime);
        if (!this.#isBenchmarkMode()) {
            return;
        }
        startTime = beginPerformanceSection();
        this.#drawButtons();
        endPerformanceSection(GAME_SCENE_DRAW_SECTIONS.BUTTONS, startTime);
        startTime = beginPerformanceSection();
        this.#drawHud();
        endPerformanceSection(GAME_SCENE_DRAW_SECTIONS.HUD, startTime);
    }

}
