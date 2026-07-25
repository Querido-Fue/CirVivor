import { getUIOffsetX, getUIWW, getWH } from 'display/display_system.js';
import { buildTitleLoadingLogoPlacement } from './loading/_title_loading_logo_placement.js';
import { getLoadingLogoColor } from './loading/_title_loading_theme.js';
import { TITLE_LOADING_CONSTANTS as TITLE_LOADING } from './_title_runtime_constants.js';

/**
 * 완료된 인트로의 중앙 원·로고·메뉴를 그대로 이어받아 타이틀 정상 상태를 관리합니다.
 */
export class TitleSceneContent {
    /**
     * @param {object} options - handoff할 시각 컴포넌트입니다.
     * @param {object} options.centerCircle - 완료된 중앙 원입니다.
     * @param {object} options.titleLogo - 완료된 로고입니다.
     * @param {object} options.titleMenu - 완료된 메뉴입니다.
     */
    constructor({ centerCircle, titleLogo, titleMenu }) {
        this.centerCircle = centerCircle;
        this.titleLogo = titleLogo;
        this.titleMenu = titleMenu;
        this.sceneTransitionProgress = 1;
        this.WH = getWH();
        this.UIWW = getUIWW();
        this.UIOffsetX = getUIOffsetX();
    }

    /** 완료된 타이틀 표현 상태를 갱신합니다. */
    update() {
        this.centerCircle?.update();
        this.titleLogo?.update();
        this.titleMenu?.update();
    }

    /** 완료된 타이틀 표현을 기존 레이어 순서로 그립니다. */
    draw() {
        this.centerCircle?.draw();
        this.titleLogo?.draw();
        this.titleMenu?.draw();
    }

    /** viewport 변경 후 최종 전환 위치로 레이아웃을 다시 계산합니다. */
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

    /** 보유한 시각 컴포넌트를 정리합니다. */
    destroy() {
        this.centerCircle?.destroy();
        this.centerCircle = null;
        this.titleLogo?.destroy();
        this.titleLogo = null;
        this.titleMenu?.destroy();
        this.titleMenu = null;
    }

    /**
     * 런타임 설정 변경을 완료된 로고와 메뉴에 반영합니다.
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

    /** @returns {{x:number,y:number}|null} 완료된 중앙 원의 자석점입니다. */
    getEnemyMagneticPoint() {
        const circleLayout = this.getEnemyShieldLayout();
        return circleLayout
            ? { x: circleLayout.centerX, y: circleLayout.centerY }
            : null;
    }

    /** @returns {boolean} 완료 상태에서는 항상 true입니다. */
    isEnemySpawnReady() {
        return true;
    }

    /** 최종 전환 위치에 맞춰 로고를 다시 배치합니다. @private */
    #updateLogoPlacement() {
        if (!this.titleLogo || !this.centerCircle) return;
        this.titleLogo.setPlacement(buildTitleLoadingLogoPlacement({
            circleLayout: this.centerCircle.getCircleLayout(),
            wh: this.WH,
            uiww: this.UIWW,
            uiOffsetX: this.UIOffsetX,
            sceneTransitionProgress: 1,
            titleLoading: TITLE_LOADING
        }));
    }

    /** 중앙 원을 최종 전환 위치로 고정합니다. @private */
    #updateCenterCirclePlacement() {
        if (!this.centerCircle) return;
        this.centerCircle.setVisualScale(TITLE_LOADING.MINI_CIRCLE_SCALE || 1);
        this.centerCircle.setPlacementProgress(1);
    }
}
