import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const GAME_DIRECTORY = path.resolve(TEST_DIRECTORY, '..', 'project', 'game');
const SCRIPT_DIRECTORY = path.join(GAME_DIRECTORY, 'script');
const SUPPORT_RUNNER_PATH = path.join(
    TEST_DIRECTORY,
    'support',
    'run_nw_webgpu_capability.mjs'
);
const R5_RUNNER_PATH = path.join(
    TEST_DIRECTORY,
    'nw_webgpu_capability',
    'r5_actor_verbs_runner.js'
);

const IMPORT_SPECIFIER_PATTERNS = Object.freeze([
    /\b(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g
]);

function posixRelative(root, filePath) {
    return path.relative(root, filePath).split(path.sep).join('/');
}

function importedSpecifiers(source) {
    const specifiers = new Set();
    for (const pattern of IMPORT_SPECIFIER_PATTERNS) {
        pattern.lastIndex = 0;
        for (const match of source.matchAll(pattern)) {
            specifiers.add(match[1]);
        }
    }
    return [...specifiers];
}

function resolveProductionImport(specifier, importerPath) {
    const aliases = Object.freeze({
        'data/': path.join(SCRIPT_DIRECTORY, 'data'),
        'ingame/': path.join(SCRIPT_DIRECTORY, 'module', 'ingame'),
        'object/': path.join(SCRIPT_DIRECTORY, 'module', 'object'),
        'util/': path.join(SCRIPT_DIRECTORY, 'util')
    });
    for (const [prefix, directory] of Object.entries(aliases)) {
        if (specifier.startsWith(prefix)) {
            return path.resolve(directory, specifier.slice(prefix.length));
        }
    }
    const stagedPrefix = './production/script/';
    if (specifier.startsWith(stagedPrefix)) {
        return path.resolve(
            SCRIPT_DIRECTORY,
            specifier.slice(stagedPrefix.length)
        );
    }
    if (specifier.startsWith('.')) {
        return path.resolve(path.dirname(importerPath), specifier);
    }
    return null;
}

test('R5 actual-GPU fixture는 모든 transitive production module을 격리 앱에 포함한다', async () => {
    const supportSource = await readFile(SUPPORT_RUNNER_PATH, 'utf8');
    const manifestMatch = supportSource.match(
        /const PRODUCTION_SCRIPT_MODULE_FILES = Object\.freeze\(\[([\s\S]*?)\]\);/
    );
    assert.ok(manifestMatch, 'NW production module manifest를 찾지 못했습니다.');
    const included = new Set(
        [...manifestMatch[1].matchAll(/'([^']+)'/g)]
            .map((match) => match[1])
    );

    const pending = [R5_RUNNER_PATH];
    const visited = new Set();
    const missing = new Set();
    while (pending.length > 0) {
        const importerPath = pending.pop();
        if (visited.has(importerPath)) continue;
        visited.add(importerPath);
        const source = await readFile(importerPath, 'utf8');
        for (const specifier of importedSpecifiers(source)) {
            const resolved = resolveProductionImport(specifier, importerPath);
            if (!resolved || !resolved.startsWith(SCRIPT_DIRECTORY)) continue;
            const relative = posixRelative(SCRIPT_DIRECTORY, resolved);
            if (!included.has(relative)) missing.add(relative);
            pending.push(resolved);
        }
    }

    assert.deepEqual([...missing].sort(), []);
    assert.ok(visited.size > 20,
        `R5 fixture module closure가 비정상적으로 작습니다: ${visited.size}`);
});
