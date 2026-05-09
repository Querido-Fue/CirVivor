/**
 * 게임 씬 시뮬레이션에서 사용하는 커맨드 타입 목록입니다.
 */
export const GAME_SCENE_COMMAND_TYPES = Object.freeze({
    REPLACE_WORLD: 'gameScene.replaceWorldState',
    SPAWN_ENEMY_BATCH: 'gameScene.spawnEnemyBatch',
    APPEND_BOX_WALLS: 'gameScene.appendBoxWalls',
    APPEND_PROJECTILES: 'gameScene.appendProjectiles',
    DESTROY_WORLD: 'gameScene.destroyWorld'
});
