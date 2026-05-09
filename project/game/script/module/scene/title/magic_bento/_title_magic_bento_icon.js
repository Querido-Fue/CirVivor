import { formatRgba } from 'util/color_util.js';
import { clampFiniteNumber } from 'util/number_util.js';
import { EQUILATERAL_TRIANGLE_WIDTH_RATIO } from './_title_magic_bento_motion.js';

/**
 * 카드 아이콘을 그립니다.
 * @param {CanvasRenderingContext2D} ctx - UI 컨텍스트
 * @param {string} iconType - 아이콘 타입
 * @param {number} x - X 좌표
 * @param {number} y - Y 좌표
 * @param {number} size - 아이콘 크기
 * @param {string} color - 아이콘 색상
 */
export function drawBentoCardIcon(ctx, iconType, x, y, size, color) {
    switch (iconType) {
        case 'play':
            drawPlayIcon(ctx, x, y, size, color, false);
            break;
        case 'fast-forward':
            drawPlayIcon(ctx, x, y, size, color, true);
            break;
        case 'list':
            drawListIcon(ctx, x, y, size, color);
            break;
        case 'deck':
            drawDeckIcon(ctx, x, y, size, color);
            break;
        case 'flask':
            drawFlaskIcon(ctx, x, y, size, color);
            break;
    }
}

/**
 * 플레이/빨리감기 아이콘을 그립니다.
 * @param {CanvasRenderingContext2D} ctx - UI 컨텍스트
 * @param {number} x - X 좌표
 * @param {number} y - Y 좌표
 * @param {number} size - 아이콘 크기
 * @param {string} color - 아이콘 색상
 * @param {boolean} doubled - 빨리감기 여부
 */
function drawPlayIcon(ctx, x, y, size, color, doubled) {
    const sideLength = doubled ? size * 0.66 : size * 0.92;
    const triangleWidth = sideLength * EQUILATERAL_TRIANGLE_WIDTH_RATIO;
    const overlap = doubled ? sideLength * 0.08 : 0;
    const totalWidth = doubled ? ((triangleWidth * 2) - overlap) : triangleWidth;
    const startX = x + ((size - totalWidth) * 0.5);
    const startY = y + ((size - sideLength) * 0.5);

    ctx.save();
    ctx.fillStyle = color;
    if (doubled) {
        ctx.save();
        ctx.globalAlpha = 0.34;
        ctx.shadowBlur = sideLength * 0.18;
        ctx.shadowColor = formatRgba(255, 255, 255, 0.2);
        fillTriangle(ctx, startX + (sideLength * 0.1), startY + (sideLength * 0.08), sideLength);
        fillTriangle(ctx, startX + triangleWidth - overlap + (sideLength * 0.1), startY + (sideLength * 0.08), sideLength);
        ctx.restore();
    }

    fillTriangle(ctx, startX, startY, sideLength);
    if (doubled) {
        fillTriangle(ctx, startX + triangleWidth - overlap, startY, sideLength);
    }
    ctx.restore();
}

/**
 * 리스트 아이콘을 그립니다.
 * @param {CanvasRenderingContext2D} ctx - UI 컨텍스트
 * @param {number} x - X 좌표
 * @param {number} y - Y 좌표
 * @param {number} size - 아이콘 크기
 * @param {string} color - 아이콘 색상
 */
function drawListIcon(ctx, x, y, size, color) {
    const lineWidth = clampFiniteNumber(size * 0.08, 1.5, Infinity, 1.5);
    const shortLine = size * 0.18;
    const longLine = size * 0.52;
    const spacing = size * 0.2;
    const startY = y + (size * 0.26);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';

    for (let index = 0; index < 3; index++) {
        const lineY = startY + (spacing * index);
        ctx.beginPath();
        ctx.moveTo(x, lineY);
        ctx.lineTo(x + shortLine, lineY);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(x + shortLine + (size * 0.14), lineY);
        ctx.lineTo(x + shortLine + (size * 0.14) + longLine, lineY);
        ctx.stroke();
    }

    ctx.restore();
}

/**
 * 카드 묶음(덱) 아이콘을 그립니다.
 * @param {CanvasRenderingContext2D} ctx - UI 컨텍스트
 * @param {number} x - X 좌표
 * @param {number} y - Y 좌표
 * @param {number} size - 아이콘 크기
 * @param {string} color - 아이콘 색상
 */
function drawDeckIcon(ctx, x, y, size, color) {
    const radius = size * 0.11;
    const width = size * 0.58;
    const height = size * 0.72;
    const offset = size * 0.15;

    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.72;
    ctx.beginPath();
    ctx.roundRect(x + offset, y, width, height, radius);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.roundRect(x, y + offset, width, height, radius);
    ctx.fill();
    ctx.restore();
}

/**
 * 플라스크 아이콘을 그립니다.
 * @param {CanvasRenderingContext2D} ctx - UI 컨텍스트
 * @param {number} x - X 좌표
 * @param {number} y - Y 좌표
 * @param {number} size - 아이콘 크기
 * @param {string} color - 아이콘 색상
 */
function drawFlaskIcon(ctx, x, y, size, color) {
    const stemWidth = size * 0.16;
    const neckHeight = size * 0.22;
    const bodyWidth = size * 0.56;
    const bodyHeight = size * 0.48;
    const centerX = x + (size * 0.5);
    const stemLeft = centerX - (stemWidth * 0.5);
    const stemRight = centerX + (stemWidth * 0.5);
    const bodyTop = y + neckHeight + (size * 0.08);
    const bodyBottom = bodyTop + bodyHeight;
    const bodyLeft = centerX - (bodyWidth * 0.5);
    const bodyRight = centerX + (bodyWidth * 0.5);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = clampFiniteNumber(size * 0.07, 1.5, Infinity, 1.5);
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(stemLeft, y);
    ctx.lineTo(stemRight, y);
    ctx.moveTo(centerX, y);
    ctx.lineTo(centerX, y + neckHeight);
    ctx.moveTo(stemLeft, y + neckHeight);
    ctx.lineTo(bodyLeft, bodyTop);
    ctx.lineTo(bodyLeft + (bodyWidth * 0.1), bodyBottom);
    ctx.lineTo(bodyRight - (bodyWidth * 0.1), bodyBottom);
    ctx.lineTo(bodyRight, bodyTop);
    ctx.lineTo(stemRight, y + neckHeight);
    ctx.stroke();

    ctx.globalAlpha = 0.3;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(bodyLeft + (bodyWidth * 0.16), bodyBottom - (bodyHeight * 0.28));
    ctx.lineTo(bodyRight - (bodyWidth * 0.16), bodyBottom - (bodyHeight * 0.28));
    ctx.lineTo(bodyRight - (bodyWidth * 0.1), bodyBottom);
    ctx.lineTo(bodyLeft + (bodyWidth * 0.1), bodyBottom);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

/**
 * 삼각형 경로를 채웁니다.
 * @param {CanvasRenderingContext2D} ctx - UI 컨텍스트
 * @param {number} x - 왼쪽 X 좌표
 * @param {number} y - 위쪽 Y 좌표
 * @param {number} sideLength - 정삼각형 한 변 길이
 */
function fillTriangle(ctx, x, y, sideLength) {
    const width = sideLength * EQUILATERAL_TRIANGLE_WIDTH_RATIO;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + width, y + (sideLength * 0.5));
    ctx.lineTo(x, y + sideLength);
    ctx.closePath();
    ctx.fill();
}
