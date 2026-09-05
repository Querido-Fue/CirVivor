import { readGpuCircleImplementationSource } from './support/gpu_circle_source.mjs';
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
    GPU_FORMATION_BODY_STATE_FLAG,
    GPU_FORMATION_HEX_RING,
    GPU_FORMATION_PREPARE_PROGRAM_ABI_VERSION,
    GPU_FORMATION_PREPARE_PROGRAM_FLAG,
    GPU_FORMATION_PREPARE_RESULT,
    GPU_FORMATION_PREPARE_SOURCE_INVALID_REASON,
    GPU_FORMATION_RUNTIME_ABI,
    GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION,
    readGpuFormationTransformProgramRecord
} = await loadGameModule('ingame/physics/gpu/gpu_formation_runtime_abi.js');
const {
    GPU_FORMATION_RUNTIME_COMPUTE_WGSL,
    GPU_FORMATION_RUNTIME_ENTRY_POINT,
    GPU_FORMATION_RUNTIME_STORAGE_PROFILE
} = await loadGameModule('ingame/physics/gpu/gpu_formation_runtime_shaders.js');
const { GPU_COLLISION_RENDER_WGSL } = await loadGameModule(
    'ingame/physics/gpu/gpu_collision_shaders.js'
);
const { GpuCircleBodySimulation } = await loadGameModule(
    'ingame/physics/gpu/gpu_circle_body_simulation.js'
);

const simulationSource = await readGpuCircleImplementationSource();
const formationRunnerSource = await readFile(new URL(
    'nw_webgpu_capability/enemy_hexa_formation_runner.js',
    import.meta.url
), 'utf8');

test('Formation은 96-byte behavior union과 독립된 versioned ABI/state domain이다', () => {
    assert.equal(GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.STRIDE, 96);
    assert.deepEqual({ ...GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM }, {
        NONE: 0,
        ARROW_TOWER_CHARGE: 1,
        SELECTED_TARGET_PROJECTILE: 2,
        OCTAGON_TOWER_ORBIT: 3
    });
    assert.deepEqual({ ...GPU_CIRCLE_ENEMY_BEHAVIOR_STATE }, {
        NONE: 0,
        SEEK_TOWER: 1,
        WINDUP: 2,
        CHARGE: 3,
        CONTACT_RECOIL: 4,
        RECOVER: 5,
        CORE_FALLBACK: 6,
        ORBIT_TOWER: 7
    });
    assert.equal(GPU_FORMATION_RUNTIME_ABI.BODY_STATE.STRIDE, 80);
    assert.equal(GPU_FORMATION_RUNTIME_ABI.CANDIDATE_STATE.STRIDE, 48);
    assert.equal(GPU_FORMATION_RUNTIME_ABI.PREPARE_RECORD.STRIDE, 144);
    assert.equal(
        GPU_FORMATION_RUNTIME_ABI.PREPARE_RECORD.SOURCE_INVALID_REASON,
        140
    );
    assert.deepEqual({ ...GPU_FORMATION_PREPARE_SOURCE_INVALID_REASON }, {
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
    assert.deepEqual(Array.from(
        GPU_FORMATION_HEX_RING.AXIAL_SLOTS,
        (slot) => ({ ...slot })
    ), [
        { q: 1, r: 0 },
        { q: 1, r: -1 },
        { q: 0, r: -1 },
        { q: -1, r: 0 },
        { q: -1, r: 1 },
        { q: 0, r: 1 }
    ]);
    assert.deepEqual(
        Array.from(
            GPU_FORMATION_HEX_RING.ROTATE_PLUS_60_SOURCE_TO_DESTINATION
        ),
        [5, 0, 1, 2, 3, 4]
    );
});

test('Formation/HX render WGSL은 Effect rim/halo와 Formation payload를 보존한다', () => {
    const vertexShader = GPU_COLLISION_RENDER_WGSL.match(
        /@vertex[\s\S]*?(?=\n@fragment)/
    )?.[0] ?? '';
    assert.notEqual(vertexShader, '');
    assert.doesNotMatch(vertexShader, /presentation_color\.rgb\s*=/);
    assert.match(vertexShader, /var presentation_color = style\.color;/);
    assert.doesNotMatch(vertexShader,
        /presentation_color = vec4f\(\s*mix\(/);
    assert.match(vertexShader,
        /output\.effect_presentation_tags = effect_presentation_tags;/);
    assert.match(vertexShader,
        /fn apply_effect_presentation\([\s\S]*?boost_rim_distance[\s\S]*?pulse_halo_distance/);
    const effectHelper = vertexShader.match(
        /fn apply_effect_presentation\([\s\S]*?return EffectPresentation\(rgb, alpha\);\n\}/
    )?.[0] ?? '';
    assert.notEqual(effectHelper, '');
    assert.doesNotMatch(effectHelper, /\bfwidth\(/);
    assert.match(vertexShader,
        /output\.color = presentation_color \* f32\(style\.visible != 0u\);/);
    assert.match(vertexShader,
        /output\.formation_member_count = select\(\s*0u,\s*formation\.member_count,\s*formation_identity_matches\s*\);/);
    assert.match(vertexShader,
        /output\.formation_occupied_mask = select\(\s*0u,\s*formation\.occupied_slot_mask,\s*formation_identity_matches\s*\);/);
    assert.match(vertexShader,
        /output\.formation_presentation_flags = select\(\s*0u,\s*formation\.presentation_flags,\s*formation_identity_matches\s*\);/);
    assert.match(vertexShader,
        /formation_identity_matches && effect_identity_matches/);
});

test('Formation/HX render derivative는 data-dependent control flow 전에 계산된다', () => {
    const fragmentShader = GPU_COLLISION_RENDER_WGSL.match(
        /@fragment[\s\S]*$/
    )?.[0] ?? '';
    assert.notEqual(fragmentShader, '');
    const derivativeOffsets = Array.from(
        fragmentShader.matchAll(/\bfwidth\(/g),
        (match) => match.index
    );
    const firstDataDependentControl = fragmentShader.indexOf(
        'if (length(input.local_position) > 1.0)'
    );
    assert.equal(derivativeOffsets.length, 5);
    assert.ok(firstDataDependentControl > 0);
    assert.ok(derivativeOffsets.every(
        (offset) => offset < firstDataDependentControl
    ));
    for (const expression of [
        'let occupied_aa = max(fwidth(occupied_distance), 0.002);',
        'let link_aa = max(fwidth(link_distance), 0.002);',
        'let pulse_aa = max(fwidth(pulse_distance), 0.002);',
        'let bar_aa = max(fwidth(outer_distance), 0.002);',
        'let anti_alias_width = max(fwidth(distance), 0.002);'
    ]) {
        assert.ok(fragmentShader.includes(expression), expression);
    }
    assert.match(fragmentShader,
        /let outer = 1\.0 - smoothstep\(-bar_aa, bar_aa, outer_distance\);/);
    assert.match(fragmentShader,
        /let fill_half_x = max\(0\.0, bar_half\.x \* input\.health_ratio\);/);
    assert.match(fragmentShader,
        /vec2f\(fill_half_x, bar_half\.y \* 0\.62\)/);
    assert.match(fragmentShader,
        /input\.formation_member_count > 1u/);
    assert.doesNotMatch(fragmentShader,
        /formation_empty_boundary_distance|empty_outline|FORMATION_FLAG_RESERVATION/);
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
    assert.equal(GPU_FORMATION_RUNTIME_STORAGE_PROFILE.render, 9);
    assert.equal(
        GPU_FORMATION_RUNTIME_STORAGE_PROFILE.byEntryPoint
            [GPU_FORMATION_RUNTIME_ENTRY_POINT.SELECT_PREPARE],
        9
    );
    assert.equal(
        GPU_FORMATION_RUNTIME_STORAGE_PROFILE.byEntryPoint
            [GPU_FORMATION_RUNTIME_ENTRY_POINT.SEED_MOTION],
        7
    );
    assert.equal(
        GPU_FORMATION_RUNTIME_STORAGE_PROFILE.byEntryPoint
            [GPU_FORMATION_RUNTIME_ENTRY_POINT.PREFLIGHT_ROUTE_REKEYS],
        4
    );
    assert.equal(
        GPU_FORMATION_RUNTIME_STORAGE_PROFILE.byEntryPoint
            [GPU_FORMATION_RUNTIME_ENTRY_POINT.PREFLIGHT_TRANSFORMS],
        7
    );
    assert.equal(
        GPU_FORMATION_RUNTIME_STORAGE_PROFILE.byEntryPoint
            [GPU_FORMATION_RUNTIME_ENTRY_POINT.COMMIT_AUXILIARY],
        9
    );
});

test('transitive shader resource binding plan은 pipeline exact-set을 보존한다', () => {
    assert.match(simulationSource,
        /SEED_PREPARE\]: \[\s*\[2, 7, 8\], \[2\], false/);
    assert.match(simulationSource,
        /SEED_MOTION\]: \[\s*\[0, 2, 6, 7, 17, 19\], \[2\], true/);
    assert.match(simulationSource,
        /PREFLIGHT_ROUTE_REKEYS\]: \[\s*\[2, 6, 9, 17\], \[\], false/);
    assert.match(simulationSource,
        /PREFLIGHT_TRANSFORMS\]: \[\s*\[1, 2, 6, 7, 9, 10, 18\], \[6\], true/);
    assert.match(simulationSource,
        /COMMIT_AUXILIARY\]: \[\s*\[6, 7, 9, 10, 11, 12, 15, 16, 18\], \[\], false/);
    assert.match(simulationSource,
        /SEAL_TRANSFORM\]: \[\s*\[7, 9\], \[\], false/);
    assert.match(simulationSource,
        /storageBindingCount !== expectedStorageBindingCount/);
    assert.match(simulationSource,
        /renderBodyStorageBindings\.length\s*\n\s*!== GPU_FORMATION_RUNTIME_STORAGE_PROFILE\.render/);
});

test('Formation transform은 inactive capture side-plane만 수용하고 destination identity로 원자 rekey한다', () => {
    assert.match(GPU_FORMATION_RUNTIME_COMPUTE_WGSL,
        /struct ProjectileCaptureState \{[\s\S]*?packed_meta: atomic<u32>[\s\S]*?facing: vec2f/);
    assert.match(GPU_FORMATION_RUNTIME_COMPUTE_WGSL,
        /@group\(0\) @binding\(18\) var<storage, read_write> projectile_capture_states/);
    const preflight = GPU_FORMATION_RUNTIME_COMPUTE_WGSL.match(
        /fn canonical_inactive_projectile_capture_state\([\s\S]*?\n\}/
    )?.[0] ?? '';
    assert.notEqual(preflight, '');
    assert.match(preflight, /packed_meta\) == 0u/);
    assert.match(preflight, /values\[slot\]\.self_entity_id == entity_id/);
    assert.match(preflight, /values\[slot\]\.self_incarnation == incarnation/);
    assert.match(preflight, /values\[slot\]\.peer_body_slot == INVALID/);
    assert.match(preflight, /values\[slot\]\.capture_sequence == 0u/);
    assert.match(preflight, /values\[slot\]\.facing\.x == 0\.0/);
    assert.match(preflight, /values\[slot\]\.facing\.y == 0\.0/);
    assert.match(GPU_FORMATION_RUNTIME_COMPUTE_WGSL,
        /sources_match = source_state_matches\([\s\S]*?canonical_inactive_projectile_capture_state\(\s*record\.source_a_slot[\s\S]*?canonical_inactive_projectile_capture_state\(\s*record\.source_b_slot/);
    const commit = GPU_FORMATION_RUNTIME_COMPUTE_WGSL.match(
        /fn commit_formation_transform_auxiliary\([\s\S]*?\n\}/
    )?.[0] ?? '';
    assert.match(commit,
        /reset_projectile_capture_state\(\s*root_slot,\s*record\.destination_entity_id,\s*record\.destination_incarnation/);
    assert.match(commit,
        /reset_projectile_capture_state\(other_slot, INVALID, INVALID\)/);
});

test('Formation route 권위는 Cork 재경로 이후 current actor path를 사용하고 legacy span만 별도 보존한다', () => {
    assert.match(GPU_FORMATION_RUNTIME_COMPUTE_WGSL,
        /@group\(0\) @binding\(19\) var<storage, read> route_topology/);
    const routeSynchronization = GPU_FORMATION_RUNTIME_COMPUTE_WGSL.match(
        /fn synchronize_formation_route_span\([\s\S]*?\n\}/
    )?.[0] ?? '';
    assert.notEqual(routeSynchronization, '');
    assert.match(routeSynchronization, /role == ROUTE_ROLE_NONE/);
    assert.match(routeSynchronization,
        /route_state\.current_path_index[\s\S]*?ROUTE_TOPOLOGY_PATH_COUNT_WORD/);
    assert.match(routeSynchronization,
        /route_first_field_index = first_field/);
    assert.match(routeSynchronization, /route_field_count = field_count/);
    const actorIdentity = GPU_FORMATION_RUNTIME_COMPUTE_WGSL.match(
        /fn formation_route_actor_identity_matches\([\s\S]*?\n\}/
    )?.[0] ?? '';
    assert.match(actorIdentity, /state\.current_path_index != INVALID/);
    assert.match(actorIdentity, /state\.route_set_index != INVALID/);
    const pairCompatibility = GPU_FORMATION_RUNTIME_COMPUTE_WGSL.match(
        /fn formation_route_pair_is_compatible\([\s\S]*?\n\}/
    )?.[0] ?? '';
    assert.match(pairCompatibility,
        /source_route\.route_set_index == candidate_route\.route_set_index/);
    assert.match(pairCompatibility,
        /source_route\.current_path_index == candidate_route\.current_path_index/);
    assert.match(pairCompatibility,
        /source_role == ROUTE_ROLE_NONE[\s\S]*?source\.route_first_field_index == candidate\.route_first_field_index/);
    assert.match(GPU_FORMATION_RUNTIME_COMPUTE_WGSL,
        /source\.route_first_field_index != candidate\.route_first_field_index[\s\S]*?source\.route_field_count != candidate\.route_field_count/);
    assert.match(GPU_FORMATION_RUNTIME_COMPUTE_WGSL,
        /fn seed_formation_motion[\s\S]*?!synchronize_formation_route_span\(slot\)[\s\S]*?!valid_formation_state\(slot\)/);
    assert.match(GPU_FORMATION_RUNTIME_COMPUTE_WGSL,
        /fn preflight_formation_route_rekeys[\s\S]*?!formation_route_pair_is_compatible\(\s*record\.source_a_slot,\s*record\.source_b_slot/);
});

test('Formation prepare stage는 owner/ABI source identity shape를 exact 수용한다', () => {
    const simulation = new GpuCircleBodySimulation(Object.freeze({
        getState: () => Object.freeze({ status: 'unsupported' }),
        getDevice: () => null,
        getCanvasFormat: () => null,
        getDeviceGeneration: () => 0,
        acquireFrameTarget: () => null,
        clearCanvas: () => false,
        markCanvasDrawn: () => false,
        markCanvasCleared: () => false
    }), {
        capacity: 2,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    });
    try {
        const receipt = simulation.stageFormationPrepareBatch({
            abiVersion: GPU_FORMATION_PREPARE_PROGRAM_ABI_VERSION,
            targetFixedTick: 5,
            batchIdFingerprint: 17,
            records: [{
                sourceEntityId: 11,
                sourceIncarnation: 3,
                prepareSequence: 0,
                fingerprint: 23,
                flags: GPU_FORMATION_PREPARE_PROGRAM_FLAG.ALLOW_SOURCE_INVALID
            }]
        });
        assert.equal(receipt.accepted, false);
        assert.equal(receipt.reason, 'formation-prepare-readback-capacity');
        assert.equal(receipt.requiresRecovery, false);
    } finally {
        simulation.destroy();
    }
});

test('Formation transform arm은 destination handle/state를 분리해 ABI에 보존한다', () => {
    const simulation = new GpuCircleBodySimulation(Object.freeze({
        getState: () => Object.freeze({ status: 'unsupported' }),
        getDevice: () => null,
        getCanvasFormat: () => null,
        getDeviceGeneration: () => 0,
        acquireFrameTarget: () => null,
        clearCanvas: () => false,
        markCanvasDrawn: () => false,
        markCanvasCleared: () => false
    }), {
        capacity: 2,
        formationTransformCapacity: 1,
        worldSize: { x: 8, y: 8 },
        gridCellSize: { x: 1, y: 1 }
    });
    const sourceA = Object.freeze({
        entityId: 11,
        incarnation: 1,
        memberCount: 1,
        occupiedSlotMask: 1,
        rotationStep: 0,
        generation: 1,
        lineageHash: 101,
        currentHealthCenti: 100,
        maxHealthCenti: 100
    });
    const sourceB = Object.freeze({
        entityId: 12,
        incarnation: 1,
        memberCount: 1,
        occupiedSlotMask: 1,
        rotationStep: 0,
        generation: 1,
        lineageHash: 102,
        currentHealthCenti: 100,
        maxHealthCenti: 100
    });
    const preparedResult = (source, pair, programIndex, pairProgramIndex) => (
        Object.freeze({
            sourceEntityId: source.entityId,
            sourceIncarnation: source.incarnation,
            pairEntityId: pair.entityId,
            pairIncarnation: pair.incarnation,
            result: GPU_FORMATION_PREPARE_RESULT.MUTUAL_PAIR,
            programIndex,
            pairProgramIndex,
            rootProgramIndex: 0,
            motionRootProgramIndex: 0,
            memberCount: source.memberCount,
            occupiedSlotMask: source.occupiedSlotMask,
            rotationStep: source.rotationStep,
            generation: source.generation,
            lineageHash: source.lineageHash,
            currentHealthCenti: source.currentHealthCenti,
            maxHealthCenti: source.maxHealthCenti,
            destinationMemberCount: 2,
            destinationOccupiedSlotMask: 3,
            destinationRotationStep: 0,
            expectedMergedCurrentHealthCenti: 220,
            expectedMergedMaxHealthCenti: 220
        })
    );
    try {
        simulation.deviceGeneration = 1;
        simulation.lastSubmittedSourceTick = 5;
        simulation.slotActive[0] = 1;
        simulation.slotActive[1] = 1;
        simulation.handleToSlot.set('11:1', 0);
        simulation.handleToSlot.set('12:1', 1);
        simulation.formationTransformReadbackSlots.push({ inFlight: false });
        simulation.authenticFormationPrepareByKey.set('77:5', Object.freeze({
            sessionGeneration: 1,
            deviceGeneration: 1,
            authoritativeEpoch: 0,
            submittedTick: 5,
            results: Object.freeze([
                preparedResult(sourceA, sourceB, 0, 1),
                preparedResult(sourceB, sourceA, 1, 0)
            ])
        }));
        const receipt = simulation.armPreparedFormationTransformBatch({
            abiVersion: GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION,
            batchIdFingerprint: 88,
            prepareBatchIdFingerprint: 77,
            preparedSourceTick: 5,
            targetFixedTick: 6,
            prepareProtocol: Object.freeze({
                sessionGeneration: 1,
                deviceGeneration: 1,
                authoritativeEpoch: 0,
                submittedTickCount: 4
            }),
            records: [Object.freeze({
                fingerprint: 99,
                sourceA,
                sourceB,
                destination: Object.freeze({
                    entityId: 11,
                    incarnation: 2,
                    definitionCode: 1,
                    coordinateSystemCode: 2,
                    policyCode: 1,
                    memberCount: 2,
                    occupiedSlotMask: 3,
                    rotationStep: 0,
                    generation: 2,
                    flags: GPU_FORMATION_BODY_STATE_FLAG.ACTIVE,
                    lineageHash: 303
                }),
                expectedCurrentHealthCenti: 220,
                expectedMaxHealthCenti: 220,
                destinationRadius: 0.5,
                destinationInverseMass: 0.5,
                destinationFlowSpeed: 2.25,
                destinationTowerContactDamage: 0.12,
                motionSourceIndex: 0
            })]
        });
        assert.equal(receipt.accepted, true);
        const encoded = readGpuFormationTransformProgramRecord(
            simulation.hostFormationTransformProgram,
            0
        );
        assert.equal(encoded.destination.entityId, 11);
        assert.equal(encoded.destination.incarnation, 2);
        assert.equal(encoded.destination.memberCount, 2);
        assert.equal(encoded.destination.lineageHash, 303);
    } finally {
        simulation.destroy();
    }
});

test('H/HX hardware fixture는 자연 H의 canonical contact stats를 보존한다', () => {
    const start = formationRunnerSource.indexOf('function createNaturalHexa(');
    const end = formationRunnerSource.indexOf('\nfunction createPenta(', start);
    const helper = formationRunnerSource.slice(start, end);
    assert.ok(start >= 0 && end > start);
    assert.match(helper, /materializeNaturalHexaFormationActivation\(raw, handle\)/);
    assert.doesNotMatch(helper, /contactHandler\s*:\s*null/);
});

test('H/HX primary fixture는 deterministic n1→n2→n4→n6 geometry를 고정한다', () => {
    const start = formationRunnerSource.indexOf(
        'async function runPrimaryFormationFixture('
    );
    const end = formationRunnerSource.indexOf(
        '\nasync function runReservationPresentationFixture(',
        start
    );
    const fixture = formationRunnerSource.slice(start, end);
    assert.ok(start >= 0 && end > start);
    assert.match(fixture, /tileMap\.tileToWorld\(7, 1, \{\}\)/);
    assert.match(fixture, /pairBase\.y - 0\.4/);
    assert.match(fixture, /pairBase\.y \+ 0\.3/);
    assert.match(fixture, /pairBase\.y - 1\.1/);
    assert.match(fixture, /const pairHalfSeparation = 0\.325;/);
    assert.match(fixture,
        /mateDistance > solverMinimumDistance[\s\S]*?minimumCrossPairDistance < mergeCommitDistance/);
    assert.match(fixture,
        /integrationCosts\.slice\(0, 4\)[\s\S]*?integrationCosts\[4\] > integrationCosts\[0\]/);
    assert.match(fixture, /tileMap\.tileToWorld\(10, 1, \{\}\)/);
    assert.match(fixture, /Formation chain did not converge to HX:[\s\S]*?transformCompletions/);
    assert.match(fixture,
        /const expectedGpuRadius = Math\.fround\(finalGroup\.radius\);/);
    assert.match(fixture, /canonicalRadius: expectedGpuRadius/);
});

test('H/HX reservation fixture는 동일 flow texel의 pre-commit mutual pair를 쓰되 빈 셀 guide를 그리지 않는다', () => {
    const start = formationRunnerSource.indexOf(
        'async function runReservationPresentationFixture('
    );
    const end = formationRunnerSource.indexOf(
        '\nasync function runAtomicRejectFixture(',
        start
    );
    const fixture = formationRunnerSource.slice(start, end);
    assert.ok(start >= 0 && end > start);
    assert.match(fixture, /tileMap\.tileToWorld\(7, 1, \{\}\)/);
    assert.match(fixture,
        /const reservationSeparation = mergeCommitDistance \+ 0\.1;/);
    assert.match(fixture,
        /reservationTiles\[0\]\.column === reservationTiles\[1\]\.column/);
    assert.match(fixture,
        /reservationCosts\[0\] === reservationCosts\[1\]/);
    assert.match(fixture,
        /reservationSeparation > mergeCommitDistance/);
    assert.match(fixture,
        /x - reservationWorldCenter\.x/);
    assert.match(fixture,
        /reserved\[0\]\.position\.x[\s\S]*?- reservationWorldCenter\.x/);
    assert.match(fixture,
        /reserved\[0\]\.position\.y[\s\S]*?- reservationWorldCenter\.y/);
    assert.match(fixture,
        /Hexa reservation flag was not materialized:[\s\S]*?diagnostics/);
    assert.match(fixture,
        /reservationCyanPixelsBefore === 0[\s\S]*?reservationCyanPixelsAfter === 0/);
    assert.match(fixture,
        /reservationCenterOpaque === true/);
    assert.doesNotMatch(fixture,
        /beforeColors: summarizeRoiColors\([\s\S]*?afterColors: summarizeRoiColors\(/);
    assert.doesNotMatch(fixture, /pixel\.b >= 190/);
    assert.doesNotMatch(fixture, /origin\.x \+ 2\.5/);
    assert.doesNotMatch(fixture, /\borigin\.[xy]\b/);
});

for (const [label, startMarker, endMarker, diagnostic] of [
    [
        'atomic reject',
        'async function runAtomicRejectFixture(',
        '\nfunction snapshotMapRecords(',
        'Hexa atomic reject pair missing:'
    ],
    [
        'ABA reset',
        'async function runAbaResetFixture(',
        '\nasync function runGridOverflowFailCloseFixture(',
        'Hexa ABA pre-reset Formation/Effect evidence missing:'
    ]
]) {
    test(`H/HX ${label} fixture는 safe exact-contour pair를 쓴다`, () => {
        const start = formationRunnerSource.indexOf(startMarker);
        const end = formationRunnerSource.indexOf(endMarker, start);
        const fixture = formationRunnerSource.slice(start, end);
        assert.ok(start >= 0 && end > start);
        assert.match(fixture, /tileMap\.tileToWorld\(7, 1, \{\}\)/);
        assert.match(fixture, /const pairHalfSeparation = 0\.325;/);
        assert.match(fixture, /pairCosts\[0\] === pairCosts\[1\]/);
        assert.match(fixture,
            /pairDistance > solverMinimumDistance[\s\S]*?pairDistance < mergeCommitDistance/);
        assert.match(fixture, /tileMap\.tileToWorld\(10, 1, \{\}\)/);
        assert.ok(fixture.includes(diagnostic));
        assert.doesNotMatch(fixture, /\+ 0\.35/);
    });
}

test('H/HX host atomic fixture는 public health를 exact centi-HP로 변환한다', () => {
    const start = formationRunnerSource.indexOf(
        'function runHostAtomicLifecycleFixture()'
    );
    const end = formationRunnerSource.indexOf(
        '\nasync function runAbaResetFixture(',
        start
    );
    const fixture = formationRunnerSource.slice(start, end);
    assert.ok(start >= 0 && end > start);
    assert.match(fixture,
        /const currentHealthCenti = encodeGpuCircleBodyFixedPoint\(\s*activation\.health\s*\);/);
    assert.match(fixture, /const maxHealthCenti = currentHealthCenti;/);
    assert.match(fixture,
        /currentHealthCenti > 0[\s\S]*?currentHealthCenti <= maxHealthCenti/);
    assert.match(fixture,
        /transaction\?\.destinationCurrentHealthCenti[\s\S]*?=== facts\.facts\.descriptor\.currentHealthCenti/);
    assert.match(fixture,
        /transaction\.destinationMaxHealthCenti[\s\S]*?=== facts\.facts\.descriptor\.maxHealthCenti/);
    assert.doesNotMatch(fixture, /activation\.(?:health|maxHealth)FixedPoint/);
    assert.doesNotMatch(fixture, /activation\.maxHealth/);
    assert.doesNotMatch(fixture,
        /destinationView\.metadata\.(?:health|maxHealth)FixedPoint/);
});

test('H/HX motion fixture는 cross-route와 U형 SDF의 exact atlas span을 사용한다', () => {
    const start = formationRunnerSource.indexOf(
        'async function runMotionPolicyFixture('
    );
    const end = formationRunnerSource.indexOf('\nasync function run() {', start);
    const fixture = formationRunnerSource.slice(start, end);
    assert.ok(start >= 0 && end > start);
    assert.match(fixture, /const fixtureRoute = Object\.freeze\(\{/);
    assert.match(fixture, /gateId: `\$\{sourceRoute\.gateId\}-formation-motion-fixture`/);
    assert.match(fixture, /pathId: `\$\{sourceRoute\.pathId\}-formation-motion-fixture`/);
    assert.match(fixture,
        /GPU_FORMATION_MOTION_DIAGNOSTIC_FLAG\.ROUTE_SPAN_REJECTED,[\s\S]*?tileMap/);
    assert.match(fixture,
        /crossRoute\.beforeFlowFieldIndices\[0\][\s\S]*?!== crossRoute\.beforeFlowFieldIndices\[1\]/);
    assert.match(fixture,
        /const blockedTileMap = new TileMap\(Object\.freeze\(\{/);
    assert.match(fixture,
        /directionBlueprint: Object\.freeze\(\['a#g', 'b#f', 'cde'\]\)/);
    assert.match(fixture,
        /blockedTileMap\.tileToWorld\(1, 0, \{\}\)/);
    assert.match(fixture,
        /blockedTileMap\.tileToWorld\(1, 2, \{\}\)/);
    assert.match(fixture,
        /blockedAtlas\.routes\.find\(\(\{ pathId \}\) => \([\s\S]*?pathId === blockedRoute\.pathId/);
    assert.match(fixture,
        /blockedRouteSpan\?\.gateId === blockedRoute\.gateId[\s\S]*?blockedRouteSpan\.pathId === blockedRoute\.pathId/);
    assert.match(fixture,
        /const blockedSourceFieldIndex = blockedRouteSpan\?\.firstFieldIndex;/);
    assert.match(fixture,
        /const blockedTargetFieldIndex = blockedSourceFieldIndex \+ 4;/);
    assert.doesNotMatch(fixture,
        /blockedBodies\[0\]\.flowFieldIndex/);
    assert.match(fixture,
        /blockedCosts\.every\(\(cost\) => cost >= 0 && cost < 1e20\)/);
    assert.match(fixture,
        /Math\.ceil\(blockedDistance \/ grid\.cellSize\)/);
    assert.match(fixture,
        /Math\.min\(\.\.\.sdfSamples\.map\(\(\{ distance \}\) => distance\)\)[\s\S]*?< blockedClearance/);
    assert.match(fixture,
        /GPU_FORMATION_MOTION_DIAGNOSTIC_FLAG\.SDF_SEGMENT_REJECTED,[\s\S]*?blockedTileMap/);
    assert.match(fixture,
        /GPU_FORMATION_MOTION_DIAGNOSTIC_FLAG\.SDF_SEGMENT_REJECTED,[\s\S]*?blockedTileMap,\s*true/);
    const helperStart = formationRunnerSource.indexOf(
        'async function runMotionDiagnosticCase('
    );
    const helperEnd = formationRunnerSource.indexOf(
        '\nasync function runMotionPolicyFixture(',
        helperStart
    );
    const helper = formationRunnerSource.slice(helperStart, helperEnd);
    assert.ok(helperStart >= 0 && helperEnd > helperStart);
    assert.match(helper,
        /captureMotionBeforePrepare = false/);
    assert.match(helper,
        /if \(captureMotionBeforePrepare\) \{[\s\S]*?fixedUpdate\(FIXED_DELTA, 1\)[\s\S]*?onSubmittedWorkDone\(\)[\s\S]*?readFormationMotionDiagnostics\([\s\S]*?\n    \}[\s\S]*?stageFormationPrepareBatch/);
    assert.match(helper,
        /const prepareTick = captureMotionBeforePrepare \? 2 : 1;/);
    assert.doesNotMatch(fixture, /collectBlockedSegmentCandidates/);
    assert.doesNotMatch(fixture, /sample \/ 12/);
});

test('Formation candidate comparator는 compile-safe lexicographic 순서를 보존한다', () => {
    const comparator = GPU_FORMATION_RUNTIME_COMPUTE_WGSL.match(
        /fn candidate_is_better\([\s\S]*?\n\}/
    )?.[0] ?? '';
    assert.notEqual(comparator, '');
    const orderedTerms = [
        'if (distance_squared != (*best).distance_squared)',
        'if (forward_stage_delta != (*best).forward_stage_delta)',
        'if (forward_cost_delta != (*best).forward_cost_delta)',
        'if (identity_before(',
        'if (root_entity_id != (*best).root_entity_id',
        'if (slot_index != (*best).slot)',
        'return rotation_step < (*best).rotation_step;'
    ];
    let previousOffset = -1;
    for (const term of orderedTerms) {
        const offset = comparator.indexOf(term);
        assert.ok(offset > previousOffset, term);
        previousOffset = offset;
    }
    let parenthesisDepth = 0;
    for (const character of comparator) {
        if (character === '(') {
            parenthesisDepth += 1;
        } else if (character === ')') {
            parenthesisDepth -= 1;
            assert.ok(parenthesisDepth >= 0);
        }
    }
    assert.equal(parenthesisDepth, 0);
});

test('Formation WGSL compound assignment는 mutable local만 갱신한다', () => {
    const motion = GPU_FORMATION_RUNTIME_COMPUTE_WGSL.match(
        /fn advance_formation_motion\([\s\S]*?\n\}/
    )?.[0] ?? '';
    assert.notEqual(motion, '');
    assert.match(motion,
        /var desired_velocity = normalize\(delta\)[\s\S]*?desired_velocity -= forward \* dot\(desired_velocity, forward\);/);
    assert.doesNotMatch(motion, /let desired_velocity\b/);

    const compoundAssignment =
        /^[ \t]*([A-Za-z_]\w*)[ \t]*(\+=|-=|\*=|\/=|%=|&=|\|=|\^=|<<=|>>=)/gm;
    for (const match of GPU_FORMATION_RUNTIME_COMPUTE_WGSL.matchAll(
        compoundAssignment
    )) {
        const target = match[1];
        const prefix = GPU_FORMATION_RUNTIME_COMPUTE_WGSL.slice(
            Math.max(0, match.index - 2000),
            match.index
        );
        const declarations = Array.from(prefix.matchAll(
            new RegExp(`\\b(let|var)\\s+${target}\\b`, 'g')
        ));
        assert.equal(
            declarations.at(-1)?.[1],
            'var',
            `${target} ${match[2]}`
        );
    }
    assert.doesNotMatch(
        GPU_FORMATION_RUNTIME_COMPUTE_WGSL,
        /for\s*\(\s*let\s+[A-Za-z_]\w*[\s\S]*?(?:\+=|-=|\*=|\/=|%=|&=|\|=|\^=|<<=|>>=)[\s\S]*?\)/
    );
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
