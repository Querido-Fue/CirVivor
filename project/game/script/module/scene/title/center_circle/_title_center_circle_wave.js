import { clampNumber } from 'util/number_util.js';

const WAVE_SEGMENT_COUNT = 30;

/**
 * 진행률에 맞는 파도 형태의 내부 fill 경로를 계산합니다.
 * @param {object} options - fill 경로 생성 옵션입니다.
 * @param {number} options.centerX - 원 중심 X 좌표입니다.
 * @param {number} options.centerY - 원 중심 Y 좌표입니다.
 * @param {number} options.innerRadius - 내부 채움 반경입니다.
 * @param {number} options.progress - 현재 로딩 진행률입니다.
 * @param {number} options.wavePhase - 기본 파도 위상입니다.
 * @param {number} options.secondaryWavePhase - 보조 파도 위상입니다.
 * @returns {{path: Path2D, surfacePoints: Array<{x:number, y:number}>}} fill 경로와 표면 포인트입니다.
 */
export function buildCenterCircleFillData({
    centerX,
    centerY,
    innerRadius,
    progress,
    wavePhase,
    secondaryWavePhase
}) {
    const fillBottomY = centerY + innerRadius;
    const fillHeight = (innerRadius * 2) * progress;
    const fillTopBaseY = fillBottomY - fillHeight;
    const amplitudeLimit = innerRadius * 0.06;
    const minimumAmplitude = Math.min(1.5, amplitudeLimit);
    const amplitude = progress >= 1
        ? 0
        : clampNumber(fillHeight * 0.2, minimumAmplitude, amplitudeLimit);
    const leftX = centerX - innerRadius - (amplitude * 2);
    const rightX = centerX + innerRadius + (amplitude * 2);
    const path = new Path2D();
    const surfacePoints = [];

    path.moveTo(leftX, fillBottomY + innerRadius);
    path.lineTo(leftX, fillTopBaseY);

    for (let i = 0; i <= WAVE_SEGMENT_COUNT; i++) {
        const t = i / WAVE_SEGMENT_COUNT;
        const x = leftX + ((rightX - leftX) * t);
        const y = getCenterCircleWaveY(t, fillTopBaseY, amplitude, wavePhase, secondaryWavePhase);
        surfacePoints.push({ x, y });
        path.lineTo(x, y);
    }

    path.lineTo(rightX, fillBottomY + innerRadius);
    path.closePath();

    return { path, surfacePoints };
}

/**
 * 특정 정규화 위치에서 파도 표면의 y 좌표를 계산합니다.
 * @param {number} normalizedX - 0~1 범위의 정규화 x 값입니다.
 * @param {number} baseY - 표면 기준 y 값입니다.
 * @param {number} amplitude - 파도 진폭입니다.
 * @param {number} wavePhase - 기본 파도 위상입니다.
 * @param {number} secondaryWavePhase - 보조 파도 위상입니다.
 * @returns {number} 계산된 y 값입니다.
 */
export function getCenterCircleWaveY(normalizedX, baseY, amplitude, wavePhase, secondaryWavePhase) {
    const primary = Math.sin((normalizedX * Math.PI * 2.2) + wavePhase) * amplitude;
    const secondary = Math.sin((normalizedX * Math.PI * 5.2) - secondaryWavePhase) * (amplitude * 0.32);
    return baseY + primary + secondary;
}
