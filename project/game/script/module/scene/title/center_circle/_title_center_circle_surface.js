import { getLoadingAccentColor } from '../loading/_title_loading_theme.js';
import { getLoadingGlowSettings, toLoadingRgba } from './_title_center_circle_theme.js';

/**
 * 중앙 원형 로딩 fill 상단의 밝은 수면선을 그립니다.
 * @param {CanvasRenderingContext2D} ctx - UI 레이어 컨텍스트입니다.
 * @param {{surfacePoints: Array<{x:number, y:number}>}} fillData - fill 표면 포인트입니다.
 * @param {number} drawRadius - 현재 렌더 반경입니다.
 * @param {number} progress - 현재 로딩 진행률입니다.
 */
export function drawCenterCircleSurfaceHighlight(ctx, fillData, drawRadius, progress) {
    if (progress >= 1) {
        return;
    }

    const points = fillData.surfacePoints;
    if (!Array.isArray(points) || points.length === 0) {
        return;
    }
    const surfaceSettings = getLoadingGlowSettings().surface;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.lineWidth = Math.max(1.5, drawRadius * 0.022);
    ctx.strokeStyle = toLoadingRgba(surfaceSettings?.Highlight || getLoadingAccentColor(), surfaceSettings?.HighlightAlpha || 0);
    ctx.shadowBlur = drawRadius * 0.06;
    ctx.shadowColor = toLoadingRgba(surfaceSettings?.Shadow || getLoadingAccentColor(), surfaceSettings?.ShadowAlpha || 0);
    ctx.stroke();
    ctx.restore();
}
