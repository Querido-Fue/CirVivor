let simulationCommandQueueInstance = null;

/**
 * 큐에 적재 가능한 시뮬레이션 명령인지 확인합니다.
 * @param {unknown} command
 * @returns {boolean}
 */
function isSimulationCommand(command) {
    return Boolean(command && typeof command.type === 'string' && command.type.length > 0);
}

/**
 * @class SimulationCommandQueue
 * @description 씬과 UI가 발행한 시뮬레이션 명령을 프레임 경계에서 수집/배달하는 큐입니다.
 */
export class SimulationCommandQueue {
    constructor() {
        this.commands = [];
        simulationCommandQueueInstance = this;
    }

    /**
     * 유효한 시뮬레이션 명령 하나를 큐에 적재합니다.
     * @param {{type?: string}|null|undefined} command
     * @returns {boolean}
     */
    enqueue(command) {
        if (!isSimulationCommand(command)) {
            return false;
        }

        this.commands.push(command);
        return true;
    }

    /**
     * 적재 순서와 element identity를 보존한 fresh 배열을 반환하고 내부 큐 배열은 제자리에서 비웁니다.
     * 빈 큐도 호출마다 새 mutable 배열을 반환합니다. 복사 또는 큐 축소 오류는 그대로 전파하며 rollback하지 않습니다.
     * @returns {object[]} 호출자가 소유하는 fresh 명령 배열입니다.
     */
    drain() {
        if (this.commands.length === 0) {
            return [];
        }

        const drained = this.commands.slice();
        this.commands.length = 0;
        return drained;
    }

    /**
     * 큐를 강제로 비웁니다.
     */
    clear() {
        this.commands.length = 0;
    }
}

/**
 * 시뮬레이션 명령 큐 싱글톤을 생성 또는 반환합니다.
 * @returns {SimulationCommandQueue}
 */
export function ensureSimulationCommandQueue() {
    if (!simulationCommandQueueInstance) {
        simulationCommandQueueInstance = new SimulationCommandQueue();
    }
    return simulationCommandQueueInstance;
}

/**
 * 명령 하나를 큐에 추가합니다.
 * @param {{type?: string}|null|undefined} command
 * @returns {boolean}
 */
export function enqueueSimulationCommand(command) {
    return ensureSimulationCommandQueue().enqueue(command);
}

/**
 * 배열의 유효한 명령을 index 순서대로 같은 객체 identity로 큐에 추가합니다.
 * 배열이 아니거나 비어 있으면 0을 반환하고, 유효하지 않은 항목은 건너뜁니다.
 * 판정 또는 적재 중 예외는 그대로 전파되며 그 전에 추가된 명령은 rollback하지 않습니다.
 * @param {object[]} [commands=[]] - 순서대로 적재할 명령 배열입니다.
 * @returns {number} 성공적으로 적재한 명령 수입니다.
 */
export function enqueueSimulationCommands(commands = []) {
    if (!Array.isArray(commands) || commands.length === 0) {
        return 0;
    }

    let enqueuedCount = 0;
    const queue = ensureSimulationCommandQueue();
    for (let i = 0; i < commands.length; i++) {
        if (queue.enqueue(commands[i])) {
            enqueuedCount++;
        }
    }

    return enqueuedCount;
}

/**
 * 현재 프레임에 적재된 명령을 모두 꺼냅니다.
 * @returns {object[]}
 */
export function drainSimulationCommands() {
    return ensureSimulationCommandQueue().drain();
}

/**
 * 대기 중인 명령을 모두 폐기합니다.
 */
export function clearSimulationCommands() {
    ensureSimulationCommandQueue().clear();
}
