import {
    THE_TOWER_COMBAT_DATA,
    THE_TOWER_DATA,
    THE_TOWER_DEFINITION_ID,
    THE_TOWER_RENDER_DATA
} from 'data/object/tower/the_tower_data.js';
import {
    GPU_CIRCLE_BODY_COLLISION_LAYER,
    GPU_CIRCLE_BODY_LIFETIME,
    GPU_CIRCLE_BODY_RENDER_SHAPE,
    decodeGpuCircleBodyFixedPoint,
    encodeGpuCircleBodyFixedPoint
} from '../../physics/gpu/gpu_circle_body_abi.js';
import {
    GAMEPLAY_ALLEGIANCE_POLICY,
    GAMEPLAY_DAMAGE_POLICY_ID,
    GAMEPLAY_DAMAGE_RESOLUTION_POLICY_ID,
    GAMEPLAY_TEAM_ID
} from '../../contract/gameplay_team_contract.js';
import { freezeTowerCreationMetadata } from './tower_group_contract.js';

export const GPU_TOWER_WORLD_KIND_ID = 'tower';
export const GPU_TOWER_DEFINITION_ID = THE_TOWER_DEFINITION_ID;

function requireFinitePosition(source, label) {
    const x = Number(source?.x);
    const y = Number(source?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new TypeError(`${label}에는 유한한 x/y가 필요합니다.`);
    }
    return Object.freeze({ x, y });
}

function requireLivingCurrentHp(value) {
    const currentHp = Number(value);
    if (!Number.isFinite(currentHp)
        || currentHp <= 0) {
        throw new RangeError('GPU Tower currentHp는 0보다 큰 유한수여야 합니다.');
    }
    encodeGpuCircleBodyFixedPoint(currentHp);
    return currentHp;
}

function requirePositiveFixedPoint(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0
        || number >= 0xffffffff) {
        throw new RangeError(`${label}은 양의 uint32 fixed-point여야 합니다.`);
    }
    return number;
}

function optionalUint32(value, fallback, label) {
    const number = Number(value ?? fallback);
    if (!Number.isSafeInteger(number) || number < 0 || number > 0xffffffff) {
        throw new RangeError(`${label}은 uint32여야 합니다.`);
    }
    return number;
}

/** TileMap의 authored Tower 위치를 persistent controlled GPU body intent로 바꿉니다. */
export function createGpuTowerSpawnIntent(options) {
    const position = requireFinitePosition(options?.position, 'GPU Tower position');
    const creationMetadata = freezeTowerCreationMetadata(
        options?.creationMetadata,
        'GPU Tower creationMetadata'
    );
    const currentHpFixedPoint = options?.currentHpFixedPoint === undefined
        ? encodeGpuCircleBodyFixedPoint(requireLivingCurrentHp(
            options?.currentHp ?? THE_TOWER_COMBAT_DATA.MAX_HEALTH
        ))
        : requirePositiveFixedPoint(
            options.currentHpFixedPoint,
            'GPU Tower currentHpFixedPoint'
        );
    const currentHp = decodeGpuCircleBodyFixedPoint(currentHpFixedPoint);
    return Object.freeze({
        kindId: GPU_TOWER_WORLD_KIND_ID,
        definitionId: GPU_TOWER_DEFINITION_ID,
        teamId: GAMEPLAY_TEAM_ID.PLAYER,
        damagePolicyId: GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX,
        damageResolutionPolicyId:
            GAMEPLAY_DAMAGE_RESOLUTION_POLICY_ID.MAXIMUM_DAMAGE_WINDOW,
        maximumDamageWindowDurationTicks:
            THE_TOWER_COMBAT_DATA.MAXIMUM_DAMAGE_WINDOW_DURATION_FIXED_TICKS,
        allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.FIXED_PLAYER,
        position,
        velocity: Object.freeze({ x: 0, y: 0 }),
        radius: THE_TOWER_DATA.RADIUS_TILES,
        inverseMass: 1 / THE_TOWER_DATA.WEIGHT,
        bodyLayer: GPU_CIRCLE_BODY_COLLISION_LAYER.KINEMATIC_OBSTACLE,
        collisionMask: GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY
            | GPU_CIRCLE_BODY_COLLISION_LAYER.KINEMATIC_OBSTACLE
            | GPU_CIRCLE_BODY_COLLISION_LAYER.ROUTE_BLOCKER
            | GPU_CIRCLE_BODY_COLLISION_LAYER.TERRAIN,
        interactionLayer: GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE,
        interactionMask: GPU_CIRCLE_BODY_COLLISION_LAYER.PROJECTILE
            | GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY,
        health: currentHp,
        healthFixedPoint: currentHpFixedPoint,
        currentHpFixedPoint,
        logicalTowerOrdinal: optionalUint32(
            options?.logicalTowerOrdinal,
            1,
            'logicalTowerOrdinal'
        ),
        shareUnits: optionalUint32(options?.shareUnits, 0, 'shareUnits'),
        maxHpFixedPoint: optionalUint32(
            options?.maxHpFixedPoint,
            encodeGpuCircleBodyFixedPoint(THE_TOWER_COMBAT_DATA.MAX_HEALTH),
            'maxHpFixedPoint'
        ),
        powerFixedPoint: optionalUint32(
            options?.powerFixedPoint,
            encodeGpuCircleBodyFixedPoint(THE_TOWER_COMBAT_DATA.BASE_POWER),
            'powerFixedPoint'
        ),
        towerGroupRevision: optionalUint32(
            options?.towerGroupRevision,
            1,
            'towerGroupRevision'
        ),
        ...(creationMetadata ? {
            abilityGeneration: creationMetadata.generation,
            abilityCreationOriginCode: creationMetadata.creationOriginCode,
            sourceAbilityCode: creationMetadata.sourceAbilityCode,
            sourceExecutionFingerprint:
                creationMetadata.sourceExecutionFingerprint,
            sourceExecutionOrdinal:
                creationMetadata.sourceExecutionOrdinal,
            visibleFromExecutionOrdinal:
                creationMetadata.visibleFromExecutionOrdinal,
            actorActionCode: creationMetadata.actorActionCode,
            actorActionProfileId:
                creationMetadata.actorActionProfileId,
            actorActionProfileFingerprint:
                creationMetadata.actorActionProfileFingerprint,
            modifierSetFingerprint:
                creationMetadata.modifierSetFingerprint,
            modifierStackCount: creationMetadata.modifierStackCount,
            copiesPerSubject: creationMetadata.copiesPerSubject,
            subjectCount: creationMetadata.subjectCount,
            destinationCount: creationMetadata.destinationCount,
            sourceSubjectRank: creationMetadata.sourceSubjectRank,
            copyIndex: creationMetadata.copyIndex,
            destinationRank: creationMetadata.destinationRank,
            destinationFingerprint:
                creationMetadata.destinationFingerprint,
            placementFingerprint: creationMetadata.placementFingerprint,
            childDescriptorFingerprint:
                creationMetadata.childDescriptorFingerprint,
            sourceRequestedFixedTick:
                creationMetadata.requestedFixedTick,
            recoveryPlacementPolicyId:
                creationMetadata.recoveryPlacementDescriptor.policyId,
            recoveryLogicalTowerOrdinal:
                creationMetadata.recoveryPlacementDescriptor
                    .logicalTowerOrdinal,
            mapRecoveryAnchorId:
                creationMetadata.recoveryPlacementDescriptor
                    .mapRecoveryAnchorId,
            mapRecoveryLatticeVersion:
                creationMetadata.recoveryPlacementDescriptor
                    .mapLatticeVersion,
            mapRecoveryAnchorX:
                creationMetadata.recoveryPlacementDescriptor
                    .anchorPosition.x,
            mapRecoveryAnchorY:
                creationMetadata.recoveryPlacementDescriptor
                    .anchorPosition.y
        } : {}),
        lifetime: GPU_CIRCLE_BODY_LIFETIME.IMMORTAL,
        alive: true,
        countAsKill: false,
        golden: false,
        explodeOnDeath: false,
        renderStyle: Object.freeze({
            color: THE_TOWER_RENDER_DATA.COLOR_RGBA,
            radiusScale: THE_TOWER_RENDER_DATA.RADIUS_SCALE,
            visible: true,
            shapeCode: GPU_CIRCLE_BODY_RENDER_SHAPE.CIRCLE
        })
    });
}
