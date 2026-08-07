import { assertCollidable2D } from '../contract/collidable_contract.js';
import { assertCameraFollowTarget2D } from '../contract/camera_control_contract.js';
import { assertCoreIntegrity } from '../contract/core_integrity_contract.js';
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
        this.endpointSessionCount = 0;
        this.enemySimulationEndpoint = null;
        this.enemySimulationBackend = null;
        this.worldRegistry = null;
        this.enemyLifecycleCommandOwner = null;
        this.#installGpuEndpoint(this.#createGpuEndpoint(true));

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
            this.cameraFollowTarget = assertCameraFollowTarget2D(this.tower);
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

    getGpuWorldActorStatus() {
        return Object.freeze({
            enabled: this.gameplayWorldActorsEnabled,
            spawnTargetFixedTick: this.actorSpawnTargetFixedTick,
            lifecycleQueued: this.actorLifecycleQueued,
            towerHandle: this.towerHandle,
            coreProxyHandle: this.coreProxyHandle,
            trackedTowerConfigured: this.trackedTowerConfigured
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
        return this.enemySimulationRecoveryRequired;
    }

    isGpuWorldRecoveryRequired() {
        return this.isEnemySimulationRecoveryRequired();
    }

    synchronizeEnemyPresentation() {
        this.enemySimulationEndpoint.synchronizePresentation();
    }

    fixedUpdate(delta, proposedFixedTick = this.lastCompletedEnemyFixedTick + 1) {
        if (!this.initialized || this.destroyed) {
            return false;
        }
        if (!Number.isSafeInteger(proposedFixedTick) || proposedFixedTick <= 0) {
            throw new RangeError('proposedFixedTick은 양의 안전한 정수여야 합니다.');
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
        if (gpuRequired
            && this.enemySimulationEndpoint.requiresRecovery()
            && gpuState !== 'gpu-backpressure') {
            return this.#pauseForGpuRecovery();
        }

        if (this.pendingEnemyFixedTick === 0) {
            const completedEvents = this.enemySimulationEndpoint
                .commitCompletedEventsAtFixedBoundary(proposedFixedTick);
            if (completedEvents.protocolFailure) {
                return this.#pauseForGpuRecovery();
            }
            this.lastCompletedGpuEvents = completedEvents;
            this.waveDirector?.queueSpawnsForFixedTick(
                proposedFixedTick,
                this.enemySimulationEndpoint
            );
            if (!this.#queueGpuWorldActorsForFixedTick(proposedFixedTick)) {
                return this.#pauseForGpuRecovery();
            }

            let expectedControlCommandId = null;
            let primaryProjectileShotReceipt = null;
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

            const lifecycleResult = this.enemySimulationEndpoint
                .commitAtFixedBoundary(proposedFixedTick);
            if (lifecycleResult.recoveryRequired) {
                this.enemySimulationRecoveryRequired
                    = lifecycleResult.state !== 'stalled';
                if (!this.enemySimulationPaused) {
                    this.enemySimulationEndpoint.synchronizePresentation();
                }
                this.enemySimulationPaused = true;
                return false;
            }
            if (!this.#bindCommittedGpuWorldActors(lifecycleResult, proposedFixedTick)) {
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
        this.enemySimulationRecoveryRequired = gpuStillRequired
            && this.enemySimulationEndpoint.requiresRecovery()
            && postSubmitState !== 'gpu-backpressure';
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
        if (this.sessionMode === GAME_WORLD_SESSION_MODE.CPU_NO_WAVE_FALLBACK) {
            this.tower.fixedUpdate(delta);
            this.tileCollisionResolver.resolve(this.tower.getCollider());
        }
        return true;
    }

    update(alpha, frameDelta = 0, fixedDelta = 0) {
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
        this.enemySimulationRecoveryRequired = gpuRequired
            && this.enemySimulationEndpoint.requiresRecovery()
            && gpuState !== 'gpu-backpressure';
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
            || this.sessionMode !== GAME_WORLD_SESSION_MODE.GPU_WORLD) {
            return false;
        }
        const hasFactory = typeof this.endpointDependencies.enemySimulationBackendFactory
            === 'function';
        if (!hasFactory && this.endpointDependencies.enemySimulationBackend) {
            return false;
        }

        const replacementEndpoint = this.#createGpuEndpoint(false);
        const replacementWaveDirector = this.enemyWaveEnabled
            ? new WaveDirector({
                waveDefinition: this.waveDefinition,
                fixedTickOffset: this.lastCompletedEnemyFixedTick
            })
            : null;
        try {
            replacementEndpoint.init(this.tileMap);
            replacementWaveDirector?.init(this.tileMap);
        } catch {
            replacementWaveDirector?.destroy();
            replacementEndpoint.destroy();
            return false;
        }
        this.enemySimulationEndpoint.synchronizePresentation();
        this.waveDirector?.destroy();
        this.primaryProjectileController?.resetGpuBinding();
        this.enemySimulationEndpoint.destroy();
        this.tower.resetGpuBinding();
        this.#installGpuEndpoint(replacementEndpoint);
        this.primaryProjectileController?.bindGpuEndpoint(replacementEndpoint);
        this.waveDirector = replacementWaveDirector;
        this.pendingEnemyFixedTick = 0;
        this.enemySimulationRecoveryRequired = false;
        this.enemySimulationPaused = true;
        this.lastCompletedGpuEvents = createEmptyGpuEventSnapshot(
            this.lastCompletedEnemyFixedTick
        );
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
        this.waveDirector?.destroy();
        this.waveDirector = null;
        this.enemySimulationEndpoint.destroy();
        this.lastCompletedEnemyFixedTick = 0;
        this.pendingEnemyFixedTick = 0;
        this.enemySimulationRecoveryRequired = false;
        this.enemySimulationPaused = false;
        this.tower?.destroy();
        this.tower = null;
        this.cameraFollowTarget = null;
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
    }

    #createGpuEndpoint(allowInjectedBackend) {
        const dependencies = {
            webGpuPlatformPort: this.endpointDependencies.webGpuPlatformPort,
            enemySimulationBackendFactory:
                this.endpointDependencies.enemySimulationBackendFactory
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
        this.endpointSessionCount++;
        return endpoint;
    }

    #installGpuEndpoint(endpoint) {
        this.enemySimulationEndpoint = endpoint;
        this.enemySimulationBackend = endpoint.getBackend();
        this.worldRegistry = endpoint.getRegistry();
        this.enemyLifecycleCommandOwner = endpoint.getLifecycleCommandOwner();
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
        this.towerSpawnCommandId = [
            'gpu-world-tower-spawn',
            sessionGeneration,
            this.actorSpawnTargetFixedTick
        ].join(':');
        this.coreProxySpawnCommandId = [
            'gpu-world-core-proxy-spawn',
            sessionGeneration,
            this.actorSpawnTargetFixedTick
        ].join(':');
    }

    #queueGpuWorldActorsForFixedTick(fixedTick) {
        if (!this.gameplayWorldActorsEnabled
            || this.towerHandle
            || this.actorLifecycleQueued
            || fixedTick !== this.actorSpawnTargetFixedTick) {
            return true;
        }
        const towerReceipt = this.enemySimulationEndpoint.requestSpawn(
            createGpuTowerSpawnIntent({
                position: this.tileMap.getTowerSpawnPosition()
            }),
            fixedTick,
            this.towerSpawnCommandId
        );
        const coreReceipt = this.enemySimulationEndpoint.requestSpawn(
            createGpuCoreProxySpawnIntent({
                position: this.tileMap.getCorePosition()
            }),
            fixedTick,
            this.coreProxySpawnCommandId
        );
        if (!towerReceipt?.accepted || !coreReceipt?.accepted) {
            return false;
        }
        this.actorLifecycleQueued = true;
        return true;
    }

    #bindCommittedGpuWorldActors(lifecycleResult, fixedTick) {
        if (!this.gameplayWorldActorsEnabled
            || this.towerHandle
            || fixedTick !== this.actorSpawnTargetFixedTick) {
            return true;
        }
        const handleByCommandId = new Map(
            (lifecycleResult.spawned ?? []).map(({ commandId, handle }) => (
                [commandId, handle]
            ))
        );
        const towerHandle = handleByCommandId.get(this.towerSpawnCommandId);
        const coreProxyHandle = handleByCommandId.get(this.coreProxySpawnCommandId);
        if (!towerHandle || !coreProxyHandle) {
            return false;
        }
        const sessionGeneration = this.enemySimulationEndpoint.getStatus().sessionGeneration;
        this.towerHandle = this.tower.bindGpuBody(towerHandle, sessionGeneration);
        this.coreProxyHandle = freezeHandle(coreProxyHandle);
        const tracking = this.enemySimulationEndpoint.configureTrackedBody(
            this.towerHandle
        );
        this.trackedTowerConfigured = tracking?.accepted === true;
        return this.trackedTowerConfigured
            && this.worldRegistry.getActiveCount(GPU_TOWER_WORLD_KIND_ID) === 1
            && this.worldRegistry.getActiveCount(GPU_CORE_PROXY_WORLD_KIND_ID) === 1;
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
