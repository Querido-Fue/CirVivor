import { WorldRegistry } from '../world_registry.js';
import { GpuFixedCommandOwner } from '../gpu_fixed_command_owner.js';
import {
    EnemyLifecycleCommandOwner
} from './enemy_lifecycle_command_owner.js';
import { EnemySimulationBackend } from './enemy_simulation_backend.js';

const DEFAULT_ENEMY_CAPACITY = 16384;
const DEFAULT_COMPLETED_EVENT_SNAPSHOT_CAPACITY = 2048;
const DEFAULT_COMPLETED_EVENT_KEY_HISTORY_CAPACITY = 65536;
let nextGpuSimulationSessionGeneration = 1;

function allocateSessionGeneration() {
    if (!Number.isSafeInteger(nextGpuSimulationSessionGeneration)) {
        throw new RangeError('GPU simulation session generation 공간이 고갈되었습니다.');
    }
    return nextGpuSimulationSessionGeneration++;
}

function requirePositiveSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
        throw new RangeError(`${label}은 양의 안전한 정수여야 합니다.`);
    }
    return number;
}

function toNonNegativeSafeInteger(value, fallback = 0) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function toPositiveSafeInteger(value, fallback = 0) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function freezePosition(source) {
    const x = Number(source?.x);
    const y = Number(source?.y);
    return Number.isFinite(x) && Number.isFinite(y)
        ? Object.freeze({ x, y })
        : null;
}

function createEmptyCompletedEventSnapshot(completedThroughTick = 0, overrides = {}) {
    return Object.freeze({
        targetFixedTick: null,
        completedThroughTick,
        batchCount: 0,
        droppedEventCount: 0,
        events: Object.freeze([]),
        contactEvents: Object.freeze([]),
        deathEvents: Object.freeze([]),
        protocolFailure: null,
        ...overrides
    });
}

function assertEnemySimulationBackend(backend) {
    const requiredMethods = [
        'init',
        'spawnBodies',
        'despawnBodies',
        'hasBody',
        'hasActiveBodies',
        'fixedUpdate',
        'updatePresentation',
        'synchronizePresentation',
        'draw',
        'getRuntimeState',
        'requiresRecovery',
        'destroy'
    ];
    for (const methodName of requiredMethods) {
        if (typeof backend?.[methodName] !== 'function') {
            throw new TypeError(`enemySimulationBackend.${methodName}()가 필요합니다.`);
        }
    }
    return backend;
}

function resolveCapacity(backend, options) {
    const capacity = typeof backend.getCapacity === 'function'
        ? backend.getCapacity()
        : options.capacity ?? DEFAULT_ENEMY_CAPACITY;
    const number = Number(capacity);
    if (!Number.isSafeInteger(number) || number <= 0) {
        throw new RangeError('GPU enemy capacity는 양의 안전한 정수여야 합니다.');
    }
    return number;
}

function createFixedPrimitiveBackendPort(backend, sessionGeneration) {
    return Object.freeze({
        hasBody: (handle) => backend.hasBody(handle),
        canControlBody: (handle) => backend.canControlBody?.(handle) ?? false,
        stageFixedPrograms: (plan) => backend.stageFixedPrograms?.(plan)
            ?? Object.freeze({
                accepted: 0,
                rejected: (plan.controls?.length ?? 0)
                    + (plan.sourceRelativeSpawns?.length ?? 0),
                reason: 'fixed-primitives-unsupported'
            }),
        drainCompletedSpawnProgramBatches: (out) => (
            backend.drainCompletedSpawnProgramBatches?.(out) ?? out
        ),
        getEventProtocolState: () => backend.getEventProtocolState?.()
            ?? Object.freeze({
                sessionGeneration,
                deviceGeneration: 0,
                authoritativeEpoch: 0,
                submittedTickCount: 0
            }),
        requiresRecovery: () => backend.requiresRecovery(),
        getRuntimeState: () => backend.getRuntimeState()
    });
}

/**
 * @class GpuEnemySimulationEndpoint
 * @description 게임 코드가 적·투사체를 공유하는 GPU 물리의 lifecycle·fixed tick·presentation을
 * 한 경계에서 안전하게 사용할 수 있게 하는 공개 session facade입니다.
 * 기존 class 이름은 호환을 위해 유지하며 `GpuSimulationEndpoint`가 canonical alias입니다.
 */
export class GpuEnemySimulationEndpoint {
    /**
     * @param {{webGpuPlatformPort?:object|null,gpuSimulationBackend?:object,gpuSimulationBackendFactory?:(dependencies:object,options:object)=>object,enemySimulationBackend?:object,enemySimulationBackendFactory?:(dependencies:object,options:object)=>object}} [dependencies={}]
     * @param {{capacity?:number,presentationProfile?:string,completedEventSnapshotCapacity?:number,completedEventKeyHistoryCapacity?:number,controlCommandCapacity?:number,spawnProgramCapacity?:number}} [options={}]
     */
    constructor(dependencies = {}, options = {}) {
        this.sessionGeneration = allocateSessionGeneration();
        const backendDependencies = {
            webGpuPlatformPort: dependencies.webGpuPlatformPort ?? null
        };
        const backendOptions = {
            capacity: options.capacity,
            presentationProfile: options.presentationProfile,
            controlCommandCapacity: options.controlCommandCapacity,
            spawnProgramCapacity: options.spawnProgramCapacity,
            sessionGeneration: this.sessionGeneration
        };
        const backendFactory = dependencies.gpuSimulationBackendFactory
            ?? dependencies.enemySimulationBackendFactory;
        const injectedBackend = typeof backendFactory
            === 'function'
            ? backendFactory(
                backendDependencies,
                backendOptions
            )
            : dependencies.gpuSimulationBackend
                ?? dependencies.enemySimulationBackend;
        this.backend = assertEnemySimulationBackend(
            injectedBackend
                ?? new EnemySimulationBackend(backendDependencies, backendOptions)
        );
        this.capacity = resolveCapacity(this.backend, options);
        this.registry = new WorldRegistry({ capacity: this.capacity });
        this.lifecycleCommandOwner = new EnemyLifecycleCommandOwner(
            this.backend,
            this.registry
        );
        this.fixedPrimitiveBackendPort = createFixedPrimitiveBackendPort(
            this.backend,
            this.sessionGeneration
        );
        this.fixedCommandOwner = new GpuFixedCommandOwner(
            this.fixedPrimitiveBackendPort,
            this.registry,
            {
                controlCommandCapacity: options.controlCommandCapacity,
                sourceRelativeSpawnCommandCapacity:
                    options.sourceRelativeSpawnCommandCapacity
            }
        );
        this.completedEventSnapshotCapacity = requirePositiveSafeInteger(
            options.completedEventSnapshotCapacity
                ?? Math.min(this.capacity * 2, DEFAULT_COMPLETED_EVENT_SNAPSHOT_CAPACITY),
            'completedEventSnapshotCapacity'
        );
        this.completedEventKeyHistoryCapacity = requirePositiveSafeInteger(
            options.completedEventKeyHistoryCapacity
                ?? DEFAULT_COMPLETED_EVENT_KEY_HISTORY_CAPACITY,
            'completedEventKeyHistoryCapacity'
        );
        this.completedEventBatchScratch = [];
        this.knownCompletedBatchKeys = new Map();
        this.completedBatchKeys = [];
        this.completedBatchKeyHead = 0;
        this.knownCompletedEventKeys = new Map();
        this.completedEventKeys = [];
        this.completedEventKeyHead = 0;
        this.completedEventTotals = {
            applied: 0,
            death: 0,
            stale: 0,
            deduped: 0
        };
        this.completedThroughTick = 0;
        this.lastAcceptedEventSourceTick = 0;
        this.lastAcceptedEventStreamSourceTick = 0;
        this.lastAcceptedEventSubmittedTick = 0;
        this.lastAcceptedEventProtocolKey = null;
        this.completedEventRecoveryRequired = false;
        this.completedEventProtocolFailure = null;
        this.deferredCompletedEventBatches = [];
        this.lastCompletedSimulationEvents = createEmptyCompletedEventSnapshot();
        this.initialized = false;
        this.destroyed = false;
    }

    /** 맵 topology를 GPU backend에 컴파일합니다. */
    init(tileMap) {
        this.#assertUsable();
        if (this.initialized) {
            return this.backend.getRuntimeState() === 'gpu-ready';
        }
        const ready = this.backend.init(tileMap);
        this.initialized = true;
        return ready;
    }

    /** 다음 fixed 경계에 적용할 spawn을 예약합니다. */
    requestSpawn(intent, targetFixedTick, commandId = null) {
        this.#assertUsable();
        return this.lifecycleCommandOwner.requestSpawn(
            intent,
            targetFixedTick,
            commandId
        );
    }

    /** 다음 fixed 경계들에 적용할 spawn batch를 ingress에서 원자적으로 예약합니다. */
    requestSpawnBatch(requests) {
        this.#assertUsable();
        return this.lifecycleCommandOwner.requestSpawnBatch(requests);
    }

    /** 다음 fixed 경계에 적용할 despawn을 예약합니다. */
    requestDespawn(handle, reason, targetFixedTick, commandId = null) {
        this.#assertUsable();
        return this.lifecycleCommandOwner.requestDespawn(
            handle,
            reason,
            targetFixedTick,
            commandId
        );
    }

    /** Exact active body에 move-only command를 다음 fixed tick 한 번 예약합니다. */
    requestBodyControl(command, targetFixedTick, commandId) {
        this.#assertUsable();
        return this.fixedCommandOwner.requestBodyControl(
            command,
            targetFixedTick,
            commandId
        );
    }

    /** CPU pose를 거치지 않는 tick-start source-relative spawn을 예약합니다. */
    requestSourceRelativeSpawn(intent, targetFixedTick, commandId) {
        this.#assertUsable();
        return this.fixedCommandOwner.requestSourceRelativeSpawn(
            intent,
            targetFixedTick,
            commandId
        );
    }

    /** Session당 exact GPU body 하나의 lossy observed-pose tracking을 설정합니다. */
    configureTrackedBody(handle = null) {
        this.#assertUsable();
        if (handle !== null) {
            const registryHas = this.registry.has(handle);
            const backendHas = this.backend.hasBody(handle);
            if (!registryHas && !backendHas) {
                return Object.freeze({ accepted: false, reason: 'stale-handle' });
            }
            if (registryHas !== backendHas) {
                this.completedEventRecoveryRequired = true;
                this.completedEventProtocolFailure = Object.freeze({
                    stage: 'tracked-pose-config',
                    code: 'registry-backend-desync',
                    name: 'TrackedPoseIdentityMismatch',
                    message: 'tracked body identity가 registry/backend에서 일치하지 않습니다.'
                });
                return Object.freeze({
                    accepted: false,
                    reason: 'registry-backend-desync'
                });
            }
        }
        return this.backend.configureTrackedBody?.(handle)
            ?? Object.freeze({ accepted: false, reason: 'fixed-primitives-unsupported' });
    }

    /** GPU authority가 아닌 최신 bounded observed pose snapshot입니다. */
    getObservedTrackedPose() {
        return this.destroyed
            ? null
            : this.backend.getObservedTrackedPose?.()
                ?? this.backend.getLatestTrackedPose?.()
                ?? null;
    }

    /** @deprecated generic observed 명칭의 compatibility alias입니다. */
    getLatestTrackedPose() {
        return this.getObservedTrackedPose();
    }

    /** 예약한 lifecycle command를 지정 fixed tick에서 원자적으로 반영합니다. */
    commitAtFixedBoundary(fixedTick) {
        this.#assertUsable();
        const tick = requirePositiveSafeInteger(fixedTick, 'fixedTick');
        if (this.completedEventRecoveryRequired
            || this.fixedCommandOwner.getStatus().recoveryRequired
            || this.lifecycleCommandOwner.getStatus().recoveryRequired) {
            return Object.freeze({
                fixedTick: tick,
                state: 'failed',
                spawned: Object.freeze([]),
                despawned: Object.freeze([]),
                rejected: Object.freeze([]),
                recoveryRequired: true,
                backendState: this.backend.getRuntimeState(),
                registryRevision: this.registry.getRevision(),
                fixedCommands: null
            });
        }
        const lifecycle = this.lifecycleCommandOwner.commitAtFixedBoundary(tick);
        if (lifecycle.recoveryRequired) {
            return Object.freeze({
                ...lifecycle,
                fixedCommands: null
            });
        }
        const fixedCommands = this.fixedCommandOwner.commitAtFixedBoundary(tick);
        const recoveryRequired = fixedCommands.recoveryRequired === true;
        const state = recoveryRequired
            ? fixedCommands.state === 'stalled' ? 'stalled' : 'failed'
            : lifecycle.state === 'committed-with-rejections'
                || fixedCommands.state === 'committed-with-rejections'
                ? 'committed-with-rejections'
                : lifecycle.state;
        return Object.freeze({
            ...lifecycle,
            state,
            recoveryRequired,
            fixedCommands
        });
    }

    /**
     * 완료된 GPU event batch를 현재 fixed 경계에서 lifecycle 명령으로 변환합니다.
     * 이 메서드는 command를 예약만 하며 commit은 session owner가 뒤이어 한 번 수행합니다.
     * @param {number} targetFixedTick - 생성한 gpu-death despawn 명령의 적용 tick입니다.
     * @returns {object} 이 경계에서 관찰한 bounded 불변 event snapshot입니다.
     */
    commitCompletedEventsAtFixedBoundary(targetFixedTick) {
        this.#assertUsable();
        const tick = requirePositiveSafeInteger(targetFixedTick, 'targetFixedTick');
        const spawnPrograms = this.fixedCommandOwner
            .commitCompletedAtFixedBoundary(tick);
        if (spawnPrograms.protocolFailure) {
            return this.#failCompletedEventProtocol(
                tick,
                Object.freeze({
                    stage: 'spawn-program-completion',
                    code: spawnPrograms.protocolFailure.code,
                    name: 'SpawnProgramProtocolViolation',
                    message: spawnPrograms.protocolFailure.message
                })
            );
        }
        // lower drain은 마지막 pending batch를 꺼내는 과정에서 idle resource를
        // release하고 authoritative epoch를 올릴 수 있습니다. 방금 drain한
        // envelope는 호출 직전 protocol에 속하므로 그 snapshot으로 검증합니다.
        const protocolAtDrain = this.#readCurrentEventProtocolState();
        const batches = this.completedEventBatchScratch;
        batches.length = 0;
        if (typeof this.backend.drainCompletedEventBatches === 'function') {
            const drained = this.backend.drainCompletedEventBatches(batches);
            if (Array.isArray(drained) && drained !== batches) {
                batches.push(...drained);
            }
        }
        const frozenProtocolAtDrain = protocolAtDrain
            ? Object.freeze({ ...protocolAtDrain })
            : null;
        if (this.completedEventRecoveryRequired) {
            // Sticky protocol failure 뒤에도 lower queue는 비우되 새 batch를
            // facade deferred queue에 보존하지 않습니다. recovery owner가 session을
            // 재구성할 때까지 public endpoint의 메모리 사용량을 bounded하게 유지합니다.
            batches.length = 0;
            this.deferredCompletedEventBatches.length = 0;
            this.lastCompletedSimulationEvents = createEmptyCompletedEventSnapshot(
                this.completedThroughTick,
                {
                    targetFixedTick: tick,
                    protocolFailure: this.completedEventProtocolFailure
                }
            );
            return this.lastCompletedSimulationEvents;
        }
        for (const batch of batches) {
            this.deferredCompletedEventBatches.push(Object.freeze({
                source: batch,
                protocol: frozenProtocolAtDrain
            }));
        }
        batches.length = 0;

        const prepared = this.#prepareCompletedEventCommit(tick);
        if (prepared.failure) {
            return this.#failCompletedEventProtocol(tick, prepared.failure);
        }
        this.deferredCompletedEventBatches = prepared.retainedBatches;
        for (const batch of prepared.acceptedBatches) {
            this.#rememberCompletedBatchKey(batch.key, batch.fingerprint);
        }
        const events = [];
        const contactEvents = [];
        const deathEvents = [];
        this.completedEventTotals.stale += prepared.staleEventCount;
        for (const normalized of prepared.events) {
            const knownFingerprint = this.knownCompletedEventKeys.get(normalized.key);
            let disposition = knownFingerprint === normalized.fingerprint
                ? 'duplicate'
                : 'observed';
            if (disposition === 'duplicate') {
                this.completedEventTotals.deduped++;
            } else {
                this.#rememberCompletedEventKey(
                    normalized.key,
                    normalized.fingerprint
                );
                if (!this.#isCompletedEventIdentityLive(normalized)) {
                    disposition = 'stale';
                    this.completedEventTotals.stale++;
                } else if (normalized.type === 'death') {
                    this.completedEventTotals.death++;
                    const handle = {
                        entityId: normalized.entityId,
                        incarnation: normalized.incarnation
                    };
                    const requested = this.lifecycleCommandOwner.requestDespawn(
                        handle,
                        'gpu-death',
                        tick,
                        `gpu-death:${normalized.key}`
                    );
                    if (requested.accepted) {
                        disposition = 'despawn-requested';
                    } else {
                        disposition = 'duplicate';
                        this.completedEventTotals.deduped++;
                    }
                } else {
                    this.completedEventTotals.applied++;
                    disposition = 'applied';
                }
            }
            const { fingerprint: _fingerprint, ...publicEvent } = normalized;
            const event = Object.freeze({ ...publicEvent, disposition });
            events.push(event);
            if (event.type === 'death') {
                deathEvents.push(event);
            } else {
                contactEvents.push(event);
            }
        }
        this.completedThroughTick = prepared.completedThroughTick;
        this.lastAcceptedEventSourceTick = prepared.lastSourceTick;
        this.lastAcceptedEventStreamSourceTick = prepared.lastStreamSourceTick;
        this.lastAcceptedEventSubmittedTick = prepared.lastSubmittedTick;
        this.lastAcceptedEventProtocolKey = prepared.protocolKey;
        this.lastCompletedSimulationEvents = Object.freeze({
            targetFixedTick: tick,
            completedThroughTick: this.completedThroughTick,
            batchCount: prepared.batchCount,
            droppedEventCount: 0,
            events: Object.freeze(events),
            contactEvents: Object.freeze(contactEvents),
            deathEvents: Object.freeze(deathEvents),
            protocolFailure: null
        });
        return this.lastCompletedSimulationEvents;
    }

    /** 최신 fixed-boundary의 bounded 완료 event snapshot입니다. */
    getLastCompletedSimulationEvents() {
        return this.lastCompletedSimulationEvents;
    }

    /** 권위 GPU 물리를 한 fixed step 제출합니다. */
    fixedUpdate(delta, sourceTick) {
        this.#assertUsable();
        if (this.completedEventRecoveryRequired
            || this.fixedCommandOwner.getStatus().recoveryRequired
            || this.lifecycleCommandOwner.getStatus().recoveryRequired) {
            return false;
        }
        return this.backend.fixedUpdate(delta, sourceTick);
    }

    /** 렌더 프레임 presentation clock만 갱신합니다. */
    updatePresentation(frame) {
        if (this.destroyed) {
            return;
        }
        this.backend.updatePresentation(frame);
    }

    /** pause/resume 경계에서 presentation epoch를 권위 물리에 맞춥니다. */
    synchronizePresentation() {
        if (this.destroyed) {
            return;
        }
        this.backend.synchronizePresentation();
    }

    /** 현재 카메라로 GPU indirect render를 제출합니다. */
    draw(camera) {
        if (this.destroyed) {
            return false;
        }
        return this.backend.draw(camera);
    }

    hasBody(handle) {
        return !this.destroyed && this.backend.hasBody(handle);
    }

    hasActiveBodies() {
        return !this.destroyed && this.backend.hasActiveBodies();
    }

    requiresRecovery() {
        return !this.destroyed && (
            this.completedEventRecoveryRequired
            || this.fixedCommandOwner.getStatus().recoveryRequired
            || this.lifecycleCommandOwner.getStatus().recoveryRequired
            || this.backend.requiresRecovery()
        );
    }

    getRuntimeState() {
        return this.destroyed ? 'destroyed' : this.backend.getRuntimeState();
    }

    getPendingCommandCount() {
        return this.destroyed
            ? 0
            : this.lifecycleCommandOwner.getPendingCount()
                + this.fixedCommandOwner.getPendingCount();
    }

    getCapacity() {
        return this.capacity;
    }

    /** 저수준 backend는 호환·진단용이며 lifecycle mutation은 endpoint를 사용해야 합니다. */
    getBackend() {
        return this.backend;
    }

    /** handle/metadata query를 위한 session registry입니다. */
    getRegistry() {
        return this.registry;
    }

    /** 기존 gameplay adapter와의 점진적 이식을 위한 lifecycle owner입니다. */
    getLifecycleCommandOwner() {
        return this.lifecycleCommandOwner;
    }

    /** HUD·테스트가 전체 session을 한 번에 읽는 불변 진단 snapshot입니다. */
    getStatus() {
        const registry = this.registry.getStatus();
        const lifecycle = this.lifecycleCommandOwner.getStatus();
        const fixedCommands = this.fixedCommandOwner.getStatus();
        const backend = typeof this.backend.getStatus === 'function'
            ? this.backend.getStatus()
            : Object.freeze({ state: this.getRuntimeState() });
        const events = Object.freeze({
            sessionGeneration: this.sessionGeneration,
            completedThroughTick: this.completedThroughTick,
            applied: this.completedEventTotals.applied,
            death: this.completedEventTotals.death,
            stale: this.completedEventTotals.stale,
            deduped: this.completedEventTotals.deduped,
            recoveryRequired: this.completedEventRecoveryRequired,
            protocolFailure: this.completedEventProtocolFailure,
            deferredBatchCount: this.deferredCompletedEventBatches.length,
            lastCompleted: this.lastCompletedSimulationEvents,
            backend: backend.events ?? backend.gpu?.events ?? null
        });
        return Object.freeze({
            state: this.getRuntimeState(),
            initialized: this.initialized,
            destroyed: this.destroyed,
            capacity: this.capacity,
            sessionGeneration: this.sessionGeneration,
            activeCount: registry.activeCount,
            activeEnemyCount: this.registry.getActiveCount('enemy'),
            activeProjectileCount: this.registry.getActiveCount('projectile'),
            reservedCount: registry.reservedCount,
            pendingCommandCount: lifecycle.pendingCount
                + fixedCommands.pendingCommandCount
                + fixedCommands.pendingDestinationCount,
            pendingFixedCommandCount: fixedCommands.pendingCommandCount,
            pendingSourceRelativeDestinationCount:
                fixedCommands.pendingDestinationCount,
            completedThroughTick: this.completedThroughTick,
            recoveryRequired: !this.destroyed && (
                this.completedEventRecoveryRequired
                || fixedCommands.recoveryRequired
                || lifecycle.recoveryRequired
                || this.backend.requiresRecovery()
            ),
            events,
            backend,
            fixedCommands,
            lifecycle,
            registry
        });
    }

    /** endpoint가 소유한 lifecycle → registry → backend를 반복 호출 가능하게 정리합니다. */
    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.fixedCommandOwner.destroy();
        this.lifecycleCommandOwner.destroy();
        this.registry.destroy();
        this.backend.destroy();
        this.completedEventBatchScratch.length = 0;
        this.deferredCompletedEventBatches.length = 0;
        this.knownCompletedBatchKeys.clear();
        this.completedBatchKeys.length = 0;
        this.completedBatchKeyHead = 0;
        this.knownCompletedEventKeys.clear();
        this.completedEventKeys.length = 0;
        this.completedEventKeyHead = 0;
        this.initialized = false;
    }

    #prepareCompletedEventCommit(targetFixedTick) {
        const queued = this.deferredCompletedEventBatches;
        if (queued.length > this.completedEventSnapshotCapacity) {
            return {
                failure: this.#createEventProtocolFailure(
                    'batch-capacity',
                    `deferred batch가 bounded capacity를 초과했습니다: ${queued.length}/${this.completedEventSnapshotCapacity}`
                )
            };
        }
        const eligible = [];
        const future = [];
        let staleEventCount = 0;
        let encounteredFuture = false;
        for (let index = 0; index < queued.length; index++) {
            const queueEntry = queued[index];
            const source = queueEntry?.source;
            const protocol = queueEntry?.protocol;
            if (!protocol) {
                return {
                    failure: this.#createEventProtocolFailure(
                        'protocol-state-unavailable',
                        'batch를 drain한 시점의 event protocol state를 검증할 수 없습니다.'
                    )
                };
            }
            if (protocol.sessionGeneration !== this.sessionGeneration) {
                return {
                    failure: this.#createEventProtocolFailure(
                        'generation-mismatch',
                        `backend protocol session이 endpoint와 다릅니다: ${protocol.sessionGeneration}/${this.sessionGeneration}`
                    )
                };
            }
            const envelope = this.#normalizeCompletedBatchEnvelope(source, index);
            if (envelope.failure) {
                return { failure: envelope.failure };
            }
            const batch = {
                ...envelope.batch,
                queueEntry,
                protocolKey: `${protocol.sessionGeneration}:${protocol.deviceGeneration}:${protocol.authoritativeEpoch}`
            };
            const hasOlderGeneration = batch.sessionGeneration < this.sessionGeneration
                || batch.deviceGeneration < protocol.deviceGeneration
                || batch.authoritativeEpoch < protocol.authoritativeEpoch;
            const hasNewerGeneration = batch.sessionGeneration > this.sessionGeneration
                || batch.deviceGeneration > protocol.deviceGeneration
                || batch.authoritativeEpoch > protocol.authoritativeEpoch;
            if (hasNewerGeneration) {
                return {
                    failure: this.#createEventProtocolFailure(
                        'generation-mismatch',
                        `batch generation이 현재 protocol과 다릅니다: session=${batch.sessionGeneration}/${this.sessionGeneration}, device=${batch.deviceGeneration}/${protocol.deviceGeneration}, epoch=${batch.authoritativeEpoch}/${protocol.authoritativeEpoch}`
                    )
                };
            }
            if (hasOlderGeneration) {
                staleEventCount += batch.sourceEvents.length;
                continue;
            }
            if (this.backend.hasPendingSpawnProgramThroughTick?.(batch.sourceTick)) {
                encounteredFuture = true;
                future.push(batch);
                continue;
            }
            if (batch.sourceTick >= targetFixedTick) {
                encounteredFuture = true;
                future.push(batch);
                continue;
            }
            if (encounteredFuture) {
                return {
                    failure: this.#createEventProtocolFailure(
                        'future-order',
                        'future tick batch 뒤에 commit 가능한 과거 batch가 도착했습니다.'
                    )
                };
            }
            eligible.push(batch);
        }

        if (eligible.length === 0) {
            return {
                failure: null,
                retainedBatches: future.map(({ queueEntry }) => queueEntry),
                acceptedBatches: [],
                events: [],
                staleEventCount,
                completedThroughTick: this.completedThroughTick,
                lastSourceTick: this.lastAcceptedEventSourceTick,
                lastStreamSourceTick: this.lastAcceptedEventStreamSourceTick,
                lastSubmittedTick: this.lastAcceptedEventSubmittedTick,
                protocolKey: this.lastAcceptedEventProtocolKey,
                batchCount: 0
            };
        }

        const eligibleMaximumSourceTick = eligible[eligible.length - 1].sourceTick;
        if (future.length > 0 && eligible.some((batch) => (
            batch.completedThroughTick > eligibleMaximumSourceTick
        ))) {
            return {
                failure: null,
                retainedBatches: [
                    ...eligible.map(({ queueEntry }) => queueEntry),
                    ...future.map(({ queueEntry }) => queueEntry)
                ],
                acceptedBatches: [],
                events: [],
                staleEventCount,
                completedThroughTick: this.completedThroughTick,
                lastSourceTick: this.lastAcceptedEventSourceTick,
                lastStreamSourceTick: this.lastAcceptedEventStreamSourceTick,
                lastSubmittedTick: this.lastAcceptedEventSubmittedTick,
                protocolKey: this.lastAcceptedEventProtocolKey,
                batchCount: 0
            };
        }

        const normalizedEvents = [];
        const acceptedBatches = [];
        const preparedBatchFingerprints = new Map();
        let lastSourceTick = this.lastAcceptedEventSourceTick;
        let activeProtocolKey = this.lastAcceptedEventProtocolKey;
        let lastStreamSourceTick = this.lastAcceptedEventStreamSourceTick;
        let lastSubmittedTick = this.lastAcceptedEventSubmittedTick;
        let previousCompletedThroughTick = this.completedThroughTick;
        let newestAcceptedSourceTick = this.completedThroughTick;
        let acceptedBatchCount = 0;
        for (const batch of eligible) {
            const batchEvents = [];
            const sequenceFingerprints = new Map();
            let expectedSequence = 0;
            for (const sourceEvent of batch.sourceEvents) {
                let normalized;
                try {
                    normalized = this.#normalizeCompletedEvent(sourceEvent, batch);
                } catch (error) {
                    return {
                        failure: this.#createEventProtocolFailure(
                            'event-contract',
                            String(error?.message ?? error)
                        )
                    };
                }
                const priorSequenceFingerprint = sequenceFingerprints.get(
                    normalized.sequence
                );
                if (priorSequenceFingerprint !== undefined) {
                    if (priorSequenceFingerprint !== normalized.fingerprint) {
                        return {
                            failure: this.#createEventProtocolFailure(
                                'duplicate-sequence-conflict',
                                `sequence ${normalized.sequence}가 서로 다른 payload를 가집니다.`
                            )
                        };
                    }
                } else {
                    if (normalized.sequence !== expectedSequence) {
                        return {
                            failure: this.#createEventProtocolFailure(
                                'sequence-gap',
                                `event sequence가 contiguous하지 않습니다: expected=${expectedSequence}, actual=${normalized.sequence}`
                            )
                        };
                    }
                    sequenceFingerprints.set(
                        normalized.sequence,
                        normalized.fingerprint
                    );
                    expectedSequence++;
                }
                const knownFingerprint = this.knownCompletedEventKeys.get(normalized.key);
                if (knownFingerprint !== undefined
                    && knownFingerprint !== normalized.fingerprint) {
                    return {
                        failure: this.#createEventProtocolFailure(
                            'duplicate-key-conflict',
                            `기존 event key가 다른 payload로 재사용되었습니다: ${normalized.key}`
                        )
                    };
                }
                batchEvents.push(normalized);
            }
            const batchKey = [
                batch.sessionGeneration,
                batch.deviceGeneration,
                batch.authoritativeEpoch,
                batch.sourceTick,
                batch.submittedTick
            ].join(':');
            const batchFingerprint = JSON.stringify([
                batch.previousSourceTick,
                batch.previousSubmittedTick,
                batch.completedThroughTick,
                ...batchEvents.map(({ fingerprint }) => fingerprint)
            ]);
            const knownBatchFingerprint = this.knownCompletedBatchKeys.get(batchKey)
                ?? preparedBatchFingerprints.get(batchKey);
            if (knownBatchFingerprint !== undefined
                && knownBatchFingerprint !== batchFingerprint) {
                return {
                    failure: this.#createEventProtocolFailure(
                        'duplicate-batch-conflict',
                        `기존 event batch key가 다른 envelope로 재사용되었습니다: ${batchKey}`
                    )
                };
            }
            const historicalDuplicate = knownBatchFingerprint === batchFingerprint;
            if (!historicalDuplicate) {
                if (batch.protocolKey !== activeProtocolKey) {
                    lastStreamSourceTick = 0;
                    lastSubmittedTick = 0;
                }
                if (batch.previousSourceTick !== lastStreamSourceTick
                    || batch.previousSubmittedTick !== lastSubmittedTick) {
                    return {
                        failure: this.#createEventProtocolFailure(
                            'batch-gap',
                            `event batch predecessor가 contiguous하지 않습니다: source=${batch.previousSourceTick}/${lastStreamSourceTick}, submitted=${batch.previousSubmittedTick}/${lastSubmittedTick}`
                        )
                    };
                }
                if (batch.sourceTick <= lastSourceTick
                    || batch.sourceTick <= batch.previousSourceTick
                    || batch.submittedTick <= batch.previousSubmittedTick) {
                    return {
                        failure: this.#createEventProtocolFailure(
                            'batch-regression',
                            `batch tick이 회귀했습니다: source=${batch.sourceTick}/${batch.previousSourceTick}, submitted=${batch.submittedTick}/${batch.previousSubmittedTick}`
                        )
                    };
                }
                if (batch.completedThroughTick < batch.sourceTick
                    || batch.completedThroughTick < previousCompletedThroughTick) {
                    return {
                        failure: this.#createEventProtocolFailure(
                            'watermark-regression',
                            `batch watermark가 불완전합니다: source=${batch.sourceTick}, completed=${batch.completedThroughTick}, previous=${previousCompletedThroughTick}`
                        )
                    };
                }
                previousCompletedThroughTick = batch.completedThroughTick;
                newestAcceptedSourceTick = batch.sourceTick;
                lastSourceTick = batch.sourceTick;
                lastStreamSourceTick = batch.sourceTick;
                lastSubmittedTick = batch.submittedTick;
                activeProtocolKey = batch.protocolKey;
                acceptedBatchCount++;
                acceptedBatches.push({
                    key: batchKey,
                    fingerprint: batchFingerprint
                });
                preparedBatchFingerprints.set(batchKey, batchFingerprint);
            }
            normalizedEvents.push(...batchEvents);
        }
        if (normalizedEvents.length > this.completedEventSnapshotCapacity) {
            return {
                failure: this.#createEventProtocolFailure(
                    'snapshot-capacity',
                    `event snapshot capacity를 초과했습니다: ${normalizedEvents.length}/${this.completedEventSnapshotCapacity}`
                )
            };
        }
        if (acceptedBatchCount > 0
            && previousCompletedThroughTick !== newestAcceptedSourceTick) {
            return {
                failure: this.#createEventProtocolFailure(
                    'watermark-gap',
                    `완료 watermark에 대응하는 batch prefix가 없습니다: completed=${previousCompletedThroughTick}, newest=${newestAcceptedSourceTick}`
                )
            };
        }
        return {
            failure: null,
            retainedBatches: future.map(({ queueEntry }) => queueEntry),
            acceptedBatches,
            events: normalizedEvents,
            staleEventCount,
            completedThroughTick: acceptedBatchCount > 0
                ? newestAcceptedSourceTick
                : this.completedThroughTick,
            lastSourceTick,
            lastStreamSourceTick,
            lastSubmittedTick,
            protocolKey: activeProtocolKey,
            batchCount: eligible.length
        };
    }

    #normalizeCompletedBatchEnvelope(source, index) {
        if (!source || typeof source !== 'object') {
            return {
                failure: this.#createEventProtocolFailure(
                    'batch-contract',
                    `batch[${index}]는 객체여야 합니다.`
                )
            };
        }
        const requiredInteger = (value, label, allowZero = true) => {
            const number = Number(value);
            if (!Number.isSafeInteger(number) || number < (allowZero ? 0 : 1)) {
                throw new RangeError(`${label}은 유효한 안전한 정수여야 합니다.`);
            }
            return number;
        };
        try {
            const sourceEvents = Array.isArray(source.events)
                ? source.events
                : null;
            if (!sourceEvents) {
                throw new TypeError(`batch[${index}].events 배열이 필요합니다.`);
            }
            return {
                failure: null,
                batch: {
                    source,
                    sessionGeneration: requiredInteger(
                        source.sessionGeneration,
                        `batch[${index}].sessionGeneration`,
                        false
                    ),
                    deviceGeneration: requiredInteger(
                        source.deviceGeneration,
                        `batch[${index}].deviceGeneration`
                    ),
                    authoritativeEpoch: requiredInteger(
                        source.authoritativeEpoch,
                        `batch[${index}].authoritativeEpoch`
                    ),
                    previousSourceTick: requiredInteger(
                        source.previousSourceTick,
                        `batch[${index}].previousSourceTick`
                    ),
                    previousSubmittedTick: requiredInteger(
                        source.previousSubmittedTick,
                        `batch[${index}].previousSubmittedTick`
                    ),
                    sourceTick: requiredInteger(
                        source.sourceTick,
                        `batch[${index}].sourceTick`,
                        false
                    ),
                    submittedTick: requiredInteger(
                        source.submittedTick,
                        `batch[${index}].submittedTick`,
                        false
                    ),
                    completedThroughTick: requiredInteger(
                        source.completedThroughTick,
                        `batch[${index}].completedThroughTick`
                    ),
                    sourceEvents
                }
            };
        } catch (error) {
            return {
                failure: this.#createEventProtocolFailure(
                    'batch-contract',
                    String(error?.message ?? error)
                )
            };
        }
    }

    #readCurrentEventProtocolState() {
        let source = null;
        try {
            source = this.backend.getEventProtocolState?.() ?? null;
            if (!source && typeof this.backend.getStatus === 'function') {
                const status = this.backend.getStatus();
                source = status?.gpu ?? status;
            }
        } catch {
            return null;
        }
        const sessionGeneration = Number(source?.sessionGeneration);
        const deviceGeneration = Number(source?.deviceGeneration);
        const authoritativeEpoch = Number(source?.authoritativeEpoch);
        if (!Number.isSafeInteger(sessionGeneration) || sessionGeneration <= 0
            || !Number.isSafeInteger(deviceGeneration) || deviceGeneration < 0
            || !Number.isSafeInteger(authoritativeEpoch) || authoritativeEpoch < 0) {
            return null;
        }
        return { sessionGeneration, deviceGeneration, authoritativeEpoch };
    }

    #createEventProtocolFailure(code, message) {
        return Object.freeze({
            stage: 'completed-event-protocol',
            code,
            name: 'CompletedEventProtocolViolation',
            message
        });
    }

    #failCompletedEventProtocol(targetFixedTick, failure) {
        this.completedEventRecoveryRequired = true;
        this.completedEventProtocolFailure = failure;
        this.deferredCompletedEventBatches.length = 0;
        this.lastCompletedSimulationEvents = createEmptyCompletedEventSnapshot(
            this.completedThroughTick,
            {
                targetFixedTick,
                protocolFailure: failure
            }
        );
        return this.lastCompletedSimulationEvents;
    }

    #normalizeCompletedEvent(source, context) {
        const event = source && typeof source === 'object' ? source : {};
        const type = event.type === 'death' ? 'death' : 'contact';
        const sequence = Number(event.sequence);
        if (!Number.isSafeInteger(sequence) || sequence < 0) {
            throw new RangeError('event.sequence는 0 이상의 안전한 정수여야 합니다.');
        }
        const sourceTick = context.sourceTick;
        const deviceGeneration = context.deviceGeneration;
        const authoritativeEpoch = context.authoritativeEpoch;
        const entityId = toPositiveSafeInteger(event.entityId);
        const incarnation = toPositiveSafeInteger(event.incarnation);
        const otherEntityId = toPositiveSafeInteger(
            event.otherEntityId ?? event.other?.entityId
        );
        const otherIncarnation = toPositiveSafeInteger(
            event.otherIncarnation ?? event.other?.incarnation
        );
        if (entityId <= 0 || incarnation <= 0) {
            throw new RangeError('event subject identity가 유효하지 않습니다.');
        }
        if ((otherEntityId === 0) !== (otherIncarnation === 0)) {
            throw new RangeError('event other identity는 두 component가 함께 있어야 합니다.');
        }
        const eventType = type === 'death' ? 'death' : event.eventType;
        if (type !== 'death'
            && eventType !== 'damage-applied'
            && eventType !== 'interaction-enter'
            && eventType !== 'interaction-continuous') {
            throw new RangeError(`지원하지 않는 applied event type입니다: ${String(eventType)}`);
        }
        const valueFixedPoint = Number(
            event.valueFixedPoint ?? event.damageFixedPoint ?? 0
        );
        if (!Number.isSafeInteger(valueFixedPoint)
            || (eventType === 'damage-applied' && valueFixedPoint <= 0)
            || (eventType !== 'damage-applied' && valueFixedPoint !== 0)) {
            throw new RangeError(
                `event value/type contract가 잘못되었습니다: type=${eventType}, value=${valueFixedPoint}`
            );
        }
        if (eventType === 'damage-applied'
            && (otherEntityId <= 0 || otherIncarnation <= 0)) {
            throw new RangeError('damage-applied event에는 exact other identity가 필요합니다.');
        }
        const key = [
            this.sessionGeneration,
            deviceGeneration,
            authoritativeEpoch,
            entityId,
            incarnation,
            sourceTick,
            sequence,
            eventType
        ].join(':');
        const normalized = {
            key,
            type,
            eventType,
            sessionGeneration: this.sessionGeneration,
            deviceGeneration,
            authoritativeEpoch,
            sourceTick,
            sequence,
            entityId,
            incarnation,
            otherEntityId,
            otherIncarnation,
            other: otherEntityId > 0 && otherIncarnation > 0
                ? Object.freeze({
                    entityId: otherEntityId,
                    incarnation: otherIncarnation
                })
                : null,
            bodyId: toNonNegativeSafeInteger(event.bodyId),
            position: freezePosition(event.position),
            valueFixedPoint,
            damageFixedPoint: eventType === 'damage-applied' ? valueFixedPoint : 0,
            damage: eventType === 'damage-applied'
                && Number.isFinite(Number(event.damage))
                ? Number(event.damage)
                : 0,
            flags: toNonNegativeSafeInteger(event.flags),
            reasonFlags: toNonNegativeSafeInteger(
                event.reasonFlags ?? (type === 'death' ? event.flags : 0)
            ),
            reason: event.reason ?? null
        };
        const fingerprint = JSON.stringify([
            normalized.type,
            normalized.eventType,
            normalized.entityId,
            normalized.incarnation,
            normalized.otherEntityId,
            normalized.otherIncarnation,
            normalized.bodyId,
            normalized.valueFixedPoint,
            normalized.flags,
            normalized.reasonFlags,
            normalized.position?.x ?? null,
            normalized.position?.y ?? null
        ]);
        return Object.freeze({ ...normalized, fingerprint });
    }

    #isCompletedEventIdentityLive(event) {
        const subject = {
            entityId: event.entityId,
            incarnation: event.incarnation
        };
        if (!this.registry.has(subject) || !this.backend.hasBody(subject)) {
            return false;
        }
        if (event.otherEntityId > 0 && event.otherIncarnation > 0) {
            const other = {
                entityId: event.otherEntityId,
                incarnation: event.otherIncarnation
            };
            return this.registry.has(other) && this.backend.hasBody(other);
        }
        return true;
    }

    #rememberCompletedBatchKey(key, fingerprint) {
        this.knownCompletedBatchKeys.set(key, fingerprint);
        this.completedBatchKeys.push(key);
        while ((this.completedBatchKeys.length - this.completedBatchKeyHead)
            > this.completedEventKeyHistoryCapacity) {
            this.knownCompletedBatchKeys.delete(
                this.completedBatchKeys[this.completedBatchKeyHead++]
            );
        }
        if (this.completedBatchKeyHead >= this.completedEventKeyHistoryCapacity) {
            this.completedBatchKeys = this.completedBatchKeys.slice(
                this.completedBatchKeyHead
            );
            this.completedBatchKeyHead = 0;
        }
    }

    #rememberCompletedEventKey(key, fingerprint) {
        this.knownCompletedEventKeys.set(key, fingerprint);
        this.completedEventKeys.push(key);
        while ((this.completedEventKeys.length - this.completedEventKeyHead)
            > this.completedEventKeyHistoryCapacity) {
            this.knownCompletedEventKeys.delete(
                this.completedEventKeys[this.completedEventKeyHead++]
            );
        }
        if (this.completedEventKeyHead >= this.completedEventKeyHistoryCapacity) {
            this.completedEventKeys = this.completedEventKeys.slice(
                this.completedEventKeyHead
            );
            this.completedEventKeyHead = 0;
        }
    }

    #assertUsable() {
        if (this.destroyed) {
            throw new Error('destroy된 GpuEnemySimulationEndpoint는 사용할 수 없습니다.');
        }
    }
}

/**
 * 게임·벤치마크·도구 코드가 같은 기본 구성을 공유하는 간단한 생성 진입점입니다.
 */
export function createGpuEnemySimulationEndpoint(dependencies = {}, options = {}) {
    return new GpuEnemySimulationEndpoint(dependencies, options);
}

/**
 * 적·투사체가 한 body/grid session을 공유하는 canonical public class alias입니다.
 * 기존 `GpuEnemySimulationEndpoint`와 constructor identity가 같습니다.
 */
export const GpuSimulationEndpoint = GpuEnemySimulationEndpoint;

/** mixed-body GPU session의 canonical factory입니다. */
export function createGpuSimulationEndpoint(dependencies = {}, options = {}) {
    return new GpuSimulationEndpoint(dependencies, options);
}
