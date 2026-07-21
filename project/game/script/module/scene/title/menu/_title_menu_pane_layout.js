import { clampNumber } from './_title_menu_motion.js';
import { resolveTitleMenuVerticalStackLayout } from './_title_menu_vertical_layout.js';

/**
 * 오른쪽 glass 패널과 하단 보조 메뉴 배치를 계산합니다.
 * @param {object} options - pane 레이아웃 계산 옵션입니다.
 * @param {Array<object>} options.cards - 카드 목록입니다.
 * @param {Array<object>} options.secondaryMenuEntries - 하단 보조 메뉴 항목입니다.
 * @param {number} options.ww - 화면 너비입니다.
 * @param {number} options.wh - 화면 높이입니다.
 * @param {number} options.uiww - UI 기준 너비입니다.
 * @param {number} options.uiOffsetX - UI 기준 X 오프셋입니다.
 * @param {number} [options.uiScale=1] - 현재 UI 스케일 배율입니다.
 * @param {number} [options.versionBlockHeight=0] - 현재 배율의 버전 블록 높이입니다.
 * @param {number} [options.referenceVersionBlockHeight=versionBlockHeight] - 100% 버전 블록 높이입니다.
 * @param {object} options.titleCardMenu - 타이틀 카드 메뉴 상수입니다.
 * @returns {object} 오른쪽 패널 배치 정보입니다.
 */
export function buildTitleMenuRightPaneLayout({
    cards,
    secondaryMenuEntries,
    ww,
    wh,
    uiww,
    uiOffsetX,
    uiScale = 1,
    versionBlockHeight = 0,
    referenceVersionBlockHeight = versionBlockHeight,
    titleCardMenu
}) {
    const resolvedUiScale = _normalizeTitleMenuUiScale(uiScale);
    const layoutRects = cards
        .map((card) => card.layoutRect)
        .filter(Boolean);

    if (layoutRects.length <= 0) {
        return _buildFallbackTitleMenuRightPaneLayout({
            secondaryMenuEntries,
            ww,
            wh,
            uiww,
            uiOffsetX,
            uiScale: resolvedUiScale,
            versionBlockHeight,
            referenceVersionBlockHeight,
            titleCardMenu
        });
    }

    let groupMinX = Infinity;
    let groupMinY = Infinity;
    let groupMaxX = -Infinity;
    let groupMaxY = -Infinity;

    for (const rect of layoutRects) {
        groupMinX = Math.min(groupMinX, rect.x);
        groupMinY = Math.min(groupMinY, rect.y);
        groupMaxX = Math.max(groupMaxX, rect.x + rect.w);
        groupMaxY = Math.max(groupMaxY, rect.y + rect.h);
    }

    const groupHeight = groupMaxY - groupMinY;
    const groupWidth = groupMaxX - groupMinX;
    const verticalPadding = Math.max(24 * resolvedUiScale, wh * 0.026 * resolvedUiScale);
    const sidePadding = verticalPadding;
    const rightOuterGap = Math.max(28 * resolvedUiScale, uiww * 0.024 * resolvedUiScale);
    const paneRight = ww - rightOuterGap;
    const paneLeft = paneRight - groupWidth - (sidePadding * 2);
    const paneWidth = groupWidth + (sidePadding * 2);
    const cardContentHeight = groupHeight;
    const cardPaneHeight = Math.max(1, cardContentHeight + (verticalPadding * 2));
    const unshiftedUtilityPaneLayout = _buildTitleMenuUtilityPaneLayout({
        secondaryMenuEntries,
        paneRight,
        paneWidth,
        paneTop: 0,
        sidePadding,
        verticalPadding,
        uiww,
        uiOffsetX,
        uiScale: resolvedUiScale,
        titleCardMenu
    });
    const referenceSidePadding = sidePadding / resolvedUiScale;
    const referenceVerticalPadding = verticalPadding / resolvedUiScale;
    const referencePaneRight = ww - Math.max(28, uiww * 0.024);
    const referencePaneWidth = (groupWidth / resolvedUiScale) + (referenceSidePadding * 2);
    const referenceUtilityPaneLayout = _buildTitleMenuUtilityPaneLayout({
        secondaryMenuEntries,
        paneRight: referencePaneRight,
        paneWidth: referencePaneWidth,
        paneTop: 0,
        sidePadding: referenceSidePadding,
        verticalPadding: referenceVerticalPadding,
        uiww,
        uiOffsetX,
        uiScale: 1,
        titleCardMenu
    });
    const verticalLayout = _resolveTitleMenuRightPaneVerticalStack({
        cardPaneHeight,
        utilityPaneHeight: unshiftedUtilityPaneLayout.utilityPane.h,
        referenceCardPaneHeight: cardPaneHeight / resolvedUiScale,
        referenceUtilityPaneHeight: referenceUtilityPaneLayout.utilityPane.h,
        versionBlockHeight,
        referenceVersionBlockHeight,
        wh,
        uiScale: resolvedUiScale,
        titleCardMenu
    });
    const cardPaneTop = verticalLayout.cardPaneTop;
    const cardPaneBottom = cardPaneTop + cardPaneHeight;
    const resolvedCardPaneHeight = Math.max(1, cardPaneBottom - cardPaneTop);
    const cardOffsetX = (paneLeft + sidePadding) - groupMinX;
    const cardOffsetY = (cardPaneTop + verticalPadding) - groupMinY;
    const utilityPaneLayout = _translateTitleMenuUtilityPaneLayout(
        unshiftedUtilityPaneLayout,
        verticalLayout.utilityPaneTop
    );

    return {
        cardPane: {
            x: paneLeft,
            y: cardPaneTop,
            w: paneWidth,
            h: resolvedCardPaneHeight,
            radius: clampNumber(
                Math.min(paneWidth, resolvedCardPaneHeight) * 0.06,
                18 * resolvedUiScale,
                Infinity
            )
        },
        utilityPane: utilityPaneLayout.utilityPane,
        versionLabelTop: verticalLayout.versionTop,
        gapBeforeCard: verticalLayout.gapBeforeCard,
        gapAfterCard: verticalLayout.gapAfterCard,
        cardOffsetX,
        cardOffsetY,
        secondaryMenuItems: utilityPaneLayout.secondaryMenuItems
    };
}

/**
 * 카드 배치가 아직 없을 때 사용할 오른쪽 pane 레이아웃을 계산합니다.
 * @param {object} options - fallback 계산 옵션입니다.
 * @returns {object} fallback pane 배치 정보입니다.
 */
function _buildFallbackTitleMenuRightPaneLayout({
    secondaryMenuEntries,
    ww,
    wh,
    uiww,
    uiOffsetX,
    uiScale = 1,
    versionBlockHeight = 0,
    referenceVersionBlockHeight = versionBlockHeight,
    titleCardMenu
}) {
    const resolvedUiScale = _normalizeTitleMenuUiScale(uiScale);
    const fallbackRightOuterGap = Math.max(28 * resolvedUiScale, uiww * 0.024 * resolvedUiScale);
    const fallbackWidth = uiww * 0.26 * resolvedUiScale;
    const fallbackRight = ww - fallbackRightOuterGap;
    const fallbackLeft = fallbackRight - fallbackWidth;
    const fallbackCardHeight = wh * 0.36 * resolvedUiScale;
    const fallbackVerticalPadding = Math.max(18 * resolvedUiScale, wh * 0.022 * resolvedUiScale);
    const fallbackSidePadding = fallbackVerticalPadding;
    const fallbackUnshiftedUtilityLayout = _buildTitleMenuUtilityPaneLayout({
        secondaryMenuEntries,
        paneRight: fallbackRight,
        paneWidth: fallbackWidth,
        paneTop: 0,
        sidePadding: fallbackSidePadding,
        verticalPadding: fallbackVerticalPadding,
        uiww,
        uiOffsetX,
        uiScale: resolvedUiScale,
        titleCardMenu
    });
    const referenceRightOuterGap = Math.max(28, uiww * 0.024);
    const referencePaneRight = ww - referenceRightOuterGap;
    const referencePaneWidth = uiww * 0.26;
    const referenceVerticalPadding = Math.max(18, wh * 0.022);
    const referenceUtilityLayout = _buildTitleMenuUtilityPaneLayout({
        secondaryMenuEntries,
        paneRight: referencePaneRight,
        paneWidth: referencePaneWidth,
        paneTop: 0,
        sidePadding: referenceVerticalPadding,
        verticalPadding: referenceVerticalPadding,
        uiww,
        uiOffsetX,
        uiScale: 1,
        titleCardMenu
    });
    const fallbackVerticalLayout = _resolveTitleMenuRightPaneVerticalStack({
        cardPaneHeight: fallbackCardHeight,
        utilityPaneHeight: fallbackUnshiftedUtilityLayout.utilityPane.h,
        referenceCardPaneHeight: wh * 0.36,
        referenceUtilityPaneHeight: referenceUtilityLayout.utilityPane.h,
        versionBlockHeight,
        referenceVersionBlockHeight,
        wh,
        uiScale: resolvedUiScale,
        titleCardMenu
    });
    const fallbackUtilityLayout = _translateTitleMenuUtilityPaneLayout(
        fallbackUnshiftedUtilityLayout,
        fallbackVerticalLayout.utilityPaneTop
    );
    const fallbackCardPaneTop = fallbackVerticalLayout.cardPaneTop;

    return {
        cardPane: {
            x: fallbackLeft,
            y: fallbackCardPaneTop,
            w: fallbackWidth,
            h: fallbackCardHeight,
            radius: clampNumber(
                Math.min(fallbackWidth, fallbackCardHeight) * 0.06,
                18 * resolvedUiScale,
                Infinity
            )
        },
        utilityPane: fallbackUtilityLayout.utilityPane,
        versionLabelTop: fallbackVerticalLayout.versionTop,
        gapBeforeCard: fallbackVerticalLayout.gapBeforeCard,
        gapAfterCard: fallbackVerticalLayout.gapAfterCard,
        cardOffsetX: 0,
        cardOffsetY: 0,
        secondaryMenuItems: fallbackUtilityLayout.secondaryMenuItems
    };
}

/**
 * 주 메뉴 pane을 화면 중앙에 두되 전체 오른쪽 메뉴 그룹이 화면 안에 남도록 이동값을 계산합니다.
 * @param {object} options - 이동값 계산 옵션입니다.
 * @param {number} options.cardPaneTop - 기존 주 메뉴 pane 상단 위치입니다.
 * @param {number} options.cardPaneHeight - 주 메뉴 pane 높이입니다.
 * @param {object} options.utilityPane - 하단 유틸리티 pane입니다.
 * @param {number} options.wh - 화면 높이입니다.
 * @param {number} [options.uiScale=1] - 현재 UI 스케일 배율입니다.
 * @returns {number} 주 메뉴와 서브 메뉴에 공통 적용할 Y 이동값입니다.
 */
function _resolveTitleMenuPaneGroupVerticalShift({
    cardPaneTop,
    cardPaneHeight,
    utilityPane,
    wh,
    uiScale = 1
}) {
    const resolvedUiScale = _normalizeTitleMenuUiScale(uiScale);
    const resolvedHeight = Math.max(1, cardPaneHeight);
    const centeredCardPaneTop = (wh - resolvedHeight) * 0.5;
    const preferredShiftY = centeredCardPaneTop - cardPaneTop;
    const utilityPaneTop = Number.isFinite(utilityPane?.y) ? utilityPane.y : cardPaneTop + resolvedHeight;
    const utilityPaneHeight = Math.max(0, Number.isFinite(utilityPane?.h) ? utilityPane.h : 0);
    const groupTop = Math.min(cardPaneTop, utilityPaneTop);
    const groupBottom = Math.max(cardPaneTop + resolvedHeight, utilityPaneTop + utilityPaneHeight);
    const screenMargin = Math.max(8 * resolvedUiScale, wh * 0.018);
    const minShiftY = screenMargin - groupTop;
    const maxShiftY = wh - screenMargin - groupBottom;

    if (minShiftY > maxShiftY) {
        return ((wh - (groupBottom - groupTop)) * 0.5) - groupTop;
    }

    return clampNumber(preferredShiftY, minShiftY, maxShiftY);
}

/**
 * 100%에서 사용하던 배치를 기준선으로 삼아 현재 UI 배율의 공통 세로 스택을 계산합니다.
 * @param {object} options - 공통 세로 스택 계산 옵션입니다.
 * @param {number} options.cardPaneHeight - 현재 주 메뉴 패널 높이입니다.
 * @param {number} options.utilityPaneHeight - 현재 하단 메뉴 패널 높이입니다.
 * @param {number} options.referenceCardPaneHeight - 100% 주 메뉴 패널 높이입니다.
 * @param {number} options.referenceUtilityPaneHeight - 100% 하단 메뉴 패널 높이입니다.
 * @param {number} options.versionBlockHeight - 현재 버전 블록 높이입니다.
 * @param {number} options.referenceVersionBlockHeight - 100% 버전 블록 높이입니다.
 * @param {number} options.wh - 화면 높이입니다.
 * @param {number} options.uiScale - 현재 UI 스케일 배율입니다.
 * @param {object} options.titleCardMenu - 타이틀 카드 메뉴 상수입니다.
 * @returns {{versionTop:number, cardPaneTop:number, utilityPaneTop:number, gapBeforeCard:number, gapAfterCard:number}}
 * 계산된 공통 세로 스택입니다.
 */
function _resolveTitleMenuRightPaneVerticalStack({
    cardPaneHeight,
    utilityPaneHeight,
    referenceCardPaneHeight,
    referenceUtilityPaneHeight,
    versionBlockHeight,
    referenceVersionBlockHeight,
    wh,
    uiScale,
    titleCardMenu
}) {
    const resolvedReferenceCardPaneHeight = Math.max(1, referenceCardPaneHeight);
    const resolvedReferenceUtilityPaneHeight = Math.max(1, referenceUtilityPaneHeight);
    const resolvedReferenceVersionBlockHeight = Math.max(0, referenceVersionBlockHeight);
    const referenceVerticalLayout = _resolveTitleMenuRightPaneVerticalLayout(
        resolvedReferenceCardPaneHeight,
        wh,
        titleCardMenu,
        1
    );
    const referenceShiftY = _resolveTitleMenuPaneGroupVerticalShift({
        cardPaneTop: referenceVerticalLayout.cardPaneTop,
        cardPaneHeight: resolvedReferenceCardPaneHeight,
        utilityPane: {
            y: referenceVerticalLayout.utilityPaneTop,
            h: resolvedReferenceUtilityPaneHeight
        },
        wh,
        uiScale: 1
    });
    const referenceCardPaneTop = referenceVerticalLayout.cardPaneTop + referenceShiftY;
    const referenceUtilityPaneTop = referenceVerticalLayout.utilityPaneTop + referenceShiftY;
    const referenceGap = Math.max(
        0,
        referenceUtilityPaneTop - (referenceCardPaneTop + resolvedReferenceCardPaneHeight)
    );
    const referenceTop = referenceCardPaneTop
        - referenceGap
        - resolvedReferenceVersionBlockHeight;
    const referenceBottom = referenceUtilityPaneTop + resolvedReferenceUtilityPaneHeight;

    return resolveTitleMenuVerticalStackLayout({
        uiScale,
        referenceTop,
        referenceBottom,
        referenceGap,
        versionHeight: versionBlockHeight,
        cardPaneHeight,
        utilityPaneHeight
    });
}

/**
 * 하단 서브 메뉴 레이아웃 전체를 지정한 Y 값만큼 이동합니다.
 * @param {{utilityPane:object, secondaryMenuItems:object[]}} utilityPaneLayout - 이동할 서브 메뉴 배치입니다.
 * @param {number} shiftY - 적용할 Y 이동값입니다.
 * @returns {{utilityPane:object, secondaryMenuItems:object[]}} 이동이 반영된 서브 메뉴 배치입니다.
 */
function _translateTitleMenuUtilityPaneLayout(utilityPaneLayout, shiftY) {
    return {
        utilityPane: {
            ...utilityPaneLayout.utilityPane,
            y: utilityPaneLayout.utilityPane.y + shiftY
        },
        secondaryMenuItems: utilityPaneLayout.secondaryMenuItems.map((menuItem) => ({
            ...menuItem,
            y: menuItem.y + shiftY
        }))
    };
}

/**
 * 오른쪽 상단/하단 글래스 패널의 세로 배치를 계산합니다.
 * @param {number} cardPaneHeight - 상단 카드 패널 높이입니다.
 * @param {number} wh - 화면 높이입니다.
 * @param {object} titleCardMenu - 타이틀 카드 메뉴 상수입니다.
 * @param {number} [uiScale=1] - 현재 UI 스케일 배율입니다.
 * @returns {{cardPaneTop:number, utilityPaneTop:number}} 계산된 세로 배치 정보입니다.
 */
function _resolveTitleMenuRightPaneVerticalLayout(cardPaneHeight, wh, titleCardMenu, uiScale = 1) {
    const resolvedUiScale = _normalizeTitleMenuUiScale(uiScale);
    const paneGroupShiftY = Math.max(10 * resolvedUiScale, wh * 0.014 * resolvedUiScale);
    const cardPaneTop = (wh * 0.22) + paneGroupShiftY;
    const cardPaneBottom = cardPaneTop + Math.max(1, cardPaneHeight);
    const shiftedUtilityPaneTop = (wh * titleCardMenu.UTILITY_PANE_TOP_WH_RATIO) + paneGroupShiftY;
    const gapReduction = Math.max(10 * resolvedUiScale, wh * 0.012 * resolvedUiScale);
    const minimumPaneGap = Math.max(18 * resolvedUiScale, wh * 0.02 * resolvedUiScale);
    const basePaneGap = Math.max(0, shiftedUtilityPaneTop - cardPaneBottom);
    const resolvedPaneGap = Math.max(minimumPaneGap, basePaneGap - gapReduction);

    return {
        cardPaneTop,
        utilityPaneTop: cardPaneBottom + resolvedPaneGap
    };
}

/**
 * 하단 보조 메뉴 타일 패널과 아이템 배치를 계산합니다.
 * @param {object} options - 하단 패널 계산 옵션입니다.
 * @returns {{utilityPane:object, secondaryMenuItems:object[]}} 계산된 하단 패널 레이아웃입니다.
 */
function _buildTitleMenuUtilityPaneLayout({
    secondaryMenuEntries,
    paneRight,
    paneWidth,
    paneTop,
    sidePadding,
    verticalPadding,
    uiww,
    uiOffsetX,
    uiScale = 1,
    titleCardMenu
}) {
    const resolvedUiScale = _normalizeTitleMenuUiScale(uiScale);
    const entryCount = Math.max(1, secondaryMenuEntries.length);
    const tileGap = Math.max(
        10 * resolvedUiScale,
        uiww * titleCardMenu.UTILITY_TILE_GAP_UIWW_RATIO * resolvedUiScale
    );
    const baseContentWidth = Math.max(1, paneWidth - (sidePadding * 2));
    const targetTileSize = Math.max(
        1,
        uiww * titleCardMenu.UTILITY_TILE_TARGET_SIZE_UIWW_RATIO * resolvedUiScale
    );
    const baseTileSize = clampNumber(
        (baseContentWidth - (tileGap * Math.max(0, entryCount - 1))) / entryCount,
        1,
        targetTileSize
    );
    const maxPaneWidth = Math.max(1, paneRight - uiOffsetX);
    const maxTileSize = Math.max(
        1,
        (
            maxPaneWidth
            - (sidePadding * 2)
            - (tileGap * Math.max(0, entryCount - 1))
        ) / entryCount
    );
    const preferredTileSize = Math.max(1, baseTileSize * titleCardMenu.UTILITY_TILE_SCALE);
    const tileSize = clampNumber(preferredTileSize, 1, maxTileSize);
    const utilityPaneWidth = (tileSize * entryCount)
        + (tileGap * Math.max(0, entryCount - 1))
        + (sidePadding * 2);
    const utilityPaneX = paneRight - utilityPaneWidth;
    const contentWidth = Math.max(1, utilityPaneWidth - (sidePadding * 2));
    const utilityPaneHeight = Math.max(1, tileSize + (verticalPadding * 2));
    const utilityPane = {
        x: utilityPaneX,
        y: paneTop,
        w: utilityPaneWidth,
        h: utilityPaneHeight,
        radius: clampNumber(
            Math.min(utilityPaneWidth, utilityPaneHeight) * 0.08,
            18 * resolvedUiScale,
            Infinity
        )
    };
    const tileRowWidth = (tileSize * entryCount) + (tileGap * Math.max(0, entryCount - 1));
    const startX = utilityPaneX + sidePadding + Math.max(0, (contentWidth - tileRowWidth) * 0.5);
    const tileY = paneTop + ((utilityPaneHeight - tileSize) * 0.5);
    const secondaryMenuItems = secondaryMenuEntries.map((entry, index) => ({
        ...entry,
        x: startX + (index * (tileSize + tileGap)),
        y: tileY,
        w: tileSize,
        h: tileSize,
        radius: Math.max(8 * resolvedUiScale, tileSize * titleCardMenu.UTILITY_TILE_CORNER_RADIUS_RATIO),
        placeholderSize: Math.max(12 * resolvedUiScale, tileSize * titleCardMenu.UTILITY_TILE_PLACEHOLDER_SCALE)
    }));

    return {
        utilityPane,
        secondaryMenuItems
    };
}

/**
 * UI 스케일 입력값을 안전한 양수 배율로 정규화합니다.
 * @param {number} uiScale - 원본 UI 스케일 배율입니다.
 * @returns {number} 정규화된 UI 스케일 배율입니다.
 */
function _normalizeTitleMenuUiScale(uiScale) {
    return Number.isFinite(uiScale) && uiScale > 0 ? uiScale : 1;
}
