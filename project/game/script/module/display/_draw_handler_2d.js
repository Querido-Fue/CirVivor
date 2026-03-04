import { getBlurCanvas, getBlurCtx, getBlurScale } from "./_blur_canvas.js";

/**
 * @class DrawUtil
 * @description 캔버스 드로잉을 추상화하여 관리하는 유틸리티 클래스입니다.
 * 여러 캔버스 레이어(context)를 관리하고, 상태 캐싱 및 도형별 최적화된 그리기 기능을 제공합니다.
 */
export class DrawHandler2D {
    #contexts;
    #stateCaches;
    #shadowState;
    #pathCache;
    #measureCtx;

    /**
     * @param {Object.<string, CanvasRenderingContext2D>} contexts - 레이어 이름을 키로 가지는 컨텍스트 객체
     */
    constructor(contexts) {
        this.#contexts = contexts;
        this.#stateCaches = {};
        this.#shadowState = {};
        this.#pathCache = {};

        for (const key in contexts) {
            this.#stateCaches[key] = {};
            this.#shadowState[key] = { shadowBlur: 0, shadowColor: 'rgba(0,0,0,0)' };
        }

        this.#generatePaths();

        // 전용 측정용 캔버스/컨텍스트 생성 (메인 캔버스 오염 방지)
        const measureCanvas = document.createElement('canvas');
        this.#measureCtx = measureCanvas.getContext('2d');
    }

    /**
     * 텍스트의 너비를 측정합니다.
     * @param {string} text - 측정할 텍스트
     * @param {string} font - 폰트 스타일 (예: 'bold 20px Arial')
     * @returns {number} 텍스트 너비
     */
    measureText(text, font) {
        this.#measureCtx.font = font;
        return this.#measureCtx.measureText(text).width;
    }

    /**
     * 특정 레이어에 그림자 효과를 영구적으로 적용합니다.
     * @param {string} layerName - 레이어 이름
     * @param {number} blur - 그림자 블러 정도
     * @param {string} color - 그림자 색상
     */
    shadowOn(layerName, blur, color) {
        this.#shadowState[layerName] = { shadowBlur: blur, shadowColor: color };
    }

    /**
     * 특정 레이어의 그림자 효과를 끕니다.
     * @param {string} layerName - 레이어 이름
     */
    shadowOff(layerName) {
        this.#shadowState[layerName] = { shadowBlur: 0, shadowColor: 'rgba(0,0,0,0)' };
    }

    /**
     * 지정된 레이어에 도형, 이미지, 텍스트 등을 그립니다.
     * @param {string} layerName - 대상 레이어 이름
     * @param {object} options - 그리기 옵션 (shape, x, y, w, h 등)
     */
    render(layerName, options) {
        const ctx = this.#contexts[layerName];
        const cache = this.#stateCaches[layerName];

        this.#applyStyles(ctx, cache, options, layerName);

        switch (options.shape) {
            case 'rect':
                if (options.fill !== false) ctx.fillRect(options.x, options.y, options.w, options.h);
                else ctx.strokeRect(options.x, options.y, options.w, options.h);
                break;
            case 'roundRect':
                ctx.beginPath();
                ctx.roundRect(options.x, options.y, options.w, options.h, options.radius);
                if (options.fill !== false) ctx.fill();
                else ctx.stroke();
                break;
            case 'circle':
                ctx.beginPath();
                ctx.arc(options.x, options.y, options.radius, 0, 2 * Math.PI);
                if (options.fill !== false) ctx.fill();
                else ctx.stroke();
                break;
            case 'line':
                ctx.beginPath();
                if (options.lineCap) ctx.lineCap = options.lineCap;
                ctx.moveTo(options.x1, options.y1);
                ctx.lineTo(options.x2, options.y2);
                ctx.stroke();
                if (options.lineCap) ctx.lineCap = 'butt';
                break;
            case 'image':
                ctx.drawImage(options.image, options.x, options.y, options.w, options.h);
                break;
            case 'text':
                if (options.rotation) {
                    ctx.save();
                    ctx.translate(options.x, options.y);
                    ctx.rotate(options.rotation * Math.PI / 180);
                    ctx.fillText(options.text, 0, 0);
                    ctx.restore();
                } else {
                    ctx.fillText(options.text, options.x, options.y);
                }
                break;

            case 'arrow':
                const path = this.#pathCache['arrow'];
                if (!path) return;

                ctx.save();
                ctx.translate(options.x, options.y);
                if (options.rotation) {
                    ctx.rotate(options.rotation * Math.PI / 180);
                }
                ctx.scale(options.w, options.h);

                if (options.fill !== false) {
                    ctx.fill(path);
                } else {
                    ctx.stroke(path);
                }
                ctx.restore();
                break;

            case 'glassRect':
                this.#renderGlassRect(ctx, options);
                break;

            default:
                return;
        }
    }

    /**
     * @private
     * 그리기 스타일을 적용합니다.
     * @param {CanvasRenderingContext2D} ctx - 캔버스 컨텍스트
     * @param {object} cache - 스타일 캐시
     * @param {object} styles - 적용할 스타일
     * @param {string} layerName - 레이어 이름
     */
    #applyStyles(ctx, cache, styles, layerName) {
        const persistentShadow = this.#shadowState[layerName];

        let fill = styles.fill || null;

        // 선형 그라데이션 처리
        if (fill && typeof fill === 'object' && fill.type === 'linear') {
            const grad = ctx.createLinearGradient(fill.x1, fill.y1, fill.x2, fill.y2);
            if (fill.stops) {
                fill.stops.forEach(s => grad.addColorStop(s.offset, s.color));
            }
            fill = grad;
        }

        if (cache.fillStyle !== fill) { ctx.fillStyle = fill; cache.fillStyle = fill; }

        const stroke = styles.stroke || null;
        if (cache.strokeStyle !== stroke) { ctx.strokeStyle = stroke; cache.strokeStyle = stroke; }

        const alpha = styles.alpha === undefined ? 1 : styles.alpha;
        if (cache.globalAlpha !== alpha) { ctx.globalAlpha = alpha; cache.globalAlpha = alpha; }

        const lineWidth = styles.lineWidth || 1;
        if (cache.lineWidth !== lineWidth) { ctx.lineWidth = lineWidth; cache.lineWidth = lineWidth; }

        const shadowBlur = styles.shadowBlur !== undefined ? styles.shadowBlur : persistentShadow.shadowBlur;
        const shadowColor = styles.shadowColor !== undefined ? styles.shadowColor : persistentShadow.shadowColor;
        if (cache.shadowBlur !== shadowBlur) { ctx.shadowBlur = shadowBlur; cache.shadowBlur = shadowBlur; }
        if (cache.shadowColor !== shadowColor) { ctx.shadowColor = shadowColor; cache.shadowColor = shadowColor; }

        if (styles.shape === 'text') {
            const font = styles.font || '10px sans-serif';
            const align = styles.align || 'start';
            const baseline = styles.baseline || 'alphabetic';
            if (cache.font !== font) { ctx.font = font; cache.font = font; }
            if (cache.textAlign !== align) { ctx.textAlign = align; cache.textAlign = align; }
            if (cache.textBaseline !== baseline) { ctx.textBaseline = baseline; cache.textBaseline = baseline; }
        }
    }

    /**
     * @private
     * 유리패널(GlassRect) 효과를 렌더링합니다. 배경 블러 이미지를 샘플링하여 유리 소재 시각적 효과를 만듭니다.
     * @param {CanvasRenderingContext2D} ctx
     * @param {object} options
     */
    #renderGlassRect(ctx, options) {
        ctx.save();

        if (this.#isGlassShadowActive(ctx)) {
            this.#renderGlassShadowOnly(ctx, options);
        }

        // 이미지와 내부 채색 시 무거운 섀도우 연산이 일어나는 것을 방지 (프레임 드랍 원인)
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;

        ctx.beginPath();
        ctx.roundRect(options.x, options.y, options.w, options.h, options.radius);
        ctx.clip();

        this.#drawGlassBlurImage(ctx, options);

        if (options.fill !== false) {
            ctx.fill();
        }

        if (options.stroke) {
            ctx.strokeStyle = options.stroke;
            ctx.lineWidth = options.lineWidth || 1;
            ctx.stroke();
        }
        ctx.restore();
    }

    /**
     * @private
     * 현재 ctx에 그림자 속성이 활성 중인지 확인합니다.
     * @param {CanvasRenderingContext2D} ctx
     * @returns {boolean}
     */
    #isGlassShadowActive(ctx) {
        return ctx.shadowBlur > 0
            && ctx.shadowColor
            && ctx.shadowColor !== 'rgba(0,0,0,0)'
            && ctx.shadowColor !== 'undefined'
            && ctx.shadowColor !== 'transparent';
    }

    /**
     * @private
     * 그림자만 독립적으로 과도 화면 밖에 offset 트릭으로 그립니다. 유리 패널 본체가 그림자를 덮는 것을 방지합니다.
     * @param {CanvasRenderingContext2D} ctx
     * @param {object} options
     */
    #renderGlassShadowOnly(ctx, options) {
        // 그림자만 독립적으로 그리기 (offset 트릭 활용)
        // 유리 패널 본체는 화면 밖에 두고 그림자만 원위치에 표시 (투명 패널의 그림자 가림 방지)
        ctx.save();
        const offset = 10000;
        ctx.shadowOffsetX = offset;
        ctx.shadowOffsetY = 0;
        ctx.beginPath();
        ctx.roundRect(options.x - offset, options.y, options.w, options.h, options.radius);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.restore();
    }

    /**
     * @private
     * 블러된 배경 이미지를 요소 내에 디로스케일링하여 그립니다. CSS filter 블러를 사용합니다.
     * @param {CanvasRenderingContext2D} ctx
     * @param {object} options
     */
    #drawGlassBlurImage(ctx, options) {
        if (!options.image) return;

        const blurCanvas = getBlurCanvas();
        const blurCtx = getBlurCtx();
        const blurScale = getBlurScale();

        const bw = Math.floor(ctx.canvas.width * blurScale);
        const bh = Math.floor(ctx.canvas.height * blurScale);
        if (blurCanvas.width !== bw || blurCanvas.height !== bh) {
            blurCanvas.width = bw;
            blurCanvas.height = bh;
        }

        blurCtx.clearRect(0, 0, bw, bh);
        const images = Array.isArray(options.image) ? options.image : [options.image];
        for (const img of images) {
            if (img.width > 0 && img.height > 0) {
                blurCtx.drawImage(img, 0, 0, bw, bh);
            }
        }

        ctx.filter = `blur(${options.blur || 10}px)`;
        ctx.drawImage(blurCanvas, 0, 0, bw, bh, 0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.filter = 'none';
    }

    /**
     * @private
     * 도형 경로를 미리 생성하여 캐시합니다.
     */
    #generatePaths() {

        // 화살표 생성 (너비/높이 1 기준, x/y를 중심으로)
        const arrowPath = new Path2D();
        arrowPath.moveTo(0, -0.5);
        arrowPath.lineTo(0.5, 0.5);
        arrowPath.lineTo(0, 0.3);
        arrowPath.lineTo(-0.5, 0.5);
        arrowPath.closePath();
        this.#pathCache['arrow'] = arrowPath;
    }

    /**
     * 특정 레이어를 지웁니다.
     * @param {string} layerName - 레이어 이름
     */
    clear(layerName) {
        const ctx = this.#contexts[layerName];
        if (!ctx) return;
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }

    /**
     * 모든 레이어를 지웁니다.
     */
    clearAll() {
        for (const key in this.#contexts) {
            const ctx = this.#contexts[key];
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        }
    }
}
