import {
    ENEMY_LIFECYCLE_DISPOSITION_ID,
    isEnemyBountyEligibleForDisposition
} from '../../contract/enemy_lifecycle_disposition_contract.js';
import { assertCoreIntegrity } from '../../contract/core_integrity_contract.js';
import {
    GPU_CORE_PROXY_WORLD_KIND_ID
} from '../core/gpu_core_proxy_spawn_adapter.js';

const DEFAULT_HISTORY_CAPACITY = 65536;
const DEFAULT_FACT_CAPACITY = 2048;
const ENEMY_WORLD_KIND_ID = 'enemy';
const CORE_IMPACT_DESPAWN_REASON = 'core-impact';

export const CORE_IMPACT_FACT_TYPE = Object.freeze({
    IMPACT: 'CoreImpact',
    DAMAGED: 'CoreDamaged',
    DEPLETED: 'CoreDepleted'
});

function requirePositiveSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0 || number >= 0xffffffff) {
        throw new RangeError(`${label}은 reserved sentinel보다 작은 양의 정수여야 합니다.`);
    }
    return number;
}

function requirePositiveCapacity(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
        throw new RangeError(`${label}은 양의 안전한 정수여야 합니다.`);
    }
    return number;
}

function freezeHandle(source, label) {
    return Object.freeze({
        entityId: requirePositiveSafeInteger(source?.entityId, `${label}.entityId`),
        incarnation: requirePositiveSafeInteger(
            source?.incarnation,
            `${label}.incarnation`
        )
    });
}

function sameHandle(left, right) {
    return left?.entityId === right?.entityId
        && left?.incarnation === right?.incarnation;
}

function optionalId(value) {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function nonNegativeFinite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function readProtocol(endpoint) {
    const status = endpoint?.getStatus?.() ?? null;
    const endpointSessionGeneration = Number(status?.sessionGeneration);
    let source = null;
    try {
        source = endpoint?.getBackend?.()?.getEventProtocolState?.() ?? null;
    } catch {
        source = null;
    }
    source ??= status?.backend?.gpu ?? status?.backend ?? null;
    const sessionGeneration = Number(source?.sessionGeneration ?? endpointSessionGeneration);
    const deviceGeneration = Number(source?.deviceGeneration);
    const authoritativeEpoch = Number(source?.authoritativeEpoch);
    if (!Number.isSafeInteger(endpointSessionGeneration)
        || endpointSessionGeneration <= 0
        || sessionGeneration !== endpointSessionGeneration
        || !Number.isSafeInteger(deviceGeneration)
        || deviceGeneration < 0
        || !Number.isSafeInteger(authoritativeEpoch)
        || authoritativeEpoch < 0) {
        return null;
    }
    return Object.freeze({
        sessionGeneration,
        deviceGeneration,
        authoritativeEpoch
    });
}

function assertEndpoint(endpoint) {
    const required = [
        'requestDespawn',
        'getStatus'
    ];
    for (const methodName of required) {
        if (typeof endpoint?.[methodName] !== 'function') {
            throw new TypeError(`EnemyCoreImpactDirector endpoint.${methodName}()가 필요합니다.`);
        }
    }
    return endpoint;
}

function requiresPrivilegedCleanupPort(endpoint) {
    return endpoint?.requiresPrivilegedCoreImpactCleanupPort?.() === true;
}

function assertCoreImpactCleanupPort(port, endpoint) {
    if (port === null || port === undefined) {
        if (requiresPrivilegedCleanupPort(endpoint)) {
            throw new TypeError(
                'production endpoint에는 전용 Core-impact cleanup port가 필요합니다.'
            );
        }
        return null;
    }
    if (typeof port?.requestCommittedCoreImpactCleanup !== 'function') {
        throw new TypeError(
            'coreImpactCleanupPort.requestCommittedCoreImpactCleanup()이 필요합니다.'
        );
    }
    return port;
}

function assertRegistry(registry) {
    if (typeof registry?.copyEntityView !== 'function') {
        throw new TypeError('EnemyCoreImpactDirector registry.copyEntityView()가 필요합니다.');
    }
    return registry;
}

function readExactView(registry, handle) {
    let view = null;
    try {
        view = registry.copyEntityView(handle, {});
    } catch {
        return null;
    }
    return view
        && sameHandle(view, handle)
        && typeof view.kindId === 'string'
        ? view
        : null;
}

function eventIdentity(event) {
    if (typeof event?.key === 'string' && event.key.length > 0) {
        return event.key;
    }
    return [
        event?.sessionGeneration,
        event?.deviceGeneration,
        event?.authoritativeEpoch,
        event?.entityId,
        event?.incarnation,
        event?.sourceTick,
        event?.sequence,
        event?.eventType
    ].join(':');
}

function freezeProtocolFact(event) {
    return Object.freeze({
        sessionGeneration: Number(event.sessionGeneration),
        deviceGeneration: Number(event.deviceGeneration),
        authoritativeEpoch: Number(event.authoritativeEpoch),
        sourceTick: Number(event.sourceTick),
        sequence: Number(event.sequence),
        eventKey: eventIdentity(event)
    });
}

function readEventProtocol(event) {
    const sessionGeneration = event?.sessionGeneration;
    const deviceGeneration = event?.deviceGeneration;
    const authoritativeEpoch = event?.authoritativeEpoch;
    if (!Number.isSafeInteger(sessionGeneration)
        || sessionGeneration <= 0
        || !Number.isSafeInteger(deviceGeneration)
        || deviceGeneration < 0
        || !Number.isSafeInteger(authoritativeEpoch)
        || authoritativeEpoch < 0) {
        return null;
    }
    return Object.freeze({
        sessionGeneration,
        deviceGeneration,
        authoritativeEpoch
    });
}

/**
 * endpoint가 이미 contiguous/applied로 확정한 event만 새 epoch binding으로 전진시킵니다.
 * 같은 session의 current device를 벗어나거나 이전 binding보다 뒤인 callback은 절대
 * 재수락하지 않습니다. endpoint drain 중 idle release가 epoch만 선행한 경우에는
 * event epoch가 current보다 작을 수 있으므로 current 이하의 monotonic epoch를 허용합니다.
 */
function isAdmissibleCommittedProtocol(eventProtocol, previousBinding, currentBinding) {
    if (!eventProtocol || !currentBinding
        || eventProtocol.sessionGeneration !== currentBinding.sessionGeneration
        || eventProtocol.deviceGeneration !== currentBinding.deviceGeneration
        || eventProtocol.authoritativeEpoch > currentBinding.authoritativeEpoch) {
        return false;
    }
    if (!previousBinding) {
        return true;
    }
    if (eventProtocol.sessionGeneration !== previousBinding.sessionGeneration
        || eventProtocol.deviceGeneration < previousBinding.deviceGeneration) {
        return false;
    }
    if (eventProtocol.deviceGeneration === previousBinding.deviceGeneration
        && eventProtocol.authoritativeEpoch < previousBinding.authoritativeEpoch) {
        return false;
    }
    return true;
}

function createSemanticImpactKey(binding, coreHandle, enemyHandle) {
    // Core impact는 Enemy incarnation당 one-shot이다. readback append sequence나
    // body orientation은 semantic identity가 아니므로 deliberately 제외한다.
    return [
        binding.sessionGeneration,
        binding.deviceGeneration,
        binding.authoritativeEpoch,
        coreHandle.entityId,
        coreHandle.incarnation,
        enemyHandle.entityId,
        enemyHandle.incarnation,
        'interaction-enter'
    ].join(':');
}

function createCleanupCommandId(impactKey) {
    return `core-impact:${impactKey}`;
}

function isNormalCleanupDedup(receipt) {
    return receipt?.accepted !== true
        && (receipt?.reason === 'duplicate-despawn'
            || receipt?.reason === 'duplicate-command');
}

/**
 * committed Core-proxy enter fact를 CPU CoreIntegrity와 exact enemy cleanup으로 변환합니다.
 * GPU endpoint lifecycle/fixed/draw ownership은 절대로 가져가지 않습니다.
 */
export class EnemyCoreImpactDirector {
    constructor(options = {}) {
        this.coreIntegrity = assertCoreIntegrity(options.coreIntegrity);
        this.endpoint = assertEndpoint(options.endpoint);
        this.coreImpactCleanupPort = assertCoreImpactCleanupPort(
            options.coreImpactCleanupPort,
            this.endpoint
        );
        this.historyCapacity = requirePositiveCapacity(
            options.eventHistoryCapacity ?? DEFAULT_HISTORY_CAPACITY,
            'eventHistoryCapacity'
        );
        this.factCapacity = requirePositiveCapacity(
            options.factCapacity ?? DEFAULT_FACT_CAPACITY,
            'factCapacity'
        );
        this.binding = readProtocol(this.endpoint);
        this.knownImpactKeys = new Set();
        this.impactKeyHistory = [];
        this.impactKeyHead = 0;
        this.pendingCleanupByImpactKey = new Map();
        this.lastCommittedFacts = Object.freeze([]);
        this.recentFacts = [];
        this.ignoredCount = 0;
        this.dedupedCount = 0;
        this.cleanupDedupedCount = 0;
        this.cleanupCommittedCount = 0;
        this.cleanupFailure = null;
        this.coreDepletedFact = null;
        this.destroyed = false;
    }

    /** 새 GPU world로 교체될 때 stale protocol/pending cleanup을 버리고 exact binding을 재확정합니다. */
    resetGpuBinding(
        endpoint = this.endpoint,
        coreImpactCleanupPort = endpoint === this.endpoint
            ? this.coreImpactCleanupPort
            : null
    ) {
        this.#assertUsable();
        const nextEndpoint = assertEndpoint(endpoint);
        const nextCleanupPort = assertCoreImpactCleanupPort(
            coreImpactCleanupPort,
            nextEndpoint
        );
        this.endpoint = nextEndpoint;
        this.coreImpactCleanupPort = nextCleanupPort;
        this.binding = readProtocol(this.endpoint);
        this.pendingCleanupByImpactKey.clear();
        this.cleanupFailure = null;
        return this.binding !== null;
    }

    /**
     * endpoint가 contiguous하게 확정한 event snapshot만 소비합니다.
     * 동일 snapshot의 모든 valid arrival cleanup을 먼저 예약한 뒤 Core damage를 확정합니다.
     */
    observeCompletedEvents(snapshot, registry) {
        this.#assertUsable();
        this.lastCommittedFacts = Object.freeze([]);
        if (snapshot?.protocolFailure || !Array.isArray(snapshot?.events)) {
            return this.#createObservationResult([]);
        }
        const exactRegistry = assertRegistry(registry);
        const currentBinding = readProtocol(this.endpoint);
        if (!currentBinding || this.coreIntegrity.isDepleted()) {
            this.ignoredCount += Array.isArray(snapshot.events)
                ? snapshot.events.length
                : 0;
            return this.#createObservationResult([]);
        }

        const candidates = [];
        for (const event of snapshot.events) {
            const candidate = this.#normalizeImpactCandidate(
                event,
                exactRegistry,
                currentBinding
            );
            if (!candidate) {
                continue;
            }
            if (this.knownImpactKeys.has(candidate.impactKey)) {
                this.dedupedCount++;
                continue;
            }
            this.#rememberImpactKey(candidate.impactKey);
            this.pendingCleanupByImpactKey.set(candidate.impactKey, Object.freeze({
                impactKey: candidate.impactKey,
                commandId: createCleanupCommandId(candidate.impactKey),
                coreHandle: candidate.coreHandle,
                enemyHandle: candidate.enemyHandle,
                state: 'PENDING'
            }));
            candidates.push(candidate);
        }

        const facts = [];
        for (const candidate of candidates) {
            const before = this.coreIntegrity.getCurrentIntegrity();
            const appliedDamage = this.coreIntegrity.applyIntegrityDamage(
                candidate.coreImpactDamage
            );
            const after = this.coreIntegrity.getCurrentIntegrity();
            const impactFact = Object.freeze({
                type: CORE_IMPACT_FACT_TYPE.IMPACT,
                disposition: ENEMY_LIFECYCLE_DISPOSITION_ID.CORE_IMPACT,
                bountyEligible: isEnemyBountyEligibleForDisposition(
                    ENEMY_LIFECYCLE_DISPOSITION_ID.CORE_IMPACT
                ),
                bountyBudget: candidate.bountyBudget,
                coreHandle: candidate.coreHandle,
                enemyHandle: candidate.enemyHandle,
                coreImpactDamage: candidate.coreImpactDamage,
                appliedDamage,
                coreIntegrityBefore: before,
                coreIntegrityAfter: after,
                enemyDefinitionId: candidate.enemyDefinitionId,
                physicsProfileId: candidate.physicsProfileId,
                combatProfileId: candidate.combatProfileId,
                behaviorProfileId: candidate.behaviorProfileId,
                impactKey: candidate.impactKey,
                ...freezeProtocolFact(candidate.event)
            });
            facts.push(impactFact);
            if (appliedDamage > 0) {
                facts.push(Object.freeze({
                    type: CORE_IMPACT_FACT_TYPE.DAMAGED,
                    coreHandle: candidate.coreHandle,
                    enemyHandle: candidate.enemyHandle,
                    damage: appliedDamage,
                    currentIntegrity: after,
                    maxIntegrity: this.coreIntegrity.getMaxIntegrity(),
                    impactKey: candidate.impactKey,
                    ...freezeProtocolFact(candidate.event)
                }));
            }
            if (after <= 0 && this.coreDepletedFact === null) {
                this.coreDepletedFact = Object.freeze({
                    type: CORE_IMPACT_FACT_TYPE.DEPLETED,
                    coreHandle: candidate.coreHandle,
                    enemyHandle: candidate.enemyHandle,
                    currentIntegrity: 0,
                    maxIntegrity: this.coreIntegrity.getMaxIntegrity(),
                    impactKey: candidate.impactKey,
                    ...freezeProtocolFact(candidate.event)
                });
                facts.push(this.coreDepletedFact);
            }
        }
        this.lastCommittedFacts = this.#freezeBoundedFacts(facts);
        for (const fact of this.lastCommittedFacts) {
            this.#rememberFact(fact);
        }
        return this.#createObservationResult(this.lastCommittedFacts);
    }

    /** pending exact despawn만 current fixed boundary에 request합니다. */
    stageForFixedTick(context = {}) {
        this.#assertUsable();
        const targetFixedTick = requirePositiveSafeInteger(
            context.targetFixedTick,
            'targetFixedTick'
        );
        const endpoint = context.endpoint ?? this.endpoint;
        assertEndpoint(endpoint);
        let requested = 0;
        let cleanupDeduped = 0;
        for (const [impactKey, cleanup] of this.pendingCleanupByImpactKey) {
            if (cleanup.state !== 'PENDING') {
                continue;
            }
            const receipt = this.#requestCoreImpactCleanup(
                endpoint,
                cleanup,
                targetFixedTick
            );
            if (receipt?.accepted === true) {
                this.pendingCleanupByImpactKey.set(impactKey, Object.freeze({
                    ...cleanup,
                    state: 'STAGED',
                    targetFixedTick
                }));
                requested++;
                continue;
            }
            if (isNormalCleanupDedup(receipt)) {
                // gpu-death가 먼저 exact despawn을 보유한 정상 경합은 이 director가
                // 더 추적할 일이 없습니다. semantic impact key만 bounded history에
                // 남기고 settled cleanup record는 즉시 버려 누적 leak을 막습니다.
                this.pendingCleanupByImpactKey.delete(impactKey);
                this.cleanupDedupedCount++;
                cleanupDeduped++;
                continue;
            }
            this.pendingCleanupByImpactKey.delete(impactKey);
            this.cleanupFailure = Object.freeze({
                impactKey,
                targetFixedTick,
                reason: receipt?.reason ?? 'despawn-rejected'
            });
        }
        return Object.freeze({
            requested,
            cleanupDeduped,
            pendingCleanupCount: this.#getPendingCleanupCount(),
            recoveryRequired: this.requiresRecovery()
        });
    }

    /** lifecycle commit 뒤 exact core-impact cleanup outcome만 mirror합니다. */
    observeFixedCommit(result, fixedTick) {
        this.#assertUsable();
        const tick = requirePositiveSafeInteger(fixedTick, 'fixedTick');
        const despawnedByCommandId = new Set(
            (result?.despawned ?? []).map(({ commandId }) => commandId)
        );
        const rejectedByCommandId = new Map(
            (result?.rejected ?? []).map(({ commandId, code }) => [commandId, code])
        );
        for (const [impactKey, cleanup] of this.pendingCleanupByImpactKey) {
            if (cleanup.state !== 'STAGED') {
                continue;
            }
            if (despawnedByCommandId.has(cleanup.commandId)) {
                this.pendingCleanupByImpactKey.delete(impactKey);
                this.cleanupCommittedCount++;
                continue;
            }
            if (rejectedByCommandId.has(cleanup.commandId)) {
                this.pendingCleanupByImpactKey.delete(impactKey);
                this.cleanupFailure = Object.freeze({
                    impactKey,
                    targetFixedTick: tick,
                    reason: rejectedByCommandId.get(cleanup.commandId)
                });
                continue;
            }
            if (tick >= cleanup.targetFixedTick) {
                // lifecycle owner가 due command를 neither commit nor reject한 것은
                // 안전하게 재시도할 수 있는 상태가 아닙니다. record를 남겨 leak하지
                // 않고 caller에게 recovery/terminal fail-closed를 알립니다.
                this.pendingCleanupByImpactKey.delete(impactKey);
                this.cleanupFailure = Object.freeze({
                    impactKey,
                    targetFixedTick: tick,
                    reason: 'missing-despawn-commit'
                });
            }
        }
        return Object.freeze({
            pendingCleanupCount: this.#getPendingCleanupCount(),
            recoveryRequired: this.requiresRecovery()
        });
    }

    getLastCommittedFacts() {
        return this.lastCommittedFacts;
    }

    requiresRecovery() {
        return !this.destroyed && this.cleanupFailure !== null;
    }

    getStatus() {
        return Object.freeze({
            binding: this.binding,
            coreDepleted: this.coreIntegrity.isDepleted(),
            coreDepletedFact: this.coreDepletedFact,
            lastCommittedFacts: this.lastCommittedFacts,
            recentFacts: Object.freeze([...this.recentFacts]),
            factCapacity: this.factCapacity,
            pendingCleanupCount: this.#getPendingCleanupCount(),
            trackedCleanupCount: this.pendingCleanupByImpactKey.size,
            cleanupCommittedCount: this.cleanupCommittedCount,
            cleanupDedupedCount: this.cleanupDedupedCount,
            cleanupFailure: this.cleanupFailure,
            ignoredCount: this.ignoredCount,
            dedupedCount: this.dedupedCount,
            recoveryRequired: this.requiresRecovery(),
            destroyed: this.destroyed
        });
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.pendingCleanupByImpactKey.clear();
        this.knownImpactKeys.clear();
        this.impactKeyHistory.length = 0;
        this.recentFacts.length = 0;
        this.lastCommittedFacts = Object.freeze([]);
        this.binding = null;
        this.coreImpactCleanupPort = null;
        this.endpoint = null;
    }

    #requestCoreImpactCleanup(endpoint, cleanup, targetFixedTick) {
        if (this.coreImpactCleanupPort !== null && endpoint === this.endpoint) {
            return this.coreImpactCleanupPort.requestCommittedCoreImpactCleanup(
                cleanup.enemyHandle,
                targetFixedTick,
                cleanup.commandId
            );
        }
        if (requiresPrivilegedCleanupPort(endpoint)) {
            return Object.freeze({
                accepted: false,
                reason: 'core-impact-cleanup-port-missing'
            });
        }
        // Minimal fake/legacy endpoint compatibility only. Production endpoint는
        // 전용 opaque capability port 없이는 이 경로에 들어올 수 없습니다.
        return endpoint.requestDespawn(
            cleanup.enemyHandle,
            CORE_IMPACT_DESPAWN_REASON,
            targetFixedTick,
            cleanup.commandId,
            Object.freeze({
                disposition: ENEMY_LIFECYCLE_DISPOSITION_ID.CORE_IMPACT
            })
        );
    }

    #normalizeImpactCandidate(event, registry, currentBinding) {
        if (event?.type !== 'contact'
            || event?.eventType !== 'interaction-enter'
            || event?.disposition !== 'applied') {
            this.ignoredCount++;
            return null;
        }
        const eventProtocol = readEventProtocol(event);
        if (!isAdmissibleCommittedProtocol(
            eventProtocol,
            this.binding,
            currentBinding
        )) {
            this.ignoredCount++;
            return null;
        }
        let subjectHandle;
        let otherHandle;
        try {
            subjectHandle = freezeHandle(event, 'event');
            otherHandle = freezeHandle(event.other, 'event.other');
        } catch {
            this.ignoredCount++;
            return null;
        }
        const subject = readExactView(registry, subjectHandle);
        const other = readExactView(registry, otherHandle);
        if (!subject || !other) {
            this.ignoredCount++;
            return null;
        }
        const coreIsSubject = subject.kindId === GPU_CORE_PROXY_WORLD_KIND_ID
            && other.kindId === ENEMY_WORLD_KIND_ID;
        const coreIsOther = other.kindId === GPU_CORE_PROXY_WORLD_KIND_ID
            && subject.kindId === ENEMY_WORLD_KIND_ID;
        if (!coreIsSubject && !coreIsOther) {
            this.ignoredCount++;
            return null;
        }
        const coreHandle = coreIsSubject ? subjectHandle : otherHandle;
        const enemyHandle = coreIsSubject ? otherHandle : subjectHandle;
        const enemy = coreIsSubject ? other : subject;
        const metadata = enemy.metadata;
        const coreImpactDamage = nonNegativeFinite(metadata?.coreImpactDamage, -1);
        const bountyBudget = nonNegativeFinite(metadata?.bountyBudget, -1);
        if (coreImpactDamage < 0 || bountyBudget < 0) {
            this.ignoredCount++;
            return null;
        }
        // 모든 entity/metadata 검증 뒤에만 binding을 전진시킵니다. 이 순서로
        // malformed payload가 valid Core impact의 future epoch를 선점하지 않습니다.
        this.binding = eventProtocol;
        const impactKey = createSemanticImpactKey(
            eventProtocol,
            coreHandle,
            enemyHandle
        );
        return Object.freeze({
            event,
            coreHandle,
            enemyHandle,
            coreImpactDamage,
            bountyBudget,
            enemyDefinitionId: optionalId(enemy.metadata?.definitionId)
                ?? optionalId(enemy.definitionId),
            physicsProfileId: optionalId(metadata?.physicsProfileId),
            combatProfileId: optionalId(metadata?.combatProfileId),
            behaviorProfileId: optionalId(metadata?.behaviorProfileId),
            impactKey
        });
    }

    #createObservationResult(facts) {
        return Object.freeze({
            facts,
            coreDepletedFact: this.coreDepletedFact,
            pendingCleanupCount: this.#getPendingCleanupCount(),
            recoveryRequired: this.requiresRecovery()
        });
    }

    /** 한 committed snapshot도 director의 public fact capacity를 넘지 않게 보관합니다. */
    #freezeBoundedFacts(facts) {
        if (facts.length === 0) {
            return Object.freeze([]);
        }
        if (facts.length <= this.factCapacity) {
            return Object.freeze(facts);
        }
        const bounded = facts.slice(0, this.factCapacity);
        const depletedIndex = facts.indexOf(this.coreDepletedFact);
        // terminal boundary fact는 fact window가 잘려도 status/outcome consumer가
        // 즉시 관찰할 수 있게 마지막 slot을 보존합니다.
        if (depletedIndex >= this.factCapacity && this.coreDepletedFact !== null) {
            bounded[bounded.length - 1] = this.coreDepletedFact;
        }
        return Object.freeze(bounded);
    }

    #getPendingCleanupCount() {
        let count = 0;
        for (const cleanup of this.pendingCleanupByImpactKey.values()) {
            if (cleanup.state === 'PENDING' || cleanup.state === 'STAGED') {
                count++;
            }
        }
        return count;
    }

    #rememberImpactKey(key) {
        this.knownImpactKeys.add(key);
        this.impactKeyHistory.push(key);
        while ((this.impactKeyHistory.length - this.impactKeyHead)
            > this.historyCapacity) {
            this.knownImpactKeys.delete(this.impactKeyHistory[this.impactKeyHead++]);
        }
        if (this.impactKeyHead >= this.historyCapacity) {
            this.impactKeyHistory = this.impactKeyHistory.slice(this.impactKeyHead);
            this.impactKeyHead = 0;
        }
    }

    #rememberFact(fact) {
        this.recentFacts.push(fact);
        while (this.recentFacts.length > this.factCapacity) {
            this.recentFacts.shift();
        }
    }

    #assertUsable() {
        if (this.destroyed) {
            throw new Error('destroy된 EnemyCoreImpactDirector는 사용할 수 없습니다.');
        }
    }
}
