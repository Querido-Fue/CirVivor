const LITTLE_ENDIAN = true;
const UINT32_MAX = 0xffffffff;

export const GPU_ACTOR_TRANSIT_ABI_VERSION = 2;

export const GPU_ACTOR_TRANSIT_PHASE = Object.freeze({
    EMPTY: 0,
    AIRBORNE: 1,
    ACTIVE: 2,
    CANCELLED: 3
});

export const GPU_ACTOR_TRANSIT_STATUS = Object.freeze({
    COMPLETE: 1,
    PROTOCOL_REJECTED: 2,
    CANCELLED: 3
});

export const GPU_ACTOR_TRANSIT_ERROR_FLAG = Object.freeze({
    COMMAND_ABI: 1 << 0,
    RECORD_ABI: 1 << 1,
    DESTINATION_IDENTITY: 1 << 2,
    RECORD_FINGERPRINT: 1 << 3,
    FIXED_TICK: 1 << 4,
    NON_FINITE: 1 << 5,
    PROFILE_CONTRACT: 1 << 6
});

export const GPU_ACTOR_TRANSIT_ABI = Object.freeze({
    COMMAND: Object.freeze({
        STRIDE: 32,
        ABI_VERSION: 0,
        SESSION_GENERATION: 4,
        DEVICE_GENERATION: 8,
        AUTHORITATIVE_EPOCH: 12,
        SOURCE_TICK: 16,
        BODY_CAPACITY: 20,
        RESERVED_0: 24,
        RESERVED_1: 28
    }),
    AGGREGATE: Object.freeze({
        STRIDE: 64,
        ABI_VERSION: 0,
        SESSION_GENERATION: 4,
        DEVICE_GENERATION: 8,
        AUTHORITATIVE_EPOCH: 12,
        SOURCE_TICK: 16,
        STATUS: 20,
        AIRBORNE_COUNT: 24,
        ACTIVE_RECORD_COUNT: 28,
        LANDED_COUNT: 32,
        CANCELLED_COUNT: 36,
        INVALID_COUNT: 40,
        ERROR_FLAGS: 44,
        RECORD_FINGERPRINT_XOR: 48,
        MAX_PRESENTATION_ARC_HEIGHT: 52,
        PROCESSED_COUNT: 56,
        BODY_CAPACITY: 60
    }),
    RECORD: Object.freeze({
        STRIDE: 160,
        ABI_VERSION: 0,
        PHASE: 4,
        FLAGS: 8,
        PAYLOAD_CODE: 12,
        ENTITY_ID: 16,
        INCARNATION: 20,
        SOURCE_ENTITY_ID: 24,
        SOURCE_INCARNATION: 28,
        ACTION_CODE: 32,
        PROFILE_CODE: 36,
        PROFILE_FINGERPRINT: 40,
        EXECUTION_ORDINAL: 44,
        EXECUTION_FINGERPRINT: 48,
        PLACEMENT_FINGERPRINT: 52,
        START_TICK: 56,
        ACTIVATION_TICK: 60,
        DURATION_FIXED_TICKS: 64,
        PROGRESS_FIXED_TICKS: 68,
        START_X: 72,
        START_Y: 76,
        LANDING_X: 80,
        LANDING_Y: 84,
        GROUND_VELOCITY_X: 88,
        GROUND_VELOCITY_Y: 92,
        PRESENTATION_ARC_HEIGHT: 96,
        CURRENT_PRESENTATION_ARC_HEIGHT: 100,
        BASELINE_PHYSICAL_META: 104,
        BASELINE_INTERACTION_META: 108,
        BASELINE_NOUN_MASK: 112,
        BASELINE_FLOW_FIELD_INDEX: 116,
        BASELINE_FLOW_SPEED: 120,
        BASELINE_VELOCITY_X: 124,
        BASELINE_VELOCITY_Y: 128,
        RECORD_FINGERPRINT: 132,
        SOURCE_RANK: 136,
        RESERVED_0: 140,
        RESERVED_1: 144,
        RESERVED_2: 148,
        RESERVED_3: 152,
        RESERVED_4: 156
    }),
    DISPATCH_ARGS: Object.freeze({
        STRIDE: 16,
        WORKGROUP_COUNT_X: 0,
        WORKGROUP_COUNT_Y: 4,
        WORKGROUP_COUNT_Z: 8,
        RESERVED: 12
    })
});

const KNOWN_STATUS = new Set(Object.values(GPU_ACTOR_TRANSIT_STATUS));
const KNOWN_ERROR_MASK = Object.values(GPU_ACTOR_TRANSIT_ERROR_FLAG)
    .reduce((mask, flag) => mask | flag, 0);

function requireUint32(value, label, { positive = false } = {}) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0 || number > UINT32_MAX
        || (positive && (number === 0 || number === UINT32_MAX))) {
        throw new RangeError(`${label}은 올바른 uint32여야 합니다.`);
    }
    return number >>> 0;
}

function requireFiniteFloat32(value, label) {
    const number = Math.fround(Number(value));
    if (!Number.isFinite(number)) {
        throw new RangeError(`${label}은 finite float32여야 합니다.`);
    }
    return number === 0 ? 0 : number;
}

function requirePositiveFloat32(value, label) {
    const number = requireFiniteFloat32(value, label);
    if (!(number > 0)) {
        throw new RangeError(`${label}은 양의 finite float32여야 합니다.`);
    }
    return number;
}

export function createGpuActorTransitCommandStorage(source = {}) {
    const c = GPU_ACTOR_TRANSIT_ABI.COMMAND;
    const storage = new ArrayBuffer(c.STRIDE);
    const view = new DataView(storage);
    const values = [
        [c.ABI_VERSION, GPU_ACTOR_TRANSIT_ABI_VERSION],
        [c.SESSION_GENERATION, requireUint32(
            source.sessionGeneration,
            'sessionGeneration',
            { positive: true }
        )],
        [c.DEVICE_GENERATION, requireUint32(
            source.deviceGeneration,
            'deviceGeneration'
        )],
        [c.AUTHORITATIVE_EPOCH, requireUint32(
            source.authoritativeEpoch,
            'authoritativeEpoch'
        )],
        [c.SOURCE_TICK, requireUint32(source.sourceTick, 'sourceTick')],
        [c.BODY_CAPACITY, requireUint32(
            source.bodyCapacity,
            'bodyCapacity',
            { positive: true }
        )],
        [c.RESERVED_0, 0],
        [c.RESERVED_1, 0]
    ];
    for (const [offset, value] of values) {
        view.setUint32(offset, value, LITTLE_ENDIAN);
    }
    return storage;
}

export function createGpuActorTransitDispatchArgs(bodyCapacity, workgroupSize) {
    const capacity = requireUint32(
        bodyCapacity,
        'bodyCapacity',
        { positive: true }
    );
    const groupSize = requireUint32(
        workgroupSize,
        'workgroupSize',
        { positive: true }
    );
    const workgroupCount = Math.ceil(capacity / groupSize);
    if (workgroupCount > UINT32_MAX) {
        throw new RangeError('actor transit workgroup count가 uint32를 넘습니다.');
    }
    return new Uint32Array([workgroupCount, 1, 1, 0]);
}

export function readGpuActorTransitAggregate(buffer) {
    const a = GPU_ACTOR_TRANSIT_ABI.AGGREGATE;
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < a.STRIDE) {
        throw new RangeError('actor transit aggregate buffer가 짧습니다.');
    }
    const view = new DataView(buffer);
    const uint = (field) => view.getUint32(field, LITTLE_ENDIAN);
    const result = Object.freeze({
        abiVersion: uint(a.ABI_VERSION),
        sessionGeneration: uint(a.SESSION_GENERATION),
        deviceGeneration: uint(a.DEVICE_GENERATION),
        authoritativeEpoch: uint(a.AUTHORITATIVE_EPOCH),
        sourceTick: uint(a.SOURCE_TICK),
        status: uint(a.STATUS),
        airborneCount: uint(a.AIRBORNE_COUNT),
        activeRecordCount: uint(a.ACTIVE_RECORD_COUNT),
        landedCount: uint(a.LANDED_COUNT),
        cancelledCount: uint(a.CANCELLED_COUNT),
        invalidCount: uint(a.INVALID_COUNT),
        errorFlags: uint(a.ERROR_FLAGS),
        recordFingerprintXor: uint(a.RECORD_FINGERPRINT_XOR),
        maximumPresentationArcHeight: view.getFloat32(
            a.MAX_PRESENTATION_ARC_HEIGHT,
            LITTLE_ENDIAN
        ),
        processedCount: uint(a.PROCESSED_COUNT),
        bodyCapacity: uint(a.BODY_CAPACITY)
    });
    if (result.abiVersion !== GPU_ACTOR_TRANSIT_ABI_VERSION
        || !KNOWN_STATUS.has(result.status)
        || (result.errorFlags & ~KNOWN_ERROR_MASK) !== 0
        || !Number.isFinite(result.maximumPresentationArcHeight)
        || result.maximumPresentationArcHeight < 0
        || result.processedCount > result.bodyCapacity) {
        throw new RangeError('actor transit aggregate ABI가 올바르지 않습니다.');
    }
    if (result.status === GPU_ACTOR_TRANSIT_STATUS.COMPLETE
        && (result.errorFlags !== 0
            || result.invalidCount !== 0
            || result.cancelledCount !== 0)) {
        throw new RangeError('complete actor transit aggregate가 일관되지 않습니다.');
    }
    return result;
}

export function computeActorTransitActivationTick(startTick, duration) {
    const start = requireUint32(startTick, 'startTick');
    const ticks = requireUint32(duration, 'duration', { positive: true });
    if (ticks > UINT32_MAX - start) {
        throw new RangeError('actor transit activation tick이 uint32를 넘습니다.');
    }
    return (start + ticks) >>> 0;
}

/** duration이 권위이며 ground speed는 endpoint 거리에서만 파생됩니다. */
export function deriveActorTransitGroundVelocity(source = {}) {
    const startX = requireFiniteFloat32(source.startPosition?.x, 'startPosition.x');
    const startY = requireFiniteFloat32(source.startPosition?.y, 'startPosition.y');
    const landingX = requireFiniteFloat32(
        source.landingPosition?.x,
        'landingPosition.x'
    );
    const landingY = requireFiniteFloat32(
        source.landingPosition?.y,
        'landingPosition.y'
    );
    const duration = requireUint32(
        source.travelDurationFixedTicks,
        'travelDurationFixedTicks',
        { positive: true }
    );
    const fixedHz = requirePositiveFloat32(source.fixedHz ?? 60, 'fixedHz');
    return Object.freeze({
        x: Math.fround((landingX - startX) * fixedHz / duration),
        y: Math.fround((landingY - startY) * fixedHz / duration)
    });
}

/** presentation arc는 ground-plane sample에서 파생될 뿐 gameplay 위치가 아닙니다. */
export function sampleActorTransit(source = {}, fixedTick) {
    const startTick = requireUint32(source.startTick, 'startTick');
    const duration = requireUint32(
        source.travelDurationFixedTicks,
        'travelDurationFixedTicks',
        { positive: true }
    );
    const activationTick = computeActorTransitActivationTick(
        startTick,
        duration
    );
    const tick = requireUint32(fixedTick, 'fixedTick');
    const progressFixedTicks = Math.min(
        duration,
        tick > startTick ? tick - startTick : 0
    );
    const ratio = Math.fround(progressFixedTicks / duration);
    const startX = requireFiniteFloat32(source.startPosition?.x, 'startPosition.x');
    const startY = requireFiniteFloat32(source.startPosition?.y, 'startPosition.y');
    const landingX = requireFiniteFloat32(
        source.landingPosition?.x,
        'landingPosition.x'
    );
    const landingY = requireFiniteFloat32(
        source.landingPosition?.y,
        'landingPosition.y'
    );
    const arcHeight = requirePositiveFloat32(
        source.presentationArcHeight,
        'presentationArcHeight'
    );
    return Object.freeze({
        phase: tick >= activationTick
            ? GPU_ACTOR_TRANSIT_PHASE.ACTIVE
            : GPU_ACTOR_TRANSIT_PHASE.AIRBORNE,
        progressFixedTicks,
        activationTick,
        groundPosition: Object.freeze({
            x: Math.fround(startX + (landingX - startX) * ratio),
            y: Math.fround(startY + (landingY - startY) * ratio)
        }),
        presentationArcHeight: tick >= activationTick
            ? 0
            : Math.fround(4 * arcHeight * ratio * (1 - ratio))
    });
}
