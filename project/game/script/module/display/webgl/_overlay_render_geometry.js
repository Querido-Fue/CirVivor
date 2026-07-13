import { clampFiniteNumber } from 'util/number_util.js';

/**
 * overlay 콘텐츠 CSS 변환과 같은 순서의 WebGL 행렬을 재사용 버퍼에 기록합니다.
 * @param {object} transform - 정규화된 콘텐츠 변환입니다.
 * @param {number} surfaceWidth - effect surface 너비입니다.
 * @param {number} surfaceHeight - effect surface 높이입니다.
 * @param {Float32Array|number[]|null} [out=null] - 재사용할 4x4 행렬입니다.
 * @returns {Float32Array|number[]} column-major 4x4 행렬입니다.
 */
export function writeOverlayContentTransformMatrix(
    transform,
    surfaceWidth,
    surfaceHeight,
    out = null
) {
    const result = out && out.length === 16 ? out : new Float32Array(16);
    const scaleX = clampFiniteNumber(transform?.scaleX, 0.01, 4, 1);
    const scaleY = clampFiniteNumber(transform?.scaleY, 0.01, 4, 1);
    const rotateY = clampFiniteNumber(transform?.rotateY, -Math.PI, Math.PI, 0);
    const translateX = clampFiniteNumber(transform?.translateXRatio, -4, 4, 0)
        * Math.max(1, surfaceWidth || 0);
    const translateY = clampFiniteNumber(transform?.translateYRatio, -4, 4, 0)
        * Math.max(1, surfaceHeight || 0);
    const cosine = Math.cos(rotateY);
    const sine = Math.sin(rotateY);

    result[0] = scaleX * cosine;
    result[1] = 0;
    result[2] = -sine;
    result[3] = 0;
    result[4] = 0;
    result[5] = scaleY;
    result[6] = 0;
    result[7] = 0;
    result[8] = scaleX * sine;
    result[9] = 0;
    result[10] = cosine;
    result[11] = 0;
    result[12] = translateX;
    result[13] = translateY;
    result[14] = 0;
    result[15] = 1;
    return result;
}

/**
 * 두 column-major 4x4 행렬을 곱해 재사용 버퍼에 기록합니다.
 * @param {Float32Array|number[]} left - 왼쪽 행렬입니다.
 * @param {Float32Array|number[]} right - 오른쪽 행렬입니다.
 * @param {Float32Array|number[]|null} [out=null] - 재사용할 출력 행렬입니다.
 * @returns {Float32Array|number[]} 곱셈 결과입니다.
 */
export function multiplyOverlayTransformMatrices(left, right, out = null) {
    const result = out && out.length === 16 ? out : new Float32Array(16);
    for (let column = 0; column < 4; column++) {
        for (let row = 0; row < 4; row++) {
            let value = 0;
            for (let index = 0; index < 4; index++) {
                value += left[(index * 4) + row] * right[(column * 4) + index];
            }
            result[(column * 4) + row] = value;
        }
    }
    return result;
}

/**
 * overlay UI/effect surface에 적용할 CSS transform 문자열을 계산합니다.
 * @param {object|null} contentTransform - 연결 전환용 콘텐츠 변환입니다.
 * @param {boolean} transformEffectSurface - effect surface CSS 변환 여부입니다.
 * @param {number} contentScale - 일반 overlay 콘텐츠 배율입니다.
 * @param {number} scaleOriginXRatio - 일반 배율 X 원점입니다.
 * @param {number} scaleOriginYRatio - 일반 배율 Y 원점입니다.
 * @param {object|null} [out=null] - 재사용할 출력 객체입니다.
 * @returns {{transformOrigin:string,uiTransform:string,effectTransform:string}} surface 스타일입니다.
 */
export function resolveOverlayContentSurfaceStyles(
    contentTransform,
    transformEffectSurface,
    contentScale,
    scaleOriginXRatio,
    scaleOriginYRatio,
    out = null
) {
    const result = out && typeof out === 'object'
        ? out
        : { transformOrigin: '', uiTransform: 'none', effectTransform: 'none' };

    if (contentTransform) {
        result.transformOrigin = `${contentTransform.originXRatio * 100}% `
            + `${contentTransform.originYRatio * 100}%`;
        const transformValue = `perspective(${contentTransform.perspectiveRatio * 100}vw) `
            + `translate(${contentTransform.translateXRatio * 100}%, `
            + `${contentTransform.translateYRatio * 100}%) `
            + `scale(${contentTransform.scaleX}, ${contentTransform.scaleY}) `
            + `rotateY(${contentTransform.rotateY}rad)`;
        result.uiTransform = transformValue;
        result.effectTransform = transformEffectSurface ? transformValue : 'none';
        return result;
    }

    result.transformOrigin = `${scaleOriginXRatio * 100}% ${scaleOriginYRatio * 100}%`;
    result.uiTransform = Math.abs(contentScale - 1) <= 0.0001
        ? 'none'
        : `scale(${contentScale})`;
    result.effectTransform = 'none';
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
