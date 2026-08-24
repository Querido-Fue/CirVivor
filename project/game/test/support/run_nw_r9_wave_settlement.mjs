import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    R9_GPU_RECOVERY_MATRIX_STATES
} from '../../script/module/ingame/flow/r9_recovery_continuity_contract.js';
import { validateR8Result } from './run_nw_r8_shop_editor.mjs';
import { waitForChildWithTimeout } from './nw_child_process_guard.mjs';

const CHILD_TIMEOUT_MS = 600_000;
const REQUIRED_STORAGE_MAXIMUM = 9;

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function collectStream(stream) {
    let output = '';
    stream?.setEncoding('utf8');
    stream?.on('data', (chunk) => {
        output += chunk;
    });
    return () => output;
}

function parseJsonSuffix(output, label) {
    const source = output.trim();
    for (let index = 0; index < source.length; index++) {
        if (source[index] !== '{') continue;
        try {
            return JSON.parse(source.slice(index));
        } catch {
            // NW diagnostic prefix 뒤의 최종 JSON root까지 계속 탐색합니다.
        }
    }
    throw new Error(`${label} 결과 JSON을 찾을 수 없습니다.`);
}

async function runChild(projectDirectory, scriptName, label, env = {}) {
    const child = spawn(
        process.execPath,
        [path.join('game', 'test', 'support', scriptName)],
        {
            cwd: projectDirectory,
            env: { ...process.env, ...env },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true
        }
    );
    const stdout = collectStream(child.stdout);
    const stderr = collectStream(child.stderr);
    const processResult = await waitForChildWithTimeout(
        child,
        CHILD_TIMEOUT_MS
    );
    const exit = processResult.exit;
    if (processResult.timedOut || exit.exitCode !== 0 || exit.signal !== null) {
        throw new Error([
            `${label} child gate 실패`,
            `timeout=${processResult.timedOut}`,
            `exit=${exit.exitCode}`,
            `signal=${exit.signal}`,
            stderr().slice(-4_000),
            stdout().slice(-4_000)
        ].join('\n'));
    }
    return parseJsonSuffix(stdout(), label);
}

function validateMultiWave(result) {
    const fixture = result?.r9MultiWave;
    assert(result?.status === 'pass', 'R9 multi-wave status가 pass가 아닙니다.');
    assert(fixture?.scenario === 'r9-three-wave-progression-actual-webgpu',
        'R9 multi-wave actual scenario가 다릅니다.');
    assert(fixture.waveCompletedFactCount === 3
        && fixture.normalWaveCompletedFactCount === 2
        && fixture.overtimeWaveCompletedFactCount === 1,
    'R9 normal/overtime WaveCompleted matrix가 다릅니다.');
    assert(fixture.shopOpenCount === 3
        && fixture.shopOpenReplayCount === 3
        && fixture.shopContinueCount === 3
        && fixture.continueReplayCount === 3,
    'R9 Shop open/Continue exact replay matrix가 다릅니다.');
    assert(fixture.finalState === 'MAP_CLEAR_READY'
        && fixture.finalContinueState === 'MAP_CLEAR_READY'
        && fixture.mapClearFactCount === 1
        && fixture.nextDirectorCreatedAfterFinal === false,
    'R9 final MapClearReady matrix가 다릅니다.');
    assert(fixture.sameGpuEndpoint === true
        && fixture.noCloseBoundarySpawn === true
        && fixture.preservedOwnerIdentity === true,
    'R9 next-Wave same-world boundary가 다릅니다.');
    assert(fixture.storageMaximum <= REQUIRED_STORAGE_MAXIMUM
        && fixture.newProductionStorageBindingCount === 0
        && fixture.extraPerSubjectFullBodyReadbackCount === 0
        && fixture.partialPublicationCount === 0
        && fixture.gridOverflowCount === 0
        && fixture.protocolFailureCount === 0
        && fixture.recoveryFailureCount === 0
        && fixture.recoveryRequired === false,
    'R9 multi-wave GPU ABI/pressure 계약이 다릅니다.');
    assert(result.uncapturedErrorCount === 0
        && result.deviceLostReason === 'destroyed',
    'R9 multi-wave WebGPU teardown가 다릅니다.');
    return fixture;
}

function validateOvertime(result) {
    const fixture = result?.r9OvertimePressure;
    assert(result?.status === 'pass', 'R9 Overtime status가 pass가 아닙니다.');
    assert(fixture?.scenario === 'r9-overtime-pressure-actual-webgpu',
        'R9 Overtime actual scenario가 다릅니다.');
    assert(fixture.firstPulseOrdinal === 1
        && fixture.secondPulseOrdinal === 2
        && fixture.finalPulseSuppressed === true
        && fixture.finalWaveState === 'CLEAR_CANDIDATE',
    'R9 Overtime clear/pulse matrix가 다릅니다.');
    assert(fixture.lethal?.defeated === true
        && fixture.lethal.coreDepleted === true
        && fixture.lethal.runFailedFactCount === 1
        && fixture.lethal.waveFailedFactCount === 1
        && fixture.lethal.waveState === 'RUN_DEFEATED',
    'R9 Overtime lethal matrix가 다릅니다.');
    assert(fixture.storageMaximum <= REQUIRED_STORAGE_MAXIMUM
        && fixture.recoveryRequired === false
        && result.uncapturedErrorCount === 0
        && result.deviceLostReason === 'destroyed',
    'R9 Overtime GPU/teardown 계약이 다릅니다.');
    return fixture;
}

function validateShopRecovery(result) {
    validateR8Result(result);
    const fixture = result.r8ShopEditor;
    assert(result.performance?.productionExposure === 'APPROVED',
        'Post-R8 production Shop exposure가 APPROVED가 아닙니다.');
    assert(fixture.phase?.shopFixedSubmitDelta === 0
        && fixture.phase?.recoveryShopFixedSubmitDelta === 0,
    'Shop/recovery pause 중 fixed submit이 발생했습니다.');
    assert(fixture.recovery?.statePreserved === true
        && fixture.recovery?.oldDestroyed === true
        && fixture.recovery?.rehydratedTowerCount === 1,
    'Actual GPU recovery continuity가 다릅니다.');
    return fixture;
}

export async function runR9WaveSettlementAcceptance() {
    if (process.platform !== 'win32') {
        throw new Error(
            `R9 NW WebGPU 검사는 Windows만 지원합니다: ${process.platform}`
        );
    }
    const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
    const projectDirectory = path.resolve(scriptDirectory, '..', '..', '..');
    assert(R9_GPU_RECOVERY_MATRIX_STATES.length === 7,
        'R9 recovery phase matrix가 7개가 아닙니다.');

    const multiResult = await runChild(
        projectDirectory,
        'run_nw_r9_multi_wave.mjs',
        'R9 multi-wave'
    );
    const overtimeResult = await runChild(
        projectDirectory,
        'run_nw_r9_overtime_pressure.mjs',
        'R9 Overtime'
    );
    const shopResult = await runChild(
        projectDirectory,
        'run_nw_r8_shop_editor.mjs',
        'Post-R8 Shop/recovery',
        { CIRVIVOR_R8_SKIP_REGRESSION_CHILDREN: '1' }
    );
    const multi = validateMultiWave(multiResult);
    const overtime = validateOvertime(overtimeResult);
    const shop = validateShopRecovery(shopResult);
    const storageMaximum = Math.max(
        multi.storageMaximum,
        overtime.storageMaximum,
        shop.storageMaximum
    );
    const result = Object.freeze({
        status: 'pass',
        scenario: 'r9-wave-settlement-cumulative-actual-webgpu',
        functional: Object.freeze({
            normalClearCount: multi.normalWaveCompletedFactCount,
            overtimeClearCount: multi.overtimeWaveCompletedFactCount,
            overtimeLethalExact: overtime.lethal.defeated === true,
            shopOpenCount: multi.shopOpenCount,
            shopContinueCount: multi.shopContinueCount,
            continueReplayCount: multi.continueReplayCount,
            nextWaveFirstSpawnFixedTicks: multi.firstSpawnFixedTicks,
            finalMapClearFactCount: multi.mapClearFactCount
        }),
        recovery: Object.freeze({
            r9PhaseMatrixStateCount:
                R9_GPU_RECOVERY_MATRIX_STATES.length,
            actualGpuStatePreserved: shop.recovery.statePreserved,
            oldGpuWorldDestroyed: shop.recovery.oldDestroyed,
            automaticRestartCount: 0
        }),
        scheduler: Object.freeze({
            shopFixedSubmitDelta: shop.phase.shopFixedSubmitDelta,
            recoveryShopFixedSubmitDelta:
                shop.phase.recoveryShopFixedSubmitDelta,
            nextWaveCloseBoundarySpawnCount: multi.noCloseBoundarySpawn ? 0 : 1
        }),
        gpu: Object.freeze({
            storageMaximum,
            newProductionStorageBindingCount:
                multi.newProductionStorageBindingCount,
            extraPerSubjectFullBodyReadbackCount: Math.max(
                multi.extraPerSubjectFullBodyReadbackCount,
                shop.extraPerSubjectReadbackCount
            ),
            partialPublicationCount: Math.max(
                multi.partialPublicationCount,
                shop.partialPublicationCount
            ),
            gridOverflowCount: Math.max(
                multi.gridOverflowCount,
                shop.gridOverflowCount
            ),
            protocolRecoveryFailureCount: Math.max(
                multi.protocolFailureCount,
                multi.recoveryFailureCount,
                shop.protocolFailureCount,
                shop.recoveryFailureCount
            ),
            uncapturedErrorCount: Math.max(
                multiResult.uncapturedErrorCount,
                overtimeResult.uncapturedErrorCount,
                shopResult.uncapturedErrorCount
            ),
            deviceLostReasons: Object.freeze([
                multiResult.deviceLostReason,
                overtimeResult.deviceLostReason,
                shopResult.deviceLostReason
            ])
        }),
        productionShopExposure:
            shopResult.performance.productionExposure
    });
    assert(result.gpu.storageMaximum <= REQUIRED_STORAGE_MAXIMUM
        && result.gpu.newProductionStorageBindingCount === 0
        && result.gpu.extraPerSubjectFullBodyReadbackCount === 0
        && result.gpu.partialPublicationCount === 0
        && result.gpu.gridOverflowCount === 0
        && result.gpu.protocolRecoveryFailureCount === 0
        && result.gpu.uncapturedErrorCount === 0
        && result.gpu.deviceLostReasons.every((reason) => (
            reason === 'destroyed'
        )),
    'R9 cumulative GPU acceptance가 실패했습니다.');
    console.log(JSON.stringify(result, null, 2));
    return result;
}

const isDirectExecution = process.argv[1]
    && path.resolve(process.argv[1])
        === path.resolve(fileURLToPath(import.meta.url));
if (isDirectExecution) {
    runR9WaveSettlementAcceptance().catch((error) => {
        console.error(error?.stack ?? error);
        process.exitCode = 1;
    });
}
