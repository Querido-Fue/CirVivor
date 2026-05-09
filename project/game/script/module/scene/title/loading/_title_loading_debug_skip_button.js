import { UIPool } from 'ui/_ui_pool.js';
import { resolveFiniteNumber } from 'util/number_util.js';
import { getLoadingSkipButtonStyle } from './_title_loading_theme.js';

const DEBUG_SKIP_LOADING_LABEL = '로딩 스킵';

/**
 * 디버그 전용 로딩 스킵 버튼을 생성합니다.
 * @param {object} options - 버튼 생성 옵션입니다.
 * @param {object} options.titleScene - 타이틀 씬 인스턴스입니다.
 * @param {Function} options.onClick - 클릭 콜백입니다.
 * @param {number} options.wh - 현재 화면 높이입니다.
 * @param {number} options.uiww - 현재 UI 기준 너비입니다.
 * @returns {import('ui/element/_button.js').ButtonElement} 생성된 버튼입니다.
 */
export function createTitleLoadingDebugSkipButton({ titleScene, onClick, wh, uiww }) {
    const skipButtonStyle = getLoadingSkipButtonStyle();
    const buttonText = UIPool.text_element.get();
    buttonText.init({
        parent: titleScene,
        layer: 'ui',
        text: DEBUG_SKIP_LOADING_LABEL,
        font: 'Pretendard Variable',
        fontWeight: '700',
        size: Math.max(12, wh * 0.0145),
        color: skipButtonStyle.text,
        align: 'center'
    });

    const button = UIPool.button.get();
    button.init({
        parent: titleScene,
        onClick,
        onHover: null,
        layer: 'ui',
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        idleColor: skipButtonStyle.idleColor,
        hoverColor: skipButtonStyle.hoverColor,
        center: [buttonText],
        alpha: 1,
        margin: Math.max(12, uiww * 0.012),
        radius: Math.max(12, wh * 0.018)
    });
    button.idleColor = skipButtonStyle.idleColor;
    button.hoverColor = skipButtonStyle.hoverColor;
    return button;
}

/**
 * 디버그 전용 로딩 스킵 버튼의 배치를 현재 화면에 맞춥니다.
 * @param {object|null} button - 배치할 버튼입니다.
 * @param {object} layout - 현재 로딩 텍스트 배치 정보입니다.
 */
export function layoutTitleLoadingDebugSkipButton(button, layout) {
    if (!button) {
        return;
    }

    const wh = resolveFiniteNumber(layout?.wh, 0);
    const uiww = resolveFiniteNumber(layout?.uiww, 0);
    const loadingTextX = resolveFiniteNumber(layout?.loadingTextX, 0);
    const loadingTextBlockBottomY = resolveFiniteNumber(layout?.loadingTextBlockBottomY, 0);
    const buttonWidth = Math.max(120, uiww * 0.12);
    const buttonHeight = Math.max(34, wh * 0.048);
    button.width = buttonWidth;
    button.height = buttonHeight;
    button.x = loadingTextX - (buttonWidth * 0.5);
    button.y = loadingTextBlockBottomY + Math.max(20, wh * 0.028);
    button.margin = Math.max(12, uiww * 0.012);
    button.radius = Math.max(12, wh * 0.018);

    const skipButtonStyle = getLoadingSkipButtonStyle();
    const buttonText = button.center[0];
    if (buttonText) {
        buttonText.size = Math.max(12, wh * 0.0145);
        buttonText.color = skipButtonStyle.text;
    }

    button.idleColor = skipButtonStyle.idleColor;
    button.hoverColor = skipButtonStyle.hoverColor;
}

/**
 * 디버그 스킵 버튼의 테마 색상을 최신값으로 적용합니다.
 * @param {object|null} button - 스타일을 갱신할 버튼입니다.
 */
export function applyTitleLoadingDebugSkipButtonStyle(button) {
    if (!button) {
        return;
    }

    const skipButtonStyle = getLoadingSkipButtonStyle();
    const buttonText = button.center?.[0];
    if (buttonText) {
        buttonText.color = skipButtonStyle.text;
    }
    button.idleColor = skipButtonStyle.idleColor;
    button.hoverColor = skipButtonStyle.hoverColor;
}

/**
 * 현재 프레임에서 디버그 스킵 버튼을 보여줄지 반환합니다.
 * @param {object|null} button - 디버그 스킵 버튼입니다.
 * @param {boolean} loadingFinished - 로딩 완료 여부입니다.
 * @param {object|null} titleLogo - 현재 로고 인스턴스입니다.
 * @returns {boolean} 표시 여부입니다.
 */
export function shouldShowTitleLoadingDebugSkipButton(button, loadingFinished, titleLogo) {
    return Boolean(button) && loadingFinished !== true && !titleLogo;
}
