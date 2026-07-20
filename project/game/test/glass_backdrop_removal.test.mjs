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
    titleMenuSource,
    settingsOverlaySource,
    settingsStateSource,
    settingHandlerSource
] = await Promise.all([
    readSource('../script/data/display/overlay_render_constants.js'),
    readSource('../script/module/overlay/_overlay_session.js'),
    readSource('../script/module/scene/title/menu/_title_menu_overlay_session.js'),
    readSource('../script/module/scene/title/menu/_title_menu_theme.js'),
    readSource('../script/module/scene/title/_title_menu.js'),
    readSource('../script/module/overlay/title/_settings_overlay.js'),
    readSource('../script/module/overlay/title/settings/_settings_state.js'),
    readSource('../script/module/save/_setting_handler.js')
]);

assert.match(
    overlayConstantsSource,
    /BACKDROP_SAMPLING_ENABLED:\s*true/
);

const effectiveTransparencyContract = /this\.effectiveTransparent\s*=\s*OVERLAY_RENDER_CONSTANTS\.BACKDROP_SAMPLING_ENABLED\s*===\s*true\s*&&\s*this\.transparent\s*&&\s*!disableTransparency/;
assert.match(overlaySessionSource, effectiveTransparencyContract);
assert.match(
    overlaySessionSource,
    /this\.needsEffectSurface\s*=\s*this\.effectiveTransparent\s*\|\|\s*this\.glOverlay\s*\|\|\s*this\.hasRegisteredEffects/
);
assert.match(
    overlaySessionSource,
    /requiresBackdropComposite\(\)\s*\{\s*return Boolean\(this\.effectLayerId\)\s*&&\s*this\.getGlassMix\(\)\s*>\s*0\s*&&\s*this\.alpha\s*>\s*0;/s
);
assert.match(overlayConstantsSource, /GLASS_TRANSITION_DURATION_SECONDS:\s*0\.4/);
assert.match(overlayConstantsSource, /GLASS_TRANSITION_EASING:\s*'easeOutExpo'/);
assert.match(
    overlaySessionSource,
    /setDisableTransparency\(disableTransparency\)[\s\S]*?variable:\s*'glassMix',[\s\S]*?duration:\s*OVERLAY_RENDER_CONSTANTS\.GLASS_TRANSITION_DURATION_SECONDS,[\s\S]*?type:\s*OVERLAY_RENDER_CONSTANTS\.GLASS_TRANSITION_EASING/s
);
assert.match(
    overlaySessionSource,
    /#finalizeGlassTransition\(target\)[\s\S]*?if \(!this\.effectiveTransparent\) \{\s*this\.#releaseFloatingSurfaces\(\);/s
);

assert.match(
    titleMenuSessionSource,
    /transparent:\s*true/
);
assert.match(
    titleMenuSessionSource,
    /glOverlay:\s*true/
);
assert.match(
    titleMenuSessionSource,
    /disableTransparency:\s*getSetting\('disableTransparency'\)/
);
assert.match(
    titleMenuThemeSource,
    /getMenuBackdropPaneStyle\(disableTransparency, unifiedStroke\)[\s\S]*?if \(disableTransparency\)[\s\S]*?sampleBackdrop:\s*false[\s\S]*?return \{[\s\S]*?sampleBackdrop:\s*true/
);

assert.match(settingsOverlaySource, /super\(TitleScene, \{ glOverlay: true, titleIconId: 'setting' \}\)/);
assert.match(settingsOverlaySource, /item\("toggle", "control_disableTransparency"\)/);
assert.match(settingsStateSource, /disableTransparency:\s*getSetting\('disableTransparency'\) \|\| false/);
assert.match(
    settingHandlerSource,
    /disableTransparency:\s*\{[^}]*hidden:\s*false/
);
assert.match(titleMenuSource, /this\.session\.setDisableTransparency\(getSetting\('disableTransparency'\)\)/);
assert.match(titleMenuSource, /getDisplaySystem\(\)\?\.webGLHandler\?\.flushAll\(\)/);
assert.match(
    settingHandlerSource,
    /if \(nextTheme !== previousTheme\) \{\s*beginThemeTransition\(previousThemeBackground\);/s
);
assert.doesNotMatch(settingHandlerSource, /nextDisableTransparency !== previousDisableTransparency/);

const baseOverlaySource = await readSource('../script/module/overlay/_base_overlay.js');
assert.match(
    baseOverlaySource,
    /changedSettings\.disableTransparency !== undefined[\s\S]*?this\.session\.setDisableTransparency\(getSetting\('disableTransparency'\)\);[\s\S]*?if \(shouldResize\) \{/s
);

console.log('glass transparency option contract: ok');
