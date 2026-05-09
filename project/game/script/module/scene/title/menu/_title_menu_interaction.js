import {
    createRectToQuadHomography,
    createRotationXMatrix,
    createRotationYMatrix,
    getDeltaLerpFactor,
    invertMat3,
    isPointInsideQuad,
    isPointInsideRoundedRect,
    mapScreenPointToPanelLocal,
    multiplyMat4,
    projectPanelQuad
} from 'overlay/_panel_effect_math.js';
import { lerpNumber } from 'util/number_util.js';

/**
 * pane 상호작용 상태를 현재 포인터 위치와 효과 옵션에 맞게 갱신합니다.
 * @param {object} options - pane 상호작용 갱신 옵션입니다.
 * @param {object} options.paneState - pane 상호작용 상태입니다.
 * @param {object} options.paneRect - pane 영역입니다.
 * @param {number} options.mouseX - 마우스 X 좌표입니다.
 * @param {number} options.mouseY - 마우스 Y 좌표입니다.
 * @param {number} options.delta - 프레임 델타입니다.
 * @param {boolean} options.isInteractive - 상호작용 가능 여부입니다.
 * @param {object|null} options.spotlightOptions - hoverSpotlight 옵션입니다.
 * @param {object|null} options.borderOptions - hoverBorder 옵션입니다.
 * @returns {void}
 */
export function updateTitleMenuPaneInteractionState({
    paneState,
    paneRect,
    mouseX,
    mouseY,
    delta,
    isInteractive,
    spotlightOptions,
    borderOptions
}) {
    if (!paneState || !paneRect) {
        return;
    }

    if (!isInteractive) {
        paneState.hovered = false;
        paneState.spotlightAlpha = lerpNumber(
            paneState.spotlightAlpha,
            0,
            getDeltaLerpFactor(0.24, delta)
        );
        paneState.borderAlpha = lerpNumber(
            paneState.borderAlpha,
            0,
            getDeltaLerpFactor(0.24, delta)
        );
        paneState.wasHovered = false;
        return;
    }

    const pointerInfo = resolveTitleMenuPanePointerInfo(paneRect, mouseX, mouseY);
    paneState.hovered = pointerInfo.hovered;

    if (pointerInfo.hovered && pointerInfo.localPoint) {
        paneState.localX = pointerInfo.localPoint.x;
        paneState.localY = pointerInfo.localPoint.y;
    }

    if (!spotlightOptions) {
        paneState.spotlightAlpha = lerpNumber(
            paneState.spotlightAlpha,
            0,
            getDeltaLerpFactor(0.24, delta)
        );
    } else {
        paneState.spotlightAlpha = lerpNumber(
            paneState.spotlightAlpha,
            paneState.hovered ? spotlightOptions.opacity : 0,
            getDeltaLerpFactor(spotlightOptions.smoothing, delta)
        );
    }

    if (!borderOptions) {
        paneState.borderAlpha = lerpNumber(
            paneState.borderAlpha,
            0,
            getDeltaLerpFactor(0.24, delta)
        );
    } else {
        paneState.borderAlpha = lerpNumber(
            paneState.borderAlpha,
            paneState.hovered ? borderOptions.opacity : 0,
            getDeltaLerpFactor(borderOptions.smoothing, delta)
        );
    }

    paneState.wasHovered = paneState.hovered;
}

/**
 * pane 내부 hover 판정을 계산합니다.
 * @param {object} paneRect - pane 영역입니다.
 * @param {number} mouseX - 마우스 X 좌표입니다.
 * @param {number} mouseY - 마우스 Y 좌표입니다.
 * @returns {{hovered:boolean, localPoint:{x:number, y:number}|null}} 판정 결과입니다.
 */
export function resolveTitleMenuPanePointerInfo(paneRect, mouseX, mouseY) {
    if (!paneRect || !Number.isFinite(mouseX) || !Number.isFinite(mouseY)) {
        return {
            hovered: false,
            localPoint: null
        };
    }

    if (
        mouseX < paneRect.x
        || mouseX > paneRect.x + paneRect.w
        || mouseY < paneRect.y
        || mouseY > paneRect.y + paneRect.h
    ) {
        return {
            hovered: false,
            localPoint: null
        };
    }

    const localPoint = {
        x: mouseX - paneRect.x,
        y: mouseY - paneRect.y
    };

    const hovered = isPointInsideRoundedRect(
        localPoint.x,
        localPoint.y,
        paneRect.w,
        paneRect.h,
        paneRect.radius
    );

    if (!hovered) {
        return {
            hovered: false,
            localPoint: null
        };
    }

    return {
        hovered,
        localPoint
    };
}

/**
 * 현재 카드의 투영 상태를 갱신합니다.
 * @param {object} renderState - 카드 렌더 상태입니다.
 * @param {object} runtimeState - 카드 런타임 상태입니다.
 * @param {object|null} [hoverTiltOptions=null] - hover tilt 옵션입니다.
 * @returns {void}
 */
export function updateTitleMenuCardProjection(renderState, runtimeState, hoverTiltOptions = null) {
    const perspectiveBase = hoverTiltOptions?.perspective || 1180;
    runtimeState.perspective = perspectiveBase;

    runtimeState.transformMatrix = multiplyMat4(
        createRotationYMatrix(runtimeState.rotateY),
        createRotationXMatrix(runtimeState.rotateX)
    );
    runtimeState.projectedQuad = projectPanelQuad(renderState.panelRect, runtimeState.transformMatrix, runtimeState.perspective);

    const homography = createRectToQuadHomography(
        renderState.panelRect.w,
        renderState.panelRect.h,
        runtimeState.projectedQuad
    );
    runtimeState.inverseHomography = homography ? invertMat3(homography) : null;
}

/**
 * 화면 좌표가 현재 카드 내부에 있는지 판정합니다.
 * @param {object} renderState - 카드 렌더 상태입니다.
 * @param {object} runtimeState - 카드 런타임 상태입니다.
 * @param {number} mouseX - 현재 마우스 X 좌표입니다.
 * @param {number} mouseY - 현재 마우스 Y 좌표입니다.
 * @returns {{hovered:boolean, localPoint:{x:number, y:number}|null}} 판정 결과입니다.
 */
export function resolveTitleMenuCardPointerInfo(renderState, runtimeState, mouseX, mouseY) {
    if (!Number.isFinite(mouseX) || !Number.isFinite(mouseY) || !runtimeState.projectedQuad) {
        return {
            hovered: false,
            localPoint: null
        };
    }

    if (!isPointInsideQuad(mouseX, mouseY, runtimeState.projectedQuad)) {
        return {
            hovered: false,
            localPoint: null
        };
    }

    const localPoint = mapScreenPointToPanelLocal(mouseX, mouseY, runtimeState.inverseHomography)
        || {
            x: mouseX - renderState.panelRect.x,
            y: mouseY - renderState.panelRect.y
        };
    const hovered = isPointInsideRoundedRect(
        localPoint.x,
        localPoint.y,
        renderState.panelRect.w,
        renderState.panelRect.h,
        renderState.panelRect.radius
    );

    return {
        hovered,
        localPoint
    };
}
