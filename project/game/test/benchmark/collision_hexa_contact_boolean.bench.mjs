/**
 * prepared hexa contact의 direct JS boolean scan과 production WASM batch를 비교합니다.
 * body/part/candidate 생성은 동일한 CollisionHandler JS 경로에 남겨 실제 pack/call/read 비용과
 * contact total을 함께 측정합니다.
 */
import { loadGameModule } from '../support/source_module_loader.mjs';

const BODY_COUNT = 256;
const GRID_COLUMNS = 16;
const BODY_SPACING = 40;
const FIXED_DELTA = 1 / 60;
const WARMUP_PAIRS = 4;
const SAMPLE_PAIRS = 21;
const MINIMUM_SCAN_SPEEDUP = 1.30;
const MINIMUM_TOTAL_REDUCTION = 0.15;
const HEX_RADIUS = 0.47;
const SQRT_THREE = Math.sqrt(3);
const VISIBLE_AXIAL_CELLS = Object.freeze([
    [0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 1], [2, 2]
]);
const FILLED_AXIAL_CELLS = Object.freeze([
    ...VISIBLE_AXIAL_CELLS,
    [1, 1], [3, 1], [3, 2]
]);

const { CollisionProfileRecorder } = await loadGameModule(
    'physics/collision_profile_recorder.js'
);
const { CollisionHandler } = await loadGameModule('physics/_collision_handler.js');
const { getCollisionContactBackendStatus } = await loadGameModule(
    'physics/wasm/_collision_contact_backend.js'
);

// VM test loader에는 performance를 주입하지 않으므로 benchmark 프로세스의 monotonic clock을 사용합니다.
CollisionProfileRecorder.prototype.startTimer = function startBenchmarkTimer() {
    return process.hrtime.bigint();
};
CollisionProfileRecorder.prototype.recordDuration = function recordBenchmarkDuration(
    fieldName,
    startTime
) {
    if (typeof startTime !== 'bigint') return;
    const durationMs = Number(process.hrtime.bigint() - startTime) / 1e6;
    const current = Number.isFinite(this.frameStats[fieldName])
        ? this.frameStats[fieldName]
        : 0;
    this.frameStats[fieldName] = current + durationMs;
};

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
 * production 최대 10 part 범위를 포함하는 hexa 계열 적을 생성합니다.
 * @param {number} id
 * @returns {object}
 */
function createBenchmarkEnemy(id) {
    const index = id - 1;
    const position = {
        x: (index % GRID_COLUMNS) * BODY_SPACING,
        y: Math.floor(index / GRID_COLUMNS) * BODY_SPACING
    };
    const partCountPattern = [1, 2, 4, 6, 8, 10];
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
 * 한 handler의 prepared contact scan과 내부 profile 값을 측정합니다.
 * @param {CollisionHandler} handler
 * @param {object[]} enemies
 * @returns {{pairs:object[],scanMs:number,totalMs:number}}
 */
function measurePreparedContact(handler, enemies) {
    handler.resetFrameStats();
    const count = handler.prepareEnemyCollisionFrame(enemies, { delta: FIXED_DELTA });
    if (count !== enemies.length) {
        throw new Error(`prepared body count mismatch: ${count}/${enemies.length}`);
    }
    const pairs = handler.collectPreparedHexaHiveContactPairs(
        enemies,
        { delta: FIXED_DELTA }
    );
    const stats = handler.getFrameStats();
    return {
        pairs,
        scanMs: stats.contactPairScanMs,
        totalMs: stats.contactTotalMs
    };
}

/**
 * nearest-rank percentile을 반환합니다.
 * @param {number[]} samples
 * @param {number} percentileValue
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

/**
 * pair 결과를 다음 재사용 호출 전에 안정적인 문자열로 복사합니다.
 * @param {{enemyA:object,enemyB:object}[]} pairs
 * @returns {string[]}
 */
function snapshotPairIds(pairs) {
    return Array.from(pairs, (pair) => `${pair.enemyA.id}:${pair.enemyB.id}`);
}

const enemies = Array.from({ length: BODY_COUNT }, (_, index) => (
    createBenchmarkEnemy(index + 1)
));
const jsHandler = new CollisionHandler({ contactBackend: null });
const wasmHandler = new CollisionHandler();

for (let i = 0; i < WARMUP_PAIRS; i++) {
    measurePreparedContact(jsHandler, enemies);
    measurePreparedContact(wasmHandler, enemies);
}

const jsScanSamples = [];
const wasmScanSamples = [];
const jsTotalSamples = [];
const wasmTotalSamples = [];
let expectedPairIds = null;
for (let i = 0; i < SAMPLE_PAIRS; i++) {
    const order = (i & 1) === 0
        ? [
            [jsHandler, jsScanSamples, jsTotalSamples, 'js'],
            [wasmHandler, wasmScanSamples, wasmTotalSamples, 'wasm']
        ]
        : [
            [wasmHandler, wasmScanSamples, wasmTotalSamples, 'wasm'],
            [jsHandler, jsScanSamples, jsTotalSamples, 'js']
        ];
    for (const [handler, scanSamples, totalSamples, label] of order) {
        const measurement = measurePreparedContact(handler, enemies);
        scanSamples.push(measurement.scanMs);
        totalSamples.push(measurement.totalMs);
        const pairIds = snapshotPairIds(measurement.pairs);
        if (!expectedPairIds) {
            expectedPairIds = pairIds;
        } else if (pairIds.join(',') !== expectedPairIds.join(',')) {
            throw new Error(`${label} prepared contact pair parity/order mismatch`);
        }
    }
}

const jsScanP50 = percentile(jsScanSamples, 0.5);
const jsScanP95 = percentile(jsScanSamples, 0.95);
const wasmScanP50 = percentile(wasmScanSamples, 0.5);
const wasmScanP95 = percentile(wasmScanSamples, 0.95);
const jsTotalP50 = percentile(jsTotalSamples, 0.5);
const jsTotalP95 = percentile(jsTotalSamples, 0.95);
const wasmTotalP50 = percentile(wasmTotalSamples, 0.5);
const wasmTotalP95 = percentile(wasmTotalSamples, 0.95);
const scanSpeedupP50 = jsScanP50 / wasmScanP50;
const scanSpeedupP95 = jsScanP95 / wasmScanP95;
const totalReductionP50 = 1 - (wasmTotalP50 / jsTotalP50);
const totalReductionP95 = 1 - (wasmTotalP95 / jsTotalP95);
const backendStatus = getCollisionContactBackendStatus();

console.log('Prepared hexa contact WASM benchmark');
console.log(`runtime: Node ${process.version}, V8 ${process.versions.v8}`);
console.log(`bodies: ${BODY_COUNT}, parts: circle/2/4/6/8/10, contacts: ${expectedPairIds.length}`);
console.log(`samples: ${SAMPLE_PAIRS} AB/BA pairs after ${WARMUP_PAIRS} warmups`);
console.log(`JS scan p50/p95: ${jsScanP50.toFixed(4)}/${jsScanP95.toFixed(4)} ms`);
console.log(`WASM pack+scan+read p50/p95: ${wasmScanP50.toFixed(4)}/${wasmScanP95.toFixed(4)} ms`);
console.log(`scan speedup p50/p95: ${scanSpeedupP50.toFixed(2)}x/${scanSpeedupP95.toFixed(2)}x`);
console.log(`JS contact total p50/p95: ${jsTotalP50.toFixed(4)}/${jsTotalP95.toFixed(4)} ms`);
console.log(`WASM contact total p50/p95: ${wasmTotalP50.toFixed(4)}/${wasmTotalP95.toFixed(4)} ms`);
console.log(`total reduction p50/p95: ${(totalReductionP50 * 100).toFixed(2)}%/${(totalReductionP95 * 100).toFixed(2)}%`);

if (backendStatus.state !== 'wasm-ready' || backendStatus.wasmScanCount < SAMPLE_PAIRS) {
    throw new Error(`production collision contact backend가 WASM을 사용하지 않았습니다: ${JSON.stringify(backendStatus)}`);
}
if (scanSpeedupP50 < MINIMUM_SCAN_SPEEDUP || scanSpeedupP95 < MINIMUM_SCAN_SPEEDUP) {
    throw new Error('collision contact WASM scan이 p50/p95 1.30x gate를 통과하지 못했습니다.');
}
if (totalReductionP50 < MINIMUM_TOTAL_REDUCTION || totalReductionP95 < MINIMUM_TOTAL_REDUCTION) {
    throw new Error('collision contact WASM total이 p50/p95 15% gate를 통과하지 못했습니다.');
}
console.log('production gate: pass');
