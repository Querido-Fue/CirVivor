import { animate, animateMixed, remove } from 'animation/animation_system.js';
import { getData } from 'data/data_handler.js';
import { getUIOffsetX, getUIWW, getWH } from 'display/display_system.js';
import { getDelta } from 'game/time_handler.js';
import { TitleCenterCircle } from './_title_center_circle.js';
import { TitleLogo } from './_title_logo.js';
import { TitleMenu } from './_title_menu.js';
import { TitleSceneContent } from './_title_scene_content.js';
import { advanceTitleIntroDelay } from './loading/_title_intro_delay.js';
import { buildTitleLoadingLogoPlacement } from './loading/_title_loading_logo_placement.js';
import { getLoadingLogoColor } from './loading/_title_loading_theme.js';
import { buildTitleSceneTransitionSegments } from './loading/_title_scene_transition_segments.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');
const TITLE_LOADING = TITLE_CONSTANTS.TITLE_LOADING;

/**
 * @class TitleLoadingSequence
 * @description 타이틀 로고 등장과 중앙 원·메뉴 전환을 관리합니다.
 */
export class TitleLoadingSequence {
    /**
     * @param {TitleScene} titleScene - 타이틀 씬 인스턴스입니다.
     */
    constructor(titleScene) {
        this.titleScene = titleScene;
        this.WH = getWH();
        this.UIWW = getUIWW();
        this.UIOffsetX = getUIOffsetX();
        this.centerIntroBlurAnimId = -1;
        this.sceneTransitionAnimIds = [];
        this.introDelayElapsed = 0;
        this.introStarted = false;
        this.sceneTransitionProgress = 0;
        this.enemySpawnReadyProgress = Number.POSITIVE_INFINITY;
        this.sceneTransitionStarted = false;
        this.centerCircle = new TitleCenterCircle();
        this.titleLogo = null;
        this.titleMenu = null;

        this.#updateCenterCirclePlacement();
    }

    /**
     * 중앙 원, 로고와 메뉴 상태를 갱신합니다.
     */
    update() {
        if (!this.introStarted) {
            const delayState = advanceTitleIntroDelay(
                this.introDelayElapsed,
                getDelta(),
                TITLE_LOADING.INTRO_START_DELAY_SECONDS
            );
            this.introDelayElapsed = delayState.elapsed;
            if (delayState.ready) {
                this.#startIntro();
            }
            return;
        }

        this.centerCircle?.update();

        if (this.titleLogo) {
            this.titleLogo.update();
            this.#updateSceneTransition();
            this.#updateCenterCirclePlacement();
            this.#updateLogoPlacement();
        }
        this.titleMenu?.update();
    }

    /**
     * 타이틀 인트로 UI를 그립니다.
     */
    draw() {
        this.centerCircle?.draw();
        this.titleLogo?.draw();
        this.titleMenu?.draw();
    }

    /**
     * 화면 크기 변경에 맞춰 타이틀 인트로 배치를 다시 계산합니다.
     */
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

    /**
     * 타이틀 인트로가 생성한 리소스를 정리합니다.
     */
    destroy() {
        if (this.centerIntroBlurAnimId >= 0) {
            remove(this.centerIntroBlurAnimId);
        }
        for (const animationId of this.sceneTransitionAnimIds) {
            remove(animationId);
        }
        this.sceneTransitionAnimIds = [];

        this.centerCircle?.destroy();
        this.centerCircle = null;
        this.titleLogo?.destroy();
        this.titleLogo = null;
        this.titleMenu?.destroy();
        this.titleMenu = null;
    }

    /**
     * 현재 설정 변경을 타이틀 인트로 UI에 반영합니다.
     * @param {object} [changedSettings={}] - 변경된 설정 키와 값입니다.
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

    /**
     * 타이틀 배경 실드가 따라갈 중심/반경 정보를 반환합니다.
     * @returns {{centerX:number, centerY:number, radius:number}|null} 실드 레이아웃입니다.
     */
    getEnemyShieldLayout() {
        return this.centerCircle?.getCircleLayout?.() || null;
    }

    /**
     * 타이틀 배경 적이 끌려갈 자석점 좌표를 반환합니다.
     * @returns {{x:number, y:number}|null} 자석점 좌표입니다.
     */
    getEnemyMagneticPoint() {
        const circleLayout = this.getEnemyShieldLayout();
        if (!circleLayout) {
            return null;
        }

        return {
            x: circleLayout.centerX,
            y: circleLayout.centerY
        };
    }

    /**
     * 타이틀 배경 적 스폰을 시작해도 되는지 반환합니다.
     * @returns {boolean} 이동 전환의 가속 구간 완료 여부입니다.
     */
    isEnemySpawnReady() {
        return this.sceneTransitionStarted === true
            && this.sceneTransitionProgress >= this.enemySpawnReadyProgress;
    }

    /**
     * 로고·중앙 원 전환과 메뉴 등장·입력이 모두 완료됐는지 반환합니다.
     * @returns {boolean} TitleScene으로 handoff 가능한 상태입니다.
     */
    isComplete() {
        return this.introStarted === true
            && this.sceneTransitionStarted === true
            && this.sceneTransitionProgress >= 1
            && this.titleMenu?.pointerEnabled === true;
    }

    /**
     * 완료된 중앙 원·로고·메뉴 identity를 파괴하지 않고 정상 타이틀 content로 넘깁니다.
     * @returns {TitleSceneContent|null} 완료 content 또는 아직 준비되지 않았으면 null입니다.
     */
    releaseCompletedContent() {
        if (!this.isComplete()) return null;
        if (this.centerIntroBlurAnimId >= 0) {
            remove(this.centerIntroBlurAnimId);
            this.centerIntroBlurAnimId = -1;
        }
        for (const animationId of this.sceneTransitionAnimIds) {
            remove(animationId);
        }
        this.sceneTransitionAnimIds = [];
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

    /** blur·로고·메뉴의 기존 상대 시간축을 같은 프레임 경계에서 시작합니다. @private */
    #startIntro() {
        if (this.introStarted) return;
        this.introStarted = true;
        this.centerIntroBlurAnimId = animate(this.centerCircle, {
            variable: 'introBlur',
            startValue: TITLE_LOADING.INTRO_BLUR_START_PX,
            endValue: 0,
            type: TITLE_LOADING.INTRO_BLUR_EASING,
            duration: TITLE_LOADING.INTRO_BLUR_DURATION
        }).id;
        this.#showTitleLogo();
    }

    /**
     * 타이틀 로고 드로잉과 메뉴 대기 상태를 시작합니다.
     * @private
     */
    #showTitleLogo() {
        if (!this.titleLogo) {
            this.titleLogo = new TitleLogo(this.titleScene);
            this.titleLogo.play(getLoadingLogoColor());
        }
        if (!this.titleMenu) {
            this.titleMenu = new TitleMenu(this.titleScene);
        }
        this.resize();
    }

    /**
     * 로고 드로잉 재생률이 기준을 넘으면 중앙 원·로고·메뉴 전환을 시작합니다.
     * @private
     */
    #updateSceneTransition() {
        if (!this.titleLogo || this.sceneTransitionStarted) {
            return;
        }

        if (this.titleLogo.getPlaybackProgress() < TITLE_LOADING.SCENE_TRANSITION_TRIGGER_PROGRESS) {
            return;
        }

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

    /**
     * 중앙 원과 전환 진행률을 기준으로 로고 배치를 다시 계산합니다.
     * @private
     */
    #updateLogoPlacement() {
        if (!this.titleLogo || !this.centerCircle) {
            return;
        }

        this.titleLogo.setPlacement(buildTitleLoadingLogoPlacement({
            circleLayout: this.centerCircle.getCircleLayout(),
            wh: this.WH,
            uiww: this.UIWW,
            uiOffsetX: this.UIOffsetX,
            sceneTransitionProgress: this.sceneTransitionProgress,
            titleLoading: TITLE_LOADING
        }));
    }

    /**
     * 전환 진행률에 맞춰 중앙 원을 최종 위치로 이동시킵니다.
     * @private
     */
    #updateCenterCirclePlacement() {
        if (!this.centerCircle) {
            return;
        }

        this.centerCircle.setVisualScale(TITLE_LOADING.MINI_CIRCLE_SCALE || 1);
        this.centerCircle.setPlacementProgress(this.sceneTransitionProgress);
    }
}
