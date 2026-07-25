import { TYPOGRAPHY } from './typography.js';
import {
    BUTTON_STYLE,
    getButtonStyleTokenName,
    isButtonStyleToken
} from './component_styles.js';

/**
 * 컴포넌트 스타일 정의에서 사용할 반응형 치수 값을 생성합니다.
 * @param {string} base - 치수 기준 단위입니다.
 * @param {number} value - 단위 기준 비율 값입니다.
 * @returns {{BASE:string, VALUE:number}} 동결된 치수 값입니다.
 */
function createMetric(base, value) {
    return Object.freeze({ BASE: base, VALUE: value });
}

/**
 * 버튼 스타일 정의를 생성합니다.
 * @param {object} options - 버튼 스타일 옵션입니다.
 * @returns {object} 동결된 버튼 스타일 정의입니다.
 */
function createButtonDefinition(options) {
    const definition = {
        width: createMetric('WW', options.width),
        height: createMetric('WH', options.height),
        margin: createMetric('WW', options.margin),
        radius: createMetric('WW', options.radius),
        typography: options.typography,
        align: 'right'
    };
    if (options.iconType) {
        definition.iconType = options.iconType;
    }
    return Object.freeze(definition);
}

const BUTTON_STYLE_DEFINITIONS = new Map([
    [BUTTON_STYLE.OVERLAY_INTERACT, createButtonDefinition({
        width: 7,
        height: 3.5,
        margin: 0.8,
        radius: 0.3,
        typography: TYPOGRAPHY.BUTTON_PRIMARY
    })],
    [BUTTON_STYLE.OVERLAY_LINK, createButtonDefinition({
        width: 6,
        height: 3,
        margin: 0.65,
        radius: 0.3,
        typography: TYPOGRAPHY.BUTTON_LINK,
        iconType: 'arrow'
    })]
]);

/**
 * 승인된 버튼 스타일 토큰을 실제 레이아웃 치수와 타이포그래피 토큰으로 변환합니다.
 * @param {object} token - `BUTTON_STYLE`의 토큰입니다.
 * @param {(metric: object) => number} resolveMetric - 치수를 픽셀로 변환하는 함수입니다.
 * @returns {{token:object,name:string,width:number,height:number,margin:number,radius:number,typography:object,align:string,iconType?:string}} 동결된 스타일입니다.
 */
export function resolveButtonStyle(token, resolveMetric) {
    if (!isButtonStyleToken(token)) {
        throw new TypeError('resolveButtonStyle()에는 BUTTON_STYLE 토큰만 전달할 수 있습니다.');
    }
    if (typeof resolveMetric !== 'function') {
        throw new TypeError('resolveButtonStyle()에는 치수 resolver가 필요합니다.');
    }

    const definition = BUTTON_STYLE_DEFINITIONS.get(token);
    if (!definition) {
        throw new RangeError(`정의되지 않은 버튼 스타일 토큰입니다: ${getButtonStyleTokenName(token)}`);
    }

    const resolved = {
        token,
        name: getButtonStyleTokenName(token),
        width: resolveMetric(definition.width),
        height: resolveMetric(definition.height),
        margin: resolveMetric(definition.margin),
        radius: resolveMetric(definition.radius),
        typography: definition.typography,
        align: definition.align
    };
    if (definition.iconType) {
        resolved.iconType = definition.iconType;
    }
    return Object.freeze(resolved);
}
