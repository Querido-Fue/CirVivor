/**
 * prepared hexa contact의 기존 aggregate manifold 경로와 boolean 전용 경로를 비교합니다.
 * production merge 후보가 가질 수 있는 circle 및 2/4/6/8 part 분포를 사용합니다.
 */
import { loadGameModule } from '../support/source_module_loader.mjs';

const BODY_COUNT = 256;
const GRID_COLUMNS = 16;
const BODY_SPACING = 40;
const FIXED_DELTA = 1 / 60;
const WARMUP_PAIRS = 4;
const SAMPLE_PAIRS = 21;
const HEX_RADIUS = 0.47;
const SQRT_THREE = Math.sqrt(3);
const VISIBLE_AXIAL_CELLS = Object.freeze([
    [0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 1], [2, 2]
]);
const FILLED_AXIAL_CELLS = Object.freeze([
    ...VISIBLE_AXIAL_CELLS,
    [1, 1]
]);

const { PhysicsSystem } = await loadGameModule('physics/physics_system.js');

/**
 * axial 셀을 중심 정렬된 local center로 변환합니다.
 * @param {number[][]} cells
 * @returns {{x:number,y:number}[]}
 */
function createCenteredLocalCenters(cells) {
    const points = cells.map(([q, r]) => ({
        x: HEX_RADIUS * SQRT_THREE * (q + (r * 0.5)),
        y: HEX_RADIUS * 1.5 * r
    }));
    const centerX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
    const centerY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
    return points.map((point) => ({
        x: point.x - centerX,
        y: point.y - centerY
    }));
}

const visibleCenters = createCenteredLocalCenters(VISIBLE_AXIAL_CELLS);
const filledCenters = createCenteredLocalCenters(FILLED_AXIAL_CELLS);

/**
 * 벤치마크용 hexa 계열 적을 생성합니다.
 * @param {number} id
 * @returns {object}
 */
function createBenchmarkEnemy(id) {
    const index = id - 1;
    const position = {
        x: (index % GRID_COLUMNS) * BODY_SPACING,
        y: Math.floor(index / GRID_COLUMNS) * BODY_SPACING
    };
    const partCountPattern = [1, 2, 4, 6, 8];
    const partCount = partCountPattern[index % partCountPattern.length];
    const type = partCount === 1 ? 'hexa' : 'hexa_hive';
    const enemy = {
        id,
        type,
        active: true,
        position,
        prevPosition: { ...position },
        speed: { x: 0, y: 0 },
        size: 1,
        aspectRatio: 1,
        heightScale: 1,
        rotation: 0,
        weight: 1,
        getRenderHeightPx() {
            return 20;
        }
    };
    if (type === 'hexa_hive') {
        enemy.hexaHiveLayout = {
            visibleLocalCenters: visibleCenters.slice(0, Math.min(7, partCount)),
            filledLocalCenters: filledCenters.slice(0, partCount)
        };
    }
    return enemy;
}

/**
 * prepared cache를 새 frame 기준으로 갱신합니다.
 * @param {PhysicsSystem} physicsSystem
 * @param {object[]} enemies
 */
function prepareContactFrame(physicsSystem, enemies) {
    physicsSystem.beginFrame();
    const count = physicsSystem.prepareEnemyCollisionFrame(enemies, { delta: FIXED_DELTA });
    if (count !== enemies.length) {
        throw new Error(`prepared body count mismatch: ${count}/${enemies.length}`);
    }
}

/**
 * prepared contact 호출 시간을 측정합니다.
 * @param {PhysicsSystem} physicsSystem
 * @param {'collectEnemyContactPairs'|'collectPreparedHexaHiveContactPairs'} methodName
 * @param {object[]} enemies
 * @returns {{elapsedMs:number,pairs:object[]}}
 */
function measurePreparedContact(physicsSystem, methodName, enemies) {
    prepareContactFrame(physicsSystem, enemies);
    const start = process.hrtime.bigint();
    const pairs = physicsSystem[methodName](enemies, { delta: FIXED_DELTA });
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    return { elapsedMs, pairs };
}

/**
 * percentile 값을 반환합니다.
 * @param {number[]} samples
 * @param {number} percentile
 * @returns {number}
 */
function percentile(samples, percentileValue) {
    const sorted = [...samples].sort((left, right) => left - right);
    const index = Math.min(
        sorted.length - 1,
        Math.max(0, Math.ceil(sorted.length * percentileValue) - 1)
    );
    return sorted[index];
}

const enemies = Array.from({ length: BODY_COUNT }, (_, index) => (
    createBenchmarkEnemy(index + 1)
));
const legacyPhysics = new PhysicsSystem();
const booleanPhysics = new PhysicsSystem();

for (let i = 0; i < WARMUP_PAIRS; i++) {
    measurePreparedContact(legacyPhysics, 'collectEnemyContactPairs', enemies);
    measurePreparedContact(booleanPhysics, 'collectPreparedHexaHiveContactPairs', enemies);
}

const legacySamples = [];
const booleanSamples = [];
let expectedPairIds = null;
for (let i = 0; i < SAMPLE_PAIRS; i++) {
    const order = (i & 1) === 0
        ? [
            [legacyPhysics, 'collectEnemyContactPairs', legacySamples],
            [booleanPhysics, 'collectPreparedHexaHiveContactPairs', booleanSamples]
        ]
        : [
            [booleanPhysics, 'collectPreparedHexaHiveContactPairs', booleanSamples],
            [legacyPhysics, 'collectEnemyContactPairs', legacySamples]
        ];
    for (const [physicsSystem, methodName, samples] of order) {
        const measurement = measurePreparedContact(physicsSystem, methodName, enemies);
        samples.push(measurement.elapsedMs);
        const pairIds = Array.from(
            measurement.pairs,
            (pair) => `${pair.enemyA.id}:${pair.enemyB.id}`
        );
        if (!expectedPairIds) {
            expectedPairIds = pairIds;
        } else if (pairIds.join(',') !== expectedPairIds.join(',')) {
            throw new Error(`${methodName} contact pair parity mismatch`);
        }
    }
}

const legacyP50 = percentile(legacySamples, 0.5);
const legacyP95 = percentile(legacySamples, 0.95);
const booleanP50 = percentile(booleanSamples, 0.5);
const booleanP95 = percentile(booleanSamples, 0.95);
console.log('Prepared hexa contact boolean benchmark');
console.log(`runtime: Node ${process.version}, V8 ${process.versions.v8}`);
console.log(`bodies: ${BODY_COUNT}, parts: circle/2/4/6/8, contacts: ${expectedPairIds.length}`);
console.log(`samples: ${SAMPLE_PAIRS} AB/BA pairs after ${WARMUP_PAIRS} warmups`);
console.log(`legacy aggregate p50/p95: ${legacyP50.toFixed(4)}/${legacyP95.toFixed(4)} ms`);
console.log(`prepared boolean p50/p95: ${booleanP50.toFixed(4)}/${booleanP95.toFixed(4)} ms`);
console.log(`speedup p50/p95: ${(legacyP50 / booleanP50).toFixed(2)}x/${(legacyP95 / booleanP95).toFixed(2)}x`);
