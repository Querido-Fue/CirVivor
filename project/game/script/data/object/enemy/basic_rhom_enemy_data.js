import {
    ENEMY_CAPABILITY_ID
} from 'ingame/contract/enemy_capability_contract.js';
import {
    MAIN_GPU_ENEMY_COLOR_RGBA,
    MAIN_GPU_ENEMY_COMBAT_PROFILE_ID,
    MAIN_GPU_ENEMY_PHYSICS_PROFILE_ID
} from './enemy_profile_catalog_data.js';
import {
    BASIC_RHOM_BEHAVIOR_PROFILE_ID,
    BASIC_RHOM_ENEMY_DEFINITION_ID
} from './basic_rhom_profile_data.js';

export {
    BASIC_RHOM_ATTACK_DEFINITION_ID,
    BASIC_RHOM_BEHAVIOR_PROFILE_ID,
    BASIC_RHOM_BEHAVIOR_PROFILE_SOURCE,
    BASIC_RHOM_ENEMY_DEFINITION_ID
} from './basic_rhom_profile_data.js';
export const BASIC_RHOM_PHYSICS_PROFILE_ID = MAIN_GPU_ENEMY_PHYSICS_PROFILE_ID;
export const BASIC_RHOM_COMBAT_PROFILE_ID = MAIN_GPU_ENEMY_COMBAT_PROFILE_ID;

export const BASIC_RHOM_CAPABILITY_IDS = Object.freeze([
    ENEMY_CAPABILITY_ID.NAVIGATION,
    ENEMY_CAPABILITY_ID.TARGETING,
    ENEMY_CAPABILITY_ID.CONTACT_COMBAT,
    ENEMY_CAPABILITY_ID.CORE_IMPACT
]);

/**
 * Turn 2 profile catalog가 normalize할 Diamond M definition source입니다.
 * Phase 1에서는 catalog 파일과 충돌하지 않도록 source만 제공하며 flat runtime
 * stat을 별도 authority로 복제하지 않습니다.
 */
export const BASIC_RHOM_ENEMY_DEFINITION_SOURCE = Object.freeze({
    id: BASIC_RHOM_ENEMY_DEFINITION_ID,
    shapeDefinitionId: 'rhom',
    physicsProfileId: BASIC_RHOM_PHYSICS_PROFILE_ID,
    combatProfileId: BASIC_RHOM_COMBAT_PROFILE_ID,
    behaviorProfileId: BASIC_RHOM_BEHAVIOR_PROFILE_ID,
    capabilityIds: BASIC_RHOM_CAPABILITY_IDS,
    render: Object.freeze({
        colorRgba: MAIN_GPU_ENEMY_COLOR_RGBA,
        radiusScale: 1
    })
});
