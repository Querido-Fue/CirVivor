import { fingerprintR8Record } from './r8_fingerprint_contract.js';

export const WAVE_OVERTIME_DAMAGE_BASIS = Object.freeze({
    SIEGE_WEIGHT: 'SIEGE_WEIGHT'
});

export const WAVE_RESOLUTION_FIXED_POINT_SCALE = 1_000;

const PROFILE_KEYS = Object.freeze([
    'profileId',
    'combatDurationTicks',
    'requireAllHostilesCleared',
    'overtime',
    'settlement'
]);
const OVERTIME_KEYS = Object.freeze([
    'enabled',
    'graceTicks',
    'pulseIntervalTicks',
    'damageBasis',
    'minimumDamageFixedPoint',
    'damagePerSiegeWeightNumerator',
    'damagePerSiegeWeightDenominator',
    'maximumDamageFixedPoint'
]);
const SETTLEMENT_KEYS = Object.freeze([
    'completionGoldBonus',
    'openShop'
]);
const PROFILE_METADATA = new WeakMap();

function requireRecord(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label}은 record여야 합니다.`);
    }
    return value;
}

/**
 * Proxy/getter 입력을 canonical data로 한 번만 읽습니다. ownKeys와 각 known
 * property get은 정확히 한 번만 수행하므로 validation/fingerprint가 재실행하지
 * 않습니다.
 */
function materializeKnownRecord(value, expectedKeys, label) {
    const source = requireRecord(value, label);
    const ownKeys = Reflect.ownKeys(source);
    if (ownKeys.some((key) => typeof key !== 'string')) {
        throw new RangeError(`${label}에는 symbol key를 사용할 수 없습니다.`);
    }
    if (ownKeys.length !== expectedKeys.length
        || expectedKeys.some((key) => !ownKeys.includes(key))) {
        throw new RangeError(
            `${label}은 known keys만 가져야 합니다: ${expectedKeys.join(', ')}`
        );
    }
    const materialized = {};
    for (const key of expectedKeys) {
        materialized[key] = source[key];
    }
    return materialized;
}

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

function requireBoolean(value, label) {
    if (typeof value !== 'boolean') {
        throw new TypeError(`${label}은 boolean이어야 합니다.`);
    }
    return value;
}

function requireUint32(value, label, { positive = false } = {}) {
    if (!Number.isSafeInteger(value)
        || value < (positive ? 1 : 0)
        || value > 0xffff_ffff) {
        throw new RangeError(
            `${label}은 ${positive ? '양의 ' : ''}uint32여야 합니다.`
        );
    }
    return value;
}

function createFingerprintRecord(profile) {
    return {
        profileId: profile.profileId,
        combatDurationTicks: profile.combatDurationTicks,
        requireAllHostilesCleared: profile.requireAllHostilesCleared,
        overtime: {
            enabled: profile.overtime.enabled,
            graceTicks: profile.overtime.graceTicks,
            pulseIntervalTicks: profile.overtime.pulseIntervalTicks,
            damageBasis: profile.overtime.damageBasis,
            minimumDamageFixedPoint:
                profile.overtime.minimumDamageFixedPoint,
            damagePerSiegeWeightNumerator:
                profile.overtime.damagePerSiegeWeightNumerator,
            damagePerSiegeWeightDenominator:
                profile.overtime.damagePerSiegeWeightDenominator,
            maximumDamageFixedPoint:
                profile.overtime.maximumDamageFixedPoint
        },
        settlement: {
            completionGoldBonus: profile.settlement.completionGoldBonus,
            openShop: profile.settlement.openShop
        }
    };
}

export function createWaveResolutionProfile(source) {
    const profile = materializeKnownRecord(source, PROFILE_KEYS, 'WaveResolutionProfile');
    const overtime = materializeKnownRecord(
        profile.overtime,
        OVERTIME_KEYS,
        'WaveResolutionProfile.overtime'
    );
    const settlement = materializeKnownRecord(
        profile.settlement,
        SETTLEMENT_KEYS,
        'WaveResolutionProfile.settlement'
    );

    const normalizedOvertime = Object.freeze({
        enabled: requireBoolean(overtime.enabled, 'overtime.enabled'),
        graceTicks: requireUint32(overtime.graceTicks, 'overtime.graceTicks'),
        pulseIntervalTicks: requireUint32(
            overtime.pulseIntervalTicks,
            'overtime.pulseIntervalTicks',
            { positive: true }
        ),
        damageBasis: requireNonEmptyString(
            overtime.damageBasis,
            'overtime.damageBasis'
        ),
        minimumDamageFixedPoint: requireUint32(
            overtime.minimumDamageFixedPoint,
            'overtime.minimumDamageFixedPoint'
        ),
        damagePerSiegeWeightNumerator: requireUint32(
            overtime.damagePerSiegeWeightNumerator,
            'overtime.damagePerSiegeWeightNumerator'
        ),
        damagePerSiegeWeightDenominator: requireUint32(
            overtime.damagePerSiegeWeightDenominator,
            'overtime.damagePerSiegeWeightDenominator',
            { positive: true }
        ),
        maximumDamageFixedPoint: requireUint32(
            overtime.maximumDamageFixedPoint,
            'overtime.maximumDamageFixedPoint'
        )
    });
    if (normalizedOvertime.damageBasis
        !== WAVE_OVERTIME_DAMAGE_BASIS.SIEGE_WEIGHT) {
        throw new RangeError('overtime.damageBasis는 SIEGE_WEIGHT여야 합니다.');
    }
    if (normalizedOvertime.minimumDamageFixedPoint
        > normalizedOvertime.maximumDamageFixedPoint) {
        throw new RangeError('overtime minimum damage는 maximum 이하여야 합니다.');
    }

    const normalized = Object.freeze({
        profileId: requireNonEmptyString(profile.profileId, 'profileId'),
        combatDurationTicks: requireUint32(
            profile.combatDurationTicks,
            'combatDurationTicks',
            { positive: true }
        ),
        requireAllHostilesCleared: requireBoolean(
            profile.requireAllHostilesCleared,
            'requireAllHostilesCleared'
        ),
        overtime: normalizedOvertime,
        settlement: Object.freeze({
            completionGoldBonus: requireUint32(
                settlement.completionGoldBonus,
                'settlement.completionGoldBonus'
            ),
            openShop: requireBoolean(settlement.openShop, 'settlement.openShop')
        })
    });
    PROFILE_METADATA.set(normalized, Object.freeze({
        fingerprint: fingerprintR8Record(
            'r9-wave-resolution-profile',
            createFingerprintRecord(normalized),
            normalized.profileId
        )
    }));
    return normalized;
}

export function getWaveResolutionProfileFingerprint(profile) {
    const metadata = PROFILE_METADATA.get(profile);
    if (!metadata) {
        throw new TypeError('normalized WaveResolutionProfile이 필요합니다.');
    }
    return metadata.fingerprint;
}

export function createWaveResolutionProfileCatalog(profiles) {
    if (!Array.isArray(profiles) || profiles.length === 0) {
        throw new TypeError('WaveResolutionProfile catalog는 비어 있지 않아야 합니다.');
    }
    const catalog = [];
    const byId = Object.create(null);
    for (let index = 0; index < profiles.length; index++) {
        const profile = profiles[index];
        getWaveResolutionProfileFingerprint(profile);
        if (Object.hasOwn(byId, profile.profileId)) {
            throw new RangeError(`resolution profileId가 중복되었습니다: ${profile.profileId}`);
        }
        byId[profile.profileId] = profile;
        catalog.push(profile);
    }
    return Object.freeze({
        profiles: Object.freeze(catalog),
        byId: Object.freeze(byId)
    });
}
