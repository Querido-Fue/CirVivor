import { SVGDrawer } from './_svg_drawer.js';
import { getData } from 'data/data_handler.js';

const ENEMY_SVG_SHAPES = getData('ENEMY_SVG_SHAPES');

/** 적 SVG 도형을 구분하는 shape 접두사입니다. */
const ENEMY_SHAPE_PREFIX = 'enemy_';
/** 기본 도형이 셀 안에서 차지하는 반지름 비율입니다. */
const BASE_SHAPE_RADIUS_RATIO = 0.45;
/** 적 SVG 도형이 셀 안에서 차지하는 크기 비율입니다. */
const ENEMY_SVG_DRAW_SIZE_RATIO = 0.90;
/** 원형과 다각형 경로를 닫는 라디안 값입니다. */
const FULL_CIRCLE_RADIANS = Math.PI * 2;
/** 다각형 첫 꼭짓점을 위쪽으로 맞추는 라디안 오프셋입니다. */
const UPRIGHT_POLYGON_ANGLE_OFFSET = -Math.PI / 2;
/** 화살표 외곽 꼭짓점이 반지름에서 차지하는 비율입니다. */
const ARROW_OUTER_POINT_RATIO = 0.7;
/** 화살표 안쪽 접점이 반지름에서 차지하는 비율입니다. */
const ARROW_INNER_POINT_RATIO = 0.3;

/**
 * @typedef {object} ShapeDrawOptions
 * @property {{progress?: number, mode?: 'stroke'|'stroke-fill', sequential?: boolean, fillStart?: number, fillRule?: 'nonzero'|'evenodd'}} [svgAnimation] 적 SVG 도형에 적용할 애니메이션 옵션
 */

/**
 * @class ShapeDrawer
 * @description 기본 도형과 적 도형(내부 SVG path)을 캔버스 컨텍스트에 그립니다.
 */
export class ShapeDrawer {
    #svgDrawer;

    /**
     * 도형 아틀라스 렌더링에 사용할 SVG drawer를 준비합니다.
     */
    constructor() {
        this.#svgDrawer = new SVGDrawer();
    }

    /**
     * 범용 도형(적 도형 포함)을 화면에 렌더링합니다.
     * @param {CanvasRenderingContext2D} ctx - 렌더링 컨텍스트입니다.
     * @param {string} shape - 그릴 대상 형태의 식별 문자열입니다.
     * @param {number} ox - 도형의 x좌표 시작점입니다.
     * @param {number} oy - 도형의 y좌표 시작점입니다.
     * @param {number} size - 도형 크기 매개변수입니다.
     * @param {ShapeDrawOptions} [drawOptions={}] - 추가 렌더링 옵션입니다.
     */
    drawShape(ctx, shape, ox, oy, size, drawOptions = {}) {
        if (shape.startsWith(ENEMY_SHAPE_PREFIX)) {
            this.#drawEnemyShape(ctx, shape, ox, oy, size, drawOptions);
            return;
        }

        const half = size / 2;
        const cx = ox + half;
        const cy = oy + half;
        const radius = size * BASE_SHAPE_RADIUS_RATIO;

        switch (shape) {
            case 'rect':
            case 'square':
                ctx.fillRect(ox, oy, size, size);
                break;
            case 'circle':
                ctx.beginPath();
                ctx.arc(cx, cy, radius, 0, FULL_CIRCLE_RADIANS);
                ctx.fill();
                break;
            case 'triangle':
                this.#drawPolygon(ctx, cx, cy, radius, 3);
                break;
            case 'pentagon':
                this.#drawPolygon(ctx, cx, cy, radius, 5);
                break;
            case 'hexagon':
                this.#drawPolygon(ctx, cx, cy, radius, 6);
                break;
            case 'octagon':
                this.#drawPolygon(ctx, cx, cy, radius, 8);
                break;
            case 'arrow':
                this.#drawArrow(ctx, cx, cy, radius);
                break;
            default:
                ctx.fillRect(ox, oy, size, size);
                break;
        }
    }

    /**
     * SVG 경로 데이터를 사용하여 적 전용 도형을 렌더링합니다.
     * @param {CanvasRenderingContext2D} ctx - 렌더링 컨텍스트입니다.
     * @param {string} shape - 대상 모양 형태 지시자입니다.
     * @param {number} ox - 시작 x좌표입니다.
     * @param {number} oy - 시작 y좌표입니다.
     * @param {number} size - 그리기 기준 크기입니다.
     * @param {ShapeDrawOptions} [drawOptions={}] - 추가 렌더링 옵션입니다.
     * @private
     */
    #drawEnemyShape(ctx, shape, ox, oy, size, drawOptions = {}) {
        const entries = ENEMY_SVG_SHAPES[shape];
        if (!entries) {
            ctx.fillRect(ox, oy, size, size);
            return;
        }

        const half = size / 2;
        const drawSize = size * ENEMY_SVG_DRAW_SIZE_RATIO;
        const svgAnimation = drawOptions.svgAnimation || null;

        ctx.save();
        ctx.translate(ox + half, oy + half);
        ctx.scale(drawSize, drawSize);
        if (svgAnimation) {
            this.#svgDrawer.drawAnimatedPaths(ctx, entries, svgAnimation);
        } else {
            this.#svgDrawer.fillPaths(ctx, entries);
        }
        ctx.restore();
    }

    /**
     * 임의의 변 개수를 가진 다각형(삼각형, 오각형 등)을 그립니다.
     * @param {CanvasRenderingContext2D} ctx - 렌더링 컨텍스트입니다.
     * @param {number} x - 중심 x좌표입니다.
     * @param {number} y - 중심 y좌표입니다.
     * @param {number} radius - 다각형 반지름 길이입니다.
     * @param {number} sides - 구성 변의 개수입니다.
     * @private
     */
    #drawPolygon(ctx, x, y, radius, sides) {
        const angleStep = FULL_CIRCLE_RADIANS / sides;
        ctx.beginPath();
        for (let i = 0; i < sides; i++) {
            const angle = UPRIGHT_POLYGON_ANGLE_OFFSET + i * angleStep;
            const px = x + Math.cos(angle) * radius;
            const py = y + Math.sin(angle) * radius;
            if (i === 0) {
                ctx.moveTo(px, py);
            } else {
                ctx.lineTo(px, py);
            }
        }
        ctx.closePath();
        ctx.fill();
    }

    /**
     * 지시용 화살표 형태를 화면에 그립니다.
     * @param {CanvasRenderingContext2D} ctx - 렌더링 컨텍스트입니다.
     * @param {number} x - 중심 x좌표입니다.
     * @param {number} y - 중심 y좌표입니다.
     * @param {number} radius - 형태 반경 크기입니다.
     * @private
     */
    #drawArrow(ctx, x, y, radius) {
        const outerPoint = radius * ARROW_OUTER_POINT_RATIO;
        const innerPoint = radius * ARROW_INNER_POINT_RATIO;

        ctx.beginPath();
        ctx.moveTo(x - outerPoint, y + outerPoint);
        ctx.lineTo(x, y - outerPoint);
        ctx.lineTo(x + outerPoint, y + outerPoint);
        ctx.lineTo(x, y + innerPoint);
        ctx.closePath();
        ctx.fill();
    }
}
