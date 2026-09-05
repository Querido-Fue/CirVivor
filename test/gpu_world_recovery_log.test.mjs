import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { readFile as readTextFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    captureGpuWorldRecoveryDiagnostic,
    findGpuWorldRecoveryCause,
    writeGpuWorldRecoveryLog
} = await loadGameModule('scene/game/gpu_world_recovery_log.js');
const { GPU_PROJECTILE_CAPTURE_TICK_STATUS } = await loadGameModule(
    'ingame/physics/gpu/gpu_projectile_capture_runtime_abi.js'
);

function createDiagnosticGameSystem() {
    const objectSystem = Object.freeze({
        getEnemyWaveStatus: () => ({ remaining: 17 }),
        getTowerCombatStatus: () => ({ currentHp: 23 }),
        getHostileAttackStatus: () => ({ recoveryRequired: false }),
        getCoreImpactStatus: () => ({ recoveryRequired: false }),
        getPentagonEffectStatus: () => ({ recoveryRequired: false }),
        getFormationRuntimeStatus: () => ({
            recoveryRequired: true,
            failure: { stage: 'formation-transform', reason: 'fixture' }
        }),
        getJorangSplitLineageStatus: () => ({ recoveryRequired: false }),
        getProjectileCaptureStatus: () => ({ recoveryRequired: false }),
        getCorkRouteClosureStatus: () => ({ recoveryRequired: false }),
        getAbilityRuntimeStatus: () => ({ recoveryRequired: false }),
        getActorPayloadMaterializerStatus: () => ({ recoveryRequired: false }),
        getBountyRewardStatus: () => ({ recoveryRequired: false }),
        getGpuRecoveryStatus: () => ({
            recoveryRequired: true,
            paused: true,
            stage: 'formation-completion-observe'
        }),
        getTerminalStatus: () => ({ state: 'open' }),
        getGpuWorldActorStatus: () => ({ towerHandle: { entityId: 2, incarnation: 1 } })
    });
    return Object.freeze({
        getFixedTick: () => 41,
        getObjectSystem: () => objectSystem,
        getGpuSimulationEndpoint: () => Object.freeze({
            getStatus: () => Object.freeze({
                recoveryRequired: true,
                events: { protocolFailure: null },
                formationCommands: {
                    recoveryRequired: true,
                    failure: { reason: 'fixture' }
                }
            })
        })
    });
}

test('GPU world reset 진단은 교체 전 endpoint/director 원인을 plain snapshot으로 보존한다', () => {
    const diagnostic = captureGpuWorldRecoveryDiagnostic({
        gameSystem: createDiagnosticGameSystem(),
        mapId: 'performance_serpentine_02',
        deviceGeneration: 7,
        sceneRecovery: { restartCount: 2, restartGeneration: null }
    });
    assert.equal(diagnostic.schemaVersion, 1);
    assert.equal(diagnostic.mapId, 'performance_serpentine_02');
    assert.equal(diagnostic.fixedTick, 41);
    assert.equal(diagnostic.deviceGeneration, 7);
    assert.equal(diagnostic.cause.domain, 'endpoint.formationCommands');
    assert.equal(diagnostic.object.formation.failure.reason, 'fixture');
    assert.equal(
        diagnostic.object.gpuRecovery.stage,
        'formation-completion-observe'
    );
    assert.deepEqual(findGpuWorldRecoveryCause({
        endpoint: {},
        object: { hostileAttack: { failure: { reason: 'late-source' } } }
    }), {
        domain: 'hostileAttack',
        detail: { reason: 'late-source' }
    });
});

test('R3 Ability/Actor/Bounty 복구 원인은 generic game-object fallback 전에 분류된다', () => {
    assert.deepEqual(findGpuWorldRecoveryCause({
        endpoint: {},
        object: {
            abilityRuntime: {
                recoveryRequired: true,
                failure: {
                    code: 'ability-subject-protocol-rejected'
                }
            }
        }
    }), {
        domain: 'abilityRuntime',
        detail: {
            code: 'ability-subject-protocol-rejected'
        }
    });
});

test('정상 projectile capture 진행/완료 상태는 실제 backend 복구 원인을 가리지 않는다', () => {
    const failure = { stage: 'fixed-submit', reason: 'fixture' };
    for (const runtimeStatus of [
        GPU_PROJECTILE_CAPTURE_TICK_STATUS.RESET,
        GPU_PROJECTILE_CAPTURE_TICK_STATUS.SEALED,
        GPU_PROJECTILE_CAPTURE_TICK_STATUS.COMPLETE
    ]) {
        const projectileCapture = { runtimeStatus, errorFlags: 0 };
        assert.deepEqual(findGpuWorldRecoveryCause({
            endpoint: { projectileCapture, backend: { gpu: { failure } } }
        }), { domain: 'endpoint.backend', detail: failure });
        assert.equal(findGpuWorldRecoveryCause({
            endpoint: { projectileCapture }
        }).domain, 'game-object-system');
    }
});

test('projectile capture의 실제 protocol/capacity 실패는 복구 원인으로 보존한다', () => {
    for (const status of [
        { runtimeStatus: GPU_PROJECTILE_CAPTURE_TICK_STATUS.REJECTED },
        { runtimeStatus: GPU_PROJECTILE_CAPTURE_TICK_STATUS.PROTOCOL_FAILURE },
        { runtimeStatus: GPU_PROJECTILE_CAPTURE_TICK_STATUS.COMPLETE, errorFlags: 1 },
        { capacityRejected: true },
        { retryableCapacityRejected: true },
        { capacityRejectionFlags: 1 },
        { failure: { stage: 'projectile-capture-observe' } }
    ]) {
        assert.deepEqual(findGpuWorldRecoveryCause({
            endpoint: { projectileCapture: status }
        }), { domain: 'endpoint.projectileCapture', detail: status });
    }
});

test('복구 snapshot은 공유 handle/failure를 보존하고 실제 순환 참조만 생략한다', () => {
    const handle = { entityId: 604, incarnation: 93 };
    const failure = { stage: 'completion-contract', targetHandle: handle };
    const cycle = { handle };
    cycle.self = cycle;
    const system = createDiagnosticGameSystem();
    const diagnostic = captureGpuWorldRecoveryDiagnostic({
        gameSystem: {
            ...system,
            getGpuSimulationEndpoint: () => ({
                getStatus: () => ({
                    targetHandle: handle,
                    fixedCommands: { recoveryRequired: true, failure },
                    cycle
                })
            }),
            getObjectSystem: () => ({
                ...system.getObjectSystem(),
                getHostileAttackStatus: () => ({ recoveryRequired: true, failure }),
                getGpuWorldActorStatus: () => ({ towerHandle: handle })
            })
        }
    });
    assert.deepEqual(diagnostic.endpoint.targetHandle, handle);
    assert.deepEqual(diagnostic.endpoint.fixedCommands.failure, failure);
    assert.deepEqual(diagnostic.object.hostileAttack.failure, failure);
    assert.deepEqual(diagnostic.object.gpuWorldActors.towerHandle, handle);
    assert.deepEqual(diagnostic.cause.detail.failure, failure);
    assert.deepEqual(diagnostic.endpoint.cycle, { handle, self: '[Circular]' });
});

test('GPU world reset 파일은 project/logs에 충돌 없이 기록된다', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cirvivor-reset-log-'));
    try {
        await mkdir(path.join(root, 'game'));
        const diagnostic = Object.freeze({
            capturedAt: '2026-08-15T12:34:56.789Z',
            cause: Object.freeze({ domain: 'formation', detail: 'fixture' }),
            reset: Object.freeze({ succeeded: true, restartCount: 1 })
        });
        const runtime = {
            rootDirectory: root,
            fs,
            path,
            process
        };
        const first = writeGpuWorldRecoveryLog(diagnostic, runtime);
        const second = writeGpuWorldRecoveryLog(diagnostic, runtime);
        assert.equal(first.written, true);
        assert.equal(second.written, true);
        assert.notEqual(first.path, second.path);
        const files = (await readdir(path.join(root, 'logs'))).sort();
        assert.deepEqual(files, [
            'reset_2026-08-15_12-34-56-789.txt',
            'reset_2026-08-15_12-34-56-789_1.txt'
        ]);
        const content = await readFile(first.path, 'utf8');
        assert.match(content, /CirVivor GPU world reset diagnostic/);
        assert.match(content, /cause=formation/);
        assert.match(content, /"restartCount": 1/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('GameScene은 실제 reset 성공 뒤에만 진단 파일 포트를 호출한다', async () => {
    const source = await readTextFile(
        new URL('../project/game/script/module/scene/game/_game_scene.js', import.meta.url),
        'utf8'
    );
    const instances = [];
    class BaseSceneStub {
        constructor(sceneHandler) {
            this.sceneHandler = sceneHandler;
        }
    }
    class GameSystemStub {
        constructor(dependencies) {
            this.dependencies = dependencies;
            this.fixedTick = 9;
            this.recoveryRequired = true;
            instances.push(this);
        }

        enter() { return true; }
        fixedUpdate() { return false; }
        isEnemySimulationRecoveryRequired() { return this.recoveryRequired; }
        getFixedTick() { return this.fixedTick; }
        getObjectSystem() { return {}; }
        getGpuSimulationEndpoint() { return { getStatus: () => ({}) }; }
        restartGpuWorldAtSafeWaveBoundary() {
            this.dependencies.trace.push('restart');
            return this.dependencies.restartSucceeds;
        }
        destroy() {}
    }
    const context = vm.createContext({ console, Object });
    const module = new vm.SourceTextModule(source, {
        context,
        identifier: '_game_scene.recovery_log.js'
    });
    const modules = new Map([
        ['scene/_base_scene.js', new vm.SyntheticModule(
            ['BaseScene'],
            function initBaseScene() { this.setExport('BaseScene', BaseSceneStub); },
            { context }
        )],
        ['ingame/game_system.js', new vm.SyntheticModule(
            ['GameSystem'],
            function initGameSystem() { this.setExport('GameSystem', GameSystemStub); },
            { context }
        )],
        ['simulation/fixed_step_result_contract.js', new vm.SyntheticModule(
            ['FIXED_STEP_RESULT'],
            function initFixedStepResult() {
                this.setExport('FIXED_STEP_RESULT', Object.freeze({
                    COMPLETED: 'COMPLETED',
                    DEFERRED_BACKPRESSURE: 'DEFERRED_BACKPRESSURE',
                    INTENTIONAL_PAUSE: 'INTENTIONAL_PAUSE'
                }));
            },
            { context }
        )],
        ['./game_scene_dependency_factory.js', new vm.SyntheticModule(
            ['createGameSceneDependencies'],
            function initFactory() {
                this.setExport('createGameSceneDependencies', () => ({}));
            },
            { context }
        )]
    ]);
    await module.link((specifier) => modules.get(specifier));
    await module.evaluate();
    const { GameScene } = module.namespace;

    const trace = [];
    const dependencies = {
        trace,
        restartSucceeds: true,
        webGpuPlatformPort: {
            getState: () => ({ ready: true, deviceGeneration: 4 })
        },
        recoveryLogPort: {
            capture(input) {
                trace.push('capture');
                assert.equal(input.mapId, 'performance_serpentine_02');
                return Object.freeze({
                    capturedAt: '2026-08-15T00:00:00.000Z',
                    cause: Object.freeze({ domain: 'fixture' })
                });
            },
            write(record) {
                trace.push('write');
                assert.equal(record.reset.succeeded, true);
                assert.equal(record.reset.restartCount, 1);
            }
        }
    };
    const scene = new GameScene({}, {
        mapId: 'performance_serpentine_02',
        dependencies
    });
    assert.equal(scene.fixedUpdate(), false);
    assert.deepEqual(trace, ['capture', 'restart', 'write']);
    assert.equal(scene.getEnemyRecoveryStatus().restartCount, 1);

    const failedTrace = [];
    const failedScene = new GameScene({}, {
        dependencies: {
            trace: failedTrace,
            restartSucceeds: false,
            webGpuPlatformPort: {
                getState: () => ({ ready: true, deviceGeneration: 5 })
            },
            recoveryLogPort: {
                capture() {
                    failedTrace.push('capture');
                    return { capturedAt: '2026-08-15T00:00:00.000Z' };
                },
                write() { failedTrace.push('write'); }
            }
        }
    });
    assert.equal(failedScene.fixedUpdate(), false);
    assert.deepEqual(failedTrace, ['capture', 'restart']);
    assert.equal(failedScene.getEnemyRecoveryStatus().restartCount, 0);
    assert.equal(instances.length, 2);
});
