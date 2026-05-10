import { getData } from 'data/data_handler.js';
import { SVGDrawer } from 'display/_svg_drawer.js';
import { easeOutExpo } from 'util/number_util.js';
import {
    calculateTitleLogoCachePadding,
    getTitleLogoShadowPasses,
    resizeTitleLogoCacheCanvas
} from './_title_logo_cache.js';

const TITLE_LOGO_DATA = getData('TITLE_LOGO_DATA');

/**
 * 타이틀 로고의 마스크, 틴트, 그림자 합성 캐시를 관리합니다.
 */
export class TitleLogoRenderCache {
    /**
     * 로고 렌더 캐시에 필요한 오프스크린 캔버스를 초기화합니다.
     */
    constructor() {
        this.drawer = new SVGDrawer();
        this.drawOptions = {
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
    }

    /**
     * 로고 캐시를 다시 만들도록 더티 상태로 표시합니다.
     */
    markDirty() {
        this.cacheDirty = true;
    }

    /**
     * 현재 상태에 맞는 렌더 캐시를 보장합니다.
     * @param {object} options - 캐시 갱신 옵션입니다.
     * @param {number} options.scale - 현재 로고 스케일입니다.
     * @param {number} options.logoWidth - 현재 로고 너비입니다.
     * @param {number} options.logoHeight - 현재 로고 높이입니다.
     * @param {number} options.elapsed - 현재 누적 재생 시간입니다.
     * @param {string} options.logoColor - 로고 색상입니다.
     * @param {string} options.shadowColor - 그림자 색상입니다.
     */
    ensure({
        scale,
        logoWidth,
        logoHeight,
        elapsed,
        logoColor,
        shadowColor
    }) {
        if (shadowColor !== this.cachedShadowColor || logoColor !== this.cachedLogoColor) {
            this.markDirty();
        }

        if (this.cacheDirty !== true) {
            return;
        }

        this._rebuild({
            scale,
            logoWidth,
            logoHeight,
            elapsed,
            logoColor,
            shadowColor
        });
    }

    /**
     * 렌더 가능한 캐시 캔버스가 있는지 반환합니다.
     * @returns {boolean} 렌더 가능 여부입니다.
     */
    hasRenderableCanvas() {
        return this.renderCanvas.width > 0 && this.renderCanvas.height > 0;
    }

    /**
     * 렌더 캐시를 UI 컨텍스트에 그립니다.
     * @param {CanvasRenderingContext2D} ctx - UI 레이어 컨텍스트입니다.
     * @param {number} logoX - 로고 원점 X 좌표입니다.
     * @param {number} logoY - 로고 원점 Y 좌표입니다.
     */
    drawTo(ctx, logoX, logoY) {
        ctx.drawImage(
            this.renderCanvas,
            logoX - this.cacheOffsetX,
            logoY - this.cacheOffsetY
        );
    }

    /**
     * 내부 오프스크린 캔버스 리소스를 정리합니다.
     */
    destroy() {
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
     * 현재 로고 상태를 오프스크린 비트맵으로 다시 합성합니다.
     * @param {object} options - 캐시 재생성 옵션입니다.
     * @param {number} options.scale - 현재 로고 스케일입니다.
     * @param {number} options.logoWidth - 현재 로고 너비입니다.
     * @param {number} options.logoHeight - 현재 로고 높이입니다.
     * @param {number} options.elapsed - 현재 누적 재생 시간입니다.
     * @param {string} options.logoColor - 로고 색상입니다.
     * @param {string} options.shadowColor - 그림자 색상입니다.
     */
    _rebuild({
        scale,
        logoWidth,
        logoHeight,
        elapsed,
        logoColor,
        shadowColor
    }) {
        const shadowPasses = getTitleLogoShadowPasses(scale);
        const cachePadding = calculateTitleLogoCachePadding(shadowPasses);
        const cacheLogoWidth = Math.max(1, Math.ceil(logoWidth));
        const cacheLogoHeight = Math.max(1, Math.ceil(logoHeight));
        const renderWidth = Math.max(1, Math.ceil(cacheLogoWidth + cachePadding.left + cachePadding.right));
        const renderHeight = Math.max(1, Math.ceil(cacheLogoHeight + cachePadding.top + cachePadding.bottom));
        const renderContext = this.renderContext;

        if (!renderContext || !this.logoMaskContext || !this.shadowMaskContext || !this.tintContext) {
            return;
        }

        resizeTitleLogoCacheCanvas(this.logoMaskCanvas, cacheLogoWidth, cacheLogoHeight);
        resizeTitleLogoCacheCanvas(this.shadowMaskCanvas, cacheLogoWidth, cacheLogoHeight);
        resizeTitleLogoCacheCanvas(this.tintCanvas, cacheLogoWidth, cacheLogoHeight);
        resizeTitleLogoCacheCanvas(this.renderCanvas, renderWidth, renderHeight);

        this.cacheOffsetX = cachePadding.left;
        this.cacheOffsetY = cachePadding.top;

        this._renderMask(this.logoMaskContext, 1.5, scale, logoColor, elapsed);
        this._renderMask(this.shadowMaskContext, shadowPasses[0]?.lineWidth || 2.35, scale, logoColor, elapsed);

        renderContext.clearRect(0, 0, renderWidth, renderHeight);
        this._tintMask(this.shadowMaskCanvas, shadowColor);
        shadowPasses.forEach((shadowPass) => {
            this._drawBlurredTint(renderContext, shadowPass);
        });
        this._tintMask(this.logoMaskCanvas, logoColor);
        renderContext.drawImage(this.tintCanvas, this.cacheOffsetX, this.cacheOffsetY);

        this.cachedShadowColor = shadowColor;
        this.cachedLogoColor = logoColor;
        this.cacheDirty = false;
    }

    /**
     * 현재 로고 실루엣을 마스크 캔버스에 렌더링합니다.
     * @param {CanvasRenderingContext2D} context - 대상 마스크 컨텍스트입니다.
     * @param {number} lineWidth - 사용할 스트로크 두께입니다.
     * @param {number} scale - 현재 로고 스케일입니다.
     * @param {string} logoColor - 마스크 렌더에 사용할 색상입니다.
     * @param {number} elapsed - 현재 누적 재생 시간입니다.
     */
    _renderMask(context, lineWidth, scale, logoColor, elapsed) {
        if (!context) {
            return;
        }

        context.clearRect(0, 0, context.canvas.width, context.canvas.height);
        context.save();
        context.scale(scale, scale);
        context.fillStyle = logoColor;
        context.strokeStyle = logoColor;
        context.lineWidth = lineWidth;
        context.lineJoin = 'round';
        context.lineCap = 'round';
        this._drawLogoGroups(context, elapsed);
        context.restore();
    }

    /**
     * 마스크 캔버스를 지정한 색상으로 틴트합니다.
     * @param {HTMLCanvasElement} maskCanvas - 사용할 마스크 캔버스입니다.
     * @param {string} color - 적용할 색상입니다.
     */
    _tintMask(maskCanvas, color) {
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
     */
    _drawBlurredTint(context, shadowPass) {
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
     * @param {number} elapsed - 현재 누적 재생 시간입니다.
     */
    _drawLogoGroups(ctx, elapsed) {
        for (const group of TITLE_LOGO_DATA.GROUPS) {
            this._drawLetterGroup(ctx, group, elapsed);
        }
    }

    /**
     * 개별 글자 그룹의 위치와 드로잉 진행률을 적용해 렌더링합니다.
     * @param {CanvasRenderingContext2D} ctx - UI 컨텍스트입니다.
     * @param {{delay:number, startX:number, duration:number, topPaths:string[], bottomPaths:string[]}} group - 글자 그룹 정보입니다.
     * @param {number} elapsed - 현재 누적 재생 시간입니다.
     */
    _drawLetterGroup(ctx, group, elapsed) {
        const moveProgress = this._getGroupMoveProgress(group, elapsed);
        const drawProgress = this._getGroupDrawProgress(group, elapsed);

        if (moveProgress <= 0 && drawProgress <= 0) {
            return;
        }

        const easedProgress = easeOutExpo(moveProgress);
        const offsetX = group.startX * (1 - easedProgress);

        ctx.save();
        ctx.translate(offsetX, 0);

        this.drawOptions.progress = drawProgress;
        if (group.topPaths.length > 0) {
            this.drawer.drawAnimatedPaths(ctx, group.topPaths, this.drawOptions);
        }
        if (group.bottomPaths.length > 0) {
            this.drawer.drawAnimatedPaths(ctx, group.bottomPaths, this.drawOptions);
        }

        ctx.restore();
    }

    /**
     * 글자 그룹의 현재 이동 진행률을 계산합니다.
     * @param {{delay:number, duration:number}} group - 글자 그룹 정보입니다.
     * @param {number} elapsed - 현재 누적 재생 시간입니다.
     * @returns {number} 0~1 범위의 진행률입니다.
     */
    _getGroupMoveProgress(group, elapsed) {
        const localTime = elapsed - group.delay;
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
     * @param {{delay:number}} group - 글자 그룹 정보입니다.
     * @param {number} elapsed - 현재 누적 재생 시간입니다.
     * @returns {number} 0~1 범위의 드로잉 진행률입니다.
     */
    _getGroupDrawProgress(group, elapsed) {
        const localTime = elapsed - group.delay;
        if (localTime <= 0) {
            return 0;
        }

        const fillStart = Number.isFinite(this.drawOptions.fillStart)
            ? Math.max(this.drawOptions.fillStart, 0.0001)
            : 1;
        const totalDrawDuration = TITLE_LOGO_DATA.STROKE_DURATION / fillStart;
        return Math.min(localTime / totalDrawDuration, 1);
    }
}
