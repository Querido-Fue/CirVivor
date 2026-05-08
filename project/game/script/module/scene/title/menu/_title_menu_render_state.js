import { clampNumber, easeOutCubic, easeOutExpo, lerpValue } from './_title_menu_motion.js';

/**
 * 카드 현재 렌더 상태를 계산합니다.
 * @param {object} options - 카드 렌더 상태 계산 옵션입니다.
 * @param {object} options.card - 대상 카드입니다.
 * @param {number} options.transitionProgress - 타이틀 전환 진행률입니다.
 * @param {number} [options.groupOffsetX=0] - 카드 그룹 X 오프셋입니다.
 * @param {number} [options.groupOffsetY=0] - 카드 그룹 Y 오프셋입니다.
 * @param {number} options.ww - 화면 너비입니다.
 * @param {number} options.wh - 화면 높이입니다.
 * @param {number} options.uiww - UI 기준 너비입니다.
 * @param {object} options.titleCardMenu - 타이틀 카드 메뉴 상수입니다.
 * @param {Function} options.getRevealConfig - 카드 등장 설정 조회 함수입니다.
 * @param {Function} options.getRevealProgress - 등장 진행률 계산 함수입니다.
 * @returns {object} 계산된 렌더 상태입니다.
 */
export function buildTitleMenuCardRenderState({
    card,
    transitionProgress,
    groupOffsetX = 0,
    groupOffsetY = 0,
    ww,
    wh,
    uiww,
    titleCardMenu,
    getRevealConfig,
    getRevealProgress
}) {
    const layoutRect = card.layoutRect;
    const animationState = card.animator.getState();
    if (!layoutRect) {
        return {
            alpha: 0,
            hoverProgress: 0,
            panelRect: {
                x: 0,
                y: 0,
                w: 0,
                h: 0,
                radius: 0
            }
        };
    }

    const revealConfig = getRevealConfig(card.cardDefinition.id);
    const revealProgress = getRevealProgress(revealConfig.delaySeconds, revealConfig.durationSeconds);
    const revealEase = easeOutExpo(revealProgress);
    const motionEase = easeOutExpo(revealProgress);
    const transitionEase = easeOutExpo(transitionProgress);
    const worldScale = lerpValue(titleCardMenu.ENTRANCE_START_SCALE, 1, transitionEase);
    const entryScale = lerpValue(1 + revealConfig.scaleOffset, 1, revealEase);
    const hoverProgress = easeOutCubic(animationState.hoverProgress || 0);
    const finalCenterX = layoutRect.x + groupOffsetX + (layoutRect.w * 0.5);
    const finalCenterY = layoutRect.y + groupOffsetY + (layoutRect.h * 0.5);
    const screenCenterX = ww * 0.5;
    const screenCenterY = wh * 0.5;
    const width = layoutRect.w * worldScale * entryScale;
    const height = layoutRect.h * worldScale * entryScale;
    const baseCenterX = screenCenterX + ((finalCenterX - screenCenterX) * worldScale);
    const baseCenterY = screenCenterY + ((finalCenterY - screenCenterY) * worldScale);
    const startOffsetX = uiww * (titleCardMenu.ENTRANCE_OFFSET_X_UIWW_RATIO + revealConfig.offsetXRatio);
    const offscreenStartX = Math.max(ww + (layoutRect.w * 0.12), finalCenterX + startOffsetX);
    const offscreenStartY = baseCenterY;
    const centerX = lerpValue(offscreenStartX, baseCenterX, motionEase);
    const centerY = lerpValue(offscreenStartY, baseCenterY, motionEase);
    const radius = Math.max(12, Math.min(width, height) * 0.08);

    return {
        revealProgress,
        revealEase,
        alpha: clampNumber(clampNumber((revealProgress - 0.08) / 0.42, 0, 1), 0, 1),
        hoverProgress,
        panelRect: {
            x: centerX - (width * 0.5),
            y: centerY - (height * 0.5),
            w: width,
            h: height,
            radius
        }
    };
}

/**
 * 하단 보조 메뉴 타일의 렌더 상태를 계산합니다.
 * @param {object} options - 타일 렌더 상태 계산 옵션입니다.
 * @param {object} options.menuItem - 대상 보조 메뉴 항목입니다.
 * @param {number} options.index - 항목 순서입니다.
 * @param {number} options.uiww - UI 기준 너비입니다.
 * @param {number} options.revealCoreDuration - 카드 등장 핵심 구간 길이입니다.
 * @param {Function} options.getRevealProgress - 등장 진행률 계산 함수입니다.
 * @returns {object} 계산된 타일 렌더 상태입니다.
 */
export function buildTitleMenuUtilityTileRenderState({
    menuItem,
    index,
    uiww,
    revealCoreDuration,
    getRevealProgress
}) {
    const utilityPaneEase = getTitleMenuUtilityPaneRevealEase({
        revealCoreDuration,
        getRevealProgress
    });
    const secondaryBaseDelay = Math.min(0.24, revealCoreDuration * 0.26);
    const secondaryStepDelay = Math.min(0.05, revealCoreDuration * 0.08);
    const secondaryDuration = Math.max(0.22, revealCoreDuration * 0.32);
    const itemProgress = getRevealProgress(
        secondaryBaseDelay + (secondaryStepDelay * index),
        secondaryDuration
    );
    const itemEase = easeOutCubic(itemProgress);
    const paneTranslateX = (1 - utilityPaneEase) * (uiww * 0.026);
    const translateX = paneTranslateX + ((1 - itemEase) * Math.min(uiww * 0.014, menuItem.w * 0.28));

    return {
        ...menuItem,
        alpha: itemEase,
        translateX,
        translateY: 0,
        panelRect: {
            x: menuItem.x + translateX,
            y: menuItem.y,
            w: menuItem.w,
            h: menuItem.h,
            radius: menuItem.radius
        }
    };
}

/**
 * 현재 카드 등장 시간축을 기준으로 오른쪽 패널 렌더 상태를 계산합니다.
 * @param {object} options - pane 렌더 상태 계산 옵션입니다.
 * @param {object} options.paneLayout - 최종 패널 배치 정보입니다.
 * @param {number} options.uiww - UI 기준 너비입니다.
 * @param {number} options.revealCoreDuration - 카드 등장 핵심 구간 길이입니다.
 * @param {Function} options.getRevealProgress - 등장 진행률 계산 함수입니다.
 * @returns {{cardPane:object, utilityPane:object}} 렌더용 패널 상태입니다.
 */
export function buildTitleMenuPaneRenderState({
    paneLayout,
    uiww,
    revealCoreDuration,
    getRevealProgress
}) {
    const cardPaneProgress = getRevealProgress(0, Math.max(0.28, revealCoreDuration * 0.54));
    const cardPaneEase = easeOutCubic(cardPaneProgress);
    const utilityPaneEase = getTitleMenuUtilityPaneRevealEase({
        revealCoreDuration,
        getRevealProgress
    });

    return {
        cardPane: _createTitleMenuPaneRenderRect(
            paneLayout.cardPane,
            cardPaneEase,
            uiww * 0.032,
            0
        ),
        utilityPane: _createTitleMenuPaneRenderRect(
            paneLayout.utilityPane,
            utilityPaneEase,
            uiww * 0.026,
            0
        )
    };
}

/**
 * 하단 서브 메뉴 pane과 동기화된 등장 이징 값을 반환합니다.
 * @param {object} options - 등장 이징 계산 옵션입니다.
 * @param {number} options.revealCoreDuration - 카드 등장 핵심 구간 길이입니다.
 * @param {Function} options.getRevealProgress - 등장 진행률 계산 함수입니다.
 * @returns {number} 서브 메뉴 등장 이징 값입니다.
 */
export function getTitleMenuUtilityPaneRevealEase({
    revealCoreDuration,
    getRevealProgress
}) {
    const utilityPaneProgress = getRevealProgress(
        Math.min(0.16, revealCoreDuration * 0.18),
        Math.max(0.24, revealCoreDuration * 0.44)
    );

    return easeOutCubic(utilityPaneProgress);
}

/**
 * 최종 패널 rect를 현재 등장 진행률에 맞는 렌더 rect로 변환합니다.
 * @param {{x:number, y:number, w:number, h:number, radius:number}} layoutRect - 최종 패널 rect입니다.
 * @param {number} revealEase - 패널 등장 이징 결과입니다.
 * @param {number} offsetX - 등장 전 X축 오프셋입니다.
 * @param {number} offsetY - 등장 전 Y축 오프셋입니다.
 * @returns {{x:number, y:number, w:number, h:number, radius:number, alpha:number}} 렌더용 rect입니다.
 */
function _createTitleMenuPaneRenderRect(layoutRect, revealEase, offsetX, offsetY) {
    const clampedEase = clampNumber(revealEase, 0, 1);
    return {
        x: layoutRect.x + ((1 - clampedEase) * offsetX),
        y: layoutRect.y + ((1 - clampedEase) * offsetY),
        w: layoutRect.w,
        h: layoutRect.h,
        radius: layoutRect.radius,
        alpha: clampedEase
    };
}
