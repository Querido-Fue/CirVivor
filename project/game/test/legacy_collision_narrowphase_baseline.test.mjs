import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
    exportLegacyCollisionNarrowphaseBaseline
} from './support/export_legacy_collision_narrowphase_baseline.mjs';

const SOURCE_FIXTURE_URL = new URL(
    './fixtures/sdl_porting/legacy_collision_narrowphase_source_v1.json',
    import.meta.url
);
const BASELINE_FIXTURE_URL = new URL(
    './fixtures/sdl_porting/legacy_collision_narrowphase_baseline_v1.json',
    import.meta.url
);

const EXPECTED_HASHES = Object.freeze({
    productionSourcesSha256: 'd8bf18c4d175b9e00354615312f60f8e72040728bba749148eed07fd18925be9',
    sourceCanonicalSha256: 'a0dbe0e4b6c5ed040fe3120def34ef84b01d99e86fe4bd2f961ee4626021efe1',
    bodyF64RawSha256: 'f9c41849d90830a5bb349c49657d8c9ad34c7f216127bc6bf368df6f104cd61c',
    circlePartF32RawSha256: 'e47c942a1e574d2e5c531e72568af50441f5c5f7bc55ea2e815aeaa07922b99f',
    caseOrderSha256: '0c704b9a1e9657643dda0684b1e59b1b8d8d69756ec46b47656c96fe1d11ab3d',
    collisionMaskSha256: 'd2c9ebe5581b24589f93a6ca162f47f7ad7be2bba6f1a26a94a3d93da440ec4e',
    manifoldF64RawSha256: '89648ea08dbcf1a9c6158623d48c1f67ddf6001b5ea5f887cd483ae3d518e9e1'
});

function getCase(baseline, caseId) {
    const result = baseline.cases.find((entry) => entry.id === caseId);
    assert.ok(result, 'baseline case가 없습니다: ' + caseId);
    return result;
}

test('production generic narrowphase oracle는 raw-bit baseline을 결정론적으로 재생한다', async () => {
    const sourceText = await readFile(SOURCE_FIXTURE_URL, 'utf8');
    const baselineText = await readFile(BASELINE_FIXTURE_URL, 'utf8');
    const source = JSON.parse(sourceText);
    const expected = JSON.parse(baselineText);

    const first = await exportLegacyCollisionNarrowphaseBaseline(source);
    const second = await exportLegacyCollisionNarrowphaseBaseline(source);
    const firstBytes = JSON.stringify(first, null, 2) + '\n';
    const secondBytes = JSON.stringify(second, null, 2) + '\n';

    assert.equal(firstBytes, secondBytes);
    assert.equal(firstBytes, baselineText);
    assert.deepEqual(first, expected);
    assert.equal(first.oracle.directExportInvocation, true);
    assert.equal(first.source.bodyCount, 28);
    assert.equal(first.source.circlePartCount, 17);
    assert.equal(first.source.caseCount, 27);
    assert.equal(first.result.collisionCount, 22);
    assert.equal(first.result.manifoldF64ValueCount, 110);

    assert.equal(
        first.oracle.productionSourcesSha256,
        EXPECTED_HASHES.productionSourcesSha256
    );
    assert.equal(first.source.canonicalSha256, EXPECTED_HASHES.sourceCanonicalSha256);
    assert.equal(first.source.bodyF64RawSha256, EXPECTED_HASHES.bodyF64RawSha256);
    assert.equal(
        first.source.circlePartF32RawSha256,
        EXPECTED_HASHES.circlePartF32RawSha256
    );
    assert.equal(first.source.caseOrderSha256, EXPECTED_HASHES.caseOrderSha256);
    assert.equal(first.result.collisionMaskSha256, EXPECTED_HASHES.collisionMaskSha256);
    assert.equal(
        first.result.manifoldF64RawSha256,
        EXPECTED_HASHES.manifoldF64RawSha256
    );

    assert.equal(
        source.bodies.find((body) => body.id === 'cc_invalid_nan').f64.centerX,
        '0x7ff8000000000001'
    );
    assert.equal(
        source.bodies.find((body) => body.id === 'parts_circle_a').parts[0].centerX,
        '0x7fc00001'
    );

    assert.deepEqual(
        getCase(first, 'parts_circle_multi_contact').rawF64,
        {
            normalX: '0x0000000000000000',
            normalY: '0x3ff0000000000000',
            penetration: '0x4015ac8fe621fc54',
            pointX: '0x0000000000000000',
            pointY: '0x4009f707af371edb'
        }
    );
    assert.equal(
        getCase(first, 'circle_parts_reverse_signed_zero').rawF64.normalX,
        '0x8000000000000000'
    );
    assert.deepEqual(
        getCase(first, 'parts_circle_diagonal_fallback_normal').rawF64,
        {
            normalX: '0x3fe6a09e667f3bcc',
            normalY: '0x3fe6a09e667f3bcc',
            penetration: '0x4024000000000000',
            pointX: '0x40162463000f8560',
            pointY: '0x40162463000f8560'
        }
    );
    assert.equal(
        getCase(first, 'rect_circle_reverse_signed_zero').rawF64.normalY,
        '0x8000000000000000'
    );
    assert.equal(
        getCase(first, 'rect_parts_reverse_signed_zero').rawF64.normalY,
        '0x8000000000000000'
    );

    assert.deepEqual(
        getCase(first, 'circle_rect_inside_all_tie_right_wins').rawF64,
        {
            normalX: '0xbff0000000000000',
            normalY: '0x0000000000000000',
            penetration: '0x401c000000000000',
            pointX: '0x4024000000000000',
            pointY: '0x4014000000000000'
        }
    );
    assert.deepEqual(
        getCase(first, 'circle_rect_inside_left_top_tie_top_wins').rawF64,
        {
            normalX: '0x0000000000000000',
            normalY: '0x3ff0000000000000',
            penetration: '0x4008000000000000',
            pointX: '0x3ff0000000000000',
            pointY: '0x0000000000000000'
        }
    );
    assert.equal(
        getCase(first, 'circle_circle_enemy_scaled_tangent_rejected').collided,
        false
    );
    assert.equal(getCase(first, 'rect_rect_unsupported').collided, false);
});
