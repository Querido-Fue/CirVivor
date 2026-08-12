import {
    ENEMY_LIFECYCLE_DISPOSITION_ID,
    isEnemyBountyEligibleForDisposition
} from '../../contract/enemy_lifecycle_disposition_contract.js';
import { assertCoreIntegrity } from '../../contract/core_integrity_contract.js';
import {
    ENEMY_CAPABILITY_ID,
    hasEnemyCapability
} from '../../contract/enemy_capability_contract.js';
import {
    GPU_CORE_PROXY_DEFINITION_ID,
    GPU_CORE_PROXY_WORLD_KIND_ID
} from '../core/gpu_core_proxy_spawn_adapter.js';
import {
    GAMEPLAY_ALLEGIANCE_POLICY,
    GAMEPLAY_DAMAGE_POLICY_ID,
    GAMEPLAY_TEAM_ID
} from '../../contract/gameplay_team_contract.js';
import {
    GPU_CIRCLE_BODY_FIXED_POINT,
    encodeGpuCircleBodyFixedPoint
} from '../../physics/gpu/gpu_circle_body_abi.js';
import {
    BASIC_RHOM_ATTACK_DATA
} from 'data/object/enemy/basic_rhom_attack_data.js';
import {
    HOSTILE_RHOM_PROJECTILE_DATA
} from 'data/object/projectile/hostile_rhom_projectile_data.js';

const DEFAULT_HISTORY_CAPACITY = 65536;
const DEFAULT_FACT_CAPACITY = 2048;
const ENEMY_WORLD_KIND_ID = 'enemy';
const PROJECTILE_WORLD_KIND_ID = 'projectile';
const CORE_IMPACT_DESPAWN_REASON = 'core-impact';
const CORE_IMPACT_CLEANUP_COMMIT_PROVENANCE = Object.freeze({
    DIRECT: 'direct-core-impact',
    AUTHENTIC_EXISTING: 'authentic-existing-despawn'
});
export const CORE_DAMAGE_REQUEST_EVENT_TYPE = 'core-damage-request';

const CORE_DAMAGE_REQUEST_KNOWN_NON_APPLIED_DISPOSITION = Object.freeze({
    DUPLICATE: 'duplicate',
    REPLAY: 'replay',
    STALE: 'stale'
});

const CANONICAL_RHOM_CORE_DAMAGE_REQUEST = Object.freeze({
    projectileDefinitionId: HOSTILE_RHOM_PROJECTILE_DATA.id,
    producerId: BASIC_RHOM_ATTACK_DATA.producerId,
    sourceAbilityId: BASIC_RHOM_ATTACK_DATA.sourceAbilityId,
    allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.INHERIT_SUBJECT,
    damagePolicyId: GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX,
    targetPolicyId: BASIC_RHOM_ATTACK_DATA.targetPolicyId,
    towerTargetPolicyId: BASIC_RHOM_ATTACK_DATA.towerTargetPolicyId,
    coreTargetPolicyId: BASIC_RHOM_ATTACK_DATA.coreTargetPolicyId,
    targetSelectionPolicyId: BASIC_RHOM_ATTACK_DATA.targetSelectionPolicy,
    distancePolicyId: BASIC_RHOM_ATTACK_DATA.distancePolicy,
    attackRangeTiles: BASIC_RHOM_ATTACK_DATA.attackRangeTiles,
    coreDamage: HOSTILE_RHOM_PROJECTILE_DATA.coreDamage,
    coreDamageFixedPoint: encodeGpuCircleBodyFixedPoint(
        HOSTILE_RHOM_PROJECTILE_DATA.coreDamage
    ),
    coreDamageRequestPolicyId:
        HOSTILE_RHOM_PROJECTILE_DATA.coreDamageRequestPolicyId
});

export const CORE_IMPACT_FACT_TYPE = Object.freeze({
    IMPACT: 'CoreImpact',
    DAMAGE_REQUEST: 'CoreDamageRequest',
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

function requireNonNegativeSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
        throw new RangeError(`${label}은 0 이상의 안전한 정수여야 합니다.`);
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

function handleIdentityKey(handle) {
    return `${handle?.entityId}:${handle?.incarnation}`;
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
    // body orientation/contact event type은 semantic identity가 아니므로
    // deliberately 제외한다. 아래 legacy token은 enter/continuous가 공유한다.
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

function createSemanticCoreDamageRequestKey(
    binding,
    coreHandle,
    projectileHandle
) {
    return [
        binding.sessionGeneration,
        binding.deviceGeneration,
        binding.authoritativeEpoch,
        coreHandle.entityId,
        coreHandle.incarnation,
        projectileHandle.entityId,
        projectileHandle.incarnation,
        'core-projectile-impact'
    ].join(':');
}

function compareEventKey(leftEvent, rightEvent) {
    const leftKey = eventIdentity(leftEvent);
    const rightKey = eventIdentity(rightEvent);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function compareDamageCandidates(left, right) {
    return left.event.sourceTick - right.event.sourceTick
        || left.damageSubjectHandle.entityId - right.damageSubjectHandle.entityId
        || left.damageSubjectHandle.incarnation
            - right.damageSubjectHandle.incarnation
        || left.event.sequence - right.event.sequence
        || compareEventKey(left.event, right.event);
}

function compareSemanticDuplicateProvenance(left, right) {
    return left.event.sourceTick - right.event.sourceTick
        || left.event.sequence - right.event.sequence
        || compareEventKey(left.event, right.event);
}

function compareProtocol(left, right) {
    return left.deviceGeneration - right.deviceGeneration
        || left.authoritativeEpoch - right.authoritativeEpoch;
}

function createCleanupCommandId(impactKey) {
    return `core-impact:${impactKey}`;
}

function isExactAuthenticatedCleanupDedup(
    receipt,
    cleanup,
    targetFixedTick
) {
    return receipt?.accepted !== true
        && receipt?.reason === 'duplicate-despawn'
        && receipt?.authenticTerminalCleanup === true
        && receipt?.disposition
            === ENEMY_LIFECYCLE_DISPOSITION_ID.CORE_IMPACT
        && receipt?.targetFixedTick === targetFixedTick
        && typeof receipt?.commandId === 'string'
        && receipt.commandId.length > 0
        && sameHandle(receipt.handle, cleanup.enemyHandle);
}

function hasAllowedCommittedCleanupReason(entry, cleanup) {
    if (cleanup.commitProvenance
        === CORE_IMPACT_CLEANUP_COMMIT_PROVENANCE.DIRECT) {
        return entry?.reason === CORE_IMPACT_DESPAWN_REASON;
    }
    if (cleanup.commitProvenance
        !== CORE_IMPACT_CLEANUP_COMMIT_PROVENANCE.AUTHENTIC_EXISTING) {
        return false;
    }
    if (cleanup.commandId.startsWith('gpu-death:')) {
        // Turn 1 GPU-death command의 lifecycle provenance는 승격 뒤에도 보존됩니다.
        return entry?.reason === 'gpu-death';
    }
    // Opaque cleanup port가 same-handle/current-tick authentic terminal command임을
    // 이미 증명했습니다. 그 command의 기존 authored reason은 commit에서 보존됩니다.
    return typeof entry?.reason === 'string' && entry.reason.length > 0;
}

function isExactCommittedCoreImpactCleanup(entry, cleanup, fixedTick) {
    return entry?.commandId === cleanup.commandId
        && cleanup.targetFixedTick === fixedTick
        && sameHandle(entry?.handle, cleanup.enemyHandle)
        && hasAllowedCommittedCleanupReason(entry, cleanup)
        && entry?.disposition === ENEMY_LIFECYCLE_DISPOSITION_ID.CORE_IMPACT
        && entry?.bountyEligible === false;
}

/**
 * committed Core-proxy contact fact를 CPU CoreIntegrity와 exact enemy cleanup으로 변환합니다.
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
        this.coreDamageRequestCommittedCount = 0;
        this.coreDamageRequestAppliedCount = 0;
        this.coreDamageRequestFailure = null;
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
        this.coreDamageRequestFailure = null;
        this.cleanupFailure = null;
        return this.binding !== null;
    }

    /**
     * endpoint가 contiguous하게 확정한 event snapshot만 소비합니다.
     * 동일 snapshot의 모든 valid arrival cleanup을 먼저 예약한 뒤 Core damage를 확정합니다.
     */
    observeCompletedEvents(snapshot, registry) {
        this.#assertUsable();
        if (snapshot?.protocolFailure || !Array.isArray(snapshot?.events)) {
            return this.#createObservationResult([]);
        }
        const exactRegistry = assertRegistry(registry);
        const currentBinding = readProtocol(this.endpoint);
        if (!currentBinding
            || this.coreIntegrity.isDepleted()
            || this.coreDamageRequestFailure !== null) {
            this.ignoredCount += Array.isArray(snapshot.events)
                ? snapshot.events.length
                : 0;
            return this.#createObservationResult([]);
        }

        const authenticatedCandidates = [];
        let ignoredDelta = 0;
        let dedupedDispositionDelta = 0;
        let forgedTypedRequest = null;
        for (const event of snapshot.events) {
            if (event?.eventType === CORE_DAMAGE_REQUEST_EVENT_TYPE) {
                if (event.disposition !== 'applied') {
                    const disposition = this.#classifyNonAppliedCoreDamageRequest(
                        event,
                        currentBinding
                    );
                    if (disposition === 'dedupe') {
                        dedupedDispositionDelta++;
                        continue;
                    }
                    if (disposition === 'ignore') {
                        ignoredDelta++;
                        continue;
                    }
                    forgedTypedRequest = Object.freeze({
                        reason: 'unknown-disposition',
                        eventKey: eventIdentity(event)
                    });
                    break;
                }
                const typed = this.#normalizeCoreDamageRequestCandidate(
                    event,
                    exactRegistry,
                    currentBinding
                );
                if (typed.failureReason !== null) {
                    forgedTypedRequest = Object.freeze({
                        reason: typed.failureReason,
                        eventKey: eventIdentity(event)
                    });
                    break;
                }
                authenticatedCandidates.push(typed.candidate);
                continue;
            }
            const candidate = this.#normalizeImpactCandidate(
                event,
                exactRegistry,
                currentBinding
            );
            if (!candidate) {
                ignoredDelta++;
                continue;
            }
            authenticatedCandidates.push(candidate);
        }
        if (forgedTypedRequest !== null) {
            // Snapshot 전체 typed request를 임시 구조에서 먼저 인증합니다. 하나라도
            // forged이면 HP/binding/dedupe/facts/known cleanup state는 그대로 둡니다.
            this.ignoredCount++;
            this.coreDamageRequestFailure ??= forgedTypedRequest;
            return this.#createObservationResult([]);
        }

        const groupedByImpactKey = new Map();
        for (const candidate of authenticatedCandidates) {
            const group = groupedByImpactKey.get(candidate.impactKey);
            if (group) {
                group.push(candidate);
            } else {
                groupedByImpactKey.set(candidate.impactKey, [candidate]);
            }
        }
        const candidates = [];
        let dedupedDelta = 0;
        for (const [impactKey, group] of groupedByImpactKey) {
            group.sort(compareSemanticDuplicateProvenance);
            if (this.knownImpactKeys.has(impactKey)) {
                dedupedDelta += group.length;
                continue;
            }
            dedupedDelta += group.length - 1;
            candidates.push(group[0]);
        }
        candidates.sort(compareDamageCandidates);

        // 인증/semantic grouping이 모두 성공한 뒤에만 persistent state를 전진합니다.
        this.ignoredCount += ignoredDelta;
        this.dedupedCount += dedupedDelta + dedupedDispositionDelta;
        if (authenticatedCandidates.length === 0) {
            // Endpoint가 이미 판정한 replay/stale/duplicate는 telemetry 외의
            // binding/fact/known/HP state를 바꾸지 않습니다.
            return this.#createObservationResult([]);
        }
        if (authenticatedCandidates.length > 0) {
            const nextBinding = authenticatedCandidates
                .map(({ eventProtocol }) => eventProtocol)
                .sort(compareProtocol)
                .at(-1);
            if (nextBinding) {
                this.binding = nextBinding;
            }
        }
        for (const candidate of candidates) {
            this.#rememberImpactKey(candidate.impactKey);
            if (candidate.kind === 'enemy-impact') {
                this.pendingCleanupByImpactKey.set(candidate.impactKey, Object.freeze({
                    impactKey: candidate.impactKey,
                    commandId: createCleanupCommandId(candidate.impactKey),
                    coreHandle: candidate.coreHandle,
                    enemyHandle: candidate.enemyHandle,
                    state: 'PENDING'
                }));
            }
        }

        const facts = [];
        for (const candidate of candidates) {
            const before = this.coreIntegrity.getCurrentIntegrity();
            const requestedDamage = candidate.kind === 'core-damage-request'
                ? candidate.requestedDamage
                : candidate.coreImpactDamage;
            const appliedDamage = this.coreIntegrity.applyIntegrityDamage(
                requestedDamage
            );
            const after = this.coreIntegrity.getCurrentIntegrity();
            if (candidate.kind === 'core-damage-request') {
                facts.push(Object.freeze({
                    type: CORE_IMPACT_FACT_TYPE.DAMAGE_REQUEST,
                    coreHandle: candidate.coreHandle,
                    projectileHandle: candidate.projectileHandle,
                    requestedDamage: candidate.requestedDamage,
                    requestedDamageFixedPoint:
                        candidate.requestedDamageFixedPoint,
                    appliedDamage,
                    coreIntegrityBefore: before,
                    coreIntegrityAfter: after,
                    projectileDefinitionId:
                        candidate.projectileDefinitionId,
                    producerId: candidate.producerId,
                    sourceAbilityId: candidate.sourceAbilityId,
                    sourceHandle: candidate.sourceHandle,
                    ownerHandle: candidate.ownerHandle,
                    spawnSequence: candidate.spawnSequence,
                    impactKey: candidate.impactKey,
                    ...freezeProtocolFact(candidate.event)
                }));
                this.coreDamageRequestCommittedCount++;
                if (appliedDamage > 0) {
                    this.coreDamageRequestAppliedCount++;
                }
            } else {
                facts.push(Object.freeze({
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
                }));
            }
            if (appliedDamage > 0) {
                facts.push(Object.freeze({
                    type: CORE_IMPACT_FACT_TYPE.DAMAGED,
                    coreHandle: candidate.coreHandle,
                    ...(candidate.kind === 'core-damage-request'
                        ? { projectileHandle: candidate.projectileHandle }
                        : { enemyHandle: candidate.enemyHandle }),
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
                    ...(candidate.kind === 'core-damage-request'
                        ? { projectileHandle: candidate.projectileHandle }
                        : { enemyHandle: candidate.enemyHandle }),
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
                if (typeof receipt.commandId !== 'string'
                    || receipt.commandId.length === 0
                    || receipt.targetFixedTick !== targetFixedTick) {
                    this.pendingCleanupByImpactKey.delete(impactKey);
                    this.cleanupFailure = Object.freeze({
                        impactKey,
                        targetFixedTick,
                        reason: 'despawn-receipt-contract'
                    });
                    continue;
                }
                this.pendingCleanupByImpactKey.set(impactKey, Object.freeze({
                    ...cleanup,
                    commandId: receipt.commandId,
                    commitProvenance:
                        CORE_IMPACT_CLEANUP_COMMIT_PROVENANCE.DIRECT,
                    state: 'STAGED',
                    targetFixedTick
                }));
                requested++;
                continue;
            }
            if (isExactAuthenticatedCleanupDedup(
                receipt,
                cleanup,
                targetFixedTick
            )) {
                // same-handle/current-tick command의 authentic CORE 승격만 정상
                // dedupe입니다. 실제 owner command ID로 STAGED 추적해 commit을 증명합니다.
                this.pendingCleanupByImpactKey.set(impactKey, Object.freeze({
                    ...cleanup,
                    commandId: receipt.commandId,
                    commitProvenance:
                        CORE_IMPACT_CLEANUP_COMMIT_PROVENANCE.AUTHENTIC_EXISTING,
                    state: 'STAGED',
                    targetFixedTick
                }));
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
        const despawned = Array.isArray(result?.despawned)
            ? result.despawned
            : [];
        const rejected = Array.isArray(result?.rejected)
            ? result.rejected
            : [];
        const despawnedByCommandId = new Map();
        const duplicateDespawnCommandIds = new Set();
        const despawnCountByHandleKey = new Map();
        for (const entry of despawned) {
            const commandId = entry?.commandId;
            const exactHandleKey = handleIdentityKey(entry?.handle);
            despawnCountByHandleKey.set(
                exactHandleKey,
                (despawnCountByHandleKey.get(exactHandleKey) ?? 0) + 1
            );
            if (despawnedByCommandId.has(commandId)) {
                duplicateDespawnCommandIds.add(commandId);
                continue;
            }
            despawnedByCommandId.set(commandId, entry);
        }
        const rejectedByCommandId = new Map(
            rejected.map((entry) => [entry?.commandId, entry?.code])
        );

        // lifecycle 결과 전체를 먼저 인증하여 한 malformed/contradictory commit이
        // 같은 batch의 cleanup counter나 pending state를 부분 전진시키지 못하게 합니다.
        let provenanceFailure = null;
        for (const [impactKey, cleanup] of this.pendingCleanupByImpactKey) {
            if (cleanup.state !== 'STAGED') {
                continue;
            }
            const committed = despawnedByCommandId.get(cleanup.commandId);
            if (committed !== undefined
                && (duplicateDespawnCommandIds.has(cleanup.commandId)
                    || despawnCountByHandleKey.get(
                        handleIdentityKey(cleanup.enemyHandle)
                    ) !== 1
                    || rejectedByCommandId.has(cleanup.commandId)
                    || !isExactCommittedCoreImpactCleanup(
                        committed,
                        cleanup,
                        tick
                    ))) {
                provenanceFailure = Object.freeze({
                    impactKey,
                    targetFixedTick: tick,
                    reason: 'despawn-commit-provenance-contract'
                });
                break;
            }
        }
        if (provenanceFailure !== null) {
            this.pendingCleanupByImpactKey.delete(provenanceFailure.impactKey);
            this.cleanupFailure = provenanceFailure;
            return Object.freeze({
                pendingCleanupCount: this.#getPendingCleanupCount(),
                recoveryRequired: this.requiresRecovery()
            });
        }

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
        return !this.destroyed
            && (this.cleanupFailure !== null
                || this.coreDamageRequestFailure !== null);
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
            coreDamageRequestCommittedCount:
                this.coreDamageRequestCommittedCount,
            coreDamageRequestAppliedCount:
                this.coreDamageRequestAppliedCount,
            coreDamageRequestFailure: this.coreDamageRequestFailure,
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
            || (event?.eventType !== 'interaction-enter'
                && event?.eventType !== 'interaction-continuous')
            || event?.disposition !== 'applied') {
            return null;
        }
        const eventProtocol = readEventProtocol(event);
        if (!isAdmissibleCommittedProtocol(
            eventProtocol,
            this.binding,
            currentBinding
        )) {
            return null;
        }
        let subjectHandle;
        let otherHandle;
        try {
            subjectHandle = freezeHandle(event, 'event');
            otherHandle = freezeHandle(event.other, 'event.other');
        } catch {
            return null;
        }
        const subject = readExactView(registry, subjectHandle);
        const other = readExactView(registry, otherHandle);
        if (!subject || !other) {
            return null;
        }
        const coreIsSubject = subject.kindId === GPU_CORE_PROXY_WORLD_KIND_ID
            && other.kindId === ENEMY_WORLD_KIND_ID;
        const coreIsOther = other.kindId === GPU_CORE_PROXY_WORLD_KIND_ID
            && subject.kindId === ENEMY_WORLD_KIND_ID;
        if (!coreIsSubject && !coreIsOther) {
            return null;
        }
        const coreHandle = coreIsSubject ? subjectHandle : otherHandle;
        const enemyHandle = coreIsSubject ? otherHandle : subjectHandle;
        const enemy = coreIsSubject ? other : subject;
        const metadata = enemy.metadata;
        let hasCoreImpactCapability = false;
        try {
            hasCoreImpactCapability = hasEnemyCapability(
                metadata?.capabilityMask,
                ENEMY_CAPABILITY_ID.CORE_IMPACT,
                'enemy registry metadata capabilityMask'
            );
        } catch {
            hasCoreImpactCapability = false;
        }
        const coreImpactDamage = nonNegativeFinite(metadata?.coreImpactDamage, -1);
        const bountyBudget = nonNegativeFinite(metadata?.bountyBudget, -1);
        if (!hasCoreImpactCapability
            || coreImpactDamage < 0
            || bountyBudget < 0) {
            return null;
        }
        const impactKey = createSemanticImpactKey(
            eventProtocol,
            coreHandle,
            enemyHandle
        );
        return Object.freeze({
            kind: 'enemy-impact',
            event,
            eventProtocol,
            coreHandle,
            enemyHandle,
            damageSubjectHandle: enemyHandle,
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

    #classifyNonAppliedCoreDamageRequest(event, currentBinding) {
        const disposition = event?.disposition;
        const isKnown = disposition
                === CORE_DAMAGE_REQUEST_KNOWN_NON_APPLIED_DISPOSITION.DUPLICATE
            || disposition
                === CORE_DAMAGE_REQUEST_KNOWN_NON_APPLIED_DISPOSITION.REPLAY
            || disposition
                === CORE_DAMAGE_REQUEST_KNOWN_NON_APPLIED_DISPOSITION.STALE;
        if (!isKnown) {
            return 'unknown';
        }
        const eventProtocol = readEventProtocol(event);
        const admissible = event?.type === 'contact'
            && event?.eventType === CORE_DAMAGE_REQUEST_EVENT_TYPE
            && event?.maximumDamageWindow === false
            && isAdmissibleCommittedProtocol(
                eventProtocol,
                this.binding,
                currentBinding
            );
        if (!admissible
            || disposition
                === CORE_DAMAGE_REQUEST_KNOWN_NON_APPLIED_DISPOSITION.STALE) {
            return 'ignore';
        }
        return 'dedupe';
    }

    #normalizeCoreDamageRequestCandidate(event, registry, currentBinding) {
        if (event?.type !== 'contact'
            || event?.eventType !== CORE_DAMAGE_REQUEST_EVENT_TYPE
            || event?.disposition !== 'applied'
            || event?.maximumDamageWindow !== false) {
            return Object.freeze({ candidate: null, failureReason: 'event-contract' });
        }
        const eventProtocol = readEventProtocol(event);
        if (!isAdmissibleCommittedProtocol(
            eventProtocol,
            this.binding,
            currentBinding
        )) {
            return Object.freeze({ candidate: null, failureReason: 'protocol-binding' });
        }
        let projectileHandle;
        let coreHandle;
        try {
            projectileHandle = freezeHandle(event, 'event');
            coreHandle = freezeHandle(event.other, 'event.other');
        } catch {
            return Object.freeze({
                candidate: null,
                failureReason: 'exact-handle-contract'
            });
        }
        const projectile = readExactView(registry, projectileHandle);
        const core = readExactView(registry, coreHandle);
        if (!projectile
            || projectile.kindId !== PROJECTILE_WORLD_KIND_ID
            || !core
            || core.kindId !== GPU_CORE_PROXY_WORLD_KIND_ID
            || core.definitionId !== GPU_CORE_PROXY_DEFINITION_ID) {
            return Object.freeze({
                candidate: null,
                failureReason: 'exact-entity-contract'
            });
        }
        const metadata = projectile.metadata;
        let sourceHandle;
        let ownerHandle;
        let authoredCoreTargetHandle;
        let selectedTargetHandle;
        let spawnSequence;
        let expectedDamageFixedPoint;
        try {
            sourceHandle = freezeHandle({
                entityId: metadata?.sourceEntityId,
                incarnation: metadata?.sourceIncarnation
            }, 'projectile.metadata.sourceHandle');
            ownerHandle = freezeHandle({
                entityId: metadata?.ownerEntityId,
                incarnation: metadata?.ownerIncarnation
            }, 'projectile.metadata.ownerHandle');
            authoredCoreTargetHandle = freezeHandle({
                entityId: metadata?.coreTargetEntityId,
                incarnation: metadata?.coreTargetIncarnation
            }, 'projectile.metadata.coreTargetHandle');
            selectedTargetHandle = freezeHandle({
                entityId: metadata?.selectedTargetEntityId,
                incarnation: metadata?.selectedTargetIncarnation
            }, 'projectile.metadata.selectedTargetHandle');
            spawnSequence = requireNonNegativeSafeInteger(
                metadata?.spawnSequence,
                'projectile.metadata.spawnSequence'
            );
            requirePositiveSafeInteger(event.sourceTick, 'event.sourceTick');
            requireNonNegativeSafeInteger(event.sequence, 'event.sequence');
            expectedDamageFixedPoint = encodeGpuCircleBodyFixedPoint(
                CANONICAL_RHOM_CORE_DAMAGE_REQUEST.coreDamage
            );
        } catch {
            return Object.freeze({
                candidate: null,
                failureReason: 'metadata-primitive-contract'
            });
        }
        const eventDamageFixedPoint = event.valueFixedPoint;
        const metadataDamageFixedPoint = metadata?.coreDamageFixedPoint;
        const projectileDefinitionId = optionalId(projectile.definitionId);
        const metadataDefinitionId = optionalId(metadata?.definitionId);
        const producerId = optionalId(metadata?.producerId);
        const sourceAbilityId = optionalId(metadata?.sourceAbilityId);
        const descriptor = CANONICAL_RHOM_CORE_DAMAGE_REQUEST;
        if (metadata?.teamId !== GAMEPLAY_TEAM_ID.HOSTILE
            || metadata?.allegiancePolicy !== descriptor.allegiancePolicy
            || metadata?.damagePolicyId !== descriptor.damagePolicyId
            || metadata?.targetPolicyId !== descriptor.targetPolicyId
            || metadata?.towerTargetPolicyId
                !== descriptor.towerTargetPolicyId
            || metadata?.coreTargetPolicyId !== descriptor.coreTargetPolicyId
            || metadata?.coreDamageRequestPolicyId
                !== descriptor.coreDamageRequestPolicyId
            || metadata?.targetSelectionPolicyId
                !== descriptor.targetSelectionPolicyId
            || metadata?.distancePolicyId !== descriptor.distancePolicyId
            || metadata?.attackRangeTiles !== descriptor.attackRangeTiles
            || metadata?.requiresExactSelectedTarget !== true
            || !sameHandle(authoredCoreTargetHandle, coreHandle)
            || metadata?.selectedTargetKind !== 'core'
            || !sameHandle(selectedTargetHandle, coreHandle)
            || metadata?.selectedTargetPolicyId
                !== descriptor.coreTargetPolicyId
            || !sameHandle(sourceHandle, ownerHandle)
            || projectileDefinitionId !== descriptor.projectileDefinitionId
            || metadataDefinitionId !== projectileDefinitionId
            || producerId !== descriptor.producerId
            || sourceAbilityId !== descriptor.sourceAbilityId
            || metadata?.coreDamage !== descriptor.coreDamage
            || metadata?.selectionSequence !== spawnSequence
            || !Number.isSafeInteger(metadata?.selectionSourceTick)
            || metadata.selectionSourceTick <= 0
            || metadata.selectionSourceTick > event.sourceTick
            || projectile.createdAtTick !== metadata.selectionSourceTick
            || !Number.isSafeInteger(metadata?.attackFingerprint)
            || metadata.attackFingerprint <= 0
            || !Number.isSafeInteger(expectedDamageFixedPoint)
            || expectedDamageFixedPoint <= 0
            || expectedDamageFixedPoint !== descriptor.coreDamageFixedPoint
            || !Number.isSafeInteger(metadataDamageFixedPoint)
            || !Number.isSafeInteger(eventDamageFixedPoint)
            || metadataDamageFixedPoint !== expectedDamageFixedPoint
            || eventDamageFixedPoint !== expectedDamageFixedPoint
            || event.damageFixedPoint !== 0) {
            return Object.freeze({
                candidate: null,
                failureReason: 'metadata-authentication'
            });
        }
        // Projectile의 source Enemy는 이 시점에 active일 필요가 없습니다.
        // Registry source liveness를 조회하지 않고 spawn-time exact metadata만 인증합니다.
        const impactKey = createSemanticCoreDamageRequestKey(
            eventProtocol,
            coreHandle,
            projectileHandle
        );
        return Object.freeze({
            failureReason: null,
            candidate: Object.freeze({
                kind: 'core-damage-request',
                event,
                eventProtocol,
                coreHandle,
                projectileHandle,
                damageSubjectHandle: projectileHandle,
                requestedDamageFixedPoint: expectedDamageFixedPoint,
                requestedDamage: expectedDamageFixedPoint
                    / GPU_CIRCLE_BODY_FIXED_POINT.HEALTH_SCALE,
                projectileDefinitionId,
                producerId,
                sourceAbilityId,
                sourceHandle,
                ownerHandle,
                spawnSequence,
                impactKey
            })
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
