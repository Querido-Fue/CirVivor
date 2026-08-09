/**
 * 값이 ICoreIntegrity 런타임 계약을 만족하는지 확인합니다.
 * @param {*} integrity - 검사할 Core Integrity component입니다.
 * @returns {boolean} 인터페이스 충족 여부입니다.
 */
export function isCoreIntegrity(integrity) {
    return Boolean(
        integrity
        && typeof integrity === 'object'
        && typeof integrity.coreIntegrityId === 'string'
        && integrity.coreIntegrityId.length > 0
        && typeof integrity.getCurrentIntegrity === 'function'
        && typeof integrity.getMaxIntegrity === 'function'
        && typeof integrity.isDepleted === 'function'
        && typeof integrity.isTerminallySealed === 'function'
        && typeof integrity.applyIntegrityDamage === 'function'
        && typeof integrity.restoreIntegrity === 'function'
    );
}

/**
 * ICoreIntegrity 계약을 확인하고 같은 component를 반환합니다.
 * @param {*} integrity - 확인할 Core Integrity component입니다.
 * @returns {*} 확인을 통과한 원본 component입니다.
 * @throws {TypeError} 계약을 만족하지 않을 때 발생합니다.
 */
export function assertCoreIntegrity(integrity) {
    if (!isCoreIntegrity(integrity)) {
        throw new TypeError('ICoreIntegrity 계약을 만족하지 않는 component입니다.');
    }
    return integrity;
}
