import { getData } from 'data/data_handler.js';
import { BaseScene } from 'scene/_base_scene.js';
import { getObjectSystem } from 'object/object_system.js';
import { GAME_SCENE_COMMAND_TYPES } from 'simulation/game_scene_simulation_protocol.js';
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
            }
        ];
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
    update() {
        updateGameSceneButtonInput(this.buttons);
        cullLocalGameSceneProjectiles(this);
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

}
