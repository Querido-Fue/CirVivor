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

const simulationSource = await readFile(new URL(
    '../script/module/ingame/physics/gpu/gpu_circle_body_simulation.js',
    import.meta.url
), 'utf8');
const formationRunnerSource = await readFile(new URL(
    'nw_webgpu_capability/enemy_hexa_formation_runner.js',
    import.meta.url
), 'utf8');

test('Formation은 80-byte behavior union과 독립된 versioned ABI/state domain이다', () => {
    assert.equal(GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.STRIDE, 80);
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

test('Formation/HX render WGSL은 Effect 색상 혼합과 Formation payload를 보존한다', () => {
    const vertexShader = GPU_COLLISION_RENDER_WGSL.match(
        /@vertex[\s\S]*?(?=\n@fragment)/
    )?.[0] ?? '';
    assert.notEqual(vertexShader, '');
    assert.doesNotMatch(vertexShader, /presentation_color\.rgb\s*=/);
    assert.match(vertexShader,
        /presentation_color = vec4f\(\s*mix\(\s*presentation_color\.rgb,\s*vec3f\(0\.28, 0\.92, 1\.0\),\s*0\.35\s*\),\s*presentation_color\.a\s*\);/);
    assert.match(vertexShader,
        /presentation_color = vec4f\(\s*mix\(\s*presentation_color\.rgb,\s*vec3f\(0\.72, 1\.0, 0\.95\),\s*0\.55\s*\),\s*presentation_color\.a\s*\);/);
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
    assert.equal(derivativeOffsets.length, 6);
    assert.ok(firstDataDependentControl > 0);
    assert.ok(derivativeOffsets.every(
        (offset) => offset < firstDataDependentControl
    ));
    for (const expression of [
        'let occupied_aa = max(fwidth(occupied_distance), 0.002);',
        'let link_aa = max(fwidth(link_distance), 0.002);',
        'let empty_aa = max(fwidth(empty_distance), 0.002);',
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
    assert.match(fixture, /pairBase\.y - 0\.45/);
    assert.match(fixture, /pairBase\.y \+ 0\.25/);
    assert.match(fixture, /pairBase\.y - 1\.15/);
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

test('H/HX reservation fixture는 동일 flow texel의 pre-commit mutual pair를 쓴다', () => {
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
        /\(pixel\.b \* 255\) >= \(190 \* pixel\.a\)/);
    assert.match(fixture,
        /\(pixel\.g \* 255\) >= \(180 \* pixel\.a\)/);
    assert.match(fixture,
        /\(pixel\.r \* 255\) <= \(180 \* pixel\.a\)/);
    assert.match(fixture,
        /GPU_CIRCLE_BODY_ABI\.TEMPORARY\.PREVIOUS_X/);
    assert.match(fixture,
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

test('H/HX cross-route fixture는 동일 geometry의 두 exact atlas span을 사용한다', () => {
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
    assert.match(fixture, /tileMap\.tileToWorld\(10, 5, \{\}\)/);
    assert.match(fixture, /tileMap\.tileToWorld\(12, 8, \{\}\)/);
    assert.match(fixture,
        /blockedAtlas\.routes\.find\(\(\{ pathId \}\) => \([\s\S]*?pathId === routes\[0\]\.pathId/);
    assert.match(fixture,
        /blockedRouteSpan\?\.gateId === routes\[0\]\.gateId[\s\S]*?blockedRouteSpan\.pathId === routes\[0\]\.pathId/);
    assert.match(fixture,
        /const blockedFieldIndex = blockedRouteSpan\?\.firstFieldIndex;/);
    assert.doesNotMatch(fixture,
        /blockedBodies\[0\]\.flowFieldIndex/);
    assert.match(fixture, /blockedCosts\[0\] > blockedCosts\[1\]/);
    assert.match(fixture,
        /Math\.ceil\(blockedDistance \/ grid\.cellSize\)/);
    assert.match(fixture,
        /Math\.min\(\.\.\.sdfSamples\.map\(\(\{ distance \}\) => distance\)\)[\s\S]*?< blockedClearance/);
    assert.match(fixture,
        /GPU_FORMATION_MOTION_DIAGNOSTIC_FLAG\.SDF_SEGMENT_REJECTED,[\s\S]*?tileMap/);
    assert.match(fixture,
        /GPU_FORMATION_MOTION_DIAGNOSTIC_FLAG\.SDF_SEGMENT_REJECTED,[\s\S]*?tileMap,\s*true/);
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
