import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGameModule } from './support/source_module_loader.mjs';

const timerModule = await loadGameModule('display/webgl/_webgl_gpu_timer_query_ring.js');
const {
    invalidateWebGLGpuTimerQueryContext,
    WebGLGpuTimerQueryRing
} = timerModule;

function toHostSamples(samples) {
    return Array.from(samples, (sample) => ({
        scope: sample.scope,
        frameId: sample.frameId,
        gpuMs: sample.gpuMs
    }));
}

function createTimerHarness(api) {
    const records = {
        extensionRequests: [],
        queries: [],
        deletedQueryIds: [],
        beginCalls: [],
        endCalls: 0,
        availabilityReads: [],
        resultReads: [],
        disjointReads: 0,
        disjoint: false,
        throwOnAvailability: false,
        endAttemptCount: 0,
        endThrowCount: 0
    };
    let nextQueryId = 1;
    let activeQuery = null;

    function createQuery() {
        const query = {
            id: nextQueryId++,
            available: false,
            resultNanoseconds: 0,
            deleted: false
        };
        records.queries.push(query);
        return query;
    }

    function deleteQuery(query) {
        query.deleted = true;
        records.deletedQueryIds.push(query.id);
    }

    function beginQuery(target, query) {
        assert.equal(activeQuery, null, '합성 컨텍스트에도 query 중첩이 없어야 합니다.');
        activeQuery = query;
        records.beginCalls.push({ target, queryId: query.id });
    }

    function endQuery(target) {
        assert.notEqual(activeQuery, null, '활성 query 없이 end하면 안 됩니다.');
        records.endAttemptCount++;
        if (records.endThrowCount > 0) {
            records.endThrowCount--;
            throw new Error('synthetic end query failure');
        }
        records.endCalls++;
        records.lastEndTarget = target;
        activeQuery = null;
    }

    function readAvailability(query) {
        records.availabilityReads.push(query.id);
        if (records.throwOnAvailability) {
            throw new Error('synthetic availability failure');
        }
        return query.available;
    }

    function readResult(query) {
        records.resultReads.push(query.id);
        return query.resultNanoseconds;
    }

    const gl = {
        QUERY_RESULT_AVAILABLE: 0x8867,
        QUERY_RESULT: 0x8866,
        finish() {
            assert.fail('GPU timer는 finish를 호출하면 안 됩니다.');
        },
        getParameter(parameter) {
            assert.equal(parameter, 0x8FBB);
            records.disjointReads++;
            return records.disjoint;
        }
    };

    if (api === 'webgl2') {
        const extension = {
            TIME_ELAPSED_EXT: 0x88BF,
            GPU_DISJOINT_EXT: 0x8FBB
        };
        gl.getExtension = (name) => {
            records.extensionRequests.push(name);
            return name === 'EXT_disjoint_timer_query_webgl2' ? extension : null;
        };
        gl.createQuery = createQuery;
        gl.deleteQuery = deleteQuery;
        gl.beginQuery = beginQuery;
        gl.endQuery = endQuery;
        gl.getQueryParameter = (query, parameter) => {
            if (parameter === gl.QUERY_RESULT_AVAILABLE) {
                return readAvailability(query);
            }
            assert.equal(parameter, gl.QUERY_RESULT);
            return readResult(query);
        };
    } else {
        const extension = {
            TIME_ELAPSED_EXT: 0x88BF,
            GPU_DISJOINT_EXT: 0x8FBB,
            QUERY_RESULT_AVAILABLE_EXT: 0x8867,
            QUERY_RESULT_EXT: 0x8866,
            createQueryEXT: createQuery,
            deleteQueryEXT: deleteQuery,
            beginQueryEXT: beginQuery,
            endQueryEXT: endQuery,
            getQueryObjectEXT(query, parameter) {
                if (parameter === this.QUERY_RESULT_AVAILABLE_EXT) {
                    return readAvailability(query);
                }
                assert.equal(parameter, this.QUERY_RESULT_EXT);
                return readResult(query);
            }
        };
        gl.getExtension = (name) => {
            records.extensionRequests.push(name);
            return name === 'EXT_disjoint_timer_query' ? extension : null;
        };
    }

    return {
        gl,
        records,
        markAvailable(queryIndex, resultNanoseconds) {
            const query = records.queries[queryIndex];
            query.available = true;
            query.resultNanoseconds = resultNanoseconds;
        }
    };
}

test('WebGL1 query 결과는 available 전까지 기다리지 않고 발행 순서대로 수집한다', () => {
    const harness = createTimerHarness('webgl1');
    const timer = new WebGLGpuTimerQueryRing(harness.gl, { capacity: 2 });
    assert.deepEqual(harness.records.extensionRequests, [
        'EXT_disjoint_timer_query_webgl2',
        'EXT_disjoint_timer_query'
    ]);
    assert.equal(timer.getSnapshot().api, 'webgl1');

    assert.equal(timer.begin('overlay-blur', 41), true);
    assert.equal(timer.end(), true);
    assert.equal(timer.begin('title-circle', 42), true);
    assert.equal(timer.end(), true);
    harness.markAvailable(1, 875_000);

    assert.equal(timer.poll(), 0);
    assert.deepEqual(harness.records.availabilityReads, [1]);
    assert.deepEqual(harness.records.resultReads, []);

    harness.markAvailable(0, 2_500_000);
    assert.equal(timer.poll(), 2);
    assert.deepEqual(toHostSamples(timer.drainSamples()), [
        { scope: 'overlay-blur', frameId: 41, gpuMs: 2.5 },
        { scope: 'title-circle', frameId: 42, gpuMs: 0.875 }
    ]);
    const snapshot = timer.getSnapshot();
    assert.equal(snapshot.pendingCount, 0);
    assert.equal(snapshot.sampleCount, 0);
    assert.equal(snapshot.totalSampleCount, 2);
    assert.equal(snapshot.apiFailureCount, 0);
});

test('WebGL2 전용 확장은 core query API로 ns를 ms로 변환한다', () => {
    const harness = createTimerHarness('webgl2');
    const timer = new WebGLGpuTimerQueryRing(harness.gl, { capacity: 1 });
    assert.deepEqual(harness.records.extensionRequests, ['EXT_disjoint_timer_query_webgl2']);
    assert.equal(timer.getSnapshot().api, 'webgl2');

    assert.equal(timer.begin('compositor', 9), true);
    assert.equal(timer.end(), true);
    harness.markAvailable(0, 1_250_000);
    assert.equal(timer.poll(), 1);
    assert.deepEqual(toHostSamples(timer.drainSamples()), [
        { scope: 'compositor', frameId: 9, gpuMs: 1.25 }
    ]);
    assert.equal(harness.records.beginCalls[0].target, 0x88BF);
    assert.equal(harness.records.lastEndTarget, 0x88BF);
});

test('query identity는 begin 시 renderer와 trial 세대를 값으로 복사한다', () => {
    const harness = createTimerHarness('webgl2');
    const timer = new WebGLGpuTimerQueryRing(harness.gl, { capacity: 1 });
    const metadata = {
        rendererId: 'modal-effect-3',
        trialGeneration: 7
    };

    assert.equal(timer.begin('stacked-blur', 19, metadata), true);
    metadata.rendererId = 'mutated-after-begin';
    metadata.trialGeneration = 99;
    assert.equal(timer.end(), true);
    harness.markAvailable(0, 500_000);
    assert.equal(timer.poll(), 1);
    const [sample] = Array.from(timer.drainSamples());

    assert.deepEqual({
        scope: sample.scope,
        frameId: sample.frameId,
        rendererId: sample.rendererId,
        trialGeneration: sample.trialGeneration,
        gpuMs: sample.gpuMs
    }, {
        scope: 'stacked-blur',
        frameId: 19,
        rendererId: 'modal-effect-3',
        trialGeneration: 7,
        gpuMs: 0.5
    });
});

test('미지원 컨텍스트는 예외 없이 disabled 상태와 이유를 노출한다', () => {
    const extensionRequests = [];
    const gl = {
        getExtension(name) {
            extensionRequests.push(name);
            return null;
        }
    };
    const timer = new WebGLGpuTimerQueryRing(gl, { capacity: 4 });
    assert.equal(timer.begin('disabled', 1), false);
    assert.equal(timer.poll(), 0);
    assert.deepEqual(Array.from(timer.drainSamples()), []);

    const snapshot = timer.getSnapshot();
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(snapshot.status, 'disabled');
    assert.equal(snapshot.supported, false);
    assert.equal(snapshot.enabled, false);
    assert.equal(snapshot.reason, 'timer-query-extension-unavailable');
    assert.equal(snapshot.disabledBeginCount, 1);
    assert.deepEqual(extensionRequests, [
        'EXT_disjoint_timer_query_webgl2',
        'EXT_disjoint_timer_query'
    ]);
});

test('중첩 begin과 가득 찬 query ring은 각각 카운터와 이유를 남긴다', () => {
    const harness = createTimerHarness('webgl2');
    const timer = new WebGLGpuTimerQueryRing(harness.gl, { capacity: 2 });

    assert.equal(timer.begin('first', 1), true);
    assert.equal(timer.begin('overlap', 1), false);
    assert.equal(timer.end(), true);
    assert.equal(timer.begin('second', 2), true);
    assert.equal(timer.end(), true);
    assert.equal(timer.begin('overflow', 3), false);
    assert.equal(timer.end(), false);

    const snapshot = timer.getSnapshot();
    assert.equal(snapshot.pendingCount, 2);
    assert.equal(snapshot.rejectedBeginCount, 2);
    assert.equal(snapshot.overlappingBeginCount, 1);
    assert.equal(snapshot.capacityOverflowCount, 1);
    assert.equal(snapshot.endWithoutBeginCount, 1);
    assert.equal(snapshot.lastFailureReason, 'end-without-begin');
    assert.equal(snapshot.apiFailureCount, 0);
});

test('예외 scope abort는 query를 닫아 폐기하고 정상 GPU sample을 만들지 않는다', () => {
    const harness = createTimerHarness('webgl1');
    const timer = new WebGLGpuTimerQueryRing(harness.gl, { capacity: 1 });

    assert.equal(timer.begin('partial-draw', 4), true);
    assert.equal(timer.abort('synthetic-draw-failed'), true);
    assert.equal(timer.poll(), 0);
    assert.deepEqual(Array.from(timer.drainSamples()), []);

    const snapshot = timer.getSnapshot();
    assert.equal(snapshot.active, false);
    assert.equal(snapshot.pendingCount, 0);
    assert.equal(snapshot.totalBeginCount, 1);
    assert.equal(snapshot.totalEndCount, 1);
    assert.equal(snapshot.abortedQueryCount, 1);
    assert.equal(snapshot.discardedQueryCount, 1);
    assert.equal(snapshot.lastFailureReason, 'synthetic-draw-failed');
    assert.deepEqual(harness.records.deletedQueryIds, [1]);
});

test('idle poll은 비활성화 뒤 GPU disjoint 상태를 읽지 않고 ring slot을 재사용한다', () => {
    const harness = createTimerHarness('webgl2');
    const timer = new WebGLGpuTimerQueryRing(harness.gl, { capacity: 1 });

    assert.equal(timer.poll(), 0);
    assert.equal(harness.records.disjointReads, 0);
    for (let cycle = 0; cycle < 3; cycle++) {
        assert.equal(timer.begin(`cycle-${cycle}`, cycle), true);
        assert.equal(timer.end(), true);
        harness.markAvailable(0, (cycle + 1) * 100_000);
        assert.equal(timer.poll(), 1);
        assert.equal(timer.drainSamples().length, 1);
        assert.equal(timer.poll(), 0);
    }

    assert.equal(harness.records.queries.length, 1);
    assert.equal(harness.records.disjointReads, 3);
    assert.equal(timer.getSnapshot().totalSampleCount, 3);
});

test('disjoint는 pending과 활성 scope를 폐기하고 한 episode를 한 번만 센다', () => {
    const harness = createTimerHarness('webgl1');
    const timer = new WebGLGpuTimerQueryRing(harness.gl, { capacity: 2 });

    assert.equal(timer.begin('pending', 1), true);
    assert.equal(timer.end(), true);
    assert.equal(timer.begin('active', 2), true);
    harness.records.disjoint = true;
    assert.equal(timer.poll(), 0);
    assert.equal(timer.poll(), 0);
    let snapshot = timer.getSnapshot();
    assert.equal(snapshot.disjointCount, 1);
    assert.equal(snapshot.discardedQueryCount, 1);
    assert.equal(snapshot.pendingCount, 0);
    assert.equal(snapshot.active, true);
    assert.equal(snapshot.lastFailureReason, 'gpu-disjoint');

    harness.records.disjoint = false;
    assert.equal(timer.poll(), 0);
    assert.equal(timer.end(), true);
    snapshot = timer.getSnapshot();
    assert.equal(snapshot.discardedQueryCount, 2);
    assert.equal(snapshot.active, false);
    assert.equal(snapshot.pendingCount, 0);
    assert.deepEqual(harness.records.deletedQueryIds, [1, 2]);

    assert.equal(timer.begin('recovered', 3), true);
    assert.equal(timer.end(), true);
    harness.markAvailable(2, 3_000_000);
    assert.equal(timer.poll(), 1);
    assert.deepEqual(toHostSamples(timer.drainSamples()), [
        { scope: 'recovered', frameId: 3, gpuMs: 3 }
    ]);
});

test('같은 WebGL context의 disjoint 판정은 한 번 조회해 모든 ring에 동일하게 전파한다', () => {
    const harness = createTimerHarness('webgl2');
    const firstTimer = new WebGLGpuTimerQueryRing(harness.gl, { capacity: 1 });
    const secondTimer = new WebGLGpuTimerQueryRing(harness.gl, { capacity: 1 });
    assert.deepEqual(harness.records.extensionRequests, ['EXT_disjoint_timer_query_webgl2']);

    assert.equal(firstTimer.begin('first-ring', 1), true);
    assert.equal(firstTimer.end(), true);
    assert.equal(secondTimer.begin('second-ring', 1), true);
    assert.equal(secondTimer.end(), true);

    harness.records.disjoint = true;
    assert.equal(firstTimer.poll(), 0);
    assert.equal(harness.records.disjointReads, 1);
    for (const timer of [firstTimer, secondTimer]) {
        const snapshot = timer.getSnapshot();
        assert.equal(snapshot.disjointCount, 1);
        assert.equal(snapshot.discardedQueryCount, 1);
        assert.equal(snapshot.pendingCount, 0);
        assert.equal(snapshot.lastFailureReason, 'gpu-disjoint');
    }
    assert.deepEqual(harness.records.deletedQueryIds, [1, 2]);

    harness.records.disjoint = false;
    assert.equal(secondTimer.poll(), 0);
    assert.equal(harness.records.disjointReads, 1);
    firstTimer.destroy();
    secondTimer.destroy();
});

test('export된 context 무효화는 같은 GL의 모든 ring을 fault하고 복구 세대는 새 coordinator를 쓴다', () => {
    const harness = createTimerHarness('webgl1');
    const firstTimer = new WebGLGpuTimerQueryRing(harness.gl, { capacity: 1 });
    const secondTimer = new WebGLGpuTimerQueryRing(harness.gl, { capacity: 1 });

    assert.equal(firstTimer.begin('first-pending', 7), true);
    assert.equal(firstTimer.end(), true);
    assert.equal(secondTimer.begin('second-pending', 7), true);
    assert.equal(secondTimer.end(), true);

    invalidateWebGLGpuTimerQueryContext(harness.gl, 'synthetic-context-lost');
    invalidateWebGLGpuTimerQueryContext(harness.gl, 'duplicate-context-lost');
    for (const timer of [firstTimer, secondTimer]) {
        const snapshot = timer.getSnapshot();
        assert.equal(snapshot.status, 'faulted');
        assert.equal(snapshot.enabled, false);
        assert.equal(snapshot.reason, 'synthetic-context-lost');
        assert.equal(snapshot.pendingCount, 0);
        assert.equal(snapshot.contextInvalidationCount, 1);
        assert.equal(snapshot.contextDiscardedQueryCount, 1);
        assert.equal(snapshot.discardedQueryCount, 1);
        assert.equal(snapshot.apiFailureCount, 0);
        assert.equal(timer.begin('after-context-loss', 8), false);
    }
    assert.deepEqual(harness.records.deletedQueryIds, [1, 2]);

    const restoredTimer = new WebGLGpuTimerQueryRing(harness.gl, { capacity: 1 });
    assert.equal(restoredTimer.getSnapshot().status, 'ready');
    assert.equal(restoredTimer.begin('restored-context', 9), true);
    assert.equal(restoredTimer.end(), true);
    harness.markAvailable(2, 400_000);
    assert.equal(restoredTimer.poll(), 1);
    assert.deepEqual(toHostSamples(restoredTimer.drainSamples()), [
        { scope: 'restored-context', frameId: 9, gpuMs: 0.4 }
    ]);

    firstTimer.destroy();
    secondTimer.destroy();
    restoredTimer.destroy();
});

test('abort 중 endQuery가 한 번 예외를 던져도 최선 노력 종료로 context 소유권을 해제한다', () => {
    const harness = createTimerHarness('webgl2');
    const failingTimer = new WebGLGpuTimerQueryRing(harness.gl, { capacity: 1 });
    const siblingTimer = new WebGLGpuTimerQueryRing(harness.gl, { capacity: 1 });

    assert.equal(failingTimer.begin('failing-abort', 12), true);
    harness.records.endThrowCount = 1;
    assert.equal(failingTimer.abort('synthetic-abort'), false);
    const fault = failingTimer.getSnapshot();
    assert.equal(fault.status, 'faulted');
    assert.match(fault.reason, /^api-failure:abort-query:synthetic end query failure$/);
    assert.equal(fault.apiFailureCount, 1);
    assert.equal(fault.faultDiscardedQueryCount, 1);
    assert.equal(fault.discardedQueryCount, 1);
    assert.equal(fault.totalEndCount, 1);
    assert.equal(harness.records.endAttemptCount, 2);
    assert.equal(harness.records.endCalls, 1);
    assert.deepEqual(harness.records.deletedQueryIds, [1]);

    assert.equal(siblingTimer.begin('sibling-after-fault', 13), true);
    assert.equal(siblingTimer.end(), true);
    harness.markAvailable(1, 600_000);
    assert.equal(siblingTimer.poll(), 1);
    assert.deepEqual(toHostSamples(siblingTimer.drainSamples()), [
        { scope: 'sibling-after-fault', frameId: 13, gpuMs: 0.6 }
    ]);

    failingTimer.destroy();
    siblingTimer.destroy();
});

test('timer API 예외는 앱으로 전파하지 않고 fault와 API failure로 기록한다', () => {
    const harness = createTimerHarness('webgl2');
    const timer = new WebGLGpuTimerQueryRing(harness.gl, { capacity: 1 });
    assert.equal(timer.begin('fault', 1), true);
    assert.equal(timer.end(), true);
    harness.records.throwOnAvailability = true;

    assert.equal(timer.poll(), 0);
    const snapshot = timer.getSnapshot();
    assert.equal(snapshot.status, 'faulted');
    assert.equal(snapshot.enabled, false);
    assert.equal(snapshot.supported, true);
    assert.equal(snapshot.apiFailureCount, 1);
    assert.match(snapshot.reason, /^api-failure:read-query-availability:/);
    assert.equal(snapshot.pendingCount, 0);
    assert.deepEqual(harness.records.deletedQueryIds, [1]);
    assert.equal(timer.begin('after-fault', 2), false);
});

test('destroy는 활성 scope를 닫고 pending query를 정리하며 반복 호출 시 no-op이다', () => {
    const harness = createTimerHarness('webgl2');
    const timer = new WebGLGpuTimerQueryRing(harness.gl, { capacity: 3 });
    assert.equal(timer.begin('pending', 1), true);
    assert.equal(timer.end(), true);
    assert.equal(timer.begin('active', 2), true);

    timer.destroy();
    const firstDeleteIds = [...harness.records.deletedQueryIds];
    const firstEndCount = harness.records.endCalls;
    timer.destroy();

    const snapshot = timer.getSnapshot();
    assert.equal(snapshot.status, 'destroyed');
    assert.equal(snapshot.enabled, false);
    assert.equal(snapshot.reason, 'destroyed');
    assert.equal(snapshot.active, false);
    assert.equal(snapshot.pendingCount, 0);
    assert.equal(snapshot.sampleCount, 0);
    assert.equal(snapshot.allocatedQueryCount, 0);
    assert.equal(snapshot.discardedQueryCount, 2);
    assert.equal(snapshot.destroyDiscardedPendingQueryCount, 1);
    assert.equal(snapshot.destroyAbortedActiveQueryCount, 1);
    assert.equal(snapshot.destroyDiscardedSampleCount, 0);
    assert.deepEqual(firstDeleteIds, [1, 2]);
    assert.deepEqual(harness.records.deletedQueryIds, firstDeleteIds);
    assert.equal(firstEndCount, 2);
    assert.equal(harness.records.endCalls, firstEndCount);
    assert.equal(timer.begin('after-destroy', 3), false);
    assert.equal(timer.end(), false);
    assert.equal(timer.poll(), 0);
    assert.deepEqual(Array.from(timer.drainSamples()), []);
});
