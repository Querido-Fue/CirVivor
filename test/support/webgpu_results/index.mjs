import { validateR9OvertimePressure, validateR9MultiWave } from './wave_results.mjs';
import { validateTowerGroupTargetQuery, validateR6TowerMerge } from './tower_results.mjs';
import { validateR5ActorVerbs, validateR7ActorPayloadMultiplicity, validatePostR5LiveBugfix, validateActorActionPlacement } from './actor_action_results.mjs';
import { validateEnemyArrowCharge, validateMaximumDamageWindow, validateEnemyRhomPriority, validateEnemyRhomSourceDeathProjectile } from './hostile_attack_results.mjs';
import { validateEnemyPentagonEffect } from './pentagon_results.mjs';
import { validateEnemyHexaFormation } from './hexa_results.mjs';
import { validateEnemyJorangSplitLineage } from './jorang_results.mjs';
import { validateEnemyOctagonDirectionalDefense } from './octagon_results.mjs';
import { validateEnemyRingProjectileCapture } from './ring_results.mjs';
import { validateEnemyCorkRouteClosure } from './cork_results.mjs';

const validators = new Map([
    ['r9-overtime-pressure', validateR9OvertimePressure],
    ['r9-multi-wave', validateR9MultiWave],
    ['tower-group-target-query', validateTowerGroupTargetQuery],
    ['r5-actor-verbs', validateR5ActorVerbs],
    ['r7-actor-payload-multiplicity', validateR7ActorPayloadMultiplicity],
    ['post-r5-live-bugfix', validatePostR5LiveBugfix],
    ['actor-action-placement', validateActorActionPlacement],
    ['enemy-arrow-charge', validateEnemyArrowCharge],
    ['maximum-damage-window', validateMaximumDamageWindow],
    ['enemy-rhom-priority', validateEnemyRhomPriority],
    ['enemy-rhom-source-death-projectile', validateEnemyRhomSourceDeathProjectile],
    ['enemy-pentagon-effect', validateEnemyPentagonEffect],
    ['enemy-hexa-formation', validateEnemyHexaFormation],
    ['enemy-jorang-split-lineage', validateEnemyJorangSplitLineage],
    ['enemy-octagon-directional-defense', validateEnemyOctagonDirectionalDefense],
    ['enemy-ring-projectile-capture', validateEnemyRingProjectileCapture],
    ['r6-tower-merge', validateR6TowerMerge],
    ['enemy-cork-route-closure', validateEnemyCorkRouteClosure]
]);

export function assertDedicatedFixtureResult(result, fixtureStage) {
    const { fixture, scenarioValid } = validators.get(fixtureStage)?.(result)
        ?? { fixture: null, scenarioValid: true };
    const fixtureExists = fixture !== null
        && typeof fixture === 'object'
        && !Array.isArray(fixture);
    const valid = result?.status === 'pass'
        && fixtureExists
        && scenarioValid
        && result.uncapturedErrorCount === 0
        && result.deviceLostReason === 'destroyed';
    if (!valid) {
        throw new Error(
            `NW ${fixtureStage} 결과 계약 실패: ${JSON.stringify({
                fixture,
                fixtureExists,
                scenarioValid,
                status: result?.status,
                uncapturedErrorCount: result?.uncapturedErrorCount,
                deviceLostReason: result?.deviceLostReason
            })}`
        );
    }
}
