import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGameModule } from './support/source_module_loader.mjs';

const { TitleWebGpuOverlayCoordinator } = await loadGameModule(
    'scene/title/webgpu/_title_webgpu_overlay_coordinator.js'
);

test('이전 committed receipt로 cutover한 뒤 같은 frame의 C0와 semantic snapshot을 최종화한다', () => {
    const fixture = createFixture();
    fixture.graph.receipts.push(createReceipt({ frameId: 4 }));

    const begin = fixture.coordinator.beginFrame({ frameId: 5, width: 1280, height: 720 });
    assert.equal(begin.accepted, true);
    assert.equal(begin.fullCutoverActive, true);
    assert.equal(begin.legacyDrawRequired, false);
    assert.deepEqual(fixture.cutover.calls.slice(0, 2), ['commit:4', 'begin']);
    assert.deepEqual(fixture.graph.beginFrames, [5]);
    assert.deepEqual(fixture.renderer.beginFrames, [5]);

    const result = fixture.coordinator.finalizeFrame({
        frameId: 5,
        vignettePacket: { visible: true },
        managerSnapshots: [{ frameId: 5 }],
        dynamicSurfaces: [{ id: 'dynamic:1' }]
    });
    assert.equal(result.accepted, true);
    assert.equal(result.cutoverSynchronized, true);
    assert.equal(fixture.recordInputs.length, 1);
    assert.equal(fixture.recordInputs[0].blurAlgorithmId, 'gaussian-quality');
    assert.equal(fixture.graph.finalized[0], fixture.baseCheckpoint);
    assert.equal(fixture.coordinator.getDiagnostics().receiptCommitCount, 1);
});

test('optimized Kawase는 동일 coordinator 경로에서 별도 algorithm ID로 보존된다', () => {
    const fixture = createFixture({ blurAlgorithmId: 'kawase-optimized' });
    assert.equal(
        fixture.coordinator.beginFrame({ frameId: 1, width: 640, height: 360 }).accepted,
        true
    );
    assert.equal(fixture.coordinator.finalizeFrame({ frameId: 1 }).accepted, true);
    assert.equal(fixture.recordInputs[0].blurAlgorithmId, 'kawase-optimized');
    assert.equal(
        fixture.coordinator.getDiagnostics().blurAlgorithmId,
        'kawase-optimized'
    );
});

test('불완전 capture는 graph frame을 취소하고 active cutover를 같은 turn에 복원한다', () => {
    const fixture = createFixture({ recordingComplete: false });
    fixture.graph.receipts.push(createReceipt({ frameId: 1 }));
    assert.equal(
        fixture.coordinator.beginFrame({ frameId: 2, width: 800, height: 600 })
            .fullCutoverActive,
        true
    );

    const result = fixture.coordinator.finalizeFrame({ frameId: 2 });
    assert.equal(result.accepted, false);
    assert.equal(result.reason, 'finalize-failed');
    assert.deepEqual(fixture.graph.cancelled, ['finalize-failed']);
    assert.equal(fixture.cutover.active, false);
    assert.equal(fixture.cutover.restoreReasons.at(-1), 'finalize-failed');
    assert.equal(fixture.coordinator.getDiagnostics().incompleteRecordingCount, 1);
});

test('renderer begin 실패는 legacy draw 전에 graph를 취소하고 cutover를 복구한다', () => {
    const fixture = createFixture({ rendererBegins: false });
    fixture.graph.receipts.push(createReceipt({ frameId: 8 }));

    const result = fixture.coordinator.beginFrame({
        frameId: 9,
        width: 1920,
        height: 1080
    });
    assert.equal(result.accepted, false);
    assert.equal(result.legacyDrawRequired, true);
    assert.deepEqual(fixture.graph.cancelled, ['coordinator-begin-failed']);
    assert.equal(fixture.cutover.active, false);
});

test('aborted receipt는 active cutover를 fallback으로 전환한 뒤 begin에서 복구한다', () => {
    const fixture = createFixture();
    fixture.cutover.active = true;
    fixture.graph.receipts.push(createReceipt({
        frameId: 3,
        committed: false,
        status: 'aborted',
        abortReason: 'device-lost'
    }));

    const result = fixture.coordinator.beginFrame({ frameId: 4, width: 320, height: 180 });
    assert.equal(result.accepted, true);
    assert.equal(result.legacyDrawRequired, true);
    assert.equal(result.fallbackRecovered, true);
    assert.equal(fixture.coordinator.getDiagnostics().receiptAbortCount, 1);
});

function createFixture({
    blurAlgorithmId = 'gaussian-quality',
    recordingComplete = true,
    rendererBegins = true
} = {}) {
    const baseCheckpoint = Object.freeze({ id: 'title:base:C0' });
    const graph = {
        receipts: [],
        beginFrames: [],
        finalized: [],
        cancelled: [],
        beginFrame(frameId) {
            this.beginFrames.push(frameId);
            return true;
        },
        finalize(checkpoint) {
            this.finalized.push(checkpoint);
            return true;
        },
        drainReceipts() {
            return this.receipts.splice(0);
        },
        cancelActiveFrame(reason) {
            this.cancelled.push(reason);
            return true;
        },
        getDiagnostics() {
            return { status: 'ready' };
        },
        destroy() {}
    };
    const renderer = {
        beginFrames: [],
        beginFrame(frameId) {
            this.beginFrames.push(frameId);
            return rendererBegins;
        },
        getDiagnostics() {
            return { status: 'ready' };
        },
        destroy() {}
    };
    const cutover = new FakeCutover();
    const recordInputs = [];
    const coordinator = new TitleWebGpuOverlayCoordinator({
        baseGraph: {
            getCheckpoint(id) {
                assert.equal(id, 'title:overlay:0');
                return baseCheckpoint;
            }
        },
        graph,
        renderer,
        cutover,
        blurPort: { id: 'blur-port' },
        blurAlgorithmId,
        recordFrame(input) {
            recordInputs.push(input);
            return Object.freeze({
                complete: recordingComplete,
                frameId: input.frameId,
                unclaimedSurfaceIds: recordingComplete ? [] : ['dynamic:missing']
            });
        }
    });
    return {
        coordinator,
        graph,
        renderer,
        cutover,
        recordInputs,
        baseCheckpoint
    };
}

class FakeCutover {
    constructor() {
        this.active = false;
        this.fallbackPending = false;
        this.calls = [];
        this.restoreReasons = [];
    }

    beginFrame() {
        this.calls.push('begin');
        const recovered = this.fallbackPending;
        if (recovered) {
            this.fallbackPending = false;
            this.active = false;
        }
        return Object.freeze({
            legacyDrawRequired: !this.active,
            fullCutoverActive: this.active,
            fallbackRecovered: recovered
        });
    }

    commitFrame(receipt) {
        this.calls.push(`commit:${receipt.frameId}`);
        this.active = true;
        return this.getStatus();
    }

    abortFrame(reason) {
        this.calls.push(`abort:${reason}`);
        if (!this.active) return false;
        this.fallbackPending = true;
        return true;
    }

    restoreNow(reason) {
        this.calls.push(`restore:${reason}`);
        this.restoreReasons.push(reason);
        const restored = this.active || this.fallbackPending;
        this.active = false;
        this.fallbackPending = false;
        return restored;
    }

    synchronize() {
        this.calls.push('synchronize');
        return this.active;
    }

    getStatus() {
        return Object.freeze({
            fullCutoverActive: this.active,
            fallbackPending: this.fallbackPending
        });
    }

    destroy() {
        this.active = false;
    }
}

function createReceipt(overrides = {}) {
    return Object.freeze({
        committed: overrides.committed ?? true,
        status: overrides.status ?? 'committed',
        frameId: overrides.frameId ?? 1,
        deviceGeneration: 1,
        baseCheckpointConsumed: true,
        vignetteIncluded: true,
        fullScenePresented: true,
        finalCanvasPassCount: 1,
        abortReason: overrides.abortReason ?? null
    });
}
