import {
    createMainGpuEnemyDefinition
} from './main_gpu_enemy_definition_data.js';

export const ARCHER_ENEMY_DEFINITION_ID = 'archer_01';
export const ARCHER_ATTACK_DEFINITION_ID = 'archer_basic_shot_01';

/**
 * R1 Turn 4 technical Archer content입니다.
 * 기존 Core route 이동과 arrow geometry를 공유하지만 basic_arrow_01과는 별도 identity입니다.
 */
export const ARCHER_ENEMY_DATA = createMainGpuEnemyDefinition(
    ARCHER_ENEMY_DEFINITION_ID,
    'arrow',
    { attackDefinitionId: ARCHER_ATTACK_DEFINITION_ID }
);
