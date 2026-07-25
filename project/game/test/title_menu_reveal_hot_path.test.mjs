import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadGameModule } from './support/source_module_loader.mjs';

const TITLE_MENU_SOURCE_PATH = fileURLToPath(new URL(
    '../script/module/scene/title/_title_menu.js',
    import.meta.url
));
const titleMenuSource = await readFile(TITLE_MENU_SOURCE_PATH, 'utf8');
const { TITLE_CARD_MENU_CONSTANTS: TITLE_CARD_MENU } = await loadGameModule(
    'scene/title/_title_runtime_constants.js'
);
const renderState = await loadGameModule('scene/title/menu/_title_menu_render_state.js');

const {
    advanceTitleMenuCardRevealClockWithTotalDuration,
    buildTitleMenuCardRenderState,
    buildTitleMenuPaneRenderState,
    buildTitleMenuUtilityTileRenderState,
    getTitleMenuCardRevealConfig,
    getTitleMenuCardRevealCoreDuration,
    getTitleMenuCardRevealTotalDuration,
    getTitleMenuRevealProgress
} = renderState;

/**
 * reveal clock 반환 객체를 `Object.is` 기준으로 비교합니다.
 * @param {object} actual - 실제 반환값입니다.
 * @param {object} expected - 기대 반환값입니다.
 * @returns {void}
 */
function assertClockStateExact(actual, expected) {
    assert.deepEqual(Object.keys(actual), Object.keys(expected));
    for (const key of Object.keys(expected)) {
        assert.ok(
            Object.is(actual[key], expected[key]),
            `${key}: ${String(actual[key])} !== ${String(expected[key])}`
        );
    }
}

/**
 * 최적화 전 reveal clock 수식을 독립적으로 재현합니다.
 * @param {object} options - reveal clock 입력값입니다.
 * @returns {{cardRevealStarted:boolean, cardRevealElapsed:number, revealFinished:boolean}} 계산 결과입니다.
 */
function advanceLegacyRevealClock({
    cardRevealStarted,
    cardRevealElapsed,
    transitionProgress,
    delta,
    titleCardMenu
}) {
    const nextStarted = cardRevealStarted || transitionProgress > 0;
    if (!nextStarted) {
        return {
            cardRevealStarted: false,
            cardRevealElapsed,
            revealFinished: false
        };
    }

    const revealConfigs = Object.values(titleCardMenu.REVEAL_CONFIGS || {});
    const revealMaxDuration = revealConfigs.reduce((maxDuration, revealConfig) => {
        const delaySeconds = Number.isFinite(revealConfig?.delaySeconds) ? revealConfig.delaySeconds : 0;
        const durationSeconds = Number.isFinite(revealConfig?.durationSeconds) ? revealConfig.durationSeconds : 0;
        return Math.max(maxDuration, delaySeconds + durationSeconds);
    }, 0);
    const totalDuration = Math.max(
        titleCardMenu.APPEAR_DURATION_SECONDS,
        titleCardMenu.APPEAR_START_DELAY_SECONDS + revealMaxDuration
    );
    const elapsedDelta = Math.max(0, Math.min(Infinity, delta));
    const nextElapsed = Math.max(
        -Infinity,
        Math.min(totalDuration, cardRevealElapsed + elapsedDelta)
    );
    return {
        cardRevealStarted: true,
        cardRevealElapsed: nextElapsed,
        revealFinished: nextElapsed >= totalDuration - 0.0001
    };
}

/**
 * 호출 시점 receiver의 elapsed를 읽는 reveal resolver를 생성합니다.
 * @param {{cardRevealElapsed:number}} receiver - 현재 reveal 상태입니다.
 * @param {Array<Array<number>>} trace - 호출 인수 기록 배열입니다.
 * @returns {(delaySeconds:number, durationSeconds:number) => number} reveal resolver입니다.
 */
function createRevealResolver(receiver, trace) {
    return (delaySeconds, durationSeconds) => {
        trace.push([delaySeconds, durationSeconds]);
        return getTitleMenuRevealProgress({
            cardRevealElapsed: receiver.cardRevealElapsed,
            titleCardMenu: TITLE_CARD_MENU,
            delaySeconds,
            durationSeconds
        });
    };
}

test('TitleMenu은 고정 reveal timing과 instance당 resolver를 프레임 경로에서 재사용한다', () => {
    assert.ok(Object.isFrozen(TITLE_CARD_MENU));
    assert.ok(Object.isFrozen(TITLE_CARD_MENU.REVEAL_CONFIGS));
    for (const revealConfig of Object.values(TITLE_CARD_MENU.REVEAL_CONFIGS)) {
        assert.ok(Object.isFrozen(revealConfig));
    }
    assert.equal(
        (titleMenuSource.match(/#getRevealProgress\.bind\(this\)/gu) ?? []).length,
        1
    );
    assert.match(titleMenuSource, /#revealProgressResolver/u);
    assert.doesNotMatch(titleMenuSource, /getRevealConfig:\s*\(cardId\)\s*=>/u);
    assert.equal(
        (titleMenuSource.match(/getTitleMenuCardRevealCoreDuration\(TITLE_CARD_MENU\)/gu) ?? []).length,
        1
    );
    assert.equal(
        (titleMenuSource.match(/getTitleMenuCardRevealTotalDuration\(TITLE_CARD_MENU\)/gu) ?? []).length,
        1
    );
    assert.match(titleMenuSource, /advanceTitleMenuCardRevealClockWithTotalDuration/u);
});

test('사전 계산 total duration 경로는 기존 reveal clock과 숫자 edge에서 exact 일치한다', () => {
    assert.equal(typeof advanceTitleMenuCardRevealClockWithTotalDuration, 'function');
    const totalDuration = getTitleMenuCardRevealTotalDuration(TITLE_CARD_MENU);
    const values = [
        -Infinity,
        -1,
        -Number.MIN_VALUE,
        -0,
        0,
        Number.MIN_VALUE,
        0.1,
        0.3,
        totalDuration - 0.0001,
        totalDuration,
        totalDuration + 0.5,
        Infinity,
        NaN
    ];

    for (const cardRevealStarted of [false, true]) {
        for (const cardRevealElapsed of values) {
            for (const transitionProgress of values) {
                for (const delta of values) {
                    const legacy = advanceLegacyRevealClock({
                        cardRevealStarted,
                        cardRevealElapsed,
                        transitionProgress,
                        delta,
                        titleCardMenu: TITLE_CARD_MENU
                    });
                    const optimized = advanceTitleMenuCardRevealClockWithTotalDuration(
                        cardRevealStarted,
                        cardRevealElapsed,
                        transitionProgress,
                        delta,
                        totalDuration
                    );
                    assertClockStateExact(optimized, legacy);
                }
            }
        }
    }
});

test('재사용 resolver는 카드·타일·pane 렌더 상태와 호출 순서를 그대로 보존한다', () => {
    const coreDuration = getTitleMenuCardRevealCoreDuration(TITLE_CARD_MENU);
    const paneLayout = {
        cardPane: { x: 1700, y: 390, w: 760, h: 650, radius: 42 },
        utilityPane: { x: 2020, y: 1100, w: 480, h: 160, radius: 36 }
    };
    const menuItem = { id: 'setting', x: 2040, y: 1120, w: 92, h: 92, radius: 16 };

    const stableReceiver = { cardRevealElapsed: 0 };
    const stableTrace = [];
    const stableResolver = createRevealResolver(stableReceiver, stableTrace);

    for (const elapsed of [-0, 0.3, 0.67, 1.29, Infinity, NaN]) {
        stableReceiver.cardRevealElapsed = elapsed;
        stableTrace.length = 0;
        const legacyTrace = [];
        const freshResolver = createRevealResolver({ cardRevealElapsed: elapsed }, legacyTrace);

        for (const cardId of Object.keys(TITLE_CARD_MENU.REVEAL_CONFIGS)) {
            const card = {
                cardDefinition: { id: cardId },
                layoutRect: { x: 1800, y: 430, w: 280, h: 220 },
                animator: {
                    getState() {
                        return { hoverProgress: 0.37 };
                    }
                }
            };
            const commonOptions = {
                card,
                transitionProgress: 0.83,
                groupOffsetX: 11,
                groupOffsetY: -7,
                ww: 2560,
                wh: 1440,
                uiww: 2560,
                uiScale: 1,
                titleCardMenu: TITLE_CARD_MENU,
                getRevealConfig: (id) => getTitleMenuCardRevealConfig(TITLE_CARD_MENU, id)
            };
            assert.deepEqual(
                buildTitleMenuCardRenderState({
                    ...commonOptions,
                    getRevealProgress: stableResolver
                }),
                buildTitleMenuCardRenderState({
                    ...commonOptions,
                    getRevealProgress: freshResolver
                })
            );
        }

        assert.deepEqual(
            buildTitleMenuUtilityTileRenderState({
                menuItem,
                index: 2,
                uiww: 2560,
                uiScale: 1,
                revealCoreDuration: coreDuration,
                getRevealProgress: stableResolver
            }),
            buildTitleMenuUtilityTileRenderState({
                menuItem,
                index: 2,
                uiww: 2560,
                uiScale: 1,
                revealCoreDuration: coreDuration,
                getRevealProgress: freshResolver
            })
        );
        assert.deepEqual(
            buildTitleMenuPaneRenderState({
                paneLayout,
                uiww: 2560,
                uiScale: 1,
                revealCoreDuration: coreDuration,
                getRevealProgress: stableResolver
            }),
            buildTitleMenuPaneRenderState({
                paneLayout,
                uiww: 2560,
                uiScale: 1,
                revealCoreDuration: coreDuration,
                getRevealProgress: freshResolver
            })
        );
        assert.deepEqual(stableTrace, legacyTrace);
    }
});
