let mathUtilInstance = null;

/**
 * @class MathUtil
 * @description 게임에서 사용되는 수학 관련 유틸리티 함수들을 제공하는 클래스입니다.
 * 랜덤 값 생성, 각도 변환, Vector2 변환, Simplex Noise 등을 포함합니다.
 */
export class MathUtil {
    constructor() {
        mathUtilInstance = this;
    }
    /**
     * 최소값과 최대값 사이의 정수 난수를 반환합니다.
     * @param {number} min - 최소값
     * @param {number} max - 최대값
     * @returns {number} 랜덤 정수
     */
    randInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    /**
     * 최소값과 최대값 사이의 실수 난수를 반환합니다.
     * @param {number} min - 최소값
     * @param {number} max - 최대값
     * @returns {number} 랜덤 실수
     */
    random(min = 0, max = 1) {
        return Math.random() * (max - min) + min;
    }

    /**
     * 도(Degree)를 라디안(Radian)으로 변환합니다.
     * @param {number} degree - 각도 (도)
     * @returns {number} 라디안 값
     */
    degToRad(degree) {
        return degree * (Math.PI / 180);
    }

    /**
     * 라디안(Radian)을 도(Degree)로 변환합니다.
     * @param {number} rad - 각도 (라디안)
     * @returns {number} 도 값
     */
    radToDeg(rad) {
        return rad * (180 / Math.PI);
    }

    /**
     * 벡터를 각도(도)로 변환합니다.
     * @param {Vector2} vec - 벡터
     * @returns {number} 각도 (도)
     */
    vecToDeg(vec) {
        return this.radToDeg(Math.atan2(vec.y, vec.x));
    }

    /**
     * 벡터를 각도(라디안)로 변환합니다.
     * @param {Vector2} vec - 벡터
     * @returns {number} 각도 (라디안)
     */
    vecToRad(vec) {
        return this.degToRad(this.vecToDeg(vec));
    }

    /**
     * 각도(도)를 단위 벡터로 변환합니다.
     * @param {number} degree - 각도 (도)
     * @returns {Vector2} 단위 벡터
     */
    degToVec(degree) {
        return new Vector2(Math.cos(this.degToRad(degree)), Math.sin(this.degToRad(degree)))
    }

    /**
     * 각도(라디안)를 단위 벡터로 변환합니다.
     * @param {number} rad - 각도 (라디안)
     * @returns {Vector2} 단위 벡터
     */
    radToVec(rad) {
        return new Vector2(Math.cos(rad), Math.sin(rad))
    }

    /**
     * 지수 함수를 사용하여 값을 감소시킵니다.
     * @param {number} value - 감소시킬 값
     * @param {number} max - 최대값
     * @returns {number} 감소된 값
     */
    decay(value, max) {
        if (max === 0) return 0;
        const entry = value / max;
        const sigmoid = 2 * (1 / (1 + Math.exp(-entry)) - 0.5);
        return sigmoid * max;
    }
}

/**
 * MathUtil 싱글톤 인스턴스를 반환합니다.
 * @returns {MathUtil} MathUtil 인스턴스
 */
export function mathUtil() {
    return mathUtilInstance;
}
