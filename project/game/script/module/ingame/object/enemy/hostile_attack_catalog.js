import {
    INGAME_ENEMY_DEFINITION_BY_ID
} from 'data/object/enemy/basic_circle_enemy_data.js';
import {
    HOSTILE_ATTACK_DEFINITION_BY_ID
} from 'data/object/enemy/archer_attack_data.js';
import {
    BASIC_RHOM_ATTACK_DEFINITION_BY_ID,
    HOSTILE_RANGED_DISTANCE_POLICY_ID,
    HOSTILE_RANGED_MOVEMENT_POLICY_ID,
    HOSTILE_RANGED_TARGET_SELECTION_POLICY_ID,
    HOSTILE_RANGED_TARGET_SNAPSHOT_POLICY_ID
} from 'data/object/enemy/basic_rhom_attack_data.js';
import {
    HOSTILE_BASIC_BULLET_DATA
} from 'data/object/projectile/hostile_basic_bullet_data.js';
import {
    HOSTILE_RHOM_PROJECTILE_DATA
} from 'data/object/projectile/hostile_rhom_projectile_data.js';
import {
    GAMEPLAY_ALLEGIANCE_POLICY,
    GAMEPLAY_TEAM_ID
} from '../../contract/gameplay_team_contract.js';
import {
    PROJECTILE_TARGET_POLICY_ID
} from '../../contract/projectile_target_policy_contract.js';
import {
    createEnemyCapabilityMask,
    ENEMY_CAPABILITY_ID,
    hasEnemyCapability
} from '../../contract/enemy_capability_contract.js';
import {
    HOSTILE_ATTACK_TARGET_MODE,
    requireNonEmptyString,
    requirePositiveSafeInteger,
    requireNonNegativeSafeInteger,
    requirePositiveFloat32,
    freezeVector
} from './hostile_attack_protocol.js';

const CURRENT_TOWER_TARGET_POLICY = 'current-single-living-tower';

const CAST_START_TARGET_SNAPSHOT_POLICY = 'cast-start-exact-handle';

const DEFAULT_HOSTILE_ENEMY_DEFINITION_BY_ID = INGAME_ENEMY_DEFINITION_BY_ID;

const DEFAULT_HOSTILE_ATTACK_DEFINITION_BY_ID = Object.freeze({
    ...HOSTILE_ATTACK_DEFINITION_BY_ID,
    ...BASIC_RHOM_ATTACK_DEFINITION_BY_ID
});

const DEFAULT_HOSTILE_PROJECTILE_DEFINITION_BY_ID = Object.freeze({
    [HOSTILE_BASIC_BULLET_DATA.id]: HOSTILE_BASIC_BULLET_DATA,
    [HOSTILE_RHOM_PROJECTILE_DATA.id]: HOSTILE_RHOM_PROJECTILE_DATA
});

function requireCatalog(source, label) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new TypeError(`${label} catalog 객체가 필요합니다.`);
    }
    return source;
}

function normalizeAttackDefinition(source, label) {
    if (!source || typeof source !== 'object') {
        throw new TypeError(`${label} attack definition이 필요합니다.`);
    }
    const allegiancePolicy = requireNonEmptyString(
        source.allegiancePolicy,
        `${label}.allegiancePolicy`
    );
    const targetPolicyId = requireNonEmptyString(
        source.targetPolicyId,
        `${label}.targetPolicyId`
    );
    if (allegiancePolicy !== GAMEPLAY_ALLEGIANCE_POLICY.INHERIT_SUBJECT) {
        throw new RangeError(`${label}은 inherit-subject allegiance를 사용해야 합니다.`);
    }
    const common = {
        id: requireNonEmptyString(source.id, `${label}.id`),
        sourceEnemyDefinitionId: requireNonEmptyString(
            source.sourceEnemyDefinitionId,
            `${label}.sourceEnemyDefinitionId`
        ),
        projectileDefinitionId: requireNonEmptyString(
            source.projectileDefinitionId,
            `${label}.projectileDefinitionId`
        ),
        launchSpeed: requirePositiveFloat32(
            source.launchSpeed,
            `${label}.launchSpeed`
        ),
        positionOffset: freezeVector(source.positionOffset, `${label}.positionOffset`),
        targetOffset: freezeVector(source.targetOffset, `${label}.targetOffset`),
        initialDelayTicks: requirePositiveSafeInteger(
            source.initialDelayTicks,
            `${label}.initialDelayTicks`
        ),
        intervalTicks: requirePositiveSafeInteger(
            source.intervalTicks,
            `${label}.intervalTicks`
        ),
        phaseSpreadTicks: requireNonNegativeSafeInteger(
            source.phaseSpreadTicks,
            `${label}.phaseSpreadTicks`
        ),
        allegiancePolicy,
        targetPolicyId,
        producerId: requireNonEmptyString(source.producerId, `${label}.producerId`),
        sourceAbilityId: requireNonEmptyString(
            source.sourceAbilityId,
            `${label}.sourceAbilityId`
        )
    };
    const isCorePrioritySelected = source.targetSelectionPolicy
        === HOSTILE_RANGED_TARGET_SELECTION_POLICY_ID
            .CORE_FIRST_IN_RANGE_THEN_TOWER;
    if (!isCorePrioritySelected) {
        if (targetPolicyId
            !== PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN) {
            throw new RangeError(
                `${label}은 Player-damageable target policy를 사용해야 합니다.`
            );
        }
        if (source.targetPolicy !== CURRENT_TOWER_TARGET_POLICY
            || source.targetSnapshotPolicy !== CAST_START_TARGET_SNAPSHOT_POLICY) {
            throw new RangeError(
                `${label}의 Tower target snapshot policy가 올바르지 않습니다.`
            );
        }
        return Object.freeze({
            ...common,
            targetMode: HOSTILE_ATTACK_TARGET_MODE.CURRENT_TOWER,
            targetPolicy: source.targetPolicy,
            targetSnapshotPolicy: source.targetSnapshotPolicy
        });
    }
    if (targetPolicyId
        !== PROJECTILE_TARGET_POLICY_ID
            .GPU_SELECTED_CORE_OR_PLAYER_DAMAGEABLE_AND_TERRAIN
        || source.targetSnapshotPolicy
            !== HOSTILE_RANGED_TARGET_SNAPSHOT_POLICY_ID
                .GPU_FIXED_TICK_EXACT_PRIORITY
        || source.distancePolicy
            !== HOSTILE_RANGED_DISTANCE_POLICY_ID.TICK_START_CENTER_INCLUSIVE
        || source.movementPolicy
            !== HOSTILE_RANGED_MOVEMENT_POLICY_ID.STOP_WHILE_TARGET_IN_RANGE
        || source.towerTargetPolicyId
            !== PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN
        || source.coreTargetPolicyId
            !== PROJECTILE_TARGET_POLICY_ID.CORE_PROXY_AND_TERRAIN) {
        throw new RangeError(`${label}의 Core-priority ranged policy가 올바르지 않습니다.`);
    }
    return Object.freeze({
        ...common,
        targetMode: HOSTILE_ATTACK_TARGET_MODE.CORE_PRIORITY_SELECTED,
        targetSelectionPolicy: source.targetSelectionPolicy,
        targetSnapshotPolicy: source.targetSnapshotPolicy,
        distancePolicy: source.distancePolicy,
        movementPolicy: source.movementPolicy,
        attackRangeTiles: requirePositiveFloat32(
            source.attackRangeTiles,
            `${label}.attackRangeTiles`
        ),
        coreDamage: requirePositiveFloat32(source.coreDamage, `${label}.coreDamage`),
        towerTargetPolicyId: source.towerTargetPolicyId,
        coreTargetPolicyId: source.coreTargetPolicyId
    });
}

function compileAttackDefinitions(
    enemyDefinitions,
    attackDefinitions,
    projectileDefinitions
) {
    const byEnemyDefinitionId = new Map();
    for (const catalogId of Object.keys(attackDefinitions)) {
        const attack = normalizeAttackDefinition(
            attackDefinitions[catalogId],
            `attackDefinitions.${catalogId}`
        );
        if (catalogId !== attack.id) {
            throw new RangeError(`attack catalog key와 definition ID가 다릅니다: ${catalogId}`);
        }
        const enemyDefinition = enemyDefinitions[attack.sourceEnemyDefinitionId];
        if (!enemyDefinition
            || enemyDefinition.id !== attack.sourceEnemyDefinitionId
            || enemyDefinition.attackDefinitionId !== attack.id) {
            throw new RangeError(
                `attack source enemy catalog 연결이 올바르지 않습니다: ${attack.id}`
            );
        }
        const capabilityMask = createEnemyCapabilityMask(
            enemyDefinition.capabilityIds,
            `enemyDefinitions.${attack.sourceEnemyDefinitionId}.capabilityIds`
        );
        if (!hasEnemyCapability(
            capabilityMask,
            ENEMY_CAPABILITY_ID.TARGETING,
            `enemyDefinitions.${attack.sourceEnemyDefinitionId}.capabilityMask`
        )) {
            throw new RangeError(
                `attack source enemy에는 TARGETING capability가 필요합니다: ${attack.id}`
            );
        }
        const projectileDefinition = projectileDefinitions[
            attack.projectileDefinitionId
        ];
        if (!projectileDefinition
            || projectileDefinition.id !== attack.projectileDefinitionId
            || projectileDefinition.targetPolicyId !== attack.targetPolicyId
            || projectileDefinition.producerId !== attack.producerId) {
            throw new RangeError(
                `attack projectile catalog 연결이 올바르지 않습니다: ${attack.id}`
            );
        }
        if (attack.targetMode === HOSTILE_ATTACK_TARGET_MODE.CORE_PRIORITY_SELECTED
            && (projectileDefinition.coreDamage !== attack.coreDamage
                || projectileDefinition.requiresExactSelectedTarget !== true
                || projectileDefinition.towerTargetPolicyId
                    !== attack.towerTargetPolicyId
                || projectileDefinition.coreTargetPolicyId
                    !== attack.coreTargetPolicyId)) {
            throw new RangeError(
                `Core-priority projectile metadata 연결이 올바르지 않습니다: ${attack.id}`
            );
        }
        if (byEnemyDefinitionId.has(attack.sourceEnemyDefinitionId)) {
            throw new RangeError(
                `enemy definition에 attack이 중복 연결되었습니다: ${attack.sourceEnemyDefinitionId}`
            );
        }
        byEnemyDefinitionId.set(attack.sourceEnemyDefinitionId, Object.freeze({
            attack,
            projectileDefinition,
            expectedSourceMetadata: Object.freeze({
                definitionId: enemyDefinition.id,
                enemyDefinitionId: enemyDefinition.id,
                teamId: GAMEPLAY_TEAM_ID.HOSTILE,
                capabilityMask,
                physicsProfileId: requireNonEmptyString(
                    enemyDefinition.physicsProfileId,
                    `enemyDefinitions.${enemyDefinition.id}.physicsProfileId`
                ),
                combatProfileId: requireNonEmptyString(
                    enemyDefinition.combatProfileId,
                    `enemyDefinitions.${enemyDefinition.id}.combatProfileId`
                ),
                behaviorProfileId: requireNonEmptyString(
                    enemyDefinition.behaviorProfileId,
                    `enemyDefinitions.${enemyDefinition.id}.behaviorProfileId`
                )
            })
        }));
    }
    if (byEnemyDefinitionId.size === 0) {
        throw new RangeError('HostileAttackDirector에는 하나 이상의 attack definition이 필요합니다.');
    }
    return Object.freeze({
        byEnemyDefinitionId
    });
}

/** Validate data links once, before any hostile attack can enter the scheduler. */
export function compileHostileAttackCatalog(options = {}) {
    const enemyDefinitions = requireCatalog(
        options.enemyDefinitions ?? DEFAULT_HOSTILE_ENEMY_DEFINITION_BY_ID,
        'enemyDefinitions'
    );
    const attackDefinitions = requireCatalog(
        options.attackDefinitions ?? DEFAULT_HOSTILE_ATTACK_DEFINITION_BY_ID,
        'attackDefinitions'
    );
    const projectileDefinitions = requireCatalog(
        options.projectileDefinitions ?? DEFAULT_HOSTILE_PROJECTILE_DEFINITION_BY_ID,
        'projectileDefinitions'
    );
    const compiled = compileAttackDefinitions(enemyDefinitions, attackDefinitions, projectileDefinitions);
    return Object.freeze({ enemyDefinitions, byEnemyDefinitionId: compiled.byEnemyDefinitionId });
}
