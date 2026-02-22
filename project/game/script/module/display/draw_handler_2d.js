import { getBlurCanvas, getBlurCtx, getBlurScale } from "./blur_canvas.js";

/**
 * @class DrawUtil
 * @description 캔버스 드로잉을 추상화하여 관리하는 유틸리티 클래스입니다.
 * 여러 캔버스 레이어(context)를 관리하고, 상태 캐싱 및 도형별 최적화된 그리기 기능을 제공합니다.
 */
export class DrawHandler2D {
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
            case 'cross':
            case 'check':
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

                const isShadowActive = ctx.shadowBlur > 0 && ctx.shadowColor && ctx.shadowColor !== 'rgba(0,0,0,0)' && ctx.shadowColor !== 'undefined' && ctx.shadowColor !== 'transparent';
                if (isShadowActive) {
                    // 그림자만 독립적으로 그리기 (offset 트릭 활용)
                    // 투명 패널(glass) 뒤에 solid fill 그림자가 보이지 않도록 패널 자체는 시야 밖에 그리고, 그림자만 제 위치에 떨어지게 함
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

                // 이미지와 내부 채색 시 무거운 섀도우 연산이 일어나는 것을 방지 (프레임 드랍 원인)
                ctx.shadowColor = 'transparent';
                ctx.shadowBlur = 0;

                // 1. 클리핑 영역 설정 (라운드 박스)
                ctx.beginPath();
                ctx.roundRect(options.x, options.y, options.w, options.h, options.radius);
                ctx.clip();

                if (options.image) {
                    const blurCanvas = getBlurCanvas();
                    const blurCtx = getBlurCtx();
                    const blurScale = getBlurScale();

                    // 2. 블러 캔버스 크기 조정 (필요 시)
                    const bw = Math.floor(ctx.canvas.width * blurScale);
                    const bh = Math.floor(ctx.canvas.height * blurScale);
                    if (blurCanvas.width !== bw || blurCanvas.height !== bh) {
                        blurCanvas.width = bw;
                        blurCanvas.height = bh;
                    }

                    // 3. 소스 이미지를 블러 캔버스에 축소하여 그리기 (이미지 합성)
                    blurCtx.clearRect(0, 0, bw, bh);
                    // 여러 이미지가 배열로 들어올 수 있음
                    const images = Array.isArray(options.image) ? options.image : [options.image];
                    // console.log(`glassRect layer=${layerName} images=${images.length}`);
                    images.forEach(img => {
                        // 소스 이미지가 유효한지 확인
                        if (img.width > 0 && img.height > 0) {
                            blurCtx.drawImage(img, 0, 0, bw, bh);
                        }
                    });

                    // 4. 블러 캔버스를 본 캔버스에 확대하여 그리기 + 블러 필터 적용
                    ctx.filter = `blur(${options.blur || 10}px)`;
                    ctx.drawImage(blurCanvas, 0, 0, bw, bh, 0, 0, ctx.canvas.width, ctx.canvas.height);
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

        // X (Cross) 생성
        const crossPath = new Path2D();
        const cw = 0.15; // 십자가 두께의 절반
        crossPath.moveTo(-0.5, -0.5 + cw * 2);
        crossPath.lineTo(-0.5 + cw * 2, -0.5);
        crossPath.lineTo(0, -cw * 2); // 중심 위쪽
        crossPath.lineTo(0.5 - cw * 2, -0.5);
        crossPath.lineTo(0.5, -0.5 + cw * 2);
        crossPath.lineTo(cw * 2, 0); // 중심 오른쪽
        crossPath.lineTo(0.5, 0.5 - cw * 2);
        crossPath.lineTo(0.5 - cw * 2, 0.5);
        crossPath.lineTo(0, cw * 2);
        crossPath.lineTo(-0.5 + cw * 2, 0.5);
        crossPath.lineTo(-0.5, 0.5 - cw * 2);
        crossPath.lineTo(-cw * 2, 0);
        crossPath.closePath();

        // 십자가 (단순 선 2개로 구현하는 것이 나을 수도 있으나 fill을 위해 폴리곤으로)
        // 더 단순한 형태 (두께 0.2)
        const crossThick = 0.2;
        const cp = new Path2D();
        cp.moveTo(-0.5, -0.5 + crossThick);
        cp.lineTo(-0.5 + crossThick, -0.5);
        cp.lineTo(0, -crossThick * 0.5); // 중심 오차 보정? 아니 그냥 0,0 지나는 것
        // 정확한 X자는 회전된 직사각형 2개의 합집합.
        // 그냥 moveTo/lineTo로 그림.

        const cPath = new Path2D();
        // 45도 회전된 십자가를 0도로 생각하고 그리면 + 모양. 그걸 45도 돌리면 X.
        // 여기선 그냥 X 모양 좌표를 찍음.
        const t = 0.15; // thickness
        cPath.moveTo(-0.5 + t, -0.5);
        cPath.lineTo(0, -t);
        cPath.lineTo(0.5 - t, -0.5);
        cPath.lineTo(0.5, -0.5 + t);
        cPath.lineTo(t, 0);
        cPath.lineTo(0.5, 0.5 - t);
        cPath.lineTo(0.5 - t, 0.5);
        cPath.lineTo(0, t);
        cPath.lineTo(-0.5 + t, 0.5);
        cPath.lineTo(-0.5, 0.5 - t);
        cPath.lineTo(-t, 0);
        cPath.lineTo(-0.5, -0.5 + t);
        cPath.closePath();
        this._pathCache['cross'] = cPath;

        // 체크 (Check) 생성
        const checkPath = new Path2D();
        // V 모양
        checkPath.moveTo(-0.4, 0);
        checkPath.lineTo(-0.1, 0.4);
        checkPath.lineTo(0.4, -0.4);
        checkPath.lineTo(0.3, -0.5); // 두께
        checkPath.lineTo(-0.1, 0.2);
        checkPath.lineTo(-0.3, -0.1);
        checkPath.closePath();
        this._pathCache['check'] = checkPath;
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
