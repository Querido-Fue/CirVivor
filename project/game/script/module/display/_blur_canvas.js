let blurCanvas = null;
let blurCtx = null;
let blurScale = 0.2;

/**
 * 블러 전용 오프스크린 캔버스를 초기화/리사이즈합니다.
 * @param {number} width - 기준 너비
 * @param {number} height - 기준 높이
 */
export function initBlurCanvas(width, height) {
    if (!blurCanvas) {
        blurCanvas = document.createElement('canvas');
        blurCtx = blurCanvas.getContext('2d');
    }
    blurCanvas.width = Math.floor(width * blurScale);
    blurCanvas.height = Math.floor(height * blurScale);
}

/**
 * 블러 캔버스를 반환합니다.
 * @returns {HTMLCanvasElement|null} 블러 캔버스
 */
export function getBlurCanvas() {
    return blurCanvas;
}

/**
 * 블러 캔버스 컨텍스트를 반환합니다.
 * @returns {CanvasRenderingContext2D|null} 블러 컨텍스트
 */
export function getBlurCtx() {
    return blurCtx;
}

/**
 * 블러 스케일 배율을 반환합니다.
 * @returns {number} 블러 스케일
 */
export function getBlurScale() {
    return blurScale;
}
