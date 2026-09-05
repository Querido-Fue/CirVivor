import { spawn } from 'node:child_process';

const DEFAULT_TERMINATION_GRACE_MS = 10_000;
const TASKKILL_TIMEOUT_MS = 5_000;
const TIMEOUT_SENTINEL = Symbol('nw-child-timeout');

function requirePositiveTimeout(value, label) {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${label}은 양의 safe integer여야 합니다.`);
    }
    return value;
}

function waitForExit(child) {
    if (!child || typeof child.once !== 'function') {
        throw new TypeError('종료를 기다릴 ChildProcess가 필요합니다.');
    }
    if (child.exitCode !== null || child.signalCode !== null) {
        return Promise.resolve(Object.freeze({
            exitCode: child.exitCode,
            signal: child.signalCode
        }));
    }
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            child.off('error', onError);
            child.off('exit', onExit);
        };
        const onError = (error) => {
            cleanup();
            reject(error);
        };
        const onExit = (exitCode, signal) => {
            cleanup();
            resolve(Object.freeze({ exitCode, signal }));
        };
        child.once('error', onError);
        child.once('exit', onExit);
    });
}

function waitForTimeout(timeoutMs, sentinel = TIMEOUT_SENTINEL) {
    let timeoutId = null;
    const promise = new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve(sentinel), timeoutMs);
    });
    return Object.freeze({
        promise,
        cancel() {
            if (timeoutId !== null) clearTimeout(timeoutId);
            timeoutId = null;
        }
    });
}

async function terminateWindowsProcessTree(child) {
    if (!Number.isSafeInteger(child.pid) || child.pid <= 0) {
        child.kill();
        return 'child-kill-fallback';
    }
    const killer = spawn('taskkill.exe', [
        '/pid',
        String(child.pid),
        '/t',
        '/f'
    ], {
        shell: false,
        stdio: 'ignore',
        windowsHide: true
    });
    try {
        const killerTimeout = waitForTimeout(TASKKILL_TIMEOUT_MS);
        let result;
        try {
            result = await Promise.race([
                waitForExit(killer),
                killerTimeout.promise
            ]);
        } finally {
            killerTimeout.cancel();
        }
        if (result !== TIMEOUT_SENTINEL && result.exitCode === 0) {
            return 'taskkill-tree';
        }
    } catch {
        // taskkill 자체가 시작되지 않으면 exact child 종료로 축소합니다.
    }
    if (killer.exitCode === null && killer.signalCode === null) {
        killer.kill();
    }
    child.kill();
    return 'child-kill-fallback';
}

async function terminateProcessTree(child) {
    if (child.exitCode !== null || child.signalCode !== null) {
        return 'already-exited';
    }
    if (process.platform === 'win32') {
        return terminateWindowsProcessTree(child);
    }
    child.kill('SIGKILL');
    return 'sigkill';
}

/**
 * NW 하네스 child와 모든 renderer descendant를 제한시간 안에 종료합니다.
 * timeout은 테스트 실패지만 process tree 정리는 완료된 뒤에만 반환합니다.
 * @param {import('node:child_process').ChildProcess} child
 * @param {number} timeoutMs
 * @param {{terminationGraceMs?:number}} [options]
 * @returns {Promise<{timedOut:boolean,exit:{exitCode:number|null,signal:string|null},terminationMethod:string|null}>}
 */
export async function waitForChildWithTimeout(
    child,
    timeoutMs,
    options = {}
) {
    const limit = requirePositiveTimeout(timeoutMs, 'child timeoutMs');
    const terminationGraceMs = requirePositiveTimeout(
        options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS,
        'child terminationGraceMs'
    );
    const exitPromise = waitForExit(child);
    const executionTimeout = waitForTimeout(limit);
    let first;
    try {
        first = await Promise.race([
            exitPromise,
            executionTimeout.promise
        ]);
    } finally {
        executionTimeout.cancel();
    }
    if (first !== TIMEOUT_SENTINEL) {
        return Object.freeze({
            timedOut: false,
            exit: first,
            terminationMethod: null
        });
    }

    const terminationMethod = await terminateProcessTree(child);
    const terminationTimeout = waitForTimeout(
        terminationGraceMs,
        TIMEOUT_SENTINEL
    );
    let exit;
    try {
        exit = await Promise.race([
            exitPromise,
            terminationTimeout.promise
        ]);
    } finally {
        terminationTimeout.cancel();
    }
    if (exit === TIMEOUT_SENTINEL) {
        throw new Error(
            `NW child process tree 종료 제한시간 초과: pid=${child.pid}, grace=${terminationGraceMs}ms`
        );
    }
    return Object.freeze({
        timedOut: true,
        exit,
        terminationMethod
    });
}
