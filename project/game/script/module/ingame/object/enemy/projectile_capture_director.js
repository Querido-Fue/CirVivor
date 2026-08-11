import {
    PROJECTILE_CAPTURE_POLICY_ID,
    PROJECTILE_ORIGIN_PROVENANCE_KEYS
} from '../../contract/projectile_capture_contract.js';
import {
    GAMEPLAY_ALLEGIANCE_POLICY,
    GAMEPLAY_TEAM_ID
} from '../../contract/gameplay_team_contract.js';
import {
    PROJECTILE_TARGET_POLICY_ID
} from '../../contract/projectile_target_policy_contract.js';
import {
    BASIC_RING_ENEMY_DEFINITION_ID
} from 'data/object/enemy/basic_ring_enemy_data.js';
import {
    GPU_CORE_PROXY_DEFINITION_ID,
    GPU_CORE_PROXY_WORLD_KIND_ID
} from '../core/gpu_core_proxy_spawn_adapter.js';
import {
    GPU_ENEMY_PROJECTILE_CAPTURE_PROFILE_CODE,
    RING_PROJECTILE_CAPTURE_DELAY_FIXED_TICKS,
    RING_PROJECTILE_CAPTURE_PROFILE_ID
} from 'data/object/enemy/enemy_projectile_capture_catalog_data.js';
import {
    GPU_PROJECTILE_CAPTURE_RELEASE_REASON,
    GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION,
    GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR,
    GPU_PROJECTILE_CAPTURE_TICK_STATUS
} from '../../physics/gpu/gpu_projectile_capture_runtime_abi.js';

const INVALID_U32 = 0xffffffff;
const CAPTURE_STATE = Object.freeze({
    HELD: 'held',
    RELEASE_PENDING: 'release-pending',
    RELEASE_REQUESTED: 'release-requested',
    RELEASE_COMMITTED: 'release-committed',
    TERMINAL_CLEANUP_REQUESTED: 'terminal-cleanup-requested'
});
const VALID_RELEASE_REASONS = new Set(
    Object.values(GPU_PROJECTILE_CAPTURE_RELEASE_REASON)
);
const RELEASE_MUTABLE_METADATA_KEYS = new Set([
    'teamId',
    'allegiancePolicy',
    'ownerEntityId',
    'ownerIncarnation',
    'sourceEntityId',
    'sourceIncarnation',
    'targetEntityId',
    'targetIncarnation',
    'targetPolicyId'
]);

function requirePositiveUint32(value, label) {
    if (typeof value !== 'number'
        || !Number.isSafeInteger(value)
        || value <= 0
        || value >= INVALID_U32) {
        throw new RangeError(`${label}은 positive non-sentinel uint32여야 합니다.`);
    }
    return value;
}

function requireNonNegativeSafeInteger(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${label}은 0 이상의 안전한 정수여야 합니다.`);
    }
    return value;
}

function requireNonNegativeUint32(value, label) {
    if (typeof value !== 'number'
        || !Number.isSafeInteger(value)
        || value < 0
        || value >= INVALID_U32) {
        throw new RangeError(`${label}은 non-sentinel uint32여야 합니다.`);
    }
    return value;
}

function requireRawUint32(value, label) {
    if (typeof value !== 'number'
        || !Number.isSafeInteger(value)
        || value < 0
        || value > INVALID_U32) {
        throw new RangeError(`${label}은 uint32여야 합니다.`);
    }
    return value;
}

function requireFiniteNumber(value, label, minimum = -Infinity) {
    if (typeof value !== 'number'
        || !Number.isFinite(value)
        || value < minimum) {
        throw new RangeError(`${label}은 유한한 숫자여야 합니다.`);
    }
    return value;
}

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

function normalizeHandle(source, label) {
    if (!source || typeof source !== 'object') {
        throw new TypeError(`${label}은 exact handle이어야 합니다.`);
    }
    return Object.freeze({
        entityId: requirePositiveUint32(source.entityId, `${label}.entityId`),
        incarnation: requirePositiveUint32(
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

function assertRegistry(source) {
    for (const method of ['has', 'copyEntityView']) {
        if (typeof source?.[method] !== 'function') {
            throw new TypeError(`Ring capture registry.${method}()가 필요합니다.`);
        }
    }
    return source;
}

function assertCommandPort(source) {
    for (const method of [
        'requestPreparedReleaseBatch',
        'discardPreparedBatch',
        'requestTerminalHeldProjectileDespawn'
    ]) {
        if (typeof source?.[method] !== 'function') {
            throw new TypeError(`Ring capture command port.${method}()가 필요합니다.`);
        }
    }
    return source;
}

function normalizeReleaseReason(value, label) {
    const reason = requirePositiveUint32(value, label);
    if (!VALID_RELEASE_REASONS.has(reason)) {
        throw new RangeError(`${label}은 알려진 release reason이어야 합니다.`);
    }
    return reason;
}

function isReplayDisposition(event) {
    return event?.disposition === 'duplicate'
        || event?.disposition === 'stale';
}

function hasExactReleasedMetadataShape(current, expected) {
    if (!current || typeof current !== 'object'
        || !expected || typeof expected !== 'object') {
        return false;
    }
    const expectedKeys = new Set(Object.keys(expected));
    for (const key of Object.keys(current)) {
        if (!RELEASE_MUTABLE_METADATA_KEYS.has(key)
            && (!expectedKeys.has(key) || current[key] !== expected[key])) {
            return false;
        }
    }
    for (const key of expectedKeys) {
        if (!RELEASE_MUTABLE_METADATA_KEYS.has(key)
            && current[key] !== expected[key]) {
            return false;
        }
    }
    return true;
}

/**
 * R 한 슬롯의 exact projectile roster와 GPU release prepare proof를 소유합니다.
 * Capture 자체는 registry를 바꾸지 않으며 hostile release만 lifecycle transaction으로
 * 승격합니다.
 */
export class RingProjectileCaptureDirector {
    constructor(options = {}) {
        this.registry = assertRegistry(options.registry);
        this.commandPort = assertCommandPort(
            options.projectileCaptureCommandPort
        );
        this.sessionGeneration = requirePositiveUint32(
            options.sessionGeneration,
            'sessionGeneration'
        );
        this.deviceGeneration = requireNonNegativeUint32(
            options.deviceGeneration,
            'deviceGeneration'
        );
        this.authoritativeEpoch = requireNonNegativeUint32(
            options.authoritativeEpoch,
            'authoritativeEpoch'
        );
        this.capacity = requirePositiveUint32(options.capacity, 'capacity');
        this.capturedByProjectileKey = new Map();
        this.projectileKeyByCaptorKey = new Map();
        this.pendingBatchesByCommandId = new Map();
        this.pendingTerminalCleanupByCommandId = new Map();
        this.completedSequenceByProjectileKey = new Map();
        this.completedSequenceKeys = [];
        this.completedCaptureFingerprintByTick = new Map();
        this.completedReleaseFingerprintByTick = new Map();
        this.observedLifecycleCommits = new WeakSet();
        this.lastCompletedCaptureTick = 0;
        this.lastCompletedReleaseTick = 0;
        this.lastFixedCommitTick = 0;
        this.lastObservedFixedTick = 0;
        this.lastStageTick = 0;
        this.lastStageResult = null;
        this.recoveryRequired = false;
        this.failure = null;
        this.ingressOpen = true;
        this.terminal = null;
        this.destroyed = false;
    }

    observeCompletedCapturePrograms(snapshot) {
        if (this.destroyed || !snapshot || typeof snapshot !== 'object') {
            return this.#fail('projectile-capture-completion-contract');
        }
        try {
            this.#assertAuthenticatedCompletionHeader(
                snapshot,
                'captureCompletion'
            );
        } catch (error) {
            return this.#fail(
                'projectile-capture-completion-authentication',
                error.message
            );
        }
        if (snapshot.pending === true) {
            return Object.freeze({ accepted: true, pending: true });
        }
        if (snapshot.protocolFailure) {
            return this.#fail(
                snapshot.protocolFailure.code
                    ?? 'projectile-capture-completion-protocol'
            );
        }
        if (!Array.isArray(snapshot.captures)
            || !Array.isArray(snapshot.releasePreparations)
            || !Array.isArray(snapshot.cleanups)) {
            return this.#fail('projectile-capture-completion-array-contract');
        }
        if (this.terminal
            && (snapshot.captures.length > 0
                || snapshot.releasePreparations.length > 0)) {
            return this.#fail('projectile-capture-terminal-new-program');
        }
        let completedThroughTick;
        let sourceTick;
        let batchIdFingerprint;
        try {
            completedThroughTick = requireNonNegativeUint32(
                snapshot.completedThroughTick,
                'captureCompletion.completedThroughTick'
            );
            sourceTick = requireNonNegativeUint32(
                snapshot.sourceTick ?? completedThroughTick,
                'captureCompletion.sourceTick'
            );
            batchIdFingerprint = snapshot.batchIdFingerprint === 0
                || snapshot.batchIdFingerprint === undefined
                ? 0
                : requirePositiveUint32(
                    snapshot.batchIdFingerprint,
                    'captureCompletion.batchIdFingerprint'
                );
        } catch (error) {
            return this.#fail('projectile-capture-completion-header', error.message);
        }
        if (completedThroughTick < this.lastCompletedCaptureTick) {
            return this.#fail('projectile-capture-completion-tick-regression');
        }
        if (sourceTick > completedThroughTick
            || snapshot.status !== GPU_PROJECTILE_CAPTURE_TICK_STATUS.COMPLETE
            || snapshot.errorFlags !== 0) {
            return this.#fail('projectile-capture-completion-watermark-status');
        }
        const knownFingerprint = this.completedCaptureFingerprintByTick.get(sourceTick);
        if (knownFingerprint !== undefined) {
            if (knownFingerprint === batchIdFingerprint) {
                return Object.freeze({
                    accepted: true,
                    replayed: true,
                    pending: false,
                    captureCount: 0,
                    releasePreparationCount: 0,
                    cleanupCount: 0
                });
            }
            return this.#fail('projectile-capture-completion-replay-conflict');
        }

        const nextEntries = new Map(this.capturedByProjectileKey);
        const nextCaptorSlots = new Map(this.projectileKeyByCaptorKey);
        const invalidPreparedFingerprints = new Set();
        const completedSequences = [];
        const captureRecordKeys = new Set();
        const releasePreparationRecordKeys = new Set();
        const cleanupRecordKeys = new Set();
        try {
            for (let index = 0; index < snapshot.captures.length; index++) {
                const record = snapshot.captures[index];
                const projectileHandle = normalizeHandle(
                    record?.projectileHandle,
                    `captures[${index}].projectileHandle`
                );
                const captorHandle = normalizeHandle(
                    record?.captorHandle,
                    `captures[${index}].captorHandle`
                );
                const captureSequence = requirePositiveUint32(
                    record?.captureSequence,
                    `captures[${index}].captureSequence`
                );
                const capturedAtFixedTick = requirePositiveUint32(
                    record?.sourceTick,
                    `captures[${index}].sourceTick`
                );
                if (capturedAtFixedTick !== sourceTick) {
                    throw new RangeError('capture source tick이 header와 다릅니다.');
                }
                const projectileKey = handleKey(projectileHandle);
                const captureRecordKey = `${projectileKey}:${captureSequence}`;
                if (captureRecordKeys.has(captureRecordKey)) {
                    throw new RangeError('capture completion record가 중복됐습니다.');
                }
                captureRecordKeys.add(captureRecordKey);
                const captorKey = handleKey(captorHandle);
                const completedSequence = this.completedSequenceByProjectileKey.get(
                    projectileKey
                );
                if (completedSequence !== undefined
                    && captureSequence <= completedSequence) {
                    throw new RangeError('capture completion sequence가 stale입니다.');
                }
                const existing = nextEntries.get(projectileKey);
                if (existing) {
                    throw new RangeError('projectile capture identity/sequence conflict');
                }
                const occupiedProjectileKey = nextCaptorSlots.get(captorKey);
                if (occupiedProjectileKey && occupiedProjectileKey !== projectileKey) {
                    throw new RangeError('Ring single capture slot이 중복 점유됐습니다.');
                }
                const captorView = this.registry.copyEntityView(captorHandle, {});
                const projectileView = this.registry.copyEntityView(
                    projectileHandle,
                    {}
                );
                if (!captorView
                    || captorView.definitionId !== BASIC_RING_ENEMY_DEFINITION_ID
                    || captorView.metadata?.projectileCaptureProfileId
                        !== RING_PROJECTILE_CAPTURE_PROFILE_ID) {
                    throw new RangeError('capture captor는 current exact canonical R이어야 합니다.');
                }
                if (!projectileView
                    || projectileView.kindId !== 'projectile'
                    || projectileView.metadata?.projectileCapturePolicyId
                        !== PROJECTILE_CAPTURE_POLICY_ID.CAPTURABLE
                    || !Number.isSafeInteger(projectileView.metadataRevision)
                    || projectileView.metadataRevision <= 0) {
                    throw new RangeError('capture target은 current exact capturable projectile이어야 합니다.');
                }
                const releaseDueFixedTick = capturedAtFixedTick
                    + RING_PROJECTILE_CAPTURE_DELAY_FIXED_TICKS;
                requirePositiveUint32(
                    releaseDueFixedTick,
                    `captures[${index}].releaseDueFixedTick`
                );
                nextEntries.set(projectileKey, Object.freeze({
                    projectileKey,
                    captorKey,
                    projectileHandle,
                    captorHandle,
                    captureSequence,
                    capturedAtFixedTick,
                    releaseDueFixedTick,
                    expectedMetadata: projectileView.metadata,
                    expectedMetadataRevision: projectileView.metadataRevision,
                    state: CAPTURE_STATE.HELD,
                    prepareSourceTick: 0,
                    batchIdFingerprint: 0,
                    releaseReason: 0,
                    prepareEvidence: null,
                    coreImpactReceipt: null,
                    deathEventAuthenticated: false,
                    committedTargetFixedTick: 0,
                    committedTargetHandle: null,
                    committedMetadataRevision: 0,
                    committedRegistryRevision: 0,
                    requestedTargetHandle: null,
                    commandIdFingerprint: 0,
                    commandId: null
                }));
                nextCaptorSlots.set(captorKey, projectileKey);
            }

            for (let index = 0;
                index < snapshot.releasePreparations.length;
                index++) {
                const record = snapshot.releasePreparations[index];
                const projectileHandle = normalizeHandle(
                    record?.projectileHandle,
                    `releasePreparations[${index}].projectileHandle`
                );
                const captorHandle = normalizeHandle(
                    record?.captorHandle,
                    `releasePreparations[${index}].captorHandle`
                );
                const projectileKey = handleKey(projectileHandle);
                const preparationRecordKey
                    = `${projectileKey}:${record?.captureSequence}`;
                if (releasePreparationRecordKeys.has(preparationRecordKey)) {
                    throw new RangeError('release prepare record가 중복됐습니다.');
                }
                releasePreparationRecordKeys.add(preparationRecordKey);
                const entry = nextEntries.get(projectileKey);
                const captureSequence = requirePositiveUint32(
                    record?.captureSequence,
                    `releasePreparations[${index}].captureSequence`
                );
                if (!entry
                    || !sameHandle(entry.captorHandle, captorHandle)
                    || entry.captureSequence !== captureSequence) {
                    throw new RangeError('release prepare가 captured roster와 다릅니다.');
                }
                const prepareSourceTick = requirePositiveUint32(
                    record.prepareSourceTick,
                    `releasePreparations[${index}].prepareSourceTick`
                );
                if (prepareSourceTick !== sourceTick
                    || record.batchIdFingerprint !== batchIdFingerprint) {
                    throw new RangeError(
                        'release prepare header watermark/fingerprint가 다릅니다.'
                    );
                }
                const releaseReason = normalizeReleaseReason(
                    record.releaseReason,
                    `releasePreparations[${index}].releaseReason`
                );
                const fingerprint = requirePositiveUint32(
                    record.batchIdFingerprint,
                    `releasePreparations[${index}].batchIdFingerprint`
                );
                const evidence = record.prepareEvidence;
                if (!evidence
                    || typeof evidence !== 'object'
                    || !Object.isFrozen(evidence)) {
                    throw new TypeError('release prepare authentic evidence가 필요합니다.');
                }
                const prepareFingerprint = requirePositiveUint32(
                    evidence.prepareFingerprint,
                    `releasePreparations[${index}].prepareFingerprint`
                );
                void prepareFingerprint;
                if (normalizeReleaseReason(
                    evidence.baseReason,
                    `releasePreparations[${index}].baseReason`
                ) !== releaseReason) {
                    throw new RangeError('release prepare base reason이 다릅니다.');
                }
                if (evidence.profileCode
                    !== GPU_ENEMY_PROJECTILE_CAPTURE_PROFILE_CODE
                        .RING_SINGLE_SLOT) {
                    throw new RangeError('release prepare profile code가 R이 아닙니다.');
                }
                if (!Object.isFrozen(evidence.anchor)
                    || !Object.isFrozen(evidence.facing)) {
                    throw new TypeError('release prepare vector proof는 frozen이어야 합니다.');
                }
                requireFiniteNumber(evidence.anchor.x, 'prepareEvidence.anchor.x');
                requireFiniteNumber(evidence.anchor.y, 'prepareEvidence.anchor.y');
                requireFiniteNumber(evidence.facing.x, 'prepareEvidence.facing.x');
                requireFiniteNumber(evidence.facing.y, 'prepareEvidence.facing.y');
                requireFiniteNumber(
                    evidence.capturedSpeed,
                    'prepareEvidence.capturedSpeed',
                    0
                );
                const targetSelector = requireNonNegativeUint32(
                    evidence.targetSelector,
                    `releasePreparations[${index}].targetSelector`
                );
                if (targetSelector
                    === GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR.TOWER) {
                    if (requireRawUint32(
                        evidence.targetBodySlot,
                        `releasePreparations[${index}].targetBodySlot`
                    ) === INVALID_U32) {
                        throw new RangeError('Tower target body slot이 invalid입니다.');
                    }
                    normalizeHandle(
                        evidence.targetHandle,
                        `releasePreparations[${index}].targetHandle`
                    );
                } else if (targetSelector
                    !== GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR.INVALID_FORWARD
                    || evidence.targetHandle !== null
                    || requireRawUint32(
                        evidence.targetBodySlot,
                        `releasePreparations[${index}].targetBodySlot`
                    ) !== INVALID_U32) {
                    throw new RangeError('release prepare target selector가 잘못됐습니다.');
                }
                if (releaseReason
                    !== GPU_PROJECTILE_CAPTURE_RELEASE_REASON.NORMAL_DUE
                    && targetSelector
                        !== GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR
                            .INVALID_FORWARD) {
                    throw new RangeError('death release prepare는 stored-forward여야 합니다.');
                }
                const evidenceCapturedAt = requirePositiveUint32(
                    evidence.capturedAtFixedTick,
                    `releasePreparations[${index}].capturedAtFixedTick`
                );
                const releaseDueFixedTick = requirePositiveUint32(
                    evidence.releaseDueFixedTick,
                    `releasePreparations[${index}].releaseDueFixedTick`
                );
                const publicationFixedTick = prepareSourceTick + 1;
                requirePositiveUint32(
                    publicationFixedTick,
                    `releasePreparations[${index}].publicationFixedTick`
                );
                const normalRelease
                    = releaseReason
                        === GPU_PROJECTILE_CAPTURE_RELEASE_REASON.NORMAL_DUE;
                if (evidenceCapturedAt !== entry.capturedAtFixedTick
                    || releaseDueFixedTick !== entry.releaseDueFixedTick
                    || (normalRelease
                        ? publicationFixedTick < releaseDueFixedTick
                        : publicationFixedTick <= entry.capturedAtFixedTick)) {
                    throw new RangeError('release prepare tick/reason proof가 다릅니다.');
                }
                nextEntries.set(projectileKey, Object.freeze({
                    ...entry,
                    releaseDueFixedTick,
                    state: CAPTURE_STATE.RELEASE_PENDING,
                    prepareSourceTick,
                    batchIdFingerprint: fingerprint,
                    releaseReason,
                    prepareEvidence: evidence,
                    coreImpactReceipt: null,
                    deathEventAuthenticated: false,
                    commandId: null
                }));
            }

            for (let index = 0; index < snapshot.cleanups.length; index++) {
                const record = snapshot.cleanups[index];
                const projectileHandle = normalizeHandle(
                    record?.projectileHandle,
                    `cleanups[${index}].projectileHandle`
                );
                const captorHandle = normalizeHandle(
                    record?.captorHandle,
                    `cleanups[${index}].captorHandle`
                );
                const captureSequence = requirePositiveUint32(
                    record?.captureSequence,
                    `cleanups[${index}].captureSequence`
                );
                if (record.sourceTick !== sourceTick) {
                    throw new RangeError('cleanup source tick이 header와 다릅니다.');
                }
                if (record?.reason === undefined || record.reason === null) {
                    throw new TypeError(`cleanups[${index}].reason이 필요합니다.`);
                }
                const projectileKey = handleKey(projectileHandle);
                const cleanupRecordKey = `${projectileKey}:${captureSequence}`;
                if (cleanupRecordKeys.has(cleanupRecordKey)) {
                    throw new RangeError('capture cleanup record가 중복됐습니다.');
                }
                cleanupRecordKeys.add(cleanupRecordKey);
                const entry = nextEntries.get(projectileKey);
                if (!entry) {
                    throw new RangeError('capture cleanup roster entry가 없습니다.');
                }
                if (!sameHandle(entry.captorHandle, captorHandle)
                    || entry.captureSequence !== captureSequence) {
                    throw new RangeError('capture cleanup identity/sequence conflict');
                }
                if (entry.batchIdFingerprint > 0) {
                    invalidPreparedFingerprints.add(entry.batchIdFingerprint);
                }
                nextEntries.delete(projectileKey);
                nextCaptorSlots.delete(entry.captorKey);
                completedSequences.push({ projectileKey, captureSequence });
            }
            if (nextEntries.size > this.capacity) {
                throw new RangeError('Ring capture host roster capacity를 초과했습니다.');
            }
        } catch (error) {
            return this.#fail('projectile-capture-completion-validation', error.message);
        }

        for (const fingerprint of invalidPreparedFingerprints) {
            const discarded = this.commandPort.discardPreparedBatch({
                batchIdFingerprint: fingerprint
            });
            if (discarded?.accepted !== true
                && discarded?.requiresRecovery === true) {
                return this.#fail(
                    'projectile-capture-prepared-discard',
                    discarded.reason
                );
            }
            this.#resetPreparedPeers(nextEntries, fingerprint);
        }
        const remainingPrepared = [...nextEntries.values()].some((entry) => (
            entry.batchIdFingerprint === batchIdFingerprint
            && entry.state === CAPTURE_STATE.RELEASE_PENDING
        ));
        if (batchIdFingerprint > 0
            && !remainingPrepared
            && !invalidPreparedFingerprints.has(batchIdFingerprint)) {
            const discarded = this.commandPort.discardPreparedBatch({
                batchIdFingerprint
            });
            if (discarded?.accepted !== true
                && discarded?.requiresRecovery === true) {
                return this.#fail(
                    'projectile-capture-empty-prepared-discard',
                    discarded.reason
                );
            }
        }
        this.capturedByProjectileKey = nextEntries;
        this.projectileKeyByCaptorKey = nextCaptorSlots;
        for (const completed of completedSequences) {
            this.#rememberCompletedSequence(
                completed.projectileKey,
                completed.captureSequence
            );
        }
        this.lastCompletedCaptureTick = completedThroughTick;
        this.completedCaptureFingerprintByTick.set(sourceTick, batchIdFingerprint);
        while (this.completedCaptureFingerprintByTick.size > this.capacity) {
            const oldest = this.completedCaptureFingerprintByTick.keys().next().value;
            this.completedCaptureFingerprintByTick.delete(oldest);
        }
        return Object.freeze({
            accepted: true,
            pending: false,
            captureCount: snapshot.captures.length,
            releasePreparationCount: snapshot.releasePreparations.length,
            cleanupCount: snapshot.cleanups.length,
            capturedProjectileCount: this.capturedByProjectileKey.size
        });
    }

    observeCompletedReleasePrograms(snapshot) {
        if (this.destroyed || !snapshot || typeof snapshot !== 'object') {
            return this.#fail('projectile-release-completion-contract');
        }
        try {
            this.#assertAuthenticatedCompletionHeader(
                snapshot,
                'releaseCompletion'
            );
        } catch (error) {
            return this.#fail(
                'projectile-release-completion-authentication',
                error.message
            );
        }
        if (snapshot.pending === true) {
            return Object.freeze({ accepted: true, pending: true });
        }
        if (snapshot.protocolFailure) {
            return this.#fail(
                snapshot.protocolFailure.code
                    ?? 'projectile-release-completion-protocol'
            );
        }
        if (!Array.isArray(snapshot.releaseCompletions)) {
            return this.#fail('projectile-release-completion-array-contract');
        }
        let completedThroughTick;
        const nextEntries = new Map(this.capturedByProjectileKey);
        const nextCaptorSlots = new Map(this.projectileKeyByCaptorKey);
        const completedSequences = new Map();
        const releaseCompletionRecordKeys = new Set();
        try {
            completedThroughTick = requireNonNegativeUint32(
                snapshot.completedThroughTick,
                'releaseCompletion.completedThroughTick'
            );
            if (completedThroughTick < this.lastCompletedReleaseTick) {
                throw new RangeError('release completion tick regression');
            }
            if (snapshot.sourceTick > completedThroughTick
                || snapshot.status
                    !== GPU_PROJECTILE_CAPTURE_TICK_STATUS.COMPLETE
                || snapshot.errorFlags !== 0) {
                throw new RangeError('release completion watermark/status mismatch');
            }
            const knownFingerprint = this.completedReleaseFingerprintByTick.get(
                snapshot.sourceTick
            );
            if (knownFingerprint !== undefined) {
                if (knownFingerprint === snapshot.batchIdFingerprint) {
                    return Object.freeze({
                        accepted: true,
                        replayed: true,
                        pending: false,
                        releaseCount: 0,
                        capturedProjectileCount: this.capturedByProjectileKey.size
                    });
                }
                throw new RangeError('release completion replay fingerprint가 다릅니다.');
            }
            for (let index = 0;
                index < snapshot.releaseCompletions.length;
                index++) {
                const record = snapshot.releaseCompletions[index];
                const projectileHandle = normalizeHandle(
                    record?.projectileHandle,
                    `releases[${index}].projectileHandle`
                );
                const captorHandle = normalizeHandle(
                    record?.captorHandle,
                    `releases[${index}].captorHandle`
                );
                const captureSequence = requirePositiveUint32(
                    record?.captureSequence,
                    `releases[${index}].captureSequence`
                );
                const releaseSourceTick = requirePositiveUint32(
                    record?.sourceTick,
                    `releases[${index}].sourceTick`
                );
                const releaseBatchFingerprint = requirePositiveUint32(
                    record?.batchIdFingerprint,
                    `releases[${index}].batchIdFingerprint`
                );
                if (releaseSourceTick !== snapshot.sourceTick
                    || releaseBatchFingerprint
                        !== snapshot.batchIdFingerprint) {
                    throw new RangeError(
                        'release completion header watermark/fingerprint가 다릅니다.'
                    );
                }
                const projectileKey = handleKey(projectileHandle);
                const releaseCompletionRecordKey
                    = `${projectileKey}:${captureSequence}`;
                if (releaseCompletionRecordKeys.has(
                    releaseCompletionRecordKey
                )) {
                    throw new RangeError('release completion record가 중복됐습니다.');
                }
                releaseCompletionRecordKeys.add(releaseCompletionRecordKey);
                const entry = nextEntries.get(projectileKey);
                if (!entry) {
                    throw new RangeError('release completion roster entry가 없습니다.');
                }
                if (entry.state !== CAPTURE_STATE.RELEASE_COMMITTED
                    || !sameHandle(entry.captorHandle, captorHandle)
                    || entry.captureSequence !== captureSequence) {
                    throw new RangeError('release completion identity/state가 다릅니다.');
                }
                const releaseReason = normalizeReleaseReason(
                    record.releaseReason,
                    `releases[${index}].releaseReason`
                );
                const prepareFingerprint = requirePositiveUint32(
                    record.prepareFingerprint,
                    `releases[${index}].prepareFingerprint`
                );
                const commandIdFingerprint = requirePositiveUint32(
                    record.commandIdFingerprint,
                    `releases[${index}].commandIdFingerprint`
                );
                const publicationFixedTick = requirePositiveUint32(
                    record.publicationFixedTick,
                    `releases[${index}].publicationFixedTick`
                );
                const metadataRevision = requirePositiveUint32(
                    record.metadataRevision,
                    `releases[${index}].metadataRevision`
                );
                const targetSelector = requireNonNegativeUint32(
                    record.targetSelector,
                    `releases[${index}].targetSelector`
                );
                const targetHandle = record.targetHandle === null
                    ? null
                    : normalizeHandle(
                        record.targetHandle,
                        `releases[${index}].targetHandle`
                    );
                const expectedTargetSelector = entry.committedTargetHandle
                    ? GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR.TOWER
                    : GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR.INVALID_FORWARD;
                const currentView = this.registry.copyEntityView(
                    projectileHandle,
                    {}
                );
                const currentMetadata = currentView?.metadata;
                if (releaseReason !== entry.releaseReason
                    || releaseBatchFingerprint !== entry.batchIdFingerprint
                    || prepareFingerprint
                        !== entry.prepareEvidence.prepareFingerprint
                    || commandIdFingerprint !== entry.commandIdFingerprint
                    || publicationFixedTick !== entry.committedTargetFixedTick
                    || releaseSourceTick !== publicationFixedTick
                    || targetSelector !== expectedTargetSelector
                    || !sameHandle(targetHandle, entry.committedTargetHandle)
                    || record.teamId !== GAMEPLAY_TEAM_ID.HOSTILE
                    || record.allegiancePolicy
                        !== GAMEPLAY_ALLEGIANCE_POLICY.FIXED_HOSTILE
                    || record.damagePolicyId
                        !== entry.expectedMetadata.damagePolicyId
                    || record.targetPolicyId
                        !== PROJECTILE_TARGET_POLICY_ID
                            .PLAYER_DAMAGEABLE_AND_TERRAIN
                    || metadataRevision !== entry.committedMetadataRevision
                    || !currentView
                    || currentView.kindId !== 'projectile'
                    || currentView.metadataRevision !== metadataRevision
                    || currentMetadata?.teamId !== record.teamId
                    || currentMetadata?.allegiancePolicy
                        !== record.allegiancePolicy
                    || currentMetadata?.damagePolicyId
                        !== record.damagePolicyId
                    || currentMetadata?.targetPolicyId
                        !== record.targetPolicyId
                    || currentMetadata?.targetEntityId
                        !== (targetHandle?.entityId ?? null)
                    || currentMetadata?.targetIncarnation
                        !== (targetHandle?.incarnation ?? null)
                    || currentMetadata?.ownerEntityId
                        !== entry.captorHandle.entityId
                    || currentMetadata?.ownerIncarnation
                        !== entry.captorHandle.incarnation
                    || currentMetadata?.sourceEntityId
                        !== entry.captorHandle.entityId
                    || currentMetadata?.sourceIncarnation
                        !== entry.captorHandle.incarnation
                    || !hasExactReleasedMetadataShape(
                        currentMetadata,
                        entry.expectedMetadata
                    )
                    || PROJECTILE_ORIGIN_PROVENANCE_KEYS.some((key) => (
                        currentMetadata?.[key] !== entry.expectedMetadata[key]
                    ))) {
                    throw new RangeError('release completion proof가 committed state와 다릅니다.');
                }
                nextEntries.delete(projectileKey);
                nextCaptorSlots.delete(entry.captorKey);
                completedSequences.set(projectileKey, captureSequence);
            }
        } catch (error) {
            return this.#fail('projectile-release-completion-validation', error.message);
        }
        this.capturedByProjectileKey = nextEntries;
        this.projectileKeyByCaptorKey = nextCaptorSlots;
        for (const [projectileKey, captureSequence] of completedSequences) {
            this.#rememberCompletedSequence(projectileKey, captureSequence);
        }
        this.lastCompletedReleaseTick = completedThroughTick;
        this.completedReleaseFingerprintByTick.set(
            snapshot.sourceTick,
            snapshot.batchIdFingerprint
        );
        while (this.completedReleaseFingerprintByTick.size > this.capacity) {
            const oldest = this.completedReleaseFingerprintByTick.keys().next().value;
            this.completedReleaseFingerprintByTick.delete(oldest);
        }
        this.#refreshTerminalFlags({});
        return Object.freeze({
            accepted: true,
            pending: false,
            releaseCount: snapshot.releaseCompletions.length,
            capturedProjectileCount: this.capturedByProjectileKey.size
        });
    }

    observeCompletedEvents(snapshot) {
        if (this.destroyed || !snapshot || !Array.isArray(snapshot.events)) {
            return this.#fail('projectile-capture-event-contract');
        }
        if (snapshot.protocolFailure) {
            return this.#fail(
                snapshot.protocolFailure.code ?? 'projectile-capture-event-protocol'
            );
        }
        const invalidFingerprints = new Set();
        const nextEntries = new Map(this.capturedByProjectileKey);
        const nextCaptorSlots = new Map(this.projectileKeyByCaptorKey);
        const completedSequences = [];
        try {
            const coreImpactReceiptByCaptorKey
                = this.#collectCoreImpactReceipts(snapshot.events, nextEntries);
            for (const [captorKey, coreImpactReceipt]
                of coreImpactReceiptByCaptorKey) {
                const projectileKey = nextCaptorSlots.get(captorKey);
                const held = projectileKey
                    ? nextEntries.get(projectileKey)
                    : null;
                if (!held
                    || held.state !== CAPTURE_STATE.RELEASE_PENDING
                    || held.releaseReason
                        !== GPU_PROJECTILE_CAPTURE_RELEASE_REASON
                            .CAPTOR_CORE_IMPACT
                    || held.prepareSourceTick !== coreImpactReceipt.sourceTick) {
                    throw new RangeError(
                        'core-impact receipt와 GPU CORE prepare가 결합되지 않습니다.'
                    );
                }
                nextEntries.set(projectileKey, Object.freeze({
                    ...held,
                    coreImpactReceipt
                }));
            }
            for (const event of snapshot.events) {
                if (event?.type !== 'death' || isReplayDisposition(event)) {
                    continue;
                }
                const deadHandle = normalizeHandle(event, 'projectileCaptureDeath');
                const deadKey = handleKey(deadHandle);
                const deadProjectile = nextEntries.get(deadKey);
                if (deadProjectile) {
                    if (deadProjectile.batchIdFingerprint > 0) {
                        invalidFingerprints.add(deadProjectile.batchIdFingerprint);
                    }
                    nextEntries.delete(deadKey);
                    nextCaptorSlots.delete(deadProjectile.captorKey);
                    completedSequences.push({
                        projectileKey: deadKey,
                        captureSequence: deadProjectile.captureSequence
                    });
                    continue;
                }
                const projectileKey = nextCaptorSlots.get(deadKey);
                if (!projectileKey) {
                    continue;
                }
                const held = nextEntries.get(projectileKey);
                if (held?.state !== CAPTURE_STATE.RELEASE_PENDING
                    || (held.releaseReason
                            !== GPU_PROJECTILE_CAPTURE_RELEASE_REASON
                                .CAPTOR_DEATH
                        && held.releaseReason
                            !== GPU_PROJECTILE_CAPTURE_RELEASE_REASON
                                .CAPTOR_CORE_IMPACT)) {
                    throw new RangeError(
                        'captor death에는 DEATH/CORE release prepare가 필요합니다.'
                    );
                }
                if (event.sessionGeneration !== this.sessionGeneration
                    || event.deviceGeneration !== this.deviceGeneration
                    || event.authoritativeEpoch !== this.authoritativeEpoch
                    || event.sourceTick !== held.prepareSourceTick) {
                    throw new RangeError(
                        'captor death event protocol이 release prepare와 다릅니다.'
                    );
                }
                nextEntries.set(projectileKey, Object.freeze({
                    ...held,
                    deathEventAuthenticated: true
                }));
            }
            for (const entry of nextEntries.values()) {
                if (entry.state === CAPTURE_STATE.RELEASE_PENDING
                    && entry.releaseReason
                        === GPU_PROJECTILE_CAPTURE_RELEASE_REASON
                            .CAPTOR_CORE_IMPACT
                    && entry.coreImpactReceipt === null) {
                    throw new RangeError(
                        'GPU CORE prepare에 coherent core-impact receipt가 없습니다.'
                    );
                }
                if (entry.state === CAPTURE_STATE.RELEASE_PENDING
                    && entry.releaseReason
                        === GPU_PROJECTILE_CAPTURE_RELEASE_REASON.CAPTOR_DEATH
                    && entry.deathEventAuthenticated !== true) {
                    throw new RangeError(
                        'GPU DEATH prepare에 coherent captor death event가 없습니다.'
                    );
                }
            }
        } catch (error) {
            return this.#fail('projectile-capture-event-validation', error.message);
        }
        for (const fingerprint of invalidFingerprints) {
            const discarded = this.commandPort.discardPreparedBatch({
                batchIdFingerprint: fingerprint
            });
            if (discarded?.accepted !== true
                && discarded?.requiresRecovery === true) {
                return this.#fail('projectile-capture-death-discard', discarded.reason);
            }
            this.#resetPreparedPeers(nextEntries, fingerprint);
        }
        this.capturedByProjectileKey = nextEntries;
        this.projectileKeyByCaptorKey = nextCaptorSlots;
        for (const completed of completedSequences) {
            this.#rememberCompletedSequence(
                completed.projectileKey,
                completed.captureSequence
            );
        }
        this.#refreshTerminalFlags({});
        return Object.freeze({
            accepted: true,
            capturedProjectileCount: this.capturedByProjectileKey.size
        });
    }

    stageForFixedTick({ targetFixedTick, towerTargetHandle = null } = {}) {
        if (this.destroyed || !this.ingressOpen || this.recoveryRequired) {
            return Object.freeze({
                accepted: false,
                reason: this.terminal
                    ? 'projectile-capture-terminal-closed'
                    : 'projectile-capture-unavailable',
                requiresRecovery: false
            });
        }
        const tick = requirePositiveUint32(targetFixedTick, 'targetFixedTick');
        const normalizedTowerTarget = towerTargetHandle === null
            ? null
            : normalizeHandle(towerTargetHandle, 'towerTargetHandle');
        if (tick < this.lastStageTick) {
            return this.#fail('projectile-capture-stage-tick-regression');
        }
        if (tick === this.lastStageTick && this.lastStageResult !== null) {
            return Object.freeze({ ...this.lastStageResult, replayed: true });
        }
        const due = [...this.capturedByProjectileKey.values()]
            .filter((entry) => entry.state === CAPTURE_STATE.RELEASE_PENDING)
            .sort((left, right) => (
                left.prepareSourceTick - right.prepareSourceTick
                || left.batchIdFingerprint - right.batchIdFingerprint
                || left.projectileHandle.entityId - right.projectileHandle.entityId
                || left.projectileHandle.incarnation
                    - right.projectileHandle.incarnation
            ));
        const groups = new Map();
        for (const entry of due) {
            if (entry.prepareSourceTick + 1 < tick) {
                return this.#fail('projectile-capture-release-publication-deadline');
            }
            if (entry.prepareSourceTick + 1 !== tick) {
                continue;
            }
            const key = `${entry.prepareSourceTick}:${entry.batchIdFingerprint}`;
            const group = groups.get(key) ?? [];
            group.push(entry);
            groups.set(key, group);
        }
        if (groups.size > 1) {
            return this.#fail('projectile-capture-release-batch-fragmentation');
        }
        let requestedCount = 0;
        const commandIds = [];
        for (const entries of groups.values()) {
            const first = entries[0];
            const towerTargets = new Map();
            let stalePreparedTower = false;
            for (const entry of entries) {
                const resolved = this.#resolveReleaseTowerTarget(
                    entry,
                    normalizedTowerTarget
                );
                if (resolved.accepted !== true) {
                    stalePreparedTower = true;
                    break;
                }
                towerTargets.set(entry.projectileKey, resolved.targetHandle);
            }
            if (stalePreparedTower) {
                const discarded = this.commandPort.discardPreparedBatch({
                    batchIdFingerprint: first.batchIdFingerprint
                });
                if (discarded?.accepted !== true
                    && discarded?.requiresRecovery === true) {
                    return this.#fail(
                        'projectile-capture-stale-tower-discard',
                        discarded.reason
                    );
                }
                this.#resetPreparedPeers(
                    this.capturedByProjectileKey,
                    first.batchIdFingerprint
                );
                return Object.freeze({
                    accepted: false,
                    reason: 'projectile-capture-release-target-stale',
                    requiresRecovery: false
                });
            }
            const commandId = [
                'ring-projectile-capture-release',
                this.sessionGeneration,
                first.prepareSourceTick,
                first.batchIdFingerprint
            ].join(':');
            const records = entries.map((entry) => Object.freeze({
                projectileHandle: entry.projectileHandle,
                captorHandle: entry.captorHandle,
                captureSequence: entry.captureSequence,
                releaseReason: entry.releaseReason,
                expectedMetadata: entry.expectedMetadata,
                expectedMetadataRevision: entry.expectedMetadataRevision,
                towerTargetHandle: towerTargets.get(entry.projectileKey),
                prepareEvidence: entry.prepareEvidence,
                coreImpactReceipt: entry.coreImpactReceipt
            }));
            const receipt = this.commandPort.requestPreparedReleaseBatch({
                commandId,
                prepareSourceTick: first.prepareSourceTick,
                targetFixedTick: tick,
                batchIdFingerprint: first.batchIdFingerprint,
                records: Object.freeze(records)
            });
            if (receipt?.accepted !== true) {
                if (receipt?.requiresRecovery === true) {
                    return this.#fail(
                        'projectile-capture-release-request',
                        receipt.reason
                    );
                }
                const discarded = this.commandPort.discardPreparedBatch({
                    batchIdFingerprint: first.batchIdFingerprint
                });
                if (discarded?.accepted !== true
                    && discarded?.requiresRecovery === true) {
                    return this.#fail(
                        'projectile-capture-release-request-discard',
                        discarded.reason
                    );
                }
                this.#resetPreparedPeers(
                    this.capturedByProjectileKey,
                    first.batchIdFingerprint
                );
                return Object.freeze({
                    ...receipt,
                    accepted: false,
                    requiresRecovery: false
                });
            }
            if (receipt.commandId !== commandId) {
                return this.#fail('projectile-capture-release-command-id-mismatch');
            }
            let commandIdFingerprint;
            try {
                commandIdFingerprint = requirePositiveUint32(
                    receipt.commandIdFingerprint,
                    'releaseReceipt.commandIdFingerprint'
                );
            } catch (error) {
                return this.#fail(
                    'projectile-capture-release-command-fingerprint',
                    error.message
                );
            }
            const projectileKeys = entries.map((entry) => entry.projectileKey);
            this.pendingBatchesByCommandId.set(commandId, Object.freeze({
                commandId,
                targetFixedTick: tick,
                prepareSourceTick: first.prepareSourceTick,
                batchIdFingerprint: first.batchIdFingerprint,
                commandIdFingerprint,
                projectileKeys: Object.freeze(projectileKeys)
            }));
            for (const entry of entries) {
                this.capturedByProjectileKey.set(entry.projectileKey, Object.freeze({
                    ...entry,
                    state: CAPTURE_STATE.RELEASE_REQUESTED,
                    requestedTargetHandle:
                        towerTargets.get(entry.projectileKey),
                    commandIdFingerprint,
                    commandId
                }));
            }
            requestedCount += entries.length;
            commandIds.push(commandId);
        }
        this.lastStageTick = tick;
        this.lastStageResult = Object.freeze({
            accepted: true,
            targetFixedTick: tick,
            releaseCount: requestedCount,
            commandIds: Object.freeze(commandIds)
        });
        return this.lastStageResult;
    }

    observeFixedCommit(commit, fixedTick) {
        const tick = requirePositiveUint32(fixedTick, 'fixedTick');
        if (!commit || commit.fixedTick !== tick) {
            return this.#fail('projectile-capture-fixed-commit-contract');
        }
        if (tick < this.lastFixedCommitTick) {
            return this.#fail('projectile-capture-fixed-commit-regression');
        }
        this.lastFixedCommitTick = tick;
        if (this.terminal?.finalFixedTick === tick) {
            this.#refreshTerminalFlags({ fixedCommitObserved: true });
        }
        return this.getStatus();
    }

    observeLifecycle(commit, fixedTick = commit?.fixedTick) {
        if (this.destroyed) {
            return this.getStatus();
        }
        const tick = requirePositiveUint32(fixedTick, 'fixedTick');
        if (!commit
            || commit.fixedTick !== tick
            || !Array.isArray(commit.projectileCaptureReleases)
            || !Array.isArray(commit.despawned)
            || !Array.isArray(commit.rejected)
            || commit.recoveryRequired === true) {
            return this.#fail('projectile-capture-lifecycle-contract');
        }
        if (this.observedLifecycleCommits.has(commit)) {
            return this.getStatus();
        }
        if (tick < this.lastObservedFixedTick) {
            return this.#fail('projectile-capture-lifecycle-regression');
        }
        const nextEntries = new Map(this.capturedByProjectileKey);
        const nextCaptorSlots = new Map(this.projectileKeyByCaptorKey);
        const nextPendingBatches = new Map(this.pendingBatchesByCommandId);
        const nextTerminalCleanup
            = new Map(this.pendingTerminalCleanupByCommandId);
        const completedSequences = [];
        try {
            for (const [commandId, pending] of nextPendingBatches) {
                if (pending.targetFixedTick !== tick) {
                    continue;
                }
                const releases = commit.projectileCaptureReleases.filter(
                    (entry) => entry.commandId === commandId
                );
                const rejection = commit.rejected.find(
                    (entry) => entry.commandId === commandId
                );
                if (rejection) {
                    const discarded = this.commandPort.discardPreparedBatch({
                        batchIdFingerprint: pending.batchIdFingerprint
                    });
                    if (discarded?.accepted !== true
                        && discarded?.requiresRecovery === true) {
                        throw new RangeError(
                            `release discard failed: ${discarded.reason}`
                        );
                    }
                    const staleIndex = Number.isInteger(rejection.recordIndex)
                        ? rejection.recordIndex
                        : -1;
                    for (let index = 0;
                        index < pending.projectileKeys.length;
                        index++) {
                        const projectileKey = pending.projectileKeys[index];
                        const entry = nextEntries.get(projectileKey);
                        if (!entry) {
                            continue;
                        }
                        if (index === staleIndex
                            && rejection.code
                                === 'projectile-capture-release-stale') {
                            nextEntries.delete(projectileKey);
                            nextCaptorSlots.delete(entry.captorKey);
                            completedSequences.push({
                                projectileKey,
                                captureSequence: entry.captureSequence
                            });
                        } else {
                            nextEntries.set(
                                projectileKey,
                                this.#clearPreparedEntry(entry)
                            );
                        }
                    }
                    nextPendingBatches.delete(commandId);
                    if (rejection.retryable !== true
                        && rejection.code
                            !== 'projectile-capture-release-stale'
                        && rejection.code
                            !== 'projectile-capture-release-target-unsupported') {
                        throw new RangeError(
                            `release lifecycle rejection: ${rejection.code}`
                        );
                    }
                    continue;
                }
                if (releases.length !== pending.projectileKeys.length) {
                    throw new RangeError('release lifecycle result count가 다릅니다.');
                }
                const releasedProjectileKeys = new Set();
                for (const release of releases) {
                    const projectileHandle = normalizeHandle(
                        release.projectileHandle,
                        'lifecycleRelease.projectileHandle'
                    );
                    const projectileKey = handleKey(projectileHandle);
                    const captorHandle = normalizeHandle(
                        release.captorHandle,
                        'lifecycleRelease.captorHandle'
                    );
                    const captureSequence = requirePositiveUint32(
                        release.captureSequence,
                        'lifecycleRelease.captureSequence'
                    );
                    const metadataRevision = requirePositiveUint32(
                        release.metadataRevision,
                        'lifecycleRelease.metadataRevision'
                    );
                    const registryRevision = requirePositiveUint32(
                        release.registryRevision,
                        'lifecycleRelease.registryRevision'
                    );
                    const commandIdFingerprint = requirePositiveUint32(
                        release.commandIdFingerprint,
                        'lifecycleRelease.commandIdFingerprint'
                    );
                    const batchIdFingerprint = requirePositiveUint32(
                        release.batchIdFingerprint,
                        'lifecycleRelease.batchIdFingerprint'
                    );
                    const prepareFingerprint = requirePositiveUint32(
                        release.prepareFingerprint,
                        'lifecycleRelease.prepareFingerprint'
                    );
                    const targetHandle = release.targetHandle === null
                        ? null
                        : normalizeHandle(
                            release.targetHandle,
                            'lifecycleRelease.targetHandle'
                        );
                    if (releasedProjectileKeys.has(projectileKey)) {
                        throw new RangeError('release lifecycle handle이 중복됐습니다.');
                    }
                    releasedProjectileKeys.add(projectileKey);
                    const entry = nextEntries.get(projectileKey);
                    if (!entry
                        || entry.commandId !== commandId
                        || !sameHandle(entry.captorHandle, captorHandle)
                        || entry.captureSequence !== captureSequence
                        || entry.releaseReason !== release.releaseReason
                        || commandIdFingerprint
                            !== pending.commandIdFingerprint
                        || commandIdFingerprint
                            !== entry.commandIdFingerprint
                        || batchIdFingerprint
                            !== pending.batchIdFingerprint
                        || batchIdFingerprint
                            !== entry.batchIdFingerprint
                        || prepareFingerprint
                            !== entry.prepareEvidence.prepareFingerprint
                        || pending.prepareSourceTick
                            !== release.prepareSourceTick
                        || pending.targetFixedTick !== release.targetFixedTick
                        || !sameHandle(
                            entry.requestedTargetHandle,
                            targetHandle
                        )
                        || release.backendCommitRequested !== true) {
                        throw new RangeError('release lifecycle identity/proof가 다릅니다.');
                    }
                    const currentView = this.registry.copyEntityView(
                        projectileHandle,
                        {}
                    );
                    const currentMetadata = currentView?.metadata;
                    if (!currentView
                        || currentView.kindId !== 'projectile'
                        || currentView.metadataRevision !== metadataRevision
                        || currentMetadata?.teamId !== GAMEPLAY_TEAM_ID.HOSTILE
                        || currentMetadata?.allegiancePolicy
                            !== GAMEPLAY_ALLEGIANCE_POLICY.FIXED_HOSTILE
                        || currentMetadata?.damagePolicyId
                            !== entry.expectedMetadata.damagePolicyId
                        || currentMetadata?.ownerEntityId
                            !== entry.captorHandle.entityId
                        || currentMetadata?.ownerIncarnation
                            !== entry.captorHandle.incarnation
                        || currentMetadata?.sourceEntityId
                            !== entry.captorHandle.entityId
                        || currentMetadata?.sourceIncarnation
                            !== entry.captorHandle.incarnation
                        || currentMetadata?.targetEntityId
                            !== (targetHandle?.entityId ?? null)
                        || currentMetadata?.targetIncarnation
                            !== (targetHandle?.incarnation ?? null)
                        || currentMetadata?.targetPolicyId
                            !== PROJECTILE_TARGET_POLICY_ID
                                .PLAYER_DAMAGEABLE_AND_TERRAIN
                        || PROJECTILE_ORIGIN_PROVENANCE_KEYS.some((key) => (
                            currentMetadata?.[key]
                                !== entry.expectedMetadata[key]
                        ))) {
                        throw new RangeError(
                            'release lifecycle current metadata proof가 다릅니다.'
                        );
                    }
                    nextEntries.set(projectileKey, Object.freeze({
                        ...entry,
                        state: CAPTURE_STATE.RELEASE_COMMITTED,
                        committedTargetFixedTick: release.targetFixedTick,
                        committedTargetHandle: targetHandle,
                        committedMetadataRevision: metadataRevision,
                        committedRegistryRevision: registryRevision
                    }));
                }
                nextPendingBatches.delete(commandId);
            }
            for (const [commandId, pending]
                of nextTerminalCleanup) {
                if (pending.targetFixedTick !== tick) {
                    continue;
                }
                const despawned = commit.despawned.filter(
                    (entry) => entry.commandId === commandId
                );
                const rejection = commit.rejected.find(
                    (entry) => entry.commandId === commandId
                );
                if (rejection || despawned.length !== 1) {
                    throw new RangeError(
                        `terminal held cleanup 결과가 없습니다: ${rejection?.code}`
                    );
                }
                const removedHandle = normalizeHandle(
                    despawned[0].handle,
                    'terminalCleanup.handle'
                );
                if (!sameHandle(removedHandle, pending.projectileHandle)
                    || despawned[0].reason
                        !== 'projectile-capture-terminal-held-unpublished'
                    || despawned[0].disposition
                        !== 'projectile-capture-terminal-held-unpublished') {
                    throw new RangeError('terminal held cleanup proof가 다릅니다.');
                }
                const entry = nextEntries.get(
                    pending.projectileKey
                );
                if (!entry
                    || entry.state
                        !== CAPTURE_STATE.TERMINAL_CLEANUP_REQUESTED
                    || entry.commandId !== commandId
                    || entry.captureSequence !== pending.captureSequence) {
                    throw new RangeError('terminal held cleanup roster가 다릅니다.');
                }
                nextEntries.delete(pending.projectileKey);
                nextCaptorSlots.delete(entry.captorKey);
                completedSequences.push({
                    projectileKey: pending.projectileKey,
                    captureSequence: pending.captureSequence
                });
                nextTerminalCleanup.delete(commandId);
            }
        } catch (error) {
            return this.#fail('projectile-capture-lifecycle-validation', error.message);
        }
        this.capturedByProjectileKey = nextEntries;
        this.projectileKeyByCaptorKey = nextCaptorSlots;
        this.pendingBatchesByCommandId = nextPendingBatches;
        this.pendingTerminalCleanupByCommandId = nextTerminalCleanup;
        for (const completed of completedSequences) {
            this.#rememberCompletedSequence(
                completed.projectileKey,
                completed.captureSequence
            );
        }
        this.observedLifecycleCommits.add(commit);
        this.lastObservedFixedTick = tick;
        if (this.terminal?.finalFixedTick === tick) {
            this.#refreshTerminalFlags({ lifecycleObserved: true });
        }
        return this.getStatus();
    }

    closeForTerminal(finalFixedTick, reason = 'run-defeated') {
        if (this.destroyed) {
            return null;
        }
        const tick = requirePositiveUint32(finalFixedTick, 'finalFixedTick');
        if (this.terminal) {
            if (this.terminal.finalFixedTick !== tick) {
                this.#fail('projectile-capture-terminal-tick-conflict');
            }
            return this.terminal;
        }
        if (this.lastFixedCommitTick > tick
            || this.lastObservedFixedTick > tick) {
            this.#fail('projectile-capture-terminal-tick-regression');
            return null;
        }
        this.ingressOpen = false;
        const fixedCommitObserved = this.lastFixedCommitTick === tick;
        const lifecycleObserved = this.lastObservedFixedTick === tick;
        this.terminal = Object.freeze({
            finalFixedTick: tick,
            reason: typeof reason === 'string' && reason.length > 0
                ? reason
                : 'run-defeated',
            cleanupRequestedCount: 0,
            publishedReleaseCount: 0,
            fixedCommitObserved,
            lifecycleObserved,
            rosterSealed: false
        });
        const fingerprints = new Set();
        for (const entry of this.capturedByProjectileKey.values()) {
            if (entry.state !== CAPTURE_STATE.RELEASE_COMMITTED
                && entry.batchIdFingerprint > 0) {
                fingerprints.add(entry.batchIdFingerprint);
            }
        }
        for (const fingerprint of fingerprints) {
            const discarded = this.commandPort.discardPreparedBatch({
                batchIdFingerprint: fingerprint
            });
            if (discarded?.accepted !== true
                && discarded?.requiresRecovery === true) {
                this.#fail(
                    'projectile-capture-terminal-prepared-discard',
                    discarded.reason
                );
                return this.terminal;
            }
        }
        let cleanupRequestedCount = 0;
        let publishedReleaseCount = 0;
        const entries = [...this.capturedByProjectileKey.values()].sort(
            (left, right) => (
                left.projectileHandle.entityId
                    - right.projectileHandle.entityId
                || left.projectileHandle.incarnation
                    - right.projectileHandle.incarnation
            )
        );
        for (const entry of entries) {
            if (entry.state === CAPTURE_STATE.RELEASE_COMMITTED) {
                publishedReleaseCount++;
                continue;
            }
            const proposedCommandId = [
                'ring-projectile-capture-terminal',
                this.sessionGeneration,
                tick,
                entry.projectileHandle.entityId,
                entry.projectileHandle.incarnation,
                entry.captureSequence
            ].join(':');
            const receipt = this.commandPort
                .requestTerminalHeldProjectileDespawn({
                    handle: entry.projectileHandle,
                    targetFixedTick: tick,
                    commandId: proposedCommandId
                });
            const authenticDuplicate = receipt?.accepted === false
                && receipt.reason === 'duplicate-despawn'
                && receipt.authenticTerminalCleanup === true
                && receipt.targetFixedTick === tick;
            if (receipt?.accepted !== true && !authenticDuplicate) {
                this.#fail(
                    'projectile-capture-terminal-cleanup-request',
                    receipt?.reason
                );
                return this.terminal;
            }
            const commandId = requireNonEmptyString(
                receipt.commandId,
                'terminalCleanup.commandId'
            );
            if (this.pendingTerminalCleanupByCommandId.has(commandId)) {
                this.#fail('projectile-capture-terminal-command-conflict');
                return this.terminal;
            }
            this.pendingTerminalCleanupByCommandId.set(commandId, Object.freeze({
                commandId,
                targetFixedTick: tick,
                projectileKey: entry.projectileKey,
                projectileHandle: entry.projectileHandle,
                captureSequence: entry.captureSequence
            }));
            this.capturedByProjectileKey.set(entry.projectileKey, Object.freeze({
                ...entry,
                state: CAPTURE_STATE.TERMINAL_CLEANUP_REQUESTED,
                commandId
            }));
            cleanupRequestedCount++;
        }
        // 이미 lifecycle ingress에 실린 release command는 terminal despawn보다 뒤에서
        // stale 처리됩니다. Director는 terminal cleanup command만 authoritative하게
        // 관찰하며, registry/backend에 published된 release만 readback까지 보존합니다.
        this.pendingBatchesByCommandId.clear();
        this.terminal = Object.freeze({
            ...this.terminal,
            cleanupRequestedCount,
            publishedReleaseCount
        });
        this.#refreshTerminalFlags({});
        return this.terminal;
    }

    resetGpuBinding(
        registry,
        projectileCaptureCommandPort,
        sessionGeneration,
        deviceGeneration,
        authoritativeEpoch
    ) {
        if (this.destroyed
            || this.recoveryRequired
            || this.failure !== null
            || this.terminal !== null
            || !this.ingressOpen
            || this.capturedByProjectileKey.size !== 0
            || this.projectileKeyByCaptorKey.size !== 0
            || this.pendingBatchesByCommandId.size !== 0
            || this.pendingTerminalCleanupByCommandId.size !== 0) {
            return false;
        }
        this.registry = assertRegistry(registry);
        this.commandPort = assertCommandPort(projectileCaptureCommandPort);
        this.sessionGeneration = requirePositiveUint32(
            sessionGeneration,
            'sessionGeneration'
        );
        this.deviceGeneration = requireNonNegativeUint32(
            deviceGeneration,
            'deviceGeneration'
        );
        this.authoritativeEpoch = requireNonNegativeUint32(
            authoritativeEpoch,
            'authoritativeEpoch'
        );
        this.capturedByProjectileKey.clear();
        this.projectileKeyByCaptorKey.clear();
        this.pendingBatchesByCommandId.clear();
        this.pendingTerminalCleanupByCommandId.clear();
        this.completedSequenceByProjectileKey.clear();
        this.completedSequenceKeys.length = 0;
        this.completedCaptureFingerprintByTick.clear();
        this.completedReleaseFingerprintByTick.clear();
        this.observedLifecycleCommits = new WeakSet();
        this.lastCompletedCaptureTick = 0;
        this.lastCompletedReleaseTick = 0;
        this.lastFixedCommitTick = 0;
        this.lastObservedFixedTick = 0;
        this.lastStageTick = 0;
        this.lastStageResult = null;
        this.recoveryRequired = false;
        this.failure = null;
        this.ingressOpen = true;
        this.terminal = null;
        return true;
    }

    requiresRecovery() {
        return !this.destroyed && this.recoveryRequired;
    }

    getStatus() {
        let releasePendingCount = 0;
        let pendingReadbackCount = 0;
        let heldCount = 0;
        let terminalCleanupPendingCount = 0;
        for (const entry of this.capturedByProjectileKey.values()) {
            if (entry.state === CAPTURE_STATE.HELD) {
                heldCount++;
            } else if (entry.state === CAPTURE_STATE.RELEASE_COMMITTED) {
                pendingReadbackCount++;
            } else if (entry.state
                === CAPTURE_STATE.TERMINAL_CLEANUP_REQUESTED) {
                terminalCleanupPendingCount++;
            } else {
                releasePendingCount++;
            }
        }
        return Object.freeze({
            capturedProjectileCount: this.capturedByProjectileKey.size,
            heldCount,
            releasePendingCount,
            pendingBatchCount: this.pendingBatchesByCommandId.size,
            terminalCleanupPendingCount,
            pendingReadbackCount,
            pendingStaleCompletionCount: 0,
            lastCompletedCaptureTick: this.lastCompletedCaptureTick,
            lastCompletedReleaseTick: this.lastCompletedReleaseTick,
            lastFixedCommitTick: this.lastFixedCommitTick,
            lastObservedFixedTick: this.lastObservedFixedTick,
            sessionGeneration: this.sessionGeneration,
            deviceGeneration: this.deviceGeneration,
            authoritativeEpoch: this.authoritativeEpoch,
            recoveryRequired: this.recoveryRequired,
            failure: this.failure,
            terminal: this.terminal,
            destroyed: this.destroyed
        });
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.capturedByProjectileKey.clear();
        this.projectileKeyByCaptorKey.clear();
        this.pendingBatchesByCommandId.clear();
        this.pendingTerminalCleanupByCommandId.clear();
        this.completedSequenceByProjectileKey.clear();
        this.completedSequenceKeys.length = 0;
        this.completedCaptureFingerprintByTick.clear();
        this.completedReleaseFingerprintByTick.clear();
        this.registry = null;
        this.commandPort = null;
        this.terminal = null;
    }

    #resetPreparedPeers(entries, fingerprint) {
        for (const [key, entry] of entries) {
            if (entry.batchIdFingerprint === fingerprint
                && entry.state !== CAPTURE_STATE.RELEASE_COMMITTED) {
                entries.set(key, this.#clearPreparedEntry(entry));
            }
        }
    }

    #clearPreparedEntry(entry) {
        return Object.freeze({
            ...entry,
            state: CAPTURE_STATE.HELD,
            prepareSourceTick: 0,
            batchIdFingerprint: 0,
            releaseReason: 0,
            prepareEvidence: null,
            coreImpactReceipt: null,
            deathEventAuthenticated: false,
            committedTargetFixedTick: 0,
            committedTargetHandle: null,
            committedMetadataRevision: 0,
            committedRegistryRevision: 0,
            requestedTargetHandle: null,
            commandIdFingerprint: 0,
            commandId: null
        });
    }

    #assertAuthenticatedCompletionHeader(snapshot, label) {
        if (snapshot.abiVersion
                !== GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION
            || snapshot.sessionGeneration !== this.sessionGeneration
            || snapshot.deviceGeneration !== this.deviceGeneration
            || snapshot.authoritativeEpoch !== this.authoritativeEpoch
            || typeof snapshot.pending !== 'boolean') {
            throw new RangeError(`${label} binding/header가 current session과 다릅니다.`);
        }
        requireNonNegativeUint32(snapshot.sourceTick, `${label}.sourceTick`);
        requireNonNegativeUint32(
            snapshot.completedThroughTick,
            `${label}.completedThroughTick`
        );
        requireNonNegativeUint32(snapshot.status, `${label}.status`);
        requireNonNegativeUint32(snapshot.errorFlags, `${label}.errorFlags`);
        requireNonNegativeUint32(
            snapshot.batchIdFingerprint,
            `${label}.batchIdFingerprint`
        );
    }

    #resolveReleaseTowerTarget(entry, currentTowerHandle) {
        if (entry.releaseReason
            !== GPU_PROJECTILE_CAPTURE_RELEASE_REASON.NORMAL_DUE) {
            return Object.freeze({ accepted: true, targetHandle: null });
        }
        if (entry.prepareEvidence?.targetSelector
            !== GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR.TOWER) {
            return Object.freeze({ accepted: true, targetHandle: null });
        }
        const preparedTower = normalizeHandle(
            entry.prepareEvidence.targetHandle,
            'prepareEvidence.targetHandle'
        );
        const current = currentTowerHandle !== null
            && sameHandle(preparedTower, currentTowerHandle)
            ? this.registry.copyEntityView(currentTowerHandle, {})
            : null;
        if (!current || current.kindId !== 'tower') {
            return Object.freeze({ accepted: false, targetHandle: null });
        }
        return Object.freeze({
            accepted: true,
            targetHandle: currentTowerHandle
        });
    }

    #collectCoreImpactReceipts(events, entries) {
        const receipts = new Map();
        for (const event of events) {
            if (!Object.isFrozen(event)
                || event?.type !== 'contact'
                || event?.eventType !== 'interaction-enter'
                || event?.disposition !== 'applied') {
                continue;
            }
            let subjectHandle;
            let otherHandle;
            try {
                subjectHandle = normalizeHandle(event, 'coreImpact.subject');
                otherHandle = normalizeHandle(event.other, 'coreImpact.other');
            } catch {
                continue;
            }
            const subjectKey = handleKey(subjectHandle);
            const otherKey = handleKey(otherHandle);
            const subjectProjectileKey
                = this.projectileKeyByCaptorKey.get(subjectKey);
            const otherProjectileKey
                = this.projectileKeyByCaptorKey.get(otherKey);
            const captorKey = subjectProjectileKey
                ? subjectKey
                : otherProjectileKey
                    ? otherKey
                    : null;
            const projectileKey = subjectProjectileKey ?? otherProjectileKey;
            if (captorKey === null || !projectileKey) {
                continue;
            }
            const entry = entries.get(projectileKey);
            if (!entry) {
                continue;
            }
            const coreHandle = captorKey === subjectKey
                ? otherHandle
                : subjectHandle;
            const coreView = this.registry.copyEntityView(coreHandle, {});
            if (!coreView
                || coreView.kindId !== GPU_CORE_PROXY_WORLD_KIND_ID
                || coreView.definitionId !== GPU_CORE_PROXY_DEFINITION_ID) {
                continue;
            }
            if (event.sessionGeneration !== this.sessionGeneration
                || event.deviceGeneration !== this.deviceGeneration
                || event.authoritativeEpoch !== this.authoritativeEpoch
                || event.sourceTick !== entry.prepareSourceTick) {
                throw new RangeError(
                    'core-impact receipt protocol이 release prepare와 다릅니다.'
                );
            }
            if (receipts.has(captorKey)) {
                throw new RangeError('core-impact receipt가 exact captor에 중복됐습니다.');
            }
            receipts.set(captorKey, event);
        }
        return receipts;
    }

    #rememberCompletedSequence(projectileKey, captureSequence) {
        this.completedSequenceByProjectileKey.set(projectileKey, captureSequence);
        this.completedSequenceKeys.push(projectileKey);
        while (this.completedSequenceKeys.length > this.capacity) {
            const forgotten = this.completedSequenceKeys.shift();
            if (forgotten !== undefined
                && !this.completedSequenceKeys.includes(forgotten)) {
                this.completedSequenceByProjectileKey.delete(forgotten);
            }
        }
    }

    #refreshTerminalFlags(overrides) {
        if (!this.terminal) {
            return;
        }
        const fixedCommitObserved = overrides.fixedCommitObserved
            ?? this.terminal.fixedCommitObserved;
        const lifecycleObserved = overrides.lifecycleObserved
            ?? this.terminal.lifecycleObserved;
        const rosterZero = this.capturedByProjectileKey.size === 0
            && this.pendingBatchesByCommandId.size === 0
            && this.pendingTerminalCleanupByCommandId.size === 0;
        this.terminal = Object.freeze({
            ...this.terminal,
            ...overrides,
            fixedCommitObserved,
            lifecycleObserved,
            rosterSealed: fixedCommitObserved && lifecycleObserved && rosterZero
        });
    }

    #fail(code, message = null) {
        this.recoveryRequired = true;
        this.failure = Object.freeze({
            code,
            ...(typeof message === 'string' && message.length > 0
                ? { message }
                : null)
        });
        return Object.freeze({
            accepted: false,
            reason: code,
            requiresRecovery: true
        });
    }
}

export const GPU_ENEMY_PROJECTILE_CAPTURE_ROSTER_PORT = Object.freeze({
    observeLifecycle: RingProjectileCaptureDirector.prototype.observeLifecycle,
    observeCompletedEvents:
        RingProjectileCaptureDirector.prototype.observeCompletedEvents,
    observeCompletedCapturePrograms:
        RingProjectileCaptureDirector.prototype.observeCompletedCapturePrograms,
    observeCompletedReleasePrograms:
        RingProjectileCaptureDirector.prototype.observeCompletedReleasePrograms,
    stageForFixedTick: RingProjectileCaptureDirector.prototype.stageForFixedTick,
    observeFixedCommit:
        RingProjectileCaptureDirector.prototype.observeFixedCommit,
    closeForTerminal:
        RingProjectileCaptureDirector.prototype.closeForTerminal
});
