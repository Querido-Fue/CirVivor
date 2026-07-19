const RUNNING_FRAME_CONTROL = Object.freeze({ mode: 'running' });
const PAUSED_FRAME_CONTROL = Object.freeze({ mode: 'paused' });
const STEP_FRAME_CONTROL = Object.freeze({ mode: 'step' });

/**
 * @class AnimationDebugController
 * @description 애니메이션 디버그 활성 상태와 프레임 정지·단일 스텝 요청을 관리합니다.
 */
export class AnimationDebugController {
    constructor() {
        this.enabled = false;
        this.paused = false;
    }

    /**
     * 엄격히 `true`인 입력만 애니메이션 디버그 활성 상태로 저장합니다.
     * 비활성화하면 정지 상태도 같은 호출에서 해제합니다.
     * @param {*} enabled - 활성화 여부로 판정할 값입니다.
     * @returns {void}
     */
    setEnabled(enabled) {
        this.enabled = enabled === true;
        if (!this.enabled) {
            this.paused = false;
        }
    }

    /**
     * 애니메이션 디버그 활성 여부를 반환합니다.
     * @returns {boolean} 활성 여부입니다.
     */
    isEnabled() {
        return this.enabled === true;
    }

    /**
     * 현재 업데이트가 정지된 상태인지 반환합니다.
     * @returns {boolean} 정지 여부입니다.
     */
    isPaused() {
        return this.isEnabled() && this.paused === true;
    }

    /**
     * 이번 rAF에서 적용할 프레임 제어 모드를 결정합니다.
     * 함수 입력이면 활성 여부를 검사하기 전에 `debugPause`, `debugStep`을 이 순서로
     * 각각 한 번 소비하고, 각 반환값이 엄격히 `true`일 때만 눌림으로 판정합니다.
     * 두 소비가 끝난 뒤 비활성 상태는 pause를 해제하며, 활성 상태는 pause 토글 후
     * 여전히 정지된 경우에만 step을 반환합니다. 결과는 공유되는 동결 객체입니다.
     * @param {*} consumePress - 단발 키 입력 소비 함수 또는 무시할 비함수 값입니다.
     * @returns {Readonly<{mode:'running'|'paused'|'step'}>} 프레임 제어 상태입니다.
     * @throws {*} 입력 소비 함수가 던진 오류를 그대로 전파합니다.
     */
    prepareFrame(consumePress) {
        const consume = typeof consumePress === 'function' ? consumePress : () => false;
        const pausePressed = consume('debugPause') === true;
        const stepPressed = consume('debugStep') === true;

        if (!this.isEnabled()) {
            this.paused = false;
            return RUNNING_FRAME_CONTROL;
        }

        if (pausePressed) {
            this.paused = !this.paused;
        }

        if (!this.paused) {
            return RUNNING_FRAME_CONTROL;
        }

        return stepPressed ? STEP_FRAME_CONTROL : PAUSED_FRAME_CONTROL;
    }
}
