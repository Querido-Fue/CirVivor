/**
 * UI 배율에 따라 버전·주 메뉴·하단 메뉴의 공통 세로 스택을 계산합니다.
 * 100% 이하에서는 기준 외곽선을 유지하고, 100% 초과에서는 기준 내부 여백을 유지합니다.
 * @param {object} options - 세로 스택 계산 옵션입니다.
 * @param {number} [options.uiScale=1] - 현재 UI 스케일 배율입니다.
 * @param {number} options.referenceTop - 100% 버전 블록 상단 기준선입니다.
 * @param {number} options.referenceBottom - 100% 하단 메뉴 블록 하단 기준선입니다.
 * @param {number} options.referenceGap - 100% 기준 내부 여백입니다.
 * @param {number} options.versionHeight - 현재 배율의 버전 블록 높이입니다.
 * @param {number} options.cardPaneHeight - 현재 배율의 주 메뉴 패널 높이입니다.
 * @param {number} options.utilityPaneHeight - 현재 배율의 하단 메뉴 패널 높이입니다.
 * @returns {{versionTop:number, cardPaneTop:number, utilityPaneTop:number, gapBeforeCard:number, gapAfterCard:number}}
 * 계산된 세로 스택 배치입니다.
 */
export function resolveTitleMenuVerticalStackLayout({
    uiScale = 1,
    referenceTop,
    referenceBottom,
    referenceGap,
    versionHeight,
    cardPaneHeight,
    utilityPaneHeight
}) {
    const resolvedUiScale = _resolvePositiveNumber(uiScale, 1);
    const resolvedReferenceTop = _resolveFiniteNumber(referenceTop, 0);
    const resolvedReferenceBottom = Math.max(
        resolvedReferenceTop,
        _resolveFiniteNumber(referenceBottom, resolvedReferenceTop)
    );
    const resolvedReferenceGap = Math.max(0, _resolveFiniteNumber(referenceGap, 0));
    const resolvedVersionHeight = Math.max(0, _resolveFiniteNumber(versionHeight, 0));
    const resolvedCardPaneHeight = Math.max(0, _resolveFiniteNumber(cardPaneHeight, 0));
    const resolvedUtilityPaneHeight = Math.max(0, _resolveFiniteNumber(utilityPaneHeight, 0));
    const contentHeight = resolvedVersionHeight
        + resolvedCardPaneHeight
        + resolvedUtilityPaneHeight;

    if (resolvedUiScale <= 1) {
        const availableGapHeight = Math.max(
            0,
            resolvedReferenceBottom - resolvedReferenceTop - contentHeight
        );
        const distributedGap = availableGapHeight * 0.5;
        const cardPaneTop = resolvedReferenceTop + resolvedVersionHeight + distributedGap;

        return {
            versionTop: resolvedReferenceTop,
            cardPaneTop,
            utilityPaneTop: cardPaneTop + resolvedCardPaneHeight + distributedGap,
            gapBeforeCard: distributedGap,
            gapAfterCard: distributedGap
        };
    }

    const stackHeight = contentHeight + (resolvedReferenceGap * 2);
    const referenceCenter = (resolvedReferenceTop + resolvedReferenceBottom) * 0.5;
    const versionTop = referenceCenter - (stackHeight * 0.5);
    const cardPaneTop = versionTop + resolvedVersionHeight + resolvedReferenceGap;

    return {
        versionTop,
        cardPaneTop,
        utilityPaneTop: cardPaneTop + resolvedCardPaneHeight + resolvedReferenceGap,
        gapBeforeCard: resolvedReferenceGap,
        gapAfterCard: resolvedReferenceGap
    };
}

/**
 * 유한한 숫자만 사용하고 나머지는 대체값으로 정규화합니다.
 * @param {number} value - 원본 값입니다.
 * @param {number} fallback - 대체값입니다.
 * @returns {number} 정규화된 값입니다.
 * @private
 */
function _resolveFiniteNumber(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
}

/**
 * 양의 유한한 숫자만 사용하고 나머지는 대체값으로 정규화합니다.
 * @param {number} value - 원본 값입니다.
 * @param {number} fallback - 대체값입니다.
 * @returns {number} 정규화된 값입니다.
 * @private
 */
function _resolvePositiveNumber(value, fallback) {
    const resolvedValue = _resolveFiniteNumber(value, fallback);
    return resolvedValue > 0 ? resolvedValue : fallback;
}
