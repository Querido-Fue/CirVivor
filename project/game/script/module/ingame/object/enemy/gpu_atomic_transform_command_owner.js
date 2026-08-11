import {
    GPU_ATOMIC_TRANSFORM_PREPARE_PROGRAM_ABI_VERSION,
    GPU_ATOMIC_TRANSFORM_RUNTIME_ABI_VERSION,
    GPU_ATOMIC_TRANSFORM_RUNTIME_STATUS,
    GPU_ATOMIC_TRANSFORM_TERMINAL_CANCEL_ABI_VERSION
} from '../../physics/gpu/gpu_atomic_transform_runtime_abi.js';
import {
    ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID,
    normalizeEnemyAtomicTransformTopologyId
} from '../../contract/enemy_atomic_transform_contract.js';

const INVALID_U32 = 0xffffffff;

function requirePositiveUint32(value, label) {
    if (typeof value !== 'number'
        || !Number.isSafeInteger(value)
        || value <= 0 || value >= INVALID_U32) {
        throw new RangeError(`${label}은 live uint32 범위의 양의 정수여야 합니다.`);
    }
    return value;
}

function requireUint32(value, label) {
    if (typeof value !== 'number'
        || !Number.isSafeInteger(value)
        || value < 0 || value >= INVALID_U32) {
        throw new RangeError(`${label}은 non-sentinel uint32 정수여야 합니다.`);
    }
    return value;
}

function requirePositiveSafeInteger(value, label) {
    if (typeof value !== 'number'
        || !Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${label}은 양의 안전한 정수여야 합니다.`);
    }
    return value;
}

function normalizeHandle(source, label) {
    return Object.freeze({
        entityId: requirePositiveUint32(
            source?.entityId ?? source?.sourceEntityId,
            `${label}.entityId`
        ),
        incarnation: requirePositiveUint32(
            source?.incarnation ?? source?.sourceIncarnation,
            `${label}.incarnation`
        )
    });
}

function handleKey(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

function hashValues(values) {
    let hash = 0x811c9dc5;
    for (const value of values) {
        const text = String(value);
        for (let index = 0; index < text.length; index++) {
            hash = Math.imul((hash ^ text.charCodeAt(index)) >>> 0, 0x01000193) >>> 0;
        }
        hash = Math.imul((hash ^ 0xff) >>> 0, 0x01000193) >>> 0;
    }
    if (hash === 0 || hash === INVALID_U32) {
        hash = (hash ^ 0x9e3779b9) >>> 0;
    }
    return hash === 0 || hash === INVALID_U32 ? 1 : hash;
}

function assertBackendPort(source) {
    for (const method of [
        'stageAtomicTransformPrepareBatch',
        'drainCompletedAtomicTransformPrepareBatches',
        'discardPreparedAtomicTransformBatch',
        'cancelPendingAtomicTransformProgramsForTerminal',
        'getAtomicTransformRuntimeStatus'
    ]) {
        if (typeof source?.[method] !== 'function') {
            throw new TypeError(`AtomicTransform backend port.${method}()가 필요합니다.`);
        }
    }
    return source;
}

function assertLifecyclePort(source) {
    if (typeof source?.requestAtomicTransformBatch !== 'function') {
        throw new TypeError('AtomicTransform lifecycle port.requestAtomicTransformBatch()가 필요합니다.');
    }
    return source;
}

function freezeProtocol(source) {
    return Object.freeze({
        sessionGeneration: requirePositiveUint32(
            source?.sessionGeneration,
            'prepareProtocol.sessionGeneration'
        ),
        deviceGeneration: requireUint32(
            source?.deviceGeneration,
            'prepareProtocol.deviceGeneration'
        ),
        authoritativeEpoch: requireUint32(
            source?.authoritativeEpoch,
            'prepareProtocol.authoritativeEpoch'
        ),
        submittedTick: requirePositiveUint32(
            source?.submittedTick,
            'prepareProtocol.submittedTick'
        )
    });
}

/**
 * GPU prepare receipt authority와 lifecycle request 사이의 단일 owner입니다.
 * Host metadata는 candidate scheduling에만 쓰며 prepareEvidence는 GPU readback
 * session/device/epoch/tick/fingerprint를 모두 인증한 뒤에만 발급합니다.
 */
export class GpuAtomicTransformCommandOwner {
    constructor(options = {}) {
        this.backend = assertBackendPort(options.backendPort);
        this.lifecycle = assertLifecyclePort(options.lifecyclePort);
        this.sessionGeneration = requirePositiveUint32(
            options.sessionGeneration,
            'sessionGeneration'
        );
        this.capacity = requirePositiveSafeInteger(
            options.capacity,
            'capacity'
        );
        this.transformStartCapacity = requirePositiveSafeInteger(
            options.transformStartCapacity,
            'transformStartCapacity'
        );
        if (this.transformStartCapacity > this.capacity) {
            throw new RangeError('transformStartCapacity는 world capacity를 초과할 수 없습니다.');
        }
        this.nextPrepareSequence = 1;
        this.stagedBySourceTick = new Map();
        this.completedPrepareBacklog = [];
        this.authenticByFingerprint = new Map();
        this.pendingLifecycleByCommandId = new Map();
        this.observedLifecycleCommits = new WeakSet();
        this.lastCompletedSourceTick = 0;
        this.lastCommittedTargetFixedTick = 0;
        this.failure = null;
        this.recoveryRequired = false;
        this.ingressOpen = true;
        this.terminal = null;
        this.destroyed = false;
        this.commandPort = Object.freeze({
            requestPrepareBatch: (request) => this.requestPrepareBatch(request),
            requestPreparedTransformBatch: (request) => (
                this.requestPreparedTransformBatch(request)
            ),
            discardPreparedBatch: (request) => this.discardPreparedBatch(request)
        });
    }

    getCommandPort() {
        return this.commandPort;
    }

    requestPrepareBatch({ targetFixedTick, records = [] } = {}) {
        const reject = (reason, requiresRecovery = false) => Object.freeze({
            accepted: false, reason, requiresRecovery
        });
        if (this.destroyed || !this.ingressOpen) {
            return reject('atomic-transform-ingress-closed');
        }
        let sourceTick;
        let normalizedRecords;
        try {
            sourceTick = requirePositiveUint32(targetFixedTick, 'targetFixedTick');
            if (!Array.isArray(records) || records.length > this.capacity) {
                throw new RangeError('prepare records가 world capacity를 초과했습니다.');
            }
            const seen = new Set();
            normalizedRecords = records.map((record, index) => {
                const sourceHandle = normalizeHandle(
                    record?.sourceHandle ?? record,
                    `records[${index}].sourceHandle`
                );
                const key = handleKey(sourceHandle);
                if (seen.has(key)) {
                    throw new RangeError('prepare source handle이 중복되었습니다.');
                }
                seen.add(key);
                return Object.freeze({
                    sourceHandle,
                    topologyId: normalizeEnemyAtomicTransformTopologyId(
                        record.topologyId,
                        `records[${index}].topologyId`
                    )
                });
            });
        } catch (error) {
            return reject(`atomic-transform-prepare-contract:${error.message}`, true);
        }
        const existing = this.stagedBySourceTick.get(sourceTick);
        const canonical = JSON.stringify(normalizedRecords);
        if (existing) {
            return existing.canonical === canonical
                ? Object.freeze({ ...existing.receipt, replayed: true })
                : this.#fail('atomic-transform-prepare-replay-conflict');
        }
        const batchIdFingerprint = hashValues([
            this.sessionGeneration,
            sourceTick,
            this.nextPrepareSequence++,
            ...normalizedRecords.flatMap((record) => [
                record.topologyId,
                record.sourceHandle.entityId,
                record.sourceHandle.incarnation
            ])
        ]);
        const staged = this.backend.stageAtomicTransformPrepareBatch({
            abiVersion: GPU_ATOMIC_TRANSFORM_PREPARE_PROGRAM_ABI_VERSION,
            sourceTick,
            targetFixedTick: sourceTick + 1,
            batchIdFingerprint,
            records: normalizedRecords
        });
        if (staged?.accepted !== true) {
            return staged?.requiresRecovery === true
                ? this.#fail(staged.reason ?? 'atomic-transform-prepare-stage')
                : staged;
        }
        const receipt = Object.freeze({
            accepted: true,
            sourceTick,
            targetFixedTick: sourceTick + 1,
            batchIdFingerprint,
            candidateCount: normalizedRecords.length,
            replayed: false,
            requiresRecovery: false
        });
        this.stagedBySourceTick.set(sourceTick, Object.freeze({ canonical, receipt }));
        return receipt;
    }

    commitCompletedAtFixedBoundary(targetFixedTick) {
        const tick = requirePositiveUint32(targetFixedTick, 'targetFixedTick');
        if (tick < this.lastCommittedTargetFixedTick) {
            return this.#protocolFailure('atomic-transform-boundary-regression', tick);
        }
        const completed = [];
        this.backend.drainCompletedAtomicTransformPrepareBatches(completed);
        this.completedPrepareBacklog.push(...completed);
        if (this.completedPrepareBacklog.length > this.capacity) {
            return this.#protocolFailure(
                'atomic-transform-prepare-completion-capacity',
                tick
            );
        }
        const due = this.completedPrepareBacklog.filter(
            (entry) => entry.targetFixedTick === tick
        );
        const late = this.completedPrepareBacklog.filter(
            (entry) => entry.targetFixedTick < tick
        );
        if (late.length > 0 || due.length > 1) {
            return this.#protocolFailure('atomic-transform-prepare-completion-order', tick);
        }
        if (due.length === 0) {
            if (this.stagedBySourceTick.has(tick - 1)) {
                return Object.freeze({
                    sourceTick: tick - 1,
                    targetFixedTick: tick,
                    batchIdFingerprint: 0,
                    records: Object.freeze([]),
                    pending: true,
                    stale: false,
                    protocolFailure: null
                });
            }
            this.lastCommittedTargetFixedTick = tick;
            return Object.freeze({
                sourceTick: tick - 1,
                targetFixedTick: tick,
                batchIdFingerprint: 0,
                records: Object.freeze([]),
                pending: false,
                stale: true,
                protocolFailure: null
            });
        }
        const completion = due[0];
        this.completedPrepareBacklog = this.completedPrepareBacklog.filter(
            (entry) => entry !== completion
        );
        let completionFingerprint = 0;
        try {
            completionFingerprint = requirePositiveUint32(
                completion.batchIdFingerprint,
                'completion.batchIdFingerprint'
            );
            const staged = this.stagedBySourceTick.get(completion.sourceTick);
            if (!staged
                || staged.receipt.batchIdFingerprint !== completionFingerprint
                || staged.receipt.sourceTick !== completion.sourceTick
                || staged.receipt.targetFixedTick !== tick
                || staged.receipt.candidateCount < 0
                || staged.receipt.candidateCount > this.capacity) {
                throw new RangeError('prepare completion에 대응하는 exact staged receipt가 없습니다.');
            }
            // A staged receipt is a one-shot authentication token. Consume it before
            // promoting any GPU record so duplicate/stale readbacks cannot replay it.
            this.stagedBySourceTick.delete(completion.sourceTick);
            if (completion.sourceTick + 1 !== tick
                || completion.sessionGeneration !== this.sessionGeneration
                || completion.status !== GPU_ATOMIC_TRANSFORM_RUNTIME_STATUS.OK
                || !Array.isArray(completion.records)
                || completion.records.length > this.capacity) {
                throw new RangeError('prepare completion header가 authentic하지 않습니다.');
            }
            const protocol = freezeProtocol(completion);
            const seen = new Set();
            const records = completion.records.map((record, index) => {
                const sourceHandle = normalizeHandle(record, `completion[${index}]`);
                const sourceKey = handleKey(sourceHandle);
                if (seen.has(sourceKey)) {
                    throw new RangeError('GPU prepare source가 중복되었습니다.');
                }
                seen.add(sourceKey);
                const recordFingerprint = requirePositiveUint32(
                    record.recordFingerprint,
                    `completion[${index}].recordFingerprint`
                );
                const topologyId = normalizeEnemyAtomicTransformTopologyId(
                    record.topologyId,
                    `completion[${index}].topologyId`
                );
                const triggerSourceTick = requireUint32(
                    record.triggerSourceTick,
                    `completion[${index}].triggerSourceTick`
                );
                const triggerSequence = requireUint32(
                    record.triggerSequence,
                    `completion[${index}].triggerSequence`
                );
                if ((topologyId === ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_MANY
                        && triggerSourceTick === 0)
                    || (topologyId
                            === ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_ONE_DELAYED
                        && (triggerSourceTick !== 0 || triggerSequence !== 0))
                    || (topologyId
                            !== ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_MANY
                        && topologyId
                            !== ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_ONE_DELAYED)) {
                    throw new RangeError('prepare trigger/topology proof가 일치하지 않습니다.');
                }
                const prepareEvidence = Object.freeze({
                    abiVersion: GPU_ATOMIC_TRANSFORM_RUNTIME_ABI_VERSION,
                    sessionGeneration: protocol.sessionGeneration,
                    deviceGeneration: protocol.deviceGeneration,
                    authoritativeEpoch: protocol.authoritativeEpoch,
                    sourceTick: completion.sourceTick,
                    targetFixedTick: tick,
                    batchIdFingerprint: completionFingerprint,
                    recordFingerprint,
                    sourceEntityId: sourceHandle.entityId,
                    sourceIncarnation: sourceHandle.incarnation,
                    commandGeneration: requirePositiveUint32(
                        record.commandGeneration,
                        `completion[${index}].commandGeneration`
                    ),
                    triggerSourceTick,
                    triggerSequence
                });
                return Object.freeze({
                    ...record,
                    topologyId,
                    sourceHandle,
                    prepareEvidence
                });
            });
            const authentic = Object.freeze({
                sourceTick: completion.sourceTick,
                targetFixedTick: tick,
                batchIdFingerprint: completionFingerprint,
                protocol,
                recordsBySource: new Map(records.map((record) => [
                    handleKey(record.sourceHandle), record
                ]))
            });
            if (this.authenticByFingerprint.size >= this.capacity
                && !this.authenticByFingerprint.has(completionFingerprint)) {
                throw new RangeError(
                    'AtomicTransform authentic prepare proof capacity를 초과했습니다.'
                );
            }
            this.authenticByFingerprint.set(completionFingerprint, authentic);
            this.lastCompletedSourceTick = completion.sourceTick;
            this.lastCommittedTargetFixedTick = tick;
            return Object.freeze({
                sourceTick: completion.sourceTick,
                targetFixedTick: tick,
                batchIdFingerprint: completionFingerprint,
                records: Object.freeze(records),
                pending: false,
                stale: false,
                protocolFailure: null
            });
        } catch (error) {
            if (completionFingerprint > 0) {
                this.backend.discardPreparedAtomicTransformBatch({
                    batchIdFingerprint: completionFingerprint
                });
            }
            return this.#protocolFailure(
                'atomic-transform-prepare-authentication',
                tick,
                error.message
            );
        }
    }

    requestPreparedTransformBatch(request = {}) {
        const reject = (reason, requiresRecovery = false) => Object.freeze({
            accepted: false, reason, requiresRecovery
        });
        if (!this.ingressOpen || this.destroyed) {
            return reject('atomic-transform-ingress-closed');
        }
        let commandId;
        let batchIdFingerprint;
        let sourceTick;
        let targetFixedTick;
        let authentic;
        try {
            commandId = String(request.commandId ?? '');
            if (commandId.length === 0) {
                throw new TypeError('commandId가 필요합니다.');
            }
            batchIdFingerprint = requirePositiveUint32(
                request.batchIdFingerprint,
                'batchIdFingerprint'
            );
            sourceTick = requirePositiveUint32(request.prepareSourceTick, 'prepareSourceTick');
            targetFixedTick = requirePositiveUint32(request.targetFixedTick, 'targetFixedTick');
            if (targetFixedTick !== sourceTick + 1
                || !Array.isArray(request.records)
                || request.records.length === 0
                || request.records.length > this.transformStartCapacity) {
                throw new RangeError(
                    `prepared transform은 T-1→T 및 1..${this.transformStartCapacity} records여야 합니다.`
                );
            }
            authentic = this.authenticByFingerprint.get(batchIdFingerprint);
            if (!authentic) {
                return reject('atomic-transform-prepare-stale');
            }
            if (authentic.sourceTick !== sourceTick
                || authentic.targetFixedTick !== targetFixedTick) {
                throw new RangeError('prepared transform tick이 authentic proof와 다릅니다.');
            }
            const usedSources = new Set();
            for (let index = 0; index < request.records.length; index++) {
                const sourceHandle = normalizeHandle(
                    request.records[index].sourceHandles?.[0],
                    `records[${index}].sourceHandles[0]`
                );
                const key = handleKey(sourceHandle);
                const prepared = authentic.recordsBySource.get(key);
                const evidence = request.records[index].prepareEvidence;
                const topologyId = normalizeEnemyAtomicTransformTopologyId(
                    request.records[index].topologyId,
                    `records[${index}].topologyId`
                );
                if (usedSources.has(key) || !prepared
                    || topologyId !== prepared.topologyId
                    || evidence !== prepared.prepareEvidence) {
                    throw new RangeError('prepared subset evidence가 authentic하지 않습니다.');
                }
                usedSources.add(key);
            }
        } catch (error) {
            if (authentic && batchIdFingerprint > 0) {
                this.authenticByFingerprint.delete(batchIdFingerprint);
                const discarded = this.backend
                    .discardPreparedAtomicTransformBatch({
                        batchIdFingerprint
                    });
                if (discarded?.accepted !== true
                    && discarded?.requiresRecovery === true) {
                    return this.#fail(
                        discarded.reason
                            ?? 'atomic-transform-invalid-request-discard'
                    );
                }
                return this.#fail(
                    'atomic-transform-prepared-contract',
                    error.message
                );
            }
            return reject(`atomic-transform-prepared-contract:${error.message}`, true);
        }
        const lifecycleReceipt = this.lifecycle.requestAtomicTransformBatch({
            commandId,
            prepareSourceTick: sourceTick,
            targetFixedTick,
            transformFixedTick: targetFixedTick,
            batchIdFingerprint,
            records: request.records
        });
        if (lifecycleReceipt?.accepted !== true) {
            this.authenticByFingerprint.delete(batchIdFingerprint);
            const discarded = this.backend.discardPreparedAtomicTransformBatch({
                batchIdFingerprint
            });
            if (discarded?.accepted !== true
                && discarded?.requiresRecovery === true) {
                return this.#fail(
                    discarded.reason
                        ?? 'atomic-transform-lifecycle-reject-discard'
                );
            }
            return lifecycleReceipt?.requiresRecovery === true
                ? this.#fail(lifecycleReceipt.reason ?? 'atomic-transform-lifecycle-request')
                : Object.freeze({
                    ...lifecycleReceipt,
                    retryDisposition: 'restage-next-prepare'
                });
        }
        this.authenticByFingerprint.delete(batchIdFingerprint);
        this.pendingLifecycleByCommandId.set(commandId, Object.freeze({
            batchIdFingerprint,
            sourceTick,
            targetFixedTick
        }));
        return lifecycleReceipt;
    }

    discardPreparedBatch({ batchIdFingerprint } = {}) {
        if (this.destroyed || !this.ingressOpen) {
            return Object.freeze({
                accepted: false,
                reason: 'atomic-transform-ingress-closed',
                requiresRecovery: false
            });
        }
        let fingerprint;
        try {
            fingerprint = requirePositiveUint32(batchIdFingerprint, 'batchIdFingerprint');
        } catch (error) {
            return Object.freeze({ accepted: false, reason: error.message, requiresRecovery: true });
        }
        this.authenticByFingerprint.delete(fingerprint);
        const backendDiscard = this.backend.discardPreparedAtomicTransformBatch({
            batchIdFingerprint: fingerprint
        });
        if (backendDiscard?.accepted !== true
            && backendDiscard?.requiresRecovery === true) {
            return this.#fail(
                backendDiscard.reason ?? 'atomic-transform-discard-backend'
            );
        }
        return Object.freeze({ accepted: true, batchIdFingerprint: fingerprint });
    }

    observeLifecycleCommit(commit) {
        if (!commit || typeof commit !== 'object'
            || !Array.isArray(commit.atomicTransforms)
            || !Array.isArray(commit.rejected)) {
            return this.#fail('atomic-transform-lifecycle-result-contract');
        }
        if (this.observedLifecycleCommits.has(commit)) {
            return this.getStatus();
        }
        const completedIds = new Set(commit.atomicTransforms.map((entry) => entry.commandId));
        const rejectedIds = new Set(commit.rejected.map((entry) => entry.commandId));
        for (const [commandId, pending] of this.pendingLifecycleByCommandId) {
            if (rejectedIds.has(commandId)) {
                const discarded = this.backend
                    .discardPreparedAtomicTransformBatch({
                        batchIdFingerprint: pending.batchIdFingerprint
                    });
                if (discarded?.accepted !== true
                    && discarded?.requiresRecovery === true) {
                    this.#fail(
                        discarded.reason
                            ?? 'atomic-transform-lifecycle-reject-discard'
                    );
                }
                this.pendingLifecycleByCommandId.delete(commandId);
                continue;
            }
            if (completedIds.has(commandId)) {
                this.pendingLifecycleByCommandId.delete(commandId);
            }
        }
        this.observedLifecycleCommits.add(commit);
        return this.getStatus();
    }

    closeForTerminal(finalFixedTick) {
        const tick = requirePositiveUint32(finalFixedTick, 'finalFixedTick');
        this.ingressOpen = false;
        this.stagedBySourceTick.clear();
        this.authenticByFingerprint.clear();
        this.pendingLifecycleByCommandId.clear();
        this.completedPrepareBacklog.length = 0;
        const backendTerminal = this.backend.cancelPendingAtomicTransformProgramsForTerminal({
            abiVersion: GPU_ATOMIC_TRANSFORM_TERMINAL_CANCEL_ABI_VERSION,
            finalFixedTick: tick
        });
        if (backendTerminal?.state === 'failed') {
            this.#fail('atomic-transform-terminal-cancel');
        }
        this.terminal = Object.freeze({
            abiVersion: GPU_ATOMIC_TRANSFORM_TERMINAL_CANCEL_ABI_VERSION,
            state: this.recoveryRequired ? 'failed' : 'armed',
            finalFixedTick: tick,
            submittedTick: 0,
            sessionGeneration: requireUint32(
                backendTerminal?.sessionGeneration,
                'terminal.sessionGeneration'
            ),
            deviceGeneration: requireUint32(
                backendTerminal?.deviceGeneration,
                'terminal.deviceGeneration'
            ),
            authoritativeEpoch: requireUint32(
                backendTerminal?.authoritativeEpoch,
                'terminal.authoritativeEpoch'
            ),
            pendingPrepareCount: 0,
            pendingTransformCount: 0,
            pendingReadbackCount: 0,
            failure: this.recoveryRequired ? this.failure : null
        });
        return this.terminal;
    }

    getTerminalCancelStatus() {
        return this.terminal;
    }

    requiresRecovery() {
        return !this.destroyed && this.recoveryRequired;
    }

    getStatus() {
        const pendingPrepareCount = this.stagedBySourceTick.size
            + this.authenticByFingerprint.size;
        return Object.freeze({
            abiVersion: GPU_ATOMIC_TRANSFORM_RUNTIME_ABI_VERSION,
            ingressOpen: this.ingressOpen,
            stagedPrepareCount: this.stagedBySourceTick.size,
            authenticPrepareCount: this.authenticByFingerprint.size,
            pendingPrepareCount,
            pendingTransformCount: this.pendingLifecycleByCommandId.size,
            pendingReadbackCount: this.backend?.getAtomicTransformRuntimeStatus?.()
                ?.pendingReadbackCount ?? 0,
            completedPrepareBacklogCount: this.completedPrepareBacklog.length,
            lastCompletedSourceTick: this.lastCompletedSourceTick,
            backend: this.backend?.getAtomicTransformRuntimeStatus?.() ?? null,
            recoveryRequired: this.recoveryRequired,
            failure: this.failure,
            terminal: this.terminal,
            destroyed: this.destroyed
        });
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.ingressOpen = false;
        this.stagedBySourceTick.clear();
        this.authenticByFingerprint.clear();
        this.pendingLifecycleByCommandId.clear();
        this.completedPrepareBacklog.length = 0;
        this.backend = null;
        this.lifecycle = null;
    }

    #protocolFailure(code, targetFixedTick, detail = null) {
        this.#fail(code, detail);
        return Object.freeze({
            sourceTick: Math.max(0, targetFixedTick - 1),
            targetFixedTick,
            batchIdFingerprint: 0,
            records: Object.freeze([]),
            protocolFailure: this.failure
        });
    }

    #fail(code, detail = null) {
        this.recoveryRequired = true;
        this.failure = Object.freeze({ code, detail: detail === null ? null : String(detail) });
        return Object.freeze({ accepted: false, reason: code, requiresRecovery: true });
    }
}

export const GPU_ATOMIC_TRANSFORM_TOPOLOGY_CODE_BY_ID = Object.freeze({
    [ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_MANY]: 2,
    [ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_ONE_DELAYED]: 3
});
