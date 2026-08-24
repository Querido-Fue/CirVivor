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

function exactHandleKey(handle) {
    const entityId = handle?.entityId;
    const incarnation = handle?.incarnation;
    if (!Number.isSafeInteger(entityId) || entityId <= 0
        || !Number.isSafeInteger(incarnation) || incarnation <= 0) {
        return null;
    }
    return `${entityId}:${incarnation}`;
}

function contributionOf(view) {
    if (!isHostileEnemyView(view)) return null;
    const metadata = view.metadata;
    return Object.freeze({
        siegeWeight: metadata.countsTowardSiege === false
            ? 0
            : nonNegativeFinite(metadata.siegeWeight),
        bountyPotential: metadata.countsTowardBountyPotential === false
            ? 0
            : nonNegativeFinite(metadata.bountyBudget),
        sentenceCreatedCount: metadata.creationOrigin === 'PLAYER_SENTENCE' ? 1 : 0
    });
}

/**
 * Enemy lifecycle/publication delta를 exact handle 기준으로 집계합니다. 전체 registry
 * 순회는 초기화·복구용 reconcile에서만 허용하며 steady-state refresh는 O(changes)입니다.
 */
export class HostileParticipationTracker {
    constructor() {
        this.handleScratch = [];
        this.viewScratch = {};
        this.contributionByExactHandle = new Map();
        this.boundRegistry = null;
        this.reconciled = false;
        this.revision = 0;
        this.registryRevision = 0;
        this.fullReconcileCount = 0;
        this.incrementalRefreshCount = 0;
        this.lastRefreshUsedFullReconcile = false;
        this.liveHostileActorCount = 0;
        this.liveSiegeWeight = 0;
        this.liveBountyPotential = 0;
        this.liveSentenceCreatedCount = 0;
        this.pending = Object.freeze({
            hostileActorCount: 0,
            siegeWeight: 0,
            bountyPotential: 0,
            sentenceCreatedCount: 0
        });
        this.snapshot = this.#emptySnapshot();
        this.destroyed = false;
    }

    /** Compatibility entrypoint used by the object system. */
    refresh(registry, pending = {}, changes = {}) {
        if (this.destroyed) return this.snapshot;
        this.#assertRegistry(registry);
        if (!this.reconciled || this.boundRegistry !== registry || changes.reconcile === true) {
            this.reconcile(registry);
        } else {
            this.incrementalRefreshCount++;
            this.lastRefreshUsedFullReconcile = false;
            if (changes.lifecycle) {
                this.observeLifecycle(changes.lifecycle, registry, false);
            }
            if (Array.isArray(changes.publishedHandles)
                && changes.publishedHandles.length > 0) {
                this.observePublishedHandles(changes.publishedHandles, registry, false);
            }
        }
        this.#setPending(pending);
        return this.#publish(registry.getRevision());
    }

    /** One-time/debug reconciliation. This is the only full-registry scan. */
    reconcile(registry) {
        if (this.destroyed) return this.snapshot;
        this.#assertRegistry(registry);
        this.boundRegistry = registry;
        this.contributionByExactHandle.clear();
        this.liveHostileActorCount = 0;
        this.liveSiegeWeight = 0;
        this.liveBountyPotential = 0;
        this.liveSentenceCreatedCount = 0;
        registry.copyActiveHandlesInto(this.handleScratch, { kindId: 'enemy' });
        for (const handle of this.handleScratch) {
            this.#addExactHandle(handle, registry);
        }
        this.handleScratch.length = 0;
        this.reconciled = true;
        this.fullReconcileCount++;
        this.lastRefreshUsedFullReconcile = true;
        this.registryRevision = registry.getRevision();
        return this.snapshot;
    }

    /** Applies an idempotent lifecycle commit; despawns precede spawns for ABA safety. */
    observeLifecycle(commit, registry, publish = true) {
        if (this.destroyed) return this.snapshot;
        this.#assertRegistry(registry);
        if (!commit || typeof commit !== 'object') {
            throw new TypeError('Hostile tracker lifecycle commit이 필요합니다.');
        }
        for (const entry of commit.despawned ?? []) {
            this.#removeExactHandle(entry?.handle);
        }
        for (const entry of commit.spawned ?? []) {
            this.#addExactHandle(entry?.handle, registry);
        }
        this.registryRevision = nonNegativeInteger(
            commit.registryRevision,
            registry.getRevision()
        );
        return publish ? this.#publish(this.registryRevision) : this.snapshot;
    }

    /** Applies actor-payload activations that occur outside the lifecycle command owner. */
    observePublishedHandles(handles, registry, publish = true) {
        if (this.destroyed) return this.snapshot;
        this.#assertRegistry(registry);
        if (!Array.isArray(handles)) {
            throw new TypeError('publishedHandles는 배열이어야 합니다.');
        }
        for (const handle of handles) {
            this.#addExactHandle(handle, registry);
        }
        this.registryRevision = registry.getRevision();
        return publish ? this.#publish(this.registryRevision) : this.snapshot;
    }

    reset() {
        if (this.destroyed) return false;
        this.handleScratch.length = 0;
        this.contributionByExactHandle.clear();
        this.boundRegistry = null;
        this.reconciled = false;
        this.registryRevision = 0;
        this.liveHostileActorCount = 0;
        this.liveSiegeWeight = 0;
        this.liveBountyPotential = 0;
        this.liveSentenceCreatedCount = 0;
        this.pending = Object.freeze({
            hostileActorCount: 0,
            siegeWeight: 0,
            bountyPotential: 0,
            sentenceCreatedCount: 0
        });
        this.revision++;
        this.snapshot = this.#emptySnapshot();
        return true;
    }

    getStatus() {
        return this.snapshot;
    }

    destroy() {
        if (this.destroyed) return;
        this.reset();
        this.destroyed = true;
        this.snapshot = this.#emptySnapshot();
    }

    #assertRegistry(registry) {
        if (!registry
            || typeof registry.copyActiveHandlesInto !== 'function'
            || typeof registry.copyEntityView !== 'function'
            || typeof registry.getRevision !== 'function') {
            throw new TypeError('Hostile tracker에 WorldRegistry가 필요합니다.');
        }
    }

    #addExactHandle(handle, registry) {
        const key = exactHandleKey(handle);
        if (key === null || this.contributionByExactHandle.has(key)) return false;
        const view = registry.copyEntityView(handle, this.viewScratch);
        const contribution = contributionOf(view);
        if (contribution === null) return false;
        this.contributionByExactHandle.set(key, contribution);
        this.liveHostileActorCount++;
        this.liveSiegeWeight += contribution.siegeWeight;
        this.liveBountyPotential += contribution.bountyPotential;
        this.liveSentenceCreatedCount += contribution.sentenceCreatedCount;
        return true;
    }

    #removeExactHandle(handle) {
        const key = exactHandleKey(handle);
        if (key === null) return false;
        const contribution = this.contributionByExactHandle.get(key);
        if (!contribution) return false;
        this.contributionByExactHandle.delete(key);
        this.liveHostileActorCount--;
        this.liveSiegeWeight -= contribution.siegeWeight;
        this.liveBountyPotential -= contribution.bountyPotential;
        this.liveSentenceCreatedCount -= contribution.sentenceCreatedCount;
        return true;
    }

    #setPending(pending) {
        this.pending = Object.freeze({
            hostileActorCount: nonNegativeInteger(pending.pendingHostileActorCount),
            siegeWeight: nonNegativeFinite(pending.pendingSiegeWeight),
            bountyPotential: nonNegativeFinite(pending.pendingBountyPotential),
            sentenceCreatedCount: nonNegativeInteger(pending.pendingSentenceCreatedCount)
        });
    }

    #publish(registryRevision) {
        this.registryRevision = nonNegativeInteger(registryRevision, this.registryRevision);
        this.revision++;
        this.snapshot = Object.freeze({
            revision: this.revision,
            registryRevision: this.registryRevision,
            countExact: this.reconciled,
            liveHostileActorCount: this.liveHostileActorCount,
            pendingHostileActorCount: this.pending.hostileActorCount,
            hostileActorCount: this.liveHostileActorCount + this.pending.hostileActorCount,
            liveSiegeWeight: this.liveSiegeWeight,
            pendingSiegeWeight: this.pending.siegeWeight,
            siegeWeight: this.liveSiegeWeight + this.pending.siegeWeight,
            liveBountyPotential: this.liveBountyPotential,
            pendingBountyPotential: this.pending.bountyPotential,
            bountyPotential: this.liveBountyPotential + this.pending.bountyPotential,
            liveSentenceCreatedCount: this.liveSentenceCreatedCount,
            pendingSentenceCreatedCount: this.pending.sentenceCreatedCount,
            sentenceCreatedCount:
                this.liveSentenceCreatedCount + this.pending.sentenceCreatedCount,
            fullReconcileCount: this.fullReconcileCount,
            incrementalRefreshCount: this.incrementalRefreshCount,
            perTickRegistryScanCount:
                this.lastRefreshUsedFullReconcile ? 1 : 0,
            perEnemyUiObjectCount: 0
        });
        return this.snapshot;
    }

    #emptySnapshot() {
        return Object.freeze({
            revision: this.revision,
            registryRevision: this.registryRevision,
            countExact: false,
            liveHostileActorCount: 0,
            pendingHostileActorCount: 0,
            hostileActorCount: 0,
            liveSiegeWeight: 0,
            pendingSiegeWeight: 0,
            siegeWeight: 0,
            liveBountyPotential: 0,
            pendingBountyPotential: 0,
            bountyPotential: 0,
            liveSentenceCreatedCount: 0,
            pendingSentenceCreatedCount: 0,
            sentenceCreatedCount: 0,
            fullReconcileCount: this.fullReconcileCount,
            incrementalRefreshCount: this.incrementalRefreshCount,
            perTickRegistryScanCount:
                this.lastRefreshUsedFullReconcile ? 1 : 0,
            perEnemyUiObjectCount: 0
        });
    }
}
