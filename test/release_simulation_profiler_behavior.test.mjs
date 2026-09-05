import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT_ROOT = fileURLToPath(new URL('../project/game/script/', import.meta.url));
const HUD_PATH = path.join(SCRIPT_ROOT, 'module', 'debug', '_release_simulation_profiler_hud.js');
const PROFILER_PATH = path.join(SCRIPT_ROOT, 'module', 'simulation', 'release_simulation_profiler.js');
const [hudSource, profilerSource] = await Promise.all([
    readFile(HUD_PATH, 'utf8'),
    readFile(PROFILER_PATH, 'utf8')
]);

test('release simulation profiler 구현 상수는 전용 코드 모듈을 사용한다', () => {

    assert.doesNotMatch(hudSource, /data\/data_handler\.js/);
    assert.doesNotMatch(profilerSource, /data\/data_handler\.js/);
    assert.match(hudSource, /RELEASE_SIMULATION_PROFILER_CONSTANTS/);
    assert.match(hudSource, /const HUD_CONSTANTS = RELEASE_SIMULATION_PROFILER_CONSTANTS\.HUD;/);
    assert.match(profilerSource, /RELEASE_SIMULATION_PROFILER_CONSTANTS/);
});
