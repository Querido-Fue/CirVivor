import { lerpNumber } from 'util/number_util.js';

/**
 * 로딩 원형 UI와 씬 전환 진행률에 맞춘 타이틀 로고 배치를 계산합니다.
 * @param {object} options - 로고 배치 계산 옵션입니다.
 * @param {{centerX:number, centerY:number, radius:number}} options.circleLayout - 중앙 원 레이아웃입니다.
 * @param {number} options.wh - 화면 높이입니다.
 * @param {number} options.uiww - UI 기준 너비입니다.
 * @param {number} options.uiOffsetX - UI 기준 X 오프셋입니다.
 * @param {number} options.sceneTransitionProgress - 씬 전환 진행률입니다.
 * @param {object} options.titleLoading - 타이틀 로딩 상수입니다.
 * @returns {{x:number, width:number, centerY:number}} 로고 배치 정보입니다.
 */
export function buildTitleLoadingLogoPlacement({
    circleLayout,
    wh,
    uiww,
    uiOffsetX,
    sceneTransitionProgress,
    titleLoading
}) {
    const horizontalGap = Math.max(18, wh * 0.025);
    const leftPadding = Math.max(18, uiww * 0.02);
    const availableWidth = Math.max(
        64,
        (circleLayout.centerX - circleLayout.radius) - (uiOffsetX + leftPadding + horizontalGap)
    );
    const preferredWidth = Math.min(uiww * 0.28, circleLayout.radius * 3.15) * 0.8;
    const logoWidth = Math.min(preferredWidth, availableWidth);
    const logoX = Math.max(
        uiOffsetX + leftPadding,
        (circleLayout.centerX - circleLayout.radius) - horizontalGap - logoWidth
    );
    const finalLogoWidth = uiww * titleLoading.LOGO_FINAL_WIDTH_UIWW_RATIO * 0.8;
    const finalLogoX = uiww * titleLoading.LOGO_FINAL_LEFT_UIWW_RATIO;
    const finalLogoCenterY = wh * (titleLoading.LOGO_FINAL_CENTER_Y_RATIO || 0.5);
    const transition = sceneTransitionProgress;

    return {
        x: lerpNumber(logoX, finalLogoX, transition),
        width: lerpNumber(logoWidth, finalLogoWidth, transition),
        centerY: lerpNumber(circleLayout.centerY, finalLogoCenterY, transition)
    };
}
