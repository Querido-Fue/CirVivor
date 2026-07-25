import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadGameModule } from './support/source_module_loader.mjs';

const presetModule = await loadGameModule(
    'overlay/_animation_presets.js'
);
const preset = presetModule.getOverlayAnimationPreset();
assert.equal('dim' in preset, false);

assert.deepEqual(
    {
        alpha: { ...preset.open.alpha },
        scale: { ...preset.open.scale },
        blur: { ...preset.open.blur }
    },
    {
        alpha: { from: 0, to: 1, duration: 0.5, easing: 'easeOutExpo' },
        scale: { from: 0.9, to: 1, duration: 0.5, easing: 'easeOutExpo' },
        blur: { from: 10, to: 0, duration: 0.5, easing: 'easeOutExpo' }
    }
);
assert.deepEqual(
    {
        alpha: { ...preset.close.alpha },
        scale: { ...preset.close.scale },
        blur: { ...preset.close.blur }
    },
    {
        alpha: { to: 0, duration: 0.5, easing: 'easeInExpo' },
        scale: { to: 0.9, duration: 0.5, easing: 'easeInExpo' },
        blur: { to: 10, duration: 0.5, easing: 'easeInExpo' }
    }
);

const baseOverlaySource = await readFile(
    new URL('../script/module/overlay/_base_overlay.js', import.meta.url),
    'utf8'
);
assert.match(baseOverlaySource, /variable: 'contentBlur'/);
assert.match(baseOverlaySource, /blurStart: isOpening \? phaseConfig\.blur\.from : this\.contentBlur/);
assert.match(
    baseOverlaySource,
    /Promise\.all\(\[[\s\S]*?blurAnimation\.promise[\s\S]*?\]\)\.then\(\(\) => \{[\s\S]*?options\.onComplete\(\)/
);
assert.match(baseOverlaySource, /this\.session\.setContentBlur\(this\.contentBlur\)/);
assert.doesNotMatch(baseOverlaySource, /ConnectedOpen|setContentTransform/);

const titleCardRegistrySource = await readFile(
    new URL('../script/module/scene/title/menu/_title_menu_card_registry.js', import.meta.url),
    'utf8'
);
assert.doesNotMatch(titleCardRegistrySource, /overlayClass|overlay\/title\//);

const surfacePoolSource = await readFile(
    new URL('../script/module/display/_surface_pool.js', import.meta.url),
    'utf8'
);
assert.match(surfacePoolSource, /canvas\.style\.filter = 'none'/);

console.log('overlay presentation animation contract: ok');
