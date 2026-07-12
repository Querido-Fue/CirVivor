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

assert.equal(COLLISION_CURRENT_CANDIDATE_LIMIT, 24);
assert.equal(COLLISION_PREDICTIVE_CANDIDATE_LIMIT, 8);
assert.equal(COLLISION_CANDIDATE_VISIT_LIMIT, 64);
assert.equal(COLLISION_ANCHOR_CANDIDATE_MULTIPLIER, 2);
assert.equal(getCollisionEnemyCandidateVisitLimit(false), 64);
assert.equal(getCollisionEnemyCandidateVisitLimit(true), 128);
assert.equal(shouldAdmitCollisionEnemyCandidate(23, 8, true, false), true);
assert.equal(shouldAdmitCollisionEnemyCandidate(24, 0, true, false), false);
assert.equal(shouldAdmitCollisionEnemyCandidate(24, 7, false, false), true);
assert.equal(shouldAdmitCollisionEnemyCandidate(0, 8, false, false), false);
assert.equal(shouldAdmitCollisionEnemyCandidate(47, 8, true, true), true);
assert.equal(shouldAdmitCollisionEnemyCandidate(48, 0, true, true), false);
assert.equal(shouldAdmitCollisionEnemyCandidate(24, 15, false, true), true);
assert.equal(shouldAdmitCollisionEnemyCandidate(0, 16, false, true), false);

const bodies = [
    { boundRadius: 10 },
    { boundRadius: 20 },
    { boundRadius: 200 }
];
assert.equal(grid.estimateCollisionGridCellSize(bodies, 'default', 2), 36);
assert.equal(grid.estimateCollisionGridCellSize(bodies, 'default', 3), 184);

console.log('collision candidate admission contract: ok');
