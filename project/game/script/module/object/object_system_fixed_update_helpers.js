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
 * @param {{aiSharedFlowFieldByKey?: Map, aiSharedDirectPathByKey?: Map, aiSharedDensityFieldByKey?: Map, aiSharedPolicyTargetByKey?: Map}} system - ObjectSystem 인스턴스입니다.
 */
export function clearObjectSystemAISharedCaches(system) {
    system.aiSharedFlowFieldByKey?.clear();
    system.aiSharedDirectPathByKey?.clear();
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
        sharedDirectPathByKey: options?.sharedDirectPathByKey,
        sharedDensityFieldByKey: options?.sharedDensityFieldByKey,
        sharedPolicyTargetByKey: options?.sharedPolicyTargetByKey,
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
