export class BaseScene {
    /**
     * @param {object} sceneHandler - 씬 핸들러 인스턴스
     */
    constructor(sceneHandler) {
        this.sceneHandler = sceneHandler;
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
}
