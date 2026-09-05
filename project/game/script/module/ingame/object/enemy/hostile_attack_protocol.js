// Hostile attack identity, field validation, and replay-stable command protocol.
const INVALID_HANDLE_COMPONENT = 0xffffffff;

const CANONICAL_EXACT_HANDLES = new WeakSet();

export const HOSTILE_ATTACK_TARGET_MODE = Object.freeze({
    CURRENT_TOWER: 'current-tower',
    CORE_PRIORITY_SELECTED: 'core-priority-selected'
});

export const HOSTILE_ATTACK_COMMAND_NAMESPACE = 'gpu-hostile-archer-shot';

export const HOSTILE_ATTACK_CONTROL_COMMAND_NAMESPACE
    = 'gpu-hostile-rhom-priority-control';

export const HOSTILE_ATTACK_SHOT_STATE = Object.freeze({
    IDLE: 'IDLE',
    REQUESTED_FOR_FIXED_TICK: 'REQUESTED_FOR_FIXED_TICK',
    GPU_RESOLVE_PENDING: 'GPU_RESOLVE_PENDING'
});

export function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

export function requirePositiveSafeInteger(value, label) {
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

export function requireNonNegativeSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
        throw new RangeError(`${label}은 0 이상의 안전한 정수여야 합니다.`);
    }
    return number;
}

export function requirePositiveFloat32(value, label) {
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

export function freezeHandle(source, label) {
    if (!source || typeof source !== 'object') {
        throw new TypeError(`${label}은 exact handle 객체여야 합니다.`);
    }
    if (CANONICAL_EXACT_HANDLES.has(source)) {
        return source;
    }
    const handle = Object.freeze({
        entityId: requireExactIdentityComponent(source.entityId, `${label}.entityId`),
        incarnation: requireExactIdentityComponent(
            source.incarnation,
            `${label}.incarnation`
        )
    });
    CANONICAL_EXACT_HANDLES.add(handle);
    return handle;
}

export function sameHandle(left, right) {
    return left?.entityId === right?.entityId
        && left?.incarnation === right?.incarnation;
}

export function handleKey(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

export function freezeVector(source, label) {
    if (!source || typeof source !== 'object') {
        throw new TypeError(`${label} 벡터가 필요합니다.`);
    }
    return Object.freeze({
        x: requireFiniteFloat32(source.x, `${label}.x`),
        y: requireFiniteFloat32(source.y, `${label}.y`)
    });
}

export function checkedTickSum(left, right, label) {
    const result = left + right;
    if (!Number.isSafeInteger(result) || result <= 0) {
        throw new RangeError(`${label}이 안전한 fixed tick 범위를 벗어났습니다.`);
    }
    return result;
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
    const common = [
        HOSTILE_ATTACK_COMMAND_NAMESPACE,
        requirePositiveSafeInteger(options.sessionGeneration, 'sessionGeneration'),
        sourceHandle.entityId,
        sourceHandle.incarnation
    ];
    if (options.coreTargetHandle !== undefined
        && options.coreTargetHandle !== null) {
        const coreTargetHandle = freezeHandle(
            options.coreTargetHandle,
            'coreTargetHandle'
        );
        const towerTargetHandle = options.towerTargetHandle === undefined
            || options.towerTargetHandle === null
            ? null
            : freezeHandle(options.towerTargetHandle, 'towerTargetHandle');
        common.push(
            'selected',
            'core',
            coreTargetHandle.entityId,
            coreTargetHandle.incarnation,
            'tower',
            towerTargetHandle?.entityId ?? 'none',
            towerTargetHandle?.incarnation ?? 'none',
            'range',
            Math.fround(requirePositiveFloat32(
                options.attackRangeTiles,
                'attackRangeTiles'
            ))
        );
    } else {
        const targetHandle = freezeHandle(options.targetHandle, 'targetHandle');
        // Legacy Archer command identity를 바꾸지 않습니다.
        common.push(targetHandle.entityId, targetHandle.incarnation);
    }
    common.push(
        requirePositiveSafeInteger(options.targetFixedTick, 'targetFixedTick'),
        requireNonNegativeSafeInteger(options.shotSequence, 'shotSequence'),
        encodeURIComponent(requireNonEmptyString(
            options.attackDefinitionId,
            'attackDefinitionId'
        ))
    );
    return common.join(':');
}

/** M priority control의 exact candidate/range/tick/sequence/attack fingerprint입니다. */
export function createHostileAttackControlCommandId(options = {}) {
    const sourceHandle = freezeHandle(options.sourceHandle, 'sourceHandle');
    const coreTargetHandle = freezeHandle(
        options.coreTargetHandle,
        'coreTargetHandle'
    );
    const towerTargetHandle = options.towerTargetHandle === undefined
        || options.towerTargetHandle === null
        ? null
        : freezeHandle(options.towerTargetHandle, 'towerTargetHandle');
    return [
        HOSTILE_ATTACK_CONTROL_COMMAND_NAMESPACE,
        requirePositiveSafeInteger(options.sessionGeneration, 'sessionGeneration'),
        sourceHandle.entityId,
        sourceHandle.incarnation,
        'core',
        coreTargetHandle.entityId,
        coreTargetHandle.incarnation,
        'tower',
        towerTargetHandle?.entityId ?? 'none',
        towerTargetHandle?.incarnation ?? 'none',
        'range',
        Math.fround(requirePositiveFloat32(
            options.attackRangeTiles,
            'attackRangeTiles'
        )),
        requirePositiveSafeInteger(options.targetFixedTick, 'targetFixedTick'),
        requireNonNegativeSafeInteger(
            options.selectionSequence,
            'selectionSequence'
        ),
        encodeURIComponent(requireNonEmptyString(
            options.attackDefinitionId,
            'attackDefinitionId'
        ))
    ].join(':');
}

export function createCanonicalHostileControlCommandId(
    sessionGeneration,
    record,
    coreTargetHandle,
    towerTargetHandle,
    targetFixedTick
) {
    return `${HOSTILE_ATTACK_CONTROL_COMMAND_NAMESPACE}:${sessionGeneration}`
        + `:${record.handle.entityId}:${record.handle.incarnation}`
        + `:core:${coreTargetHandle.entityId}:${coreTargetHandle.incarnation}`
        + `:tower:${towerTargetHandle?.entityId ?? 'none'}`
        + `:${towerTargetHandle?.incarnation ?? 'none'}`
        + `:range:${Math.fround(record.attack.attackRangeTiles)}`
        + `:${targetFixedTick}:${record.shotSequence}`
        + `:${record.encodedAttackDefinitionId}`;
}

export function createCanonicalHostileShotCommandId(
    sessionGeneration,
    record,
    targetHandle,
    coreTargetHandle,
    towerTargetHandle,
    targetFixedTick
) {
    const prefix = `${HOSTILE_ATTACK_COMMAND_NAMESPACE}:${sessionGeneration}`
        + `:${record.handle.entityId}:${record.handle.incarnation}`;
    const targetIdentity = record.attack.targetMode
        === HOSTILE_ATTACK_TARGET_MODE.CORE_PRIORITY_SELECTED
        ? `:selected:core:${coreTargetHandle.entityId}`
            + `:${coreTargetHandle.incarnation}`
            + `:tower:${towerTargetHandle?.entityId ?? 'none'}`
            + `:${towerTargetHandle?.incarnation ?? 'none'}`
            + `:range:${Math.fround(record.attack.attackRangeTiles)}`
        : `:${targetHandle.entityId}:${targetHandle.incarnation}`;
    return prefix + targetIdentity
        + `:${targetFixedTick}:${record.shotSequence}`
        + `:${record.encodedAttackDefinitionId}`;
}
