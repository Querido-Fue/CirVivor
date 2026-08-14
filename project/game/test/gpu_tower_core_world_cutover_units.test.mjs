import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    GAME_WORLD_SESSION_MODE,
    assertGameWorldSessionMode,
    resolveGameWorldSessionPolicy,
    selectGameWorldSessionMode
} = await loadGameModule('ingame/game_world_session_mode.js');
const {
    GPU_TOWER_DEFINITION_ID,
    GPU_TOWER_WORLD_KIND_ID,
    createGpuTowerSpawnIntent
} = await loadGameModule(
    'ingame/object/tower/gpu_tower_spawn_adapter.js'
);
const {
    THE_TOWER_COMBAT_DATA,
    THE_TOWER_DATA
} = await loadGameModule('data/object/tower/the_tower_data.js');
const {
    GPU_CORE_PROXY_DEFINITION_ID,
    GPU_CORE_PROXY_WORLD_KIND_ID,
    createGpuCoreProxySpawnIntent
} = await loadGameModule(
    'ingame/object/core/gpu_core_proxy_spawn_adapter.js'
);
const {
    GPU_TOWER_TRACKED_POSE_MAX_AGE_TICKS,
    GpuTowerActorFacade
} = await loadGameModule(
    'ingame/object/tower/gpu_tower_actor_facade.js'
);
const {
    CorePresentationFacade
} = await loadGameModule(
    'ingame/object/core/core_presentation_facade.js'
);
const {
    createGpuEnemySpawnIntent
} = await loadGameModule(
    'ingame/object/enemy/gpu_enemy_spawn_adapter.js'
);
const {
    createGpuProjectileSpawnIntent
} = await loadGameModule(
    'ingame/object/projectile/gpu_projectile_spawn_adapter.js'
);
const {
    PROJECTILE_TARGET_POLICY_ID
} = await loadGameModule(
    'ingame/contract/projectile_target_policy_contract.js'
);
const {
    GPU_CIRCLE_BODY_COLLISION_LAYER,
    GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG,
    GPU_CIRCLE_BODY_LIFETIME,
    GPU_CIRCLE_BODY_RENDER_SHAPE
} = await loadGameModule(
    'ingame/physics/gpu/gpu_circle_body_abi.js'
);
const {
    INPUT_DISPOSITIONS,
    isPlayerControllable,
    PLAYER_ACTION_TYPES
} = await loadGameModule(
    'ingame/contract/player_controllable_contract.js'
);
const {
    isCameraFollowTarget2D
} = await loadGameModule('ingame/contract/camera_control_contract.js');
const {
    isPhysicsBody2D,
    isPhysicsBodyOwner
} = await loadGameModule('ingame/contract/physics_body_contract.js');
const {
    isCollidable2D
} = await loadGameModule('ingame/contract/collidable_contract.js');
const {
    CoreIntegrity
} = await loadGameModule('ingame/state/core_integrity.js');
const {
    GAMEPLAY_ALLEGIANCE_POLICY,
    GAMEPLAY_DAMAGE_POLICY_ID,
    GAMEPLAY_DAMAGE_RESOLUTION_POLICY_ID,
    GAMEPLAY_TEAM_ID
} = await loadGameModule('ingame/contract/gameplay_team_contract.js');

const CORE_PROXY_ADAPTER_SOURCE = await readFile(
    new URL(
        '../script/module/ingame/object/core/gpu_core_proxy_spawn_adapter.js',
        import.meta.url
    ),
    'utf8'
);

function createEnemyIntent() {
    return createGpuEnemySpawnIntent({
        definition: {
            id: 'phase4-enemy',
            collisionWeight: 1,
            moveSpeedTilesPerSecond: 2,
            collisionRadiusTiles: 0.4,
            maxHealth: 3,
            colorRgba: [1, 0, 0, 1]
        },
        route: {
            gateId: 'north-gate',
            pathId: 'north-core-path',
            waypoints: [
                { x: 1, y: 2 },
                { x: 1, y: 3 }
            ]
        },
        spawnSequence: 0
    });
}

function createControlEndpoint() {
    const calls = [];
    return {
        calls,
        requestBodyControl(command, targetFixedTick, commandId) {
            const receipt = Object.freeze({
                accepted: true,
                commandId,
                targetFixedTick
            });
            calls.push({
                command: {
                    handle: command.handle,
                    moveIntentX: command.moveIntentX,
                    moveIntentY: command.moveIntentY
                },
                targetFixedTick,
                commandId,
                receipt
            });
            return receipt;
        }
    };
}

function createPose(overrides = {}) {
    return {
        valid: true,
        entityId: 41,
        incarnation: 3,
        sessionGeneration: 7,
        deviceGeneration: 9,
        authoritativeEpoch: 11,
        sourceTick: 10,
        observedThroughTick: 10,
        position: { x: 10, y: 20 },
        previousPosition: { x: 9, y: 19 },
        velocity: { x: 4, y: -2 },
        ...overrides
    };
}

function createPoseFrame(overrides = {}) {
    return {
        sessionGeneration: 7,
        deviceGeneration: 9,
        authoritativeEpoch: 11,
        currentFixedTick: 10,
        fixedAlpha: 0.25,
        fixedDelta: 0.1,
        ...overrides
    };
}

function assertNearlyEqual(actual, expected, epsilon = 1e-12) {
    assert.ok(
        Math.abs(actual - expected) <= epsilon,
        `actual=${actual}, expected=${expected}`
    );
}

function isReciprocalInteractionPairEnabled(left, right) {
    return (left.interactionMask & right.interactionLayer) !== 0
        && (right.interactionMask & left.interactionLayer) !== 0;
}

function createProjectileIntent(teamId, targetPolicyId) {
    return createGpuProjectileSpawnIntent({
        definition: {
            id: `tower-policy-projectile-${teamId}-${targetPolicyId}`,
            collisionRadius: 0.2,
            inverseMass: 1,
            penetration: 1,
            damage: 1,
            damageSelf: 1,
            lifetimeSeconds: 2,
            killOnTerrain: true
        },
        position: { x: 27, y: 15 },
        velocity: { x: 0, y: 0 },
        teamId,
        allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.EXPLICIT_OVERRIDE,
        targetPolicyId
    });
}

test('enter 시점 platform snapshot이 immutable GPU/fallback mode와 wave policy를 고정한다', () => {
    assert.equal(Object.isFrozen(GAME_WORLD_SESSION_MODE), true);
    assert.equal(GAME_WORLD_SESSION_MODE.GPU_WORLD, 'gpu-world');
    assert.equal(
        GAME_WORLD_SESSION_MODE.CPU_NO_WAVE_FALLBACK,
        'cpu-no-wave-fallback'
    );
    assert.equal(selectGameWorldSessionMode({
        getState: () => ({ ready: true })
    }), GAME_WORLD_SESSION_MODE.GPU_WORLD);
    assert.equal(selectGameWorldSessionMode({
        getState: () => ({ ready: false })
    }), GAME_WORLD_SESSION_MODE.CPU_NO_WAVE_FALLBACK);
    assert.equal(
        selectGameWorldSessionMode(null),
        GAME_WORLD_SESSION_MODE.CPU_NO_WAVE_FALLBACK
    );

    const gpuDefault = resolveGameWorldSessionPolicy(
        GAME_WORLD_SESSION_MODE.GPU_WORLD
    );
    assert.equal(Object.isFrozen(gpuDefault), true);
    assert.equal(gpuDefault.gpuWorld, true);
    assert.equal(gpuDefault.gameplayWorldActorsEnabled, true);
    assert.equal(gpuDefault.enemyWaveEnabled, true);

    const gpuDisabled = resolveGameWorldSessionPolicy(
        GAME_WORLD_SESSION_MODE.GPU_WORLD,
        { gameplayWorldActorsEnabled: false, enemyWaveEnabled: false }
    );
    assert.equal(gpuDisabled.gameplayWorldActorsEnabled, false);
    assert.equal(gpuDisabled.enemyWaveEnabled, false);

    const fallback = resolveGameWorldSessionPolicy(
        GAME_WORLD_SESSION_MODE.CPU_NO_WAVE_FALLBACK,
        { gameplayWorldActorsEnabled: true, enemyWaveEnabled: true }
    );
    assert.equal(fallback.gpuWorld, false);
    assert.equal(fallback.gameplayWorldActorsEnabled, false);
    assert.equal(fallback.enemyWaveEnabled, false);
    assert.equal(
        assertGameWorldSessionMode(GAME_WORLD_SESSION_MODE.GPU_WORLD),
        GAME_WORLD_SESSION_MODE.GPU_WORLD
    );
    assert.throws(() => assertGameWorldSessionMode('gpu-if-available'), /mode/);
});

test('Tower intent는 HP 30과 별도 player-damageable interaction capability를 사용한다', () => {
    const authoredPosition = { x: 27, y: 15 };
    const tower = createGpuTowerSpawnIntent({ position: authoredPosition });
    const enemy = createEnemyIntent();
    const core = createGpuCoreProxySpawnIntent({ position: { x: 27, y: 22 } });
    const basicBullet = createProjectileIntent(
        GAMEPLAY_TEAM_ID.PLAYER,
        PROJECTILE_TARGET_POLICY_ID.ENEMY_AND_TERRAIN
    );
    const hostileTowerProjectile = createProjectileIntent(
        GAMEPLAY_TEAM_ID.HOSTILE,
        PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN
    );

    assert.equal(Object.isFrozen(THE_TOWER_COMBAT_DATA), true);
    assert.equal(THE_TOWER_COMBAT_DATA.MAX_HEALTH, 30);
    assert.equal(THE_TOWER_COMBAT_DATA.BASE_POWER, 10);
    assert.equal(THE_TOWER_COMBAT_DATA.MAXIMUM_DAMAGE_WINDOW_DURATION_FIXED_TICKS, 60);
    assert.equal(THE_TOWER_DATA.WEIGHT, 10);
    assert.equal('MASS' in THE_TOWER_DATA, false);
    assert.equal(tower.kindId, GPU_TOWER_WORLD_KIND_ID);
    assert.equal(tower.kindId, 'tower');
    assert.equal(tower.definitionId, GPU_TOWER_DEFINITION_ID);
    assert.equal(tower.definitionId, 'the-tower');
    assert.equal(tower.teamId, GAMEPLAY_TEAM_ID.PLAYER);
    assert.equal(
        tower.damagePolicyId,
        GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX
    );
    assert.equal(
        tower.damageResolutionPolicyId,
        GAMEPLAY_DAMAGE_RESOLUTION_POLICY_ID.MAXIMUM_DAMAGE_WINDOW
    );
    assert.equal(tower.maximumDamageWindowDurationTicks, 60);
    assert.equal(
        tower.allegiancePolicy,
        GAMEPLAY_ALLEGIANCE_POLICY.FIXED_PLAYER
    );
    assert.equal(enemy.teamId, GAMEPLAY_TEAM_ID.HOSTILE);
    assert.equal(
        enemy.allegiancePolicy,
        GAMEPLAY_ALLEGIANCE_POLICY.FIXED_HOSTILE
    );
    assert.deepEqual({ ...tower.position }, authoredPosition);
    assert.notStrictEqual(tower.position, authoredPosition);
    assert.deepEqual({ ...tower.velocity }, { x: 0, y: 0 });
    assert.equal(tower.inverseMass, 0.1);
    assert.equal(
        tower.bodyLayer,
        GPU_CIRCLE_BODY_COLLISION_LAYER.KINEMATIC_OBSTACLE
    );
    assert.equal(
        tower.collisionMask,
        GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY
            | GPU_CIRCLE_BODY_COLLISION_LAYER.TERRAIN
            | GPU_CIRCLE_BODY_COLLISION_LAYER.ROUTE_BLOCKER
    );
    assert.equal(tower.bodyLayer, 64);
    assert.equal(tower.collisionMask, 1153);
    assert.equal(
        tower.interactionLayer,
        GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE
    );
    assert.equal(tower.interactionLayer, 512);
    assert.equal(
        tower.interactionMask,
        GPU_CIRCLE_BODY_COLLISION_LAYER.PROJECTILE
            | GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY
    );
    assert.equal(tower.interactionMask, 3);
    assert.equal('contactHandler' in tower, false);
    assert.equal(tower.health, THE_TOWER_COMBAT_DATA.MAX_HEALTH);
    assert.equal(tower.health, 30);
    assert.equal(tower.lifetime, GPU_CIRCLE_BODY_LIFETIME.IMMORTAL);
    assert.equal(tower.alive, true);
    assert.equal(tower.countAsKill, false);
    assert.equal(tower.golden, false);
    assert.equal(tower.explodeOnDeath, false);
    assert.equal('gold' in tower, false);
    assert.equal('reward' in tower, false);
    assert.equal('bounty' in tower, false);
    assert.equal(
        tower.collisionMask & enemy.bodyLayer,
        enemy.bodyLayer,
        'Tower는 Enemy를 physical acceptance 대상으로 포함한다.'
    );
    assert.equal(
        isReciprocalInteractionPairEnabled(basicBullet, enemy),
        true,
        'Player Basic policy는 Enemy interaction을 보존합니다.'
    );
    assert.equal(
        isReciprocalInteractionPairEnabled(basicBullet, tower),
        false,
        'Player Basic policy는 Tower capability를 target하지 않습니다.'
    );
    assert.equal(
        isReciprocalInteractionPairEnabled(hostileTowerProjectile, tower),
        true,
        'Hostile player-damageable policy는 Tower와 reciprocal pair입니다.'
    );
    assert.equal(
        isReciprocalInteractionPairEnabled(hostileTowerProjectile, enemy),
        false,
        'Hostile Tower policy는 Enemy capability를 target하지 않습니다.'
    );
    assert.equal(
        isReciprocalInteractionPairEnabled(hostileTowerProjectile, core),
        false,
        'Core proxy는 Tower target capability가 아닙니다.'
    );
    assert.equal(tower.renderStyle.visible, true);
    assert.equal(
        tower.renderStyle.shapeCode,
        GPU_CIRCLE_BODY_RENDER_SHAPE.CIRCLE
    );
    assert.equal(Object.isFrozen(tower), true);
    assert.equal(Object.isFrozen(tower.position), true);
    assert.equal(Object.isFrozen(tower.renderStyle), true);
    assert.equal(Object.isFrozen(tower.renderStyle.color), true);
    const damagedTower = createGpuTowerSpawnIntent({
        position: authoredPosition,
        currentHp: 17
    });
    assert.equal(damagedTower.health, 17);
    const sessionScaledTower = createGpuTowerSpawnIntent({
        position: authoredPosition,
        currentHp: 20_000_000
    });
    assert.equal(sessionScaledTower.health, 20_000_000);
    assert.throws(
        () => createGpuTowerSpawnIntent({ position: authoredPosition, currentHp: 0 }),
        /currentHp/
    );
    assert.throws(
        () => createGpuTowerSpawnIntent({
            position: authoredPosition,
            currentHp: 21_474_837
        }),
        /fixedPoint/
    );
    assert.throws(
        () => createGpuTowerSpawnIntent({ position: { x: NaN, y: 0 } }),
        /position/
    );
});

test('Core proxy는 invisible static/no-physical이며 Enemy와 hostile Projectile interaction을 reciprocal 허용한다', () => {
    const core = createGpuCoreProxySpawnIntent({
        position: { x: 27, y: 22 }
    });
    const enemy = createEnemyIntent();
    const hostileCoreProjectile = createProjectileIntent(
        GAMEPLAY_TEAM_ID.HOSTILE,
        PROJECTILE_TARGET_POLICY_ID.CORE_PROXY_AND_TERRAIN
    );

    assert.equal(core.kindId, GPU_CORE_PROXY_WORLD_KIND_ID);
    assert.equal(core.kindId, 'core-proxy');
    assert.equal(core.definitionId, GPU_CORE_PROXY_DEFINITION_ID);
    assert.equal(core.teamId, GAMEPLAY_TEAM_ID.NEUTRAL);
    assert.equal(
        core.allegiancePolicy,
        GAMEPLAY_ALLEGIANCE_POLICY.EXPLICIT_OVERRIDE
    );
    assert.equal(core.inverseMass, 0);
    assert.equal(core.collisionMask, 0);
    assert.equal(
        core.interactionLayer,
        GPU_CIRCLE_BODY_COLLISION_LAYER.CORE_PROXY
    );
    assert.equal(
        core.interactionMask,
        GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY
            | GPU_CIRCLE_BODY_COLLISION_LAYER.PROJECTILE
    );
    assert.equal(
        enemy.interactionMask & core.interactionLayer,
        core.interactionLayer
    );
    assert.equal(
        core.interactionMask & enemy.interactionLayer,
        enemy.interactionLayer
    );
    assert.equal(
        isReciprocalInteractionPairEnabled(hostileCoreProjectile, core),
        true,
        'Core proxy의 reciprocal mask가 Projectile typed contact를 허용합니다.'
    );
    assert.equal(core.collisionMask & enemy.bodyLayer, 0);
    assert.equal(core.contactHandler.damageSelf, 0);
    assert.equal(core.contactHandler.damageOther, 0);
    assert.equal(
        core.contactHandler.flags,
        GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_ENTER_ONLY
    );
    assert.equal(core.renderStyle.visible, false);
    assert.deepEqual(Array.from(core.renderStyle.color), [0, 0, 0, 0]);
    assert.equal('health' in core, false);
    assert.equal('lifetime' in core, false);
    assert.doesNotMatch(
        CORE_PROXY_ADAPTER_SOURCE,
        /from\s+['"][^'"]*(?:core_integrity|integrity)[^'"]*['"]/iu
    );
    assert.equal(Object.isFrozen(core), true);
    assert.equal(Object.isFrozen(core.contactHandler), true);
    assert.equal(Object.isFrozen(core.renderStyle), true);
});

test('CPU Core presentation은 supplied Integrity identity만 유지하고 physics/collider가 아니다', () => {
    const integrity = new CoreIntegrity({ maxIntegrity: 100 });
    integrity.applyIntegrityDamage(37);
    const core = new CorePresentationFacade({ x: 27, y: 22, integrity });

    assert.strictEqual(core.getCoreIntegrity(), integrity);
    assert.equal(core.getCoreIntegrity().getCurrentIntegrity(), 63);
    assert.deepEqual({ ...core.position }, { x: 27, y: 22 });
    assert.equal(isPhysicsBody2D(core), false);
    assert.equal(isPhysicsBodyOwner(core), false);
    assert.equal(isCollidable2D(core), false);
    assert.equal('getPhysicsBody' in core, false);
    assert.equal('getCollider' in core, false);

    core.destroy();
    assert.equal(core.active, false);
    assert.equal(core.getCoreIntegrity(), null);
});

test('Tower facade는 semantic control/camera만 구현하고 exact-once deterministic control을 보낸다', () => {
    const tower = new GpuTowerActorFacade();
    const endpoint = createControlEndpoint();

    assert.equal(isPlayerControllable(tower), true);
    assert.equal(isCameraFollowTarget2D(tower), true);
    assert.equal(isPhysicsBody2D(tower), false);
    assert.equal(isPhysicsBodyOwner(tower), false);
    assert.equal(isCollidable2D(tower), false);
    assert.equal('getPhysicsBody' in tower, false);
    assert.equal('getCollider' in tower, false);

    tower.handlePlayerAction({
        type: PLAYER_ACTION_TYPES.MOVE_VECTOR,
        payload: { x: 1, y: 0 }
    });
    const preActive = tower.stageControlForFixedTick(endpoint, 1);
    assert.equal(preActive.accepted, false);
    assert.equal(preActive.reason, 'body-not-active');
    assert.equal(endpoint.calls.length, 0);

    const handle = tower.bindGpuBody({ entityId: 41, incarnation: 3 }, 7);
    assert.deepEqual({ ...handle }, { entityId: 41, incarnation: 3 });
    const right = tower.stageControlForFixedTick(endpoint, 1);
    assert.equal(endpoint.calls.length, 1);
    assert.equal(endpoint.calls[0].command.moveIntentX, 1);
    assert.equal(endpoint.calls[0].command.moveIntentY, 0);
    assert.equal(
        endpoint.calls[0].commandId,
        'gpu-tower-control:7:41:3:1'
    );

    tower.handlePlayerAction({
        type: PLAYER_ACTION_TYPES.MOVE_VECTOR,
        payload: { x: -1, y: 0 }
    });
    assert.strictEqual(tower.stageControlForFixedTick(endpoint, 1), right);
    assert.equal(endpoint.calls.length, 1, 'same-tick replay는 request를 반복하지 않는다.');

    tower.stageControlForFixedTick(endpoint, 2);
    assert.equal(endpoint.calls[1].command.moveIntentX, -1);
    assert.equal(endpoint.calls[1].command.moveIntentY, 0);
    assert.equal(
        endpoint.calls[1].commandId,
        'gpu-tower-control:7:41:3:2'
    );

    tower.handlePlayerAction({
        type: PLAYER_ACTION_TYPES.MOVE_VECTOR,
        payload: { x: 1, y: -1 }
    });
    tower.stageControlForFixedTick(endpoint, 3);
    assert.equal(
        endpoint.calls[2].command.moveIntentX,
        Math.fround(1 / Math.sqrt(2))
    );
    assert.equal(
        endpoint.calls[2].command.moveIntentY,
        Math.fround(-1 / Math.sqrt(2))
    );

    tower.handlePlayerAction({
        type: PLAYER_ACTION_TYPES.MOVE_VECTOR,
        payload: { x: 0, y: 0 }
    });
    const released = tower.stageControlForFixedTick(endpoint, 4);
    assert.equal(endpoint.calls[3].command.moveIntentX, 0);
    assert.equal(endpoint.calls[3].command.moveIntentY, 0);
    assert.strictEqual(tower.stageControlForFixedTick(endpoint, 4), released);
    assert.equal(endpoint.calls.length, 4);
    assert.throws(() => tower.stageControlForFixedTick(endpoint, 3), /단조 증가/);
});

test('committed Tower death는 facade control/binding/tracking을 영구 비활성화한다', () => {
    const tower = new GpuTowerActorFacade();
    const endpoint = createControlEndpoint();
    tower.bindGpuBody({ entityId: 41, incarnation: 3 }, 7);
    assert.equal(tower.updateObservedPose(createPose(), createPoseFrame()), true);
    assert.equal(tower.isCameraFollowEnabled(), true);
    assert.equal(tower.deactivateForDeath(), true);

    const status = tower.getStatus();
    assert.equal(status.active, false);
    assert.equal(status.bodyHandle, null);
    assert.equal(status.sessionGeneration, null);
    assert.equal(status.followEnabled, false);
    assert.equal(status.lastPoseRejection, 'tower-dead');
    assert.equal(tower.isControlEnabled(), false);
    assert.equal(tower.isCameraFollowEnabled(), false);
    assert.deepEqual(
        { ...tower.stageControlForFixedTick(endpoint, 11) },
        { accepted: false, reason: 'body-not-active' }
    );
    assert.equal(endpoint.calls.length, 0);
    assert.equal(tower.handlePlayerAction({
        type: PLAYER_ACTION_TYPES.MOVE_VECTOR,
        payload: { x: 1, y: 0 }
    }), INPUT_DISPOSITIONS.PASS);
    assert.throws(
        () => tower.bindGpuBody({ entityId: 42, incarnation: 1 }, 8),
        /비활성 Tower facade/
    );
    assert.equal(tower.deactivateForDeath(), false);
    tower.destroy();
    tower.destroy();
});

test('tracked pose는 exact identity/generation과 4-tick bound를 검증하고 valid sample로 회복한다', () => {
    const tower = new GpuTowerActorFacade();
    tower.bindGpuBody({ entityId: 41, incarnation: 3 }, 7);
    const baseFrame = createPoseFrame();
    const rejectedSamples = [
        createPose({ entityId: 42 }),
        createPose({ incarnation: 4 }),
        createPose({ sessionGeneration: 8 }),
        createPose({ deviceGeneration: 10 }),
        createPose({ authoritativeEpoch: 12 })
    ];

    for (const pose of rejectedSamples) {
        assert.equal(tower.updateObservedPose(pose, baseFrame), false);
        assert.equal(tower.isCameraFollowEnabled(), false);
        assert.equal(
            tower.getStatus().lastPoseRejection,
            'identity-or-generation-mismatch'
        );
    }

    assert.equal(tower.updateObservedPose(createPose(), baseFrame), true);
    assert.equal(tower.isCameraFollowEnabled(), true);
    const interpolated = tower.copyCameraFollowPositionInto({});
    assertNearlyEqual(interpolated.x, 9.25);
    assertNearlyEqual(interpolated.y, 19.25);

    assert.equal(tower.updateObservedPose(createPose({
        sourceTick: 9,
        observedThroughTick: 9
    }), createPoseFrame({ currentFixedTick: 10 })), false);
    assert.equal(tower.getStatus().lastPoseRejection, 'invalid-or-out-of-order-tick');

    assert.equal(GPU_TOWER_TRACKED_POSE_MAX_AGE_TICKS, 4);
    assert.equal(tower.updateObservedPose(
        createPose(),
        createPoseFrame({ currentFixedTick: 14, fixedAlpha: 0.5 })
    ), true, 'age 4는 freshness boundary 안이다.');
    const ageFourPrediction = tower.copyCameraFollowPositionInto({});
    assertNearlyEqual(ageFourPrediction.x, 11.4);
    assertNearlyEqual(ageFourPrediction.y, 19.3);

    assert.equal(tower.updateObservedPose(
        createPose(),
        createPoseFrame({ currentFixedTick: 15 })
    ), false, 'age 5부터 stale이다.');
    assert.equal(tower.isCameraFollowEnabled(), false);
    assert.equal(tower.getStatus().lastPoseRejection, 'stale-sample');

    const recoveredPose = createPose({
        sourceTick: 11,
        observedThroughTick: 11,
        position: { x: 20, y: 30 },
        previousPosition: { x: 19, y: 29 },
        velocity: { x: 2, y: -4 }
    });
    assert.equal(tower.updateObservedPose(
        recoveredPose,
        createPoseFrame({
            currentFixedTick: 13,
            fixedAlpha: 0.5
        })
    ), true);
    assert.equal(tower.isCameraFollowEnabled(), true);
    assert.equal(tower.getStatus().lastPoseRejection, null);
    const recovered = tower.copyCameraFollowPositionInto({});
    assertNearlyEqual(recovered.x, 20.3);
    assertNearlyEqual(recovered.y, 29.4);
});
