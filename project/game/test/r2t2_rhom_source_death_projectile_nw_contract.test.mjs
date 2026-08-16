import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const gameDirectory = dirname(testDirectory);
const runnerPath = join(
    testDirectory,
    'nw_webgpu_capability',
    'enemy_rhom_source_death_projectile_runner.js'
);
const harnessPath = join(
    testDirectory,
    'support',
    'run_nw_webgpu_capability.mjs'
);

async function readUtf8(path) {
    return readFile(path, 'utf8');
}

function assertOrdered(source, fragments, label) {
    let previous = -1;
    for (const fragment of fragments) {
        const index = source.indexOf(fragment, previous + 1);
        assert.notEqual(index, -1, `${label}: missing ${fragment}`);
        assert.ok(index > previous, `${label}: ordering drift at ${fragment}`);
        previous = index;
    }
}

test('Rhom source-death dedicated NW runner preserves launch authority after only the source despawns', async () => {
    const source = await readUtf8(runnerPath);

    for (const modulePath of [
        "./production/script/module/ingame/gpu_simulation_endpoint.js",
        "./production/script/module/ingame/contract/gameplay_team_contract.js",
        "./production/script/module/ingame/contract/projectile_target_policy_contract.js",
        "./production/script/module/ingame/object/enemy/gpu_enemy_spawn_adapter.js",
        "./production/script/module/ingame/object/projectile/gpu_projectile_spawn_adapter.js",
        "./production/script/module/ingame/physics/gpu/gpu_effect_runtime_abi.js"
    ]) {
        assert.ok(source.includes(modulePath), `production runner import missing: ${modulePath}`);
    }
    assert.match(source, /const SOURCE_DEATH_TICK = 4;/);
    assert.match(source, /const WINDOW_PRIME_SPAWN_TICK = SOURCE_DEATH_TICK \+ 1;/);
    assert.match(source, /const WINDOW_PRIME_PUBLICATION_TICK = WINDOW_PRIME_SPAWN_TICK \+ 1;/);
    assert.match(source, /const WINDOW_PRIME_DAMAGE = 1;/);
    assert.match(source, /const WINDOW_PRIME_CONTACT_RADIUS = THE_TOWER_DATA\.RADIUS_TILES/);
    assert.match(source, /const WINDOW_PRIME_PREDICTED_DISTANCE = WINDOW_PRIME_START_DISTANCE/);
    assert.match(source, /const targetTowerPosition = Object\.freeze\(\{ x: 6, y: 2 \}\);/);
    assert.match(source, /const corePosition = Object\.freeze\(\{ x: 12, y: 8 \}\);/);
    assert.match(source, /coreDistance > BASIC_RHOM_ATTACK_DATA\.attackRangeTiles/);
    assert.match(source, /GPU_EFFECT_SUMMARY_FLAG\.PROJECTILE_ATTACK_SNAPSHOT/);
    assert.match(
        source,
        /GPU_EFFECT_SUMMARY_FLAG\.PROJECTILE_ATTACK_SNAPSHOT\) !== 0,\s*\n\s*`Tower-selected launch body\/snapshot mismatch:/
    );
    assert.match(source, /launchSnapshot\.resolvedBaseDamageOther - targetDamage/);
    assert.match(source, /JSON\.stringify\(afterSourceDeathSnapshot\) === JSON\.stringify\(launchSnapshot\)/);
    assert.match(source, /JSON\.stringify\(authorityAfterSourceDeath\)\s+=== JSON\.stringify\(launchAuthority\)/);
    assert.match(source, /endpoint\.requestDespawn\(\s*sourceHandle,\s*'rhom-source-death-after-resolved-spawn'/);
    assert.match(source, /endpoint\.getRegistry\(\)\.has\(sourceHandle\) === false/);
    assert.match(source, /endpoint\.hasBody\(sourceHandle\) === false/);
    assert.match(source, /endpoint\.getRegistry\(\)\.has\(projectileHandle\) === true/);
    assert.match(source, /endpoint\.hasBody\(projectileHandle\) === true/);
    assert.match(source, /createWindowPrimeEntryGeometry\(\s*targetAfterSourceDeath\.position/);
    assert.match(source, /createWindowPrimeProjectileIntent\(windowPrimeEntryGeometry\)/);
    assert.match(source, /windowPrimeEntryGeometry\.previousDistance\s+> windowPrimeEntryGeometry\.contactRadius/);
    assert.match(source, /windowPrimeEntryGeometry\.predictedDistance\s+< windowPrimeEntryGeometry\.contactRadius/);
    assert.match(source, /windowPrimeDamageEvent\.maximumDamageWindow === true/);
    assert.match(source, /windowPrimeState\.peakFinalDamageFixedPoint/);
    assert.match(source, /projectileTowerHit\.sourceTick\s+< windowPrimeState\.expiresAtFixedTick/);
    assert.match(source, /THE_TOWER_COMBAT_DATA\.MAX_HEALTH - targetDamage/);
    assert.match(source, /projectileTowerHit\.damageFixedPoint\s+=== expectedWindowDeltaFixedPoint/);
    assert.match(source, /projectileTowerHit\.maximumDamageWindow === true/);
    assert.match(source, /unwantedDamageEvents\.length === 0/);
    assert.match(source, /cleanupCommit\.despawned\.length === 1/);
    assert.match(source, /cleanupCommit\.despawned\[0\]\.reason === 'gpu-death'/);
    assert.match(source, /!containsBody\(postCleanupBodies, projectileHandle\)/);
    assert.match(source, /storageMaximum === REQUIRED_STORAGE_BUFFER_LIMIT/);
    assert.match(source, /uncapturedErrors\.length === 0/);
    assert.match(source, /lost\.reason === 'destroyed'/);
    assert.equal(
        (source.match(/endpoint\.commitCompletedEventsAtFixedBoundary\(/g) ?? [])
            .length,
        1,
        'generic event publication must be reachable only through the local capture/release wrapper'
    );
    assert.equal(
        (source.match(/commitCompletedEndpointEventsAtFixedBoundary\(/g) ?? [])
            .length,
        8,
        'each submitted source tick and terminal cleanup must use the publication wrapper'
    );
    assertOrdered(source, [
        'async function commitCompletedEndpointEventsAtFixedBoundary(',
        'commitCompletedProjectileCaptureProgramsAtFixedBoundary(',
        'commitCompletedProjectileCaptureReleaseProgramsAtFixedBoundary(',
        'endpoint.commitCompletedEventsAtFixedBoundary('
    ], 'capture → release → generic event publication order');

    assertOrdered(source, [
        'const initialPublication = await commitCompletedEndpointEventsAtFixedBoundary(',
        'const launchCommit = endpoint.commitAtFixedBoundary(2);',
        'const launchPublication = await commitCompletedEndpointEventsAtFixedBoundary(',
        'const selectionCompletion = endpoint.commitAtFixedBoundary(3);',
        'const launchAuthority = copyProjectileAuthority(',
        'const resolvedLaunchPublication',
        'const sourceDespawnRequest = endpoint.requestDespawn(',
        'const sourceDespawnCommit = endpoint.commitAtFixedBoundary(SOURCE_DEATH_TICK);',
        'const projectileAfterSourceDeath = findBody(',
        'const sourceDeathPublication',
        'const windowPrimeRequest = endpoint.requestSpawn(',
        'const windowPrimeCommit = endpoint.commitAtFixedBoundary(',
        'const windowPrimePublication',
        'const windowPrimeCleanupCommit = endpoint.commitAtFixedBoundary(',
        'const completedPublication',
        'const projectileTowerHit = completed.contactEvents.find((event) => (',
        'cleanupCommit = endpoint.commitAtFixedBoundary(tick);',
        'const postCleanupPublication'
    ], 'resolved launch → only source death → Tower impact → terminal cleanup');

    assertOrdered(source, [
        'await settleEndpoint(endpoint, \'Rhom Tower selected launch\', {',
        'const launchSnapshot = await readProjectileEffectSummary(',
        'const launchPublication = await commitCompletedEndpointEventsAtFixedBoundary(',
        'const selectionCompletion = endpoint.commitAtFixedBoundary(3);',
        'const launchAuthority = copyProjectileAuthority('
    ], 'GPU launch readback → T+1 completion publication → registry authority');
});

test('Rhom source-death stage is fail-closed and wired to only its dedicated runner', async () => {
    const source = await readUtf8(harnessPath);
    const stage = 'enemy-rhom-source-death-projectile';
    const runner = 'enemy_rhom_source_death_projectile_runner.js';

    assert.match(source, new RegExp(
        `fixtureStage === '${stage}'[\\s\\S]*?productionEnemyRhomSourceDeathProjectile`
    ));
    assert.match(source, new RegExp(
        `fixtureStage === '${stage}'[\\s\\S]*?'${runner}'`
    ));
    assert.match(source, new RegExp(
        `fs\\.access\\(path\\.join\\([\\s\\S]*?'${runner}'`
    ));
    assert.match(source, /fixture\?\.scenario\s+=== 'rhom-tower-selected-direct-projectile-survives-source-death'/);
    assert.match(source, /launch\.snapshot\.resolvedBaseDamageOther === 5/);
    assert.match(source, /launch\.snapshot\.sourceSnapshotTick === 2/);
    assert.match(source, /sourceDeath\.sourceRegistryPresent === false/);
    assert.match(source, /sourceDeath\.projectileRegistryPresent === true/);
    assert.match(source, /JSON\.stringify\(sourceDeath\.snapshot\) === JSON\.stringify\(launch\.snapshot\)/);
    assert.match(source, /windowPrime\?\.spawnTick === 5/);
    assert.match(source, /windowPrimeEntry\.previousDistance > windowPrimeEntry\.contactRadius/);
    assert.match(source, /windowPrimeEntry\.predictedDistance < windowPrimeEntry\.contactRadius/);
    assert.match(source, /windowPrime\.targetHpAfter === 29/);
    assert.match(source, /windowPrime\.maximumDamageWindow === true/);
    assert.match(source, /windowPrime\.peakFinalDamageFixedPoint === 100/);
    assert.match(source, /impact\?\.targetHpBefore === 29/);
    assert.match(source, /impact\.targetHpAfter === 25/);
    assert.match(source, /impact\.wrongTowerHpAfter === 30/);
    assert.match(source, /impact\.noSourceRevalidation === true/);
    assert.match(source, /impact\.appliedDamageFixedPoint === 400/);
    assert.match(source, /impact\.maximumDamageWindow === true/);
    assert.match(source, /impact\.directDiscreteDamage === false/);
    assert.match(source, /impact\.commonMaximumDamageWindow === true/);
    assert.match(source, /impact\.windowActiveBeforeImpact === true/);
    assert.match(source, /impact\.windowStatePreserved === false/);
    assert.match(source, /impact\.windowStateReset === true/);
    assert.match(source, /cleanup\.noRevive === true/);
    assert.match(source, /runtime\.storageMaximum === 9/);
    assert.match(source, /runtime\.uncapturedErrorCount === 0/);
    assert.match(source, /result\.deviceLostReason === 'destroyed'/);

    const stageMentions = source.match(
        /enemy-rhom-source-death-projectile/g
    ) ?? [];
    assert.equal(stageMentions.length, 3,
        'stage must appear only in validator, allowlist, and runner selection');
});

test('Rhom source-death runner stays inside the NW harness production fixture boundary', async () => {
    const source = await readUtf8(runnerPath);
    const normalizedGameDirectory = gameDirectory.replaceAll('\\', '/');

    assert.equal(source.includes('../'), false,
        'dedicated runner must not escape the copied harness production tree');
    assert.equal(source.includes('gpu_collision_shaders'), false,
        'dedicated runner must not mutate or depend on Arrow-owned collision shader internals');
    assert.equal(source.includes('run_nw_webgpu_capability'), false,
        'dedicated runner must not recursively invoke the shared harness');
    assert.ok(normalizedGameDirectory.endsWith('/project/game'));
});
