import { ENEMY_PAIR_COLLISION_RADIUS_SCALE } from '../_collision_resolve_tuning.js';
import { COLLISION_EPSILON } from '../collision_math_constants.js';
import { COLLISION_CONTACT_WASM_BYTES } from './_collision_contact_wasm_bytes.js';

const WASM_PAGE_BYTES = 64 * 1024;
const MEMORY_ALIGNMENT_BYTES = 64;
const BODY_RECORD_BYTES = 32;
const PART_RECORD_BYTES = 12;
const PAIR_RECORD_BYTES = 16;
const MAX_WASM_BYTE_LENGTH = 0x7fffffff;
const SHAPE_CIRCLE = 0;
const SHAPE_CIRCLE_PARTS = 1;

let compiledCollisionContactModule = null;

/**
 * physics contact WASM이 요구하는 동기 WebAssembly API와 체크인 바이트를 검증합니다.
 * @returns {typeof WebAssembly} 검증된 WebAssembly API입니다.
 */
function getWebAssemblyApi() {
    const api = globalThis.WebAssembly;
    const valid = api
        && typeof api.Memory === 'function'
        && typeof api.Module === 'function'
        && typeof api.Instance === 'function'
        && typeof api.validate === 'function'
        && api.validate(COLLISION_CONTACT_WASM_BYTES);
    if (!valid) {
        throw new Error('현재 엔진에서 physics collision contact WebAssembly를 사용할 수 없습니다.');
    }
    return api;
}

/**
 * 오프셋을 ABI의 64바이트 경계로 올림합니다.
 * @param {number} value - 정렬할 바이트 오프셋입니다.
 * @returns {number} 정렬된 오프셋입니다.
 */
function alignMemoryOffset(value) {
    return Math.ceil(value / MEMORY_ALIGNMENT_BYTES) * MEMORY_ALIGNMENT_BYTES;
}

/**
 * 안전한 ABI plane 바이트 크기를 계산합니다.
 * @param {number} count - record 개수입니다.
 * @param {number} stride - record 바이트 크기입니다.
 * @returns {number} plane 바이트 크기입니다.
 */
function getPlaneByteLength(count, stride) {
    const byteLength = count * stride;
    if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > MAX_WASM_BYTE_LENGTH) {
        throw new RangeError('collision contact WASM plane 크기가 지원 범위를 초과했습니다.');
    }
    return byteLength;
}

/**
 * body/part/pair/result plane의 선형 메모리 배치를 계산합니다.
 * @param {number} bodyCount - body 개수입니다.
 * @param {number} partCount - 전체 part 개수입니다.
 * @param {number} pairCount - candidate pair 개수입니다.
 * @returns {{bodyOffset:number,partsOffset:number,pairOffset:number,resultOffset:number,requiredBytes:number}}
 */
function createMemoryLayout(bodyCount, partCount, pairCount) {
    const bodyOffset = 0;
    const partsOffset = alignMemoryOffset(
        bodyOffset + getPlaneByteLength(bodyCount, BODY_RECORD_BYTES)
    );
    const pairOffset = alignMemoryOffset(
        partsOffset + getPlaneByteLength(partCount, PART_RECORD_BYTES)
    );
    const resultOffset = alignMemoryOffset(
        pairOffset + getPlaneByteLength(pairCount, PAIR_RECORD_BYTES)
    );
    const requiredBytes = resultOffset + getPlaneByteLength(pairCount, 1);
    if (!Number.isSafeInteger(requiredBytes) || requiredBytes > MAX_WASM_BYTE_LENGTH) {
        throw new RangeError('collision contact WASM 메모리 요청이 지원 범위를 초과했습니다.');
    }
    return { bodyOffset, partsOffset, pairOffset, resultOffset, requiredBytes };
}

/**
 * canonical prepared body의 shape를 ordered pair flag용 태그로 변환합니다.
 * @param {object} body - CollisionHandler가 준비한 enemy body입니다.
 * @returns {0|1} circle은 0, circleParts는 1입니다.
 */
function getPreparedBodyShapeTag(body) {
    if (!body || body.kind !== 'enemy') {
        throw new TypeError('collision contact WASM에는 prepared enemy body만 전달할 수 있습니다.');
    }
    if (body.shape === 'circle') return SHAPE_CIRCLE;
    if (body.shape === 'circleParts') return SHAPE_CIRCLE_PARTS;
    throw new TypeError(`지원하지 않는 prepared collision shape입니다: ${String(body.shape)}`);
}

/**
 * trusted-private prepared body의 part count와 native Float32Array 계약을 검증합니다.
 * 이 경로는 engine이 직접 만든 plain body record와 변조되지 않은 native typed-array
 * intrinsic만 받으며 Proxy, accessor side effect, typed-array subclass는 지원하지 않습니다.
 * @param {object} body - CollisionHandler 내부 prepared body입니다.
 * @param {0|1} shapeTag - 정규화된 shape 태그입니다.
 * @returns {number} pack할 part 개수입니다.
 */
function getPreparedBodyPartCount(body, shapeTag) {
    if (shapeTag === SHAPE_CIRCLE) return 0;
    const count = body.circlePartCount;
    const parts = body.circleParts;
    if (!Number.isInteger(count) || count < 0) {
        throw new RangeError('prepared circleParts count는 0 이상의 정수여야 합니다.');
    }
    if (!(parts instanceof Float32Array) || parts.length < count * 3) {
        throw new TypeError('prepared circleParts는 count 전체를 포함하는 native Float32Array여야 합니다.');
    }
    return count;
}

/**
 * 체크인된 바이트를 한 번만 동기 컴파일합니다.
 * @returns {WebAssembly.Module} 공유할 컴파일 모듈입니다.
 */
function getCompiledCollisionContactModule() {
    if (!compiledCollisionContactModule) {
        const api = getWebAssemblyApi();
        compiledCollisionContactModule = new api.Module(COLLISION_CONTACT_WASM_BYTES);
    }
    return compiledCollisionContactModule;
}

/**
 * prepared collision candidate 전체를 한 번에 처리하는 재사용 WASM 런타임입니다.
 */
export class CollisionContactWasmRuntime {
    #memory;
    #scanContactsExport;

    /**
     * @param {WebAssembly.Memory} memory - 전용 선형 메모리입니다.
     * @param {WebAssembly.Instance} instance - 준비된 WASM 인스턴스입니다.
     */
    constructor(memory, instance) {
        const scanContactsExport = instance?.exports?.scan_contacts;
        if (typeof scanContactsExport !== 'function') {
            throw new TypeError('WASM 모듈에 scan_contacts export가 없습니다.');
        }
        this.#memory = memory;
        this.#scanContactsExport = scanContactsExport;
    }

    /**
     * 현재 batch에 필요한 페이지까지 메모리를 확장합니다.
     * @param {number} requiredBytes - 필요한 전체 바이트 수입니다.
     * @returns {void}
     */
    #ensureMemoryCapacity(requiredBytes) {
        const requiredPages = Math.ceil(requiredBytes / WASM_PAGE_BYTES);
        const currentPages = this.#memory.buffer.byteLength / WASM_PAGE_BYTES;
        if (requiredPages > currentPages) {
            this.#memory.grow(requiredPages - currentPages);
        }
    }

    /**
     * prepared body와 ordered candidate pair를 pack하고 pure boolean kernel을 실행합니다.
     * 입력은 CollisionHandler가 같은 fixed frame에 만든 plain body Array와 native
     * Float32Array/Int32Array만 허용하는 trusted-private 계약입니다. body/part/candidate
     * 생성은 JS가 소유하며 WAT는 ordered shape flag와 숫자 plane만 읽습니다.
     * 반환 view는 다음 호출까지 유효하고, 호출자는 커널 성공 뒤에만 결과를 append해야 합니다.
     * @param {object[]} bodies - canonical prepared enemy body 배열입니다.
     * @param {Int32Array} lowIndices - candidate A 인덱스입니다.
     * @param {Int32Array} highIndices - candidate B 인덱스입니다.
     * @param {number} pairCount - 사용할 candidate 개수입니다.
     * @returns {Uint8Array} 입력 순서와 같은 contact flag view입니다.
     */
    scanPreparedContacts(bodies, lowIndices, highIndices, pairCount) {
        if (!Array.isArray(bodies)
            || !(lowIndices instanceof Int32Array)
            || !(highIndices instanceof Int32Array)
            || !Number.isInteger(pairCount)
            || pairCount < 0
            || lowIndices.length < pairCount
            || highIndices.length < pairCount) {
            throw new TypeError('collision contact WASM batch 입력이 canonical buffer 계약과 다릅니다.');
        }

        const bodyCount = bodies.length;
        let totalPartCount = 0;
        for (let i = 0; i < bodyCount; i++) {
            const body = bodies[i];
            const shapeTag = getPreparedBodyShapeTag(body);
            totalPartCount += getPreparedBodyPartCount(body, shapeTag);
            if (!Number.isSafeInteger(totalPartCount) || totalPartCount > 0x7fffffff) {
                throw new RangeError('prepared collision part 개수가 WASM 범위를 초과했습니다.');
            }
        }

        const layout = createMemoryLayout(bodyCount, totalPartCount, pairCount);
        this.#ensureMemoryCapacity(layout.requiredBytes);

        // memory.grow는 이전 ArrayBuffer와 모든 view를 분리하므로 반드시 grow 뒤에 재생성합니다.
        const memoryBuffer = this.#memory.buffer;
        const bodyFloat64 = new Float64Array(
            memoryBuffer,
            layout.bodyOffset,
            bodyCount * (BODY_RECORD_BYTES / Float64Array.BYTES_PER_ELEMENT)
        );
        const bodyUint32 = new Uint32Array(
            memoryBuffer,
            layout.bodyOffset,
            bodyCount * (BODY_RECORD_BYTES / Uint32Array.BYTES_PER_ELEMENT)
        );
        const packedParts = new Float32Array(
            memoryBuffer,
            layout.partsOffset,
            totalPartCount * 3
        );
        const packedPairs = new Uint32Array(
            memoryBuffer,
            layout.pairOffset,
            pairCount * (PAIR_RECORD_BYTES / Uint32Array.BYTES_PER_ELEMENT)
        );

        let partCursor = 0;
        for (let i = 0; i < bodyCount; i++) {
            const body = bodies[i];
            const shapeTag = getPreparedBodyShapeTag(body);
            const partCount = getPreparedBodyPartCount(body, shapeTag);
            const floatBase = i * 4;
            const uintBase = i * 8;
            bodyFloat64[floatBase] = body.centerX;
            bodyFloat64[floatBase + 1] = body.centerY;
            bodyFloat64[floatBase + 2] = body.radius;
            bodyUint32[uintBase + 6] = partCursor;
            bodyUint32[uintBase + 7] = partCount;
            if (partCount > 0) {
                packedParts.set(body.circleParts.subarray(0, partCount * 3), partCursor * 3);
                partCursor += partCount;
            }
        }

        for (let i = 0; i < pairCount; i++) {
            const bodyIndexA = lowIndices[i];
            const bodyIndexB = highIndices[i];
            if (bodyIndexA < 0 || bodyIndexA >= bodyCount
                || bodyIndexB < 0 || bodyIndexB >= bodyCount) {
                throw new RangeError('collision contact candidate body 인덱스가 범위를 벗어났습니다.');
            }
            const pairBase = i * 4;
            const orderedFlags = getPreparedBodyShapeTag(bodies[bodyIndexA])
                | (getPreparedBodyShapeTag(bodies[bodyIndexB]) << 1);
            packedPairs[pairBase] = bodyIndexA;
            packedPairs[pairBase + 1] = bodyIndexB;
            packedPairs[pairBase + 2] = orderedFlags;
            packedPairs[pairBase + 3] = 0;
        }

        const status = this.#scanContactsExport(
            layout.bodyOffset,
            bodyCount,
            layout.partsOffset,
            totalPartCount,
            layout.pairOffset,
            pairCount,
            layout.resultOffset,
            COLLISION_EPSILON,
            ENEMY_PAIR_COLLISION_RADIUS_SCALE
        );
        if (status !== 0) {
            throw new Error(`collision contact WASM 커널이 상태 코드 ${status}로 실패했습니다.`);
        }
        return new Uint8Array(memoryBuffer, layout.resultOffset, pairCount);
    }
}

/**
 * production hot path용 collision contact WASM 런타임을 동기로 생성합니다.
 * @returns {CollisionContactWasmRuntime} 독립 메모리를 가진 런타임입니다.
 */
export function createCollisionContactWasmRuntimeSync() {
    const api = getWebAssemblyApi();
    const memory = new api.Memory({ initial: 1 });
    const instance = new api.Instance(
        getCompiledCollisionContactModule(),
        { env: { memory } }
    );
    return new CollisionContactWasmRuntime(memory, instance);
}
