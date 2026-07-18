import { clampFiniteNumber } from 'util/number_util.js';

/**
 * overlay UI/effect surface에 적용할 CSS scale/blur 스타일을 계산합니다.
 * @param {number} contentScale - 일반 overlay 콘텐츠 배율입니다.
 * @param {number} scaleOriginXRatio - 일반 배율 X 원점입니다.
 * @param {number} scaleOriginYRatio - 일반 배율 Y 원점입니다.
 * @param {number} contentBlur - 콘텐츠 blur 반경입니다.
 * @param {object|null} [out=null] - 재사용할 출력 객체입니다.
 * @returns {{transformOrigin:string,uiTransform:string,effectTransform:string,uiFilter:string,effectFilter:string}} surface 스타일입니다.
 */
export function resolveOverlayContentSurfaceStyles(
    contentScale,
    scaleOriginXRatio,
    scaleOriginYRatio,
    contentBlur,
    out = null
) {
    const result = out && typeof out === 'object'
        ? out
        : {
            transformOrigin: '',
            uiTransform: 'none',
            effectTransform: 'none',
            uiFilter: 'none',
            effectFilter: 'none'
        };
    const scale = clampFiniteNumber(contentScale, 0.01, 4, 1);
    const originX = clampFiniteNumber(scaleOriginXRatio, 0, 1, 0.5);
    const originY = clampFiniteNumber(scaleOriginYRatio, 0, 1, 0.5);
    const blur = clampFiniteNumber(contentBlur, 0, 100, 0);
    const filter = blur <= 0.0001 ? 'none' : `blur(${blur}px)`;

    result.transformOrigin = `${originX * 100}% ${originY * 100}%`;
    result.uiTransform = Math.abs(scale - 1) <= 0.0001
        ? 'none'
        : `scale(${scale})`;
    result.effectTransform = 'none';
    result.uiFilter = filter;
    result.effectFilter = filter;
    return result;
}

/**
 * 절대 화면 좌표의 effect 텍스처 영역을 패널 로컬 좌표로 변환합니다.
 * @param {{x:number,y:number,w:number,h:number}} panelRect - 현재 패널 영역입니다.
 * @param {{x?:number,y?:number,w?:number,h?:number}|null} effectTextureRect - 선택적 텍스처 영역입니다.
 * @param {object|null} [out=null] - 재사용할 출력 객체입니다.
 * @returns {{x:number,y:number,w:number,h:number}} 패널 로컬 텍스처 영역입니다.
 */
export function resolveOverlayEffectTextureRect(panelRect, effectTextureRect, out = null) {
    const result = out && typeof out === 'object'
        ? out
        : { x: 0, y: 0, w: 0, h: 0 };
    const panelWidth = Math.max(1, Number(panelRect?.w) || 0);
    const panelHeight = Math.max(1, Number(panelRect?.h) || 0);
    const textureWidth = Number(effectTextureRect?.w);
    const textureHeight = Number(effectTextureRect?.h);

    if (!Number.isFinite(textureWidth)
        || textureWidth <= 0
        || !Number.isFinite(textureHeight)
        || textureHeight <= 0) {
        result.x = 0;
        result.y = 0;
        result.w = panelWidth;
        result.h = panelHeight;
        return result;
    }

    const panelX = Number(panelRect?.x) || 0;
    const panelY = Number(panelRect?.y) || 0;
    result.x = (Number(effectTextureRect?.x) || 0) - panelX;
    result.y = (Number(effectTextureRect?.y) || 0) - panelY;
    result.w = textureWidth;
    result.h = textureHeight;
    return result;
}
