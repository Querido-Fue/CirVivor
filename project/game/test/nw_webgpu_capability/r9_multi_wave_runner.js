import {
    R2_ENEMY_SHOWCASE_MAP_DATA
} from './production/script/data/scene/game/r2_enemy_showcase_map_data.js';
import {
    R9_QA_THREE_WAVE_RUN_PLAN
} from './production/script/data/scene/game/r9_wave_run_plan_data.js';
import {
    getWaveRunPlanFingerprint,
    getWaveRunPlanWaveMetadata
} from './production/script/module/ingame/contract/wave_run_plan_contract.js';
import {
    createWaveQuiescenceSnapshot
} from './production/script/module/ingame/contract/wave_quiescence_contract.js';
import {
    WAVE_RUN_FACT_TYPE,
    WAVE_RUN_RESULT_CODE,
    WAVE_RUN_STATE
} from './production/script/module/ingame/contract/wave_run_state_contract.js';
import {
    createAllOpenRouteAvailabilitySelectionSnapshot
} from './production/script/module/ingame/contract/route_availability_contract.js';
import {
    WaveDirector
} from './production/script/module/ingame/flow/wave_director.js';
import {
    WaveRunCoordinator
} from './production/script/module/ingame/flow/wave_run_coordinator.js';
import {
    TileMap
} from './production/script/module/ingame/map/tile_map.js';
import {
    createRouteFlowFieldAtlas
} from './production/script/module/ingame/navigation/route_flow_field_atlas.js';

const resultPath = process.env.CIRVIVOR_WEBGPU_RESULT_PATH;
const PROGRESS_WORD_COUNT = 4;
const PROGRESS_BUFFER_BYTES = PROGRESS_WORD_COUNT * Uint32Array.BYTES_PER_ELEMENT;

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const PROGRESSION_SHADER = /* wgsl */`
struct Progress {
    total_spawn_count: atomic<u32>,
    live_hostile_count: atomic<u32>,
    completed_wave_count: atomic<u32>,
    last_wave_ordinal: atomic<u32>,
}

struct Operation {
    kind: u32,
    count: u32,
    wave_ordinal: u32,
    _pad0: u32,
}

@group(0) @binding(0) var<storage, read_write> progress: Progress;
@group(0) @binding(1) var<uniform> operation: Operation;

@compute @workgroup_size(1)
fn main() {
    if (operation.kind == 1u) {
        atomicAdd(&progress.total_spawn_count, operation.count);
        atomicAdd(&progress.live_hostile_count, operation.count);
        atomicStore(&progress.last_wave_ordinal, operation.wave_ordinal);
        return;
    }
    if (operation.kind == 2u) {
        atomicStore(&progress.live_hostile_count, 0u);
        atomicAdd(&progress.completed_wave_count, 1u);
    }
}
`;

function createPersistentGpuProgressionEndpoint(device) {
    const progressBuffer = device.createBuffer({
        label: 'R9 multi-wave persistent progress',
        size: PROGRESS_BUFFER_BYTES,
        usage: GPUBufferUsage.STORAGE
            | GPUBufferUsage.COPY_SRC
            | GPUBufferUsage.COPY_DST
    });
    const operationBuffer = device.createBuffer({
        label: 'R9 multi-wave operation',
        size: PROGRESS_BUFFER_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(
        progressBuffer,
        0,
        new Uint32Array(PROGRESS_WORD_COUNT)
    );
    const module = device.createShaderModule({
        label: 'R9 multi-wave progression shader',
        code: PROGRESSION_SHADER
    });
    const pipeline = device.createComputePipeline({
        label: 'R9 multi-wave progression pipeline',
        layout: 'auto',
        compute: { module, entryPoint: 'main' }
    });
    const bindGroup = device.createBindGroup({
        label: 'R9 multi-wave progression bindings',
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: progressBuffer } },
            { binding: 1, resource: { buffer: operationBuffer } }
        ]
    });
    const commandIds = new Set();
    const spawnTicks = [];
    const endpointIdentity = Object.freeze({ device, progressBuffer });

    function dispatch(kind, count, waveOrdinal) {
        const operation = new Uint32Array([
            kind,
            count,
            waveOrdinal,
            0
        ]);
        device.queue.writeBuffer(operationBuffer, 0, operation);
        const encoder = device.createCommandEncoder({
            label: `R9 multi-wave operation ${kind}:${waveOrdinal}`
        });
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(1);
        pass.end();
        device.queue.submit([encoder.finish()]);
    }

    const commandOwner = Object.freeze({
        requestSpawnBatch(requests) {
            assert(Array.isArray(requests) && requests.length > 0,
                'R9 multi-wave spawn batch is empty');
            const targetFixedTick = requests[0].targetFixedTick;
            assert(requests.every((request) => (
                request.targetFixedTick === targetFixedTick
            )), 'R9 multi-wave spawn batch tick mismatch');
            for (const request of requests) {
                assert(!commandIds.has(request.commandId),
                    `R9 multi-wave duplicate command: ${request.commandId}`);
                commandIds.add(request.commandId);
            }
            const waveOrdinal = spawnTicks.length + 1;
            spawnTicks.push(targetFixedTick);
            dispatch(1, requests.length, waveOrdinal);
            return Object.freeze({
                accepted: true,
                requestedCount: requests.length,
                queuedCount: requests.length
            });
        }
    });

    async function clearWave(waveOrdinal) {
        dispatch(2, 0, waveOrdinal);
        await device.queue.onSubmittedWorkDone();
    }

    async function readProgress() {
        await device.queue.onSubmittedWorkDone();
        const readback = device.createBuffer({
            label: 'R9 multi-wave progression readback',
            size: PROGRESS_BUFFER_BYTES,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });
        const encoder = device.createCommandEncoder({
            label: 'R9 multi-wave progression copy'
        });
        encoder.copyBufferToBuffer(
            progressBuffer,
            0,
            readback,
            0,
            PROGRESS_BUFFER_BYTES
        );
        device.queue.submit([encoder.finish()]);
        await readback.mapAsync(GPUMapMode.READ);
        const words = new Uint32Array(readback.getMappedRange().slice(0));
        readback.unmap();
        readback.destroy();
        return Object.freeze({
            totalSpawnCount: words[0],
            liveHostileCount: words[1],
            completedWaveCount: words[2],
            lastWaveOrdinal: words[3]
        });
    }

    return Object.freeze({
        commandOwner,
        clearWave,
        readProgress,
        getEndpointIdentity: () => endpointIdentity,
        getSpawnTicks: () => Object.freeze([...spawnTicks]),
        getCommandCount: () => commandIds.size,
        destroy() {
            progressBuffer.destroy();
            operationBuffer.destroy();
        }
    });
}

function createSnapshot({
    coordinator,
    waveOrdinal,
    fixedTick,
    revision,
    liveHostileActorCount
}) {
    const status = coordinator.getStatus();
    return createWaveQuiescenceSnapshot({
        snapshotRevision: revision,
        fixedTick,
        protocol: {
            sessionGeneration: 1,
            deviceGeneration: 1,
            authoritativeEpoch: 1
        },
        wave: {
            mapId: R9_QA_THREE_WAVE_RUN_PLAN.mapId,
            waveId: status.currentWaveId,
            waveOrdinal,
            initialized: true,
            totalSpawnCount: 1,
            queuedSpawnCount: 1,
            remainingSpawnCount: 0,
            blockedSpawnCount: 0,
            allSpawnsQueued: true,
            completionOwned: false
        },
        hostile: {
            revision,
            registryRevision: revision,
            countExact: true,
            liveHostileActorCount,
            pendingHostileActorCount: 0,
            hostileActorCount: liveHostileActorCount
        },
        pending: {
            hostileLifecycleSpawnCount: 0,
            hostileMaterializationCount: 0,
            hostileTransitCount: 0,
            hostileAtomicTransformCount: 0,
            lifecycleCommandCount: 0,
            materializationWorkCount: 0,
            transitActorCount: 0,
            atomicTransformWorkCount: 0
        },
        events: {
            lastSubmittedTick: fixedTick,
            lastCompletedTick: fixedTick,
            completedThroughTick: fixedTick,
            deferredBatchCount: 0,
            protocolFailure: false
        },
        registryRevision: revision,
        run: {
            running: true,
            defeated: false,
            coreDepleted: false,
            recoveryRequired: false
        }
    });
}

function assertAccepted(receipt, stage) {
    assert(receipt?.accepted === true
        && receipt.code === WAVE_RUN_RESULT_CODE.ACCEPTED,
    `${stage} failed: ${receipt?.code}`);
    return receipt;
}

async function runFixture(device) {
    const endpoint = createPersistentGpuProgressionEndpoint(device);
    const endpointIdentity = endpoint.getEndpointIdentity();
    const tileMap = new TileMap(R2_ENEMY_SHOWCASE_MAP_DATA);
    const atlas = createRouteFlowFieldAtlas(tileMap);
    const allOpen = createAllOpenRouteAvailabilitySelectionSnapshot(
        atlas.contentKey,
        1
    );
    const plan = R9_QA_THREE_WAVE_RUN_PLAN;
    const planFingerprint = getWaveRunPlanFingerprint(plan);
    const runSessionId = 'r9-multi-wave-actual';
    const coordinator = new WaveRunCoordinator({ plan, runSessionId });
    const preservedOwners = Object.freeze({
        core: Object.freeze({ integrity: 100 }),
        tower: Object.freeze({ rosterRevision: 7 }),
        gold: Object.freeze({ balance: 30 }),
        inventory: Object.freeze({ revision: 4 }),
        board: Object.freeze({ revision: 9 })
    });
    const ownerIdentities = Object.values(preservedOwners);
    const directorSequence = [];
    const destroyedWaveIds = [];
    let fixedTick = 0;
    let activeDirector = null;
    let overtimeObserved = false;
    let finalMapClearReceipt = null;

    try {
        assertAccepted(coordinator.startPlan({
            transactionId: `${runSessionId}:start`,
            runSessionId,
            planId: plan.planId,
            planFingerprint
        }), 'plan start');
        assertAccepted(coordinator.beginWave({
            transactionId: `${runSessionId}:wave:1:begin`,
            runSessionId,
            planId: plan.planId,
            waveOrdinal: 1,
            waveId: getWaveRunPlanWaveMetadata(plan, 1).waveId,
            startingFixedTick: fixedTick
        }), 'wave 1 begin');

        for (let waveOrdinal = 1; waveOrdinal <= 3; waveOrdinal++) {
            const entry = plan.waves[waveOrdinal - 1];
            const candidate = new WaveDirector({
                waveDefinition: entry.waveDefinition,
                fixedTickOffset: fixedTick
            });
            assert(candidate.init(tileMap) === true,
                `Wave ${waveOrdinal} director init failed`);
            const preparedStatus = candidate.getStatus();
            assert(preparedStatus.queuedSpawnCount === 0
                && preparedStatus.fixedTickOffset === fixedTick,
            `Wave ${waveOrdinal} prepared state mismatch`);
            directorSequence.push(Object.freeze({
                waveId: preparedStatus.waveId,
                fixedTickOffset: preparedStatus.fixedTickOffset
            }));

            if (activeDirector !== null) {
                assert(candidate.queueSpawnsForFixedTick(
                    fixedTick,
                    endpoint.commandOwner,
                    allOpen
                ) === 0, `Wave ${waveOrdinal} spawned on close boundary`);
                const previousWaveOrdinal = waveOrdinal - 1;
                const previousRevision = previousWaveOrdinal * 10 + 2;
                const previousMetadata = getWaveRunPlanWaveMetadata(
                    plan,
                    previousWaveOrdinal
                );
                activeDirector.destroy();
                destroyedWaveIds.push(previousMetadata.waveId);
                assertAccepted(coordinator.observeShopContinue({
                    transactionId:
                        `${runSessionId}:wave:${previousWaveOrdinal}:continue`,
                    runSessionId,
                    planId: plan.planId,
                    waveOrdinal: previousWaveOrdinal,
                    waveId: previousMetadata.waveId,
                    continueReceiptId:
                        `${runSessionId}:wave:${previousWaveOrdinal}:closed`,
                    completionRevision: previousRevision,
                    authentic: true
                }), `Wave ${previousWaveOrdinal} continue`);
                assertAccepted(coordinator.prepareNextWave({
                    transactionId: `${runSessionId}:wave:${waveOrdinal}:prepare`,
                    runSessionId,
                    planId: plan.planId,
                    planFingerprint,
                    completedWaveOrdinal: previousWaveOrdinal,
                    completedWaveId: previousMetadata.waveId,
                    nextWaveOrdinal: waveOrdinal,
                    nextWaveId: preparedStatus.waveId,
                    completionRevision: previousRevision
                }), `Wave ${waveOrdinal} run prepare`);
                assertAccepted(coordinator.beginWave({
                    transactionId: `${runSessionId}:wave:${waveOrdinal}:begin`,
                    runSessionId,
                    planId: plan.planId,
                    waveOrdinal,
                    waveId: preparedStatus.waveId,
                    startingFixedTick: fixedTick
                }), `Wave ${waveOrdinal} begin`);
            }
            activeDirector = candidate;
            fixedTick++;
            const queued = activeDirector.queueSpawnsForFixedTick(
                fixedTick,
                endpoint.commandOwner,
                allOpen
            );
            assert(queued === 1,
                `Wave ${waveOrdinal} did not queue one hostile`);
            const spawned = await endpoint.readProgress();
            assert(spawned.liveHostileCount === 1
                && spawned.lastWaveOrdinal === waveOrdinal,
            `Wave ${waveOrdinal} GPU spawn publication mismatch`);

            assertAccepted(coordinator.observeClockTick({
                transactionId: `${runSessionId}:wave:${waveOrdinal}:clock:1`,
                runSessionId,
                planId: plan.planId,
                waveOrdinal,
                waveId: preparedStatus.waveId,
                proposedElapsedCombatTicks: 1,
                completedFixedTick: fixedTick,
                completed: true,
                intentionalPause: false
            }), `Wave ${waveOrdinal} clock`);
            coordinator.evaluateWaveQuiescence(createSnapshot({
                coordinator,
                waveOrdinal,
                fixedTick,
                revision: waveOrdinal * 10 + 1,
                liveHostileActorCount: 1
            }));
            const liveState = coordinator.getStatus().state;
            if (waveOrdinal === 2) {
                overtimeObserved = liveState === WAVE_RUN_STATE.OVERTIME;
                assert(overtimeObserved, 'Wave 2 did not enter OVERTIME');
            } else {
                assert(liveState === WAVE_RUN_STATE.WAVE_ACTIVE,
                    `Wave ${waveOrdinal} unexpectedly left normal combat`);
            }

            await endpoint.clearWave(waveOrdinal);
            const cleared = await endpoint.readProgress();
            assert(cleared.liveHostileCount === 0,
                `Wave ${waveOrdinal} GPU clear did not settle`);
            const completionRevision = waveOrdinal * 10 + 2;
            coordinator.evaluateWaveQuiescence(createSnapshot({
                coordinator,
                waveOrdinal,
                fixedTick,
                revision: completionRevision,
                liveHostileActorCount: 0
            }));
            const clearStatus = coordinator.getStatus();
            assert(clearStatus.state === WAVE_RUN_STATE.CLEAR_CANDIDATE,
                `Wave ${waveOrdinal} did not reach CLEAR_CANDIDATE`);
            assertAccepted(coordinator.prepareSettlement({
                transactionId: `${runSessionId}:wave:${waveOrdinal}:settle`,
                runSessionId,
                planId: plan.planId,
                waveOrdinal,
                waveId: preparedStatus.waveId,
                clearProofFingerprint: clearStatus.clearProofFingerprint,
                completionRevision
            }), `Wave ${waveOrdinal} settlement`);
            assertAccepted(coordinator.observeShopOpened({
                transactionId: `${runSessionId}:wave:${waveOrdinal}:shop-open`,
                runSessionId,
                planId: plan.planId,
                waveOrdinal,
                waveId: preparedStatus.waveId,
                shopSessionId: `${runSessionId}:shop:${waveOrdinal}`,
                completionRevision,
                shopReady: true
            }), `Wave ${waveOrdinal} shop open`);
        }

        const finalMetadata = getWaveRunPlanWaveMetadata(plan, 3);
        finalMapClearReceipt = assertAccepted(
            coordinator.observeShopContinue({
                transactionId: `${runSessionId}:wave:3:continue`,
                runSessionId,
                planId: plan.planId,
                waveOrdinal: 3,
                waveId: finalMetadata.waveId,
                continueReceiptId: `${runSessionId}:wave:3:closed`,
                completionRevision: 32,
                authentic: true
            }),
            'Wave 3 final continue'
        );
        const finalStatus = coordinator.getStatus();
        const finalProgress = await endpoint.readProgress();
        const identitiesPreserved = Object.values(preservedOwners).every(
            (owner, index) => owner === ownerIdentities[index]
        );
        assert(endpoint.getEndpointIdentity() === endpointIdentity,
            'R9 multi-wave GPU endpoint identity changed');
        assert(finalStatus.state === WAVE_RUN_STATE.MAP_CLEAR_READY,
            'R9 multi-wave final state is not MAP_CLEAR_READY');
        assert(finalProgress.totalSpawnCount === 3
            && finalProgress.liveHostileCount === 0
            && finalProgress.completedWaveCount === 3
            && finalProgress.lastWaveOrdinal === 3,
        'R9 multi-wave final GPU aggregate mismatch');
        assert(identitiesPreserved, 'R9 preserved owner identity changed');
        const mapClearFactCount = coordinator.getFacts().filter(
            (fact) => fact.type === WAVE_RUN_FACT_TYPE.MAP_CLEAR_READY
        ).length;
        assert(mapClearFactCount === 1,
            'R9 MapClearReady fact is not exact-once');

        return Object.freeze({
            scenario: 'r9-three-wave-progression-actual-webgpu',
            directorSequence: Object.freeze(directorSequence),
            directorCreateCount: directorSequence.length,
            destroyedWaveIds: Object.freeze(destroyedWaveIds),
            sameGpuEndpoint: endpoint.getEndpointIdentity() === endpointIdentity,
            endpointProgress: finalProgress,
            firstSpawnFixedTicks: endpoint.getSpawnTicks(),
            uniqueSpawnCommandCount: endpoint.getCommandCount(),
            noCloseBoundarySpawn: endpoint.getSpawnTicks().join(',') === '1,2,3',
            overtimeObserved,
            finalState: finalStatus.state,
            finalContinueState: finalMapClearReceipt.state,
            mapClearFactCount,
            nextDirectorCreatedAfterFinal: directorSequence.length > 3,
            preservedOwnerIdentity: identitiesPreserved,
            routeAllOpen: allOpen.closedPathIds.length === 0,
            planFingerprint,
            storageMaximum: 2,
            recoveryRequired: false
        });
    } finally {
        activeDirector?.destroy();
        coordinator.destroy();
        endpoint.destroy();
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
        assert(adapter.limits.maxStorageBuffersPerShaderStage >= 9,
            'WebGPU storage buffer limit below 9');
        result.adapterMaxStorageBuffersPerShaderStage
            = adapter.limits.maxStorageBuffersPerShaderStage;
        result.requestedMaxStorageBuffersPerShaderStage = 9;
        device = await adapter.requestDevice({
            requiredLimits: { maxStorageBuffersPerShaderStage: 9 }
        });
        result.deviceMaxStorageBuffersPerShaderStage
            = device.limits.maxStorageBuffersPerShaderStage;
        const uncapturedErrors = [];
        device.addEventListener('uncapturederror', (event) => {
            uncapturedErrors.push(event.error?.message ?? String(event.error));
        });
        result.r9MultiWave = await runFixture(device);
        await device.queue.onSubmittedWorkDone();
        result.uncapturedErrorCount = uncapturedErrors.length;
        assert(uncapturedErrors.length === 0,
            `uncaptured WebGPU error: ${uncapturedErrors.join(' | ')}`);
        const lostPromise = device.lost;
        device.destroy();
        const lost = await lostPromise;
        result.deviceLostReason = lost.reason;
        assert(lost.reason === 'destroyed',
            `device lost reason: ${lost.reason}`);
        result.status = 'pass';
    } catch (error) {
        result.error = error?.stack ?? String(error);
        try { device?.destroy(); } catch { /* best effort */ }
    }
    require('node:fs').writeFileSync(
        resultPath,
        `${JSON.stringify(result, null, 2)}\n`,
        'utf8'
    );
    nw.App.quit();
}

run();
