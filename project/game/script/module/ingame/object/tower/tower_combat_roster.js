import {
    PRIMARY_TOWER_LOGICAL_ID,
    TOWER_COMBAT_FACT_TYPE
} from './tower_group_contract.js';
import { TowerGroupState } from './tower_group_state.js';

const EMPTY_FACTS = Object.freeze([]);

function toCompatibilityFacts(facts) {
    if (!Array.isArray(facts) || facts.length === 0) return EMPTY_FACTS;
    const filtered = facts.filter((fact) => (
        fact.type !== TOWER_COMBAT_FACT_TYPE.SHARE_LOST
    ));
    return filtered.length === 0 ? EMPTY_FACTS : Object.freeze(filtered);
}

/**
 * 기존 single-Tower 호출자를 TowerGroupState의 primary compatibility view로
 * 연결합니다. HP/Share/event state는 이 adapter가 아니라 TowerGroupState만 소유합니다.
 */
export class TowerCombatRoster {
    constructor(options = {}) {
        if (options?.towerGroupState !== undefined
            && !(options.towerGroupState instanceof TowerGroupState)) {
            throw new TypeError('towerGroupState는 TowerGroupState여야 합니다.');
        }
        this.towerGroupState = options?.towerGroupState
            ?? new TowerGroupState(options);
        this.ownsTowerGroupState = options?.towerGroupState === undefined;
        this.destroyed = false;
        Object.seal(this);
    }

    getTowerGroupState() {
        this.#assertUsable();
        return this.towerGroupState;
    }

    bindGpuBody(handle, protocol) {
        this.#assertUsable();
        const primary = this.towerGroupState.getPrimaryTowerRecord();
        if (!primary) {
            throw new Error('살아 있는 primary Tower가 없습니다.');
        }
        return this.towerGroupState.bindGpuBody(
            primary.logicalTowerId,
            handle,
            protocol
        );
    }

    releaseGpuBinding() {
        if (this.destroyed) return false;
        return this.towerGroupState.releaseGpuBindings() > 0;
    }

    commitCompletedEvents(snapshot, registry) {
        this.#assertUsable();
        return toCompatibilityFacts(
            this.towerGroupState.commitCompletedEvents(snapshot, registry)
        );
    }

    isPrimaryTowerAlive() {
        return !this.destroyed
            && this.towerGroupState.getLivingTowerCount() > 0;
    }

    getPrimaryTowerCurrentHp() {
        const primary = this.destroyed
            ? null
            : this.towerGroupState.getPrimaryTowerRecord();
        return primary?.currentHp ?? 0;
    }

    getLivingTowerCount() {
        return this.destroyed
            ? 0
            : this.towerGroupState.getLivingTowerCount();
    }

    getLastCommittedFacts() {
        return this.destroyed
            ? EMPTY_FACTS
            : toCompatibilityFacts(
                this.towerGroupState.getLastCommittedFacts()
            );
    }

    getStatus() {
        const group = this.destroyed
            ? null
            : this.towerGroupState.getStatus();
        const primary = group?.primaryTower ?? null;
        return Object.freeze({
            logicalTowerId:
                primary?.logicalTowerId ?? PRIMARY_TOWER_LOGICAL_ID,
            alive: !this.destroyed && group?.livingTowerCount > 0,
            livingTowerCount: group?.livingTowerCount ?? 0,
            maxHp: primary?.maxHp ?? 0,
            currentHp: primary?.currentHp ?? 0,
            maxHpFixedPoint: primary?.maxHpFixedPoint ?? 0,
            currentHpFixedPoint: primary?.currentHpFixedPoint ?? 0,
            power: primary?.power ?? 0,
            powerFixedPoint: primary?.powerFixedPoint ?? 0,
            shareUnits: primary?.shareUnits ?? 0,
            livingShareUnits: group?.livingShareUnits ?? 0,
            lostShareUnits: group?.lostShareUnits ?? 0,
            groupRevision: group?.groupRevision ?? 0,
            boundGpuBody: primary?.exactGpuBinding ?? null,
            lastCommittedDamage: group?.lastCommittedDamage ?? null,
            lastCommittedDeath: group?.lastCommittedDeath ?? null,
            lastCommittedFacts: toCompatibilityFacts(
                group?.lastCommittedFacts
            ),
            destroyed: this.destroyed
        });
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        if (this.ownsTowerGroupState) {
            this.towerGroupState.destroy();
        }
        this.towerGroupState = null;
    }

    #assertUsable() {
        if (this.destroyed || !this.towerGroupState) {
            throw new Error('destroy된 TowerCombatRoster는 사용할 수 없습니다.');
        }
    }
}

export {
    PRIMARY_TOWER_LOGICAL_ID,
    TOWER_COMBAT_FACT_TYPE,
    TowerGroupState
};
