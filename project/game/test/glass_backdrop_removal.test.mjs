import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readSource = (relativePath) => readFile(
    new URL(relativePath, import.meta.url),
    'utf8'
);

const [
    overlayConstantsSource,
    overlaySessionSource,
    titleMenuSessionSource,
    titleMenuThemeSource,
    settingsOverlaySource,
    settingHandlerSource
] = await Promise.all([
    readSource('../script/data/display/overlay_render_constants.js'),
    readSource('../script/module/overlay/_overlay_session.js'),
    readSource('../script/module/scene/title/menu/_title_menu_overlay_session.js'),
    readSource('../script/module/scene/title/menu/_title_menu_theme.js'),
    readSource('../script/module/overlay/title/_settings_overlay.js'),
    readSource('../script/module/save/_setting_handler.js')
]);

assert.match(
    overlayConstantsSource,
    /BACKDROP_SAMPLING_ENABLED:\s*false/
);

const effectiveTransparencyContract = /this\.effectiveTransparent\s*=\s*OVERLAY_RENDER_CONSTANTS\.BACKDROP_SAMPLING_ENABLED\s*===\s*true\s*&&\s*this\.transparent\s*&&\s*!disableTransparency/;
assert.match(overlaySessionSource, effectiveTransparencyContract);
assert.match(
    overlaySessionSource,
    /this\.needsEffectSurface\s*=\s*this\.effectiveTransparent\s*\|\|\s*this\.glOverlay\s*\|\|\s*this\.hasRegisteredEffects/
);
assert.match(
    overlaySessionSource,
    /requiresBackdropComposite\(\)\s*\{\s*return Boolean\(this\.effectLayerId\)\s*&&\s*this\.effectiveTransparent\s*&&\s*this\.alpha\s*>\s*0;/s
);

assert.match(
    titleMenuSessionSource,
    /transparent:\s*false/
);
assert.match(
    titleMenuSessionSource,
    /glOverlay:\s*true/
);
assert.match(
    titleMenuThemeSource,
    /getMenuPanelStyle\(disableTransparency\)[\s\S]*?sampleBackdrop:\s*false[\s\S]*?blur:\s*0/
);
assert.match(
    titleMenuThemeSource,
    /getMenuBackdropPaneStyle\(disableTransparency, unifiedStroke\)[\s\S]*?sampleBackdrop:\s*false[\s\S]*?blur:\s*0/
);

assert.doesNotMatch(settingsOverlaySource, /disableTransparency/);
assert.match(
    settingHandlerSource,
    /disableTransparency:\s*\{[^}]*hidden:\s*true/
);

console.log('glass backdrop removal contract: ok');
