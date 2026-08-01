const INVALID_HANDLE_COMPONENT = 0xffffffff;
const FIRST_ENTITY_ID = 1;

/** @param {*} value @param {string} label */
function requirePositiveSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0 || number >= INVALID_HANDLE_COMPONENT) {
        throw new RangeError(`${label}은 reserved sentinel보다 작은 양의 정수여야 합니다.`);
    }
    return number;
}

/** @param {*} value @param {string} label */
function requireNonNegativeSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
        throw new RangeError(`${label}은 0 이상의 안전한 정수여야 합니다.`);
    }
    return number;
}

/** @param {*} value @param {string} label */
function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

/** @param {*} source @param {string} label */
function normalizeHandle(source, label) {
    if (!source || typeof source !== 'object') {
        throw new TypeError(`${label}은 entity handle 객체여야 합니다.`);
    }
    return {
        entityId: requirePositiveSafeInteger(source.entityId, `${label}.entityId`),
        incarnation: requirePositiveSafeInteger(source.incarnation, `${label}.incarnation`)
    };
}

/**
 * registry 밖으로 엔진 객체나 가변 컬렉션을 누출하지 않도록 작은 metadata만 복제합니다.
 * @param {*} source - 복제할 metadata입니다.
 * @returns {object|null} 불변 metadata입니다.
 */
function normalizeMetadata(source) {
    if (source === undefined || source === null) {
        return null;
    }
    if (typeof source !== 'object'
        || (Object.getPrototypeOf(source) !== Object.prototype
            && Object.getPrototypeOf(source) !== null)) {
        throw new TypeError('entity metadata는 plain object여야 합니다.');
    }
    const result = {};
    for (const [key, value] of Object.entries(source)) {
        if (value !== null
            && value !== undefined
            && typeof value !== 'string'
            && typeof value !== 'number'
            && typeof value !== 'boolean') {
            throw new TypeError(`entity metadata는 primitive 값만 허용합니다: ${key}`);
        }
        result[key] = value ?? null;
    }
    return Object.freeze(result);
}

/**
 * @class WorldRegistry
 * @description 세션 entity handle과 활성/예약 visibility를 소유하는 범용 registry입니다.
 * 현재 수직 슬라이스에서는 GPU 적만 등록하며 위치·속도·flow stage는 GPU 권위입니다.
 */
export class WorldRegistry {
    /** @param {{capacity?:number}} [options={}] */
    constructor(options = {}) {
        this.capacity = requirePositiveSafeInteger(options.capacity ?? 16384, 'capacity');
        this.recordsByEntityId = new Map();
        this.lastIncarnationByEntityId = new Map();
        this.freeEntityIds = [];
        this.nextEntityId = FIRST_ENTITY_ID;
        this.activeCount = 0;
        this.reservedCount = 0;
        this.activeCountByKind = new Map();
        this.revision = 0;
        this.destroyed = false;
    }

    /**
     * backend batch가 수락하기 전 외부 활성 query에 보이지 않는 handle을 예약합니다.
     * @param {{kindId:string,definitionId?:string|null,createdAtTick:number}} descriptor
     * @returns {{entityId:number,incarnation:number}|null} capacity가 없으면 null입니다.
     */
    reserveEntity(descriptor) {
        this.#assertUsable();
        if ((this.activeCount + this.reservedCount) >= this.capacity) {
            return null;
        }
        const kindId = requireNonEmptyString(descriptor?.kindId, 'kindId');
        const definitionId = descriptor?.definitionId === undefined
            || descriptor.definitionId === null
            ? null
            : requireNonEmptyString(descriptor.definitionId, 'definitionId');
        const createdAtTick = requireNonNegativeSafeInteger(
            descriptor?.createdAtTick,
            'createdAtTick'
        );
        const entityId = this.freeEntityIds.length > 0
            ? this.freeEntityIds.pop()
            : this.nextEntityId++;
        if (entityId >= INVALID_HANDLE_COMPONENT) {
            throw new RangeError('WorldRegistry entity ID 공간이 고갈되었습니다.');
        }
        const incarnation = (this.lastIncarnationByEntityId.get(entityId) ?? 0) + 1;
        if (incarnation >= INVALID_HANDLE_COMPONENT) {
            throw new RangeError(`entity incarnation 공간이 고갈되었습니다: ${entityId}`);
        }
        this.lastIncarnationByEntityId.set(entityId, incarnation);
        const handle = Object.freeze({ entityId, incarnation });
        this.recordsByEntityId.set(entityId, {
            handle,
            kindId,
            definitionId,
            createdAtTick,
            metadata: null,
            state: 'reserved'
        });
        this.reservedCount++;
        this.revision++;
        return handle;
    }

    /** backend가 spawn batch를 수락한 뒤 예약을 활성 entity로 전환합니다. */
    activateReserved(handle, metadata = null) {
        this.#assertUsable();
        const record = this.#findExactRecord(handle, 'handle');
        if (!record || record.state !== 'reserved') {
            return false;
        }
        record.metadata = normalizeMetadata(metadata);
        record.state = 'active';
        this.reservedCount--;
        this.activeCount++;
        this.activeCountByKind.set(
            record.kindId,
            (this.activeCountByKind.get(record.kindId) ?? 0) + 1
        );
        this.revision++;
        return true;
    }

    /** backend가 spawn batch를 거부했을 때 보이지 않던 예약을 취소합니다. */
    cancelReservation(handle) {
        this.#assertUsable();
        const record = this.#findExactRecord(handle, 'handle');
        if (!record || record.state !== 'reserved') {
            return false;
        }
        this.recordsByEntityId.delete(record.handle.entityId);
        this.freeEntityIds.push(record.handle.entityId);
        this.reservedCount--;
        this.revision++;
        return true;
    }

    /** backend가 despawn을 확정한 활성 entity만 제거합니다. */
    remove(handle) {
        this.#assertUsable();
        const record = this.#findExactRecord(handle, 'handle');
        if (!record || record.state !== 'active') {
            return false;
        }
        this.recordsByEntityId.delete(record.handle.entityId);
        this.freeEntityIds.push(record.handle.entityId);
        this.activeCount--;
        const nextKindCount = (this.activeCountByKind.get(record.kindId) ?? 1) - 1;
        if (nextKindCount > 0) {
            this.activeCountByKind.set(record.kindId, nextKindCount);
        } else {
            this.activeCountByKind.delete(record.kindId);
        }
        this.revision++;
        return true;
    }

    /** @returns {boolean} incarnation까지 일치하는 활성 entity인지 여부입니다. */
    has(handle) {
        if (this.destroyed) {
            return false;
        }
        const record = this.#findExactRecord(handle, 'handle');
        return record?.state === 'active';
    }

    /**
     * 활성 entity의 복제 가능한 view를 caller scratch에 기록합니다.
     * @returns {object|null} 동일 out 또는 null입니다.
     */
    copyEntityView(handle, out = {}) {
        if (this.destroyed) {
            return null;
        }
        const record = this.#findExactRecord(handle, 'handle');
        if (!record || record.state !== 'active') {
            return null;
        }
        out.entityId = record.handle.entityId;
        out.incarnation = record.handle.incarnation;
        out.kindId = record.kindId;
        out.definitionId = record.definitionId;
        out.createdAtTick = record.createdAtTick;
        out.metadata = record.metadata;
        return out;
    }

    /** 활성 handle을 등록 순서대로 caller 배열에 복사합니다. */
    copyActiveHandlesInto(out, options = {}) {
        if (!Array.isArray(out)) {
            throw new TypeError('active handle 출력은 배열이어야 합니다.');
        }
        out.length = 0;
        if (this.destroyed) {
            return out;
        }
        const kindId = options.kindId ?? null;
        if (kindId !== null) {
            requireNonEmptyString(kindId, 'kindId');
        }
        for (const record of this.recordsByEntityId.values()) {
            if (record.state === 'active' && (kindId === null || record.kindId === kindId)) {
                out.push(record.handle);
            }
        }
        return out;
    }

    getActiveCount(kindId = null) {
        if (kindId === null || kindId === undefined) {
            return this.activeCount;
        }
        return this.activeCountByKind.get(requireNonEmptyString(kindId, 'kindId')) ?? 0;
    }

    getReservedCount() {
        return this.reservedCount;
    }

    getRevision() {
        return this.revision;
    }

    getStatus() {
        return Object.freeze({
            capacity: this.capacity,
            activeCount: this.activeCount,
            reservedCount: this.reservedCount,
            revision: this.revision,
            destroyed: this.destroyed
        });
    }

    /** 모든 handle을 무효화하되 같은 session에서 ID 재사용 가능성을 보존합니다. */
    clear() {
        if (this.destroyed) {
            return;
        }
        const reusableIds = new Set(this.freeEntityIds);
        for (const entityId of this.recordsByEntityId.keys()) {
            reusableIds.add(entityId);
        }
        this.freeEntityIds = [...reusableIds].sort((left, right) => right - left);
        this.recordsByEntityId.clear();
        this.activeCount = 0;
        this.reservedCount = 0;
        this.activeCountByKind.clear();
        this.revision++;
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        this.clear();
        this.destroyed = true;
    }

    #findExactRecord(handle, label) {
        const normalized = normalizeHandle(handle, label);
        const record = this.recordsByEntityId.get(normalized.entityId);
        return record?.handle.incarnation === normalized.incarnation ? record : null;
    }

    #assertUsable() {
        if (this.destroyed) {
            throw new Error('destroy된 WorldRegistry는 변경할 수 없습니다.');
        }
    }
}
