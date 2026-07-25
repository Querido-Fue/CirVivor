import { animate, remove } from 'animation/animation_system.js';
import { getUIOffsetX, getUIWW, getWH } from 'display/display_system.js';
import { getDelta } from 'game/time_handler.js';
import { TitleCenterCircle } from './_title_center_circle.js';
import { TitleLogo } from './_title_logo.js';
import { TitleMenu } from './_title_menu.js';
import { advanceTitleIntroDelay } from './loading/_title_intro_delay.js';
import { buildTitleLoadingLogoPlacement } from './loading/_title_loading_logo_placement.js';
import { getLoadingLogoColor } from './loading/_title_loading_theme.js';
import { TITLE_LOADING_CONSTANTS as TITLE_LOADING } from './_title_runtime_constants.js';

/**
 * @class TitleLoadingSequence
 * @description LoadingScene에서 타이틀 로고 등장까지 관리하고 이동 직전 자산을 넘깁니다.
 */
export class TitleLoadingSequence {
    /**
     * @param {import('./_title_scene_controller.js').TitleSceneController} titleController - 타이틀 action controller입니다.
     */
    constructor(titleController) {
        this.titleController = titleController;
        this.WH = getWH();
        this.UIWW = getUIWW();
        this.UIOffsetX = getUIOffsetX();
        this.centerIntroBlurAnimId = -1;
        this.introDelayElapsed = 0;
        this.introStarted = false;
        this.sceneTransitionProgress = 0;
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
        this.centerIntroBlurAnimId = -1;

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
     * LoadingScene에서는 타이틀 배경 적 스폰을 허용하지 않습니다.
     * @returns {boolean} 항상 false입니다.
     */
    isEnemySpawnReady() {
        return false;
    }

    /**
     * 로고 재생이 이동 시작 경계에 도달했는지 반환합니다.
     * @returns {boolean} TitleScene으로 handoff 가능한 상태입니다.
     */
    isTitleSceneHandoffReady() {
        return this.introStarted === true
            && this.titleLogo !== null
            && this.titleLogo.getPlaybackProgress()
                >= TITLE_LOADING.SCENE_TRANSITION_TRIGGER_PROGRESS;
    }

    /**
     * 이동 직전의 중앙 원·로고·메뉴 identity와 blur animation 소유권을 넘깁니다.
     * @returns {{centerCircle:TitleCenterCircle,titleLogo:TitleLogo,titleMenu:TitleMenu,centerIntroBlurAnimId:number}|null} 타이틀 인트로 자산입니다.
     */
    releaseTitleIntroAssets() {
        if (!this.isTitleSceneHandoffReady()) return null;
        const assets = {
            centerCircle: this.centerCircle,
            titleLogo: this.titleLogo,
            titleMenu: this.titleMenu,
            centerIntroBlurAnimId: this.centerIntroBlurAnimId
        };
        this.centerCircle = null;
        this.titleLogo = null;
        this.titleMenu = null;
        this.centerIntroBlurAnimId = -1;
        return assets;
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
            this.titleLogo = new TitleLogo(this.titleController);
            this.titleLogo.play(getLoadingLogoColor());
        }
        if (!this.titleMenu) {
            this.titleMenu = new TitleMenu(this.titleController);
        }
        this.resize();
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
