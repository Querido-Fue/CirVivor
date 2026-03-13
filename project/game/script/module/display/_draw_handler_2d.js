/**
 * @class DrawHandler2D
 * @description 2D 캔버스 레이어를 동적으로 등록하고 그리기 상태를 관리합니다.
 */
export class DrawHandler2D {
    #contexts;
    #stateCaches;
    #shadowState;
    #pathCache;
    #measureCtx;
    #layerOptions;

    /**
     * @param {Object.<string, CanvasRenderingContext2D>} contexts - 초기 레이어 컨텍스트 맵입니다.
     */
    constructor(contexts = {}) {
        this.#contexts = new Map();
        this.#stateCaches = new Map();
        this.#shadowState = new Map();
        this.#pathCache = new Map();
        this.#layerOptions = new Map();

        this.#generatePaths();

        const measureCanvas = document.createElement('canvas');
        this.#measureCtx = measureCanvas.getContext('2d');

        for (const [layerName, context] of Object.entries(contexts)) {
            this.registerLayer(layerName, context);
        }
    }

    /**
     * 레이어를 등록합니다.
     * @param {string} layerName - 레이어 식별자입니다.
     * @param {CanvasRenderingContext2D} context - 연결할 2D 컨텍스트입니다.
     * @param {{persistent?: boolean}} [options={}] - 레이어 동작 옵션입니다.
     */
    registerLayer(layerName, context, options = {}) {
        if (!layerName || !context) {
            return;
        }

        this.#contexts.set(layerName, context);
        this.#stateCaches.set(layerName, {});
        this.#shadowState.set(layerName, { shadowBlur: 0, shadowColor: 'rgba(0,0,0,0)' });
        this.#layerOptions.set(layerName, {
            persistent: options.persistent === true
        });
    }

    /**
     * 레이어를 해제합니다.
     * @param {string} layerName - 해제할 레이어 식별자입니다.
     */
    unregisterLayer(layerName) {
        this.#contexts.delete(layerName);
        this.#stateCaches.delete(layerName);
        this.#shadowState.delete(layerName);
        this.#layerOptions.delete(layerName);
    }

    /**
     * 텍스트 너비를 측정합니다.
     * @param {string} text - 측정할 문자열입니다.
     * @param {string} font - 사용할 폰트 문자열입니다.
     * @returns {number} 측정된 텍스트 너비입니다.
     */
    measureText(text, font) {
        this.#measureCtx.font = font;
        return this.#measureCtx.measureText(text).width;
    }

    /**
     * 특정 레이어의 지속 그림자 상태를 설정합니다.
     * @param {string} layerName - 레이어 식별자입니다.
     * @param {number} blur - 그림자 블러입니다.
     * @param {string} color - 그림자 색상입니다.
     */
    shadowOn(layerName, blur, color) {
        if (!this.#shadowState.has(layerName)) {
            return;
        }

        this.#shadowState.set(layerName, { shadowBlur: blur, shadowColor: color });
    }

    /**
     * 특정 레이어의 지속 그림자 상태를 초기화합니다.
     * @param {string} layerName - 레이어 식별자입니다.
     */
    shadowOff(layerName) {
        if (!this.#shadowState.has(layerName)) {
            return;
        }

        this.#shadowState.set(layerName, { shadowBlur: 0, shadowColor: 'rgba(0,0,0,0)' });
    }

    /**
     * 지정된 레이어에 2D 명령을 렌더링합니다.
     * @param {string} layerName - 대상 레이어 식별자입니다.
     * @param {object} options - 렌더링 옵션입니다.
     */
    render(layerName, options) {
        const context = this.#contexts.get(layerName);
        const cache = this.#stateCaches.get(layerName);
        if (!context || !cache || !options) {
            return;
        }

        this.#applyStyles(context, cache, options, layerName);

        switch (options.shape) {
            case 'rect':
                if (options.fill !== false) context.fillRect(options.x, options.y, options.w, options.h);
                else context.strokeRect(options.x, options.y, options.w, options.h);
                break;
            case 'roundRect':
                context.beginPath();
                context.roundRect(options.x, options.y, options.w, options.h, options.radius);
                if (options.fill !== false) context.fill();
                else context.stroke();
                break;
            case 'circle':
                context.beginPath();
                context.arc(options.x, options.y, options.radius, 0, Math.PI * 2);
                if (options.fill !== false) context.fill();
                else context.stroke();
                break;
            case 'line':
                context.beginPath();
                if (options.lineCap) {
                    context.lineCap = options.lineCap;
                }
                context.moveTo(options.x1, options.y1);
                context.lineTo(options.x2, options.y2);
                context.stroke();
                if (options.lineCap) {
                    context.lineCap = 'butt';
                }
                break;
            case 'image':
                context.drawImage(options.image, options.x, options.y, options.w, options.h);
                break;
            case 'text':
                if (options.rotation) {
                    context.save();
                    context.translate(options.x, options.y);
                    context.rotate((options.rotation * Math.PI) / 180);
                    context.fillText(options.text, 0, 0);
                    context.restore();
                } else {
                    context.fillText(options.text, options.x, options.y);
                }
                break;
            case 'arrow':
                this.#renderArrow(context, options);
                break;
            default:
                break;
        }
    }

    /**
     * 특정 레이어를 초기화합니다.
     * @param {string} layerName - 초기화할 레이어 식별자입니다.
     */
    clear(layerName) {
        const context = this.#contexts.get(layerName);
        if (!context) {
            return;
        }

        this.#resetLayerState(layerName, context);
        context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    }

    /**
     * 현재 등록된 모든 레이어를 초기화합니다.
     */
    clearAll() {
        for (const [layerName, context] of this.#contexts.entries()) {
            const layerOptions = this.#layerOptions.get(layerName);
            if (layerOptions?.persistent === true) {
                continue;
            }
            this.#resetLayerState(layerName, context);
            context.clearRect(0, 0, context.canvas.width, context.canvas.height);
        }
    }

    /**
     * @private
     * 레이어 컨텍스트와 스타일 캐시를 프레임 기본 상태로 되돌립니다.
     * `render()` 캐시를 우회하는 직접 캔버스 드로잉이 있어도 다음 프레임이
     * 항상 동일한 시작 상태에서 렌더링되도록 보장합니다.
     * @param {string} layerName - 초기화할 레이어 식별자입니다.
     * @param {CanvasRenderingContext2D} context - 초기화할 컨텍스트입니다.
     */
    #resetLayerState(layerName, context) {
        if (typeof context.resetTransform === 'function') {
            context.resetTransform();
        } else if (typeof context.setTransform === 'function') {
            context.setTransform(1, 0, 0, 1, 0, 0);
        }

        context.globalAlpha = 1;
        context.globalCompositeOperation = 'source-over';
        context.shadowBlur = 0;
        context.shadowColor = 'rgba(0,0,0,0)';
        context.lineWidth = 1;
        context.filter = 'none';
        context.textAlign = 'start';
        context.textBaseline = 'alphabetic';
        context.font = '10px sans-serif';

        this.#stateCaches.set(layerName, {});
    }

    /**
     * @private
     * 스타일 캐시를 적용합니다.
     * @param {CanvasRenderingContext2D} context - 대상 컨텍스트입니다.
     * @param {object} cache - 레이어별 스타일 캐시입니다.
     * @param {object} styles - 적용할 스타일입니다.
     * @param {string} layerName - 레이어 식별자입니다.
     */
    #applyStyles(context, cache, styles, layerName) {
        const persistentShadow = this.#shadowState.get(layerName) || { shadowBlur: 0, shadowColor: 'rgba(0,0,0,0)' };

        let fill = styles.fill || null;
        if (fill && typeof fill === 'object' && fill.type === 'linear') {
            const gradient = context.createLinearGradient(fill.x1, fill.y1, fill.x2, fill.y2);
            if (Array.isArray(fill.stops)) {
                fill.stops.forEach((stop) => gradient.addColorStop(stop.offset, stop.color));
            }
            fill = gradient;
        }

        if (cache.fillStyle !== fill) {
            context.fillStyle = fill;
            cache.fillStyle = fill;
        }

        const stroke = styles.stroke || null;
        if (cache.strokeStyle !== stroke) {
            context.strokeStyle = stroke;
            cache.strokeStyle = stroke;
        }

        const alpha = styles.alpha === undefined ? 1 : styles.alpha;
        if (cache.globalAlpha !== alpha) {
            context.globalAlpha = alpha;
            cache.globalAlpha = alpha;
        }

        const lineWidth = styles.lineWidth || 1;
        if (cache.lineWidth !== lineWidth) {
            context.lineWidth = lineWidth;
            cache.lineWidth = lineWidth;
        }

        const shadowBlur = styles.shadowBlur !== undefined ? styles.shadowBlur : persistentShadow.shadowBlur;
        const shadowColor = styles.shadowColor !== undefined ? styles.shadowColor : persistentShadow.shadowColor;
        if (cache.shadowBlur !== shadowBlur) {
            context.shadowBlur = shadowBlur;
            cache.shadowBlur = shadowBlur;
        }
        if (cache.shadowColor !== shadowColor) {
            context.shadowColor = shadowColor;
            cache.shadowColor = shadowColor;
        }

        if (styles.shape === 'text') {
            const font = styles.font || '10px sans-serif';
            const align = styles.align || 'start';
            const baseline = styles.baseline || 'alphabetic';

            if (cache.font !== font) {
                context.font = font;
                cache.font = font;
            }
            if (cache.textAlign !== align) {
                context.textAlign = align;
                cache.textAlign = align;
            }
            if (cache.textBaseline !== baseline) {
                context.textBaseline = baseline;
                cache.textBaseline = baseline;
            }
        }
    }

    /**
     * @private
     * 화살표 도형을 렌더링합니다.
     * @param {CanvasRenderingContext2D} context - 대상 컨텍스트입니다.
     * @param {object} options - 렌더링 옵션입니다.
     */
    #renderArrow(context, options) {
        const path = this.#pathCache.get('arrow');
        if (!path) {
            return;
        }

        context.save();
        context.translate(options.x, options.y);
        if (options.rotation) {
            context.rotate((options.rotation * Math.PI) / 180);
        }
        context.scale(options.w, options.h);

        if (options.fill !== false) {
            context.fill(path);
        } else {
            context.stroke(path);
        }
        context.restore();
    }

    /**
     * @private
     * 캐시 가능한 도형 경로를 생성합니다.
     */
    #generatePaths() {
        const arrowPath = new Path2D();
        arrowPath.moveTo(0, -0.5);
        arrowPath.lineTo(0.5, 0.5);
        arrowPath.lineTo(0, 0.3);
        arrowPath.lineTo(-0.5, 0.5);
        arrowPath.closePath();
        this.#pathCache.set('arrow', arrowPath);
    }
}
