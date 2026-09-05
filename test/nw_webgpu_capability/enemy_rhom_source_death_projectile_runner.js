import {
    BASIC_RHOM_ENEMY_DATA
} from './production/script/data/object/enemy/basic_circle_enemy_data.js';
import {
    BASIC_RHOM_ATTACK_DATA
} from './production/script/data/object/enemy/basic_rhom_attack_data.js';
import {
    HOSTILE_RHOM_PROJECTILE_DATA
} from './production/script/data/object/projectile/hostile_rhom_projectile_data.js';
import {
    THE_TOWER_COMBAT_DATA,
    THE_TOWER_DATA
} from './production/script/data/object/tower/the_tower_data.js';
import {
    createGpuProjectileSpawnIntent,
    createGpuSimulationEndpoint
} from './production/script/module/ingame/gpu_simulation_endpoint.js';
import {
    GAMEPLAY_ALLEGIANCE_POLICY,
    GAMEPLAY_DAMAGE_POLICY_ID,
    GAMEPLAY_TEAM_ID
} from './production/script/module/ingame/contract/gameplay_team_contract.js';
import {
    PROJECTILE_TARGET_POLICY_ID
} from './production/script/module/ingame/contract/projectile_target_policy_contract.js';
import {
    createGpuEnemySpawnIntent
} from './production/script/module/ingame/object/enemy/gpu_enemy_spawn_adapter.js';
import {
    createGpuSelectedTargetProjectileIntent
} from './production/script/module/ingame/object/projectile/gpu_projectile_spawn_adapter.js';
import {
    createGpuCoreProxySpawnIntent
} from './production/script/module/ingame/object/core/gpu_core_proxy_spawn_adapter.js';
import {
    createGpuTowerSpawnIntent
} from './production/script/module/ingame/object/tower/gpu_tower_spawn_adapter.js';
import {
    GPU_EFFECT_RUNTIME_ABI,
    GPU_EFFECT_SUMMARY_FLAG
} from './production/script/module/ingame/physics/gpu/gpu_effect_runtime_abi.js';

const resultPath = process.env.CIRVIVOR_WEBGPU_RESULT_PATH;
const REQUIRED_STORAGE_BUFFER_LIMIT = 9;
const FIXED_DELTA = 1 / 60;
const SOURCE_DEATH_TICK = 4;
const WINDOW_PRIME_SPAWN_TICK = SOURCE_DEATH_TICK + 1;
const WINDOW_PRIME_PUBLICATION_TICK = WINDOW_PRIME_SPAWN_TICK + 1;
const FIRST_PROJECTILE_TICK = WINDOW_PRIME_PUBLICATION_TICK + 1;
const LAST_PROJECTILE_TICK = 48;
const WINDOW_PRIME_DAMAGE = 1;
const WINDOW_PRIME_PROJECTILE_DATA = Object.freeze({
    id: 'nw-rhom-maximum-window-prime-projectile',
    collisionRadius: HOSTILE_RHOM_PROJECTILE_DATA.collisionRadius,
    inverseMass: 1,
    penetration: 1,
    damage: WINDOW_PRIME_DAMAGE,
    damageSelf: 1,
    lifetimeSeconds: 1,
    killOnTerrain: false,
    closestOnly: true,
    visible: false
});
const WINDOW_PRIME_PRODUCER_ID = 'nw-rhom-maximum-window-prime';
const WINDOW_PRIME_SOURCE_ABILITY_ID = 'fixture.rhom.maximum-window-prime';
const WINDOW_PRIME_ENTRY_MARGIN = 0.07;
const WINDOW_PRIME_SPEED = 12;
const WINDOW_PRIME_CONTACT_RADIUS = THE_TOWER_DATA.RADIUS_TILES
    + WINDOW_PRIME_PROJECTILE_DATA.collisionRadius;
const WINDOW_PRIME_START_DISTANCE = WINDOW_PRIME_CONTACT_RADIUS
    + WINDOW_PRIME_ENTRY_MARGIN;
const WINDOW_PRIME_PREDICTED_DISTANCE = WINDOW_PRIME_START_DISTANCE
    - (WINDOW_PRIME_SPEED * FIXED_DELTA);

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function assertNear(actual, expected, epsilon, label) {
    assert(
        Math.abs(actual - expected) <= epsilon,
        `${label}: expected=${expected}, actual=${actual}`
    );
}

function exactHandle(left, right) {
    return left?.entityId === right?.entityId
        && left?.incarnation === right?.incarnation;
}

function copyHandle(handle) {
    return Object.freeze({
        entityId: handle.entityId,
        incarnation: handle.incarnation
    });
}

function createPlatformPort(device) {
    const format = navigator.gpu.getPreferredCanvasFormat();
    return Object.freeze({
        getState: () => Object.freeze({ ready: true, status: 'ready' }),
        getDevice: () => device,
        getCanvasFormat: () => format,
        getDeviceGeneration: () => 1,
        acquireFrameTarget: () => null,
        clearCanvas: () => false,
        markCanvasDrawn: () => false,
        markCanvasCleared: () => false
    });
}

function createOpenNavigationSource() {
    const columns = 16;
    const rows = 16;
    const blocked = new Uint8Array(columns * rows);
    const entryPosition = Object.freeze({ x: 2, y: 8, row: 8, column: 2 });
    const corePosition = Object.freeze({ x: 12, y: 8, row: 8, column: 12 });
    const route = Object.freeze({
        gateId: 'nw-rhom-source-death-gate',
        pathId: 'nw-rhom-source-death-route',
        waypoints: Object.freeze([entryPosition, corePosition])
    });
    return Object.freeze({
        corePosition,
        route,
        getNavigationGrid: () => Object.freeze({
            cols: columns,
            rows,
            size: columns * rows,
            cellSize: 1,
            sdfSubdivisions: 8,
            blocked
        }),
        getSpawnRoutes: () => Object.freeze([route]),
        getWorldBounds: () => Object.freeze({
            minX: 0,
            minY: 0,
            maxX: columns,
            maxY: rows,
            width: columns,
            height: rows
        })
    });
}

async function settleEndpoint(endpoint, label, options = {}) {
    const simulation = endpoint.getBackend().simulation;
    assert(simulation, `${label}: production simulation missing`);
    await simulation.device.queue.onSubmittedWorkDone();
    const deadline = performance.now() + 5_000;
    while (performance.now() < deadline) {
        const status = simulation.getStatus();
        const settled = status.overflow.pendingReadbacks === 0
            && status.events.pendingReadbacks === 0
            && (!options.spawnProgram
                || status.fixedPrimitives.spawnProgram.pendingReadbacks === 0);
        if (settled) return status;
        await new Promise((resolve) => setTimeout(resolve, 4));
    }
    throw new Error(`${label}: GPU readback timeout ${JSON.stringify(
        simulation.getStatus()
    )}`);
}

/**
 * 실제 GameObjectSystem과 같은 T publication 순서를 좁은 fixture 경계에서
 * 재현한다. ProjectileCapture completion/release watermark가 generic event보다
 * 먼저 확정되어야 selected spawn metadata와 contact event가 같은 epoch를 본다.
 */
async function commitCompletedEndpointEventsAtFixedBoundary(
    endpoint,
    targetFixedTick,
    label
) {
    const deadline = performance.now() + 5_000;
    let lastCapture = null;
    let lastRelease = null;
    while (performance.now() < deadline) {
        const capture = endpoint
            .commitCompletedProjectileCaptureProgramsAtFixedBoundary(
                targetFixedTick
            );
        lastCapture = capture;
        if (capture.pending === true) {
            await new Promise((resolve) => setTimeout(resolve, 4));
            continue;
        }
        assert(capture.protocolFailure === null
            && capture.sourceTick === targetFixedTick - 1
            && capture.completedThroughTick === targetFixedTick - 1,
        `${label}: capture completion publication mismatch: ${JSON.stringify(
            capture
        )}`);
        const release = endpoint
            .commitCompletedProjectileCaptureReleaseProgramsAtFixedBoundary(
                targetFixedTick
            );
        lastRelease = release;
        if (release.pending === true) {
            await new Promise((resolve) => setTimeout(resolve, 4));
            continue;
        }
        assert(release.protocolFailure === null,
            `${label}: capture release publication mismatch: ${JSON.stringify(
                release
            )}`);
        const events = endpoint.commitCompletedEventsAtFixedBoundary(
            targetFixedTick
        );
        assert(events.protocolFailure === null
            && events.sourceTick === targetFixedTick - 1
            && events.completedThroughTick === targetFixedTick - 1,
        `${label}: generic event publication mismatch: ${JSON.stringify(events)}`);
        return Object.freeze({ capture, release, events });
    }
    throw new Error(`${label}: capture publication timeout ${JSON.stringify({
        targetFixedTick,
        lastCapture,
        lastRelease,
        runtime: endpoint.getProjectileCaptureRuntimeStatus()
    })}`);
}

async function readBodies(endpoint, label) {
    const simulation = endpoint.getBackend().simulation;
    assert(simulation && typeof simulation.readbackBodies === 'function',
        `${label}: body readback boundary missing`);
    const bodies = simulation.readbackBodies();
    await simulation.device.queue.onSubmittedWorkDone();
    return bodies;
}

function findBody(bodies, handle, label) {
    const body = bodies.find((candidate) => exactHandle(candidate.handle, handle));
    assert(body, `${label}: body missing ${JSON.stringify(handle)}`);
    return body;
}

function containsBody(bodies, handle) {
    return bodies.some((candidate) => exactHandle(candidate.handle, handle));
}

async function readProjectileEffectSummary(endpoint, body, label) {
    const simulation = endpoint.getBackend().simulation;
    const abi = GPU_EFFECT_RUNTIME_ABI.SUMMARY;
    const readback = simulation.device.createBuffer({
        label: `cirvivor-nw-rhom-source-death-summary-${label}`,
        size: abi.STRIDE,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    try {
        const encoder = simulation.device.createCommandEncoder({
            label: `cirvivor-nw-rhom-source-death-summary-copy-${label}`
        });
        encoder.copyBufferToBuffer(
            simulation.buffers.effectSummaries,
            body.index * abi.STRIDE,
            readback,
            0,
            abi.STRIDE
        );
        simulation.device.queue.submit([encoder.finish()]);
        await readback.mapAsync(GPUMapMode.READ);
        const view = new DataView(readback.getMappedRange());
        return Object.freeze({
            entityId: view.getUint32(abi.ENTITY_ID, true),
            incarnation: view.getUint32(abi.INCARNATION, true),
            resolvedBaseDamageOther: view.getFloat32(
                abi.RESOLVED_BASE_DAMAGE_OTHER,
                true
            ),
            attackMultiplier: view.getFloat32(abi.ATTACK_MULTIPLIER, true),
            sourceSnapshotTick: view.getUint32(
                abi.SOURCE_SNAPSHOT_TICK,
                true
            ),
            flags: view.getUint32(abi.FLAGS, true)
        });
    } finally {
        try {
            readback.unmap();
        } catch {
            // already unmapped
        }
        readback.destroy();
    }
}

function copyProjectileAuthority(endpoint, projectileHandle, label) {
    const view = endpoint.getRegistry().copyEntityView(projectileHandle, {});
    assert(view?.metadata, `${label}: projectile registry metadata missing`);
    const metadata = view.metadata;
    return Object.freeze({
        sourceEntityId: metadata.sourceEntityId,
        sourceIncarnation: metadata.sourceIncarnation,
        selectedTargetKind: metadata.selectedTargetKind,
        selectedTargetEntityId: metadata.selectedTargetEntityId,
        selectedTargetIncarnation: metadata.selectedTargetIncarnation,
        selectedTargetPolicyId: metadata.selectedTargetPolicyId,
        selectionSourceTick: metadata.selectionSourceTick,
        selectionSequence: metadata.selectionSequence,
        attackFingerprint: metadata.attackFingerprint,
        producerId: metadata.producerId,
        sourceAbilityId: metadata.sourceAbilityId
    });
}

function createRhomIntent(navigationSource, position) {
    return Object.freeze({
        ...createGpuEnemySpawnIntent({
            definition: BASIC_RHOM_ENEMY_DATA,
            route: navigationSource.route,
            spawnSequence: 0,
            waveId: 'nw-rhom-source-death-projectile',
            policyId: 'hardware-fixture'
        }),
        position: Object.freeze({ ...position })
    });
}

function createPriorityControl(sourceHandle, coreHandle, towerHandle) {
    return Object.freeze({
        sourceHandle,
        coreTargetHandle: coreHandle,
        towerTargetHandle: towerHandle,
        attackRangeTiles: BASIC_RHOM_ATTACK_DATA.attackRangeTiles,
        targetSelectionPolicyId: BASIC_RHOM_ATTACK_DATA.targetSelectionPolicy,
        distancePolicyId: BASIC_RHOM_ATTACK_DATA.distancePolicy,
        stopWhileTargetInRange: true,
        selectionSequence: 1,
        attackDefinitionId: BASIC_RHOM_ATTACK_DATA.id,
        projectileDefinitionId: HOSTILE_RHOM_PROJECTILE_DATA.id,
        producerId: BASIC_RHOM_ATTACK_DATA.producerId,
        sourceAbilityId: BASIC_RHOM_ATTACK_DATA.sourceAbilityId
    });
}

function createSelectedProjectileIntent(sourceHandle, coreHandle, towerHandle) {
    return createGpuSelectedTargetProjectileIntent({
        definition: HOSTILE_RHOM_PROJECTILE_DATA,
        sourceHandle,
        ownerHandle: sourceHandle,
        coreTargetHandle: coreHandle,
        towerTargetHandle: towerHandle,
        positionOffset: BASIC_RHOM_ATTACK_DATA.positionOffset,
        targetOffset: BASIC_RHOM_ATTACK_DATA.targetOffset,
        launchSpeed: BASIC_RHOM_ATTACK_DATA.launchSpeed,
        attackRangeTiles: BASIC_RHOM_ATTACK_DATA.attackRangeTiles,
        targetSelectionPolicyId: BASIC_RHOM_ATTACK_DATA.targetSelectionPolicy,
        distancePolicyId: BASIC_RHOM_ATTACK_DATA.distancePolicy,
        stopWhileTargetInRange: true,
        targetPolicyId: BASIC_RHOM_ATTACK_DATA.targetPolicyId,
        allegiancePolicy: BASIC_RHOM_ATTACK_DATA.allegiancePolicy,
        producerId: BASIC_RHOM_ATTACK_DATA.producerId,
        sourceAbilityId: BASIC_RHOM_ATTACK_DATA.sourceAbilityId,
        spawnSequence: 1
    });
}

function createWindowPrimeEntryGeometry(targetPosition) {
    const startPosition = Object.freeze({
        x: targetPosition.x - WINDOW_PRIME_START_DISTANCE,
        y: targetPosition.y
    });
    const velocity = Object.freeze({ x: WINDOW_PRIME_SPEED, y: 0 });
    return Object.freeze({
        targetPosition: Object.freeze({ ...targetPosition }),
        startPosition,
        velocity,
        contactRadius: WINDOW_PRIME_CONTACT_RADIUS,
        previousDistance: WINDOW_PRIME_START_DISTANCE,
        predictedDistance: WINDOW_PRIME_PREDICTED_DISTANCE
    });
}

function createWindowPrimeProjectileIntent(entryGeometry) {
    return createGpuProjectileSpawnIntent({
        definition: WINDOW_PRIME_PROJECTILE_DATA,
        position: entryGeometry.startPosition,
        velocity: entryGeometry.velocity,
        producerId: WINDOW_PRIME_PRODUCER_ID,
        sourceAbilityId: WINDOW_PRIME_SOURCE_ABILITY_ID,
        teamId: GAMEPLAY_TEAM_ID.HOSTILE,
        allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.EXPLICIT_OVERRIDE,
        damagePolicyId: GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX,
        targetPolicyId: PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN,
        spawnSequence: 0
    });
}

function isExactContact(event, sourceHandle, targetHandle) {
    return event?.entityId === sourceHandle.entityId
        && event?.incarnation === sourceHandle.incarnation
        && event?.otherEntityId === targetHandle.entityId
        && event?.otherIncarnation === targetHandle.incarnation;
}

async function runRhomSourceDeathProjectileFixture(device) {
    const navigationSource = createOpenNavigationSource();
    const endpoint = createGpuSimulationEndpoint({
        webGpuPlatformPort: createPlatformPort(device)
    }, {
        capacity: 5,
        controlCommandCapacity: 1,
        sourceRelativeSpawnCommandCapacity: 1,
        spawnProgramCapacity: 1,
        completedEventSnapshotCapacity: 16,
        eventCapacity: 16
    });
    const sourcePosition = Object.freeze({ x: 3, y: 2 });
    const targetTowerPosition = Object.freeze({ x: 6, y: 2 });
    const wrongTowerPosition = Object.freeze({ x: 6, y: 4 });
    const corePosition = Object.freeze({ x: 12, y: 8 });
    const coreDistance = Math.hypot(
        corePosition.x - sourcePosition.x,
        corePosition.y - sourcePosition.y
    );
    const targetDamage = HOSTILE_RHOM_PROJECTILE_DATA.damage;
    const targetDamageFixedPoint = Math.round(targetDamage * 100);
    const windowPrimeDamageFixedPoint = Math.round(WINDOW_PRIME_DAMAGE * 100);
    const expectedWindowDelta = targetDamage - WINDOW_PRIME_DAMAGE;
    const expectedWindowDeltaFixedPoint = Math.round(expectedWindowDelta * 100);
    let sourceHandle = null;
    let coreHandle = null;
    let targetTowerHandle = null;
    let wrongTowerHandle = null;
    let projectileHandle = null;
    try {
        assert(endpoint.init(navigationSource) === false,
            'Rhom source-death endpoint must defer before initial spawn');
        assert(coreDistance > BASIC_RHOM_ATTACK_DATA.attackRangeTiles,
            `Core must be outside Rhom range: ${coreDistance}`);

        const initialRequests = [
            endpoint.requestSpawn(
                createGpuCoreProxySpawnIntent({ position: corePosition }),
                1,
                'rhom-source-death:core'
            ),
            endpoint.requestSpawn(
                createGpuTowerSpawnIntent({ position: targetTowerPosition }),
                1,
                'rhom-source-death:tower-target'
            ),
            endpoint.requestSpawn(
                createGpuTowerSpawnIntent({ position: wrongTowerPosition }),
                1,
                'rhom-source-death:tower-wrong'
            ),
            endpoint.requestSpawn(
                createRhomIntent(navigationSource, sourcePosition),
                1,
                'rhom-source-death:source'
            )
        ];
        assert(initialRequests.every(({ accepted }) => accepted),
            `initial spawn ingress rejected: ${JSON.stringify(initialRequests)}`);
        const initialCommit = endpoint.commitAtFixedBoundary(1);
        assert(initialCommit.spawned.length === 4
            && initialCommit.rejected.length === 0
            && !initialCommit.recoveryRequired,
        `initial spawn commit mismatch: ${JSON.stringify(initialCommit)}`);
        const initialHandles = new Map(initialCommit.spawned.map(
            ({ commandId, handle }) => [commandId, handle]
        ));
        coreHandle = initialHandles.get('rhom-source-death:core');
        targetTowerHandle = initialHandles.get('rhom-source-death:tower-target');
        wrongTowerHandle = initialHandles.get('rhom-source-death:tower-wrong');
        sourceHandle = initialHandles.get('rhom-source-death:source');
        assert(coreHandle && targetTowerHandle && wrongTowerHandle && sourceHandle,
            `initial exact handles missing: ${JSON.stringify(initialCommit.spawned)}`);
        assert(endpoint.fixedUpdate(FIXED_DELTA, 1),
            'initial fixed submit failed');
        await settleEndpoint(endpoint, 'Rhom source-death initial tick');
        const initialBodies = await readBodies(endpoint, 'Rhom source-death initial');
        const initialTargetTower = findBody(
            initialBodies,
            targetTowerHandle,
            'initial selected Tower'
        );
        const initialWrongTower = findBody(
            initialBodies,
            wrongTowerHandle,
            'initial wrong Tower'
        );
        const initialCore = findBody(initialBodies, coreHandle, 'initial Core');
        assertNear(
            initialTargetTower.health,
            THE_TOWER_COMBAT_DATA.MAX_HEALTH,
            0.000001,
            'initial target Tower HP'
        );
        assertNear(
            initialWrongTower.health,
            THE_TOWER_COMBAT_DATA.MAX_HEALTH,
            0.000001,
            'initial wrong Tower HP'
        );
        const initialPublication = await commitCompletedEndpointEventsAtFixedBoundary(
            endpoint,
            2,
            'Rhom source-death initial publication'
        );
        assert(initialPublication.events.contactEvents.length === 0
            && initialPublication.events.deathEvents.length === 0,
        `initial publication unexpectedly mutated lifecycle: ${JSON.stringify(
            initialPublication
        )}`);

        const controlReceipt = endpoint.requestPriorityTargetControl(
            createPriorityControl(sourceHandle, coreHandle, targetTowerHandle),
            2,
            'rhom-source-death:priority-control'
        );
        const selectedSpawnReceipt = endpoint.requestSelectedTargetSpawn(
            createSelectedProjectileIntent(
                sourceHandle,
                coreHandle,
                targetTowerHandle
            ),
            2,
            'rhom-source-death:selected-spawn'
        );
        assert(controlReceipt.accepted === true
            && Number.isSafeInteger(controlReceipt.attackFingerprint)
            && controlReceipt.attackFingerprint > 0
            && selectedSpawnReceipt.accepted === true,
        `Tower selected launch ingress mismatch: ${JSON.stringify({
            controlReceipt,
            selectedSpawnReceipt
        })}`);
        const launchCommit = endpoint.commitAtFixedBoundary(2);
        assert(launchCommit.fixedCommands.controls.length === 1
            && launchCommit.fixedCommands.selectedTargetSpawns.length === 1
            && launchCommit.fixedCommands.rejected.length === 0
            && !launchCommit.recoveryRequired,
        `Tower selected launch commit mismatch: ${JSON.stringify(launchCommit)}`);
        projectileHandle = launchCommit.fixedCommands.selectedTargetSpawns[0].handle;
        assert(projectileHandle, 'selected Tower projectile handle missing');
        assert(endpoint.fixedUpdate(FIXED_DELTA, 2),
            'Tower selected launch fixed submit failed');
        await settleEndpoint(endpoint, 'Rhom Tower selected launch', {
            spawnProgram: true
        });
        const launchBodies = await readBodies(endpoint, 'Rhom Tower selected launch');
        const launchProjectile = findBody(
            launchBodies,
            projectileHandle,
            'Tower selected projectile'
        );
        const launchTargetTower = findBody(
            launchBodies,
            targetTowerHandle,
            'Tower selected target after launch'
        );
        const launchWrongTower = findBody(
            launchBodies,
            wrongTowerHandle,
            'wrong Tower after launch'
        );
        const launchCore = findBody(launchBodies, coreHandle, 'Core after launch');
        const launchSnapshot = await readProjectileEffectSummary(
            endpoint,
            launchProjectile,
            'launch'
        );
        assert(launchProjectile.health === HOSTILE_RHOM_PROJECTILE_DATA.penetration
            && launchProjectile.enemyBehaviorState?.targetEntityId
                === targetTowerHandle.entityId
            && launchProjectile.enemyBehaviorState?.targetIncarnation
                === targetTowerHandle.incarnation
            && launchProjectile.enemyBehaviorState?.selectionSequence === 1
            && launchProjectile.enemyBehaviorState?.attackFingerprint
                === controlReceipt.attackFingerprint
            && launchSnapshot.entityId === projectileHandle.entityId
            && launchSnapshot.incarnation === projectileHandle.incarnation
            && Math.abs(launchSnapshot.resolvedBaseDamageOther - targetDamage)
                <= 0.000001
            && launchSnapshot.sourceSnapshotTick === 2
            && (launchSnapshot.flags
                & GPU_EFFECT_SUMMARY_FLAG.PROJECTILE_ATTACK_SNAPSHOT) !== 0,
        `Tower-selected launch body/snapshot mismatch: ${JSON.stringify({
            launchProjectile,
            launchSnapshot,
            controlReceipt
        })}`);
        assertNear(launchTargetTower.health, THE_TOWER_COMBAT_DATA.MAX_HEALTH,
            0.000001, 'launch target Tower HP');
        assertNear(launchWrongTower.health, THE_TOWER_COMBAT_DATA.MAX_HEALTH,
            0.000001, 'launch wrong Tower HP');

        const launchPublication = await commitCompletedEndpointEventsAtFixedBoundary(
            endpoint,
            3,
            'Rhom Tower selected launch publication'
        );
        const launchEvents = launchPublication.events;
        assert(launchEvents.contactEvents.length === 0
            && launchEvents.deathEvents.length === 0,
        `launch publication emitted premature events: ${JSON.stringify(
            launchPublication
        )}`);
        const selectionCompletion = endpoint.commitAtFixedBoundary(3);
        const selectionResult = selectionCompletion.fixedCommands
            .priorityTargetControlResults.find(({ commandId }) => (
                commandId === 'rhom-source-death:priority-control'
            ));
        assert(selectionResult?.outcome === 'tower'
            && selectionResult.selectedTargetHandle?.entityId
                === targetTowerHandle.entityId
            && selectionResult.selectedTargetHandle?.incarnation
                === targetTowerHandle.incarnation
            && selectionResult.attackFingerprint === controlReceipt.attackFingerprint
            && !selectionCompletion.recoveryRequired,
        `Tower selected control completion mismatch: ${JSON.stringify({
            selectionResult,
            selectionCompletion
        })}`);
        // selected-target projectile은 GPU completion을 T+1 fixed boundary에서
        // registry active metadata로 publish한다. T2 body/snapshot readback은
        // valid하지만 registry authority는 이 canonical publication 뒤에만 읽는다.
        const launchAuthority = copyProjectileAuthority(
            endpoint,
            projectileHandle,
            'launch publication'
        );
        assert(launchAuthority.sourceEntityId === sourceHandle.entityId
            && launchAuthority.sourceIncarnation === sourceHandle.incarnation
            && launchAuthority.selectedTargetKind === 'tower'
            && launchAuthority.selectedTargetEntityId === targetTowerHandle.entityId
            && launchAuthority.selectedTargetIncarnation
                === targetTowerHandle.incarnation
            && launchAuthority.selectionSourceTick === 2
            && launchAuthority.selectionSequence === 1
            && launchAuthority.attackFingerprint === controlReceipt.attackFingerprint
            && launchAuthority.producerId === BASIC_RHOM_ATTACK_DATA.producerId
            && launchAuthority.sourceAbilityId === BASIC_RHOM_ATTACK_DATA.sourceAbilityId,
        `Tower-selected published launch authority mismatch: ${JSON.stringify({
            launchAuthority,
            selectionResult,
            selectionCompletion,
            controlReceipt
        })}`);

        assert(selectionCompletion.despawned.length === 0
            && selectionCompletion.rejected.length === 0,
        `resolved launch continuation commit mismatch: ${JSON.stringify(
            selectionCompletion
        )}`);
        assert(endpoint.fixedUpdate(FIXED_DELTA, 3),
            'resolved launch continuation fixed submit failed');
        await settleEndpoint(endpoint, 'Rhom resolved launch continuation');
        const resolvedLaunchBodies = await readBodies(
            endpoint,
            'Rhom resolved launch continuation'
        );
        const projectileAfterResolvedLaunch = findBody(
            resolvedLaunchBodies,
            projectileHandle,
            'projectile after resolved launch continuation'
        );
        assert(projectileAfterResolvedLaunch.health
                === HOSTILE_RHOM_PROJECTILE_DATA.penetration
            && findBody(
                resolvedLaunchBodies,
                targetTowerHandle,
                'target Tower after resolved launch continuation'
            ).health === initialTargetTower.health
            && findBody(
                resolvedLaunchBodies,
                wrongTowerHandle,
                'wrong Tower after resolved launch continuation'
            ).health === initialWrongTower.health
            && findBody(
                resolvedLaunchBodies,
                coreHandle,
                'Core after resolved launch continuation'
            ).health === initialCore.health,
        `resolved launch continuation mutated projectile/targets before source death: ${JSON.stringify({
            projectileAfterResolvedLaunch,
            resolvedLaunchBodies
        })}`);
        const resolvedLaunchPublication
            = await commitCompletedEndpointEventsAtFixedBoundary(
                endpoint,
                SOURCE_DEATH_TICK,
                'Rhom resolved launch continuation publication'
            );
        assert(resolvedLaunchPublication.events.contactEvents.length === 0
            && resolvedLaunchPublication.events.deathEvents.length === 0,
        `resolved launch continuation emitted premature events: ${JSON.stringify(
            resolvedLaunchPublication
        )}`);

        const sourceDespawnRequest = endpoint.requestDespawn(
            sourceHandle,
            'rhom-source-death-after-resolved-spawn',
            SOURCE_DEATH_TICK,
            'rhom-source-death:source-despawn'
        );
        assert(sourceDespawnRequest.accepted === true,
            `source exact despawn ingress rejected: ${JSON.stringify(sourceDespawnRequest)}`);
        const sourceDespawnCommit = endpoint.commitAtFixedBoundary(SOURCE_DEATH_TICK);
        assert(sourceDespawnCommit.despawned.length === 1
            && exactHandle(sourceDespawnCommit.despawned[0].handle, sourceHandle)
            && sourceDespawnCommit.despawned[0].reason
                === 'rhom-source-death-after-resolved-spawn'
            && !sourceDespawnCommit.recoveryRequired
            && endpoint.getRegistry().has(sourceHandle) === false
            && endpoint.hasBody(sourceHandle) === false
            && endpoint.getRegistry().has(projectileHandle) === true
            && endpoint.hasBody(projectileHandle) === true,
        `source exact despawn/projectile retention mismatch: ${JSON.stringify({
            sourceDespawnCommit,
            sourceRegistered: endpoint.getRegistry().has(sourceHandle),
            sourceBackend: endpoint.hasBody(sourceHandle),
            projectileRegistered: endpoint.getRegistry().has(projectileHandle),
            projectileBackend: endpoint.hasBody(projectileHandle)
        })}`);
        assert(endpoint.fixedUpdate(FIXED_DELTA, SOURCE_DEATH_TICK),
            'source-death fixed submit failed');
        await settleEndpoint(endpoint, 'Rhom source exact death');
        let lastBodies = await readBodies(endpoint, 'Rhom source exact death');
        const projectileAfterSourceDeath = findBody(
            lastBodies,
            projectileHandle,
            'projectile after source exact death'
        );
        const targetAfterSourceDeath = findBody(
            lastBodies,
            targetTowerHandle,
            'target Tower after source exact death'
        );
        const wrongAfterSourceDeath = findBody(
            lastBodies,
            wrongTowerHandle,
            'wrong Tower after source exact death'
        );
        const coreAfterSourceDeath = findBody(
            lastBodies,
            coreHandle,
            'Core after source exact death'
        );
        const afterSourceDeathSnapshot = await readProjectileEffectSummary(
            endpoint,
            projectileAfterSourceDeath,
            'source-death'
        );
        const authorityAfterSourceDeath = copyProjectileAuthority(
            endpoint,
            projectileHandle,
            'source-death'
        );
        assert(!containsBody(lastBodies, sourceHandle)
            && projectileAfterSourceDeath.health
                === HOSTILE_RHOM_PROJECTILE_DATA.penetration
            && projectileAfterSourceDeath.enemyBehaviorState?.targetEntityId
                === targetTowerHandle.entityId
            && projectileAfterSourceDeath.enemyBehaviorState?.targetIncarnation
                === targetTowerHandle.incarnation
            && JSON.stringify(afterSourceDeathSnapshot) === JSON.stringify(launchSnapshot)
            && JSON.stringify(authorityAfterSourceDeath)
                === JSON.stringify(launchAuthority)
            && targetAfterSourceDeath.health === initialTargetTower.health
            && wrongAfterSourceDeath.health === initialWrongTower.health
            && coreAfterSourceDeath.health === initialCore.health,
        `source death mutated projectile authority or unrelated targets: ${JSON.stringify({
            projectileAfterSourceDeath,
            launchSnapshot,
            afterSourceDeathSnapshot,
            launchAuthority,
            authorityAfterSourceDeath,
            targetAfterSourceDeath,
            wrongAfterSourceDeath,
            coreAfterSourceDeath
        })}`);

        const sourceDeathPublication
            = await commitCompletedEndpointEventsAtFixedBoundary(
                endpoint,
                WINDOW_PRIME_SPAWN_TICK,
                'Rhom source-death completion before window prime'
            );
        assert(sourceDeathPublication.events.contactEvents.length === 0
            && sourceDeathPublication.events.deathEvents.length === 0,
        `source-death completion emitted premature events: ${JSON.stringify(
            sourceDeathPublication
        )}`);

        const windowPrimeEntryGeometry = createWindowPrimeEntryGeometry(
            targetAfterSourceDeath.position
        );
        assert(windowPrimeEntryGeometry.previousDistance
                > windowPrimeEntryGeometry.contactRadius
            && windowPrimeEntryGeometry.predictedDistance > 0
            && windowPrimeEntryGeometry.predictedDistance
                < windowPrimeEntryGeometry.contactRadius,
        `Maximum Damage Window prime enter-only geometry mismatch: ${JSON.stringify(
            windowPrimeEntryGeometry
        )}`);
        const windowPrimeRequest = endpoint.requestSpawn(
            createWindowPrimeProjectileIntent(windowPrimeEntryGeometry),
            WINDOW_PRIME_SPAWN_TICK,
            'rhom-source-death:maximum-window-prime'
        );
        assert(windowPrimeRequest.accepted === true,
            `Maximum Damage Window prime ingress rejected: ${JSON.stringify(
                windowPrimeRequest
            )}`);
        const windowPrimeCommit = endpoint.commitAtFixedBoundary(
            WINDOW_PRIME_SPAWN_TICK
        );
        const windowPrimeSpawn = windowPrimeCommit.spawned.find(({ commandId }) => (
            commandId === 'rhom-source-death:maximum-window-prime'
        ));
        assert(windowPrimeSpawn?.handle
            && windowPrimeCommit.rejected.length === 0
            && !windowPrimeCommit.recoveryRequired,
        `Maximum Damage Window prime commit mismatch: ${JSON.stringify(
            windowPrimeCommit
        )}`);
        const windowPrimeProjectileHandle = windowPrimeSpawn.handle;
        assert(endpoint.fixedUpdate(FIXED_DELTA, WINDOW_PRIME_SPAWN_TICK),
            'Maximum Damage Window prime fixed submit failed');
        await settleEndpoint(endpoint, 'Rhom Maximum Damage Window prime');
        const windowPrimeBodies = await readBodies(
            endpoint,
            'Rhom Maximum Damage Window prime'
        );
        const targetAfterWindowPrime = findBody(
            windowPrimeBodies,
            targetTowerHandle,
            'target Tower after Maximum Damage Window prime'
        );
        const wrongAfterWindowPrime = findBody(
            windowPrimeBodies,
            wrongTowerHandle,
            'wrong Tower after Maximum Damage Window prime'
        );
        const coreAfterWindowPrime = findBody(
            windowPrimeBodies,
            coreHandle,
            'Core after Maximum Damage Window prime'
        );
        const expectedWindowExpiry = WINDOW_PRIME_SPAWN_TICK
            + THE_TOWER_COMBAT_DATA.MAXIMUM_DAMAGE_WINDOW_DURATION_FIXED_TICKS;
        assertNear(
            targetAfterWindowPrime.health,
            THE_TOWER_COMBAT_DATA.MAX_HEALTH - WINDOW_PRIME_DAMAGE,
            0.000001,
            'Tower HP after Maximum Damage Window prime'
        );
        assert(targetAfterWindowPrime.combatState?.peakFinalDamageFixedPoint
                === windowPrimeDamageFixedPoint
            && targetAfterWindowPrime.combatState?.expiresAtFixedTick
                === expectedWindowExpiry
            && targetAfterWindowPrime.combatState?.peakSourceEntityId
                === windowPrimeProjectileHandle.entityId
            && targetAfterWindowPrime.combatState?.peakSourceIncarnation
                === windowPrimeProjectileHandle.incarnation
            && wrongAfterWindowPrime.health === initialWrongTower.health
            && coreAfterWindowPrime.health === initialCore.health
            && containsBody(windowPrimeBodies, projectileHandle)
            && !containsBody(windowPrimeBodies, sourceHandle),
        `Maximum Damage Window prime GPU state mismatch: ${JSON.stringify({
            targetAfterWindowPrime,
            wrongAfterWindowPrime,
            coreAfterWindowPrime,
            windowPrimeBodies,
            expectedWindowExpiry
        })}`);
        const windowPrimeState = Object.freeze({
            peakFinalDamageFixedPoint:
                targetAfterWindowPrime.combatState.peakFinalDamageFixedPoint,
            expiresAtFixedTick: targetAfterWindowPrime.combatState.expiresAtFixedTick,
            peakSourceEntityId:
                targetAfterWindowPrime.combatState.peakSourceEntityId,
            peakSourceIncarnation:
                targetAfterWindowPrime.combatState.peakSourceIncarnation
        });

        const windowPrimePublication
            = await commitCompletedEndpointEventsAtFixedBoundary(
                endpoint,
                WINDOW_PRIME_PUBLICATION_TICK,
                'Rhom Maximum Damage Window prime publication'
            );
        const windowPrimeDamageEvent = windowPrimePublication.events.contactEvents.find(
            (event) => event.eventType === 'damage-applied'
                && isExactContact(
                    event,
                    windowPrimeProjectileHandle,
                    targetTowerHandle
                )
        );
        const windowPrimeDeath = windowPrimePublication.events.deathEvents.find(
            (event) => exactHandle(event, windowPrimeProjectileHandle)
        );
        assert(windowPrimeDamageEvent
            && windowPrimeDamageEvent.damageFixedPoint === windowPrimeDamageFixedPoint
            && windowPrimeDamageEvent.valueFixedPoint === windowPrimeDamageFixedPoint
            && windowPrimeDamageEvent.maximumDamageWindow === true
            && windowPrimeDamageEvent.sourceTick === WINDOW_PRIME_SPAWN_TICK
            && windowPrimeDeath,
        `Maximum Damage Window prime event mismatch: ${JSON.stringify(
            windowPrimePublication
        )}`);
        const windowPrimeCleanupCommit = endpoint.commitAtFixedBoundary(
            WINDOW_PRIME_PUBLICATION_TICK
        );
        assert(windowPrimeCleanupCommit.despawned.length === 1
            && exactHandle(
                windowPrimeCleanupCommit.despawned[0].handle,
                windowPrimeProjectileHandle
            )
            && windowPrimeCleanupCommit.despawned[0].reason === 'gpu-death'
            && !windowPrimeCleanupCommit.recoveryRequired
            && endpoint.getRegistry().has(windowPrimeProjectileHandle) === false
            && endpoint.hasBody(windowPrimeProjectileHandle) === false,
        `Maximum Damage Window prime cleanup mismatch: ${JSON.stringify(
            windowPrimeCleanupCommit
        )}`);
        assert(endpoint.fixedUpdate(FIXED_DELTA, WINDOW_PRIME_PUBLICATION_TICK),
            'Maximum Damage Window primed continuation fixed submit failed');
        await settleEndpoint(endpoint, 'Rhom Maximum Damage Window primed continuation');
        lastBodies = await readBodies(
            endpoint,
            'Rhom Maximum Damage Window primed continuation'
        );
        const primedTargetBeforeRhomImpact = findBody(
            lastBodies,
            targetTowerHandle,
            'primed target Tower before Rhom impact'
        );
        assert(primedTargetBeforeRhomImpact.health
                === THE_TOWER_COMBAT_DATA.MAX_HEALTH - WINDOW_PRIME_DAMAGE
            && primedTargetBeforeRhomImpact.combatState?.peakFinalDamageFixedPoint
                === windowPrimeState.peakFinalDamageFixedPoint
            && primedTargetBeforeRhomImpact.combatState?.expiresAtFixedTick
                === windowPrimeState.expiresAtFixedTick
            && containsBody(lastBodies, projectileHandle)
            && !containsBody(lastBodies, sourceHandle)
            && !containsBody(lastBodies, windowPrimeProjectileHandle),
        `primed Tower/source-dead Rhom continuation mismatch: ${JSON.stringify({
            primedTargetBeforeRhomImpact,
            lastBodies,
            windowPrimeState
        })}`);

        const allContactEvents = [];
        let impactBoundary = null;
        let cleanupCommit = null;
        let postCleanupBodies = null;
        for (let tick = FIRST_PROJECTILE_TICK; tick <= LAST_PROJECTILE_TICK; tick++) {
            const completedPublication
                = await commitCompletedEndpointEventsAtFixedBoundary(
                    endpoint,
                    tick,
                    `T${tick} projectile flight publication`
                );
            const completed = completedPublication.events;
            allContactEvents.push(...completed.contactEvents);
            const projectileTowerHit = completed.contactEvents.find((event) => (
                event.eventType === 'damage-applied'
                    && isExactContact(event, projectileHandle, targetTowerHandle)
            ));
            if (projectileTowerHit) {
                impactBoundary = Object.freeze({ tick, completed, projectileTowerHit });
                const targetAfterImpact = findBody(
                    lastBodies,
                    targetTowerHandle,
                    'target Tower at projectile impact'
                );
                const wrongAfterImpact = findBody(
                    lastBodies,
                    wrongTowerHandle,
                    'wrong Tower at projectile impact'
                );
                const coreAfterImpact = findBody(
                    lastBodies,
                    coreHandle,
                    'Core at projectile impact'
                );
                assertNear(targetAfterImpact.health,
                    THE_TOWER_COMBAT_DATA.MAX_HEALTH - targetDamage,
                    0.000001,
                    'Tower HP after source-dead Rhom projectile');
                assertNear(wrongAfterImpact.health,
                    THE_TOWER_COMBAT_DATA.MAX_HEALTH,
                    0.000001,
                    'wrong Tower HP after source-dead Rhom projectile');
                const expectedImpactWindowExpiry = projectileTowerHit.sourceTick
                    + THE_TOWER_COMBAT_DATA.MAXIMUM_DAMAGE_WINDOW_DURATION_FIXED_TICKS;
                assert(coreAfterImpact.health === initialCore.health
                    && projectileTowerHit.damageFixedPoint
                        === expectedWindowDeltaFixedPoint
                    && projectileTowerHit.valueFixedPoint
                        === expectedWindowDeltaFixedPoint
                    && projectileTowerHit.maximumDamageWindow === true
                    && projectileTowerHit.damage === expectedWindowDelta
                    && targetAfterImpact.combatState?.peakFinalDamageFixedPoint
                        === targetDamageFixedPoint
                    && targetAfterImpact.combatState?.expiresAtFixedTick
                        === expectedImpactWindowExpiry
                    && targetAfterImpact.combatState?.peakSourceEntityId
                        === projectileHandle.entityId
                    && targetAfterImpact.combatState?.peakSourceIncarnation
                        === projectileHandle.incarnation
                    && projectileTowerHit.sourceTick
                        < windowPrimeState.expiresAtFixedTick
                    && expectedImpactWindowExpiry > windowPrimeState.expiresAtFixedTick
                    && !containsBody(lastBodies, projectileHandle),
                `source-dead Rhom projectile Tower impact mismatch: ${JSON.stringify({
                    projectileTowerHit,
                    targetAfterImpact,
                    wrongAfterImpact,
                    coreAfterImpact,
                    lastBodies
                })}`);
                const projectileDeath = completed.deathEvents.find((event) => (
                    event.entityId === projectileHandle.entityId
                        && event.incarnation === projectileHandle.incarnation
                ));
                assert(projectileDeath,
                    `projectile self-budget death missing: ${JSON.stringify(completed)}`);
                cleanupCommit = endpoint.commitAtFixedBoundary(tick);
                assert(cleanupCommit.despawned.length === 1
                    && exactHandle(cleanupCommit.despawned[0].handle, projectileHandle)
                    && cleanupCommit.despawned[0].reason === 'gpu-death'
                    && !cleanupCommit.recoveryRequired
                    && endpoint.getRegistry().has(projectileHandle) === false
                    && endpoint.hasBody(projectileHandle) === false,
                `projectile terminal cleanup mismatch: ${JSON.stringify(cleanupCommit)}`);
                assert(endpoint.fixedUpdate(FIXED_DELTA, tick),
                    `T${tick} post-cleanup fixed submit failed`);
                await settleEndpoint(endpoint, `T${tick} post-cleanup`);
                postCleanupBodies = await readBodies(endpoint, `T${tick} post-cleanup`);
                const finalTarget = findBody(
                    postCleanupBodies,
                    targetTowerHandle,
                    'target Tower after projectile terminal cleanup'
                );
                const finalWrong = findBody(
                    postCleanupBodies,
                    wrongTowerHandle,
                    'wrong Tower after projectile terminal cleanup'
                );
                const finalCore = findBody(
                    postCleanupBodies,
                    coreHandle,
                    'Core after projectile terminal cleanup'
                );
                assertNear(finalTarget.health,
                    THE_TOWER_COMBAT_DATA.MAX_HEALTH - targetDamage,
                    0.000001,
                    'Tower HP after projectile terminal cleanup');
                assertNear(finalWrong.health, THE_TOWER_COMBAT_DATA.MAX_HEALTH,
                    0.000001, 'wrong Tower HP after terminal cleanup');
                assert(finalCore.health === initialCore.health
                    && !containsBody(postCleanupBodies, sourceHandle)
                    && !containsBody(postCleanupBodies, projectileHandle),
                `terminal cleanup revived source/projectile or changed Core: ${JSON.stringify({
                    finalTarget,
                    finalWrong,
                    finalCore,
                    postCleanupBodies
                })}`);
                const postCleanupPublication
                    = await commitCompletedEndpointEventsAtFixedBoundary(
                        endpoint,
                        tick + 1,
                        `T${tick} post-cleanup publication`
                    );
                const postCleanupEvents = postCleanupPublication.events;
                assert(postCleanupEvents.contactEvents.length === 0
                    && postCleanupEvents.deathEvents.length === 0,
                `post-cleanup no-revive event proof mismatch: ${JSON.stringify(
                    postCleanupEvents
                )}`);
                const finalCommit = endpoint.commitAtFixedBoundary(tick + 1);
                assert(finalCommit.despawned.length === 0
                    && !finalCommit.recoveryRequired,
                `post-cleanup empty boundary mismatch: ${JSON.stringify(finalCommit)}`);
                break;
            }
            const commit = endpoint.commitAtFixedBoundary(tick);
            assert(commit.despawned.length === 0
                && commit.rejected.length === 0
                && !commit.recoveryRequired,
            `T${tick} unexpected lifecycle mutation: ${JSON.stringify(commit)}`);
            assert(endpoint.fixedUpdate(FIXED_DELTA, tick),
                `T${tick} projectile flight fixed submit failed`);
            await settleEndpoint(endpoint, `T${tick} projectile flight`);
            lastBodies = await readBodies(endpoint, `T${tick} projectile flight`);
        }

        assert(impactBoundary && cleanupCommit && postCleanupBodies,
            `Rhom projectile did not reach Tower after source death by T${LAST_PROJECTILE_TICK}`);
        const unwantedDamageEvents = allContactEvents.filter((event) => (
            event.eventType === 'damage-applied'
                && (isExactContact(event, projectileHandle, wrongTowerHandle)
                    || isExactContact(event, projectileHandle, coreHandle))
        ));
        assert(unwantedDamageEvents.length === 0,
            `wrong Tower/Core received source-dead projectile damage: ${JSON.stringify(
                unwantedDamageEvents
            )}`);
        const finalStatus = endpoint.getStatus();
        const gpuStatus = finalStatus.backend?.gpu;
        const storageMaximum = gpuStatus?.fixedPrimitives?.storageProfile
            ?.requiredMaximum;
        assert(finalStatus.activeCount === 3
            && finalStatus.activeProjectileCount === 0
            && finalStatus.reservedCount === 0
            && finalStatus.pendingCommandCount === 0
            && gpuStatus?.events?.pendingReadbacks === 0
            && gpuStatus?.fixedPrimitives?.spawnProgram?.pendingReadbacks === 0
            && storageMaximum === REQUIRED_STORAGE_BUFFER_LIMIT
            && !finalStatus.recoveryRequired
            && !endpoint.requiresRecovery(),
        `final source-death projectile runtime mismatch: ${JSON.stringify({
            finalStatus,
            gpuStatus,
            storageMaximum
        })}`);

        const targetAfterImpact = findBody(
            postCleanupBodies,
            targetTowerHandle,
            'result target Tower'
        );
        const wrongAfterImpact = findBody(
            postCleanupBodies,
            wrongTowerHandle,
            'result wrong Tower'
        );
        const coreAfterImpact = findBody(postCleanupBodies, coreHandle, 'result Core');
        const projectileDeath = impactBoundary.completed.deathEvents.find((event) => (
            event.entityId === projectileHandle.entityId
                && event.incarnation === projectileHandle.incarnation
        ));
        return Object.freeze({
            scenario: 'rhom-tower-selected-direct-projectile-survives-source-death',
            launch: Object.freeze({
                sourceHandle: copyHandle(sourceHandle),
                projectileHandle: copyHandle(projectileHandle),
                targetTowerHandle: copyHandle(targetTowerHandle),
                wrongTowerHandle: copyHandle(wrongTowerHandle),
                coreHandle: copyHandle(coreHandle),
                coreDistance,
                attackRangeTiles: BASIC_RHOM_ATTACK_DATA.attackRangeTiles,
                selectedTargetOutcome: selectionResult.outcome,
                projectileAlive: true,
                selectedTowerBehaviorExact: true,
                snapshot: launchSnapshot,
                authority: launchAuthority
            }),
            sourceDeath: Object.freeze({
                fixedTick: SOURCE_DEATH_TICK,
                exactSourceDespawned: true,
                sourceRegistryPresent: false,
                sourceBackendPresent: false,
                projectileRegistryPresent: true,
                projectileBackendPresent: true,
                projectileAliveAfterSourceDeath: true,
                provenancePreserved: true,
                selectedTowerAuthorityPreserved: true,
                immutableSnapshotPreserved: true,
                snapshot: afterSourceDeathSnapshot,
                authority: authorityAfterSourceDeath
            }),
            windowPrime: Object.freeze({
                spawnTick: WINDOW_PRIME_SPAWN_TICK,
                publicationTick: WINDOW_PRIME_PUBLICATION_TICK,
                projectileHandle: copyHandle(windowPrimeProjectileHandle),
                entryGeometry: windowPrimeEntryGeometry,
                targetHpBefore: THE_TOWER_COMBAT_DATA.MAX_HEALTH,
                targetHpAfter: targetAfterWindowPrime.health,
                damageFixedPoint: windowPrimeDamageEvent.damageFixedPoint,
                maximumDamageWindow: windowPrimeDamageEvent.maximumDamageWindow,
                peakFinalDamageFixedPoint:
                    windowPrimeState.peakFinalDamageFixedPoint,
                expiresAtFixedTick: windowPrimeState.expiresAtFixedTick,
                peakSourceEntityId: windowPrimeState.peakSourceEntityId,
                peakSourceIncarnation: windowPrimeState.peakSourceIncarnation,
                projectileDeath: Object.freeze({
                    reason: windowPrimeDeath.reason,
                    sourceTick: windowPrimeDeath.sourceTick,
                    disposition: windowPrimeDeath.disposition
                }),
                terminalCleanupExact: true
            }),
            impact: Object.freeze({
                boundaryTick: impactBoundary.tick,
                sourceTick: impactBoundary.projectileTowerHit.sourceTick,
                targetHpBefore: targetAfterWindowPrime.health,
                targetHpAfter: targetAfterImpact.health,
                wrongTowerHpBefore: THE_TOWER_COMBAT_DATA.MAX_HEALTH,
                wrongTowerHpAfter: wrongAfterImpact.health,
                coreHealthBefore: initialCore.health,
                coreHealthAfter: coreAfterImpact.health,
                coreUnchanged: true,
                wrongTowerUnchanged: true,
                noSourceRevalidation: true,
                projectileDamageFixedPoint: targetDamageFixedPoint,
                appliedDamageFixedPoint:
                    impactBoundary.projectileTowerHit.damageFixedPoint,
                maximumDamageWindow: true,
                directDiscreteDamage: false,
                commonMaximumDamageWindow: true,
                windowActiveBeforeImpact:
                    impactBoundary.projectileTowerHit.sourceTick
                        < windowPrimeState.expiresAtFixedTick,
                windowPeakBeforeImpactFixedPoint:
                    windowPrimeState.peakFinalDamageFixedPoint,
                windowPeakAfterImpactFixedPoint:
                    targetAfterImpact.combatState.peakFinalDamageFixedPoint,
                windowExpiryBeforeImpact: windowPrimeState.expiresAtFixedTick,
                windowExpiryAfterImpact:
                    targetAfterImpact.combatState.expiresAtFixedTick,
                windowStatePreserved: false,
                windowStateReset:
                    targetAfterImpact.combatState.peakFinalDamageFixedPoint
                        === targetDamageFixedPoint
                    && targetAfterImpact.combatState.expiresAtFixedTick
                        === impactBoundary.projectileTowerHit.sourceTick
                            + THE_TOWER_COMBAT_DATA
                                .MAXIMUM_DAMAGE_WINDOW_DURATION_FIXED_TICKS
                    && targetAfterImpact.combatState.peakSourceEntityId
                        === projectileHandle.entityId
                    && targetAfterImpact.combatState.peakSourceIncarnation
                        === projectileHandle.incarnation,
                projectileSelfBudgetBefore: HOSTILE_RHOM_PROJECTILE_DATA.penetration,
                projectileDeath: Object.freeze({
                    reason: projectileDeath.reason,
                    sourceTick: projectileDeath.sourceTick,
                    disposition: projectileDeath.disposition
                }),
                wrongOrCoreDamageEventCount: unwantedDamageEvents.length
            }),
            cleanup: Object.freeze({
                terminalCleanupExact: true,
                projectileRegistryPresent: false,
                projectileBackendPresent: false,
                sourceRegistryPresent: false,
                sourceBackendPresent: false,
                noRevive: true,
                targetHpAfterCleanup: targetAfterImpact.health,
                activeCount: finalStatus.activeCount,
                activeProjectileCount: finalStatus.activeProjectileCount,
                reservedCount: finalStatus.reservedCount,
                pendingCommandCount: finalStatus.pendingCommandCount
            }),
            runtime: Object.freeze({
                recoveryRequired: false,
                endpointRequiresRecovery: false,
                storageMaximum,
                pendingEventReadbacks: gpuStatus.events.pendingReadbacks,
                pendingSpawnProgramReadbacks:
                    gpuStatus.fixedPrimitives.spawnProgram.pendingReadbacks,
                uncapturedErrorCount: 0,
                deviceTeardownExpected: 'destroyed'
            })
        });
    } finally {
        endpoint.destroy();
        await device.queue.onSubmittedWorkDone();
    }
}

async function run() {
    const result = {
        status: 'fail',
        runtime: {
            nw: process.versions.nw || '',
            chrome: process.versions.chrome || '',
            protocol: location.protocol,
            secureContext: isSecureContext
        }
    };
    let device = null;
    try {
        assert(resultPath, 'CIRVIVOR_WEBGPU_RESULT_PATH missing');
        assert(isSecureContext, `secure context required: ${location.protocol}`);
        assert(navigator.gpu, 'navigator.gpu unavailable');
        const adapter = await navigator.gpu.requestAdapter({
            powerPreference: 'high-performance'
        });
        assert(adapter, 'WebGPU adapter unavailable');
        assert(
            adapter.limits.maxStorageBuffersPerShaderStage
                >= REQUIRED_STORAGE_BUFFER_LIMIT,
            'WebGPU storage buffer limit below 9'
        );
        device = await adapter.requestDevice({
            requiredLimits: {
                maxStorageBuffersPerShaderStage: REQUIRED_STORAGE_BUFFER_LIMIT
            }
        });
        const uncapturedErrors = [];
        device.addEventListener('uncapturederror', (event) => {
            uncapturedErrors.push(event.error?.message ?? String(event.error));
        });
        result.productionEnemyRhomSourceDeathProjectile = await (
            runRhomSourceDeathProjectileFixture(device)
        );
        await device.queue.onSubmittedWorkDone();
        result.uncapturedErrorCount = uncapturedErrors.length;
        assert(uncapturedErrors.length === 0,
            `uncaptured WebGPU error: ${uncapturedErrors.join(' | ')}`);
        const lostPromise = device.lost;
        device.destroy();
        const lost = await lostPromise;
        result.deviceLostReason = lost.reason;
        assert(lost.reason === 'destroyed', `device lost reason: ${lost.reason}`);
        result.status = 'pass';
    } catch (error) {
        result.error = error?.stack ?? String(error);
        try {
            device?.destroy();
        } catch {
            // failed fixture cleanup is best effort
        }
    }
    require('node:fs').writeFileSync(
        resultPath,
        `${JSON.stringify(result, null, 2)}\n`,
        'utf8'
    );
    nw.App.quit();
}

run();
