/**
 * 명령 타입에 맞는 handler를 찾아 실행합니다.
 * @param {object|null|undefined} command - 적용할 명령입니다.
 * @param {Record<string, Function>} commandHandlers - 명령 타입별 handler입니다.
 * @returns {boolean}
 */
function dispatchGameSceneCommand(command, commandHandlers) {
    if (!command || typeof command.type !== 'string') {
        return false;
    }

    const handler = commandHandlers?.[command.type];
    if (typeof handler !== 'function') {
        return false;
    }

    handler(command);
    return true;
}

/**
 * 게임 씬 시뮬레이션 명령 목록을 순서대로 적용합니다.
 * @param {object[]} [commands=[]] - 적용할 명령 목록입니다.
 * @param {Record<string, Function>} commandHandlers - 명령 타입별 handler입니다.
 */
export function applyGameSceneSimulationCommands(commands = [], commandHandlers = {}) {
    if (!Array.isArray(commands) || commands.length === 0) {
        return;
    }

    for (let i = 0; i < commands.length; i++) {
        dispatchGameSceneCommand(commands[i], commandHandlers);
    }
}
