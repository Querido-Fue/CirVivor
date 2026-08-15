const LITTLE_ENDIAN = true;
const UINT32_MAX = 0xffffffff;
const INT32_MAX = 0x7fffffff;

export const GPU_ROUTE_RUNTIME_ABI_VERSION = 1;
export const GPU_ROUTE_LIFECYCLE_ABI_VERSION = 1;
export const GPU_ROUTE_RUNTIME_MAX_CLOSERS = 8;

export const GPU_ROUTE_RUNTIME_ROLE = Object.freeze({
    NONE: 0,
    ACTOR: 1,
    CLOSER: 2,
    // 갈림길에서 더 막을 수 없다고 판정된 Cork입니다. 물리/전투는 normal
    // enemy 그대로 유지하되 exact lifecycle identity만 보존합니다.
    NORMALIZED: 3
});

export const GPU_ROUTE_RUNTIME_PHASE = Object.freeze({
    NONE: 0,
    SELECT_ROUTE: 1,
    TRAVEL: 2,
    EXPAND: 3,
    READY_TO_CLOSE: 4,
    BLOCKING: 5,
    WAITING: 6,
    DEAD: 7
});

export const GPU_ROUTE_RUNTIME_FLAG = Object.freeze({
    GRAPH_ENABLED: 1 << 0,
    REROUTE_PENDING: 1 << 1,
    WAITING_CLEARANCE: 1 << 2,
    BLOCKER_ACTIVE: 1 << 3,
    ASSIGNMENT_EVENT_PENDING: 1 << 4,
    DEFERRED_FLOW_RESUME: 1 << 5
});

export const GPU_ROUTE_AVAILABILITY_STATE = Object.freeze({
    OPEN: 0,
    LEASED: 1,
    CLOSED: 2
});

export const GPU_ROUTE_RUNTIME_STATUS = Object.freeze({
    OK: 0,
    ABI_MISMATCH: 1 << 0,
    RECORD_INVALID: 1 << 1,
    CLOSER_CAPACITY_EXCEEDED: 1 << 2,
    EVENT_CAPACITY_EXCEEDED: 1 << 3,
    CLEANUP_INVALID: 1 << 4,
    AVAILABILITY_VERSION_EXHAUSTED: 1 << 5,
    LEASE_GENERATION_EXHAUSTED: 1 << 6,
    TOPOLOGY_INVALID: 1 << 7
});

export const GPU_ROUTE_RUNTIME_ACTION = Object.freeze({
    ASSIGNED: 1,
    CLOSED: 2,
    REOPENED: 3,
    CLEANED: 4
});

export const GPU_ROUTE_RUNTIME_ABI = Object.freeze({
    BODY_STATE: Object.freeze({
        STRIDE: 64,
        META: 0,
        SELF_ENTITY_ID: 4,
        SELF_INCARNATION: 8,
        CURRENT_PATH_INDEX: 12,
        ROUTE_SET_INDEX: 16,
        CLOSURE_INDEX: 20,
        OBSERVED_AVAILABILITY_VERSION: 24,
        PHASE_ENTERED_FIXED_TICK: 28,
        TRAVEL_RADIUS: 32,
        BLOCKER_RADIUS: 36,
        EXPANSION_DURATION_FIXED_TICKS: 40,
        PENDING_FIELD_INDEX: 44,
        LEASE_GENERATION: 48,
        PROFILE_CODE: 52,
        RESERVED_0: 56,
        RESERVED_1: 60
    }),
    TOPOLOGY_HEADER: Object.freeze({
        STRIDE: 96,
        ABI_VERSION: 0,
        ENABLED: 4,
        CONTENT_FINGERPRINT: 8,
        PATH_COUNT: 12,
        ROUTE_SET_COUNT: 16,
        CANDIDATE_COUNT: 20,
        FIELD_COUNT: 24,
        SWITCH_COUNT: 28,
        TRANSITION_COUNT: 32,
        CLOSURE_COUNT: 36,
        PATH_OFFSET_WORDS: 40,
        ROUTE_SET_OFFSET_WORDS: 44,
        CANDIDATE_OFFSET_WORDS: 48,
        FIELD_OFFSET_WORDS: 52,
        SWITCH_OFFSET_WORDS: 56,
        TRANSITION_OFFSET_WORDS: 60,
        CLOSURE_OFFSET_WORDS: 64,
        RESERVED_0: 68,
        RESERVED_1: 72,
        RESERVED_2: 76,
        RESERVED_3: 80,
        RESERVED_4: 84,
        RESERVED_5: 88,
        RESERVED_6: 92
    }),
    PATH: Object.freeze({ STRIDE_WORDS: 8 }),
    ROUTE_SET: Object.freeze({
        STRIDE_WORDS: 4,
        CORE_FLOW_FIELD_WORD_OFFSET: 3
    }),
    CANDIDATE: Object.freeze({ STRIDE_WORDS: 4 }),
    FIELD: Object.freeze({ STRIDE_WORDS: 12 }),
    SWITCH: Object.freeze({ STRIDE_WORDS: 4 }),
    TRANSITION: Object.freeze({ STRIDE_WORDS: 8 }),
    CLOSURE: Object.freeze({ STRIDE_WORDS: 16 }),
    AVAILABILITY_HEADER: Object.freeze({
        STRIDE: 64,
        ABI_VERSION: 0,
        STATUS: 4,
        AVAILABILITY_VERSION: 8,
        SOURCE_TICK: 12,
        COMPLETED_THROUGH_TICK: 16,
        TERMINAL_FLAGS: 20,
        GRAPH_CONTENT_FINGERPRINT: 24,
        CLOSURE_COUNT: 28,
        SESSION_GENERATION: 32,
        DEVICE_GENERATION: 36,
        AUTHORITATIVE_EPOCH: 40,
        NEXT_LEASE_GENERATION: 44,
        LAST_EVENT_BASE: 48,
        LAST_EVENT_COUNT: 52,
        FLOW_READY_AVAILABILITY_VERSION: 56,
        RESERVED_0: 56,
        RESERVED_1: 60
    }),
    AVAILABILITY_RECORD: Object.freeze({
        STRIDE: 32,
        STATE: 0,
        OWNER_SLOT: 4,
        OWNER_ENTITY_ID: 8,
        OWNER_INCARNATION: 12,
        LEASE_GENERATION: 16,
        CHANGED_AT_FIXED_TICK: 20,
        CHANGED_AVAILABILITY_VERSION: 24,
        RESERVED_0: 24,
        RESERVED_1: 28
    }),
    CLEANUP_HEADER: Object.freeze({
        STRIDE: 32,
        ABI_VERSION: 0,
        TARGET_FIXED_TICK: 4,
        RECORD_COUNT: 8,
        STATUS: 12,
        BATCH_ID_FINGERPRINT: 16,
        RESERVED_0: 20,
        RESERVED_1: 24,
        RESERVED_2: 28
    }),
    CLEANUP_RECORD: Object.freeze({
        STRIDE: 32,
        BODY_SLOT: 0,
        ENTITY_ID: 4,
        INCARNATION: 8,
        CLOSURE_INDEX: 12,
        LEASE_GENERATION: 16,
        OBSERVED_AVAILABILITY_VERSION: 20,
        COMMAND_ID_FINGERPRINT: 24,
        RESERVED_0: 28
    }),
    PARAMS: Object.freeze({
        STRIDE: 32,
        ABI_VERSION: 0,
        FIXED_TICK: 4,
        MAX_EVENTS: 8,
        TERMINAL_FINAL_SUBMIT: 12,
        FIXED_DELTA: 16,
        RESERVED_0: 20,
        RESERVED_1: 24,
        RESERVED_2: 28
    })
});

function requireUint32(value, label, { positive = false, nonSentinel = false } = {}) {
    const number = Number(value);
    if (!Number.isSafeInteger(number)
        || number < (positive ? 1 : 0)
        || number > UINT32_MAX
        || (nonSentinel && number === UINT32_MAX)) {
        throw new RangeError(`${label}은 유효한 uint32여야 합니다.`);
    }
    return number;
}

function requireIndex(value, capacity, label, allowInvalid = false) {
    const index = requireUint32(value, label);
    if (allowInvalid && index === UINT32_MAX) return index;
    if (index >= capacity) {
        throw new RangeError(`${label}이 capacity 범위를 벗어났습니다.`);
    }
    return index;
}

function requirePositiveFloat32(value, label) {
    const number = Math.fround(Number(value));
    if (!Number.isFinite(number) || number <= 0) {
        throw new RangeError(`${label}은 양의 finite float32여야 합니다.`);
    }
    return number;
}

function float32Bits(value) {
    const bytes = new ArrayBuffer(4);
    const view = new DataView(bytes);
    view.setFloat32(0, Math.fround(value), LITTLE_ENDIAN);
    return view.getUint32(0, LITTLE_ENDIAN);
}

function contentFingerprint(contentKey) {
    const source = String(contentKey ?? 'route-graph-disabled');
    let hash = 0x811c9dc5;
    for (let index = 0; index < source.length; index++) {
        const code = source.charCodeAt(index);
        hash = Math.imul((hash ^ (code & 0xff)) >>> 0, 0x01000193) >>> 0;
        hash = Math.imul((hash ^ (code >>> 8)) >>> 0, 0x01000193) >>> 0;
    }
    return hash === 0 || hash === UINT32_MAX ? 1 : hash;
}

export function packGpuRouteRuntimeMeta(role, phase, flags = 0) {
    const normalizedRole = requireUint32(role, 'routeRuntime.role');
    const normalizedPhase = requireUint32(phase, 'routeRuntime.phase');
    const normalizedFlags = requireUint32(flags, 'routeRuntime.flags');
    if (normalizedRole > 0xff || normalizedPhase > 0xff || normalizedFlags > 0xffff) {
        throw new RangeError('route runtime meta component 범위를 벗어났습니다.');
    }
    return (normalizedRole | (normalizedPhase << 8) | (normalizedFlags << 16)) >>> 0;
}

export function unpackGpuRouteRuntimeMeta(meta) {
    const value = requireUint32(meta, 'routeRuntime.meta');
    return Object.freeze({
        role: value & 0xff,
        phase: (value >>> 8) & 0xff,
        flags: (value >>> 16) & 0xffff
    });
}

export function createGpuRouteRuntimeStateBuffer(capacity) {
    return new ArrayBuffer(
        requireUint32(capacity, 'routeRuntime.capacity', { positive: true })
            * GPU_ROUTE_RUNTIME_ABI.BODY_STATE.STRIDE
    );
}

export function writeGpuRouteRuntimeState(buffer, capacity, index, source = null) {
    if (!(buffer instanceof ArrayBuffer)
        || buffer.byteLength !== capacity * GPU_ROUTE_RUNTIME_ABI.BODY_STATE.STRIDE) {
        throw new TypeError('route runtime state buffer 계약이 유효하지 않습니다.');
    }
    const slot = requireIndex(index, capacity, 'routeRuntime.slot');
    const abi = GPU_ROUTE_RUNTIME_ABI.BODY_STATE;
    const offset = slot * abi.STRIDE;
    new Uint8Array(buffer, offset, abi.STRIDE).fill(0);
    if (source === null || source === undefined) return slot;
    if (!source || typeof source !== 'object') {
        throw new TypeError('routeRuntimeState는 객체여야 합니다.');
    }
    const role = requireUint32(source.role ?? GPU_ROUTE_RUNTIME_ROLE.NONE, 'routeRuntime.role');
    if (role === GPU_ROUTE_RUNTIME_ROLE.NONE) return slot;
    if (role !== GPU_ROUTE_RUNTIME_ROLE.ACTOR
        && role !== GPU_ROUTE_RUNTIME_ROLE.CLOSER
        && role !== GPU_ROUTE_RUNTIME_ROLE.NORMALIZED) {
        throw new RangeError('routeRuntime.role이 알려진 값이 아닙니다.');
    }
    const phase = requireUint32(
        source.phase ?? (role === GPU_ROUTE_RUNTIME_ROLE.NORMALIZED
            ? GPU_ROUTE_RUNTIME_PHASE.NONE
            : GPU_ROUTE_RUNTIME_PHASE.SELECT_ROUTE),
        'routeRuntime.phase'
    );
    if ((role === GPU_ROUTE_RUNTIME_ROLE.NORMALIZED
            && phase !== GPU_ROUTE_RUNTIME_PHASE.NONE)
        || (role !== GPU_ROUTE_RUNTIME_ROLE.NORMALIZED
            && (phase < GPU_ROUTE_RUNTIME_PHASE.SELECT_ROUTE
                || phase > GPU_ROUTE_RUNTIME_PHASE.DEAD))) {
        throw new RangeError('routeRuntime.phase가 알려진 값이 아닙니다.');
    }
    const flags = requireUint32(
        source.flags ?? GPU_ROUTE_RUNTIME_FLAG.GRAPH_ENABLED,
        'routeRuntime.flags'
    );
    const entityId = requireUint32(source.selfEntityId, 'routeRuntime.selfEntityId', {
        nonSentinel: true
    });
    const incarnation = requireUint32(source.selfIncarnation, 'routeRuntime.selfIncarnation', {
        nonSentinel: true
    });
    const view = new DataView(buffer);
    view.setUint32(offset + abi.META, packGpuRouteRuntimeMeta(role, phase, flags), LITTLE_ENDIAN);
    view.setUint32(offset + abi.SELF_ENTITY_ID, entityId, LITTLE_ENDIAN);
    view.setUint32(offset + abi.SELF_INCARNATION, incarnation, LITTLE_ENDIAN);
    view.setUint32(
        offset + abi.CURRENT_PATH_INDEX,
        requireUint32(source.currentPathIndex ?? UINT32_MAX, 'routeRuntime.currentPathIndex'),
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + abi.ROUTE_SET_INDEX,
        requireUint32(source.routeSetIndex, 'routeRuntime.routeSetIndex'),
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + abi.CLOSURE_INDEX,
        requireUint32(source.closureIndex ?? UINT32_MAX, 'routeRuntime.closureIndex'),
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + abi.OBSERVED_AVAILABILITY_VERSION,
        requireUint32(source.observedAvailabilityVersion ?? 0, 'routeRuntime.observedVersion'),
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + abi.PHASE_ENTERED_FIXED_TICK,
        requireUint32(source.phaseEnteredFixedTick ?? 0, 'routeRuntime.phaseEnteredFixedTick'),
        LITTLE_ENDIAN
    );
    view.setFloat32(
        offset + abi.TRAVEL_RADIUS,
        role === GPU_ROUTE_RUNTIME_ROLE.CLOSER
            ? requirePositiveFloat32(source.travelRadius, 'routeRuntime.travelRadius')
            : 0,
        LITTLE_ENDIAN
    );
    view.setFloat32(
        offset + abi.BLOCKER_RADIUS,
        role === GPU_ROUTE_RUNTIME_ROLE.CLOSER
            ? requirePositiveFloat32(source.blockerRadius, 'routeRuntime.blockerRadius')
            : 0,
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + abi.EXPANSION_DURATION_FIXED_TICKS,
        role === GPU_ROUTE_RUNTIME_ROLE.CLOSER
            ? requireUint32(source.expansionDurationFixedTicks, 'routeRuntime.expansionTicks', {
                positive: true,
                nonSentinel: true
            })
            : 0,
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + abi.PENDING_FIELD_INDEX,
        requireUint32(source.pendingFieldIndex ?? UINT32_MAX, 'routeRuntime.pendingFieldIndex'),
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + abi.LEASE_GENERATION,
        requireUint32(source.leaseGeneration ?? 0, 'routeRuntime.leaseGeneration'),
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + abi.PROFILE_CODE,
        requireUint32(source.profileCode ?? 0, 'routeRuntime.profileCode'),
        LITTLE_ENDIAN
    );
    return slot;
}

export function copyGpuRouteRuntimeStateSlot(
    source,
    sourceCapacity,
    sourceIndex,
    target,
    targetCapacity,
    targetIndex
) {
    const stride = GPU_ROUTE_RUNTIME_ABI.BODY_STATE.STRIDE;
    const from = requireIndex(sourceIndex, sourceCapacity, 'routeRuntime.sourceSlot');
    const to = requireIndex(targetIndex, targetCapacity, 'routeRuntime.targetSlot');
    new Uint8Array(target, to * stride, stride).set(
        new Uint8Array(source, from * stride, stride)
    );
}

export function readGpuRouteRuntimeState(buffer, capacity, index) {
    const slot = requireIndex(index, capacity, 'routeRuntime.slot');
    const abi = GPU_ROUTE_RUNTIME_ABI.BODY_STATE;
    const offset = slot * abi.STRIDE;
    const view = new DataView(buffer);
    const meta = unpackGpuRouteRuntimeMeta(view.getUint32(offset + abi.META, LITTLE_ENDIAN));
    return Object.freeze({
        ...meta,
        selfEntityId: view.getUint32(offset + abi.SELF_ENTITY_ID, LITTLE_ENDIAN),
        selfIncarnation: view.getUint32(offset + abi.SELF_INCARNATION, LITTLE_ENDIAN),
        currentPathIndex: view.getUint32(offset + abi.CURRENT_PATH_INDEX, LITTLE_ENDIAN),
        routeSetIndex: view.getUint32(offset + abi.ROUTE_SET_INDEX, LITTLE_ENDIAN),
        closureIndex: view.getUint32(offset + abi.CLOSURE_INDEX, LITTLE_ENDIAN),
        observedAvailabilityVersion: view.getUint32(
            offset + abi.OBSERVED_AVAILABILITY_VERSION,
            LITTLE_ENDIAN
        ),
        phaseEnteredFixedTick: view.getUint32(
            offset + abi.PHASE_ENTERED_FIXED_TICK,
            LITTLE_ENDIAN
        ),
        travelRadius: view.getFloat32(offset + abi.TRAVEL_RADIUS, LITTLE_ENDIAN),
        blockerRadius: view.getFloat32(offset + abi.BLOCKER_RADIUS, LITTLE_ENDIAN),
        expansionDurationFixedTicks: view.getUint32(
            offset + abi.EXPANSION_DURATION_FIXED_TICKS,
            LITTLE_ENDIAN
        ),
        pendingFieldIndex: view.getUint32(offset + abi.PENDING_FIELD_INDEX, LITTLE_ENDIAN),
        leaseGeneration: view.getUint32(offset + abi.LEASE_GENERATION, LITTLE_ENDIAN),
        profileCode: view.getUint32(offset + abi.PROFILE_CODE, LITTLE_ENDIAN)
    });
}

function requireDenseIndexed(source, label) {
    if (!Array.isArray(source)) throw new TypeError(`${label}은 배열이어야 합니다.`);
    for (let index = 0; index < source.length; index++) {
        if (!Object.prototype.hasOwnProperty.call(source, index)) {
            throw new TypeError(`${label}은 dense 배열이어야 합니다.`);
        }
    }
    return source;
}

/** Host-compiled graph를 shader 전용 단일 raw-u32 topology buffer로 pack합니다. */
export function createGpuRouteRuntimeTopology(flowFieldAtlas) {
    const graph = flowFieldAtlas?.routeGraph ?? null;
    const fingerprint = contentFingerprint(flowFieldAtlas?.contentKey);
    if (graph === null) {
        const buffer = new ArrayBuffer(GPU_ROUTE_RUNTIME_ABI.TOPOLOGY_HEADER.STRIDE);
        const view = new DataView(buffer);
        view.setUint32(0, GPU_ROUTE_RUNTIME_ABI_VERSION, LITTLE_ENDIAN);
        view.setUint32(8, fingerprint, LITTLE_ENDIAN);
        return Object.freeze({
            enabled: false,
            contentKey: flowFieldAtlas?.contentKey ?? null,
            contentFingerprint: fingerprint,
            buffer,
            pathIndexById: Object.freeze(Object.create(null)),
            routeSetIndexById: Object.freeze(Object.create(null)),
            closureIds: Object.freeze([]),
            pathIds: Object.freeze([]),
            routeSetIds: Object.freeze([])
        });
    }
    if (graph.version !== GPU_ROUTE_RUNTIME_ABI_VERSION) {
        throw new RangeError('routeGraph ABI version이 지원되지 않습니다.');
    }
    const paths = requireDenseIndexed(graph.paths, 'routeGraph.paths');
    const routeSets = requireDenseIndexed(graph.routeSets, 'routeGraph.routeSets');
    const candidates = requireDenseIndexed(
        graph.routeCandidates,
        'routeGraph.routeCandidates'
    );
    const nodes = requireDenseIndexed(graph.nodes, 'routeGraph.nodes');
    const memberships = requireDenseIndexed(
        graph.memberships,
        'routeGraph.memberships'
    );
    const switches = requireDenseIndexed(graph.switches, 'routeGraph.switches');
    const transitions = requireDenseIndexed(
        graph.transitions,
        'routeGraph.transitions'
    );
    const closures = requireDenseIndexed(graph.closures, 'routeGraph.closures');
    const fieldCount = requireUint32(flowFieldAtlas.fieldCount, 'routeTopology.fieldCount', {
        positive: true
    });
    const headerWords = GPU_ROUTE_RUNTIME_ABI.TOPOLOGY_HEADER.STRIDE / 4;
    const pathOffset = headerWords;
    const routeSetOffset = pathOffset + paths.length * GPU_ROUTE_RUNTIME_ABI.PATH.STRIDE_WORDS;
    const candidateOffset = routeSetOffset
        + routeSets.length * GPU_ROUTE_RUNTIME_ABI.ROUTE_SET.STRIDE_WORDS;
    const fieldOffset = candidateOffset
        + candidates.length * GPU_ROUTE_RUNTIME_ABI.CANDIDATE.STRIDE_WORDS;
    const switchOffset = fieldOffset + fieldCount * GPU_ROUTE_RUNTIME_ABI.FIELD.STRIDE_WORDS;
    const transitionOffset = switchOffset
        + switches.length * GPU_ROUTE_RUNTIME_ABI.SWITCH.STRIDE_WORDS;
    const closureOffset = transitionOffset
        + transitions.length * GPU_ROUTE_RUNTIME_ABI.TRANSITION.STRIDE_WORDS;
    const wordCount = closureOffset
        + closures.length * GPU_ROUTE_RUNTIME_ABI.CLOSURE.STRIDE_WORDS;
    const words = new Uint32Array(wordCount);
    const header = GPU_ROUTE_RUNTIME_ABI.TOPOLOGY_HEADER;
    const headerView = new DataView(words.buffer);
    const setHeader = (offset, value) => headerView.setUint32(offset, value, LITTLE_ENDIAN);
    setHeader(header.ABI_VERSION, GPU_ROUTE_RUNTIME_ABI_VERSION);
    setHeader(header.ENABLED, 1);
    setHeader(header.CONTENT_FINGERPRINT, fingerprint);
    setHeader(header.PATH_COUNT, paths.length);
    setHeader(header.ROUTE_SET_COUNT, routeSets.length);
    setHeader(header.CANDIDATE_COUNT, candidates.length);
    setHeader(header.FIELD_COUNT, fieldCount);
    setHeader(header.SWITCH_COUNT, switches.length);
    setHeader(header.TRANSITION_COUNT, transitions.length);
    setHeader(header.CLOSURE_COUNT, closures.length);
    setHeader(header.PATH_OFFSET_WORDS, pathOffset);
    setHeader(header.ROUTE_SET_OFFSET_WORDS, routeSetOffset);
    setHeader(header.CANDIDATE_OFFSET_WORDS, candidateOffset);
    setHeader(header.FIELD_OFFSET_WORDS, fieldOffset);
    setHeader(header.SWITCH_OFFSET_WORDS, switchOffset);
    setHeader(header.TRANSITION_OFFSET_WORDS, transitionOffset);
    setHeader(header.CLOSURE_OFFSET_WORDS, closureOffset);

    const routeSetByPath = new Uint32Array(paths.length);
    routeSetByPath.fill(UINT32_MAX);
    const priorityByPath = new Uint32Array(paths.length);
    const closureByPath = new Uint32Array(paths.length);
    closureByPath.fill(UINT32_MAX);
    for (const routeSet of routeSets) {
        const routeSetIndex = requireIndex(
            routeSet.routeSetIndex,
            routeSets.length,
            'routeSet.routeSetIndex'
        );
        const offset = routeSetOffset
            + routeSetIndex * GPU_ROUTE_RUNTIME_ABI.ROUTE_SET.STRIDE_WORDS;
        const first = requireIndex(
            routeSet.candidateOffset,
            Math.max(candidates.length, 1),
            'routeSet.candidateOffset'
        );
        const count = requireUint32(routeSet.candidateCount, 'routeSet.candidateCount', {
            positive: true
        });
        if (first + count > candidates.length) {
            throw new RangeError('routeSet candidate span이 범위를 벗어났습니다.');
        }
        words[offset] = routeSetIndex;
        words[offset + 1] = first;
        words[offset + 2] = count;
        const canonicalCandidate = candidates[first];
        const canonicalPathIndex = requireIndex(
            canonicalCandidate?.pathIndex,
            paths.length,
            'routeSet.corePathIndex'
        );
        const canonicalPath = paths[canonicalPathIndex];
        words[offset
            + GPU_ROUTE_RUNTIME_ABI.ROUTE_SET.CORE_FLOW_FIELD_WORD_OFFSET]
            = requireIndex(
                canonicalPath.firstFieldIndex + canonicalPath.fieldCount - 1,
                fieldCount,
                'routeSet.coreFlowFieldIndex'
            );
    }
    for (let index = 0; index < candidates.length; index++) {
        const candidate = candidates[index];
        const pathIndex = requireIndex(candidate.pathIndex, paths.length, 'candidate.pathIndex');
        const offset = candidateOffset + index * GPU_ROUTE_RUNTIME_ABI.CANDIDATE.STRIDE_WORDS;
        words[offset] = pathIndex;
        words[offset + 1] = requireUint32(candidate.priority, 'candidate.priority');
        let ownerRouteSet = UINT32_MAX;
        for (const routeSet of routeSets) {
            if (index >= routeSet.candidateOffset
                && index < routeSet.candidateOffset + routeSet.candidateCount) {
                ownerRouteSet = routeSet.routeSetIndex;
                break;
            }
        }
        if (ownerRouteSet === UINT32_MAX || routeSetByPath[pathIndex] !== UINT32_MAX) {
            throw new RangeError('각 path는 정확히 하나의 routeSet candidate여야 합니다.');
        }
        routeSetByPath[pathIndex] = ownerRouteSet;
        priorityByPath[pathIndex] = candidate.priority;
    }
    for (const closure of closures) {
        const closureIndex = requireIndex(
            closure.closureIndex,
            closures.length,
            'closure.closureIndex'
        );
        const pathIndex = requireIndex(closure.pathIndex, paths.length, 'closure.pathIndex');
        if (closureByPath[pathIndex] !== UINT32_MAX) {
            throw new RangeError('한 path에는 하나의 closure만 허용됩니다.');
        }
        closureByPath[pathIndex] = closureIndex;
    }
    for (const path of paths) {
        const pathIndex = requireIndex(path.pathIndex, paths.length, 'path.pathIndex');
        if (routeSetByPath[pathIndex] === UINT32_MAX) {
            throw new RangeError('graph path에 routeSet candidate가 없습니다.');
        }
        const offset = pathOffset + pathIndex * GPU_ROUTE_RUNTIME_ABI.PATH.STRIDE_WORDS;
        words[offset] = pathIndex;
        words[offset + 1] = requireIndex(
            path.firstFieldIndex,
            fieldCount,
            'path.firstFieldIndex'
        );
        words[offset + 2] = requireUint32(path.fieldCount, 'path.fieldCount', { positive: true });
        words[offset + 3] = routeSetByPath[pathIndex];
        words[offset + 4] = priorityByPath[pathIndex];
        words[offset + 5] = closureByPath[pathIndex];
    }

    for (const path of paths) {
        for (let offsetInPath = 0; offsetInPath < path.fieldCount; offsetInPath++) {
            const fieldIndex = path.firstFieldIndex + offsetInPath;
            const offset = fieldOffset + fieldIndex * GPU_ROUTE_RUNTIME_ABI.FIELD.STRIDE_WORDS;
            const stage = flowFieldAtlas.stages[fieldIndex];
            if (!stage?.goalPosition) {
                throw new RangeError(`route field goalPosition이 없습니다: ${fieldIndex}`);
            }
            words[offset] = path.pathIndex;
            words[offset + 1] = offsetInPath + 1;
            words[offset + 2] = offsetInPath + 1;
            words[offset + 3] = UINT32_MAX;
            words[offset + 4] = UINT32_MAX;
            words[offset + 5] = UINT32_MAX;
            words[offset + 6] = float32Bits(stage.goalPosition.x);
            words[offset + 7] = float32Bits(stage.goalPosition.y);
            words[offset + 8] = float32Bits(
                requirePositiveFloat32(stage.transitionRadius, `route field ${fieldIndex}.transitionRadius`)
            );
            words[offset + 9] = stage.nextFieldIndex < 0
                ? UINT32_MAX
                : requireIndex(stage.nextFieldIndex, fieldCount, `route field ${fieldIndex}.next`);
        }
    }
    for (const node of nodes) {
        for (let index = node.membershipOffset;
            index < node.membershipOffset + node.membershipCount;
            index++) {
            const membership = memberships[index];
            if (!membership || membership.fieldIndex < 0) continue;
            const offset = fieldOffset
                + membership.fieldIndex * GPU_ROUTE_RUNTIME_ABI.FIELD.STRIDE_WORDS;
            words[offset + 1] = membership.waypointIndex;
            words[offset + 2] = membership.progressOrdinal;
            words[offset + 3] = node.nodeIndex;
        }
    }
    for (const routeSwitch of switches) {
        const switchIndex = requireIndex(
            routeSwitch.switchIndex,
            switches.length,
            'switch.switchIndex'
        );
        const offset = switchOffset
            + switchIndex * GPU_ROUTE_RUNTIME_ABI.SWITCH.STRIDE_WORDS;
        words[offset] = switchIndex;
        words[offset + 1] = routeSwitch.nodeIndex;
        words[offset + 2] = routeSwitch.transitionOffset;
        words[offset + 3] = routeSwitch.transitionCount;
        const node = nodes[routeSwitch.nodeIndex];
        if (!node || node.nodeIndex !== routeSwitch.nodeIndex) {
            throw new RangeError('switch owner node가 없습니다.');
        }
        for (let membershipIndex = node.membershipOffset;
            membershipIndex < node.membershipOffset + node.membershipCount;
            membershipIndex++) {
            const membership = memberships[membershipIndex];
            if (membership?.fieldIndex >= 0) {
                words[fieldOffset
                    + membership.fieldIndex * GPU_ROUTE_RUNTIME_ABI.FIELD.STRIDE_WORDS
                    + 4] = switchIndex;
            }
        }
    }
    const transitionOwner = new Uint32Array(transitions.length);
    transitionOwner.fill(UINT32_MAX);
    for (const routeSwitch of switches) {
        const first = requireUint32(routeSwitch.transitionOffset, 'switch.transitionOffset');
        const count = requireUint32(routeSwitch.transitionCount, 'switch.transitionCount', {
            positive: true
        });
        if (first + count > transitions.length) {
            throw new RangeError('switch transition span이 범위를 벗어났습니다.');
        }
        for (let index = first; index < first + count; index++) {
            if (transitionOwner[index] !== UINT32_MAX) {
                throw new RangeError('transition owner switch가 중복되었습니다.');
            }
            transitionOwner[index] = routeSwitch.switchIndex;
        }
    }
    for (let index = 0; index < transitions.length; index++) {
        const transition = transitions[index];
        const switchIndex = transitionOwner[index];
        if (switchIndex === UINT32_MAX) throw new RangeError('transition owner switch가 없습니다.');
        const offset = transitionOffset + index * GPU_ROUTE_RUNTIME_ABI.TRANSITION.STRIDE_WORDS;
        words[offset] = switchIndex;
        words[offset + 1] = requireIndex(
            transition.fromPathIndex,
            paths.length,
            'transition.fromPathIndex'
        );
        words[offset + 2] = requireIndex(
            transition.toPathIndex,
            paths.length,
            'transition.toPathIndex'
        );
        words[offset + 3] = requireUint32(
            transition.targetWaypointIndex,
            'transition.targetWaypointIndex'
        );
        words[offset + 4] = requireIndex(
            transition.targetFieldIndex,
            fieldCount,
            'transition.targetFieldIndex'
        );
        words[offset + 5] = requireUint32(transition.priority, 'transition.priority');
    }
    for (const closure of closures) {
        const closureIndex = closure.closureIndex;
        const offset = closureOffset
            + closureIndex * GPU_ROUTE_RUNTIME_ABI.CLOSURE.STRIDE_WORDS;
        const entranceMembership = memberships.find((entry) => (
            entry.pathIndex === closure.pathIndex
                && entry.fieldIndex === closure.entranceFieldIndex
        ));
        const clearanceMembership = memberships.find((entry) => (
            entry.pathIndex === closure.pathIndex
                && entry.fieldIndex === closure.clearanceFieldIndex
        ));
        const upstreamNode = nodes.find(
            (entry) => entry.nodeIndex === closure.upstreamSwitchNodeIndex
        );
        const downstreamNode = nodes.find(
            (entry) => entry.nodeIndex === closure.downstreamMergeNodeIndex
        );
        const upstreamMembership = upstreamNode
            ? memberships.slice(
                upstreamNode.membershipOffset,
                upstreamNode.membershipOffset + upstreamNode.membershipCount
            ).find((entry) => entry.pathIndex === closure.pathIndex)
            : null;
        const downstreamMembership = downstreamNode
            ? memberships.slice(
                downstreamNode.membershipOffset,
                downstreamNode.membershipOffset + downstreamNode.membershipCount
            ).find((entry) => entry.pathIndex === closure.pathIndex)
            : null;
        const stage = flowFieldAtlas.stages[closure.entranceFieldIndex];
        if (!entranceMembership || !clearanceMembership
            || !upstreamMembership || !downstreamMembership || !stage?.goalPosition) {
            throw new RangeError('closure GPU topology membership/position이 불완전합니다.');
        }
        words[offset] = closureIndex;
        words[offset + 1] = closure.pathIndex;
        words[offset + 2] = closure.entranceFieldIndex;
        words[offset + 3] = closure.clearanceFieldIndex;
        words[offset + 4] = closure.upstreamSwitchNodeIndex;
        words[offset + 5] = closure.downstreamMergeNodeIndex;
        words[offset + 6] = closure.priority;
        words[offset + 7] = entranceMembership.progressOrdinal;
        words[offset + 8] = clearanceMembership.progressOrdinal;
        words[offset + 9] = upstreamMembership.progressOrdinal;
        words[offset + 10] = downstreamMembership.progressOrdinal;
        words[offset + 11] = float32Bits(stage.goalPosition.x);
        words[offset + 12] = float32Bits(stage.goalPosition.y);
        words[offset + 13] = closure.physicalBlocking === false ? 0 : 1;
        words[fieldOffset
            + closure.entranceFieldIndex * GPU_ROUTE_RUNTIME_ABI.FIELD.STRIDE_WORDS
            + 5] = closureIndex;
    }
    const pathIndexById = Object.create(null);
    for (const path of paths) pathIndexById[path.pathId] = path.pathIndex;
    const routeSetIndexById = Object.create(null);
    for (const routeSet of routeSets) routeSetIndexById[routeSet.id] = routeSet.routeSetIndex;
    return Object.freeze({
        enabled: true,
        contentKey: flowFieldAtlas.contentKey,
        contentFingerprint: fingerprint,
        buffer: words.buffer,
        pathIndexById: Object.freeze(pathIndexById),
        routeSetIndexById: Object.freeze(routeSetIndexById),
        pathIds: Object.freeze(paths.map((path) => path.pathId)),
        routeSetIds: Object.freeze(routeSets.map((routeSet) => routeSet.id)),
        closureIds: Object.freeze(closures.map((closure) => closure.id)),
        graph
    });
}

export function createGpuRouteAvailabilityBuffer(topology, protocol = {}) {
    const closureCount = topology?.graph?.closures?.length ?? 0;
    const abi = GPU_ROUTE_RUNTIME_ABI.AVAILABILITY_HEADER;
    const recordAbi = GPU_ROUTE_RUNTIME_ABI.AVAILABILITY_RECORD;
    const buffer = new ArrayBuffer(abi.STRIDE + closureCount * recordAbi.STRIDE);
    const view = new DataView(buffer);
    view.setUint32(abi.ABI_VERSION, GPU_ROUTE_RUNTIME_ABI_VERSION, LITTLE_ENDIAN);
    view.setUint32(abi.AVAILABILITY_VERSION, 1, LITTLE_ENDIAN);
    view.setUint32(abi.GRAPH_CONTENT_FINGERPRINT, topology.contentFingerprint, LITTLE_ENDIAN);
    view.setUint32(abi.CLOSURE_COUNT, closureCount, LITTLE_ENDIAN);
    view.setUint32(
        abi.SESSION_GENERATION,
        requireUint32(protocol.sessionGeneration ?? 1, 'routeProtocol.sessionGeneration', {
            positive: true,
            nonSentinel: true
        }),
        LITTLE_ENDIAN
    );
    view.setUint32(
        abi.DEVICE_GENERATION,
        requireUint32(protocol.deviceGeneration ?? 0, 'routeProtocol.deviceGeneration'),
        LITTLE_ENDIAN
    );
    view.setUint32(
        abi.AUTHORITATIVE_EPOCH,
        requireUint32(protocol.authoritativeEpoch ?? 0, 'routeProtocol.authoritativeEpoch'),
        LITTLE_ENDIAN
    );
    view.setUint32(abi.NEXT_LEASE_GENERATION, 1, LITTLE_ENDIAN);
    view.setUint32(abi.FLOW_READY_AVAILABILITY_VERSION, 1, LITTLE_ENDIAN);
    for (let index = 0; index < closureCount; index++) {
        const offset = abi.STRIDE + index * recordAbi.STRIDE;
        view.setUint32(offset + recordAbi.STATE, GPU_ROUTE_AVAILABILITY_STATE.OPEN, LITTLE_ENDIAN);
        view.setUint32(offset + recordAbi.OWNER_SLOT, UINT32_MAX, LITTLE_ENDIAN);
        view.setUint32(offset + recordAbi.OWNER_ENTITY_ID, UINT32_MAX, LITTLE_ENDIAN);
        view.setUint32(offset + recordAbi.OWNER_INCARNATION, UINT32_MAX, LITTLE_ENDIAN);
        view.setUint32(
            offset + recordAbi.CHANGED_AVAILABILITY_VERSION,
            1,
            LITTLE_ENDIAN
        );
    }
    return buffer;
}

export function createGpuRouteCleanupProgram(capacity = GPU_ROUTE_RUNTIME_MAX_CLOSERS) {
    const safeCapacity = requireUint32(capacity, 'routeCleanup.capacity', { positive: true });
    return Object.freeze({
        capacity: safeCapacity,
        buffer: new ArrayBuffer(
            GPU_ROUTE_RUNTIME_ABI.CLEANUP_HEADER.STRIDE
                + safeCapacity * GPU_ROUTE_RUNTIME_ABI.CLEANUP_RECORD.STRIDE
        )
    });
}

export function writeGpuRouteCleanupProgram(program, request = {}) {
    if (!program?.buffer || !(program.buffer instanceof ArrayBuffer)) {
        throw new TypeError('route cleanup program이 필요합니다.');
    }
    const records = request.records ?? [];
    if (!Array.isArray(records) || records.length > program.capacity) {
        throw new RangeError('route cleanup record capacity를 초과했습니다.');
    }
    new Uint8Array(program.buffer).fill(0);
    const header = GPU_ROUTE_RUNTIME_ABI.CLEANUP_HEADER;
    const recordAbi = GPU_ROUTE_RUNTIME_ABI.CLEANUP_RECORD;
    const view = new DataView(program.buffer);
    view.setUint32(header.ABI_VERSION, GPU_ROUTE_LIFECYCLE_ABI_VERSION, LITTLE_ENDIAN);
    view.setUint32(
        header.TARGET_FIXED_TICK,
        requireUint32(request.targetFixedTick ?? 0, 'routeCleanup.targetFixedTick'),
        LITTLE_ENDIAN
    );
    view.setUint32(header.RECORD_COUNT, records.length, LITTLE_ENDIAN);
    view.setUint32(
        header.BATCH_ID_FINGERPRINT,
        requireUint32(request.batchIdFingerprint ?? 1, 'routeCleanup.batchIdFingerprint', {
            positive: true,
            nonSentinel: true
        }),
        LITTLE_ENDIAN
    );
    const seen = new Set();
    for (let index = 0; index < records.length; index++) {
        const record = records[index];
        const entityId = requireUint32(record.entityId, `routeCleanup[${index}].entityId`, {
            nonSentinel: true
        });
        const incarnation = requireUint32(
            record.incarnation,
            `routeCleanup[${index}].incarnation`,
            { nonSentinel: true }
        );
        const key = `${entityId}:${incarnation}`;
        if (seen.has(key)) throw new RangeError('route cleanup exact handle이 중복되었습니다.');
        seen.add(key);
        const offset = header.STRIDE + index * recordAbi.STRIDE;
        view.setUint32(offset + recordAbi.BODY_SLOT, requireUint32(
            record.bodySlot,
            `routeCleanup[${index}].bodySlot`,
            { nonSentinel: true }
        ), LITTLE_ENDIAN);
        view.setUint32(offset + recordAbi.ENTITY_ID, entityId, LITTLE_ENDIAN);
        view.setUint32(offset + recordAbi.INCARNATION, incarnation, LITTLE_ENDIAN);
        view.setUint32(offset + recordAbi.CLOSURE_INDEX, requireUint32(
            record.closureIndex,
            `routeCleanup[${index}].closureIndex`,
            { nonSentinel: true }
        ), LITTLE_ENDIAN);
        view.setUint32(offset + recordAbi.LEASE_GENERATION, requireUint32(
            record.leaseGeneration,
            `routeCleanup[${index}].leaseGeneration`,
            { positive: true, nonSentinel: true }
        ), LITTLE_ENDIAN);
        view.setUint32(offset + recordAbi.OBSERVED_AVAILABILITY_VERSION, requireUint32(
            record.observedAvailabilityVersion,
            `routeCleanup[${index}].observedAvailabilityVersion`,
            { positive: true, nonSentinel: true }
        ), LITTLE_ENDIAN);
        view.setUint32(offset + recordAbi.COMMAND_ID_FINGERPRINT, requireUint32(
            record.commandIdFingerprint,
            `routeCleanup[${index}].commandIdFingerprint`,
            { positive: true, nonSentinel: true }
        ), LITTLE_ENDIAN);
    }
    return program;
}

export function writeGpuRouteRuntimeParams(buffer, values = {}) {
    if (!(buffer instanceof ArrayBuffer)
        || buffer.byteLength !== GPU_ROUTE_RUNTIME_ABI.PARAMS.STRIDE) {
        throw new TypeError('route runtime params buffer 계약이 유효하지 않습니다.');
    }
    const view = new DataView(buffer);
    view.setUint32(0, GPU_ROUTE_RUNTIME_ABI_VERSION, LITTLE_ENDIAN);
    view.setUint32(4, requireUint32(values.fixedTick ?? 0, 'routeParams.fixedTick'), LITTLE_ENDIAN);
    const maxEvents = requireUint32(values.maxEvents ?? 0, 'routeParams.maxEvents');
    if (maxEvents > INT32_MAX) throw new RangeError('routeParams.maxEvents가 너무 큽니다.');
    view.setUint32(8, maxEvents, LITTLE_ENDIAN);
    view.setUint32(12, values.terminalFinalSubmit === true ? 1 : 0, LITTLE_ENDIAN);
    view.setFloat32(16, requirePositiveFloat32(values.fixedDelta, 'routeParams.fixedDelta'), LITTLE_ENDIAN);
    view.setUint32(20, 0, LITTLE_ENDIAN);
    view.setUint32(24, 0, LITTLE_ENDIAN);
    view.setUint32(28, 0, LITTLE_ENDIAN);
    return buffer;
}

export const GPU_ROUTE_RUNTIME_INVALID_INDEX = UINT32_MAX;
