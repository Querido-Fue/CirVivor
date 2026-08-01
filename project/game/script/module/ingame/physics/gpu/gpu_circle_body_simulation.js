import {
    GPU_CIRCLE_BODY_ABI,
    GPU_CIRCLE_BODY_FLOW,
    GPU_CIRCLE_BODY_IDENTITY,
    GPU_CIRCLE_BODY_META,
    createGpuCircleBodyAbiStorage,
    readGpuCircleBody,
    writeGpuCircleBodyCounts,
    writeGpuCircleBodySpawn
} from './gpu_circle_body_abi.js';
import {
    GPU_BODY_PRESENTATION_PROFILE,
    GpuBodyPresentationClock
} from './gpu_body_presentation_clock.js';
import {
    GPU_COLLISION_COMPUTE_WGSL,
    GPU_COLLISION_INDIRECT_WGSL,
    GPU_COLLISION_RENDER_WGSL
} from './gpu_collision_shaders.js';

const GRID_BUCKET_COUNT = 2;
const SOURCE_GRID_CELL_WORLD_UNITS = 12;
const SOURCE_SDF_CELL_WORLD_UNITS = 8;
const SOURCE_MAX_BODIES_PER_CELL = 64;
const SOURCE_SOLVER_ITERATIONS = 6;
const BODY_WORKGROUP_SIZE = 256;
const OVERFLOW_READBACK_SLOT_COUNT = 4;
const OVERFLOW_READBACK_INTERVAL_TICKS = 4;
const OVERFLOW_TELEMETRY_MAX_AGE_TICKS = 60;
const COMPUTE_PARAMS_FLOW_STAGE_OFFSET = 96;
const COMPUTE_PARAMS_FLOW_STAGE_STRIDE = 16;
const COMPUTE_PARAMS_BYTE_SIZE = COMPUTE_PARAMS_FLOW_STAGE_OFFSET
    + (GPU_CIRCLE_BODY_FLOW.MAX_FIELD_COUNT * COMPUTE_PARAMS_FLOW_STAGE_STRIDE);
const RENDER_PARAMS_BYTE_SIZE = 32;
const GRID_OVERFLOW_BYTE_SIZE = 16;
const DISPATCH_INDIRECT_BYTE_SIZE = 12;
const DRAW_INDIRECT_BYTE_SIZE = 16;
const BODY_RENDER_STYLE_STRIDE = 32;
const FLOAT32_BYTES = 4;
const MASS_EPSILON = 0.000001;
const UINT32_MAX = 0xffffffff;
const LITTLE_ENDIAN = true;

const COMPUTE_ENTRY_POINTS = Object.freeze([
    'prepare_bodies',
    'clear_grid',
    'build_grid',
    'clear_position_deltas',
    'solve_body_body',
    'solve_body_world',
    'apply_position_deltas',
    'rebuild_velocities',
    'finalize_velocities'
]);

function requirePositiveInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
        throw new RangeError(`${label}은(는) 양의 정수여야 합니다.`);
    }
    return number;
}

function requirePositiveFinite(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
        throw new RangeError(`${label}은(는) 양의 유한 숫자여야 합니다.`);
    }
    return number;
}

function normalizeNonNegativeFinite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : fallback;
}

function normalizeSize2(value, label) {
    const x = requirePositiveFinite(value?.x ?? value?.width ?? value, `${label}.x`);
    const y = requirePositiveFinite(value?.y ?? value?.height ?? value, `${label}.y`);
    return Object.freeze({ x, y });
}

function captureFailure(stage, error) {
    let name = 'Error';
    let message = 'Unknown error';
    try {
        if (typeof error?.name === 'string' && error.name.length > 0) {
            name = error.name;
        }
    } catch {
        // hostile diagnostics are reduced to stable fallback text
    }
    try {
        if (typeof error?.message === 'string' && error.message.length > 0) {
            message = error.message;
        }
    } catch {
        // hostile diagnostics are reduced to stable fallback text
    }
    return Object.freeze({ stage, name, message });
}

function requirePlatformPort(port) {
    const methods = [
        'getState',
        'getDevice',
        'getCanvasFormat',
        'getDeviceGeneration',
        'acquireFrameTarget',
        'clearCanvas',
        'markCanvasDrawn',
        'markCanvasCleared'
    ];
    if (!port || methods.some((method) => typeof port[method] !== 'function')) {
        throw new TypeError('GpuCircleBodySimulation에 유효한 WebGPU platform port가 필요합니다.');
    }
    return port;
}

function normalizeSignedDistanceField(sdf) {
    if (!sdf) {
        return Object.freeze({
            enabled: false,
            cols: 1,
            rows: 1,
            values: new Float32Array([3.4028234663852886e38])
        });
    }
    const cols = requirePositiveInteger(sdf.cols ?? sdf.width, 'sdf.cols');
    const rows = requirePositiveInteger(sdf.rows ?? sdf.height, 'sdf.rows');
    const source = sdf.values ?? sdf.data;
    if (!(source instanceof Float32Array) || source.length !== cols * rows) {
        throw new TypeError('SDF values는 cols*rows 길이의 Float32Array여야 합니다.');
    }
    const values = source.slice();
    for (let index = 0; index < values.length; index++) {
        if (!Number.isFinite(values[index])) {
            throw new TypeError(`SDF 값은 모두 유한해야 합니다: index=${index}`);
        }
    }
    return Object.freeze({ enabled: true, cols, rows, values });
}

function normalizeFlowFieldAtlas(atlas) {
    if (!atlas) {
        return Object.freeze({
            enabled: false,
            cols: 1,
            rows: 1,
            fieldCount: 0,
            origin: Object.freeze({ x: 0, y: 0 }),
            cellSize: Object.freeze({ x: 1, y: 1 }),
            directions: new Float32Array([0, 0]),
            stages: Object.freeze([])
        });
    }
    const cols = requirePositiveInteger(atlas.cols ?? atlas.width, 'flowFieldAtlas.cols');
    const rows = requirePositiveInteger(atlas.rows ?? atlas.height, 'flowFieldAtlas.rows');
    const fieldCount = requirePositiveInteger(
        atlas.fieldCount ?? atlas.stages?.length,
        'flowFieldAtlas.fieldCount'
    );
    if (fieldCount > GPU_CIRCLE_BODY_FLOW.MAX_FIELD_COUNT) {
        throw new RangeError(
            `flow field atlas는 ${GPU_CIRCLE_BODY_FLOW.MAX_FIELD_COUNT} layer 이하여야 합니다.`
        );
    }
    const sourceDirections = atlas.directions ?? atlas.values;
    if (!(sourceDirections instanceof Float32Array)
        || sourceDirections.length !== cols * rows * fieldCount * 2) {
        throw new TypeError('flow field directions는 cols*rows*fieldCount*2 길이여야 합니다.');
    }
    const directions = sourceDirections.slice();
    for (let index = 0; index < directions.length; index++) {
        if (!Number.isFinite(directions[index])) {
            throw new TypeError(`flow field 방향은 모두 유한해야 합니다: index=${index}`);
        }
    }
    if (!Array.isArray(atlas.stages) || atlas.stages.length !== fieldCount) {
        throw new TypeError('flow field stages는 fieldCount 길이의 배열이어야 합니다.');
    }
    const stages = atlas.stages.map((stage, index) => {
        const column = stage?.goalCell?.column ?? stage?.goalCell?.x;
        const row = stage?.goalCell?.row ?? stage?.goalCell?.y;
        const nextFieldIndex = Number(stage?.nextFieldIndex ?? -1);
        if (!Number.isInteger(column)
            || !Number.isInteger(row)
            || column < 0
            || column >= cols
            || row < 0
            || row >= rows) {
            throw new RangeError(`flow field goalCell이 atlas 범위를 벗어났습니다: index=${index}`);
        }
        if (!Number.isInteger(nextFieldIndex)
            || nextFieldIndex < -1
            || nextFieldIndex >= fieldCount) {
            throw new RangeError(`flow field nextFieldIndex가 유효하지 않습니다: index=${index}`);
        }
        return Object.freeze({ column, row, nextFieldIndex });
    });
    const originX = Number(atlas.origin?.x ?? 0);
    const originY = Number(atlas.origin?.y ?? 0);
    if (!Number.isFinite(originX) || !Number.isFinite(originY)) {
        throw new TypeError('flow field origin은 유한해야 합니다.');
    }
    return Object.freeze({
        enabled: true,
        cols,
        rows,
        fieldCount,
        origin: Object.freeze({ x: originX, y: originY }),
        cellSize: normalizeSize2(atlas.cellSize, 'flowFieldAtlas.cellSize'),
        directions,
        stages: Object.freeze(stages)
    });
}

function createBuffer(device, label, size, usage) {
    return device.createBuffer({ label, size, usage });
}

function writeRenderStyle(view, index, body) {
    const offset = index * BODY_RENDER_STYLE_STRIDE;
    const sourceColor = body.renderStyle?.color ?? body.color ?? [1, 0.24, 0.18, 1];
    const components = Array.isArray(sourceColor) || ArrayBuffer.isView(sourceColor)
        ? sourceColor
        : [sourceColor.r, sourceColor.g, sourceColor.b, sourceColor.a];
    for (let component = 0; component < 4; component++) {
        const fallback = component === 3 ? 1 : 0;
        const value = Math.min(1, normalizeNonNegativeFinite(components[component], fallback));
        view.setFloat32(offset + (component * FLOAT32_BYTES), value, LITTLE_ENDIAN);
    }
    const radiusScale = requirePositiveFinite(
        body.renderStyle?.radiusScale ?? body.radiusScale ?? 1,
        'renderStyle.radiusScale'
    );
    view.setFloat32(offset + 16, radiusScale, LITTLE_ENDIAN);
    view.setUint32(
        offset + 20,
        body.renderStyle?.visible === false || body.visible === false ? 0 : 1,
        LITTLE_ENDIAN
    );
    view.setUint32(offset + 24, 0, LITTLE_ENDIAN);
    view.setUint32(offset + 28, 0, LITTLE_ENDIAN);
}

const TOMBSTONE_BODY = Object.freeze({
    position: Object.freeze({ x: 0, y: 0 }),
    velocity: Object.freeze({ x: 0, y: 0 }),
    radius: 0,
    inverseMass: 0,
    layerMask: 0,
    collisionMask: 0,
    alive: false,
    visible: false
});

function normalizeEntityHandle(source, label, required = true) {
    const entityIdValue = source?.entityId ?? source?.handle?.entityId;
    const incarnationValue = source?.incarnation ?? source?.handle?.incarnation;
    const hasEntityId = entityIdValue !== undefined && entityIdValue !== null;
    const hasIncarnation = incarnationValue !== undefined && incarnationValue !== null;
    if (!hasEntityId && !hasIncarnation && !required) {
        return null;
    }
    if (!hasEntityId || !hasIncarnation) {
        throw new TypeError(`${label}에는 entityId와 incarnation이 모두 필요합니다.`);
    }
    const entityId = Number(entityIdValue);
    const incarnation = Number(incarnationValue);
    if (!Number.isSafeInteger(entityId) || entityId < 0 || entityId >= UINT32_MAX) {
        throw new RangeError(`${label}.entityId는 reserved sentinel 미만의 uint32 정수여야 합니다.`);
    }
    if (!Number.isSafeInteger(incarnation) || incarnation < 0 || incarnation >= UINT32_MAX) {
        throw new RangeError(`${label}.incarnation은 reserved sentinel 미만의 uint32 정수여야 합니다.`);
    }
    return Object.freeze({ entityId: entityId >>> 0, incarnation: incarnation >>> 0 });
}

function entityHandleKey(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

function copyBodySlot(sourceStorage, sourceIndex, targetStorage, targetIndex) {
    for (const [bufferName, stride] of [
        ['physicsBuffer', GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE],
        ['simulationBuffer', GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE],
        ['temporaryBuffer', GPU_CIRCLE_BODY_ABI.TEMPORARY.STRIDE]
    ]) {
        new Uint8Array(targetStorage[bufferName], targetIndex * stride, stride).set(
            new Uint8Array(sourceStorage[bufferName], sourceIndex * stride, stride)
        );
    }
}

function copyRenderStyleSlot(source, sourceIndex, target, targetIndex) {
    new Uint8Array(target, targetIndex * BODY_RENDER_STYLE_STRIDE, BODY_RENDER_STYLE_STRIDE).set(
        new Uint8Array(source, sourceIndex * BODY_RENDER_STYLE_STRIDE, BODY_RENDER_STYLE_STRIDE)
    );
}

/**
 * @class GpuCircleBodySimulation
 * @description 원본 GPU circle flow/solver pass와 stable-slot indirect presentation을 소유합니다.
 */
export class GpuCircleBodySimulation {
    /**
     * @param {object} webGpuPlatformPort - DisplaySystem이 소유한 WebGPU 플랫폼 port입니다.
     * @param {object} options - session 고정 설정입니다.
     */
    constructor(webGpuPlatformPort, options = {}) {
        this.platform = requirePlatformPort(webGpuPlatformPort);
        this.capacity = requirePositiveInteger(options.capacity ?? 16384, 'capacity');
        this.worldSize = normalizeSize2(options.worldSize, 'worldSize');
        this.gridCellSize = normalizeSize2(options.gridCellSize ?? 1, 'gridCellSize');
        this.maxBodiesPerCell = requirePositiveInteger(
            options.maxBodiesPerCell ?? SOURCE_MAX_BODIES_PER_CELL,
            'maxBodiesPerCell'
        );
        if (this.maxBodiesPerCell !== SOURCE_MAX_BODIES_PER_CELL) {
            throw new RangeError(
                `원본 GPU grid bucket capacity는 ${SOURCE_MAX_BODIES_PER_CELL}로 고정됩니다.`
            );
        }
        this.solverIterations = requirePositiveInteger(
            options.solverIterations ?? SOURCE_SOLVER_ITERATIONS,
            'solverIterations'
        );
        this.velocityDamping = normalizeNonNegativeFinite(options.velocityDamping, 0);
        this.maxSpeed = normalizeNonNegativeFinite(options.maxSpeed, 0);
        this.sdf = normalizeSignedDistanceField(options.sdf);
        this.flowFieldAtlas = normalizeFlowFieldAtlas(options.flowFieldAtlas);
        const inferredSourceWorldUnitScale = this.sdf.enabled
            ? Math.min(
                this.worldSize.x / this.sdf.cols,
                this.worldSize.y / this.sdf.rows
            ) / SOURCE_SDF_CELL_WORLD_UNITS
            : Math.min(this.gridCellSize.x, this.gridCellSize.y)
                / SOURCE_GRID_CELL_WORLD_UNITS;
        this.sourceWorldUnitScale = requirePositiveFinite(
            options.sourceWorldUnitScale ?? inferredSourceWorldUnitScale,
            'sourceWorldUnitScale'
        );
        this.gridCellCount = Object.freeze({
            x: Math.ceil(this.worldSize.x / this.gridCellSize.x),
            y: Math.ceil(this.worldSize.y / this.gridCellSize.y)
        });
        this.gridCellTotal = this.gridCellCount.x * this.gridCellCount.y;
        this.gridEntryCapacity = this.gridCellTotal
            * GRID_BUCKET_COUNT
            * this.maxBodiesPerCell;
        this.presentationClock = new GpuBodyPresentationClock({
            profile: options.presentationProfile
                ?? GPU_BODY_PRESENTATION_PROFILE.REFERENCE_CLOCK_EXTRAPOLATION
        });
        this.hostStorage = createGpuCircleBodyAbiStorage(this.capacity);
        this.hostRenderStyles = new ArrayBuffer(BODY_RENDER_STYLE_STRIDE * this.capacity);
        writeGpuCircleBodyCounts(this.hostStorage, { bodyCount: 0 });
        this.bodyCount = 0;
        this.activeBodyCount = 0;
        this.slotActive = new Uint8Array(this.capacity);
        this.slotHandles = new Array(this.capacity).fill(null);
        this.handleToSlot = new Map();
        this.freeSlots = [];
        this.device = null;
        this.deviceGeneration = -1;
        this.canvasFormat = null;
        this.buffers = null;
        this.flowTexture = null;
        this.bindGroups = null;
        this.pipelines = null;
        this.state = 'idle';
        this.failure = null;
        this.destroyed = false;
        this.submittedTickCount = 0;
        this.hasGpuAuthoritativeState = false;
        this.authoritativeEpoch = 0;
        this.requiresAuthoritativeRebuild = false;
        this.overflowReadbackSlots = [];
        this.overflowReadbackLease = 0;
        this.overflowReadbackCursor = 0;
        this.pendingOverflowReadbacks = 0;
        this.lastOverflowTick = 0;
        this.lastSmallOverflowCount = 0;
        this.lastBigOverflowCount = 0;
        this.totalSmallOverflowCount = 0;
        this.totalBigOverflowCount = 0;
        this.telemetryBackpressureCount = 0;
        this.lastOverflowSampleSubmittedTick = 0;
        this.lastOverflowSampleCompletedTick = 0;
        this.overflowSampleOverdue = false;
        this.canvasHasDrawnBodies = false;
        this.lastFixedDelta = 1 / 60;
        this.renderOriginScratch = { x: 0, y: 0 };
        this.shaderStateScratch = {};
        this.presentationFrameScratch = {
            frameDelta: 0,
            fixedDelta: this.lastFixedDelta,
            fixedAlpha: 0,
            renderFrameId: undefined
        };
        this.computeParamsBytes = new ArrayBuffer(COMPUTE_PARAMS_BYTE_SIZE);
        this.computeParamsView = new DataView(this.computeParamsBytes);
        this.renderParamsBytes = new ArrayBuffer(RENDER_PARAMS_BYTE_SIZE);
        this.renderParamsView = new DataView(this.renderParamsBytes);
        this.dispatchIndirectArgs = new Uint32Array(3);
        this.drawIndirectArgs = new Uint32Array(4);
        this.overflowResetData = new Uint32Array(4);
        this.uploadedComputeFixedDelta = NaN;
    }

    /**
     * 현재 Display device generation에 GPU 자원을 생성합니다. 미지원은 non-fatal false입니다.
     * @returns {boolean} 사용 가능한 GPU backend인지 여부입니다.
     */
    init() {
        if (this.destroyed
            || this.requiresAuthoritativeRebuild
            || this.state === 'overflow-degraded') {
            return false;
        }
        const device = this.platform.getDevice();
        const generation = Number(this.platform.getDeviceGeneration());
        const format = this.platform.getCanvasFormat();
        if (!device || !Number.isSafeInteger(generation) || generation < 0 || !format) {
            this.state = 'unavailable';
            return false;
        }
        if (this.device === device
            && this.deviceGeneration === generation
            && (this.state === 'ready' || this.state === 'telemetry-backpressure')) {
            return true;
        }

        if (this.device
            && (this.device !== device || this.deviceGeneration !== generation)
            && this.hasGpuAuthoritativeState
            && this.bodyCount > 0) {
            this.requiresAuthoritativeRebuild = true;
            this.failure = Object.freeze({
                stage: 'device-generation-change',
                name: 'AuthoritativeStateLost',
                message: 'GPU authoritative body 상태를 새 device에서 자동 재생할 수 없습니다.'
            });
            this.state = 'requires-rebuild';
            this.#releaseGpuResources();
            return false;
        }

        this.#releaseGpuResources();
        this.device = device;
        this.deviceGeneration = generation;
        this.canvasFormat = format;
        try {
            this.#validateDeviceLimits(device);
            this.#createGpuResources(device, format);
            this.#uploadHostState();
            this.state = 'ready';
            this.failure = null;
            return true;
        } catch (error) {
            this.failure = captureFailure('initialization', error);
            this.state = 'failed';
            this.#releaseGpuResources();
            return false;
        }
    }

    /**
     * 진입/authoritative rebuild 전용으로 dense body set을 원자적으로 교체합니다.
     * live spawn에는 사용하지 않으며 capacity 초과는 기존 상태를 보존하고 전부 거부합니다.
     * @param {object[]} bodies - collision body spawn 목록입니다.
     * @returns {{accepted:number,rejected:number,capacity:number}} 반영 결과입니다.
     */
    replaceBodies(bodies) {
        if (!Array.isArray(bodies)) {
            throw new TypeError('GPU circle body 목록은 배열이어야 합니다.');
        }
        if (bodies.length > this.capacity) {
            return Object.freeze({
                accepted: 0,
                rejected: bodies.length,
                capacity: this.capacity
            });
        }

        const nextStorage = createGpuCircleBodyAbiStorage(this.capacity);
        const nextStyles = new ArrayBuffer(BODY_RENDER_STYLE_STRIDE * this.capacity);
        const styleView = new DataView(nextStyles);
        const nextSlotHandles = new Array(this.capacity).fill(null);
        const nextHandleToSlot = new Map();
        for (let index = 0; index < bodies.length; index++) {
            const body = bodies[index];
            this.#validateBody(body, index);
            const handle = normalizeEntityHandle(body, `body[${index}]`, false);
            if (handle) {
                const key = entityHandleKey(handle);
                if (nextHandleToSlot.has(key)) {
                    throw new RangeError(`중복 enemy handle입니다: ${key}`);
                }
                nextSlotHandles[index] = handle;
                nextHandleToSlot.set(key, index);
            }
            writeGpuCircleBodySpawn(nextStorage, index, body);
            writeRenderStyle(styleView, index, body);
        }
        writeGpuCircleBodyCounts(nextStorage, { bodyCount: bodies.length });

        if (bodies.length > 0 && !this.requiresAuthoritativeRebuild) {
            if (!this.#ensureReady() && !this.requiresAuthoritativeRebuild) {
                return Object.freeze({
                    accepted: 0,
                    rejected: bodies.length,
                    capacity: this.capacity,
                    reason: this.state
                });
            }
        }

        const replacingSubmittedState = this.submittedTickCount > 0
            || this.pendingOverflowReadbacks > 0
            || this.requiresAuthoritativeRebuild;
        this.hostStorage = nextStorage;
        this.hostRenderStyles = nextStyles;
        this.bodyCount = bodies.length;
        this.activeBodyCount = bodies.length;
        this.slotActive.fill(0);
        this.slotActive.fill(1, 0, bodies.length);
        this.slotHandles = nextSlotHandles;
        this.handleToSlot = nextHandleToSlot;
        this.freeSlots.length = 0;
        this.submittedTickCount = 0;
        this.hasGpuAuthoritativeState = false;
        this.authoritativeEpoch++;
        this.requiresAuthoritativeRebuild = false;
        this.#resetOverflowTelemetry();
        if (replacingSubmittedState && this.device) {
            this.#releaseGpuResources();
        }
        if (this.state === 'requires-rebuild'
            || this.state === 'overflow-degraded'
            || this.state === 'telemetry-backpressure'
            || replacingSubmittedState) {
            this.state = 'idle';
        }

        if (bodies.length === 0) {
            if (this.state === 'ready') {
                this.#uploadHostState();
            }
        } else if (this.#ensureReady()) {
            this.#uploadHostState();
        } else {
            this.bodyCount = 0;
            this.activeBodyCount = 0;
            this.slotActive.fill(0);
            this.slotHandles.fill(null);
            this.handleToSlot.clear();
            this.freeSlots.length = 0;
            writeGpuCircleBodyCounts(this.hostStorage, { bodyCount: 0 });
            return Object.freeze({
                accepted: 0,
                rejected: bodies.length,
                capacity: this.capacity,
                reason: this.state
            });
        }
        return Object.freeze({
            accepted: bodies.length,
            rejected: 0,
            capacity: this.capacity
        });
    }

    /**
     * GPU가 소유한 기존 body 위치를 건드리지 않고 빈 stable slot에 새 body를 추가합니다.
     * 상위 lifecycle owner가 다음 fixed-step command commit 경계에서만 호출해야 합니다.
     * @param {object[]} bodies - entityId/incarnation을 포함한 spawn batch입니다.
     * @returns {{accepted:number,rejected:number,capacity:number,handles?:object[],reason?:string}}
     * 반영 결과입니다.
     */
    spawnBodies(bodies) {
        if (!Array.isArray(bodies)) {
            throw new TypeError('GPU circle spawn batch는 배열이어야 합니다.');
        }
        if (bodies.length === 0) {
            return Object.freeze({ accepted: 0, rejected: 0, capacity: this.capacity });
        }
        if (bodies.length > this.capacity - this.activeBodyCount) {
            return Object.freeze({
                accepted: 0,
                rejected: bodies.length,
                capacity: this.capacity,
                reason: 'capacity'
            });
        }

        const stagingStorage = createGpuCircleBodyAbiStorage(bodies.length);
        const stagingStyles = new ArrayBuffer(BODY_RENDER_STYLE_STRIDE * bodies.length);
        const stagingStyleView = new DataView(stagingStyles);
        const handles = new Array(bodies.length);
        const batchKeys = new Set();
        const startsNewAuthoritativeEpoch = this.activeBodyCount === 0;
        for (let index = 0; index < bodies.length; index++) {
            const body = bodies[index];
            this.#validateBody(body, index);
            const handle = normalizeEntityHandle(body, `spawn[${index}]`);
            const key = entityHandleKey(handle);
            if (batchKeys.has(key) || this.handleToSlot.has(key)) {
                throw new RangeError(`이미 활성 상태인 enemy handle입니다: ${key}`);
            }
            batchKeys.add(key);
            handles[index] = handle;
            writeGpuCircleBodySpawn(stagingStorage, index, body);
            writeRenderStyle(stagingStyleView, index, body);
        }

        if (!this.#ensureReady()) {
            return Object.freeze({
                accepted: 0,
                rejected: bodies.length,
                capacity: this.capacity,
                reason: this.state
            });
        }

        const reusedCount = Math.min(this.freeSlots.length, bodies.length);
        const selectedSlots = new Array(bodies.length);
        for (let index = 0; index < reusedCount; index++) {
            selectedSlots[index] = this.freeSlots[this.freeSlots.length - 1 - index];
        }
        for (let index = reusedCount; index < bodies.length; index++) {
            selectedSlots[index] = this.bodyCount + (index - reusedCount);
        }

        for (let index = 0; index < bodies.length; index++) {
            const slot = selectedSlots[index];
            copyBodySlot(stagingStorage, index, this.hostStorage, slot);
            copyRenderStyleSlot(stagingStyles, index, this.hostRenderStyles, slot);
            this.slotActive[slot] = 1;
            this.slotHandles[slot] = handles[index];
            this.handleToSlot.set(entityHandleKey(handles[index]), slot);
        }
        this.freeSlots.length -= reusedCount;
        this.bodyCount += bodies.length - reusedCount;
        this.activeBodyCount += bodies.length;
        if (startsNewAuthoritativeEpoch) {
            this.authoritativeEpoch++;
        }
        writeGpuCircleBodyCounts(this.hostStorage, { bodyCount: this.bodyCount });

        try {
            this.#uploadSlotRanges(selectedSlots);
            this.#uploadBodyCountState();
        } catch (error) {
            this.requiresAuthoritativeRebuild = true;
            this.failure = captureFailure('spawn-upload', error);
            this.state = 'requires-rebuild';
            return Object.freeze({
                accepted: bodies.length,
                rejected: 0,
                capacity: this.capacity,
                reason: this.state,
                requiresRecovery: true,
                handles: Object.freeze(handles)
            });
        }
        return Object.freeze({
            accepted: bodies.length,
            rejected: 0,
            capacity: this.capacity,
            handles: Object.freeze(handles)
        });
    }

    /**
     * stable handle을 tombstone으로 바꾸고 slot을 재사용 목록에 돌려놓습니다.
     * 상위 lifecycle owner가 다음 fixed-step command commit 경계에서만 호출해야 합니다.
     * @param {object[]} handles - entityId/incarnation handle batch입니다.
     * @returns {{removed:number,rejected:number,capacity:number,reason?:string}} 반영 결과입니다.
     */
    despawnBodies(handles) {
        if (!Array.isArray(handles)) {
            throw new TypeError('GPU circle despawn batch는 배열이어야 합니다.');
        }
        if (handles.length === 0) {
            return Object.freeze({ removed: 0, rejected: 0, capacity: this.capacity });
        }

        const batchKeys = new Set();
        const selectedSlots = [];
        const selectedKeys = [];
        let rejected = 0;
        for (let index = 0; index < handles.length; index++) {
            const handle = normalizeEntityHandle(handles[index], `despawn[${index}]`);
            const key = entityHandleKey(handle);
            if (batchKeys.has(key)) {
                throw new RangeError(`despawn batch에 중복 handle이 있습니다: ${key}`);
            }
            batchKeys.add(key);
            const slot = this.handleToSlot.get(key);
            if (slot === undefined) {
                rejected++;
                continue;
            }
            selectedSlots.push(slot);
            selectedKeys.push(key);
        }
        if (selectedSlots.length === 0) {
            return Object.freeze({
                removed: 0,
                rejected,
                capacity: this.capacity,
                reason: 'stale-handle'
            });
        }
        if (!this.#ensureReady()) {
            return Object.freeze({
                removed: 0,
                rejected: handles.length,
                capacity: this.capacity,
                reason: this.state
            });
        }

        const stagingStorage = createGpuCircleBodyAbiStorage(selectedSlots.length);
        const stagingStyles = new ArrayBuffer(
            BODY_RENDER_STYLE_STRIDE * selectedSlots.length
        );
        const stagingStyleView = new DataView(stagingStyles);
        for (let index = 0; index < selectedSlots.length; index++) {
            writeGpuCircleBodySpawn(stagingStorage, index, TOMBSTONE_BODY);
            writeRenderStyle(stagingStyleView, index, TOMBSTONE_BODY);
        }
        for (let index = 0; index < selectedSlots.length; index++) {
            const slot = selectedSlots[index];
            copyBodySlot(stagingStorage, index, this.hostStorage, slot);
            copyRenderStyleSlot(stagingStyles, index, this.hostRenderStyles, slot);
            this.slotActive[slot] = 0;
            this.slotHandles[slot] = null;
            this.handleToSlot.delete(selectedKeys[index]);
            this.freeSlots.push(slot);
        }
        this.activeBodyCount -= selectedSlots.length;
        if (this.activeBodyCount === 0) {
            this.hasGpuAuthoritativeState = false;
            this.authoritativeEpoch++;
        }
        while (this.bodyCount > 0 && this.slotActive[this.bodyCount - 1] === 0) {
            this.bodyCount--;
        }
        if (this.freeSlots.length > 0) {
            this.freeSlots = this.freeSlots.filter((slot) => slot < this.bodyCount);
        }
        writeGpuCircleBodyCounts(this.hostStorage, { bodyCount: this.bodyCount });

        try {
            this.#uploadSlotRanges(selectedSlots);
            this.#uploadBodyCountState();
        } catch (error) {
            this.requiresAuthoritativeRebuild = true;
            this.failure = captureFailure('despawn-upload', error);
            this.state = 'requires-rebuild';
            return Object.freeze({
                removed: selectedSlots.length,
                rejected,
                capacity: this.capacity,
                reason: this.state,
                requiresRecovery: true
            });
        }
        return Object.freeze({
            removed: selectedSlots.length,
            rejected,
            capacity: this.capacity
        });
    }

    /** @param {object} handle - entityId/incarnation handle입니다. */
    hasBody(handle) {
        const normalized = normalizeEntityHandle(handle, 'handle');
        return this.handleToSlot.has(entityHandleKey(normalized));
    }

    /**
     * 원본 순서의 collision-only fixed tick을 GPU에 제출합니다.
     * @param {number} fixedDelta - 초 단위 fixed delta입니다.
     * @returns {boolean} command 제출 여부입니다.
     */
    fixedUpdate(fixedDelta) {
        const delta = requirePositiveFinite(fixedDelta, 'fixedDelta');
        this.lastFixedDelta = delta;
        if (this.activeBodyCount === 0) {
            return false;
        }
        if (this.state === 'telemetry-backpressure') {
            if (!this.#hasFreeOverflowReadbackSlot()) {
                return false;
            }
            this.state = 'ready';
            this.failure = null;
        }
        if (!this.#ensureReady()) {
            return false;
        }
        const tick = this.submittedTickCount + 1;
        const shouldSampleOverflow = this.overflowSampleOverdue
            || tick === 1
            || (tick - this.lastOverflowSampleSubmittedTick)
                >= OVERFLOW_READBACK_INTERVAL_TICKS;
        const overflowSlot = shouldSampleOverflow
            ? this.#claimOverflowReadbackSlot()
            : null;
        if (shouldSampleOverflow && !overflowSlot) {
            this.telemetryBackpressureCount++;
            this.overflowSampleOverdue = true;
            if ((tick - this.lastOverflowSampleCompletedTick)
                >= OVERFLOW_TELEMETRY_MAX_AGE_TICKS) {
                this.state = 'telemetry-backpressure';
                this.failure = Object.freeze({
                    stage: 'overflow-readback-backpressure',
                    name: 'TelemetryBackpressure',
                    message: 'GPU grid overflow telemetry가 안전 age 한계를 넘었습니다.'
                });
                return false;
            }
        }

        this.#writeComputeParams(delta);
        const device = this.device;
        const encoder = device.createCommandEncoder({
            label: 'cirvivor-gpu-circle-fixed-step'
        });

        const pass = encoder.beginComputePass({
            label: 'cirvivor-gpu-circle-collision'
        });
        pass.setBindGroup(0, this.bindGroups.computeBodies);
        pass.setBindGroup(1, this.bindGroups.computeWorld);
        pass.setBindGroup(2, this.bindGroups.computeParams);

        this.#dispatchBodies(pass, 'prepare_bodies');
        pass.setPipeline(this.pipelines.compute.clear_grid);
        pass.dispatchWorkgroups(Math.ceil(
            (this.gridCellTotal * GRID_BUCKET_COUNT) / BODY_WORKGROUP_SIZE
        ));
        this.#dispatchBodies(pass, 'build_grid');

        for (let iteration = 0; iteration < this.solverIterations; iteration++) {
            this.#dispatchBodies(pass, 'clear_position_deltas');
            pass.setPipeline(this.pipelines.compute.solve_body_body);
            pass.dispatchWorkgroups(this.gridCellTotal);
            this.#dispatchBodies(pass, 'solve_body_world');
            this.#dispatchBodies(pass, 'apply_position_deltas');
        }
        this.#dispatchBodies(pass, 'rebuild_velocities');
        this.#dispatchBodies(pass, 'finalize_velocities');
        pass.end();

        if (overflowSlot) {
            encoder.copyBufferToBuffer(
                this.buffers.gridOverflow,
                0,
                overflowSlot.buffer,
                0,
                GRID_OVERFLOW_BYTE_SIZE
            );
        }
        const generation = this.deviceGeneration;
        const lease = this.overflowReadbackLease;
        try {
            device.queue.submit([encoder.finish()]);
        } catch (error) {
            this.#releaseClaimedOverflowReadbackSlot(overflowSlot);
            this.failure = captureFailure('fixed-submit', error);
            this.requiresAuthoritativeRebuild = this.hasGpuAuthoritativeState
                && this.activeBodyCount > 0;
            if (this.requiresAuthoritativeRebuild) {
                this.presentationClock.synchronize();
                this.state = 'requires-rebuild';
                this.#releaseGpuResources();
            } else {
                this.state = 'failed';
            }
            return false;
        }
        this.submittedTickCount = tick;
        this.hasGpuAuthoritativeState = true;
        this.presentationClock.advancePhysics(delta);
        if (overflowSlot) {
            this.lastOverflowSampleSubmittedTick = tick;
            this.overflowSampleOverdue = false;
            this.#beginOverflowReadback(
                overflowSlot,
                tick,
                generation,
                lease,
                this.authoritativeEpoch
            );
        }
        return true;
    }

    /**
     * 물리와 독립적인 presentation clock만 진행합니다.
     * @param {{frameDelta?:number,fixedDelta?:number,fixedAlpha?:number,renderFrameId?:number}} frame - 렌더 프레임 값입니다.
     * @returns {object} 셰이더 표현 상태입니다.
     */
    updatePresentation(frame = {}) {
        const scratch = this.presentationFrameScratch;
        scratch.frameDelta = frame.frameDelta;
        scratch.fixedDelta = frame.fixedDelta ?? this.lastFixedDelta;
        scratch.fixedAlpha = frame.fixedAlpha;
        scratch.renderFrameId = frame.renderFrameId;
        if (Number(frame.frameDelta) === 0 || this.requiresAuthoritativeRebuild) {
            this.presentationClock.synchronize(frame.renderFrameId);
        }
        return this.presentationClock.advanceRender(scratch);
    }

    /**
     * pause/resume/teleport 경계에서 남아 있는 render prediction age를 제거합니다.
     * @param {number} [renderFrameId] - 선택적인 렌더 프레임 식별자입니다.
     * @returns {void}
     */
    synchronizePresentation(renderFrameId) {
        return this.presentationClock.synchronize(renderFrameId);
    }

    /**
     * WebGPU 투명 surface에 모든 body를 한 번의 indirect draw로 그립니다.
     * @param {object} camera - WorldCamera2D compatible projection입니다.
     * @returns {boolean} draw 또는 clear 제출 여부입니다.
     */
    draw(camera) {
        if (this.requiresAuthoritativeRebuild && this.state !== 'overflow-degraded') {
            if (!this.canvasHasDrawnBodies) {
                return false;
            }
            const cleared = this.platform.clearCanvas({ r: 0, g: 0, b: 0, a: 0 });
            if (cleared) {
                this.canvasHasDrawnBodies = false;
            }
            return cleared;
        }
        if (this.activeBodyCount === 0) {
            if (!this.canvasHasDrawnBodies) {
                return false;
            }
            const cleared = this.platform.clearCanvas({ r: 0, g: 0, b: 0, a: 0 });
            if (cleared) {
                this.canvasHasDrawnBodies = false;
            }
            return cleared;
        }
        if (!(this.state === 'overflow-degraded' && this.#hasCurrentGpuResources())
            && !this.#ensureReady()) {
            return false;
        }
        if (!camera
            || typeof camera.worldToViewport !== 'function'
            || typeof camera.getScale !== 'function') {
            throw new TypeError('GPU circle body draw에는 WorldCamera2D projection이 필요합니다.');
        }

        let target = this.platform.acquireFrameTarget();
        if (!target) {
            return false;
        }
        if (target.device !== this.device
            || target.deviceGeneration !== this.deviceGeneration
            || target.format !== this.canvasFormat) {
            if (!this.init()) {
                return false;
            }
            target = this.platform.acquireFrameTarget();
            if (!target || target.device !== this.device) {
                return false;
            }
        }

        camera.worldToViewport(0, 0, this.renderOriginScratch);
        this.#writeRenderParams(camera, target);
        const encoder = this.device.createCommandEncoder({
            label: 'cirvivor-gpu-circle-render'
        });
        const pass = encoder.beginRenderPass({
            label: 'cirvivor-gpu-circle-render-pass',
            colorAttachments: [{
                view: target.view,
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                loadOp: 'clear',
                storeOp: 'store'
            }]
        });
        pass.setPipeline(this.pipelines.render);
        pass.setBindGroup(0, this.bindGroups.renderBodies);
        pass.setBindGroup(1, this.bindGroups.renderParams);
        pass.drawIndirect(this.buffers.drawIndirect, 0);
        pass.end();
        this.device.queue.submit([encoder.finish()]);
        this.platform.markCanvasDrawn();
        this.canvasHasDrawnBodies = true;
        return true;
    }

    /**
     * 명시적 테스트·진단 시점에만 전체 body를 readback합니다. 프레임 경로에서는 호출하지 않습니다.
     * @returns {Promise<object[]>} unpack된 body snapshot입니다.
     */
    async readbackBodies() {
        if (this.activeBodyCount === 0) {
            return [];
        }
        if (!(this.state === 'overflow-degraded' && this.#hasCurrentGpuResources())
            && !this.#ensureReady()) {
            return [];
        }
        const bodyCount = this.bodyCount;
        const usage = globalThis.GPUBufferUsage;
        const mapMode = globalThis.GPUMapMode;
        if (!usage || !mapMode) {
            throw new Error('WebGPU readback 상수가 없습니다.');
        }
        const planes = [
            ['physicsBuffer', 'physics', GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE],
            ['simulationBuffer', 'simulation', GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE],
            ['temporaryBuffer', 'temporary', GPU_CIRCLE_BODY_ABI.TEMPORARY.STRIDE]
        ].map(([hostKey, gpuKey, stride]) => ({
            hostKey,
            gpuKey,
            byteSize: stride * bodyCount,
            buffer: createBuffer(
                this.device,
                `cirvivor-gpu-circle-readback-${gpuKey}`,
                stride * bodyCount,
                usage.COPY_DST | usage.MAP_READ
            )
        }));
        try {
            const encoder = this.device.createCommandEncoder({
                label: 'cirvivor-gpu-circle-readback'
            });
            for (const plane of planes) {
                encoder.copyBufferToBuffer(
                    this.buffers[plane.gpuKey],
                    0,
                    plane.buffer,
                    0,
                    plane.byteSize
                );
            }
            this.device.queue.submit([encoder.finish()]);
            await Promise.all(planes.map((plane) => plane.buffer.mapAsync(mapMode.READ)));
            const storage = createGpuCircleBodyAbiStorage(this.capacity);
            writeGpuCircleBodyCounts(storage, { bodyCount });
            for (const plane of planes) {
                new Uint8Array(storage[plane.hostKey], 0, plane.byteSize).set(
                    new Uint8Array(plane.buffer.getMappedRange())
                );
                plane.buffer.unmap();
            }
            const result = [];
            for (let index = 0; index < bodyCount; index++) {
                const body = readGpuCircleBody(storage, index);
                if ((body.simulationMeta & GPU_CIRCLE_BODY_META.ALIVE_BIT) === 0) {
                    continue;
                }
                const hasIdentity = body.entityId !== GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT
                    && body.incarnation !== GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT;
                result.push({
                    ...body,
                    handle: hasIdentity
                        ? Object.freeze({
                            entityId: body.entityId,
                            incarnation: body.incarnation
                        })
                        : null
                });
            }
            return result;
        } finally {
            for (const plane of planes) {
                try {
                    plane.buffer.unmap();
                } catch {
                    // already unmapped
                }
                plane.buffer.destroy();
            }
        }
    }

    /** @returns {object} backend 진단 snapshot입니다. */
    getStatus() {
        return Object.freeze({
            state: this.state,
            failure: this.failure,
            capacity: this.capacity,
            bodyCount: this.bodyCount,
            activeBodyCount: this.activeBodyCount,
            freeSlotCount: this.freeSlots.length,
            deviceGeneration: this.deviceGeneration,
            gridCellCount: this.gridCellCount,
            maxBodiesPerCell: this.maxBodiesPerCell,
            solverIterations: this.solverIterations,
            sdfEnabled: this.sdf.enabled,
            flowFieldEnabled: this.flowFieldAtlas.enabled,
            flowFieldCount: this.flowFieldAtlas.fieldCount,
            sourceWorldUnitScale: this.sourceWorldUnitScale,
            submittedTickCount: this.submittedTickCount,
            hasGpuAuthoritativeState: this.hasGpuAuthoritativeState,
            authoritativeEpoch: this.authoritativeEpoch,
            requiresAuthoritativeRebuild: this.requiresAuthoritativeRebuild,
            overflow: Object.freeze({
                pendingReadbacks: this.pendingOverflowReadbacks,
                lastTick: this.lastOverflowTick,
                lastSmallCount: this.lastSmallOverflowCount,
                lastBigCount: this.lastBigOverflowCount,
                totalSmallCount: this.totalSmallOverflowCount,
                totalBigCount: this.totalBigOverflowCount,
                backpressureCount: this.telemetryBackpressureCount,
                sampleIntervalTicks: OVERFLOW_READBACK_INTERVAL_TICKS,
                lastSampleSubmittedTick: this.lastOverflowSampleSubmittedTick,
                lastSampleCompletedTick: this.lastOverflowSampleCompletedTick
            }),
            presentation: Object.freeze({ ...this.presentationClock.getClockState({}) })
        });
    }

    /** @returns {string} 할당 없는 runtime state입니다. */
    getRuntimeState() {
        return this.state;
    }

    /** @returns {number} 할당 없는 활성 body 수입니다. */
    getActiveBodyCount() {
        return this.activeBodyCount;
    }

    /**
     * GPU session 자원을 정리하고 투명 surface를 비웁니다. 반복 호출해도 안전합니다.
     * @returns {void}
     */
    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        try {
            if (this.canvasHasDrawnBodies) {
                this.platform.clearCanvas({ r: 0, g: 0, b: 0, a: 0 });
            }
        } catch {
            // device loss 중 clear 실패는 platform generation 복구가 담당합니다.
        }
        this.#releaseGpuResources();
        this.activeBodyCount = 0;
        this.hasGpuAuthoritativeState = false;
        this.slotActive.fill(0);
        this.slotHandles.fill(null);
        this.handleToSlot.clear();
        this.freeSlots.length = 0;
        this.canvasHasDrawnBodies = false;
        this.state = 'destroyed';
    }

    #validateBody(body, index) {
        if (!body || typeof body !== 'object') {
            throw new TypeError(`GPU circle body가 객체가 아닙니다: index=${index}`);
        }
        if (body.alive === false) {
            throw new RangeError(`활성 body spawn에는 alive=false를 사용할 수 없습니다: index=${index}`);
        }
        const radius = Number(body.radius);
        const inverseMass = Number(body.inverseMass ?? body.invMass);
        const usesFlow = body.useFlow === true
            || (body.flowFieldIndex !== undefined && body.flowFieldIndex !== null);
        if (usesFlow) {
            if (!this.flowFieldAtlas.enabled) {
                throw new RangeError(`flow body에는 flowFieldAtlas가 필요합니다: index=${index}`);
            }
            const flowFieldIndex = Number(body.flowFieldIndex);
            if (!Number.isInteger(flowFieldIndex)
                || flowFieldIndex < 0
                || flowFieldIndex >= this.flowFieldAtlas.fieldCount) {
                throw new RangeError(
                    `flowFieldIndex가 atlas 범위를 벗어났습니다: index=${index}`
                );
            }
        }
        if (Number.isFinite(inverseMass)
            && inverseMass > 0
            && inverseMass <= MASS_EPSILON) {
            throw new RangeError(
                `inverseMass는 0 또는 ${MASS_EPSILON}보다 커야 합니다: index=${index}`
            );
        }
        const maximumDynamicDiameter = Math.min(
            this.gridCellSize.x,
            this.gridCellSize.y
        );
        if (Number.isFinite(radius)
            && Number.isFinite(inverseMass)
            && inverseMass > MASS_EPSILON
            && radius * 2 > maximumDynamicDiameter) {
            throw new RangeError(
                `동적 body 지름은 3x3 grid 탐색의 cell 크기를 넘을 수 없습니다: index=${index}`
            );
        }
    }

    #uploadSlotRanges(slots) {
        const ordered = [...slots].sort((left, right) => left - right);
        let rangeStart = ordered[0];
        let rangeEnd = rangeStart;
        const uploadRange = (start, end) => {
            const count = end - start + 1;
            for (const [gpuKey, hostKey, stride] of [
                ['physics', 'physicsBuffer', GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE],
                ['simulation', 'simulationBuffer', GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE],
                ['temporary', 'temporaryBuffer', GPU_CIRCLE_BODY_ABI.TEMPORARY.STRIDE]
            ]) {
                this.device.queue.writeBuffer(
                    this.buffers[gpuKey],
                    start * stride,
                    this.hostStorage[hostKey],
                    start * stride,
                    count * stride
                );
            }
            this.device.queue.writeBuffer(
                this.buffers.renderStyles,
                start * BODY_RENDER_STYLE_STRIDE,
                this.hostRenderStyles,
                start * BODY_RENDER_STYLE_STRIDE,
                count * BODY_RENDER_STYLE_STRIDE
            );
        };
        for (let index = 1; index < ordered.length; index++) {
            const slot = ordered[index];
            if (slot === rangeEnd + 1) {
                rangeEnd = slot;
                continue;
            }
            uploadRange(rangeStart, rangeEnd);
            rangeStart = slot;
            rangeEnd = slot;
        }
        uploadRange(rangeStart, rangeEnd);
    }

    #uploadBodyCountState() {
        const queue = this.device.queue;
        queue.writeBuffer(this.buffers.counts, 0, this.hostStorage.countsBuffer);
        this.dispatchIndirectArgs[0] = Math.ceil(this.bodyCount / BODY_WORKGROUP_SIZE);
        this.dispatchIndirectArgs[1] = 1;
        this.dispatchIndirectArgs[2] = 1;
        queue.writeBuffer(this.buffers.dispatchIndirect, 0, this.dispatchIndirectArgs);
        this.drawIndirectArgs[0] = 6;
        this.drawIndirectArgs[1] = this.bodyCount;
        this.drawIndirectArgs[2] = 0;
        this.drawIndirectArgs[3] = 0;
        queue.writeBuffer(this.buffers.drawIndirect, 0, this.drawIndirectArgs);
    }

    #ensureReady() {
        if (this.destroyed
            || this.requiresAuthoritativeRebuild
            || this.state === 'overflow-degraded') {
            return false;
        }
        return (this.state === 'ready' || this.state === 'telemetry-backpressure')
            && this.#hasCurrentGpuResources()
            ? true
            : this.init();
    }

    #hasCurrentGpuResources() {
        return Boolean(
            this.device
            && this.buffers
            && this.flowTexture
            && this.bindGroups
            && this.pipelines
            && this.device === this.platform.getDevice()
            && this.deviceGeneration === this.platform.getDeviceGeneration()
        );
    }

    #hasFreeOverflowReadbackSlot() {
        return this.overflowReadbackSlots.some((slot) => !slot.inFlight);
    }

    #claimOverflowReadbackSlot() {
        const slotCount = this.overflowReadbackSlots.length;
        for (let offset = 0; offset < slotCount; offset++) {
            const index = (this.overflowReadbackCursor + offset) % slotCount;
            const slot = this.overflowReadbackSlots[index];
            if (slot.inFlight) {
                continue;
            }
            slot.inFlight = true;
            this.pendingOverflowReadbacks++;
            this.overflowReadbackCursor = (index + 1) % slotCount;
            return slot;
        }
        return null;
    }

    #releaseClaimedOverflowReadbackSlot(slot) {
        if (!slot?.inFlight) {
            return;
        }
        slot.inFlight = false;
        this.pendingOverflowReadbacks = Math.max(0, this.pendingOverflowReadbacks - 1);
    }

    #beginOverflowReadback(slot, tick, generation, lease, authoritativeEpoch) {
        slot.tick = tick;
        slot.generation = generation;
        slot.lease = lease;
        slot.buffer.mapAsync(this.mapReadMode).then(() => {
            let smallCount = 0;
            let bigCount = 0;
            let totalSmallCount = 0;
            let totalBigCount = 0;
            try {
                const view = new DataView(slot.buffer.getMappedRange());
                smallCount = view.getUint32(0, LITTLE_ENDIAN);
                bigCount = view.getUint32(4, LITTLE_ENDIAN);
                totalSmallCount = view.getUint32(8, LITTLE_ENDIAN);
                totalBigCount = view.getUint32(12, LITTLE_ENDIAN);
            } finally {
                slot.buffer.unmap();
            }
            if (this.destroyed
                || lease !== this.overflowReadbackLease
                || generation !== this.deviceGeneration
                || slot.lease !== lease) {
                slot.inFlight = false;
                return;
            }
            if (authoritativeEpoch !== this.authoritativeEpoch) {
                this.#releaseClaimedOverflowReadbackSlot(slot);
                return;
            }
            this.#releaseClaimedOverflowReadbackSlot(slot);
            this.lastOverflowSampleCompletedTick = Math.max(
                this.lastOverflowSampleCompletedTick,
                tick
            );
            if (tick >= this.lastOverflowTick) {
                this.lastOverflowTick = tick;
                this.lastSmallOverflowCount = smallCount;
                this.lastBigOverflowCount = bigCount;
            }
            this.totalSmallOverflowCount = Math.max(
                this.totalSmallOverflowCount,
                totalSmallCount
            );
            this.totalBigOverflowCount = Math.max(
                this.totalBigOverflowCount,
                totalBigCount
            );
            if (totalSmallCount === 0 && totalBigCount === 0) {
                return;
            }
            this.requiresAuthoritativeRebuild = true;
            this.state = 'overflow-degraded';
            this.presentationClock.synchronize();
            this.failure = Object.freeze({
                stage: 'grid-overflow',
                name: 'GridCapacityExceeded',
                message: `GPU grid overflow가 감지되었습니다: tick=${tick}, small=${smallCount}, big=${bigCount}, totalSmall=${totalSmallCount}, totalBig=${totalBigCount}`
            });
        }).catch((error) => {
            if (this.destroyed
                || lease !== this.overflowReadbackLease
                || generation !== this.deviceGeneration
                || slot.lease !== lease) {
                slot.inFlight = false;
                return;
            }
            if (authoritativeEpoch !== this.authoritativeEpoch) {
                this.#releaseClaimedOverflowReadbackSlot(slot);
                return;
            }
            this.#releaseClaimedOverflowReadbackSlot(slot);
            this.requiresAuthoritativeRebuild = this.bodyCount > 0;
            this.failure = captureFailure('overflow-readback', error);
            this.state = this.requiresAuthoritativeRebuild
                ? 'requires-rebuild'
                : 'failed';
        });
    }

    #resetOverflowTelemetry() {
        this.lastOverflowTick = 0;
        this.lastSmallOverflowCount = 0;
        this.lastBigOverflowCount = 0;
        this.totalSmallOverflowCount = 0;
        this.totalBigOverflowCount = 0;
        this.telemetryBackpressureCount = 0;
        this.lastOverflowSampleSubmittedTick = 0;
        this.lastOverflowSampleCompletedTick = 0;
        this.overflowSampleOverdue = false;
    }

    #validateDeviceLimits(device) {
        const gridBodyBytes = this.gridEntryCapacity * GPU_CIRCLE_BODY_ABI.GRID_BODY.STRIDE;
        const largestStorageBinding = Math.max(
            gridBodyBytes,
            this.capacity * GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE,
            this.sdf.values.byteLength
        );
        if (largestStorageBinding > Number(device.limits.maxStorageBufferBindingSize)
            || largestStorageBinding > Number(device.limits.maxBufferSize)) {
            throw new RangeError(
                `GPU circle buffer가 adapter limit를 초과합니다: ${largestStorageBinding}`
            );
        }
        if (this.gridCellTotal > Number(device.limits.maxComputeWorkgroupsPerDimension)) {
            throw new RangeError(
                `grid workgroup 수가 adapter limit를 초과합니다: ${this.gridCellTotal}`
            );
        }
        if (COMPUTE_PARAMS_BYTE_SIZE > Number(device.limits.maxUniformBufferBindingSize)) {
            throw new RangeError(
                `GPU flow-stage uniform이 adapter limit를 초과합니다: ${COMPUTE_PARAMS_BYTE_SIZE}`
            );
        }
        if (this.flowFieldAtlas.cols > Number(device.limits.maxTextureDimension2D)
            || this.flowFieldAtlas.rows > Number(device.limits.maxTextureDimension2D)
            || Math.max(1, this.flowFieldAtlas.fieldCount)
                > Number(device.limits.maxTextureArrayLayers)) {
            throw new RangeError('GPU flow-field atlas가 adapter texture limit를 초과합니다.');
        }
    }

    #createGpuResources(device, format) {
        const usage = globalThis.GPUBufferUsage;
        const textureUsage = globalThis.GPUTextureUsage;
        const stage = globalThis.GPUShaderStage;
        const mapMode = globalThis.GPUMapMode;
        if (!usage || !textureUsage || !stage || !mapMode) {
            throw new Error('WebGPU buffer/texture/shader 상수가 없습니다.');
        }
        this.mapReadMode = mapMode.READ;
        const storageUsage = usage.STORAGE | usage.COPY_DST | usage.COPY_SRC;
        this.buffers = {
            counts: createBuffer(
                device,
                'cirvivor-gpu-circle-counts',
                GPU_CIRCLE_BODY_ABI.COUNTS.STRIDE,
                storageUsage
            ),
            physics: createBuffer(
                device,
                'cirvivor-gpu-circle-physics',
                GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE * this.capacity,
                storageUsage
            ),
            simulation: createBuffer(
                device,
                'cirvivor-gpu-circle-simulation',
                GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE * this.capacity,
                storageUsage
            ),
            temporary: createBuffer(
                device,
                'cirvivor-gpu-circle-temporary',
                GPU_CIRCLE_BODY_ABI.TEMPORARY.STRIDE * this.capacity,
                storageUsage
            ),
            gridCounts: createBuffer(
                device,
                'cirvivor-gpu-circle-grid-counts',
                this.gridCellTotal * GRID_BUCKET_COUNT * Uint32Array.BYTES_PER_ELEMENT,
                storageUsage
            ),
            gridBodies: createBuffer(
                device,
                'cirvivor-gpu-circle-grid-bodies',
                this.gridEntryCapacity * GPU_CIRCLE_BODY_ABI.GRID_BODY.STRIDE,
                storageUsage
            ),
            sdf: createBuffer(
                device,
                'cirvivor-gpu-circle-sdf',
                this.sdf.values.byteLength,
                usage.STORAGE | usage.COPY_DST
            ),
            gridOverflow: createBuffer(
                device,
                'cirvivor-gpu-circle-grid-overflow',
                GRID_OVERFLOW_BYTE_SIZE,
                storageUsage
            ),
            computeParams: createBuffer(
                device,
                'cirvivor-gpu-circle-compute-params',
                COMPUTE_PARAMS_BYTE_SIZE,
                usage.UNIFORM | usage.COPY_DST
            ),
            renderStyles: createBuffer(
                device,
                'cirvivor-gpu-circle-render-styles',
                BODY_RENDER_STYLE_STRIDE * this.capacity,
                usage.STORAGE | usage.COPY_DST
            ),
            renderParams: createBuffer(
                device,
                'cirvivor-gpu-circle-render-params',
                RENDER_PARAMS_BYTE_SIZE,
                usage.UNIFORM | usage.COPY_DST
            ),
            dispatchIndirect: createBuffer(
                device,
                'cirvivor-gpu-circle-dispatch-indirect',
                DISPATCH_INDIRECT_BYTE_SIZE,
                usage.STORAGE | usage.INDIRECT | usage.COPY_DST
            ),
            drawIndirect: createBuffer(
                device,
                'cirvivor-gpu-circle-draw-indirect',
                DRAW_INDIRECT_BYTE_SIZE,
                usage.STORAGE | usage.INDIRECT | usage.COPY_DST
            )
        };
        this.flowTexture = device.createTexture({
            label: 'cirvivor-gpu-circle-route-flow-atlas',
            size: {
                width: this.flowFieldAtlas.cols,
                height: this.flowFieldAtlas.rows,
                depthOrArrayLayers: Math.max(1, this.flowFieldAtlas.fieldCount)
            },
            format: 'rg32float',
            usage: textureUsage.TEXTURE_BINDING | textureUsage.COPY_DST
        });
        const overflowLease = ++this.overflowReadbackLease;
        this.overflowReadbackSlots = Array.from(
            { length: OVERFLOW_READBACK_SLOT_COUNT },
            (_, index) => ({
                buffer: createBuffer(
                    device,
                    `cirvivor-gpu-circle-overflow-readback-${index}`,
                    GRID_OVERFLOW_BYTE_SIZE,
                    usage.COPY_DST | usage.MAP_READ
                ),
                inFlight: false,
                tick: 0,
                generation: this.deviceGeneration,
                lease: overflowLease
            })
        );
        this.overflowReadbackCursor = 0;
        this.pendingOverflowReadbacks = 0;

        const computeBodiesLayout = device.createBindGroupLayout({
            label: 'cirvivor-gpu-circle-compute-bodies-layout',
            entries: [0, 1, 2, 3].map((binding) => ({
                binding,
                visibility: stage.COMPUTE,
                buffer: { type: 'storage' }
            }))
        });
        const computeWorldLayout = device.createBindGroupLayout({
            label: 'cirvivor-gpu-circle-compute-world-layout',
            entries: [
                { binding: 0, visibility: stage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 1, visibility: stage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 2, visibility: stage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 3, visibility: stage.COMPUTE, buffer: { type: 'storage' } },
                {
                    binding: 4,
                    visibility: stage.COMPUTE,
                    texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' }
                }
            ]
        });
        const computeParamsLayout = device.createBindGroupLayout({
            label: 'cirvivor-gpu-circle-compute-params-layout',
            entries: [{
                binding: 0,
                visibility: stage.COMPUTE,
                buffer: { type: 'uniform' }
            }]
        });
        const indirectLayout = device.createBindGroupLayout({
            label: 'cirvivor-gpu-circle-indirect-layout',
            entries: [
                { binding: 0, visibility: stage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 1, visibility: stage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 2, visibility: stage.COMPUTE, buffer: { type: 'storage' } }
            ]
        });
        const renderBodiesLayout = device.createBindGroupLayout({
            label: 'cirvivor-gpu-circle-render-bodies-layout',
            entries: [0, 1, 2, 3].map((binding) => ({
                binding,
                visibility: stage.VERTEX,
                buffer: { type: 'read-only-storage' }
            }))
        });
        const renderParamsLayout = device.createBindGroupLayout({
            label: 'cirvivor-gpu-circle-render-params-layout',
            entries: [{
                binding: 0,
                visibility: stage.VERTEX,
                buffer: { type: 'uniform' }
            }]
        });
        const computePipelineLayout = device.createPipelineLayout({
            label: 'cirvivor-gpu-circle-compute-pipeline-layout',
            bindGroupLayouts: [computeBodiesLayout, computeWorldLayout, computeParamsLayout]
        });
        const indirectPipelineLayout = device.createPipelineLayout({
            label: 'cirvivor-gpu-circle-indirect-pipeline-layout',
            bindGroupLayouts: [indirectLayout]
        });
        const renderPipelineLayout = device.createPipelineLayout({
            label: 'cirvivor-gpu-circle-render-pipeline-layout',
            bindGroupLayouts: [renderBodiesLayout, renderParamsLayout]
        });

        const computeModule = device.createShaderModule({
            label: 'cirvivor-gpu-circle-compute-shader',
            code: GPU_COLLISION_COMPUTE_WGSL
        });
        const indirectModule = device.createShaderModule({
            label: 'cirvivor-gpu-circle-indirect-shader',
            code: GPU_COLLISION_INDIRECT_WGSL
        });
        const renderModule = device.createShaderModule({
            label: 'cirvivor-gpu-circle-render-shader',
            code: GPU_COLLISION_RENDER_WGSL
        });
        const compute = Object.fromEntries(COMPUTE_ENTRY_POINTS.map((entryPoint) => [
            entryPoint,
            device.createComputePipeline({
                label: `cirvivor-gpu-circle-${entryPoint}`,
                layout: computePipelineLayout,
                compute: { module: computeModule, entryPoint }
            })
        ]));
        this.pipelines = {
            compute,
            updateIndirectArgs: device.createComputePipeline({
                label: 'cirvivor-gpu-circle-update-indirect-args',
                layout: indirectPipelineLayout,
                compute: { module: indirectModule, entryPoint: 'update_indirect_args' }
            }),
            render: device.createRenderPipeline({
                label: 'cirvivor-gpu-circle-render',
                layout: renderPipelineLayout,
                vertex: { module: renderModule, entryPoint: 'vertex_main' },
                fragment: {
                    module: renderModule,
                    entryPoint: 'fragment_main',
                    targets: [{
                        format,
                        blend: {
                            color: {
                                srcFactor: 'one',
                                dstFactor: 'one-minus-src-alpha',
                                operation: 'add'
                            },
                            alpha: {
                                srcFactor: 'one',
                                dstFactor: 'one-minus-src-alpha',
                                operation: 'add'
                            }
                        }
                    }]
                },
                primitive: { topology: 'triangle-list' }
            })
        };

        const resource = (buffer) => ({ buffer });
        this.bindGroups = {
            computeBodies: device.createBindGroup({
                label: 'cirvivor-gpu-circle-compute-bodies',
                layout: computeBodiesLayout,
                entries: [
                    { binding: 0, resource: resource(this.buffers.counts) },
                    { binding: 1, resource: resource(this.buffers.physics) },
                    { binding: 2, resource: resource(this.buffers.simulation) },
                    { binding: 3, resource: resource(this.buffers.temporary) }
                ]
            }),
            computeWorld: device.createBindGroup({
                label: 'cirvivor-gpu-circle-compute-world',
                layout: computeWorldLayout,
                entries: [
                    { binding: 0, resource: resource(this.buffers.gridCounts) },
                    { binding: 1, resource: resource(this.buffers.gridBodies) },
                    { binding: 2, resource: resource(this.buffers.sdf) },
                    { binding: 3, resource: resource(this.buffers.gridOverflow) },
                    {
                        binding: 4,
                        resource: this.flowTexture.createView({ dimension: '2d-array' })
                    }
                ]
            }),
            computeParams: device.createBindGroup({
                label: 'cirvivor-gpu-circle-compute-params',
                layout: computeParamsLayout,
                entries: [{ binding: 0, resource: resource(this.buffers.computeParams) }]
            }),
            indirect: device.createBindGroup({
                label: 'cirvivor-gpu-circle-indirect',
                layout: indirectLayout,
                entries: [
                    { binding: 0, resource: resource(this.buffers.counts) },
                    { binding: 1, resource: resource(this.buffers.dispatchIndirect) },
                    { binding: 2, resource: resource(this.buffers.drawIndirect) }
                ]
            }),
            renderBodies: device.createBindGroup({
                label: 'cirvivor-gpu-circle-render-bodies',
                layout: renderBodiesLayout,
                entries: [
                    { binding: 0, resource: resource(this.buffers.counts) },
                    { binding: 1, resource: resource(this.buffers.physics) },
                    { binding: 2, resource: resource(this.buffers.temporary) },
                    { binding: 3, resource: resource(this.buffers.renderStyles) }
                ]
            }),
            renderParams: device.createBindGroup({
                label: 'cirvivor-gpu-circle-render-params',
                layout: renderParamsLayout,
                entries: [{ binding: 0, resource: resource(this.buffers.renderParams) }]
            })
        };
    }

    #uploadHostState() {
        const queue = this.device.queue;
        const bodyCount = this.bodyCount;
        queue.writeBuffer(this.buffers.counts, 0, this.hostStorage.countsBuffer);
        queue.writeBuffer(this.buffers.gridOverflow, 0, this.overflowResetData);
        if (bodyCount > 0) {
            queue.writeBuffer(
                this.buffers.physics,
                0,
                this.hostStorage.physicsBuffer,
                0,
                bodyCount * GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE
            );
            queue.writeBuffer(
                this.buffers.simulation,
                0,
                this.hostStorage.simulationBuffer,
                0,
                bodyCount * GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE
            );
            queue.writeBuffer(
                this.buffers.temporary,
                0,
                this.hostStorage.temporaryBuffer,
                0,
                bodyCount * GPU_CIRCLE_BODY_ABI.TEMPORARY.STRIDE
            );
            queue.writeBuffer(
                this.buffers.renderStyles,
                0,
                this.hostRenderStyles,
                0,
                bodyCount * BODY_RENDER_STYLE_STRIDE
            );
        }
        queue.writeBuffer(this.buffers.sdf, 0, this.sdf.values);
        queue.writeTexture(
            { texture: this.flowTexture },
            this.flowFieldAtlas.directions,
            {
                bytesPerRow: this.flowFieldAtlas.cols * 2 * FLOAT32_BYTES,
                rowsPerImage: this.flowFieldAtlas.rows
            },
            {
                width: this.flowFieldAtlas.cols,
                height: this.flowFieldAtlas.rows,
                depthOrArrayLayers: Math.max(1, this.flowFieldAtlas.fieldCount)
            }
        );
        this.dispatchIndirectArgs[0] = Math.ceil(bodyCount / BODY_WORKGROUP_SIZE);
        this.dispatchIndirectArgs[1] = 1;
        this.dispatchIndirectArgs[2] = 1;
        queue.writeBuffer(this.buffers.dispatchIndirect, 0, this.dispatchIndirectArgs);
        this.drawIndirectArgs[0] = 6;
        this.drawIndirectArgs[1] = bodyCount;
        this.drawIndirectArgs[2] = 0;
        this.drawIndirectArgs[3] = 0;
        queue.writeBuffer(this.buffers.drawIndirect, 0, this.drawIndirectArgs);
        this.uploadedComputeFixedDelta = NaN;
        this.#writeComputeParams(this.lastFixedDelta);
    }

    #writeComputeParams(fixedDelta) {
        const uploadedDelta = Math.fround(fixedDelta);
        if (Object.is(uploadedDelta, this.uploadedComputeFixedDelta)) {
            return;
        }
        const view = this.computeParamsView;
        view.setFloat32(0, this.worldSize.x, LITTLE_ENDIAN);
        view.setFloat32(4, this.worldSize.y, LITTLE_ENDIAN);
        view.setFloat32(8, this.gridCellSize.x, LITTLE_ENDIAN);
        view.setFloat32(12, this.gridCellSize.y, LITTLE_ENDIAN);
        view.setUint32(16, this.gridCellCount.x, LITTLE_ENDIAN);
        view.setUint32(20, this.gridCellCount.y, LITTLE_ENDIAN);
        view.setUint32(24, this.maxBodiesPerCell, LITTLE_ENDIAN);
        view.setUint32(28, this.solverIterations, LITTLE_ENDIAN);
        view.setFloat32(32, uploadedDelta, LITTLE_ENDIAN);
        view.setFloat32(36, 1 / uploadedDelta, LITTLE_ENDIAN);
        view.setUint32(40, this.sdf.cols, LITTLE_ENDIAN);
        view.setUint32(44, this.sdf.rows, LITTLE_ENDIAN);
        view.setUint32(48, this.sdf.enabled ? 1 : 0, LITTLE_ENDIAN);
        view.setFloat32(52, this.velocityDamping, LITTLE_ENDIAN);
        view.setFloat32(56, this.maxSpeed, LITTLE_ENDIAN);
        view.setFloat32(60, this.sourceWorldUnitScale, LITTLE_ENDIAN);
        view.setUint32(64, this.flowFieldAtlas.cols, LITTLE_ENDIAN);
        view.setUint32(68, this.flowFieldAtlas.rows, LITTLE_ENDIAN);
        view.setUint32(72, this.flowFieldAtlas.fieldCount, LITTLE_ENDIAN);
        view.setUint32(76, this.flowFieldAtlas.enabled ? 1 : 0, LITTLE_ENDIAN);
        view.setFloat32(80, this.flowFieldAtlas.origin.x, LITTLE_ENDIAN);
        view.setFloat32(84, this.flowFieldAtlas.origin.y, LITTLE_ENDIAN);
        view.setFloat32(88, this.flowFieldAtlas.cellSize.x, LITTLE_ENDIAN);
        view.setFloat32(92, this.flowFieldAtlas.cellSize.y, LITTLE_ENDIAN);
        for (let index = 0; index < GPU_CIRCLE_BODY_FLOW.MAX_FIELD_COUNT; index++) {
            const offset = COMPUTE_PARAMS_FLOW_STAGE_OFFSET
                + (index * COMPUTE_PARAMS_FLOW_STAGE_STRIDE);
            const stage = this.flowFieldAtlas.stages[index];
            view.setUint32(offset, stage?.column ?? 0, LITTLE_ENDIAN);
            view.setUint32(offset + 4, stage?.row ?? 0, LITTLE_ENDIAN);
            view.setInt32(offset + 8, stage?.nextFieldIndex ?? -1, LITTLE_ENDIAN);
            view.setUint32(offset + 12, 0, LITTLE_ENDIAN);
        }
        this.device.queue.writeBuffer(this.buffers.computeParams, 0, this.computeParamsBytes);
        this.uploadedComputeFixedDelta = uploadedDelta;
    }

    #writeRenderParams(camera, target) {
        const state = this.presentationClock.getShaderState(this.shaderStateScratch);
        const view = this.renderParamsView;
        view.setFloat32(0, this.renderOriginScratch.x, LITTLE_ENDIAN);
        view.setFloat32(4, this.renderOriginScratch.y, LITTLE_ENDIAN);
        view.setFloat32(8, target.width, LITTLE_ENDIAN);
        view.setFloat32(12, target.height, LITTLE_ENDIAN);
        view.setFloat32(16, camera.getScale(), LITTLE_ENDIAN);
        view.setFloat32(20, state.predictionDelta, LITTLE_ENDIAN);
        view.setFloat32(24, state.interpolationAlpha, LITTLE_ENDIAN);
        view.setUint32(28, state.presentationMode, LITTLE_ENDIAN);
        this.device.queue.writeBuffer(this.buffers.renderParams, 0, this.renderParamsBytes);
    }

    #dispatchBodies(pass, entryPoint) {
        pass.setPipeline(this.pipelines.compute[entryPoint]);
        pass.dispatchWorkgroupsIndirect(this.buffers.dispatchIndirect, 0);
    }

    #releaseGpuResources() {
        this.overflowReadbackLease++;
        for (const slot of this.overflowReadbackSlots) {
            slot.inFlight = false;
            try {
                slot.buffer?.destroy?.();
            } catch {
                // mapping/device loss 중인 staging buffer는 best-effort로 정리합니다.
            }
        }
        this.overflowReadbackSlots = [];
        this.pendingOverflowReadbacks = 0;
        this.overflowReadbackCursor = 0;
        if (this.buffers) {
            for (const buffer of Object.values(this.buffers)) {
                try {
                    buffer?.destroy?.();
                } catch {
                    // already lost/destroyed device resources need no further recovery here
                }
            }
        }
        try {
            this.flowTexture?.destroy?.();
        } catch {
            // already lost/destroyed texture needs no further recovery here
        }
        this.buffers = null;
        this.flowTexture = null;
        this.bindGroups = null;
        this.pipelines = null;
        this.device = null;
        this.deviceGeneration = -1;
        this.canvasFormat = null;
        this.mapReadMode = null;
        this.uploadedComputeFixedDelta = NaN;
    }
}
