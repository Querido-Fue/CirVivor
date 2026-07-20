import { ENEMY_AI_FLOW_FIELD_WASM_BYTES } from './_enemy_ai_flow_field_wasm_bytes.js';

const WASM_PAGE_BYTES = 64 * 1024;
const MEMORY_ALIGNMENT_BYTES = 64;
const FLOAT32_BYTES = Float32Array.BYTES_PER_ELEMENT;
const MAX_WASM_BYTE_LENGTH = 0x7fffffff;

let compiledFlowFieldModule = null;
let compiledFlowFieldModulePromise = null;

/**
 * 현재 엔진의 필수 WebAssembly API를 검증해 반환합니다.
 * @param {boolean} requireSynchronousModule - 동기 Module 생성자가 필요한지 여부입니다.
 * @returns {typeof WebAssembly} 검증된 WebAssembly API입니다.
 */
function getWebAssemblyApi(requireSynchronousModule) {
    const api = globalThis.WebAssembly;
    const hasRequiredApi = api
        && typeof api.Memory === 'function'
        && typeof api.Instance === 'function'
        && typeof api.validate === 'function'
        && (!requireSynchronousModule || typeof api.Module === 'function')
        && (requireSynchronousModule || typeof api.compile === 'function');
    if (!hasRequiredApi || !api.validate(ENEMY_AI_FLOW_FIELD_WASM_BYTES)) {
        throw new Error('현재 엔진에서 적 AI flow field WebAssembly를 사용할 수 없습니다.');
    }
    return api;
}

/**
 * 바이트 오프셋을 WASM ABI의 64바이트 경계로 올림합니다.
 * @param {number} value - 정렬할 바이트 오프셋입니다.
 * @returns {number} 정렬된 바이트 오프셋입니다.
 */
function alignMemoryOffset(value) {
    return Math.ceil(value / MEMORY_ALIGNMENT_BYTES) * MEMORY_ALIGNMENT_BYTES;
}

/**
 * blocked 입력, 결과 세 평면, heap 두 평면의 선형 메모리 배치를 계산합니다.
 * @param {number} size - 그리드 셀 수입니다.
 * @returns {{blockedOffset:number,integrationOffset:number,dirXOffset:number,dirYOffset:number,heapOffset:number,positionsOffset:number,requiredBytes:number}} 메모리 배치입니다.
 */
function createMemoryLayout(size) {
    const floatPlaneBytes = size * FLOAT32_BYTES;
    const blockedOffset = 0;
    const integrationOffset = alignMemoryOffset(blockedOffset + size);
    const dirXOffset = alignMemoryOffset(integrationOffset + floatPlaneBytes);
    const dirYOffset = alignMemoryOffset(dirXOffset + floatPlaneBytes);
    const heapOffset = alignMemoryOffset(dirYOffset + floatPlaneBytes);
    const positionsOffset = alignMemoryOffset(heapOffset + floatPlaneBytes);
    const requiredBytes = positionsOffset + floatPlaneBytes;
    return {
        blockedOffset,
        integrationOffset,
        dirXOffset,
        dirYOffset,
        heapOffset,
        positionsOffset,
        requiredBytes
    };
}

/**
 * 값이 다른 realm에서도 정확한 Uint8Array인지 확인합니다.
 * @param {unknown} value - 검사할 값입니다.
 * @returns {boolean} Uint8Array 여부입니다.
 */
function isUint8Array(value) {
    return ArrayBuffer.isView(value)
        && value.BYTES_PER_ELEMENT === Uint8Array.BYTES_PER_ELEMENT
        && Object.prototype.toString.call(value) === '[object Uint8Array]';
}

/**
 * flow field 입력의 크기와 목표 셀 계약을 검증합니다.
 * @param {object} grid - 네비게이션 그리드입니다.
 * @param {object} goalCell - 목표 셀입니다.
 * @returns {number} 검증된 셀 수입니다.
 */
function validateBuildInput(grid, goalCell) {
    if (!grid || !Number.isInteger(grid.cols) || !Number.isInteger(grid.rows)) {
        throw new TypeError('grid.cols와 grid.rows는 정수여야 합니다.');
    }
    if (grid.cols <= 0 || grid.rows <= 0) {
        throw new RangeError('grid.cols와 grid.rows는 1 이상이어야 합니다.');
    }

    const size = grid.cols * grid.rows;
    if (!Number.isSafeInteger(size) || size <= 0 || grid.size !== size) {
        throw new RangeError('grid.size는 grid.cols * grid.rows와 같은 안전한 정수여야 합니다.');
    }
    if (!isUint8Array(grid.blocked) || grid.blocked.length < size) {
        throw new TypeError('grid.blocked는 모든 셀을 포함하는 Uint8Array여야 합니다.');
    }
    if (!goalCell || !Number.isInteger(goalCell.cx) || !Number.isInteger(goalCell.cy)) {
        throw new TypeError('goalCell.cx와 goalCell.cy는 정수여야 합니다.');
    }
    if (
        goalCell.cx < 0
        || goalCell.cy < 0
        || goalCell.cx >= grid.cols
        || goalCell.cy >= grid.rows
    ) {
        throw new RangeError('goalCell은 그리드 범위 안에 있어야 합니다.');
    }
    return size;
}

/**
 * 생성된 바이트를 한 번만 컴파일해 런타임 인스턴스끼리 공유합니다.
 * @returns {Promise<WebAssembly.Module>} 컴파일된 WASM 모듈입니다.
 */
function getCompiledFlowFieldModule() {
    if (compiledFlowFieldModule) return Promise.resolve(compiledFlowFieldModule);
    if (!compiledFlowFieldModulePromise) {
        const api = getWebAssemblyApi(false);
        compiledFlowFieldModulePromise = api.compile(ENEMY_AI_FLOW_FIELD_WASM_BYTES)
            .then((module) => {
                compiledFlowFieldModule = module;
                return module;
            })
            .catch((error) => {
                compiledFlowFieldModulePromise = null;
                throw error;
            });
    }
    return compiledFlowFieldModulePromise;
}

/**
 * 생성된 바이트를 동기로 한 번만 컴파일해 첫 게임 tick 전에 사용할 수 있게 합니다.
 * @returns {WebAssembly.Module} 컴파일된 WASM 모듈입니다.
 */
function getCompiledFlowFieldModuleSync() {
    if (!compiledFlowFieldModule) {
        const api = getWebAssemblyApi(true);
        compiledFlowFieldModule = new api.Module(ENEMY_AI_FLOW_FIELD_WASM_BYTES);
    }
    return compiledFlowFieldModule;
}

/**
 * 적 AI flow field WASM 커널의 재사용 가능한 단일 메모리 런타임입니다.
 */
class EnemyAIFlowFieldWasmRuntime {
    #memory;
    #buildFlowFieldExport;

    /**
     * 준비된 WASM 인스턴스와 가져온 선형 메모리를 결합합니다.
     * @param {WebAssembly.Memory} memory - 커널이 사용할 선형 메모리입니다.
     * @param {WebAssembly.Instance} instance - 준비된 WASM 인스턴스입니다.
     */
    constructor(memory, instance) {
        const buildFlowFieldExport = instance?.exports?.build_flow_field;
        if (typeof buildFlowFieldExport !== 'function') {
            throw new TypeError('WASM 모듈에 build_flow_field export가 없습니다.');
        }
        this.#memory = memory;
        this.#buildFlowFieldExport = buildFlowFieldExport;
    }

    /**
     * 현재 호출에 필요한 페이지 수까지 선형 메모리를 확장합니다.
     * @param {number} requiredBytes - 필요한 전체 바이트 수입니다.
     * @returns {void}
     */
    #ensureMemoryCapacity(requiredBytes) {
        if (!Number.isSafeInteger(requiredBytes) || requiredBytes > MAX_WASM_BYTE_LENGTH) {
            throw new RangeError('flow field WASM 메모리 요청이 지원 범위를 초과했습니다.');
        }
        const requiredPages = Math.ceil(requiredBytes / WASM_PAGE_BYTES);
        const currentPages = this.#memory.buffer.byteLength / WASM_PAGE_BYTES;
        if (requiredPages > currentPages) {
            this.#memory.grow(requiredPages - currentPages);
        }
    }

    /**
     * JS 기준 구현과 같은 integration 및 방향 평면을 생성합니다.
     * 반환 배열은 WASM scratch와 분리된 복사본이어서 다음 호출 뒤에도 유지됩니다.
     * @param {{cols:number,rows:number,size:number,blocked:Uint8Array}} grid - 네비게이션 그리드입니다.
     * @param {{cx:number,cy:number}} goalCell - 목표 셀입니다.
     * @returns {{integration:Float32Array,dirX:Float32Array,dirY:Float32Array,goalIndex:number}} flow field 결과입니다.
     */
    buildFlowField(grid, goalCell) {
        const size = validateBuildInput(grid, goalCell);
        const layout = createMemoryLayout(size);
        this.#ensureMemoryCapacity(layout.requiredBytes);

        const memoryBuffer = this.#memory.buffer;
        new Uint8Array(memoryBuffer, layout.blockedOffset, size).set(
            grid.blocked.subarray(0, size)
        );

        const status = this.#buildFlowFieldExport(
            layout.blockedOffset,
            layout.integrationOffset,
            layout.dirXOffset,
            layout.dirYOffset,
            layout.heapOffset,
            layout.positionsOffset,
            grid.cols,
            grid.rows,
            goalCell.cx,
            goalCell.cy
        );
        if (status !== 0) {
            throw new Error(`flow field WASM 커널이 상태 코드 ${status}로 실패했습니다.`);
        }

        const integration = new Float32Array(size);
        const dirX = new Float32Array(size);
        const dirY = new Float32Array(size);
        integration.set(new Float32Array(memoryBuffer, layout.integrationOffset, size));
        dirX.set(new Float32Array(memoryBuffer, layout.dirXOffset, size));
        dirY.set(new Float32Array(memoryBuffer, layout.dirYOffset, size));
        return {
            integration,
            dirX,
            dirY,
            goalIndex: (goalCell.cy * grid.cols) + goalCell.cx
        };
    }
}

/**
 * 적 AI flow field WASM 모듈을 컴파일하고 독립 런타임을 생성합니다.
 * @returns {Promise<EnemyAIFlowFieldWasmRuntime>} 준비된 런타임입니다.
 */
export async function createEnemyAIFlowFieldWasmRuntime() {
    const api = getWebAssemblyApi(false);
    const module = await getCompiledFlowFieldModule();
    const memory = new api.Memory({ initial: 1 });
    const instance = new api.Instance(module, { env: { memory } });
    return new EnemyAIFlowFieldWasmRuntime(memory, instance);
}

/**
 * 적 AI flow field WASM 모듈을 동기로 준비해 게임 hot path용 런타임을 생성합니다.
 * @returns {EnemyAIFlowFieldWasmRuntime} 준비된 런타임입니다.
 */
export function createEnemyAIFlowFieldWasmRuntimeSync() {
    const api = getWebAssemblyApi(true);
    const module = getCompiledFlowFieldModuleSync();
    const memory = new api.Memory({ initial: 1 });
    const instance = new api.Instance(module, { env: { memory } });
    return new EnemyAIFlowFieldWasmRuntime(memory, instance);
}
