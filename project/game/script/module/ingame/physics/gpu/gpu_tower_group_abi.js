import {
    GPU_CIRCLE_BODY_ABI_VERSION,
    GPU_CIRCLE_BODY_COLLISION_LAYER
} from './gpu_circle_body_abi.js';
import { GAMEPLAY_TEAM_ID } from '../../contract/gameplay_team_contract.js';

const LITTLE_ENDIAN = true;
const UINT32_MAX = 0xffffffff;
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export const GPU_TOWER_GROUP_ABI_VERSION = 2;
export const GPU_TOWER_GROUP_INVALID_COMPONENT = UINT32_MAX;

export const GPU_TOWER_GROUP_MEMBER_FLAG = Object.freeze({
    TOWER_NOUN: 1 << 0,
    LIVING: 1 << 1
});

export const GPU_TOWER_GROUP_COMMAND_FLAG = Object.freeze({
    VALID: 1 << 0,
    AIM_VALID: 1 << 1
});

export const GPU_TOWER_GROUP_SUMMARY_STATUS = Object.freeze({
    OK: 0,
    BODY_ABI_MISMATCH: 1 << 0,
    ABI_MISMATCH: 1 << 1,
    PROTOCOL_MISMATCH: 1 << 2,
    COMMAND_FINGERPRINT_MISMATCH: 1 << 3,
    ROSTER_INVALID: 1 << 4
});

export const GPU_TOWER_GROUP_HARD_FAILURE_MASK = Object.values(
    GPU_TOWER_GROUP_SUMMARY_STATUS
).reduce((mask, value) => mask | value, 0);

export const GPU_TOWER_GROUP_STORAGE_PROFILE = Object.freeze({
    controlStorageBuffersPerStage: 7,
    summaryStorageBuffersPerStage: 7,
    maximumStorageBuffersPerStage: 7
});

export const GPU_TOWER_GROUP_ABI = Object.freeze({
    MEMBER_STATE: Object.freeze({
        STRIDE: 40,
        ENTITY_ID: 0,
        INCARNATION: 4,
        LOGICAL_ORDINAL: 8,
        SHARE_UNITS: 12,
        MAX_HP_FIXED_POINT: 16,
        POWER_FIXED_POINT: 20,
        GROUP_REVISION: 24,
        FLAGS: 28,
        ROSTER_RANK: 32,
        RESERVED: 36
    }),
    ROSTER_HEADER: Object.freeze({
        STRIDE: 32,
        ABI_VERSION: 0,
        MEMBER_COUNT: 4,
        CAPACITY: 8,
        FINGERPRINT: 12,
        GROUP_REVISION: 16,
        SESSION_GENERATION: 20,
        DEVICE_GENERATION: 24,
        AUTHORITATIVE_EPOCH: 28
    }),
    ROSTER_SLOT: Object.freeze({ STRIDE: 4 }),
    COMMAND: Object.freeze({
        STRIDE: 64,
        ABI_VERSION: 0,
        STATUS: 4,
        SESSION_GENERATION: 8,
        DEVICE_GENERATION: 12,
        AUTHORITATIVE_EPOCH: 16,
        SOURCE_TICK: 20,
        GROUP_REVISION: 24,
        ROSTER_FINGERPRINT: 28,
        MOVE_INTENT_X: 32,
        MOVE_INTENT_Y: 36,
        AIM_WORLD_X: 40,
        AIM_WORLD_Y: 44,
        COMMAND_FINGERPRINT: 48,
        FLAGS: 52,
        FALLBACK_GROUP_REVISION: 56,
        FALLBACK_ROSTER_FINGERPRINT: 60,
        RESERVED_0: 56,
        RESERVED_1: 60
    }),
    FIXED_PARAMS: Object.freeze({
        STRIDE: 32,
        ABI_VERSION: 0,
        SESSION_GENERATION: 4,
        DEVICE_GENERATION: 8,
        AUTHORITATIVE_EPOCH: 12,
        SOURCE_TICK: 16,
        BODY_ABI_VERSION: 20,
        RESERVED_0: 24,
        RESERVED_1: 28
    }),
    SUMMARY: Object.freeze({
        STRIDE: 80,
        ABI_VERSION: 0,
        STATUS: 4,
        SESSION_GENERATION: 8,
        DEVICE_GENERATION: 12,
        AUTHORITATIVE_EPOCH: 16,
        SOURCE_TICK: 20,
        GROUP_REVISION: 24,
        LIVING_COUNT: 28,
        CENTROID_X: 32,
        CENTROID_Y: 36,
        BOUNDS_MIN_X: 40,
        BOUNDS_MIN_Y: 44,
        BOUNDS_MAX_X: 48,
        BOUNDS_MAX_Y: 52,
        PRIMARY_ENTITY_ID: 56,
        PRIMARY_INCARNATION: 60,
        LIVING_SHARE_UNITS: 64,
        ROSTER_FINGERPRINT: 68,
        PRIMARY_LOGICAL_ORDINAL: 72,
        EXCLUDED_MEMBER_COUNT: 76
    })
});

function requireCapacity(value) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0
        || number >= UINT32_MAX) {
        throw new RangeError('TowerGroup GPU capacity는 uint32 sentinel 미만의 양의 정수여야 합니다.');
    }
    return number;
}

function requireUint32(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0 || number > UINT32_MAX) {
        throw new RangeError(`${label}은 uint32 범위의 정수여야 합니다.`);
    }
    return number;
}

function requirePositiveUint32(value, label) {
    const number = requireUint32(value, label);
    if (number === 0 || number === UINT32_MAX) {
        throw new RangeError(`${label}은 reserved sentinel이 아닌 양의 uint32여야 합니다.`);
    }
    return number;
}

function requireFiniteFloat32(value, label) {
    const number = Math.fround(Number(value));
    if (!Number.isFinite(number)) {
        throw new RangeError(`${label}은 유한한 Float32여야 합니다.`);
    }
    return number;
}

function normalizeProtocol(source = {}) {
    return Object.freeze({
        sessionGeneration: requirePositiveUint32(
            source.sessionGeneration,
            'TowerGroup sessionGeneration'
        ),
        deviceGeneration: requireUint32(
            source.deviceGeneration,
            'TowerGroup deviceGeneration'
        ),
        authoritativeEpoch: requireUint32(
            source.authoritativeEpoch,
            'TowerGroup authoritativeEpoch'
        )
    });
}

function hashWord(hash, value) {
    return Math.imul((hash ^ (Number(value) >>> 0)) >>> 0, FNV_PRIME) >>> 0;
}

function nonZeroHash(hash) {
    return hash === 0 ? 1 : hash >>> 0;
}

function float32Word(value) {
    const bytes = new ArrayBuffer(4);
    const view = new DataView(bytes);
    view.setFloat32(0, requireFiniteFloat32(value, 'fingerprint float'), LITTLE_ENDIAN);
    return view.getUint32(0, LITTLE_ENDIAN);
}

function compareMembers(left, right) {
    return left.logicalTowerOrdinal - right.logicalTowerOrdinal
        || left.entityId - right.entityId
        || left.incarnation - right.incarnation;
}

function normalizeMember(source, capacity, rank) {
    const flags = requireUint32(
        source.flags ?? (
            GPU_TOWER_GROUP_MEMBER_FLAG.TOWER_NOUN
            | GPU_TOWER_GROUP_MEMBER_FLAG.LIVING
        ),
        'TowerGroup member flags'
    );
    const slot = requireUint32(source.slot, 'TowerGroup member slot');
    if (slot >= capacity) {
        throw new RangeError(`TowerGroup member slot이 capacity를 벗어났습니다: ${slot}/${capacity}`);
    }
    return Object.freeze({
        slot,
        entityId: requirePositiveUint32(source.entityId, 'TowerGroup member entityId'),
        incarnation: requirePositiveUint32(
            source.incarnation,
            'TowerGroup member incarnation'
        ),
        logicalTowerOrdinal: requirePositiveUint32(
            source.logicalTowerOrdinal,
            'TowerGroup logicalTowerOrdinal'
        ),
        shareUnits: requireUint32(source.shareUnits, 'TowerGroup shareUnits'),
        maxHpFixedPoint: requireUint32(
            source.maxHpFixedPoint,
            'TowerGroup maxHpFixedPoint'
        ),
        powerFixedPoint: requireUint32(
            source.powerFixedPoint,
            'TowerGroup powerFixedPoint'
        ),
        groupRevision: requirePositiveUint32(
            source.groupRevision,
            'TowerGroup member groupRevision'
        ),
        flags,
        rosterRank: requireUint32(rank, 'TowerGroup rosterRank')
    });
}

export function createGpuTowerGroupHostStorage(capacity) {
    const safeCapacity = requireCapacity(capacity);
    return Object.seal({
        capacity: safeCapacity,
        memberStates: new ArrayBuffer(
            safeCapacity * GPU_TOWER_GROUP_ABI.MEMBER_STATE.STRIDE
        ),
        roster: new ArrayBuffer(
            GPU_TOWER_GROUP_ABI.ROSTER_HEADER.STRIDE
            + (safeCapacity * GPU_TOWER_GROUP_ABI.ROSTER_SLOT.STRIDE)
        ),
        command: new ArrayBuffer(GPU_TOWER_GROUP_ABI.COMMAND.STRIDE),
        fixedParams: new ArrayBuffer(GPU_TOWER_GROUP_ABI.FIXED_PARAMS.STRIDE),
        summary: new ArrayBuffer(GPU_TOWER_GROUP_ABI.SUMMARY.STRIDE)
    });
}

export function computeGpuTowerGroupRosterFingerprint(source = {}) {
    const protocol = normalizeProtocol(source.protocol);
    const groupRevision = requirePositiveUint32(
        source.groupRevision,
        'TowerGroup groupRevision'
    );
    const members = [...(source.members ?? [])].sort(compareMembers);
    let hash = FNV_OFFSET;
    for (const word of [
        GPU_TOWER_GROUP_ABI_VERSION,
        protocol.sessionGeneration,
        protocol.deviceGeneration,
        protocol.authoritativeEpoch,
        groupRevision,
        members.length
    ]) {
        hash = hashWord(hash, word);
    }
    for (const member of members) {
        for (const word of [
            member.slot,
            member.entityId,
            member.incarnation,
            member.logicalTowerOrdinal,
            member.shareUnits,
            member.maxHpFixedPoint,
            member.powerFixedPoint,
            member.groupRevision,
            member.flags,
            member.rosterRank
        ]) {
            hash = hashWord(hash, word);
        }
    }
    return nonZeroHash(hash);
}

export function writeGpuTowerGroupRoster(storage, source = {}) {
    if (!storage?.memberStates || !storage?.roster) {
        throw new TypeError('TowerGroup host storage가 필요합니다.');
    }
    const capacity = requireCapacity(storage.capacity);
    const protocol = normalizeProtocol(source.protocol);
    const groupRevision = requirePositiveUint32(
        source.groupRevision,
        'TowerGroup groupRevision'
    );
    if (!Array.isArray(source.members) || source.members.length > capacity) {
        throw new RangeError('TowerGroup members가 배열이 아니거나 capacity를 초과했습니다.');
    }
    const sortedSources = [...source.members].sort(compareMembers);
    const members = sortedSources.map((member, rank) => normalizeMember(
        { ...member, groupRevision },
        capacity,
        rank
    ));
    const slots = new Set();
    const identities = new Set();
    const ordinals = new Set();
    for (const member of members) {
        const identity = `${member.entityId}:${member.incarnation}`;
        if (slots.has(member.slot) || identities.has(identity)
            || ordinals.has(member.logicalTowerOrdinal)) {
            throw new Error('TowerGroup member slot/identity/ordinal은 각각 고유해야 합니다.');
        }
        slots.add(member.slot);
        identities.add(identity);
        ordinals.add(member.logicalTowerOrdinal);
    }
    const fingerprint = computeGpuTowerGroupRosterFingerprint({
        protocol,
        groupRevision,
        members
    });
    new Uint8Array(storage.memberStates).fill(0);
    new Uint8Array(storage.roster).fill(0);
    const memberView = new DataView(storage.memberStates);
    const rosterView = new DataView(storage.roster);
    const memberAbi = GPU_TOWER_GROUP_ABI.MEMBER_STATE;
    for (const member of members) {
        const offset = member.slot * memberAbi.STRIDE;
        memberView.setUint32(offset + memberAbi.ENTITY_ID, member.entityId, LITTLE_ENDIAN);
        memberView.setUint32(offset + memberAbi.INCARNATION, member.incarnation, LITTLE_ENDIAN);
        memberView.setUint32(offset + memberAbi.LOGICAL_ORDINAL, member.logicalTowerOrdinal, LITTLE_ENDIAN);
        memberView.setUint32(offset + memberAbi.SHARE_UNITS, member.shareUnits, LITTLE_ENDIAN);
        memberView.setUint32(offset + memberAbi.MAX_HP_FIXED_POINT, member.maxHpFixedPoint, LITTLE_ENDIAN);
        memberView.setUint32(offset + memberAbi.POWER_FIXED_POINT, member.powerFixedPoint, LITTLE_ENDIAN);
        memberView.setUint32(offset + memberAbi.GROUP_REVISION, groupRevision, LITTLE_ENDIAN);
        memberView.setUint32(offset + memberAbi.FLAGS, member.flags, LITTLE_ENDIAN);
        memberView.setUint32(offset + memberAbi.ROSTER_RANK, member.rosterRank, LITTLE_ENDIAN);
        memberView.setUint32(offset + memberAbi.RESERVED, 0, LITTLE_ENDIAN);
    }
    const header = GPU_TOWER_GROUP_ABI.ROSTER_HEADER;
    rosterView.setUint32(header.ABI_VERSION, GPU_TOWER_GROUP_ABI_VERSION, LITTLE_ENDIAN);
    rosterView.setUint32(header.MEMBER_COUNT, members.length, LITTLE_ENDIAN);
    rosterView.setUint32(header.CAPACITY, capacity, LITTLE_ENDIAN);
    rosterView.setUint32(header.FINGERPRINT, fingerprint, LITTLE_ENDIAN);
    rosterView.setUint32(header.GROUP_REVISION, groupRevision, LITTLE_ENDIAN);
    rosterView.setUint32(header.SESSION_GENERATION, protocol.sessionGeneration, LITTLE_ENDIAN);
    rosterView.setUint32(header.DEVICE_GENERATION, protocol.deviceGeneration, LITTLE_ENDIAN);
    rosterView.setUint32(header.AUTHORITATIVE_EPOCH, protocol.authoritativeEpoch, LITTLE_ENDIAN);
    for (let rank = 0; rank < members.length; rank++) {
        rosterView.setUint32(
            header.STRIDE + (rank * GPU_TOWER_GROUP_ABI.ROSTER_SLOT.STRIDE),
            members[rank].slot,
            LITTLE_ENDIAN
        );
    }
    return Object.freeze({
        protocol,
        groupRevision,
        fingerprint,
        memberCount: members.length,
        members: Object.freeze(members)
    });
}

export function computeGpuTowerGroupCommandFingerprint(source = {}) {
    const protocol = normalizeProtocol(source.protocol);
    const fallbackGroupRevision = requireUint32(
        source.fallbackGroupRevision ?? 0,
        'TowerGroup fallbackGroupRevision'
    );
    const fallbackRosterFingerprint = requireUint32(
        source.fallbackRosterFingerprint ?? 0,
        'TowerGroup fallbackRosterFingerprint'
    );
    if ((fallbackGroupRevision === 0) !== (fallbackRosterFingerprint === 0)) {
        throw new RangeError('TowerGroup fallback roster tuple은 모두 zero이거나 모두 양수여야 합니다.');
    }
    const words = [
        GPU_TOWER_GROUP_ABI_VERSION,
        protocol.sessionGeneration,
        protocol.deviceGeneration,
        protocol.authoritativeEpoch,
        requirePositiveUint32(source.sourceTick, 'TowerGroup command sourceTick'),
        requirePositiveUint32(source.groupRevision, 'TowerGroup command groupRevision'),
        requirePositiveUint32(
            source.rosterFingerprint,
            'TowerGroup command rosterFingerprint'
        ),
        float32Word(source.moveIntent?.x ?? 0),
        float32Word(source.moveIntent?.y ?? 0),
        float32Word(source.aimWorldPoint?.x ?? 0),
        float32Word(source.aimWorldPoint?.y ?? 0),
        requireUint32(source.flags, 'TowerGroup command flags'),
        fallbackGroupRevision,
        fallbackRosterFingerprint
    ];
    let hash = FNV_OFFSET;
    for (const word of words) hash = hashWord(hash, word);
    return nonZeroHash(hash);
}

export function writeGpuTowerGroupCommand(storage, source = {}) {
    if (!storage?.command) {
        throw new TypeError('TowerGroup command storage가 필요합니다.');
    }
    const protocol = normalizeProtocol(source.protocol);
    const sourceTick = requirePositiveUint32(source.sourceTick, 'TowerGroup sourceTick');
    const groupRevision = requirePositiveUint32(
        source.groupRevision,
        'TowerGroup groupRevision'
    );
    const rosterFingerprint = requirePositiveUint32(
        source.rosterFingerprint,
        'TowerGroup rosterFingerprint'
    );
    const moveIntent = Object.freeze({
        x: requireFiniteFloat32(source.moveIntent?.x ?? 0, 'TowerGroup moveIntent.x'),
        y: requireFiniteFloat32(source.moveIntent?.y ?? 0, 'TowerGroup moveIntent.y')
    });
    if (Math.hypot(moveIntent.x, moveIntent.y) > 1.000001) {
        throw new RangeError('TowerGroup moveIntent magnitude는 1 이하여야 합니다.');
    }
    const aimWorldPoint = Object.freeze({
        x: requireFiniteFloat32(source.aimWorldPoint?.x ?? 0, 'TowerGroup aimWorldPoint.x'),
        y: requireFiniteFloat32(source.aimWorldPoint?.y ?? 0, 'TowerGroup aimWorldPoint.y')
    });
    const flags = requireUint32(
        source.flags ?? (
            GPU_TOWER_GROUP_COMMAND_FLAG.VALID
            | GPU_TOWER_GROUP_COMMAND_FLAG.AIM_VALID
        ),
        'TowerGroup command flags'
    );
    const fallbackGroupRevision = requireUint32(
        source.fallbackGroupRevision ?? 0,
        'TowerGroup fallbackGroupRevision'
    );
    const fallbackRosterFingerprint = requireUint32(
        source.fallbackRosterFingerprint ?? 0,
        'TowerGroup fallbackRosterFingerprint'
    );
    if ((fallbackGroupRevision === 0) !== (fallbackRosterFingerprint === 0)) {
        throw new RangeError('TowerGroup fallback roster tuple은 모두 zero이거나 모두 양수여야 합니다.');
    }
    const commandFingerprint = computeGpuTowerGroupCommandFingerprint({
        protocol,
        sourceTick,
        groupRevision,
        rosterFingerprint,
        moveIntent,
        aimWorldPoint,
        flags,
        fallbackGroupRevision,
        fallbackRosterFingerprint
    });
    const view = new DataView(storage.command);
    const abi = GPU_TOWER_GROUP_ABI.COMMAND;
    view.setUint32(abi.ABI_VERSION, GPU_TOWER_GROUP_ABI_VERSION, LITTLE_ENDIAN);
    view.setUint32(abi.STATUS, GPU_TOWER_GROUP_SUMMARY_STATUS.OK, LITTLE_ENDIAN);
    view.setUint32(abi.SESSION_GENERATION, protocol.sessionGeneration, LITTLE_ENDIAN);
    view.setUint32(abi.DEVICE_GENERATION, protocol.deviceGeneration, LITTLE_ENDIAN);
    view.setUint32(abi.AUTHORITATIVE_EPOCH, protocol.authoritativeEpoch, LITTLE_ENDIAN);
    view.setUint32(abi.SOURCE_TICK, sourceTick, LITTLE_ENDIAN);
    view.setUint32(abi.GROUP_REVISION, groupRevision, LITTLE_ENDIAN);
    view.setUint32(abi.ROSTER_FINGERPRINT, rosterFingerprint, LITTLE_ENDIAN);
    view.setFloat32(abi.MOVE_INTENT_X, moveIntent.x, LITTLE_ENDIAN);
    view.setFloat32(abi.MOVE_INTENT_Y, moveIntent.y, LITTLE_ENDIAN);
    view.setFloat32(abi.AIM_WORLD_X, aimWorldPoint.x, LITTLE_ENDIAN);
    view.setFloat32(abi.AIM_WORLD_Y, aimWorldPoint.y, LITTLE_ENDIAN);
    view.setUint32(abi.COMMAND_FINGERPRINT, commandFingerprint, LITTLE_ENDIAN);
    view.setUint32(abi.FLAGS, flags, LITTLE_ENDIAN);
    view.setUint32(
        abi.FALLBACK_GROUP_REVISION,
        fallbackGroupRevision,
        LITTLE_ENDIAN
    );
    view.setUint32(
        abi.FALLBACK_ROSTER_FINGERPRINT,
        fallbackRosterFingerprint,
        LITTLE_ENDIAN
    );
    return Object.freeze({
        protocol,
        sourceTick,
        groupRevision,
        rosterFingerprint,
        moveIntent,
        aimWorldPoint,
        commandFingerprint,
        flags,
        fallbackGroupRevision,
        fallbackRosterFingerprint
    });
}

export function writeGpuTowerGroupFixedParams(storage, source = {}) {
    if (!storage?.fixedParams) {
        throw new TypeError('TowerGroup fixed params storage가 필요합니다.');
    }
    const protocol = normalizeProtocol(source.protocol);
    const sourceTick = requirePositiveUint32(source.sourceTick, 'TowerGroup fixed sourceTick');
    const view = new DataView(storage.fixedParams);
    const abi = GPU_TOWER_GROUP_ABI.FIXED_PARAMS;
    view.setUint32(abi.ABI_VERSION, GPU_TOWER_GROUP_ABI_VERSION, LITTLE_ENDIAN);
    view.setUint32(abi.SESSION_GENERATION, protocol.sessionGeneration, LITTLE_ENDIAN);
    view.setUint32(abi.DEVICE_GENERATION, protocol.deviceGeneration, LITTLE_ENDIAN);
    view.setUint32(abi.AUTHORITATIVE_EPOCH, protocol.authoritativeEpoch, LITTLE_ENDIAN);
    view.setUint32(abi.SOURCE_TICK, sourceTick, LITTLE_ENDIAN);
    view.setUint32(abi.BODY_ABI_VERSION, GPU_CIRCLE_BODY_ABI_VERSION, LITTLE_ENDIAN);
    view.setUint32(abi.RESERVED_0, 0, LITTLE_ENDIAN);
    view.setUint32(abi.RESERVED_1, 0, LITTLE_ENDIAN);
    return Object.freeze({ protocol, sourceTick });
}

export function readGpuTowerGroupSummary(buffer) {
    if (!(buffer instanceof ArrayBuffer)
        && !ArrayBuffer.isView(buffer)) {
        throw new TypeError('TowerGroup summary ArrayBuffer가 필요합니다.');
    }
    const source = buffer instanceof ArrayBuffer
        ? buffer
        : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    if (source.byteLength < GPU_TOWER_GROUP_ABI.SUMMARY.STRIDE) {
        throw new RangeError('TowerGroup summary byteLength가 ABI보다 작습니다.');
    }
    const view = new DataView(source);
    const abi = GPU_TOWER_GROUP_ABI.SUMMARY;
    const primaryEntityId = view.getUint32(abi.PRIMARY_ENTITY_ID, LITTLE_ENDIAN);
    const primaryIncarnation = view.getUint32(abi.PRIMARY_INCARNATION, LITTLE_ENDIAN);
    return Object.freeze({
        abiVersion: view.getUint32(abi.ABI_VERSION, LITTLE_ENDIAN),
        status: view.getUint32(abi.STATUS, LITTLE_ENDIAN),
        sessionGeneration: view.getUint32(abi.SESSION_GENERATION, LITTLE_ENDIAN),
        deviceGeneration: view.getUint32(abi.DEVICE_GENERATION, LITTLE_ENDIAN),
        authoritativeEpoch: view.getUint32(abi.AUTHORITATIVE_EPOCH, LITTLE_ENDIAN),
        sourceTick: view.getUint32(abi.SOURCE_TICK, LITTLE_ENDIAN),
        groupRevision: view.getUint32(abi.GROUP_REVISION, LITTLE_ENDIAN),
        livingCount: view.getUint32(abi.LIVING_COUNT, LITTLE_ENDIAN),
        centroid: Object.freeze({
            x: view.getFloat32(abi.CENTROID_X, LITTLE_ENDIAN),
            y: view.getFloat32(abi.CENTROID_Y, LITTLE_ENDIAN)
        }),
        bounds: Object.freeze({
            minX: view.getFloat32(abi.BOUNDS_MIN_X, LITTLE_ENDIAN),
            minY: view.getFloat32(abi.BOUNDS_MIN_Y, LITTLE_ENDIAN),
            maxX: view.getFloat32(abi.BOUNDS_MAX_X, LITTLE_ENDIAN),
            maxY: view.getFloat32(abi.BOUNDS_MAX_Y, LITTLE_ENDIAN)
        }),
        primaryHandle: primaryEntityId === UINT32_MAX
                || primaryIncarnation === UINT32_MAX
            ? null
            : Object.freeze({
                entityId: primaryEntityId,
                incarnation: primaryIncarnation
            }),
        livingShareUnits: view.getUint32(abi.LIVING_SHARE_UNITS, LITTLE_ENDIAN),
        rosterFingerprint: view.getUint32(abi.ROSTER_FINGERPRINT, LITTLE_ENDIAN),
        primaryLogicalTowerOrdinal: view.getUint32(
            abi.PRIMARY_LOGICAL_ORDINAL,
            LITTLE_ENDIAN
        ),
        excludedMemberCount: view.getUint32(
            abi.EXCLUDED_MEMBER_COUNT,
            LITTLE_ENDIAN
        )
    });
}

function bodyMatchesTowerMember(member, body) {
    return body?.alive === true
        && body.entityId === member.entityId
        && body.incarnation === member.incarnation
        && body.teamId === GAMEPLAY_TEAM_ID.PLAYER
        && body.interactionLayer
            === GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE
        && (member.flags & GPU_TOWER_GROUP_MEMBER_FLAG.TOWER_NOUN) !== 0
        && (member.flags & GPU_TOWER_GROUP_MEMBER_FLAG.LIVING) !== 0;
}

export function broadcastGpuTowerGroupControlOracle(source = {}) {
    const command = source.command;
    const bodies = source.bodies instanceof Map
        ? source.bodies
        : new Map((source.bodies ?? []).map((body) => [body.slot, body]));
    const controls = [];
    let excludedMemberCount = 0;
    for (const member of source.members ?? []) {
        const body = bodies.get(member.slot);
        if (!bodyMatchesTowerMember(member, body)
            || member.groupRevision !== command.groupRevision) {
            excludedMemberCount++;
            continue;
        }
        controls.push(Object.freeze({
            slot: member.slot,
            entityId: member.entityId,
            incarnation: member.incarnation,
            moveIntent: command.moveIntent,
            aimWorldPoint: command.aimWorldPoint
        }));
    }
    return Object.freeze({
        controls: Object.freeze(controls),
        excludedMemberCount
    });
}

export function reduceGpuTowerGroupCameraSummaryOracle(source = {}) {
    const members = [...(source.members ?? [])].sort(compareMembers);
    const bodies = source.bodies instanceof Map
        ? source.bodies
        : new Map((source.bodies ?? []).map((body) => [body.slot, body]));
    let livingCount = 0;
    let livingShareUnits = 0;
    let weightedX = 0;
    let weightedY = 0;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let primary = null;
    let excludedMemberCount = 0;
    for (const member of members) {
        const body = bodies.get(member.slot);
        const x = Number(body?.position?.x);
        const y = Number(body?.position?.y);
        const radius = Number(body?.radius ?? 0);
        if (!bodyMatchesTowerMember(member, body)
            || member.groupRevision !== source.groupRevision
            || !Number.isFinite(x) || !Number.isFinite(y)
            || !Number.isFinite(radius) || radius < 0) {
            excludedMemberCount++;
            continue;
        }
        livingCount++;
        livingShareUnits += member.shareUnits;
        weightedX += x * member.shareUnits;
        weightedY += y * member.shareUnits;
        minX = Math.min(minX, x - radius);
        minY = Math.min(minY, y - radius);
        maxX = Math.max(maxX, x + radius);
        maxY = Math.max(maxY, y + radius);
        if (!primary || compareMembers(member, primary) < 0) primary = member;
    }
    const hasShare = livingShareUnits > 0;
    return Object.freeze({
        abiVersion: GPU_TOWER_GROUP_ABI_VERSION,
        status: GPU_TOWER_GROUP_SUMMARY_STATUS.OK,
        ...normalizeProtocol(source.protocol),
        sourceTick: requirePositiveUint32(source.sourceTick, 'summary sourceTick'),
        groupRevision: requirePositiveUint32(source.groupRevision, 'summary groupRevision'),
        livingCount,
        centroid: Object.freeze({
            x: hasShare ? Math.fround(weightedX / livingShareUnits) : 0,
            y: hasShare ? Math.fround(weightedY / livingShareUnits) : 0
        }),
        bounds: Object.freeze(livingCount > 0
            ? {
                minX: Math.fround(minX),
                minY: Math.fround(minY),
                maxX: Math.fround(maxX),
                maxY: Math.fround(maxY)
            }
            : { minX: 0, minY: 0, maxX: 0, maxY: 0 }),
        primaryHandle: primary
            ? Object.freeze({
                entityId: primary.entityId,
                incarnation: primary.incarnation
            })
            : null,
        primaryLogicalTowerOrdinal: primary?.logicalTowerOrdinal ?? UINT32_MAX,
        livingShareUnits,
        rosterFingerprint: requirePositiveUint32(
            source.rosterFingerprint,
            'summary rosterFingerprint'
        ),
        excludedMemberCount
    });
}

export { LITTLE_ENDIAN as GPU_TOWER_GROUP_LITTLE_ENDIAN };
