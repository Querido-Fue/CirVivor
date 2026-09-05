import {
    MAP_VISUAL_THEME_ID,
    resolveMapVisualTheme
} from 'data/scene/game/purple_crystal_map_visual_theme_data.js';
import {
    assertWorldViewProjection2D
} from '../contract/world_view_projection_contract.js';
import {
    MapVisualGeometryBuilder
} from './map_visual_geometry_builder.js';

const FLOOR_FILL = '#1b2a3a';
const FLOOR_TILE_GAP_RATIO = 1 / 24;
const ABYSS_BAND_COUNT = 4;
const PORTAL_SEGMENTS_PER_ARC = 7;
const FULL_CIRCLE_RADIANS = Math.PI * 2;

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

function parseHexColor(color) {
    return [
        Number.parseInt(color.slice(1, 3), 16),
        Number.parseInt(color.slice(3, 5), 16),
        Number.parseInt(color.slice(5, 7), 16)
    ];
}

function mixHexColor(from, to, amount) {
    const first = parseHexColor(from);
    const second = parseHexColor(to);
    const channel = (index) => Math.round(
        first[index] + (second[index] - first[index]) * amount
    ).toString(16).padStart(2, '0');
    return `#${channel(0)}${channel(1)}${channel(2)}`;
}

/** pool의 center를 재사용하면서 target 배열에 넣습니다. */
function pushPooledCenter(target, pool, x, y) {
    const index = target.length;
    let center = pool[index];
    if (!center) {
        center = { x: 0, y: 0 };
        pool[index] = center;
    }
    center.x = x;
    center.y = y;
    target.push(center);
    return center;
}

/**
 * @class TileMapRenderer
 * @description flat fallback과 setup-only purple crystal visual geometry를 렌더합니다.
 */
export class TileMapRenderer {
    /**
     * @param {{drawSquareInstances:(options:object)=>void,drawShape?:(options:object)=>void,drawShapeInstances?:(options:object)=>void}} worldRenderPort
     * @param {{geometryBuilder?:MapVisualGeometryBuilder}} [options]
     */
    constructor(worldRenderPort, options = {}) {
        if (!worldRenderPort
            || typeof worldRenderPort.drawSquareInstances !== 'function') {
            throw new TypeError('TileMapRenderer에는 drawSquareInstances 포트가 필요합니다.');
        }
        this.worldRenderPort = worldRenderPort;
        this.geometryBuilder = options.geometryBuilder
            ?? new MapVisualGeometryBuilder();
        this.advancedPortAvailable = typeof worldRenderPort.drawShape === 'function'
            && typeof worldRenderPort.drawShapeInstances === 'function';
        this.presentationTime = 0;

        this.visibleCenters = [];
        this.centerPool = [];
        this.renderOptions = {
            layer: 'background',
            size: 0,
            fill: FLOOR_FILL,
            alpha: 1,
            centers: this.visibleCenters
        };

        this.facetACenters = [];
        this.facetAPool = [];
        this.facetBCenters = [];
        this.facetBPool = [];
        this.horizontalRimCenters = [];
        this.horizontalRimPool = [];
        this.verticalRimCenters = [];
        this.verticalRimPool = [];
        this.ambientSmallCenters = [];
        this.ambientSmallPool = [];
        this.ambientLargeCenters = [];
        this.ambientLargePool = [];
        this.gateCenters = [];
        this.gateCenterPool = [];
        this.portalArcACenters = [];
        this.portalArcAPool = [];
        this.portalArcBCenters = [];
        this.portalArcBPool = [];
        this.portalPylonCenters = [];
        this.portalPylonPool = [];

        this.backgroundBandOptions = Array.from(
            { length: ABYSS_BAND_COUNT },
            () => ({
                layer: 'background',
                shape: 'rect',
                x: 0,
                y: 0,
                w: 0,
                h: 0,
                fill: '#05070b',
                alpha: 1
            })
        );
        this.shadowOptions = this.#createInstanceOptions('square');
        this.sideOptions = this.#createInstanceOptions('square');
        this.floorOptions = this.#createInstanceOptions('square');
        this.facetAOptions = this.#createInstanceOptions('triangle');
        this.facetBOptions = this.#createInstanceOptions('square');
        this.facetBOptions.rotation = 45;
        this.horizontalRimOptions = this.#createInstanceOptions('rect');
        this.verticalRimOptions = this.#createInstanceOptions('rect');
        this.ambientSmallOptions = this.#createInstanceOptions('triangle');
        this.ambientLargeOptions = this.#createInstanceOptions('square');
        this.ambientLargeOptions.rotation = 45;
        this.portalRingOptions = [];
        this.portalVoidOptions = this.#createInstanceOptions('circle');
        this.portalArcAOptions = this.#createInstanceOptions('square');
        this.portalArcAOptions.rotation = 45;
        this.portalArcBOptions = this.#createInstanceOptions('triangle');
        this.portalPylonOptions = this.#createInstanceOptions('triangle');

        this.viewportTopLeft = { x: 0, y: 0 };
        this.viewportBottomRight = { x: 0, y: 0 };
        this.cachedTileMap = null;
        this.cachedTheme = null;
        this.cachedVisualRevision = Number.NaN;
        this.cachedProjectionRevision = -1;
        this.geometry = null;
        this.projectedTileSize = 0;
        this.portalRadiusPixels = 0;
    }

    #createInstanceOptions(shape) {
        return {
            layer: 'background',
            shape,
            w: 0,
            h: 0,
            fill: '#ffffff',
            alpha: 1,
            centers: null,
            originX: 0,
            originY: 0,
            localScale: 1,
            cacheKey: null
        };
    }

    /** Presentation variable time만 전진시킵니다. */
    update(frameDelta = 0) {
        const delta = Number(frameDelta);
        if (!Number.isFinite(delta) || delta <= 0) {
            return;
        }
        this.presentationTime = (this.presentationTime + Math.min(delta, 0.25))
            % 4096;
    }

    draw(tileMap, projection) {
        const worldProjection = assertWorldViewProjection2D(projection);
        const theme = resolveMapVisualTheme(tileMap?.getVisualThemeId?.());
        if (!this.advancedPortAvailable
            || theme.themeId === MAP_VISUAL_THEME_ID.FLAT) {
            this.#drawFlat(tileMap, worldProjection);
            return;
        }

        const visualRevision = Number(tileMap?.getVisualRevision?.() ?? 0);
        if (this.cachedTileMap !== tileMap
            || this.cachedTheme?.fingerprint !== theme.fingerprint
            || this.cachedVisualRevision !== visualRevision) {
            this.geometry = this.geometryBuilder.build(tileMap, theme);
            this.cachedTileMap = tileMap;
            this.cachedTheme = theme;
            this.cachedVisualRevision = visualRevision;
            this.cachedProjectionRevision = -1;
            this.#configureTheme(theme);
        }

        const projectionRevision = worldProjection.getProjectionRevision();
        if (this.cachedProjectionRevision !== projectionRevision) {
            this.#rebuildAdvancedProjectionCache(worldProjection);
            this.cachedProjectionRevision = projectionRevision;
        }
        this.#drawAdvanced(theme);
    }

    /** 기존 flat renderer를 byte-equivalent 옵션으로 유지합니다. */
    #drawFlat(tileMap, projection) {
        const projectionRevision = projection.getProjectionRevision();
        if (this.cachedTileMap !== tileMap
            || this.cachedTheme?.themeId !== MAP_VISUAL_THEME_ID.FLAT
            || this.cachedProjectionRevision !== projectionRevision) {
            this.#rebuildFlatProjectionCache(tileMap, projection);
            this.cachedTileMap = tileMap;
            this.cachedTheme = resolveMapVisualTheme(MAP_VISUAL_THEME_ID.FLAT);
            this.cachedVisualRevision = Number(tileMap?.getVisualRevision?.() ?? 0);
            this.cachedProjectionRevision = projectionRevision;
            this.geometry = null;
        }
        if (this.visibleCenters.length === 0 || this.renderOptions.size <= 0) {
            return;
        }
        this.worldRenderPort.drawSquareInstances(this.renderOptions);
    }

    #rebuildFlatProjectionCache(tileMap, projection) {
        const grid = tileMap.getNavigationGrid();
        const tileSize = grid.cellSize;
        const view = projection.getViewBounds();
        const minColumn = Math.max(0, Math.floor(view.left / tileSize));
        const maxColumn = Math.min(grid.cols - 1, Math.floor(view.right / tileSize));
        const minRow = Math.max(0, Math.floor(view.top / tileSize));
        const maxRow = Math.min(grid.rows - 1, Math.floor(view.bottom / tileSize));
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
                const center = pushPooledCenter(
                    this.visibleCenters,
                    this.centerPool,
                    0,
                    0
                );
                projection.worldToViewport(
                    (column + 0.5) * tileSize,
                    (row + 0.5) * tileSize,
                    center
                );
            }
        }
    }

    /** theme 변경 시에만 색상과 정적 style을 갱신합니다. */
    #configureTheme(theme) {
        const far = theme.background.farColor;
        const near = theme.background.nearColor;
        for (let index = 0; index < ABYSS_BAND_COUNT; index++) {
            const verticalAmount = index / (ABYSS_BAND_COUNT - 1);
            const gradientColor = mixHexColor(
                far,
                near,
                verticalAmount
            );
            const edgeDistance = Math.abs(
                (index + 0.5) / ABYSS_BAND_COUNT - 0.5
            ) * 2;
            this.backgroundBandOptions[index].fill = mixHexColor(
                gradientColor,
                '#000000',
                edgeDistance * theme.background.vignetteStrength * 0.34
            );
        }
        this.shadowOptions.fill = theme.platform.shadowColor;
        this.shadowOptions.alpha = 0.72;
        this.sideOptions.fill = mixHexColor(
            theme.platform.sideColor,
            theme.floor.baseColor,
            0.08
        );
        this.floorOptions.fill = mixHexColor(
            theme.floor.baseColor,
            theme.platform.topColor,
            0.68
        );
        this.facetAOptions.fill = theme.floor.facetColorA;
        this.facetAOptions.alpha = theme.floor.gridOpacity + 0.1;
        this.facetBOptions.fill = mixHexColor(
            theme.floor.facetColorB,
            theme.floor.gridColor,
            theme.floor.gridOpacity * 0.45
        );
        this.facetBOptions.alpha = theme.floor.gridOpacity + 0.08;
        this.horizontalRimOptions.fill = theme.platform.outerRimColor;
        this.horizontalRimOptions.alpha = 0.72;
        this.verticalRimOptions.fill = theme.platform.innerHighlightColor;
        this.verticalRimOptions.alpha = 0.52;
        this.ambientSmallOptions.fill = theme.floor.facetColorA;
        this.ambientSmallOptions.alpha = theme.ambientGeometry.opacity;
        this.ambientLargeOptions.fill = theme.platform.outerRimColor;
        this.ambientLargeOptions.alpha = theme.ambientGeometry.opacity * 0.72;
        this.portalVoidOptions.fill = theme.spawnPortal.colors[2];
        this.portalVoidOptions.alpha = 0.88;
        this.portalArcAOptions.fill = theme.spawnPortal.colors[0];
        this.portalArcAOptions.alpha = 0.72;
        this.portalArcBOptions.fill = theme.spawnPortal.colors[1];
        this.portalArcBOptions.alpha = 0.64;
        this.portalPylonOptions.fill = theme.spawnPortal.colors[0];
        this.portalPylonOptions.alpha = 0.82;
        while (this.portalRingOptions.length < theme.spawnPortal.ringCount) {
            this.portalRingOptions.push(this.#createInstanceOptions('ring'));
        }
        for (let index = 0; index < this.portalRingOptions.length; index++) {
            const options = this.portalRingOptions[index];
            options.fill = theme.spawnPortal.colors[index % 2];
            options.alpha = 0.38 + index * 0.08;
        }
    }

    /** static geometry를 현재 viewport로 projection합니다. */
    #rebuildAdvancedProjectionCache(projection) {
        const geometry = this.geometry;
        const view = projection.getViewBounds();
        const tileSize = geometry.tileSize;
        const minColumn = Math.max(0, Math.floor(view.left / tileSize) - 1);
        const maxColumn = Math.min(
            geometry.columns - 1,
            Math.floor(view.right / tileSize) + 1
        );
        const minRow = Math.max(0, Math.floor(view.top / tileSize) - 1);
        const maxRow = Math.min(
            geometry.rows - 1,
            Math.floor(view.bottom / tileSize) + 1
        );
        this.projectedTileSize = projection.worldLengthToViewport(tileSize);
        this.visibleCenters.length = 0;
        for (let row = minRow; row <= maxRow; row++) {
            const start = geometry.rowOffsets[row];
            const end = geometry.rowOffsets[row + 1];
            for (let index = start; index < end; index++) {
                const column = geometry.walkableColumns[index];
                if (column < minColumn) {
                    continue;
                }
                if (column > maxColumn) {
                    break;
                }
                const center = pushPooledCenter(
                    this.visibleCenters,
                    this.centerPool,
                    0,
                    0
                );
                projection.worldToViewport(
                    (column + 0.5) * tileSize,
                    (row + 0.5) * tileSize,
                    center
                );
            }
        }

        this.#projectPairArray(
            geometry.facetA,
            this.facetACenters,
            this.facetAPool,
            projection,
            view,
            tileSize
        );
        this.#projectPairArray(
            geometry.facetB,
            this.facetBCenters,
            this.facetBPool,
            projection,
            view,
            tileSize
        );
        this.#projectPairArray(
            geometry.horizontalEdges,
            this.horizontalRimCenters,
            this.horizontalRimPool,
            projection,
            view,
            tileSize
        );
        this.#projectPairArray(
            geometry.verticalEdges,
            this.verticalRimCenters,
            this.verticalRimPool,
            projection,
            view,
            tileSize
        );
        this.#projectAmbientFragments(projection, view);
        this.#projectGateCenters(projection);
        this.#configureProjectedSizes(projection);
        this.#configureAbyssBands(projection, view);
    }

    #projectPairArray(source, target, pool, projection, view, margin) {
        target.length = 0;
        for (let index = 0; index < source.length; index += 2) {
            const x = source[index];
            const y = source[index + 1];
            if (x < view.left - margin
                || x > view.right + margin
                || y < view.top - margin
                || y > view.bottom + margin) {
                continue;
            }
            const center = pushPooledCenter(target, pool, 0, 0);
            projection.worldToViewport(x, y, center);
        }
    }

    /** bounded void fragments에 camera-relative micro parallax만 적용합니다. */
    #projectAmbientFragments(projection, view) {
        this.ambientSmallCenters.length = 0;
        this.ambientLargeCenters.length = 0;
        const source = this.geometry.ambientFragments;
        const factor = clamp(
            this.cachedTheme.ambientGeometry.parallaxFactor
                + this.cachedTheme.background.parallaxStrength * 0.5,
            0,
            1
        );
        const cameraCenterX = (view.left + view.right) * 0.5;
        const cameraCenterY = (view.top + view.bottom) * 0.5;
        const offsetX = (cameraCenterX - this.geometry.worldCenterX) * (1 - factor);
        const offsetY = (cameraCenterY - this.geometry.worldCenterY) * (1 - factor);
        for (let index = 0; index < source.length; index += 4) {
            const worldX = source[index] + offsetX;
            const worldY = source[index + 1] + offsetY;
            if (worldX < view.left - 1
                || worldX > view.right + 1
                || worldY < view.top - 1
                || worldY > view.bottom + 1) {
                continue;
            }
            const large = source[index + 2] >= this.geometry.tileSize * 0.39;
            const target = large
                ? this.ambientLargeCenters
                : this.ambientSmallCenters;
            const pool = large ? this.ambientLargePool : this.ambientSmallPool;
            const center = pushPooledCenter(target, pool, 0, 0);
            projection.worldToViewport(worldX, worldY, center);
        }
    }

    /** authored exact route entry point를 projection합니다. */
    #projectGateCenters(projection) {
        this.gateCenters.length = 0;
        const source = this.geometry.gatePositions;
        for (let index = 0; index < source.length; index += 2) {
            const center = pushPooledCenter(
                this.gateCenters,
                this.gateCenterPool,
                0,
                0
            );
            projection.worldToViewport(source[index], source[index + 1], center);
        }
    }

    /** projection-dependent visual-only sizes를 계산합니다. */
    #configureProjectedSizes(projection) {
        const tilePixels = this.projectedTileSize;
        const topSize = tilePixels * (1 - FLOOR_TILE_GAP_RATIO);
        const sideDepthPixels = projection.worldLengthToViewport(
            this.cachedTheme.platform.sideDepthWorldUnits
        );
        const rimThickness = Math.max(
            0.5,
            projection.worldLengthToViewport(this.geometry.tileSize * 0.055)
        );
        this.shadowOptions.w = tilePixels * 1.04;
        this.shadowOptions.h = tilePixels * 1.04;
        this.shadowOptions.originY = sideDepthPixels * 1.45;
        this.sideOptions.w = topSize;
        this.sideOptions.h = topSize;
        this.sideOptions.originY = sideDepthPixels;
        this.floorOptions.w = topSize;
        this.floorOptions.h = topSize;
        this.floorOptions.originY = 0;
        this.facetAOptions.w = tilePixels * 0.68;
        this.facetAOptions.h = tilePixels * 0.62;
        this.facetBOptions.w = tilePixels * 0.48;
        this.facetBOptions.h = tilePixels * 0.48;
        this.horizontalRimOptions.w = tilePixels;
        this.horizontalRimOptions.h = rimThickness;
        this.verticalRimOptions.w = rimThickness;
        this.verticalRimOptions.h = tilePixels;
        this.ambientSmallOptions.w = tilePixels * 0.28;
        this.ambientSmallOptions.h = tilePixels * 0.34;
        this.ambientLargeOptions.w = tilePixels * 0.46;
        this.ambientLargeOptions.h = tilePixels * 0.46;
        this.portalRadiusPixels = projection.worldLengthToViewport(
            this.geometry.tileSize * this.cachedTheme.spawnPortal.radiusScale
        );
    }

    /** viewport 전체를 덮는 bounded vertical abyss gradient band를 준비합니다. */
    #configureAbyssBands(projection, view) {
        projection.worldToViewport(view.left, view.top, this.viewportTopLeft);
        projection.worldToViewport(
            view.right,
            view.bottom,
            this.viewportBottomRight
        );
        const left = Math.min(this.viewportTopLeft.x, this.viewportBottomRight.x);
        const top = Math.min(this.viewportTopLeft.y, this.viewportBottomRight.y);
        const width = Math.abs(
            this.viewportBottomRight.x - this.viewportTopLeft.x
        );
        const height = Math.abs(
            this.viewportBottomRight.y - this.viewportTopLeft.y
        );
        const bandHeight = height / ABYSS_BAND_COUNT + 1;
        for (let index = 0; index < ABYSS_BAND_COUNT; index++) {
            const options = this.backgroundBandOptions[index];
            options.x = left + width * 0.5;
            options.y = top + bandHeight * (index + 0.5);
            options.w = width + 2;
            options.h = bandHeight + 1;
        }
    }

    /** draw layer 순서를 고정해 portal이 actor보다 항상 아래에 남게 합니다. */
    #drawAdvanced(theme) {
        for (let index = 0; index < ABYSS_BAND_COUNT; index++) {
            this.worldRenderPort.drawShape(this.backgroundBandOptions[index]);
        }
        this.#drawInstances(this.ambientSmallOptions, this.ambientSmallCenters);
        this.#drawInstances(this.ambientLargeOptions, this.ambientLargeCenters);
        this.#drawInstances(this.shadowOptions, this.visibleCenters);
        this.#drawInstances(this.sideOptions, this.visibleCenters);
        this.#drawInstances(this.floorOptions, this.visibleCenters);
        this.#drawInstances(this.facetAOptions, this.facetACenters);
        this.#drawInstances(this.facetBOptions, this.facetBCenters);
        this.#drawInstances(
            this.horizontalRimOptions,
            this.horizontalRimCenters
        );
        this.#drawInstances(this.verticalRimOptions, this.verticalRimCenters);
        this.#drawSpawnPortals(theme);
    }

    /** portal idle pulse와 counter-rotating segmented arc를 bounded pool에 기록합니다. */
    #drawSpawnPortals(theme) {
        if (this.gateCenters.length === 0 || this.portalRadiusPixels <= 0) {
            return;
        }
        const pulsePhase = this.presentationTime
            * FULL_CIRCLE_RADIANS
            / theme.spawnPortal.pulsePeriodSeconds;
        const pulseScale = 1 + Math.sin(pulsePhase) * 0.045;
        const rotationPhase = this.presentationTime
            * FULL_CIRCLE_RADIANS
            / theme.spawnPortal.rotationPeriodSeconds;
        const radius = this.portalRadiusPixels * pulseScale;
        this.portalVoidOptions.w = radius * 1.18;
        this.portalVoidOptions.h = radius * 1.18;
        this.#drawInstances(this.portalVoidOptions, this.gateCenters);

        for (let index = theme.spawnPortal.ringCount - 1; index >= 0; index--) {
            const ringOptions = this.portalRingOptions[index];
            const ringRadius = radius * (0.52 + index * 0.24);
            ringOptions.w = ringRadius * 2;
            ringOptions.h = ringRadius * 2;
            this.#drawInstances(ringOptions, this.gateCenters);
        }

        this.portalArcACenters.length = 0;
        this.portalArcBCenters.length = 0;
        this.portalPylonCenters.length = 0;
        for (let gateIndex = 0; gateIndex < this.gateCenters.length; gateIndex++) {
            const gate = this.gateCenters[gateIndex];
            for (let segment = 0; segment < PORTAL_SEGMENTS_PER_ARC; segment++) {
                const segmentPhase = segment
                    * FULL_CIRCLE_RADIANS
                    / PORTAL_SEGMENTS_PER_ARC;
                const angleA = rotationPhase + segmentPhase;
                const angleB = -rotationPhase * 0.72 + segmentPhase
                    + Math.PI / PORTAL_SEGMENTS_PER_ARC;
                pushPooledCenter(
                    this.portalArcACenters,
                    this.portalArcAPool,
                    gate.x + Math.cos(angleA) * radius * 0.72,
                    gate.y + Math.sin(angleA) * radius * 0.72
                );
                pushPooledCenter(
                    this.portalArcBCenters,
                    this.portalArcBPool,
                    gate.x + Math.cos(angleB) * radius * 0.96,
                    gate.y + Math.sin(angleB) * radius * 0.96
                );
            }
            pushPooledCenter(
                this.portalPylonCenters,
                this.portalPylonPool,
                gate.x,
                gate.y - radius * 0.88
            );
        }
        const segmentSize = clamp(radius * 0.13, 1.5, 7);
        this.portalArcAOptions.w = segmentSize;
        this.portalArcAOptions.h = segmentSize;
        this.portalArcBOptions.w = segmentSize * 1.15;
        this.portalArcBOptions.h = segmentSize * 1.15;
        this.portalPylonOptions.w = radius * 0.32;
        this.portalPylonOptions.h = radius * 0.42;
        this.#drawInstances(this.portalArcAOptions, this.portalArcACenters);
        this.#drawInstances(this.portalArcBOptions, this.portalArcBCenters);
        this.#drawInstances(this.portalPylonOptions, this.portalPylonCenters);
    }

    #drawInstances(options, centers) {
        if (centers.length === 0 || options.w <= 0 || options.h <= 0) {
            return;
        }
        options.centers = centers;
        this.worldRenderPort.drawShapeInstances(options);
    }

    /** 테스트/측정용 presentation 진단입니다. */
    getDiagnostics() {
        return Object.freeze({
            advanced: this.cachedTheme?.themeId
                === MAP_VISUAL_THEME_ID.PURPLE_CRYSTAL,
            geometryBuildCount: this.geometryBuilder.getBuildCount(),
            projectionRevision: this.cachedProjectionRevision,
            visibleTileCount: this.visibleCenters.length,
            staticGeometry: this.geometry?.diagnostics ?? null
        });
    }

    /** 렌더 포트와 모든 bounded scratch 참조를 정리합니다. */
    destroy() {
        const arrays = [
            this.visibleCenters,
            this.centerPool,
            this.facetACenters,
            this.facetAPool,
            this.facetBCenters,
            this.facetBPool,
            this.horizontalRimCenters,
            this.horizontalRimPool,
            this.verticalRimCenters,
            this.verticalRimPool,
            this.ambientSmallCenters,
            this.ambientSmallPool,
            this.ambientLargeCenters,
            this.ambientLargePool,
            this.gateCenters,
            this.gateCenterPool,
            this.portalArcACenters,
            this.portalArcAPool,
            this.portalArcBCenters,
            this.portalArcBPool,
            this.portalPylonCenters,
            this.portalPylonPool
        ];
        for (const array of arrays) {
            array.length = 0;
        }
        this.cachedTileMap = null;
        this.cachedTheme = null;
        this.geometry = null;
        this.cachedProjectionRevision = -1;
        this.worldRenderPort = null;
        this.geometryBuilder = null;
    }
}
