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

function compareHandles(left, right) {
    return left.entityId - right.entityId
        || left.incarnation - right.incarnation;
}

function freezeHandle(source) {
    return Object.freeze({
        entityId: source.entityId,
        incarnation: source.incarnation
    });
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
    const prototype = typeof source === 'object'
        ? Object.getPrototypeOf(source)
        : null;
    const isPlainObject = prototype === null
        || (prototype !== null && Object.getPrototypeOf(prototype) === null);
    if (!source || typeof source !== 'object' || !isPlainObject) {
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
    #atomicTransformAuthority;
    #atomicTransformGeneration;
    #atomicTransformBatchPlans;

    /** @param {{capacity?:number,atomicTransformAuthority?:object|null}} [options={}] */
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
        const atomicTransformAuthority = options.atomicTransformAuthority ?? null;
        if (atomicTransformAuthority !== null
            && (typeof atomicTransformAuthority !== 'object'
                || Array.isArray(atomicTransformAuthority))) {
            throw new TypeError('atomicTransformAuthority는 opaque object여야 합니다.');
        }
        this.#atomicTransformAuthority = atomicTransformAuthority;
        // Atomic transform token의 내용은 registry private WeakMap에만 둡니다.
        // token 자체는 opaque/single-use이며 clear/replacement generation을 넘을 수 없습니다.
        this.#atomicTransformGeneration = 1;
        this.#atomicTransformBatchPlans = new WeakMap();
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

    /**
     * 같은 fixed boundary의 disjoint transform 전부를 0-mutation으로 preflight합니다.
     * 하나라도 stale/overlap/overflow이면 전체 batch를 거절합니다.
     */
    preflightAtomicTransformBatch(request, authority = null) {
        this.#assertUsable();
        this.#assertAtomicTransformAuthority(authority);
        if (!Array.isArray(request?.transforms)
            || request.transforms.length === 0
            || request.transforms.length > this.capacity) {
            throw new TypeError('atomic transform batch에는 bounded transform 배열이 필요합니다.');
        }
        const claimedEntityIds = new Set();
        const plans = [];
        for (let transformIndex = 0;
            transformIndex < request.transforms.length;
            transformIndex++) {
            const transform = request.transforms[transformIndex];
            if (!Array.isArray(transform?.sourceHandles)
                || transform.sourceHandles.length !== 2) {
                throw new TypeError(
                    `transforms[${transformIndex}].sourceHandles는 정확히 두 개여야 합니다.`
                );
            }
            const sourceHandles = transform.sourceHandles.map((handle, index) => (
                normalizeHandle(
                    handle,
                    `transforms[${transformIndex}].sourceHandles[${index}]`
                )
            )).sort(compareHandles);
            if (sourceHandles[0].entityId === sourceHandles[1].entityId
                || claimedEntityIds.has(sourceHandles[0].entityId)
                || claimedEntityIds.has(sourceHandles[1].entityId)) {
                return null;
            }
            const sourceRecords = sourceHandles.map((handle) => (
                this.#findExactRecord(handle, 'atomicTransformSource')
            ));
            if (sourceRecords.some((record) => record?.state !== 'active')) {
                return null;
            }
            claimedEntityIds.add(sourceHandles[0].entityId);
            claimedEntityIds.add(sourceHandles[1].entityId);
            const destination = transform.destination;
            const kindId = requireNonEmptyString(
                destination?.kindId,
                `transforms[${transformIndex}].destination.kindId`
            );
            const definitionId = destination?.definitionId === undefined
                || destination.definitionId === null
                ? null
                : requireNonEmptyString(
                    destination.definitionId,
                    `transforms[${transformIndex}].destination.definitionId`
                );
            const createdAtTick = requireNonNegativeSafeInteger(
                destination?.createdAtTick,
                `transforms[${transformIndex}].destination.createdAtTick`
            );
            const metadata = normalizeMetadata(destination?.metadata ?? null);
            const root = sourceHandles[0];
            if ((this.lastIncarnationByEntityId.get(root.entityId) ?? 0)
                    !== root.incarnation
                || root.incarnation >= (INVALID_HANDLE_COMPONENT - 1)
                || this.recordsByEntityId.get(root.entityId)
                    !== sourceRecords[0]) {
                return null;
            }
            plans.push(Object.freeze({
                sourceHandles: Object.freeze(sourceHandles.map(freezeHandle)),
                sourceRecords: Object.freeze([...sourceRecords]),
                destinationHandle: freezeHandle({
                    entityId: root.entityId,
                    incarnation: root.incarnation + 1
                }),
                destination: Object.freeze({
                    kindId,
                    definitionId,
                    createdAtTick,
                    metadata
                })
            }));
        }
        const token = Object.freeze({});
        const plan = Object.freeze({
            generation: this.#atomicTransformGeneration,
            revision: this.revision,
            transforms: Object.freeze(plans)
        });
        this.#atomicTransformBatchPlans.set(token, plan);
        return Object.freeze({
            token,
            registryRevision: this.revision,
            transforms: Object.freeze(plans.map((entry) => Object.freeze({
                sourceHandles: entry.sourceHandles,
                destinationHandle: entry.destinationHandle
            })))
        });
    }

    cancelAtomicTransformBatch(token, authority = null) {
        this.#assertUsable();
        this.#assertAtomicTransformAuthority(authority);
        if (!token || typeof token !== 'object'
            || !this.#atomicTransformBatchPlans.has(token)) {
            return false;
        }
        this.#atomicTransformBatchPlans.delete(token);
        return true;
    }

    /** all-preflight batch를 sources remove + destinations activate 1회로 publish합니다. */
    commitAtomicTransformBatch(token, authority = null) {
        this.#assertUsable();
        this.#assertAtomicTransformAuthority(authority);
        const plan = token && typeof token === 'object'
            ? this.#atomicTransformBatchPlans.get(token)
            : null;
        // 첫 commit 시도 자체가 token을 소비합니다. stale/forged/revision 실패를
        // 고친 뒤 같은 token으로 재시도할 수 없습니다.
        if (plan) {
            this.#atomicTransformBatchPlans.delete(token);
        }
        if (!plan
            || plan.generation !== this.#atomicTransformGeneration
            || plan.revision !== this.revision) {
            return null;
        }
        for (const transform of plan.transforms) {
            for (let index = 0; index < 2; index++) {
                const record = this.#findExactRecord(
                    transform.sourceHandles[index],
                    'atomicTransformSource'
                );
                if (record !== transform.sourceRecords[index]
                    || record.state !== 'active') {
                    return null;
                }
            }
            const root = transform.sourceHandles[0];
            if ((this.lastIncarnationByEntityId.get(root.entityId) ?? 0)
                    !== root.incarnation
                || this.recordsByEntityId.get(root.entityId)
                    !== transform.sourceRecords[0]) {
                return null;
            }
        }
        if (this.activeCount < (plan.transforms.length * 2)) {
            return null;
        }

        for (const transform of plan.transforms) {
            const root = transform.sourceHandles[0];
            const other = transform.sourceHandles[1];
            for (const record of transform.sourceRecords) {
                const nextKindCount
                    = (this.activeCountByKind.get(record.kindId) ?? 1) - 1;
                if (nextKindCount > 0) {
                    this.activeCountByKind.set(record.kindId, nextKindCount);
                } else {
                    this.activeCountByKind.delete(record.kindId);
                }
            }
            this.recordsByEntityId.delete(other.entityId);
            this.freeEntityIds.push(other.entityId);
            this.recordsByEntityId.set(root.entityId, {
                handle: transform.destinationHandle,
                kindId: transform.destination.kindId,
                definitionId: transform.destination.definitionId,
                createdAtTick: transform.destination.createdAtTick,
                metadata: transform.destination.metadata,
                state: 'active'
            });
            this.lastIncarnationByEntityId.set(
                root.entityId,
                transform.destinationHandle.incarnation
            );
            this.activeCountByKind.set(
                transform.destination.kindId,
                (this.activeCountByKind.get(transform.destination.kindId) ?? 0) + 1
            );
        }
        this.activeCount -= plan.transforms.length;
        this.revision++;
        return Object.freeze({
            committed: true,
            registryRevision: this.revision,
            transforms: Object.freeze(plan.transforms.map((transform) => (
                Object.freeze({
                    sourceHandles: transform.sourceHandles,
                    destinationHandle: transform.destinationHandle
                })
            )))
        });
    }

    /** @returns {boolean} incarnation까지 일치하는 활성 entity인지 여부입니다. */
    has(handle) {
        if (this.destroyed) {
            return false;
        }
        const record = this.#findExactRecord(handle, 'handle');
        return record?.state === 'active';
    }

    /** terminal fixed-program cancel preflight용 exact reservation query입니다. */
    hasReservation(handle) {
        if (this.destroyed) {
            return false;
        }
        const record = this.#findExactRecord(handle, 'handle');
        return record?.state === 'reserved';
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
        this.#atomicTransformGeneration++;
        this.#atomicTransformBatchPlans = new WeakMap();
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

    #assertAtomicTransformAuthority(authority) {
        if (this.#atomicTransformAuthority === null
            || authority !== this.#atomicTransformAuthority) {
            throw new Error('atomic transform registry authority가 필요합니다.');
        }
    }

    #assertUsable() {
        if (this.destroyed) {
            throw new Error('destroy된 WorldRegistry는 변경할 수 없습니다.');
        }
    }
}
