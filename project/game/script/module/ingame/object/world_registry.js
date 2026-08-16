import {
    ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID,
    normalizeEnemyAtomicTransformDescriptor
} from '../contract/enemy_atomic_transform_contract.js';

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

function freezeHandle(source) {
    return Object.freeze({
        entityId: source.entityId,
        incarnation: source.incarnation
    });
}

function snapshotOwnDataProperties(source, allowedKeys, label) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new TypeError(`${label}은 object여야 합니다.`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(source);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (ownKeys.some((key) => typeof key === 'symbol')) {
        throw new TypeError(`${label}에는 symbol key를 허용하지 않습니다.`);
    }
    const snapshot = Object.create(null);
    for (const key of ownKeys) {
        if (!allowedKeys.has(key)) {
            throw new RangeError(`${label}에 알 수 없는 필드가 있습니다: ${key}`);
        }
        const descriptor = descriptors[key];
        if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
            throw new TypeError(`${label}.${key}은 getter/setter일 수 없습니다.`);
        }
        snapshot[key] = descriptor.value;
    }
    return snapshot;
}

function snapshotDenseArrayValues(
    source,
    maximumLength,
    label,
    minimumLength = 1
) {
    if (!Array.isArray(source)) {
        throw new TypeError(`${label}은 array여야 합니다.`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(source);
    const ownKeys = Reflect.ownKeys(descriptors);
    const lengthDescriptor = descriptors.length;
    const length = lengthDescriptor?.value;
    if (!lengthDescriptor
        || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')
        || !Number.isSafeInteger(length)
        || length < minimumLength
        || length > maximumLength
        || ownKeys.length !== length + 1
        || ownKeys.some((key) => {
            if (key === 'length') {
                return false;
            }
            if (typeof key !== 'string') {
                return true;
            }
            const index = Number(key);
            return !Number.isSafeInteger(index)
                || index < 0
                || index >= length
                || String(index) !== key;
        })) {
        throw new TypeError(`${label}은 bounded dense data array여야 합니다.`);
    }
    const values = [];
    for (let index = 0; index < length; index++) {
        const descriptor = descriptors[index];
        if (!descriptor
            || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
            throw new TypeError(`${label}[${index}]는 data property여야 합니다.`);
        }
        values.push(descriptor.value);
    }
    return values;
}

const ATOMIC_TRANSFORM_REQUEST_KEYS = new Set(['transforms']);
const ATOMIC_TRANSFORM_ENTRY_KEYS = new Set([
    'topologyId',
    'sourceHandles',
    'destination',
    'destinations',
    'effectTransferDestinationIndex'
]);
const ACTIVE_METADATA_MUTATION_REQUEST_KEYS = new Set(['mutations']);
const ACTIVE_METADATA_MUTATION_ENTRY_KEYS = new Set([
    'handle',
    'expectedMetadata',
    'expectedMetadataRevision',
    'nextMetadata'
]);

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
    const result = Object.create(null);
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
 * Active metadata transaction은 accessor를 실행하지 않고 own primitive data만
 * 즉시 복제합니다. Registry metadata는 flat scalar contract이므로 이 snapshot이
 * 곧 complete deep snapshot입니다.
 */
function snapshotActiveMetadata(source, label) {
    if (source === undefined || source === null) {
        return null;
    }
    const prototype = typeof source === 'object'
        ? Object.getPrototypeOf(source)
        : null;
    const isPlainObject = prototype === null
        || (prototype !== null && Object.getPrototypeOf(prototype) === null);
    if (!source || typeof source !== 'object' || !isPlainObject) {
        throw new TypeError(`${label}은 plain object여야 합니다.`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(source);
    const result = Object.create(null);
    for (const key of Reflect.ownKeys(descriptors)) {
        if (typeof key !== 'string') {
            throw new TypeError(`${label}에는 symbol key를 허용하지 않습니다.`);
        }
        const descriptor = descriptors[key];
        if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
            throw new TypeError(`${label}.${key}은 getter/setter일 수 없습니다.`);
        }
        const value = descriptor.value;
        if (value !== null
            && value !== undefined
            && typeof value !== 'string'
            && typeof value !== 'number'
            && typeof value !== 'boolean') {
            throw new TypeError(`${label}은 primitive 값만 허용합니다: ${key}`);
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
    #activeMetadataMutationAuthority;
    #activeMetadataMutationGeneration;
    #activeMetadataMutationBatchPlans;

    /**
     * @param {{
     * capacity?:number,
     * atomicTransformAuthority?:object|null,
     * activeMetadataMutationAuthority?:object|null
     * }} [options={}]
     */
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
        const activeMetadataMutationAuthority
            = options.activeMetadataMutationAuthority ?? null;
        if (activeMetadataMutationAuthority !== null
            && (typeof activeMetadataMutationAuthority !== 'object'
                || Array.isArray(activeMetadataMutationAuthority))) {
            throw new TypeError(
                'activeMetadataMutationAuthority는 opaque object여야 합니다.'
            );
        }
        this.#activeMetadataMutationAuthority = activeMetadataMutationAuthority;
        this.#activeMetadataMutationGeneration = 1;
        this.#activeMetadataMutationBatchPlans = new WeakMap();
        this.destroyed = false;
    }

    /**
     * backend batch가 수락하기 전 외부 활성 query에 보이지 않는 handle을 예약합니다.
     * @param {{kindId:string,definitionId?:string|null,createdAtTick:number}} descriptor
     * @param {{excludedEntityIds?:Set<number>|null}} [options={}] - 같은 fixed boundary에서 backend slot이 아직 퇴역하지 않은 ID를 피합니다.
     * @returns {{entityId:number,incarnation:number}|null} capacity가 없으면 null입니다.
     */
    reserveEntity(descriptor, options = {}) {
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
        const excludedEntityIds = options?.excludedEntityIds ?? null;
        if (excludedEntityIds !== null && !(excludedEntityIds instanceof Set)) {
            throw new TypeError('excludedEntityIds는 Set이어야 합니다.');
        }
        let entityId = null;
        const deferredFreeEntityIds = [];
        while (this.freeEntityIds.length > 0) {
            const candidate = this.freeEntityIds.pop();
            if (excludedEntityIds?.has(candidate) === true) {
                deferredFreeEntityIds.push(candidate);
                continue;
            }
            entityId = candidate;
            break;
        }
        for (let index = deferredFreeEntityIds.length - 1; index >= 0; index--) {
            this.freeEntityIds.push(deferredFreeEntityIds[index]);
        }
        if (entityId === null) {
            entityId = this.nextEntityId++;
        }
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
            metadataRevision: 0,
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
        record.metadataRevision = 1;
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

    /**
     * 동일 actor payload execution의 reservation 전체를 0-or-N으로 활성화합니다.
     * 모든 exact identity와 flat metadata를 먼저 snapshot하므로 변이 loop은
     * 예외 없이 전체 성공합니다.
     */
    activateReservedBatch(entries) {
        this.#assertUsable();
        if (!Array.isArray(entries) || entries.length === 0) {
            throw new TypeError('reserved activation batch는 비어 있지 않은 배열이어야 합니다.');
        }
        const keys = new Set();
        const staged = entries.map((entry, index) => {
            const exact = normalizeHandle(
                entry?.handle,
                `entries[${index}].handle`
            );
            const key = `${exact.entityId}:${exact.incarnation}`;
            if (keys.has(key)) {
                throw new RangeError('reserved activation batch handle이 중복됩니다.');
            }
            keys.add(key);
            const record = this.#findExactRecord(exact, 'handle');
            if (!record || record.state !== 'reserved') {
                return null;
            }
            return Object.freeze({
                record,
                metadata: normalizeMetadata(entry?.metadata ?? null)
            });
        });
        if (staged.some((entry) => entry === null)) {
            return Object.freeze({
                accepted: false,
                activatedCount: 0,
                reason: 'stale-reservation'
            });
        }
        for (const { record, metadata } of staged) {
            record.metadata = metadata;
            record.metadataRevision = 1;
            record.state = 'active';
            this.activeCountByKind.set(
                record.kindId,
                (this.activeCountByKind.get(record.kindId) ?? 0) + 1
            );
        }
        this.reservedCount -= staged.length;
        this.activeCount += staged.length;
        this.revision++;
        return Object.freeze({
            accepted: true,
            activatedCount: staged.length,
            handles: Object.freeze(staged.map(({ record }) => record.handle))
        });
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
     * Active entity identity를 유지한 채 frozen metadata reference만 교체할 batch를
     * 0-mutation으로 준비합니다. Token은 current global revision과 각 record의
     * metadata object identity/revision에 결속됩니다.
     */
    preflightActiveMetadataMutationBatch(request, authority = null) {
        this.#assertUsable();
        this.#assertActiveMetadataMutationAuthority(authority);
        const requestSnapshot = snapshotOwnDataProperties(
            request,
            ACTIVE_METADATA_MUTATION_REQUEST_KEYS,
            'activeMetadataMutationBatch'
        );
        const requestedMutations = snapshotDenseArrayValues(
            requestSnapshot.mutations,
            this.capacity,
            'activeMetadataMutationBatch.mutations',
            0
        );
        if (requestedMutations.length === 0) {
            return Object.freeze({
                accepted: false,
                reason: 'active-metadata-mutation-empty-batch',
                retryable: false
            });
        }
        const claimedEntityIds = new Set();
        const mutations = [];
        for (let index = 0; index < requestedMutations.length; index++) {
            const mutation = snapshotOwnDataProperties(
                requestedMutations[index],
                ACTIVE_METADATA_MUTATION_ENTRY_KEYS,
                `mutations[${index}]`
            );
            const handle = freezeHandle(normalizeHandle(
                mutation.handle,
                `mutations[${index}].handle`
            ));
            if (claimedEntityIds.has(handle.entityId)) {
                return Object.freeze({
                    accepted: false,
                    reason: 'active-metadata-mutation-duplicate-handle',
                    retryable: false
                });
            }
            claimedEntityIds.add(handle.entityId);
            const expectedMetadataRevision = requirePositiveSafeInteger(
                mutation.expectedMetadataRevision,
                `mutations[${index}].expectedMetadataRevision`
            );
            const record = this.#findExactRecord(
                handle,
                `mutations[${index}].handle`
            );
            if (!record
                || record.state !== 'active'
                || record.metadata !== mutation.expectedMetadata
                || record.metadataRevision !== expectedMetadataRevision) {
                return Object.freeze({
                    accepted: false,
                    reason: 'active-metadata-mutation-stale',
                    retryable: false
                });
            }
            const nextMetadata = snapshotActiveMetadata(
                mutation.nextMetadata,
                `mutations[${index}].nextMetadata`
            );
            const nextMetadataRevision = requirePositiveSafeInteger(
                expectedMetadataRevision + 1,
                `mutations[${index}].nextMetadataRevision`
            );
            mutations.push(Object.freeze({
                handle,
                record,
                expectedMetadata: mutation.expectedMetadata,
                expectedMetadataRevision,
                nextMetadata,
                nextMetadataRevision
            }));
        }
        const token = Object.freeze({});
        const plan = Object.freeze({
            generation: this.#activeMetadataMutationGeneration,
            revision: this.revision,
            mutations: Object.freeze(mutations)
        });
        this.#activeMetadataMutationBatchPlans.set(token, plan);
        return Object.freeze({
            accepted: true,
            registryRevision: plan.revision,
            mutations: Object.freeze(mutations.map((mutation) => Object.freeze({
                handle: mutation.handle,
                expectedMetadataRevision: mutation.expectedMetadataRevision,
                nextMetadataRevision: mutation.nextMetadataRevision
            }))),
            token
        });
    }

    cancelActiveMetadataMutationBatch(token, authority = null) {
        this.#assertUsable();
        this.#assertActiveMetadataMutationAuthority(authority);
        if (!token || typeof token !== 'object'
            || !this.#activeMetadataMutationBatchPlans.has(token)) {
            return false;
        }
        this.#activeMetadataMutationBatchPlans.delete(token);
        return true;
    }

    /** 첫 commit 시도에서 token을 소비하고 batch 전체 metadata를 한 번에 게시합니다. */
    commitActiveMetadataMutationBatch(token, authority = null) {
        this.#assertUsable();
        this.#assertActiveMetadataMutationAuthority(authority);
        const plan = token && typeof token === 'object'
            ? this.#activeMetadataMutationBatchPlans.get(token)
            : null;
        if (plan) {
            this.#activeMetadataMutationBatchPlans.delete(token);
        }
        if (!plan
            || plan.generation !== this.#activeMetadataMutationGeneration
            || plan.revision !== this.revision) {
            return null;
        }
        for (const mutation of plan.mutations) {
            const record = this.#findExactRecord(
                mutation.handle,
                'activeMetadataMutationHandle'
            );
            if (record !== mutation.record
                || record.state !== 'active'
                || record.metadata !== mutation.expectedMetadata
                || record.metadataRevision !== mutation.expectedMetadataRevision) {
                return null;
            }
        }
        for (const mutation of plan.mutations) {
            mutation.record.metadata = mutation.nextMetadata;
            mutation.record.metadataRevision = mutation.nextMetadataRevision;
        }
        this.revision++;
        return Object.freeze({
            accepted: true,
            committed: true,
            registryRevision: this.revision,
            mutations: Object.freeze(plan.mutations.map((mutation) => Object.freeze({
                handle: mutation.handle,
                previousMetadata: mutation.expectedMetadata,
                metadata: mutation.nextMetadata,
                metadataRevision: mutation.nextMetadataRevision
            })))
        });
    }

    /**
     * 같은 fixed boundary의 disjoint transform 전부를 0-mutation으로 preflight합니다.
     * 하나라도 stale/overlap/overflow이면 전체 batch를 거절합니다.
     */
    preflightAtomicTransformBatch(request, authority = null) {
        this.#assertUsable();
        this.#assertAtomicTransformAuthority(authority);
        const requestSnapshot = snapshotOwnDataProperties(
            request,
            ATOMIC_TRANSFORM_REQUEST_KEYS,
            'atomicTransformBatch'
        );
        const requestedTransforms = snapshotDenseArrayValues(
            requestSnapshot.transforms,
            this.capacity,
            'atomicTransformBatch.transforms'
        );
        const claimedEntityIds = new Set();
        const destinationEntityIds = new Set();
        const planSeeds = [];
        const releasedEntityIds = [];
        let sourceCount = 0;
        let destinationCount = 0;
        for (let transformIndex = 0;
            transformIndex < requestedTransforms.length;
            transformIndex++) {
            const transform = snapshotOwnDataProperties(
                requestedTransforms[transformIndex],
                ATOMIC_TRANSFORM_ENTRY_KEYS,
                `transforms[${transformIndex}]`
            );
            const hasDestination = Object.prototype.hasOwnProperty.call(
                transform,
                'destination'
            );
            const hasDestinations = Object.prototype.hasOwnProperty.call(
                transform,
                'destinations'
            );
            if (hasDestination === hasDestinations) {
                throw new RangeError(
                    `transforms[${transformIndex}]는 destination 또는 destinations 하나만 가져야 합니다.`
                );
            }
            const hasLegacyDestination = hasDestination;
            const legacyDestinations = hasDestinations
                ? transform.destinations
                : [transform.destination];
            const topologyId = transform.topologyId
                ?? (hasLegacyDestination
                    ? ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.MANY_TO_ONE
                    : null);
            const isLegacyManyToOne = hasLegacyDestination
                && topologyId
                    === ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.MANY_TO_ONE;
            if (hasLegacyDestination && !isLegacyManyToOne) {
                throw new RangeError(
                    `transforms[${transformIndex}].destination singular alias는 legacy MANY_TO_ONE에만 허용됩니다.`
                );
            }
            if (hasLegacyDestination
                && transform.effectTransferDestinationIndex !== undefined
                && transform.effectTransferDestinationIndex !== 0) {
                throw new RangeError(
                    `transforms[${transformIndex}].effectTransferDestinationIndex는 exact 0이어야 합니다.`
                );
            }
            const descriptor = normalizeEnemyAtomicTransformDescriptor({
                topologyId,
                sourceHandles: transform.sourceHandles,
                destinations: legacyDestinations,
                effectTransferDestinationIndex: isLegacyManyToOne
                    ? 0
                    : transform.effectTransferDestinationIndex
            }, `transforms[${transformIndex}]`);
            const sourceHandles = descriptor.sourceHandles;
            for (const handle of sourceHandles) {
                if (claimedEntityIds.has(handle.entityId)) {
                    return null;
                }
                claimedEntityIds.add(handle.entityId);
            }
            const sourceRecords = sourceHandles.map((handle) => (
                this.#findExactRecord(handle, 'atomicTransformSource')
            ));
            if (sourceRecords.some((record) => record?.state !== 'active')) {
                return null;
            }
            const root = sourceHandles[0];
            if ((this.lastIncarnationByEntityId.get(root.entityId) ?? 0)
                    !== root.incarnation
                || root.incarnation >= (INVALID_HANDLE_COMPONENT - 1)
                || this.recordsByEntityId.get(root.entityId)
                    !== sourceRecords[0]) {
                return null;
            }
            const destinations = descriptor.destinations.map((destination, index) => (
                Object.freeze({
                    kindId: requireNonEmptyString(
                        destination?.kindId,
                        `transforms[${transformIndex}].destinations[${index}].kindId`
                    ),
                    definitionId: destination?.definitionId === undefined
                        || destination.definitionId === null
                        ? null
                        : requireNonEmptyString(
                            destination.definitionId,
                            `transforms[${transformIndex}].destinations[${index}].definitionId`
                        ),
                    createdAtTick: requireNonNegativeSafeInteger(
                        destination?.createdAtTick,
                        `transforms[${transformIndex}].destinations[${index}].createdAtTick`
                    ),
                    metadata: normalizeMetadata(destination?.metadata ?? null)
                })
            ));
            sourceCount += sourceHandles.length;
            destinationCount += destinations.length;
            for (let sourceIndex = 1;
                sourceIndex < sourceHandles.length;
                sourceIndex++) {
                releasedEntityIds.push(sourceHandles[sourceIndex].entityId);
            }
            planSeeds.push(Object.freeze({
                topologyId: descriptor.topologyId,
                sourceHandles: Object.freeze(sourceHandles.map(freezeHandle)),
                sourceRecords: Object.freeze([...sourceRecords]),
                destinations: Object.freeze(destinations),
                effectTransferDestinationIndex:
                    descriptor.effectTransferDestinationIndex
            }));
        }
        const finalOccupiedCount = this.activeCount + this.reservedCount
            - sourceCount + destinationCount;
        if (finalOccupiedCount > this.capacity) {
            return Object.freeze({
                accepted: false,
                reason: 'atomic-transform-capacity',
                retryable: true,
                capacity: this.capacity,
                occupiedCount: this.activeCount + this.reservedCount,
                requiredCount: finalOccupiedCount
            });
        }
        if (this.activeCount < sourceCount) {
            return null;
        }

        // Additional destination identity는 source removal 후 사용 가능한
        // non-root ID와 기존 free stack을 포함한 private allocator snapshot에서만
        // 결정합니다. Token commit 전에는 reservation/handle이 노출되지 않습니다.
        const finalFreeEntityIds = [...this.freeEntityIds, ...releasedEntityIds];
        let nextEntityId = this.nextEntityId;
        const plans = planSeeds.map((seed, transformIndex) => {
            const root = seed.sourceHandles[0];
            if (root.incarnation >= INVALID_HANDLE_COMPONENT - 1) {
                throw new RangeError(
                    `atomic transform root incarnation 공간이 고갈되었습니다: ${root.entityId}`
                );
            }
            const destinationHandles = [freezeHandle({
                entityId: root.entityId,
                incarnation: root.incarnation + 1
            })];
            destinationEntityIds.add(root.entityId);
            for (let destinationIndex = 1;
                destinationIndex < seed.destinations.length;
                destinationIndex++) {
                const entityId = finalFreeEntityIds.length > 0
                    ? finalFreeEntityIds.pop()
                    : nextEntityId++;
                if (entityId >= INVALID_HANDLE_COMPONENT) {
                    throw new RangeError('WorldRegistry entity ID 공간이 고갈되었습니다.');
                }
                const incarnation
                    = (this.lastIncarnationByEntityId.get(entityId) ?? 0) + 1;
                if (incarnation >= INVALID_HANDLE_COMPONENT) {
                    throw new RangeError(
                        `entity incarnation 공간이 고갈되었습니다: ${entityId}`
                    );
                }
                if (destinationEntityIds.has(entityId)) {
                    throw new Error(
                        `atomic transform destination allocator가 중복 ID를 생성했습니다: ${transformIndex}/${entityId}`
                    );
                }
                destinationEntityIds.add(entityId);
                destinationHandles.push(freezeHandle({ entityId, incarnation }));
            }
            return Object.freeze({
                ...seed,
                destinationHandles: Object.freeze(destinationHandles)
            });
        });
        const token = Object.freeze({});
        const plan = Object.freeze({
            generation: this.#atomicTransformGeneration,
            revision: this.revision,
            sourceCount,
            destinationCount,
            finalFreeEntityIds: Object.freeze([...finalFreeEntityIds]),
            nextEntityId,
            transforms: Object.freeze(plans)
        });
        this.#atomicTransformBatchPlans.set(token, plan);
        return Object.freeze({
            accepted: true,
            token,
            registryRevision: this.revision,
            transforms: Object.freeze(plans.map((entry) => Object.freeze({
                topologyId: entry.topologyId,
                sourceHandles: entry.sourceHandles,
                destinationHandles: entry.destinationHandles,
                effectTransferDestinationIndex:
                    entry.effectTransferDestinationIndex,
                ...(entry.destinationHandles.length === 1
                    ? { destinationHandle: entry.destinationHandles[0] }
                    : null)
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
            for (let index = 0; index < transform.sourceHandles.length; index++) {
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
        if (this.activeCount < plan.sourceCount) {
            return null;
        }

        // Mixed topology batch에서도 released source ID를 child1이 재사용할 수
        // 있으므로 모든 source를 먼저 제거한 뒤 destination을 publish합니다.
        for (const transform of plan.transforms) {
            for (const record of transform.sourceRecords) {
                const nextKindCount
                    = (this.activeCountByKind.get(record.kindId) ?? 1) - 1;
                if (nextKindCount > 0) {
                    this.activeCountByKind.set(record.kindId, nextKindCount);
                } else {
                    this.activeCountByKind.delete(record.kindId);
                }
                this.recordsByEntityId.delete(record.handle.entityId);
            }
        }
        for (const transform of plan.transforms) {
            for (let destinationIndex = 0;
                destinationIndex < transform.destinations.length;
                destinationIndex++) {
                const destination = transform.destinations[destinationIndex];
                const destinationHandle
                    = transform.destinationHandles[destinationIndex];
                this.recordsByEntityId.set(destinationHandle.entityId, {
                    handle: destinationHandle,
                    kindId: destination.kindId,
                    definitionId: destination.definitionId,
                    createdAtTick: destination.createdAtTick,
                    metadata: destination.metadata,
                    metadataRevision: 1,
                    state: 'active'
                });
                this.lastIncarnationByEntityId.set(
                    destinationHandle.entityId,
                    destinationHandle.incarnation
                );
                this.activeCountByKind.set(
                    destination.kindId,
                    (this.activeCountByKind.get(destination.kindId) ?? 0) + 1
                );
            }
        }
        this.freeEntityIds = [...plan.finalFreeEntityIds];
        this.nextEntityId = plan.nextEntityId;
        this.activeCount = this.activeCount - plan.sourceCount
            + plan.destinationCount;
        this.revision++;
        return Object.freeze({
            accepted: true,
            committed: true,
            registryRevision: this.revision,
            transforms: Object.freeze(plan.transforms.map((transform) => (
                Object.freeze({
                    topologyId: transform.topologyId,
                    sourceHandles: transform.sourceHandles,
                    destinationHandles: transform.destinationHandles,
                    effectTransferDestinationIndex:
                        transform.effectTransferDestinationIndex,
                    ...(transform.destinationHandles.length === 1
                        ? { destinationHandle: transform.destinationHandles[0] }
                        : null)
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
        out.metadataRevision = record.metadataRevision;
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
        this.#activeMetadataMutationGeneration++;
        this.#activeMetadataMutationBatchPlans = new WeakMap();
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

    #assertActiveMetadataMutationAuthority(authority) {
        if (this.#activeMetadataMutationAuthority === null
            || authority !== this.#activeMetadataMutationAuthority) {
            throw new Error('active metadata mutation registry authority가 필요합니다.');
        }
    }

    #assertUsable() {
        if (this.destroyed) {
            throw new Error('destroy된 WorldRegistry는 변경할 수 없습니다.');
        }
    }
}
