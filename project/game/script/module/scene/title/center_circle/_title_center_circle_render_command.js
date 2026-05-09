import { getData } from 'data/data_handler.js';
import { clampFiniteNumber, resolveFiniteNumber } from 'util/number_util.js';
import { getLoadingCircleShaderColors } from './_title_center_circle_theme.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');
const TITLE_LOADING = TITLE_CONSTANTS.TITLE_LOADING;
const EFFECT_TYPES = getData('EFFECT_RENDER_CONSTANTS').TYPES;

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
    const safeGlowCompensationScale = clampFiniteNumber(glowCompensationScale, 1, Infinity, 1);
    const glowStrength = resolveFiniteNumber(shaderConfig.GLOW_STRENGTH, 0.24)
        * (1 + ((safeGlowCompensationScale - 1) * resolveFiniteNumber(shaderConfig.GLOW_COMPENSATION_STRENGTH_SCALE, 0.08)));

    return {
        effectType: EFFECT_TYPES.TITLE_LOADING_CIRCLE,
        x: centerX,
        y: centerY,
        radius,
        outlineWidth,
        progress,
        wavePhase,
        secondaryWavePhase,
        time: glowPhase,
        alpha: resolveFiniteNumber(shaderConfig.ALPHA, 1),
        glowStrength,
        glassStrength: resolveFiniteNumber(shaderConfig.GLASS_STRENGTH, 0.72),
        brightnessBoost: resolveFiniteNumber(shaderConfig.BRIGHTNESS_BOOST, 0.08),
        bodyRadiusExpandOutlineRatio: resolveFiniteNumber(shaderConfig.BODY_RADIUS_EXPAND_OUTLINE_RATIO, 0.38),
        backdropBlur: resolveFiniteNumber(shaderConfig.BACKDROP_BLUR, 0.1),
        backdropBlurStrength: resolveFiniteNumber(shaderConfig.BACKDROP_BLUR_STRENGTH, 0.16),
        backdropRefractionStrength: resolveFiniteNumber(shaderConfig.BACKDROP_REFRACTION_STRENGTH, 4.5),
        scissorPaddingRatio: resolveFiniteNumber(shaderConfig.SCISSOR_PADDING_RADIUS_RATIO, 0.86),
        scissorPaddingMin: resolveFiniteNumber(shaderConfig.SCISSOR_PADDING_MIN_PX, 28),
        blurSourceCanvases: Array.isArray(blurSourceCanvases) ? blurSourceCanvases : [],
        colors: getLoadingCircleShaderColors()
    };
}
