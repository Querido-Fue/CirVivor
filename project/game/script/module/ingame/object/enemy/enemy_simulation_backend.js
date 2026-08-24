import {
    GPU_BODY_PRESENTATION_PROFILE
} from '../../physics/gpu/gpu_body_presentation_clock.js';
import { GpuCircleBodySimulation } from '../../physics/gpu/gpu_circle_body_simulation.js';
import {
    createGpuSignedDistanceField
} from '../../physics/gpu/gpu_signed_distance_field.js';
import {
    createGpuCollisionGridDescriptor
} from '../../physics/gpu/gpu_collision_grid_contract.js';
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
    GpuActorActionPlacementRuntime
} from '../../physics/gpu/gpu_actor_action_placement_runtime.js';
import {
    GpuActorTransitRuntime
} from '../../physics/gpu/gpu_actor_transit_runtime.js';
import {
    GPU_TOWER_GROUP_MEMBER_FLAG
} from '../../physics/gpu/gpu_tower_group_abi.js';
import {
    GpuTowerGroupRuntime
} from '../../physics/gpu/gpu_tower_group_runtime.js';
import {
    GpuTowerCreationRuntime
} from '../../physics/gpu/gpu_tower_creation_runtime.js';
import {
    GPU_TOWER_MERGE_RECORD_ROLE
} from '../../physics/gpu/gpu_tower_merge_abi.js';
import {
    GpuTowerMergeRuntime
} from '../../physics/gpu/gpu_tower_merge_runtime.js';
import {
    GpuTowerTransactionRuntimeMux
} from '../../physics/gpu/gpu_tower_transaction_runtime_mux.js';
import {
    GpuTowerTargetQueryRuntime
} from '../../physics/gpu/gpu_tower_target_query_runtime.js';
import {
    GPU_TOWER_CREATION_MODE,
    GPU_TOWER_CREATION_RECORD_KIND
} from '../../physics/gpu/gpu_tower_creation_abi.js';
import {
    GPU_ABILITY_SUBJECT_SNAPSHOT_ABI,
    clearGpuAbilityEntityMetadata,
    writeGpuAbilityEntityMetadata
} from '../../physics/gpu/gpu_ability_subject_snapshot_abi.js';
import {
    GPU_CIRCLE_BODY_ABI,
    GPU_CIRCLE_BODY_META,
    GPU_CIRCLE_BODY_SIMULATION_FLAG
} from '../../physics/gpu/gpu_circle_body_abi.js';
import {
    GPU_FIXED_PRIMITIVE_ABI
} from '../../physics/gpu/gpu_fixed_primitive_abi.js';
import {
    SENTENCE_ACTION_CODE
} from '../../contract/word_sentence_contract.js';
import {
    BASIC_CIRCLE_ENEMY_DATA
} from 'data/object/enemy/basic_circle_enemy_data.js';
import {
    THE_TOWER_RUNTIME_DATA
} from 'data/object/tower/the_tower_data.js';
import {
    createGpuEnemySpawnIntent
} from './gpu_enemy_spawn_adapter.js';
import {
    TOWER_MERGE_LIFECYCLE_DISPOSITION
} from '../tower/tower_group_contract.js';

const SOURCE_GRID_TO_SDF_CELL_RATIO = 12 / 8;
const SOURCE_WORLD_UNIT_TO_SDF_CELL_RATIO = 1 / 8;
const DEFAULT_BODY_CAPACITY = 16384;
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
        this.actorActionPlacementCommandCapacity
            = options.actorActionPlacementCommandCapacity;
        this.actorActionPlacementSubjectCapacity
            = options.actorActionPlacementSubjectCapacity;
        this.actorActionPlacementDestinationCapacity
            = options.actorActionPlacementDestinationCapacity;
        this.actorActionPlacementReadbackSlotCount
            = options.actorActionPlacementReadbackSlotCount;
        this.actorTransitReadbackSlotCount
            = options.actorTransitReadbackSlotCount;
        const towerGroupMemberCapacity = requirePositiveSafeInteger(
            options.towerGroupMemberCapacity
                ?? Math.min(
                    this.capacity,
                    THE_TOWER_RUNTIME_DATA.PRODUCTION_TOWER_CAPACITY
                ),
            'towerGroupMemberCapacity'
        );
        if (towerGroupMemberCapacity > this.capacity) {
            throw new RangeError('towerGroupMemberCapacity는 body capacity를 넘을 수 없습니다.');
        }
        this.towerGroupMemberCapacity = towerGroupMemberCapacity;
        this.towerGroupReadbackSlotCount = options.towerGroupReadbackSlotCount;
        this.towerCreationReadbackSlotCount
            = options.towerCreationReadbackSlotCount;
        this.towerMergeReadbackSlotCount
            = options.towerMergeReadbackSlotCount;
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
        this.actorActionPlacementRuntime
            = new GpuActorActionPlacementRuntime({
                sessionGeneration: this.sessionGeneration,
                commandCapacity: this.actorActionPlacementCommandCapacity,
                subjectCapacity: this.actorActionPlacementSubjectCapacity,
                destinationCapacity:
                    this.actorActionPlacementDestinationCapacity,
                readbackSlotCount:
                    this.actorActionPlacementReadbackSlotCount
            });
        this.actorTransitRuntime = new GpuActorTransitRuntime({
            sessionGeneration: this.sessionGeneration,
            readbackSlotCount: this.actorTransitReadbackSlotCount
        });
        this.actorActionPlacementOwners = new Map();
        this.actorActionPlacementCompletionQueues = new Map();
        this.actorTransitCompletionQueues = new Map();
        this.towerGroupRuntime = new GpuTowerGroupRuntime({
            // Member records are addressed by stable body slot. The separate
            // towerGroupMemberCapacity remains the production member-count cap.
            capacity: this.capacity,
            readbackSlotCount: this.towerGroupReadbackSlotCount
        });
        this.towerCreationRuntime = new GpuTowerCreationRuntime({
            bodyCapacity: this.capacity,
            recordCapacity: this.towerGroupMemberCapacity,
            readbackSlotCount: this.towerCreationReadbackSlotCount
        });
        this.towerMergeRuntime = new GpuTowerMergeRuntime({
            bodyCapacity: this.capacity,
            recordCapacity: Math.min(this.towerGroupMemberCapacity, 256),
            readbackSlotCount: this.towerMergeReadbackSlotCount
        });
        this.towerTransactionRuntime = new GpuTowerTransactionRuntimeMux(
            this.towerCreationRuntime,
            this.towerMergeRuntime
        );
        this.towerTargetQueryRuntime = new GpuTowerTargetQueryRuntime({
            capacity: this.capacity
        });
        this.towerCreationBodyPreleases = new Map();
        this.towerCreationPreleaseHighWater = 0;
        this.towerCreationFailure = null;
        this.towerMergeTransactions = new Map();
        this.towerMergeCommittedCleanups = new Map();
        this.towerMergeFailure = null;
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

    /** R5 Tower payload의 snapshot→placement→creation GPU chain capability입니다. */
    supportsGpuSubjectActorActionTowerCreation() {
        return this.#ensureTowerCreationRuntime()
            && this.#ensureActorActionPlacementRuntime(null);
    }

    canStageActorActionPlacement(request = {}) {
        return this.#ensureActorActionPlacementRuntime(null)
            && this.actorActionPlacementRuntime.canAccept(request);
    }

    stageActorActionPlacement(request = {}) {
        if (!this.#ensureActorActionPlacementRuntime(
            request.snapshotBinding ?? null
        )) {
            return Object.freeze({
                accepted: false,
                retryable: false,
                reason: 'actor-action-placement-runtime-unavailable'
            });
        }
        const completionOwner = String(
            request.completionOwner ?? 'default'
        );
        if (completionOwner.length === 0) {
            return Object.freeze({
                accepted: false,
                retryable: false,
                reason: 'actor-action-placement-completion-owner'
            });
        }
        const result = this.actorActionPlacementRuntime.stage(request);
        if (result?.accepted === true) {
            this.actorActionPlacementOwners.set(
                String(request.transactionId),
                completionOwner
            );
        }
        return result;
    }

    submitActorActionPlacements(sourceTick) {
        return this.actorActionPlacementRuntime
            .submitPendingForFixedTick(sourceTick);
    }

    drainCompletedActorActionPlacements(out = [], completionOwner = 'default') {
        if (!Array.isArray(out)) {
            throw new TypeError('actor action placement completion 출력은 배열이어야 합니다.');
        }
        this.#routeActorActionPlacementCompletions();
        const owner = String(completionOwner);
        const queue = this.actorActionPlacementCompletionQueues.get(owner);
        if (queue?.length > 0) out.push(...queue);
        this.actorActionPlacementCompletionQueues.delete(owner);
        return out;
    }

    getActorActionPlacementGpuBinding(token) {
        return this.actorActionPlacementRuntime.getPlacementGpuBinding(token);
    }

    releaseActorActionPlacement(token) {
        return this.actorActionPlacementRuntime.releasePlacement(token);
    }

    cancelAllActorActionPlacements(reason = 'cancelled') {
        const result = this.actorActionPlacementRuntime.cancelAll(reason);
        this.#routeActorActionPlacementCompletions();
        return result;
    }

    getActorActionPlacementRuntimeStatus() {
        return this.actorActionPlacementRuntime.getStatus();
    }

    registerCommittedActorTransitBatch(source = {}) {
        if (!this.#ensureActorTransitRuntime()) return false;
        return this.actorTransitRuntime.registerCommittedBatch(source);
    }

    advanceActorTransits(sourceTick) {
        if (!this.#ensureActorTransitRuntime()) return false;
        return this.actorTransitRuntime.advanceForFixedTick(sourceTick);
    }

    drainCompletedActorTransits(out = [], completionOwner = 'default') {
        if (!Array.isArray(out)) {
            throw new TypeError('actor transit completion 출력은 배열이어야 합니다.');
        }
        this.#routeActorTransitCompletions();
        const owner = String(completionOwner);
        const queue = this.actorTransitCompletionQueues.get(owner);
        if (queue?.length > 0) out.push(...queue);
        this.actorTransitCompletionQueues.delete(owner);
        return out;
    }

    isActorTransitAirborne(handle) {
        return this.actorTransitRuntime.isAirborne(handle);
    }

    getActorTransitRuntimeStatus() {
        return this.actorTransitRuntime.getStatus();
    }

    getActorActionPlacementSdfDescriptor() {
        const simulation = this.simulation;
        if (!simulation?.sdf || !simulation?.worldSize) return null;
        return Object.freeze({
            enabled: simulation.sdf.enabled === true,
            cols: simulation.sdf.cols ?? 1,
            rows: simulation.sdf.rows ?? 1,
            worldWidth: simulation.worldSize.x,
            worldHeight: simulation.worldSize.y
        });
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

    canStageActorPayloadMaterialization(request = {}) {
        return this.#ensureActorPayloadMaterializationRuntime(null)
            && this.actorPayloadMaterializationRuntime.canAccept(request);
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
        if (!prelease || !['preleased', 'placement-pending'].includes(
            prelease.state
        )) {
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
        const subjectCount = Number(request.subjectCompletion?.subjectCount);
        const copiesPerSubject = Number(
            request.command?.copiesPerSubject ?? 1
        );
        const modifierSetFingerprint = Number(
            request.command?.modifierSetFingerprint ?? 0
        );
        if (!Number.isSafeInteger(subjectCount) || subjectCount <= 0
            || !Number.isSafeInteger(copiesPerSubject)
            || copiesPerSubject <= 0
            || subjectCount > Math.floor(0xffffffff / copiesPerSubject)
            || subjectCount * copiesPerSubject !== prelease.records.length
            || !Number.isSafeInteger(modifierSetFingerprint)
            || modifierSetFingerprint < 0
            || modifierSetFingerprint > 0xffffffff) {
            return Object.freeze({
                accepted: false,
                reason: 'actor-payload-cardinality-contract'
            });
        }
        const destinationCount = prelease.records.length;
        let destinationFingerprint = hashAbilityPayloadWord(
            ABILITY_PAYLOAD_FNV_OFFSET,
            request.command?.fingerprint
        );
        for (const word of [
            subjectCount,
            destinationCount,
            copiesPerSubject,
            modifierSetFingerprint
        ]) {
            destinationFingerprint = hashAbilityPayloadWord(
                destinationFingerprint,
                word
            );
        }
        const destinationLeases = prelease.records.map((entry, index) => {
            const snapshotRank = Math.floor(index / copiesPerSubject);
            const copyIndex = index % copiesPerSubject;
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
            destinationFingerprint = hashAbilityPayloadWord(
                destinationFingerprint,
                snapshotRank
            );
            destinationFingerprint = hashAbilityPayloadWord(
                destinationFingerprint,
                index
            );
            destinationFingerprint = hashAbilityPayloadWord(
                destinationFingerprint,
                copyIndex
            );
            return Object.freeze({
                destinationSlot: entry.slot,
                destinationEntityId: entry.handle.entityId,
                destinationIncarnation: entry.handle.incarnation,
                snapshotRank,
                copyIndex,
                baselineFlags: entry.baselineFlags,
                defaultRouteMeta: entry.defaultRouteMeta,
                defaultRouteProfileCode: entry.defaultRouteProfileCode
            });
        });
        if (destinationFingerprint === 0) {
            destinationFingerprint = ABILITY_PAYLOAD_FNV_OFFSET;
        }
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

    stageActorPayloadActionPlacement(request = {}) {
        const prelease = this.actorPayloadBodyPreleases.get(
            request.preleaseToken
        );
        if (!prelease || prelease.state !== 'preleased') {
            return Object.freeze({
                accepted: false,
                reason: 'actor-payload-prelease-token'
            });
        }
        const subjectCount = Number(request.subjectCompletion?.subjectCount);
        const copiesPerSubject = Number(
            request.command?.copiesPerSubject ?? 1
        );
        if (!Number.isSafeInteger(subjectCount) || subjectCount <= 0
            || !Number.isSafeInteger(copiesPerSubject)
            || copiesPerSubject <= 0
            || subjectCount > Math.floor(0xffffffff / copiesPerSubject)
            || subjectCount * copiesPerSubject !== prelease.records.length) {
            return Object.freeze({
                accepted: false,
                reason: 'actor-payload-cardinality-contract'
            });
        }
        const destinationLeases = Object.freeze(prelease.records.map(
            (entry, index) => Object.freeze({
                destinationSlot: entry.slot,
                destinationEntityId: entry.handle.entityId,
                destinationIncarnation: entry.handle.incarnation,
                snapshotRank: Math.floor(index / copiesPerSubject),
                destinationRank: index,
                copyIndex: index % copiesPerSubject,
                baselineFlags: entry.baselineFlags
            })
        ));
        const result = this.stageActorActionPlacement({
            ...request,
            destinationLeases,
            completionOwner: 'actor-payload',
            sdf: request.sdf ?? this.getActorActionPlacementSdfDescriptor()
        });
        if (result?.accepted === true) {
            prelease.state = 'placement-pending';
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
            if (!this.#ensureAbilitySubjectSnapshotRuntime()) {
                throw new Error('Tower ability metadata runtime을 초기화하지 못했습니다.');
            }
            const metadataLayout
                = GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.ENTITY_METADATA;
            const metadataView = new DataView(
                this.abilitySubjectSnapshotRuntime.metadataBytes
            );
            for (const member of members) {
                const offset = member.slot * metadataLayout.STRIDE
                    + metadataLayout.POWER_FIXED_POINT;
                metadataView.setUint32(
                    offset,
                    member.powerFixedPoint,
                    LITTLE_ENDIAN
                );
                this.simulation.device.queue.writeBuffer(
                    this.abilitySubjectSnapshotRuntime.buffers.metadata,
                    offset,
                    this.abilitySubjectSnapshotRuntime.metadataBytes,
                    offset,
                    Uint32Array.BYTES_PER_ELEMENT
                );
            }
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

    getAvailableTowerCreationBodyCapacity() {
        const simulation = this.simulation;
        if (!simulation) return 0;
        return Math.max(
            0,
            this.capacity
                - Number(simulation.activeBodyCount ?? 0)
                - Number(simulation.pendingBodyCount ?? 0)
        );
    }

    canStageTowerCreation() {
        return this.#ensureTowerCreationRuntime()
            && this.towerCreationRuntime.canAccept()
            && this.towerTransactionRuntime.canStageCreation()
            && this.towerCreationBodyPreleases.size === 0
            && this.towerMergeTransactions.size === 0
            && this.towerMergeCommittedCleanups.size === 0;
    }

    /** Registry reservation과 같은 rank의 dead/invisible Tower body를 0/N prelease합니다. */
    preleaseTowerCreationBodies(request = {}) {
        const handles = request.handles;
        const spawnIntents = request.spawnIntents;
        if (!Array.isArray(handles) || handles.length === 0
            || !Array.isArray(spawnIntents)
            || spawnIntents.length !== handles.length) {
            throw new TypeError('Tower creation handles/spawnIntents rank가 필요합니다.');
        }
        if (!this.#ensureTowerCreationRuntime()
            || !this.towerCreationRuntime.canAccept()
            || !this.towerTransactionRuntime.canStageCreation()
            || this.towerMergeTransactions.size > 0
            || this.towerMergeCommittedCleanups.size > 0) {
            return Object.freeze({
                accepted: false,
                reason: 'tower-creation-program-capacity',
                requestedCount: handles.length,
                preleasedCount: 0,
                requiresRecovery: this.towerCreationRuntime.requiresRecovery()
            });
        }
        if (handles.length > this.getAvailableTowerCreationBodyCapacity()) {
            return Object.freeze({
                accepted: false,
                reason: 'tower-creation-body-capacity',
                requestedCount: handles.length,
                preleasedCount: 0,
                requiresRecovery: false
            });
        }
        const keys = new Set();
        const bodies = handles.map((handle, index) => {
            const entityId = Number(handle?.entityId);
            const incarnation = Number(handle?.incarnation);
            const key = abilityPayloadHandleKey(handle);
            if (!Number.isSafeInteger(entityId) || entityId <= 0
                || !Number.isSafeInteger(incarnation) || incarnation <= 0
                || keys.has(key)) {
                throw new RangeError('Tower creation destination handle이 잘못됐습니다.');
            }
            keys.add(key);
            const intent = spawnIntents[index];
            if (!intent || typeof intent !== 'object') {
                throw new TypeError(`Tower creation spawnIntents[${index}]가 필요합니다.`);
            }
            return {
                ...intent,
                entityId,
                incarnation
            };
        });
        const result = this.simulation.spawnBodies(bodies);
        const full = result?.accepted === handles.length
            && result?.rejected === 0
            && handles.every((handle) => this.simulation.hasBody(handle));
        if (!full) {
            const spawned = handles.filter((handle) => (
                this.simulation.hasBody(handle)
            ));
            let rollbackClean = true;
            if (spawned.length > 0) {
                const rollback = this.simulation.despawnBodies(spawned);
                rollbackClean = rollback?.removed === spawned.length
                    && rollback?.rejected === 0;
            }
            if (!rollbackClean) {
                this.towerCreationFailure = Object.freeze({
                    stage: 'tower-creation-body-prelease-partial',
                    message: 'Tower body prelease partial result를 전량 회수하지 못했습니다.'
                });
            }
            this.#syncState();
            return Object.freeze({
                accepted: false,
                reason: result?.reason ?? 'tower-creation-body-prelease',
                requestedCount: handles.length,
                preleasedCount: 0,
                requiresRecovery: !rollbackClean
            });
        }

        const records = [];
        for (let index = 0; index < handles.length; index++) {
            const exact = this.simulation.resolveExactBodySlot(handles[index]);
            if (!exact) {
                this.simulation.despawnBodies(handles);
                this.towerCreationFailure = Object.freeze({
                    stage: 'tower-creation-slot-prelease',
                    message: `Tower destination slot을 찾지 못했습니다: ${index}`
                });
                this.#syncState();
                return Object.freeze({
                    accepted: false,
                    reason: 'tower-creation-slot-identity',
                    requestedCount: handles.length,
                    preleasedCount: 0,
                    requiresRecovery: true
                });
            }
            const simulationView = new DataView(
                this.simulation.hostStorage.simulationBuffer
            );
            const simulationLayout = GPU_CIRCLE_BODY_ABI.SIMULATION;
            records.push({
                slot: exact.slot,
                handle: Object.freeze({ ...exact.handle }),
                key: abilityPayloadHandleKey(exact.handle),
                baselineFlags: simulationView.getUint32(
                    exact.slot * simulationLayout.STRIDE
                        + simulationLayout.FLAGS,
                    LITTLE_ENDIAN
                )
            });
        }
        const cleared = this.abilitySubjectSnapshotRuntime
            .synchronizeEntityMetadata(records.map(({ slot }) => ({
                slot,
                metadata: null
            })));
        if (cleared?.accepted !== true) {
            this.simulation.despawnBodies(handles);
            this.towerCreationFailure = Object.freeze({
                stage: 'tower-creation-ability-clear',
                message: String(cleared?.reason ?? 'ability metadata clear failed')
            });
            this.#syncState();
            return Object.freeze({
                accepted: false,
                reason: 'tower-creation-ability-clear',
                requestedCount: handles.length,
                preleasedCount: 0,
                requiresRecovery: true
            });
        }
        const token = Object.freeze({});
        const prelease = {
            token,
            transactionId: String(request.transactionId ?? ''),
            handles: Object.freeze(handles.map((handle) => Object.freeze({
                entityId: Number(handle.entityId),
                incarnation: Number(handle.incarnation)
            }))),
            records: Object.freeze(records.map((entry) => Object.freeze({
                ...entry,
                handle: Object.freeze({ ...entry.handle })
            }))),
            spawnIntents: Object.freeze([...spawnIntents]),
            state: 'preleased',
            creationRecords: null,
            childAbilityMetadata: null
        };
        const simulation = this.simulation;
        const simulationView = new DataView(
            simulation.hostStorage.simulationBuffer
        );
        const simulationLayout = GPU_CIRCLE_BODY_ABI.SIMULATION;
        try {
            for (const entry of prelease.records) {
                simulation.handleToSlot.delete(entry.key);
                simulation.slotHandles[entry.slot] = null;
                simulation.slotActive[entry.slot] = 2;
                simulation.pendingSlotHandles[entry.slot] = entry.handle;
                simulation.pendingHandleToSlot.set(entry.key, entry.slot);
                simulation.activeBodyCount--;
                simulation.pendingBodyCount++;
                simulationView.setUint32(
                    entry.slot * simulationLayout.STRIDE
                        + simulationLayout.FLAGS,
                    entry.baselineFlags & ~GPU_CIRCLE_BODY_META.ALIVE_BIT,
                    LITTLE_ENDIAN
                );
            }
            uploadActorPayloadPreleaseRanges(
                simulation,
                prelease.records,
                simulationLayout.STRIDE
            );
            this.towerCreationBodyPreleases.set(token, prelease);
        } catch (error) {
            this.towerCreationFailure = Object.freeze({
                stage: 'tower-creation-prelease-upload',
                name: String(error?.name ?? 'Error'),
                message: String(error?.message ?? error)
            });
            this.#rollbackUntrackedTowerCreationBodyPrelease(prelease);
            this.#syncState();
            return Object.freeze({
                accepted: false,
                reason: 'tower-creation-prelease-upload',
                requestedCount: handles.length,
                preleasedCount: 0,
                requiresRecovery: true
            });
        }
        this.towerCreationPreleaseHighWater = Math.max(
            this.towerCreationPreleaseHighWater,
            this.towerCreationBodyPreleases.size
        );
        this.#syncState();
        return Object.freeze({
            accepted: true,
            token,
            handles: this.towerCreationBodyPreleases.get(token).handles,
            slots: Object.freeze(records.map(({ slot }) => slot)),
            requestedCount: handles.length,
            preleasedCount: handles.length,
            requiresRecovery: false
        });
    }

    /** CPU plan과 exact preleases를 독립 GPU creation program으로 stage합니다. */
    stageTowerCreationTransaction(request = {}) {
        const prelease = this.towerCreationBodyPreleases.get(
            request.preleaseToken
        );
        if (!prelease || prelease.state !== 'preleased') {
            return Object.freeze({
                accepted: false,
                reason: 'tower-creation-prelease-token',
                recoveryRequired: false
            });
        }
        if (!this.#ensureTowerCreationRuntime()) {
            return Object.freeze({
                accepted: false,
                reason: 'tower-creation-runtime-unavailable',
                recoveryRequired: false
            });
        }
        const plan = request.plan;
        const sourceRecords = request.sourceRecords;
        const childAbilityMetadata = request.childAbilityMetadata;
        if (!plan?.accepted
            || !Array.isArray(plan.existing)
            || !Array.isArray(plan.children)
            || !Array.isArray(sourceRecords)
            || !Array.isArray(childAbilityMetadata)
            || plan.children.length !== prelease.records.length
            || childAbilityMetadata.length !== prelease.records.length
            || sourceRecords.length !== plan.existing.length) {
            return Object.freeze({
                accepted: false,
                reason: 'tower-creation-plan-contract',
                recoveryRequired: false
            });
        }
        const protocol = this.getEventProtocolState();
        const sourceById = new Map(sourceRecords.map((record) => (
            [record.logicalTowerId, record]
        )));
        const creationRecords = [];
        const targetMembers = [];
        try {
            for (let index = 0; index < plan.existing.length; index++) {
                const target = plan.existing[index];
                const source = sourceById.get(target.logicalTowerId);
                const exact = source?.exactGpuBinding
                    ? this.simulation.resolveExactBodySlot(
                        source.exactGpuBinding
                    )
                    : null;
                if (!source || !exact) {
                    return Object.freeze({
                        accepted: false,
                        reason: 'tower-creation-source-changed',
                        recoveryRequired: false
                    });
                }
                creationRecords.push(Object.freeze({
                    kind: GPU_TOWER_CREATION_RECORD_KIND.EXISTING,
                    slot: exact.slot,
                    entityId: exact.handle.entityId,
                    incarnation: exact.handle.incarnation,
                    logicalTowerOrdinal: target.logicalTowerOrdinal,
                    sourceCurrentHpFixedPoint: source.currentHpFixedPoint,
                    targetCurrentHpFixedPoint: target.currentHpFixedPoint,
                    sourceShareUnits: source.shareUnits,
                    targetShareUnits: target.shareUnits,
                    sourceMaxHpFixedPoint: source.maxHpFixedPoint,
                    targetMaxHpFixedPoint: target.maxHpFixedPoint,
                    sourcePowerFixedPoint: source.powerFixedPoint,
                    targetPowerFixedPoint: target.powerFixedPoint,
                    sourceGroupRevision: plan.sourceGroupRevision,
                    targetGroupRevision: plan.targetGroupRevision,
                    rosterRank: index
                }));
                targetMembers.push(Object.freeze({
                    slot: exact.slot,
                    entityId: exact.handle.entityId,
                    incarnation: exact.handle.incarnation,
                    logicalTowerOrdinal: target.logicalTowerOrdinal,
                    shareUnits: target.shareUnits,
                    maxHpFixedPoint: target.maxHpFixedPoint,
                    powerFixedPoint: target.powerFixedPoint,
                    flags: GPU_TOWER_GROUP_MEMBER_FLAG.TOWER_NOUN
                        | GPU_TOWER_GROUP_MEMBER_FLAG.LIVING
                }));
            }
            for (let childIndex = 0;
                childIndex < plan.children.length;
                childIndex++) {
                const target = plan.children[childIndex];
                const lease = prelease.records[childIndex];
                const rank = plan.existing.length + childIndex;
                creationRecords.push(Object.freeze({
                    kind: GPU_TOWER_CREATION_RECORD_KIND.CHILD,
                    slot: lease.slot,
                    entityId: lease.handle.entityId,
                    incarnation: lease.handle.incarnation,
                    logicalTowerOrdinal: target.logicalTowerOrdinal,
                    sourceCurrentHpFixedPoint: 0,
                    targetCurrentHpFixedPoint: target.currentHpFixedPoint,
                    sourceShareUnits: 0,
                    targetShareUnits: target.shareUnits,
                    sourceMaxHpFixedPoint: 0,
                    targetMaxHpFixedPoint: target.maxHpFixedPoint,
                    sourcePowerFixedPoint: 0,
                    targetPowerFixedPoint: target.powerFixedPoint,
                    sourceGroupRevision: 0,
                    targetGroupRevision: plan.targetGroupRevision,
                    rosterRank: rank
                }));
                targetMembers.push(Object.freeze({
                    slot: lease.slot,
                    entityId: lease.handle.entityId,
                    incarnation: lease.handle.incarnation,
                    logicalTowerOrdinal: target.logicalTowerOrdinal,
                    shareUnits: target.shareUnits,
                    maxHpFixedPoint: target.maxHpFixedPoint,
                    powerFixedPoint: target.powerFixedPoint,
                    flags: GPU_TOWER_GROUP_MEMBER_FLAG.TOWER_NOUN
                        | GPU_TOWER_GROUP_MEMBER_FLAG.LIVING
                }));
            }
            const transition = this.towerGroupRuntime
                .prepareRosterTransition({
                    transactionId: plan.transactionId,
                    groupRevision: plan.targetGroupRevision,
                    members: targetMembers,
                    protocol
                });
            const mode = request.mode
                ?? GPU_TOWER_CREATION_MODE.CPU_EXPLICIT_DESCRIPTORS;
            const staged = this.towerCreationRuntime.stage({
                transactionId: plan.transactionId,
                transactionFingerprint: request.transactionFingerprint,
                sourceTick: request.sourceTick,
                sourceGroupRevision: plan.sourceGroupRevision,
                targetGroupRevision: plan.targetGroupRevision,
                sourceRosterFingerprint: transition.source.fingerprint,
                targetRosterFingerprint: transition.target.fingerprint,
                existingCount: plan.existing.length,
                childCount: plan.children.length,
                towerDefinitionCode: request.towerDefinitionCode,
                records: creationRecords,
                protocol,
                mode,
                actorAction: request.actorAction,
                actorActionPlacementBinding:
                    request.actorActionPlacementBinding
            });
            if (staged?.accepted !== true) {
                this.towerGroupRuntime.finalizeRosterTransition(
                    plan.transactionId,
                    false
                );
                return staged;
            }
            prelease.state = 'staged';
            prelease.creationRecords = Object.freeze(creationRecords);
            prelease.childAbilityMetadata = Object.freeze([
                ...childAbilityMetadata
            ]);
            prelease.mode = mode;
            prelease.actorAction = mode
                    === GPU_TOWER_CREATION_MODE.GPU_SUBJECT_ACTOR_ACTION
                ? Object.freeze({
                    ...request.actorAction,
                    placementTargetTick:
                        request.actorActionPlacementBinding
                            ?.placementTargetTick
                })
                : null;
            return Object.freeze({
                ...staged,
                preleaseToken: request.preleaseToken,
                sourceRosterFingerprint: transition.source.fingerprint,
                targetRosterFingerprint: transition.target.fingerprint
            });
        } catch (error) {
            try {
                this.towerGroupRuntime.finalizeRosterTransition(
                    plan.transactionId,
                    false
                );
            } catch {
                // 아직 transition이 준비되지 않은 contract rejection입니다.
            }
            return Object.freeze({
                accepted: false,
                reason: 'tower-creation-stage-contract',
                failure: Object.freeze({
                    name: String(error?.name ?? 'Error'),
                    message: String(error?.message ?? error)
                }),
                recoveryRequired: false
            });
        }
    }

    /** GPU program stage 전의 단일 body prelease를 전량 취소합니다. */
    cancelTowerCreationBodyPrelease(preleaseToken, reason = 'cancelled') {
        const prelease = this.towerCreationBodyPreleases.get(preleaseToken);
        if (!prelease || prelease.state !== 'preleased') {
            return Object.freeze({
                accepted: false,
                reason: 'tower-creation-prelease-token',
                cancelledCount: 0,
                requiresRecovery: false
            });
        }
        const clean = this.#rollbackUntrackedTowerCreationBodyPrelease(
            prelease
        );
        this.towerCreationBodyPreleases.delete(preleaseToken);
        if (!clean) {
            this.towerCreationFailure = Object.freeze({
                stage: 'tower-creation-prelease-cancel',
                message: 'Tower creation body prelease를 전량 취소하지 못했습니다.'
            });
        }
        this.#syncState();
        return Object.freeze({
            accepted: clean,
            reason: String(reason || 'cancelled'),
            cancelledCount: clean ? prelease.handles.length : 0,
            requiresRecovery: !clean
        });
    }

    drainCompletedTowerCreationTransactions(out = []) {
        return this.towerCreationRuntime.drainCompleted(out);
    }

    /** Authentic result에 맞춰 host mirrors/prelease를 commit 또는 전량 rollback합니다. */
    finalizeTowerCreationTransaction(request = {}) {
        const prelease = this.towerCreationBodyPreleases.get(
            request.preleaseToken
        );
        const transactionId = String(request.transactionId ?? '');
        if (!prelease || prelease.state !== 'staged'
            || prelease.transactionId !== transactionId) {
            return Object.freeze({
                accepted: false,
                reason: 'tower-creation-prelease-token',
                finalizedCount: 0,
                requiresRecovery: false
            });
        }
        const committed = request.committed === true;
        if (!committed) {
            const transition = this.towerGroupRuntime
                .finalizeRosterTransition(transactionId, false);
            const bodyClean = this.#rollbackUntrackedTowerCreationBodyPrelease(
                prelease
            );
            this.towerCreationBodyPreleases.delete(request.preleaseToken);
            const clean = transition?.accepted === true
                && bodyClean;
            if (!clean || request.recoveryRequired === true) {
                this.towerCreationFailure = Object.freeze({
                    stage: 'tower-creation-rejected-rollback',
                    message: clean
                        ? 'Tower creation protocol failure가 발생했습니다.'
                        : 'Tower creation prelease를 전량 회수하지 못했습니다.'
                });
            }
            this.#syncState();
            return Object.freeze({
                accepted: clean,
                committed: false,
                finalizedCount: clean ? prelease.handles.length : 0,
                handles: Object.freeze([]),
                requiresRecovery: !clean || request.recoveryRequired === true
            });
        }

        const committedChildAbilityMetadata = Array.isArray(
            request.childAbilityMetadata
        )
            ? request.childAbilityMetadata
            : prelease.childAbilityMetadata;
        const exactChildren = prelease.records.every((entry) => (
            this.resolveExactAbilityBodySlot(entry.handle)?.slot === entry.slot
            && this.simulation.slotActive[entry.slot] === 2
            && this.simulation.pendingHandleToSlot.get(entry.key) === entry.slot
        ));
        if (!exactChildren
            || !Array.isArray(prelease.creationRecords)
            || !Array.isArray(committedChildAbilityMetadata)
            || committedChildAbilityMetadata.length
                !== prelease.records.length) {
            this.towerCreationFailure = Object.freeze({
                stage: 'tower-creation-commit-identity',
                message: 'Committed Tower prelease identity가 다릅니다.'
            });
            this.#syncState();
            return Object.freeze({
                accepted: false,
                committed: false,
                finalizedCount: 0,
                requiresRecovery: true
            });
        }
        try {
            const transition = this.towerGroupRuntime
                .finalizeRosterTransition(transactionId, true);
            if (transition?.accepted !== true) {
                throw new Error('TowerGroup host roster transition commit이 실패했습니다.');
            }
            const simulationView = new DataView(
                this.simulation.hostStorage.simulationBuffer
            );
            const simulationLayout = GPU_CIRCLE_BODY_ABI.SIMULATION;
            for (const record of prelease.creationRecords) {
                simulationView.setInt32(
                    record.slot * simulationLayout.STRIDE
                        + simulationLayout.HEALTH,
                    record.targetCurrentHpFixedPoint | 0,
                    LITTLE_ENDIAN
                );
            }
            for (const record of prelease.records) {
                const offset = record.slot * simulationLayout.STRIDE;
                const flags = simulationView.getUint32(
                    offset + simulationLayout.FLAGS,
                    LITTLE_ENDIAN
                ) | GPU_CIRCLE_BODY_SIMULATION_FLAG.ALIVE;
                simulationView.setUint32(
                    offset + simulationLayout.FLAGS,
                    flags,
                    LITTLE_ENDIAN
                );
            }
            const metadataLayout
                = GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.ENTITY_METADATA;
            const metadataView = new DataView(
                this.abilitySubjectSnapshotRuntime.metadataBytes
            );
            for (const record of prelease.creationRecords) {
                if (record.kind !== GPU_TOWER_CREATION_RECORD_KIND.EXISTING) {
                    continue;
                }
                metadataView.setUint32(
                    record.slot * metadataLayout.STRIDE
                        + metadataLayout.POWER_FIXED_POINT,
                    record.targetPowerFixedPoint,
                    LITTLE_ENDIAN
                );
            }
            prelease.records.forEach((record, index) => {
                writeGpuAbilityEntityMetadata(
                    this.abilitySubjectSnapshotRuntime.metadataBytes,
                    this.capacity,
                    record.slot,
                    committedChildAbilityMetadata[index]
                );
            });
            for (const record of prelease.records) {
                this.simulation.pendingHandleToSlot.delete(record.key);
                this.simulation.pendingSlotHandles[record.slot] = null;
                this.simulation.slotActive[record.slot] = 1;
                this.simulation.slotHandles[record.slot] = record.handle;
                this.simulation.handleToSlot.set(record.key, record.slot);
                this.simulation.pendingBodyCount--;
                this.simulation.activeBodyCount++;
            }
            if (prelease.actorAction?.actionCode
                === SENTENCE_ACTION_CODE.THROW) {
                const registered = this.registerCommittedActorTransitBatch({
                    transactionId,
                    completionOwner: 'tower-creation',
                    handles: prelease.handles,
                    startTick: prelease.actorAction.placementTargetTick,
                    durationFixedTicks:
                        prelease.actorAction.travelDurationFixedTicks,
                    actionCode: prelease.actorAction.actionCode,
                    payloadCode: prelease.actorAction.payloadCode,
                    executionOrdinal:
                        prelease.actorAction.executionOrdinal,
                    executionFingerprint:
                        prelease.actorAction.sourceExecutionFingerprint,
                    actorActionProfileFingerprint:
                        prelease.actorAction.actorActionProfileFingerprint,
                    placementFingerprint:
                        prelease.actorAction.placementFingerprint
                });
                if (!registered) {
                    throw new Error('Committed Tower transit 등록에 실패했습니다.');
                }
            }
            prelease.state = 'committed';
            this.towerCreationBodyPreleases.delete(request.preleaseToken);
            this.#syncState();
            return Object.freeze({
                accepted: true,
                committed: true,
                finalizedCount: prelease.handles.length,
                handles: prelease.handles,
                roster: transition.roster,
                requiresRecovery: false
            });
        } catch (error) {
            this.towerCreationFailure = Object.freeze({
                stage: 'tower-creation-host-commit',
                name: String(error?.name ?? 'Error'),
                message: String(error?.message ?? error)
            });
            this.#syncState();
            return Object.freeze({
                accepted: false,
                committed: false,
                finalizedCount: 0,
                requiresRecovery: true
            });
        }
    }

    cancelAllTowerCreations(reason = 'cancelled') {
        const runtime = this.towerCreationRuntime.cancelPending(reason);
        let cancelledPreleaseCount = 0;
        let requiresRecovery = runtime?.recoveryRequired === true;
        for (const [token, prelease] of [...this.towerCreationBodyPreleases]) {
            try {
                this.towerGroupRuntime.finalizeRosterTransition(
                    prelease.transactionId,
                    false
                );
            } catch {
                // transition이 없는 prelease도 body rollback은 계속합니다.
            }
            const clean = this.#rollbackUntrackedTowerCreationBodyPrelease(
                prelease
            );
            if (clean) {
                cancelledPreleaseCount += prelease.handles.length;
            } else {
                requiresRecovery = true;
            }
            this.towerCreationBodyPreleases.delete(token);
        }
        return Object.freeze({
            cancelledPreleaseCount,
            reason: String(reason || 'cancelled'),
            requiresRecovery
        });
    }

    getTowerCreationRuntimeStatus() {
        return Object.freeze({
            ...this.towerCreationRuntime.getStatus(),
            productionTowerCapacity:
                THE_TOWER_RUNTIME_DATA.PRODUCTION_TOWER_CAPACITY,
            towerCapacity: this.towerGroupMemberCapacity,
            productionCapacityOverridden: this.towerGroupMemberCapacity
                !== THE_TOWER_RUNTIME_DATA.PRODUCTION_TOWER_CAPACITY,
            bodyPreleaseCount: this.towerCreationBodyPreleases.size,
            bodyPreleaseHighWater: this.towerCreationPreleaseHighWater,
            availableBodyCapacity:
                this.getAvailableTowerCreationBodyCapacity(),
            failure: this.towerCreationFailure
                ?? this.towerCreationRuntime.getStatus().failure,
            requiresRecovery: this.towerCreationFailure !== null
                || this.towerCreationRuntime.requiresRecovery()
        });
    }

    canStageTowerMerge() {
        return this.#ensureTowerMergeRuntime()
            && this.towerMergeRuntime.canAccept()
            && this.towerTransactionRuntime.canStageMerge()
            && this.towerMergeTransactions.size === 0
            && this.towerMergeCommittedCleanups.size === 0
            && this.towerCreationBodyPreleases.size === 0;
    }

    /** CPU TowerGroup plan을 exact stable slots의 한 GPU N→1 program으로 stage합니다. */
    stageTowerMergeTransaction(request = {}) {
        const plan = request.plan;
        if (!plan?.accepted
            || !Array.isArray(plan.sources)
            || !Array.isArray(plan.consumed)
            || plan.sources.length < 2
            || plan.sources.length > 256
            || plan.sources.length !== plan.sourceCount
            || plan.consumed.length !== plan.sourceCount - 1
            || !plan.survivor?.exactGpuBinding) {
            return Object.freeze({
                accepted: false,
                reason: 'tower-merge-plan-contract',
                recoveryRequired: false
            });
        }
        if (!this.canStageTowerMerge()) {
            return Object.freeze({
                accepted: false,
                reason: 'tower-merge-program-capacity',
                recoveryRequired: this.towerMergeRuntime.requiresRecovery()
            });
        }
        const sourceTick = Number(request.sourceTick);
        if (!Number.isSafeInteger(sourceTick) || sourceTick <= 0) {
            return Object.freeze({
                accepted: false,
                reason: 'tower-merge-source-tick',
                recoveryRequired: false
            });
        }
        const protocol = this.getEventProtocolState();
        const survivorLogicalTowerId = plan.survivor.logicalTowerId;
        const records = [];
        const targetMembers = [];
        try {
            for (let rank = 0; rank < plan.sources.length; rank++) {
                const source = plan.sources[rank];
                const binding = source.exactGpuBinding;
                if (!binding
                    || binding.sessionGeneration !== protocol.sessionGeneration
                    || binding.deviceGeneration !== protocol.deviceGeneration
                    || binding.authoritativeEpoch !== protocol.authoritativeEpoch) {
                    return Object.freeze({
                        accepted: false,
                        reason: 'tower-merge-source-changed',
                        recoveryRequired: false
                    });
                }
                const exact = this.simulation.resolveExactBodySlot(binding);
                if (!exact) {
                    return Object.freeze({
                        accepted: false,
                        reason: 'tower-merge-source-changed',
                        recoveryRequired: false
                    });
                }
                const survivor = source.logicalTowerId
                    === survivorLogicalTowerId;
                records.push(Object.freeze({
                    slot: exact.slot,
                    entityId: exact.handle.entityId,
                    incarnation: exact.handle.incarnation,
                    logicalTowerOrdinal: source.logicalTowerOrdinal,
                    expectedCurrentHpFixedPoint:
                        source.currentHpFixedPoint,
                    sourceShareUnits: source.shareUnits,
                    sourceMaxHpFixedPoint: source.maxHpFixedPoint,
                    sourcePowerFixedPoint: source.powerFixedPoint,
                    sourceGroupRevision: plan.sourceGroupRevision,
                    sourceFlags: GPU_TOWER_GROUP_MEMBER_FLAG.TOWER_NOUN
                        | GPU_TOWER_GROUP_MEMBER_FLAG.LIVING,
                    sourceRosterRank: rank,
                    role: survivor
                        ? GPU_TOWER_MERGE_RECORD_ROLE.SURVIVOR
                        : GPU_TOWER_MERGE_RECORD_ROLE.CONSUMED,
                    targetCurrentHpFixedPoint: survivor
                        ? plan.survivor.currentHpFixedPoint
                        : 0,
                    targetShareUnits: survivor
                        ? plan.survivor.shareUnits
                        : 0,
                    targetMaxHpFixedPoint: survivor
                        ? plan.survivor.maxHpFixedPoint
                        : 0,
                    targetPowerFixedPoint: survivor
                        ? plan.survivor.powerFixedPoint
                        : 0
                }));
                if (survivor) {
                    targetMembers.push(Object.freeze({
                        slot: exact.slot,
                        entityId: exact.handle.entityId,
                        incarnation: exact.handle.incarnation,
                        logicalTowerOrdinal: source.logicalTowerOrdinal,
                        shareUnits: plan.survivor.shareUnits,
                        maxHpFixedPoint: plan.survivor.maxHpFixedPoint,
                        powerFixedPoint: plan.survivor.powerFixedPoint,
                        flags: GPU_TOWER_GROUP_MEMBER_FLAG.TOWER_NOUN
                            | GPU_TOWER_GROUP_MEMBER_FLAG.LIVING
                    }));
                }
            }
            if (targetMembers.length !== 1) {
                return Object.freeze({
                    accepted: false,
                    reason: 'tower-merge-survivor-identity',
                    recoveryRequired: false
                });
            }
            const transition = this.towerGroupRuntime.prepareRosterTransition({
                transactionId: plan.transactionId,
                groupRevision: plan.targetGroupRevision,
                members: targetMembers,
                protocol
            });
            if (transition.source.memberCount !== plan.sourceCount
                || transition.target.memberCount !== 1) {
                this.towerGroupRuntime.finalizeRosterTransition(
                    plan.transactionId,
                    false
                );
                return Object.freeze({
                    accepted: false,
                    reason: 'tower-merge-source-changed',
                    recoveryRequired: false
                });
            }
            const staged = this.towerMergeRuntime.stage({
                transactionId: plan.transactionId,
                planFingerprint: plan.fingerprint,
                sourceTick,
                sourceGroupRevision: plan.sourceGroupRevision,
                targetGroupRevision: plan.targetGroupRevision,
                sourceRosterFingerprint: transition.source.fingerprint,
                targetRosterFingerprint: transition.target.fingerprint,
                records,
                protocol
            });
            if (staged?.accepted !== true) {
                this.towerGroupRuntime.finalizeRosterTransition(
                    plan.transactionId,
                    false
                );
                return staged;
            }
            this.towerMergeTransactions.set(plan.transactionId, {
                transactionId: plan.transactionId,
                planFingerprint: plan.fingerprint,
                plan,
                records: Object.freeze(records),
                protocol,
                state: 'staged'
            });
            return Object.freeze({
                ...staged,
                sourceRosterFingerprint: transition.source.fingerprint,
                targetRosterFingerprint: transition.target.fingerprint
            });
        } catch (error) {
            try {
                this.towerGroupRuntime.finalizeRosterTransition(
                    plan.transactionId,
                    false
                );
            } catch { /* transition was not prepared */ }
            return Object.freeze({
                accepted: false,
                reason: 'tower-merge-stage-contract',
                failure: Object.freeze({
                    name: String(error?.name ?? 'Error'),
                    message: String(error?.message ?? error)
                }),
                recoveryRequired: false
            });
        }
    }

    drainCompletedTowerMergeTransactions(out = []) {
        return this.towerMergeRuntime.drainCompleted(out);
    }

    /** Authentic GPU aggregate 뒤 host mirrors를 seal하고 cleanup token을 발행합니다. */
    finalizeTowerMergeTransaction(request = {}) {
        const transactionId = String(request.transactionId ?? '');
        const transaction = this.towerMergeTransactions.get(transactionId);
        if (!transaction
            || transaction.state !== 'staged'
            || transaction.planFingerprint !== request.planFingerprint) {
            return Object.freeze({
                accepted: false,
                reason: 'tower-merge-transaction-token',
                committed: false,
                requiresRecovery: false
            });
        }
        if (request.committed !== true) {
            const transition = this.towerGroupRuntime
                .finalizeRosterTransition(transactionId, false);
            this.towerMergeTransactions.delete(transactionId);
            const recoveryRequired = request.recoveryRequired === true
                || transition?.accepted !== true;
            if (recoveryRequired) {
                this.towerMergeFailure = Object.freeze({
                    stage: 'tower-merge-rejected-rollback',
                    message: 'Tower merge rejection rollback/protocol이 실패했습니다.'
                });
            }
            this.#syncState();
            return Object.freeze({
                accepted: transition?.accepted === true,
                committed: false,
                requiresRecovery: recoveryRequired
            });
        }

        const survivorRecord = transaction.records.find((record) => (
            record.role === GPU_TOWER_MERGE_RECORD_ROLE.SURVIVOR
        ));
        const targetCurrentHpFixedPoint = Number(
            request.targetCurrentHpFixedPoint
        );
        if (!survivorRecord
            || !Number.isSafeInteger(targetCurrentHpFixedPoint)
            || targetCurrentHpFixedPoint <= 0
            || targetCurrentHpFixedPoint
                > survivorRecord.targetCurrentHpFixedPoint
            || targetCurrentHpFixedPoint
                > survivorRecord.targetMaxHpFixedPoint) {
            this.towerMergeFailure = Object.freeze({
                stage: 'tower-merge-live-health-contract',
                message: 'Committed Tower merge live HP evidence가 잘못됐습니다.'
            });
            this.#syncState();
            return Object.freeze({
                accepted: false,
                committed: false,
                requiresRecovery: true
            });
        }
        const exactRecords = transaction.records.every((record) => {
            const exact = this.simulation.resolveExactBodySlot({
                entityId: record.entityId,
                incarnation: record.incarnation
            });
            return exact?.slot === record.slot
                && this.simulation.slotActive[record.slot] === 1;
        });
        if (!exactRecords) {
            this.towerMergeFailure = Object.freeze({
                stage: 'tower-merge-host-identity',
                message: 'Committed Tower merge source stable slot이 다릅니다.'
            });
            this.#syncState();
            return Object.freeze({
                accepted: false,
                committed: false,
                requiresRecovery: true
            });
        }
        try {
            const transition = this.towerGroupRuntime
                .finalizeRosterTransition(transactionId, true);
            if (transition?.accepted !== true) {
                throw new Error('Tower merge roster transition commit이 실패했습니다.');
            }
            const simulationLayout = GPU_CIRCLE_BODY_ABI.SIMULATION;
            const physicsLayout = GPU_CIRCLE_BODY_ABI.PHYSICS;
            const controlLayout = GPU_FIXED_PRIMITIVE_ABI.BODY_CONTROL_STATE;
            const metadataLayout
                = GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.ENTITY_METADATA;
            const simulationView = new DataView(
                this.simulation.hostStorage.simulationBuffer
            );
            const physicsView = new DataView(
                this.simulation.hostStorage.physicsBuffer
            );
            const metadataView = new DataView(
                this.abilitySubjectSnapshotRuntime.metadataBytes
            );
            const consumed = [];
            let survivor = null;
            for (const record of transaction.records) {
                const simulationOffset = record.slot * simulationLayout.STRIDE;
                if (record.role === GPU_TOWER_MERGE_RECORD_ROLE.SURVIVOR) {
                    simulationView.setInt32(
                        simulationOffset + simulationLayout.HEALTH,
                        targetCurrentHpFixedPoint | 0,
                        LITTLE_ENDIAN
                    );
                    const metadataOffset = record.slot * metadataLayout.STRIDE;
                    if (metadataView.getUint32(
                        metadataOffset + metadataLayout.ABI_VERSION,
                        LITTLE_ENDIAN
                    ) !== 0) {
                        metadataView.setUint32(
                            metadataOffset
                                + metadataLayout.POWER_FIXED_POINT,
                            record.targetPowerFixedPoint,
                            LITTLE_ENDIAN
                        );
                    }
                    survivor = record;
                    continue;
                }
                const flags = simulationView.getUint32(
                    simulationOffset + simulationLayout.FLAGS,
                    LITTLE_ENDIAN
                ) & ~(
                    GPU_CIRCLE_BODY_SIMULATION_FLAG.ALIVE
                    | GPU_CIRCLE_BODY_SIMULATION_FLAG.CONTROLLED_THIS_TICK
                );
                simulationView.setUint32(
                    simulationOffset + simulationLayout.FLAGS,
                    flags,
                    LITTLE_ENDIAN
                );
                const physicsOffset = record.slot * physicsLayout.STRIDE;
                physicsView.setUint32(
                    physicsOffset + physicsLayout.PHYSICAL_META,
                    0,
                    LITTLE_ENDIAN
                );
                physicsView.setUint32(
                    physicsOffset + physicsLayout.INTERACTION_META,
                    0,
                    LITTLE_ENDIAN
                );
                new Uint8Array(
                    this.simulation.hostBodyControlStates,
                    record.slot * controlLayout.STRIDE,
                    controlLayout.STRIDE
                ).fill(0);
                clearGpuAbilityEntityMetadata(
                    this.abilitySubjectSnapshotRuntime.metadataBytes,
                    this.capacity,
                    record.slot
                );
                consumed.push(Object.freeze({
                    slot: record.slot,
                    handle: Object.freeze({
                        entityId: record.entityId,
                        incarnation: record.incarnation
                    })
                }));
            }
            if (!survivor || consumed.length !== transaction.records.length - 1) {
                throw new Error('Tower merge survivor/consumed host cardinality가 다릅니다.');
            }
            const cleanupToken = Object.freeze({});
            this.towerMergeCommittedCleanups.set(cleanupToken, {
                transactionId,
                planFingerprint: transaction.planFingerprint,
                survivor: Object.freeze({
                    slot: survivor.slot,
                    handle: Object.freeze({
                        entityId: survivor.entityId,
                        incarnation: survivor.incarnation
                    })
                }),
                consumed: Object.freeze(consumed)
            });
            this.towerMergeTransactions.delete(transactionId);
            this.#syncState();
            return Object.freeze({
                accepted: true,
                committed: true,
                cleanupToken,
                survivorHandle: this.towerMergeCommittedCleanups
                    .get(cleanupToken).survivor.handle,
                consumedHandles: Object.freeze(consumed.map(
                    ({ handle }) => handle
                )),
                roster: transition.roster,
                targetCurrentHpFixedPoint,
                requiresRecovery: false
            });
        } catch (error) {
            this.towerMergeFailure = Object.freeze({
                stage: 'tower-merge-host-commit',
                name: String(error?.name ?? 'Error'),
                message: String(error?.message ?? error)
            });
            this.#syncState();
            return Object.freeze({
                accepted: false,
                committed: false,
                failure: this.towerMergeFailure,
                requiresRecovery: true
            });
        }
    }

    /** GPU references가 끝난 owner boundary에서 consumed exact slots만 회수합니다. */
    cleanupTowerMergeTransaction(cleanupToken) {
        const cleanup = this.towerMergeCommittedCleanups.get(cleanupToken);
        if (!cleanup) {
            return Object.freeze({
                accepted: false,
                reason: 'tower-merge-cleanup-token',
                cleanedCount: 0,
                requiresRecovery: false
            });
        }
        const exact = cleanup.consumed.every((entry) => {
            const resolved = this.simulation.resolveExactBodySlot(entry.handle);
            return resolved?.slot === entry.slot
                && this.simulation.slotActive[entry.slot] === 1;
        });
        if (!exact) {
            this.towerMergeFailure = Object.freeze({
                stage: 'tower-merge-cleanup-identity',
                message: 'Tower merge consumed stable slot이 cleanup 전에 달라졌습니다.'
            });
            this.#syncState();
            return Object.freeze({
                accepted: false,
                cleanedCount: 0,
                failure: this.towerMergeFailure,
                requiresRecovery: true
            });
        }
        try {
            const handles = cleanup.consumed.map(({ handle }) => handle);
            const result = this.simulation.despawnBodies(handles);
            const clean = result?.removed === handles.length
                && result?.rejected === 0
                && handles.every((handle) => !this.simulation.hasBody(handle));
            if (!clean) {
                throw new Error('Tower merge consumed body를 전량 회수하지 못했습니다.');
            }
            this.towerMergeCommittedCleanups.delete(cleanupToken);
            this.#syncState();
            return Object.freeze({
                accepted: true,
                transactionId: cleanup.transactionId,
                planFingerprint: cleanup.planFingerprint,
                cleanedCount: handles.length,
                handles: Object.freeze(handles),
                disposition: TOWER_MERGE_LIFECYCLE_DISPOSITION,
                deathEventCount: 0,
                rewardMutationCount: 0,
                requiresRecovery: false
            });
        } catch (error) {
            this.towerMergeFailure = Object.freeze({
                stage: 'tower-merge-cleanup',
                name: String(error?.name ?? 'Error'),
                message: String(error?.message ?? error)
            });
            this.#syncState();
            return Object.freeze({
                accepted: false,
                cleanedCount: 0,
                failure: this.towerMergeFailure,
                requiresRecovery: true
            });
        }
    }

    cancelAllTowerMerges(reason = 'cancelled') {
        const runtime = this.towerMergeRuntime.cancelPending(reason);
        let cancelledCount = 0;
        let cleanedCount = 0;
        let requiresRecovery = runtime?.recoveryRequired === true;
        for (const [transactionId] of [...this.towerMergeTransactions]) {
            const transition = this.towerGroupRuntime
                .finalizeRosterTransition(transactionId, false);
            if (transition?.accepted === true) cancelledCount++;
            else requiresRecovery = true;
            this.towerMergeTransactions.delete(transactionId);
        }
        for (const token of [...this.towerMergeCommittedCleanups.keys()]) {
            const cleanup = this.cleanupTowerMergeTransaction(token);
            cleanedCount += cleanup?.cleanedCount ?? 0;
            requiresRecovery ||= cleanup?.requiresRecovery === true;
        }
        return Object.freeze({
            cancelledCount,
            cleanedCount,
            reason: String(reason || 'cancelled'),
            requiresRecovery
        });
    }

    getTowerMergeRuntimeStatus() {
        return Object.freeze({
            ...this.towerMergeRuntime.getStatus(),
            transactionCount: this.towerMergeTransactions.size,
            committedCleanupCount: this.towerMergeCommittedCleanups.size,
            failure: this.towerMergeFailure
                ?? this.towerMergeRuntime.getStatus().failure,
            requiresRecovery: this.towerMergeFailure !== null
                || this.towerMergeRuntime.requiresRecovery()
        });
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
        // 모든 적 행동이 같은 TowerGroup query 결과를 소비하므로, actor payload나
        // group command가 없는 저수준 endpoint에서도 fixed pass 전에 runtime을 붙인다.
        if (hadActiveBodies) this.#ensureTowerGroupRuntime();
        const validSourceTick = Number.isSafeInteger(Number(sourceTick))
            && Number(sourceTick) >= 0;
        const transitStatus = this.actorTransitRuntime.getStatus();
        const transitSubmitted = validSourceTick
            && transitStatus.state === 'ready'
            && transitStatus.activeBatchCount > 0
            ? this.actorTransitRuntime.advanceForFixedTick(Number(sourceTick))
            : false;
        const payloadSubmission = validSourceTick
            ? this.submitActorPayloadMaterializations(sourceTick)
            : Object.freeze({ submittedCount: 0, deferredCount: 0 });
        const abilitySubmission = validSourceTick
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
                || payloadSubmission.submittedCount > 0
                || transitSubmitted));
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

    /**
     * Recovery/SpawnAdmission이 production collision-grid builder와 동일한
     * mapping/classification/footprint parameter를 사용하게 하는 snapshot입니다.
     */
    getSpawnAdmissionGridDescriptor() {
        const simulation = this.simulation;
        if (!simulation) {
            return null;
        }
        return createGpuCollisionGridDescriptor({
            worldSize: simulation.worldSize,
            gridCellSize: simulation.gridCellSize,
            gridCellCount: simulation.gridCellCount,
            maxBodiesPerCell: simulation.maxBodiesPerCell,
            maximumBodyRadius: simulation.maximumBodyRadius
        });
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
                actorActionPlacements:
                    this.getActorActionPlacementRuntimeStatus(),
                actorTransits: this.getActorTransitRuntimeStatus(),
                towerGroup: this.towerGroupRuntime.getStatus(),
                towerCreation: this.getTowerCreationRuntimeStatus(),
                towerMerge: this.getTowerMergeRuntimeStatus(),
                towerTargetQuery: this.towerTargetQueryRuntime.getStatus()
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
            || this.actorActionPlacementRuntime.failure !== null
            || this.actorTransitRuntime.requiresRecovery()
            || this.towerGroupRuntime.requiresRecovery()
            || this.towerCreationRuntime.requiresRecovery()
            || this.towerMergeRuntime.requiresRecovery()
            || this.towerTargetQueryRuntime.requiresRecovery()
            || this.towerCreationFailure !== null
            || this.towerMergeFailure !== null
            || this.actorPayloadPreleaseFailure !== null;
    }

    /** 반복 호출 가능한 session teardown입니다. */
    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.cancelAllActorPayloadMaterializations('destroyed');
        this.cancelAllActorActionPlacements('destroyed');
        this.actorTransitRuntime.cancelAll('destroyed');
        this.cancelAllTowerCreations('destroyed');
        this.cancelAllTowerMerges('destroyed');
        this.actorPayloadMaterializationRuntime.destroy();
        this.actorActionPlacementRuntime.destroy();
        this.actorTransitRuntime.destroy();
        this.actorActionPlacementOwners.clear();
        this.actorActionPlacementCompletionQueues.clear();
        this.actorTransitCompletionQueues.clear();
        this.abilitySubjectSnapshotRuntime.destroy();
        this.simulation?.attachTowerCreationRuntime?.(null);
        this.towerMergeRuntime.destroy();
        this.towerCreationRuntime.destroy();
        this.simulation?.attachTowerTargetQueryRuntime?.(null);
        this.towerTargetQueryRuntime.destroy();
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

    #routeActorActionPlacementCompletions() {
        const completions = this.actorActionPlacementRuntime
            .drainCompleted([]);
        for (const completion of completions) {
            const transactionId = String(completion.transactionId ?? '');
            const owner = this.actorActionPlacementOwners.get(transactionId)
                ?? 'default';
            this.actorActionPlacementOwners.delete(transactionId);
            let queue = this.actorActionPlacementCompletionQueues.get(owner);
            if (!queue) {
                queue = [];
                this.actorActionPlacementCompletionQueues.set(owner, queue);
            }
            queue.push(completion);
        }
    }

    #routeActorTransitCompletions() {
        const completions = this.actorTransitRuntime.drainCompleted([]);
        for (const completion of completions) {
            const owner = String(
                completion.completionOwner ?? 'default'
            );
            let queue = this.actorTransitCompletionQueues.get(owner);
            if (!queue) {
                queue = [];
                this.actorTransitCompletionQueues.set(owner, queue);
            }
            queue.push(completion);
        }
    }

    #syncState() {
        if (this.towerGroupRuntime.requiresRecovery()
            || this.actorActionPlacementRuntime.failure !== null
            || this.actorTransitRuntime.requiresRecovery()
            || this.towerCreationRuntime.requiresRecovery()
            || this.towerMergeRuntime.requiresRecovery()
            || this.towerTargetQueryRuntime.requiresRecovery()
            || this.simulation?.requiresProjectileCaptureRecovery?.() === true
            || this.towerCreationFailure !== null
            || this.towerMergeFailure !== null) {
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
            if (typeof this.simulation.init !== 'function') return false;
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
        return this.#ensureTowerTargetQueryRuntime(simulation, protocol);
    }

    #ensureTowerTargetQueryRuntime(simulation, protocol) {
        const groupResources = this.towerGroupRuntime.getCreationResources?.();
        if (!groupResources?.members
            || !groupResources?.roster
            || !simulation?.device
            || !simulation?.buffers?.towerTargetQueryResults
            || !simulation.buffers.towerGameplayTargetConfig
            || !simulation.buffers.spawnProgram) {
            return false;
        }
        const resources = {
            counts: simulation.buffers.counts,
            physics: simulation.buffers.physics,
            simulation: simulation.buffers.simulation,
            enemyBehaviorStates: simulation.buffers.enemyBehaviorStates,
            members: groupResources.members,
            roster: groupResources.roster,
            results: simulation.buffers.towerTargetQueryResults,
            compatibilityTarget: simulation.buffers.towerGameplayTargetConfig,
            spawnProgram: simulation.buffers.spawnProgram
        };
        const status = this.towerTargetQueryRuntime.getStatus();
        const alreadyCurrent = status.state === 'ready'
            && this.towerTargetQueryRuntime.device === simulation.device
            && status.sessionGeneration === protocol.sessionGeneration
            && status.deviceGeneration === protocol.deviceGeneration
            && status.authoritativeEpoch === protocol.authoritativeEpoch
            && Object.entries(resources).every(
                ([key, buffer]) => this.towerTargetQueryRuntime.resources?.[key]
                    === buffer
            );
        if (!alreadyCurrent) {
            try {
                this.towerTargetQueryRuntime.initialize(
                    simulation.device,
                    resources,
                    protocol
                );
            } catch {
                return false;
            }
        }
        simulation.attachTowerTargetQueryRuntime(this.towerTargetQueryRuntime);
        return true;
    }

    #ensureTowerCreationRuntime() {
        if (this.destroyed || !this.simulation) return false;
        if (!this.#ensureTowerGroupRuntime()
            || !this.#ensureAbilitySubjectSnapshotRuntime()
            || !this.#ensureActorTransitRuntime()) {
            return false;
        }
        const simulation = this.simulation;
        const groupResources = this.towerGroupRuntime
            .getCreationResources?.();
        const abilityMetadata = this.abilitySubjectSnapshotRuntime
            .buffers?.metadata;
        const actorTransit = this.actorTransitRuntime.getGpuBinding();
        if (!groupResources?.members
            || !groupResources?.roster
            || !abilityMetadata
            || !actorTransit?.buffer
            || !simulation.device
            || !simulation.buffers) {
            return false;
        }
        const protocol = simulation.getEventProtocolState();
        const status = this.towerCreationRuntime.getStatus();
        const alreadyCurrent = status.state === 'ready'
            && this.towerCreationRuntime.device === simulation.device
            && status.sessionGeneration === protocol.sessionGeneration
            && status.deviceGeneration === protocol.deviceGeneration
            && status.authoritativeEpoch === protocol.authoritativeEpoch
            && this.towerCreationRuntime.resources?.counts
                === simulation.buffers.counts
            && this.towerCreationRuntime.resources?.physics
                === simulation.buffers.physics
            && this.towerCreationRuntime.resources?.simulation
                === simulation.buffers.simulation
            && this.towerCreationRuntime.resources?.abilityMetadata
                === abilityMetadata
            && this.towerCreationRuntime.resources?.actorTransit
                === actorTransit.buffer
            && this.towerCreationRuntime.resources?.members
                === groupResources.members
            && this.towerCreationRuntime.resources?.roster
                === groupResources.roster;
        if (!alreadyCurrent) {
            try {
                this.towerCreationRuntime.initialize(
                    simulation.device,
                    {
                        counts: simulation.buffers.counts,
                        physics: simulation.buffers.physics,
                        simulation: simulation.buffers.simulation,
                        abilityMetadata,
                        actorTransit: actorTransit.buffer,
                        members: groupResources.members,
                        roster: groupResources.roster
                    },
                    protocol
                );
            } catch {
                return false;
            }
        }
        simulation.attachTowerCreationRuntime(this.towerTransactionRuntime);
        return true;
    }

    #ensureTowerMergeRuntime() {
        if (this.destroyed || !this.simulation) return false;
        if (!this.#ensureTowerGroupRuntime()
            || !this.#ensureAbilitySubjectSnapshotRuntime()) {
            return false;
        }
        const simulation = this.simulation;
        const groupResources = this.towerGroupRuntime.getCreationResources?.();
        const abilityMetadata = this.abilitySubjectSnapshotRuntime
            .buffers?.metadata;
        if (!groupResources?.members
            || !groupResources?.roster
            || !abilityMetadata
            || !simulation.device
            || !simulation.buffers?.physics
            || !simulation.buffers.simulation
            || !simulation.buffers.bodyControlStates) {
            return false;
        }
        const protocol = simulation.getEventProtocolState();
        const resources = {
            physics: simulation.buffers.physics,
            simulation: simulation.buffers.simulation,
            bodyControlStates: simulation.buffers.bodyControlStates,
            abilityMetadata,
            members: groupResources.members,
            roster: groupResources.roster
        };
        const status = this.towerMergeRuntime.getStatus();
        const alreadyCurrent = status.state === 'ready'
            && this.towerMergeRuntime.device === simulation.device
            && status.sessionGeneration === protocol.sessionGeneration
            && status.deviceGeneration === protocol.deviceGeneration
            && status.authoritativeEpoch === protocol.authoritativeEpoch
            && Object.entries(resources).every(
                ([key, buffer]) => this.towerMergeRuntime.resources?.[key]
                    === buffer
            );
        if (!alreadyCurrent) {
            try {
                this.towerMergeRuntime.initialize(
                    simulation.device,
                    resources,
                    protocol
                );
            } catch {
                return false;
            }
        }
        simulation.attachTowerCreationRuntime(this.towerTransactionRuntime);
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

    #ensureActorTransitRuntime() {
        if (this.destroyed || !this.simulation) return false;
        if (!this.#ensureAbilitySubjectSnapshotRuntime()) return false;
        const simulation = this.simulation;
        const abilityMetadata = this.abilitySubjectSnapshotRuntime
            .buffers?.metadata;
        if (!simulation.device || !simulation.buffers?.physics
            || !simulation.buffers.simulation
            || !simulation.buffers.enemyBehaviorStates
            || !abilityMetadata) {
            return false;
        }
        try {
            return this.actorTransitRuntime.initialize(
                simulation.device,
                {
                    physics: simulation.buffers.physics,
                    simulation: simulation.buffers.simulation,
                    abilityMetadata,
                    enemyBehaviorStates:
                        simulation.buffers.enemyBehaviorStates
                },
                {
                    sessionGeneration: this.sessionGeneration,
                    deviceGeneration: simulation.deviceGeneration,
                    authoritativeEpoch: simulation.authoritativeEpoch,
                    bodyCapacity: this.capacity
                }
            );
        } catch {
            return false;
        }
    }

    #ensureActorPayloadMaterializationRuntime(snapshotBinding) {
        if (this.destroyed || !this.simulation) return false;
        if (!this.#ensureAbilitySubjectSnapshotRuntime()
            || !this.#ensureTowerGroupRuntime()
            || !this.#ensureActorTransitRuntime()) return false;
        const snapshotBuffer = snapshotBinding?.buffer
            ?? this.abilitySubjectSnapshotRuntime.buffers?.output;
        const simulation = this.simulation;
        const groupResources = this.towerGroupRuntime.getCreationResources?.();
        const actorTransit = this.actorTransitRuntime.getGpuBinding();
        if (!snapshotBuffer
            || !simulation.device
            || !simulation.buffers
            || !this.abilitySubjectSnapshotRuntime.buffers?.metadata
            || !actorTransit?.buffer
            || !groupResources?.members
            || !groupResources?.roster) {
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
                    actorTransit: actorTransit?.buffer,
                    routeRuntimeStates:
                        simulation.buffers.routeRuntimeStates,
                    enemyBehaviorStates:
                        simulation.buffers.enemyBehaviorStates,
                    sdf: simulation.buffers.sdf,
                    params: simulation.buffers.computeParams,
                    gridCounts: simulation.buffers.gridCounts,
                    gridBodies: simulation.buffers.gridBodies,
                    towerMembers: groupResources.members,
                    towerRoster: groupResources.roster
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

    #ensureActorActionPlacementRuntime(snapshotBinding) {
        if (this.destroyed || !this.simulation) return false;
        if (!this.#ensureAbilitySubjectSnapshotRuntime()
            || !this.#ensureTowerGroupRuntime()) return false;
        const simulation = this.simulation;
        const snapshotBuffer = snapshotBinding?.buffer
            ?? this.abilitySubjectSnapshotRuntime.buffers?.output;
        const groupResources = this.towerGroupRuntime.getCreationResources?.();
        const abilityMetadata = this.abilitySubjectSnapshotRuntime
            .buffers?.metadata;
        if (!snapshotBuffer || !abilityMetadata
            || !groupResources?.members || !groupResources?.roster
            || !simulation.device || !simulation.buffers?.physics
            || !simulation.buffers.simulation || !simulation.buffers.sdf) {
            return false;
        }
        try {
            return this.actorActionPlacementRuntime.initialize(
                simulation.device,
                {
                    snapshot: snapshotBuffer,
                    physics: simulation.buffers.physics,
                    simulation: simulation.buffers.simulation,
                    abilityMetadata,
                    towerMembers: groupResources.members,
                    towerRoster: groupResources.roster,
                    sdf: simulation.buffers.sdf,
                    params: simulation.buffers.computeParams,
                    gridCounts: simulation.buffers.gridCounts,
                    gridBodies: simulation.buffers.gridBodies
                },
                {
                    sessionGeneration: this.sessionGeneration,
                    deviceGeneration: simulation.deviceGeneration,
                    authoritativeEpoch: simulation.authoritativeEpoch,
                    bodyCapacity: this.capacity,
                    // Tower member records are indexed by stable body slot, so
                    // the bound storage capacity is the body capacity. The
                    // separate towerGroupMemberCapacity remains the logical
                    // living-Tower count limit enforced by the coordinator.
                    towerMemberCapacity: this.capacity
                }
            );
        } catch {
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

    #rollbackUntrackedTowerCreationBodyPrelease(prelease) {
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
                this.towerCreationFailure = Object.freeze({
                    stage: 'tower-creation-prelease-rollback',
                    message: 'pending Tower body prelease를 전체 회수하지 못했습니다.'
                });
            }
            return clean;
        } catch (error) {
            this.towerCreationFailure = Object.freeze({
                stage: 'tower-creation-prelease-rollback',
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
