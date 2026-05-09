/**
 * 기본 지속 그림자 상태를 생성합니다.
 * @param {number} [shadowBlur=0] - 그림자 블러입니다.
 * @param {string} [shadowColor='rgba(0,0,0,0)'] - 그림자 색상입니다.
 * @returns {{shadowBlur:number, shadowColor:string}} 그림자 상태입니다.
 */
export function createDrawShadowState(shadowBlur = 0, shadowColor = 'rgba(0,0,0,0)') {
    return { shadowBlur, shadowColor };
}

/**
 * 레이어 transform 옵션을 유효한 배율로 정규화합니다.
 * @param {{transformScaleX?: number, transformScaleY?: number}} [options={}] - transform 옵션입니다.
 * @returns {{scaleX:number, scaleY:number}} 정규화된 transform입니다.
 */
export function normalizeDrawLayerTransform(options = {}) {
    const scaleX = Number.isFinite(options.transformScaleX) && options.transformScaleX > 0
        ? options.transformScaleX
        : 1;
    const scaleY = Number.isFinite(options.transformScaleY) && options.transformScaleY > 0
        ? options.transformScaleY
        : 1;

    return { scaleX, scaleY };
}

/**
 * 등록된 레이어 transform을 컨텍스트에 적용합니다.
 * @param {CanvasRenderingContext2D} context - 대상 컨텍스트입니다.
 * @param {{scaleX:number, scaleY:number}} transform - 적용할 transform입니다.
 */
export function applyDrawLayerTransform(context, transform) {
    if (!context || typeof context.setTransform !== 'function') {
        return;
    }

    const safeTransform = transform || { scaleX: 1, scaleY: 1 };
    context.setTransform(safeTransform.scaleX, 0, 0, safeTransform.scaleY, 0, 0);
}

/**
 * 레이어 컨텍스트를 프레임 기본 상태로 되돌립니다.
 * @param {CanvasRenderingContext2D} context - 초기화할 컨텍스트입니다.
 */
export function resetDrawContextState(context) {
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
    context.lineCap = 'butt';
    context.lineJoin = 'miter';
    context.filter = 'none';
    context.textAlign = 'start';
    context.textBaseline = 'alphabetic';
    context.font = '10px sans-serif';
}

/**
 * 스타일 캐시를 기준으로 필요한 2D 컨텍스트 스타일만 갱신합니다.
 * @param {CanvasRenderingContext2D} context - 대상 컨텍스트입니다.
 * @param {object} cache - 레이어별 스타일 캐시입니다.
 * @param {object} styles - 적용할 스타일입니다.
 * @param {{shadowBlur:number, shadowColor:string}} persistentShadow - 지속 그림자 상태입니다.
 */
export function applyDraw2DStyles(context, cache, styles, persistentShadow) {
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

    const lineCap = styles.lineCap || 'butt';
    if (cache.lineCap !== lineCap) {
        context.lineCap = lineCap;
        cache.lineCap = lineCap;
    }

    const lineJoin = styles.lineJoin || 'miter';
    if (cache.lineJoin !== lineJoin) {
        context.lineJoin = lineJoin;
        cache.lineJoin = lineJoin;
    }

    const shadowState = persistentShadow || createDrawShadowState();
    const shadowBlur = styles.shadowBlur !== undefined ? styles.shadowBlur : shadowState.shadowBlur;
    const shadowColor = styles.shadowColor !== undefined ? styles.shadowColor : shadowState.shadowColor;
    if (cache.shadowBlur !== shadowBlur) {
        context.shadowBlur = shadowBlur;
        cache.shadowBlur = shadowBlur;
    }
    if (cache.shadowColor !== shadowColor) {
        context.shadowColor = shadowColor;
        cache.shadowColor = shadowColor;
    }

    if (styles.shape === 'text') {
        applyDrawTextStyles(context, cache, styles);
    }
}

/**
 * 텍스트 렌더링 전용 스타일을 적용합니다.
 * @param {CanvasRenderingContext2D} context - 대상 컨텍스트입니다.
 * @param {object} cache - 레이어별 스타일 캐시입니다.
 * @param {object} styles - 적용할 스타일입니다.
 */
function applyDrawTextStyles(context, cache, styles) {
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
