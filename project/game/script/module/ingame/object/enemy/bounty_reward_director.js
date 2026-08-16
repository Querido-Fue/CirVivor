import {
    ENEMY_LIFECYCLE_DISPOSITION_ID
} from '../../contract/enemy_lifecycle_disposition_contract.js';
import { GAMEPLAY_TEAM_ID } from '../../contract/gameplay_team_contract.js';
import {
    GPU_CIRCLE_APPLIED_EVENT_FLAG
} from '../../physics/gpu/gpu_circle_body_abi.js';

const DEFAULT_PROOF_HISTORY_CAPACITY = 65536;

function requirePositiveSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
        throw new RangeError(`${label}은 양의 안전한 정수여야 합니다.`);
    }
    return number;
}

function sameHandle(left, right) {
    return left?.entityId === right?.entityId
        && left?.incarnation === right?.incarnation;
}

function handleKey(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

function protocolKey(event) {
    return [
        event.sessionGeneration,
        event.deviceGeneration,
        event.authoritativeEpoch,
        event.sourceTick
    ].join(':');
}

function exactProtocol(left, right) {
    return left?.sessionGeneration === right?.sessionGeneration
        && left?.deviceGeneration === right?.deviceGeneration
        && left?.authoritativeEpoch === right?.authoritativeEpoch
        && left?.sourceTick === right?.sourceTick;
}

function isPlayerLethalDamage(event, registry) {
    if (event?.type !== 'contact'
        || event.eventType !== 'damage-applied'
        || event.disposition !== 'applied'
        || (event.flags & GPU_CIRCLE_APPLIED_EVENT_FLAG.TARGET_DIED) === 0
        || !event.other) {
        return null;
    }
    const source = registry.copyEntityView(event, {});
    const target = registry.copyEntityView(event.other, {});
    if (!source || !target
        || source.metadata?.teamId !== GAMEPLAY_TEAM_ID.PLAYER
        || target.kindId !== 'enemy'
        || target.metadata?.teamId !== GAMEPLAY_TEAM_ID.HOSTILE
        || target.metadata?.rewardEligible === false) {
        return null;
    }
    const bountyBudget = Number(target.metadata?.bountyBudget);
    if (!Number.isSafeInteger(bountyBudget)
        || bountyBudget < 0
        || bountyBudget > 0xffffffff) {
        return null;
    }
    return Object.freeze({ source, target, bountyBudget });
}

/**
 * Authentic lethal GPU event와 같은-boundary lifecycle PLAYER_KILL commit을 함께
 * 요구하는 CPU bounty authority입니다. 어느 한쪽 증거만으로는 Gold를 지급하지 않습니다.
 */
export class BountyRewardDirector {
    constructor(options = {}) {
        if (!options.goldLedger
            || typeof options.goldLedger.credit !== 'function'
            || typeof options.goldLedger.getBalance !== 'function') {
            throw new TypeError('BountyRewardDirector에 GoldLedger가 필요합니다.');
        }
        this.goldLedger = options.goldLedger;
        this.sessionGeneration = requirePositiveSafeInteger(
            options.sessionGeneration,
            'sessionGeneration'
        );
        this.proofHistoryCapacity = requirePositiveSafeInteger(
            options.proofHistoryCapacity ?? DEFAULT_PROOF_HISTORY_CAPACITY,
            'proofHistoryCapacity'
        );
        this.pendingClaimsByCommandId = new Map();
        this.knownProofKeys = new Set();
        this.proofOrder = [];
        this.settledCommandIds = new Set();
        this.settledOrder = [];
        this.totalPayout = 0;
        this.payoutCount = 0;
        this.rejectedProofCount = 0;
        this.lastPayout = null;
        this.failure = null;
        this.closed = false;
        this.destroyed = false;
    }

    observeCompletedEvents(snapshot, registry) {
        if (this.destroyed || this.closed || snapshot?.protocolFailure) {
            return Object.freeze({ accepted: false, stagedClaimCount: 0 });
        }
        if (!registry || typeof registry.copyEntityView !== 'function') {
            throw new TypeError('Bounty event 관찰에는 WorldRegistry가 필요합니다.');
        }
        const events = Array.isArray(snapshot?.events) ? snapshot.events : [];
        const deathsByTarget = new Map();
        for (const event of events) {
            if (event?.type !== 'death'
                || (event.disposition !== 'despawn-requested'
                    && event.disposition
                        !== 'projectile-capture-capacity-deferred')) {
                continue;
            }
            const key = handleKey(event);
            const list = deathsByTarget.get(key) ?? [];
            list.push(event);
            deathsByTarget.set(key, list);
        }
        let stagedClaimCount = 0;
        for (const event of events) {
            if (event?.sessionGeneration !== this.sessionGeneration) continue;
            const lethal = isPlayerLethalDamage(event, registry);
            if (!lethal) continue;
            const deaths = (deathsByTarget.get(handleKey(event.other)) ?? [])
                .filter((death) => exactProtocol(death, event));
            if (deaths.length !== 1) {
                this.rejectedProofCount++;
                continue;
            }
            const death = deaths[0];
            const proofKey = `${protocolKey(event)}:${event.key}:${death.key}`;
            if (this.knownProofKeys.has(proofKey)) continue;
            const deferred = death.disposition
                === 'projectile-capture-capacity-deferred';
            const commandId = deferred
                ? `gpu-death:projectile-capture-capacity:${death.key}`
                : `gpu-death:${death.key}`;
            const prior = this.pendingClaimsByCommandId.get(commandId);
            if (prior && prior.proofKey !== proofKey) {
                this.failure = Object.freeze({
                    code: 'bounty-command-proof-conflict',
                    message: '동일 lifecycle command에 서로 다른 lethal proof가 있습니다.'
                });
                continue;
            }
            this.#rememberProof(proofKey);
            this.pendingClaimsByCommandId.set(commandId, Object.freeze({
                commandId,
                proofKey,
                sessionGeneration: event.sessionGeneration,
                deviceGeneration: event.deviceGeneration,
                authoritativeEpoch: event.authoritativeEpoch,
                sourceTick: event.sourceTick,
                sourceHandle: Object.freeze({
                    entityId: event.entityId,
                    incarnation: event.incarnation
                }),
                targetHandle: Object.freeze({ ...event.other }),
                bountyBudget: lethal.bountyBudget
            }));
            stagedClaimCount++;
        }
        return Object.freeze({
            accepted: this.failure === null,
            stagedClaimCount,
            pendingClaimCount: this.pendingClaimsByCommandId.size,
            recoveryRequired: this.requiresRecovery()
        });
    }

    observeLifecycle(commit, fixedTick) {
        if (this.destroyed || !commit || commit.recoveryRequired === true) {
            return Object.freeze({ payoutCount: 0, payoutAmount: 0 });
        }
        let payoutCount = 0;
        let payoutAmount = 0;
        for (const despawned of commit.despawned ?? []) {
            const commandId = despawned?.commandId;
            if (this.settledCommandIds.has(commandId)) continue;
            const claim = this.pendingClaimsByCommandId.get(commandId);
            if (!claim) {
                if (despawned?.disposition
                    === ENEMY_LIFECYCLE_DISPOSITION_ID.PLAYER_KILL) {
                    this.rejectedProofCount++;
                }
                continue;
            }
            this.pendingClaimsByCommandId.delete(commandId);
            this.#rememberSettled(commandId);
            const exactPlayerKill = sameHandle(despawned.handle, claim.targetHandle)
                && despawned.disposition
                    === ENEMY_LIFECYCLE_DISPOSITION_ID.PLAYER_KILL
                && despawned.bountyEligible === true;
            if (!exactPlayerKill) continue;
            const credit = this.goldLedger.credit({
                transactionId: [
                    'enemy-bounty.r3',
                    claim.sessionGeneration,
                    claim.deviceGeneration,
                    claim.authoritativeEpoch,
                    commandId
                ].join(':'),
                amount: claim.bountyBudget,
                fixedTick,
                sourceKind: 'PLAYER_KILL',
                sourceEntityId: claim.sourceHandle.entityId,
                sourceIncarnation: claim.sourceHandle.incarnation,
                targetEntityId: claim.targetHandle.entityId,
                targetIncarnation: claim.targetHandle.incarnation
            });
            if (credit.accepted !== true) continue;
            payoutCount++;
            payoutAmount += claim.bountyBudget;
            this.payoutCount++;
            this.totalPayout += claim.bountyBudget;
            this.lastPayout = Object.freeze({
                commandId,
                amount: claim.bountyBudget,
                fixedTick,
                sourceHandle: claim.sourceHandle,
                targetHandle: claim.targetHandle,
                gold: credit.balance
            });
        }
        for (const rejected of commit.rejected ?? []) {
            const commandId = rejected?.commandId;
            if (!this.pendingClaimsByCommandId.has(commandId)) continue;
            this.pendingClaimsByCommandId.delete(commandId);
            this.#rememberSettled(commandId);
        }
        return Object.freeze({
            payoutCount,
            payoutAmount,
            pendingClaimCount: this.pendingClaimsByCommandId.size,
            gold: this.goldLedger.getBalance(),
            recoveryRequired: this.requiresRecovery()
        });
    }

    resetGpuBinding(sessionGeneration) {
        if (this.destroyed) return false;
        this.sessionGeneration = requirePositiveSafeInteger(
            sessionGeneration,
            'sessionGeneration'
        );
        this.pendingClaimsByCommandId.clear();
        this.knownProofKeys.clear();
        this.proofOrder.length = 0;
        this.failure = null;
        this.closed = false;
        return true;
    }

    closeForTerminal() {
        if (this.destroyed || this.closed) return false;
        this.closed = true;
        return true;
    }

    requiresRecovery() {
        return this.failure !== null;
    }

    getStatus() {
        return Object.freeze({
            sessionGeneration: this.sessionGeneration,
            gold: this.goldLedger?.getBalance() ?? 0,
            pendingClaimCount: this.pendingClaimsByCommandId.size,
            payoutCount: this.payoutCount,
            totalPayout: this.totalPayout,
            rejectedProofCount: this.rejectedProofCount,
            lastPayout: this.lastPayout,
            recoveryRequired: this.requiresRecovery(),
            failure: this.failure,
            closed: this.closed,
            destroyed: this.destroyed
        });
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.closed = true;
        this.pendingClaimsByCommandId.clear();
        this.knownProofKeys.clear();
        this.proofOrder.length = 0;
        this.settledCommandIds.clear();
        this.settledOrder.length = 0;
        this.goldLedger = null;
    }

    #rememberProof(proofKey) {
        this.knownProofKeys.add(proofKey);
        this.proofOrder.push(proofKey);
        while (this.proofOrder.length > this.proofHistoryCapacity) {
            this.knownProofKeys.delete(this.proofOrder.shift());
        }
    }

    #rememberSettled(commandId) {
        this.settledCommandIds.add(commandId);
        this.settledOrder.push(commandId);
        while (this.settledOrder.length > this.proofHistoryCapacity) {
            this.settledCommandIds.delete(this.settledOrder.shift());
        }
    }
}
