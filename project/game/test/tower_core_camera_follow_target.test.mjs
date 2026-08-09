import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    isCameraFollowTarget2D
} = await loadGameModule('ingame/contract/camera_control_contract.js');
const {
    TowerCoreCameraFollowTarget
} = await loadGameModule('ingame/object/tower_core_camera_follow_target.js');

function createFixture() {
    const state = {
        towerAlive: true,
        towerFollowEnabled: true,
        towerCopyCount: 0
    };
    const delegatedResult = { source: 'tower' };
    const tower = {
        cameraFollowTargetId: 'tower',
        isCameraFollowEnabled() {
            return state.towerFollowEnabled;
        },
        copyCameraFollowPositionInto(out = {}) {
            state.towerCopyCount++;
            out.x = 45;
            out.y = 15;
            return delegatedResult;
        }
    };
    const core = {
        active: true,
        position: Object.freeze({ x: 51, y: 27 })
    };
    const towerCombatRoster = {
        isPrimaryTowerAlive() {
            return state.towerAlive;
        }
    };
    const target = new TowerCoreCameraFollowTarget({
        tower,
        core,
        towerCombatRoster
    });
    return { state, delegatedResult, tower, core, towerCombatRoster, target };
}

test('alive Tower 상태에서는 follow enabled와 position 복사를 exact delegation한다', () => {
    const { state, delegatedResult, target } = createFixture();
    assert.equal(isCameraFollowTarget2D(target), true);
    assert.equal(target.cameraFollowTargetId, 'tower-core-camera-follow');
    assert.equal(target.isCameraFollowEnabled(), true);
    const out = {};
    assert.strictEqual(target.copyCameraFollowPositionInto(out), delegatedResult);
    assert.deepEqual(out, { x: 45, y: 15 });
    assert.equal(state.towerCopyCount, 1);
});

test('alive Tower의 temporary invalid pose는 Core fallback으로 숨기지 않는다', () => {
    const { state, delegatedResult, target } = createFixture();
    state.towerFollowEnabled = false;
    assert.equal(target.isCameraFollowEnabled(), false);
    assert.strictEqual(target.copyCameraFollowPositionInto({}), delegatedResult);
    assert.equal(state.towerCopyCount, 1);
});

test('terminal Tower death 뒤에는 stable target identity로 CPU Core 위치를 제공한다', () => {
    const { state, target } = createFixture();
    state.towerAlive = false;
    state.towerFollowEnabled = false;
    assert.equal(target.isCameraFollowEnabled(), true);
    const out = {};
    assert.strictEqual(target.copyCameraFollowPositionInto(out), out);
    assert.deepEqual(out, { x: 51, y: 27 });
    assert.equal(state.towerCopyCount, 0);

    target.destroy();
    target.destroy();
    assert.equal(target.isCameraFollowEnabled(), false);
});
