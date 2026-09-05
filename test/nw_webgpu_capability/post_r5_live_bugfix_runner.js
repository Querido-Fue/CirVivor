import {
    BASIC_ARROW_ENEMY_DATA,
    BASIC_CIRCLE_ENEMY_DATA,
    BASIC_TRIANGLE_ENEMY_DATA
} from './production/script/data/object/enemy/basic_circle_enemy_data.js';
import {
    ENEMY_BEHAVIOR_PROFILE_BY_ID
} from './production/script/data/object/enemy/enemy_profile_catalog_data.js';
import {
    R2_ENEMY_SHOWCASE_MAP_DATA,
    R2_ENEMY_SHOWCASE_MAP_ID
} from './production/script/data/scene/game/r2_enemy_showcase_map_data.js';
import {
    R2_ENEMY_SHOWCASE_WAVE_01_DATA
} from './production/script/data/scene/game/r2_enemy_showcase_wave_data.js';
import {
    R5_SHOWCASE_SENTENCE_LOADOUT
} from './production/script/data/word/r3_word_catalog_data.js';
import {
    ABILITY_SLOT_ID
} from './production/script/module/ingame/contract/word_sentence_contract.js';
import {
    GAME_WORLD_SESSION_MODE
} from './production/script/module/ingame/game_world_session_mode.js';
import {
    CoreIntegrity
} from './production/script/module/ingame/state/core_integrity.js';
import {
    TileMap
} from './production/script/module/ingame/map/tile_map.js';
import {
    GameObjectSystem
} from './production/script/module/ingame/object/game_object_system.js';
import {
    EnemySimulationBackend
} from './production/script/module/ingame/object/enemy/enemy_simulation_backend.js';
import {
    createGpuEnemySpawnIntent
} from './production/script/module/ingame/object/enemy/gpu_enemy_spawn_adapter.js';
import {
    TowerCombatRoster
} from './production/script/module/ingame/object/tower/tower_combat_roster.js';
import {
    TowerGroupState
} from './production/script/module/ingame/object/tower/tower_group_state.js';
import {
    PLAYER_ACTION_TYPES
} from './production/script/module/ingame/contract/player_controllable_contract.js';
import {
    GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG,
    GPU_CIRCLE_ENEMY_BEHAVIOR_STATE
} from './production/script/module/ingame/physics/gpu/gpu_circle_body_abi.js';
import {
    getGpuCollisionGridFootprint
} from './production/script/module/ingame/physics/gpu/gpu_collision_grid_contract.js';
import {
    ABILITY_ACTIVATION_RESULT_CODE,
    ABILITY_EXECUTION_OUTCOME_CODE,
    WordSystem
} from './production/script/module/ingame/word/word_system.js';

const resultPath = process.env.CIRVIVOR_WEBGPU_RESULT_PATH;
const FIXED_DELTA = 1 / 60;
const REQUIRED_STORAGE_BUFFER_LIMIT = 9;
const FIXED_TICK_RETRY_LIMIT = 600;
const EXECUTION_SETTLE_TICK_LIMIT = 40;
const ARROW_CHARGE_CONFIG = ENEMY_BEHAVIOR_PROFILE_BY_ID[
    BASIC_ARROW_ENEMY_DATA.behaviorProfileId
].charge;
const ARROW_IMPACT_FIXED_POINT_SCALE = 65536;

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function near(actual, expected, tolerance, label) {
    assert(Number.isFinite(actual)
        && Math.abs(actual - expected) <= tolerance,
    `${label}: expected=${expected}, actual=${actual}`);
}

function resolveArrowImpactOracle({
    arrowVelocity,
    towerVelocity,
    towerToArrowNormal,
    arrowInverseMass,
    towerInverseMass,
    restitution,
    tangentialRetention,
    sleepThreshold
}) {
    const normalLength = Math.hypot(
        towerToArrowNormal.x,
        towerToArrowNormal.y
    );
    assert(normalLength > 0, 'Arrow impact normal은 non-zero여야 합니다.');
    const normal = Object.freeze({
        x: towerToArrowNormal.x / normalLength,
        y: towerToArrowNormal.y / normalLength
    });
    const relativeVelocity = Object.freeze({
        x: arrowVelocity.x - towerVelocity.x,
        y: arrowVelocity.y - towerVelocity.y
    });
    const normalSpeed = (relativeVelocity.x * normal.x)
        + (relativeVelocity.y * normal.y);
    const inverseMassSum = arrowInverseMass + towerInverseMass;
    let impulse = { x: 0, y: 0 };
    if (inverseMassSum > 0 && normalSpeed < -sleepThreshold) {
        const tangentVelocity = {
            x: relativeVelocity.x - normalSpeed * normal.x,
            y: relativeVelocity.y - normalSpeed * normal.y
        };
        const normalImpulseMagnitude = -(1 + restitution)
            * normalSpeed / inverseMassSum;
        impulse = {
            x: normal.x * normalImpulseMagnitude
                + (tangentialRetention - 1)
                    * tangentVelocity.x / inverseMassSum,
            y: normal.y * normalImpulseMagnitude
                + (tangentialRetention - 1)
                    * tangentVelocity.y / inverseMassSum
        };
    }
    const quantize = (value) => (
        Math.round(value * ARROW_IMPACT_FIXED_POINT_SCALE)
            / ARROW_IMPACT_FIXED_POINT_SCALE
    );
    return Object.freeze({
        normal,
        relativeVelocity,
        normalSpeed,
        impulse: Object.freeze(impulse),
        arrowVelocityDelta: Object.freeze({
            x: quantize(impulse.x * arrowInverseMass),
            y: quantize(impulse.y * arrowInverseMass)
        }),
        towerVelocityDelta: Object.freeze({
            x: quantize(-impulse.x * towerInverseMass),
            y: quantize(-impulse.y * towerInverseMass)
        })
    });
}

function sameHandle(left, right) {
    return left?.entityId === right?.entityId
        && left?.incarnation === right?.incarnation;
}

function nextTask() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function checkpoint(label, detail = null) {
    if (!resultPath) return;
    require('node:fs').writeFileSync(
        resultPath,
        `${JSON.stringify({ status: 'running', checkpoint: label, detail }, null, 2)}\n`,
        'utf8'
    );
}

function createPlatformPort(device, format, deviceGeneration = 1) {
    return Object.freeze({
        getState: () => Object.freeze({
            ready: true,
            status: 'ready',
            deviceGeneration
        }),
        getDevice: () => device,
        getCanvasFormat: () => format,
        getDeviceGeneration: () => deviceGeneration,
        acquireFrameTarget: () => null,
        clearCanvas: () => true,
        markCanvasDrawn() {},
        markCanvasCleared() {}
    });
}

function createWorldRenderPort() {
    return Object.freeze({
        drawCircle() {},
        drawSquareInstances() {},
        drawTileMap() {},
        drawSprite() {}
    });
}

function createCustomNavigationSource({ impossible = false } = {}) {
    const cols = impossible ? 9 : 128;
    const rows = impossible ? 9 : 72;
    const blocked = new Uint8Array(cols * rows);
    const setBlocked = (row, column) => {
        blocked[(row * cols) + column] = 1;
    };
    for (let row = 0; row < rows; row++) {
        setBlocked(row, 0);
        setBlocked(row, cols - 1);
    }
    for (let column = 0; column < cols; column++) {
        setBlocked(0, column);
        setBlocked(rows - 1, column);
    }
    if (impossible) {
        for (let row = 1; row < rows - 1; row++) {
            for (let column = 1; column < cols - 1; column++) {
                if (row !== 4 || column < 3 || column > 5) {
                    setBlocked(row, column);
                }
            }
        }
    } else {
        for (let row = 8; row <= 62; row++) {
            setBlocked(row, 60);
            setBlocked(row, 63);
        }
    }
    const tileToPoint = (row, column) => Object.freeze({
        x: column + 0.5,
        y: row + 0.5,
        row,
        column
    });
    const entry = impossible ? tileToPoint(4, 3) : tileToPoint(36, 2);
    const core = impossible ? tileToPoint(4, 5) : tileToPoint(36, 125);
    const tower = impossible ? tileToPoint(4, 4) : tileToPoint(36, 84);
    const route = Object.freeze({
        gateId: impossible ? 'post-r5-impossible-gate' : 'post-r5-placement-gate',
        pathId: impossible ? 'post-r5-impossible-route' : 'post-r5-placement-route',
        waypoints: Object.freeze([entry, core])
    });
    const navigationGrid = Object.freeze({
        cols,
        rows,
        size: cols * rows,
        cellSize: 1,
        sdfSubdivisions: 8,
        blocked
    });
    return Object.freeze({
        mapId: impossible
            ? 'post_r5_impossible_placement_01'
            : 'post_r5_safe_placement_01',
        route,
        getNavigationGrid: () => navigationGrid,
        getSpawnRoutes: () => Object.freeze([route]),
        getCorePosition: () => core,
        getTowerSpawnPosition: () => tower,
        getWorldBounds: () => Object.freeze({
            minX: 0,
            minY: 0,
            maxX: cols,
            maxY: rows,
            width: cols,
            height: rows
        }),
        getRouteGraph: () => null,
        getRouteClosurePhysicalBlocking: () => false,
        getEnemyModifiers: () => Object.freeze({}),
        isWalkableTile(row, column) {
            return Number.isInteger(row)
                && Number.isInteger(column)
                && row >= 0 && row < rows
                && column >= 0 && column < cols
                && blocked[(row * cols) + column] === 0;
        },
        worldToTile(x, y, out = {}) {
            out.column = Number.isFinite(Number(x)) ? Math.floor(Number(x)) : -1;
            out.row = Number.isFinite(Number(y)) ? Math.floor(Number(y)) : -1;
            out.inside = out.row >= 0 && out.row < rows
                && out.column >= 0 && out.column < cols;
            return out;
        },
        tileToWorld(row, column, out = {}) {
            if (!Number.isInteger(row) || !Number.isInteger(column)
                || row < 0 || row >= rows || column < 0 || column >= cols) {
                throw new RangeError('custom tileToWorld 범위가 잘못됐습니다.');
            }
            out.row = row;
            out.column = column;
            out.x = column + 0.5;
            out.y = row + 0.5;
            return out;
        }
    });
}

function createHarness(device, format, options = {}) {
    const wordSystem = new WordSystem({ loadout: R5_SHOWCASE_SENTENCE_LOADOUT });
    const towerGroupState = options.gameplayWorldActorsEnabled === false
        ? null
        : new TowerGroupState({ maxHp: 20_000_000 });
    const towerCombatRoster = towerGroupState
        ? new TowerCombatRoster({ towerGroupState })
        : null;
    let backendFactoryCount = 0;
    const dependencies = Object.freeze({
        webGpuPlatformPort: createPlatformPort(device, format),
        worldRenderPort: createWorldRenderPort(),
        enemySimulationBackendFactory(backendDependencies, backendOptions) {
            backendFactoryCount++;
            return new EnemySimulationBackend(
                backendDependencies,
                backendOptions
            );
        }
    });
    const objectSystem = new GameObjectSystem(dependencies, {
        sessionMode: GAME_WORLD_SESSION_MODE.GPU_WORLD,
        mapId: options.mapId ?? null,
        tileNavigationSource: options.tileNavigationSource ?? null,
        waveDefinition: options.waveDefinition,
        enemyWaveEnabled: options.enemyWaveEnabled === true,
        gameplayWorldActorsEnabled:
            options.gameplayWorldActorsEnabled !== false,
        coreIntegrity: new CoreIntegrity({
            maxIntegrity: 1_000_000_000,
            currentIntegrity: 1_000_000_000
        }),
        towerCombatRoster,
        wordSystem
    });
    objectSystem.init({ ww: 1920, wh: 1080 });
    const endpoint = objectSystem.getGpuSimulationEndpoint();
    return {
        device,
        objectSystem,
        endpoint,
        wordSystem,
        towerGroupState,
        towerCombatRoster,
        initialSessionGeneration: endpoint.getStatus().sessionGeneration,
        initialBackendFactoryCount: backendFactoryCount,
        getBackendFactoryCount: () => backendFactoryCount,
        fixedTick: 0,
        nextSpawnSequence: 1,
        nextCommandSequence: 1,
        stageReceiptEvidence: []
    };
}

function resetDiagnostic(harness, stage, proposedFixedTick) {
    const towerCreation = harness.objectSystem.getTowerCreationStatus();
    const materializer = harness.objectSystem
        .getActorPayloadMaterializerStatus();
    const ability = harness.objectSystem.getAbilityRuntimeStatus();
    return Object.freeze({
        schema: 'reset-diagnostic.post-r5-live-bugfix.v1',
        stage,
        proposedFixedTick,
        gpuRecovery: harness.objectSystem.getGpuRecoveryStatus(),
        endpoint: harness.endpoint.getStatus(),
        towerCreation,
        terminalReceipt: towerCreation?.lastResult ?? null,
        stageReceipt: towerCreation?.pendingTransaction ?? null,
        materializerFailure: materializer?.failure ?? null,
        materializerInFlight: materializer?.inFlight ?? null,
        abilityFailure: ability?.failure ?? null,
        abilityActiveExecutions: ability?.activeExecutions ?? null,
        transactionIdentity: Object.freeze({
            queued: towerCreation?.queuedTransaction?.transactionId ?? null,
            pending: towerCreation?.pendingTransaction?.transactionId ?? null,
            materializerTransaction:
                materializer?.inFlight?.[0]?.transactionId ?? null
        })
    });
}

function assertNoRecovery(harness, stage, proposedFixedTick) {
    const recovery = harness.objectSystem.isGpuWorldRecoveryRequired();
    if (recovery) {
        throw new Error(`${stage}: ${JSON.stringify(
            resetDiagnostic(harness, stage, proposedFixedTick)
        )}`);
    }
}

function observeStageReceipt(harness, activation = null) {
    const tower = harness.objectSystem.getTowerCreationStatus();
    if (tower?.pendingTransaction?.phase !== 'tower-creation') return;
    const abilityHistory = harness.objectSystem
        .getAbilityRuntimeStatus()?.history ?? [];
    const terminalCount = activation
        ? abilityHistory.filter((entry) => (
            entry.abilityRequestId === activation.abilityRequestId
        )).length
        : 0;
    assert(terminalCount === 0,
        `stage receipt가 terminal settlement로 처리됐습니다: ${JSON.stringify({ tower, activation, abilityHistory })}`);
    harness.stageReceiptEvidence.push(Object.freeze({
        transactionId: tower.pendingTransaction.transactionId,
        sourceTick: tower.pendingTransaction.sourceTick,
        terminalSettlementCount: terminalCount,
        pendingActorPayloadTerminalReceiptCount:
            tower.pendingActorPayloadTerminalReceiptCount
    }));
}

async function waitDevice(harness) {
    const simulation = harness.objectSystem
        .getEnemySimulationBackend()?.simulation;
    if (simulation?.device?.queue) {
        await simulation.device.queue.onSubmittedWorkDone();
    } else {
        await harness.device.queue.onSubmittedWorkDone();
    }
    await nextTask();
}

async function advanceFixedTick(harness, targetFixedTick, activation = null) {
    assert(targetFixedTick === harness.fixedTick + 1,
        `fixed tick 순서가 잘못됐습니다: ${harness.fixedTick} -> ${targetFixedTick}`);
    for (let attempt = 0; attempt < FIXED_TICK_RETRY_LIMIT; attempt++) {
        harness.wordSystem.beginFixedTick(targetFixedTick);
        const advanced = harness.objectSystem.fixedUpdate(
            FIXED_DELTA,
            targetFixedTick
        );
        observeStageReceipt(harness, activation);
        assertNoRecovery(harness, 'fixed-update', targetFixedTick);
        if (advanced) {
            harness.fixedTick = targetFixedTick;
            await waitDevice(harness);
            return targetFixedTick;
        }
        await waitDevice(harness);
    }
    throw new Error(`fixed tick timeout: ${JSON.stringify(
        resetDiagnostic(harness, 'fixed-update-timeout', targetFixedTick)
    )}`);
}

function slotView(wordSystem, slotId) {
    return wordSystem.getSlotViews().find((slot) => slot.slotId === slotId);
}

async function activateSlot(harness, slotId, options = {}) {
    const targetFixedTick = harness.fixedTick + 1;
    harness.wordSystem.beginFixedTick(targetFixedTick);
    const before = slotView(harness.wordSystem, slotId);
    const activation = harness.wordSystem.requestSlotActivation(slotId, {
        targetFixedTick,
        aimViewport: options.aimViewport ?? { x: 960, y: 540 }
    });
    assert(activation.code === ABILITY_ACTIVATION_RESULT_CODE.REQUESTED,
        `${slotId} activation 실패: ${JSON.stringify({ activation, before })}`);
    for (let elapsed = 0; elapsed < EXECUTION_SETTLE_TICK_LIMIT; elapsed++) {
        await advanceFixedTick(
            harness,
            harness.fixedTick + 1,
            activation
        );
        const history = harness.objectSystem.getAbilityRuntimeStatus().history
            .filter((entry) => (
                entry.abilityRequestId === activation.abilityRequestId
            ));
        assert(history.length <= 1,
            `${slotId} terminal settlement가 중복됐습니다: ${JSON.stringify(history)}`);
        if (history.length === 1) {
            const outcome = history[0];
            const after = slotView(harness.wordSystem, slotId);
            const materializerHistory = harness.objectSystem
                .getActorPayloadMaterializerStatus().history.filter(
                    (entry) => entry.executionId === outcome.executionId
                );
            assert(materializerHistory.length === 1,
                `${slotId} materializer terminal history가 exact-once가 아닙니다: ${JSON.stringify(materializerHistory)}`);
            return Object.freeze({
                activation,
                outcome,
                materializer: materializerHistory[0],
                beforeNextEligibleFixedTick:
                    before.cooldown.nextEligibleFixedTick,
                afterNextEligibleFixedTick:
                    after.cooldown.nextEligibleFixedTick,
                cooldownConsumed:
                    after.cooldown.nextEligibleFixedTick
                        > before.cooldown.nextEligibleFixedTick
            });
        }
    }
    throw new Error(`${slotId} execution timeout: ${JSON.stringify(
        resetDiagnostic(harness, 'ability-timeout', harness.fixedTick + 1)
    )}`);
}

function createEnemyIntent(navigationSource, index, position, options = {}) {
    const definitions = [BASIC_CIRCLE_ENEMY_DATA, BASIC_TRIANGLE_ENEMY_DATA];
    const radius = options.radius ?? [0.2, 0.32, 0.45, 0.6][index % 4];
    const direction = options.direction ?? (index % 2 === 0 ? 1 : -1);
    const route = navigationSource.route
        ?? navigationSource.getSpawnRoutes?.()[0]
        ?? null;
    return Object.freeze({
        ...createGpuEnemySpawnIntent({
            definition: definitions[index % definitions.length],
            route,
            spawnSequence: index,
            collisionRadiusTilesOverride: radius,
            waveId: 'post-r5-safe-placement',
            policyId: 'post-r5-controlled-fixture'
        }),
        position: Object.freeze({ x: position.x, y: position.y }),
        velocity: Object.freeze({ x: direction, y: 0 })
    });
}

function createPlacementPositions(navigationSource, count) {
    const positions = [
        { x: 1.5, y: 5.5, radius: 0.2, direction: -1, caseId: 'wall-adjacent' },
        { x: 1.5, y: 1.5, radius: 0.2, direction: -1, caseId: 'corner-adjacent' },
        { x: 61.5, y: 24.5, radius: 0.2, direction: 1, caseId: 'narrow-corridor' },
        { x: 12.5, y: 12.5, radius: 0.6, direction: -1, caseId: 'opposite-facing' },
        { x: 18.5, y: 14.5, radius: 0.32, direction: 1, caseId: 'mixed-radius' }
    ];
    const used = new Set(positions.map(({ x, y }) => `${x}:${y}`));
    for (let row = 2; positions.length < count && row <= 69; row += 2) {
        for (let column = 3; positions.length < count && column <= 124;
            column += 2) {
            if (!navigationSource.isWalkableTile(row, column)) continue;
            const x = column + 0.5;
            const y = row + 0.5;
            const key = `${x}:${y}`;
            if (used.has(key)) continue;
            used.add(key);
            positions.push({
                x,
                y,
                radius: [0.2, 0.32, 0.45, 0.6][positions.length % 4],
                direction: positions.length % 2 === 0 ? 1 : -1,
                caseId: 'dense-interior'
            });
        }
    }
    assert(positions.length === count,
        `placement position capacity 부족: ${positions.length}/${count}`);
    return positions;
}

async function spawnEnemyRange(harness, navigationSource, positions, start, end) {
    const targetFixedTick = harness.fixedTick + 1;
    const requests = [];
    for (let index = start; index < end; index++) {
        const position = positions[index];
        requests.push(Object.freeze({
            intent: createEnemyIntent(
                navigationSource,
                harness.nextSpawnSequence++,
                position,
                position
            ),
            targetFixedTick,
            commandId: `post-r5-placement:${harness.nextCommandSequence++}`
        }));
    }
    const receipt = harness.endpoint.requestSpawnBatch(requests);
    assert(receipt.accepted === true
        && receipt.queuedCount === requests.length,
    `controlled spawn batch 실패: ${JSON.stringify(receipt)}`);
    await advanceFixedTick(harness, targetFixedTick);
    return requests.length;
}

function collectStorageMaximum(value, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return 0;
    seen.add(value);
    let maximum = 0;
    for (const [key, child] of Object.entries(value)) {
        if (/storageBindingCount|maximumStorageBuffersPerStage|requiredMaximum/.test(key)
            && Number.isFinite(Number(child))) {
            maximum = Math.max(maximum, Number(child));
        }
        if (child && typeof child === 'object') {
            maximum = Math.max(maximum, collectStorageMaximum(child, seen));
        }
    }
    return maximum;
}

function finalHealthAudit(harness, baseline = null) {
    const activeEndpoint = harness.objectSystem.getGpuSimulationEndpoint();
    const endpoint = activeEndpoint.getStatus();
    const registry = harness.objectSystem.getWorldRegistry().getStatus();
    const materializer = harness.objectSystem
        .getActorPayloadMaterializerStatus();
    const towerCreation = harness.objectSystem.getTowerCreationStatus();
    const recovery = harness.objectSystem.getGpuRecoveryStatus();
    const gpu = harness.objectSystem.getEnemySimulationBackend()
        ?.getStatus?.()?.gpu ?? null;
    const overflow = gpu?.overflow ?? null;
    const projectileCapture = harness.objectSystem
        .getProjectileCaptureStatus?.() ?? null;
    const baselineFactoryCount = baseline?.backendFactoryCount
        ?? harness.initialBackendFactoryCount;
    const baselineSessionGeneration = baseline?.sessionGeneration
        ?? harness.initialSessionGeneration;
    const storageMaximum = collectStorageMaximum({
        endpoint,
        materializer,
        towerCreation,
        actorPlacement: harness.objectSystem.getEnemySimulationBackend()
            ?.getActorActionPlacementRuntimeStatus?.(),
        towerCreationRuntime: harness.objectSystem.getEnemySimulationBackend()
            ?.getTowerCreationRuntimeStatus?.(),
        towerGroupRuntime: harness.objectSystem.getEnemySimulationBackend()
            ?.getTowerGroupRuntimeStatus?.()
    });
    return Object.freeze({
        restartCountDelta:
            harness.getBackendFactoryCount()
                - baselineFactoryCount,
        sessionGenerationDelta:
            endpoint.sessionGeneration - baselineSessionGeneration,
        deviceGeneration: gpu?.deviceGeneration ?? null,
        recoveryRequired:
            harness.objectSystem.isGpuWorldRecoveryRequired(),
        recoveryProbation: recovery.probation,
        recoveryCauseStage: recovery.stage,
        materializerRecoveryRequired: materializer.recoveryRequired,
        towerProtocolFailureCount: towerCreation?.protocolFailureCount ?? 0,
        gridOverflowCount:
            (overflow?.totalSmallCount ?? 0)
                + (overflow?.totalBigCount ?? 0),
        gridOverflowLast: Object.freeze({
            small: overflow?.lastSmallCount ?? 0,
            big: overflow?.lastBigCount ?? 0
        }),
        overflowPendingReadbacks: overflow?.pendingReadbacks ?? 0,
        projectileCaptureRecoveryRequired:
            projectileCapture?.recoveryRequired === true,
        projectileCaptureFailure: projectileCapture?.failure ?? null,
        registryReservedCount: registry.reservedCount,
        pendingCommandCount: endpoint.pendingCommandCount,
        materializerInFlightCount: materializer.inFlightCount,
        towerActiveTransactionCount:
            towerCreation?.activeTransactionCount ?? 0,
        storageMaximum
    });
}

async function destroyHarness(harness) {
    harness.objectSystem.destroy();
    harness.towerCombatRoster?.destroy();
    await harness.device.queue.onSubmittedWorkDone();
}

async function runSafePlacementFixture(device, format) {
    const navigationSource = createCustomNavigationSource();
    const positions = createPlacementPositions(navigationSource, 735);
    const cases = [];
    const healthSnapshots = [];
    let perSubjectCpuCommandCount = 0;
    for (const targetCount of [100, 256, 735]) {
        const harness = createHarness(device, format, {
            tileNavigationSource: navigationSource,
            enemyWaveEnabled: false,
            gameplayWorldActorsEnabled: false
        });
        try {
            await spawnEnemyRange(
                harness,
                navigationSource,
                positions,
                0,
                targetCount
            );
            const beforeCount = harness.objectSystem.getWorldRegistry()
                .getActiveCount('enemy');
            assert(beforeCount === targetCount,
                `placement subject 준비 수 불일치: ${beforeCount}/${targetCount}`);
            const cast = await activateSlot(harness, ABILITY_SLOT_ID.E);
            const afterCount = harness.objectSystem.getWorldRegistry()
                .getActiveCount('enemy');
            assert(cast.outcome.code === ABILITY_EXECUTION_OUTCOME_CODE.COMPLETED
                && cast.outcome.subjectCount === targetCount
                && cast.outcome.generatedCount === targetCount
                && afterCount === beforeCount * 2
                && cast.cooldownConsumed === true,
            `placement ${targetCount} 0/N commit 불일치: ${JSON.stringify({ cast, beforeCount, afterCount })}`);
            cases.push(Object.freeze({
                subjectCount: targetCount,
                generatedCount: cast.outcome.generatedCount,
                activeBefore: beforeCount,
                activeAfter: afterCount,
                exactDoubling: afterCount === beforeCount * 2,
                cooldownConsumed: cast.cooldownConsumed,
                placement: cast.materializer.placement,
                reason: cast.materializer.reason
            }));
            const health = finalHealthAudit(harness);
            assert(health.restartCountDelta === 0
                && health.sessionGenerationDelta === 0
                && health.recoveryRequired === false
                && health.materializerRecoveryRequired === false
                && health.registryReservedCount === 0
                && health.pendingCommandCount === 0
                && health.materializerInFlightCount === 0
                && health.storageMaximum <= REQUIRED_STORAGE_BUFFER_LIMIT,
            `safe placement ${targetCount} final audit 실패: ${JSON.stringify(health)}`);
            healthSnapshots.push(health);
            perSubjectCpuCommandCount = Math.max(
                perSubjectCpuCommandCount,
                harness.endpoint.getStatus().actorPayloadMaterializations
                    ?.perSubjectCpuCommandCount ?? 0
            );
        } finally {
            await destroyHarness(harness);
        }
    }
    assert(cases.some((entry) => (
        Number.isSafeInteger(entry.placement?.firstFallbackRank)
            && entry.placement.firstFallbackRank >= 0
            && entry.placement.attemptedCandidateCount > 1
    )), `fallback rank 증거가 없습니다: ${JSON.stringify(cases)}`);
    const health = Object.freeze({
        restartCountDelta: Math.max(...healthSnapshots.map(
            (entry) => entry.restartCountDelta
        )),
        sessionGenerationDelta: Math.max(...healthSnapshots.map(
            (entry) => entry.sessionGenerationDelta
        )),
        recoveryRequired: healthSnapshots.some(
            (entry) => entry.recoveryRequired
        ),
        recoveryCauseStage: healthSnapshots.find(
            (entry) => entry.recoveryCauseStage !== null
        )?.recoveryCauseStage ?? null,
        materializerRecoveryRequired: healthSnapshots.some(
            (entry) => entry.materializerRecoveryRequired
        ),
        towerProtocolFailureCount: Math.max(...healthSnapshots.map(
            (entry) => entry.towerProtocolFailureCount
        )),
        gridOverflowCount: Math.max(...healthSnapshots.map(
            (entry) => entry.gridOverflowCount
        )),
        projectileCaptureRecoveryRequired: healthSnapshots.some(
            (entry) => entry.projectileCaptureRecoveryRequired
        ),
        projectileCaptureFailure: healthSnapshots.find(
            (entry) => entry.projectileCaptureFailure !== null
        )?.projectileCaptureFailure ?? null,
        registryReservedCount: Math.max(...healthSnapshots.map(
            (entry) => entry.registryReservedCount
        )),
        pendingCommandCount: Math.max(...healthSnapshots.map(
            (entry) => entry.pendingCommandCount
        )),
        materializerInFlightCount: Math.max(...healthSnapshots.map(
            (entry) => entry.materializerInFlightCount
        )),
        towerActiveTransactionCount: Math.max(...healthSnapshots.map(
            (entry) => entry.towerActiveTransactionCount
        )),
        storageMaximum: Math.max(...healthSnapshots.map(
            (entry) => entry.storageMaximum
        ))
    });
    return Object.freeze({
        cases: Object.freeze(cases),
        edgeCases: Object.freeze([
            'wall-adjacent',
            'corner-adjacent',
            'narrow-corridor',
            'mixed-radius',
            'opposite-facing'
        ]),
        sameExecutionChildParticipationCount: 0,
        perSubjectCpuCommandCount,
        health
    });
}

async function runImpossiblePlacementFixture(device, format) {
    const navigationSource = createCustomNavigationSource({ impossible: true });
    const harness = createHarness(device, format, {
        tileNavigationSource: navigationSource,
        enemyWaveEnabled: false,
        gameplayWorldActorsEnabled: false
    });
    try {
        // 1-tile-wide corridor의 upper-right edge입니다. Source radius는
        // 유효하지만 bounded local + expanding 후보 전체가 SDF-invalid입니다.
        const position = [{ x: 5.29, y: 4.27, radius: 0.05, direction: 1 }];
        await spawnEnemyRange(harness, navigationSource, position, 0, 1);
        const beforeCount = harness.objectSystem.getWorldRegistry()
            .getActiveCount('enemy');
        const beforeCooldown = slotView(
            harness.wordSystem,
            ABILITY_SLOT_ID.E
        ).cooldown.nextEligibleFixedTick;
        const cast = await activateSlot(harness, ABILITY_SLOT_ID.E);
        const afterCount = harness.objectSystem.getWorldRegistry()
            .getActiveCount('enemy');
        const reason = cast.materializer.reason;
        assert(cast.outcome.code
                === ABILITY_EXECUTION_OUTCOME_CODE.PLACEMENT_REJECTED
            && cast.outcome.generatedCount === 0
            && beforeCount === 1
            && afterCount === 1
            && cast.cooldownConsumed === false
            && cast.afterNextEligibleFixedTick === beforeCooldown
            && reason?.code === 'NO_VALID_GLOBAL_PLACEMENT'
            && reason.firstFailingRank === 0
            && reason.attemptedCandidateCount === 142
            && reason.candidateRound === 8
            && typeof reason.failureClass === 'string'
            && reason.failureClass !== 'NONE',
        `impossible placement reject 불일치: ${JSON.stringify({ cast, beforeCount, afterCount, reason })}`);
        const health = finalHealthAudit(harness);
        assert(health.restartCountDelta === 0
            && health.sessionGenerationDelta === 0
            && health.recoveryRequired === false
            && health.registryReservedCount === 0
            && health.pendingCommandCount === 0,
        `impossible placement final audit 실패: ${JSON.stringify(health)}`);
        return Object.freeze({
            subjectCount: cast.outcome.subjectCount,
            generatedCount: cast.outcome.generatedCount,
            activeBefore: beforeCount,
            activeAfter: afterCount,
            cooldownConsumed: cast.cooldownConsumed,
            reason,
            health
        });
    } finally {
        await destroyHarness(harness);
    }
}

async function readBodies(harness) {
    const simulation = harness.objectSystem.getEnemySimulationBackend()?.simulation;
    assert(simulation && typeof simulation.readbackBodies === 'function',
        'production body diagnostic readback이 없습니다.');
    const promise = simulation.readbackBodies();
    await simulation.device.queue.onSubmittedWorkDone();
    return promise;
}

async function forceGpuWorldReplacement(harness, label) {
    const beforeEndpoint = harness.objectSystem.getGpuSimulationEndpoint();
    const beforeEndpointStatus = beforeEndpoint.getStatus();
    const beforeGpu = harness.objectSystem.getEnemySimulationBackend()
        ?.getStatus?.()?.gpu ?? null;
    const beforeFactoryCount = harness.getBackendFactoryCount();
    const replaced = harness.objectSystem.restartGpuWorldAtSafeWaveBoundary();
    assert(replaced === true,
        `${label} GPU-world replacement가 거부됐습니다.`);
    harness.endpoint = harness.objectSystem.getGpuSimulationEndpoint();
    const replacementStatus = harness.endpoint.getStatus();
    const replacementGpu = harness.objectSystem.getEnemySimulationBackend()
        ?.getStatus?.()?.gpu ?? null;
    assert(harness.endpoint !== beforeEndpoint
        && harness.getBackendFactoryCount() === beforeFactoryCount + 1
        && replacementStatus.sessionGeneration
            === beforeEndpointStatus.sessionGeneration + 1,
    `${label} replacement identity 불일치: ${JSON.stringify({ beforeEndpointStatus, beforeGpu, replacementStatus, replacementGpu, beforeFactoryCount, afterFactoryCount: harness.getBackendFactoryCount() })}`);

    await advanceFixedTick(harness, harness.fixedTick + 1);
    const probation = harness.objectSystem.getGpuRecoveryStatus().probation;
    const settledGpu = harness.objectSystem.getEnemySimulationBackend()
        ?.getStatus?.()?.gpu ?? null;
    assert(probation?.state === 'PASSED'
        && settledGpu?.deviceGeneration === beforeGpu?.deviceGeneration
        && settledGpu?.overflow?.lastSmallCount === 0
        && settledGpu?.overflow?.lastBigCount === 0
        && harness.objectSystem.isGpuWorldRecoveryRequired() === false,
    `${label} replacement probation 실패: ${JSON.stringify({ probation, settledGpu })}`);
    return Object.freeze({
        label,
        forcedReplacementCount: 1,
        beforeSessionGeneration: beforeEndpointStatus.sessionGeneration,
        afterSessionGeneration: replacementStatus.sessionGeneration,
        sessionGenerationDelta:
            replacementStatus.sessionGeneration
                - beforeEndpointStatus.sessionGeneration,
        deviceGeneration: settledGpu.deviceGeneration,
        deviceGenerationDelta:
            settledGpu.deviceGeneration - beforeGpu.deviceGeneration,
        probation,
        baseline: Object.freeze({
            backendFactoryCount: harness.getBackendFactoryCount(),
            sessionGeneration: replacementStatus.sessionGeneration
        })
    });
}

async function auditProductionGrid(
    harness,
    expectedTowerCount,
    label,
    options = {}
) {
    const requireMinimumSeparation
        = options.requireMinimumSeparation === true;
    const backend = harness.objectSystem.getEnemySimulationBackend();
    const descriptor = backend?.getSpawnAdmissionGridDescriptor?.() ?? null;
    assert(descriptor, `${label} production grid descriptor가 없습니다.`);
    const bodies = await readBodies(harness);
    const counterOccupancy = new Map();
    for (const body of bodies) {
        const footprint = getGpuCollisionGridFootprint(
            body.position,
            body.radius,
            descriptor
        );
        assert(footprint.valid,
            `${label} body grid footprint가 invalid입니다: ${JSON.stringify(body)}`);
        for (const counterIndex of footprint.counterIndices) {
            counterOccupancy.set(
                counterIndex,
                (counterOccupancy.get(counterIndex) ?? 0) + 1
            );
        }
    }
    const maximumCellOccupancy = Math.max(
        0,
        ...counterOccupancy.values()
    );
    const registry = harness.objectSystem.getWorldRegistry();
    const towerHandles = registry.copyActiveHandlesInto([], {
        kindId: 'tower'
    });
    const towerBodies = towerHandles.map((handle) => (
        findBody(bodies, handle, `${label} Tower`)
    ));
    assert(towerBodies.length === expectedTowerCount,
        `${label} Tower count 불일치: ${towerBodies.length}/${expectedTowerCount}`);
    const tileMap = harness.objectSystem.getTileMap();
    const endpoint = harness.objectSystem.getGpuSimulationEndpoint();
    const positionKeys = new Set();
    const airborneHandles = new Set(towerBodies
        .filter((body) => endpoint.isActorTransitAirborne?.(body.handle) === true)
        .map((body) => `${body.handle.entityId}:${body.handle.incarnation}`));
    let minimumSurfaceGap = Infinity;
    let minimumSurfaceGapPair = null;
    for (let index = 0; index < towerBodies.length; index++) {
        const body = towerBodies[index];
        assert(Number.isFinite(body.position.x)
            && Number.isFinite(body.position.y),
        `${label} Tower position이 finite가 아닙니다.`);
        const tile = tileMap.worldToTile(
            body.position.x,
            body.position.y,
            {}
        );
        assert(tile.inside
            && tileMap.isWalkableTile(tile.row, tile.column),
        `${label} Tower center가 walkable하지 않습니다: ${JSON.stringify({ body, tile })}`);
        positionKeys.add(`${body.position.x}:${body.position.y}`);
        for (let otherIndex = 0; otherIndex < index; otherIndex++) {
            const other = towerBodies[otherIndex];
            if (airborneHandles.has(
                `${body.handle.entityId}:${body.handle.incarnation}`
            ) || airborneHandles.has(
                `${other.handle.entityId}:${other.handle.incarnation}`
            )) {
                continue;
            }
            const surfaceGap = Math.hypot(
                body.position.x - other.position.x,
                body.position.y - other.position.y
            ) - body.radius - other.radius;
            if (surfaceGap < minimumSurfaceGap) {
                minimumSurfaceGap = surfaceGap;
                minimumSurfaceGapPair = Object.freeze({
                    left: Object.freeze({
                        handle: body.handle,
                        position: body.position,
                        velocity: body.velocity,
                        radius: body.radius
                    }),
                    right: Object.freeze({
                        handle: other.handle,
                        position: other.position,
                        velocity: other.velocity,
                        radius: other.radius
                    })
                });
            }
        }
    }
    const gpu = backend.getStatus().gpu;
    const overflow = gpu.overflow;
    const minimumSurfaceGapPairWithRegistry = minimumSurfaceGapPair === null
        ? null
        : Object.freeze(Object.fromEntries(
            Object.entries(minimumSurfaceGapPair).map(([side, body]) => {
                const view = registry.copyEntityView(body.handle, {});
                const towerRecord = harness.towerGroupState.getTowerRecords()
                    .find((record) => sameHandle(
                        record.exactGpuBinding,
                        body.handle
                    ));
                return [side, Object.freeze({
                    ...body,
                    registry: Object.freeze({
                        logicalTowerOrdinal: view.logicalTowerOrdinal,
                        sourceExecutionOrdinal: view.sourceExecutionOrdinal,
                        actorActionCode: view.actorActionCode,
                        towerGroupRevision: view.towerGroupRevision
                    }),
                    roster: towerRecord ? Object.freeze({
                        logicalTowerOrdinal: towerRecord.logicalTowerOrdinal,
                        recoveryPosition:
                            towerRecord.recoverySpawnDescriptor?.position ?? null,
                        recoveryAnchor:
                            towerRecord.recoverySpawnDescriptor?.anchorPosition ?? null
                    }) : null
                })];
            })
        ));
    assert(positionKeys.size === expectedTowerCount
        && (!requireMinimumSeparation || minimumSurfaceGap >= -0.0001)
        && maximumCellOccupancy <= descriptor.maxBodiesPerCell
        && overflow.totalSmallCount === 0
        && overflow.totalBigCount === 0,
    `${label} recovery grid audit 실패: ${JSON.stringify({ expectedTowerCount, distinctPositionCount: positionKeys.size, airborneTowerCount: airborneHandles.size, requireMinimumSeparation, minimumSurfaceGap, minimumSurfaceGapPair: minimumSurfaceGapPairWithRegistry, maximumCellOccupancy, descriptor, overflow })}`);
    return Object.freeze({
        towerCount: towerBodies.length,
        distinctPositionCount: positionKeys.size,
        airborneTowerCount: airborneHandles.size,
        allFinite: true,
        allCenterWalkable: true,
        minimumSurfaceGap: Number.isFinite(minimumSurfaceGap)
            ? minimumSurfaceGap
            : null,
        maximumCellOccupancy,
        maxBodiesPerCell: descriptor.maxBodiesPerCell,
        gridOverflowCount:
            overflow.totalSmallCount + overflow.totalBigCount,
        gridAuthority: 'production-collision-grid-descriptor'
    });
}

async function ensureControlledEnemyCount(
    harness,
    navigationSource,
    targetCount,
    label
) {
    const registry = harness.objectSystem.getWorldRegistry();
    let handles = registry.copyActiveHandlesInto([], { kindId: 'enemy' });
    handles.sort((left, right) => (
        left.entityId - right.entityId || left.incarnation - right.incarnation
    ));
    if (handles.length > targetCount) {
        const targetFixedTick = harness.fixedTick + 1;
        for (const handle of handles.slice(targetCount)) {
            const receipt = harness.endpoint.requestDespawn(
                handle,
                `${label}-density-trim`,
                targetFixedTick,
                `${label}:trim:${handle.entityId}:${handle.incarnation}`
            );
            assert(receipt.accepted === true,
                `${label} Enemy trim이 거부됐습니다.`);
        }
        await advanceFixedTick(harness, targetFixedTick);
        handles = registry.copyActiveHandlesInto([], { kindId: 'enemy' });
    }
    if (handles.length < targetCount) {
        const bodies = await readBodies(harness);
        const occupied = bodies.map((body) => Object.freeze({
            x: body.position.x,
            y: body.position.y,
            radius: body.radius
        }));
        const positions = [];
        const bounds = navigationSource.getWorldBounds();
        for (let row = Math.ceil(bounds.minY) + 2;
            row < Math.floor(bounds.maxY) - 2
                && positions.length < targetCount - handles.length;
            row += 2) {
            for (let column = Math.ceil(bounds.minX) + 2;
                column < Math.floor(bounds.maxX) - 2
                    && positions.length < targetCount - handles.length;
                column += 2) {
                if (!navigationSource.isWalkableTile(row, column)) continue;
                const candidate = Object.freeze({
                    x: column + 0.5,
                    y: row + 0.5
                });
                const blocked = [...occupied, ...positions].some((other) => (
                    Math.hypot(
                        candidate.x - other.x,
                        candidate.y - other.y
                    ) < 1.25 + (other.radius ?? 0.2)
                ));
                if (!blocked) positions.push(candidate);
            }
        }
        const missing = targetCount - handles.length;
        assert(positions.length === missing,
            `${label} controlled Enemy 위치 부족: ${positions.length}/${missing}`);
        const targetFixedTick = harness.fixedTick + 1;
        const requests = positions.map((position, index) => Object.freeze({
            intent: createEnemyIntent(
                navigationSource,
                harness.nextSpawnSequence++,
                position,
                { radius: 0.2, direction: index % 2 === 0 ? 1 : -1 }
            ),
            targetFixedTick,
            commandId: `${label}:spawn:${harness.nextCommandSequence++}`
        }));
        const receipt = harness.endpoint.requestSpawnBatch(requests);
        assert(receipt.accepted === true
            && receipt.queuedCount === requests.length,
        `${label} controlled Enemy spawn 실패: ${JSON.stringify(receipt)}`);
        await advanceFixedTick(harness, targetFixedTick);
    }
    const finalCount = registry.getActiveCount('enemy');
    assert(finalCount === targetCount,
        `${label} controlled Enemy count 불일치: ${finalCount}/${targetCount}`);
    return finalCount;
}

async function advanceSettlingTicks(harness, count, label) {
    const startTick = harness.fixedTick;
    for (let index = 0; index < count; index++) {
        await advanceFixedTick(harness, harness.fixedTick + 1);
    }
    return Object.freeze({
        label,
        startTick,
        endTick: harness.fixedTick,
        advancedTickCount: harness.fixedTick - startTick
    });
}

function findBody(bodies, handle, label) {
    const body = bodies.find((candidate) => sameHandle(candidate.handle, handle));
    assert(body, `${label} body가 없습니다: ${JSON.stringify(handle)}`);
    return body;
}

function findControlledArrow(bodies, registry, expectedPosition) {
    const handles = [];
    registry.copyActiveHandlesInto(handles, { kindId: 'enemy' });
    const arrowHandles = handles.filter((handle) => (
        registry.copyEntityView(handle, {}).definitionId
            === BASIC_ARROW_ENEMY_DATA.id
    ));
    const arrows = arrowHandles.map((handle) => (
        bodies.find((body) => sameHandle(body.handle, handle))
    )).filter(Boolean);
    arrows.sort((left, right) => (
        Math.hypot(
            left.position.x - expectedPosition.x,
            left.position.y - expectedPosition.y
        ) - Math.hypot(
            right.position.x - expectedPosition.x,
            right.position.y - expectedPosition.y
        )
    ));
    const arrow = arrows[0];
    assert(arrow, 'controlled Arrow body가 없습니다.');
    return arrow;
}

async function runActualR2Fixture(device, format) {
    const harness = createHarness(device, format, {
        tileNavigationSource: new TileMap(R2_ENEMY_SHOWCASE_MAP_DATA),
        waveDefinition: R2_ENEMY_SHOWCASE_WAVE_01_DATA,
        enemyWaveEnabled: true,
        gameplayWorldActorsEnabled: true
    });
    const abilityCasts = [];
    try {
        const tileMap = harness.objectSystem.getTileMap();
        const towerSpawn = tileMap.getTowerSpawnPosition();
        const route = tileMap.getSpawnRoutes()[0];
        const seedReceipt = harness.endpoint.requestSpawn(
            Object.freeze({
                ...createGpuEnemySpawnIntent({
                    definition: BASIC_CIRCLE_ENEMY_DATA,
                    route,
                    spawnSequence: 4_000_000,
                    waveId: 'post-r5-live-seed',
                    policyId: 'post-r5-controlled-fixture'
                }),
                position: Object.freeze({
                    x: towerSpawn.x - 8,
                    y: towerSpawn.y
                })
            }),
            1,
            'post-r5-live:controlled-seed'
        );
        assert(seedReceipt.accepted === true,
            `controlled seed spawn 요청 실패: ${JSON.stringify(seedReceipt)}`);
        await advanceFixedTick(harness, 1);

        const executeAndRecord = async (slotId, phase) => {
            const cast = await activateSlot(harness, slotId);
            assert(cast.outcome.code === ABILITY_EXECUTION_OUTCOME_CODE.COMPLETED
                && cast.outcome.generatedCount > 0
                && cast.cooldownConsumed === true,
            `${slotId} actual R2 execution 실패: ${JSON.stringify({
                cast,
                towerCreation: harness.objectSystem.getTowerCreationStatus(),
                towerGroup: harness.objectSystem.getTowerGroupStatus?.() ?? null
            })}`);
            abilityCasts.push(Object.freeze({
                phase,
                slotId,
                abilityRequestId: cast.activation.abilityRequestId,
                executionId: cast.outcome.executionId,
                subjectCount: cast.outcome.subjectCount,
                generatedCount: cast.outcome.generatedCount,
                code: cast.outcome.code,
                cooldownConsumed: cast.cooldownConsumed,
                materializerState: cast.materializer.state,
                placement: cast.materializer.placement
            }));
            return cast;
        };

        for (let execution = 1; execution <= 3; execution++) {
            await executeAndRecord(ABILITY_SLOT_ID.E, `pre-replacement:E${execution}`);
        }

        const registry = harness.objectSystem.getWorldRegistry();
        const activeEnemyHandles = registry.copyActiveHandlesInto([], {
            kindId: 'enemy'
        });
        const waveChurn = Object.freeze({
            fixedTick: harness.fixedTick,
            activeEnemyCount: activeEnemyHandles.length,
            waveStatus: harness.objectSystem.getEnemyWaveStatus()
        });
        harness.objectSystem.waveDirector?.destroy();
        harness.objectSystem.waveDirector = null;
        harness.objectSystem.enemyWaveEnabled = false;
        await ensureControlledEnemyCount(
            harness,
            tileMap,
            36,
            'post-r5-pre-replacement-density'
        );
        await executeAndRecord(
            ABILITY_SLOT_ID.SHIFT,
            'pre-replacement:SHIFT-1-to-2'
        );
        await executeAndRecord(
            ABILITY_SLOT_ID.SPACE,
            'pre-replacement:SPACE-36'
        );
        await executeAndRecord(
            ABILITY_SLOT_ID.SHIFT,
            'pre-replacement:SHIFT-38-to-76'
        );
        const towerCountBeforeReplacement = harness.towerGroupState
            .getStatus().livingTowerCount;
        assert(towerCountBeforeReplacement === 76,
            `replacement 전 Tower 76 준비 실패: ${towerCountBeforeReplacement}`);
        const preReplacementHealth = finalHealthAudit(harness);
        assert(preReplacementHealth.restartCountDelta === 0
            && preReplacementHealth.sessionGenerationDelta === 0
            && preReplacementHealth.gridOverflowCount === 0
            && preReplacementHealth.recoveryRequired === false,
        `replacement 전 health 실패: ${JSON.stringify(preReplacementHealth)}`);

        const replacement = await forceGpuWorldReplacement(
            harness,
            'post-r5-live-76-tower'
        );
        const recoveryGrid = await auditProductionGrid(
            harness,
            towerCountBeforeReplacement,
            'post-r5-live-76-tower',
            { requireMinimumSeparation: true }
        );

        await ensureControlledEnemyCount(
            harness,
            tileMap,
            4,
            'post-r5-post-replacement-density'
        );
        await executeAndRecord(
            ABILITY_SLOT_ID.SHIFT,
            'post-replacement:SHIFT'
        );
        await auditProductionGrid(
            harness,
            152,
            'post-r5-live-after-post-replacement-SHIFT'
        );
        await executeAndRecord(
            ABILITY_SLOT_ID.SPACE,
            'post-replacement:SPACE'
        );
        await auditProductionGrid(
            harness,
            156,
            'post-r5-live-after-post-replacement-SPACE'
        );
        await executeAndRecord(
            ABILITY_SLOT_ID.E,
            'post-replacement:E'
        );
        const postReplacementTowerCount = harness.towerGroupState
            .getStatus().livingTowerCount;
        assert(postReplacementTowerCount === 156,
            `replacement 후 Tower count 불일치: ${postReplacementTowerCount}`);

        const longRun = await advanceSettlingTicks(
            harness,
            300,
            'post-r5-live-long-run'
        );
        const finalGrid = await auditProductionGrid(
            harness,
            postReplacementTowerCount,
            'post-r5-live-final'
        );
        const towerStatus = harness.towerGroupState.getStatus();
        const health = finalHealthAudit(harness, replacement.baseline);
        const eCasts = abilityCasts.filter(({ slotId }) => (
            slotId === ABILITY_SLOT_ID.E
        ));
        const shiftCasts = abilityCasts.filter(({ slotId }) => (
            slotId === ABILITY_SLOT_ID.SHIFT
        ));
        const spaceCasts = abilityCasts.filter(({ slotId }) => (
            slotId === ABILITY_SLOT_ID.SPACE
        ));
        assert(eCasts.length === 4
            && eCasts.every(({ generatedCount }) => generatedCount > 0)
            && shiftCasts.length === 3
            && spaceCasts.length === 2
            && harness.stageReceiptEvidence.length >= 5
            && replacement.sessionGenerationDelta === 1
            && replacement.deviceGenerationDelta === 0
            && replacement.probation.state === 'PASSED'
            && recoveryGrid.towerCount === 76
            && recoveryGrid.gridOverflowCount === 0
            && finalGrid.towerCount === 156
            && finalGrid.gridOverflowCount === 0
            && longRun.advancedTickCount === 300
            && health.restartCountDelta === 0
            && health.sessionGenerationDelta === 0
            && health.gridOverflowCount === 0
            && health.gridOverflowLast.small === 0
            && health.gridOverflowLast.big === 0
            && health.recoveryRequired === false
            && health.recoveryCauseStage === null
            && health.materializerRecoveryRequired === false
            && health.towerProtocolFailureCount === 0
            && health.projectileCaptureRecoveryRequired === false
            && health.projectileCaptureFailure === null
            && health.registryReservedCount === 0
            && health.pendingCommandCount === 0
            && health.materializerInFlightCount === 0
            && health.towerActiveTransactionCount === 0
            && health.storageMaximum <= REQUIRED_STORAGE_BUFFER_LIMIT
            && towerStatus.livingShareUnits + towerStatus.lostShareUnits
                === towerStatus.fullShareUnits
            && harness.towerGroupState.auditInvariants().valid === true,
        `actual R2 final audit 실패: ${JSON.stringify({ abilityCasts, health, towerStatus })}`);
        return Object.freeze({
            mapId: tileMap.mapId,
            waveId: R2_ENEMY_SHOWCASE_WAVE_01_DATA.waveId,
            finalFixedTick: harness.fixedTick,
            waveChurn,
            abilityCasts: Object.freeze(abilityCasts),
            stageReceiptEvidence: Object.freeze(harness.stageReceiptEvidence),
            towerCountBeforeReplacement,
            postReplacementTowerCount,
            preReplacementHealth,
            replacement,
            recoveryGrid,
            finalGrid,
            longRun,
            towerShare: Object.freeze({
                fullShareUnits: towerStatus.fullShareUnits,
                livingShareUnits: towerStatus.livingShareUnits,
                lostShareUnits: towerStatus.lostShareUnits,
                invariantViolationCount:
                    harness.towerGroupState.auditInvariants().violations.length
            }),
            health
        });
    } finally {
        await destroyHarness(harness);
    }
}

async function runTower256RecoveryFixture(device, format) {
    const harness = createHarness(device, format, {
        tileNavigationSource: new TileMap(R2_ENEMY_SHOWCASE_MAP_DATA),
        enemyWaveEnabled: false,
        gameplayWorldActorsEnabled: true
    });
    const casts = [];
    try {
        while (harness.towerGroupState.getStatus().livingTowerCount < 256) {
            const cast = await activateSlot(harness, ABILITY_SLOT_ID.SHIFT);
            assert(cast.outcome.code === ABILITY_EXECUTION_OUTCOME_CODE.COMPLETED
                && cast.outcome.generatedCount === cast.outcome.subjectCount
                && cast.cooldownConsumed === true,
            `Tower 256 준비 SHIFT 실패: ${JSON.stringify(cast)}`);
            casts.push(Object.freeze({
                subjectCount: cast.outcome.subjectCount,
                generatedCount: cast.outcome.generatedCount,
                towerCount: harness.towerGroupState
                    .getStatus().livingTowerCount
            }));
        }
        assert(casts.map(({ towerCount }) => towerCount).join(',')
            === '2,4,8,16,32,64,128,256',
        `Tower 256 doubling 불일치: ${JSON.stringify(casts)}`);

        const replacement = await forceGpuWorldReplacement(
            harness,
            'post-r5-live-256-tower'
        );
        const recoveryGrid = await auditProductionGrid(
            harness,
            256,
            'post-r5-live-256-tower',
            { requireMinimumSeparation: true }
        );
        const longRun = await advanceSettlingTicks(
            harness,
            180,
            'post-r5-live-256-tower-long-run'
        );
        const finalGrid = await auditProductionGrid(
            harness,
            256,
            'post-r5-live-256-tower-final'
        );
        const health = finalHealthAudit(harness, replacement.baseline);
        const towerStatus = harness.towerGroupState.getStatus();
        assert(replacement.probation.state === 'PASSED'
            && replacement.deviceGenerationDelta === 0
            && recoveryGrid.distinctPositionCount === 256
            && recoveryGrid.gridOverflowCount === 0
            && finalGrid.gridOverflowCount === 0
            && longRun.advancedTickCount === 180
            && health.restartCountDelta === 0
            && health.sessionGenerationDelta === 0
            && health.gridOverflowCount === 0
            && health.recoveryRequired === false
            && health.recoveryCauseStage === null
            && health.projectileCaptureRecoveryRequired === false
            && health.projectileCaptureFailure === null
            && health.registryReservedCount === 0
            && health.pendingCommandCount === 0
            && health.materializerInFlightCount === 0
            && health.towerActiveTransactionCount === 0
            && health.storageMaximum <= REQUIRED_STORAGE_BUFFER_LIMIT
            && towerStatus.livingTowerCount === 256
            && towerStatus.livingShareUnits + towerStatus.lostShareUnits
                === towerStatus.fullShareUnits
            && harness.towerGroupState.auditInvariants().valid === true,
        `Tower 256 recovery audit 실패: ${JSON.stringify({ replacement, recoveryGrid, finalGrid, longRun, health, towerStatus })}`);
        return Object.freeze({
            mapId: harness.objectSystem.getTileMap().mapId,
            casts: Object.freeze(casts),
            replacement,
            recoveryGrid,
            finalGrid,
            longRun,
            towerShare: Object.freeze({
                fullShareUnits: towerStatus.fullShareUnits,
                livingShareUnits: towerStatus.livingShareUnits,
                lostShareUnits: towerStatus.lostShareUnits,
                invariantViolationCount:
                    harness.towerGroupState.auditInvariants().violations.length
            }),
            health
        });
    } finally {
        await destroyHarness(harness);
    }
}

async function runArrowR2Fixture(device, format) {
    const harness = createHarness(device, format, {
        tileNavigationSource: new TileMap(R2_ENEMY_SHOWCASE_MAP_DATA),
        enemyWaveEnabled: false,
        gameplayWorldActorsEnabled: true
    });
    const chargeSamples = [];
    const recoilSamples = [];
    const contactEvents = new Map();
    const damageEvents = [];
    let lockedDirection = null;
    let movedTower = false;
    let stoppedTower = false;
    let towerPositionBeforeMove = null;
    let towerPositionAfterMove = null;
    let sawWindup = false;
    let sawRecover = false;
    let sawRearm = false;
    let contactTick = null;
    let impactEvidence = null;
    let exactOnceEvidence = null;
    try {
        const tileMap = harness.objectSystem.getTileMap();
        const towerSpawn = tileMap.getTowerSpawnPosition();
        const route = tileMap.getSpawnRoutes()[0];
        const arrowPosition = Object.freeze({
            x: towerSpawn.x - 2.7,
            y: towerSpawn.y
        });
        const arrowReceipt = harness.endpoint.requestSpawn(
            Object.freeze({
                ...createGpuEnemySpawnIntent({
                    definition: BASIC_ARROW_ENEMY_DATA,
                    route,
                    spawnSequence: 4_100_000,
                    waveId: 'post-r5-live-arrow',
                    policyId: 'post-r5-controlled-fixture'
                }),
                position: arrowPosition
            }),
            1,
            'post-r5-live:controlled-arrow'
        );
        assert(arrowReceipt.accepted === true,
            `controlled Arrow spawn 요청 실패: ${JSON.stringify(arrowReceipt)}`);
        await advanceFixedTick(harness, 1);

        let bodies = await readBodies(harness);
        const controlledArrow = findControlledArrow(
            bodies,
            harness.objectSystem.getWorldRegistry(),
            arrowPosition
        );
        const arrowHandle = Object.freeze({ ...controlledArrow.handle });
        const towerHandle = harness.objectSystem.getTower().getGpuBodyHandle();
        assert(towerHandle, 'production Tower handle이 없습니다.');
        let previousArrow = findBody(bodies, arrowHandle, 'pre-motion Arrow');
        let previousTower = findBody(bodies, towerHandle, 'pre-motion Tower');

        for (let step = 0; step < 360 && !sawRearm; step++) {
            if (chargeSamples.length === 1 && !movedTower) {
                const towerBody = findBody(
                    await readBodies(harness),
                    towerHandle,
                    'pre-move Tower'
                );
                towerPositionBeforeMove = Object.freeze({ ...towerBody.position });
                harness.objectSystem.getTower().handlePlayerAction({
                    type: PLAYER_ACTION_TYPES.MOVE_VECTOR,
                    payload: { x: 0, y: 1 }
                });
                movedTower = true;
            } else if (chargeSamples.length >= 2
                && movedTower && !stoppedTower) {
                harness.objectSystem.getTower().handlePlayerAction({
                    type: PLAYER_ACTION_TYPES.MOVE_VECTOR,
                    payload: { x: 0, y: 0 }
                });
                stoppedTower = true;
            }

            await advanceFixedTick(harness, harness.fixedTick + 1);
            const completed = harness.objectSystem.getLastCompletedGpuEvents();
            for (const event of completed?.contactEvents ?? []) {
                if (event.eventType === 'enemy-charge-contact-recoil-started'
                    && sameHandle(event, arrowHandle)) {
                    contactEvents.set(event.key, event);
                }
                if (event.eventType === 'damage-applied'
                    && sameHandle(event, arrowHandle)
                    && event.otherEntityId === towerHandle.entityId
                    && event.otherIncarnation === towerHandle.incarnation) {
                    damageEvents.push(event);
                }
            }
            bodies = await readBodies(harness);
            const arrow = findBody(bodies, arrowHandle, 'motion Arrow');
            const tower = findBody(bodies, towerHandle, 'motion Tower');
            const behavior = arrow.enemyBehaviorState;

            if (impactEvidence && exactOnceEvidence === null
                && harness.fixedTick === impactEvidence.tick + 1) {
                const ordinaryArrowVelocity = Object.freeze({
                    x: (arrow.position.x - arrow.previousPosition.x)
                        / FIXED_DELTA,
                    y: (arrow.position.y - arrow.previousPosition.y)
                        / FIXED_DELTA
                });
                const ordinaryTowerVelocity = Object.freeze({
                    x: (tower.position.x - tower.previousPosition.x)
                        / FIXED_DELTA,
                    y: (tower.position.y - tower.previousPosition.y)
                        / FIXED_DELTA
                });
                const arrowCustomDelta = Object.freeze({
                    x: arrow.velocity.x - ordinaryArrowVelocity.x,
                    y: arrow.velocity.y - ordinaryArrowVelocity.y
                });
                const towerCustomDelta = Object.freeze({
                    x: tower.velocity.x - ordinaryTowerVelocity.x,
                    y: tower.velocity.y - ordinaryTowerVelocity.y
                });
                const duplicateEvent = contactEvents.size > 1
                    || (completed?.contactEvents ?? []).some((event) => (
                        event.eventType
                            === 'enemy-charge-contact-recoil-started'
                        && sameHandle(event, arrowHandle)
                        && event.sourceTick !== impactEvidence.tick
                    ));
                assert(Math.hypot(
                    arrowCustomDelta.x,
                    arrowCustomDelta.y
                ) <= 0.0001
                    && Math.hypot(
                        towerCustomDelta.x,
                        towerCustomDelta.y
                    ) <= 0.0001
                    && duplicateEvent === false,
                `Arrow impact impulse가 다음 tick에 중복 적용됐습니다: ${JSON.stringify({ arrowCustomDelta, towerCustomDelta, completed })}`);
                exactOnceEvidence = Object.freeze({
                    tick: harness.fixedTick,
                    arrowCustomDelta,
                    towerCustomDelta,
                    duplicateEvent
                });
            }

            if (behavior.state === GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.WINDUP) {
                if (sawRecover) {
                    sawRearm = true;
                } else {
                    sawWindup = true;
                }
            } else if (behavior.state
                === GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.CHARGE) {
                if (lockedDirection === null) {
                    lockedDirection = Object.freeze({
                        ...behavior.chargeDirection
                    });
                    near(Math.hypot(lockedDirection.x, lockedDirection.y),
                        1, 0.0001, 'Arrow locked direction');
                }
                near(behavior.chargeDirection.x, lockedDirection.x,
                    0.000001, 'Arrow locked direction x');
                near(behavior.chargeDirection.y, lockedDirection.y,
                    0.000001, 'Arrow locked direction y');
                near(behavior.chargeSpeedTilesPerSecond,
                    ARROW_CHARGE_CONFIG.chargeSpeedTilesPerSecond,
                    0.000001, 'Arrow authored direct speed');
                assert(behavior.chargeAccelerationTilesPerSecondSquared
                    === undefined,
                `Arrow acceleration field가 남아 있습니다: ${JSON.stringify(behavior)}`);
                const forwardSpeed = (arrow.velocity.x * lockedDirection.x)
                    + (arrow.velocity.y * lockedDirection.y);
                const deltaX = arrow.position.x - previousArrow.position.x;
                const deltaY = arrow.position.y - previousArrow.position.y;
                chargeSamples.push(Object.freeze({
                    tick: harness.fixedTick,
                    speed: Math.hypot(arrow.velocity.x, arrow.velocity.y),
                    forwardSpeed,
                    displacement: (deltaX * lockedDirection.x)
                        + (deltaY * lockedDirection.y),
                    direction: Object.freeze({ ...behavior.chargeDirection }),
                    position: Object.freeze({ ...arrow.position })
                }));
            } else if (behavior.state
                === GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.CONTACT_RECOIL) {
                recoilSamples.push(Object.freeze({
                    tick: harness.fixedTick,
                    speed: Math.hypot(arrow.velocity.x, arrow.velocity.y),
                    velocity: Object.freeze({ ...arrow.velocity })
                }));
                if (impactEvidence === null) {
                    contactTick = harness.fixedTick;
                    const preImpactArrowVelocity = Object.freeze({
                        ...previousArrow.velocity
                    });
                    const preImpactTowerVelocity = Object.freeze({
                        ...previousTower.velocity
                    });
                    const predictedArrowPosition = Object.freeze({
                        x: arrow.previousPosition.x
                            + preImpactArrowVelocity.x * FIXED_DELTA,
                        y: arrow.previousPosition.y
                            + preImpactArrowVelocity.y * FIXED_DELTA
                    });
                    const predictedTowerPosition = Object.freeze({
                        x: tower.previousPosition.x
                            + preImpactTowerVelocity.x * FIXED_DELTA,
                        y: tower.previousPosition.y
                            + preImpactTowerVelocity.y * FIXED_DELTA
                    });
                    const impactOracle = resolveArrowImpactOracle({
                        arrowVelocity: preImpactArrowVelocity,
                        towerVelocity: preImpactTowerVelocity,
                        towerToArrowNormal: {
                            x: predictedArrowPosition.x
                                - predictedTowerPosition.x,
                            y: predictedArrowPosition.y
                                - predictedTowerPosition.y
                        },
                        arrowInverseMass: arrow.inverseMass,
                        towerInverseMass: tower.inverseMass,
                        restitution: behavior.impactRestitution,
                        tangentialRetention:
                            behavior.impactTangentialRetention,
                        sleepThreshold:
                            behavior.recoilSleepThresholdTilesPerSecond
                    });
                    const ordinaryArrowVelocity = Object.freeze({
                        x: (arrow.position.x - arrow.previousPosition.x)
                            / FIXED_DELTA,
                        y: (arrow.position.y - arrow.previousPosition.y)
                            / FIXED_DELTA
                    });
                    const ordinaryTowerVelocity = Object.freeze({
                        x: (tower.position.x - tower.previousPosition.x)
                            / FIXED_DELTA,
                        y: (tower.position.y - tower.previousPosition.y)
                            / FIXED_DELTA
                    });
                    const actualArrowVelocityDelta = Object.freeze({
                        x: arrow.velocity.x - ordinaryArrowVelocity.x,
                        y: arrow.velocity.y - ordinaryArrowVelocity.y
                    });
                    const actualTowerVelocityDelta = Object.freeze({
                        x: tower.velocity.x - ordinaryTowerVelocity.x,
                        y: tower.velocity.y - ordinaryTowerVelocity.y
                    });
                    const error = Math.max(
                        Math.abs(actualArrowVelocityDelta.x
                            - impactOracle.arrowVelocityDelta.x),
                        Math.abs(actualArrowVelocityDelta.y
                            - impactOracle.arrowVelocityDelta.y),
                        Math.abs(actualTowerVelocityDelta.x
                            - impactOracle.towerVelocityDelta.x),
                        Math.abs(actualTowerVelocityDelta.y
                            - impactOracle.towerVelocityDelta.y)
                    );
                    assert(error <= 0.005
                        && impactOracle.normalSpeed
                            < -behavior.recoilSleepThresholdTilesPerSecond
                        && (behavior.flags
                            & GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG.RECOIL_PENDING)
                            === 0,
                    `Arrow post-reconstruction impact oracle 불일치: ${JSON.stringify({ error, impactOracle, ordinaryArrowVelocity, ordinaryTowerVelocity, actualArrowVelocityDelta, actualTowerVelocityDelta, previousArrow, previousTower, arrow, tower })}`);
                    impactEvidence = Object.freeze({
                        tick: contactTick,
                        preImpactArrowVelocity,
                        preImpactTowerVelocity,
                        predictedArrowPosition,
                        predictedTowerPosition,
                        normal: impactOracle.normal,
                        relativeVelocity: impactOracle.relativeVelocity,
                        normalSpeed: impactOracle.normalSpeed,
                        arrowInverseMass: arrow.inverseMass,
                        towerInverseMass: tower.inverseMass,
                        restitution: behavior.impactRestitution,
                        tangentialRetention:
                            behavior.impactTangentialRetention,
                        expectedArrowVelocityDelta:
                            impactOracle.arrowVelocityDelta,
                        actualArrowVelocityDelta,
                        expectedTowerVelocityDelta:
                            impactOracle.towerVelocityDelta,
                        actualTowerVelocityDelta,
                        appliedAfterOrdinaryReconstruction: true,
                        error
                    });
                }
            } else if (behavior.state
                === GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.RECOVER) {
                sawRecover = true;
            }
            if (movedTower && towerPositionAfterMove === null) {
                if (towerPositionBeforeMove
                    && Math.hypot(
                        tower.position.x - towerPositionBeforeMove.x,
                        tower.position.y - towerPositionBeforeMove.y
                    ) > 0.0001) {
                    towerPositionAfterMove = Object.freeze({ ...tower.position });
                }
            }
            previousArrow = arrow;
            previousTower = tower;
        }

        assert(sawWindup
            && chargeSamples.length >= 4
            && recoilSamples.length >= 2
            && sawRecover
            && sawRearm
            && lockedDirection
            && movedTower
            && stoppedTower
            && towerPositionAfterMove
            && contactEvents.size === 1
            && damageEvents.length === 1
            && impactEvidence
            && exactOnceEvidence,
        `Arrow actual state sequence 불일치: ${JSON.stringify({ sawWindup, chargeSamples, recoilSamples, sawRecover, sawRearm, lockedDirection, movedTower, stoppedTower, towerPositionBeforeMove, towerPositionAfterMove, contactEvents: [...contactEvents.values()], damageEvents, impactEvidence, exactOnceEvidence })}`);
        for (const sample of chargeSamples) {
            near(sample.speed,
                ARROW_CHARGE_CONFIG.chargeSpeedTilesPerSecond,
                0.0001, `Arrow direct charge speed tick ${sample.tick}`);
            near(sample.forwardSpeed,
                ARROW_CHARGE_CONFIG.chargeSpeedTilesPerSecond,
                0.0001, `Arrow direct forward speed tick ${sample.tick}`);
        }
        const accelerationAccumulationMaximum = Math.max(
            ...chargeSamples.map((sample) => Math.abs(
                sample.speed - chargeSamples[0].speed
            ))
        );
        assert(accelerationAccumulationMaximum <= 0.0001,
            `Arrow CHARGE에서 speed 누적이 발생했습니다: ${JSON.stringify(chargeSamples)}`);
        for (let index = 1; index < recoilSamples.length; index++) {
            assert(recoilSamples[index].speed
                <= recoilSamples[index - 1].speed + 0.0001,
            `Arrow physical recoil damping이 감소하지 않습니다: ${JSON.stringify(recoilSamples)}`);
        }
        const observedFirstDampingRatio = recoilSamples[1].speed
            / recoilSamples[0].speed;
        near(observedFirstDampingRatio, ARROW_CHARGE_CONFIG.recoilDamping,
            0.02, 'Arrow data-owned recoil damping');
        const health = finalHealthAudit(harness);
        assert(health.restartCountDelta === 0
            && health.sessionGenerationDelta === 0
            && health.recoveryRequired === false
            && health.materializerRecoveryRequired === false
            && health.towerProtocolFailureCount === 0
            && health.registryReservedCount === 0
            && health.pendingCommandCount === 0
            && health.storageMaximum <= REQUIRED_STORAGE_BUFFER_LIMIT,
        `Arrow actual final audit 실패: ${JSON.stringify(health)}`);
        return Object.freeze({
            mapId: tileMap.mapId,
            finalFixedTick: harness.fixedTick,
            handle: arrowHandle,
            sawWindup,
            chargeSpeedTilesPerSecond:
                ARROW_CHARGE_CONFIG.chargeSpeedTilesPerSecond,
            accelerationAccumulationMaximum,
            chargeSamples: Object.freeze(chargeSamples),
            recoilSamples: Object.freeze(recoilSamples),
            contactEventCount: contactEvents.size,
            damageEventCount: damageEvents.length,
            impactEvidence,
            exactOnceEvidence,
            recoilDamping: Object.freeze({
                authored: ARROW_CHARGE_CONFIG.recoilDamping,
                observedFirstRatio: observedFirstDampingRatio,
                scriptedExpoOverwrite: false
            }),
            sawRecover,
            sawRearm,
            lockedDirection,
            targetMovedAfterLock: towerPositionAfterMove !== null,
            health
        });
    } finally {
        await destroyHarness(harness);
    }
}

async function run() {
    const result = {
        status: 'fail',
        runtime: {
            nw: process.versions.nw || '',
            chrome: process.versions.chrome || '',
            protocol: location.protocol,
            secureContext: isSecureContext
        }
    };
    let device = null;
    try {
        assert(resultPath, 'CIRVIVOR_WEBGPU_RESULT_PATH missing');
        assert(isSecureContext, `secure context required: ${location.protocol}`);
        assert(navigator.gpu, 'navigator.gpu unavailable');
        const adapter = await navigator.gpu.requestAdapter({
            powerPreference: 'high-performance'
        });
        assert(adapter, 'WebGPU adapter unavailable');
        assert(adapter.limits.maxStorageBuffersPerShaderStage
            >= REQUIRED_STORAGE_BUFFER_LIMIT,
        'WebGPU storage buffer limit below 9');
        device = await adapter.requestDevice({
            requiredLimits: {
                maxStorageBuffersPerShaderStage:
                    REQUIRED_STORAGE_BUFFER_LIMIT
            }
        });
        const uncapturedErrors = [];
        device.addEventListener('uncapturederror', (event) => {
            uncapturedErrors.push(event.error?.message ?? String(event.error));
        });
        const format = navigator.gpu.getPreferredCanvasFormat();

        checkpoint('post-r5:safe-placement');
        const safePlacement = await runSafePlacementFixture(device, format);
        checkpoint('post-r5:impossible-placement');
        const impossiblePlacement = await runImpossiblePlacementFixture(
            device,
            format
        );
        checkpoint('post-r5:actual-r2');
        const actualR2 = await runActualR2Fixture(device, format);
        checkpoint('post-r5:tower-256-recovery');
        const tower256Recovery = await runTower256RecoveryFixture(
            device,
            format
        );
        checkpoint('post-r5:actual-arrow');
        const actualArrow = await runArrowR2Fixture(device, format);

        await device.queue.onSubmittedWorkDone();
        result.postR5LiveBugfix = Object.freeze({
            scenario: 'post-r5-live-bugfix-production-ordering',
            safePlacement,
            impossiblePlacement,
            actualR2,
            tower256Recovery,
            actualArrow
        });
        result.uncapturedErrorCount = uncapturedErrors.length;
        assert(uncapturedErrors.length === 0,
            `uncaptured WebGPU error: ${uncapturedErrors.join(' | ')}`);
        const lostPromise = device.lost;
        device.destroy();
        const lost = await lostPromise;
        result.deviceLostReason = lost.reason;
        assert(lost.reason === 'destroyed',
            `device lost reason: ${lost.reason}`);
        result.status = 'pass';
    } catch (error) {
        result.error = error?.stack ?? String(error);
        try {
            device?.destroy();
        } catch {
            // Failure cleanup is best effort.
        }
    }
    require('node:fs').writeFileSync(
        resultPath,
        `${JSON.stringify(result, null, 2)}\n`,
        'utf8'
    );
    nw.App.quit();
}

run();
