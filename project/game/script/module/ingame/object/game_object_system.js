import { assertCollidable2D } from '../contract/collidable_contract.js';
import { assertCameraFollowTarget2D } from '../contract/camera_control_contract.js';
import { assertCoreIntegrity } from '../contract/core_integrity_contract.js';
import { assertRunOutcome } from '../contract/run_outcome_contract.js';
import { assertPhysicsBody2D } from '../contract/physics_body_contract.js';
import { assertTileNavigationSource } from '../contract/tile_navigation_contract.js';
import {
    GAME_WORLD_SESSION_MODE,
    assertGameWorldSessionMode,
    resolveGameWorldSessionPolicy,
    selectGameWorldSessionMode
} from '../game_world_session_mode.js';
import { TileMapCollisionResolver } from '../map/tile_map_collision_resolver.js';
import { TileMapRenderer } from '../map/tile_map_renderer.js';
import { createTileMap } from '../map/tile_map.js';
import { WorldCamera2D } from '../map/world_camera_2d.js';
import { WaveDirector } from '../flow/wave_director.js';
import { CorePresentationFacade } from './core/core_presentation_facade.js';
import {
    GPU_CORE_PROXY_WORLD_KIND_ID,
    createGpuCoreProxySpawnIntent
} from './core/gpu_core_proxy_spawn_adapter.js';
import {
    createGpuSimulationEndpoint
} from './enemy/gpu_enemy_simulation_endpoint.js';
import {
    HostileAttackDirector
} from './enemy/hostile_attack_director.js';
import {
    EnemyCoreImpactDirector
} from './enemy/enemy_core_impact_director.js';
import { TheCore } from './the_core.js';
import { TheCoreRenderer } from './the_core_renderer.js';
import { TheTower } from './the_tower.js';
import { TheTowerRenderer } from './the_tower_renderer.js';
import {
    GpuPrimaryProjectileController
} from './projectile/gpu_primary_projectile_controller.js';
import { TowerPlayerController } from './tower_player_controller.js';
import { GpuTowerActorFacade } from './tower/gpu_tower_actor_facade.js';
import {
    GPU_TOWER_WORLD_KIND_ID,
    createGpuTowerSpawnIntent
} from './tower/gpu_tower_spawn_adapter.js';
import {
    TowerCoreCameraFollowTarget
} from './tower_core_camera_follow_target.js';
import { RunOutcome } from '../state/run_outcome.js';
import {
    GPU_FIXED_PRIMITIVE_TERMINAL_CANCEL_ABI_VERSION
} from '../physics/gpu/gpu_fixed_primitive_abi.js';

const EMPTY_TOWER_COMBAT_FACTS = Object.freeze([]);
const EMPTY_CORE_IMPACT_FACTS = Object.freeze([]);
const REPLACEMENT_GPU_ENDPOINT_INITIALIZED_STATES = new Set([
    'gpu-deferred',
    'gpu-ready'
]);

const GPU_WORLD_TERMINAL_STATE = Object.freeze({
    RUNNING: 'RUNNING',
    FINAL_COMMIT_PENDING: 'FINAL_COMMIT_PENDING',
    SEALED: 'SEALED',
    SEALED_FAILED: 'SEALED_FAILED'
});

function syncWorldViewport(target, source = {}) {
    const ww = Number(source.ww);
    const wh = Number(source.wh);
    target.ww = Number.isFinite(ww) ? Math.max(0, ww) : 0;
    target.wh = Number.isFinite(wh) ? Math.max(0, wh) : 0;
    return target;
}

function requireNonNegativeSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
        throw new RangeError(`${label}은 0 이상의 안전한 정수여야 합니다.`);
    }
    return number;
}

function createEmptyGpuEventSnapshot(completedThroughTick = 0) {
    return Object.freeze({
        targetFixedTick: null,
        completedThroughTick,
        batchCount: 0,
        droppedEventCount: 0,
        events: Object.freeze([]),
        contactEvents: Object.freeze([]),
        deathEvents: Object.freeze([]),
        protocolFailure: null
    });
}

const GPU_WORLD_PAUSED_OBSERVATION = Object.freeze({
    valid: false,
    reason: 'gpu-world-paused'
});

function freezeHandle(handle) {
    return Object.freeze({
        entityId: Number(handle.entityId),
        incarnation: Number(handle.incarnation)
    });
}

/**
 * @class GameObjectSystem
 * @description 한 session mode의 CPU fallback world 또는 mixed-body GPU world를 소유합니다.
 */
export class GameObjectSystem {
    #coreImpactCleanupBinding;

    constructor(dependencies, options) {
        const inferredMode = options?.sessionMode
            ?? selectGameWorldSessionMode(dependencies?.webGpuPlatformPort);
        const policy = resolveGameWorldSessionPolicy(
            assertGameWorldSessionMode(inferredMode),
            options
        );
        Object.defineProperty(this, 'sessionMode', {
            value: policy.sessionMode,
            writable: false,
            configurable: false,
            enumerable: true
        });

        this.dependencies = dependencies;
        this.viewport = { ww: 0, wh: 0 };
        this.requestedMapId = typeof options?.mapId === 'string' ? options.mapId : null;
        this.injectedTileNavigationSource = options?.tileNavigationSource ?? null;
        this.coreIntegrity = assertCoreIntegrity(options?.coreIntegrity);
        this.runOutcomeOwned = !options?.runOutcome;
        this.runOutcome = options?.runOutcome
            ? assertRunOutcome(options.runOutcome)
            : new RunOutcome();
        this.towerCombatRoster = options?.towerCombatRoster ?? null;
        if (this.towerCombatRoster !== null
            && (typeof this.towerCombatRoster.commitCompletedEvents !== 'function'
                || typeof this.towerCombatRoster.isPrimaryTowerAlive !== 'function'
                || typeof this.towerCombatRoster.getPrimaryTowerCurrentHp !== 'function'
                || typeof this.towerCombatRoster.bindGpuBody !== 'function'
                || typeof this.towerCombatRoster.releaseGpuBinding !== 'function'
                || typeof this.towerCombatRoster.getStatus !== 'function')) {
            throw new TypeError('towerCombatRoster contract가 올바르지 않습니다.');
        }
        this.waveDefinition = options?.waveDefinition;
        this.enemyPresentationProfile = options?.enemyPresentationProfile;
        this.gameplayWorldActorsEnabled = policy.gameplayWorldActorsEnabled;
        this.enemyWaveEnabled = policy.enemyWaveEnabled;
        this.initialFixedTick = requireNonNegativeSafeInteger(
            options?.initialFixedTick ?? 0,
            'initialFixedTick'
        );

        this.endpointDependencies = Object.freeze({
            webGpuPlatformPort: dependencies?.webGpuPlatformPort ?? null,
            enemySimulationBackendFactory: dependencies?.enemySimulationBackendFactory,
            enemySimulationBackend: dependencies?.enemySimulationBackend
        });
        this.hostileAttackDirectorFactory
            = dependencies?.hostileAttackDirectorFactory
                ?? ((directorOptions) => new HostileAttackDirector(directorOptions));
        if (typeof this.hostileAttackDirectorFactory !== 'function') {
            throw new TypeError('hostileAttackDirectorFactory는 함수여야 합니다.');
        }
        this.enemyCoreImpactDirectorFactory
            = dependencies?.enemyCoreImpactDirectorFactory
                ?? ((directorOptions) => new EnemyCoreImpactDirector(directorOptions));
        if (typeof this.enemyCoreImpactDirectorFactory !== 'function') {
            throw new TypeError('enemyCoreImpactDirectorFactory는 함수여야 합니다.');
        }
        this.endpointSessionCount = 0;
        this.enemySimulationEndpoint = null;
        this.enemySimulationBackend = null;
        this.worldRegistry = null;
        this.enemyLifecycleCommandOwner = null;
        this.#installGpuEndpoint(this.#createGpuEndpoint(true));
        this.hostileAttackDirector = null;
        this.enemyCoreImpactDirector = null;
        if (this.sessionMode === GAME_WORLD_SESSION_MODE.GPU_WORLD) {
            try {
                if (this.gameplayWorldActorsEnabled) {
                    this.hostileAttackDirector = this.#createHostileAttackDirector(
                        this.enemySimulationEndpoint
                    );
                }
                this.enemyCoreImpactDirector = this.#createEnemyCoreImpactDirector(
                    this.enemySimulationEndpoint
                );
            } catch (error) {
                try {
                    this.enemySimulationEndpoint?.destroy();
                } catch {
                    // 최초 Director 생성 실패의 원래 오류를 보존합니다.
                }
                try {
                    this.enemyCoreImpactDirector?.destroy();
                } catch {
                    // 최초 Core director 생성 실패가 endpoint 정리를 가리지 않게 합니다.
                }
                this.#revokeCoreImpactCleanupBinding();
                this.hostileAttackDirector = null;
                this.enemyCoreImpactDirector = null;
                this.enemySimulationEndpoint = null;
                this.enemySimulationBackend = null;
                this.worldRegistry = null;
                this.enemyLifecycleCommandOwner = null;
                throw error;
            }
        }

        this.tileMap = null;
        this.tileCollisionResolver = null;
        this.camera = new WorldCamera2D();
        this.core = null;
        this.tower = null;
        this.cameraFollowTarget = null;
        this.towerController = null;
        this.primaryProjectileController = null;
        this.playerControllables = [];
        this.physicsBodies = [];
        this.collidables = [];
        this.waveDirector = this.enemyWaveEnabled
            ? new WaveDirector({
                waveDefinition: this.waveDefinition,
                fixedTickOffset: this.initialFixedTick
            })
            : null;
        this.lastCompletedEnemyFixedTick = this.initialFixedTick;
        this.pendingEnemyFixedTick = 0;
        this.enemySimulationRecoveryRequired = false;
        this.enemySimulationPaused = false;
        this.lastCompletedGpuEvents = createEmptyGpuEventSnapshot(this.initialFixedTick);
        this.lastTowerCombatFacts = EMPTY_TOWER_COMBAT_FACTS;
        this.lastCoreImpactFacts = EMPTY_CORE_IMPACT_FACTS;
        this.terminalState = GPU_WORLD_TERMINAL_STATE.RUNNING;
        this.terminalDiagnostic = null;
        this.terminalFinalizationTick = 0;
        this.enemyPresentationFrame = {
            frameDelta: 0,
            fixedDelta: 0,
            fixedAlpha: 0
        };
        this.actorSpawnTargetFixedTick = 0;
        this.towerSpawnCommandId = null;
        this.coreProxySpawnCommandId = null;
        this.actorLifecycleQueued = false;
        this.towerHandle = null;
        this.coreProxyHandle = null;
        this.trackedTowerConfigured = false;
        this.tileMapRenderer = new TileMapRenderer(dependencies?.worldRenderPort);
        this.coreRenderer = new TheCoreRenderer(dependencies?.worldRenderPort);
        this.towerRenderer = this.sessionMode
            === GAME_WORLD_SESSION_MODE.CPU_NO_WAVE_FALLBACK
            ? new TheTowerRenderer(dependencies?.worldRenderPort)
            : null;
        this.initialized = false;
        this.destroyed = false;
    }

    init(viewport) {
        if (this.initialized || this.destroyed) {
            return;
        }
        syncWorldViewport(this.viewport, viewport);
        this.tileMap = assertTileNavigationSource(
            this.injectedTileNavigationSource
                ?? createTileMap(this.requestedMapId)
        );
        this.enemySimulationEndpoint.init(this.tileMap);
        this.enemyCoreImpactDirector?.resetGpuBinding?.(
            this.enemySimulationEndpoint,
            this.#coreImpactCleanupBinding?.port ?? null
        );
        this.waveDirector?.init(this.tileMap);

        const towerSpawn = this.tileMap.getTowerSpawnPosition();
        const coreSpawn = this.tileMap.getCorePosition();
        if (this.sessionMode === GAME_WORLD_SESSION_MODE.GPU_WORLD) {
            this.tower = new GpuTowerActorFacade();
            this.core = new CorePresentationFacade({
                x: coreSpawn.x,
                y: coreSpawn.y,
                integrity: this.coreIntegrity
            });
            this.playerControllables.push(this.tower);
            if (this.gameplayWorldActorsEnabled) {
                this.primaryProjectileController
                    = new GpuPrimaryProjectileController({
                        tower: this.tower,
                        camera: this.camera,
                        endpoint: this.enemySimulationEndpoint
                    });
                this.playerControllables.push(this.primaryProjectileController);
            }
            this.cameraFollowTarget = assertCameraFollowTarget2D(
                this.towerCombatRoster
                    ? new TowerCoreCameraFollowTarget({
                        tower: this.tower,
                        core: this.core,
                        towerCombatRoster: this.towerCombatRoster
                    })
                    : this.tower
            );
            this.#armGpuWorldActors(this.lastCompletedEnemyFixedTick);
        } else {
            this.tileCollisionResolver = new TileMapCollisionResolver(this.tileMap);
            this.tower = new TheTower({ x: towerSpawn.x, y: towerSpawn.y });
            this.core = new TheCore({
                x: coreSpawn.x,
                y: coreSpawn.y,
                integrity: this.coreIntegrity
            });
            this.physicsBodies.push(
                assertPhysicsBody2D(this.tower.getPhysicsBody()),
                assertPhysicsBody2D(this.core.getPhysicsBody())
            );
            this.collidables.push(
                assertCollidable2D(this.tower.getCollider()),
                assertCollidable2D(this.core.getCollider())
            );
            this.towerController = new TowerPlayerController(this.tower);
            this.playerControllables.push(this.towerController);
            this.cameraFollowTarget = assertCameraFollowTarget2D(this.tower);
        }

        this.camera.init(this.tileMap.getWorldBounds(), this.viewport);
        this.initialized = true;
    }

    getSessionMode() {
        return this.sessionMode;
    }

    getPlayerControllables() {
        return this.playerControllables;
    }

    getPhysicsBodies() {
        return this.physicsBodies;
    }

    getCollidables() {
        return this.collidables;
    }

    getTower() {
        return this.tower;
    }

    getCameraFollowTarget() {
        return this.cameraFollowTarget;
    }

    getCore() {
        return this.core;
    }

    getTileMap() {
        return this.tileMap;
    }

    getWorldViewProjection() {
        return this.camera;
    }

    getEnemySpawnRoutes() {
        return this.tileMap?.getSpawnRoutes() ?? [];
    }

    getEnemySimulationBackend() {
        return this.enemySimulationBackend;
    }

    getGpuSimulationEndpoint() {
        return this.enemySimulationEndpoint;
    }

    getEnemySimulationEndpoint() {
        return this.getGpuSimulationEndpoint();
    }

    getWorldRegistry() {
        return this.worldRegistry;
    }

    getEnemyLifecycleCommandOwner() {
        return this.enemyLifecycleCommandOwner;
    }

    getEnemyWaveStatus() {
        return this.waveDirector?.getStatus() ?? null;
    }

    getLastCompletedEnemyFixedTick() {
        return this.lastCompletedEnemyFixedTick;
    }

    getLastCompletedGpuEvents() {
        return this.lastCompletedGpuEvents;
    }

    getTowerCombatStatus() {
        return this.towerCombatRoster?.getStatus() ?? null;
    }

    /** lifecycle 기반 hostile attack producer의 bounded 진단 snapshot입니다. */
    getHostileAttackStatus() {
        return this.hostileAttackDirector?.getStatus() ?? null;
    }

    /** Core arrival/disposition CPU domain의 bounded facts와 cleanup 상태입니다. */
    getCoreImpactStatus() {
        return this.enemyCoreImpactDirector?.getStatus() ?? null;
    }

    /** defeat 이후에도 presentation이 읽을 수 있는 terminal lifecycle 상태입니다. */
    getTerminalStatus() {
        return Object.freeze({
            state: this.terminalState,
            finalizationTick: this.terminalFinalizationTick,
            diagnostic: this.terminalDiagnostic,
            outcome: this.runOutcome.getStatus(),
            lastCoreImpactFacts: this.lastCoreImpactFacts
        });
    }

    getGpuWorldActorStatus() {
        return Object.freeze({
            enabled: this.gameplayWorldActorsEnabled,
            spawnTargetFixedTick: this.actorSpawnTargetFixedTick,
            lifecycleQueued: this.actorLifecycleQueued,
            towerHandle: this.towerHandle,
            coreProxyHandle: this.coreProxyHandle,
            trackedTowerConfigured: this.trackedTowerConfigured,
            towerAlive: this.#isPrimaryTowerAlive(),
            towerCurrentHp: this.towerCombatRoster
                ?.getPrimaryTowerCurrentHp() ?? null,
            lastTowerCombatFacts: this.lastTowerCombatFacts,
            lastCoreImpactFacts: this.lastCoreImpactFacts,
            terminal: this.getTerminalStatus()
        });
    }

    getNextGpuLifecycleFixedTick() {
        const lastClosedFixedTick = this.pendingEnemyFixedTick !== 0
            ? this.pendingEnemyFixedTick
            : this.lastCompletedEnemyFixedTick;
        if (!Number.isSafeInteger(lastClosedFixedTick)
            || lastClosedFixedTick < 0
            || lastClosedFixedTick >= Number.MAX_SAFE_INTEGER) {
            throw new RangeError('다음 GPU lifecycle fixed tick을 계산할 수 없습니다.');
        }
        return lastClosedFixedTick + 1;
    }

    getNextEnemyLifecycleFixedTick() {
        return this.getNextGpuLifecycleFixedTick();
    }

    isEnemySimulationRecoveryRequired() {
        if (this.runOutcome.isDefeated()) {
            return false;
        }
        return this.enemySimulationRecoveryRequired
            || this.hostileAttackDirector?.requiresRecovery() === true
            || this.enemyCoreImpactDirector?.requiresRecovery() === true;
    }

    isGpuWorldRecoveryRequired() {
        return this.isEnemySimulationRecoveryRequired();
    }

    synchronizeEnemyPresentation() {
        if (this.terminalState === GPU_WORLD_TERMINAL_STATE.SEALED
            || this.terminalState === GPU_WORLD_TERMINAL_STATE.SEALED_FAILED) {
            return;
        }
        this.enemySimulationEndpoint.synchronizePresentation();
    }

    fixedUpdate(delta, proposedFixedTick = this.lastCompletedEnemyFixedTick + 1) {
        if (!this.initialized || this.destroyed) {
            return false;
        }
        if (!Number.isSafeInteger(proposedFixedTick) || proposedFixedTick <= 0) {
            throw new RangeError('proposedFixedTick은 양의 안전한 정수여야 합니다.');
        }
        // Terminal은 presentation/status를 살려 둔 채 endpoint mutation/submit/recovery를
        // 전혀 다시 시도하지 않는 성공 no-op입니다.
        if (this.terminalState === GPU_WORLD_TERMINAL_STATE.SEALED
            || this.terminalState === GPU_WORLD_TERMINAL_STATE.SEALED_FAILED) {
            return true;
        }
        if (this.pendingEnemyFixedTick !== 0
            && this.pendingEnemyFixedTick !== proposedFixedTick) {
            throw new RangeError(
                `미완료 GPU fixed tick이 있습니다: ${this.pendingEnemyFixedTick}`
            );
        }
        const gpuState = this.enemySimulationEndpoint.getRuntimeState();
        const gpuRequired = this.enemyWaveEnabled
            || this.gameplayWorldActorsEnabled
            || this.enemySimulationEndpoint.getPendingCommandCount() > 0
            || this.enemySimulationEndpoint.hasActiveBodies();
        if (!this.runOutcome.isDefeated()
            && !this.coreIntegrity.isDepleted()
            && gpuRequired
            && this.enemySimulationEndpoint.requiresRecovery()
            && gpuState !== 'gpu-backpressure') {
            return this.#pauseForGpuRecovery();
        }
        if (!this.runOutcome.isDefeated()
            && !this.coreIntegrity.isDepleted()
            && (this.hostileAttackDirector?.requiresRecovery() === true
                || this.enemyCoreImpactDirector?.requiresRecovery() === true)) {
            return this.#pauseForGpuRecovery();
        }

        if (this.pendingEnemyFixedTick === 0) {
            const completedEvents = this.enemySimulationEndpoint
                .commitCompletedEventsAtFixedBoundary(proposedFixedTick);
            if (completedEvents.protocolFailure) {
                if (this.runOutcome.isDefeated() || this.coreIntegrity.isDepleted()) {
                    return this.#sealTerminalFailure(
                        'completed-event-protocol',
                        proposedFixedTick,
                        completedEvents.protocolFailure
                    );
                }
                return this.#pauseForGpuRecovery();
            }
            this.lastCompletedGpuEvents = completedEvents;
            this.lastTowerCombatFacts = this.towerCombatRoster
                ?.commitCompletedEvents(completedEvents, this.worldRegistry)
                ?? EMPTY_TOWER_COMBAT_FACTS;
            if (!this.#isPrimaryTowerAlive() && this.towerHandle) {
                this.#cutoverCommittedTowerDeath();
            }
            const coreCompletedObservation = this.enemyCoreImpactDirector
                ?.observeCompletedEvents(completedEvents, this.worldRegistry) ?? null;
            this.lastCoreImpactFacts = coreCompletedObservation?.facts
                ?? EMPTY_CORE_IMPACT_FACTS;
            if (coreCompletedObservation?.recoveryRequired === true) {
                if (this.runOutcome.isDefeated() || this.coreIntegrity.isDepleted()) {
                    return this.#sealTerminalFailure(
                        'core-impact-observe',
                        proposedFixedTick,
                        this.enemyCoreImpactDirector.getStatus().cleanupFailure
                    );
                }
                return this.#pauseForGpuRecovery();
            }
            // Committed Core arrival cleanup을 terminal close보다 먼저 stage해야
            // same-handle 일반/future despawn을 현재 boundary의 authentic CORE
            // command로 승격·retarget하면서 기존 identity를 보존할 수 있습니다.
            const coreStage = this.enemyCoreImpactDirector?.stageForFixedTick({
                endpoint: this.enemySimulationEndpoint,
                targetFixedTick: proposedFixedTick
            }) ?? null;
            if (coreStage?.recoveryRequired === true) {
                if (this.runOutcome.isDefeated() || this.coreIntegrity.isDepleted()) {
                    return this.#sealTerminalFailure(
                        'core-impact-stage',
                        proposedFixedTick,
                        this.enemyCoreImpactDirector.getStatus().cleanupFailure
                    );
                }
                return this.#pauseForGpuRecovery();
            }
            this.#transitionRunOutcomeForCore(
                proposedFixedTick,
                coreCompletedObservation?.coreDepletedFact ?? null
            );
            const hostileCompletedObservation = this.hostileAttackDirector
                ?.observeCompletedEvents(completedEvents) ?? null;
            if (hostileCompletedObservation?.recoveryRequired === true) {
                if (this.runOutcome.isDefeated()) {
                    return this.#sealTerminalFailure(
                        'hostile-observe-after-defeat',
                        proposedFixedTick,
                        hostileCompletedObservation
                    );
                }
                return this.#pauseForGpuRecovery();
            }

            let expectedControlCommandId = null;
            let primaryProjectileShotReceipt = null;
            if (this.runOutcome.isRunning()) {
                this.waveDirector?.queueSpawnsForFixedTick(
                    proposedFixedTick,
                    this.enemySimulationEndpoint
                );
                if (!this.#queueGpuWorldActorsForFixedTick(proposedFixedTick)) {
                    return this.#pauseForGpuRecovery();
                }

                if (this.sessionMode === GAME_WORLD_SESSION_MODE.GPU_WORLD
                    && this.towerHandle) {
                    const targetFixedTick = this.getNextGpuLifecycleFixedTick();
                    if (targetFixedTick !== proposedFixedTick) {
                        throw new RangeError('Tower control과 lifecycle fixed 경계가 다릅니다.');
                    }
                    const receipt = this.tower.stageControlForFixedTick(
                        this.enemySimulationEndpoint,
                        targetFixedTick
                    );
                    if (!receipt?.accepted) {
                        return this.#pauseForGpuRecovery();
                    }
                    expectedControlCommandId = receipt.commandId;
                    primaryProjectileShotReceipt = this.primaryProjectileController
                        ?.stageShotForFixedTick(targetFixedTick) ?? null;
                }

                const hostileStage = this.hostileAttackDirector?.stageForFixedTick({
                    targetFixedTick: proposedFixedTick,
                    targetHandle: this.#isPrimaryTowerAlive()
                        ? this.towerHandle
                        : null,
                    towerTargetHandle: this.#isPrimaryTowerAlive()
                        ? this.towerHandle
                        : null,
                    coreTargetHandle: this.coreProxyHandle
                }) ?? null;
                if (hostileStage?.recoveryRequired === true) {
                    return this.#pauseForGpuRecovery();
                }
            }

            const lifecycleResult = this.enemySimulationEndpoint
                .commitAtFixedBoundary(proposedFixedTick);
            if (lifecycleResult.recoveryRequired) {
                if (this.runOutcome.isDefeated()) {
                    this.enemyCoreImpactDirector?.observeFixedCommit(
                        lifecycleResult,
                        proposedFixedTick
                    );
                    const terminalCancel = this.enemySimulationEndpoint
                        .getTerminalFixedProgramCancelStatus?.() ?? null;
                    return this.#sealTerminalFailure(
                        terminalCancel?.owner
                            && terminalCancel.owner.accepted !== true
                            ? 'terminal-fixed-program-cancel'
                            : 'terminal-lifecycle-commit',
                        proposedFixedTick,
                        terminalCancel?.owner?.accepted === false
                            ? terminalCancel.owner
                            : lifecycleResult
                    );
                }
                this.enemySimulationRecoveryRequired
                    = lifecycleResult.state !== 'stalled';
                if (!this.enemySimulationPaused) {
                    this.enemySimulationEndpoint.synchronizePresentation();
                }
                this.enemySimulationPaused = true;
                return false;
            }
            if (this.runOutcome.isRunning()
                && !this.#bindCommittedGpuWorldActors(lifecycleResult, proposedFixedTick)) {
                return this.#pauseForGpuRecovery();
            }
            if (expectedControlCommandId) {
                const controls = lifecycleResult.fixedCommands?.controls ?? [];
                if (controls.filter(({ commandId }) => (
                    commandId === expectedControlCommandId
                )).length !== 1) {
                    return this.#pauseForGpuRecovery();
                }
            }
            if (primaryProjectileShotReceipt?.accepted === true) {
                this.primaryProjectileController.finalizeFixedCommit(
                    lifecycleResult.fixedCommands,
                    proposedFixedTick
                );
            }
            const hostileCommitObservation = this.hostileAttackDirector
                ?.observeFixedCommit(lifecycleResult, proposedFixedTick) ?? null;
            if (hostileCommitObservation?.recoveryRequired === true) {
                if (this.runOutcome.isDefeated()) {
                    return this.#sealTerminalFailure(
                        'hostile-commit-after-defeat',
                        proposedFixedTick,
                        hostileCommitObservation
                    );
                }
                return this.#pauseForGpuRecovery();
            }
            const coreCommitObservation = this.enemyCoreImpactDirector
                ?.observeFixedCommit(lifecycleResult, proposedFixedTick) ?? null;
            if (coreCommitObservation?.recoveryRequired === true) {
                if (this.runOutcome.isDefeated()) {
                    return this.#sealTerminalFailure(
                        'core-impact-commit',
                        proposedFixedTick,
                        this.enemyCoreImpactDirector.getStatus().cleanupFailure
                    );
                }
                return this.#pauseForGpuRecovery();
            }
            this.pendingEnemyFixedTick = proposedFixedTick;
        }

        const hasActiveBodies = this.enemySimulationEndpoint.hasActiveBodies();
        const gpuSubmitted = this.enemySimulationEndpoint.fixedUpdate(
            delta,
            proposedFixedTick
        );
        const postSubmitState = this.enemySimulationEndpoint.getRuntimeState();
        const gpuStillRequired = this.enemyWaveEnabled
            || this.gameplayWorldActorsEnabled
            || hasActiveBodies
            || this.enemySimulationEndpoint.getPendingCommandCount() > 0;
        const terminalFinalization = this.runOutcome.isDefeated();
        this.enemySimulationRecoveryRequired = !terminalFinalization
            && gpuStillRequired
            && this.enemySimulationEndpoint.requiresRecovery()
            && postSubmitState !== 'gpu-backpressure';
        if (terminalFinalization && !gpuSubmitted) {
            return this.#sealTerminalFailure(
                'terminal-fixed-submit',
                proposedFixedTick,
                Object.freeze({ runtimeState: postSubmitState })
            );
        }
        if (hasActiveBodies && !gpuSubmitted) {
            if (!this.enemySimulationPaused) {
                this.enemySimulationEndpoint.synchronizePresentation();
            }
            this.enemySimulationPaused = true;
            return false;
        }

        this.enemySimulationPaused = false;
        this.enemySimulationRecoveryRequired = false;
        this.lastCompletedEnemyFixedTick = proposedFixedTick;
        this.pendingEnemyFixedTick = 0;
        if (terminalFinalization) {
            return this.#sealTerminalSuccess(proposedFixedTick);
        }
        if (this.sessionMode === GAME_WORLD_SESSION_MODE.CPU_NO_WAVE_FALLBACK) {
            this.tower.fixedUpdate(delta);
            this.tileCollisionResolver.resolve(this.tower.getCollider());
        }
        return true;
    }

    update(alpha, frameDelta = 0, fixedDelta = 0) {
        // Terminal draw/status는 마지막 committed snapshot을 계속 사용합니다. 여기서
        // presentation clock이나 observed Tower pose를 다시 갱신하면 reference clock이
        // 전진하거나 camera follow snapshot이 stale 처리될 수 있습니다.
        if (this.terminalState === GPU_WORLD_TERMINAL_STATE.SEALED
            || this.terminalState === GPU_WORLD_TERMINAL_STATE.SEALED_FAILED) {
            return;
        }
        if (this.sessionMode === GAME_WORLD_SESSION_MODE.CPU_NO_WAVE_FALLBACK) {
            this.tower?.updateRenderPosition(alpha);
        }
        this.enemyPresentationFrame.frameDelta = this.enemySimulationPaused ? 0 : frameDelta;
        this.enemyPresentationFrame.fixedDelta = fixedDelta;
        this.enemyPresentationFrame.fixedAlpha = alpha;
        this.enemySimulationEndpoint.updatePresentation(this.enemyPresentationFrame);
        if (this.sessionMode === GAME_WORLD_SESSION_MODE.GPU_WORLD
            && this.towerHandle) {
            const endpointStatus = this.enemySimulationEndpoint.getStatus();
            const gpuStatus = endpointStatus.backend?.gpu ?? endpointStatus.backend ?? {};
            const observedPose = this.enemySimulationPaused
                || this.enemySimulationRecoveryRequired
                ? GPU_WORLD_PAUSED_OBSERVATION
                : this.enemySimulationEndpoint.getObservedTrackedPose();
            this.tower.updateObservedPose(
                observedPose,
                {
                    currentFixedTick: this.lastCompletedEnemyFixedTick,
                    fixedAlpha: alpha,
                    fixedDelta,
                    sessionGeneration: endpointStatus.sessionGeneration,
                    deviceGeneration: gpuStatus.deviceGeneration,
                    authoritativeEpoch: gpuStatus.authoritativeEpoch
                }
            );
        }
    }

    draw() {
        if (!this.tileMap) {
            return;
        }
        this.tileMapRenderer.draw(this.tileMap, this.camera);
        this.drawEnemySimulation();
        this.coreRenderer.draw(this.core, this.camera);
        if (this.sessionMode === GAME_WORLD_SESSION_MODE.CPU_NO_WAVE_FALLBACK) {
            this.towerRenderer.draw(this.tower, this.camera);
        }
    }

    drawEnemySimulation() {
        if (!this.tileMap || this.destroyed) {
            return false;
        }
        const submitted = this.enemySimulationEndpoint.draw(this.camera);
        const gpuState = this.enemySimulationEndpoint.getRuntimeState();
        const gpuRequired = this.enemyWaveEnabled
            || this.gameplayWorldActorsEnabled
            || this.enemySimulationEndpoint.getPendingCommandCount() > 0
            || this.enemySimulationEndpoint.hasActiveBodies();
        this.enemySimulationRecoveryRequired = this.runOutcome.isDefeated()
            ? false
            : (gpuRequired
                && this.enemySimulationEndpoint.requiresRecovery()
                && gpuState !== 'gpu-backpressure')
                || this.hostileAttackDirector?.requiresRecovery() === true
                || this.enemyCoreImpactDirector?.requiresRecovery() === true;
        return submitted;
    }

    resize(viewport) {
        syncWorldViewport(this.viewport, viewport);
        this.camera.resize(this.viewport);
    }

    /** Core/input/domain identity를 보존하고 restartable GPU world만 교체합니다. */
    restartGpuWorldAtSafeWaveBoundary() {
        if (this.destroyed
            || !this.initialized
            || this.runOutcome.isDefeated()
            || this.sessionMode !== GAME_WORLD_SESSION_MODE.GPU_WORLD) {
            return false;
        }
        const hasFactory = typeof this.endpointDependencies.enemySimulationBackendFactory
            === 'function';
        if (!hasFactory && this.endpointDependencies.enemySimulationBackend) {
            return false;
        }

        let replacementEndpoint = null;
        let replacementCoreImpactCleanupBinding = null;
        let replacementWaveDirector = null;
        let replacementHostileAttackDirector = null;
        let replacementEnemyCoreImpactDirector = null;
        try {
            const replacement = this.#createGpuEndpoint(false);
            replacementEndpoint = replacement.endpoint;
            replacementCoreImpactCleanupBinding
                = replacement.coreImpactCleanupBinding;
            replacementWaveDirector = this.enemyWaveEnabled
                ? new WaveDirector({
                    waveDefinition: this.waveDefinition,
                    fixedTickOffset: this.lastCompletedEnemyFixedTick
                })
                : null;
            replacementEndpoint.init(this.tileMap);
            const replacementState = replacementEndpoint.getRuntimeState();
            if (!REPLACEMENT_GPU_ENDPOINT_INITIALIZED_STATES.has(
                replacementState
            ) || replacementEndpoint.requiresRecovery()) {
                throw new Error(
                    `replacement GPU endpoint 초기화가 완료되지 않았습니다: ${replacementState}`
                );
            }
            if (replacementWaveDirector
                && replacementWaveDirector.init(this.tileMap) !== true) {
                throw new Error('replacement WaveDirector 초기화가 완료되지 않았습니다.');
            }
            replacementHostileAttackDirector = this.hostileAttackDirector
                ? this.#createHostileAttackDirector(replacementEndpoint)
                : null;
            replacementEnemyCoreImpactDirector = this.enemyCoreImpactDirector
                ? this.#createEnemyCoreImpactDirector(
                    replacementEndpoint,
                    replacementCoreImpactCleanupBinding.port
                )
                : null;
        } catch {
            try {
                replacementEnemyCoreImpactDirector?.destroy();
            } catch {
                // 실패한 replacement 정리가 old GPU world 보존 경계를 깨지 않게 합니다.
            }
            try {
                replacementHostileAttackDirector?.destroy();
            } catch {
                // 실패한 replacement 정리가 old GPU world 보존 경계를 깨지 않게 합니다.
            }
            try {
                replacementWaveDirector?.destroy();
            } catch {
                // 실패한 replacement 정리가 old GPU world 보존 경계를 깨지 않게 합니다.
            }
            try {
                replacementCoreImpactCleanupBinding?.revoke();
            } catch {
                // 실패한 replacement capability만 폐기하고 old binding은 보존합니다.
            }
            try {
                replacementEndpoint?.destroy();
            } catch {
                // 실패한 replacement 정리가 recovery caller까지 전파되지 않게 합니다.
            }
            return false;
        }
        this.enemySimulationEndpoint.synchronizePresentation();
        this.enemyCoreImpactDirector?.destroy();
        this.hostileAttackDirector?.destroy();
        this.waveDirector?.destroy();
        this.primaryProjectileController?.resetGpuBinding();
        this.#revokeCoreImpactCleanupBinding();
        this.enemySimulationEndpoint.destroy();
        this.tower.resetGpuBinding();
        this.towerCombatRoster?.releaseGpuBinding();
        this.#installGpuEndpoint(Object.freeze({
            endpoint: replacementEndpoint,
            coreImpactCleanupBinding: replacementCoreImpactCleanupBinding
        }));
        if (this.#isPrimaryTowerAlive()) {
            this.primaryProjectileController?.bindGpuEndpoint(replacementEndpoint);
        }
        this.hostileAttackDirector = replacementHostileAttackDirector;
        this.enemyCoreImpactDirector = replacementEnemyCoreImpactDirector;
        this.waveDirector = replacementWaveDirector;
        this.pendingEnemyFixedTick = 0;
        this.enemySimulationRecoveryRequired = false;
        this.enemySimulationPaused = true;
        this.lastCompletedGpuEvents = createEmptyGpuEventSnapshot(
            this.lastCompletedEnemyFixedTick
        );
        this.lastTowerCombatFacts = this.towerCombatRoster
            ?.getLastCommittedFacts?.() ?? EMPTY_TOWER_COMBAT_FACTS;
        this.lastCoreImpactFacts = EMPTY_CORE_IMPACT_FACTS;
        this.#armGpuWorldActors(this.lastCompletedEnemyFixedTick);
        return true;
    }

    restartEnemyGpuWorldAtSafeWaveBoundary() {
        return this.restartGpuWorldAtSafeWaveBoundary();
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.playerControllables.length = 0;
        this.collidables.length = 0;
        this.physicsBodies.length = 0;
        this.towerController?.destroy();
        this.towerController = null;
        this.primaryProjectileController?.destroy();
        this.primaryProjectileController = null;
        this.hostileAttackDirector?.destroy();
        this.hostileAttackDirector = null;
        this.waveDirector?.destroy();
        this.waveDirector = null;
        this.towerCombatRoster?.releaseGpuBinding();
        this.enemySimulationEndpoint.destroy();
        this.lastCompletedEnemyFixedTick = 0;
        this.pendingEnemyFixedTick = 0;
        this.enemySimulationRecoveryRequired = false;
        this.enemySimulationPaused = false;
        this.enemyCoreImpactDirector?.destroy();
        this.enemyCoreImpactDirector = null;
        this.#revokeCoreImpactCleanupBinding();
        this.lastCoreImpactFacts = EMPTY_CORE_IMPACT_FACTS;
        this.terminalDiagnostic = null;
        this.terminalState = GPU_WORLD_TERMINAL_STATE.SEALED;
        if (this.runOutcomeOwned) {
            this.runOutcome.destroy();
        }
        if (this.cameraFollowTarget !== this.tower) {
            this.cameraFollowTarget?.destroy?.();
        }
        this.cameraFollowTarget = null;
        this.tower?.destroy();
        this.tower = null;
        this.core?.destroy();
        this.core = null;
        this.tileCollisionResolver = null;
        this.tileMap = null;
        this.injectedTileNavigationSource = null;
        this.towerRenderer?.destroy();
        this.towerRenderer = null;
        this.coreRenderer.destroy();
        this.tileMapRenderer.destroy();
        this.initialized = false;
        this.towerCombatRoster = null;
    }

    #transitionRunOutcomeForCore(fixedTick, coreDepletedFact) {
        if (!this.coreIntegrity.isDepleted()) {
            return false;
        }
        let fact = this.runOutcome.getRunFailedFact();
        if (this.runOutcome.isRunning()) {
            fact = this.runOutcome.transitionToDefeated({
                fixedTick,
                sourceType: coreDepletedFact?.type ?? 'CoreDepleted',
                sourceEventKey: coreDepletedFact?.eventKey ?? null,
                coreImpactKey: coreDepletedFact?.impactKey ?? null
            }).fact;
        }
        this.#beginTerminalFinalization(fixedTick, fact);
        return true;
    }

    #beginTerminalFinalization(fixedTick, runFailedFact) {
        if (this.terminalState === GPU_WORLD_TERMINAL_STATE.SEALED
            || this.terminalState === GPU_WORLD_TERMINAL_STATE.SEALED_FAILED) {
            return;
        }
        this.terminalState = GPU_WORLD_TERMINAL_STATE.FINAL_COMMIT_PENDING;
        this.terminalFinalizationTick = fixedTick;
        this.enemySimulationEndpoint.closeGameplayIngress?.(
            'run-defeated',
            fixedTick
        );
        // runFailedFact는 RunOutcome의 immutable single fact이며 상태 snapshot에서 보존됩니다.
        void runFailedFact;
    }

    #sealTerminalSuccess(fixedTick) {
        const terminalCancel = this.enemySimulationEndpoint
            .getTerminalFixedProgramCancelStatus?.() ?? null;
        const ownerEvidence = terminalCancel?.owner;
        const backendEvidence = terminalCancel?.backend;
        const cancellationSubmitted = ownerEvidence?.accepted === true
            && ownerEvidence.abiVersion
                === GPU_FIXED_PRIMITIVE_TERMINAL_CANCEL_ABI_VERSION
            && ownerEvidence.finalFixedTick === fixedTick
            && ownerEvidence.state === 'armed'
            && backendEvidence?.accepted === true
            && backendEvidence.abiVersion
                === GPU_FIXED_PRIMITIVE_TERMINAL_CANCEL_ABI_VERSION
            && backendEvidence.finalFixedTick === fixedTick
            && backendEvidence.state === 'submitted'
            && backendEvidence.submittedSourceTick === fixedTick
            && backendEvidence.destinationCount
                === ownerEvidence.destinationCount
            && backendEvidence.priorityControlCount
                === ownerEvidence.priorityControlCount
            && backendEvidence.pendingBodyCount === 0
            && backendEvidence.pendingSpawnProgramReadbacks === 0;
        if (!cancellationSubmitted) {
            return this.#sealTerminalFailure(
                'terminal-fixed-program-cancel',
                fixedTick,
                backendEvidence ?? ownerEvidence ?? terminalCancel
            );
        }
        this.enemySimulationEndpoint.finalizeClosedGameplayIngress?.();
        this.terminalState = GPU_WORLD_TERMINAL_STATE.SEALED;
        this.terminalFinalizationTick = fixedTick;
        this.terminalDiagnostic = null;
        this.enemySimulationRecoveryRequired = false;
        this.enemySimulationPaused = true;
        return true;
    }

    #sealTerminalFailure(stage, fixedTick, detail = null) {
        // completed-event protocol failure처럼 Core director observe 이전에 terminal
        // 경로로 들어오는 경우에도 Core depletion은 반드시 immutable RunFailed를
        // 한 번 남겨야 합니다.
        this.#transitionRunOutcomeForCore(fixedTick, null);
        this.#beginTerminalFinalization(
            fixedTick,
            this.runOutcome.getRunFailedFact()
        );
        this.enemySimulationEndpoint.finalizeClosedGameplayIngress?.();
        this.terminalState = GPU_WORLD_TERMINAL_STATE.SEALED_FAILED;
        this.terminalFinalizationTick = fixedTick;
        this.terminalDiagnostic = Object.freeze({
            stage,
            fixedTick,
            reason: typeof detail?.code === 'string'
                ? detail.code
                : typeof detail?.reason === 'string'
                    ? detail.reason
                    : typeof detail?.state === 'string'
                        ? detail.state
                        : 'terminal-finalization-failed'
        });
        this.pendingEnemyFixedTick = 0;
        this.enemySimulationRecoveryRequired = false;
        this.enemySimulationPaused = true;
        return false;
    }

    #createGpuEndpoint(allowInjectedBackend) {
        let coreImpactCleanupBinding = null;
        const dependencies = {
            webGpuPlatformPort: this.endpointDependencies.webGpuPlatformPort,
            enemySimulationBackendFactory:
                this.endpointDependencies.enemySimulationBackendFactory,
            coreImpactCleanupPortReceiver: (binding) => {
                if (coreImpactCleanupBinding !== null
                    || typeof binding?.port
                        ?.requestCommittedCoreImpactCleanup !== 'function'
                    || typeof binding?.revoke !== 'function') {
                    throw new TypeError(
                        'endpoint Core-impact cleanup binding 계약이 올바르지 않습니다.'
                    );
                }
                coreImpactCleanupBinding = binding;
            }
        };
        if (allowInjectedBackend
            && !dependencies.enemySimulationBackendFactory
            && this.endpointDependencies.enemySimulationBackend) {
            dependencies.enemySimulationBackend
                = this.endpointDependencies.enemySimulationBackend;
        }
        const endpoint = createGpuSimulationEndpoint(dependencies, {
            presentationProfile: this.enemyPresentationProfile
        });
        if (coreImpactCleanupBinding === null) {
            endpoint.destroy();
            throw new TypeError('endpoint가 Core-impact cleanup port를 제공하지 않았습니다.');
        }
        this.endpointSessionCount++;
        return Object.freeze({ endpoint, coreImpactCleanupBinding });
    }

    #installGpuEndpoint(bundle) {
        const endpoint = bundle.endpoint;
        this.enemySimulationEndpoint = endpoint;
        this.enemySimulationBackend = endpoint.getBackend();
        this.worldRegistry = endpoint.getRegistry();
        this.enemyLifecycleCommandOwner = endpoint.getLifecycleCommandOwner();
        this.#coreImpactCleanupBinding = bundle.coreImpactCleanupBinding;
    }

    #createHostileAttackDirector(endpoint) {
        const director = this.hostileAttackDirectorFactory({
            endpoint,
            registry: endpoint.getRegistry(),
            backend: endpoint.getBackend(),
            priorityTargetControlPort: endpoint
        });
        if (!director
            || typeof director.observeCompletedEvents !== 'function'
            || typeof director.stageForFixedTick !== 'function'
            || typeof director.observeFixedCommit !== 'function'
            || typeof director.requiresRecovery !== 'function'
            || typeof director.getStatus !== 'function'
            || typeof director.destroy !== 'function') {
            try {
                director?.destroy?.();
            } catch {
                // 잘못된 replacement contract 정리가 old world 원자성을 깨지 않게 합니다.
            }
            throw new TypeError('HostileAttackDirector contract가 올바르지 않습니다.');
        }
        return director;
    }

    #createEnemyCoreImpactDirector(
        endpoint,
        coreImpactCleanupPort = this.#coreImpactCleanupBinding?.port ?? null
    ) {
        const director = this.enemyCoreImpactDirectorFactory({
            endpoint,
            coreIntegrity: this.coreIntegrity,
            coreImpactCleanupPort
        });
        if (!director
            || typeof director.observeCompletedEvents !== 'function'
            || typeof director.stageForFixedTick !== 'function'
            || typeof director.observeFixedCommit !== 'function'
            || typeof director.requiresRecovery !== 'function'
            || typeof director.getStatus !== 'function'
            || typeof director.destroy !== 'function') {
            try {
                director?.destroy?.();
            } catch {
                // 잘못된 director contract가 old GPU world 원자성을 깨지 않게 합니다.
            }
            throw new TypeError('EnemyCoreImpactDirector contract가 올바르지 않습니다.');
        }
        return director;
    }

    #revokeCoreImpactCleanupBinding() {
        if (this.#coreImpactCleanupBinding !== null
            && this.#coreImpactCleanupBinding !== undefined) {
            this.#coreImpactCleanupBinding.revoke();
            this.#coreImpactCleanupBinding = null;
        }
    }

    #armGpuWorldActors(fixedTickOffset) {
        this.towerHandle = null;
        this.coreProxyHandle = null;
        this.trackedTowerConfigured = false;
        this.actorLifecycleQueued = false;
        this.towerSpawnCommandId = null;
        this.coreProxySpawnCommandId = null;
        if (!this.gameplayWorldActorsEnabled) {
            this.actorSpawnTargetFixedTick = 0;
            return;
        }
        this.actorSpawnTargetFixedTick = fixedTickOffset + 1;
        const sessionGeneration = this.enemySimulationEndpoint.getStatus().sessionGeneration;
        if (this.#isPrimaryTowerAlive()) {
            this.towerSpawnCommandId = [
                'gpu-world-tower-spawn',
                sessionGeneration,
                this.actorSpawnTargetFixedTick
            ].join(':');
        }
        this.coreProxySpawnCommandId = [
            'gpu-world-core-proxy-spawn',
            sessionGeneration,
            this.actorSpawnTargetFixedTick
        ].join(':');
    }

    #queueGpuWorldActorsForFixedTick(fixedTick) {
        if (!this.gameplayWorldActorsEnabled
            || this.actorLifecycleQueued
            || fixedTick !== this.actorSpawnTargetFixedTick) {
            return true;
        }
        const requests = [];
        if (this.#isPrimaryTowerAlive()) {
            requests.push({
                intent: createGpuTowerSpawnIntent({
                    position: this.tileMap.getTowerSpawnPosition(),
                    currentHp: this.towerCombatRoster
                        ?.getPrimaryTowerCurrentHp()
                }),
                targetFixedTick: fixedTick,
                commandId: this.towerSpawnCommandId
            });
        }
        requests.push({
            intent: createGpuCoreProxySpawnIntent({
                position: this.tileMap.getCorePosition()
            }),
            targetFixedTick: fixedTick,
            commandId: this.coreProxySpawnCommandId
        });
        const receipt = this.enemySimulationEndpoint.requestSpawnBatch(requests);
        if (!receipt?.accepted || receipt.queuedCount !== requests.length) {
            return false;
        }
        this.actorLifecycleQueued = true;
        return true;
    }

    #bindCommittedGpuWorldActors(lifecycleResult, fixedTick) {
        if (!this.gameplayWorldActorsEnabled
            || fixedTick !== this.actorSpawnTargetFixedTick) {
            return true;
        }
        const handleByCommandId = new Map(
            (lifecycleResult.spawned ?? []).map(({ commandId, handle }) => (
                [commandId, handle]
            ))
        );
        const towerAlive = this.#isPrimaryTowerAlive();
        const towerHandle = this.towerSpawnCommandId
            ? handleByCommandId.get(this.towerSpawnCommandId)
            : null;
        const coreProxyHandle = handleByCommandId.get(this.coreProxySpawnCommandId);
        const expectedTowerCount = towerAlive ? 1 : 0;
        if (!coreProxyHandle
            || (towerAlive && !towerHandle)
            || this.worldRegistry.getActiveCount(GPU_TOWER_WORLD_KIND_ID)
                !== expectedTowerCount
            || this.worldRegistry.getActiveCount(GPU_CORE_PROXY_WORLD_KIND_ID) !== 1) {
            return false;
        }
        if (!towerAlive) {
            this.coreProxyHandle = freezeHandle(coreProxyHandle);
            this.trackedTowerConfigured = false;
            return true;
        }

        const protocol = this.#readTowerBindingProtocol();
        if (this.towerCombatRoster && !protocol) {
            return false;
        }
        const tracking = this.enemySimulationEndpoint.configureTrackedBody(towerHandle);
        if (tracking?.accepted !== true) {
            return false;
        }
        try {
            const sessionGeneration = this.enemySimulationEndpoint
                .getStatus().sessionGeneration;
            const boundTowerHandle = this.tower.bindGpuBody(
                towerHandle,
                sessionGeneration
            );
            this.towerCombatRoster?.bindGpuBody(boundTowerHandle, protocol);
            this.towerHandle = boundTowerHandle;
            this.coreProxyHandle = freezeHandle(coreProxyHandle);
            this.trackedTowerConfigured = true;
            return true;
        } catch {
            this.tower.resetGpuBinding();
            this.towerCombatRoster?.releaseGpuBinding();
            this.enemySimulationEndpoint.configureTrackedBody(null);
            this.towerHandle = null;
            this.coreProxyHandle = null;
            this.trackedTowerConfigured = false;
            return false;
        }
    }

    #isPrimaryTowerAlive() {
        return this.towerCombatRoster?.isPrimaryTowerAlive() ?? true;
    }

    #cutoverCommittedTowerDeath() {
        this.enemySimulationEndpoint.configureTrackedBody(null);
        this.trackedTowerConfigured = false;
        this.towerHandle = null;
        this.tower.deactivateForDeath();
        this.primaryProjectileController?.deactivateForTowerDeath();
    }

    #readTowerBindingProtocol() {
        const endpointStatus = this.enemySimulationEndpoint.getStatus();
        let source = null;
        try {
            source = this.enemySimulationBackend.getEventProtocolState?.() ?? null;
        } catch {
            return null;
        }
        const gpuStatus = endpointStatus.backend?.gpu
            ?? endpointStatus.backend
            ?? {};
        const sessionGeneration = Number(
            source?.sessionGeneration ?? endpointStatus.sessionGeneration
        );
        const deviceGeneration = Number(
            source?.deviceGeneration ?? gpuStatus.deviceGeneration ?? 0
        );
        const authoritativeEpoch = Number(
            source?.authoritativeEpoch ?? gpuStatus.authoritativeEpoch ?? 0
        );
        if (!Number.isSafeInteger(sessionGeneration)
            || sessionGeneration !== endpointStatus.sessionGeneration
            || !Number.isSafeInteger(deviceGeneration)
            || deviceGeneration < 0
            || !Number.isSafeInteger(authoritativeEpoch)
            || authoritativeEpoch < 0) {
            return null;
        }
        return Object.freeze({
            sessionGeneration,
            deviceGeneration,
            authoritativeEpoch
        });
    }

    #pauseForGpuRecovery() {
        this.enemySimulationRecoveryRequired = true;
        if (!this.enemySimulationPaused) {
            this.enemySimulationEndpoint.synchronizePresentation();
        }
        this.enemySimulationPaused = true;
        return false;
    }
}
