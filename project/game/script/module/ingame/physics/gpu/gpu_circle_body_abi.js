const UINT8_MAX = 0xff;
const UINT16_MAX = 0xffff;
const INT32_MIN = -0x80000000;
const INT32_MAX = 0x7fffffff;
const UINT32_MAX = 0xffffffff;
const LITTLE_ENDIAN = true;

/**
 * 원본 std430 16/32-byte stride를 유지한 flow/collision host ABI입니다.
 * 숫자는 WGSL 구조체와 DataView packer가 공유하는 단일 offset 권위입니다.
 */
export const GPU_CIRCLE_BODY_ABI = Object.freeze({
    COUNTS: Object.freeze({
        STRIDE: 16,
        BODY_COUNT: 0,
        ADDITION_COUNT: 4,
        REMOVAL_COUNT: 8,
        ABI_VERSION: 12
    }),
    PHYSICS: Object.freeze({
        STRIDE: 32,
        POSITION_X: 0,
        POSITION_Y: 4,
        VELOCITY_X: 8,
        VELOCITY_Y: 12,
        RADIUS: 16,
        INVERSE_MASS: 20,
        PHYSICAL_META: 24,
        INTERACTION_META: 28
    }),
    SIMULATION: Object.freeze({
        STRIDE: 32,
        LIFETIME: 0,
        HEALTH: 4,
        TIMER: 8,
        FLAGS: 12,
        FLOW_FIELD_INDEX: 16,
        FLOW_SPEED: 20,
        ENTITY_ID: 24,
        // 원본 simulation record의 마지막 reserved word를 stable incarnation으로 사용합니다.
        INCARNATION: 28,
        RESERVED_INCARNATION: 28
    }),
    TEMPORARY: Object.freeze({
        STRIDE: 32,
        PREVIOUS_X: 0,
        PREVIOUS_Y: 4,
        PREDICTED_X: 8,
        PREDICTED_Y: 12,
        DELTA_X: 16,
        DELTA_Y: 20,
        GRID_INDEX: 24,
        PREVIOUS_FLOW_FIELD_INDEX: 28
    }),
    GRID_BODY: Object.freeze({
        STRIDE: 32,
        PREDICTED_X: 0,
        PREDICTED_Y: 4,
        PHYSICAL_META: 8,
        FLAGS: 12,
        INVERSE_MASS: 16,
        RADIUS: 20,
        BODY_ID: 24,
        INTERACTION_META: 28
    }),
    CONTACT_HANDLER: Object.freeze({
        STRIDE: 32,
        DAMAGE_SELF: 0,
        DAMAGE_OTHER: 4,
        DAMAGE_FALLOFF: 8,
        FIRE_TIMER: 12,
        FLAGS: 16,
        CHAINING: 20,
        DAMAGE_REPORT_ID: 24,
        SLOW_TIMER: 28
    }),
    /**
     * presentation 전용 32-byte storage layout입니다. 물리/시뮬레이션 ABI와
     * 분리되지만 host writer와 render WGSL이 이 offset을 함께 사용합니다.
     */
    RENDER_STYLE: Object.freeze({
        STRIDE: 32,
        COLOR_RED: 0,
        COLOR_GREEN: 4,
        COLOR_BLUE: 8,
        COLOR_ALPHA: 12,
        RADIUS_SCALE: 16,
        VISIBLE: 20,
        SHAPE_CODE: 24,
        RESERVED: 28
    }),
    APPLIED_EVENT: Object.freeze({
        STRIDE: 32,
        SUBJECT_ENTITY_ID: 0,
        SUBJECT_INCARNATION: 4,
        OTHER_ENTITY_ID: 8,
        OTHER_INCARNATION: 12,
        VALUE_FIXED_POINT: 16,
        EVENT_META: 20,
        WORLD_POSITION_X: 24,
        WORLD_POSITION_Y: 28
    }),
    DEATH_EVENT: Object.freeze({
        STRIDE: 16,
        ENTITY_ID: 0,
        INCARNATION: 4,
        BODY_ID: 8,
        REASON_FLAGS: 12
    })
});

/** Host buffer header와 모든 WGSL module이 공유하는 session 단위 ABI version입니다. */
export const GPU_CIRCLE_BODY_ABI_VERSION = 2;

/**
 * GPU circle body presentation의 분석형 silhouette 코드입니다.
 * 0은 일반 body/projectile의 기존 circle presentation 호환값입니다.
 */
export const GPU_CIRCLE_BODY_RENDER_SHAPE = Object.freeze({
    CIRCLE: 0,
    SQUARE: 1,
    TRIANGLE: 2,
    ARROW: 3,
    PENTA: 4,
    HEXA: 5,
    GEN: 6
});

export const GPU_CIRCLE_BODY_SIMULATION_FLAG = Object.freeze({
    ALIVE: 1 << 0,
    USE_FLOW: 1 << 1,
    COUNT_AS_KILL: 1 << 2,
    EXPLODE_ON_DEATH: 1 << 3,
    GOLDEN: 1 << 4,
    INTERACTION_ENTER_ONLY: 1 << 8,
    INTERACTION_CONTINUOUS: 1 << 9
});

export const GPU_CIRCLE_BODY_META = Object.freeze({
    FIELD_MASK: UINT16_MAX,
    BODY_LAYER_SHIFT: 0,
    COLLISION_MASK_SHIFT: 16,
    INTERACTION_LAYER_SHIFT: 0,
    INTERACTION_MASK_SHIFT: 16,
    SIMULATION_FLAGS_SHIFT: 0,
    ALIVE_FLAG: GPU_CIRCLE_BODY_SIMULATION_FLAG.ALIVE,
    USE_FLOW_FLAG: GPU_CIRCLE_BODY_SIMULATION_FLAG.USE_FLOW,
    COUNT_AS_KILL_FLAG: GPU_CIRCLE_BODY_SIMULATION_FLAG.COUNT_AS_KILL,
    EXPLODE_ON_DEATH_FLAG: GPU_CIRCLE_BODY_SIMULATION_FLAG.EXPLODE_ON_DEATH,
    GOLDEN_FLAG: GPU_CIRCLE_BODY_SIMULATION_FLAG.GOLDEN,
    IS_GOLDEN_FLAG: GPU_CIRCLE_BODY_SIMULATION_FLAG.GOLDEN,
    ALIVE_BIT: GPU_CIRCLE_BODY_SIMULATION_FLAG.ALIVE,
    USE_FLOW_BIT: GPU_CIRCLE_BODY_SIMULATION_FLAG.USE_FLOW,
    COUNT_AS_KILL_BIT: GPU_CIRCLE_BODY_SIMULATION_FLAG.COUNT_AS_KILL,
    EXPLODE_ON_DEATH_BIT: GPU_CIRCLE_BODY_SIMULATION_FLAG.EXPLODE_ON_DEATH,
    GOLDEN_BIT: GPU_CIRCLE_BODY_SIMULATION_FLAG.GOLDEN
});

/**
 * 추출한 GPU collision protocol의 layer bit입니다.
 * legacy CPU CollisionHandler의 숫자와 호환되는 값이 아니므로 서로 섞지 않습니다.
 */
export const GPU_CIRCLE_BODY_LAYER = Object.freeze({
    ENEMY: 1 << 0,
    PROJECTILE: 1 << 1,
    EXPLOSION: 1 << 2,
    EFFECT: 1 << 3,
    FLAME: 1 << 4,
    GRENADE: 1 << 5,
    KINEMATIC_OBSTACLE: 1 << 6,
    LAYER_7: 1 << 6,
    TERRAIN: 1 << 7,
    // Core interaction acceptance capability입니다. gameplay noun은 kindId/definitionId에 남고
    // 이 bit는 physical bodyLayer/collisionMask에 사용하지 않습니다.
    CORE_PROXY: 1 << 8
});

/** 기존 enemy-only import 이름을 유지하는 호환 alias입니다. */
export const GPU_CIRCLE_BODY_COLLISION_LAYER = GPU_CIRCLE_BODY_LAYER;

export const GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG = Object.freeze({
    KILL_IF_OTHER_TERRAIN: 1 << 0,
    CLOSEST_ONLY: 1 << 1,
    SLOW: 1 << 2,
    INTERACTION_ENTER_ONLY: 1 << 3,
    INTERACTION_CONTINUOUS: 1 << 4
});

export const GPU_CIRCLE_APPLIED_EVENT_TYPE = Object.freeze({
    DAMAGE_APPLIED: 1,
    INTERACTION_ENTER: 2,
    INTERACTION_CONTINUOUS: 3
});

export const GPU_CIRCLE_APPLIED_EVENT_META = Object.freeze({
    TYPE_MASK: UINT8_MAX,
    FLAGS_MASK: 0xffffff00
});

export const GPU_CIRCLE_APPLIED_EVENT_FLAG = Object.freeze({
    TARGET_DIED: 1 << 8,
    TERRAIN_KILL: 1 << 9,
    ENTER_POLICY: 1 << 10,
    CONTINUOUS_POLICY: 1 << 11,
    TERRAIN_CONTACT: 1 << 12
});

export const GPU_CIRCLE_BODY_FIXED_POINT = Object.freeze({
    HEALTH_SCALE: 100
});

export const GPU_CIRCLE_BODY_LIFETIME = Object.freeze({
    IMMORTAL: -1
});

export const GPU_CIRCLE_BODY_FLOW = Object.freeze({
    INVALID_FIELD_INDEX: UINT32_MAX,
    MAX_FIELD_COUNT: 256
});

export const GPU_CIRCLE_BODY_IDENTITY = Object.freeze({
    INVALID_COMPONENT: UINT32_MAX
});

/**
 * 양의 정수 capacity를 검증합니다.
 * @param {*} capacity - 검사할 capacity입니다.
 * @returns {number} 검증된 capacity입니다.
 */
function requireCapacity(capacity) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0 || capacity > UINT32_MAX) {
        throw new RangeError('GPU circle body capacity는 1 이상 uint32 범위의 정수여야 합니다.');
    }
    return capacity;
}

/**
 * storage slot index를 검증합니다.
 * @param {*} index - 검사할 index입니다.
 * @param {number} capacity - storage capacity입니다.
 * @returns {number} 검증된 index입니다.
 */
function requireSlotIndex(index, capacity) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= capacity) {
        throw new RangeError(`GPU circle body index가 capacity를 벗어났습니다: ${index}/${capacity}`);
    }
    return index;
}

/**
 * 유한한 Float32 값을 검증하고 반올림합니다.
 * @param {*} value - 검사할 값입니다.
 * @param {string} fieldName - 오류에 표시할 필드명입니다.
 * @returns {number} Float32 값입니다.
 */
function requireFloat32(value, fieldName) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) {
        throw new TypeError(`${fieldName}은(는) 유한한 숫자여야 합니다.`);
    }
    const rounded = Math.fround(numberValue);
    if (!Number.isFinite(rounded)) {
        throw new RangeError(`${fieldName}은(는) Float32 범위를 벗어났습니다.`);
    }
    return rounded;
}

/**
 * 0 이상 Float32 값을 검증합니다.
 * @param {*} value - 검사할 값입니다.
 * @param {string} fieldName - 오류에 표시할 필드명입니다.
 * @returns {number} Float32 값입니다.
 */
function requireNonNegativeFloat32(value, fieldName) {
    const numberValue = requireFloat32(value, fieldName);
    if (numberValue < 0) {
        throw new RangeError(`${fieldName}은(는) 0 이상이어야 합니다.`);
    }
    return numberValue;
}

/**
 * 유한 수명을 Float32로 정규화합니다. -1은 immortal sentinel이고 그 외 값은 0 이상입니다.
 * @param {*} value - 초 단위 수명입니다.
 * @param {string} [fieldName='lifetime'] - 오류에 표시할 필드명입니다.
 * @returns {number} -1 또는 0 이상 Float32 값입니다.
 */
export function normalizeGpuCircleBodyLifetime(
    value = GPU_CIRCLE_BODY_LIFETIME.IMMORTAL,
    fieldName = 'lifetime'
) {
    const lifetime = requireFloat32(value, fieldName);
    if (lifetime !== GPU_CIRCLE_BODY_LIFETIME.IMMORTAL && lifetime < 0) {
        throw new RangeError(`${fieldName}은(는) -1(immortal) 또는 0 이상이어야 합니다.`);
    }
    return lifetime;
}

/**
 * signed int32 값을 검증합니다.
 * @param {*} value - 검사할 값입니다.
 * @param {string} fieldName - 오류에 표시할 필드명입니다.
 * @returns {number} int32 값입니다.
 */
function requireInt32(value, fieldName) {
    const numberValue = Number(value);
    if (!Number.isSafeInteger(numberValue)
        || numberValue < INT32_MIN
        || numberValue > INT32_MAX) {
        throw new RangeError(`${fieldName}은(는) int32 범위의 정수여야 합니다.`);
    }
    return numberValue;
}

/**
 * gameplay health/damage 값을 shader atomic용 signed fixed-point int32로 변환합니다.
 * WGSL의 `i32(f32(value) * f32(scale))`와 동일하게 입력과 곱셈 결과를 각각
 * Float32로 반올림한 뒤 0 방향으로 절삭합니다.
 * @param {*} value - 변환할 gameplay 값입니다.
 * @param {*} [scale=100] - 양의 정수 scale입니다.
 * @returns {number} int32 fixed-point 값입니다.
 */
export function encodeGpuCircleBodyFixedPoint(
    value,
    scale = GPU_CIRCLE_BODY_FIXED_POINT.HEALTH_SCALE
) {
    const numberValue = Number(value);
    const scaleValue = Number(scale);
    if (!Number.isFinite(numberValue)) {
        throw new TypeError('fixed-point value는 유한한 숫자여야 합니다.');
    }
    if (!Number.isSafeInteger(scaleValue) || scaleValue <= 0) {
        throw new RangeError('fixed-point scale은 양의 안전한 정수여야 합니다.');
    }
    const floatValue = Math.fround(numberValue);
    const floatScale = Math.fround(scaleValue);
    const scaledFloat = Math.fround(floatValue * floatScale);
    return requireInt32(Math.trunc(scaledFloat), 'fixedPoint');
}

/**
 * shader atomic fixed-point int32를 gameplay 숫자로 복원합니다.
 * @param {*} value - int32 fixed-point 값입니다.
 * @param {*} [scale=100] - encode에 사용한 scale입니다.
 * @returns {number} gameplay 값입니다.
 */
export function decodeGpuCircleBodyFixedPoint(
    value,
    scale = GPU_CIRCLE_BODY_FIXED_POINT.HEALTH_SCALE
) {
    const fixedPoint = requireInt32(value, 'fixedPoint');
    const scaleValue = Number(scale);
    if (!Number.isSafeInteger(scaleValue) || scaleValue <= 0) {
        throw new RangeError('fixed-point scale은 양의 안전한 정수여야 합니다.');
    }
    return fixedPoint / scaleValue;
}

/**
 * uint8 값을 검증합니다.
 * @param {*} value - 검사할 값입니다.
 * @param {string} fieldName - 오류에 표시할 필드명입니다.
 * @returns {number} uint8 값입니다.
 */
function requireUint8(value, fieldName) {
    if (!Number.isInteger(value) || value < 0 || value > UINT8_MAX) {
        throw new RangeError(`${fieldName}은(는) uint8 범위의 정수여야 합니다.`);
    }
    return value;
}

/**
 * uint16 collision/interaction capability 값을 검증합니다.
 * @param {*} value - 검사할 값입니다.
 * @param {string} fieldName - 오류에 표시할 필드명입니다.
 * @returns {number} uint16 값입니다.
 */
function requireUint16(value, fieldName) {
    if (!Number.isInteger(value) || value < 0 || value > UINT16_MAX) {
        throw new RangeError(`${fieldName}은(는) uint16 범위의 정수여야 합니다.`);
    }
    return value;
}

/**
 * uint32 값을 검증합니다.
 * @param {*} value - 검사할 값입니다.
 * @param {string} fieldName - 오류에 표시할 필드명입니다.
 * @returns {number} uint32 값입니다.
 */
function requireUint32(value, fieldName) {
    if (!Number.isSafeInteger(value) || value < 0 || value > UINT32_MAX) {
        throw new RangeError(`${fieldName}은(는) uint32 범위의 정수여야 합니다.`);
    }
    return value >>> 0;
}

/**
 * render style의 지원 silhouette code를 검증합니다.
 * @param {*} value - uint32 presentation code입니다.
 * @param {string} [fieldName='renderStyle.shapeCode'] - 오류 표기 이름입니다.
 * @returns {number} 검증된 shape code입니다.
 */
export function normalizeGpuCircleBodyRenderShapeCode(
    value = GPU_CIRCLE_BODY_RENDER_SHAPE.CIRCLE,
    fieldName = 'renderStyle.shapeCode'
) {
    const shapeCode = requireUint32(value, fieldName);
    switch (shapeCode) {
        case GPU_CIRCLE_BODY_RENDER_SHAPE.CIRCLE:
        case GPU_CIRCLE_BODY_RENDER_SHAPE.SQUARE:
        case GPU_CIRCLE_BODY_RENDER_SHAPE.TRIANGLE:
        case GPU_CIRCLE_BODY_RENDER_SHAPE.ARROW:
        case GPU_CIRCLE_BODY_RENDER_SHAPE.PENTA:
        case GPU_CIRCLE_BODY_RENDER_SHAPE.HEXA:
        case GPU_CIRCLE_BODY_RENDER_SHAPE.GEN:
            return shapeCode;
        default:
            throw new RangeError(`${fieldName}에 지원하지 않는 shape code가 있습니다: ${shapeCode}`);
    }
}

/**
 * physical meta의 body layer/collision mask를 pack합니다.
 * @param {*} bodyLayer - low 16-bit physical layer입니다.
 * @param {*} collisionMask - high 16-bit physical acceptance mask입니다.
 * @returns {number} packed uint32 meta입니다.
 */
export function packGpuCirclePhysicsMeta(bodyLayer, collisionMask) {
    const layer = requireUint16(bodyLayer, 'bodyLayer');
    const collision = requireUint16(collisionMask, 'collisionMask');
    return (layer | (collision << GPU_CIRCLE_BODY_META.COLLISION_MASK_SHIFT)) >>> 0;
}

/**
 * physics meta를 collision-only 필드로 unpack합니다.
 * @param {*} meta - packed uint32 meta입니다.
 * @returns {{bodyLayer:number,collisionMask:number}} unpack 결과입니다.
 */
export function unpackGpuCirclePhysicsMeta(meta) {
    const packed = requireUint32(meta, 'physicsMeta');
    return {
        bodyLayer: packed & UINT16_MAX,
        collisionMask:
            (packed >>> GPU_CIRCLE_BODY_META.COLLISION_MASK_SHIFT) & UINT16_MAX
    };
}

/**
 * interaction meta의 layer/mask를 pack합니다.
 * @param {*} interactionLayer - low 16-bit gameplay interaction layer입니다.
 * @param {*} interactionMask - high 16-bit reciprocal acceptance mask입니다.
 * @returns {number} packed uint32 meta입니다.
 */
export function packGpuCircleInteractionMeta(interactionLayer, interactionMask) {
    const layer = requireUint16(interactionLayer, 'interactionLayer');
    const mask = requireUint16(interactionMask, 'interactionMask');
    return (layer | (mask << GPU_CIRCLE_BODY_META.INTERACTION_MASK_SHIFT)) >>> 0;
}

/** @param {*} meta - packed interaction meta입니다. */
export function unpackGpuCircleInteractionMeta(meta) {
    const packed = requireUint32(meta, 'interactionMeta');
    return {
        interactionLayer: packed & UINT16_MAX,
        interactionMask:
            (packed >>> GPU_CIRCLE_BODY_META.INTERACTION_MASK_SHIFT) & UINT16_MAX
    };
}

/**
 * simulation plane +12에 저장할 flags-only uint32를 pack합니다.
 * @param {*} [flags] - simulation flags입니다.
 * @returns {number} flags uint32입니다.
 */
export function packGpuCircleSimulationMeta(
    flags = GPU_CIRCLE_BODY_META.ALIVE_FLAG
) {
    return requireUint32(flags, 'simulationFlags');
}

/**
 * simulation meta를 collision-only 필드로 unpack합니다.
 * @param {*} meta - packed uint32 meta입니다.
 * @returns {{flags:number,alive:boolean,useFlow:boolean,countAsKill:boolean,explodeOnDeath:boolean,golden:boolean}} unpack 결과입니다.
 */
export function unpackGpuCircleSimulationMeta(meta) {
    const packed = requireUint32(meta, 'simulationMeta');
    const flags = packed;
    return {
        flags,
        alive: (flags & GPU_CIRCLE_BODY_META.ALIVE_FLAG) === GPU_CIRCLE_BODY_META.ALIVE_FLAG,
        useFlow: (flags & GPU_CIRCLE_BODY_META.USE_FLOW_FLAG)
            === GPU_CIRCLE_BODY_META.USE_FLOW_FLAG,
        countAsKill: (flags & GPU_CIRCLE_BODY_META.COUNT_AS_KILL_FLAG)
            === GPU_CIRCLE_BODY_META.COUNT_AS_KILL_FLAG,
        explodeOnDeath: (flags & GPU_CIRCLE_BODY_META.EXPLODE_ON_DEATH_FLAG)
            === GPU_CIRCLE_BODY_META.EXPLODE_ON_DEATH_FLAG,
        golden: (flags & GPU_CIRCLE_BODY_META.GOLDEN_FLAG)
            === GPU_CIRCLE_BODY_META.GOLDEN_FLAG
    };
}

/**
 * lifecycle/low-level public ingress에서만 legacy metadata alias를 V2로 승격합니다.
 * 반환값에는 legacy 이름이 절대 포함되지 않습니다.
 */
export function normalizeGpuCircleBodyMetadata(source, options = {}) {
    if (!source || typeof source !== 'object') {
        throw new TypeError('GPU circle body metadata source가 필요합니다.');
    }
    const has = (name) => Object.prototype.hasOwnProperty.call(source, name)
        && source[name] !== undefined
        && source[name] !== null;
    const hasLegacyLayer = has('layerMask');
    const hasLegacySensor = has('sensorMask');
    const legacyLayer = hasLegacyLayer
        ? requireUint16(source.layerMask, 'layerMask')
        : undefined;
    const legacyInteractionMask = hasLegacySensor
        ? requireUint16(source.sensorMask, 'sensorMask')
        : undefined;
    if (!has('bodyLayer') && !hasLegacyLayer) {
        throw new TypeError('bodyLayer 또는 legacy layerMask가 필요합니다.');
    }
    if (!has('interactionLayer') && !hasLegacyLayer) {
        throw new TypeError('interactionLayer 또는 legacy layerMask가 필요합니다.');
    }
    if (!has('collisionMask')) {
        throw new TypeError('collisionMask가 필요합니다.');
    }
    if (!has('interactionMask') && !hasLegacySensor && !hasLegacyLayer) {
        throw new TypeError('interactionMask 또는 legacy sensorMask가 필요합니다.');
    }
    const bodyLayer = requireUint16(
        has('bodyLayer') ? source.bodyLayer : legacyLayer,
        'bodyLayer'
    );
    const interactionLayer = requireUint16(
        has('interactionLayer') ? source.interactionLayer : legacyLayer,
        'interactionLayer'
    );
    const collisionMask = requireUint16(source.collisionMask, 'collisionMask');
    const interactionMask = requireUint16(
        has('interactionMask')
            ? source.interactionMask
            : (hasLegacyLayer || hasLegacySensor)
                // V1 contact는 source sensorMask와 target collisionMask를
                // 결합했습니다. legacy-only 입력에서는 두 capability를
                // 합쳐야 reciprocal V2 interaction이 동작 호환됩니다.
                ? (legacyInteractionMask ?? 0) | collisionMask
                : 0,
        'interactionMask'
    );
    if (legacyLayer !== undefined && bodyLayer !== legacyLayer) {
        throw new RangeError('bodyLayer와 layerMask alias가 일치해야 합니다.');
    }
    if (legacyLayer !== undefined && interactionLayer !== legacyLayer) {
        throw new RangeError('interactionLayer와 layerMask alias가 일치해야 합니다.');
    }
    if (has('interactionMask')
        && legacyInteractionMask !== undefined
        && interactionMask !== legacyInteractionMask) {
        throw new RangeError('interactionMask와 sensorMask alias가 일치해야 합니다.');
    }
    if (options.requireNonZeroLayers === true
        && (bodyLayer === 0 || interactionLayer === 0)) {
        throw new RangeError('bodyLayer와 interactionLayer는 하나 이상의 bit가 필요합니다.');
    }
    return Object.freeze({
        bodyLayer,
        collisionMask,
        interactionLayer,
        interactionMask
    });
}

export function packGpuCircleAppliedEventMeta(type, flags = 0) {
    const eventType = requireUint8(type, 'appliedEvent.type');
    if (!Object.values(GPU_CIRCLE_APPLIED_EVENT_TYPE).includes(eventType)) {
        throw new RangeError(`지원하지 않는 applied event type입니다: ${eventType}`);
    }
    const eventFlags = requireUint32(flags, 'appliedEvent.flags');
    if ((eventFlags & GPU_CIRCLE_APPLIED_EVENT_META.TYPE_MASK) !== 0) {
        throw new RangeError('applied event flags는 type low byte를 침범할 수 없습니다.');
    }
    return (eventType | eventFlags) >>> 0;
}

export function unpackGpuCircleAppliedEventMeta(meta) {
    const packed = requireUint32(meta, 'appliedEventMeta');
    return {
        type: packed & GPU_CIRCLE_APPLIED_EVENT_META.TYPE_MASK,
        flags: packed & GPU_CIRCLE_APPLIED_EVENT_META.FLAGS_MASK
    };
}

/**
 * collision-only ABI storage를 생성합니다.
 * @param {*} capacity - 최대 body 수입니다.
 * 반환 buffer들은 GPU 업로드 전 CPU 권위 mirror입니다.
 * @returns {{capacity:number,countsBuffer:ArrayBuffer,physicsBuffer:ArrayBuffer,simulationBuffer:ArrayBuffer,temporaryBuffer:ArrayBuffer,contactHandlerBuffer:ArrayBuffer}}
 * 생성된 CPU mirror storage입니다.
 */
export function createGpuCircleBodyAbiStorage(capacity) {
    const safeCapacity = requireCapacity(capacity);
    const storage = {
        capacity: safeCapacity,
        countsBuffer: new ArrayBuffer(GPU_CIRCLE_BODY_ABI.COUNTS.STRIDE),
        physicsBuffer: new ArrayBuffer(GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE * safeCapacity),
        simulationBuffer: new ArrayBuffer(
            GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE * safeCapacity
        ),
        temporaryBuffer: new ArrayBuffer(
            GPU_CIRCLE_BODY_ABI.TEMPORARY.STRIDE * safeCapacity
        ),
        contactHandlerBuffer: new ArrayBuffer(
            GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.STRIDE * safeCapacity
        )
    };
    new DataView(storage.countsBuffer).setUint32(
        GPU_CIRCLE_BODY_ABI.COUNTS.ABI_VERSION,
        GPU_CIRCLE_BODY_ABI_VERSION,
        LITTLE_ENDIAN
    );
    return storage;
}

/**
 * 생성된 ABI storage 계약을 검증합니다.
 * @param {*} storage - 검사할 storage입니다.
 * @returns {number} storage capacity입니다.
 */
function requireStorage(storage) {
    if (!storage || typeof storage !== 'object') {
        throw new TypeError('GPU circle body storage가 필요합니다.');
    }
    const capacity = requireCapacity(storage.capacity);
    if (!(storage.countsBuffer instanceof ArrayBuffer)
        || storage.countsBuffer.byteLength !== GPU_CIRCLE_BODY_ABI.COUNTS.STRIDE
        || !(storage.physicsBuffer instanceof ArrayBuffer)
        || storage.physicsBuffer.byteLength !== GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE * capacity
        || !(storage.simulationBuffer instanceof ArrayBuffer)
        || storage.simulationBuffer.byteLength
            !== GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE * capacity
        || !(storage.temporaryBuffer instanceof ArrayBuffer)
        || storage.temporaryBuffer.byteLength
            !== GPU_CIRCLE_BODY_ABI.TEMPORARY.STRIDE * capacity
        || !(storage.contactHandlerBuffer instanceof ArrayBuffer)
        || storage.contactHandlerBuffer.byteLength
            !== GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.STRIDE * capacity) {
        throw new TypeError('GPU circle body storage의 buffer 크기 또는 타입이 ABI와 다릅니다.');
    }
    return capacity;
}

/**
 * CPU mirror header가 현재 ABI와 정확히 일치하는지 검증합니다. 불일치 storage는
 * 제자리 migration/repair하지 않고 caller가 session을 재생성하도록 실패합니다.
 */
export function assertGpuCircleBodyAbiVersion(storage) {
    requireStorage(storage);
    const actual = new DataView(storage.countsBuffer).getUint32(
        GPU_CIRCLE_BODY_ABI.COUNTS.ABI_VERSION,
        LITTLE_ENDIAN
    );
    if (actual !== GPU_CIRCLE_BODY_ABI_VERSION) {
        throw new RangeError(
            `GPU circle body ABI version mismatch: expected=${GPU_CIRCLE_BODY_ABI_VERSION}, actual=${actual}`
        );
    }
    return actual;
}

/**
 * counts 구조체를 씁니다.
 * @param {*} storage - ABI storage입니다.
 * @param {*} counts - 쓸 count 값입니다.
 * @returns {void}
 */
export function writeGpuCircleBodyCounts(storage, counts) {
    const capacity = requireStorage(storage);
    assertGpuCircleBodyAbiVersion(storage);
    if (!counts || typeof counts !== 'object') {
        throw new TypeError('counts 객체가 필요합니다.');
    }
    const bodyCount = requireUint32(counts.bodyCount ?? 0, 'bodyCount');
    if (bodyCount > capacity) {
        throw new RangeError(`bodyCount가 capacity를 초과했습니다: ${bodyCount}/${capacity}`);
    }
    const view = new DataView(storage.countsBuffer);
    view.setUint32(GPU_CIRCLE_BODY_ABI.COUNTS.BODY_COUNT, bodyCount, LITTLE_ENDIAN);
    view.setUint32(
        GPU_CIRCLE_BODY_ABI.COUNTS.ADDITION_COUNT,
        requireUint32(counts.additionCount ?? 0, 'additionCount'),
        LITTLE_ENDIAN
    );
    view.setUint32(
        GPU_CIRCLE_BODY_ABI.COUNTS.REMOVAL_COUNT,
        requireUint32(counts.removalCount ?? 0, 'removalCount'),
        LITTLE_ENDIAN
    );
    view.setUint32(
        GPU_CIRCLE_BODY_ABI.COUNTS.ABI_VERSION,
        GPU_CIRCLE_BODY_ABI_VERSION,
        LITTLE_ENDIAN
    );
}

/**
 * counts 구조체를 읽습니다.
 * @param {*} storage - ABI storage입니다.
 * @returns {{bodyCount:number,additionCount:number,removalCount:number,abiVersion:number}} count 값입니다.
 */
export function readGpuCircleBodyCounts(storage) {
    requireStorage(storage);
    const view = new DataView(storage.countsBuffer);
    return {
        bodyCount: view.getUint32(GPU_CIRCLE_BODY_ABI.COUNTS.BODY_COUNT, LITTLE_ENDIAN),
        additionCount: view.getUint32(GPU_CIRCLE_BODY_ABI.COUNTS.ADDITION_COUNT, LITTLE_ENDIAN),
        removalCount: view.getUint32(GPU_CIRCLE_BODY_ABI.COUNTS.REMOVAL_COUNT, LITTLE_ENDIAN),
        abiVersion: view.getUint32(
            GPU_CIRCLE_BODY_ABI.COUNTS.ABI_VERSION,
            LITTLE_ENDIAN
        )
    };
}

/**
 * spawn 입력에서 위치 성분을 읽고 검증합니다.
 * @param {*} spawn - spawn 입력입니다.
 * @param {'x'|'y'} axis - 읽을 축입니다.
 * @returns {number} Float32 위치입니다.
 */
function readSpawnPosition(spawn, axis) {
    const value = spawn.position?.[axis] ?? spawn[axis];
    return requireFloat32(value, `position.${axis}`);
}

/**
 * spawn 입력에서 속도 성분을 읽고 검증합니다.
 * @param {*} spawn - spawn 입력입니다.
 * @param {'x'|'y'} axis - 읽을 축입니다.
 * @returns {number} Float32 속도입니다.
 */
function readSpawnVelocity(spawn, axis) {
    const flatName = axis === 'x' ? 'velocityX' : 'velocityY';
    const value = spawn.velocity?.[axis] ?? spawn[flatName] ?? 0;
    return requireFloat32(value, `velocity.${axis}`);
}

/**
 * V1 sensor producer의 implicit enter-only 의미를 public ingress에서만
 * 명시적 V2 handler policy로 승격합니다.
 * @param {*} spawn - contactHandler와 optional legacy sensorMask를 가진 spawn입니다.
 * @returns {object} canonical contact handler입니다.
 */
export function normalizeGpuCircleBodyContactHandler(spawn) {
    const handler = spawn.contactHandler ?? {};
    if (!handler || typeof handler !== 'object') {
        throw new TypeError('contactHandler는 객체여야 합니다.');
    }
    const authoredFlags = requireUint32(handler.flags ?? 0, 'contactHandler.flags');
    const hasInteractionPolicy = (authoredFlags & (
        GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_ENTER_ONLY
        | GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_CONTINUOUS
    )) !== 0;
    const legacySensorMask = spawn.sensorMask;
    if (!hasInteractionPolicy
        && legacySensorMask !== undefined
        && legacySensorMask !== null
        && requireUint16(legacySensorMask, 'sensorMask') !== 0) {
        return Object.freeze({
            ...handler,
            flags: authoredFlags
                | GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_ENTER_ONLY
        });
    }
    return handler;
}

function resolveSpawnSimulationFlags(spawn, useFlow, contactHandler) {
    let flags = spawn.simulationFlags === undefined
        ? (spawn.alive === false ? 0 : GPU_CIRCLE_BODY_SIMULATION_FLAG.ALIVE)
        : requireUint32(spawn.simulationFlags, 'simulationFlags');
    if (useFlow) {
        flags |= GPU_CIRCLE_BODY_SIMULATION_FLAG.USE_FLOW;
    }
    if (spawn.countAsKill === true) {
        flags |= GPU_CIRCLE_BODY_SIMULATION_FLAG.COUNT_AS_KILL;
    }
    if (spawn.explodeOnDeath === true) {
        flags |= GPU_CIRCLE_BODY_SIMULATION_FLAG.EXPLODE_ON_DEATH;
    }
    if (spawn.golden === true || spawn.isGolden === true) {
        flags |= GPU_CIRCLE_BODY_SIMULATION_FLAG.GOLDEN;
    }
    const handlerFlags = requireUint32(
        contactHandler.flags ?? 0,
        'contactHandler.flags'
    );
    if ((handlerFlags & GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_ENTER_ONLY) !== 0) {
        flags |= GPU_CIRCLE_BODY_SIMULATION_FLAG.INTERACTION_ENTER_ONLY;
    }
    if ((handlerFlags & GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_CONTINUOUS) !== 0) {
        flags |= GPU_CIRCLE_BODY_SIMULATION_FLAG.INTERACTION_CONTINUOUS;
    }
    return flags;
}

function assertOptionalFlagMatches(spawn, fieldNames, flags, flag, label) {
    let expected;
    for (const fieldName of fieldNames) {
        if (typeof spawn[fieldName] === 'boolean') {
            expected = spawn[fieldName];
            break;
        }
    }
    if (expected === undefined) {
        return;
    }
    const enabled = (flags & flag) === flag;
    if (enabled !== expected) {
        throw new RangeError(`simulationMeta의 ${label} flag와 입력이 일치해야 합니다.`);
    }
}

/**
 * spawn metadata를 V2 physical/interaction/simulation word로 검증합니다.
 * @param {*} spawn - spawn 입력입니다.
 * @returns {{physicsMeta:number,interactionMeta:number,simulationMeta:number,metadata:object}} packed meta입니다.
 */
function resolveSpawnMeta(spawn, useFlow, contactHandler) {
    const metadata = normalizeGpuCircleBodyMetadata(spawn);
    const physicsMeta = spawn.physicsMeta === undefined
        ? packGpuCirclePhysicsMeta(
            metadata.bodyLayer,
            metadata.collisionMask
        )
        : requireUint32(spawn.physicsMeta, 'physicsMeta');
    const interactionMeta = spawn.interactionMeta === undefined
        ? packGpuCircleInteractionMeta(
            metadata.interactionLayer,
            metadata.interactionMask
        )
        : requireUint32(spawn.interactionMeta, 'interactionMeta');
    const simulationMeta = spawn.simulationMeta === undefined
        ? packGpuCircleSimulationMeta(resolveSpawnSimulationFlags(
            spawn,
            useFlow,
            contactHandler
        ))
        : requireUint32(spawn.simulationMeta, 'simulationMeta');
    const unpackedPhysics = unpackGpuCirclePhysicsMeta(physicsMeta);
    if (unpackedPhysics.bodyLayer !== metadata.bodyLayer
        || unpackedPhysics.collisionMask !== metadata.collisionMask) {
        throw new RangeError('physicsMeta와 canonical physical metadata가 일치해야 합니다.');
    }
    const unpackedInteraction = unpackGpuCircleInteractionMeta(interactionMeta);
    if (unpackedInteraction.interactionLayer !== metadata.interactionLayer
        || unpackedInteraction.interactionMask !== metadata.interactionMask) {
        throw new RangeError(
            'interactionMeta와 canonical interaction metadata가 일치해야 합니다.'
        );
    }
    const simulationFlags = unpackGpuCircleSimulationMeta(simulationMeta).flags;
    const handlerFlags = requireUint32(
        contactHandler.flags ?? 0,
        'contactHandler.flags'
    );
    const expectedEnterPolicy = (
        handlerFlags & GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_ENTER_ONLY
    ) !== 0;
    const expectedContinuousPolicy = (
        handlerFlags & GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_CONTINUOUS
    ) !== 0;
    if (((simulationFlags & GPU_CIRCLE_BODY_SIMULATION_FLAG.INTERACTION_ENTER_ONLY) !== 0)
            !== expectedEnterPolicy
        || ((simulationFlags
            & GPU_CIRCLE_BODY_SIMULATION_FLAG.INTERACTION_CONTINUOUS) !== 0)
            !== expectedContinuousPolicy) {
        throw new RangeError(
            'simulationMeta의 interaction policy mirror와 contactHandler.flags가 일치해야 합니다.'
        );
    }
    const metaIsAlive = (simulationFlags & GPU_CIRCLE_BODY_META.ALIVE_FLAG) !== 0;
    const spawnIsAlive = spawn.alive !== false;
    if (metaIsAlive !== spawnIsAlive) {
        throw new RangeError('simulationMeta의 ALIVE flag와 alive 입력이 일치해야 합니다.');
    }
    const metaUsesFlow = (simulationFlags & GPU_CIRCLE_BODY_META.USE_FLOW_FLAG) !== 0;
    if (metaUsesFlow !== useFlow) {
        throw new RangeError('simulationMeta의 USE_FLOW flag와 flow 입력이 일치해야 합니다.');
    }
    assertOptionalFlagMatches(
        spawn,
        ['countAsKill'],
        simulationFlags,
        GPU_CIRCLE_BODY_SIMULATION_FLAG.COUNT_AS_KILL,
        'COUNT_AS_KILL'
    );
    assertOptionalFlagMatches(
        spawn,
        ['explodeOnDeath'],
        simulationFlags,
        GPU_CIRCLE_BODY_SIMULATION_FLAG.EXPLODE_ON_DEATH,
        'EXPLODE_ON_DEATH'
    );
    assertOptionalFlagMatches(
        spawn,
        ['golden', 'isGolden'],
        simulationFlags,
        GPU_CIRCLE_BODY_SIMULATION_FLAG.GOLDEN,
        'GOLDEN'
    );
    return { physicsMeta, interactionMeta, simulationMeta, metadata };
}

/**
 * spawn의 선택적 flow-field 조향 값을 검증합니다.
 * @param {*} spawn - spawn 입력입니다.
 * @returns {{useFlow:boolean,flowFieldIndex:number,flowSpeed:number}} 조향 값입니다.
 */
function resolveSpawnFlow(spawn) {
    const hasFieldIndex = spawn.flowFieldIndex !== undefined
        && spawn.flowFieldIndex !== null;
    const useFlow = spawn.useFlow === true || hasFieldIndex;
    if (!useFlow) {
        return {
            useFlow: false,
            flowFieldIndex: GPU_CIRCLE_BODY_FLOW.INVALID_FIELD_INDEX,
            flowSpeed: 0
        };
    }
    const flowFieldIndex = requireUint32(spawn.flowFieldIndex, 'flowFieldIndex');
    if (flowFieldIndex === GPU_CIRCLE_BODY_FLOW.INVALID_FIELD_INDEX) {
        throw new RangeError('flowFieldIndex는 INVALID_FIELD_INDEX일 수 없습니다.');
    }
    return {
        useFlow: true,
        flowFieldIndex,
        flowSpeed: requireNonNegativeFloat32(
            spawn.flowSpeed ?? spawn.maxSpeed,
            'flowSpeed'
        )
    };
}

function resolveSpawnIdentity(spawn) {
    const entityIdValue = spawn.entityId ?? spawn.handle?.entityId;
    const incarnationValue = spawn.incarnation ?? spawn.handle?.incarnation;
    const hasEntityId = entityIdValue !== undefined && entityIdValue !== null;
    const hasIncarnation = incarnationValue !== undefined && incarnationValue !== null;
    if (!hasEntityId && !hasIncarnation) {
        return {
            entityId: GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT,
            incarnation: GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT
        };
    }
    if (!hasEntityId || !hasIncarnation) {
        throw new TypeError('spawn identity에는 entityId와 incarnation이 모두 필요합니다.');
    }
    const entityId = requireUint32(entityIdValue, 'entityId');
    const incarnation = requireUint32(incarnationValue, 'incarnation');
    if (entityId === GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT
        || incarnation === GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT) {
        throw new RangeError('entityId/incarnation은 reserved invalid sentinel일 수 없습니다.');
    }
    return { entityId, incarnation };
}

function resolveSpawnHealthFixedPoint(spawn) {
    if (spawn.healthFixedPoint !== undefined) {
        const healthFixedPoint = requireInt32(
            spawn.healthFixedPoint,
            'healthFixedPoint'
        );
        if (healthFixedPoint < 0) {
            throw new RangeError('spawn healthFixedPoint는 0 이상이어야 합니다.');
        }
        return healthFixedPoint;
    }
    const health = requireNonNegativeFloat32(
        spawn.health ?? (spawn.alive === false ? 0 : 1),
        'health'
    );
    return encodeGpuCircleBodyFixedPoint(health);
}

function readContactHandlerValue(handler, camelName, sourceName, fallback = 0) {
    return handler?.[camelName] ?? handler?.[sourceName] ?? fallback;
}

function requireNonNegativeContactDamage(value, fieldName) {
    const damage = requireNonNegativeFloat32(value, fieldName);
    // WGSL은 contact damage를 atomic health와 같은 ×100 i32 단위로 변환합니다.
    // shader 변환 범위를 넘는 authored 값은 GPU에 보내기 전에 거부합니다.
    encodeGpuCircleBodyFixedPoint(damage);
    return damage;
}

/**
 * contact handler 한 slot을 원본 32-byte layout으로 완전히 씁니다.
 * @param {*} storage - ABI CPU mirror storage입니다.
 * @param {*} index - 쓸 body slot입니다.
 * @param {*} [handler={}] - damage/status/contact 정책입니다.
 * @returns {number} 쓴 slot index입니다.
 */
export function writeGpuCircleContactHandler(storage, index, handler = {}) {
    const capacity = requireStorage(storage);
    assertGpuCircleBodyAbiVersion(storage);
    const slot = requireSlotIndex(index, capacity);
    if (!handler || typeof handler !== 'object') {
        throw new TypeError('contactHandler는 객체여야 합니다.');
    }
    const flags = requireUint32(handler.flags ?? 0, 'contactHandler.flags');
    const interactionPolicy = flags & (
        GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_ENTER_ONLY
        | GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_CONTINUOUS
    );
    if (interactionPolicy === (
        GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_ENTER_ONLY
        | GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_CONTINUOUS
    )) {
        throw new RangeError(
            'contactHandler는 enter-only와 continuous policy를 동시에 가질 수 없습니다.'
        );
    }
    const offset = slot * GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.STRIDE;
    const view = new DataView(storage.contactHandlerBuffer);
    view.setFloat32(
        offset + GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.DAMAGE_SELF,
        requireNonNegativeContactDamage(
            readContactHandlerValue(handler, 'damageSelf', 'damage_self'),
            'contactHandler.damageSelf'
        ),
        LITTLE_ENDIAN
    );
    view.setFloat32(
        offset + GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.DAMAGE_OTHER,
        requireNonNegativeContactDamage(
            readContactHandlerValue(handler, 'damageOther', 'damage_other'),
            'contactHandler.damageOther'
        ),
        LITTLE_ENDIAN
    );
    view.setFloat32(
        offset + GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.DAMAGE_FALLOFF,
        requireNonNegativeFloat32(
            readContactHandlerValue(handler, 'damageFalloff', 'damage_falloff'),
            'contactHandler.damageFalloff'
        ),
        LITTLE_ENDIAN
    );
    view.setFloat32(
        offset + GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.FIRE_TIMER,
        requireNonNegativeFloat32(
            readContactHandlerValue(handler, 'fireTimer', 'fire_timer'),
            'contactHandler.fireTimer'
        ),
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.FLAGS,
        flags,
        LITTLE_ENDIAN
    );
    view.setInt32(
        offset + GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.CHAINING,
        requireInt32(handler.chaining ?? 0, 'contactHandler.chaining'),
        LITTLE_ENDIAN
    );
    view.setInt32(
        offset + GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.DAMAGE_REPORT_ID,
        requireInt32(
            readContactHandlerValue(handler, 'damageReportId', 'damage_report_id', -1),
            'contactHandler.damageReportId'
        ),
        LITTLE_ENDIAN
    );
    view.setFloat32(
        offset + GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.SLOW_TIMER,
        requireNonNegativeFloat32(
            readContactHandlerValue(handler, 'slowTimer', 'slow_timer'),
            'contactHandler.slowTimer'
        ),
        LITTLE_ENDIAN
    );
    return slot;
}

/**
 * contact handler 한 slot을 읽습니다.
 * @param {*} storage - ABI CPU mirror storage입니다.
 * @param {*} index - 읽을 body slot입니다.
 * @returns {object} contact handler snapshot입니다.
 */
export function readGpuCircleContactHandler(storage, index) {
    const capacity = requireStorage(storage);
    assertGpuCircleBodyAbiVersion(storage);
    const slot = requireSlotIndex(index, capacity);
    const offset = slot * GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.STRIDE;
    const view = new DataView(storage.contactHandlerBuffer);
    return {
        damageSelf: view.getFloat32(
            offset + GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.DAMAGE_SELF,
            LITTLE_ENDIAN
        ),
        damageOther: view.getFloat32(
            offset + GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.DAMAGE_OTHER,
            LITTLE_ENDIAN
        ),
        damageFalloff: view.getFloat32(
            offset + GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.DAMAGE_FALLOFF,
            LITTLE_ENDIAN
        ),
        fireTimer: view.getFloat32(
            offset + GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.FIRE_TIMER,
            LITTLE_ENDIAN
        ),
        flags: view.getUint32(
            offset + GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.FLAGS,
            LITTLE_ENDIAN
        ),
        chaining: view.getInt32(
            offset + GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.CHAINING,
            LITTLE_ENDIAN
        ),
        damageReportId: view.getInt32(
            offset + GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.DAMAGE_REPORT_ID,
            LITTLE_ENDIAN
        ),
        slowTimer: view.getFloat32(
            offset + GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.SLOW_TIMER,
            LITTLE_ENDIAN
        )
    };
}

/**
 * spawn을 지정 slot에 완전히 씁니다. 재사용 slot의 임시 상태도 모두 초기화합니다.
 * @param {*} storage - ABI storage입니다.
 * @param {*} index - 쓸 body slot입니다.
 * @param {*} spawn - collision-only spawn 값입니다.
 * @returns {number} 쓴 slot index입니다.
 */
export function writeGpuCircleBodySpawn(storage, index, spawn) {
    const capacity = requireStorage(storage);
    assertGpuCircleBodyAbiVersion(storage);
    const slot = requireSlotIndex(index, capacity);
    if (!spawn || typeof spawn !== 'object') {
        throw new TypeError('spawn 객체가 필요합니다.');
    }

    const positionX = readSpawnPosition(spawn, 'x');
    const positionY = readSpawnPosition(spawn, 'y');
    const velocityX = readSpawnVelocity(spawn, 'x');
    const velocityY = readSpawnVelocity(spawn, 'y');
    const radius = requireNonNegativeFloat32(spawn.radius, 'radius');
    const inverseMass = requireNonNegativeFloat32(
        spawn.inverseMass ?? spawn.invMass,
        'inverseMass'
    );
    const { useFlow, flowFieldIndex, flowSpeed } = resolveSpawnFlow(spawn);
    const { entityId, incarnation } = resolveSpawnIdentity(spawn);
    const contactHandler = normalizeGpuCircleBodyContactHandler(spawn);
    const { physicsMeta, interactionMeta, simulationMeta } = resolveSpawnMeta(
        spawn,
        useFlow,
        contactHandler
    );
    const lifetime = normalizeGpuCircleBodyLifetime(
        spawn.lifetime ?? GPU_CIRCLE_BODY_LIFETIME.IMMORTAL
    );
    const healthFixedPoint = resolveSpawnHealthFixedPoint(spawn);
    const timer = requireUint32(spawn.timer ?? 0, 'timer');
    const physicsOffset = slot * GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE;
    const simulationOffset = slot * GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE;
    const temporaryOffset = slot * GPU_CIRCLE_BODY_ABI.TEMPORARY.STRIDE;
    const physicsView = new DataView(storage.physicsBuffer);
    const simulationView = new DataView(storage.simulationBuffer);
    const temporaryView = new DataView(storage.temporaryBuffer);

    physicsView.setFloat32(
        physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.POSITION_X,
        positionX,
        LITTLE_ENDIAN
    );
    physicsView.setFloat32(
        physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.POSITION_Y,
        positionY,
        LITTLE_ENDIAN
    );
    physicsView.setFloat32(
        physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.VELOCITY_X,
        velocityX,
        LITTLE_ENDIAN
    );
    physicsView.setFloat32(
        physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.VELOCITY_Y,
        velocityY,
        LITTLE_ENDIAN
    );
    physicsView.setFloat32(
        physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.RADIUS,
        radius,
        LITTLE_ENDIAN
    );
    physicsView.setFloat32(
        physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.INVERSE_MASS,
        inverseMass,
        LITTLE_ENDIAN
    );
    physicsView.setUint32(
        physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.PHYSICAL_META,
        physicsMeta,
        LITTLE_ENDIAN
    );
    physicsView.setUint32(
        physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.INTERACTION_META,
        interactionMeta,
        LITTLE_ENDIAN
    );

    simulationView.setFloat32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.LIFETIME,
        lifetime,
        LITTLE_ENDIAN
    );
    simulationView.setInt32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.HEALTH,
        healthFixedPoint,
        LITTLE_ENDIAN
    );
    simulationView.setUint32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.TIMER,
        timer,
        LITTLE_ENDIAN
    );
    simulationView.setUint32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.FLAGS,
        simulationMeta,
        LITTLE_ENDIAN
    );
    simulationView.setUint32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.FLOW_FIELD_INDEX,
        flowFieldIndex,
        LITTLE_ENDIAN
    );
    simulationView.setFloat32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.FLOW_SPEED,
        flowSpeed,
        LITTLE_ENDIAN
    );
    simulationView.setUint32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.ENTITY_ID,
        entityId,
        LITTLE_ENDIAN
    );
    simulationView.setUint32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.INCARNATION,
        incarnation,
        LITTLE_ENDIAN
    );

    temporaryView.setFloat32(
        temporaryOffset + GPU_CIRCLE_BODY_ABI.TEMPORARY.PREVIOUS_X,
        positionX,
        LITTLE_ENDIAN
    );
    temporaryView.setFloat32(
        temporaryOffset + GPU_CIRCLE_BODY_ABI.TEMPORARY.PREVIOUS_Y,
        positionY,
        LITTLE_ENDIAN
    );
    temporaryView.setFloat32(
        temporaryOffset + GPU_CIRCLE_BODY_ABI.TEMPORARY.PREDICTED_X,
        positionX,
        LITTLE_ENDIAN
    );
    temporaryView.setFloat32(
        temporaryOffset + GPU_CIRCLE_BODY_ABI.TEMPORARY.PREDICTED_Y,
        positionY,
        LITTLE_ENDIAN
    );
    temporaryView.setFloat32(
        temporaryOffset + GPU_CIRCLE_BODY_ABI.TEMPORARY.DELTA_X,
        0,
        LITTLE_ENDIAN
    );
    temporaryView.setFloat32(
        temporaryOffset + GPU_CIRCLE_BODY_ABI.TEMPORARY.DELTA_Y,
        0,
        LITTLE_ENDIAN
    );
    temporaryView.setInt32(
        temporaryOffset + GPU_CIRCLE_BODY_ABI.TEMPORARY.GRID_INDEX,
        -1,
        LITTLE_ENDIAN
    );
    temporaryView.setUint32(
        temporaryOffset + GPU_CIRCLE_BODY_ABI.TEMPORARY.PREVIOUS_FLOW_FIELD_INDEX,
        flowFieldIndex,
        LITTLE_ENDIAN
    );
    writeGpuCircleContactHandler(storage, slot, contactHandler);
    return slot;
}

/**
 * 현재 body count 뒤에 spawn을 append합니다. capacity 초과는 쓰기 전에 거부합니다.
 * @param {*} storage - ABI storage입니다.
 * @param {*} spawn - collision-only spawn 값입니다.
 * @returns {number} 추가된 slot index입니다.
 */
export function appendGpuCircleBodySpawn(storage, spawn) {
    const capacity = requireStorage(storage);
    const counts = readGpuCircleBodyCounts(storage);
    if (counts.bodyCount >= capacity) {
        throw new RangeError(`GPU circle body capacity가 가득 찼습니다: ${capacity}`);
    }
    const slot = writeGpuCircleBodySpawn(storage, counts.bodyCount, spawn);
    writeGpuCircleBodyCounts(storage, {
        ...counts,
        bodyCount: counts.bodyCount + 1
    });
    return slot;
}

/**
 * body slot의 host ABI 값을 읽습니다.
 * @param {*} storage - ABI storage입니다.
 * @param {*} index - 읽을 slot입니다.
 * @returns {*} unpack된 collision-only body입니다.
 */
export function readGpuCircleBody(storage, index) {
    const capacity = requireStorage(storage);
    assertGpuCircleBodyAbiVersion(storage);
    const slot = requireSlotIndex(index, capacity);
    const physicsOffset = slot * GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE;
    const simulationOffset = slot * GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE;
    const temporaryOffset = slot * GPU_CIRCLE_BODY_ABI.TEMPORARY.STRIDE;
    const physicsView = new DataView(storage.physicsBuffer);
    const simulationView = new DataView(storage.simulationBuffer);
    const temporaryView = new DataView(storage.temporaryBuffer);
    return {
        index: slot,
        position: {
            x: physicsView.getFloat32(
                physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.POSITION_X,
                LITTLE_ENDIAN
            ),
            y: physicsView.getFloat32(
                physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.POSITION_Y,
                LITTLE_ENDIAN
            )
        },
        velocity: {
            x: physicsView.getFloat32(
                physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.VELOCITY_X,
                LITTLE_ENDIAN
            ),
            y: physicsView.getFloat32(
                physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.VELOCITY_Y,
                LITTLE_ENDIAN
            )
        },
        radius: physicsView.getFloat32(
            physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.RADIUS,
            LITTLE_ENDIAN
        ),
        inverseMass: physicsView.getFloat32(
            physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.INVERSE_MASS,
            LITTLE_ENDIAN
        ),
        physicsMeta: physicsView.getUint32(
            physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.PHYSICAL_META,
            LITTLE_ENDIAN
        ),
        interactionMeta: physicsView.getUint32(
            physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.INTERACTION_META,
            LITTLE_ENDIAN
        ),
        lifetime: simulationView.getFloat32(
            simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.LIFETIME,
            LITTLE_ENDIAN
        ),
        healthFixedPoint: simulationView.getInt32(
            simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.HEALTH,
            LITTLE_ENDIAN
        ),
        health: decodeGpuCircleBodyFixedPoint(simulationView.getInt32(
            simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.HEALTH,
            LITTLE_ENDIAN
        )),
        timer: simulationView.getUint32(
            simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.TIMER,
            LITTLE_ENDIAN
        ),
        simulationMeta: simulationView.getUint32(
            simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.FLAGS,
            LITTLE_ENDIAN
        ),
        flowFieldIndex: simulationView.getUint32(
            simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.FLOW_FIELD_INDEX,
            LITTLE_ENDIAN
        ),
        flowSpeed: simulationView.getFloat32(
            simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.FLOW_SPEED,
            LITTLE_ENDIAN
        ),
        entityId: simulationView.getUint32(
            simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.ENTITY_ID,
            LITTLE_ENDIAN
        ),
        incarnation: simulationView.getUint32(
            simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.INCARNATION,
            LITTLE_ENDIAN
        ),
        previousPosition: {
            x: temporaryView.getFloat32(
                temporaryOffset + GPU_CIRCLE_BODY_ABI.TEMPORARY.PREVIOUS_X,
                LITTLE_ENDIAN
            ),
            y: temporaryView.getFloat32(
                temporaryOffset + GPU_CIRCLE_BODY_ABI.TEMPORARY.PREVIOUS_Y,
                LITTLE_ENDIAN
            )
        },
        predictedPosition: {
            x: temporaryView.getFloat32(
                temporaryOffset + GPU_CIRCLE_BODY_ABI.TEMPORARY.PREDICTED_X,
                LITTLE_ENDIAN
            ),
            y: temporaryView.getFloat32(
                temporaryOffset + GPU_CIRCLE_BODY_ABI.TEMPORARY.PREDICTED_Y,
                LITTLE_ENDIAN
            )
        },
        positionDelta: {
            x: temporaryView.getFloat32(
                temporaryOffset + GPU_CIRCLE_BODY_ABI.TEMPORARY.DELTA_X,
                LITTLE_ENDIAN
            ),
            y: temporaryView.getFloat32(
                temporaryOffset + GPU_CIRCLE_BODY_ABI.TEMPORARY.DELTA_Y,
                LITTLE_ENDIAN
            )
        },
        gridIndex: temporaryView.getInt32(
            temporaryOffset + GPU_CIRCLE_BODY_ABI.TEMPORARY.GRID_INDEX,
            LITTLE_ENDIAN
        ),
        previousFlowFieldIndex: temporaryView.getUint32(
            temporaryOffset + GPU_CIRCLE_BODY_ABI.TEMPORARY.PREVIOUS_FLOW_FIELD_INDEX,
            LITTLE_ENDIAN
        ),
        contactHandler: readGpuCircleContactHandler(storage, slot)
    };
}

/**
 * 독립 GridBody ArrayBuffer를 생성합니다.
 * @param {*} capacity - grid entry capacity입니다.
 * @returns {ArrayBuffer} GridBody storage입니다.
 */
export function createGpuCircleGridBodyBuffer(capacity) {
    return new ArrayBuffer(GPU_CIRCLE_BODY_ABI.GRID_BODY.STRIDE * requireCapacity(capacity));
}

/**
 * GridBody entry를 std430 layout으로 씁니다.
 * @param {ArrayBuffer} buffer - GridBody buffer입니다.
 * @param {*} capacity - entry capacity입니다.
 * @param {*} index - 쓸 entry입니다.
 * @param {*} body - grid snapshot 값입니다.
 * @returns {void}
 */
export function writeGpuCircleGridBody(buffer, capacity, index, body) {
    const safeCapacity = requireCapacity(capacity);
    const slot = requireSlotIndex(index, safeCapacity);
    if (!(buffer instanceof ArrayBuffer)
        || buffer.byteLength !== safeCapacity * GPU_CIRCLE_BODY_ABI.GRID_BODY.STRIDE) {
        throw new TypeError('GridBody buffer 크기가 ABI/capacity와 다릅니다.');
    }
    if (!body || typeof body !== 'object') {
        throw new TypeError('GridBody 값이 필요합니다.');
    }
    const view = new DataView(buffer);
    const offset = slot * GPU_CIRCLE_BODY_ABI.GRID_BODY.STRIDE;
    view.setFloat32(
        offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.PREDICTED_X,
        requireFloat32(body.predictedPosition?.x ?? body.x, 'predictedPosition.x'),
        LITTLE_ENDIAN
    );
    view.setFloat32(
        offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.PREDICTED_Y,
        requireFloat32(body.predictedPosition?.y ?? body.y, 'predictedPosition.y'),
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.PHYSICAL_META,
        requireUint32(body.physicsMeta, 'physicsMeta'),
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.FLAGS,
        requireUint32(body.simulationMeta, 'simulationMeta'),
        LITTLE_ENDIAN
    );
    view.setFloat32(
        offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.INVERSE_MASS,
        requireNonNegativeFloat32(body.inverseMass, 'inverseMass'),
        LITTLE_ENDIAN
    );
    view.setFloat32(
        offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.RADIUS,
        requireNonNegativeFloat32(body.radius, 'radius'),
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.BODY_ID,
        requireUint32(body.bodyId, 'bodyId'),
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.INTERACTION_META,
        requireUint32(body.interactionMeta, 'interactionMeta'),
        LITTLE_ENDIAN
    );
}

/**
 * GridBody entry를 읽습니다.
 * @param {ArrayBuffer} buffer - GridBody buffer입니다.
 * @param {*} capacity - entry capacity입니다.
 * @param {*} index - 읽을 entry입니다.
 * @returns {*} unpack된 GridBody입니다.
 */
export function readGpuCircleGridBody(buffer, capacity, index) {
    const safeCapacity = requireCapacity(capacity);
    const slot = requireSlotIndex(index, safeCapacity);
    if (!(buffer instanceof ArrayBuffer)
        || buffer.byteLength !== safeCapacity * GPU_CIRCLE_BODY_ABI.GRID_BODY.STRIDE) {
        throw new TypeError('GridBody buffer 크기가 ABI/capacity와 다릅니다.');
    }
    const view = new DataView(buffer);
    const offset = slot * GPU_CIRCLE_BODY_ABI.GRID_BODY.STRIDE;
    return {
        predictedPosition: {
            x: view.getFloat32(
                offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.PREDICTED_X,
                LITTLE_ENDIAN
            ),
            y: view.getFloat32(
                offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.PREDICTED_Y,
                LITTLE_ENDIAN
            )
        },
        physicsMeta: view.getUint32(
            offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.PHYSICAL_META,
            LITTLE_ENDIAN
        ),
        simulationMeta: view.getUint32(
            offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.FLAGS,
            LITTLE_ENDIAN
        ),
        inverseMass: view.getFloat32(
            offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.INVERSE_MASS,
            LITTLE_ENDIAN
        ),
        radius: view.getFloat32(
            offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.RADIUS,
            LITTLE_ENDIAN
        ),
        bodyId: view.getUint32(
            offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.BODY_ID,
            LITTLE_ENDIAN
        ),
        interactionMeta: view.getUint32(
            offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.INTERACTION_META,
            LITTLE_ENDIAN
        )
    };
}
