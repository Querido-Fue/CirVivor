import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import { loadGameModule } from './support/source_module_loader.mjs';

const { BaseScene } = await loadGameModule('scene/_base_scene.js');
const { GameSystem } = await loadGameModule('ingame/game_system.js');
const { GameObjectSystem } = await loadGameModule(
    'ingame/object/game_object_system.js'
);
const { CoreIntegrity } = await loadGameModule(
    'ingame/state/core_integrity.js'
);
const { TowerCombatRoster } = await loadGameModule(
    'ingame/object/tower/tower_combat_roster.js'
);
const { GAME_WORLD_SESSION_MODE } = await loadGameModule(
    'ingame/game_world_session_mode.js'
);
const {
    createGpuProjectileSpawnIntent
} = await loadGameModule(
    'ingame/object/projectile/gpu_projectile_spawn_adapter.js'
);
const {
    createGpuTowerSpawnIntent
} = await loadGameModule(
    'ingame/object/tower/gpu_tower_spawn_adapter.js'
);
const {
    TOWER_RECOVERY_PLACEMENT_POLICY_ID,
    createTowerRecoveryPlacementDescriptor
} = await loadGameModule(
    'ingame/object/tower/tower_group_contract.js'
);
const {
    ABILITY_CREATION_ORIGIN_CODE
} = await loadGameModule('ingame/contract/ability_execution_contract.js');
const {
    SENTENCE_ACTION_CODE
} = await loadGameModule('ingame/contract/word_sentence_contract.js');
const {
    R5_THROW_ACTOR_ACTION_PROFILE
} = await loadGameModule('data/word/r5_actor_action_profile_data.js');
const {
    R3_ENEMIES_SHOOT_ENEMIES_SENTENCE,
    R3_TOWER_SHOOTS_ENEMY_SENTENCE
} = await loadGameModule('data/word/r3_word_catalog_data.js');
const {
    PROJECTILE_TARGET_POLICY_ID
} = await loadGameModule(
    'ingame/contract/projectile_target_policy_contract.js'
);
const {
    GAMEPLAY_TEAM_ID
} = await loadGameModule('ingame/contract/gameplay_team_contract.js');
const {
    encodeGpuCircleBodyFixedPoint
} = await loadGameModule('ingame/physics/gpu/gpu_circle_body_abi.js');
const { GPU_BODY_PRESENTATION_PROFILE } = await loadGameModule(
    'ingame/physics/gpu/gpu_body_presentation_clock.js'
);
const gameSceneSource = await readFile(
    new URL('../script/module/scene/game/_game_scene.js', import.meta.url),
    'utf8'
);
const gameSceneContext = vm.createContext({});
const gameSceneModule = new vm.SourceTextModule(gameSceneSource, {
    context: gameSceneContext,
    identifier: '_game_scene.js'
});
await gameSceneModule.link(async (specifier) => {
    const exportsBySpecifier = {
        'scene/_base_scene.js': { BaseScene },
        'ingame/game_system.js': { GameSystem },
        'simulation/fixed_step_result_contract.js': {
            FIXED_STEP_RESULT: Object.freeze({
                COMPLETED: 'COMPLETED',
                DEFERRED_BACKPRESSURE: 'DEFERRED_BACKPRESSURE',
                INTENTIONAL_PAUSE: 'INTENTIONAL_PAUSE'
            })
        },
        './game_scene_dependency_factory.js': {
            createGameSceneDependencies() {
                throw new Error('테스트는 명시적 GameScene dependencies를 사용해야 합니다.');
            }
        }
    };
    const exports = exportsBySpecifier[specifier];
    if (!exports) {
        throw new Error(`예상하지 못한 GameScene import입니다: ${specifier}`);
    }
    const exportNames = Object.keys(exports);
    return new vm.SyntheticModule(exportNames, function setExports() {
        for (const exportName of exportNames) {
            this.setExport(exportName, exports[exportName]);
        }
    }, { context: gameSceneContext });
});
await gameSceneModule.evaluate();
const { GameScene } = gameSceneModule.namespace;

async function loadGameSceneWithGameSystem(GameSystemClass) {
    const context = vm.createContext({});
    const module = new vm.SourceTextModule(gameSceneSource, {
        context,
        identifier: '_game_scene.presentation_profile.js'
    });
    const modules = new Map([
        ['scene/_base_scene.js', new vm.SyntheticModule(
            ['BaseScene'],
            function initializeBaseScene() {
                this.setExport('BaseScene', BaseScene);
            },
            { context }
        )],
        ['ingame/game_system.js', new vm.SyntheticModule(
            ['GameSystem'],
            function initializeGameSystem() {
                this.setExport('GameSystem', GameSystemClass);
            },
            { context }
        )],
        ['simulation/fixed_step_result_contract.js', new vm.SyntheticModule(
            ['FIXED_STEP_RESULT'],
            function initializeFixedStepResult() {
                this.setExport('FIXED_STEP_RESULT', Object.freeze({
                    COMPLETED: 'COMPLETED',
                    DEFERRED_BACKPRESSURE: 'DEFERRED_BACKPRESSURE',
                    INTENTIONAL_PAUSE: 'INTENTIONAL_PAUSE'
                }));
            },
            { context }
        )],
        ['./game_scene_dependency_factory.js', new vm.SyntheticModule(
            ['createGameSceneDependencies'],
            function initializeDependencyFactory() {
                this.setExport('createGameSceneDependencies', () => {
                    throw new Error('테스트는 명시적 GameScene dependencies를 사용해야 합니다.');
                });
            },
            { context }
        )]
    ]);
    await module.link((specifier) => {
        const dependency = modules.get(specifier);
        if (!dependency) {
            throw new Error(`예상하지 못한 GameScene import입니다: ${specifier}`);
        }
        return dependency;
    });
    await module.evaluate();
    return module.namespace.GameScene;
}

function handleKey(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

function sameHandle(left, right) {
    return left?.entityId === right?.entityId
        && left?.incarnation === right?.incarnation;
}

class RecoveryBackend {
    constructor(mode) {
        this.mode = mode;
        this.bodies = new Map();
        this.runtimeState = 'gpu-ready';
        this.recovering = false;
        this.hardFailNextFixed = false;
        this.initCount = 0;
        this.destroyCount = 0;
        this.towerGameplayTargetHandle = null;
        this.trackedHandle = null;
    }

    getCapacity() {
        return this.mode === 'capacity-one' ? 1 : 64;
    }

    init() {
        this.initCount++;
        if (this.mode === 'init-throws') {
            throw new Error('replacement backend init failure');
        }
        if (this.mode === 'init-deferred') {
            this.runtimeState = 'gpu-deferred';
            return false;
        }
        if (this.mode === 'init-returns-false') {
            this.runtimeState = 'gpu-unavailable';
            return false;
        }
        return true;
    }

    spawnBodies(bodies) {
        const handles = bodies.map((body) => {
            const handle = Object.freeze({
                entityId: body.entityId,
                incarnation: body.incarnation
            });
            this.bodies.set(handleKey(handle), body);
            return handle;
        });
        if (this.mode === 'fail-first-spawn') {
            this.recovering = true;
            this.runtimeState = 'gpu-requires-rebuild';
        }
        return {
            accepted: bodies.length,
            rejected: 0,
            handles,
            requiresRecovery: this.recovering
        };
    }

    despawnBodies(handles) {
        let removed = 0;
        for (const handle of handles) {
            removed += this.bodies.delete(handleKey(handle)) ? 1 : 0;
        }
        return { removed, rejected: handles.length - removed };
    }

    hasBody(handle) {
        return this.bodies.has(handleKey(handle));
    }

    hasActiveBodies() {
        return this.bodies.size > 0;
    }

    canControlBody(handle) {
        return this.hasBody(handle);
    }

    stageFixedPrograms(plan) {
        const controls = Array.isArray(plan?.controls) ? plan.controls : [];
        const sourceRelativeSpawns = Array.isArray(plan?.sourceRelativeSpawns)
            ? plan.sourceRelativeSpawns
            : [];
        const requested = controls.length + sourceRelativeSpawns.length;
        if (this.recovering) {
            return {
                accepted: 0,
                rejected: requested,
                requiresRecovery: true,
                reason: 'gpu-requires-rebuild'
            };
        }
        const hasStaleHandle = controls.some((control) => (
            !this.canControlBody(control)
        )) || sourceRelativeSpawns.some((spawn) => (
            !this.hasBody(spawn.sourceHandle)
        ));
        if (hasStaleHandle) {
            return {
                accepted: 0,
                rejected: requested,
                requiresRecovery: false,
                reason: 'stale-source'
            };
        }
        return {
            accepted: requested,
            rejected: 0,
            requiresRecovery: false
        };
    }

    configureTowerGameplayTarget(handle = null) {
        if (handle === null) {
            this.towerGameplayTargetHandle = null;
            return { accepted: true, configured: false };
        }
        if (!this.hasBody(handle)) {
            return { accepted: false, reason: 'stale-handle' };
        }
        this.towerGameplayTargetHandle = Object.freeze({
            entityId: handle.entityId,
            incarnation: handle.incarnation
        });
        return { accepted: true, configured: true };
    }

    configureTrackedBody(handle = null) {
        if (handle === null) {
            this.trackedHandle = null;
            return { accepted: true, tracked: false };
        }
        if (!this.hasBody(handle)) {
            return { accepted: false, reason: 'stale-handle' };
        }
        this.trackedHandle = Object.freeze({
            entityId: handle.entityId,
            incarnation: handle.incarnation
        });
        return { accepted: true, tracked: true };
    }

    fixedUpdate() {
        if (this.hardFailNextFixed) {
            this.hardFailNextFixed = false;
            this.recovering = true;
            this.runtimeState = 'gpu-requires-rebuild';
            return false;
        }
        return this.bodies.size > 0;
    }

    updatePresentation() {}

    synchronizePresentation() {}

    draw() {
        return this.bodies.size > 0;
    }

    getRuntimeState() {
        return this.runtimeState;
    }

    requiresRecovery() {
        return this.recovering;
    }

    destroy() {
        if (this.destroyCount > 0) {
            return;
        }
        this.destroyCount++;
        this.bodies.clear();
        this.towerGameplayTargetHandle = null;
        this.trackedHandle = null;
        this.runtimeState = 'destroyed';
    }
}

class CombatRecoveryBackend extends RecoveryBackend {
    constructor(mode, sessionGeneration) {
        super(mode);
        this.eventProtocol = Object.freeze({
            sessionGeneration,
            deviceGeneration: 7,
            authoritativeEpoch: 11
        });
        this.completedEventBatches = [];
        this.lastEventSourceTick = 0;
        this.lastEventSubmittedTick = 0;
        this.spawnBatches = [];
        this.fixedProgramPlans = [];
    }

    spawnBodies(bodies) {
        const batch = Array.from(bodies);
        this.spawnBatches.push(batch);
        return super.spawnBodies(batch);
    }

    stageFixedPrograms(plan) {
        this.fixedProgramPlans.push(Object.freeze({
            targetFixedTick: plan.targetFixedTick,
            controls: Object.freeze(Array.from(plan.controls ?? [])),
            sourceRelativeSpawns: Object.freeze(
                Array.from(plan.sourceRelativeSpawns ?? [])
            )
        }));
        return super.stageFixedPrograms(plan);
    }

    getEventProtocolState() {
        return this.eventProtocol;
    }

    queueCompletedEvents(sourceTick, events) {
        this.completedEventBatches.push(Object.freeze({
            ...this.eventProtocol,
            previousSourceTick: this.lastEventSourceTick,
            previousSubmittedTick: this.lastEventSubmittedTick,
            sourceTick,
            submittedTick: sourceTick,
            completedThroughTick: sourceTick,
            atomicTransformFirstHitCapacityRejected: false,
            retryableAtomicTransformFirstHitCapacityRejected: false,
            atomicTransformFirstHitRejectionReason: null,
            atomicTransformFirstHitCandidateCount: 0,
            atomicTransformFirstHitCommittedCount: 0,
            atomicTransformFirstHitEventBase: 0,
            atomicTransformFirstHitEventCapacity: 1,
            events: Object.freeze(Array.from(events, (event) => (
                Object.freeze({ ...event })
            )))
        }));
        this.lastEventSourceTick = sourceTick;
        this.lastEventSubmittedTick = sourceTick;
    }

    drainCompletedEventBatches(out = []) {
        out.push(...this.completedEventBatches.splice(0));
        return out;
    }

    getStatus() {
        return Object.freeze({
            state: this.getRuntimeState(),
            ...this.eventProtocol
        });
    }
}

class GroupCombatRecoveryBackend extends CombatRecoveryBackend {
    constructor(mode, sessionGeneration) {
        super(mode, sessionGeneration);
        this.towerGroupRevision = 0;
        this.towerGroupRecordCount = 0;
        this.towerGroupRosters = [];
        this.towerGroupCommands = [];
        this.towerCreationStageCalls = [];
    }

    synchronizeTowerGroupRoster(source) {
        const roster = Object.freeze({
            groupRevision: source.groupRevision,
            records: Object.freeze(Array.from(source.records))
        });
        this.towerGroupRosters.push(roster);
        this.towerGroupRevision = source.groupRevision;
        this.towerGroupRecordCount = source.records.filter(
            (record) => record.alive
        ).length;
        return Object.freeze({
            accepted: true,
            groupRevision: this.towerGroupRevision,
            recordCount: source.records.length,
            livingTowerCount: this.towerGroupRecordCount,
            requiresRecovery: false
        });
    }

    getTowerGroupRuntimeStatus() {
        return Object.freeze({
            state: 'ready',
            capacity: 64,
            groupRevision: this.towerGroupRevision,
            recordCount: this.towerGroupRecordCount,
            deviceGeneration: this.eventProtocol.deviceGeneration,
            authoritativeEpoch: this.eventProtocol.authoritativeEpoch,
            requiresRecovery: false
        });
    }

    stageTowerGroupCommand(command) {
        const snapshot = Object.freeze({
            ...command,
            moveIntent: Object.freeze({ ...command.moveIntent }),
            aimWorldPoint: Object.freeze({ ...command.aimWorldPoint })
        });
        this.towerGroupCommands.push(snapshot);
        return Object.freeze({
            accepted: true,
            acceptedCount: this.towerGroupRecordCount,
            rejectedCount: 0,
            requiresRecovery: false
        });
    }

    canStageTowerCreation() {
        return true;
    }

    getTowerCreationRuntimeStatus() {
        return Object.freeze({
            state: 'ready',
            recordCapacity: 64,
            requiresRecovery: false
        });
    }

    getAvailableTowerCreationBodyCapacity() {
        return 64;
    }

    preleaseTowerCreationBodies() {
        return Object.freeze({
            accepted: false,
            reason: 'unused-test-prelease',
            requiresRecovery: false
        });
    }

    cancelTowerCreationBodyPrelease() {
        return Object.freeze({
            accepted: true,
            cancelledCount: 0,
            requiresRecovery: false
        });
    }

    stageTowerCreationTransaction(request) {
        this.towerCreationStageCalls.push(request);
        return Object.freeze({
            accepted: false,
            reason: 'unused-test-stage',
            recoveryRequired: false
        });
    }

    drainCompletedTowerCreationTransactions(out = []) {
        return out;
    }

    finalizeTowerCreationTransaction() {
        return Object.freeze({
            accepted: true,
            committed: false,
            requiresRecovery: false
        });
    }

    cancelAllTowerCreations(reason = 'cancelled') {
        return Object.freeze({
            cancelledPreleaseCount: 0,
            reason,
            requiresRecovery: false
        });
    }
}

class TrackingHostileAttackDirector {
    constructor(options, sequence) {
        this.endpoint = options.endpoint;
        this.registry = options.registry;
        this.backend = options.backend;
        this.sequence = sequence;
        this.sessionGeneration = options.endpoint.getStatus().sessionGeneration;
        this.completedEventCalls = [];
        this.stageCalls = [];
        this.fixedCommitCalls = [];
        this.destroyCount = 0;
        this.destroyed = false;
        this.recoveryRequired = false;
    }

    observeCompletedEvents(snapshot) {
        this.completedEventCalls.push(snapshot);
        return Object.freeze({
            recoveryRequired: this.recoveryRequired,
            protocolFailure: null
        });
    }

    stageForFixedTick({ targetFixedTick, targetHandle }) {
        const exactTarget = targetHandle
            ? Object.freeze({
                entityId: targetHandle.entityId,
                incarnation: targetHandle.incarnation
            })
            : null;
        this.stageCalls.push(Object.freeze({
            targetFixedTick,
            targetHandle: exactTarget
        }));
        return Object.freeze({
            targetFixedTick,
            eligibleCount: 0,
            attemptedCount: 0,
            acceptedCount: 0,
            rejectedCount: 0,
            deferredCount: 0,
            commandIds: Object.freeze([]),
            recoveryRequired: this.recoveryRequired,
            protocolFailure: null
        });
    }

    observeFixedCommit(lifecycleResult, fixedTick) {
        this.fixedCommitCalls.push(Object.freeze({ lifecycleResult, fixedTick }));
        return Object.freeze({
            fixedTick,
            completedCount: 0,
            fixedAcceptedCount: 0,
            fixedRejectedCount: 0,
            spawnedArcherCount: 0,
            removedArcherCount: 0,
            recoveryRequired: this.recoveryRequired,
            protocolFailure: null
        });
    }

    requiresRecovery() {
        return this.recoveryRequired;
    }

    getStatus() {
        return Object.freeze({
            sequence: this.sequence,
            sessionGeneration: this.sessionGeneration,
            activeArcherCount: 0,
            pendingShotCount: 0,
            shotStartAttemptCount: 0,
            shotResolvedCount: 0,
            stageCallCount: this.stageCalls.length,
            lastTargetHandle: this.stageCalls.at(-1)?.targetHandle ?? null,
            recoveryRequired: this.recoveryRequired,
            protocolFailure: null,
            destroyed: this.destroyed
        });
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.destroyCount++;
        this.completedEventCalls.length = 0;
        this.stageCalls.length = 0;
        this.fixedCommitCalls.length = 0;
        this.recoveryRequired = false;
    }
}

function createTrackingHostileAttackDirectorFactory(options = {}) {
    const calls = [];
    const instances = [];
    return Object.freeze({
        calls,
        instances,
        factory(directorOptions) {
            const callNumber = calls.length + 1;
            calls.push(directorOptions);
            if (callNumber === options.throwOnCall) {
                throw new Error('replacement hostile director factory failure');
            }
            const director = new TrackingHostileAttackDirector(
                directorOptions,
                callNumber
            );
            instances.push(director);
            return director;
        }
    });
}

function createIdleProjectileCaptureDirector(options) {
    let destroyed = false;
    let sessionGeneration = options.sessionGeneration;
    let deviceGeneration = options.deviceGeneration;
    let authoritativeEpoch = options.authoritativeEpoch;
    return {
        observeLifecycle() {},
        observeCompletedEvents() {},
        observeCompletedCapturePrograms() {},
        observeCompletedReleasePrograms() {},
        stageForFixedTick() {
            return Object.freeze({ recoveryRequired: false });
        },
        observeFixedCommit() {},
        requiresRecovery() {
            return false;
        },
        getStatus() {
            return Object.freeze({
                destroyed,
                recoveryRequired: false,
                failure: null,
                terminal: null,
                sessionGeneration,
                deviceGeneration,
                authoritativeEpoch,
                capturedProjectileCount: 0,
                heldCount: 0,
                releasePendingCount: 0,
                pendingBatchCount: 0,
                terminalCleanupPendingCount: 0,
                pendingReadbackCount: 0,
                pendingStaleCompletionCount: 0
            });
        },
        resetGpuBinding(_registry, _commandPort, session, device, epoch) {
            sessionGeneration = session;
            deviceGeneration = device;
            authoritativeEpoch = epoch;
            return true;
        },
        closeForTerminal() {
            return Object.freeze({ accepted: true });
        },
        destroy() {
            destroyed = true;
        }
    };
}

function createIdleJorangSplitLineageDirector() {
    let destroyed = false;
    return {
        observeLifecycle() {},
        observeCompletedEvents() {},
        observeCompletedPreparations() {},
        stageForFixedTick() {
            return Object.freeze({ recoveryRequired: false });
        },
        observeFixedCommit() {},
        requiresRecovery() {
            return false;
        },
        getStatus() {
            return Object.freeze({
                destroyed,
                recoveryRequired: false,
                failure: null,
                terminal: null,
                pendingTransformBatchCount: 0,
                pendingFirstHitCount: 0,
                circlePrimeDueCount: 0
            });
        },
        resetGpuBinding() {
            return true;
        },
        closeForTerminal() {
            return Object.freeze({ accepted: true });
        },
        destroy() {
            destroyed = true;
        }
    };
}

function createTowerDamageEvents(sourceHandle, towerHandle, damage, died = false) {
    return [
        {
            type: 'contact',
            eventType: 'damage-applied',
            sequence: 0,
            entityId: sourceHandle.entityId,
            incarnation: sourceHandle.incarnation,
            otherEntityId: towerHandle.entityId,
            otherIncarnation: towerHandle.incarnation,
            valueFixedPoint: encodeGpuCircleBodyFixedPoint(damage),
            damage,
            reason: died ? 'target-died' : null
        },
        ...(died ? [{
            type: 'death',
            sequence: 1,
            entityId: towerHandle.entityId,
            incarnation: towerHandle.incarnation,
            flags: 1,
            reason: 'health-depleted'
        }] : [])
    ];
}

function createHostileTowerTestProjectile(spawnSequence) {
    return createGpuProjectileSpawnIntent({
        definition: {
            id: 'runtime-hostile-tower-test-projectile',
            producerId: 'runtime-hostile-fixture',
            sourceAbilityId: 'runtime-hostile-shot',
            collisionRadius: 0.2,
            mass: 1,
            penetration: 1,
            lifetimeSeconds: 30,
            damage: 30,
            damageSelf: 1,
            killOnTerrain: true
        },
        position: { x: 1, y: 1 },
        velocity: { x: 0, y: 0 },
        spawnSequence,
        teamId: GAMEPLAY_TEAM_ID.HOSTILE,
        targetPolicyId:
            PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN
    });
}

function requestHostileProjectileForNextTick(gameSystem, spawnSequence) {
    const endpoint = gameSystem.getGpuSimulationEndpoint();
    const targetFixedTick = gameSystem.getNextGpuLifecycleFixedTick();
    const receipt = endpoint.requestSpawn(
        createHostileTowerTestProjectile(spawnSequence),
        targetFixedTick,
        `runtime-hostile-projectile:${targetFixedTick}:${spawnSequence}`
    );
    assert.equal(receipt.accepted, true);
    assert.equal(gameSystem.fixedUpdate(), true);
    const handles = endpoint.getRegistry().copyActiveHandlesInto([], {
        kindId: 'projectile'
    });
    return handles.at(-1);
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

test('최초 hostile Director factory throw/invalid contract는 설치된 GPU endpoint만 정확히 정리한다', () => {
    for (const failureMode of ['throw', 'invalid-contract']) {
        const backends = [];
        const coreIntegrity = new CoreIntegrity({
            maxIntegrity: 100,
            currentIntegrity: 73
        });
        const towerCombatRoster = new TowerCombatRoster();
        const coreSnapshot = Object.freeze({
            current: coreIntegrity.getCurrentIntegrity(),
            maximum: coreIntegrity.getMaxIntegrity(),
            depleted: coreIntegrity.isDepleted()
        });
        const towerSnapshot = towerCombatRoster.getStatus();
        let capturedEndpoint = null;
        let capturedRegistry = null;
        let partialDirectorDestroyCount = 0;
        const dependencies = {
            webGpuPlatformPort: {
                getState() {
                    return { ready: true, deviceGeneration: 1 };
                }
            },
            enemySimulationBackendFactory() {
                const backend = new RecoveryBackend('normal');
                backends.push(backend);
                return backend;
            },
            hostileAttackDirectorFactory(options) {
                capturedEndpoint = options.endpoint;
                capturedRegistry = options.registry;
                if (failureMode === 'throw') {
                    throw new Error('initial hostile director factory failure');
                }
                return {
                    destroy() {
                        partialDirectorDestroyCount++;
                        throw new Error('invalid initial director cleanup failure');
                    }
                };
            }
        };
        const construct = () => new GameObjectSystem(dependencies, {
            sessionMode: GAME_WORLD_SESSION_MODE.GPU_WORLD,
            coreIntegrity,
            towerCombatRoster,
            enemyWaveEnabled: false,
            gameplayWorldActorsEnabled: true
        });

        assert.throws(
            construct,
            failureMode === 'throw'
                ? /initial hostile director factory failure/
                : /HostileAttackDirector contract가 올바르지 않습니다/
        );
        assert.equal(backends.length, 1);
        assert.equal(backends[0].initCount, 0);
        assert.equal(backends[0].destroyCount, 1);
        assert.equal(backends[0].bodies.size, 0);
        assert.ok(capturedEndpoint);
        assert.strictEqual(capturedEndpoint.getBackend(), backends[0]);
        assert.strictEqual(capturedEndpoint.getRegistry(), capturedRegistry);
        assert.equal(capturedEndpoint.getStatus().destroyed, true);
        assert.equal(capturedRegistry.getStatus().destroyed, true);
        assert.equal(
            partialDirectorDestroyCount,
            failureMode === 'invalid-contract' ? 1 : 0
        );
        assert.deepEqual({
            current: coreIntegrity.getCurrentIntegrity(),
            maximum: coreIntegrity.getMaxIntegrity(),
            depleted: coreIntegrity.isDepleted()
        }, coreSnapshot);
        assert.deepEqual(towerCombatRoster.getStatus(), towerSnapshot);
        assert.equal(towerCombatRoster.getStatus().destroyed, false);
        assert.equal(towerCombatRoster.getStatus().boundGpuBody, null);

        towerCombatRoster.destroy();
    }
});

test('hard GPU failure는 lazy-deferred replacement로 한 번 재시작하고 성공 전 무한 restart를 막는다', () => {
    const backends = [];
    const backendModes = [
        'fail-first-spawn',
        'init-deferred',
        'fail-first-spawn'
    ];
    const hostileDirectors = createTrackingHostileAttackDirectorFactory();
    let legacyClearCount = 0;
    const dependencies = {
        inputActionSource: {
            isPressed() {
                return false;
            },
            getPointerPosition(out) {
                out.x = 0;
                out.y = 0;
                return out;
            },
            isPrimaryPointerPressed() {
                return false;
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
                return { ready: true, deviceGeneration: 1 };
            }
        },
        enemySimulationBackendFactory() {
            const backend = new RecoveryBackend(
                backendModes[backends.length] ?? 'fail-first-spawn'
            );
            backends.push(backend);
            return backend;
        },
        hostileAttackDirectorFactory: hostileDirectors.factory,
        jorangSplitLineageDirectorFactory:
            createIdleJorangSplitLineageDirector,
        projectileCaptureDirectorFactory:
            createIdleProjectileCaptureDirector,
        legacyWorldPort: {
            clear() {
                legacyClearCount++;
            }
        }
    };
    const scene = new GameScene({}, { dependencies });

    const initialGameSystem = scene.getGameSystem();
    const initialObjectSystem = initialGameSystem.getObjectSystem();
    const initialCoreIntegrity = initialGameSystem.getCoreIntegrity();
    const initialCorePresentation = initialObjectSystem.getCore();
    const initialInputRouter = initialGameSystem.playerControlRouter;
    const initialInputMapper = initialGameSystem.inputActionMapper;
    const initialCameraController = initialGameSystem.getCameraZoomController();
    const initialTowerFacade = initialObjectSystem.getTower();
    const initialEndpoint = initialObjectSystem.getGpuSimulationEndpoint();
    const initialRegistry = initialObjectSystem.getWorldRegistry();
    const initialSessionGeneration = initialEndpoint.getStatus().sessionGeneration;
    const initialHostileDirector = initialObjectSystem.hostileAttackDirector;
    const initialPentagonEffectDirector
        = initialObjectSystem.pentagonEffectDirector;
    const initialFormationRuntimeDirector
        = initialObjectSystem.formationRuntimeDirector;
    const staleEffectCommandPort = initialEndpoint.getEffectCommandPort();
    const staleFormationCommandPort = initialEndpoint.getFormationCommandPort();
    const maxIntegrity = initialCoreIntegrity.getMaxIntegrity();
    const appliedDamage = initialCoreIntegrity.applyIntegrityDamage(37);
    const damagedIntegrity = initialCoreIntegrity.getCurrentIntegrity();

    assert.ok(appliedDamage > 0);
    assert.equal(damagedIntegrity, maxIntegrity - appliedDamage);
    assert.strictEqual(
        initialCorePresentation.getCoreIntegrity(),
        initialCoreIntegrity
    );
    assert.equal(legacyClearCount, 1);
    assert.strictEqual(hostileDirectors.instances[0], initialHostileDirector);
    assert.equal(initialGameSystem.getHostileAttackStatus().activeArcherCount, 0);
    assert.equal(initialGameSystem.getHostileAttackStatus().pendingShotCount, 0);

    assert.equal(scene.getNextGpuLifecycleFixedTick(), 1);
    assert.equal(scene.getNextEnemyLifecycleFixedTick(), 1);

    scene.fixedUpdate();
    const firstReplacementEndpoint = initialObjectSystem.getGpuSimulationEndpoint();
    const firstReplacementRegistry = initialObjectSystem.getWorldRegistry();

    assert.equal(backends.length, 2);
    assert.equal(backends[1].initCount, 1);
    assert.equal(backends[0].destroyCount, 1);
    assert.equal(hostileDirectors.instances.length, 2);
    assert.equal(initialHostileDirector.destroyCount, 1);
    assert.equal(initialHostileDirector.getStatus().destroyed, true);
    assert.equal(initialHostileDirector.completedEventCalls.length, 0);
    assert.equal(initialHostileDirector.stageCalls.length, 0);
    assert.equal(initialHostileDirector.fixedCommitCalls.length, 0);
    assert.strictEqual(
        initialObjectSystem.hostileAttackDirector,
        hostileDirectors.instances[1]
    );
    assert.equal(hostileDirectors.instances[1].getStatus().stageCallCount, 0);
    assert.equal(hostileDirectors.instances[1].completedEventCalls.length, 0);
    assert.equal(hostileDirectors.instances[1].fixedCommitCalls.length, 0);
    assert.equal(initialGameSystem.getHostileAttackStatus().activeArcherCount, 0);
    assert.equal(initialGameSystem.getHostileAttackStatus().pendingShotCount, 0);
    assert.strictEqual(scene.getGameSystem(), initialGameSystem);
    assert.strictEqual(initialGameSystem.getObjectSystem(), initialObjectSystem);
    assert.strictEqual(initialGameSystem.getCoreIntegrity(), initialCoreIntegrity);
    assert.strictEqual(initialObjectSystem.getCore(), initialCorePresentation);
    assert.strictEqual(initialObjectSystem.getTower(), initialTowerFacade);
    assert.strictEqual(initialGameSystem.playerControlRouter, initialInputRouter);
    assert.strictEqual(initialGameSystem.inputActionMapper, initialInputMapper);
    assert.strictEqual(
        initialGameSystem.getCameraZoomController(),
        initialCameraController
    );
    assert.notStrictEqual(firstReplacementEndpoint, initialEndpoint);
    assert.notStrictEqual(firstReplacementRegistry, initialRegistry);
    assert.ok(
        firstReplacementEndpoint.getStatus().sessionGeneration
            > initialSessionGeneration
    );
    assert.equal(initialEndpoint.getStatus().destroyed, true);
    assert.equal(initialPentagonEffectDirector.getStatus().destroyed, true);
    assert.equal(initialPentagonEffectDirector.getStatus().activeEmitterCount, 0);
    assert.equal(initialPentagonEffectDirector.getStatus().pendingPulseCount, 0);
    assert.equal(initialPentagonEffectDirector.getStatus().pendingBatchCount, 0);
    assert.equal(
        initialPentagonEffectDirector.getStatus().pendingStaleCompletionCount,
        0
    );
    assert.equal(initialFormationRuntimeDirector.getStatus().destroyed, true);
    assert.equal(initialFormationRuntimeDirector.getStatus().activeGroupCount, 0);
    assert.equal(initialFormationRuntimeDirector.getStatus().activeHiveCount, 0);
    assert.equal(
        initialFormationRuntimeDirector.getStatus().totalOriginalMemberCount,
        0
    );
    assert.equal(
        initialFormationRuntimeDirector.getStatus().pendingTransformBatchCount,
        0
    );
    assert.deepEqual({ ...staleEffectCommandPort.requestPulseBatch({}) }, {
        accepted: false,
        reason: 'effect-command-port-revoked'
    });
    assert.throws(() => staleFormationCommandPort.requestPrepareBatch({}));
    assert.notStrictEqual(
        firstReplacementEndpoint.getEffectCommandPort(),
        staleEffectCommandPort
    );
    assert.notStrictEqual(
        firstReplacementEndpoint.getFormationCommandPort(),
        staleFormationCommandPort
    );
    const replacementEffectStatus = initialGameSystem.getPentagonEffectStatus();
    assert.equal(replacementEffectStatus.destroyed, false);
    assert.equal(replacementEffectStatus.activeEmitterCount, 0);
    assert.equal(replacementEffectStatus.pendingPulseCount, 0);
    assert.equal(replacementEffectStatus.pendingBatchCount, 0);
    assert.equal(replacementEffectStatus.pendingStaleCompletionCount, 0);
    const replacementFormationStatus
        = initialGameSystem.getFormationRuntimeStatus();
    assert.equal(replacementFormationStatus.destroyed, false);
    assert.equal(replacementFormationStatus.activeGroupCount, 0);
    assert.equal(replacementFormationStatus.activeHiveCount, 0);
    assert.equal(replacementFormationStatus.totalOriginalMemberCount, 0);
    assert.equal(replacementFormationStatus.pendingTransformBatchCount, 0);
    const replacementEndpointStatus = firstReplacementEndpoint.getStatus();
    assert.equal(replacementEndpointStatus.effectCommands.pendingBatchCount, 0);
    assert.equal(replacementEndpointStatus.effectCommands.inFlightBatchCount, 0);
    assert.equal(
        replacementEndpointStatus.effectCommands.pendingPulseProgramCount,
        0
    );
    assert.equal(
        replacementEndpointStatus.formationCommands.pendingPrepareBatchCount,
        0
    );
    assert.equal(
        replacementEndpointStatus.formationCommands.inFlightPrepareBatchCount,
        0
    );
    assert.equal(
        replacementEndpointStatus.formationCommands.preparedTransformBatchCount,
        0
    );
    assert.equal(
        replacementEndpointStatus.formationCommands.armedTransformBatchCount,
        0
    );
    assert.equal(
        replacementEndpointStatus.formationCommands
            .pendingTransformCompletionCount,
        0
    );
    assert.equal(scene.getEnemyRecoveryStatus().restartCount, 1);
    assert.equal(scene.getEnemyRecoveryStatus().restartGeneration, 1);
    assert.equal(initialGameSystem.getFixedTick(), 0);
    assert.equal(firstReplacementRegistry.getActiveCount(), 0);
    assert.equal(
        initialObjectSystem.getGpuWorldActorStatus().spawnTargetFixedTick,
        1
    );
    assert.equal(initialCoreIntegrity.getCurrentIntegrity(), damagedIntegrity);
    assert.equal(initialCoreIntegrity.getMaxIntegrity(), maxIntegrity);
    assert.equal(legacyClearCount, 1);

    scene.fixedUpdate();
    assert.equal(initialGameSystem.getFixedTick(), 1);
    assert.equal(scene.getNextGpuLifecycleFixedTick(), 2);
    assert.equal(firstReplacementRegistry.getActiveCount(), 3);
    assert.equal(firstReplacementRegistry.getActiveCount('enemy'), 1);
    assert.equal(firstReplacementRegistry.getActiveCount('tower'), 1);
    assert.equal(firstReplacementRegistry.getActiveCount('core-proxy'), 1);
    assert.ok(initialObjectSystem.getGpuWorldActorStatus().towerHandle);
    assert.ok(initialObjectSystem.getGpuWorldActorStatus().coreProxyHandle);
    assert.equal(
        initialObjectSystem.getGpuWorldActorStatus()
            .towerGameplayTargetConfigured,
        true
    );
    assert.equal(scene.getEnemyRecoveryStatus().restartGeneration, null);
    assert.equal(initialCoreIntegrity.getCurrentIntegrity(), damagedIntegrity);
    assert.equal(legacyClearCount, 1);

    backends[1].hardFailNextFixed = true;
    scene.fixedUpdate();
    const secondReplacementEndpoint = initialObjectSystem.getGpuSimulationEndpoint();
    const secondReplacementRegistry = initialObjectSystem.getWorldRegistry();

    assert.equal(backends.length, 3);
    assert.equal(backends[1].destroyCount, 1);
    assert.equal(hostileDirectors.instances.length, 3);
    assert.equal(hostileDirectors.instances[1].destroyCount, 1);
    assert.equal(hostileDirectors.instances[1].completedEventCalls.length, 0);
    assert.equal(hostileDirectors.instances[1].stageCalls.length, 0);
    assert.equal(hostileDirectors.instances[1].fixedCommitCalls.length, 0);
    assert.strictEqual(
        initialObjectSystem.hostileAttackDirector,
        hostileDirectors.instances[2]
    );
    assert.equal(hostileDirectors.instances[2].getStatus().stageCallCount, 0);
    assert.equal(hostileDirectors.instances[2].completedEventCalls.length, 0);
    assert.equal(hostileDirectors.instances[2].fixedCommitCalls.length, 0);
    assert.equal(initialGameSystem.getHostileAttackStatus().activeArcherCount, 0);
    assert.equal(initialGameSystem.getHostileAttackStatus().pendingShotCount, 0);
    assert.strictEqual(scene.getGameSystem(), initialGameSystem);
    assert.strictEqual(initialGameSystem.getObjectSystem(), initialObjectSystem);
    assert.strictEqual(initialGameSystem.getCoreIntegrity(), initialCoreIntegrity);
    assert.strictEqual(initialObjectSystem.getCore(), initialCorePresentation);
    assert.strictEqual(initialObjectSystem.getTower(), initialTowerFacade);
    assert.strictEqual(initialGameSystem.playerControlRouter, initialInputRouter);
    assert.strictEqual(
        initialGameSystem.getCameraZoomController(),
        initialCameraController
    );
    assert.notStrictEqual(secondReplacementEndpoint, firstReplacementEndpoint);
    assert.notStrictEqual(secondReplacementRegistry, firstReplacementRegistry);
    assert.ok(
        secondReplacementEndpoint.getStatus().sessionGeneration
            > firstReplacementEndpoint.getStatus().sessionGeneration
    );
    assert.equal(firstReplacementEndpoint.getStatus().destroyed, true);
    assert.equal(scene.getEnemyRecoveryStatus().restartCount, 2);
    assert.equal(initialGameSystem.getFixedTick(), 1);
    assert.equal(secondReplacementRegistry.getActiveCount(), 0);
    assert.equal(
        initialObjectSystem.getGpuWorldActorStatus().spawnTargetFixedTick,
        2
    );
    assert.equal(initialCoreIntegrity.getCurrentIntegrity(), damagedIntegrity);
    assert.equal(legacyClearCount, 1);

    scene.fixedUpdate();
    assert.equal(backends.length, 3);
    assert.equal(initialGameSystem.getFixedTick(), 1);
    assert.equal(scene.getEnemyRecoveryStatus().restartCount, 2);
    assert.equal(scene.getEnemyRecoveryStatus().restartGeneration, 1);
    assert.strictEqual(
        initialObjectSystem.getGpuSimulationEndpoint(),
        secondReplacementEndpoint
    );
    assert.equal(initialCoreIntegrity.getCurrentIntegrity(), damagedIntegrity);
    assert.equal(legacyClearCount, 1);

    scene.destroy();
    scene.destroy();
    assert.equal(backends[2].destroyCount, 1);
    assert.equal(hostileDirectors.instances[2].destroyCount, 1);
    assert.equal(legacyClearCount, 2);
});

test('replacement gpu-unavailable/예외와 Director factory 예외는 기존 GPU world와 CPU domain을 원자적으로 보존한다', () => {
    const backends = [];
    const backendModes = [
        'normal',
        'init-throws',
        'init-returns-false',
        'normal'
    ];
    const hostileDirectors = createTrackingHostileAttackDirectorFactory({
        throwOnCall: 2
    });
    const dependencies = {
        inputActionSource: {
            isPressed() {
                return false;
            },
            getPointerPosition(out) {
                out.x = 0;
                out.y = 0;
                return out;
            },
            isPrimaryPointerPressed() {
                return false;
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
                return { ready: true, deviceGeneration: 1 };
            }
        },
        enemySimulationBackendFactory() {
            const backend = new RecoveryBackend(
                backendModes[backends.length] ?? 'init-throws'
            );
            backends.push(backend);
            return backend;
        },
        hostileAttackDirectorFactory: hostileDirectors.factory,
        jorangSplitLineageDirectorFactory:
            createIdleJorangSplitLineageDirector,
        projectileCaptureDirectorFactory:
            createIdleProjectileCaptureDirector
    };
    const gameSystem = new GameSystem(dependencies);
    assert.equal(gameSystem.enter(), true);
    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(gameSystem.getFixedTick(), 1);

    const objectSystem = gameSystem.getObjectSystem();
    const coreIntegrity = gameSystem.getCoreIntegrity();
    const corePresentation = objectSystem.getCore();
    const towerFacade = objectSystem.getTower();
    const inputRouter = gameSystem.playerControlRouter;
    const inputMapper = gameSystem.inputActionMapper;
    const cameraController = gameSystem.getCameraZoomController();
    const endpoint = objectSystem.getGpuSimulationEndpoint();
    const registry = objectSystem.getWorldRegistry();
    const backend = objectSystem.getEnemySimulationBackend();
    const waveDirector = objectSystem.waveDirector;
    const hostileAttackDirector = objectSystem.hostileAttackDirector;
    const sessionGeneration = endpoint.getStatus().sessionGeneration;
    const actorStatus = objectSystem.getGpuWorldActorStatus();
    const towerHandle = actorStatus.towerHandle;
    const coreProxyHandle = actorStatus.coreProxyHandle;
    const maxIntegrity = coreIntegrity.getMaxIntegrity();
    coreIntegrity.applyIntegrityDamage(37);
    const damagedIntegrity = coreIntegrity.getCurrentIntegrity();

    assert.equal(backends.length, 1);
    assert.equal(hostileDirectors.calls.length, 1);
    assert.equal(hostileDirectors.instances.length, 1);
    assert.strictEqual(backend, backends[0]);
    assert.equal(backend.initCount, 1);
    assert.equal(backend.destroyCount, 0);
    assert.ok(towerHandle);
    assert.ok(coreProxyHandle);
    assert.equal(registry.getActiveCount(), 3);
    assert.equal(damagedIntegrity < maxIntegrity, true);

    hostileAttackDirector.recoveryRequired = true;
    assert.equal(gameSystem.getHostileAttackStatus().recoveryRequired, true);
    assert.equal(gameSystem.isEnemySimulationRecoveryRequired(), true);
    assert.equal(gameSystem.drawEnemySimulation(), true);
    assert.equal(gameSystem.isEnemySimulationRecoveryRequired(), true);
    assert.equal(gameSystem.isGpuWorldRecoveryRequired(), true);
    hostileAttackDirector.recoveryRequired = false;
    assert.equal(gameSystem.drawEnemySimulation(), true);
    assert.equal(gameSystem.isEnemySimulationRecoveryRequired(), false);
    assert.equal(gameSystem.isGpuWorldRecoveryRequired(), false);

    backend.hardFailNextFixed = true;
    assert.equal(gameSystem.fixedUpdate(), false);
    assert.equal(gameSystem.getFixedTick(), 1);
    assert.equal(gameSystem.isGpuWorldRecoveryRequired(), true);
    const nextLifecycleTickBeforeRestart = gameSystem.getNextGpuLifecycleFixedTick();

    assert.equal(gameSystem.restartGpuWorldAtSafeWaveBoundary(), false);
    assert.equal(backends.length, 2);
    assert.equal(backends[0].destroyCount, 0);
    assert.equal(backends[1].initCount, 1);
    assert.equal(backends[1].destroyCount, 1);
    assert.strictEqual(gameSystem.getObjectSystem(), objectSystem);
    assert.strictEqual(gameSystem.getCoreIntegrity(), coreIntegrity);
    assert.strictEqual(objectSystem.getCore(), corePresentation);
    assert.strictEqual(objectSystem.getTower(), towerFacade);
    assert.strictEqual(gameSystem.playerControlRouter, inputRouter);
    assert.strictEqual(gameSystem.inputActionMapper, inputMapper);
    assert.strictEqual(gameSystem.getCameraZoomController(), cameraController);
    assert.strictEqual(objectSystem.getGpuSimulationEndpoint(), endpoint);
    assert.strictEqual(objectSystem.getWorldRegistry(), registry);
    assert.strictEqual(objectSystem.getEnemySimulationBackend(), backend);
    assert.strictEqual(objectSystem.waveDirector, waveDirector);
    assert.strictEqual(objectSystem.hostileAttackDirector, hostileAttackDirector);
    assert.equal(hostileAttackDirector.destroyCount, 0);
    assert.equal(hostileAttackDirector.getStatus().destroyed, false);
    assert.equal(gameSystem.getHostileAttackStatus().recoveryRequired, false);
    assert.equal(endpoint.getStatus().sessionGeneration, sessionGeneration);
    assert.equal(endpoint.getStatus().destroyed, false);
    assert.equal(gameSystem.getFixedTick(), 1);
    assert.equal(
        gameSystem.getNextGpuLifecycleFixedTick(),
        nextLifecycleTickBeforeRestart
    );
    assert.equal(gameSystem.isGpuWorldRecoveryRequired(), true);
    assert.equal(registry.getActiveCount(), 3);
    assert.strictEqual(objectSystem.getGpuWorldActorStatus().towerHandle, towerHandle);
    assert.strictEqual(
        objectSystem.getGpuWorldActorStatus().coreProxyHandle,
        coreProxyHandle
    );
    assert.strictEqual(towerFacade.getStatus().bodyHandle, towerHandle);
    assert.equal(towerFacade.getStatus().sessionGeneration, sessionGeneration);
    assert.strictEqual(corePresentation.getCoreIntegrity(), coreIntegrity);
    assert.equal(coreIntegrity.getCurrentIntegrity(), damagedIntegrity);
    assert.equal(coreIntegrity.getMaxIntegrity(), maxIntegrity);

    assert.equal(gameSystem.restartGpuWorldAtSafeWaveBoundary(), false);
    assert.equal(backends.length, 3);
    assert.equal(backends[2].initCount, 1);
    assert.equal(backends[2].destroyCount, 1);
    assert.equal(hostileDirectors.calls.length, 1);
    assert.equal(hostileDirectors.instances.length, 1);
    assert.strictEqual(objectSystem.getGpuSimulationEndpoint(), endpoint);
    assert.strictEqual(objectSystem.getWorldRegistry(), registry);
    assert.strictEqual(objectSystem.getEnemySimulationBackend(), backend);
    assert.strictEqual(objectSystem.waveDirector, waveDirector);
    assert.strictEqual(objectSystem.hostileAttackDirector, hostileAttackDirector);
    assert.equal(hostileAttackDirector.destroyCount, 0);
    assert.equal(hostileAttackDirector.getStatus().destroyed, false);
    assert.equal(gameSystem.getHostileAttackStatus().activeArcherCount, 0);
    assert.equal(gameSystem.getHostileAttackStatus().pendingShotCount, 0);
    assert.equal(gameSystem.isGpuWorldRecoveryRequired(), true);
    assert.equal(registry.getActiveCount(), 3);
    assert.strictEqual(objectSystem.getGpuWorldActorStatus().towerHandle, towerHandle);
    assert.strictEqual(
        objectSystem.getGpuWorldActorStatus().coreProxyHandle,
        coreProxyHandle
    );
    assert.equal(coreIntegrity.getCurrentIntegrity(), damagedIntegrity);

    assert.equal(gameSystem.restartGpuWorldAtSafeWaveBoundary(), false);
    assert.equal(backends.length, 4);
    assert.equal(backends[3].initCount, 1);
    assert.equal(backends[3].destroyCount, 1);
    assert.equal(hostileDirectors.calls.length, 2);
    assert.equal(hostileDirectors.instances.length, 1);
    assert.strictEqual(objectSystem.getGpuSimulationEndpoint(), endpoint);
    assert.strictEqual(objectSystem.getWorldRegistry(), registry);
    assert.strictEqual(objectSystem.getEnemySimulationBackend(), backend);
    assert.strictEqual(objectSystem.waveDirector, waveDirector);
    assert.strictEqual(objectSystem.hostileAttackDirector, hostileAttackDirector);
    assert.equal(hostileAttackDirector.destroyCount, 0);
    assert.equal(hostileAttackDirector.getStatus().destroyed, false);
    assert.equal(gameSystem.getHostileAttackStatus().activeArcherCount, 0);
    assert.equal(gameSystem.getHostileAttackStatus().pendingShotCount, 0);

    gameSystem.destroy();
    gameSystem.destroy();
    assert.equal(backends[0].destroyCount, 1);
    assert.equal(backends[1].destroyCount, 1);
    assert.equal(backends[2].destroyCount, 1);
    assert.equal(backends[3].destroyCount, 1);
    assert.equal(hostileAttackDirector.destroyCount, 1);
});

test('1→2 TowerGroup recovery는 모든 논리 상태를 보존하고 exact 재바인딩·primary 승계를 수행한다', () => {
    const backends = [];
    const backendModes = ['normal', 'capacity-one', 'normal'];
    const hostileDirectors = createTrackingHostileAttackDirectorFactory();
    const heldInput = {
        actions: new Set(),
        primary: false,
        pointerX: 320,
        pointerY: 180
    };
    const dependencies = {
        inputActionSource: {
            isPressed(actionId) {
                return heldInput.actions.has(actionId);
            },
            getPointerPosition(out) {
                out.x = heldInput.pointerX;
                out.y = heldInput.pointerY;
                return out;
            },
            isPrimaryPointerPressed() {
                return heldInput.primary;
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
                return { ready: true, deviceGeneration: 7 };
            }
        },
        enemySimulationBackendFactory(_backendDependencies, options) {
            const backend = new GroupCombatRecoveryBackend(
                backendModes[backends.length] ?? 'normal',
                options.sessionGeneration
            );
            backends.push(backend);
            return backend;
        },
        hostileAttackDirectorFactory: hostileDirectors.factory,
        jorangSplitLineageDirectorFactory:
            createIdleJorangSplitLineageDirector,
        projectileCaptureDirectorFactory:
            createIdleProjectileCaptureDirector
    };
    const gameSystem = new GameSystem(dependencies, {
        enemyWaveEnabled: false
    });
    assert.equal(gameSystem.enter(), true);
    assert.equal(gameSystem.fixedUpdate(), true);
    const wordSystem = gameSystem.getWordSystem();
    wordSystem.setSlotSentence(
        'Q',
        R3_TOWER_SHOOTS_ENEMY_SENTENCE
    );
    wordSystem.setSlotSentence(
        'E',
        R3_ENEMIES_SHOOT_ENEMIES_SENTENCE
    );

    const objectSystem = gameSystem.getObjectSystem();
    const initialEndpoint = gameSystem.getGpuSimulationEndpoint();
    const towerFacade = objectSystem.getTower();
    const primaryController = objectSystem.primaryProjectileController;
    const towerGroupState = gameSystem.getTowerGroupState();
    const initialTowerHandle = towerGroupState
        .getPrimaryTowerRecord().exactGpuBinding;
    const qViewBeforeCreation = gameSystem.getAbilitySlotViews().find(
        ({ slotId }) => slotId === 'Q'
    );
    assert.equal(qViewBeforeCreation.preview.subjectCount, 1);

    const childDescriptor = Object.freeze({
        position: Object.freeze({ x: 7, y: 4 })
    });
    const creationPlan = towerGroupState.planCreation({
        transactionId: 'recovery-manual-1-to-2',
        childCount: 1,
        childRecoverySpawnDescriptors: [childDescriptor]
    });
    assert.equal(creationPlan.accepted, true);
    const childPlan = creationPlan.children[0];
    const childSpawnTick = gameSystem.getNextGpuLifecycleFixedTick();
    const childSpawnReceipt = initialEndpoint.requestSpawn(
        createGpuTowerSpawnIntent({
            position: childDescriptor.position,
            currentHpFixedPoint: childPlan.currentHpFixedPoint,
            logicalTowerOrdinal: childPlan.logicalTowerOrdinal,
            shareUnits: childPlan.shareUnits,
            maxHpFixedPoint: childPlan.maxHpFixedPoint,
            powerFixedPoint: childPlan.powerFixedPoint,
            towerGroupRevision: creationPlan.targetGroupRevision
        }),
        childSpawnTick,
        `recovery-manual-child:${childSpawnTick}`
    );
    assert.equal(childSpawnReceipt.accepted, true);
    assert.equal(gameSystem.fixedUpdate(), true);
    const technicalTowerHandles = initialEndpoint.getRegistry()
        .copyActiveHandlesInto([], { kindId: 'tower' });
    assert.equal(technicalTowerHandles.length, 2);
    const childHandle = technicalTowerHandles.find(
        (handle) => !sameHandle(handle, initialTowerHandle)
    );
    assert.ok(childHandle);
    const childRecoveryPlacementDescriptor
        = createTowerRecoveryPlacementDescriptor({
            policyId:
                TOWER_RECOVERY_PLACEMENT_POLICY_ID.MAP_ANCHOR_LATTICE_V1,
            mapRecoveryAnchorId: 'map:recovery-test:tower-spawn',
            mapLatticeVersion: 3,
            anchorPosition: childDescriptor.position
        }, childPlan.logicalTowerOrdinal);
    const childCreationMetadata = Object.freeze({
        generation: 7,
        creationOriginCode:
            ABILITY_CREATION_ORIGIN_CODE.SENTENCE_PAYLOAD,
        sourceAbilityCode: 731,
        sourceExecutionId: 'ability-execution.r5.recovery:41',
        sourceExecutionFingerprint: 0x1234abcd,
        sourceExecutionOrdinal: 41,
        visibleFromExecutionOrdinal: 42,
        actorActionCode: SENTENCE_ACTION_CODE.THROW,
        actorActionProfileId: R5_THROW_ACTOR_ACTION_PROFILE.id,
        actorActionProfileFingerprint:
            R5_THROW_ACTOR_ACTION_PROFILE.actorActionProfileFingerprint,
        recoveryPlacementDescriptor: childRecoveryPlacementDescriptor
    });
    const creationCommit = towerGroupState.commitCreation({
        plan: creationPlan,
        childCreationMetadata: [childCreationMetadata],
        childRecoverySpawnDescriptors: [childRecoveryPlacementDescriptor]
    });
    assert.equal(creationCommit.accepted, true);
    towerGroupState.bindGpuBody(
        childPlan.logicalTowerId,
        childHandle,
        backends[0].eventProtocol
    );
    assert.equal(
        towerFacade.synchronizeGpuRoster(backends[0], true).accepted,
        true
    );
    const qViewAfterCreation = gameSystem.getAbilitySlotViews().find(
        ({ slotId }) => slotId === 'Q'
    );
    assert.equal(qViewAfterCreation.preview.subjectCount, 2);

    const snapshotLogicalRecords = () => towerGroupState.getTowerRecords().map(
        (record) => ({
            logicalTowerId: record.logicalTowerId,
            logicalTowerOrdinal: record.logicalTowerOrdinal,
            shareUnits: record.shareUnits,
            currentHpFixedPoint: record.currentHpFixedPoint,
            maxHpFixedPoint: record.maxHpFixedPoint,
            powerFixedPoint: record.powerFixedPoint,
            recoverySpawnDescriptor: record.recoverySpawnDescriptor,
            creationMetadata: record.creationMetadata,
            state: record.state
        })
    );
    const logicalRecordsBeforeRecovery = snapshotLogicalRecords();
    const groupStatusBeforeRecovery = towerGroupState.getStatus();
    const equippedAbilityIdsBeforeRecovery = gameSystem.getAbilitySlotViews()
        .map(({ compiledAbilityId }) => compiledAbilityId);
    const hostileStatusBeforeRecovery = gameSystem
        .getHostileParticipationStatus();
    const coreIntegrity = gameSystem.getCoreIntegrity();
    const snapshotCoreStatus = () => ({
        current: coreIntegrity.getCurrentIntegrity(),
        max: coreIntegrity.getMaxIntegrity(),
        depleted: coreIntegrity.isDepleted(),
        terminallySealed: coreIntegrity.isTerminallySealed()
    });
    const coreStatusBeforeRecovery = snapshotCoreStatus();
    const runStatusBeforeRecovery = gameSystem.getRunOutcome().getStatus();
    const goldBeforeRecovery = gameSystem.getGold();
    const oldHostileHandle = requestHostileProjectileForNextTick(gameSystem, 10);

    const queuedCreation = gameSystem.requestTowerCreation({
        transactionId: 'recovery-must-not-replay',
        childCount: 1,
        requestedFixedTick: gameSystem.getFixedTick() + 10,
        childSpawnDescriptors: [{ position: { x: 9, y: 6 } }]
    });
    assert.equal(queuedCreation.accepted, true);
    assert.equal(gameSystem.getTowerCreationStatus().state, 'queued');

    heldInput.actions.add('moveRight');
    heldInput.primary = true;
    heldInput.pointerX = 640;
    heldInput.pointerY = 360;

    backends[0].hardFailNextFixed = true;
    assert.equal(gameSystem.fixedUpdate(), false);
    assert.equal(towerGroupState.getStatus().livingTowerCount, 2);
    assert.equal(towerFacade.getStatus().primaryPressed, true);
    assert.equal(gameSystem.isGpuWorldRecoveryRequired(), true);
    const oldBindings = towerGroupState.getTowerRecords().map(
        ({ exactGpuBinding }) => exactGpuBinding
    );

    assert.equal(gameSystem.restartGpuWorldAtSafeWaveBoundary(), false);
    assert.equal(backends.length, 2);
    assert.equal(backends[1].destroyCount, 1);
    assert.strictEqual(gameSystem.getGpuSimulationEndpoint(), initialEndpoint);
    assert.deepEqual(snapshotLogicalRecords(), logicalRecordsBeforeRecovery);
    assert.deepEqual(
        towerGroupState.getTowerRecords().map(({ exactGpuBinding }) => (
            exactGpuBinding
        )),
        oldBindings
    );
    assert.equal(gameSystem.getTowerCreationStatus().state, 'queued');
    assert.equal(backends[0].destroyCount, 0);
    assert.equal(towerFacade.getStatus().primaryPressed, true);

    assert.equal(gameSystem.restartGpuWorldAtSafeWaveBoundary(), true);
    const replacementEndpoint = gameSystem.getGpuSimulationEndpoint();
    assert.notStrictEqual(replacementEndpoint, initialEndpoint);
    assert.equal(backends[0].destroyCount, 1);
    assert.deepEqual(snapshotLogicalRecords(), logicalRecordsBeforeRecovery);
    assert.equal(
        towerGroupState.getStatus().groupRevision,
        groupStatusBeforeRecovery.groupRevision
    );
    assert.equal(
        towerGroupState.getTowerRecords().every(
            ({ exactGpuBinding }) => exactGpuBinding === null
        ),
        true
    );
    assert.equal(gameSystem.getTowerCreationStatus().state, 'idle');
    assert.equal(backends[2].towerCreationStageCalls.length, 0);
    assert.equal(towerFacade.getStatus().primaryPressed, true);
    assert.deepEqual(
        { ...towerFacade.moveIntent },
        { x: 1, y: 0 }
    );
    assert.deepEqual(snapshotCoreStatus(), coreStatusBeforeRecovery);
    assert.deepEqual(gameSystem.getRunOutcome().getStatus(), runStatusBeforeRecovery);
    assert.equal(gameSystem.getGold(), goldBeforeRecovery);
    assert.strictEqual(gameSystem.getWordSystem(), wordSystem);
    assert.deepEqual(
        gameSystem.getAbilitySlotViews().map(
            ({ compiledAbilityId }) => compiledAbilityId
        ),
        equippedAbilityIdsBeforeRecovery
    );
    assert.equal(
        gameSystem.getAbilitySlotViews().find(({ slotId }) => slotId === 'E')
            .preview.subjectCount,
        0
    );
    assert.deepEqual(
        {
            hostileActorCount: gameSystem.getHostileParticipationStatus()
                .hostileActorCount,
            siegeWeight: gameSystem.getHostileParticipationStatus().siegeWeight,
            bountyPotential: gameSystem.getHostileParticipationStatus()
                .bountyPotential
        },
        {
            hostileActorCount: hostileStatusBeforeRecovery.hostileActorCount,
            siegeWeight: hostileStatusBeforeRecovery.siegeWeight,
            bountyPotential: hostileStatusBeforeRecovery.bountyPotential
        }
    );

    backends[0].queueCompletedEvents(
        gameSystem.getFixedTick() + 1,
        createTowerDamageEvents(oldHostileHandle, initialTowerHandle, 5)
    );
    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(backends[2].spawnBatches.length, 1);
    const restoredTowerBodies = backends[2].spawnBatches[0]
        .filter(({ kindId }) => kindId === 'tower')
        .sort((left, right) => (
            left.logicalTowerOrdinal - right.logicalTowerOrdinal
        ));
    assert.equal(restoredTowerBodies.length, 2);
    assert.equal(backends[2].spawnBatches[0].length, 3);
    for (let index = 0; index < restoredTowerBodies.length; index++) {
        const body = restoredTowerBodies[index];
        const record = logicalRecordsBeforeRecovery[index];
        assert.equal(body.teamId, GAMEPLAY_TEAM_ID.PLAYER);
        assert.equal(body.logicalTowerOrdinal, record.logicalTowerOrdinal);
        assert.equal(body.shareUnits, record.shareUnits);
        assert.equal(body.currentHpFixedPoint, record.currentHpFixedPoint);
        assert.equal(body.maxHpFixedPoint, record.maxHpFixedPoint);
        assert.equal(body.powerFixedPoint, record.powerFixedPoint);
        assert.equal(
            body.towerGroupRevision,
            groupStatusBeforeRecovery.groupRevision
        );
    }
    assert.deepEqual(
        { ...restoredTowerBodies[1].position },
        { ...childDescriptor.position }
    );
    assert.equal(restoredTowerBodies[1].abilityGeneration, 7);
    assert.equal(
        restoredTowerBodies[1].abilityCreationOriginCode,
        ABILITY_CREATION_ORIGIN_CODE.SENTENCE_PAYLOAD
    );
    assert.equal(restoredTowerBodies[1].sourceAbilityCode, 731);
    assert.equal('sourceExecutionId' in restoredTowerBodies[1], false);
    assert.equal(
        restoredTowerBodies[1].sourceExecutionFingerprint,
        0x1234abcd
    );
    assert.equal(restoredTowerBodies[1].sourceExecutionOrdinal, 41);
    assert.equal(restoredTowerBodies[1].visibleFromExecutionOrdinal, 42);
    assert.equal(
        restoredTowerBodies[1].actorActionCode,
        SENTENCE_ACTION_CODE.THROW
    );
    assert.equal(
        restoredTowerBodies[1].actorActionProfileId,
        R5_THROW_ACTOR_ACTION_PROFILE.id
    );
    assert.equal(
        restoredTowerBodies[1].actorActionProfileFingerprint,
        R5_THROW_ACTOR_ACTION_PROFILE.actorActionProfileFingerprint
    );
    assert.equal(
        restoredTowerBodies[1].recoveryPlacementPolicyId,
        TOWER_RECOVERY_PLACEMENT_POLICY_ID.MAP_ANCHOR_LATTICE_V1
    );
    assert.equal(restoredTowerBodies[1].recoveryLogicalTowerOrdinal,
        childPlan.logicalTowerOrdinal);
    assert.equal(restoredTowerBodies[1].mapRecoveryAnchorId,
        'map:recovery-test:tower-spawn');
    assert.equal(restoredTowerBodies[1].mapRecoveryLatticeVersion, 3);
    assert.deepEqual({ ...restoredTowerBodies[1].velocity }, { x: 0, y: 0 });
    assert.equal('actorTransitPhase' in restoredTowerBodies[1], false);
    assert.deepEqual(snapshotLogicalRecords(), logicalRecordsBeforeRecovery);
    assert.equal(
        towerGroupState.getTowerRecords()[1].creationMetadata
            .sourceExecutionId,
        'ability-execution.r5.recovery:41'
    );
    const reboundRecords = towerGroupState.getTowerRecords();
    assert.equal(reboundRecords.every(({ exactGpuBinding }) => (
        exactGpuBinding?.sessionGeneration
            === replacementEndpoint.getStatus().sessionGeneration
    )), true);
    assert.equal(reboundRecords.every((record, index) => (
        record.exactGpuBinding !== oldBindings[index]
            && record.exactGpuBinding.sessionGeneration
                !== oldBindings[index].sessionGeneration
    )), true);
    assert.equal(towerGroupState.getPrimaryTowerRecord().currentHpFixedPoint,
        logicalRecordsBeforeRecovery[0].currentHpFixedPoint);
    assert.equal(backends[2].towerGroupRosters.at(-1).records.length, 2);
    assert.deepEqual(snapshotCoreStatus(), coreStatusBeforeRecovery);
    assert.deepEqual(gameSystem.getRunOutcome().getStatus(), runStatusBeforeRecovery);
    assert.equal(gameSystem.getGold(), goldBeforeRecovery);

    assert.equal(gameSystem.fixedUpdate(), true);
    const restagedCommand = backends[2].towerGroupCommands.at(-1);
    assert.ok(restagedCommand);
    assert.deepEqual({ ...restagedCommand.moveIntent }, { x: 1, y: 0 });
    assert.equal(Number.isFinite(restagedCommand.aimWorldPoint.x), true);
    assert.equal(Number.isFinite(restagedCommand.aimWorldPoint.y), true);
    assert.equal(gameSystem.getTowerCreationStatus().state, 'idle');
    assert.equal(backends[2].towerCreationStageCalls.length, 0);
    assert.equal(
        gameSystem.getAbilitySlotViews().find(({ slotId }) => slotId === 'Q')
            .preview.subjectCount,
        2
    );

    const recoveryHostileHandle = requestHostileProjectileForNextTick(
        gameSystem,
        11
    );
    const primaryBeforeDeath = towerGroupState.getPrimaryTowerRecord();
    const survivingBeforeDeath = towerGroupState.getTowerRecords()[1];
    backends[2].queueCompletedEvents(
        gameSystem.getFixedTick(),
        createTowerDamageEvents(
            recoveryHostileHandle,
            primaryBeforeDeath.exactGpuBinding,
            primaryBeforeDeath.currentHp,
            true
        )
    );
    assert.equal(gameSystem.fixedUpdate(), true);
    const groupAfterPrimaryDeath = towerGroupState.getStatus();
    assert.equal(groupAfterPrimaryDeath.livingTowerCount, 1);
    assert.equal(
        groupAfterPrimaryDeath.primaryLogicalTowerId,
        survivingBeforeDeath.logicalTowerId
    );
    assert.equal(
        groupAfterPrimaryDeath.lostShareUnits,
        primaryBeforeDeath.shareUnits
    );
    assert.equal(
        groupAfterPrimaryDeath.lastCommittedFacts.some(
            ({ type }) => type === 'TowerShareLost'
        ),
        true
    );
    const survivingPrimary = towerGroupState.getPrimaryTowerRecord();
    const gpuActorStatus = objectSystem.getGpuWorldActorStatus();
    assert.deepEqual(
        { ...gpuActorStatus.towerHandle },
        {
            entityId: survivingPrimary.exactGpuBinding.entityId,
            incarnation: survivingPrimary.exactGpuBinding.incarnation
        }
    );
    assert.deepEqual(
        { ...backends[2].towerGameplayTargetHandle },
        { ...gpuActorStatus.towerHandle }
    );
    assert.equal(towerFacade.getStatus().active, true);
    assert.equal(primaryController.getStatus().enabled, true);
    assert.equal(
        gameSystem.getAbilitySlotViews().find(({ slotId }) => slotId === 'Q')
            .preview.subjectCount,
        1
    );
    assert.equal(objectSystem.getWorldRegistry().getActiveCount('tower'), 1);
    assert.deepEqual(snapshotCoreStatus(), coreStatusBeforeRecovery);
    assert.deepEqual(gameSystem.getRunOutcome().getStatus(), runStatusBeforeRecovery);
    assert.equal(gameSystem.getGold(), goldBeforeRecovery);

    gameSystem.destroy();
    assert.equal(backends[2].destroyCount, 1);
});

test('Tower HP 17 recovery, exact death cutover, zero-Tower 진행과 dead Core-only recovery를 보존한다', () => {
    const backends = [];
    const backendModes = ['normal', 'init-throws', 'normal', 'normal'];
    const hostileDirectors = createTrackingHostileAttackDirectorFactory();
    let throwNextBackendFactory = false;
    let backendFactoryThrowCount = 0;
    const pointer = { pressed: false };
    const dependencies = {
        inputActionSource: {
            isPressed() {
                return false;
            },
            getPointerPosition(out) {
                out.x = 320;
                out.y = 180;
                return out;
            },
            isPrimaryPointerPressed() {
                return pointer.pressed;
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
                return { ready: true, deviceGeneration: 7 };
            }
        },
        enemySimulationBackendFactory(_backendDependencies, options) {
            if (throwNextBackendFactory) {
                throwNextBackendFactory = false;
                backendFactoryThrowCount++;
                throw new Error('replacement backend factory failure');
            }
            const backend = new CombatRecoveryBackend(
                backendModes[backends.length] ?? 'normal',
                options.sessionGeneration
            );
            backends.push(backend);
            return backend;
        },
        hostileAttackDirectorFactory: hostileDirectors.factory,
        jorangSplitLineageDirectorFactory:
            createIdleJorangSplitLineageDirector,
        projectileCaptureDirectorFactory:
            createIdleProjectileCaptureDirector
    };
    const gameSystem = new GameSystem(dependencies, {
        enemyWaveEnabled: false
    });
    assert.equal(gameSystem.enter(), true);

    const objectSystem = gameSystem.getObjectSystem();
    const coreIntegrity = gameSystem.getCoreIntegrity();
    const corePresentation = objectSystem.getCore();
    const towerFacade = objectSystem.getTower();
    const primaryController = objectSystem.primaryProjectileController;
    const initialHostileDirector = objectSystem.hostileAttackDirector;
    const inputRouter = gameSystem.playerControlRouter;
    const inputMapper = gameSystem.inputActionMapper;
    const cameraController = gameSystem.getCameraZoomController();
    const coreCurrent = coreIntegrity.getCurrentIntegrity();
    const coreMax = coreIntegrity.getMaxIntegrity();

    assert.equal(gameSystem.fixedUpdate(), true);
    const initialEndpoint = gameSystem.getGpuSimulationEndpoint();
    const initialTowerHandle = objectSystem.getGpuWorldActorStatus().towerHandle;
    const initialTowerStatus = gameSystem.getTowerCombatStatus();
    assert.equal(Object.isFrozen(initialTowerStatus), true);
    assert.equal(initialTowerStatus.alive, true);
    assert.equal(initialTowerStatus.currentHp, 30);
    assert.deepEqual({ ...initialTowerStatus.boundGpuBody }, {
        ...initialTowerHandle,
        ...backends[0].eventProtocol
    });
    assert.equal(backends[0].spawnBatches.length, 1);
    assert.equal(backends[0].spawnBatches[0].length, 2);
    assert.equal(hostileDirectors.instances.length, 1);
    assert.strictEqual(hostileDirectors.instances[0], initialHostileDirector);
    assert.equal(initialHostileDirector.stageCalls.length, 1);
    assert.equal(initialHostileDirector.stageCalls[0].targetHandle, null);
    assert.equal(gameSystem.getHostileAttackStatus().activeArcherCount, 0);
    assert.equal(gameSystem.getHostileAttackStatus().pendingShotCount, 0);

    const firstHostileHandle = requestHostileProjectileForNextTick(
        gameSystem,
        0
    );
    assert.deepEqual(
        { ...initialHostileDirector.stageCalls.at(-1).targetHandle },
        { ...initialTowerHandle }
    );
    backends[0].queueCompletedEvents(2, createTowerDamageEvents(
        firstHostileHandle,
        initialTowerHandle,
        13
    ));
    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(gameSystem.getFixedTick(), 3);
    const damagedStatus = gameSystem.getTowerCombatStatus();
    assert.equal(damagedStatus.alive, true);
    assert.equal(damagedStatus.currentHp, 17);
    assert.equal(damagedStatus.lastCommittedDamage.damage, 13);
    assert.equal(
        damagedStatus.lastCommittedDamage.producerId,
        'runtime-hostile-fixture'
    );
    assert.equal(coreIntegrity.getCurrentIntegrity(), coreCurrent);
    assert.deepEqual(
        { ...initialHostileDirector.stageCalls.at(-1).targetHandle },
        { ...initialTowerHandle }
    );

    const oldBinding = damagedStatus.boundGpuBody;
    backends[0].hardFailNextFixed = true;
    assert.equal(gameSystem.fixedUpdate(), false);
    assert.equal(gameSystem.getFixedTick(), 3);
    assert.equal(gameSystem.isGpuWorldRecoveryRequired(), true);
    throwNextBackendFactory = true;
    assert.equal(gameSystem.restartGpuWorldAtSafeWaveBoundary(), false);
    assert.equal(backendFactoryThrowCount, 1);
    assert.equal(backends.length, 1);
    assert.strictEqual(gameSystem.getGpuSimulationEndpoint(), initialEndpoint);
    assert.strictEqual(
        objectSystem.getGpuWorldActorStatus().towerHandle,
        initialTowerHandle
    );
    assert.strictEqual(towerFacade.getStatus().bodyHandle, initialTowerHandle);
    assert.strictEqual(gameSystem.getTowerCombatStatus().boundGpuBody, oldBinding);
    assert.equal(gameSystem.getTowerCombatStatus().currentHp, 17);
    assert.strictEqual(gameSystem.getObjectSystem(), objectSystem);
    assert.strictEqual(gameSystem.getCoreIntegrity(), coreIntegrity);
    assert.strictEqual(objectSystem.getCore(), corePresentation);
    assert.strictEqual(objectSystem.getTower(), towerFacade);
    assert.strictEqual(gameSystem.playerControlRouter, inputRouter);
    assert.strictEqual(gameSystem.inputActionMapper, inputMapper);
    assert.strictEqual(gameSystem.getCameraZoomController(), cameraController);
    assert.strictEqual(objectSystem.primaryProjectileController, primaryController);
    assert.strictEqual(objectSystem.hostileAttackDirector, initialHostileDirector);
    assert.equal(initialHostileDirector.destroyCount, 0);
    assert.equal(coreIntegrity.getCurrentIntegrity(), coreCurrent);
    assert.equal(coreIntegrity.getMaxIntegrity(), coreMax);
    assert.equal(backends[0].destroyCount, 0);

    assert.equal(gameSystem.restartGpuWorldAtSafeWaveBoundary(), false);
    assert.equal(backends.length, 2);
    assert.equal(backends[1].destroyCount, 1);
    assert.strictEqual(gameSystem.getGpuSimulationEndpoint(), initialEndpoint);
    assert.strictEqual(
        objectSystem.getGpuWorldActorStatus().towerHandle,
        initialTowerHandle
    );
    assert.strictEqual(towerFacade.getStatus().bodyHandle, initialTowerHandle);
    assert.strictEqual(gameSystem.getTowerCombatStatus().boundGpuBody, oldBinding);
    assert.equal(gameSystem.getTowerCombatStatus().currentHp, 17);
    assert.equal(backends[0].destroyCount, 0);
    assert.strictEqual(objectSystem.hostileAttackDirector, initialHostileDirector);
    assert.equal(initialHostileDirector.destroyCount, 0);

    assert.equal(gameSystem.restartGpuWorldAtSafeWaveBoundary(), true);
    const aliveReplacementEndpoint = gameSystem.getGpuSimulationEndpoint();
    const aliveReplacementHostileDirector = objectSystem.hostileAttackDirector;
    assert.notStrictEqual(aliveReplacementEndpoint, initialEndpoint);
    assert.equal(backends[0].destroyCount, 1);
    assert.notStrictEqual(aliveReplacementHostileDirector, initialHostileDirector);
    assert.equal(initialHostileDirector.destroyCount, 1);
    assert.equal(initialHostileDirector.completedEventCalls.length, 0);
    assert.equal(initialHostileDirector.stageCalls.length, 0);
    assert.equal(initialHostileDirector.fixedCommitCalls.length, 0);
    assert.equal(aliveReplacementHostileDirector.getStatus().stageCallCount, 0);
    assert.equal(aliveReplacementHostileDirector.completedEventCalls.length, 0);
    assert.equal(aliveReplacementHostileDirector.fixedCommitCalls.length, 0);
    assert.equal(gameSystem.getHostileAttackStatus().activeArcherCount, 0);
    assert.equal(gameSystem.getHostileAttackStatus().pendingShotCount, 0);
    assert.equal(gameSystem.getTowerCombatStatus().currentHp, 17);
    assert.equal(gameSystem.getTowerCombatStatus().boundGpuBody, null);

    backends[0].queueCompletedEvents(4, createTowerDamageEvents(
        firstHostileHandle,
        initialTowerHandle,
        13
    ));
    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(gameSystem.getFixedTick(), 4);
    assert.equal(backends[2].spawnBatches.length, 1);
    assert.equal(backends[2].spawnBatches[0].length, 2);
    const restoredTowerBody = backends[2].spawnBatches[0].find(
        ({ kindId }) => kindId === 'tower'
    );
    assert.ok(restoredTowerBody);
    assert.equal(restoredTowerBody.health, 17);
    const restoredTowerHandle = objectSystem.getGpuWorldActorStatus().towerHandle;
    assert.notStrictEqual(restoredTowerHandle, initialTowerHandle);
    assert.equal(gameSystem.getTowerCombatStatus().alive, true);
    assert.equal(gameSystem.getTowerCombatStatus().currentHp, 17);
    assert.equal(
        gameSystem.getTowerCombatStatus().boundGpuBody.sessionGeneration,
        aliveReplacementEndpoint.getStatus().sessionGeneration
    );
    assert.equal(aliveReplacementHostileDirector.stageCalls.at(-1).targetHandle, null);

    const secondHostileHandle = requestHostileProjectileForNextTick(
        gameSystem,
        1
    );
    assert.deepEqual(
        { ...aliveReplacementHostileDirector.stageCalls.at(-1).targetHandle },
        { ...restoredTowerHandle }
    );
    const fixedPlanCountBeforeDeath = backends[2].fixedProgramPlans.length;
    pointer.pressed = true;
    backends[2].queueCompletedEvents(5, createTowerDamageEvents(
        secondHostileHandle,
        restoredTowerHandle,
        17,
        true
    ));
    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(gameSystem.getFixedTick(), 6);

    const deadStatus = gameSystem.getTowerCombatStatus();
    assert.equal(deadStatus.alive, false);
    assert.equal(deadStatus.livingTowerCount, 0);
    assert.equal(deadStatus.currentHp, 0);
    assert.equal(deadStatus.boundGpuBody, null);
    assert.equal(Object.isFrozen(deadStatus.lastCommittedFacts), true);
    assert.deepEqual(
        Array.from(deadStatus.lastCommittedFacts, ({ type }) => type),
        ['TowerDamageApplied', 'TowerDied', 'NoLivingTowers']
    );
    assert.equal(deadStatus.lastCommittedDamage.damage, 17);
    assert.equal(deadStatus.lastCommittedDamage.currentHp, 0);
    assert.equal(
        deadStatus.lastCommittedDeath.producerId,
        'runtime-hostile-fixture'
    );
    assert.deepEqual(
        { ...deadStatus.lastCommittedDeath.sourceHandle },
        { ...secondHostileHandle }
    );
    assert.equal(objectSystem.getGpuWorldActorStatus().towerHandle, null);
    assert.ok(objectSystem.getGpuWorldActorStatus().coreProxyHandle);
    assert.equal(
        objectSystem.getGpuWorldActorStatus().towerGameplayTargetConfigured,
        false
    );
    assert.equal(objectSystem.getGpuWorldActorStatus().trackedTowerConfigured, false);
    assert.equal(towerFacade.getStatus().active, false);
    assert.equal(towerFacade.getStatus().lastPoseRejection, 'tower-dead');
    assert.equal(primaryController.getStatus().enabled, false);
    assert.equal(backends[2].trackedHandle, null);
    assert.equal(backends[2].towerGameplayTargetHandle, null);
    assert.equal(backends[2].fixedProgramPlans.length, fixedPlanCountBeforeDeath);
    assert.equal(aliveReplacementHostileDirector.stageCalls.at(-1).targetHandle, null);
    assert.equal(gameSystem.getHostileAttackStatus().lastTargetHandle, null);
    assert.equal(
        objectSystem.getWorldRegistry().getActiveCount('tower'),
        0
    );
    assert.equal(
        objectSystem.getWorldRegistry().getActiveCount('core-proxy'),
        1
    );
    assert.equal(
        objectSystem.getWorldRegistry().getActiveCount('projectile'),
        1
    );
    assert.equal(gameSystem.isGpuWorldRecoveryRequired(), false);
    assert.equal(coreIntegrity.getCurrentIntegrity(), coreCurrent);
    assert.equal(coreIntegrity.getMaxIntegrity(), coreMax);

    for (let index = 0; index < 10; index++) {
        assert.equal(gameSystem.fixedUpdate(), true);
    }
    assert.equal(gameSystem.getFixedTick(), 16);
    assert.equal(backends[2].fixedProgramPlans.length, fixedPlanCountBeforeDeath);
    assert.equal(
        objectSystem.getWorldRegistry().getActiveCount('projectile'),
        1
    );
    assert.equal(gameSystem.isGpuWorldRecoveryRequired(), false);
    assert.equal(
        aliveReplacementHostileDirector.stageCalls.slice(-10)
            .every(({ targetHandle }) => targetHandle === null),
        true
    );

    backends[2].hardFailNextFixed = true;
    assert.equal(gameSystem.fixedUpdate(), false);
    assert.equal(gameSystem.restartGpuWorldAtSafeWaveBoundary(), true);
    const deadReplacementHostileDirector = objectSystem.hostileAttackDirector;
    assert.notStrictEqual(
        deadReplacementHostileDirector,
        aliveReplacementHostileDirector
    );
    assert.equal(aliveReplacementHostileDirector.destroyCount, 1);
    assert.equal(aliveReplacementHostileDirector.completedEventCalls.length, 0);
    assert.equal(aliveReplacementHostileDirector.stageCalls.length, 0);
    assert.equal(aliveReplacementHostileDirector.fixedCommitCalls.length, 0);
    assert.equal(deadReplacementHostileDirector.getStatus().stageCallCount, 0);
    assert.equal(deadReplacementHostileDirector.completedEventCalls.length, 0);
    assert.equal(deadReplacementHostileDirector.fixedCommitCalls.length, 0);
    assert.equal(gameSystem.getTowerCombatStatus().alive, false);
    assert.equal(gameSystem.getTowerCombatStatus().currentHp, 0);
    assert.equal(gameSystem.fixedUpdate(), true);
    assert.equal(gameSystem.getFixedTick(), 17);
    assert.equal(backends[3].spawnBatches.length, 1);
    assert.deepEqual(
        Array.from(backends[3].spawnBatches[0], ({ kindId }) => kindId),
        ['core-proxy']
    );
    assert.equal(backends[3].fixedProgramPlans.length, 0);
    assert.equal(
        objectSystem.getWorldRegistry().getActiveCount('tower'),
        0
    );
    assert.equal(
        objectSystem.getWorldRegistry().getActiveCount('core-proxy'),
        1
    );
    assert.equal(primaryController.getStatus().enabled, false);
    assert.equal(backends[3].towerGameplayTargetHandle, null);
    assert.equal(backends[3].trackedHandle, null);
    assert.equal(deadReplacementHostileDirector.stageCalls.at(-1).targetHandle, null);
    assert.equal(gameSystem.getHostileAttackStatus().activeArcherCount, 0);
    assert.equal(gameSystem.getHostileAttackStatus().pendingShotCount, 0);

    assert.strictEqual(gameSystem.getObjectSystem(), objectSystem);
    assert.strictEqual(gameSystem.getCoreIntegrity(), coreIntegrity);
    assert.strictEqual(objectSystem.getCore(), corePresentation);
    assert.strictEqual(objectSystem.getTower(), towerFacade);
    assert.strictEqual(gameSystem.playerControlRouter, inputRouter);
    assert.strictEqual(gameSystem.inputActionMapper, inputMapper);
    assert.strictEqual(gameSystem.getCameraZoomController(), cameraController);
    assert.equal(coreIntegrity.getCurrentIntegrity(), coreCurrent);
    assert.equal(coreIntegrity.getMaxIntegrity(), coreMax);
    assert.equal(gameSystem.isGpuWorldRecoveryRequired(), false);

    gameSystem.destroy();
    assert.equal(backends[3].destroyCount, 1);
    assert.equal(deadReplacementHostileDirector.destroyCount, 1);
});

test('선택한 enemy presentation profile을 소유한 같은 GameSystem이 GPU world만 재시작한다', async () => {
    const instances = [];
    class CapturingGameSystem {
        constructor(dependencies, options) {
            this.dependencies = dependencies;
            this.options = options;
            this.enterCount = 0;
            this.destroyCount = 0;
            this.restartCount = 0;
            this.recoveryRequired = true;
            instances.push(this);
        }

        enter() {
            this.enterCount++;
            return true;
        }

        fixedUpdate() {
            return this.restartCount > 0;
        }

        isEnemySimulationRecoveryRequired() {
            return this.recoveryRequired;
        }

        restartGpuWorldAtSafeWaveBoundary() {
            if (!this.recoveryRequired) {
                return false;
            }
            this.restartCount++;
            this.recoveryRequired = false;
            return true;
        }

        destroy() {
            if (this.destroyCount > 0) {
                return;
            }
            this.destroyCount++;
        }
    }

    const ProfileGameScene = await loadGameSceneWithGameSystem(
        CapturingGameSystem
    );
    const profiles = Object.values(GPU_BODY_PRESENTATION_PROFILE);

    for (let profileIndex = 0; profileIndex < profiles.length; profileIndex++) {
        const profile = profiles[profileIndex];
        const firstInstanceIndex = instances.length;
        let legacyClearCount = 0;
        const dependencies = {
            webGpuPlatformPort: {
                getState() {
                    return {
                        ready: true,
                        deviceGeneration: profileIndex + 1
                    };
                }
            },
            legacyWorldPort: {
                clear() {
                    legacyClearCount++;
                }
            }
        };
        const tileNavigationSource = Object.freeze({
            id: `injected-navigation-${profileIndex}`
        });
        const scene = new ProfileGameScene({}, {
            dependencies,
            tileNavigationSource,
            enemyPresentationProfile: profile
        });
        const initialSystem = instances[firstInstanceIndex];

        assert.strictEqual(initialSystem.dependencies, dependencies);
        assert.equal(initialSystem.options.enemyPresentationProfile, profile);
        assert.strictEqual(
            initialSystem.options.tileNavigationSource,
            tileNavigationSource
        );
        assert.equal(initialSystem.enterCount, 1);

        scene.fixedUpdate();
        assert.equal(instances.length, firstInstanceIndex + 1);
        assert.strictEqual(scene.getGameSystem(), initialSystem);
        assert.equal(initialSystem.destroyCount, 0);
        assert.equal(initialSystem.restartCount, 1);
        assert.equal(scene.getEnemyRecoveryStatus().restartCount, 1);
        assert.equal(
            scene.getEnemyRecoveryStatus().restartGeneration,
            profileIndex + 1
        );
        assert.equal(legacyClearCount, 1);

        scene.fixedUpdate();
        assert.equal(instances.length, firstInstanceIndex + 1);
        assert.equal(scene.getEnemyRecoveryStatus().restartGeneration, null);
        assert.equal(initialSystem.restartCount, 1);
        assert.equal(legacyClearCount, 1);

        scene.destroy();
        scene.destroy();
        assert.equal(initialSystem.destroyCount, 1);
        assert.equal(legacyClearCount, 2);
    }
});

test('recovery를 끈 benchmark child는 hard GPU 상태에서도 session과 적 registry를 자동 교체하지 않는다', async () => {
    const instances = [];
    class RecoveryDisabledGameSystem {
        constructor(dependencies, options) {
            this.dependencies = dependencies;
            this.options = options;
            this.fixedUpdateCount = 0;
            this.destroyCount = 0;
            instances.push(this);
        }

        enter() {
            return true;
        }

        fixedUpdate() {
            this.fixedUpdateCount++;
            return false;
        }

        isEnemySimulationRecoveryRequired() {
            return true;
        }

        destroy() {
            this.destroyCount++;
        }
    }

    const RecoveryDisabledGameScene = await loadGameSceneWithGameSystem(
        RecoveryDisabledGameSystem
    );
    let legacyClearCount = 0;
    const dependencies = {
        webGpuPlatformPort: {
            getState() {
                return { ready: true, deviceGeneration: 7 };
            }
        },
        legacyWorldPort: {
            clear() {
                legacyClearCount++;
            }
        }
    };
    const tileNavigationSource = Object.freeze({ id: 'benchmark-arena' });
    const scene = new RecoveryDisabledGameScene({}, {
        dependencies,
        tileNavigationSource,
        enemyRecoveryEnabled: false
    });

    scene.fixedUpdate();
    scene.fixedUpdate();

    assert.equal(instances.length, 1);
    assert.equal(instances[0].fixedUpdateCount, 2);
    assert.equal(instances[0].destroyCount, 0);
    assert.strictEqual(
        instances[0].options.tileNavigationSource,
        tileNavigationSource
    );
    assert.deepEqual(
        { ...scene.getEnemyRecoveryStatus() },
        { restartCount: 0, restartGeneration: null }
    );
    assert.equal(legacyClearCount, 1);

    scene.destroy();
    assert.equal(instances[0].destroyCount, 1);
    assert.equal(legacyClearCount, 2);
});
