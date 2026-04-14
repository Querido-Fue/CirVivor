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
     * @param {object} [options={}] - 현재 프레임의 실행 보조 옵션입니다.
     */
    update(options = {}) {
        void options;
    }

    /**
     * 고정 틱 업데이트 훅입니다. (오버라이드 선택)
     */
    fixedUpdate() {
    }

    /**
     * 씬을 그립니다. (오버라이드 필요)
     */
    draw() {
    }

    /**
     * 읽기 전용 시뮬레이션 스냅샷으로 현재 씬을 그립니다. (오버라이드 선택)
     * @param {object|null} [sceneSnapshot=null]
     * @param {object} [options={}]
     * @returns {boolean}
     */
    drawSimulationSnapshot(sceneSnapshot = null, options = {}) {
        void sceneSnapshot;
        void options;
        return false;
    }

    /**
         * 창 크기 변경 시 씬 구성요소의 크기를 재산정합니다. (오버라이드 필요)
         */
    resize() {
    }

    /**
     * 런타임 설정 변경을 현재 씬에 반영합니다. (오버라이드 선택)
     * @param {object} [changedSettings={}] - 변경된 설정 키와 값입니다.
     */
    applyRuntimeSettings(changedSettings = {}) {
        void changedSettings;
    }

    /**
     * 프레임 경계에서 전달된 시뮬레이션 명령을 처리합니다. (오버라이드 선택)
     * @param {object[]} [commands=[]] - 처리할 명령 목록입니다.
     */
    applySimulationCommands(commands = []) {
        void commands;
    }

    /**
     * 현재 씬의 읽기 전용 시뮬레이션 스냅샷을 생성합니다. (오버라이드 선택)
     * @returns {object|null}
     */
    createSimulationSnapshot() {
        return null;
    }

    /**
     * 현재 프레임의 동적 시뮬레이션 상태만 모은 스냅샷을 생성합니다. (오버라이드 선택)
     * @returns {object|null}
     */
    createSimulationFrameSnapshot() {
        return null;
    }

    /**
     * 현재 씬이 내부적으로 생성한 시뮬레이션 명령을 반환하고 큐를 비웁니다. (오버라이드 선택)
     * @returns {object[]}
     */
    consumeSimulationCommands() {
        return [];
    }
}
