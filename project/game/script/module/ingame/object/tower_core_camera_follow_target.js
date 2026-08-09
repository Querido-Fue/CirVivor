import {
    assertCameraFollowTarget2D
} from '../contract/camera_control_contract.js';

function isFinitePoint(source) {
    return Number.isFinite(Number(source?.x))
        && Number.isFinite(Number(source?.y));
}

/**
 * 살아 있는 Tower의 observed presentation pose를 그대로 사용하고,
 * terminal Tower death 뒤에는 CPU Core presentation 위치를 제공하는 stable target입니다.
 */
export class TowerCoreCameraFollowTarget {
    constructor(options = {}) {
        this.tower = assertCameraFollowTarget2D(options.tower);
        this.core = options.core;
        this.towerCombatRoster = options.towerCombatRoster;
        if (!this.core || typeof this.core !== 'object' || !('position' in this.core)) {
            throw new TypeError('Tower/Core camera target에는 Core presentation이 필요합니다.');
        }
        if (!this.towerCombatRoster
            || typeof this.towerCombatRoster.isPrimaryTowerAlive !== 'function') {
            throw new TypeError('Tower/Core camera target에는 Tower combat roster가 필요합니다.');
        }

        this.cameraFollowTargetId = 'tower-core-camera-follow';
        this.destroyed = false;
    }

    isCameraFollowEnabled() {
        if (this.destroyed) {
            return false;
        }
        if (this.towerCombatRoster.isPrimaryTowerAlive() === false) {
            return this.core.active !== false && isFinitePoint(this.core.position);
        }
        return this.tower.isCameraFollowEnabled();
    }

    copyCameraFollowPositionInto(out = {}) {
        if (this.destroyed) {
            return out && typeof out === 'object' ? out : {};
        }
        if (this.towerCombatRoster.isPrimaryTowerAlive() !== false) {
            return this.tower.copyCameraFollowPositionInto(out);
        }
        const target = out && typeof out === 'object' ? out : {};
        target.x = Number(this.core.position.x);
        target.y = Number(this.core.position.y);
        return target;
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.tower = null;
        this.core = null;
        this.towerCombatRoster = null;
    }
}
