/**
 * 벤치마크 UI가 frame-boundary queue를 통해 전달하는 semantic command 목록입니다.
 * CPU 보조 오브젝트와 GPU mixed-body spawn 요청을 구분합니다.
 */
export const BENCHMARK_SCENE_COMMAND_TYPES = Object.freeze({
    REPLACE_AUXILIARY_WORLD: 'benchmarkScene.replaceAuxiliaryWorld',
    SPAWN_GPU_ENEMY_BATCH: 'benchmarkScene.spawnGpuEnemyBatch',
    SPAWN_GPU_PROJECTILE_BATCH: 'benchmarkScene.spawnGpuProjectileBatch',
    APPEND_BOX_WALLS: 'benchmarkScene.appendBoxWalls',
    DESTROY_AUXILIARY_WORLD: 'benchmarkScene.destroyAuxiliaryWorld'
});
