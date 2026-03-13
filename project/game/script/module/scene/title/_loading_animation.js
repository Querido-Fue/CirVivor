import { getCanvas, getUIOffsetX, getUIWW, getWH, getWW } from 'display/display_system.js';
import { getDelta } from 'game/time_handler.js';
import { getData } from 'data/data_handler.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');
const TITLE_LOADING = TITLE_CONSTANTS.TITLE_LOADING;
const TWO_PI = Math.PI * 2;
const LOADING_BLUE = '#166ffb';

/**
 * @class TitleLoadingAnimation
 * @description 타이틀 씬 내부에서 사용하는 원형 로딩 애니메이션을 렌더링합니다.
 */
export class TitleLoadingAnimation {
    /**
     * @param {TitleScene} titleScene - 타이틀 씬 인스턴스
     */
    constructor(titleScene) {
        this.titleScene = titleScene;
        this.progress = 0;
        this.wavePhase = 0;
        this.secondaryWavePhase = Math.PI * 0.35;
        this.glowPhase = 0;
        this.WW = getWW();
        this.WH = getWH();
        this.UIWW = getUIWW();
        this.UIOffsetX = getUIOffsetX();
        this.centerX = 0;
        this.centerY = 0;
        this.radius = 0;
        this.outlineWidth = 0;
        this.textAnchorY = 0;
        this.visualScale = 1;
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
            return;
        }
        this.visualScale = scale;
    }

    /**
     * 원형 로딩 애니메이션을 그립니다.
     */
    draw() {
        const canvas = getCanvas('ui');
        if (!canvas) {
            return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }

        const drawRadius = this.radius * this.visualScale;
        const drawOutlineWidth = Math.max(1, this.outlineWidth * this.visualScale);

        ctx.save();
        this.#drawOutlineGlow(ctx, drawRadius, drawOutlineWidth);
        if (this.progress > 0) {
            this.#drawFill(ctx, drawRadius);
        }
        this.#drawOutline(ctx, drawRadius, drawOutlineWidth);
        ctx.restore();
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
            radius: this.radius
        };
    }

    /**
     * 내부 상태를 정리합니다.
     */
    destroy() {
    }

    /**
     * 원형 로딩 애니메이션의 기준 좌표를 다시 계산합니다.
     * @private
     */
    #recalculateLayout() {
        this.centerX = this.UIOffsetX + (this.UIWW * 0.5);
        this.centerY = this.WH * TITLE_LOADING.CIRCLE_CENTER_Y_RATIO;
        this.radius = Math.max(
            48,
            Math.min(
                this.WH * TITLE_LOADING.CIRCLE_RADIUS_WH_RATIO,
                this.UIWW * TITLE_LOADING.CIRCLE_RADIUS_UIWW_RATIO
            )
        );
        this.outlineWidth = Math.max(2, this.WH * TITLE_LOADING.OUTLINE_WIDTH_WH_RATIO);
        this.textAnchorY = this.centerY + this.radius + Math.max(18, this.WH * TITLE_LOADING.TEXT_GAP_WH_RATIO);
    }

    /**
     * 외곽 글로우가 있는 원형 outline을 먼저 그립니다.
     * @param {CanvasRenderingContext2D} ctx - UI 레이어 컨텍스트
     * @private
     */
    #drawOutlineGlow(ctx, drawRadius, drawOutlineWidth) {
        const pulse = 0.9 + (Math.sin(this.glowPhase) * 0.06);

        ctx.save();
        ctx.beginPath();
        ctx.arc(this.centerX, this.centerY, drawRadius, 0, TWO_PI);
        ctx.lineWidth = drawOutlineWidth;
        ctx.strokeStyle = LOADING_BLUE;
        ctx.shadowBlur = drawRadius * 0.38;
        ctx.shadowColor = `rgba(22, 111, 251, ${0.88 * pulse})`;
        ctx.stroke();
        ctx.restore();
    }

    /**
     * 선명한 원형 outline을 그립니다.
     * @param {CanvasRenderingContext2D} ctx - UI 레이어 컨텍스트
     * @private
     */
    #drawOutline(ctx, drawRadius, drawOutlineWidth) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(this.centerX, this.centerY, drawRadius, 0, TWO_PI);
        ctx.lineWidth = drawOutlineWidth;
        ctx.strokeStyle = LOADING_BLUE;
        ctx.stroke();
        ctx.restore();
    }

    /**
     * 진행률에 따라 원 내부를 채우고 파도 애니메이션을 적용합니다.
     * @param {CanvasRenderingContext2D} ctx - UI 레이어 컨텍스트
     * @private
     */
    #drawFill(ctx, drawRadius) {
        const innerRadius = Math.max(1, drawRadius);
        const fillData = this.#buildFillData(innerRadius);

        ctx.save();
        ctx.beginPath();
        ctx.arc(this.centerX, this.centerY, innerRadius, 0, TWO_PI);
        ctx.clip();

        ctx.fillStyle = LOADING_BLUE;
        ctx.fill(fillData.path);

        this.#drawSurfaceHighlight(ctx, fillData, drawRadius);
        ctx.restore();
    }

    /**
     * 진행률에 맞는 파도 형태의 내부 fill 경로를 계산합니다.
     * @param {number} innerRadius - 내부 채움 반경
     * @returns {{path: Path2D, surfacePoints: Array<{x:number, y:number}>}} fill 경로와 표면 포인트
     * @private
     */
    #buildFillData(innerRadius) {
        const fillBottomY = this.centerY + innerRadius;
        const fillHeight = (innerRadius * 2) * this.progress;
        const fillTopBaseY = fillBottomY - fillHeight;
        const amplitudeLimit = innerRadius * 0.06;
        const amplitude = this.progress >= 1
            ? 0
            : Math.min(amplitudeLimit, Math.max(1.5, fillHeight * 0.2));
        const leftX = this.centerX - innerRadius - (amplitude * 2);
        const rightX = this.centerX + innerRadius + (amplitude * 2);
        const segments = 30;
        const path = new Path2D();
        const surfacePoints = [];

        path.moveTo(leftX, fillBottomY + innerRadius);
        path.lineTo(leftX, fillTopBaseY);

        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const x = leftX + ((rightX - leftX) * t);
            const y = this.#getWaveY(t, fillTopBaseY, amplitude);
            surfacePoints.push({ x, y });
            path.lineTo(x, y);
        }

        path.lineTo(rightX, fillBottomY + innerRadius);
        path.closePath();

        return { path, surfacePoints };
    }

    /**
     * 특정 정규화 위치에서 파도 표면의 y 좌표를 계산합니다.
     * @param {number} normalizedX - 0~1 범위의 정규화 x 값
     * @param {number} baseY - 표면 기준 y 값
     * @param {number} amplitude - 파도 진폭
     * @returns {number} 계산된 y 값
     * @private
     */
    #getWaveY(normalizedX, baseY, amplitude) {
        const primary = Math.sin((normalizedX * Math.PI * 2.2) + this.wavePhase) * amplitude;
        const secondary = Math.sin((normalizedX * Math.PI * 5.2) - this.secondaryWavePhase) * (amplitude * 0.32);
        return baseY + primary + secondary;
    }

    /**
     * fill 상단의 밝은 수면선을 그립니다.
     * @param {CanvasRenderingContext2D} ctx - UI 레이어 컨텍스트
     * @param {{surfacePoints: Array<{x:number, y:number}>}} fillData - fill 표면 포인트
     * @private
     */
    #drawSurfaceHighlight(ctx, fillData, drawRadius) {
        if (this.progress >= 1) {
            return;
        }

        const points = fillData.surfacePoints;
        if (!Array.isArray(points) || points.length === 0) {
            return;
        }

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.lineWidth = Math.max(1.5, drawRadius * 0.022);
        ctx.strokeStyle = 'rgba(214, 248, 255, 0.95)';
        ctx.shadowBlur = drawRadius * 0.06;
        ctx.shadowColor = 'rgba(204, 244, 255, 0.45)';
        ctx.stroke();
        ctx.restore();
    }
}
