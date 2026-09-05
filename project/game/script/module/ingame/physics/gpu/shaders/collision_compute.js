import { COLLISION_COMMON_WGSL } from './collision_common.js';
import { COLLISION_FIXED_COMMANDS_WGSL } from './collision_fixed_commands.js';
import { COLLISION_ENEMY_BEHAVIOR_WGSL } from './collision_enemy_behavior.js';
import { COLLISION_INTEGRATION_GRID_WGSL } from './collision_integration_grid.js';
import { COLLISION_CONTACT_DETECTION_WGSL } from './collision_contact_detection.js';
import { COLLISION_DAMAGE_WINDOW_WGSL } from './collision_damage_window.js';
import { COLLISION_ATOMIC_TRANSFORM_WGSL } from './collision_atomic_transform.js';
import { COLLISION_CONTACT_RESOLUTION_WGSL } from './collision_contact_resolution.js';
import { COLLISION_POSITION_SOLVER_WGSL } from './collision_position_solver.js';

/** Ordered source composition only; dispatch order belongs to the simulation. */
export const GPU_COLLISION_COMPUTE_WGSL = [
    COLLISION_COMMON_WGSL,
    COLLISION_FIXED_COMMANDS_WGSL,
    COLLISION_ENEMY_BEHAVIOR_WGSL,
    COLLISION_INTEGRATION_GRID_WGSL,
    COLLISION_CONTACT_DETECTION_WGSL,
    COLLISION_DAMAGE_WINDOW_WGSL,
    COLLISION_ATOMIC_TRANSFORM_WGSL,
    COLLISION_CONTACT_RESOLUTION_WGSL,
    COLLISION_POSITION_SOLVER_WGSL
].join('');
