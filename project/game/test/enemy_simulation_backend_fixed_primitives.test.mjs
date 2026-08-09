import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const { EnemySimulationBackend } = await loadGameModule(
    'ingame/object/enemy/enemy_simulation_backend.js'
);
const { GPU_SPAWN_PROGRAM_MODE } = await loadGameModule(
    'ingame/physics/gpu/gpu_fixed_primitive_abi.js'
);

function createSimulation() {
    const calls = [];
    const completed = [Object.freeze({ marker: 'spawn-completion' })];
    const observed = Object.freeze({
        valid: true,
        entityId: 11,
        incarnation: 4,
        sourceTick: 17,
        observedThroughTick: 17,
        position: Object.freeze({ x: 2, y: 3 }),
        previousPosition: Object.freeze({ x: 1.5, y: 2.5 }),
        velocity: Object.freeze({ x: 0.5, y: 0.5 }),
        ageTicks: 0,
        sessionGeneration: 5,
        deviceGeneration: 6,
        authoritativeEpoch: 7
    });
    return {
        calls,
        observed,
        hasBody(handle) {
            calls.push({ type: 'hasBody', handle });
            return handle.entityId === 11 && handle.incarnation === 4;
        },
        canControlBody(handle) {
            calls.push({ type: 'canControlBody', handle });
            return handle.entityId === 11 && handle.incarnation === 4;
        },
        stageFixedPrograms(plan) {
            calls.push({ type: 'stageFixedPrograms', plan });
            return Object.freeze({
                accepted: plan.controls.length + plan.sourceRelativeSpawns.length,
                rejected: 0
            });
        },
        drainCompletedSpawnProgramBatches(out) {
            calls.push({ type: 'drainCompletedSpawnProgramBatches' });
            out.push(...completed.splice(0));
            return out;
        },
        hasPendingSpawnProgramThroughTick(sourceTick) {
            calls.push({ type: 'hasPendingSpawnProgramThroughTick', sourceTick });
            return sourceTick <= 16;
        },
        configureTowerGameplayTarget(handle) {
            calls.push({ type: 'configureTowerGameplayTarget', handle });
            return Object.freeze({ accepted: true, configured: handle });
        },
        configureTrackedBody(handle) {
            calls.push({ type: 'configureTrackedBody', handle });
            return Object.freeze({ accepted: true, tracked: handle });
        },
        getObservedTrackedPose() {
            calls.push({ type: 'getObservedTrackedPose' });
            return observed;
        },
        getLatestTrackedPose() {
            calls.push({ type: 'getLatestTrackedPose' });
            return observed;
        },
        getRuntimeState() {
            return 'ready';
        },
        getStatus() {
            return Object.freeze({ state: 'ready' });
        },
        getActiveBodyCount() {
            return 1;
        },
        destroy() {
            calls.push({ type: 'destroy' });
        }
    };
}

test('backend fixed primitive seam은 simulation에 exact handle과 bounded plan을 전달한다', () => {
    const backend = new EnemySimulationBackend({}, { sessionGeneration: 5 });
    const simulation = createSimulation();
    backend.simulation = simulation;
    const sourceHandle = Object.freeze({ entityId: 11, incarnation: 4 });
    const targetHandle = Object.freeze({ entityId: 13, incarnation: 2 });
    const destinationHandle = Object.freeze({ entityId: 12, incarnation: 1 });
    const destinationSpawn = Object.freeze({
        kindId: 'projectile',
        definitionId: 'backend_fixed_destination',
        position: Object.freeze({ x: 0, y: 0 }),
        velocity: Object.freeze({ x: 0, y: 0 })
    });
    const plan = Object.freeze({
        targetFixedTick: 17,
        controls: Object.freeze([Object.freeze({
            entityId: sourceHandle.entityId,
            incarnation: sourceHandle.incarnation,
            moveIntentX: 1,
            moveIntentY: 0
        })]),
        sourceRelativeSpawns: Object.freeze([Object.freeze({
            modeFlags: GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
            sourceHandle,
            targetHandle,
            destinationHandle,
            destinationSpawn,
            positionOffset: Object.freeze({ x: 0.25, y: -0.5 }),
            targetOffset: Object.freeze({ x: 0.5, y: -0.25 }),
            launchSpeed: 12
        })])
    });

    assert.equal(backend.canControlBody(sourceHandle), true);
    assert.deepEqual({ ...backend.stageFixedPrograms(plan) }, {
        accepted: 2,
        rejected: 0
    });
    const staged = simulation.calls.find(({ type }) => type === 'stageFixedPrograms');
    assert.equal(staged.plan.targetFixedTick, 17);
    assert.strictEqual(staged.plan.controls, plan.controls);
    assert.equal(staged.plan.sourceRelativeSpawns.length, 1);
    assert.deepEqual(
        { ...staged.plan.sourceRelativeSpawns[0].sourceHandle },
        { ...sourceHandle }
    );
    assert.deepEqual(
        { ...staged.plan.sourceRelativeSpawns[0].targetHandle },
        { ...targetHandle }
    );
    assert.equal(
        staged.plan.sourceRelativeSpawns[0].modeFlags,
        GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY
    );
    assert.deepEqual(
        { ...staged.plan.sourceRelativeSpawns[0].destinationHandle },
        { ...destinationHandle }
    );
    assert.strictEqual(
        staged.plan.sourceRelativeSpawns[0].destinationSpawn,
        destinationSpawn
    );
    assert.equal(
        Object.prototype.hasOwnProperty.call(
            staged.plan.sourceRelativeSpawns[0],
            'sourceSlot'
        ),
        false
    );
    assert.equal(
        Object.prototype.hasOwnProperty.call(
            staged.plan.sourceRelativeSpawns[0],
            'destinationSlot'
        ),
        false
    );
    assert.equal(
        Object.prototype.hasOwnProperty.call(
            staged.plan.sourceRelativeSpawns[0],
            'targetSlot'
        ),
        false
    );

    const out = [];
    assert.strictEqual(backend.drainCompletedSpawnProgramBatches(out), out);
    assert.equal(out.length, 1);
    assert.equal(out[0].marker, 'spawn-completion');
    assert.equal(backend.hasPendingSpawnProgramThroughTick(16), true);
    assert.equal(backend.hasPendingSpawnProgramThroughTick(17), false);
    backend.destroy();
});

test('backend tracked pose canonical getter와 legacy getter는 같은 immutable observation을 보존한다', () => {
    const backend = new EnemySimulationBackend({}, { sessionGeneration: 5 });
    const simulation = createSimulation();
    backend.simulation = simulation;
    const handle = Object.freeze({ entityId: 11, incarnation: 4 });

    const gameplayTarget = backend.configureTowerGameplayTarget(handle);
    assert.equal(gameplayTarget.accepted, true);
    assert.deepEqual({ ...gameplayTarget.configured }, { ...handle });

    const configured = backend.configureTrackedBody(handle);
    assert.equal(configured.accepted, true);
    assert.deepEqual({ ...configured.tracked }, { ...handle });
    const canonical = backend.getObservedTrackedPose();
    const compatibility = backend.getLatestTrackedPose();
    assert.strictEqual(canonical, simulation.observed);
    assert.strictEqual(compatibility, simulation.observed);
    assert.equal(Object.isFrozen(canonical), true);
    assert.equal(Object.isFrozen(canonical.position), true);
    assert.equal(canonical.sourceTick, 17);
    assert.equal(canonical.observedThroughTick, 17);
    backend.destroy();
});

test('새 simulation optional API가 없는 backend fallback은 기존 fake를 깨뜨리지 않는다', () => {
    const backend = new EnemySimulationBackend({}, { sessionGeneration: 5 });
    backend.simulation = {
        getRuntimeState: () => 'ready',
        getStatus: () => Object.freeze({ state: 'ready' }),
        getActiveBodyCount: () => 0,
        destroy() {}
    };
    const marker = Object.freeze({ marker: true });
    const out = [marker];

    assert.equal(backend.canControlBody({ entityId: 1, incarnation: 1 }), false);
    assert.deepEqual({ ...backend.configureTrackedBody(null) }, {
        accepted: false,
        reason: 'gpu-unavailable'
    });
    assert.deepEqual({ ...backend.configureTowerGameplayTarget(null) }, {
        accepted: false,
        reason: 'gpu-unavailable'
    });
    assert.equal(backend.getObservedTrackedPose(), null);
    assert.equal(backend.getLatestTrackedPose(), null);
    assert.strictEqual(backend.drainCompletedSpawnProgramBatches(out), out);
    assert.deepEqual(out, [marker]);
    assert.equal(backend.hasPendingSpawnProgramThroughTick(1), false);
    backend.destroy();
});
