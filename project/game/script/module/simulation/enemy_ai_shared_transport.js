import { ENEMY_AI_CONSTANTS } from '../../data/object/enemy/enemy_ai_constants.js';

const ENEMY_AI_SHARED_SLOT_COUNT = 2;
const ENEMY_AI_SHARED_GLOBAL_HEADER_LENGTH = 2;
const ENEMY_AI_SHARED_SLOT_HEADER_STRIDE = 4;
const ENEMY_AI_SHARED_DEFAULT_CAPACITY = 16384;
const ENEMY_AI_STATE_SCHEMA_VERSION = ENEMY_AI_CONSTANTS.STATE_SCHEMA_VERSION;

const ENEMY_AI_SHARED_META_INDEX = Object.freeze({
    PUBLISHED_SLOT: 0,
    VERSION: 1
});

const ENEMY_AI_SHARED_SLOT_INDEX = Object.freeze({
    REQUEST_ID: 0,
    WALLS_VERSION: 1,
    ENEMY_TOPOLOGY_VERSION: 2,
    RESULT_COUNT: 3
});

const ENEMY_AI_SHARED_FLAGS = Object.freeze({
    INITIALIZED: 1 << 0,
    HAS_DIRECT_PATH_RESULT: 1 << 1,
    LAST_DIRECT_PATH: 1 << 2
});

const ENEMY_AI_SHARED_CHARGE_STATE_TO_CODE = Object.freeze({
    idle: 0,
    charge: 1,
    recover: 2
});

const ENEMY_AI_SHARED_CHARGE_STATE_BY_CODE = Object.freeze([
    'idle',
    'charge',
    'recover'
]);

const ENEMY_AI_SHARED_RESULT_INDEX = Object.freeze({
    ID: 0,
    ACC_X: 1,
    ACC_Y: 2,
    ACC_SPEED: 3,
    FLAGS: 4,
    DIR_X: 5,
    DIR_Y: 6,
    BASE_DESIRED_SPEED: 7,
    DESIRED_SPEED: 8,
    BASE_ACCEL_RESPONSE: 9,
    ACCEL_RESPONSE: 10,
    TARGET_X: 11,
    TARGET_Y: 12,
    LAST_DIRECT_PATH_WALLS_VERSION: 13,
    LAST_DIRECT_PATH_PAD_BUCKET: 14,
    LAST_DIRECT_PATH_START_CX: 15,
    LAST_DIRECT_PATH_START_CY: 16,
    LAST_DIRECT_PATH_TARGET_CX: 17,
    LAST_DIRECT_PATH_TARGET_CY: 18,
    ORBIT_DIRECTION: 19,
    CHARGE_STATE: 20,
    CHARGE_COOLDOWN_REMAINING: 21,
    CHARGE_DURATION_REMAINING: 22,
    CHARGE_RECOVER_REMAINING: 23,
    CHARGE_TARGET_X: 24,
    CHARGE_TARGET_Y: 25
});

const ENEMY_AI_SHARED_RESULT_STRIDE = 26;

/**
 * 적 AI SharedArrayBuffer transport 사용 가능 여부를 반환합니다.
 * @returns {boolean}
 */
export function isEnemyAISharedTransportSupported() {
    return typeof SharedArrayBuffer === 'function' && typeof Atomics === 'object';
}

/**
 * 결과 버퍼 capacity를 안전한 정수로 정규화합니다.
 * @param {number|null|undefined} capacity
 * @returns {number}
 */
function normalizeEnemyAISharedCapacity(capacity) {
    return Number.isInteger(capacity) && capacity > 0
        ? capacity
        : ENEMY_AI_SHARED_DEFAULT_CAPACITY;
}

/**
 * SharedArrayBuffer 메타 버퍼를 생성합니다.
 * @returns {SharedArrayBuffer}
 */
function createEnemyAISharedMetaBuffer() {
    return new SharedArrayBuffer(
        Int32Array.BYTES_PER_ELEMENT
        * (
            ENEMY_AI_SHARED_GLOBAL_HEADER_LENGTH
            + (ENEMY_AI_SHARED_SLOT_COUNT * ENEMY_AI_SHARED_SLOT_HEADER_STRIDE)
        )
    );
}

/**
 * SharedArrayBuffer 결과 버퍼를 생성합니다.
 * @param {number} capacity
 * @returns {SharedArrayBuffer}
 */
function createEnemyAISharedResultBuffer(capacity) {
    return new SharedArrayBuffer(
        Float32Array.BYTES_PER_ELEMENT
        * ENEMY_AI_SHARED_SLOT_COUNT
        * capacity
        * ENEMY_AI_SHARED_RESULT_STRIDE
    );
}

/**
 * 슬롯 헤더 시작 인덱스를 계산합니다.
 * @param {number} slotIndex
 * @returns {number}
 */
function getEnemyAISharedSlotHeaderBaseIndex(slotIndex) {
    return ENEMY_AI_SHARED_GLOBAL_HEADER_LENGTH + (slotIndex * ENEMY_AI_SHARED_SLOT_HEADER_STRIDE);
}

/**
 * 슬롯별 결과 버퍼 시작 인덱스를 계산합니다.
 * @param {number} slotIndex
 * @param {number} capacity
 * @returns {number}
 */
function getEnemyAISharedSlotBaseIndex(slotIndex, capacity) {
    return slotIndex * capacity * ENEMY_AI_SHARED_RESULT_STRIDE;
}

/**
 * 슬롯별 결과 버퍼 시작 인덱스 배열을 생성합니다.
 * @param {number} capacity
 * @returns {number[]}
 */
function createEnemyAISharedSlotBases(capacity) {
    const slotBases = [];
    for (let slotIndex = 0; slotIndex < ENEMY_AI_SHARED_SLOT_COUNT; slotIndex++) {
        slotBases.push(getEnemyAISharedSlotBaseIndex(slotIndex, capacity));
    }
    return slotBases;
}

/**
 * 수치를 Float32 버퍼 기록용 값으로 정규화합니다.
 * @param {number|null|undefined} value
 * @param {number} [fallback=0]
 * @returns {number}
 */
function normalizeEnemyAISharedNumber(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
}

/**
 * charge 상태 문자열을 숫자 코드로 변환합니다.
 * @param {string|null|undefined} chargeState
 * @returns {number}
 */
function getEnemyAISharedChargeStateCode(chargeState) {
    if (typeof chargeState !== 'string') {
        return ENEMY_AI_SHARED_CHARGE_STATE_TO_CODE.idle;
    }

    return ENEMY_AI_SHARED_CHARGE_STATE_TO_CODE[chargeState] ?? ENEMY_AI_SHARED_CHARGE_STATE_TO_CODE.idle;
}

/**
 * 숫자 코드를 charge 상태 문자열로 변환합니다.
 * @param {number|null|undefined} chargeStateCode
 * @returns {string}
 */
function getEnemyAISharedChargeStateByCode(chargeStateCode) {
    if (!Number.isFinite(chargeStateCode)) {
        return 'idle';
    }

    return ENEMY_AI_SHARED_CHARGE_STATE_BY_CODE[Math.round(chargeStateCode)] ?? 'idle';
}

/**
 * 적 AI 상태를 비트 플래그로 압축합니다.
 * @param {object|null|undefined} state
 * @returns {number}
 */
function getEnemyAISharedStateFlags(state) {
    let flags = 0;
    if (state?.__initialized === true) {
        flags |= ENEMY_AI_SHARED_FLAGS.INITIALIZED;
    }
    if (state?.hasDirectPathResult === true) {
        flags |= ENEMY_AI_SHARED_FLAGS.HAS_DIRECT_PATH_RESULT;
    }
    if (state?.lastDirectPath === true) {
        flags |= ENEMY_AI_SHARED_FLAGS.LAST_DIRECT_PATH;
    }
    return flags;
}

/**
 * 적 AI 결과 transport를 생성합니다.
 * @param {number} [capacity=16384]
 * @returns {object|null}
 */
export function createEnemyAISharedTransport(capacity = ENEMY_AI_SHARED_DEFAULT_CAPACITY) {
    if (!isEnemyAISharedTransportSupported()) {
        return null;
    }

    const normalizedCapacity = normalizeEnemyAISharedCapacity(capacity);
    return attachEnemyAISharedTransport({
        metaBuffer: createEnemyAISharedMetaBuffer(),
        resultBuffer: createEnemyAISharedResultBuffer(normalizedCapacity),
        capacity: normalizedCapacity
    });
}

/**
 * raw buffer 세트를 transport/view 객체로 감쌉니다.
 * @param {object|null|undefined} buffers
 * @returns {object|null}
 */
export function attachEnemyAISharedTransport(buffers) {
    if (!buffers
        || !(buffers.metaBuffer instanceof SharedArrayBuffer)
        || !(buffers.resultBuffer instanceof SharedArrayBuffer)) {
        return null;
    }

    const capacity = normalizeEnemyAISharedCapacity(buffers.capacity);
    return {
        metaBuffer: buffers.metaBuffer,
        resultBuffer: buffers.resultBuffer,
        capacity,
        meta: new Int32Array(buffers.metaBuffer),
        resultData: new Float32Array(buffers.resultBuffer),
        slotBases: createEnemyAISharedSlotBases(capacity)
    };
}

/**
 * worker bootstrap용 raw buffer 세트를 추출합니다.
 * @param {object|null|undefined} transport
 * @returns {object|null}
 */
export function exportEnemyAISharedTransportBuffers(transport) {
    if (!transport) {
        return null;
    }

    return {
        metaBuffer: transport.metaBuffer,
        resultBuffer: transport.resultBuffer,
        capacity: normalizeEnemyAISharedCapacity(transport.capacity)
    };
}

/**
 * 다음 publish 슬롯에 결과 쓰기 상태를 준비합니다.
 * @param {object|null|undefined} transport
 * @returns {{transport: object, slotIndex: number, slotHeaderBase: number, baseIndex: number, count: number}|null}
 */
export function beginEnemyAISharedResultWrite(transport) {
    if (!transport?.meta || !(transport.resultData instanceof Float32Array)) {
        return null;
    }

    const currentPublishedSlot = Atomics.load(transport.meta, ENEMY_AI_SHARED_META_INDEX.PUBLISHED_SLOT);
    const slotIndex = currentPublishedSlot === 0 ? 1 : 0;
    return {
        transport,
        slotIndex,
        slotHeaderBase: getEnemyAISharedSlotHeaderBaseIndex(slotIndex),
        baseIndex: Array.isArray(transport.slotBases)
            ? transport.slotBases[slotIndex]
            : getEnemyAISharedSlotBaseIndex(slotIndex, transport.capacity),
        count: 0
    };
}

/**
 * 준비된 슬롯에 적 AI 결과 한 건을 기록합니다.
 * @param {{transport: object, slotIndex: number, slotHeaderBase: number, baseIndex: number, count: number}|null|undefined} writeState
 * @param {object|null|undefined} result
 * @returns {boolean}
 */
export function writeEnemyAISharedResult(writeState, result) {
    if (!writeState?.transport?.resultData || !Number.isInteger(result?.id)) {
        return false;
    }

    if (writeState.count >= normalizeEnemyAISharedCapacity(writeState.transport.capacity)) {
        return false;
    }

    const rowOffset = writeState.baseIndex + (writeState.count * ENEMY_AI_SHARED_RESULT_STRIDE);
    const data = writeState.transport.resultData;
    const state = result.enemyAIState && typeof result.enemyAIState === 'object'
        ? result.enemyAIState
        : null;

    data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.ID] = result.id;
    data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.ACC_X] = normalizeEnemyAISharedNumber(result.acc?.x, 0);
    data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.ACC_Y] = normalizeEnemyAISharedNumber(result.acc?.y, 0);
    data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.ACC_SPEED] = normalizeEnemyAISharedNumber(result.accSpeed, 0);
    data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.FLAGS] = getEnemyAISharedStateFlags(state);
    data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.DIR_X] = normalizeEnemyAISharedNumber(state?.dirX, 1);
    data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.DIR_Y] = normalizeEnemyAISharedNumber(state?.dirY, 0);
    data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.BASE_DESIRED_SPEED] = normalizeEnemyAISharedNumber(state?.baseDesiredSpeed, 40);
    data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.DESIRED_SPEED] = normalizeEnemyAISharedNumber(state?.desiredSpeed, 40);
    data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.BASE_ACCEL_RESPONSE] = normalizeEnemyAISharedNumber(state?.baseAccelResponse, 0);
    data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.ACCEL_RESPONSE] = normalizeEnemyAISharedNumber(state?.accelResponse, 0);
    data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.TARGET_X] = normalizeEnemyAISharedNumber(state?.targetX, Number.NaN);
    data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.TARGET_Y] = normalizeEnemyAISharedNumber(state?.targetY, Number.NaN);
    data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.LAST_DIRECT_PATH_WALLS_VERSION] = Number.isInteger(state?.lastDirectPathWallsVersion)
        ? state.lastDirectPathWallsVersion
        : -1;
    data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.LAST_DIRECT_PATH_PAD_BUCKET] = Number.isInteger(state?.lastDirectPathPadBucket)
        ? state.lastDirectPathPadBucket
        : -1;
    data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.LAST_DIRECT_PATH_START_CX] = Number.isInteger(state?.lastDirectPathStartCx)
        ? state.lastDirectPathStartCx
        : 0;
    data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.LAST_DIRECT_PATH_START_CY] = Number.isInteger(state?.lastDirectPathStartCy)
        ? state.lastDirectPathStartCy
        : 0;
    data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.LAST_DIRECT_PATH_TARGET_CX] = Number.isInteger(state?.lastDirectPathTargetCx)
        ? state.lastDirectPathTargetCx
        : 0;
    data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.LAST_DIRECT_PATH_TARGET_CY] = Number.isInteger(state?.lastDirectPathTargetCy)
        ? state.lastDirectPathTargetCy
        : 0;
    data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.ORBIT_DIRECTION] = state?.orbitDirection === -1 ? -1 : 1;
    data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.CHARGE_STATE] = getEnemyAISharedChargeStateCode(state?.chargeState);
    data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.CHARGE_COOLDOWN_REMAINING] = normalizeEnemyAISharedNumber(
        state?.chargeCooldownRemaining,
        0
    );
    data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.CHARGE_DURATION_REMAINING] = normalizeEnemyAISharedNumber(
        state?.chargeDurationRemaining,
        0
    );
    data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.CHARGE_RECOVER_REMAINING] = normalizeEnemyAISharedNumber(
        state?.chargeRecoverRemaining,
        0
    );
    data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.CHARGE_TARGET_X] = normalizeEnemyAISharedNumber(state?.chargeTargetX, 0);
    data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.CHARGE_TARGET_Y] = normalizeEnemyAISharedNumber(state?.chargeTargetY, 0);

    writeState.count++;
    return true;
}

/**
 * 기록이 끝난 슬롯을 publish합니다.
 * @param {{transport: object, slotIndex: number, slotHeaderBase: number, baseIndex: number, count: number}|null|undefined} writeState
 * @param {number|null|undefined} requestId
 * @param {number|null|undefined} wallsVersion
 * @param {number|null|undefined} enemyTopologyVersion
 * @returns {{slotIndex: number, resultCount: number, version: number}|null}
 */
export function commitEnemyAISharedResultWrite(writeState, requestId, wallsVersion, enemyTopologyVersion) {
    if (!writeState?.transport?.meta) {
        return null;
    }

    const meta = writeState.transport.meta;
    meta[writeState.slotHeaderBase + ENEMY_AI_SHARED_SLOT_INDEX.REQUEST_ID] = Number.isInteger(requestId) ? requestId : 0;
    meta[writeState.slotHeaderBase + ENEMY_AI_SHARED_SLOT_INDEX.WALLS_VERSION] = Number.isInteger(wallsVersion) ? wallsVersion : 0;
    meta[writeState.slotHeaderBase + ENEMY_AI_SHARED_SLOT_INDEX.ENEMY_TOPOLOGY_VERSION] = Number.isInteger(enemyTopologyVersion)
        ? enemyTopologyVersion
        : 0;
    meta[writeState.slotHeaderBase + ENEMY_AI_SHARED_SLOT_INDEX.RESULT_COUNT] = writeState.count;

    Atomics.store(meta, ENEMY_AI_SHARED_META_INDEX.PUBLISHED_SLOT, writeState.slotIndex);
    const version = Atomics.add(meta, ENEMY_AI_SHARED_META_INDEX.VERSION, 1) + 1;
    return {
        slotIndex: writeState.slotIndex,
        resultCount: writeState.count,
        version
    };
}

/**
 * 현재 publish된 결과 슬롯 상태를 읽기 좋은 형태로 반환합니다.
 * @param {object|null|undefined} transport
 * @param {object|null|undefined} [outState=null]
 * @returns {object|null}
 */
export function readEnemyAISharedResultState(transport, outState = null) {
    if (!transport?.meta || !(transport.resultData instanceof Float32Array)) {
        return null;
    }

    const slotIndex = Atomics.load(transport.meta, ENEMY_AI_SHARED_META_INDEX.PUBLISHED_SLOT);
    const slotHeaderBase = getEnemyAISharedSlotHeaderBaseIndex(slotIndex);
    const nextState = outState && typeof outState === 'object'
        ? outState
        : {};

    nextState.slotIndex = slotIndex;
    nextState.version = Atomics.load(transport.meta, ENEMY_AI_SHARED_META_INDEX.VERSION);
    nextState.requestId = Atomics.load(
        transport.meta,
        slotHeaderBase + ENEMY_AI_SHARED_SLOT_INDEX.REQUEST_ID
    );
    nextState.wallsVersion = Atomics.load(
        transport.meta,
        slotHeaderBase + ENEMY_AI_SHARED_SLOT_INDEX.WALLS_VERSION
    );
    nextState.enemyTopologyVersion = Atomics.load(
        transport.meta,
        slotHeaderBase + ENEMY_AI_SHARED_SLOT_INDEX.ENEMY_TOPOLOGY_VERSION
    );
    nextState.resultCount = Atomics.load(
        transport.meta,
        slotHeaderBase + ENEMY_AI_SHARED_SLOT_INDEX.RESULT_COUNT
    );
    nextState.resultBase = Array.isArray(transport.slotBases)
        ? transport.slotBases[slotIndex]
        : getEnemyAISharedSlotBaseIndex(slotIndex, transport.capacity);
    nextState.resultData = transport.resultData;
    return nextState;
}

/**
 * 공유 결과 슬롯의 한 행을 일반 결과 객체로 복원합니다.
 * @param {object|null|undefined} sharedState
 * @param {number} index
 * @param {object|null|undefined} [outResult=null]
 * @returns {{id: number, acc: {x: number, y: number}, accSpeed: number, enemyAIState: object}|null}
 */
export function readEnemyAISharedResultAt(sharedState, index, outResult = null) {
    if (!sharedState?.resultData || !Number.isInteger(index) || index < 0 || index >= sharedState.resultCount) {
        return null;
    }

    const rowOffset = sharedState.resultBase + (index * ENEMY_AI_SHARED_RESULT_STRIDE);
    const data = sharedState.resultData;
    const result = outResult && typeof outResult === 'object'
        ? outResult
        : {};
    const acc = result.acc && typeof result.acc === 'object'
        ? result.acc
        : { x: 0, y: 0 };
    const state = result.enemyAIState && typeof result.enemyAIState === 'object'
        ? result.enemyAIState
        : {};
    const flags = Math.round(normalizeEnemyAISharedNumber(data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.FLAGS], 0));

    result.id = Math.round(normalizeEnemyAISharedNumber(data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.ID], -1));
    acc.x = normalizeEnemyAISharedNumber(data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.ACC_X], 0);
    acc.y = normalizeEnemyAISharedNumber(data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.ACC_Y], 0);
    result.acc = acc;
    result.accSpeed = normalizeEnemyAISharedNumber(data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.ACC_SPEED], 0);

    state.__initialized = (flags & ENEMY_AI_SHARED_FLAGS.INITIALIZED) !== 0;
    state.__schemaVersion = ENEMY_AI_STATE_SCHEMA_VERSION;
    state.dirX = normalizeEnemyAISharedNumber(data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.DIR_X], 1);
    state.dirY = normalizeEnemyAISharedNumber(data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.DIR_Y], 0);
    state.baseDesiredSpeed = normalizeEnemyAISharedNumber(
        data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.BASE_DESIRED_SPEED],
        40
    );
    state.desiredSpeed = normalizeEnemyAISharedNumber(
        data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.DESIRED_SPEED],
        state.baseDesiredSpeed
    );
    state.baseAccelResponse = normalizeEnemyAISharedNumber(
        data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.BASE_ACCEL_RESPONSE],
        0
    );
    state.accelResponse = normalizeEnemyAISharedNumber(
        data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.ACCEL_RESPONSE],
        state.baseAccelResponse
    );
    state.targetX = Number.isFinite(data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.TARGET_X])
        ? data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.TARGET_X]
        : Number.NaN;
    state.targetY = Number.isFinite(data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.TARGET_Y])
        ? data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.TARGET_Y]
        : Number.NaN;
    state.hasDirectPathResult = (flags & ENEMY_AI_SHARED_FLAGS.HAS_DIRECT_PATH_RESULT) !== 0;
    state.lastDirectPath = (flags & ENEMY_AI_SHARED_FLAGS.LAST_DIRECT_PATH) !== 0;
    state.lastDirectPathWallsVersion = Math.round(normalizeEnemyAISharedNumber(
        data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.LAST_DIRECT_PATH_WALLS_VERSION],
        -1
    ));
    state.lastDirectPathPadBucket = Math.round(normalizeEnemyAISharedNumber(
        data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.LAST_DIRECT_PATH_PAD_BUCKET],
        -1
    ));
    state.lastDirectPathStartCx = Math.round(normalizeEnemyAISharedNumber(
        data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.LAST_DIRECT_PATH_START_CX],
        0
    ));
    state.lastDirectPathStartCy = Math.round(normalizeEnemyAISharedNumber(
        data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.LAST_DIRECT_PATH_START_CY],
        0
    ));
    state.lastDirectPathTargetCx = Math.round(normalizeEnemyAISharedNumber(
        data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.LAST_DIRECT_PATH_TARGET_CX],
        0
    ));
    state.lastDirectPathTargetCy = Math.round(normalizeEnemyAISharedNumber(
        data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.LAST_DIRECT_PATH_TARGET_CY],
        0
    ));
    state.orbitDirection = normalizeEnemyAISharedNumber(
        data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.ORBIT_DIRECTION],
        1
    ) < 0 ? -1 : 1;
    state.chargeState = getEnemyAISharedChargeStateByCode(
        data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.CHARGE_STATE]
    );
    state.chargeCooldownRemaining = Math.max(0, normalizeEnemyAISharedNumber(
        data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.CHARGE_COOLDOWN_REMAINING],
        0
    ));
    state.chargeDurationRemaining = Math.max(0, normalizeEnemyAISharedNumber(
        data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.CHARGE_DURATION_REMAINING],
        0
    ));
    state.chargeRecoverRemaining = Math.max(0, normalizeEnemyAISharedNumber(
        data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.CHARGE_RECOVER_REMAINING],
        0
    ));
    state.chargeTargetX = normalizeEnemyAISharedNumber(
        data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.CHARGE_TARGET_X],
        0
    );
    state.chargeTargetY = normalizeEnemyAISharedNumber(
        data[rowOffset + ENEMY_AI_SHARED_RESULT_INDEX.CHARGE_TARGET_Y],
        0
    );

    result.enemyAIState = state;
    return result;
}
