import { getData } from 'data/data_handler.js';
import { ColorSchemes, getCurrentThemeKey } from 'display/_theme_handler.js';

const VIGNETTE_CONSTANTS = getData('VIGNETTE_CONSTANTS');
const ORDERED_DITHER_MATRIX_4X4 = Object.freeze([
    Object.freeze([0, 8, 2, 10]),
    Object.freeze([12, 4, 14, 6]),
    Object.freeze([3, 11, 1, 9]),
    Object.freeze([15, 7, 13, 5])
]);

/**
 * @typedef {object} VignetteLayerDescriptor
 * @property {string} id - 비네팅 레이어 식별자입니다.
 * @property {number} order - 비네팅 레이어 표시 순서입니다.
 * @property {number} edgeWidthMultiplier - 비네팅 범위 배율입니다.
 * @property {'WORLD'} themeSlot - 테마에서 사용할 비네팅 슬롯입니다.
 */

/**
 * @typedef {object} VignetteCacheEntry
 * @property {HTMLCanvasElement} canvas - 최종 캐시 캔버스입니다.
 * @property {CanvasRenderingContext2D} context - 최종 캐시 컨텍스트입니다.
 * @property {HTMLCanvasElement} maskCanvas - 마스크 생성용 캔버스입니다.
 * @property {CanvasRenderingContext2D} maskContext - 마스크 생성용 컨텍스트입니다.
 * @property {HTMLCanvasElement} blurCanvas - 블러 결과용 캔버스입니다.
 * @property {CanvasRenderingContext2D} blurContext - 블러 결과용 컨텍스트입니다.
 * @property {ImageData|null} imageData - 최종 색상화 버퍼입니다.
 * @property {number} padding - 블러 여유 영역입니다.
 * @property {boolean} dirty - 캐시 갱신 필요 여부입니다.
 * @property {boolean} presentDirty - 화면 레이어 재반영 필요 여부입니다.
 * @property {boolean} visible - 현재 캐시에 실제 출력이 존재하는지 여부입니다.
 */

/**
 * @class VignetteRenderer
 * @description CSS inset shadow와 유사한 결과를 내기 위해 블러 기반 rounded-rect 마스크를 캐시 렌더링합니다.
 */
export class VignetteRenderer {
    constructor() {
        this.width = 0;
        this.height = 0;
        this.currentThemeKey = getCurrentThemeKey();
        this.layerDescriptors = Object.freeze([
            this._createLayerDescriptor('WORLD', VIGNETTE_CONSTANTS.LAYERS.WORLD)
        ]);
        this.cacheMap = new Map();

        this.layerDescriptors.forEach((descriptor) => {
            this.cacheMap.set(descriptor.id, this._createCacheEntry());
        });
    }

    /**
     * 비네팅 레이어 정의 목록을 반환합니다.
     * @returns {VignetteLayerDescriptor[]} 비네팅 레이어 정의 목록입니다.
     */
    getLayerDescriptors() {
        return this.layerDescriptors;
    }

    /**
     * 내부 렌더 해상도 변경을 반영합니다.
     * @param {number} width - 내부 렌더 너비입니다.
     * @param {number} height - 내부 렌더 높이입니다.
     */
    resize(width, height) {
        const nextWidth = Math.max(1, Math.floor(width || 1));
        const nextHeight = Math.max(1, Math.floor(height || 1));

        if (this.width === nextWidth && this.height === nextHeight) {
            return;
        }

        this.width = nextWidth;
        this.height = nextHeight;

        for (const cacheEntry of this.cacheMap.values()) {
            cacheEntry.canvas.width = nextWidth;
            cacheEntry.canvas.height = nextHeight;
            cacheEntry.imageData = null;
            cacheEntry.dirty = true;
            cacheEntry.presentDirty = true;
            cacheEntry.visible = false;
        }

        this._rebuildCaches();
    }

    /**
     * 현재 캐시된 비네팅 이미지를 각 2D 레이어에 그립니다.
     * @param {import('./_draw_handler_2d.js').DrawHandler2D} drawHandler - 대상 2D 드로우 핸들러입니다.
     */
    draw(drawHandler) {
        if (!drawHandler || this.width <= 0 || this.height <= 0) {
            return;
        }

        const nextThemeKey = getCurrentThemeKey();
        if (nextThemeKey !== this.currentThemeKey) {
            this.currentThemeKey = nextThemeKey;
            this._markAllDirty();
        }

        this._rebuildCaches();

        this.layerDescriptors.forEach((descriptor) => {
            const cacheEntry = this.cacheMap.get(descriptor.id);
            if (!cacheEntry?.canvas || cacheEntry.presentDirty !== true) {
                return;
            }

            drawHandler.clear(descriptor.id);
            if (cacheEntry.visible === true) {
                drawHandler.render(descriptor.id, {
                    shape: 'image',
                    image: cacheEntry.canvas,
                    x: 0,
                    y: 0,
                    w: this.width,
                    h: this.height
                });
            }
            cacheEntry.presentDirty = false;
        });
    }

    /**
     * 비네팅 레이어 정의를 정규화합니다.
     * @param {'WORLD'} themeSlot - 테마에서 참조할 슬롯 이름입니다.
     * @param {{ID: string, ORDER: number, EDGE_WIDTH_MULTIPLIER: number}} rawDescriptor - 원본 레이어 정의입니다.
     * @returns {VignetteLayerDescriptor} 정규화된 레이어 정의입니다.
     */
    _createLayerDescriptor(themeSlot, rawDescriptor) {
        return Object.freeze({
            id: rawDescriptor.ID,
            order: rawDescriptor.ORDER,
            edgeWidthMultiplier: rawDescriptor.EDGE_WIDTH_MULTIPLIER,
            themeSlot
        });
    }

    /**
     * 비네팅 캐시 엔트리를 생성합니다.
     * @returns {VignetteCacheEntry} 새 캐시 엔트리입니다.
     */
    _createCacheEntry() {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        const maskCanvas = document.createElement('canvas');
        const maskContext = maskCanvas.getContext('2d');
        const blurCanvas = document.createElement('canvas');
        const blurContext = blurCanvas.getContext('2d');

        return {
            canvas,
            context,
            maskCanvas,
            maskContext,
            blurCanvas,
            blurContext,
            imageData: null,
            padding: 0,
            dirty: true,
            presentDirty: true,
            visible: false
        };
    }

    /**
     * 모든 비네팅 캐시를 다시 그리도록 더티 상태로 표시합니다.
     */
    _markAllDirty() {
        for (const cacheEntry of this.cacheMap.values()) {
            cacheEntry.dirty = true;
        }
    }

    /**
     * 더티 상태인 오프스크린 비네팅 캐시를 다시 생성합니다.
     */
    _rebuildCaches() {
        this.layerDescriptors.forEach((descriptor) => {
            const cacheEntry = this.cacheMap.get(descriptor.id);
            if (!cacheEntry?.dirty) {
                return;
            }

            this._drawVignetteCache(descriptor, cacheEntry);
            cacheEntry.dirty = false;
            cacheEntry.presentDirty = true;
        });
    }

    /**
     * 단일 비네팅 캐시를 갱신합니다.
     * @param {VignetteLayerDescriptor} descriptor - 갱신할 비네팅 레이어 정의입니다.
     * @param {VignetteCacheEntry} cacheEntry - 대상 캐시 엔트리입니다.
     */
    _drawVignetteCache(descriptor, cacheEntry) {
        const context = cacheEntry.context;
        if (!context) {
            return;
        }

        context.clearRect(0, 0, this.width, this.height);
        cacheEntry.visible = false;

        const themeLayer = this._resolveThemeLayer(descriptor);
        const edgeWidth = this._calculateEdgeWidth(descriptor);
        const edgeAlpha = this._calculateEdgeAlpha(themeLayer);
        const edgeRgb = this._resolveEdgeRgb(themeLayer);

        if (edgeWidth <= 0 || edgeAlpha <= 0) {
            return;
        }

        const maskInset = this._calculateMaskInset(edgeWidth);
        const blurRadius = this._calculateBlurRadius(edgeWidth);
        const cornerRadius = this._calculateCornerRadius(maskInset);
        this._ensureScratchSurfaces(cacheEntry, blurRadius);
        this._renderInverseMask(cacheEntry, maskInset, cornerRadius);
        this._renderBlurredMask(cacheEntry, blurRadius);
        this._ensureOutputBuffer(cacheEntry);
        this._colorizeBlur(cacheEntry, edgeRgb, edgeAlpha);
        context.putImageData(cacheEntry.imageData, 0, 0);
        cacheEntry.visible = true;
    }

    /**
     * 비네팅 범위를 계산합니다.
     * @param {VignetteLayerDescriptor} descriptor - 대상 비네팅 레이어 정의입니다.
     * @returns {number} 픽셀 기준 비네팅 범위입니다.
     */
    _calculateEdgeWidth(descriptor) {
        const minDimension = Math.max(1, Math.min(this.width, this.height));
        const baseRatio = VIGNETTE_CONSTANTS.BASE_EDGE_WIDTH_PX / VIGNETTE_CONSTANTS.BASE_REFERENCE_HEIGHT_PX;
        const rawRatio = baseRatio * descriptor.edgeWidthMultiplier;
        const clampedRatio = Math.max(
            VIGNETTE_CONSTANTS.MIN_EDGE_WIDTH_RATIO,
            Math.min(VIGNETTE_CONSTANTS.MAX_EDGE_WIDTH_RATIO, rawRatio)
        );
        return Math.max(1, Math.round(minDimension * clampedRatio));
    }

    /**
     * 비네팅 마스크의 안쪽 inset을 계산합니다.
     * @param {number} edgeWidth - 비네팅 범위입니다.
     * @returns {number} 마스크 inset 값입니다.
     */
    _calculateMaskInset(edgeWidth) {
        return Math.max(1, Math.round(edgeWidth * VIGNETTE_CONSTANTS.MASK_INSET_MULTIPLIER));
    }

    /**
     * 비네팅 블러 반경을 계산합니다.
     * @param {number} edgeWidth - 비네팅 범위입니다.
     * @returns {number} 블러 반경입니다.
     */
    _calculateBlurRadius(edgeWidth) {
        return Math.max(1, Math.round(edgeWidth * VIGNETTE_CONSTANTS.BLUR_RADIUS_MULTIPLIER));
    }

    /**
     * 비네팅 강도를 계산합니다.
     * @param {{RGB?: number[], AlphaMultiplier?: number}|null} themeLayer - 현재 테마의 비네팅 레이어 설정입니다.
     * @returns {number} 0~1 범위의 비네팅 알파 값입니다.
     */
    _calculateEdgeAlpha(themeLayer) {
        const alphaMultiplier = Number(themeLayer?.AlphaMultiplier);
        const rawAlpha = VIGNETTE_CONSTANTS.BASE_EDGE_ALPHA * (Number.isFinite(alphaMultiplier) ? alphaMultiplier : 1);
        return Math.max(0, Math.min(0.98, rawAlpha));
    }

    /**
     * 해상도에 비례한 둥근 직사각형 반경을 계산합니다.
     * @param {number} maskInset - 마스크 inset 값입니다.
     * @returns {number} 사용할 모서리 반경입니다.
     */
    _calculateCornerRadius(maskInset) {
        const minDimension = Math.max(1, Math.min(this.width, this.height));
        const rawRadius = (VIGNETTE_CONSTANTS.BASE_CORNER_RADIUS_PX / VIGNETTE_CONSTANTS.BASE_REFERENCE_HEIGHT_PX) * minDimension;
        const innerWidth = Math.max(0, this.width - (maskInset * 2));
        const innerHeight = Math.max(0, this.height - (maskInset * 2));
        return this._normalizeCornerRadius(rawRadius, innerWidth, innerHeight);
    }

    /**
     * 블러 여유 영역을 포함한 스크래치 캔버스 크기를 보장합니다.
     * @param {VignetteCacheEntry} cacheEntry - 대상 캐시 엔트리입니다.
     * @param {number} blurRadius - 블러 반경입니다.
     */
    _ensureScratchSurfaces(cacheEntry, blurRadius) {
        const padding = Math.max(8, Math.ceil(blurRadius * 2.5));
        const paddedWidth = this.width + (padding * 2);
        const paddedHeight = this.height + (padding * 2);

        if (cacheEntry.padding === padding
            && cacheEntry.maskCanvas.width === paddedWidth
            && cacheEntry.maskCanvas.height === paddedHeight) {
            return;
        }

        cacheEntry.padding = padding;
        cacheEntry.maskCanvas.width = paddedWidth;
        cacheEntry.maskCanvas.height = paddedHeight;
        cacheEntry.blurCanvas.width = paddedWidth;
        cacheEntry.blurCanvas.height = paddedHeight;
    }

    /**
     * inverse rounded-rect 마스크를 그립니다.
     * @param {VignetteCacheEntry} cacheEntry - 대상 캐시 엔트리입니다.
     * @param {number} maskInset - 마스크 inset 값입니다.
     * @param {number} cornerRadius - rounded-rect 반경입니다.
     */
    _renderInverseMask(cacheEntry, maskInset, cornerRadius) {
        const maskContext = cacheEntry.maskContext;
        if (!maskContext) {
            return;
        }

        const paddedWidth = cacheEntry.maskCanvas.width;
        const paddedHeight = cacheEntry.maskCanvas.height;
        const innerWidth = Math.max(0, this.width - (maskInset * 2));
        const innerHeight = Math.max(0, this.height - (maskInset * 2));
        const innerX = cacheEntry.padding + maskInset;
        const innerY = cacheEntry.padding + maskInset;

        maskContext.clearRect(0, 0, paddedWidth, paddedHeight);
        maskContext.fillStyle = '#ffffff';
        maskContext.fillRect(0, 0, paddedWidth, paddedHeight);

        if (innerWidth <= 0 || innerHeight <= 0) {
            return;
        }

        maskContext.globalCompositeOperation = 'destination-out';
        maskContext.beginPath();
        this._appendRoundedRectPath(maskContext, innerX, innerY, innerWidth, innerHeight, cornerRadius);
        maskContext.fill();
        maskContext.globalCompositeOperation = 'source-over';
    }

    /**
     * 마스크에 블러를 적용합니다.
     * @param {VignetteCacheEntry} cacheEntry - 대상 캐시 엔트리입니다.
     * @param {number} blurRadius - 블러 반경입니다.
     */
    _renderBlurredMask(cacheEntry, blurRadius) {
        const blurContext = cacheEntry.blurContext;
        if (!blurContext) {
            return;
        }

        blurContext.clearRect(0, 0, cacheEntry.blurCanvas.width, cacheEntry.blurCanvas.height);
        blurContext.filter = `blur(${blurRadius}px)`;
        blurContext.drawImage(cacheEntry.maskCanvas, 0, 0);
        blurContext.filter = 'none';
    }

    /**
     * 최종 출력용 ImageData 버퍼를 준비합니다.
     * @param {VignetteCacheEntry} cacheEntry - 대상 캐시 엔트리입니다.
     */
    _ensureOutputBuffer(cacheEntry) {
        if (!cacheEntry.imageData
            || cacheEntry.imageData.width !== this.width
            || cacheEntry.imageData.height !== this.height) {
            cacheEntry.imageData = cacheEntry.context.createImageData(this.width, this.height);
            return;
        }

        cacheEntry.imageData.data.fill(0);
    }

    /**
     * 블러 마스크를 테마 색상으로 색칠하고 디더링을 추가합니다.
     * @param {VignetteCacheEntry} cacheEntry - 대상 캐시 엔트리입니다.
     * @param {number[]} edgeRgb - 비네팅 RGB 색상입니다.
     * @param {number} edgeAlpha - 비네팅 강도입니다.
     */
    _colorizeBlur(cacheEntry, edgeRgb, edgeAlpha) {
        const blurContext = cacheEntry.blurContext;
        const imageData = cacheEntry.imageData;
        if (!blurContext || !imageData) {
            return;
        }

        const sourceData = blurContext.getImageData(
            cacheEntry.padding,
            cacheEntry.padding,
            this.width,
            this.height
        ).data;
        const outputData = imageData.data;
        const [red = 0, green = 0, blue = 0] = Array.isArray(edgeRgb) ? edgeRgb : [0, 0, 0];

        for (let y = 0; y < this.height; y += 1) {
            for (let x = 0; x < this.width; x += 1) {
                const pixelIndex = ((y * this.width) + x) * 4;
                const sourceAlpha = sourceData[pixelIndex + 3];
                if (sourceAlpha <= 0) {
                    continue;
                }

                const alphaByte = this._resolveAlphaByte(sourceAlpha * edgeAlpha, x, y);
                if (alphaByte <= 0) {
                    continue;
                }

                outputData[pixelIndex] = red;
                outputData[pixelIndex + 1] = green;
                outputData[pixelIndex + 2] = blue;
                outputData[pixelIndex + 3] = alphaByte;
            }
        }
    }

    /**
     * 현재 테마의 비네팅 레이어 설정을 반환합니다.
     * @param {VignetteLayerDescriptor} descriptor - 대상 비네팅 레이어 정의입니다.
     * @returns {{RGB?: number[], AlphaMultiplier?: number}|null} 현재 테마의 비네팅 레이어 설정입니다.
     */
    _resolveThemeLayer(descriptor) {
        const themeVignette = ColorSchemes?.Vignette;
        if (!themeVignette || !descriptor?.themeSlot) {
            return null;
        }

        return themeVignette[descriptor.themeSlot] || null;
    }

    /**
     * 현재 테마에 대응하는 비네팅 색상을 반환합니다.
     * @param {{RGB?: number[]}|null} themeLayer - 현재 테마의 비네팅 레이어 설정입니다.
     * @returns {number[]} 사용할 RGB 색상입니다.
     */
    _resolveEdgeRgb(themeLayer) {
        return Array.isArray(themeLayer?.RGB) ? themeLayer.RGB : [0, 0, 0];
    }

    /**
     * 픽셀 위치별 ordered dithering을 적용해 최종 알파 바이트를 반환합니다.
     * @param {number} alphaValue - 기본 알파 값입니다.
     * @param {number} x - 픽셀 X 좌표입니다.
     * @param {number} y - 픽셀 Y 좌표입니다.
     * @returns {number} 최종 알파 바이트 값입니다.
     */
    _resolveAlphaByte(alphaValue, x, y) {
        const ditherStrength = Number(VIGNETTE_CONSTANTS.DITHER_STRENGTH) || 0;
        const matrixValue = ORDERED_DITHER_MATRIX_4X4[y & 3][x & 3] / 16;
        const ditherOffset = (matrixValue - 0.46875) * ditherStrength;
        return Math.max(0, Math.min(255, Math.round(alphaValue + ditherOffset)));
    }

    /**
     * 라운드 사각형 반경을 대상 크기에 맞게 정규화합니다.
     * @param {number} radius - 정규화할 반경입니다.
     * @param {number} width - 대상 너비입니다.
     * @param {number} height - 대상 높이입니다.
     * @returns {number} 정규화된 반경입니다.
     */
    _normalizeCornerRadius(radius, width, height) {
        const maxRadius = Math.max(0, Math.min(width / 2, height / 2));
        return Math.max(0, Math.min(radius, maxRadius));
    }

    /**
     * rounded-rect 경로를 현재 컨텍스트에 추가합니다.
     * @param {CanvasRenderingContext2D} context - 대상 컨텍스트입니다.
     * @param {number} x - 시작 X 좌표입니다.
     * @param {number} y - 시작 Y 좌표입니다.
     * @param {number} width - 사각형 너비입니다.
     * @param {number} height - 사각형 높이입니다.
     * @param {number} radius - 코너 반경입니다.
     */
    _appendRoundedRectPath(context, x, y, width, height, radius) {
        const normalizedRadius = this._normalizeCornerRadius(radius, width, height);
        if (normalizedRadius <= 0) {
            context.rect(x, y, width, height);
            return;
        }

        const right = x + width;
        const bottom = y + height;

        context.moveTo(x + normalizedRadius, y);
        context.lineTo(right - normalizedRadius, y);
        context.quadraticCurveTo(right, y, right, y + normalizedRadius);
        context.lineTo(right, bottom - normalizedRadius);
        context.quadraticCurveTo(right, bottom, right - normalizedRadius, bottom);
        context.lineTo(x + normalizedRadius, bottom);
        context.quadraticCurveTo(x, bottom, x, bottom - normalizedRadius);
        context.lineTo(x, y + normalizedRadius);
        context.quadraticCurveTo(x, y, x + normalizedRadius, y);
        context.closePath();
    }
}
