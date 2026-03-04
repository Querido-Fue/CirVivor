/**
 * @class ShapeGeometryBuilder
 * @description 렌더 옵션(크기/회전/반지름)으로부터 사각형 정점 좌표를 계산합니다.
 */
export class ShapeGeometryBuilder {
    /**
         * 주어진 렌더 옵션을 바탕으로 계산된 4개의 정점(상하좌우) 좌표를 out 객체에 기록합니다.
         * @param {object} options 위치(x, y), 크기(w, h), 회전, 반지름 등이 포함된 옵션
         * @param {Float32Array|Array|object} out 계산된 x1~y4 좌표가 담길 객체 또는 배열
         * @returns {Float32Array|Array|object} 결과값이 채워진 객체
         */
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

        if (options.shape) {
            // 도형은 중심 기준
            const hw = w / 2;
            const hh = h / 2;
            const hasPrecomputedTrig =
                Number.isFinite(options.rotationCos)
                && Number.isFinite(options.rotationSin);
            const rotationDeg = Number.isFinite(options.rotation) ? options.rotation : 0;
            const hasRotation = hasPrecomputedTrig || rotationDeg !== 0;

            if (!hasRotation) {
                // 회전이 없으면 삼각함수 없이 축 정렬 박스를 바로 계산합니다.
                x1 = x - hw; y1 = y - hh;
                x2 = x + hw; y2 = y - hh;
                x3 = x + hw; y3 = y + hh;
                x4 = x - hw; y4 = y + hh;
            } else {
                const cos = hasPrecomputedTrig
                    ? options.rotationCos
                    : Math.cos(rotationDeg * Math.PI / 180);
                const sin = hasPrecomputedTrig
                    ? options.rotationSin
                    : Math.sin(rotationDeg * Math.PI / 180);

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
            }
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

    /**
         * 주어진 렌더 옵션으로 정점 좌표를 계산한 뒤 새 객체로 반환합니다.
         * @param {object} options 렌더 옵션 데이터
         * @returns {object} {x1, y1, x2, y2, x3, y3, x4, y4} 형태의 좌표 객체
         */
    static build(options) {
        return ShapeGeometryBuilder.buildInto(options, {});
    }
}
