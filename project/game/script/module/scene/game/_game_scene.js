import { ColorSchemes } from 'display/_theme_handler.js';
import { render, renderGL } from 'display/display_system.js';
import { getData } from 'data/data_handler.js';
import { colorUtil } from 'util/color_util.js';
import { BaseScene } from 'scene/_base_scene.js';
import { getObjectSystem } from 'object/object_system.js';
import {
    getHexaHiveType
} from 'object/enemy/_hexa_hive_layout.js';
import { enemyAI } from 'object/enemy/ai/_enemy_ai.js';
import { Player } from 'object/player/_player.js';
import { BaseProj } from 'object/proj/_base_proj.js';
import { BaseWall } from 'object/wall/_base_wall.js';
import { GAME_SCENE_COMMAND_TYPES } from 'simulation/game_scene_simulation_protocol.js';
import {
    GAME_SCENE_SHARED_PRESENTATION_STORAGE_TYPE,
    GAME_SCENE_SHARED_PRESENTATION_STRIDE,
    getGameSceneEnemyTypeByCode,
    readGameSceneSharedPresentationState
} from 'simulation/game_scene_shared_presentation.js';
import { enqueueSimulationCommand } from 'simulation/simulation_command_queue.js';
import { getSetting } from 'save/save_system.js';
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
const ENEMY_ASPECT_RATIO = getData('ENEMY_ASPECT_RATIO');
const ENEMY_DRAW_HEIGHT_RATIO = getData('ENEMY_DRAW_HEIGHT_RATIO');
const ENEMY_HEIGHT_SCALE = getData('ENEMY_HEIGHT_SCALE');
const getEnemyShapeKey = getData('getEnemyShapeKey');
const BUTTON_RADIUS = 10;
const SIMULATION_WORKER_SHADOW_SETTING_KEY = 'simulationWorkerShadowMode';
const SIMULATION_WORKER_PRESENTATION_SETTING_KEY = 'simulationWorkerPresentationMode';
const SIMULATION_WORKER_AUTHORITY_SETTING_KEY = 'simulationWorkerAuthorityMode';
const BENCHMARK_WALL_HEIGHT_RATIO = 0.5;
const BENCHMARK_WALL_THICKNESS_RATIO = 0.008;
const BENCHMARK_BOX_SIZE_RATIO = 0.05;
const BENCHMARK_PROJECTILE_SIZE_RATIO = 0.03;
const BENCHMARK_PROJECTILE_TRAVEL_SECONDS = 2;
const PROJECTILE_CULL_MARGIN_RATIO = 0.2;
const BENCHMARK_ENEMY_SPEED_MULTIPLIER = 2.5;
const HEXA_HIVE_TYPE = getHexaHiveType();
const HEXA_HIVE_BACKDROP_FALLBACK_FILL = 'rgb(255, 212, 184)';
const HEXA_SNAPSHOT_FRONT_SCALE = 1;
const HEXA_SNAPSHOT_BACKDROP_SCALE = 1.14;
const HEXA_HIVE_DEBUG_STROKE = 'rgba(64, 240, 255, 1)';
const HEXA_HIVE_DEBUG_LINE_WIDTH = 2.25;
const GAME_SCENE_AI_BY_ID = Object.freeze({
    enemyAI,
    tempAI: enemyAI
});
const COLLISION_STAT_FIELD_NAMES = Object.freeze([
    'collisionCheckCount',
    'aabbPassCount',
    'aabbRejectCount',
    'circlePassCount',
    'circleRejectCount',
    'polygonChecks',
    'enemyTotalMs',
    'enemyBodyBuildMs',
    'playerBodyBuildMs',
    'wallBodyBuildMs',
    'enemyPositionSolveMs',
    'enemyStabilizeMs',
    'enemyNonPositionMs',
    'solveGridMs',
    'solvePairScanMs',
    'projectileTotalMs',
    'projectileEnemyBodyBuildMs',
    'projectileGridBuildMs',
    'projectileScanMs',
    'projectileCandidateQueryMs',
    'projectileNarrowphaseMs',
    'contactTotalMs',
    'contactBodyBuildMs',
    'contactGridBuildMs',
    'contactPairScanMs'
]);

const clamp01 = (value) => Math.max(0, Math.min(1, value));

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

const normalizeSnapshotNumber = (value, fallback = 0) => (
    Number.isFinite(value) ? value : fallback
);

const cloneSnapshotPoint = (point) => ({
    x: normalizeSnapshotNumber(point?.x, 0),
    y: normalizeSnapshotNumber(point?.y, 0)
});

/**
 * 충돌 통계 기본값을 생성합니다.
 * @returns {object}
 */
function createDefaultCollisionStats() {
    const stats = {};
    for (let i = 0; i < COLLISION_STAT_FIELD_NAMES.length; i++) {
        stats[COLLISION_STAT_FIELD_NAMES[i]] = 0;
    }
    return stats;
}

/**
 * 충돌 통계를 렌더/워커 전송용 숫자 스냅샷으로 복제합니다.
 * @param {object|null|undefined} sourceStats
 * @returns {object}
 */
function createCollisionStatsSnapshot(sourceStats) {
    const stats = createDefaultCollisionStats();
    if (!sourceStats || typeof sourceStats !== 'object') {
        return stats;
    }

    for (let i = 0; i < COLLISION_STAT_FIELD_NAMES.length; i++) {
        const fieldName = COLLISION_STAT_FIELD_NAMES[i];
        stats[fieldName] = normalizeSnapshotNumber(sourceStats[fieldName], 0);
    }
    return stats;
}

/**
 * HUD에 표시할 ms 값을 고정 소수점 문자열로 변환합니다.
 * @param {number|null|undefined} value
 * @returns {string}
 */
function formatDebugMs(value) {
    return normalizeSnapshotNumber(value, 0).toFixed(2);
}

/**
 * 합체 적 조각 좌표를 회전합니다.
 * @param {number} x
 * @param {number} y
 * @param {number} radians
 * @returns {{x: number, y: number}}
 */
function rotateHiveSnapshotPoint(x, y, radians) {
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return {
        x: (x * cos) - (y * sin),
        y: (x * sin) + (y * cos)
    };
}

/**
 * 합체 적 내부 실루엣용 배경색을 계산합니다.
 * @param {string} sourceFill
 * @returns {string}
 */
function resolveHiveSnapshotBackdropFill(sourceFill) {
    if (typeof sourceFill === 'string' && sourceFill.length > 0) {
        return colorUtil().lerpColor(sourceFill, HEXA_HIVE_BACKDROP_FALLBACK_FILL, 0.72);
    }

    return HEXA_HIVE_BACKDROP_FALLBACK_FILL;
}

/**
 * 벤치마크 씬 적 색상을 불투명 문자열로 정규화합니다.
 * @param {string} fill
 * @returns {string}
 */
function normalizeOpaqueBenchmarkEnemyFill(fill) {
    if (typeof fill !== 'string' || fill.length === 0) {
        return '#ff6c6c';
    }

    const parsed = colorUtil().cssToRgb(fill);
    return colorUtil().rgbToString(parsed.r, parsed.g, parsed.b, 1);
}

/**
 * 육각형 셀 하나를 간단한 외곽 포함 형태로 렌더합니다.
 * @param {{x: number, y: number, size: number, fill: string, alpha?: number, rotation?: number}} options
 */
function drawHexaSnapshotCell(options) {
    const alpha = Number.isFinite(options?.alpha) ? options.alpha : 1;
    const rotation = normalizeSnapshotNumber(options?.rotation, 0);
    const size = normalizeSnapshotNumber(options?.size, 0);
    const fill = normalizeOpaqueBenchmarkEnemyFill(
        typeof options?.fill === 'string' ? options.fill : '#ff6c6c'
    );
    const backdropFill = resolveHiveSnapshotBackdropFill(fill);
    const x = normalizeSnapshotNumber(options?.x, 0);
    const y = normalizeSnapshotNumber(options?.y, 0);

    renderGL('object', {
        shape: 'hexagon',
        x,
        y,
        w: size * HEXA_SNAPSHOT_BACKDROP_SCALE,
        h: size * HEXA_SNAPSHOT_BACKDROP_SCALE,
        fill: backdropFill,
        alpha,
        rotation
    });
    renderGL('object', {
        shape: 'hexagon',
        x,
        y,
        w: size * HEXA_SNAPSHOT_FRONT_SCALE,
        h: size * HEXA_SNAPSHOT_FRONT_SCALE,
        fill,
        alpha,
        rotation
    });
}

/**
 * 디버그 모드일 때 hexa_hive의 실제 충돌 part 외곽을 그립니다.
 * @param {number[][]|null|undefined} collisionLocalParts
 * @param {number} localBaseHeight
 * @param {number} rotationRadians
 * @param {number} renderX
 * @param {number} renderY
 */
function drawHexaHiveSnapshotCollisionDebugParts(collisionLocalParts, localBaseHeight, rotationRadians, renderX, renderY) {
    if (getSetting('debugMode') !== true || !Array.isArray(collisionLocalParts)) {
        return;
    }

    for (let partIndex = 0; partIndex < collisionLocalParts.length; partIndex++) {
        const part = collisionLocalParts[partIndex];
        if (!Array.isArray(part) || part.length < 6) {
            continue;
        }

        for (let i = 0; i < part.length; i += 2) {
            const nextIndex = (i + 2) % part.length;
            const start = rotateHiveSnapshotPoint(
                (Number.isFinite(part[i]) ? part[i] : 0) * localBaseHeight,
                (Number.isFinite(part[i + 1]) ? part[i + 1] : 0) * localBaseHeight,
                rotationRadians
            );
            const end = rotateHiveSnapshotPoint(
                (Number.isFinite(part[nextIndex]) ? part[nextIndex] : 0) * localBaseHeight,
                (Number.isFinite(part[nextIndex + 1]) ? part[nextIndex + 1] : 0) * localBaseHeight,
                rotationRadians
            );

            render('top', {
                shape: 'line',
                x1: renderX + start.x,
                y1: renderY + start.y,
                x2: renderX + end.x,
                y2: renderY + end.y,
                stroke: HEXA_HIVE_DEBUG_STROKE,
                lineWidth: HEXA_HIVE_DEBUG_LINE_WIDTH,
                alpha: 1
            });
        }
    }
}

/**
 * 합체 적 스냅샷을 다조각 형태로 렌더합니다.
 * @param {object|null|undefined} enemy
 * @param {number} offsetY
 * @param {number} baseHeight
 * @param {string} fallbackFill
 * @returns {boolean}
 */
function drawHexaHiveSnapshot(enemy, offsetY, baseHeight, fallbackFill) {
    const layout = enemy?.hexaHiveLayout;
    if (!layout || !Array.isArray(layout.visibleLocalCenters) || layout.visibleLocalCenters.length === 0) {
        return false;
    }

    const renderPosition = enemy.renderPosition ?? enemy.position;
    const renderX = normalizeSnapshotNumber(renderPosition?.x, 0);
    const renderY = normalizeSnapshotNumber(renderPosition?.y, 0) - offsetY;
    const size = normalizeSnapshotNumber(enemy.size, 1);
    const localBaseHeight = baseHeight * size;
    const rotation = normalizeSnapshotNumber(enemy.rotation, 0);
    const rotationRadians = rotation * (Math.PI / 180);
    const fill = typeof enemy.fill === 'string' ? enemy.fill : fallbackFill;
    const collisionLocalParts = Array.isArray(enemy?.collisionLocalParts)
        ? enemy.collisionLocalParts
        : enemy?.hexaHiveLayout?.collisionLocalParts;

    for (let i = 0; i < layout.visibleLocalCenters.length; i++) {
        const localCenter = layout.visibleLocalCenters[i];
        const rotated = rotateHiveSnapshotPoint(
            normalizeSnapshotNumber(localCenter?.x, 0) * localBaseHeight,
            normalizeSnapshotNumber(localCenter?.y, 0) * localBaseHeight,
            rotationRadians
        );
        drawHexaSnapshotCell({
            x: renderX + rotated.x,
            y: renderY + rotated.y,
            size: localBaseHeight,
            fill,
            alpha: 1,
            rotation
        });
    }

    drawHexaHiveSnapshotCollisionDebugParts(
        collisionLocalParts,
        localBaseHeight,
        rotationRadians,
        renderX,
        renderY
    );

    return true;
}

/**
 * 공유 프레젠테이션 적 타입 코드별 렌더 설정을 생성합니다.
 * @returns {{shapeByCode: string[], aspectByCode: number[], heightScaleByCode: number[]}}
 */
function createSharedEnemyRenderConfig() {
    const shapeByCode = [];
    const aspectByCode = [];
    const heightScaleByCode = [];
    const maxEnemyTypeCode = 7;

    for (let code = 0; code <= maxEnemyTypeCode; code++) {
        const enemyType = getGameSceneEnemyTypeByCode(code);
        const renderEnemyType = enemyType === 'hexa_hive' ? 'hexa' : enemyType;
        shapeByCode[code] = getEnemyShapeKey(renderEnemyType) || getEnemyShapeKey('square');
        aspectByCode[code] = ENEMY_ASPECT_RATIO[renderEnemyType] ?? 1;
        heightScaleByCode[code] = ENEMY_HEIGHT_SCALE[renderEnemyType] ?? 1;
    }

    return {
        shapeByCode,
        aspectByCode,
        heightScaleByCode
    };
}

const SHARED_ENEMY_RENDER_CONFIG = createSharedEnemyRenderConfig();

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
        this.pendingSimulationCommandState = {
            projectileDespawnIds: []
        };
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

        return saveSystem.getSetting(SIMULATION_WORKER_SHADOW_SETTING_KEY) === true
            && saveSystem.getSetting(SIMULATION_WORKER_PRESENTATION_SETTING_KEY) === true
            && saveSystem.getSetting(SIMULATION_WORKER_AUTHORITY_SETTING_KEY) === true;
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
     * @returns {string[]}
     */
    #getSimulationWorkerHudLines() {
        const systemHandler = this.#getSystemHandler();
        const bridgeStatus = systemHandler?.getSimulationWorkerStatus?.() ?? null;
        const runtimeStatus = systemHandler?.getSimulationWorkerRuntimeStatus?.() ?? null;
        const requested = runtimeStatus?.shadowEnabled === true
            && runtimeStatus?.presentationEnabled === true
            && runtimeStatus?.authorityRequested === true;

        if (!requested) {
            return ['worker: off'];
        }
        if (bridgeStatus?.supported === false) {
            return ['worker: unsupported'];
        }

        const lines = [];
        if (runtimeStatus?.authorityActive === true) {
            lines.push('worker: authority active');
        } else if (bridgeStatus?.lastError) {
            lines.push('worker: error');
        } else if (runtimeStatus?.presentationActive === true) {
            lines.push('worker: presentation only');
        } else if (bridgeStatus?.ready === true) {
            lines.push('worker: ready');
        } else if (bridgeStatus?.running === true) {
            lines.push('worker: booting');
        } else {
            lines.push('worker: not running');
        }

        if (typeof bridgeStatus?.lastError === 'string' && bridgeStatus.lastError.length > 0) {
            const maxErrorLength = 54;
            const errorText = bridgeStatus.lastError.length > maxErrorLength
                ? `${bridgeStatus.lastError.slice(0, maxErrorLength - 3)}...`
                : bridgeStatus.lastError;
            lines.push(`worker err: ${errorText}`);
        }

        if (bridgeStatus) {
            lines.push(`worker ack: ${bridgeStatus.lastAckFrameId}/${bridgeStatus.lastFrameId}`);
        }
        this.#appendSimulationWorkerProfileHudLines(lines, bridgeStatus);
        this.#appendSimulationWorkerAIHudLines(lines, bridgeStatus);
        this.#appendSimulationWorkerEnemyAIWorkerHudLines(lines, bridgeStatus);

        return lines;
    }

    /**
     * @private
     * @param {string[]} lines
     * @param {object|null|undefined} bridgeStatus
     */
    #appendSimulationWorkerProfileHudLines(lines, bridgeStatus) {
        if (!Array.isArray(lines)) {
            return;
        }

        const profileStats = bridgeStatus?.workerSnapshot?.profileStats;
        if (profileStats?.enabled === true) {
            const publishMs = Number.isFinite(profileStats.publishTotalMs)
                ? profileStats.publishTotalMs
                : profileStats.sharedPublishCallMs;
            lines.push(`worker frame ms: total ${formatDebugMs(profileStats.totalMs)} | scene ${formatDebugMs(profileStats.sceneWrapperMs)} | publish ${formatDebugMs(publishMs)}`);
            lines.push(`worker publish ms: wall ${formatDebugMs(profileStats.publishWallsMs)} | proj ${formatDebugMs(profileStats.publishProjectilesMs)} | enemy ${formatDebugMs(profileStats.publishEnemiesMs)}`);
        }

        const collisionStats = bridgeStatus?.workerSnapshot?.collisionStats;
        if (!collisionStats || typeof collisionStats !== 'object') {
            return;
        }

        const collisionTotalMs = normalizeSnapshotNumber(collisionStats.enemyTotalMs, 0)
            + normalizeSnapshotNumber(collisionStats.projectileTotalMs, 0)
            + normalizeSnapshotNumber(collisionStats.contactTotalMs, 0);
        if (collisionTotalMs <= 0) {
            return;
        }

        lines.push(`collision ms: enemy ${formatDebugMs(collisionStats.enemyTotalMs)} | proj ${formatDebugMs(collisionStats.projectileTotalMs)} | contact ${formatDebugMs(collisionStats.contactTotalMs)}`);
        lines.push(`collision detail ms: grid ${formatDebugMs(collisionStats.solveGridMs)} | pair ${formatDebugMs(collisionStats.solvePairScanMs)} | narrow ${formatDebugMs(collisionStats.projectileNarrowphaseMs)}`);
    }

    /**
     * @private
     * @param {string[]} lines
     * @param {object|null|undefined} bridgeStatus
     */
    #appendSimulationWorkerAIHudLines(lines, bridgeStatus) {
        const aiStats = bridgeStatus?.workerSnapshot?.aiStats;
        if (!Array.isArray(lines) || aiStats?.enabled !== true) {
            return;
        }

        const totalMs = Number.isFinite(aiStats.totalMs) ? aiStats.totalMs : 0;
        const enemyUpdateCount = Number.isFinite(aiStats.enemyUpdateCount) ? aiStats.enemyUpdateCount : 0;
        const heavyDecisionCount = Number.isFinite(aiStats.heavyDecisionCount) ? aiStats.heavyDecisionCount : 0;
        const localDirectReuseCount = Number.isFinite(aiStats.localDirectPathReuseCount)
            ? aiStats.localDirectPathReuseCount
            : 0;
        const sharedDirectPathCacheHitCount = Number.isFinite(aiStats.sharedDirectPathCacheHitCount)
            ? aiStats.sharedDirectPathCacheHitCount
            : 0;
        const sharedFlowFieldCacheHitCount = Number.isFinite(aiStats.sharedFlowFieldCacheHitCount)
            ? aiStats.sharedFlowFieldCacheHitCount
            : 0;
        const sharedDensityFieldCacheHitCount = Number.isFinite(aiStats.sharedDensityFieldCacheHitCount)
            ? aiStats.sharedDensityFieldCacheHitCount
            : 0;
        const sharedPolicyTargetCacheHitCount = Number.isFinite(aiStats.sharedPolicyTargetCacheHitCount)
            ? aiStats.sharedPolicyTargetCacheHitCount
            : 0;
        const densityFieldBuildCount = Number.isFinite(aiStats.densityFieldBuildCount)
            ? aiStats.densityFieldBuildCount
            : 0;
        const flowRefreshCount = Number.isFinite(aiStats.flowRefreshCount) ? aiStats.flowRefreshCount : 0;

        lines.push(`ai total: ${totalMs.toFixed(2)}ms | upd: ${enemyUpdateCount} | heavy: ${heavyDecisionCount}`);
        lines.push(`ai direct reuse/hit: ${localDirectReuseCount}/${sharedDirectPathCacheHitCount} | flow hit: ${sharedFlowFieldCacheHitCount}`);
        lines.push(`ai density hit/build: ${sharedDensityFieldCacheHitCount + sharedPolicyTargetCacheHitCount}/${densityFieldBuildCount} | flow refresh: ${flowRefreshCount}`);
    }

    /**
     * @private
     * @param {string[]} lines
     * @param {object|null|undefined} bridgeStatus
     */
    #appendSimulationWorkerEnemyAIWorkerHudLines(lines, bridgeStatus) {
        const enemyAIWorker = bridgeStatus?.workerSnapshot?.enemyAIWorker;
        if (!Array.isArray(lines) || !enemyAIWorker || typeof enemyAIWorker !== 'object') {
            return;
        }

        const transportMode = typeof enemyAIWorker.transportMode === 'string'
            ? enemyAIWorker.transportMode
            : 'message';
        const readiness = enemyAIWorker.ready === true
            ? 'ready'
            : (enemyAIWorker.running === true ? 'booting' : 'off');
        const requestCount = Number.isFinite(enemyAIWorker.requestCount) ? enemyAIWorker.requestCount : 0;
        const responseCount = Number.isFinite(enemyAIWorker.responseCount) ? enemyAIWorker.responseCount : 0;
        const staleDropCount = Number.isFinite(enemyAIWorker.staleDropCount) ? enemyAIWorker.staleDropCount : 0;
        const fallbackCount = Number.isFinite(enemyAIWorker.fallbackCount) ? enemyAIWorker.fallbackCount : 0;
        const lastLatencyMs = Number.isFinite(enemyAIWorker.lastLatencyMs) ? enemyAIWorker.lastLatencyMs : 0;
        const lastEnemyCount = Number.isFinite(enemyAIWorker.lastEnemyCount) ? enemyAIWorker.lastEnemyCount : 0;
        const latestRequestedWallsVersion = Number.isFinite(enemyAIWorker.latestRequestedWallsVersion)
            ? enemyAIWorker.latestRequestedWallsVersion
            : -1;
        const latestRequestedEnemyTopologyVersion = Number.isFinite(enemyAIWorker.latestRequestedEnemyTopologyVersion)
            ? enemyAIWorker.latestRequestedEnemyTopologyVersion
            : -1;
        const lastWallsVersion = Number.isFinite(enemyAIWorker.lastWallsVersion)
            ? enemyAIWorker.lastWallsVersion
            : -1;
        const lastEnemyTopologyVersion = Number.isFinite(enemyAIWorker.lastEnemyTopologyVersion)
            ? enemyAIWorker.lastEnemyTopologyVersion
            : -1;
        const lastSharedResultVersion = Number.isFinite(enemyAIWorker.lastSharedResultVersion)
            ? enemyAIWorker.lastSharedResultVersion
            : 0;

        lines.push(`enemyAI: ${readiness} | tx: ${transportMode} | req/resp: ${requestCount}/${responseCount}`);
        lines.push(`enemyAI stale/fb: ${staleDropCount}/${fallbackCount} | lat: ${lastLatencyMs.toFixed(2)}ms | batch: ${lastEnemyCount}`);
        lines.push(`enemyAI wall/topo req: ${latestRequestedWallsVersion}/${latestRequestedEnemyTopologyVersion} | done: ${lastWallsVersion}/${lastEnemyTopologyVersion} | ver: ${lastSharedResultVersion}`);
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
            [SIMULATION_WORKER_SHADOW_SETTING_KEY]: nextEnabled,
            [SIMULATION_WORKER_PRESENTATION_SETTING_KEY]: nextEnabled,
            [SIMULATION_WORKER_AUTHORITY_SETTING_KEY]: nextEnabled
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
        const fill = ColorSchemes?.Title?.Enemy || '#ff6c6c';
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
        const enemySystemSnapshot = {
            aiDecisionGroupCursor: Number.isInteger(objectSystemSnapshot?.aiDecisionGroupCursor)
                ? objectSystemSnapshot.aiDecisionGroupCursor
                : 0,
            aiDecisionGroupCount: Number.isInteger(objectSystemSnapshot?.aiDecisionGroupCount)
                ? objectSystemSnapshot.aiDecisionGroupCount
                : 60,
            aiDecisionIntervalSeconds: Number.isFinite(objectSystemSnapshot?.aiDecisionIntervalSeconds)
                ? objectSystemSnapshot.aiDecisionIntervalSeconds
                : 1,
            enemyCullOutsideRatio: Number.isFinite(objectSystemSnapshot?.enemyCullOutsideRatio)
                ? objectSystemSnapshot.enemyCullOutsideRatio
                : 0.1
        };

        return {
            sceneType: 'game',
            viewport: {
                ww: this.WW,
                wh: this.WH,
                objectWH: this.objectWH,
                objectOffsetY: this.objectOffsetY
            },
            counters: {
                enemyIdCounter: Number.isInteger(objectSystemSnapshot?.enemyIdCounter) ? objectSystemSnapshot.enemyIdCounter : 0,
                wallIdCounter: this.wallIdCounter,
                projIdCounter: this.projIdCounter
            },
            enemySystem: enemySystemSnapshot,
            player: this.#createPlayerSnapshot(this.player),
            staticWalls: this.staticWalls.map((wall) => this.#createWallSnapshot(wall)).filter(Boolean),
            boxWalls: this.boxWalls.map((wall) => this.#createWallSnapshot(wall)).filter(Boolean),
            projectiles: this.projectiles.map((projectile) => this.#createProjectileSnapshot(projectile)).filter(Boolean),
            enemies: Array.isArray(objectSystemSnapshot?.enemies) ? objectSystemSnapshot.enemies : [],
            collisionStats: this.#createCollisionStatsSnapshot(),
            buttons: this.buttons.map((button) => this.#createButtonSnapshot(button)).filter(Boolean)
        };
    }

    /**
     * @override
     * @returns {object}
     */
    createSimulationFrameSnapshot() {
        const objectSystemFrameSnapshot = this.objectSystem && typeof this.objectSystem.createSimulationFrameSnapshot === 'function'
            ? this.objectSystem.createSimulationFrameSnapshot()
            : null;

        return {
            sceneType: 'game',
            viewport: {
                ww: this.WW,
                wh: this.WH,
                objectWH: this.objectWH,
                objectOffsetY: this.objectOffsetY
            },
            counters: {
                enemyIdCounter: Number.isInteger(objectSystemFrameSnapshot?.enemyIdCounter) ? objectSystemFrameSnapshot.enemyIdCounter : 0,
                wallIdCounter: this.wallIdCounter,
                projIdCounter: this.projIdCounter
            },
            player: this.#createPlayerSnapshot(this.player),
            enemyStates: Array.isArray(objectSystemFrameSnapshot?.enemies) ? objectSystemFrameSnapshot.enemies : [],
            collisionStats: this.#createCollisionStatsSnapshot()
        };
    }

    /**
     * @override
     * @returns {object[]}
     */
    consumeSimulationCommands() {
        const commands = [];
        const uniqueProjectileIds = [...new Set(this.pendingSimulationCommandState.projectileDespawnIds)];
        if (uniqueProjectileIds.length > 0) {
            commands.push({
                type: GAME_SCENE_COMMAND_TYPES.DESPAWN_PROJECTILE_BATCH,
                projectileIds: uniqueProjectileIds,
                nextProjIdCounter: this.projIdCounter
            });
        }

        this.pendingSimulationCommandState.projectileDespawnIds.length = 0;
        return commands;
    }

    /**
     * @override
     * @param {object[]} [commands=[]]
     */
    applySimulationCommands(commands = []) {
        if (!Array.isArray(commands) || commands.length === 0 || !this.objectSystem) {
            return;
        }

        for (let i = 0; i < commands.length; i++) {
            const command = commands[i];
            if (!command || typeof command.type !== 'string') {
                continue;
            }

            switch (command.type) {
                case GAME_SCENE_COMMAND_TYPES.REPLACE_WORLD:
                    this.#applyReplaceWorldCommand(command);
                    break;
                case GAME_SCENE_COMMAND_TYPES.SPAWN_ENEMY_BATCH:
                    this.#applySpawnEnemyBatchCommand(command);
                    break;
                case GAME_SCENE_COMMAND_TYPES.APPEND_BOX_WALLS:
                    this.#applyAppendBoxWallsCommand(command);
                    break;
                case GAME_SCENE_COMMAND_TYPES.APPEND_PROJECTILES:
                    this.#applyAppendProjectilesCommand(command);
                    break;
                case GAME_SCENE_COMMAND_TYPES.DESPAWN_PROJECTILE_BATCH:
                    this.#applyDespawnProjectilesCommand(command);
                    break;
                case GAME_SCENE_COMMAND_TYPES.DESTROY_WORLD:
                    this.#applyDestroyWorldCommand();
                    break;
            }
        }
    }

    /**
     * @private
     * @param {object} command
     */
    #applyReplaceWorldCommand(command) {
        this.objectSystem.showcaseEnabled = false;
        this.objectSystem.clearEnemies();
        this.pendingSimulationCommandState.projectileDespawnIds.length = 0;

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
        this.pendingSimulationCommandState.projectileDespawnIds.length = 0;
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
     * @param {Player|null|undefined} player
     * @returns {object|null}
     */
    #createPlayerSnapshot(player) {
        if (!player) {
            return null;
        }

        const prevPosition = player.prevPosition ?? player.position;
        return {
            id: player.id ?? null,
            active: player.active !== false,
            radius: normalizeSnapshotNumber(player.radius, 0),
            weight: normalizeSnapshotNumber(player.weight, 0),
            position: cloneSnapshotPoint(player.position),
            prevPosition: cloneSnapshotPoint(prevPosition),
            speed: cloneSnapshotPoint(player.speed)
        };
    }

    /**
     * @private
     * @param {BaseWall|null|undefined} wall
     * @returns {object|null}
     */
    #createWallSnapshot(wall) {
        if (!wall) {
            return null;
        }

        return {
            id: wall.id ?? null,
            active: wall.active !== false,
            x: normalizeSnapshotNumber(wall.x, 0),
            y: normalizeSnapshotNumber(wall.y, 0),
            w: normalizeSnapshotNumber(wall.w, 0),
            h: normalizeSnapshotNumber(wall.h, 0),
            origin: typeof wall.origin === 'string' ? wall.origin : 'center'
        };
    }

    /**
     * @private
     * @param {BaseProj|null|undefined} projectile
     * @returns {object|null}
     */
    #createProjectileSnapshot(projectile) {
        if (!projectile) {
            return null;
        }

        return {
            id: projectile.id ?? null,
            active: projectile.active !== false,
            radius: normalizeSnapshotNumber(projectile.radius, 0),
            weight: normalizeSnapshotNumber(projectile.weight, 0),
            impactForce: normalizeSnapshotNumber(projectile.impactForce, 0),
            piercing: projectile.piercing === true,
            position: cloneSnapshotPoint(projectile.position),
            prevPosition: cloneSnapshotPoint(projectile.prevPosition),
            speed: cloneSnapshotPoint(projectile.speed)
        };
    }

    /**
     * @private
     * @param {number|null|undefined} projectileId
     */
    #queueProjectileDespawn(projectileId) {
        if (!Number.isInteger(projectileId)) {
            return;
        }

        this.pendingSimulationCommandState.projectileDespawnIds.push(projectileId);
    }

    /**
     * @private
     * @returns {object}
     */
    #createCollisionStatsSnapshot() {
        return createCollisionStatsSnapshot(this.collisionStats);
    }

    /**
     * @private
     * @param {object|null|undefined} button
     * @returns {object|null}
     */
    #createButtonSnapshot(button) {
        if (!button) {
            return null;
        }

        return {
            id: typeof button.id === 'string' ? button.id : '',
            label: typeof button.label === 'string' ? button.label : '',
            x: normalizeSnapshotNumber(button.x, 0),
            y: normalizeSnapshotNumber(button.y, 0),
            w: normalizeSnapshotNumber(button.w, 0),
            h: normalizeSnapshotNumber(button.h, 0)
        };
    }

    /**
     * @private
     */
    #drawWorldObjects(sceneSnapshot = null) {
        const staticWalls = Array.isArray(sceneSnapshot?.staticWalls) ? sceneSnapshot.staticWalls : this.staticWalls;
        const boxWalls = Array.isArray(sceneSnapshot?.boxWalls) ? sceneSnapshot.boxWalls : this.boxWalls;
        const player = sceneSnapshot && Object.prototype.hasOwnProperty.call(sceneSnapshot, 'player')
            ? sceneSnapshot.player
            : this.player;
        const projectiles = Array.isArray(sceneSnapshot?.projectiles) ? sceneSnapshot.projectiles : this.projectiles;
        const offsetY = this.objectOffsetY;

        measurePerformanceSection('scene.game.world.staticWalls', () => {
            for (let i = 0; i < staticWalls.length; i++) {
                const wall = staticWalls[i];
                if (!wall || wall.active === false) continue;
                renderGL('object', {
                    shape: 'rect',
                    x: normalizeSnapshotNumber(wall.x, 0),
                    y: normalizeSnapshotNumber(wall.y, 0) - offsetY,
                    w: normalizeSnapshotNumber(wall.w, 0),
                    h: normalizeSnapshotNumber(wall.h, 0),
                    fill: 'rgba(120, 136, 156, 0.9)'
                });
            }
        });

        measurePerformanceSection('scene.game.world.boxWalls', () => {
            for (let i = 0; i < boxWalls.length; i++) {
                const box = boxWalls[i];
                if (!box || box.active === false) continue;
                renderGL('object', {
                    shape: 'rect',
                    x: normalizeSnapshotNumber(box.x, 0),
                    y: normalizeSnapshotNumber(box.y, 0) - offsetY,
                    w: normalizeSnapshotNumber(box.w, 0),
                    h: normalizeSnapshotNumber(box.h, 0),
                    fill: 'rgba(182, 201, 214, 0.9)'
                });
            }
        });

        measurePerformanceSection('scene.game.world.player', () => {
            if (player && player.active !== false) {
                const diameter = normalizeSnapshotNumber(player.radius, 0) * 2;
                renderGL('object', {
                    shape: 'circle',
                    x: normalizeSnapshotNumber(player.position?.x, 0),
                    y: normalizeSnapshotNumber(player.position?.y, 0) - offsetY,
                    w: diameter,
                    h: diameter,
                    fill: '#4fa3ff',
                    alpha: 0.95
                });
            }
        });

        measurePerformanceSection('scene.game.world.projectiles', () => {
            for (let i = 0; i < projectiles.length; i++) {
                const projectile = projectiles[i];
                if (!projectile || projectile.active === false) continue;
                const d = normalizeSnapshotNumber(projectile.radius, 0) * 2;
                renderGL('object', {
                    shape: 'circle',
                    x: normalizeSnapshotNumber(projectile.position?.x, 0),
                    y: normalizeSnapshotNumber(projectile.position?.y, 0) - offsetY,
                    w: d,
                    h: d,
                    fill: '#ffc857',
                    alpha: 0.95
                });
            }
        });
    }

    /**
     * @private
     * @param {object|null|undefined} sharedState
     */
    #drawSharedWorldObjects(sharedState) {
        if (!sharedState) {
            return;
        }

        const offsetY = this.objectOffsetY;
        const wallStride = GAME_SCENE_SHARED_PRESENTATION_STRIDE.WALL;
        const projectileStride = GAME_SCENE_SHARED_PRESENTATION_STRIDE.PROJECTILE;
        const projectileStaticStride = GAME_SCENE_SHARED_PRESENTATION_STRIDE.PROJECTILE_STATIC;
        const staticWallData = sharedState.staticWallData;
        const boxWallData = sharedState.boxWallData;
        const playerData = sharedState.playerData;
        const projectileData = sharedState.projectileData;
        const projectileStaticData = sharedState.projectileStaticData;
        const staticWallBase = sharedState.staticWallBase;
        const boxWallBase = sharedState.boxWallBase;
        const playerBase = sharedState.playerBase;
        const projectileBase = sharedState.projectileBase;
        const projectileStaticBase = sharedState.projectileStaticBase;

        measurePerformanceSection('scene.game.sharedWorld.staticWalls', () => {
            for (let i = 0; i < sharedState.staticWallCount; i++) {
                const offset = staticWallBase + (i * wallStride);
                renderGL('object', {
                    shape: 'rect',
                    x: staticWallData[offset + 0],
                    y: staticWallData[offset + 1] - offsetY,
                    w: staticWallData[offset + 2],
                    h: staticWallData[offset + 3],
                    fill: 'rgba(120, 136, 156, 0.9)'
                });
            }
        });

        measurePerformanceSection('scene.game.sharedWorld.boxWalls', () => {
            for (let i = 0; i < sharedState.boxWallCount; i++) {
                const offset = boxWallBase + (i * wallStride);
                renderGL('object', {
                    shape: 'rect',
                    x: boxWallData[offset + 0],
                    y: boxWallData[offset + 1] - offsetY,
                    w: boxWallData[offset + 2],
                    h: boxWallData[offset + 3],
                    fill: 'rgba(182, 201, 214, 0.9)'
                });
            }
        });

        measurePerformanceSection('scene.game.sharedWorld.player', () => {
            if (sharedState.playerActive === true) {
                const px = playerData[playerBase + 0];
                const py = playerData[playerBase + 1];
                const pr = playerData[playerBase + 2];
                const diameter = pr * 2;
                renderGL('object', {
                    shape: 'circle',
                    x: px,
                    y: py - offsetY,
                    w: diameter,
                    h: diameter,
                    fill: '#4fa3ff',
                    alpha: 0.95
                });
            }
        });

        measurePerformanceSection('scene.game.sharedWorld.projectiles', () => {
            for (let i = 0; i < sharedState.projectileCount; i++) {
                const offset = projectileBase + (i * projectileStride);
                const staticOffset = projectileStaticBase + (i * projectileStaticStride);
                const radius = projectileStaticData[staticOffset + 0];
                const diameter = radius * 2;
                renderGL('object', {
                    shape: 'circle',
                    x: projectileData[offset + 0],
                    y: projectileData[offset + 1] - offsetY,
                    w: diameter,
                    h: diameter,
                    fill: '#ffc857',
                    alpha: 0.95
                });
            }
        });
    }

    /**
     * @private
     */
    #drawEnemySnapshots(enemies = []) {
        const offsetY = this.objectOffsetY;
        const fallbackFill = normalizeOpaqueBenchmarkEnemyFill(ColorSchemes?.Title?.Enemy || '#ff6c6c');
        const baseHeight = this.objectWH * ENEMY_DRAW_HEIGHT_RATIO;

        measurePerformanceSection('scene.game.snapshot.enemies', () => {
            for (let i = 0; i < enemies.length; i++) {
                const enemy = enemies[i];
                if (!enemy || enemy.active === false) continue;

                const enemyType = typeof enemy.type === 'string' ? enemy.type : 'square';
                if (enemyType === HEXA_HIVE_TYPE && drawHexaHiveSnapshot(enemy, offsetY, baseHeight, fallbackFill)) {
                    continue;
                }
                const shapeKey = getEnemyShapeKey(enemyType) || getEnemyShapeKey('square');
                const renderPosition = enemy.renderPosition ?? enemy.position;
                const size = normalizeSnapshotNumber(enemy.size, 1);
                const baseH = baseHeight * size;
                const w = baseH * (ENEMY_ASPECT_RATIO[enemyType] ?? 1);
                const h = baseH * (ENEMY_HEIGHT_SCALE[enemyType] ?? 1);
                renderGL('object', {
                    shape: shapeKey,
                    x: normalizeSnapshotNumber(renderPosition?.x, 0),
                    y: normalizeSnapshotNumber(renderPosition?.y, 0) - offsetY,
                    w,
                    h,
                    fill: normalizeOpaqueBenchmarkEnemyFill(typeof enemy.fill === 'string' ? enemy.fill : fallbackFill),
                    alpha: 1,
                    rotation: normalizeSnapshotNumber(enemy.rotation, 0)
                });
            }
        });
    }

    /**
     * @private
     * @param {object|null|undefined} sharedState
     */
    #drawSharedEnemySnapshots(sharedState) {
        if (!sharedState) {
            return;
        }

        const offsetY = this.objectOffsetY;
        const fallbackFill = normalizeOpaqueBenchmarkEnemyFill(ColorSchemes?.Title?.Enemy || '#ff6c6c');
        const baseHeight = this.objectWH * ENEMY_DRAW_HEIGHT_RATIO;
        const enemyStride = GAME_SCENE_SHARED_PRESENTATION_STRIDE.ENEMY;
        const enemyStaticStride = GAME_SCENE_SHARED_PRESENTATION_STRIDE.ENEMY_STATIC;
        const enemyData = sharedState.enemyData;
        const enemyStaticData = sharedState.enemyStaticData;
        const enemyBase = sharedState.enemyBase;
        const enemyStaticBase = sharedState.enemyStaticBase;
        const shapeByCode = SHARED_ENEMY_RENDER_CONFIG.shapeByCode;
        const aspectByCode = SHARED_ENEMY_RENDER_CONFIG.aspectByCode;
        const heightScaleByCode = SHARED_ENEMY_RENDER_CONFIG.heightScaleByCode;

        measurePerformanceSection('scene.game.shared.enemies', () => {
            for (let i = 0; i < sharedState.enemyCount; i++) {
                const offset = enemyBase + (i * enemyStride);
                const staticOffset = enemyStaticBase + (i * enemyStaticStride);
                const enemyTypeCode = Math.round(enemyStaticData[staticOffset + 1]);
                const shapeKey = shapeByCode[enemyTypeCode] || shapeByCode[0];
                const size = normalizeSnapshotNumber(enemyStaticData[staticOffset + 0], 1);
                const baseH = baseHeight * size;
                const w = baseH * (aspectByCode[enemyTypeCode] ?? 1);
                const h = baseH * (heightScaleByCode[enemyTypeCode] ?? 1);
                renderGL('object', {
                    shape: shapeKey,
                    x: enemyData[offset + 0],
                    y: enemyData[offset + 1] - offsetY,
                    w,
                    h,
                    fill: fallbackFill,
                    alpha: 1,
                    rotation: normalizeSnapshotNumber(enemyData[offset + 2], 0)
                });
            }
        });
    }

    /**
     * @private
     * @param {object[]|null} [buttons=null]
     */
    #drawButtons(buttons = null) {
        const buttonList = Array.isArray(buttons) ? buttons : this.buttons;
        const mousePos = getSimulationMouseInput('pos');
        const fontSize = Math.max(11, this.WW * 0.0092);

        for (let i = 0; i < buttonList.length; i++) {
            const button = buttonList[i];
            if (!button) continue;
            const hovering = mousePos ? pointInRect(mousePos.x, mousePos.y, button) : false;
            const hoverBlend = clamp01(hovering ? 1 : 0);
            const fillAlpha = 0.74 + (hoverBlend * 0.12);

            render('ui', {
                shape: 'roundRect',
                x: button.x,
                y: button.y,
                w: button.w,
                h: button.h,
                radius: BUTTON_RADIUS,
                fill: `rgba(26, 32, 40, ${fillAlpha})`
            });
            render('ui', {
                shape: 'roundRect',
                x: button.x,
                y: button.y,
                w: button.w,
                h: button.h,
                radius: BUTTON_RADIUS,
                fill: false,
                stroke: 'rgba(255, 255, 255, 0.55)',
                lineWidth: 1
            });
            render('ui', {
                shape: 'text',
                text: button.label,
                x: button.x + (button.w * 0.5),
                y: button.y + (button.h * 0.54),
                font: `500 ${fontSize}px "Pretendard Variable"`,
                fill: '#f5f8ff',
                align: 'center',
                baseline: 'middle'
            });
        }
    }

    /**
     * @private
     */
    #drawHud(sceneSnapshot = null) {
        const titleFont = Math.max(14, this.WW * 0.0105);
        const collisionStats = sceneSnapshot?.collisionStats ?? this.collisionStats;
        const enemyCount = Array.isArray(sceneSnapshot?.enemies)
            ? sceneSnapshot.enemies.length
            : (this.objectSystem && typeof this.objectSystem.getEnemies === 'function'
                ? this.objectSystem.getEnemies().length
                : 0);
        render('ui', {
            shape: 'text',
            text: 'Benchmark Scene',
            x: this.WW * 0.03,
            y: this.WH * 0.04,
            font: `500 ${titleFont}px "Pretendard Variable"`,
            fill: ColorSchemes.Game.Font,
            align: 'left',
            baseline: 'middle'
        });

        const statsFont = Math.max(10, this.WW * 0.0075);
        const statsX = this.WW * 0.985;
        const statsY = this.WH * 0.96;
        const simulationWorkerHudLines = this.#getSimulationWorkerHudLines();
        render('ui', {
            shape: 'text',
            text: `enemy count: ${enemyCount}`,
            x: statsX,
            y: statsY,
            font: `400 ${statsFont}px "Pretendard Variable"`,
            fill: ColorSchemes.Game.Font,
            align: 'right',
            baseline: 'bottom',
            alpha: 0.9
        });
        for (let i = 0; i < simulationWorkerHudLines.length; i++) {
            const reverseIndex = simulationWorkerHudLines.length - 1 - i;
            render('ui', {
                shape: 'text',
                text: simulationWorkerHudLines[i],
                x: statsX,
                y: statsY - (statsFont * (6.4 + (reverseIndex * 1.28))),
                font: `400 ${statsFont}px "Pretendard Variable"`,
                fill: ColorSchemes.Game.Font,
                align: 'right',
                baseline: 'bottom',
                alpha: 0.9
            });
        }
        render('ui', {
            shape: 'text',
            text: `Collision check count: ${normalizeSnapshotNumber(collisionStats?.collisionCheckCount, 0)}`,
            x: statsX,
            y: statsY - (statsFont * 5.12),
            font: `400 ${statsFont}px "Pretendard Variable"`,
            fill: ColorSchemes.Game.Font,
            align: 'right',
            baseline: 'bottom',
            alpha: 0.9
        });
        render('ui', {
            shape: 'text',
            text: `AABB pass: ${normalizeSnapshotNumber(collisionStats?.aabbPassCount, 0)} | reject: ${normalizeSnapshotNumber(collisionStats?.aabbRejectCount, 0)}`,
            x: statsX,
            y: statsY - (statsFont * 3.84),
            font: `400 ${statsFont}px "Pretendard Variable"`,
            fill: ColorSchemes.Game.Font,
            align: 'right',
            baseline: 'bottom',
            alpha: 0.9
        });
        render('ui', {
            shape: 'text',
            text: `Circle pass: ${normalizeSnapshotNumber(collisionStats?.circlePassCount, 0)} | reject: ${normalizeSnapshotNumber(collisionStats?.circleRejectCount, 0)}`,
            x: statsX,
            y: statsY - (statsFont * 2.56),
            font: `400 ${statsFont}px "Pretendard Variable"`,
            fill: ColorSchemes.Game.Font,
            align: 'right',
            baseline: 'bottom',
            alpha: 0.9
        });
        render('ui', {
            shape: 'text',
            text: `polygon check: ${normalizeSnapshotNumber(collisionStats?.polygonChecks, 0)}`,
            x: statsX,
            y: statsY - (statsFont * 1.28),
            font: `400 ${statsFont}px "Pretendard Variable"`,
            fill: ColorSchemes.Game.Font,
            align: 'right',
            baseline: 'bottom',
            alpha: 0.9
        });
    }

    /**
     * @private
     * @param {object|null|undefined} sharedState
     */
    #drawSharedHud(sharedState) {
        const titleFont = Math.max(14, this.WW * 0.0105);
        const statsFont = Math.max(10, this.WW * 0.0075);
        const statsX = this.WW * 0.985;
        const statsY = this.WH * 0.96;
        const simulationWorkerHudLines = this.#getSimulationWorkerHudLines();
        const collisionStats = sharedState?.collisionStats ?? this.collisionStats;
        const enemyCount = Math.max(0, Math.floor(sharedState?.enemyCount ?? 0));

        render('ui', {
            shape: 'text',
            text: 'Benchmark Scene',
            x: this.WW * 0.03,
            y: this.WH * 0.04,
            font: `500 ${titleFont}px "Pretendard Variable"`,
            fill: ColorSchemes.Game.Font,
            align: 'left',
            baseline: 'middle'
        });
        render('ui', {
            shape: 'text',
            text: `enemy count: ${enemyCount}`,
            x: statsX,
            y: statsY,
            font: `400 ${statsFont}px "Pretendard Variable"`,
            fill: ColorSchemes.Game.Font,
            align: 'right',
            baseline: 'bottom',
            alpha: 0.9
        });
        for (let i = 0; i < simulationWorkerHudLines.length; i++) {
            const reverseIndex = simulationWorkerHudLines.length - 1 - i;
            render('ui', {
                shape: 'text',
                text: simulationWorkerHudLines[i],
                x: statsX,
                y: statsY - (statsFont * (6.4 + (reverseIndex * 1.28))),
                font: `400 ${statsFont}px "Pretendard Variable"`,
                fill: ColorSchemes.Game.Font,
                align: 'right',
                baseline: 'bottom',
                alpha: 0.9
            });
        }
        render('ui', {
            shape: 'text',
            text: `Collision check count: ${normalizeSnapshotNumber(collisionStats?.collisionCheckCount, 0)}`,
            x: statsX,
            y: statsY - (statsFont * 5.12),
            font: `400 ${statsFont}px "Pretendard Variable"`,
            fill: ColorSchemes.Game.Font,
            align: 'right',
            baseline: 'bottom',
            alpha: 0.9
        });
        render('ui', {
            shape: 'text',
            text: `AABB pass: ${normalizeSnapshotNumber(collisionStats?.aabbPassCount, 0)} | reject: ${normalizeSnapshotNumber(collisionStats?.aabbRejectCount, 0)}`,
            x: statsX,
            y: statsY - (statsFont * 3.84),
            font: `400 ${statsFont}px "Pretendard Variable"`,
            fill: ColorSchemes.Game.Font,
            align: 'right',
            baseline: 'bottom',
            alpha: 0.9
        });
        render('ui', {
            shape: 'text',
            text: `Circle pass: ${normalizeSnapshotNumber(collisionStats?.circlePassCount, 0)} | reject: ${normalizeSnapshotNumber(collisionStats?.circleRejectCount, 0)}`,
            x: statsX,
            y: statsY - (statsFont * 2.56),
            font: `400 ${statsFont}px "Pretendard Variable"`,
            fill: ColorSchemes.Game.Font,
            align: 'right',
            baseline: 'bottom',
            alpha: 0.9
        });
        render('ui', {
            shape: 'text',
            text: `polygon check: ${normalizeSnapshotNumber(collisionStats?.polygonChecks, 0)}`,
            x: statsX,
            y: statsY - (statsFont * 1.28),
            font: `400 ${statsFont}px "Pretendard Variable"`,
            fill: ColorSchemes.Game.Font,
            align: 'right',
            baseline: 'bottom',
            alpha: 0.9
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
