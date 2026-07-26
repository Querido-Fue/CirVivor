import { createHash } from 'node:crypto';
import {
    mkdirSync,
    readFileSync,
    writeFileSync
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, '../../..');
const SOURCE_PATH = resolve(
    REPOSITORY_ROOT,
    'project/game/test/fixtures/sdl_porting/legacy_collision_projectile_baseline_v1.json'
);
const OUTPUT_PATH = resolve(
    REPOSITORY_ROOT,
    'native/tests/generated/legacy_collision_first_solve_fixture.h'
);

const SCALAR_FIELDS = Object.freeze([
    'x',
    'y',
    'centerX',
    'centerY',
    'minX',
    'maxX',
    'minY',
    'maxY',
    'sweepMinX',
    'sweepMaxX',
    'sweepMinY',
    'sweepMaxY',
    'enemyPairMinX',
    'enemyPairMaxX',
    'enemyPairMinY',
    'enemyPairMaxY',
    'projectileMinX',
    'projectileMaxX',
    'projectileMinY',
    'projectileMaxY',
    'radius',
    'boundRadius',
    'broadRadius',
    'enemyPairBroadRadius',
    'projectileBroadRadius',
    'resolveRadius',
    'velocityX',
    'velocityY',
    'weight',
    '_frameResolveMoved',
    '_frameResolveMax',
    '_candidatePairCount',
    '_resolvedPairCount',
    '_passPairProcessCount'
]);

const COUNTER_FIELDS = Object.freeze([
    'guaranteedPairCount',
    'priorityAdmissionCount',
    'predictiveAdmissionCount',
    'admissionBudgetSkipCount',
    'candidateVisitCount',
    'scanTruncateCount',
    'bucketPairCount',
    'duplicatePairSkipCount',
    'ruleRejectCount',
    'candidatePairCount'
]);

const REF_TYPE_CODES = Object.freeze({
    square: 1,
    hexa_hive: 2
});
const KIND_CODES = Object.freeze({
    enemy: 1,
    player: 2,
    wall: 3,
    projectile: 4,
    item: 5
});
const SHAPE_CODES = Object.freeze({
    circle: 1,
    circleParts: 2,
    rect: 3
});

class BinaryWriter {
    constructor() {
        this.parts = [];
    }

    bytes(value) {
        this.parts.push(Buffer.from(value));
    }

    u8(value) {
        const part = Buffer.allocUnsafe(1);
        part.writeUInt8(value);
        this.parts.push(part);
    }

    u32(value) {
        const part = Buffer.allocUnsafe(4);
        part.writeUInt32LE(value >>> 0);
        this.parts.push(part);
    }

    i32(value) {
        const part = Buffer.allocUnsafe(4);
        part.writeInt32LE(value | 0);
        this.parts.push(part);
    }

    i64(value) {
        const part = Buffer.allocUnsafe(8);
        part.writeBigInt64LE(BigInt(value));
        this.parts.push(part);
    }

    f32(value) {
        const part = Buffer.allocUnsafe(4);
        part.writeFloatLE(value);
        this.parts.push(part);
    }

    f64(value) {
        const part = Buffer.allocUnsafe(8);
        part.writeDoubleLE(value);
        this.parts.push(part);
    }

    finish() {
        return Buffer.concat(this.parts);
    }
}

function writeCountedValues(writer, values, writeValue) {
    writer.u32(values.length);
    for (const value of values) {
        writeValue.call(writer, value);
    }
}

function writeBody(writer, body) {
    writer.i32(body.slot);
    writer.i32(body.id);
    writer.i32(body.refToken);
    writer.u8(body.refType === null ? 0 : REF_TYPE_CODES[body.refType]);
    writer.u8(KIND_CODES[body.kind]);
    writer.u8(SHAPE_CODES[body.shape]);
    writer.u8(
        (body.movable ? 1 : 0)
        | (body.mergeLock ? 2 : 0)
        | (body.sleeping ? 4 : 0)
        | (body.sleepObservationIncomplete ? 8 : 0)
    );
    writer.u32(body.circlePartCount);
    if (body.circleParts === null) {
        writer.u8(0);
    } else {
        writer.u8(1);
        writeCountedValues(writer, body.circleParts.values, writer.f32);
    }
    for (const field of SCALAR_FIELDS) {
        writer.f64(body.scalars[field] ?? Number.NaN);
    }
}

function serializeFixture(firstSolveInternals) {
    const grid = firstSolveInternals.grid;
    const candidate = firstSolveInternals.candidate;
    const writer = new BinaryWriter();
    writer.bytes('LCFSV001');
    writer.u32(grid.fixedFrameToken);
    writer.u8(grid.gridMode === 'default' ? 0 : 255);
    writer.u8(grid.gridDataOnly ? 1 : 0);
    writer.u32(grid.cellSize);
    writer.u32(grid.gridBodyCount);
    writer.u32(grid.bodies.length);
    for (const body of grid.bodies) {
        writeBody(writer, body);
    }

    writeCountedValues(writer, grid.planes.broad.values, writer.f32);
    writeCountedValues(writer, grid.planes.bodyKind.values, writer.u8);
    writeCountedValues(writer, grid.planes.bodyShape.values, writer.u8);
    writeCountedValues(writer, grid.planes.relation.values, writer.f64);
    writeCountedValues(writer, grid.planes.candidateSweep.values, writer.f64);
    writeCountedValues(writer, grid.planes.candidateSweepValidity.values, writer.u8);

    writer.u32(grid.gridCells.length);
    for (const [key, indices] of grid.gridCells) {
        writer.i64(key);
        writeCountedValues(writer, indices, writer.i32);
    }

    writer.u32(candidate.fixedFrameToken);
    writer.u32(candidate.candidateScanEpoch);
    writer.u32(candidate.nextCandidateScanEpoch);
    writer.u32(candidate.cellScanToken);
    writeCountedValues(writer, candidate.bodyIds, writer.i32);
    for (const pairs of [candidate.priorityPairs, candidate.normalPairs]) {
        writer.u32(pairs.length);
        for (const [low, high] of pairs) {
            writer.i32(low);
            writer.i32(high);
        }
    }
    writer.u32(candidate.fairness.length);
    for (const item of candidate.fairness) {
        writer.i32(item.low);
        writer.i32(item.enemyId);
        writer.u32(item.visitLimit);
        writer.u32(item.cellCount);
        writer.u32(item.cellScanToken);
        writer.u32(item.cellStart);
        writer.u32(item.bucketScanToken);
    }
    for (const field of COUNTER_FIELDS) {
        writer.u32(candidate.counters[field]);
    }
    return writer.finish();
}

function createHeader(blob, sourceSha256) {
    const hex = blob.toString('hex');
    const lines = [];
    for (let index = 0; index < hex.length; index += 120) {
        lines.push(`    "${hex.slice(index, index + 120)}"`);
    }
    return `// Generated by native/tests/support/generate_legacy_collision_first_solve_fixture.mjs.
// Source SHA-256: ${sourceSha256}
// Regenerate: node native/tests/support/generate_legacy_collision_first_solve_fixture.mjs
// Verify: node native/tests/support/generate_legacy_collision_first_solve_fixture.mjs --check
#pragma once

#include <cstddef>
#include <string_view>

namespace cirvivor::test::generated {

inline constexpr std::string_view legacyCollisionFirstSolveSourceSha256 =
    "${sourceSha256}";
inline constexpr std::size_t legacyCollisionFirstSolveByteCount = ${blob.length}U;
inline constexpr std::string_view legacyCollisionFirstSolveHex =
${lines.join('\n')};

} // namespace cirvivor::test::generated
`;
}

function main() {
    const sourceBytes = readFileSync(SOURCE_PATH);
    const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
    const baseline = JSON.parse(sourceBytes.toString('utf8'));
    const blob = serializeFixture(baseline.firstSolveInternals);
    const header = createHeader(blob, sourceSha256);

    if (process.argv.includes('--check')) {
        const current = readFileSync(OUTPUT_PATH, 'utf8');
        if (current !== header) {
            console.error(`Generated fixture is stale: ${OUTPUT_PATH}`);
            process.exitCode = 1;
            return;
        }
        console.log(`Generated fixture is current (${blob.length} bytes).`);
        return;
    }

    mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
    writeFileSync(OUTPUT_PATH, header);
    console.log(`Wrote ${OUTPUT_PATH} (${blob.length} bytes).`);
}

main();
