import {
    getDeltaLerpFactor
} from 'overlay/_panel_effect_math.js';
import { clampNumber, lerpNumber, resolveFiniteNumber } from 'util/number_util.js';

/**
 * 카드 hover tilt 상태를 갱신합니다.
 * @param {object} renderState - 카드 렌더 상태입니다.
 * @param {object} runtimeState - 카드 런타임 상태입니다.
 * @param {number} delta - 프레임 델타 시간입니다.
 * @param {object|null} hoverTiltOptions - hover tilt 옵션입니다.
 */
export function updateTitleMenuTiltState(renderState, runtimeState, delta, hoverTiltOptions) {
    if (!hoverTiltOptions) {
        runtimeState.rotateX = lerpNumber(runtimeState.rotateX, 0, getDeltaLerpFactor(0.2, delta));
        runtimeState.rotateY = lerpNumber(runtimeState.rotateY, 0, getDeltaLerpFactor(0.2, delta));
        runtimeState.targetRotateX = 0;
        runtimeState.targetRotateY = 0;
        return;
    }

    const maxAngle = (hoverTiltOptions.maxAngleDeg * Math.PI) / 180;
    runtimeState.targetRotateX = runtimeState.hovered ? (-runtimeState.normalizedY * maxAngle) : 0;
    runtimeState.targetRotateY = runtimeState.hovered ? (runtimeState.normalizedX * maxAngle) : 0;

    const lerpFactor = getDeltaLerpFactor(hoverTiltOptions.smoothing, delta);
    runtimeState.rotateX = lerpNumber(runtimeState.rotateX, runtimeState.targetRotateX, lerpFactor);
    runtimeState.rotateY = lerpNumber(runtimeState.rotateY, runtimeState.targetRotateY, lerpFactor);
}

/**
 * 카드 spotlight 상태를 갱신합니다.
 * @param {object} runtimeState - 카드 런타임 상태입니다.
 * @param {number} delta - 프레임 델타 시간입니다.
 * @param {object|null} spotlightOptions - spotlight 옵션입니다.
 */
export function updateTitleMenuSpotlightState(runtimeState, delta, spotlightOptions) {
    if (!spotlightOptions) {
        runtimeState.spotlightAlpha = lerpNumber(runtimeState.spotlightAlpha, 0, getDeltaLerpFactor(0.24, delta));
        return;
    }

    runtimeState.spotlightAlpha = lerpNumber(
        runtimeState.spotlightAlpha,
        runtimeState.hovered ? spotlightOptions.opacity : 0,
        getDeltaLerpFactor(spotlightOptions.smoothing, delta)
    );
}

/**
 * 카드 hover border 상태를 갱신합니다.
 * @param {object} runtimeState - 카드 런타임 상태입니다.
 * @param {number} delta - 프레임 델타 시간입니다.
 * @param {object|null} borderOptions - hoverBorder 옵션입니다.
 */
export function updateTitleMenuBorderState(runtimeState, delta, borderOptions) {
    if (!borderOptions) {
        runtimeState.borderAlpha = lerpNumber(runtimeState.borderAlpha, 0, getDeltaLerpFactor(0.24, delta));
        return;
    }

    runtimeState.borderAlpha = lerpNumber(
        runtimeState.borderAlpha,
        runtimeState.hovered ? borderOptions.opacity : 0,
        getDeltaLerpFactor(borderOptions.smoothing, delta)
    );
}

/**
 * 카드 hover particle 상태를 갱신합니다.
 * @param {object} renderState - 카드 렌더 상태입니다.
 * @param {object} runtimeState - 카드 런타임 상태입니다.
 * @param {number} delta - 프레임 델타 시간입니다.
 * @param {object|null} particleOptions - particle 옵션입니다.
 */
export function updateTitleMenuParticleState(renderState, runtimeState, delta, particleOptions) {
    if (!particleOptions) {
        runtimeState.particles = [];
        runtimeState.particleAlpha = 0;
        return;
    }

    const resolvedParticleOptions = _resolveTitleMenuParticleOptions(renderState, particleOptions);

    if (!runtimeState.wasHovered && runtimeState.hovered) {
        runtimeState.particles = _createTitleMenuParticles(renderState, resolvedParticleOptions);
        runtimeState.hoverElapsed = 0;
    }

    if (runtimeState.hovered) {
        runtimeState.hoverElapsed += delta;
    }

    runtimeState.particleAlpha = lerpNumber(
        runtimeState.particleAlpha,
        runtimeState.hovered ? 1 : 0,
        getDeltaLerpFactor(0.22, delta)
    );

    if (!runtimeState.hovered && runtimeState.particleAlpha <= 0.01) {
        runtimeState.particles = [];
        return;
    }

    for (const particle of runtimeState.particles) {
        particle.elapsed += delta;
        if (particle.elapsed < particle.spawnDelay) {
            particle.visible = false;
            continue;
        }

        particle.visible = true;
        const cycleTime = particle.elapsed - particle.spawnDelay;
        const cycleProgress = clampNumber(cycleTime / particle.duration, 0, 1);
        const travelProgress = 0.5 - (0.5 * Math.cos((cycleTime / particle.duration) * Math.PI));
        const fadeInAlpha = clampNumber(cycleTime / 0.24, 0, 1);
        const fadeOutAlpha = clampNumber((particle.duration - cycleTime) / Math.max(0.16, particle.duration * 0.22), 0, 1);
        const lifeAlpha = Math.min(fadeInAlpha, fadeOutAlpha);
        particle.currentX = lerpNumber(particle.originX, particle.targetX, travelProgress);
        particle.currentY = lerpNumber(particle.originY, particle.targetY, travelProgress);
        particle.scale = Math.min(1, cycleTime / 0.3);
        particle.opacity = (0.65 + (0.35 * Math.sin(cycleProgress * Math.PI))) * lifeAlpha * runtimeState.particleAlpha;

        if (cycleTime >= particle.duration) {
            _resetTitleMenuParticle(particle, renderState, resolvedParticleOptions);
        }
    }
}

/**
 * 카드 ripple 상태를 갱신합니다.
 * @param {object} runtimeState - 카드 런타임 상태입니다.
 * @param {number} delta - 프레임 델타 시간입니다.
 */
export function updateTitleMenuRippleState(runtimeState, delta) {
    runtimeState.ripples = runtimeState.ripples.filter((ripple) => {
        ripple.elapsed += delta;
        return ripple.elapsed < ripple.duration;
    });
}

/**
 * 카드 클릭 ripple을 추가합니다.
 * @param {object} renderState - 카드 렌더 상태입니다.
 * @param {object} runtimeState - 카드 런타임 상태입니다.
 * @param {object} rippleOptions - ripple 옵션입니다.
 */
export function pushTitleMenuRipple(renderState, runtimeState, rippleOptions) {
    runtimeState.ripples.push({
        x: runtimeState.localX,
        y: runtimeState.localY,
        maxDistance: Math.max(
            Math.hypot(runtimeState.localX, runtimeState.localY),
            Math.hypot(runtimeState.localX - renderState.panelRect.w, runtimeState.localY),
            Math.hypot(runtimeState.localX, runtimeState.localY - renderState.panelRect.h),
            Math.hypot(runtimeState.localX - renderState.panelRect.w, runtimeState.localY - renderState.panelRect.h)
        ),
        elapsed: 0,
        duration: rippleOptions.duration
    });
}

/**
 * 현재 상태가 매 프레임 텍스처 재생성을 필요로 하는지 반환합니다.
 * @param {object} runtimeState - 카드 또는 타일 런타임 상태입니다.
 * @param {object|null} [renderState=null] - 렌더 상태입니다.
 * @returns {boolean} 동적 텍스처 필요 여부입니다.
 */
export function hasTitleMenuDynamicTextureState(runtimeState, renderState = null) {
    if (!runtimeState) {
        return false;
    }

    const hoverProgress = resolveFiniteNumber(renderState?.hoverProgress, 0);
    return hoverProgress > 0.005
        || runtimeState.spotlightAlpha > 0.005
        || runtimeState.borderAlpha > 0.005
        || runtimeState.ripples.length > 0
        || (runtimeState.particleAlpha > 0.005 && runtimeState.particles.length > 0);
}

/**
 * 카드 크기에 맞춰 particle 옵션을 보정합니다.
 * @param {object} renderState - 카드 렌더 상태입니다.
 * @param {object} particleOptions - 기본 particle 옵션입니다.
 * @returns {object} 카드 크기 기준으로 보정된 particle 옵션입니다.
 */
function _resolveTitleMenuParticleOptions(renderState, particleOptions) {
    const panelWidth = Math.max(1, renderState.panelRect.w);
    const panelHeight = Math.max(1, renderState.panelRect.h);
    const panelArea = panelWidth * panelHeight;
    const panelMinSize = Math.min(panelWidth, panelHeight);
    const areaScale = clampNumber(panelArea / 42000, 0.45, 1.5);
    const sizeScale = clampNumber(panelMinSize / 160, 0.72, 1.28);

    return {
        count: Math.round(clampNumber(particleOptions.count * areaScale, 5, 18)),
        spawnInterval: particleOptions.spawnInterval,
        driftDistance: particleOptions.driftDistance * sizeScale,
        minDuration: particleOptions.minDuration * sizeScale,
        maxDuration: particleOptions.maxDuration * sizeScale
    };
}

/**
 * 카드 particle 목록을 생성합니다.
 * @param {object} renderState - 카드 렌더 상태입니다.
 * @param {object} particleOptions - particle 옵션입니다.
 * @returns {object[]} 생성된 particle 목록입니다.
 */
function _createTitleMenuParticles(renderState, particleOptions) {
    return Array.from({ length: particleOptions.count }, (_value, index) => {
        const particle = {
            elapsed: 0,
            opacity: 0,
            originX: 0,
            originY: 0,
            targetX: 0,
            targetY: 0,
            currentX: 0,
            currentY: 0,
            scale: 0,
            spawnDelay: index * particleOptions.spawnInterval,
            duration: particleOptions.minDuration,
            visible: false
        };
        _resetTitleMenuParticle(particle, renderState, particleOptions);
        particle.elapsed = 0;
        return particle;
    });
}

/**
 * 카드 particle 이동 경로를 재설정합니다.
 * @param {object} particle - 재설정할 particle입니다.
 * @param {object} renderState - 카드 렌더 상태입니다.
 * @param {object} particleOptions - particle 옵션입니다.
 */
function _resetTitleMenuParticle(particle, renderState, particleOptions) {
    const panelRect = renderState.panelRect;
    particle.originX = (Math.random() - 0.5) * panelRect.w;
    particle.originY = (Math.random() - 0.5) * panelRect.h;
    particle.targetX = particle.originX + ((Math.random() - 0.5) * particleOptions.driftDistance);
    particle.targetY = particle.originY + ((Math.random() - 0.5) * particleOptions.driftDistance);
    particle.currentX = particle.originX;
    particle.currentY = particle.originY;
    particle.duration = particleOptions.minDuration + (Math.random() * Math.max(0, particleOptions.maxDuration - particleOptions.minDuration));
    particle.elapsed = particle.spawnDelay;
    particle.opacity = 0;
    particle.scale = 0;
    particle.visible = false;
}
