import { animateMixed, remove } from 'animation/animation_system.js';
import { getUIOffsetX, getUIWW, getWH } from 'display/display_system.js';
import { TitleSceneContent } from './_title_scene_content.js';
import { buildTitleLoadingLogoPlacement } from './loading/_title_loading_logo_placement.js';
import { getLoadingLogoColor } from './loading/_title_loading_theme.js';
import { buildTitleSceneTransitionSegments } from './loading/_title_scene_transition_segments.js';
import { TITLE_LOADING_CONSTANTS as TITLE_LOADING } from './_title_runtime_constants.js';

/**
 * TitleScene 진입 이후 중앙 원·로고 이동, 메뉴 등장과 적 스폰 게이트를 관리합니다.
 */
export class TitleSceneIntroSequence {
    /**
     * @param {import('./_title_scene_controller.js').TitleSceneController} titleController - 타이틀 action controller입니다.
     * @param {object} assets - LoadingScene에서 넘긴 동일 identity 자산입니다.
     * @param {import('./_title_center_circle.js').TitleCenterCircle} assets.centerCircle - 중앙 원입니다.
     * @param {import('./_title_logo.js').TitleLogo} assets.titleLogo - 재생을 마친 로고입니다.
     * @param {import('./_title_menu.js').TitleMenu} assets.titleMenu - 미리 준비된 타이틀 메뉴입니다.
     * @param {number} assets.centerIntroBlurAnimId - intro blur animation id입니다.
     */
    constructor(titleController, {
        centerCircle,
        titleLogo,
        titleMenu,
        centerIntroBlurAnimId
    }) {
        this.titleController = titleController;
        this.WH = getWH();
        this.UIWW = getUIWW();
        this.UIOffsetX = getUIOffsetX();
        this.centerCircle = centerCircle;
        this.titleLogo = titleLogo;
        this.titleMenu = titleMenu;
        this.centerIntroBlurAnimId = Number.isInteger(centerIntroBlurAnimId)
            ? centerIntroBlurAnimId
            : -1;
        this.sceneTransitionAnimIds = [];
        this.sceneTransitionProgress = 0;
        this.enemySpawnReadyProgress = Number.POSITIVE_INFINITY;
        this.sceneTransitionStarted = false;

        this.#startSceneTransition();
    }

    /** 중앙 원·로고 이동과 메뉴 등장 상태를 갱신합니다. */
    update() {
        this.centerCircle?.update();
        this.titleLogo?.update();
        this.#updateCenterCirclePlacement();
        this.#updateLogoPlacement();
        this.titleMenu?.update();
    }

    /** 타이틀 인트로 UI를 기존 foreground 순서로 그립니다. */
    draw() {
        this.centerCircle?.draw();
        this.titleLogo?.draw();
        this.titleMenu?.draw();
    }

    /** 화면 크기 변경에 맞춰 이동 중 배치를 다시 계산합니다. */
    resize() {
        this.WH = getWH();
        this.UIWW = getUIWW();
        this.UIOffsetX = getUIOffsetX();
        this.centerCircle?.resize();
        this.#updateCenterCirclePlacement();
        if (this.titleLogo) {
            this.titleLogo.resize();
            this.#updateLogoPlacement();
        }
        this.titleMenu?.resize();
    }

    /** 이 단계가 보유한 animation과 시각 컴포넌트를 정리합니다. */
    destroy() {
        this.#removeAnimations();
        this.centerCircle?.destroy();
        this.centerCircle = null;
        this.titleLogo?.destroy();
        this.titleLogo = null;
        this.titleMenu?.destroy();
        this.titleMenu = null;
    }

    /**
     * 런타임 설정 변경을 이동 중인 로고와 메뉴에 반영합니다.
     * @param {object} [changedSettings={}] - 변경된 설정입니다.
     */
    applyRuntimeSettings(changedSettings = {}) {
        if (changedSettings.theme !== undefined
            && this.titleLogo
            && typeof this.titleLogo.setColor === 'function') {
            this.titleLogo.setColor(getLoadingLogoColor());
        }
        if ((changedSettings.theme !== undefined
            || changedSettings.language !== undefined
            || changedSettings.disableTransparency !== undefined
            || changedSettings.uiScale !== undefined)
            && this.titleMenu
            && typeof this.titleMenu.applyRuntimeSettings === 'function') {
            this.titleMenu.applyRuntimeSettings(changedSettings);
        }
    }

    /** @returns {{centerX:number,centerY:number,radius:number}|null} 실드 레이아웃입니다. */
    getEnemyShieldLayout() {
        return this.centerCircle?.getCircleLayout?.() || null;
    }

    /** @returns {{x:number,y:number}|null} 타이틀 배경 적의 자석점입니다. */
    getEnemyMagneticPoint() {
        const circleLayout = this.getEnemyShieldLayout();
        return circleLayout
            ? { x: circleLayout.centerX, y: circleLayout.centerY }
            : null;
    }

    /** @returns {boolean} 이동 가속 구간이 끝나 적 스폰을 시작할 수 있는지 여부입니다. */
    isEnemySpawnReady() {
        return this.sceneTransitionStarted === true
            && this.sceneTransitionProgress >= this.enemySpawnReadyProgress;
    }

    /** @returns {boolean} 이동과 메뉴 등장·입력이 모두 완료됐는지 여부입니다. */
    isComplete() {
        return this.sceneTransitionStarted === true
            && this.sceneTransitionProgress >= 1
            && this.titleMenu?.pointerEnabled === true;
    }

    /**
     * 완료된 컴포넌트 identity를 정상 타이틀 content로 넘깁니다.
     * @returns {TitleSceneContent|null} 완료 content 또는 아직 준비되지 않았으면 null입니다.
     */
    releaseCompletedContent() {
        if (!this.isComplete()) return null;
        this.#removeAnimations();
        const content = new TitleSceneContent({
            centerCircle: this.centerCircle,
            titleLogo: this.titleLogo,
            titleMenu: this.titleMenu
        });
        this.centerCircle = null;
        this.titleLogo = null;
        this.titleMenu = null;
        return content;
    }

    /** 중앙 원·로고 이동과 glow 보정 animation을 등록합니다. @private */
    #startSceneTransition() {
        if (this.sceneTransitionStarted) return;
        this.sceneTransitionStarted = true;
        const transitionSegments = buildTitleSceneTransitionSegments({
            startValue: 0,
            endValue: 1,
            motion: TITLE_LOADING.SCENE_TRANSITION_MOTION
        });
        this.enemySpawnReadyProgress = transitionSegments[0]?.endValue ?? 0;
        const transitionAnimation = animateMixed(this, [{
            variable: 'sceneTransitionProgress',
            animations: transitionSegments
        }]);
        const glowAnimation = animateMixed(this.centerCircle, [{
            variable: 'glowCompensationScale',
            animations: buildTitleSceneTransitionSegments({
                startValue: this.centerCircle.glowCompensationScale,
                endValue: TITLE_LOADING.GLOW_COMPENSATION_SCALE,
                motion: TITLE_LOADING.SCENE_TRANSITION_MOTION
            })
        }]);
        this.sceneTransitionAnimIds = [
            ...(transitionAnimation.ids || []),
            ...(glowAnimation.ids || [])
        ];
    }

    /** 보유한 intro와 이동 animation id를 해제합니다. @private */
    #removeAnimations() {
        if (this.centerIntroBlurAnimId >= 0) {
            remove(this.centerIntroBlurAnimId);
            this.centerIntroBlurAnimId = -1;
        }
        for (const animationId of this.sceneTransitionAnimIds) {
            remove(animationId);
        }
        this.sceneTransitionAnimIds = [];
    }

    /** 이동 진행률을 기준으로 로고 배치를 계산합니다. @private */
    #updateLogoPlacement() {
        if (!this.titleLogo || !this.centerCircle) return;
        this.titleLogo.setPlacement(buildTitleLoadingLogoPlacement({
            circleLayout: this.centerCircle.getCircleLayout(),
            wh: this.WH,
            uiww: this.UIWW,
            uiOffsetX: this.UIOffsetX,
            sceneTransitionProgress: this.sceneTransitionProgress,
            titleLoading: TITLE_LOADING
        }));
    }

    /** 이동 진행률을 중앙 원 배치에 반영합니다. @private */
    #updateCenterCirclePlacement() {
        if (!this.centerCircle) return;
        this.centerCircle.setVisualScale(TITLE_LOADING.MINI_CIRCLE_SCALE || 1);
        this.centerCircle.setPlacementProgress(this.sceneTransitionProgress);
    }
}
