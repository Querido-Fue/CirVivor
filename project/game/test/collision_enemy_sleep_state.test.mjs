import assert from 'node:assert/strict';
import { loadGameModule } from './support/source_module_loader.mjs';

const sleepState = await loadGameModule('physics/collision_enemy_sleep_state.js');
const {
    isCollisionEnemySleepObservationComplete,
    markCollisionEnemySleepObservationIncomplete,
    resetCollisionEnemySleepObservation,
    updateCollisionEnemyPostSolveSleepState
} = sleepState;

const observationBodyA = { kind: 'enemy' };
const observationBodyB = { kind: 'enemy' };
resetCollisionEnemySleepObservation(observationBodyA);
resetCollisionEnemySleepObservation(observationBodyB);
assert.equal(isCollisionEnemySleepObservationComplete(observationBodyA), true);
assert.equal(isCollisionEnemySleepObservationComplete(observationBodyB), true);
markCollisionEnemySleepObservationIncomplete(observationBodyA, observationBodyB);
assert.equal(isCollisionEnemySleepObservationComplete(observationBodyA), false);
assert.equal(isCollisionEnemySleepObservationComplete(observationBodyB), false);
resetCollisionEnemySleepObservation(observationBodyA);
assert.equal(isCollisionEnemySleepObservationComplete(observationBodyA), true);

const completeEnemy = {
    position: { x: 10, y: 20 },
    __collisionIdleTicks: 44,
    __collisionSleepTicks: 0
};
updateCollisionEnemyPostSolveSleepState(
    completeEnemy,
    { _candidatePairCount: 0, _resolvedPairCount: 0 },
    45,
    2,
    true
);
assert.equal(completeEnemy.__collisionIdleTicks, 45);
assert.equal(completeEnemy.__collisionSleepTicks, 2);
assert.equal(completeEnemy.__collisionPrevX, 10);
assert.equal(completeEnemy.__collisionPrevY, 20);

const truncatedEnemy = {
    position: { x: 30, y: 40 },
    __collisionIdleTicks: 44,
    __collisionSleepTicks: 1
};
updateCollisionEnemyPostSolveSleepState(
    truncatedEnemy,
    { _candidatePairCount: 0, _resolvedPairCount: 0 },
    45,
    2,
    false
);
assert.equal(truncatedEnemy.__collisionIdleTicks, 0);
assert.equal(truncatedEnemy.__collisionSleepTicks, 0);
assert.equal(truncatedEnemy.__collisionPrevX, 30);
assert.equal(truncatedEnemy.__collisionPrevY, 40);

const contactedEnemy = {
    position: { x: 50, y: 60 },
    __collisionIdleTicks: 44,
    __collisionSleepTicks: 1
};
updateCollisionEnemyPostSolveSleepState(
    contactedEnemy,
    { _candidatePairCount: 1, _resolvedPairCount: 0 },
    45,
    2,
    false
);
assert.equal(contactedEnemy.__collisionIdleTicks, 0);
assert.equal(contactedEnemy.__collisionSleepTicks, 0);

console.log('collision enemy sleep state contract: ok');
