import {
    GPU_PROJECTILE_CAPTURE_TICK_STATUS
} from 'ingame/physics/gpu/gpu_projectile_capture_runtime_abi.js';

const RECOVERY_LOG_SCHEMA_VERSION = 1;

function clonePlain(value) {
    const ancestors = [];
    try {
        return JSON.parse(JSON.stringify(value, function replacer(_key, current) {
            if (typeof current === 'bigint') {
                return current.toString();
            }
            if (current instanceof Error) {
                return {
                    name: current.name,
                    message: current.message,
                    stack: current.stack ?? null
                };
            }
            if (current && typeof current === 'object') {
                while (ancestors.length > 0 && ancestors.at(-1) !== this) {
                    ancestors.pop();
                }
                if (ancestors.includes(current)) {
                    return '[Circular]';
                }
                ancestors.push(current);
            }
            return current;
        }));
    } catch (error) {
        return {
            diagnosticSerializationFailure: String(error?.message ?? error)
        };
    }
}

function safeRead(read) {
    try {
        return read();
    } catch (error) {
        return {
            diagnosticReadFailure: String(error?.message ?? error),
            stack: typeof error?.stack === 'string' ? error.stack : null
        };
    }
}

function findDirectGridFailure(endpoint, object) {
    const gpu = endpoint?.backend?.gpu ?? endpoint?.gpu ?? null;
    const overflow = gpu?.overflow ?? null;
    const failure = gpu?.failure ?? null;
    const small = Number(overflow?.lastSmallCount) || 0;
    const big = Number(overflow?.lastBigCount) || 0;
    const gridFailure = failure?.stage === 'grid-overflow'
        || ((gpu?.state === 'overflow-degraded'
                || endpoint?.state === 'gpu-overflow-degraded')
            && (small > 0 || big > 0));
    if (!gridFailure) {
        return null;
    }
    const failureFingerprint = [
        gpu?.sessionGeneration ?? endpoint?.sessionGeneration ?? 'unknown-session',
        gpu?.deviceGeneration ?? 'unknown-device',
        overflow?.lastTick ?? 'unknown-tick',
        small,
        big,
        Number(overflow?.totalSmallCount) || 0,
        Number(overflow?.totalBigCount) || 0
    ].join(':');
    return Object.freeze({
        stage: 'grid-overflow',
        failureFingerprint,
        failure,
        initialCellOverflow: Object.freeze({
            small,
            big,
            capacity: Number(gpu?.maxBodiesPerCell) || null,
            sampleSubmittedTick:
                Number(overflow?.lastSampleSubmittedTick) || 0,
            sampleCompletedTick:
                Number(overflow?.lastSampleCompletedTick) || 0
        }),
        recoveryProbationState:
            object?.gpuRecovery?.probation?.state ?? null
    });
}

function findProjectileCaptureOwnedFailure(status) {
    if (!status || typeof status !== 'object') {
        return null;
    }
    const runtimeStatus = Number(status.runtimeStatus);
    const ownsProtocolFailure = runtimeStatus === GPU_PROJECTILE_CAPTURE_TICK_STATUS.REJECTED
        || runtimeStatus === GPU_PROJECTILE_CAPTURE_TICK_STATUS.PROTOCOL_FAILURE
        || (Number(status.errorFlags) || 0) !== 0
        || status.capacityRejected === true
        || status.retryableCapacityRejected === true
        || (Number(status.capacityRejectionFlags) || 0) !== 0;
    const failure = status.failure;
    const failureIdentity = typeof failure === 'object' && failure !== null
        ? `${failure.stage ?? ''}:${failure.name ?? ''}`.toLowerCase()
        : '';
    const ownsNamedFailure = failureIdentity.includes('projectile-capture')
        || failureIdentity.includes('projectilecapture');
    return ownsProtocolFailure || ownsNamedFailure ? status : null;
}

/**
 * 첫 fail-closed domain을 안정적인 우선순위로 분류합니다.
 * @param {object} snapshot - 교체 전 GPU/object 진단입니다.
 * @returns {{domain:string,detail:unknown}} 분류 결과입니다.
 */
export function findGpuWorldRecoveryCause(snapshot) {
    const endpoint = snapshot?.endpoint ?? {};
    const object = snapshot?.object ?? {};
    const directGridFailure = findDirectGridFailure(endpoint, object);
    if (directGridFailure) {
        return {
            domain: 'endpoint.gpu.grid',
            detail: directGridFailure
        };
    }
    const candidates = [
        ['endpoint.events', endpoint.events?.protocolFailure],
        ['endpoint.lifecycle', endpoint.lifecycle?.recoveryRequired === true
            ? endpoint.lifecycle : null],
        ['endpoint.fixedCommands', endpoint.fixedCommands?.recoveryRequired === true
            ? endpoint.fixedCommands : null],
        ['endpoint.effectCommands', endpoint.effectCommands?.recoveryRequired === true
            ? endpoint.effectCommands : null],
        ['endpoint.formationCommands',
            endpoint.formationCommands?.recoveryRequired === true
                ? endpoint.formationCommands : null],
        ['endpoint.atomicTransformCommands',
            endpoint.atomicTransformCommands?.recoveryRequired === true
                ? endpoint.atomicTransformCommands : null],
        ['endpoint.projectileCapture',
            findProjectileCaptureOwnedFailure(endpoint.projectileCapture)],
        ['endpoint.abilitySubjectSnapshots',
            endpoint.abilitySubjectSnapshots?.requiresRecovery === true
                ? endpoint.abilitySubjectSnapshots : null],
        ['endpoint.actorPayloadMaterializations',
            endpoint.actorPayloadMaterializations?.requiresRecovery === true
                ? endpoint.actorPayloadMaterializations : null],
        ['endpoint.backend', endpoint.backend?.gpu?.failure
            ?? endpoint.backend?.failure ?? null],
        ['abilityRuntime', object.abilityRuntime?.failure
            ?? (object.abilityRuntime?.recoveryRequired === true
                ? object.abilityRuntime : null)],
        ['actorPayloadMaterializer', object.actorPayloadMaterializer?.failure
            ?? (object.actorPayloadMaterializer?.recoveryRequired === true
                ? object.actorPayloadMaterializer : null)],
        ['bountyReward', object.bountyReward?.failure
            ?? (object.bountyReward?.recoveryRequired === true
                ? object.bountyReward : null)],
        ['hostileAttack', object.hostileAttack?.failure],
        ['coreImpact', object.coreImpact?.cleanupFailure
            ?? object.coreImpact?.failure ?? null],
        ['pentagonEffect', object.pentagonEffect?.failure],
        ['formation', object.formation?.failure],
        ['jorang', object.jorang?.failure],
        ['projectileCaptureDirector', object.projectileCapture?.failure],
        ['corkRouteClosure', object.corkRouteClosure?.failure]
    ];
    for (const [domain, detail] of candidates) {
        if (detail !== null && detail !== undefined && detail !== false) {
            return { domain, detail };
        }
    }
    return {
        domain: 'game-object-system',
        detail: {
            endpointRecoveryRequired: endpoint.recoveryRequired === true,
            directorRecoveryRequired: {
                hostileAttack: object.hostileAttack?.recoveryRequired === true,
                coreImpact: object.coreImpact?.recoveryRequired === true,
                pentagonEffect: object.pentagonEffect?.recoveryRequired === true,
                formation: object.formation?.recoveryRequired === true,
                jorang: object.jorang?.recoveryRequired === true,
                projectileCapture:
                    object.projectileCapture?.recoveryRequired === true,
                corkRouteClosure:
                    object.corkRouteClosure?.recoveryRequired === true,
                abilityRuntime:
                    object.abilityRuntime?.recoveryRequired === true,
                actorPayloadMaterializer:
                    object.actorPayloadMaterializer?.recoveryRequired === true,
                bountyReward:
                    object.bountyReward?.recoveryRequired === true
            },
            gpuRecovery: object.gpuRecovery ?? null
        }
    };
}

/**
 * GPU world 교체 전에 기존 endpoint/director 상태를 plain snapshot으로 보존합니다.
 * @param {{gameSystem:object,mapId:string|null,sceneRecovery:object,deviceGeneration:number}} input
 * @returns {object} 파일 기록 가능한 진단입니다.
 */
export function captureGpuWorldRecoveryDiagnostic(input) {
    const gameSystem = input.gameSystem;
    const objectSystem = safeRead(() => gameSystem.getObjectSystem());
    const diagnostic = clonePlain({
        schemaVersion: RECOVERY_LOG_SCHEMA_VERSION,
        event: 'gpu-world-safe-boundary-reset',
        capturedAt: new Date().toISOString(),
        mapId: input.mapId ?? null,
        deviceGeneration: input.deviceGeneration,
        fixedTick: safeRead(() => gameSystem.getFixedTick()),
        sceneRecovery: input.sceneRecovery,
        endpoint: safeRead(() => (
            gameSystem.getGpuSimulationEndpoint().getStatus()
        )),
        object: {
            wave: safeRead(() => objectSystem.getEnemyWaveStatus()),
            towerCombat: safeRead(() => objectSystem.getTowerCombatStatus()),
            hostileAttack: safeRead(() => objectSystem.getHostileAttackStatus()),
            coreImpact: safeRead(() => objectSystem.getCoreImpactStatus()),
            pentagonEffect: safeRead(() => objectSystem.getPentagonEffectStatus()),
            formation: safeRead(() => objectSystem.getFormationRuntimeStatus()),
            jorang: safeRead(() => objectSystem.getJorangSplitLineageStatus()),
            projectileCapture:
                safeRead(() => objectSystem.getProjectileCaptureStatus()),
            corkRouteClosure:
                safeRead(() => objectSystem.getCorkRouteClosureStatus()),
            abilityRuntime:
                safeRead(() => objectSystem.getAbilityRuntimeStatus()),
            actorPayloadMaterializer:
                safeRead(() => objectSystem.getActorPayloadMaterializerStatus()),
            bountyReward:
                safeRead(() => objectSystem.getBountyRewardStatus()),
            gpuRecovery:
                safeRead(() => objectSystem.getGpuRecoveryStatus()),
            terminal: safeRead(() => objectSystem.getTerminalStatus()),
            gpuWorldActors: safeRead(() => objectSystem.getGpuWorldActorStatus())
        }
    });
    return Object.freeze({
        ...diagnostic,
        cause: clonePlain(findGpuWorldRecoveryCause(diagnostic))
    });
}

function loadNodeRuntime(overrides = {}) {
    const processRef = overrides.process ?? globalThis.process ?? null;
    const getBuiltinModule = typeof processRef?.getBuiltinModule === 'function'
        ? processRef.getBuiltinModule.bind(processRef)
        : null;
    const requireRef = overrides.require ?? globalThis.require ?? null;
    const load = (specifier) => {
        if (getBuiltinModule) {
            return getBuiltinModule(specifier);
        }
        return typeof requireRef === 'function' ? requireRef(specifier) : null;
    };
    return {
        fs: overrides.fs ?? load('node:fs'),
        path: overrides.path ?? load('node:path'),
        process: processRef
    };
}

function resolveProjectDirectory(runtime, explicitRoot) {
    const { fs, path, process: processRef } = runtime;
    const candidates = [
        explicitRoot,
        safeRead(() => processRef?.cwd?.()),
        safeRead(() => processRef?.execPath
            ? path.dirname(processRef.execPath) : null)
    ].filter((value) => typeof value === 'string' && value.length > 0);
    for (const candidate of candidates) {
        if (fs.existsSync(path.join(candidate, 'game'))) {
            return candidate;
        }
        const nestedProject = path.join(candidate, 'project');
        if (fs.existsSync(path.join(nestedProject, 'game'))) {
            return nestedProject;
        }
    }
    return null;
}

function timestampForFile(value) {
    return value.replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
}

/**
 * 성공한 GPU world reset 진단을 project/logs에 동기 기록합니다.
 * 기록 실패는 게임 loop로 전파하지 않습니다.
 * @param {object} diagnostic - captureGpuWorldRecoveryDiagnostic 결과입니다.
 * @param {{rootDirectory?:string,fs?:object,path?:object,process?:object,require?:Function}} [options]
 * @returns {{written:boolean,path:string|null,error:string|null}} 기록 결과입니다.
 */
export function writeGpuWorldRecoveryLog(diagnostic, options = {}) {
    try {
        const runtime = loadNodeRuntime(options);
        if (!runtime.fs || !runtime.path || !runtime.process) {
            return Object.freeze({
                written: false,
                path: null,
                error: 'node-runtime-unavailable'
            });
        }
        const projectDirectory = resolveProjectDirectory(
            runtime,
            options.rootDirectory
        );
        if (!projectDirectory) {
            return Object.freeze({
                written: false,
                path: null,
                error: 'project-directory-unresolved'
            });
        }
        const logDirectory = runtime.path.join(projectDirectory, 'logs');
        runtime.fs.mkdirSync(logDirectory, { recursive: true });
        const capturedAt = typeof diagnostic?.capturedAt === 'string'
            ? diagnostic.capturedAt
            : new Date().toISOString();
        const stem = `reset_${timestampForFile(capturedAt)}`;
        const body = [
            'CirVivor GPU world reset diagnostic',
            `capturedAt=${capturedAt}`,
            `cause=${diagnostic?.cause?.domain ?? 'unknown'}`,
            '',
            JSON.stringify(diagnostic, null, 2),
            ''
        ].join('\n');
        for (let attempt = 0; attempt < 100; attempt++) {
            const suffix = attempt === 0 ? '' : `_${attempt}`;
            const filePath = runtime.path.join(
                logDirectory,
                `${stem}${suffix}.txt`
            );
            try {
                runtime.fs.writeFileSync(filePath, body, {
                    encoding: 'utf8',
                    flag: 'wx'
                });
                return Object.freeze({ written: true, path: filePath, error: null });
            } catch (error) {
                if (error?.code === 'EEXIST') {
                    continue;
                }
                throw error;
            }
        }
        return Object.freeze({
            written: false,
            path: null,
            error: 'reset-log-name-capacity'
        });
    } catch (error) {
        console.error('GPU world reset log write failed:', error);
        return Object.freeze({
            written: false,
            path: null,
            error: String(error?.message ?? error)
        });
    }
}

export const GPU_WORLD_RECOVERY_LOG_PORT = Object.freeze({
    capture: captureGpuWorldRecoveryDiagnostic,
    write: writeGpuWorldRecoveryLog
});
