import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(
    new URL('../project/game/script/module/display/_surface_pool.js', import.meta.url),
    'utf8'
);

function createCanvas() {
    return {
        className: '',
        style: {},
        dataset: {},
        getContext(type) {
            return { type };
        }
    };
}

const context = vm.createContext({
    console,
    document: {
        createElement(tagName) {
            assert.equal(tagName, 'canvas');
            return createCanvas();
        }
    }
});
const numberUtilModule = new vm.SyntheticModule(
    ['clampFiniteNumber'],
    function initialize() {
        this.setExport('clampFiniteNumber', (value, min, max, fallback) => (
            Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
        ));
    },
    { context }
);
const surfacePoolModule = new vm.SourceTextModule(source, {
    context,
    identifier: '_surface_pool.js'
});
await surfacePoolModule.link((specifier) => {
    assert.equal(specifier, 'util/number_util.js');
    return numberUtilModule;
});
await surfacePoolModule.evaluate();

const { CanvasSurfacePool } = surfacePoolModule.namespace;

for (const type of ['2d', 'webgl']) {
    test(`${type} surface pool은 cutover의 hidden 상태를 다음 소유자에게 넘기지 않는다`, () => {
        const pool = new CanvasSurfacePool(type);
        const firstLease = pool.acquire();
        firstLease.canvas.style.visibility = 'hidden';

        pool.release(firstLease);
        assert.equal(firstLease.canvas.style.display, 'none');
        assert.equal(firstLease.canvas.style.visibility, '');

        // release 뒤 늦게 도착한 이전 소유자의 cutover 복원/숨김도 acquire가 방어합니다.
        firstLease.canvas.style.visibility = 'hidden';
        const secondLease = pool.acquire();
        assert.strictEqual(secondLease, firstLease);
        assert.equal(secondLease.canvas.style.display, '');
        assert.equal(secondLease.canvas.style.visibility, '');
        assert.equal(pool.getStats().createdCount, 1);
    });
}
