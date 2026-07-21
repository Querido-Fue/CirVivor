import { createCollisionContactWasmRuntimeSync } from './_collision_contact_wasm_runtime.js';

const FAILURE_NAME_FALLBACK = 'Error';
const FAILURE_MESSAGE_FALLBACK = 'Unknown error';

/**
 * 오류 문자열 변환 자체가 실패해도 고정 진단 문자열을 반환합니다.
 * @param {unknown} error - 문자열화할 오류입니다.
 * @returns {string} 직렬화 가능한 오류 문자열입니다.
 */
function stringifyFailure(error) {
    try {
        return String(error);
    } catch {
        return FAILURE_MESSAGE_FALLBACK;
    }
}

/**
 * 기존 name 조회 순서를 유지하되 hostile getter가 실패하면 기본 이름을 반환합니다.
 * @param {unknown} error - 원본 오류입니다.
 * @returns {string} 직렬화 가능한 오류 이름입니다.
 */
function getFailureName(error) {
    try {
        return typeof error?.name === 'string' ? error.name : FAILURE_NAME_FALLBACK;
    } catch {
        return FAILURE_NAME_FALLBACK;
    }
}

/**
 * 기존 message 조회와 문자열 fallback 순서를 유지하며 모든 변환 실패를 흡수합니다.
 * @param {unknown} error - 원본 오류입니다.
 * @returns {string} 직렬화 가능한 오류 메시지입니다.
 */
function getFailureMessage(error) {
    try {
        return typeof error?.message === 'string' ? error.message : stringifyFailure(error);
    } catch {
        return stringifyFailure(error);
    }
}

/**
 * 최초 WASM 실패를 직렬화 가능한 진단값으로 보존합니다.
 * @param {'initialization'|'execution'} stage - 실패 단계입니다.
 * @param {unknown} error - 원본 오류입니다.
 * @returns {{stage:'initialization'|'execution',name:string,message:string}} 실패 스냅샷입니다.
 */
function createFailureSnapshot(stage, error) {
    return {
        stage,
        name: getFailureName(error),
        message: getFailureMessage(error)
    };
}

/**
 * prepared collision contact의 WASM 권한과 영구 JS fallback 상태를 관리합니다.
 */
export class CollisionContactBackend {
    #runtime;
    #state;
    #failure = null;
    #wasmScanCount = 0;
    #jsFallbackCount = 0;

    /**
     * 런타임을 한 번 동기 준비하며 실패하면 이 backend를 영구 JS 모드로 고정합니다.
     * @param {object} [options] - 테스트 가능한 backend 구성입니다.
     * @param {() => {scanPreparedContacts:Function}} [options.runtimeFactory] - 런타임 생성 함수입니다.
     */
    constructor({ runtimeFactory = createCollisionContactWasmRuntimeSync } = {}) {
        if (typeof runtimeFactory !== 'function') {
            throw new TypeError('runtimeFactory는 함수여야 합니다.');
        }
        try {
            const runtime = runtimeFactory();
            if (!runtime || typeof runtime.scanPreparedContacts !== 'function') {
                throw new TypeError('collision contact WASM runtime에 scanPreparedContacts가 없습니다.');
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
     * trusted-private canonical prepared batch를 WASM으로 처리합니다.
     * 성공 시에만 ordered result view를 반환합니다. packing, memory growth, status 또는 trap이
     * 한 번이라도 실패하면 부분 결과를 노출하지 않고 이후 모든 호출을 영구 JS fallback으로 보냅니다.
     * @param {object[]} bodies - plain prepared enemy body Array입니다.
     * @param {Int32Array} lowIndices - native candidate A 인덱스입니다.
     * @param {Int32Array} highIndices - native candidate B 인덱스입니다.
     * @param {number} pairCount - candidate 개수입니다.
     * @returns {Uint8Array|null} 성공한 WASM contact flags, 또는 JS fallback 신호인 null입니다.
     */
    scanPreparedContacts(bodies, lowIndices, highIndices, pairCount) {
        if (this.#state !== 'wasm-ready') {
            this.#jsFallbackCount++;
            return null;
        }

        try {
            const contactFlags = this.#runtime.scanPreparedContacts(
                bodies,
                lowIndices,
                highIndices,
                pairCount
            );
            if (!(contactFlags instanceof Uint8Array) || contactFlags.length < pairCount) {
                throw new TypeError('collision contact WASM 결과가 ordered Uint8Array 계약과 다릅니다.');
            }
            this.#wasmScanCount++;
            return contactFlags;
        } catch (error) {
            this.#runtime = null;
            this.#state = 'js-permanent';
            this.#failure = createFailureSnapshot('execution', error);
            this.#jsFallbackCount++;
            return null;
        }
    }

    /**
     * 테스트와 진단용 backend 상태를 반환합니다.
     * @returns {{state:string,failure:null|{stage:'initialization'|'execution',name:string,message:string},wasmScanCount:number,jsFallbackCount:number}}
     */
    getStatus() {
        return {
            state: this.#state,
            failure: this.#failure ? { ...this.#failure } : null,
            wasmScanCount: this.#wasmScanCount,
            jsFallbackCount: this.#jsFallbackCount
        };
    }
}

/** @type {CollisionContactBackend} production prepared-contact backend singleton입니다. */
export const collisionContactBackend = new CollisionContactBackend();

/**
 * production collision contact backend 상태를 반환합니다.
 * @returns {{state:string,failure:null|{stage:'initialization'|'execution',name:string,message:string},wasmScanCount:number,jsFallbackCount:number}}
 */
export const getCollisionContactBackendStatus = () => collisionContactBackend.getStatus();
