import { ColorSchemes } from 'display/_theme_handler.js';
import { getLangString } from 'ui/ui_system.js';

const AFFIRMATIVE_ICON_LANG_KEY = 'affirmative_icon';
const CHECK_ICON_KEY = 'check';
const CONFIRM_ICON_KEY = 'confirm';

/**
 * 현재 언어 설정에 맞는 확인 버튼 아이콘과 색상을 마지막 버튼에 적용합니다.
 * @param {import('ui/layout/_layout_handler.js').LayoutHandler} handler - 확인 버튼을 추가한 레이아웃 핸들러입니다.
 */
export const applyOverlayConfirmButtonIcon = (handler) => {
    const iconKey = getLangString(AFFIRMATIVE_ICON_LANG_KEY) === CHECK_ICON_KEY
        ? CHECK_ICON_KEY
        : CONFIRM_ICON_KEY;
    handler.icon(iconKey).buttonColor(ColorSchemes.Overlay.Button.Confirm);
};
