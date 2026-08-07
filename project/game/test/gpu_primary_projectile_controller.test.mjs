import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    INPUT_DISPOSITIONS,
    PLAYER_ACTION_TYPES
} = await loadGameModule('ingame/contract/player_controllable_contract.js');
const {
    BASIC_BULLET_COLOR_RGBA,
    BASIC_BULLET_PRODUCER_ID,
    BASIC_BULLET_PROJECTILE_DATA,
    BASIC_BULLET_WEAPON_DATA
} = await loadGameModule('data/object/projectile/basic_bullet_data.js');
const {
    GPU_PROJECTILE_SPAWN_MODE
} = await loadGameModule('ingame/gpu_simulation_endpoint.js');
const {
    GpuPrimaryProjectileController
} = await loadGameModule('ingame/object/projectile/gpu_primary_projectile_controller.js');

function createEndpoint() {
    const sourceRelativeCalls = [];
    return {
        sourceRelativeCalls,
        requestSpawn() {
            throw new Error('primary aim controller는 absolute spawn을 요청하면 안 됩니다.');
        },
        requestSourceRelativeSpawn(intent, targetFixedTick, commandId) {
            sourceRelativeCalls.push({ intent, targetFixedTick, commandId });
            return Object.freeze({
                accepted: true,
                targetFixedTick,
                commandId
            });
        }
    };
}

function createTower({
    entityId = 7,
    incarnation = 2,
    sessionGeneration = 11
} = {}) {
    let handle = { entityId, incarnation };
    let generation = sessionGeneration;
    return {
        getGpuBodyHandle() {
            return handle;
        },
        getStatus() {
            return { sessionGeneration: generation };
        },
        getTrackedPose() {
            throw new Error('primary aim controller는 tracked pose를 읽으면 안 됩니다.');
        },
        setHandle(nextHandle) {
            handle = nextHandle;
        },
        setSessionGeneration(nextGeneration) {
            generation = nextGeneration;
        }
    };
}

function createCamera() {
    const calls = [];
    return {
        calls,
        viewportToWorld(viewportX, viewportY, out) {
            calls.push({ viewportX, viewportY, out });
            out.x = viewportX + 100;
            out.y = viewportY - 50;
            return out;
        }
    };
}

function primaryAction(pressed, viewportX, viewportY) {
    return {
        type: PLAYER_ACTION_TYPES.PRIMARY_POINTER_FIRE,
        payload: { pressed, viewportX, viewportY }
    };
}

test('Basic Bullet technical baseline은 named immutable data로만 controller에 전달된다', () => {
    assert.equal(
        GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_AIM_POINT,
        'source-relative-aim-point'
    );
    assert.equal(BASIC_BULLET_PROJECTILE_DATA.id, 'basic_bullet_01');
    assert.equal(BASIC_BULLET_PROJECTILE_DATA.collisionRadius, 0.18);
    assert.equal(BASIC_BULLET_WEAPON_DATA.projectileSpeedTilesPerSecond, 18);
    assert.equal(BASIC_BULLET_WEAPON_DATA.fireIntervalTicks, 27);
    assert.equal(BASIC_BULLET_WEAPON_DATA.positionOffsetTiles, 0);
    assert.equal(BASIC_BULLET_WEAPON_DATA.producerId, BASIC_BULLET_PRODUCER_ID);
    assert.equal(Object.isFrozen(BASIC_BULLET_PROJECTILE_DATA), true);
    assert.equal(Object.isFrozen(BASIC_BULLET_WEAPON_DATA), true);
    assert.equal(Object.isFrozen(BASIC_BULLET_COLOR_RGBA), true);
});

test('unbound Tower에서는 held LMB라도 source-relative request가 없다', () => {
    const endpoint = createEndpoint();
    const tower = createTower();
    tower.setHandle(null);
    const controller = new GpuPrimaryProjectileController({
        tower,
        camera: createCamera(),
        endpoint
    });
    controller.handlePlayerAction(primaryAction(true, 12, 34));

    assert.equal(controller.stageShotForFixedTick(1), null);
    assert.equal(endpoint.sourceRelativeCalls.length, 0);
});

test('primary controller는 copied semantic pointer와 exact GPU handle로 aim-point request를 만들고 commit에서만 cooldown을 확정한다', () => {
    const endpoint = createEndpoint();
    const tower = createTower();
    const camera = createCamera();
    const controller = new GpuPrimaryProjectileController({ tower, camera, endpoint });
    const action = primaryAction(true, 12, 34);
    assert.equal(controller.handlePlayerAction(action), INPUT_DISPOSITIONS.CONSUMED);
    action.payload.pressed = false;
    action.payload.viewportX = 999;
    action.payload.viewportY = 999;

    const receipt = controller.stageShotForFixedTick(7);
    assert.equal(receipt.accepted, true);
    assert.equal(endpoint.sourceRelativeCalls.length, 1);
    assert.equal(camera.calls.length, 1);
    assert.equal(camera.calls[0].viewportX, 12);
    assert.equal(camera.calls[0].viewportY, 34);

    const request = endpoint.sourceRelativeCalls[0];
    assert.equal(request.targetFixedTick, 7);
    assert.equal(
        request.commandId,
        'gpu-primary-bullet:11:7:2:7:0'
    );
    assert.equal(request.intent.modeFlags > 0, true);
    assert.equal(request.intent.sourceHandle.entityId, 7);
    assert.equal(request.intent.sourceHandle.incarnation, 2);
    assert.equal(request.intent.positionOffset.x, BASIC_BULLET_WEAPON_DATA.positionOffsetTiles);
    assert.equal(request.intent.positionOffset.y, 0);
    assert.equal(request.intent.aimWorldPoint.x, 112);
    assert.equal(request.intent.aimWorldPoint.y, -16);
    assert.equal(request.intent.launchSpeed, BASIC_BULLET_WEAPON_DATA.projectileSpeedTilesPerSecond);
    assert.equal(request.intent.destinationSpawn.definitionId, BASIC_BULLET_PROJECTILE_DATA.id);
    assert.equal(request.intent.destinationSpawn.producerId, BASIC_BULLET_PRODUCER_ID);

    const beforeCommit = controller.getStatus();
    assert.equal(beforeCommit.shotSequence, 0);
    assert.equal(beforeCommit.nextEligibleFixedTick, 0);
    assert.equal(controller.finalizeFixedCommit({
        sourceRelativeSpawns: [{ commandId: receipt.commandId }],
        rejected: []
    }, 7), true);
    const committed = controller.getStatus();
    assert.equal(committed.shotSequence, 1);
    assert.equal(
        committed.nextEligibleFixedTick,
        7 + BASIC_BULLET_WEAPON_DATA.fireIntervalTicks
    );
    assert.equal(controller.stageShotForFixedTick(8), null);

    assert.equal(
        controller.handlePlayerAction(primaryAction(false, 12, 34)),
        INPUT_DISPOSITIONS.CONSUMED
    );
    assert.equal(controller.stageShotForFixedTick(34), null);
});

test('normal spawn rejection은 sequence/cooldown을 소비하지 않고 다음 tick에 같은 sequence로 재시도한다', () => {
    const endpoint = createEndpoint();
    const controller = new GpuPrimaryProjectileController({
        tower: createTower(),
        camera: createCamera(),
        endpoint
    });
    controller.handlePlayerAction(primaryAction(true, 4, 5));
    const firstReceipt = controller.stageShotForFixedTick(3);
    assert.equal(controller.finalizeFixedCommit({
        sourceRelativeSpawns: [],
        rejected: [{ commandId: firstReceipt.commandId, domain: 'spawn' }]
    }, 3), false);
    assert.equal(controller.getStatus().shotSequence, 0);
    assert.equal(controller.getStatus().nextEligibleFixedTick, 0);

    const secondReceipt = controller.stageShotForFixedTick(4);
    assert.equal(secondReceipt.accepted, true);
    assert.equal(secondReceipt.commandId, 'gpu-primary-bullet:11:7:2:4:0');
    assert.equal(endpoint.sourceRelativeCalls.length, 2);
});

test('recovery reset은 held LMB를 보존하되 old pending/source를 버리고 new handle/generation으로 발사한다', () => {
    const firstEndpoint = createEndpoint();
    const tower = createTower();
    const controller = new GpuPrimaryProjectileController({
        tower,
        camera: createCamera(),
        endpoint: firstEndpoint
    });
    controller.handlePlayerAction(primaryAction(true, 2, 3));
    const oldReceipt = controller.stageShotForFixedTick(5);
    assert.equal(oldReceipt.accepted, true);

    controller.resetGpuBinding();
    tower.setHandle({ entityId: 9, incarnation: 4 });
    tower.setSessionGeneration(12);
    const secondEndpoint = createEndpoint();
    assert.equal(controller.bindGpuEndpoint(secondEndpoint), true);
    const newReceipt = controller.stageShotForFixedTick(6);

    assert.equal(newReceipt.accepted, true);
    assert.equal(newReceipt.commandId, 'gpu-primary-bullet:12:9:4:6:0');
    assert.equal(firstEndpoint.sourceRelativeCalls.length, 1);
    assert.equal(secondEndpoint.sourceRelativeCalls.length, 1);
    assert.equal(controller.getStatus().shotSequence, 0);
});

test('controller는 primary semantic action만 소비한다', () => {
    const controller = new GpuPrimaryProjectileController({
        tower: createTower(),
        camera: createCamera(),
        endpoint: createEndpoint()
    });
    assert.equal(controller.handlePlayerAction({
        type: 'moveVector',
        payload: { x: 1, y: 0 }
    }), INPUT_DISPOSITIONS.PASS);
});
