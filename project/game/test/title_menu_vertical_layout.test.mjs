import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGameModule } from './support/source_module_loader.mjs';

const { TITLE_CONSTANTS } = await loadGameModule('data/scene/title/title_constants.js');
const { buildTitleMenuRightPaneLayout } = await loadGameModule(
    'scene/title/menu/_title_menu_pane_layout.js'
);
const { resolveTitleMenuVerticalStackLayout } = await loadGameModule(
    'scene/title/menu/_title_menu_vertical_layout.js'
);
const TITLE_CARD_MENU = TITLE_CONSTANTS.TITLE_CARD_MENU;
const SECONDARY_MENU_ENTRIES = Object.freeze([
    Object.freeze({ id: 'setting' }),
    Object.freeze({ id: 'credits' }),
    Object.freeze({ id: 'achievements' }),
    Object.freeze({ id: 'exit' })
]);

/**
 * 부동소수점 오차 범위 안에서 두 값이 같은지 확인합니다.
 * @param {number} actual - 실제 값입니다.
 * @param {number} expected - 기대값입니다.
 * @param {string} message - 실패 메시지입니다.
 * @returns {void}
 */
function assertAlmostEqual(actual, expected, message) {
    assert.ok(
        Math.abs(actual - expected) <= 1e-7,
        `${message}: ${actual} !== ${expected}`
    );
}

/**
 * 지정 UI 배율에 비례하는 테스트 카드 rect를 생성합니다.
 * @param {number} uiScale - UI 스케일 배율입니다.
 * @returns {Array<{layoutRect:object}>} 테스트 카드 목록입니다.
 */
function createScaledCards(uiScale) {
    const scaleRect = ({ x, y, w, h }) => ({
        x: x * uiScale,
        y: y * uiScale,
        w: w * uiScale,
        h: h * uiScale
    });
    return [
        { layoutRect: scaleRect({ x: 0, y: 0, w: 300, h: 500 }) },
        { layoutRect: scaleRect({ x: 320, y: 0, w: 300, h: 250 }) },
        { layoutRect: scaleRect({ x: 320, y: 270, w: 300, h: 230 }) },
        { layoutRect: scaleRect({ x: 0, y: 520, w: 300, h: 210 }) },
        { layoutRect: scaleRect({ x: 320, y: 520, w: 300, h: 210 }) }
    ];
}

/**
 * 실제 오른쪽 pane 계산기를 지정 UI 배율로 실행합니다.
 * @param {number} uiScale - UI 스케일 배율입니다.
 * @returns {object} pane 레이아웃입니다.
 */
function buildPaneLayout(uiScale) {
    return buildTitleMenuRightPaneLayout({
        cards: createScaledCards(uiScale),
        secondaryMenuEntries: SECONDARY_MENU_ENTRIES,
        ww: 2560,
        wh: 1440,
        uiww: 2560,
        uiOffsetX: 0,
        uiScale,
        versionBlockHeight: 60 * uiScale,
        referenceVersionBlockHeight: 60,
        titleCardMenu: TITLE_CARD_MENU
    });
}

test('100% 이하 세로 스택은 외곽 기준선을 고정하고 두 내부 여백을 절반씩 분배한다', () => {
    const referenceLayout = buildPaneLayout(1);
    const referenceTop = referenceLayout.versionLabelTop;
    const referenceBottom = referenceLayout.utilityPane.y + referenceLayout.utilityPane.h;

    for (const uiScale of [0.75, 1]) {
        const layout = buildPaneLayout(uiScale);
        const utilityBottom = layout.utilityPane.y + layout.utilityPane.h;
        const measuredGapBeforeCard = layout.cardPane.y
            - (layout.versionLabelTop + (60 * uiScale));
        const measuredGapAfterCard = layout.utilityPane.y
            - (layout.cardPane.y + layout.cardPane.h);

        assertAlmostEqual(layout.versionLabelTop, referenceTop, `${uiScale} 상단 기준선`);
        assertAlmostEqual(utilityBottom, referenceBottom, `${uiScale} 하단 기준선`);
        assertAlmostEqual(measuredGapBeforeCard, measuredGapAfterCard, `${uiScale} 내부 여백`);
        assertAlmostEqual(layout.gapBeforeCard, measuredGapBeforeCard, `${uiScale} 상단 여백 메타데이터`);
        assertAlmostEqual(layout.gapAfterCard, measuredGapAfterCard, `${uiScale} 하단 여백 메타데이터`);
    }
});

test('100% 초과 세로 스택은 기준 내부 여백을 유지하고 외곽 기준선을 대칭으로 붕괴시킨다', () => {
    const referenceLayout = buildPaneLayout(1);
    const referenceGap = referenceLayout.gapBeforeCard;
    const referenceCenter = (
        referenceLayout.versionLabelTop
        + referenceLayout.utilityPane.y
        + referenceLayout.utilityPane.h
    ) * 0.5;

    for (const uiScale of [1.25, 1.5]) {
        const layout = buildPaneLayout(uiScale);
        const stackBottom = layout.utilityPane.y + layout.utilityPane.h;
        const stackCenter = (layout.versionLabelTop + stackBottom) * 0.5;

        assertAlmostEqual(layout.gapBeforeCard, referenceGap, `${uiScale} 상단 내부 여백`);
        assertAlmostEqual(layout.gapAfterCard, referenceGap, `${uiScale} 하단 내부 여백`);
        assertAlmostEqual(stackCenter, referenceCenter, `${uiScale} 기준 중심`);
        assert.ok(layout.versionLabelTop < referenceLayout.versionLabelTop);
        assert.ok(stackBottom > referenceLayout.utilityPane.y + referenceLayout.utilityPane.h);
    }
});

test('세로 스택 순수 계산도 100% 분기 양쪽에서 동일한 경계 계약을 따른다', () => {
    const reference = {
        referenceTop: 50,
        referenceBottom: 950,
        referenceGap: 60
    };
    const reduced = resolveTitleMenuVerticalStackLayout({
        ...reference,
        uiScale: 0.75,
        versionHeight: 45,
        cardPaneHeight: 450,
        utilityPaneHeight: 90
    });
    const enlarged = resolveTitleMenuVerticalStackLayout({
        ...reference,
        uiScale: 1.25,
        versionHeight: 75,
        cardPaneHeight: 750,
        utilityPaneHeight: 150
    });

    assert.equal(reduced.versionTop, reference.referenceTop);
    assert.equal(reduced.gapBeforeCard, reduced.gapAfterCard);
    assert.equal(
        reduced.utilityPaneTop + 90,
        reference.referenceBottom
    );
    assert.equal(enlarged.gapBeforeCard, reference.referenceGap);
    assert.equal(enlarged.gapAfterCard, reference.referenceGap);
    assert.equal(
        (enlarged.versionTop + enlarged.utilityPaneTop + 150) * 0.5,
        (reference.referenceTop + reference.referenceBottom) * 0.5
    );
});
