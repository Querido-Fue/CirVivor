import { isButtonStyleToken } from 'ui/style/component_styles.js';
import { isTypographyToken } from 'ui/style/typography.js';

const TYPOGRAPHY_PROP_KEYS = new Set([
    'font',
    'fontSize',
    'fontWeight',
    'fontFamily',
    'size',
    'valueFont'
]);
const TEXT_STYLE_ITEM_TYPES = new Set([
    'text',
    'button',
    'dropdown',
    'segment_control'
]);

/**
 * textStyle() 인자의 토큰 identity와 적용 대상을 검증합니다.
 * @param {object|null} item - 현재 레이아웃 아이템입니다.
 * @param {object} token - 검증할 타이포그래피 토큰입니다.
 * @returns {void}
 */
export function assertTextStyleAssignment(item, token) {
    if (!isTypographyToken(token)) {
        throw new TypeError('textStyle()에는 TYPOGRAPHY 토큰만 전달할 수 있습니다.');
    }
    if (item && !TEXT_STYLE_ITEM_TYPES.has(item.type)) {
        throw new TypeError(`textStyle()은 ${item.type} 아이템에 사용할 수 없습니다.`);
    }
}

/**
 * valueTextStyle() 인자의 토큰 identity와 적용 대상을 검증합니다.
 * @param {object|null} item - 현재 레이아웃 아이템입니다.
 * @param {object} token - 검증할 타이포그래피 토큰입니다.
 * @returns {void}
 */
export function assertValueTextStyleAssignment(item, token) {
    if (!isTypographyToken(token)) {
        throw new TypeError('valueTextStyle()에는 TYPOGRAPHY 토큰만 전달할 수 있습니다.');
    }
    if (item && item.type !== 'slider') {
        throw new TypeError(`valueTextStyle()은 ${item.type} 아이템에 사용할 수 없습니다.`);
    }
}

/**
 * buttonStyle() 인자의 토큰 identity와 적용 대상을 검증합니다.
 * @param {object|null} item - 현재 레이아웃 아이템입니다.
 * @param {object} token - 검증할 버튼 스타일 토큰입니다.
 * @returns {void}
 */
export function assertButtonStyleAssignment(item, token) {
    if (!isButtonStyleToken(token)) {
        throw new TypeError('buttonStyle()에는 BUTTON_STYLE 토큰만 전달할 수 있습니다.');
    }
    if (item && item.type !== 'button') {
        throw new TypeError(`buttonStyle()은 ${item.type} 아이템에 사용할 수 없습니다.`);
    }
}

/**
 * prop()을 통한 raw 타이포그래피 속성 주입을 차단합니다.
 * @param {string} key - 검사할 props 키입니다.
 * @returns {void}
 */
export function assertAllowedPropKey(key) {
    if (TYPOGRAPHY_PROP_KEYS.has(key)) {
        throw new TypeError(`LayoutHandler.prop('${key}') 직접 타이포그래피 접근은 허용되지 않습니다.`);
    }
}

/**
 * 요소 생성 전에 타입별 필수 의미 스타일 토큰을 검증합니다.
 * @param {object} item - 검증할 레이아웃 아이템입니다.
 * @returns {void}
 */
export function validateStyleContract(item) {
    if (item.type === 'text' && !isTypographyToken(item.textStyle)) {
        throw new TypeError(`text 아이템 "${item.id}"에는 textStyle(TYPOGRAPHY.*)가 필요합니다.`);
    }
    if (
        item.type === 'button'
        && item.props.text
        && !isButtonStyleToken(item.buttonStyle)
        && !isTypographyToken(item.textStyle)
    ) {
        throw new TypeError(`텍스트 button "${item.id}"에는 buttonStyle() 또는 textStyle()이 필요합니다.`);
    }
    if (
        (item.type === 'dropdown' || item.type === 'segment_control')
        && !isTypographyToken(item.textStyle)
    ) {
        throw new TypeError(`${item.type} 아이템 "${item.id}"에는 textStyle(TYPOGRAPHY.*)가 필요합니다.`);
    }
    if (item.type === 'slider' && !isTypographyToken(item.valueTextStyle)) {
        throw new TypeError(`slider 아이템 "${item.id}"에는 valueTextStyle(TYPOGRAPHY.*)가 필요합니다.`);
    }
}

/**
 * 값이 실제 BUTTON_STYLE 토큰인지 확인합니다.
 * @param {*} token - 확인할 값입니다.
 * @returns {boolean} 등록된 버튼 스타일 토큰이면 true입니다.
 */
export function isApprovedButtonStyleToken(token) {
    return isButtonStyleToken(token);
}
