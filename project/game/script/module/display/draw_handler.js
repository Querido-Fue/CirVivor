/**
 * @class DrawUtil
 * @description 캔버스 드로잉을 추상화하여 관리하는 유틸리티 클래스입니다.
 * 여러 캔버스 레이어(context)를 관리하고, 상태 캐싱 및 도형별 최적화된 그리기 기능을 제공합니다.
 */
export class DrawHandler {
    /**
     * @param {Object.<string, CanvasRenderingContext2D>} contexts - 레이어 이름을 키로 가지는 컨텍스트 객체
     */
    constructor(contexts) {
        this._contexts = contexts;
        this._stateCaches = {};
        this._shadowState = {};
        this._pathCache = {};

        for (const key in contexts) {
            this._stateCaches[key] = {};
            this._shadowState[key] = { shadowBlur: 0, shadowColor: 'rgba(0,0,0,0)' };
        }

        this._generatePaths();

        // 전용 측정용 캔버스/컨텍스트 생성 (메인 캔버스 오염 방지)
        const measureCanvas = document.createElement('canvas');
        this._measureCtx = measureCanvas.getContext('2d');
    }

    /**
     * 텍스트의 너비를 측정합니다.
     * @param {string} text - 측정할 텍스트
     * @param {string} font - 폰트 스타일 (예: 'bold 20px Arial')
     * @returns {number} 텍스트 너비
     */
    measureText(text, font) {
        this._measureCtx.font = font;
        return this._measureCtx.measureText(text).width;
    }

    /**
     * @param {string} layerName
     * @param {object} options
     */

    /**
     * 특정 레이어에 그림자 효과를 영구적으로 적용합니다.
     * @param {string} layerName - 레이어 이름
     * @param {number} blur - 그림자 블러 정도
     * @param {string} color - 그림자 색상
     */
    shadowOn(layerName, blur, color) {
        this._shadowState[layerName] = { shadowBlur: blur, shadowColor: color };
    }

    /**
     * 특정 레이어의 그림자 효과를 끕니다.
     * @param {string} layerName - 레이어 이름
     */
    shadowOff(layerName) {
        this._shadowState[layerName] = { shadowBlur: 0, shadowColor: 'rgba(0,0,0,0)' };
    }

    /**
     * 지정된 레이어에 도형, 이미지, 텍스트 등을 그립니다.
     * @param {string} layerName - 대상 레이어 이름
     * @param {object} options - 그리기 옵션 (shape, x, y, w, h 등)
     */
    render(layerName, options) {
        const ctx = this._contexts[layerName];
        const cache = this._stateCaches[layerName];

        this._applyStyles(ctx, cache, options, layerName);

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
                ctx.moveTo(options.x1, options.y1);
                ctx.lineTo(options.x2, options.y2);
                ctx.stroke();
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

            case 'triangle':
            case 'pentagon':
            case 'hexagon':
            case 'octagon':
            case 'arrow':
                const path = this._pathCache[options.shape];
                if (!path) return;

                ctx.save();
                ctx.translate(options.x, options.y);
                if (options.rotation) {
                    ctx.rotate(options.rotation * Math.PI / 180);
                }

                if (options.shape === 'arrow') {
                    ctx.scale(options.w, options.h);
                } else {
                    ctx.scale(options.radius, options.radius);
                }

                if (options.fill !== false) {
                    ctx.fill(path);
                } else {
                    ctx.stroke(path);
                }
                ctx.restore();
                break;

            case 'glassRect':
                ctx.save();
                ctx.beginPath();
                ctx.roundRect(options.x, options.y, options.w, options.h, options.radius);
                ctx.clip();

                if (options.image) {
                    ctx.filter = `blur(${options.blur || 10}px)`;
                    const images = Array.isArray(options.image) ? options.image : [options.image];
                    images.forEach(img => {
                        ctx.drawImage(img, 0, 0, ctx.canvas.width, ctx.canvas.height);
                    });
                    ctx.filter = 'none';
                }

                if (options.fill !== false) {
                    // _applyStyles에서 설정된 fillStyle을 사용하거나 옵션 오버라이드
                    // 하지만, 보통 반투명 레이어를 덮기 위해 다시 fill() 호출
                    ctx.fill();
                }

                if (options.stroke) {
                    // 스트로크는 클립 영역 위에 그림
                    ctx.strokeStyle = options.stroke;
                    ctx.lineWidth = options.lineWidth || 1;
                    ctx.stroke();
                }
                ctx.restore();
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
    _applyStyles(ctx, cache, styles, layerName) {
        const persistentShadow = this._shadowState[layerName];

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
     * 도형 경로를 미리 생성하여 캐시합니다.
     */
    _generatePaths() {
        const shapes = {
            'triangle': 3,
            'pentagon': 5,
            'hexagon': 6,
            'octagon': 8
        };

        // 정다각형 생성 (반지름 1)
        for (const name in shapes) {
            const sides = shapes[name];
            const path = new Path2D();
            const angleOffset = -Math.PI / 2;
            const angleStep = (2 * Math.PI) / sides;
            for (let i = 0; i < sides; i++) {
                const angle = angleOffset + i * angleStep;
                const x = Math.cos(angle);
                const y = Math.sin(angle);
                if (i === 0) {
                    path.moveTo(x, y);
                } else {
                    path.lineTo(x, y);
                }
            }
            path.closePath();
            this._pathCache[name] = path;
        }

        // 화살표 생성 (너비/높이 1)
        const arrowPath = new Path2D();
        arrowPath.moveTo(0, -0.5); // 끝점
        arrowPath.lineTo(0.5, 0.5);  // 우하단
        arrowPath.lineTo(0, 0.3);    // 안쪽 점
        arrowPath.lineTo(-0.5, 0.5); // 좌하단
        arrowPath.closePath();
        this._pathCache['arrow'] = arrowPath;
    }

    /**
     * 특정 레이어를 지웁니다.
     * @param {string} layerName - 레이어 이름
     */
    clear(layerName) {
        const ctx = this._contexts[layerName];
        if (!ctx) return;
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }

    /**
     * 모든 레이어를 지웁니다.
     */
    clearAll() {
        for (const key in this._contexts) {
            const ctx = this._contexts[key];
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        }
    }
}