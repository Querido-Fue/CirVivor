import { readGpuCircleImplementationSource } from './support/gpu_circle_source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    GPU_EFFECT_RUNTIME_COMPUTE_WGSL,
    GPU_EFFECT_RUNTIME_ENTRY_POINT
} = await loadGameModule('ingame/physics/gpu/gpu_effect_runtime_shaders.js');
const {
    GPU_COLLISION_RENDER_WGSL
} = await loadGameModule('ingame/physics/gpu/gpu_collision_shaders.js');

const simulationSource = await readGpuCircleImplementationSource();

function sourceBetween(source, startToken, endToken) {
    const start = source.indexOf(startToken);
    const end = source.indexOf(endToken, start + startToken.length);
    assert.ok(start >= 0, `missing start token: ${startToken}`);
    assert.ok(end > start, `missing end token: ${endToken}`);
    return source.slice(start, end);
}

test('Penta pulse는 body를 생성하지 않는 병렬 virtual-projectile grid sensor이다', () => {
    assert.equal(
        GPU_EFFECT_RUNTIME_ENTRY_POINT.SCAN_PULSES,
        'scan_effect_pulse_candidates'
    );
    assert.equal(
        GPU_EFFECT_RUNTIME_ENTRY_POINT.PREFIX_PULSES,
        'prefix_effect_pulse_candidates'
    );
    assert.equal(
        GPU_EFFECT_RUNTIME_ENTRY_POINT.WRITE_PULSES,
        'write_effect_pulse_candidates'
    );
    assert.match(
        GPU_EFFECT_RUNTIME_COMPUTE_WGSL,
        /var<workgroup> effect_pulse_sensor_hits: array<atomic<u32>, 2048>/
    );

    const scanBlock = sourceBetween(
        GPU_EFFECT_RUNTIME_COMPUTE_WGSL,
        'fn scan_effect_pulse_candidates(',
        'fn prefix_effect_pulse_candidates('
    );
    assert.match(
        GPU_EFFECT_RUNTIME_COMPUTE_WGSL,
        /@compute @workgroup_size\(256\)\s*fn scan_effect_pulse_candidates/
    );
    assert.match(scanBlock, /emit_effect_pulse_sensor_hits\(record, local_id\.x\)/);
    assert.doesNotMatch(
        scanBlock,
        /for \(var ordinal[\s\S]*?for \(var bucket_slot/
    );

    const sensorBlock = sourceBetween(
        GPU_EFFECT_RUNTIME_COMPUTE_WGSL,
        'fn emit_effect_pulse_sensor_hits(',
        'fn count_effect_pulse_sensor_hits('
    );
    assert.match(sensorBlock, /grid_counts/);
    assert.match(sensorBlock, /grid_bodies/);
    assert.match(sensorBlock, /scan_index \+= 256u/);
    assert.match(sensorBlock, /atomicOr\(&effect_pulse_sensor_hits\[word_index\]/);
    assert.doesNotMatch(sensorBlock, /contact_handlers|damage_self|damage_other|lifetime/);
});

test('Penta sensor 후보는 결정 순서와 pulse-atomic capacity admission을 유지한다', () => {
    const prefixBlock = sourceBetween(
        GPU_EFFECT_RUNTIME_COMPUTE_WGSL,
        'fn prefix_effect_pulse_candidates(',
        'fn write_effect_pulse_candidates('
    );
    const writeBlock = sourceBetween(
        GPU_EFFECT_RUNTIME_COMPUTE_WGSL,
        'fn write_effect_pulse_candidates(',
        'fn write_effect_event('
    );
    assert.match(prefixBlock, /applied_count = candidate_cursor/);
    assert.match(prefixBlock, /candidate_cursor \+= candidate_need/);
    assert.match(prefixBlock,
        /rotation_start = params\.fixed_tick % safe_program_count[\s\S]*?EFFECT_RESULT_DEFERRED_CAPACITY[\s\S]*?applied_count = 0u[\s\S]*?continue;/);
    assert.match(prefixBlock,
        /candidate_fits[\s\S]*?instance_fits[\s\S]*?event_fits/);
    assert.match(writeBlock, /materialize_effect_pulse_sensor_hits/);
    assert.match(writeBlock, /written_count != record\.candidate_count/);

    const materializeBlock = sourceBetween(
        GPU_EFFECT_RUNTIME_COMPUTE_WGSL,
        'fn materialize_effect_batch(',
        'fn finish_effect_tick('
    );
    assert.match(
        materializeBlock,
        /let accepted = select\(1u, 0u, atomicLoad\(&pool_state\.status\) != 0u\)/
    );
    assert.match(
        materializeBlock,
        /result == EFFECT_RESULT_PENDING[\s\S]*?admitted_pulse_count \+= 1u[\s\S]*?current_result != EFFECT_RESULT_PENDING[\s\S]*?continue;/
    );

    const dispatchBlock = sourceBetween(
        simulationSource,
        'GPU_EFFECT_RUNTIME_ENTRY_POINT.SCAN_PULSES',
        'GPU_EFFECT_RUNTIME_ENTRY_POINT.MATERIALIZE_BATCH'
    );
    assert.match(dispatchBlock, /dispatchWorkgroups\(stagedEffectPulseCount\)/);
    assert.match(dispatchBlock, /GPU_EFFECT_RUNTIME_ENTRY_POINT\.PREFIX_PULSES/);
    assert.match(dispatchBlock, /GPU_EFFECT_RUNTIME_ENTRY_POINT\.WRITE_PULSES/);
    assert.match(
        simulationSource,
        /if \(stagedEffectPulseCount > 0\) \{[\s\S]{0,240}SCAN_PULSES[\s\S]{0,160}dispatchWorkgroups\(stagedEffectPulseCount\)/
    );
});

test('Effect 결과 렌더링은 CPU pose readback 없이 GPU indirect instancing에 직결된다', () => {
    const drawBlock = sourceBetween(
        simulationSource,
        '    draw(camera) {',
        '    #getActiveFrameComposer() {'
    );
    assert.match(drawBlock, /pass\.drawIndirect\(this\.buffers\.drawIndirect, 0\)/);
    assert.doesNotMatch(drawBlock, /readbackBodies|mapAsync|getMappedRange/);
    assert.match(
        simulationSource,
        /binding: 6, resource: resource\(resourceBuffers\.effectSummaries\)/
    );
    assert.match(
        GPU_COLLISION_RENDER_WGSL,
        /@group\(0\) @binding\(6\) var<storage, read> effect_summaries/
    );
    assert.match(
        GPU_COLLISION_RENDER_WGSL,
        /let effect_summary = effect_summaries\.values\[instance_index\]/
    );
});
