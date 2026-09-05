import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    ENEMY_CAPABILITY_ID,
    createEnemyCapabilityMask
} = await loadGameModule('ingame/contract/enemy_capability_contract.js');
const {
    ENEMY_EFFECT_DEFINITION_BY_ID,
    ENEMY_EFFECT_EMITTER_PROFILE_BY_ID,
    PENTA_BOOST_EFFECT_DEFINITION_ID,
    PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE_ID
} = await loadGameModule('data/object/enemy/enemy_effect_catalog_data.js');
const { WorldRegistry } = await loadGameModule(
    'ingame/object/world_registry.js'
);
const { PentagonEffectDirector } = await loadGameModule(
    'ingame/object/enemy/pentagon_effect_director.js'
);
const {
    GPU_EFFECT_PULSE_PROGRAM_RESULT
} = await loadGameModule('ingame/physics/gpu/gpu_effect_runtime_abi.js');

const PROFILE = ENEMY_EFFECT_EMITTER_PROFILE_BY_ID[
    PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE_ID
];
const DEFINITION = ENEMY_EFFECT_DEFINITION_BY_ID[
    PENTA_BOOST_EFFECT_DEFINITION_ID
];
const CAPABILITY_MASK = createEnemyCapabilityMask([
    ENEMY_CAPABILITY_ID.EFFECT_EMITTER
]);

function createEmitterMetadata() {
    return Object.freeze({
        capabilityMask: CAPABILITY_MASK,
        effectEmitterProfileId: PROFILE.id,
        effectEmitterDefinitionCode: PROFILE.emitterDefinitionCode,
        effectDefinitionId: DEFINITION.id,
        effectDefinitionCode: DEFINITION.effectDefinitionCode,
        effectSelfTargetAllowed: PROFILE.selfTargetAllowed,
        effectPentaTargetAllowed: PROFILE.pentaTargetAllowed,
        effectClusterRetargetIntervalTicks: PROFILE.retargetIntervalTicks,
        effectTowerContactDamageModifiable:
            DEFINITION.towerContactDamageEffectModifiable,
        effectProjectileTowerDamageModifiable:
            DEFINITION.projectileTowerDamageEffectModifiable,
        effectDirectCoreImpactDamageModifiable:
            DEFINITION.directCoreImpactDamageEffectModifiable,
        effectProjectileCoreDamageModifiable:
            DEFINITION.typedProjectileCoreDamageEffectModifiable
    });
}

test('Pentagon pulse admission은 4-slot 예산을 tick별로 나누고 due source를 공정 순환한다', () => {
    const sessionGeneration = 301;
    const capacity = 8;
    const registry = new WorldRegistry({ capacity });
    const bodyKeys = new Set();
    const handles = [];
    for (let index = 0; index < 6; index++) {
        const handle = registry.reserveEntity({
            kindId: 'enemy',
            definitionId: 'basic_penta_01',
            createdAtTick: 1
        });
        assert.ok(handle);
        assert.equal(
            registry.activateReserved(handle, createEmitterMetadata()),
            true
        );
        handles.push(handle);
        bodyKeys.add(`${handle.entityId}:${handle.incarnation}`);
    }
    const requests = [];
    let livenessProbeCount = 0;
    const director = new PentagonEffectDirector({
        endpoint: {
            hasBody(handle) {
                livenessProbeCount++;
                return bodyKeys.has(`${handle.entityId}:${handle.incarnation}`);
            },
            getCapacity() { return capacity; },
            getStatus() {
                return Object.freeze({
                    sessionGeneration,
                    effectCommandCapacity: capacity
                });
            }
        },
        registry,
        effectCommandPort: Object.freeze({
            requestPulseBatch(batch) {
                requests.push(batch);
                return Object.freeze({
                    accepted: true,
                    batchId: batch.batchId,
                    targetFixedTick: batch.targetFixedTick,
                    queuedCount: batch.commands.length,
                    replayed: false
                });
            }
        }),
        sessionGeneration,
        capacity
    });
    director.observeLifecycle({
        recoveryRequired: false,
        despawned: [],
        spawned: handles.map((handle) => ({ handle }))
    }, 1);
    livenessProbeCount = 0;

    assert.equal(
        director.stageForFixedTick({ targetFixedTick: 120 }).stagedCount,
        0
    );
    for (const targetFixedTick of [121, 122, 123]) {
        const stage = director.stageForFixedTick({ targetFixedTick });
        assert.equal(stage.accepted, true);
        assert.equal(stage.stagedCount, 2);
    }

    const stagedEntityIds = requests.flatMap((batch) => (
        batch.commands.map((command) => command.sourceHandle.entityId)
    ));
    for (const batch of requests) {
        assert.deepEqual(
            batch.commands.map((command) => command.sourceHandle.entityId),
            batch.commands
                .map((command) => command.sourceHandle.entityId)
                .sort((left, right) => left - right)
        );
    }
    assert.equal(stagedEntityIds.length, 6);
    assert.deepEqual(
        [...new Set(stagedEntityIds)].sort((left, right) => left - right),
        handles.map(({ entityId }) => entityId).sort((left, right) => left - right)
    );
    const status = director.getStatus();
    assert.equal(status.maximumPulseProgramsPerFixedTick, 2);
    assert.equal(status.telemetry.maximumDuePulseCount, 6);
    assert.equal(status.telemetry.maximumStagedPulseCount, 2);
    assert.equal(status.telemetry.quotaDeferredPulseCount, 6);
    assert.equal(status.telemetry.capacityRejectedStageCount, 0);
    assert.equal(status.pendingPulseCount, 6);
    assert.equal(status.recoveryRequired, false);
    assert.ok(
        livenessProbeCount <= 12,
        `bounded liveness audit budget을 초과했습니다: ${livenessProbeCount}`
    );
    const phases = director.pendingPhases;
    let phaseReads = 0;
    director.pendingPhases = new Proxy(phases, {
        get(target, property) {
            if (/^[0-9]+$/.test(String(property))) phaseReads++;
            return Reflect.get(target, property, target);
        }
    });
    for (let sample = 0; sample < 20; sample++) {
        assert.equal(director.getStatus().pendingPulseCount, 6);
    }
    director.pendingPhases = phases;
    assert.equal(phaseReads, 0, 'status polling must not scan the emitter roster');
    director.closeForTerminal(124);
    assert.equal(director.getStatus().pendingPulseCount, 0);
    director.destroy();
});

test('Pentagon pulse schedule은 dense swap despawn 뒤 moved exact handle을 유지한다', () => {
    const sessionGeneration = 302;
    const capacity = 4;
    const registry = new WorldRegistry({ capacity });
    const bodyKeys = new Set();
    const handles = [];
    for (let index = 0; index < 3; index++) {
        const handle = registry.reserveEntity({
            kindId: 'enemy',
            definitionId: 'basic_penta_01',
            createdAtTick: 1
        });
        assert.ok(handle);
        assert.equal(
            registry.activateReserved(handle, createEmitterMetadata()),
            true
        );
        handles.push(handle);
        bodyKeys.add(`${handle.entityId}:${handle.incarnation}`);
    }
    const requests = [];
    const director = new PentagonEffectDirector({
        endpoint: {
            hasBody(handle) {
                return bodyKeys.has(`${handle.entityId}:${handle.incarnation}`);
            },
            getCapacity() { return capacity; },
            getStatus() {
                return Object.freeze({
                    sessionGeneration,
                    effectCommandCapacity: capacity
                });
            }
        },
        registry,
        effectCommandPort: Object.freeze({
            requestPulseBatch(batch) {
                requests.push(batch);
                return Object.freeze({
                    accepted: true,
                    batchId: batch.batchId,
                    targetFixedTick: batch.targetFixedTick,
                    queuedCount: batch.commands.length,
                    replayed: false
                });
            }
        }),
        sessionGeneration,
        capacity
    });
    director.observeLifecycle({
        recoveryRequired: false,
        despawned: [],
        spawned: handles.map((handle) => ({ handle }))
    }, 1);

    assert.ok(registry.remove(handles[0]));
    bodyKeys.delete(`${handles[0].entityId}:${handles[0].incarnation}`);
    director.observeLifecycle({
        recoveryRequired: false,
        despawned: [{ handle: handles[0] }],
        spawned: []
    }, 2);

    assert.equal(
        director.stageForFixedTick({ targetFixedTick: 121 }).stagedCount,
        1
    );
    assert.equal(
        director.stageForFixedTick({ targetFixedTick: 122 }).stagedCount,
        1
    );
    assert.deepEqual(
        requests.flatMap((batch) => batch.commands).map(
            (command) => command.sourceHandle.entityId
        ).sort((left, right) => left - right),
        handles.slice(1).map(({ entityId }) => entityId)
            .sort((left, right) => left - right)
    );
    assert.equal(director.getStatus().activeEmitterCount, 2);
    assert.equal(director.getStatus().pendingPulseCount, 2);
    registry.remove(handles[1]);
    bodyKeys.delete(`${handles[1].entityId}:${handles[1].incarnation}`);
    director.observeLifecycle({ despawned: [{ handle: handles[1] }] }, 123);
    assert.equal(director.getStatus().pendingPulseCount, 1);
    assert.equal(director.getStatus().activeEmitterCount, 1);
    director.resetGpuBinding();
    assert.equal(director.getStatus().pendingPulseCount, 0);
    assert.equal(director.requiresRecovery(), false);
    director.destroy();
});

test('Pentagon pulse admission은 GPU capacity 완료 피드백으로 감산 후 점진 회복한다', () => {
    const sessionGeneration = 303;
    const capacity = 8;
    const registry = new WorldRegistry({ capacity });
    const bodyKeys = new Set();
    const handles = [];
    for (let index = 0; index < 6; index++) {
        const handle = registry.reserveEntity({
            kindId: 'enemy',
            definitionId: 'basic_penta_01',
            createdAtTick: 1
        });
        assert.ok(handle);
        assert.equal(
            registry.activateReserved(handle, createEmitterMetadata()),
            true
        );
        handles.push(handle);
        bodyKeys.add(`${handle.entityId}:${handle.incarnation}`);
    }
    const requests = [];
    const director = new PentagonEffectDirector({
        endpoint: {
            hasBody(handle) {
                return bodyKeys.has(`${handle.entityId}:${handle.incarnation}`);
            },
            getCapacity() { return capacity; },
            getStatus() {
                return Object.freeze({
                    sessionGeneration,
                    effectCommandCapacity: 16
                });
            }
        },
        registry,
        effectCommandPort: Object.freeze({
            requestPulseBatch(batch) {
                requests.push(batch);
                return Object.freeze({
                    accepted: true,
                    batchId: batch.batchId,
                    targetFixedTick: batch.targetFixedTick,
                    queuedCount: batch.commands.length,
                    replayed: false
                });
            }
        }),
        sessionGeneration,
        capacity
    });
    director.observeLifecycle({
        recoveryRequired: false,
        despawned: [],
        spawned: handles.map((handle) => ({ handle }))
    }, 1);

    const firstStage = director.stageForFixedTick({ targetFixedTick: 121 });
    assert.equal(firstStage.stagedCount, 4);
    assert.equal(director.getStatus().pendingPulseCount, 4);
    const firstCommands = requests[0].commands;
    director.observeFixedCommit({
        recoveryRequired: false,
        effectPrograms: {
            state: 'committed',
            recoveryRequired: false,
            batchId: firstStage.batchId,
            programs: firstCommands.map((command) => ({
                commandId: command.commandId,
                sourceHandle: command.sourceHandle,
                pulseSequence: command.pulseSequence
            }))
        }
    }, 121);
    assert.equal(director.getStatus().pendingPulseCount, 4);
    director.observeCompletedEvents({
        fixedTick: 122,
        protocolFailure: null,
        results: firstCommands.map((command, index) => ({
            commandId: command.commandId,
            sourceTick: 121,
            sourceHandle: command.sourceHandle,
            pulseSequence: command.pulseSequence,
            resultCode: index < 2
                ? GPU_EFFECT_PULSE_PROGRAM_RESULT.APPLIED
                : GPU_EFFECT_PULSE_PROGRAM_RESULT.DEFERRED_CAPACITY,
            candidateCount: 1,
            appliedCount: index < 2 ? 1 : 0
        }))
    });
    assert.equal(director.getStatus().currentPulseProgramsPerFixedTick, 2);
    assert.equal(director.getStatus().pendingPulseCount, 0);

    const reducedStage = director.stageForFixedTick({ targetFixedTick: 122 });
    assert.equal(reducedStage.stagedCount, 2);
    assert.equal(director.getStatus().pendingPulseCount, 2);
    const reducedCommands = requests[1].commands;
    assert.deepEqual(
        reducedCommands.map((command) => command.pulseSequence),
        [0, 0]
    );
    director.observeFixedCommit({
        recoveryRequired: false,
        effectPrograms: {
            state: 'committed',
            recoveryRequired: false,
            batchId: reducedStage.batchId,
            programs: reducedCommands.map((command) => ({
                commandId: command.commandId,
                sourceHandle: command.sourceHandle,
                pulseSequence: command.pulseSequence
            }))
        }
    }, 122);
    director.observeCompletedEvents({
        fixedTick: 123,
        protocolFailure: null,
        results: reducedCommands.map((command) => ({
            commandId: command.commandId,
            sourceTick: 122,
            sourceHandle: command.sourceHandle,
            pulseSequence: command.pulseSequence,
            resultCode: GPU_EFFECT_PULSE_PROGRAM_RESULT.ZERO_TARGET,
            candidateCount: 0,
            appliedCount: 0
        }))
    });

    const status = director.getStatus();
    assert.equal(status.pendingPulseCount, 0);
    assert.equal(status.currentPulseProgramsPerFixedTick, 3);
    assert.equal(status.telemetry.capacityFeedbackBatchCount, 2);
    assert.equal(status.telemetry.admissionLimitReductionCount, 1);
    assert.equal(status.telemetry.admissionLimitIncreaseCount, 1);
    assert.equal(status.telemetry.minimumPulseAdmissionLimit, 2);
    assert.equal(status.telemetry.currentPulseAdmissionLimit, 3);
    assert.equal(status.telemetry.capacityRejectedCompletionCount, 2);
    assert.equal(status.recoveryRequired, false);
    director.destroy();
});
