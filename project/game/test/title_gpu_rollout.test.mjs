import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGameModule } from './support/source_module_loader.mjs';

const rollout = await loadGameModule('scene/title/_title_gpu_rollout.js');

test('타이틀 GPU rollout production default는 legacy WebGL과 CPU simulation이다', () => {
    rollout.setTitleGpuRolloutTestOverride(null);
    const profile = rollout.createTitleGpuRolloutProfile();

    assert.strictEqual(profile, rollout.DEFAULT_TITLE_GPU_ROLLOUT_PROFILE);
    assert.equal(profile.pipelineMode, rollout.TITLE_PIPELINE_MODE.LEGACY_WEBGL);
    assert.equal(profile.simulationMode, rollout.TITLE_SIMULATION_MODE.CPU);
    assert.equal(profile.source, 'production-default');
    assert.equal(Object.isFrozen(profile), true);
});

test('검증 하네스 override는 session snapshot으로 고정되고 production default와 분리된다', () => {
    const override = rollout.setTitleGpuRolloutTestOverride({
        pipelineMode: rollout.TITLE_PIPELINE_MODE.WEBGPU_GAUSSIAN,
        simulationMode: rollout.TITLE_SIMULATION_MODE.GPU
    });
    const firstSession = rollout.createTitleGpuRolloutProfile();

    assert.equal(override.source, 'test-override');
    assert.notStrictEqual(firstSession, rollout.DEFAULT_TITLE_GPU_ROLLOUT_PROFILE);
    assert.deepEqual({
        pipelineMode: firstSession.pipelineMode,
        simulationMode: firstSession.simulationMode,
        source: firstSession.source
    }, {
        pipelineMode: 'webgpu-gaussian',
        simulationMode: 'gpu',
        source: 'test-override'
    });

    rollout.setTitleGpuRolloutTestOverride({
        pipelineMode: rollout.TITLE_PIPELINE_MODE.WEBGPU_KAWASE,
        simulationMode: rollout.TITLE_SIMULATION_MODE.CPU
    });
    assert.equal(firstSession.pipelineMode, 'webgpu-gaussian');
    assert.equal(rollout.createTitleGpuRolloutProfile().pipelineMode, 'webgpu-kawase');

    rollout.setTitleGpuRolloutTestOverride(null);
    assert.strictEqual(
        rollout.createTitleGpuRolloutProfile(),
        rollout.DEFAULT_TITLE_GPU_ROLLOUT_PROFILE
    );
});

test('rollout validator는 unknown mode와 legacy+GPU 조합을 fail-closed로 거부한다', () => {
    assert.throws(
        () => rollout.validateTitleGpuRolloutProfile(null),
        (error) => error?.name === 'TypeError'
            && /must be an object/.test(error.message)
    );
    assert.throws(() => rollout.validateTitleGpuRolloutProfile({
        pipelineMode: 'unknown',
        simulationMode: 'cpu'
    }), /Unsupported title pipeline mode/);
    assert.throws(() => rollout.validateTitleGpuRolloutProfile({
        pipelineMode: 'legacy-webgl',
        simulationMode: 'unknown'
    }), /Unsupported title simulation mode/);
    assert.throws(() => rollout.validateTitleGpuRolloutProfile({
        pipelineMode: 'legacy-webgl',
        simulationMode: 'gpu'
    }), /requires a WebGPU title pipeline/);
});
