import { fingerprintR8Record } from './r8_fingerprint_contract.js';

export const WORD_UPGRADE_PROFILE_ABI_VERSION = 1;

const PROFILE_KEYS = new Set([
    'abiVersion',
    'id',
    'definitionId',
    'levels',
    'profileFingerprint'
]);
const LEVEL_KEYS = new Set([
    'level',
    'stackContribution',
    'upgradeCostToNext'
]);

function snapshotRecord(value, allowedKeys, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label}은 객체여야 합니다.`);
    }
    const snapshot = Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
        if (typeof key === 'symbol' || !allowedKeys.has(key)) {
            throw new RangeError(`${label}.${String(key)}은 지원하지 않는 필드입니다.`);
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
            throw new TypeError(`${label}.${key}은 data property여야 합니다.`);
        }
        snapshot[key] = descriptor.value;
    }
    return snapshot;
}

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

function requireUint32(value, label) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)
        || value < 0 || value > 0xffffffff) {
        throw new RangeError(`${label}은 uint32여야 합니다.`);
    }
    return value >>> 0;
}

function requirePositiveUint32(value, label) {
    const normalized = requireUint32(value, label);
    if (normalized === 0) {
        throw new RangeError(`${label}은 양의 uint32여야 합니다.`);
    }
    return normalized;
}

function requireCostOrNull(value, label) {
    if (value === null) return null;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${label}은 null 또는 0 이상의 안전한 정수여야 합니다.`);
    }
    return value;
}

function normalizeLevels(source, label) {
    if (!Array.isArray(source) || source.length === 0 || source.length > 256) {
        throw new RangeError(`${label}은 1..256 길이의 배열이어야 합니다.`);
    }
    const levels = source.map((entry, index) => {
        const values = snapshotRecord(entry, LEVEL_KEYS, `${label}[${index}]`);
        const level = requireUint32(values.level, `${label}[${index}].level`);
        if (level !== index) {
            throw new RangeError(`${label}은 level 0부터 연속되어야 합니다.`);
        }
        const upgradeCostToNext = requireCostOrNull(
            values.upgradeCostToNext,
            `${label}[${index}].upgradeCostToNext`
        );
        if ((index === source.length - 1) !== (upgradeCostToNext === null)) {
            throw new RangeError(`${label}의 마지막 level만 upgradeCostToNext가 null이어야 합니다.`);
        }
        return Object.freeze({
            level,
            stackContribution: requirePositiveUint32(
                values.stackContribution,
                `${label}[${index}].stackContribution`
            ),
            upgradeCostToNext
        });
    });
    return Object.freeze(levels);
}

/** Data-owned generic WordUpgradeProfile을 immutable typed record로 고정합니다. */
export function normalizeWordUpgradeProfile(source, label = 'wordUpgradeProfile') {
    const values = snapshotRecord(source, PROFILE_KEYS, label);
    if (values.abiVersion !== WORD_UPGRADE_PROFILE_ABI_VERSION) {
        throw new RangeError(
            `${label}.abiVersion은 ${WORD_UPGRADE_PROFILE_ABI_VERSION}이어야 합니다.`
        );
    }
    const profile = {
        abiVersion: WORD_UPGRADE_PROFILE_ABI_VERSION,
        id: requireNonEmptyString(values.id, `${label}.id`),
        definitionId: requireNonEmptyString(
            values.definitionId,
            `${label}.definitionId`
        ),
        levels: normalizeLevels(values.levels, `${label}.levels`)
    };
    const profileFingerprint = fingerprintR8Record(
        'word-upgrade-profile.r8',
        profile,
        label
    );
    if (values.profileFingerprint !== undefined
        && values.profileFingerprint !== profileFingerprint) {
        throw new RangeError(`${label}.profileFingerprint가 semantic profile과 다릅니다.`);
    }
    return Object.freeze({ ...profile, profileFingerprint });
}

export function getWordUpgradeLevel(profile, level, label = 'wordUpgradeProfile') {
    const normalized = normalizeWordUpgradeProfile(profile, label);
    if (!Number.isSafeInteger(level) || level < 0 || level >= normalized.levels.length) {
        return null;
    }
    return normalized.levels[level];
}
