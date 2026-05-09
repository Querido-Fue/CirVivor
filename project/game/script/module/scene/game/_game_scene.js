import { getData } from 'data/data_handler.js';
import { BaseScene } from 'scene/_base_scene.js';
import { getObjectSystem } from 'object/object_system.js';
import { GAME_SCENE_COMMAND_TYPES } from 'simulation/game_scene_simulation_protocol.js';
import {
    GAME_SCENE_SHARED_PRESENTATION_STORAGE_TYPE,
    readGameSceneSharedPresentationState
} from 'simulation/game_scene_shared_presentation.js';
import { enqueueSimulationCommand } from 'simulation/simulation_command_queue.js';
import { createDefaultCollisionStats } from './game_scene_snapshot_utils.js';
import {
    buildGameSceneResetWorldCommands,
    buildGameSceneSpawnEnemiesCommand,
    buildGameSceneSpawnProjectileBurstCommand,
    buildGameSceneSpawnRandomBoxCommand
} from './commands/game_scene_benchmark_command_builder.js';
import { applyGameSceneCommandsToLocalState } from './commands/game_scene_command_apply_handlers.js';
import {
    consumeGameScenePendingCommands,
    createGameScenePendingCommandState,
    queueGameSceneProjectileDespawn
} from './commands/game_scene_pending_commands.js';
import {
    createGameSceneSimulationFrameSnapshot,
    createGameSceneSimulationSnapshot
} from './snapshot/game_scene_snapshot_builder.js';
import {
    getBenchmarkEnemyFill,
    normalizeOpaqueBenchmarkEnemyFill
} from './render/game_scene_benchmark_palette.js';
import { drawGameSceneButtons } from './render/game_scene_button_renderer.js';
import {
    drawGameSceneEnemySnapshots,
    drawGameSceneSharedEnemySnapshots
} from './render/game_scene_enemy_renderer.js';
import {
    drawGameSceneHud,
    drawGameSceneSharedHud
} from './render/game_scene_hud_renderer.js';
import {
    drawGameSceneSharedWorldObjects,
    drawGameSceneWorldObjects
} from './render/game_scene_world_renderer.js';
import {
    cullLocalGameSceneProjectiles,
    syncGameSceneCollisionStats,
    updateGameSceneButtonInput
} from './update/game_scene_update_helpers.js';
import {
    getGameSceneSystemHandler,
    syncGameSceneBenchmarkButtons,
    toggleGameSceneBenchmarkMulticore
} from './settings/game_scene_multicore_toggle.js';
import {
    getSimulationObjectOffsetY,
    getSimulationObjectWH,
    getSimulationWH,
    getSimulationWW
} from 'simulation/simulation_runtime.js';
import { measurePerformanceSection } from 'debug/debug_system.js';

const ENEMY_SHAPE_TYPES = getData('ENEMY_SHAPE_TYPES');

/**
 * @class GameScene
 * @description 충돌/AI 성능 측정을 위한 벤치마크 씬입니다.
 */
export class GameScene extends BaseScene {
    /**
     * @param {object} sceneHandler
     * @param {object} app
     */
    constructor(sceneHandler, app) {
        super(sceneHandler, app);

        this.objectSystem = getObjectSystem();
        this.enemyTypes = Array.isArray(ENEMY_SHAPE_TYPES) && ENEMY_SHAPE_TYPES.length > 0
            ? ENEMY_SHAPE_TYPES
            : ['square'];

        this.projectiles = [];
        this.staticWalls = [];
        this.boxWalls = [];
        this.buttons = [];
        this.pendingSimulationCommandState = createGameScenePendingCommandState();
        this.isSimulationWorkerTogglePending = false;
        this.sharedPresentationReadState = null;
        this.collisionStats = createDefaultCollisionStats();

        this.wallIdCounter = 1;
        this.projIdCounter = 1;
        this.#syncViewport();
        this.#resetBenchmarkWorld();
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
    #resetBenchmarkWorld() {
        if (!this.objectSystem) return;

        this.wallIdCounter = 1;
        this.projIdCounter = 1;
        this.applySimulationCommands(buildGameSceneResetWorldCommands(this));
    }

    /**
     * @private
     */
    #buildButtons() {
        const btnW = Math.max(160, this.WW * 0.13);
        const btnH = Math.max(38, this.WH * 0.052);
        const gap = Math.max(10, btnH * 0.24);
        const x = this.WW * 0.03;
        const y = this.WH * 0.08;

        this.buttons = [
            {
                id: 'spawnEnemy100',
                label: 'Spawn 100 Enemies',
                x,
                y,
                w: btnW,
                h: btnH,
                onClick: () => this.queueSpawnEnemies(100)
            },
            {
                id: 'spawnBox',
                label: 'Spawn Box',
                x,
                y: y + btnH + gap,
                w: btnW,
                h: btnH,
                onClick: () => this.queueSpawnRandomBox()
            },
            {
                id: 'spawnProjectile10',
                label: 'Spawn 10 Projectiles',
                x,
                y: y + ((btnH + gap) * 2),
                w: btnW,
                h: btnH,
                onClick: () => this.queueSpawnProjectileBurst()
            },
            {
                id: 'toggleMulticore',
                label: '',
                x,
                y: y + ((btnH + gap) * 3),
                w: btnW,
                h: btnH,
                onClick: () => {
                    void toggleGameSceneBenchmarkMulticore(this, () => this.#resetBenchmarkWorld());
                }
            }
        ];
        syncGameSceneBenchmarkButtons(this);
    }

    /**
     * 적 스폰 명령을 큐에 적재합니다.
     * @param {number} [count=100]
     * @returns {boolean}
     */
    queueSpawnEnemies(count = 100) {
        return enqueueSimulationCommand(buildGameSceneSpawnEnemiesCommand(this, count));
    }

    /**
     * 박스 벽 생성 명령을 큐에 적재합니다.
     * @returns {boolean}
     */
    queueSpawnRandomBox() {
        const command = buildGameSceneSpawnRandomBoxCommand(this);
        if (!command) {
            return false;
        }

        return enqueueSimulationCommand(command);
    }

    /**
     * 투사체 생성 명령을 큐에 적재합니다.
     * @returns {boolean}
     */
    queueSpawnProjectileBurst() {
        return enqueueSimulationCommand(buildGameSceneSpawnProjectileBurstCommand(this));
    }

    /**
     * @override
     */
    update(options = {}) {
        syncGameSceneBenchmarkButtons(this);
        updateGameSceneButtonInput(this.buttons);

        if (options?.simulationWorkerAuthority === true) {
            return;
        }

        cullLocalGameSceneProjectiles(this, (projectileId) => this.#queueProjectileDespawn(projectileId));
        syncGameSceneCollisionStats(this);
    }

    /**
     * @override
     */
    fixedUpdate() {
        // 벤치마크 씬의 고정 물리 루프는 ObjectSystem에서 처리됩니다.
    }

    /**
     * 런타임 설정 변경을 벤치마크 씬에 반영합니다.
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
        this.#resetBenchmarkWorld();
        this.#buildButtons();
    }

    /**
     * 씬 종료 시 객체 참조를 정리합니다.
     */
    destroy() {
        this.applySimulationCommands([{ type: GAME_SCENE_COMMAND_TYPES.DESTROY_WORLD }]);
    }

    /**
     * @override
     * @returns {object}
     */
    createSimulationSnapshot() {
        const objectSystemSnapshot = this.objectSystem && typeof this.objectSystem.createSimulationSnapshot === 'function'
            ? this.objectSystem.createSimulationSnapshot()
            : null;

        return createGameSceneSimulationSnapshot({
            objectSystemSnapshot,
            viewport: {
                ww: this.WW,
                wh: this.WH,
                objectWH: this.objectWH,
                objectOffsetY: this.objectOffsetY
            },
            wallIdCounter: this.wallIdCounter,
            projIdCounter: this.projIdCounter,
            player: this.player,
            staticWalls: this.staticWalls,
            boxWalls: this.boxWalls,
            projectiles: this.projectiles,
            collisionStats: this.collisionStats,
            buttons: this.buttons
        });
    }

    /**
     * @override
     * @returns {object}
     */
    createSimulationFrameSnapshot() {
        const objectSystemFrameSnapshot = this.objectSystem && typeof this.objectSystem.createSimulationFrameSnapshot === 'function'
            ? this.objectSystem.createSimulationFrameSnapshot()
            : null;

        return createGameSceneSimulationFrameSnapshot({
            objectSystemFrameSnapshot,
            viewport: {
                ww: this.WW,
                wh: this.WH,
                objectWH: this.objectWH,
                objectOffsetY: this.objectOffsetY
            },
            wallIdCounter: this.wallIdCounter,
            projIdCounter: this.projIdCounter,
            player: this.player,
            collisionStats: this.collisionStats
        });
    }

    /**
     * @override
     * @returns {object[]}
     */
    consumeSimulationCommands() {
        return consumeGameScenePendingCommands(this.pendingSimulationCommandState, {
            projIdCounter: this.projIdCounter
        });
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
     * @param {number|null|undefined} projectileId
     */
    #queueProjectileDespawn(projectileId) {
        queueGameSceneProjectileDespawn(this.pendingSimulationCommandState, projectileId);
    }

    /**
     * @private
     */
    #drawWorldObjects(sceneSnapshot = null) {
        drawGameSceneWorldObjects({
            sceneSnapshot,
            staticWalls: this.staticWalls,
            boxWalls: this.boxWalls,
            player: this.player,
            projectiles: this.projectiles,
            objectOffsetY: this.objectOffsetY
        });
    }

    /**
     * @private
     * @param {object|null|undefined} sharedState
     */
    #drawSharedWorldObjects(sharedState) {
        drawGameSceneSharedWorldObjects(sharedState, {
            objectOffsetY: this.objectOffsetY
        });
    }

    /**
     * @private
     */
    #drawEnemySnapshots(enemies = []) {
        drawGameSceneEnemySnapshots(enemies, {
            objectOffsetY: this.objectOffsetY,
            objectWH: this.objectWH
        });
    }

    /**
     * @private
     * @param {object|null|undefined} sharedState
     */
    #drawSharedEnemySnapshots(sharedState) {
        drawGameSceneSharedEnemySnapshots(sharedState, {
            objectOffsetY: this.objectOffsetY,
            objectWH: this.objectWH
        });
    }

    /**
     * @private
     * @param {object[]|null} [buttons=null]
     */
    #drawButtons(buttons = null) {
        const buttonList = Array.isArray(buttons) ? buttons : this.buttons;
        drawGameSceneButtons(buttonList, { ww: this.WW });
    }

    /**
     * @private
     */
    #drawHud(sceneSnapshot = null) {
        drawGameSceneHud({
            sceneSnapshot,
            collisionStats: this.collisionStats,
            objectSystem: this.objectSystem,
            systemHandler: getGameSceneSystemHandler(this),
            ww: this.WW,
            wh: this.WH
        });
    }

    /**
     * @private
     * @param {object|null|undefined} sharedState
     */
    #drawSharedHud(sharedState) {
        drawGameSceneSharedHud(sharedState, {
            collisionStats: this.collisionStats,
            systemHandler: getGameSceneSystemHandler(this),
            ww: this.WW,
            wh: this.WH
        });
    }

    /**
     * @override
     */
    draw() {
        measurePerformanceSection('scene.game.local.drawWorld', () => {
            this.#drawWorldObjects();
        });
        measurePerformanceSection('scene.game.local.drawButtons', () => {
            this.#drawButtons();
        });
        measurePerformanceSection('scene.game.local.drawHud', () => {
            this.#drawHud();
        });
    }

    /**
     * @override
     * @param {object|null} [sceneSnapshot=null]
     * @param {{renderEnemyObjects?: boolean, renderSceneObjects?: boolean}} [options={}]
     * @returns {boolean}
     */
    drawSimulationSnapshot(sceneSnapshot = null, options = {}) {
        if (!sceneSnapshot || sceneSnapshot.sceneType !== 'game') {
            return false;
        }

        if (sceneSnapshot.storageType === GAME_SCENE_SHARED_PRESENTATION_STORAGE_TYPE) {
            this.sharedPresentationReadState = measurePerformanceSection(
                'scene.game.shared.readState',
                () => readGameSceneSharedPresentationState(
                    sceneSnapshot.sharedPresentation,
                    this.sharedPresentationReadState
                )
            );
            const sharedState = this.sharedPresentationReadState;
            if (!sharedState) {
                return false;
            }

            if (options.renderEnemyObjects === true) {
                measurePerformanceSection('scene.game.shared.drawEnemies', () => {
                    this.#drawSharedEnemySnapshots(sharedState);
                });
            }
            if (options.renderSceneObjects !== false) {
                measurePerformanceSection('scene.game.shared.drawWorld', () => {
                    this.#drawSharedWorldObjects(sharedState);
                });
                measurePerformanceSection('scene.game.shared.drawButtons', () => {
                    this.#drawButtons();
                });
                measurePerformanceSection('scene.game.shared.drawHud', () => {
                    this.#drawSharedHud(sharedState);
                });
            }
            return true;
        }

        const renderEnemyObjects = options.renderEnemyObjects === true;
        const renderSceneObjects = options.renderSceneObjects !== false;

        if (renderEnemyObjects && Array.isArray(sceneSnapshot.enemies)) {
            measurePerformanceSection('scene.game.snapshot.drawEnemies', () => {
                this.#drawEnemySnapshots(sceneSnapshot.enemies);
            });
        }
        if (renderSceneObjects) {
            measurePerformanceSection('scene.game.snapshot.drawWorld', () => {
                this.#drawWorldObjects(sceneSnapshot);
            });
            measurePerformanceSection('scene.game.snapshot.drawButtons', () => {
                this.#drawButtons(Array.isArray(sceneSnapshot.buttons) ? sceneSnapshot.buttons : null);
            });
            measurePerformanceSection('scene.game.snapshot.drawHud', () => {
                this.#drawHud(sceneSnapshot);
            });
        }
        return true;
    }
}
