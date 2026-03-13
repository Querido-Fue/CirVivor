import { ColorSchemes } from 'display/_theme_handler.js';
import { SVGDrawer } from 'display/_svg_drawer.js';
import { getCanvas, getUIOffsetX, getUIWW, getWH } from 'display/display_system.js';
import { getDelta } from 'game/time_handler.js';
import { getData } from 'data/data_handler.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');

/**
 * 로고 원본 SVG의 기준 뷰박스 크기입니다.
 * @type {{width:number, height:number}}
 */
const TITLE_LOGO_VIEWBOX = Object.freeze({
    width: 1178.8,
    height: 589.45
});

/**
 * 로고 각 글자의 SVG path 원본 데이터입니다.
 * @type {{top: Object<string, string[]>, bottom: Object<string, string[]>}}
 */
const TITLE_LOGO_PATHS = Object.freeze({
    top: Object.freeze({
        L: Object.freeze([
            'M12.04 13.79 L.84 3.5 L.84 230.08 L12.04 219.84 Z',
            'M12.04 229.95 L.84 240.1 L144.34 240.1 L144.34 229.95 Z'
        ]),
        O: Object.freeze([
            'M273.5,243.6c-16.57,0-31.91-3.1-46.02-9.27-14.12-6.18-26.43-14.88-36.93-26.08-10.5-11.2-18.67-24.2-24.5-39.02-5.84-14.81-8.75-30.74-8.75-47.77s2.85-33.25,8.57-47.95c5.71-14.7,13.83-27.53,24.33-38.5,10.5-10.96,22.75-19.54,36.75-25.73,14-6.18,29.28-9.27,45.85-9.27s31.91,3.1,46.03,9.27c14.12,6.19,26.37,14.76,36.75,25.73,10.38,10.97,18.49,23.86,24.33,38.68,5.83,14.82,8.75,30.86,8.75,48.12s-2.86,32.96-8.58,47.77c-5.72,14.82-13.83,27.77-24.33,38.85-10.5,11.08-22.7,19.72-36.58,25.9-13.88,6.18-29.11,9.27-45.67,9.27ZM272.8,232.75c19.83,0,37.57-4.9,53.2-14.7,15.63-9.8,28-23.1,37.1-39.9,9.1-16.8,13.65-35.7,13.65-56.7,0-15.63-2.62-30.15-7.88-43.58-5.25-13.41-12.54-25.14-21.88-35.17-9.33-10.03-20.3-17.85-32.9-23.45-12.6-5.6-26.37-8.4-41.3-8.4-19.83,0-37.57,4.85-53.2,14.52-15.64,9.69-27.95,22.87-36.93,39.55-8.98,16.69-13.47,35.52-13.47,56.52,0,15.64,2.62,30.22,7.88,43.75,5.25,13.54,12.54,25.38,21.88,35.52,9.33,10.15,20.3,18.02,32.9,23.62,12.6,5.6,26.25,8.4,40.95,8.4Z'
        ]),
        N: Object.freeze([
            'M465.72 18.86 L465.72 37.32 L609.85 240.1 L618.25 240.1 L618.25 3.5 L607.05 14.18 L607.05 217.7',
            'M446.4 3.5 L446.4 240.1 L457.6 229.41 L457.6 3.5 Z'
        ]),
        E: Object.freeze([
            'M677.55,240.1V3.5h150.15l-10.6,10.15h-128.35v100.1h119.58l10.97,9.8h-130.55v106.4h130.29l10.76,10.15h-152.25Z'
        ]),
        L2: Object.freeze([
            'M873.34,240.1V3.5l11.2,11.97v214.48h132.3v10.15h-143.5Z'
        ]),
        Y: Object.freeze([
            'M1088.15 128.79 L1088.15 229.66 L1076.95 240.1 L1076.95 132.3 L986.3 3.5 L999.95 3.5',
            'M1088.56 112.65 L1166.2 3.5 L1178.8 3.5 L1094.86 121.8 Z'
        ])
    }),
    bottom: Object.freeze({
        T: Object.freeze([
            'M10.97 349.35 L0 359.5 L144.34 359.5 L144.34 349.35 Z',
            'M66.99 585.95 L78.19 575.57 L78.19 362.25 L66.99 371.39 Z'
        ]),
        O: Object.freeze([
            'M273.5,589.45c-16.57,0-31.91-3.1-46.03-9.28-14.12-6.18-26.43-14.88-36.93-26.07-10.5-11.2-18.67-24.21-24.5-39.03-5.83-14.81-8.75-30.74-8.75-47.78s2.86-33.25,8.58-47.95c5.71-14.7,13.82-27.53,24.32-38.5,10.5-10.96,22.75-19.54,36.75-25.73,14-6.18,29.28-9.27,45.85-9.27s31.91,3.09,46.03,9.27c14.12,6.19,26.37,14.76,36.75,25.73,10.38,10.97,18.49,23.86,24.33,38.67,5.83,14.82,8.75,30.86,8.75,48.12s-2.86,32.96-8.58,47.77c-5.72,14.82-13.82,27.77-24.32,38.85-10.5,11.08-22.7,19.72-36.58,25.9-13.88,6.18-29.11,9.28-45.67,9.28ZM272.8,578.6c19.83,0,37.57-4.9,53.2-14.7,15.63-9.8,28-23.1,37.1-39.9s13.65-35.7,13.65-56.7c0-15.63-2.62-30.15-7.88-43.57-5.25-13.42-12.54-25.14-21.88-35.18-9.34-10.03-20.3-17.85-32.9-23.45-12.6-5.6-26.37-8.4-41.3-8.4-19.83,0-37.57,4.85-53.2,14.53-15.63,9.68-27.95,22.87-36.93,39.55-8.98,16.68-13.47,35.52-13.47,56.52,0,15.64,2.62,30.22,7.88,43.75,5.25,13.54,12.54,25.38,21.88,35.53,9.33,10.15,20.3,18.03,32.9,23.62s26.25,8.4,40.95,8.4Z'
        ]),
        W: Object.freeze([
            'M440.1 352.5 L428.2 352.5 L503.45 589.1 L513.25 589.1 L576.69 385.37 L571.19 366.54 L508 570.2 Z',
            'M722.2 352.5 L654.3 569.5 L586.4 352.5 L575.55 352.5 L649.05 589.1 L658.85 589.1 L734.1 352.5 Z'
        ]),
        E2: Object.freeze([
            'M787.12,589.1v-236.6h150.15l-10.6,10.15h-128.35v100.1h119.58l10.97,9.8h-130.55v106.4h130.29l10.76,10.15h-152.25Z'
        ]),
        R: Object.freeze([
            'M1079.1 485.76 L1064.7 485.76 L1149.2 589.1 L1164.25 589.1 Z',
            'M1127.67,460.3c12.48-11.67,18.73-26.71,18.73-45.15s-6.25-33.77-18.73-45.33c-12.49-11.55-30.4-17.32-53.72-17.32h-81.55v236.6l11.2-10.82v-100.48h70.35c23.33,0,41.24-5.83,53.72-17.5ZM1003.6,467.65v-105h72.1c19.36,0,34.06,4.79,44.1,14.35,10.03,9.57,15.05,22.29,15.05,38.15s-5.02,28.3-15.05,37.98c-10.04,9.68-24.74,14.52-44.1,14.52h-72.1Z'
        ])
    })
});

/**
 * 글자별 진입 순서와 이동/드로잉 타이밍 설정입니다.
 * @type {Array<{topKey:string, bottomKey:string|null, delay:number, startX:number, duration:number}>}
 */
const TITLE_LOGO_SEQUENCE = Object.freeze([
    Object.freeze({ topKey: 'L', bottomKey: 'T', delay: 0, startX: 290, duration: 3.0 }),
    Object.freeze({ topKey: 'O', bottomKey: 'O', delay: 0.5, startX: 240, duration: 2.5 }),
    Object.freeze({ topKey: 'N', bottomKey: 'W', delay: 0.92, startX: 195, duration: 2.1 }),
    Object.freeze({ topKey: 'E', bottomKey: 'E2', delay: 1.27, startX: 155, duration: 1.75 }),
    Object.freeze({ topKey: 'L2', bottomKey: 'R', delay: 1.55, startX: 120, duration: 1.45 }),
    Object.freeze({ topKey: 'Y', bottomKey: null, delay: 1.75, startX: 90, duration: 1.25 })
]);

/**
 * 렌더링에 바로 사용할 글자 그룹 데이터입니다.
 * @type {Array<{delay:number, startX:number, duration:number, topPaths:string[], bottomPaths:string[]}>}
 */
const TITLE_LOGO_GROUPS = Object.freeze(
    TITLE_LOGO_SEQUENCE.map((sequence) => Object.freeze({
        delay: sequence.delay,
        startX: sequence.startX,
        duration: sequence.duration,
        topPaths: TITLE_LOGO_PATHS.top[sequence.topKey] || Object.freeze([]),
        bottomPaths: sequence.bottomKey ? (TITLE_LOGO_PATHS.bottom[sequence.bottomKey] || Object.freeze([])) : Object.freeze([])
    }))
);

/**
 * 전체 로고 애니메이션의 총 재생 시간입니다.
 * @type {number}
 */
const TITLE_LOGO_TOTAL_DURATION = TITLE_LOGO_GROUPS.reduce(
    (maxDuration, group) => Math.max(maxDuration, group.delay + group.duration),
    0
);

/**
 * 각 글자의 선 드로잉이 완료되는 목표 시간입니다.
 * @type {number}
 */
const TITLE_LOGO_STROKE_DURATION = 0.6;

/**
 * 0~1 범위 진행률에 지수형 감속 이징을 적용합니다.
 * @param {number} progress - 선형 진행률
 * @returns {number} 이징이 적용된 진행률
 */
function easeOutExpo(progress) {
    if (progress <= 0) {
        return 0;
    }
    if (progress >= 1) {
        return 1;
    }
    return 1 - Math.pow(2, -10 * progress);
}

/**
 * 현재 테마를 기준으로 기본 로고 색상을 반환합니다.
 * @returns {string} 로고 기본 색상
 */
function getDefaultLogoColor() {
    return ColorSchemes?.Title?.Logo?.Fill
        || ColorSchemes?.Title?.TextDark
        || ColorSchemes?.Title?.Button?.Text
        || ColorSchemes?.Title?.Menu?.Foreground;
}

/**
 * 현재 테마를 기준으로 로고 그림자 색상을 반환합니다.
 * @returns {string} 로고 그림자 색상
 */
function getDefaultLogoShadowColor() {
    return ColorSchemes?.Title?.Logo?.Shadow
        || ColorSchemes?.Title?.Background
        || ColorSchemes?.Background
        || ColorSchemes?.Title?.TextDark;
}

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
        const shadowPasses = this.#getShadowPasses();
        const cachePadding = this.#calculateCachePadding(shadowPasses);
        const logoWidth = Math.max(1, Math.ceil(this.logoWidth));
        const logoHeight = Math.max(1, Math.ceil(this.logoHeight));
        const renderWidth = Math.max(1, Math.ceil(logoWidth + cachePadding.left + cachePadding.right));
        const renderHeight = Math.max(1, Math.ceil(logoHeight + cachePadding.top + cachePadding.bottom));
        const renderContext = this.renderContext;

        if (!renderContext || !this.logoMaskContext || !this.shadowMaskContext || !this.tintContext) {
            return;
        }

        this.#resizeCacheCanvas(this.logoMaskCanvas, logoWidth, logoHeight);
        this.#resizeCacheCanvas(this.shadowMaskCanvas, logoWidth, logoHeight);
        this.#resizeCacheCanvas(this.tintCanvas, logoWidth, logoHeight);
        this.#resizeCacheCanvas(this.renderCanvas, renderWidth, renderHeight);

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
     * 그림자 패스 정의를 현재 스케일 기준으로 반환합니다.
     * @returns {Array<{alpha:number, blur:number, offsetX:number, offsetY:number, lineWidth:number}>} 그림자 패스 목록입니다.
     * @private
     */
    #getShadowPasses() {
        return [
            {
                alpha: 0.96,
                blur: Math.max(44, 132 * this.scale),
                offsetX: 0,
                offsetY: Math.max(8, 20 * this.scale),
                lineWidth: 2.35
            },
            {
                alpha: 1,
                blur: Math.max(20, 62 * this.scale),
                offsetX: 0,
                offsetY: Math.max(10, 28 * this.scale),
                lineWidth: 2.05
            }
        ];
    }

    /**
     * 그림자 블러를 포함할 오프스크린 패딩을 계산합니다.
     * @param {Array<{blur:number, offsetX:number, offsetY:number}>} shadowPasses - 그림자 패스 목록입니다.
     * @returns {{left:number, top:number, right:number, bottom:number}} 각 방향 패딩입니다.
     * @private
     */
    #calculateCachePadding(shadowPasses) {
        let left = 0;
        let top = 0;
        let right = 0;
        let bottom = 0;

        shadowPasses.forEach((shadowPass) => {
            const spread = Math.ceil(shadowPass.blur * 2.5) + 6;
            left = Math.max(left, spread - shadowPass.offsetX);
            top = Math.max(top, spread - shadowPass.offsetY);
            right = Math.max(right, spread + shadowPass.offsetX);
            bottom = Math.max(bottom, spread + shadowPass.offsetY);
        });

        return {
            left: Math.max(1, Math.ceil(left)),
            top: Math.max(1, Math.ceil(top)),
            right: Math.max(1, Math.ceil(right)),
            bottom: Math.max(1, Math.ceil(bottom))
        };
    }

    /**
     * 오프스크린 캔버스 크기를 필요한 경우에만 갱신합니다.
     * @param {HTMLCanvasElement} canvas - 대상 캔버스입니다.
     * @param {number} width - 목표 너비입니다.
     * @param {number} height - 목표 높이입니다.
     * @private
     */
    #resizeCacheCanvas(canvas, width, height) {
        const nextWidth = Math.max(1, Math.ceil(width));
        const nextHeight = Math.max(1, Math.ceil(height));
        if (canvas.width === nextWidth && canvas.height === nextHeight) {
            return;
        }

        canvas.width = nextWidth;
        canvas.height = nextHeight;
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

        const easedProgress = easeOutExpo(moveProgress);
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
