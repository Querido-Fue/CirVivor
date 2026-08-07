import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const { InputActionMapper } = await loadGameModule(
    'ingame/input/input_action_mapper.js'
);
const { PLAYER_ACTION_TYPES } = await loadGameModule(
    'ingame/contract/player_controllable_contract.js'
);

test('primary pointer action은 payload를 재사용하고 비정상 좌표에서도 마지막 유한 좌표와 release를 전달한다', () => {
    const mapper = new InputActionMapper();
    let primaryPressed = true;
    let pointerX = 320;
    let pointerY = 180;
    const inputSource = {
        getPointerPosition(out) {
            out.x = pointerX;
            out.y = pointerY;
            return out;
        },
        isPrimaryPointerPressed() {
            return primaryPressed;
        }
    };

    const first = mapper.mapPrimaryPointerFireAction(inputSource);
    const firstPayload = first.payload;
    assert.equal(first.type, PLAYER_ACTION_TYPES.PRIMARY_POINTER_FIRE);
    assert.equal(firstPayload.pressed, true);
    assert.equal(firstPayload.viewportX, 320);
    assert.equal(firstPayload.viewportY, 180);

    pointerX = Number.NaN;
    pointerY = Number.POSITIVE_INFINITY;
    primaryPressed = false;
    const released = mapper.mapPrimaryPointerFireAction(inputSource);

    assert.strictEqual(released, first);
    assert.strictEqual(released.payload, firstPayload);
    assert.equal(released.payload.pressed, false);
    assert.equal(released.payload.viewportX, 320);
    assert.equal(released.payload.viewportY, 180);
});

test('primary pointer의 첫 비유한 좌표는 0으로 안정화하고 wheel X fallback은 초기화된다', () => {
    const mapper = new InputActionMapper();
    const action = mapper.mapPrimaryPointerFireAction({
        getPointerPosition(out) {
            out.x = Number.NaN;
            out.y = Number.NEGATIVE_INFINITY;
            return out;
        },
        isPrimaryPointerPressed() {
            return false;
        }
    });
    assert.equal(action.payload.pressed, false);
    assert.equal(action.payload.viewportX, 0);
    assert.equal(action.payload.viewportY, 0);

    const invalidWheelSource = {
        getWheelTotals(out) {
            out.x = Number.NaN;
            out.y = 0;
            return out;
        }
    };
    mapper.primeWheelBaseline(invalidWheelSource);
    assert.equal(mapper.mapCameraZoomAction(invalidWheelSource), null);
});
