import {
    GPU_CIRCLE_BODY_COLLISION_LAYER,
    GPU_CIRCLE_BODY_RENDER_SHAPE
} from '../../physics/gpu/gpu_circle_body_abi.js';

export const GPU_ENEMY_WORLD_KIND_ID = 'enemy';
export const GPU_ENEMY_FIRST_TARGET_WAYPOINT_INDEX = 1;

const GPU_ENEMY_RENDER_SHAPE_CODE_BY_TYPE = Object.freeze({
    circle: GPU_CIRCLE_BODY_RENDER_SHAPE.CIRCLE,
    square: GPU_CIRCLE_BODY_RENDER_SHAPE.SQUARE,
    triangle: GPU_CIRCLE_BODY_RENDER_SHAPE.TRIANGLE,
    arrow: GPU_CIRCLE_BODY_RENDER_SHAPE.ARROW,
    penta: GPU_CIRCLE_BODY_RENDER_SHAPE.PENTA,
    hexa: GPU_CIRCLE_BODY_RENDER_SHAPE.HEXA,
    gen: GPU_CIRCLE_BODY_RENDER_SHAPE.GEN
});

function requirePositiveFinite(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
        throw new RangeError(`${label}은 양의 유한 숫자여야 합니다.`);
    }
    return number;
}

function requireFinite(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        throw new TypeError(`${label}은 유한 숫자여야 합니다.`);
    }
    return number;
}

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

function resolveEnemyRenderShapeCode(shapeType) {
    // shapeType 도입 전 definition은 물리 ABI의 기존 원형 render 계약을 유지합니다.
    if (shapeType === undefined) {
        return GPU_CIRCLE_BODY_RENDER_SHAPE.CIRCLE;
    }
    const type = requireNonEmptyString(shapeType, 'enemy shapeType');
    if (!Object.prototype.hasOwnProperty.call(GPU_ENEMY_RENDER_SHAPE_CODE_BY_TYPE, type)) {
        throw new RangeError(`지원하지 않는 GPU enemy shapeType입니다: ${type}`);
    }
    return GPU_ENEMY_RENDER_SHAPE_CODE_BY_TYPE[type];
}

function normalizeColor(source) {
    if ((!Array.isArray(source) && !ArrayBuffer.isView(source)) || source.length !== 4) {
        throw new TypeError('enemy colorRgba는 네 성분 배열이어야 합니다.');
    }
    const color = new Array(4);
    for (let index = 0; index < 4; index++) {
        const component = requireFinite(source[index], `colorRgba[${index}]`);
        if (component < 0 || component > 1) {
            throw new RangeError(`colorRgba[${index}]는 0~1 범위여야 합니다.`);
        }
        color[index] = component;
    }
    return Object.freeze(color);
}

/**
 * 선언 적 1개를 현재 map route의 첫 GPU flow stage에 맞는 spawn intent로 바꿉니다.
 * identity는 WorldRegistry만 발급하므로 이 adapter는 entityId/incarnation을 만들지 않습니다.
 * @param {{definition:object,route:object,spawnSequence:number,laneOffsetTiles?:number,waveId?:string|null,policyId?:string|null}} options
 * @returns {object} 불변 spawn intent입니다.
 */
export function createGpuEnemySpawnIntent(options) {
    const definition = options?.definition;
    const route = options?.route;
    if (!definition || typeof definition !== 'object') {
        throw new TypeError('GPU enemy definition이 필요합니다.');
    }
    if (!route || typeof route !== 'object' || !Array.isArray(route.waypoints)
        || route.waypoints.length < 2) {
        throw new TypeError('GPU enemy spawn에는 두 waypoint 이상의 route가 필요합니다.');
    }
    const enemyDefinitionId = requireNonEmptyString(definition.id, 'enemyDefinitionId');
    const gateId = requireNonEmptyString(route.gateId, 'gateId');
    const pathId = requireNonEmptyString(route.pathId, 'pathId');
    const spawnSequence = Number(options.spawnSequence);
    if (!Number.isSafeInteger(spawnSequence) || spawnSequence < 0) {
        throw new RangeError('spawnSequence는 0 이상의 안전한 정수여야 합니다.');
    }
    const entry = route.waypoints[0];
    const next = route.waypoints[1];
    const entryX = requireFinite(entry?.x, 'route.entry.x');
    const entryY = requireFinite(entry?.y, 'route.entry.y');
    const directionX = requireFinite(next?.x, 'route.next.x') - entryX;
    const directionY = requireFinite(next?.y, 'route.next.y') - entryY;
    const directionLength = Math.hypot(directionX, directionY);
    if (!Number.isFinite(directionLength) || !(directionLength > 0)) {
        throw new RangeError('route의 첫 두 waypoint는 서로 다른 위치여야 합니다.');
    }
    const directionUnitX = directionX / directionLength;
    const directionUnitY = directionY / directionLength;
    const laneOffsetTiles = requireFinite(options.laneOffsetTiles ?? 0, 'laneOffsetTiles');
    const normalX = -directionUnitY;
    const normalY = directionUnitX;
    const collisionWeight = requirePositiveFinite(
        definition.collisionWeight,
        'collisionWeight'
    );
    const flowSpeed = requirePositiveFinite(
        definition.moveSpeedTilesPerSecond,
        'moveSpeedTilesPerSecond'
    );
    const color = normalizeColor(definition.colorRgba);
    const shapeCode = resolveEnemyRenderShapeCode(definition.shapeType);
    const waveId = options.waveId === undefined || options.waveId === null
        ? null
        : requireNonEmptyString(options.waveId, 'waveId');
    const policyId = options.policyId === undefined || options.policyId === null
        ? null
        : requireNonEmptyString(options.policyId, 'policyId');

    return Object.freeze({
        kindId: GPU_ENEMY_WORLD_KIND_ID,
        definitionId: enemyDefinitionId,
        enemyDefinitionId,
        gateId,
        pathId,
        waypointIndex: GPU_ENEMY_FIRST_TARGET_WAYPOINT_INDEX,
        spawnSequence,
        waveId,
        policyId,
        position: Object.freeze({
            x: entryX + (normalX * laneOffsetTiles),
            y: entryY + (normalY * laneOffsetTiles)
        }),
        velocity: Object.freeze({
            x: directionUnitX * flowSpeed,
            y: directionUnitY * flowSpeed
        }),
        radius: requirePositiveFinite(
            definition.collisionRadiusTiles,
            'collisionRadiusTiles'
        ),
        inverseMass: 1 / collisionWeight,
        bodyLayer: GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY,
        collisionMask: GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY
            | GPU_CIRCLE_BODY_COLLISION_LAYER.KINEMATIC_OBSTACLE
            | GPU_CIRCLE_BODY_COLLISION_LAYER.TERRAIN,
        interactionLayer: GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY,
        interactionMask: GPU_CIRCLE_BODY_COLLISION_LAYER.PROJECTILE,
        health: requirePositiveFinite(definition.maxHealth ?? 1, 'maxHealth'),
        lifetime: -1,
        alive: true,
        flowSpeed,
        renderStyle: Object.freeze({
            color,
            radiusScale: requirePositiveFinite(definition.radiusScale ?? 1, 'radiusScale'),
            visible: true,
            shapeCode
        })
    });
}
