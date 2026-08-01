import { BaseScene } from 'scene/_base_scene.js';

/**
 * @class TitleScene
 * @description LoadingScene의 이동 직전 presentation을 이어받아 원·로고 이동부터 정상 타이틀까지 소유합니다.
 */
export class TitleScene extends BaseScene {
    /**
     * @param {object} sceneSystem - 씬 시스템 인스턴스입니다.
     * @param {object} handoff - LoadingScene이 넘긴 동일 identity 상태입니다.
     * @param {import('./_title_scene_presentation.js').TitleScenePresentation} handoff.presentation - 이동 직전 타이틀 presentation입니다.
     * @param {import('./_title_scene_controller.js').TitleSceneController} handoff.titleController - 안정적인 타이틀 action controller입니다.
     * @param {Readonly<object>} [handoff.titleGpuRolloutProfile=null] - Loading에서 고정한 rollout profile입니다.
     */
    constructor(sceneSystem, { presentation, titleController, titleGpuRolloutProfile = null }) {
        super(sceneSystem);
        this.presentation = presentation;
        this.titleController = titleController;
        this.titleGpuRolloutProfile = titleGpuRolloutProfile;
        if (this.presentation?.beginTitleScenePhase?.() !== true) {
            throw new Error('TitleScene requires a ready loading presentation.');
        }
    }

    /**
     * @override
     * 이동 중이거나 완료된 타이틀 presentation을 갱신합니다.
     */
    update() {
        this.presentation?.update();
        this.presentation?.promoteCompletedTitleIntro?.();
    }

    /**
     * @override
     * 타이틀 화면을 렌더링합니다.
     */
    draw() {
        this.presentation?.draw();
    }

    /**
     * @override
     * 화면 크기 변경 시 완료된 presentation 배치를 다시 계산합니다.
     */
    resize() {
        this.presentation?.resize();
    }

    /**
     * @override
     * 타이틀 씬이 보유한 서브 모듈을 순서대로 정리하고 열린 타이틀 overlay를 닫습니다.
     * @returns {void}
     */
    destroy() {
        this.presentation?.destroy();
        this.presentation = null;
        this.titleController = null;
        this.titleGpuRolloutProfile = null;
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
        this.presentation?.fixedUpdate();
    }

    /**
     * @override
     * 동일한 설정 객체를 완료된 타이틀 presentation에 전달합니다.
     * @param {object} [changedSettings={}] - 변경된 설정 키와 값입니다.
     * @returns {void}
     */
    applyRuntimeSettings(changedSettings = {}) {
        this.presentation?.applyRuntimeSettings(changedSettings);
    }
}
