import assert from 'node:assert/strict';
import { loadGameModule } from './support/source_module_loader.mjs';

const admission = await loadGameModule('physics/collision_candidate_admission.js');
const grid = await loadGameModule('physics/collision_grid_cell_size.js');
const {
    COLLISION_ANCHOR_CANDIDATE_MULTIPLIER,
    COLLISION_CANDIDATE_VISIT_LIMIT,
    COLLISION_CURRENT_CANDIDATE_LIMIT,
    COLLISION_PREDICTIVE_CANDIDATE_LIMIT,
    getCollisionEnemyCandidateBucketScanToken,
    getCollisionEnemyCandidateVisitLimit,
    shouldAdmitCollisionEnemyCandidate
} = admission;

assert.equal(COLLISION_CURRENT_CANDIDATE_LIMIT, 12);
assert.equal(COLLISION_PREDICTIVE_CANDIDATE_LIMIT, 2);
assert.equal(COLLISION_CANDIDATE_VISIT_LIMIT, 32);
assert.equal(COLLISION_ANCHOR_CANDIDATE_MULTIPLIER, 2);
assert.equal(getCollisionEnemyCandidateVisitLimit(false), 32);
assert.equal(getCollisionEnemyCandidateVisitLimit(true), 64);
assert.equal(getCollisionEnemyCandidateBucketScanToken(0, 32), 0);
assert.equal(getCollisionEnemyCandidateBucketScanToken(1, 32), 32);
assert.equal(getCollisionEnemyCandidateBucketScanToken(2, 32), 64);
assert.equal(getCollisionEnemyCandidateBucketScanToken(1, 64), 64);
assert.equal(getCollisionEnemyCandidateBucketScanToken(0, 32, 2, 0), 0);
assert.equal(getCollisionEnemyCandidateBucketScanToken(1, 32, 2, 0), 0);
assert.equal(getCollisionEnemyCandidateBucketScanToken(2, 32, 2, 0), 32);
assert.equal(getCollisionEnemyCandidateBucketScanToken(Number.NaN, Number.NaN), 0);
assert.equal(shouldAdmitCollisionEnemyCandidate(11, 2, true, false), true);
assert.equal(shouldAdmitCollisionEnemyCandidate(12, 0, true, false), false);
assert.equal(shouldAdmitCollisionEnemyCandidate(12, 1, false, false), true);
assert.equal(shouldAdmitCollisionEnemyCandidate(0, 2, false, false), false);
assert.equal(shouldAdmitCollisionEnemyCandidate(23, 2, true, true), true);
assert.equal(shouldAdmitCollisionEnemyCandidate(24, 0, true, true), false);
assert.equal(shouldAdmitCollisionEnemyCandidate(12, 3, false, true), true);
assert.equal(shouldAdmitCollisionEnemyCandidate(0, 4, false, true), false);

/**
 * 연속 rebuild epoch의 방문 창이 bucket 전체를 page 단위로 덮는지 검증합니다.
 * @param {number} bucketCount - bucket 원소 수입니다.
 * @param {number} visitLimit - rebuild당 방문 상한입니다.
 */
function assertPagedBucketCoverage(bucketCount, visitLimit) {
    const visited = new Set();
    const epochCount = Math.ceil(bucketCount / visitLimit);
    for (let epoch = 0; epoch < epochCount; epoch++) {
        const start = getCollisionEnemyCandidateBucketScanToken(epoch, visitLimit) % bucketCount;
        for (let offset = 0; offset < Math.min(visitLimit, bucketCount); offset++) {
            visited.add((start + offset) % bucketCount);
        }
    }
    assert.equal(
        visited.size,
        bucketCount,
        `bucket=${bucketCount}, visitLimit=${visitLimit} coverage`
    );
}

for (const bucketCount of [32, 48, 64, 96, 128, 800]) {
    assertPagedBucketCoverage(bucketCount, 32);
    assertPagedBucketCoverage(bucketCount, 64);
}

const normalFirstPage = getCollisionEnemyCandidateBucketScanToken(0, 32) % 64;
const normalSecondPage = getCollisionEnemyCandidateBucketScanToken(1, 32) % 64;
assert.equal(normalFirstPage, 0);
assert.equal(normalSecondPage, 32);
const anchorFirstPage = getCollisionEnemyCandidateBucketScanToken(0, 64) % 128;
const anchorSecondPage = getCollisionEnemyCandidateBucketScanToken(1, 64) % 128;
assert.equal(anchorFirstPage, 0);
assert.equal(anchorSecondPage, 64);

/**
 * 여러 cell 중 선두 cell만 방문 상한을 채워도 각 cell의 모든 page를 방문하는지 검증합니다.
 * @param {number} cellCount - low body가 순회할 cell 수입니다.
 * @param {number} bucketCount - cell별 bucket 원소 수입니다.
 * @param {number} visitLimit - rebuild당 방문 상한입니다.
 * @param {number} lowOffset - low body별 시작 위상입니다.
 */
function assertMultiCellLeadingPageCoverage(cellCount, bucketCount, visitLimit, lowOffset) {
    const visitedByCell = Array.from({ length: cellCount }, () => new Set());
    const pageCount = Math.ceil(bucketCount / visitLimit);
    const epochCount = cellCount * pageCount;
    for (let epoch = 0; epoch < epochCount; epoch++) {
        const cellScanPhase = epoch + lowOffset;
        const leadingCell = cellScanPhase % cellCount;
        const start = getCollisionEnemyCandidateBucketScanToken(
            epoch,
            visitLimit,
            cellCount,
            lowOffset
        ) % bucketCount;
        for (let offset = 0; offset < Math.min(visitLimit, bucketCount); offset++) {
            visitedByCell[leadingCell].add((start + offset) % bucketCount);
        }
    }
    for (let cellIndex = 0; cellIndex < cellCount; cellIndex++) {
        assert.equal(
            visitedByCell[cellIndex].size,
            bucketCount,
            `cells=${cellCount}, cell=${cellIndex}, bucket=${bucketCount}, limit=${visitLimit}`
        );
    }
}

for (const lowOffset of [0, 1, 7]) {
    assertMultiCellLeadingPageCoverage(2, 128, 32, lowOffset);
    assertMultiCellLeadingPageCoverage(3, 96, 32, lowOffset);
    assertMultiCellLeadingPageCoverage(2, 128, 64, lowOffset);
}

const bodies = [
    { boundRadius: 10 },
    { boundRadius: 20 },
    { boundRadius: 200 }
];
assert.equal(grid.estimateCollisionGridCellSize(bodies, 'default', 2), 36);
assert.equal(grid.estimateCollisionGridCellSize(bodies, 'default', 3), 184);

console.log('collision candidate admission contract: ok');
