import { SVGDrawer } from './_svg_drawer.js';
import { getData } from 'data/data_handler.js';

const ENEMY_SVG_SHAPES = getData('ENEMY_SVG_SHAPES');

/**
 * @class ShapeDrawer
 * @description 기본 도형과 적 도형(내부 SVG path)을 캔버스 컨텍스트에 그립니다.
 */
export class ShapeDrawer {
    constructor() {
        this.svgDrawer = new SVGDrawer();
    }

    /**
         * 범용 도형 (적 도형 포함)을 화면에 렌더링합니다.
         * @param {CanvasRenderingContext2D} ctx 렌더링 컨텍스트
         * @param {string} shape 그릴 대상 형태의 식별 문자열
         * @param {number} ox 도형의 x좌표 시작점
         * @param {number} oy 도형의 y좌표 시작점
         * @param {number} size 도형 크기 매개변수
         */
    drawShape(ctx, shape, ox, oy, size) {
        if (shape.startsWith('enemy_')) {
            this._drawEnemyShape(ctx, shape, ox, oy, size);
            return;
        }

        const half = size / 2;
        const cx = ox + half;
        const cy = oy + half;
        const radius = size * 0.45;

        switch (shape) {
            case 'rect':
            case 'square':
                ctx.fillRect(ox, oy, size, size);
                break;
            case 'circle':
                ctx.beginPath();
                ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                ctx.fill();
                break;
            case 'triangle':
                this._drawPolygon(ctx, cx, cy, radius, 3);
                break;
            case 'pentagon':
                this._drawPolygon(ctx, cx, cy, radius, 5);
                break;
            case 'hexagon':
                this._drawPolygon(ctx, cx, cy, radius, 6);
                break;
            case 'octagon':
                this._drawPolygon(ctx, cx, cy, radius, 8);
                break;
            case 'arrow':
                this._drawArrow(ctx, cx, cy, radius);
                break;
            default:
                ctx.fillRect(ox, oy, size, size);
                break;
        }
    }

    /**
         * SVG 경로 데이터를 사용하여 적 전용 도형을 렌더링합니다.
         * @param {CanvasRenderingContext2D} ctx 렌더링 컨텍스트
         * @param {string} shape 대상 모양 형태 지시자
         * @param {number} ox 시작 x좌표
         * @param {number} oy 시작 y좌표
         * @param {number} size 그리기 기준 크기
         * @private
         */
    _drawEnemyShape(ctx, shape, ox, oy, size) {
        const entries = ENEMY_SVG_SHAPES[shape];
        if (!entries) {
            ctx.fillRect(ox, oy, size, size);
            return;
        }

        const half = size / 2;
        const drawSize = size * 0.90;

        ctx.save();
        ctx.translate(ox + half, oy + half);
        ctx.scale(drawSize, drawSize);
        this.svgDrawer.fillPaths(ctx, entries);
        ctx.restore();
    }

    /**
         * 임의의 변 개수를 가진 다각형 (삼각형, 오각형 등)을 그립니다.
         * @param {CanvasRenderingContext2D} ctx 렌더링 컨텍스트
         * @param {number} x 중심 x좌표
         * @param {number} y 중심 y좌표
         * @param {number} radius 다각형 반지름 길이
         * @param {number} sides 구성 변의 개수
         * @private
         */
    _drawPolygon(ctx, x, y, radius, sides) {
        const angleStep = (Math.PI * 2) / sides;
        const angleOffset = -Math.PI / 2;
        ctx.beginPath();
        for (let i = 0; i < sides; i++) {
            const angle = angleOffset + i * angleStep;
            const px = x + Math.cos(angle) * radius;
            const py = y + Math.sin(angle) * radius;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
    }

    /**
         * 지시용 화살표 형태를 화면에 그립니다.
         * @param {CanvasRenderingContext2D} ctx 렌더링 컨텍스트
         * @param {number} x 중심 x좌표
         * @param {number} y 중심 y좌표
         * @param {number} radius 형태 반경 크기
         * @private
         */
    _drawArrow(ctx, x, y, radius) {
        ctx.beginPath();
        ctx.moveTo(x - radius * 0.7, y + radius * 0.7);
        ctx.lineTo(x, y - radius * 0.7);
        ctx.lineTo(x + radius * 0.7, y + radius * 0.7);
        ctx.lineTo(x, y + radius * 0.3);
        ctx.closePath();
        ctx.fill();
    }
}
