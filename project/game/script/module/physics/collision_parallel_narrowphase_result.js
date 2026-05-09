import {
    COLLISION_CONTACT_RESULT_INDEX as CONTACT_RESULT_INDEX,
    COLLISION_CONTACT_RESULT_STRIDE as CONTACT_RESULT_STRIDE
} from './collision_soa_layout.js';
import { writeCollisionManifold } from './collision_manifold_writer.js';

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

/**
 * parallel narrowphase contact row를 scratch manifold에 기록합니다.
 * @param {object} manifold - 결과를 기록할 scratch manifold입니다.
 * @param {Float64Array} resultData - worker contact 결과 SoA입니다.
 * @param {number} low - 기대하는 낮은 body 인덱스입니다.
 * @param {number} high - 기대하는 높은 body 인덱스입니다.
 * @param {number} contactRowIndex - contact result row 인덱스입니다.
 * @returns {boolean} 유효한 contact를 기록했으면 true입니다.
 */
export function writeCollisionParallelNarrowphaseContactManifold(
    manifold,
    resultData,
    low,
    high,
    contactRowIndex
) {
    if (!manifold || !(resultData instanceof Float64Array)
        || !Number.isInteger(contactRowIndex) || contactRowIndex < 0) {
        return false;
    }

    const offset = contactRowIndex * CONTACT_RESULT_STRIDE;
    const resultLow = Math.trunc(resultData[offset + CONTACT_RESULT_INDEX.BODY_A_INDEX]);
    const resultHigh = Math.trunc(resultData[offset + CONTACT_RESULT_INDEX.BODY_B_INDEX]);
    if (resultLow !== low || resultHigh !== high) {
        return false;
    }

    const normalX = resultData[offset + CONTACT_RESULT_INDEX.NORMAL_X];
    const normalY = resultData[offset + CONTACT_RESULT_INDEX.NORMAL_Y];
    const penetration = resultData[offset + CONTACT_RESULT_INDEX.PENETRATION];
    const pointX = resultData[offset + CONTACT_RESULT_INDEX.POINT_X];
    const pointY = resultData[offset + CONTACT_RESULT_INDEX.POINT_Y];
    if (!Number.isFinite(normalX) || !Number.isFinite(normalY)
        || !Number.isFinite(penetration) || penetration <= 0
        || !Number.isFinite(pointX) || !Number.isFinite(pointY)) {
        return false;
    }

    writeCollisionManifold(manifold, normalX, normalY, penetration, pointX, pointY);
    return true;
}
