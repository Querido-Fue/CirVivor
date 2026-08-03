import { getCanvas, getDisplaySystem, getUIOffsetX, getUIWW, getWH } from 'display/display_system.js';
import { getDelta } from 'game/time_handler.js';
import {
    advanceTitleLogoPlayback,
    calculateTitleLogoPlaybackProgress,
    calculateTitleLogoRemainingTimeToProgress
} from './logo/_title_logo_playback.js';
import { TitleLogoRenderCache } from './logo/_title_logo_render_cache.js';
import { TITLE_LOGO_ASSET } from './logo/_title_logo_asset.js';
import { getDefaultLogoColor, getDefaultLogoShadowColor } from './logo/_title_logo_theme.js';
import { TITLE_IMAGE_LAYOUT } from './_title_runtime_constants.js';

/**
 * @class TitleLogo
 * @description 타이틀 화면에서 SVG 경로 기반의 로고 드로잉 애니메이션을 렌더링합니다.
 */
export class TitleLogo {
    #ctx;

    /**
     * @param {TitleScene} titleScene - 타이틀 씬 인스턴스
     */
    constructor(titleScene) {
        this.titleScene = titleScene;
        this.displaySystem = getDisplaySystem();
        this.#ctx = null;
        this.renderCache = new TitleLogoRenderCache();

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
        this.presentationPacket = {
            canvas: null,
            revision: 0,
            destX: 0,
            destY: 0,
            width: 0,
            height: 0
        };
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
        const playback = advanceTitleLogoPlayback({
            elapsed: this.elapsed,
            delta,
            isPlaying: this.isPlaying,
            isFinished: this.isFinished
        });
        if (playback.elapsedChanged) {
            this.#markCacheDirty();
        }
        this.elapsed = playback.elapsed;
        this.isPlaying = playback.isPlaying;
        this.isFinished = playback.isFinished;
    }

    /**
     * 현재 로고 드로잉 애니메이션의 진행률을 반환합니다.
     * @returns {number} 0~1 범위의 재생 진행률
     */
    getPlaybackProgress() {
        return calculateTitleLogoPlaybackProgress(this.elapsed);
    }

    /**
     * 지정한 재생 진행률까지 남은 시간을 초 단위로 반환합니다.
     * @param {number} targetProgress - 0~1 범위 목표 진행률입니다.
     * @returns {number} 남은 시간(초)입니다.
     */
    getRemainingTimeToProgress(targetProgress) {
        return calculateTitleLogoRemainingTimeToProgress(this.elapsed, targetProgress);
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
        if (!this.renderCache.hasRenderableCanvas()) {
            return;
        }

        this.renderCache.drawTo(ctx, this.logoX, this.logoY);
        this.displaySystem?.markSurfaceDirectDraw('ui');
    }

    /**
     * 현재 legacy 로고 캐시와 정확히 같은 bitmap/배치를 WebGPU graph에 전달합니다.
     * 반환 객체는 hot path에서 재사용되므로 호출자는 같은 프레임 안에서만 값을 소비해야 합니다.
     * @returns {object|null} atlas upload와 composite에 사용할 source packet입니다.
     */
    getPresentationPacket() {
        if (!this.hasStarted) {
            return null;
        }
        this.#ensureRenderCache();
        const source = this.renderCache.getPresentationSource?.();
        if (!source?.canvas || source.width <= 0 || source.height <= 0) {
            return null;
        }
        const packet = this.presentationPacket;
        packet.canvas = source.canvas;
        packet.revision = source.revision;
        packet.destX = this.logoX - source.offsetX;
        packet.destY = this.logoY - source.offsetY;
        packet.width = source.width;
        packet.height = source.height;
        return packet;
    }

    /**
     * 내부 참조를 정리합니다.
     */
    destroy() {
        this.#ctx = null;
        this.displaySystem = null;
        this.isPlaying = false;
        this.renderCache.destroy();
        this.presentationPacket.canvas = null;
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
        const defaultWidth = this.UIWW * TITLE_IMAGE_LAYOUT.WIDTH_RATIO;
        this.logoWidth = this.customPlacement
            ? Math.max(1, this.customPlacement.width)
            : defaultWidth;
        this.scale = this.logoWidth / TITLE_LOGO_ASSET.VIEWBOX.width;
        this.logoHeight = TITLE_LOGO_ASSET.VIEWBOX.height * this.scale;

        if (this.customPlacement) {
            this.logoX = this.customPlacement.x;
            this.logoY = this.customPlacement.centerY - (this.logoHeight * 0.5);
            return;
        }

        this.logoX = this.UIOffsetX + (this.UIWW * TITLE_IMAGE_LAYOUT.ENTER_X_RATIO);
        this.logoY = (this.WH - this.logoHeight) * 0.5;
    }

    /**
     * 로고 캐시를 다시 만들도록 더티 상태로 표시합니다.
     * @private
     */
    #markCacheDirty() {
        this.renderCache.markDirty();
    }

    /**
     * 현재 상태에 맞는 렌더 캐시를 보장합니다.
     * @private
     */
    #ensureRenderCache() {
        this.renderCache.ensure({
            scale: this.scale,
            logoWidth: this.logoWidth,
            logoHeight: this.logoHeight,
            elapsed: this.elapsed,
            logoColor: this.currentColor,
            shadowColor: getDefaultLogoShadowColor()
        });
    }
}

export { TitleLogo as LogoRenderer };
