import { assertPhysicsBody2D } from '../contract/physics_body_contract.js';
import { TheTower } from './the_tower.js';
import { TheTowerRenderer } from './the_tower_renderer.js';
import { TowerPlayerController } from './tower_player_controller.js';

/**
 * 뷰포트 값을 재사용 대상에 정규화해 기록합니다.
 * @param {{ww:number,objectWH:number,objectOffsetY:number}} target - 기록 대상입니다.
 * @param {object} [source={}] - 원본 뷰포트입니다.
 * @returns {{ww:number,objectWH:number,objectOffsetY:number}} 같은 대상 객체입니다.
 */
function syncWorldViewport(target, source = {}) {
    const ww = Number(source.ww);
    const objectWH = Number(source.objectWH);
    const objectOffsetY = Number(source.objectOffsetY);
    target.ww = Number.isFinite(ww) ? Math.max(0, ww) : 0;
    target.objectWH = Number.isFinite(objectWH) ? Math.max(0, objectWH) : 0;
    target.objectOffsetY = Number.isFinite(objectOffsetY) ? objectOffsetY : 0;
    return target;
}

/**
 * @class GameObjectSystem
 * @description 현재 구현 범위에서 The Tower와 등록된 물리 바디의 생명주기·fixed 이동·렌더를 소유합니다.
 */
export class GameObjectSystem {
    /**
     * @param {{worldRenderPort:{drawCircle:(options:object)=>void}}} dependencies - 오브젝트 의존성입니다.
     */
    constructor(dependencies) {
        this.viewport = { ww: 0, objectWH: 0, objectOffsetY: 0 };
        this.tower = null;
        this.towerController = null;
        this.playerControllables = [];
        this.physicsBodies = [];
        this.renderer = new TheTowerRenderer(dependencies?.worldRenderPort);
        this.initialized = false;
        this.destroyed = false;
    }

    /**
     * 빈 월드 중앙에 The Tower 하나를 생성합니다.
     * @param {object} viewport - 초기 월드 뷰포트입니다.
     * @returns {void}
     */
    init(viewport) {
        if (this.initialized || this.destroyed) {
            return;
        }
        syncWorldViewport(this.viewport, viewport);
        this.tower = new TheTower({
            x: this.viewport.ww * 0.5,
            y: this.viewport.objectWH * 0.5
        });
        this.tower.resize(this.viewport);
        this.physicsBodies.push(assertPhysicsBody2D(this.tower.getPhysicsBody()));
        this.towerController = new TowerPlayerController(this.tower);
        this.playerControllables.push(this.towerController);
        this.initialized = true;
    }

    /**
     * 등록 가능한 플레이어 제어 대상의 동일한 읽기 전용 목록 참조를 반환합니다.
     * 호출자는 배열을 직접 변경하지 않아야 합니다.
     * @returns {object[]} IPlayerControllable 목록입니다.
     */
    getPlayerControllables() {
        return this.playerControllables;
    }

    /**
     * 물리 단계와 향후 CollisionHandler가 사용할 IPhysicsBody2D 목록을 반환합니다.
     * 호출자는 배열과 바디의 읽기 전용 벡터를 직접 변경하지 않아야 합니다.
     * @returns {object[]} 등록된 물리 바디의 동일한 목록 참조입니다.
     */
    getPhysicsBodies() {
        return this.physicsBodies;
    }

    /**
     * 현재 The Tower를 반환합니다.
     * @returns {TheTower|null} Tower 인스턴스입니다.
     */
    getTower() {
        return this.tower;
    }

    /**
     * 오브젝트의 fixed-step 이동을 처리합니다.
     * @param {number} delta - 초 단위 fixed delta입니다.
     * @returns {void}
     */
    fixedUpdate(delta) {
        this.tower?.fixedUpdate(delta, this.viewport);
    }

    /**
     * 오브젝트의 렌더 보간 상태를 갱신합니다.
     * @param {number} alpha - 0~1 fixed interpolation alpha입니다.
     * @returns {void}
     */
    update(alpha) {
        this.tower?.updateRenderPosition(alpha);
    }

    /**
     * 현재 월드 오브젝트를 렌더 포트에 제출합니다.
     * @returns {void}
     */
    draw() {
        this.renderer.draw(this.tower, this.viewport.objectOffsetY);
    }

    /**
     * 월드를 재생성하지 않고 새 뷰포트와 경계만 반영합니다.
     * @param {object} viewport - 새 월드 뷰포트입니다.
     * @returns {void}
     */
    resize(viewport) {
        syncWorldViewport(this.viewport, viewport);
        this.tower?.resize(this.viewport);
    }

    /**
     * 소유 객체와 제어 컴포넌트를 역순으로 정리합니다.
     * 반복 호출해도 안전합니다.
     * @returns {void}
     */
    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.playerControllables.length = 0;
        this.physicsBodies.length = 0;
        this.towerController?.destroy();
        this.towerController = null;
        this.tower?.destroy();
        this.tower = null;
        this.renderer.destroy();
        this.initialized = false;
    }
}
