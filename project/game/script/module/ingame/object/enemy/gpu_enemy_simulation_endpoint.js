import { WorldRegistry } from '../world_registry.js';
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

function createEmptyCompletedEventSnapshot(completedThroughTick = 0) {
    return Object.freeze({
        targetFixedTick: null,
        completedThroughTick,
        batchCount: 0,
        droppedEventCount: 0,
        events: Object.freeze([]),
        contactEvents: Object.freeze([]),
        deathEvents: Object.freeze([])
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

/**
 * @class GpuEnemySimulationEndpoint
 * @description 게임 코드가 적·투사체를 공유하는 GPU 물리의 lifecycle·fixed tick·presentation을
 * 한 경계에서 안전하게 사용할 수 있게 하는 공개 session facade입니다.
 * 기존 class 이름은 호환을 위해 유지하며 `GpuSimulationEndpoint`가 canonical alias입니다.
 */
export class GpuEnemySimulationEndpoint {
    /**
     * @param {{webGpuPlatformPort?:object|null,gpuSimulationBackend?:object,gpuSimulationBackendFactory?:(dependencies:object,options:object)=>object,enemySimulationBackend?:object,enemySimulationBackendFactory?:(dependencies:object,options:object)=>object}} [dependencies={}]
     * @param {{capacity?:number,presentationProfile?:string,completedEventSnapshotCapacity?:number,completedEventKeyHistoryCapacity?:number}} [options={}]
     */
    constructor(dependencies = {}, options = {}) {
        const backendDependencies = {
            webGpuPlatformPort: dependencies.webGpuPlatformPort ?? null
        };
        const backendOptions = {
            capacity: options.capacity,
            presentationProfile: options.presentationProfile
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
        this.sessionGeneration = allocateSessionGeneration();
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
        this.knownCompletedEventKeys = new Set();
        this.completedEventKeys = [];
        this.completedEventKeyHead = 0;
        this.completedEventTotals = {
            applied: 0,
            death: 0,
            stale: 0,
            deduped: 0
        };
        this.completedThroughTick = 0;
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

    /** 예약한 lifecycle command를 지정 fixed tick에서 원자적으로 반영합니다. */
    commitAtFixedBoundary(fixedTick) {
        this.#assertUsable();
        return this.lifecycleCommandOwner.commitAtFixedBoundary(fixedTick);
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
        const batches = this.completedEventBatchScratch;
        batches.length = 0;
        if (typeof this.backend.drainCompletedEventBatches === 'function') {
            const drained = this.backend.drainCompletedEventBatches(batches);
            if (Array.isArray(drained) && drained !== batches) {
                batches.push(...drained);
            }
        }

        const events = [];
        const contactEvents = [];
        const deathEvents = [];
        let droppedEventCount = 0;
        let fallbackSequence = 0;
        let batchCount = 0;
        for (const batch of batches) {
            if (!batch || typeof batch !== 'object') {
                continue;
            }
            batchCount++;
            const sourceTick = toNonNegativeSafeInteger(
                batch.sourceTick ?? batch.submittedTick
            );
            const deviceGeneration = toNonNegativeSafeInteger(
                batch.deviceGeneration
            );
            this.completedThroughTick = Math.max(
                this.completedThroughTick,
                toNonNegativeSafeInteger(
                    batch.completedThroughTick,
                    sourceTick
                )
            );
            const sourceEvents = Array.isArray(batch.events)
                ? batch.events
                : [
                    ...(Array.isArray(batch.appliedEvents) ? batch.appliedEvents : []),
                    ...(Array.isArray(batch.deathEvents) ? batch.deathEvents : [])
                ];
            for (const sourceEvent of sourceEvents) {
                const normalized = this.#normalizeCompletedEvent(sourceEvent, {
                    sourceTick,
                    deviceGeneration,
                    fallbackSequence: fallbackSequence++
                });
                const duplicate = this.knownCompletedEventKeys.has(normalized.key);
                let disposition = duplicate ? 'duplicate' : 'observed';
                if (duplicate) {
                    this.completedEventTotals.deduped++;
                } else {
                    this.#rememberCompletedEventKey(normalized.key);
                    if (normalized.type === 'death') {
                        this.completedEventTotals.death++;
                        const handle = {
                            entityId: normalized.entityId,
                            incarnation: normalized.incarnation
                        };
                        if (this.registry.has(handle) && this.backend.hasBody(handle)) {
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
                            disposition = 'stale';
                            this.completedEventTotals.stale++;
                        }
                    } else {
                        this.completedEventTotals.applied++;
                        disposition = 'applied';
                    }
                }
                const event = Object.freeze({ ...normalized, disposition });
                if (events.length < this.completedEventSnapshotCapacity) {
                    events.push(event);
                    if (event.type === 'death') {
                        deathEvents.push(event);
                    } else {
                        contactEvents.push(event);
                    }
                } else {
                    droppedEventCount++;
                }
            }
        }
        batches.length = 0;
        this.lastCompletedSimulationEvents = Object.freeze({
            targetFixedTick: tick,
            completedThroughTick: this.completedThroughTick,
            batchCount,
            droppedEventCount,
            events: Object.freeze(events),
            contactEvents: Object.freeze(contactEvents),
            deathEvents: Object.freeze(deathEvents)
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
            this.lifecycleCommandOwner.getStatus().recoveryRequired
            || this.backend.requiresRecovery()
        );
    }

    getRuntimeState() {
        return this.destroyed ? 'destroyed' : this.backend.getRuntimeState();
    }

    getPendingCommandCount() {
        return this.destroyed ? 0 : this.lifecycleCommandOwner.getPendingCount();
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
            pendingCommandCount: lifecycle.pendingCount,
            completedThroughTick: this.completedThroughTick,
            recoveryRequired: !this.destroyed && (
                lifecycle.recoveryRequired || this.backend.requiresRecovery()
            ),
            events,
            backend,
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
        this.lifecycleCommandOwner.destroy();
        this.registry.destroy();
        this.backend.destroy();
        this.completedEventBatchScratch.length = 0;
        this.knownCompletedEventKeys.clear();
        this.completedEventKeys.length = 0;
        this.completedEventKeyHead = 0;
        this.initialized = false;
    }

    #normalizeCompletedEvent(source, context) {
        const event = source && typeof source === 'object' ? source : {};
        const type = event.type === 'death' ? 'death' : 'contact';
        const sequence = toNonNegativeSafeInteger(
            event.sequence,
            context.fallbackSequence
        );
        const sourceTick = toNonNegativeSafeInteger(
            event.sourceTick,
            context.sourceTick
        );
        const deviceGeneration = toNonNegativeSafeInteger(
            event.deviceGeneration,
            context.deviceGeneration
        );
        const entityId = toPositiveSafeInteger(event.entityId);
        const incarnation = toPositiveSafeInteger(event.incarnation);
        const otherEntityId = toPositiveSafeInteger(
            event.otherEntityId ?? event.other?.entityId
        );
        const otherIncarnation = toPositiveSafeInteger(
            event.otherIncarnation ?? event.other?.incarnation
        );
        const key = [
            this.sessionGeneration,
            deviceGeneration,
            entityId,
            incarnation,
            sourceTick,
            sequence,
            type
        ].join(':');
        return Object.freeze({
            key,
            type,
            sessionGeneration: this.sessionGeneration,
            deviceGeneration,
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
            damageFixedPoint: Number.isSafeInteger(Number(event.damageFixedPoint))
                ? Number(event.damageFixedPoint)
                : 0,
            damage: Number.isFinite(Number(event.damage)) ? Number(event.damage) : 0,
            flags: toNonNegativeSafeInteger(event.flags),
            reasonFlags: toNonNegativeSafeInteger(
                event.reasonFlags ?? (type === 'death' ? event.flags : 0)
            ),
            reason: event.reason ?? null
        });
    }

    #rememberCompletedEventKey(key) {
        this.knownCompletedEventKeys.add(key);
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
