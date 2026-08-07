import {
    THE_TOWER_DATA,
    THE_TOWER_RENDER_DATA
} from 'data/object/tower/the_tower_data.js';
import {
    GPU_CIRCLE_BODY_COLLISION_LAYER,
    GPU_CIRCLE_BODY_RENDER_SHAPE
} from '../../physics/gpu/gpu_circle_body_abi.js';

export const GPU_TOWER_WORLD_KIND_ID = 'tower';
export const GPU_TOWER_DEFINITION_ID = 'the-tower';

function requireFinitePosition(source, label) {
    const x = Number(source?.x);
    const y = Number(source?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new TypeError(`${label}에는 유한한 x/y가 필요합니다.`);
    }
    return Object.freeze({ x, y });
}

/** TileMap의 authored Tower 위치를 persistent controlled GPU body intent로 바꿉니다. */
export function createGpuTowerSpawnIntent(options) {
    const position = requireFinitePosition(options?.position, 'GPU Tower position');
    return Object.freeze({
        kindId: GPU_TOWER_WORLD_KIND_ID,
        definitionId: GPU_TOWER_DEFINITION_ID,
        position,
        velocity: Object.freeze({ x: 0, y: 0 }),
        radius: THE_TOWER_DATA.RADIUS_TILES,
        inverseMass: 1 / THE_TOWER_DATA.MASS,
        bodyLayer: GPU_CIRCLE_BODY_COLLISION_LAYER.KINEMATIC_OBSTACLE,
        collisionMask: GPU_CIRCLE_BODY_COLLISION_LAYER.TERRAIN,
        interactionLayer: GPU_CIRCLE_BODY_COLLISION_LAYER.KINEMATIC_OBSTACLE,
        interactionMask: 0,
        renderStyle: Object.freeze({
            color: THE_TOWER_RENDER_DATA.COLOR_RGBA,
            radiusScale: THE_TOWER_RENDER_DATA.RADIUS_SCALE,
            visible: true,
            shapeCode: GPU_CIRCLE_BODY_RENDER_SHAPE.CIRCLE
        })
    });
}
