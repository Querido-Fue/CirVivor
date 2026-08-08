import { THE_CORE_DATA } from 'data/object/core/the_core_data.js';
import {
    GPU_CIRCLE_BODY_COLLISION_LAYER,
    GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG,
    GPU_CIRCLE_BODY_RENDER_SHAPE
} from '../../physics/gpu/gpu_circle_body_abi.js';
import {
    GAMEPLAY_ALLEGIANCE_POLICY,
    GAMEPLAY_TEAM_ID
} from '../../contract/gameplay_team_contract.js';

export const GPU_CORE_PROXY_WORLD_KIND_ID = 'core-proxy';
export const GPU_CORE_PROXY_DEFINITION_ID = 'the-core-interaction-proxy';

function requireFinitePosition(source) {
    const x = Number(source?.x);
    const y = Number(source?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new TypeError('GPU Core proxy에는 유한한 authored position이 필요합니다.');
    }
    return Object.freeze({ x, y });
}

/** CPU CoreIntegrity와 분리된 invisible enter-only GPU interaction proxy입니다. */
export function createGpuCoreProxySpawnIntent(options) {
    return Object.freeze({
        kindId: GPU_CORE_PROXY_WORLD_KIND_ID,
        definitionId: GPU_CORE_PROXY_DEFINITION_ID,
        teamId: GAMEPLAY_TEAM_ID.NEUTRAL,
        allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.EXPLICIT_OVERRIDE,
        position: requireFinitePosition(options?.position),
        velocity: Object.freeze({ x: 0, y: 0 }),
        radius: THE_CORE_DATA.RADIUS_TILES,
        inverseMass: 0,
        bodyLayer: GPU_CIRCLE_BODY_COLLISION_LAYER.KINEMATIC_OBSTACLE,
        collisionMask: 0,
        interactionLayer: GPU_CIRCLE_BODY_COLLISION_LAYER.CORE_PROXY,
        interactionMask: GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY,
        contactHandler: Object.freeze({
            damageSelf: 0,
            damageOther: 0,
            flags: GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_ENTER_ONLY
        }),
        renderStyle: Object.freeze({
            color: Object.freeze([0, 0, 0, 0]),
            radiusScale: 1,
            visible: false,
            shapeCode: GPU_CIRCLE_BODY_RENDER_SHAPE.CIRCLE
        })
    });
}
