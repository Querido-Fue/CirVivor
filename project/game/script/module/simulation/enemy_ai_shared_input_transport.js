const ENEMY_AI_SHARED_INPUT_DEFAULT_ENEMY_CAPACITY = 16384;
const ENEMY_AI_SHARED_INPUT_DEFAULT_WALL_CAPACITY = 2048;
const ENEMY_AI_SHARED_INPUT_HEADER_LENGTH = 8;
const ENEMY_AI_SHARED_INPUT_ENEMY_INT_STRIDE = 4;
const ENEMY_AI_SHARED_INPUT_ENEMY_FLOAT_STRIDE = 9;
const ENEMY_AI_SHARED_INPUT_WALL_INT_STRIDE = 2;
const ENEMY_AI_SHARED_INPUT_WALL_FLOAT_STRIDE = 4;
const ENEMY_AI_SHARED_INPUT_PLAYER_FLOAT_STRIDE = 2;
const ENEMY_AI_SHARED_INPUT_LAYOUT_VERSION = 3;

const ENEMY_AI_SHARED_INPUT_HEADER_INDEX = Object.freeze({
    LAYOUT_VERSION: 0,
    SEQUENCE: 1,
    REQUEST_ID: 2,
    ENEMY_COUNT: 3,
    WALL_COUNT: 4,
    PLAYER_ACTIVE: 5,
    WALLS_VERSION: 6,
    ENEMY_TOPOLOGY_VERSION: 7
});

const ENEMY_AI_SHARED_INPUT_ENEMY_INT_INDEX = Object.freeze({
    ID: 0,
    TYPE_CODE: 1,
    ACTIVE: 2,
    SHOULD_UPDATE_DECISION: 3
});

const ENEMY_AI_SHARED_INPUT_ENEMY_FLOAT_INDEX = Object.freeze({
    POSITION_X: 0,
    POSITION_Y: 1,
    SPEED_X: 2,
    SPEED_Y: 3,
    ACC_SPEED: 4,
    RENDER_HEIGHT_PX: 5,
    NAVIGATION_RADIUS_PX: 6,
    NAVIGATION_HALF_WIDTH_PX: 7,
    NAVIGATION_HALF_HEIGHT_PX: 8
});

const ENEMY_AI_SHARED_INPUT_WALL_INT_INDEX = Object.freeze({
    ACTIVE: 0,
    ORIGIN_CODE: 1
});

const ENEMY_AI_SHARED_INPUT_WALL_FLOAT_INDEX = Object.freeze({
    X: 0,
    Y: 1,
    W: 2,
    H: 3
});

const ENEMY_AI_SHARED_INPUT_ORIGIN_CODE = Object.freeze({
    TOP_LEFT: 0,
    CENTER: 1
});

/**
 * 적 AI 입력 SharedArrayBuffer transport 사용 가능 여부를 반환합니다.
 * @returns {boolean}
 */
export function isEnemyAISharedInputTransportSupported() {
    return typeof SharedArrayBuffer === 'function' && typeof Atomics === 'object';
}

/**
 * capacity 값을 안전한 정수로 정규화합니다.
 * @param {number|null|undefined} capacity
 * @param {number} fallback
 * @returns {number}
 */
function normalizeEnemyAISharedInputCapacity(capacity, fallback) {
    return Number.isInteger(capacity) && capacity > 0 ? capacity : fallback;
}

/**
 * 수치 값을 공유 입력 버퍼 기록용 값으로 정규화합니다.
 * @param {number|null|undefined} value
 * @param {number} [fallback=0]
 * @returns {number}
 */
function normalizeEnemyAISharedInputNumber(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
}

/**
 * 좌표 객체의 x/y 값을 안전하게 읽습니다.
 * @param {{x?: number, y?: number}|null|undefined} point
 * @returns {{x: number, y: number}}
 */
function normalizeEnemyAISharedInputPoint(point) {
    return {
        x: normalizeEnemyAISharedInputNumber(point?.x, 0),
        y: normalizeEnemyAISharedInputNumber(point?.y, 0)
    };
}

/**
 * origin 문자열을 공유 입력 코드로 변환합니다.
 * @param {string|null|undefined} origin
 * @returns {number}
 */
function getEnemyAISharedInputOriginCode(origin) {
    return origin === 'center'
        ? ENEMY_AI_SHARED_INPUT_ORIGIN_CODE.CENTER
        : ENEMY_AI_SHARED_INPUT_ORIGIN_CODE.TOP_LEFT;
}

/**
 * 공유 입력 origin 코드를 기존 wall origin 문자열로 복원합니다.
 * @param {number|null|undefined} originCode
 * @returns {string}
 */
function getEnemyAISharedInputOriginByCode(originCode) {
    return originCode === ENEMY_AI_SHARED_INPUT_ORIGIN_CODE.CENTER ? 'center' : 'topleft';
}

/**
 * 적 타입 문자열을 이번 스냅샷의 타입 테이블 코드로 변환합니다.
 * @param {string|null|undefined} type
 * @param {string[]} typeTable
 * @param {Map<string, number>} typeCodeByKey
 * @returns {number}
 */
function getEnemyAISharedInputTypeCode(type, typeTable, typeCodeByKey) {
    const typeKey = typeof type === 'string' && type.length > 0 ? type : 'square';
    if (typeCodeByKey.has(typeKey)) {
        return typeCodeByKey.get(typeKey);
    }

    const typeCode = typeTable.length;
    typeTable.push(typeKey);
    typeCodeByKey.set(typeKey, typeCode);
    return typeCode;
}

/**
 * 공유 입력 header 버퍼를 생성합니다.
 * @returns {SharedArrayBuffer}
 */
function createEnemyAISharedInputHeaderBuffer() {
    return new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * ENEMY_AI_SHARED_INPUT_HEADER_LENGTH);
}

/**
 * 공유 입력 적 정수 버퍼를 생성합니다.
 * @param {number} enemyCapacity
 * @returns {SharedArrayBuffer}
 */
function createEnemyAISharedInputEnemyIntBuffer(enemyCapacity) {
    return new SharedArrayBuffer(
        Int32Array.BYTES_PER_ELEMENT
        * enemyCapacity
        * ENEMY_AI_SHARED_INPUT_ENEMY_INT_STRIDE
    );
}

/**
 * 공유 입력 적 실수 버퍼를 생성합니다.
 * @param {number} enemyCapacity
 * @returns {SharedArrayBuffer}
 */
function createEnemyAISharedInputEnemyFloatBuffer(enemyCapacity) {
    return new SharedArrayBuffer(
        Float32Array.BYTES_PER_ELEMENT
        * enemyCapacity
        * ENEMY_AI_SHARED_INPUT_ENEMY_FLOAT_STRIDE
    );
}

/**
 * 공유 입력 벽 정수 버퍼를 생성합니다.
 * @param {number} wallCapacity
 * @returns {SharedArrayBuffer}
 */
function createEnemyAISharedInputWallIntBuffer(wallCapacity) {
    return new SharedArrayBuffer(
        Int32Array.BYTES_PER_ELEMENT
        * wallCapacity
        * ENEMY_AI_SHARED_INPUT_WALL_INT_STRIDE
    );
}

/**
 * 공유 입력 벽 실수 버퍼를 생성합니다.
 * @param {number} wallCapacity
 * @returns {SharedArrayBuffer}
 */
function createEnemyAISharedInputWallFloatBuffer(wallCapacity) {
    return new SharedArrayBuffer(
        Float32Array.BYTES_PER_ELEMENT
        * wallCapacity
        * ENEMY_AI_SHARED_INPUT_WALL_FLOAT_STRIDE
    );
}

/**
 * 공유 입력 플레이어 실수 버퍼를 생성합니다.
 * @returns {SharedArrayBuffer}
 */
function createEnemyAISharedInputPlayerFloatBuffer() {
    return new SharedArrayBuffer(
        Float32Array.BYTES_PER_ELEMENT * ENEMY_AI_SHARED_INPUT_PLAYER_FLOAT_STRIDE
    );
}

/**
 * 적 AI 입력 transport를 생성합니다.
 * @param {{enemyCapacity?: number, wallCapacity?: number}} [options={}]
 * @returns {object|null}
 */
export function createEnemyAISharedInputTransport(options = {}) {
    if (!isEnemyAISharedInputTransportSupported()) {
        return null;
    }

    const enemyCapacity = normalizeEnemyAISharedInputCapacity(
        options.enemyCapacity,
        ENEMY_AI_SHARED_INPUT_DEFAULT_ENEMY_CAPACITY
    );
    const wallCapacity = normalizeEnemyAISharedInputCapacity(
        options.wallCapacity,
        ENEMY_AI_SHARED_INPUT_DEFAULT_WALL_CAPACITY
    );
    return attachEnemyAISharedInputTransport({
        headerBuffer: createEnemyAISharedInputHeaderBuffer(),
        playerFloatBuffer: createEnemyAISharedInputPlayerFloatBuffer(),
        enemyIntBuffer: createEnemyAISharedInputEnemyIntBuffer(enemyCapacity),
        enemyFloatBuffer: createEnemyAISharedInputEnemyFloatBuffer(enemyCapacity),
        wallIntBuffer: createEnemyAISharedInputWallIntBuffer(wallCapacity),
        wallFloatBuffer: createEnemyAISharedInputWallFloatBuffer(wallCapacity),
        enemyCapacity,
        wallCapacity
    });
}

/**
 * raw buffer 세트를 적 AI 입력 transport/view 객체로 감쌉니다.
 * @param {object|null|undefined} buffers
 * @returns {object|null}
 */
export function attachEnemyAISharedInputTransport(buffers) {
    if (!buffers
        || !(buffers.headerBuffer instanceof SharedArrayBuffer)
        || !(buffers.playerFloatBuffer instanceof SharedArrayBuffer)
        || !(buffers.enemyIntBuffer instanceof SharedArrayBuffer)
        || !(buffers.enemyFloatBuffer instanceof SharedArrayBuffer)
        || !(buffers.wallIntBuffer instanceof SharedArrayBuffer)
        || !(buffers.wallFloatBuffer instanceof SharedArrayBuffer)) {
        return null;
    }

    const enemyCapacity = normalizeEnemyAISharedInputCapacity(
        buffers.enemyCapacity,
        ENEMY_AI_SHARED_INPUT_DEFAULT_ENEMY_CAPACITY
    );
    const wallCapacity = normalizeEnemyAISharedInputCapacity(
        buffers.wallCapacity,
        ENEMY_AI_SHARED_INPUT_DEFAULT_WALL_CAPACITY
    );
    return {
        headerBuffer: buffers.headerBuffer,
        playerFloatBuffer: buffers.playerFloatBuffer,
        enemyIntBuffer: buffers.enemyIntBuffer,
        enemyFloatBuffer: buffers.enemyFloatBuffer,
        wallIntBuffer: buffers.wallIntBuffer,
        wallFloatBuffer: buffers.wallFloatBuffer,
        enemyCapacity,
        wallCapacity,
        header: new Int32Array(buffers.headerBuffer),
        playerFloatData: new Float32Array(buffers.playerFloatBuffer),
        enemyIntData: new Int32Array(buffers.enemyIntBuffer),
        enemyFloatData: new Float32Array(buffers.enemyFloatBuffer),
        wallIntData: new Int32Array(buffers.wallIntBuffer),
        wallFloatData: new Float32Array(buffers.wallFloatBuffer)
    };
}

/**
 * worker bootstrap용 raw 입력 buffer 세트를 추출합니다.
 * @param {object|null|undefined} transport
 * @returns {object|null}
 */
export function exportEnemyAISharedInputTransportBuffers(transport) {
    if (!transport) {
        return null;
    }

    return {
        headerBuffer: transport.headerBuffer,
        playerFloatBuffer: transport.playerFloatBuffer,
        enemyIntBuffer: transport.enemyIntBuffer,
        enemyFloatBuffer: transport.enemyFloatBuffer,
        wallIntBuffer: transport.wallIntBuffer,
        wallFloatBuffer: transport.wallFloatBuffer,
        enemyCapacity: normalizeEnemyAISharedInputCapacity(
            transport.enemyCapacity,
            ENEMY_AI_SHARED_INPUT_DEFAULT_ENEMY_CAPACITY
        ),
        wallCapacity: normalizeEnemyAISharedInputCapacity(
            transport.wallCapacity,
            ENEMY_AI_SHARED_INPUT_DEFAULT_WALL_CAPACITY
        )
    };
}

/**
 * 현재 AI 요청 payload를 공유 입력 버퍼에 기록합니다.
 * @param {object|null|undefined} transport
 * @param {object|null|undefined} payload
 * @returns {{descriptor: object, typeTable: string[], enemyCount: number, wallCount: number, truncated: boolean}|null}
 */
export function writeEnemyAISharedInputSnapshot(transport, payload) {
    if (!transport?.header
        || !(transport.enemyIntData instanceof Int32Array)
        || !(transport.enemyFloatData instanceof Float32Array)
        || !(transport.wallIntData instanceof Int32Array)
        || !(transport.wallFloatData instanceof Float32Array)
        || !(transport.playerFloatData instanceof Float32Array)) {
        return null;
    }

    const enemies = Array.isArray(payload?.enemies) ? payload.enemies : [];
    const walls = Array.isArray(payload?.walls) ? payload.walls : [];
    const enemyCount = Math.min(enemies.length, transport.enemyCapacity);
    const wallCount = Math.min(walls.length, transport.wallCapacity);
    const typeTable = [];
    const typeCodeByKey = new Map();

    for (let i = 0; i < enemyCount; i++) {
        const enemy = enemies[i];
        const intOffset = i * ENEMY_AI_SHARED_INPUT_ENEMY_INT_STRIDE;
        const floatOffset = i * ENEMY_AI_SHARED_INPUT_ENEMY_FLOAT_STRIDE;
        const position = normalizeEnemyAISharedInputPoint(enemy?.position);
        const speed = normalizeEnemyAISharedInputPoint(enemy?.speed);
        const enemyId = Number.isInteger(enemy?.id) ? enemy.id : -1;
        const active = enemy && enemy.active !== false && enemyId >= 0;
        const typeCode = getEnemyAISharedInputTypeCode(enemy?.type, typeTable, typeCodeByKey);

        transport.enemyIntData[intOffset + ENEMY_AI_SHARED_INPUT_ENEMY_INT_INDEX.ID] = enemyId;
        transport.enemyIntData[intOffset + ENEMY_AI_SHARED_INPUT_ENEMY_INT_INDEX.TYPE_CODE] = typeCode;
        transport.enemyIntData[intOffset + ENEMY_AI_SHARED_INPUT_ENEMY_INT_INDEX.ACTIVE] = active ? 1 : 0;
        transport.enemyIntData[intOffset + ENEMY_AI_SHARED_INPUT_ENEMY_INT_INDEX.SHOULD_UPDATE_DECISION] =
            enemy?.shouldUpdateDecision === true ? 1 : 0;

        transport.enemyFloatData[floatOffset + ENEMY_AI_SHARED_INPUT_ENEMY_FLOAT_INDEX.POSITION_X] = position.x;
        transport.enemyFloatData[floatOffset + ENEMY_AI_SHARED_INPUT_ENEMY_FLOAT_INDEX.POSITION_Y] = position.y;
        transport.enemyFloatData[floatOffset + ENEMY_AI_SHARED_INPUT_ENEMY_FLOAT_INDEX.SPEED_X] = speed.x;
        transport.enemyFloatData[floatOffset + ENEMY_AI_SHARED_INPUT_ENEMY_FLOAT_INDEX.SPEED_Y] = speed.y;
        transport.enemyFloatData[floatOffset + ENEMY_AI_SHARED_INPUT_ENEMY_FLOAT_INDEX.ACC_SPEED] =
            normalizeEnemyAISharedInputNumber(enemy?.accSpeed, 0);
        transport.enemyFloatData[floatOffset + ENEMY_AI_SHARED_INPUT_ENEMY_FLOAT_INDEX.RENDER_HEIGHT_PX] =
            normalizeEnemyAISharedInputNumber(enemy?.renderHeightPx, 24);
        transport.enemyFloatData[floatOffset + ENEMY_AI_SHARED_INPUT_ENEMY_FLOAT_INDEX.NAVIGATION_RADIUS_PX] =
            normalizeEnemyAISharedInputNumber(enemy?.navigationRadiusPx, 0);
        transport.enemyFloatData[floatOffset + ENEMY_AI_SHARED_INPUT_ENEMY_FLOAT_INDEX.NAVIGATION_HALF_WIDTH_PX] =
            normalizeEnemyAISharedInputNumber(enemy?.navigationHalfWidthPx, 0);
        transport.enemyFloatData[floatOffset + ENEMY_AI_SHARED_INPUT_ENEMY_FLOAT_INDEX.NAVIGATION_HALF_HEIGHT_PX] =
            normalizeEnemyAISharedInputNumber(enemy?.navigationHalfHeightPx, 0);
    }

    for (let i = 0; i < wallCount; i++) {
        const wall = walls[i];
        const intOffset = i * ENEMY_AI_SHARED_INPUT_WALL_INT_STRIDE;
        const floatOffset = i * ENEMY_AI_SHARED_INPUT_WALL_FLOAT_STRIDE;

        transport.wallIntData[intOffset + ENEMY_AI_SHARED_INPUT_WALL_INT_INDEX.ACTIVE] =
            wall && wall.active !== false ? 1 : 0;
        transport.wallIntData[intOffset + ENEMY_AI_SHARED_INPUT_WALL_INT_INDEX.ORIGIN_CODE] =
            getEnemyAISharedInputOriginCode(wall?.origin);
        transport.wallFloatData[floatOffset + ENEMY_AI_SHARED_INPUT_WALL_FLOAT_INDEX.X] =
            normalizeEnemyAISharedInputNumber(wall?.x, 0);
        transport.wallFloatData[floatOffset + ENEMY_AI_SHARED_INPUT_WALL_FLOAT_INDEX.Y] =
            normalizeEnemyAISharedInputNumber(wall?.y, 0);
        transport.wallFloatData[floatOffset + ENEMY_AI_SHARED_INPUT_WALL_FLOAT_INDEX.W] =
            normalizeEnemyAISharedInputNumber(wall?.w, 0);
        transport.wallFloatData[floatOffset + ENEMY_AI_SHARED_INPUT_WALL_FLOAT_INDEX.H] =
            normalizeEnemyAISharedInputNumber(wall?.h, 0);
    }

    const player = payload?.player && typeof payload.player === 'object' ? payload.player : null;
    const playerPosition = normalizeEnemyAISharedInputPoint(player?.position);
    transport.playerFloatData[0] = playerPosition.x;
    transport.playerFloatData[1] = playerPosition.y;

    Atomics.store(transport.header, ENEMY_AI_SHARED_INPUT_HEADER_INDEX.LAYOUT_VERSION, ENEMY_AI_SHARED_INPUT_LAYOUT_VERSION);
    Atomics.store(
        transport.header,
        ENEMY_AI_SHARED_INPUT_HEADER_INDEX.REQUEST_ID,
        Number.isInteger(payload?.requestId) ? payload.requestId : 0
    );
    Atomics.store(transport.header, ENEMY_AI_SHARED_INPUT_HEADER_INDEX.ENEMY_COUNT, enemyCount);
    Atomics.store(transport.header, ENEMY_AI_SHARED_INPUT_HEADER_INDEX.WALL_COUNT, wallCount);
    Atomics.store(
        transport.header,
        ENEMY_AI_SHARED_INPUT_HEADER_INDEX.PLAYER_ACTIVE,
        player && player.active !== false ? 1 : 0
    );
    Atomics.store(
        transport.header,
        ENEMY_AI_SHARED_INPUT_HEADER_INDEX.WALLS_VERSION,
        Number.isInteger(payload?.wallsVersion) ? payload.wallsVersion : 0
    );
    Atomics.store(
        transport.header,
        ENEMY_AI_SHARED_INPUT_HEADER_INDEX.ENEMY_TOPOLOGY_VERSION,
        Number.isInteger(payload?.enemyTopologyVersion) ? payload.enemyTopologyVersion : 0
    );
    const sequence = Atomics.add(transport.header, ENEMY_AI_SHARED_INPUT_HEADER_INDEX.SEQUENCE, 1) + 1;

    return {
        descriptor: {
            sharedInput: true,
            inputSequence: sequence,
            requestId: Number.isInteger(payload?.requestId) ? payload.requestId : 0,
            enemyCount,
            wallCount,
            wallsVersion: Number.isInteger(payload?.wallsVersion) ? payload.wallsVersion : 0,
            enemyTopologyVersion: Number.isInteger(payload?.enemyTopologyVersion)
                ? payload.enemyTopologyVersion
                : 0
        },
        typeTable,
        enemyCount,
        wallCount,
        truncated: enemyCount !== enemies.length || wallCount !== walls.length
    };
}

/**
 * 공유 입력 header가 메시지 descriptor와 일치하는지 확인합니다.
 * @param {object|null|undefined} transport
 * @param {object|null|undefined} descriptor
 * @returns {boolean}
 */
function isEnemyAISharedInputDescriptorCurrent(transport, descriptor) {
    if (!transport?.header || !descriptor?.sharedInput) {
        return false;
    }

    const layoutVersion = Atomics.load(transport.header, ENEMY_AI_SHARED_INPUT_HEADER_INDEX.LAYOUT_VERSION);
    const sequence = Atomics.load(transport.header, ENEMY_AI_SHARED_INPUT_HEADER_INDEX.SEQUENCE);
    const requestId = Atomics.load(transport.header, ENEMY_AI_SHARED_INPUT_HEADER_INDEX.REQUEST_ID);
    return layoutVersion === ENEMY_AI_SHARED_INPUT_LAYOUT_VERSION
        && sequence === descriptor.inputSequence
        && requestId === descriptor.requestId;
}

/**
 * 공유 입력 버퍼에서 플레이어 요약을 읽습니다.
 * @param {object} transport
 * @returns {{active: boolean, position: {x: number, y: number}}}
 */
function readEnemyAISharedInputPlayer(transport) {
    const playerActive = Atomics.load(
        transport.header,
        ENEMY_AI_SHARED_INPUT_HEADER_INDEX.PLAYER_ACTIVE
    ) !== 0;
    return {
        active: playerActive,
        position: {
            x: normalizeEnemyAISharedInputNumber(transport.playerFloatData[0], 0),
            y: normalizeEnemyAISharedInputNumber(transport.playerFloatData[1], 0)
        }
    };
}

/**
 * 공유 입력 버퍼에서 벽 요약 목록을 읽습니다.
 * @param {object} transport
 * @param {number} wallCount
 * @returns {object[]}
 */
function readEnemyAISharedInputWalls(transport, wallCount) {
    const walls = [];
    for (let i = 0; i < wallCount; i++) {
        const intOffset = i * ENEMY_AI_SHARED_INPUT_WALL_INT_STRIDE;
        const floatOffset = i * ENEMY_AI_SHARED_INPUT_WALL_FLOAT_STRIDE;
        walls.push({
            active: transport.wallIntData[intOffset + ENEMY_AI_SHARED_INPUT_WALL_INT_INDEX.ACTIVE] !== 0,
            x: normalizeEnemyAISharedInputNumber(
                transport.wallFloatData[floatOffset + ENEMY_AI_SHARED_INPUT_WALL_FLOAT_INDEX.X],
                0
            ),
            y: normalizeEnemyAISharedInputNumber(
                transport.wallFloatData[floatOffset + ENEMY_AI_SHARED_INPUT_WALL_FLOAT_INDEX.Y],
                0
            ),
            w: normalizeEnemyAISharedInputNumber(
                transport.wallFloatData[floatOffset + ENEMY_AI_SHARED_INPUT_WALL_FLOAT_INDEX.W],
                0
            ),
            h: normalizeEnemyAISharedInputNumber(
                transport.wallFloatData[floatOffset + ENEMY_AI_SHARED_INPUT_WALL_FLOAT_INDEX.H],
                0
            ),
            origin: getEnemyAISharedInputOriginByCode(
                transport.wallIntData[intOffset + ENEMY_AI_SHARED_INPUT_WALL_INT_INDEX.ORIGIN_CODE]
            )
        });
    }
    return walls;
}

/**
 * 공유 입력 버퍼에서 적 요약 목록을 읽습니다.
 * @param {object} transport
 * @param {number} enemyCount
 * @param {string[]} typeTable
 * @returns {object[]}
 */
function readEnemyAISharedInputEnemies(transport, enemyCount, typeTable) {
    const enemies = [];
    for (let i = 0; i < enemyCount; i++) {
        const intOffset = i * ENEMY_AI_SHARED_INPUT_ENEMY_INT_STRIDE;
        const floatOffset = i * ENEMY_AI_SHARED_INPUT_ENEMY_FLOAT_STRIDE;
        const typeCode = transport.enemyIntData[intOffset + ENEMY_AI_SHARED_INPUT_ENEMY_INT_INDEX.TYPE_CODE];
        const type = typeof typeTable[typeCode] === 'string' ? typeTable[typeCode] : 'square';

        enemies.push({
            id: transport.enemyIntData[intOffset + ENEMY_AI_SHARED_INPUT_ENEMY_INT_INDEX.ID],
            active: transport.enemyIntData[intOffset + ENEMY_AI_SHARED_INPUT_ENEMY_INT_INDEX.ACTIVE] !== 0,
            type,
            position: {
                x: normalizeEnemyAISharedInputNumber(
                    transport.enemyFloatData[floatOffset + ENEMY_AI_SHARED_INPUT_ENEMY_FLOAT_INDEX.POSITION_X],
                    0
                ),
                y: normalizeEnemyAISharedInputNumber(
                    transport.enemyFloatData[floatOffset + ENEMY_AI_SHARED_INPUT_ENEMY_FLOAT_INDEX.POSITION_Y],
                    0
                )
            },
            speed: {
                x: normalizeEnemyAISharedInputNumber(
                    transport.enemyFloatData[floatOffset + ENEMY_AI_SHARED_INPUT_ENEMY_FLOAT_INDEX.SPEED_X],
                    0
                ),
                y: normalizeEnemyAISharedInputNumber(
                    transport.enemyFloatData[floatOffset + ENEMY_AI_SHARED_INPUT_ENEMY_FLOAT_INDEX.SPEED_Y],
                    0
                )
            },
            accSpeed: normalizeEnemyAISharedInputNumber(
                transport.enemyFloatData[floatOffset + ENEMY_AI_SHARED_INPUT_ENEMY_FLOAT_INDEX.ACC_SPEED],
                0
            ),
            renderHeightPx: normalizeEnemyAISharedInputNumber(
                transport.enemyFloatData[floatOffset + ENEMY_AI_SHARED_INPUT_ENEMY_FLOAT_INDEX.RENDER_HEIGHT_PX],
                24
            ),
            navigationRadiusPx: normalizeEnemyAISharedInputNumber(
                transport.enemyFloatData[floatOffset + ENEMY_AI_SHARED_INPUT_ENEMY_FLOAT_INDEX.NAVIGATION_RADIUS_PX],
                0
            ),
            navigationHalfWidthPx: normalizeEnemyAISharedInputNumber(
                transport.enemyFloatData[floatOffset + ENEMY_AI_SHARED_INPUT_ENEMY_FLOAT_INDEX.NAVIGATION_HALF_WIDTH_PX],
                0
            ),
            navigationHalfHeightPx: normalizeEnemyAISharedInputNumber(
                transport.enemyFloatData[floatOffset + ENEMY_AI_SHARED_INPUT_ENEMY_FLOAT_INDEX.NAVIGATION_HALF_HEIGHT_PX],
                0
            ),
            shouldUpdateDecision:
                transport.enemyIntData[intOffset + ENEMY_AI_SHARED_INPUT_ENEMY_INT_INDEX.SHOULD_UPDATE_DECISION] !== 0,
            enemyAIState: null
        });
    }
    return enemies;
}

/**
 * 공유 입력 버퍼에서 AI 계산용 스냅샷을 읽습니다.
 * @param {object|null|undefined} transport
 * @param {object|null|undefined} descriptor
 * @param {string[]} [typeTable=[]]
 * @returns {{player: object, walls: object[], enemies: object[], inputSequence: number, enemyCount: number, wallCount: number}|null}
 */
export function readEnemyAISharedInputSnapshot(transport, descriptor, typeTable = []) {
    if (!transport?.header
        || !isEnemyAISharedInputDescriptorCurrent(transport, descriptor)
        || !(transport.enemyIntData instanceof Int32Array)
        || !(transport.enemyFloatData instanceof Float32Array)
        || !(transport.wallIntData instanceof Int32Array)
        || !(transport.wallFloatData instanceof Float32Array)
        || !(transport.playerFloatData instanceof Float32Array)) {
        return null;
    }

    const enemyCount = Math.max(0, Math.min(
        Atomics.load(transport.header, ENEMY_AI_SHARED_INPUT_HEADER_INDEX.ENEMY_COUNT),
        Number.isInteger(descriptor.enemyCount) ? descriptor.enemyCount : 0,
        transport.enemyCapacity
    ));
    const wallCount = Math.max(0, Math.min(
        Atomics.load(transport.header, ENEMY_AI_SHARED_INPUT_HEADER_INDEX.WALL_COUNT),
        Number.isInteger(descriptor.wallCount) ? descriptor.wallCount : 0,
        transport.wallCapacity
    ));
    return {
        player: readEnemyAISharedInputPlayer(transport),
        walls: readEnemyAISharedInputWalls(transport, wallCount),
        enemies: readEnemyAISharedInputEnemies(
            transport,
            enemyCount,
            Array.isArray(typeTable) ? typeTable : []
        ),
        inputSequence: Atomics.load(transport.header, ENEMY_AI_SHARED_INPUT_HEADER_INDEX.SEQUENCE),
        enemyCount,
        wallCount
    };
}
