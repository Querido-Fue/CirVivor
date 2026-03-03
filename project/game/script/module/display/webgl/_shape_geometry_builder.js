/**
 * @class ShapeGeometryBuilder
 * @description 렌더 옵션(크기/회전/반지름)으로부터 사각형 정점 좌표를 계산합니다.
 */
export class ShapeGeometryBuilder {
    static buildInto(options, out) {
        let x1, y1, x2, y2, x3, y3, x4, y4;

        const x = options.x;
        const y = options.y;
        let w = options.w;
        let h = options.h;

        if (w === undefined && options.radius !== undefined) {
            w = options.radius * 2;
            h = options.radius * 2;
        }
        h = h || w; // h가 없으면 w와 동일

        const rotation = options.rotation ? options.rotation * Math.PI / 180 : 0;

        if (options.shape) {
            // 도형은 중심 기준
            const hw = w / 2;
            const hh = h / 2;

            const cos = Math.cos(rotation);
            const sin = Math.sin(rotation);

            // 로컬 좌표
            const rx1 = -hw * cos - (-hh) * sin;
            const ry1 = -hw * sin + (-hh) * cos;

            const rx2 = hw * cos - (-hh) * sin;
            const ry2 = hw * sin + (-hh) * cos;

            const rx3 = hw * cos - hh * sin;
            const ry3 = hw * sin + hh * cos;

            const rx4 = -hw * cos - hh * sin;
            const ry4 = -hw * sin + hh * cos;

            x1 = x + rx1; y1 = y + ry1; // 좌상단
            x2 = x + rx2; y2 = y + ry2; // 우상단
            x3 = x + rx3; y3 = y + ry3; // 우하단
            x4 = x + rx4; y4 = y + ry4; // 좌하단
        } else {
            // 이미지는 좌상단 기준
            x1 = x; y1 = y;
            x2 = x + w; y2 = y;
            x3 = x + w; y3 = y + h;
            x4 = x; y4 = y + h;
        }

        if (Array.isArray(out) || ArrayBuffer.isView(out)) {
            out[0] = x1; out[1] = y1;
            out[2] = x2; out[3] = y2;
            out[4] = x3; out[5] = y3;
            out[6] = x4; out[7] = y4;
            return out;
        }

        out.x1 = x1; out.y1 = y1;
        out.x2 = x2; out.y2 = y2;
        out.x3 = x3; out.y3 = y3;
        out.x4 = x4; out.y4 = y4;
        return out;
    }

    static build(options) {
        return ShapeGeometryBuilder.buildInto(options, {});
    }
}
