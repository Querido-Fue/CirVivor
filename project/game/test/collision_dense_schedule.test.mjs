import assert from 'node:assert/strict';
import { loadGameModule } from './support/source_module_loader.mjs';

const tuning = await loadGameModule('physics/_collision_resolve_tuning.js');
const {
    DENSE_POSITION_SOLVE_MAX_PASSES,
    getCollisionDensePressure,
    getCollisionResolvePassBoost
} = tuning;

assert.equal(DENSE_POSITION_SOLVE_MAX_PASSES, 3);

for (let bodyCount = 1; bodyCount <= 1000; bodyCount += 17) {
    let previousPressure = -1;
    for (let peak = 0; peak <= 20; peak++) {
        const pressure = getCollisionDensePressure(bodyCount * 0.2, bodyCount, peak);
        assert.ok(Number.isFinite(pressure));
        assert.ok(pressure >= 0 && pressure <= 1);
        assert.ok(pressure >= previousPressure);
        previousPressure = pressure;
    }
}

for (let passIndex = 0; passIndex < DENSE_POSITION_SOLVE_MAX_PASSES; passIndex++) {
    let previousPopulationBoost = 0;
    for (let bodyCount = 1; bodyCount <= 1000; bodyCount++) {
        const boost = getCollisionResolvePassBoost(passIndex, bodyCount, 1);
        assert.ok(Number.isFinite(boost));
        assert.ok(boost >= 1);
        assert.ok(boost >= previousPopulationBoost);
        previousPopulationBoost = boost;
    }
}

assert.equal(getCollisionResolvePassBoost(0, 800, 1), 1);
assert.ok(getCollisionResolvePassBoost(2, 800, 1) >= getCollisionResolvePassBoost(1, 800, 1));
assert.ok(Math.abs(
    getCollisionResolvePassBoost(2, 512, 1)
    - getCollisionResolvePassBoost(2, 511, 1)
) < 0.01);
assert.ok(Math.abs(
    getCollisionDensePressure(0, 800, 8)
    - getCollisionDensePressure(0, 800, 7)
) <= 0.11);

console.log('collision dense schedule contract: ok');
