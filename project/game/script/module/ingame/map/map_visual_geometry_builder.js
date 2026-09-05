/** @param {string} value @param {number} seed @returns {number} */
function hashString(value, seed = 0x811c9dc5) {
    let hash = seed >>> 0;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
}

/** @param {number} value @returns {number} */
function mixUint32(value) {
    let mixed = value >>> 0;
    mixed ^= mixed >>> 16;
    mixed = Math.imul(mixed, 0x7feb352d) >>> 0;
    mixed ^= mixed >>> 15;
    mixed = Math.imul(mixed, 0x846ca68b) >>> 0;
    mixed ^= mixed >>> 16;
    return mixed >>> 0;
}

/** @param {number[]} values @returns {Float32Array} */
function toFloat32Array(values) {
    return new Float32Array(values);
}

/**
 * @class MapVisualGeometryBuilder
 * @description gameplay tile authority를 setup-only visual geometry로 컴파일합니다.
 */
export class MapVisualGeometryBuilder {
    constructor() {
        this.buildCount = 0;
    }

    /** @returns {number} 진단용 누적 geometry build 횟수입니다. */
    getBuildCount() {
        return this.buildCount;
    }

    /**
     * @param {object} tileMap - ITileNavigationSource입니다.
     * @param {object} theme - validated immutable visual theme입니다.
     * @returns {object} typed-array 기반 정적 visual geometry입니다.
     */
    build(tileMap, theme) {
        const grid = tileMap?.getNavigationGrid?.();
        const bounds = tileMap?.getWorldBounds?.();
        const routes = tileMap?.getSpawnRoutes?.();
        if (!grid
            || !(grid.blocked instanceof Uint8Array)
            || !bounds
            || !Array.isArray(routes)
            || !theme
            || !Number.isSafeInteger(theme.fingerprint)) {
            throw new TypeError('MapVisualGeometryBuilder 입력 계약이 유효하지 않습니다.');
        }

        const rowOffsets = new Uint32Array(grid.rows + 1);
        const walkableColumns = [];
        const facetA = [];
        const facetB = [];
        const horizontalEdges = [];
        const verticalEdges = [];
        const tileSize = grid.cellSize;
        const mapSeed = hashString(
            String(tileMap.mapId ?? ''),
            theme.fingerprint
        );
        const facetModulo = Math.max(2, Math.round(theme.floor.facetScale));

        for (let row = 0; row < grid.rows; row++) {
            rowOffsets[row] = walkableColumns.length;
            const rowOffset = row * grid.cols;
            for (let column = 0; column < grid.cols; column++) {
                const cellIndex = rowOffset + column;
                if (grid.blocked[cellIndex] !== 0) {
                    continue;
                }
                walkableColumns.push(column);
                const centerX = (column + 0.5) * tileSize;
                const centerY = (row + 0.5) * tileSize;
                const cellHash = mixUint32(mapSeed ^ cellIndex);
                if ((cellHash % facetModulo) === 0) {
                    const target = (cellHash & 1) === 0 ? facetA : facetB;
                    target.push(centerX, centerY);
                }

                const topBlocked = row === 0
                    || grid.blocked[cellIndex - grid.cols] !== 0;
                const bottomBlocked = row === grid.rows - 1
                    || grid.blocked[cellIndex + grid.cols] !== 0;
                const leftBlocked = column === 0
                    || grid.blocked[cellIndex - 1] !== 0;
                const rightBlocked = column === grid.cols - 1
                    || grid.blocked[cellIndex + 1] !== 0;
                if (topBlocked) {
                    horizontalEdges.push(centerX, row * tileSize);
                }
                if (bottomBlocked) {
                    horizontalEdges.push(centerX, (row + 1) * tileSize);
                }
                if (leftBlocked) {
                    verticalEdges.push(column * tileSize, centerY);
                }
                if (rightBlocked) {
                    verticalEdges.push((column + 1) * tileSize, centerY);
                }
            }
        }
        rowOffsets[grid.rows] = walkableColumns.length;

        const ambientFragments = [];
        if (theme.ambientGeometry.enabled) {
            let randomState = mixUint32(mapSeed ^ theme.fingerprint) || 1;
            const maximumCount = theme.ambientGeometry.maximumFragmentCount;
            const maximumAttempts = maximumCount * 16;
            for (let attempt = 0;
                attempt < maximumAttempts
                    && ambientFragments.length / 4 < maximumCount;
                attempt++) {
                randomState = mixUint32(randomState + 0x9e3779b9);
                const unitX = randomState / 0xffffffff;
                randomState = mixUint32(randomState + 0x9e3779b9);
                const unitY = randomState / 0xffffffff;
                const column = Math.min(
                    grid.cols - 1,
                    Math.floor(unitX * grid.cols)
                );
                const row = Math.min(
                    grid.rows - 1,
                    Math.floor(unitY * grid.rows)
                );
                if (grid.blocked[(row * grid.cols) + column] === 0) {
                    continue;
                }
                randomState = mixUint32(randomState + 0x9e3779b9);
                const scale = 0.18 + (randomState / 0xffffffff) * 0.42;
                randomState = mixUint32(randomState + 0x9e3779b9);
                const rotation = randomState % 360;
                ambientFragments.push(
                    (column + 0.18 + unitY * 0.64) * tileSize,
                    (row + 0.18 + unitX * 0.64) * tileSize,
                    scale * tileSize,
                    rotation
                );
            }
        }

        const gatePositions = new Float32Array(routes.length * 2);
        for (let routeIndex = 0; routeIndex < routes.length; routeIndex++) {
            const entryPoint = routes[routeIndex]?.entryPoint;
            if (!entryPoint
                || !Number.isFinite(entryPoint.x)
                || !Number.isFinite(entryPoint.y)) {
                throw new TypeError(`spawnRoutes[${routeIndex}].entryPoint가 유효하지 않습니다.`);
            }
            gatePositions[routeIndex * 2] = entryPoint.x;
            gatePositions[routeIndex * 2 + 1] = entryPoint.y;
        }

        this.buildCount += 1;
        const visualRevision = Number(tileMap.getVisualRevision?.() ?? 0);
        const geometryFingerprint = mixUint32(
            mapSeed
            ^ walkableColumns.length
            ^ (horizontalEdges.length << 1)
            ^ (verticalEdges.length << 2)
        );
        return Object.freeze({
            mapId: String(tileMap.mapId ?? ''),
            themeId: theme.themeId,
            themeFingerprint: theme.fingerprint,
            visualRevision: Number.isFinite(visualRevision) ? visualRevision : 0,
            geometryFingerprint,
            rows: grid.rows,
            columns: grid.cols,
            tileSize,
            rowOffsets,
            walkableColumns: new Uint32Array(walkableColumns),
            facetA: toFloat32Array(facetA),
            facetB: toFloat32Array(facetB),
            horizontalEdges: toFloat32Array(horizontalEdges),
            verticalEdges: toFloat32Array(verticalEdges),
            ambientFragments: toFloat32Array(ambientFragments),
            gatePositions,
            worldCenterX: (bounds.minX + bounds.maxX) * 0.5,
            worldCenterY: (bounds.minY + bounds.maxY) * 0.5,
            diagnostics: Object.freeze({
                walkableTileCount: walkableColumns.length,
                facetCount: (facetA.length + facetB.length) / 2,
                perimeterEdgeCount:
                    (horizontalEdges.length + verticalEdges.length) / 2,
                ambientFragmentCount: ambientFragments.length / 4,
                gateCount: routes.length
            })
        });
    }
}
