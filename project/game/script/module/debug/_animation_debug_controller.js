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
     * 애니메이션 디버그 활성 상태를 변경합니다.
     * 비활성화하면 숨은 정지 상태도 함께 해제합니다.
     * @param {boolean} enabled - 활성화 여부입니다.
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
     * @param {(action:string) => boolean} consumePress - 단발 키 입력 소비 함수입니다.
     * @returns {{mode:'running'|'paused'|'step'}} 프레임 제어 상태입니다.
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
