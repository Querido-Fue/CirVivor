import { resolveTypography } from 'ui/style/_typography_resolver.js';

/**
 * 승인된 타이포그래피 토큰을 타이틀 메뉴 렌더 메트릭으로 변환합니다.
 * @param {object} token - `TYPOGRAPHY`에서 발급한 타이포그래피 토큰입니다.
 * @param {number} uiww - UI 기준 너비입니다.
 * @param {number} [uiScale=1] - 현재 UI 스케일 배율입니다.
 * @param {object} [options={}] - fluid 타이포그래피 계산 문맥입니다.
 * @param {number} [options.containerWidth=0] - 카드 컨테이너 너비입니다.
 * @param {number} [options.containerHeight=0] - 카드 컨테이너 높이입니다.
 * @param {string} [options.variant] - 카드 레이아웃 변형입니다.
 * @returns {{font:string,size:number,lineHeight:number,weight:number,family:string}} 렌더 메트릭입니다.
 */
export function resolveTitleMenuTypography(
    token,
    uiww,
    uiScale = 1,
    options = {}
) {
    return resolveTypography(token, {
        ...options,
        uiWidth: uiww,
        uiScale: _normalizeTitleMenuUiScale(uiScale)
    });
}

/**
 * UI 스케일 입력값을 안전한 양수 배율로 정규화합니다.
 * @param {number} uiScale - 원본 UI 스케일 배율입니다.
 * @returns {number} 정규화된 UI 스케일 배율입니다.
 */
function _normalizeTitleMenuUiScale(uiScale) {
    return Number.isFinite(uiScale) && uiScale > 0 ? uiScale : 1;
}
