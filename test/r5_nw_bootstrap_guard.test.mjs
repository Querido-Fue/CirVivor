import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const BOOTSTRAP_URL = new URL(
    './nw_webgpu_capability/r5_actor_verbs_bootstrap.js',
    import.meta.url
);
const BOOTSTRAP_SOURCE = await readFile(BOOTSTRAP_URL, 'utf8');

async function runBootstrapWith(options = {}) {
    let quitCount = 0;
    const errors = [];
    const writes = [];
    const context = vm.createContext({
        process: Object.freeze({
            env: Object.freeze({
                CIRVIVOR_WEBGPU_RESULT_PATH: options.resultPath
            })
        }),
        require: () => Object.freeze({
            writeFileSync(path, content, encoding) {
                writes.push({ path, content, encoding });
                if (options.writeFailure) throw options.writeFailure;
            }
        }),
        nw: Object.freeze({
            App: Object.freeze({
                quit() {
                    quitCount++;
                }
            })
        }),
        console: Object.freeze({
            error(value) {
                errors.push(String(value));
            }
        }),
        setTimeout,
        clearTimeout
    });
    const script = new vm.Script(BOOTSTRAP_SOURCE, {
        filename: 'r5_actor_verbs_bootstrap.js',
        importModuleDynamically: async () => {
            throw new Error('dynamic import는 이 fixture에서 호출되면 안 됩니다.');
        }
    });
    script.runInContext(context);
    await new Promise((resolve) => setImmediate(resolve));
    return Object.freeze({ quitCount, errors, writes });
}

test('R5 NW bootstrap은 result path 누락 시 열린 앱으로 남지 않고 종료한다', async () => {
    const result = await runBootstrapWith();
    assert.equal(result.quitCount, 1);
    assert.equal(result.writes.length, 0);
    assert.match(result.errors.join('\n'),
        /CIRVIVOR_WEBGPU_RESULT_PATH missing/);
});

test('R5 NW bootstrap은 첫 checkpoint write 실패도 진단 후 종료한다', async () => {
    const result = await runBootstrapWith({
        resultPath: 'R5_RESULT.json',
        writeFailure: new Error('fixture write failure')
    });
    assert.equal(result.quitCount, 1);
    assert.equal(result.writes.length, 2);
    assert.match(result.errors.join('\n'), /fixture write failure/);
});
