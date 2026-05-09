import { MagneticShieldEffectPass } from './_magnetic_shield_effect_pass.js';
import { TitleLoadingCircleEffectPass } from './_title_loading_circle_effect_pass.js';

/**
 * effect 레이어에서 사용할 pass 목록을 생성합니다.
 * @param {WebGLRenderingContext} gl - 대상 WebGL 컨텍스트입니다.
 * @returns {Map<string, object>} effect type별 pass 맵입니다.
 */
export function createEffectPassRegistry(gl) {
    return new Map([
        ['magneticShield', new MagneticShieldEffectPass(gl)],
        ['titleLoadingCircle', new TitleLoadingCircleEffectPass(gl)]
    ]);
}
