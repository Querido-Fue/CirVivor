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
    assert.equal(status.recoveryRequired, false);
});
