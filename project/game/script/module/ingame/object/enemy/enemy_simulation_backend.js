import {
    GPU_BODY_PRESENTATION_PROFILE
} from '../../physics/gpu/gpu_body_presentation_clock.js';
import { GpuCircleBodySimulation } from '../../physics/gpu/gpu_circle_body_simulation.js';
import {
    createGpuSignedDistanceField
} from '../../physics/gpu/gpu_signed_distance_field.js';
import {
    createRouteFlowFieldAtlas
} from '../../navigation/route_flow_field_atlas.js';
import {
    GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
    GPU_EFFECT_RUNTIME_ABI_VERSION,
    GPU_EFFECT_TERMINAL_CANCEL_ABI_VERSION
} from '../../physics/gpu/gpu_effect_runtime_abi.js';
import {
    GPU_FORMATION_PREPARE_PROGRAM_ABI_VERSION,
    GPU_FORMATION_RUNTIME_ABI_VERSION,
    GPU_FORMATION_TERMINAL_CANCEL_ABI_VERSION,
    GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION
} from '../../physics/gpu/gpu_formation_runtime_abi.js';
import {
    GPU_ATOMIC_TRANSFORM_PREPARE_PROGRAM_ABI_VERSION,
    GPU_ATOMIC_TRANSFORM_PROGRAM_ABI_VERSION,
    GPU_ATOMIC_TRANSFORM_RUNTIME_ABI_VERSION,
    GPU_ATOMIC_TRANSFORM_TERMINAL_CANCEL_ABI_VERSION
} from '../../physics/gpu/gpu_atomic_transform_runtime_abi.js';
import {
    GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION,
    GPU_PROJECTILE_CAPTURE_TICK_STATUS
} from '../../physics/gpu/gpu_projectile_capture_runtime_abi.js';
import {
    GPU_PROJECTILE_CAPTURE_STORAGE_PROFILE
} from '../../physics/gpu/gpu_projectile_capture_runtime_shaders.js';
import {
    GPU_ROUTE_LIFECYCLE_ABI_VERSION,
    GPU_ROUTE_RUNTIME_ABI,
    GPU_ROUTE_RUNTIME_ABI_VERSION,
    GPU_ROUTE_RUNTIME_MAX_CLOSERS
} from '../../physics/gpu/gpu_route_runtime_abi.js';
import {
    GpuAbilitySubjectSnapshotRuntime
} from '../../physics/gpu/gpu_ability_subject_snapshot_runtime.js';
import {
    GpuActorPayloadMaterializationRuntime
} from '../../physics/gpu/gpu_actor_payload_materialization_runtime.js';
import {
    GPU_TOWER_GROUP_MEMBER_FLAG
} from '../../physics/gpu/gpu_tower_group_abi.js';
import {
    GpuTowerGroupRuntime
} from '../../physics/gpu/gpu_tower_group_runtime.js';
import {
    GPU_CIRCLE_BODY_ABI,
    GPU_CIRCLE_BODY_META,
    GPU_CIRCLE_BODY_SIMULATION_FLAG
} from '../../physics/gpu/gpu_circle_body_abi.js';
import {
    BASIC_CIRCLE_ENEMY_DATA
} from 'data/object/enemy/basic_circle_enemy_data.js';
import {
    createGpuEnemySpawnIntent
} from './gpu_enemy_spawn_adapter.js';

const SOURCE_GRID_TO_SDF_CELL_RATIO = 12 / 8;
const SOURCE_WORLD_UNIT_TO_SDF_CELL_RATIO = 1 / 8;
const DEFAULT_BODY_CAPACITY = 16384;
const DEFAULT_TOWER_GROUP_MEMBER_CAPACITY = 256;
const LITTLE_ENDIAN = true;
const ABILITY_PAYLOAD_FNV_OFFSET = 0x811c9dc5;
const ABILITY_PAYLOAD_FNV_PRIME = 0x01000193;
const TERMINAL_WEBGPU_PLATFORM_STATUSES = new Set([
    'unsupported',
    'destroyed'
]);

function classifyUnavailablePlatformState(platformPort) {
    if (!platformPort) {
        return 'gpu-terminal-unavailable';
    }
    try {
        const platformStatus = platformPort.getState?.()?.status;
        return TERMINAL_WEBGPU_PLATFORM_STATUSES.has(platformStatus)
            ? 'gpu-terminal-unavailable'
            : 'gpu-unavailable';
    } catch {
        return 'gpu-failed';
    }
}

function requirePositiveSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
        throw new RangeError(`${label}은 양의 안전한 정수여야 합니다.`);
    }
    return number;
}

function readDiagnosticPositiveInteger(value) {
    try {
        const number = Number(value);
        return Number.isSafeInteger(number) && number > 0 ? number : 0;
    } catch {
        return 0;
    }
}

function hashAbilityPayloadWord(current, value) {
    return Math.imul(
        (current ^ (Number(value) >>> 0)) >>> 0,
        ABILITY_PAYLOAD_FNV_PRIME
    ) >>> 0;
}

function abilityPayloadHandleKey(handle) {
    return `${Number(handle?.entityId)}:${Number(handle?.incarnation)}`;
}

function isRetryableActorPayloadBodySpawnReason(reason) {
    return reason === 'telemetry-backpressure'
        || reason === 'event-backpressure'
        || reason === 'gpu-backpressure'
        || reason === 'idle'
        || reason === 'gpu-deferred'
        || reason === 'not-ready';
}

function uploadActorPayloadPreleaseRanges(simulation, records, stride) {
    const slots = records
        .map(({ slot }) => slot)
        .sort((left, right) => left - right);
    const uploadRange = (firstSlot, lastSlot) => {
        const byteOffset = firstSlot * stride;
        const byteLength = (lastSlot - firstSlot + 1) * stride;
        const bytes = new Uint8Array(
            simulation.hostStorage.simulationBuffer,
            byteOffset,
            byteLength
        );
        simulation.device.queue.writeBuffer(
            simulation.buffers.simulation,
            byteOffset,
            bytes
        );
    };
    let firstSlot = slots[0];
    let lastSlot = firstSlot;
    for (let index = 1; index < slots.length; index++) {
        const slot = slots[index];
        if (slot === lastSlot + 1) {
            lastSlot = slot;
            continue;
        }
        uploadRange(firstSlot, lastSlot);
        firstSlot = slot;
        lastSlot = slot;
    }
    uploadRange(firstSlot, lastSlot);
}

/**
 * @class EnemySimulationBackend
 * @description 현재 TileMap/flow-field 좌표계를 보존하며 GPU collision/presentation 세션을 소유합니다.
 */
export class EnemySimulationBackend {
    /**
     * @param {{webGpuPlatformPort?:object|null}} [dependencies={}] - 엔진 adapter 의존성입니다.
     * @param {{capacity?:number,presentationProfile?:string}} [options={}] - session 설정입니다.
     */
    constructor(dependencies = {}, options = {}) {
        this.webGpuPlatformPort = dependencies.webGpuPlatformPort ?? null;
        this.capacity = options.capacity ?? DEFAULT_BODY_CAPACITY;
        this.presentationProfile = options.presentationProfile
            ?? GPU_BODY_PRESENTATION_PROFILE.REFERENCE_CLOCK_EXTRAPOLATION;
        this.controlCommandCapacity = options.controlCommandCapacity;
        this.spawnProgramCapacity = options.spawnProgramCapacity;
        this.effectCommandCapacity = options.effectCommandCapacity;
        this.effectInstanceCapacity = options.effectInstanceCapacity;
        this.effectCandidateCapacity = options.effectCandidateCapacity;
        this.effectEventCapacity = options.effectEventCapacity;
        this.eventCapacity = options.eventCapacity;
        this.formationPrepareCapacity = options.formationPrepareCapacity
            ?? options.formationCommandCapacity;
        this.formationTransformCapacity = options.formationTransformCapacity;
        this.atomicTransformPrepareCapacity
            = options.atomicTransformPrepareCapacity ?? this.capacity;
        this.atomicTransformCapacity = options.atomicTransformCapacity;
        this.projectileCaptureCompletionCapacity
            = options.projectileCaptureCompletionCapacity;
        this.projectileCaptureReleasePreparationCapacity
            = options.projectileCaptureReleasePreparationCapacity;
        this.projectileCaptureCleanupCapacity
            = options.projectileCaptureCleanupCapacity;
        this.crowdDensityEnabled = options.crowdDensityEnabled !== false;
        this.crowdDensitySampleIntervalTicks
            = options.crowdDensitySampleIntervalTicks;
        this.crowdDensityReadbackSlotCount
            = options.crowdDensityReadbackSlotCount;
        this.transientVfxEnabled = options.transientVfxEnabled !== false;
        this.transientVfxCapacity = options.transientVfxCapacity;
        this.abilitySubjectCommandCapacity
            = options.abilitySubjectCommandCapacity;
        this.abilitySubjectCapacity = options.abilitySubjectCapacity;
        this.abilitySubjectReadbackSlotCount
            = options.abilitySubjectReadbackSlotCount;
        this.actorPayloadCommandCapacity
            = options.actorPayloadCommandCapacity;
        this.actorPayloadReadbackSlotCount
            = options.actorPayloadReadbackSlotCount;
        const towerGroupMemberCapacity = requirePositiveSafeInteger(
            options.towerGroupMemberCapacity
                ?? Math.min(this.capacity, DEFAULT_TOWER_GROUP_MEMBER_CAPACITY),
            'towerGroupMemberCapacity'
        );
        if (towerGroupMemberCapacity > this.capacity) {
            throw new RangeError('towerGroupMemberCapacity는 body capacity를 넘을 수 없습니다.');
        }
        this.towerGroupMemberCapacity = towerGroupMemberCapacity;
        this.towerGroupReadbackSlotCount = options.towerGroupReadbackSlotCount;
        this.sessionGeneration = requirePositiveSafeInteger(
            options.sessionGeneration ?? 1,
            'sessionGeneration'
        );
        this.abilitySubjectSnapshotRuntime
            = new GpuAbilitySubjectSnapshotRuntime({
                capacity: this.capacity,
                sessionGeneration: this.sessionGeneration,
                commandCapacity: this.abilitySubjectCommandCapacity,
                subjectCapacity: this.abilitySubjectCapacity,
                readbackSlotCount: this.abilitySubjectReadbackSlotCount
            });
        this.actorPayloadMaterializationRuntime
            = new GpuActorPayloadMaterializationRuntime({
                sessionGeneration: this.sessionGeneration,
                commandCapacity: this.actorPayloadCommandCapacity,
                readbackSlotCount: this.actorPayloadReadbackSlotCount
            });
        this.towerGroupRuntime = new GpuTowerGroupRuntime({
            capacity: this.capacity,
            readbackSlotCount: this.towerGroupReadbackSlotCount
        });
        this.actorPayloadBodyPreleases = new Map();
        this.actorPayloadPreleaseHighWater = 0;
        this.actorPayloadPreleaseFailure = null;
        this.navigationGrid = null;
        this.signedDistanceField = null;
        this.flowFieldAtlas = null;
        this.flowRouteByPathId = new Map();
        this.defaultPlayerCreatedHostileRoute = null;
        this.simulation = null;
        this.state = 'idle';
        this.initialized = false;
        this.destroyed = false;
    }

    /**
     * 맵 topology에서 SDF를 한 번 만들고 첫 non-empty spawn까지 GPU 자원 생성을 미룹니다.
     * @param {object} tileMap - 현재 ITileNavigationSource입니다.
     * @returns {boolean} 이미 GPU backend가 준비된 경우에만 true입니다.
     */
    init(tileMap) {
        if (this.initialized || this.destroyed) {
            return this.state === 'gpu-ready';
        }
        if (!tileMap
            || typeof tileMap.getNavigationGrid !== 'function'
            || typeof tileMap.getWorldBounds !== 'function') {
            throw new TypeError('EnemySimulationBackend에는 TileMap navigation source가 필요합니다.');
        }
        this.navigationGrid = tileMap.getNavigationGrid();
        this.signedDistanceField = createGpuSignedDistanceField(this.navigationGrid);
        if (typeof tileMap.getSpawnRoutes === 'function') {
            const spawnRoutes = tileMap.getSpawnRoutes();
            this.defaultPlayerCreatedHostileRoute = spawnRoutes[0] ?? null;
            this.flowFieldAtlas = createRouteFlowFieldAtlas(tileMap);
            for (const route of this.flowFieldAtlas.routes) {
                this.flowRouteByPathId.set(route.pathId, route);
            }
        }
        this.initialized = true;

        if (!this.webGpuPlatformPort) {
            this.state = classifyUnavailablePlatformState(null);
            return false;
        }
        const worldBounds = tileMap.getWorldBounds();
        const collisionCellSize = this.navigationGrid.cellSize
            * SOURCE_GRID_TO_SDF_CELL_RATIO;
        this.simulation = new GpuCircleBodySimulation(this.webGpuPlatformPort, {
            capacity: this.capacity,
            worldSize: {
                x: worldBounds.width,
                y: worldBounds.height
            },
            gridCellSize: {
                x: collisionCellSize,
                y: collisionCellSize
            },
            maxBodiesPerCell: 64,
            solverIterations: 6,
            sdf: this.signedDistanceField,
            flowFieldAtlas: this.flowFieldAtlas,
            sourceWorldUnitScale: this.navigationGrid.cellSize
                * SOURCE_WORLD_UNIT_TO_SDF_CELL_RATIO,
            presentationProfile: this.presentationProfile,
            controlCommandCapacity: this.controlCommandCapacity,
            spawnProgramCapacity: this.spawnProgramCapacity,
            effectPulseProgramCapacity: this.effectCommandCapacity,
            effectInstanceCapacity: this.effectInstanceCapacity,
            effectCandidateCapacity: this.effectCandidateCapacity,
            effectEventCapacity: this.effectEventCapacity,
            eventCapacity: this.eventCapacity,
            formationPrepareCapacity: this.formationPrepareCapacity,
            formationTransformCapacity: this.formationTransformCapacity,
            atomicTransformPrepareCapacity:
                this.atomicTransformPrepareCapacity,
            atomicTransformCapacity: this.atomicTransformCapacity,
            projectileCaptureCompletionCapacity:
                this.projectileCaptureCompletionCapacity,
            projectileCaptureReleasePreparationCapacity:
                this.projectileCaptureReleasePreparationCapacity,
            projectileCaptureCleanupCapacity:
                this.projectileCaptureCleanupCapacity,
            crowdDensityEnabled: this.crowdDensityEnabled,
            crowdDensitySampleIntervalTicks:
                this.crowdDensitySampleIntervalTicks,
            crowdDensityReadbackSlotCount:
                this.crowdDensityReadbackSlotCount,
            transientVfxEnabled: this.transientVfxEnabled,
            transientVfxCapacity: this.transientVfxCapacity,
            sessionGeneration: this.sessionGeneration
        });
        this.state = 'gpu-deferred';
        return false;
    }

    /**
     * 세션 진입/authoritative rebuild에만 사용하는 dense body 교체 경계입니다.
     * live spawn/despawn은 아래 stable-slot API를 fixed command 경계에서 사용합니다.
     * @param {object[]} bodies - collision body spawn 목록입니다.
     * @returns {object} accepted/rejected 결과입니다.
     */
    replaceBodies(bodies) {
        if (!Array.isArray(bodies)) {
            throw new TypeError('enemy simulation body 목록은 배열이어야 합니다.');
        }
        if (!this.simulation) {
            return Object.freeze({
                accepted: 0,
                rejected: bodies.length,
                capacity: this.capacity,
                reason: 'gpu-unavailable'
            });
        }
        const resolvedBodies = bodies.map((body, index) => this.#resolveBodyFlow(body, index));
        const result = this.simulation.replaceBodies(resolvedBodies);
        this.#syncState();
        return result;
    }

    /**
     * 기존 GPU body 상태를 재생성하지 않고 stable slot에 적을 추가합니다.
     * 실제 gameplay caller는 다음 fixed-step command commit 경계에서만 호출해야 합니다.
     * @param {object[]} bodies - entityId/incarnation과 route 정보를 가진 spawn batch입니다.
     * @returns {object} accepted/rejected 결과입니다.
     */
    spawnBodies(bodies) {
        if (!Array.isArray(bodies)) {
            throw new TypeError('enemy spawn batch는 배열이어야 합니다.');
        }
        if (!this.simulation) {
            return Object.freeze({
                accepted: 0,
                rejected: bodies.length,
                capacity: this.capacity,
                reason: 'gpu-unavailable'
            });
        }
        const resolvedBodies = bodies.map((body, index) => this.#resolveBodyFlow(body, index));
        const result = this.simulation.spawnBodies(resolvedBodies);
        this.#syncState();
        return result;
    }

    /**
     * entityId/incarnation이 일치하는 적만 tombstone 처리합니다.
     * 실제 gameplay caller는 다음 fixed-step command commit 경계에서만 호출해야 합니다.
     * @param {object[]} handles - stable enemy handle batch입니다.
     * @returns {object} removed/rejected 결과입니다.
     */
    despawnBodies(handles) {
        if (!Array.isArray(handles)) {
            throw new TypeError('enemy despawn batch는 배열이어야 합니다.');
        }
        if (!this.simulation) {
            return Object.freeze({
                removed: 0,
                rejected: handles.length,
                capacity: this.capacity,
                reason: 'gpu-unavailable'
            });
        }
        const result = this.simulation.despawnBodies(handles);
        this.#syncState();
        return result;
    }

    /** @param {object} handle - entityId/incarnation handle입니다. */
    hasBody(handle) {
        return this.simulation?.hasBody(handle) ?? false;
    }

    /** Ability metadata plane이 사용할 exact private stable slot을 한정합니다. */
    resolveExactAbilityBodySlot(handle) {
        const entityId = Number(handle?.entityId);
        const incarnation = Number(handle?.incarnation);
        if (!Number.isSafeInteger(entityId) || entityId <= 0
            || !Number.isSafeInteger(incarnation) || incarnation <= 0
            || !this.simulation) {
            return null;
        }
        const key = `${entityId}:${incarnation}`;
        const activeSlot = this.simulation.handleToSlot?.get(key);
        if (Number.isSafeInteger(activeSlot)
            && activeSlot >= 0 && activeSlot < this.capacity
            && this.simulation.slotActive?.[activeSlot] === 1
            && this.simulation.slotHandles?.[activeSlot]?.entityId === entityId
            && this.simulation.slotHandles?.[activeSlot]?.incarnation
                === incarnation) {
            return Object.freeze({ slot: activeSlot, entityId, incarnation });
        }
        const pendingSlot = this.simulation.pendingHandleToSlot?.get(key);
        if (Number.isSafeInteger(pendingSlot)
            && pendingSlot >= 0 && pendingSlot < this.capacity
            && this.simulation.slotActive?.[pendingSlot] === 2
            && this.simulation.pendingSlotHandles?.[pendingSlot]?.entityId
                === entityId
            && this.simulation.pendingSlotHandles?.[pendingSlot]?.incarnation
                === incarnation) {
            return Object.freeze({ slot: pendingSlot, entityId, incarnation });
        }
        return null;
    }

    synchronizeAbilityEntityMetadata(entries) {
        if (!this.#ensureAbilitySubjectSnapshotRuntime()) {
            return Object.freeze({
                accepted: false,
                reason: 'ability-subject-runtime-unavailable'
            });
        }
        return this.abilitySubjectSnapshotRuntime
            .synchronizeEntityMetadata(entries);
    }

    stageAbilityExecutionCommand(command) {
        return this.abilitySubjectSnapshotRuntime.stageExecution(command);
    }

    submitAbilitySubjectSnapshots(sourceTick) {
        const pendingCommandCount = this.abilitySubjectSnapshotRuntime
            .getStatus().pendingCommandCount;
        if (pendingCommandCount === 0) {
            return Object.freeze({ submittedCount: 0, deferredCount: 0 });
        }
        if (!this.#ensureAbilitySubjectSnapshotRuntime()) {
            return Object.freeze({
                submittedCount: 0,
                deferredCount: pendingCommandCount,
                reason: 'ability-subject-runtime-unavailable'
            });
        }
        return this.abilitySubjectSnapshotRuntime
            .submitPendingForFixedTick(sourceTick);
    }

    drainCompletedAbilitySubjectSnapshots(out = []) {
        return this.abilitySubjectSnapshotRuntime.drainCompleted(out);
    }

    getAbilitySubjectSnapshotGpuBinding(token) {
        return this.abilitySubjectSnapshotRuntime
            .getSnapshotGpuBinding(token);
    }

    releaseAbilitySubjectSnapshot(token) {
        return this.abilitySubjectSnapshotRuntime.releaseSnapshot(token);
    }

    cancelPendingAbilityExecutions(reason = 'cancelled') {
        return this.abilitySubjectSnapshotRuntime.cancelAll(reason);
    }

    getAbilitySubjectSnapshotStatus() {
        return this.abilitySubjectSnapshotRuntime.getStatus();
    }

    /** R3 data order의 첫 route를 player-created hostile default로 고정합니다. */
    createAbilityEnemyPayloadSpawnTemplate(executionOrdinal) {
        if (!this.defaultPlayerCreatedHostileRoute) {
            throw new RangeError(
                'player-created hostile default route가 없습니다.'
            );
        }
        const spawnSequence = Number(executionOrdinal);
        if (!Number.isSafeInteger(spawnSequence) || spawnSequence <= 0) {
            throw new RangeError('payload spawnSequence는 양의 정수여야 합니다.');
        }
        return createGpuEnemySpawnIntent({
            definition: BASIC_CIRCLE_ENEMY_DATA,
            route: this.defaultPlayerCreatedHostileRoute,
            spawnSequence,
            policyId: 'player-created-hostile-default-route.v1'
        });
    }

    getAvailableActorPayloadBodyCapacity() {
        const simulation = this.simulation;
        if (!simulation) return 0;
        return Math.max(
            0,
            this.capacity
                - Number(simulation.activeBodyCount ?? 0)
                - Number(simulation.pendingBodyCount ?? 0)
        );
    }

    canStageActorPayloadMaterialization() {
        return this.#ensureActorPayloadMaterializationRuntime(null)
            && this.actorPayloadMaterializationRuntime.canAccept();
    }

    /**
     * Registry handle batch와 같은 rank의 stable body slot을 pending(2)로
     * prelease합니다. GPU flags의 ALIVE를 즉시 내려 외부에는 보이지
     * 않으며, 전체 batch를 수용할 수 없으면 0개만 반영합니다.
     */
    preleaseActorPayloadBodies(request = {}) {
        const handles = request.handles;
        const spawnTemplate = request.spawnTemplate;
        if (!Array.isArray(handles) || handles.length === 0) {
            throw new TypeError('actor payload handles는 비어 있지 않은 배열이어야 합니다.');
        }
        if (!spawnTemplate || typeof spawnTemplate !== 'object') {
            throw new TypeError('actor payload spawn template이 필요합니다.');
        }
        if (!this.simulation
            || handles.length > this.getAvailableActorPayloadBodyCapacity()) {
            return Object.freeze({
                accepted: false,
                reason: 'actor-payload-body-capacity',
                requestedCount: handles.length,
                preleasedCount: 0,
                requiresRecovery: false
            });
        }
        const keys = new Set();
        for (const handle of handles) {
            const entityId = Number(handle?.entityId);
            const incarnation = Number(handle?.incarnation);
            const key = abilityPayloadHandleKey(handle);
            if (!Number.isSafeInteger(entityId) || entityId <= 0
                || !Number.isSafeInteger(incarnation) || incarnation <= 0
                || keys.has(key)) {
                throw new RangeError('actor payload destination handle이 잘못됐습니다.');
            }
            keys.add(key);
        }
        const resolvedTemplate = this.#resolveBodyFlow(spawnTemplate, 0);
        const bodies = handles.map((handle) => ({
            ...resolvedTemplate,
            entityId: handle.entityId,
            incarnation: handle.incarnation
        }));
        const result = this.simulation.spawnBodies(bodies);
        const full = result?.accepted === handles.length
            && result?.rejected === 0
            && handles.every((handle) => this.simulation.hasBody(handle));
        if (!full) {
            const any = handles.filter((handle) => this.simulation.hasBody(handle));
            if (any.length > 0) {
                try { this.simulation.despawnBodies(any); } catch { /* recovery below */ }
                this.actorPayloadPreleaseFailure = Object.freeze({
                    stage: 'actor-payload-body-prelease-partial',
                    message: 'body prelease가 partial result를 반환했습니다.'
                });
            }
            this.#syncState();
            const capacityRejected = result?.reason === 'capacity';
            const retryable = any.length === 0
                && result?.requiresRecovery !== true
                && isRetryableActorPayloadBodySpawnReason(result?.reason);
            return Object.freeze({
                accepted: false,
                reason: result?.reason ?? 'actor-payload-body-prelease',
                capacityRejected,
                retryable,
                requestedCount: handles.length,
                preleasedCount: 0,
                requiresRecovery: any.length > 0
                    || (result?.requiresRecovery === true && !retryable)
            });
        }

        const simulation = this.simulation;
        const simulationView = new DataView(
            simulation.hostStorage.simulationBuffer
        );
        const routeView = new DataView(simulation.hostRouteRuntimeStates);
        const bodyLayout = GPU_CIRCLE_BODY_ABI.SIMULATION;
        const routeLayout = GPU_ROUTE_RUNTIME_ABI.BODY_STATE;
        const records = [];
        for (let index = 0; index < handles.length; index++) {
            const handle = handles[index];
            const key = abilityPayloadHandleKey(handle);
            const slot = simulation.handleToSlot.get(key);
            if (!Number.isSafeInteger(slot)
                || simulation.slotActive[slot] !== 1
                || simulation.slotHandles[slot]?.entityId !== handle.entityId
                || simulation.slotHandles[slot]?.incarnation
                    !== handle.incarnation) {
                this.actorPayloadPreleaseFailure = Object.freeze({
                    stage: 'actor-payload-slot-prelease',
                    message: `spawned body slot을 exact handle로 찾지 못했습니다: ${key}`
                });
                try { simulation.despawnBodies(handles); } catch { /* fail closed */ }
                this.#syncState();
                return Object.freeze({
                    accepted: false,
                    reason: 'actor-payload-slot-identity',
                    requestedCount: handles.length,
                    preleasedCount: 0,
                    requiresRecovery: true
                });
            }
            const simulationOffset = slot * bodyLayout.STRIDE;
            const routeOffset = slot * routeLayout.STRIDE;
            records.push({
                slot,
                handle,
                key,
                baselineFlags: simulationView.getUint32(
                    simulationOffset + bodyLayout.FLAGS,
                    LITTLE_ENDIAN
                ),
                defaultRouteMeta: routeView.getUint32(
                    routeOffset + routeLayout.META,
                    LITTLE_ENDIAN
                ),
                defaultRouteProfileCode: routeView.getUint32(
                    routeOffset + routeLayout.PROFILE_CODE,
                    LITTLE_ENDIAN
                ),
                defaultCurrentPathIndex: routeView.getUint32(
                    routeOffset + routeLayout.CURRENT_PATH_INDEX,
                    LITTLE_ENDIAN
                ),
                defaultRouteSetIndex: routeView.getUint32(
                    routeOffset + routeLayout.ROUTE_SET_INDEX,
                    LITTLE_ENDIAN
                )
            });
        }

        const token = Object.freeze({});
        const record = {
            token,
            handles: Object.freeze(handles.map((handle) => Object.freeze({
                entityId: handle.entityId,
                incarnation: handle.incarnation
            }))),
            records: Object.freeze(records.map((entry) => Object.freeze({
                ...entry,
                handle: Object.freeze({ ...entry.handle })
            }))),
            resolvedTemplate,
            state: 'preleased'
        };
        try {
            for (const entry of record.records) {
                simulation.handleToSlot.delete(entry.key);
                simulation.slotHandles[entry.slot] = null;
                simulation.slotActive[entry.slot] = 2;
                simulation.pendingSlotHandles[entry.slot] = entry.handle;
                simulation.pendingHandleToSlot.set(entry.key, entry.slot);
                simulation.activeBodyCount--;
                simulation.pendingBodyCount++;
                const deadFlags = entry.baselineFlags
                    & ~GPU_CIRCLE_BODY_META.ALIVE_BIT;
                simulationView.setUint32(
                    entry.slot * bodyLayout.STRIDE + bodyLayout.FLAGS,
                    deadFlags,
                    LITTLE_ENDIAN
                );
            }
            uploadActorPayloadPreleaseRanges(
                simulation,
                record.records,
                bodyLayout.STRIDE
            );
            this.actorPayloadBodyPreleases.set(token, record);
            this.actorPayloadPreleaseHighWater = Math.max(
                this.actorPayloadPreleaseHighWater,
                this.actorPayloadBodyPreleases.size
            );
        } catch (error) {
            this.actorPayloadPreleaseFailure = Object.freeze({
                stage: 'actor-payload-prelease-upload',
                name: String(error?.name ?? 'Error'),
                message: String(error?.message ?? error)
            });
            this.#rollbackUntrackedActorPayloadPrelease(record);
            this.#syncState();
            return Object.freeze({
                accepted: false,
                reason: 'actor-payload-prelease-upload',
                requestedCount: handles.length,
                preleasedCount: 0,
                requiresRecovery: true
            });
        }
        this.#syncState();
        return Object.freeze({
            accepted: true,
            token,
            requestedCount: handles.length,
            preleasedCount: handles.length,
            requiresRecovery: false
        });
    }

    stageActorPayloadMaterialization(request = {}) {
        const prelease = this.actorPayloadBodyPreleases.get(
            request.preleaseToken
        );
        if (!prelease || prelease.state !== 'preleased') {
            return Object.freeze({
                accepted: false,
                reason: 'actor-payload-prelease-token'
            });
        }
        const snapshotBinding = request.snapshotBinding;
        if (!this.#ensureActorPayloadMaterializationRuntime(snapshotBinding)) {
            return Object.freeze({
                accepted: false,
                reason: 'actor-payload-runtime-unavailable'
            });
        }
        let destinationFingerprint = hashAbilityPayloadWord(
            ABILITY_PAYLOAD_FNV_OFFSET,
            request.command?.fingerprint
        );
        const destinationLeases = prelease.records.map((entry, index) => {
            destinationFingerprint = hashAbilityPayloadWord(
                destinationFingerprint,
                entry.slot
            );
            destinationFingerprint = hashAbilityPayloadWord(
                destinationFingerprint,
                entry.handle.entityId
            );
            destinationFingerprint = hashAbilityPayloadWord(
                destinationFingerprint,
                entry.handle.incarnation
            );
            return Object.freeze({
                destinationSlot: entry.slot,
                destinationEntityId: entry.handle.entityId,
                destinationIncarnation: entry.handle.incarnation,
                snapshotRank: index,
                baselineFlags: entry.baselineFlags,
                defaultRouteMeta: entry.defaultRouteMeta,
                defaultRouteProfileCode: entry.defaultRouteProfileCode
            });
        });
        const first = prelease.records[0];
        const result = this.actorPayloadMaterializationRuntime.stage({
            ...request,
            destinationLeases,
            destinationFingerprint,
            sdf: Object.freeze({
                enabled: this.simulation.sdf?.enabled === true,
                cols: this.simulation.sdf?.cols ?? 1,
                rows: this.simulation.sdf?.rows ?? 1,
                worldWidth: this.simulation.worldSize.x,
                worldHeight: this.simulation.worldSize.y
            }),
            defaultRoute: Object.freeze({
                flowFieldIndex: prelease.resolvedTemplate.flowFieldIndex ?? 0,
                currentPathIndex: first.defaultCurrentPathIndex,
                routeSetIndex: first.defaultRouteSetIndex
            })
        });
        if (result?.accepted === true) {
            prelease.state = 'materialization-pending';
            prelease.transactionId = request.transactionId;
        }
        return result;
    }

    submitActorPayloadMaterializations(sourceTick) {
        return this.actorPayloadMaterializationRuntime
            .submitPendingForFixedTick(sourceTick);
    }

    drainCompletedActorPayloadMaterializations(out = []) {
        return this.actorPayloadMaterializationRuntime.drainCompleted(out);
    }

    commitActorPayloadBodyPrelease(token) {
        const prelease = this.actorPayloadBodyPreleases.get(token);
        if (!prelease || prelease.state !== 'materialization-pending') {
            return Object.freeze({
                accepted: false,
                reason: 'actor-payload-prelease-token',
                committedCount: 0,
                requiresRecovery: false
            });
        }
        const simulation = this.simulation;
        const layout = GPU_CIRCLE_BODY_ABI.SIMULATION;
        const view = new DataView(simulation.hostStorage.simulationBuffer);
        for (const entry of prelease.records) {
            if (simulation.slotActive[entry.slot] !== 2
                || simulation.pendingHandleToSlot.get(entry.key)
                    !== entry.slot
                || simulation.pendingSlotHandles[entry.slot]?.entityId
                    !== entry.handle.entityId
                || simulation.pendingSlotHandles[entry.slot]?.incarnation
                    !== entry.handle.incarnation) {
                this.actorPayloadPreleaseFailure = Object.freeze({
                    stage: 'actor-payload-prelease-commit',
                    message: `pending destination identity가 다릅니다: ${entry.key}`
                });
                return Object.freeze({
                    accepted: false,
                    reason: 'actor-payload-prelease-identity',
                    committedCount: 0,
                    requiresRecovery: true
                });
            }
        }
        try {
            for (const entry of prelease.records) {
                const publishFlags = entry.baselineFlags
                    | GPU_CIRCLE_BODY_META.ALIVE_BIT
                    | GPU_CIRCLE_BODY_SIMULATION_FLAG.CONTROLLED_THIS_TICK
                    | GPU_CIRCLE_BODY_SIMULATION_FLAG
                        .EXTERNAL_MOTION_OWNER_THIS_TICK;
                view.setUint32(
                    entry.slot * layout.STRIDE + layout.FLAGS,
                    publishFlags,
                    LITTLE_ENDIAN
                );
                const flagBytes = new ArrayBuffer(4);
                new DataView(flagBytes).setUint32(
                    0,
                    publishFlags,
                    LITTLE_ENDIAN
                );
                simulation.device.queue.writeBuffer(
                    simulation.buffers.simulation,
                    entry.slot * layout.STRIDE + layout.FLAGS,
                    flagBytes
                );
            }
            for (const entry of prelease.records) {
                simulation.pendingHandleToSlot.delete(entry.key);
                simulation.pendingSlotHandles[entry.slot] = null;
                simulation.slotActive[entry.slot] = 1;
                simulation.slotHandles[entry.slot] = entry.handle;
                simulation.handleToSlot.set(entry.key, entry.slot);
                simulation.pendingBodyCount--;
                simulation.activeBodyCount++;
            }
            prelease.state = 'committed';
            this.actorPayloadBodyPreleases.delete(token);
            this.#syncState();
            return Object.freeze({
                accepted: true,
                committedCount: prelease.records.length,
                handles: prelease.handles,
                requiresRecovery: false
            });
        } catch (error) {
            this.actorPayloadPreleaseFailure = Object.freeze({
                stage: 'actor-payload-prelease-commit-upload',
                name: String(error?.name ?? 'Error'),
                message: String(error?.message ?? error)
            });
            return Object.freeze({
                accepted: false,
                reason: 'actor-payload-prelease-commit-upload',
                committedCount: 0,
                requiresRecovery: true
            });
        }
    }

    cancelActorPayloadBodyPrelease(token, reason = 'cancelled') {
        const prelease = this.actorPayloadBodyPreleases.get(token);
        if (!prelease) {
            return Object.freeze({
                accepted: false,
                reason: 'actor-payload-prelease-token',
                cancelledCount: 0,
                requiresRecovery: false
            });
        }
        const cancelled = this.#rollbackUntrackedActorPayloadPrelease(
            prelease
        );
        this.actorPayloadBodyPreleases.delete(token);
        this.#syncState();
        return Object.freeze({
            accepted: cancelled,
            reason: String(reason || 'cancelled'),
            cancelledCount: cancelled ? prelease.records.length : 0,
            requiresRecovery: !cancelled
        });
    }

    cancelAllActorPayloadMaterializations(reason = 'cancelled') {
        const runtime = this.actorPayloadMaterializationRuntime
            .cancelAll(reason);
        let cancelledPreleaseCount = 0;
        let requiresRecovery = false;
        for (const [token, prelease] of [...this.actorPayloadBodyPreleases]) {
            const result = this.cancelActorPayloadBodyPrelease(token, reason);
            cancelledPreleaseCount += result.cancelledCount;
            requiresRecovery ||= result.requiresRecovery === true;
            void prelease;
        }
        return Object.freeze({
            cancelledExecutionCount: runtime.cancelledCount,
            cancelledPreleaseCount,
            requiresRecovery,
            reason: String(reason || 'cancelled')
        });
    }

    getActorPayloadMaterializationStatus() {
        return Object.freeze({
            ...this.actorPayloadMaterializationRuntime.getStatus(),
            bodyPreleaseCount: this.actorPayloadBodyPreleases.size,
            bodyPreleaseHighWater: this.actorPayloadPreleaseHighWater,
            preleaseFailure: this.actorPayloadPreleaseFailure,
            availableBodyCapacity:
                this.getAvailableActorPayloadBodyCapacity(),
            requiresRecovery:
                this.actorPayloadPreleaseFailure !== null
                || this.actorPayloadMaterializationRuntime.requiresRecovery()
        });
    }

    canControlBody(handle) {
        return this.simulation?.canControlBody?.(handle) ?? false;
    }

    /** Generic control + source-relative spawn plan을 한 fixed submit용으로 staging합니다. */
    stageFixedPrograms(plan = {}) {
        if (!this.simulation) {
            const count = (plan.controls?.length ?? 0)
                + (plan.sourceRelativeSpawns?.length ?? 0);
            return Object.freeze({
                accepted: 0,
                rejected: count,
                reason: 'gpu-unavailable'
            });
        }
        const sourceRelativeSpawns = (plan.sourceRelativeSpawns ?? []).map(
            (entry, index) => ({
                ...entry,
                destinationSpawn: this.#resolveBodyFlow(
                    entry.destinationSpawn,
                    index
                )
            })
        );
        const result = this.simulation.stageFixedPrograms({
            ...plan,
            sourceRelativeSpawns
        });
        this.#syncState();
        return result;
    }

    /** 완료된 priority BodyControlProgram 결과를 submit 순서대로 이동합니다. */
    drainCompletedBodyControlProgramBatches(out = []) {
        if (!Array.isArray(out)) {
            throw new TypeError('BodyControlProgram 완료 출력은 배열이어야 합니다.');
        }
        return this.simulation?.drainCompletedBodyControlProgramBatches?.(out) ?? out;
    }

    drainCompletedSpawnProgramBatches(out = []) {
        if (!Array.isArray(out)) {
            throw new TypeError('SpawnProgram 완료 출력은 배열이어야 합니다.');
        }
        return this.simulation?.drainCompletedSpawnProgramBatches?.(out) ?? out;
    }

    /** same-tick due Effect 전체를 하나의 backend atomic batch로 stage합니다. */
    stageEffectPulseProgramBatch(batch) {
        if (!this.simulation
            || typeof this.simulation.stageEffectPulseProgramBatch !== 'function') {
            return Object.freeze({
                abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
                accepted: false,
                sourceTick: readDiagnosticPositiveInteger(batch?.sourceTick),
                stagedCount: 0,
                reason: 'gpu-unavailable',
                requiresRecovery: false
            });
        }
        const result = this.simulation.stageEffectPulseProgramBatch(batch);
        this.#syncState();
        return result;
    }

    drainCompletedEffectProgramBatches(out = []) {
        if (!Array.isArray(out)) {
            throw new TypeError('Effect 완료 batch 출력은 배열이어야 합니다.');
        }
        return this.simulation?.drainCompletedEffectProgramBatches?.(out) ?? out;
    }

    cancelPendingEffectProgramsForTerminal(request = {}) {
        if (!this.simulation
            || typeof this.simulation.cancelPendingEffectProgramsForTerminal
                !== 'function') {
            return Object.freeze({
                abiVersion: GPU_EFFECT_TERMINAL_CANCEL_ABI_VERSION,
                state: 'failed',
                finalFixedTick: readDiagnosticPositiveInteger(
                    request?.finalFixedTick
                ),
                submittedTick: 0,
                pulseProgramCount: 0,
                pendingPulseProgramCount: 0,
                pendingEffectReadbackCount: 0,
                failure: 'gpu-unavailable'
            });
        }
        const result = this.simulation.cancelPendingEffectProgramsForTerminal(
            request
        );
        this.#syncState();
        return result;
    }

    getEffectRuntimeStatus() {
        return this.simulation?.getEffectRuntimeStatus?.() ?? Object.freeze({
            abiVersion: GPU_EFFECT_RUNTIME_ABI_VERSION,
            state: 'gpu-unavailable',
            sessionGeneration: this.sessionGeneration,
            deviceGeneration: -1,
            authoritativeEpoch: 0,
            ingressOpen: false,
            stagedProgramCount: 0,
            pendingPulseProgramCount: 0,
            pendingEffectReadbackCount: 0,
            completedThroughTick: 0,
            activePoolIndex: 0,
            sourceTick: 0,
            lastSubmittedTick: 0,
            runtimeStatus: 0,
            requiresRecovery: false,
            failure: null,
            terminal: null
        });
    }

    stageFormationPrepareBatch(batch) {
        if (!this.simulation?.stageFormationPrepareBatch) {
            return Object.freeze({
                abiVersion: GPU_FORMATION_PREPARE_PROGRAM_ABI_VERSION,
                accepted: false,
                targetFixedTick: readDiagnosticPositiveInteger(
                    batch?.targetFixedTick
                ),
                stagedCount: 0,
                replayed: false,
                reason: 'gpu-unavailable',
                requiresRecovery: false
            });
        }
        const result = this.simulation.stageFormationPrepareBatch(batch);
        this.#syncState();
        return result;
    }

    drainCompletedFormationPrepareBatches(out = []) {
        if (!Array.isArray(out)) {
            throw new TypeError('Formation prepare 완료 출력은 배열이어야 합니다.');
        }
        return this.simulation?.drainCompletedFormationPrepareBatches?.(out)
            ?? out;
    }

    armPreparedFormationTransformBatch(batch) {
        if (!this.simulation?.armPreparedFormationTransformBatch) {
            return Object.freeze({
                abiVersion: GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION,
                accepted: false,
                preparedSourceTick: readDiagnosticPositiveInteger(
                    batch?.preparedSourceTick
                ),
                targetFixedTick: readDiagnosticPositiveInteger(
                    batch?.targetFixedTick
                ),
                armedCount: 0,
                replayed: false,
                receipt: null,
                evidence: null,
                reason: 'gpu-unavailable',
                requiresRecovery: false
            });
        }
        const result = this.simulation.armPreparedFormationTransformBatch(batch);
        this.#syncState();
        return result;
    }

    commitArmedFormationTransformBatch(receipt) {
        const result = this.simulation?.commitArmedFormationTransformBatch?.(
            receipt
        ) ?? Object.freeze({
            abiVersion: GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION,
            accepted: false,
            targetFixedTick: 0,
            armedCount: 0,
            commitRequested: false,
            reason: 'gpu-unavailable'
        });
        this.#syncState();
        return result;
    }

    cancelArmedFormationTransformBatch(receipt) {
        const result = this.simulation?.cancelArmedFormationTransformBatch?.(
            receipt
        ) ?? Object.freeze({
            abiVersion: GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION,
            accepted: false,
            targetFixedTick: 0,
            cancelledCount: 0,
            canceled: false,
            reason: 'gpu-unavailable'
        });
        this.#syncState();
        return result;
    }

    cancelPendingFormationProgramsForTerminal(request = {}) {
        const result = this.simulation
            ?.cancelPendingFormationProgramsForTerminal?.(request)
            ?? Object.freeze({
                abiVersion: GPU_FORMATION_TERMINAL_CANCEL_ABI_VERSION,
                state: 'failed',
                finalFixedTick: readDiagnosticPositiveInteger(
                    request?.finalFixedTick
                ),
                submittedTick: 0,
                prepareProgramCount: 0,
                armedTransformCount: 0,
                pendingPrepareProgramCount: 0,
                pendingPrepareReadbackCount: 0,
                failure: 'gpu-unavailable'
            });
        this.#syncState();
        return result;
    }

    getFormationRuntimeStatus() {
        return this.simulation?.getFormationRuntimeStatus?.() ?? Object.freeze({
            abiVersion: GPU_FORMATION_RUNTIME_ABI_VERSION,
            state: 'gpu-unavailable',
            sessionGeneration: this.sessionGeneration,
            deviceGeneration: -1,
            authoritativeEpoch: 0,
            ingressOpen: false,
            prepareCapacity: this.formationPrepareCapacity ?? 0,
            transformCapacity: this.formationTransformCapacity ?? 0,
            stagedPrepareProgramCount: 0,
            pendingPrepareProgramCount: 0,
            pendingPrepareReadbackCount: 0,
            pendingTransformReadbackCount: 0,
            lastPrepareSourceTick: 0,
            lastPrepareSubmittedTick: 0,
            lastPrepareCompletedTick: 0,
            armedTransformCount: 0,
            commitRequested: false,
            targetFixedTick: 0,
            lastCommittedTransformCount: 0,
            lastCommittedSourceTick: 0,
            lastEffectRekeyCount: 0,
            lastTransformCompletion: null,
            runtimeStatus: 0,
            requiresRecovery: false,
            failure: null,
            terminal: null
        });
    }

    stageAtomicTransformPrepareBatch(batch) {
        const result = this.simulation?.stageAtomicTransformPrepareBatch?.(batch)
            ?? Object.freeze({
                abiVersion: GPU_ATOMIC_TRANSFORM_PREPARE_PROGRAM_ABI_VERSION,
                accepted: false,
                reason: 'gpu-unavailable',
                requiresRecovery: false
            });
        this.#syncState();
        return result;
    }

    drainCompletedAtomicTransformPrepareBatches(out = []) {
        if (!Array.isArray(out)) {
            throw new TypeError('AtomicTransform prepare 완료 출력은 배열이어야 합니다.');
        }
        return this.simulation
            ?.drainCompletedAtomicTransformPrepareBatches?.(out) ?? out;
    }

    discardPreparedAtomicTransformBatch(request) {
        return this.simulation?.discardPreparedAtomicTransformBatch?.(request)
            ?? Object.freeze({
                accepted: false,
                reason: 'gpu-unavailable',
                requiresRecovery: false
            });
    }

    armPreparedAtomicTransformBatch(request) {
        const result = this.simulation?.armPreparedAtomicTransformBatch?.(request)
            ?? Object.freeze({
                abiVersion: GPU_ATOMIC_TRANSFORM_PROGRAM_ABI_VERSION,
                accepted: false,
                reason: 'gpu-unavailable',
                requiresRecovery: false
            });
        this.#syncState();
        return result;
    }

    commitArmedAtomicTransformBatch(receipt) {
        const result = this.simulation
            ?.commitArmedAtomicTransformBatch?.(receipt)
            ?? Object.freeze({
                abiVersion: GPU_ATOMIC_TRANSFORM_PROGRAM_ABI_VERSION,
                accepted: false,
                reason: 'gpu-unavailable',
                requiresRecovery: false
            });
        this.#syncState();
        return result;
    }

    cancelArmedAtomicTransformBatch(receipt, reason) {
        const result = this.simulation
            ?.cancelArmedAtomicTransformBatch?.(receipt, reason)
            ?? Object.freeze({
                abiVersion: GPU_ATOMIC_TRANSFORM_PROGRAM_ABI_VERSION,
                accepted: false,
                reason: 'gpu-unavailable',
                requiresRecovery: false
            });
        this.#syncState();
        return result;
    }

    cancelPendingAtomicTransformProgramsForTerminal(request = {}) {
        const result = this.simulation
            ?.cancelPendingAtomicTransformProgramsForTerminal?.(request)
            ?? Object.freeze({
                abiVersion: GPU_ATOMIC_TRANSFORM_TERMINAL_CANCEL_ABI_VERSION,
                state: 'failed',
                finalFixedTick: readDiagnosticPositiveInteger(
                    request.finalFixedTick
                ),
                submittedTick: 0,
                sessionGeneration: this.sessionGeneration,
                deviceGeneration: 0,
                authoritativeEpoch: 0,
                pendingPrepareCount: 0,
                pendingTransformCount: 0,
                pendingReadbackCount: 0,
                failure: 'gpu-unavailable'
            });
        this.#syncState();
        return result;
    }

    getAtomicTransformRuntimeStatus() {
        return this.simulation?.getAtomicTransformRuntimeStatus?.()
            ?? Object.freeze({
                abiVersion: GPU_ATOMIC_TRANSFORM_RUNTIME_ABI_VERSION,
                state: 'gpu-unavailable',
                sessionGeneration: this.sessionGeneration,
                deviceGeneration: -1,
                authoritativeEpoch: 0,
                pendingPrepareCount: 0,
                pendingTransformCount: 0,
                pendingReadbackCount: 0,
                requiresRecovery: false,
                failure: null,
                terminal: null
            });
    }

    armPreparedProjectileCaptureReleaseBatch(request) {
        const result = this.simulation
            ?.armPreparedProjectileCaptureReleaseBatch?.(request)
            ?? Object.freeze({
                abiVersion: GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION,
                accepted: false,
                reason: 'gpu-unavailable',
                requiresRecovery: false
            });
        this.#syncState();
        return result;
    }

    commitArmedProjectileCaptureReleaseBatch(receipt) {
        const result = this.simulation
            ?.commitArmedProjectileCaptureReleaseBatch?.(receipt)
            ?? Object.freeze({
                abiVersion: GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION,
                accepted: false,
                reason: 'gpu-unavailable',
                requiresRecovery: false
            });
        this.#syncState();
        return result;
    }

    cancelArmedProjectileCaptureReleaseBatch(receipt, reason) {
        const result = this.simulation
            ?.cancelArmedProjectileCaptureReleaseBatch?.(receipt, reason)
            ?? Object.freeze({
                abiVersion: GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION,
                accepted: false,
                reason: 'gpu-unavailable',
                requiresRecovery: false
            });
        this.#syncState();
        return result;
    }

    drainCompletedProjectileCaptureBatches(out = []) {
        return this.simulation?.drainCompletedProjectileCaptureBatches?.(out)
            ?? out;
    }

    drainCompletedProjectileCaptureReleaseBatches(out = []) {
        return this.simulation
            ?.drainCompletedProjectileCaptureReleaseBatches?.(out) ?? out;
    }

    discardPreparedProjectileCaptureBatch(request) {
        return this.simulation?.discardPreparedProjectileCaptureBatch?.(request)
            ?? Object.freeze({ accepted: false, reason: 'gpu-unavailable' });
    }

    cancelPendingProjectileCaptureProgramsForTerminal(request) {
        return this.simulation
            ?.cancelPendingProjectileCaptureProgramsForTerminal?.(request)
            ?? Object.freeze({
                abiVersion: GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION,
                state: 'failed',
                finalFixedTick: readDiagnosticPositiveInteger(
                    request?.finalFixedTick
                ),
                failure: 'gpu-unavailable'
            });
    }

    getTerminalProjectileCaptureProgramCancelStatus() {
        return this.simulation
            ?.getTerminalProjectileCaptureProgramCancelStatus?.() ?? null;
    }

    getProjectileCaptureRuntimeStatus() {
        return this.simulation?.getProjectileCaptureRuntimeStatus?.()
            ?? Object.freeze({
                abiVersion: GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION,
                state: 'gpu-unavailable',
                sessionGeneration: this.sessionGeneration,
                deviceGeneration: 0,
                authoritativeEpoch: 0,
                ingressOpen: false,
                captureCapacity: 0,
                releasePreparationCapacity: 0,
                cleanupCapacity: 0,
                activeDomainBodyCount: 0,
                pendingCaptureReadbackCount: 0,
                pendingReleaseReadbackCount: 0,
                pendingCaptureBatchCount: 0,
                pendingReleaseBatchCount: 0,
                preparedBatchCount: 0,
                armedReleaseCount: 0,
                stagedReleaseCount: 0,
                commitRequested: false,
                targetFixedTick: 0,
                sourceTick: 0,
                completedThroughTick: 0,
                lastReleaseCommittedTick: 0,
                runtimeStatus: GPU_PROJECTILE_CAPTURE_TICK_STATUS.RESET,
                errorFlags: 0,
                capacityRejected: false,
                retryableCapacityRejected: false,
                capacityRejectionFlags: 0,
                retryMode: false,
                retryOriginTick: 0,
                retryBacklogRemaining: false,
                storageProfile: GPU_PROJECTILE_CAPTURE_STORAGE_PROFILE,
                requiresRecovery: false,
                failure: null,
                terminal: null
            });
    }

    registerProjectileCaptureCoreImpactReceipt(receipt) {
        return this.simulation
            ?.registerProjectileCaptureCoreImpactReceipt?.(receipt) === true;
    }

    getProjectileCaptureBodyState(handle) {
        return this.simulation?.getProjectileCaptureBodyState?.(handle) ?? null;
    }

    preflightRouteLifecycleBatch(request = {}) {
        const result = this.simulation?.preflightRouteLifecycleBatch?.(request)
            ?? Object.freeze({
                abiVersion: GPU_ROUTE_LIFECYCLE_ABI_VERSION,
                accepted: false,
                reason: 'gpu-unavailable',
                requiresRecovery: false,
                targetFixedTick: readDiagnosticPositiveInteger(
                    request?.targetFixedTick
                ),
                batchIdFingerprint: readDiagnosticPositiveInteger(
                    request?.batchIdFingerprint
                ),
                spawnReservationCount: 0,
                cleanupReservationCount: 0,
                receipt: null
            });
        this.#syncState();
        return result;
    }

    commitRouteLifecycleBatch(receipt, publication = {}) {
        const result = this.simulation?.commitRouteLifecycleBatch?.(
            receipt,
            publication
        ) ?? Object.freeze({
            abiVersion: GPU_ROUTE_LIFECYCLE_ABI_VERSION,
            accepted: false,
            reason: 'gpu-unavailable',
            requiresRecovery: true,
            targetFixedTick: readDiagnosticPositiveInteger(
                publication?.targetFixedTick
            ),
            batchIdFingerprint: readDiagnosticPositiveInteger(
                publication?.batchIdFingerprint
            ),
            spawnedCount: 0,
            cleanedCount: 0,
            runtimeBinding: null
        });
        this.#syncState();
        return result;
    }

    cancelRouteLifecycleBatch(receipt, reason) {
        const result = this.simulation?.cancelRouteLifecycleBatch?.(
            receipt,
            reason
        ) ?? Object.freeze({
            abiVersion: GPU_ROUTE_LIFECYCLE_ABI_VERSION,
            accepted: false,
            reason: 'gpu-unavailable',
            cancelledSpawnReservationCount: 0,
            cancelledCleanupReservationCount: 0
        });
        this.#syncState();
        return result;
    }

    resolveExactRouteBodySlot(handle) {
        return this.simulation?.resolveExactRouteBodySlot?.(handle) ?? null;
    }

    stageRouteLifecycleCleanupBatch(request = {}) {
        const result = this.simulation?.stageRouteLifecycleCleanupBatch?.(request)
            ?? Object.freeze({
                accepted: false,
                reason: 'gpu-unavailable',
                stagedCount: 0
            });
        this.#syncState();
        return result;
    }

    drainCompletedRouteAvailabilityBatches(out = []) {
        if (!Array.isArray(out)) {
            throw new TypeError('RouteAvailability 완료 출력은 배열이어야 합니다.');
        }
        return this.simulation?.drainCompletedRouteAvailabilityBatches?.(out)
            ?? out;
    }

    getRouteAvailabilityRuntimeStatus() {
        return this.simulation?.getRouteAvailabilityRuntimeStatus?.()
            ?? Object.freeze({
                abiVersion: GPU_ROUTE_RUNTIME_ABI_VERSION,
                state: 'gpu-unavailable',
                sessionGeneration: this.sessionGeneration,
                deviceGeneration: 0,
                authoritativeEpoch: 0,
                ingressOpen: false,
                graphEnabled: false,
                graphContentKey: this.flowFieldAtlas?.contentKey ?? null,
                closureCount: 0,
                availabilityVersion: 1,
                closedPathIds: Object.freeze([]),
                rosterCount: 0,
                capacity: GPU_ROUTE_RUNTIME_MAX_CLOSERS,
                leaseCount: 0,
                lifecycleReservationCount: 0,
                stagedCount: 0,
                commitRequested: false,
                pendingReadbackCount: 0,
                queuedBatchCount: 0,
                completedThroughTick: 0,
                runtimeStatus: 0,
                storageBuffersPerStage: 9,
                requiresRecovery: false,
                failure: null,
                terminal: null
            });
    }

    cancelPendingRouteAvailabilityProgramsForTerminal(request = {}) {
        const result = this.simulation
            ?.cancelPendingRouteAvailabilityProgramsForTerminal?.(request)
            ?? Object.freeze({
                abiVersion: GPU_ROUTE_RUNTIME_ABI_VERSION,
                state: 'failed',
                accepted: false,
                finalFixedTick: readDiagnosticPositiveInteger(
                    request?.finalFixedTick
                ),
                failure: 'gpu-unavailable'
            });
        this.#syncState();
        return result;
    }

    getTerminalRouteAvailabilityProgramCancelStatus() {
        return this.simulation
            ?.getTerminalRouteAvailabilityProgramCancelStatus?.() ?? null;
    }

    getRouteLifecyclePortStatus() {
        const runtime = this.getRouteAvailabilityRuntimeStatus();
        return Object.freeze({
            abiVersion: GPU_ROUTE_LIFECYCLE_ABI_VERSION,
            state: runtime.state,
            reservationCount: runtime.lifecycleReservationCount ?? 0,
            stagedCleanupCount: runtime.stagedCount,
            pendingReadbackCount: runtime.pendingReadbackCount,
            rosterCount: runtime.rosterCount,
            requiresRecovery: runtime.requiresRecovery,
            failure: runtime.failure
        });
    }

    /** Terminal final submit 앞 unresolved fixed programs를 exact-set으로 취소합니다. */
    cancelPendingFixedProgramsForTerminal(request) {
        if (!this.simulation
            || typeof this.simulation.cancelPendingFixedProgramsForTerminal
                !== 'function') {
            return Object.freeze({
                abiVersion: request?.abiVersion ?? 0,
                finalFixedTick: request?.finalFixedTick ?? 0,
                accepted: false,
                state: 'failed',
                reason: 'gpu-unavailable',
                destinationCount: 0,
                priorityControlCount: 0
            });
        }
        const result = this.simulation
            .cancelPendingFixedProgramsForTerminal(request);
        this.#syncState();
        return result;
    }

    getTerminalFixedProgramCancelStatus() {
        return this.simulation?.getTerminalFixedProgramCancelStatus?.() ?? null;
    }

    hasPendingSpawnProgramThroughTick(sourceTick) {
        return this.simulation?.hasPendingSpawnProgramThroughTick?.(sourceTick) ?? false;
    }

    configureTowerGameplayTarget(handle = null) {
        return this.simulation?.configureTowerGameplayTarget?.(handle)
            ?? Object.freeze({ accepted: false, reason: 'gpu-unavailable' });
    }

    configureTrackedBody(handle = null) {
        return this.simulation?.configureTrackedBody?.(handle)
            ?? Object.freeze({ accepted: false, reason: 'gpu-unavailable' });
    }

    getObservedTrackedPose() {
        return this.simulation?.getObservedTrackedPose?.()
            ?? this.simulation?.getLatestTrackedPose?.()
            ?? null;
    }

    /** @deprecated generic observed 명칭의 compatibility alias입니다. */
    getLatestTrackedPose() {
        return this.getObservedTrackedPose();
    }

    /** 오디오/표현 소비자용 lossy 적 밀도 snapshot입니다. */
    getLatestCrowdDensitySnapshot() {
        return this.simulation?.getLatestCrowdDensitySnapshot?.() ?? null;
    }

    /** CPU TowerGroupState의 living exact roster를 독립 GPU mirror에 동기화합니다. */
    synchronizeTowerGroupRoster(source = {}) {
        if (!this.#ensureTowerGroupRuntime()) {
            return Object.freeze({
                accepted: false,
                reason: 'tower-group-runtime-unavailable'
            });
        }
        if (!Array.isArray(source.records)) {
            throw new TypeError('TowerGroup roster records 배열이 필요합니다.');
        }
        const livingRecords = source.records.filter((record) => (
            record?.alive === true
        ));
        if (livingRecords.length > this.towerGroupMemberCapacity) {
            return Object.freeze({
                accepted: false,
                reason: 'tower-group-member-capacity',
                memberCount: livingRecords.length,
                capacity: this.towerGroupMemberCapacity
            });
        }
        const protocol = this.getEventProtocolState();
        const members = [];
        for (const record of livingRecords) {
            const binding = record.exactGpuBinding;
            if (binding
                && (binding.sessionGeneration !== protocol.sessionGeneration
                    || binding.deviceGeneration !== protocol.deviceGeneration
                    || binding.authoritativeEpoch
                        !== protocol.authoritativeEpoch)) {
                return Object.freeze({
                    accepted: false,
                    reason: 'tower-group-member-stale-protocol',
                    logicalTowerId: record.logicalTowerId ?? null
                });
            }
            const exact = binding
                ? this.simulation.resolveExactBodySlot?.(binding)
                : null;
            if (!exact) {
                return Object.freeze({
                    accepted: false,
                    reason: 'tower-group-member-unbound',
                    logicalTowerId: record.logicalTowerId ?? null
                });
            }
            members.push(Object.freeze({
                slot: exact.slot,
                entityId: exact.handle.entityId,
                incarnation: exact.handle.incarnation,
                logicalTowerOrdinal: record.logicalTowerOrdinal,
                shareUnits: record.shareUnits,
                maxHpFixedPoint: record.maxHpFixedPoint,
                powerFixedPoint: record.powerFixedPoint,
                flags: GPU_TOWER_GROUP_MEMBER_FLAG.TOWER_NOUN
                    | GPU_TOWER_GROUP_MEMBER_FLAG.LIVING
            }));
        }
        try {
            const roster = this.towerGroupRuntime.synchronizeRoster({
                groupRevision: source.groupRevision,
                members,
                protocol
            });
            return Object.freeze({ accepted: true, roster });
        } catch (error) {
            return Object.freeze({
                accepted: false,
                reason: 'tower-group-roster-rejected',
                failure: Object.freeze({
                    name: String(error?.name ?? 'Error'),
                    message: String(error?.message ?? error)
                })
            });
        }
    }

    /** fixed tick당 정확히 하나의 group move/Aim command를 stage합니다. */
    stageTowerGroupCommand(source = {}) {
        if (!this.#ensureTowerGroupRuntime()) {
            return Object.freeze({
                accepted: false,
                reason: 'tower-group-runtime-unavailable'
            });
        }
        try {
            const command = this.towerGroupRuntime.stageCommand({
                ...source,
                protocol: this.getEventProtocolState()
            });
            const commandId = source.commandId ?? [
                'gpu-tower-group-control',
                command.protocol.sessionGeneration,
                command.groupRevision,
                command.sourceTick,
                command.commandFingerprint
            ].join(':');
            return Object.freeze({
                accepted: true,
                commandId,
                sourceTick: command.sourceTick,
                command
            });
        } catch (error) {
            return Object.freeze({
                accepted: false,
                reason: 'tower-group-command-rejected',
                failure: Object.freeze({
                    name: String(error?.name ?? 'Error'),
                    message: String(error?.message ?? error)
                })
            });
        }
    }

    /** camera/presentation 전용 bounded lossy TowerGroup summary입니다. */
    getLatestTowerGroupSummary() {
        return this.towerGroupRuntime.getLatestSummary();
    }

    getTowerGroupRuntimeStatus() {
        return this.towerGroupRuntime.getStatus();
    }

    /**
     * @param {number} delta - 초 단위 fixed delta입니다.
     * @param {number} [sourceTick] - 이 submit을 소유하는 권위 fixed tick입니다.
     */
    fixedUpdate(delta, sourceTick) {
        if (!this.simulation) {
            return false;
        }
        const hadActiveBodies = this.simulation.getActiveBodyCount() > 0;
        const payloadSubmission = Number.isSafeInteger(Number(sourceTick))
            && Number(sourceTick) >= 0
            ? this.submitActorPayloadMaterializations(sourceTick)
            : Object.freeze({ submittedCount: 0, deferredCount: 0 });
        const abilitySubmission = Number.isSafeInteger(Number(sourceTick))
            && Number(sourceTick) >= 0
            ? this.submitAbilitySubjectSnapshots(sourceTick)
            : Object.freeze({ submittedCount: 0, deferredCount: 0 });
        const submitted = this.simulation.fixedUpdate(delta, sourceTick);
        const towerGroupCommand = this.towerGroupRuntime.getStagedCommand();
        if (submitted
            && Number.isSafeInteger(Number(sourceTick))
            && Number(sourceTick) > 0
            && towerGroupCommand?.sourceTick === Number(sourceTick)
            && this.towerGroupRuntime.getStatus().lastEncodedTick
                === Number(sourceTick)) {
            this.towerGroupRuntime.submitSummary({
                sourceTick: Number(sourceTick),
                submittedTick: Number(sourceTick)
            });
        }
        this.#syncState();
        return submitted || (!hadActiveBodies
            && (abilitySubmission.submittedCount > 0
                || payloadSubmission.submittedCount > 0));
    }

    /**
     * 완료된 GPU event readback batch를 제출 순서대로 caller 배열에 이동합니다.
     * 구형 injected simulation에는 event API가 없을 수 있으므로 빈 결과로 호환합니다.
     * @param {object[]} [out=[]] - batch 출력 배열입니다.
     * @returns {object[]} 동일 out입니다.
     */
    drainCompletedEventBatches(out = []) {
        if (!Array.isArray(out)) {
            throw new TypeError('GPU 완료 event batch 출력은 배열이어야 합니다.');
        }
        if (typeof this.simulation?.drainCompletedEventBatches !== 'function') {
            return out;
        }
        const drained = this.simulation.drainCompletedEventBatches(out);
        return Array.isArray(drained) ? drained : out;
    }

    /** @param {object} frame - frame delta/fixed alpha 표현 입력입니다. */
    updatePresentation(frame) {
        return this.simulation?.updatePresentation(frame) ?? null;
    }

    /** pause/resume 경계에서 남은 GPU render prediction을 제거합니다. */
    synchronizePresentation() {
        this.simulation?.synchronizePresentation();
    }

    /** @param {object} camera - 현재 WorldCamera2D입니다. */
    draw(camera) {
        if (!this.simulation) {
            return false;
        }
        const submitted = this.simulation.draw(camera);
        this.#syncState();
        return submitted;
    }

    /** @returns {object|null} map setup에서 생성한 immutable SDF snapshot입니다. */
    getSignedDistanceField() {
        return this.signedDistanceField;
    }

    /** @returns {object|null} 기존 JS/WASM 방향 plane으로 만든 route-stage atlas입니다. */
    getFlowFieldAtlas() {
        return this.flowFieldAtlas;
    }

    /** @returns {object} backend 진단 snapshot입니다. */
    getStatus() {
        if (!this.destroyed) {
            this.#syncState();
        }
        const gpu = this.simulation?.getStatus() ?? null;
        return Object.freeze({
            state: this.state,
            initialized: this.initialized,
            navigationSize: this.navigationGrid?.size ?? 0,
            flowFieldCount: this.flowFieldAtlas?.fieldCount ?? 0,
            events: gpu?.events ?? null,
            ...(this.simulation ? {
                abilitySubjectSnapshots:
                    this.abilitySubjectSnapshotRuntime.getStatus(),
                actorPayloadMaterializations:
                    this.getActorPayloadMaterializationStatus(),
                towerGroup: this.towerGroupRuntime.getStatus()
            } : {}),
            gpu
        });
    }

    /** Facade event envelope 검증용 현재 session/device/epoch 상태입니다. */
    getEventProtocolState() {
        const protocol = this.simulation?.getEventProtocolState?.() ?? null;
        if (protocol
            && protocol.sessionGeneration === this.sessionGeneration
            && protocol.deviceGeneration === -1
            && protocol.authoritativeEpoch === 0
            && protocol.submittedTickCount === 0
            && this.simulation?.getRuntimeState?.() === 'idle') {
            return Object.freeze({
                ...protocol,
                // 아직 device를 소유한 적 없는 pristine simulation은
                // completion이 없는 CPU host epoch에서 시작합니다.
                deviceGeneration: 0
            });
        }
        return protocol ?? Object.freeze({
            sessionGeneration: this.sessionGeneration,
            // GPU가 없는 CPU fallback도 Effect/Formation completion owner가
            // empty boundary를 정상 관찰할 수 있는 host protocol epoch입니다.
            deviceGeneration: 0,
            authoritativeEpoch: 0,
            submittedTickCount: 0
        });
    }

    /** @returns {string} 할당 없는 backend runtime state입니다. */
    getRuntimeState() {
        if (!this.destroyed) {
            this.#syncState();
        }
        return this.state;
    }

    /** @returns {number} stable GPU enemy slot의 session 상한입니다. */
    getCapacity() {
        return this.capacity;
    }

    /** @returns {boolean} 현재 활성 GPU 적이 하나 이상 있는지 여부입니다. */
    hasActiveBodies() {
        return (this.simulation?.getActiveBodyCount() ?? 0) > 0;
    }

    /** @returns {boolean} 상위 session이 spawn/진행을 멈추고 복구해야 하는 상태입니다. */
    requiresRecovery() {
        if (!this.destroyed) {
            this.#syncState();
        }
        return this.state === 'gpu-requires-rebuild'
            || this.state === 'gpu-overflow-degraded'
            || this.state === 'gpu-backpressure'
            || this.state === 'gpu-terminal-unavailable'
            || this.state === 'gpu-failed'
            || this.abilitySubjectSnapshotRuntime.requiresRecovery()
            || this.actorPayloadMaterializationRuntime.requiresRecovery()
            || this.towerGroupRuntime.requiresRecovery()
            || this.actorPayloadPreleaseFailure !== null;
    }

    /** 반복 호출 가능한 session teardown입니다. */
    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.cancelAllActorPayloadMaterializations('destroyed');
        this.actorPayloadMaterializationRuntime.destroy();
        this.abilitySubjectSnapshotRuntime.destroy();
        this.simulation?.attachTowerGroupControlRuntime?.(null);
        this.towerGroupRuntime.destroy();
        this.simulation?.destroy();
        this.simulation = null;
        this.signedDistanceField = null;
        this.flowFieldAtlas = null;
        this.flowRouteByPathId.clear();
        this.defaultPlayerCreatedHostileRoute = null;
        this.navigationGrid = null;
        this.initialized = false;
        this.state = 'destroyed';
    }

    #syncState() {
        if (this.towerGroupRuntime.requiresRecovery()) {
            this.state = 'gpu-requires-rebuild';
            return;
        }
        const gpuState = this.simulation?.getRuntimeState();
        switch (gpuState) {
            case 'ready':
                this.state = 'gpu-ready';
                break;
            case 'idle':
                this.state = 'gpu-deferred';
                break;
            case 'requires-rebuild':
                this.state = 'gpu-requires-rebuild';
                break;
            case 'overflow-degraded':
                this.state = 'gpu-overflow-degraded';
                break;
            case 'telemetry-backpressure':
            case 'event-backpressure':
                this.state = 'gpu-backpressure';
                break;
            case 'event-overflow-degraded':
            case 'contact-overflow-degraded':
            case 'failed':
                this.state = gpuState === 'failed'
                    ? 'gpu-failed'
                    : 'gpu-overflow-degraded';
                break;
            default:
                this.state = classifyUnavailablePlatformState(this.webGpuPlatformPort);
                break;
        }
    }

    #ensureTowerGroupRuntime() {
        if (this.destroyed || !this.simulation) return false;
        if (!this.simulation.device || !this.simulation.buffers) {
            this.simulation.init();
        }
        const simulation = this.simulation;
        if (!simulation.device || !simulation.buffers) return false;
        const protocol = simulation.getEventProtocolState();
        const status = this.towerGroupRuntime.getStatus();
        const alreadyCurrent = status.state === 'ready'
            && this.towerGroupRuntime.device === simulation.device
            && status.sessionGeneration === protocol.sessionGeneration
            && status.deviceGeneration === protocol.deviceGeneration
            && status.authoritativeEpoch === protocol.authoritativeEpoch;
        if (!alreadyCurrent) {
            try {
                this.towerGroupRuntime.initialize(
                    simulation.device,
                    {
                        counts: simulation.buffers.counts,
                        physics: simulation.buffers.physics,
                        simulation: simulation.buffers.simulation,
                        bodyControlStates: simulation.buffers.bodyControlStates
                    },
                    protocol
                );
            } catch {
                return false;
            }
        }
        simulation.attachTowerGroupControlRuntime(this.towerGroupRuntime);
        return true;
    }

    #ensureAbilitySubjectSnapshotRuntime() {
        if (this.destroyed || !this.simulation) return false;
        if (!this.simulation.device || !this.simulation.buffers) {
            this.simulation.init();
        }
        const simulation = this.simulation;
        if (!simulation.device || !simulation.buffers) return false;
        try {
            return this.abilitySubjectSnapshotRuntime.initialize(
                simulation.device,
                {
                    counts: simulation.buffers.counts,
                    physics: simulation.buffers.physics,
                    simulation: simulation.buffers.simulation,
                    contactHandlers: simulation.buffers.contactHandlers,
                    enemyBehaviorStates:
                        simulation.buffers.enemyBehaviorStates,
                    routeRuntimeStates: simulation.buffers.routeRuntimeStates
                },
                {
                    deviceGeneration: simulation.deviceGeneration,
                    authoritativeEpoch: simulation.authoritativeEpoch
                }
            );
        } catch {
            return false;
        }
    }

    #ensureActorPayloadMaterializationRuntime(snapshotBinding) {
        if (this.destroyed || !this.simulation) return false;
        if (!this.#ensureAbilitySubjectSnapshotRuntime()) return false;
        const snapshotBuffer = snapshotBinding?.buffer
            ?? this.abilitySubjectSnapshotRuntime.buffers?.output;
        const simulation = this.simulation;
        if (!snapshotBuffer
            || !simulation.device
            || !simulation.buffers
            || !this.abilitySubjectSnapshotRuntime.buffers?.metadata) {
            return false;
        }
        try {
            return this.actorPayloadMaterializationRuntime.initialize(
                simulation.device,
                {
                    snapshot: snapshotBuffer,
                    physics: simulation.buffers.physics,
                    simulation: simulation.buffers.simulation,
                    abilityMetadata:
                        this.abilitySubjectSnapshotRuntime.buffers.metadata,
                    routeRuntimeStates:
                        simulation.buffers.routeRuntimeStates,
                    enemyBehaviorStates:
                        simulation.buffers.enemyBehaviorStates,
                    sdf: simulation.buffers.sdf
                },
                {
                    deviceGeneration: simulation.deviceGeneration,
                    authoritativeEpoch: simulation.authoritativeEpoch
                }
            );
        } catch (error) {
            this.actorPayloadPreleaseFailure = Object.freeze({
                stage: 'actor-payload-runtime-initialize',
                name: String(error?.name ?? 'Error'),
                message: String(error?.message ?? error)
            });
            return false;
        }
    }

    #rollbackUntrackedActorPayloadPrelease(prelease) {
        const simulation = this.simulation;
        if (!simulation || !prelease?.records) return false;
        try {
            let restoredCount = 0;
            for (const entry of prelease.records) {
                if (simulation.slotActive[entry.slot] === 2
                    && simulation.pendingHandleToSlot.get(entry.key)
                        === entry.slot) {
                    simulation.pendingHandleToSlot.delete(entry.key);
                    simulation.pendingSlotHandles[entry.slot] = null;
                    simulation.slotActive[entry.slot] = 1;
                    simulation.slotHandles[entry.slot] = entry.handle;
                    simulation.handleToSlot.set(entry.key, entry.slot);
                    restoredCount++;
                }
            }
            if (restoredCount > 0) {
                simulation.pendingBodyCount -= restoredCount;
                simulation.activeBodyCount += restoredCount;
            }
            const result = simulation.despawnBodies(prelease.handles);
            const clean = result?.removed === prelease.records.length
                && result?.rejected === 0;
            if (!clean) {
                this.actorPayloadPreleaseFailure = Object.freeze({
                    stage: 'actor-payload-prelease-rollback',
                    message: 'pending body prelease를 전체 회수하지 못했습니다.'
                });
            }
            return clean;
        } catch (error) {
            this.actorPayloadPreleaseFailure = Object.freeze({
                stage: 'actor-payload-prelease-rollback',
                name: String(error?.name ?? 'Error'),
                message: String(error?.message ?? error)
            });
            return false;
        }
    }

    #resolveBodyFlow(body, bodyIndex) {
        if (!body || typeof body !== 'object') {
            throw new TypeError(`enemy simulation body가 객체가 아닙니다: index=${bodyIndex}`);
        }
        if (body.pathId === undefined || body.pathId === null) {
            return body;
        }
        const route = this.flowRouteByPathId.get(body.pathId);
        if (!route) {
            throw new RangeError(`등록되지 않은 enemy pathId입니다: ${String(body.pathId)}`);
        }
        const waypointIndex = body.waypointIndex ?? route.firstTargetWaypointIndex;
        if (!Number.isInteger(waypointIndex)) {
            throw new TypeError(`enemy waypointIndex는 정수여야 합니다: index=${bodyIndex}`);
        }
        const routeFieldOffset = waypointIndex - route.firstTargetWaypointIndex;
        if (routeFieldOffset < 0 || routeFieldOffset >= route.fieldCount) {
            throw new RangeError(
                `enemy waypointIndex가 route field 범위를 벗어났습니다: ${route.pathId}/${waypointIndex}`
            );
        }
        if (!Number.isInteger(route.firstFieldIndex)
            || route.firstFieldIndex < 0
            || route.firstFieldIndex > 0xff
            || !Number.isInteger(route.fieldCount)
            || route.fieldCount <= 0
            || route.fieldCount > 0x1ff
            || route.firstFieldIndex + route.fieldCount
                > (this.flowFieldAtlas?.fieldCount ?? 0)) {
            throw new RangeError(
                `enemy route Effect span이 atlas/packed 범위를 벗어났습니다: ${route.pathId}`
            );
        }
        return {
            ...body,
            useFlow: true,
            flowFieldIndex: route.firstFieldIndex + routeFieldOffset,
            flowSpeed: body.flowSpeed ?? body.maxSpeed,
            // Independent PEmitter navigation plane용 route span입니다.
            effectRouteFirstFieldIndex: route.firstFieldIndex,
            effectRouteFieldCount: route.fieldCount,
            formationRouteFirstFieldIndex: route.firstFieldIndex,
            formationRouteFieldCount: route.fieldCount,
            routeFirstFieldIndex: route.firstFieldIndex,
            routeFieldCount: route.fieldCount
        };
    }
}
