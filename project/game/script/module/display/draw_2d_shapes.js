/**
 * 사각형을 채움과 내부 스트로크 기준으로 렌더링합니다.
 * @param {CanvasRenderingContext2D} context - 대상 컨텍스트입니다.
 * @param {object} options - 렌더링 옵션입니다.
 */
export function renderDrawRect(context, options) {
    if (options.fill !== false) {
        context.fillRect(options.x, options.y, options.w, options.h);
    }

    if (!shouldDrawStroke(options)) {
        return;
    }

    const lineWidth = getDrawLineWidth(options);
    if (lineWidth <= 0) {
        return;
    }

    const inset = lineWidth * 0.5;
    const width = Math.max(0, options.w - lineWidth);
    const height = Math.max(0, options.h - lineWidth);
    if (width <= 0 || height <= 0) {
        return;
    }

    context.strokeRect(options.x + inset, options.y + inset, width, height);
}

/**
 * 둥근 사각형을 채움과 내부 스트로크 기준으로 렌더링합니다.
 * @param {CanvasRenderingContext2D} context - 대상 컨텍스트입니다.
 * @param {object} options - 렌더링 옵션입니다.
 */
export function renderDrawRoundRect(context, options) {
    if (options.fill !== false) {
        context.beginPath();
        context.roundRect(
            options.x,
            options.y,
            options.w,
            options.h,
            normalizeDrawRadius(options.radius, options.w, options.h)
        );
        context.fill();
    }

    if (!shouldDrawStroke(options)) {
        return;
    }

    const lineWidth = getDrawLineWidth(options);
    if (lineWidth <= 0) {
        return;
    }

    const inset = lineWidth * 0.5;
    const width = Math.max(0, options.w - lineWidth);
    const height = Math.max(0, options.h - lineWidth);
    if (width <= 0 || height <= 0) {
        return;
    }

    context.beginPath();
    context.roundRect(
        options.x + inset,
        options.y + inset,
        width,
        height,
        normalizeDrawRadius((options.radius || 0) - inset, width, height)
    );
    context.stroke();
}

/**
 * 화살표 도형을 렌더링합니다.
 * @param {CanvasRenderingContext2D} context - 대상 컨텍스트입니다.
 * @param {object} options - 렌더링 옵션입니다.
 * @param {Path2D|null} path - 렌더링할 캐시 경로입니다.
 */
export function renderDrawArrow(context, options, path) {
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
 * 렌더 옵션이 스트로크를 요청하는지 반환합니다.
 * @param {object} options - 렌더링 옵션입니다.
 * @returns {boolean} 스트로크 렌더링 여부입니다.
 */
export function shouldDrawStroke(options) {
    if (options.stroke === false) {
        return false;
    }

    return options.fill === false || options.stroke !== undefined;
}

/**
 * 유효한 스트로크 두께를 반환합니다.
 * @param {object} options - 렌더링 옵션입니다.
 * @returns {number} 스트로크 두께입니다.
 */
export function getDrawLineWidth(options) {
    const lineWidth = Number(options.lineWidth);
    return Number.isFinite(lineWidth) ? Math.max(0, lineWidth) : 1;
}

/**
 * 둥근 사각형 반지름을 현재 사각형 크기에 맞게 보정합니다.
 * @param {number} radius - 요청된 반지름입니다.
 * @param {number} width - 사각형 너비입니다.
 * @param {number} height - 사각형 높이입니다.
 * @returns {number} 보정된 반지름입니다.
 */
export function normalizeDrawRadius(radius, width, height) {
    const resolvedRadius = Number(radius);
    if (!Number.isFinite(resolvedRadius)) {
        return 0;
    }

    return Math.max(0, Math.min(resolvedRadius, Math.max(0, Math.min(width, height) * 0.5)));
}

/**
 * 캐시 가능한 화살표 경로를 생성합니다.
 * @returns {Path2D} 화살표 경로입니다.
 */
export function createDrawArrowPath() {
    const arrowPath = new Path2D();
    arrowPath.moveTo(0, -0.5);
    arrowPath.lineTo(0.5, 0.5);
    arrowPath.lineTo(0, 0.3);
    arrowPath.lineTo(-0.5, 0.5);
    arrowPath.closePath();
    return arrowPath;
}
