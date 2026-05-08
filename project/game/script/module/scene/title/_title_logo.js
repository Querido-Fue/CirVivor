import { SVGDrawer } from 'display/_svg_drawer.js';
import { getCanvas, getUIOffsetX, getUIWW, getWH } from 'display/display_system.js';
import { getDelta } from 'game/time_handler.js';
import { getData } from 'data/data_handler.js';
import {
    easeOutLogoExpo,
    TITLE_LOGO_GROUPS,
    TITLE_LOGO_STROKE_DURATION,
    TITLE_LOGO_TOTAL_DURATION,
    TITLE_LOGO_VIEWBOX
} from './logo/_title_logo_data.js';
import {
    calculateTitleLogoCachePadding,
    getTitleLogoShadowPasses,
    resizeTitleLogoCacheCanvas
} from './logo/_title_logo_cache.js';
import { getDefaultLogoColor, getDefaultLogoShadowColor } from './logo/_title_logo_theme.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');

/**
 * @class TitleLogo
 * @description 타이틀 화면에서 SVG 경로 기반의 로고 드로잉 애니메이션을 렌더링합니다.
 */
export class TitleLogo {
    #ctx;
    #drawOptions;

    /**
     * @param {TitleScene} titleScene - 타이틀 씬 인스턴스
     */
    constructor(titleScene) {
        this.titleScene = titleScene;
        this.drawer = new SVGDrawer();
        this.#ctx = null;
        this.#drawOptions = {
            progress: 0,
            mode: 'stroke-fill',
            sequential: true,
            fillStart: 0.6
        };
        this.logoMaskCanvas = document.createElement('canvas');
        this.logoMaskContext = this.logoMaskCanvas.getContext('2d');
        this.shadowMaskCanvas = document.createElement('canvas');
        this.shadowMaskContext = this.shadowMaskCanvas.getContext('2d');
        this.tintCanvas = document.createElement('canvas');
        this.tintContext = this.tintCanvas.getContext('2d');
        this.renderCanvas = document.createElement('canvas');
        this.renderContext = this.renderCanvas.getContext('2d');
        this.cacheDirty = true;
        this.cacheOffsetX = 0;
        this.cacheOffsetY = 0;
        this.cachedShadowColor = '';
        this.cachedLogoColor = '';

        this.WH = getWH();
        this.UIWW = getUIWW();
        this.UIOffsetX = getUIOffsetX();
        this.logoX = 0;
        this.logoY = 0;
        this.logoWidth = 0;
        this.logoHeight = 0;
        this.scale = 1;
        this.elapsed = 0;
        this.currentColor = getDefaultLogoColor();
        this.customPlacement = null;
        this.hasStarted = false;
        this.isPlaying = false;
        this.isFinished = false;

        this.#recalculateLayout();
        this.play(this.currentColor);
    }

    /**
     * 로고 드로잉 애니메이션을 시작하거나 다시 시작합니다.
     * @param {string} [color] - 로고 색상
     */
    play(color = getDefaultLogoColor()) {
        this.currentColor = typeof color === 'string' ? color : getDefaultLogoColor();
        this.elapsed = 0;
        this.hasStarted = true;
        this.isPlaying = true;
        this.isFinished = false;
        this.#markCacheDirty();
    }

    /**
     * 현재 재생 상태를 유지한 채 로고 색상만 갱신합니다.
     * @param {string} color - 적용할 로고 색상입니다.
     */
    setColor(color) {
        this.currentColor = typeof color === 'string' ? color : getDefaultLogoColor();
        this.#markCacheDirty();
    }

    /**
     * 프레임별 시간 축을 갱신합니다.
     */
    update() {
        if (!this.isPlaying || this.isFinished) {
            return;
        }

        const delta = getDelta();
        if (!Number.isFinite(delta) || delta <= 0) {
            return;
        }

        const nextElapsed = Math.min(TITLE_LOGO_TOTAL_DURATION, this.elapsed + delta);
        if (nextElapsed !== this.elapsed) {
            this.elapsed = nextElapsed;
            this.#markCacheDirty();
        }
        if (this.elapsed >= TITLE_LOGO_TOTAL_DURATION) {
            this.isPlaying = false;
            this.isFinished = true;
        }
    }

    /**
     * 현재 로고 드로잉 애니메이션의 진행률을 반환합니다.
     * @returns {number} 0~1 범위의 재생 진행률
     */
    getPlaybackProgress() {
        if (TITLE_LOGO_TOTAL_DURATION <= 0) {
            return 1;
        }
        return Math.min(this.elapsed / TITLE_LOGO_TOTAL_DURATION, 1);
    }

    /**
     * 지정한 재생 진행률까지 남은 시간을 초 단위로 반환합니다.
     * @param {number} targetProgress - 0~1 범위 목표 진행률입니다.
     * @returns {number} 남은 시간(초)입니다.
     */
    getRemainingTimeToProgress(targetProgress) {
        if (TITLE_LOGO_TOTAL_DURATION <= 0) {
            return 0;
        }

        const safeTargetProgress = Number.isFinite(targetProgress) ? targetProgress : 0;
        const clampedTargetProgress = Math.max(0, Math.min(1, safeTargetProgress));
        const targetElapsed = TITLE_LOGO_TOTAL_DURATION * clampedTargetProgress;
        return Math.max(0, targetElapsed - this.elapsed);
    }

    /**
     * 화면 크기 변경 시 로고 배치를 다시 계산합니다.
     */
    resize() {
        this.WH = getWH();
        this.UIWW = getUIWW();
        this.UIOffsetX = getUIOffsetX();
        this.#recalculateLayout();
        this.#markCacheDirty();
    }

    /**
     * 외부에서 계산한 배치 정보로 로고 위치와 크기를 덮어씁니다.
     * @param {{x:number, width:number, centerY:number}|null} placement - 외부 배치 정보
     */
    setPlacement(placement) {
        if (!placement) {
            this.customPlacement = null;
            this.#recalculateLayout();
            this.#markCacheDirty();
            return;
        }

        this.customPlacement = {
            x: Number.isFinite(placement.x) ? placement.x : 0,
            width: Number.isFinite(placement.width) ? placement.width : 0,
            centerY: Number.isFinite(placement.centerY) ? placement.centerY : (this.WH * 0.5)
        };
        this.#recalculateLayout();
        this.#markCacheDirty();
    }

    /**
     * UI 레이어에 로고를 그립니다.
     */
    draw() {
        if (!this.hasStarted) {
            return;
        }

        const ctx = this.#getContext();
        if (!ctx) {
            return;
        }

        this.#ensureRenderCache();
        if (this.renderCanvas.width <= 0 || this.renderCanvas.height <= 0) {
            return;
        }

        ctx.drawImage(
            this.renderCanvas,
            this.logoX - this.cacheOffsetX,
            this.logoY - this.cacheOffsetY
        );
    }

    /**
     * 내부 참조를 정리합니다.
     */
    destroy() {
        this.#ctx = null;
        this.isPlaying = false;
        this.logoMaskCanvas.width = 0;
        this.logoMaskCanvas.height = 0;
        this.shadowMaskCanvas.width = 0;
        this.shadowMaskCanvas.height = 0;
        this.tintCanvas.width = 0;
        this.tintCanvas.height = 0;
        this.renderCanvas.width = 0;
        this.renderCanvas.height = 0;
    }

    /**
     * UI 레이어 2D 컨텍스트를 가져옵니다.
     * @returns {CanvasRenderingContext2D|null} UI 컨텍스트
     * @private
     */
    #getContext() {
        if (this.#ctx) {
            return this.#ctx;
        }

        const canvas = getCanvas('ui');
        if (!canvas) {
            return null;
        }

        this.#ctx = canvas.getContext('2d');
        return this.#ctx;
    }

    /**
     * 현재 화면 기준으로 로고 배치와 스케일을 다시 계산합니다.
     * @private
     */
    #recalculateLayout() {
        const defaultWidth = this.UIWW * TITLE_CONSTANTS.TITLE_IMAGE.WIDTH_RATIO;
        this.logoWidth = this.customPlacement
            ? Math.max(1, this.customPlacement.width)
            : defaultWidth;
        this.scale = this.logoWidth / TITLE_LOGO_VIEWBOX.width;
        this.logoHeight = TITLE_LOGO_VIEWBOX.height * this.scale;

        if (this.customPlacement) {
            this.logoX = this.customPlacement.x;
            this.logoY = this.customPlacement.centerY - (this.logoHeight * 0.5);
            return;
        }

        this.logoX = this.UIOffsetX + (this.UIWW * TITLE_CONSTANTS.TITLE_IMAGE.ENTER_X_RATIO);
        this.logoY = (this.WH - this.logoHeight) * 0.5;
    }

    /**
     * 로고 캐시를 다시 만들도록 더티 상태로 표시합니다.
     * @private
     */
    #markCacheDirty() {
        this.cacheDirty = true;
    }

    /**
     * 현재 상태에 맞는 렌더 캐시를 보장합니다.
     * @private
     */
    #ensureRenderCache() {
        const shadowColor = getDefaultLogoShadowColor();
        if (shadowColor !== this.cachedShadowColor || this.currentColor !== this.cachedLogoColor) {
            this.#markCacheDirty();
        }

        if (this.cacheDirty !== true) {
            return;
        }

        this.#rebuildRenderCache(shadowColor);
    }

    /**
     * 현재 로고 상태를 오프스크린 비트맵으로 다시 합성합니다.
     * @param {string} shadowColor - 현재 테마의 그림자 색상입니다.
     * @private
     */
    #rebuildRenderCache(shadowColor) {
        const shadowPasses = getTitleLogoShadowPasses(this.scale);
        const cachePadding = calculateTitleLogoCachePadding(shadowPasses);
        const logoWidth = Math.max(1, Math.ceil(this.logoWidth));
        const logoHeight = Math.max(1, Math.ceil(this.logoHeight));
        const renderWidth = Math.max(1, Math.ceil(logoWidth + cachePadding.left + cachePadding.right));
        const renderHeight = Math.max(1, Math.ceil(logoHeight + cachePadding.top + cachePadding.bottom));
        const renderContext = this.renderContext;

        if (!renderContext || !this.logoMaskContext || !this.shadowMaskContext || !this.tintContext) {
            return;
        }

        resizeTitleLogoCacheCanvas(this.logoMaskCanvas, logoWidth, logoHeight);
        resizeTitleLogoCacheCanvas(this.shadowMaskCanvas, logoWidth, logoHeight);
        resizeTitleLogoCacheCanvas(this.tintCanvas, logoWidth, logoHeight);
        resizeTitleLogoCacheCanvas(this.renderCanvas, renderWidth, renderHeight);

        this.cacheOffsetX = cachePadding.left;
        this.cacheOffsetY = cachePadding.top;

        this.#renderMask(this.logoMaskContext, 1.5);
        this.#renderMask(this.shadowMaskContext, shadowPasses[0]?.lineWidth || 2.35);

        renderContext.clearRect(0, 0, renderWidth, renderHeight);
        this.#tintMask(this.shadowMaskCanvas, shadowColor);
        shadowPasses.forEach((shadowPass) => {
            this.#drawBlurredTint(renderContext, shadowPass);
        });
        this.#tintMask(this.logoMaskCanvas, this.currentColor);
        renderContext.drawImage(this.tintCanvas, this.cacheOffsetX, this.cacheOffsetY);

        this.cachedShadowColor = shadowColor;
        this.cachedLogoColor = this.currentColor;
        this.cacheDirty = false;
    }

    /**
     * 현재 로고 실루엣을 마스크 캔버스에 렌더링합니다.
     * @param {CanvasRenderingContext2D} context - 대상 마스크 컨텍스트입니다.
     * @param {number} lineWidth - 사용할 스트로크 두께입니다.
     * @private
     */
    #renderMask(context, lineWidth) {
        if (!context) {
            return;
        }

        context.clearRect(0, 0, context.canvas.width, context.canvas.height);
        context.save();
        context.scale(this.scale, this.scale);
        context.fillStyle = this.currentColor;
        context.strokeStyle = this.currentColor;
        context.lineWidth = lineWidth;
        context.lineJoin = 'round';
        context.lineCap = 'round';
        this.#drawLogoGroups(context);
        context.restore();
    }

    /**
     * 마스크 캔버스를 지정한 색상으로 틴트합니다.
     * @param {HTMLCanvasElement} maskCanvas - 사용할 마스크 캔버스입니다.
     * @param {string} color - 적용할 색상입니다.
     * @private
     */
    #tintMask(maskCanvas, color) {
        const tintContext = this.tintContext;
        if (!tintContext) {
            return;
        }

        tintContext.clearRect(0, 0, this.tintCanvas.width, this.tintCanvas.height);
        tintContext.fillStyle = color;
        tintContext.fillRect(0, 0, this.tintCanvas.width, this.tintCanvas.height);
        tintContext.globalCompositeOperation = 'destination-in';
        tintContext.drawImage(maskCanvas, 0, 0);
        tintContext.globalCompositeOperation = 'source-over';
    }

    /**
     * 틴트된 로고를 블러 이미지로 합성합니다.
     * @param {CanvasRenderingContext2D} context - 대상 렌더 컨텍스트입니다.
     * @param {{alpha:number, blur:number, offsetX:number, offsetY:number, lineWidth:number}} shadowPass - 그림자 패스 옵션입니다.
     * @private
     */
    #drawBlurredTint(context, shadowPass) {
        context.save();
        context.globalAlpha = shadowPass.alpha;
        context.filter = `blur(${shadowPass.blur}px)`;
        context.drawImage(
            this.tintCanvas,
            this.cacheOffsetX + shadowPass.offsetX,
            this.cacheOffsetY + shadowPass.offsetY
        );
        context.filter = 'none';
        context.restore();
    }

    /**
     * 로고 전체 글자 그룹을 현재 컨텍스트 상태로 그립니다.
     * @param {CanvasRenderingContext2D} ctx - UI 컨텍스트입니다.
     * @private
     */
    #drawLogoGroups(ctx) {
        for (const group of TITLE_LOGO_GROUPS) {
            this.#drawLetterGroup(ctx, group);
        }
    }

    /**
     * 개별 글자 그룹의 위치와 드로잉 진행률을 적용해 렌더링합니다.
     * @param {CanvasRenderingContext2D} ctx - UI 컨텍스트
     * @param {{delay:number, startX:number, duration:number, topPaths:string[], bottomPaths:string[]}} group - 글자 그룹 정보
     * @private
     */
    #drawLetterGroup(ctx, group) {
        const moveProgress = this.#getGroupMoveProgress(group);
        const drawProgress = this.#getGroupDrawProgress(group);

        if (moveProgress <= 0 && drawProgress <= 0) {
            return;
        }

        const easedProgress = easeOutLogoExpo(moveProgress);
        const offsetX = group.startX * (1 - easedProgress);

        ctx.save();
        ctx.translate(offsetX, 0);

        this.#drawOptions.progress = drawProgress;
        if (group.topPaths.length > 0) {
            this.drawer.drawAnimatedPaths(ctx, group.topPaths, this.#drawOptions);
        }
        if (group.bottomPaths.length > 0) {
            this.drawer.drawAnimatedPaths(ctx, group.bottomPaths, this.#drawOptions);
        }

        ctx.restore();
    }

    /**
     * 글자 그룹의 현재 진행률을 계산합니다.
     * @param {{delay:number, duration:number}} group - 글자 그룹 정보
     * @returns {number} 0~1 범위의 진행률
     * @private
     */
    #getGroupMoveProgress(group) {
        const localTime = this.elapsed - group.delay;
        if (localTime <= 0) {
            return 0;
        }
        if (group.duration <= 0) {
            return 1;
        }
        return Math.min(localTime / group.duration, 1);
    }

    /**
     * 글자 그룹의 선 드로잉 진행률을 계산합니다.
     * fill이 뒤따르는 경우를 감안해 stroke 완료 시간이 항상 0.6초가 되도록 보정합니다.
     * @param {{delay:number}} group - 글자 그룹 정보
     * @returns {number} 0~1 범위의 드로잉 진행률
     * @private
     */
    #getGroupDrawProgress(group) {
        const localTime = this.elapsed - group.delay;
        if (localTime <= 0) {
            return 0;
        }

        const fillStart = Number.isFinite(this.#drawOptions.fillStart)
            ? Math.max(this.#drawOptions.fillStart, 0.0001)
            : 1;
        const totalDrawDuration = TITLE_LOGO_STROKE_DURATION / fillStart;
        return Math.min(localTime / totalDrawDuration, 1);
    }
}

export { TitleLogo as LogoRenderer };
