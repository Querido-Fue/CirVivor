let simulationCommandQueueInstance = null;

/**
 * @class SimulationCommandQueue
 * @description 씬과 UI가 발행한 시뮬레이션 명령을 프레임 경계에서 수집/배달하는 큐입니다.
 */
export class SimulationCommandQueue {
    constructor() {
        simulationCommandQueueInstance = this;
        this.commands = [];
    }

    /**
     * 유효한 시뮬레이션 명령 하나를 큐에 적재합니다.
     * @param {{type?: string}|null|undefined} command
     * @returns {boolean}
     */
    enqueue(command) {
        if (!command || typeof command.type !== 'string' || command.type.length === 0) {
            return false;
        }

        this.commands.push(command);
        return true;
    }

    /**
     * 적재된 명령을 모두 반환하고 큐를 비웁니다.
     * @returns {object[]}
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
        new SimulationCommandQueue();
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
 * 명령 여러 개를 큐에 추가합니다.
 * @param {object[]} [commands=[]]
 * @returns {number}
 */
export function enqueueSimulationCommands(commands = []) {
    if (!Array.isArray(commands) || commands.length === 0) {
        return 0;
    }

    let enqueuedCount = 0;
    for (let i = 0; i < commands.length; i++) {
        if (enqueueSimulationCommand(commands[i])) {
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
