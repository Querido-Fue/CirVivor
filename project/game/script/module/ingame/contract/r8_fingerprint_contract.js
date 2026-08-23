const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const UINT32_MAX = 0xffffffff;

function hashWord(hash, value) {
    return Math.imul((hash ^ (value >>> 0)) >>> 0, FNV_PRIME) >>> 0;
}

function hashString(hash, value) {
    let next = hashWord(hash, value.length);
    for (let index = 0; index < value.length; index++) {
        const code = value.charCodeAt(index);
        next = hashWord(next, code & 0xff);
        next = hashWord(next, code >>> 8);
    }
    return next;
}

function hashNumber(hash, value, label) {
    if (!Number.isSafeInteger(value)) {
        throw new RangeError(`${label}은 안전한 정수여야 합니다.`);
    }
    const negative = value < 0;
    let remaining = BigInt(negative ? -value : value);
    let next = hashWord(hash, negative ? 1 : 0);
    do {
        next = hashWord(next, Number(remaining & 0xffffffffn));
        remaining >>= 32n;
    } while (remaining > 0n);
    return next;
}

function hashValue(hash, value, label, ancestors) {
    if (value === null) return hashString(hash, 'null');
    if (typeof value === 'string') {
        return hashString(hashString(hash, 'string'), value);
    }
    if (typeof value === 'number') {
        return hashNumber(hashString(hash, 'number'), value, label);
    }
    if (typeof value === 'boolean') {
        return hashWord(hashString(hash, 'boolean'), value ? 1 : 0);
    }
    if (!value || typeof value !== 'object') {
        throw new TypeError(`${label}에는 직렬화할 수 없는 값이 있습니다.`);
    }
    if (ancestors.has(value)) {
        throw new RangeError(`${label}에는 순환 참조를 사용할 수 없습니다.`);
    }
    ancestors.add(value);
    let next;
    if (Array.isArray(value)) {
        next = hashWord(hashString(hash, 'array'), value.length);
        for (let index = 0; index < value.length; index++) {
            const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
            if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
                throw new RangeError(`${label}은 dense data 배열이어야 합니다.`);
            }
            next = hashValue(
                next,
                descriptor.value,
                `${label}[${index}]`,
                ancestors
            );
        }
        const extraKeys = Reflect.ownKeys(value).filter((key) => (
            key !== 'length'
            && !(typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key))
        ));
        if (extraKeys.length > 0) {
            throw new RangeError(`${label} 배열에는 추가 key를 사용할 수 없습니다.`);
        }
    } else {
        const ownKeys = Reflect.ownKeys(value);
        if (ownKeys.some((key) => typeof key === 'symbol')) {
            throw new RangeError(`${label}에는 symbol key를 사용할 수 없습니다.`);
        }
        const keys = ownKeys.sort();
        next = hashWord(hashString(hash, 'object'), keys.length);
        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !Object.hasOwn(descriptor, 'value')
                || typeof descriptor.get === 'function'
                || typeof descriptor.set === 'function') {
                throw new TypeError(`${label}.${key}은 data property여야 합니다.`);
            }
            next = hashString(next, key);
            next = hashValue(
                next,
                descriptor.value,
                `${label}.${key}`,
                ancestors
            );
        }
    }
    ancestors.delete(value);
    return next;
}

/** R8 CPU run-domain record용 canonical positive uint32 fingerprint입니다. */
export function fingerprintR8Record(domain, value, label = domain) {
    if (typeof domain !== 'string' || domain.length === 0) {
        throw new TypeError('fingerprint domain은 비어 있지 않은 문자열이어야 합니다.');
    }
    const hash = hashValue(
        hashString(FNV_OFFSET_BASIS, domain),
        value,
        label,
        new Set()
    );
    return hash === 0 || hash === UINT32_MAX ? FNV_OFFSET_BASIS : hash >>> 0;
}
