import {
    COLLISION_CONTACT_RESULT_INDEX as CONTACT_RESULT_INDEX,
    COLLISION_CONTACT_RESULT_STRIDE as CONTACT_RESULT_STRIDE
} from './collision_soa_layout.js';

/**
 * pair index에 대응하는 parallel contact result row를 찾습니다.
 * @param {{resultData: Float64Array, resultRanges: object[], rangeIndex: number, rowIndex: number}|null} state - 탐색 중인 결과 상태입니다.
 * @param {number} pairIndex - 후보 pair 인덱스입니다.
 * @returns {number} contact result row 인덱스입니다. 없으면 -1을 반환합니다.
 */
export function findCollisionParallelNarrowphaseContactRow(state, pairIndex) {
    if (!state || !(state.resultData instanceof Float64Array) || !Number.isInteger(pairIndex)) {
        return -1;
    }

    const ranges = state.resultRanges;
    const resultData = state.resultData;
    while (state.rangeIndex < ranges.length) {
        const range = ranges[state.rangeIndex];
        const resultOffset = Number.isInteger(range?.resultOffset) ? range.resultOffset : 0;
        const resultCount = Number.isInteger(range?.resultCount) ? Math.max(0, range.resultCount) : 0;
        const rowEnd = resultOffset + resultCount;
        if (state.rowIndex < resultOffset) {
            state.rowIndex = resultOffset;
        }

        while (state.rowIndex < rowEnd) {
            const offset = state.rowIndex * CONTACT_RESULT_STRIDE;
            const resultPairIndex = Math.trunc(resultData[offset + CONTACT_RESULT_INDEX.PAIR_INDEX]);
            if (resultPairIndex < pairIndex) {
                state.rowIndex++;
                continue;
            }
            if (resultPairIndex === pairIndex) {
                return state.rowIndex;
            }
            return -1;
        }
        state.rangeIndex++;
    }

    return -1;
}
