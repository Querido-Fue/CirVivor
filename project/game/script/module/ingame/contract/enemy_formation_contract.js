/**
 * Effect/EnemyBehaviorState와 독립인 persistent Formation domain의 stable vocabulary입니다.
 * 이 module은 content catalog를 import하지 않습니다.
 */

export const FORMATION_COORDINATE_SYSTEM = Object.freeze({
    LINEAR_GRID: 'LINEAR_GRID',
    HEX_AXIAL: 'HEX_AXIAL',
    PATH_RELATIVE: 'PATH_RELATIVE'
});

/** 0은 Formation 없음이며 실제 좌표계 code는 append-only입니다. */
export const FORMATION_COORDINATE_SYSTEM_CODE = Object.freeze({
    NONE: 0,
    LINEAR_GRID: 1,
    HEX_AXIAL: 2,
    PATH_RELATIVE: 3
});

export const FORMATION_COORDINATE_SYSTEM_CODE_BY_ID = Object.freeze({
    [FORMATION_COORDINATE_SYSTEM.LINEAR_GRID]:
        FORMATION_COORDINATE_SYSTEM_CODE.LINEAR_GRID,
    [FORMATION_COORDINATE_SYSTEM.HEX_AXIAL]:
        FORMATION_COORDINATE_SYSTEM_CODE.HEX_AXIAL,
    [FORMATION_COORDINATE_SYSTEM.PATH_RELATIVE]:
        FORMATION_COORDINATE_SYSTEM_CODE.PATH_RELATIVE
});

export const ENEMY_FORMATION_POLICY = Object.freeze({
    NONE: 'none',
    SEEK_FORMATION: 'seek-formation',
    KEEP_FORMATION: 'keep-formation'
});

/** 0은 Formation 없음이며 실제 policy code는 append-only입니다. */
export const ENEMY_FORMATION_POLICY_CODE = Object.freeze({
    NONE: 0,
    SEEK_FORMATION: 1,
    KEEP_FORMATION: 2
});

export const ENEMY_FORMATION_POLICY_CODE_BY_ID = Object.freeze({
    [ENEMY_FORMATION_POLICY.NONE]: ENEMY_FORMATION_POLICY_CODE.NONE,
    [ENEMY_FORMATION_POLICY.SEEK_FORMATION]:
        ENEMY_FORMATION_POLICY_CODE.SEEK_FORMATION,
    [ENEMY_FORMATION_POLICY.KEEP_FORMATION]:
        ENEMY_FORMATION_POLICY_CODE.KEEP_FORMATION
});

export const FORMATION_RUNTIME_FLAG = Object.freeze({
    ACTIVE: 0x1
});

export const FORMATION_COORDINATE_SYSTEM_METHOD = Object.freeze({
    RESOLVE_LOCAL_OFFSET: 'resolveLocalOffset',
    ROTATE_COORDINATE: 'rotateCoordinate'
});

export const FORMATION_SLOT_GRAPH_METHOD = Object.freeze({
    GET_SLOT_COUNT: 'getSlotCount',
    GET_NEIGHBOR_MASK: 'getNeighborMask',
    ROTATE_SLOT_INDEX: 'rotateSlotIndex',
    IS_CONNECTED_OCCUPANCY_MASK: 'isConnectedOccupancyMask'
});

export const FORMATION_MEMBERSHIP_METHOD = Object.freeze({
    GET_MEMBER_COUNT: 'getMemberCount',
    HAS_EXACT_MEMBER: 'hasExactMember',
    COPY_EXACT_MEMBER_HANDLE_AT: 'copyExactMemberHandleAt'
});

export const FORMATION_MOTION_POLICY_METHOD = Object.freeze({
    ACCEPTS_ROUTE_PROGRESS: 'acceptsRouteProgress',
    COMPARE_JOIN_CANDIDATES: 'compareJoinCandidates'
});

/** eligibility를 통과한 join candidate의 canonical ASC 비교 tuple입니다. */
export const FORMATION_JOIN_CANDIDATE_FIELDS = Object.freeze([
    'distanceSquared',
    'forwardStageDelta',
    'forwardCostDelta',
    'rootEntityId',
    'rootIncarnation',
    'slotIndex',
    'rotationStep'
]);

export const FORMATION_ATOMIC_TRANSFORM_METHOD = Object.freeze({
    PREFLIGHT_TRANSFORM: 'preflightTransform',
    COMMIT_PREFLIGHTED_TRANSFORM: 'commitPreflightedTransform',
    CANCEL_PREFLIGHTED_TRANSFORM: 'cancelPreflightedTransform'
});

/**
 * Formation ABI v1 atomic transform의 비선택적 Effect 불변식:
 * target tick에 half-open active인 모든 instance는 추가 pool allocation 없이 exact
 * identity/provenance/ticks/payload를 보존한 채 destination handle/slot로 in-place rekey됩니다.
 * expired instance는 먼저 정상 retire되며, authenticated GPU `effectRekeyCount`만 completion
 * evidence입니다. Data/registry/private descriptor에는 policy나 expected count를 복제하지 않습니다.
 */

const VALID_COORDINATE_SYSTEM_IDS = new Set(
    Object.values(FORMATION_COORDINATE_SYSTEM)
);
const VALID_FORMATION_POLICY_IDS = new Set(
    Object.values(ENEMY_FORMATION_POLICY)
);

function requireObjectLike(value, label) {
    if ((typeof value !== 'object' || value === null)
        && typeof value !== 'function') {
        throw new TypeError(`${label}은 object 또는 class prototype이어야 합니다.`);
    }
    return value;
}

function assertRequiredMethods(source, vocabulary, label) {
    const port = requireObjectLike(source, label);
    for (const methodName of Object.values(vocabulary)) {
        if (typeof port[methodName] !== 'function') {
            throw new TypeError(`${label}.${methodName}()가 필요합니다.`);
        }
    }
    return port;
}

/** IFormationCoordinateSystem stable port assertion입니다. */
export function assertFormationCoordinateSystem(
    source,
    label = 'formationCoordinateSystem'
) {
    return assertRequiredMethods(source, FORMATION_COORDINATE_SYSTEM_METHOD, label);
}

/** IFormationSlotGraph stable port assertion입니다. */
export function assertFormationSlotGraph(source, label = 'formationSlotGraph') {
    return assertRequiredMethods(source, FORMATION_SLOT_GRAPH_METHOD, label);
}

/** IFormationMembership stable port assertion입니다. */
export function assertFormationMembership(source, label = 'formationMembership') {
    return assertRequiredMethods(source, FORMATION_MEMBERSHIP_METHOD, label);
}

/** IFormationMotionPolicy stable port assertion입니다. */
export function assertFormationMotionPolicy(source, label = 'formationMotionPolicy') {
    return assertRequiredMethods(source, FORMATION_MOTION_POLICY_METHOD, label);
}

/** IFormationAtomicTransform stable port assertion입니다. */
export function assertFormationAtomicTransform(
    source,
    label = 'formationAtomicTransform'
) {
    return assertRequiredMethods(source, FORMATION_ATOMIC_TRANSFORM_METHOD, label);
}

function requirePlainObject(value, label) {
    const prototype = value && typeof value === 'object'
        ? Object.getPrototypeOf(value)
        : null;
    const isPlainObject = prototype === null
        || (prototype !== null && Object.getPrototypeOf(prototype) === null);
    if (!value || typeof value !== 'object' || !isPlainObject) {
        throw new TypeError(`${label}은 plain object여야 합니다.`);
    }
    return value;
}

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

function requireUint32(value, label, allowZero = true) {
    if (typeof value !== 'number'
        || !Number.isSafeInteger(value)
        || value < (allowZero ? 0 : 1)
        || value > 0xffffffff) {
        throw new RangeError(`${label}은 ${allowZero ? '' : 'nonzero '}uint32여야 합니다.`);
    }
    return value >>> 0;
}

function requirePositiveSafeInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
    if (typeof value !== 'number'
        || !Number.isSafeInteger(value)
        || value <= 0
        || value > maximum) {
        throw new RangeError(`${label}은 1..${maximum} 범위의 안전한 정수여야 합니다.`);
    }
    return value;
}

function requireInteger(value, label) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        throw new RangeError(`${label}은 안전한 정수여야 합니다.`);
    }
    return value;
}

function requirePositiveFinite(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || !(value > 0)) {
        throw new RangeError(`${label}은 양의 유한 숫자여야 합니다.`);
    }
    return value;
}

function requireNonNegativeFinite(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new RangeError(`${label}은 0 이상의 유한 숫자여야 합니다.`);
    }
    return value;
}

function requireNonNegativeSafeInteger(
    value,
    label,
    maximum = Number.MAX_SAFE_INTEGER
) {
    if (typeof value !== 'number'
        || !Number.isSafeInteger(value)
        || value < 0
        || value > maximum) {
        throw new RangeError(`${label}은 0..${maximum} 범위의 안전한 정수여야 합니다.`);
    }
    return value;
}

function requireBoolean(value, label) {
    if (typeof value !== 'boolean') {
        throw new TypeError(`${label}은 boolean이어야 합니다.`);
    }
    return value;
}

function assertKnownKeys(source, allowedKeys, label) {
    for (const key of Object.keys(source)) {
        if (!allowedKeys.has(key)) {
            throw new RangeError(`${label}에 알 수 없는 필드가 있습니다: ${key}`);
        }
    }
}

export function normalizeFormationCoordinateSystemId(
    value,
    label = 'coordinateSystemId'
) {
    const id = requireNonEmptyString(value, label);
    if (!VALID_COORDINATE_SYSTEM_IDS.has(id)) {
        throw new RangeError(`${label}은 알려진 Formation coordinate system이어야 합니다.`);
    }
    return id;
}

export function normalizeEnemyFormationPolicyId(value, label = 'formationPolicy') {
    const id = requireNonEmptyString(value, label);
    if (!VALID_FORMATION_POLICY_IDS.has(id)) {
        throw new RangeError(`${label}는 알려진 Formation policy여야 합니다.`);
    }
    return id;
}

/**
 * IFormationMotionPolicy.acceptsRouteProgress의 exact scalar schema입니다.
 * `(currentStage,currentCost,candidateStage,candidateCost)`는 모두 같은 route의
 * nonnegative finite progress이며 stage는 uint32입니다. Later stage 또는 같은 stage의
 * nonincreasing integration cost만 no-reverse progress로 허용합니다.
 */
export function acceptsFormationRouteProgress(
    currentStage,
    currentCost,
    candidateStage,
    candidateCost
) {
    const currentStageValue = requireUint32(currentStage, 'currentStage');
    const candidateStageValue = requireUint32(candidateStage, 'candidateStage');
    const currentCostValue = requireNonNegativeFinite(currentCost, 'currentCost');
    const candidateCostValue = requireNonNegativeFinite(candidateCost, 'candidateCost');
    return candidateStageValue > currentStageValue
        || (candidateStageValue === currentStageValue
            && candidateCostValue <= currentCostValue);
}

function normalizeFormationJoinCandidate(source, label) {
    const candidate = requirePlainObject(source, label);
    const knownKeys = new Set(FORMATION_JOIN_CANDIDATE_FIELDS);
    assertKnownKeys(candidate, knownKeys, label);
    for (const field of FORMATION_JOIN_CANDIDATE_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(candidate, field)) {
            throw new TypeError(`${label}.${field}가 필요합니다.`);
        }
    }
    const rootEntityId = requireUint32(
        candidate.rootEntityId,
        `${label}.rootEntityId`,
        false
    );
    const rootIncarnation = requireUint32(
        candidate.rootIncarnation,
        `${label}.rootIncarnation`,
        false
    );
    if (rootEntityId === 0xffffffff || rootIncarnation === 0xffffffff) {
        throw new RangeError(`${label} root identity는 reserved sentinel보다 작아야 합니다.`);
    }
    return Object.freeze({
        distanceSquared: requireNonNegativeFinite(
            candidate.distanceSquared,
            `${label}.distanceSquared`
        ),
        forwardStageDelta: requireNonNegativeSafeInteger(
            candidate.forwardStageDelta,
            `${label}.forwardStageDelta`,
            0xffffffff
        ),
        forwardCostDelta: requireNonNegativeFinite(
            candidate.forwardCostDelta,
            `${label}.forwardCostDelta`
        ),
        rootEntityId,
        rootIncarnation,
        slotIndex: requireNonNegativeSafeInteger(
            candidate.slotIndex,
            `${label}.slotIndex`,
            0xffffffff
        ),
        rotationStep: requireNonNegativeSafeInteger(
            candidate.rotationStep,
            `${label}.rotationStep`,
            0xffffffff
        )
    });
}

/**
 * Eligibility(finite/same-route/no-reverse/SDF)를 통과한 두 join candidate를
 * distance² → forward stage delta → forward cost delta → exact root identity →
 * slot → rotation의 canonical tuple로 ASC 비교합니다.
 */
export function compareFormationJoinCandidates(left, right) {
    const leftCandidate = normalizeFormationJoinCandidate(left, 'leftCandidate');
    const rightCandidate = normalizeFormationJoinCandidate(right, 'rightCandidate');
    for (const field of FORMATION_JOIN_CANDIDATE_FIELDS) {
        if (leftCandidate[field] < rightCandidate[field]) {
            return -1;
        }
        if (leftCandidate[field] > rightCandidate[field]) {
            return 1;
        }
    }
    return 0;
}

function requireExactHandle(source, label) {
    const handle = requirePlainObject(source, label);
    const entityId = requireUint32(handle.entityId, `${label}.entityId`, false);
    const incarnation = requireUint32(
        handle.incarnation,
        `${label}.incarnation`,
        false
    );
    if (entityId === 0xffffffff || incarnation === 0xffffffff) {
        throw new RangeError(`${label}은 reserved sentinel보다 작아야 합니다.`);
    }
    return Object.freeze({ entityId, incarnation });
}

/** Runtime formationId는 authored group이 아니라 destination exact handle에서 파생됩니다. */
export function createFormationIdFromExactHandle(source) {
    const handle = requireExactHandle(source, 'formationHandle');
    return `formation:${handle.entityId}:${handle.incarnation}`;
}

/**
 * Sorted CONSUMED LINEAGE exact handles의 stable nonzero uint32 hash입니다. Hash는 bounded
 * correlation/fingerprint이며 exact member identity authority를 대체하지 않습니다.
 */
export function createFormationLineageHash(source) {
    if (!Array.isArray(source) || source.length === 0 || source.length > 6) {
        throw new TypeError('formation lineage에는 1..6 exact handle 배열이 필요합니다.');
    }
    const handles = source.map((handle, index) => (
        requireExactHandle(handle, `formationLineage[${index}]`)
    ));
    handles.sort((left, right) => (
        left.entityId - right.entityId
        || left.incarnation - right.incarnation
    ));
    for (let index = 1; index < handles.length; index++) {
        if (handles[index - 1].entityId === handles[index].entityId
            && handles[index - 1].incarnation === handles[index].incarnation) {
            throw new RangeError('formation lineage exact handle은 중복될 수 없습니다.');
        }
    }
    let hash = 0x811c9dc5;
    for (const handle of handles) {
        hash = Math.imul(hash ^ handle.entityId, 0x01000193) >>> 0;
        hash = Math.imul(hash ^ handle.incarnation, 0x01000193) >>> 0;
    }
    if (hash === 0 || hash === 0xffffffff) {
        hash = (hash ^ 0x9e3779b9) >>> 0;
    }
    return hash === 0 || hash === 0xffffffff ? 1 : hash;
}

/** Screen/world +60도 회전 `(q,r)->(-r,q+r)`을 exact integer로 적용합니다. */
export function rotateHexAxialCoordinatePositive60(source, out = {}) {
    const coordinate = requirePlainObject(source, 'hexAxialCoordinate');
    const q = requireInteger(coordinate.q, 'hexAxialCoordinate.q');
    const r = requireInteger(coordinate.r, 'hexAxialCoordinate.r');
    out.q = -r;
    out.r = q + r;
    return out;
}

/**
 * Slot graph의 occupied mask가 비어 있지 않은 단일 connected component인지 검사합니다.
 * neighborMasks는 slot index와 같은 순서의 uint32 bit mask authority입니다.
 */
export function isConnectedFormationOccupancyMask(
    neighborMasks,
    occupiedMask,
    slotCount = neighborMasks?.length
) {
    if (!Array.isArray(neighborMasks) && !ArrayBuffer.isView(neighborMasks)) {
        throw new TypeError('neighborMasks는 배열이어야 합니다.');
    }
    const count = requirePositiveSafeInteger(slotCount, 'slotCount', 31);
    if (neighborMasks.length !== count) {
        throw new RangeError('neighborMasks length와 slotCount가 일치해야 합니다.');
    }
    const validMask = (2 ** count) - 1;
    const mask = requireUint32(occupiedMask, 'occupiedMask');
    if (mask === 0 || (mask & ~validMask) !== 0) {
        return false;
    }
    let frontier = mask & -mask;
    let visited = 0;
    while (frontier !== 0) {
        const bit = frontier & -frontier;
        frontier = (frontier & ~bit) >>> 0;
        if ((visited & bit) !== 0) {
            continue;
        }
        visited = (visited | bit) >>> 0;
        const slotIndex = 31 - Math.clz32(bit);
        const neighbors = requireUint32(
            neighborMasks[slotIndex],
            `neighborMasks[${slotIndex}]`
        );
        frontier = (frontier | (neighbors & mask & ~visited)) >>> 0;
    }
    return visited === mask;
}

const FORMATION_DEFINITION_KEYS = new Set([
    'id',
    'definitionCode',
    'coordinateSystemId',
    'coordinateSystemCode',
    'slotCoordinates',
    'neighborMasks',
    'emptyCenterRequired',
    'maximumMemberCount',
    'mergeSeekRadiusTiles',
    'mergeCommitDistanceTiles',
    'maximumSdfSegmentSamples',
    'corridorClearanceRadiusScale',
    'compositeHealthBarPolicy'
]);
const HEX_AXIAL_COORDINATE_KEYS = new Set(['q', 'r']);

export function normalizeEnemyFormationDefinition(
    source,
    label = 'enemyFormationDefinition'
) {
    const definition = requirePlainObject(source, label);
    assertKnownKeys(definition, FORMATION_DEFINITION_KEYS, label);
    const id = requireNonEmptyString(definition.id, `${label}.id`);
    const definitionCode = requireUint32(
        definition.definitionCode,
        `${label}.definitionCode`,
        false
    );
    const coordinateSystemId = normalizeFormationCoordinateSystemId(
        definition.coordinateSystemId,
        `${label}.coordinateSystemId`
    );
    const coordinateSystemCode = requireUint32(
        definition.coordinateSystemCode,
        `${label}.coordinateSystemCode`,
        false
    );
    if (FORMATION_COORDINATE_SYSTEM_CODE_BY_ID[coordinateSystemId]
        !== coordinateSystemCode) {
        throw new RangeError(`${label}.coordinateSystemId/code가 일치해야 합니다.`);
    }
    if (coordinateSystemId !== FORMATION_COORDINATE_SYSTEM.HEX_AXIAL) {
        throw new RangeError(`${label}의 현재 persistent slot graph는 HEX_AXIAL이어야 합니다.`);
    }
    if (!Array.isArray(definition.slotCoordinates)
        || definition.slotCoordinates.length === 0
        || definition.slotCoordinates.length > 31) {
        throw new TypeError(`${label}.slotCoordinates는 1..31 길이 배열이어야 합니다.`);
    }
    const coordinateKeys = new Set();
    const slotCoordinates = Object.freeze(definition.slotCoordinates.map((entry, index) => {
        const coordinate = requirePlainObject(entry, `${label}.slotCoordinates[${index}]`);
        assertKnownKeys(coordinate, HEX_AXIAL_COORDINATE_KEYS, `${label}.slotCoordinates[${index}]`);
        const q = requireInteger(coordinate.q, `${label}.slotCoordinates[${index}].q`);
        const r = requireInteger(coordinate.r, `${label}.slotCoordinates[${index}].r`);
        const key = `${q},${r}`;
        if (coordinateKeys.has(key)) {
            throw new RangeError(`${label}.slotCoordinates에 중복 좌표가 있습니다: ${key}`);
        }
        coordinateKeys.add(key);
        return Object.freeze({ q, r });
    }));
    const emptyCenterRequired = requireBoolean(
        definition.emptyCenterRequired,
        `${label}.emptyCenterRequired`
    );
    if (emptyCenterRequired && coordinateKeys.has('0,0')) {
        throw new RangeError(`${label}의 empty center에는 slot을 둘 수 없습니다.`);
    }
    if (!Array.isArray(definition.neighborMasks)
        || definition.neighborMasks.length !== slotCoordinates.length) {
        throw new TypeError(`${label}.neighborMasks는 slot 수와 같은 배열이어야 합니다.`);
    }
    const validMask = (2 ** slotCoordinates.length) - 1;
    const neighborMasks = Object.freeze(definition.neighborMasks.map((entry, index) => {
        const mask = requireUint32(entry, `${label}.neighborMasks[${index}]`);
        if ((mask & ~validMask) !== 0 || (mask & (1 << index)) !== 0) {
            throw new RangeError(`${label}.neighborMasks[${index}]가 slot 범위를 벗어났습니다.`);
        }
        return mask;
    }));
    for (let slotIndex = 0; slotIndex < neighborMasks.length; slotIndex++) {
        for (let neighborIndex = 0; neighborIndex < neighborMasks.length; neighborIndex++) {
            const forward = (neighborMasks[slotIndex] & (1 << neighborIndex)) !== 0;
            const reverse = (neighborMasks[neighborIndex] & (1 << slotIndex)) !== 0;
            if (forward !== reverse) {
                throw new RangeError(`${label}.neighborMasks는 reciprocal graph여야 합니다.`);
            }
        }
    }
    const maximumMemberCount = requirePositiveSafeInteger(
        definition.maximumMemberCount,
        `${label}.maximumMemberCount`,
        slotCoordinates.length
    );
    if (maximumMemberCount !== slotCoordinates.length) {
        throw new RangeError(`${label}.maximumMemberCount는 slotCount와 같아야 합니다.`);
    }
    if (!isConnectedFormationOccupancyMask(
        neighborMasks,
        validMask,
        slotCoordinates.length
    )) {
        throw new RangeError(`${label}의 전체 slot graph는 connected여야 합니다.`);
    }
    return Object.freeze({
        id,
        definitionCode,
        coordinateSystemId,
        coordinateSystemCode,
        slotCount: slotCoordinates.length,
        slotCoordinates,
        neighborMasks,
        emptyCenterRequired,
        maximumMemberCount,
        mergeSeekRadiusTiles: requirePositiveFinite(
            definition.mergeSeekRadiusTiles,
            `${label}.mergeSeekRadiusTiles`
        ),
        mergeCommitDistanceTiles: requirePositiveFinite(
            definition.mergeCommitDistanceTiles,
            `${label}.mergeCommitDistanceTiles`
        ),
        maximumSdfSegmentSamples: requirePositiveSafeInteger(
            definition.maximumSdfSegmentSamples,
            `${label}.maximumSdfSegmentSamples`,
            0xffffffff
        ),
        corridorClearanceRadiusScale: requirePositiveFinite(
            definition.corridorClearanceRadiusScale,
            `${label}.corridorClearanceRadiusScale`
        ),
        compositeHealthBarPolicy: requireNonEmptyString(
            definition.compositeHealthBarPolicy,
            `${label}.compositeHealthBarPolicy`
        )
    });
}

export function normalizeEnemyFormationCatalog(
    source,
    label = 'enemyFormationCatalog'
) {
    const catalog = requirePlainObject(source, label);
    assertKnownKeys(catalog, new Set(['definitions']), label);
    if (!Array.isArray(catalog.definitions) || catalog.definitions.length === 0) {
        throw new TypeError(`${label}.definitions에는 하나 이상의 definition이 필요합니다.`);
    }
    const byId = Object.create(null);
    const byCode = Object.create(null);
    for (let index = 0; index < catalog.definitions.length; index++) {
        const definition = normalizeEnemyFormationDefinition(
            catalog.definitions[index],
            `${label}.definitions[${index}]`
        );
        if (Object.prototype.hasOwnProperty.call(byId, definition.id)) {
            throw new RangeError(`${label}에 중복 definition ID가 있습니다: ${definition.id}`);
        }
        if (Object.prototype.hasOwnProperty.call(byCode, definition.definitionCode)) {
            throw new RangeError(
                `${label}에 중복 definition code가 있습니다: ${definition.definitionCode}`
            );
        }
        byId[definition.id] = definition;
        byCode[definition.definitionCode] = definition;
    }
    return Object.freeze({
        definitionById: Object.freeze(byId),
        definitionByCode: Object.freeze(byCode)
    });
}

/** Catalog coordinate에서 +60도 회전된 destination slot index를 exact derive합니다. */
export function resolvePositive60FormationSlotIndex(definition, sourceSlotIndex) {
    const source = requirePlainObject(definition, 'formationDefinition');
    const slotCount = requirePositiveSafeInteger(source.slotCount, 'slotCount', 31);
    const slotIndex = Number(sourceSlotIndex);
    if (!Number.isSafeInteger(slotIndex) || slotIndex < 0 || slotIndex >= slotCount) {
        throw new RangeError('sourceSlotIndex가 formation slot 범위를 벗어났습니다.');
    }
    if (!Array.isArray(source.slotCoordinates)
        || source.slotCoordinates.length !== slotCount) {
        throw new TypeError('formationDefinition.slotCoordinates가 필요합니다.');
    }
    const rotated = rotateHexAxialCoordinatePositive60(
        source.slotCoordinates[slotIndex],
        {}
    );
    const destinationIndex = source.slotCoordinates.findIndex(
        ({ q, r }) => q === rotated.q && r === rotated.r
    );
    if (destinationIndex < 0) {
        throw new RangeError('회전된 coordinate를 formation slot graph에서 찾을 수 없습니다.');
    }
    return destinationIndex;
}
