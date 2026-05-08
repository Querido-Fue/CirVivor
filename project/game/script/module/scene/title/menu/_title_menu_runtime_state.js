import {
    createRotationXMatrix,
    createRotationYMatrix,
    multiplyMat4
} from 'overlay/_panel_effect_math.js';

/**
 * 카드 또는 유틸리티 타일의 런타임 상호작용/텍스처 상태를 생성합니다.
 * @returns {object} 생성된 런타임 상태입니다.
 */
export function createTitleMenuRuntimeState() {
    return {
        hovered: false,
        wasHovered: false,
        localX: 0,
        localY: 0,
        normalizedX: 0,
        normalizedY: 0,
        targetRotateX: 0,
        targetRotateY: 0,
        rotateX: 0,
        rotateY: 0,
        perspective: 1180,
        transformMatrix: multiplyMat4(createRotationYMatrix(0), createRotationXMatrix(0)),
        projectedQuad: null,
        inverseHomography: null,
        spotlightAlpha: 0,
        borderAlpha: 0,
        particleAlpha: 0,
        hoverElapsed: 0,
        particles: [],
        ripples: [],
        textureCanvas: null,
        textureContext: null,
        staticTextureCanvas: null,
        staticTextureContext: null,
        staticTextureSignature: ''
    };
}

/**
 * 바깥 glass pane의 런타임 상호작용 상태를 생성합니다.
 * @returns {object} 생성된 pane 상호작용 상태입니다.
 */
export function createTitleMenuPaneRuntimeState() {
    return {
        hovered: false,
        spotlightAlpha: 0,
        borderAlpha: 0,
        localX: 0,
        localY: 0,
        wasHovered: false
    };
}
