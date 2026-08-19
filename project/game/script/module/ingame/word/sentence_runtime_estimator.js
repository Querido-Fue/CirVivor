import {
    GAMEPLAY_ALLEGIANCE_POLICY,
    GAMEPLAY_TEAM_ID
} from '../contract/gameplay_team_contract.js';
import {
    ACTOR_PAYLOAD_CODE,
    SUBJECT_SELECTOR_CODE
} from '../contract/word_sentence_contract.js';
import { evaluateActorPayloadCapacity } from './actor_payload_budget.js';

function nonNegativeInteger(value, fallback = 0) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function nonNegativeFinite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function readNonNegativeInteger(value) {
    const number = typeof value === 'number' ? value : Number.NaN;
    const known = Number.isSafeInteger(number) && number >= 0;
    return Object.freeze({
        known,
        value: known ? number : 0
    });
}

/** Immutable runtime-shared Enemy/Tower actor-payload preview provider입니다. */
export class SentenceRuntimeEstimator {
    constructor(options = {}) {
        if (typeof options.getRuntimeState !== 'function') {
            throw new TypeError('SentenceRuntimeEstimator runtime state provider가 필요합니다.');
        }
        if (options.previewTowerCreation !== undefined
            && options.previewTowerCreation !== null
            && typeof options.previewTowerCreation !== 'function') {
            throw new TypeError('Tower creation preview provider는 함수여야 합니다.');
        }
        this.getRuntimeState = options.getRuntimeState;
        this.previewTowerCreation = options.previewTowerCreation ?? null;
        this.destroyed = false;
    }

    estimate(compiledAbility, slotView = {}) {
        if (this.destroyed || !compiledAbility) return null;
        const runtime = this.getRuntimeState() ?? {};
        const selectorCode = compiledAbility.subjectSelector?.code;
        const towerCount = readNonNegativeInteger(runtime.livingTowerCount);
        const hostileCount = readNonNegativeInteger(
            runtime.liveHostileActorCount
        );
        const rawSubjectCount = selectorCode === SUBJECT_SELECTOR_CODE.TOWER
            ? towerCount.value
            : selectorCode === SUBJECT_SELECTOR_CODE.ENEMY
                ? hostileCount.value
                : 0;
        const subjectBudget = nonNegativeInteger(
            compiledAbility.budgets?.subjectCount
        );
        const subjectBudgetExceeded = rawSubjectCount > subjectBudget;
        const countExact = selectorCode === SUBJECT_SELECTOR_CODE.ENEMY
            ? hostileCount.known && runtime.hostileSubjectCountExact === true
            : selectorCode === SUBJECT_SELECTOR_CODE.TOWER
                ? towerCount.known && runtime.towerSubjectCountExact !== false
                : false;
        // Enemy generation eligibility is GPU-owned. Until that aggregate is
        // available, preview uses the raw count as a conservative upper bound.
        const eligibleSubjectCount = rawSubjectCount;
        const previewSubjectCount = subjectBudgetExceeded
            ? 0
            : eligibleSubjectCount;
        const generatedBodyBudget = nonNegativeInteger(
            compiledAbility.budgets?.generatedBodyCount
        );
        const capacity = evaluateActorPayloadCapacity({
            requiredBodies: rawSubjectCount,
            registryAvailable: nonNegativeInteger(runtime.registryAvailable),
            bodyAvailable: nonNegativeInteger(runtime.bodyAvailable),
            generatedBodyBudget
        });
        const liveHostileActorCount = nonNegativeInteger(
            runtime.liveHostileActorCount
        );
        const pendingHostileActorCount = nonNegativeInteger(
            runtime.pendingHostileActorCount
        );
        const hostileBefore = liveHostileActorCount
            + pendingHostileActorCount;
        const bountyPerEnemy = nonNegativeInteger(runtime.bountyPerEnemy);
        const siegeWeightPerEnemy = nonNegativeFinite(
            runtime.siegeWeightPerEnemy
        );
        const siegeWeightBefore = nonNegativeFinite(runtime.siegeWeight);
        const cooldownRemainingTicks = nonNegativeInteger(
            slotView.cooldown?.remainingTicks
        );
        const dangerThreshold = nonNegativeInteger(
            runtime.dangerThreshold,
            32
        );
        const payloadCode = compiledAbility.payloadCode
            ?? ACTOR_PAYLOAD_CODE.ENEMY;
        const towerPayload = payloadCode === ACTOR_PAYLOAD_CODE.TOWER;
        const resultingHostileCount = hostileBefore
            + (towerPayload ? 0 : previewSubjectCount);
        const resultingTowerCount = towerCount.value
            + (towerPayload ? previewSubjectCount : 0);
        const dangerous = towerPayload
            ? previewSubjectCount > 0
            : resultingHostileCount > dangerThreshold;
        let executionDisabledReason = subjectBudgetExceeded
            ? 'SUBJECT_BUDGET_EXCEEDED'
            : cooldownRemainingTicks > 0
                ? 'COOLDOWN_ACTIVE'
                : !capacity.valid
                    ? 'DESTINATION_CAPACITY_EXCEEDED'
                    : null;
        let towerCreationPreview = null;
        if (towerPayload && executionDisabledReason === null
            && previewSubjectCount > 0) {
            if (!countExact) {
                executionDisabledReason = 'SUBJECT_COUNT_NOT_EXACT';
            } else if (!this.previewTowerCreation) {
                executionDisabledReason = 'TOWER_CREATION_PREVIEW_UNAVAILABLE';
            } else {
                try {
                    towerCreationPreview = this.previewTowerCreation({
                        childCount: previewSubjectCount
                    });
                } catch {
                    towerCreationPreview = null;
                }
                if (!towerCreationPreview) {
                    executionDisabledReason
                        = 'TOWER_CREATION_PREVIEW_UNAVAILABLE';
                } else if (towerCreationPreview.executionEnabled !== true) {
                    executionDisabledReason = towerCreationPreview.reason
                        ?? towerCreationPreview.result
                        ?? 'TOWER_CREATION_REJECTED';
                }
            }
        }
        const allegianceTeamId = towerPayload
            ? GAMEPLAY_TEAM_ID.PLAYER
            : GAMEPLAY_TEAM_ID.HOSTILE;
        const allegiancePolicy = compiledAbility.allegiancePolicy
            ?? (towerPayload
                ? GAMEPLAY_ALLEGIANCE_POLICY.FIXED_PLAYER
                : GAMEPLAY_ALLEGIANCE_POLICY.FIXED_HOSTILE);
        return Object.freeze({
            formulaId: compiledAbility.previewFormulaId,
            actorActionProfileId:
                compiledAbility.actorActionProfileId ?? null,
            targetSnapshotPolicy:
                compiledAbility.targetSnapshotPolicy ?? null,
            payloadCode,
            rawSubjectCount,
            eligibleSubjectCount,
            previewSubjectCount,
            subjectBudget,
            countExact,
            subjectCount: previewSubjectCount,
            newEnemyCount: towerPayload ? 0 : previewSubjectCount,
            newTowerCount: towerPayload ? previewSubjectCount : 0,
            currentTowerCount: towerCount.value,
            resultingTowerCount,
            resultingHostileCount,
            potentialBounty: towerPayload
                ? 0
                : previewSubjectCount * bountyPerEnemy,
            siegeWeightBefore,
            siegeWeightAfter:
                siegeWeightBefore + (towerPayload
                    ? 0
                    : previewSubjectCount * siegeWeightPerEnemy),
            requiredBodies: capacity.requiredBodies,
            availableBodies: capacity.availableBodies,
            registryAvailable: capacity.registryAvailable,
            bodyAvailable: capacity.bodyAvailable,
            cooldownTicks: compiledAbility.cooldownTicks,
            cooldownRemainingTicks,
            allegiance: Object.freeze({
                teamId: allegianceTeamId,
                policy: allegiancePolicy
            }),
            capacityValidity: capacity,
            towerCreationPreview,
            placementExact: false,
            previewExact: false,
            dangerous,
            warningCode: dangerous
                ? towerPayload
                    ? 'TOWER_SHARE_DILUTION'
                    : 'HOSTILE_SIEGE_GROWTH'
                : null,
            executionEnabled: executionDisabledReason === null,
            executionDisabledReason
        });
    }

    destroy() {
        this.destroyed = true;
        this.getRuntimeState = null;
        this.previewTowerCreation = null;
    }
}
