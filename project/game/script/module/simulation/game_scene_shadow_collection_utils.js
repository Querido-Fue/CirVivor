/**
 * 정수 ID 배열을 재사용 가능한 Set에 채웁니다.
 * @param {Set<number>} targetSet - 재사용할 대상 Set입니다.
 * @param {number[]|null|undefined} ids - 입력 ID 목록입니다.
 * @returns {number} 추가된 유효 ID 수입니다.
 */
export function fillReusableIntegerIdSet(targetSet, ids) {
    targetSet.clear();
    if (!Array.isArray(ids) || ids.length === 0) {
        return 0;
    }

    let count = 0;
    for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        if (!Number.isInteger(id)) {
            continue;
        }

        targetSet.add(id);
        count++;
    }

    return count;
}

/**
 * ID Set에 포함된 항목을 제외하도록 배열을 in-place compaction합니다.
 * @param {object[]} items - 압축할 상태 배열입니다.
 * @param {Set<number>} despawnIds - 제거할 ID Set입니다.
 */
export function compactShadowItemsByIdSet(items, despawnIds) {
    if (!Array.isArray(items) || items.length === 0 || !(despawnIds instanceof Set) || despawnIds.size === 0) {
        return;
    }

    let nextCount = 0;
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item || despawnIds.has(item.id)) {
            continue;
        }

        items[nextCount] = item;
        nextCount++;
    }

    items.length = nextCount;
}

/**
 * 생성 함수를 이용해 대상 배열을 in-place로 교체합니다.
 * @param {object[]} targetArray - 교체할 대상 배열입니다.
 * @param {object[]|null|undefined} sourceArray - 원본 항목 배열입니다.
 * @param {(value: object) => object|null} createItem - 항목 생성 함수입니다.
 * @returns {object[]} 갱신된 대상 배열입니다.
 */
export function replaceShadowItemsInPlace(targetArray, sourceArray, createItem) {
    targetArray.length = 0;
    if (!Array.isArray(sourceArray) || sourceArray.length === 0) {
        return targetArray;
    }

    for (let i = 0; i < sourceArray.length; i++) {
        const nextItem = createItem(sourceArray[i]);
        if (nextItem) {
            targetArray.push(nextItem);
        }
    }

    return targetArray;
}

/**
 * 생성 함수를 이용해 대상 배열에 항목을 이어붙입니다.
 * @param {object[]} targetArray - 추가할 대상 배열입니다.
 * @param {object[]|null|undefined} sourceArray - 원본 항목 배열입니다.
 * @param {(value: object) => object|null} createItem - 항목 생성 함수입니다.
 * @returns {object[]} 갱신된 대상 배열입니다.
 */
export function appendShadowItemsInPlace(targetArray, sourceArray, createItem) {
    if (!Array.isArray(sourceArray) || sourceArray.length === 0) {
        return targetArray;
    }

    for (let i = 0; i < sourceArray.length; i++) {
        const nextItem = createItem(sourceArray[i]);
        if (nextItem) {
            targetArray.push(nextItem);
        }
    }

    return targetArray;
}
