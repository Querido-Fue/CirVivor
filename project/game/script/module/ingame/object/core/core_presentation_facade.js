import { THE_CORE_DATA } from 'data/object/core/the_core_data.js';
import { assertCoreIntegrity } from '../../contract/core_integrity_contract.js';

/** GPU Core proxy와 물리 권위를 공유하지 않는 CPU presentation/domain facade입니다. */
export class CorePresentationFacade {
    constructor(options) {
        const x = Number(options?.x);
        const y = Number(options?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new TypeError('Core presentation facade에는 유한한 위치가 필요합니다.');
        }
        this.id = 'the-core';
        this.kind = 'core';
        this.active = true;
        this.radius = THE_CORE_DATA.RADIUS_TILES;
        this.position = Object.freeze({ x, y });
        this.integrity = assertCoreIntegrity(options?.integrity);
    }

    getCoreIntegrity() {
        return this.integrity;
    }

    destroy() {
        this.active = false;
        this.integrity = null;
    }
}
