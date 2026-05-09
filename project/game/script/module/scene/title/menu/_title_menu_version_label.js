import { getLangString } from 'ui/ui_system.js';
import { resolveFiniteNumber } from 'util/number_util.js';

/**
 * 전역 상수에 정의된 게임 버전 문자열을 표시 형식으로 반환합니다.
 * @param {object} globalConstants - 전역 상수 객체입니다.
 * @returns {string} 렌더링할 버전 문자열입니다.
 */
export function getTitleMenuGameVersionText(globalConstants) {
    const rawVersion = String(globalConstants?.GAME_VERSION || '').trim();
    if (!rawVersion) {
        return '';
    }

    return `ver ${rawVersion}`;
}

/**
 * 버전 라벨 아래에 표시할 업데이트 링크 문자열을 반환합니다.
 * @returns {string} 렌더링할 업데이트 링크 문자열입니다.
 */
export function getTitleMenuVersionHistoryLinkText() {
    return String(getLangString('title_version_history_link') || '').trim();
}

/**
 * 버전 정보 블록의 텍스트, 폰트, hitbox를 계산합니다.
 * @param {object} options - 버전 정보 레이아웃 옵션입니다.
 * @param {object|null} [options.paneLayout=null] - 현재 오른쪽 패널 배치 정보입니다.
 * @param {number} options.uiww - UI 기준 너비입니다.
 * @param {number} options.wh - 화면 높이입니다.
 * @param {number} options.uiOffsetX - UI 기준 X 오프셋입니다.
 * @param {number} [options.uiScale=1] - 현재 UI 스케일 배율입니다.
 * @param {number} options.utilityPaneRevealEase - 하단 서브 메뉴 등장 이징 값입니다.
 * @param {string} options.versionText - 버전 텍스트입니다.
 * @param {string} options.versionFont - 버전 텍스트 폰트입니다.
 * @param {number} options.versionFontSize - 버전 텍스트 폰트 크기입니다.
 * @param {string} options.linkText - 업데이트 링크 텍스트입니다.
 * @param {string} options.linkFont - 업데이트 링크 폰트입니다.
 * @param {number} options.linkFontSize - 업데이트 링크 폰트 크기입니다.
 * @param {number} options.linkTextWidth - 업데이트 링크 텍스트 폭입니다.
 * @returns {object|null} 버전 정보 블록 렌더 레이아웃입니다.
 */
export function buildTitleMenuVersionLabelLayout({
    paneLayout = null,
    uiww,
    wh,
    uiOffsetX,
    uiScale = 1,
    utilityPaneRevealEase,
    versionText,
    versionFont,
    versionFontSize,
    linkText,
    linkFont,
    linkFontSize,
    linkTextWidth
}) {
    if (!versionText) {
        return null;
    }

    const resolvedUiScale = _normalizeTitleMenuUiScale(uiScale);
    const lineGap = Math.max(4 * resolvedUiScale, wh * 0.005 * resolvedUiScale);
    const blockHeight = versionFontSize + (linkText ? linkFontSize + lineGap : 0);
    const renderState = buildTitleMenuVersionLabelRenderState({
        paneLayout,
        blockHeight,
        utilityPaneRevealEase,
        uiww,
        wh,
        uiOffsetX,
        uiScale: resolvedUiScale
    });
    const linkY = renderState.y + versionFontSize + lineGap;
    const linkIconSize = linkText ? Math.max(10 * resolvedUiScale, linkFontSize * 0.9504) : 0;
    const linkIconGap = linkText ? Math.max(4 * resolvedUiScale, uiww * 0.0034 * resolvedUiScale) : 0;
    const linkBlockWidth = linkText ? linkIconSize + linkIconGap + linkTextWidth : 0;
    const linkTextX = renderState.x;
    const linkIconX = linkTextX - linkTextWidth - linkIconGap - linkIconSize;
    const linkIconY = linkY + ((linkFontSize - linkIconSize) * 0.5);
    const hitPaddingX = Math.max(6 * resolvedUiScale, uiww * 0.004 * resolvedUiScale);
    const hitPaddingY = Math.max(4 * resolvedUiScale, wh * 0.004 * resolvedUiScale);

    return {
        alpha: renderState.alpha,
        versionText,
        versionFont,
        versionX: renderState.x,
        versionY: renderState.y,
        linkText,
        linkFont,
        linkTextX,
        linkY,
        linkIconX,
        linkIconY,
        linkIconSize,
        linkBounds: linkText
            ? {
                x: renderState.x - linkBlockWidth - hitPaddingX,
                y: linkY - hitPaddingY,
                w: linkBlockWidth + (hitPaddingX * 2),
                h: linkFontSize + (hitPaddingY * 2)
            }
            : null
    };
}

/**
 * 버전 라벨의 등장 애니메이션 상태를 계산합니다.
 * @param {object} options - 렌더 상태 계산 옵션입니다.
 * @param {object|null} [options.paneLayout=null] - 현재 오른쪽 패널 배치 정보입니다.
 * @param {number} [options.blockHeight=0] - 버전 정보 블록 전체 높이입니다.
 * @param {number} options.utilityPaneRevealEase - 하단 서브 메뉴 등장 이징 값입니다.
 * @param {number} options.uiww - UI 기준 너비입니다.
 * @param {number} options.wh - 화면 높이입니다.
 * @param {number} options.uiOffsetX - UI 기준 X 오프셋입니다.
 * @param {number} [options.uiScale=1] - 현재 UI 스케일 배율입니다.
 * @returns {{x:number, y:number, alpha:number}} 렌더링에 사용할 버전 라벨 상태입니다.
 */
export function buildTitleMenuVersionLabelRenderState({
    paneLayout = null,
    blockHeight = 0,
    utilityPaneRevealEase,
    uiww,
    wh,
    uiOffsetX,
    uiScale = 1
}) {
    const safeAreaAnchor = resolveTitleMenuVersionLabelSafeArea({
        paneLayout,
        blockHeight,
        uiww,
        wh,
        uiOffsetX,
        uiScale
    });
    const resolvedUiScale = _normalizeTitleMenuUiScale(uiScale);

    return {
        x: safeAreaAnchor.x + ((1 - utilityPaneRevealEase) * (uiww * 0.026 * resolvedUiScale)),
        y: safeAreaAnchor.y,
        alpha: utilityPaneRevealEase
    };
}

/**
 * 하단 서브 메뉴와 동일한 안전 영역 감각을 갖도록 버전 라벨 기준점을 계산합니다.
 * @param {object} options - 안전 영역 계산 옵션입니다.
 * @param {object|null} [options.paneLayout=null] - 현재 오른쪽 패널 배치 정보입니다.
 * @param {number} [options.blockHeight=0] - 버전 정보 블록 전체 높이입니다.
 * @param {number} options.uiww - UI 기준 너비입니다.
 * @param {number} options.wh - 화면 높이입니다.
 * @param {number} options.uiOffsetX - UI 기준 X 오프셋입니다.
 * @param {number} [options.uiScale=1] - 현재 UI 스케일 배율입니다.
 * @returns {{x:number, y:number}} 버전 라벨 우상단 기준점입니다.
 */
export function resolveTitleMenuVersionLabelSafeArea({
    paneLayout = null,
    blockHeight = 0,
    uiww,
    wh,
    uiOffsetX,
    uiScale = 1
}) {
    const resolvedUiScale = _normalizeTitleMenuUiScale(uiScale);
    const utilityPane = paneLayout?.utilityPane || null;
    const cardPane = paneLayout?.cardPane || null;
    const resolvedBlockHeight = Math.max(0, blockHeight);
    if (!utilityPane || !cardPane) {
        const verticalOffset = wh * (100 / 1440) * resolvedUiScale;
        return {
            x: uiOffsetX + uiww - Math.max(18 * resolvedUiScale, uiww * 0.024 * resolvedUiScale),
            y: Math.max(14 * resolvedUiScale, wh * 0.022 * resolvedUiScale) + verticalOffset
        };
    }

    const paneGap = Math.max(0, utilityPane.y - (cardPane.y + cardPane.h));
    const blockBottomY = cardPane.y - paneGap;
    return {
        x: utilityPane.x + utilityPane.w,
        y: blockBottomY - resolvedBlockHeight
    };
}

/**
 * UI 스케일 입력값을 안전한 양수 배율로 정규화합니다.
 * @param {number} uiScale - 원본 UI 스케일 배율입니다.
 * @returns {number} 정규화된 UI 스케일 배율입니다.
 */
function _normalizeTitleMenuUiScale(uiScale) {
    const safeUiScale = resolveFiniteNumber(uiScale, 1);
    return safeUiScale > 0 ? safeUiScale : 1;
}
