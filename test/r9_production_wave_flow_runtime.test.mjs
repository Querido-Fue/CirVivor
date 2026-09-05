import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    PRODUCTION_STAGE_ONE_SELECTION_MAP_ID,
    createProductionGameStartOptions
} = await loadGameModule('scene/game/production_game_start_route.js');
const { GameSystem } = await loadGameModule('ingame/game_system.js');

function createDependencies() {
    return {
        inputActionSource: {
            isPressed() { return false; },
            getPointerPosition(out) { return out; },
            isPrimaryPointerPressed() { return false; },
            getWheelTotals(out) { return out; }
        },
        animationPort: {
            animate() {
                return {
                    promise: Promise.resolve(),
                    retarget() { return true; },
                    remove() {},
                    isActive() { return true; }
                };
            }
        },
        timePort: {
            getFixedDelta() { return 1 / 60; },
            getFixedInterpolationAlpha() { return 0; }
        },
        viewportPort: {
            getSnapshot(out) {
                Object.assign(out, {
                    ww: 1280,
                    wh: 720,
                    uiww: 1280,
                    uiOffsetX: 0,
                    uiScale: 1
                });
                return out;
            }
        },
        worldRenderPort: {
            drawCircle() {},
            drawSquareInstances() {}
        }
    };
}

test('ordinary production options는 constructor까지 identity/plan/profile/Shop authority를 보존한다', () => {
    const options = createProductionGameStartOptions(
        PRODUCTION_STAGE_ONE_SELECTION_MAP_ID
    );
    const gameSystem = new GameSystem(createDependencies(), options);
    assert.strictEqual(
        gameSystem.getProductionRunIdentity(),
        options.productionRunIdentity
    );
    assert.strictEqual(
        gameSystem.getR9WaveResolutionProfile(),
        options.r9WaveResolutionProfile
    );
    assert.equal(gameSystem.getShopRuntimeConfiguration().mode, 'PRODUCTION');
    assert.equal(gameSystem.getShopRuntimeConfiguration().autoOpen, false);

    const flow = gameSystem.getWaveFlowStatus();
    assert.equal(flow.configured, true);
    assert.equal(flow.totalWaveCount, 1);
    assert.equal(flow.waveState, 'INACTIVE');
    assert.equal(flow.perEnemyUiObjectCount, 0);
    assert.equal(flow.pausePolicy.pauseAdvanceTicks, 0);
    assert.equal(flow.pausePolicy.resumeCatchUpTicks, 0);
    assert.equal(Object.isFrozen(flow), true);
    assert.equal(Object.isFrozen(flow.shopPreview), true);
    assert.equal(Object.isFrozen(flow.recovery), true);
    assert.deepEqual(Object.keys(flow).filter(
        (key) => /enemy|actor/i.test(key)
    ), ['hostileActorCount', 'perEnemyUiObjectCount']);
    gameSystem.destroy();
});

test('ProductionRunIdentity와 Shop config drift는 runtime owner 생성 전에 거절된다', () => {
    const options = createProductionGameStartOptions(
        PRODUCTION_STAGE_ONE_SELECTION_MAP_ID
    );
    assert.throws(() => new GameSystem(createDependencies(), {
        ...options,
        productionRunIdentity: Object.freeze({
            ...options.productionRunIdentity,
            runSeed: options.productionRunIdentity.runSeed + 1
        })
    }), /ProductionRunIdentity/u);
});
