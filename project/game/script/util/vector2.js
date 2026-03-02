import { mathUtil } from 'util/math_util.js';

/**
 * @class Vector2
 * @description 2D 벡터를 표현하는 클래스입니다. 덧셈, 뺄셈, 스케일링, 정규화 등의 연산을 지원합니다.
 */
export class Vector2 {
    /**
     * @param {number} x - x 성분
     * @param {number} y - y 성분
     */
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }

    /**
     * 다른 벡터를 더한 새 벡터를 반환합니다.
     * @param {Vector2} v - 더할 벡터
     * @returns {Vector2} 합산 결과 벡터
     */
    add(v) {
        return new Vector2(this.x + v.x, this.y + v.y);
    }

    /**
     * 다른 벡터를 뺀 새 벡터를 반환합니다.
     * @param {Vector2} v - 뺄 벡터
     * @returns {Vector2} 차 결과 벡터
     */
    sub(v) {
        return new Vector2(this.x - v.x, this.y - v.y);
    }

    /**
     * 스칼라를 곱한 새 벡터를 반환합니다.
     * @param {number} num - 곱할 스칼라 값
     * @returns {Vector2} 스케일된 벡터
     */
    mul(num) {
        return new Vector2(this.x * num, this.y * num);
    }

    /**
     * 스칼라로 나눈 새 벡터를 반환합니다. 0으로 나눌 경우 영벡터를 반환합니다.
     * @param {number} num - 나눌 스칼라 값
     * @returns {Vector2} 나눗셈 결과 벡터
     */
    div(num) {
        if (num == 0) {
            return new Vector2(0, 0);
        } else {
            return new Vector2(this.x / num, this.y / num);
        }
    }

    /**
     * 다른 벡터만큼 각 성분을 감소시키되 0 미만으로 내려가지 않는 벡터를 반환합니다.
     * @param {Vector2} v - 감소량 벡터
     * @returns {Vector2} 감소 결과 벡터 (각 성분 최소 0)
     */
    reduce(v) {
        return new Vector2(Math.max(this.x - v.x, 0), Math.max(this.y - v.y, 0));
    }

    /**
     * 정규화된 단위 벡터를 반환합니다.
     * @returns {Vector2} 길이가 1인 단위 벡터
     */
    normalize() {
        let len = Math.sqrt(this.x * this.x + this.y * this.y);
        return new Vector2(this.x / len, this.y / len);
    }

    /**
     * 벡터의 길이를 반환합니다.
     * @returns {number} 벡터의 유클리드 거리
     */
    getLength() {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }

    /**
     * 벡터의 길이의 제곱을 반환합니다. 제곱근 연산을 피해 비교에 사용합니다.
     * @returns {number} 벡터 길이의 제곱값
     */
    getLengthSquare() {
        return this.x * this.x + this.y * this.y;
    }

    /**
     * 현재 벡터를 각도(도)만큼 회전시킨 새 단위 벡터를 반환합니다.
     * @param {number} degree - 회전할 각도 (도)
     * @returns {Vector2} 회전된 단위 벡터
     */
    addDeg(degree) {
        let deg = mathUtil().vecToDeg(this);
        deg += degree;
        return mathUtil().degToVec(deg);
    }

    /**
     * 동일한 값을 가진 새 벡터를 반환합니다.
     * @returns {Vector2} 복제된 벡터
     */
    clone() {
        return new Vector2(this.x, this.y);
    }
}