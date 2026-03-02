let colorUtilInstance = null;

/**
 * @class ColorUtil
 * @description 색상 변환 및 처리를 위한 유틸리티 클래스입니다.
 * Hex 코드와 RGB 값 간의 변환 등의 기능을 제공합니다.
 */
export class ColorUtil {
    constructor() {
        colorUtilInstance = this;
    }

    /**
     * Hex 색상 코드를 RGB 객체로 변환합니다.
     * @param {string} hex - Hex 색상 코드 (예: "#FFFFFF" 또는 "FFFFFF")
     * @returns {object} {r, g, b} 형태의 객체. 변환 실패 시 {0, 0, 0} 반환.
     */
    hexToRgb(hex) {
        const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])([a-f\d])?$/i;
        hex = hex.replace(shorthandRegex, (m, r, g, b, a) => r + r + g + g + b + b + (a ? a + a : ''));
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})?$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16),
            a: result[4] ? parseInt(result[4], 16) / 255 : 1
        } : { r: 0, g: 0, b: 0, a: 1 };
    }

    /**
     * CSS 색상 문자열을 RGB 객체로 변환합니다.
     * @param {string} c - CSS 색상 문자열 (예: "#FFFFFF", "rgb(255,255,255)", "rgba(255,255,255,1)")
     * @returns {object} {r, g, b, a} 형태의 객체. 변환 실패 시 {0, 0, 0, 1} 반환.
     */
    cssToRgb(c) {
        if (typeof c !== 'string') return { r: 0, g: 0, b: 0, a: 1 };
        if (c.startsWith('#')) return this.hexToRgb(c);
        if (c.startsWith('rgba') || c.startsWith('rgb')) {
            const parts = c.match(/([\d\.]+)/g);
            if (parts) return { r: parseInt(parts[0]), g: parseInt(parts[1]), b: parseInt(parts[2]), a: parts[3] ? parseFloat(parts[3]) : 1 };
        }
        return { r: 0, g: 0, b: 0, a: 1 };
    }

    /**
     * 두 색상 사이를 보간합니다. 객체 형태의 그라디언트 정의도 지원합니다.
     * @param {string|object} c1 - 첫 번째 색상 (Hex, rgba, 또는 gradient 객체)
     * @param {string|object} c2 - 두 번째 색상 (Hex, rgba, 또는 gradient 객체)
     * @param {number} t - 보간 값 (0.0 ~ 1.0)
     * @param {object} [bounds=null] - 그라디언트를 위한 박스 영역 {x, y, w, h}
     * @returns {string|object} 보간된 색상 문자열 또는 그라디언트 객체
     */
    lerpColor(c1, c2, t, bounds = null) {
        const isC1Grad = typeof c1 === 'object' && c1 !== null;
        const isC2Grad = typeof c2 === 'object' && c2 !== null;

        if (!isC1Grad && !isC2Grad) {
            const rgb1 = this.cssToRgb(c1);
            const rgb2 = this.cssToRgb(c2);
            const r = Math.round(rgb1.r + (rgb2.r - rgb1.r) * t);
            const g = Math.round(rgb1.g + (rgb2.g - rgb1.g) * t);
            const b = Math.round(rgb1.b + (rgb2.b - rgb1.b) * t);
            const a = rgb1.a + (rgb2.a - rgb1.a) * t;
            return this.rgbToString(r, g, b, a);
        }

        const gradDef = isC2Grad ? c2 : c1;
        let baseColorStr = null;
        if (isC2Grad && !isC1Grad) baseColorStr = c1;
        else if (isC1Grad && !isC2Grad) baseColorStr = c2;

        if (gradDef.type === 'linear') {
            const stops = gradDef.stops.map(s => {
                const stopRgb = this.cssToRgb(s.color);
                const baseRgb = baseColorStr ? this.cssToRgb(baseColorStr) : { r: stopRgb.r, g: stopRgb.g, b: stopRgb.b, a: 0 };

                const r = Math.round(baseRgb.r + (stopRgb.r - baseRgb.r) * t);
                const g = Math.round(baseRgb.g + (stopRgb.g - baseRgb.g) * t);
                const b = Math.round(baseRgb.b + (stopRgb.b - baseRgb.b) * t);
                const a = baseRgb.a + (stopRgb.a - baseRgb.a) * t;

                return { offset: s.offset, color: this.rgbToString(r, g, b, a) };
            });

            return {
                type: 'linear',
                x1: bounds ? bounds.x : 0,
                y1: bounds ? bounds.y : 0,
                x2: bounds ? bounds.x + bounds.w : 0,
                y2: bounds ? bounds.y : 0,
                stops: stops
            };
        }
        return c1;
    }

    /**
     * RGB 값을 Hex 색상 코드로 변환합니다.
     * @param {number} r - Red (0-255)
     * @param {number} g - Green (0-255)
     * @param {number} b - Blue (0-255)
     * @returns {string} Hex 색상 코드 (예: "#ffffff")
     */
    rgbToHex(r, g, b) {
        return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }

    /**
     * RGB(A) 값을 CSS 색상 문자열로 변환합니다.
     * @param {number} r - Red
     * @param {number} g - Green
     * @param {number} b - Blue
     * @param {number} [a=1] - Alpha (0-1)
     * @returns {string} "rgba(r,g,b,a)" 형태의 문자열
     */
    rgbToString(r, g, b, a = 1) {
        return "rgba(" + Math.round(r) + "," + Math.round(g) + "," + Math.round(b) + "," + a + ")";
    }
}

/**
 * ColorUtil 싱글톤 인스턴스를 반환합니다.
 * @returns {ColorUtil} ColorUtil 인스턴스
 */
export function colorUtil() {
    return colorUtilInstance;
}
