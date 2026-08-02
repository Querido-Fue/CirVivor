const BOUNDARY_NEIGHBOR_OFFSETS = Object.freeze([
    Object.freeze([0, -1]),
    Object.freeze([-1, 0]),
    Object.freeze([1, 0]),
    Object.freeze([0, 1])
]);

// 원본 jump_flood.glsl의 순서입니다. 같은 거리에서는 먼저 찾은 seed를 유지합니다.
const JUMP_FLOOD_NEIGHBOR_OFFSETS = Object.freeze([
    Object.freeze([-1, -1]),
    Object.freeze([0, -1]),
    Object.freeze([1, -1]),
    Object.freeze([-1, 0]),
    Object.freeze([1, 0]),
    Object.freeze([-1, 1]),
    Object.freeze([0, 1]),
    Object.freeze([1, 1])
]);

const INVALID_SEED_COORDINATE = -1;
const AUTHORED_SURFACE_BIAS_CELLS = Math.fround(0.5);
const MAX_SDF_SUBDIVISIONS = 8;

/**
 * VM 경계를 포함해 Uint8Array인지 확인합니다.
 * @param {*} value - 검사할 값입니다.
 * @returns {boolean} Uint8Array 여부입니다.
 */
function isUint8Array(value) {
    return ArrayBuffer.isView(value)
        && value.BYTES_PER_ELEMENT === Uint8Array.BYTES_PER_ELEMENT
        && Object.prototype.toString.call(value) === '[object Uint8Array]';
}

/**
 * VM 경계를 포함해 Float32Array인지 확인합니다.
 * @param {*} value - 검사할 값입니다.
 * @returns {boolean} Float32Array 여부입니다.
 */
function isFloat32Array(value) {
    return ArrayBuffer.isView(value)
        && value.BYTES_PER_ELEMENT === Float32Array.BYTES_PER_ELEMENT
        && Object.prototype.toString.call(value) === '[object Float32Array]';
}

/**
 * TileMap navigation grid를 SDF 입력 계약으로 검증합니다.
 * @param {*} navigationGrid - row-major blocked grid입니다.
 * @returns {void}
 */
function assertNavigationGrid(navigationGrid) {
    const columns = navigationGrid?.cols;
    const rows = navigationGrid?.rows;
    const size = navigationGrid?.size;
    const cellSize = navigationGrid?.cellSize;
    const subdivisions = navigationGrid?.sdfSubdivisions ?? 1;
    if (!Number.isInteger(columns)
        || columns <= 0
        || !Number.isInteger(rows)
        || rows <= 0
        || !Number.isSafeInteger(size)
        || size !== columns * rows
        || !Number.isFinite(cellSize)
        || cellSize <= 0
        || !Number.isSafeInteger(subdivisions)
        || subdivisions <= 0
        || subdivisions > MAX_SDF_SUBDIVISIONS
        || !isUint8Array(navigationGrid.blocked)
        || navigationGrid.blocked.length !== size) {
        throw new TypeError('SDF 입력은 유효한 TileMap navigation grid여야 합니다.');
    }
}

/**
 * 선택한 SDF 해상도만큼 source occupancy를 nearest 방식으로 세분화합니다.
 * source tile 경계는 그대로 유지되며 frame 경로에서는 이 작업을 수행하지 않습니다.
 * @param {Uint8Array} sourceBlocked - source row-major blocked plane입니다.
 * @param {number} sourceColumns - source 열 수입니다.
 * @param {number} sourceRows - source 행 수입니다.
 * @param {number} subdivisions - 축별 세분화 배수입니다.
 * @returns {Uint8Array} 세분화된 row-major blocked plane입니다.
 */
function createSubdividedBlockedPlane(
    sourceBlocked,
    sourceColumns,
    sourceRows,
    subdivisions
) {
    if (subdivisions === 1) {
        return new Uint8Array(sourceBlocked);
    }
    const columns = sourceColumns * subdivisions;
    const rows = sourceRows * subdivisions;
    const blocked = new Uint8Array(columns * rows);
    for (let row = 0; row < rows; row++) {
        const sourceRowOffset = Math.floor(row / subdivisions) * sourceColumns;
        const rowOffset = row * columns;
        for (let column = 0; column < columns; column++) {
            blocked[rowOffset + column] = sourceBlocked[
                sourceRowOffset + Math.floor(column / subdivisions)
            ];
        }
    }
    return blocked;
}

/**
 * SDF snapshot을 검증합니다.
 * @param {*} snapshot - createGpuSignedDistanceField 결과입니다.
 * @returns {void}
 */
function assertSignedDistanceField(snapshot) {
    if (!snapshot
        || !Number.isInteger(snapshot.cols)
        || snapshot.cols <= 0
        || !Number.isInteger(snapshot.rows)
        || snapshot.rows <= 0
        || snapshot.size !== snapshot.cols * snapshot.rows
        || !Number.isFinite(snapshot.cellSize)
        || snapshot.cellSize <= 0
        || !Number.isFinite(snapshot.worldWidth)
        || snapshot.worldWidth <= 0
        || !Number.isFinite(snapshot.worldHeight)
        || snapshot.worldHeight <= 0
        || !isUint8Array(snapshot.blocked)
        || snapshot.blocked.length !== snapshot.size
        || !isFloat32Array(snapshot.values)
        || snapshot.values.length !== snapshot.size) {
        throw new TypeError('유효한 GPU signed-distance snapshot이 필요합니다.');
    }
}

/**
 * 유한한 월드 좌표를 검증합니다.
 * @param {*} value - 검사할 값입니다.
 * @param {string} label - 오류 필드명입니다.
 * @returns {number} Float32로 반올림한 값입니다.
 */
function requireWorldCoordinate(value, label) {
    if (!Number.isFinite(value)) {
        throw new TypeError(`${label}는 유한한 수여야 합니다.`);
    }
    return Math.fround(value);
}

/**
 * seed와 셀 중심 사이의 제곱 거리를 원본 Float32 연산 순서로 계산합니다.
 * @param {number} seedX - seed X입니다.
 * @param {number} seedY - seed Y입니다.
 * @param {number} pointX - 셀 중심 X입니다.
 * @param {number} pointY - 셀 중심 Y입니다.
 * @returns {number} Float32 제곱 거리입니다.
 */
function distanceSquaredFloat32(seedX, seedY, pointX, pointY) {
    const deltaX = Math.fround(seedX - pointX);
    const deltaY = Math.fround(seedY - pointY);
    return Math.fround(
        Math.fround(deltaX * deltaX) + Math.fround(deltaY * deltaY)
    );
}

/**
 * 현재 texel이 막힌 영역의 4-neighbor 경계인지 검사합니다.
 * 맵 바깥은 원본 seed shader처럼 이웃에서 제외합니다.
 * @param {Uint8Array} blocked - row-major blocked plane입니다.
 * @param {number} columns - 열 수입니다.
 * @param {number} rows - 행 수입니다.
 * @param {number} row - 현재 행입니다.
 * @param {number} column - 현재 열입니다.
 * @returns {boolean} 막힌 경계 셀이면 true입니다.
 */
function isBlockedBoundary(blocked, columns, rows, row, column) {
    const inside = blocked[(row * columns) + column] !== 0;
    if (!inside) {
        return false;
    }

    for (let index = 0; index < BOUNDARY_NEIGHBOR_OFFSETS.length; index++) {
        const offset = BOUNDARY_NEIGHBOR_OFFSETS[index];
        const neighborColumn = column + offset[0];
        const neighborRow = row + offset[1];
        if (neighborColumn < 0
            || neighborColumn >= columns
            || neighborRow < 0
            || neighborRow >= rows) {
            continue;
        }
        if ((blocked[(neighborRow * columns) + neighborColumn] !== 0) !== inside) {
            return true;
        }
    }
    return false;
}

/**
 * 원본 seed.glsl의 blocked boundary center seed plane을 생성합니다.
 * @param {Uint8Array} blocked - 복사된 blocked plane입니다.
 * @param {number} columns - 열 수입니다.
 * @param {number} rows - 행 수입니다.
 * @returns {Float32Array} RG seed 좌표 plane입니다.
 */
function createBoundarySeeds(blocked, columns, rows) {
    const seeds = new Float32Array(blocked.length * 2);
    seeds.fill(INVALID_SEED_COORDINATE);
    for (let row = 0; row < rows; row++) {
        const rowOffset = row * columns;
        for (let column = 0; column < columns; column++) {
            if (!isBlockedBoundary(blocked, columns, rows, row, column)) {
                continue;
            }
            const seedOffset = (rowOffset + column) * 2;
            seeds[seedOffset] = Math.fround(column + 0.5);
            seeds[seedOffset + 1] = Math.fround(row + 0.5);
        }
    }
    return seeds;
}

/**
 * jump-flood 한 pass를 수행합니다.
 * @param {Float32Array} source - 이전 seed plane입니다.
 * @param {Float32Array} target - 결과 seed plane입니다.
 * @param {number} columns - 열 수입니다.
 * @param {number} rows - 행 수입니다.
 * @param {number} step - jump step입니다.
 * @returns {void}
 */
function runJumpFloodPass(source, target, columns, rows, step) {
    for (let row = 0; row < rows; row++) {
        const pointY = Math.fround(row + 0.5);
        for (let column = 0; column < columns; column++) {
            const pointX = Math.fround(column + 0.5);
            const cellIndex = (row * columns) + column;
            const seedOffset = cellIndex * 2;
            let bestX = source[seedOffset];
            let bestY = source[seedOffset + 1];
            let bestDistance = Number.POSITIVE_INFINITY;
            if (bestX >= 0) {
                bestDistance = distanceSquaredFloat32(
                    bestX,
                    bestY,
                    pointX,
                    pointY
                );
            }

            for (let index = 0; index < JUMP_FLOOD_NEIGHBOR_OFFSETS.length; index++) {
                const offset = JUMP_FLOOD_NEIGHBOR_OFFSETS[index];
                const neighborColumn = column + (offset[0] * step);
                const neighborRow = row + (offset[1] * step);
                if (neighborColumn < 0
                    || neighborColumn >= columns
                    || neighborRow < 0
                    || neighborRow >= rows) {
                    continue;
                }

                const neighborOffset = ((neighborRow * columns) + neighborColumn) * 2;
                const candidateX = source[neighborOffset];
                if (candidateX < 0) {
                    continue;
                }
                const candidateY = source[neighborOffset + 1];
                const candidateDistance = distanceSquaredFloat32(
                    candidateX,
                    candidateY,
                    pointX,
                    pointY
                );
                if (candidateDistance < bestDistance) {
                    bestDistance = candidateDistance;
                    bestX = candidateX;
                    bestY = candidateY;
                }
            }

            target[seedOffset] = bestX;
            target[seedOffset + 1] = bestY;
        }
    }
}

/**
 * Felzenszwalb/Huttenlocher 1D squared-distance transform입니다.
 * 고해상도 setup에서 JFA의 O(N log N) 비용을 피하기 위한 build-time 경로입니다.
 * @param {Float64Array} source - 0 또는 충분히 큰 유한 거리 입력입니다.
 * @param {number} length - 사용할 원소 수입니다.
 * @param {Float64Array} target - squared-distance 출력입니다.
 * @param {Int32Array} sites - 재사용하는 lower-envelope site scratch입니다.
 * @param {Float64Array} separators - 재사용하는 parabola 경계 scratch입니다.
 * @returns {void}
 */
function runSquaredDistanceTransform1d(
    source,
    length,
    target,
    sites,
    separators
) {
    let envelopeIndex = 0;
    sites[0] = 0;
    separators[0] = Number.NEGATIVE_INFINITY;
    separators[1] = Number.POSITIVE_INFINITY;

    for (let point = 1; point < length; point++) {
        let separation;
        while (true) {
            const site = sites[envelopeIndex];
            separation = (
                (source[point] + (point * point))
                    - (source[site] + (site * site))
            ) / (2 * (point - site));
            if (separation > separators[envelopeIndex]) {
                break;
            }
            envelopeIndex--;
        }
        envelopeIndex++;
        sites[envelopeIndex] = point;
        separators[envelopeIndex] = separation;
        separators[envelopeIndex + 1] = Number.POSITIVE_INFINITY;
    }

    envelopeIndex = 0;
    for (let point = 0; point < length; point++) {
        while (separators[envelopeIndex + 1] < point) {
            envelopeIndex++;
        }
        const site = sites[envelopeIndex];
        const delta = point - site;
        target[point] = (delta * delta) + source[site];
    }
}

/**
 * 세분화 snapshot의 boundary-center 거리를 exact O(N) EDT로 생성합니다.
 * 최종 half-cell bias는 JFA 호환 경로와 동일하게 적용합니다.
 * @param {Uint8Array} blocked - 세분화된 blocked plane입니다.
 * @param {number} columns - 열 수입니다.
 * @param {number} rows - 행 수입니다.
 * @param {number} cellSize - 세분화된 world cell 크기입니다.
 * @param {number} surfaceBiasWorld - authored face bias입니다.
 * @returns {Float32Array} world-unit signed distance plane입니다.
 */
function createExactBoundaryDistanceValues(
    blocked,
    columns,
    rows,
    cellSize,
    surfaceBiasWorld
) {
    const maximumDistanceSquared = (columns * columns)
        + (rows * rows)
        + 1;
    const maximumDimension = Math.max(columns, rows);
    const sourceLine = new Float64Array(maximumDimension);
    const targetLine = new Float64Array(maximumDimension);
    const sites = new Int32Array(maximumDimension);
    const separators = new Float64Array(maximumDimension + 1);
    const rowDistances = new Float64Array(blocked.length);

    for (let row = 0; row < rows; row++) {
        const rowOffset = row * columns;
        for (let column = 0; column < columns; column++) {
            sourceLine[column] = isBlockedBoundary(
                blocked,
                columns,
                rows,
                row,
                column
            ) ? 0 : maximumDistanceSquared;
        }
        runSquaredDistanceTransform1d(
            sourceLine,
            columns,
            targetLine,
            sites,
            separators
        );
        rowDistances.set(targetLine.subarray(0, columns), rowOffset);
    }

    const values = new Float32Array(blocked.length);
    for (let column = 0; column < columns; column++) {
        for (let row = 0; row < rows; row++) {
            sourceLine[row] = rowDistances[(row * columns) + column];
        }
        runSquaredDistanceTransform1d(
            sourceLine,
            rows,
            targetLine,
            sites,
            separators
        );
        for (let row = 0; row < rows; row++) {
            const cellIndex = (row * columns) + column;
            const distanceCells = Math.fround(Math.sqrt(targetLine[row]));
            const distanceWorld = Math.fround(distanceCells * cellSize);
            values[cellIndex] = blocked[cellIndex] !== 0
                ? Math.fround(-Math.fround(distanceWorld + surfaceBiasWorld))
                : Math.fround(distanceWorld - surfaceBiasWorld);
        }
    }
    return values;
}

/**
 * 원본 SDF seed → jump flood → finalize를 CPU에서 재현합니다.
 *
 * `blocked`는 row-major이고 row가 증가할수록 월드 +Y(화면 아래)입니다.
 * 반환 snapshot은 입력 typed array를 참조하지 않으며 거리도 world unit으로
 * 미리 환산되어 WebGPU storage buffer에 그대로 업로드할 수 있습니다.
 * @param {*} navigationGrid - TileMap.getNavigationGrid() 결과입니다.
 * @returns {object} Float32 SDF snapshot입니다.
 */
export function createGpuSignedDistanceField(navigationGrid) {
    assertNavigationGrid(navigationGrid);

    const sourceColumns = navigationGrid.cols;
    const sourceRows = navigationGrid.rows;
    const sourceCellSize = Math.fround(navigationGrid.cellSize);
    const subdivisions = navigationGrid.sdfSubdivisions ?? 1;
    const columns = sourceColumns * subdivisions;
    const rows = sourceRows * subdivisions;
    const size = columns * rows;
    const cellSize = Math.fround(sourceCellSize / subdivisions);
    const surfaceBiasWorld = Math.fround(
        cellSize * AUTHORED_SURFACE_BIAS_CELLS
    );
    const worldWidth = Math.fround(sourceColumns * sourceCellSize);
    const worldHeight = Math.fround(sourceRows * sourceCellSize);
    if (!Number.isFinite(cellSize)
        || cellSize <= 0
        || !Number.isFinite(worldWidth)
        || !Number.isFinite(worldHeight)) {
        throw new RangeError('SDF grid의 Float32 월드 크기가 유효해야 합니다.');
    }
    const blocked = createSubdividedBlockedPlane(
        navigationGrid.blocked,
        sourceColumns,
        sourceRows,
        subdivisions
    );
    let values;
    if (subdivisions > 1) {
        values = createExactBoundaryDistanceValues(
            blocked,
            columns,
            rows,
            cellSize,
            surfaceBiasWorld
        );
    } else {
        let source = createBoundarySeeds(blocked, columns, rows);
        let target = new Float32Array(source.length);

        let step = Math.floor(Math.max(columns, rows) / 2);
        while (step >= 1) {
            runJumpFloodPass(source, target, columns, rows, step);
            const previousSource = source;
            source = target;
            target = previousSource;
            step = Math.floor(step / 2);
        }

        values = new Float32Array(size);
        for (let row = 0; row < rows; row++) {
            const pointY = Math.fround(row + 0.5);
            for (let column = 0; column < columns; column++) {
                const pointX = Math.fround(column + 0.5);
                const cellIndex = (row * columns) + column;
                const seedOffset = cellIndex * 2;
                const distanceSquared = distanceSquaredFloat32(
                    source[seedOffset],
                    source[seedOffset + 1],
                    pointX,
                    pointY
                );
                const distanceCells = Math.fround(Math.sqrt(distanceSquared));
                const distanceWorld = Math.fround(distanceCells * cellSize);
                // Boundary seed는 blocked cell 중심에 있으므로, half-cell만큼
                // 바깥으로 옮겨 authored cell face를 실제 zero contour로 맞춥니다.
                values[cellIndex] = blocked[cellIndex] !== 0
                    ? Math.fround(-Math.fround(distanceWorld + surfaceBiasWorld))
                    : Math.fround(distanceWorld - surfaceBiasWorld);
            }
        }
    }

    return Object.freeze({
        cols: columns,
        rows,
        size,
        cellSize,
        subdivisions,
        sourceCols: sourceColumns,
        sourceRows,
        sourceCellSize,
        worldWidth,
        worldHeight,
        blocked,
        values
    });
}

/** snapshot을 명시하는 호출부용 별칭입니다. */
export const createGpuSignedDistanceFieldSnapshot = createGpuSignedDistanceField;

/**
 * 경계 clamp를 적용해 한 SDF texel을 읽습니다.
 * @param {object} snapshot - SDF snapshot입니다.
 * @param {number} column - texel 열입니다.
 * @param {number} row - texel 행입니다.
 * @returns {number} Float32 거리입니다.
 */
function readClampedSdfValue(snapshot, column, row) {
    const clampedColumn = Math.max(0, Math.min(snapshot.cols - 1, column));
    const clampedRow = Math.max(0, Math.min(snapshot.rows - 1, row));
    return snapshot.values[(clampedRow * snapshot.cols) + clampedColumn];
}

/**
 * WGSL storage-buffer sampler와 같은 texel-center 수동 bilinear sample입니다.
 * 맵 바깥 좌표는 가장자리 texel로 clamp됩니다.
 * @param {*} snapshot - createGpuSignedDistanceField 결과입니다.
 * @param {*} worldX - 월드 X입니다.
 * @param {*} worldY - 월드 Y입니다.
 * @returns {number} world unit Float32 signed distance입니다.
 */
export function sampleGpuSignedDistanceField(snapshot, worldX, worldY) {
    assertSignedDistanceField(snapshot);
    const x = requireWorldCoordinate(worldX, 'worldX');
    const y = requireWorldCoordinate(worldY, 'worldY');
    const uvX = Math.fround(x / snapshot.worldWidth);
    const uvY = Math.fround(y / snapshot.worldHeight);
    const coordinateX = Math.fround(
        Math.fround(Math.max(0, Math.min(1, uvX)) * snapshot.cols) - 0.5
    );
    const coordinateY = Math.fround(
        Math.fround(Math.max(0, Math.min(1, uvY)) * snapshot.rows) - 0.5
    );
    const baseColumn = Math.floor(coordinateX);
    const baseRow = Math.floor(coordinateY);
    const fractionX = Math.fround(coordinateX - baseColumn);
    const fractionY = Math.fround(coordinateY - baseRow);

    const topLeft = readClampedSdfValue(snapshot, baseColumn, baseRow);
    const topRight = readClampedSdfValue(snapshot, baseColumn + 1, baseRow);
    const bottomLeft = readClampedSdfValue(snapshot, baseColumn, baseRow + 1);
    const bottomRight = readClampedSdfValue(
        snapshot,
        baseColumn + 1,
        baseRow + 1
    );
    const top = Math.fround(topLeft + Math.fround((topRight - topLeft) * fractionX));
    const bottom = Math.fround(
        bottomLeft + Math.fround((bottomRight - bottomLeft) * fractionX)
    );
    return Math.fround(top + Math.fround((bottom - top) * fractionY));
}

/** 수동 bilinear 동작을 명시하는 호출부용 별칭입니다. */
export const sampleSignedDistanceFieldBilinear = sampleGpuSignedDistanceField;

/**
 * 월드 AABB 내부가 양수, 외부가 음수인 signed distance를 계산합니다.
 * @param {*} worldBounds - minX/minY/maxX/maxY 경계입니다.
 * @param {*} worldX - 월드 X입니다.
 * @param {*} worldY - 월드 Y입니다.
 * @returns {number} Float32 signed distance입니다.
 */
export function signedDistanceToWorldAabb(worldBounds, worldX, worldY) {
    const minX = requireWorldCoordinate(worldBounds?.minX, 'worldBounds.minX');
    const minY = requireWorldCoordinate(worldBounds?.minY, 'worldBounds.minY');
    const maxX = requireWorldCoordinate(worldBounds?.maxX, 'worldBounds.maxX');
    const maxY = requireWorldCoordinate(worldBounds?.maxY, 'worldBounds.maxY');
    if (maxX <= minX || maxY <= minY) {
        throw new RangeError('worldBounds는 양의 폭과 높이를 가져야 합니다.');
    }
    const x = requireWorldCoordinate(worldX, 'worldX');
    const y = requireWorldCoordinate(worldY, 'worldY');
    const halfWidth = Math.fround((maxX - minX) * 0.5);
    const halfHeight = Math.fround((maxY - minY) * 0.5);
    const centerX = Math.fround(minX + halfWidth);
    const centerY = Math.fround(minY + halfHeight);
    const deltaX = Math.fround(Math.abs(Math.fround(x - centerX)) - halfWidth);
    const deltaY = Math.fround(Math.abs(Math.fround(y - centerY)) - halfHeight);
    const outsideX = Math.max(deltaX, 0);
    const outsideY = Math.max(deltaY, 0);
    const outsideDistance = Math.fround(Math.hypot(outsideX, outsideY));
    const insideDistance = Math.fround(Math.min(Math.max(deltaX, deltaY), 0));
    return Math.fround(-(outsideDistance + insideDistance));
}

/**
 * 지형 SDF와 월드 AABB를 교집합(`min`)으로 합성합니다.
 * @param {*} snapshot - createGpuSignedDistanceField 결과입니다.
 * @param {*} worldBounds - minX/minY/maxX/maxY 경계입니다.
 * @param {*} worldX - 월드 X입니다.
 * @param {*} worldY - 월드 Y입니다.
 * @returns {number} 합성된 Float32 signed distance입니다.
 */
export function sampleGpuWorldSignedDistance(
    snapshot,
    worldBounds,
    worldX,
    worldY
) {
    const terrainDistance = sampleGpuSignedDistanceField(snapshot, worldX, worldY);
    const boundaryDistance = signedDistanceToWorldAabb(worldBounds, worldX, worldY);
    return Math.fround(Math.min(terrainDistance, boundaryDistance));
}
