import {
    assertWorldViewProjection2D
} from '../contract/world_view_projection_contract.js';

const FLOOR_FILL = '#1b2a3a';
const FLOOR_TILE_GAP_RATIO = 1 / 24;

/**
 * @class TileMapRenderer
 * @description 정적 바닥 projection을 캐시해 background layer에 일괄 제출합니다.
 */
export class TileMapRenderer {
    /**
     * @param {{drawSquareInstances:(options:object)=>void}} worldRenderPort - 렌더 포트입니다.
     */
    constructor(worldRenderPort) {
        if (!worldRenderPort
            || typeof worldRenderPort.drawSquareInstances !== 'function') {
            throw new TypeError('TileMapRenderer에는 drawSquareInstances 포트가 필요합니다.');
        }
        this.worldRenderPort = worldRenderPort;
        this.visibleCenters = [];
        this.centerPool = [];
        this.renderOptions = {
            layer: 'background',
            size: 0,
            fill: FLOOR_FILL,
            alpha: 1,
            centers: this.visibleCenters
        };
        this.cachedTileMap = null;
        this.cachedProjectionRevision = -1;
    }

    /**
     * projection이 바뀐 경우에만 바닥 타일의 viewport 좌표를 다시 계산합니다.
     * @param {object} tileMap - ITileNavigationSource입니다.
     * @param {object} projection - IWorldViewProjection2D입니다.
     * @returns {void}
     */
    draw(tileMap, projection) {
        const worldProjection = assertWorldViewProjection2D(projection);
        const projectionRevision = worldProjection.getProjectionRevision();
        if (this.cachedTileMap !== tileMap
            || this.cachedProjectionRevision !== projectionRevision) {
            this.#rebuildProjectionCache(tileMap, worldProjection);
            this.cachedTileMap = tileMap;
            this.cachedProjectionRevision = projectionRevision;
        }

        if (this.visibleCenters.length === 0 || this.renderOptions.size <= 0) {
            return;
        }
        this.worldRenderPort.drawSquareInstances(this.renderOptions);
    }

    /**
     * 정적 타일 중심과 크기를 현재 projection으로 변환해 캐시합니다.
     * @param {object} tileMap - ITileNavigationSource입니다.
     * @param {object} projection - IWorldViewProjection2D입니다.
     * @returns {void}
     * @private
     */
    #rebuildProjectionCache(tileMap, projection) {
        const grid = tileMap.getNavigationGrid();
        const tileSize = grid.cellSize;
        const view = projection.getViewBounds();
        const minColumn = Math.max(0, Math.floor(view.left / tileSize));
        const maxColumn = Math.min(
            grid.cols - 1,
            Math.floor(view.right / tileSize)
        );
        const minRow = Math.max(0, Math.floor(view.top / tileSize));
        const maxRow = Math.min(
            grid.rows - 1,
            Math.floor(view.bottom / tileSize)
        );
        const projectedTileSize = projection.worldLengthToViewport(tileSize);
        this.visibleCenters.length = 0;
        this.renderOptions.size = projectedTileSize * (1 - FLOOR_TILE_GAP_RATIO);

        if (projectedTileSize <= 0) {
            return;
        }

        for (let row = minRow; row <= maxRow; row++) {
            const rowOffset = row * grid.cols;
            for (let column = minColumn; column <= maxColumn; column++) {
                if (grid.blocked[rowOffset + column] !== 0) {
                    continue;
                }
                const centerIndex = this.visibleCenters.length;
                let center = this.centerPool[centerIndex];
                if (!center) {
                    center = { x: 0, y: 0 };
                    this.centerPool[centerIndex] = center;
                }
                projection.worldToViewport(
                    (column + 0.5) * tileSize,
                    (row + 0.5) * tileSize,
                    center
                );
                this.visibleCenters.push(center);
            }
        }
    }

    /** @returns {void} 렌더 포트와 scratch 참조를 정리합니다. */
    destroy() {
        this.visibleCenters.length = 0;
        this.centerPool.length = 0;
        this.cachedTileMap = null;
        this.cachedProjectionRevision = -1;
        this.worldRenderPort = null;
    }
}
