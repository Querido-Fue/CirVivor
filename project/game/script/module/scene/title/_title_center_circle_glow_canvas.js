const TWO_PI = Math.PI * 2;

/**
 * glow 밴딩 완화를 위한 디더링 노이즈 캔버스를 생성합니다.
 * @returns {HTMLCanvasElement|null} 생성된 노이즈 캔버스입니다.
 */
export function createCenterCircleGlowNoiseCanvas() {
    const noiseCanvas = document.createElement('canvas');
    const noiseSize = 96;
    noiseCanvas.width = noiseSize;
    noiseCanvas.height = noiseSize;

    const noiseCtx = noiseCanvas.getContext('2d');
    if (!noiseCtx) {
        return null;
    }

    const imageData = noiseCtx.createImageData(noiseSize, noiseSize);
    const pixels = imageData.data;

    for (let i = 0; i < pixels.length; i += 4) {
        const intensity = 200 + Math.floor(Math.random() * 56);
        const alpha = Math.floor(Math.random() * 38);
        pixels[i] = intensity - 18;
        pixels[i + 1] = intensity;
        pixels[i + 2] = 255;
        pixels[i + 3] = alpha;
    }

    noiseCtx.putImageData(imageData, 0, 0);
    return noiseCanvas;
}

/**
 * glow 캐시 캔버스 크기를 필요한 경우에만 갱신합니다.
 * @param {HTMLCanvasElement} canvas - 대상 캐시 캔버스입니다.
 * @param {number} width - 목표 너비입니다.
 * @param {number} height - 목표 높이입니다.
 */
export function resizeCenterCircleGlowCanvas(canvas, width, height) {
    const nextWidth = Math.max(1, Math.ceil(width));
    const nextHeight = Math.max(1, Math.ceil(height));
    if (!canvas) {
        return;
    }
    if (canvas.width === nextWidth && canvas.height === nextHeight) {
        return;
    }

    canvas.width = nextWidth;
    canvas.height = nextHeight;
}

/**
 * bloom의 바깥 halo 링을 그립니다.
 * @param {CanvasRenderingContext2D} ctx - UI 레이어 컨텍스트입니다.
 * @param {number} centerX - 캐시 내부 중심 X 좌표입니다.
 * @param {number} centerY - 캐시 내부 중심 Y 좌표입니다.
 * @param {number} innerRadius - halo 시작 반경입니다.
 * @param {number} outerRadius - halo 종료 반경입니다.
 * @param {CanvasGradient|CanvasPattern|string} fillStyle - 적용할 채우기 스타일입니다.
 */
export function drawCenterCircleHaloRing(ctx, centerX, centerY, innerRadius, outerRadius, fillStyle) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, outerRadius, 0, TWO_PI);
    ctx.arc(centerX, centerY, innerRadius, 0, TWO_PI, true);
    ctx.fillStyle = fillStyle;
    ctx.fill();
    ctx.restore();
}

/**
 * glow 밴딩을 줄이기 위해 halo 영역에 약한 노이즈를 덮습니다.
 * @param {CanvasRenderingContext2D} ctx - UI 레이어 컨텍스트입니다.
 * @param {HTMLCanvasElement|null} glowNoiseCanvas - 디더링 노이즈 캔버스입니다.
 * @param {number} centerX - 캐시 내부 중심 X 좌표입니다.
 * @param {number} centerY - 캐시 내부 중심 Y 좌표입니다.
 * @param {number} innerRadius - halo 시작 반경입니다.
 * @param {number} outerRadius - halo 종료 반경입니다.
 * @param {number} alpha - 디더링 알파 값입니다.
 */
export function drawCenterCircleDitheredHaloNoise(
    ctx,
    glowNoiseCanvas,
    centerX,
    centerY,
    innerRadius,
    outerRadius,
    alpha
) {
    if (!glowNoiseCanvas || alpha <= 0) {
        return;
    }

    const pattern = ctx.createPattern(glowNoiseCanvas, 'repeat');
    if (!pattern) {
        return;
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'soft-light';
    drawCenterCircleHaloRing(ctx, centerX, centerY, innerRadius, outerRadius, pattern);
    ctx.restore();
}

/**
 * bloom의 링 형태 glow 패스를 그립니다.
 * @param {CanvasRenderingContext2D} ctx - UI 레이어 컨텍스트입니다.
 * @param {number} centerX - 캐시 내부 중심 X 좌표입니다.
 * @param {number} centerY - 캐시 내부 중심 Y 좌표입니다.
 * @param {number} radius - 링 반경입니다.
 * @param {number} lineWidth - 링 두께입니다.
 * @param {string} strokeStyle - 링 색상입니다.
 * @param {number} shadowBlur - 그림자 블러 반경입니다.
 * @param {string} shadowColor - 그림자 색상입니다.
 */
export function drawCenterCircleGlowRing(ctx, centerX, centerY, radius, lineWidth, strokeStyle, shadowBlur, shadowColor) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, TWO_PI);
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = strokeStyle;
    ctx.shadowBlur = shadowBlur;
    ctx.shadowColor = shadowColor;
    ctx.stroke();
    ctx.restore();
}
