import { getUIOffsetX, getUIWW, getWH, getWW } from 'display/display_system.js';

/**
 * LoadingScene과 TitleScene 전환을 가로질러 메뉴·overlay action과 viewport 기준을 유지합니다.
 */
export class TitleSceneController {
    /**
     * @param {object} sceneSystem - 상위 씬 시스템입니다.
     */
    constructor(sceneSystem) {
        this.sceneSystem = sceneSystem;
        this.loadingSequence = null;
        this.WW = 0;
        this.WH = 0;
        this.UIWW = 0;
        this.UIOffsetX = 0;
        this.syncViewportMetrics();
    }

    /**
     * 메뉴가 조회할 현재 타이틀 전환 상태 제공자를 교체합니다.
     * `loadingSequence` 이름은 기존 TitleMenu의 private 조회 계약을 유지합니다.
     * @param {object|null} content - loading 또는 완료된 title content입니다.
     */
    setTitleContent(content) {
        this.loadingSequence = content || null;
    }

    /** 현재 표시 viewport metric을 동기화합니다. */
    syncViewportMetrics() {
        this.WW = getWW();
        this.WH = getWH();
        this.UIWW = getUIWW();
        this.UIOffsetX = getUIOffsetX();
    }

    /** @param {string} menu - 열 타이틀 overlay 키입니다. */
    openTitleOverlay(menu) {
        return this.sceneSystem.systemHandler.overlayManager.openTitleOverlay(menu, this);
    }

    /** 열린 타이틀 overlay를 닫습니다. */
    closeTitleOverlay() {
        this.sceneSystem.systemHandler.overlayManager.closeTitleOverlay();
    }

    /** 종료 확인 overlay를 엽니다. */
    openExitOverlay() {
        return this.sceneSystem.systemHandler.overlayManager.openExitOverlay();
    }

    /** @param {string} [mapId] - 시작할 맵 ID입니다. */
    gameStart(mapId) {
        this.sceneSystem.gameStart(mapId);
    }

    /** 벤치마크 씬 시작을 요청합니다. */
    benchmarkStart() {
        this.sceneSystem.benchmarkStart();
    }
}
