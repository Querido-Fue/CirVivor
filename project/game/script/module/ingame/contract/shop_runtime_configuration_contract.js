import {
    fingerprintUnlockedWordPool
} from './word_shop_contract.js';
import {
    requireR8NonEmptyString
} from './word_inventory_contract.js';

export const SHOP_RUNTIME_CONFIGURATION_MODE = Object.freeze({
    DISABLED: 'DISABLED',
    QA: 'QA',
    PRODUCTION: 'PRODUCTION'
});

const SHOP_RUNTIME_CONFIGURATION_MODES = new Set(
    Object.values(SHOP_RUNTIME_CONFIGURATION_MODE)
);

function requirePositiveUint32(value, label) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)
        || value <= 0 || value > 0xffffffff) {
        throw new RangeError(`${label}은 양의 uint32여야 합니다.`);
    }
    return value >>> 0;
}

function normalizeIdentityDefinitionIds(source, label) {
    if (!Array.isArray(source) || source.length === 0) {
        throw new RangeError(`${label}은 비어 있지 않은 배열이어야 합니다.`);
    }
    const values = source.map((value, index) => (
        requireR8NonEmptyString(value, `${label}[${index}]`)
    ));
    if (new Set(values).size !== values.length) {
        throw new RangeError(`${label}에는 중복 definition ID가 없어야 합니다.`);
    }
    return Object.freeze(values.slice().sort());
}

/** R9/new-run owner가 주입할 production run identity를 fail-closed 정규화합니다. */
export function normalizeProductionRunIdentity(source = {}) {
    const unlockedWordDefinitionIds = normalizeIdentityDefinitionIds(
        source.unlockedWordDefinitionIds,
        'ProductionRunIdentity.unlockedWordDefinitionIds'
    );
    const unlockedPoolFingerprint = requirePositiveUint32(
        source.unlockedPoolFingerprint,
        'ProductionRunIdentity.unlockedPoolFingerprint'
    );
    const computedFingerprint = fingerprintUnlockedWordPool(
        unlockedWordDefinitionIds
    );
    if (computedFingerprint !== unlockedPoolFingerprint) {
        throw new RangeError(
            'ProductionRunIdentity unlocked pool fingerprint가 일치하지 않습니다.'
        );
    }
    return Object.freeze({
        runSessionId: requireR8NonEmptyString(
            source.runSessionId,
            'ProductionRunIdentity.runSessionId'
        ),
        runSeed: requirePositiveUint32(
            source.runSeed,
            'ProductionRunIdentity.runSeed'
        ),
        unlockedWordDefinitionIds,
        unlockedPoolFingerprint
    });
}
/** 일반 세션의 Shop 비활성 configuration입니다. */
export function createDisabledShopRuntimeConfiguration() {
    return Object.freeze({
        mode: SHOP_RUNTIME_CONFIGURATION_MODE.DISABLED,
        configured: false,
        runSessionId: null,
        runSeed: null,
        unlockedWordDefinitionIds: Object.freeze([]),
        unlockedPoolFingerprint: 0,
        allowEconomicallyRedundantOffers: false,
        autoOpen: false,
        sourceId: null,
        initialLoadout: null
    });
}

/**
 * GameSystem에 전달된 Shop configuration을 명시적 runtime mode로 고정합니다.
 * mode가 생략된 객체는 QA fallback으로 추정하지 않고 거절합니다.
 */
export function normalizeShopRuntimeConfiguration(source) {
    if (source === undefined || source === null) {
        return createDisabledShopRuntimeConfiguration();
    }
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new TypeError('r8ShopOptions는 객체여야 합니다.');
    }
    const mode = source.mode;
    if (!SHOP_RUNTIME_CONFIGURATION_MODES.has(mode)) {
        throw new RangeError('r8ShopOptions.mode가 명시되지 않았거나 알려지지 않았습니다.');
    }
    if (mode === SHOP_RUNTIME_CONFIGURATION_MODE.DISABLED) {
        return createDisabledShopRuntimeConfiguration();
    }

    const identity = normalizeProductionRunIdentity(source);
    const allowEconomicallyRedundantOffers
        = source.allowEconomicallyRedundantOffers === true;
    if (mode === SHOP_RUNTIME_CONFIGURATION_MODE.PRODUCTION
        && allowEconomicallyRedundantOffers) {
        throw new RangeError(
            'Production Shop은 economically redundant offer를 허용하지 않습니다.'
        );
    }
    if (mode === SHOP_RUNTIME_CONFIGURATION_MODE.PRODUCTION
        && source.autoOpen === true) {
        throw new RangeError('Production Shop autoOpen은 아직 허용되지 않습니다.');
    }
    return Object.freeze({
        mode,
        configured: true,
        ...identity,
        allowEconomicallyRedundantOffers,
        autoOpen: mode === SHOP_RUNTIME_CONFIGURATION_MODE.QA
            && source.autoOpen === true,
        sourceId: source.sourceId === undefined
            ? null
            : requireR8NonEmptyString(source.sourceId, 'Shop sourceId'),
        initialLoadout: source.initialLoadout ?? null
    });
}
