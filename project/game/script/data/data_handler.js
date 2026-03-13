import { GLOBAL_CONSTANTS } from 'data/global/global_constants.js';
import {
    LightTheme,
    DarkTheme,
    THEMES,
    THEME_KEYS,
    THEME_OPTIONS,
    DEFAULT_THEME_KEY,
    getThemeByKey
} from 'data/theme/theme_registry.js';
import { BUTTON_CONSTANTS } from 'data/ui/layout/button_constants.js';
import { UI_CONSTANTS } from 'data/ui/layout/ui_constants.js';
import { TEXT_CONSTANTS } from 'data/ui/typography/text_constants.js';
import { CURSOR_CONSTANTS } from 'data/ui/cursor/cursor_constants.js';
import {
    ENEMY_CONSTANTS
} from 'data/object/enemy/enemy_constants.js';
import {
    ENEMY_DRAW_HEIGHT_RATIO,
    ENEMY_SHAPE_TYPES,
    ENEMY_ASPECT_RATIO,
    ENEMY_HEIGHT_SCALE,
    ENEMY_DEFAULT_WEIGHT,
    getEnemyShapeKey,
    ENEMY_WEBGL_SHAPES
} from 'data/object/enemy/enemy_shape_data.js';
import { ENEMY_SVG_SHAPES } from 'data/object/enemy/enemy_svg_shape_data.js';
import { TITLE_CONSTANTS } from 'data/scene/title/title_constants.js';
import { SOUND_CONSTANTS } from 'data/sound/sound_constants.js';
import { OVERLAY_LAYOUT_CONSTANTS } from 'data/overlay/overlay_layout_constants.js';
import { WEBGL_CONSTANTS } from 'data/display/webgl_constants.js';
import { OVERLAY_RENDER_CONSTANTS } from 'data/display/overlay_render_constants.js';
import { VIGNETTE_CONSTANTS } from 'data/display/vignette_constants.js';

const DATA_REGISTRY = Object.freeze({
    GLOBAL_CONSTANTS,
    LightTheme,
    DarkTheme,
    THEMES,
    THEME_KEYS,
    THEME_OPTIONS,
    DEFAULT_THEME_KEY,
    getThemeByKey,
    BUTTON_CONSTANTS,
    UI_CONSTANTS,
    TEXT_CONSTANTS,
    CURSOR_CONSTANTS,
    ENEMY_CONSTANTS,
    ENEMY_DRAW_HEIGHT_RATIO,
    ENEMY_SHAPE_TYPES,
    ENEMY_ASPECT_RATIO,
    ENEMY_HEIGHT_SCALE,
    ENEMY_DEFAULT_WEIGHT,
    getEnemyShapeKey,
    ENEMY_WEBGL_SHAPES,
    ENEMY_SVG_SHAPES,
    TITLE_CONSTANTS,
    SOUND_CONSTANTS,
    OVERLAY_LAYOUT_CONSTANTS,
    WEBGL_CONSTANTS,
    OVERLAY_RENDER_CONSTANTS,
    VIGNETTE_CONSTANTS
});

/**
 * 지정된 키에 해당하는 데이터를 반환합니다.
 * @param {string} key 데이터 키
 * @returns {any} 등록된 데이터
 */
export const getData = (key) => {
    if (!Object.prototype.hasOwnProperty.call(DATA_REGISTRY, key)) {
        throw new Error(`[DataHandler] Unknown data key: ${key}`);
    }
    return DATA_REGISTRY[key];
};
