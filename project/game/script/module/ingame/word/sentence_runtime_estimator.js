import {
    GAMEPLAY_ALLEGIANCE_POLICY,
    GAMEPLAY_TEAM_ID
} from '../contract/gameplay_team_contract.js';
import { SUBJECT_SELECTOR_CODE } from '../contract/word_sentence_contract.js';
import { evaluateActorPayloadCapacity } from './actor_payload_budget.js';

function nonNegativeInteger(value, fallback = 0) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function nonNegativeFinite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
}

/** Immutable runtime-shared Enemy sentence preview provider입니다. */
export class SentenceRuntimeEstimator {
    constructor(options = {}) {
        if (typeof options.getRuntimeState !== 'function') {
            throw new TypeError('SentenceRuntimeEstimator runtime state provider가 필요합니다.');
        }
        this.getRuntimeState = options.getRuntimeState;
        this.destroyed = false;
    }

    estimate(compiledAbility, slotView = {}) {
        if (this.destroyed || !compiledAbility) return null;
        const runtime = this.getRuntimeState() ?? {};
        const selectorCode = compiledAbility.subjectSelector?.code;
        const rawSubjectCount = selectorCode === SUBJECT_SELECTOR_CODE.TOWER
            ? nonNegativeInteger(runtime.livingTowerCount)
            : selectorCode === SUBJECT_SELECTOR_CODE.ENEMY
                ? nonNegativeInteger(runtime.liveHostileActorCount)
                : 0;
        const subjectCount = Math.min(
            rawSubjectCount,
            nonNegativeInteger(compiledAbility.budgets?.subjectCount)
        );
        const generatedBodyBudget = nonNegativeInteger(
            compiledAbility.budgets?.generatedBodyCount
        );
        const capacity = evaluateActorPayloadCapacity({
            requiredBodies: subjectCount,
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
        const resultingHostileCount = hostileBefore + subjectCount;
        const dangerous = resultingHostileCount > dangerThreshold;
        return Object.freeze({
            formulaId: compiledAbility.previewFormulaId,
            subjectCount,
            newEnemyCount: subjectCount,
            resultingHostileCount,
            potentialBounty: subjectCount * bountyPerEnemy,
            siegeWeightBefore,
            siegeWeightAfter:
                siegeWeightBefore + subjectCount * siegeWeightPerEnemy,
            requiredBodies: capacity.requiredBodies,
            availableBodies: capacity.availableBodies,
            registryAvailable: capacity.registryAvailable,
            bodyAvailable: capacity.bodyAvailable,
            cooldownTicks: compiledAbility.cooldownTicks,
            cooldownRemainingTicks,
            allegiance: Object.freeze({
                teamId: GAMEPLAY_TEAM_ID.HOSTILE,
                policy: GAMEPLAY_ALLEGIANCE_POLICY.FIXED_HOSTILE
            }),
            capacityValidity: capacity,
            dangerous,
            warningCode: dangerous ? 'HOSTILE_SIEGE_GROWTH' : null,
            executionEnabled: cooldownRemainingTicks === 0 && capacity.valid
        });
    }

    destroy() {
        this.destroyed = true;
        this.getRuntimeState = null;
    }
}
