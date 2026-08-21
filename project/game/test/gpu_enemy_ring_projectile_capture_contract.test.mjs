import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const localValue = (value) => JSON.parse(JSON.stringify(value));

const {
    BASIC_RING_ENEMY_CAPABILITY_MASK,
    BASIC_RING_ENEMY_DATA
} = await loadGameModule('data/object/enemy/basic_ring_enemy_data.js');
const {
    GPU_ENEMY_PROJECTILE_CAPTURE_PROFILE_CODE,
    RING_PROJECTILE_CAPTURE_PROFILE
} = await loadGameModule(
    'data/object/enemy/enemy_projectile_capture_catalog_data.js'
);
const {
    GPU_CIRCLE_BODY_ABI,
    GPU_CIRCLE_BODY_ABI_VERSION,
    GPU_CIRCLE_BODY_IDENTITY,
    GPU_CIRCLE_BODY_RENDER_SHAPE,
    GPU_CIRCLE_BODY_SIMULATION_FLAG,
    GPU_PROJECTILE_CAPTURE_PHASE,
    GPU_PROJECTILE_CAPTURE_POLICY_CODE,
    GPU_PROJECTILE_CAPTURE_ROLE,
    GPU_PROJECTILE_CAPTURE_STATE_META,
    createGpuCircleBodyAbiStorage,
    packGpuProjectileCaptureStateMeta,
    readGpuProjectileCaptureState,
    unpackGpuProjectileCaptureStateMeta,
    writeGpuProjectileCaptureState
} = await loadGameModule('ingame/physics/gpu/gpu_circle_body_abi.js');
const {
    GPU_PROJECTILE_CAPTURE_CAPACITY_REJECTION_FLAG,
    GPU_PROJECTILE_CAPTURE_COMPLETION_TYPE,
    GPU_PROJECTILE_CAPTURE_RELEASE_PROGRAM_FLAG,
    GPU_PROJECTILE_CAPTURE_RELEASE_REASON,
    GPU_PROJECTILE_CAPTURE_RUNTIME_ABI,
    GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION,
    GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT,
    GPU_PROJECTILE_CAPTURE_RUNTIME_ERROR_FLAG,
    GPU_PROJECTILE_CAPTURE_RETRY_STATE_FLAG,
    GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR,
    GPU_PROJECTILE_CAPTURE_TICK_STATUS,
    writeGpuProjectileCaptureProfile,
    writeGpuProjectileCaptureTargetConfig
} = await loadGameModule(
    'ingame/physics/gpu/gpu_projectile_capture_runtime_abi.js'
);
const {
    GPU_PROJECTILE_CAPTURE_RELEASE_WGSL,
    GPU_PROJECTILE_CAPTURE_RUNTIME_WGSL,
    GPU_PROJECTILE_CAPTURE_STORAGE_PROFILE
} = await loadGameModule(
    'ingame/physics/gpu/gpu_projectile_capture_runtime_shaders.js'
);
const {
    GPU_COLLISION_COMPUTE_WGSL,
    GPU_COLLISION_RENDER_WGSL
} = await loadGameModule('ingame/physics/gpu/gpu_collision_shaders.js');
const {
    GPU_ENEMY_PROJECTILE_CAPTURE_ROSTER_PORT,
    RingProjectileCaptureDirector
} = await loadGameModule(
    'ingame/object/enemy/projectile_capture_director.js'
);
const {
    GpuEnemySimulationEndpoint
} = await loadGameModule(
    'ingame/object/enemy/gpu_enemy_simulation_endpoint.js'
);
const {
    EnemySimulationBackend
} = await loadGameModule(
    'ingame/object/enemy/enemy_simulation_backend.js'
);

const SIMULATION_SOURCE = await readFile(new URL(
    '../script/module/ingame/physics/gpu/gpu_circle_body_simulation.js',
    import.meta.url
), 'utf8');
const ENDPOINT_SOURCE = await readFile(new URL(
    '../script/module/ingame/object/enemy/gpu_enemy_simulation_endpoint.js',
    import.meta.url
), 'utf8');
const BACKEND_SOURCE = await readFile(new URL(
    '../script/module/ingame/object/enemy/enemy_simulation_backend.js',
    import.meta.url
), 'utf8');
const LIFECYCLE_SOURCE = await readFile(new URL(
    '../script/module/ingame/object/enemy/enemy_lifecycle_command_owner.js',
    import.meta.url
), 'utf8');
const DIRECTOR_SOURCE = await readFile(new URL(
    '../script/module/ingame/object/enemy/projectile_capture_director.js',
    import.meta.url
), 'utf8');
const REGISTRY_SOURCE = await readFile(new URL(
    '../script/module/ingame/object/world_registry.js',
    import.meta.url
), 'utf8');
const RUNNER_SOURCE = await readFile(new URL(
    './nw_webgpu_capability/enemy_ring_projectile_capture_runner.js',
    import.meta.url
), 'utf8');
const SUPPORT_SOURCE = await readFile(new URL(
    './support/run_nw_webgpu_capability.mjs',
    import.meta.url
), 'utf8');

test('R body side-plane은 ABI v10의 independent 48/16-byte exact-handle state다', () => {
    assert.equal(GPU_CIRCLE_BODY_ABI_VERSION, 10);
    assert.deepEqual({ ...GPU_CIRCLE_BODY_ABI.PROJECTILE_CAPTURE_STATE }, {
        STRIDE: 48,
        ROLE_PHASE_PROFILE_POLICY: 0,
        SELF_ENTITY_ID: 4,
        SELF_INCARNATION: 8,
        PEER_BODY_SLOT: 12,
        PEER_ENTITY_ID: 16,
        PEER_INCARNATION: 20,
        CAPTURED_AT_FIXED_TICK: 24,
        RELEASE_DUE_FIXED_TICK: 28,
        CAPTURE_SEQUENCE: 32,
        CAPTURED_SPEED: 36,
        FACING_X: 40,
        FACING_Y: 44
    });
    assert.deepEqual({ ...GPU_CIRCLE_BODY_ABI.PROJECTILE_CAPTURE_CANDIDATE }, {
        STRIDE: 16,
        DISTANCE_SQUARED_BITS: 0,
        PEER_ENTITY_ID: 4,
        PEER_INCARNATION: 8,
        STATUS: 12
    });
    assert.equal(GPU_CIRCLE_BODY_RENDER_SHAPE.RING, 9);
    assert.equal(
        GPU_CIRCLE_BODY_SIMULATION_FLAG.PROJECTILE_CAPTURED,
        1 << 5
    );
    assert.deepEqual(localValue(GPU_PROJECTILE_CAPTURE_ROLE), {
        NONE: 0,
        CAPTOR: 1,
        PROJECTILE: 2
    });
    assert.deepEqual(localValue(GPU_PROJECTILE_CAPTURE_PHASE), {
        IDLE: 0,
        HELD: 1,
        RELEASE_PREPARED: 2,
        TOMBSTONED: 3
    });
    assert.deepEqual(localValue(GPU_PROJECTILE_CAPTURE_POLICY_CODE), {
        NOT_CAPTURABLE: 0,
        CAPTURABLE: 1
    });
    assert.deepEqual({ ...GPU_PROJECTILE_CAPTURE_STATE_META }, {
        ROLE_SHIFT: 0,
        ROLE_MASK: 0x00000003,
        PHASE_SHIFT: 2,
        PHASE_MASK: 0x0000000c,
        PROFILE_SHIFT: 4,
        PROFILE_MASK: 0x00000ff0,
        POLICY_SHIFT: 12,
        POLICY_MASK: 0x00003000,
        FLAGS_SHIFT: 16,
        FLAGS_MASK: 0xffff0000
    });
    const packed = packGpuProjectileCaptureStateMeta({
        role: GPU_PROJECTILE_CAPTURE_ROLE.PROJECTILE,
        phase: GPU_PROJECTILE_CAPTURE_PHASE.HELD,
        profileCode: GPU_ENEMY_PROJECTILE_CAPTURE_PROFILE_CODE.RING_SINGLE_SLOT,
        policyCode: GPU_PROJECTILE_CAPTURE_POLICY_CODE.CAPTURABLE,
        flags: 0x5a5a
    });
    assert.deepEqual(localValue(unpackGpuProjectileCaptureStateMeta(packed)), {
        role: 2,
        phase: 1,
        profileCode: 1,
        policyCode: 1,
        flags: 0x5a5a
    });
});

test('capture side-plane tombstone과 live proof는 uint32 sentinel을 섞지 않는다', () => {
    const storage = createGpuCircleBodyAbiStorage(1);
    writeGpuProjectileCaptureState(storage, 0, {
        role: GPU_PROJECTILE_CAPTURE_ROLE.NONE,
        phase: GPU_PROJECTILE_CAPTURE_PHASE.IDLE,
        selfEntityId: GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT,
        selfIncarnation: 0
    });
    assert.deepEqual({ ...readGpuProjectileCaptureState(storage, 0) }, {
        role: 0,
        phase: 0,
        profileCode: 0,
        policyCode: 0,
        flags: 0,
        selfEntityId: 0xffffffff,
        selfIncarnation: 0,
        peerBodySlot: 0xffffffff,
        peerEntityId: 0xffffffff,
        peerIncarnation: 0xffffffff,
        capturedAtFixedTick: 0,
        releaseDueFixedTick: 0,
        captureSequence: 0,
        capturedSpeed: 0,
        facingX: 0,
        facingY: 0
    });
    assert.throws(() => writeGpuProjectileCaptureState(storage, 0, {
        role: GPU_PROJECTILE_CAPTURE_ROLE.NONE,
        selfEntityId: 0xffffffff,
        selfIncarnation: 0xffffffff
    }), /identity pair|invariant/u);
    assert.throws(() => writeGpuProjectileCaptureState(storage, 0, {
        role: GPU_PROJECTILE_CAPTURE_ROLE.PROJECTILE,
        phase: GPU_PROJECTILE_CAPTURE_PHASE.HELD,
        policyCode: GPU_PROJECTILE_CAPTURE_POLICY_CODE.CAPTURABLE,
        selfEntityId: 1,
        selfIncarnation: 1,
        peerBodySlot: 0,
        peerEntityId: 2,
        peerIncarnation: 1,
        capturedAtFixedTick: 1,
        releaseDueFixedTick: 61,
        captureSequence: 0xffffffff,
        capturedSpeed: 1,
        facingX: 1,
        facingY: 0
    }), /invariant/u);
    assert.throws(() => writeGpuProjectileCaptureState(storage, 0, {
        role: GPU_PROJECTILE_CAPTURE_ROLE.NONE,
        selfEntityId: 0x1_0000_0000,
        selfIncarnation: 0
    }), /uint32/u);
    assert.match(SIMULATION_SOURCE,
        /function requireNonSentinelUint32[\s\S]*number >= UINT32_MAX/);
    assert.match(SIMULATION_SOURCE,
        /captureSequence = requireNonSentinelUint32[\s\S]*prepareFingerprint = requireNonSentinelUint32/);
});

test('capture fingerprint는 0과 uint32 sentinel을 모든 producer/seal에서 1로 정규화한다', () => {
    const commandFingerprintStart = SIMULATION_SOURCE.indexOf(
        'function fingerprintProjectileCaptureCommandId('
    );
    const commandFingerprintEnd = SIMULATION_SOURCE.indexOf(
        '\nfunction projectileCapturePreparationKey(',
        commandFingerprintStart
    );
    const commandFingerprintSource = SIMULATION_SOURCE.slice(
        commandFingerprintStart,
        commandFingerprintEnd
    );
    assert.ok(commandFingerprintStart >= 0
        && commandFingerprintEnd > commandFingerprintStart);
    assert.match(commandFingerprintSource,
        /hash === 0 \|\| hash === UINT32_MAX \? 1 : hash/);

    const lifecycleFingerprintStart = LIFECYCLE_SOURCE.indexOf(
        'function fingerprintProjectileCaptureCommandId('
    );
    const lifecycleFingerprintEnd = LIFECYCLE_SOURCE.indexOf(
        '\nfunction requirePositiveSafeInteger(',
        lifecycleFingerprintStart
    );
    const lifecycleFingerprintSource = LIFECYCLE_SOURCE.slice(
        lifecycleFingerprintStart,
        lifecycleFingerprintEnd
    );
    assert.ok(lifecycleFingerprintStart >= 0
        && lifecycleFingerprintEnd > lifecycleFingerprintStart);
    assert.match(lifecycleFingerprintSource,
        /hash === 0 \|\| hash === INVALID_HANDLE_COMPONENT \? 1 : hash/);

    const mixFingerprintStart = SIMULATION_SOURCE.indexOf(
        'function mixProjectileCaptureFingerprint('
    );
    const mixFingerprintEnd = SIMULATION_SOURCE.indexOf(
        '\nfunction projectileCaptureFloat32Bits(',
        mixFingerprintStart
    );
    const mixFingerprintSource = SIMULATION_SOURCE.slice(
        mixFingerprintStart,
        mixFingerprintEnd
    );
    assert.ok(mixFingerprintStart >= 0
        && mixFingerprintEnd > mixFingerprintStart);
    assert.match(mixFingerprintSource,
        /value === 0 \|\| value === UINT32_MAX \? 1 : value/);

    const rawMixFingerprint = (a, b, c) => {
        let value = (
            Math.imul(a >>> 0, 0x9e3779b1)
            ^ Math.imul(b >>> 0, 0x85ebca6b)
            ^ Math.imul(c >>> 0, 0xc2b2ae35)
        ) >>> 0;
        value = (value ^ (value >>> 16)) >>> 0;
        value = Math.imul(value, 0x7feb352d) >>> 0;
        return (value ^ (value >>> 15)) >>> 0;
    };
    const rawKnownSentinel = rawMixFingerprint(1, 2, 132186607);
    assert.equal(rawKnownSentinel, 0xffffffff);
    assert.equal(
        rawKnownSentinel === 0 || rawKnownSentinel === 0xffffffff
            ? 1
            : rawKnownSentinel,
        1
    );

    for (const shaderSource of [
        GPU_PROJECTILE_CAPTURE_RUNTIME_WGSL,
        GPU_PROJECTILE_CAPTURE_RELEASE_WGSL
    ]) {
        assert.match(shaderSource,
            /fn mix_fingerprint[\s\S]*?return select\(value, 1u, value == 0u \|\| value == INVALID\);/);
    }
    const prepareFinalizeStart = GPU_PROJECTILE_CAPTURE_RUNTIME_WGSL.indexOf(
        'fn finalize_projectile_capture_release_preparations()'
    );
    const nextPrepareEntrypoint = GPU_PROJECTILE_CAPTURE_RUNTIME_WGSL.indexOf(
        '\n@compute',
        prepareFinalizeStart
            + 'fn finalize_projectile_capture_release_preparations()'.length
    );
    const prepareFinalizeEnd = nextPrepareEntrypoint >= 0
        ? nextPrepareEntrypoint
        : GPU_PROJECTILE_CAPTURE_RUNTIME_WGSL.length;
    const prepareFinalizeSource = GPU_PROJECTILE_CAPTURE_RUNTIME_WGSL.slice(
        prepareFinalizeStart,
        prepareFinalizeEnd
    );
    assert.ok(prepareFinalizeStart >= 0
        && prepareFinalizeEnd > prepareFinalizeStart);
    assert.match(prepareFinalizeSource,
        /fingerprint == 0u \|\| fingerprint == INVALID[\s\S]*atomicStore\(&runtime\.values\[H_FINGERPRINT\], 1u\)/);

    const releaseSealStart = GPU_PROJECTILE_CAPTURE_RELEASE_WGSL.indexOf(
        'fn seal_projectile_capture_releases()'
    );
    const releaseSealEnd = GPU_PROJECTILE_CAPTURE_RELEASE_WGSL.indexOf(
        '\n@compute',
        releaseSealStart + 'fn seal_projectile_capture_releases()'.length
    );
    const releaseSealSource = GPU_PROJECTILE_CAPTURE_RELEASE_WGSL.slice(
        releaseSealStart,
        releaseSealEnd
    );
    assert.ok(releaseSealStart >= 0 && releaseSealEnd > releaseSealStart);
    assert.match(releaseSealSource,
        /raw_result_fingerprint == 0u[\s\S]*raw_result_fingerprint == INVALID/);
    const aggregateFingerprintStart = SIMULATION_SOURCE.indexOf(
        'const expectedReleasePreparationFingerprint'
    );
    const aggregateFingerprintEnd = SIMULATION_SOURCE.indexOf(
        'if (header.batchIdFingerprint',
        aggregateFingerprintStart
    );
    const aggregateFingerprintSource = SIMULATION_SOURCE.slice(
        aggregateFingerprintStart,
        aggregateFingerprintEnd
    );
    assert.ok(aggregateFingerprintStart >= 0
        && aggregateFingerprintEnd > aggregateFingerprintStart);
    assert.match(aggregateFingerprintSource,
        /releasePreparationFingerprint === 0[\s\S]*releasePreparationFingerprint === UINT32_MAX[\s\S]*\? 1/);
});

test('capture runtime ABI v1은 prepare/publication/result status와 Tower-or-forward만 고정한다', () => {
    assert.equal(GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION, 1);
    assert.deepEqual({ ...GPU_PROJECTILE_CAPTURE_RUNTIME_ABI.TICK_HEADER }, {
        STRIDE: 64,
        ABI_VERSION: 0,
        SESSION_GENERATION: 4,
        DEVICE_GENERATION: 8,
        AUTHORITATIVE_EPOCH: 12,
        SOURCE_FIXED_TICK: 16,
        COMPLETED_THROUGH_TICK: 20,
        STATUS: 24,
        ERROR_FLAGS: 28,
        CANDIDATE_COUNT: 32,
        SELECTED_COUNT: 36,
        CAPTURE_COUNT: 40,
        RELEASE_PREPARATION_COUNT: 44,
        CLEANUP_COUNT: 48,
        OVERFLOW_FLAGS: 52,
        BATCH_FINGERPRINT: 56,
        RETRY_STATE_FLAGS: 60,
        RESERVED: 60
    });
    assert.equal(GPU_PROJECTILE_CAPTURE_RUNTIME_ABI.COMPLETION.STRIDE, 96);
    assert.equal(GPU_PROJECTILE_CAPTURE_RUNTIME_ABI.RELEASE_HEADER.STRIDE, 64);
    assert.equal(GPU_PROJECTILE_CAPTURE_RUNTIME_ABI.RELEASE_RECORD.STRIDE, 96);
    assert.deepEqual({ ...GPU_PROJECTILE_CAPTURE_RUNTIME_ABI.PROFILE }, {
        STRIDE: 32,
        PROFILE_CODE: 0,
        FLAGS: 4,
        SLOT_CAPACITY: 8,
        CAPTURE_DELAY_FIXED_TICKS: 12,
        FUNNEL_COS_HALF_ANGLE: 16,
        EXIT_CLEARANCE_TILES: 20,
        RELEASE_SPEED_SCALE: 24,
        RESERVED: 28
    });
    assert.deepEqual({ ...GPU_PROJECTILE_CAPTURE_RUNTIME_ABI.TARGET_CONFIG }, {
        STRIDE: 16,
        BODY_SLOT: 0,
        ENTITY_ID: 4,
        INCARNATION: 8,
        SELECTOR: 12
    });
    assert.deepEqual(localValue(GPU_PROJECTILE_CAPTURE_TICK_STATUS), {
        RESET: 0,
        SEALED: 1,
        COMPLETE: 2,
        REJECTED: 3,
        PROTOCOL_FAILURE: 4
    });
    assert.deepEqual(localValue(GPU_PROJECTILE_CAPTURE_COMPLETION_TYPE), {
        CAPTURED: 1,
        RELEASE_PREPARED_NORMAL: 2,
        RELEASE_PREPARED_CAPTOR_DEATH: 3,
        RELEASE_PREPARED_CAPTOR_CORE_IMPACT: 4,
        HELD_PROJECTILE_EXPIRED: 5,
        RELEASE_COMMITTED: 6
    });
    assert.deepEqual(localValue(GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR), {
        INVALID_FORWARD: 0,
        TOWER: 1
    });
    assert.equal('CORE' in GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR, false);
    assert.deepEqual(localValue(GPU_PROJECTILE_CAPTURE_RELEASE_REASON), {
        NORMAL_DUE: 1,
        CAPTOR_DEATH: 2,
        CAPTOR_CORE_IMPACT: 3
    });
    assert.deepEqual(localValue(GPU_PROJECTILE_CAPTURE_RELEASE_PROGRAM_FLAG), {
        COMMIT_REQUESTED: 1
    });
    assert.deepEqual(localValue(GPU_PROJECTILE_CAPTURE_RUNTIME_ERROR_FLAG), {
        ABI_MISMATCH: 1,
        CONTACT_OVERFLOW: 2,
        COMPLETION_CAPACITY: 4,
        BILATERAL_STATE_MISMATCH: 8,
        STALE_IDENTITY: 16,
        UNSUPPORTED_TARGET: 32,
        PROGRAM_REJECTED: 64,
        FIXED_TICK_OVERFLOW: 128,
        CAPTURE_SEQUENCE_EXHAUSTED: 256
    });
    assert.deepEqual(localValue(GPU_PROJECTILE_CAPTURE_CAPACITY_REJECTION_FLAG), {
        CAPTURE: 1,
        RELEASE_PREPARATION: 2,
        CLEANUP: 4
    });
    assert.deepEqual(localValue(GPU_PROJECTILE_CAPTURE_RETRY_STATE_FLAG), {
        ACTIVE: 1,
        BACKLOG_REMAINS: 2
    });
    assert.deepEqual(Object.values(GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT), [
        'clear_projectile_capture_tick',
        'update_projectile_capture_facing',
        'validate_projectile_capture_holds',
        'select_projectile_capture_distances',
        'select_projectile_capture_captors',
        'select_ring_capture_distances',
        'select_ring_capture_projectiles',
        'preflight_projectile_capture_batch',
        'preflight_projectile_capture_retry_batch',
        'select_projectile_capture_retry_prefix',
        'shield_projectile_capture_contacts',
        'seal_projectile_capture_batch',
        'commit_projectile_capture_batch',
        'commit_projectile_capture_retry_batch',
        'finalize_projectile_capture_batch',
        'mark_projectile_capture_core_impacts',
        'attach_projectile_capture_holds',
        'clear_projectile_capture_release_preparations',
        'preflight_projectile_capture_release_preparations',
        'seal_projectile_capture_release_preparations',
        'commit_projectile_capture_release_preparations',
        'finalize_projectile_capture_release_preparations',
        'clear_projectile_capture_releases',
        'preflight_projectile_capture_releases',
        'seal_projectile_capture_releases',
        'commit_projectile_capture_releases',
        'finalize_projectile_capture_releases'
    ]);
});

test('capture runtime은 storage 9, release program은 7이며 모든 dispatch가 <=9다', () => {
    assert.deepEqual({ ...GPU_PROJECTILE_CAPTURE_STORAGE_PROFILE }, {
        clear_projectile_capture_tick: 2,
        update_projectile_capture_facing: 4,
        validate_projectile_capture_holds: 4,
        select_projectile_capture_distances: 7,
        select_projectile_capture_captors: 7,
        select_ring_capture_distances: 7,
        select_ring_capture_projectiles: 7,
        preflight_projectile_capture_batch: 7,
        shield_projectile_capture_contacts: 7,
        preflight_projectile_capture_retry_batch: 7,
        select_projectile_capture_retry_prefix: 6,
        seal_projectile_capture_batch: 1,
        commit_projectile_capture_batch: 7,
        commit_projectile_capture_retry_batch: 7,
        finalize_projectile_capture_batch: 1,
        mark_projectile_capture_core_impacts: 7,
        attach_projectile_capture_holds: 5,
        clear_projectile_capture_release_preparations: 1,
        preflight_projectile_capture_release_preparations: 5,
        seal_projectile_capture_release_preparations: 1,
        commit_projectile_capture_release_preparations: 6,
        finalize_projectile_capture_release_preparations: 1,
        clear_projectile_capture_releases: 1,
        preflight_projectile_capture_releases: 4,
        seal_projectile_capture_releases: 1,
        commit_projectile_capture_releases: 7,
        finalize_projectile_capture_releases: 1
    });
    const storageBindingCount = (source) => new Set(
        [...source.matchAll(/@group\(0\)\s+@binding\((\d+)\)/g)]
            .map((match) => Number(match[1]))
    ).size;
    assert.equal(storageBindingCount(GPU_PROJECTILE_CAPTURE_RUNTIME_WGSL), 9);
    assert.equal(storageBindingCount(GPU_PROJECTILE_CAPTURE_RELEASE_WGSL), 7);
    assert.equal(storageBindingCount(GPU_COLLISION_RENDER_WGSL), 9);
    assert.ok(Math.max(
        ...Object.values(GPU_PROJECTILE_CAPTURE_STORAGE_PROFILE)
    ) <= 9);
    for (const entryPoint of Object.values(
        GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT
    )) {
        const shaderSource = entryPoint.includes('_releases')
            ? GPU_PROJECTILE_CAPTURE_RELEASE_WGSL
            : GPU_PROJECTILE_CAPTURE_RUNTIME_WGSL;
        assert.match(shaderSource, new RegExp(
            `fn\\s+${entryPoint}\\s*\\(`
        ));
        assert.ok(GPU_PROJECTILE_CAPTURE_STORAGE_PROFILE[entryPoint] <= 9);
    }
});

test('profile writer는 data angle에서 파생한 f32 cosine과 exact epsilon만 pack한다', () => {
    const profileBytes = new ArrayBuffer(
        GPU_PROJECTILE_CAPTURE_RUNTIME_ABI.PROFILE.STRIDE
    );
    writeGpuProjectileCaptureProfile(new DataView(profileBytes), 0, {
        profileCode: RING_PROJECTILE_CAPTURE_PROFILE.definitionCode,
        flags: 0,
        slotCapacity: RING_PROJECTILE_CAPTURE_PROFILE.slotCapacity,
        captureDelayFixedTicks:
            RING_PROJECTILE_CAPTURE_PROFILE.captureDelayFixedTicks,
        funnelCosHalfAngle: Math.fround(Math.cos(
            RING_PROJECTILE_CAPTURE_PROFILE.funnelHalfAngleRadians
        )),
        exitClearanceTiles:
            RING_PROJECTILE_CAPTURE_PROFILE.exitClearanceTiles,
        releaseSpeedScale: 1
    });
    const profile = new DataView(profileBytes);
    const abi = GPU_PROJECTILE_CAPTURE_RUNTIME_ABI.PROFILE;
    assert.equal(profile.getUint32(abi.PROFILE_CODE, true), 1);
    assert.equal(profile.getUint32(abi.SLOT_CAPACITY, true), 1);
    assert.equal(profile.getUint32(abi.CAPTURE_DELAY_FIXED_TICKS, true), 60);
    assert.equal(
        profile.getFloat32(abi.FUNNEL_COS_HALF_ANGLE, true),
        Math.fround(Math.SQRT1_2)
    );
    assert.equal(
        profile.getFloat32(abi.EXIT_CLEARANCE_TILES, true),
        Math.fround(1 / 1024)
    );
    assert.equal(profile.getFloat32(abi.RELEASE_SPEED_SCALE, true), 1);

    const targetBytes = new ArrayBuffer(
        GPU_PROJECTILE_CAPTURE_RUNTIME_ABI.TARGET_CONFIG.STRIDE
    );
    const targetView = new DataView(targetBytes);
    writeGpuProjectileCaptureTargetConfig(targetView, null);
    const target = GPU_PROJECTILE_CAPTURE_RUNTIME_ABI.TARGET_CONFIG;
    assert.equal(
        targetView.getUint32(target.BODY_SLOT, true),
        GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT
    );
    assert.equal(
        targetView.getUint32(target.SELECTOR, true),
        GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR.INVALID_FORWARD
    );
});

test('strict-closing funnel과 capacity retry는 shader/dispatch/host ledger에서 함께 봉인된다', () => {
    assert.match(GPU_PROJECTILE_CAPTURE_RUNTIME_WGSL,
        /relative_projectile_velocity = projectile_velocity[\s\S]*radial_closing_dot < 0\.0[\s\S]*>= params\.funnel_cos_half_angle/);
    assert.match(GPU_PROJECTILE_CAPTURE_RUNTIME_WGSL,
        /const PROJECTILE_CAPTURE_PREPARED_SHIELD: u32 = 0x7fc00052u/);
    assert.match(GPU_COLLISION_COMPUTE_WGSL,
        /PROJECTILE_CAPTURE_PREPARED_SHIELD: u32 = 0x7fc00052u/);
    assert.match(GPU_PROJECTILE_CAPTURE_RUNTIME_WGSL,
        /capture_demand > params\.capture_capacity[\s\S]*release_demand > params\.release_capacity[\s\S]*cleanup_demand > params\.cleanup_capacity/);
    assert.match(GPU_PROJECTILE_CAPTURE_RUNTIME_WGSL,
        /fn retry_held_rank\(captor_slot: u32, cleanup_partition: bool\)[\s\S]*other_kind != 1u && other_kind != 2u && other_kind != 4u/);
    assert.match(SIMULATION_SOURCE,
        /PREFLIGHT_RETRY[\s\S]*SELECT_RETRY_PREFIX[\s\S]*SEAL_CAPTURE[\s\S]*COMMIT_RETRY_CAPTURE/);
    assert.match(SIMULATION_SOURCE,
        /projectile-capture-retry-active/);
    assert.match(SIMULATION_SOURCE,
        /projectileCaptureReadbackLease[\s\S]*expectedRetryState/);
    assert.match(SIMULATION_SOURCE,
        /capacityRejected = header\.status[\s\S]*expectedRetry === null[\s\S]*retryStateFlags === 0[\s\S]*COMPLETION_CAPACITY/);
    assert.match(ENDPOINT_SOURCE,
        /projectileCaptureDeferredDeathReceipts[\s\S]*projectile-capture-capacity-deferred[\s\S]*#stageDeferredProjectileCaptureDeaths/);
    assert.match(ENDPOINT_SOURCE,
        /exactCapacityRejected = batch\.capacityRejected === true[\s\S]*batch\.retryBatch !== true[\s\S]*batch\.retryBacklogRemaining !== true[\s\S]*\(batch\.retryOriginTick \?\? 0\) === 0/);
    assert.match(DIRECTOR_SOURCE,
        /lastCapacityRejection[\s\S]*retryBatch[\s\S]*deferredCaptorDeathReceipt/);
    assert.match(DIRECTOR_SOURCE,
        /exactCapacityRejection = snapshot\.retryable === true[\s\S]*snapshot\.retryBatch !== true[\s\S]*snapshot\.retryBacklogRemaining !== true[\s\S]*\(snapshot\.retryOriginTick \?\? 0\) === 0/);
    assert.match(RUNNER_SOURCE,
        /insideOutbound[\s\S]*captureRecords\.length === 0/);
    assert.match(RUNNER_SOURCE,
        /const ringIntent = createRingIntent[\s\S]*x: ringIntent\.velocity\.x[\s\S]*relativeRadialSpeed \* radialUnit\.x[\s\S]*y: ringIntent\.velocity\.y[\s\S]*relativeRadialSpeed \* radialUnit\.y/);
    assert.match(RUNNER_SOURCE,
        /relativeClosingDot = \(relativeVelocity\.x \* radialDelta\.x\)[\s\S]*approachDirection === 'outbound'[\s\S]*relativeClosingDot > 0[\s\S]*relativeClosingDot < 0/);
    assert.match(RUNNER_SOURCE,
        /runCapacityWholeBatchRejection[\s\S]*retryOne\.captures\.length === 1[\s\S]*retryTwo\.captures\.length === 1/);
    assert.match(RUNNER_SOURCE,
        /runReleasePreparationCapacityRetry[\s\S]*releasePreparationDemandCount === 2[\s\S]*releaseCompletions\.length === 2/);
    assert.match(RUNNER_SOURCE,
        /runCleanupCapacityRetry[\s\S]*cleanupDemandCount === 2[\s\S]*projectileRegistryCount/);
});

test('capture retry는 current contact 권한만 재인증하고 HELD retry와 fairness token은 보존한다', () => {
    const functionSlice = (name, nextName) => {
        const start = GPU_PROJECTILE_CAPTURE_RUNTIME_WGSL.indexOf(
            `fn ${name}(`
        );
        const end = GPU_PROJECTILE_CAPTURE_RUNTIME_WGSL.indexOf(
            `fn ${nextName}(`,
            start + 1
        );
        assert.ok(start >= 0 && end > start, `${name} source missing`);
        return GPU_PROJECTILE_CAPTURE_RUNTIME_WGSL.slice(start, end);
    };
    const currentPair = functionSlice(
        'capture_pair_is_current',
        'candidate_is_exact'
    );
    assert.match(currentPair,
        /identity_matches[\s\S]*alive\(captor_slot\)[\s\S]*alive\(projectile_slot\)/);
    assert.match(currentPair,
        /relative_projectile_velocity[\s\S]*temporaries\.values\[projectile_slot\]\.predicted_position[\s\S]*radial_closing_dot < 0\.0[\s\S]*funnel_cos_half_angle/);

    const clear = functionSlice(
        'clear_projectile_capture_tick',
        'update_projectile_capture_facing'
    );
    assert.match(clear,
        /retry_active\(\)[\s\S]*distance_squared_bits,[\s\S]*INVALID[\s\S]*~CANDIDATE_RETRY_CURRENT_CAPTURE/);
    assert.doesNotMatch(clear,
        /retry_active\(\)[\s\S]{0,220}peer_entity_id, INVALID/);

    const shield = functionSlice(
        'shield_projectile_capture_contacts',
        'preflight_projectile_capture_retry_batch'
    );
    assert.match(shield,
        /contact_authenticates_capture_pair[\s\S]*distance_squared_bits,[\s\S]*projectile_slot[\s\S]*distance_squared_bits,[\s\S]*captor_slot[\s\S]*CANDIDATE_RETRY_CURRENT_CAPTURE/);
    assert.doesNotMatch(shield, /find_exact_body_slot/);

    const retrySlot = functionSlice(
        'retry_capture_projectile_slot',
        'retry_capture_endpoint_is_current'
    );
    assert.match(retrySlot,
        /distance_squared_bits[\s\S]*retry_capture_pair_is_retained[\s\S]*CANDIDATE_RETRY_CURRENT_CAPTURE/);
    assert.doesNotMatch(retrySlot, /find_exact_body_slot|contacts\.values/);
    const rank = functionSlice('retry_capture_rank', 'retry_held_exact');
    assert.match(rank, /retry_capture_projectile_slot\(other_captor\)/);
    assert.doesNotMatch(rank,
        /find_exact_body_slot|contact_authenticates_capture_pair|contacts\.values/);

    const captorCorruption = functionSlice(
        'retry_capture_captor_marker_is_corrupt',
        'retry_capture_projectile_marker_is_corrupt'
    );
    assert.match(captorCorruption,
        /!retry_capture_endpoint_is_current\(captor_slot, ROLE_CAPTOR\)[\s\S]*return false/);
    assert.match(captorCorruption,
        /projectile_slot == INVALID[\s\S]*!retry_capture_endpoint_is_current\(projectile_slot, ROLE_PROJECTILE\)[\s\S]*return false/);
    const projectileCorruption = functionSlice(
        'retry_capture_projectile_marker_is_corrupt',
        'retry_tuple_less'
    );
    assert.match(projectileCorruption,
        /captor_slot == INVALID[\s\S]*!retry_capture_endpoint_is_current\(captor_slot, ROLE_CAPTOR\)[\s\S]*return false/);

    const held = functionSlice('retry_held_exact', 'retry_held_rank');
    assert.doesNotMatch(held,
        /CANDIDATE_RETRY_CURRENT_CAPTURE|contact_authenticates_capture_pair/);
    const preflight = functionSlice(
        'preflight_projectile_capture_retry_batch',
        'select_projectile_capture_retry_prefix'
    );
    assert.match(preflight,
        /contact_state\.contact_overflow[\s\S]*ERROR_CONTACT_OVERFLOW/);
    assert.match(preflight,
        /retry_capture_captor_marker_is_corrupt[\s\S]*ERROR_BILATERAL/);
    assert.match(preflight,
        /retry_capture_projectile_marker_is_corrupt[\s\S]*ERROR_BILATERAL/);

    assert.match(RUNNER_SOURCE,
        /runCapacityWholeBatchRejection[\s\S]*placeCapturePairForRetry[\s\S]*currentValid: true[\s\S]*retryOne\.retryBacklogRemaining === true[\s\S]*retryTwo\.retryBacklogRemaining === false[\s\S]*retryTwo\.captureCount === 1/);
    assert.match(RUNNER_SOURCE,
        /runCapacityCurrentTickInvalidation[\s\S]*currentValid: false[\s\S]*completion\.captureCount === 1[\s\S]*invalidCaptureCount[\s\S]*staleCandidateCleared/);
    assert.match(RUNNER_SOURCE,
        /capture-retry-current T3 normal clear[\s\S]*candidate\.status === 0[\s\S]*retryMode === false/);
    assert.match(SIMULATION_SOURCE,
        /Rejected exact-pair\/fairness tokens persist[\s\S]*rebuilds capture authority from current[\s\S]*HELD retry/);
    assert.doesNotMatch(SIMULATION_SOURCE,
        /Persistent Candidate16 backlog is immutable across the/);
});

test('capacity retry stale mutation actual은 bilateral full-state/metadata와 generation 경계를 봉인한다', () => {
    assert.match(RUNNER_SOURCE,
        /const CAPTURE_STATE_FIELDS = Object\.freeze\(\[[\s\S]*'peerBodySlot'[\s\S]*'peerEntityId'[\s\S]*'peerIncarnation'[\s\S]*'captureSequence'[\s\S]*'facingY'/);
    assert.match(RUNNER_SOURCE,
        /const CAPTURE_OWNERSHIP_STATE_FIELDS[\s\S]*field !== 'facingX'[\s\S]*field !== 'facingY'/);
    assert.match(RUNNER_SOURCE,
        /function assertIdleBilateralCaptureUnchanged[\s\S]*captureOwnershipStateIsExact[\s\S]*registryViewIsExact[\s\S]*facingAuthorityCoherent[\s\S]*fullState/);
    assert.match(RUNNER_SOURCE,
        /gpuFacingMatchesCurrentVelocity[\s\S]*0\.9999[\s\S]*current GPU facing authority contradiction/);
    assert.match(RUNNER_SOURCE,
        /runCapacityCurrentTickInvalidation[\s\S]*invalidPairBeforeRetry[\s\S]*invalidPairAfterRetry[\s\S]*invalidPairInvariant/);
    assert.match(RUNNER_SOURCE,
        /runCapacityRetryProjectileAba[\s\S]*entityId === oldProjectileHandle\.entityId[\s\S]*incarnation[\s\S]*oldProjectileHandle\.incarnation \+ 1[\s\S]*const replacementCaptureCount[\s\S]*exactHandle[\s\S]*replacementHandle[\s\S]*replacementCaptureCount === 0/);
    assert.match(RUNNER_SOURCE,
        /runCapacityRetryDeathInvalidation[\s\S]*mode === 'captor'[\s\S]*mode === 'projectile'[\s\S]*GPU_CIRCLE_BODY_SIMULATION_FLAG\.ALIVE[\s\S]*const targetCaptureCount[\s\S]*exactHandle[\s\S]*targetHandle[\s\S]*targetCaptureCount === 0/);
    assert.match(RUNNER_SOURCE,
        /runCapacityRetryOldGenerationRollover[\s\S]*oldSeed\.runtime\.retryMode === true[\s\S]*projectile-capture-release-ingress-revoked[\s\S]*sessionGeneration[\s\S]*oldBacklogCleared[\s\S]*newGenerationCaptureCount/);
    assert.match(RUNNER_SOURCE,
        /function assertZeroCaptureRetryCompletion[\s\S]*retryBacklogRemaining === false[\s\S]*captureCount === 0[\s\S]*requiresRecovery === false/);
    assert.match(SIMULATION_SOURCE,
        /#releaseGpuResources\(\)[\s\S]*projectileCaptureRetryState = null/);
});

test('Ring terminal empty-world header와 모든 body candidate를 함께 clear한다', () => {
    assert.match(GPU_PROJECTILE_CAPTURE_RUNTIME_WGSL,
        /fn clear_projectile_capture_tick[\s\S]*if \(slot == 0u\)[\s\S]*H_SOURCE_TICK[\s\S]*params\.fixed_tick/);
    const clearDispatchStart = SIMULATION_SOURCE.indexOf(
        'GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.CLEAR_TICK'
    );
    const validateDispatchStart = SIMULATION_SOURCE.indexOf(
        'GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.VALIDATE_HELD',
        clearDispatchStart
    );
    assert.ok(clearDispatchStart >= 0
        && validateDispatchStart > clearDispatchStart);
    const clearDispatchSource = SIMULATION_SOURCE.slice(
        clearDispatchStart,
        validateDispatchStart
    );
    assert.match(clearDispatchSource,
        /pass\.dispatchWorkgroups\(Math\.max\([\s\S]*1,[\s\S]*Math\.ceil\(this\.bodyCount \/ BODY_WORKGROUP_SIZE\)[\s\S]*\)\)/);
    assert.doesNotMatch(clearDispatchSource, /dispatchWorkgroupsIndirect/);
});

test('R definition/render source는 capability bit 0x080과 GPU-only hollow funnel을 고정한다', () => {
    assert.equal(BASIC_RING_ENEMY_DATA.id, 'basic_ring_01');
    assert.equal(BASIC_RING_ENEMY_CAPABILITY_MASK, 0x285);
    assert.equal(BASIC_RING_ENEMY_DATA.projectileCaptureProfileId,
        'ring-projectile-capture-01');
    assert.equal(GPU_CIRCLE_BODY_RENDER_SHAPE.RING, 9);
    assert.match(GPU_COLLISION_RENDER_WGSL, /RENDER_SHAPE_RING/);
    assert.match(GPU_COLLISION_RENDER_WGSL,
        /RING_OUTER_RADIUS[\s\S]*RING_INNER_RADIUS[\s\S]*ring_distance/);
    assert.match(GPU_COLLISION_RENDER_WGSL,
        /shape_code == RENDER_SHAPE_RING[\s\S]*length\(point\)[\s\S]*ring_distance/);
    assert.match(GPU_COLLISION_RENDER_WGSL,
        /projectile_capture_states[\s\S]*projectile_capture\.facing/);
    assert.match(GPU_COLLISION_RENDER_WGSL,
        /@group\(0\) @binding\(8\)[\s\S]*projectile_capture_states/);
    assert.doesNotMatch(GPU_COLLISION_RENDER_WGSL, /RENDER_SHAPE_CORE_FALLBACK/);
});

test('production source와 NW stage는 actual Endpoint/Registry evidence만 허용한다', () => {
    assert.equal(typeof RingProjectileCaptureDirector, 'function');
    assert.equal(Object.isFrozen(GPU_ENEMY_PROJECTILE_CAPTURE_ROSTER_PORT), true);
    assert.deepEqual(Object.keys(GPU_ENEMY_PROJECTILE_CAPTURE_ROSTER_PORT), [
        'observeLifecycle',
        'observeCompletedEvents',
        'observeCompletedCapturePrograms',
        'observeCompletedReleasePrograms',
        'stageForFixedTick',
        'observeFixedCommit',
        'closeForTerminal'
    ]);
    for (const methodName of [
        'getProjectileCaptureCommandPort',
        'commitCompletedProjectileCaptureProgramsAtFixedBoundary',
        'commitCompletedProjectileCaptureReleaseProgramsAtFixedBoundary',
        'getProjectileCaptureRuntimeStatus',
        'getTerminalProjectileCaptureProgramCancelStatus'
    ]) {
        assert.equal(
            typeof GpuEnemySimulationEndpoint.prototype[methodName],
            'function'
        );
    }
    assert.equal(
        typeof EnemySimulationBackend.prototype.getProjectileCaptureBodyState,
        'function'
    );
    assert.match(SIMULATION_SOURCE, /projectileCapture/);
    const bodyCopyStart = SIMULATION_SOURCE.indexOf('function copyBodySlot(');
    const bodyCopyEnd = SIMULATION_SOURCE.indexOf(
        'function copyEffectBodySlot(',
        bodyCopyStart + 1
    );
    assert.ok(bodyCopyStart >= 0 && bodyCopyEnd > bodyCopyStart);
    const bodyCopySource = SIMULATION_SOURCE.slice(bodyCopyStart, bodyCopyEnd);
    assert.match(bodyCopySource,
        /'projectileCaptureStateBuffer',[\s\S]*GPU_CIRCLE_BODY_ABI\.PROJECTILE_CAPTURE_STATE\.STRIDE/);
    assert.match(bodyCopySource,
        /'projectileCaptureCandidateBuffer',[\s\S]*GPU_CIRCLE_BODY_ABI\.PROJECTILE_CAPTURE_CANDIDATE\.STRIDE/);
    const slotUploadStart = SIMULATION_SOURCE.indexOf('#uploadSlotRanges(slots)');
    const slotUploadEnd = SIMULATION_SOURCE.indexOf(
        '\n    #',
        slotUploadStart + 1
    );
    assert.ok(slotUploadStart >= 0 && slotUploadEnd > slotUploadStart);
    const slotUploadSource = SIMULATION_SOURCE.slice(
        slotUploadStart,
        slotUploadEnd
    );
    assert.match(slotUploadSource,
        /'projectileCaptureStates',[\s\S]*'projectileCaptureStateBuffer',[\s\S]*GPU_CIRCLE_BODY_ABI\.PROJECTILE_CAPTURE_STATE\.STRIDE/);
    assert.match(slotUploadSource,
        /'projectileCaptureCandidates',[\s\S]*'projectileCaptureCandidateBuffer',[\s\S]*GPU_CIRCLE_BODY_ABI\.PROJECTILE_CAPTURE_CANDIDATE\.STRIDE/);
    assert.match(ENDPOINT_SOURCE, /projectileCapture/);
    assert.match(ENDPOINT_SOURCE, /getProjectileCaptureCommandPort/);
    assert.match(ENDPOINT_SOURCE,
        /commitCompletedProjectileCaptureProgramsAtFixedBoundary/);
    assert.match(ENDPOINT_SOURCE,
        /commitCompletedProjectileCaptureReleaseProgramsAtFixedBoundary/);
    assert.match(ENDPOINT_SOURCE, /getProjectileCaptureRuntimeStatus/);
    assert.match(ENDPOINT_SOURCE,
        /getTerminalProjectileCaptureProgramCancelStatus/);
    assert.match(ENDPOINT_SOURCE,
        /backendBindingMatchesOwner[\s\S]*projectile-capture-terminal-binding-drift/);
    assert.match(ENDPOINT_SOURCE,
        /captureCompletionObserved[\s\S]*releaseCompletionObserved[\s\S]*ownerCompletionObserved/);
    assert.match(ENDPOINT_SOURCE,
        /submittedTick: ownerCompletionObserved[\s\S]*completedThroughTick: ownerCompletionObserved/);
    assert.doesNotMatch(ENDPOINT_SOURCE,
        /abiVersion: backend\?\.abiVersion \?\? initialOwner\.abiVersion/);
    assert.match(ENDPOINT_SOURCE, /requestTerminalHeldProjectileDespawn/);
    assert.match(BACKEND_SOURCE, /getProjectileCaptureBodyState/);
    assert.match(LIFECYCLE_SOURCE, /projectileCapture/);
    assert.match(DIRECTOR_SOURCE, /class RingProjectileCaptureDirector/);
    assert.match(DIRECTOR_SOURCE, /deviceGeneration/);
    assert.match(DIRECTOR_SOURCE, /authoritativeEpoch/);
    assert.match(DIRECTOR_SOURCE, /requestTerminalHeldProjectileDespawn/);
    assert.match(DIRECTOR_SOURCE, /observeCompletedCapturePrograms/);
    assert.match(DIRECTOR_SOURCE, /observeCompletedReleasePrograms/);
    assert.match(DIRECTOR_SOURCE, /stageForFixedTick/);
    assert.match(DIRECTOR_SOURCE, /closeForTerminal/);
    assert.match(DIRECTOR_SOURCE,
        /export const GPU_ENEMY_PROJECTILE_CAPTURE_ROSTER_PORT/);
    assert.match(REGISTRY_SOURCE, /preflightActiveMetadataMutationBatch/);
    assert.match(REGISTRY_SOURCE, /commitActiveMetadataMutationBatch/);
    assert.match(RUNNER_SOURCE, /GpuEnemySimulationEndpoint/);
    assert.match(RUNNER_SOURCE, /EnemySimulationBackend/);
    assert.match(RUNNER_SOURCE, /WorldRegistry|endpoint\.getRegistry\(\)/);
    assert.match(RUNNER_SOURCE, /navigator\.gpu\.requestAdapter/);
    assert.match(RUNNER_SOURCE, /actualRuntime/);
    assert.match(RUNNER_SOURCE, /readGpuCapturePlanesAtSlot/);
    assert.match(RUNNER_SOURCE, /projectileCaptureCandidates/);
    assert.match(RUNNER_SOURCE, /capturePlaneSlotReuse/);
    assert.match(RUNNER_SOURCE,
        /preCaptureProjectileBody = copyBody\(findBody\([\s\S]*await readBodies\(endpoint\)/);
    assert.match(RUNNER_SOURCE,
        /closeForTerminal\(finalTick, 'core-depleted'\)/);
    assert.match(RUNNER_SOURCE,
        /requestPreparedReleaseBatch[\s\S]*discardPreparedBatch[\s\S]*requestTerminalHeldProjectileDespawn/);
    assert.equal(
        [...RUNNER_SOURCE.matchAll(/getProjectileCaptureCommandPort\(/g)].length,
        2
    );
    assert.match(RUNNER_SOURCE,
        /function refreshIdleDirectorBinding[\s\S]*director\.resetGpuBinding/);
    assert.match(RUNNER_SOURCE,
        /staleTerminalCleanup = oldPort\.requestTerminalHeldProjectileDespawn[\s\S]*projectile-capture-terminal-cleanup-rejected/);
    assert.match(RUNNER_SOURCE,
        /sessionGeneration:[\s\S]*deviceGeneration:[\s\S]*authoritativeEpoch:/);
    assert.match(RUNNER_SOURCE,
        /registryHasCaptor: endpoint\.getRegistry\(\)\.has\(captorHandle\)/);
    assert.match(RUNNER_SOURCE,
        /new RingProjectileCaptureDirector\(\{[\s\S]*registry: endpoint\.getRegistry\(\)[\s\S]*projectileCaptureCommandPort: commandPort[\s\S]*sessionGeneration: runtime\.sessionGeneration[\s\S]*deviceGeneration: runtime\.deviceGeneration[\s\S]*authoritativeEpoch: runtime\.authoritativeEpoch[\s\S]*capacity: endpoint\.getCapacity\(\)/);
    assert.doesNotMatch(RUNNER_SOURCE, /synthetic|mockEndpoint|fakeRegistry/iu);
    assert.match(SUPPORT_SOURCE, /enemy-ring-projectile-capture/);
    assert.match(SUPPORT_SOURCE, /productionEnemyRingProjectileCapture/);
    assert.match(SUPPORT_SOURCE, /actualRuntime/);
    assert.match(SUPPORT_SOURCE, /requiredMaximum === 9/);
    assert.match(SUPPORT_SOURCE,
        /staleTerminalCleanup\.reason[\s\S]*projectile-capture-terminal-cleanup-rejected/);
    assert.match(SUPPORT_SOURCE,
        /capturedProjectileBody\.healthFixedPoint[\s\S]*preCaptureProjectileBody\.healthFixedPoint/);
    assert.match(SUPPORT_SOURCE,
        /director\?\.sessionGeneration === owner\.sessionGeneration[\s\S]*director\.lastCompletedCaptureTick === finalFixedTick[\s\S]*director\.lastCompletedReleaseTick === finalFixedTick/);
    assert.doesNotMatch(SUPPORT_SOURCE,
        /productionEnemyRingProjectileCapture[\s\S]{0,300}\.passed === true/);
    const ringStageStart = SUPPORT_SOURCE.indexOf(
        "} else if (fixtureStage === 'enemy-ring-projectile-capture')"
    );
    const ringStageEnd = SUPPORT_SOURCE.indexOf(
        '\n    }\n\n    const fixtureExists',
        ringStageStart
    );
    const ringStageSource = SUPPORT_SOURCE.slice(ringStageStart, ringStageEnd);
    assert.ok(ringStageStart >= 0 && ringStageEnd > ringStageStart);
    assert.match(ringStageSource, /actualRuntime/);
    assert.match(ringStageSource, /captureStorageValues\.length === 27/);
    assert.match(ringStageSource,
        /Math\.max\(\.\.\.captureStorageValues\) === 7/);
    assert.match(ringStageSource, /collisionStorageProfile\?\.render === 9/);
    assert.match(ringStageSource,
        /collisionStorageProfile\.requiredMaximum === 9/);
    assert.match(ringStageSource,
        /requestedMaxStorageBuffersPerShaderStage === 9/);
    assert.match(ringStageSource,
        /exitReleaseValid\(death, 2\)[\s\S]*death\.registryHasCaptor === false[\s\S]*exitReleaseValid\(core, 3\)[\s\S]*core\.registryHasCaptor === false/);
    assert.match(ringStageSource,
        /eventType === 'interaction-enter'[\s\S]*eventType === 'interaction-continuous'/);
    assert.doesNotMatch(ringStageSource, /\.passed\s*===\s*true/);
    assert.match(
        GPU_COLLISION_COMPUTE_WGSL,
        /PROJECTILE_CAPTURE_PREPARED_SHIELD/
    );
});
