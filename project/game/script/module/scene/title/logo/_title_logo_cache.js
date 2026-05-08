/**
 * 그림자 패스 정의를 현재 스케일 기준으로 반환합니다.
 * @param {number} scale - 현재 로고 렌더 스케일입니다.
 * @returns {Array<{alpha:number, blur:number, offsetX:number, offsetY:number, lineWidth:number}>} 그림자 패스 목록입니다.
 */
export function getTitleLogoShadowPasses(scale) {
    return [
        {
            alpha: 0.96,
            blur: Math.max(44, 132 * scale),
            offsetX: 0,
            offsetY: Math.max(8, 20 * scale),
            lineWidth: 2.35
        },
        {
            alpha: 1,
            blur: Math.max(20, 62 * scale),
            offsetX: 0,
            offsetY: Math.max(10, 28 * scale),
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
        const spread = Math.ceil(shadowPass.blur * 2.5) + 6;
        left = Math.max(left, spread - shadowPass.offsetX);
        top = Math.max(top, spread - shadowPass.offsetY);
        right = Math.max(right, spread + shadowPass.offsetX);
        bottom = Math.max(bottom, spread + shadowPass.offsetY);
    });

    return {
        left: Math.max(1, Math.ceil(left)),
        top: Math.max(1, Math.ceil(top)),
        right: Math.max(1, Math.ceil(right)),
        bottom: Math.max(1, Math.ceil(bottom))
    };
}

/**
 * 오프스크린 캔버스 크기를 필요한 경우에만 갱신합니다.
 * @param {HTMLCanvasElement} canvas - 대상 캔버스입니다.
 * @param {number} width - 목표 너비입니다.
 * @param {number} height - 목표 높이입니다.
 */
export function resizeTitleLogoCacheCanvas(canvas, width, height) {
    const nextWidth = Math.max(1, Math.ceil(width));
    const nextHeight = Math.max(1, Math.ceil(height));
    if (canvas.width === nextWidth && canvas.height === nextHeight) {
        return;
    }

    canvas.width = nextWidth;
    canvas.height = nextHeight;
}
