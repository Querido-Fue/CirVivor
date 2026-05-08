import { lerpNumber } from 'overlay/_panel_effect_math.js';
import { clampNumber } from './_title_menu_motion.js';
import {
    getMenuForegroundColor,
    resolveMenuColorRgb,
    toMenuRgba
} from './_title_menu_theme.js';

/**
 * 카드 spotlight를 그립니다.
 * @param {CanvasRenderingContext2D} context - 대상 컨텍스트입니다.
 * @param {object} runtimeState - 카드 런타임 상태입니다.
 * @param {object} spotlightOptions - spotlight 옵션입니다.
 * @param {{r:number, g:number, b:number}} effectColor - 효과 RGB 색상입니다.
 */
export function drawTitleMenuCardSpotlight(context, runtimeState, spotlightOptions, effectColor) {
    const gradient = context.createRadialGradient(
        runtimeState.localX,
        runtimeState.localY,
        0,
        runtimeState.localX,
        runtimeState.localY,
        spotlightOptions.radius
    );
    gradient.addColorStop(0, `rgba(${effectColor.r}, ${effectColor.g}, ${effectColor.b}, ${0.16 * runtimeState.spotlightAlpha})`);
    gradient.addColorStop(0.2, `rgba(${effectColor.r}, ${effectColor.g}, ${effectColor.b}, ${0.07 * runtimeState.spotlightAlpha})`);
    gradient.addColorStop(0.5, `rgba(${effectColor.r}, ${effectColor.g}, ${effectColor.b}, ${0.015 * runtimeState.spotlightAlpha})`);
    gradient.addColorStop(0.72, toMenuRgba(getMenuForegroundColor(), 0));
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(runtimeState.localX, runtimeState.localY, spotlightOptions.radius, 0, Math.PI * 2);
    context.fill();
}

/**
 * 카드 border 반응형 이펙트를 그립니다.
 * @param {CanvasRenderingContext2D} context - 대상 컨텍스트입니다.
 * @param {object} runtimeState - 카드 런타임 상태입니다.
 * @param {object} renderState - 카드 렌더 상태입니다.
 * @param {object} borderOptions - hoverBorder 옵션입니다.
 * @param {{r:number, g:number, b:number}} effectColor - 효과 RGB 색상입니다.
 */
export function drawTitleMenuCardBorder(context, runtimeState, renderState, borderOptions, effectColor) {
    const baseWidth = Math.max(0.5, borderOptions.width || 1);
    const hoverWidth = Math.max(baseWidth, borderOptions.hoverWidth || baseWidth);
    const borderWidth = Math.max(0.5, lerpNumber(baseWidth, hoverWidth, runtimeState.borderAlpha));
    if (borderWidth <= 0.01) {
        return;
    }

    const panelRect = renderState.panelRect;
    const resolvedColor = resolveMenuColorRgb(borderOptions.color, effectColor);
    const edgeAlpha = clampNumber(runtimeState.borderAlpha, 0, 1);
    const fadeStart = clampNumber(
        (borderOptions.radius - borderOptions.falloff) / Math.max(1, borderOptions.radius),
        0,
        1
    );
    const spotlightRadius = Math.max(1, borderOptions.radius);

    context.save();
    const gradient = context.createRadialGradient(
        runtimeState.localX,
        runtimeState.localY,
        0,
        runtimeState.localX,
        runtimeState.localY,
        spotlightRadius
    );
    gradient.addColorStop(0, `rgba(${resolvedColor.r}, ${resolvedColor.g}, ${resolvedColor.b}, ${edgeAlpha})`);
    gradient.addColorStop(Math.max(0, Math.min(1, fadeStart * 0.62)), `rgba(${resolvedColor.r}, ${resolvedColor.g}, ${resolvedColor.b}, ${edgeAlpha * 0.82})`);
    gradient.addColorStop(Math.max(0, Math.min(1, fadeStart)), `rgba(${resolvedColor.r}, ${resolvedColor.g}, ${resolvedColor.b}, ${edgeAlpha * 0.55})`);
    gradient.addColorStop(1, `rgba(${resolvedColor.r}, ${resolvedColor.g}, ${resolvedColor.b}, 0)`);

    context.beginPath();
    context.roundRect(0, 0, panelRect.w, panelRect.h, panelRect.radius);
    context.lineWidth = borderWidth;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.strokeStyle = gradient;
    context.stroke();
    context.restore();
}

/**
 * 카드 particle을 그립니다.
 * @param {CanvasRenderingContext2D} context - 대상 컨텍스트입니다.
 * @param {object} renderState - 카드 렌더 상태입니다.
 * @param {object} runtimeState - 카드 런타임 상태입니다.
 * @param {{r:number, g:number, b:number}} effectColor - 효과 RGB 색상입니다.
 */
export function drawTitleMenuCardParticles(context, renderState, runtimeState, effectColor) {
    const centerX = renderState.panelRect.w * 0.5;
    const centerY = renderState.panelRect.h * 0.5;
    const panelMinSize = Math.min(renderState.panelRect.w, renderState.panelRect.h);
    const outerRadius = clampNumber(panelMinSize * 0.022, 2, 3.2);
    const innerRadius = outerRadius * 0.5;

    for (const particle of runtimeState.particles) {
        if (!particle.visible || particle.opacity <= 0.01 || particle.scale <= 0.01) {
            continue;
        }

        context.save();
        context.translate(centerX + particle.currentX, centerY + particle.currentY);
        context.scale(particle.scale, particle.scale);
        context.beginPath();
        context.arc(0, 0, innerRadius, 0, Math.PI * 2);
        context.fillStyle = `rgba(${effectColor.r}, ${effectColor.g}, ${effectColor.b}, ${particle.opacity})`;
        context.fill();
        context.beginPath();
        context.arc(0, 0, outerRadius, 0, Math.PI * 2);
        context.fillStyle = `rgba(${effectColor.r}, ${effectColor.g}, ${effectColor.b}, ${particle.opacity * 0.18})`;
        context.fill();
        context.restore();
    }
}

/**
 * 카드 ripple을 그립니다.
 * @param {CanvasRenderingContext2D} context - 대상 컨텍스트입니다.
 * @param {object} runtimeState - 카드 런타임 상태입니다.
 * @param {{r:number, g:number, b:number}} effectColor - 효과 RGB 색상입니다.
 */
export function drawTitleMenuCardRipples(context, runtimeState, effectColor) {
    for (const ripple of runtimeState.ripples) {
        const progress = clampNumber(ripple.elapsed / ripple.duration, 0, 1);
        const opacity = 1 - progress;
        const radius = ripple.maxDistance * progress;
        if (radius <= 0) {
            continue;
        }

        const gradient = context.createRadialGradient(ripple.x, ripple.y, 0, ripple.x, ripple.y, radius);
        gradient.addColorStop(0, `rgba(${effectColor.r}, ${effectColor.g}, ${effectColor.b}, ${0.38 * opacity})`);
        gradient.addColorStop(0.35, `rgba(${effectColor.r}, ${effectColor.g}, ${effectColor.b}, ${0.18 * opacity})`);
        gradient.addColorStop(0.72, toMenuRgba(getMenuForegroundColor(), 0));
        context.fillStyle = gradient;
        context.beginPath();
        context.arc(ripple.x, ripple.y, radius, 0, Math.PI * 2);
        context.fill();
    }
}
