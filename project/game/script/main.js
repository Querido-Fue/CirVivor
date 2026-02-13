
import { SystemHandler } from './module/system_handler.js';
import { TimeHandler } from './time_handler.js';
import { MathUtil } from './util/math_util.js';
import { ColorUtil } from './util/color_util.js';

let systemHandler;
let Game;

/**
 * 게임의 메인 진입점입니다.
 * 리소스 로딩, 시스템 초기화, 게임 루프 시작을 담당합니다.
 */
window.onload = async () => {
    // 시간 핸들러 초기화
    new TimeHandler();

    // 유틸리티 클래스 초기화
    new MathUtil();
    new ColorUtil();

    // 시스템 핸들러 초기화 및 모듈 로딩
    systemHandler = new SystemHandler();
    await systemHandler.init();

    // 게임 앱 인스턴스 생성 및 글로벌 변수 등록
    Game = new App(systemHandler);
    window.Game = Game;

    // 게임 루프 시작
    loop();
}

/**
 * 게임의 메인 루프 함수입니다.
 * 매 프레임마다 requestAnimationFrame을 통해 호출되며, 게임의 틱(tick)을 실행합니다.
 */
const loop = () => {
    requestAnimationFrame(loop);
    Game.tick();
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
    }

    /**
     * 매 프레임 실행되는 게임의 메인 로직입니다.
     * SystemHandler의 tick 메서드를 호출하여 모든 시스템을 업데이트하고 그립니다.
     */
    tick() {
        this.systemHandler.tick();
    }

    resize() {
        this.systemHandler.resize();
    }

    /**
     * 게임 종료를 시도합니다.
     * 현재 씬에 exit 메서드가 있으면 호출하고, 없으면 바로 종료합니다.
     */
    tryClose() {
        if (this.systemHandler && this.systemHandler.sceneSystem && this.systemHandler.sceneSystem.scene) {
            const currentScene = this.systemHandler.sceneSystem.scene;
            if (typeof currentScene.exit === 'function') {
                currentScene.exit();
                return;
            }
        }
        this.close();
    }

    /**
     * 게임을 종료합니다.
     * 모든 데이터를 저장한 후 창을 닫습니다.
     */
    close() {
        this.systemHandler.saveSystem.saveAll().then(() => {
            window.close();
        });
    }
}