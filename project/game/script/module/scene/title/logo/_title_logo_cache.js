import { clampFiniteNumber, resolveFiniteNumber } from 'util/number_util.js';

/**
 * 그림자 패스 정의를 현재 스케일 기준으로 반환합니다.
 * @param {number} scale - 현재 로고 렌더 스케일입니다.
 * @returns {Array<{alpha:number, blur:number, offsetX:number, offsetY:number, lineWidth:number}>} 그림자 패스 목록입니다.
 */
export function getTitleLogoShadowPasses(scale) {
    const resolvedScale = clampFiniteNumber(Number(scale), 0, Infinity, 1);
    return [
        {
            alpha: 0.96,
            blur: clampFiniteNumber(132 * resolvedScale, 44, Infinity, 44),
            offsetX: 0,
            offsetY: clampFiniteNumber(20 * resolvedScale, 8, Infinity, 8),
            lineWidth: 2.35
        },
        {
            alpha: 1,
            blur: clampFiniteNumber(62 * resolvedScale, 20, Infinity, 20),
            offsetX: 0,
            offsetY: clampFiniteNumber(28 * resolvedScale, 10, Infinity, 10),
            lineWidth: 2.05
        }
    ];
}

/**
 * 그림자 블러를 포함할 오프스크린 패딩을 계산합니다.
 * @param {Array<{blur:number, offsetX:number, offsetY:number}>} shadowPasses - 그림자 패스 목록입니다.
 * @returns {{left:number, top:number, right:number, bottom:number}} 각 방향 패딩입니다.
 */
export function calculateTitleLogoCachePadding(shadowPasses) {
    let left = 0;
    let top = 0;
    let right = 0;
    let bottom = 0;

    shadowPasses.forEach((shadowPass) => {
        const blur = clampFiniteNumber(Number(shadowPass.blur), 0, Infinity, 0);
        const offsetX = resolveFiniteNumber(Number(shadowPass.offsetX), 0);
        const offsetY = resolveFiniteNumber(Number(shadowPass.offsetY), 0);
        const spread = Math.ceil(blur * 2.5) + 6;
        left = Math.max(left, spread - offsetX);
        top = Math.max(top, spread - offsetY);
        right = Math.max(right, spread + offsetX);
        bottom = Math.max(bottom, spread + offsetY);
    });

    return {
        left: Math.ceil(clampFiniteNumber(left, 1, Infinity, 1)),
        top: Math.ceil(clampFiniteNumber(top, 1, Infinity, 1)),
        right: Math.ceil(clampFiniteNumber(right, 1, Infinity, 1)),
        bottom: Math.ceil(clampFiniteNumber(bottom, 1, Infinity, 1))
    };
}

/**
 * 오프스크린 캔버스 크기를 필요한 경우에만 갱신합니다.
 * @param {HTMLCanvasElement} canvas - 대상 캔버스입니다.
 * @param {number} width - 목표 너비입니다.
 * @param {number} height - 목표 높이입니다.
 */
export function resizeTitleLogoCacheCanvas(canvas, width, height) {
    const nextWidth = Math.ceil(clampFiniteNumber(Number(width), 1, Infinity, 1));
    const nextHeight = Math.ceil(clampFiniteNumber(Number(height), 1, Infinity, 1));
    if (canvas.width === nextWidth && canvas.height === nextHeight) {
        return;
    }

    canvas.width = nextWidth;
    canvas.height = nextHeight;
}
