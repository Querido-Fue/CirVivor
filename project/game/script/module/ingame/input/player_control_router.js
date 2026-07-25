import {
    INPUT_DISPOSITIONS,
    PLAYER_CONTROL_CONTEXTS,
    assertPlayerControllable,
    isPlayerAction
} from '../contract/player_controllable_contract.js';

/**
 * 라우터 등록 항목을 우선순위와 등록 순서로 정렬합니다.
 * @param {{priority:number,sequence:number}} left - 왼쪽 항목입니다.
 * @param {{priority:number,sequence:number}} right - 오른쪽 항목입니다.
 * @returns {number} Array.sort 비교 결과입니다.
 */
function compareControlEntries(left, right) {
    return (right.priority - left.priority) || (left.sequence - right.sequence);
}

/**
 * @class PlayerControlRouter
 * @description PlayerAction을 활성 문맥의 IPlayerControllable 대상에 결정적으로 전달합니다.
 */
export class PlayerControlRouter {
    constructor() {
        this.entries = [];
        this.contextStack = [PLAYER_CONTROL_CONTEXTS.GAMEPLAY];
        this.nextSequence = 0;
        this.destroyed = false;
        this.dispatchContext = {
            activeContext: PLAYER_CONTROL_CONTEXTS.GAMEPLAY,
            contextStack: this.contextStack
        };
    }

    /**
     * 제어 대상을 등록하고 해제 토큰을 반환합니다.
     * 우선순위와 문맥은 등록 시점에 고정하여 hot path의 반복 계산을 피합니다.
     * @param {object} target - IPlayerControllable 구현입니다.
     * @returns {{dispose:()=>boolean}} 등록 해제 토큰입니다.
     */
    register(target) {
        if (this.destroyed) {
            throw new Error('파괴된 PlayerControlRouter에는 대상을 등록할 수 없습니다.');
        }
        assertPlayerControllable(target);
        if (this.entries.some((entry) => entry.target === target)) {
            throw new Error(`이미 등록된 제어 대상입니다: ${target.controlTargetId}`);
        }

        const rawPriority = Number(target.getInputPriority());
        const entry = {
            target,
            context: target.getControlContext(),
            priority: Number.isFinite(rawPriority) ? rawPriority : 0,
            sequence: this.nextSequence++
        };
        this.entries.push(entry);
        this.entries.sort(compareControlEntries);

        let disposed = false;
        return Object.freeze({
            dispose: () => {
                if (disposed) {
                    return false;
                }
                disposed = true;
                const index = this.entries.indexOf(entry);
                if (index < 0) {
                    return false;
                }
                this.entries.splice(index, 1);
                return true;
            }
        });
    }

    /**
     * 낮은 문맥부터 높은 문맥 순서의 활성 stack을 교체합니다.
     * @param {string[]} contexts - 활성 제어 문맥입니다.
     * @returns {void}
     */
    setContextStack(contexts) {
        const nextContexts = Array.isArray(contexts)
            ? contexts.filter((context, index, values) => {
                return typeof context === 'string'
                    && context.length > 0
                    && values.indexOf(context) === index;
            })
            : [];

        this.contextStack.length = 0;
        if (nextContexts.length === 0) {
            this.contextStack.push(PLAYER_CONTROL_CONTEXTS.GAMEPLAY);
            return;
        }
        this.contextStack.push(...nextContexts);
    }

    /**
     * 의미 입력을 높은 문맥부터 전달합니다.
     * CONSUMED가 반환되면 즉시 중단하고, HANDLED는 나머지 대상 전달을 허용합니다.
     * @param {object} action - 전달할 PlayerAction입니다.
     * @returns {string} INPUT_DISPOSITIONS 값입니다.
     */
    dispatch(action) {
        if (this.destroyed || !isPlayerAction(action)) {
            return INPUT_DISPOSITIONS.PASS;
        }

        let finalDisposition = INPUT_DISPOSITIONS.PASS;
        for (let contextIndex = this.contextStack.length - 1; contextIndex >= 0; contextIndex--) {
            const activeContext = this.contextStack[contextIndex];
            this.dispatchContext.activeContext = activeContext;

            for (let entryIndex = 0; entryIndex < this.entries.length; entryIndex++) {
                const entry = this.entries[entryIndex];
                if (entry.context !== activeContext || entry.target.isControlEnabled() !== true) {
                    continue;
                }

                const disposition = entry.target.handlePlayerAction(action, this.dispatchContext);
                if (disposition === INPUT_DISPOSITIONS.CONSUMED) {
                    return INPUT_DISPOSITIONS.CONSUMED;
                }
                if (disposition === INPUT_DISPOSITIONS.HANDLED) {
                    finalDisposition = INPUT_DISPOSITIONS.HANDLED;
                }
            }
        }
        return finalDisposition;
    }

    /**
     * 모든 등록과 문맥 상태를 해제합니다.
     * 반복 호출해도 안전합니다.
     * @returns {void}
     */
    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.entries.length = 0;
        this.contextStack.length = 0;
    }
}
