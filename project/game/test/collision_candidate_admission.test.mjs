import assert from 'node:assert/strict';
import { loadGameModule } from './support/source_module_loader.mjs';

const admission = await loadGameModule('physics/collision_candidate_admission.js');
const grid = await loadGameModule('physics/collision_grid_cell_size.js');
const {
    COLLISION_ANCHOR_CANDIDATE_MULTIPLIER,
    COLLISION_CANDIDATE_VISIT_LIMIT,
    COLLISION_CURRENT_CANDIDATE_LIMIT,
    COLLISION_PREDICTIVE_CANDIDATE_LIMIT,
    getCollisionEnemyCandidateVisitLimit,
    shouldAdmitCollisionEnemyCandidate
} = admission;

assert.equal(COLLISION_CURRENT_CANDIDATE_LIMIT, 12);
assert.equal(COLLISION_PREDICTIVE_CANDIDATE_LIMIT, 2);
assert.equal(COLLISION_CANDIDATE_VISIT_LIMIT, 32);
assert.equal(COLLISION_ANCHOR_CANDIDATE_MULTIPLIER, 2);
assert.equal(getCollisionEnemyCandidateVisitLimit(false), 32);
assert.equal(getCollisionEnemyCandidateVisitLimit(true), 64);
assert.equal(shouldAdmitCollisionEnemyCandidate(11, 2, true, false), true);
assert.equal(shouldAdmitCollisionEnemyCandidate(12, 0, true, false), false);
assert.equal(shouldAdmitCollisionEnemyCandidate(12, 1, false, false), true);
assert.equal(shouldAdmitCollisionEnemyCandidate(0, 2, false, false), false);
assert.equal(shouldAdmitCollisionEnemyCandidate(23, 2, true, true), true);
assert.equal(shouldAdmitCollisionEnemyCandidate(24, 0, true, true), false);
assert.equal(shouldAdmitCollisionEnemyCandidate(12, 3, false, true), true);
assert.equal(shouldAdmitCollisionEnemyCandidate(0, 4, false, true), false);

const bodies = [
    { boundRadius: 10 },
    { boundRadius: 20 },
    { boundRadius: 200 }
];
assert.equal(grid.estimateCollisionGridCellSize(bodies, 'default', 2), 36);
assert.equal(grid.estimateCollisionGridCellSize(bodies, 'default', 3), 184);

console.log('collision candidate admission contract: ok');
