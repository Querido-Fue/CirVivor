import { ENEMY_AI_CONSTANTS } from '../../data/object/enemy/enemy_ai_constants.js';
import { getSimulationObjectWH, getSimulationWW } from '../simulation/simulation_runtime.js';
import { EnemySpatialIndex } from './enemy/ai/enemy_spatial_index.js';

const DEFAULT_ENEMY_AI_PROFILE = ENEMY_AI_CONSTANTS.QUALITY_PROFILES[
    ENEMY_AI_CONSTANTS.DEFAULT_QUALITY_PROFILE
];
const OBJECT_SYSTEM_ENEMY_SPATIAL_INDEX = new EnemySpatialIndex(
    DEFAULT_ENEMY_AI_PROFILE.DENSITY_CELL_SIZE
);
const ENEMY_AI_FOOTPRINT = ENEMY_AI_CONSTANTS.FOOTPRINT;
const OBJECT_SYSTEM_ENEMY_SPATIAL_OPTIONS = {
    cellSize: DEFAULT_ENEMY_AI_PROFILE.DENSITY_CELL_SIZE,
    resolveBoundsInto: resolveObjectSystemEnemySpatialBoundsInto
};

/**
 * 큰 합체 적의 모든 회전을 포함하는 보수적 footprint 범위를 계산합니다.
 * 일반 적 파트너 탐색은 기존 중심 거리 규칙을 사용하므로 중심 셀만 필요합니다.
 * @param {object} enemy - 인덱스에 넣을 적입니다.
 * @param {{halfWidth: number, halfHeight: number}} out - 출력 버퍼입니다.
 * @returns {{halfWidth: number, halfHeight: number}} 출력 버퍼입니다.
 */
function resolveObjectSystemEnemySpatialBoundsInto(enemy, out) {
    out.halfWidth = 0;
    out.halfHeight = 0;
    if (enemy?.type !== 'hexa_hive') {
        return out;
    }

    const methodHeight = typeof enemy.getRenderHeightPx === 'function'
        ? enemy.getRenderHeightPx()
        : Number.NaN;
    const baseHeight = Number.isFinite(methodHeight) && methodHeight > 0
        ? methodHeight
        : (
            Number.isFinite(enemy.renderHeightPx) && enemy.renderHeightPx > 0
                ? enemy.renderHeightPx
                : ENEMY_AI_FOOTPRINT.FALLBACK_RENDER_HEIGHT_PX
        );
    const baseRadius = Math.max(
        ENEMY_AI_FOOTPRINT.BASE_RADIUS_MIN_PX,
        baseHeight * ENEMY_AI_FOOTPRINT.BASE_RADIUS_RATIO
    );
    const cellRadius = Math.max(
        baseRadius,
        baseHeight * ENEMY_AI_CONSTANTS.HEXA_HIVE_NAV_CELL_RADIUS_RATIO
    );
    const localCenters = Array.isArray(enemy.hexaHiveLayout?.filledLocalCenters)
        && enemy.hexaHiveLayout.filledLocalCenters.length > 0
        ? enemy.hexaHiveLayout.filledLocalCenters
        : enemy.hexaHiveLayout?.visibleLocalCenters;
    let radius = Math.max(
        cellRadius,
        Number.isFinite(enemy.navigationRadiusPx) ? Math.max(0, enemy.navigationRadiusPx) : 0
    );
    if (Array.isArray(localCenters)) {
        for (let i = 0; i < localCenters.length; i++) {
            const localX = Number.isFinite(localCenters[i]?.x) ? localCenters[i].x * baseHeight : 0;
            const localY = Number.isFinite(localCenters[i]?.y) ? localCenters[i].y * baseHeight : 0;
            radius = Math.max(radius, Math.hypot(localX, localY) + cellRadius);
        }
    }
    out.halfWidth = radius;
    out.halfHeight = radius;
    return out;
}

/**
 * active 상태인 객체 목록에 fixedUpdate를 호출합니다.
 * @param {object[]} objects - fixedUpdate 대상 객체 목록입니다.
 * @param {number} delta - 고정 스텝 시간입니다.
 */
export function fixedUpdateActiveObjectList(objects, delta) {
    if (!Array.isArray(objects)) {
        return;
    }

    for (let i = 0; i < objects.length; i++) {
        const object = objects[i];
        if (!object || object.active === false) continue;
        if (typeof object.fixedUpdate === 'function') {
            object.fixedUpdate(delta);
        }
    }
}

/**
 * ObjectSystem AI 공유 캐시를 비웁니다.
 * @param {{aiSharedFlowFieldByKey?: Map, aiSharedDensityFieldByKey?: Map, aiSharedPolicyTargetByKey?: Map}} system - ObjectSystem 인스턴스입니다.
 */
export function clearObjectSystemAISharedCaches(system) {
    system.aiSharedFlowFieldByKey?.clear();
    system.aiSharedDensityFieldByKey?.clear();
    system.aiSharedPolicyTargetByKey?.clear();
}

/**
 * 적 AI fixedUpdate 호출에 사용할 공유 문맥을 구성합니다.
 * @param {object} options - AI 문맥 생성 옵션입니다.
 * @returns {object}
 */
export function createObjectSystemAIContext(options) {
    return {
        player: options?.player ?? null,
        walls: options?.walls ?? [],
        enemies: options?.enemies ?? [],
        shouldUpdateDecision: false,
        decisionInterval: options?.decisionInterval,
        decisionGroup: options?.decisionGroup,
        enemyAIQualityProfile: options?.enemyAIQualityProfile,
        sharedFlowFieldByKey: options?.sharedFlowFieldByKey,
        sharedDensityFieldByKey: options?.sharedDensityFieldByKey,
        sharedPolicyTargetByKey: options?.sharedPolicyTargetByKey,
        enemySpatialIndex: null,
        wallsVersion: options?.wallsVersion
    };
}

/**
 * 적 ID와 fallback index를 기준으로 AI decision group을 계산합니다.
 * @param {object|null|undefined} enemy - 대상 적입니다.
 * @param {number} fallbackIndex - ID가 없을 때 사용할 배열 인덱스입니다.
 * @param {number} decisionGroupCount - decision group 개수입니다.
 * @returns {number}
 */
export function getObjectSystemEnemyDecisionGroup(enemy, fallbackIndex, decisionGroupCount) {
    const groupCount = Number.isInteger(decisionGroupCount) && decisionGroupCount > 0
        ? decisionGroupCount
        : 1;
    const sourceId = Number.isInteger(enemy?.id) ? enemy.id : fallbackIndex;
    const mod = sourceId % groupCount;
    return mod < 0 ? mod + groupCount : mod;
}

/**
 * 적 상태 지속 시간을 고정 스텝 기준으로 갱신합니다.
 * @param {object} enemy - 대상 적입니다.
 * @param {number} delta - 고정 스텝 시간입니다.
 */
function updateObjectSystemEnemyStatusTimer(enemy, delta) {
    if (!enemy?.status || enemy.status.remainingTime <= 0) {
        return;
    }

    enemy.status.remainingTime = Math.max(0, enemy.status.remainingTime - delta);
    if (enemy.status.remainingTime === 0) {
        enemy.clearStatus();
    }
}

/**
 * ObjectSystem의 적 목록을 fixed step 기준으로 갱신합니다.
 * @param {object} options - 적 fixedUpdate 옵션입니다.
 * @param {object[]} options.enemies - 적 목록입니다.
 * @param {number} options.delta - 고정 스텝 시간입니다.
 * @param {object} options.aiContext - 적 AI 공유 문맥입니다.
 * @param {number} options.decisionGroup - 이번 fixed step의 decision group입니다.
 * @param {number} options.decisionGroupCount - 전체 decision group 수입니다.
 * @param {(index: number) => void} options.releaseEnemyAt - 비활성 적 반납 콜백입니다.
 */
export function fixedUpdateObjectSystemEnemies(options) {
    const enemies = Array.isArray(options?.enemies) ? options.enemies : [];
    const delta = Number.isFinite(options?.delta) ? options.delta : 0;
    const aiContext = options?.aiContext;
    const decisionGroup = Number.isInteger(options?.decisionGroup) ? options.decisionGroup : 0;
    const decisionGroupCount = Number.isInteger(options?.decisionGroupCount) && options.decisionGroupCount > 0
        ? options.decisionGroupCount
        : 1;
    const releaseEnemyAt = typeof options?.releaseEnemyAt === 'function'
        ? options.releaseEnemyAt
        : null;

    if (delta <= 0 || !aiContext) {
        return;
    }

    const profile = ENEMY_AI_CONSTANTS.QUALITY_PROFILES[aiContext.enemyAIQualityProfile]
        || DEFAULT_ENEMY_AI_PROFILE;
    OBJECT_SYSTEM_ENEMY_SPATIAL_OPTIONS.cellSize = profile.DENSITY_CELL_SIZE;
    aiContext.enemySpatialIndex = OBJECT_SYSTEM_ENEMY_SPATIAL_INDEX.rebuild(
        enemies,
        getSimulationWW(),
        getSimulationObjectWH(),
        OBJECT_SYSTEM_ENEMY_SPATIAL_OPTIONS
    );

    for (let i = enemies.length - 1; i >= 0; i--) {
        const enemy = enemies[i];
        if (!enemy || !enemy.active) {
            if (releaseEnemyAt) {
                releaseEnemyAt(i);
            }
            continue;
        }

        enemy.beginFixedStep();
        updateObjectSystemEnemyStatusTimer(enemy, delta);

        aiContext.shouldUpdateDecision = getObjectSystemEnemyDecisionGroup(enemy, i, decisionGroupCount) === decisionGroup;
        enemy.fixedUpdate(delta, aiContext);
    }
}
