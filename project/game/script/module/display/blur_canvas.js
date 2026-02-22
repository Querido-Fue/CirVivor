let blurCanvas = null;
let blurCtx = null;
let blurScale = 0.2;

export function initBlurCanvas(width, height) {
    if (!blurCanvas) {
        blurCanvas = document.createElement('canvas');
        blurCtx = blurCanvas.getContext('2d');
    }
    blurCanvas.width = Math.floor(width * blurScale);
    blurCanvas.height = Math.floor(height * blurScale);
}

export function getBlurCanvas() {
    return blurCanvas;
}

export function getBlurCtx() {
    return blurCtx;
}

export function getBlurScale() {
    return blurScale;
}
