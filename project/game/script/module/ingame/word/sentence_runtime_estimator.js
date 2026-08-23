import {
    GAMEPLAY_ALLEGIANCE_POLICY,
    GAMEPLAY_TEAM_ID
} from '../contract/gameplay_team_contract.js';
import {
    ACTOR_PAYLOAD_CODE,
    SUBJECT_SELECTOR_CODE
} from '../contract/word_sentence_contract.js';
import {
    ACTOR_ACTION_ACTIVATION_POLICY,
    ACTOR_ACTION_TRANSIT_POLICY
} from '../contract/actor_action_contract.js';
import {
    TOWER_GROUP_OPERATION_KIND
} from '../contract/tower_group_operation_contract.js';
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

function createActorActionPreview(compiledAbility) {
    const profile = compiledAbility?.actorActionProfile;
    if (!profile || typeof profile !== 'object') return null;
    const travelDurationFixedTicks = nonNegativeInteger(
        profile.travelDurationFixedTicks
    );
    const activationDelayFixedTicks = profile.activationPolicy
            === ACTOR_ACTION_ACTIVATION_POLICY.ON_LANDING
        ? travelDurationFixedTicks
        : 1;
    return Object.freeze({
        profileId: compiledAbility.actorActionProfileId ?? profile.id ?? null,
        profileFingerprint:
            compiledAbility.actorActionProfileFingerprint ?? null,
        spawnAnchorPolicy: profile.spawnAnchorPolicy ?? null,
        landingPolicy: profile.transit?.policy
                === ACTOR_ACTION_TRANSIT_POLICY.AIRBORNE_GROUND_PATH
            ? profile.placementPolicy ?? null
            : null,
        placementPolicy: profile.placementPolicy ?? null,
        activationPolicy: profile.activationPolicy ?? null,
        transitPolicy: profile.transit?.policy ?? null,
        travelDurationFixedTicks,
        activationDelayFixedTicks,
        launchSpeed: nonNegativeFinite(profile.launchSpeed),
        surfaceGap: nonNegativeFinite(profile.surfaceGap),
        summonLatticeSpacing: nonNegativeFinite(
            profile.summonLatticeSpacing
        ),
        presentationArcHeight: nonNegativeFinite(
            profile.presentationArcHeight
        )
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
        if (options.previewTowerMerge !== undefined
            && options.previewTowerMerge !== null
            && typeof options.previewTowerMerge !== 'function') {
            throw new TypeError('Tower Merge preview provider는 함수여야 합니다.');
        }
        this.getRuntimeState = options.getRuntimeState;
        this.previewTowerCreation = options.previewTowerCreation ?? null;
        this.previewTowerMerge = options.previewTowerMerge ?? null;
        this.destroyed = false;
    }

    estimate(compiledAbility, slotView = {}) {
        if (this.destroyed || !compiledAbility) return null;
        const runtime = this.getRuntimeState(compiledAbility) ?? {};
        if (compiledAbility.operationKind
            === TOWER_GROUP_OPERATION_KIND.MERGE) {
            return this.#estimateTowerMerge(
                compiledAbility,
                slotView,
                runtime
            );
        }
        const actorAction = createActorActionPreview(compiledAbility);
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
        const countExact = selectorCode === SUBJECT_SELECTOR_CODE.ENEMY
            ? hostileCount.known && runtime.hostileSubjectCountExact === true
            : selectorCode === SUBJECT_SELECTOR_CODE.TOWER
                ? towerCount.known && runtime.towerSubjectCountExact !== false
                : false;
        const eligibleTowerCount = readNonNegativeInteger(
            runtime.eligibleTowerActorCount
        );
        const eligibleHostileCount = readNonNegativeInteger(
            runtime.eligibleHostileActorCount
        );
        const generationEligibilityExact
            = selectorCode === SUBJECT_SELECTOR_CODE.TOWER
                ? eligibleTowerCount.known
                    && runtime.towerGenerationEligibilityExact === true
                : selectorCode === SUBJECT_SELECTOR_CODE.ENEMY
                    ? eligibleHostileCount.known
                        && runtime.hostileGenerationEligibilityExact === true
                    : false;
        // GPU-only generation eligibility를 CPU가 모르면 raw exact count를
        // conservative upper bound로 유지하고 그 비정확성을 별도 노출합니다.
        const eligibleSubjectCount = generationEligibilityExact
            ? Math.min(
                rawSubjectCount,
                selectorCode === SUBJECT_SELECTOR_CODE.TOWER
                    ? eligibleTowerCount.value
                    : eligibleHostileCount.value
            )
            : rawSubjectCount;
        const subjectBudget = nonNegativeInteger(
            compiledAbility.budgets?.subjectCount
        );
        const subjectBudgetExceeded = eligibleSubjectCount > subjectBudget;
        const previewSubjectCount = subjectBudgetExceeded
            ? 0
            : eligibleSubjectCount;
        const generatedBodyBudget = nonNegativeInteger(
            compiledAbility.budgets?.generatedBodyCount
        );
        const capacity = evaluateActorPayloadCapacity({
            requiredBodies: eligibleSubjectCount,
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
        let executionDisabledReason = !actorAction
            ? 'RUNTIME_UNAVAILABLE'
            : !countExact
            ? 'SUBJECT_COUNT_NOT_EXACT'
            : rawSubjectCount === 0
                || (generationEligibilityExact
                    && eligibleSubjectCount === 0)
                ? 'ZERO_SUBJECT'
                : subjectBudgetExceeded
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
            actorActionProfileFingerprint:
                compiledAbility.actorActionProfileFingerprint ?? null,
            targetSnapshotPolicy:
                compiledAbility.targetSnapshotPolicy ?? null,
            actorAction,
            spawnAnchorPolicy: actorAction?.spawnAnchorPolicy ?? null,
            landingPolicy: actorAction?.landingPolicy ?? null,
            placementPolicy: actorAction?.placementPolicy ?? null,
            activationPolicy: actorAction?.activationPolicy ?? null,
            transitPolicy: actorAction?.transitPolicy ?? null,
            travelDurationFixedTicks:
                actorAction?.travelDurationFixedTicks ?? 0,
            activationDelayFixedTicks:
                actorAction?.activationDelayFixedTicks ?? 0,
            payloadCode,
            generationLimit: nonNegativeInteger(
                compiledAbility.budgets?.generation
            ),
            generationEligibilityExact,
            eligibleSubjectCountExact:
                countExact && generationEligibilityExact,
            rawSubjectCountExact: countExact,
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
            requiredTowers: towerPayload ? capacity.requiredBodies : 0,
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
            towerDilution: towerPayload ? towerCreationPreview : null,
            towerCapacity: towerPayload
                ? towerCreationPreview?.capacity ?? null
                : null,
            towerShare: towerPayload && towerCreationPreview
                ? Object.freeze({
                    livingShareUnits:
                        towerCreationPreview.livingShareUnits ?? null,
                    lostShareUnits:
                        towerCreationPreview.lostShareUnits ?? null,
                    totalLivingCurrentHp:
                        towerCreationPreview.totalLivingCurrentHp ?? null
                })
                : null,
            towerAllocations: towerPayload && towerCreationPreview
                ? Object.freeze({
                    existing: towerCreationPreview.existing ?? null,
                    children: towerCreationPreview.children ?? null
                })
                : null,
            towerPlanExact: towerPayload
                ? towerCreationPreview !== null
                    && countExact
                    && generationEligibilityExact
                : null,
            placementExact: false,
            previewExact: false,
            dangerous,
            warningCode: dangerous
                ? towerPayload
                    ? 'TOWER_SHARE_DILUTION'
                    : 'HOSTILE_SIEGE_GROWTH'
                : null,
            executionEnabled: executionDisabledReason === null,
            executionDisabledReason,
            blockedReason: executionDisabledReason
        });
    }

    #estimateTowerMerge(compiledAbility, slotView, runtime) {
        const towerCount = readNonNegativeInteger(runtime.livingTowerCount);
        const countExact = towerCount.known
            && runtime.towerSubjectCountExact !== false;
        const cooldownRemainingTicks = nonNegativeInteger(
            slotView.cooldown?.remainingTicks
        );
        let preview = null;
        if (this.previewTowerMerge) {
            try {
                preview = this.previewTowerMerge({
                    compiledOperation: compiledAbility,
                    requestedFixedTick: Math.max(
                        1,
                        nonNegativeInteger(runtime.nextFixedTick, 1)
                    )
                });
            } catch {
                preview = null;
            }
        }
        const sourceCount = nonNegativeInteger(
            preview?.sourceCount,
            towerCount.value
        );
        const previewExact = preview !== null
            && countExact
            && sourceCount === towerCount.value;
        const survivorHandle = preview?.survivor?.exactGpuBinding
            ? Object.freeze({
                entityId: Number(
                    preview.survivor.exactGpuBinding.entityId
                ),
                incarnation: Number(
                    preview.survivor.exactGpuBinding.incarnation
                )
            })
            : null;
        const survivor = preview?.survivor
            ? Object.freeze({
                logicalTowerId:
                    preview.survivor.logicalTowerId ?? null,
                logicalTowerOrdinal:
                    preview.survivor.logicalTowerOrdinal ?? null,
                exactGpuBinding: survivorHandle
            })
            : null;
        const mergeSnapshot = preview === null
            ? null
            : Object.freeze({
                sourceCount,
                result: preview.result ?? null,
                reason: preview.reason ?? null,
                survivor,
                livingShareUnits:
                    preview.livingShareUnits ?? null,
                lostShareUnits: preview.lostShareUnits ?? null,
                currentHpFixedPoint:
                    preview.currentHpFixedPoint ?? null,
                maxHpFixedPoint: preview.maxHpFixedPoint ?? null,
                powerFixedPoint: preview.powerFixedPoint ?? null
            });
        const executionDisabledReason = cooldownRemainingTicks > 0
            ? 'COOLDOWN_ACTIVE'
            : !countExact
                ? 'SUBJECT_COUNT_NOT_EXACT'
                : preview === null
                    ? 'RUNTIME_UNAVAILABLE'
                    : preview.executionEnabled === true
                        ? null
                        : preview.reason ?? 'RUNTIME_UNAVAILABLE';
        const consolidationWarning = sourceCount >= 2;
        const resultingTowerCount = previewExact && survivor !== null
            ? 1
            : sourceCount;
        return Object.freeze({
            formulaId: compiledAbility.previewFormulaId,
            actorActionProfileId: null,
            actorActionProfileFingerprint: null,
            targetSnapshotPolicy:
                compiledAbility.subjectSelector?.snapshotPolicy ?? null,
            actorAction: null,
            spawnAnchorPolicy: null,
            landingPolicy: null,
            placementPolicy: null,
            activationPolicy: null,
            transitPolicy: null,
            travelDurationFixedTicks: 0,
            activationDelayFixedTicks: 0,
            payloadCode: null,
            generationLimit: 0,
            generationEligibilityExact: true,
            eligibleSubjectCountExact: countExact,
            rawSubjectCountExact: countExact,
            rawSubjectCount: sourceCount,
            eligibleSubjectCount: sourceCount,
            previewSubjectCount: sourceCount,
            subjectBudget: nonNegativeInteger(
                compiledAbility.budgets?.subjectCount
            ),
            countExact,
            subjectCount: sourceCount,
            newEnemyCount: 0,
            newTowerCount: 0,
            currentTowerCount: towerCount.value,
            resultingTowerCount,
            resultingHostileCount: nonNegativeInteger(
                runtime.liveHostileActorCount
            ) + nonNegativeInteger(runtime.pendingHostileActorCount),
            potentialBounty: 0,
            siegeWeightBefore: nonNegativeFinite(runtime.siegeWeight),
            siegeWeightAfter: nonNegativeFinite(runtime.siegeWeight),
            requiredBodies: 0,
            requiredTowers: 0,
            availableBodies: nonNegativeInteger(runtime.bodyAvailable),
            registryAvailable: nonNegativeInteger(
                runtime.registryAvailable
            ),
            bodyAvailable: nonNegativeInteger(runtime.bodyAvailable),
            cooldownTicks: compiledAbility.cooldownTicks,
            cooldownRemainingTicks,
            allegiance: Object.freeze({
                teamId: GAMEPLAY_TEAM_ID.PLAYER,
                policy: GAMEPLAY_ALLEGIANCE_POLICY.FIXED_PLAYER
            }),
            capacityValidity: Object.freeze({
                valid: true,
                requiredBodies: 0,
                availableBodies: nonNegativeInteger(runtime.bodyAvailable),
                registryAvailable: nonNegativeInteger(
                    runtime.registryAvailable
                ),
                bodyAvailable: nonNegativeInteger(runtime.bodyAvailable),
                generatedBodyBudget: 0
            }),
            towerCreationPreview: null,
            towerDilution: null,
            towerCapacity: null,
            towerShare: mergeSnapshot
                ? Object.freeze({
                    livingShareUnits: mergeSnapshot.livingShareUnits,
                    lostShareUnits: mergeSnapshot.lostShareUnits,
                    totalLivingCurrentHp:
                        mergeSnapshot.currentHpFixedPoint
                })
                : null,
            towerAllocations: null,
            towerMergePreview: mergeSnapshot,
            towerPlanExact: previewExact,
            placementExact: null,
            previewExact,
            dangerous: consolidationWarning,
            warningCode: consolidationWarning
                ? 'TOWER_MERGE_CONSOLIDATION'
                : null,
            executionEnabled: executionDisabledReason === null,
            executionDisabledReason,
            blockedReason: executionDisabledReason
        });
    }

    destroy() {
        this.destroyed = true;
        this.getRuntimeState = null;
        this.previewTowerCreation = null;
        this.previewTowerMerge = null;
    }
}
