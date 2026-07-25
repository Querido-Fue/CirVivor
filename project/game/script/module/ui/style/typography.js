const typographyTokens = new Set();

/**
 * 외부 코드가 실제 글꼴 수치에 접근하지 못하도록 불투명 타이포그래피 토큰을 생성합니다.
 * @param {string} name - 디버그와 오류 메시지에 사용할 토큰 이름입니다.
 * @returns {{name:string}} 동결된 타이포그래피 토큰입니다.
 */
function createTypographyToken(name) {
    const token = Object.freeze({ name });
    typographyTokens.add(token);
    return token;
}

/**
 * UI 코드에서 사용할 수 있는 승인된 타이포그래피 토큰입니다.
 * 실제 크기·굵기·줄 높이는 내부 resolver만 소유합니다.
 */
export const TYPOGRAPHY = Object.freeze({
    H1: createTypographyToken('H1'),
    H2: createTypographyToken('H2'),
    H3: createTypographyToken('H3'),
    H4: createTypographyToken('H4'),
    H5: createTypographyToken('H5'),
    H6: createTypographyToken('H6'),
    PROGRESS_VALUE: createTypographyToken('PROGRESS_VALUE'),
    LABEL: createTypographyToken('LABEL'),
    CONTROL: createTypographyToken('CONTROL'),
    SETTINGS_DESCRIPTION: createTypographyToken('SETTINGS_DESCRIPTION'),
    SLIDER_VALUE: createTypographyToken('SLIDER_VALUE'),
    BUTTON_PRIMARY: createTypographyToken('BUTTON_PRIMARY'),
    BUTTON_LINK: createTypographyToken('BUTTON_LINK'),
    LINK_PREVIEW: createTypographyToken('LINK_PREVIEW'),
    DISPLAY_ICON: createTypographyToken('DISPLAY_ICON'),
    TOOLTIP_TITLE: createTypographyToken('TOOLTIP_TITLE'),
    TOOLTIP_BODY: createTypographyToken('TOOLTIP_BODY'),
    CARD_TITLE: createTypographyToken('CARD_TITLE'),
    CARD_DESCRIPTION: createTypographyToken('CARD_DESCRIPTION'),
    BENTO_HERO_TITLE: createTypographyToken('BENTO_HERO_TITLE'),
    BENTO_HERO_DESCRIPTION: createTypographyToken('BENTO_HERO_DESCRIPTION'),
    BENTO_COMPACT_TITLE: createTypographyToken('BENTO_COMPACT_TITLE'),
    BENTO_CARD_TITLE: createTypographyToken('BENTO_CARD_TITLE'),
    BENTO_CARD_DESCRIPTION: createTypographyToken('BENTO_CARD_DESCRIPTION')
});

/**
 * 값이 이 모듈에서 발급한 타이포그래피 토큰인지 확인합니다.
 * @param {*} value - 검사할 값입니다.
 * @returns {boolean} 승인된 토큰이면 true입니다.
 */
export function isTypographyToken(value) {
    return typographyTokens.has(value);
}

/**
 * 승인된 타이포그래피 토큰의 이름을 반환합니다.
 * @param {*} token - 이름을 확인할 토큰입니다.
 * @returns {string} 토큰 이름입니다.
 */
export function getTypographyTokenName(token) {
    if (!isTypographyToken(token)) {
        throw new TypeError('승인되지 않은 타이포그래피 토큰입니다.');
    }
    return token.name;
}
