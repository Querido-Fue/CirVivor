import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    GAME_WORLD_SESSION_MODE
} = await loadGameModule('ingame/game_world_session_mode.js');
const {
    GameSystem
} = await loadGameModule('ingame/game_system.js');
const {
    isPlayerControllable
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
    INPUT_ACTION_IDS
} = await loadGameModule('input/_input_binding_constants.js');
const {
    THE_TOWER_DATA,
    THE_TOWER_RENDER_DATA
} = await loadGameModule('data/object/tower/the_tower_data.js');
const {
    TILE_WORLD_SIZE
} = await loadGameModule('ingame/map/tile_map.js');

function handleKey(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

class PrimitiveGpuBackend {
    constructor(capacity = 64) {
        this.capacity = capacity;
        this.bodies = new Map();
        this.calls = [];
        this.completedEventBatches = [];
        this.eventProtocol = null;
        this.trackedPose = null;
        this.trackingAccepted = true;
        this.recoveryRequired = false;
        this.destroyed = false;
    }

    getCapacity() {
        return this.capacity;
    }

    init(tileMap) {
        this.calls.push({ type: 'init', tileMap });
        return true;
    }

    spawnBodies(source) {
        const bodies = Array.from(source);
        this.calls.push({ type: 'spawnBodies', bodies });
        const handles = bodies.map((body) => {
            const handle = Object.freeze({
                entityId: body.entityId,
                incarnation: body.incarnation
            });
            this.bodies.set(handleKey(handle), body);
            return handle;
        });
        return {
            accepted: bodies.length,
            rejected: 0,
            handles,
            requiresRecovery: false
        };
    }

    despawnBodies(source) {
        const handles = Array.from(source);
        this.calls.push({ type: 'despawnBodies', handles });
        let removed = 0;
        for (const handle of handles) {
            removed += this.bodies.delete(handleKey(handle)) ? 1 : 0;
        }
        return {
            removed,
            rejected: handles.length - removed,
            requiresRecovery: false
        };
    }

    hasBody(handle) {
        return this.bodies.has(handleKey(handle));
    }

    hasActiveBodies() {
        return this.bodies.size > 0;
    }

    canControlBody(handle) {
        this.calls.push({ type: 'canControlBody', handle });
        return this.hasBody(handle);
    }

    stageFixedPrograms(plan) {
        const controls = Array.from(plan.controls, (control) => ({
            entityId: control.entityId,
            incarnation: control.incarnation,
            moveIntentX: control.moveIntentX,
            moveIntentY: control.moveIntentY
        }));
        const sourceRelativeSpawns = Array.from(plan.sourceRelativeSpawns);
        this.calls.push({
            type: 'stageFixedPrograms',
            targetFixedTick: plan.targetFixedTick,
            controls,
            sourceRelativeSpawns
        });
        return {
            accepted: controls.length + sourceRelativeSpawns.length,
            rejected: 0,
            requiresRecovery: false
        };
    }

    drainCompletedSpawnProgramBatches(out = []) {
        this.calls.push({ type: 'drainCompletedSpawnProgramBatches' });
        return out;
    }

    hasPendingSpawnProgramThroughTick() {
        return false;
    }

    configureTrackedBody(handle) {
        this.calls.push({ type: 'configureTrackedBody', handle });
        return Object.freeze({
            accepted: this.trackingAccepted,
            tracked: this.trackingAccepted && handle !== null
                ? Object.freeze({ ...handle })
                : null
        });
    }

    setTrackedPose(pose) {
        this.trackedPose = pose;
    }

    getObservedTrackedPose() {
        this.calls.push({ type: 'getObservedTrackedPose' });
        return this.trackedPose;
    }

    getLatestTrackedPose() {
        return this.getObservedTrackedPose();
    }

    setEventProtocol(protocol) {
        this.eventProtocol = Object.freeze({ ...protocol });
    }

    getEventProtocolState() {
        return this.eventProtocol;
    }

    drainCompletedEventBatches(out = []) {
        this.calls.push({ type: 'drainCompletedEventBatches' });
        out.push(...this.completedEventBatches.splice(0));
        return out;
    }

    fixedUpdate(delta, sourceTick) {
        this.calls.push({ type: 'fixedUpdate', delta, sourceTick });
        return true;
    }

    updatePresentation(frame) {
        this.calls.push({
            type: 'updatePresentation',
            frame: {
                frameDelta: frame.frameDelta,
                fixedDelta: frame.fixedDelta,
                fixedAlpha: frame.fixedAlpha
            }
        });
        return true;
    }

    synchronizePresentation() {
        this.calls.push({ type: 'synchronizePresentation' });
    }

    draw(camera) {
        this.calls.push({ type: 'draw', camera });
        return true;
    }

    getRuntimeState() {
        return this.destroyed ? 'destroyed' : 'gpu-ready';
    }

    requiresRecovery() {
        return this.recoveryRequired;
    }

    setRecoveryRequired(value) {
        this.recoveryRequired = value === true;
    }

    getStatus() {
        return Object.freeze({
            state: this.getRuntimeState(),
            bodyCount: this.bodies.size,
            sessionGeneration: this.eventProtocol?.sessionGeneration ?? 1,
            deviceGeneration: this.eventProtocol?.deviceGeneration ?? 0,
            authoritativeEpoch: this.eventProtocol?.authoritativeEpoch ?? 0,
            marker: 'phase4-primitive-backend'
        });
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.calls.push({ type: 'destroy' });
        this.bodies.clear();
    }
}

function createRuntimeFixture({ ready, enemyWaveEnabled = false }) {
    const pressed = new Set();
    const circleDraws = [];
    const squareDraws = [];
    const animations = [];
    const backend = new PrimitiveGpuBackend();
    const viewport = { ww: 1920, wh: 1080 };
    let animationId = 0;
    const dependencies = {
        inputActionSource: {
            isPressed(actionId) {
                return pressed.has(actionId);
            },
            getWheelTotals(out) {
                out.x = 0;
                out.y = 0;
                return out;
            }
        },
        animationPort: {
            animate(owner, properties) {
                let active = true;
                const record = {
                    id: ++animationId,
                    owner,
                    properties: { ...properties },
                    promise: Promise.resolve(),
                    retarget(next) {
                        if (!active) {
                            return false;
                        }
                        record.properties = { ...next };
                        return true;
                    },
                    remove() {
                        active = false;
                    },
                    isActive() {
                        return active;
                    }
                };
                animations.push(record);
                return record;
            }
        },
        timePort: {
            getDelta: () => 1 / 120,
            getFixedDelta: () => 1 / 60,
            getFixedInterpolationAlpha: () => 0.5
        },
        viewportPort: {
            getSnapshot(out) {
                out.ww = viewport.ww;
                out.wh = viewport.wh;
                return out;
            }
        },
        worldRenderPort: {
            drawCircle(options) {
                circleDraws.push({ ...options });
            },
            drawSquareInstances(options) {
                squareDraws.push(options);
            }
        },
        webGpuPlatformPort: {
            getState() {
                return ready
                    ? { status: 'ready', ready: true }
                    : { status: 'unsupported', ready: false };
            }
        },
        enemySimulationBackend: backend
    };
    const gameSystem = new GameSystem(dependencies, {
        enemyWaveEnabled
    });
    return {
        animations,
        backend,
        circleDraws,
        gameSystem,
        pressed,
        squareDraws,
        viewport
    };
}

function countCalls(backend, type) {
    return backend.calls.filter((call) => call.type === type).length;
}

function createProtocol(endpoint) {
    return Object.freeze({
        sessionGeneration: endpoint.getStatus().sessionGeneration,
        deviceGeneration: 3,
        authoritativeEpoch: 5
    });
}

function createTrackedPose(protocol, handle, sourceTick, position) {
    return Object.freeze({
        valid: true,
        entityId: handle.entityId,
        incarnation: handle.incarnation,
        sessionGeneration: protocol.sessionGeneration,
        deviceGeneration: protocol.deviceGeneration,
        authoritativeEpoch: protocol.authoritativeEpoch,
        sourceTick,
        observedThroughTick: sourceTick,
        ageTicks: 0,
        position: Object.freeze({ ...position }),
        previousPosition: Object.freeze({
            x: position.x - 0.1,
            y: position.y
        }),
        velocity: Object.freeze({ x: 1, y: 0 })
    });
}

test('GPU_WORLD는 Tower/Core lifecycle, control, tracking, raw event와 draw 권위를 endpoint에 둔다', () => {
    const fixture = createRuntimeFixture({
        ready: true,
        enemyWaveEnabled: false
    });
    const { backend, circleDraws, gameSystem, pressed, viewport } = fixture;
    assert.equal(gameSystem.enter(), true);
    const objectSystem = gameSystem.getObjectSystem();
    const endpoint = gameSystem.getGpuSimulationEndpoint();
    const tower = objectSystem.getTower();
    const coreIntegrity = gameSystem.getCoreIntegrity();
    let coreIntegrityMutationCalls = 0;
    const applyIntegrityDamage = coreIntegrity.applyIntegrityDamage.bind(coreIntegrity);
    coreIntegrity.applyIntegrityDamage = (amount) => {
        coreIntegrityMutationCalls++;
        return applyIntegrityDamage(amount);
    };
    const protocol = createProtocol(endpoint);
    backend.setEventProtocol(protocol);

    assert.equal(gameSystem.getSessionMode(), GAME_WORLD_SESSION_MODE.GPU_WORLD);
    assert.equal(objectSystem.getSessionMode(), GAME_WORLD_SESSION_MODE.GPU_WORLD);
    assert.throws(() => {
        gameSystem.sessionMode = GAME_WORLD_SESSION_MODE.CPU_NO_WAVE_FALLBACK;
    }, TypeError);
    assert.throws(() => {
        objectSystem.sessionMode = GAME_WORLD_SESSION_MODE.CPU_NO_WAVE_FALLBACK;
    }, TypeError);
    assert.equal(objectSystem.getEnemyWaveStatus(), null);
    assert.equal(objectSystem.getPhysicsBodies().length, 0);
    assert.equal(objectSystem.getCollidables().length, 0);
    assert.equal(objectSystem.tileCollisionResolver, null);
    assert.equal(objectSystem.towerController, null);
    assert.equal(objectSystem.towerRenderer, null);
    assert.equal(typeof tower.fixedUpdate, 'undefined');
    assert.equal(typeof tower.updateRenderPosition, 'undefined');
    assert.equal(isPlayerControllable(tower), true);
    assert.equal(isCameraFollowTarget2D(tower), true);
    assert.equal(isPhysicsBody2D(tower), false);
    assert.equal(isPhysicsBodyOwner(tower), false);
    assert.equal(isCollidable2D(tower), false);

    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(gameSystem.getFixedTick(), 1);
    const spawnCalls = backend.calls.filter(({ type }) => type === 'spawnBodies');
    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0].bodies.length, 2);
    assert.equal(
        spawnCalls[0].bodies.filter(({ kindId }) => kindId === 'tower').length,
        1
    );
    assert.equal(
        spawnCalls[0].bodies.filter(({ kindId }) => kindId === 'core-proxy').length,
        1
    );
    assert.equal(endpoint.getRegistry().getActiveCount('tower'), 1);
    assert.equal(endpoint.getRegistry().getActiveCount('core-proxy'), 1);
    assert.equal(countCalls(backend, 'stageFixedPrograms'), 0);
    assert.equal(countCalls(backend, 'fixedUpdate'), 1);

    const actorStatus = objectSystem.getGpuWorldActorStatus();
    assert.ok(actorStatus.towerHandle);
    assert.ok(actorStatus.coreProxyHandle);
    assert.equal(actorStatus.trackedTowerConfigured, true);
    const trackingCalls = backend.calls.filter(
        ({ type }) => type === 'configureTrackedBody'
    );
    assert.equal(trackingCalls.length, 1);
    assert.deepEqual(
        { ...trackingCalls[0].handle },
        { ...actorStatus.towerHandle }
    );

    const integrityBeforeEvent = coreIntegrity.getCurrentIntegrity();
    backend.completedEventBatches.push(Object.freeze({
        ...protocol,
        previousSourceTick: 0,
        previousSubmittedTick: 0,
        sourceTick: 1,
        submittedTick: 1,
        completedThroughTick: 1,
        events: Object.freeze([Object.freeze({
            type: 'contact',
            eventType: 'interaction-enter',
            sequence: 0,
            entityId: actorStatus.coreProxyHandle.entityId,
            incarnation: actorStatus.coreProxyHandle.incarnation,
            otherEntityId: actorStatus.towerHandle.entityId,
            otherIncarnation: actorStatus.towerHandle.incarnation,
            valueFixedPoint: 0
        })])
    }));

    pressed.add(INPUT_ACTION_IDS.MOVE_RIGHT);
    assert.equal(gameSystem.fixedUpdate(), true);
    pressed.clear();
    assert.equal(gameSystem.getFixedTick(), 2);
    let controlPlans = backend.calls.filter(
        ({ type }) => type === 'stageFixedPrograms'
    );
    assert.equal(controlPlans.length, 1);
    assert.equal(controlPlans[0].targetFixedTick, 2);
    assert.equal(controlPlans[0].controls.length, 1);
    assert.equal(controlPlans[0].controls[0].moveIntentX, 1);
    assert.equal(controlPlans[0].controls[0].moveIntentY, 0);
    assert.equal(countCalls(backend, 'fixedUpdate'), 2);

    const rawSnapshot = objectSystem.getLastCompletedGpuEvents();
    assert.equal(Object.isFrozen(rawSnapshot), true);
    assert.equal(rawSnapshot.contactEvents.length, 1);
    assert.equal(rawSnapshot.deathEvents.length, 0);
    assert.equal(rawSnapshot.contactEvents[0].disposition, 'applied');
    assert.equal(rawSnapshot.contactEvents[0].eventType, 'interaction-enter');
    assert.equal(
        rawSnapshot.contactEvents[0].entityId,
        actorStatus.coreProxyHandle.entityId
    );
    assert.equal(rawSnapshot.contactEvents[0].valueFixedPoint, 0);
    assert.equal('reward' in rawSnapshot.contactEvents[0], false);
    assert.equal('gold' in rawSnapshot.contactEvents[0], false);
    assert.equal(coreIntegrityMutationCalls, 0);
    assert.equal(coreIntegrity.getCurrentIntegrity(), integrityBeforeEvent);
    assert.equal(countCalls(backend, 'despawnBodies'), 0);
    assert.equal(endpoint.getRegistry().getActiveCount('tower'), 1);
    assert.equal(endpoint.getRegistry().getActiveCount('core-proxy'), 1);

    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(gameSystem.getFixedTick(), 3);
    controlPlans = backend.calls.filter(
        ({ type }) => type === 'stageFixedPrograms'
    );
    assert.equal(controlPlans.length, 2);
    assert.equal(controlPlans[1].targetFixedTick, 3);
    assert.equal(controlPlans[1].controls.length, 1);
    assert.equal(controlPlans[1].controls[0].moveIntentX, 0);
    assert.equal(controlPlans[1].controls[0].moveIntentY, 0);

    backend.setTrackedPose(createTrackedPose(
        protocol,
        actorStatus.towerHandle,
        3,
        { x: 27, y: 15 }
    ));
    gameSystem.update();
    assert.equal(tower.isCameraFollowEnabled(), true);

    viewport.ww = 1280;
    viewport.wh = 720;
    gameSystem.resize();
    gameSystem.update();
    const camera = objectSystem.getWorldViewProjection();
    const followPosition = tower.copyCameraFollowPositionInto({});
    const projectedFollow = camera.worldToViewport(
        followPosition.x,
        followPosition.y,
        {}
    );
    const roundTrippedFollow = camera.viewportToWorld(
        projectedFollow.x,
        projectedFollow.y,
        {}
    );
    assert.equal(tower.isCameraFollowEnabled(), true);
    assert.ok(Number.isFinite(camera.getScale()) && camera.getScale() > 0);
    assert.ok(Number.isFinite(projectedFollow.x));
    assert.ok(Number.isFinite(projectedFollow.y));
    assert.ok(Number.isFinite(roundTrippedFollow.x));
    assert.ok(Number.isFinite(roundTrippedFollow.y));

    const synchronizeCountBefore = countCalls(
        backend,
        'synchronizePresentation'
    );
    gameSystem.synchronizePresentation();
    assert.equal(
        countCalls(backend, 'synchronizePresentation'),
        synchronizeCountBefore + 1
    );
    assert.equal(tower.isCameraFollowEnabled(), true);

    backend.setTrackedPose(Object.freeze({
        valid: false,
        reason: 'pause-resume-gap'
    }));
    gameSystem.update();
    assert.equal(tower.isCameraFollowEnabled(), false);
    backend.setTrackedPose(createTrackedPose(
        protocol,
        actorStatus.towerHandle,
        3,
        { x: 27.25, y: 15 }
    ));
    gameSystem.update();
    assert.equal(tower.isCameraFollowEnabled(), true);
    assert.equal(tower.getStatus().lastPoseRejection, null);

    for (let expectedTick = 4; expectedTick <= 8; expectedTick++) {
        assert.equal(gameSystem.fixedUpdate(), true);
        assert.equal(gameSystem.getFixedTick(), expectedTick);
    }
    gameSystem.update();
    assert.equal(tower.isCameraFollowEnabled(), false);
    assert.equal(tower.getStatus().lastPoseRejection, 'stale-sample');

    backend.setTrackedPose(createTrackedPose(
        protocol,
        actorStatus.towerHandle,
        8,
        { x: 28, y: 15 }
    ));
    gameSystem.update();
    assert.equal(tower.isCameraFollowEnabled(), true);
    assert.equal(tower.getStatus().lastPoseRejection, null);

    controlPlans = backend.calls.filter(
        ({ type }) => type === 'stageFixedPrograms'
    );
    assert.equal(controlPlans.length, 7);
    assert.deepEqual(
        controlPlans.map(({ targetFixedTick }) => targetFixedTick),
        [2, 3, 4, 5, 6, 7, 8]
    );
    assert.equal(controlPlans[0].controls[0].moveIntentX, 1);
    assert.ok(controlPlans.slice(1).every(({ controls }) => (
        controls.length === 1
        && controls[0].moveIntentX === 0
        && controls[0].moveIntentY === 0
    )));
    assert.equal(countCalls(backend, 'fixedUpdate'), 8);
    assert.deepEqual(
        backend.calls
            .filter(({ type }) => type === 'fixedUpdate')
            .map(({ sourceTick }) => sourceTick),
        [1, 2, 3, 4, 5, 6, 7, 8]
    );
    assert.equal(countCalls(backend, 'configureTrackedBody'), 1);

    backend.setRecoveryRequired(true);
    assert.equal(gameSystem.fixedUpdate(), false);
    assert.equal(gameSystem.getFixedTick(), 8);
    gameSystem.update();
    assert.equal(tower.isCameraFollowEnabled(), false);
    assert.equal(tower.getStatus().lastPoseRejection, 'gpu-world-paused');
    assert.equal(countCalls(backend, 'fixedUpdate'), 8);

    circleDraws.length = 0;
    gameSystem.draw();
    assert.equal(countCalls(backend, 'draw'), 1);
    assert.equal(circleDraws.length, 1, 'CPU Core presentation만 circle draw한다.');
    assert.equal(
        circleDraws.some(({ fill }) => fill === THE_TOWER_RENDER_DATA.FILL),
        false
    );

    gameSystem.destroy();
});

test('GPU Tower tracking reject는 actor commit 뒤 partial submit 없이 recovery로 승격한다', () => {
    const fixture = createRuntimeFixture({
        ready: true,
        enemyWaveEnabled: false
    });
    const { backend, gameSystem } = fixture;
    backend.trackingAccepted = false;
    assert.equal(gameSystem.enter(), true);

    assert.equal(gameSystem.fixedUpdate(), false);
    assert.equal(gameSystem.getFixedTick(), 0);
    assert.equal(gameSystem.isGpuWorldRecoveryRequired(), true);
    assert.equal(countCalls(backend, 'spawnBodies'), 1);
    assert.equal(countCalls(backend, 'configureTrackedBody'), 1);
    assert.equal(countCalls(backend, 'fixedUpdate'), 0);

    gameSystem.destroy();
});

test('active GPU Tower의 control capability 누락은 silent zero-command tick 대신 recovery가 된다', () => {
    const fixture = createRuntimeFixture({
        ready: true,
        enemyWaveEnabled: false
    });
    const { backend, gameSystem } = fixture;
    assert.equal(gameSystem.enter(), true);
    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(gameSystem.getFixedTick(), 1);

    backend.canControlBody = undefined;
    assert.equal(gameSystem.fixedUpdate(), false);
    assert.equal(gameSystem.getFixedTick(), 1);
    assert.equal(gameSystem.isGpuWorldRecoveryRequired(), true);
    assert.equal(countCalls(backend, 'stageFixedPrograms'), 0);
    assert.equal(countCalls(backend, 'fixedUpdate'), 1);

    gameSystem.destroy();
});

test('unsupported enter는 CPU_NO_WAVE_FALLBACK에서 Tower physics/collision/render를 지속한다', () => {
    const fixture = createRuntimeFixture({
        ready: false,
        enemyWaveEnabled: true
    });
    const { backend, circleDraws, gameSystem, pressed } = fixture;
    assert.equal(gameSystem.enter(), true);
    const objectSystem = gameSystem.getObjectSystem();
    const tower = objectSystem.getTower();
    const towerBody = tower.getPhysicsBody();

    assert.equal(
        gameSystem.getSessionMode(),
        GAME_WORLD_SESSION_MODE.CPU_NO_WAVE_FALLBACK
    );
    assert.equal(
        objectSystem.getSessionMode(),
        GAME_WORLD_SESSION_MODE.CPU_NO_WAVE_FALLBACK
    );
    assert.throws(() => {
        gameSystem.sessionMode = GAME_WORLD_SESSION_MODE.GPU_WORLD;
    }, TypeError);
    assert.equal(objectSystem.getEnemyWaveStatus(), null);
    assert.equal(objectSystem.getPhysicsBodies().length, 2);
    assert.equal(objectSystem.getCollidables().length, 2);
    assert.ok(objectSystem.tileCollisionResolver);
    assert.ok(objectSystem.towerController);
    assert.ok(objectSystem.towerRenderer);
    assert.equal(isPhysicsBodyOwner(tower), true);
    assert.equal(isPhysicsBody2D(towerBody), true);
    assert.equal(isCollidable2D(tower.getCollider()), true);

    const initialX = tower.position.x;
    pressed.add(INPUT_ACTION_IDS.MOVE_RIGHT);
    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(gameSystem.getFixedTick(), 1);
    assert.ok(tower.position.x > initialX);

    pressed.clear();
    const tileMap = objectSystem.getTileMap();
    const towerTile = tileMap.worldToTile(
        tower.position.x,
        tower.position.y,
        {}
    );
    let firstWalkableColumn = 0;
    while (!tileMap.isWalkableTile(towerTile.row, firstWalkableColumn)) {
        firstWalkableColumn++;
    }
    const expectedLeftBoundary = (firstWalkableColumn * TILE_WORLD_SIZE)
        + THE_TOWER_DATA.RADIUS_TILES;
    towerBody.setPosition(expectedLeftBoundary - 0.25, tower.position.y);
    towerBody.setVelocity(-1, 0);
    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(gameSystem.getFixedTick(), 2);
    assert.ok(
        Math.abs(tower.position.x - expectedLeftBoundary) <= 1e-9,
        `actual=${tower.position.x}, expected=${expectedLeftBoundary}`
    );
    assert.equal(towerBody.getVelocity().x, 0);
    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(gameSystem.getFixedTick(), 3);

    assert.equal(countCalls(backend, 'spawnBodies'), 0);
    assert.equal(countCalls(backend, 'stageFixedPrograms'), 0);
    assert.equal(backend.bodies.size, 0);
    assert.equal(objectSystem.getWorldRegistry().getActiveCount(), 0);
    assert.equal(objectSystem.getEnemyLifecycleCommandOwner().getPendingCount(), 0);

    gameSystem.update();
    circleDraws.length = 0;
    gameSystem.draw();
    assert.equal(circleDraws.length, 2);
    assert.ok(circleDraws.some(
        ({ fill }) => fill === THE_TOWER_RENDER_DATA.FILL
    ));

    gameSystem.destroy();
});
