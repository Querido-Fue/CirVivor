import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    GPU_EFFECT_EMITTER_FLAG,
    GPU_EFFECT_EMITTER_NAVIGATION_CONFIG,
    GPU_EFFECT_LAST_PULSE_TICK_INVALID,
    GPU_EFFECT_PULSE_PROGRAM_FLAG,
    GPU_EFFECT_RUNTIME_ABI,
    GPU_EFFECT_SUMMARY_FLAG,
    GPU_EFFECT_TARGET_POLICY,
    createGpuEffectBodyStateStorage,
    createGpuEffectPulseProgramStorage,
    readGpuEffectPulseProgramRecord,
    writeGpuEffectBodyStateSpawn,
    writeGpuEffectPulseProgramRecord
} = await loadGameModule('ingame/physics/gpu/gpu_effect_runtime_abi.js');
const {
    ENEMY_EFFECT_TARGET_POLICY_CODE
} = await loadGameModule('ingame/contract/enemy_effect_contract.js');
const {
    GPU_EFFECT_RUNTIME_COMPUTE_WGSL,
    GPU_EFFECT_RUNTIME_ENTRY_POINT
} = await loadGameModule('ingame/physics/gpu/gpu_effect_runtime_shaders.js');
const {
    GPU_COLLISION_COMPUTE_WGSL,
    GPU_COLLISION_RENDER_WGSL
} = await loadGameModule('ingame/physics/gpu/gpu_collision_shaders.js');
const {
    GPU_FORMATION_RUNTIME_COMPUTE_WGSL
} = await loadGameModule('ingame/physics/gpu/gpu_formation_runtime_shaders.js');
const {
    GPU_SPAWN_PROGRAM_REQUEST_FLAGS,
    createGpuSpawnProgramStorage,
    readGpuSpawnProgramRecord,
    writeGpuSpawnProgramRecord
} = await loadGameModule('ingame/physics/gpu/gpu_fixed_primitive_abi.js');

const simulationSource = await readFile(new URL(
    '../project/game/script/module/ingame/physics/gpu/gpu_circle_body_simulation.js',
    import.meta.url
), 'utf8');
const backendSource = await readFile(new URL(
    '../project/game/script/module/ingame/object/enemy/enemy_simulation_backend.js',
    import.meta.url
), 'utf8');
const nwEffectRunnerSource = await readFile(new URL(
    './nw_webgpu_capability/enemy_pentagon_effect_runner.js',
    import.meta.url
), 'utf8');
const nwSupportSource = await readFile(new URL(
    './support/run_nw_webgpu_capability.mjs',
    import.meta.url
), 'utf8');

const EXPECTED_PULSE_FLAGS = GPU_EFFECT_PULSE_PROGRAM_FLAG.PENTA_TARGET_ALLOWED
    | GPU_EFFECT_PULSE_PROGRAM_FLAG.TOWER_CONTACT_DAMAGE_MODIFIABLE
    | GPU_EFFECT_PULSE_PROGRAM_FLAG.PROJECTILE_TOWER_DAMAGE_MODIFIABLE
    | GPU_EFFECT_PULSE_PROGRAM_FLAG.DIRECT_CORE_IMPACT_DAMAGE_MODIFIABLE
    | GPU_EFFECT_PULSE_PROGRAM_FLAG.PROJECTILE_CORE_DAMAGE_MODIFIABLE;

function createEffectBody(overrides = {}) {
    return {
        entityId: 41,
        incarnation: 9,
        maxHealth: 250,
        contactHandler: { damageOther: 12 },
        effectEmitterState: {
            emitterDefinitionCode: 1,
            effectDefinitionCode: 1,
            lastPulseTick: GPU_EFFECT_LAST_PULSE_TICK_INVALID,
            flags: GPU_EFFECT_EMITTER_FLAG.ENABLED
        },
        effectClusterRetargetIntervalTicks: 15,
        effectRouteFirstFieldIndex: 7,
        effectRouteFieldCount: 9,
        ...overrides
    };
}

function readNamedBindGroupBindings(source, variableName) {
    const escaped = variableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = source.match(new RegExp(
        `const ${escaped} = device\\.createBindGroup\\(\\{[\\s\\S]*?entries: \\[([\\s\\S]*?)\\n\\s*\\]\\n\\s*\\}\\);`
    ));
    assert(match, `${variableName} bind group source block missing`);
    return [...match[1].matchAll(/binding:\s*(\d+)/g)].map((entry) => Number(entry[1]));
}

function readTransitiveStorageUsage(source) {
    const wgsl = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
    const storageResources = Array.from(wgsl.matchAll(
        /@group\((\d+)\)\s*@binding\((\d+)\)\s*var<storage[^>]*>\s+(\w+)\s*:/g
    ), ([, group, binding, name]) => ({
        group: Number(group),
        binding: Number(binding),
        name
    }));
    const functions = new Map();
    const functionPattern = /\bfn\s+(\w+)/g;
    for (let match = functionPattern.exec(wgsl);
        match;
        match = functionPattern.exec(wgsl)) {
        const openBrace = wgsl.indexOf('{', functionPattern.lastIndex);
        assert.ok(openBrace >= 0, `${match[1]} WGSL body missing`);
        let depth = 1;
        let cursor = openBrace + 1;
        while (cursor < wgsl.length && depth > 0) {
            if (wgsl[cursor] === '{') {
                depth += 1;
            } else if (wgsl[cursor] === '}') {
                depth -= 1;
            }
            cursor += 1;
        }
        assert.equal(depth, 0, `${match[1]} WGSL body is unbalanced`);
        functions.set(match[1], wgsl.slice(openBrace + 1, cursor - 1));
        functionPattern.lastIndex = cursor;
    }
    const entryPoints = Array.from(wgsl.matchAll(
        /@compute\s+@workgroup_size\([^)]*\)\s*fn\s+(\w+)/g
    ), (match) => match[1]);
    return new Map(entryPoints.map((entryPoint) => {
        const visited = new Set();
        const usedResources = new Map();
        const visit = (functionName) => {
            if (visited.has(functionName)) {
                return;
            }
            visited.add(functionName);
            const body = functions.get(functionName) ?? '';
            for (const resource of storageResources) {
                if (new RegExp(`\\b${resource.name}\\b`).test(body)) {
                    usedResources.set(
                        `${resource.group}:${resource.binding}`,
                        resource
                    );
                }
            }
            for (const candidate of functions.keys()) {
                if (new RegExp(`\\b${candidate}\\s*\\(`).test(body)) {
                    visit(candidate);
                }
            }
        };
        visit(entryPoint);
        const bindings = Array.from(usedResources.values())
            .sort((left, right) => left.group - right.group
                || left.binding - right.binding)
            .map(({ group, binding, name }) => `${group}:${binding}:${name}`);
        return [entryPoint, bindings];
    }));
}

test('Effect ABI는 Body v6와 분리된 exact strides/offsets와 catalog target policy authority를 고정한다', () => {
    assert.deepEqual({
        instance: GPU_EFFECT_RUNTIME_ABI.INSTANCE.STRIDE,
        summary: GPU_EFFECT_RUNTIME_ABI.SUMMARY.STRIDE,
        emitter: GPU_EFFECT_RUNTIME_ABI.EMITTER_STATE.STRIDE,
        program: GPU_EFFECT_RUNTIME_ABI.PULSE_PROGRAM_RECORD.STRIDE,
        candidate: GPU_EFFECT_RUNTIME_ABI.CANDIDATE.STRIDE,
        event: GPU_EFFECT_RUNTIME_ABI.EVENT.STRIDE,
        pool: GPU_EFFECT_RUNTIME_ABI.POOL_STATE.STRIDE
    }, {
        instance: 64,
        summary: 80,
        emitter: 32,
        program: 64,
        candidate: 32,
        event: 48,
        pool: 64
    });
    assert.equal(GPU_EFFECT_RUNTIME_ABI.SUMMARY.FLAGS, 76);
    assert.equal(GPU_EFFECT_RUNTIME_ABI.EMITTER_STATE.NAVIGATION_CONFIG, 24);
    assert.equal(GPU_EFFECT_RUNTIME_ABI.EMITTER_STATE.LAST_RETARGET_TICK, 28);
    assert.equal(
        GPU_EFFECT_TARGET_POLICY.HOSTILE_ENEMY,
        ENEMY_EFFECT_TARGET_POLICY_CODE.HOSTILE_ENEMY
    );
});

test('PEmitter route span은 construction-time exact 범위로 pack되고 silent truncation을 거절한다', () => {
    const storage = createGpuEffectBodyStateStorage(1);
    writeGpuEffectBodyStateSpawn(storage, 0, createEffectBody());
    const emitter = GPU_EFFECT_RUNTIME_ABI.EMITTER_STATE;
    const view = new DataView(storage.emitterStateBuffer);
    const packed = view.getUint32(emitter.NAVIGATION_CONFIG, true);
    const config = GPU_EFFECT_EMITTER_NAVIGATION_CONFIG;
    assert.equal(packed & config.RETARGET_INTERVAL_MASK, 15);
    assert.equal(
        (packed & config.ROUTE_FIRST_FIELD_MASK) >>> config.ROUTE_FIRST_FIELD_SHIFT,
        7
    );
    assert.equal(
        ((packed & config.ROUTE_FIELD_COUNT_MINUS_ONE_MASK)
            >>> config.ROUTE_FIELD_COUNT_MINUS_ONE_SHIFT) + 1,
        9
    );
    assert.equal(packed & config.RESERVED_MASK, 0);
    assert.equal(
        view.getUint32(emitter.LAST_RETARGET_TICK, true),
        GPU_EFFECT_LAST_PULSE_TICK_INVALID
    );

    for (const overrides of [
        { effectClusterRetargetIntervalTicks: 4096 },
        { effectRouteFirstFieldIndex: 256 },
        { effectRouteFieldCount: 512 },
        { effectRouteFirstFieldIndex: 250, effectRouteFieldCount: 7 }
    ]) {
        assert.throws(() => writeGpuEffectBodyStateSpawn(
            createGpuEffectBodyStateStorage(1),
            0,
            createEffectBody(overrides)
        ), /packed 범위/);
    }
});

test('Pulse ABI는 stale source sentinel을 normal SOURCE_INVALID 경로용으로 보존한다', () => {
    const storage = createGpuEffectPulseProgramStorage(256);
    writeGpuEffectPulseProgramRecord(storage, 255, {
        sourceSlot: 0xffffffff,
        sourceEntityId: 41,
        sourceIncarnation: 9,
        effectDefinitionCode: 1,
        emitterDefinitionCode: 1,
        sourceTick: 120,
        pulseSequence: 0,
        radiusTiles: 6,
        targetLayerMask: 4,
        targetPolicy: GPU_EFFECT_TARGET_POLICY.HOSTILE_ENEMY,
        fingerprint: 0x10203040,
        flags: EXPECTED_PULSE_FLAGS,
        retargetIntervalTicks: 15
    });
    const record = readGpuEffectPulseProgramRecord(storage, 255);
    assert.equal(record.sourceSlot, 0xffffffff);
    assert.equal(record.flags, EXPECTED_PULSE_FLAGS);
    assert.equal(record.retargetIntervalTicks, 15);
    assert.throws(() => writeGpuEffectPulseProgramRecord(storage, 256, record), /capacity/);
});

test('Effect WGSL은 independent A/B pool, half-open timer, tick-start grid와 pulse-atomic admission을 보존한다', () => {
    assert.equal('PENTA' in GPU_EFFECT_RUNTIME_ENTRY_POINT, false);
    assert.match(GPU_EFFECT_RUNTIME_COMPUTE_WGSL, /struct EffectInstance \{/);
    assert.match(GPU_EFFECT_RUNTIME_COMPUTE_WGSL, /effect_instances_input/);
    assert.match(GPU_EFFECT_RUNTIME_COMPUTE_WGSL, /effect_instances_output/);
    assert.match(
        GPU_EFFECT_RUNTIME_COMPUTE_WGSL,
        /params\.fixed_tick < instance\.applied_tick[\s\S]*?params\.fixed_tick >= instance\.expires_at_tick/
    );
    assert.match(
        GPU_EFFECT_RUNTIME_COMPUTE_WGSL,
        /fn scan_effect_pulse_candidates[\s\S]*?grid_counts[\s\S]*?grid_bodies/
    );
    assert.match(
        GPU_EFFECT_RUNTIME_COMPUTE_WGSL,
        /candidate_overflow[\s\S]*?INSTANCE_CAPACITY_EXCEEDED[\s\S]*?EVENT_CAPACITY_EXCEEDED/
    );
    assert.match(
        GPU_EFFECT_RUNTIME_COMPUTE_WGSL,
        /batch_accepted[\s\S]*?materialize_effect_batch/
    );
    assert.match(
        GPU_EFFECT_RUNTIME_COMPUTE_WGSL,
        /atomicLoad\(&grid_overflow\.small_count\)[\s\S]*?safe_program_count == 0u/
    );
    const scanStart = GPU_EFFECT_RUNTIME_COMPUTE_WGSL.indexOf(
        'fn scan_effect_pulse_candidates('
    );
    const materializeStart = GPU_EFFECT_RUNTIME_COMPUTE_WGSL.indexOf(
        'fn materialize_effect_batch('
    );
    const prefixStart = GPU_EFFECT_RUNTIME_COMPUTE_WGSL.indexOf(
        'fn prefix_effect_pulse_candidates('
    );
    const writeEventStart = GPU_EFFECT_RUNTIME_COMPUTE_WGSL.indexOf(
        'fn write_effect_event('
    );
    const finishStart = GPU_EFFECT_RUNTIME_COMPUTE_WGSL.indexOf(
        'fn finish_effect_tick('
    );
    assert.ok(scanStart >= 0 && prefixStart > scanStart
        && writeEventStart > prefixStart
        && materializeStart > writeEventStart
        && finishStart > materializeStart);
    const scanBlock = GPU_EFFECT_RUNTIME_COMPUTE_WGSL.slice(
        scanStart,
        prefixStart
    );
    const prefixBlock = GPU_EFFECT_RUNTIME_COMPUTE_WGSL.slice(
        prefixStart,
        writeEventStart
    );
    const materializeBlock = GPU_EFFECT_RUNTIME_COMPUTE_WGSL.slice(
        materializeStart,
        finishStart
    );
    assert.doesNotMatch(scanBlock, /effect_instances_output|effect_events/);
    assert.match(
        prefixBlock,
        /let rotation_start = params\.fixed_tick % safe_program_count;[\s\S]*?let pulse_index = \(rotation_start \+ ordinal\) % safe_program_count;/
    );
    assert.match(
        prefixBlock,
        /let candidate_fits[\s\S]*?let instance_fits[\s\S]*?let event_fits[\s\S]*?EFFECT_RESULT_DEFERRED_CAPACITY[\s\S]*?continue;/
    );
    assert.match(
        prefixBlock,
        /applied_count = candidate_cursor;[\s\S]*?candidate_cursor \+= candidate_need;[\s\S]*?event_cursor \+= event_need;/
    );
    const admissionLoopStart = prefixBlock.indexOf('var candidate_cursor = 0u;');
    assert.ok(admissionLoopStart >= 0);
    assert.doesNotMatch(
        prefixBlock.slice(admissionLoopStart),
        /EFFECT_STATUS_(?:CANDIDATE|INSTANCE|EVENT)_CAPACITY_EXCEEDED/
    );
    const firstMaterializeMutation = materializeBlock.indexOf(
        'var event_index = 0u;'
    );
    assert.ok(firstMaterializeMutation > 0);
    const materializePreflight = materializeBlock.slice(
        0,
        firstMaterializeMutation
    );
    assert.match(materializePreflight,
        /arrayLength\(&effect_candidates\.values\)[\s\S]*?arrayLength\(&effect_instances_output\.values\)[\s\S]*?arrayLength\(&effect_events\.values\)/);
    assert.match(materializePreflight,
        /result == EFFECT_RESULT_PENDING[\s\S]*?admitted_pulse_count \+= 1u/);
    assert.match(materializePreflight,
        /Unexpected protocol\/identity failures remain whole-batch fail-close[\s\S]*?result == EFFECT_RESULT_PENDING[\s\S]*?EFFECT_RESULT_POLICY_REJECTED/);
    assert.doesNotMatch(materializePreflight,
        /result == EFFECT_RESULT_DEFERRED_CAPACITY[\s\S]*?EFFECT_RESULT_POLICY_REJECTED/);
    assert.doesNotMatch(GPU_EFFECT_RUNTIME_COMPUTE_WGSL, /ENEMY_BEHAVIOR_STATE_PENTA/);
});

test('모든 compute entry의 transitive storage usage는 exact 9 이하이다', () => {
    const collisionUsage = readTransitiveStorageUsage(GPU_COLLISION_COMPUTE_WGSL);
    const effectUsage = readTransitiveStorageUsage(GPU_EFFECT_RUNTIME_COMPUTE_WGSL);
    const formationUsage = readTransitiveStorageUsage(
        GPU_FORMATION_RUNTIME_COMPUTE_WGSL
    );
    for (const [domain, usage] of [
        ['collision', collisionUsage],
        ['effect', effectUsage],
        ['formation', formationUsage]
    ]) {
        for (const [entryPoint, bindings] of usage) {
            assert.ok(
                bindings.length <= 9,
                `${domain}.${entryPoint} storage=${bindings.length}: ${bindings.join(', ')}`
            );
        }
    }
    assert.deepEqual(collisionUsage.get('handle_contacts'), [
        '0:1:physics',
        '0:2:simulations',
        '0:4:contact_handlers',
        '0:10:combat_states',
        '3:0:contact_state',
        '3:1:contacts',
        '3:2:applied_events',
        '3:3:death_events'
    ]);
    assert.deepEqual(collisionUsage.get('resolve_direct_core_damage_requests'), [
        '0:0:counts',
        '0:1:physics',
        '0:2:simulations',
        '0:10:combat_states',
        '0:12:effect_summaries',
        '3:0:contact_state',
        '3:1:contacts',
        '3:2:applied_events'
    ]);
    assert.deepEqual(collisionUsage.get('resolve_maximum_damage_window'), [
        '0:0:counts',
        '0:1:physics',
        '0:2:simulations',
        '0:4:contact_handlers',
        '0:10:combat_states',
        '0:11:enemy_behavior_states',
        '3:0:contact_state',
        '3:1:contacts',
        '3:2:applied_events'
    ]);
    assert.deepEqual(effectUsage.get('scan_effect_pulse_candidates'), [
        '0:1:physics',
        '0:2:simulations',
        '0:6:effect_emitters',
        '0:7:pulse_program',
        '0:8:pool_state',
        '1:0:grid_counts',
        '1:1:grid_bodies',
        '1:2:grid_overflow'
    ]);
    assert.deepEqual(effectUsage.get('materialize_effect_batch'), [
        '0:1:physics',
        '0:5:effect_summaries',
        '0:6:effect_emitters',
        '0:7:pulse_program',
        '0:8:pool_state',
        '0:10:effect_instances_output',
        '0:11:effect_candidates',
        '0:12:effect_events'
    ]);
    assert.deepEqual(effectUsage.get('write_effect_pulse_candidates'), [
        '0:1:physics',
        '0:2:simulations',
        '0:6:effect_emitters',
        '0:7:pulse_program',
        '0:8:pool_state',
        '0:11:effect_candidates',
        '1:0:grid_counts',
        '1:1:grid_bodies'
    ]);
});

test('Effect damage order는 immutable base와 Tower/Core별 단일 attack multiplier를 사용한다', () => {
    assert.match(
        GPU_EFFECT_RUNTIME_COMPUTE_WGSL,
        /resolved_base_damage_other[\s\S]*?base_damage \* attack_multiplier/
    );
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /fn effect_attack_multiplier_for_channel\([\s\S]*?damage_channel_flag[\s\S]*?attack_multiplier/
    );
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /fn snapshot_projectile_attack_damage\([\s\S]*?EFFECT_DAMAGE_CHANNEL_PROJECTILE_CORE[\s\S]*?resolved_core_damage_fixed_point/
    );
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /snapshot_projectile_attack_damage\([\s\S]*?select\([\s\S]*?EFFECT_DAMAGE_CHANNEL_PROJECTILE_TOWER,[\s\S]*?EFFECT_DAMAGE_CHANNEL_PROJECTILE_CORE,[\s\S]*?selected_is_core/
    );
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /program\.mode_flags == SPAWN_PROGRAM_MODE_SOURCE_RELATIVE_TARGET_ENTITY[\s\S]*?program\.request_flags == SPAWN_PROGRAM_REQUEST_TOWER_DAMAGE_CHANNEL[\s\S]*?snapshot_projectile_attack_damage\([\s\S]*?EFFECT_DAMAGE_CHANNEL_PROJECTILE_TOWER/
    );
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /fn resolve_direct_core_impact_damage\([\s\S]*?effect_attack_multiplier_for_channel\([\s\S]*?EFFECT_DAMAGE_CHANNEL_DIRECT_CORE_IMPACT[\s\S]*?f32\(authored_damage\) \* attack_multiplier/
    );
    assert.match(
        GPU_EFFECT_RUNTIME_COMPUTE_WGSL,
        /EFFECT_INSTANCE_FLAG_TOWER_CONTACT_DAMAGE_MODIFIABLE[\s\S]*?EFFECT_DAMAGE_CHANNEL_TOWER_CONTACT[\s\S]*?EFFECT_INSTANCE_FLAG_PROJECTILE_TOWER_DAMAGE_MODIFIABLE[\s\S]*?EFFECT_DAMAGE_CHANNEL_PROJECTILE_TOWER[\s\S]*?EFFECT_INSTANCE_FLAG_DIRECT_CORE_IMPACT_DAMAGE_MODIFIABLE[\s\S]*?EFFECT_DAMAGE_CHANNEL_DIRECT_CORE_IMPACT[\s\S]*?EFFECT_INSTANCE_FLAG_PROJECTILE_CORE_DAMAGE_MODIFIABLE[\s\S]*?EFFECT_DAMAGE_CHANNEL_PROJECTILE_CORE/
    );
});

test('BOOST/PULSE presentation은 authored fill을 보존하고 premultiplied rim/halo만 합성한다', () => {
    const vertexStart = GPU_COLLISION_RENDER_WGSL.indexOf('@vertex');
    const fragmentStart = GPU_COLLISION_RENDER_WGSL.indexOf('@fragment');
    assert.ok(vertexStart >= 0 && fragmentStart > vertexStart);
    const vertexShader = GPU_COLLISION_RENDER_WGSL.slice(
        vertexStart,
        fragmentStart
    );
    const fragmentShader = GPU_COLLISION_RENDER_WGSL.slice(fragmentStart);

    assert.match(
        GPU_COLLISION_RENDER_WGSL,
        /@location\(9\) @interpolate\(flat\) effect_presentation_tags: u32/
    );
    assert.match(vertexShader, /var presentation_color = style\.color;/);
    assert.doesNotMatch(
        vertexShader,
        /presentation_color\s*=\s*vec4f\([\s\S]*?EFFECT_PRESENTATION_TAG_(?:BOOST|PULSE)/
    );
    assert.match(
        vertexShader,
        /EFFECT_PRESENTATION_TAG_PULSE[\s\S]*?presentation_radius_scale \*= 1\.0[\s\S]*?0\.16/
    );
    assert.match(
        GPU_COLLISION_RENDER_WGSL,
        /fn apply_effect_presentation\([\s\S]*?EFFECT_PRESENTATION_TAG_BOOST[\s\S]*?boost_rim_distance = abs\(shape_edge_distance\)[\s\S]*?vec3f\(0\.04, 0\.88, 1\.0\)/
    );
    assert.match(
        GPU_COLLISION_RENDER_WGSL,
        /fn apply_effect_presentation\([\s\S]*?pulse_halo_distance: f32,[\s\S]*?EFFECT_PRESENTATION_TAG_PULSE[\s\S]*?vec3f\(0\.08, 1\.0, 0\.82\)/
    );
    assert.match(
        fragmentShader,
        /pulse_distance = abs\(length\(input\.local_position\) - 0\.92\)[\s\S]*?pulse_aa = max\(fwidth\(pulse_distance\), 0\.002\)/
    );
    assert.match(
        fragmentShader,
        /effect_presentation\.rgb \* effect_presentation\.alpha,[\s\S]*?effect_presentation\.alpha/
    );
    assert.doesNotMatch(
        fragmentShader,
        /return vec4f\(effect_presentation\.rgb, effect_presentation\.alpha\)/
    );
});

test('일반 projectile Tower damage channel은 exact TARGET_ENTITY request bit로만 authoring된다', () => {
    const storage = createGpuSpawnProgramStorage(1);
    const baseRecord = {
        destinationSlot: 1,
        destinationEntityId: 101,
        destinationIncarnation: 3,
        sourceSlot: 0,
        sourceEntityId: 41,
        sourceIncarnation: 9,
        targetSlot: 2,
        targetEntityId: 202,
        targetIncarnation: 5,
        modeFlags: 3,
        result: 0,
        sourceTick: 120,
        launchSpeed: 8,
        requestFlags: GPU_SPAWN_PROGRAM_REQUEST_FLAGS.TOWER_DAMAGE_CHANNEL
    };
    writeGpuSpawnProgramRecord(storage, 0, baseRecord);
    assert.equal(
        readGpuSpawnProgramRecord(storage, 0).requestFlags,
        GPU_SPAWN_PROGRAM_REQUEST_FLAGS.TOWER_DAMAGE_CHANNEL
    );
    assert.throws(() => writeGpuSpawnProgramRecord(storage, 0, {
        ...baseRecord,
        modeFlags: 2,
        targetSlot: 0xffffffff,
        targetEntityId: 0xffffffff,
        targetIncarnation: 0xffffffff,
        aimWorldPoint: { x: 10, y: 5 }
    }), /selected-target payload/);
});

test('Tower projectile attack snapshot은 다음 tick summary clear 뒤에도 immutable base로 보존된다', () => {
    assert.equal(GPU_EFFECT_SUMMARY_FLAG.PROJECTILE_ATTACK_SNAPSHOT, 1 << 16);
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /resolved_base_damage_other[\s\S]*?source_snapshot_tick[\s\S]*?EFFECT_SUMMARY_FLAG_PROJECTILE_ATTACK_SNAPSHOT/
    );
    assert.match(
        GPU_EFFECT_RUNTIME_COMPUTE_WGSL,
        /preserve_projectile_snapshot[\s\S]*?preserved_base_damage[\s\S]*?preserved_snapshot_tick[\s\S]*?EFFECT_SUMMARY_FLAG_PROJECTILE_ATTACK_SNAPSHOT/
    );
});

test('Pentagon navigation은 route integration/SDF bounded gate를 texture로 소비하며 storage profile은 9 이하이다', () => {
    assert.match(
        GPU_EFFECT_RUNTIME_COMPUTE_WGSL,
        /world_flow_integration: texture_2d_array<f32>/
    );
    assert.match(
        GPU_EFFECT_RUNTIME_COMPUTE_WGSL,
        /candidate_integration_cost[\s\S]*?source_integration_cost \+ EPSILON/
    );
    assert.match(
        GPU_EFFECT_RUNTIME_COMPUTE_WGSL,
        /MAX_PENTA_SDF_SEGMENT_SAMPLES: u32 = 64u/
    );
    assert.match(
        GPU_EFFECT_RUNTIME_COMPUTE_WGSL,
        /required_step_count > MAX_PENTA_SDF_SEGMENT_SAMPLES[\s\S]*?return false/
    );
    assert.match(
        GPU_EFFECT_RUNTIME_COMPUTE_WGSL,
        /fn advance_penta_cluster_navigation[\s\S]*?grid_overflow\.small_count[\s\S]*?EFFECT_EMITTER_FLAG_GRID_OVERFLOW_OBSERVED[\s\S]*?return;[\s\S]*?last_retarget_tick/
    );
    assert.match(simulationSource, /sourceResolve: 9/);
    assert.match(simulationSource, /effects:[\s\S]*?storageBuffersPerStage: 9/);
    assert.match(simulationSource, /format: 'r32float'/);
    assert.match(
        simulationSource,
        /cirvivor-gpu-effect-\$\{entryPoint\}-world-layout[\s\S]*?sampleType: 'unfilterable-float'[\s\S]*?viewDimension: '2d-array'/
    );
    assert.doesNotMatch(
        simulationSource,
        /cirvivor-gpu-effect-\$\{entryPoint\}[\s\S]{0,160}layout: 'auto'/
    );
    assert.match(
        simulationSource,
        /const storageBindingCount = bodyBindings\.length[\s\S]*?storageBindingCount > REQUIRED_COMPUTE_STORAGE_BUFFERS_PER_STAGE/
    );
    assert.match(
        simulationSource,
        /ADVANCE_PENTA_NAVIGATION\]: \[\s*\[0, 1, 2, 3, 6\], \[0, 1, 2, 4, 5, 6\]/
    );
    assert.match(
        GPU_EFFECT_RUNTIME_COMPUTE_WGSL,
        /binding\(0\) var<storage, read_write> grid_counts[\s\S]*?binding\(2\) var<storage, read_write> grid_overflow/
    );
    assert.match(
        GPU_EFFECT_RUNTIME_COMPUTE_WGSL,
        /fn emit_effect_pulse_sensor_hits[\s\S]*?slots_per_cell[\s\S]*?grid_counts[\s\S]*?grid_bodies[\s\S]*?atomicOr\(&effect_pulse_sensor_hits/
    );
    assert.match(
        GPU_EFFECT_RUNTIME_COMPUTE_WGSL,
        /fn cluster_member_count[\s\S]*?bucket < 2u[\s\S]*?big_grid_body_is_canonical_in_cell/
    );
});

test('Backend는 canonical Effect API 네 개와 effective capacity mapping만 노출한다', () => {
    for (const method of [
        'stageEffectPulseProgramBatch',
        'drainCompletedEffectProgramBatches',
        'cancelPendingEffectProgramsForTerminal',
        'getEffectRuntimeStatus'
    ]) {
        assert.match(backendSource, new RegExp(`\\n    ${method}\\(`));
    }
    assert.match(
        backendSource,
        /effectPulseProgramCapacity: this\.effectCommandCapacity/
    );
    assert.doesNotMatch(backendSource, /getEffectSourceSlot|resolveEffectSourceSlot/);
});

test('zero-body fast path는 staged Effect completion을 삼키지 않고 Core bind layout은 exact하다', () => {
    assert.match(
        simulationSource,
        /this\.activeBodyCount === 0[\s\S]{0,160}!stagedEffectBatch/
    );
    assert.deepEqual(
        readNamedBindGroupBindings(simulationSource, 'computeCoreDamageRequestBodies'),
        [0, 1, 2, 4, 10, 11]
    );
    assert.deepEqual(
        readNamedBindGroupBindings(simulationSource, 'computeSourceResolve'),
        [0, 1, 2, 3, 5, 7, 10, 11, 12]
    );
    assert.match(
        simulationSource,
        /computeSourceResolveLayout[\s\S]*?storageLayoutEntry\(12\)[\s\S]*?computeSourceResolve = device\.createBindGroup[\s\S]*?binding: 12, resource: resource\(this\.buffers\.effectSummaries\)/
    );
});

test('Effect source는 stage 시 exact resident여야 하고 stage 후 despawn만 GPU SOURCE_INVALID가 된다', () => {
    assert.match(
        simulationSource,
        /const allowsSourceInvalid[\s\S]*?const sourceSlot = this\.handleToSlot\.get\(key\)[\s\S]*?return hardReject\('effect-source-invalid'\)/
    );
    assert.match(
        simulationSource,
        /sourceSlot:\s*sourceSlot\s*\?\?\s*GPU_FIXED_PRIMITIVE_IDENTITY\.INVALID_COMPONENT/
    );
    assert.match(
        GPU_EFFECT_RUNTIME_COMPUTE_WGSL,
        /EFFECT_PULSE_FLAG_ALLOW_SOURCE_INVALID[\s\S]*?EFFECT_RESULT_SOURCE_INVALID/
    );
});

test('전용 NW stage는 big-bucket dedupe와 offscreen pulse/boost/expiry pixel 증거를 author한다', () => {
    assert.match(nwSupportSource, /enemy-pentagon-effect/);
    assert.match(
        nwEffectRunnerSource,
        /runEffectBigBucketFixture[\s\S]*?candidateCount === 1[\s\S]*?appliedInstanceCount === 1/
    );
    assert.match(
        nwEffectRunnerSource,
        /runEffectBigBucketFixture[\s\S]*?x: sourceIntent\.position\.x,[\s\S]*?y: sourceIntent\.position\.y \+ 3[\s\S]*?radius: 2,[\s\S]*?inverseMass: 0[\s\S]*?isWalkableTile\(targetTile\.row, targetTile\.column\)[\s\S]*?target\.radius \* 2\) > minimumGridCellSize[\s\S]*?candidateCount === 1[\s\S]*?appliedInstanceCount === 1[\s\S]*?eventCount === 2/
    );
    assert.match(
        nwEffectRunnerSource,
        /runEffectPresentationPixelFixture[\s\S]*?GPUTextureUsage\.RENDER_ATTACHMENT \| GPUTextureUsage\.COPY_SRC[\s\S]*?pulsedSourcePixels > baselineSourcePixels[\s\S]*?BOOST rim\/halo did not disappear at half-open expiry/
    );
    assert.match(
        nwEffectRunnerSource,
        /sourceCenterPixel[\s\S]*?pulsedSourceCenterPixel[\s\S]*?PULSE changed authored source center fill[\s\S]*?pulseDifference\.minimumChangedRadiusPixels >= 3[\s\S]*?pulseDifference\.saturatedCyanPixelCount > 0/
    );
    assert.match(
        nwEffectRunnerSource,
        /baselineTargetPixel[\s\S]*?boostedTargetPixel[\s\S]*?BOOST changed authored target center fill[\s\S]*?boostDifference\.minimumChangedRadiusPixels >= 3[\s\S]*?boostDifference\.saturatedCyanPixelCount > 0/
    );
    assert.match(
        nwEffectRunnerSource,
        /premultiplied === true[\s\S]*?Effect BOOST output broke premultiplied alpha/
    );
    assert.match(
        nwEffectRunnerSource,
        /HARDWARE_FIXED_SUBMIT_SETTLE_INTERVAL_TICKS = 16[\s\S]*?advanceFixedTicksWithReadbackYields[\s\S]*?ticksSinceSettle === HARDWARE_FIXED_SUBMIT_SETTLE_INTERVAL_TICKS[\s\S]*?queue\.onSubmittedWorkDone\(\)[\s\S]*?setTimeout\(resolve, 0\)/
    );
    assert.match(
        nwEffectRunnerSource,
        /advanceFixedTicksWithReadbackYields\([\s\S]*?17,[\s\S]*?180,[\s\S]*?'Effect lifetime'[\s\S]*?requiresRecovery\(\) === false/
    );
    assert.match(
        nwEffectRunnerSource,
        /runEffectPresentationPixelFixture[\s\S]*?advanceFixedTicksWithReadbackYields\([\s\S]*?3,[\s\S]*?180,[\s\S]*?'Effect offscreen lifetime'[\s\S]*?summaryTick === 180[\s\S]*?boostStackCount === 1[\s\S]*?GPU_EFFECT_PRESENTATION_TAG\.BOOST[\s\S]*?summaryTick === 181[\s\S]*?boostStackCount === 0[\s\S]*?GPU_EFFECT_PRESENTATION_TAG\.BOOST/
    );
    assert.match(
        nwEffectRunnerSource,
        /position: Object\.freeze\(\{ x: origin\.x \+ 2, y: origin\.y \}\)[\s\S]*?isWalkableTile\(targetTile\.row, targetTile\.column\)[\s\S]*?expiryPixelEvidence[\s\S]*?baselineTargetPixel[\s\S]*?boostedTargetPixel[\s\S]*?expiredTargetPixel[\s\S]*?tick181Body/
    );
});

test('Effect readback은 GPU가 소비한 radiusTiles까지 exact f32 provenance로 검증한다', () => {
    assert.match(
        simulationSource,
        /Object\.is\(record\.radiusTiles, expected\.radiusTiles\)/
    );
});

test('fixed terminal retire는 Effect lease를 침범하지 않고 Effect cancel만 exact pending을 퇴역한다', () => {
    const fixedRetireStart = simulationSource.indexOf(
        '    #retireTerminalReadbacks() {'
    );
    const fixedRetireEnd = simulationSource.indexOf(
        '\n    #validateBody(',
        fixedRetireStart
    );
    assert.ok(fixedRetireStart >= 0 && fixedRetireEnd > fixedRetireStart);
    const fixedRetireBody = simulationSource.slice(fixedRetireStart, fixedRetireEnd);
    assert.doesNotMatch(fixedRetireBody, /effectProgram|stagedEffect|EffectReadback/);
    assert.match(
        simulationSource,
        /cancelPendingEffectProgramsForTerminal[\s\S]*?const pulseProgramCount[\s\S]*?#retireTerminalEffectReadbacks\(\)/
    );
    assert.match(
        simulationSource,
        /terminalEffectProgramCancelStatus = Object\.freeze\(\{[\s\S]*?state: 'submitted',[\s\S]*?submittedTick: resolvedSourceTick/
    );
});

test('idle release 뒤 respawn world는 Effect pool/summary/emitter identity를 새 epoch로 초기화한다', () => {
    const idleReleaseStart = simulationSource.indexOf(
        '    #completeDeferredIdleRelease() {'
    );
    const idleReleaseEnd = simulationSource.indexOf(
        '\n    #beginEventReadback(',
        idleReleaseStart
    );
    assert.ok(idleReleaseStart >= 0 && idleReleaseEnd > idleReleaseStart);
    const idleReleaseBody = simulationSource.slice(
        idleReleaseStart,
        idleReleaseEnd
    );
    assert.match(
        idleReleaseBody,
        /nextAuthoritativeEpoch[\s\S]*?createGpuEffectPoolStateStorage\(\s*nextAuthoritativeEpoch\s*\)/
    );
    assert.match(idleReleaseBody, /createGpuEffectBodyStateStorage\(this\.capacity\)/);
    assert.match(idleReleaseBody, /createGpuEffectPulseProgramStorage\([\s\S]*?effectPulseProgramCapacity/);
    assert.match(idleReleaseBody, /effectActivePoolIndex = 0/);
    assert.match(idleReleaseBody, /authoritativeEpoch = nextAuthoritativeEpoch/);
});
