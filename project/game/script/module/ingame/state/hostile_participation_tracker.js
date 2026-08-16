import { GAMEPLAY_TEAM_ID } from '../contract/gameplay_team_contract.js';

function nonNegativeFinite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function nonNegativeInteger(value, fallback = 0) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function isHostileEnemyView(view) {
    return view?.kindId === 'enemy'
        && view.metadata?.teamId === GAMEPLAY_TEAM_ID.HOSTILE
        && view.metadata?.countsTowardHostile !== false;
}

function siegeWeightOf(metadata) {
    if (metadata?.countsTowardSiege === false) return 0;
    return nonNegativeFinite(metadata?.siegeWeight ?? metadata?.weight, 0);
}

/**
 * Lifecycle/publication 경계에서 registry를 aggregate-only로 집계합니다. 개별 actor
 * view는 scratch에서만 사용하며 HUD용 roster나 per-Enemy 객체를 보관하지 않습니다.
 */
export class HostileParticipationTracker {
    constructor() {
        this.handleScratch = [];
        this.viewScratch = {};
        this.revision = 0;
        this.snapshot = this.#emptySnapshot();
        this.destroyed = false;
    }

    refresh(registry, pending = {}) {
        if (this.destroyed) return this.snapshot;
        if (!registry
            || typeof registry.copyActiveHandlesInto !== 'function'
            || typeof registry.copyEntityView !== 'function'
            || typeof registry.getRevision !== 'function') {
            throw new TypeError('Hostile tracker에 WorldRegistry가 필요합니다.');
        }
        registry.copyActiveHandlesInto(this.handleScratch, { kindId: 'enemy' });
        let liveHostileActorCount = 0;
        let liveSiegeWeight = 0;
        let liveSentenceCreatedCount = 0;
        for (const handle of this.handleScratch) {
            const view = registry.copyEntityView(handle, this.viewScratch);
            if (!isHostileEnemyView(view)) continue;
            liveHostileActorCount++;
            liveSiegeWeight += siegeWeightOf(view.metadata);
            if (view.metadata?.creationOrigin === 'PLAYER_SENTENCE') {
                liveSentenceCreatedCount++;
            }
        }
        const pendingHostileActorCount = nonNegativeInteger(
            pending.pendingHostileActorCount
        );
        const pendingSiegeWeight = nonNegativeFinite(
            pending.pendingSiegeWeight
        );
        const pendingSentenceCreatedCount = nonNegativeInteger(
            pending.pendingSentenceCreatedCount
        );
        this.revision++;
        this.snapshot = Object.freeze({
            revision: this.revision,
            registryRevision: registry.getRevision(),
            liveHostileActorCount,
            pendingHostileActorCount,
            hostileActorCount:
                liveHostileActorCount + pendingHostileActorCount,
            liveSiegeWeight,
            pendingSiegeWeight,
            siegeWeight: liveSiegeWeight + pendingSiegeWeight,
            liveSentenceCreatedCount,
            pendingSentenceCreatedCount,
            sentenceCreatedCount:
                liveSentenceCreatedCount + pendingSentenceCreatedCount,
            perEnemyUiObjectCount: 0
        });
        return this.snapshot;
    }

    reset() {
        if (this.destroyed) return false;
        this.handleScratch.length = 0;
        this.revision++;
        this.snapshot = this.#emptySnapshot();
        return true;
    }

    getStatus() {
        return this.snapshot;
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.handleScratch.length = 0;
        this.snapshot = this.#emptySnapshot();
    }

    #emptySnapshot() {
        return Object.freeze({
            revision: this.revision,
            registryRevision: 0,
            liveHostileActorCount: 0,
            pendingHostileActorCount: 0,
            hostileActorCount: 0,
            liveSiegeWeight: 0,
            pendingSiegeWeight: 0,
            siegeWeight: 0,
            liveSentenceCreatedCount: 0,
            pendingSentenceCreatedCount: 0,
            sentenceCreatedCount: 0,
            perEnemyUiObjectCount: 0
        });
    }
}
