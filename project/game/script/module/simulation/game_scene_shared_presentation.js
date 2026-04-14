const SHARED_PRESENTATION_SLOT_COUNT = 2;
const SHARED_PRESENTATION_GLOBAL_HEADER_LENGTH = 4;
const SHARED_PRESENTATION_SLOT_HEADER_STRIDE = 11;

const SHARED_PRESENTATION_META_INDEX = Object.freeze({
    PUBLISHED_SLOT: 0,
    VERSION: 1,
    LAST_FRAME_ID: 2,
    RESERVED: 3
});

const SHARED_PRESENTATION_SLOT_INDEX = Object.freeze({
    STATIC_WALL_COUNT: 0,
    BOX_WALL_COUNT: 1,
    PROJECTILE_COUNT: 2,
    ENEMY_COUNT: 3,
    PLAYER_ACTIVE: 4,
    COLLISION_CHECK_COUNT: 5,
    AABB_PASS_COUNT: 6,
    AABB_REJECT_COUNT: 7,
    CIRCLE_PASS_COUNT: 8,
    CIRCLE_REJECT_COUNT: 9,
    POLYGON_CHECKS: 10
});

export const GAME_SCENE_SHARED_PRESENTATION_STORAGE_TYPE = 'sharedGameScenePresentation';
export const GAME_SCENE_SHARED_PRESENTATION_CAPACITY = Object.freeze({
    STATIC_WALLS: 64,
    BOX_WALLS: 2048,
    PROJECTILES: 8192,
    ENEMIES: 16384
});

export const GAME_SCENE_SHARED_PRESENTATION_STRIDE = Object.freeze({
    PLAYER: 3,
    WALL: 4,
    PROJECTILE: 2,
    PROJECTILE_STATIC: 1,
    ENEMY: 4,
    ENEMY_STATIC: 2
});

const GAME_SCENE_ENEMY_TYPE_TO_CODE = Object.freeze({
    square: 0,
    triangle: 1,
    arrow: 2,
    hexa: 3,
    hexa_hive: 3,
    penta: 4,
    rhom: 5,
    octa: 6,
    gen: 7
});

const GAME_SCENE_ENEMY_TYPE_BY_CODE = Object.freeze([
    'square',
    'triangle',
    'arrow',
    'hexa',
    'penta',
    'rhom',
    'octa',
    'gen'
]);

/**
 * SharedArrayBuffer 기반 프레젠테이션 경로 사용 가능 여부를 반환합니다.
 * @returns {boolean}
 */
export function isGameSceneSharedPresentationSupported() {
    return typeof SharedArrayBuffer === 'function' && typeof Atomics === 'object';
}

/**
 * @param {number} capacity
 * @param {number} stride
 * @returns {SharedArrayBuffer}
 */
function createSharedFloatBuffer(capacity, stride) {
    return new SharedArrayBuffer(
        Float32Array.BYTES_PER_ELEMENT
        * SHARED_PRESENTATION_SLOT_COUNT
        * capacity
        * stride
    );
}

/**
 * 정적 프레젠테이션 버퍼를 생성합니다.
 * @param {number} capacity
 * @param {number} stride
 * @returns {SharedArrayBuffer}
 */
function createSharedStaticFloatBuffer(capacity, stride) {
    return new SharedArrayBuffer(
        Float32Array.BYTES_PER_ELEMENT
        * capacity
        * stride
    );
}

/**
 * @returns {SharedArrayBuffer}
 */
function createSharedMetaBuffer() {
    return new SharedArrayBuffer(
        Int32Array.BYTES_PER_ELEMENT
        * (
            SHARED_PRESENTATION_GLOBAL_HEADER_LENGTH
            + (SHARED_PRESENTATION_SLOT_COUNT * SHARED_PRESENTATION_SLOT_HEADER_STRIDE)
        )
    );
}

/**
 * 공유 프레젠테이션 raw buffer 세트를 생성합니다.
 * @returns {object|null}
 */
function createGameSceneSharedPresentationBuffers() {
    if (!isGameSceneSharedPresentationSupported()) {
        return null;
    }

    return {
        metaBuffer: createSharedMetaBuffer(),
        playerBuffer: createSharedFloatBuffer(1, GAME_SCENE_SHARED_PRESENTATION_STRIDE.PLAYER),
        staticWallBuffer: createSharedStaticFloatBuffer(
            GAME_SCENE_SHARED_PRESENTATION_CAPACITY.STATIC_WALLS,
            GAME_SCENE_SHARED_PRESENTATION_STRIDE.WALL
        ),
        boxWallBuffer: createSharedStaticFloatBuffer(
            GAME_SCENE_SHARED_PRESENTATION_CAPACITY.BOX_WALLS,
            GAME_SCENE_SHARED_PRESENTATION_STRIDE.WALL
        ),
        projectileDynamicBuffer: createSharedFloatBuffer(
            GAME_SCENE_SHARED_PRESENTATION_CAPACITY.PROJECTILES,
            GAME_SCENE_SHARED_PRESENTATION_STRIDE.PROJECTILE
        ),
        projectileStaticBuffer: createSharedStaticFloatBuffer(
            GAME_SCENE_SHARED_PRESENTATION_CAPACITY.PROJECTILES,
            GAME_SCENE_SHARED_PRESENTATION_STRIDE.PROJECTILE_STATIC
        ),
        enemyDynamicBuffer: createSharedFloatBuffer(
            GAME_SCENE_SHARED_PRESENTATION_CAPACITY.ENEMIES,
            GAME_SCENE_SHARED_PRESENTATION_STRIDE.ENEMY
        ),
        enemyStaticBuffer: createSharedStaticFloatBuffer(
            GAME_SCENE_SHARED_PRESENTATION_CAPACITY.ENEMIES,
            GAME_SCENE_SHARED_PRESENTATION_STRIDE.ENEMY_STATIC
        )
    };
}

/**
 * 공유 프레젠테이션 transport를 생성합니다.
 * @returns {object|null}
 */
export function createGameSceneSharedPresentationTransport() {
    const buffers = createGameSceneSharedPresentationBuffers();
    if (!buffers) {
        return null;
    }

    return attachGameSceneSharedPresentationTransport(buffers);
}

/**
 * raw buffer 세트를 transport/view 객체로 감쌉니다.
 * @param {object|null|undefined} buffers
 * @returns {object|null}
 */
export function attachGameSceneSharedPresentationTransport(buffers) {
    if (!buffers
        || !(buffers.metaBuffer instanceof SharedArrayBuffer)
        || !(buffers.playerBuffer instanceof SharedArrayBuffer)
        || !(buffers.staticWallBuffer instanceof SharedArrayBuffer)
        || !(buffers.boxWallBuffer instanceof SharedArrayBuffer)
        || !(buffers.projectileDynamicBuffer instanceof SharedArrayBuffer)
        || !(buffers.projectileStaticBuffer instanceof SharedArrayBuffer)
        || !(buffers.enemyDynamicBuffer instanceof SharedArrayBuffer)
        || !(buffers.enemyStaticBuffer instanceof SharedArrayBuffer)) {
        return null;
    }

    return {
        ...buffers,
        meta: new Int32Array(buffers.metaBuffer),
        playerData: new Float32Array(buffers.playerBuffer),
        staticWallData: new Float32Array(buffers.staticWallBuffer),
        boxWallData: new Float32Array(buffers.boxWallBuffer),
        projectileDynamicData: new Float32Array(buffers.projectileDynamicBuffer),
        projectileStaticData: new Float32Array(buffers.projectileStaticBuffer),
        enemyDynamicData: new Float32Array(buffers.enemyDynamicBuffer),
        enemyStaticData: new Float32Array(buffers.enemyStaticBuffer),
        playerSlotBases: createSharedSlotBaseIndices(1, GAME_SCENE_SHARED_PRESENTATION_STRIDE.PLAYER),
        projectileDynamicSlotBases: createSharedSlotBaseIndices(
            GAME_SCENE_SHARED_PRESENTATION_CAPACITY.PROJECTILES,
            GAME_SCENE_SHARED_PRESENTATION_STRIDE.PROJECTILE
        ),
        enemyDynamicSlotBases: createSharedSlotBaseIndices(
            GAME_SCENE_SHARED_PRESENTATION_CAPACITY.ENEMIES,
            GAME_SCENE_SHARED_PRESENTATION_STRIDE.ENEMY
        )
    };
}

/**
 * transport에서 워커 bootstrap용 raw buffer 세트를 추출합니다.
 * @param {object|null|undefined} transport
 * @returns {object|null}
 */
export function exportGameSceneSharedPresentationBuffers(transport) {
    if (!transport) {
        return null;
    }

    return {
        metaBuffer: transport.metaBuffer,
        playerBuffer: transport.playerBuffer,
        staticWallBuffer: transport.staticWallBuffer,
        boxWallBuffer: transport.boxWallBuffer,
        projectileDynamicBuffer: transport.projectileDynamicBuffer,
        projectileStaticBuffer: transport.projectileStaticBuffer,
        enemyDynamicBuffer: transport.enemyDynamicBuffer,
        enemyStaticBuffer: transport.enemyStaticBuffer
    };
}

/**
 * 프레젠테이션 스냅샷 래퍼를 생성합니다.
 * @param {object} transport
 * @param {string|null} [sceneState=null]
 * @returns {{sceneState: string|null, scene: {sceneType: string, storageType: string, sharedPresentation: object}}}
 */
export function createGameSceneSharedPresentationSnapshot(transport, sceneState = null) {
    return {
        sceneState,
        scene: {
            sceneType: 'game',
            storageType: GAME_SCENE_SHARED_PRESENTATION_STORAGE_TYPE,
            sharedPresentation: transport
        }
    };
}

/**
 * 현재 슬롯 헤더의 기준 인덱스를 계산합니다.
 * @param {number} slotIndex
 * @returns {number}
 */
function getSlotHeaderBaseIndex(slotIndex) {
    return SHARED_PRESENTATION_GLOBAL_HEADER_LENGTH + (slotIndex * SHARED_PRESENTATION_SLOT_HEADER_STRIDE);
}

/**
 * 슬롯별 float 버퍼 시작 오프셋을 계산합니다.
 * @param {number} slotIndex
 * @param {number} capacity
 * @param {number} stride
 * @returns {number}
 */
function getSlotFloatBaseIndex(slotIndex, capacity, stride) {
    return slotIndex * capacity * stride;
}

/**
 * 슬롯별 float 버퍼 시작 오프셋 배열을 생성합니다.
 * @param {number} capacity
 * @param {number} stride
 * @returns {number[]}
 */
function createSharedSlotBaseIndices(capacity, stride) {
    const bases = [];
    for (let slotIndex = 0; slotIndex < SHARED_PRESENTATION_SLOT_COUNT; slotIndex++) {
        bases.push(getSlotFloatBaseIndex(slotIndex, capacity, stride));
    }
    return bases;
}

/**
 * 값을 SharedArrayBuffer 렌더용 숫자로 정규화합니다.
 * @param {number|null|undefined} value
 * @param {number} [fallback=0]
 * @returns {number}
 */
function normalizeSharedNumber(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
}

/**
 * 적 타입 코드를 반환합니다.
 * @param {string|null|undefined} enemyType
 * @returns {number}
 */
function getEnemyTypeCode(enemyType) {
    if (typeof enemyType !== 'string') {
        return 0;
    }

    return GAME_SCENE_ENEMY_TYPE_TO_CODE[enemyType] ?? 0;
}

/**
 * 적 타입 코드를 문자열로 되돌립니다.
 * @param {number|null|undefined} enemyTypeCode
 * @returns {string}
 */
export function getGameSceneEnemyTypeByCode(enemyTypeCode) {
    if (!Number.isFinite(enemyTypeCode)) {
        return 'square';
    }

    return GAME_SCENE_ENEMY_TYPE_BY_CODE[Math.round(enemyTypeCode)] ?? 'square';
}

/**
 * 벽 배열을 지정 슬롯에 기록합니다.
 * @param {Float32Array} target
 * @param {number} baseIndex
 * @param {object[]|null|undefined} walls
 * @param {number} capacity
 * @returns {number}
 */
function writeSharedWalls(target, baseIndex, walls, capacity) {
    if (!Array.isArray(walls) || walls.length === 0) {
        return 0;
    }

    let count = 0;
    for (let i = 0; i < walls.length && count < capacity; i++) {
        const wall = walls[i];
        if (!wall || wall.active === false) {
            continue;
        }

        const offset = baseIndex + (count * GAME_SCENE_SHARED_PRESENTATION_STRIDE.WALL);
        target[offset + 0] = normalizeSharedNumber(wall.x, 0);
        target[offset + 1] = normalizeSharedNumber(wall.y, 0);
        target[offset + 2] = normalizeSharedNumber(wall.w, 0);
        target[offset + 3] = normalizeSharedNumber(wall.h, 0);
        count++;
    }

    return count;
}

/**
 * 투사체 배열을 지정 슬롯에 기록합니다.
 * @param {Float32Array} target
 * @param {number} baseIndex
 * @param {object[]|null|undefined} projectiles
 * @param {number} capacity
 * @returns {number}
 */
function writeSharedProjectiles(target, baseIndex, projectiles, capacity) {
    if (!Array.isArray(projectiles) || projectiles.length === 0) {
        return 0;
    }

    let count = 0;
    for (let i = 0; i < projectiles.length && count < capacity; i++) {
        const projectile = projectiles[i];
        if (!projectile || projectile.active === false) {
            continue;
        }

        const offset = baseIndex + (count * GAME_SCENE_SHARED_PRESENTATION_STRIDE.PROJECTILE);
        target[offset + 0] = normalizeSharedNumber(projectile.position?.x, 0);
        target[offset + 1] = normalizeSharedNumber(projectile.position?.y, 0);
        count++;
    }

    return count;
}

/**
 * 투사체 배열의 동적 필드만 지정 슬롯에 기록합니다.
 * 반경처럼 정적인 값은 이전 슬롯 재사용 경로에서 유지합니다.
 * @param {Float32Array} target
 * @param {number} baseIndex
 * @param {object[]|null|undefined} projectiles
 * @param {number} capacity
 * @returns {number}
 */
function writeSharedProjectileDynamicData(target, baseIndex, projectiles, capacity) {
    if (!Array.isArray(projectiles) || projectiles.length === 0) {
        return 0;
    }

    let count = 0;
    for (let i = 0; i < projectiles.length && count < capacity; i++) {
        const projectile = projectiles[i];
        if (!projectile || projectile.active === false) {
            continue;
        }

        const offset = baseIndex + (count * GAME_SCENE_SHARED_PRESENTATION_STRIDE.PROJECTILE);
        target[offset + 0] = normalizeSharedNumber(projectile.position?.x, 0);
        target[offset + 1] = normalizeSharedNumber(projectile.position?.y, 0);
        count++;
    }

    return count;
}

/**
 * 투사체 배열의 정적 필드만 기록합니다.
 * @param {Float32Array} target
 * @param {object[]|null|undefined} projectiles
 * @param {number} capacity
 * @returns {number}
 */
function writeSharedProjectileStaticData(target, projectiles, capacity) {
    if (!Array.isArray(projectiles) || projectiles.length === 0) {
        return 0;
    }

    let count = 0;
    for (let i = 0; i < projectiles.length && count < capacity; i++) {
        const projectile = projectiles[i];
        if (!projectile || projectile.active === false) {
            continue;
        }

        const offset = count * GAME_SCENE_SHARED_PRESENTATION_STRIDE.PROJECTILE_STATIC;
        target[offset + 0] = normalizeSharedNumber(projectile.radius, 0);
        count++;
    }

    return count;
}

/**
 * 적 배열을 지정 슬롯에 기록합니다.
 * @param {Float32Array} target
 * @param {number} baseIndex
 * @param {object[]|null|undefined} enemies
 * @param {number} capacity
 * @returns {number}
 */
function writeSharedEnemies(target, baseIndex, enemies, capacity) {
    if (!Array.isArray(enemies) || enemies.length === 0) {
        return 0;
    }

    let count = 0;
    for (let i = 0; i < enemies.length && count < capacity; i++) {
        const enemy = enemies[i];
        if (!enemy || enemy.active === false) {
            continue;
        }

        const renderPosition = enemy.renderPosition ?? enemy.position;
        const offset = baseIndex + (count * GAME_SCENE_SHARED_PRESENTATION_STRIDE.ENEMY);
        target[offset + 0] = normalizeSharedNumber(renderPosition?.x, 0);
        target[offset + 1] = normalizeSharedNumber(renderPosition?.y, 0);
        target[offset + 2] = normalizeSharedNumber(enemy.rotation, 0);
        target[offset + 3] = normalizeSharedNumber(enemy.alpha, 1);
        count++;
    }

    return count;
}

/**
 * 적 배열의 동적 필드만 지정 슬롯에 기록합니다.
 * 타입/크기처럼 정적인 값은 이전 슬롯 재사용 경로에서 유지합니다.
 * @param {Float32Array} target
 * @param {number} baseIndex
 * @param {object[]|null|undefined} enemies
 * @param {number} capacity
 * @returns {number}
 */
function writeSharedEnemyDynamicData(target, baseIndex, enemies, capacity) {
    if (!Array.isArray(enemies) || enemies.length === 0) {
        return 0;
    }

    let count = 0;
    for (let i = 0; i < enemies.length && count < capacity; i++) {
        const enemy = enemies[i];
        if (!enemy || enemy.active === false) {
            continue;
        }

        const renderPosition = enemy.renderPosition ?? enemy.position;
        const offset = baseIndex + (count * GAME_SCENE_SHARED_PRESENTATION_STRIDE.ENEMY);
        target[offset + 0] = normalizeSharedNumber(renderPosition?.x, 0);
        target[offset + 1] = normalizeSharedNumber(renderPosition?.y, 0);
        target[offset + 2] = normalizeSharedNumber(enemy.rotation, 0);
        target[offset + 3] = normalizeSharedNumber(enemy.alpha, 1);
        count++;
    }

    return count;
}

/**
 * 적 배열의 정적 필드만 기록합니다.
 * @param {Float32Array} target
 * @param {object[]|null|undefined} enemies
 * @param {number} capacity
 * @returns {number}
 */
function writeSharedEnemyStaticData(target, enemies, capacity) {
    if (!Array.isArray(enemies) || enemies.length === 0) {
        return 0;
    }

    let count = 0;
    for (let i = 0; i < enemies.length && count < capacity; i++) {
        const enemy = enemies[i];
        if (!enemy || enemy.active === false) {
            continue;
        }

        const offset = count * GAME_SCENE_SHARED_PRESENTATION_STRIDE.ENEMY_STATIC;
        target[offset + 0] = normalizeSharedNumber(enemy.size, 1);
        target[offset + 1] = getEnemyTypeCode(enemy.type);
        count++;
    }

    return count;
}

/**
 * 이전 슬롯의 static wall/box wall 데이터를 현재 슬롯으로 재사용합니다.
 * @param {Int32Array} meta
 * @param {number} currentSlot
 * @param {number} slotHeaderBase
 */
function reuseSharedWallGeometry(meta, currentSlot, slotHeaderBase) {
    const currentSlotHeaderBase = getSlotHeaderBaseIndex(currentSlot);
    const currentStaticWallCount = Atomics.load(
        meta,
        currentSlotHeaderBase + SHARED_PRESENTATION_SLOT_INDEX.STATIC_WALL_COUNT
    );
    const currentBoxWallCount = Atomics.load(
        meta,
        currentSlotHeaderBase + SHARED_PRESENTATION_SLOT_INDEX.BOX_WALL_COUNT
    );

    meta[slotHeaderBase + SHARED_PRESENTATION_SLOT_INDEX.STATIC_WALL_COUNT] = currentStaticWallCount;
    meta[slotHeaderBase + SHARED_PRESENTATION_SLOT_INDEX.BOX_WALL_COUNT] = currentBoxWallCount;
}

/**
 * 이전 슬롯의 투사체 데이터를 현재 슬롯으로 재사용합니다.
 * @param {Int32Array} meta
 * @param {number} nextSlot
 * @param {number} slotHeaderBase
 * @param {object[]|null|undefined} projectiles
 * @param {object} transport
 */
function reuseSharedProjectilePresentation(meta, nextSlot, slotHeaderBase, projectiles, transport) {
    const nextProjectileBase = Array.isArray(transport?.projectileDynamicSlotBases)
        ? transport.projectileDynamicSlotBases[nextSlot]
        : getSlotFloatBaseIndex(
            nextSlot,
            GAME_SCENE_SHARED_PRESENTATION_CAPACITY.PROJECTILES,
            GAME_SCENE_SHARED_PRESENTATION_STRIDE.PROJECTILE
        );

    meta[slotHeaderBase + SHARED_PRESENTATION_SLOT_INDEX.PROJECTILE_COUNT] = writeSharedProjectileDynamicData(
        transport.projectileDynamicData,
        nextProjectileBase,
        projectiles,
        GAME_SCENE_SHARED_PRESENTATION_CAPACITY.PROJECTILES
    );
}

/**
 * 이전 슬롯의 적 데이터를 현재 슬롯으로 재사용합니다.
 * @param {Int32Array} meta
 * @param {number} nextSlot
 * @param {number} slotHeaderBase
 * @param {object[]|null|undefined} enemies
 * @param {object} transport
 */
function reuseSharedEnemyPresentation(meta, nextSlot, slotHeaderBase, enemies, transport) {
    const nextEnemyBase = Array.isArray(transport?.enemyDynamicSlotBases)
        ? transport.enemyDynamicSlotBases[nextSlot]
        : getSlotFloatBaseIndex(
            nextSlot,
            GAME_SCENE_SHARED_PRESENTATION_CAPACITY.ENEMIES,
            GAME_SCENE_SHARED_PRESENTATION_STRIDE.ENEMY
        );

    meta[slotHeaderBase + SHARED_PRESENTATION_SLOT_INDEX.ENEMY_COUNT] = writeSharedEnemyDynamicData(
        transport.enemyDynamicData,
        nextEnemyBase,
        enemies,
        GAME_SCENE_SHARED_PRESENTATION_CAPACITY.ENEMIES
    );
}

/**
 * 공유 프레젠테이션 슬롯에 게임 씬 렌더 데이터를 기록하고 publish합니다.
 * @param {object|null|undefined} transport
 * @param {object|null|undefined} sceneSnapshot
 * @param {number} [frameId=0]
 * @param {{reuseWallGeometry?: boolean, reuseProjectilePresentation?: boolean, reuseEnemyPresentation?: boolean}} [options={}]
 * @returns {boolean}
 */
export function publishGameSceneSharedPresentation(transport, sceneSnapshot, frameId = 0, options = {}) {
    if (!transport?.meta
        || !(transport.playerData instanceof Float32Array)
        || !(transport.staticWallData instanceof Float32Array)
        || !(transport.boxWallData instanceof Float32Array)
        || !(transport.projectileDynamicData instanceof Float32Array)
        || !(transport.projectileStaticData instanceof Float32Array)
        || !(transport.enemyDynamicData instanceof Float32Array)
        || !(transport.enemyStaticData instanceof Float32Array)) {
        return false;
    }

    const meta = transport.meta;
    const currentPublishedSlot = Atomics.load(meta, SHARED_PRESENTATION_META_INDEX.PUBLISHED_SLOT);
    const nextSlot = currentPublishedSlot === 0 ? 1 : 0;
    const slotHeaderBase = getSlotHeaderBaseIndex(nextSlot);
    const shouldReuseWallGeometry = options?.reuseWallGeometry === true;
    const shouldReuseProjectilePresentation = options?.reuseProjectilePresentation === true;
    const shouldReuseEnemyPresentation = options?.reuseEnemyPresentation === true;

    const playerBase = Array.isArray(transport.playerSlotBases)
        ? transport.playerSlotBases[nextSlot]
        : getSlotFloatBaseIndex(nextSlot, 1, GAME_SCENE_SHARED_PRESENTATION_STRIDE.PLAYER);
    const projectileBase = Array.isArray(transport.projectileDynamicSlotBases)
        ? transport.projectileDynamicSlotBases[nextSlot]
        : getSlotFloatBaseIndex(
            nextSlot,
            GAME_SCENE_SHARED_PRESENTATION_CAPACITY.PROJECTILES,
            GAME_SCENE_SHARED_PRESENTATION_STRIDE.PROJECTILE
        );
    const enemyBase = Array.isArray(transport.enemyDynamicSlotBases)
        ? transport.enemyDynamicSlotBases[nextSlot]
        : getSlotFloatBaseIndex(
            nextSlot,
            GAME_SCENE_SHARED_PRESENTATION_CAPACITY.ENEMIES,
            GAME_SCENE_SHARED_PRESENTATION_STRIDE.ENEMY
        );

    const player = sceneSnapshot?.player;
    const playerActive = player && player.active !== false ? 1 : 0;
    transport.playerData[playerBase + 0] = playerActive ? normalizeSharedNumber(player.position?.x, 0) : 0;
    transport.playerData[playerBase + 1] = playerActive ? normalizeSharedNumber(player.position?.y, 0) : 0;
    transport.playerData[playerBase + 2] = playerActive ? normalizeSharedNumber(player.radius, 0) : 0;

    meta[slotHeaderBase + SHARED_PRESENTATION_SLOT_INDEX.PLAYER_ACTIVE] = playerActive;
    if (shouldReuseWallGeometry) {
        reuseSharedWallGeometry(meta, currentPublishedSlot, slotHeaderBase);
    } else {
        meta[slotHeaderBase + SHARED_PRESENTATION_SLOT_INDEX.STATIC_WALL_COUNT] = writeSharedWalls(
            transport.staticWallData,
            0,
            sceneSnapshot?.staticWalls,
            GAME_SCENE_SHARED_PRESENTATION_CAPACITY.STATIC_WALLS
        );
        meta[slotHeaderBase + SHARED_PRESENTATION_SLOT_INDEX.BOX_WALL_COUNT] = writeSharedWalls(
            transport.boxWallData,
            0,
            sceneSnapshot?.boxWalls,
            GAME_SCENE_SHARED_PRESENTATION_CAPACITY.BOX_WALLS
        );
    }
    if (shouldReuseProjectilePresentation) {
        reuseSharedProjectilePresentation(
            meta,
            nextSlot,
            slotHeaderBase,
            sceneSnapshot?.projectiles,
            transport
        );
    } else {
        meta[slotHeaderBase + SHARED_PRESENTATION_SLOT_INDEX.PROJECTILE_COUNT] = writeSharedProjectiles(
            transport.projectileDynamicData,
            projectileBase,
            sceneSnapshot?.projectiles,
            GAME_SCENE_SHARED_PRESENTATION_CAPACITY.PROJECTILES
        );
        writeSharedProjectileStaticData(
            transport.projectileStaticData,
            sceneSnapshot?.projectiles,
            GAME_SCENE_SHARED_PRESENTATION_CAPACITY.PROJECTILES
        );
    }
    if (shouldReuseEnemyPresentation) {
        reuseSharedEnemyPresentation(
            meta,
            nextSlot,
            slotHeaderBase,
            sceneSnapshot?.enemies,
            transport
        );
    } else {
        meta[slotHeaderBase + SHARED_PRESENTATION_SLOT_INDEX.ENEMY_COUNT] = writeSharedEnemies(
            transport.enemyDynamicData,
            enemyBase,
            sceneSnapshot?.enemies,
            GAME_SCENE_SHARED_PRESENTATION_CAPACITY.ENEMIES
        );
        writeSharedEnemyStaticData(
            transport.enemyStaticData,
            sceneSnapshot?.enemies,
            GAME_SCENE_SHARED_PRESENTATION_CAPACITY.ENEMIES
        );
    }

    meta[slotHeaderBase + SHARED_PRESENTATION_SLOT_INDEX.COLLISION_CHECK_COUNT] = Math.max(
        0,
        Math.floor(normalizeSharedNumber(sceneSnapshot?.collisionStats?.collisionCheckCount, 0))
    );
    meta[slotHeaderBase + SHARED_PRESENTATION_SLOT_INDEX.AABB_PASS_COUNT] = Math.max(
        0,
        Math.floor(normalizeSharedNumber(sceneSnapshot?.collisionStats?.aabbPassCount, 0))
    );
    meta[slotHeaderBase + SHARED_PRESENTATION_SLOT_INDEX.AABB_REJECT_COUNT] = Math.max(
        0,
        Math.floor(normalizeSharedNumber(sceneSnapshot?.collisionStats?.aabbRejectCount, 0))
    );
    meta[slotHeaderBase + SHARED_PRESENTATION_SLOT_INDEX.CIRCLE_PASS_COUNT] = Math.max(
        0,
        Math.floor(normalizeSharedNumber(sceneSnapshot?.collisionStats?.circlePassCount, 0))
    );
    meta[slotHeaderBase + SHARED_PRESENTATION_SLOT_INDEX.CIRCLE_REJECT_COUNT] = Math.max(
        0,
        Math.floor(normalizeSharedNumber(sceneSnapshot?.collisionStats?.circleRejectCount, 0))
    );
    meta[slotHeaderBase + SHARED_PRESENTATION_SLOT_INDEX.POLYGON_CHECKS] = Math.max(
        0,
        Math.floor(normalizeSharedNumber(sceneSnapshot?.collisionStats?.polygonChecks, 0))
    );

    Atomics.store(
        meta,
        SHARED_PRESENTATION_META_INDEX.LAST_FRAME_ID,
        Number.isInteger(frameId) ? frameId : 0
    );
    Atomics.store(meta, SHARED_PRESENTATION_META_INDEX.PUBLISHED_SLOT, nextSlot);
    Atomics.add(meta, SHARED_PRESENTATION_META_INDEX.VERSION, 1);
    return true;
}

/**
 * 현재 publish된 슬롯 상태를 읽기 좋은 형태로 반환합니다.
 * @param {object|null|undefined} transport
 * @param {object|null|undefined} [outState=null]
 * @returns {object|null}
 */
export function readGameSceneSharedPresentationState(transport, outState = null) {
    if (!transport?.meta) {
        return null;
    }

    const slotIndex = Atomics.load(transport.meta, SHARED_PRESENTATION_META_INDEX.PUBLISHED_SLOT);
    const slotHeaderBase = getSlotHeaderBaseIndex(slotIndex);
    const nextState = outState && typeof outState === 'object'
        ? outState
        : {};
    const collisionStats = nextState.collisionStats && typeof nextState.collisionStats === 'object'
        ? nextState.collisionStats
        : {};

    nextState.slotIndex = slotIndex;
    nextState.version = Atomics.load(transport.meta, SHARED_PRESENTATION_META_INDEX.VERSION);
    nextState.lastFrameId = Atomics.load(transport.meta, SHARED_PRESENTATION_META_INDEX.LAST_FRAME_ID);
    nextState.staticWallCount = Atomics.load(transport.meta, slotHeaderBase + SHARED_PRESENTATION_SLOT_INDEX.STATIC_WALL_COUNT);
    nextState.boxWallCount = Atomics.load(transport.meta, slotHeaderBase + SHARED_PRESENTATION_SLOT_INDEX.BOX_WALL_COUNT);
    nextState.projectileCount = Atomics.load(transport.meta, slotHeaderBase + SHARED_PRESENTATION_SLOT_INDEX.PROJECTILE_COUNT);
    nextState.enemyCount = Atomics.load(transport.meta, slotHeaderBase + SHARED_PRESENTATION_SLOT_INDEX.ENEMY_COUNT);
    nextState.playerActive = Atomics.load(transport.meta, slotHeaderBase + SHARED_PRESENTATION_SLOT_INDEX.PLAYER_ACTIVE) === 1;
    collisionStats.collisionCheckCount = Atomics.load(
        transport.meta,
        slotHeaderBase + SHARED_PRESENTATION_SLOT_INDEX.COLLISION_CHECK_COUNT
    );
    collisionStats.aabbPassCount = Atomics.load(
        transport.meta,
        slotHeaderBase + SHARED_PRESENTATION_SLOT_INDEX.AABB_PASS_COUNT
    );
    collisionStats.aabbRejectCount = Atomics.load(
        transport.meta,
        slotHeaderBase + SHARED_PRESENTATION_SLOT_INDEX.AABB_REJECT_COUNT
    );
    collisionStats.circlePassCount = Atomics.load(
        transport.meta,
        slotHeaderBase + SHARED_PRESENTATION_SLOT_INDEX.CIRCLE_PASS_COUNT
    );
    collisionStats.circleRejectCount = Atomics.load(
        transport.meta,
        slotHeaderBase + SHARED_PRESENTATION_SLOT_INDEX.CIRCLE_REJECT_COUNT
    );
    collisionStats.polygonChecks = Atomics.load(
        transport.meta,
        slotHeaderBase + SHARED_PRESENTATION_SLOT_INDEX.POLYGON_CHECKS
    );
    nextState.collisionStats = collisionStats;
    nextState.playerBase = Array.isArray(transport.playerSlotBases)
        ? transport.playerSlotBases[slotIndex]
        : getSlotFloatBaseIndex(slotIndex, 1, GAME_SCENE_SHARED_PRESENTATION_STRIDE.PLAYER);
    nextState.staticWallBase = 0;
    nextState.boxWallBase = 0;
    nextState.projectileBase = Array.isArray(transport.projectileDynamicSlotBases)
        ? transport.projectileDynamicSlotBases[slotIndex]
        : getSlotFloatBaseIndex(
            slotIndex,
            GAME_SCENE_SHARED_PRESENTATION_CAPACITY.PROJECTILES,
            GAME_SCENE_SHARED_PRESENTATION_STRIDE.PROJECTILE
        );
    nextState.projectileStaticBase = 0;
    nextState.enemyBase = Array.isArray(transport.enemyDynamicSlotBases)
        ? transport.enemyDynamicSlotBases[slotIndex]
        : getSlotFloatBaseIndex(
            slotIndex,
            GAME_SCENE_SHARED_PRESENTATION_CAPACITY.ENEMIES,
            GAME_SCENE_SHARED_PRESENTATION_STRIDE.ENEMY
        );
    nextState.enemyStaticBase = 0;
    nextState.playerData = transport.playerData;
    nextState.staticWallData = transport.staticWallData;
    nextState.boxWallData = transport.boxWallData;
    nextState.projectileData = transport.projectileDynamicData;
    nextState.projectileStaticData = transport.projectileStaticData;
    nextState.enemyData = transport.enemyDynamicData;
    nextState.enemyStaticData = transport.enemyStaticData;
    return nextState;
}
