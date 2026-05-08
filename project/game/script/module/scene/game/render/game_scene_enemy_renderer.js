import { renderGL } from 'display/display_system.js';
import { getData } from 'data/data_handler.js';
import { colorUtil } from 'util/color_util.js';
import { getHexaHiveType } from 'object/enemy/_hexa_hive_layout.js';
import { drawEnemyCollisionDebugCircles } from 'object/enemy/_enemy_collision_debug.js';
import {
    GAME_SCENE_SHARED_PRESENTATION_STRIDE,
    getGameSceneEnemyTypeByCode
} from 'simulation/game_scene_shared_presentation.js';
import { measurePerformanceSection } from 'debug/debug_system.js';
import { normalizeSnapshotNumber } from '../game_scene_snapshot_utils.js';
import {
    getBenchmarkColor,
    getBenchmarkEnemyFill,
    normalizeOpaqueBenchmarkEnemyFill
} from './game_scene_benchmark_palette.js';

const ENEMY_ASPECT_RATIO = getData('ENEMY_ASPECT_RATIO');
const ENEMY_DRAW_HEIGHT_RATIO = getData('ENEMY_DRAW_HEIGHT_RATIO');
const ENEMY_HEIGHT_SCALE = getData('ENEMY_HEIGHT_SCALE');
const getEnemyShapeKey = getData('getEnemyShapeKey');
const HEXA_HIVE_TYPE = getHexaHiveType();
const HEXA_SNAPSHOT_FRONT_SCALE = 1;
const HEXA_SNAPSHOT_BACKDROP_SCALE = 1.14;

/**
 * 합체 적 조각 좌표를 회전합니다.
 * @param {number} x - 로컬 x 좌표입니다.
 * @param {number} y - 로컬 y 좌표입니다.
 * @param {number} radians - 회전 라디안입니다.
 * @returns {{x: number, y: number}}
 */
function rotateHiveSnapshotPoint(x, y, radians) {
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return {
        x: (x * cos) - (y * sin),
        y: (x * sin) + (y * cos)
    };
}

/**
 * 합체 적 내부 실루엣용 배경색을 계산합니다.
 * @param {string} sourceFill - 원본 채움 색상입니다.
 * @returns {string}
 */
function resolveHiveSnapshotBackdropFill(sourceFill) {
    if (typeof sourceFill === 'string' && sourceFill.length > 0) {
        return colorUtil().lerpColor(sourceFill, getBenchmarkColor('HexaBackdropFallback'), 0.72);
    }

    return getBenchmarkColor('HexaBackdropFallback');
}

/**
 * 육각형 셀 하나를 간단한 외곽 포함 형태로 렌더합니다.
 * @param {{x: number, y: number, size: number, fill: string, alpha?: number, rotation?: number, front?: boolean}} options - 렌더 옵션입니다.
 */
function drawHexaSnapshotCell(options) {
    const alpha = Number.isFinite(options?.alpha) ? options.alpha : 1;
    const rotation = normalizeSnapshotNumber(options?.rotation, 0);
    const size = normalizeSnapshotNumber(options?.size, 0);
    const fill = normalizeOpaqueBenchmarkEnemyFill(
        typeof options?.fill === 'string' ? options.fill : '#ff6c6c'
    );
    const backdropFill = resolveHiveSnapshotBackdropFill(fill);
    const x = normalizeSnapshotNumber(options?.x, 0);
    const y = normalizeSnapshotNumber(options?.y, 0);

    renderGL('object', {
        shape: 'hexagon',
        x,
        y,
        w: size * HEXA_SNAPSHOT_BACKDROP_SCALE,
        h: size * HEXA_SNAPSHOT_BACKDROP_SCALE,
        fill: backdropFill,
        alpha,
        rotation
    });
    if (options?.front === false) {
        return;
    }

    renderGL('object', {
        shape: 'hexagon',
        x,
        y,
        w: size * HEXA_SNAPSHOT_FRONT_SCALE,
        h: size * HEXA_SNAPSHOT_FRONT_SCALE,
        fill,
        alpha,
        rotation
    });
}

/**
 * 합체 적 스냅샷을 다조각 형태로 렌더합니다.
 * @param {object|null|undefined} enemy - 적 스냅샷입니다.
 * @param {number} offsetY - 렌더 오프셋입니다.
 * @param {number} baseHeight - 기준 높이입니다.
 * @param {string} fallbackFill - 대체 채움 색상입니다.
 * @returns {boolean}
 */
function drawHexaHiveSnapshot(enemy, offsetY, baseHeight, fallbackFill) {
    const layout = enemy?.hexaHiveLayout;
    if (!layout || !Array.isArray(layout.visibleLocalCenters) || layout.visibleLocalCenters.length === 0) {
        return false;
    }

    const renderPosition = enemy.renderPosition ?? enemy.position;
    const renderX = normalizeSnapshotNumber(renderPosition?.x, 0);
    const renderY = normalizeSnapshotNumber(renderPosition?.y, 0) - offsetY;
    const size = normalizeSnapshotNumber(enemy.size, 1);
    const localBaseHeight = baseHeight * size;
    const rotation = normalizeSnapshotNumber(enemy.rotation, 0);
    const rotationRadians = rotation * (Math.PI / 180);
    const fill = typeof enemy.fill === 'string' ? enemy.fill : fallbackFill;
    const backdropCenters = Array.isArray(layout.filledLocalCenters) && layout.filledLocalCenters.length > 0
        ? layout.filledLocalCenters
        : layout.visibleLocalCenters;

    for (let i = 0; i < backdropCenters.length; i++) {
        const localCenter = backdropCenters[i];
        const rotated = rotateHiveSnapshotPoint(
            normalizeSnapshotNumber(localCenter?.x, 0) * localBaseHeight,
            normalizeSnapshotNumber(localCenter?.y, 0) * localBaseHeight,
            rotationRadians
        );
        drawHexaSnapshotCell({
            x: renderX + rotated.x,
            y: renderY + rotated.y,
            size: localBaseHeight,
            fill,
            alpha: 1,
            rotation,
            front: false
        });
    }

    for (let i = 0; i < layout.visibleLocalCenters.length; i++) {
        const localCenter = layout.visibleLocalCenters[i];
        const rotated = rotateHiveSnapshotPoint(
            normalizeSnapshotNumber(localCenter?.x, 0) * localBaseHeight,
            normalizeSnapshotNumber(localCenter?.y, 0) * localBaseHeight,
            rotationRadians
        );
        renderGL('object', {
            shape: 'hexagon',
            x: renderX + rotated.x,
            y: renderY + rotated.y,
            w: localBaseHeight * HEXA_SNAPSHOT_FRONT_SCALE,
            h: localBaseHeight * HEXA_SNAPSHOT_FRONT_SCALE,
            fill: normalizeOpaqueBenchmarkEnemyFill(fill),
            alpha: 1,
            rotation
        });
    }

    drawEnemyCollisionDebugCircles({
        enemyType: HEXA_HIVE_TYPE,
        localCenters: backdropCenters,
        width: localBaseHeight,
        height: localBaseHeight,
        rotationRadians,
        renderX,
        renderY
    });

    return true;
}

/**
 * 공유 프레젠테이션 적 타입 코드별 렌더 설정을 생성합니다.
 * @returns {{shapeByCode: string[], aspectByCode: number[], heightScaleByCode: number[]}}
 */
function createSharedEnemyRenderConfig() {
    const shapeByCode = [];
    const aspectByCode = [];
    const heightScaleByCode = [];
    const maxEnemyTypeCode = 7;

    for (let code = 0; code <= maxEnemyTypeCode; code++) {
        const enemyType = getGameSceneEnemyTypeByCode(code);
        const renderEnemyType = enemyType === 'hexa_hive' ? 'hexa' : enemyType;
        shapeByCode[code] = getEnemyShapeKey(renderEnemyType) || getEnemyShapeKey('square');
        aspectByCode[code] = ENEMY_ASPECT_RATIO[renderEnemyType] ?? 1;
        heightScaleByCode[code] = ENEMY_HEIGHT_SCALE[renderEnemyType] ?? 1;
    }

    return {
        shapeByCode,
        aspectByCode,
        heightScaleByCode
    };
}

const SHARED_ENEMY_RENDER_CONFIG = createSharedEnemyRenderConfig();

/**
 * 일반 스냅샷 기반 적 목록을 렌더합니다.
 * @param {object[]} [enemies=[]] - 적 스냅샷 목록입니다.
 * @param {{objectOffsetY?: number, objectWH?: number}} [options={}] - 렌더 옵션입니다.
 */
export function drawGameSceneEnemySnapshots(enemies = [], options = {}) {
    const enemyList = Array.isArray(enemies) ? enemies : [];
    const offsetY = normalizeSnapshotNumber(options?.objectOffsetY, 0);
    const fallbackFill = normalizeOpaqueBenchmarkEnemyFill(getBenchmarkEnemyFill());
    const baseHeight = normalizeSnapshotNumber(options?.objectWH, 0) * ENEMY_DRAW_HEIGHT_RATIO;

    measurePerformanceSection('scene.game.snapshot.enemies', () => {
        for (let i = 0; i < enemyList.length; i++) {
            const enemy = enemyList[i];
            if (!enemy || enemy.active === false) continue;

            const enemyType = typeof enemy.type === 'string' ? enemy.type : 'square';
            if (enemyType === HEXA_HIVE_TYPE && drawHexaHiveSnapshot(enemy, offsetY, baseHeight, fallbackFill)) {
                continue;
            }
            const shapeKey = getEnemyShapeKey(enemyType) || getEnemyShapeKey('square');
            const renderPosition = enemy.renderPosition ?? enemy.position;
            const size = normalizeSnapshotNumber(enemy.size, 1);
            const baseH = baseHeight * size;
            const w = baseH * (ENEMY_ASPECT_RATIO[enemyType] ?? 1);
            const h = baseH * (ENEMY_HEIGHT_SCALE[enemyType] ?? 1);
            const renderX = normalizeSnapshotNumber(renderPosition?.x, 0);
            const renderY = normalizeSnapshotNumber(renderPosition?.y, 0) - offsetY;
            const rotation = normalizeSnapshotNumber(enemy.rotation, 0);
            renderGL('object', {
                shape: shapeKey,
                x: renderX,
                y: renderY,
                w,
                h,
                fill: normalizeOpaqueBenchmarkEnemyFill(typeof enemy.fill === 'string' ? enemy.fill : fallbackFill),
                alpha: 1,
                rotation
            });
            drawEnemyCollisionDebugCircles({
                enemyType,
                width: w,
                height: h,
                rotationRadians: rotation * (Math.PI / 180),
                renderX,
                renderY
            });
        }
    });
}

/**
 * 공유 프레젠테이션 기반 적 목록을 렌더합니다.
 * @param {object|null|undefined} sharedState - 공유 프레젠테이션 읽기 상태입니다.
 * @param {{objectOffsetY?: number, objectWH?: number}} [options={}] - 렌더 옵션입니다.
 */
export function drawGameSceneSharedEnemySnapshots(sharedState, options = {}) {
    if (!sharedState) {
        return;
    }

    const offsetY = normalizeSnapshotNumber(options?.objectOffsetY, 0);
    const fallbackFill = normalizeOpaqueBenchmarkEnemyFill(getBenchmarkEnemyFill());
    const baseHeight = normalizeSnapshotNumber(options?.objectWH, 0) * ENEMY_DRAW_HEIGHT_RATIO;
    const enemyStride = GAME_SCENE_SHARED_PRESENTATION_STRIDE.ENEMY;
    const enemyStaticStride = GAME_SCENE_SHARED_PRESENTATION_STRIDE.ENEMY_STATIC;
    const enemyData = sharedState.enemyData;
    const enemyStaticData = sharedState.enemyStaticData;
    const enemyBase = sharedState.enemyBase;
    const enemyStaticBase = sharedState.enemyStaticBase;
    const shapeByCode = SHARED_ENEMY_RENDER_CONFIG.shapeByCode;
    const aspectByCode = SHARED_ENEMY_RENDER_CONFIG.aspectByCode;
    const heightScaleByCode = SHARED_ENEMY_RENDER_CONFIG.heightScaleByCode;

    measurePerformanceSection('scene.game.shared.enemy.loop', () => {
        for (let i = 0; i < sharedState.enemyCount; i++) {
            const offset = enemyBase + (i * enemyStride);
            const staticOffset = enemyStaticBase + (i * enemyStaticStride);
            const enemyTypeCode = Math.round(enemyStaticData[staticOffset + 1]);
            const enemyType = getGameSceneEnemyTypeByCode(enemyTypeCode);
            const shapeKey = shapeByCode[enemyTypeCode] || shapeByCode[0];
            const size = normalizeSnapshotNumber(enemyStaticData[staticOffset + 0], 1);
            const baseH = baseHeight * size;
            const w = baseH * (aspectByCode[enemyTypeCode] ?? 1);
            const h = baseH * (heightScaleByCode[enemyTypeCode] ?? 1);
            const renderX = enemyData[offset + 0];
            const renderY = enemyData[offset + 1] - offsetY;
            const rotation = normalizeSnapshotNumber(enemyData[offset + 2], 0);
            renderGL('object', {
                shape: shapeKey,
                x: renderX,
                y: renderY,
                w,
                h,
                fill: fallbackFill,
                alpha: 1,
                rotation
            });
            drawEnemyCollisionDebugCircles({
                enemyType,
                width: w,
                height: h,
                rotationRadians: rotation * (Math.PI / 180),
                renderX,
                renderY
            });
        }
    });
}
