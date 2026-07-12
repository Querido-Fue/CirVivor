const MAX_DENSITY_COUNT = 65535;
const MAX_RETAINED_BUCKET_COUNT = 4096;
const MAX_RETAINED_ROW_COUNT = 512;

export const ENEMY_SPATIAL_TYPE_MASK = Object.freeze({
    ANY: -1,
    HEXA_MERGE: 1
});

/**
 * 적 타입을 공간 조회용 비트 마스크로 변환합니다.
 * @param {string|null|undefined} type - 적 타입입니다.
 * @returns {number} 타입 비트 마스크입니다.
 */
function resolveEnemySpatialTypeMask(type) {
    return type === 'hexa' || type === 'hexa_hive'
        ? ENEMY_SPATIAL_TYPE_MASK.HEXA_MERGE
        : 0;
}

/**
 * 밀도 필드 인덱스를 유효 범위로 제한합니다.
 * @param {number} value - 원본 인덱스입니다.
 * @param {number} max - 포함 가능한 최대 인덱스입니다.
 * @returns {number} 제한된 인덱스입니다.
 */
function clampCellIndex(value, max) {
    return Math.min(max, Math.max(0, value));
}

/**
 * @class EnemySpatialIndex
 * @description fixed tick 시작 좌표를 기준으로 적을 공간 셀에 배치하고 재사용 조회를 제공합니다.
 */
export class EnemySpatialIndex {
    /**
     * @param {number} [cellSize=96] - 공간 셀 한 변의 길이입니다.
     */
    constructor(cellSize = 96) {
        this.cellSize = Number.isFinite(cellSize) && cellSize > 0 ? cellSize : 96;
        this.rows = new Map();
        this.rowPool = [];
        this.bucketPool = [];
        this.entries = [];
        this.activeEntryCount = 0;
        this.enemyById = new Map();
        this.queryGeneration = 0;
        this.revision = 0;
        this.boundsScratch = { halfWidth: 0, halfHeight: 0 };
        this.touchedDensityIndices = [];
        this.densityField = {
            cols: 2,
            rows: 2,
            cellSize: this.cellSize,
            counts: new Uint16Array(4),
            revision: 0
        };
    }

    /**
     * 기존 셀 컨테이너를 비우고 다음 tick에서 다시 쓰도록 풀에 반환합니다.
     * @private
     */
    _releaseGridBuckets() {
        for (const row of this.rows.values()) {
            for (const bucket of row.values()) {
                bucket.length = 0;
                if (this.bucketPool.length < MAX_RETAINED_BUCKET_COUNT) {
                    this.bucketPool.push(bucket);
                }
            }
            row.clear();
            if (this.rowPool.length < MAX_RETAINED_ROW_COUNT) {
                this.rowPool.push(row);
            }
        }
        this.rows.clear();
    }

    /**
     * 지정 셀의 재사용 bucket을 반환합니다.
     * @param {number} cx - 셀 X입니다.
     * @param {number} cy - 셀 Y입니다.
     * @returns {number[]} 엔트리 인덱스 bucket입니다.
     * @private
     */
    _getOrCreateBucket(cx, cy) {
        let row = this.rows.get(cy);
        if (!row) {
            row = this.rowPool.pop() ?? new Map();
            this.rows.set(cy, row);
        }

        let bucket = row.get(cx);
        if (!bucket) {
            bucket = this.bucketPool.pop() ?? [];
            row.set(cx, bucket);
        }
        return bucket;
    }

    /**
     * 밀도 필드의 이전 touched 셀만 초기화합니다.
     * @param {number} cols - 새 필드 열 수입니다.
     * @param {number} rows - 새 필드 행 수입니다.
     * @param {number} cellSize - 새 필드 셀 크기입니다.
     * @private
     */
    _prepareDensityField(cols, rows, cellSize) {
        const requiredLength = cols * rows;
        const field = this.densityField;
        if (field.counts.length !== requiredLength) {
            field.counts = new Uint16Array(requiredLength);
            this.touchedDensityIndices.length = 0;
        } else {
            for (let i = 0; i < this.touchedDensityIndices.length; i++) {
                field.counts[this.touchedDensityIndices[i]] = 0;
            }
            this.touchedDensityIndices.length = 0;
        }

        field.cols = cols;
        field.rows = rows;
        field.cellSize = cellSize;
    }

    /**
     * fixed tick 시작 시 적 스냅샷으로 인덱스를 한 번 재구성합니다.
     * 큰 합체 적은 bounds가 걸치는 모든 셀에 들어가며 조회 시 generation stamp로 중복 제거됩니다.
     * @param {object[]|null|undefined} enemies - 활성 적 목록입니다.
     * @param {number} width - 시뮬레이션 필드 너비입니다.
     * @param {number} height - 시뮬레이션 필드 높이입니다.
     * @param {{cellSize?: number, resolveBoundsInto?: Function}} [options={}] - 구성 옵션입니다.
     * @returns {EnemySpatialIndex} 현재 인덱스입니다.
     */
    rebuild(enemies, width, height, options = {}) {
        this._releaseGridBuckets();
        this.enemyById.clear();
        this.activeEntryCount = 0;

        const requestedCellSize = Number.isFinite(options.cellSize) && options.cellSize > 0
            ? options.cellSize
            : this.cellSize;
        this.cellSize = requestedCellSize;
        const safeWidth = Number.isFinite(width) && width > 0 ? width : requestedCellSize * 2;
        const safeHeight = Number.isFinite(height) && height > 0 ? height : requestedCellSize * 2;
        const densityCols = Math.max(2, Math.ceil(safeWidth / requestedCellSize));
        const densityRows = Math.max(2, Math.ceil(safeHeight / requestedCellSize));
        this._prepareDensityField(densityCols, densityRows, requestedCellSize);

        const source = Array.isArray(enemies) ? enemies : [];
        const resolveBoundsInto = typeof options.resolveBoundsInto === 'function'
            ? options.resolveBoundsInto
            : null;
        for (let sourceIndex = 0; sourceIndex < source.length; sourceIndex++) {
            const enemy = source[sourceIndex];
            if (!enemy || enemy.active === false || !enemy.position) {
                continue;
            }

            const x = Number.isFinite(enemy.position.x) ? enemy.position.x : Number.NaN;
            const y = Number.isFinite(enemy.position.y) ? enemy.position.y : Number.NaN;
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                continue;
            }

            const entryIndex = this.activeEntryCount++;
            const entry = this.entries[entryIndex] ?? {
                enemy: null,
                sourceIndex: -1,
                x: 0,
                y: 0,
                typeMask: 0,
                queryStamp: 0
            };
            this.entries[entryIndex] = entry;
            entry.enemy = enemy;
            entry.sourceIndex = sourceIndex;
            entry.x = x;
            entry.y = y;
            entry.typeMask = resolveEnemySpatialTypeMask(enemy.type);

            this.boundsScratch.halfWidth = 0;
            this.boundsScratch.halfHeight = 0;
            if (resolveBoundsInto) {
                resolveBoundsInto(enemy, this.boundsScratch);
            }
            const halfWidth = Number.isFinite(this.boundsScratch.halfWidth)
                ? Math.max(0, this.boundsScratch.halfWidth)
                : 0;
            const halfHeight = Number.isFinite(this.boundsScratch.halfHeight)
                ? Math.max(0, this.boundsScratch.halfHeight)
                : 0;
            const minCx = Math.floor((x - halfWidth) / requestedCellSize);
            const maxCx = Math.floor((x + halfWidth) / requestedCellSize);
            const minCy = Math.floor((y - halfHeight) / requestedCellSize);
            const maxCy = Math.floor((y + halfHeight) / requestedCellSize);
            for (let cy = minCy; cy <= maxCy; cy++) {
                for (let cx = minCx; cx <= maxCx; cx++) {
                    this._getOrCreateBucket(cx, cy).push(entryIndex);
                }
            }

            if (Number.isInteger(enemy.id)) {
                this.enemyById.set(enemy.id, entry);
            }

            const densityCx = clampCellIndex(Math.floor(x / requestedCellSize), densityCols - 1);
            const densityCy = clampCellIndex(Math.floor(y / requestedCellSize), densityRows - 1);
            const densityIndex = (densityCy * densityCols) + densityCx;
            const previousCount = this.densityField.counts[densityIndex];
            if (previousCount === 0) {
                this.touchedDensityIndices.push(densityIndex);
            }
            this.densityField.counts[densityIndex] = Math.min(MAX_DENSITY_COUNT, previousCount + 1);
        }

        for (let i = this.activeEntryCount; i < this.entries.length; i++) {
            this.entries[i].enemy = null;
        }
        this.revision++;
        this.densityField.revision = this.revision;
        return this;
    }

    /**
     * 정수 ID로 현재 tick의 활성 적을 조회합니다.
     * @param {number} enemyId - 적 ID입니다.
     * @returns {object|null} 적 인스턴스입니다.
     */
    getEnemyById(enemyId) {
        if (!Number.isInteger(enemyId)) {
            return null;
        }
        return this.enemyById.get(enemyId)?.enemy ?? null;
    }

    /**
     * 정수 ID로 현재 tick 시작 시점의 적과 좌표를 조회합니다.
     * @param {number} enemyId - 적 ID입니다.
     * @param {{enemy?: object|null, x?: number, y?: number, sourceIndex?: number}} out - 결과 버퍼입니다.
     * @returns {{enemy: object, x: number, y: number, sourceIndex: number}|null} tick 시작 스냅샷입니다.
     */
    getEnemySnapshotById(enemyId, out) {
        if (!Number.isInteger(enemyId) || !out || typeof out !== 'object') {
            return null;
        }
        const entry = this.enemyById.get(enemyId);
        if (!entry?.enemy) {
            return null;
        }

        out.enemy = entry.enemy;
        out.x = entry.x;
        out.y = entry.y;
        out.sourceIndex = entry.sourceIndex;
        return out;
    }

    /**
     * 현재 tick에 재사용되는 전체 적 중심 밀도 필드를 반환합니다.
     * @returns {{cols: number, rows: number, cellSize: number, counts: Uint16Array, revision: number}}
     */
    getDensityField() {
        return this.densityField;
    }

    /**
     * 원형 반경과 타입 필터에 맞는 tick 시작 스냅샷을 순회합니다.
     * @param {number} x - 조회 중심 X입니다.
     * @param {number} y - 조회 중심 Y입니다.
     * @param {number} radius - 조회 반경입니다.
     * @param {number} typeMask - 허용 타입 비트 마스크입니다.
     * @param {(enemy: object, snapshotX: number, snapshotY: number, sourceIndex: number, userData: object) => (boolean|void)} visitor - 후보 방문 함수입니다.
     * @param {object} userData - 방문 함수에 전달할 재사용 문맥입니다.
     * @returns {number} 중복 제거 후 방문한 후보 수입니다.
     */
    forEachInCircle(x, y, radius, typeMask, visitor, userData) {
        if (
            !Number.isFinite(x)
            || !Number.isFinite(y)
            || !Number.isFinite(radius)
            || radius < 0
            || typeof visitor !== 'function'
        ) {
            return 0;
        }

        this.queryGeneration = (this.queryGeneration + 1) >>> 0;
        if (this.queryGeneration === 0) {
            for (let i = 0; i < this.entries.length; i++) {
                this.entries[i].queryStamp = 0;
            }
            this.queryGeneration = 1;
        }
        const queryStamp = this.queryGeneration;
        const minCx = Math.floor((x - radius) / this.cellSize);
        const maxCx = Math.floor((x + radius) / this.cellSize);
        const minCy = Math.floor((y - radius) / this.cellSize);
        const maxCy = Math.floor((y + radius) / this.cellSize);
        let visitedCount = 0;

        for (let cy = minCy; cy <= maxCy; cy++) {
            const row = this.rows.get(cy);
            if (!row) continue;
            for (let cx = minCx; cx <= maxCx; cx++) {
                const bucket = row.get(cx);
                if (!bucket) continue;
                for (let i = 0; i < bucket.length; i++) {
                    const entry = this.entries[bucket[i]];
                    if (!entry || entry.queryStamp === queryStamp) {
                        continue;
                    }
                    entry.queryStamp = queryStamp;
                    if (typeMask !== ENEMY_SPATIAL_TYPE_MASK.ANY && (entry.typeMask & typeMask) === 0) {
                        continue;
                    }

                    visitedCount++;
                    if (visitor(entry.enemy, entry.x, entry.y, entry.sourceIndex, userData) === false) {
                        return visitedCount;
                    }
                }
            }
        }
        return visitedCount;
    }
}
