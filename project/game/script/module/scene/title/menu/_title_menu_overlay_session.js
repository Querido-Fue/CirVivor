import { OverlaySession } from 'overlay/_overlay_session.js';
import { getSetting } from 'save/save_system.js';
import { getThemeAwareMenuBorderColor } from './_title_menu_theme.js';

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
        effects: {
            hoverTilt: {
                maxAngleDeg: 6,
                smoothing: 0.18,
                perspective: 1180
            },
            hoverSpotlight: {
                radius: 280,
                opacity: 0.8,
                smoothing: 0.2
            },
            hoverBorder: {
                radius: 280,
                color: getThemeAwareMenuBorderColor(),
                opacity: 0.75,
                width: 1.2,
                hoverWidth: 2.4,
                falloff: 80,
                smoothing: 0.2
            },
            clickRipple: {
                duration: 0.8
            },
            hoverParticle: {
                count: 12,
                spawnInterval: 0.08,
                driftDistance: 84,
                minDuration: 1.8,
                maxDuration: 3.2
            }
        }
    });
}
