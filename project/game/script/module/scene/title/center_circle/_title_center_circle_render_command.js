import { getData } from 'data/data_handler.js';
import { getLoadingCircleShaderColors } from './_title_center_circle_theme.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');
const TITLE_LOADING = TITLE_CONSTANTS.TITLE_LOADING;

/**
 * titleLoadingCircle effect renderer에 전달할 렌더 명령을 생성합니다.
 * @param {object} state - 중앙 원형 로딩 렌더 상태입니다.
 * @param {number} state.centerX - 원 중심 X 좌표입니다.
 * @param {number} state.centerY - 원 중심 Y 좌표입니다.
 * @param {number} state.radius - 현재 렌더 반경입니다.
 * @param {number} state.outlineWidth - 현재 외곽선 두께입니다.
 * @param {number} state.progress - 현재 로딩 진행률입니다.
 * @param {number} state.wavePhase - 기본 파도 위상입니다.
 * @param {number} state.secondaryWavePhase - 보조 파도 위상입니다.
 * @param {number} state.glowPhase - glow 펄스 위상입니다.
 * @param {number} state.glowCompensationScale - glow 보정 배율입니다.
 * @param {HTMLCanvasElement[]} state.blurSourceCanvases - blur 샘플링에 사용할 하위 레이어 캔버스 목록입니다.
 * @returns {object} effect 레이어 렌더 명령입니다.
 */
export function buildTitleCenterCircleRenderCommand({
    centerX,
    centerY,
    radius,
    outlineWidth,
    progress,
    wavePhase,
    secondaryWavePhase,
    glowPhase,
    glowCompensationScale,
    blurSourceCanvases
}) {
    const shaderConfig = TITLE_LOADING.CIRCLE_SHADER || {};
    const safeGlowCompensationScale = Number.isFinite(glowCompensationScale)
        ? Math.max(1, glowCompensationScale)
        : 1;
    const glowStrength = _resolveShaderNumber(shaderConfig.GLOW_STRENGTH, 0.24)
        * (1 + ((safeGlowCompensationScale - 1) * _resolveShaderNumber(shaderConfig.GLOW_COMPENSATION_STRENGTH_SCALE, 0.08)));

    return {
        effectType: 'titleLoadingCircle',
        x: centerX,
        y: centerY,
        radius,
        outlineWidth,
        progress,
        wavePhase,
        secondaryWavePhase,
        time: glowPhase,
        alpha: _resolveShaderNumber(shaderConfig.ALPHA, 1),
        glowStrength,
        glassStrength: _resolveShaderNumber(shaderConfig.GLASS_STRENGTH, 0.72),
        brightnessBoost: _resolveShaderNumber(shaderConfig.BRIGHTNESS_BOOST, 0.08),
        bodyRadiusExpandOutlineRatio: _resolveShaderNumber(shaderConfig.BODY_RADIUS_EXPAND_OUTLINE_RATIO, 0.38),
        backdropBlur: _resolveShaderNumber(shaderConfig.BACKDROP_BLUR, 0.1),
        backdropBlurStrength: _resolveShaderNumber(shaderConfig.BACKDROP_BLUR_STRENGTH, 0.16),
        backdropRefractionStrength: _resolveShaderNumber(shaderConfig.BACKDROP_REFRACTION_STRENGTH, 4.5),
        scissorPaddingRatio: _resolveShaderNumber(shaderConfig.SCISSOR_PADDING_RADIUS_RATIO, 0.86),
        scissorPaddingMin: _resolveShaderNumber(shaderConfig.SCISSOR_PADDING_MIN_PX, 28),
        blurSourceCanvases: Array.isArray(blurSourceCanvases) ? blurSourceCanvases : [],
        colors: getLoadingCircleShaderColors()
    };
}

/**
 * 셰이더 설정 숫자를 안전하게 해석합니다.
 * @param {number|null|undefined} value - 설정값입니다.
 * @param {number} fallback - 대체값입니다.
 * @returns {number} 사용할 숫자입니다.
 */
function _resolveShaderNumber(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
}
