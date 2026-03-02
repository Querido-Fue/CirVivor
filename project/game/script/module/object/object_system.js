let objectSystemInstance = null;

/**
 * @class ObjectSystem
 * @description 게임 오브젝트의 생명주기(초기화/업데이트/고정업데이트/렌더)를 담당합니다.
 */
export class ObjectSystem {
    constructor() {
        objectSystemInstance = this;
    }

    /**
     * 오브젝트 시스템을 초기화합니다.
     */
    async init() {
    }

    /**
     * 모든 오브젝트를 업데이트합니다.
     */
    update() {
    }

    /**
     * 모든 오브젝트를 고정 프레임으로 업데이트합니다.
     */
    fixedUpdate() {
    }

    /**
     * 모든 오브젝트를 그립니다.
     */
    draw() {
    }
}
