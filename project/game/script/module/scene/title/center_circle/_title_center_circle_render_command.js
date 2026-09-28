import { EFFECT_TYPES } from 'display/webgl/_webgl_constants.js';
import { getTitleShaderSetting as tuning, tuneTitleShaderColor } from 'display/_title_shader_settings.js';
import { clampFiniteNumber, resolveFiniteNumber } from 'util/number_util.js';
import { TITLE_LOADING_CONSTANTS as TITLE_LOADING } from '../_title_runtime_constants.js';
import { getLoadingCircleShaderColors } from './_title_center_circle_theme.js';

/**
 * titleLoadingCircle effect renderer에 전달할 렌더 명령을 생성합니다.
 * @param {object} state - 중앙 원형 로딩 렌더 상태입니다.
 * @param {number} state.centerX - 원 중심 X 좌표입니다.
 * @param {number} state.centerY - 원 중심 Y 좌표입니다.
 * @param {number} state.radius - 현재 렌더 반경입니다.
 * @param {number} state.outlineWidth - 현재 외곽선 두께입니다.
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
    glowPhase,
    glowCompensationScale,
    blurSourceCanvases
}) {
    const shaderConfig = TITLE_LOADING.CIRCLE_SHADER || {};
    const safeGlowCompensationScale = clampFiniteNumber(glowCompensationScale, 1, Infinity, 1);
    const glowStrength = tuning('glowStrength')
        * (1 + ((safeGlowCompensationScale - 1) * resolveFiniteNumber(shaderConfig.GLOW_COMPENSATION_STRENGTH_SCALE, 0.08)));

    return {
        effectType: EFFECT_TYPES.TITLE_LOADING_CIRCLE,
        x: centerX,
        y: centerY,
        radius,
        outlineWidth: outlineWidth * tuning('outlineScale'),
        time: glowPhase,
        alpha: tuning('alpha'),
        glowStrength,
        glassStrength: tuning('glassStrength'),
        brightnessBoost: tuning('brightnessBoost'),
        bodyRadiusExpandOutlineRatio: tuning('bodyExpand'),
        backdropBlur: tuning('backdropBlur'),
        backdropBlurStrength: tuning('backdropBlend'),
        backdropRefractionStrength: tuning('refraction'),
        scissorPaddingRatio: Math.max(shaderConfig.SCISSOR_PADDING_RADIUS_RATIO,
            tuning('auraFadeEnd') * (tuning('pulseSize') + tuning('pulseSizeAmount'))),
        scissorPaddingMin: resolveFiniteNumber(shaderConfig.SCISSOR_PADDING_MIN_PX, 28),
        blurSourceCanvases: Array.isArray(blurSourceCanvases) ? blurSourceCanvases : [],
        colors: tuneCircleColors(getLoadingCircleShaderColors())
    };
}

function tuneCircleColors(colors) {
    return {
        base: tuneTitleShaderColor(colors.base, 'circle'),
        deep: tuneTitleShaderColor(colors.deep, 'circle'),
        rim: tuneTitleShaderColor(colors.rim, 'circle'),
        highlight: tuneTitleShaderColor(colors.highlight, 'circle')
    };
}
