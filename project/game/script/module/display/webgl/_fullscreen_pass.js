/** Creates the quad owned and eventually released by one fullscreen pass. */
export function createFullscreenBuffer(gl) {
    const buffer = gl.createBuffer();
    if (!buffer) return null;
    try {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1, 1, -1, -1, 1, 1, 1
        ]), gl.STATIC_DRAW);
        return buffer;
    } catch (error) {
        gl.deleteBuffer(buffer);
        throw error;
    }
}

/** Clips a top-origin pixel-space effect extent to its render target. */
export function buildEffectScissorRect(x1, y1, x2, y2, padding, width, height) {
    const safePadding = Number.isFinite(padding) ? Math.max(0, padding) : 0;
    const left = Math.max(0, Math.floor(Math.min(x1, x2) - safePadding));
    const top = Math.max(0, Math.floor(Math.min(y1, y2) - safePadding));
    const right = Math.min(width, Math.ceil(Math.max(x1, x2) + safePadding));
    const bottom = Math.min(height, Math.ceil(Math.max(y1, y2) + safePadding));
    const w = right - left;
    const h = bottom - top;
    return w > 0 && h > 0 ? { x: left, y: top, w, h } : null;
}

export function buildCircleScissorRect(x, y, radius, width, height) {
    if (!Number.isFinite(radius) || radius <= 0) return null;
    return buildEffectScissorRect(x, y, x, y, radius, width, height);
}

/** Converts the top-origin extent at the WebGL viewport boundary. */
export function applyScissorRect(gl, rect, renderHeight) {
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(
        rect.x,
        Math.max(0, renderHeight - rect.y - rect.h),
        rect.w,
        rect.h
    );
}
