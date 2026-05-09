import { getCanvas, getUIOffsetX, getUIWW, getWH, getWW, renderGL } from 'display/display_system.js';
import { getDelta } from 'game/time_handler.js';
import { getData } from 'data/data_handler.js';
import { buildTitleCenterCircleRenderCommand } from './center_circle/_title_center_circle_render_command.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');
const TITLE_LOADING = TITLE_CONSTANTS.TITLE_LOADING;
const TWO_PI = Math.PI * 2;

/**
 * @class TitleCenterCircle
 * @description 타이틀 화면 중앙의 원형 로딩 UI를 렌더링합니다.
 */
export class TitleCenterCircle {
    /**
     * 중앙 원형 로딩 UI의 내부 상태를 초기화합니다.
     */
    constructor() {
        this.progress = 0;
        this.wavePhase = 0;
        this.secondaryWavePhase = Math.PI * 0.35;
        this.glowPhase = 0;
        this.WW = getWW();
        this.WH = getWH();
        this.UIWW = getUIWW();
        this.UIOffsetX = getUIOffsetX();
        this.loadingCenterX = 0;
        this.loadingCenterY = 0;
        this.finalCenterX = 0;
        this.finalCenterY = 0;
        this.centerX = 0;
        this.centerY = 0;
        this.radius = 0;
        this.outlineWidth = 0;
        this.textAnchorY = 0;
        this.visualScale = 1;
        this.placementProgress = 0;
        this.glowCompensationScale = 1;
        this.#recalculateLayout();
    }

    /**
     * 로딩 진행률을 갱신합니다.
     * @param {number} progress - 0~1.1 범위의 진행률
     */
    setProgress(progress) {
        if (!Number.isFinite(progress)) {
            this.progress = 0;
            return;
        }
        this.progress = Math.min(TITLE_LOADING.COMPLETE_PROGRESS, Math.max(0, progress));
    }

    /**
     * 파도와 외곽 글로우의 시간 축을 갱신합니다.
     */
    update() {
        const delta = getDelta();
        if (!Number.isFinite(delta) || delta <= 0) {
            return;
        }

        this.wavePhase = (this.wavePhase + (delta * 1.9)) % TWO_PI;
        this.secondaryWavePhase = (this.secondaryWavePhase + (delta * 1.15)) % TWO_PI;
        this.glowPhase = (this.glowPhase + (delta * 1.4)) % TWO_PI;
    }

    /**
     * 화면 크기 변경 시 로딩 원과 텍스트 앵커 좌표를 다시 계산합니다.
     */
    resize() {
        this.WW = getWW();
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
     * 로딩 완료 후 원형 UI가 최종 배치로 이동하는 진행률을 설정합니다.
     * @param {number} progress - 0~1 범위 위치 전환 진행률입니다.
     */
    setPlacementProgress(progress) {
        if (!Number.isFinite(progress)) {
            this.placementProgress = 0;
            this.#syncVisualPlacement();
            return;
        }

        this.placementProgress = Math.max(0, Math.min(1, progress));
        this.#syncVisualPlacement();
    }

    /**
     * 원형 로딩 애니메이션을 그립니다.
     */
    draw() {
        const drawRadius = this.radius * this.visualScale;
        const drawOutlineWidth = Math.max(1, this.outlineWidth * this.visualScale);

        renderGL('effect', buildTitleCenterCircleRenderCommand({
            centerX: this.centerX,
            centerY: this.centerY,
            radius: drawRadius,
            outlineWidth: drawOutlineWidth,
            progress: this.progress,
            wavePhase: this.wavePhase,
            secondaryWavePhase: this.secondaryWavePhase,
            glowPhase: this.glowPhase,
            glowCompensationScale: this.glowCompensationScale,
            blurSourceCanvases: [
                getCanvas('background'),
                getCanvas('object')
            ]
        }));
    }

    /**
     * 로딩 텍스트를 배치할 중심점을 반환합니다.
     * @returns {{x:number, y:number}} 텍스트 중심점
     */
    getTextAnchor() {
        return {
            x: this.centerX,
            y: this.textAnchorY
        };
    }

    /**
     * 현재 원형 로딩 UI의 핵심 배치 정보를 반환합니다.
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
        this.progress = 0;
        this.wavePhase = 0;
        this.secondaryWavePhase = Math.PI * 0.35;
        this.glowPhase = 0;
    }

    /**
     * 원형 로딩 애니메이션의 기준 좌표를 다시 계산합니다.
     * @private
     */
    #recalculateLayout() {
        this.loadingCenterX = this.UIOffsetX + (this.UIWW * 0.5);
        this.loadingCenterY = this.WH * 0.5;
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
     * 현재 위치 전환 진행률과 시각 배율을 적용해 원 중심과 텍스트 앵커를 갱신합니다.
     * @private
     */
    #syncVisualPlacement() {
        this.centerX = this.loadingCenterX + ((this.finalCenterX - this.loadingCenterX) * this.placementProgress);
        this.centerY = this.loadingCenterY + ((this.finalCenterY - this.loadingCenterY) * this.placementProgress);
        this.textAnchorY = this.centerY + (this.radius * this.visualScale) + Math.max(18, this.WH * TITLE_LOADING.TEXT_GAP_WH_RATIO);
    }

}
