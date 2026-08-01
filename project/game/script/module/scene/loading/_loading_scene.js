import { BaseScene } from 'scene/_base_scene.js';
import { TitleSceneController } from '../title/_title_scene_controller.js';
import { createTitleGpuRolloutProfile } from '../title/_title_gpu_rollout.js';
import { TitleScenePresentation } from '../title/_title_scene_presentation.js';

/**
 * @class LoadingScene
 * @description 앱 시작부터 로고 재생 완료까지 소유하고 이동 직전 시각 상태를 TitleScene에 넘깁니다.
 */
export class LoadingScene extends BaseScene {
    /** @param {object} sceneSystem - 상위 씬 시스템입니다. */
    constructor(sceneSystem) {
        super(sceneSystem);
        this.titleGpuRolloutProfile = createTitleGpuRolloutProfile();
        this.titleController = new TitleSceneController(sceneSystem);
        this.presentation = new TitleScenePresentation(this.titleController);
    }

    /** 로딩 인트로를 갱신하고 이동 시작 경계에서 단 한 번 TitleScene handoff를 요청합니다. */
    update() {
        this.presentation?.update();
        if (this.presentation?.isTitleSceneHandoffReady() === true) {
            this.sceneSystem.completeLoading(this);
        }
    }

    /** 현재 loading presentation을 그립니다. */
    draw() {
        this.presentation?.draw();
    }

    /** 타이틀 배경 적의 fixed tick을 갱신합니다. */
    fixedUpdate() {
        this.presentation?.fixedUpdate();
    }

    /** viewport 변경을 loading presentation에 전달합니다. */
    resize() {
        this.presentation?.resize();
    }

    /** @param {object} [changedSettings={}] - 변경된 설정입니다. */
    applyRuntimeSettings(changedSettings = {}) {
        this.presentation?.applyRuntimeSettings(changedSettings);
    }

    /**
     * 이동 직전 presentation과 안정적인 controller identity를 TitleScene에 한 번만 넘깁니다.
     * @returns {{presentation:TitleScenePresentation,titleController:TitleSceneController,titleGpuRolloutProfile:Readonly<object>}|null} handoff 상태입니다.
     */
    releaseTitlePresentation() {
        if (this.presentation?.isTitleSceneHandoffReady?.() !== true) {
            return null;
        }
        const handoff = {
            presentation: this.presentation,
            titleController: this.titleController,
            titleGpuRolloutProfile: this.titleGpuRolloutProfile
        };
        this.presentation = null;
        this.titleController = null;
        this.titleGpuRolloutProfile = null;
        return handoff;
    }

    /** handoff되지 않은 loading 리소스만 정리합니다. */
    destroy() {
        this.presentation?.destroy();
        this.presentation = null;
        this.titleController = null;
        this.titleGpuRolloutProfile = null;
    }
}
