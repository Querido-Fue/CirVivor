/**
 * Enemy atomic transform의 topology와 privileged transaction port가 공유하는
 * stable vocabulary입니다. Content/profile이나 GPU 구현을 import하지 않습니다.
 */
export const ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID = Object.freeze({
    MANY_TO_ONE: 'MANY_TO_ONE',
    ONE_TO_MANY: 'ONE_TO_MANY',
    ONE_TO_ONE_DELAYED: 'ONE_TO_ONE_DELAYED'
});

const TOPOLOGY_CARDINALITY_BY_ID = Object.freeze({
    [ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.MANY_TO_ONE]: Object.freeze({
        sourceCount: 2,
        destinationCount: 1
    }),
    [ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_MANY]: Object.freeze({
        sourceCount: 1,
        destinationCount: 2
    }),
    [ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_ONE_DELAYED]: Object.freeze({
        sourceCount: 1,
        destinationCount: 1
    })
});

const VALID_TOPOLOGY_IDS = new Set(Object.values(
    ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID
));
const INVALID_HANDLE_COMPONENT = 0xffffffff;
const MAXIMUM_PLAIN_SNAPSHOT_ARRAY_LENGTH = 65536;

function requirePlainObject(value, label) {
    const prototype = value && typeof value === 'object'
        ? Object.getPrototypeOf(value)
        : null;
    const isPlainObject = prototype === null
        || (prototype !== null && Object.getPrototypeOf(prototype) === null);
    if (!value || typeof value !== 'object' || Array.isArray(value) || !isPlainObject) {
        throw new TypeError(`${label}은 plain object여야 합니다.`);
    }
    return value;
}

function snapshotExactOwnDataProperties(source, expectedKeys, label) {
    requirePlainObject(source, label);
    const descriptors = Object.getOwnPropertyDescriptors(source);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (ownKeys.some((key) => typeof key === 'symbol')
        || ownKeys.length !== expectedKeys.length
        || expectedKeys.some((key) => !ownKeys.includes(key))) {
        throw new RangeError(
            `${label}은 exact ${expectedKeys.join('/')} data property만 가져야 합니다.`
        );
    }
    const snapshot = Object.create(null);
    for (const key of expectedKeys) {
        const descriptor = descriptors[key];
        if (!descriptor
            || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
            throw new TypeError(`${label}.${key}은 getter/setter일 수 없습니다.`);
        }
        snapshot[key] = descriptor.value;
    }
    return snapshot;
}

function snapshotExactDenseArrayValues(source, expectedLength, label) {
    if (!Array.isArray(source)) {
        throw new TypeError(`${label}은 array여야 합니다.`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(source);
    const ownKeys = Reflect.ownKeys(descriptors);
    const lengthDescriptor = descriptors.length;
    if (!lengthDescriptor
        || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')
        || lengthDescriptor.value !== expectedLength
        || ownKeys.length !== expectedLength + 1
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
                || index >= expectedLength
                || String(index) !== key;
        })) {
        throw new RangeError(
            `${label}은 exact ${expectedLength}-item dense data array여야 합니다.`
        );
    }
    const values = [];
    for (let index = 0; index < expectedLength; index++) {
        const descriptor = descriptors[index];
        if (!descriptor
            || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
            throw new TypeError(`${label}[${index}]는 data property여야 합니다.`);
        }
        values.push(descriptor.value);
    }
    return values;
}

function materializePlainSnapshot(value, label, ancestors = new Set()) {
    if (value === null
        || value === undefined
        || typeof value === 'string'
        || typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new TypeError(`${label}에는 유한 숫자만 허용됩니다.`);
        }
        return value;
    }
    if (typeof value !== 'object') {
        throw new TypeError(`${label}에는 plain-data 값만 허용됩니다.`);
    }
    if (ancestors.has(value)) {
        throw new TypeError(`${label}에는 순환 참조를 허용하지 않습니다.`);
    }
    ancestors.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const descriptorKeys = Reflect.ownKeys(descriptors);
    const symbolKeys = descriptorKeys.filter((key) => typeof key === 'symbol');
    if (symbolKeys.length > 0) {
        ancestors.delete(value);
        throw new TypeError(`${label}에는 symbol key를 허용하지 않습니다.`);
    }
    let snapshot;
    if (Array.isArray(value)) {
        const lengthDescriptor = descriptors.length;
        if (!lengthDescriptor
            || !Object.prototype.hasOwnProperty.call(
                lengthDescriptor,
                'value'
            )
            || !Number.isSafeInteger(lengthDescriptor.value)
            || lengthDescriptor.value < 0
            || lengthDescriptor.value > MAXIMUM_PLAIN_SNAPSHOT_ARRAY_LENGTH) {
            ancestors.delete(value);
            throw new TypeError(`${label}.length는 bounded array data property여야 합니다.`);
        }
        const length = lengthDescriptor.value;
        if (descriptorKeys.length !== length + 1
            || descriptorKeys.some((key) => {
                if (key === 'length') {
                    return false;
                }
                const index = Number(key);
                return !Number.isSafeInteger(index)
                    || index < 0
                    || index >= length
                    || String(index) !== key;
            })) {
            ancestors.delete(value);
            throw new RangeError(`${label} array에는 index 외 key를 허용하지 않습니다.`);
        }
        snapshot = [];
        for (let index = 0; index < length; index++) {
            const descriptor = descriptors[index];
            if (!descriptor
                || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
                ancestors.delete(value);
                throw new TypeError(`${label}[${index}]는 dense data property여야 합니다.`);
            }
            snapshot.push(materializePlainSnapshot(
                descriptor.value,
                `${label}[${index}]`,
                ancestors
            ));
        }
    } else {
        requirePlainObject(value, label);
        // `__proto__`를 포함한 arbitrary plain-data key도 prototype setter로
        // 해석되지 않도록 destination snapshot은 null prototype을 사용합니다.
        snapshot = Object.create(null);
        for (const [key, descriptor] of Object.entries(descriptors)) {
            if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
                ancestors.delete(value);
                throw new TypeError(`${label}.${key}은 getter/setter일 수 없습니다.`);
            }
            snapshot[key] = materializePlainSnapshot(
                descriptor.value,
                `${label}.${key}`,
                ancestors
            );
        }
    }
    ancestors.delete(value);
    return Object.freeze(snapshot);
}

function requireHandleComponent(value, label) {
    if (typeof value !== 'number'
        || !Number.isSafeInteger(value)
        || value <= 0
        || value >= INVALID_HANDLE_COMPONENT) {
        throw new RangeError(`${label}은 reserved sentinel보다 작은 양의 정수여야 합니다.`);
    }
    return value;
}

function normalizeHandle(source, label) {
    const snapshot = snapshotExactOwnDataProperties(
        source,
        ['entityId', 'incarnation'],
        label
    );
    return Object.freeze({
        entityId: requireHandleComponent(
            snapshot.entityId,
            `${label}.entityId`
        ),
        incarnation: requireHandleComponent(
            snapshot.incarnation,
            `${label}.incarnation`
        )
    });
}

function compareHandles(left, right) {
    return left.entityId - right.entityId
        || left.incarnation - right.incarnation;
}

/** @returns {string} 검증된 stable topology ID입니다. */
export function normalizeEnemyAtomicTransformTopologyId(
    value,
    label = 'topologyId'
) {
    if (typeof value !== 'string' || !VALID_TOPOLOGY_IDS.has(value)) {
        throw new RangeError(`${label}은 알려진 Enemy atomic transform topology여야 합니다.`);
    }
    return value;
}

/** @returns {{sourceCount:number,destinationCount:number}} immutable cardinality입니다. */
export function getEnemyAtomicTransformTopologyCardinality(topologyId) {
    return TOPOLOGY_CARDINALITY_BY_ID[
        normalizeEnemyAtomicTransformTopologyId(topologyId)
    ];
}

/**
 * Host transaction descriptor의 topology/source/destination order를 고정합니다.
 * Destination object는 caller가 이미 plain-data snapshot으로 물질화한
 * registry/GPU intent이며, identity는 여기서 받지 않습니다.
 */
export function normalizeEnemyAtomicTransformDescriptor(
    source,
    label = 'atomicTransform'
) {
    const descriptor = snapshotExactOwnDataProperties(source, [
        'topologyId',
        'sourceHandles',
        'destinations',
        'effectTransferDestinationIndex'
    ], label);
    const rawTopologyId = descriptor.topologyId;
    const rawSourceHandles = descriptor.sourceHandles;
    const rawDestinations = descriptor.destinations;
    const effectTransferDestinationIndex
        = descriptor.effectTransferDestinationIndex;
    const topologyId = normalizeEnemyAtomicTransformTopologyId(
        rawTopologyId,
        `${label}.topologyId`
    );
    const cardinality = getEnemyAtomicTransformTopologyCardinality(topologyId);
    const sourceHandleValues = snapshotExactDenseArrayValues(
        rawSourceHandles,
        cardinality.sourceCount,
        `${label}.sourceHandles`
    );
    const destinationValues = snapshotExactDenseArrayValues(
        rawDestinations,
        cardinality.destinationCount,
        `${label}.destinations`
    );
    const sourceHandles = sourceHandleValues.map((handle, index) => (
        normalizeHandle(handle, `${label}.sourceHandles[${index}]`)
    ));
    for (let index = 1; index < sourceHandles.length; index++) {
        if (compareHandles(sourceHandles[index - 1], sourceHandles[index]) >= 0) {
            throw new RangeError(`${label}.sourceHandles는 exact handle ASC여야 합니다.`);
        }
    }
    const destinations = destinationValues.map((destination, index) => (
        materializePlainSnapshot(
            destination,
            `${label}.destinations[${index}]`
        )
    ));
    if (effectTransferDestinationIndex !== 0) {
        throw new RangeError(
            `${label}.effectTransferDestinationIndex는 exact 0이어야 합니다.`
        );
    }
    return Object.freeze({
        topologyId,
        sourceHandles: Object.freeze(sourceHandles),
        destinations: Object.freeze(destinations),
        effectTransferDestinationIndex
    });
}

/** Generic prepared transaction backend port를 fail-fast 검증합니다. */
export function assertEnemyAtomicTransformTransactionPort(
    source,
    label = 'enemyAtomicTransformTransactionPort'
) {
    requirePlainObject(source, label);
    for (const methodName of [
        'armPreparedAtomicTransformBatch',
        'commitArmedAtomicTransformBatch',
        'cancelArmedAtomicTransformBatch'
    ]) {
        if (typeof source[methodName] !== 'function') {
            throw new TypeError(`${label}.${methodName}()가 필요합니다.`);
        }
    }
    return source;
}
