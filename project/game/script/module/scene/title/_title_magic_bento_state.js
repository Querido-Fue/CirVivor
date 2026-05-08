import { spawnBentoCardRipple } from './_title_magic_bento_effect_state.js';
import {
    clamp,
    damp,
    easeOutExpo,
    lerp
} from './_title_magic_bento_motion.js';

/**
 * 카드의 현재 위치, 크기, 알파값을 갱신합니다.
 * @param {object[]} cards - 런타임 카드 목록
 * @param {number} appearanceElapsed - 등장 연출 경과 시간입니다.
 * @param {object} titleMagicBento - 타이틀 bento 설정입니다.
 */
export function refreshBentoCardTransforms(cards, appearanceElapsed, titleMagicBento) {
    const hoverScaleDelta = titleMagicBento.HOVER_SCALE_DELTA;
    const elapsedSinceStart = Math.max(0, appearanceElapsed - titleMagicBento.APPEAR_START_DELAY_SECONDS);

    for (const card of cards) {
        const rawProgress = clamp(
            (elapsedSinceStart - card.entranceDelaySeconds) / Math.max(0.001, card.entranceDurationSeconds),
            0,
            1
        );
        const easedProgress = easeOutExpo(rawProgress);
        const baseScale = lerp(
            titleMagicBento.ENTRANCE_START_SCALE + card.entranceScaleOffset,
            1,
            easedProgress
        );
        const currentScale = baseScale * (1 + (card.hoverProgress * hoverScaleDelta));
        const centerX = lerp(card.startCenterX, card.finalCenterX, easedProgress);
        const centerY = lerp(card.startCenterY, card.finalCenterY, easedProgress);
        const width = card.baseWidth * currentScale;
        const height = card.baseHeight * currentScale;

        card.entranceProgress = easedProgress;
        card.currentScale = currentScale;
        card.currentCenterX = centerX;
        card.currentCenterY = centerY;
        card.currentRect = {
            x: centerX - (width * 0.5),
            y: centerY - (height * 0.5),
            w: width,
            h: height
        };
        card.currentAlpha = clamp((rawProgress - 0.08) / 0.42, 0, 1);
    }
}

/**
 * 현재 카드들이 차지하는 화면 범위를 계산합니다.
 * @param {object[]} cards - 런타임 카드 목록
 * @returns {{x:number, y:number, w:number, h:number}} 카드 그룹 바운드
 */
export function calculateBentoVisibleGroupBounds(cards) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const card of cards) {
        if (card.currentAlpha <= 0.01) {
            continue;
        }
        minX = Math.min(minX, card.currentRect.x);
        minY = Math.min(minY, card.currentRect.y);
        maxX = Math.max(maxX, card.currentRect.x + card.currentRect.w);
        maxY = Math.max(maxY, card.currentRect.y + card.currentRect.h);
    }

    if (!Number.isFinite(minX)) {
        return { x: 0, y: 0, w: 0, h: 0 };
    }

    return {
        x: minX,
        y: minY,
        w: maxX - minX,
        h: maxY - minY
    };
}

/**
 * 주어진 점이 현재 카드 그룹 영역 안에 있는지 판정합니다.
 * @param {{x:number, y:number, w:number, h:number}} groupBounds - 카드 그룹 바운드
 * @param {number} x - 포인터 X 좌표
 * @param {number} y - 포인터 Y 좌표
 * @returns {boolean} 그룹 내부 여부
 */
export function isBentoPointInsideGroup(groupBounds, x, y) {
    if (groupBounds.w <= 0 || groupBounds.h <= 0) {
        return false;
    }

    return x >= groupBounds.x
        && x <= groupBounds.x + groupBounds.w
        && y >= groupBounds.y
        && y <= groupBounds.y + groupBounds.h;
}

/**
 * 포인터 아래에 있는 카드를 찾습니다.
 * @param {object[]} cards - 런타임 카드 목록
 * @param {number} x - 포인터 X 좌표
 * @param {number} y - 포인터 Y 좌표
 * @returns {string|null} 호버된 카드 ID
 */
export function resolveBentoHoveredCard(cards, x, y) {
    for (let index = cards.length - 1; index >= 0; index--) {
        const card = cards[index];
        if (card.currentAlpha < 0.45 || card.entranceProgress < 0.45) {
            continue;
        }
        if (x >= card.currentRect.x
            && x <= card.currentRect.x + card.currentRect.w
            && y >= card.currentRect.y
            && y <= card.currentRect.y + card.currentRect.h) {
            return card.id;
        }
    }

    return null;
}

/**
 * 스포트라이트 위치와 투명도를 계산합니다.
 * @param {object} options - 스포트라이트 업데이트 옵션입니다.
 * @param {number} options.mouseX - 포인터 X 좌표입니다.
 * @param {number} options.mouseY - 포인터 Y 좌표입니다.
 * @param {boolean} options.active - 스포트라이트 활성화 여부입니다.
 * @param {number} options.delta - 프레임 델타입니다.
 * @param {number} options.appearanceProgress - 등장 연출 진행률입니다.
 * @param {number} options.spotlightX - 현재 스포트라이트 X 좌표입니다.
 * @param {number} options.spotlightY - 현재 스포트라이트 Y 좌표입니다.
 * @param {number} options.spotlightOpacity - 현재 스포트라이트 투명도입니다.
 * @returns {{spotlightX:number, spotlightY:number, spotlightOpacity:number}} 갱신된 스포트라이트 상태입니다.
 */
export function updateBentoSpotlight({
    mouseX,
    mouseY,
    active,
    delta,
    appearanceProgress,
    spotlightX,
    spotlightY,
    spotlightOpacity
}) {
    const targetOpacity = active && appearanceProgress > 0.12 ? 1 : 0;
    const followSpeed = clamp(delta * 18, 0, 1);

    return {
        spotlightX: active ? damp(spotlightX, mouseX, followSpeed) : spotlightX,
        spotlightY: active ? damp(spotlightY, mouseY, followSpeed) : spotlightY,
        spotlightOpacity: damp(spotlightOpacity, targetOpacity, clamp(delta * 10, 0, 1))
    };
}

/**
 * 카드별 호버/틸트 상태와 글로우 강도를 갱신합니다.
 * @param {object} card - 대상 카드
 * @param {object} options - 카드 상호작용 업데이트 옵션입니다.
 * @param {number} options.mouseX - 포인터 X 좌표입니다.
 * @param {number} options.mouseY - 포인터 Y 좌표입니다.
 * @param {number} options.delta - 프레임 델타입니다.
 * @param {boolean} options.isHovered - 현재 호버 여부입니다.
 * @param {boolean} options.clickTriggered - 클릭 리플 트리거 여부입니다.
 * @param {number} options.uiww - UI 기준 너비입니다.
 * @param {number} options.spotlightX - 스포트라이트 X 좌표입니다.
 * @param {number} options.spotlightY - 스포트라이트 Y 좌표입니다.
 * @param {number} options.spotlightOpacity - 스포트라이트 투명도입니다.
 * @param {object} options.titleMagicBento - 타이틀 bento 설정입니다.
 */
export function updateBentoCardInteractionState(card, {
    mouseX,
    mouseY,
    delta,
    isHovered,
    clickTriggered,
    uiww,
    spotlightX,
    spotlightY,
    spotlightOpacity,
    titleMagicBento
}) {
    const cardCenterX = card.currentRect.x + (card.currentRect.w * 0.5);
    const cardCenterY = card.currentRect.y + (card.currentRect.h * 0.5);
    const hoverSpeed = clamp(delta * 10, 0, 1);
    const motionSpeed = clamp(delta * 12, 0, 1);
    const targetHover = isHovered ? 1 : 0;
    const spotlightRadius = Math.max(
        titleMagicBento.SPOTLIGHT_RADIUS_MIN,
        uiww * titleMagicBento.SPOTLIGHT_RADIUS_UIWW_RATIO
    );

    card.hoverProgress = damp(card.hoverProgress, targetHover, hoverSpeed);

    let targetTiltX = 0;
    let targetTiltY = 0;
    let localMouseX = card.baseWidth * 0.5;
    let localMouseY = card.baseHeight * 0.5;

    if (isHovered) {
        const normalizedX = clamp((mouseX - card.currentRect.x) / Math.max(1, card.currentRect.w), 0, 1);
        const normalizedY = clamp((mouseY - card.currentRect.y) / Math.max(1, card.currentRect.h), 0, 1);
        const centeredX = (normalizedX * 2) - 1;
        const centeredY = (normalizedY * 2) - 1;
        const tiltIntensity = titleMagicBento.TILT_INTENSITY;

        localMouseX = normalizedX * card.baseWidth;
        localMouseY = normalizedY * card.baseHeight;
        targetTiltX = centeredY * -titleMagicBento.TILT_X_MAX * tiltIntensity;
        targetTiltY = centeredX * titleMagicBento.TILT_Y_MAX * tiltIntensity;

        if (clickTriggered && card.entranceProgress > 0.7) {
            spawnBentoCardRipple(card, localMouseX, localMouseY, titleMagicBento);
        }
    }

    const distanceToSpotlight = Math.max(
        0,
        Math.hypot(spotlightX - cardCenterX, spotlightY - cardCenterY) - (Math.max(card.currentRect.w, card.currentRect.h) * 0.35)
    );
    let glowTarget = 0;
    if (spotlightOpacity > 0.01) {
        if (distanceToSpotlight <= spotlightRadius * 0.45) {
            glowTarget = 1;
        } else if (distanceToSpotlight <= spotlightRadius) {
            glowTarget = (spotlightRadius - distanceToSpotlight) / (spotlightRadius * 0.55);
        }
    }
    if (isHovered) {
        glowTarget = Math.max(glowTarget, 1);
    }

    card.localMouseX = localMouseX;
    card.localMouseY = localMouseY;
    card.tiltX = damp(card.tiltX, targetTiltX, motionSpeed);
    card.tiltY = damp(card.tiltY, targetTiltY, motionSpeed);
    card.glowIntensity = damp(glowTarget * spotlightOpacity, card.glowIntensity, 0);
    card.glowIntensity = damp(card.glowIntensity, glowTarget * spotlightOpacity, clamp(delta * 14, 0, 1));
}
