import { getObjectOffsetY, renderGL } from 'display/display_system.js';
import { getData } from 'data/data_handler.js';
import { collectHexaWorldCellsFromEnemy } from './enemy/_hexa_hive_layout.js';

const EFFECT_TYPES = getData('EFFECT_RENDER_CONSTANTS').TYPES;
const HEXA_HIVE_MERGE_PRESENTATION = getData('ENEMY_CONSTANTS').HEXA_HIVE.MERGE.PRESENTATION;
const EFFECT_LINE_LENGTH_RATIO = Number.isFinite(HEXA_HIVE_MERGE_PRESENTATION.EFFECT_LINE_LENGTH_RATIO)
    ? Math.max(0.1, HEXA_HIVE_MERGE_PRESENTATION.EFFECT_LINE_LENGTH_RATIO)
    : 0.74;
const EFFECT_LINE_WIDTH_RATIO = Number.isFinite(HEXA_HIVE_MERGE_PRESENTATION.EFFECT_LINE_WIDTH_RATIO)
    ? Math.max(0.01, HEXA_HIVE_MERGE_PRESENTATION.EFFECT_LINE_WIDTH_RATIO)
    : 0.08;
const EFFECT_GLOW_WIDTH_RATIO = Number.isFinite(HEXA_HIVE_MERGE_PRESENTATION.EFFECT_GLOW_WIDTH_RATIO)
    ? Math.max(0.02, HEXA_HIVE_MERGE_PRESENTATION.EFFECT_GLOW_WIDTH_RATIO)
    : 0.34;
const EPSILON = 1e-6;

/**
 * 적의 합체 표시 오프셋을 반환합니다.
 * @param {object|null|undefined} enemy - 대상 적입니다.
 * @returns {{x:number, y:number}} 표시 오프셋입니다.
 */
function getHexaHivePresentationOffset(enemy) {
    return {
        x: (Number.isFinite(enemy?.mergePullOffset?.x) ? enemy.mergePullOffset.x : 0)
            + (Number.isFinite(enemy?.mergeSettleOffset?.x) ? enemy.mergeSettleOffset.x : 0),
        y: (Number.isFinite(enemy?.mergePullOffset?.y) ? enemy.mergePullOffset.y : 0)
            + (Number.isFinite(enemy?.mergeSettleOffset?.y) ? enemy.mergeSettleOffset.y : 0)
    };
}

/**
 * 보간 렌더 좌표와 합체 표시 오프셋을 반영한 적 중심 좌표를 반환합니다.
 * @param {object|null|undefined} enemy - 대상 적입니다.
 * @returns {{x:number, y:number}} 표시 중심 좌표입니다.
 */
function getPresentedEnemyCenter(enemy) {
    const offset = getHexaHivePresentationOffset(enemy);
    return {
        x: (Number.isFinite(enemy?.renderPosition?.x) ? enemy.renderPosition.x : 0) + offset.x,
        y: (Number.isFinite(enemy?.renderPosition?.y) ? enemy.renderPosition.y : 0) + offset.y
    };
}

/**
 * 보간 렌더 좌표와 합체 표시 오프셋을 반영한 육각 셀 중심 목록을 반환합니다.
 * @param {object|null|undefined} enemy - 대상 적입니다.
 * @returns {{x:number, y:number}[]} 표시 셀 중심 목록입니다.
 */
function collectPresentedHexaWorldCells(enemy) {
    const worldCells = collectHexaWorldCellsFromEnemy(enemy);
    if (worldCells.length === 0) {
        return [];
    }

    const offset = getHexaHivePresentationOffset(enemy);
    const renderDeltaX = (Number.isFinite(enemy?.renderPosition?.x) ? enemy.renderPosition.x : 0)
        - (Number.isFinite(enemy?.position?.x) ? enemy.position.x : 0)
        + offset.x;
    const renderDeltaY = (Number.isFinite(enemy?.renderPosition?.y) ? enemy.renderPosition.y : 0)
        - (Number.isFinite(enemy?.position?.y) ? enemy.position.y : 0)
        + offset.y;

    return worldCells.map((cell) => ({
        x: cell.x + renderDeltaX,
        y: cell.y + renderDeltaY
    }));
}

/**
 * 두 적 사이에서 가장 가까운 육각 셀 중심 쌍을 찾습니다.
 * @param {object} enemyA - 첫 번째 적입니다.
 * @param {object} enemyB - 두 번째 적입니다.
 * @returns {{a:{x:number, y:number}, b:{x:number, y:number}}} 가장 가까운 셀 중심 쌍입니다.
 */
function findClosestHexaCellPair(enemyA, enemyB) {
    const cellsA = collectPresentedHexaWorldCells(enemyA);
    const cellsB = collectPresentedHexaWorldCells(enemyB);
    if (cellsA.length === 0 || cellsB.length === 0) {
        return {
            a: getPresentedEnemyCenter(enemyA),
            b: getPresentedEnemyCenter(enemyB)
        };
    }

    let bestA = cellsA[0];
    let bestB = cellsB[0];
    let bestDistanceSq = Number.POSITIVE_INFINITY;
    for (let i = 0; i < cellsA.length; i++) {
        const cellA = cellsA[i];
        for (let j = 0; j < cellsB.length; j++) {
            const cellB = cellsB[j];
            const dx = cellB.x - cellA.x;
            const dy = cellB.y - cellA.y;
            const distanceSq = (dx * dx) + (dy * dy);
            if (distanceSq < bestDistanceSq) {
                bestA = cellA;
                bestB = cellB;
                bestDistanceSq = distanceSq;
            }
        }
    }

    return {
        a: bestA,
        b: bestB
    };
}

/**
 * 적의 렌더 높이를 반환합니다.
 * @param {object|null|undefined} enemy - 대상 적입니다.
 * @returns {number} 렌더 높이입니다.
 */
function getEnemyRenderHeight(enemy) {
    if (typeof enemy?.getRenderHeightPx === 'function') {
        const height = enemy.getRenderHeightPx();
        if (Number.isFinite(height) && height > EPSILON) {
            return height;
        }
    }

    return 24;
}

/**
 * 합체 예열 중인 육각형 경계 WebGL 이펙트를 렌더링합니다.
 * @param {{enemyA: object, enemyB: object, progress: number}[]} effectPairs - 합체 경계 이펙트 페어 목록입니다.
 */
export function drawObjectSystemHexaHiveMergeEffects(effectPairs) {
    if (!Array.isArray(effectPairs) || effectPairs.length === 0) {
        return;
    }

    const objectOffsetY = getObjectOffsetY();
    const time = performance.now() / 1000;
    for (let i = 0; i < effectPairs.length; i++) {
        const pair = effectPairs[i];
        const enemyA = pair?.enemyA;
        const enemyB = pair?.enemyB;
        if (!enemyA || !enemyB || enemyA.active === false || enemyB.active === false) {
            continue;
        }

        const cellPair = findClosestHexaCellPair(enemyA, enemyB);
        const dx = cellPair.b.x - cellPair.a.x;
        const dy = cellPair.b.y - cellPair.a.y;
        const distance = Math.hypot(dx, dy);
        if (distance <= EPSILON) {
            continue;
        }

        const progress = Math.min(1, Math.max(0, Number.isFinite(pair.progress) ? pair.progress : 0));
        const dirX = dx / distance;
        const dirY = dy / distance;
        const seamX = (cellPair.a.x + cellPair.b.x) * 0.5;
        const seamY = (cellPair.a.y + cellPair.b.y) * 0.5;
        const perpendicularX = -dirY;
        const perpendicularY = dirX;
        const baseHeight = Math.min(getEnemyRenderHeight(enemyA), getEnemyRenderHeight(enemyB));
        const halfLength = baseHeight * EFFECT_LINE_LENGTH_RATIO * (0.84 + (progress * 0.16)) * 0.5;
        const lineWidth = baseHeight * EFFECT_LINE_WIDTH_RATIO * (0.88 + (progress * 0.18));
        const glowWidth = baseHeight * EFFECT_GLOW_WIDTH_RATIO * (0.82 + (progress * 0.22));

        renderGL('effectGL', {
            effectType: EFFECT_TYPES.HEXA_MERGE_BOUNDARY,
            x1: seamX - (perpendicularX * halfLength),
            y1: seamY - (perpendicularY * halfLength) - objectOffsetY,
            x2: seamX + (perpendicularX * halfLength),
            y2: seamY + (perpendicularY * halfLength) - objectOffsetY,
            progress,
            alpha: 0.88,
            lineWidth,
            glowWidth,
            time,
            coreColor: [1.0, 1.0, 1.0],
            glowColor: [0.82, 0.95, 1.0],
            highlightColor: [1.0, 1.0, 1.0]
        });
    }
}
