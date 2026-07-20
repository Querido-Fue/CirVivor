import { clampFiniteNumber } from 'util/number_util.js';

/**
 * overlay UI/effect surface에 적용할 CSS scale/blur 스타일을 계산합니다.
 * 숫자 입력은 `Number.isFinite()` 기반 clamp로 검사하며 문자열·객체를 강제 변환하지 않습니다.
 * 객체 `out`을 받으면 같은 identity에
 * `transformOrigin → uiTransform → effectTransform → uiFilter → effectFilter` 순서로 기록해 반환합니다.
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
 * 패널 `w → h`와 텍스처 `w → h`는 `Number()`로 강제 변환하므로 변환 hook과 예외가 관찰됩니다.
 * 텍스처 크기가 유효하지 않으면 X/Y를 읽지 않고 최소 1px인 전체 패널 영역으로 대체합니다.
 * 유효한 경우 패널 `x → y`, 텍스처 `x → y` 순서로 읽으며, 객체 `out`의 같은 identity에
 * `x → y → w → h` 순서로 기록해 반환합니다. 쓰기 중 예외가 발생해도 앞선 기록은 되돌리지 않습니다.
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
