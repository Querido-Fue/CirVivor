const GPU_BENCHMARK_ARENA_COLUMNS = 64;
const GPU_BENCHMARK_ARENA_ROWS = 36;
const GPU_BENCHMARK_ARENA_CELL_SIZE = 1;

function freezeRectangle(id, x, y, w, h) {
    return Object.freeze({ id, x, y, w, h, origin: 'center' });
}

const GPU_BENCHMARK_TARGET_POSITION = Object.freeze({
    x: 32,
    y: 18,
    row: 18,
    column: 32
});
const GPU_BENCHMARK_WORLD_BOUNDS = Object.freeze({
    minX: 0,
    minY: 0,
    maxX: GPU_BENCHMARK_ARENA_COLUMNS * GPU_BENCHMARK_ARENA_CELL_SIZE,
    maxY: GPU_BENCHMARK_ARENA_ROWS * GPU_BENCHMARK_ARENA_CELL_SIZE,
    width: GPU_BENCHMARK_ARENA_COLUMNS * GPU_BENCHMARK_ARENA_CELL_SIZE,
    height: GPU_BENCHMARK_ARENA_ROWS * GPU_BENCHMARK_ARENA_CELL_SIZE
});
const GPU_BENCHMARK_STATIC_WALLS = Object.freeze([
    freezeRectangle(1, 16, 18, 2, 18),
    freezeRectangle(2, 48, 18, 2, 18)
]);
const GPU_BENCHMARK_INITIAL_BOXES = Object.freeze([
    freezeRectangle(3, 25.5, 10.5, 3, 3),
    freezeRectangle(4, 38.5, 25.5, 3, 3),
    freezeRectangle(5, 23.5, 27.5, 3, 3)
]);

/**
 * GPU benchmark가 CPU 보조 렌더와 navigation에 함께 사용하는 고정 월드 layout입니다.
 * 모든 길이는 viewport pixel이 아닌 world unit입니다.
 */
export const GPU_BENCHMARK_ARENA_LAYOUT = Object.freeze({
    id: 'gpu-benchmark-open-arena',
    cols: GPU_BENCHMARK_ARENA_COLUMNS,
    rows: GPU_BENCHMARK_ARENA_ROWS,
    cellSize: GPU_BENCHMARK_ARENA_CELL_SIZE,
    worldBounds: GPU_BENCHMARK_WORLD_BOUNDS,
    targetPosition: GPU_BENCHMARK_TARGET_POSITION,
    towerSpawnPosition: GPU_BENCHMARK_TARGET_POSITION,
    staticWalls: GPU_BENCHMARK_STATIC_WALLS,
    initialBoxes: GPU_BENCHMARK_INITIAL_BOXES
});

/**
 * center-origin rectangle이 차지하는 셀을 blocked plane에 기록합니다.
 * Benchmark layout의 모든 rectangle 경계는 셀 경계에 맞춰져 있습니다.
 * @param {Uint8Array} blocked - row-major blocked plane입니다.
 * @param {{x:number,y:number,w:number,h:number}} rectangle - 월드 사각형입니다.
 * @returns {void}
 */
function rasterizeBlockedRectangle(blocked, rectangle) {
    const minColumn = Math.max(0, Math.floor(
        (rectangle.x - (rectangle.w * 0.5)) / GPU_BENCHMARK_ARENA_CELL_SIZE
    ));
    const maxColumnExclusive = Math.min(
        GPU_BENCHMARK_ARENA_COLUMNS,
        Math.ceil(
            (rectangle.x + (rectangle.w * 0.5))
                / GPU_BENCHMARK_ARENA_CELL_SIZE
        )
    );
    const minRow = Math.max(0, Math.floor(
        (rectangle.y - (rectangle.h * 0.5)) / GPU_BENCHMARK_ARENA_CELL_SIZE
    ));
    const maxRowExclusive = Math.min(
        GPU_BENCHMARK_ARENA_ROWS,
        Math.ceil(
            (rectangle.y + (rectangle.h * 0.5))
                / GPU_BENCHMARK_ARENA_CELL_SIZE
        )
    );

    for (let row = minRow; row < maxRowExclusive; row++) {
        const rowOffset = row * GPU_BENCHMARK_ARENA_COLUMNS;
        for (let column = minColumn; column < maxColumnExclusive; column++) {
            blocked[rowOffset + column] = 1;
        }
    }
}

function createBlockedPlane() {
    const blocked = new Uint8Array(
        GPU_BENCHMARK_ARENA_COLUMNS * GPU_BENCHMARK_ARENA_ROWS
    );
    for (const rectangle of GPU_BENCHMARK_STATIC_WALLS) {
        rasterizeBlockedRectangle(blocked, rectangle);
    }
    for (const rectangle of GPU_BENCHMARK_INITIAL_BOXES) {
        rasterizeBlockedRectangle(blocked, rectangle);
    }
    return blocked;
}

function freezeWaypoint(x, y, row, column) {
    return Object.freeze({ x, y, row, column });
}

function createDirectRoute(gateId, pathId, entryPoint) {
    const waypoints = Object.freeze([
        entryPoint,
        GPU_BENCHMARK_TARGET_POSITION
    ]);
    return Object.freeze({
        gateId,
        pathId,
        entryPoint,
        coreAttackPoint: GPU_BENCHMARK_TARGET_POSITION,
        waypoints
    });
}

function createSpawnRoutes() {
    return Object.freeze([
        createDirectRoute(
            'benchmark-left-gate',
            'benchmark-left-direct',
            freezeWaypoint(1.5, 18, 18, 1)
        ),
        createDirectRoute(
            'benchmark-right-gate',
            'benchmark-right-direct',
            freezeWaypoint(62.5, 18, 18, 62)
        ),
        createDirectRoute(
            'benchmark-top-gate',
            'benchmark-top-direct',
            freezeWaypoint(32, 1.5, 1, 32)
        ),
        createDirectRoute(
            'benchmark-bottom-gate',
            'benchmark-bottom-direct',
            freezeWaypoint(32, 34.5, 34, 32)
        )
    ]);
}

/**
 * Level 1 맵과 독립된 GPU benchmark 전용 ITileNavigationSource입니다.
 * blocked typed array는 기존 TileMap 계약과 마찬가지로 read-only snapshot으로 취급합니다.
 */
export class GpuBenchmarkNavigationSource {
    constructor() {
        const blocked = createBlockedPlane();
        this.mapId = GPU_BENCHMARK_ARENA_LAYOUT.id;
        this.columns = GPU_BENCHMARK_ARENA_COLUMNS;
        this.rows = GPU_BENCHMARK_ARENA_ROWS;
        this.tileSize = GPU_BENCHMARK_ARENA_CELL_SIZE;
        this.navigationGrid = Object.freeze({
            cols: this.columns,
            rows: this.rows,
            size: this.columns * this.rows,
            cellSize: this.tileSize,
            blocked
        });
        this.spawnRoutes = createSpawnRoutes();
        Object.freeze(this);
    }

    getNavigationGrid() {
        return this.navigationGrid;
    }

    getSpawnRoutes() {
        return this.spawnRoutes;
    }

    getCorePosition() {
        return GPU_BENCHMARK_TARGET_POSITION;
    }

    getTowerSpawnPosition() {
        return GPU_BENCHMARK_TARGET_POSITION;
    }

    getWorldBounds() {
        return GPU_BENCHMARK_WORLD_BOUNDS;
    }

    isWalkableTile(row, column) {
        return Number.isInteger(row)
            && Number.isInteger(column)
            && row >= 0
            && row < this.rows
            && column >= 0
            && column < this.columns
            && this.navigationGrid.blocked[(row * this.columns) + column] === 0;
    }

    worldToTile(x, y, out = {}) {
        const numericX = Number(x);
        const numericY = Number(y);
        out.column = Number.isFinite(numericX)
            ? Math.floor(numericX / this.tileSize)
            : -1;
        out.row = Number.isFinite(numericY)
            ? Math.floor(numericY / this.tileSize)
            : -1;
        out.inside = out.row >= 0
            && out.row < this.rows
            && out.column >= 0
            && out.column < this.columns;
        return out;
    }

    tileToWorld(row, column, out = {}) {
        if (!Number.isInteger(row)
            || !Number.isInteger(column)
            || row < 0
            || row >= this.rows
            || column < 0
            || column >= this.columns) {
            throw new RangeError('GPU benchmark tileToWorld 좌표가 범위를 벗어났습니다.');
        }
        out.row = row;
        out.column = column;
        out.x = (column + 0.5) * this.tileSize;
        out.y = (row + 0.5) * this.tileSize;
        return out;
    }
}

export function createGpuBenchmarkNavigationSource() {
    return new GpuBenchmarkNavigationSource();
}
