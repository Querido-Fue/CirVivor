import {
    INGAME_ENEMY_DEFINITION_BY_ID
} from 'data/object/enemy/basic_circle_enemy_data.js';
import {
    HOSTILE_ATTACK_DEFINITION_BY_ID
} from 'data/object/enemy/archer_attack_data.js';
import {
    HOSTILE_BASIC_BULLET_DATA
} from 'data/object/projectile/hostile_basic_bullet_data.js';
import {
    GAMEPLAY_ALLEGIANCE_POLICY
} from '../../contract/gameplay_team_contract.js';
import {
    PROJECTILE_TARGET_POLICY_ID
} from '../../contract/projectile_target_policy_contract.js';
import {
    GPU_PROJECTILE_SPAWN_MODE,
    GpuProjectileSpawnAdapter
} from '../projectile/gpu_projectile_spawn_adapter.js';

const INVALID_HANDLE_COMPONENT = 0xffffffff;
const DEFAULT_COMPLETION_HISTORY_CAPACITY = 2048;
const EMPTY_COMMAND_IDS = Object.freeze([]);
const CURRENT_TOWER_TARGET_POLICY = 'current-single-living-tower';
const CAST_START_TARGET_SNAPSHOT_POLICY = 'cast-start-exact-handle';

export const HOSTILE_ATTACK_COMMAND_NAMESPACE = 'gpu-hostile-archer-shot';
export const HOSTILE_ATTACK_SHOT_STATE = Object.freeze({
    IDLE: 'IDLE',
    REQUESTED_FOR_FIXED_TICK: 'REQUESTED_FOR_FIXED_TICK',
    GPU_RESOLVE_PENDING: 'GPU_RESOLVE_PENDING'
});

const DEFAULT_HOSTILE_PROJECTILE_DEFINITION_BY_ID = Object.freeze({
    [HOSTILE_BASIC_BULLET_DATA.id]: HOSTILE_BASIC_BULLET_DATA
});

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

function requirePositiveSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
        throw new RangeError(`${label}은 양의 안전한 정수여야 합니다.`);
    }
    return number;
}

function requireExactIdentityComponent(value, label) {
    const number = requirePositiveSafeInteger(value, label);
    if (number >= INVALID_HANDLE_COMPONENT) {
        throw new RangeError(`${label}은 reserved sentinel보다 작아야 합니다.`);
    }
    return number;
}

function requireNonNegativeSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
        throw new RangeError(`${label}은 0 이상의 안전한 정수여야 합니다.`);
    }
    return number;
}

function requirePositiveFloat32(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number)
        || !Number.isFinite(Math.fround(number))
        || Math.fround(number) <= 0) {
        throw new RangeError(`${label}은 양의 유한 float32 범위 숫자여야 합니다.`);
    }
    return number;
}

function requireFiniteFloat32(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || !Number.isFinite(Math.fround(number))) {
        throw new RangeError(`${label}은 유한한 float32 범위 숫자여야 합니다.`);
    }
    return number;
}

function freezeHandle(source, label) {
    if (!source || typeof source !== 'object') {
        throw new TypeError(`${label}은 exact handle 객체여야 합니다.`);
    }
    return Object.freeze({
        entityId: requireExactIdentityComponent(source.entityId, `${label}.entityId`),
        incarnation: requireExactIdentityComponent(
            source.incarnation,
            `${label}.incarnation`
        )
    });
}

function sameHandle(left, right) {
    return left?.entityId === right?.entityId
        && left?.incarnation === right?.incarnation;
}

function handleKey(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

function freezeVector(source, label) {
    if (!source || typeof source !== 'object') {
        throw new TypeError(`${label} 벡터가 필요합니다.`);
    }
    return Object.freeze({
        x: requireFiniteFloat32(source.x, `${label}.x`),
        y: requireFiniteFloat32(source.y, `${label}.y`)
    });
}

function requireCatalog(source, label) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new TypeError(`${label} catalog 객체가 필요합니다.`);
    }
    return source;
}

function checkedTickSum(left, right, label) {
    const result = left + right;
    if (!Number.isSafeInteger(result) || result <= 0) {
        throw new RangeError(`${label}이 안전한 fixed tick 범위를 벗어났습니다.`);
    }
    return result;
}

function normalizeAttackDefinition(source, label) {
    if (!source || typeof source !== 'object') {
        throw new TypeError(`${label} attack definition이 필요합니다.`);
    }
    const allegiancePolicy = requireNonEmptyString(
        source.allegiancePolicy,
        `${label}.allegiancePolicy`
    );
    const targetPolicyId = requireNonEmptyString(
        source.targetPolicyId,
        `${label}.targetPolicyId`
    );
    if (allegiancePolicy !== GAMEPLAY_ALLEGIANCE_POLICY.INHERIT_SUBJECT) {
        throw new RangeError(`${label}은 inherit-subject allegiance를 사용해야 합니다.`);
    }
    if (targetPolicyId
        !== PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN) {
        throw new RangeError(`${label}은 Player-damageable target policy를 사용해야 합니다.`);
    }
    if (source.targetPolicy !== CURRENT_TOWER_TARGET_POLICY
        || source.targetSnapshotPolicy !== CAST_START_TARGET_SNAPSHOT_POLICY) {
        throw new RangeError(`${label}의 Tower target snapshot policy가 올바르지 않습니다.`);
    }
    return Object.freeze({
        id: requireNonEmptyString(source.id, `${label}.id`),
        sourceEnemyDefinitionId: requireNonEmptyString(
            source.sourceEnemyDefinitionId,
            `${label}.sourceEnemyDefinitionId`
        ),
        projectileDefinitionId: requireNonEmptyString(
            source.projectileDefinitionId,
            `${label}.projectileDefinitionId`
        ),
        launchSpeed: requirePositiveFloat32(
            source.launchSpeed,
            `${label}.launchSpeed`
        ),
        positionOffset: freezeVector(source.positionOffset, `${label}.positionOffset`),
        targetOffset: freezeVector(source.targetOffset, `${label}.targetOffset`),
        initialDelayTicks: requirePositiveSafeInteger(
            source.initialDelayTicks,
            `${label}.initialDelayTicks`
        ),
        intervalTicks: requirePositiveSafeInteger(
            source.intervalTicks,
            `${label}.intervalTicks`
        ),
        phaseSpreadTicks: requireNonNegativeSafeInteger(
            source.phaseSpreadTicks,
            `${label}.phaseSpreadTicks`
        ),
        maximumStartsPerFixedTick: requirePositiveSafeInteger(
            source.maximumStartsPerFixedTick,
            `${label}.maximumStartsPerFixedTick`
        ),
        targetPolicy: source.targetPolicy,
        targetSnapshotPolicy: source.targetSnapshotPolicy,
        allegiancePolicy,
        targetPolicyId,
        producerId: requireNonEmptyString(source.producerId, `${label}.producerId`),
        sourceAbilityId: requireNonEmptyString(
            source.sourceAbilityId,
            `${label}.sourceAbilityId`
        )
    });
}

function compileAttackDefinitions(
    enemyDefinitions,
    attackDefinitions,
    projectileDefinitions
) {
    const byEnemyDefinitionId = new Map();
    let maximumStartsPerFixedTick = Number.POSITIVE_INFINITY;
    for (const catalogId of Object.keys(attackDefinitions)) {
        const attack = normalizeAttackDefinition(
            attackDefinitions[catalogId],
            `attackDefinitions.${catalogId}`
        );
        if (catalogId !== attack.id) {
            throw new RangeError(`attack catalog key와 definition ID가 다릅니다: ${catalogId}`);
        }
        const enemyDefinition = enemyDefinitions[attack.sourceEnemyDefinitionId];
        if (!enemyDefinition
            || enemyDefinition.id !== attack.sourceEnemyDefinitionId
            || enemyDefinition.attackDefinitionId !== attack.id) {
            throw new RangeError(
                `attack source enemy catalog 연결이 올바르지 않습니다: ${attack.id}`
            );
        }
        const projectileDefinition = projectileDefinitions[
            attack.projectileDefinitionId
        ];
        if (!projectileDefinition
            || projectileDefinition.id !== attack.projectileDefinitionId
            || projectileDefinition.targetPolicyId !== attack.targetPolicyId
            || projectileDefinition.producerId !== attack.producerId) {
            throw new RangeError(
                `attack projectile catalog 연결이 올바르지 않습니다: ${attack.id}`
            );
        }
        if (byEnemyDefinitionId.has(attack.sourceEnemyDefinitionId)) {
            throw new RangeError(
                `enemy definition에 attack이 중복 연결되었습니다: ${attack.sourceEnemyDefinitionId}`
            );
        }
        byEnemyDefinitionId.set(attack.sourceEnemyDefinitionId, Object.freeze({
            attack,
            projectileDefinition
        }));
        maximumStartsPerFixedTick = Math.min(
            maximumStartsPerFixedTick,
            attack.maximumStartsPerFixedTick
        );
    }
    if (byEnemyDefinitionId.size === 0) {
        throw new RangeError('HostileAttackDirector에는 하나 이상의 attack definition이 필요합니다.');
    }
    return Object.freeze({
        byEnemyDefinitionId,
        maximumStartsPerFixedTick
    });
}

/** Exact source identity에서 replay-stable한 attack phase를 계산합니다. */
export function computeHostileAttackPhaseOffset(options = {}) {
    const entityId = requireExactIdentityComponent(options.entityId, 'entityId');
    const incarnation = requireExactIdentityComponent(
        options.incarnation,
        'incarnation'
    );
    const spread = requireNonNegativeSafeInteger(
        options.phaseSpreadTicks,
        'phaseSpreadTicks'
    );
    if (spread === 0) {
        return 0;
    }
    let hash = Math.imul(entityId >>> 0, 0x9e3779b1)
        ^ Math.imul(incarnation >>> 0, 0x85ebca6b);
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x7feb352d);
    hash ^= hash >>> 15;
    return (hash >>> 0) % spread;
}

/** Archer targeted shot의 모든 exact cast identity를 포함하는 command ID입니다. */
export function createHostileAttackCommandId(options = {}) {
    const sourceHandle = freezeHandle(options.sourceHandle, 'sourceHandle');
    const targetHandle = freezeHandle(options.targetHandle, 'targetHandle');
    return [
        HOSTILE_ATTACK_COMMAND_NAMESPACE,
        requirePositiveSafeInteger(options.sessionGeneration, 'sessionGeneration'),
        sourceHandle.entityId,
        sourceHandle.incarnation,
        targetHandle.entityId,
        targetHandle.incarnation,
        requirePositiveSafeInteger(options.targetFixedTick, 'targetFixedTick'),
        requireNonNegativeSafeInteger(options.shotSequence, 'shotSequence'),
        encodeURIComponent(requireNonEmptyString(
            options.attackDefinitionId,
            'attackDefinitionId'
        ))
    ].join(':');
}

function resolveEndpointDependency(options, methodName, explicitName) {
    if (options[explicitName] !== undefined && options[explicitName] !== null) {
        return options[explicitName];
    }
    return typeof options.endpoint?.[methodName] === 'function'
        ? options.endpoint[methodName]()
        : null;
}

function createEmptyStageResult(targetFixedTick, overrides = {}) {
    return Object.freeze({
        targetFixedTick,
        eligibleCount: 0,
        attemptedCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        deferredCount: 0,
        commandIds: EMPTY_COMMAND_IDS,
        recoveryRequired: false,
        protocolFailure: null,
        ...overrides
    });
}

/**
 * Lifecycle 결과만으로 attack-capable exact enemy roster와 targeted shot 상태를 소유합니다.
 * Endpoint commit/fixed/presentation/draw/destroy는 호출하지 않습니다.
 */
export class HostileAttackDirector {
    constructor(options = {}) {
        const endpoint = options.endpoint ?? null;
        this.registry = resolveEndpointDependency(options, 'getRegistry', 'registry');
        const backend = resolveEndpointDependency(options, 'getBackend', 'backend');
        if (!this.registry
            || typeof this.registry.has !== 'function'
            || typeof this.registry.copyEntityView !== 'function') {
            throw new TypeError('HostileAttackDirector에는 exact WorldRegistry가 필요합니다.');
        }
        if (!backend || typeof backend.hasBody !== 'function') {
            throw new TypeError('HostileAttackDirector에는 backend.hasBody()가 필요합니다.');
        }
        this.backendHasBody = (handle) => backend.hasBody(handle);

        const endpointStatus = typeof endpoint?.getStatus === 'function'
            ? endpoint.getStatus()
            : null;
        this.sessionGeneration = requirePositiveSafeInteger(
            options.sessionGeneration ?? endpointStatus?.sessionGeneration,
            'sessionGeneration'
        );
        this.enemyDefinitions = requireCatalog(
            options.enemyDefinitions ?? INGAME_ENEMY_DEFINITION_BY_ID,
            'enemyDefinitions'
        );
        const attackDefinitions = requireCatalog(
            options.attackDefinitions ?? HOSTILE_ATTACK_DEFINITION_BY_ID,
            'attackDefinitions'
        );
        const projectileDefinitions = requireCatalog(
            options.projectileDefinitions
                ?? DEFAULT_HOSTILE_PROJECTILE_DEFINITION_BY_ID,
            'projectileDefinitions'
        );
        const compiled = compileAttackDefinitions(
            this.enemyDefinitions,
            attackDefinitions,
            projectileDefinitions
        );
        this.attackByEnemyDefinitionId = compiled.byEnemyDefinitionId;
        this.maximumStartsPerFixedTick = compiled.maximumStartsPerFixedTick;

        this.projectileSpawnAdapter = options.projectileSpawnAdapter
            ?? new GpuProjectileSpawnAdapter(endpoint, {
                commandNamespace: HOSTILE_ATTACK_COMMAND_NAMESPACE
            });
        if (typeof this.projectileSpawnAdapter?.requestProjectile !== 'function') {
            throw new TypeError(
                'HostileAttackDirector에는 projectileSpawnAdapter.requestProjectile()이 필요합니다.'
            );
        }
        this.historyCapacity = requirePositiveSafeInteger(
            options.historyCapacity ?? DEFAULT_COMPLETION_HISTORY_CAPACITY,
            'historyCapacity'
        );

        this.recordsByHandle = new Map();
        this.pendingByCommandId = new Map();
        this.terminalCommands = new Map();
        this.terminalCommandIds = [];
        this.terminalCommandHead = 0;
        this.lastBudgetFixedTick = 0;
        this.startAttemptsInBudgetTick = 0;
        this.protocolFailure = null;
        this.recoveryRequired = false;
        this.lastStageResult = createEmptyStageResult(0);
        this.telemetry = this.#createTelemetry();
        this.destroyed = false;
    }

    /** Completed GPU death를 shot staging보다 먼저 exact roster에 반영합니다. */
    observeCompletedEvents(snapshot = {}) {
        this.#assertUsable();
        let observedDeathCount = 0;
        let removedArcherCount = 0;
        if (snapshot?.protocolFailure) {
            this.#fail(
                'completed-events',
                'upstream-protocol-failure',
                'GPU completed event snapshot에 protocol failure가 있습니다.'
            );
        }
        const deathEvents = Array.isArray(snapshot?.deathEvents)
            ? snapshot.deathEvents
            : Array.isArray(snapshot?.events)
                ? snapshot.events.filter((event) => event?.type === 'death')
                : [];
        if (!this.recoveryRequired) {
            for (const event of deathEvents) {
                if (event?.type !== undefined && event.type !== 'death') {
                    continue;
                }
                if (event?.disposition === 'stale'
                    || event?.disposition === 'duplicate') {
                    continue;
                }
                const eventSessionGeneration = event?.sessionGeneration;
                if (eventSessionGeneration !== undefined
                    && eventSessionGeneration !== this.sessionGeneration) {
                    this.telemetry.staleOldSessionResults++;
                    continue;
                }
                observedDeathCount++;
                try {
                    const handle = freezeHandle(event, 'deathEvent');
                    if (this.#removeRecord(handle, 'death')) {
                        removedArcherCount++;
                    }
                } catch (error) {
                    this.#fail(
                        'completed-events',
                        'death-event-contract',
                        String(error?.message ?? error)
                    );
                    break;
                }
            }
        }
        return Object.freeze({
            observedDeathCount,
            removedArcherCount,
            recoveryRequired: this.recoveryRequired,
            protocolFailure: this.protocolFailure
        });
    }

    /** Deterministic eligible order 앞에서 data-authored budget만큼 targeted shot을 요청합니다. */
    stageForFixedTick(options = {}) {
        this.#assertUsable();
        const targetFixedTick = requirePositiveSafeInteger(
            options.targetFixedTick,
            'targetFixedTick'
        );
        if (targetFixedTick !== this.lastBudgetFixedTick) {
            if (targetFixedTick < this.lastBudgetFixedTick) {
                this.#fail(
                    'shot-stage',
                    'fixed-tick-regression',
                    `hostile attack fixed tick이 역행했습니다: ${targetFixedTick}`
                );
            }
            this.lastBudgetFixedTick = targetFixedTick;
            this.startAttemptsInBudgetTick = 0;
        }
        if (this.recoveryRequired) {
            return this.#saveStageResult(createEmptyStageResult(targetFixedTick, {
                recoveryRequired: true,
                protocolFailure: this.protocolFailure
            }));
        }

        const removedStaleCount = this.#pruneStaleSources();
        if (this.recoveryRequired) {
            return this.#saveStageResult(createEmptyStageResult(targetFixedTick, {
                removedStaleCount,
                recoveryRequired: true,
                protocolFailure: this.protocolFailure
            }));
        }

        let targetHandle = null;
        const suppliedTargetHandle = options.targetHandle;
        if (suppliedTargetHandle !== undefined && suppliedTargetHandle !== null) {
            try {
                targetHandle = freezeHandle(suppliedTargetHandle, 'targetHandle');
            } catch (error) {
                this.#fail(
                    'shot-stage',
                    'target-handle-contract',
                    String(error?.message ?? error)
                );
            }
        }
        if (this.recoveryRequired) {
            return this.#saveStageResult(createEmptyStageResult(targetFixedTick, {
                removedStaleCount,
                recoveryRequired: true,
                protocolFailure: this.protocolFailure
            }));
        }
        if (!targetHandle) {
            this.telemetry.noTargetTicks++;
            return this.#saveStageResult(createEmptyStageResult(targetFixedTick, {
                removedStaleCount
            }));
        }
        const targetDisposition = this.#getExactActiveDisposition(targetHandle);
        if (targetDisposition === 'desync') {
            this.#fail(
                'shot-stage',
                'target-registry-backend-desync',
                `target exact liveness가 불일치합니다: ${handleKey(targetHandle)}`
            );
            return this.#saveStageResult(createEmptyStageResult(targetFixedTick, {
                removedStaleCount,
                recoveryRequired: true,
                protocolFailure: this.protocolFailure
            }));
        }
        if (targetDisposition === 'stale') {
            this.telemetry.noTargetTicks++;
            return this.#saveStageResult(createEmptyStageResult(targetFixedTick, {
                removedStaleCount
            }));
        }

        const eligible = Array.from(this.recordsByHandle.values()).filter((record) => (
            record.pendingCommandId === null
            && record.lastAttemptedFixedTick !== targetFixedTick
            && record.nextEligibleFixedTick <= targetFixedTick
        ));
        eligible.sort((left, right) => (
            left.nextEligibleFixedTick - right.nextEligibleFixedTick
            || left.createdAtTick - right.createdAtTick
            || left.handle.entityId - right.handle.entityId
            || left.handle.incarnation - right.handle.incarnation
        ));

        const availableBudget = Math.max(
            0,
            this.maximumStartsPerFixedTick - this.startAttemptsInBudgetTick
        );
        const selected = eligible.slice(0, availableBudget);
        const deferredCount = eligible.length - selected.length;
        this.telemetry.budgetDeferred += deferredCount;
        let attemptedCount = 0;
        let acceptedCount = 0;
        let rejectedCount = 0;
        const commandIds = [];
        for (const record of selected) {
            const commandId = createHostileAttackCommandId({
                sessionGeneration: this.sessionGeneration,
                sourceHandle: record.handle,
                targetHandle,
                targetFixedTick,
                shotSequence: record.shotSequence,
                attackDefinitionId: record.attack.id
            });
            record.lastAttemptedFixedTick = targetFixedTick;
            this.startAttemptsInBudgetTick++;
            this.telemetry.requestAttempts++;
            attemptedCount++;
            commandIds.push(commandId);
            let receipt;
            try {
                receipt = this.projectileSpawnAdapter.requestProjectile({
                    mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
                    definition: record.projectileDefinition,
                    sourceHandle: record.handle,
                    targetHandle,
                    ownerHandle: record.handle,
                    positionOffset: record.attack.positionOffset,
                    targetOffset: record.attack.targetOffset,
                    launchSpeed: record.attack.launchSpeed,
                    allegiancePolicy: record.attack.allegiancePolicy,
                    targetPolicyId: record.attack.targetPolicyId,
                    targetFixedTick,
                    spawnSequence: record.shotSequence,
                    producerId: record.attack.producerId,
                    sourceAbilityId: record.attack.sourceAbilityId,
                    commandId
                });
            } catch (error) {
                this.#fail(
                    'shot-request',
                    'request-exception',
                    String(error?.message ?? error)
                );
                rejectedCount++;
                break;
            }
            if (receipt?.accepted !== true) {
                this.telemetry.requestRejected++;
                rejectedCount++;
                if (receipt?.reason === 'registry-backend-desync'
                    || receipt?.reason === 'source-metadata-missing') {
                    this.#fail(
                        'shot-request',
                        receipt.reason,
                        `hostile shot request exact source 계약이 깨졌습니다: ${commandId}`
                    );
                    break;
                }
                continue;
            }
            if (receipt.commandId !== commandId
                || Number(receipt.targetFixedTick) !== targetFixedTick) {
                this.#fail(
                    'shot-request',
                    'receipt-contract',
                    `hostile shot receipt identity가 요청과 다릅니다: ${commandId}`
                );
                break;
            }
            const pending = {
                commandId,
                state: HOSTILE_ATTACK_SHOT_STATE.REQUESTED_FOR_FIXED_TICK,
                sourceHandle: record.handle,
                targetHandle,
                targetFixedTick,
                shotSequence: record.shotSequence,
                attackDefinitionId: record.attack.id,
                destinationHandle: null
            };
            record.pendingCommandId = commandId;
            this.pendingByCommandId.set(commandId, pending);
            this.telemetry.requestAccepted++;
            acceptedCount++;
        }
        return this.#saveStageResult(Object.freeze({
            targetFixedTick,
            eligibleCount: eligible.length,
            attemptedCount,
            acceptedCount,
            rejectedCount,
            deferredCount,
            commandIds: commandIds.length > 0
                ? Object.freeze(commandIds)
                : EMPTY_COMMAND_IDS,
            removedStaleCount,
            recoveryRequired: this.recoveryRequired,
            protocolFailure: this.protocolFailure
        }));
    }

    /** Fixed owner 결과와 lifecycle spawn/despawn 결과를 exact identity로 확정합니다. */
    observeFixedCommit(lifecycleResult = {}, fixedTick) {
        this.#assertUsable();
        const tick = requirePositiveSafeInteger(fixedTick, 'fixedTick');
        const summary = {
            fixedTick: tick,
            completedCount: 0,
            fixedAcceptedCount: 0,
            fixedRejectedCount: 0,
            spawnedArcherCount: 0,
            removedArcherCount: 0,
            staleResultCount: 0
        };
        if (this.recoveryRequired) {
            return this.#freezeObservationSummary(summary);
        }
        if (lifecycleResult?.fixedTick !== undefined
            && Number(lifecycleResult.fixedTick) !== tick) {
            this.#fail(
                'fixed-commit',
                'fixed-tick-contract',
                `lifecycle fixed tick이 관찰 tick과 다릅니다: ${lifecycleResult.fixedTick}/${tick}`
            );
            return this.#freezeObservationSummary(summary);
        }
        const fixedCommands = lifecycleResult?.fixedCommands ?? null;
        if (fixedCommands?.protocolFailure) {
            this.#fail(
                'fixed-commit',
                'upstream-fixed-protocol-failure',
                String(fixedCommands.protocolFailure.message
                    ?? fixedCommands.protocolFailure.code
                    ?? 'fixed command protocol failure')
            );
            return this.#freezeObservationSummary(summary);
        }

        const observedCurrentCommands = new Set();
        for (const completion of fixedCommands?.completed ?? []) {
            const disposition = this.#classifyResultCommand(completion?.commandId);
            if (disposition === 'unrelated') {
                continue;
            }
            if (disposition === 'stale-session') {
                this.telemetry.staleOldSessionResults++;
                summary.staleResultCount++;
                continue;
            }
            if (observedCurrentCommands.has(completion.commandId)) {
                this.#fail(
                    'fixed-completion',
                    'duplicate-result-entry',
                    `한 fixed result에 command가 중복되었습니다: ${completion.commandId}`
                );
                break;
            }
            observedCurrentCommands.add(completion.commandId);
            if (this.#observeCompletion(completion)) {
                summary.completedCount++;
            }
            if (this.recoveryRequired) {
                break;
            }
        }
        if (this.recoveryRequired) {
            return this.#freezeObservationSummary(summary);
        }

        for (const accepted of fixedCommands?.sourceRelativeSpawns ?? []) {
            const disposition = this.#classifyResultCommand(accepted?.commandId);
            if (disposition === 'unrelated') {
                continue;
            }
            if (disposition === 'stale-session') {
                this.telemetry.staleOldSessionResults++;
                summary.staleResultCount++;
                continue;
            }
            if (observedCurrentCommands.has(accepted.commandId)) {
                this.#fail(
                    'fixed-commit',
                    'duplicate-result-entry',
                    `한 fixed result에 command가 중복되었습니다: ${accepted.commandId}`
                );
                break;
            }
            observedCurrentCommands.add(accepted.commandId);
            if (this.#observeFixedAcceptance(accepted, tick)) {
                summary.fixedAcceptedCount++;
            }
            if (this.recoveryRequired) {
                break;
            }
        }
        if (this.recoveryRequired) {
            return this.#freezeObservationSummary(summary);
        }

        for (const rejected of fixedCommands?.rejected ?? []) {
            const disposition = this.#classifyResultCommand(rejected?.commandId);
            if (disposition === 'unrelated') {
                continue;
            }
            if (disposition === 'stale-session') {
                this.telemetry.staleOldSessionResults++;
                summary.staleResultCount++;
                continue;
            }
            if (observedCurrentCommands.has(rejected.commandId)) {
                this.#fail(
                    'fixed-commit',
                    'duplicate-result-entry',
                    `한 fixed result에 command가 중복되었습니다: ${rejected.commandId}`
                );
                break;
            }
            observedCurrentCommands.add(rejected.commandId);
            if (this.#observeFixedRejection(rejected, tick)) {
                summary.fixedRejectedCount++;
            }
            if (this.recoveryRequired) {
                break;
            }
        }
        if (this.recoveryRequired) {
            return this.#freezeObservationSummary(summary);
        }

        if (fixedCommands
            && fixedCommands.state !== 'stalled'
            && fixedCommands.recoveryRequired !== true) {
            for (const pending of this.pendingByCommandId.values()) {
                if (pending.state === HOSTILE_ATTACK_SHOT_STATE.REQUESTED_FOR_FIXED_TICK
                    && pending.targetFixedTick === tick
                    && !observedCurrentCommands.has(pending.commandId)) {
                    this.#fail(
                        'fixed-commit',
                        'missing-fixed-result',
                        `accepted inbox shot의 fixed 결과가 없습니다: ${pending.commandId}`
                    );
                    break;
                }
            }
        }
        if (this.recoveryRequired) {
            return this.#freezeObservationSummary(summary);
        }

        for (const despawned of lifecycleResult?.despawned ?? []) {
            try {
                const handle = freezeHandle(despawned?.handle, 'despawned.handle');
                if (this.#removeRecord(handle, 'despawn')) {
                    summary.removedArcherCount++;
                }
            } catch (error) {
                this.#fail(
                    'lifecycle-despawn',
                    'despawn-contract',
                    String(error?.message ?? error)
                );
                break;
            }
        }
        if (this.recoveryRequired) {
            return this.#freezeObservationSummary(summary);
        }

        for (const spawned of lifecycleResult?.spawned ?? []) {
            if (this.#observeSpawn(spawned, tick)) {
                summary.spawnedArcherCount++;
            }
            if (this.recoveryRequired) {
                break;
            }
        }
        return this.#freezeObservationSummary(summary);
    }

    getStatus() {
        const records = Array.from(this.recordsByHandle.values());
        records.sort((left, right) => (
            left.createdAtTick - right.createdAtTick
            || left.handle.entityId - right.handle.entityId
            || left.handle.incarnation - right.handle.incarnation
        ));
        const archers = Object.freeze(records.map((record) => Object.freeze({
            handle: record.handle,
            definitionId: record.definitionId,
            attackDefinitionId: record.attack.id,
            createdAtTick: record.createdAtTick,
            phaseOffsetTicks: record.phaseOffsetTicks,
            nextEligibleFixedTick: record.nextEligibleFixedTick,
            shotSequence: record.shotSequence,
            state: record.pendingCommandId
                ? this.pendingByCommandId.get(record.pendingCommandId)?.state
                    ?? HOSTILE_ATTACK_SHOT_STATE.IDLE
                : HOSTILE_ATTACK_SHOT_STATE.IDLE,
            pendingCommandId: record.pendingCommandId
        })));
        const pendingShots = Object.freeze(
            Array.from(this.pendingByCommandId.values(), (pending) => Object.freeze({
                commandId: pending.commandId,
                state: pending.state,
                sourceHandle: pending.sourceHandle,
                targetHandle: pending.targetHandle,
                targetFixedTick: pending.targetFixedTick,
                shotSequence: pending.shotSequence,
                attackDefinitionId: pending.attackDefinitionId,
                destinationHandle: pending.destinationHandle
            }))
        );
        return Object.freeze({
            sessionGeneration: this.sessionGeneration,
            maximumStartsPerFixedTick: this.maximumStartsPerFixedTick,
            activeSourceCount: records.length,
            activeArcherCount: records.length,
            pendingShotCount: pendingShots.length,
            terminalHistoryCount: this.terminalCommands.size,
            terminalHistoryCapacity: this.historyCapacity,
            shotStartAttemptCount: this.telemetry.requestAttempts,
            shotRequestAcceptedCount: this.telemetry.requestAccepted,
            shotResolvedCount: this.telemetry.completedResolved,
            recoveryRequired: this.recoveryRequired,
            protocolFailure: this.protocolFailure,
            lastStageResult: this.lastStageResult,
            archers,
            pendingShots,
            telemetry: Object.freeze({ ...this.telemetry }),
            destroyed: this.destroyed
        });
    }

    /** Fixed owner와 같은 fail-closed query seam이며 roster/status 복사를 만들지 않습니다. */
    requiresRecovery() {
        return this.recoveryRequired;
    }

    /** 같은 binding의 transient roster/pending을 비우며 abandoned completion은 bounded stale로 기억합니다. */
    reset() {
        this.#assertUsable();
        for (const pending of this.pendingByCommandId.values()) {
            this.#rememberTerminalCommand(pending.commandId, 'abandoned-reset');
        }
        this.recordsByHandle.clear();
        this.pendingByCommandId.clear();
        this.lastBudgetFixedTick = 0;
        this.startAttemptsInBudgetTick = 0;
        this.protocolFailure = null;
        this.recoveryRequired = false;
        this.lastStageResult = createEmptyStageResult(0);
        this.telemetry.resets++;
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        this.recordsByHandle.clear();
        this.pendingByCommandId.clear();
        this.terminalCommands.clear();
        this.terminalCommandIds.length = 0;
        this.terminalCommandHead = 0;
        this.destroyed = true;
    }

    #observeSpawn(spawned, fixedTick) {
        let handle;
        try {
            handle = freezeHandle(spawned?.handle, 'spawned.handle');
        } catch (error) {
            this.#fail(
                'lifecycle-spawn',
                'spawn-contract',
                String(error?.message ?? error)
            );
            return false;
        }
        const disposition = this.#getExactActiveDisposition(handle);
        if (disposition !== 'active') {
            this.#fail(
                'lifecycle-spawn',
                disposition === 'desync'
                    ? 'spawn-registry-backend-desync'
                    : 'spawn-not-active',
                `spawned exact handle이 active가 아닙니다: ${handleKey(handle)}`
            );
            return false;
        }
        const view = this.registry.copyEntityView(handle, {});
        if (!view
            || view.entityId !== handle.entityId
            || view.incarnation !== handle.incarnation) {
            this.#fail(
                'lifecycle-spawn',
                'spawn-view-contract',
                `spawned exact registry view가 없습니다: ${handleKey(handle)}`
            );
            return false;
        }
        if (view.kindId !== 'enemy') {
            this.telemetry.nonAttackSpawnsIgnored++;
            return false;
        }
        const attackEntry = this.attackByEnemyDefinitionId.get(view.definitionId);
        const enemyDefinition = this.enemyDefinitions[view.definitionId];
        if (!attackEntry
            || !enemyDefinition
            || enemyDefinition.id !== view.definitionId
            || enemyDefinition.attackDefinitionId !== attackEntry.attack.id) {
            this.telemetry.nonAttackSpawnsIgnored++;
            return false;
        }

        const key = handleKey(handle);
        const existing = this.recordsByHandle.get(key);
        if (existing) {
            if (existing.definitionId !== view.definitionId
                || existing.createdAtTick !== view.createdAtTick) {
                this.#fail(
                    'lifecycle-spawn',
                    'duplicate-spawn-contradiction',
                    `duplicate spawn observation이 기존 record와 다릅니다: ${key}`
                );
                return false;
            }
            this.telemetry.duplicateSpawnObservations++;
            return false;
        }

        for (const record of this.recordsByHandle.values()) {
            if (record.handle.entityId !== handle.entityId
                || record.handle.incarnation === handle.incarnation) {
                continue;
            }
            const oldDisposition = this.#getExactActiveDisposition(record.handle);
            if (oldDisposition === 'active' || oldDisposition === 'desync') {
                this.#fail(
                    'lifecycle-spawn',
                    'entity-id-reuse-overlap',
                    `같은 entityId의 Archer incarnation이 겹칩니다: ${handle.entityId}`
                );
                return false;
            }
            this.#removeRecord(record.handle, 'stale');
        }

        let createdAtTick;
        try {
            createdAtTick = requireNonNegativeSafeInteger(
                view.createdAtTick,
                'spawned.createdAtTick'
            );
        } catch (error) {
            this.#fail(
                'lifecycle-spawn',
                'created-tick-contract',
                String(error?.message ?? error)
            );
            return false;
        }
        if (createdAtTick > fixedTick) {
            this.#fail(
                'lifecycle-spawn',
                'created-tick-future',
                `Archer createdAtTick이 관찰 boundary보다 미래입니다: ${createdAtTick}/${fixedTick}`
            );
            return false;
        }
        const phaseOffsetTicks = computeHostileAttackPhaseOffset({
            ...handle,
            phaseSpreadTicks: attackEntry.attack.phaseSpreadTicks
        });
        let nextEligibleFixedTick;
        try {
            nextEligibleFixedTick = checkedTickSum(
                checkedTickSum(
                    createdAtTick,
                    attackEntry.attack.initialDelayTicks,
                    'first eligible fixed tick'
                ),
                phaseOffsetTicks,
                'first eligible phase fixed tick'
            );
        } catch (error) {
            this.#fail(
                'lifecycle-spawn',
                'eligible-tick-overflow',
                String(error?.message ?? error)
            );
            return false;
        }
        this.recordsByHandle.set(key, {
            handle,
            definitionId: view.definitionId,
            createdAtTick,
            attack: attackEntry.attack,
            projectileDefinition: attackEntry.projectileDefinition,
            phaseOffsetTicks,
            nextEligibleFixedTick,
            shotSequence: 0,
            pendingCommandId: null,
            lastAttemptedFixedTick: 0
        });
        this.telemetry.registered++;
        return true;
    }

    #observeFixedAcceptance(entry, fixedTick) {
        const pending = this.pendingByCommandId.get(entry.commandId);
        if (!pending) {
            return this.#handleUnknownCurrentResult(
                entry.commandId,
                'fixed-accepted',
                null
            );
        }
        if (pending.targetFixedTick !== fixedTick) {
            this.#fail(
                'fixed-commit',
                'accepted-tick-mismatch',
                `shot fixed acceptance tick이 request와 다릅니다: ${entry.commandId}`
            );
            return false;
        }
        let destinationHandle;
        try {
            destinationHandle = freezeHandle(entry.handle, 'sourceRelativeSpawn.handle');
        } catch (error) {
            this.#fail(
                'fixed-commit',
                'destination-handle-contract',
                String(error?.message ?? error)
            );
            return false;
        }
        if (entry.state !== 'gpu-resolve-pending') {
            this.#fail(
                'fixed-commit',
                'accepted-state-contract',
                `지원하지 않는 fixed spawn state입니다: ${entry.state}`
            );
            return false;
        }
        if (pending.state === HOSTILE_ATTACK_SHOT_STATE.GPU_RESOLVE_PENDING) {
            if (!sameHandle(pending.destinationHandle, destinationHandle)) {
                this.#fail(
                    'fixed-commit',
                    'duplicate-acceptance-contradiction',
                    `duplicate fixed acceptance destination이 다릅니다: ${entry.commandId}`
                );
                return false;
            }
            this.telemetry.duplicateResults++;
            return false;
        }
        if (pending.state !== HOSTILE_ATTACK_SHOT_STATE.REQUESTED_FOR_FIXED_TICK) {
            this.#fail(
                'fixed-commit',
                'accepted-state-transition',
                `shot fixed acceptance의 이전 상태가 올바르지 않습니다: ${entry.commandId}`
            );
            return false;
        }
        pending.state = HOSTILE_ATTACK_SHOT_STATE.GPU_RESOLVE_PENDING;
        pending.destinationHandle = destinationHandle;
        this.telemetry.fixedAccepted++;
        return true;
    }

    #observeFixedRejection(entry, fixedTick) {
        const pending = this.pendingByCommandId.get(entry.commandId);
        if (!pending) {
            return this.#handleUnknownCurrentResult(
                entry.commandId,
                'fixed-rejected',
                entry.code ?? null
            );
        }
        if (entry.domain !== 'spawn') {
            this.#fail(
                'fixed-commit',
                'rejected-domain-contract',
                `hostile shot rejection domain이 spawn이 아닙니다: ${entry.commandId}`
            );
            return false;
        }
        const rejectionCode = String(entry.code ?? 'unknown');
        if (rejectionCode === 'registry-backend-desync'
            || rejectionCode.endsWith('-desync')) {
            this.#fail(
                'fixed-commit',
                rejectionCode,
                `hostile shot fixed rejection에서 exact desync가 발생했습니다: ${entry.commandId}`
            );
            return false;
        }
        if (pending.targetFixedTick !== fixedTick
            || pending.state !== HOSTILE_ATTACK_SHOT_STATE.REQUESTED_FOR_FIXED_TICK) {
            this.#fail(
                'fixed-commit',
                'rejected-state-transition',
                `shot fixed rejection의 tick/state가 올바르지 않습니다: ${entry.commandId}`
            );
            return false;
        }
        this.#clearPending(pending, `fixed-rejected:${rejectionCode}`);
        this.telemetry.fixedRejected++;
        return true;
    }

    #observeCompletion(entry) {
        const pending = this.pendingByCommandId.get(entry.commandId);
        if (!pending) {
            return this.#handleUnknownCurrentResult(
                entry.commandId,
                'completion',
                entry.outcome ?? null
            );
        }
        if (pending.state !== HOSTILE_ATTACK_SHOT_STATE.GPU_RESOLVE_PENDING) {
            this.#fail(
                'fixed-completion',
                'completion-before-fixed-acceptance',
                `GPU completion이 fixed acceptance보다 먼저 왔습니다: ${entry.commandId}`
            );
            return false;
        }
        let destinationHandle;
        try {
            destinationHandle = freezeHandle(entry.handle, 'completed.handle');
        } catch (error) {
            this.#fail(
                'fixed-completion',
                'completion-handle-contract',
                String(error?.message ?? error)
            );
            return false;
        }
        if (!sameHandle(destinationHandle, pending.destinationHandle)) {
            this.#fail(
                'fixed-completion',
                'completion-destination-mismatch',
                `GPU completion destination이 pending과 다릅니다: ${entry.commandId}`
            );
            return false;
        }
        if (entry.outcome !== 'resolved'
            && entry.outcome !== 'source-invalid'
            && entry.outcome !== 'target-invalid') {
            this.#fail(
                'fixed-completion',
                'completion-outcome-contract',
                `지원하지 않는 hostile shot outcome입니다: ${entry.outcome}`
            );
            return false;
        }

        const record = this.recordsByHandle.get(handleKey(pending.sourceHandle));
        if (entry.outcome === 'resolved' && record) {
            const sourceDisposition = this.#getExactActiveDisposition(record.handle);
            if (sourceDisposition === 'desync') {
                this.#fail(
                    'fixed-completion',
                    'source-registry-backend-desync',
                    `resolved shot source liveness가 불일치합니다: ${entry.commandId}`
                );
                return false;
            }
            if (sourceDisposition === 'stale') {
                this.#removeRecord(record.handle, 'stale');
            } else {
                if (record.pendingCommandId !== pending.commandId
                    || record.shotSequence !== pending.shotSequence) {
                    this.#fail(
                        'fixed-completion',
                        'source-shot-state-contract',
                        `resolved shot source state가 pending과 다릅니다: ${entry.commandId}`
                    );
                    return false;
                }
                let nextEligibleFixedTick;
                try {
                    nextEligibleFixedTick = checkedTickSum(
                        pending.targetFixedTick,
                        record.attack.intervalTicks,
                        'next eligible fixed tick'
                    );
                } catch (error) {
                    this.#fail(
                        'fixed-completion',
                        'cooldown-tick-overflow',
                        String(error?.message ?? error)
                    );
                    return false;
                }
                record.shotSequence++;
                record.nextEligibleFixedTick = nextEligibleFixedTick;
            }
        }

        this.#clearPending(pending, `completion:${entry.outcome}`);
        if (entry.outcome === 'resolved') {
            this.telemetry.completedResolved++;
        } else if (entry.outcome === 'source-invalid') {
            this.telemetry.completedSourceInvalid++;
            this.#removeRecord(pending.sourceHandle, 'source-invalid');
        } else {
            this.telemetry.completedTargetInvalid++;
        }
        return true;
    }

    #handleUnknownCurrentResult(commandId, kind, detail) {
        const terminal = this.terminalCommands.get(commandId);
        if (terminal) {
            if (terminal === 'abandoned-reset') {
                this.telemetry.staleOldSessionResults++;
                return false;
            }
            if (kind === 'completion'
                && terminal === `completion:${detail}`) {
                this.telemetry.duplicateResults++;
                return false;
            }
            if (kind === 'fixed-rejected'
                && terminal === `fixed-rejected:${detail ?? 'unknown'}`) {
                this.telemetry.duplicateResults++;
                return false;
            }
            this.#fail(
                'fixed-result',
                'terminal-result-contradiction',
                `terminal command에 모순된 결과가 왔습니다: ${commandId}`
            );
            return false;
        }
        this.#fail(
            'fixed-result',
            'unknown-current-session-command',
            `현재 session의 알 수 없는 hostile command 결과입니다: ${commandId}`
        );
        return false;
    }

    #clearPending(pending, terminal) {
        this.pendingByCommandId.delete(pending.commandId);
        const record = this.recordsByHandle.get(handleKey(pending.sourceHandle));
        if (record?.pendingCommandId === pending.commandId) {
            record.pendingCommandId = null;
        }
        this.#rememberTerminalCommand(pending.commandId, terminal);
    }

    #removeRecord(handle, reason) {
        const key = handleKey(handle);
        const record = this.recordsByHandle.get(key);
        if (!record) {
            return false;
        }
        this.recordsByHandle.delete(key);
        if (reason === 'death') {
            this.telemetry.removedByDeath++;
        } else if (reason === 'despawn') {
            this.telemetry.removedByDespawn++;
        } else if (reason === 'source-invalid') {
            this.telemetry.removedBySourceInvalid++;
        } else {
            this.telemetry.removedAsStale++;
        }
        return true;
    }

    #pruneStaleSources() {
        let removed = 0;
        for (const record of Array.from(this.recordsByHandle.values())) {
            const disposition = this.#getExactActiveDisposition(record.handle);
            if (disposition === 'desync') {
                this.#fail(
                    'source-liveness',
                    'source-registry-backend-desync',
                    `Archer exact liveness가 불일치합니다: ${handleKey(record.handle)}`
                );
                break;
            }
            if (disposition === 'stale' && this.#removeRecord(record.handle, 'stale')) {
                removed++;
            }
        }
        return removed;
    }

    #getExactActiveDisposition(handle) {
        const registryHas = this.registry.has(handle);
        const backendHas = this.backendHasBody(handle);
        if (registryHas !== backendHas) {
            return 'desync';
        }
        return registryHas ? 'active' : 'stale';
    }

    #classifyResultCommand(commandId) {
        if (typeof commandId !== 'string'
            || !commandId.startsWith(`${HOSTILE_ATTACK_COMMAND_NAMESPACE}:`)) {
            return 'unrelated';
        }
        const sessionText = commandId.slice(
            HOSTILE_ATTACK_COMMAND_NAMESPACE.length + 1
        ).split(':', 1)[0];
        if (!/^[1-9][0-9]*$/.test(sessionText)) {
            this.#fail(
                'fixed-result',
                'command-session-contract',
                `hostile command session identity가 유효하지 않습니다: ${commandId}`
            );
            return 'current';
        }
        const sessionGeneration = Number(sessionText);
        if (!Number.isSafeInteger(sessionGeneration)
            || sessionGeneration <= 0) {
            this.#fail(
                'fixed-result',
                'command-session-contract',
                `hostile command session identity가 범위를 벗어났습니다: ${commandId}`
            );
            return 'current';
        }
        if (sessionGeneration < this.sessionGeneration) {
            return 'stale-session';
        }
        if (sessionGeneration > this.sessionGeneration) {
            this.#fail(
                'fixed-result',
                'future-session-command',
                `현재보다 미래 session의 hostile command 결과입니다: ${commandId}`
            );
        }
        return 'current';
    }

    #rememberTerminalCommand(commandId, terminal) {
        const known = this.terminalCommands.get(commandId);
        if (known) {
            if (known !== terminal) {
                this.#fail(
                    'command-history',
                    'terminal-history-contradiction',
                    `hostile command terminal 결과가 달라졌습니다: ${commandId}`
                );
            }
            return;
        }
        this.terminalCommands.set(commandId, terminal);
        this.terminalCommandIds.push(commandId);
        while ((this.terminalCommandIds.length - this.terminalCommandHead)
            > this.historyCapacity) {
            const forgotten = this.terminalCommandIds[this.terminalCommandHead++];
            this.terminalCommands.delete(forgotten);
        }
        if (this.terminalCommandHead >= this.historyCapacity) {
            this.terminalCommandIds = this.terminalCommandIds.slice(
                this.terminalCommandHead
            );
            this.terminalCommandHead = 0;
        }
    }

    #freezeObservationSummary(summary) {
        return Object.freeze({
            ...summary,
            recoveryRequired: this.recoveryRequired,
            protocolFailure: this.protocolFailure
        });
    }

    #saveStageResult(result) {
        this.lastStageResult = result;
        return result;
    }

    #fail(stage, code, message) {
        if (this.protocolFailure) {
            return;
        }
        this.protocolFailure = Object.freeze({ stage, code, message });
        this.recoveryRequired = true;
        this.telemetry.protocolFailures++;
    }

    #createTelemetry() {
        return {
            registered: 0,
            nonAttackSpawnsIgnored: 0,
            duplicateSpawnObservations: 0,
            removedByDeath: 0,
            removedByDespawn: 0,
            removedBySourceInvalid: 0,
            removedAsStale: 0,
            requestAttempts: 0,
            requestAccepted: 0,
            requestRejected: 0,
            fixedAccepted: 0,
            fixedRejected: 0,
            completedResolved: 0,
            completedSourceInvalid: 0,
            completedTargetInvalid: 0,
            budgetDeferred: 0,
            noTargetTicks: 0,
            staleOldSessionResults: 0,
            duplicateResults: 0,
            protocolFailures: 0,
            resets: 0
        };
    }

    #assertUsable() {
        if (this.destroyed) {
            throw new Error('destroy된 HostileAttackDirector는 사용할 수 없습니다.');
        }
    }
}
