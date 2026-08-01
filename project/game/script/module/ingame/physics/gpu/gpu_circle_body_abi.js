const UINT8_MAX = 0xff;
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
        RESERVED: 12
    }),
    PHYSICS: Object.freeze({
        STRIDE: 32,
        POSITION_X: 0,
        POSITION_Y: 4,
        VELOCITY_X: 8,
        VELOCITY_Y: 12,
        RADIUS: 16,
        INVERSE_MASS: 20,
        META: 24,
        RESERVED: 28
    }),
    SIMULATION: Object.freeze({
        STRIDE: 32,
        LIFETIME: 0,
        HEALTH: 4,
        TIMER: 8,
        META: 12,
        FLOW_FIELD_INDEX: 16,
        FLOW_SPEED: 20,
        ENTITY_ID: 24,
        INCARNATION: 28
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
        PHYSICS_META: 8,
        SIMULATION_META: 12,
        INVERSE_MASS: 16,
        RADIUS: 20,
        BODY_ID: 24,
        RESERVED: 28
    })
});

export const GPU_CIRCLE_BODY_META = Object.freeze({
    BYTE_MASK: UINT8_MAX,
    LAYER_SHIFT: 0,
    COLLISION_MASK_SHIFT: 8,
    SIMULATION_FLAGS_SHIFT: 8,
    ALIVE_FLAG: 1,
    USE_FLOW_FLAG: 2,
    ALIVE_BIT: 1 << 8,
    USE_FLOW_BIT: 2 << 8
});

/**
 * 추출한 GPU collision protocol의 layer bit입니다.
 * legacy CPU CollisionHandler의 숫자와 호환되는 값이 아니므로 서로 섞지 않습니다.
 */
export const GPU_CIRCLE_BODY_COLLISION_LAYER = Object.freeze({
    ENEMY: 1 << 0,
    TERRAIN: 1 << 7
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
 * physics meta의 layer/collision mask를 pack합니다.
 * @param {*} layerMask - low 8-bit layer mask입니다.
 * @param {*} collisionMask - 다음 8-bit collision mask입니다.
 * @returns {number} packed uint32 meta입니다.
 */
export function packGpuCirclePhysicsMeta(layerMask, collisionMask) {
    const layer = requireUint8(layerMask, 'layerMask');
    const collision = requireUint8(collisionMask, 'collisionMask');
    return (layer | (collision << GPU_CIRCLE_BODY_META.COLLISION_MASK_SHIFT)) >>> 0;
}

/**
 * physics meta를 collision-only 필드로 unpack합니다.
 * @param {*} meta - packed uint32 meta입니다.
 * @returns {{layerMask:number,collisionMask:number}} unpack 결과입니다.
 */
export function unpackGpuCirclePhysicsMeta(meta) {
    const packed = requireUint32(meta, 'physicsMeta');
    return {
        layerMask: packed & UINT8_MAX,
        collisionMask: (packed >>> GPU_CIRCLE_BODY_META.COLLISION_MASK_SHIFT) & UINT8_MAX
    };
}

/**
 * simulation meta의 layer와 8-bit flags를 pack합니다.
 * @param {*} layerMask - low 8-bit layer mask입니다.
 * @param {*} flags - 다음 8-bit simulation flags입니다.
 * @returns {number} packed uint32 meta입니다.
 */
export function packGpuCircleSimulationMeta(
    layerMask,
    flags = GPU_CIRCLE_BODY_META.ALIVE_FLAG
) {
    const layer = requireUint8(layerMask, 'layerMask');
    const simulationFlags = requireUint8(flags, 'simulationFlags');
    return (layer | (simulationFlags << GPU_CIRCLE_BODY_META.SIMULATION_FLAGS_SHIFT)) >>> 0;
}

/**
 * simulation meta를 collision-only 필드로 unpack합니다.
 * @param {*} meta - packed uint32 meta입니다.
 * @returns {{layerMask:number,flags:number,alive:boolean}} unpack 결과입니다.
 */
export function unpackGpuCircleSimulationMeta(meta) {
    const packed = requireUint32(meta, 'simulationMeta');
    const flags = (packed >>> GPU_CIRCLE_BODY_META.SIMULATION_FLAGS_SHIFT) & UINT8_MAX;
    return {
        layerMask: packed & UINT8_MAX,
        flags,
        alive: (flags & GPU_CIRCLE_BODY_META.ALIVE_FLAG) === GPU_CIRCLE_BODY_META.ALIVE_FLAG
    };
}

/**
 * collision-only ABI storage를 생성합니다.
 * @param {*} capacity - 최대 body 수입니다.
 * @returns {{capacity:number,countsBuffer:ArrayBuffer,physicsBuffer:ArrayBuffer,simulationBuffer:ArrayBuffer,temporaryBuffer:ArrayBuffer}}
 * 생성된 storage입니다.
 */
export function createGpuCircleBodyAbiStorage(capacity) {
    const safeCapacity = requireCapacity(capacity);
    return {
        capacity: safeCapacity,
        countsBuffer: new ArrayBuffer(GPU_CIRCLE_BODY_ABI.COUNTS.STRIDE),
        physicsBuffer: new ArrayBuffer(GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE * safeCapacity),
        simulationBuffer: new ArrayBuffer(
            GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE * safeCapacity
        ),
        temporaryBuffer: new ArrayBuffer(GPU_CIRCLE_BODY_ABI.TEMPORARY.STRIDE * safeCapacity)
    };
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
            !== GPU_CIRCLE_BODY_ABI.TEMPORARY.STRIDE * capacity) {
        throw new TypeError('GPU circle body storage의 buffer 크기 또는 타입이 ABI와 다릅니다.');
    }
    return capacity;
}

/**
 * counts 구조체를 씁니다.
 * @param {*} storage - ABI storage입니다.
 * @param {*} counts - 쓸 count 값입니다.
 * @returns {void}
 */
export function writeGpuCircleBodyCounts(storage, counts) {
    const capacity = requireStorage(storage);
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
    view.setUint32(GPU_CIRCLE_BODY_ABI.COUNTS.RESERVED, 0, LITTLE_ENDIAN);
}

/**
 * counts 구조체를 읽습니다.
 * @param {*} storage - ABI storage입니다.
 * @returns {{bodyCount:number,additionCount:number,removalCount:number,reserved:number}} count 값입니다.
 */
export function readGpuCircleBodyCounts(storage) {
    requireStorage(storage);
    const view = new DataView(storage.countsBuffer);
    return {
        bodyCount: view.getUint32(GPU_CIRCLE_BODY_ABI.COUNTS.BODY_COUNT, LITTLE_ENDIAN),
        additionCount: view.getUint32(GPU_CIRCLE_BODY_ABI.COUNTS.ADDITION_COUNT, LITTLE_ENDIAN),
        removalCount: view.getUint32(GPU_CIRCLE_BODY_ABI.COUNTS.REMOVAL_COUNT, LITTLE_ENDIAN),
        reserved: view.getUint32(GPU_CIRCLE_BODY_ABI.COUNTS.RESERVED, LITTLE_ENDIAN)
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
 * spawn meta를 검증하고 physics/simulation meta의 layer 동기화를 보장합니다.
 * @param {*} spawn - spawn 입력입니다.
 * @returns {{physicsMeta:number,simulationMeta:number}} packed meta입니다.
 */
function resolveSpawnMeta(spawn, useFlow) {
    const physicsMeta = spawn.physicsMeta === undefined
        ? packGpuCirclePhysicsMeta(spawn.layerMask ?? 0, spawn.collisionMask ?? 0)
        : requireUint32(spawn.physicsMeta, 'physicsMeta');
    const simulationMeta = spawn.simulationMeta === undefined
        ? packGpuCircleSimulationMeta(
            spawn.layerMask ?? unpackGpuCirclePhysicsMeta(physicsMeta).layerMask,
            (spawn.alive === false ? 0 : GPU_CIRCLE_BODY_META.ALIVE_FLAG)
                | (useFlow ? GPU_CIRCLE_BODY_META.USE_FLOW_FLAG : 0)
        )
        : requireUint32(spawn.simulationMeta, 'simulationMeta');
    const physicsLayer = unpackGpuCirclePhysicsMeta(physicsMeta).layerMask;
    const simulationLayer = unpackGpuCircleSimulationMeta(simulationMeta).layerMask;
    if (physicsLayer !== simulationLayer) {
        throw new RangeError(
            `physics/simulation layer가 동기화되지 않았습니다: ${physicsLayer}/${simulationLayer}`
        );
    }
    const simulationFlags = unpackGpuCircleSimulationMeta(simulationMeta).flags;
    const metaIsAlive = (simulationFlags & GPU_CIRCLE_BODY_META.ALIVE_FLAG) !== 0;
    const spawnIsAlive = spawn.alive !== false;
    if (metaIsAlive !== spawnIsAlive) {
        throw new RangeError('simulationMeta의 ALIVE flag와 alive 입력이 일치해야 합니다.');
    }
    const metaUsesFlow = (simulationFlags & GPU_CIRCLE_BODY_META.USE_FLOW_FLAG) !== 0;
    if (metaUsesFlow !== useFlow) {
        throw new RangeError('simulationMeta의 USE_FLOW flag와 flow 입력이 일치해야 합니다.');
    }
    return { physicsMeta, simulationMeta };
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

/**
 * spawn을 지정 slot에 완전히 씁니다. 재사용 slot의 임시 상태도 모두 초기화합니다.
 * @param {*} storage - ABI storage입니다.
 * @param {*} index - 쓸 body slot입니다.
 * @param {*} spawn - collision-only spawn 값입니다.
 * @returns {number} 쓴 slot index입니다.
 */
export function writeGpuCircleBodySpawn(storage, index, spawn) {
    const capacity = requireStorage(storage);
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
    const { physicsMeta, simulationMeta } = resolveSpawnMeta(spawn, useFlow);
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
        physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.META,
        physicsMeta,
        LITTLE_ENDIAN
    );
    physicsView.setUint32(
        physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.RESERVED,
        0,
        LITTLE_ENDIAN
    );

    simulationView.setFloat32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.LIFETIME,
        0,
        LITTLE_ENDIAN
    );
    simulationView.setInt32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.HEALTH,
        0,
        LITTLE_ENDIAN
    );
    simulationView.setUint32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.TIMER,
        0,
        LITTLE_ENDIAN
    );
    simulationView.setUint32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.META,
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
            physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.META,
            LITTLE_ENDIAN
        ),
        simulationMeta: simulationView.getUint32(
            simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.META,
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
        )
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
        offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.PHYSICS_META,
        requireUint32(body.physicsMeta, 'physicsMeta'),
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.SIMULATION_META,
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
    view.setUint32(offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.RESERVED, 0, LITTLE_ENDIAN);
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
            offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.PHYSICS_META,
            LITTLE_ENDIAN
        ),
        simulationMeta: view.getUint32(
            offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.SIMULATION_META,
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
        reserved: view.getUint32(
            offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.RESERVED,
            LITTLE_ENDIAN
        )
    };
}
