import {
    GPU_FORMATION_PREPARE_PROGRAM_ABI_VERSION,
    GPU_FORMATION_PREPARE_PROGRAM_FLAG,
    GPU_FORMATION_PREPARE_RESULT,
    GPU_FORMATION_PREPARE_SOURCE_INVALID_REASON,
    GPU_FORMATION_RUNTIME_ABI_VERSION,
    GPU_FORMATION_RUNTIME_STATUS,
    GPU_FORMATION_TERMINAL_CANCEL_ABI_VERSION,
    GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION,
    GPU_FORMATION_TRANSFORM_RESULT
} from '../../physics/gpu/gpu_formation_runtime_abi.js';
import {
    createFormationLineageHash
} from '../../contract/enemy_formation_contract.js';
import {
    ENEMY_LIFECYCLE_DISPOSITION_ID
} from '../../contract/enemy_lifecycle_disposition_contract.js';
import {
    normalizeGpuPrivateHexaTransformDestinationIntent
} from '../gpu_spawn_intent.js';

const INVALID_U32 = 0xffffffff;
const DEFAULT_COMMAND_CAPACITY = 256;
const DEFAULT_HISTORY_CAPACITY = 65536;

function requirePositiveSafeInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0 || number > maximum) {
        throw new RangeError(`${label}은 1..${maximum} 범위의 안전한 정수여야 합니다.`);
    }
    return number;
}

function requireNonNegativeSafeInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0 || number > maximum) {
        throw new RangeError(`${label}은 0..${maximum} 범위의 안전한 정수여야 합니다.`);
    }
    return number;
}

function requirePositiveInt32(value, label) {
    return requirePositiveSafeInteger(value, label, 0x7fffffff);
}

function requireInt32(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number)
        || number < -0x80000000
        || number > 0x7fffffff) {
        throw new RangeError(`${label}은 signed int32여야 합니다.`);
    }
    return number;
}

function mergeFormationHealthCenti(left, right, label) {
    const sum = requirePositiveInt32(left, `${label}.left`)
        + requirePositiveInt32(right, `${label}.right`);
    const merged = sum + Math.floor(sum / 10);
    if (!Number.isSafeInteger(merged) || merged > 0x7fffffff) {
        throw new RangeError(`${label} merge가 int32를 초과했습니다.`);
    }
    return merged;
}

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

function normalizeHandle(source, label) {
    return Object.freeze({
        entityId: requirePositiveSafeInteger(
            source?.entityId,
            `${label}.entityId`,
            INVALID_U32 - 1
        ),
        incarnation: requirePositiveSafeInteger(
            source?.incarnation,
            `${label}.incarnation`,
            INVALID_U32 - 1
        )
    });
}

function compareHandles(left, right) {
    return left.entityId - right.entityId
        || left.incarnation - right.incarnation;
}

function sameHandle(left, right) {
    return left.entityId === right.entityId
        && left.incarnation === right.incarnation;
}

function handleKey(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

function hashValues(values) {
    let hash = 0x811c9dc5;
    for (const value of values) {
        const string = String(value);
        for (let index = 0; index < string.length; index++) {
            hash = Math.imul(
                (hash ^ string.charCodeAt(index)) >>> 0,
                0x01000193
            ) >>> 0;
        }
        hash = Math.imul((hash ^ 0xff) >>> 0, 0x01000193) >>> 0;
    }
    if (hash === 0 || hash === INVALID_U32) {
        hash = (hash ^ 0x9e3779b9) >>> 0;
    }
    return hash === 0 || hash === INVALID_U32 ? 1 : hash;
}

function createPrepareCanonicalKey(targetFixedTick, records) {
    return JSON.stringify([
        targetFixedTick,
        ...records.flatMap((record) => [
            record.sourceHandle.entityId,
            record.sourceHandle.incarnation,
            record.prepareSequence,
            record.fingerprint,
            record.expectedState.definitionCode,
            record.expectedState.coordinateSystemCode,
            record.expectedState.policyCode,
            record.expectedState.memberCount,
            record.expectedState.occupiedSlotMask,
            record.expectedState.rotationStep,
            record.expectedState.generation,
            record.expectedState.lineageHash
        ])
    ]);
}

function copyExpectedFormationState(view, label) {
    const metadata = view?.metadata;
    if (!view || typeof view !== 'object'
        || !metadata || typeof metadata !== 'object') {
        throw new TypeError(`${label} active registry metadata가 필요합니다.`);
    }
    const state = Object.freeze({
        definitionCode: requirePositiveSafeInteger(
            metadata.formationDefinitionCode,
            `${label}.formationDefinitionCode`,
            INVALID_U32 - 1
        ),
        coordinateSystemCode: requirePositiveSafeInteger(
            metadata.formationCoordinateSystemCode,
            `${label}.formationCoordinateSystemCode`,
            INVALID_U32 - 1
        ),
        policyCode: requirePositiveSafeInteger(
            metadata.formationPolicyCode,
            `${label}.formationPolicyCode`,
            INVALID_U32 - 1
        ),
        memberCount: requirePositiveSafeInteger(
            metadata.formationMemberCount,
            `${label}.formationMemberCount`,
            6
        ),
        occupiedSlotMask: requirePositiveSafeInteger(
            metadata.formationOccupiedSlotMask,
            `${label}.formationOccupiedSlotMask`,
            0x3f
        ),
        rotationStep: requireNonNegativeSafeInteger(
            metadata.formationRotationStep,
            `${label}.formationRotationStep`,
            5
        ),
        generation: requirePositiveSafeInteger(
            metadata.formationGeneration,
            `${label}.formationGeneration`,
            INVALID_U32 - 1
        ),
        lineageHash: requirePositiveSafeInteger(
            metadata.formationLineageHash,
            `${label}.formationLineageHash`,
            INVALID_U32 - 1
        )
    });
    if (metadata.formationFlags !== 1
        || (state.occupiedSlotMask.toString(2).replaceAll('0', '').length
            !== state.memberCount)) {
        throw new RangeError(`${label} Formation state가 canonical active state가 아닙니다.`);
    }
    return state;
}

function assertBackendPort(source) {
    const methods = [
        'hasBody',
        'stageFormationPrepareBatch',
        'drainCompletedFormationPrepareBatches',
        'armPreparedFormationTransformBatch',
        'commitArmedFormationTransformBatch',
        'cancelArmedFormationTransformBatch',
        'cancelPendingFormationProgramsForTerminal',
        'getFormationRuntimeStatus',
        'getEventProtocolState'
    ];
    for (const method of methods) {
        if (typeof source?.[method] !== 'function') {
            throw new TypeError(`Formation backend port.${method}()가 필요합니다.`);
        }
    }
    return source;
}

function assertRegistry(source) {
    for (const method of ['has', 'copyEntityView']) {
        if (typeof source?.[method] !== 'function') {
            throw new TypeError(`Formation registry.${method}()가 필요합니다.`);
        }
    }
    return source;
}

function assertLifecyclePort(source) {
    if (typeof source?.requestAtomicTransformBatch !== 'function') {
        throw new TypeError('Formation lifecycle port.requestAtomicTransformBatch()가 필요합니다.');
    }
    return source;
}

function freezeFailure(stage, code, detail = null) {
    return Object.freeze({
        stage,
        code,
        detail: detail === null ? null : String(detail)
    });
}

function normalizeProtocol(source, label) {
    return Object.freeze({
        sessionGeneration: requirePositiveSafeInteger(
            source?.sessionGeneration,
            `${label}.sessionGeneration`
        ),
        deviceGeneration: requireNonNegativeSafeInteger(
            source?.deviceGeneration,
            `${label}.deviceGeneration`
        ),
        authoritativeEpoch: requireNonNegativeSafeInteger(
            source?.authoritativeEpoch,
            `${label}.authoritativeEpoch`
        ),
        submittedTick: requireNonNegativeSafeInteger(
            source?.submittedTick ?? source?.submittedTickCount ?? 0,
            `${label}.submittedTick`
        )
    });
}

function compareProtocol(left, right) {
    if (left.sessionGeneration !== right.sessionGeneration) {
        return left.sessionGeneration < right.sessionGeneration ? -1 : 1;
    }
    if (left.deviceGeneration !== right.deviceGeneration) {
        return left.deviceGeneration < right.deviceGeneration ? -1 : 1;
    }
    if (left.authoritativeEpoch !== right.authoritativeEpoch) {
        return left.authoritativeEpoch < right.authoritativeEpoch ? -1 : 1;
    }
    return 0;
}

function sameProtocolGeneration(left, right) {
    return left.sessionGeneration === right.sessionGeneration
        && left.deviceGeneration === right.deviceGeneration
        && left.authoritativeEpoch === right.authoritativeEpoch;
}

function copyPrepareResult(source, expectedRecord, stagedRecord, index) {
    const result = requireNonNegativeSafeInteger(source?.result, `results[${index}].result`);
    if (!Object.values(GPU_FORMATION_PREPARE_RESULT).includes(result)) {
        throw new RangeError(`results[${index}].result가 알려진 값이 아닙니다.`);
    }
    if (result === GPU_FORMATION_PREPARE_RESULT.PENDING) {
        throw new RangeError(`results[${index}].result가 PENDING에 머물렀습니다.`);
    }
    const normalized = {
        programIndex: requireNonNegativeSafeInteger(
            source?.programIndex ?? index,
            `results[${index}].programIndex`
        ),
        sourceEntityId: requirePositiveSafeInteger(
            source?.sourceEntityId,
            `results[${index}].sourceEntityId`,
            INVALID_U32 - 1
        ),
        sourceIncarnation: requirePositiveSafeInteger(
            source?.sourceIncarnation,
            `results[${index}].sourceIncarnation`,
            INVALID_U32 - 1
        ),
        prepareSequence: requireNonNegativeSafeInteger(
            source?.prepareSequence,
            `results[${index}].prepareSequence`,
            0xffffffff
        ),
        fingerprint: requirePositiveSafeInteger(
            source?.fingerprint,
            `results[${index}].fingerprint`,
            0xfffffffe
        ),
        result,
        pairProgramIndex: requireNonNegativeSafeInteger(
            source?.pairProgramIndex ?? INVALID_U32,
            `results[${index}].pairProgramIndex`,
            INVALID_U32
        ),
        pairEntityId: requireNonNegativeSafeInteger(
            source?.pairEntityId ?? INVALID_U32,
            `results[${index}].pairEntityId`,
            INVALID_U32
        ),
        pairIncarnation: requireNonNegativeSafeInteger(
            source?.pairIncarnation ?? INVALID_U32,
            `results[${index}].pairIncarnation`,
            INVALID_U32
        ),
        rootProgramIndex: requireNonNegativeSafeInteger(
            source?.rootProgramIndex ?? INVALID_U32,
            `results[${index}].rootProgramIndex`,
            INVALID_U32
        ),
        definitionCode: requireNonNegativeSafeInteger(source?.definitionCode ?? 0, 'definitionCode', 0xffffffff),
        coordinateSystemCode: requireNonNegativeSafeInteger(source?.coordinateSystemCode ?? 0, 'coordinateSystemCode', 0xffffffff),
        policyCode: requireNonNegativeSafeInteger(source?.policyCode ?? 0, 'policyCode', 0xffffffff),
        memberCount: requireNonNegativeSafeInteger(source?.memberCount ?? 0, 'memberCount', 6),
        occupiedSlotMask: requireNonNegativeSafeInteger(source?.occupiedSlotMask ?? 0, 'occupiedSlotMask', 0x3f),
        rotationStep: requireNonNegativeSafeInteger(source?.rotationStep ?? 0, 'rotationStep', 5),
        generation: requireNonNegativeSafeInteger(source?.generation ?? 0, 'generation', 0xffffffff),
        lineageHash: requireNonNegativeSafeInteger(source?.lineageHash ?? 0, 'lineageHash', 0xffffffff),
        currentHealthCenti: requireInt32(
            source?.currentHealthCenti ?? 0,
            `results[${index}].currentHealthCenti`
        ),
        maxHealthCenti: requireInt32(
            source?.maxHealthCenti ?? 0,
            `results[${index}].maxHealthCenti`
        ),
        pairMemberCount: requireNonNegativeSafeInteger(source?.pairMemberCount ?? 0, 'pairMemberCount', 6),
        pairOccupiedSlotMask: requireNonNegativeSafeInteger(source?.pairOccupiedSlotMask ?? 0, 'pairOccupiedSlotMask', 0x3f),
        pairRotationStep: requireNonNegativeSafeInteger(source?.pairRotationStep ?? 0, 'pairRotationStep', 5),
        pairGeneration: requireNonNegativeSafeInteger(source?.pairGeneration ?? 0, 'pairGeneration', 0xffffffff),
        pairLineageHash: requireNonNegativeSafeInteger(source?.pairLineageHash ?? 0, 'pairLineageHash', 0xffffffff),
        pairCurrentHealthCenti: requireInt32(
            source?.pairCurrentHealthCenti ?? 0,
            `results[${index}].pairCurrentHealthCenti`
        ),
        pairMaxHealthCenti: requireInt32(
            source?.pairMaxHealthCenti ?? 0,
            `results[${index}].pairMaxHealthCenti`
        ),
        destinationMemberCount: requireNonNegativeSafeInteger(source?.destinationMemberCount ?? 0, 'destinationMemberCount', 6),
        destinationOccupiedSlotMask: requireNonNegativeSafeInteger(source?.destinationOccupiedSlotMask ?? 0, 'destinationOccupiedSlotMask', 0x3f),
        destinationRotationStep: requireNonNegativeSafeInteger(source?.destinationRotationStep ?? 0, 'destinationRotationStep', 5),
        expectedMergedCurrentHealthCenti: requireInt32(
            source?.expectedMergedCurrentHealthCenti ?? 0,
            `results[${index}].expectedMergedCurrentHealthCenti`
        ),
        expectedMergedMaxHealthCenti: requireInt32(
            source?.expectedMergedMaxHealthCenti ?? 0,
            `results[${index}].expectedMergedMaxHealthCenti`
        ),
        flags: requireNonNegativeSafeInteger(
            source?.flags ?? 0,
            `results[${index}].flags`,
            0xffffffff
        ),
        motionRootProgramIndex: requireNonNegativeSafeInteger(
            source?.motionRootProgramIndex ?? INVALID_U32,
            `results[${index}].motionRootProgramIndex`,
            INVALID_U32
        ),
        sourceInvalidReason: requireNonNegativeSafeInteger(
            source?.sourceInvalidReason
                ?? GPU_FORMATION_PREPARE_SOURCE_INVALID_REASON.NONE,
            `results[${index}].sourceInvalidReason`,
            GPU_FORMATION_PREPARE_SOURCE_INVALID_REASON.DIED_AFTER_STAGE
        )
    };
    if (normalized.programIndex !== index
        || normalized.sourceEntityId !== expectedRecord.sourceHandle.entityId
        || normalized.sourceIncarnation !== expectedRecord.sourceHandle.incarnation
        || normalized.prepareSequence !== expectedRecord.prepareSequence
        || normalized.fingerprint !== expectedRecord.fingerprint) {
        throw new RangeError(`results[${index}] authored identity가 일치하지 않습니다.`);
    }
    if (normalized.flags !== stagedRecord.flags) {
        throw new RangeError(`results[${index}].flags가 staged provenance와 다릅니다.`);
    }
    const sourceInvalidAuthorized = (
        stagedRecord.flags
        & GPU_FORMATION_PREPARE_PROGRAM_FLAG.ALLOW_SOURCE_INVALID
    ) !== 0;
    const validSourceDisposition = sourceInvalidAuthorized
        ? result === GPU_FORMATION_PREPARE_RESULT.SOURCE_INVALID
            && normalized.sourceInvalidReason
                === GPU_FORMATION_PREPARE_SOURCE_INVALID_REASON.LIFECYCLE_REMOVED
        : result === GPU_FORMATION_PREPARE_RESULT.SOURCE_INVALID
            ? normalized.sourceInvalidReason
                === GPU_FORMATION_PREPARE_SOURCE_INVALID_REASON.DIED_AFTER_STAGE
            : normalized.sourceInvalidReason
                === GPU_FORMATION_PREPARE_SOURCE_INVALID_REASON.NONE;
    if (!validSourceDisposition) {
        throw new RangeError(`results[${index}] SOURCE_INVALID provenance가 다릅니다.`);
    }
    const hasLiveSourceState = result === GPU_FORMATION_PREPARE_RESULT.NO_PAIR
        || result === GPU_FORMATION_PREPARE_RESULT.MUTUAL_PAIR
        || result === GPU_FORMATION_PREPARE_RESULT.GRID_OVERFLOW;
    if (hasLiveSourceState) {
        for (const field of [
            'definitionCode',
            'coordinateSystemCode',
            'policyCode',
            'memberCount',
            'occupiedSlotMask',
            'rotationStep',
            'generation',
            'lineageHash'
        ]) {
            if (normalized[field] !== expectedRecord.expectedState[field]) {
                throw new RangeError(
                    `results[${index}].${field}가 request-time source state와 다릅니다.`
                );
            }
        }
        requirePositiveInt32(normalized.currentHealthCenti, 'currentHealthCenti');
        requirePositiveInt32(normalized.maxHealthCenti, 'maxHealthCenti');
        if (normalized.currentHealthCenti > normalized.maxHealthCenti) {
            throw new RangeError(`results[${index}] source current HP가 max를 넘습니다.`);
        }
    } else if (normalized.definitionCode !== 0
        || normalized.coordinateSystemCode !== 0
        || normalized.policyCode !== 0
        || normalized.memberCount !== 0
        || normalized.occupiedSlotMask !== 0
        || normalized.rotationStep !== 0
        || normalized.generation !== 0
        || normalized.lineageHash !== 0
        || normalized.currentHealthCenti !== 0
        || normalized.maxHealthCenti !== 0) {
        throw new RangeError(`results[${index}] zero source sentinel이 다릅니다.`);
    }
    if (result === GPU_FORMATION_PREPARE_RESULT.MUTUAL_PAIR) {
        requirePositiveInt32(normalized.pairCurrentHealthCenti, 'pairCurrentHealthCenti');
        requirePositiveInt32(normalized.pairMaxHealthCenti, 'pairMaxHealthCenti');
        requirePositiveInt32(
            normalized.expectedMergedCurrentHealthCenti,
            'expectedMergedCurrentHealthCenti'
        );
        requirePositiveInt32(
            normalized.expectedMergedMaxHealthCenti,
            'expectedMergedMaxHealthCenti'
        );
        if (normalized.pairCurrentHealthCenti > normalized.pairMaxHealthCenti
            || normalized.destinationMemberCount
                !== normalized.memberCount + normalized.pairMemberCount
            || normalized.destinationMemberCount > 6
            || normalized.pairProgramIndex === INVALID_U32
            || normalized.pairEntityId === INVALID_U32
            || normalized.pairIncarnation === INVALID_U32
            || normalized.rootProgramIndex === INVALID_U32
            || normalized.motionRootProgramIndex === INVALID_U32) {
            throw new RangeError(`results[${index}] MUTUAL_PAIR facts가 올바르지 않습니다.`);
        }
    } else if (normalized.pairProgramIndex !== INVALID_U32
        || normalized.pairEntityId !== INVALID_U32
        || normalized.pairIncarnation !== INVALID_U32
        || normalized.rootProgramIndex !== INVALID_U32
        || normalized.motionRootProgramIndex !== INVALID_U32
        || normalized.pairMemberCount !== 0
        || normalized.pairOccupiedSlotMask !== 0
        || normalized.pairRotationStep !== 0
        || normalized.pairGeneration !== 0
        || normalized.pairLineageHash !== 0
        || normalized.pairCurrentHealthCenti !== 0
        || normalized.pairMaxHealthCenti !== 0
        || normalized.destinationMemberCount !== 0
        || normalized.destinationOccupiedSlotMask !== 0
        || normalized.destinationRotationStep !== 0
        || normalized.expectedMergedCurrentHealthCenti !== 0
        || normalized.expectedMergedMaxHealthCenti !== 0) {
        throw new RangeError(`results[${index}] non-pair sentinel facts가 다릅니다.`);
    }
    return Object.freeze(normalized);
}

function validateReciprocalPairs(results) {
    const pairs = [];
    for (let index = 0; index < results.length; index++) {
        const left = results[index];
        if (left.result !== GPU_FORMATION_PREPARE_RESULT.MUTUAL_PAIR) {
            continue;
        }
        const pairIndex = left.pairProgramIndex;
        if (pairIndex >= results.length || pairIndex === index) {
            throw new RangeError('MUTUAL_PAIR pairProgramIndex가 올바르지 않습니다.');
        }
        const right = results[pairIndex];
        const identityRootIndex = compareHandles(
            { entityId: left.sourceEntityId, incarnation: left.sourceIncarnation },
            { entityId: right.sourceEntityId, incarnation: right.sourceIncarnation }
        ) <= 0 ? index : pairIndex;
        if (right.result !== GPU_FORMATION_PREPARE_RESULT.MUTUAL_PAIR
            || right.pairProgramIndex !== index
            || left.pairEntityId !== right.sourceEntityId
            || left.pairIncarnation !== right.sourceIncarnation
            || right.pairEntityId !== left.sourceEntityId
            || right.pairIncarnation !== left.sourceIncarnation
            || left.memberCount !== right.pairMemberCount
            || left.occupiedSlotMask !== right.pairOccupiedSlotMask
            || left.rotationStep !== right.pairRotationStep
            || left.generation !== right.pairGeneration
            || left.lineageHash !== right.pairLineageHash
            || left.currentHealthCenti !== right.pairCurrentHealthCenti
            || left.maxHealthCenti !== right.pairMaxHealthCenti
            || left.destinationMemberCount !== right.destinationMemberCount
            || left.destinationOccupiedSlotMask
                !== right.destinationOccupiedSlotMask
            || left.destinationRotationStep !== right.destinationRotationStep
            || left.expectedMergedCurrentHealthCenti
                !== right.expectedMergedCurrentHealthCenti
            || left.expectedMergedMaxHealthCenti
                !== right.expectedMergedMaxHealthCenti
            || left.rootProgramIndex !== identityRootIndex
            || right.rootProgramIndex !== identityRootIndex
            || left.motionRootProgramIndex !== right.motionRootProgramIndex
            || (left.motionRootProgramIndex !== index
                && left.motionRootProgramIndex !== pairIndex)
            || left.expectedMergedCurrentHealthCenti
                !== mergeFormationHealthCenti(
                    left.currentHealthCenti,
                    right.currentHealthCenti,
                    'MUTUAL_PAIR currentHealthCenti'
                )
            || left.expectedMergedMaxHealthCenti
                !== mergeFormationHealthCenti(
                    left.maxHealthCenti,
                    right.maxHealthCenti,
                    'MUTUAL_PAIR maxHealthCenti'
                )) {
            throw new RangeError('MUTUAL_PAIR reciprocal snapshot이 일치하지 않습니다.');
        }
        if (index < pairIndex) {
            pairs.push(Object.freeze({ left, right }));
        }
    }
    return Object.freeze(pairs);
}

export class GpuFormationCommandOwner {
    constructor(backendPort, registry, lifecyclePort, options = {}) {
        this.backend = assertBackendPort(backendPort);
        this.registry = assertRegistry(registry);
        this.lifecyclePort = assertLifecyclePort(lifecyclePort);
        this.sessionGeneration = requirePositiveSafeInteger(
            options.sessionGeneration,
            'sessionGeneration'
        );
        this.commandCapacity = requirePositiveSafeInteger(
            options.commandCapacity ?? DEFAULT_COMMAND_CAPACITY,
            'commandCapacity'
        );
        this.historyCapacity = requirePositiveSafeInteger(
            options.historyCapacity ?? DEFAULT_HISTORY_CAPACITY,
            'historyCapacity'
        );
        const lifecycleCommitProofPort = options.lifecycleCommitProofPort ?? null;
        if (lifecycleCommitProofPort !== null
            && typeof lifecycleCommitProofPort?.isAuthenticCommit !== 'function') {
            throw new TypeError(
                'Formation lifecycleCommitProofPort.isAuthenticCommit()가 필요합니다.'
            );
        }
        this.lifecycleCommitProofPort = lifecycleCommitProofPort;
        this.queuedPrepare = null;
        this.inFlightBySourceTick = new Map();
        this.deferredCompletions = [];
        this.preparedByFingerprint = new Map();
        this.knownBatchFingerprints = new Map();
        this.history = [];
        this.historyHead = 0;
        this.rememberedBatchTicks = new Set();
        this.armedReceipts = new Map();
        this.pendingTransformCompletionByTick = new Map();
        this.lastValidatedTransformTick = 0;
        this.lastPrepareSourceTick = 0;
        this.lastPrepareSubmittedTick = 0;
        this.lastPrepareCompletedTick = 0;
        this.lastProtocol = null;
        this.lastCompletionSourceTick = 0;
        this.lastCompletionSubmittedTick = 0;
        this.recoveryRequired = false;
        this.failure = null;
        this.ingressOpen = true;
        this.ingressCloseReason = null;
        this.terminalCancel = null;
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
        this.#assertUsable();
        return this.commandPort;
    }

    requestPrepareBatch(request) {
        this.#assertUsable();
        if (!this.ingressOpen) {
            return Object.freeze({ accepted: false, reason: this.ingressCloseReason });
        }
        if (this.recoveryRequired) {
            return Object.freeze({ accepted: false, reason: 'formation-recovery-required' });
        }
        const targetFixedTick = requirePositiveSafeInteger(
            request?.targetFixedTick,
            'targetFixedTick'
        );
        if (!Array.isArray(request?.records)
            || request.records.length === 0
            || request.records.length > this.commandCapacity) {
            throw new RangeError('Formation prepare records가 bounded capacity를 벗어났습니다.');
        }
        const records = request.records.map((record, index) => {
            if (!record || typeof record !== 'object'
                || Object.keys(record).sort().join(',')
                    !== 'prepareSequence,sourceHandle') {
                throw new TypeError(
                    `records[${index}]에는 sourceHandle/prepareSequence만 허용됩니다.`
                );
            }
            const sourceHandle = normalizeHandle(
                record?.sourceHandle,
                `records[${index}].sourceHandle`
            );
            const prepareSequence = requireNonNegativeSafeInteger(
                record?.prepareSequence,
                `records[${index}].prepareSequence`,
                0xffffffff
            );
            return {
                sourceHandle,
                prepareSequence,
                fingerprint: 0,
                expectedState: null
            };
        });
        records.sort((left, right) => compareHandles(
            left.sourceHandle,
            right.sourceHandle
        ));
        const seen = new Set();
        for (const record of records) {
            const key = handleKey(record.sourceHandle);
            if (seen.has(key)) {
                throw new RangeError('Formation prepare source가 중복되었습니다.');
            }
            seen.add(key);
            const registryHas = this.registry.has(record.sourceHandle);
            const backendHas = this.backend.hasBody(record.sourceHandle);
            if (registryHas !== backendHas) {
                return this.#fail('prepare-request', 'registry-backend-desync');
            }
            if (!registryHas) {
                return Object.freeze({ accepted: false, reason: 'formation-source-stale' });
            }
            record.expectedState = copyExpectedFormationState(
                this.registry.copyEntityView(record.sourceHandle, {}),
                `records[${records.indexOf(record)}].source`
            );
            record.fingerprint = hashValues([
                this.sessionGeneration,
                targetFixedTick,
                record.sourceHandle.entityId,
                record.sourceHandle.incarnation,
                record.prepareSequence
            ]);
            Object.freeze(record);
        }
        const batchIdFingerprint = hashValues([
            this.sessionGeneration,
            targetFixedTick,
            ...records.flatMap((record) => [
                record.sourceHandle.entityId,
                record.sourceHandle.incarnation,
                record.prepareSequence,
                record.fingerprint
            ])
        ]);
        const canonicalKey = createPrepareCanonicalKey(targetFixedTick, records);
        if (this.queuedPrepare !== null) {
            if (this.queuedPrepare.targetFixedTick === targetFixedTick
                && this.queuedPrepare.batchIdFingerprint === batchIdFingerprint
                && this.queuedPrepare.canonicalKey === canonicalKey) {
                return Object.freeze({
                    accepted: true,
                    replayed: true,
                    targetFixedTick,
                    batchIdFingerprint,
                    stagedCount: records.length
                });
            }
            return this.#fail('prepare-request', 'whole-tick-batch-conflict');
        }
        const known = this.knownBatchFingerprints.get(targetFixedTick);
        if (known !== undefined) {
            if (known.batchIdFingerprint === batchIdFingerprint
                && known.canonicalKey === canonicalKey) {
                return Object.freeze({
                    accepted: true,
                    replayed: true,
                    targetFixedTick,
                    batchIdFingerprint,
                    stagedCount: records.length
                });
            }
            return this.#fail('prepare-request', 'prepare-replay-conflict');
        }
        this.queuedPrepare = Object.freeze({
            targetFixedTick,
            batchIdFingerprint,
            canonicalKey,
            records: Object.freeze(records)
        });
        this.knownBatchFingerprints.set(targetFixedTick, Object.freeze({
            batchIdFingerprint,
            canonicalKey
        }));
        return Object.freeze({
            accepted: true,
            replayed: false,
            targetFixedTick,
            batchIdFingerprint,
            stagedCount: records.length
        });
    }

    commitAtFixedBoundary(fixedTick, lifecycleCommit = null) {
        this.#assertUsable();
        const tick = requirePositiveSafeInteger(fixedTick, 'fixedTick');
        if (this.recoveryRequired) {
            return Object.freeze({ state: 'failed', recoveryRequired: true });
        }
        const batch = this.queuedPrepare;
        if (batch === null) {
            return Object.freeze({
                state: 'committed',
                recoveryRequired: false,
                targetFixedTick: tick,
                stagedCount: 0
            });
        }
        if (batch.targetFixedTick !== tick) {
            return this.#fail('prepare-commit', 'missed-fixed-boundary');
        }
        let backendRecords;
        try {
            backendRecords = this.#revalidatePrepareRecords(
                batch,
                tick,
                lifecycleCommit
            );
        } catch (error) {
            return this.#fail(
                'prepare-revalidation',
                'formation-source-revalidation',
                error?.message
            );
        }
        const backendBatch = Object.freeze({
            abiVersion: GPU_FORMATION_PREPARE_PROGRAM_ABI_VERSION,
            batchIdFingerprint: batch.batchIdFingerprint,
            targetFixedTick: tick,
            records: backendRecords
        });
        let receipt;
        try {
            receipt = this.backend.stageFormationPrepareBatch(backendBatch);
        } catch (error) {
            return this.#fail('prepare-stage', 'backend-exception', error?.message);
        }
        if (receipt?.abiVersion !== GPU_FORMATION_PREPARE_PROGRAM_ABI_VERSION
            || receipt.accepted !== true
            || receipt.targetFixedTick !== tick
            || receipt.stagedCount !== batch.records.length
            || receipt.requiresRecovery === true) {
            return this.#fail(
                'prepare-stage',
                receipt?.reason ?? 'backend-stage-rejected'
            );
        }
        const protocol = normalizeProtocol(
            this.backend.getEventProtocolState(),
            'prepareProtocol'
        );
        this.queuedPrepare = null;
        this.inFlightBySourceTick.set(tick, Object.freeze({
            ...batch,
            stagedBackendRecords: backendRecords,
            protocol
        }));
        this.lastPrepareSourceTick = tick;
        return Object.freeze({
            state: 'committed',
            recoveryRequired: false,
            targetFixedTick: tick,
            batchIdFingerprint: batch.batchIdFingerprint,
            stagedCount: batch.records.length
        });
    }

    commitCompletedAtFixedBoundary(targetFixedTick) {
        this.#assertUsable();
        const tick = requirePositiveSafeInteger(targetFixedTick, 'targetFixedTick');
        const transformCompletion = this.#validateTransformCompletionAtBoundary(tick);
        if (transformCompletion?.pending === true) {
            return Object.freeze({
                targetFixedTick: tick,
                sourceTick: tick - 1,
                batchIdFingerprint: 0,
                results: Object.freeze([]),
                pairs: Object.freeze([]),
                pending: true,
                stale: false,
                protocolFailure: null
            });
        }
        if (transformCompletion?.requiresRecovery === true) {
            return this.#completionFailure(
                tick,
                transformCompletion.reason,
                transformCompletion.failure?.detail
            );
        }
        const drained = [];
        let returned;
        let protocolAtDrain;
        try {
            protocolAtDrain = normalizeProtocol(
                this.backend.getEventProtocolState(),
                'prepareCompletion.protocolAtDrain'
            );
            returned = this.backend.drainCompletedFormationPrepareBatches(drained);
        } catch (error) {
            return this.#completionFailure(tick, 'drain-exception', error?.message);
        }
        if (Array.isArray(returned) && returned !== drained) {
            drained.push(...returned);
        }
        const frozenProtocolAtDrain = Object.freeze({ ...protocolAtDrain });
        this.deferredCompletions.push(...drained.map((source) => Object.freeze({
            source,
            protocol: frozenProtocolAtDrain
        })));
        if (this.deferredCompletions.length > this.commandCapacity) {
            return this.#completionFailure(tick, 'completion-capacity');
        }
        // 같은 fixed boundary는 다른 GPU readback의 backpressure로 재시도될 수
        // 있습니다. N+1의 첫 drain이 비어 있어도 N in-flight를 지우면, 같은
        // boundary의 다음 시도에서 도착한 정상 completion을 unknown으로 오판합니다.
        // 실제로 N+2 이상으로 넘어온 뒤에만 오래된 in-flight를 retire합니다.
        for (const sourceTick of this.inFlightBySourceTick.keys()) {
            if (sourceTick < tick - 1) {
                this.inFlightBySourceTick.delete(sourceTick);
                this.#rememberBatch(sourceTick);
            }
        }
        const due = [];
        const retained = [];
        for (const queued of this.deferredCompletions) {
            const sourceTick = Number(queued?.source?.sourceTick);
            if (!Number.isSafeInteger(sourceTick) || sourceTick <= 0) {
                return this.#completionFailure(tick, 'completion-source-tick');
            }
            if (sourceTick < tick - 1) {
                this.inFlightBySourceTick.delete(sourceTick);
                this.#rememberBatch(sourceTick);
                continue;
            }
            if (sourceTick > tick - 1) {
                retained.push(queued);
            } else {
                due.push(queued);
            }
        }
        this.deferredCompletions = retained;
        if (due.length === 0) {
            // N prepare completion은 오직 N+1 boundary에서만 publish 가능합니다.
            const pending = this.inFlightBySourceTick.has(tick - 1);
            return Object.freeze({
                targetFixedTick: tick,
                sourceTick: tick - 1,
                batchIdFingerprint: 0,
                results: Object.freeze([]),
                pairs: Object.freeze([]),
                pending,
                stale: !pending,
                protocolFailure: null
            });
        }
        if (due.length !== 1) {
            return this.#completionFailure(tick, 'multiple-whole-tick-completions');
        }
        const queuedCompletion = due[0];
        const envelope = queuedCompletion.source;
        const sourceTick = Number(envelope.sourceTick);
        const inFlight = this.inFlightBySourceTick.get(sourceTick);
        if (!inFlight) {
            return this.#completionFailure(tick, 'unknown-completion');
        }
        let protocol;
        try {
            protocol = normalizeProtocol(envelope, 'completionProtocol');
        } catch (error) {
            return this.#completionFailure(tick, 'completion-protocol', error?.message);
        }
        const generationOrder = compareProtocol(
            protocol,
            queuedCompletion.protocol
        );
        if (generationOrder < 0) {
            this.inFlightBySourceTick.delete(sourceTick);
            this.#rememberBatch(sourceTick);
            return Object.freeze({
                targetFixedTick: tick,
                sourceTick,
                batchIdFingerprint: 0,
                results: Object.freeze([]),
                pairs: Object.freeze([]),
                stale: true,
                protocolFailure: null
            });
        }
        if (generationOrder > 0) {
            return this.#completionFailure(tick, 'future-completion-generation');
        }
        if (protocol.sessionGeneration !== this.sessionGeneration) {
            if (protocol.sessionGeneration < this.sessionGeneration) {
                this.inFlightBySourceTick.delete(sourceTick);
                this.#rememberBatch(sourceTick);
                return Object.freeze({
                    targetFixedTick: tick,
                    sourceTick,
                    batchIdFingerprint: 0,
                    results: Object.freeze([]),
                    pairs: Object.freeze([]),
                    stale: true,
                    protocolFailure: null
                });
            }
            return this.#completionFailure(tick, 'future-session-generation');
        }
        if (this.lastProtocol && compareProtocol(protocol, this.lastProtocol) < 0) {
            this.inFlightBySourceTick.delete(sourceTick);
            this.#rememberBatch(sourceTick);
            return Object.freeze({
                targetFixedTick: tick,
                sourceTick,
                batchIdFingerprint: 0,
                results: Object.freeze([]),
                pairs: Object.freeze([]),
                stale: true,
                protocolFailure: null
            });
        }
        if (!sameProtocolGeneration(inFlight.protocol, protocol)) {
            return this.#completionFailure(tick, 'completion-inflight-protocol');
        }
        const sameStream = this.lastProtocol
            && sameProtocolGeneration(this.lastProtocol, protocol);
        const expectedPreviousSourceTick = sameStream
            ? this.lastCompletionSourceTick
            : 0;
        const expectedPreviousSubmittedTick = sameStream
            ? this.lastCompletionSubmittedTick
            : 0;
        if (envelope.abiVersion !== GPU_FORMATION_PREPARE_PROGRAM_ABI_VERSION
            || (envelope.status !== GPU_FORMATION_RUNTIME_STATUS.OK
                && envelope.status !== GPU_FORMATION_RUNTIME_STATUS.GRID_OVERFLOW)
            || envelope.sourceTick !== sourceTick
            || envelope.completedThroughTick !== sourceTick
            || envelope.previousSourceTick !== expectedPreviousSourceTick
            || envelope.previousSubmittedTick !== expectedPreviousSubmittedTick
            || sourceTick <= envelope.previousSourceTick
            || !Number.isSafeInteger(envelope.submittedTick)
            || envelope.submittedTick <= 0
            || envelope.submittedTick <= envelope.previousSubmittedTick
            || inFlight.protocol.submittedTick + 1 !== envelope.submittedTick
            || envelope.batchIdFingerprint !== inFlight.batchIdFingerprint
            || envelope.programCount !== inFlight.records.length
            || envelope.resultCount !== inFlight.records.length
            || !Number.isSafeInteger(envelope.pairCount)
            || envelope.pairCount < 0
            || !Number.isSafeInteger(envelope.gridSmallOverflow)
            || envelope.gridSmallOverflow < 0
            || !Number.isSafeInteger(envelope.gridBigOverflow)
            || envelope.gridBigOverflow < 0
            || !Array.isArray(envelope.results)
            || envelope.results.length !== inFlight.records.length) {
            return this.#completionFailure(tick, 'completion-envelope-mismatch');
        }
        let results;
        let pairs;
        try {
            results = Object.freeze(envelope.results.map((result, index) => (
                copyPrepareResult(
                    result,
                    inFlight.records[index],
                    inFlight.stagedBackendRecords[index],
                    index
                )
            )));
            pairs = validateReciprocalPairs(results);
            const mutualPairRecordCount = results.filter(({ result }) => (
                result === GPU_FORMATION_PREPARE_RESULT.MUTUAL_PAIR
            )).length;
            if (envelope.pairCount !== pairs.length
                || mutualPairRecordCount !== envelope.pairCount * 2) {
                throw new RangeError('prepare pairCount/result cardinality가 다릅니다.');
            }
        } catch (error) {
            return this.#completionFailure(tick, 'completion-result-mismatch', error?.message);
        }
        if (envelope.status === GPU_FORMATION_RUNTIME_STATUS.GRID_OVERFLOW
            || envelope.gridSmallOverflow !== 0
            || envelope.gridBigOverflow !== 0) {
            if (pairs.length !== 0 || envelope.pairCount !== 0) {
                return this.#completionFailure(
                    tick,
                    'grid-overflow-with-pair-mutation'
                );
            }
            if (envelope.status !== GPU_FORMATION_RUNTIME_STATUS.GRID_OVERFLOW
                || (envelope.gridSmallOverflow === 0
                    && envelope.gridBigOverflow === 0)) {
                return this.#completionFailure(
                    tick,
                    'grid-overflow-status-mismatch'
                );
            }
            return this.#completionFailure(tick, 'formation-grid-overflow');
        }
        const prepared = Object.freeze({
            targetFixedTick: tick,
            sourceTick,
            batchIdFingerprint: inFlight.batchIdFingerprint,
            // sourceTick은 복구 뒤에도 이어지는 game fixed tick이고 submittedTick은
            // fresh GPU world마다 다시 시작하는 backend-local watermark입니다.
            // 두 좌표계를 섞지 않고, 인증된 prepare 제출 tick을 transform의
            // 정확한 다음-local-submit 검증에 보존합니다.
            completionSubmittedTick: envelope.submittedTick,
            // Transform arm은 완료 시점이 아니라 prepare submit 직전의
            // protocol watermark를 인증합니다. 완료 envelope의 submittedTick을
            // 넘기면 backend의 N-1 -> N 연속성 검사가 항상 실패합니다.
            protocol: Object.freeze({
                sessionGeneration: inFlight.protocol.sessionGeneration,
                deviceGeneration: inFlight.protocol.deviceGeneration,
                authoritativeEpoch: inFlight.protocol.authoritativeEpoch,
                submittedTickCount: inFlight.protocol.submittedTick
            }),
            results,
            pairs
        });
        this.inFlightBySourceTick.delete(sourceTick);
        this.preparedByFingerprint.set(inFlight.batchIdFingerprint, prepared);
        this.lastPrepareSubmittedTick = envelope.submittedTick;
        this.lastPrepareCompletedTick = sourceTick;
        this.lastProtocol = protocol;
        this.lastCompletionSourceTick = sourceTick;
        this.lastCompletionSubmittedTick = envelope.submittedTick;
        return Object.freeze({
            ...prepared,
            stale: false,
            protocolFailure: null
        });
    }

    requestPreparedTransformBatch(request) {
        this.#assertUsable();
        if (!this.ingressOpen || this.recoveryRequired) {
            return Object.freeze({
                accepted: false,
                reason: this.ingressCloseReason ?? 'formation-recovery-required'
            });
        }
        const batchIdFingerprint = requirePositiveSafeInteger(
            request?.batchIdFingerprint,
            'batchIdFingerprint',
            0xfffffffe
        );
        const prepared = this.preparedByFingerprint.get(batchIdFingerprint);
        if (!prepared) {
            return Object.freeze({ accepted: false, reason: 'prepared-batch-not-found' });
        }
        const targetFixedTick = requirePositiveSafeInteger(
            request?.targetFixedTick,
            'targetFixedTick'
        );
        if (targetFixedTick !== prepared.sourceTick + 1
            || targetFixedTick !== prepared.targetFixedTick) {
            this.preparedByFingerprint.delete(batchIdFingerprint);
            return Object.freeze({
                accepted: false,
                reason: 'atomic-transform-publication-deadline'
            });
        }
        if (!Array.isArray(request.records)
            || request.records.length !== prepared.pairs.length
            || request.records.length === 0) {
            throw new RangeError('prepared transform records가 mutual pair 수와 달라졌습니다.');
        }
        const records = request.records.map((record, index) => {
            const pair = prepared.pairs[index];
            const sourceHandles = record.sourceHandles.map((handle, sourceIndex) => (
                normalizeHandle(handle, `records[${index}].sourceHandles[${sourceIndex}]`)
            ));
            if (sourceHandles.length !== 2
                || compareHandles(sourceHandles[0], sourceHandles[1]) >= 0) {
                throw new RangeError('prepared transform sourceHandles는 exact ASC여야 합니다.');
            }
            const expectedHandles = [
                Object.freeze({
                    entityId: pair.left.sourceEntityId,
                    incarnation: pair.left.sourceIncarnation
                }),
                Object.freeze({
                    entityId: pair.right.sourceEntityId,
                    incarnation: pair.right.sourceIncarnation
                })
            ].sort(compareHandles);
            if (!sameHandle(sourceHandles[0], expectedHandles[0])
                || !sameHandle(sourceHandles[1], expectedHandles[1])) {
                throw new RangeError('prepared transform source pair가 completion과 다릅니다.');
            }
            if (!Array.isArray(record.sourceLineages)
                || record.sourceLineages.length !== 2) {
                throw new TypeError('prepared transform sourceLineages가 필요합니다.');
            }
            const expectedByKey = new Map([
                [
                    `${pair.left.sourceEntityId}:${pair.left.sourceIncarnation}`,
                    pair.left
                ],
                [
                    `${pair.right.sourceEntityId}:${pair.right.sourceIncarnation}`,
                    pair.right
                ]
            ]);
            const normalizedLineages = record.sourceLineages.map((lineage, sourceIndex) => {
                if (!Array.isArray(lineage)) {
                    throw new TypeError('sourceLineages entry는 exact handle 배열이어야 합니다.');
                }
                const handles = lineage.map((handle, memberIndex) => normalizeHandle(
                    handle,
                    `records[${index}].sourceLineages[${sourceIndex}][${memberIndex}]`
                )).sort(compareHandles);
                const expected = expectedByKey.get(handleKey(sourceHandles[sourceIndex]));
                if (!expected
                    || handles.length !== expected.memberCount
                    || createFormationLineageHash(handles) !== expected.lineageHash) {
                    throw new RangeError('source exact lineage가 prepared source와 다릅니다.');
                }
                return Object.freeze(handles);
            });
            const combinedLineage = normalizedLineages.flat().sort(compareHandles);
            for (let memberIndex = 1;
                memberIndex < combinedLineage.length;
                memberIndex++) {
                if (sameHandle(
                    combinedLineage[memberIndex - 1],
                    combinedLineage[memberIndex]
                )) {
                    throw new RangeError('combined Formation lineage가 중복되었습니다.');
                }
            }
            const destinationDescriptor
                = normalizeGpuPrivateHexaTransformDestinationIntent(
                    record.destinationDescriptor
                );
            const expectedGeneration = Math.max(
                pair.left.generation,
                pair.right.generation
            ) + 1;
            const expectedDisposition = combinedLineage.length === 6
                ? ENEMY_LIFECYCLE_DISPOSITION_ID.TRANSFORM_CONSUMED
                : ENEMY_LIFECYCLE_DISPOSITION_ID.MERGE_CONSUMED;
            if (destinationDescriptor.memberCount !== combinedLineage.length
                || destinationDescriptor.memberCount
                    !== pair.left.destinationMemberCount
                || destinationDescriptor.currentHealthCenti
                    !== pair.left.expectedMergedCurrentHealthCenti
                || destinationDescriptor.maxHealthCenti
                    !== pair.left.expectedMergedMaxHealthCenti
                || destinationDescriptor.formationOccupiedSlotMask
                    !== pair.left.destinationOccupiedSlotMask
                || destinationDescriptor.formationRotationStep
                    !== pair.left.destinationRotationStep
                || destinationDescriptor.formationGeneration !== expectedGeneration
                || destinationDescriptor.formationLineageHash
                    !== createFormationLineageHash(combinedLineage)
                || record.disposition !== expectedDisposition) {
                throw new RangeError('prepared transform destination descriptor가 pair와 다릅니다.');
            }
            return Object.freeze({
                sourceHandles: Object.freeze(sourceHandles),
                sourceLineages: Object.freeze(normalizedLineages),
                destinationDescriptor,
                disposition: requireNonEmptyString(record.disposition, 'disposition'),
                preparedPairIndex: index
            });
        });
        const commandId = requireNonEmptyString(request.commandId, 'commandId');
        const receipt = this.lifecyclePort.requestAtomicTransformBatch(
            Object.freeze({
                prepareSourceTick: prepared.sourceTick,
                batchIdFingerprint,
                records: Object.freeze(records)
            }),
            targetFixedTick,
            commandId
        );
        if (receipt?.accepted === true) {
            this.preparedByFingerprint.set(batchIdFingerprint, Object.freeze({
                ...prepared,
                lifecycleCommandId: receipt.commandId,
                transformRecords: Object.freeze(records)
            }));
        }
        return receipt;
    }

    discardPreparedBatch(request) {
        this.#assertUsable();
        const fingerprint = requirePositiveSafeInteger(
            request?.batchIdFingerprint,
            'batchIdFingerprint',
            0xfffffffe
        );
        const prepared = this.preparedByFingerprint.get(fingerprint);
        if (!prepared) {
            return Object.freeze({ accepted: false, reason: 'prepared-batch-not-found' });
        }
        this.preparedByFingerprint.delete(fingerprint);
        this.#rememberBatch(prepared.sourceTick);
        return Object.freeze({ accepted: true, batchIdFingerprint: fingerprint });
    }

    armPreparedFormationTransformBatch(request) {
        this.#assertUsable();
        const prepared = this.preparedByFingerprint.get(
            request?.batchIdFingerprint
        );
        if (!prepared
            || prepared.lifecycleCommandId !== request.commandId
            || request.prepareSourceTick !== prepared.sourceTick
            || request.targetFixedTick !== prepared.sourceTick + 1
            || !Array.isArray(request.records)
            || request.records.length !== prepared.pairs.length) {
            return this.#fail('transform-arm', 'prepared-provenance-mismatch');
        }
        const records = request.records.map((record, index) => {
            const pair = prepared.pairs[index];
            const transformRecord = prepared.transformRecords?.[index];
            const ordered = [pair.left, pair.right].sort((left, right) => (
                left.sourceEntityId - right.sourceEntityId
                || left.sourceIncarnation - right.sourceIncarnation
            ));
            const destinationIntent = record.destinationIntent;
            const state = destinationIntent?.formationState;
            const destinationHandle = normalizeHandle(
                record.destinationHandle,
                `records[${index}].destinationHandle`
            );
            const expectedDescriptor = transformRecord?.destinationDescriptor;
            if (destinationHandle.entityId !== ordered[0].sourceEntityId
                || destinationHandle.incarnation
                    !== ordered[0].sourceIncarnation + 1
                || !state
                || !expectedDescriptor
                || !Array.isArray(record.sourceHandles)
                || record.sourceHandles.length !== 2
                || !sameHandle(record.sourceHandles[0], {
                    entityId: ordered[0].sourceEntityId,
                    incarnation: ordered[0].sourceIncarnation
                })
                || !sameHandle(record.sourceHandles[1], {
                    entityId: ordered[1].sourceEntityId,
                    incarnation: ordered[1].sourceIncarnation
                })
                || record.disposition !== transformRecord.disposition
                || state.memberCount !== expectedDescriptor.memberCount
                || state.occupiedSlotMask
                    !== expectedDescriptor.formationOccupiedSlotMask
                || state.rotationStep
                    !== expectedDescriptor.formationRotationStep
                || state.generation !== expectedDescriptor.formationGeneration
                || state.lineageHash
                    !== expectedDescriptor.formationLineageHash
                || destinationIntent.healthFixedPoint
                    !== expectedDescriptor.currentHealthCenti
                || destinationIntent.maxHealthFixedPoint
                    !== expectedDescriptor.maxHealthCenti) {
                throw new RangeError('Formation destination root/state가 올바르지 않습니다.');
            }
            const sourceA = Object.freeze({
                entityId: ordered[0].sourceEntityId,
                incarnation: ordered[0].sourceIncarnation,
                memberCount: ordered[0].memberCount,
                occupiedSlotMask: ordered[0].occupiedSlotMask,
                rotationStep: ordered[0].rotationStep,
                generation: ordered[0].generation,
                lineageHash: ordered[0].lineageHash,
                currentHealthCenti: ordered[0].currentHealthCenti,
                maxHealthCenti: ordered[0].maxHealthCenti
            });
            const sourceB = Object.freeze({
                entityId: ordered[1].sourceEntityId,
                incarnation: ordered[1].sourceIncarnation,
                memberCount: ordered[1].memberCount,
                occupiedSlotMask: ordered[1].occupiedSlotMask,
                rotationStep: ordered[1].rotationStep,
                generation: ordered[1].generation,
                lineageHash: ordered[1].lineageHash,
                currentHealthCenti: ordered[1].currentHealthCenti,
                maxHealthCenti: ordered[1].maxHealthCenti
            });
            const motionRootProgramIndex = pair.left.motionRootProgramIndex;
            const motionRoot = pair.left.programIndex === motionRootProgramIndex
                ? pair.left
                : pair.right.programIndex === motionRootProgramIndex
                    ? pair.right
                    : null;
            const motionSourceIndex = motionRoot === null
                ? -1
                : ordered.findIndex((source) => (
                    source.programIndex === motionRoot.programIndex
                ));
            if (motionSourceIndex < 0 || motionSourceIndex > 1) {
                throw new RangeError('Formation motion source provenance가 다릅니다.');
            }
            return Object.freeze({
                fingerprint: hashValues([
                    prepared.batchIdFingerprint,
                    sourceA.entityId,
                    sourceA.incarnation,
                    sourceB.entityId,
                    sourceB.incarnation,
                    destinationHandle.entityId,
                    destinationHandle.incarnation,
                    state.generation,
                    state.lineageHash
                ]),
                sourceA,
                sourceB,
                destination: Object.freeze({
                    entityId: destinationHandle.entityId,
                    incarnation: destinationHandle.incarnation,
                    definitionCode: state.definitionCode,
                    coordinateSystemCode: state.coordinateSystemCode,
                    policyCode: state.policyCode,
                    memberCount: state.memberCount,
                    occupiedSlotMask: state.occupiedSlotMask,
                    rotationStep: state.rotationStep,
                    generation: state.generation,
                    flags: state.flags,
                    lineageHash: state.lineageHash
                }),
                expectedCurrentHealthCenti:
                    destinationIntent.healthFixedPoint,
                expectedMaxHealthCenti:
                    destinationIntent.maxHealthFixedPoint,
                // Transform ABI의 scalar destination fields는 storage에서 f32로
                // round-trip됩니다. authored plan도 같은 정밀도로 고정해야 정상
                // GPU completion을 JS double과 비교해 recovery로 오판하지 않습니다.
                destinationRadius: Math.fround(destinationIntent.radius),
                destinationInverseMass: Math.fround(destinationIntent.inverseMass),
                destinationFlowSpeed: Math.fround(destinationIntent.flowSpeed),
                destinationTowerContactDamage:
                    Math.fround(destinationIntent.towerContactDamage),
                motionSourceIndex
            });
        });
        const armRequest = Object.freeze({
            abiVersion: GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION,
            batchIdFingerprint: hashValues([
                prepared.batchIdFingerprint,
                request.targetFixedTick,
                ...records.map((record) => record.fingerprint)
            ]),
            prepareBatchIdFingerprint: prepared.batchIdFingerprint,
            preparedSourceTick: prepared.sourceTick,
            targetFixedTick: request.targetFixedTick,
            prepareProtocol: prepared.protocol,
            records: Object.freeze(records)
        });
        let armed;
        try {
            armed = this.backend.armPreparedFormationTransformBatch(armRequest);
        } catch (error) {
            return this.#fail('transform-arm', 'backend-exception', error?.message);
        }
        if (armed?.abiVersion !== GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION
            || armed.accepted !== true
            || armed.preparedSourceTick !== prepared.sourceTick
            || armed.targetFixedTick !== request.targetFixedTick
            || armed.armedCount !== records.length
            || !armed.receipt
            || armed.evidence?.sessionGeneration !== this.sessionGeneration
            || armed.evidence?.deviceGeneration
                !== prepared.protocol.deviceGeneration
            || armed.evidence?.authoritativeEpoch
                !== prepared.protocol.authoritativeEpoch
            || armed.evidence?.batchIdFingerprint
                !== armRequest.batchIdFingerprint
            || armed.requiresRecovery === true) {
            return this.#fail(
                'transform-arm',
                armed?.reason ?? 'backend-arm-rejected'
            );
        }
        this.armedReceipts.set(armed.receipt, Object.freeze({
            batchIdFingerprint: prepared.batchIdFingerprint,
            transformBatchIdFingerprint: armRequest.batchIdFingerprint,
            targetFixedTick: request.targetFixedTick,
            armedCount: records.length,
            prepareProtocol: prepared.protocol,
            prepareCompletionSubmittedTick: prepared.completionSubmittedTick,
            completionProtocol: Object.freeze({ ...armed.evidence }),
            records
        }));
        return Object.freeze({
            accepted: true,
            receipt: armed.receipt,
            requiresRecovery: false
        });
    }

    commitArmedFormationTransformBatch(receipt) {
        this.#assertUsable();
        const expected = this.armedReceipts.get(receipt);
        if (!expected) {
            return this.#fail('transform-commit', 'armed-receipt-invalid');
        }
        this.armedReceipts.delete(receipt);
        let committed;
        try {
            committed = this.backend.commitArmedFormationTransformBatch(receipt);
        } catch (error) {
            return this.#fail('transform-commit', 'backend-exception', error?.message);
        }
        if (committed?.abiVersion !== GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION
            || committed.accepted !== true
            || committed.targetFixedTick !== expected.targetFixedTick
            || committed.commitRequested !== true
            || committed.armedCount !== expected.armedCount
            || committed.requiresRecovery === true) {
            return this.#fail(
                'transform-commit',
                committed?.reason ?? 'backend-commit-rejected'
            );
        }
        if (this.pendingTransformCompletionByTick.has(expected.targetFixedTick)) {
            return this.#fail(
                'transform-commit',
                'transform-completion-tick-conflict'
            );
        }
        this.pendingTransformCompletionByTick.set(
            expected.targetFixedTick,
            expected
        );
        this.preparedByFingerprint.delete(expected.batchIdFingerprint);
        this.#rememberBatch(expected.targetFixedTick - 1);
        return Object.freeze({ accepted: true, requiresRecovery: false });
    }

    cancelArmedFormationTransformBatch(receipt) {
        this.#assertUsable();
        const expected = this.armedReceipts.get(receipt);
        if (!expected) {
            return Object.freeze({
                accepted: false,
                reason: 'armed-receipt-invalid',
                requiresRecovery: false
            });
        }
        this.armedReceipts.delete(receipt);
        let cancelled;
        try {
            cancelled = this.backend.cancelArmedFormationTransformBatch(receipt);
        } catch (error) {
            return this.#fail('transform-cancel', 'backend-exception', error?.message);
        }
        if (cancelled?.abiVersion !== GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION
            || cancelled.accepted !== true
            || cancelled.cancelledCount !== expected.armedCount
            || cancelled.requiresRecovery === true) {
            return this.#fail(
                'transform-cancel',
                cancelled?.reason ?? 'backend-cancel-rejected'
            );
        }
        this.preparedByFingerprint.delete(expected.batchIdFingerprint);
        this.#rememberBatch(expected.targetFixedTick - 1);
        return Object.freeze({ accepted: true, requiresRecovery: false });
    }

    observeLifecycleCommit(commit) {
        if (this.destroyed || !commit || typeof commit !== 'object') {
            return;
        }
        const rejectedParents = new Set(
            (commit.rejected ?? []).map((entry) => entry.commandId)
        );
        for (const [fingerprint, prepared] of this.preparedByFingerprint) {
            if (prepared.lifecycleCommandId
                && rejectedParents.has(prepared.lifecycleCommandId)) {
                this.preparedByFingerprint.delete(fingerprint);
                this.#rememberBatch(prepared.sourceTick);
            }
        }
    }

    closeIngress(reason = 'gameplay-ingress-closed', finalFixedTick = null) {
        this.#assertUsable();
        if (!this.ingressOpen) {
            return this.terminalCancel;
        }
        this.ingressOpen = false;
        this.ingressCloseReason = typeof reason === 'string' && reason.length > 0
            ? reason
            : 'gameplay-ingress-closed';
        const tick = requirePositiveSafeInteger(finalFixedTick, 'finalFixedTick');
        if (this.pendingTransformCompletionByTick.size !== 0) {
            return this.#fail(
                'terminal-cancel',
                'unverified-transform-completion-before-terminal'
            );
        }
        const backendBefore = this.backend.getFormationRuntimeStatus();
        if (backendBefore?.abiVersion !== GPU_FORMATION_RUNTIME_ABI_VERSION
            || backendBefore.requiresRecovery === true) {
            return this.#fail(
                'terminal-cancel',
                'terminal-backend-preflight-invalid'
            );
        }
        const expectedPrepareProgramCount = Number(
            backendBefore.pendingPrepareProgramCount ?? 0
        );
        const expectedArmedTransformCount = Number(
            backendBefore.armedTransformCount ?? 0
        );
        this.queuedPrepare = null;
        this.inFlightBySourceTick.clear();
        this.deferredCompletions.length = 0;
        this.preparedByFingerprint.clear();
        this.armedReceipts.clear();
        let evidence;
        try {
            evidence = this.backend.cancelPendingFormationProgramsForTerminal(
                Object.freeze({
                    abiVersion: GPU_FORMATION_TERMINAL_CANCEL_ABI_VERSION,
                    finalFixedTick: tick
                })
            );
        } catch (error) {
            return this.#fail('terminal-cancel', 'backend-exception', error?.message);
        }
        if (evidence?.abiVersion !== GPU_FORMATION_TERMINAL_CANCEL_ABI_VERSION
            || evidence.finalFixedTick !== tick
            || evidence.state !== 'armed'
            || evidence.submittedTick !== 0
            || evidence.prepareProgramCount !== expectedPrepareProgramCount
            || evidence.armedTransformCount !== expectedArmedTransformCount
            || evidence.pendingPrepareProgramCount !== 0
            || evidence.pendingPrepareReadbackCount !== 0
            || evidence.failure !== null) {
            return this.#fail('terminal-cancel', 'terminal-evidence-invalid');
        }
        const backendAfter = this.backend.getFormationRuntimeStatus();
        if (backendAfter?.terminal !== evidence
            || backendAfter.pendingPrepareProgramCount !== 0
            || backendAfter.pendingPrepareReadbackCount !== 0
            || backendAfter.pendingTransformReadbackCount !== 0
            || backendAfter.armedTransformCount !== 0
            || backendAfter.commitRequested === true) {
            return this.#fail(
                'terminal-cancel',
                'terminal-backend-retirement-mismatch'
            );
        }
        this.terminalCancel = Object.freeze({ ...evidence });
        return this.terminalCancel;
    }

    getTerminalCancelStatus() {
        const backend = this.backend.getFormationRuntimeStatus()?.terminal ?? null;
        return Object.freeze({ owner: this.terminalCancel, backend });
    }

    getPendingCount() {
        return (this.queuedPrepare ? 1 : 0)
            + this.inFlightBySourceTick.size
            + this.preparedByFingerprint.size
            + this.armedReceipts.size
            + this.pendingTransformCompletionByTick.size;
    }

    getStatus() {
        const backend = this.destroyed
            ? null
            : this.backend.getFormationRuntimeStatus();
        return Object.freeze({
            abiVersion: GPU_FORMATION_RUNTIME_ABI_VERSION,
            ingressOpen: this.ingressOpen,
            ingressCloseReason: this.ingressCloseReason,
            pendingPrepareBatchCount: this.queuedPrepare ? 1 : 0,
            inFlightPrepareBatchCount: this.inFlightBySourceTick.size,
            preparedTransformBatchCount: this.preparedByFingerprint.size,
            armedTransformBatchCount: this.armedReceipts.size,
            pendingTransformCompletionCount:
                this.pendingTransformCompletionByTick.size,
            lastValidatedTransformTick: this.lastValidatedTransformTick,
            lastPrepareSourceTick: this.lastPrepareSourceTick,
            lastPrepareSubmittedTick: this.lastPrepareSubmittedTick,
            lastPrepareCompletedTick: this.lastPrepareCompletedTick,
            recoveryRequired: this.recoveryRequired,
            failure: this.failure,
            terminal: this.terminalCancel,
            backend,
            destroyed: this.destroyed
        });
    }

    requiresRecovery() {
        return !this.destroyed && this.recoveryRequired;
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.queuedPrepare = null;
        this.inFlightBySourceTick.clear();
        this.deferredCompletions.length = 0;
        this.preparedByFingerprint.clear();
        this.knownBatchFingerprints.clear();
        this.history.length = 0;
        this.rememberedBatchTicks.clear();
        this.armedReceipts.clear();
        this.pendingTransformCompletionByTick.clear();
        this.backend = null;
        this.registry = null;
        this.lifecyclePort = null;
    }

    #revalidatePrepareRecords(batch, fixedTick, lifecycleCommit) {
        const despawnProofs = this.#readLifecycleDespawnProofs(
            lifecycleCommit,
            fixedTick
        );
        return Object.freeze(batch.records.map((record, index) => {
            const registryHas = this.registry.has(record.sourceHandle);
            const backendHas = this.backend.hasBody(record.sourceHandle);
            let flags = 0;
            if (!registryHas) {
                if (!despawnProofs.has(handleKey(record.sourceHandle))) {
                    if (backendHas) {
                        throw new RangeError(
                            `records[${index}] registry/backend exact identity가 다릅니다.`
                        );
                    }
                    throw new RangeError(
                        `records[${index}] missing source에 authentic lifecycle proof가 없습니다.`
                    );
                }
                // Formation transform은 같은 command encoder에서 새 prepare보다
                // 먼저 GPU body를 교체합니다. Host registry는 lifecycle commit에서
                // 먼저 source를 제거하므로 이 boundary에만 registry-missing /
                // backend-live가 정상입니다. authentic despawn proof가 있는 exact
                // source만 ALLOW_SOURCE_INVALID로 넘기고 GPU 결과에서 다시 봉인합니다.
                flags = GPU_FORMATION_PREPARE_PROGRAM_FLAG.ALLOW_SOURCE_INVALID;
            } else {
                if (!backendHas) {
                    throw new RangeError(
                        `records[${index}] registry/backend exact identity가 다릅니다.`
                    );
                }
                const current = copyExpectedFormationState(
                    this.registry.copyEntityView(record.sourceHandle, {}),
                    `records[${index}].currentSource`
                );
                for (const field of Object.keys(record.expectedState)) {
                    if (current[field] !== record.expectedState[field]) {
                        throw new RangeError(
                            `records[${index}] Formation source state가 stage 전에 바뀌었습니다.`
                        );
                    }
                }
            }
            return Object.freeze({
                sourceEntityId: record.sourceHandle.entityId,
                sourceIncarnation: record.sourceHandle.incarnation,
                prepareSequence: record.prepareSequence,
                fingerprint: record.fingerprint,
                flags
            });
        }));
    }

    #readLifecycleDespawnProofs(lifecycleCommit, fixedTick) {
        if (lifecycleCommit === null || lifecycleCommit === undefined) {
            return new Set();
        }
        const commits = Array.isArray(lifecycleCommit)
            ? lifecycleCommit
            : [lifecycleCommit];
        const proofs = new Set();
        for (let commitIndex = 0; commitIndex < commits.length; commitIndex++) {
            const commit = commits[commitIndex];
            if (!this.lifecycleCommitProofPort
                || this.lifecycleCommitProofPort.isAuthenticCommit(
                    commit,
                    fixedTick
                ) !== true
                || commit?.fixedTick !== fixedTick
                || commit.recoveryRequired !== false
                || !Array.isArray(commit.despawned)) {
                throw new RangeError(
                    'Formation source lifecycle proof가 authentic same-boundary commit이 아닙니다.'
                );
            }
            for (let index = 0; index < commit.despawned.length; index++) {
                const entry = commit.despawned[index];
                requireNonEmptyString(
                    entry?.commandId,
                    `lifecycleCommit[${commitIndex}].despawned[${index}].commandId`
                );
                requireNonEmptyString(
                    entry?.reason,
                    `lifecycleCommit[${commitIndex}].despawned[${index}].reason`
                );
                const key = handleKey(normalizeHandle(
                    entry?.handle,
                    `lifecycleCommit[${commitIndex}].despawned[${index}].handle`
                ));
                if (proofs.has(key)) {
                    throw new RangeError(
                        `Formation lifecycle despawn exact identity가 중복되었습니다: ${key}`
                    );
                }
                proofs.add(key);
            }
        }
        return proofs;
    }

    #validateTransformCompletionAtBoundary(fixedTick) {
        if (this.pendingTransformCompletionByTick.size === 0) {
            return Object.freeze({ accepted: true, requiresRecovery: false });
        }
        const due = [...this.pendingTransformCompletionByTick.entries()]
            .filter(([targetFixedTick]) => targetFixedTick < fixedTick);
        if (due.length !== 1 || due[0][0] !== fixedTick - 1) {
            return this.#fail(
                'transform-completion',
                'transform-completion-deadline'
            );
        }
        const [targetFixedTick, expected] = due[0];
        const runtime = this.backend.getFormationRuntimeStatus();
        const completion = runtime?.lastTransformCompletion;
        const completionIsOlder = completion
            && Number.isSafeInteger(completion.sourceTick)
            && completion.sourceTick < targetFixedTick;
        if ((!completion || completionIsOlder)
            && runtime?.abiVersion === GPU_FORMATION_RUNTIME_ABI_VERSION
            && runtime.state === 'ready'
            && runtime.sessionGeneration
                === expected.completionProtocol.sessionGeneration
            && runtime.deviceGeneration
                === expected.completionProtocol.deviceGeneration
            && runtime.authoritativeEpoch
                === expected.completionProtocol.authoritativeEpoch
            && runtime.requiresRecovery === false
            && runtime.failure === null
            && runtime.pendingTransformReadbackCount === 1
            && runtime.armedTransformCount === 0
            && runtime.commitRequested === false) {
            return Object.freeze({
                accepted: false,
                pending: true,
                requiresRecovery: false,
                targetFixedTick
            });
        }
        if (runtime?.abiVersion !== GPU_FORMATION_RUNTIME_ABI_VERSION
            || runtime.requiresRecovery === true
            || !completion
            || completion.abiVersion
                !== GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION
            || completion.sessionGeneration
                !== expected.completionProtocol.sessionGeneration
            || completion.deviceGeneration
                !== expected.completionProtocol.deviceGeneration
            || completion.authoritativeEpoch
                !== expected.completionProtocol.authoritativeEpoch
            || completion.preparedSourceTick !== targetFixedTick - 1
            || completion.sourceTick !== targetFixedTick
            || !Number.isSafeInteger(completion.submittedTick)
            || completion.submittedTick
                !== expected.prepareCompletionSubmittedTick + 1
            || completion.completedThroughTick !== targetFixedTick
            || completion.batchIdFingerprint
                !== expected.transformBatchIdFingerprint
            || completion.programCount !== expected.armedCount
            || completion.committedCount !== expected.armedCount
            || completion.status !== GPU_FORMATION_RUNTIME_STATUS.OK
            || completion.preparedEffectRekeyCount
                !== completion.effectRekeyCount
            || !Array.isArray(completion.results)
            || completion.results.length !== expected.armedCount) {
            return this.#fail(
                'transform-completion',
                'transform-completion-envelope-mismatch'
            );
        }
        let preparedEffectRekeyCount = 0;
        let effectRekeyCount = 0;
        try {
            for (let index = 0; index < expected.records.length; index++) {
                const authored = expected.records[index];
                const result = completion.results[index];
                if (result?.result !== GPU_FORMATION_TRANSFORM_RESULT.COMMITTED
                    || result.fingerprint !== authored.fingerprint
                    || result.prepareBatchFingerprint
                        !== expected.batchIdFingerprint
                    || result.preparedSourceTick !== targetFixedTick - 1
                    || result.targetFixedTick !== targetFixedTick
                    || result.expectedCurrentHealthCenti
                        !== authored.expectedCurrentHealthCenti
                    || result.expectedMaxHealthCenti
                        !== authored.expectedMaxHealthCenti
                    || result.destinationRadius !== authored.destinationRadius
                    || result.destinationInverseMass
                        !== authored.destinationInverseMass
                    || result.destinationFlowSpeed
                        !== authored.destinationFlowSpeed
                    || result.destinationTowerContactDamage
                        !== authored.destinationTowerContactDamage
                    || result.motionSourceIndex !== authored.motionSourceIndex
                    || result.preparedEffectRekeyCount
                        !== result.effectRekeyCount) {
                    throw new RangeError(
                        `transform completion record가 authored plan과 다릅니다: ${index}`
                    );
                }
                for (const field of [
                    'entityId',
                    'incarnation',
                    'memberCount',
                    'occupiedSlotMask',
                    'rotationStep',
                    'generation',
                    'lineageHash',
                    'currentHealthCenti',
                    'maxHealthCenti'
                ]) {
                    if (result.sourceA?.[field] !== authored.sourceA[field]
                        || result.sourceB?.[field] !== authored.sourceB[field]) {
                        throw new RangeError(
                            `transform completion source snapshot이 다릅니다: ${index}/${field}`
                        );
                    }
                }
                for (const field of [
                    'entityId',
                    'incarnation',
                    'definitionCode',
                    'coordinateSystemCode',
                    'policyCode',
                    'memberCount',
                    'occupiedSlotMask',
                    'rotationStep',
                    'generation',
                    'flags',
                    'lineageHash'
                ]) {
                    if (result.destination?.[field]
                        !== authored.destination[field]) {
                        throw new RangeError(
                            `transform completion destination snapshot이 다릅니다: ${index}/${field}`
                        );
                    }
                }
                preparedEffectRekeyCount += result.preparedEffectRekeyCount;
                effectRekeyCount += result.effectRekeyCount;
            }
        } catch (error) {
            return this.#fail(
                'transform-completion',
                'transform-completion-record-mismatch',
                error?.message
            );
        }
        if (preparedEffectRekeyCount !== completion.preparedEffectRekeyCount
            || effectRekeyCount !== completion.effectRekeyCount) {
            return this.#fail(
                'transform-completion',
                'transform-effect-rekey-count-mismatch'
            );
        }
        this.pendingTransformCompletionByTick.delete(targetFixedTick);
        this.lastValidatedTransformTick = targetFixedTick;
        return Object.freeze({
            accepted: true,
            requiresRecovery: false,
            targetFixedTick,
            committedCount: expected.armedCount,
            effectRekeyCount
        });
    }

    #completionFailure(targetFixedTick, code, detail = null) {
        this.#fail('prepare-completion', code, detail);
        return Object.freeze({
            targetFixedTick,
            sourceTick: 0,
            batchIdFingerprint: 0,
            results: Object.freeze([]),
            pairs: Object.freeze([]),
            stale: false,
            protocolFailure: this.failure
        });
    }

    #fail(stage, code, detail = null) {
        this.recoveryRequired = true;
        this.failure = freezeFailure(stage, code, detail);
        return Object.freeze({
            accepted: false,
            reason: code,
            requiresRecovery: true,
            failure: this.failure
        });
    }

    #rememberBatch(sourceTick) {
        if (!Number.isSafeInteger(sourceTick) || sourceTick <= 0) {
            return;
        }
        if (this.rememberedBatchTicks.has(sourceTick)) {
            return;
        }
        this.rememberedBatchTicks.add(sourceTick);
        this.history.push(sourceTick);
        while ((this.history.length - this.historyHead) > this.historyCapacity) {
            const expiredTick = this.history[this.historyHead++];
            this.knownBatchFingerprints.delete(expiredTick);
            this.rememberedBatchTicks.delete(expiredTick);
        }
        if (this.historyHead >= this.historyCapacity) {
            this.history = this.history.slice(this.historyHead);
            this.historyHead = 0;
        }
    }

    #assertUsable() {
        if (this.destroyed) {
            throw new Error('destroy된 GpuFormationCommandOwner는 사용할 수 없습니다.');
        }
    }
}
