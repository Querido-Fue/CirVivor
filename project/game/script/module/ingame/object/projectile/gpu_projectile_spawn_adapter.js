import {
    GPU_CIRCLE_BODY_COLLISION_LAYER,
    GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG,
    encodeGpuCircleBodyFixedPoint
} from '../../physics/gpu/gpu_circle_body_abi.js';

const INVALID_HANDLE_COMPONENT = 0xffffffff;
const DEFAULT_COMMAND_NAMESPACE = 'gpu-projectile';
const GPU_PROJECTILE_LAYER = GPU_CIRCLE_BODY_COLLISION_LAYER.PROJECTILE;

export const GPU_PROJECTILE_WORLD_KIND_ID = 'projectile';
export const GPU_PROJECTILE_CONTACT_HANDLER_FLAGS = Object.freeze({
    KILL_IF_OTHER_TERRAIN:
        GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.KILL_IF_OTHER_TERRAIN,
    CLOSEST_ONLY: GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.CLOSEST_ONLY,
    INTERACTION_ENTER_ONLY:
        GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_ENTER_ONLY,
    INTERACTION_CONTINUOUS:
        GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_CONTINUOUS
});

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

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

function requireNonNegativeFinite(value, label) {
    const number = requireFinite(value, label);
    if (number < 0) {
        throw new RangeError(`${label}은 0 이상이어야 합니다.`);
    }
    return number;
}

function requireGpuFixedPointCompatible(value, label, allowZero = false) {
    const number = allowZero
        ? requireNonNegativeFinite(value, label)
        : requirePositiveFinite(value, label);
    encodeGpuCircleBodyFixedPoint(number);
    return number;
}

function requirePositiveSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
        throw new RangeError(`${label}은 양의 안전한 정수여야 합니다.`);
    }
    return number;
}

function requireNonNegativeSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
        throw new RangeError(`${label}은 0 이상의 안전한 정수여야 합니다.`);
    }
    return number;
}

function requireEndpoint(endpoint) {
    if (!endpoint || typeof endpoint.requestSpawn !== 'function') {
        throw new TypeError('GPU projectile adapter에는 endpoint.requestSpawn()이 필요합니다.');
    }
    return endpoint;
}

function normalizeVector(source, label) {
    if (!source || typeof source !== 'object') {
        throw new TypeError(`${label} 벡터가 필요합니다.`);
    }
    return Object.freeze({
        x: requireFinite(source.x, `${label}.x`),
        y: requireFinite(source.y, `${label}.y`)
    });
}

function normalizeSourceHandle(source) {
    if (source === undefined || source === null) {
        return null;
    }
    if (!source || typeof source !== 'object') {
        throw new TypeError('sourceHandle은 entity handle 객체여야 합니다.');
    }
    const entityId = Number(source.entityId);
    const incarnation = Number(source.incarnation);
    if (!Number.isSafeInteger(entityId)
        || entityId <= 0
        || entityId >= INVALID_HANDLE_COMPONENT) {
        throw new RangeError('sourceHandle.entityId가 유효하지 않습니다.');
    }
    if (!Number.isSafeInteger(incarnation)
        || incarnation <= 0
        || incarnation >= INVALID_HANDLE_COMPONENT) {
        throw new RangeError('sourceHandle.incarnation이 유효하지 않습니다.');
    }
    return Object.freeze({ entityId, incarnation });
}

function resolveInverseMass(definition) {
    if (definition.inverseMass !== undefined) {
        return requirePositiveFinite(definition.inverseMass, 'definition.inverseMass');
    }
    const mass = requirePositiveFinite(definition.mass, 'definition.mass');
    return 1 / mass;
}

function normalizeColor(source) {
    if (source === undefined || source === null) {
        return null;
    }
    if ((!Array.isArray(source) && !ArrayBuffer.isView(source))
        || source.length !== 4) {
        throw new TypeError('definition.colorRgba는 네 성분 배열이어야 합니다.');
    }
    const color = new Array(4);
    for (let index = 0; index < 4; index++) {
        const component = requireFinite(source[index], `definition.colorRgba[${index}]`);
        if (component < 0 || component > 1) {
            throw new RangeError(`definition.colorRgba[${index}]는 0~1 범위여야 합니다.`);
        }
        color[index] = component;
    }
    return Object.freeze(color);
}

function createContactHandler(definition) {
    let flags = definition.continuousInteraction === true
        ? GPU_PROJECTILE_CONTACT_HANDLER_FLAGS.INTERACTION_CONTINUOUS
        : GPU_PROJECTILE_CONTACT_HANDLER_FLAGS.INTERACTION_ENTER_ONLY;
    if (definition.killOnTerrain !== false) {
        flags |= GPU_PROJECTILE_CONTACT_HANDLER_FLAGS.KILL_IF_OTHER_TERRAIN;
    }
    if (definition.closestOnly === true) {
        flags |= GPU_PROJECTILE_CONTACT_HANDLER_FLAGS.CLOSEST_ONLY;
    }
    // ABI writer가 shader용 fixed-point 변환을 소유하므로 gameplay 단위를 보존합니다.
    return Object.freeze({
        damageSelf: requireGpuFixedPointCompatible(
            definition.damageSelf ?? 1,
            'definition.damageSelf',
            true
        ),
        damageOther: requireGpuFixedPointCompatible(
            definition.damage,
            'definition.damage'
        ),
        flags
    });
}

function createRenderStyle(definition) {
    const color = normalizeColor(definition.colorRgba);
    const hasRadiusScale = definition.radiusScale !== undefined;
    if (!color && !hasRadiusScale && definition.visible === undefined) {
        return null;
    }
    return Object.freeze({
        ...(color ? { color } : {}),
        radiusScale: hasRadiusScale
            ? requirePositiveFinite(definition.radiusScale, 'definition.radiusScale')
            : 1,
        visible: definition.visible !== false
    });
}

/**
 * data definition과 world-space 발사 상태를 mixed-body GPU spawn intent로 변환합니다.
 * entityId/incarnation은 endpoint 내부 WorldRegistry가 fixed 경계에서만 발급합니다.
 *
 * @param {{definition:object,position:{x:number,y:number},velocity:{x:number,y:number},spawnSequence?:number,sourceHandle?:object|null}} options
 * @returns {object} 불변 projectile spawn intent입니다.
 */
export function createGpuProjectileSpawnIntent(options = {}) {
    const definition = options.definition;
    if (!definition || typeof definition !== 'object') {
        throw new TypeError('GPU projectile definition이 필요합니다.');
    }
    if (Object.prototype.hasOwnProperty.call(options, 'entityId')
        || Object.prototype.hasOwnProperty.call(options, 'incarnation')
        || Object.prototype.hasOwnProperty.call(options, 'handle')) {
        throw new TypeError('projectile identity는 WorldRegistry만 발급할 수 있습니다.');
    }
    const definitionId = requireNonEmptyString(definition.id, 'definition.id');
    const sourceHandle = normalizeSourceHandle(options.sourceHandle);
    const spawnSequence = requireNonNegativeSafeInteger(
        options.spawnSequence ?? 0,
        'spawnSequence'
    );
    const bodyLayer = GPU_PROJECTILE_LAYER;
    const renderStyle = createRenderStyle(definition);
    return Object.freeze({
        kindId: GPU_PROJECTILE_WORLD_KIND_ID,
        definitionId,
        spawnSequence,
        ...(sourceHandle ? {
            sourceEntityId: sourceHandle.entityId,
            sourceIncarnation: sourceHandle.incarnation
        } : {}),
        position: normalizeVector(options.position, 'position'),
        velocity: normalizeVector(options.velocity, 'velocity'),
        radius: requirePositiveFinite(
            definition.collisionRadius ?? definition.radius,
            'definition.collisionRadius'
        ),
        inverseMass: resolveInverseMass(definition),
        bodyLayer,
        collisionMask: 0,
        interactionLayer: bodyLayer,
        interactionMask: GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY
            | GPU_CIRCLE_BODY_COLLISION_LAYER.TERRAIN,
        // ABI writer가 health를 shader용 fixed-point로 encode합니다.
        health: requireGpuFixedPointCompatible(
            definition.penetration,
            'definition.penetration'
        ),
        lifetime: requirePositiveFinite(
            definition.lifetimeSeconds ?? definition.lifetime,
            'definition.lifetimeSeconds'
        ),
        contactHandler: createContactHandler(definition),
        alive: true,
        ...(renderStyle ? { renderStyle } : {})
    });
}

/**
 * caller identity와 fixed tick/sequence로 재시도에도 동일한 command ID를 만듭니다.
 * @param {{definitionId:string,targetFixedTick:number,spawnSequence:number,sourceHandle?:object|null,commandNamespace?:string}} options
 * @returns {string}
 */
export function createGpuProjectileCommandId(options = {}) {
    const namespace = requireNonEmptyString(
        options.commandNamespace ?? DEFAULT_COMMAND_NAMESPACE,
        'commandNamespace'
    );
    const definitionId = requireNonEmptyString(options.definitionId, 'definitionId');
    const targetFixedTick = requirePositiveSafeInteger(
        options.targetFixedTick,
        'targetFixedTick'
    );
    const spawnSequence = requireNonNegativeSafeInteger(
        options.spawnSequence,
        'spawnSequence'
    );
    const sourceHandle = normalizeSourceHandle(options.sourceHandle);
    const sourceKey = sourceHandle
        ? `${sourceHandle.entityId}:${sourceHandle.incarnation}`
        : 'session';
    return `${encodeURIComponent(namespace)}:${sourceKey}:${targetFixedTick}:${spawnSequence}:${encodeURIComponent(definitionId)}`;
}

/**
 * projectile spawn intent를 만들고 endpoint의 next-fixed command boundary에 요청합니다.
 * @param {{endpoint:object,definition:object,position:{x:number,y:number},velocity:{x:number,y:number},targetFixedTick:number,spawnSequence?:number,sourceHandle?:object|null,commandNamespace?:string,commandId?:string|null}} options
 * @returns {object} endpoint.requestSpawn() 결과입니다.
 */
export function requestGpuProjectileSpawn(options = {}) {
    const endpoint = requireEndpoint(options.endpoint);
    const targetFixedTick = requirePositiveSafeInteger(
        options.targetFixedTick,
        'targetFixedTick'
    );
    const spawnSequence = requireNonNegativeSafeInteger(
        options.spawnSequence ?? 0,
        'spawnSequence'
    );
    const intent = createGpuProjectileSpawnIntent({
        definition: options.definition,
        position: options.position,
        velocity: options.velocity,
        spawnSequence,
        sourceHandle: options.sourceHandle
    });
    const commandId = options.commandId === undefined || options.commandId === null
        ? createGpuProjectileCommandId({
            definitionId: intent.definitionId,
            targetFixedTick,
            spawnSequence,
            sourceHandle: options.sourceHandle,
            commandNamespace: options.commandNamespace
        })
        : requireNonEmptyString(options.commandId, 'commandId');
    return endpoint.requestSpawn(intent, targetFixedTick, commandId);
}

/**
 * 한 session endpoint와 command namespace를 보관하는 data-driven projectile adapter입니다.
 */
export class GpuProjectileSpawnAdapter {
    /**
     * @param {object} endpoint - mixed-body GpuSimulationEndpoint입니다.
     * @param {{commandNamespace?:string}} [options={}]
     */
    constructor(endpoint, options = {}) {
        this.endpoint = requireEndpoint(endpoint);
        this.commandNamespace = requireNonEmptyString(
            options.commandNamespace ?? DEFAULT_COMMAND_NAMESPACE,
            'commandNamespace'
        );
    }

    /** @param {object} options - requestGpuProjectileSpawn()에서 endpoint를 제외한 값입니다. */
    requestSpawn(options = {}) {
        return requestGpuProjectileSpawn({
            ...options,
            endpoint: this.endpoint,
            commandNamespace: options.commandNamespace ?? this.commandNamespace
        });
    }
}
