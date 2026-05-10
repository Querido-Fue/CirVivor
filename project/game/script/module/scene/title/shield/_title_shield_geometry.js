import { clamp01 } from 'util/number_util.js';

/**
 * 각도를 최단 경로로 보간합니다.
 * @param {number} currentAngle - 현재 각도입니다.
 * @param {number} targetAngle - 목표 각도입니다.
 * @param {number} factor - 보간 비율입니다.
 * @returns {number} 보간된 각도입니다.
 */
export function lerpShieldAngle(currentAngle, targetAngle, factor) {
    if (!Number.isFinite(currentAngle)) {
        return targetAngle;
    }

    const safeFactor = clamp01(factor);
    if (safeFactor >= 1) {
        return targetAngle;
    }

    const delta = getShieldAngularDelta(currentAngle, targetAngle);
    return currentAngle + (delta * safeFactor);
}

/**
 * 두 각도의 차이를 -PI~PI 범위로 반환합니다.
 * @param {number} angleA - 첫 번째 각도입니다.
 * @param {number} angleB - 두 번째 각도입니다.
 * @returns {number} -PI~PI 범위의 각도 차이입니다.
 */
export function getShieldAngularDelta(angleA, angleB) {
    return Math.atan2(
        Math.sin(angleB - angleA),
        Math.cos(angleB - angleA)
    );
}

/**
 * 실드 경계와 적의 거리로부터 압력 값을 계산합니다.
 * @param {number} shieldBoundaryDistance - 적과 실드 경계 사이 거리입니다.
 * @param {number} outerInfluenceRange - 실드 바깥쪽 영향 범위입니다.
 * @param {number} enemyRadius - 적 반경입니다.
 * @returns {number} 0~1 범위의 정규화된 압력 값입니다.
 */
export function calculateShieldPressure(shieldBoundaryDistance, outerInfluenceRange, enemyRadius) {
    return clamp01((outerInfluenceRange - shieldBoundaryDistance) / Math.max(1, outerInfluenceRange + enemyRadius));
}

/**
 * 경계선 0 부근의 흔들림을 제거한 거리 값을 반환합니다.
 * @param {number} boundaryDistance - 원본 실드 경계 거리입니다.
 * @param {number} epsilon - 0으로 처리할 허용 오차입니다.
 * @returns {number} 안정화된 경계 거리입니다.
 */
export function stabilizeShieldBoundaryDistance(boundaryDistance, epsilon) {
    if (!Number.isFinite(boundaryDistance)) {
        return 0;
    }

    if (epsilon <= 0 || Math.abs(boundaryDistance) > epsilon) {
        return boundaryDistance;
    }

    return 0;
}

/**
 * 적이 타이틀 실드 자기장에 반응하는 대상인지 반환합니다.
 * @param {object|null|undefined} enemy - 평가할 적 인스턴스입니다.
 * @returns {boolean} 실드 자기장 반응 대상 여부입니다.
 */
export function isShieldReactiveEnemy(enemy) {
    const motionScale = Number.isFinite(enemy?._titleParallaxMotionScale)
        ? enemy._titleParallaxMotionScale
        : 1;
    return motionScale > 0;
}

/**
 * 적의 화면 기준 근사 반경을 반환합니다.
 * @param {object|null|undefined} enemy - 적 인스턴스입니다.
 * @returns {number} 화면 기준 근사 반경입니다.
 */
export function getEnemyScreenRadius(enemy) {
    if (!enemy || typeof enemy.getRenderHeightPx !== 'function') {
        return 0;
    }

    const baseHeight = enemy.getRenderHeightPx();
    const renderHeight = baseHeight * (Number.isFinite(enemy.heightScale) ? enemy.heightScale : 1);
    const renderWidth = baseHeight * (Number.isFinite(enemy.aspectRatio) ? enemy.aspectRatio : 1);
    return Math.max(renderWidth, renderHeight) * 0.5;
}
