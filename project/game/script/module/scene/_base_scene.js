/**
 * @class BaseScene
 * @description 모든 씬이 상속하는 기본 인터페이스 클래스입니다.
 */
export class BaseScene {
    /**
     * @param {object} sceneHandler - 씬 핸들러 인스턴스
     */
    constructor(sceneHandler) {
        this.sceneSystem = sceneHandler;
    }

    /**
     * 씬을 업데이트합니다. (오버라이드 필요)
     */
    update() {
    }

    /**
     * 씬을 그립니다. (오버라이드 필요)
     */
    draw() {
    }

    /**
         * 창 크기 변경 시 씬 구성요소의 크기를 재산정합니다. (오버라이드 필요)
         */
    resize() {
    }
}
