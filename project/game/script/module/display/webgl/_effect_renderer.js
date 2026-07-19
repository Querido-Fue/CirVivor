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
     * live commands를 index 순서로 순회해 effect pass를 동기 dispatch하고, loop 정상 종료 뒤 당시 current queue에 `length = 0`을 대입합니다.
     * 초기 `commands.length === 0`은 무변환 엄격 비교하고, 필요할 때만 `width <= 0`과 `height <= 0`을 차례로 비교합니다.
     * 어느 guard든 참이면 pass 조회 없이 당시 current queue의 `length = 0` 대입을 시도하고, 성공한 경우에만 `undefined`를 반환합니다.
     * 각 command의 truthy `effectType`을 사용하고, falsy이면 live `shape`을 사용해 현재 registry의 exact Map key로 조회합니다.
     * pass가 falsy이거나 첫 `draw` 조회 결과가 함수가 아니면 해당 command를 건너뜁니다.
     * 호출식은 `draw`를 다시 조회하되 callable 여부를 재검사하지 않고 `command`, current width, current height를 평가합니다.
     * 두 번째 `draw` 값이 callable이면 pass receiver로 호출하고 반환값과 thenable은 관찰하지 않으며, 아니면 인자 평가 뒤 `TypeError`가 발생합니다.
     * queue 길이·원소, registry, pass, `draw`, dimensions는 매 관찰 지점의 live 값을 사용하고 append·truncate·reorder·재진입을 막는 guard가 없습니다.
     * flush 자체의 clear 대입 지점은 guard branch와 loop 정상 종료뿐이며, draw와 재진입은 queue를 별도로 변이·교체할 수 있습니다.
     * 조회·getter·coercion·두 번째 non-callable `draw`·호출·clear 대입 중 예외는 그대로 동기 전파되고 이미 수행한 draw와 queue 변이를 rollback하지 않습니다.
     * `length = 0` 축소가 실패하면 ECMAScript가 허용한 원소 삭제와 부분 length 상태도 그대로 남습니다.
     *
     * @returns {undefined} guard 또는 loop 종료 뒤 current queue의 clear 대입까지 성공했을 때 `undefined`입니다.
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
