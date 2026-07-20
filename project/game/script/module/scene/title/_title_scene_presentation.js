import { TitleBackGround } from './_title_background.js';
import { TitleGradientBackground } from './_title_gradient_background.js';
import { TitleLoadingSequence } from './_title_loading_sequence.js';

/**
 * 타이틀 배경과 현재 foreground content를 한 수명 주기로 묶어 LoadingScene→TitleScene에 넘깁니다.
 */
export class TitleScenePresentation {
    /**
     * @param {import('./_title_scene_controller.js').TitleSceneController} controller - 안정적인 타이틀 action 소유자입니다.
     */
    constructor(controller) {
        this.controller = controller;
        this.titleGradientBackground = new TitleGradientBackground();
        this.titleBackground = new TitleBackGround(controller, { drawBackgroundFill: false });
        this.content = new TitleLoadingSequence(controller);
        this.controller.setTitleContent(this.content);
    }

    /** 기존 gradient→content→enemy background 갱신 순서를 보존합니다. */
    update() {
        this.titleGradientBackground?.update();
        this.content?.update();
        this.titleBackground?.update(
            this.content?.getEnemyShieldLayout?.() || null,
            this.content?.isEnemySpawnReady?.() === true
        );
    }

    /** 기존 gradient→enemy background→foreground 렌더 순서를 보존합니다. */
    draw() {
        this.titleGradientBackground?.draw();
        this.titleBackground?.draw();
        this.content?.draw();
    }

    /** 타이틀 배경 적의 fixed tick을 갱신합니다. */
    fixedUpdate() {
        this.titleBackground?.fixedUpdate();
    }

    /** viewport와 모든 타이틀 시각 컴포넌트 배치를 갱신합니다. */
    resize() {
        this.controller.syncViewportMetrics();
        this.titleGradientBackground?.resize();
        this.titleBackground?.resize();
        this.content?.resize();
    }

    /**
     * 설정 변경을 기존 순서로 배경과 foreground에 전달합니다.
     * @param {object} [changedSettings={}] - 변경된 설정입니다.
     */
    applyRuntimeSettings(changedSettings = {}) {
        if (changedSettings.theme !== undefined
            && this.titleBackground
            && typeof this.titleBackground.applyTheme === 'function') {
            this.titleBackground.applyTheme();
        }
        this.content?.applyRuntimeSettings?.(changedSettings);
    }

    /** @returns {boolean} loading content의 전체 등장 완료 여부입니다. */
    isLoadingComplete() {
        return this.content?.isComplete?.() === true;
    }

    /**
     * loading content의 실제 컴포넌트 identity를 보존한 채 완료 content로 교체합니다.
     * @returns {boolean} handoff 준비 성공 여부입니다.
     */
    promoteCompletedLoadingContent() {
        const completedContent = this.content?.releaseCompletedContent?.() || null;
        if (!completedContent) return false;
        this.content = completedContent;
        this.controller.setTitleContent(completedContent);
        return true;
    }

    /** 모든 타이틀 시각 리소스를 기존 소유 순서로 정리합니다. */
    destroy() {
        this.titleGradientBackground?.destroy();
        this.titleGradientBackground = null;
        this.titleBackground?.destroy();
        this.titleBackground = null;
        this.content?.destroy();
        this.content = null;
        this.controller?.setTitleContent(null);
    }
}
