import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGameModule } from './support/source_module_loader.mjs';

const { GameSystem } = await loadGameModule('ingame/game_system.js');
const { RUN_OUTCOME_STATE } = await loadGameModule('ingame/state/run_outcome.js');
const {
    createGpuEnemySpawnIntent
} = await loadGameModule('ingame/object/enemy/gpu_enemy_spawn_adapter.js');

function handleKey(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

class TerminalBackend {
    constructor({ fixedResult = true, sessionGeneration = 1 } = {}) {
        this.fixedResult = fixedResult;
        this.calls = [];
        this.destroyed = false;
        this.protocol = Object.freeze({
            sessionGeneration,
            deviceGeneration: 0,
            authoritativeEpoch: 0
        });
    }

    getCapacity() { return 8; }
    init() { this.calls.push('init'); return true; }
    spawnBodies(bodies) {
        const source = Array.from(bodies);
        this.calls.push('spawn');
        return Object.freeze({
            accepted: source.length,
            rejected: 0,
            handles: source.map(({ entityId, incarnation }) => Object.freeze({
                entityId,
                incarnation
            }))
        });
    }
    despawnBodies(handles) {
        this.calls.push('despawn');
        return Object.freeze({ removed: Array.from(handles).length, rejected: 0 });
    }
    hasBody() { return false; }
    hasActiveBodies() { return false; }
    canControlBody() { return false; }
    stageFixedPrograms(plan) {
        return Object.freeze({
            accepted: plan.controls.length + plan.sourceRelativeSpawns.length,
            rejected: 0
        });
    }
    drainCompletedSpawnProgramBatches(out) { return out; }
    hasPendingSpawnProgramThroughTick() { return false; }
    getEventProtocolState() { return this.protocol; }
    drainCompletedEventBatches(out) { return out; }
    fixedUpdate() { this.calls.push('fixed'); return this.fixedResult; }
    updatePresentation() { this.calls.push('presentation'); }
    synchronizePresentation() { this.calls.push('synchronize'); }
    draw() { this.calls.push('draw'); return true; }
    getRuntimeState() { return this.destroyed ? 'destroyed' : 'gpu-ready'; }
    requiresRecovery() { return false; }
    getStatus() {
        return Object.freeze({
            state: this.getRuntimeState(),
            ...this.protocol
        });
    }
    destroy() { this.destroyed = true; }
}

class CoreImpactBackend extends TerminalBackend {
    constructor(options = {}) {
        super(options);
        this.bodies = new Map();
        this.completedEventBatches = [];
        this.trackedHandle = null;
    }

    spawnBodies(source) {
        const bodies = Array.from(source);
        this.calls.push('spawn');
        const handles = bodies.map((body) => {
            const handle = Object.freeze({
                entityId: body.entityId,
                incarnation: body.incarnation
            });
            this.bodies.set(handleKey(handle), body);
            return handle;
        });
        return Object.freeze({ accepted: handles.length, rejected: 0, handles });
    }

    despawnBodies(source) {
        const handles = Array.from(source);
        this.calls.push('despawn');
        let removed = 0;
        for (const handle of handles) {
            removed += this.bodies.delete(handleKey(handle)) ? 1 : 0;
        }
        return Object.freeze({ removed, rejected: handles.length - removed });
    }

    hasBody(handle) { return this.bodies.has(handleKey(handle)); }
    hasActiveBodies() { return this.bodies.size > 0; }
    canControlBody(handle) { return this.hasBody(handle); }
    configureTrackedBody(handle = null) {
        if (handle !== null && !this.hasBody(handle)) {
            return Object.freeze({ accepted: false, reason: 'stale-handle' });
        }
        this.trackedHandle = handle === null ? null : Object.freeze({ ...handle });
        return Object.freeze({ accepted: true });
    }
    drainCompletedEventBatches(out) {
        out.push(...this.completedEventBatches.splice(0));
        return out;
    }
}

function createTrackingCoreDirectorFactory() {
    const instances = [];
    const failedCleanupPorts = [];
    let failNextCreation = false;
    return Object.freeze({
        instances,
        failedCleanupPorts,
        failNextCreation() {
            failNextCreation = true;
        },
        factory(options) {
            if (failNextCreation) {
                failNextCreation = false;
                failedCleanupPorts.push(options.coreImpactCleanupPort);
                throw new Error('core-impact-director-fixture-failure');
            }
            const instance = {
                endpoint: options.endpoint,
                coreImpactCleanupPort: options.coreImpactCleanupPort,
                destroyed: false,
                resetCount: 0,
                observeCompletedEvents() {
                    return Object.freeze({
                        facts: Object.freeze([]),
                        coreDepletedFact: null,
                        recoveryRequired: false
                    });
                },
                stageForFixedTick() {
                    return Object.freeze({ recoveryRequired: false });
                },
                observeFixedCommit() {
                    return Object.freeze({ recoveryRequired: false });
                },
                getStatus() {
                    return Object.freeze({
                        endpointSessionGeneration: this.endpoint.getStatus().sessionGeneration,
                        recoveryRequired: false,
                        destroyed: this.destroyed
                    });
                },
                requiresRecovery() { return false; },
                resetGpuBinding(endpoint, coreImpactCleanupPort) {
                    this.endpoint = endpoint;
                    this.coreImpactCleanupPort = coreImpactCleanupPort;
                    this.resetCount++;
                    return true;
                },
                destroy() { this.destroyed = true; }
            };
            instances.push(instance);
            return instance;
        }
    });
}

function createDirectorFactory({ depleteOnFirstObserve }) {
    const state = { observations: 0, stages: 0, commits: 0 };
    return Object.assign((options) => ({
        observeCompletedEvents() {
            state.observations++;
            if (depleteOnFirstObserve && state.observations === 1) {
                options.coreIntegrity.applyIntegrityDamage(
                    options.coreIntegrity.getCurrentIntegrity()
                );
                const depleted = Object.freeze({
                    type: 'CoreDepleted',
                    eventKey: 'core-terminal:1',
                    impactKey: 'core-impact:1'
                });
                return Object.freeze({
                    facts: Object.freeze([depleted]),
                    coreDepletedFact: depleted,
                    recoveryRequired: false
                });
            }
            return Object.freeze({
                facts: Object.freeze([]),
                coreDepletedFact: null,
                recoveryRequired: false
            });
        },
        stageForFixedTick() {
            state.stages++;
            return Object.freeze({ recoveryRequired: false });
        },
        observeFixedCommit() {
            state.commits++;
            return Object.freeze({ recoveryRequired: false });
        },
        getStatus() {
            return Object.freeze({
                pendingCleanupCount: 0,
                cleanupFailure: null,
                recoveryRequired: false
            });
        },
        requiresRecovery() { return false; },
        destroy() {}
    }), { state });
}

function createGameSystem({
    fixedResult = true,
    depleteOnFirstObserve = true,
    gameplayWorldActorsEnabled = false,
    backendFactory = null,
    useRealCoreImpactDirector = false
} = {}) {
    let backend = backendFactory
        ? null
        : new TerminalBackend({ fixedResult });
    const directorFactory = useRealCoreImpactDirector
        ? null
        : createDirectorFactory({ depleteOnFirstObserve });
    const dependencies = {
        inputActionSource: {
            isPressed: () => false,
            getPointerPosition(out) { out.x = 0; out.y = 0; return out; },
            isPrimaryPointerPressed: () => false,
            getWheelTotals(out) { out.x = 0; out.y = 0; return out; }
        },
        animationPort: {
            animate: () => ({
                promise: Promise.resolve(),
                retarget: () => true,
                remove() {},
                isActive: () => true
            })
        },
        timePort: {
            getDelta: () => 1 / 120,
            getFixedDelta: () => 1 / 60,
            getFixedInterpolationAlpha: () => 0
        },
        viewportPort: {
            getSnapshot(out) {
                out.ww = 1280;
                out.wh = 720;
                return out;
            }
        },
        worldRenderPort: {
            drawCircle() {},
            drawSquareInstances() {}
        },
        webGpuPlatformPort: {
            getState: () => Object.freeze({ ready: true, status: 'ready' })
        },
        ...(backendFactory
            ? {
                enemySimulationBackendFactory(_dependencies, endpointOptions) {
                    backend = backendFactory(endpointOptions);
                    return backend;
                }
            }
            : { enemySimulationBackend: backend }),
        ...(directorFactory
            ? { enemyCoreImpactDirectorFactory: directorFactory }
            : {})
    };
    const gameSystem = new GameSystem(dependencies, {
        enemyWaveEnabled: false,
        gameplayWorldActorsEnabled
    });
    assert.equal(gameSystem.enter(), true);
    return { backend, directorFactory, gameSystem };
}

test('Core depletion은 RunFailed 한 번, public ingress 즉시 gate, 마지막 submit 한 번 뒤 terminal no-op을 보장한다', () => {
    const { backend, directorFactory, gameSystem } = createGameSystem();
    const endpoint = gameSystem.getGpuSimulationEndpoint();
    const outcome = gameSystem.getRunOutcome();
    const rawLifecycleOwner = endpoint.getLifecycleCommandOwner();
    assert.equal(endpoint.requestSpawn(createGpuEnemySpawnIntent({
        definition: {
            id: 'terminal-pending-enemy',
            shapeType: 'square',
            maxHealth: 1,
            moveSpeedTilesPerSecond: 1,
            collisionRadiusTiles: 0.5,
            collisionWeight: 1,
            coreImpactDamage: 1,
            towerContactDamage: 0,
            bountyBudget: 0,
            colorRgba: [1, 0, 0, 1],
            radiusScale: 1
        },
        route: {
            gateId: 'terminal-pending-gate',
            pathId: 'terminal-pending-path',
            waypoints: [{ x: 0, y: 0 }, { x: 1, y: 0 }]
        },
        spawnSequence: 0,
        policyId: 'corebound'
    }), 2, 'terminal:pending-spawn').accepted, true);

    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(outcome.getState(), RUN_OUTCOME_STATE.DEFEATED);
    assert.equal(outcome.getRunFailedFact().type, 'RunFailed');
    assert.equal(backend.calls.filter((call) => call === 'fixed').length, 1);
    assert.equal(directorFactory.state.stages, 1);
    assert.equal(directorFactory.state.commits, 1);
    assert.equal(endpoint.getStatus().gameplayIngressOpen, false);
    assert.equal(endpoint.requestSpawn({}, 2).accepted, false);
    assert.equal(endpoint.requestSpawnBatch([]).accepted, false);
    assert.equal(endpoint.requestBodyControl({}, 2, 'after-defeat').accepted, false);
    assert.equal(endpoint.requestSourceRelativeSpawn({}, 2, 'after-defeat').accepted, false);
    assert.equal(endpoint.requestDespawn(
        { entityId: 1, incarnation: 1 },
        'cleanup',
        2,
        'after-defeat:despawn'
    ).accepted, false);
    assert.equal(rawLifecycleOwner.requestSpawn({}, 2).accepted, false);
    assert.equal(rawLifecycleOwner.requestSpawnBatch([]).accepted, false);
    assert.equal(rawLifecycleOwner.requestDespawn(
        { entityId: 1, incarnation: 1 },
        'cleanup',
        2,
        'after-defeat:raw-despawn'
    ).accepted, false);
    assert.equal(endpoint.getPendingCommandCount(), 0);
    assert.equal(endpoint.getStatus().lifecycle.pendingCount, 0);
    assert.equal(endpoint.getStatus().fixedCommands.pendingCommandCount, 0);
    assert.equal(endpoint.getStatus().fixedCommands.pendingDestinationCount, 0);

    const gameplayStatus = gameSystem.getGameplayStatus();
    assert.equal(gameplayStatus.outcome.state, RUN_OUTCOME_STATE.DEFEATED);
    assert.equal(gameplayStatus.outcome.runFailedFact.type, 'RunFailed');
    assert.equal(gameplayStatus.terminal.state, 'SEALED');
    assert.equal(gameSystem.isGpuWorldRecoveryRequired(), false);
    assert.equal(gameSystem.restartGpuWorldAtSafeWaveBoundary(), false);

    gameSystem.update();
    gameSystem.draw();
    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(backend.calls.filter((call) => call === 'fixed').length, 1);
    assert.strictEqual(gameSystem.getRunOutcome(), outcome);
    assert.equal(outcome.getRunFailedFact().type, 'RunFailed');
});

test('실제 Core director는 actor-spawn 뒤 committed Core arrival을 exact cleanup과 함께 terminal final submit으로 닫는다', () => {
    const { backend, gameSystem } = createGameSystem({
        gameplayWorldActorsEnabled: true,
        useRealCoreImpactDirector: true,
        backendFactory: (endpointOptions) => new CoreImpactBackend({
            sessionGeneration: endpointOptions.sessionGeneration
        })
    });
    assert.ok(backend instanceof CoreImpactBackend);
    assert.equal(gameSystem.fixedUpdate(), true);
    const objectSystem = gameSystem.getObjectSystem();
    const endpoint = gameSystem.getGpuSimulationEndpoint();
    const coreHandle = objectSystem.getGpuWorldActorStatus().coreProxyHandle;
    assert.ok(coreHandle);

    const targetFixedTick = gameSystem.getNextGpuLifecycleFixedTick();
    const coreIntegrity = gameSystem.getCoreIntegrity();
    const enemyReceipt = endpoint.requestSpawn(createGpuEnemySpawnIntent({
        definition: {
            id: 'terminal-core-impact-enemy',
            shapeType: 'square',
            maxHealth: 1,
            moveSpeedTilesPerSecond: 1,
            collisionRadiusTiles: 0.5,
            collisionWeight: 1,
            coreImpactDamage: coreIntegrity.getMaxIntegrity(),
            towerContactDamage: 0,
            bountyBudget: 9,
            colorRgba: [1, 0, 0, 1],
            radiusScale: 1
        },
        route: {
            gateId: 'terminal-gate',
            pathId: 'terminal-path',
            waypoints: [{ x: 0, y: 0 }, { x: 1, y: 0 }]
        },
        spawnSequence: 0,
        policyId: 'corebound'
    }), targetFixedTick, 'terminal-core-impact:enemy');
    assert.equal(enemyReceipt.accepted, true);
    assert.equal(gameSystem.fixedUpdate(), true);
    const enemyHandle = endpoint.getRegistry().copyActiveHandlesInto([], {
        kindId: 'enemy'
    }).at(0);
    assert.ok(enemyHandle);
    backend.completedEventBatches.push(Object.freeze({
        ...backend.protocol,
        previousSourceTick: 0,
        previousSubmittedTick: 0,
        sourceTick: 2,
        submittedTick: 2,
        completedThroughTick: 2,
        events: Object.freeze([Object.freeze({
            type: 'contact',
            eventType: 'interaction-enter',
            sequence: 0,
            entityId: coreHandle.entityId,
            incarnation: coreHandle.incarnation,
            otherEntityId: enemyHandle.entityId,
            otherIncarnation: enemyHandle.incarnation,
            valueFixedPoint: 0
        })])
    }));

    const fixedCallsBeforeTerminal = backend.calls.filter((call) => call === 'fixed').length;
    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(gameSystem.getRunOutcome().getState(), RUN_OUTCOME_STATE.DEFEATED);
    assert.equal(gameSystem.getGameplayStatus().terminal.state, 'SEALED');
    assert.equal(endpoint.getStatus().gameplayIngressOpen, false);
    assert.equal(endpoint.getRegistry().has(enemyHandle), false);
    assert.equal(endpoint.getPendingCommandCount(), 0);
    const coreImpactStatus = objectSystem.getCoreImpactStatus();
    assert.equal(coreImpactStatus.cleanupCommittedCount, 1);
    assert.equal(coreImpactStatus.trackedCleanupCount, 0);
    assert.equal(
        coreImpactStatus.lastCommittedFacts.find(({ type }) => type === 'CoreImpact')
            .disposition,
        'CORE_IMPACT'
    );
    assert.equal(backend.calls.filter((call) => call === 'fixed').length, fixedCallsBeforeTerminal + 1);
    assert.equal(endpoint.requestSpawn({}, gameSystem.getNextGpuLifecycleFixedTick()).accepted, false);

    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(backend.calls.filter((call) => call === 'fixed').length, fixedCallsBeforeTerminal + 1);
    assert.equal(gameSystem.restartGpuWorldAtSafeWaveBoundary(), false);
});

test('마지막 terminal fixed submit 실패는 retry/recovery 없이 SEALED_FAILED diagnostic을 남기고 이후 true no-op이다', () => {
    const { backend, gameSystem } = createGameSystem({ fixedResult: false });

    assert.equal(gameSystem.fixedUpdate(), false);
    const terminal = gameSystem.getGameplayStatus().terminal;
    assert.equal(terminal.state, 'SEALED_FAILED');
    assert.equal(terminal.diagnostic.stage, 'terminal-fixed-submit');
    assert.equal(gameSystem.isGpuWorldRecoveryRequired(), false);
    assert.equal(backend.calls.filter((call) => call === 'fixed').length, 1);
    assert.equal(gameSystem.getGpuSimulationEndpoint().getPendingCommandCount(), 0);

    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(backend.calls.filter((call) => call === 'fixed').length, 1);
    assert.equal(gameSystem.restartGpuWorldAtSafeWaveBoundary(), false);
});

test('Core가 이미 depleted인 protocol-failure 경로도 RunFailed를 한 번 생성하고 재시도 없이 seal한다', () => {
    const { backend, gameSystem } = createGameSystem({
        depleteOnFirstObserve: false
    });
    const core = gameSystem.getCoreIntegrity();
    const outcome = gameSystem.getRunOutcome();
    assert.equal(core.applyIntegrityDamage(core.getMaxIntegrity()), core.getMaxIntegrity());
    backend.drainCompletedEventBatches = (out) => {
        out.push(Object.freeze({
            sessionGeneration: 999999,
            deviceGeneration: 0,
            authoritativeEpoch: 0,
            previousSourceTick: 0,
            previousSubmittedTick: 0,
            sourceTick: 1,
            submittedTick: 1,
            completedThroughTick: 1,
            events: Object.freeze([])
        }));
        return out;
    };

    assert.equal(gameSystem.fixedUpdate(), false);
    assert.equal(outcome.getState(), RUN_OUTCOME_STATE.DEFEATED);
    const fact = outcome.getRunFailedFact();
    assert.equal(fact.type, 'RunFailed');
    assert.equal(gameSystem.getGameplayStatus().terminal.state, 'SEALED_FAILED');
    assert.equal(
        gameSystem.getGameplayStatus().terminal.diagnostic.stage,
        'completed-event-protocol'
    );
    assert.equal(backend.calls.filter((call) => call === 'fixed').length, 0);
    assert.equal(gameSystem.getGpuSimulationEndpoint().getPendingCommandCount(), 0);

    assert.equal(gameSystem.fixedUpdate(), true);
    assert.strictEqual(outcome.getRunFailedFact(), fact);
    assert.equal(backend.calls.filter((call) => call === 'fixed').length, 0);
});

test('Tower status가 없어도 Core가 남아 있으면 outcome은 RUNNING으로 유지된다', () => {
    const { gameSystem } = createGameSystem({ depleteOnFirstObserve: false });
    const roster = gameSystem.towerCombatRoster;
    roster.alive = false;
    roster.currentHpFixedPoint = 0;

    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(gameSystem.getCoreIntegrity().getCurrentIntegrity() > 0, true);
    assert.equal(gameSystem.getRunOutcome().getState(), RUN_OUTCOME_STATE.RUNNING);
    assert.equal(gameSystem.getGameplayStatus().outcome.defeated, false);
});

test('RUNNING recovery는 CoreIntegrity/RunOutcome identity를 보존하고 Core director를 새 GPU binding으로 교체한다', () => {
    const backends = [];
    const directors = createTrackingCoreDirectorFactory();
    const gameSystem = new GameSystem({
        inputActionSource: {
            isPressed: () => false,
            getPointerPosition(out) { out.x = 0; out.y = 0; return out; },
            isPrimaryPointerPressed: () => false,
            getWheelTotals(out) { out.x = 0; out.y = 0; return out; }
        },
        animationPort: {
            animate: () => ({
                promise: Promise.resolve(),
                retarget: () => true,
                remove() {},
                isActive: () => true
            })
        },
        timePort: {
            getDelta: () => 1 / 120,
            getFixedDelta: () => 1 / 60,
            getFixedInterpolationAlpha: () => 0
        },
        viewportPort: {
            getSnapshot(out) {
                out.ww = 1280;
                out.wh = 720;
                return out;
            }
        },
        worldRenderPort: { drawCircle() {}, drawSquareInstances() {} },
        webGpuPlatformPort: {
            getState: () => Object.freeze({ ready: true, status: 'ready' })
        },
        enemySimulationBackendFactory(_dependencies, endpointOptions) {
            const backend = new TerminalBackend({
                sessionGeneration: endpointOptions.sessionGeneration
            });
            backends.push(backend);
            return backend;
        },
        enemyCoreImpactDirectorFactory: directors.factory
    }, {
        enemyWaveEnabled: false,
        gameplayWorldActorsEnabled: false
    });
    assert.equal(gameSystem.enter(), true);

    const coreIntegrity = gameSystem.getCoreIntegrity();
    const outcome = gameSystem.getRunOutcome();
    const objectSystem = gameSystem.getObjectSystem();
    const oldEndpoint = gameSystem.getGpuSimulationEndpoint();
    const oldDirector = directors.instances[0];
    const oldCleanupPort = oldDirector.coreImpactCleanupPort;
    assert.equal(oldDirector.resetCount, 1);
    assert.equal(
        typeof oldCleanupPort?.requestCommittedCoreImpactCleanup,
        'function'
    );

    assert.equal(gameSystem.restartGpuWorldAtSafeWaveBoundary(), true);
    const newEndpoint = gameSystem.getGpuSimulationEndpoint();
    const newDirector = directors.instances[1];
    const newCleanupPort = newDirector.coreImpactCleanupPort;
    assert.notStrictEqual(newEndpoint, oldEndpoint);
    assert.equal(backends[0].destroyed, true);
    assert.equal(oldDirector.destroyed, true);
    assert.notStrictEqual(newDirector, oldDirector);
    assert.notStrictEqual(newCleanupPort, oldCleanupPort);
    assert.strictEqual(newDirector.endpoint, newEndpoint);
    assert.strictEqual(gameSystem.getCoreIntegrity(), coreIntegrity);
    assert.strictEqual(gameSystem.getRunOutcome(), outcome);
    assert.equal(outcome.getState(), RUN_OUTCOME_STATE.RUNNING);
    assert.strictEqual(objectSystem.enemyCoreImpactDirector, newDirector);
    assert.equal(oldCleanupPort.requestCommittedCoreImpactCleanup(
        { entityId: 99, incarnation: 1 },
        2,
        'core-impact:stale-port'
    ).reason, 'core-impact-cleanup-port-revoked');

    directors.failNextCreation();
    assert.equal(gameSystem.restartGpuWorldAtSafeWaveBoundary(), false);
    assert.strictEqual(gameSystem.getGpuSimulationEndpoint(), newEndpoint);
    assert.strictEqual(objectSystem.enemyCoreImpactDirector, newDirector);
    assert.strictEqual(newDirector.coreImpactCleanupPort, newCleanupPort);
    assert.equal(backends[2].destroyed, true);
    assert.equal(directors.failedCleanupPorts.length, 1);
    assert.equal(directors.failedCleanupPorts[0]
        .requestCommittedCoreImpactCleanup(
            { entityId: 101, incarnation: 1 },
            3,
            'core-impact:failed-replacement-port'
        ).reason, 'core-impact-cleanup-port-revoked');
    assert.equal(gameSystem.fixedUpdate(), true);
    gameSystem.destroy();
    assert.equal(newCleanupPort.requestCommittedCoreImpactCleanup(
        { entityId: 100, incarnation: 1 },
        3,
        'core-impact:destroyed-port'
    ).reason, 'core-impact-cleanup-port-revoked');
});
