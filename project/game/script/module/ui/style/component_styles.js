const buttonStyleTokens = new Set();

/**
 * 외부 코드가 버튼의 실제 치수와 폰트 수치에 접근하지 못하도록 불투명 스타일 토큰을 생성합니다.
 * @param {string} name - 토큰 이름입니다.
 * @returns {{name:string}} 동결된 버튼 스타일 토큰입니다.
 */
function createButtonStyleToken(name) {
    const token = Object.freeze({ name });
    buttonStyleTokens.add(token);
    return token;
}

/**
 * UI 버튼에 사용할 수 있는 승인된 컴포넌트 스타일 토큰입니다.
 */
export const BUTTON_STYLE = Object.freeze({
    OVERLAY_INTERACT: createButtonStyleToken('OVERLAY_INTERACT'),
    OVERLAY_LINK: createButtonStyleToken('OVERLAY_LINK')
});

/**
 * 값이 승인된 버튼 스타일 토큰인지 확인합니다.
 * @param {*} value - 검사할 값입니다.
 * @returns {boolean} 승인된 토큰이면 true입니다.
 */
export function isButtonStyleToken(value) {
    return buttonStyleTokens.has(value);
}

/**
 * 승인된 버튼 스타일 토큰의 이름을 반환합니다.
 * @param {*} token - 확인할 토큰입니다.
 * @returns {string} 토큰 이름입니다.
 */
export function getButtonStyleTokenName(token) {
    if (!isButtonStyleToken(token)) {
        throw new TypeError('승인되지 않은 버튼 스타일 토큰입니다.');
    }
    return token.name;
}
