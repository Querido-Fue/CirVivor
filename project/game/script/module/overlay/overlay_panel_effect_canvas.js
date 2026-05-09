import { ColorSchemes } from 'display/_theme_handler.js';
import { colorUtil, formatRgba } from 'util/color_util.js';
import { clampFiniteNumber } from 'util/number_util.js';
import { lerpNumber } from './_panel_effect_math.js';

/**
 * 현재 테마에서 panel effect에 사용할 RGB 색상을 반환합니다.
 * @returns {{r:number, g:number, b:number}} 사용할 RGB 값입니다.
 */
function getOverlayPanelEffectColor() {
    const rgb = colorUtil().cssToRgb(ColorSchemes.Cursor.Active || '#166ffb');
    return {
        r: rgb.r,
        g: rgb.g,
        b: rgb.b
    };
}

/**
 * panel spotlight를 그립니다.
 * @param {CanvasRenderingContext2D} context - 대상 컨텍스트입니다.
 * @param {object} interactionState - 패널 interaction 상태입니다.
 * @param {object} spotlightOptions - spotlight 옵션입니다.
 * @param {{r:number, g:number, b:number}} effectColor - 사용할 효과 색상입니다.
 */
function drawOverlayPanelSpotlight(context, interactionState, spotlightOptions, effectColor) {
    const gradient = context.createRadialGradient(
        interactionState.localX,
        interactionState.localY,
        0,
        interactionState.localX,
        interactionState.localY,
        spotlightOptions.radius
    );
    gradient.addColorStop(0, formatRgba(effectColor.r, effectColor.g, effectColor.b, 0.15 * interactionState.spotlightAlpha));
    gradient.addColorStop(0.15, formatRgba(effectColor.r, effectColor.g, effectColor.b, 0.08 * interactionState.spotlightAlpha));
    gradient.addColorStop(0.25, formatRgba(effectColor.r, effectColor.g, effectColor.b, 0.04 * interactionState.spotlightAlpha));
    gradient.addColorStop(0.4, formatRgba(effectColor.r, effectColor.g, effectColor.b, 0.02 * interactionState.spotlightAlpha));
    gradient.addColorStop(0.65, formatRgba(effectColor.r, effectColor.g, effectColor.b, 0.01 * interactionState.spotlightAlpha));
    gradient.addColorStop(0.7, 'rgba(0, 0, 0, 0)');
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(interactionState.localX, interactionState.localY, spotlightOptions.radius, 0, Math.PI * 2);
    context.fill();
}

/**
 * panel border 반응형 오버레이를 그립니다.
 * @param {CanvasRenderingContext2D} context - 대상 컨텍스트입니다.
 * @param {object} panel - 패널 정보입니다.
 * @param {object} interactionState - 패널 interaction 상태입니다.
 * @param {object} borderOptions - hoverBorder 옵션입니다.
 * @param {{r:number, g:number, b:number}} effectColor - 기본 보조 색상입니다.
 */
function drawOverlayPanelBorder(context, panel, interactionState, borderOptions, effectColor) {
    const baseWidth = Math.max(0.5, borderOptions.width || 1);
    const hoverWidth = Math.max(baseWidth, borderOptions.hoverWidth || baseWidth);
    const borderWidth = Math.max(0.5, lerpNumber(baseWidth, hoverWidth, interactionState.borderAlpha));
    if (borderWidth <= 0.01) {
        return;
    }

    const optionColor = colorUtil().cssToRgb(borderOptions.color);
    const resolvedColor = Number.isFinite(optionColor?.r) && Number.isFinite(optionColor?.g) && Number.isFinite(optionColor?.b)
        ? optionColor
        : effectColor;
    const edgeAlpha = clampFiniteNumber(interactionState.borderAlpha, 0, 1);
    const fadeStart = clampFiniteNumber(
        (borderOptions.radius - borderOptions.falloff) / Math.max(1, borderOptions.radius),
        0,
        1
    );
    const spotlightRadius = Math.max(1, borderOptions.radius);

    context.save();
    context.beginPath();
    context.roundRect(0, 0, panel.w, panel.h, panel.radius);
    context.lineWidth = borderWidth;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.strokeStyle = formatRgba(resolvedColor.r, resolvedColor.g, resolvedColor.b, edgeAlpha);
    context.stroke();

    context.globalCompositeOperation = 'destination-in';
    const gradient = context.createRadialGradient(
        interactionState.localX,
        interactionState.localY,
        0,
        interactionState.localX,
        interactionState.localY,
        spotlightRadius
    );
    gradient.addColorStop(0, formatRgba(255, 255, 255, edgeAlpha));
    gradient.addColorStop(clampFiniteNumber(fadeStart * 0.62, 0, 1), formatRgba(255, 255, 255, edgeAlpha * 0.82));
    gradient.addColorStop(clampFiniteNumber(fadeStart, 0, 1), formatRgba(255, 255, 255, edgeAlpha * 0.55));
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, panel.w, panel.h);
    context.restore();
}

/**
 * hover particle를 그립니다.
 * @param {CanvasRenderingContext2D} context - 대상 컨텍스트입니다.
 * @param {object} panel - 대상 패널입니다.
 * @param {object} interactionState - 패널 interaction 상태입니다.
 * @param {{r:number, g:number, b:number}} effectColor - 사용할 효과 색상입니다.
 */
function drawOverlayPanelParticles(context, panel, interactionState, effectColor) {
    const centerX = panel.w * 0.5;
    const centerY = panel.h * 0.5;

    for (const particle of interactionState.particles) {
        if (!particle.visible || particle.opacity <= 0.01 || particle.scale <= 0.01) {
            continue;
        }

        context.save();
        context.translate(centerX + particle.currentX, centerY + particle.currentY);
        context.scale(particle.scale, particle.scale);
        context.beginPath();
        context.arc(0, 0, 2, 0, Math.PI * 2);
        context.fillStyle = formatRgba(effectColor.r, effectColor.g, effectColor.b, particle.opacity);
        context.fill();
        context.beginPath();
        context.arc(0, 0, 4, 0, Math.PI * 2);
        context.fillStyle = formatRgba(effectColor.r, effectColor.g, effectColor.b, particle.opacity * 0.2);
        context.fill();
        context.restore();
    }
}

/**
 * click ripple을 그립니다.
 * @param {CanvasRenderingContext2D} context - 대상 컨텍스트입니다.
 * @param {object} interactionState - 패널 interaction 상태입니다.
 * @param {{r:number, g:number, b:number}} effectColor - 사용할 효과 색상입니다.
 */
function drawOverlayPanelRipples(context, interactionState, effectColor) {
    for (const ripple of interactionState.ripples) {
        const progress = clampFiniteNumber(ripple.elapsed / ripple.duration, 0, 1);
        const opacity = 1 - progress;
        const radius = ripple.maxDistance * progress;
        if (radius <= 0) {
            continue;
        }

        const gradient = context.createRadialGradient(ripple.x, ripple.y, 0, ripple.x, ripple.y, radius);
        gradient.addColorStop(0, formatRgba(effectColor.r, effectColor.g, effectColor.b, 0.4 * opacity));
        gradient.addColorStop(0.3, formatRgba(effectColor.r, effectColor.g, effectColor.b, 0.2 * opacity));
        gradient.addColorStop(0.7, 'rgba(0, 0, 0, 0)');
        context.fillStyle = gradient;
        context.beginPath();
        context.arc(ripple.x, ripple.y, radius, 0, Math.PI * 2);
        context.fill();
    }
}

/**
 * 패널 effect를 그릴 오프스크린 캔버스를 생성하거나 재사용합니다.
 * @param {object} panel - 대상 패널입니다.
 * @param {object} interactionState - 패널 interaction 상태입니다.
 * @param {object} effectOptions - effect 옵션 묶음입니다.
 * @param {object|null} effectOptions.spotlightOptions - spotlight 옵션입니다.
 * @param {object|null} effectOptions.particleOptions - particle 옵션입니다.
 * @param {object|null} effectOptions.rippleOptions - ripple 옵션입니다.
 * @param {object|null} effectOptions.borderOptions - border 옵션입니다.
 * @returns {HTMLCanvasElement|null} 그려진 effect 캔버스입니다.
 */
export function buildOverlayPanelEffectCanvas(panel, interactionState, effectOptions) {
    const spotlightOptions = effectOptions.spotlightOptions;
    const particleOptions = effectOptions.particleOptions;
    const rippleOptions = effectOptions.rippleOptions;
    const borderOptions = effectOptions.borderOptions;
    const hasSpotlight = spotlightOptions && interactionState.spotlightAlpha > 0.005;
    const hasParticles = particleOptions && interactionState.particles.some((particle) => particle.visible && particle.opacity > 0.01);
    const hasRipples = rippleOptions && interactionState.ripples.length > 0;
    const hasBorder = borderOptions && interactionState.borderAlpha > 0.005;

    if (!hasSpotlight && !hasParticles && !hasRipples && !hasBorder) {
        return null;
    }

    if (!interactionState.effectCanvas || !interactionState.effectContext) {
        interactionState.effectCanvas = document.createElement('canvas');
        interactionState.effectContext = interactionState.effectCanvas.getContext('2d');
    }

    const canvasWidth = Math.max(1, Math.ceil(panel.w));
    const canvasHeight = Math.max(1, Math.ceil(panel.h));
    if (interactionState.effectCanvas.width !== canvasWidth) {
        interactionState.effectCanvas.width = canvasWidth;
    }
    if (interactionState.effectCanvas.height !== canvasHeight) {
        interactionState.effectCanvas.height = canvasHeight;
    }

    const context = interactionState.effectContext;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvasWidth, canvasHeight);
    context.save();
    context.beginPath();
    context.roundRect(0, 0, panel.w, panel.h, panel.radius);
    context.clip();

    const effectColor = getOverlayPanelEffectColor();
    if (hasSpotlight) {
        drawOverlayPanelSpotlight(context, interactionState, spotlightOptions, effectColor);
    }
    if (hasBorder) {
        drawOverlayPanelBorder(context, panel, interactionState, borderOptions, effectColor);
    }
    if (hasParticles) {
        drawOverlayPanelParticles(context, panel, interactionState, effectColor);
    }
    if (hasRipples) {
        drawOverlayPanelRipples(context, interactionState, effectColor);
    }

    context.restore();
    return interactionState.effectCanvas;
}
