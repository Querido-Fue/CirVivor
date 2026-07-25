import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGameModule } from './support/source_module_loader.mjs';

const {
    TYPOGRAPHY,
    getTypographyTokenName,
    isTypographyToken
} = await loadGameModule('ui/style/typography.js');
const { resolveTypography } = await loadGameModule(
    'ui/style/_typography_resolver.js'
);

const TYPOGRAPHY_ENTRIES = Object.entries(TYPOGRAPHY);
const DEFAULT_CONTEXT = Object.freeze({
    uiWidth: 1920,
    uiHeight: 1080,
    uiScale: 1,
    containerWidth: 420,
    containerHeight: 260,
    variant: 'standard'
});
const FIXED_TYPOGRAPHY_EXPECTATIONS = Object.freeze({
    H1: Object.freeze({ sizeValue: 2, weight: 700 }),
    H2: Object.freeze({ sizeValue: 1.6, weight: 600 }),
    H3: Object.freeze({ sizeValue: 1.3, weight: 400 }),
    H4: Object.freeze({ sizeValue: 1.1, weight: 300 }),
    H5: Object.freeze({ sizeValue: 1, weight: 300 }),
    H6: Object.freeze({ sizeValue: 0.85, weight: 300 }),
    PROGRESS_VALUE: Object.freeze({ sizeValue: 1.1, weight: 700 }),
    LABEL: Object.freeze({ sizeValue: 1, weight: 700 }),
    CONTROL: Object.freeze({ sizeValue: 0.85, weight: 700 }),
    SETTINGS_DESCRIPTION: Object.freeze({ sizeValue: 0.9, weight: 300 }),
    SLIDER_VALUE: Object.freeze({ sizeValue: 0.9, weight: 400 }),
    BUTTON_PRIMARY: Object.freeze({ sizeValue: 1, weight: 600 }),
    BUTTON_LINK: Object.freeze({ sizeValue: 0.8, weight: 500 }),
    LINK_PREVIEW: Object.freeze({ sizeValue: 1, weight: 700 }),
    DISPLAY_ICON: Object.freeze({ sizeValue: 4, weight: 400 }),
    TOOLTIP_TITLE: Object.freeze({
        sizeValue: 0.85,
        weight: 700,
        lineHeightMultiplier: 1.35
    }),
    TOOLTIP_BODY: Object.freeze({
        sizeValue: 0.85,
        weight: 300,
        lineHeightMultiplier: 1.35
    }),
    CARD_DESCRIPTION: Object.freeze({
        sizeValue: 0.85,
        weight: 500,
        lineHeightMultiplier: 1.32
    }),
    BENTO_HERO_TITLE: Object.freeze({ sizeValue: 1.534, weight: 700 }),
    BENTO_HERO_DESCRIPTION: Object.freeze({
        sizeValue: 0.884,
        weight: 300,
        lineHeightMultiplier: 1.35
    }),
    BENTO_COMPACT_TITLE: Object.freeze({ sizeValue: 1.04, weight: 700 }),
    BENTO_CARD_TITLE: Object.freeze({ sizeValue: 1.188, weight: 700 }),
    BENTO_CARD_DESCRIPTION: Object.freeze({
        sizeValue: 0.952,
        weight: 300,
        lineHeightMultiplier: 1.35
    })
});

/**
 * 부동소수점 오차 범위 안에서 두 값이 같은지 확인합니다.
 * @param {number} actual - 실제 값입니다.
 * @param {number} expected - 기대값입니다.
 * @param {string} message - 실패 메시지입니다.
 * @returns {void}
 */
function assertAlmostEqual(actual, expected, message) {
    assert.ok(
        Math.abs(actual - expected) <= 1e-9,
        `${message}: ${actual} !== ${expected}`
    );
}

test('모든 TYPOGRAPHY 토큰은 유효한 Canvas 메트릭으로 해석된다', () => {
    assert.ok(TYPOGRAPHY_ENTRIES.length > 0);
    assert.equal(
        new Set(TYPOGRAPHY_ENTRIES.map(([, token]) => token)).size,
        TYPOGRAPHY_ENTRIES.length
    );

    for (const [name, token] of TYPOGRAPHY_ENTRIES) {
        const resolved = resolveTypography(token, DEFAULT_CONTEXT);

        assert.equal(isTypographyToken(token), true, name);
        assert.equal(getTypographyTokenName(token), name);
        assert.strictEqual(resolved.token, token);
        assert.equal(resolved.name, name);
        assert.equal(Number.isFinite(resolved.size), true, `${name} size`);
        assert.ok(resolved.size > 0, `${name} size`);
        assert.equal(
            Number.isFinite(resolved.lineHeight),
            true,
            `${name} lineHeight`
        );
        assert.ok(resolved.lineHeight > 0, `${name} lineHeight`);
        assert.equal(Number.isFinite(resolved.weight), true, `${name} weight`);
        assert.ok(resolved.weight > 0, `${name} weight`);
        assert.equal(typeof resolved.family, 'string', `${name} family`);
        assert.ok(resolved.family.length > 0, `${name} family`);
        assert.equal(typeof resolved.font, 'string', `${name} font`);
        assert.match(resolved.font, /px\s+.+/, `${name} font`);
    }
});

test('고정 TYPOGRAPHY 역할은 기존 WW 크기·굵기·줄 높이를 보존한다', () => {
    const fixedTokenNames = Object.keys(TYPOGRAPHY)
        .filter((name) => name !== 'CARD_TITLE')
        .sort();
    assert.deepEqual(
        Object.keys(FIXED_TYPOGRAPHY_EXPECTATIONS).sort(),
        fixedTokenNames
    );

    for (const [name, expectation] of Object.entries(
        FIXED_TYPOGRAPHY_EXPECTATIONS
    )) {
        const resolved = resolveTypography(TYPOGRAPHY[name], DEFAULT_CONTEXT);
        const expectedSize = (
            DEFAULT_CONTEXT.uiWidth
            * expectation.sizeValue
            / 100
        );
        const expectedLineHeight = (
            expectedSize
            * (expectation.lineHeightMultiplier ?? 1)
        );

        assertAlmostEqual(resolved.size, expectedSize, `${name} size`);
        assert.equal(resolved.weight, expectation.weight, `${name} weight`);
        assertAlmostEqual(
            resolved.lineHeight,
            expectedLineHeight,
            `${name} lineHeight`
        );
    }
});

test('고정 TYPOGRAPHY 토큰은 uiScale 0.5/1/2에 선형 비례한다', () => {
    const fixedEntries = TYPOGRAPHY_ENTRIES.filter(
        ([, token]) => token !== TYPOGRAPHY.CARD_TITLE
    );

    for (const [name, token] of fixedEntries) {
        const half = resolveTypography(token, {
            ...DEFAULT_CONTEXT,
            uiScale: 0.5
        });
        const normal = resolveTypography(token, {
            ...DEFAULT_CONTEXT,
            uiScale: 1
        });
        const double = resolveTypography(token, {
            ...DEFAULT_CONTEXT,
            uiScale: 2
        });

        assertAlmostEqual(half.size, normal.size * 0.5, `${name} 50% size`);
        assertAlmostEqual(double.size, normal.size * 2, `${name} 200% size`);
        assertAlmostEqual(
            half.lineHeight,
            normal.lineHeight * 0.5,
            `${name} 50% lineHeight`
        );
        assertAlmostEqual(
            double.lineHeight,
            normal.lineHeight * 2,
            `${name} 200% lineHeight`
        );
    }
});

test('CARD_TITLE fluid 정책은 패널 비율·compact 변형·최소 크기를 보존한다', () => {
    const resolveCardTitle = (overrides) => resolveTypography(
        TYPOGRAPHY.CARD_TITLE,
        {
            uiScale: 1,
            ...overrides
        }
    );

    const portrait = resolveCardTitle({
        containerWidth: 400,
        containerHeight: 400
    });
    assert.equal(portrait.size, 38);
    assert.equal(portrait.weight, 700);
    assertAlmostEqual(
        portrait.lineHeight,
        portrait.size * 1.06,
        'CARD_TITLE lineHeight'
    );
    assert.equal(
        resolveCardTitle({
            containerWidth: 400,
            containerHeight: 200
        }).size,
        32
    );
    assertAlmostEqual(
        resolveCardTitle({
            containerWidth: 400,
            containerHeight: 200,
            variant: 'compact-horizontal'
        }).size,
        56,
        'CARD_TITLE compact-horizontal size'
    );
    assert.equal(
        resolveCardTitle({
            containerWidth: 100,
            containerHeight: 50
        }).size,
        16
    );
});

test('CARD_TITLE은 uiScale과 함께 스케일된 패널 문맥에서 선형 비례한다', () => {
    const resolveAtScale = (uiScale) => resolveTypography(
        TYPOGRAPHY.CARD_TITLE,
        {
            uiScale,
            containerWidth: 400 * uiScale,
            containerHeight: 200 * uiScale
        }
    );
    const half = resolveAtScale(0.5);
    const normal = resolveAtScale(1);
    const double = resolveAtScale(2);

    assertAlmostEqual(half.size, normal.size * 0.5, 'CARD_TITLE 50% size');
    assertAlmostEqual(double.size, normal.size * 2, 'CARD_TITLE 200% size');
    assertAlmostEqual(
        half.lineHeight,
        normal.lineHeight * 0.5,
        'CARD_TITLE 50% lineHeight'
    );
    assertAlmostEqual(
        double.lineHeight,
        normal.lineHeight * 2,
        'CARD_TITLE 200% lineHeight'
    );
});

test('TYPOGRAPHY 토큰과 resolver 결과는 외부에서 변경할 수 없다', () => {
    assert.equal(Object.isFrozen(TYPOGRAPHY), true);

    for (const [name, token] of TYPOGRAPHY_ENTRIES) {
        assert.equal(Object.isFrozen(token), true, `${name} token`);
        assert.equal(Reflect.set(token, 'name', 'MUTATED'), false, name);

        const resolved = resolveTypography(token, DEFAULT_CONTEXT);
        assert.equal(Object.isFrozen(resolved), true, `${name} result`);
        assert.equal(Reflect.set(resolved, 'size', -1), false, name);
        assert.equal(Reflect.deleteProperty(resolved, 'font'), false, name);
        assert.strictEqual(resolved.token, token);
    }
});

test('이름이 같은 위조 객체와 일반 값은 TYPOGRAPHY 토큰으로 인정하지 않는다', () => {
    const forgedToken = Object.freeze({ name: 'H1' });

    for (const invalidToken of [
        forgedToken,
        'H1',
        null,
        undefined,
        {},
        Symbol('H1')
    ]) {
        assert.equal(isTypographyToken(invalidToken), false);
        assert.throws(
            () => getTypographyTokenName(invalidToken),
            (error) => error?.name === 'TypeError'
        );
        assert.throws(
            () => resolveTypography(invalidToken, DEFAULT_CONTEXT),
            (error) => error?.name === 'TypeError'
        );
    }
});
