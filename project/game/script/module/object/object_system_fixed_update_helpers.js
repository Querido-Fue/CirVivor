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
