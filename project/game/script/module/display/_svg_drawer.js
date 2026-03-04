/**
 * @class SVGDrawer
 * @description SVG path 문자열을 Path2D로 캐시하여 캔버스 컨텍스트에 그립니다.
 */
export class SVGDrawer {
    #pathCache;

    constructor() {
        this.#pathCache = new Map();
    }

    /**
         * 지정된 SVG 문자열을 분석해 `Path2D` 객체로 생성하거나 기존 캐시에서 가져옵니다.
         * @param {string} d - 분석할 SVG path 문자열 데이터
         * @returns {Path2D} 생성 또는 캐시된 Path2D 객체
         */
    #getPath(d) {
        let path = this.#pathCache.get(d);
        if (!path) {
            path = new Path2D(d);
            this.#pathCache.set(d, path);
        }
        return path;
    }

    /**
         * 단일 SVG Path2D 객체를 캔버스에 칠(Fill)합니다.
         * @param {CanvasRenderingContext2D} ctx 칠하기를 수행할 대상 컨텍스트
         * @param {string} d 렌더링할 SVG path 문자열
         * @param {'nonzero'|'evenodd'} [fillRule='nonzero'] 내외부 판별 채우기 방식 옵션
         */
    fillPath(ctx, d, fillRule = 'nonzero') {
        const path = this.#getPath(d);
        ctx.fill(path, fillRule);
    }

    /**
         * 다수의 일괄 SVG 경로 진입점을 한번에 캔버스에 칠(Fill) 처리합니다.
         * @param {CanvasRenderingContext2D} ctx 칠하기 대상 컨텍스트
         * @param {Array<string|{d:string, fillRule?:'nonzero'|'evenodd'}>} entries SVG 개체 또는 문자열 배열
         */
    fillPaths(ctx, entries) {
        for (const entry of entries) {
            if (typeof entry === 'string') {
                this.fillPath(ctx, entry);
                continue;
            }
            if (!entry || typeof entry.d !== 'string') continue;
            this.fillPath(ctx, entry.d, entry.fillRule || 'nonzero');
        }
    }
}
