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
import {
    PentagonEffectDirector
} from './enemy/pentagon_effect_director.js';
import {
    FormationRuntimeDirector
} from './enemy/formation_runtime_director.js';
import {
    JorangSplitLineageDirector
} from './enemy/jorang_split_lineage_director.js';
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
import {
    GPU_EFFECT_TERMINAL_CANCEL_ABI_VERSION
} from '../physics/gpu/gpu_effect_runtime_abi.js';
import {
    GPU_FORMATION_TERMINAL_CANCEL_ABI_VERSION
} from '../physics/gpu/gpu_formation_runtime_abi.js';
import {
    GPU_ATOMIC_TRANSFORM_TERMINAL_CANCEL_ABI_VERSION
} from '../physics/gpu/gpu_atomic_transform_runtime_abi.js';

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
        this.pentagonEffectDirectorFactory
            = dependencies?.pentagonEffectDirectorFactory
                ?? ((directorOptions) => new PentagonEffectDirector(directorOptions));
        if (typeof this.pentagonEffectDirectorFactory !== 'function') {
            throw new TypeError('pentagonEffectDirectorFactory는 함수여야 합니다.');
        }
        this.formationRuntimeDirectorFactory
            = dependencies?.formationRuntimeDirectorFactory
                ?? ((directorOptions) => new FormationRuntimeDirector(
                    directorOptions
                ));
        if (typeof this.formationRuntimeDirectorFactory !== 'function') {
            throw new TypeError('formationRuntimeDirectorFactory는 함수여야 합니다.');
        }
        this.jorangSplitLineageDirectorFactory
            = dependencies?.jorangSplitLineageDirectorFactory
                ?? ((directorOptions) => new JorangSplitLineageDirector(
                    directorOptions
                ));
        if (typeof this.jorangSplitLineageDirectorFactory !== 'function') {
            throw new TypeError(
                'jorangSplitLineageDirectorFactory는 함수여야 합니다.'
            );
        }
        this.endpointSessionCount = 0;
        this.enemySimulationEndpoint = null;
        this.enemySimulationBackend = null;
        this.worldRegistry = null;
        this.enemyLifecycleCommandOwner = null;
        this.#installGpuEndpoint(this.#createGpuEndpoint(true));
        this.hostileAttackDirector = null;
        this.enemyCoreImpactDirector = null;
        this.pentagonEffectDirector = null;
        this.formationRuntimeDirector = null;
        this.jorangSplitLineageDirector = null;
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
                this.pentagonEffectDirector = this.#createPentagonEffectDirector(
                    this.enemySimulationEndpoint
                );
                this.formationRuntimeDirector
                    = this.#createFormationRuntimeDirector(
                        this.enemySimulationEndpoint
                    );
                this.jorangSplitLineageDirector
                    = this.#createJorangSplitLineageDirector(
                        this.enemySimulationEndpoint
                    );
            } catch (error) {
                try {
                    this.jorangSplitLineageDirector?.destroy();
                } catch {
                    // 최초 J lineage director 생성 실패의 원래 오류를 보존합니다.
                }
                try {
                    this.formationRuntimeDirector?.destroy();
                } catch {
                    // 최초 Formation director 생성 실패의 원래 오류를 보존합니다.
                }
                try {
                    this.pentagonEffectDirector?.destroy();
                } catch {
                    // 최초 Effect director 생성 실패의 원래 오류를 보존합니다.
                }
                try {
                    this.enemyCoreImpactDirector?.destroy();
                } catch {
                    // 최초 Core director 생성 실패가 endpoint 정리를 가리지 않게 합니다.
                }
                try {
                    this.hostileAttackDirector?.destroy();
                } catch {
                    // 최초 hostile director 생성 실패가 endpoint 정리를 가리지 않게 합니다.
                }
                try {
                    this.enemySimulationEndpoint?.destroy();
                } catch {
                    // 최초 Director 생성 실패의 원래 오류를 보존합니다.
                }
                this.#revokeCoreImpactCleanupBinding();
                this.hostileAttackDirector = null;
                this.enemyCoreImpactDirector = null;
                this.pentagonEffectDirector = null;
                this.formationRuntimeDirector = null;
                this.jorangSplitLineageDirector = null;
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
        this.towerGameplayTargetConfigured = false;
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

    /** 독립 Pentagon Effect roster/cadence의 bounded scalar 상태입니다. */
    getPentagonEffectStatus() {
        return this.pentagonEffectDirector?.getStatus() ?? null;
    }

    /** 독립 H/HX Formation roster/atomic transform의 bounded 상태입니다. */
    getFormationRuntimeStatus() {
        return this.formationRuntimeDirector?.getStatus() ?? null;
    }

    /** J/C′ lineage-global pending/backoff/atomic transform 상태입니다. */
    getJorangSplitLineageStatus() {
        return this.jorangSplitLineageDirector?.getStatus() ?? null;
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
            towerGameplayTargetConfigured:
                this.towerGameplayTargetConfigured,
            trackedTowerConfigured: this.trackedTowerConfigured,
            towerAlive: this.#isPrimaryTowerAlive(),
            towerCurrentHp: this.towerCombatRoster
                ?.getPrimaryTowerCurrentHp() ?? null,
            lastTowerCombatFacts: this.lastTowerCombatFacts,
            lastCoreImpactFacts: this.lastCoreImpactFacts,
            pentagonEffect: this.getPentagonEffectStatus(),
            formation: this.getFormationRuntimeStatus(),
            jorangSplitLineage: this.getJorangSplitLineageStatus(),
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
            || this.enemyCoreImpactDirector?.requiresRecovery() === true
            || this.pentagonEffectDirector?.requiresRecovery() === true
            || this.formationRuntimeDirector?.requiresRecovery() === true
            || this.jorangSplitLineageDirector?.requiresRecovery() === true;
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
                || this.enemyCoreImpactDirector?.requiresRecovery() === true
                || this.pentagonEffectDirector?.requiresRecovery() === true
                || this.formationRuntimeDirector?.requiresRecovery() === true
                || this.jorangSplitLineageDirector?.requiresRecovery() === true)) {
            return this.#pauseForGpuRecovery();
        }

        if (this.pendingEnemyFixedTick === 0) {
            // T-1 prepare가 제출됐지만 비동기 GPU readback이 아직 끝나지 않은
            // 경우는 recovery가 아닙니다. 다른 completion domain의 watermark나
            // lifecycle/stage/fixed state를 건드리기 전에 exact T 경계를 그대로
            // 보존하고 다음 frame에서 같은 proposedFixedTick을 재시도합니다.
            const completedAtomicTransformPrograms
                = this.enemySimulationEndpoint
                    .commitCompletedAtomicTransformProgramsAtFixedBoundary(
                        proposedFixedTick
                    );
            if (completedAtomicTransformPrograms.pending === true) {
                return false;
            }
            if (completedAtomicTransformPrograms.protocolFailure) {
                if (this.runOutcome.isDefeated()
                    || this.coreIntegrity.isDepleted()) {
                    return this.#sealTerminalFailure(
                        'atomic-transform-completion-protocol',
                        proposedFixedTick,
                        completedAtomicTransformPrograms.protocolFailure
                    );
                }
                return this.#pauseForGpuRecovery();
            }
            this.jorangSplitLineageDirector?.observeCompletedPreparations(
                completedAtomicTransformPrograms
            );
            if (this.jorangSplitLineageDirector?.requiresRecovery() === true) {
                if (this.runOutcome.isDefeated()
                    || this.coreIntegrity.isDepleted()) {
                    return this.#sealTerminalFailure(
                        'atomic-transform-completion-observe',
                        proposedFixedTick,
                        this.jorangSplitLineageDirector.getStatus().failure
                    );
                }
                return this.#pauseForGpuRecovery();
            }
            const completedEffectPrograms = this.enemySimulationEndpoint
                .commitCompletedEffectProgramsAtFixedBoundary(proposedFixedTick);
            if (completedEffectPrograms.protocolFailure) {
                if (this.runOutcome.isDefeated() || this.coreIntegrity.isDepleted()) {
                    return this.#sealTerminalFailure(
                        'effect-completion-protocol',
                        proposedFixedTick,
                        completedEffectPrograms.protocolFailure
                    );
                }
                return this.#pauseForGpuRecovery();
            }
            this.pentagonEffectDirector?.observeCompletedEvents(
                completedEffectPrograms
            );
            if (this.pentagonEffectDirector?.requiresRecovery() === true) {
                if (this.runOutcome.isDefeated() || this.coreIntegrity.isDepleted()) {
                    return this.#sealTerminalFailure(
                        'effect-completion-observe',
                        proposedFixedTick,
                        this.pentagonEffectDirector.getStatus().failure
                    );
                }
                return this.#pauseForGpuRecovery();
            }
            const completedFormationPrograms = this.enemySimulationEndpoint
                .commitCompletedFormationProgramsAtFixedBoundary(
                    proposedFixedTick
                );
            if (completedFormationPrograms.protocolFailure) {
                if (this.runOutcome.isDefeated() || this.coreIntegrity.isDepleted()) {
                    return this.#sealTerminalFailure(
                        'formation-completion-protocol',
                        proposedFixedTick,
                        completedFormationPrograms.protocolFailure
                    );
                }
                return this.#pauseForGpuRecovery();
            }
            this.formationRuntimeDirector?.observeCompletedPreparations(
                completedFormationPrograms
            );
            if (this.formationRuntimeDirector?.requiresRecovery() === true) {
                if (this.runOutcome.isDefeated() || this.coreIntegrity.isDepleted()) {
                    return this.#sealTerminalFailure(
                        'formation-completion-observe',
                        proposedFixedTick,
                        this.formationRuntimeDirector.getStatus().failure
                    );
                }
                return this.#pauseForGpuRecovery();
            }
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
            this.jorangSplitLineageDirector?.observeCompletedEvents(
                completedEvents
            );
            if (this.jorangSplitLineageDirector?.requiresRecovery() === true) {
                if (this.runOutcome.isDefeated()
                    || this.coreIntegrity.isDepleted()) {
                    return this.#sealTerminalFailure(
                        'atomic-transform-trigger-observe',
                        proposedFixedTick,
                        this.jorangSplitLineageDirector.getStatus().failure
                    );
                }
                return this.#pauseForGpuRecovery();
            }
            let towerGameplayTargetClearFailure = null;
            this.lastTowerCombatFacts = this.towerCombatRoster
                ?.commitCompletedEvents(completedEvents, this.worldRegistry)
                ?? EMPTY_TOWER_COMBAT_FACTS;
            const towerDeathCutoverPending = !this.#isPrimaryTowerAlive()
                && Boolean(this.towerHandle);
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
            // 같은 authentic completed snapshot의 Effect/Core/Hostile consumers가
            // 모두 관찰한 뒤에만 Tower gameplay binding을 끊습니다. clear failure가
            // 앞 consumer의 watermark를 영구 유실시키면 안 됩니다.
            if (towerDeathCutoverPending
                && !this.#cutoverCommittedTowerDeath()) {
                towerGameplayTargetClearFailure = this
                    .enemySimulationEndpoint.getStatus()
                    .towerGameplayTargetDiagnostic
                    ?? Object.freeze({
                        reason: 'tower-gameplay-target-clear-failed'
                    });
            }
            const terminalReady = this.#transitionRunOutcomeForCore(
                proposedFixedTick,
                coreCompletedObservation?.coreDepletedFact ?? null
            );
            if (this.runOutcome.isDefeated() && terminalReady !== true) {
                return false;
            }
            if (towerGameplayTargetClearFailure) {
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
                const effectStage = this.pentagonEffectDirector
                    ?.stageForFixedTick({
                        targetFixedTick: proposedFixedTick
                    }) ?? null;
                const retryableEffectBackoff = effectStage?.accepted === false
                    && effectStage.recoveryRequired === false
                    && [
                        'effect-command-capacity',
                        'effect-command-history-capacity'
                    ].includes(effectStage.reason);
                if (effectStage?.recoveryRequired === true
                    || (effectStage?.accepted === false
                        && !retryableEffectBackoff)) {
                    return this.#pauseForGpuRecovery();
                }
                const formationStage = this.formationRuntimeDirector
                    ?.stageForFixedTick({
                        targetFixedTick: proposedFixedTick
                    }) ?? null;
                if (formationStage?.recoveryRequired === true
                    || formationStage?.accepted === false) {
                    return this.#pauseForGpuRecovery();
                }
                const atomicTransformStage = this.jorangSplitLineageDirector
                    ?.stageForFixedTick({
                        targetFixedTick: proposedFixedTick
                    }) ?? null;
                if (atomicTransformStage?.recoveryRequired === true
                    || atomicTransformStage?.accepted === false) {
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
                    const effectTerminalCancel = this.enemySimulationEndpoint
                        .getTerminalEffectProgramCancelStatus?.() ?? null;
                    const formationTerminalCancel = this.enemySimulationEndpoint
                        .getTerminalFormationProgramCancelStatus?.() ?? null;
                    const atomicTransformTerminalCancel
                        = this.enemySimulationEndpoint
                            .getTerminalAtomicTransformProgramCancelStatus?.()
                            ?? null;
                    return this.#sealTerminalFailure(
                        atomicTransformTerminalCancel?.owner?.state === 'failed'
                            ? 'terminal-atomic-transform-program-cancel'
                            : formationTerminalCancel?.owner?.state === 'failed'
                            ? 'terminal-formation-program-cancel'
                            : effectTerminalCancel?.owner?.state === 'failed'
                            ? 'terminal-effect-program-cancel'
                            : terminalCancel?.owner
                            && terminalCancel.owner.accepted !== true
                            ? 'terminal-fixed-program-cancel'
                            : 'terminal-lifecycle-commit',
                        proposedFixedTick,
                        atomicTransformTerminalCancel?.owner?.state === 'failed'
                            ? atomicTransformTerminalCancel.owner
                            : formationTerminalCancel?.owner?.state === 'failed'
                            ? formationTerminalCancel.owner
                            : effectTerminalCancel?.owner?.state === 'failed'
                            ? effectTerminalCancel.owner
                            : terminalCancel?.owner?.accepted === false
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
            this.pentagonEffectDirector?.observeFixedCommit(
                lifecycleResult,
                proposedFixedTick
            );
            if (this.pentagonEffectDirector?.requiresRecovery() === true) {
                if (this.runOutcome.isDefeated()) {
                    return this.#sealTerminalFailure(
                        'effect-fixed-commit',
                        proposedFixedTick,
                        this.pentagonEffectDirector.getStatus().failure
                    );
                }
                return this.#pauseForGpuRecovery();
            }
            this.pentagonEffectDirector?.observeLifecycle(
                lifecycleResult,
                proposedFixedTick
            );
            if (this.pentagonEffectDirector?.requiresRecovery() === true) {
                if (this.runOutcome.isDefeated()) {
                    return this.#sealTerminalFailure(
                        'effect-lifecycle-observe',
                        proposedFixedTick,
                        this.pentagonEffectDirector.getStatus().failure
                    );
                }
                return this.#pauseForGpuRecovery();
            }
            this.formationRuntimeDirector?.observeFixedCommit(
                lifecycleResult,
                proposedFixedTick
            );
            this.formationRuntimeDirector?.observeLifecycle(
                lifecycleResult,
                proposedFixedTick
            );
            if (this.formationRuntimeDirector?.requiresRecovery() === true) {
                if (this.runOutcome.isDefeated()) {
                    return this.#sealTerminalFailure(
                        'formation-lifecycle-observe',
                        proposedFixedTick,
                        this.formationRuntimeDirector.getStatus().failure
                    );
                }
                return this.#pauseForGpuRecovery();
            }
            this.jorangSplitLineageDirector?.observeFixedCommit(
                lifecycleResult,
                proposedFixedTick
            );
            this.jorangSplitLineageDirector?.observeLifecycle(
                lifecycleResult,
                proposedFixedTick
            );
            if (this.jorangSplitLineageDirector?.requiresRecovery() === true) {
                if (this.runOutcome.isDefeated()) {
                    return this.#sealTerminalFailure(
                        'atomic-transform-lifecycle-observe',
                        proposedFixedTick,
                        this.jorangSplitLineageDirector.getStatus().failure
                    );
                }
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

        const terminalFinalization = this.runOutcome.isDefeated();
        if (terminalFinalization
            && this.pendingEnemyFixedTick === proposedFixedTick) {
            const atomicTerminal = this.enemySimulationEndpoint
                .getTerminalAtomicTransformProgramCancelStatus?.() ?? null;
            const atomicBackend = atomicTerminal?.backend;
            if (atomicBackend?.state === 'failed') {
                return this.#sealTerminalFailure(
                    'terminal-atomic-transform-readback',
                    proposedFixedTick,
                    atomicBackend.failure ?? atomicBackend
                );
            }
            if (atomicBackend?.state === 'submitted') {
                const atomicSettlementPending
                    = atomicBackend.pendingPrepareCount > 0
                    || atomicBackend.pendingTransformCount > 0
                    || atomicBackend.pendingReadbackCount > 0;
                if (atomicSettlementPending) {
                    return false;
                }
                // final submit은 이미 끝났습니다. 같은 T를 GPU에 다시 제출하지
                // 않고 async transform readback이 만든 terminal evidence만 재평가합니다.
                this.enemySimulationPaused = false;
                this.enemySimulationRecoveryRequired = false;
                this.lastCompletedEnemyFixedTick = proposedFixedTick;
                this.pendingEnemyFixedTick = 0;
                return this.#sealTerminalSuccess(proposedFixedTick);
            }
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

        if (terminalFinalization) {
            const atomicTerminal = this.enemySimulationEndpoint
                .getTerminalAtomicTransformProgramCancelStatus?.() ?? null;
            const atomicBackend = atomicTerminal?.backend;
            if (atomicBackend?.state === 'failed') {
                return this.#sealTerminalFailure(
                    'terminal-atomic-transform-readback',
                    proposedFixedTick,
                    atomicBackend.failure ?? atomicBackend
                );
            }
            if (atomicBackend?.state === 'submitted'
                && (atomicBackend.pendingPrepareCount > 0
                    || atomicBackend.pendingTransformCount > 0
                    || atomicBackend.pendingReadbackCount > 0)) {
                // Registry/host publication과 final GPU program submit은 이미
                // 끝났지만 authentic transform readback이 남았습니다. T를 pending
                // 상태로 보존해 다음 호출이 submit 없이 evidence만 재평가합니다.
                return false;
            }
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
                || this.enemyCoreImpactDirector?.requiresRecovery() === true
                || this.pentagonEffectDirector?.requiresRecovery() === true
                || this.formationRuntimeDirector?.requiresRecovery() === true
                || this.jorangSplitLineageDirector?.requiresRecovery() === true;
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
        let replacementPentagonEffectDirector = null;
        let replacementFormationRuntimeDirector = null;
        let replacementJorangSplitLineageDirector = null;
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
            replacementPentagonEffectDirector = this.pentagonEffectDirector
                ? this.#createPentagonEffectDirector(replacementEndpoint)
                : null;
            replacementFormationRuntimeDirector = this.formationRuntimeDirector
                ? this.#createFormationRuntimeDirector(replacementEndpoint)
                : null;
            replacementJorangSplitLineageDirector
                = this.jorangSplitLineageDirector
                ? this.#createJorangSplitLineageDirector(replacementEndpoint)
                : null;
        } catch {
            try {
                replacementJorangSplitLineageDirector?.destroy();
            } catch {
                // 실패한 replacement J lineage state만 폐기합니다.
            }
            try {
                replacementFormationRuntimeDirector?.destroy();
            } catch {
                // 실패한 replacement Formation state는 old world와 독립 폐기합니다.
            }
            try {
                replacementPentagonEffectDirector?.destroy();
            } catch {
                // 실패한 replacement Effect state는 old world와 독립적으로 폐기합니다.
            }
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
        this.jorangSplitLineageDirector?.destroy();
        this.formationRuntimeDirector?.destroy();
        this.pentagonEffectDirector?.destroy();
        this.enemyCoreImpactDirector?.destroy();
        this.hostileAttackDirector?.destroy();
        this.waveDirector?.destroy();
        this.primaryProjectileController?.resetGpuBinding();
        this.#revokeCoreImpactCleanupBinding();
        this.enemySimulationEndpoint.configureTowerGameplayTarget?.(null);
        this.enemySimulationEndpoint.configureTrackedBody?.(null);
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
        this.pentagonEffectDirector = replacementPentagonEffectDirector;
        this.formationRuntimeDirector = replacementFormationRuntimeDirector;
        this.jorangSplitLineageDirector
            = replacementJorangSplitLineageDirector;
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
        this.pentagonEffectDirector?.destroy();
        this.pentagonEffectDirector = null;
        this.formationRuntimeDirector?.destroy();
        this.formationRuntimeDirector = null;
        this.jorangSplitLineageDirector?.destroy();
        this.jorangSplitLineageDirector = null;
        this.enemyCoreImpactDirector?.destroy();
        this.enemyCoreImpactDirector = null;
        this.#revokeCoreImpactCleanupBinding();
        this.waveDirector?.destroy();
        this.waveDirector = null;
        this.towerCombatRoster?.releaseGpuBinding();
        this.enemySimulationEndpoint.configureTowerGameplayTarget?.(null);
        this.enemySimulationEndpoint.configureTrackedBody?.(null);
        this.towerGameplayTargetConfigured = false;
        this.trackedTowerConfigured = false;
        this.towerHandle = null;
        this.coreProxyHandle = null;
        this.enemySimulationEndpoint.destroy();
        this.lastCompletedEnemyFixedTick = 0;
        this.pendingEnemyFixedTick = 0;
        this.enemySimulationRecoveryRequired = false;
        this.enemySimulationPaused = false;
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
        return this.#beginTerminalFinalization(fixedTick, fact);
    }

    #beginTerminalFinalization(fixedTick, runFailedFact) {
        if (this.terminalState === GPU_WORLD_TERMINAL_STATE.SEALED) {
            return true;
        }
        if (this.terminalState === GPU_WORLD_TERMINAL_STATE.SEALED_FAILED) {
            return false;
        }
        if (this.terminalState === GPU_WORLD_TERMINAL_STATE.FINAL_COMMIT_PENDING) {
            return true;
        }
        this.terminalState = GPU_WORLD_TERMINAL_STATE.FINAL_COMMIT_PENDING;
        this.terminalFinalizationTick = fixedTick;
        this.pentagonEffectDirector?.closeForTerminal(
            fixedTick,
            'run-defeated'
        );
        this.formationRuntimeDirector?.closeForTerminal(
            fixedTick,
            'run-defeated'
        );
        this.jorangSplitLineageDirector?.closeForTerminal(
            fixedTick,
            'run-defeated'
        );
        this.enemySimulationEndpoint.closeGameplayIngress?.(
            'run-defeated',
            fixedTick
        );
        const gameplayTargetClear = this.enemySimulationEndpoint
            .configureTowerGameplayTarget?.(null) ?? Object.freeze({
                accepted: false,
                reason: 'tower-gameplay-target-clear-unsupported'
            });
        // tracked pose config/latest snapshot은 presentation-only이며 terminal 이후
        // update/readback이 없으므로 마지막 camera/presentation snapshot으로 freeze합니다.
        this.towerGameplayTargetConfigured = false;
        if (gameplayTargetClear.accepted !== true) {
            this.enemySimulationEndpoint.finalizeClosedGameplayIngress?.();
            this.terminalState = GPU_WORLD_TERMINAL_STATE.SEALED_FAILED;
            this.terminalDiagnostic = Object.freeze({
                stage: 'terminal-tower-gameplay-target-clear',
                fixedTick,
                reason: gameplayTargetClear.reason
                    ?? 'tower-gameplay-target-clear-failed'
            });
            this.pendingEnemyFixedTick = 0;
            this.enemySimulationRecoveryRequired = false;
            this.enemySimulationPaused = true;
            return false;
        }
        // runFailedFact는 RunOutcome의 immutable single fact이며 상태 snapshot에서 보존됩니다.
        void runFailedFact;
        return true;
    }

    #sealTerminalSuccess(fixedTick) {
        const terminalCancel = this.enemySimulationEndpoint
            .getTerminalFixedProgramCancelStatus?.() ?? null;
        const ownerEvidence = terminalCancel?.owner;
        const backendEvidence = terminalCancel?.backend;
        const effectTerminalCancel = this.enemySimulationEndpoint
            .getTerminalEffectProgramCancelStatus?.() ?? null;
        const effectOwnerEvidence = effectTerminalCancel?.owner;
        const effectBackendEvidence = effectTerminalCancel?.backend;
        const effectRosterEvidence = this.pentagonEffectDirector?.getStatus() ?? null;
        const formationTerminalCancel = this.enemySimulationEndpoint
            .getTerminalFormationProgramCancelStatus?.() ?? null;
        const formationOwnerEvidence = formationTerminalCancel?.owner;
        const formationBackendEvidence = formationTerminalCancel?.backend;
        const formationRosterEvidence
            = this.formationRuntimeDirector?.getStatus() ?? null;
        const atomicTransformTerminalCancel = this.enemySimulationEndpoint
            .getTerminalAtomicTransformProgramCancelStatus?.() ?? null;
        const atomicTransformOwnerEvidence
            = atomicTransformTerminalCancel?.owner;
        const atomicTransformBackendEvidence
            = atomicTransformTerminalCancel?.backend;
        const atomicTransformRosterEvidence
            = this.jorangSplitLineageDirector?.getStatus() ?? null;
        const endpointStatus = this.enemySimulationEndpoint.getStatus();
        const gpuStatus = endpointStatus.backend?.gpu
            ?? endpointStatus.backend
            ?? {};
        const towerGameplayTargetEvidence = gpuStatus.fixedPrimitives
            ?.towerGameplayTarget ?? null;
        const towerGameplayTargetCleared
            = this.towerGameplayTargetConfigured === false
                && towerGameplayTargetEvidence?.configured === false;
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
        const effectCancellationSubmitted = effectOwnerEvidence?.abiVersion
                === GPU_EFFECT_TERMINAL_CANCEL_ABI_VERSION
            && effectOwnerEvidence.state === 'armed'
            && effectOwnerEvidence.finalFixedTick === fixedTick
            && effectOwnerEvidence.submittedTick === 0
            && effectOwnerEvidence.failure === null
            && effectBackendEvidence?.abiVersion
                === GPU_EFFECT_TERMINAL_CANCEL_ABI_VERSION
            && effectBackendEvidence.state === 'submitted'
            && effectBackendEvidence.finalFixedTick === fixedTick
            && effectBackendEvidence.submittedTick === fixedTick
            && effectBackendEvidence.pulseProgramCount
                === effectOwnerEvidence.pulseProgramCount
            && effectBackendEvidence.pendingPulseProgramCount === 0
            && effectBackendEvidence.pendingEffectReadbackCount === 0
            && effectBackendEvidence.failure === null
            && endpointStatus
                .effectCommands.pendingPulseProgramCount === 0;
        const effectRosterSealed = effectRosterEvidence?.recoveryRequired === false
            && effectRosterEvidence.pendingPulseCount === 0
            && effectRosterEvidence.pendingBatchCount === 0
            && effectRosterEvidence.pendingStaleCompletionCount === 0
            && effectRosterEvidence.terminal?.finalFixedTick === fixedTick
            && effectRosterEvidence.terminal.fixedCommitObserved === true
            && effectRosterEvidence.terminal.lifecycleObserved === true
            && effectRosterEvidence.terminal.rosterSealed === true;
        const formationCancellationSubmitted
            = formationOwnerEvidence?.abiVersion
                === GPU_FORMATION_TERMINAL_CANCEL_ABI_VERSION
            && formationOwnerEvidence.state === 'armed'
            && formationOwnerEvidence.finalFixedTick === fixedTick
            && formationOwnerEvidence.submittedTick === 0
            && formationOwnerEvidence.failure === null
            && formationBackendEvidence?.abiVersion
                === GPU_FORMATION_TERMINAL_CANCEL_ABI_VERSION
            && formationBackendEvidence.state === 'submitted'
            && formationBackendEvidence.finalFixedTick === fixedTick
            && formationBackendEvidence.submittedTick === fixedTick
            && formationBackendEvidence.prepareProgramCount
                === formationOwnerEvidence.prepareProgramCount
            && formationBackendEvidence.armedTransformCount
                === formationOwnerEvidence.armedTransformCount
            && formationBackendEvidence.pendingPrepareProgramCount === 0
            && formationBackendEvidence.pendingPrepareReadbackCount === 0
            && formationBackendEvidence.failure === null
            && endpointStatus.formationCommands.pendingPrepareBatchCount === 0
            && endpointStatus.formationCommands.inFlightPrepareBatchCount === 0
            && endpointStatus.formationCommands.preparedTransformBatchCount === 0
            && endpointStatus.formationCommands.armedTransformBatchCount === 0
            && endpointStatus.formationCommands
                .pendingTransformCompletionCount === 0
            && endpointStatus.formationCommands.backend
                ?.pendingTransformReadbackCount === 0;
        const formationRosterSealed
            = formationRosterEvidence?.recoveryRequired === false
            && formationRosterEvidence.pendingTransformBatchCount === 0
            && formationRosterEvidence.terminal?.finalFixedTick === fixedTick
            && formationRosterEvidence.terminal.fixedCommitObserved === true
            && formationRosterEvidence.terminal.lifecycleObserved === true
            && formationRosterEvidence.terminal.rosterSealed === true;
        const atomicTransformCancellationSubmitted
            = atomicTransformOwnerEvidence?.abiVersion
                === GPU_ATOMIC_TRANSFORM_TERMINAL_CANCEL_ABI_VERSION
            && atomicTransformOwnerEvidence.state === 'armed'
            && atomicTransformOwnerEvidence.finalFixedTick === fixedTick
            && atomicTransformOwnerEvidence.submittedTick === 0
            && atomicTransformOwnerEvidence.pendingPrepareCount === 0
            && atomicTransformOwnerEvidence.pendingTransformCount === 0
            && atomicTransformOwnerEvidence.pendingReadbackCount === 0
            && atomicTransformOwnerEvidence.failure === null
            && atomicTransformBackendEvidence?.abiVersion
                === GPU_ATOMIC_TRANSFORM_TERMINAL_CANCEL_ABI_VERSION
            && atomicTransformBackendEvidence.state === 'submitted'
            && atomicTransformBackendEvidence.finalFixedTick === fixedTick
            && atomicTransformBackendEvidence.submittedTick === fixedTick
            && atomicTransformBackendEvidence.pendingPrepareCount === 0
            && atomicTransformBackendEvidence.pendingTransformCount === 0
            && atomicTransformBackendEvidence.pendingReadbackCount === 0
            && atomicTransformBackendEvidence.failure === null
            && atomicTransformBackendEvidence.sessionGeneration
                === atomicTransformOwnerEvidence.sessionGeneration
            && atomicTransformBackendEvidence.deviceGeneration
                === atomicTransformOwnerEvidence.deviceGeneration
            && atomicTransformBackendEvidence.authoritativeEpoch
                === atomicTransformOwnerEvidence.authoritativeEpoch
            && endpointStatus.atomicTransformCommands?.pendingPrepareCount === 0
            && endpointStatus.atomicTransformCommands?.pendingTransformCount === 0
            && endpointStatus.atomicTransformCommands?.pendingReadbackCount === 0;
        const atomicTransformRosterSealed
            = atomicTransformRosterEvidence?.recoveryRequired === false
            && atomicTransformRosterEvidence.pendingTransformBatchCount === 0
            && atomicTransformRosterEvidence.pendingFirstHitCount === 0
            && atomicTransformRosterEvidence.circlePrimeDueCount === 0
            && atomicTransformRosterEvidence.terminal?.finalFixedTick
                === fixedTick
            && atomicTransformRosterEvidence.terminal.fixedCommitObserved === true
            && atomicTransformRosterEvidence.terminal.lifecycleObserved === true
            && atomicTransformRosterEvidence.terminal.rosterSealed === true;
        if (!towerGameplayTargetCleared
            || !cancellationSubmitted
            || !effectCancellationSubmitted
            || !effectRosterSealed
            || !formationCancellationSubmitted
            || !formationRosterSealed
            || !atomicTransformCancellationSubmitted
            || !atomicTransformRosterSealed) {
            return this.#sealTerminalFailure(
                !towerGameplayTargetCleared
                    ? 'terminal-tower-gameplay-target-evidence'
                    : !cancellationSubmitted
                    ? 'terminal-fixed-program-cancel'
                    : !effectCancellationSubmitted
                        ? 'terminal-effect-program-cancel'
                        : !effectRosterSealed
                            ? 'terminal-effect-roster-seal'
                            : !formationCancellationSubmitted
                                ? 'terminal-formation-program-cancel'
                                : !formationRosterSealed
                                    ? 'terminal-formation-roster-seal'
                                    : !atomicTransformCancellationSubmitted
                                        ? 'terminal-atomic-transform-program-cancel'
                                        : 'terminal-atomic-transform-roster-seal',
                fixedTick,
                !towerGameplayTargetCleared
                    ? towerGameplayTargetEvidence
                    : !cancellationSubmitted
                    ? backendEvidence ?? ownerEvidence ?? terminalCancel
                    : !effectCancellationSubmitted
                        ? effectBackendEvidence
                            ?? effectOwnerEvidence
                            ?? effectTerminalCancel
                        : !effectRosterSealed
                            ? effectRosterEvidence
                            : !formationCancellationSubmitted
                                ? formationBackendEvidence
                                    ?? formationOwnerEvidence
                                    ?? formationTerminalCancel
                                : !formationRosterSealed
                                    ? formationRosterEvidence
                                    : !atomicTransformCancellationSubmitted
                                        ? atomicTransformBackendEvidence
                                            ?? atomicTransformOwnerEvidence
                                            ?? atomicTransformTerminalCancel
                                        : atomicTransformRosterEvidence
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
        const transitioned = this.#transitionRunOutcomeForCore(fixedTick, null);
        if (transitioned === false
            && this.terminalState === GPU_WORLD_TERMINAL_STATE.SEALED_FAILED) {
            return false;
        }
        const began = this.#beginTerminalFinalization(
            fixedTick,
            this.runOutcome.getRunFailedFact()
        );
        if (began === false
            && this.terminalState === GPU_WORLD_TERMINAL_STATE.SEALED_FAILED) {
            return false;
        }
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

    #createPentagonEffectDirector(endpoint) {
        const director = this.pentagonEffectDirectorFactory({
            endpoint,
            registry: endpoint.getRegistry(),
            effectCommandPort: endpoint.getEffectCommandPort(),
            sessionGeneration: endpoint.getStatus().sessionGeneration,
            capacity: endpoint.getCapacity()
        });
        if (!director
            || typeof director.observeLifecycle !== 'function'
            || typeof director.observeCompletedEvents !== 'function'
            || typeof director.stageForFixedTick !== 'function'
            || typeof director.observeFixedCommit !== 'function'
            || typeof director.requiresRecovery !== 'function'
            || typeof director.getStatus !== 'function'
            || typeof director.resetGpuBinding !== 'function'
            || typeof director.closeForTerminal !== 'function'
            || typeof director.destroy !== 'function') {
            try {
                director?.destroy?.();
            } catch {
                // 잘못된 replacement contract 정리가 old GPU world 원자성을 깨지 않게 합니다.
            }
            throw new TypeError('PentagonEffectDirector contract가 올바르지 않습니다.');
        }
        return director;
    }

    #createFormationRuntimeDirector(endpoint) {
        const director = this.formationRuntimeDirectorFactory({
            registry: endpoint.getRegistry(),
            formationCommandPort: endpoint.getFormationCommandPort(),
            sessionGeneration: endpoint.getStatus().sessionGeneration,
            capacity: endpoint.getCapacity()
        });
        if (!director
            || typeof director.observeLifecycle !== 'function'
            || typeof director.observeCompletedPreparations !== 'function'
            || typeof director.stageForFixedTick !== 'function'
            || typeof director.observeFixedCommit !== 'function'
            || typeof director.getMemberCount !== 'function'
            || typeof director.hasExactMember !== 'function'
            || typeof director.copyExactMemberHandleAt !== 'function'
            || typeof director.requiresRecovery !== 'function'
            || typeof director.getStatus !== 'function'
            || typeof director.resetGpuBinding !== 'function'
            || typeof director.closeForTerminal !== 'function'
            || typeof director.destroy !== 'function') {
            try {
                director?.destroy?.();
            } catch {
                // 잘못된 Formation director 정리가 old world를 건드리지 않게 합니다.
            }
            throw new TypeError('FormationRuntimeDirector contract가 올바르지 않습니다.');
        }
        return director;
    }

    #createJorangSplitLineageDirector(endpoint) {
        const director = this.jorangSplitLineageDirectorFactory({
            registry: endpoint.getRegistry(),
            atomicTransformCommandPort:
                endpoint.getAtomicTransformCommandPort(),
            sessionGeneration: endpoint.getStatus().sessionGeneration,
            capacity: endpoint.getCapacity()
        });
        if (!director
            || typeof director.observeLifecycle !== 'function'
            || typeof director.observeCompletedEvents !== 'function'
            || typeof director.observeCompletedPreparations !== 'function'
            || typeof director.stageForFixedTick !== 'function'
            || typeof director.observeFixedCommit !== 'function'
            || typeof director.requiresRecovery !== 'function'
            || typeof director.getStatus !== 'function'
            || typeof director.resetGpuBinding !== 'function'
            || typeof director.closeForTerminal !== 'function'
            || typeof director.destroy !== 'function') {
            try {
                director?.destroy?.();
            } catch {
                // 잘못된 J lineage director가 old world를 건드리지 않게 합니다.
            }
            throw new TypeError(
                'JorangSplitLineageDirector contract가 올바르지 않습니다.'
            );
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
        this.towerGameplayTargetConfigured = false;
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
            const gameplayTarget = this.enemySimulationEndpoint
                .configureTowerGameplayTarget?.(null);
            this.enemySimulationEndpoint.configureTrackedBody?.(null);
            this.coreProxyHandle = freezeHandle(coreProxyHandle);
            this.towerGameplayTargetConfigured = false;
            this.trackedTowerConfigured = false;
            return gameplayTarget?.accepted === true;
        }

        const protocol = this.#readTowerBindingProtocol();
        if (this.towerCombatRoster && !protocol) {
            return false;
        }
        const gameplayTarget = this.enemySimulationEndpoint
            .configureTowerGameplayTarget(towerHandle);
        if (gameplayTarget?.accepted !== true) {
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
            this.towerGameplayTargetConfigured = true;
            const tracking = this.enemySimulationEndpoint
                .configureTrackedBody(boundTowerHandle);
            this.trackedTowerConfigured = tracking?.accepted === true;
            return true;
        } catch {
            this.tower.resetGpuBinding();
            this.towerCombatRoster?.releaseGpuBinding();
            this.enemySimulationEndpoint.configureTowerGameplayTarget(null);
            this.enemySimulationEndpoint.configureTrackedBody(null);
            this.towerHandle = null;
            this.coreProxyHandle = null;
            this.towerGameplayTargetConfigured = false;
            this.trackedTowerConfigured = false;
            return false;
        }
    }

    #isPrimaryTowerAlive() {
        return this.towerCombatRoster?.isPrimaryTowerAlive() ?? true;
    }

    #cutoverCommittedTowerDeath() {
        const gameplayTarget = this.enemySimulationEndpoint
            .configureTowerGameplayTarget(null);
        this.enemySimulationEndpoint.configureTrackedBody(null);
        this.towerGameplayTargetConfigured = false;
        this.trackedTowerConfigured = false;
        this.towerHandle = null;
        this.tower.deactivateForDeath();
        this.primaryProjectileController?.deactivateForTowerDeath();
        return gameplayTarget?.accepted === true;
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
