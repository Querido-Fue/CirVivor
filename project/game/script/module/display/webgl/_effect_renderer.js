import { createEffectPassRegistry } from './_effect_pass_registry.js';

/**
 * WebGL render target 크기의 최소값입니다.
 */
const MIN_RENDER_TARGET_SIZE = 1;

/**
 * WebGL render target 크기를 `Math.floor`의 ToNumber 변환 뒤 `Math.max(1, value)`를 적용합니다.
 * 유한 결과는 1 이상으로 clamp하고 내림하지만, `NaN`과 `+Infinity`는 그대로 보존합니다.
 * `-Infinity`와 1 미만 결과는 1이 되며, 변환 중 발생한 예외는 그대로 동기 전파됩니다.
 *
 * @param {*} size - 정규화할 입력입니다.
 * @returns {number} Math 연산 결과입니다.
 */
function normalizeRenderTargetSize(size) {
    return Math.max(MIN_RENDER_TARGET_SIZE, Math.floor(size));
}

/**
 * @class EffectRenderer
 * @description effect 레이어의 커스텀 WebGL 이펙트 명령을 큐잉/플러시합니다.
 */
export class EffectRenderer {
    /**
     * @param {WebGLRenderingContext} gl - 대상 WebGL 컨텍스트입니다.
     */
    constructor(gl) {
        this.gl = gl;
        this.width = 0;
        this.height = 0;
        this.commands = [];
        this.effectPasses = createEffectPassRegistry(gl);
    }

    /**
     * width를 정규화해 대입한 뒤 height를 정규화해 대입합니다.
     * height 변환 또는 대입 실패는 이미 갱신된 width를 되돌리지 않습니다.
     * 변환·대입 중 발생한 예외는 그대로 동기 전파됩니다.
     *
     * @param {*} width - 정규화해 대입할 너비 입력입니다.
     * @param {*} height - 정규화해 대입할 높이 입력입니다.
     * @returns {undefined} 정상 완료 시 항상 `undefined`입니다.
     */
    resize(width, height) {
        this.width = normalizeRenderTargetSize(width);
        this.height = normalizeRenderTargetSize(height);
    }

    /**
     * 프레임 시작 시 큐를 초기화합니다.
     * @param {number} width - 현재 surface 너비입니다.
     * @param {number} height - 현재 surface 높이입니다.
     */
    beginFrame(width, height) {
        this.resize(width, height);
        this.width = normalizeRenderTargetSize(this.gl.drawingBufferWidth || this.width);
        this.height = normalizeRenderTargetSize(this.gl.drawingBufferHeight || this.height);
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
        this.gl.viewport(0, 0, this.width, this.height);
        this.commands.length = 0;
    }

    /**
     * 이펙트 명령을 큐에 적재합니다.
     * @param {object} command - effect 렌더링 명령입니다.
     */
    render(command) {
        if (!command) {
            return;
        }

        this.commands.push(command);
    }

    /**
     * 큐에 쌓인 이펙트 명령을 순서대로 실행합니다.
     */
    flush() {
        if (this.commands.length === 0 || this.width <= 0 || this.height <= 0) {
            this.commands.length = 0;
            return;
        }

        for (let index = 0; index < this.commands.length; index++) {
            const command = this.commands[index];
            const effectType = command.effectType || command.shape;
            const effectPass = this.effectPasses.get(effectType);
            if (!effectPass || typeof effectPass.draw !== 'function') {
                continue;
            }

            effectPass.draw(command, this.width, this.height);
        }

        this.commands.length = 0;
    }

    /**
     * GL 리소스를 해제합니다.
     */
    destroy() {
        for (const effectPass of this.effectPasses.values()) {
            effectPass.destroy();
        }
        this.effectPasses.clear();
        this.commands.length = 0;
    }
}
