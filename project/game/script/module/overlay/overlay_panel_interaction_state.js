import { createTiltMatrix } from './_panel_effect_math.js';

/**
 * 패널 interaction 상태 객체를 생성합니다.
 * @param {object} panel - 기준 패널 영역입니다.
 * @returns {object} interaction 상태입니다.
 */
export function createOverlayPanelInteractionState(panel) {
    return {
        hovered: false,
        wasHovered: false,
        localX: panel.w * 0.5,
        localY: panel.h * 0.5,
        normalizedX: 0,
        normalizedY: 0,
        targetRotateX: 0,
        targetRotateY: 0,
        rotateX: 0,
        rotateY: 0,
        perspective: 1000,
        transformMatrix: createTiltMatrix(0, 0),
        projectedQuad: null,
        inverseHomography: null,
        spotlightAlpha: 0,
        borderAlpha: 0,
        particleAlpha: 0,
        hoverElapsed: 0,
        particles: [],
        ripples: [],
        effectCanvas: null,
        effectContext: null
    };
}

/**
 * 패널 목록에 맞춰 interaction 상태 맵을 동기화합니다.
 * @param {object[]} panelRegions - 정규화된 패널 영역 목록입니다.
 * @param {Map<string, object>} panelInteractionMap - 재사용할 interaction 상태 맵입니다.
 */
export function syncOverlayPanelInteractionStates(panelRegions, panelInteractionMap) {
    const activePanelIds = new Set(panelRegions.map((panel) => panel.id));

    for (const panel of panelRegions) {
        const existingState = panelInteractionMap.get(panel.id);
        if (existingState) {
            existingState.localX = panel.w * 0.5;
            existingState.localY = panel.h * 0.5;
            continue;
        }

        panelInteractionMap.set(panel.id, createOverlayPanelInteractionState(panel));
    }

    for (const panelId of panelInteractionMap.keys()) {
        if (!activePanelIds.has(panelId)) {
            panelInteractionMap.delete(panelId);
        }
    }
}
