import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGameModule } from './support/source_module_loader.mjs';

const { createTitleWebGpuOverlayPipeline } = await loadGameModule(
    'scene/title/webgpu/_title_webgpu_overlay_pipeline.js'
);

for (const blurAlgorithmId of ['gaussian-quality', 'kawase-optimized']) {
    test(`${blurAlgorithmId} renderer/graph/cutover를 같은 coordinator 수명으로 조립한다`, () => {
        const calls = [];
        const dependencies = createDependencies(blurAlgorithmId, calls);
        const coordinator = createTitleWebGpuOverlayPipeline(dependencies);

        assert.equal(coordinator.kind, 'coordinator');
        assert.equal(coordinator.blurAlgorithmId, blurAlgorithmId);
        assert.deepEqual(calls, ['renderer', 'renderer-ports', 'cutover', 'graph', 'coordinator']);
        assert.equal(coordinator.graphOptions.blurAlgorithmId, blurAlgorithmId);
        assert.equal(coordinator.graphOptions.maxLiveStages, 5);
        assert.strictEqual(
            coordinator.graphOptions.cutoverStatusProvider(),
            coordinator.cutoverStatus
        );
    });
}

test('explicit live-stage cap은 기본 title steady cap보다 우선한다', () => {
    const calls = [];
    const dependencies = createDependencies('gaussian-quality', calls);
    dependencies.maxLiveStages = 2;
    const coordinator = createTitleWebGpuOverlayPipeline(dependencies);

    assert.equal(coordinator.graphOptions.maxLiveStages, 2);
});

test('중간 조립 실패는 이미 만든 GPU/visibility 소유자를 역누수 없이 정리한다', () => {
    const calls = [];
    const dependencies = createDependencies('gaussian-quality', calls);
    dependencies.graphFactory = () => {
        calls.push('graph-failed');
        throw new Error('graph-init-failed');
    };

    assert.throws(
        () => createTitleWebGpuOverlayPipeline(dependencies),
        /graph-init-failed/
    );
    assert.deepEqual(calls.slice(-3), [
        'graph-failed',
        'renderer-destroy',
        'cutover-destroy'
    ]);
});

function createDependencies(blurAlgorithmId, calls) {
    const cutoverStatus = Object.freeze({ fullCutoverActive: false });
    return {
        baseGraph: { getCheckpoint() {} },
        framePort: {},
        blurPort: {},
        blurAlgorithmId,
        surfaceProvider: () => [],
        rendererFactory() {
            calls.push('renderer');
            return {
                getPorts() {
                    calls.push('renderer-ports');
                    return {
                        materializePass: {},
                        stagePass: {},
                        presentPass: {},
                        compactPass: {}
                    };
                },
                destroy() {
                    calls.push('renderer-destroy');
                }
            };
        },
        cutoverFactory() {
            calls.push('cutover');
            return {
                getStatus: () => cutoverStatus,
                destroy() {
                    calls.push('cutover-destroy');
                }
            };
        },
        graphFactory(options) {
            calls.push('graph');
            return {
                options,
                destroy() {
                    calls.push('graph-destroy');
                }
            };
        },
        coordinatorFactory(options) {
            calls.push('coordinator');
            return {
                kind: 'coordinator',
                blurAlgorithmId: options.blurAlgorithmId,
                graphOptions: options.graph.options,
                cutoverStatus
            };
        }
    };
}
