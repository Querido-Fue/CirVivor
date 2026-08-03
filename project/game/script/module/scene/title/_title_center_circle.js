import { getCanvas, getUIOffsetX, getUIWW, getWH, renderGL } from 'display/display_system.js';
import { getDelta } from 'game/time_handler.js';
import { clamp01 } from 'util/number_util.js';
import { buildTitleCenterCircleRenderCommand } from './center_circle/_title_center_circle_render_command.js';
import { TITLE_LOADING_CONSTANTS as TITLE_LOADING } from './_title_runtime_constants.js';

/**
 * @class TitleCenterCircle
 * @description 타이틀 화면 중앙의 원형 glass 오브젝트를 렌더링합니다.
 */
export class TitleCenterCircle {
    #renderCommandBuildState;

    /**
     * 중앙 원형 오브젝트의 내부 상태를 초기화합니다.
     */
    constructor() {
        this.glowPhase = 0;
        this.introBlur = TITLE_LOADING.INTRO_BLUR_START_PX;
        this.appliedIntroBlur = Number.NaN;
        this.WH = getWH();
        this.UIWW = getUIWW();
        this.UIOffsetX = getUIOffsetX();
        this.introCenterX = 0;
        this.introCenterY = 0;
        this.finalCenterX = 0;
        this.finalCenterY = 0;
        this.centerX = 0;
        this.centerY = 0;
        this.radius = 0;
        this.outlineWidth = 0;
        this.visualScale = 1;
        this.placementProgress = 0;
        this.glowCompensationScale = 1;
        this.#renderCommandBuildState = {
            centerX: 0,
            centerY: 0,
            radius: 0,
            outlineWidth: 0,
            glowPhase: 0,
            glowCompensationScale: 1,
            blurSourceCanvases: null,
            legacyBlurSourceCanvases: [null, null]
        };
        this.#recalculateLayout();
    }

    /**
     * 외곽 글로우의 시간 축을 갱신합니다.
     */
    update() {
        const delta = getDelta();
        if (!Number.isFinite(delta) || delta <= 0) {
            return;
        }

        this.glowPhase = (this.glowPhase + (delta * 1.4)) % (Math.PI * 2);
    }

    /**
     * 화면 크기 변경 시 중앙 원의 좌표를 다시 계산합니다.
     */
    resize() {
        this.WH = getWH();
        this.UIWW = getUIWW();
        this.UIOffsetX = getUIOffsetX();
        this.#recalculateLayout();
    }

    /**
     * 화면 축소처럼 보이도록 원의 시각 반경 배율을 설정합니다.
     * @param {number} scale - 0보다 큰 시각 배율
     */
    setVisualScale(scale) {
        if (!Number.isFinite(scale) || scale <= 0) {
            this.visualScale = 1;
            this.#syncVisualPlacement();
            return;
        }
        this.visualScale = scale;
        this.#syncVisualPlacement();
    }

    /**
     * 원형 오브젝트가 최종 배치로 이동하는 진행률을 설정합니다.
     * @param {number} progress - 0~1 범위 위치 전환 진행률입니다.
     */
    setPlacementProgress(progress) {
        if (!Number.isFinite(progress)) {
            this.placementProgress = 0;
            this.#syncVisualPlacement();
            return;
        }

        this.placementProgress = clamp01(progress);
        this.#syncVisualPlacement();
    }

    /**
     * 원형 glass 오브젝트를 그립니다.
     */
    draw() {
        this.#syncIntroBlur();
        renderGL('effect', this.getPresentationCommand({ includeLegacyBlurSources: true }));
    }

    /**
     * WebGL과 WebGPU가 공유하는 현재 중앙 원 presentation 명령을 반환합니다.
     * 이 getter는 레거시 CSS intro blur를 갱신하지 않습니다.
     * @param {object} [options] - 명령 생성 옵션입니다.
     * @param {boolean} [options.includeLegacyBlurSources=false] - WebGL canvas blur source를 포함할지 여부입니다.
     * @returns {object} 현재 중앙 원 effect 렌더 명령입니다.
     */
    getPresentationCommand(options = {}) {
        const includeLegacyBlurSources = options?.includeLegacyBlurSources === true;
        const state = this.#renderCommandBuildState;
        state.centerX = this.centerX;
        state.centerY = this.centerY;
        state.radius = this.radius * this.visualScale;
        state.outlineWidth = Math.max(1, this.outlineWidth * this.visualScale);
        state.glowPhase = this.glowPhase;
        state.glowCompensationScale = this.glowCompensationScale;

        if (includeLegacyBlurSources) {
            const sources = state.legacyBlurSourceCanvases;
            sources[0] = getCanvas('background');
            sources[1] = getCanvas('object');
            state.blurSourceCanvases = sources;
        } else {
            state.blurSourceCanvases = null;
        }

        return buildTitleCenterCircleRenderCommand(state);
    }

    /**
     * 현재 원형 오브젝트의 핵심 배치 정보를 반환합니다.
     * @returns {{centerX:number, centerY:number, radius:number}} 원의 중심과 반경
     */
    getCircleLayout() {
        return {
            centerX: this.centerX,
            centerY: this.centerY,
            radius: this.radius * this.visualScale
        };
    }

    /**
     * 내부 상태를 정리합니다.
     */
    destroy() {
        const effectCanvas = getCanvas('effect');
        if (effectCanvas) {
            effectCanvas.style.filter = 'none';
        }

        this.glowPhase = 0;
        this.introBlur = 0;
        this.appliedIntroBlur = Number.NaN;
    }

    /**
     * 중앙 원의 기준 좌표를 다시 계산합니다.
     * @private
     */
    #recalculateLayout() {
        this.introCenterX = this.UIOffsetX + (this.UIWW * 0.5);
        this.introCenterY = this.WH * 0.5;
        this.finalCenterX = this.UIWW * (TITLE_LOADING.CIRCLE_CENTER_X_RATIO || 0.5);
        this.finalCenterY = this.WH * TITLE_LOADING.CIRCLE_CENTER_Y_RATIO;
        this.radius = Math.max(
            48,
            Math.min(
                this.WH * TITLE_LOADING.CIRCLE_RADIUS_WH_RATIO,
                this.UIWW * TITLE_LOADING.CIRCLE_RADIUS_UIWW_RATIO
            )
        );
        this.outlineWidth = Math.max(1, this.WH * TITLE_LOADING.OUTLINE_WIDTH_WH_RATIO);
        this.#syncVisualPlacement();
    }

    /**
     * 현재 위치 전환 진행률을 적용해 원 중심을 갱신합니다.
     * @private
     */
    #syncVisualPlacement() {
        this.centerX = this.introCenterX + ((this.finalCenterX - this.introCenterX) * this.placementProgress);
        this.centerY = this.introCenterY + ((this.finalCenterY - this.introCenterY) * this.placementProgress);
    }

    /**
     * 타이틀 진입 블러 값을 effect 캔버스에 반영합니다.
     * @private
     */
    #syncIntroBlur() {
        const blur = Number.isFinite(this.introBlur)
            ? Math.max(0, this.introBlur)
            : 0;
        if (blur === this.appliedIntroBlur) {
            return;
        }

        const effectCanvas = getCanvas('effect');
        if (!effectCanvas) {
            return;
        }

        effectCanvas.style.filter = blur <= 0.001
            ? 'none'
            : `blur(${blur}px)`;
        this.appliedIntroBlur = blur;
    }

}
