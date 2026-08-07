import { assertCollidable2D } from '../contract/collidable_contract.js';
import { assertCameraFollowTarget2D } from '../contract/camera_control_contract.js';
import { assertCoreIntegrity } from '../contract/core_integrity_contract.js';
import { assertPhysicsBody2D } from '../contract/physics_body_contract.js';
import { assertTileNavigationSource } from '../contract/tile_navigation_contract.js';
import { TileMapCollisionResolver } from '../map/tile_map_collision_resolver.js';
import { TileMapRenderer } from '../map/tile_map_renderer.js';
import { createTileMap } from '../map/tile_map.js';
import { WorldCamera2D } from '../map/world_camera_2d.js';
import { WaveDirector } from '../flow/wave_director.js';
import {
    createGpuSimulationEndpoint
} from './enemy/gpu_enemy_simulation_endpoint.js';
import { TheCore } from './the_core.js';
import { TheCoreRenderer } from './the_core_renderer.js';
import { TheTower } from './the_tower.js';
import { TheTowerRenderer } from './the_tower_renderer.js';
import { TowerPlayerController } from './tower_player_controller.js';

/**
 * 뷰포트 값을 재사용 대상에 정규화해 기록합니다.
 * @param {{ww:number,wh:number}} target - 기록 대상입니다.
 * @param {object} [source={}] - 원본 뷰포트입니다.
 * @returns {{ww:number,wh:number}} 같은 대상 객체입니다.
 */
function syncWorldViewport(target, source = {}) {
    const ww = Number(source.ww);
    const wh = Number(source.wh);
    target.ww = Number.isFinite(ww) ? Math.max(0, ww) : 0;
    target.wh = Number.isFinite(wh) ? Math.max(0, wh) : 0;
    return target;
}

function resolveEnemyWaveEnabled(dependencies, options) {
    if (typeof options?.enemyWaveEnabled === 'boolean') {
        return options.enemyWaveEnabled;
    }
    return dependencies?.webGpuPlatformPort?.getState?.().ready === true;
}

/**
 * @class GameObjectSystem
 * @description 타일 맵, The Tower, The Core와 물리·충돌·렌더 capability를 소유합니다.
 */
export class GameObjectSystem {
    /**
     * @param {{worldRenderPort:{drawCircle:(options:object)=>void,drawSquareInstances:(options:object)=>void}}} dependencies - 오브젝트 의존성입니다.
     * @param {{mapId?:string|null,tileNavigationSource?:object|null,coreIntegrity:object,enemyWaveEnabled?:boolean,waveDefinition?:object,enemyPresentationProfile?:string}} options - 세션 오브젝트 옵션입니다.
     */
    constructor(dependencies, options) {
        this.viewport = { ww: 0, wh: 0 };
        this.requestedMapId = typeof options?.mapId === 'string' ? options.mapId : null;
        this.injectedTileNavigationSource = options?.tileNavigationSource ?? null;
        this.coreIntegrity = assertCoreIntegrity(options?.coreIntegrity);
        this.tileMap = null;
        this.tileCollisionResolver = null;
        this.camera = new WorldCamera2D();
        this.core = null;
        this.tower = null;
        this.cameraFollowTarget = null;
        this.towerController = null;
        this.playerControllables = [];
        this.physicsBodies = [];
        this.collidables = [];
        this.enemySimulationEndpoint = createGpuSimulationEndpoint({
            webGpuPlatformPort: dependencies?.webGpuPlatformPort ?? null,
            enemySimulationBackendFactory:
                dependencies?.enemySimulationBackendFactory,
            enemySimulationBackend: dependencies?.enemySimulationBackend
        }, {
            presentationProfile: options?.enemyPresentationProfile
        });
        this.enemySimulationBackend = this.enemySimulationEndpoint.getBackend();
        this.worldRegistry = this.enemySimulationEndpoint.getRegistry();
        this.enemyLifecycleCommandOwner
            = this.enemySimulationEndpoint.getLifecycleCommandOwner();
        this.enemyWaveEnabled = resolveEnemyWaveEnabled(dependencies, options);
        this.waveDirector = this.enemyWaveEnabled
            ? new WaveDirector({ waveDefinition: options?.waveDefinition })
            : null;
        this.lastCompletedEnemyFixedTick = 0;
        this.pendingEnemyFixedTick = 0;
        this.enemySimulationRecoveryRequired = false;
        this.enemySimulationPaused = false;
        this.enemyPresentationFrame = {
            frameDelta: 0,
            fixedDelta: 0,
            fixedAlpha: 0
        };
        this.tileMapRenderer = new TileMapRenderer(dependencies?.worldRenderPort);
        this.coreRenderer = new TheCoreRenderer(dependencies?.worldRenderPort);
        this.towerRenderer = new TheTowerRenderer(dependencies?.worldRenderPort);
        this.initialized = false;
        this.destroyed = false;
    }

    /**
     * 방향 route 기반 6타일 맵과 Core/Tower를 생성합니다.
     * @param {object} viewport - 초기 표시 viewport입니다.
     * @returns {void}
     */
    init(viewport) {
        if (this.initialized || this.destroyed) {
            return;
        }
        syncWorldViewport(this.viewport, viewport);
        this.tileMap = assertTileNavigationSource(
            this.injectedTileNavigationSource
                ?? createTileMap(this.requestedMapId)
        );
        this.tileCollisionResolver = new TileMapCollisionResolver(this.tileMap);
        this.enemySimulationEndpoint.init(this.tileMap);
        this.waveDirector?.init(this.tileMap);

        const towerSpawn = this.tileMap.getTowerSpawnPosition();
        const coreSpawn = this.tileMap.getCorePosition();
        this.tower = new TheTower({
            x: towerSpawn.x,
            y: towerSpawn.y
        });
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

        this.camera.init(this.tileMap.getWorldBounds(), this.viewport);
        this.initialized = true;
    }

    /**
     * 등록 가능한 IPlayerControllable의 동일한 읽기 전용 목록 참조를 반환합니다.
     * @returns {object[]} IPlayerControllable 목록입니다.
     */
    getPlayerControllables() {
        return this.playerControllables;
    }

    /**
     * 물리 단계와 향후 CollisionHandler가 사용할 IPhysicsBody2D 목록을 반환합니다.
     * @returns {object[]} 등록된 물리 바디 목록입니다.
     */
    getPhysicsBodies() {
        return this.physicsBodies;
    }

    /**
     * 향후 동적 충돌 파이프라인이 사용할 ICollidable2D 목록을 반환합니다.
     * @returns {object[]} 등록된 collider 목록입니다.
     */
    getCollidables() {
        return this.collidables;
    }

    /** @returns {TheTower|null} 현재 The Tower입니다. */
    getTower() {
        return this.tower;
    }

    /** @returns {object|null} 현재 ICameraFollowTarget2D 대상입니다. */
    getCameraFollowTarget() {
        return this.cameraFollowTarget;
    }

    /** @returns {TheCore|null} 현재 The Core입니다. */
    getCore() {
        return this.core;
    }

    /** @returns {object|null} 현재 ITileNavigationSource입니다. */
    getTileMap() {
        return this.tileMap;
    }

    /**
     * 렌더와 향후 pointer 입력이 공유할 IWorldViewProjection2D를 반환합니다.
     * @returns {WorldCamera2D} 현재 월드 projection입니다.
     */
    getWorldViewProjection() {
        return this.camera;
    }

    /**
     * 복수 Gate를 지원하는 적 spawn route 목록을 반환합니다.
     * @returns {object[]} 컴파일된 route 목록입니다.
     */
    getEnemySpawnRoutes() {
        return this.tileMap?.getSpawnRoutes() ?? [];
    }

    /**
     * 향후 enemy spawn/flow-field lifecycle이 사용할 session simulation 경계를 반환합니다.
     * @returns {EnemySimulationBackend} 현재 enemy simulation backend입니다.
     */
    getEnemySimulationBackend() {
        return this.enemySimulationBackend;
    }

    /**
     * 실제 게임·벤치마크·도구가 공통으로 사용할 mixed-body GPU simulation 진입점입니다.
     * @returns {import('./enemy/gpu_enemy_simulation_endpoint.js').GpuSimulationEndpoint}
     */
    getGpuSimulationEndpoint() {
        return this.enemySimulationEndpoint;
    }

    /** @returns {import('./enemy/gpu_enemy_simulation_endpoint.js').GpuSimulationEndpoint} 기존 enemy API 호환 alias입니다. */
    getEnemySimulationEndpoint() {
        return this.getGpuSimulationEndpoint();
    }

    /** @returns {WorldRegistry} 테스트·진단용 session entity registry입니다. */
    getWorldRegistry() {
        return this.worldRegistry;
    }

    /** @returns {EnemyLifecycleCommandOwner} 테스트·향후 gameplay command adapter용 경계입니다. */
    getEnemyLifecycleCommandOwner() {
        return this.enemyLifecycleCommandOwner;
    }

    /** @returns {object|null} 현재 spawn-only wave 진행 snapshot입니다. */
    getEnemyWaveStatus() {
        return this.waveDirector?.getStatus() ?? null;
    }

    /** @returns {number} 마지막으로 전체 세션이 완료한 fixed tick입니다. */
    getLastCompletedEnemyFixedTick() {
        return this.lastCompletedEnemyFixedTick;
    }

    /**
     * 새 GPU lifecycle command를 예약할 수 있는 가장 이른 fixed tick입니다.
     * lifecycle commit 뒤 GPU submit을 재시도 중이면 pending 경계 다음 tick을 반환합니다.
     * @returns {number} 양의 안전한 fixed tick입니다.
     */
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

    /** @returns {number} 기존 enemy lifecycle tick API 호환 alias입니다. */
    getNextEnemyLifecycleFixedTick() {
        return this.getNextGpuLifecycleFixedTick();
    }

    /** @returns {boolean} 현재 wave를 안전 경계에서 재시작해야 하는 hard GPU failure 여부입니다. */
    isEnemySimulationRecoveryRequired() {
        return this.enemySimulationRecoveryRequired;
    }

    /** pause/resume 경계에서 적 render prediction clock을 물리 clock에 맞춥니다. */
    synchronizeEnemyPresentation() {
        this.enemySimulationEndpoint.synchronizePresentation();
    }

    /**
     * 적 GPU tick 제출을 먼저 확인한 뒤 Tower 운동과 tile 침투를 같은 fixed 경계에서 진행합니다.
     * @param {number} delta - 초 단위 fixed delta입니다.
     * @param {number} [proposedFixedTick] - GameSystem이 아직 확정하지 않은 다음 tick입니다.
     * @returns {boolean} 적과 Tower가 같은 tick을 모두 전진했는지 여부입니다.
     */
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
                `미완료 enemy fixed tick이 있습니다: ${this.pendingEnemyFixedTick}`
            );
        }
        const enemyState = this.enemySimulationEndpoint.getRuntimeState();
        const enemyGpuRequired = this.enemyWaveEnabled
            || this.enemySimulationEndpoint.getPendingCommandCount() > 0
            || this.enemySimulationEndpoint.hasActiveBodies();
        if (enemyGpuRequired
            && this.enemySimulationEndpoint.requiresRecovery()
            && enemyState !== 'gpu-backpressure') {
            this.enemySimulationRecoveryRequired = true;
            if (!this.enemySimulationPaused) {
                this.enemySimulationEndpoint.synchronizePresentation();
            }
            this.enemySimulationPaused = true;
            return false;
        }

        if (this.pendingEnemyFixedTick === 0) {
            const completedEvents = this.enemySimulationEndpoint
                .commitCompletedEventsAtFixedBoundary(
                proposedFixedTick
            );
            if (completedEvents.protocolFailure) {
                this.enemySimulationRecoveryRequired = true;
                if (!this.enemySimulationPaused) {
                    this.enemySimulationEndpoint.synchronizePresentation();
                }
                this.enemySimulationPaused = true;
                return false;
            }
            this.waveDirector?.queueSpawnsForFixedTick(
                proposedFixedTick,
                this.enemySimulationEndpoint
            );
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
            this.pendingEnemyFixedTick = proposedFixedTick;
        }

        const hasActiveEnemies = this.enemySimulationEndpoint.hasActiveBodies();
        const enemySubmitted = this.enemySimulationEndpoint.fixedUpdate(
            delta,
            proposedFixedTick
        );
        const postSubmitState = this.enemySimulationEndpoint.getRuntimeState();
        const enemyGpuStillRequired = this.enemyWaveEnabled
            || hasActiveEnemies
            || this.enemySimulationEndpoint.getPendingCommandCount() > 0;
        this.enemySimulationRecoveryRequired
            = enemyGpuStillRequired
                && this.enemySimulationEndpoint.requiresRecovery()
                && postSubmitState !== 'gpu-backpressure';
        if (hasActiveEnemies && !enemySubmitted) {
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
        this.tower?.fixedUpdate(delta);
        if (this.tower && this.tileCollisionResolver) {
            this.tileCollisionResolver.resolve(this.tower.getCollider());
        }
        return true;
    }

    /**
     * Tower 보간과 적 GPU presentation clock을 갱신합니다.
     * @param {number} alpha - 0~1 fixed interpolation alpha입니다.
     * @param {number} [frameDelta=0] - 초 단위 가변 렌더 delta입니다.
     * @param {number} [fixedDelta=0] - 초 단위 fixed delta입니다.
     * @returns {void}
     */
    update(alpha, frameDelta = 0, fixedDelta = 0) {
        this.tower?.updateRenderPosition(alpha);
        this.enemyPresentationFrame.frameDelta = this.enemySimulationPaused ? 0 : frameDelta;
        this.enemyPresentationFrame.fixedDelta = fixedDelta;
        this.enemyPresentationFrame.fixedAlpha = alpha;
        this.enemySimulationEndpoint.updatePresentation(this.enemyPresentationFrame);
    }

    /**
     * 보이는 타일, Core, Tower 순서로 렌더 포트에 제출합니다.
     * @returns {void}
     */
    draw() {
        if (!this.tileMap) {
            return;
        }
        this.tileMapRenderer.draw(
            this.tileMap,
            this.camera
        );
        this.drawEnemySimulation();
        this.coreRenderer.draw(
            this.core,
            this.camera
        );
        this.towerRenderer.draw(
            this.tower,
            this.camera
        );
    }

    /**
     * benchmark/tool이 map·Core·Tower 없이 GPU 적 layer만 제출하는 소유자 경계입니다.
     * @returns {boolean} endpoint draw 제출 여부입니다.
     */
    drawEnemySimulation() {
        if (!this.tileMap || this.destroyed) {
            return false;
        }
        const submitted = this.enemySimulationEndpoint.draw(this.camera);
        const enemyState = this.enemySimulationEndpoint.getRuntimeState();
        const enemyGpuRequired = this.enemyWaveEnabled
            || this.enemySimulationEndpoint.getPendingCommandCount() > 0
            || this.enemySimulationEndpoint.hasActiveBodies();
        this.enemySimulationRecoveryRequired
            = enemyGpuRequired
                && this.enemySimulationEndpoint.requiresRecovery()
                && enemyState !== 'gpu-backpressure';
        return submitted;
    }

    /**
     * 월드 entity를 재생성하지 않고 카메라 viewport만 갱신합니다.
     * @param {object} viewport - 새 object viewport입니다.
     * @returns {void}
     */
    resize(viewport) {
        syncWorldViewport(this.viewport, viewport);
        this.camera.resize(this.viewport);
    }

    /**
     * 소유 객체와 capability를 역순으로 정리합니다.
     * 반복 호출해도 안전합니다.
     * @returns {void}
     */
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
        this.towerRenderer.destroy();
        this.coreRenderer.destroy();
        this.tileMapRenderer.destroy();
        this.initialized = false;
    }
}
