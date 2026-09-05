import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadGameModule } from './support/source_module_loader.mjs';

const { GameSystem } = await loadGameModule('ingame/game_system.js');
const { PRIMARY_TOWER_LOGICAL_ID } = await loadGameModule(
    'ingame/object/tower/tower_group_contract.js'
);
const { RUN_OUTCOME_STATE } = await loadGameModule('ingame/state/run_outcome.js');
const { PentagonEffectDirector } = await loadGameModule(
    'ingame/object/enemy/pentagon_effect_director.js'
);
const {
    createGpuEnemySpawnIntent
} = await loadGameModule('ingame/object/enemy/gpu_enemy_spawn_adapter.js');
const { BASIC_PENTA_ENEMY_DATA } = await loadGameModule(
    'data/object/enemy/basic_penta_enemy_data.js'
);
const {
    GPU_FIXED_PRIMITIVE_TERMINAL_CANCEL_ABI_VERSION
} = await loadGameModule('ingame/physics/gpu/gpu_fixed_primitive_abi.js');
const {
    GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
    GPU_EFFECT_TERMINAL_CANCEL_ABI_VERSION
} = await loadGameModule('ingame/physics/gpu/gpu_effect_runtime_abi.js');
const {
    GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION
} = await loadGameModule('ingame/physics/gpu/gpu_projectile_capture_runtime_abi.js');
const gameObjectSystemSource = await readFile(
    new URL('../project/game/script/module/ingame/object/game_object_system.js', import.meta.url),
    'utf8'
);

function handleKey(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

class TerminalBackend {
    constructor({
        fixedResult = true,
        sessionGeneration = 1,
        gameplayTargetClearAccepted = true
    } = {}) {
        this.fixedResult = fixedResult;
        this.calls = [];
        this.presentationFrames = [];
        this.referencePresentationSeconds = 0;
        this.lastFixedSourceTick = 0;
        this.destroyed = false;
        this.terminalCancelStatus = null;
        this.effectTerminalCancelStatus = null;
        this.gameplayTargetClearAccepted = gameplayTargetClearAccepted;
        this.towerGameplayTargetConfigured = false;
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
    drainCompletedBodyControlProgramBatches(out) { return out; }
    cancelPendingFixedProgramsForTerminal(request) {
        this.terminalCancelStatus = Object.freeze({
            abiVersion: GPU_FIXED_PRIMITIVE_TERMINAL_CANCEL_ABI_VERSION,
            finalFixedTick: request.finalFixedTick,
            accepted: true,
            state: 'armed',
            reason: null,
            destinationCount: request.destinationHandles.length,
            priorityControlCount: request.priorityControls.length,
            pendingBodyCount: 0,
            pendingSpawnProgramReadbacks: 0
        });
        return this.terminalCancelStatus;
    }
    getTerminalFixedProgramCancelStatus() {
        return this.terminalCancelStatus;
    }
    stageEffectPulseProgramBatch(batch) {
        return Object.freeze({
            accepted: true,
            abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
            sourceTick: batch.sourceTick,
            stagedCount: batch.records.length
        });
    }
    drainCompletedEffectProgramBatches(out) { return out; }
    cancelPendingEffectProgramsForTerminal(request) {
        this.effectTerminalCancelStatus = Object.freeze({
            abiVersion: GPU_EFFECT_TERMINAL_CANCEL_ABI_VERSION,
            state: 'armed',
            finalFixedTick: request.finalFixedTick,
            submittedTick: 0,
            pulseProgramCount: 0,
            pendingPulseProgramCount: 0,
            pendingEffectReadbackCount: 0,
            failure: null
        });
        return this.effectTerminalCancelStatus;
    }
    getEffectRuntimeStatus() {
        return Object.freeze({
            abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
            state: 'idle',
            activePoolIndex: 0,
            sourceTick: 0,
            lastSubmittedTick: this.effectTerminalCancelStatus?.submittedTick ?? 0,
            completedThroughTick: 0,
            pendingPulseProgramCount: 0,
            pendingEffectReadbackCount: 0,
            requiresRecovery: false,
            failure: null,
            terminal: this.effectTerminalCancelStatus
        });
    }
    hasPendingSpawnProgramThroughTick() { return false; }
    configureTowerGameplayTarget(handle = null) {
        this.calls.push(handle === null
            ? 'tower-gameplay-target-clear'
            : 'tower-gameplay-target-set');
        if (handle === null && !this.gameplayTargetClearAccepted) {
            return Object.freeze({
                accepted: false,
                reason: 'fixture-gameplay-target-clear-rejected'
            });
        }
        if (handle !== null && !this.hasBody(handle)) {
            return Object.freeze({ accepted: false, reason: 'stale-handle' });
        }
        this.towerGameplayTargetConfigured = handle !== null;
        return Object.freeze({
            accepted: true,
            configured: handle !== null
        });
    }
    getEventProtocolState() { return this.protocol; }
    drainCompletedEventBatches(out) { return out; }
    fixedUpdate(_delta, sourceTick) {
        this.calls.push('fixed');
        if (this.fixedResult && Number.isSafeInteger(sourceTick)) {
            this.lastFixedSourceTick = sourceTick;
            if (this.terminalCancelStatus?.state === 'armed') {
                this.terminalCancelStatus = Object.freeze({
                    ...this.terminalCancelStatus,
                    state: 'submitted',
                    submittedSourceTick: sourceTick
                });
            }
            if (this.effectTerminalCancelStatus?.state === 'armed') {
                this.effectTerminalCancelStatus = Object.freeze({
                    ...this.effectTerminalCancelStatus,
                    state: 'submitted',
                    submittedTick: sourceTick
                });
            }
        }
        return this.fixedResult;
    }
    updatePresentation(frame = {}) {
        this.calls.push('presentation');
        const frameDelta = Number(frame.frameDelta);
        const snapshot = Object.freeze({
            frameDelta: Number.isFinite(frameDelta) ? frameDelta : 0,
            fixedDelta: Number(frame.fixedDelta),
            fixedAlpha: Number(frame.fixedAlpha)
        });
        this.presentationFrames.push(snapshot);
        this.referencePresentationSeconds += Math.max(0, snapshot.frameDelta);
    }
    synchronizePresentation() { this.calls.push('synchronize'); }
    draw() { this.calls.push('draw'); return true; }
    getRuntimeState() { return this.destroyed ? 'destroyed' : 'gpu-ready'; }
    requiresRecovery() { return false; }
    getStatus() {
        return Object.freeze({
            state: this.getRuntimeState(),
            ...this.protocol,
            fixedPrimitives: Object.freeze({
                towerGameplayTarget: Object.freeze({
                    abiVersion: 1,
                    configured: this.towerGameplayTargetConfigured,
                    recordByteSize: 16,
                    storageBuffersPerStage: 8
                })
            })
        });
    }
    destroy() { this.destroyed = true; }
}

class TerminalEvidenceMismatchBackend extends TerminalBackend {
    constructor(kind, options = {}) {
        super(options);
        this.mismatchKind = kind;
    }

    fixedUpdate(delta, sourceTick) {
        const submitted = super.fixedUpdate(delta, sourceTick);
        if (!submitted || this.terminalCancelStatus?.state !== 'submitted') {
            return submitted;
        }
        if (this.mismatchKind.startsWith('effect-')
            && this.effectTerminalCancelStatus?.state === 'submitted') {
            const effectKind = this.mismatchKind.slice('effect-'.length);
            const effectOverride = effectKind === 'version'
                ? { abiVersion: GPU_EFFECT_TERMINAL_CANCEL_ABI_VERSION + 1 }
                : effectKind === 'count'
                    ? {
                        pulseProgramCount:
                            this.effectTerminalCancelStatus.pulseProgramCount + 1
                    }
                    : {
                        submittedTick:
                            this.effectTerminalCancelStatus.submittedTick + 1
                    };
            this.effectTerminalCancelStatus = Object.freeze({
                ...this.effectTerminalCancelStatus,
                ...effectOverride
            });
            return submitted;
        }
        if (this.mismatchKind.startsWith('effect-')) {
            return submitted;
        }
        const override = this.mismatchKind === 'version'
            ? { abiVersion: GPU_FIXED_PRIMITIVE_TERMINAL_CANCEL_ABI_VERSION + 1 }
            : this.mismatchKind === 'count'
                ? { destinationCount: this.terminalCancelStatus.destinationCount + 1 }
                : { finalFixedTick: this.terminalCancelStatus.finalFixedTick + 1 };
        this.terminalCancelStatus = Object.freeze({
            ...this.terminalCancelStatus,
            ...override
        });
        return submitted;
    }
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
    getObservedTrackedPose() {
        if (!this.trackedHandle || this.lastFixedSourceTick <= 0) {
            return Object.freeze({ valid: false, reason: 'awaiting-sample' });
        }
        const sourceTick = this.lastFixedSourceTick;
        return Object.freeze({
            valid: true,
            ...this.protocol,
            entityId: this.trackedHandle.entityId,
            incarnation: this.trackedHandle.incarnation,
            sourceTick,
            observedThroughTick: sourceTick,
            position: Object.freeze({ x: 10 + sourceTick, y: 12 }),
            previousPosition: Object.freeze({ x: 9 + sourceTick, y: 12 }),
            velocity: Object.freeze({ x: 60, y: 0 })
        });
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

function createDirectorFactory({ depleteOnObservation }) {
    const state = {
        observations: 0,
        stages: 0,
        commits: 0,
        coreImpactCleanupPort: null
    };
    return Object.assign((options) => {
        state.coreImpactCleanupPort = options.coreImpactCleanupPort;
        return ({
            observeCompletedEvents() {
                state.observations++;
                if (state.observations === depleteOnObservation) {
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
        });
    }, { state });
}

function createTrackingPentagonEffectDirectorFactory() {
    const instances = [];
    const failedPorts = [];
    let failNext = false;
    return {
        instances,
        failedPorts,
        failNextCreation() { failNext = true; },
        factory(options) {
            if (failNext) {
                failNext = false;
                failedPorts.push(options.effectCommandPort);
                throw new Error('replacement PentagonEffectDirector factory failure');
            }
            const director = new PentagonEffectDirector(options);
            instances.push(director);
            return director;
        }
    };
}

function createTrackingProjectileCaptureDirectorFactory() {
    const instances = [];
    return Object.freeze({
        instances,
        factory(options) {
            const binding = {
                sessionGeneration: options.sessionGeneration,
                deviceGeneration: options.deviceGeneration,
                authoritativeEpoch: options.authoritativeEpoch
            };
            let statusOverrides = {};
            const resetCalls = [];
            const director = {
                resetCalls,
                setStatus(overrides = {}) {
                    statusOverrides = { ...overrides };
                },
                observeLifecycle() { return this.getStatus(); },
                observeCompletedEvents() { return this.getStatus(); },
                observeCompletedCapturePrograms() { return this.getStatus(); },
                observeCompletedReleasePrograms() { return this.getStatus(); },
                stageForFixedTick({ targetFixedTick } = {}) {
                    return Object.freeze({
                        accepted: true,
                        targetFixedTick,
                        releaseCount: 0,
                        commandIds: Object.freeze([])
                    });
                },
                observeFixedCommit() { return this.getStatus(); },
                requiresRecovery() {
                    return this.getStatus().recoveryRequired;
                },
                getStatus() {
                    return Object.freeze({
                        capturedProjectileCount: 0,
                        heldCount: 0,
                        releasePendingCount: 0,
                        pendingBatchCount: 0,
                        terminalCleanupPendingCount: 0,
                        pendingReadbackCount: 0,
                        pendingStaleCompletionCount: 0,
                        lastCompletedCaptureTick: 0,
                        lastCompletedReleaseTick: 0,
                        lastFixedCommitTick: 0,
                        lastObservedFixedTick: 0,
                        ...binding,
                        recoveryRequired: false,
                        failure: null,
                        terminal: null,
                        destroyed: false,
                        ...statusOverrides
                    });
                },
                resetGpuBinding(
                    registry,
                    commandPort,
                    sessionGeneration,
                    deviceGeneration,
                    authoritativeEpoch
                ) {
                    resetCalls.push(Object.freeze({
                        registry,
                        commandPort,
                        sessionGeneration,
                        deviceGeneration,
                        authoritativeEpoch
                    }));
                    binding.sessionGeneration = sessionGeneration;
                    binding.deviceGeneration = deviceGeneration;
                    binding.authoritativeEpoch = authoritativeEpoch;
                    statusOverrides = {};
                    return true;
                },
                closeForTerminal(finalFixedTick) {
                    statusOverrides = {
                        ...statusOverrides,
                        terminal: Object.freeze({ finalFixedTick })
                    };
                    return this.getStatus().terminal;
                },
                destroy() {
                    statusOverrides = { ...statusOverrides, destroyed: true };
                }
            };
            instances.push(director);
            return director;
        }
    });
}

function createIdleJorangSplitLineageDirector() {
    let destroyed = false;
    let terminal = null;
    return {
        observeLifecycle() {
            if (terminal) {
                terminal = Object.freeze({
                    ...terminal,
                    lifecycleObserved: true,
                    rosterSealed: true
                });
            }
            return this.getStatus();
        },
        observeCompletedEvents() { return this.getStatus(); },
        observeCompletedPreparations() { return this.getStatus(); },
        stageForFixedTick({ targetFixedTick } = {}) {
            return Object.freeze({
                accepted: true,
                targetFixedTick,
                stagedCount: 0,
                recoveryRequired: false
            });
        },
        observeFixedCommit() {
            if (terminal) {
                terminal = Object.freeze({
                    ...terminal,
                    fixedCommitObserved: true
                });
            }
            return this.getStatus();
        },
        requiresRecovery() { return false; },
        getStatus() {
            return Object.freeze({
                destroyed,
                recoveryRequired: false,
                failure: null,
                terminal,
                pendingTransformBatchCount: 0,
                pendingFirstHitCount: 0,
                circlePrimeDueCount: 0
            });
        },
        resetGpuBinding() { return true; },
        closeForTerminal(finalFixedTick) {
            terminal = Object.freeze({
                finalFixedTick,
                fixedCommitObserved: false,
                lifecycleObserved: false,
                rosterSealed: false
            });
            return terminal;
        },
        destroy() { destroyed = true; }
    };
}

function installProjectileCaptureRuntimeStatus(endpoint, overrides = {}) {
    const sessionGeneration = endpoint.getStatus().sessionGeneration;
    const status = Object.freeze({
        abiVersion: GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION,
        state: 'idle',
        sessionGeneration,
        deviceGeneration: 0,
        authoritativeEpoch: 1,
        ingressOpen: true,
        captureCapacity: endpoint.getCapacity(),
        releasePreparationCapacity: endpoint.getCapacity(),
        cleanupCapacity: endpoint.getCapacity(),
        activeDomainBodyCount: 0,
        pendingCaptureReadbackCount: 0,
        pendingReleaseReadbackCount: 0,
        pendingCaptureBatchCount: 0,
        pendingReleaseBatchCount: 0,
        preparedBatchCount: 0,
        armedReleaseCount: 0,
        stagedReleaseCount: 0,
        commitRequested: false,
        targetFixedTick: 0,
        sourceTick: 0,
        completedThroughTick: 0,
        lastReleaseCommittedTick: 0,
        runtimeStatus: 0,
        errorFlags: 0,
        storageProfile: null,
        requiresRecovery: false,
        failure: null,
        terminal: null,
        ...overrides
    });
    endpoint.getProjectileCaptureRuntimeStatus = () => status;
    return status;
}

function createGameSystem({
    fixedResult = true,
    depleteOnFirstObserve = true,
    depleteOnObservation = null,
    gameplayWorldActorsEnabled = false,
    backendFactory = null,
    pentagonEffectDirectorFactory = null,
    jorangSplitLineageDirectorFactory
        = createIdleJorangSplitLineageDirector,
    projectileCaptureDirectorFactory = null,
    useRealCoreImpactDirector = false,
    initialCameraZoom = undefined
} = {}) {
    let backend = null;
    const directorFactory = useRealCoreImpactDirector
        ? null
        : createDirectorFactory({
            depleteOnObservation: Number.isSafeInteger(depleteOnObservation)
                ? depleteOnObservation
                : depleteOnFirstObserve
                    ? 1
                    : -1
        });
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
        enemySimulationBackendFactory(_dependencies, endpointOptions) {
            backend = backendFactory
                ? backendFactory(endpointOptions)
                : new TerminalBackend({
                    fixedResult,
                    sessionGeneration: endpointOptions.sessionGeneration
                });
            return backend;
        },
        ...(directorFactory
            ? { enemyCoreImpactDirectorFactory: directorFactory }
            : {}),
        ...(pentagonEffectDirectorFactory
            ? { pentagonEffectDirectorFactory }
            : {}),
        jorangSplitLineageDirectorFactory,
        ...(projectileCaptureDirectorFactory
            ? { projectileCaptureDirectorFactory }
            : {})
    };
    const gameSystem = new GameSystem(dependencies, {
        enemyWaveEnabled: false,
        gameplayWorldActorsEnabled,
        initialCameraZoom
    });
    assert.equal(gameSystem.enter(), true);
    return { backend, directorFactory, gameSystem };
}

test('Core depletion은 RunFailed 한 번, public ingress 즉시 gate, 마지막 submit 한 번 뒤 terminal no-op을 보장한다', () => {
    const { backend, directorFactory, gameSystem } = createGameSystem();
    const endpoint = gameSystem.getGpuSimulationEndpoint();
    const outcome = gameSystem.getRunOutcome();
    const rawLifecycleOwner = endpoint.getLifecycleCommandOwner();
    const rawFixedOwner = endpoint.fixedCommandOwner;
    const cleanupPort = directorFactory.state.coreImpactCleanupPort;
    installProjectileCaptureRuntimeStatus(endpoint, {
        authoritativeEpoch: 0,
        completedThroughTick: 1
    });
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
    assert.equal(
        endpoint.getStatus().formationCommands.backend
            .pendingTransformReadbackCount,
        0
    );
    assert.equal(cleanupPort.requestCommittedCoreImpactCleanup(
        { entityId: 99, incarnation: 1 },
        2,
        'core-impact:sealed-stale-port'
    ).reason, 'core-impact-cleanup-port-revoked');
    assert.equal(rawFixedOwner.requestBodyControl(
        {},
        2,
        'sealed:raw-control'
    ).accepted, false);
    assert.equal(rawFixedOwner.requestSourceRelativeSpawn(
        {},
        2,
        'sealed:raw-source-relative'
    ).accepted, false);

    const gameplayStatus = gameSystem.getGameplayStatus();
    assert.equal(gameplayStatus.outcome.state, RUN_OUTCOME_STATE.DEFEATED);
    assert.equal(gameplayStatus.outcome.runFailedFact.type, 'RunFailed');
    assert.equal(gameplayStatus.terminal.state, 'SEALED');
    assert.equal(
        backend.calls.indexOf('tower-gameplay-target-clear')
            < backend.calls.indexOf('fixed'),
        true
    );
    assert.equal(
        endpoint.getStatus().backend.fixedPrimitives
            .towerGameplayTarget.configured,
        false
    );
    assert.equal(
        gameSystem.getObjectSystem().getGpuWorldActorStatus()
            .towerGameplayTargetConfigured,
        false
    );
    assert.equal(gameSystem.isGpuWorldRecoveryRequired(), false);
    assert.equal(gameSystem.restartGpuWorldAtSafeWaveBoundary(), false);

    gameSystem.update();
    gameSystem.draw();
    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(backend.calls.filter((call) => call === 'fixed').length, 1);
    assert.strictEqual(gameSystem.getRunOutcome(), outcome);
    assert.equal(outcome.getRunFailedFact().type, 'RunFailed');
});

test('Capture terminal success gate는 owner/backend/runtime의 exact final tuple만 허용한다', () => {
    const gateStart = gameObjectSystemSource.indexOf(
        'const projectileCaptureSettlementSubmitted'
    );
    const gateEnd = gameObjectSystemSource.indexOf(
        'const projectileCaptureRosterSealed',
        gateStart
    );
    assert.ok(gateStart >= 0 && gateEnd > gateStart);
    const gateSource = gameObjectSystemSource.slice(gateStart, gateEnd);

    for (const exactGate of [
        /projectileCaptureOwnerEvidence\.abiVersion[\s\S]*?=== GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION/,
        /projectileCaptureOwnerEvidence\.submittedTick === fixedTick/,
        /projectileCaptureOwnerEvidence\.completedThroughTick === fixedTick/,
        /projectileCaptureBackendEvidence\.submittedTick === fixedTick/,
        /projectileCaptureBackendEvidence\.completedThroughTick === fixedTick/,
        /projectileCaptureOwnerEvidence\.sessionGeneration[\s\S]*?=== projectileCaptureBackendEvidence\.sessionGeneration/,
        /projectileCaptureOwnerEvidence\.deviceGeneration[\s\S]*?=== projectileCaptureBackendEvidence\.deviceGeneration/,
        /projectileCaptureOwnerEvidence\.authoritativeEpoch[\s\S]*?=== projectileCaptureBackendEvidence\.authoritativeEpoch/,
        /projectileCaptureRuntimeEvidence\.sessionGeneration[\s\S]*?=== projectileCaptureBackendEvidence\.sessionGeneration/,
        /projectileCaptureRuntimeEvidence\.deviceGeneration[\s\S]*?=== projectileCaptureBackendEvidence\.deviceGeneration/,
        /projectileCaptureRuntimeEvidence\.authoritativeEpoch[\s\S]*?=== projectileCaptureBackendEvidence\.authoritativeEpoch/,
        /projectileCaptureRuntimeEvidence\.completedThroughTick === fixedTick/
    ]) {
        assert.match(gateSource, exactGate);
    }
    assert.doesNotMatch(gateSource, /completedThroughTick\s*>=\s*fixedTick/);
});

test('Capture terminal owner/backend tuple mismatch는 success seal 없이 one-shot fail-closed한다', () => {
    const { gameSystem } = createGameSystem();
    const endpoint = gameSystem.getGpuSimulationEndpoint();
    installProjectileCaptureRuntimeStatus(endpoint, {
        authoritativeEpoch: 0,
        completedThroughTick: 1
    });
    const readTerminalEvidence = endpoint
        .getTerminalProjectileCaptureProgramCancelStatus.bind(endpoint);
    endpoint.getTerminalProjectileCaptureProgramCancelStatus = () => {
        const evidence = readTerminalEvidence();
        if (!evidence?.owner) {
            return evidence;
        }
        return Object.freeze({
            ...evidence,
            owner: Object.freeze({
                ...evidence.owner,
                authoritativeEpoch: evidence.owner.authoritativeEpoch + 1
            })
        });
    };

    assert.equal(gameSystem.fixedUpdate(), false);
    const terminal = gameSystem.getGameplayStatus().terminal;
    assert.equal(terminal.state, 'SEALED_FAILED');
    assert.equal(
        terminal.diagnostic.stage,
        'terminal-projectile-capture-settlement'
    );
    assert.equal(gameSystem.isGpuWorldRecoveryRequired(), false);
    assert.equal(gameSystem.fixedUpdate(), true);
    gameSystem.destroy();
});

test('실제 Core director는 actor-spawn 뒤 committed Core arrival을 exact cleanup과 함께 terminal final submit으로 닫는다', () => {
    const { backend, gameSystem } = createGameSystem({
        gameplayWorldActorsEnabled: true,
        useRealCoreImpactDirector: true,
        initialCameraZoom: 2,
        backendFactory: (endpointOptions) => new CoreImpactBackend({
            sessionGeneration: endpointOptions.sessionGeneration
        })
    });
    assert.ok(backend instanceof CoreImpactBackend);
    assert.equal(gameSystem.fixedUpdate(), true);
    const objectSystem = gameSystem.getObjectSystem();
    const endpoint = gameSystem.getGpuSimulationEndpoint();
    const initialActorStatus = objectSystem.getGpuWorldActorStatus();
    const coreHandle = initialActorStatus.coreProxyHandle;
    const towerHandle = initialActorStatus.towerHandle;
    assert.ok(coreHandle);
    assert.ok(towerHandle);
    gameSystem.update();
    assert.equal(objectSystem.getTower().getStatus().followEnabled, true);

    const targetFixedTick = gameSystem.getNextGpuLifecycleFixedTick();
    const coreIntegrity = gameSystem.getCoreIntegrity();
    const terminalPentaDefinition = Object.freeze({
        ...BASIC_PENTA_ENEMY_DATA,
        id: 'terminal-core-impact-penta'
    });
    const enemyReceipt = endpoint.requestSpawn(createGpuEnemySpawnIntent({
        definition: terminalPentaDefinition,
        waveEnemyModifiers: {
            global: {
                absolute: {
                    coreImpactDamage: coreIntegrity.getMaxIntegrity(),
                    bountyBudget: 9
                }
            }
        },
        knownDefinitionIds: [terminalPentaDefinition.id],
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
    gameSystem.update();
    const enemyHandle = endpoint.getRegistry().copyActiveHandlesInto([], {
        kindId: 'enemy'
    }).at(0);
    assert.ok(enemyHandle);
    assert.equal(gameSystem.getPentagonEffectStatus().activeEmitterCount, 1);
    const terminalFixedTick = gameSystem.getNextGpuLifecycleFixedTick();
    assert.equal(endpoint.requestDespawn(
        enemyHandle,
        'player-kill',
        terminalFixedTick,
        'terminal-core-impact:prequeued-general'
    ).accepted, true);
    backend.completedEventBatches.push(Object.freeze({
        ...backend.protocol,
        previousSourceTick: 0,
        previousSubmittedTick: 0,
        sourceTick: 2,
        submittedTick: 2,
        completedThroughTick: 2,
        atomicTransformFirstHitCapacityRejected: false,
        retryableAtomicTransformFirstHitCapacityRejected: false,
        atomicTransformFirstHitRejectionReason: null,
        atomicTransformFirstHitCandidateCount: 0,
        atomicTransformFirstHitCommittedCount: 0,
        atomicTransformFirstHitEventBase: 0,
        atomicTransformFirstHitEventCapacity: 1,
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
    installProjectileCaptureRuntimeStatus(endpoint, {
        authoritativeEpoch: 0,
        completedThroughTick: terminalFixedTick
    });

    const fixedCallsBeforeTerminal = backend.calls.filter((call) => call === 'fixed').length;
    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(gameSystem.getRunOutcome().getState(), RUN_OUTCOME_STATE.DEFEATED);
    const gameplayStatus = gameSystem.getGameplayStatus();
    assert.equal(gameplayStatus.terminal.state, 'SEALED');
    const finalClearIndex = backend.calls.lastIndexOf(
        'tower-gameplay-target-clear'
    );
    const finalSubmitIndex = backend.calls.lastIndexOf('fixed');
    assert.equal(finalClearIndex >= 0 && finalClearIndex < finalSubmitIndex, true);
    assert.equal(
        endpoint.getStatus().backend.fixedPrimitives
            .towerGameplayTarget.configured,
        false
    );
    assert.equal(
        objectSystem.getGpuWorldActorStatus().towerGameplayTargetConfigured,
        false
    );
    assert.equal(
        objectSystem.getGpuWorldActorStatus().trackedTowerConfigured,
        true
    );
    assert.deepEqual({ ...backend.trackedHandle }, { ...towerHandle });
    assert.equal(gameplayStatus.pentagonEffect.terminalFinalFixedTick,
        terminalFixedTick);
    assert.equal(gameplayStatus.pentagonEffect.terminalFixedCommitObserved, true);
    assert.equal(gameplayStatus.pentagonEffect.terminalLifecycleObserved, true);
    assert.equal(gameplayStatus.pentagonEffect.terminalRosterSealed, true);
    assert.equal(endpoint.getStatus().gameplayIngressOpen, false);
    assert.equal(endpoint.getRegistry().has(enemyHandle), false);
    const terminalEffectStatus = gameSystem.getPentagonEffectStatus();
    assert.equal(terminalEffectStatus.activeEmitterCount, 0);
    assert.equal(terminalEffectStatus.terminal.fixedCommitObserved, true);
    assert.equal(terminalEffectStatus.terminal.lifecycleObserved, true);
    assert.equal(terminalEffectStatus.terminal.rosterSealed, true);
    assert.equal(endpoint.getPendingCommandCount(), 0);
    const committedCleanup = endpoint.getStatus().lifecycle.lastCommitResult
        .despawned.find(({ handle }) => handleKey(handle) === handleKey(enemyHandle));
    assert.equal(committedCleanup.commandId, 'terminal-core-impact:prequeued-general');
    assert.equal(committedCleanup.reason, 'player-kill');
    assert.equal(committedCleanup.disposition, 'CORE_IMPACT');
    assert.equal(committedCleanup.bountyEligible, false);
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

    const fixedTickAtSeal = gameSystem.getFixedTick();
    const enemyFixedTickAtSeal = objectSystem.getLastCompletedEnemyFixedTick();
    const nextLifecycleTickAtSeal = gameSystem.getNextGpuLifecycleFixedTick();
    const presentationCountAtSeal = backend.presentationFrames.length;
    const referenceSecondsAtSeal = backend.referencePresentationSeconds;
    const towerStatusAtSeal = objectSystem.getTower().getStatus();
    const cameraTarget = objectSystem.getCameraFollowTarget();
    const cameraTargetPositionAtSeal = Object.freeze({
        ...cameraTarget.copyCameraFollowPositionInto({})
    });
    const camera = objectSystem.getWorldViewProjection();
    const cameraAtSeal = Object.freeze({
        revision: camera.getProjectionRevision(),
        x: camera.viewCenterWorld.x,
        y: camera.viewCenterWorld.y
    });
    const gameplayStatusAtSeal = gameSystem.getGameplayStatus();

    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(gameSystem.fixedUpdate(), true);
    gameSystem.update();
    gameSystem.update();
    gameSystem.synchronizePresentation();
    gameSystem.draw();

    assert.equal(backend.calls.filter((call) => call === 'fixed').length, fixedCallsBeforeTerminal + 1);
    assert.equal(gameSystem.getFixedTick(), fixedTickAtSeal);
    assert.equal(objectSystem.getLastCompletedEnemyFixedTick(), enemyFixedTickAtSeal);
    assert.equal(gameSystem.getNextGpuLifecycleFixedTick(), nextLifecycleTickAtSeal);
    assert.equal(backend.presentationFrames.length, presentationCountAtSeal);
    assert.equal(backend.referencePresentationSeconds, referenceSecondsAtSeal);
    assert.deepEqual(objectSystem.getTower().getStatus(), towerStatusAtSeal);
    assert.deepEqual(
        cameraTarget.copyCameraFollowPositionInto({}),
        cameraTargetPositionAtSeal
    );
    assert.deepEqual({
        revision: camera.getProjectionRevision(),
        x: camera.viewCenterWorld.x,
        y: camera.viewCenterWorld.y
    }, cameraAtSeal);
    assert.deepEqual(gameSystem.getGameplayStatus(), gameplayStatusAtSeal);
    assert.equal(gameSystem.restartGpuWorldAtSafeWaveBoundary(), false);
});

test('Tower death clear 실패와 같은 completed batch의 Core depletion도 관찰 후 RunFailed로 seal한다', () => {
    const { backend, directorFactory, gameSystem } = createGameSystem({
        gameplayWorldActorsEnabled: true,
        depleteOnFirstObserve: false,
        depleteOnObservation: 2,
        backendFactory: (endpointOptions) => new CoreImpactBackend({
            sessionGeneration: endpointOptions.sessionGeneration,
            gameplayTargetClearAccepted: false
        })
    });
    assert.equal(gameSystem.fixedUpdate(), true);
    const objectSystem = gameSystem.getObjectSystem();
    const endpoint = gameSystem.getGpuSimulationEndpoint();
    const actorStatus = objectSystem.getGpuWorldActorStatus();
    assert.ok(actorStatus.towerHandle);
    assert.ok(actorStatus.coreProxyHandle);
    assert.equal(directorFactory.state.observations, 1);

    backend.completedEventBatches.push(Object.freeze({
        ...backend.protocol,
        previousSourceTick: 0,
        previousSubmittedTick: 0,
        sourceTick: 1,
        submittedTick: 1,
        completedThroughTick: 1,
        atomicTransformFirstHitCapacityRejected: false,
        retryableAtomicTransformFirstHitCapacityRejected: false,
        atomicTransformFirstHitRejectionReason: null,
        atomicTransformFirstHitCandidateCount: 0,
        atomicTransformFirstHitCommittedCount: 0,
        atomicTransformFirstHitEventBase: 0,
        atomicTransformFirstHitEventCapacity: 1,
        events: Object.freeze([
            Object.freeze({
                type: 'contact',
                eventType: 'damage-applied',
                sequence: 0,
                entityId: actorStatus.coreProxyHandle.entityId,
                incarnation: actorStatus.coreProxyHandle.incarnation,
                otherEntityId: actorStatus.towerHandle.entityId,
                otherIncarnation: actorStatus.towerHandle.incarnation,
                valueFixedPoint: 3000,
                damage: 30,
                reason: 'target-died'
            }),
            Object.freeze({
                type: 'death',
                sequence: 1,
                entityId: actorStatus.towerHandle.entityId,
                incarnation: actorStatus.towerHandle.incarnation,
                flags: 1,
                reason: 'health-depleted'
            })
        ])
    }));

    assert.equal(gameSystem.fixedUpdate(), false);
    assert.equal(directorFactory.state.observations, 2);
    assert.equal(gameSystem.getCoreIntegrity().isDepleted(), true);
    assert.equal(gameSystem.getRunOutcome().getState(), RUN_OUTCOME_STATE.DEFEATED);
    assert.equal(gameSystem.getRunOutcome().getRunFailedFact().type, 'RunFailed');
    assert.equal(
        gameSystem.getGameplayStatus().terminal.state,
        'SEALED_FAILED'
    );
    assert.equal(
        gameSystem.getGameplayStatus().terminal.diagnostic.stage,
        'terminal-tower-gameplay-target-clear'
    );
    assert.equal(
        backend.calls.filter((call) => call === 'fixed').length,
        1
    );
    assert.equal(objectSystem.getLastCompletedGpuEvents().deathEvents.length, 1);
    assert.equal(
        objectSystem.getTerminalStatus().lastCoreImpactFacts.some(
            ({ type }) => type === 'CoreDepleted'
        ),
        true
    );
    assert.equal(endpoint.getStatus().gameplayIngressOpen, false);
    assert.equal(endpoint.getPendingCommandCount(), 0);
    assert.equal(
        objectSystem.getGpuWorldActorStatus().towerGameplayTargetConfigured,
        false
    );

    gameSystem.destroy();
});

test('마지막 terminal fixed submit 실패는 retry/recovery 없이 SEALED_FAILED diagnostic을 남기고 이후 true no-op이다', () => {
    const { backend, directorFactory, gameSystem } = createGameSystem({
        fixedResult: false
    });
    const endpoint = gameSystem.getGpuSimulationEndpoint();
    const rawFixedOwner = endpoint.fixedCommandOwner;
    const cleanupPort = directorFactory.state.coreImpactCleanupPort;

    assert.equal(gameSystem.fixedUpdate(), false);
    const terminal = gameSystem.getGameplayStatus().terminal;
    assert.equal(terminal.state, 'SEALED_FAILED');
    assert.equal(terminal.diagnostic.stage, 'terminal-fixed-submit');
    assert.equal(gameSystem.isGpuWorldRecoveryRequired(), false);
    assert.equal(backend.calls.filter((call) => call === 'fixed').length, 1);
    assert.equal(endpoint.getPendingCommandCount(), 0);
    assert.equal(endpoint.getRegistry().getReservedCount(), 0);
    assert.equal(cleanupPort.requestCommittedCoreImpactCleanup(
        { entityId: 99, incarnation: 1 },
        2,
        'core-impact:sealed-failed-stale-port'
    ).reason, 'core-impact-cleanup-port-revoked');
    assert.equal(rawFixedOwner.requestBodyControl(
        {},
        2,
        'sealed-failed:raw-control'
    ).accepted, false);
    assert.equal(rawFixedOwner.requestSourceRelativeSpawn(
        {},
        2,
        'sealed-failed:raw-source'
    ).accepted, false);

    const gameFixedTickAtSeal = gameSystem.getFixedTick();
    const objectFixedTickAtSeal = gameSystem.getObjectSystem()
        .getLastCompletedEnemyFixedTick();
    assert.equal(gameSystem.fixedUpdate(), true);
    gameSystem.update();
    gameSystem.synchronizePresentation();
    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(gameSystem.getFixedTick(), gameFixedTickAtSeal);
    assert.equal(
        gameSystem.getObjectSystem().getLastCompletedEnemyFixedTick(),
        objectFixedTickAtSeal
    );
    assert.equal(backend.calls.filter((call) => call === 'fixed').length, 1);
    assert.equal(backend.calls.filter((call) => call === 'presentation').length, 0);
    assert.equal(backend.calls.filter((call) => call === 'synchronize').length, 0);
    assert.equal(gameSystem.restartGpuWorldAtSafeWaveBoundary(), false);
});

test('terminal cancel final evidence의 ABI version/count/tick mismatch는 success seal을 금지한다', () => {
    for (const mismatchKind of ['version', 'count', 'tick']) {
        const { backend, gameSystem } = createGameSystem({
            backendFactory: (options) => new TerminalEvidenceMismatchBackend(
                mismatchKind,
                { sessionGeneration: options.sessionGeneration }
            )
        });
        assert.equal(gameSystem.fixedUpdate(), false, mismatchKind);
        const terminal = gameSystem.getGameplayStatus().terminal;
        assert.equal(terminal.state, 'SEALED_FAILED', mismatchKind);
        assert.equal(
            terminal.diagnostic.stage,
            'terminal-fixed-program-cancel',
            mismatchKind
        );
        assert.equal(
            backend.calls.filter((call) => call === 'fixed').length,
            1,
            mismatchKind
        );
        assert.equal(gameSystem.fixedUpdate(), true, mismatchKind);
        assert.equal(
            backend.calls.filter((call) => call === 'fixed').length,
            1,
            mismatchKind
        );
        gameSystem.destroy();
    }
});

test('Effect terminal cancel의 ABI/count/submitted tick mismatch도 success seal을 금지한다', () => {
    for (const mismatchKind of ['effect-version', 'effect-count', 'effect-tick']) {
        const { backend, gameSystem } = createGameSystem({
            backendFactory: (options) => new TerminalEvidenceMismatchBackend(
                mismatchKind,
                { sessionGeneration: options.sessionGeneration }
            )
        });
        assert.equal(gameSystem.fixedUpdate(), false, mismatchKind);
        const terminal = gameSystem.getGameplayStatus().terminal;
        assert.equal(terminal.state, 'SEALED_FAILED', mismatchKind);
        assert.equal(
            terminal.diagnostic.stage,
            'terminal-effect-program-cancel',
            mismatchKind
        );
        assert.equal(
            backend.calls.filter((call) => call === 'fixed').length,
            1,
            mismatchKind
        );
        assert.equal(gameSystem.fixedUpdate(), true, mismatchKind);
        assert.equal(
            backend.calls.filter((call) => call === 'fixed').length,
            1,
            mismatchKind
        );
        gameSystem.destroy();
    }
});

test('Core가 이미 depleted인 protocol-failure 경로도 RunFailed를 한 번 생성하고 재시도 없이 seal한다', () => {
    const { backend, directorFactory, gameSystem } = createGameSystem({
        depleteOnFirstObserve: false
    });
    const endpoint = gameSystem.getGpuSimulationEndpoint();
    const rawFixedOwner = endpoint.fixedCommandOwner;
    const cleanupPort = directorFactory.state.coreImpactCleanupPort;
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
    assert.equal(endpoint.getPendingCommandCount(), 0);
    assert.equal(endpoint.getRegistry().getReservedCount(), 0);
    assert.equal(cleanupPort.requestCommittedCoreImpactCleanup(
        { entityId: 99, incarnation: 1 },
        2,
        'core-impact:protocol-failed-stale-port'
    ).reason, 'core-impact-cleanup-port-revoked');
    assert.equal(rawFixedOwner.requestBodyControl(
        {},
        2,
        'protocol-failed:raw-control'
    ).accepted, false);
    assert.equal(rawFixedOwner.requestSourceRelativeSpawn(
        {},
        2,
        'protocol-failed:raw-source'
    ).accepted, false);

    assert.equal(gameSystem.fixedUpdate(), true);
    assert.strictEqual(outcome.getRunFailedFact(), fact);
    assert.equal(backend.calls.filter((call) => call === 'fixed').length, 0);
});

test('Tower status가 없어도 Core가 남아 있으면 outcome은 RUNNING으로 유지된다', () => {
    const { gameSystem } = createGameSystem({ depleteOnFirstObserve: false });
    const roster = gameSystem.towerCombatRoster;
    const towerGroupState = roster.getTowerGroupState();
    assert.strictEqual(gameSystem.getTowerGroupState(), towerGroupState);
    const towerHandle = Object.freeze({ entityId: 701, incarnation: 1 });
    const protocol = Object.freeze({
        sessionGeneration: 701,
        deviceGeneration: 0,
        authoritativeEpoch: 0
    });
    towerGroupState.bindGpuBody(
        PRIMARY_TOWER_LOGICAL_ID,
        towerHandle,
        protocol
    );
    towerGroupState.commitCompletedEvents({
        events: [Object.freeze({
            type: 'death',
            eventType: 'death',
            disposition: 'despawn-requested',
            entityId: towerHandle.entityId,
            incarnation: towerHandle.incarnation,
            ...protocol,
            sourceTick: 1,
            sequence: 0,
            key: 'core-remains:zero-tower',
            reason: 'health-depleted'
        })]
    });
    assert.equal(roster.isPrimaryTowerAlive(), false);

    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(gameSystem.getCoreIntegrity().getCurrentIntegrity() > 0, true);
    assert.equal(gameSystem.getRunOutcome().getState(), RUN_OUTCOME_STATE.RUNNING);
    assert.equal(gameSystem.getGameplayStatus().outcome.defeated, false);
});

test('ProjectileCapture ready tuple drift는 capture-domain exact-zero에서 GPU binding만 한 번 갱신한다', () => {
    const captureDirectors = createTrackingProjectileCaptureDirectorFactory();
    const { gameSystem } = createGameSystem({
        depleteOnFirstObserve: false,
        projectileCaptureDirectorFactory: captureDirectors.factory
    });
    const objectSystem = gameSystem.getObjectSystem();
    const endpoint = gameSystem.getGpuSimulationEndpoint();
    const director = captureDirectors.instances[0];
    const resetCountBeforeDrift = director.resetCalls.length;
    // 첫 non-capture C/Tower/Core spawn이 lazy GPU init을 끝내면 simulation의
    // 전역 state는 ready지만 ProjectileCapture domain은 여전히 exact idle입니다.
    const runtime = installProjectileCaptureRuntimeStatus(endpoint, {
        state: 'ready'
    });

    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(director.resetCalls.length, resetCountBeforeDrift + 1);
    assert.deepEqual({
        sessionGeneration: director.getStatus().sessionGeneration,
        deviceGeneration: director.getStatus().deviceGeneration,
        authoritativeEpoch: director.getStatus().authoritativeEpoch
    }, {
        sessionGeneration: runtime.sessionGeneration,
        deviceGeneration: runtime.deviceGeneration,
        authoritativeEpoch: runtime.authoritativeEpoch
    });
    assert.equal(objectSystem.enemySimulationPaused, false);
    assert.equal(objectSystem.enemySimulationRecoveryRequired, false);
    assert.equal(gameSystem.isGpuWorldRecoveryRequired(), false);
    gameSystem.destroy();
});

test('ProjectileCapture active/pending/terminal/recovery tuple drift는 rebind 없이 fail-closed pause한다', () => {
    const cases = [
        Object.freeze({
            label: 'held-roster',
            director: Object.freeze({
                capturedProjectileCount: 1,
                heldCount: 1
            })
        }),
        Object.freeze({
            label: 'release-pending-batch',
            director: Object.freeze({
                capturedProjectileCount: 1,
                releasePendingCount: 1,
                pendingBatchCount: 1
            })
        }),
        Object.freeze({
            label: 'director-terminal',
            director: Object.freeze({
                terminal: Object.freeze({ finalFixedTick: 1 })
            })
        }),
        Object.freeze({
            label: 'director-recovery',
            director: Object.freeze({
                recoveryRequired: true,
                failure: Object.freeze({ code: 'fixture-director-recovery' })
            })
        }),
        Object.freeze({
            label: 'backend-active-domain',
            runtime: Object.freeze({
                state: 'ready',
                activeDomainBodyCount: 1
            })
        }),
        Object.freeze({
            label: 'backend-pending-capture-readback',
            runtime: Object.freeze({
                state: 'ready',
                pendingCaptureReadbackCount: 1
            })
        }),
        Object.freeze({
            label: 'backend-pending-release-batch',
            runtime: Object.freeze({
                state: 'ready',
                pendingReleaseBatchCount: 1
            })
        }),
        Object.freeze({
            label: 'backend-prepared-armed-staged-commit',
            runtime: Object.freeze({
                state: 'ready',
                preparedBatchCount: 1,
                armedReleaseCount: 1,
                stagedReleaseCount: 1,
                commitRequested: true
            })
        }),
        Object.freeze({
            label: 'backend-terminal',
            runtime: Object.freeze({
                ingressOpen: false,
                terminal: Object.freeze({
                    state: 'armed',
                    finalFixedTick: 1
                })
            })
        }),
        Object.freeze({
            label: 'backend-recovery',
            runtime: Object.freeze({
                requiresRecovery: true,
                failure: 'fixture-backend-recovery'
            })
        })
    ];
    for (const scenario of cases) {
        const captureDirectors = createTrackingProjectileCaptureDirectorFactory();
        const { gameSystem } = createGameSystem({
            depleteOnFirstObserve: false,
            projectileCaptureDirectorFactory: captureDirectors.factory
        });
        const objectSystem = gameSystem.getObjectSystem();
        const endpoint = gameSystem.getGpuSimulationEndpoint();
        const director = captureDirectors.instances[0];
        director.setStatus(scenario.director);
        installProjectileCaptureRuntimeStatus(endpoint, scenario.runtime);
        const resetCountBeforeDrift = director.resetCalls.length;

        assert.equal(gameSystem.fixedUpdate(), false, scenario.label);
        assert.equal(
            director.resetCalls.length,
            resetCountBeforeDrift,
            scenario.label
        );
        assert.equal(objectSystem.enemySimulationPaused, true, scenario.label);
        assert.equal(
            objectSystem.enemySimulationRecoveryRequired,
            true,
            scenario.label
        );
        gameSystem.destroy();
    }
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
        enemyCoreImpactDirectorFactory: directors.factory,
        jorangSplitLineageDirectorFactory:
            createIdleJorangSplitLineageDirector
    }, {
        enemyWaveEnabled: false,
        gameplayWorldActorsEnabled: false
    });
    assert.equal(gameSystem.enter(), true);

    const coreIntegrity = gameSystem.getCoreIntegrity();
    const outcome = gameSystem.getRunOutcome();
    const objectSystem = gameSystem.getObjectSystem();
    const oldEndpoint = gameSystem.getGpuSimulationEndpoint();
    const oldEffectDirector = objectSystem.pentagonEffectDirector;
    const oldEffectPort = oldEndpoint.getEffectCommandPort();
    const oldDirector = directors.instances[0];
    const oldCleanupPort = oldDirector.coreImpactCleanupPort;
    assert.equal(oldDirector.resetCount, 1);
    assert.equal(
        typeof oldCleanupPort?.requestCommittedCoreImpactCleanup,
        'function'
    );

    assert.equal(gameSystem.restartGpuWorldAtSafeWaveBoundary(), true);
    const newEndpoint = gameSystem.getGpuSimulationEndpoint();
    const newEffectDirector = objectSystem.pentagonEffectDirector;
    const newEffectPort = newEndpoint.getEffectCommandPort();
    const newDirector = directors.instances[1];
    const newCleanupPort = newDirector.coreImpactCleanupPort;
    assert.notStrictEqual(newEndpoint, oldEndpoint);
    assert.equal(backends[0].destroyed, true);
    assert.equal(oldDirector.destroyed, true);
    assert.equal(oldEffectDirector.getStatus().destroyed, true);
    assert.notStrictEqual(newEffectDirector, oldEffectDirector);
    assert.equal(newEffectDirector.getStatus().activeEmitterCount, 0);
    assert.equal(oldEffectPort.requestPulseBatch({}).reason,
        'effect-command-port-revoked');
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
    assert.strictEqual(objectSystem.pentagonEffectDirector, newEffectDirector);
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
    assert.equal(newEffectPort.requestPulseBatch({}).reason,
        'effect-command-port-revoked');
    assert.equal(newCleanupPort.requestCommittedCoreImpactCleanup(
        { entityId: 100, incarnation: 1 },
        3,
        'core-impact:destroyed-port'
    ).reason, 'core-impact-cleanup-port-revoked');
});

test('replacement Pentagon director factory 실패는 old world를 보존하고 candidate Effect port를 revoke한다', () => {
    const backends = [];
    const effectDirectors = createTrackingPentagonEffectDirectorFactory();
    const { gameSystem } = createGameSystem({
        depleteOnFirstObserve: false,
        backendFactory: (options) => {
            const backend = new TerminalBackend({
                sessionGeneration: options.sessionGeneration
            });
            backends.push(backend);
            return backend;
        },
        pentagonEffectDirectorFactory: effectDirectors.factory
    });
    const objectSystem = gameSystem.getObjectSystem();
    const oldEndpoint = gameSystem.getGpuSimulationEndpoint();
    const oldDirector = objectSystem.pentagonEffectDirector;
    const oldPort = oldEndpoint.getEffectCommandPort();

    effectDirectors.failNextCreation();
    assert.equal(gameSystem.restartGpuWorldAtSafeWaveBoundary(), false);
    assert.strictEqual(gameSystem.getGpuSimulationEndpoint(), oldEndpoint);
    assert.strictEqual(objectSystem.pentagonEffectDirector, oldDirector);
    assert.equal(oldDirector.getStatus().destroyed, false);
    assert.equal(oldPort.requestPulseBatch({}).reason,
        'effect-pulse-batch-contract');
    assert.equal(backends.length, 2);
    assert.equal(backends[1].destroyed, true);
    assert.equal(effectDirectors.failedPorts.length, 1);
    assert.equal(effectDirectors.failedPorts[0].requestPulseBatch({}).reason,
        'effect-command-port-revoked');

    gameSystem.destroy();
    assert.equal(oldPort.requestPulseBatch({}).reason,
        'effect-command-port-revoked');
});
