import { GLOBAL_CONSTANTS } from 'data/global/global_constants.js';
import { APP_PAUSE_DATA } from 'data/global/app_pause_data.js';
import { SYSTEM_RUNTIME_POLICY_DATA } from 'data/global/system_runtime_policy_data.js';
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
import { TOOLTIP_CONSTANTS } from 'data/ui/tooltip/tooltip_constants.js';
import {
    ENEMY_CONSTANTS
} from 'data/object/enemy/enemy_constants.js';
import { ENEMY_AI_CONSTANTS } from 'data/object/enemy/enemy_ai_constants.js';
import { HEXA_HIVE_LAYOUT_DATA } from 'data/object/enemy/hexa_hive_layout_data.js';
import {
    ENEMY_DRAW_HEIGHT_RATIO,
    ENEMY_SHAPE_TYPES,
    ENEMY_ASPECT_RATIO,
    ENEMY_HEIGHT_SCALE,
    ENEMY_DEFAULT_WEIGHT,
    ENEMY_COLLISION_RADIUS_DATA,
    getEnemyShapeKey,
    ENEMY_WEBGL_SHAPES
} from 'data/object/enemy/enemy_shape_data.js';
import { ENEMY_SVG_SHAPES } from 'data/object/enemy/enemy_svg_shape_data.js';
import { TITLE_CONSTANTS } from 'data/scene/title/title_constants.js';
import { TITLE_LINK_DATA } from 'data/scene/title/title_link_data.js';
import { GAME_SCENE_CONSTANTS } from 'data/scene/game/game_scene_constants.js';
import { TITLE_MENU_DATA } from 'data/scene/title/title_menu_data.js';
import { TITLE_MENU_ICON_DATA } from 'data/scene/title/title_menu_icon_data.js';
import { TITLE_MAGIC_BENTO_DATA } from 'data/scene/title/title_magic_bento_data.js';
import { GAME_SCENE_COMMAND_TYPES } from 'data/simulation/game_scene_command_types.js';
import { SIMULATION_RUNTIME_DEFAULTS } from 'data/simulation/simulation_runtime_defaults.js';
import { PHYSICS_CONSTANTS } from 'data/physics/physics_constants.js';
import { COLLISION_CONSTANTS } from 'data/physics/collision_constants.js';
import { DEBUG_CONSTANTS } from 'data/debug/debug_constants.js';
import { SOUND_CONSTANTS } from 'data/sound/sound_constants.js';
import { OVERLAY_LAYOUT_CONSTANTS } from 'data/overlay/overlay_layout_constants.js';
import { WEBGL_CONSTANTS } from 'data/display/webgl_constants.js';
import { OVERLAY_RENDER_CONSTANTS } from 'data/display/overlay_render_constants.js';
import { VIGNETTE_CONSTANTS } from 'data/display/vignette_constants.js';
import { DISPLAY_SURFACE_DATA } from 'data/display/display_surface_data.js';
import { MOUSE_BUTTON_INPUT_DATA } from 'data/input/mouse_button_input_data.js';

const DATA_REGISTRY = Object.freeze({
    GLOBAL_CONSTANTS,
    APP_PAUSE_DATA,
    SYSTEM_RUNTIME_POLICY_DATA,
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
    TOOLTIP_CONSTANTS,
    ENEMY_CONSTANTS,
    ENEMY_AI_CONSTANTS,
    HEXA_HIVE_LAYOUT_DATA,
    ENEMY_DRAW_HEIGHT_RATIO,
    ENEMY_SHAPE_TYPES,
    ENEMY_ASPECT_RATIO,
    ENEMY_HEIGHT_SCALE,
    ENEMY_DEFAULT_WEIGHT,
    ENEMY_COLLISION_RADIUS_DATA,
    getEnemyShapeKey,
    ENEMY_WEBGL_SHAPES,
    ENEMY_SVG_SHAPES,
    TITLE_CONSTANTS,
    TITLE_LINK_DATA,
    GAME_SCENE_CONSTANTS,
    TITLE_MENU_DATA,
    TITLE_MENU_ICON_DATA,
    TITLE_MAGIC_BENTO_DATA,
    GAME_SCENE_COMMAND_TYPES,
    SIMULATION_RUNTIME_DEFAULTS,
    PHYSICS_CONSTANTS,
    COLLISION_CONSTANTS,
    DEBUG_CONSTANTS,
    SOUND_CONSTANTS,
    OVERLAY_LAYOUT_CONSTANTS,
    WEBGL_CONSTANTS,
    OVERLAY_RENDER_CONSTANTS,
    VIGNETTE_CONSTANTS,
    DISPLAY_SURFACE_DATA,
    MOUSE_BUTTON_INPUT_DATA
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
