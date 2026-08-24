import {
    WAVE_OVERTIME_DAMAGE_BASIS,
    createWaveResolutionProfile,
    createWaveResolutionProfileCatalog
} from 'ingame/contract/wave_resolution_contract.js';

export const R9_WAVE_RESOLUTION_PROFILE_ID = Object.freeze({
    CORRIDOR_PRODUCTION: 'r9-corridor-production-resolution',
    R2_SHOWCASE_PRODUCTION: 'r9-r2-showcase-production-resolution',
    PERFORMANCE_PRODUCTION: 'r9-performance-production-resolution',
    QA_NORMAL: 'r9-qa-normal-resolution',
    QA_OVERTIME: 'r9-qa-overtime-resolution',
    QA_FINAL: 'r9-qa-final-resolution'
});

// PLAYTEST_TUNING_REQUIRED: R9 mechanics acceptance용 provisional production
// 수치입니다. 모든 runtime consumer는 이 named data만 읽습니다.
export const R9_PRODUCTION_WAVE_RESOLUTION_TUNING = Object.freeze({
    corridor: Object.freeze({
        combatDurationTicks: 3_600,
        completionGoldBonus: 75
    }),
    r2Showcase: Object.freeze({
        combatDurationTicks: 60_000,
        completionGoldBonus: 250
    }),
    performance: Object.freeze({
        combatDurationTicks: 12_000,
        completionGoldBonus: 0
    }),
    overtime: Object.freeze({
        graceTicks: 180,
        pulseIntervalTicks: 60,
        minimumDamageFixedPoint: 1_000,
        damagePerSiegeWeightNumerator: 250,
        damagePerSiegeWeightDenominator: 1_000,
        maximumDamageFixedPoint: 250_000
    })
});

// PLAYTEST_TUNING_REQUIRED: 짧은 injected QA 흐름용 값이며 production content
// selection에는 등록하지 않습니다.
export const R9_QA_WAVE_RESOLUTION_TUNING = Object.freeze({
    normalCombatDurationTicks: 300,
    overtimeCombatDurationTicks: 1,
    finalCombatDurationTicks: 300,
    graceTicks: 1,
    pulseIntervalTicks: 2,
    completionGoldBonus: 5,
    minimumDamageFixedPoint: 1_000,
    damagePerSiegeWeightNumerator: 250,
    damagePerSiegeWeightDenominator: 1_000,
    maximumDamageFixedPoint: 250_000
});

function createOvertime(tuning) {
    return {
        enabled: true,
        graceTicks: tuning.graceTicks,
        pulseIntervalTicks: tuning.pulseIntervalTicks,
        damageBasis: WAVE_OVERTIME_DAMAGE_BASIS.SIEGE_WEIGHT,
        minimumDamageFixedPoint: tuning.minimumDamageFixedPoint,
        damagePerSiegeWeightNumerator: tuning.damagePerSiegeWeightNumerator,
        damagePerSiegeWeightDenominator: tuning.damagePerSiegeWeightDenominator,
        maximumDamageFixedPoint: tuning.maximumDamageFixedPoint
    };
}

function createProfile({ profileId, combatDurationTicks, completionGoldBonus, overtime }) {
    return createWaveResolutionProfile({
        profileId,
        combatDurationTicks,
        requireAllHostilesCleared: true,
        overtime,
        settlement: {
            completionGoldBonus,
            openShop: true
        }
    });
}

export const R9_CORRIDOR_PRODUCTION_RESOLUTION_PROFILE = createProfile({
    profileId: R9_WAVE_RESOLUTION_PROFILE_ID.CORRIDOR_PRODUCTION,
    combatDurationTicks:
        R9_PRODUCTION_WAVE_RESOLUTION_TUNING.corridor.combatDurationTicks,
    completionGoldBonus:
        R9_PRODUCTION_WAVE_RESOLUTION_TUNING.corridor.completionGoldBonus,
    overtime: createOvertime(R9_PRODUCTION_WAVE_RESOLUTION_TUNING.overtime)
});

export const R9_R2_SHOWCASE_PRODUCTION_RESOLUTION_PROFILE = createProfile({
    profileId: R9_WAVE_RESOLUTION_PROFILE_ID.R2_SHOWCASE_PRODUCTION,
    combatDurationTicks:
        R9_PRODUCTION_WAVE_RESOLUTION_TUNING.r2Showcase.combatDurationTicks,
    completionGoldBonus:
        R9_PRODUCTION_WAVE_RESOLUTION_TUNING.r2Showcase.completionGoldBonus,
    overtime: createOvertime(R9_PRODUCTION_WAVE_RESOLUTION_TUNING.overtime)
});

export const R9_PERFORMANCE_PRODUCTION_RESOLUTION_PROFILE = createProfile({
    profileId: R9_WAVE_RESOLUTION_PROFILE_ID.PERFORMANCE_PRODUCTION,
    combatDurationTicks:
        R9_PRODUCTION_WAVE_RESOLUTION_TUNING.performance.combatDurationTicks,
    completionGoldBonus:
        R9_PRODUCTION_WAVE_RESOLUTION_TUNING.performance.completionGoldBonus,
    overtime: createOvertime(R9_PRODUCTION_WAVE_RESOLUTION_TUNING.overtime)
});

export const R9_QA_NORMAL_RESOLUTION_PROFILE = createProfile({
    profileId: R9_WAVE_RESOLUTION_PROFILE_ID.QA_NORMAL,
    combatDurationTicks:
        R9_QA_WAVE_RESOLUTION_TUNING.normalCombatDurationTicks,
    completionGoldBonus: R9_QA_WAVE_RESOLUTION_TUNING.completionGoldBonus,
    overtime: createOvertime(R9_QA_WAVE_RESOLUTION_TUNING)
});

export const R9_QA_OVERTIME_RESOLUTION_PROFILE = createProfile({
    profileId: R9_WAVE_RESOLUTION_PROFILE_ID.QA_OVERTIME,
    combatDurationTicks:
        R9_QA_WAVE_RESOLUTION_TUNING.overtimeCombatDurationTicks,
    completionGoldBonus: R9_QA_WAVE_RESOLUTION_TUNING.completionGoldBonus,
    overtime: createOvertime(R9_QA_WAVE_RESOLUTION_TUNING)
});

export const R9_QA_FINAL_RESOLUTION_PROFILE = createProfile({
    profileId: R9_WAVE_RESOLUTION_PROFILE_ID.QA_FINAL,
    combatDurationTicks:
        R9_QA_WAVE_RESOLUTION_TUNING.finalCombatDurationTicks,
    completionGoldBonus: R9_QA_WAVE_RESOLUTION_TUNING.completionGoldBonus * 2,
    overtime: createOvertime(R9_QA_WAVE_RESOLUTION_TUNING)
});

export const R9_WAVE_RESOLUTION_PROFILE_CATALOG
    = createWaveResolutionProfileCatalog([
        R9_CORRIDOR_PRODUCTION_RESOLUTION_PROFILE,
        R9_R2_SHOWCASE_PRODUCTION_RESOLUTION_PROFILE,
        R9_PERFORMANCE_PRODUCTION_RESOLUTION_PROFILE,
        R9_QA_NORMAL_RESOLUTION_PROFILE,
        R9_QA_OVERTIME_RESOLUTION_PROFILE,
        R9_QA_FINAL_RESOLUTION_PROFILE
    ]);

export const R9_WAVE_RESOLUTION_PROFILE_BY_ID
    = R9_WAVE_RESOLUTION_PROFILE_CATALOG.byId;
