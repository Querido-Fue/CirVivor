const UINT32_MAX = 0xffffffff;

export const GPU_TOWER_TARGET_QUERY_ABI_VERSION = 1;
export const GPU_TOWER_TARGET_QUERY_INVALID_COMPONENT = UINT32_MAX;

export const GPU_TOWER_TARGET_QUERY_POLICY = Object.freeze({
    DISTANCE_SHARE_IDENTITY: 0,
    LOWEST_IDENTITY: 1,
    COMPATIBILITY_EXACT: 2
});

export const GPU_TOWER_TARGET_QUERY_FLAG = Object.freeze({
    VALID: 1 << 0,
    SOURCE_VALID: 1 << 1,
    ROSTER_CHANGED: 1 << 2,
    TARGET_CHANGED: 1 << 3,
    IDENTITY_POLICY: 1 << 4,
    COMPATIBILITY_EXACT: 1 << 5
});

export const GPU_TOWER_TARGET_QUERY_STATUS = Object.freeze({
    OK: 0,
    BODY_ABI_MISMATCH: 1 << 0,
    QUERY_ABI_MISMATCH: 1 << 1,
    ROSTER_INVALID: 1 << 2
});

export const GPU_TOWER_TARGET_QUERY_STORAGE_PROFILE = Object.freeze({
    queryStorageBuffersPerStage: 9,
    spawnRewriteStorageBuffersPerStage: 4,
    maximumStorageBuffersPerStage: 9
});

export const GPU_TOWER_TARGET_QUERY_ABI = Object.freeze({
    RESULT: Object.freeze({
        STRIDE: 40,
        SOURCE_ENTITY_ID: 0,
        SOURCE_INCARNATION: 4,
        TARGET_SLOT: 8,
        TARGET_ENTITY_ID: 12,
        TARGET_INCARNATION: 16,
        SHARE_UNITS: 20,
        GROUP_REVISION: 24,
        ROSTER_FINGERPRINT: 28,
        DISTANCE_SQUARED: 32,
        FLAGS: 36
    }),
    STATS: Object.freeze({
        STRIDE: 32,
        ABI_VERSION: 0,
        STATUS: 4,
        QUERY_COUNT: 8,
        VALID_COUNT: 12,
        GROUP_REVISION: 16,
        ROSTER_FINGERPRINT: 20,
        BODY_COUNT: 24,
        RESERVED: 28
    })
});

function compareIdentity(left, right) {
    return Number(left.entityId) - Number(right.entityId)
        || Number(left.incarnation) - Number(right.incarnation);
}

function isLivingMember(member, body, groupRevision) {
    return member?.living !== false
        && member?.towerNoun !== false
        && Number(member?.groupRevision) === Number(groupRevision)
        && body?.alive === true
        && Number(body.entityId) === Number(member.entityId)
        && Number(body.incarnation) === Number(member.incarnation)
        && Number.isFinite(Number(body.position?.x))
        && Number.isFinite(Number(body.position?.y));
}

/**
 * WGSL 질의의 결정 규칙을 검증하는 순수 host oracle입니다.
 * production targeting은 이 함수를 호출하지 않고 GPU roster buffer만 읽습니다.
 */
export function selectGpuTowerTargetQueryOracle(source = {}) {
    const sourcePosition = {
        x: Number(source.sourcePosition?.x),
        y: Number(source.sourcePosition?.y)
    };
    if (!Number.isFinite(sourcePosition.x) || !Number.isFinite(sourcePosition.y)) {
        return null;
    }
    const groupRevision = Number(source.groupRevision);
    const policy = source.policy
        ?? GPU_TOWER_TARGET_QUERY_POLICY.DISTANCE_SHARE_IDENTITY;
    let selected = null;
    for (const member of source.members ?? []) {
        const body = member.body ?? member;
        if (!isLivingMember(member, body, groupRevision)) continue;
        const dx = Math.fround(Number(body.position.x) - sourcePosition.x);
        const dy = Math.fround(Number(body.position.y) - sourcePosition.y);
        const candidate = Object.freeze({
            slot: Number(member.slot),
            entityId: Number(member.entityId),
            incarnation: Number(member.incarnation),
            shareUnits: Number(member.shareUnits ?? 0),
            groupRevision,
            distanceSquared: Math.fround(
                Math.fround(dx * dx) + Math.fround(dy * dy)
            )
        });
        if (!selected) {
            selected = candidate;
            continue;
        }
        const identityOrder = compareIdentity(candidate, selected);
        const candidateWins = policy === GPU_TOWER_TARGET_QUERY_POLICY.LOWEST_IDENTITY
            ? identityOrder < 0
            : candidate.distanceSquared < selected.distanceSquared
                || (candidate.distanceSquared === selected.distanceSquared
                    && (candidate.shareUnits > selected.shareUnits
                        || (candidate.shareUnits === selected.shareUnits
                            && identityOrder < 0)));
        if (candidateWins) selected = candidate;
    }
    return selected;
}

export function readGpuTowerTargetQueryResult(buffer, bodyId = 0) {
    const source = buffer instanceof ArrayBuffer
        ? buffer
        : buffer?.buffer?.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength
        );
    const offset = Number(bodyId) * GPU_TOWER_TARGET_QUERY_ABI.RESULT.STRIDE;
    if (!(source instanceof ArrayBuffer)
        || !Number.isSafeInteger(bodyId)
        || bodyId < 0
        || source.byteLength < offset + GPU_TOWER_TARGET_QUERY_ABI.RESULT.STRIDE) {
        throw new RangeError('Tower target query result 범위가 유효하지 않습니다.');
    }
    const view = new DataView(source);
    const abi = GPU_TOWER_TARGET_QUERY_ABI.RESULT;
    const flags = view.getUint32(offset + abi.FLAGS, true);
    return Object.freeze({
        sourceEntityId: view.getUint32(offset + abi.SOURCE_ENTITY_ID, true),
        sourceIncarnation: view.getUint32(offset + abi.SOURCE_INCARNATION, true),
        targetSlot: view.getUint32(offset + abi.TARGET_SLOT, true),
        targetEntityId: view.getUint32(offset + abi.TARGET_ENTITY_ID, true),
        targetIncarnation: view.getUint32(offset + abi.TARGET_INCARNATION, true),
        shareUnits: view.getUint32(offset + abi.SHARE_UNITS, true),
        groupRevision: view.getUint32(offset + abi.GROUP_REVISION, true),
        rosterFingerprint: view.getUint32(offset + abi.ROSTER_FINGERPRINT, true),
        distanceSquared: view.getFloat32(offset + abi.DISTANCE_SQUARED, true),
        flags,
        valid: (flags & GPU_TOWER_TARGET_QUERY_FLAG.VALID) !== 0
    });
}
