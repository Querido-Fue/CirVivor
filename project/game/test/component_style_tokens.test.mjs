import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGameModule } from './support/source_module_loader.mjs';

const { TYPOGRAPHY } = await loadGameModule('ui/style/typography.js');
const {
    BUTTON_STYLE,
    getButtonStyleTokenName,
    isButtonStyleToken
} = await loadGameModule('ui/style/component_styles.js');
const { resolveButtonStyle } = await loadGameModule(
    'ui/style/_component_style_resolver.js'
);
const { UI_RADIUS, UI_SPACING } = await loadGameModule(
    'ui/layout/layout_tokens.js'
);

const BUTTON_STYLE_EXPECTATIONS = Object.freeze({
    OVERLAY_INTERACT: Object.freeze({
        width: 70,
        height: 17.5,
        margin: 8,
        radius: 3,
        typography: TYPOGRAPHY.BUTTON_PRIMARY,
        align: 'right'
    }),
    OVERLAY_LINK: Object.freeze({
        width: 60,
        height: 15,
        margin: 6.5,
        radius: 3,
        typography: TYPOGRAPHY.BUTTON_LINK,
        align: 'right',
        iconType: 'arrow'
    })
});

/**
 * 테스트 전용 반응형 치수 resolver입니다.
 * @param {{BASE:string,VALUE:number}} metric - 버튼 치수 토큰입니다.
 * @returns {number} 테스트 픽셀 값입니다.
 */
function resolveTestMetric(metric) {
    assert.equal(Object.isFrozen(metric), true);
    if (metric.BASE === 'WW') {
        return metric.VALUE * 10;
    }
    if (metric.BASE === 'WH') {
        return metric.VALUE * 5;
    }
    throw new RangeError(`지원하지 않는 테스트 단위입니다: ${metric.BASE}`);
}

test('두 BUTTON_STYLE 토큰은 승인된 치수와 타이포그래피로 해석된다', () => {
    assert.equal(Object.isFrozen(BUTTON_STYLE), true);
    assert.deepEqual(
        Object.keys(BUTTON_STYLE),
        Object.keys(BUTTON_STYLE_EXPECTATIONS)
    );

    for (const [name, token] of Object.entries(BUTTON_STYLE)) {
        const resolved = resolveButtonStyle(token, resolveTestMetric);
        const expected = BUTTON_STYLE_EXPECTATIONS[name];

        assert.equal(isButtonStyleToken(token), true);
        assert.equal(getButtonStyleTokenName(token), name);
        assert.equal(Object.isFrozen(token), true);
        assert.equal(Object.isFrozen(resolved), true);
        assert.strictEqual(resolved.token, token);
        assert.equal(resolved.name, name);
        assert.equal(resolved.width, expected.width);
        assert.equal(resolved.height, expected.height);
        assert.equal(resolved.margin, expected.margin);
        assert.equal(resolved.radius, expected.radius);
        assert.strictEqual(resolved.typography, expected.typography);
        assert.equal(resolved.align, expected.align);
        assert.equal(resolved.iconType, expected.iconType);

        for (const metricName of ['width', 'height', 'margin', 'radius']) {
            assert.equal(Number.isFinite(resolved[metricName]), true);
            assert.ok(resolved[metricName] > 0);
        }
    }
});

test('BUTTON_STYLE resolver는 위조 토큰과 유효하지 않은 치수 resolver를 거부한다', () => {
    const forgedToken = Object.freeze({ name: 'OVERLAY_INTERACT' });

    for (const invalidToken of [
        forgedToken,
        'OVERLAY_INTERACT',
        null,
        undefined,
        {}
    ]) {
        assert.equal(isButtonStyleToken(invalidToken), false);
        assert.throws(
            () => getButtonStyleTokenName(invalidToken),
            (error) => error?.name === 'TypeError'
        );
        assert.throws(
            () => resolveButtonStyle(invalidToken, resolveTestMetric),
            (error) => error?.name === 'TypeError'
        );
    }

    for (const invalidResolver of [undefined, null, {}, 1]) {
        assert.throws(
            () => resolveButtonStyle(
                BUTTON_STYLE.OVERLAY_INTERACT,
                invalidResolver
            ),
            (error) => error?.name === 'TypeError'
        );
    }
});

test('공용 overlay spacing/radius 토큰은 기존 레이아웃 리듬을 보존한다', () => {
    const expectedMetrics = [
        [UI_SPACING.OVERLAY_PAGE_PADDING_X, 'WW', 1.8],
        [UI_SPACING.DIALOG_PADDING_X, 'WW', 1.5],
        [UI_SPACING.OVERLAY_TITLE_TOP, 'WH', 2.5],
        [UI_SPACING.OVERLAY_TITLE_DIVIDER_GAP, 'WH', 1.5],
        [UI_SPACING.DIALOG_BODY_GAP, 'WH', 1.4],
        [UI_SPACING.OVERLAY_FOOTER_BOTTOM, 'WH', 2.5],
        [UI_RADIUS.OVERLAY_PANEL, 'WW', 0.6]
    ];

    assert.equal(Object.isFrozen(UI_SPACING), true);
    assert.equal(Object.isFrozen(UI_RADIUS), true);
    for (const [metric, expectedBase, expectedValue] of expectedMetrics) {
        assert.equal(Object.isFrozen(metric), true);
        assert.equal(metric.BASE, expectedBase);
        assert.equal(metric.VALUE, expectedValue);
    }
});
