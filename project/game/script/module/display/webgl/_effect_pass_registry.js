import { HexaMergeBoundaryEffectPass } from './_hexa_merge_boundary_effect_pass.js';
import { MagneticShieldEffectPass } from './_magnetic_shield_effect_pass.js';
import { TitleLoadingCircleEffectPass } from './_title_loading_circle_effect_pass.js';
import { EFFECT_TYPES } from './_webgl_constants.js';

/**
 * effect 레이어에서 사용할 fresh pass 목록을 생성합니다.
 * 세 pass의 생성자를 즉시 실행해 각 pass의 GL 프로그램과 fullscreen 버퍼를 준비합니다.
 * @param {WebGLRenderingContext} gl - 대상 WebGL 컨텍스트입니다.
 * @returns {Map<string, {draw:function(object, number, number):void, destroy:function():void}>} effect type별 명령형 pass 맵입니다.
 */
export function createEffectPassRegistry(gl) {
    return new Map([
        [EFFECT_TYPES.MAGNETIC_SHIELD, new MagneticShieldEffectPass(gl)],
        [EFFECT_TYPES.HEXA_MERGE_BOUNDARY, new HexaMergeBoundaryEffectPass(gl)],
        [EFFECT_TYPES.TITLE_LOADING_CIRCLE, new TitleLoadingCircleEffectPass(gl)]
    ]);
}
