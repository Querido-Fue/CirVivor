import {
    normalizeGpuCircleBodyContactHandler,
    normalizeGpuCircleBodyMetadata,
    encodeGpuCircleBodyFixedPoint
} from '../physics/gpu/gpu_circle_body_abi.js';
import {
    GPU_EFFECT_LAST_PULSE_TICK_INVALID,
    normalizeGpuEffectEmitterState
} from '../physics/gpu/gpu_effect_runtime_abi.js';
import {
    ENEMY_EFFECT_DEFINITION_BY_ID,
    ENEMY_EFFECT_EMITTER_PROFILE_BY_ID
} from 'data/object/enemy/enemy_effect_catalog_data.js';
import {
    PROJECTILE_CORE_DAMAGE_REQUEST_POLICY_ID,
    PROJECTILE_SELECTED_TARGET_DISTANCE_POLICY_ID,
    PROJECTILE_SELECTED_TARGET_POLICY_ID,
    PROJECTILE_TARGET_POLICY_ID
} from '../contract/projectile_target_policy_contract.js';
import {
    GAMEPLAY_ALLEGIANCE_POLICY,
    GAMEPLAY_DAMAGE_POLICY_ID,
    normalizeGameplayAllegiancePolicy,
    normalizeGameplayDamagePolicyId,
    resolveGameplayAllegianceTeam
} from '../contract/gameplay_team_contract.js';
import {
    ENEMY_CAPABILITY_ID,
    hasEnemyCapability,
    normalizeEnemyCapabilityMask
} from '../contract/enemy_capability_contract.js';

const INVALID_HANDLE_COMPONENT = 0xffffffff;

function requireNonNegativeSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
        throw new RangeError(`${label}은 0 이상의 안전한 정수여야 합니다.`);
    }
    return number;
}

function requirePositiveFinite(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
        throw new RangeError(`${label}은 양의 유한 숫자여야 합니다.`);
    }
    return number;
}

function requireExactIdentityComponent(value, label) {
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

function requireBoolean(value, label) {
    if (typeof value !== 'boolean') {
        throw new TypeError(`${label}은 boolean이어야 합니다.`);
    }
    return value;
}

function requireNonNegativeFinite(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
        throw new RangeError(`${label}은 0 이상의 유한 숫자여야 합니다.`);
    }
    return number;
}

function copyOptionalEnemyProfileMetadata(intent) {
    const fields = [
        'physicsProfileId',
        'combatProfileId',
        'behaviorProfileId'
    ];
    const hasAny = fields.some((field) => intent[field] !== undefined);
    if (!hasAny) {
        return {};
    }
    const metadata = {};
    for (const field of fields) {
        metadata[field] = requireNonEmptyString(
            intent[field],
            `spawnIntent.${field}`
        );
    }
    return metadata;
}

function copyOptionalEnemyCapabilityMetadata(intent) {
    if (intent.capabilityMask === undefined || intent.capabilityMask === null) {
        return {};
    }
    return {
        capabilityMask: normalizeEnemyCapabilityMask(
            intent.capabilityMask,
            'spawnIntent.capabilityMask'
        )
    };
}

const ENEMY_EFFECT_METADATA_FIELDS = Object.freeze([
    'effectEmitterProfileId',
    'effectEmitterDefinitionCode',
    'effectDefinitionId',
    'effectDefinitionCode',
    'effectSelfTargetAllowed',
    'effectPentaTargetAllowed',
    'effectTowerContactDamageModifiable',
    'effectProjectileTowerDamageModifiable',
    'effectDirectCoreImpactDamageModifiable',
    'effectProjectileCoreDamageModifiable',
    'effectClusterRetargetIntervalTicks'
]);

function hasAnyEnemyEffectMetadata(intent) {
    return ENEMY_EFFECT_METADATA_FIELDS.some(
        (field) => intent[field] !== undefined && intent[field] !== null
    );
}

function copyOptionalEnemyEffectMetadata(intent) {
    if (!hasAnyEnemyEffectMetadata(intent)) {
        return {};
    }
    for (const field of ENEMY_EFFECT_METADATA_FIELDS) {
        if (intent[field] === undefined || intent[field] === null) {
            throw new TypeError('enemy effect metadata field는 모두 함께 제공해야 합니다.');
        }
    }
    const metadata = {
        effectEmitterProfileId: requireNonEmptyString(
            intent.effectEmitterProfileId,
            'spawnIntent.effectEmitterProfileId'
        ),
        effectEmitterDefinitionCode: requireExactIdentityComponent(
            intent.effectEmitterDefinitionCode,
            'spawnIntent.effectEmitterDefinitionCode'
        ),
        effectDefinitionId: requireNonEmptyString(
            intent.effectDefinitionId,
            'spawnIntent.effectDefinitionId'
        ),
        effectDefinitionCode: requireExactIdentityComponent(
            intent.effectDefinitionCode,
            'spawnIntent.effectDefinitionCode'
        ),
        effectSelfTargetAllowed: requireBoolean(
            intent.effectSelfTargetAllowed,
            'spawnIntent.effectSelfTargetAllowed'
        ),
        effectPentaTargetAllowed: requireBoolean(
            intent.effectPentaTargetAllowed,
            'spawnIntent.effectPentaTargetAllowed'
        ),
        effectTowerContactDamageModifiable: requireBoolean(
            intent.effectTowerContactDamageModifiable,
            'spawnIntent.effectTowerContactDamageModifiable'
        ),
        effectProjectileTowerDamageModifiable: requireBoolean(
            intent.effectProjectileTowerDamageModifiable,
            'spawnIntent.effectProjectileTowerDamageModifiable'
        ),
        effectDirectCoreImpactDamageModifiable: requireBoolean(
            intent.effectDirectCoreImpactDamageModifiable,
            'spawnIntent.effectDirectCoreImpactDamageModifiable'
        ),
        effectProjectileCoreDamageModifiable: requireBoolean(
            intent.effectProjectileCoreDamageModifiable,
            'spawnIntent.effectProjectileCoreDamageModifiable'
        ),
        effectClusterRetargetIntervalTicks: requireExactIdentityComponent(
            intent.effectClusterRetargetIntervalTicks,
            'spawnIntent.effectClusterRetargetIntervalTicks'
        )
    };
    const emitterProfile = ENEMY_EFFECT_EMITTER_PROFILE_BY_ID[
        metadata.effectEmitterProfileId
    ];
    const effectDefinition = ENEMY_EFFECT_DEFINITION_BY_ID[
        metadata.effectDefinitionId
    ];
    if (!emitterProfile
        || !effectDefinition
        || emitterProfile.emitterDefinitionCode
            !== metadata.effectEmitterDefinitionCode
        || emitterProfile.effectDefinitionId !== effectDefinition.id
        || emitterProfile.effectDefinitionCode !== effectDefinition.effectDefinitionCode
        || effectDefinition.effectDefinitionCode !== metadata.effectDefinitionCode
        || emitterProfile.selfTargetAllowed !== metadata.effectSelfTargetAllowed
        || emitterProfile.pentaTargetAllowed !== metadata.effectPentaTargetAllowed
        || effectDefinition.towerContactDamageEffectModifiable
            !== metadata.effectTowerContactDamageModifiable
        || effectDefinition.projectileTowerDamageEffectModifiable
            !== metadata.effectProjectileTowerDamageModifiable
        || effectDefinition.directCoreImpactDamageEffectModifiable
            !== metadata.effectDirectCoreImpactDamageModifiable
        || effectDefinition.typedProjectileCoreDamageEffectModifiable
            !== metadata.effectProjectileCoreDamageModifiable
        || emitterProfile.retargetIntervalTicks
            !== metadata.effectClusterRetargetIntervalTicks) {
        throw new RangeError(
            'enemy effect metadata가 exact catalog profile/definition과 일치해야 합니다.'
        );
    }
    return metadata;
}

function normalizeOptionalEnemyEffectEmitterState(intent, capabilityMask) {
    const hasEffectCapability = capabilityMask !== null
        && hasEnemyCapability(
            capabilityMask,
            ENEMY_CAPABILITY_ID.EFFECT_EMITTER,
            'spawnIntent.capabilityMask'
        );
    const hasEffectMetadata = hasAnyEnemyEffectMetadata(intent);
    const hasEmitterState = intent.effectEmitterState !== undefined
        && intent.effectEmitterState !== null;
    if (hasEffectCapability !== hasEffectMetadata
        || hasEffectCapability !== hasEmitterState) {
        throw new RangeError(
            'EFFECT_EMITTER capability, effect metadata, effectEmitterState가 일치해야 합니다.'
        );
    }
    if (!hasEffectCapability) {
        return null;
    }
    const metadata = copyOptionalEnemyEffectMetadata(intent);
    const emitterState = normalizeGpuEffectEmitterState(
        intent.effectEmitterState,
        'spawnIntent.effectEmitterState'
    );
    if (emitterState.emitterDefinitionCode
            !== metadata.effectEmitterDefinitionCode
        || emitterState.effectDefinitionCode !== metadata.effectDefinitionCode) {
        throw new RangeError('effectEmitterState code가 effect metadata와 일치해야 합니다.');
    }
    if (emitterState.lastPulseTick !== GPU_EFFECT_LAST_PULSE_TICK_INVALID) {
        throw new RangeError(
            '신규 Effect emitter spawn의 lastPulseTick은 canonical sentinel이어야 합니다.'
        );
    }
    return emitterState;
}

function copyOptionalResolvedEnemyStatMetadata(intent) {
    const fields = [
        'coreImpactDamage',
        'towerContactDamage',
        'bountyBudget',
        'weight'
    ];
    const hasAny = fields.some((field) => intent[field] !== undefined);
    if (!hasAny) {
        return {};
    }
    const metadata = {};
    for (const field of fields) {
        metadata[field] = requireNonNegativeFinite(
            intent[field],
            `spawnIntent.${field}`
        );
    }
    if (!(metadata.weight > 0)) {
        throw new RangeError('spawnIntent.weight은 양의 유한 숫자여야 합니다.');
    }
    return metadata;
}

function materializeGpuPlainDataValue(source, label, ancestors, opaqueKeys = null) {
    if (source === null
        || typeof source === 'string'
        || typeof source === 'boolean'
        || typeof source === 'undefined') {
        return source;
    }
    if (typeof source === 'number') {
        if (!Number.isFinite(source)) {
            throw new TypeError(`${label}에는 유한 숫자만 사용할 수 있습니다.`);
        }
        return source;
    }
    if (typeof source !== 'object') {
        throw new TypeError(`${label}에는 함수나 symbol을 사용할 수 없습니다.`);
    }
    if (ancestors.has(source)) {
        throw new TypeError(`${label}에 순환 참조가 있습니다.`);
    }
    ancestors.add(source);
    try {
        const isArray = Array.isArray(source);
        const isTypedArray = ArrayBuffer.isView(source);
        if (isTypedArray && typeof source.length !== 'number') {
            throw new TypeError(`${label}은 typed array여야 합니다.`);
        }
        if (!isArray && !isTypedArray) {
            const prototype = Object.getPrototypeOf(source);
            const isPlainObject = prototype === null
                || Object.getPrototypeOf(prototype) === null;
            if (!isPlainObject) {
                throw new TypeError(`${label}은 plain object여야 합니다.`);
            }
        }

        // Proxy ownKeys/getter drift를 막기 위해 key 집합은 정확히 한 번만 읽고,
        // 각 enumerable string value도 정확히 한 번만 materialize합니다.
        const ownKeys = Reflect.ownKeys(source);
        if (ownKeys.some((key) => typeof key === 'symbol')) {
            throw new TypeError(`${label}에는 symbol을 사용할 수 없습니다.`);
        }
        const result = isArray || isTypedArray
            ? new Array(source.length)
            : Object.create(null);
        for (const key of ownKeys) {
            if ((isArray || isTypedArray) && key === 'length') {
                continue;
            }
            const descriptor = Object.getOwnPropertyDescriptor(source, key);
            if (!descriptor) {
                throw new TypeError(`${label}.${key} descriptor가 materialize 중 변경되었습니다.`);
            }
            if (!descriptor.enumerable) {
                continue;
            }
            const value = Reflect.get(source, key);
            result[key] = opaqueKeys?.has(key)
                ? value
                : materializeGpuPlainDataValue(
                    value,
                    `${label}.${key}`,
                    ancestors
                );
        }
        return Object.freeze(result);
    } finally {
        ancestors.delete(source);
    }
}

/**
 * GPU public ingress의 raw plain-data를 getter/Proxy 재평가 없이 한 번 읽어
 * deeply immutable snapshot으로 만듭니다.
 */
export function materializeGpuPlainDataSnapshot(
    source,
    label = 'gpuPlainData',
    options = {}
) {
    if (typeof label !== 'string' || label.length === 0) {
        throw new TypeError('plain-data snapshot label이 필요합니다.');
    }
    const opaqueKeys = new Set(options.opaqueKeys ?? []);
    for (const key of opaqueKeys) {
        if (typeof key !== 'string' || key.length === 0) {
            throw new TypeError('opaqueKeys에는 비어 있지 않은 문자열만 사용할 수 있습니다.');
        }
    }
    return materializeGpuPlainDataValue(source, label, new Set(), opaqueKeys);
}

function validateOptionalExactIdentityPair(snapshot, prefix) {
    const entityField = `${prefix}EntityId`;
    const incarnationField = `${prefix}Incarnation`;
    const hasEntityId = snapshot[entityField] !== undefined
        && snapshot[entityField] !== null;
    const hasIncarnation = snapshot[incarnationField] !== undefined
        && snapshot[incarnationField] !== null;
    if (hasEntityId !== hasIncarnation) {
        throw new TypeError(`${entityField}/${incarnationField}은 함께 제공해야 합니다.`);
    }
    if (!hasEntityId) {
        return;
    }
    requireExactIdentityComponent(snapshot[entityField], `spawnIntent.${entityField}`);
    requireExactIdentityComponent(
        snapshot[incarnationField],
        `spawnIntent.${incarnationField}`
    );
}

function copySelectedTargetProjectileMetadata(intent, activationEvidence = null) {
    if (intent.targetSelectionPolicyId === undefined
        && activationEvidence === null) {
        return {};
    }
    if (!activationEvidence || typeof activationEvidence !== 'object') {
        throw new TypeError('selected-target projectile activation evidence가 필요합니다.');
    }
    const selectedTargetKind = requireNonEmptyString(
        activationEvidence.selectedTargetKind,
        'activationEvidence.selectedTargetKind'
    );
    if (selectedTargetKind !== 'core' && selectedTargetKind !== 'tower') {
        throw new RangeError('selectedTargetKind는 core 또는 tower여야 합니다.');
    }
    const selectedTargetEntityId = requireExactIdentityComponent(
        activationEvidence.selectedTargetEntityId
            ?? activationEvidence.selectedTargetHandle?.entityId,
        'activationEvidence.selectedTargetEntityId'
    );
    const selectedTargetIncarnation = requireExactIdentityComponent(
        activationEvidence.selectedTargetIncarnation
            ?? activationEvidence.selectedTargetHandle?.incarnation,
        'activationEvidence.selectedTargetIncarnation'
    );
    const coreTargetEntityId = requireExactIdentityComponent(
        intent.coreTargetEntityId,
        'spawnIntent.coreTargetEntityId'
    );
    const coreTargetIncarnation = requireExactIdentityComponent(
        intent.coreTargetIncarnation,
        'spawnIntent.coreTargetIncarnation'
    );
    const hasTowerEntity = intent.towerTargetEntityId !== undefined
        && intent.towerTargetEntityId !== null;
    const hasTowerIncarnation = intent.towerTargetIncarnation !== undefined
        && intent.towerTargetIncarnation !== null;
    if (hasTowerEntity !== hasTowerIncarnation) {
        throw new TypeError('selected-target Tower exact identity는 pair여야 합니다.');
    }
    const towerTargetEntityId = hasTowerEntity
        ? requireExactIdentityComponent(
            intent.towerTargetEntityId,
            'spawnIntent.towerTargetEntityId'
        )
        : null;
    const towerTargetIncarnation = hasTowerEntity
        ? requireExactIdentityComponent(
            intent.towerTargetIncarnation,
            'spawnIntent.towerTargetIncarnation'
        )
        : null;
    const selectedMatchesAuthored = selectedTargetKind === 'core'
        ? selectedTargetEntityId === coreTargetEntityId
            && selectedTargetIncarnation === coreTargetIncarnation
        : towerTargetEntityId !== null
            && selectedTargetEntityId === towerTargetEntityId
            && selectedTargetIncarnation === towerTargetIncarnation;
    if (!selectedMatchesAuthored) {
        throw new RangeError('GPU selected outcome이 authored exact candidate와 다릅니다.');
    }
    const coreDamage = requirePositiveFinite(
        intent.coreDamage,
        'spawnIntent.coreDamage'
    );
    const coreDamageFixedPoint = requireExactIdentityComponent(
        intent.coreDamageFixedPoint,
        'spawnIntent.coreDamageFixedPoint'
    );
    if (intent.requiresExactSelectedTarget !== true) {
        throw new RangeError('selected-target projectile에는 exact target policy가 필요합니다.');
    }
    const targetSelectionPolicyId = requireNonEmptyString(
        intent.targetSelectionPolicyId,
        'spawnIntent.targetSelectionPolicyId'
    );
    const distancePolicyId = requireNonEmptyString(
        intent.distancePolicyId,
        'spawnIntent.distancePolicyId'
    );
    const towerTargetPolicyId = requireNonEmptyString(
        intent.towerTargetPolicyId,
        'spawnIntent.towerTargetPolicyId'
    );
    const coreTargetPolicyId = requireNonEmptyString(
        intent.coreTargetPolicyId,
        'spawnIntent.coreTargetPolicyId'
    );
    const coreDamageRequestPolicyId = requireNonEmptyString(
        intent.coreDamageRequestPolicyId,
        'spawnIntent.coreDamageRequestPolicyId'
    );
    const selectedTargetPolicyId = requireNonEmptyString(
        activationEvidence.selectedTargetPolicyId,
        'activationEvidence.selectedTargetPolicyId'
    );
    if (intent.targetPolicyId
            !== PROJECTILE_TARGET_POLICY_ID
                .GPU_SELECTED_CORE_OR_PLAYER_DAMAGEABLE_AND_TERRAIN
        || targetSelectionPolicyId
            !== PROJECTILE_SELECTED_TARGET_POLICY_ID
                .CORE_FIRST_IN_RANGE_THEN_TOWER
        || distancePolicyId
            !== PROJECTILE_SELECTED_TARGET_DISTANCE_POLICY_ID
                .TICK_START_CENTER_INCLUSIVE
        || towerTargetPolicyId
            !== PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN
        || coreTargetPolicyId
            !== PROJECTILE_TARGET_POLICY_ID.CORE_PROXY_AND_TERRAIN
        || coreDamageRequestPolicyId
            !== PROJECTILE_CORE_DAMAGE_REQUEST_POLICY_ID.TYPED_CPU_CORE_DAMAGE
        || coreDamageFixedPoint !== encodeGpuCircleBodyFixedPoint(coreDamage)
        || selectedTargetPolicyId !== (selectedTargetKind === 'core'
            ? coreTargetPolicyId
            : towerTargetPolicyId)) {
        throw new RangeError('selected-target projectile resolved policy evidence가 올바르지 않습니다.');
    }
    return {
        targetSelectionPolicyId,
        distancePolicyId,
        attackRangeTiles: requirePositiveFinite(
            intent.attackRangeTiles,
            'spawnIntent.attackRangeTiles'
        ),
        towerTargetPolicyId,
        coreTargetPolicyId,
        coreDamageRequestPolicyId,
        coreDamage,
        coreDamageFixedPoint,
        requiresExactSelectedTarget: true,
        coreTargetEntityId,
        coreTargetIncarnation,
        ...(towerTargetEntityId === null ? {} : {
            towerTargetEntityId,
            towerTargetIncarnation
        }),
        selectedTargetKind,
        selectedTargetEntityId,
        selectedTargetIncarnation,
        selectedTargetPolicyId,
        selectionSourceTick: requireExactIdentityComponent(
            activationEvidence.selectionSourceTick,
            'activationEvidence.selectionSourceTick'
        ),
        selectionSequence: requireNonNegativeSafeInteger(
            activationEvidence.selectionSequence,
            'activationEvidence.selectionSequence'
        ),
        attackFingerprint: requireExactIdentityComponent(
            activationEvidence.attackFingerprint,
            'activationEvidence.attackFingerprint'
        )
    };
}

/** 모든 GPU body producer가 공유하는 canonical immutable spawn ingress입니다. */
export function normalizeGpuSpawnIntent(source, options = {}) {
    if (!source || typeof source !== 'object') {
        throw new TypeError('GPU body spawn intent가 필요합니다.');
    }
    const snapshot = materializeGpuPlainDataSnapshot(source, 'spawnIntent');
    if (Object.prototype.hasOwnProperty.call(snapshot, 'entityId')
        || Object.prototype.hasOwnProperty.call(snapshot, 'incarnation')
        || Object.prototype.hasOwnProperty.call(snapshot, 'handle')) {
        throw new TypeError('spawn identity는 WorldRegistry만 발급할 수 있습니다.');
    }
    const kindId = requireNonEmptyString(snapshot.kindId, 'spawnIntent.kindId');
    const legacyEnemyDefinitionId = snapshot.enemyDefinitionId;
    const definitionId = requireNonEmptyString(
        snapshot.definitionId ?? legacyEnemyDefinitionId,
        'spawnIntent.definitionId'
    );
    if (snapshot.definitionId !== undefined
        && legacyEnemyDefinitionId !== undefined
        && snapshot.definitionId !== legacyEnemyDefinitionId) {
        throw new RangeError(
            'spawnIntent.definitionId와 enemyDefinitionId alias가 일치해야 합니다.'
        );
    }

    const metadata = normalizeGpuCircleBodyMetadata(snapshot, {
        requireNonZeroLayers: true
    });
    const allegiancePolicy = normalizeGameplayAllegiancePolicy(
        snapshot.allegiancePolicy
            ?? GAMEPLAY_ALLEGIANCE_POLICY.EXPLICIT_OVERRIDE,
        'spawnIntent.allegiancePolicy'
    );
    const teamId = resolveGameplayAllegianceTeam({
        policy: allegiancePolicy,
        teamId: snapshot.teamId,
        subjectTeamId: options.subjectTeamId
    });
    const damagePolicyId = normalizeGameplayDamagePolicyId(
        snapshot.damagePolicyId
            ?? GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX,
        'spawnIntent.damagePolicyId'
    );
    validateOptionalExactIdentityPair(snapshot, 'owner');
    validateOptionalExactIdentityPair(snapshot, 'source');
    validateOptionalExactIdentityPair(snapshot, 'target');
    const contactHandler = normalizeGpuCircleBodyContactHandler(snapshot);
    if (snapshot.spawnSequence !== undefined && snapshot.spawnSequence !== null) {
        requireNonNegativeSafeInteger(snapshot.spawnSequence, 'spawnIntent.spawnSequence');
    }
    let normalizedEffectEmitterState = null;
    if (kindId === 'enemy') {
        requireNonEmptyString(snapshot.gateId, 'spawnIntent.gateId');
        requireNonEmptyString(snapshot.pathId, 'spawnIntent.pathId');
        requireNonNegativeSafeInteger(snapshot.waypointIndex, 'spawnIntent.waypointIndex');
        requirePositiveFinite(snapshot.flowSpeed, 'spawnIntent.flowSpeed');
        const capabilityMask = snapshot.capabilityMask !== undefined
            && snapshot.capabilityMask !== null
            ? normalizeEnemyCapabilityMask(
                snapshot.capabilityMask,
                'spawnIntent.capabilityMask'
            )
            : null;
        normalizedEffectEmitterState = normalizeOptionalEnemyEffectEmitterState(
            snapshot,
            capabilityMask
        );
    } else if (hasAnyEnemyEffectMetadata(snapshot)
        || snapshot.effectEmitterState !== undefined) {
        throw new TypeError('Effect emitter metadata/state는 Enemy spawn에만 허용됩니다.');
    }
    const {
        layerMask: _legacyLayerMask,
        sensorMask: _legacySensorMask,
        ...canonicalSnapshot
    } = snapshot;
    return Object.freeze({
        ...canonicalSnapshot,
        definitionId,
        ...(kindId === 'enemy' ? { enemyDefinitionId: definitionId } : {}),
        teamId,
        damagePolicyId,
        allegiancePolicy,
        ...metadata,
        ...(normalizedEffectEmitterState === null ? {} : {
            effectEmitterState: normalizedEffectEmitterState
        }),
        contactHandler
    });
}

/** Registry가 GPU body identity와 함께 보존할 CPU domain metadata를 만듭니다. */
export function createGpuRegistryMetadata(intent, activationEvidence = null) {
    const common = {
        definitionId: intent.definitionId,
        teamId: intent.teamId,
        damagePolicyId: intent.damagePolicyId,
        allegiancePolicy: intent.allegiancePolicy,
        ownerEntityId: intent.ownerEntityId,
        ownerIncarnation: intent.ownerIncarnation,
        sourceEntityId: intent.sourceEntityId,
        sourceIncarnation: intent.sourceIncarnation,
        targetEntityId: intent.targetEntityId,
        targetIncarnation: intent.targetIncarnation,
        producerId: intent.producerId,
        sourceAbilityId: intent.sourceAbilityId,
        targetPolicyId: intent.targetPolicyId
    };
    if (intent.kindId === 'enemy') {
        return {
            ...common,
            enemyDefinitionId: intent.enemyDefinitionId,
            gateId: intent.gateId,
            pathId: intent.pathId,
            initialWaypointIndex: intent.waypointIndex,
            spawnSequence: intent.spawnSequence,
            waveId: intent.waveId,
            policyId: intent.policyId,
            // Stable capability mask, profile ID와 final resolved primitive만 보존합니다.
            // capability ID 배열이나 content object는 registry에 직렬화하지 않습니다.
            ...copyOptionalEnemyCapabilityMetadata(intent),
            ...copyOptionalEnemyProfileMetadata(intent),
            ...copyOptionalEnemyEffectMetadata(intent),
            ...copyOptionalResolvedEnemyStatMetadata(intent)
        };
    }
    return {
        ...common,
        spawnSequence: intent.spawnSequence,
        ...copySelectedTargetProjectileMetadata(intent, activationEvidence)
    };
}
