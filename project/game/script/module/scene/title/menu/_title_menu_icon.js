import { ColorSchemes } from 'display/_theme_handler.js';

/**
 * @description 타이틀 메뉴 아이콘의 색상 치환 토큰입니다.
 */
const ICON_COLOR_TOKENS = Object.freeze({
    FILL: '{{TITLE_ICON_FILL}}',
    SHADOW: '{{TITLE_ICON_SHADOW}}'
});

/**
 * @description 테마 기반으로 치환된 SVG 템플릿을 보관하는 원본 문자열입니다.
 */
const TITLE_MENU_ICON_TEMPLATES = Object.freeze({
    start: `<svg width="796" height="929" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" overflow="hidden"><g transform="translate(-328 -309)"><path d="M1057.01 650.657 527.812 328.359C439.213 274.438 328.961 342.665 328.961 451.22L328.961 1095.78C328.961 1204.5 439.213 1272.56 527.812 1218.64L1057.01 896.507C1146.28 842.165 1146.28 704.999 1057.01 650.657" fill="${ICON_COLOR_TOKENS.FILL}" fill-rule="evenodd"/></g></svg>`,
    quick_start: `<svg width="124" height="100" viewBox="0 0 124 100" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="backTriangleClip">
      <path d="M 114.4 37.7 L 61.5 5.4 C 52.6 0 41.6 6.9 41.6 17.7 V 82.3 C 41.6 93.1 52.6 99.9 61.5 94.6 L 114.4 62.3 C 123.3 56.8 123.3 43.2 114.4 37.7 Z"/>
    </clipPath>

    <radialGradient id="shadowGradient" cx="45%" cy="50%" r="55%">
      <stop offset="30%" stop-color="${ICON_COLOR_TOKENS.SHADOW}" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="${ICON_COLOR_TOKENS.SHADOW}" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <path d="M 114.4 37.7 L 61.5 5.4 C 52.6 0 41.6 6.9 41.6 17.7 V 82.3 C 41.6 93.1 52.6 99.9 61.5 94.6 L 114.4 62.3 C 123.3 56.8 123.3 43.2 114.4 37.7 Z" fill="${ICON_COLOR_TOKENS.FILL}"/>

  <g clip-path="url(#backTriangleClip)">
    <rect x="0" y="0" width="100" height="100" fill="url(#shadowGradient)"/>
  </g>

  <path d="M 72.8 37.7 L 19.9 5.4 C 11 0 0 6.9 0 17.7 V 82.3 C 0 93.1 11 99.9 19.9 94.6 L 72.8 62.3 C 81.7 56.8 81.7 43.2 72.8 37.7 Z" fill="${ICON_COLOR_TOKENS.FILL}"/>
</svg>`,
    records: `<svg width="1007" height="876" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" overflow="hidden"><defs><clipPath id="clip0"><rect x="2574" y="362" width="1007" height="876"/></clipPath></defs><g clip-path="url(#clip0)" transform="translate(-2574 -362)"><path d="M2574 421C2574 388.415 2600.42 362 2633 362L3047 362C3079.59 362 3106 388.415 3106 421L3106 421C3106 453.585 3079.58 480 3047 480L2633 480C2600.42 480 2574 453.585 2574 421Z" fill="${ICON_COLOR_TOKENS.FILL}" fill-rule="evenodd"/><path d="M2574 800.001C2574 767.416 2600.42 741 2633 741L3522 741C3554.59 741 3581 767.416 3581 800.001L3581 800.001C3581 832.586 3554.58 859.001 3522 859.001L2633 859C2600.42 859 2574 832.585 2574 800Z" fill="${ICON_COLOR_TOKENS.FILL}" fill-rule="evenodd"/><path d="M2574 1179C2574 1146.42 2600.42 1120 2633 1120L3225 1120C3257.58 1120 3284 1146.42 3284 1179L3284 1179C3284 1211.58 3257.58 1238 3225 1238L2633 1238C2600.42 1238 2574 1211.58 2574 1179Z" fill="${ICON_COLOR_TOKENS.FILL}" fill-rule="evenodd"/></g></svg>`,
    deck: `<svg width="96" height="114" viewBox="0 0 96 114" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="backCardClip">
      <rect x="27" y="0" width="69" height="100" rx="11.5"/>
    </clipPath>

    <radialGradient id="shadowGradient" cx="50%" cy="50%" r="50%">
      <stop offset="65%" stop-color="${ICON_COLOR_TOKENS.SHADOW}" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="${ICON_COLOR_TOKENS.SHADOW}" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect x="27" y="0" width="69" height="100" rx="11.5" fill="${ICON_COLOR_TOKENS.FILL}"/>

  <g clip-path="url(#backCardClip)">
    <rect x="-15" y="-1" width="99" height="130" rx="26.5" fill="url(#shadowGradient)"/>
  </g>

  <rect x="0" y="14" width="69" height="100" rx="11.5" fill="${ICON_COLOR_TOKENS.FILL}"/>
</svg>`,
    research: `<svg width="96" height="100" viewBox="126 112 772 800" xmlns="http://www.w3.org/2000/svg">
  <path d="M874 799.5c19.4 30.9 23.2 57.4 11.2 79.4-11.9 22-36.4 33.1-73.2 33.1H211.9c-36.8 0-61.2-11.1-73.2-33.1-11.9-22-8.2-48.5 11.2-79.4l262-413V178.6h-33.3c-9 0-16.9-3.3-23.4-9.9s-9.9-14.4-9.9-23.4c0-9 3.3-16.9 9.9-23.4 6.6-6.6 14.4-9.9 23.4-9.9h266.6c9 0 16.9 3.3 23.4 9.9 6.6 6.6 9.9 14.5 9.9 23.4s-3.3 16.9-9.9 23.4-14.5 9.9-23.4 9.9H612v207.8l262 413.1zM468.3 421.9L326.6 645.4h370.8L555.8 421.9l-10.4-16.1V178.6h-66.7V405.7l-10.4 16.2z" fill="${ICON_COLOR_TOKENS.FILL}"/>
</svg>`,
    setting: `<svg viewBox="0 0 48.4 48.4" xmlns="http://www.w3.org/2000/svg">
  <path d="M48.4 24.2c0-1.8-1.297-3.719-2.896-4.285s-3.149-1.952-3.6-3.045c-.451-1.093-.334-3.173.396-4.705.729-1.532.287-3.807-.986-5.08-1.272-1.273-3.547-1.714-5.08-.985-1.532.729-3.609.848-4.699.397s-2.477-2.003-3.045-3.602C27.921 1.296 26 0 24.2 0c-1.8 0-3.721 1.296-4.29 2.895-.569 1.599-1.955 3.151-3.045 3.602-1.09.451-3.168.332-4.7-.397-1.532-.729-3.807-.288-5.08.985-1.273 1.273-1.714 3.547-.985 5.08.729 1.533.845 3.611.392 4.703-.453 1.092-1.998 2.481-3.597 3.047S0 22.4 0 24.2s1.296 3.721 2.895 4.29c1.599.568 3.146 1.957 3.599 3.047.453 1.089.335 3.166-.394 4.698s-.288 3.807.985 5.08c1.273 1.272 3.547 1.714 5.08.985 1.533-.729 3.61-.847 4.7-.395 1.091.452 2.476 2.008 3.045 3.604.569 1.596 2.49 2.891 4.29 2.891 1.8 0 3.721-1.295 4.29-2.891.568-1.596 1.953-3.15 3.043-3.604 1.09-.453 3.17-.334 4.701.396 1.533.729 3.808.287 5.08-.985 1.273-1.273 1.715-3.548.986-5.08-.729-1.533-.849-3.61-.398-4.7.451-1.09 2.004-2.477 3.603-3.045C47.104 27.921 48.4 26 48.4 24.2ZM24.2 33.08c-4.91 0-8.88-3.97-8.88-8.87 0-4.91 3.97-8.88 8.88-8.88 4.899 0 8.87 3.97 8.87 8.88 0 4.9-3.97 8.87-8.87 8.87Z" fill="${ICON_COLOR_TOKENS.FILL}"/>
</svg>`,
    credits: `<svg viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg">
  <path d="M24.8452 25.3957a6.0129 6.0129 0 0 0-8.4487.7617L1.3974 44.1563a5.9844 5.9844 0 0 0 0 7.687L16.3965 69.8422a5.9983 5.9983 0 1 0 9.21-7.687L13.8068 48l11.8-14.1554a6 6 0 0 0-.7616-8.4489Z" fill="${ICON_COLOR_TOKENS.FILL}"/>
  <path d="M55.1714 12.1192A6.0558 6.0558 0 0 0 48.1172 16.83L36.1179 76.8262A5.9847 5.9847 0 0 0 40.8286 83.88a5.7059 5.7059 0 0 0 1.1835.1172A5.9949 5.9949 0 0 0 47.8828 79.17L59.8821 19.1735A5.9848 5.9848 0 0 0 55.1714 12.1192Z" fill="${ICON_COLOR_TOKENS.FILL}"/>
  <path d="M94.6026 44.1563 79.6035 26.1574a5.9983 5.9983 0 1 0-9.21 7.687L82.1932 48l-11.8 14.1554a5.9983 5.9983 0 1 0 9.21 7.687L94.6026 51.8433a5.9844 5.9844 0 0 0 0-7.687Z" fill="${ICON_COLOR_TOKENS.FILL}"/>
</svg>`,
    achievements: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <path d="M60 4H48c0-2.215-1.789-4-4-4H20c-2.211 0-4 1.785-4 4H4C1.789 4 0 5.785 0 8v8c0 8.836 7.164 16 16 16 .188 0 .363-.051.547-.059C17.984 37.57 22.379 41.973 28 43.43V56h-8c-2.211 0-4 1.785-4 4v4h32v-4c0-2.215-1.789-4-4-4h-8V43.43c5.621-1.457 10.016-5.859 11.453-11.488C47.637 31.949 47.812 32 48 32c8.836 0 16-7.164 16-16V8c0-2.215-1.789-4-4-4ZM8 16v-4h8v12C11.582 24 8 20.414 8 16Zm48 0c0 4.414-3.582 8-8 8V12h8v4Z" fill="${ICON_COLOR_TOKENS.FILL}"/>
</svg>`,
    exit: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <path fill-rule="evenodd" clip-rule="evenodd" d="M9.70725 2.4087C9 3.03569 9 4.18259 9 6.4764V17.5236C9 19.8174 9 20.9643 9.70725 21.5913C10.4145 22.2183 11.4955 22.0297 13.6576 21.6526L15.9864 21.2465C18.3809 20.8288 19.5781 20.62 20.2891 19.7417C21 18.8635 21 17.5933 21 15.0529V8.94711C21 6.40671 21 5.13652 20.2891 4.25826C19.5781 3.37999 18.3809 3.17118 15.9864 2.75354L13.6576 2.34736C11.4955 1.97026 10.4145 1.78171 9.70725 2.4087ZM12 10.1686C12.4142 10.1686 12.75 10.52 12.75 10.9535V13.0465C12.75 13.48 12.4142 13.8314 12 13.8314C11.5858 13.8314 11.25 13.48 11.25 13.0465V10.9535C11.25 10.52 11.5858 10.1686 12 10.1686Z" fill="${ICON_COLOR_TOKENS.FILL}"/>
  <path d="M7.54717 4.5C5.48889 4.503 4.41599 4.54826 3.73223 5.23202C3 5.96425 3 7.14276 3 9.49979V14.4998C3 16.8568 3 18.0353 3.73223 18.7676C4.41599 19.4513 5.48889 19.4966 7.54717 19.4996C7.49985 18.8763 7.49992 18.1557 7.50001 17.3768V6.6227C7.49992 5.84388 7.49985 5.1233 7.54717 4.5Z" fill="${ICON_COLOR_TOKENS.FILL}"/>
</svg>`
});

/**
 * 메뉴 아이콘 렌더링에 사용할 색상값을 반환합니다.
 * @returns {{fill:string, shadow:string}} 아이콘 컬러 셋
 */
function getMenuIconColors() {
    const iconColor = ColorSchemes?.Title?.Menu?.Icon || {};
    const fill = iconColor.Fill
        || ColorSchemes?.Title?.Menu?.Foreground
        || ColorSchemes?.Title?.TextDark
        || ColorSchemes?.Title?.Button?.Text
        || ColorSchemes?.Title?.Menu?.Accent
        || ColorSchemes?.Cursor?.White;
    const shadow = iconColor.Shadow
        || ColorSchemes?.Title?.Menu?.Icon?.Shadow
        || ColorSchemes?.Title?.Menu?.Foreground
        || ColorSchemes?.Title?.TextDark
        || ColorSchemes?.Title?.Menu?.Accent;

    return {
        fill,
        shadow
    };
}

/**
 * 템플릿 문자열에 실제 색상을 주입해 SVG 소스를 만듭니다.
 * @param {string} template - 색상 토큰이 포함된 SVG 템플릿
 * @param {string} fill - 아이콘 메인 채움 색상
 * @param {string} shadow - 아이콘 그림자 색상
 * @returns {string} 색상 치환이 완료된 SVG 문자열
 */
function applyIconColorTemplate(template, fill, shadow) {
    return template
        .replaceAll(ICON_COLOR_TOKENS.FILL, fill)
        .replaceAll(ICON_COLOR_TOKENS.SHADOW, shadow);
}

/**
 * 색상 치환된 메뉴 아이콘 소스를 반환합니다.
 * @param {string} iconId - 메뉴 식별자입니다.
 * @returns {string|null} SVG 문자열 또는 null입니다.
 */
export function getTitleMenuIconSource(iconId) {
    const template = TITLE_MENU_ICON_TEMPLATES[iconId];
    if (!template) {
        return null;
    }

    const menuIconColors = getMenuIconColors();
    return applyIconColorTemplate(template, menuIconColors.fill, menuIconColors.shadow);
}

/**
 * 현재 테마 기준 모든 메뉴 아이콘 소스를 반환합니다.
 * @returns {string[]} 메뉴 아이콘 SVG 소스 목록
 */
export function getAllTitleMenuIconSources() {
    const menuIconColors = getMenuIconColors();
    return Object.keys(TITLE_MENU_ICON_TEMPLATES)
        .map((iconId) => applyIconColorTemplate(
            TITLE_MENU_ICON_TEMPLATES[iconId],
            menuIconColors.fill,
            menuIconColors.shadow
        ));
}

/**
 * 메뉴 식별자에 대응하는 타이틀 메뉴 아이콘 SVG 문자열의 템플릿 키를 반환합니다.
 * @returns {string[]} 아이콘 템플릿 키 목록
 */
export const TITLE_MENU_ICON_SOURCES = Object.freeze(Object.keys(TITLE_MENU_ICON_TEMPLATES));
