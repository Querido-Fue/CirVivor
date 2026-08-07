/**
 * GPU mixed-body simulation을 게임 코드에서 가져다 쓰는 안정적인 공개 import 경계입니다.
 * 저수준 구현 파일 위치가 바뀌어도 이 모듈 경로는 유지합니다.
 */
export {
    GpuSimulationEndpoint,
    GpuEnemySimulationEndpoint,
    createGpuSimulationEndpoint,
    createGpuEnemySimulationEndpoint
} from './object/enemy/gpu_enemy_simulation_endpoint.js';

export {
    GPU_BODY_PRESENTATION_PROFILE
} from './physics/gpu/gpu_body_presentation_clock.js';

export {
    GPU_ENEMY_FIRST_TARGET_WAYPOINT_INDEX,
    GPU_ENEMY_WORLD_KIND_ID,
    createGpuEnemySpawnIntent
} from './object/enemy/gpu_enemy_spawn_adapter.js';

export {
    GPU_PROJECTILE_CONTACT_HANDLER_FLAGS,
    GPU_PROJECTILE_WORLD_KIND_ID,
    GpuProjectileSpawnAdapter,
    createGpuProjectileCommandId,
    createGpuProjectileSpawnIntent,
    requestGpuProjectileSpawn
} from './object/projectile/gpu_projectile_spawn_adapter.js';

export {
    GPU_BODY_CONTROL_PROGRAM_ABI_VERSION,
    GPU_FIXED_PRIMITIVE_ABI,
    GPU_FIXED_PROGRAM_STATUS,
    GPU_SPAWN_PROGRAM_ABI_VERSION,
    GPU_SPAWN_PROGRAM_MODE,
    GPU_SPAWN_PROGRAM_RESULT
} from './physics/gpu/gpu_fixed_primitive_abi.js';

export {
    GAME_WORLD_SESSION_MODE,
    assertGameWorldSessionMode,
    resolveGameWorldSessionPolicy,
    selectGameWorldSessionMode
} from './game_world_session_mode.js';

export {
    GPU_TOWER_DEFINITION_ID,
    GPU_TOWER_WORLD_KIND_ID,
    createGpuTowerSpawnIntent
} from './object/tower/gpu_tower_spawn_adapter.js';

export {
    GPU_CORE_PROXY_DEFINITION_ID,
    GPU_CORE_PROXY_WORLD_KIND_ID,
    createGpuCoreProxySpawnIntent
} from './object/core/gpu_core_proxy_spawn_adapter.js';
