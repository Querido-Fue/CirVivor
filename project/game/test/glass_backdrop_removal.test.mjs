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
    titleOverlaySource,
    mapSelectOverlaySource,
    settingsOverlaySource,
    settingsStateSource,
    settingDefinitionsSource,
    settingHandlerSource,
    lightThemeSource
] = await Promise.all([
    readSource('../script/module/display/webgl/_webgl_constants.js'),
    readSource('../script/module/overlay/_overlay_session.js'),
    readSource('../script/module/scene/title/menu/_title_menu_overlay_session.js'),
    readSource('../script/module/scene/title/menu/_title_menu_theme.js'),
    readSource('../script/module/scene/title/_title_menu.js'),
    readSource('../script/module/overlay/title/_title_overlay.js'),
    readSource('../script/module/overlay/title/_map_select_overlay.js'),
    readSource('../script/module/overlay/title/_settings_overlay.js'),
    readSource('../script/module/overlay/title/settings/_settings_state.js'),
    readSource('../script/data/settings/setting_definitions.js'),
    readSource('../script/module/save/_setting_handler.js'),
    readSource('../script/data/theme/light_theme.js')
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
    /getGlassPanelAlpha\(\)[\s\S]*?return this\.effectiveTransparent \? 1 : 0;/s
);
assert.match(
    overlaySessionSource,
    /getOpaquePanelAlpha\(\)[\s\S]*?return 1 - this\.getGlassMix\(\);/s
);
assert.match(
    overlaySessionSource,
    /requiresBackdropComposite\(\)\s*\{\s*return !this\.#shouldSuppressLegacyTitleOverlayRender\(\)\s*&&\s*Boolean\(this\.effectLayerId\)[\s\S]*?this\.alpha\s*>\s*0;/s
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
    titleMenuSessionSource,
    /titleWebGpuContentBoundsAuthority:\s*'panels'/
);
assert.match(
    titleMenuThemeSource,
    /getMenuBackdropPaneStyle\(disableTransparency, unifiedStroke\)[\s\S]*?if \(disableTransparency\)[\s\S]*?sampleBackdrop:\s*false[\s\S]*?return \{[\s\S]*?sampleBackdrop:\s*true/
);
assert.match(
    titleMenuThemeSource,
    /getMenuPanelStyle\(disableTransparency\)[\s\S]*?if \(disableTransparency\) \{\s*return \{[\s\S]*?stroke:\s*false,[\s\S]*?lineWidth:\s*0,/
);
assert.match(
    titleMenuThemeSource,
    /getMenuBackdropPaneStyle\(disableTransparency, unifiedStroke\)[\s\S]*?if \(disableTransparency\) \{\s*return \{[\s\S]*?stroke:\s*getOpaqueMenuPanelStrokeColor\(\)/
);

assert.match(settingsOverlaySource, /super\(TitleScene, \{ glOverlay: true, titleIconId: 'setting' \}\)/);
assert.match(settingsOverlaySource, /item\("toggle", "control_disableTransparency"\)/);
assert.match(settingsStateSource, /disableTransparency:\s*getSetting\('disableTransparency'\) \|\| false/);
assert.match(
    settingDefinitionsSource,
    /disableTransparency:\s*Object\.freeze\(\{[^}]*hidden:\s*false/
);
assert.match(titleMenuSource, /this\.session\.setDisableTransparency\(getSetting\('disableTransparency'\)\)/);
assert.match(
    titleMenuSource,
    /if \(this\.session\.requiresBackdropComposite\?\.\(\) === true\) \{\s*getDisplaySystem\(\)\?\.webGLHandler\?\.flushAll\(\);/s
);
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
assert.match(
    baseOverlaySource,
    /let shouldResize = changedSettings\.theme !== undefined\s*\|\| changedSettings\.language !== undefined;/
);
assert.match(
    titleOverlaySource,
    /applyRuntimeSettings\(changedSettings = \{\}\) \{\s*if \(changedSettings\.theme !== undefined\) \{\s*this\._refreshTitleIconSource\(\);\s*\}\s*super\.applyRuntimeSettings\(changedSettings\);/
);
assert.doesNotMatch(
    mapSelectOverlaySource,
    /\n    applyRuntimeSettings\(changedSettings = \{\}\) \{/
);
assert.doesNotMatch(
    settingsOverlaySource,
    /\n    applyRuntimeSettings\(changedSettings = \{\}\) \{/
);
assert.match(baseOverlaySource, /const glassAlpha = typeof this\.session\?\.getGlassPanelAlpha/);
assert.match(baseOverlaySource, /const opaqueAlpha = typeof this\.session\?\.getOpaquePanelAlpha/);
assert.match(baseOverlaySource, /glassOptions\.alpha = glassAlpha/);
assert.match(baseOverlaySource, /flatOptions\.alpha = opaqueAlpha/);
assert.match(lightThemeSource, /GlassBackground:\s*'rgba\(236, 237, 239, 0\.92\)'/);
assert.match(lightThemeSource, /GlassTintStrength:\s*0\.36/);
assert.match(lightThemeSource, /ValueInactive:\s*'#666666'/);

console.log('glass transparency option contract: ok');
