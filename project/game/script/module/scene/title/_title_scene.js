import { BaseScene } from 'scene/_base_scene.js';
import { getUIOffsetX, getUIWW, getWH, getWW } from 'display/display_system.js';
import { TitleGradientBackground } from './_title_gradient_background.js';
import { TitleBackGround } from './_title_background.js';
import { TitleLoadingSequence } from './_title_loading_sequence.js';

/**
 * @class TitleScene
 * @description `SceneSystem`의 활성 타이틀 씬으로서 그라디언트 배경, 타이틀 적·실드 배경과
 * 로딩 시퀀스를 소유하고 BaseScene 수명 주기 및 overlay·씬 전환 요청을 라우팅합니다.
 */
export class TitleScene extends BaseScene {
    /**
     * @param {object} sceneSystem - 씬 시스템 인스턴스
     */
    constructor(sceneSystem) {
        super(sceneSystem);
        this.WW = 0;
        this.WH = 0;
        this.UIWW = 0;
        this.UIOffsetX = 0;
        this._syncViewportMetrics();
        this.titleGradientBackground = new TitleGradientBackground();
        this.titleBackground = new TitleBackGround(this, { drawBackgroundFill: false });
        this.loadingSequence = new TitleLoadingSequence(this);
    }

    /**
     * @override
     * 타이틀 배경과 로딩 시퀀스를 갱신합니다.
     */
    update() {
        if (this.titleGradientBackground) {
            this.titleGradientBackground.update();
        }
        if (this.loadingSequence) {
            this.loadingSequence.update();
        }
        if (this.titleBackground) {
            this.titleBackground.update(
                this.loadingSequence?.getEnemyShieldLayout?.() || null,
                this.loadingSequence?.isEnemySpawnReady?.() === true
            );
        }
    }

    /**
     * @override
     * 타이틀 화면을 렌더링합니다.
     */
    draw() {
        if (this.titleGradientBackground) {
            this.titleGradientBackground.draw();
        }
        if (this.titleBackground) {
            this.titleBackground.draw();
        }
        if (this.loadingSequence) {
            this.loadingSequence.draw();
        }
    }

    /**
     * @override
     * 화면 크기 변경 시 배경과 로딩 시퀀스 배치를 다시 계산합니다.
     */
    resize() {
        this._syncViewportMetrics();
        if (this.titleGradientBackground) {
            this.titleGradientBackground.resize();
        }
        if (this.titleBackground) {
            this.titleBackground.resize();
        }
        if (this.loadingSequence) {
            this.loadingSequence.resize();
        }
    }

    /**
     * @override
     * 타이틀 씬이 보유한 서브 모듈을 순서대로 정리하고 열린 타이틀 overlay를 닫습니다.
     * @returns {void}
     */
    destroy() {
        if (this.titleGradientBackground) {
            this.titleGradientBackground.destroy();
            this.titleGradientBackground = null;
        }
        if (this.titleBackground) {
            this.titleBackground.destroy();
            this.titleBackground = null;
        }
        if (this.loadingSequence) {
            this.loadingSequence.destroy();
            this.loadingSequence = null;
        }
        this.closeTitleOverlay();
    }

    /**
     * 타이틀 overlay를 엽니다.
     * @param {'mapSelect'|'deck'|'setting'|'credits'|'quickStart'|'records'|'research'|'achievements'} menu - 열 overlay 메뉴입니다.
     * @returns {string|null} 생성된 overlay id입니다.
     */
    openTitleOverlay(menu) {
        return this.sceneSystem.systemHandler.overlayManager.openTitleOverlay(menu, this);
    }

    /**
     * 타이틀 overlay를 닫습니다.
     */
    closeTitleOverlay() {
        this.sceneSystem.systemHandler.overlayManager.closeTitleOverlay();
    }

    /**
     * 종료 확인 overlay를 엽니다.
     * @returns {string|null} 생성된 overlay id입니다.
     */
    openExitOverlay() {
        return this.sceneSystem.systemHandler.overlayManager.openExitOverlay();
    }

    /**
     * 게임 시작을 요청합니다.
     * @param {string} [mapId] - 시작할 맵 ID입니다.
     */
    gameStart(mapId) {
        this.sceneSystem.gameStart(mapId);
    }

    /**
     * 벤치마크 씬 시작을 요청합니다.
     */
    benchmarkStart() {
        this.sceneSystem.benchmarkStart();
    }

    /**
     * @override
     * 타이틀 적의 고정 틱 갱신을 처리합니다.
     */
    fixedUpdate() {
        if (this.titleBackground) {
            this.titleBackground.fixedUpdate();
        }
    }

    /**
     * @override
     * theme 변경이 있으면 타이틀 배경에 먼저 반영하고, 변경 종류와 관계없이 동일한 설정 객체를 로딩 시퀀스에 전달합니다.
     * @param {object} [changedSettings={}] - 변경된 설정 키와 값입니다.
     * @returns {void}
     */
    applyRuntimeSettings(changedSettings = {}) {
        if (changedSettings.theme !== undefined) {
            if (this.titleBackground && typeof this.titleBackground.applyTheme === 'function') {
                this.titleBackground.applyTheme();
            }
        }
        if (this.loadingSequence && typeof this.loadingSequence.applyRuntimeSettings === 'function') {
            this.loadingSequence.applyRuntimeSettings(changedSettings);
        }
    }

    /**
     * 현재 표시 viewport metric을 씬 상태에 동기화합니다.
     * @private
     */
    _syncViewportMetrics() {
        this.WW = getWW();
        this.WH = getWH();
        this.UIWW = getUIWW();
        this.UIOffsetX = getUIOffsetX();
    }
}
