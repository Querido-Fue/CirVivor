import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const backendModule = await loadGameModule(
    'object/enemy/ai/wasm/_enemy_ai_flow_field_backend.js'
);
const navigationModule = await loadGameModule('object/enemy/ai/_enemy_ai_navigation.js');
const runtimeModule = await loadGameModule(
    'object/enemy/ai/wasm/_enemy_ai_flow_field_wasm_runtime.js'
);
const constantsModule = await loadGameModule('data/object/enemy/enemy_ai_constants.js');

/**
 * typed array 두 개의 모든 원시 바이트가 같은지 검사합니다.
 * @param {ArrayBufferView} actual - 실제 배열입니다.
 * @param {ArrayBufferView} expected - 기준 배열입니다.
 * @param {string} label - 실패 진단용 이름입니다.
 * @returns {void}
 */
function assertByteEqual(actual, expected, label) {
    assert.equal(actual.byteLength, expected.byteLength, `${label} byteLength`);
    const actualBytes = new Uint8Array(actual.buffer, actual.byteOffset, actual.byteLength);
    const expectedBytes = new Uint8Array(
        expected.buffer,
        expected.byteOffset,
        expected.byteLength
    );
    assert.deepEqual(Array.from(actualBytes), Array.from(expectedBytes), label);
}

test('backend은 작은 입력만 JS에 남기고 경계 이상 입력을 WASM에 위임한다', () => {
    let wasmCalls = 0;
    let jsCalls = 0;
    const backend = new backendModule.EnemyAIFlowFieldBackend({
        minimumWasmGridSize: 4,
        runtimeFactory: () => ({
            buildFlowField: () => {
                wasmCalls++;
                return { source: 'wasm' };
            }
        })
    });
    const jsBuilder = () => {
        jsCalls++;
        return { source: 'js' };
    };

    assert.equal(backend.buildFlowField({ size: 3 }, { cx: 0, cy: 0 }, jsBuilder).source, 'js');
    assert.equal(backend.buildFlowField({ size: 4 }, { cx: 0, cy: 0 }, jsBuilder).source, 'wasm');
    assert.equal(wasmCalls, 1);
    assert.equal(jsCalls, 1);
    assert.deepEqual(
        { ...backend.getStatus() },
        {
            state: 'wasm-ready',
            minimumWasmGridSize: 4,
            failure: null,
            wasmBuildCount: 1,
            jsBuildCount: 1
        }
    );
});

test('초기화 실패는 재시도 없이 영구 JS fallback으로 고정된다', () => {
    let factoryCalls = 0;
    let jsCalls = 0;
    const backend = new backendModule.EnemyAIFlowFieldBackend({
        minimumWasmGridSize: 1,
        runtimeFactory: () => {
            factoryCalls++;
            throw new Error('unsupported');
        }
    });
    const jsBuilder = () => {
        jsCalls++;
        return { source: 'js' };
    };

    assert.equal(backend.buildFlowField({ size: 4 }, {}, jsBuilder).source, 'js');
    assert.equal(backend.buildFlowField({ size: 4 }, {}, jsBuilder).source, 'js');
    assert.equal(factoryCalls, 1);
    assert.equal(jsCalls, 2);
    assert.deepEqual({ ...backend.getStatus().failure }, {
        stage: 'initialization',
        name: 'Error',
        message: 'unsupported'
    });
    assert.equal(backend.getStatus().state, 'js-permanent');
});

test('첫 WASM 실행 오류는 현재 호출부터 JS로 복구하고 이후 WASM을 재시도하지 않는다', () => {
    let wasmCalls = 0;
    let jsCalls = 0;
    const backend = new backendModule.EnemyAIFlowFieldBackend({
        minimumWasmGridSize: 1,
        runtimeFactory: () => ({
            buildFlowField: () => {
                wasmCalls++;
                throw new Error('trap');
            }
        })
    });
    const jsBuilder = () => {
        jsCalls++;
        return { source: 'js' };
    };

    assert.equal(backend.buildFlowField({ size: 4 }, {}, jsBuilder).source, 'js');
    assert.equal(backend.buildFlowField({ size: 4 }, {}, jsBuilder).source, 'js');
    assert.equal(wasmCalls, 1);
    assert.equal(jsCalls, 2);
    assert.deepEqual({ ...backend.getStatus().failure }, {
        stage: 'execution',
        name: 'Error',
        message: 'trap'
    });
    assert.equal(backend.getStatus().state, 'js-permanent');
});

test('실제 navigation cache miss는 WASM을 한 번 사용하고 같은 key hit는 재사용한다', async () => {
    const profile = constantsModule.ENEMY_AI_CONSTANTS.QUALITY_PROFILES.inline_safe;
    const context = {
        aiDebugStats: null,
        sharedFlowFieldByKey: new Map(),
        wallsVersion: 7001
    };
    const targetX = 800;
    const targetY = 600;
    const before = { ...backendModule.getEnemyAIFlowFieldBackendStatus() };
    assert.equal(before.state, 'wasm-ready');

    const first = navigationModule.getSharedFlowFieldForTargetCoords(
        context,
        [],
        1024,
        768,
        profile,
        12,
        targetX,
        targetY,
        'wasm-integration-test'
    );
    const afterMiss = { ...backendModule.getEnemyAIFlowFieldBackendStatus() };
    assert.equal(afterMiss.wasmBuildCount, before.wasmBuildCount + 1);
    assert.equal(afterMiss.jsBuildCount, before.jsBuildCount);

    const second = navigationModule.getSharedFlowFieldForTargetCoords(
        context,
        [],
        1024,
        768,
        profile,
        12,
        targetX,
        targetY,
        'wasm-integration-test'
    );
    assert.equal(second.key, first.key);
    assert.equal(second.field.goalIndex, first.field.goalIndex);
    assert.equal(
        backendModule.getEnemyAIFlowFieldBackendStatus().wasmBuildCount,
        afterMiss.wasmBuildCount
    );

    const goalCell = {
        cx: Math.floor(targetX / first.grid.cellSize),
        cy: Math.floor(targetY / first.grid.cellSize)
    };
    const directRuntime = await runtimeModule.createEnemyAIFlowFieldWasmRuntime();
    const direct = directRuntime.buildFlowField(first.grid, goalCell);
    assert.equal(first.field.goalIndex, direct.goalIndex);
    for (const plane of ['integration', 'dirX', 'dirY']) {
        assertByteEqual(first.field[plane], direct[plane], plane);
    }
});
