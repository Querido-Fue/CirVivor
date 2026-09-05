import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';

import {
    waitForChildWithTimeout
} from './support/nw_child_process_guard.mjs';

test('NW child guard는 정상 종료를 timeout으로 오판하지 않는다', async () => {
    const child = spawn(process.execPath, ['-e', 'process.exit(0)'], {
        shell: false,
        stdio: 'ignore',
        windowsHide: true
    });
    const result = await waitForChildWithTimeout(child, 5_000);
    assert.equal(result.timedOut, false);
    assert.equal(result.exit.exitCode, 0);
    assert.equal(result.exit.signal, null);
    assert.equal(result.terminationMethod, null);
});

test('NW child guard는 제한시간을 넘긴 exact process tree를 종료한 뒤 반환한다', async () => {
    const child = spawn(
        process.execPath,
        ['-e', 'setInterval(() => {}, 1_000)'],
        {
            shell: false,
            stdio: 'ignore',
            windowsHide: true
        }
    );
    const result = await waitForChildWithTimeout(child, 100, {
        terminationGraceMs: 5_000
    });
    assert.equal(result.timedOut, true);
    assert.ok([
        'taskkill-tree',
        'child-kill-fallback',
        'sigkill',
        'already-exited'
    ].includes(result.terminationMethod));
    assert.ok(result.exit.exitCode !== null || result.exit.signal !== null);
    assert.equal(child.exitCode !== null || child.signalCode !== null, true);
});

test('NW child guard는 잘못된 timeout을 process 실행 전에 거절한다', async () => {
    await assert.rejects(
        waitForChildWithTimeout(Object.freeze({}), 0),
        /양의 safe integer/
    );
});
