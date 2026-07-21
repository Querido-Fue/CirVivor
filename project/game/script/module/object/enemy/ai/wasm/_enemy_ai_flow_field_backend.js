import { createEnemyAIFlowFieldWasmRuntimeSync } from './_enemy_ai_flow_field_wasm_runtime.js';

const DEFAULT_MINIMUM_WASM_GRID_SIZE = 32 * 32;

/**
 * @typedef {object} EnemyAIFlowFieldGrid
 * @property {number} cols - 그리드 열 수입니다.
 * @property {number} rows - 그리드 행 수입니다.
 * @property {number} size - `cols * rows`인 전체 셀 수입니다.
 * @property {Uint8Array} blocked - 셀별 차단 여부 평면입니다.
 */

/**
 * @typedef {object} EnemyAIFlowFieldGoalCell
 * @property {number} cx - 목표 셀 X 좌표입니다.
 * @property {number} cy - 목표 셀 Y 좌표입니다.
 */

/**
 * @typedef {object} EnemyAIFlowFieldResult
 * @property {Float32Array} integration - 셀별 누적 비용 평면입니다.
 * @property {Float32Array} dirX - 셀별 X 방향 평면입니다.
 * @property {Float32Array} dirY - 셀별 Y 방향 평면입니다.
 * @property {number} goalIndex - 목표 셀의 선형 인덱스입니다.
 */

/**
 * @callback EnemyAIFlowFieldBuilder
 * @param {EnemyAIFlowFieldGrid} grid - 네비게이션 그리드입니다.
 * @param {EnemyAIFlowFieldGoalCell} goalCell - 목표 셀입니다.
 * @returns {EnemyAIFlowFieldResult} 입력 배열과 분리된 flow field입니다.
 */

/**
 * @typedef {object} EnemyAIFlowFieldRuntime
 * @property {EnemyAIFlowFieldBuilder} buildFlowField - WASM flow-field scan입니다.
 */

/**
 * JS fallback을 고정한 최초 오류를 직렬화 가능한 진단값으로 보존합니다.
 * @param {'initialization'|'execution'} stage - 실패 단계입니다.
 * @param {unknown} error - 원본 오류입니다.
 * @returns {{stage:string,name:string,message:string}} 오류 스냅샷입니다.
 */
function createFailureSnapshot(stage, error) {
    return {
        stage,
        name: typeof error?.name === 'string' ? error.name : 'Error',
        message: typeof error?.message === 'string' ? error.message : String(error)
    };
}

/**
 * 적 AI flow field의 WASM 권한 전환과 영구 JS fallback 상태를 관리합니다.
 */
export class EnemyAIFlowFieldBackend {
    #minimumWasmGridSize;
    #runtime;
    #state;
    #failure = null;
    #wasmBuildCount = 0;
    #jsBuildCount = 0;

    /**
     * WASM 런타임을 한 번 준비하며 실패하면 이 인스턴스를 영구 JS 모드로 고정합니다.
     * @param {object} [options] - backend 구성입니다.
     * @param {() => EnemyAIFlowFieldRuntime} [options.runtimeFactory] - WASM 런타임 생성 함수입니다.
     * @param {number} [options.minimumWasmGridSize] - WASM을 사용할 최소 셀 수입니다.
     */
    constructor({
        runtimeFactory = createEnemyAIFlowFieldWasmRuntimeSync,
        minimumWasmGridSize = DEFAULT_MINIMUM_WASM_GRID_SIZE
    } = {}) {
        if (typeof runtimeFactory !== 'function') {
            throw new TypeError('runtimeFactory는 함수여야 합니다.');
        }
        if (!Number.isInteger(minimumWasmGridSize) || minimumWasmGridSize < 1) {
            throw new RangeError('minimumWasmGridSize는 1 이상의 정수여야 합니다.');
        }

        this.#minimumWasmGridSize = minimumWasmGridSize;
        try {
            const runtime = runtimeFactory();
            if (!runtime || typeof runtime.buildFlowField !== 'function') {
                throw new TypeError('WASM runtime에 buildFlowField 함수가 없습니다.');
            }
            this.#runtime = runtime;
            this.#state = 'wasm-ready';
        } catch (error) {
            this.#runtime = null;
            this.#state = 'js-permanent';
            this.#failure = createFailureSnapshot('initialization', error);
        }
    }

    /**
     * 무거운 그리드는 WASM으로 계산하고, 작은 입력이나 WASM 오류는 기존 JS로 계산합니다.
     * WASM 실행이 한 번이라도 실패하면 이후 호출은 재시도하지 않습니다.
     * @param {EnemyAIFlowFieldGrid} grid - 네비게이션 그리드입니다.
     * @param {EnemyAIFlowFieldGoalCell} goalCell - 목표 셀입니다.
     * @param {EnemyAIFlowFieldBuilder} jsBuilder - 원본 JS 기준 구현입니다.
     * @returns {EnemyAIFlowFieldResult} flow field 결과입니다.
     */
    buildFlowField(grid, goalCell, jsBuilder) {
        if (typeof jsBuilder !== 'function') {
            throw new TypeError('jsBuilder는 함수여야 합니다.');
        }
        if (
            this.#state !== 'wasm-ready'
            || !Number.isInteger(grid?.size)
            || grid.size < this.#minimumWasmGridSize
        ) {
            this.#jsBuildCount++;
            return jsBuilder(grid, goalCell);
        }

        try {
            const field = this.#runtime.buildFlowField(grid, goalCell);
            this.#wasmBuildCount++;
            return field;
        } catch (error) {
            this.#runtime = null;
            this.#state = 'js-permanent';
            this.#failure = createFailureSnapshot('execution', error);
            this.#jsBuildCount++;
            return jsBuilder(grid, goalCell);
        }
    }

    /**
     * 테스트와 진단용 backend 상태 스냅샷을 반환합니다.
     * @returns {{state:string,minimumWasmGridSize:number,failure:null|{stage:string,name:string,message:string},wasmBuildCount:number,jsBuildCount:number}} 상태입니다.
     */
    getStatus() {
        return {
            state: this.#state,
            minimumWasmGridSize: this.#minimumWasmGridSize,
            failure: this.#failure ? { ...this.#failure } : null,
            wasmBuildCount: this.#wasmBuildCount,
            jsBuildCount: this.#jsBuildCount
        };
    }
}

const enemyAIFlowFieldBackend = new EnemyAIFlowFieldBackend();

/**
 * 프로덕션 singleton backend로 flow field를 생성합니다.
 * @param {EnemyAIFlowFieldGrid} grid - 네비게이션 그리드입니다.
 * @param {EnemyAIFlowFieldGoalCell} goalCell - 목표 셀입니다.
 * @param {EnemyAIFlowFieldBuilder} jsBuilder - 원본 JS 기준 구현입니다.
 * @returns {EnemyAIFlowFieldResult} flow field 결과입니다.
 */
export const buildEnemyAIFlowField = (grid, goalCell, jsBuilder) => (
    enemyAIFlowFieldBackend.buildFlowField(grid, goalCell, jsBuilder)
);

/**
 * 프로덕션 flow-field backend 상태 스냅샷을 반환합니다.
 * @returns {{state:string,minimumWasmGridSize:number,failure:null|{stage:string,name:string,message:string},wasmBuildCount:number,jsBuildCount:number}} 상태입니다.
 */
export const getEnemyAIFlowFieldBackendStatus = () => enemyAIFlowFieldBackend.getStatus();
