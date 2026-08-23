import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT_ROOT = fileURLToPath(new URL('../script/', import.meta.url));
const SYSTEM_HANDLER_PATH = path.join(SCRIPT_ROOT, 'module', 'system_handler.js');
const ANIMATION_SYSTEM_PATH = path.join(
    SCRIPT_ROOT,
    'module',
    'animation',
    'animation_system.js'
);
const EXPECTED_CALLERS = Object.freeze({
    'module/display/_theme_transition_controller.js': Object.freeze({
        category: 'EFFECT',
        count: 1
    }),
    'module/ingame/input/camera_zoom_controller.js': Object.freeze({
        category: 'GAME_MECHANIC',
        count: 2
    }),
    'module/overlay/_base_overlay.js': Object.freeze({ category: 'UI', count: 4 }),
    'module/overlay/_overlay_session.js': Object.freeze({ category: 'UI', count: 1 }),
    'module/scene/game/shop/shop_overlay_renderer.js': Object.freeze({
        category: 'UI',
        count: 1
    }),
    'module/scene/title/_title_loading_sequence.js': Object.freeze({
        category: 'EFFECT',
        count: 1
    }),
    'module/scene/title/_title_scene_intro_sequence.js': Object.freeze({
        category: 'EFFECT',
        count: 2
    }),
    'module/ui/cursor/ui_cursor.js': Object.freeze({ category: 'UI', count: 1 }),
    'module/ui/element/_base_element.js': Object.freeze({ category: 'UI', count: 1 }),
    'module/ui/element/_dropdown.js': Object.freeze({ category: 'UI', count: 2 }),
    'module/ui/element/_segment_control.js': Object.freeze({ category: 'UI', count: 1 }),
    'module/ui/element/_slider.js': Object.freeze({ category: 'UI', count: 2 }),
    'module/ui/element/_toggle.js': Object.freeze({ category: 'UI', count: 1 })
});

/**
 * 디렉터리 아래 production JavaScript 파일을 재귀적으로 수집합니다.
 * @param {string} directory - 탐색할 디렉터리입니다.
 * @returns {Promise<string[]>} 절대 파일 경로 목록입니다.
 */
async function collectJavaScriptFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...await collectJavaScriptFiles(entryPath));
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            files.push(entryPath);
        }
    }
    return files;
}

/**
 * 주석과 string/template literal을 같은 길이의 공백으로 바꾸어 실행 identifier만 남깁니다.
 * @param {string} source - JavaScript 소스입니다.
 * @returns {string} 줄 위치가 보존된 실행 소스입니다.
 */
function stripCommentsAndLiterals(source) {
    let result = '';
    let state = 'code';
    let quote = '';
    for (let index = 0; index < source.length; index++) {
        const character = source[index];
        const nextCharacter = source[index + 1];

        if (state === 'code') {
            if (character === '/' && nextCharacter === '/') {
                result += '  ';
                index += 1;
                state = 'line-comment';
            } else if (character === '/' && nextCharacter === '*') {
                result += '  ';
                index += 1;
                state = 'block-comment';
            } else if (character === '\'' || character === '"' || character === '`') {
                quote = character;
                result += ' ';
                state = 'literal';
            } else {
                result += character;
            }
            continue;
        }

        if (state === 'line-comment') {
            if (character === '\n') {
                result += '\n';
                state = 'code';
            } else {
                result += ' ';
            }
            continue;
        }

        if (state === 'block-comment') {
            if (character === '*' && nextCharacter === '/') {
                result += '  ';
                index += 1;
                state = 'code';
            } else {
                result += character === '\n' ? '\n' : ' ';
            }
            continue;
        }

        if (character === '\\') {
            result += ' ';
            if (index + 1 < source.length) {
                result += source[index + 1] === '\n' ? '\n' : ' ';
                index += 1;
            }
        } else if (character === quote) {
            result += ' ';
            state = 'code';
        } else {
            result += character === '\n' ? '\n' : ' ';
        }
    }
    return result;
}

/**
 * 정규식 전역 일치 수를 계산합니다.
 * @param {string} source - 검색할 소스입니다.
 * @param {RegExp} pattern - global 정규식입니다.
 * @returns {number} 일치 수입니다.
 */
function countMatches(source, pattern) {
    return Array.from(source.matchAll(pattern)).length;
}

test('production animation ingress는 정확히 UI 14 / GAME_MECHANIC 2 / EFFECT 4로 분류된다', async () => {
    const files = await collectJavaScriptFiles(SCRIPT_ROOT);
    const actualCallers = new Map();
    for (const filePath of files) {
        const relativePath = path.relative(SCRIPT_ROOT, filePath).replaceAll('\\', '/');
        if (relativePath.startsWith('module/animation/')) {
            continue;
        }
        const source = await readFile(filePath, 'utf8');
        const executableSource = stripCommentsAndLiterals(source);
        const ingressCount = countMatches(
            executableSource,
            /\b(?:animateMixed|animatePersist|animate)\s*\(/g
        );
        if (ingressCount > 0) {
            actualCallers.set(relativePath, { source, executableSource, ingressCount });
        }
    }

    assert.deepEqual(
        Array.from(actualCallers.keys()).sort(),
        Object.keys(EXPECTED_CALLERS).sort()
    );
    const categoryTotals = { UI: 0, GAME_MECHANIC: 0, EFFECT: 0 };
    let totalIngressCount = 0;
    for (const [relativePath, expectation] of Object.entries(EXPECTED_CALLERS)) {
        const caller = actualCallers.get(relativePath);
        assert.equal(caller.ingressCount, expectation.count, relativePath);
        assert.match(
            caller.source,
            /import\s*\{[^}]*\bANIMATION_CATEGORY\b[^}]*\}\s*from\s*['"]animation\/(?:animation_system|_constants)\.js['"]/s,
            `${relativePath}: stable category authority import`
        );
        const categoryCounts = {
            UI: countMatches(
                caller.executableSource,
                /\banimationCategory\s*:\s*ANIMATION_CATEGORY\s*\.\s*UI\b/g
            ),
            GAME_MECHANIC: countMatches(
                caller.executableSource,
                /\banimationCategory\s*:\s*ANIMATION_CATEGORY\s*\.\s*GAME_MECHANIC\b/g
            ),
            EFFECT: countMatches(
                caller.executableSource,
                /\banimationCategory\s*:\s*ANIMATION_CATEGORY\s*\.\s*EFFECT\b/g
            )
        };
        assert.equal(categoryCounts[expectation.category], expectation.count, relativePath);
        assert.equal(
            Object.values(categoryCounts).reduce((sum, count) => sum + count, 0),
            expectation.count,
            `${relativePath}: ingress/category count`
        );
        categoryTotals[expectation.category] += expectation.count;
        totalIngressCount += expectation.count;
    }

    assert.equal(totalIngressCount, 20);
    assert.deepEqual(categoryTotals, { UI: 14, GAME_MECHANIC: 2, EFFECT: 4 });
});

test('AnimationSystem은 Save를 import하지 않고 SystemHandler가 hidden setting live resolver만 주입한다', async () => {
    const [animationSystemSource, systemHandlerSource] = await Promise.all([
        readFile(ANIMATION_SYSTEM_PATH, 'utf8'),
        readFile(SYSTEM_HANDLER_PATH, 'utf8')
    ]);
    assert.doesNotMatch(animationSystemSource, /(?:^|\n)\s*import[^;]*save\//);
    assert.match(
        systemHandlerSource,
        /new AnimationSystem\(\{\s*getUiAnimationDurationScale:\s*\(\)\s*=>\s*\(\s*this\.saveSystem\.getSetting\('uiAnimationDurationScale'\)\s*\)\s*\}\)/s
    );
    const simulationKeys = systemHandlerSource.match(
        /const SIMULATION_RUNTIME_SETTING_KEYS\s*=\s*Object\.freeze\((\[[^;]+\])\);/s
    );
    assert.ok(simulationKeys);
    assert.doesNotMatch(simulationKeys[1], /uiAnimationDurationScale/);
});
