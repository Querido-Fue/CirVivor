import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    ARCHER_ENEMY_DATA
} = await loadGameModule('data/object/enemy/archer_enemy_data.js');
const {
    ARCHER_ATTACK_DATA
} = await loadGameModule('data/object/enemy/archer_attack_data.js');
const {
    HOSTILE_BASIC_BULLET_DATA
} = await loadGameModule(
    'data/object/projectile/hostile_basic_bullet_data.js'
);
const {
    BASIC_BULLET_PROJECTILE_DATA
} = await loadGameModule('data/object/projectile/basic_bullet_data.js');
const {
    CORRIDOR_EIGHT_WAVE_01_DATA
} = await loadGameModule('data/scene/game/corridor_eight_wave_01_data.js');
const {
    GAMEPLAY_TEAM_ID
} = await loadGameModule('ingame/contract/gameplay_team_contract.js');
const {
    PROJECTILE_TARGET_POLICY_ID
} = await loadGameModule(
    'ingame/contract/projectile_target_policy_contract.js'
);
const {
    GameSystem
} = await loadGameModule('ingame/game_system.js');
const {
    HOSTILE_ATTACK_COMMAND_NAMESPACE,
    HOSTILE_ATTACK_SHOT_STATE,
    computeHostileAttackPhaseOffset
} = await loadGameModule(
    'ingame/object/enemy/hostile_attack_director.js'
);
const {
    GPU_SPAWN_PROGRAM_MODE
} = await loadGameModule('ingame/physics/gpu/gpu_fixed_primitive_abi.js');
const {
    encodeGpuCircleBodyFixedPoint
} = await loadGameModule('ingame/physics/gpu/gpu_circle_body_abi.js');

const NORMAL_GROUP = CORRIDOR_EIGHT_WAVE_01_DATA.phases[0].spawnGroups[0];
const CUSTOM_ARCHER_WAVE = Object.freeze({
    waveId: 'turn4_custom_archer_wave',
    mapId: CORRIDOR_EIGHT_WAVE_01_DATA.mapId,
    phases: Object.freeze([
        Object.freeze({
            startTick: 1,
            durationTicks: 2,
            spawnGroups: Object.freeze([
                Object.freeze({
                    enemyDefinitionId: ARCHER_ENEMY_DATA.id,
                    gateId: NORMAL_GROUP.gateId,
                    pathChoicePolicy: 'fixed-route',
                    count: 1,
                    intervalTicks: 1,
                    policyId: 'corebound',
                    laneOffsetsTiles: Object.freeze([0])
                })
            ])
        })
    ])
});
const FAILED_REPLACEMENT_BACKEND_INIT = Object.freeze({
    initResult: false,
    runtimeState: 'gpu-unavailable',
    requiresRecovery: true
});

function handleKey(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

function exactHandle(handle) {
    return Object.freeze({
        entityId: handle.entityId,
        incarnation: handle.incarnation
    });
}

function copyVector(source) {
    return { x: Number(source.x), y: Number(source.y) };
}

function assertNear(actual, expected, epsilon = 1e-6) {
    assert.ok(
        Math.abs(actual - expected) <= epsilon,
        `${actual}은 ${expected}의 ${epsilon} 이내여야 합니다.`
    );
}

function assertCameraDrawSnapshot(snapshot, expectedCenter, cameraScale) {
    const halfWorldWidth = 960 / cameraScale;
    const halfWorldHeight = 540 / cameraScale;
    assertNear(snapshot.cameraCenter.x, expectedCenter.x);
    assertNear(snapshot.cameraCenter.y, expectedCenter.y);
    assertNear(snapshot.viewTopLeft.x, expectedCenter.x - halfWorldWidth);
    assertNear(snapshot.viewTopLeft.y, expectedCenter.y - halfWorldHeight);
    assertNear(snapshot.viewBottomRight.x, expectedCenter.x + halfWorldWidth);
    assertNear(snapshot.viewBottomRight.y, expectedCenter.y + halfWorldHeight);
}

class ArcherIntegrationBackend {
    constructor(sessionGeneration, initConfiguration = true) {
        const configuration = typeof initConfiguration === 'object'
            ? initConfiguration
            : { initResult: initConfiguration };
        this.capacity = 128;
        this.sessionGeneration = sessionGeneration;
        this.initResult = configuration.initResult;
        this.recoveryRequired = configuration.requiresRecovery === true;
        this.initCount = 0;
        this.eventProtocol = Object.freeze({
            sessionGeneration,
            deviceGeneration: 9,
            authoritativeEpoch: 4
        });
        this.bodies = new Map();
        this.spawnBatches = [];
        this.fixedPlans = [];
        this.materializedShots = [];
        this.spawnCompletionBatches = [];
        this.completedEventBatches = [];
        this.pendingFixedPlan = null;
        this.rejectSpawnProgramTicks = new Set();
        this.targetInvalidHostileTicks = new Set();
        this.lastEventSourceTick = 0;
        this.lastEventSubmittedTick = 0;
        this.controlAcceptedCount = 0;
        this.fixedUpdateCount = 0;
        this.destroyCount = 0;
        this.drawSnapshots = [];
        this.trackedHandle = null;
        this.runtimeState = configuration.runtimeState ?? 'gpu-ready';
    }

    getCapacity() {
        return this.capacity;
    }

    init(tileMap) {
        this.initCount++;
        this.tileMap = tileMap;
        return this.initResult;
    }

    spawnBodies(source) {
        const batch = Array.from(source, (body) => ({
            ...body,
            position: copyVector(body.position),
            velocity: copyVector(body.velocity)
        }));
        this.spawnBatches.push(batch);
        for (const body of batch) {
            this.bodies.set(handleKey(body), body);
        }
        return {
            accepted: batch.length,
            rejected: 0,
            handles: batch.map(exactHandle),
            requiresRecovery: false
        };
    }

    despawnBodies(source) {
        const handles = Array.from(source);
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
        return this.bodies.get(handleKey(handle))?.kindId === 'tower';
    }

    stageFixedPrograms(plan = {}) {
        const controls = Array.from(plan.controls ?? []);
        const requestedSpawns = Array.from(plan.sourceRelativeSpawns ?? []);
        assert.equal(this.pendingFixedPlan, null);
        assert.equal(
            controls.every((control) => this.canControlBody(control)),
            true
        );
        assert.equal(
            requestedSpawns.every(({ sourceHandle, targetHandle }) => (
                this.hasBody(sourceHandle)
                    && (!targetHandle || this.hasBody(targetHandle))
            )),
            true
        );

        const rejectSpawns = requestedSpawns.length > 0
            && this.rejectSpawnProgramTicks.delete(plan.targetFixedTick);
        const acceptedSpawns = rejectSpawns ? [] : requestedSpawns;
        this.pendingFixedPlan = {
            targetFixedTick: plan.targetFixedTick,
            controls,
            sourceRelativeSpawns: acceptedSpawns
        };
        this.controlAcceptedCount += controls.length;
        this.fixedPlans.push(Object.freeze({
            targetFixedTick: plan.targetFixedTick,
            controls: Object.freeze(controls),
            sourceRelativeSpawns: Object.freeze(requestedSpawns),
            spawnRejected: rejectSpawns
        }));

        const reason = rejectSpawns ? 'fixed-program-capacity' : null;
        return {
            accepted: controls.length + acceptedSpawns.length,
            rejected: rejectSpawns ? requestedSpawns.length : 0,
            controls: {
                accepted: controls.length,
                rejected: 0,
                reason: null
            },
            sourceRelativeSpawns: {
                accepted: acceptedSpawns.length,
                rejected: rejectSpawns ? requestedSpawns.length : 0,
                reason
            },
            reason,
            requiresRecovery: false
        };
    }

    fixedUpdate(delta, sourceTick) {
        const plan = this.pendingFixedPlan;
        if (plan) {
            assert.equal(plan.targetFixedTick, sourceTick);
            this.#materializeSourceRelativeSpawns(plan, sourceTick);
            for (const control of plan.controls) {
                const tower = this.bodies.get(handleKey(control));
                tower.velocity.x = control.moveIntentX * 3;
                tower.velocity.y = control.moveIntentY * 3;
            }
            this.pendingFixedPlan = null;
        }
        for (const body of this.bodies.values()) {
            body.position.x += body.velocity.x * delta;
            body.position.y += body.velocity.y * delta;
        }
        this.fixedUpdateCount++;
        return this.bodies.size > 0;
    }

    #materializeSourceRelativeSpawns(plan, sourceTick) {
        const outcomes = [];
        for (const spawn of plan.sourceRelativeSpawns) {
            const source = this.bodies.get(handleKey(spawn.sourceHandle));
            const target = spawn.targetHandle
                ? this.bodies.get(handleKey(spawn.targetHandle))
                : null;
            let outcome = source ? 'resolved' : 'source-invalid';
            if (outcome === 'resolved'
                && spawn.modeFlags
                    === GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY
                && (!target || (spawn.destinationSpawn.definitionId
                    === HOSTILE_BASIC_BULLET_DATA.id
                    && this.targetInvalidHostileTicks.delete(sourceTick)))) {
                outcome = 'target-invalid';
            }

            const sourcePosition = source ? copyVector(source.position) : null;
            const targetPosition = target ? copyVector(target.position) : null;
            let origin = null;
            let velocity = null;
            if (outcome === 'resolved') {
                origin = {
                    x: source.position.x + spawn.positionOffset.x,
                    y: source.position.y + spawn.positionOffset.y
                };
                if (spawn.modeFlags
                    === GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_VELOCITY) {
                    velocity = {
                        x: spawn.launchVelocity.x
                            + (source.velocity.x * spawn.sourceVelocityScale),
                        y: spawn.launchVelocity.y
                            + (source.velocity.y * spawn.sourceVelocityScale)
                    };
                } else {
                    const aim = spawn.modeFlags
                        === GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY
                        ? {
                            x: target.position.x + spawn.targetOffset.x,
                            y: target.position.y + spawn.targetOffset.y
                        }
                        : spawn.aimWorldPoint;
                    const dx = aim.x - origin.x;
                    const dy = aim.y - origin.y;
                    const length = Math.hypot(dx, dy);
                    const unitX = length > 0 ? dx / length : 1;
                    const unitY = length > 0 ? dy / length : 0;
                    velocity = {
                        x: unitX * spawn.launchSpeed,
                        y: unitY * spawn.launchSpeed
                    };
                }
                const body = {
                    ...spawn.destinationSpawn,
                    ...spawn.destinationHandle,
                    position: origin,
                    velocity
                };
                this.bodies.set(handleKey(spawn.destinationHandle), body);
            }
            this.materializedShots.push(Object.freeze({
                sourceTick,
                definitionId: spawn.destinationSpawn.definitionId,
                sourceHandle: exactHandle(spawn.sourceHandle),
                targetHandle: spawn.targetHandle
                    ? exactHandle(spawn.targetHandle)
                    : null,
                destinationHandle: exactHandle(spawn.destinationHandle),
                destinationSpawn: spawn.destinationSpawn,
                sourcePosition,
                targetPosition,
                origin: origin ? Object.freeze(copyVector(origin)) : null,
                velocity: velocity ? Object.freeze(copyVector(velocity)) : null,
                outcome
            }));
            outcomes.push(Object.freeze({
                sourceHandle: exactHandle(spawn.sourceHandle),
                targetHandle: spawn.targetHandle
                    ? exactHandle(spawn.targetHandle)
                    : null,
                destinationHandle: exactHandle(spawn.destinationHandle),
                reason: outcome
            }));
        }
        if (outcomes.length > 0) {
            this.spawnCompletionBatches.push(Object.freeze({
                ...this.eventProtocol,
                sourceTick,
                outcomes: Object.freeze(outcomes)
            }));
        }
    }

    drainCompletedSpawnProgramBatches(out = []) {
        out.push(...this.spawnCompletionBatches.splice(0));
        return out;
    }

    hasPendingSpawnProgramThroughTick() {
        return false;
    }

    getEventProtocolState() {
        return this.eventProtocol;
    }

    queueTowerDamageEvents(sourceHandle, towerHandle, sourceTick, lethal) {
        const damage = HOSTILE_BASIC_BULLET_DATA.damage;
        const events = [{
            type: 'contact',
            eventType: 'damage-applied',
            sequence: 0,
            entityId: sourceHandle.entityId,
            incarnation: sourceHandle.incarnation,
            otherEntityId: towerHandle.entityId,
            otherIncarnation: towerHandle.incarnation,
            valueFixedPoint: encodeGpuCircleBodyFixedPoint(damage),
            damage,
            reason: lethal ? 'target-died' : null
        }];
        if (lethal) {
            events.push({
                type: 'death',
                sequence: 1,
                entityId: towerHandle.entityId,
                incarnation: towerHandle.incarnation,
                flags: 1,
                reason: 'health-depleted'
            });
        }
        this.completedEventBatches.push(Object.freeze({
            ...this.eventProtocol,
            previousSourceTick: this.lastEventSourceTick,
            previousSubmittedTick: this.lastEventSubmittedTick,
            sourceTick,
            submittedTick: sourceTick,
            completedThroughTick: sourceTick,
            events: Object.freeze(events.map((event) => Object.freeze(event)))
        }));
        this.lastEventSourceTick = sourceTick;
        this.lastEventSubmittedTick = sourceTick;
    }

    drainCompletedEventBatches(out = []) {
        out.push(...this.completedEventBatches.splice(0));
        return out;
    }

    configureTrackedBody(handle = null) {
        if (handle === null) {
            this.trackedHandle = null;
            return { accepted: true, tracked: false };
        }
        if (!this.canControlBody(handle)) {
            return { accepted: false, reason: 'stale-handle' };
        }
        this.trackedHandle = exactHandle(handle);
        return { accepted: true, tracked: true };
    }

    updatePresentation() {}

    synchronizePresentation() {}

    draw(camera) {
        const renderedEnemyHandles = [];
        const visibleEnemyHandles = [];
        for (const body of this.bodies.values()) {
            if (body.kindId !== 'enemy') {
                continue;
            }
            const handle = exactHandle(body);
            renderedEnemyHandles.push(handle);
            if (camera?.worldToViewport) {
                const viewport = camera.worldToViewport(
                    body.position.x,
                    body.position.y,
                    {}
                );
                const radius = typeof camera.worldLengthToViewport === 'function'
                    ? camera.worldLengthToViewport(body.radius ?? 0)
                    : 0;
                if (viewport.x + radius >= 0
                    && viewport.x - radius <= 1920
                    && viewport.y + radius >= 0
                    && viewport.y - radius <= 1080) {
                    visibleEnemyHandles.push(handle);
                }
            }
        }
        this.drawSnapshots.push(Object.freeze({
            renderedEnemyHandles: Object.freeze(renderedEnemyHandles),
            visibleEnemyHandles: Object.freeze(visibleEnemyHandles),
            cameraCenter: camera?.viewportToWorld
                ? Object.freeze(camera.viewportToWorld(960, 540, {}))
                : null,
            viewTopLeft: camera?.viewportToWorld
                ? Object.freeze(camera.viewportToWorld(0, 0, {}))
                : null,
            viewBottomRight: camera?.viewportToWorld
                ? Object.freeze(camera.viewportToWorld(1920, 1080, {}))
                : null
        }));
        return this.bodies.size > 0;
    }

    getRuntimeState() {
        return this.runtimeState;
    }

    requiresRecovery() {
        return this.recoveryRequired;
    }

    getStatus() {
        return Object.freeze({
            state: this.runtimeState,
            ...this.eventProtocol,
            bodyCount: this.bodies.size
        });
    }

    destroy() {
        if (this.destroyCount > 0) {
            return;
        }
        this.destroyCount++;
        this.bodies.clear();
        this.spawnCompletionBatches.length = 0;
        this.completedEventBatches.length = 0;
        this.pendingFixedPlan = null;
        this.trackedHandle = null;
        this.runtimeState = 'destroyed';
    }
}

function createAnimationHandle() {
    let active = true;
    return {
        id: 1,
        promise: Promise.resolve(),
        retarget() {
            return active;
        },
        remove() {
            active = false;
        },
        isActive() {
            return active;
        }
    };
}

function createDependencies(backends, inputState, backendInitResults = []) {
    return {
        inputActionSource: {
            isPressed(actionId) {
                return inputState.moveRight && actionId === 'moveRight';
            },
            getPointerPosition(out) {
                out.x = 960;
                out.y = 540;
                return out;
            },
            isPrimaryPointerPressed() {
                return inputState.primaryPressed;
            },
            getWheelTotals(out) {
                out.x = 0;
                out.y = 0;
                return out;
            }
        },
        animationPort: {
            animate() {
                return createAnimationHandle();
            }
        },
        timePort: {
            getDelta: () => 1 / 120,
            getFixedDelta: () => 1 / 60,
            getFixedInterpolationAlpha: () => 0.5
        },
        viewportPort: {
            getSnapshot(out) {
                out.ww = 1920;
                out.wh = 1080;
                return out;
            }
        },
        worldRenderPort: {
            drawCircle() {},
            drawSquareInstances() {}
        },
        webGpuPlatformPort: {
            getState() {
                return { ready: true, deviceGeneration: 9 };
            }
        },
        enemySimulationBackendFactory(_dependencies, options) {
            const initResult = backendInitResults.length > 0
                ? backendInitResults.shift()
                : true;
            const backend = new ArcherIntegrationBackend(
                options.sessionGeneration,
                initResult
            );
            backends.push(backend);
            return backend;
        }
    };
}

class GameSceneLikeHarness {
    constructor(dependencies, options = {}) {
        this.gameSystem = new GameSystem(dependencies, options);
        this.recoveryRestartCount = 0;
        assert.equal(this.gameSystem.enter(), true);
    }

    fixedUpdate() {
        const advanced = this.gameSystem.fixedUpdate();
        if (!advanced && this.gameSystem.isEnemySimulationRecoveryRequired()) {
            if (this.gameSystem.restartGpuWorldAtSafeWaveBoundary()) {
                this.recoveryRestartCount++;
            }
        }
        return advanced;
    }

    update() {
        this.gameSystem.update();
    }

    draw() {
        this.gameSystem.draw();
    }

    getGameSystem() {
        return this.gameSystem;
    }

    getEnemyRecoveryStatus() {
        return Object.freeze({ restartCount: this.recoveryRestartCount });
    }

    destroy() {
        this.gameSystem.destroy();
    }
}

function advanceThrough(gameSystem, targetFixedTick) {
    while (gameSystem.getFixedTick() < targetFixedTick) {
        assert.equal(gameSystem.fixedUpdate(), true);
    }
}

function findArcherStatus(status, handle) {
    return status.archers.find(({ handle: candidate }) => (
        handleKey(candidate) === handleKey(handle)
    ));
}

function findProjectileHandleByDefinition(registry, definitionId) {
    return registry.copyActiveHandlesInto([], { kindId: 'projectile' })
        .find((handle) => (
            registry.copyEntityView(handle, {})?.definitionId === definitionId
        ));
}

function prepareCustomArcherAtFiveTowerHp() {
    const inputState = { moveRight: false, primaryPressed: false };
    const backends = [];
    const gameSystem = new GameSystem(
        createDependencies(backends, inputState),
        { waveDefinition: CUSTOM_ARCHER_WAVE }
    );
    assert.equal(gameSystem.enter(), true);
    const objectSystem = gameSystem.getObjectSystem();
    const endpoint = gameSystem.getGpuSimulationEndpoint();
    const registry = endpoint.getRegistry();
    const backend = backends[0];

    assert.equal(gameSystem.fixedUpdate(), true);
    const initialStatus = gameSystem.getHostileAttackStatus();
    const archerHandle = initialStatus.archers[0].handle;
    const towerHandle = objectSystem.getGpuWorldActorStatus().towerHandle;
    for (let hitIndex = 0; hitIndex < 5; hitIndex++) {
        backend.queueTowerDamageEvents(
            archerHandle,
            towerHandle,
            gameSystem.getFixedTick(),
            false
        );
        assert.equal(gameSystem.fixedUpdate(), true);
    }
    assert.equal(gameSystem.getTowerCombatStatus().currentHp, 5);
    assert.equal(gameSystem.getTowerCombatStatus().alive, true);
    return {
        inputState,
        gameSystem,
        objectSystem,
        endpoint,
        registry,
        backend,
        archerHandle,
        towerHandle,
        shotTick: initialStatus.archers[0].nextEligibleFixedTick
    };
}

function assertTowerDeathPendingFixtureHealthy(fixture) {
    assert.equal(fixture.gameSystem.getTowerCombatStatus().alive, false);
    assert.equal(fixture.registry.has(fixture.archerHandle), true);
    assert.equal(fixture.backend.hasBody(fixture.archerHandle), true);
    assert.equal(fixture.registry.getActiveCount('enemy'), 1);
    assert.equal(fixture.gameSystem.isGpuWorldRecoveryRequired(), false);
    assert.equal(fixture.gameSystem.getHostileAttackStatus().recoveryRequired, false);
}

test('Tower death 경계의 pending Archer 3-state는 정상 target-invalid 또는 resolved projectile 계속 진행으로 끝난다', async (t) => {
    await t.test('REQUESTED_FOR_FIXED_TICK은 dead target commit에서 정상 target-invalid로 정리된다', () => {
        const fixture = prepareCustomArcherAtFiveTowerHp();
        advanceThrough(fixture.gameSystem, fixture.shotTick - 1);
        const staged = fixture.objectSystem.hostileAttackDirector.stageForFixedTick({
            targetFixedTick: fixture.shotTick,
            targetHandle: fixture.towerHandle
        });
        assert.equal(staged.acceptedCount, 1);
        assert.equal(
            fixture.gameSystem.getHostileAttackStatus().archers[0].state,
            HOSTILE_ATTACK_SHOT_STATE.REQUESTED_FOR_FIXED_TICK
        );

        fixture.backend.queueTowerDamageEvents(
            fixture.archerHandle,
            fixture.towerHandle,
            fixture.gameSystem.getFixedTick(),
            true
        );
        assert.equal(fixture.gameSystem.fixedUpdate(), true);
        assertTowerDeathPendingFixtureHealthy(fixture);
        const invalidShot = fixture.backend.materializedShots.find(({ sourceTick }) => (
            sourceTick === fixture.shotTick
        ));
        const statusAtDeath = fixture.gameSystem.getHostileAttackStatus();
        assert.equal(invalidShot, undefined);
        assert.equal(statusAtDeath.pendingShotCount, 0);
        assert.equal(statusAtDeath.telemetry.fixedRejected, 1);
        assert.equal(statusAtDeath.archers[0].shotSequence, 0);
        assert.equal(fixture.gameSystem.fixedUpdate(), true);
        const status = fixture.gameSystem.getHostileAttackStatus();
        assert.equal(status.pendingShotCount, 0);
        assert.equal(status.telemetry.completedTargetInvalid, 0);
        assert.equal(status.archers[0].shotSequence, 0);
        assertTowerDeathPendingFixtureHealthy(fixture);
        fixture.gameSystem.destroy();
    });

    await t.test('GPU_RESOLVE_PENDING의 target-invalid completion은 death와 같은 경계에서 정상 clear된다', () => {
        const fixture = prepareCustomArcherAtFiveTowerHp();
        advanceThrough(fixture.gameSystem, fixture.shotTick - 1);
        fixture.backend.targetInvalidHostileTicks.add(fixture.shotTick);
        assert.equal(fixture.gameSystem.fixedUpdate(), true);
        assert.equal(
            fixture.gameSystem.getHostileAttackStatus().archers[0].state,
            HOSTILE_ATTACK_SHOT_STATE.GPU_RESOLVE_PENDING
        );
        fixture.backend.queueTowerDamageEvents(
            fixture.archerHandle,
            fixture.towerHandle,
            fixture.gameSystem.getFixedTick(),
            true
        );
        assert.equal(fixture.gameSystem.fixedUpdate(), true);
        const status = fixture.gameSystem.getHostileAttackStatus();
        assert.equal(status.pendingShotCount, 0);
        assert.equal(status.telemetry.completedTargetInvalid, 1);
        assert.equal(status.archers[0].shotSequence, 0);
        assertTowerDeathPendingFixtureHealthy(fixture);
        fixture.gameSystem.destroy();
    });

    await t.test('resolved projectile exact handle은 Tower death 뒤에도 유지되고 이동한다', () => {
        const fixture = prepareCustomArcherAtFiveTowerHp();
        advanceThrough(fixture.gameSystem, fixture.shotTick - 1);
        assert.equal(fixture.gameSystem.fixedUpdate(), true);
        assert.equal(fixture.gameSystem.fixedUpdate(), true);
        const resolvedShot = fixture.backend.materializedShots.find(({ sourceTick }) => (
            sourceTick === fixture.shotTick
        ));
        assert.equal(resolvedShot?.outcome, 'resolved');
        const projectileHandle = resolvedShot.destinationHandle;
        const projectilePositionBeforeDeath = copyVector(
            fixture.backend.bodies.get(handleKey(projectileHandle)).position
        );
        const acceptedAtDeath = fixture.gameSystem.getHostileAttackStatus()
            .shotRequestAcceptedCount;
        fixture.backend.queueTowerDamageEvents(
            projectileHandle,
            fixture.towerHandle,
            fixture.gameSystem.getFixedTick(),
            true
        );
        assert.equal(fixture.gameSystem.fixedUpdate(), true);
        assertTowerDeathPendingFixtureHealthy(fixture);
        advanceThrough(fixture.gameSystem, fixture.gameSystem.getFixedTick() + 5);
        assert.equal(fixture.registry.has(projectileHandle), true);
        assert.equal(fixture.backend.hasBody(projectileHandle), true);
        const projectilePositionAfterDeath = fixture.backend.bodies.get(
            handleKey(projectileHandle)
        ).position;
        assert.ok(Math.hypot(
            projectilePositionAfterDeath.x - projectilePositionBeforeDeath.x,
            projectilePositionAfterDeath.y - projectilePositionBeforeDeath.y
        ) > 0);
        assert.equal(
            fixture.gameSystem.getHostileAttackStatus().shotRequestAcceptedCount,
            acceptedAtDeath
        );
        assertTowerDeathPendingFixtureHealthy(fixture);
        fixture.gameSystem.destroy();
    });
});

test('custom Archer는 lifecycle roster와 completion 기반 cooldown으로 Tower만 공격하고 death 뒤 route를 계속 간다', () => {
    const inputState = { moveRight: true, primaryPressed: false };
    const backends = [];
    const gameSystem = new GameSystem(
        createDependencies(backends, inputState),
        { waveDefinition: CUSTOM_ARCHER_WAVE }
    );
    assert.equal(gameSystem.enter(), true);
    const objectSystem = gameSystem.getObjectSystem();
    const endpoint = gameSystem.getGpuSimulationEndpoint();
    const registry = endpoint.getRegistry();
    const coreIntegrity = gameSystem.getCoreIntegrity();
    const initialCoreIntegrity = coreIntegrity.getCurrentIntegrity();
    const backend = backends[0];

    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(gameSystem.getFixedTick(), 1);
    let hostileStatus = gameSystem.getHostileAttackStatus();
    assert.equal(hostileStatus.activeArcherCount, 1);
    assert.equal(hostileStatus.pendingShotCount, 0);
    assert.equal(hostileStatus.shotStartAttemptCount, 0);
    assert.equal(hostileStatus.shotResolvedCount, 0);
    const archerStatusAtSpawn = hostileStatus.archers[0];
    const archerHandle = archerStatusAtSpawn.handle;
    const towerHandle = objectSystem.getGpuWorldActorStatus().towerHandle;
    const towerPositionAtArcherSpawn = copyVector(
        backend.bodies.get(handleKey(towerHandle)).position
    );
    const firstEligibleTick = archerStatusAtSpawn.nextEligibleFixedTick;
    assert.ok(firstEligibleTick > 1);
    assert.equal(archerStatusAtSpawn.createdAtTick, 1);
    assert.equal(findArcherStatus(hostileStatus, archerHandle).shotSequence, 0);

    backend.rejectSpawnProgramTicks.add(firstEligibleTick);
    advanceThrough(gameSystem, firstEligibleTick - 1);
    hostileStatus = gameSystem.getHostileAttackStatus();
    assert.equal(hostileStatus.shotStartAttemptCount, 0);
    assert.equal(hostileStatus.pendingShotCount, 0);
    const playerStatusBeforePressure = objectSystem.primaryProjectileController
        .getStatus();
    const playerMaterializationsBeforePressure = backend.materializedShots.filter(
        ({ definitionId }) => definitionId === BASIC_BULLET_PROJECTILE_DATA.id
    ).length;
    assert.equal(playerStatusBeforePressure.shotSequence, 0);
    assert.equal(playerStatusBeforePressure.pendingShot, null);
    inputState.primaryPressed = true;

    assert.equal(gameSystem.fixedUpdate(), true);
    hostileStatus = gameSystem.getHostileAttackStatus();
    assert.equal(hostileStatus.shotStartAttemptCount, 1);
    assert.equal(hostileStatus.pendingShotCount, 0);
    assert.equal(hostileStatus.shotResolvedCount, 0);
    assert.equal(hostileStatus.telemetry.fixedRejected, 1);
    assert.equal(
        findArcherStatus(hostileStatus, archerHandle).nextEligibleFixedTick,
        firstEligibleTick
    );
    const rejectedCommandId = hostileStatus.lastStageResult.commandIds[0];
    assert.equal(rejectedCommandId, [
        HOSTILE_ATTACK_COMMAND_NAMESPACE,
        hostileStatus.sessionGeneration,
        archerHandle.entityId,
        archerHandle.incarnation,
        towerHandle.entityId,
        towerHandle.incarnation,
        firstEligibleTick,
        0,
        ARCHER_ATTACK_DATA.id
    ].join(':'));
    const pressurePlan = backend.fixedPlans.find(({ targetFixedTick }) => (
        targetFixedTick === firstEligibleTick
    ));
    assert.equal(pressurePlan.spawnRejected, true);
    assert.equal(pressurePlan.controls.length, 1);
    assert.equal(endpoint.getStatus().reservedCount, 0);
    assert.equal(gameSystem.isGpuWorldRecoveryRequired(), false);
    const playerStatusAfterPressure = objectSystem.primaryProjectileController
        .getStatus();
    assert.equal(
        playerStatusAfterPressure.shotSequence,
        playerStatusBeforePressure.shotSequence
    );
    assert.equal(playerStatusAfterPressure.pendingShot, null);
    assert.equal(
        backend.materializedShots.filter(
            ({ definitionId }) => definitionId === BASIC_BULLET_PROJECTILE_DATA.id
        ).length,
        playerMaterializationsBeforePressure
    );

    const firstAcceptedTick = firstEligibleTick + 1;
    assert.equal(gameSystem.fixedUpdate(), true);
    hostileStatus = gameSystem.getHostileAttackStatus();
    assert.equal(hostileStatus.pendingShotCount, 1);
    assert.equal(hostileStatus.archers[0].state, 'GPU_RESOLVE_PENDING');
    assert.equal(hostileStatus.archers[0].shotSequence, 0);
    assert.equal(hostileStatus.shotResolvedCount, 0);
    const playerStatusAfterRetry = objectSystem.primaryProjectileController
        .getStatus();
    assert.equal(
        playerStatusAfterRetry.shotSequence,
        playerStatusBeforePressure.shotSequence + 1
    );
    assert.equal(playerStatusAfterRetry.pendingShot, null);
    assert.equal(
        playerStatusAfterRetry.lastCommittedShot.targetFixedTick,
        firstAcceptedTick
    );
    assert.equal(
        backend.materializedShots.filter(
            ({ definitionId }) => definitionId === BASIC_BULLET_PROJECTILE_DATA.id
        ).length,
        playerMaterializationsBeforePressure + 1
    );
    inputState.primaryPressed = false;
    const firstAcceptedCommandId = hostileStatus.lastStageResult.commandIds[0];
    assert.equal(firstAcceptedCommandId, [
        HOSTILE_ATTACK_COMMAND_NAMESPACE,
        hostileStatus.sessionGeneration,
        archerHandle.entityId,
        archerHandle.incarnation,
        towerHandle.entityId,
        towerHandle.incarnation,
        firstAcceptedTick,
        0,
        ARCHER_ATTACK_DATA.id
    ].join(':'));

    const firstShot = backend.materializedShots.find(({ sourceTick, definitionId }) => (
        sourceTick === firstAcceptedTick
            && definitionId === HOSTILE_BASIC_BULLET_DATA.id
    ));
    assert.ok(firstShot);
    assert.deepEqual({ ...firstShot.sourceHandle }, { ...archerHandle });
    assert.deepEqual({ ...firstShot.targetHandle }, { ...towerHandle });
    assert.deepEqual(firstShot.origin, firstShot.sourcePosition);
    const aimDx = firstShot.targetPosition.x - firstShot.origin.x;
    const aimDy = firstShot.targetPosition.y - firstShot.origin.y;
    const aimLength = Math.hypot(aimDx, aimDy);
    assertNear(firstShot.velocity.x, (aimDx / aimLength) * ARCHER_ATTACK_DATA.launchSpeed);
    assertNear(firstShot.velocity.y, (aimDy / aimLength) * ARCHER_ATTACK_DATA.launchSpeed);
    assertNear(Math.hypot(firstShot.velocity.x, firstShot.velocity.y), 12);
    assert.equal(firstShot.destinationSpawn.teamId, GAMEPLAY_TEAM_ID.HOSTILE);
    assert.equal(
        firstShot.destinationSpawn.targetPolicyId,
        PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN
    );
    assert.equal(firstShot.destinationSpawn.sourceEntityId, archerHandle.entityId);
    assert.equal(firstShot.destinationSpawn.sourceIncarnation, archerHandle.incarnation);
    assert.equal(firstShot.destinationSpawn.targetEntityId, towerHandle.entityId);
    assert.equal(firstShot.destinationSpawn.targetIncarnation, towerHandle.incarnation);
    assert.equal(firstShot.destinationSpawn.producerId, ARCHER_ATTACK_DATA.producerId);
    assert.equal(
        firstShot.destinationSpawn.sourceAbilityId,
        ARCHER_ATTACK_DATA.sourceAbilityId
    );

    assert.equal(gameSystem.fixedUpdate(), true);
    hostileStatus = gameSystem.getHostileAttackStatus();
    assert.equal(hostileStatus.pendingShotCount, 0);
    assert.equal(hostileStatus.shotResolvedCount, 1);
    assert.equal(hostileStatus.archers[0].shotSequence, 1);
    const secondEligibleTick = firstAcceptedTick + ARCHER_ATTACK_DATA.intervalTicks;
    assert.equal(hostileStatus.archers[0].nextEligibleFixedTick, secondEligibleTick);
    const firstHostileHandle = findProjectileHandleByDefinition(
        registry,
        HOSTILE_BASIC_BULLET_DATA.id
    );
    assert.ok(firstHostileHandle);
    const firstHostileView = registry.copyEntityView(firstHostileHandle, {});
    assert.equal(firstHostileView.metadata.teamId, GAMEPLAY_TEAM_ID.HOSTILE);
    assert.equal(firstHostileView.metadata.sourceEntityId, archerHandle.entityId);
    assert.equal(firstHostileView.metadata.ownerEntityId, archerHandle.entityId);
    assert.equal(firstHostileView.metadata.targetEntityId, towerHandle.entityId);
    assert.equal(firstHostileView.metadata.producerId, ARCHER_ATTACK_DATA.producerId);
    assert.ok(
        backend.bodies.get(handleKey(towerHandle)).position.x
            > towerPositionAtArcherSpawn.x
    );

    advanceThrough(gameSystem, secondEligibleTick - 1);
    assert.equal(gameSystem.getHostileAttackStatus().shotResolvedCount, 1);
    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(gameSystem.getHostileAttackStatus().pendingShotCount, 1);
    assert.equal(gameSystem.fixedUpdate(), true);
    hostileStatus = gameSystem.getHostileAttackStatus();
    assert.equal(hostileStatus.shotResolvedCount, 2);
    assert.equal(hostileStatus.archers[0].shotSequence, 2);
    const thirdEligibleTick = secondEligibleTick + ARCHER_ATTACK_DATA.intervalTicks;
    assert.equal(hostileStatus.archers[0].nextEligibleFixedTick, thirdEligibleTick);

    backend.targetInvalidHostileTicks.add(thirdEligibleTick);
    advanceThrough(gameSystem, thirdEligibleTick - 1);
    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(gameSystem.getHostileAttackStatus().pendingShotCount, 1);
    const invalidShot = backend.materializedShots.find(({ sourceTick, definitionId }) => (
        sourceTick === thirdEligibleTick
            && definitionId === HOSTILE_BASIC_BULLET_DATA.id
    ));
    assert.equal(invalidShot.outcome, 'target-invalid');
    assert.equal(gameSystem.fixedUpdate(), true);
    hostileStatus = gameSystem.getHostileAttackStatus();
    assert.equal(hostileStatus.pendingShotCount, 0);
    assert.equal(hostileStatus.shotResolvedCount, 2);
    assert.equal(hostileStatus.telemetry.completedTargetInvalid, 1);
    assert.equal(hostileStatus.archers[0].shotSequence, 2);
    assert.equal(hostileStatus.archers[0].nextEligibleFixedTick, thirdEligibleTick);
    assert.equal(endpoint.getStatus().reservedCount, 0);
    assert.equal(gameSystem.isGpuWorldRecoveryRequired(), false);

    const targetInvalidRetryTick = thirdEligibleTick + 2;
    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(gameSystem.getFixedTick(), targetInvalidRetryTick);
    assert.equal(gameSystem.getHostileAttackStatus().pendingShotCount, 1);
    assert.equal(gameSystem.fixedUpdate(), true);
    hostileStatus = gameSystem.getHostileAttackStatus();
    assert.equal(hostileStatus.pendingShotCount, 0);
    assert.equal(hostileStatus.shotResolvedCount, 3);
    assert.equal(hostileStatus.archers[0].shotSequence, 3);
    assert.equal(
        hostileStatus.archers[0].nextEligibleFixedTick,
        targetInvalidRetryTick + ARCHER_ATTACK_DATA.intervalTicks
    );

    assert.ok(backend.controlAcceptedCount > 0);
    assert.ok(backend.materializedShots.some(({ definitionId }) => (
        definitionId === BASIC_BULLET_PROJECTILE_DATA.id
    )));
    const towerHpSequence = [gameSystem.getTowerCombatStatus().currentHp];
    for (let hitIndex = 0; hitIndex < 6; hitIndex++) {
        backend.queueTowerDamageEvents(
            firstHostileHandle,
            towerHandle,
            gameSystem.getFixedTick(),
            hitIndex === 5
        );
        assert.equal(gameSystem.fixedUpdate(), true);
        towerHpSequence.push(gameSystem.getTowerCombatStatus().currentHp);
    }
    assert.deepEqual(towerHpSequence, [30, 25, 20, 15, 10, 5, 0]);
    assert.equal(gameSystem.getTowerCombatStatus().alive, false);
    assert.equal(objectSystem.getGpuWorldActorStatus().towerHandle, null);
    assert.equal(objectSystem.primaryProjectileController.getStatus().enabled, false);
    hostileStatus = gameSystem.getHostileAttackStatus();
    assert.equal(hostileStatus.pendingShotCount, 0);
    assert.equal(hostileStatus.activeArcherCount, 1);
    const attemptsAtTowerDeath = hostileStatus.shotStartAttemptCount;
    const requestAcceptedAtTowerDeath = hostileStatus.shotRequestAcceptedCount;
    const resolvedAtTowerDeath = hostileStatus.shotResolvedCount;
    const nextEligibleAtTowerDeath = hostileStatus.archers[0]
        .nextEligibleFixedTick;
    const hostileMaterializationCount = backend.materializedShots.filter(
        ({ definitionId }) => definitionId === HOSTILE_BASIC_BULLET_DATA.id
    ).length;
    const controlsAtTowerDeath = backend.controlAcceptedCount;
    const archerBody = backend.bodies.get(handleKey(archerHandle));
    const archerPositionAtTowerDeath = copyVector(archerBody.position);
    const fixedTickAtTowerDeath = gameSystem.getFixedTick();
    const postDeathTargetTick = Math.max(
        fixedTickAtTowerDeath + 5,
        nextEligibleAtTowerDeath + 1
    );

    advanceThrough(gameSystem, postDeathTargetTick);
    hostileStatus = gameSystem.getHostileAttackStatus();
    assert.equal(gameSystem.getFixedTick(), postDeathTargetTick);
    assert.equal(hostileStatus.shotStartAttemptCount, attemptsAtTowerDeath);
    assert.equal(
        hostileStatus.shotRequestAcceptedCount,
        requestAcceptedAtTowerDeath
    );
    assert.equal(hostileStatus.shotResolvedCount, resolvedAtTowerDeath);
    assert.equal(hostileStatus.pendingShotCount, 0);
    assert.ok(hostileStatus.telemetry.noTargetTicks >= 6);
    assert.equal(
        backend.materializedShots.filter(
            ({ definitionId }) => definitionId === HOSTILE_BASIC_BULLET_DATA.id
        ).length,
        hostileMaterializationCount
    );
    assert.equal(backend.controlAcceptedCount, controlsAtTowerDeath);
    assert.ok(
        Math.hypot(
            archerBody.position.x - archerPositionAtTowerDeath.x,
            archerBody.position.y - archerPositionAtTowerDeath.y
        ) > 0
    );
    assert.equal(coreIntegrity.getCurrentIntegrity(), initialCoreIntegrity);
    assert.equal(gameSystem.isGpuWorldRecoveryRequired(), false);
    assert.equal(hostileStatus.recoveryRequired, false);
    assert.equal(endpoint.getStatus().reservedCount, 0);
    assert.equal(endpoint.getStatus().pendingCommandCount, 0);
    assert.equal(backend.pendingFixedPlan, null);
    assert.equal(backend.spawnCompletionBatches.length, 0);
    assert.equal(backend.completedEventBatches.length, 0);

    const registryStatusBeforeDestroy = registry.getStatus();
    assert.ok(registryStatusBeforeDestroy.activeCount > 0);
    gameSystem.destroy();
    gameSystem.destroy();
    assert.equal(backend.destroyCount, 1);
    assert.equal(backend.bodies.size, 0);
    assert.equal(registry.getStatus().destroyed, true);
    assert.equal(registry.getStatus().activeCount, 0);
    assert.equal(registry.getStatus().reservedCount, 0);
});

test('pending Archer shot recovery는 failed replacement를 원자적으로 보존하고 새 session에서 stale completion을 격리한다', () => {
    const inputState = { moveRight: false, primaryPressed: false };
    const backendInitResults = [true, FAILED_REPLACEMENT_BACKEND_INIT, true];
    const backends = [];
    const gameSystem = new GameSystem(
        createDependencies(backends, inputState, backendInitResults),
        { waveDefinition: CUSTOM_ARCHER_WAVE }
    );
    assert.equal(gameSystem.enter(), true);
    assert.equal(backends.length, 1);
    const objectSystem = gameSystem.getObjectSystem();
    const oldEndpoint = gameSystem.getGpuSimulationEndpoint();
    const oldRegistry = oldEndpoint.getRegistry();
    const oldBackend = backends[0];
    const oldDirector = objectSystem.hostileAttackDirector;

    assert.equal(gameSystem.fixedUpdate(), true);
    let hostileStatus = gameSystem.getHostileAttackStatus();
    assert.equal(hostileStatus.activeArcherCount, 1);
    const firstEligibleTick = hostileStatus.archers[0].nextEligibleFixedTick;
    advanceThrough(gameSystem, firstEligibleTick);
    hostileStatus = gameSystem.getHostileAttackStatus();
    assert.equal(hostileStatus.pendingShotCount, 1);
    assert.equal(hostileStatus.archers[0].shotSequence, 0);

    assert.equal(gameSystem.fixedUpdate(), true);
    hostileStatus = gameSystem.getHostileAttackStatus();
    assert.equal(hostileStatus.pendingShotCount, 0);
    assert.equal(hostileStatus.shotResolvedCount, 1);
    assert.equal(hostileStatus.archers[0].shotSequence, 1);
    const firstHostileHandle = findProjectileHandleByDefinition(
        oldRegistry,
        HOSTILE_BASIC_BULLET_DATA.id
    );
    const oldTowerHandle = objectSystem.getGpuWorldActorStatus().towerHandle;
    assert.ok(firstHostileHandle);
    assert.ok(oldTowerHandle);

    oldBackend.queueTowerDamageEvents(
        firstHostileHandle,
        oldTowerHandle,
        gameSystem.getFixedTick(),
        false
    );
    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(gameSystem.getTowerCombatStatus().alive, true);
    assert.equal(gameSystem.getTowerCombatStatus().currentHp, 25);

    const secondEligibleTick = gameSystem.getHostileAttackStatus()
        .archers[0].nextEligibleFixedTick;
    advanceThrough(gameSystem, secondEligibleTick - 1);
    assert.equal(gameSystem.fixedUpdate(), true);
    const pendingStatusBeforeRecovery = gameSystem.getHostileAttackStatus();
    assert.equal(pendingStatusBeforeRecovery.activeArcherCount, 1);
    assert.equal(pendingStatusBeforeRecovery.pendingShotCount, 1);
    assert.equal(pendingStatusBeforeRecovery.archers[0].shotSequence, 1);
    assert.equal(oldBackend.spawnCompletionBatches.length, 1);
    assert.equal(oldEndpoint.getStatus().reservedCount, 1);
    const oldPendingShot = pendingStatusBeforeRecovery.pendingShots[0];
    const oldCompletionOutcome = oldBackend.spawnCompletionBatches[0]
        .outcomes[0];
    const oldSessionCompletion = Object.freeze({
        commandId: oldPendingShot.commandId,
        outcome: oldCompletionOutcome.reason,
        sourceHandle: oldCompletionOutcome.sourceHandle,
        targetHandle: oldCompletionOutcome.targetHandle,
        destinationHandle: oldCompletionOutcome.destinationHandle
    });

    assert.equal(gameSystem.restartGpuWorldAtSafeWaveBoundary(), false);
    assert.equal(backends.length, 2);
    assert.equal(backends[1].initCount, 1);
    assert.equal(backends[1].destroyCount, 1);
    assert.strictEqual(gameSystem.getGpuSimulationEndpoint(), oldEndpoint);
    assert.strictEqual(objectSystem.getWorldRegistry(), oldRegistry);
    assert.strictEqual(objectSystem.getEnemySimulationBackend(), oldBackend);
    assert.strictEqual(objectSystem.hostileAttackDirector, oldDirector);
    assert.equal(oldBackend.destroyCount, 0);
    assert.equal(oldDirector.getStatus().destroyed, false);
    const pendingStatusAfterFailedRecovery = gameSystem.getHostileAttackStatus();
    assert.deepEqual(
        pendingStatusAfterFailedRecovery.archers,
        pendingStatusBeforeRecovery.archers
    );
    assert.deepEqual(
        pendingStatusAfterFailedRecovery.pendingShots,
        pendingStatusBeforeRecovery.pendingShots
    );
    assert.equal(oldBackend.spawnCompletionBatches.length, 1);
    assert.equal(oldEndpoint.getStatus().reservedCount, 1);
    assert.equal(gameSystem.getTowerCombatStatus().currentHp, 25);
    assert.equal(gameSystem.isGpuWorldRecoveryRequired(), false);

    assert.equal(gameSystem.restartGpuWorldAtSafeWaveBoundary(), true);
    assert.equal(backends.length, 3);
    const newBackend = backends[2];
    const newEndpoint = gameSystem.getGpuSimulationEndpoint();
    const newDirector = objectSystem.hostileAttackDirector;
    assert.notStrictEqual(newEndpoint, oldEndpoint);
    assert.notStrictEqual(newDirector, oldDirector);
    assert.ok(
        newEndpoint.getStatus().sessionGeneration
            > pendingStatusBeforeRecovery.sessionGeneration
    );
    assert.equal(backends[1].destroyCount, 1);
    assert.equal(oldBackend.destroyCount, 1);
    assert.equal(oldBackend.bodies.size, 0);
    assert.equal(oldBackend.spawnCompletionBatches.length, 0);
    assert.equal(oldEndpoint.getStatus().destroyed, true);
    assert.equal(oldDirector.getStatus().destroyed, true);
    assert.equal(oldDirector.getStatus().activeArcherCount, 0);
    assert.equal(oldDirector.getStatus().pendingShotCount, 0);
    hostileStatus = gameSystem.getHostileAttackStatus();
    assert.equal(hostileStatus.activeArcherCount, 0);
    assert.equal(hostileStatus.pendingShotCount, 0);
    assert.equal(hostileStatus.shotStartAttemptCount, 0);
    assert.equal(hostileStatus.shotResolvedCount, 0);
    assert.equal(newEndpoint.getStatus().reservedCount, 0);
    assert.equal(gameSystem.getTowerCombatStatus().alive, true);
    assert.equal(gameSystem.getTowerCombatStatus().currentHp, 25);
    assert.equal(gameSystem.getTowerCombatStatus().boundGpuBody, null);

    assert.equal(gameSystem.fixedUpdate(), true);
    hostileStatus = gameSystem.getHostileAttackStatus();
    assert.equal(hostileStatus.activeArcherCount, 1);
    assert.equal(hostileStatus.pendingShotCount, 0);
    assert.equal(hostileStatus.shotResolvedCount, 0);
    assert.equal(hostileStatus.archers[0].shotSequence, 0);
    assert.equal(hostileStatus.archers[0].state, 'IDLE');
    assert.equal(gameSystem.getTowerCombatStatus().alive, true);
    assert.equal(gameSystem.getTowerCombatStatus().currentHp, 25);
    assert.equal(
        gameSystem.getTowerCombatStatus().boundGpuBody.sessionGeneration,
        newEndpoint.getStatus().sessionGeneration
    );

    const staleSummary = newDirector.observeFixedCommit({
        fixedTick: gameSystem.getFixedTick(),
        fixedCommands: {
            state: 'committed',
            completed: [oldSessionCompletion],
            sourceRelativeSpawns: [],
            rejected: [],
            protocolFailure: null,
            recoveryRequired: false
        },
        spawned: [],
        despawned: []
    }, gameSystem.getFixedTick());
    assert.equal(staleSummary.staleResultCount, 1);
    assert.equal(staleSummary.completedCount, 0);
    hostileStatus = gameSystem.getHostileAttackStatus();
    assert.equal(hostileStatus.activeArcherCount, 1);
    assert.equal(hostileStatus.pendingShotCount, 0);
    assert.equal(hostileStatus.shotResolvedCount, 0);
    assert.equal(hostileStatus.archers[0].shotSequence, 0);
    assert.equal(hostileStatus.telemetry.staleOldSessionResults, 1);
    assert.equal(hostileStatus.recoveryRequired, false);
    assert.equal(gameSystem.isGpuWorldRecoveryRequired(), false);

    gameSystem.destroy();
    gameSystem.destroy();
    assert.equal(newBackend.destroyCount, 1);
    assert.equal(newBackend.bodies.size, 0);
    assert.equal(newDirector.getStatus().destroyed, true);
});

test('production wave alive recovery는 HP와 failed replacement를 보존하고 새 Archer를 sequence 0으로 재등록한다', () => {
    const inputState = { moveRight: false, primaryPressed: false };
    const backendInitResults = [true, FAILED_REPLACEMENT_BACKEND_INIT, true];
    const backends = [];
    const gameSystem = new GameSystem(
        createDependencies(backends, inputState, backendInitResults)
    );
    assert.equal(gameSystem.enter(), true);
    const objectSystem = gameSystem.getObjectSystem();
    const coreIntegrity = gameSystem.getCoreIntegrity();
    const initialCoreIntegrity = coreIntegrity.getCurrentIntegrity();
    const oldEndpoint = gameSystem.getGpuSimulationEndpoint();
    const oldRegistry = oldEndpoint.getRegistry();
    const oldBackend = backends[0];
    const oldDirector = objectSystem.hostileAttackDirector;

    advanceThrough(gameSystem, 31);
    let hostileStatus = gameSystem.getHostileAttackStatus();
    assert.equal(hostileStatus.activeArcherCount, 1);
    const firstArcherHandle = hostileStatus.archers[0].handle;
    advanceThrough(gameSystem, hostileStatus.archers[0].nextEligibleFixedTick);
    assert.equal(gameSystem.getHostileAttackStatus().pendingShotCount, 1);
    assert.equal(gameSystem.fixedUpdate(), true);
    hostileStatus = gameSystem.getHostileAttackStatus();
    assert.equal(hostileStatus.shotResolvedCount, 1);
    const firstHostileHandle = findProjectileHandleByDefinition(
        oldRegistry,
        HOSTILE_BASIC_BULLET_DATA.id
    );
    const oldTowerHandle = objectSystem.getGpuWorldActorStatus().towerHandle;
    assert.ok(firstHostileHandle);
    assert.ok(oldTowerHandle);

    oldBackend.queueTowerDamageEvents(
        firstHostileHandle,
        oldTowerHandle,
        gameSystem.getFixedTick(),
        false
    );
    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(gameSystem.getTowerCombatStatus().alive, true);
    assert.equal(gameSystem.getTowerCombatStatus().currentHp, 25);
    assert.equal(coreIntegrity.getCurrentIntegrity(), initialCoreIntegrity);

    const firstRecord = findArcherStatus(
        gameSystem.getHostileAttackStatus(),
        firstArcherHandle
    );
    advanceThrough(gameSystem, firstRecord.nextEligibleFixedTick - 1);
    assert.equal(gameSystem.fixedUpdate(), true);
    const pendingStatusBeforeRecovery = gameSystem.getHostileAttackStatus();
    assert.equal(pendingStatusBeforeRecovery.activeArcherCount, 4);
    assert.ok(pendingStatusBeforeRecovery.pendingShotCount >= 1);
    const firstPending = pendingStatusBeforeRecovery.pendingShots.find(
        ({ sourceHandle }) => handleKey(sourceHandle) === handleKey(firstArcherHandle)
    );
    assert.ok(firstPending);
    const oldCompletionBatch = oldBackend.spawnCompletionBatches[0];
    const oldCompletionOutcome = oldCompletionBatch.outcomes.find(
        ({ destinationHandle }) => (
            handleKey(destinationHandle) === handleKey(firstPending.destinationHandle)
        )
    );
    assert.ok(oldCompletionOutcome);
    const oldSessionCompletion = Object.freeze({
        commandId: firstPending.commandId,
        outcome: oldCompletionOutcome.reason,
        sourceHandle: oldCompletionOutcome.sourceHandle,
        targetHandle: oldCompletionOutcome.targetHandle,
        destinationHandle: oldCompletionOutcome.destinationHandle
    });
    const oldRoster = pendingStatusBeforeRecovery.archers;
    const oldPendingShots = pendingStatusBeforeRecovery.pendingShots;

    assert.equal(gameSystem.restartGpuWorldAtSafeWaveBoundary(), false);
    assert.equal(backends.length, 2);
    assert.equal(backends[1].destroyCount, 1);
    assert.strictEqual(gameSystem.getGpuSimulationEndpoint(), oldEndpoint);
    assert.strictEqual(objectSystem.getWorldRegistry(), oldRegistry);
    assert.strictEqual(objectSystem.getEnemySimulationBackend(), oldBackend);
    assert.strictEqual(objectSystem.hostileAttackDirector, oldDirector);
    assert.equal(oldBackend.destroyCount, 0);
    hostileStatus = gameSystem.getHostileAttackStatus();
    assert.deepEqual(hostileStatus.archers, oldRoster);
    assert.deepEqual(hostileStatus.pendingShots, oldPendingShots);
    assert.equal(gameSystem.getTowerCombatStatus().currentHp, 25);
    assert.equal(gameSystem.getTowerCombatStatus().alive, true);
    assert.equal(coreIntegrity.getCurrentIntegrity(), initialCoreIntegrity);
    assert.equal(gameSystem.isGpuWorldRecoveryRequired(), false);

    const recoveryOffset = gameSystem.getFixedTick();
    assert.equal(gameSystem.restartGpuWorldAtSafeWaveBoundary(), true);
    const newBackend = backends[2];
    const newEndpoint = gameSystem.getGpuSimulationEndpoint();
    const newDirector = objectSystem.hostileAttackDirector;
    assert.notStrictEqual(newEndpoint, oldEndpoint);
    assert.notStrictEqual(newDirector, oldDirector);
    assert.equal(oldBackend.destroyCount, 1);
    assert.equal(oldRegistry.getStatus().destroyed, true);
    assert.equal(oldDirector.getStatus().destroyed, true);
    assert.equal(gameSystem.getTowerCombatStatus().currentHp, 25);
    assert.equal(gameSystem.getTowerCombatStatus().boundGpuBody, null);
    assert.equal(gameSystem.getHostileAttackStatus().activeArcherCount, 0);

    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(gameSystem.getTowerCombatStatus().currentHp, 25);
    assert.equal(gameSystem.getTowerCombatStatus().alive, true);
    assert.equal(
        gameSystem.getTowerCombatStatus().boundGpuBody.sessionGeneration,
        newEndpoint.getStatus().sessionGeneration
    );
    assert.equal(gameSystem.getHostileAttackStatus().activeArcherCount, 0);
    advanceThrough(gameSystem, recoveryOffset + 31);
    hostileStatus = gameSystem.getHostileAttackStatus();
    assert.equal(hostileStatus.activeArcherCount, 1);
    assert.equal(hostileStatus.archers[0].createdAtTick, recoveryOffset + 31);
    assert.equal(hostileStatus.archers[0].shotSequence, 0);
    assert.equal(hostileStatus.archers[0].state, 'IDLE');
    assert.equal(hostileStatus.pendingShotCount, 0);
    assert.equal(hostileStatus.shotResolvedCount, 0);
    assert.equal(objectSystem.getEnemyWaveStatus().queuedSpawnCount, 7);
    assert.equal(gameSystem.getTowerCombatStatus().currentHp, 25);
    assert.strictEqual(gameSystem.getCoreIntegrity(), coreIntegrity);
    assert.equal(coreIntegrity.getCurrentIntegrity(), initialCoreIntegrity);

    const staleSummary = newDirector.observeFixedCommit({
        fixedTick: gameSystem.getFixedTick(),
        fixedCommands: {
            state: 'committed',
            completed: [oldSessionCompletion],
            sourceRelativeSpawns: [],
            rejected: [],
            protocolFailure: null,
            recoveryRequired: false
        },
        spawned: [],
        despawned: []
    }, gameSystem.getFixedTick());
    assert.equal(staleSummary.staleResultCount, 1);
    assert.equal(staleSummary.completedCount, 0);
    hostileStatus = gameSystem.getHostileAttackStatus();
    assert.equal(hostileStatus.activeArcherCount, 1);
    assert.equal(hostileStatus.archers[0].shotSequence, 0);
    assert.equal(hostileStatus.pendingShotCount, 0);
    assert.equal(hostileStatus.telemetry.staleOldSessionResults, 1);
    assert.equal(gameSystem.isGpuWorldRecoveryRequired(), false);

    gameSystem.destroy();
    gameSystem.destroy();
    assert.equal(newBackend.destroyCount, 1);
});

test('production 32-spawn wave의 Archer 4기는 Tower death 뒤에도 route를 계속하고 dead recovery에서 target 없이 재등록된다', () => {
    const inputState = { moveRight: true, primaryPressed: false };
    const backends = [];
    const scene = new GameSceneLikeHarness(
        createDependencies(backends, inputState)
    );
    const gameSystem = scene.getGameSystem();
    const objectSystem = gameSystem.getObjectSystem();
    const endpoint = gameSystem.getGpuSimulationEndpoint();
    const registry = endpoint.getRegistry();
    const backend = backends[0];
    const coreIntegrity = gameSystem.getCoreIntegrity();
    const initialCoreIntegrity = coreIntegrity.getCurrentIntegrity();
    const initialCoreMaximum = coreIntegrity.getMaxIntegrity();

    advanceThrough(gameSystem, 31);
    let hostileStatus = gameSystem.getHostileAttackStatus();
    assert.equal(hostileStatus.activeArcherCount, 1);
    const firstArcherAtSpawn = hostileStatus.archers[0];
    const firstArcherHandle = firstArcherAtSpawn.handle;
    const firstEligibleFixedTick = firstArcherAtSpawn.nextEligibleFixedTick;
    const towerHandle = objectSystem.getGpuWorldActorStatus().towerHandle;
    assert.equal(firstArcherAtSpawn.createdAtTick, 31);
    assert.equal(
        firstArcherAtSpawn.phaseOffsetTicks,
        computeHostileAttackPhaseOffset({
            ...firstArcherHandle,
            phaseSpreadTicks: ARCHER_ATTACK_DATA.phaseSpreadTicks
        })
    );
    assert.equal(
        firstEligibleFixedTick,
        firstArcherAtSpawn.createdAtTick
            + ARCHER_ATTACK_DATA.initialDelayTicks
            + firstArcherAtSpawn.phaseOffsetTicks
    );
    assert.ok(firstEligibleFixedTick >= 61 && firstEligibleFixedTick <= 90);
    const firstArcherPositionAtSpawn = copyVector(
        backend.bodies.get(handleKey(firstArcherHandle)).position
    );

    advanceThrough(gameSystem, firstEligibleFixedTick - 1);
    const firstArcherPositionBeforeAttack = copyVector(
        backend.bodies.get(handleKey(firstArcherHandle)).position
    );
    assert.ok(
        Math.hypot(
            firstArcherPositionBeforeAttack.x - firstArcherPositionAtSpawn.x,
            firstArcherPositionBeforeAttack.y - firstArcherPositionAtSpawn.y
        ) > 0
    );

    const controlCountBeforePressure = backend.controlAcceptedCount;
    const fixedCountBeforePressure = backend.fixedUpdateCount;
    backend.rejectSpawnProgramTicks.add(firstEligibleFixedTick);
    inputState.primaryPressed = true;
    assert.equal(gameSystem.fixedUpdate(), true);
    hostileStatus = gameSystem.getHostileAttackStatus();
    assert.equal(gameSystem.getFixedTick(), firstEligibleFixedTick);
    assert.equal(hostileStatus.telemetry.fixedRejected, 1);
    assert.equal(hostileStatus.pendingShotCount, 0);
    assert.equal(hostileStatus.archers.find(({ handle }) => (
        handleKey(handle) === handleKey(firstArcherHandle)
    )).shotSequence, 0);
    assert.equal(backend.controlAcceptedCount, controlCountBeforePressure + 1);
    assert.equal(backend.fixedUpdateCount, fixedCountBeforePressure + 1);
    assert.equal(endpoint.getStatus().reservedCount, 0);
    assert.equal(gameSystem.isGpuWorldRecoveryRequired(), false);

    const firstAcceptedFixedTick = firstEligibleFixedTick + 1;
    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(gameSystem.getFixedTick(), firstAcceptedFixedTick);
    assert.equal(gameSystem.getHostileAttackStatus().pendingShotCount, 1);
    inputState.primaryPressed = false;
    assert.equal(gameSystem.fixedUpdate(), true);
    hostileStatus = gameSystem.getHostileAttackStatus();
    assert.equal(hostileStatus.pendingShotCount, 0);
    assert.equal(hostileStatus.shotResolvedCount >= 1, true);
    const firstHostileShot = backend.materializedShots.find((shot) => (
        shot.definitionId === HOSTILE_BASIC_BULLET_DATA.id
            && handleKey(shot.sourceHandle) === handleKey(firstArcherHandle)
            && shot.sourceTick === firstAcceptedFixedTick
    ));
    assert.ok(firstHostileShot);
    assert.deepEqual({ ...firstHostileShot.targetHandle }, { ...towerHandle });
    assert.equal(firstHostileShot.destinationSpawn.teamId, GAMEPLAY_TEAM_ID.HOSTILE);
    assert.equal(
        firstHostileShot.destinationSpawn.targetPolicyId,
        PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN
    );
    assertNear(
        Math.hypot(firstHostileShot.velocity.x, firstHostileShot.velocity.y),
        ARCHER_ATTACK_DATA.launchSpeed
    );
    const playerProjectileHandle = findProjectileHandleByDefinition(
        registry,
        BASIC_BULLET_PROJECTILE_DATA.id
    );
    assert.ok(playerProjectileHandle, 'pressure retry 뒤 Player projectile이 materialize되어야 합니다.');

    advanceThrough(gameSystem, 156);
    hostileStatus = gameSystem.getHostileAttackStatus();
    const productionArchers = [...hostileStatus.archers].sort((left, right) => (
        left.createdAtTick - right.createdAtTick
    ));
    assert.equal(objectSystem.getEnemyWaveStatus().totalSpawnCount, 32);
    assert.equal(objectSystem.getEnemyWaveStatus().queuedSpawnCount, 32);
    assert.equal(objectSystem.getEnemyWaveStatus().remainingSpawnCount, 0);
    assert.equal(registry.getActiveCount('enemy'), 32);
    assert.equal(productionArchers.length, 4);
    assert.deepEqual(
        productionArchers.map(({ createdAtTick }) => createdAtTick),
        [31, 66, 101, 136]
    );
    for (const record of productionArchers) {
        const expectedPhase = computeHostileAttackPhaseOffset({
            ...record.handle,
            phaseSpreadTicks: ARCHER_ATTACK_DATA.phaseSpreadTicks
        });
        assert.equal(record.phaseOffsetTicks, expectedPhase);
        assert.ok(
            record.createdAtTick + ARCHER_ATTACK_DATA.initialDelayTicks
                + expectedPhase
                >= record.createdAtTick + 30
        );
        const view = registry.copyEntityView(record.handle, {});
        assert.equal(view.definitionId, ARCHER_ENEMY_DATA.id);
        assert.equal(view.kindId, 'enemy');
        assert.equal(typeof view.metadata.pathId, 'string');
    }
    assert.equal(
        registry.copyActiveHandlesInto([], { kindId: 'enemy' })
            .filter((handle) => (
                registry.copyEntityView(handle, {})?.definitionId
                    === ARCHER_ENEMY_DATA.id
            )).length,
        4
    );

    const firstArcherShots = () => backend.materializedShots.filter((shot) => (
        shot.definitionId === HOSTILE_BASIC_BULLET_DATA.id
            && handleKey(shot.sourceHandle) === handleKey(firstArcherHandle)
    ));
    const hostileShots = () => backend.materializedShots.filter((shot) => (
        shot.definitionId === HOSTILE_BASIC_BULLET_DATA.id
            && shot.outcome === 'resolved'
    ));
    while ((hostileShots().length < 6 || firstArcherShots().length < 2)
        && gameSystem.getFixedTick() < 260) {
        assert.equal(gameSystem.fixedUpdate(), true);
    }
    assert.ok(hostileShots().length >= 6);
    assert.ok(firstArcherShots().length >= 2);
    assert.deepEqual(
        firstArcherShots().slice(0, 2).map(({ sourceTick }) => sourceTick),
        [
            firstAcceptedFixedTick,
            firstAcceptedFixedTick + ARCHER_ATTACK_DATA.intervalTicks
        ]
    );
    assert.equal(gameSystem.isGpuWorldRecoveryRequired(), false);

    const camera = objectSystem.getWorldViewProjection();
    const cameraController = gameSystem.getCameraZoomController();
    const cameraFollowTarget = objectSystem.getCameraFollowTarget();
    const corePosition = copyVector(objectSystem.getCore().position);
    inputState.moveRight = false;
    const towerBodyBeforeDeath = backend.bodies.get(handleKey(towerHandle));
    const authoredTowerPosition = objectSystem.getTileMap()
        .getTowerSpawnPosition();
    towerBodyBeforeDeath.position.x = authoredTowerPosition.x;
    towerBodyBeforeDeath.position.y = authoredTowerPosition.y;
    towerBodyBeforeDeath.velocity.x = 0;
    towerBodyBeforeDeath.velocity.y = 0;
    const archerHandleKeys = new Set(productionArchers.map(({ handle }) => (
        handleKey(handle)
    )));
    const cameraVisibilityHandles = registry
        .copyActiveHandlesInto([], { kindId: 'enemy' })
        .filter((handle) => !archerHandleKeys.has(handleKey(handle)))
        .slice(0, 2);
    assert.equal(cameraVisibilityHandles.length, 2);
    const towerCameraEnemy = backend.bodies.get(
        handleKey(cameraVisibilityHandles[0])
    );
    towerCameraEnemy.position.x = authoredTowerPosition.x;
    towerCameraEnemy.position.y = authoredTowerPosition.y;
    towerCameraEnemy.velocity.x = 0;
    towerCameraEnemy.velocity.y = 0;
    const coreCameraEnemy = backend.bodies.get(
        handleKey(cameraVisibilityHandles[1])
    );
    coreCameraEnemy.position.x = corePosition.x;
    coreCameraEnemy.position.y = corePosition.y;
    coreCameraEnemy.velocity.x = 0;
    coreCameraEnemy.velocity.y = 0;
    const towerPositionBeforeDeath = copyVector(
        towerBodyBeforeDeath.position
    );
    const endpointStatusBeforeDeath = endpoint.getStatus();
    const worldBounds = objectSystem.getTileMap().getWorldBounds();
    const expectedTowerCameraCenter = Object.freeze({
        x: Math.max(0, Math.min(worldBounds.width, towerPositionBeforeDeath.x)),
        y: Math.max(0, Math.min(worldBounds.height, towerPositionBeforeDeath.y))
    });
    const enemyHandlesBeforeDeath = registry
        .copyActiveHandlesInto([], { kindId: 'enemy' })
        .map(handleKey)
        .sort();
    assert.equal(enemyHandlesBeforeDeath.length, 32);
    camera.zoom = 3;
    cameraController.targetZoom = 3;
    cameraController.followBlend = 1;
    cameraController.targetFollowBlend = 1;
    cameraController.followPosition.x = towerPositionBeforeDeath.x;
    cameraController.followPosition.y = towerPositionBeforeDeath.y;
    cameraController.hasFollowPosition = true;
    camera.centerOnWorldPoint(
        towerPositionBeforeDeath.x,
        towerPositionBeforeDeath.y,
        1
    );
    scene.draw();
    const drawBeforeDeath = backend.drawSnapshots.at(-1);
    assert.deepEqual(
        drawBeforeDeath.renderedEnemyHandles.map(handleKey).sort(),
        enemyHandlesBeforeDeath
    );
    assert.ok(drawBeforeDeath.visibleEnemyHandles.length > 0);
    assert.ok(drawBeforeDeath.visibleEnemyHandles.some((handle) => (
        handleKey(handle) === handleKey(cameraVisibilityHandles[0])
    )));
    assertCameraDrawSnapshot(
        drawBeforeDeath,
        expectedTowerCameraCenter,
        camera.getScale()
    );

    const hostileEnemyHealthBefore = new Map(
        registry.copyActiveHandlesInto([], { kindId: 'enemy' }).map((handle) => (
            [handleKey(handle), backend.bodies.get(handleKey(handle)).health]
        ))
    );
    const towerHpTimeline = [gameSystem.getTowerCombatStatus().currentHp];
    const committedFactTypes = [];
    for (let hitIndex = 0; hitIndex < 6; hitIndex++) {
        const shot = hostileShots()[hitIndex];
        backend.queueTowerDamageEvents(
            shot.destinationHandle,
            towerHandle,
            gameSystem.getFixedTick(),
            hitIndex === 5
        );
        assert.equal(gameSystem.fixedUpdate(), true);
        towerHpTimeline.push(gameSystem.getTowerCombatStatus().currentHp);
        committedFactTypes.push(...objectSystem.getGpuWorldActorStatus()
            .lastTowerCombatFacts.map(({ type }) => type));
    }
    assert.deepEqual(towerHpTimeline, [30, 25, 20, 15, 10, 5, 0]);
    assert.equal(gameSystem.getTowerCombatStatus().alive, false);
    assert.equal(gameSystem.getTowerCombatStatus().livingTowerCount, 0);
    assert.equal(
        committedFactTypes.filter((type) => type === 'TowerDied').length,
        1
    );
    assert.equal(
        committedFactTypes.filter((type) => type === 'NoLivingTowers').length,
        1
    );
    assert.equal(
        committedFactTypes.filter((type) => type === 'RunFailed').length,
        0
    );
    for (const [key, health] of hostileEnemyHealthBefore) {
        assert.equal(
            backend.bodies.get(key)?.health,
            health,
            `HOSTILE projectile가 HOSTILE enemy ${key}를 피해선 안 됩니다.`
        );
    }
    assert.equal(coreIntegrity.getCurrentIntegrity(), initialCoreIntegrity);
    assert.equal(coreIntegrity.getMaxIntegrity(), initialCoreMaximum);

    scene.update();
    cameraController.followBlend = 1;
    scene.update();
    scene.draw();
    const drawAtDeath = backend.drawSnapshots.at(-1);
    const cameraCenterAtDeath = copyVector(drawAtDeath.cameraCenter);
    assert.deepEqual(
        drawAtDeath.renderedEnemyHandles.map(handleKey).sort(),
        enemyHandlesBeforeDeath
    );
    assert.ok(drawAtDeath.visibleEnemyHandles.length > 0);
    assert.ok(drawAtDeath.visibleEnemyHandles.some((handle) => (
        handleKey(handle) === handleKey(cameraVisibilityHandles[1])
    )));
    assertCameraDrawSnapshot(drawAtDeath, corePosition, camera.getScale());
    assert.strictEqual(objectSystem.getCameraFollowTarget(), cameraFollowTarget);
    assert.equal(cameraFollowTarget.isCameraFollowEnabled(), true);
    assert.deepEqual(
        cameraFollowTarget.copyCameraFollowPositionInto({}),
        corePosition
    );
    assert.ok(Math.hypot(
        drawAtDeath.cameraCenter.x - drawBeforeDeath.cameraCenter.x,
        drawAtDeath.cameraCenter.y - drawBeforeDeath.cameraCenter.y
    ) > 0);
    assert.notDeepEqual(drawAtDeath.viewTopLeft, drawBeforeDeath.viewTopLeft);
    assert.notDeepEqual(
        drawAtDeath.viewBottomRight,
        drawBeforeDeath.viewBottomRight
    );
    assert.strictEqual(gameSystem.getGpuSimulationEndpoint(), endpoint);
    assert.strictEqual(objectSystem.getWorldRegistry(), registry);
    assert.strictEqual(objectSystem.getEnemySimulationBackend(), backend);
    assert.equal(
        endpoint.getStatus().sessionGeneration,
        endpointStatusBeforeDeath.sessionGeneration
    );
    assert.equal(scene.getEnemyRecoveryStatus().restartCount, 0);

    hostileStatus = gameSystem.getHostileAttackStatus();
    const deathFixedTick = gameSystem.getFixedTick();
    const attemptsAtDeath = hostileStatus.shotStartAttemptCount;
    const acceptedAtDeath = hostileStatus.shotRequestAcceptedCount;
    const hostileMaterializationsAtDeath = hostileShots().length;
    const playerMaterializationsAtDeath = backend.materializedShots.filter(
        ({ definitionId }) => definitionId === BASIC_BULLET_PROJECTILE_DATA.id
    ).length;
    const playerProjectilePositionAtDeath = copyVector(
        backend.bodies.get(handleKey(playerProjectileHandle)).position
    );
    const controlsAtDeath = backend.controlAcceptedCount;
    const archerPositionsAtDeath = new Map(productionArchers.map(({ handle }) => (
        [handleKey(handle), copyVector(backend.bodies.get(handleKey(handle)).position)]
    )));
    const postDeathFixedTick = Math.max(
        deathFixedTick + 30,
        ...hostileStatus.archers.map(({ nextEligibleFixedTick }) => (
            nextEligibleFixedTick + 1
        ))
    );
    inputState.primaryPressed = true;
    advanceThrough(gameSystem, postDeathFixedTick);
    hostileStatus = gameSystem.getHostileAttackStatus();
    assert.equal(gameSystem.getFixedTick() - deathFixedTick >= 30, true);
    assert.equal(hostileStatus.shotStartAttemptCount, attemptsAtDeath);
    assert.equal(hostileStatus.shotRequestAcceptedCount, acceptedAtDeath);
    assert.equal(hostileShots().length, hostileMaterializationsAtDeath);
    assert.equal(
        backend.materializedShots.filter(
            ({ definitionId }) => definitionId === BASIC_BULLET_PROJECTILE_DATA.id
        ).length,
        playerMaterializationsAtDeath
    );
    assert.equal(backend.controlAcceptedCount, controlsAtDeath);
    assert.equal(objectSystem.primaryProjectileController.getStatus().enabled, false);
    assert.equal(registry.has(playerProjectileHandle), true);
    const playerProjectilePositionAfterDeath = backend.bodies.get(
        handleKey(playerProjectileHandle)
    ).position;
    assert.ok(
        Math.hypot(
            playerProjectilePositionAfterDeath.x - playerProjectilePositionAtDeath.x,
            playerProjectilePositionAfterDeath.y - playerProjectilePositionAtDeath.y
        ) > 0,
        'Tower source death 뒤에도 이미 materialize된 Player projectile은 계속 진행해야 합니다.'
    );
    for (const record of productionArchers) {
        const before = archerPositionsAtDeath.get(handleKey(record.handle));
        const after = backend.bodies.get(handleKey(record.handle)).position;
        assert.ok(Math.hypot(after.x - before.x, after.y - before.y) > 0);
        assert.equal(registry.has(record.handle), true);
        assert.equal(backend.hasBody(record.handle), true);
    }
    assert.equal(endpoint.getStatus().reservedCount, 0);
    assert.equal(endpoint.getStatus().pendingCommandCount, 0);
    assert.equal(endpoint.getStatus().pendingSourceRelativeDestinationCount, 0);
    assert.equal(backend.pendingFixedPlan, null);
    assert.equal(gameSystem.isGpuWorldRecoveryRequired(), false);
    assert.equal(coreIntegrity.getCurrentIntegrity(), initialCoreIntegrity);
    assert.equal(registry.getActiveCount('enemy'), 32);
    assert.deepEqual(
        registry.copyActiveHandlesInto([], { kindId: 'enemy' })
            .map(handleKey)
            .sort(),
        enemyHandlesBeforeDeath
    );
    scene.update();
    cameraController.followBlend = 1;
    scene.update();
    scene.draw();
    const drawAfterThirtyTicks = backend.drawSnapshots.at(-1);
    assert.deepEqual(
        drawAfterThirtyTicks.renderedEnemyHandles.map(handleKey).sort(),
        enemyHandlesBeforeDeath
    );
    assert.ok(drawAfterThirtyTicks.visibleEnemyHandles.length > 0);
    assert.ok(drawAfterThirtyTicks.visibleEnemyHandles.some((handle) => (
        handleKey(handle) === handleKey(cameraVisibilityHandles[1])
    )));
    assertCameraDrawSnapshot(
        drawAfterThirtyTicks,
        corePosition,
        camera.getScale()
    );
    assert.strictEqual(objectSystem.getCameraFollowTarget(), cameraFollowTarget);
    assert.equal(cameraFollowTarget.isCameraFollowEnabled(), true);
    assert.deepEqual(
        cameraFollowTarget.copyCameraFollowPositionInto({}),
        corePosition
    );
    assert.strictEqual(gameSystem.getGpuSimulationEndpoint(), endpoint);
    assert.strictEqual(objectSystem.getWorldRegistry(), registry);
    assert.strictEqual(objectSystem.getEnemySimulationBackend(), backend);
    assert.equal(
        endpoint.getStatus().sessionGeneration,
        endpointStatusBeforeDeath.sessionGeneration
    );
    assert.equal(scene.getEnemyRecoveryStatus().restartCount, 0);
    assertNear(cameraCenterAtDeath.x, corePosition.x);
    assertNear(cameraCenterAtDeath.y, corePosition.y);
    assertNear(drawAfterThirtyTicks.cameraCenter.x, corePosition.x);
    assertNear(drawAfterThirtyTicks.cameraCenter.y, corePosition.y);

    const deadRecoveryOffset = gameSystem.getFixedTick();
    const oldEndpoint = gameSystem.getGpuSimulationEndpoint();
    const oldBackend = backend;
    assert.equal(gameSystem.restartGpuWorldAtSafeWaveBoundary(), true);
    const replacementEndpoint = gameSystem.getGpuSimulationEndpoint();
    const replacementBackend = backends[1];
    assert.notStrictEqual(replacementEndpoint, oldEndpoint);
    assert.strictEqual(objectSystem.getCameraFollowTarget(), cameraFollowTarget);
    assert.equal(cameraFollowTarget.isCameraFollowEnabled(), true);
    assert.deepEqual(
        cameraFollowTarget.copyCameraFollowPositionInto({}),
        corePosition
    );
    assert.equal(oldBackend.destroyCount, 1);
    assert.equal(gameSystem.getTowerCombatStatus().alive, false);
    assert.equal(gameSystem.getTowerCombatStatus().currentHp, 0);
    assert.strictEqual(gameSystem.getCoreIntegrity(), coreIntegrity);
    assert.equal(coreIntegrity.getCurrentIntegrity(), initialCoreIntegrity);
    assert.equal(gameSystem.getHostileAttackStatus().activeArcherCount, 0);

    assert.equal(gameSystem.fixedUpdate(), true);
    assert.deepEqual(
        replacementBackend.spawnBatches[0]
            .map(({ kindId }) => kindId)
            .sort(),
        ['core-proxy', 'enemy']
    );
    assert.equal(
        replacementEndpoint.getRegistry().getActiveCount('tower'),
        0
    );
    advanceThrough(gameSystem, deadRecoveryOffset + 31);
    const deadRecoveryHostileStatus = gameSystem.getHostileAttackStatus();
    assert.equal(deadRecoveryHostileStatus.activeArcherCount, 1);
    assert.equal(deadRecoveryHostileStatus.archers[0].createdAtTick, deadRecoveryOffset + 31);
    assert.equal(deadRecoveryHostileStatus.archers[0].shotSequence, 0);
    assert.equal(deadRecoveryHostileStatus.shotStartAttemptCount, 0);
    assert.equal(deadRecoveryHostileStatus.shotRequestAcceptedCount, 0);
    assert.equal(replacementBackend.materializedShots.length, 0);
    assert.equal(objectSystem.getEnemyWaveStatus().fixedTickOffset, deadRecoveryOffset);
    assert.equal(objectSystem.getEnemyWaveStatus().totalSpawnCount, 32);
    assert.equal(objectSystem.getEnemyWaveStatus().queuedSpawnCount, 7);
    advanceThrough(gameSystem, deadRecoveryOffset + 36);
    assert.equal(gameSystem.getHostileAttackStatus().shotStartAttemptCount, 0);
    assert.equal(replacementEndpoint.getStatus().reservedCount, 0);
    assert.equal(replacementEndpoint.getStatus().pendingCommandCount, 0);
    assert.equal(gameSystem.isGpuWorldRecoveryRequired(), false);
    assert.strictEqual(gameSystem.getCoreIntegrity(), coreIntegrity);
    assert.equal(coreIntegrity.getCurrentIntegrity(), initialCoreIntegrity);

    scene.destroy();
    scene.destroy();
    assert.equal(replacementBackend.destroyCount, 1);
});
