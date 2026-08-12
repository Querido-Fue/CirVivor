export const ROUTE_AVAILABILITY_ABI_VERSION = 1;
export const ROUTE_AVAILABILITY_UINT32_SENTINEL = 0xffffffff;
export const ROUTE_AVAILABILITY_MAX_CORK_ROSTER = 8;

export const ROUTE_GRAPH_NODE_KIND_CODE = Object.freeze({
    ENTRANCE: 1,
    SWITCH: 2,
    CLEARANCE: 3,
    CLOSURE_ENTRANCE: 4,
    MERGE: 5,
    CORE: 6
});

export const ROUTE_AVAILABILITY_COMPLETION_ACTION = Object.freeze({
    ASSIGN: 1,
    CLOSE: 2,
    REOPEN: 3,
    CLEANUP: 4
});

export const ROUTE_AVAILABILITY_LEGACY_GRAPH_CONTENT_KEY = 'legacy-all-open';

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

function requirePositiveUint32(value, label) {
    if (!Number.isSafeInteger(value)
        || value <= 0
        || value >= ROUTE_AVAILABILITY_UINT32_SENTINEL) {
        throw new RangeError(`${label}은 positive non-sentinel uint32여야 합니다.`);
    }
    return value;
}

function snapshotDenseStrings(source, label) {
    if (!Array.isArray(source)) {
        throw new TypeError(`${label}은 dense 문자열 배열이어야 합니다.`);
    }
    const values = new Array(source.length);
    const seen = new Set();
    for (let index = 0; index < source.length; index++) {
        if (!Object.prototype.hasOwnProperty.call(source, index)) {
            throw new TypeError(`${label}[${index}]가 필요합니다.`);
        }
        const value = requireNonEmptyString(source[index], `${label}[${index}]`);
        if (seen.has(value)) {
            throw new RangeError(`${label}에 중복 ID가 있습니다: ${value}`);
        }
        seen.add(value);
        values[index] = value;
    }
    values.sort();
    return Object.freeze(values);
}

/**
 * Wave/host mirror가 소비하는 최소 availability snapshot을 정규화합니다.
 * GPU session/device/epoch 인증은 Director가 이 함수 호출 전에 수행합니다.
 */
export function normalizeRouteAvailabilitySelectionSnapshot(
    source,
    routeGraph,
    label = 'routeAvailabilitySnapshot'
) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new TypeError(`${label} 객체가 필요합니다.`);
    }
    const graphContentKey = requireNonEmptyString(
        source.graphContentKey,
        `${label}.graphContentKey`
    );
    const availabilityVersion = requirePositiveUint32(
        source.availabilityVersion,
        `${label}.availabilityVersion`
    );
    const closedPathIds = snapshotDenseStrings(
        source.closedPathIds,
        `${label}.closedPathIds`
    );
    if (routeGraph === null) {
        if (closedPathIds.length !== 0) {
            throw new RangeError(`${label} legacy graph는 closed route를 가질 수 없습니다.`);
        }
    } else {
        if (!routeGraph || !Array.isArray(routeGraph.routeSets)) {
            throw new TypeError(`${label} 검증에는 normalized routeGraph가 필요합니다.`);
        }
        const knownPaths = new Set();
        for (const routeSet of routeGraph.routeSets) {
            for (const candidate of routeSet.candidates) {
                knownPaths.add(candidate.pathId);
            }
        }
        for (const pathId of closedPathIds) {
            if (!knownPaths.has(pathId)) {
                throw new RangeError(`${label}에 unknown closed path가 있습니다: ${pathId}`);
            }
        }
    }
    return Object.freeze({
        graphContentKey,
        availabilityVersion,
        closedPathIds
    });
}

/** optional graph의 deterministic all-open selection snapshot입니다. */
export function createAllOpenRouteAvailabilitySelectionSnapshot(
    graphContentKey = ROUTE_AVAILABILITY_LEGACY_GRAPH_CONTENT_KEY,
    availabilityVersion = 1
) {
    return Object.freeze({
        graphContentKey: requireNonEmptyString(graphContentKey, 'graphContentKey'),
        availabilityVersion: requirePositiveUint32(
            availabilityVersion,
            'availabilityVersion'
        ),
        closedPathIds: Object.freeze([])
    });
}

/**
 * Authored route-set에서 현재 열린 route를 exact policy 순서로 고릅니다.
 * @returns {string|null} 선택 pathId 또는 all-closed null입니다.
 */
export function selectOpenRoutePathId(routeGraph, routeSetId, snapshot) {
    if (!routeGraph || !Array.isArray(routeGraph.routeSets)) {
        throw new TypeError('route-set 선택에는 optional v1 routeGraph가 필요합니다.');
    }
    const normalizedRouteSetId = requireNonEmptyString(routeSetId, 'routeSetId');
    const routeSet = routeGraph.routeSets.find(
        (candidate) => candidate.id === normalizedRouteSetId
    );
    if (!routeSet) {
        throw new RangeError(`알 수 없는 routeSetId입니다: ${normalizedRouteSetId}`);
    }
    const normalizedSnapshot = normalizeRouteAvailabilitySelectionSnapshot(
        snapshot,
        routeGraph
    );
    const closedPaths = new Set(normalizedSnapshot.closedPathIds);
    const ordered = [...routeSet.candidates].sort((left, right) => (
        left.priority - right.priority
        || (left.pathId < right.pathId ? -1 : left.pathId > right.pathId ? 1 : 0)
    ));
    const selected = ordered.find((candidate) => !closedPaths.has(candidate.pathId));
    return selected?.pathId ?? null;
}
