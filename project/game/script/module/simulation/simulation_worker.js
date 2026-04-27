import {
    SIMULATION_WORKER_MESSAGE_TYPES,
    createSimulationWorkerMessage,
    createSimulationWorkerSnapshot,
    isSimulationWorkerMessage,
    normalizeSimulationExecutionPolicy,
    normalizeSimulationFrameContext
} from './simulation_protocol.js';
import { syncSimulationRuntime } from './simulation_runtime.js';
import { GAME_SCENE_COMMAND_TYPES } from './game_scene_simulation_protocol.js';
import {
    attachGameSceneSharedPresentationTransport,
    createGameSceneSharedPresentationSnapshot,
    publishGameSceneSharedPresentation
} from './game_scene_shared_presentation.js';
import { cloneHexaHiveLayout, getHexaHiveType } from '../object/enemy/_hexa_hive_layout.js';
import {
    advanceGameSceneShadowState,
    applyGameSceneCommands,
    applyGameSceneFrameSnapshot,
    getGameSceneEnemyAIWorkerStatsSnapshot,
    replaceGameSceneShadowState,
    shutdownGameSceneEnemyAIWorkerCoordinator
} from './game_scene_shadow_state.js';

const workerState = {
    bootstrapped: false,
    ready: false,
    runtime: null,
    scene: null,
    frameCounter: 0,
    lastFrameId: 0,
    lastCommandCount: 0,
    lastFrameContext: normalizeSimulationFrameContext(),
    lastExecutionPolicy: normalizeSimulationExecutionPolicy(),
    lastAppliedAt: 0,
    sharedPresentationTransport: null,
    sharedPresentationWallGeometryDirty: true,
    sharedPresentationProjectileTopologyDirty: true,
    sharedPresentationEnemyTopologyDirty: true,
    profileStats: null
};
const PRESENTATION_HEXA_HIVE_TYPE = getHexaHiveType();

/**
 * 메인 스레드로 표준 워커 메시지를 전송합니다.
 * @param {string} type
 * @param {object} [payload={}]
 */
function postWorkerMessage(type, payload = {}) {
    self.postMessage(createSimulationWorkerMessage(type, payload));
}

/**
 * 현재 반영된 씬 스냅샷에서 경량 통계를 추출합니다.
 * @returns {{sceneState: string|null, sceneType: string|null, enemyCount: number, projectileCount: number, wallCount: number}}
 */
function getSceneSnapshotStats() {
    const sceneWrapper = workerState.scene;
    const sceneState = typeof sceneWrapper?.sceneState === 'string' ? sceneWrapper.sceneState : null;
    const sceneSnapshot = sceneWrapper?.scene;
    const sceneType = typeof sceneSnapshot?.sceneType === 'string' ? sceneSnapshot.sceneType : null;
    const enemyCount = Array.isArray(sceneSnapshot?.enemies) ? sceneSnapshot.enemies.length : 0;
    const projectileCount = Array.isArray(sceneSnapshot?.projectiles) ? sceneSnapshot.projectiles.length : 0;
    const staticWallCount = Array.isArray(sceneSnapshot?.staticWalls) ? sceneSnapshot.staticWalls.length : 0;
    const boxWallCount = Array.isArray(sceneSnapshot?.boxWalls) ? sceneSnapshot.boxWalls.length : 0;

    return {
        sceneState,
        sceneType,
        enemyCount,
        projectileCount,
        wallCount: staticWallCount + boxWallCount
    };
}

/**
 * 현재 씬 AI 통계를 읽기 전용 스냅샷으로 복제합니다.
 * @returns {object|null}
 */
function getSceneAIStatsSnapshot() {
    const aiStats = workerState.scene?.scene?.aiStats;
    if (!aiStats || typeof aiStats !== 'object') {
        return null;
    }

    return {
        ...aiStats,
        policyCounts: aiStats.policyCounts && typeof aiStats.policyCounts === 'object'
            ? { ...aiStats.policyCounts }
            : {},
        policyMs: aiStats.policyMs && typeof aiStats.policyMs === 'object'
            ? { ...aiStats.policyMs }
            : {}
    };
}

/**
 * 현재 씬 충돌 통계를 읽기 전용 스냅샷으로 복제합니다.
 * @returns {object|null}
 */
function getSceneCollisionStatsSnapshot() {
    return clonePresentationCollisionStats(workerState.scene?.scene?.collisionStats);
}

/**
 * 런타임 스냅샷에서 디버그 모드 활성 여부를 읽습니다.
 * @param {object|null|undefined} runtime
 * @returns {boolean}
 */
function isRuntimeDebugModeEnabled(runtime) {
    return runtime?.settings?.debugMode === true;
}

/**
 * 현재 메시지를 계측할지 반환합니다.
 * @param {object|null|undefined} message
 * @returns {boolean}
 */
function shouldProfileWorkerMessage(message = null) {
    return isRuntimeDebugModeEnabled(message?.frameSnapshot?.runtime)
        || isRuntimeDebugModeEnabled(workerState.runtime);
}

/**
 * 워커 프레임 계측 통계 기본값을 생성합니다.
 * @param {boolean} enabled
 * @param {number} frameId
 * @returns {object}
 */
function createWorkerProfileStats(enabled, frameId) {
    return {
        enabled: enabled === true,
        frameId: Number.isInteger(frameId) ? frameId : 0,
        totalMs: 0,
        commandTopologyMs: 0,
        runtimeSyncMs: 0,
        sceneWrapperMs: 0,
        commandPreStepMs: 0,
        advanceSceneMs: 0,
        commandPostStepMs: 0,
        frameMergeMs: 0,
        topologyCheckMs: 0,
        sharedPublishCallMs: 0
    };
}

/**
 * 워커 프레임 계측 시작 시각을 반환합니다.
 * @param {object|null|undefined} profileStats
 * @returns {number|null}
 */
function startWorkerProfileTimer(profileStats) {
    return profileStats?.enabled === true ? performance.now() : null;
}

/**
 * 워커 프레임 계측 시간을 누적합니다.
 * @param {object|null|undefined} profileStats
 * @param {string} fieldName
 * @param {number|null} startTime
 */
function recordWorkerProfileDuration(profileStats, fieldName, startTime) {
    if (profileStats?.enabled !== true || !Number.isFinite(startTime)) {
        return;
    }

    const durationMs = performance.now() - startTime;
    profileStats[fieldName] = (Number.isFinite(profileStats[fieldName]) ? profileStats[fieldName] : 0) + durationMs;
}

/**
 * 워커 프레임 구간을 계측하며 실행합니다.
 * @template T
 * @param {object|null|undefined} profileStats
 * @param {string} fieldName
 * @param {() => T} callback
 * @returns {T}
 */
function measureWorkerProfileSection(profileStats, fieldName, callback) {
    if (profileStats?.enabled !== true) {
        return callback();
    }

    const startTime = performance.now();
    try {
        return callback();
    } finally {
        recordWorkerProfileDuration(profileStats, fieldName, startTime);
    }
}

/**
 * 현재 워커 내부 상태를 메인 스레드로 내보낼 경량 스냅샷으로 변환합니다.
 * @returns {object}
 */
function buildWorkerSnapshot() {
    const sceneStats = getSceneSnapshotStats();
    return createSimulationWorkerSnapshot({
        ready: workerState.ready,
        bootstrapped: workerState.bootstrapped,
        frameCounter: workerState.frameCounter,
        lastFrameId: workerState.lastFrameId,
        lastCommandCount: workerState.lastCommandCount,
        sceneState: sceneStats.sceneState,
        sceneType: sceneStats.sceneType,
        enemyCount: sceneStats.enemyCount,
        projectileCount: sceneStats.projectileCount,
        wallCount: sceneStats.wallCount,
        fixedStepCount: workerState.lastFrameContext.fixedStepCount,
        fixedAlpha: workerState.lastFrameContext.fixedAlpha,
        mirroredAt: workerState.lastAppliedAt,
        aiStats: getSceneAIStatsSnapshot(),
        collisionStats: getSceneCollisionStatsSnapshot(),
        profileStats: workerState.profileStats,
        enemyAIWorker: getGameSceneEnemyAIWorkerStatsSnapshot()
    });
}

/**
 * 프레젠테이션 스냅샷용 좌표를 복제합니다.
 * @param {{x?: number, y?: number}|null|undefined} point
 * @returns {{x: number, y: number}}
 */
function clonePresentationPoint(point) {
    return {
        x: Number.isFinite(point?.x) ? point.x : 0,
        y: Number.isFinite(point?.y) ? point.y : 0
    };
}

/**
 * 프레젠테이션 스냅샷용 충돌 통계를 복제합니다.
 * @param {object|null|undefined} collisionStats
 * @returns {object|null}
 */
function clonePresentationCollisionStats(collisionStats) {
    if (!collisionStats || typeof collisionStats !== 'object') {
        return null;
    }

    const clonedStats = {
        collisionCheckCount: Number.isFinite(collisionStats?.collisionCheckCount) ? collisionStats.collisionCheckCount : 0,
        aabbPassCount: Number.isFinite(collisionStats?.aabbPassCount) ? collisionStats.aabbPassCount : 0,
        aabbRejectCount: Number.isFinite(collisionStats?.aabbRejectCount) ? collisionStats.aabbRejectCount : 0,
        circlePassCount: Number.isFinite(collisionStats?.circlePassCount) ? collisionStats.circlePassCount : 0,
        circleRejectCount: Number.isFinite(collisionStats?.circleRejectCount) ? collisionStats.circleRejectCount : 0,
        polygonChecks: Number.isFinite(collisionStats?.polygonChecks) ? collisionStats.polygonChecks : 0,
        enemyTotalMs: Number.isFinite(collisionStats?.enemyTotalMs) ? collisionStats.enemyTotalMs : 0,
        enemyBodyBuildMs: Number.isFinite(collisionStats?.enemyBodyBuildMs) ? collisionStats.enemyBodyBuildMs : 0,
        playerBodyBuildMs: Number.isFinite(collisionStats?.playerBodyBuildMs) ? collisionStats.playerBodyBuildMs : 0,
        wallBodyBuildMs: Number.isFinite(collisionStats?.wallBodyBuildMs) ? collisionStats.wallBodyBuildMs : 0,
        enemyPositionSolveMs: Number.isFinite(collisionStats?.enemyPositionSolveMs) ? collisionStats.enemyPositionSolveMs : 0,
        enemyStabilizeMs: Number.isFinite(collisionStats?.enemyStabilizeMs) ? collisionStats.enemyStabilizeMs : 0,
        enemyNonPositionMs: Number.isFinite(collisionStats?.enemyNonPositionMs) ? collisionStats.enemyNonPositionMs : 0,
        solveGridMs: Number.isFinite(collisionStats?.solveGridMs) ? collisionStats.solveGridMs : 0,
        solvePairScanMs: Number.isFinite(collisionStats?.solvePairScanMs) ? collisionStats.solvePairScanMs : 0,
        projectileTotalMs: Number.isFinite(collisionStats?.projectileTotalMs) ? collisionStats.projectileTotalMs : 0,
        projectileEnemyBodyBuildMs: Number.isFinite(collisionStats?.projectileEnemyBodyBuildMs) ? collisionStats.projectileEnemyBodyBuildMs : 0,
        projectileGridBuildMs: Number.isFinite(collisionStats?.projectileGridBuildMs) ? collisionStats.projectileGridBuildMs : 0,
        projectileScanMs: Number.isFinite(collisionStats?.projectileScanMs) ? collisionStats.projectileScanMs : 0,
        projectileCandidateQueryMs: Number.isFinite(collisionStats?.projectileCandidateQueryMs) ? collisionStats.projectileCandidateQueryMs : 0,
        projectileNarrowphaseMs: Number.isFinite(collisionStats?.projectileNarrowphaseMs) ? collisionStats.projectileNarrowphaseMs : 0,
        contactTotalMs: Number.isFinite(collisionStats?.contactTotalMs) ? collisionStats.contactTotalMs : 0,
        contactBodyBuildMs: Number.isFinite(collisionStats?.contactBodyBuildMs) ? collisionStats.contactBodyBuildMs : 0,
        contactGridBuildMs: Number.isFinite(collisionStats?.contactGridBuildMs) ? collisionStats.contactGridBuildMs : 0,
        contactPairScanMs: Number.isFinite(collisionStats?.contactPairScanMs) ? collisionStats.contactPairScanMs : 0
    };

    for (const [fieldName, value] of Object.entries(collisionStats)) {
        if (Number.isFinite(value)) {
            clonedStats[fieldName] = value;
        }
    }
    return clonedStats;
}

/**
 * 렌더에 필요한 최소 플레이어 정보만 추립니다.
 * @param {object|null|undefined} player
 * @returns {object|null}
 */
function createPresentationPlayer(player) {
    if (!player || typeof player !== 'object') {
        return null;
    }

    return {
        active: player.active !== false,
        radius: Number.isFinite(player.radius) ? player.radius : 0,
        position: clonePresentationPoint(player.position)
    };
}

/**
 * 렌더에 필요한 최소 벽 정보만 추립니다.
 * @param {object|null|undefined} wall
 * @returns {object|null}
 */
function createPresentationWall(wall) {
    if (!wall || typeof wall !== 'object') {
        return null;
    }

    return {
        active: wall.active !== false,
        x: Number.isFinite(wall.x) ? wall.x : 0,
        y: Number.isFinite(wall.y) ? wall.y : 0,
        w: Number.isFinite(wall.w) ? wall.w : 0,
        h: Number.isFinite(wall.h) ? wall.h : 0
    };
}

/**
 * 렌더에 필요한 최소 투사체 정보만 추립니다.
 * @param {object|null|undefined} projectile
 * @returns {object|null}
 */
function createPresentationProjectile(projectile) {
    if (!projectile || typeof projectile !== 'object') {
        return null;
    }

    return {
        active: projectile.active !== false,
        radius: Number.isFinite(projectile.radius) ? projectile.radius : 0,
        position: clonePresentationPoint(projectile.position)
    };
}

/**
 * 렌더에 필요한 최소 적 정보만 추립니다.
 * @param {object|null|undefined} enemy
 * @returns {object|null}
 */
function createPresentationEnemy(enemy) {
    if (!enemy || typeof enemy !== 'object') {
        return null;
    }

    return {
        active: enemy.active !== false,
        type: typeof enemy.type === 'string' ? enemy.type : 'square',
        size: Number.isFinite(enemy.size) ? enemy.size : 1,
        fill: typeof enemy.fill === 'string' ? enemy.fill : null,
        alpha: Number.isFinite(enemy.alpha) ? enemy.alpha : null,
        rotation: Number.isFinite(enemy.rotation) ? enemy.rotation : 0,
        position: clonePresentationPoint(enemy.position),
        renderPosition: clonePresentationPoint(enemy.renderPosition ?? enemy.position),
        hexaHiveLayout: enemy.type === PRESENTATION_HEXA_HIVE_TYPE
            ? cloneHexaHiveLayout(enemy.hexaHiveLayout)
            : null
    };
}

/**
 * 현재 게임 씬에 shared presentation으로 표현할 수 없는 복합 적이 있는지 반환합니다.
 * @param {object|null|undefined} sceneSnapshot
 * @returns {boolean}
 */
function hasComplexGameScenePresentation(sceneSnapshot) {
    if (!sceneSnapshot || sceneSnapshot.sceneType !== 'game' || !Array.isArray(sceneSnapshot.enemies)) {
        return false;
    }

    for (let i = 0; i < sceneSnapshot.enemies.length; i++) {
        const enemy = sceneSnapshot.enemies[i];
        if (enemy?.type === PRESENTATION_HEXA_HIVE_TYPE) {
            return true;
        }
    }

    return false;
}

/**
 * 렌더에 필요한 최소 버튼 정보만 추립니다.
 * @param {object|null|undefined} button
 * @returns {object|null}
 */
function createPresentationButton(button) {
    if (!button || typeof button !== 'object') {
        return null;
    }

    return {
        label: typeof button.label === 'string' ? button.label : '',
        x: Number.isFinite(button.x) ? button.x : 0,
        y: Number.isFinite(button.y) ? button.y : 0,
        w: Number.isFinite(button.w) ? button.w : 0,
        h: Number.isFinite(button.h) ? button.h : 0
    };
}

/**
 * 게임 씬 전체 상태를 렌더 전용 최소 스냅샷으로 변환합니다.
 * @param {object|null|undefined} sceneSnapshot
 * @returns {object|null}
 */
function createGameScenePresentationSnapshot(sceneSnapshot) {
    if (!sceneSnapshot || sceneSnapshot.sceneType !== 'game') {
        return null;
    }

    return {
        sceneType: 'game',
        player: createPresentationPlayer(sceneSnapshot.player),
        staticWalls: Array.isArray(sceneSnapshot.staticWalls)
            ? sceneSnapshot.staticWalls.map((wall) => createPresentationWall(wall)).filter(Boolean)
            : [],
        boxWalls: Array.isArray(sceneSnapshot.boxWalls)
            ? sceneSnapshot.boxWalls.map((wall) => createPresentationWall(wall)).filter(Boolean)
            : [],
        projectiles: Array.isArray(sceneSnapshot.projectiles)
            ? sceneSnapshot.projectiles.map((projectile) => createPresentationProjectile(projectile)).filter(Boolean)
            : [],
        enemies: Array.isArray(sceneSnapshot.enemies)
            ? sceneSnapshot.enemies.map((enemy) => createPresentationEnemy(enemy)).filter(Boolean)
            : [],
        collisionStats: clonePresentationCollisionStats(sceneSnapshot.collisionStats),
        buttons: Array.isArray(sceneSnapshot.buttons)
            ? sceneSnapshot.buttons.map((button) => createPresentationButton(button)).filter(Boolean)
            : []
    };
}

/**
 * 현재 워커 상태를 메인 렌더용 최소 프레젠테이션 스냅샷으로 변환합니다.
 * @param {{sceneState?: string|null, scene?: object|null}|null|undefined} sceneWrapper
 * @returns {{sceneState: string|null, scene: object|null}|null}
 */
function buildPresentationSceneWrapper(sceneWrapper) {
    if (!sceneWrapper || typeof sceneWrapper !== 'object' || !sceneWrapper.scene) {
        return null;
    }

    const sceneState = typeof sceneWrapper.sceneState === 'string' ? sceneWrapper.sceneState : null;
    if (sceneWrapper.scene.sceneType === 'game') {
        return {
            sceneState,
            scene: createGameScenePresentationSnapshot(sceneWrapper.scene)
        };
    }

    return {
        sceneState,
        scene: sceneWrapper.scene
    };
}

/**
 * 현재 프레젠테이션 경로를 메시지 payload로 구성합니다.
 * @returns {{presentationSnapshot?: object, presentationSharedState?: object}}
 */
function buildPresentationPayload() {
    if (workerState.sharedPresentationTransport
        && workerState.scene?.scene?.sceneType === 'game'
        && !hasComplexGameScenePresentation(workerState.scene?.scene)) {
        const sharedSnapshot = createGameSceneSharedPresentationSnapshot(
            workerState.sharedPresentationTransport,
            workerState.scene?.sceneState ?? null
        );
        return {
            presentationSharedState: {
                sceneState: sharedSnapshot.sceneState,
                sceneType: sharedSnapshot.scene.sceneType,
                storageType: sharedSnapshot.scene.storageType
            }
        };
    }

    return {
        presentationSnapshot: buildPresentationSceneWrapper(workerState.scene)
    };
}

/**
 * 현재 프레임에서 공유 프레젠테이션 전용 경로를 사용할 수 있는지 반환합니다.
 * @returns {boolean}
 */
function hasSharedPresentationChannel() {
    return workerState.sharedPresentationTransport !== null
        && workerState.scene?.scene?.sceneType === 'game'
        && !hasComplexGameScenePresentation(workerState.scene?.scene);
}

/**
 * 디버그 모드에서 shared presentation 경로의 경량 FRAME_ACK를 유지할지 반환합니다.
 * @returns {boolean}
 */
function shouldPostDebugSharedFrameAck() {
    return hasSharedPresentationChannel()
        && workerState.scene?.scene?.aiStats?.enabled === true;
}

/**
 * 공유 프레젠테이션에서 static wall/box wall 재기록이 필요한 커맨드인지 반환합니다.
 * @param {object|null|undefined} command
 * @returns {boolean}
 */
function isSharedPresentationWallGeometryCommand(command) {
    switch (command?.type) {
        case GAME_SCENE_COMMAND_TYPES.REPLACE_WORLD:
        case GAME_SCENE_COMMAND_TYPES.APPEND_BOX_WALLS:
        case GAME_SCENE_COMMAND_TYPES.DESTROY_WORLD:
            return true;
        default:
            return false;
    }
}

/**
 * 커맨드 배치가 shared wall geometry를 무효화하는지 반환합니다.
 * @param {object[]|null|undefined} commands
 * @returns {boolean}
 */
function shouldRepublishSharedWallGeometry(commands) {
    if (!Array.isArray(commands) || commands.length === 0) {
        return false;
    }

    for (let i = 0; i < commands.length; i++) {
        if (isSharedPresentationWallGeometryCommand(commands[i])) {
            return true;
        }
    }

    return false;
}

/**
 * 공유 프레젠테이션에서 적 topology 재기록이 필요한 커맨드인지 반환합니다.
 * @param {object|null|undefined} command
 * @returns {boolean}
 */
function isSharedPresentationEnemyTopologyCommand(command) {
    switch (command?.type) {
        case GAME_SCENE_COMMAND_TYPES.REPLACE_WORLD:
        case GAME_SCENE_COMMAND_TYPES.SPAWN_ENEMY_BATCH:
        case GAME_SCENE_COMMAND_TYPES.DESPAWN_ENEMY_BATCH:
        case GAME_SCENE_COMMAND_TYPES.DESTROY_WORLD:
            return true;
        default:
            return false;
    }
}

/**
 * 공유 프레젠테이션에서 투사체 topology 재기록이 필요한 커맨드인지 반환합니다.
 * @param {object|null|undefined} command
 * @returns {boolean}
 */
function isSharedPresentationProjectileTopologyCommand(command) {
    switch (command?.type) {
        case GAME_SCENE_COMMAND_TYPES.REPLACE_WORLD:
        case GAME_SCENE_COMMAND_TYPES.APPEND_PROJECTILES:
        case GAME_SCENE_COMMAND_TYPES.DESPAWN_PROJECTILE_BATCH:
        case GAME_SCENE_COMMAND_TYPES.DESTROY_WORLD:
            return true;
        default:
            return false;
    }
}

/**
 * 커맨드 배치가 shared enemy topology를 무효화하는지 반환합니다.
 * @param {object[]|null|undefined} commands
 * @returns {boolean}
 */
function shouldRepublishSharedEnemyTopology(commands) {
    if (!Array.isArray(commands) || commands.length === 0) {
        return false;
    }

    for (let i = 0; i < commands.length; i++) {
        if (isSharedPresentationEnemyTopologyCommand(commands[i])) {
            return true;
        }
    }

    return false;
}

/**
 * 커맨드 배치가 shared projectile topology를 무효화하는지 반환합니다.
 * @param {object[]|null|undefined} commands
 * @returns {boolean}
 */
function shouldRepublishSharedProjectileTopology(commands) {
    if (!Array.isArray(commands) || commands.length === 0) {
        return false;
    }

    for (let i = 0; i < commands.length; i++) {
        if (isSharedPresentationProjectileTopologyCommand(commands[i])) {
            return true;
        }
    }

    return false;
}

/**
 * 공유 프레젠테이션 버퍼가 연결되어 있으면 최신 상태를 publish합니다.
 * @param {object|null} [profileStats=null]
 */
function publishSharedPresentationIfNeeded(profileStats = null) {
    if (!workerState.sharedPresentationTransport
        || workerState.scene?.scene?.sceneType !== 'game'
        || hasComplexGameScenePresentation(workerState.scene?.scene)) {
        return;
    }

    const didPublish = publishGameSceneSharedPresentation(
        workerState.sharedPresentationTransport,
        workerState.scene.scene,
        workerState.lastFrameId,
        {
            reuseWallGeometry: workerState.sharedPresentationWallGeometryDirty !== true,
            reuseProjectilePresentation: workerState.sharedPresentationProjectileTopologyDirty !== true,
            reuseEnemyPresentation: workerState.sharedPresentationEnemyTopologyDirty !== true,
            profileStats
        }
    );
    if (didPublish) {
        workerState.sharedPresentationWallGeometryDirty = false;
        workerState.sharedPresentationProjectileTopologyDirty = false;
        workerState.sharedPresentationEnemyTopologyDirty = false;
    }
}

/**
 * 전체 씬 래퍼 스냅샷을 워커 내부 형식으로 정규화합니다.
 * @param {{sceneState?: string, scene?: object|null}|null|undefined} sceneWrapper
 * @returns {{sceneState: string|null, scene: object|null}}
 */
function normalizeSceneWrapper(sceneWrapper) {
    const nextSceneState = typeof sceneWrapper?.sceneState === 'string' ? sceneWrapper.sceneState : null;
    const nextScene = sceneWrapper?.scene;
    if (nextScene?.sceneType === 'game') {
        return {
            sceneState: nextSceneState,
            scene: replaceGameSceneShadowState(nextScene)
        };
    }

    return {
        sceneState: nextSceneState,
        scene: nextScene ?? null
    };
}

/**
 * 현재 씬 미러 상태 위에 프레임 동적 상태와 커맨드를 반영합니다.
 * @param {{sceneState?: string|null, scene?: object|null}|null|undefined} currentWrapper
 * @param {{sceneState?: string, scene?: object|null}|null|undefined} frameWrapper
 * @param {object|null|undefined} frameContext
 * @param {object|null|undefined} executionPolicy
 * @param {object[]} [commands=[]]
 * @param {object|null} [profileStats=null]
 * @returns {{sceneState: string|null, scene: object|null}}
 */
function applyFrameSceneWrapper(currentWrapper, frameWrapper, frameContext, executionPolicy, commands = [], profileStats = null) {
    const currentSceneState = typeof currentWrapper?.sceneState === 'string' ? currentWrapper.sceneState : null;
    const nextSceneState = typeof frameWrapper?.sceneState === 'string'
        ? frameWrapper.sceneState
        : currentSceneState;
    const currentScene = currentWrapper?.scene ?? null;
    const frameScene = frameWrapper?.scene ?? null;
    const sceneType = frameScene?.sceneType ?? currentScene?.sceneType ?? null;

    if (sceneType === 'game') {
        const shouldApplyCommandsBeforeStep = frameScene == null && Array.isArray(commands) && commands.length > 0;
        const sceneBeforeStep = shouldApplyCommandsBeforeStep
            ? measureWorkerProfileSection(
                profileStats,
                'commandPreStepMs',
                () => applyGameSceneCommands(currentScene, commands)
            )
            : currentScene;
        const steppedScene = measureWorkerProfileSection(
            profileStats,
            'advanceSceneMs',
            () => advanceGameSceneShadowState(sceneBeforeStep, frameContext, executionPolicy)
        );
        const commandAppliedScene = shouldApplyCommandsBeforeStep
            ? steppedScene
            : measureWorkerProfileSection(
                profileStats,
                'commandPostStepMs',
                () => applyGameSceneCommands(steppedScene, commands)
            );
        return {
            sceneState: nextSceneState,
            scene: measureWorkerProfileSection(
                profileStats,
                'frameMergeMs',
                () => applyGameSceneFrameSnapshot(commandAppliedScene, frameScene)
            )
        };
    }

    return {
        sceneState: nextSceneState,
        scene: frameScene ?? currentScene
    };
}

/**
 * 초기 부트스트랩 스냅샷을 워커 상태에 반영합니다.
 * @param {{runtime?: object|null, scene?: object|null}|null|undefined} snapshot
 */
function applyBootstrapSnapshot(snapshot) {
    workerState.runtime = snapshot?.runtime ?? null;
    syncSimulationRuntime(workerState.runtime ?? {});
    workerState.scene = normalizeSceneWrapper(snapshot?.scene);
    workerState.bootstrapped = true;
    workerState.ready = true;
    workerState.lastAppliedAt = performance.now();
    workerState.sharedPresentationWallGeometryDirty = true;
    workerState.sharedPresentationProjectileTopologyDirty = true;
    workerState.sharedPresentationEnemyTopologyDirty = true;
    workerState.profileStats = null;
    publishSharedPresentationIfNeeded();
}

/**
 * 프레임 동기화 메시지를 반영합니다.
 * @param {object} message
 */
function applyFrameSyncMessage(message) {
    const profileStats = createWorkerProfileStats(
        shouldProfileWorkerMessage(message),
        Number.isInteger(message.frameId) ? message.frameId : (workerState.lastFrameId + 1)
    );
    const frameTotalStart = startWorkerProfileTimer(profileStats);
    const previousScene = workerState.scene?.scene ?? null;
    const previousEnemyCount = Array.isArray(previousScene?.enemies) ? previousScene.enemies.length : 0;
    const previousProjectileCount = Array.isArray(previousScene?.projectiles) ? previousScene.projectiles.length : 0;

    const commandTopologyStart = startWorkerProfileTimer(profileStats);
    if (shouldRepublishSharedWallGeometry(message.commands)) {
        workerState.sharedPresentationWallGeometryDirty = true;
    }
    if (shouldRepublishSharedEnemyTopology(message.commands)) {
        workerState.sharedPresentationEnemyTopologyDirty = true;
    }
    if (shouldRepublishSharedProjectileTopology(message.commands)) {
        workerState.sharedPresentationProjectileTopologyDirty = true;
    }
    recordWorkerProfileDuration(profileStats, 'commandTopologyMs', commandTopologyStart);

    if (message.frameSnapshot) {
        workerState.runtime = message.frameSnapshot.runtime ?? workerState.runtime;
        measureWorkerProfileSection(
            profileStats,
            'runtimeSyncMs',
            () => syncSimulationRuntime(workerState.runtime ?? {})
        );
        workerState.scene = measureWorkerProfileSection(
            profileStats,
            'sceneWrapperMs',
            () => applyFrameSceneWrapper(
                workerState.scene,
                message.frameSnapshot.scene,
                message.frameContext,
                message.executionPolicy,
                message.commands,
                profileStats
            )
        );
        workerState.bootstrapped = true;
        workerState.ready = true;
    }

    const topologyCheckStart = startWorkerProfileTimer(profileStats);
    const nextScene = workerState.scene?.scene ?? null;
    const nextEnemyCount = Array.isArray(nextScene?.enemies) ? nextScene.enemies.length : 0;
    const nextProjectileCount = Array.isArray(nextScene?.projectiles) ? nextScene.projectiles.length : 0;
    if (nextEnemyCount !== previousEnemyCount) {
        workerState.sharedPresentationEnemyTopologyDirty = true;
    }
    if (nextProjectileCount !== previousProjectileCount) {
        workerState.sharedPresentationProjectileTopologyDirty = true;
    }
    recordWorkerProfileDuration(profileStats, 'topologyCheckMs', topologyCheckStart);

    workerState.lastFrameId = Number.isInteger(message.frameId)
        ? message.frameId
        : (workerState.lastFrameId + 1);
    workerState.lastCommandCount = Array.isArray(message.commands) ? message.commands.length : 0;
    workerState.lastFrameContext = normalizeSimulationFrameContext(message.frameContext);
    workerState.lastExecutionPolicy = normalizeSimulationExecutionPolicy(message.executionPolicy);
    workerState.frameCounter++;
    workerState.lastAppliedAt = performance.now();
    measureWorkerProfileSection(
        profileStats,
        'sharedPublishCallMs',
        () => publishSharedPresentationIfNeeded(profileStats.enabled === true ? profileStats : null)
    );
    recordWorkerProfileDuration(profileStats, 'totalMs', frameTotalStart);
    workerState.profileStats = profileStats.enabled === true ? profileStats : null;
}

/**
 * 워커 처리 중 발생한 오류를 메인 스레드에 보고합니다.
 * @param {unknown} error
 */
function reportWorkerError(error) {
    const message = error instanceof Error
        ? error.message
        : String(error);
    const stack = error instanceof Error && typeof error.stack === 'string'
        ? error.stack
        : null;
    console.error('[simulation-worker]', message, error);
    postWorkerMessage(SIMULATION_WORKER_MESSAGE_TYPES.ERROR, {
        error: message,
        stack,
        workerSnapshot: buildWorkerSnapshot()
    });
}

/**
 * 워커 전역 error 이벤트를 메인 스레드에 보고합니다.
 * @param {ErrorEvent} event
 */
function handleWorkerGlobalError(event) {
    const error = event?.error instanceof Error
        ? event.error
        : new Error(typeof event?.message === 'string' && event.message.length > 0
            ? event.message
            : '시뮬레이션 워커 전역 오류');
    reportWorkerError(error);
}

/**
 * 워커 전역 unhandledrejection 이벤트를 메인 스레드에 보고합니다.
 * @param {PromiseRejectionEvent} event
 */
function handleWorkerUnhandledRejection(event) {
    const reason = event?.reason;
    const error = reason instanceof Error
        ? reason
        : new Error(typeof reason === 'string' && reason.length > 0
            ? reason
            : '시뮬레이션 워커 비동기 거부');
    reportWorkerError(error);
}

self.addEventListener('error', handleWorkerGlobalError);
self.addEventListener('unhandledrejection', handleWorkerUnhandledRejection);

self.addEventListener('message', (event) => {
    try {
        const message = event.data;
        if (!isSimulationWorkerMessage(message)) {
            return;
        }

        switch (message.type) {
            case SIMULATION_WORKER_MESSAGE_TYPES.BOOTSTRAP:
                if (message.sharedPresentationBuffers) {
                    workerState.sharedPresentationTransport = attachGameSceneSharedPresentationTransport(
                        message.sharedPresentationBuffers
                    );
                }
                applyBootstrapSnapshot(message.snapshot);
                postWorkerMessage(SIMULATION_WORKER_MESSAGE_TYPES.READY, {
                    workerSnapshot: buildWorkerSnapshot(),
                    ...buildPresentationPayload()
                });
                break;
            case SIMULATION_WORKER_MESSAGE_TYPES.FRAME_SYNC:
                applyFrameSyncMessage(message);
                if (!hasSharedPresentationChannel() || shouldPostDebugSharedFrameAck()) {
                    postWorkerMessage(SIMULATION_WORKER_MESSAGE_TYPES.FRAME_ACK, {
                        frameId: workerState.lastFrameId,
                        workerSnapshot: buildWorkerSnapshot(),
                        ...(!hasSharedPresentationChannel() ? buildPresentationPayload() : {})
                    });
                }
                break;
            case SIMULATION_WORKER_MESSAGE_TYPES.SHUTDOWN:
                shutdownGameSceneEnemyAIWorkerCoordinator();
                postWorkerMessage(SIMULATION_WORKER_MESSAGE_TYPES.FRAME_ACK, {
                    frameId: workerState.lastFrameId,
                    workerSnapshot: buildWorkerSnapshot(),
                    ...buildPresentationPayload()
                });
                self.close();
                break;
        }
    } catch (error) {
        reportWorkerError(error);
    }
});

postWorkerMessage(SIMULATION_WORKER_MESSAGE_TYPES.READY, {
    workerSnapshot: buildWorkerSnapshot(),
    ...buildPresentationPayload()
});
