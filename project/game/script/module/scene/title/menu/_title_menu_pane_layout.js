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
    const verticalLayout = _resolveTitleMenuRightPaneVerticalLayout(
        cardPaneHeight,
        wh,
        titleCardMenu,
        resolvedUiScale
    );
    const unshiftedUtilityPaneLayout = _buildTitleMenuUtilityPaneLayout({
        secondaryMenuEntries,
        paneRight,
        paneWidth,
        paneTop: verticalLayout.utilityPaneTop,
        sidePadding,
        verticalPadding,
        uiww,
        uiOffsetX,
        uiScale: resolvedUiScale,
        titleCardMenu
    });
    const paneShiftY = _resolveTitleMenuPaneGroupVerticalShift({
        cardPaneTop: verticalLayout.cardPaneTop,
        cardPaneHeight,
        utilityPane: unshiftedUtilityPaneLayout.utilityPane,
        wh,
        uiScale: resolvedUiScale
    });
    const cardPaneTop = verticalLayout.cardPaneTop + paneShiftY;
    const cardPaneBottom = cardPaneTop + cardPaneHeight;
    const cardOffsetX = (paneLeft + sidePadding) - groupMinX;
    const cardOffsetY = (cardPaneTop + verticalPadding) - groupMinY;
    const utilityPaneLayout = _translateTitleMenuUtilityPaneLayout(
        unshiftedUtilityPaneLayout,
        paneShiftY
    );

    return {
        cardPane: {
            x: paneLeft,
            y: cardPaneTop,
            w: paneWidth,
            h: Math.max(1, cardPaneBottom - cardPaneTop),
            radius: Math.max(
                18 * resolvedUiScale,
                Math.min(paneWidth, Math.max(1, cardPaneBottom - cardPaneTop)) * 0.06
            )
        },
        utilityPane: utilityPaneLayout.utilityPane,
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
    const fallbackVerticalLayout = _resolveTitleMenuRightPaneVerticalLayout(
        fallbackCardHeight,
        wh,
        titleCardMenu,
        resolvedUiScale
    );
    const fallbackUnshiftedUtilityLayout = _buildTitleMenuUtilityPaneLayout({
        secondaryMenuEntries,
        paneRight: fallbackRight,
        paneWidth: fallbackWidth,
        paneTop: fallbackVerticalLayout.utilityPaneTop,
        sidePadding: fallbackSidePadding,
        verticalPadding: fallbackVerticalPadding,
        uiww,
        uiOffsetX,
        uiScale: resolvedUiScale,
        titleCardMenu
    });
    const fallbackShiftY = _resolveTitleMenuPaneGroupVerticalShift({
        cardPaneTop: fallbackVerticalLayout.cardPaneTop,
        cardPaneHeight: fallbackCardHeight,
        utilityPane: fallbackUnshiftedUtilityLayout.utilityPane,
        wh,
        uiScale: resolvedUiScale
    });
    const fallbackUtilityLayout = _translateTitleMenuUtilityPaneLayout(
        fallbackUnshiftedUtilityLayout,
        fallbackShiftY
    );
    const fallbackCardPaneTop = fallbackVerticalLayout.cardPaneTop + fallbackShiftY;

    return {
        cardPane: {
            x: fallbackLeft,
            y: fallbackCardPaneTop,
            w: fallbackWidth,
            h: fallbackCardHeight,
            radius: Math.max(18 * resolvedUiScale, Math.min(fallbackWidth, fallbackCardHeight) * 0.06)
        },
        utilityPane: fallbackUtilityLayout.utilityPane,
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

    return Math.max(minShiftY, Math.min(maxShiftY, preferredShiftY));
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
    const baseTileSize = Math.max(
        1,
        Math.min(
            targetTileSize,
            (baseContentWidth - (tileGap * Math.max(0, entryCount - 1))) / entryCount
        )
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
    const tileSize = Math.min(preferredTileSize, maxTileSize);
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
        radius: Math.max(18 * resolvedUiScale, Math.min(utilityPaneWidth, utilityPaneHeight) * 0.08)
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
