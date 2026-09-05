import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadGameModule } from './support/source_module_loader.mjs';

const { shouldEnableTitleMenuPaneInteraction } = await loadGameModule(
    'scene/title/menu/_title_menu_interaction.js'
);

assert.equal(shouldEnableTitleMenuPaneInteraction(true, null), true);
assert.equal(shouldEnableTitleMenuPaneInteraction(true, 'foreground-card'), false);
assert.equal(shouldEnableTitleMenuPaneInteraction(false, null), false);

const titleMenuSource = await readFile(
    new URL('../project/game/script/module/scene/title/_title_menu.js', import.meta.url),
    'utf8'
);
assert.match(
    titleMenuSource,
    /shouldEnableTitleMenuPaneInteraction\(\s*isInteractive,\s*this\.hoveredCardId\s*\)/
);
assert.match(
    titleMenuSource,
    /shouldEnableTitleMenuPaneInteraction\(\s*isInteractive,\s*this\.hoveredSecondaryMenuId\s*\)/
);

console.log('title menu hover layering contract: ok');
