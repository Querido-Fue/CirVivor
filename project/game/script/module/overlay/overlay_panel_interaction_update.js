import { getDelta } from 'game/time_handler.js';
import { getMouseFocus, getMouseInput, hasMouseState } from 'input/input_system.js';
import { clampNumber } from 'util/number_util.js';
import {
    createRectToQuadHomography,
    createTiltMatrix,
    getDeltaLerpFactor,
    invertMat3,
    isPointInsideQuad,
    isPointInsideRoundedRect,
    lerpNumber,
    mapScreenPointToPanelLocal,
    projectPanelQuad
} from './_panel_effect_math.js';
import { getOverlayPresentedPanelRegion } from './overlay_panel_region.js';

/**
 * 패널 hover/click 상태가 비활성일 때 effect 상태를 원점으로 복귀시킵니다.
 * @param {object} panel - 대상 패널입니다.
 * @param {object} interactionState - 패널 interaction 상태입니다.
 * @param {number} delta - 프레임 델타입니다.
 * @param {object|null} tiltOptions - tilt 옵션입니다.
 * @param {object|null} spotlightOptions - spotlight 옵션입니다.
 * @param {object|null} particleOptions - particle 옵션입니다.
 * @param {object|null} borderOptions - border 옵션입니다.
 */
function resetPanelInteractionTargets(panel, interactionState, delta, tiltOptions, spotlightOptions, particleOptions, borderOptions) {
    interactionState.hovered = false;
    updateTiltState(panel, interactionState, tiltOptions, delta);
    updatePanelProjection(panel, interactionState, tiltOptions);
    updateSpotlightState(interactionState, spotlightOptions, delta);
    updateBorderState(interactionState, borderOptions, delta);
    updateParticleState(panel, interactionState, particleOptions, delta);
    updateRippleState(interactionState, delta);
    interactionState.wasHovered = false;
}

/**
 * 현재 패널의 투영 사각형과 역호모그래피를 계산합니다.
 * @param {object} panel - 대상 패널입니다.
 * @param {object} interactionState - 패널 interaction 상태입니다.
 * @param {object|null} tiltOptions - tilt 옵션입니다.
 */
function updatePanelProjection(panel, interactionState, tiltOptions) {
    interactionState.perspective = tiltOptions?.perspective || 1000;
    interactionState.transformMatrix = createTiltMatrix(interactionState.rotateX, interactionState.rotateY);
    interactionState.projectedQuad = projectPanelQuad(panel, interactionState.transformMatrix, interactionState.perspective);
    const homography = createRectToQuadHomography(panel.w, panel.h, interactionState.projectedQuad);
    interactionState.inverseHomography = homography ? invertMat3(homography) : null;
}

/**
 * 화면 좌표가 패널 내부인지 판정하고 로컬 좌표를 계산합니다.
 * @param {object} panel - 대상 패널입니다.
 * @param {object} interactionState - 패널 interaction 상태입니다.
 * @param {number} mouseX - 현재 마우스 X 좌표입니다.
 * @param {number} mouseY - 현재 마우스 Y 좌표입니다.
 * @returns {{hovered: boolean, localPoint: {x:number, y:number}|null}} 판정 결과입니다.
 */
function resolvePanelPointerInfo(panel, interactionState, mouseX, mouseY) {
    if (!Number.isFinite(mouseX) || !Number.isFinite(mouseY)) {
        return { hovered: false, localPoint: null };
    }

    const projectedQuad = interactionState.projectedQuad;
    if (!isPointInsideQuad(mouseX, mouseY, projectedQuad)) {
        return { hovered: false, localPoint: null };
    }

    const localPoint = mapScreenPointToPanelLocal(mouseX, mouseY, interactionState.inverseHomography)
        || { x: mouseX - panel.x, y: mouseY - panel.y };
    const hovered = isPointInsideRoundedRect(localPoint.x, localPoint.y, panel.w, panel.h, panel.radius);

    return {
        hovered,
        localPoint
    };
}

/**
 * tilt effect 상태를 갱신합니다.
 * @param {object} panel - 대상 패널입니다.
 * @param {object} interactionState - 패널 interaction 상태입니다.
 * @param {object|null} tiltOptions - tilt 옵션입니다.
 * @param {number} delta - 프레임 델타입니다.
 */
function updateTiltState(panel, interactionState, tiltOptions, delta) {
    if (!tiltOptions) {
        interactionState.rotateX = 0;
        interactionState.rotateY = 0;
        interactionState.targetRotateX = 0;
        interactionState.targetRotateY = 0;
        return;
    }

    const maxAngle = (tiltOptions.maxAngleDeg * Math.PI) / 180;
    interactionState.targetRotateX = interactionState.hovered ? (-interactionState.normalizedY * maxAngle) : 0;
    interactionState.targetRotateY = interactionState.hovered ? (interactionState.normalizedX * maxAngle) : 0;

    const lerpFactor = getDeltaLerpFactor(tiltOptions.smoothing, delta);
    interactionState.rotateX = lerpNumber(interactionState.rotateX, interactionState.targetRotateX, lerpFactor);
    interactionState.rotateY = lerpNumber(interactionState.rotateY, interactionState.targetRotateY, lerpFactor);

    if (!interactionState.hovered && Math.abs(interactionState.rotateX) < 0.0001 && Math.abs(interactionState.rotateY) < 0.0001) {
        interactionState.rotateX = 0;
        interactionState.rotateY = 0;
    }
}

/**
 * spotlight fade 값을 갱신합니다.
 * @param {object} interactionState - 패널 interaction 상태입니다.
 * @param {object|null} spotlightOptions - spotlight 옵션입니다.
 * @param {number} delta - 프레임 델타입니다.
 */
function updateSpotlightState(interactionState, spotlightOptions, delta) {
    if (!spotlightOptions) {
        interactionState.spotlightAlpha = 0;
        return;
    }

    const lerpFactor = getDeltaLerpFactor(spotlightOptions.smoothing, delta);
    interactionState.spotlightAlpha = lerpNumber(
        interactionState.spotlightAlpha,
        interactionState.hovered ? spotlightOptions.opacity : 0,
        lerpFactor
    );
}

/**
 * hover border fade 값을 갱신합니다.
 * @param {object} interactionState - 패널 interaction 상태입니다.
 * @param {object|null} borderOptions - hoverBorder 옵션입니다.
 * @param {number} delta - 프레임 델타입니다.
 */
function updateBorderState(interactionState, borderOptions, delta) {
    if (!borderOptions) {
        interactionState.borderAlpha = 0;
        return;
    }

    interactionState.borderAlpha = lerpNumber(
        interactionState.borderAlpha,
        interactionState.hovered ? borderOptions.opacity : 0,
        getDeltaLerpFactor(borderOptions.smoothing, delta)
    );
}

/**
 * hover particle 상태를 갱신합니다.
 * @param {object} panel - 대상 패널입니다.
 * @param {object} interactionState - 패널 interaction 상태입니다.
 * @param {object|null} particleOptions - particle 옵션입니다.
 * @param {number} delta - 프레임 델타입니다.
 */
function updateParticleState(panel, interactionState, particleOptions, delta) {
    if (!particleOptions) {
        interactionState.particles = [];
        interactionState.particleAlpha = 0;
        return;
    }

    if (!interactionState.wasHovered && interactionState.hovered) {
        interactionState.hoverElapsed = 0;
        interactionState.particles = createPanelParticles(panel, particleOptions);
    }

    if (interactionState.hovered) {
        interactionState.hoverElapsed += delta;
    }

    interactionState.particleAlpha = lerpNumber(
        interactionState.particleAlpha,
        interactionState.hovered ? 1 : 0,
        getDeltaLerpFactor(0.22, delta)
    );

    if (!interactionState.hovered && interactionState.particleAlpha <= 0.01) {
        interactionState.particles = [];
        return;
    }

    for (const particle of interactionState.particles) {
        particle.elapsed += delta;
        if (particle.elapsed < particle.spawnDelay) {
            particle.visible = false;
            continue;
        }

        particle.visible = true;
        const cycleTime = particle.elapsed - particle.spawnDelay;
        const travelProgress = 0.5 - (0.5 * Math.cos((cycleTime / particle.duration) * Math.PI));
        particle.currentX = lerpNumber(particle.originX, particle.targetX, travelProgress);
        particle.currentY = lerpNumber(particle.originY, particle.targetY, travelProgress);
        particle.scale = Math.min(1, cycleTime / 0.3);
        particle.opacity = (0.65 + (0.35 * Math.sin((cycleTime / 1.5) * Math.PI))) * interactionState.particleAlpha;

        if (cycleTime >= particle.duration) {
            resetPanelParticle(particle, panel, particleOptions);
        }
    }
}

/**
 * click ripple 상태를 갱신합니다.
 * @param {object} interactionState - 패널 interaction 상태입니다.
 * @param {number} delta - 프레임 델타입니다.
 */
function updateRippleState(interactionState, delta) {
    interactionState.ripples = interactionState.ripples.filter((ripple) => {
        ripple.elapsed += delta;
        return ripple.elapsed < ripple.duration;
    });
}

/**
 * 패널 클릭을 처리하고 ripple/onClick을 실행합니다.
 * @param {object} panel - 대상 패널입니다.
 * @param {object} interactionState - 패널 interaction 상태입니다.
 * @param {object|null} rippleOptions - ripple 옵션입니다.
 * @param {object} overlay - 콜백에 전달할 overlay입니다.
 */
function handlePanelClick(panel, interactionState, rippleOptions, overlay) {
    if (rippleOptions) {
        interactionState.ripples.push({
            x: interactionState.localX,
            y: interactionState.localY,
            maxDistance: Math.max(
                Math.hypot(interactionState.localX, interactionState.localY),
                Math.hypot(interactionState.localX - panel.w, interactionState.localY),
                Math.hypot(interactionState.localX, interactionState.localY - panel.h),
                Math.hypot(interactionState.localX - panel.w, interactionState.localY - panel.h)
            ),
            elapsed: 0,
            duration: rippleOptions.duration
        });
    }

    if (typeof panel.onClick === 'function') {
        panel.onClick({
            panel,
            localX: interactionState.localX,
            localY: interactionState.localY,
            overlay
        });
    }
}

/**
 * hover particle 기본 상태를 생성합니다.
 * @param {object} panel - 대상 패널입니다.
 * @param {object} particleOptions - particle 옵션입니다.
 * @returns {object[]} 생성된 particle 배열입니다.
 */
function createPanelParticles(panel, particleOptions) {
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
        resetPanelParticle(particle, panel, particleOptions);
        particle.elapsed = 0;
        return particle;
    });
}

/**
 * particle의 이동 경로를 재설정합니다.
 * @param {object} particle - 재설정할 particle입니다.
 * @param {object} panel - 대상 패널입니다.
 * @param {object} particleOptions - particle 옵션입니다.
 */
function resetPanelParticle(particle, panel, particleOptions) {
    particle.originX = (Math.random() - 0.5) * panel.w;
    particle.originY = (Math.random() - 0.5) * panel.h;
    particle.targetX = particle.originX + ((Math.random() - 0.5) * particleOptions.driftDistance);
    particle.targetY = particle.originY + ((Math.random() - 0.5) * particleOptions.driftDistance);
    particle.currentX = particle.originX;
    particle.currentY = particle.originY;
    particle.duration = particleOptions.minDuration + (Math.random() * Math.max(0, particleOptions.maxDuration - particleOptions.minDuration));
    particle.elapsed = particle.spawnDelay;
}

/**
 * 패널별 interaction/effect 상태를 매 프레임 갱신합니다.
 * @param {object} options - 갱신 옵션입니다.
 * @param {object} options.overlay - 콜백에 전달할 overlay입니다.
 * @param {object} options.session - overlay session입니다.
 * @param {string} options.layer - overlay layer id입니다.
 * @param {number} options.alpha - 현재 overlay alpha입니다.
 * @param {object[]} options.panelRegions - 패널 영역 목록입니다.
 * @param {Map<string, object>} options.panelInteractionMap - 패널 interaction 상태 맵입니다.
 */
export function updateOverlayPanelInteractions({
    overlay,
    session,
    layer,
    alpha,
    panelRegions,
    panelInteractionMap
}) {
    if (!session || panelRegions.length === 0) {
        return;
    }

    const delta = getDelta();
    const mouseX = getMouseInput('x');
    const mouseY = getMouseInput('y');
    const leftClicked = hasMouseState('left', 'clicked');
    const hasLayerFocus = getMouseFocus().includes(layer);
    const tiltOptions = session.getEffectOptions('hoverTilt');
    const spotlightOptions = session.getEffectOptions('hoverSpotlight');
    const rippleOptions = session.getEffectOptions('clickRipple');
    const particleOptions = session.getEffectOptions('hoverParticle');
    const borderOptions = session.getEffectOptions('hoverBorder');

    for (const panel of panelRegions) {
        const interactionState = panelInteractionMap.get(panel.id);
        if (!interactionState) {
            continue;
        }

        const presentedPanel = getOverlayPresentedPanelRegion(panel, overlay);
        const isInteractive = Boolean(panel.onClick || tiltOptions || spotlightOptions || rippleOptions || particleOptions || borderOptions);
        if (!presentedPanel.visible || presentedPanel.w <= 0 || presentedPanel.h <= 0 || !isInteractive || alpha <= 0) {
            resetPanelInteractionTargets(
                presentedPanel,
                interactionState,
                delta,
                tiltOptions,
                spotlightOptions,
                particleOptions,
                borderOptions
            );
            continue;
        }

        updatePanelProjection(presentedPanel, interactionState, tiltOptions);

        const pointerInfo = hasLayerFocus
            ? resolvePanelPointerInfo(presentedPanel, interactionState, mouseX, mouseY)
            : null;

        interactionState.hovered = pointerInfo?.hovered === true;
        if (interactionState.hovered && pointerInfo?.localPoint) {
            interactionState.localX = pointerInfo.localPoint.x;
            interactionState.localY = pointerInfo.localPoint.y;
            interactionState.normalizedX = clampNumber(((interactionState.localX / Math.max(1, presentedPanel.w)) * 2) - 1, -1, 1);
            interactionState.normalizedY = clampNumber(((interactionState.localY / Math.max(1, presentedPanel.h)) * 2) - 1, -1, 1);
        }

        if (leftClicked && interactionState.hovered) {
            handlePanelClick(presentedPanel, interactionState, rippleOptions, overlay);
        }

        updateTiltState(presentedPanel, interactionState, tiltOptions, delta);
        updatePanelProjection(presentedPanel, interactionState, tiltOptions);
        updateSpotlightState(interactionState, spotlightOptions, delta);
        updateBorderState(interactionState, borderOptions, delta);
        updateParticleState(presentedPanel, interactionState, particleOptions, delta);
        updateRippleState(interactionState, delta);
        interactionState.wasHovered = interactionState.hovered;
    }
}
