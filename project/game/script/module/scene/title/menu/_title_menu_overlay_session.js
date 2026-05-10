import { getData } from 'data/data_handler.js';
import { OverlaySession } from 'overlay/_overlay_session.js';
import { getSetting } from 'save/save_system.js';
import { getThemeAwareMenuBorderColor } from './_title_menu_theme.js';

const TITLE_MENU_OVERLAY_EFFECTS = getData('TITLE_MENU_DATA').OVERLAY_EFFECTS;

/**
 * 타이틀 메뉴 glass panel용 OverlaySession을 생성합니다.
 * @param {object|null|undefined} displaySystem - 현재 display system입니다.
 * @returns {OverlaySession|null} 생성된 overlay session입니다.
 */
export function createTitleMenuOverlaySession(displaySystem) {
    if (!displaySystem) {
        return null;
    }

    return new OverlaySession({
        displaySystem,
        layer: 10,
        dim: 0,
        transparent: true,
        glOverlay: true,
        blurUpdateMode: 'always',
        disableTransparency: getSetting('disableTransparency'),
        orderSequence: 1,
        effects: _createTitleMenuOverlayEffects()
    });
}

/**
 * 타이틀 메뉴 overlay effect 옵션을 생성합니다.
 * @returns {object} OverlaySession에 전달할 effect 옵션 맵입니다.
 */
function _createTitleMenuOverlayEffects() {
    return {
        hoverTilt: { ...TITLE_MENU_OVERLAY_EFFECTS.hoverTilt },
        hoverSpotlight: { ...TITLE_MENU_OVERLAY_EFFECTS.hoverSpotlight },
        hoverBorder: {
            ...TITLE_MENU_OVERLAY_EFFECTS.hoverBorder,
            color: getThemeAwareMenuBorderColor()
        },
        clickRipple: { ...TITLE_MENU_OVERLAY_EFFECTS.clickRipple },
        hoverParticle: { ...TITLE_MENU_OVERLAY_EFFECTS.hoverParticle }
    };
}
