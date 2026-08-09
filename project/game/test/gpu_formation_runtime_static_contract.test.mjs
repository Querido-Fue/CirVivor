import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    GPU_CIRCLE_BODY_ABI,
    GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM,
    GPU_CIRCLE_ENEMY_BEHAVIOR_STATE
} = await loadGameModule('ingame/physics/gpu/gpu_circle_body_abi.js');
const {
    GPU_FORMATION_HEX_RING,
    GPU_FORMATION_PREPARE_SOURCE_INVALID_REASON,
    GPU_FORMATION_RUNTIME_ABI
} = await loadGameModule('ingame/physics/gpu/gpu_formation_runtime_abi.js');
const {
    GPU_FORMATION_RUNTIME_COMPUTE_WGSL,
    GPU_FORMATION_RUNTIME_ENTRY_POINT,
    GPU_FORMATION_RUNTIME_STORAGE_PROFILE
} = await loadGameModule('ingame/physics/gpu/gpu_formation_runtime_shaders.js');

const simulationSource = await readFile(new URL(
    '../script/module/ingame/physics/gpu/gpu_circle_body_simulation.js',
    import.meta.url
), 'utf8');

test('Formation은 80-byte behavior union과 독립된 versioned ABI/state domain이다', () => {
    assert.equal(GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.STRIDE, 80);
    assert.deepEqual(GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM, {
        NONE: 0,
        ARROW_TOWER_CHARGE: 1,
        SELECTED_TARGET_PROJECTILE: 2
    });
    assert.deepEqual(GPU_CIRCLE_ENEMY_BEHAVIOR_STATE, {
        NONE: 0,
        SEEK_TOWER: 1,
        WINDUP: 2,
        CHARGE: 3,
        CONTACT_RECOIL: 4,
        RECOVER: 5,
        CORE_FALLBACK: 6
    });
    assert.equal(GPU_FORMATION_RUNTIME_ABI.BODY_STATE.STRIDE, 80);
    assert.equal(GPU_FORMATION_RUNTIME_ABI.CANDIDATE_STATE.STRIDE, 48);
    assert.equal(GPU_FORMATION_RUNTIME_ABI.PREPARE_RECORD.STRIDE, 144);
    assert.equal(
        GPU_FORMATION_RUNTIME_ABI.PREPARE_RECORD.SOURCE_INVALID_REASON,
        140
    );
    assert.deepEqual(GPU_FORMATION_PREPARE_SOURCE_INVALID_REASON, {
        NONE: 0,
        LIFECYCLE_REMOVED: 1,
        DIED_AFTER_STAGE: 2
    });
    assert.equal(GPU_FORMATION_RUNTIME_ABI.TRANSFORM_HEADER.STRIDE, 64);
    assert.equal(
        GPU_FORMATION_RUNTIME_ABI.TRANSFORM_HEADER
            .PREPARED_EFFECT_REKEY_COUNT,
        48
    );
    assert.equal(GPU_FORMATION_RUNTIME_ABI.TRANSFORM_RECORD.STRIDE, 192);
    assert.equal(
        GPU_FORMATION_RUNTIME_ABI.TRANSFORM_RECORD.EFFECT_REKEY_COUNT,
        168
    );
    assert.equal(
        GPU_FORMATION_RUNTIME_ABI.TRANSFORM_RECORD
            .PREPARED_EFFECT_REKEY_COUNT,
        176
    );
});

test('Hexa ring/rotation ABI는 empty-center six-slot vocabulary를 exact 고정한다', () => {
    assert.equal(GPU_FORMATION_HEX_RING.SLOT_COUNT, 6);
    assert.equal(GPU_FORMATION_HEX_RING.OCCUPIED_MASK, 0x3f);
    assert.deepEqual(GPU_FORMATION_HEX_RING.AXIAL_SLOTS, [
        { q: 1, r: 0 },
        { q: 1, r: -1 },
        { q: 0, r: -1 },
        { q: -1, r: 0 },
        { q: -1, r: 1 },
        { q: 0, r: 1 }
    ]);
    assert.deepEqual(
        GPU_FORMATION_HEX_RING.ROTATE_PLUS_60_SOURCE_TO_DESTINATION,
        [5, 0, 1, 2, 3, 4]
    );
});

test('모든 Formation compute/render profile은 실제 telemetry 기준 storage<=9다', () => {
    const entries = Object.entries(
        GPU_FORMATION_RUNTIME_STORAGE_PROFILE.byEntryPoint
    );
    assert.equal(
        entries.length,
        Object.keys(GPU_FORMATION_RUNTIME_ENTRY_POINT).length
    );
    assert.ok(entries.every(([, count]) => Number.isInteger(count)
        && count > 0 && count <= 9));
    assert.equal(GPU_FORMATION_RUNTIME_STORAGE_PROFILE.maximum, 9);
    assert.equal(GPU_FORMATION_RUNTIME_STORAGE_PROFILE.render, 8);
    assert.equal(
        GPU_FORMATION_RUNTIME_STORAGE_PROFILE.byEntryPoint
            [GPU_FORMATION_RUNTIME_ENTRY_POINT.SELECT_PREPARE],
        9
    );
});

test('transitive shader resource binding plan은 pipeline exact-set을 보존한다', () => {
    assert.match(simulationSource,
        /SEED_PREPARE\]: \[\s*\[2, 7, 8\], \[2\], false/);
    assert.match(simulationSource,
        /PREFLIGHT_TRANSFORMS\]: \[\s*\[1, 2, 6, 7, 9, 10\], \[6\], true/);
    assert.match(simulationSource,
        /SEAL_TRANSFORM\]: \[\s*\[7, 9\], \[\], false/);
    assert.match(simulationSource,
        /storageBindingCount !== expectedStorageBindingCount/);
    assert.match(simulationSource,
        /renderBodyStorageBindings\.length\s*\n\s*!== GPU_FORMATION_RUNTIME_STORAGE_PROFILE\.render/);
});

test('Formation WGSL은 exact-dead provenance와 bounded weak-CAS retry를 compile-safe하게 보존한다', () => {
    const combatState = GPU_FORMATION_RUNTIME_COMPUTE_WGSL.match(
        /struct CombatState \{([\s\S]*?)\n\}/
    )?.[1] ?? '';
    const prepareRecord = GPU_FORMATION_RUNTIME_COMPUTE_WGSL.match(
        /struct PrepareRecord \{([\s\S]*?)\n\}/
    )?.[1] ?? '';
    assert.match(combatState, /reserved_2: u32/);
    assert.doesNotMatch(combatState, /source_invalid_reason/);
    assert.match(prepareRecord, /source_invalid_reason: u32/);
    assert.doesNotMatch(prepareRecord, /reserved_2: u32/);
    assert.equal(
        (GPU_FORMATION_RUNTIME_COMPUTE_WGSL.match(
            /atomicCompareExchangeWeak/g
        ) ?? []).length,
        2
    );
    assert.match(GPU_FORMATION_RUNTIME_COMPUTE_WGSL,
        /if \(exchange\.exchanged\) \{ break; \}[\s\S]*?exchange\.old_value != INVALID_PROGRAM/);
    assert.match(GPU_FORMATION_RUNTIME_COMPUTE_WGSL,
        /if \(claim\.exchanged\) \{ break; \}[\s\S]*?claim\.old_value != INVALID_PROGRAM/);
    assert.match(GPU_FORMATION_RUNTIME_COMPUTE_WGSL,
        /fn advance_formation_motion/);
    assert.doesNotMatch(GPU_FORMATION_RUNTIME_COMPUTE_WGSL, /undefinedu/);
});

test('prepare/transform result copy는 compute pass 뒤 같은 encoder submit 앞이다', () => {
    const passEnd = simulationSource.indexOf('            pass.end();');
    const formationCopy = simulationSource.indexOf(
        '// Formation result copies are ordered after their compute passes'
    );
    const submit = simulationSource.indexOf(
        '            device.queue.submit([encoder.finish()]);',
        formationCopy
    );
    assert.ok(passEnd >= 0 && formationCopy > passEnd && submit > formationCopy);
    const copyRegion = simulationSource.slice(formationCopy, submit);
    assert.match(copyRegion, /buffers\.formationPrepareProgram/);
    assert.match(copyRegion, /buffers\.formationTransformProgram/);
});

console.log('GPU Formation runtime static contract: ok');
