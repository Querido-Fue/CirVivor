import { clampNumber } from 'util/number_util.js';
import {
    resolveTitleMenuCardPointerInfo,
    updateTitleMenuCardProjection
} from './_title_menu_interaction.js';
import {
    pushTitleMenuRipple,
    updateTitleMenuBorderState,
    updateTitleMenuParticleState,
    updateTitleMenuRippleState,
    updateTitleMenuSpotlightState,
    updateTitleMenuTiltState
} from './_title_menu_effect_state.js';

/**
 * 카드 메뉴의 카드 상호작용 상태를 갱신합니다.
 * @param {object} options - 카드 상호작용 갱신 옵션입니다.
 * @param {Array<object>} options.cards - 전체 카드 목록입니다.
 * @param {Array<object>} options.interactiveCards - hover 판정 순서의 카드 목록입니다.
 * @param {Map<string, object>} options.cardStateMap - 카드 런타임 상태 맵입니다.
 * @param {Map<string, object>} options.cardRenderMap - 카드 렌더 상태 맵입니다.
 * @param {boolean} options.pointerEnabled - 포인터 상호작용 활성 여부입니다.
 * @param {number} options.mouseX - 현재 마우스 X 좌표입니다.
 * @param {number} options.mouseY - 현재 마우스 Y 좌표입니다.
 * @param {number} options.delta - 프레임 델타 시간입니다.
 * @param {boolean} options.clickedThisFrame - 이번 프레임 클릭 여부입니다.
 * @param {object|null} options.hoverTiltOptions - hover tilt 옵션입니다.
 * @param {object|null} options.spotlightOptions - spotlight 옵션입니다.
 * @param {object|null} options.borderOptions - border 옵션입니다.
 * @param {object|null} options.rippleOptions - ripple 옵션입니다.
 * @param {object|null} options.particleOptions - particle 옵션입니다.
 * @returns {{hoveredCardId:string|null, clickedCard:object|null}} 상호작용 결과입니다.
 */
export function updateTitleMenuCardInteractionStates({
    cards,
    interactiveCards,
    cardStateMap,
    cardRenderMap,
    pointerEnabled,
    mouseX,
    mouseY,
    delta,
    clickedThisFrame,
    hoverTiltOptions,
    spotlightOptions,
    borderOptions,
    rippleOptions,
    particleOptions
}) {
    let hoveredCardId = null;
    let hoveredPointerInfo = null;
    let clickedCard = null;

    for (const card of interactiveCards) {
        const runtimeState = cardStateMap.get(card.cardDefinition.id);
        const renderState = cardRenderMap.get(card.cardDefinition.id);
        if (!runtimeState || !renderState || renderState.alpha <= 0.75) {
            continue;
        }

        updateTitleMenuCardProjection(renderState, runtimeState, hoverTiltOptions);
        const pointerInfo = resolveTitleMenuCardPointerInfo(renderState, runtimeState, mouseX, mouseY);
        if (pointerInfo?.hovered) {
            hoveredCardId = card.cardDefinition.id;
            hoveredPointerInfo = pointerInfo;
            break;
        }
    }

    for (const card of cards) {
        const runtimeState = cardStateMap.get(card.cardDefinition.id);
        const renderState = cardRenderMap.get(card.cardDefinition.id);
        if (!runtimeState || !renderState) {
            continue;
        }

        const isHovered = pointerEnabled && hoveredCardId === card.cardDefinition.id;
        runtimeState.hovered = isHovered;
        if (isHovered && hoveredPointerInfo?.localPoint) {
            _syncTitleMenuPointerLocalState(runtimeState, renderState, hoveredPointerInfo.localPoint);
        }

        card.setHovered(isHovered);
        if (clickedThisFrame && isHovered) {
            if (rippleOptions) {
                pushTitleMenuRipple(renderState, runtimeState, rippleOptions);
            }
            clickedCard = card;
        }

        _updateTitleMenuInteractiveEffectState({
            renderState,
            runtimeState,
            delta,
            hoverTiltOptions,
            spotlightOptions,
            borderOptions,
            particleOptions
        });
        updateTitleMenuRippleState(runtimeState, delta);
        runtimeState.wasHovered = runtimeState.hovered;
        card.update(delta);
    }

    return {
        hoveredCardId,
        clickedCard
    };
}

/**
 * 하단 보조 메뉴 타일 상호작용 상태를 갱신합니다.
 * @param {object} options - 타일 상호작용 갱신 옵션입니다.
 * @param {Array<object>} options.secondaryMenuEntries - 하단 메뉴 항목 목록입니다.
 * @param {Map<string, object>} options.utilityTileStateMap - 타일 런타임 상태 맵입니다.
 * @param {Map<string, object>} options.utilityTileRenderMap - 타일 렌더 상태 맵입니다.
 * @param {boolean} options.isInteractive - 상호작용 가능 여부입니다.
 * @param {number} options.mouseX - 현재 마우스 X 좌표입니다.
 * @param {number} options.mouseY - 현재 마우스 Y 좌표입니다.
 * @param {number} options.delta - 프레임 델타 시간입니다.
 * @param {boolean} options.clickedThisFrame - 이번 프레임 클릭 여부입니다.
 * @param {object|null} options.hoverTiltOptions - hover tilt 옵션입니다.
 * @param {object|null} options.spotlightOptions - spotlight 옵션입니다.
 * @param {object|null} options.borderOptions - border 옵션입니다.
 * @param {object|null} options.rippleOptions - ripple 옵션입니다.
 * @param {object|null} options.particleOptions - particle 옵션입니다.
 * @returns {{hoveredMenuItemId:string|null, hoveredMenuEntry:object|null, clickedMenuEntry:object|null}} 상호작용 결과입니다.
 */
export function updateTitleMenuUtilityTileInteractionStates({
    secondaryMenuEntries,
    utilityTileStateMap,
    utilityTileRenderMap,
    isInteractive,
    mouseX,
    mouseY,
    delta,
    clickedThisFrame,
    hoverTiltOptions,
    spotlightOptions,
    borderOptions,
    rippleOptions,
    particleOptions
}) {
    let hoveredMenuItemId = null;
    let hoveredPointerInfo = null;
    let clickedMenuEntry = null;

    if (isInteractive) {
        const interactiveItems = [...secondaryMenuEntries].reverse();
        for (const menuEntry of interactiveItems) {
            const runtimeState = utilityTileStateMap.get(menuEntry.id);
            const renderState = utilityTileRenderMap.get(menuEntry.id);
            if (!runtimeState || !renderState || renderState.alpha <= 0.75) {
                continue;
            }

            updateTitleMenuCardProjection(renderState, runtimeState, hoverTiltOptions);
            const pointerInfo = resolveTitleMenuCardPointerInfo(renderState, runtimeState, mouseX, mouseY);
            if (pointerInfo?.hovered) {
                hoveredMenuItemId = menuEntry.id;
                hoveredPointerInfo = pointerInfo;
                break;
            }
        }
    }

    const hoveredMenuEntry = hoveredMenuItemId
        ? (secondaryMenuEntries.find((menuEntry) => menuEntry.id === hoveredMenuItemId) || null)
        : null;

    for (const menuEntry of secondaryMenuEntries) {
        const runtimeState = utilityTileStateMap.get(menuEntry.id);
        const renderState = utilityTileRenderMap.get(menuEntry.id);
        if (!runtimeState || !renderState) {
            continue;
        }

        const isHovered = hoveredMenuItemId === menuEntry.id;
        runtimeState.hovered = isHovered;
        if (isHovered && hoveredPointerInfo?.localPoint) {
            _syncTitleMenuPointerLocalState(runtimeState, renderState, hoveredPointerInfo.localPoint);
        }

        _updateTitleMenuInteractiveEffectState({
            renderState,
            runtimeState,
            delta,
            hoverTiltOptions,
            spotlightOptions,
            borderOptions,
            particleOptions
        });
        updateTitleMenuRippleState(runtimeState, delta);

        if (clickedThisFrame && isHovered) {
            if (rippleOptions) {
                pushTitleMenuRipple(renderState, runtimeState, rippleOptions);
            }
            clickedMenuEntry = menuEntry;
        }

        runtimeState.wasHovered = runtimeState.hovered;
    }

    return {
        hoveredMenuItemId,
        hoveredMenuEntry,
        clickedMenuEntry
    };
}

/**
 * 포인터 로컬 좌표와 정규화 좌표를 런타임 상태에 반영합니다.
 * @param {object} runtimeState - 카드 또는 타일 런타임 상태입니다.
 * @param {object} renderState - 렌더 상태입니다.
 * @param {{x:number, y:number}} localPoint - 패널 로컬 좌표입니다.
 */
function _syncTitleMenuPointerLocalState(runtimeState, renderState, localPoint) {
    runtimeState.localX = localPoint.x;
    runtimeState.localY = localPoint.y;
    runtimeState.normalizedX = clampNumber(((runtimeState.localX / Math.max(1, renderState.panelRect.w)) * 2) - 1, -1, 1);
    runtimeState.normalizedY = clampNumber(((runtimeState.localY / Math.max(1, renderState.panelRect.h)) * 2) - 1, -1, 1);
}

/**
 * 카드형 요소의 hover 기반 효과 상태를 갱신합니다.
 * @param {object} options - 효과 상태 갱신 옵션입니다.
 * @param {object} options.renderState - 렌더 상태입니다.
 * @param {object} options.runtimeState - 런타임 상태입니다.
 * @param {number} options.delta - 프레임 델타 시간입니다.
 * @param {object|null} options.hoverTiltOptions - hover tilt 옵션입니다.
 * @param {object|null} options.spotlightOptions - spotlight 옵션입니다.
 * @param {object|null} options.borderOptions - border 옵션입니다.
 * @param {object|null} options.particleOptions - particle 옵션입니다.
 */
function _updateTitleMenuInteractiveEffectState({
    renderState,
    runtimeState,
    delta,
    hoverTiltOptions,
    spotlightOptions,
    borderOptions,
    particleOptions
}) {
    updateTitleMenuTiltState(renderState, runtimeState, delta, hoverTiltOptions);
    updateTitleMenuCardProjection(renderState, runtimeState, hoverTiltOptions);
    updateTitleMenuSpotlightState(runtimeState, delta, spotlightOptions);
    updateTitleMenuBorderState(runtimeState, delta, borderOptions);
    updateTitleMenuParticleState(renderState, runtimeState, delta, particleOptions);
}
