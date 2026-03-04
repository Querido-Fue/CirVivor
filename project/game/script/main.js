
import { SystemHandler } from 'game/module/system_handler.js';
import { TimeHandler } from 'game/time_handler.js';
import { MathUtil } from 'util/math_util.js';
import { ColorUtil } from 'util/color_util.js';
import { RuntimeTool, runtimeTool } from 'util/runtime_tool.js';
import { showExitConfirmation } from 'overlay/overlay_system.js';

let systemHandler;
let Game;

/**
 * 게임의 메인 진입점입니다.
 * 리소스 로딩, 시스템 초기화, 게임 루프 시작을 담당합니다.
 */
window.onload = async () => {
    try {
        // 시간 핸들러 초기화
        new TimeHandler();

        // 유틸리티 클래스 초기화
        new MathUtil();
        new ColorUtil();
        new RuntimeTool();

        // 시스템 핸들러 초기화 및 모듈 로딩
        systemHandler = new SystemHandler();
        await systemHandler.init();

        // 게임 앱 인스턴스 생성 및 글로벌 변수 등록
        Game = new App(systemHandler);
        window.Game = Game;

        // 브라우저 프레임 루프 및 고정 틱 루프 시작
        Game.start();
    } catch (e) {
        console.warn("게임 초기화 중 오류가 발생했습니다\n", e);
    }
}


/**
 * 창 크기 변경 시 호출되는 이벤트 핸들러입니다.
 * 게임 화면을 리로드하여 크기 변경에 대응합니다.
 */
window.addEventListener('resize', () => {
    if (Game) {
        Game.resize();
    }
});

/**
 * @class App
 * @description 게임의 최상위 애플리케이션 클래스입니다.
 * SystemHandler를 통해 게임의 전반적인 상태를 관리하고, 종료 로직을 수행합니다.
 */
class App {
    /**
     * App 클래스의 생성자입니다.
     * @param {SystemHandler} systemHandler - 게임 시스템들을 관리하는 핸들러 인스턴스
     */
    constructor(systemHandler) {
        this.systemHandler = systemHandler;
        this.fixedLoopId = null;
        this._boundLoop = this.loop.bind(this);
        this._boundFixedTick = this.fixedTick.bind(this);
    }

    /**
     * 렌더 루프와 고정 틱 루프를 시작합니다.
     */
    start() {
        this.loop();
        this.startFixedTick();
    }

    /**
     * 매 프레임 실행되는 게임의 메인 로직입니다.
     * SystemHandler의 tick 메서드를 호출하여 모든 시스템을 업데이트하고 그립니다.
     */
    loop() {
        requestAnimationFrame(this._boundLoop);
        try {
            this.systemHandler.tick();
        } catch (e) {
            console.warn("프레임 루프 중 오류가 발생했습니다\n", e);
        }
    }

    /**
     * 60Hz 고정 업데이트 루프를 시작합니다.
     */
    startFixedTick() {
        if (this.fixedLoopId !== null) {
            clearInterval(this.fixedLoopId);
        }
        this.fixedLoopId = setInterval(this._boundFixedTick, 1000 / 60);
    }

    /**
     * 고정 업데이트 루프를 정지합니다.
     */
    stopFixedTick() {
        if (this.fixedLoopId === null) return;
        clearInterval(this.fixedLoopId);
        this.fixedLoopId = null;
    }

    /**
     * 고정 틱에서 고정 업데이트 대상 모듈을 갱신합니다.
     */
    fixedTick() {
        try {
            this.systemHandler.fixedUpdate();
        } catch (e) {
            console.warn("고정 틱 루프 중 오류가 발생했습니다\n", e);
        }
    }

    /**
     * 게임 화면 크기를 변경합니다.
     */
    resize() {
        this.systemHandler.resize();
    }

    /**
     * 게임 종료를 시도합니다.
     * 현재 씬에 exit 메서드가 있으면 호출하고, 없으면 바로 종료합니다.
     */
    tryClose() {
        try {
            showExitConfirmation();
        } catch (e) {
            this.close();
        }
    }

    /**
     * 게임을 종료합니다.
     * 모든 데이터를 저장한 후 창을 닫습니다.
     */
    close() {
        this.stopFixedTick();
        this.systemHandler.saveSystem.saveAll().then(() => {
            setTimeout(() => runtimeTool().closeWindow(), 100);
        });
    }
}
