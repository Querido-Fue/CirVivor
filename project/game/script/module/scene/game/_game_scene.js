import { getData } from 'data/data_handler.js';
import { BaseScene } from 'scene/_base_scene.js';
import { getObjectSystem } from 'object/object_system.js';
import { enemyAI } from 'object/enemy/ai/_enemy_ai.js';
import { Player } from 'object/player/_player.js';
import { BaseProj } from 'object/proj/_base_proj.js';
import { BaseWall } from 'object/wall/_base_wall.js';
import { GAME_SCENE_COMMAND_TYPES } from 'simulation/game_scene_simulation_protocol.js';
import {
    GAME_SCENE_SHARED_PRESENTATION_STORAGE_TYPE,
    readGameSceneSharedPresentationState
} from 'simulation/game_scene_shared_presentation.js';
import { enqueueSimulationCommand } from 'simulation/simulation_command_queue.js';
import { createDefaultCollisionStats } from './game_scene_snapshot_utils.js';
import { applyGameSceneSimulationCommands } from './commands/game_scene_command_dispatcher.js';
import {
    clearGameScenePendingCommandState,
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
    getSimulationMouseInput,
    getSimulationObjectOffsetY,
    getSimulationObjectWH,
    getSimulationWH,
    getSimulationWW,
    hasSimulationMouseState
} from 'simulation/simulation_runtime.js';
import { measurePerformanceSection } from 'debug/debug_system.js';

const ENEMY_SHAPE_TYPES = getData('ENEMY_SHAPE_TYPES');
const MULTICORE_SETTING_KEY = 'simulationWorkerAuthorityMode';
const BENCHMARK_WALL_HEIGHT_RATIO = 0.5;
const BENCHMARK_WALL_THICKNESS_RATIO = 0.008;
const BENCHMARK_BOX_SIZE_RATIO = 0.05;
const BENCHMARK_PROJECTILE_SIZE_RATIO = 0.03;
const BENCHMARK_PROJECTILE_TRAVEL_SECONDS = 2;
const PROJECTILE_CULL_MARGIN_RATIO = 0.2;
const BENCHMARK_ENEMY_SPEED_MULTIPLIER = 2.5;
const GAME_SCENE_AI_BY_ID = Object.freeze({
    enemyAI,
    tempAI: enemyAI
});

const pointInRect = (x, y, rect) => (
    x >= rect.x &&
    x <= rect.x + rect.w &&
    y >= rect.y &&
    y <= rect.y + rect.h
);

const rectCircleOverlap = (rect, x, y, radius) => {
    const closestX = Math.max(rect.minX, Math.min(x, rect.maxX));
    const closestY = Math.max(rect.minY, Math.min(y, rect.maxY));
    const dx = x - closestX;
    const dy = y - closestY;
    return ((dx * dx) + (dy * dy)) <= (radius * radius);
};

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
        this.applySimulationCommands(this.#buildResetWorldCommands());
    }

    /**
     * @private
     * @param {number} x
     * @param {number} y
     * @param {number} w
     * @param {number} h
     * @returns {object}
     */
    #createWallData(x, y, w, h) {
        return {
            id: this.wallIdCounter++,
            x,
            y,
            w,
            h,
            origin: 'center'
        };
    }

    /**
     * @private
     * @param {object} wallData
     * @returns {BaseWall}
     */
    #createWallEntity(wallData) {
        return new BaseWall().init(wallData);
    }

    /**
     * @private
     * @param {object} playerData
     * @returns {Player}
     */
    #createPlayerEntity(playerData) {
        return new Player().init(playerData);
    }

    /**
     * @private
     * @param {object} projectileData
     * @returns {BaseProj}
     */
    #createProjectileEntity(projectileData) {
        const projectile = new BaseProj().init(projectileData);
        projectile.clearHitHistory();
        return projectile;
    }

    /**
     * @private
     */
    #syncWalls() {
        if (!this.objectSystem) return;
        this.objectSystem.setWalls([...this.staticWalls, ...this.boxWalls]);
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
                    void this.#toggleBenchmarkMulticore();
                }
            }
        ];
        this.#syncBenchmarkButtons();
    }

    /**
     * @private
     * @returns {object|null}
     */
    #getSystemHandler() {
        return this.sceneSystem?.systemHandler ?? null;
    }

    /**
     * @private
     * @returns {boolean}
     */
    #isBenchmarkMulticoreEnabled() {
        const systemHandler = this.#getSystemHandler();
        const saveSystem = systemHandler?.saveSystem;
        if (!saveSystem || typeof saveSystem.getSetting !== 'function') {
            return false;
        }

        return saveSystem.getSetting(MULTICORE_SETTING_KEY) === true;
    }

    /**
     * @private
     * @returns {string}
     */
    #getBenchmarkMulticoreButtonLabel() {
        return this.#isBenchmarkMulticoreEnabled()
            ? 'Multicore: ON'
            : 'Multicore: OFF';
    }

    /**
     * @private
     */
    #syncBenchmarkButtons() {
        for (let i = 0; i < this.buttons.length; i++) {
            const button = this.buttons[i];
            if (!button) continue;

            if (button.id === 'toggleMulticore') {
                button.label = this.#getBenchmarkMulticoreButtonLabel();
            }
        }
    }

    /**
     * @private
     * @returns {Promise<void>}
     */
    async #toggleBenchmarkMulticore() {
        if (this.isSimulationWorkerTogglePending) {
            return;
        }

        const systemHandler = this.#getSystemHandler();
        const saveSystem = systemHandler?.saveSystem;
        if (!systemHandler
            || !saveSystem
            || typeof saveSystem.setSettingBatch !== 'function'
            || typeof systemHandler.applyRuntimeSettings !== 'function') {
            return;
        }

        const nextEnabled = !this.#isBenchmarkMulticoreEnabled();
        const changedSettings = {
            [MULTICORE_SETTING_KEY]: nextEnabled
        };

        this.isSimulationWorkerTogglePending = true;
        this.#syncBenchmarkButtons();

        try {
            await saveSystem.setSettingBatch(changedSettings);
            this.#syncBenchmarkButtons();
            await systemHandler.applyRuntimeSettings(changedSettings);
            this.#resetBenchmarkWorld();
        } catch (error) {
            console.error('벤치마크 멀티코어 토글 적용 실패:', error);
        } finally {
            this.isSimulationWorkerTogglePending = false;
            this.#syncBenchmarkButtons();
        }
    }

    /**
     * @private
     * @param {number} min
     * @param {number} max
     * @returns {number}
     */
    #random(min, max) {
        return (Math.random() * (max - min)) + min;
    }

    /**
     * @private
     * @param {number} min
     * @param {number} max
     * @returns {number}
     */
    #randomInt(min, max) {
        return Math.floor(this.#random(min, max + 1));
    }

    /**
     * @private
     * @param {number} x
     * @param {number} y
     * @param {number} radius
     * @param {object[]|null} [walls=null]
     * @returns {boolean}
     */
    #isPointBlockedByWall(x, y, radius, walls = null) {
        const allWalls = Array.isArray(walls)
            ? walls
            : [...this.staticWalls, ...this.boxWalls];
        for (let i = 0; i < allWalls.length; i++) {
            const wall = allWalls[i];
            if (!wall || wall.active === false) continue;
            const halfW = wall.w * 0.5;
            const halfH = wall.h * 0.5;
            const rect = {
                minX: wall.x - halfW,
                maxX: wall.x + halfW,
                minY: wall.y - halfH,
                maxY: wall.y + halfH
            };
            if (rectCircleOverlap(rect, x, y, radius)) return true;
        }
        return false;
    }

    /**
     * @private
     * @param {object[]} existingWalls
     * @param {{position?: {x:number, y:number}, radius?: number}|null} playerLike
     * @returns {object|null}
     */
    #buildRandomBoxWallData(existingWalls = [], playerLike = null) {
        const size = this.objectWH * BENCHMARK_BOX_SIZE_RATIO;
        const radius = (size * Math.SQRT2) * 0.5;
        const margin = Math.max(size * 0.55, this.objectWH * 0.03);
        const minX = margin;
        const maxX = Math.max(minX, this.WW - margin);
        const minY = margin;
        const maxY = Math.max(minY, this.objectWH - margin);

        for (let tries = 0; tries < 36; tries++) {
            const x = this.#random(minX, maxX);
            const y = this.#random(minY, maxY);
            if (this.#isPointBlockedByWall(x, y, radius, existingWalls)) {
                continue;
            }

            if (playerLike && playerLike.position) {
                const dx = x - playerLike.position.x;
                const dy = y - playerLike.position.y;
                const keepout = Math.max((playerLike.radius || 0) + radius + (this.objectWH * 0.04), 8);
                if (((dx * dx) + (dy * dy)) < (keepout * keepout)) {
                    continue;
                }
            }

            return this.#createWallData(x, y, size, size);
        }

        return null;
    }

    /**
     * @private
     * 현재 씬 상태와 초기 배치를 반영한 월드 교체 명령 목록을 생성합니다.
     * @returns {object[]}
     */
    #buildResetWorldCommands() {
        const playerData = {
            id: 1,
            radius: this.objectWH * 0.02,
            position: {
                x: this.WW * 0.5,
                y: this.objectWH * 0.5
            },
            speed: { x: 0, y: 0 },
            weight: 999999
        };

        const wallThickness = Math.max(8, this.WW * BENCHMARK_WALL_THICKNESS_RATIO);
        const wallHeight = this.objectWH * BENCHMARK_WALL_HEIGHT_RATIO;
        const wallY = this.objectWH * 0.5;
        const staticWalls = [
            this.#createWallData(this.WW * 0.25, wallY, wallThickness, wallHeight),
            this.#createWallData(this.WW * 0.75, wallY, wallThickness, wallHeight)
        ];
        const boxWalls = [];

        for (let i = 0; i < 3; i++) {
            const wallData = this.#buildRandomBoxWallData([...staticWalls, ...boxWalls], playerData);
            if (wallData) {
                boxWalls.push(wallData);
            }
        }

        return [{
            type: GAME_SCENE_COMMAND_TYPES.REPLACE_WORLD,
            player: playerData,
            staticWalls,
            boxWalls,
            projectiles: [],
            nextWallIdCounter: this.wallIdCounter,
            nextProjIdCounter: this.projIdCounter
        }];
    }

    /**
     * @private
     * @returns {{x:number, y:number}}
     */
    #randomEnemySpawnPosition() {
        const margin = this.objectWH * 0.07;
        const side = this.#randomInt(0, 3);

        if (side === 0) {
            return { x: this.#random(margin, this.WW - margin), y: margin };
        }
        if (side === 1) {
            return { x: this.#random(margin, this.WW - margin), y: this.objectWH - margin };
        }
        if (side === 2) {
            return { x: margin, y: this.#random(margin, this.objectWH - margin) };
        }
        return { x: this.WW - margin, y: this.#random(margin, this.objectWH - margin) };
    }

    /**
     * 적 100마리 스폰 버튼 액션
     * @param {number} [count=100]
     */
    #buildSpawnEnemiesCommand(count = 100) {
        const fill = getBenchmarkEnemyFill();
        const enemies = [];
        const reservedEnemyIds = this.objectSystem && typeof this.objectSystem.reserveEnemyIds === 'function'
            ? this.objectSystem.reserveEnemyIds(count)
            : [];

        for (let i = 0; i < count; i++) {
            const type = this.enemyTypes[this.#randomInt(0, this.enemyTypes.length - 1)];
            const spawnPos = this.#randomEnemySpawnPosition();
            const angle = this.#random(0, Math.PI * 2);
            const speedMag = this.#random(20, 64);

            enemies.push({
                id: Number.isInteger(reservedEnemyIds[i]) ? reservedEnemyIds[i] : null,
                type,
                hp: 1,
                maxHp: 1,
                atk: 1,
                moveSpeed: this.#random(0.85, 1.2) * BENCHMARK_ENEMY_SPEED_MULTIPLIER,
                accSpeed: 0,
                size: 1.5,
                projectileHitsToKill: 3,
                position: spawnPos,
                speed: {
                    x: Math.cos(angle) * speedMag,
                    y: Math.sin(angle) * speedMag
                },
                acc: { x: 0, y: 0 },
                aiId: 'enemyAI',
                fill,
                alpha: 1,
                rotation: this.#random(0, 360)
            });
        }

        return {
            type: GAME_SCENE_COMMAND_TYPES.SPAWN_ENEMY_BATCH,
            enemies,
            nextEnemyIdCounter: this.objectSystem && typeof this.objectSystem.getEnemyIdCounter === 'function'
                ? this.objectSystem.getEnemyIdCounter()
                : null
        };
    }

    /**
     * 적 스폰 명령을 큐에 적재합니다.
     * @param {number} [count=100]
     * @returns {boolean}
     */
    queueSpawnEnemies(count = 100) {
        return enqueueSimulationCommand(this.#buildSpawnEnemiesCommand(count));
    }

    /**
     * @private
     * 맵 임의 위치에 추가할 박스 벽 명령을 생성합니다.
     * @returns {object|null}
     */
    #buildSpawnRandomBoxCommand() {
        const wallData = this.#buildRandomBoxWallData(
            [...this.staticWalls, ...this.boxWalls],
            this.player
        );
        if (!wallData) {
            return null;
        }

        return {
            type: GAME_SCENE_COMMAND_TYPES.APPEND_BOX_WALLS,
            walls: [wallData],
            nextWallIdCounter: this.wallIdCounter
        };
    }

    /**
     * 박스 벽 생성 명령을 큐에 적재합니다.
     * @returns {boolean}
     */
    queueSpawnRandomBox() {
        const command = this.#buildSpawnRandomBoxCommand();
        if (!command) {
            return false;
        }

        return enqueueSimulationCommand(command);
    }

    /**
     * @private
     * 투사체 일괄 생성 명령을 구성합니다.
     * @returns {object}
     */
    #buildSpawnProjectileBurstCommand() {
        const diameter = this.objectWH * BENCHMARK_PROJECTILE_SIZE_RATIO;
        const radius = diameter * 0.5;
        const startX = -this.WW * 0.1;
        const endX = this.WW * 1.1;
        const speedX = (endX - startX) / Math.max(0.016, BENCHMARK_PROJECTILE_TRAVEL_SECONDS);
        const projectiles = [];

        for (let i = 0; i < 10; i++) {
            const y = this.#random(radius, Math.max(radius, this.objectWH - radius));
            projectiles.push({
                id: this.projIdCounter++,
                radius,
                weight: 0.07,
                impactForce: 1,
                piercing: true,
                position: { x: startX, y },
                speed: { x: speedX, y: 0 }
            });
        }

        return {
            type: GAME_SCENE_COMMAND_TYPES.APPEND_PROJECTILES,
            projectiles,
            nextProjIdCounter: this.projIdCounter
        };
    }

    /**
     * 투사체 생성 명령을 큐에 적재합니다.
     * @returns {boolean}
     */
    queueSpawnProjectileBurst() {
        return enqueueSimulationCommand(this.#buildSpawnProjectileBurstCommand());
    }

    /**
     * @override
     */
    update(options = {}) {
        this.#syncBenchmarkButtons();
        const mousePos = getSimulationMouseInput('pos');
        const clicked = hasSimulationMouseState('left', 'clicked');
        if (clicked && mousePos) {
            for (let i = 0; i < this.buttons.length; i++) {
                const button = this.buttons[i];
                if (pointInRect(mousePos.x, mousePos.y, button)) {
                    button.onClick();
                    break;
                }
            }
        }

        if (options?.simulationWorkerAuthority === true) {
            return;
        }

        const cullMinX = -this.WW * PROJECTILE_CULL_MARGIN_RATIO;
        const cullMaxX = this.WW * (1 + PROJECTILE_CULL_MARGIN_RATIO);
        const cullMinY = -this.objectWH * PROJECTILE_CULL_MARGIN_RATIO;
        const cullMaxY = this.objectWH * (1 + PROJECTILE_CULL_MARGIN_RATIO);
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const projectile = this.projectiles[i];
            if (!projectile || projectile.active === false) {
                this.#queueProjectileDespawn(projectile?.id);
                this.projectiles.splice(i, 1);
                continue;
            }

            const x = projectile.position.x;
            const y = projectile.position.y;
            if (x < cullMinX || x > cullMaxX || y < cullMinY || y > cullMaxY) {
                this.#queueProjectileDespawn(projectile.id);
                this.projectiles.splice(i, 1);
            }
        }

        if (this.objectSystem && typeof this.objectSystem.getCollisionStats === 'function') {
            this.collisionStats = this.objectSystem.getCollisionStats();
        }
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
        if (!Array.isArray(commands) || commands.length === 0 || !this.objectSystem) {
            return;
        }

        applyGameSceneSimulationCommands(commands, {
            [GAME_SCENE_COMMAND_TYPES.REPLACE_WORLD]: (command) => this.#applyReplaceWorldCommand(command),
            [GAME_SCENE_COMMAND_TYPES.SPAWN_ENEMY_BATCH]: (command) => this.#applySpawnEnemyBatchCommand(command),
            [GAME_SCENE_COMMAND_TYPES.APPEND_BOX_WALLS]: (command) => this.#applyAppendBoxWallsCommand(command),
            [GAME_SCENE_COMMAND_TYPES.APPEND_PROJECTILES]: (command) => this.#applyAppendProjectilesCommand(command),
            [GAME_SCENE_COMMAND_TYPES.DESPAWN_PROJECTILE_BATCH]: (command) => this.#applyDespawnProjectilesCommand(command),
            [GAME_SCENE_COMMAND_TYPES.DESTROY_WORLD]: () => this.#applyDestroyWorldCommand()
        });
    }

    /**
     * @private
     * @param {object} command
     */
    #applyReplaceWorldCommand(command) {
        this.objectSystem.showcaseEnabled = false;
        this.objectSystem.clearEnemies();
        clearGameScenePendingCommandState(this.pendingSimulationCommandState);

        this.player = command.player ? this.#createPlayerEntity(command.player) : null;
        this.projectiles = Array.isArray(command.projectiles)
            ? command.projectiles.map((projectileData) => this.#createProjectileEntity(projectileData))
            : [];
        this.staticWalls = Array.isArray(command.staticWalls)
            ? command.staticWalls.map((wallData) => this.#createWallEntity(wallData))
            : [];
        this.boxWalls = Array.isArray(command.boxWalls)
            ? command.boxWalls.map((wallData) => this.#createWallEntity(wallData))
            : [];
        this.wallIdCounter = Number.isInteger(command.nextWallIdCounter) ? command.nextWallIdCounter : this.wallIdCounter;
        this.projIdCounter = Number.isInteger(command.nextProjIdCounter) ? command.nextProjIdCounter : this.projIdCounter;

        this.objectSystem.setPlayers(this.player ? [this.player] : []);
        this.objectSystem.setProjectiles(this.projectiles);
        this.objectSystem.setItems([]);
        this.#syncWalls();
    }

    /**
     * @private
     * @param {object} command
     */
    #applySpawnEnemyBatchCommand(command) {
        const enemies = Array.isArray(command.enemies) ? command.enemies : [];
        for (let i = 0; i < enemies.length; i++) {
            const enemyData = enemies[i];
            if (!enemyData || typeof enemyData.type !== 'string') {
                continue;
            }

            this.objectSystem.spawnEnemy(enemyData.type, {
                ...enemyData,
                ai: this.#resolveEnemyAI(enemyData.aiId)
            });
        }
    }

    /**
     * @private
     * @param {object} command
     */
    #applyAppendBoxWallsCommand(command) {
        const walls = Array.isArray(command.walls) ? command.walls : [];
        for (let i = 0; i < walls.length; i++) {
            this.boxWalls.push(this.#createWallEntity(walls[i]));
        }
        this.wallIdCounter = Number.isInteger(command.nextWallIdCounter) ? command.nextWallIdCounter : this.wallIdCounter;
        this.#syncWalls();
    }

    /**
     * @private
     * @param {object} command
     */
    #applyAppendProjectilesCommand(command) {
        const projectiles = Array.isArray(command.projectiles) ? command.projectiles : [];
        for (let i = 0; i < projectiles.length; i++) {
            this.projectiles.push(this.#createProjectileEntity(projectiles[i]));
        }
        this.projIdCounter = Number.isInteger(command.nextProjIdCounter) ? command.nextProjIdCounter : this.projIdCounter;
        this.objectSystem.setProjectiles(this.projectiles);
    }

    /**
     * @private
     * @param {object} command
     */
    #applyDespawnProjectilesCommand(command) {
        this.projIdCounter = Number.isInteger(command.nextProjIdCounter) ? command.nextProjIdCounter : this.projIdCounter;
        const projectileIds = new Set(
            Array.isArray(command.projectileIds)
                ? command.projectileIds.filter((projectileId) => Number.isInteger(projectileId))
                : []
        );
        if (projectileIds.size <= 0) {
            return;
        }

        this.projectiles = this.projectiles.filter((projectile) => !projectileIds.has(projectile?.id));
        this.objectSystem.setProjectiles(this.projectiles);
    }

    /**
     * @private
     */
    #applyDestroyWorldCommand() {
        clearGameScenePendingCommandState(this.pendingSimulationCommandState);
        this.objectSystem.setPlayers([]);
        this.objectSystem.setProjectiles([]);
        this.objectSystem.setItems([]);
        this.objectSystem.setWalls([]);
        this.objectSystem.clearEnemies();
        this.player = null;
        this.projectiles = [];
        this.staticWalls = [];
        this.boxWalls = [];
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
     * @param {string|undefined} aiId
     * @returns {object|null}
     */
    #resolveEnemyAI(aiId) {
        if (typeof aiId !== 'string' || aiId.length === 0) {
            return null;
        }
        return GAME_SCENE_AI_BY_ID[aiId] || null;
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
            systemHandler: this.#getSystemHandler(),
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
            systemHandler: this.#getSystemHandler(),
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
