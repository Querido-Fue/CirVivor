import { THE_TOWER_COMBAT_DATA } from 'data/object/tower/the_tower_data.js';
import {
    decodeGpuCircleBodyFixedPoint,
    encodeGpuCircleBodyFixedPoint
} from '../../physics/gpu/gpu_circle_body_abi.js';

const DEFAULT_EVENT_HISTORY_CAPACITY = 65536;
const EMPTY_FACTS = Object.freeze([]);

export const TOWER_COMBAT_FACT_TYPE = Object.freeze({
    DAMAGE_APPLIED: 'TowerDamageApplied',
    DIED: 'TowerDied',
    NO_LIVING_TOWERS: 'NoLivingTowers'
});

export const PRIMARY_TOWER_LOGICAL_ID = 'the-tower';

function requirePositiveSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0 || number >= 0xffffffff) {
        throw new RangeError(`${label}은 reserved sentinel보다 작은 양의 정수여야 합니다.`);
    }
    return number;
}

function requireNonNegativeSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
        throw new RangeError(`${label}은 0 이상의 안전한 정수여야 합니다.`);
    }
    return number;
}

function freezeHandle(source, label) {
    return Object.freeze({
        entityId: requirePositiveSafeInteger(source?.entityId, `${label}.entityId`),
        incarnation: requirePositiveSafeInteger(
            source?.incarnation,
            `${label}.incarnation`
        )
    });
}

function sameHandle(left, right) {
    return left?.entityId === right?.entityId
        && left?.incarnation === right?.incarnation;
}

function normalizeProtocol(source, label) {
    return Object.freeze({
        sessionGeneration: requirePositiveSafeInteger(
            source?.sessionGeneration,
            `${label}.sessionGeneration`
        ),
        deviceGeneration: requireNonNegativeSafeInteger(
            source?.deviceGeneration,
            `${label}.deviceGeneration`
        ),
        authoritativeEpoch: requireNonNegativeSafeInteger(
            source?.authoritativeEpoch,
            `${label}.authoritativeEpoch`
        )
    });
}

function matchesProtocol(event, binding) {
    return event?.sessionGeneration === binding.sessionGeneration
        && event?.deviceGeneration === binding.deviceGeneration
        && event?.authoritativeEpoch === binding.authoritativeEpoch;
}

function eventIdentity(event) {
    if (typeof event?.key === 'string' && event.key.length > 0) {
        return event.key;
    }
    return [
        event?.sessionGeneration,
        event?.deviceGeneration,
        event?.authoritativeEpoch,
        event?.entityId,
        event?.incarnation,
        event?.sourceTick,
        event?.sequence,
        event?.eventType
    ].join(':');
}

function snapshotSourceProvenance(registry, event) {
    if (typeof registry?.copyEntityView !== 'function') {
        return Object.freeze({
            producerId: null,
            sourceAbilityId: null,
            sourceTeamId: null
        });
    }
    const view = registry.copyEntityView({
        entityId: event.entityId,
        incarnation: event.incarnation
    }, {});
    return Object.freeze({
        producerId: view?.metadata?.producerId ?? null,
        sourceAbilityId: view?.metadata?.sourceAbilityId ?? null,
        sourceTeamId: view?.metadata?.teamId ?? null
    });
}

function freezeFactProtocol(event) {
    return {
        sessionGeneration: event.sessionGeneration,
        deviceGeneration: event.deviceGeneration,
        authoritativeEpoch: event.authoritativeEpoch,
        sourceTick: event.sourceTick,
        sequence: event.sequence,
        eventKey: eventIdentity(event)
    };
}

/**
 * GPU-authoritative Tower combat event를 bounded CPU run-domain view로 commit합니다.
 * 현재는 primary Tower 한 record만 생성하지만 API는 living-count/roster vocabulary를 유지합니다.
 */
export class TowerCombatRoster {
    constructor(options = {}) {
        const maxHp = Number(options.maxHp ?? THE_TOWER_COMBAT_DATA.MAX_HEALTH);
        if (!Number.isFinite(maxHp) || maxHp <= 0) {
            throw new RangeError('Tower maxHp는 양의 유한 숫자여야 합니다.');
        }
        const maxHpFixedPoint = encodeGpuCircleBodyFixedPoint(maxHp);
        const historyCapacity = Number(
            options.eventHistoryCapacity ?? DEFAULT_EVENT_HISTORY_CAPACITY
        );
        if (!Number.isSafeInteger(historyCapacity) || historyCapacity <= 0) {
            throw new RangeError('Tower event history capacity는 양의 정수여야 합니다.');
        }
        this.logicalTowerId = PRIMARY_TOWER_LOGICAL_ID;
        this.maxHpFixedPoint = maxHpFixedPoint;
        this.currentHpFixedPoint = maxHpFixedPoint;
        this.alive = true;
        this.binding = null;
        this.lastCommittedDamage = null;
        this.lastCommittedDeath = null;
        this.lastCommittedFacts = EMPTY_FACTS;
        this.lastCommittedSourceTick = 0;
        this.lastCommittedSequence = -1;
        this.eventHistoryCapacity = historyCapacity;
        this.knownEventKeys = new Set();
        this.eventKeyHistory = [];
        this.eventKeyHead = 0;
        this.destroyed = false;
    }

    /** 살아 있는 logical Tower를 replacement GPU exact body에 결합합니다. */
    bindGpuBody(handle, protocol) {
        this.#assertUsable();
        if (!this.alive || this.currentHpFixedPoint <= 0) {
            throw new Error('죽은 Tower는 GPU body에 다시 결합할 수 없습니다.');
        }
        const exactHandle = freezeHandle(handle, 'towerHandle');
        const exactProtocol = normalizeProtocol(protocol, 'towerProtocol');
        this.binding = Object.freeze({ ...exactHandle, ...exactProtocol });
        this.lastCommittedSourceTick = 0;
        this.lastCommittedSequence = -1;
        return this.binding;
    }

    /** GPU world 교체 시 combat HP/alive를 보존하고 stale exact binding만 폐기합니다. */
    releaseGpuBinding() {
        if (this.destroyed || !this.binding) {
            return false;
        }
        this.binding = null;
        this.lastCommittedSourceTick = 0;
        this.lastCommittedSequence = -1;
        return true;
    }

    /** contiguous endpoint snapshot에서 현재 exact Tower에 해당하는 typed fact만 commit합니다. */
    commitCompletedEvents(snapshot, registry) {
        this.#assertUsable();
        this.lastCommittedFacts = EMPTY_FACTS;
        const binding = this.binding;
        if (!binding || !Array.isArray(snapshot?.events) || snapshot.protocolFailure) {
            return this.lastCommittedFacts;
        }

        const facts = [];
        let towerDied = false;
        for (const event of snapshot.events) {
            const isDamage = event?.type === 'contact'
                && event?.eventType === 'damage-applied'
                && event?.disposition === 'applied'
                && sameHandle(event.other, binding);
            const isDeath = event?.type === 'death'
                && event?.eventType === 'death'
                && event?.disposition === 'despawn-requested'
                && sameHandle(event, binding);
            if ((!isDamage && !isDeath) || !matchesProtocol(event, binding)) {
                continue;
            }
            const sourceTick = Number(event.sourceTick);
            const sequence = Number(event.sequence);
            if (!Number.isSafeInteger(sourceTick) || sourceTick <= 0
                || !Number.isSafeInteger(sequence) || sequence < 0
                || sourceTick < this.lastCommittedSourceTick
                || (sourceTick === this.lastCommittedSourceTick
                    && sequence <= this.lastCommittedSequence)) {
                continue;
            }
            const key = eventIdentity(event);
            if (this.knownEventKeys.has(key)) {
                continue;
            }
            this.#rememberEventKey(key);
            this.lastCommittedSourceTick = sourceTick;
            this.lastCommittedSequence = sequence;

            if (isDamage) {
                const damageFixedPoint = Number(event.damageFixedPoint);
                if (!Number.isSafeInteger(damageFixedPoint)
                    || damageFixedPoint <= 0) {
                    continue;
                }
                this.currentHpFixedPoint = Math.max(
                    0,
                    this.currentHpFixedPoint - damageFixedPoint
                );
                const provenance = snapshotSourceProvenance(registry, event);
                const fact = Object.freeze({
                    type: TOWER_COMBAT_FACT_TYPE.DAMAGE_APPLIED,
                    logicalTowerId: this.logicalTowerId,
                    targetHandle: Object.freeze({
                        entityId: binding.entityId,
                        incarnation: binding.incarnation
                    }),
                    sourceHandle: Object.freeze({
                        entityId: event.entityId,
                        incarnation: event.incarnation
                    }),
                    ...provenance,
                    ...freezeFactProtocol(event),
                    damageFixedPoint,
                    damage: decodeGpuCircleBodyFixedPoint(damageFixedPoint),
                    currentHp: decodeGpuCircleBodyFixedPoint(
                        this.currentHpFixedPoint
                    ),
                    maxHp: decodeGpuCircleBodyFixedPoint(this.maxHpFixedPoint),
                    targetDied: event.reason === 'target-died'
                });
                this.lastCommittedDamage = fact;
                facts.push(fact);
                continue;
            }

            if (!this.alive) {
                continue;
            }
            this.alive = false;
            this.currentHpFixedPoint = 0;
            const previousDamageFact = this.lastCommittedDamage;
            const sourceFact = previousDamageFact?.targetDied
                && previousDamageFact.sessionGeneration === event.sessionGeneration
                && previousDamageFact.deviceGeneration === event.deviceGeneration
                && previousDamageFact.authoritativeEpoch === event.authoritativeEpoch
                && previousDamageFact.sourceTick === event.sourceTick
                ? previousDamageFact
                : null;
            const deathFact = Object.freeze({
                type: TOWER_COMBAT_FACT_TYPE.DIED,
                logicalTowerId: this.logicalTowerId,
                targetHandle: Object.freeze({
                    entityId: binding.entityId,
                    incarnation: binding.incarnation
                }),
                sourceHandle: sourceFact?.sourceHandle ?? null,
                producerId: sourceFact?.producerId ?? null,
                sourceAbilityId: sourceFact?.sourceAbilityId ?? null,
                sourceTeamId: sourceFact?.sourceTeamId ?? null,
                ...freezeFactProtocol(event),
                currentHp: 0,
                maxHp: decodeGpuCircleBodyFixedPoint(this.maxHpFixedPoint),
                reason: event.reason ?? null,
                reasonFlags: event.reasonFlags ?? event.flags ?? 0
            });
            this.lastCommittedDeath = deathFact;
            facts.push(deathFact);
            facts.push(Object.freeze({
                type: TOWER_COMBAT_FACT_TYPE.NO_LIVING_TOWERS,
                logicalTowerId: this.logicalTowerId,
                livingTowerCount: 0,
                ...freezeFactProtocol(event)
            }));
            towerDied = true;
        }

        if (towerDied) {
            this.binding = null;
        }
        this.lastCommittedFacts = facts.length > 0
            ? Object.freeze(facts)
            : EMPTY_FACTS;
        return this.lastCommittedFacts;
    }

    isPrimaryTowerAlive() {
        return !this.destroyed && this.alive;
    }

    getPrimaryTowerCurrentHp() {
        return decodeGpuCircleBodyFixedPoint(this.currentHpFixedPoint);
    }

    getLivingTowerCount() {
        return this.destroyed || !this.alive ? 0 : 1;
    }

    getLastCommittedFacts() {
        return this.lastCommittedFacts;
    }

    getStatus() {
        return Object.freeze({
            logicalTowerId: this.logicalTowerId,
            alive: !this.destroyed && this.alive,
            livingTowerCount: this.getLivingTowerCount(),
            maxHp: decodeGpuCircleBodyFixedPoint(this.maxHpFixedPoint),
            currentHp: decodeGpuCircleBodyFixedPoint(this.currentHpFixedPoint),
            maxHpFixedPoint: this.maxHpFixedPoint,
            currentHpFixedPoint: this.currentHpFixedPoint,
            boundGpuBody: this.binding,
            lastCommittedDamage: this.lastCommittedDamage,
            lastCommittedDeath: this.lastCommittedDeath,
            lastCommittedFacts: this.lastCommittedFacts,
            destroyed: this.destroyed
        });
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.binding = null;
        this.lastCommittedFacts = EMPTY_FACTS;
        this.knownEventKeys.clear();
        this.eventKeyHistory.length = 0;
        this.eventKeyHead = 0;
    }

    #rememberEventKey(key) {
        this.knownEventKeys.add(key);
        this.eventKeyHistory.push(key);
        while ((this.eventKeyHistory.length - this.eventKeyHead)
            > this.eventHistoryCapacity) {
            this.knownEventKeys.delete(this.eventKeyHistory[this.eventKeyHead++]);
        }
        if (this.eventKeyHead >= this.eventHistoryCapacity) {
            this.eventKeyHistory = this.eventKeyHistory.slice(this.eventKeyHead);
            this.eventKeyHead = 0;
        }
    }

    #assertUsable() {
        if (this.destroyed) {
            throw new Error('destroy된 TowerCombatRoster는 사용할 수 없습니다.');
        }
    }
}
