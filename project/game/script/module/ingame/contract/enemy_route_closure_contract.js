const UINT32_MAX = 0xffffffff;

export const ENEMY_ROUTE_CLOSURE_ROUTE_SELECTION_POLICY = Object.freeze({
    LOWEST_OPEN_PRIORITY_THEN_CLOSURE_ID:
        'lowest-open-priority-then-closure-id'
});

export const ENEMY_ROUTE_CLOSURE_CONFLICT_POLICY = Object.freeze({
    ONE_EXACT_OWNER_DUPLICATE_WAIT: 'one-exact-owner-duplicate-wait'
});

export const ENEMY_ROUTE_CLOSURE_ACTIVATION_POLICY = Object.freeze({
    CLOSE_ON_EXPANSION_COMPLETE: 'close-on-expansion-complete'
});

export const ENEMY_ROUTE_CLOSURE_NO_AVAILABLE_ROUTE_POLICY = Object.freeze({
    CONTINUE_AS_NORMAL_ENEMY: 'continue-as-normal-enemy'
});

export const ENEMY_ROUTE_CLOSURE_REOPEN_POLICY = Object.freeze({
    EXACT_OWNER_DEATH: 'exact-owner-death'
});

export const ENEMY_ROUTE_CLOSURE_TRAPPED_POLICY = Object.freeze({
    ADVANCE_CLEARANCE_THEN_WAIT_CAPABILITIES_CONTINUE:
        'advance-clearance-then-wait-capabilities-continue'
});

export const ENEMY_ROUTE_CLOSURE_BLOCKING_MOTION_POLICY = Object.freeze({
    ANCHORED_KINEMATIC_AT_AUTHORED_ENTRANCE:
        'anchored-kinematic-at-authored-entrance'
});

export const ENEMY_ROUTE_GRAPH_VERSION = 1;

export const ENEMY_ROUTE_GRAPH_NODE_KIND = Object.freeze({
    ENTRANCE: 'ENTRANCE',
    SWITCH: 'SWITCH',
    CLEARANCE: 'CLEARANCE',
    CLOSURE_ENTRANCE: 'CLOSURE_ENTRANCE',
    MERGE: 'MERGE',
    CORE: 'CORE'
});

export const ENEMY_ROUTE_GRAPH_ROUTE_SELECTION_POLICY = Object.freeze({
    LOWEST_OPEN_PRIORITY_THEN_PATH_ID:
        'lowest-open-priority-then-path-id'
});

export const ENEMY_ROUTE_GRAPH_NO_OPEN_ROUTE_POLICY = Object.freeze({
    HOLD_AT_ENTRY: 'hold-at-entry'
});

export const ENEMY_ROUTE_GRAPH_SWITCH_SELECTION_POLICY = Object.freeze({
    OPEN_FORWARD_LOWEST_PRIORITY_PATH_ID:
        'open-forward-lowest-priority-path-id'
});

const PROFILE_KEYS = Object.freeze([
    'id',
    'definitionCode',
    'blockerDiameterTiles',
    'expandedRadiusTiles',
    'expansionDurationFixedTicks',
    'routeSelectionPolicyId',
    'closureConflictPolicyId',
    'closureActivationPolicyId',
    'noAvailableRoutePolicyId',
    'reopenPolicyId',
    'trappedPolicyId',
    'blockingMotionPolicyId'
]);
const GRAPH_KEYS = Object.freeze([
    'version',
    'routeSets',
    'nodes',
    'switches',
    'closures'
]);
const GRAPH_OPTIONS_KEYS = Object.freeze(['routes']);
const ROUTE_SOURCE_KEYS = Object.freeze(['gateId', 'pathId', 'macroCells']);
const ROUTE_SET_KEYS = Object.freeze([
    'id',
    'candidates',
    'selectionPolicyId',
    'noOpenRoutePolicyId'
]);
const ROUTE_CANDIDATE_KEYS = Object.freeze(['pathId', 'priority']);
const NODE_KEYS = Object.freeze(['id', 'kind', 'memberships']);
const MEMBERSHIP_KEYS = Object.freeze([
    'pathId',
    'waypointIndex',
    'progressOrdinal'
]);
const SWITCH_KEYS = Object.freeze([
    'id',
    'nodeId',
    'selectionPolicyId',
    'transitions'
]);
const TRANSITION_KEYS = Object.freeze([
    'fromPathId',
    'toPathId',
    'targetWaypointIndex',
    'priority'
]);
const CLOSURE_KEYS = Object.freeze([
    'id',
    'pathId',
    'entranceNodeId',
    'clearanceNodeId',
    'upstreamSwitchNodeId',
    'downstreamMergeNodeId',
    'priority'
]);

const VALID_ROUTE_SELECTION_POLICIES = new Set(
    Object.values(ENEMY_ROUTE_CLOSURE_ROUTE_SELECTION_POLICY)
);
const VALID_CONFLICT_POLICIES = new Set(
    Object.values(ENEMY_ROUTE_CLOSURE_CONFLICT_POLICY)
);
const VALID_ACTIVATION_POLICIES = new Set(
    Object.values(ENEMY_ROUTE_CLOSURE_ACTIVATION_POLICY)
);
const VALID_NO_AVAILABLE_ROUTE_POLICIES = new Set(
    Object.values(ENEMY_ROUTE_CLOSURE_NO_AVAILABLE_ROUTE_POLICY)
);
const VALID_REOPEN_POLICIES = new Set(
    Object.values(ENEMY_ROUTE_CLOSURE_REOPEN_POLICY)
);
const VALID_TRAPPED_POLICIES = new Set(
    Object.values(ENEMY_ROUTE_CLOSURE_TRAPPED_POLICY)
);
const VALID_BLOCKING_MOTION_POLICIES = new Set(
    Object.values(ENEMY_ROUTE_CLOSURE_BLOCKING_MOTION_POLICY)
);
const VALID_NODE_KINDS = new Set(Object.values(ENEMY_ROUTE_GRAPH_NODE_KIND));
const VALID_GRAPH_ROUTE_SELECTION_POLICIES = new Set(
    Object.values(ENEMY_ROUTE_GRAPH_ROUTE_SELECTION_POLICY)
);
const VALID_GRAPH_NO_OPEN_ROUTE_POLICIES = new Set(
    Object.values(ENEMY_ROUTE_GRAPH_NO_OPEN_ROUTE_POLICY)
);
const VALID_GRAPH_SWITCH_SELECTION_POLICIES = new Set(
    Object.values(ENEMY_ROUTE_GRAPH_SWITCH_SELECTION_POLICY)
);

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

function snapshotExactDataObject(source, keys, label) {
    const object = requirePlainObject(source, label);
    const ownKeys = Reflect.ownKeys(object);
    if (ownKeys.length !== keys.length
        || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) {
        throw new RangeError(`${label}은 exact schema여야 합니다.`);
    }
    const snapshot = {};
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(object, key);
        if (!descriptor
            || descriptor.enumerable !== true
            || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
            throw new TypeError(`${label}.${key}는 enumerable own data field여야 합니다.`);
        }
        snapshot[key] = descriptor.value;
    }
    return snapshot;
}

function snapshotDenseArray(source, label, normalize) {
    if (!Array.isArray(source) || source.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 dense 배열이어야 합니다.`);
    }
    const ownKeys = Reflect.ownKeys(source);
    if (ownKeys.some((key) => (
        typeof key === 'symbol'
        || (key !== 'length'
            && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= source.length))
    ))) {
        throw new RangeError(`${label}에는 indexed element 외 필드가 없어야 합니다.`);
    }
    const values = new Array(source.length);
    for (let index = 0; index < source.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(source, String(index));
        if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
            throw new TypeError(`${label}[${index}]는 own data element여야 합니다.`);
        }
        values[index] = normalize(descriptor.value, `${label}[${index}]`);
    }
    return Object.freeze(values);
}

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

function requireUint32(value, label, positive = false) {
    if (typeof value !== 'number'
        || !Number.isSafeInteger(value)
        || value < (positive ? 1 : 0)
        || value > UINT32_MAX) {
        throw new RangeError(
            `${label}은 ${positive ? '양의 ' : ''}uint32 정수여야 합니다.`
        );
    }
    return value;
}

function requirePositiveFloat32(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new RangeError(`${label}은 양의 유한 숫자여야 합니다.`);
    }
    const normalized = Math.fround(value);
    if (!Number.isFinite(normalized) || normalized <= 0) {
        throw new RangeError(`${label}은 양의 finite float32여야 합니다.`);
    }
    return normalized;
}

function requireKnownValue(value, values, label) {
    const normalized = requireNonEmptyString(value, label);
    if (!values.has(normalized)) {
        throw new RangeError(`${label}은 알려진 policy vocabulary여야 합니다.`);
    }
    return normalized;
}

export function normalizeEnemyRouteClosureProfile(
    source,
    label = 'enemyRouteClosureProfile'
) {
    const profile = snapshotExactDataObject(source, PROFILE_KEYS, label);
    const blockerDiameterTiles = requirePositiveFloat32(
        profile.blockerDiameterTiles,
        `${label}.blockerDiameterTiles`
    );
    const expandedRadiusTiles = requirePositiveFloat32(
        profile.expandedRadiusTiles,
        `${label}.expandedRadiusTiles`
    );
    if (blockerDiameterTiles !== Math.fround(expandedRadiusTiles * 2)) {
        throw new RangeError(
            `${label} blocker diameter는 expanded radius의 정확히 두 배여야 합니다.`
        );
    }
    return Object.freeze({
        id: requireNonEmptyString(profile.id, `${label}.id`),
        definitionCode: requireUint32(
            profile.definitionCode,
            `${label}.definitionCode`,
            true
        ),
        blockerDiameterTiles,
        expandedRadiusTiles,
        expansionDurationFixedTicks: requireUint32(
            profile.expansionDurationFixedTicks,
            `${label}.expansionDurationFixedTicks`,
            true
        ),
        routeSelectionPolicyId: requireKnownValue(
            profile.routeSelectionPolicyId,
            VALID_ROUTE_SELECTION_POLICIES,
            `${label}.routeSelectionPolicyId`
        ),
        closureConflictPolicyId: requireKnownValue(
            profile.closureConflictPolicyId,
            VALID_CONFLICT_POLICIES,
            `${label}.closureConflictPolicyId`
        ),
        closureActivationPolicyId: requireKnownValue(
            profile.closureActivationPolicyId,
            VALID_ACTIVATION_POLICIES,
            `${label}.closureActivationPolicyId`
        ),
        noAvailableRoutePolicyId: requireKnownValue(
            profile.noAvailableRoutePolicyId,
            VALID_NO_AVAILABLE_ROUTE_POLICIES,
            `${label}.noAvailableRoutePolicyId`
        ),
        reopenPolicyId: requireKnownValue(
            profile.reopenPolicyId,
            VALID_REOPEN_POLICIES,
            `${label}.reopenPolicyId`
        ),
        trappedPolicyId: requireKnownValue(
            profile.trappedPolicyId,
            VALID_TRAPPED_POLICIES,
            `${label}.trappedPolicyId`
        ),
        blockingMotionPolicyId: requireKnownValue(
            profile.blockingMotionPolicyId,
            VALID_BLOCKING_MOTION_POLICIES,
            `${label}.blockingMotionPolicyId`
        )
    });
}

export function normalizeEnemyRouteClosureProfileCatalog(
    source,
    label = 'enemyRouteClosureProfileCatalog'
) {
    const catalog = snapshotExactDataObject(source, ['profiles'], label);
    const profiles = snapshotDenseArray(
        catalog.profiles,
        `${label}.profiles`,
        normalizeEnemyRouteClosureProfile
    );
    const profileById = Object.create(null);
    const profileByCode = Object.create(null);
    for (const profile of profiles) {
        if (Object.prototype.hasOwnProperty.call(profileById, profile.id)) {
            throw new RangeError(`${label}에 중복 profile ID가 있습니다: ${profile.id}`);
        }
        if (Object.prototype.hasOwnProperty.call(
            profileByCode,
            profile.definitionCode
        )) {
            throw new RangeError(
                `${label}에 중복 definition code가 있습니다: ${profile.definitionCode}`
            );
        }
        profileById[profile.id] = profile;
        profileByCode[profile.definitionCode] = profile;
    }
    return Object.freeze({
        profiles,
        profileById: Object.freeze(profileById),
        profileByCode: Object.freeze(profileByCode)
    });
}

function snapshotRouteSources(source, label) {
    const routes = snapshotDenseArray(source, label, (value, routeLabel) => {
        const route = snapshotExactDataObject(
            value,
            ROUTE_SOURCE_KEYS,
            routeLabel
        );
        const macroCells = snapshotDenseArray(
            route.macroCells,
            `${routeLabel}.macroCells`,
            (cellValue, cellLabel) => {
                const cell = snapshotDenseArray(
                    cellValue,
                    cellLabel,
                    (coordinate, coordinateLabel) => (
                        requireUint32(coordinate, coordinateLabel)
                    )
                );
                if (cell.length !== 2) {
                    throw new RangeError(`${cellLabel}은 exact [row, column]이어야 합니다.`);
                }
                return cell;
            }
        );
        if (macroCells.length < 2) {
            throw new RangeError(`${routeLabel}.macroCells에는 둘 이상의 cell이 필요합니다.`);
        }
        return Object.freeze({
            gateId: requireNonEmptyString(route.gateId, `${routeLabel}.gateId`),
            pathId: requireNonEmptyString(route.pathId, `${routeLabel}.pathId`),
            macroCells
        });
    });
    if (routes.length < 2) {
        throw new TypeError(`${label}에는 둘 이상의 authored route가 필요합니다.`);
    }
    const routesByPathId = new Map();
    const physicalRouteSignatures = new Map();
    for (let index = 0; index < routes.length; index++) {
        const route = routes[index];
        const pathId = route.pathId;
        if (routesByPathId.has(pathId)
            || route.macroCells.length < 2) {
            throw new RangeError(`${label}[${index}] path/macroCells가 유효하지 않습니다.`);
        }
        const physicalSignature = route.macroCells
            .map(([row, column]) => `${row}:${column}`)
            .join('|');
        const aliasedPathId = physicalRouteSignatures.get(physicalSignature);
        if (aliasedPathId !== undefined) {
            throw new RangeError(
                `${label}[${index}]는 ${aliasedPathId}와 같은 물리 경로를 다른 pathId로 위장합니다.`
            );
        }
        physicalRouteSignatures.set(physicalSignature, pathId);
        routesByPathId.set(pathId, route);
    }
    return routesByPathId;
}

function sameMacroCell(left, right) {
    return Array.isArray(left)
        && Array.isArray(right)
        && left.length === 2
        && right.length === 2
        && left[0] === right[0]
        && left[1] === right[1];
}

function findNodeMembership(node, pathId) {
    return node.memberships.find((membership) => membership.pathId === pathId)
        ?? null;
}

export function normalizeEnemyRouteGraph(
    source,
    options = {},
    label = 'enemyRouteGraph'
) {
    const graph = snapshotExactDataObject(source, GRAPH_KEYS, label);
    const normalizedOptions = snapshotExactDataObject(
        options,
        GRAPH_OPTIONS_KEYS,
        `${label}.options`
    );
    if (graph.version !== ENEMY_ROUTE_GRAPH_VERSION) {
        throw new RangeError(`${label}.version은 exact v${ENEMY_ROUTE_GRAPH_VERSION}이어야 합니다.`);
    }
    const routesByPathId = snapshotRouteSources(
        normalizedOptions.routes,
        `${label}.routes`
    );

    const occupiedMemberships = new Set();
    const nodes = snapshotDenseArray(graph.nodes, `${label}.nodes`, (value, nodeLabel) => {
        const node = snapshotExactDataObject(value, NODE_KEYS, nodeLabel);
        const memberships = snapshotDenseArray(
            node.memberships,
            `${nodeLabel}.memberships`,
            (membershipValue, membershipLabel) => {
                const membership = snapshotExactDataObject(
                    membershipValue,
                    MEMBERSHIP_KEYS,
                    membershipLabel
                );
                const pathId = requireNonEmptyString(
                    membership.pathId,
                    `${membershipLabel}.pathId`
                );
                const route = routesByPathId.get(pathId);
                const waypointIndex = requireUint32(
                    membership.waypointIndex,
                    `${membershipLabel}.waypointIndex`
                );
                const progressOrdinal = requireUint32(
                    membership.progressOrdinal,
                    `${membershipLabel}.progressOrdinal`
                );
                if (!route || waypointIndex >= route.macroCells.length) {
                    throw new RangeError(`${membershipLabel} route waypoint가 없습니다.`);
                }
                if (progressOrdinal !== waypointIndex) {
                    throw new RangeError(
                        `${membershipLabel}.progressOrdinal은 waypointIndex와 같아야 합니다.`
                    );
                }
                const membershipKey = `${pathId}\u0000${waypointIndex}`;
                if (occupiedMemberships.has(membershipKey)) {
                    throw new RangeError(`${membershipLabel} route occurrence가 중복되었습니다.`);
                }
                occupiedMemberships.add(membershipKey);
                return Object.freeze({ pathId, waypointIndex, progressOrdinal });
            }
        );
        const firstRoute = routesByPathId.get(memberships[0].pathId);
        const firstCell = firstRoute.macroCells[memberships[0].waypointIndex];
        for (let index = 1; index < memberships.length; index++) {
            const membership = memberships[index];
            const route = routesByPathId.get(membership.pathId);
            if (!sameMacroCell(firstCell, route.macroCells[membership.waypointIndex])) {
                throw new RangeError(`${nodeLabel} shared node 좌표가 route마다 다릅니다.`);
            }
        }
        return Object.freeze({
            id: requireNonEmptyString(node.id, `${nodeLabel}.id`),
            kind: requireKnownValue(node.kind, VALID_NODE_KINDS, `${nodeLabel}.kind`),
            memberships
        });
    });
    const nodeById = new Map();
    for (const node of nodes) {
        if (nodeById.has(node.id)) {
            throw new RangeError(`${label}.nodes에 중복 ID가 있습니다: ${node.id}`);
        }
        nodeById.set(node.id, node);
    }

    const routeSets = snapshotDenseArray(
        graph.routeSets,
        `${label}.routeSets`,
        (value, routeSetLabel) => {
            const routeSet = snapshotExactDataObject(
                value,
                ROUTE_SET_KEYS,
                routeSetLabel
            );
            const seenPaths = new Set();
            let firstEntryCell = null;
            const candidates = snapshotDenseArray(
                routeSet.candidates,
                `${routeSetLabel}.candidates`,
                (candidateValue, candidateLabel) => {
                    const candidate = snapshotExactDataObject(
                        candidateValue,
                        ROUTE_CANDIDATE_KEYS,
                        candidateLabel
                    );
                    const pathId = requireNonEmptyString(
                        candidate.pathId,
                        `${candidateLabel}.pathId`
                    );
                    const route = routesByPathId.get(pathId);
                    if (!route || seenPaths.has(pathId)) {
                        throw new RangeError(`${candidateLabel} path가 없거나 중복되었습니다.`);
                    }
                    seenPaths.add(pathId);
                    const entryCell = route.macroCells[0];
                    if (firstEntryCell !== null && !sameMacroCell(firstEntryCell, entryCell)) {
                        throw new RangeError(
                            `${routeSetLabel} candidate route는 같은 entry cell에서 시작해야 합니다.`
                        );
                    }
                    firstEntryCell = entryCell;
                    return Object.freeze({
                        pathId,
                        priority: requireUint32(
                            candidate.priority,
                            `${candidateLabel}.priority`
                        )
                    });
                }
            );
            if (candidates.length < 2) {
                throw new RangeError(`${routeSetLabel}에는 둘 이상의 route candidate가 필요합니다.`);
            }
            return Object.freeze({
                id: requireNonEmptyString(routeSet.id, `${routeSetLabel}.id`),
                candidates,
                selectionPolicyId: requireKnownValue(
                    routeSet.selectionPolicyId,
                    VALID_GRAPH_ROUTE_SELECTION_POLICIES,
                    `${routeSetLabel}.selectionPolicyId`
                ),
                noOpenRoutePolicyId: requireKnownValue(
                    routeSet.noOpenRoutePolicyId,
                    VALID_GRAPH_NO_OPEN_ROUTE_POLICIES,
                    `${routeSetLabel}.noOpenRoutePolicyId`
                )
            });
        }
    );
    const routeSetIds = new Set();
    for (const routeSet of routeSets) {
        if (routeSetIds.has(routeSet.id)) {
            throw new RangeError(`${label}.routeSets에 중복 ID가 있습니다: ${routeSet.id}`);
        }
        routeSetIds.add(routeSet.id);
    }

    const switches = snapshotDenseArray(
        graph.switches,
        `${label}.switches`,
        (value, switchLabel) => {
            const routeSwitch = snapshotExactDataObject(value, SWITCH_KEYS, switchLabel);
            const nodeId = requireNonEmptyString(
                routeSwitch.nodeId,
                `${switchLabel}.nodeId`
            );
            const node = nodeById.get(nodeId);
            if (node?.kind !== ENEMY_ROUTE_GRAPH_NODE_KIND.SWITCH) {
                throw new RangeError(`${switchLabel}.nodeId는 SWITCH node여야 합니다.`);
            }
            const transitionKeys = new Set();
            const transitions = snapshotDenseArray(
                routeSwitch.transitions,
                `${switchLabel}.transitions`,
                (transitionValue, transitionLabel) => {
                    const transition = snapshotExactDataObject(
                        transitionValue,
                        TRANSITION_KEYS,
                        transitionLabel
                    );
                    const fromPathId = requireNonEmptyString(
                        transition.fromPathId,
                        `${transitionLabel}.fromPathId`
                    );
                    const toPathId = requireNonEmptyString(
                        transition.toPathId,
                        `${transitionLabel}.toPathId`
                    );
                    const fromMembership = findNodeMembership(node, fromPathId);
                    const toMembership = findNodeMembership(node, toPathId);
                    const targetWaypointIndex = requireUint32(
                        transition.targetWaypointIndex,
                        `${transitionLabel}.targetWaypointIndex`
                    );
                    const targetRoute = routesByPathId.get(toPathId);
                    if (fromPathId === toPathId
                        || !fromMembership
                        || !toMembership
                        || !targetRoute
                        || targetWaypointIndex !== toMembership.waypointIndex + 1
                        || targetWaypointIndex >= targetRoute.macroCells.length) {
                        throw new RangeError(
                            `${transitionLabel}은 shared switch의 exact next forward waypoint여야 합니다.`
                        );
                    }
                    const transitionKey = `${fromPathId}\u0000${toPathId}`;
                    if (transitionKeys.has(transitionKey)) {
                        throw new RangeError(`${transitionLabel} transition이 중복되었습니다.`);
                    }
                    transitionKeys.add(transitionKey);
                    return Object.freeze({
                        fromPathId,
                        toPathId,
                        targetWaypointIndex,
                        priority: requireUint32(
                            transition.priority,
                            `${transitionLabel}.priority`
                        )
                    });
                }
            );
            return Object.freeze({
                id: requireNonEmptyString(routeSwitch.id, `${switchLabel}.id`),
                nodeId,
                selectionPolicyId: requireKnownValue(
                    routeSwitch.selectionPolicyId,
                    VALID_GRAPH_SWITCH_SELECTION_POLICIES,
                    `${switchLabel}.selectionPolicyId`
                ),
                transitions
            });
        }
    );
    const switchIds = new Set();
    for (const routeSwitch of switches) {
        if (switchIds.has(routeSwitch.id)) {
            throw new RangeError(`${label}.switches에 중복 ID가 있습니다: ${routeSwitch.id}`);
        }
        switchIds.add(routeSwitch.id);
    }

    const closurePathIds = new Set();
    const closures = snapshotDenseArray(
        graph.closures,
        `${label}.closures`,
        (value, closureLabel) => {
            const closure = snapshotExactDataObject(value, CLOSURE_KEYS, closureLabel);
            const pathId = requireNonEmptyString(closure.pathId, `${closureLabel}.pathId`);
            if (!routesByPathId.has(pathId) || closurePathIds.has(pathId)) {
                throw new RangeError(`${closureLabel}.pathId가 없거나 중복되었습니다.`);
            }
            closurePathIds.add(pathId);
            const entranceNodeId = requireNonEmptyString(
                closure.entranceNodeId,
                `${closureLabel}.entranceNodeId`
            );
            const clearanceNodeId = requireNonEmptyString(
                closure.clearanceNodeId,
                `${closureLabel}.clearanceNodeId`
            );
            const upstreamSwitchNodeId = requireNonEmptyString(
                closure.upstreamSwitchNodeId,
                `${closureLabel}.upstreamSwitchNodeId`
            );
            const downstreamMergeNodeId = requireNonEmptyString(
                closure.downstreamMergeNodeId,
                `${closureLabel}.downstreamMergeNodeId`
            );
            const entranceNode = nodeById.get(entranceNodeId);
            const clearanceNode = nodeById.get(clearanceNodeId);
            const switchNode = nodeById.get(upstreamSwitchNodeId);
            const mergeNode = nodeById.get(downstreamMergeNodeId);
            const entrance = entranceNode && findNodeMembership(entranceNode, pathId);
            const clearance = clearanceNode && findNodeMembership(clearanceNode, pathId);
            const upstream = switchNode && findNodeMembership(switchNode, pathId);
            const downstream = mergeNode && findNodeMembership(mergeNode, pathId);
            if (entranceNode?.kind !== ENEMY_ROUTE_GRAPH_NODE_KIND.CLOSURE_ENTRANCE
                || clearanceNode?.kind !== ENEMY_ROUTE_GRAPH_NODE_KIND.CLEARANCE
                || switchNode?.kind !== ENEMY_ROUTE_GRAPH_NODE_KIND.SWITCH
                || mergeNode?.kind !== ENEMY_ROUTE_GRAPH_NODE_KIND.MERGE
                || !entrance
                || !clearance
                || !upstream
                || !downstream
                || !(upstream.progressOrdinal < clearance.progressOrdinal
                    && clearance.progressOrdinal < entrance.progressOrdinal
                    && entrance.progressOrdinal < downstream.progressOrdinal)) {
                throw new RangeError(
                    `${closureLabel} node는 switch < clearance < entrance < merge 순서여야 합니다.`
                );
            }
            const appearsInRouteSet = routeSets.some((routeSet) => (
                routeSet.candidates.some((candidate) => candidate.pathId === pathId)
            ));
            const hasForwardAlternative = switches.some((routeSwitch) => (
                routeSwitch.nodeId === upstreamSwitchNodeId
                && routeSwitch.transitions.some((transition) => (
                    transition.fromPathId === pathId
                    && transition.toPathId !== pathId
                ))
            ));
            if (!appearsInRouteSet || !hasForwardAlternative) {
                throw new RangeError(
                    `${closureLabel}에는 spawn route-set과 forward alternative가 필요합니다.`
                );
            }
            return Object.freeze({
                id: requireNonEmptyString(closure.id, `${closureLabel}.id`),
                pathId,
                entranceNodeId,
                clearanceNodeId,
                upstreamSwitchNodeId,
                downstreamMergeNodeId,
                priority: requireUint32(closure.priority, `${closureLabel}.priority`)
            });
        }
    );
    const closureIds = new Set();
    for (const closure of closures) {
        if (closureIds.has(closure.id)) {
            throw new RangeError(`${label}.closures에 중복 ID가 있습니다: ${closure.id}`);
        }
        closureIds.add(closure.id);
    }

    for (const routeSet of routeSets) {
        const candidatePathIds = routeSet.candidates.map(({ pathId }) => pathId);
        const candidateClosures = candidatePathIds.map((pathId) => (
            closures.find((closure) => closure.pathId === pathId) ?? null
        ));
        if (candidateClosures.some((closure) => closure === null)) {
            throw new RangeError(
                `${label} routeSet ${routeSet.id}의 모든 갈래에는 closure가 필요합니다.`
            );
        }
        const upstreamSwitchNodeId = candidateClosures[0].upstreamSwitchNodeId;
        const downstreamMergeNodeId = candidateClosures[0].downstreamMergeNodeId;
        if (candidateClosures.some((closure) => (
            closure.upstreamSwitchNodeId !== upstreamSwitchNodeId
            || closure.downstreamMergeNodeId !== downstreamMergeNodeId
        ))) {
            throw new RangeError(
                `${label} routeSet ${routeSet.id}은 하나의 실제 switch에서 갈라져 같은 merge로 합쳐져야 합니다.`
            );
        }
        let sharedPrefix = null;
        let sharedCoreSuffix = null;
        const occupiedBranchCells = new Map();
        for (const pathId of candidatePathIds) {
            const closure = candidateClosures.find((entry) => entry.pathId === pathId);
            const route = routesByPathId.get(pathId);
            const switchMembership = findNodeMembership(
                nodeById.get(upstreamSwitchNodeId),
                pathId
            );
            const mergeMembership = findNodeMembership(
                nodeById.get(downstreamMergeNodeId),
                pathId
            );
            if (!closure || !route || !switchMembership || !mergeMembership) {
                throw new RangeError(
                    `${label} routeSet ${routeSet.id}/${pathId}의 switch/merge/closure membership가 유효하지 않습니다.`
                );
            }
            const coreMembership = nodes
                .filter((node) => node.kind === ENEMY_ROUTE_GRAPH_NODE_KIND.CORE)
                .map((node) => findNodeMembership(node, pathId))
                .find((membership) => membership !== null
                    && membership.progressOrdinal
                        > mergeMembership.progressOrdinal) ?? null;
            if (!coreMembership) {
                throw new RangeError(
                    `${label} routeSet ${routeSet.id}/${pathId}는 merge 이후 Core까지 이어져야 합니다.`
                );
            }
            const routeCellKeys = route.macroCells.map(
                ([row, column]) => `${row}:${column}`
            );
            const prefix = routeCellKeys.slice(
                0,
                switchMembership.progressOrdinal + 1
            );
            const coreSuffix = routeCellKeys.slice(
                mergeMembership.progressOrdinal,
                coreMembership.progressOrdinal + 1
            );
            if (sharedPrefix !== null
                && (sharedPrefix.length !== prefix.length
                    || sharedPrefix.some((cell, index) => cell !== prefix[index]))) {
                throw new RangeError(
                    `${label} routeSet ${routeSet.id}은 선언한 switch까지 하나의 공통 진입 경로여야 합니다.`
                );
            }
            if (sharedCoreSuffix !== null
                && (sharedCoreSuffix.length !== coreSuffix.length
                    || sharedCoreSuffix.some(
                        (cell, index) => cell !== coreSuffix[index]
                    ))) {
                throw new RangeError(
                    `${label} routeSet ${routeSet.id}은 merge부터 Core까지 하나의 공통 경로여야 합니다.`
                );
            }
            sharedPrefix ??= prefix;
            sharedCoreSuffix ??= coreSuffix;
            const branchCells = routeCellKeys.slice(
                switchMembership.progressOrdinal + 1,
                mergeMembership.progressOrdinal
            );
            const sharedCells = new Set([...prefix, ...coreSuffix]);
            if (new Set(branchCells).size !== branchCells.length
                || branchCells.some((cell) => sharedCells.has(cell))) {
                throw new RangeError(
                    `${label} routeSet ${routeSet.id}/${pathId}의 실제 갈림 구간은 self-intersection할 수 없습니다.`
                );
            }
            for (const cell of branchCells) {
                const ownerPathId = occupiedBranchCells.get(cell);
                if (ownerPathId !== undefined) {
                    throw new RangeError(
                        `${label} routeSet ${routeSet.id}의 ${pathId}/${ownerPathId} 갈림 구간이 ${cell}에서 물리적으로 겹칩니다.`
                    );
                }
                occupiedBranchCells.set(cell, pathId);
            }
        }
    }

    return Object.freeze({
        version: ENEMY_ROUTE_GRAPH_VERSION,
        routeSets,
        nodes,
        switches,
        closures
    });
}
