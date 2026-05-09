import {
    EPSILON,
    HEXA_HIVE_LAYOUT_SCHEMA_VERSION,
    HEXA_HIVE_TYPE
} from './_hexa_hive_layout_constants.js';
import { rotatePoint, toRadians } from 'util/math_util.js';

/**
 * 합체 적 레이아웃을 깊은 복제로 정규화합니다.
 * @param {object|null|undefined} layout - 원본 레이아웃입니다.
 * @returns {object|null} 복제된 레이아웃입니다.
 */
export function cloneHexaHiveLayout(layout) {
    if (!layout || typeof layout !== 'object') {
        return null;
    }

    return {
        schemaVersion: Number.isInteger(layout.schemaVersion)
            ? layout.schemaVersion
            : HEXA_HIVE_LAYOUT_SCHEMA_VERSION,
        visibleCells: Array.isArray(layout.visibleCells)
            ? layout.visibleCells.map((cell) => ({
                q: Number.isInteger(cell?.q) ? cell.q : 0,
                r: Number.isInteger(cell?.r) ? cell.r : 0
            }))
            : [],
        filledCells: Array.isArray(layout.filledCells)
            ? layout.filledCells.map((cell) => ({
                q: Number.isInteger(cell?.q) ? cell.q : 0,
                r: Number.isInteger(cell?.r) ? cell.r : 0
            }))
            : [],
        visibleLocalCenters: Array.isArray(layout.visibleLocalCenters)
            ? layout.visibleLocalCenters.map((point) => ({
                x: Number.isFinite(point?.x) ? point.x : 0,
                y: Number.isFinite(point?.y) ? point.y : 0
            }))
            : [],
        filledLocalCenters: Array.isArray(layout.filledLocalCenters)
            ? layout.filledLocalCenters.map((point) => ({
                x: Number.isFinite(point?.x) ? point.x : 0,
                y: Number.isFinite(point?.y) ? point.y : 0
            }))
            : [],
        outlineVertices: Array.isArray(layout.outlineVertices)
            ? layout.outlineVertices.map((point) => ({
                x: Number.isFinite(point?.x) ? point.x : 0,
                y: Number.isFinite(point?.y) ? point.y : 0
            }))
            : []
    };
}

/**
 * 합체 적 외곽 루프를 이루는 선분을 순회합니다.
 * @param {object|null|undefined} layout - 순회할 레이아웃입니다.
 * @param {(segment: {start: {x: number, y: number}, end: {x: number, y: number}}) => void} iteratee - 선분 콜백입니다.
 */
export function forEachHexaHiveOutlineSegment(layout, iteratee) {
    if (!layout || !Array.isArray(layout.outlineVertices) || layout.outlineVertices.length < 2 || typeof iteratee !== 'function') {
        return;
    }

    const vertices = layout.outlineVertices;
    for (let i = 0; i < vertices.length; i++) {
        const start = vertices[i];
        const end = vertices[(i + 1) % vertices.length];
        if (!start || !end) {
            continue;
        }

        iteratee({
            start: {
                x: Number.isFinite(start.x) ? start.x : 0,
                y: Number.isFinite(start.y) ? start.y : 0
            },
            end: {
                x: Number.isFinite(end.x) ? end.x : 0,
                y: Number.isFinite(end.y) ? end.y : 0
            }
        });
    }
}

/**
 * 적 인스턴스에서 현재 보이는 육각 조각의 월드 중심 목록을 추출합니다.
 * @param {object|null|undefined} enemy - 대상 적입니다.
 * @returns {{x: number, y: number}[]} 월드 셀 중심 목록입니다.
 */
export function collectHexaWorldCellsFromEnemy(enemy) {
    if (!enemy || typeof enemy !== 'object' || (enemy.type !== 'hexa' && enemy.type !== HEXA_HIVE_TYPE) || enemy.active === false) {
        return [];
    }

    const baseHeight = typeof enemy.getRenderHeightPx === 'function'
        ? enemy.getRenderHeightPx()
        : (Number.isFinite(enemy.renderHeightPx) ? enemy.renderHeightPx : 0);
    const positionX = Number.isFinite(enemy.position?.x) ? enemy.position.x : 0;
    const positionY = Number.isFinite(enemy.position?.y) ? enemy.position.y : 0;
    const rotationRadians = toRadians(enemy.rotation ?? 0);
    const worldCells = [];

    if (enemy.type === HEXA_HIVE_TYPE && enemy.hexaHiveLayout?.visibleLocalCenters?.length > 0 && baseHeight > EPSILON) {
        for (let i = 0; i < enemy.hexaHiveLayout.visibleLocalCenters.length; i++) {
            const localCenter = enemy.hexaHiveLayout.visibleLocalCenters[i];
            const rotated = rotatePoint(localCenter.x * baseHeight, localCenter.y * baseHeight, rotationRadians);
            worldCells.push({
                x: positionX + rotated.x,
                y: positionY + rotated.y
            });
        }
        return worldCells;
    }

    worldCells.push({ x: positionX, y: positionY });
    return worldCells;
}
