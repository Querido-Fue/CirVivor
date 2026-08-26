import {
    createGpuRegistryMetadata,
    materializeGpuPlainDataSnapshot,
    normalizeGpuSpawnIntent
} from './gpu_spawn_intent.js';
import {
    GPU_BODY_CONTROL_PROGRAM_MODE,
    GPU_BODY_CONTROL_PROGRAM_RESULT,
    GPU_BODY_CONTROL_SELECTED_TARGET_KIND,
    GPU_BODY_CONTROL_SELECTION_POLICY,
    GPU_BODY_CONTROL_STATE_FLAGS,
    GPU_FIXED_PRIMITIVE_TERMINAL_CANCEL_ABI_VERSION,
    GPU_SPAWN_PROGRAM_REQUEST_FLAGS,
    GPU_SPAWN_PROGRAM_MODE
} from '../physics/gpu/gpu_fixed_primitive_abi.js';
import {
    PROJECTILE_SELECTED_TARGET_DISTANCE_POLICY_ID,
    PROJECTILE_SELECTED_TARGET_POLICY_ID,
    PROJECTILE_TARGET_POLICY_ID
} from '../contract/projectile_target_policy_contract.js';
import {
    GAMEPLAY_ALLEGIANCE_POLICY,
    GAMEPLAY_DAMAGE_POLICY_ID,
    GAMEPLAY_TEAM_ID
} from '../contract/gameplay_team_contract.js';
import {
    ARCHER_ATTACK_DATA
} from 'data/object/enemy/archer_attack_data.js';
import {
    HOSTILE_BASIC_BULLET_DATA
} from 'data/object/projectile/hostile_basic_bullet_data.js';
import {
    GPU_TOWER_DEFINITION_ID,
    GPU_TOWER_WORLD_KIND_ID
} from './tower/gpu_tower_spawn_adapter.js';

const INVALID_HANDLE_COMPONENT = 0xffffffff;
const DEFAULT_COMMAND_CAPACITY = 1024;
const DEFAULT_HISTORY_CAPACITY = 65536;
const NORMAL_SPAWN_REJECTION_CODES = new Set([
    'fixed-program-capacity',
    'body-capacity',
    'spawn-program-capacity',
    'spawn-program-readback-capacity',
    'fixed-primitives-unsupported'
]);

function requirePositiveSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number)
        || number <= 0
        || number >= INVALID_HANDLE_COMPONENT) {
        throw new RangeError(`${label}은 reserved sentinel보다 작은 양의 정수여야 합니다.`);
    }
    return number;
}

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

function requireFinite(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || !Number.isFinite(Math.fround(number))) {
        throw new RangeError(`${label}은 유한한 float32 범위 숫자여야 합니다.`);
    }
    return Math.fround(number);
}

function requirePositiveFinite(value, label) {
    const number = requireFinite(value, label);
    if (number <= 0) {
        throw new RangeError(`${label}은 양수여야 합니다.`);
    }
    return number;
}

function requireNonNegativeSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0 || number >= INVALID_HANDLE_COMPONENT) {
        throw new RangeError(`${label}은 reserved sentinel보다 작은 0 이상의 정수여야 합니다.`);
    }
    return number;
}

function normalizeHandle(source, label) {
    if (!source || typeof source !== 'object') {
        throw new TypeError(`${label}은 exact handle 객체여야 합니다.`);
    }
    return Object.freeze({
        entityId: requirePositiveSafeInteger(source.entityId, `${label}.entityId`),
        incarnation: requirePositiveSafeInteger(
            source.incarnation,
            `${label}.incarnation`
        )
    });
}

function reuseCanonicalHandle(source, label) {
    if (!source || typeof source !== 'object' || !Object.isFrozen(source)) {
        throw new TypeError(`${label}은 frozen exact handle 객체여야 합니다.`);
    }
    requirePositiveSafeInteger(source.entityId, `${label}.entityId`);
    requirePositiveSafeInteger(source.incarnation, `${label}.incarnation`);
    return source;
}

function handleKey(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

function stableFingerprint(value, ancestors = new Set()) {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (ancestors.has(value)) {
        throw new TypeError('command payload에 순환 참조가 있습니다.');
    }
    ancestors.add(value);
    let fingerprint;
    if (Array.isArray(value)) {
        fingerprint = `[${value.map((entry) => (
            stableFingerprint(entry, ancestors)
        )).join(',')}]`;
    } else {
        const keys = Object.keys(value).sort();
        fingerprint = `{${keys.map((key) => (
            `${JSON.stringify(key)}:${stableFingerprint(value[key], ancestors)}`
        )).join(',')}}`;
    }
    ancestors.delete(value);
    return fingerprint;
}

function createCommandFingerprintFromPayload(
    type,
    tick,
    payloadFingerprint
) {
    return `{"payload":${payloadFingerprint},`
        + `"tick":${JSON.stringify(tick)},`
        + `"type":${JSON.stringify(type)}}`;
}

function createNonZeroUint32Fingerprint(value) {
    const source = typeof value === 'string' ? value : stableFingerprint(value);
    let hash = 0x811c9dc5;
    for (let index = 0; index < source.length; index++) {
        hash ^= source.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    const result = hash >>> 0;
    return result === 0 ? 1 : result;
}

function createHandleFingerprint(handle) {
    return `{"entityId":${JSON.stringify(handle.entityId)},`
        + `"incarnation":${JSON.stringify(handle.incarnation)}}`;
}

function createOptionalHandleFingerprint(handle) {
    return handle === null ? 'null' : createHandleFingerprint(handle);
}

function createPriorityTargetControlAttackFingerprint(payload) {
    return [
        '{"attackDefinitionId":',
        JSON.stringify(payload.attackDefinitionId),
        ',"attackRangeTiles":',
        JSON.stringify(payload.attackRangeTiles),
        ',"coreTargetHandle":',
        createHandleFingerprint(payload.coreTargetHandle),
        ',"distancePolicyId":',
        JSON.stringify(payload.distancePolicyId),
        ',"producerId":',
        JSON.stringify(payload.producerId),
        ',"projectileDefinitionId":',
        JSON.stringify(payload.projectileDefinitionId),
        ',"selectionSequence":',
        JSON.stringify(payload.selectionSequence),
        ',"sourceAbilityId":',
        JSON.stringify(payload.sourceAbilityId),
        ',"sourceHandle":',
        createHandleFingerprint(payload.sourceHandle),
        ',"stopWhileTargetInRange":true',
        ',"targetFixedTick":',
        JSON.stringify(payload.targetFixedTick),
        ',"targetSelectionPolicyId":',
        JSON.stringify(payload.targetSelectionPolicyId),
        ',"towerTargetHandle":',
        createOptionalHandleFingerprint(payload.towerTargetHandle),
        '}'
    ].join('');
}

function createPriorityTargetControlPayloadFingerprint(payload) {
    return [
        '{"attackDefinitionId":',
        JSON.stringify(payload.attackDefinitionId),
        ',"attackFingerprint":',
        JSON.stringify(payload.attackFingerprint),
        ',"attackRangeTiles":',
        JSON.stringify(payload.attackRangeTiles),
        ',"coreTargetHandle":',
        createHandleFingerprint(payload.coreTargetHandle),
        ',"distancePolicyId":',
        JSON.stringify(payload.distancePolicyId),
        ',"modeFlags":',
        JSON.stringify(payload.modeFlags),
        ',"producerId":',
        JSON.stringify(payload.producerId),
        ',"projectileDefinitionId":',
        JSON.stringify(payload.projectileDefinitionId),
        ',"selectionSequence":',
        JSON.stringify(payload.selectionSequence),
        ',"sourceAbilityId":',
        JSON.stringify(payload.sourceAbilityId),
        ',"sourceHandle":',
        createHandleFingerprint(payload.sourceHandle),
        ',"stopWhileTargetInRange":true',
        ',"targetFixedTick":',
        JSON.stringify(payload.targetFixedTick),
        ',"targetSelectionPolicyId":',
        JSON.stringify(payload.targetSelectionPolicyId),
        ',"towerTargetHandle":',
        createOptionalHandleFingerprint(payload.towerTargetHandle),
        '}'
    ].join('');
}

function normalizeMoveIntent(command) {
    const handle = normalizeHandle(command?.handle ?? command, 'control.handle');
    let moveIntentX = requireFinite(
        command?.moveIntentX ?? command?.moveIntent?.x ?? 0,
        'control.moveIntentX'
    );
    let moveIntentY = requireFinite(
        command?.moveIntentY ?? command?.moveIntent?.y ?? 0,
        'control.moveIntentY'
    );
    const magnitude = Math.hypot(moveIntentX, moveIntentY);
    if (magnitude > 1) {
        moveIntentX = Math.fround(moveIntentX / magnitude);
        moveIntentY = Math.fround(moveIntentY / magnitude);
    }
    return Object.freeze({
        ...handle,
        modeFlags: GPU_BODY_CONTROL_PROGRAM_MODE.MOVE_INTENT,
        moveIntentX,
        moveIntentY
    });
}

function normalizePriorityTargetControl(
    command,
    targetFixedTick,
    canonicalSnapshot = false
) {
    if (!command || typeof command !== 'object') {
        throw new TypeError('priority target control command가 필요합니다.');
    }
    const normalizeExactHandle = canonicalSnapshot
        ? reuseCanonicalHandle
        : normalizeHandle;
    const sourceHandle = normalizeExactHandle(
        command.sourceHandle ?? command.handle,
        'priorityControl.sourceHandle'
    );
    const coreTargetHandle = normalizeExactHandle(
        command.coreTargetHandle,
        'priorityControl.coreTargetHandle'
    );
    const towerTargetHandle = command.towerTargetHandle === undefined
        || command.towerTargetHandle === null
        ? null
        : normalizeExactHandle(
            command.towerTargetHandle,
            'priorityControl.towerTargetHandle'
        );
    const targetSelectionPolicyId = requireNonEmptyString(
        command.targetSelectionPolicyId,
        'priorityControl.targetSelectionPolicyId'
    );
    const distancePolicyId = requireNonEmptyString(
        command.distancePolicyId,
        'priorityControl.distancePolicyId'
    );
    if (targetSelectionPolicyId
            !== PROJECTILE_SELECTED_TARGET_POLICY_ID
                .CORE_FIRST_IN_RANGE_THEN_TOWER
        || distancePolicyId
            !== PROJECTILE_SELECTED_TARGET_DISTANCE_POLICY_ID
                .TICK_START_CENTER_INCLUSIVE
        || command.stopWhileTargetInRange !== true) {
        throw new RangeError('priority target control policy가 canonical M 계약과 다릅니다.');
    }
    const selectionSequence = requireNonNegativeSafeInteger(
        command.selectionSequence ?? command.shotSequence,
        'priorityControl.selectionSequence'
    );
    const attackDefinitionId = requireNonEmptyString(
        command.attackDefinitionId,
        'priorityControl.attackDefinitionId'
    );
    const projectileDefinitionId = requireNonEmptyString(
        command.projectileDefinitionId,
        'priorityControl.projectileDefinitionId'
    );
    const producerId = requireNonEmptyString(
        command.producerId,
        'priorityControl.producerId'
    );
    const sourceAbilityId = requireNonEmptyString(
        command.sourceAbilityId,
        'priorityControl.sourceAbilityId'
    );
    const attackRangeTiles = requirePositiveFinite(
        command.attackRangeTiles,
        'priorityControl.attackRangeTiles'
    );
    const payload = {
        modeFlags: GPU_BODY_CONTROL_PROGRAM_MODE.PRIORITY_TARGET_IN_RANGE,
        sourceHandle,
        coreTargetHandle,
        towerTargetHandle,
        targetFixedTick,
        selectionSequence,
        attackDefinitionId,
        projectileDefinitionId,
        producerId,
        sourceAbilityId,
        attackRangeTiles,
        targetSelectionPolicyId,
        distancePolicyId,
        stopWhileTargetInRange: true,
        attackFingerprint: 0
    };
    payload.attackFingerprint = createNonZeroUint32Fingerprint(
        createPriorityTargetControlAttackFingerprint(payload)
    );
    return Object.freeze(payload);
}

function sameOptionalHandle(left, right) {
    return left === null
        ? right === null
        : right !== null && handleKey(left) === handleKey(right);
}

function hasExactHandleIdentity(source) {
    return source !== null
        && typeof source === 'object'
        && Number.isSafeInteger(source.entityId)
        && source.entityId > 0
        && Number.isSafeInteger(source.incarnation)
        && source.incarnation > 0;
}

function rawHandleMatches(source, expected, label) {
    if (!source || typeof source !== 'object') {
        throw new TypeError(`${label}은 exact handle 객체여야 합니다.`);
    }
    const entityId = requirePositiveSafeInteger(
        source.entityId,
        `${label}.entityId`
    );
    const incarnation = requirePositiveSafeInteger(
        source.incarnation,
        `${label}.incarnation`
    );
    return expected !== null
        && entityId === expected.entityId
        && incarnation === expected.incarnation;
}

function rawOptionalHandleMatches(source, expected, label) {
    if (source === undefined || source === null) {
        return expected === null;
    }
    return rawHandleMatches(source, expected, label);
}

function normalizeSelectedTargetIntent(source, subjectTeamId, controlPayload) {
    if (!source || typeof source !== 'object') {
        throw new TypeError('selected-target spawn intent가 필요합니다.');
    }
    const sourceHandle = normalizeHandle(
        source.sourceHandle,
        'selectedTargetSpawn.sourceHandle'
    );
    const coreTargetHandle = normalizeHandle(
        source.coreTargetHandle,
        'selectedTargetSpawn.coreTargetHandle'
    );
    const towerTargetHandle = source.towerTargetHandle === undefined
        || source.towerTargetHandle === null
        ? null
        : normalizeHandle(
            source.towerTargetHandle,
            'selectedTargetSpawn.towerTargetHandle'
        );
    const attackRangeTiles = requirePositiveFinite(
        source.attackRangeTiles,
        'selectedTargetSpawn.attackRangeTiles'
    );
    const targetSelectionPolicyId = requireNonEmptyString(
        source.targetSelectionPolicyId,
        'selectedTargetSpawn.targetSelectionPolicyId'
    );
    const distancePolicyId = requireNonEmptyString(
        source.distancePolicyId,
        'selectedTargetSpawn.distancePolicyId'
    );
    if (source.stopWhileTargetInRange !== true
        || targetSelectionPolicyId
            !== PROJECTILE_SELECTED_TARGET_POLICY_ID
                .CORE_FIRST_IN_RANGE_THEN_TOWER
        || distancePolicyId
            !== PROJECTILE_SELECTED_TARGET_DISTANCE_POLICY_ID
                .TICK_START_CENTER_INCLUSIVE) {
        throw new RangeError('selected-target spawn policy가 canonical M 계약과 다릅니다.');
    }
    const destinationSpawn = normalizeGpuSpawnIntent(
        source.destinationSpawn,
        { subjectTeamId }
    );
    const selectionSequence = requireNonNegativeSafeInteger(
        destinationSpawn.spawnSequence,
        'selectedTargetSpawn.destinationSpawn.spawnSequence'
    );
    if (!controlPayload
        || !sameOptionalHandle(sourceHandle, controlPayload.sourceHandle)
        || !sameOptionalHandle(coreTargetHandle, controlPayload.coreTargetHandle)
        || !sameOptionalHandle(towerTargetHandle, controlPayload.towerTargetHandle)
        || attackRangeTiles !== controlPayload.attackRangeTiles
        || selectionSequence !== controlPayload.selectionSequence
        || targetSelectionPolicyId !== controlPayload.targetSelectionPolicyId
        || distancePolicyId !== controlPayload.distancePolicyId
        || destinationSpawn.definitionId !== controlPayload.projectileDefinitionId
        || destinationSpawn.producerId !== controlPayload.producerId
        || destinationSpawn.sourceAbilityId !== controlPayload.sourceAbilityId
        || destinationSpawn.sourceEntityId !== sourceHandle.entityId
        || destinationSpawn.sourceIncarnation !== sourceHandle.incarnation
        || destinationSpawn.ownerEntityId !== sourceHandle.entityId
        || destinationSpawn.ownerIncarnation !== sourceHandle.incarnation
        || destinationSpawn.coreTargetEntityId !== coreTargetHandle.entityId
        || destinationSpawn.coreTargetIncarnation !== coreTargetHandle.incarnation
        || (towerTargetHandle === null
            ? destinationSpawn.towerTargetEntityId !== undefined
                || destinationSpawn.towerTargetIncarnation !== undefined
            : destinationSpawn.towerTargetEntityId !== towerTargetHandle.entityId
                || destinationSpawn.towerTargetIncarnation
                    !== towerTargetHandle.incarnation)) {
        throw new RangeError('selected-target spawn이 same source/tick control fingerprint와 다릅니다.');
    }
    const launchSpeed = requirePositiveFinite(
        source.launchSpeed,
        'selectedTargetSpawn.launchSpeed'
    );
    return Object.freeze({
        modeFlags:
            GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_SELECTED_PRIORITY_TARGET,
        sourceHandle,
        coreTargetHandle,
        towerTargetHandle,
        destinationSpawn,
        positionOffset: normalizeRequiredVector(
            source.positionOffset,
            'selectedTargetSpawn.positionOffset'
        ),
        targetOffset: normalizeVector(
            source.targetOffset,
            'selectedTargetSpawn.targetOffset'
        ),
        launchSpeed,
        attackRangeTiles,
        targetSelectionPolicyId,
        distancePolicyId,
        selectionSequence,
        attackFingerprint: controlPayload.attackFingerprint,
        attackDefinitionId: controlPayload.attackDefinitionId,
        requestFlags:
            GPU_SPAWN_PROGRAM_REQUEST_FLAGS.REQUIRE_EXACT_SELECTED_TARGET
    });
}

function normalizeVector(source, label) {
    return Object.freeze({
        x: requireFinite(source?.x ?? 0, `${label}.x`),
        y: requireFinite(source?.y ?? 0, `${label}.y`)
    });
}

function normalizeRequiredVector(source, label) {
    if (!source || typeof source !== 'object') {
        throw new TypeError(`${label} 벡터가 필요합니다.`);
    }
    return normalizeVector(source, label);
}

function rejectPresentProperties(source, propertyNames, label) {
    for (const propertyName of propertyNames) {
        if (Object.prototype.hasOwnProperty.call(source, propertyName)) {
            throw new TypeError(`${label}에는 ${propertyName}을(를) 사용할 수 없습니다.`);
        }
    }
}

function normalizeSourceRelativeMode(source) {
    const modeFlags = requirePositiveSafeInteger(
        source?.modeFlags ?? GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_VELOCITY,
        'sourceRelativeSpawn.modeFlags'
    );
    if (modeFlags !== GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_VELOCITY
        && modeFlags !== GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_AIM_POINT
        && modeFlags !== GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY) {
        throw new RangeError(
            `지원하지 않는 source-relative SpawnProgram mode입니다: ${modeFlags}`
        );
    }
    return modeFlags;
}

function normalizeSourceRelativeRequestFlags(source, exact) {
    const requestFlags = requireUint32Like(
        source?.requestFlags ?? 0,
        'sourceRelativeSpawn.requestFlags'
    );
    if (requestFlags === 0) {
        return 0;
    }
    const destinationSpawn = exact.destinationSpawn;
    const sourceView = exact.sourceView;
    const targetView = exact.targetView;
    const canonical = requestFlags
            === GPU_SPAWN_PROGRAM_REQUEST_FLAGS.TOWER_DAMAGE_CHANNEL
        && exact.modeFlags
            === GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY
        && sourceView?.entityId === exact.sourceHandle.entityId
        && sourceView?.incarnation === exact.sourceHandle.incarnation
        && sourceView?.kindId === 'enemy'
        && sourceView?.definitionId === ARCHER_ATTACK_DATA.sourceEnemyDefinitionId
        && sourceView?.metadata?.definitionId
            === ARCHER_ATTACK_DATA.sourceEnemyDefinitionId
        && sourceView?.metadata?.teamId === GAMEPLAY_TEAM_ID.HOSTILE
        && targetView?.entityId === exact.targetHandle?.entityId
        && targetView?.incarnation === exact.targetHandle?.incarnation
        && targetView?.kindId === GPU_TOWER_WORLD_KIND_ID
        && targetView?.definitionId === GPU_TOWER_DEFINITION_ID
        && targetView?.metadata?.definitionId === GPU_TOWER_DEFINITION_ID
        && targetView?.metadata?.teamId === GAMEPLAY_TEAM_ID.PLAYER
        && destinationSpawn.kindId === 'projectile'
        && destinationSpawn.definitionId === HOSTILE_BASIC_BULLET_DATA.id
        && destinationSpawn.teamId === GAMEPLAY_TEAM_ID.HOSTILE
        && destinationSpawn.allegiancePolicy
            === GAMEPLAY_ALLEGIANCE_POLICY.INHERIT_SUBJECT
        && destinationSpawn.damagePolicyId
            === GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX
        && destinationSpawn.targetPolicyId
            === PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN
        && destinationSpawn.producerId === ARCHER_ATTACK_DATA.producerId
        && destinationSpawn.sourceAbilityId === ARCHER_ATTACK_DATA.sourceAbilityId
        && destinationSpawn.targetEntityId === exact.targetHandle.entityId
        && destinationSpawn.targetIncarnation === exact.targetHandle.incarnation
        && Number(destinationSpawn.contactHandler?.damageOther)
            === HOSTILE_BASIC_BULLET_DATA.damage;
    if (!canonical) {
        throw new RangeError(
            'Tower damage channel flag는 canonical Archer exact Tower projectile에만 허용됩니다.'
        );
    }
    return requestFlags;
}

function normalizeSourceRelativeIntent(source, subjectTeamId, exact = {}) {
    if (!source || typeof source !== 'object') {
        throw new TypeError('source-relative spawn intent가 필요합니다.');
    }
    const modeFlags = exact.modeFlags ?? normalizeSourceRelativeMode(source);
    const sourceHandle = exact.sourceHandle ?? normalizeHandle(
        source.sourceHandle,
        'sourceRelativeSpawn.sourceHandle'
    );
    const isTargetEntity = modeFlags
        === GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY;
    const targetHandle = isTargetEntity
        ? exact.targetHandle ?? normalizeHandle(
            source.targetHandle,
            'sourceRelativeSpawn.targetHandle'
        )
        : null;
    const suppliedDestinationSpawn = normalizeGpuSpawnIntent(
        source.destinationSpawn
            ?? source.destinationIntent
            ?? source.spawnIntent,
        { subjectTeamId }
    );
    const hasSourceEntityId = suppliedDestinationSpawn.sourceEntityId !== undefined
        && suppliedDestinationSpawn.sourceEntityId !== null;
    const hasSourceIncarnation = suppliedDestinationSpawn.sourceIncarnation !== undefined
        && suppliedDestinationSpawn.sourceIncarnation !== null;
    if (hasSourceEntityId !== hasSourceIncarnation) {
        throw new TypeError(
            'source-relative destination metadata에는 sourceEntityId/sourceIncarnation이 모두 필요합니다.'
        );
    }
    if (hasSourceEntityId
        && (suppliedDestinationSpawn.sourceEntityId !== sourceHandle.entityId
            || suppliedDestinationSpawn.sourceIncarnation !== sourceHandle.incarnation)) {
        throw new RangeError(
            'source-relative destination metadata는 actual sourceHandle과 정확히 일치해야 합니다.'
        );
    }
    const hasTargetEntityId = suppliedDestinationSpawn.targetEntityId !== undefined
        && suppliedDestinationSpawn.targetEntityId !== null;
    const hasTargetIncarnation = suppliedDestinationSpawn.targetIncarnation !== undefined
        && suppliedDestinationSpawn.targetIncarnation !== null;
    if (hasTargetEntityId !== hasTargetIncarnation) {
        throw new TypeError(
            'source-relative destination metadata에는 targetEntityId/targetIncarnation이 모두 필요합니다.'
        );
    }
    if (!isTargetEntity && hasTargetEntityId) {
        throw new TypeError(
            'non-targeted source-relative destination에는 target provenance를 사용할 수 없습니다.'
        );
    }
    if (isTargetEntity && hasTargetEntityId
        && (suppliedDestinationSpawn.targetEntityId !== targetHandle.entityId
            || suppliedDestinationSpawn.targetIncarnation !== targetHandle.incarnation)) {
        throw new RangeError(
            'targeted destination metadata는 actual targetHandle과 정확히 일치해야 합니다.'
        );
    }
    const destinationSpawn = Object.freeze({
        ...suppliedDestinationSpawn,
        sourceEntityId: sourceHandle.entityId,
        sourceIncarnation: sourceHandle.incarnation,
        ...(isTargetEntity ? {
            targetEntityId: targetHandle.entityId,
            targetIncarnation: targetHandle.incarnation
        } : {})
    });
    const requestFlags = normalizeSourceRelativeRequestFlags(source, {
        ...exact,
        modeFlags,
        sourceHandle,
        targetHandle,
        destinationSpawn
    });
    const base = {
        sourceHandle,
        destinationSpawn,
        modeFlags,
        positionOffset: isTargetEntity
            ? normalizeRequiredVector(
                source.positionOffset,
                'sourceRelativeSpawn.positionOffset'
            )
            : normalizeVector(
                source.positionOffset,
                'sourceRelativeSpawn.positionOffset'
            )
    };
    if (modeFlags === GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_VELOCITY) {
        rejectPresentProperties(source, [
            'aimWorldPoint',
            'launchSpeed',
            'targetHandle',
            'targetOffset'
        ], 'velocity source-relative intent');
        return Object.freeze({
            ...base,
            launchVelocity: normalizeRequiredVector(
                source.launchVelocity,
                'sourceRelativeSpawn.launchVelocity'
            ),
            sourceVelocityScale: requireFinite(
                source.sourceVelocityScale ?? 0,
                'sourceRelativeSpawn.sourceVelocityScale'
            )
        });
    }
    if (modeFlags === GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_AIM_POINT) {
        rejectPresentProperties(source, [
            'launchVelocity',
            'sourceVelocityScale',
            'targetHandle',
            'targetOffset'
        ], 'aim-point source-relative intent');
        const launchSpeed = requireFinite(
            source.launchSpeed,
            'sourceRelativeSpawn.launchSpeed'
        );
        if (launchSpeed <= 0) {
            throw new RangeError('sourceRelativeSpawn.launchSpeed는 양수여야 합니다.');
        }
        return Object.freeze({
            ...base,
            aimWorldPoint: normalizeRequiredVector(
                source.aimWorldPoint,
                'sourceRelativeSpawn.aimWorldPoint'
            ),
            launchSpeed
        });
    }
    rejectPresentProperties(source, [
        'position',
        'velocity',
        'launchVelocity',
        'sourceVelocityScale',
        'aimWorldPoint',
        'trackedPose',
        'targetPosition',
        'targetWorldPosition',
        'cpuTargetPosition'
    ], 'target-entity source-relative intent');
    const launchSpeed = requireFinite(
        source.launchSpeed,
        'sourceRelativeSpawn.launchSpeed'
    );
    if (launchSpeed <= 0) {
        throw new RangeError('sourceRelativeSpawn.launchSpeed는 양수여야 합니다.');
    }
    return Object.freeze({
        ...base,
        targetHandle,
        targetOffset: normalizeVector(
            source.targetOffset,
            'sourceRelativeSpawn.targetOffset'
        ),
        launchSpeed,
        requestFlags
    });
}

function commandDomain(command) {
    return command?.type === 'control'
        || command?.type === 'priority-target-control'
        ? 'control'
        : 'spawn';
}

function isControlCommand(command) {
    return command?.type === 'control'
        || command?.type === 'priority-target-control';
}

function isSelectedTargetSpawnCommand(command) {
    return command?.type === 'selected-target-spawn';
}

function priorityControlBindingKey(sourceTick, sourceHandle) {
    return `${sourceTick}:${handleKey(sourceHandle)}`;
}

function selectedSpawnBindingKey(
    sourceTick,
    sourceHandle,
    controlCommandId,
    selectionSequence
) {
    return [
        priorityControlBindingKey(sourceTick, sourceHandle),
        controlCommandId,
        selectionSequence
    ].join(':');
}

function normalizeBackendDomainResult(
    backendResult,
    propertyName,
    expectedCount,
    totalExpectedCount
) {
    if (expectedCount === 0) {
        return Object.freeze({ accepted: 0, rejected: 0, reason: null });
    }
    const explicit = backendResult?.[propertyName];
    if (explicit && typeof explicit === 'object') {
        return Object.freeze({
            accepted: Number(explicit.accepted),
            rejected: Number(explicit.rejected),
            reason: explicit.reason ?? backendResult?.reason ?? null
        });
    }
    const flatAccepted = Number(backendResult?.accepted);
    const flatRejected = Number(backendResult?.rejected ?? 0);
    if (flatAccepted === totalExpectedCount && flatRejected === 0) {
        return Object.freeze({ accepted: expectedCount, rejected: 0, reason: null });
    }
    if (expectedCount === totalExpectedCount) {
        return Object.freeze({
            accepted: flatAccepted,
            rejected: flatRejected,
            reason: backendResult?.reason ?? null
        });
    }
    return Object.freeze({
        accepted: Number.NaN,
        rejected: Number.NaN,
        reason: backendResult?.reason ?? 'fixed-program-domain-contract'
    });
}

function normalizePriorityControlCompletionOutcome(
    source,
    pending,
    sourceTick,
    sourceEntityId,
    sourceIncarnation,
    isValidRosterTowerTarget
) {
    if (!source || typeof source !== 'object') {
        throw new TypeError('BodyControlProgram priority outcome 객체가 필요합니다.');
    }
    const coreTargetMatches = rawHandleMatches(
        source.coreTargetHandle,
        pending.payload.coreTargetHandle,
        'priorityControlOutcome.coreTargetHandle'
    );
    const towerTargetMatches = rawOptionalHandleMatches(
        source.towerTargetHandle,
        pending.payload.towerTargetHandle,
        'priorityControlOutcome.towerTargetHandle'
    );
    const outcomeSourceTick = requirePositiveSafeInteger(
        source.sourceTick,
        'priorityControlOutcome.sourceTick'
    );
    const selectionSequence = requireNonNegativeSafeInteger(
        source.selectionSequence,
        'priorityControlOutcome.selectionSequence'
    );
    const attackFingerprint = requirePositiveSafeInteger(
        source.attackFingerprint,
        'priorityControlOutcome.attackFingerprint'
    );
    const attackRangeTiles = requirePositiveFinite(
        source.attackRangeTiles,
        'priorityControlOutcome.attackRangeTiles'
    );
    if (sourceTick !== pending.targetFixedTick
        || outcomeSourceTick !== sourceTick
        || sourceEntityId !== pending.payload.sourceHandle.entityId
        || sourceIncarnation !== pending.payload.sourceHandle.incarnation
        || !coreTargetMatches
        || !towerTargetMatches
        || selectionSequence !== pending.payload.selectionSequence
        || attackFingerprint !== pending.payload.attackFingerprint
        || attackRangeTiles !== pending.payload.attackRangeTiles) {
        throw new RangeError(
            'BodyControlProgram priority outcome이 pending exact command와 다릅니다.'
        );
    }

    const result = requireUint32Like(
        source.result,
        'priorityControlOutcome.result'
    );
    const selectedTargetKind = requireUint32Like(
        source.selectedTargetKind,
        'priorityControlOutcome.selectedTargetKind'
    );
    const stateFlags = requireUint32Like(
        source.stateFlags,
        'priorityControlOutcome.stateFlags'
    );
    const rawSelectedTargetHandle = source.selectedTargetHandle;
    let selectedTargetEntityId = null;
    let selectedTargetIncarnation = null;
    if (rawSelectedTargetHandle !== undefined
        && rawSelectedTargetHandle !== null) {
        if (typeof rawSelectedTargetHandle !== 'object') {
            throw new TypeError(
                'priorityControlOutcome.selectedTargetHandle은 exact handle 객체여야 합니다.'
            );
        }
        selectedTargetEntityId = requirePositiveSafeInteger(
            rawSelectedTargetHandle.entityId,
            'priorityControlOutcome.selectedTargetHandle.entityId'
        );
        selectedTargetIncarnation = requirePositiveSafeInteger(
            rawSelectedTargetHandle.incarnation,
            'priorityControlOutcome.selectedTargetHandle.incarnation'
        );
    }
    let outcome;
    let expectedKind = GPU_BODY_CONTROL_SELECTED_TARGET_KIND.NONE;
    let expectedStateFlags = 0;
    let expectedTargetHandle = null;
    if (result === GPU_BODY_CONTROL_PROGRAM_RESULT.NO_TARGET) {
        outcome = 'no-target';
        expectedStateFlags = GPU_BODY_CONTROL_STATE_FLAGS.ROUTE_FLOW;
    } else if (result === GPU_BODY_CONTROL_PROGRAM_RESULT.CORE_SELECTED) {
        outcome = 'core';
        expectedKind = GPU_BODY_CONTROL_SELECTED_TARGET_KIND.CORE;
        expectedStateFlags = GPU_BODY_CONTROL_STATE_FLAGS.STOP
            | GPU_BODY_CONTROL_STATE_FLAGS.CORE_SELECTED;
        expectedTargetHandle = pending.payload.coreTargetHandle;
    } else if (result === GPU_BODY_CONTROL_PROGRAM_RESULT.TOWER_SELECTED) {
        outcome = 'tower';
        expectedKind = GPU_BODY_CONTROL_SELECTED_TARGET_KIND.TOWER;
        expectedStateFlags = GPU_BODY_CONTROL_STATE_FLAGS.STOP
            | GPU_BODY_CONTROL_STATE_FLAGS.TOWER_SELECTED;
    } else if (result === GPU_BODY_CONTROL_PROGRAM_RESULT.SOURCE_INVALID) {
        outcome = 'source-invalid';
    } else if (result === GPU_BODY_CONTROL_PROGRAM_RESULT.CORE_INVALID) {
        outcome = 'core-invalid';
    } else {
        throw new RangeError(
            `지원하지 않는 BodyControlProgram priority result입니다: ${result}`
        );
    }
    let selectedTargetHandle = null;
    let targetMatches;
    if (outcome === 'tower') {
        selectedTargetHandle = selectedTargetEntityId === null
            ? null
            : Object.freeze({
                entityId: selectedTargetEntityId,
                incarnation: selectedTargetIncarnation
            });
        targetMatches = selectedTargetHandle !== null
            && isValidRosterTowerTarget(selectedTargetHandle);
    } else if (selectedTargetEntityId === null) {
        targetMatches = expectedTargetHandle === null;
    } else {
        targetMatches = expectedTargetHandle !== null
            && selectedTargetEntityId === expectedTargetHandle.entityId
            && selectedTargetIncarnation === expectedTargetHandle.incarnation;
        if (targetMatches) {
            selectedTargetHandle = expectedTargetHandle;
        }
    }
    if (source.outcome !== outcome
        || selectedTargetKind !== expectedKind
        || stateFlags !== expectedStateFlags
        || !targetMatches) {
        throw new RangeError(
            'BodyControlProgram priority result/kind/state/target 조합이 올바르지 않습니다.'
        );
    }
    return Object.freeze({
        commandId: pending.commandId,
        sourceHandle: pending.payload.sourceHandle,
        coreTargetHandle: pending.payload.coreTargetHandle,
        towerTargetHandle: pending.payload.towerTargetHandle,
        targetFixedTick: pending.targetFixedTick,
        sourceTick,
        selectionSequence,
        attackFingerprint,
        attackRangeTiles,
        attackDefinitionId: pending.payload.attackDefinitionId,
        projectileDefinitionId: pending.payload.projectileDefinitionId,
        producerId: pending.payload.producerId,
        sourceAbilityId: pending.payload.sourceAbilityId,
        result,
        outcome,
        selectedTargetKind,
        selectedTargetHandle,
        stateFlags
    });
}

function hasAuthoritativeTowerRoster(backend) {
    const status = backend.getTowerGroupRuntimeStatus?.();
    return status?.state === 'ready'
        && Number.isSafeInteger(status.groupRevision)
        && status.groupRevision > 0
        && Number.isSafeInteger(status.rosterFingerprint)
        && status.rosterFingerprint > 0;
}

function requireUint32Like(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0 || number > 0xffffffff) {
        throw new RangeError(`${label}은 uint32 정수여야 합니다.`);
    }
    return number >>> 0;
}

function preflightGpuRegistryActivationMetadata(intent, activationEvidence) {
    const created = createGpuRegistryMetadata(intent, activationEvidence);
    const metadata = materializeGpuPlainDataSnapshot(
        created,
        'gpuRegistryActivationMetadata'
    );
    if (stableFingerprint(created) !== stableFingerprint(metadata)
        || metadata.definitionId !== intent.definitionId
        || metadata.teamId !== intent.teamId
        || metadata.damagePolicyId !== intent.damagePolicyId
        || metadata.allegiancePolicy !== intent.allegiancePolicy
        || metadata.producerId !== intent.producerId
        || metadata.sourceAbilityId !== intent.sourceAbilityId
        || metadata.targetPolicyId !== intent.targetPolicyId) {
        throw new RangeError(
            'GPU registry activation metadata가 canonical spawn intent와 다릅니다.'
        );
    }
    if (activationEvidence
        && (metadata.selectedTargetKind
                !== activationEvidence.selectedTargetKind
            || metadata.selectedTargetEntityId
                !== activationEvidence.selectedTargetHandle.entityId
            || metadata.selectedTargetIncarnation
                !== activationEvidence.selectedTargetHandle.incarnation
            || metadata.selectionSourceTick
                !== activationEvidence.selectionSourceTick
            || metadata.selectionSequence
                !== activationEvidence.selectionSequence
            || metadata.attackFingerprint
                !== activationEvidence.attackFingerprint)) {
        throw new RangeError(
            'GPU selected-target activation evidence가 canonical metadata에 보존되지 않았습니다.'
        );
    }
    return metadata;
}

function assertBackend(backend) {
    for (const methodName of [
        'hasBody',
        'canControlBody',
        'stageFixedPrograms',
        'cancelPendingFixedProgramsForTerminal',
        'drainCompletedBodyControlProgramBatches',
        'drainCompletedSpawnProgramBatches',
        'getEventProtocolState',
        'requiresRecovery',
        'getRuntimeState'
    ]) {
        if (typeof backend?.[methodName] !== 'function') {
            throw new TypeError(`fixed command backend.${methodName}()가 필요합니다.`);
        }
    }
    return backend;
}

function assertRegistry(registry) {
    for (const methodName of [
        'reserveEntity',
        'activateReserved',
        'cancelReservation',
        'has',
        'hasReservation',
        'copyEntityView',
        'getRevision',
        'getStatus'
    ]) {
        if (typeof registry?.[methodName] !== 'function') {
            throw new TypeError(`fixed command registry.${methodName}()가 필요합니다.`);
        }
    }
    return registry;
}

function normalizeProtocol(source, label) {
    const sessionGeneration = Number(source?.sessionGeneration);
    const deviceGeneration = Number(source?.deviceGeneration);
    const authoritativeEpoch = Number(source?.authoritativeEpoch);
    if (!Number.isSafeInteger(sessionGeneration) || sessionGeneration <= 0
        || !Number.isSafeInteger(deviceGeneration) || deviceGeneration < 0
        || !Number.isSafeInteger(authoritativeEpoch) || authoritativeEpoch < 0) {
        throw new RangeError(`${label} generation/epoch가 유효하지 않습니다.`);
    }
    return Object.freeze({ sessionGeneration, deviceGeneration, authoritativeEpoch });
}

function sameProtocol(left, right) {
    return left.sessionGeneration === right.sessionGeneration
        && left.deviceGeneration === right.deviceGeneration
        && left.authoritativeEpoch === right.authoritativeEpoch;
}

function freezeResult(result) {
    return Object.freeze({
        fixedTick: result.fixedTick,
        state: result.state,
        controls: Object.freeze(result.controls.map((entry) => Object.freeze(entry))),
        sourceRelativeSpawns: Object.freeze(
            result.sourceRelativeSpawns.map((entry) => Object.freeze(entry))
        ),
        selectedTargetSpawns: Object.freeze(
            result.selectedTargetSpawns.map((entry) => Object.freeze(entry))
        ),
        priorityTargetControlResults: Object.freeze(
            result.priorityTargetControlResults.map((entry) => (
                Object.freeze(entry)
            ))
        ),
        priorityTargetControlCompletedThroughTick:
            result.priorityTargetControlCompletedThroughTick,
        rejected: Object.freeze(result.rejected.map((entry) => Object.freeze(entry))),
        completed: Object.freeze(result.completed.map((entry) => Object.freeze(entry))),
        ingressOpen: result.ingressOpen !== false,
        ingressCloseReason: result.ingressCloseReason ?? null,
        recoveryRequired: result.recoveryRequired === true,
        protocolFailure: result.protocolFailure ?? null
    });
}

/**
 * @class GpuFixedCommandOwner
 * @description Generic move/priority control과 source-relative/selected SpawnProgram reservation을 bounded하게 소유합니다.
 */
export class GpuFixedCommandOwner {
    constructor(backend, registry, options = {}) {
        this.backend = assertBackend(backend);
        this.registry = assertRegistry(registry);
        this.usesSharedCommandCapacity = options.commandCapacity !== undefined
            && options.controlCommandCapacity === undefined
            && options.sourceRelativeSpawnCommandCapacity === undefined;
        const sharedCapacity = requirePositiveSafeInteger(
            options.commandCapacity ?? DEFAULT_COMMAND_CAPACITY,
            'commandCapacity'
        );
        this.controlCommandCapacity = this.usesSharedCommandCapacity
            ? sharedCapacity
            : requirePositiveSafeInteger(
                options.controlCommandCapacity ?? sharedCapacity,
                'controlCommandCapacity'
            );
        this.sourceRelativeSpawnCommandCapacity = this.usesSharedCommandCapacity
            ? sharedCapacity
            : requirePositiveSafeInteger(
                options.sourceRelativeSpawnCommandCapacity ?? sharedCapacity,
                'sourceRelativeSpawnCommandCapacity'
            );
        this.commandCapacity = this.usesSharedCommandCapacity
            ? sharedCapacity
            : this.controlCommandCapacity + this.sourceRelativeSpawnCommandCapacity;
        this.historyCapacity = requirePositiveSafeInteger(
            options.historyCapacity ?? DEFAULT_HISTORY_CAPACITY,
            'historyCapacity'
        );
        this.pending = new Array(this.commandCapacity).fill(null);
        this.freePendingSlots = Array.from(
            { length: this.commandCapacity },
            (_, index) => this.commandCapacity - index - 1
        );
        this.pendingByCommandId = new Map();
        this.pendingCommandsByTargetFixedTick = new Map();
        this.pendingCount = 0;
        this.pendingControlCount = 0;
        this.pendingSourceRelativeSpawnCount = 0;
        this.nextSequence = 1;
        this.knownCommands = new Map();
        this.completedCommandIds = [];
        this.completedCommandHead = 0;
        this.controlTargetKeys = new Map();
        this.selectionBindingClaims = new Map();
        this.pendingPriorityControlsByKey = new Map();
        this.pendingPriorityControlsByCommandId = new Map();
        this.pendingPriorityControlsBySourceTick = new Map();
        this.pendingDestinations = new Map();
        this.bodyControlCompletionScratch = [];
        this.spawnCompletionScratch = [];
        this.priorityTargetControlCompletedThroughTick = 0;
        this.lastCommitResult = null;
        this.lastCompletionResult = Object.freeze({
            fixedTick: 0,
            priorityTargetControlResults: Object.freeze([]),
            priorityTargetControlCompletedThroughTick: 0,
            completed: Object.freeze([]),
            protocolFailure: null
        });
        this.telemetry = {
            replayed: 0,
            coalesced: 0,
            conflicted: 0,
            stale: 0,
            capacityRejected: 0,
            completedResolved: 0,
            completedSourceInvalid: 0,
            completedTargetInvalid: 0,
            completedNoTarget: 0,
            completedCoreInvalid: 0,
            priorityControlCompletedNoTarget: 0,
            priorityControlCompletedCore: 0,
            priorityControlCompletedTower: 0,
            priorityControlCompletedSourceInvalid: 0,
            priorityControlCompletedCoreInvalid: 0
        };
        this.recoveryRequired = false;
        this.ingressOpen = true;
        this.ingressCloseReason = null;
        this.terminalCancelResult = null;
        this.destroyed = false;
        this.canonicalHostileCommandPort = Object.freeze({
            requestPriorityTargetControl: (
                command,
                targetFixedTick,
                commandId
            ) => this.#requestPriorityTargetControl(
                command,
                targetFixedTick,
                commandId,
                true
            ),
            requestSelectedTargetSpawn: (
                intent,
                targetFixedTick,
                commandId
            ) => this.#requestSelectedTargetSpawn(
                intent,
                targetFixedTick,
                commandId,
                true
            ),
            requestSourceRelativeSpawn: (
                intent,
                targetFixedTick,
                commandId
            ) => this.#requestSourceRelativeSpawn(
                intent,
                targetFixedTick,
                commandId,
                true
            )
        });
    }

    /** Hostile director가 이미 만든 frozen canonical command 전용 port입니다. */
    getCanonicalHostileCommandPort() {
        this.#assertUsable();
        return this.canonicalHostileCommandPort;
    }

    requestBodyControl(command, targetFixedTick, commandId) {
        this.#assertUsable();
        const rejected = this.#rejectClosedIngress();
        if (rejected) {
            return rejected;
        }
        const tick = requirePositiveSafeInteger(targetFixedTick, 'targetFixedTick');
        const id = requireNonEmptyString(commandId, 'commandId');
        const payload = normalizeMoveIntent(command);
        const payloadFingerprint = stableFingerprint(payload);
        const fingerprint = createCommandFingerprintFromPayload(
            'control',
            tick,
            payloadFingerprint
        );
        const duplicate = this.#handleKnownCommand(id, fingerprint);
        if (duplicate) {
            return duplicate;
        }
        const targetDisposition = this.#getExactActiveDisposition(payload);
        if (targetDisposition !== 'active') {
            this.telemetry.stale++;
            return this.#rememberImmediateRejection(
                id,
                fingerprint,
                targetDisposition === 'desync'
                    ? 'registry-backend-desync'
                    : 'stale-handle'
            );
        }
        if (!this.backend.canControlBody(payload)) {
            return this.#rememberImmediateRejection(
                id,
                fingerprint,
                'flow-body-not-controllable'
            );
        }
        const targetKey = `${tick}:${handleKey(payload)}`;
        const existing = this.controlTargetKeys.get(targetKey);
        if (existing?.state === 'conflicted') {
            this.telemetry.conflicted++;
            return this.#rememberImmediateRejection(
                id,
                fingerprint,
                'body-tick-conflict'
            );
        }
        if (existing) {
            if (existing.payloadFingerprint === payloadFingerprint) {
                this.telemetry.coalesced++;
                const receipt = Object.freeze({
                    accepted: true,
                    commandId: id,
                    targetFixedTick: tick,
                    coalesced: true,
                    canonicalCommandId: existing.command.commandId
                });
                this.#evictCompletedHistoryForInsert();
                if (this.knownCommands.size >= this.historyCapacity) {
                    this.telemetry.capacityRejected++;
                    return Object.freeze({
                        accepted: false,
                        commandId: id,
                        reason: 'command-history-capacity'
                    });
                }
                this.knownCommands.set(id, { fingerprint, receipt, completed: true });
                this.#rememberCompleted(id);
                return receipt;
            }
            existing.command.conflicted = true;
            this.controlTargetKeys.set(targetKey, { state: 'conflicted' });
            this.telemetry.conflicted++;
            return this.#rememberImmediateRejection(
                id,
                fingerprint,
                'body-tick-conflict'
            );
        }
        const enqueued = this.#enqueue({
            type: 'control',
            commandId: id,
            targetFixedTick: tick,
            payload,
            protocol: normalizeProtocol(
                this.backend.getEventProtocolState(),
                'control.protocol'
            ),
            targetKey,
            conflicted: false
        }, fingerprint);
        if (enqueued.accepted) {
            this.controlTargetKeys.set(targetKey, {
                state: 'pending',
                command: enqueued.command,
                payloadFingerprint
            });
        }
        return enqueued.receipt;
    }

    /** Core-first inclusive range selection과 persistent stop/route state를 stage합니다. */
    requestPriorityTargetControl(command, targetFixedTick, commandId) {
        return this.#requestPriorityTargetControl(
            command,
            targetFixedTick,
            commandId,
            false
        );
    }

    #requestPriorityTargetControl(
        command,
        targetFixedTick,
        commandId,
        canonicalSnapshot
    ) {
        this.#assertUsable();
        const rejected = this.#rejectClosedIngress();
        if (rejected) {
            return rejected;
        }
        const tick = requirePositiveSafeInteger(targetFixedTick, 'targetFixedTick');
        const id = requireNonEmptyString(commandId, 'commandId');
        if (canonicalSnapshot && !Object.isFrozen(command)) {
            throw new TypeError(
                'canonical priority target control은 frozen이어야 합니다.'
            );
        }
        const payload = normalizePriorityTargetControl(
            command,
            tick,
            canonicalSnapshot
        );
        const payloadFingerprint
            = createPriorityTargetControlPayloadFingerprint(payload);
        const fingerprint = createCommandFingerprintFromPayload(
            'priority-target-control',
            tick,
            payloadFingerprint
        );
        const duplicate = this.#handleKnownCommand(id, fingerprint);
        if (duplicate) {
            return duplicate;
        }
        const sourceDisposition = this.#getExactActiveDisposition(
            payload.sourceHandle
        );
        if (sourceDisposition !== 'active') {
            this.telemetry.stale++;
            return this.#rememberImmediateRejection(
                id,
                fingerprint,
                sourceDisposition === 'desync'
                    ? 'registry-backend-desync'
                    : 'stale-source'
            );
        }
        const coreDisposition = this.#getExactActiveDisposition(
            payload.coreTargetHandle
        );
        if (coreDisposition !== 'active') {
            this.recoveryRequired = true;
            return this.#rememberImmediateRejection(
                id,
                fingerprint,
                coreDisposition === 'desync'
                    ? 'registry-backend-desync'
                    : 'core-target-invalid'
            );
        }
        const targetKey = `${tick}:${handleKey(payload.sourceHandle)}`;
        const existing = this.controlTargetKeys.get(targetKey);
        if (existing?.state === 'conflicted') {
            this.telemetry.conflicted++;
            return this.#rememberImmediateRejection(
                id,
                fingerprint,
                'body-tick-conflict'
            );
        }
        if (existing) {
            if (existing.payloadFingerprint === payloadFingerprint) {
                this.telemetry.coalesced++;
                const receipt = Object.freeze({
                    accepted: true,
                    commandId: id,
                    targetFixedTick: tick,
                    coalesced: true,
                    canonicalCommandId: existing.command.commandId,
                    attackFingerprint: payload.attackFingerprint
                });
                this.#evictCompletedHistoryForInsert();
                if (this.knownCommands.size >= this.historyCapacity) {
                    this.telemetry.capacityRejected++;
                    return Object.freeze({
                        accepted: false,
                        commandId: id,
                        reason: 'command-history-capacity'
                    });
                }
                this.knownCommands.set(id, { fingerprint, receipt, completed: true });
                this.#rememberCompleted(id);
                return receipt;
            }
            existing.command.conflicted = true;
            this.controlTargetKeys.set(targetKey, { state: 'conflicted' });
            this.telemetry.conflicted++;
            return this.#rememberImmediateRejection(
                id,
                fingerprint,
                'body-tick-conflict'
            );
        }
        const enqueued = this.#enqueue({
            type: 'priority-target-control',
            commandId: id,
            targetFixedTick: tick,
            payload,
            protocol: normalizeProtocol(
                this.backend.getEventProtocolState(),
                'priorityTargetControl.protocol'
            ),
            targetKey,
            conflicted: false
        }, fingerprint);
        if (enqueued.accepted) {
            this.controlTargetKeys.set(targetKey, {
                state: 'pending',
                command: enqueued.command,
                payloadFingerprint
            });
        }
        return enqueued.accepted
            ? Object.freeze({
                ...enqueued.receipt,
                attackFingerprint: payload.attackFingerprint
            })
            : enqueued.receipt;
    }

    /** Same source/tick priority control result를 소비할 selected projectile를 예약합니다. */
    requestSelectedTargetSpawn(intent, targetFixedTick, commandId) {
        return this.#requestSelectedTargetSpawn(
            intent,
            targetFixedTick,
            commandId,
            false
        );
    }

    #requestSelectedTargetSpawn(
        intent,
        targetFixedTick,
        commandId,
        canonicalSnapshot
    ) {
        this.#assertUsable();
        const rejected = this.#rejectClosedIngress();
        if (rejected) {
            return rejected;
        }
        const tick = requirePositiveSafeInteger(targetFixedTick, 'targetFixedTick');
        const id = requireNonEmptyString(commandId, 'commandId');
        const snapshot = canonicalSnapshot
            ? intent
            : materializeGpuPlainDataSnapshot(intent, 'selectedTargetSpawn');
        const fingerprint = stableFingerprint({
            type: 'selected-target-spawn',
            tick,
            intent: snapshot
        });
        const duplicate = this.#handleKnownCommand(id, fingerprint);
        if (duplicate) {
            return duplicate;
        }
        const sourceHandle = normalizeHandle(
            snapshot.sourceHandle,
            'selectedTargetSpawn.sourceHandle'
        );
        const targetKey = `${tick}:${handleKey(sourceHandle)}`;
        const controlEntry = this.controlTargetKeys.get(targetKey);
        if (controlEntry?.state !== 'pending'
            || controlEntry.command?.type !== 'priority-target-control') {
            return this.#rememberImmediateRejection(
                id,
                fingerprint,
                'matching-priority-control-missing'
            );
        }
        const sourceDisposition = this.#getExactActiveDisposition(sourceHandle);
        if (sourceDisposition !== 'active') {
            this.telemetry.stale++;
            return this.#rememberImmediateRejection(
                id,
                fingerprint,
                sourceDisposition === 'desync'
                    ? 'registry-backend-desync'
                    : 'stale-source'
            );
        }
        const sourceView = this.registry.copyEntityView(sourceHandle, {});
        if (!sourceView || !sourceView.metadata) {
            this.recoveryRequired = true;
            return this.#rememberImmediateRejection(
                id,
                fingerprint,
                'source-metadata-missing'
            );
        }
        const payload = normalizeSelectedTargetIntent(
            snapshot,
            sourceView.metadata.teamId,
            controlEntry.command.payload
        );
        const selectionBindingKey = selectedSpawnBindingKey(
            tick,
            sourceHandle,
            controlEntry.command.commandId,
            payload.selectionSequence
        );
        const existingBinding = this.selectionBindingClaims.get(
            selectionBindingKey
        );
        if (existingBinding) {
            return this.#rememberImmediateRejection(
                id,
                fingerprint,
                'duplicate-selection-binding'
            );
        }
        const enqueued = this.#enqueue({
            type: 'selected-target-spawn',
            commandId: id,
            targetFixedTick: tick,
            payload,
            protocol: normalizeProtocol(
                this.backend.getEventProtocolState(),
                'selectedTargetSpawn.protocol'
            ),
            selectionBindingKey,
            controlTargetKey: targetKey,
            controlCommandId: controlEntry.command.commandId
        }, fingerprint);
        if (enqueued.accepted) {
            this.selectionBindingClaims.set(selectionBindingKey, {
                commandId: id,
                state: 'inbox'
            });
        }
        return enqueued.receipt;
    }

    requestSourceRelativeSpawn(intent, targetFixedTick, commandId) {
        return this.#requestSourceRelativeSpawn(
            intent,
            targetFixedTick,
            commandId,
            false
        );
    }

    #requestSourceRelativeSpawn(
        intent,
        targetFixedTick,
        commandId,
        canonicalSnapshot
    ) {
        this.#assertUsable();
        const rejected = this.#rejectClosedIngress();
        if (rejected) {
            return rejected;
        }
        const tick = requirePositiveSafeInteger(targetFixedTick, 'targetFixedTick');
        const id = requireNonEmptyString(commandId, 'commandId');
        const snapshot = canonicalSnapshot
            ? intent
            : materializeGpuPlainDataSnapshot(
                intent,
                'sourceRelativeSpawn'
            );
        const modeFlags = normalizeSourceRelativeMode(snapshot);
        const sourceHandle = normalizeHandle(
            snapshot?.sourceHandle,
            'sourceRelativeSpawn.sourceHandle'
        );
        const isTargetEntity = modeFlags
            === GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY;
        const targetHandle = isTargetEntity
            ? normalizeHandle(
                snapshot?.targetHandle,
                'sourceRelativeSpawn.targetHandle'
            )
            : null;
        const fingerprint = stableFingerprint({
            type: 'source-relative-spawn',
            tick,
            intent: snapshot
        });
        const duplicate = this.#handleKnownCommand(id, fingerprint);
        if (duplicate) {
            return duplicate;
        }
        const sourceDisposition = this.#getExactActiveDisposition(sourceHandle);
        if (sourceDisposition !== 'active') {
            this.telemetry.stale++;
            return this.#rememberImmediateRejection(
                id,
                fingerprint,
                sourceDisposition === 'desync'
                    ? 'registry-backend-desync'
                    : 'stale-source'
            );
        }
        if (targetHandle) {
            const targetDisposition = this.#getExactActiveDisposition(targetHandle);
            if (targetDisposition !== 'active') {
                this.telemetry.stale++;
                return this.#rememberImmediateRejection(
                    id,
                    fingerprint,
                    targetDisposition === 'desync'
                        ? 'registry-backend-desync'
                        : 'stale-target'
                );
            }
        }
        const sourceView = this.registry.copyEntityView(sourceHandle, {});
        if (!sourceView || !sourceView.metadata) {
            this.recoveryRequired = true;
            return this.#rememberImmediateRejection(
                id,
                fingerprint,
                'source-metadata-missing'
            );
        }
        const targetView = targetHandle
            ? this.registry.copyEntityView(targetHandle, {})
            : null;
        const payload = normalizeSourceRelativeIntent(
            snapshot,
            sourceView.metadata.teamId,
            { modeFlags, sourceHandle, targetHandle, sourceView, targetView }
        );
        return this.#enqueue({
            type: 'source-relative-spawn',
            commandId: id,
            targetFixedTick: tick,
            payload,
            protocol: normalizeProtocol(
                this.backend.getEventProtocolState(),
                'sourceRelativeSpawn.protocol'
            )
        }, fingerprint).receipt;
    }

    /** SpawnProgram result를 event 처리보다 먼저 registry visibility에 반영합니다. */
    commitCompletedAtFixedBoundary(fixedTick) {
        this.#assertUsable();
        const tick = requirePositiveSafeInteger(fixedTick, 'fixedTick');
        const priorResult = this.lastCompletionResult.fixedTick === tick
            ? this.lastCompletionResult
            : null;
        const controlBatches = this.bodyControlCompletionScratch;
        controlBatches.length = 0;
        this.backend.drainCompletedBodyControlProgramBatches(controlBatches);
        const batches = this.spawnCompletionScratch;
        batches.length = 0;
        this.backend.drainCompletedSpawnProgramBatches(batches);
        if (priorResult?.protocolFailure) {
            controlBatches.length = 0;
            batches.length = 0;
            return priorResult;
        }
        const priorityTargetControlResults = priorResult
            ? [...priorResult.priorityTargetControlResults]
            : [];
        let priorityTargetControlCompletedThroughTick = priorResult
            ? priorResult.priorityTargetControlCompletedThroughTick
            : this.priorityTargetControlCompletedThroughTick;
        const completed = priorResult
            ? [...priorResult.completed]
            : [];
        const preparedControlResults = [];
        const preparedControlPendings = new Set();
        const preparedOutcomes = [];
        const preparedDestinationKeys = new Set();
        let protocolFailure = null;
        let postMutationProtocolFailure = null;
        let completionStage = 'body-control-program-completion';
        if (controlBatches.length === 0 && batches.length === 0) {
            if (priorResult) {
                return priorResult;
            }
            this.lastCompletionResult = Object.freeze({
                fixedTick: tick,
                priorityTargetControlResults: Object.freeze([]),
                priorityTargetControlCompletedThroughTick,
                completed: Object.freeze(completed),
                protocolFailure: null
            });
            return this.lastCompletionResult;
        }
        let currentProtocol = null;
        try {
            currentProtocol = normalizeProtocol(
                this.backend.getEventProtocolState(),
                'spawnCompletion.protocol'
            );
            for (const batch of controlBatches) {
                const batchProtocol = normalizeProtocol(
                    batch,
                    'bodyControlCompletion.batch'
                );
                if (!sameProtocol(batchProtocol, currentProtocol) || batch.failure) {
                    protocolFailure = Object.freeze({
                        stage: 'body-control-program-completion',
                        code: batch.failure
                            ? 'gpu-program-failure'
                            : 'generation-mismatch',
                        message: batch.failure?.message
                            ?? 'BodyControlProgram completion generation이 현재 session과 다릅니다.'
                    });
                    break;
                }
                const sourceTick = requirePositiveSafeInteger(
                    batch.sourceTick,
                    'bodyControlCompletion.batch.sourceTick'
                );
                if (!Array.isArray(batch.outcomes)) {
                    throw new TypeError(
                        'BodyControlProgram completion outcomes 배열이 필요합니다.'
                    );
                }
                const pendingByEntityId =
                    this.pendingPriorityControlsBySourceTick.get(sourceTick);
                let expectedControlCount = 0;
                for (const pendingByIncarnation of
                    pendingByEntityId?.values() ?? []) {
                    expectedControlCount += pendingByIncarnation.size;
                }
                if (batch.outcomes.length !== expectedControlCount) {
                    protocolFailure = Object.freeze({
                        stage: 'body-control-program-completion',
                        code: 'missing-control-result',
                        message: `priority control result 수가 pending과 다릅니다: ${sourceTick}`
                    });
                    break;
                }
                for (const outcome of batch.outcomes) {
                    const rawSourceHandle =
                        outcome?.sourceHandle ?? outcome?.handle;
                    if (!rawSourceHandle
                        || typeof rawSourceHandle !== 'object') {
                        throw new TypeError(
                            'bodyControlCompletion.outcome.sourceHandle은 exact handle 객체여야 합니다.'
                        );
                    }
                    const sourceEntityId = requirePositiveSafeInteger(
                        rawSourceHandle.entityId,
                        'bodyControlCompletion.outcome.sourceHandle.entityId'
                    );
                    const sourceIncarnation = requirePositiveSafeInteger(
                        rawSourceHandle.incarnation,
                        'bodyControlCompletion.outcome.sourceHandle.incarnation'
                    );
                    const pending = pendingByEntityId
                        ?.get(sourceEntityId)
                        ?.get(sourceIncarnation);
                    if (!pending
                        || preparedControlPendings.has(pending)
                        || !sameProtocol(batchProtocol, pending.protocol)) {
                        protocolFailure = Object.freeze({
                            stage: 'body-control-program-completion',
                            code: 'control-result-contract',
                            message: `등록되지 않았거나 중복된 priority control outcome입니다: ${sourceTick}:${sourceEntityId}:${sourceIncarnation}`
                        });
                        break;
                    }
                    const result = normalizePriorityControlCompletionOutcome(
                        outcome,
                        pending,
                        sourceTick,
                        sourceEntityId,
                        sourceIncarnation,
                        (handle) => pending.usesAuthoritativeTowerRoster === true
                            ? hasExactHandleIdentity(handle)
                            : sameOptionalHandle(
                                handle,
                                pending.payload.towerTargetHandle
                            )
                    );
                    preparedControlPendings.add(pending);
                    preparedControlResults.push(Object.freeze({
                        pending,
                        result
                    }));
                }
                if (protocolFailure) {
                    break;
                }
                for (const pendingByIncarnation of
                    pendingByEntityId?.values() ?? []) {
                    for (const pending of pendingByIncarnation.values()) {
                        if (!preparedControlPendings.has(pending)) {
                            protocolFailure = Object.freeze({
                                stage: 'body-control-program-completion',
                                code: 'missing-control-result',
                                message: `priority control outcome이 누락되었습니다: ${pending.bindingKey}`
                            });
                            break;
                        }
                    }
                    if (protocolFailure) {
                        break;
                    }
                }
                if (protocolFailure) {
                    break;
                }
                priorityTargetControlCompletedThroughTick = Math.max(
                    priorityTargetControlCompletedThroughTick,
                    sourceTick
                );
            }
            if (!protocolFailure) {
                for (const [pendingSourceTick, pendingByEntityId] of
                    this.pendingPriorityControlsBySourceTick) {
                    if (pendingSourceTick
                        > priorityTargetControlCompletedThroughTick) {
                        continue;
                    }
                    for (const pendingByIncarnation of
                        pendingByEntityId.values()) {
                        for (const pending of pendingByIncarnation.values()) {
                            if (!preparedControlPendings.has(pending)) {
                                protocolFailure = Object.freeze({
                                    stage: 'body-control-program-completion',
                                    code: 'missing-control-result',
                                    message: `completed-through 이전 priority control이 누락되었습니다: ${pending.commandId}`
                                });
                                break;
                            }
                        }
                        if (protocolFailure) {
                            break;
                        }
                    }
                    if (protocolFailure) {
                        break;
                    }
                }
            }
            completionStage = 'spawn-program-completion';
            for (const batch of batches) {
                if (protocolFailure) {
                    break;
                }
                const batchProtocol = normalizeProtocol(batch, 'spawnCompletion.batch');
                if (!sameProtocol(batchProtocol, currentProtocol) || batch.failure) {
                    protocolFailure = Object.freeze({
                        stage: 'spawn-program-completion',
                        code: batch.failure ? 'gpu-program-failure' : 'generation-mismatch',
                        message: batch.failure?.message
                            ?? 'SpawnProgram completion generation이 현재 session과 다릅니다.'
                    });
                    break;
                }
                if (!Array.isArray(batch.outcomes)) {
                    throw new TypeError('SpawnProgram completion outcomes 배열이 필요합니다.');
                }
                for (const outcome of batch.outcomes) {
                    const key = handleKey(outcome?.destinationHandle);
                    const pending = this.pendingDestinations.get(key);
                    const selectedTargetSpawn = isSelectedTargetSpawnCommand(pending);
                    const pendingTargetHandle = pending?.payload?.targetHandle ?? null;
                    const outcomeTargetHandle = outcome?.targetHandle ?? null;
                    const rosterTowerQuery = !selectedTargetSpawn
                        && pending?.payload?.modeFlags
                            === GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY
                        && (pending?.payload?.requestFlags
                            & GPU_SPAWN_PROGRAM_REQUEST_FLAGS.TOWER_DAMAGE_CHANNEL)
                            !== 0
                        && pending?.usesAuthoritativeTowerRoster === true;
                    if (!pending
                        || preparedDestinationKeys.has(key)
                        || batch.sourceTick !== pending.targetFixedTick
                        || handleKey(outcome?.sourceHandle)
                            !== handleKey(pending.payload.sourceHandle)) {
                        protocolFailure = Object.freeze({
                            stage: 'spawn-program-completion',
                            code: 'destination-contract',
                            message: `등록되지 않았거나 중복된 destination outcome입니다: ${key}`
                        });
                        break;
                    }
                    let activationEvidence = null;
                    if (selectedTargetSpawn) {
                        const selectedTargetKind = outcome?.selectedTargetKind ?? null;
                        if (outcome.reason === 'resolved') {
                            const expectedTargetHandle = selectedTargetKind === 'core'
                                ? pending.payload.coreTargetHandle
                                : selectedTargetKind === 'tower'
                                    ? pending.payload.towerTargetHandle
                                    : null;
                            const targetAccepted = selectedTargetKind === 'tower'
                                ? pending.usesAuthoritativeTowerRoster === true
                                    ? hasExactHandleIdentity(outcomeTargetHandle)
                                    : expectedTargetHandle
                                        && outcomeTargetHandle
                                        && handleKey(outcomeTargetHandle)
                                            === handleKey(expectedTargetHandle)
                                : expectedTargetHandle
                                    && outcomeTargetHandle
                                    && handleKey(outcomeTargetHandle)
                                        === handleKey(expectedTargetHandle);
                            if (!targetAccepted
                                || !outcomeTargetHandle
                            ) {
                                protocolFailure = Object.freeze({
                                    stage: 'spawn-program-completion',
                                    code: 'selected-target-contract',
                                    message: 'resolved selected target이 Core exact/Tower roster 계약과 다릅니다.'
                                });
                                break;
                            }
                            activationEvidence = Object.freeze({
                                selectedTargetKind,
                                selectedTargetHandle: outcomeTargetHandle,
                                selectedTargetPolicyId: selectedTargetKind === 'core'
                                    ? pending.payload.destinationSpawn.coreTargetPolicyId
                                    : pending.payload.destinationSpawn.towerTargetPolicyId,
                                selectionSourceTick: pending.targetFixedTick,
                                selectionSequence: pending.payload.selectionSequence,
                                attackFingerprint: pending.payload.attackFingerprint
                            });
                        } else if (outcomeTargetHandle !== null
                            || (selectedTargetKind !== undefined
                                && selectedTargetKind !== null
                                && selectedTargetKind !== 'none')) {
                            protocolFailure = Object.freeze({
                                stage: 'spawn-program-completion',
                                code: 'selected-target-contract',
                                message: 'unresolved selected outcome은 target identity를 가질 수 없습니다.'
                            });
                            break;
                        }
                    } else if (!rosterTowerQuery
                        && (((pendingTargetHandle === null)
                            !== (outcomeTargetHandle === null))
                        || (pendingTargetHandle !== null
                            && handleKey(outcomeTargetHandle)
                                !== handleKey(pendingTargetHandle)))) {
                        protocolFailure = Object.freeze({
                            stage: 'spawn-program-completion',
                            code: 'target-contract',
                            message: 'SpawnProgram target outcome이 ingress와 다릅니다.'
                        });
                        break;
                    }
                    if (rosterTowerQuery
                        && outcomeTargetHandle !== null
                        && !hasExactHandleIdentity(outcomeTargetHandle)) {
                        protocolFailure = Object.freeze({
                            stage: 'spawn-program-completion',
                            code: 'tower-roster-target-contract',
                            message: 'Archer GPU roster target exact identity가 올바르지 않습니다.'
                        });
                        break;
                    }
                    if (rosterTowerQuery
                        && outcome.reason === 'resolved'
                        && outcomeTargetHandle === null) {
                        protocolFailure = Object.freeze({
                            stage: 'spawn-program-completion',
                            code: 'tower-roster-target-contract',
                            message: 'resolved Archer projectile에 roster target identity가 없습니다.'
                        });
                        break;
                    }
                    if (!selectedTargetSpawn
                        && outcome.reason === 'target-invalid'
                        && pendingTargetHandle === null) {
                        protocolFailure = Object.freeze({
                            stage: 'spawn-program-completion',
                            code: 'unknown-outcome',
                            message: 'non-targeted SpawnProgram은 target-invalid를 반환할 수 없습니다.'
                        });
                        break;
                    }
                    if (outcome.reason === 'resolved') {
                        if (!this.backend.hasBody(outcome.destinationHandle)) {
                            protocolFailure = Object.freeze({
                                stage: 'spawn-program-completion',
                                code: 'activation-failed',
                                message: `resolved destination backend body가 없습니다: ${key}`
                            });
                            break;
                        }
                    } else if (outcome.reason === 'source-invalid'
                        || outcome.reason === 'target-invalid'
                        || (selectedTargetSpawn
                            && (outcome.reason === 'no-target'
                                || outcome.reason === 'core-invalid'))) {
                        if (this.backend.hasBody(outcome.destinationHandle)) {
                            protocolFailure = Object.freeze({
                                stage: 'spawn-program-completion',
                                code: 'cleanup-failed',
                                message: `${outcome.reason} destination backend body가 남았습니다: ${key}`
                            });
                            break;
                        }
                    } else {
                        protocolFailure = Object.freeze({
                            stage: 'spawn-program-completion',
                            code: 'unknown-outcome',
                            message: `지원하지 않는 SpawnProgram outcome입니다: ${outcome.reason}`
                        });
                        break;
                    }
                    preparedDestinationKeys.add(key);
                    if (selectedTargetSpawn
                        && outcome.reason !== 'resolved'
                        && outcome.reason !== 'source-invalid'
                        && outcome.reason !== 'no-target'
                        && outcome.reason !== 'core-invalid') {
                        protocolFailure = Object.freeze({
                            stage: 'spawn-program-completion',
                            code: 'unknown-outcome',
                            message: `selected SpawnProgram outcome이 올바르지 않습니다: ${outcome.reason}`
                        });
                        break;
                    }
                    if (selectedTargetSpawn && outcome.reason === 'core-invalid') {
                        postMutationProtocolFailure ??= Object.freeze({
                            stage: 'spawn-program-completion',
                            code: 'core-target-invalid',
                            message: 'selected SpawnProgram exact Core candidate가 invalid입니다.'
                        });
                    }
                    let activationIntent = pending.payload.destinationSpawn;
                    if (outcome.reason === 'resolved'
                        && selectedTargetSpawn
                        && activationEvidence?.selectedTargetKind === 'tower'
                        && pending.usesAuthoritativeTowerRoster === true) {
                        activationIntent = Object.freeze({
                            ...activationIntent,
                            towerTargetEntityId: outcomeTargetHandle.entityId,
                            towerTargetIncarnation: outcomeTargetHandle.incarnation
                        });
                    } else if (outcome.reason === 'resolved'
                        && rosterTowerQuery) {
                        activationIntent = Object.freeze({
                            ...activationIntent,
                            targetEntityId: outcomeTargetHandle.entityId,
                            targetIncarnation: outcomeTargetHandle.incarnation
                        });
                    }
                    preparedOutcomes.push({
                        key,
                        outcome,
                        pending,
                        activationEvidence,
                        activationIntent,
                        rosterTowerQuery
                    });
                }
                if (protocolFailure) {
                    break;
                }
            }
        } catch (error) {
            protocolFailure = Object.freeze({
                stage: completionStage,
                code: 'completion-contract',
                message: String(error?.message ?? error)
            });
        }
        if (!protocolFailure) {
            try {
                for (const prepared of preparedOutcomes) {
                    prepared.activationMetadata = prepared.outcome.reason
                            === 'resolved'
                        ? preflightGpuRegistryActivationMetadata(
                            prepared.activationIntent,
                            prepared.activationEvidence
                        )
                        : null;
                }
            } catch (error) {
                protocolFailure = Object.freeze({
                    stage: 'spawn-program-completion',
                    code: 'activation-metadata-contract',
                    message: String(error?.message ?? error)
                });
            }
        }
        // 모든 control/spawn envelope와 모든 activation metadata를 ephemeral
        // preflight한 뒤에만 pending/history/registry reservation을 변경합니다.
        if (!protocolFailure) {
            for (const prepared of preparedControlResults) {
                this.pendingPriorityControlsByKey.delete(
                    prepared.pending.bindingKey
                );
                this.pendingPriorityControlsByCommandId.delete(
                    prepared.pending.commandId
                );
                const pendingByEntityId =
                    this.pendingPriorityControlsBySourceTick.get(
                        prepared.pending.targetFixedTick
                    );
                const pendingByIncarnation = pendingByEntityId?.get(
                    prepared.pending.payload.sourceHandle.entityId
                );
                pendingByIncarnation?.delete(
                    prepared.pending.payload.sourceHandle.incarnation
                );
                if (pendingByIncarnation?.size === 0) {
                    pendingByEntityId.delete(
                        prepared.pending.payload.sourceHandle.entityId
                    );
                }
                if (pendingByEntityId?.size === 0) {
                    this.pendingPriorityControlsBySourceTick.delete(
                        prepared.pending.targetFixedTick
                    );
                }
                const known = this.knownCommands.get(
                    prepared.pending.commandId
                );
                if (known) {
                    known.completed = true;
                }
                this.#rememberCompleted(prepared.pending.commandId);
                priorityTargetControlResults.push(prepared.result);
                if (prepared.result.outcome === 'no-target') {
                    this.telemetry.priorityControlCompletedNoTarget++;
                } else if (prepared.result.outcome === 'core') {
                    this.telemetry.priorityControlCompletedCore++;
                } else if (prepared.result.outcome === 'tower') {
                    this.telemetry.priorityControlCompletedTower++;
                } else if (prepared.result.outcome === 'source-invalid') {
                    this.telemetry.priorityControlCompletedSourceInvalid++;
                } else {
                    this.telemetry.priorityControlCompletedCoreInvalid++;
                }
            }
            this.priorityTargetControlCompletedThroughTick =
                priorityTargetControlCompletedThroughTick;
            for (const {
                key,
                outcome,
                pending,
                activationEvidence,
                activationMetadata,
                rosterTowerQuery
            } of preparedOutcomes) {
                const applied = outcome.reason === 'resolved'
                    ? this.registry.activateReserved(
                        outcome.destinationHandle,
                        activationMetadata
                    )
                    : this.registry.cancelReservation(outcome.destinationHandle);
                if (!applied) {
                    protocolFailure = Object.freeze({
                        stage: 'spawn-program-completion',
                        code: outcome.reason === 'resolved'
                            ? 'activation-failed'
                            : 'cleanup-failed',
                        message: `검증된 destination reservation 적용에 실패했습니다: ${key}`
                    });
                    break;
                }
                if (outcome.reason === 'resolved') {
                    this.telemetry.completedResolved++;
                } else if (outcome.reason === 'source-invalid') {
                    this.telemetry.completedSourceInvalid++;
                } else if (outcome.reason === 'no-target') {
                    this.telemetry.completedNoTarget++;
                } else if (outcome.reason === 'core-invalid') {
                    this.telemetry.completedCoreInvalid++;
                } else {
                    this.telemetry.completedTargetInvalid++;
                }
                this.pendingDestinations.delete(key);
                this.#releaseSelectionBinding(
                    pending.selectionBindingKey,
                    pending.commandId
                );
                completed.push(Object.freeze({
                    commandId: pending.commandId,
                    handle: outcome.destinationHandle,
                    outcome: outcome.reason,
                    ...(activationEvidence ? {
                        selectedTargetKind:
                            activationEvidence.selectedTargetKind,
                        targetHandle:
                            activationEvidence.selectedTargetHandle
                    } : rosterTowerQuery && outcome.targetHandle ? {
                        targetHandle: outcome.targetHandle
                    } : {})
                }));
            }
        }
        if (!protocolFailure && postMutationProtocolFailure) {
            protocolFailure = postMutationProtocolFailure;
        }
        if (protocolFailure) {
            this.recoveryRequired = true;
        }
        this.lastCompletionResult = Object.freeze({
            fixedTick: tick,
            priorityTargetControlResults: Object.freeze(
                priorityTargetControlResults
            ),
            priorityTargetControlCompletedThroughTick:
                priorityTargetControlCompletedThroughTick,
            completed: Object.freeze(completed),
            protocolFailure
        });
        return this.lastCompletionResult;
    }

    commitAtFixedBoundary(fixedTick) {
        this.#assertUsable();
        const tick = requirePositiveSafeInteger(fixedTick, 'fixedTick');
        const result = {
            fixedTick: tick,
            state: 'committed',
            controls: [],
            sourceRelativeSpawns: [],
            selectedTargetSpawns: [],
            priorityTargetControlResults: [
                ...this.lastCompletionResult.priorityTargetControlResults
            ],
            priorityTargetControlCompletedThroughTick:
                this.lastCompletionResult
                    .priorityTargetControlCompletedThroughTick,
            rejected: [],
            completed: [...this.lastCompletionResult.completed],
            ingressOpen: this.ingressOpen,
            ingressCloseReason: this.ingressCloseReason,
            recoveryRequired: this.recoveryRequired,
            protocolFailure: this.lastCompletionResult.protocolFailure
        };
        if (this.recoveryRequired) {
            result.state = 'failed';
            result.recoveryRequired = true;
            return this.#saveResult(result);
        }

        const due = [
            ...(this.pendingCommandsByTargetFixedTick.get(tick) ?? [])
        ].sort((left, right) => left.sequence - right.sequence);
        for (const [targetFixedTick, commands] of
            this.pendingCommandsByTargetFixedTick) {
            if (targetFixedTick < tick) {
                for (const command of commands) {
                    result.state = 'failed';
                    result.recoveryRequired = true;
                    result.rejected.push({
                        commandId: command.commandId,
                        domain: commandDomain(command),
                        code: 'missed-fixed-boundary'
                    });
                }
            }
        }
        if (result.recoveryRequired) {
            this.recoveryRequired = true;
            return this.#saveResult(result);
        }
        if (due.length === 0) {
            return this.#saveResult(result);
        }
        if (this.backend.requiresRecovery()) {
            result.state = this.backend.getRuntimeState() === 'gpu-backpressure'
                ? 'stalled'
                : 'failed';
            result.recoveryRequired = true;
            return this.#saveResult(result);
        }

        let currentProtocol;
        try {
            currentProtocol = normalizeProtocol(
                this.backend.getEventProtocolState(),
                'fixedCommit.protocol'
            );
        } catch (error) {
            result.state = 'failed';
            result.recoveryRequired = true;
            result.protocolFailure = Object.freeze({
                stage: 'fixed-command-protocol',
                code: 'generation-contract',
                message: String(error?.message ?? error)
            });
            this.recoveryRequired = true;
            return this.#saveResult(result);
        }
        // Completion은 source tick의 과거 증거이므로 current roster/liveness를
        // 재조회하지 않습니다. GPU stage 시점의 roster authority를 pending에 고정합니다.
        const authoritativeTowerRosterAtStage = hasAuthoritativeTowerRoster(
            this.backend
        );
        const controls = [];
        const sourceCommands = [];
        const consumed = new Set();
        for (const command of due) {
            if (!sameProtocol(command.protocol, currentProtocol)) {
                result.rejected.push({
                    commandId: command.commandId,
                    domain: commandDomain(command),
                    code: 'stale-generation'
                });
                consumed.add(command.commandId);
                continue;
            }
            if (command.conflicted) {
                result.rejected.push({
                    commandId: command.commandId,
                    domain: commandDomain(command),
                    code: 'body-tick-conflict'
                });
                consumed.add(command.commandId);
                continue;
            }
            const handle = isControlCommand(command)
                ? command.type === 'control'
                    ? command.payload
                    : command.payload.sourceHandle
                : command.payload.sourceHandle;
            const disposition = this.#getExactActiveDisposition(handle);
            if (disposition !== 'active') {
                result.rejected.push({
                    commandId: command.commandId,
                    domain: commandDomain(command),
                    code: disposition === 'desync'
                        ? 'registry-backend-desync'
                        : isControlCommand(command)
                            ? 'stale-handle'
                            : 'stale-source'
                });
                this.telemetry.stale++;
                consumed.add(command.commandId);
                continue;
            }
            if (command.type === 'source-relative-spawn'
                && command.payload.targetHandle
                && (((command.payload.requestFlags
                    & GPU_SPAWN_PROGRAM_REQUEST_FLAGS.TOWER_DAMAGE_CHANNEL)
                    === 0)
                    || !authoritativeTowerRosterAtStage)) {
                const targetDisposition = this.#getExactActiveDisposition(
                    command.payload.targetHandle
                );
                if (targetDisposition !== 'active') {
                    result.rejected.push({
                        commandId: command.commandId,
                        domain: 'spawn',
                        code: targetDisposition === 'desync'
                            ? 'registry-backend-desync'
                            : 'stale-target'
                    });
                    this.telemetry.stale++;
                    consumed.add(command.commandId);
                    continue;
                }
            }
            if (command.type === 'priority-target-control'
                || command.type === 'selected-target-spawn') {
                const coreDisposition = this.#getExactActiveDisposition(
                    command.payload.coreTargetHandle
                );
                if (coreDisposition !== 'active') {
                    result.rejected.push({
                        commandId: command.commandId,
                        domain: commandDomain(command),
                        code: coreDisposition === 'desync'
                            ? 'registry-backend-desync'
                            : 'core-target-invalid'
                    });
                    result.state = 'failed';
                    result.recoveryRequired = true;
                    this.recoveryRequired = true;
                    consumed.add(command.commandId);
                    continue;
                }
            }
            if (command.type === 'control') {
                if (!this.backend.canControlBody(handle)) {
                    result.rejected.push({
                        commandId: command.commandId,
                        domain: 'control',
                        code: 'flow-body-not-controllable'
                    });
                    consumed.add(command.commandId);
                } else {
                    controls.push(command);
                }
            } else if (command.type === 'priority-target-control') {
                controls.push(command);
            } else {
                sourceCommands.push(command);
            }
        }

        if (this.recoveryRequired) {
            result.state = 'failed';
            result.recoveryRequired = true;
            this.#consume(consumed);
            return this.#saveResult(result);
        }

        const stagedControlCommandIds = new Set(
            controls.map((command) => command.commandId)
        );
        for (let index = sourceCommands.length - 1; index >= 0; index--) {
            const command = sourceCommands[index];
            if (!isSelectedTargetSpawnCommand(command)) {
                continue;
            }
            if (!stagedControlCommandIds.has(command.controlCommandId)) {
                sourceCommands.splice(index, 1);
                result.rejected.push({
                    commandId: command.commandId,
                    domain: 'spawn',
                    code: 'matching-priority-control-missing'
                });
                consumed.add(command.commandId);
            }
        }

        if (controls.length === 0 && sourceCommands.length === 0) {
            this.#consume(consumed);
            if (result.rejected.length > 0) {
                result.state = 'committed-with-rejections';
            }
            return this.#saveResult(result);
        }

        const reservations = [];
        let registryRejectedSourceCommands = false;
        for (const command of sourceCommands) {
            const handle = this.registry.reserveEntity({
                kindId: command.payload.destinationSpawn.kindId,
                definitionId: command.payload.destinationSpawn.definitionId,
                createdAtTick: tick
            });
            if (!handle) {
                for (const reservation of reservations) {
                    this.registry.cancelReservation(reservation.handle);
                }
                reservations.length = 0;
                for (const rejected of sourceCommands) {
                    result.rejected.push({
                        commandId: rejected.commandId,
                        domain: 'spawn',
                        code: 'registry-capacity'
                    });
                    consumed.add(rejected.commandId);
                }
                result.state = 'committed-with-rejections';
                this.telemetry.capacityRejected += sourceCommands.length;
                registryRejectedSourceCommands = true;
                break;
            }
            reservations.push({ command, handle });
        }
        if (controls.length === 0 && reservations.length === 0) {
            this.#consume(consumed);
            return this.#saveResult(result);
        }

        const plan = {
            targetFixedTick: tick,
            controls: controls.map((command) => command.payload),
            sourceRelativeSpawns: reservations.map(({ command, handle }) => ({
                sourceHandle: command.payload.sourceHandle,
                destinationHandle: handle,
                destinationSpawn: command.payload.destinationSpawn,
                modeFlags: command.payload.modeFlags,
                positionOffset: command.payload.positionOffset,
                ...(command.payload.modeFlags
                    === GPU_SPAWN_PROGRAM_MODE
                        .SOURCE_RELATIVE_SELECTED_PRIORITY_TARGET
                    ? {
                        coreTargetHandle: command.payload.coreTargetHandle,
                        towerTargetHandle: command.payload.towerTargetHandle,
                        targetOffset: command.payload.targetOffset,
                        launchSpeed: command.payload.launchSpeed,
                        selectionSequence: command.payload.selectionSequence,
                        attackFingerprint: command.payload.attackFingerprint,
                        requestFlags: command.payload.requestFlags
                    }
                    : command.payload.modeFlags
                    === GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY
                    ? {
                        targetHandle: command.payload.targetHandle,
                        targetOffset: command.payload.targetOffset,
                        launchSpeed: command.payload.launchSpeed,
                        requestFlags: command.payload.requestFlags
                    }
                    : command.payload.modeFlags
                        === GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_AIM_POINT
                        ? {
                            aimWorldPoint: command.payload.aimWorldPoint,
                            launchSpeed: command.payload.launchSpeed
                        }
                        : {
                            launchVelocity: command.payload.launchVelocity,
                            sourceVelocityScale: command.payload.sourceVelocityScale
                        })
            }))
        };
        let backendResult;
        try {
            backendResult = this.backend.stageFixedPrograms(plan);
        } catch (error) {
            for (const reservation of reservations) {
                this.registry.cancelReservation(reservation.handle);
            }
            result.state = 'failed';
            result.recoveryRequired = true;
            result.rejected.push({
                commandId: due[0].commandId,
                domain: commandDomain(due[0]),
                code: 'fixed-program-exception',
                message: String(error?.message ?? error)
            });
            this.recoveryRequired = true;
            return this.#saveResult(result);
        }
        const expectedAccepted = controls.length + reservations.length;
        if (backendResult?.requiresRecovery === true
            || this.backend.requiresRecovery()) {
            for (const reservation of reservations) {
                this.registry.cancelReservation(reservation.handle);
            }
            result.state = 'failed';
            result.recoveryRequired = true;
            result.rejected.push({
                commandId: due[0].commandId,
                domain: commandDomain(due[0]),
                code: backendResult?.reason ?? 'fixed-program-recovery'
            });
            this.recoveryRequired = true;
            this.#consume(new Set(due.map((command) => command.commandId)));
            return this.#saveResult(result);
        }

        const controlDomain = normalizeBackendDomainResult(
            backendResult,
            'controls',
            controls.length,
            expectedAccepted
        );
        const spawnDomain = normalizeBackendDomainResult(
            backendResult,
            'sourceRelativeSpawns',
            reservations.length,
            expectedAccepted
        );
        const controlContractValid = controlDomain.accepted === controls.length
            && controlDomain.rejected === 0;
        const spawnAccepted = spawnDomain.accepted === reservations.length
            && spawnDomain.rejected === 0;
        const spawnNormallyRejected = reservations.length > 0
            && spawnDomain.accepted === 0
            && spawnDomain.rejected === reservations.length
            && NORMAL_SPAWN_REJECTION_CODES.has(spawnDomain.reason);
        if (!controlContractValid || (!spawnAccepted && !spawnNormallyRejected)) {
            for (const reservation of reservations) {
                this.registry.cancelReservation(reservation.handle);
            }
            for (const command of controls) {
                result.rejected.push({
                    commandId: command.commandId,
                    domain: 'control',
                    code: controlDomain.reason ?? 'fixed-program-control-rejected'
                });
                consumed.add(command.commandId);
            }
            for (const command of sourceCommands) {
                result.rejected.push({
                    commandId: command.commandId,
                    domain: 'spawn',
                    code: spawnDomain.reason ?? 'fixed-program-spawn-contract'
                });
                consumed.add(command.commandId);
            }
            result.state = 'failed';
            result.recoveryRequired = true;
            result.protocolFailure = Object.freeze({
                stage: 'fixed-command-domain',
                code: !controlContractValid
                    ? 'control-domain-rejected'
                    : 'spawn-domain-partial',
                message: 'fixed program backend의 domain별 acceptance 계약이 깨졌습니다.'
            });
            this.recoveryRequired = true;
            this.#consume(consumed);
            return this.#saveResult(result);
        }

        if (spawnNormallyRejected) {
            for (const reservation of reservations) {
                this.registry.cancelReservation(reservation.handle);
                result.rejected.push({
                    commandId: reservation.command.commandId,
                    domain: 'spawn',
                    code: spawnDomain.reason ?? 'fixed-program-spawn-rejected'
                });
                consumed.add(reservation.command.commandId);
            }
            if (spawnDomain.reason?.includes('capacity')) {
                this.telemetry.capacityRejected += reservations.length;
            }
            reservations.length = 0;
            result.state = 'committed-with-rejections';
        }

        for (const command of controls) {
            result.controls.push({
                commandId: command.commandId,
                handle: command.type === 'control'
                    ? command.payload
                    : command.payload.sourceHandle,
                modeFlags: command.payload.modeFlags
            });
            if (command.type === 'priority-target-control') {
                const bindingKey = priorityControlBindingKey(
                    tick,
                    command.payload.sourceHandle
                );
                if (this.pendingPriorityControlsByKey.has(bindingKey)
                    || this.pendingPriorityControlsByCommandId.has(
                        command.commandId
                    )) {
                    result.state = 'failed';
                    result.recoveryRequired = true;
                    result.protocolFailure = Object.freeze({
                        stage: 'fixed-command-control-pending',
                        code: 'duplicate-priority-control-pending',
                        message: `priority control pending identity가 중복되었습니다: ${command.commandId}`
                    });
                    this.recoveryRequired = true;
                    break;
                }
                const pendingControl = {
                    bindingKey,
                    commandId: command.commandId,
                    targetFixedTick: tick,
                    payload: command.payload,
                    protocol: command.protocol,
                    usesAuthoritativeTowerRoster:
                        authoritativeTowerRosterAtStage
                };
                this.pendingPriorityControlsByKey.set(
                    bindingKey,
                    pendingControl
                );
                this.pendingPriorityControlsByCommandId.set(
                    command.commandId,
                    pendingControl
                );
                let pendingByEntityId =
                    this.pendingPriorityControlsBySourceTick.get(tick);
                if (!pendingByEntityId) {
                    pendingByEntityId = new Map();
                    this.pendingPriorityControlsBySourceTick.set(
                        tick,
                        pendingByEntityId
                    );
                }
                const sourceEntityId = command.payload.sourceHandle.entityId;
                let pendingByIncarnation = pendingByEntityId.get(
                    sourceEntityId
                );
                if (!pendingByIncarnation) {
                    pendingByIncarnation = new Map();
                    pendingByEntityId.set(
                        sourceEntityId,
                        pendingByIncarnation
                    );
                }
                pendingByIncarnation.set(
                    command.payload.sourceHandle.incarnation,
                    pendingControl
                );
            }
            consumed.add(command.commandId);
        }
        if (this.recoveryRequired) {
            this.#consume(consumed);
            return this.#saveResult(result);
        }
        for (const reservation of reservations) {
            const { command, handle } = reservation;
            this.pendingDestinations.set(handleKey(handle), {
                type: command.type,
                commandId: command.commandId,
                targetFixedTick: tick,
                payload: command.payload,
                handle,
                selectionBindingKey: command.selectionBindingKey ?? null,
                usesAuthoritativeTowerRoster: authoritativeTowerRosterAtStage
            });
            if (command.selectionBindingKey) {
                const claim = this.selectionBindingClaims.get(
                    command.selectionBindingKey
                );
                if (!claim || claim.commandId !== command.commandId) {
                    result.state = 'failed';
                    result.recoveryRequired = true;
                    result.protocolFailure = Object.freeze({
                        stage: 'fixed-command-selection-binding',
                        code: 'selection-binding-claim-missing',
                        message: `selected spawn binding claim이 없습니다: ${command.commandId}`
                    });
                    this.recoveryRequired = true;
                    break;
                }
                claim.state = 'gpu-pending';
            }
            const acceptedEntry = {
                commandId: command.commandId,
                handle,
                state: 'gpu-resolve-pending'
            };
            if (isSelectedTargetSpawnCommand(command)) {
                result.selectedTargetSpawns.push(acceptedEntry);
            } else {
                result.sourceRelativeSpawns.push(acceptedEntry);
            }
            consumed.add(command.commandId);
        }
        if (this.recoveryRequired) {
            this.#consume(consumed);
            return this.#saveResult(result);
        }
        this.#consume(consumed);
        if (registryRejectedSourceCommands || result.rejected.length > 0) {
            result.state = 'committed-with-rejections';
        }
        return this.#saveResult(result);
    }

    getPendingCount() {
        return this.pendingCount
            + this.pendingDestinations.size
            + this.pendingPriorityControlsByKey.size;
    }

    requiresRecovery() {
        return !this.destroyed && this.recoveryRequired;
    }

    getStatus() {
        return Object.freeze({
            capacity: this.commandCapacity,
            controlCapacity: this.controlCommandCapacity,
            sourceRelativeSpawnCapacity: this.sourceRelativeSpawnCommandCapacity,
            pendingCommandCount: this.pendingCount,
            pendingControlCount: this.pendingControlCount,
            pendingSourceRelativeSpawnCount: this.pendingSourceRelativeSpawnCount,
            pendingDestinationCount: this.pendingDestinations.size,
            pendingPriorityTargetControlCount:
                this.pendingPriorityControlsByKey.size,
            pendingSelectionBindingCount: this.selectionBindingClaims.size,
            priorityTargetControlCompletedThroughTick:
                this.priorityTargetControlCompletedThroughTick,
            recoveryRequired: this.recoveryRequired,
            ingressOpen: this.ingressOpen,
            ingressCloseReason: this.ingressCloseReason,
            terminalCancelResult: this.terminalCancelResult,
            lastCommitResult: this.lastCommitResult,
            lastCompletionResult: this.lastCompletionResult,
            telemetry: Object.freeze({ ...this.telemetry }),
            destroyed: this.destroyed
        });
    }

    /**
     * GPU에 아직 stage되지 않은 fixed command와 unresolved destination reservation만
     * 취소합니다. protocol binding과 completed command history는 그대로 유지하므로
     * terminal final boundary가 같은 owner에서 빈 commit을 만들 수 있습니다.
     */
    cancelAll() {
        if (this.destroyed) {
            return Object.freeze({
                cancelledCommandCount: 0,
                releasedDestinationCount: 0,
                failedDestinationCount: 0
            });
        }

        const pendingCommandIds = new Set(this.pendingByCommandId.keys());
        this.#consume(pendingCommandIds);

        let releasedDestinationCount = 0;
        let failedDestinationCount = 0;
        for (const pending of this.pendingDestinations.values()) {
            if (this.registry.cancelReservation(pending.handle)) {
                releasedDestinationCount++;
            } else {
                failedDestinationCount++;
            }
            this.#releaseSelectionBinding(
                pending.selectionBindingKey,
                pending.commandId
            );
        }
        this.pendingDestinations.clear();
        for (const pending of this.pendingPriorityControlsByKey.values()) {
            const known = this.knownCommands.get(pending.commandId);
            if (known) {
                known.completed = true;
            }
            this.#rememberCompleted(pending.commandId);
        }
        this.pendingPriorityControlsByKey.clear();
        this.pendingPriorityControlsByCommandId.clear();
        this.pendingPriorityControlsBySourceTick.clear();
        this.selectionBindingClaims.clear();
        this.bodyControlCompletionScratch.length = 0;
        this.spawnCompletionScratch.length = 0;
        if (failedDestinationCount > 0) {
            this.recoveryRequired = true;
        }
        return Object.freeze({
            cancelledCommandCount: pendingCommandIds.size,
            releasedDestinationCount,
            failedDestinationCount
        });
    }

    /**
     * 이미 GPU submit된 unresolved fixed program까지 exact identity로 취소합니다.
     * backend가 전체 exact set을 preflight/arm한 뒤에만 registry와 owner state를
     * 회수하므로 mismatch 시 CPU 쪽 partial delete가 발생하지 않습니다.
     */
    #cancelForTerminal(finalFixedTick) {
        const tick = requirePositiveSafeInteger(finalFixedTick, 'finalFixedTick');
        const destinationHandles = [...this.pendingDestinations.values()]
            .map((pending) => Object.freeze({ ...pending.handle }))
            .sort((left, right) => left.entityId - right.entityId
                || left.incarnation - right.incarnation);
        const priorityControls = [...this.pendingPriorityControlsByKey.values()]
            .map((pending) => Object.freeze({
                sourceTick: pending.targetFixedTick,
                sourceHandle: Object.freeze({ ...pending.payload.sourceHandle })
            }))
            .sort((left, right) => left.sourceTick - right.sourceTick
                || left.sourceHandle.entityId - right.sourceHandle.entityId
                || left.sourceHandle.incarnation - right.sourceHandle.incarnation);

        const missingReservation = destinationHandles.find(
            (handle) => !this.registry.hasReservation(handle)
        );
        if (missingReservation) {
            this.recoveryRequired = true;
            this.terminalCancelResult = Object.freeze({
                abiVersion: GPU_FIXED_PRIMITIVE_TERMINAL_CANCEL_ABI_VERSION,
                finalFixedTick: tick,
                accepted: false,
                state: 'failed',
                reason: 'terminal-reservation-exact-set-mismatch',
                destinationCount: destinationHandles.length,
                priorityControlCount: priorityControls.length
            });
            return this.terminalCancelResult;
        }

        let backendResult;
        try {
            backendResult = this.backend.cancelPendingFixedProgramsForTerminal({
                abiVersion: GPU_FIXED_PRIMITIVE_TERMINAL_CANCEL_ABI_VERSION,
                finalFixedTick: tick,
                reason: this.ingressCloseReason,
                destinationHandles: Object.freeze(destinationHandles),
                priorityControls: Object.freeze(priorityControls)
            });
        } catch (error) {
            backendResult = Object.freeze({
                accepted: false,
                state: 'failed',
                reason: 'terminal-fixed-program-cancel-exception',
                message: String(error?.message ?? error)
            });
        }
        const destinationCount = Number(backendResult?.destinationCount);
        const priorityControlCount = Number(backendResult?.priorityControlCount);
        const backendAccepted = backendResult?.accepted === true
            && backendResult.abiVersion
                === GPU_FIXED_PRIMITIVE_TERMINAL_CANCEL_ABI_VERSION
            && backendResult.finalFixedTick === tick
            && backendResult.state === 'armed'
            && destinationCount === destinationHandles.length
            && priorityControlCount === priorityControls.length;
        if (!backendAccepted) {
            this.recoveryRequired = true;
            this.terminalCancelResult = Object.freeze({
                abiVersion: GPU_FIXED_PRIMITIVE_TERMINAL_CANCEL_ABI_VERSION,
                finalFixedTick: tick,
                accepted: false,
                state: 'failed',
                reason: backendResult?.reason
                    ?? 'terminal-fixed-program-exact-set-mismatch',
                destinationCount: destinationHandles.length,
                priorityControlCount: priorityControls.length
            });
            return this.terminalCancelResult;
        }

        const cleanup = this.cancelAll();
        const cpuCleanupAccepted = cleanup.failedDestinationCount === 0
            && cleanup.releasedDestinationCount === destinationHandles.length;
        if (!cpuCleanupAccepted) {
            this.recoveryRequired = true;
        }
        this.terminalCancelResult = Object.freeze({
            abiVersion: GPU_FIXED_PRIMITIVE_TERMINAL_CANCEL_ABI_VERSION,
            finalFixedTick: tick,
            accepted: cpuCleanupAccepted,
            state: cpuCleanupAccepted ? 'armed' : 'failed',
            reason: cpuCleanupAccepted
                ? null
                : 'terminal-registry-cancel-partial',
            destinationCount: destinationHandles.length,
            priorityControlCount: priorityControls.length,
            ...cleanup
        });
        return this.terminalCancelResult;
    }

    /** terminal 전이 뒤 raw owner reference까지 영구히 닫고 pending을 회수합니다. */
    closeIngress(reason = 'gameplay-ingress-closed', finalFixedTick = null) {
        this.#assertUsable();
        let cleanup = Object.freeze({
            cancelledCommandCount: 0,
            releasedDestinationCount: 0,
            failedDestinationCount: 0
        });
        if (this.ingressOpen) {
            this.ingressOpen = false;
            this.ingressCloseReason = typeof reason === 'string' && reason.length > 0
                ? reason
                : 'gameplay-ingress-closed';
            cleanup = finalFixedTick === null || finalFixedTick === undefined
                ? this.cancelAll()
                : this.#cancelForTerminal(finalFixedTick);
        } else if ((finalFixedTick !== null && finalFixedTick !== undefined)
            && this.terminalCancelResult === null) {
            cleanup = this.#cancelForTerminal(finalFixedTick);
        }
        const result = {
            closed: !this.ingressOpen,
            reason: this.ingressCloseReason,
            ...cleanup
        };
        if (this.terminalCancelResult) {
            result.terminalCancellation = this.terminalCancelResult;
        }
        return Object.freeze(result);
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        this.closeIngress('destroyed');
        this.knownCommands.clear();
        this.controlTargetKeys.clear();
        this.selectionBindingClaims.clear();
        this.pendingByCommandId.clear();
        this.pendingCommandsByTargetFixedTick.clear();
        this.freePendingSlots.length = 0;
        this.pendingPriorityControlsByKey.clear();
        this.pendingPriorityControlsByCommandId.clear();
        this.pendingPriorityControlsBySourceTick.clear();
        this.destroyed = true;
    }

    #enqueue(command, fingerprint) {
        this.#evictCompletedHistoryForInsert();
        const domainCount = isControlCommand(command)
            ? this.pendingControlCount
            : this.pendingSourceRelativeSpawnCount;
        const domainCapacity = isControlCommand(command)
            ? this.controlCommandCapacity
            : this.sourceRelativeSpawnCommandCapacity;
        const commandCapacityExceeded = this.usesSharedCommandCapacity
            ? this.pendingCount >= this.commandCapacity
            : domainCount >= domainCapacity;
        if (commandCapacityExceeded
            || this.knownCommands.size >= this.historyCapacity) {
            this.telemetry.capacityRejected++;
            const receipt = Object.freeze({
                accepted: false,
                commandId: command.commandId,
                reason: 'command-capacity'
            });
            return { accepted: false, receipt, command: null };
        }
        const slot = this.freePendingSlots.pop();
        if (!Number.isInteger(slot) || slot < 0 || slot >= this.commandCapacity) {
            throw new Error('fixed command free slot index가 pendingCount와 다릅니다.');
        }
        const stored = {
            ...command,
            sequence: this.nextSequence++,
            slot
        };
        this.pending[slot] = stored;
        this.pendingByCommandId.set(stored.commandId, stored);
        let targetTickCommands = this.pendingCommandsByTargetFixedTick.get(
            stored.targetFixedTick
        );
        if (!targetTickCommands) {
            targetTickCommands = new Set();
            this.pendingCommandsByTargetFixedTick.set(
                stored.targetFixedTick,
                targetTickCommands
            );
        }
        targetTickCommands.add(stored);
        this.pendingCount++;
        if (isControlCommand(command)) {
            this.pendingControlCount++;
        } else {
            this.pendingSourceRelativeSpawnCount++;
        }
        const receipt = Object.freeze({
            accepted: true,
            commandId: command.commandId,
            targetFixedTick: command.targetFixedTick
        });
        this.knownCommands.set(command.commandId, {
            fingerprint,
            receipt,
            completed: false
        });
        return { accepted: true, receipt, command: stored };
    }

    #handleKnownCommand(commandId, fingerprint) {
        const known = this.knownCommands.get(commandId);
        if (!known) {
            return null;
        }
        if (known.fingerprint !== fingerprint) {
            throw new RangeError(`commandId가 다른 payload로 재사용되었습니다: ${commandId}`);
        }
        this.telemetry.replayed++;
        return Object.freeze({ ...known.receipt, replay: true });
    }

    #rememberImmediateRejection(commandId, fingerprint, reason) {
        const receipt = Object.freeze({ accepted: false, commandId, reason });
        this.#evictCompletedHistoryForInsert();
        if (this.knownCommands.size >= this.historyCapacity) {
            this.telemetry.capacityRejected++;
            return receipt;
        }
        this.knownCommands.set(commandId, {
            fingerprint,
            receipt,
            completed: true
        });
        this.#rememberCompleted(commandId);
        return receipt;
    }

    #getExactActiveDisposition(handle) {
        const registryHas = this.registry.has(handle);
        const backendHas = this.backend.hasBody(handle);
        if (registryHas !== backendHas) {
            this.recoveryRequired = true;
            return 'desync';
        }
        return registryHas && backendHas ? 'active' : 'stale';
    }

    #consume(commandIds) {
        if (commandIds.size === 0) {
            return;
        }
        for (const commandId of commandIds) {
            const command = this.pendingByCommandId.get(commandId);
            if (!command) {
                continue;
            }
            this.pending[command.slot] = null;
            this.pendingByCommandId.delete(commandId);
            const targetTickCommands = this.pendingCommandsByTargetFixedTick
                .get(command.targetFixedTick);
            targetTickCommands?.delete(command);
            if (targetTickCommands?.size === 0) {
                this.pendingCommandsByTargetFixedTick.delete(
                    command.targetFixedTick
                );
            }
            this.freePendingSlots.push(command.slot);
            this.pendingCount--;
            if (isControlCommand(command)) {
                this.pendingControlCount--;
            } else {
                this.pendingSourceRelativeSpawnCount--;
            }
            if (command.targetKey) {
                this.controlTargetKeys.delete(command.targetKey);
            }
            if (command.selectionBindingKey) {
                const claim = this.selectionBindingClaims.get(
                    command.selectionBindingKey
                );
                if (claim?.state !== 'gpu-pending') {
                    this.#releaseSelectionBinding(
                        command.selectionBindingKey,
                        command.commandId
                    );
                }
            }
            const known = this.knownCommands.get(command.commandId);
            const awaitsPriorityControlResult =
                this.pendingPriorityControlsByCommandId.has(
                    command.commandId
                );
            if (known && !awaitsPriorityControlResult) {
                known.completed = true;
            }
            if (!awaitsPriorityControlResult) {
                this.#rememberCompleted(command.commandId);
            }
        }
    }

    #releaseSelectionBinding(selectionBindingKey, commandId) {
        if (!selectionBindingKey) {
            return false;
        }
        const claim = this.selectionBindingClaims.get(selectionBindingKey);
        if (!claim || claim.commandId !== commandId) {
            return false;
        }
        this.selectionBindingClaims.delete(selectionBindingKey);
        return true;
    }

    #rememberCompleted(commandId) {
        this.completedCommandIds.push(commandId);
        while ((this.completedCommandIds.length - this.completedCommandHead)
            > this.historyCapacity) {
            const forgotten = this.completedCommandIds[this.completedCommandHead++];
            const known = this.knownCommands.get(forgotten);
            if (known?.completed) {
                this.knownCommands.delete(forgotten);
            }
        }
        if (this.completedCommandHead >= this.historyCapacity) {
            this.completedCommandIds = this.completedCommandIds.slice(
                this.completedCommandHead
            );
            this.completedCommandHead = 0;
        }
    }

    #evictCompletedHistoryForInsert() {
        while (this.knownCommands.size >= this.historyCapacity
            && this.completedCommandHead < this.completedCommandIds.length) {
            const forgotten = this.completedCommandIds[this.completedCommandHead++];
            const known = this.knownCommands.get(forgotten);
            if (known?.completed) {
                this.knownCommands.delete(forgotten);
            }
        }
        if (this.completedCommandHead >= this.historyCapacity) {
            this.completedCommandIds = this.completedCommandIds.slice(
                this.completedCommandHead
            );
            this.completedCommandHead = 0;
        }
    }

    #saveResult(result) {
        if (result.recoveryRequired && result.state === 'failed') {
            this.recoveryRequired = true;
        }
        this.lastCommitResult = freezeResult(result);
        return this.lastCommitResult;
    }

    #rejectClosedIngress() {
        if (this.ingressOpen) {
            return null;
        }
        return Object.freeze({
            accepted: false,
            reason: this.ingressCloseReason ?? 'gameplay-ingress-closed'
        });
    }

    #assertUsable() {
        if (this.destroyed) {
            throw new Error('destroy된 GpuFixedCommandOwner는 사용할 수 없습니다.');
        }
    }
}
