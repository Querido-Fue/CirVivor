import { clamp } from './_title_magic_bento_motion.js';

/**
 * 타이틀 bento 카드 레이아웃을 계산하고 카드 런타임 좌표를 갱신합니다.
 * @param {object[]} cards - 런타임 카드 목록
 * @param {object} viewport - 현재 뷰포트 값입니다.
 * @param {number} viewport.ww - 화면 너비입니다.
 * @param {number} viewport.wh - 화면 높이입니다.
 * @param {number} viewport.uiww - UI 기준 너비입니다.
 * @param {number} viewport.uiOffsetX - UI 기준 X 오프셋입니다.
 * @param {object} titleMagicBento - 타이틀 bento 설정입니다.
 * @param {object} titleLoading - 타이틀 로딩 레이아웃 설정입니다.
 * @returns {{groupBounds:{x:number, y:number, w:number, h:number}, spotlightX:number, spotlightY:number}} 레이아웃 결과입니다.
 */
export function recalculateBentoCardLayout(cards, {
    ww,
    wh,
    uiww,
    uiOffsetX
}, titleMagicBento, titleLoading) {
    const baseGroupWidth = clamp(
        uiww * titleMagicBento.GROUP_WIDTH_UIWW_RATIO,
        titleMagicBento.GROUP_MIN_WIDTH,
        titleMagicBento.GROUP_MAX_WIDTH
    );
    const gap = Math.max(titleMagicBento.CARD_GAP_MIN, uiww * titleMagicBento.CARD_GAP_UIWW_RATIO);
    const baseAvailableWidth = baseGroupWidth - gap;
    const playHeightFactor = 1.12 * (0.68 + 0.2);
    const baseRightWidth = Math.max(
        baseAvailableWidth * 0.42,
        (baseAvailableWidth - (gap * 1.12)) / (1 + playHeightFactor)
    );
    const leftWidth = baseAvailableWidth - baseRightWidth;
    const rightWidth = baseRightWidth * titleMagicBento.RIGHT_COLUMN_WIDTH_SCALE;
    const recordsHeight = (baseRightWidth * 0.2) * titleMagicBento.RECORDS_HEIGHT_SCALE;
    const quickHeight = Math.max(0, leftWidth - gap - recordsHeight);
    const bottomHeight = baseRightWidth * 0.62;
    const mainHeight = leftWidth;
    const groupWidth = leftWidth + gap + rightWidth;
    const groupHeight = mainHeight + gap + bottomHeight;
    const logoLeftMargin = uiww * titleLoading.LOGO_FINAL_LEFT_UIWW_RATIO;
    const logoTopMargin = wh * titleLoading.LOGO_FINAL_TOP_WH_RATIO;
    const groupX = uiOffsetX + uiww - logoLeftMargin - groupWidth;
    const groupY = wh - logoTopMargin - groupHeight;
    const layoutMap = createBentoCardLayoutMap(
        groupX,
        groupY,
        leftWidth,
        rightWidth,
        mainHeight,
        bottomHeight,
        recordsHeight,
        quickHeight,
        gap
    );

    applyBentoCardLayout(cards, layoutMap, {
        ww,
        wh,
        uiww,
        titleMagicBento
    });

    return {
        groupBounds: {
            x: groupX,
            y: groupY,
            w: groupWidth,
            h: groupHeight
        },
        spotlightX: groupX + (groupWidth * 0.5),
        spotlightY: groupY + (groupHeight * 0.5)
    };
}

/**
 * 카드 ID별 기본 사각형 배치를 생성합니다.
 * @param {number} groupX - 그룹 X 좌표
 * @param {number} groupY - 그룹 Y 좌표
 * @param {number} leftWidth - 왼쪽 열 너비
 * @param {number} rightWidth - 오른쪽 열 너비
 * @param {number} mainHeight - 메인 카드 높이
 * @param {number} bottomHeight - 하단 카드 높이
 * @param {number} recordsHeight - 기록 카드 높이
 * @param {number} quickHeight - 빠른 시작 카드 높이
 * @param {number} gap - 카드 간격
 * @returns {object} 카드 ID별 사각형 배치입니다.
 */
function createBentoCardLayoutMap(
    groupX,
    groupY,
    leftWidth,
    rightWidth,
    mainHeight,
    bottomHeight,
    recordsHeight,
    quickHeight,
    gap
) {
    return {
        play: {
            x: groupX,
            y: groupY,
            w: leftWidth,
            h: mainHeight
        },
        quick: {
            x: groupX + leftWidth + gap,
            y: groupY,
            w: rightWidth,
            h: quickHeight
        },
        records: {
            x: groupX + leftWidth + gap,
            y: groupY + quickHeight + gap,
            w: rightWidth,
            h: recordsHeight
        },
        deck: {
            x: groupX,
            y: groupY + mainHeight + gap,
            w: leftWidth,
            h: bottomHeight
        },
        research: {
            x: groupX + leftWidth + gap,
            y: groupY + quickHeight + gap + recordsHeight + gap,
            w: rightWidth,
            h: bottomHeight
        }
    };
}

/**
 * 계산된 사각형 배치를 카드 런타임 상태에 반영합니다.
 * @param {object[]} cards - 런타임 카드 목록
 * @param {object} layoutMap - 카드 ID별 사각형 배치입니다.
 * @param {object} options - 배치 반영 옵션입니다.
 * @param {number} options.ww - 화면 너비입니다.
 * @param {number} options.wh - 화면 높이입니다.
 * @param {number} options.uiww - UI 기준 너비입니다.
 * @param {object} options.titleMagicBento - 타이틀 bento 설정입니다.
 */
function applyBentoCardLayout(cards, layoutMap, {
    ww,
    wh,
    uiww,
    titleMagicBento
}) {
    for (const card of cards) {
        const layout = layoutMap[card.id];
        if (!layout) {
            continue;
        }

        card.baseWidth = layout.w;
        card.baseHeight = layout.h;
        card.finalCenterX = layout.x + (layout.w * 0.5);
        card.finalCenterY = layout.y + (layout.h * 0.5);

        const startOffsetX = uiww * (titleMagicBento.ENTRANCE_OFFSET_X_UIWW_RATIO + card.entranceOffsetXRatio);
        const startOffsetY = wh * (titleMagicBento.ENTRANCE_OFFSET_Y_WH_RATIO + card.entranceOffsetYRatio);
        card.startCenterX = Math.max(ww + (layout.w * 0.12), card.finalCenterX + startOffsetX);
        card.startCenterY = card.finalCenterY + startOffsetY;

        for (const particle of card.particles) {
            particle.localX = clamp(particle.localX, 0, layout.w);
            particle.localY = clamp(particle.localY, 0, layout.h);
        }
        for (const ripple of card.ripples) {
            ripple.localX = clamp(ripple.localX, 0, layout.w);
            ripple.localY = clamp(ripple.localY, 0, layout.h);
        }
    }
}
