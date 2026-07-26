import { assertCollidable2D } from '../contract/collidable_contract.js';
import { assertCameraFollowTarget2D } from '../contract/camera_control_contract.js';
import { assertCoreIntegrity } from '../contract/core_integrity_contract.js';
import { assertPhysicsBody2D } from '../contract/physics_body_contract.js';
import { assertTileNavigationSource } from '../contract/tile_navigation_contract.js';
import { TileMapCollisionResolver } from '../map/tile_map_collision_resolver.js';
import { TileMapRenderer } from '../map/tile_map_renderer.js';
import { createTileMap } from '../map/tile_map.js';
import { WorldCamera2D } from '../map/world_camera_2d.js';
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

/**
 * @class GameObjectSystem
 * @description 타일 맵, The Tower, The Core와 물리·충돌·렌더 capability를 소유합니다.
 */
export class GameObjectSystem {
    /**
     * @param {{worldRenderPort:{drawCircle:(options:object)=>void,drawSquareInstances:(options:object)=>void}}} dependencies - 오브젝트 의존성입니다.
     * @param {{mapId?:string|null,coreIntegrity:object}} options - 세션 오브젝트 옵션입니다.
     */
    constructor(dependencies, options) {
        this.viewport = { ww: 0, wh: 0 };
        this.requestedMapId = typeof options?.mapId === 'string' ? options.mapId : null;
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
            createTileMap(this.requestedMapId)
        );
        this.tileCollisionResolver = new TileMapCollisionResolver(this.tileMap);

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
     * Tower 운동을 적분하고 막힌 타일과의 침투를 해소합니다.
     * @param {number} delta - 초 단위 fixed delta입니다.
     * @returns {void}
     */
    fixedUpdate(delta) {
        this.tower?.fixedUpdate(delta);
        if (this.tower && this.tileCollisionResolver) {
            this.tileCollisionResolver.resolve(this.tower.getCollider());
        }
    }

    /**
     * Tower 렌더 보간 상태를 갱신합니다.
     * @param {number} alpha - 0~1 fixed interpolation alpha입니다.
     * @returns {void}
     */
    update(alpha) {
        this.tower?.updateRenderPosition(alpha);
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
        this.tower?.destroy();
        this.tower = null;
        this.cameraFollowTarget = null;
        this.core?.destroy();
        this.core = null;
        this.tileCollisionResolver = null;
        this.tileMap = null;
        this.towerRenderer.destroy();
        this.coreRenderer.destroy();
        this.tileMapRenderer.destroy();
        this.initialized = false;
    }
}
