const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/**
 * @typedef {object} SVGPathEntry
 * @property {string} d SVG path 데이터 문자열
 * @property {'nonzero'|'evenodd'} [fillRule] 채우기 규칙
 */

/**
 * @typedef {object} SVGAnimatedDrawOptions
 * @property {number} [progress=1] 0~1 범위의 드로잉 진행률
 * @property {'stroke'|'stroke-fill'} [mode='stroke'] 스트로크 전용 또는 스트로크 후 채우기 방식
 * @property {boolean} [sequential=true] 다중 경로를 전체 길이 기준으로 순차 재생할지 여부
 * @property {number} [fillStart=0.82] `stroke-fill` 모드에서 stroke가 완료되고 fill이 시작되는 진행률
 * @property {'nonzero'|'evenodd'} [fillRule='nonzero'] 기본 채우기 규칙
 */

/**
 * @typedef {object} SVGImageRecord
 * @property {HTMLImageElement} image 로드된 SVG 이미지 객체
 * @property {number} width 원본 SVG의 너비
 * @property {number} height 원본 SVG의 높이
 * @property {number} aspectRatio 원본 SVG의 종횡비
 * @property {string} cacheKey 캐시에 사용하는 정규화된 키
 * @property {string|null} objectUrl SVG 마크업 입력일 때 생성된 임시 Object URL
 */

/**
 * @typedef {object} SVGFileDrawOptions
 * @property {number} [x=0] 캔버스에 그릴 시작 x좌표
 * @property {number} [y=0] 캔버스에 그릴 시작 y좌표
 * @property {number} [width] 그릴 너비
 * @property {number} [height] 그릴 높이
 * @property {number} [alpha=1] 전역 알파 계수
 * @property {boolean} [smoothing=true] 이미지 스무딩 적용 여부
 */

/**
 * @class SVGDrawer
 * @description SVG path 문자열을 Path2D로 캐시하고, 정적 fill 및 진행률 기반 드로잉 애니메이션과 SVG 파일 렌더링을 지원합니다.
 */
export class SVGDrawer {
    #pathCache;
    #measureSvgElement;
    #measurePathElement;
    #svgImageCache;
    #svgLoadCache;

    constructor() {
        this.#pathCache = new Map();
        this.#measureSvgElement = null;
        this.#measurePathElement = null;
        this.#svgImageCache = new Map();
        this.#svgLoadCache = new Map();
    }

    /**
     * 지정된 SVG 문자열을 분석해 `Path2D` 및 길이 메타데이터를 생성하거나 기존 캐시에서 가져옵니다.
     * @param {string} d 분석할 SVG path 문자열 데이터
     * @returns {{path: Path2D, length: number}} 생성 또는 캐시된 경로 정보
     */
    #getPathRecord(d) {
        let record = this.#pathCache.get(d);
        if (!record) {
            record = {
                path: new Path2D(d),
                length: this.#measurePathLength(d)
            };
            this.#pathCache.set(d, record);
        }
        return record;
    }

    /**
     * 길이 측정용 SVG path 요소를 지연 생성합니다.
     * @returns {SVGPathElement|null} 길이 측정용 path 요소
     */
    #getMeasurePathElement() {
        if (this.#measurePathElement) return this.#measurePathElement;
        if (typeof document === 'undefined' || typeof document.createElementNS !== 'function') {
            return null;
        }

        const svgElement = document.createElementNS(SVG_NAMESPACE, 'svg');
        svgElement.setAttribute('width', '0');
        svgElement.setAttribute('height', '0');
        svgElement.setAttribute('viewBox', '0 0 0 0');
        svgElement.setAttribute('aria-hidden', 'true');
        svgElement.style.position = 'absolute';
        svgElement.style.width = '0';
        svgElement.style.height = '0';
        svgElement.style.overflow = 'hidden';
        svgElement.style.opacity = '0';
        svgElement.style.pointerEvents = 'none';

        this.#measureSvgElement = svgElement;
        this.#measurePathElement = document.createElementNS(SVG_NAMESPACE, 'path');
        this.#measureSvgElement.appendChild(this.#measurePathElement);

        const parent = document.body || document.documentElement;
        if (parent) {
            parent.appendChild(this.#measureSvgElement);
        }

        return this.#measurePathElement;
    }

    /**
     * SVG path 전체 길이를 계산합니다.
     * @param {string} d 길이를 계산할 SVG path 문자열
     * @returns {number} 측정된 전체 길이
     */
    #measurePathLength(d) {
        const pathElement = this.#getMeasurePathElement();
        if (!pathElement || typeof pathElement.getTotalLength !== 'function') {
            return 0;
        }

        try {
            pathElement.setAttribute('d', d);
            return pathElement.getTotalLength();
        } catch {
            return 0;
        }
    }

    /**
     * SVG path 입력값을 일관된 객체 형태로 정규화합니다.
     * @param {string|SVGPathEntry} entry 정규화할 입력 데이터
     * @param {'nonzero'|'evenodd'} defaultFillRule 기본 채우기 규칙
     * @returns {SVGPathEntry|null} 정규화된 경로 엔트리
     */
    #normalizeEntry(entry, defaultFillRule) {
        if (typeof entry === 'string') {
            return { d: entry, fillRule: defaultFillRule };
        }
        if (!entry || typeof entry.d !== 'string') {
            return null;
        }
        return {
            d: entry.d,
            fillRule: entry.fillRule || defaultFillRule
        };
    }

    /**
     * 0~1 범위로 진행률을 정규화합니다.
     * @param {number} value 원본 진행률 값
     * @returns {number} 보정된 진행률
     */
    #clampProgress(value) {
        if (!Number.isFinite(value)) return 0;
        return Math.max(0, Math.min(1, value));
    }

    /**
     * SVG 마크업 문자열 입력인지 판별합니다.
     * @param {string} source SVG 파일 경로, URL 또는 마크업 문자열
     * @returns {boolean} 마크업 문자열 여부
     */
    #isSvgMarkup(source) {
        return typeof source === 'string' && /^\s*<svg[\s>]/i.test(source);
    }

    /**
     * SVG 소스를 캐시용 절대 키로 정규화합니다.
     * @param {string} source SVG 파일 경로, URL 또는 마크업 문자열
     * @returns {string} 캐시 조회에 사용할 정규화된 키
     */
    #resolveSvgCacheKey(source) {
        if (typeof source !== 'string') {
            return '';
        }

        if (this.#isSvgMarkup(source)) {
            return `markup:${source}`;
        }

        try {
            if (typeof document !== 'undefined' && typeof document.baseURI === 'string') {
                return new URL(source, document.baseURI).href;
            }
        } catch {
            return source;
        }

        return source;
    }

    /**
     * SVG 소스를 `Image.src`에 넣을 수 있는 문자열로 변환합니다.
     * @param {string} source SVG 파일 경로, URL 또는 마크업 문자열
     * @returns {{imageSource: string, objectUrl: string|null}} 이미지 로더 입력값과 임시 Object URL
     */
    #resolveSvgImageSource(source) {
        if (!this.#isSvgMarkup(source)) {
            return {
                imageSource: this.#resolveSvgCacheKey(source),
                objectUrl: null
            };
        }

        if (typeof URL === 'undefined'
            || typeof URL.createObjectURL !== 'function'
            || typeof Blob === 'undefined') {
            throw new Error('[SVGDrawer] SVG 마크업을 Blob URL로 변환할 수 없습니다.');
        }

        const objectUrl = URL.createObjectURL(
            new Blob([source], { type: 'image/svg+xml;charset=utf-8' })
        );
        return {
            imageSource: objectUrl,
            objectUrl
        };
    }

    /**
     * SVG 이미지 레코드에 맞는 실제 그리기 크기를 계산합니다.
     * @param {SVGImageRecord} record 로드된 SVG 이미지 레코드
     * @param {number|undefined} width 요청 너비
     * @param {number|undefined} height 요청 높이
     * @returns {{width: number, height: number}|null} 적용 가능한 실제 크기
     */
    #resolveSvgDrawSize(record, width, height) {
        const hasWidth = Number.isFinite(width) && width > 0;
        const hasHeight = Number.isFinite(height) && height > 0;
        const aspectRatio = record.aspectRatio > 0 ? record.aspectRatio : 1;

        if (hasWidth && hasHeight) {
            return { width, height };
        }

        if (hasWidth) {
            return {
                width,
                height: width / aspectRatio
            };
        }

        if (hasHeight) {
            return {
                width: height * aspectRatio,
                height
            };
        }

        if (record.width <= 0 || record.height <= 0) {
            return null;
        }

        return {
            width: record.width,
            height: record.height
        };
    }

    /**
     * SVG 파일 렌더링용 알파 값을 0~1 범위로 정규화합니다.
     * @param {number} value 원본 알파 값
     * @returns {number} 보정된 알파 값
     */
    #clampAlpha(value) {
        if (!Number.isFinite(value)) {
            return 1;
        }
        return Math.max(0, Math.min(1, value));
    }

    /**
     * 전체 진행률을 구간별 로컬 진행률로 변환합니다.
     * @param {number} progress 전체 진행률
     * @param {number} start 구간 시작점
     * @param {number} end 구간 종료점
     * @returns {number} 구간에 대응하는 로컬 진행률
     */
    #getSegmentProgress(progress, start, end) {
        if (end <= start) {
            return progress >= end ? 1 : 0;
        }
        return this.#clampProgress((progress - start) / (end - start));
    }

    /**
     * 다중 SVG 경로의 애니메이션 세그먼트 메타데이터를 만듭니다.
     * @param {Array<SVGPathEntry>} entries 정규화된 경로 목록
     * @returns {Array<{entry: SVGPathEntry, record: {path: Path2D, length: number}, start: number, end: number}>} 세그먼트 정보 배열
     */
    #buildAnimatedSegments(entries) {
        const segments = [];
        let totalWeight = 0;

        for (const entry of entries) {
            const record = this.#getPathRecord(entry.d);
            const weight = Math.max(record.length, 1);
            totalWeight += weight;
            segments.push({ entry, record, weight, start: 0, end: 1 });
        }

        if (segments.length === 0) {
            return segments;
        }

        let passedWeight = 0;
        for (const segment of segments) {
            segment.start = passedWeight / totalWeight;
            passedWeight += segment.weight;
            segment.end = passedWeight / totalWeight;
        }

        return segments;
    }

    /**
     * 단일 SVG 경로를 진행률에 따라 스트로크로 드로잉합니다.
     * @param {CanvasRenderingContext2D} ctx 드로잉 대상 컨텍스트
     * @param {{path: Path2D, length: number}} record 캐시된 경로 정보
     * @param {number} progress 0~1 범위의 경로 진행률
     */
    #strokePathProgress(ctx, record, progress) {
        const clampedProgress = this.#clampProgress(progress);
        if (clampedProgress <= 0) return;

        if (clampedProgress >= 1 || record.length <= 0) {
            ctx.stroke(record.path);
            return;
        }

        const dashLength = Math.max(record.length, 0.0001);
        ctx.save();
        ctx.setLineDash([dashLength, dashLength]);
        ctx.lineDashOffset = dashLength * (1 - clampedProgress);
        ctx.stroke(record.path);
        ctx.restore();
    }

    /**
     * 현재 진행률에 대응하는 fill 알파 계수를 계산합니다.
     * @param {number} progress 전체 진행률
     * @param {number} fillStart fill 시작 진행률
     * @returns {number} 0~1 범위의 fill 알파 계수
     */
    #getFillAlpha(progress, fillStart) {
        const clampedStart = this.#clampProgress(fillStart);
        if (clampedStart >= 1) {
            return progress >= 1 ? 1 : 0;
        }
        return this.#getSegmentProgress(progress, clampedStart, 1);
    }

    /**
     * `stroke-fill` 모드에서 전체 진행률을 스트로크 전용 타임라인으로 압축합니다.
     * @param {number} progress 전체 진행률
     * @param {number} fillStart fill 시작 시점
     * @returns {number} 0~1 범위의 스트로크 진행률
     */
    #getStrokeProgress(progress, fillStart) {
        const clampedStart = this.#clampProgress(fillStart);
        if (clampedStart <= 0) {
            return 1;
        }
        return this.#getSegmentProgress(progress, 0, clampedStart);
    }

    /**
     * 단일 SVG Path2D 객체를 캔버스에 칠(Fill)합니다.
     * @param {CanvasRenderingContext2D} ctx 칠하기를 수행할 대상 컨텍스트
     * @param {string} d 렌더링할 SVG path 문자열
     * @param {'nonzero'|'evenodd'} [fillRule='nonzero'] 내외부 판별 채우기 방식 옵션
     */
    fillPath(ctx, d, fillRule = 'nonzero') {
        const record = this.#getPathRecord(d);
        ctx.fill(record.path, fillRule);
    }

    /**
     * 다수의 일괄 SVG 경로 진입점을 한번에 캔버스에 칠(Fill) 처리합니다.
     * @param {CanvasRenderingContext2D} ctx 칠하기 대상 컨텍스트
     * @param {Array<string|SVGPathEntry>} entries SVG 개체 또는 문자열 배열
     * @param {'nonzero'|'evenodd'} [defaultFillRule='nonzero'] 엔트리에 값이 없을 때 사용할 기본 fill 규칙
     */
    fillPaths(ctx, entries, defaultFillRule = 'nonzero') {
        for (const rawEntry of entries) {
            const entry = this.#normalizeEntry(rawEntry, defaultFillRule);
            if (!entry) continue;
            this.fillPath(ctx, entry.d, entry.fillRule);
        }
    }

    /**
     * 단일 SVG 경로에 진행률 기반 드로잉 애니메이션을 적용합니다.
     * @param {CanvasRenderingContext2D} ctx 드로잉 대상 컨텍스트
     * @param {string} d 렌더링할 SVG path 문자열
     * @param {SVGAnimatedDrawOptions} [options={}] 애니메이션 옵션
     */
    drawAnimatedPath(ctx, d, options = {}) {
        this.drawAnimatedPaths(ctx, [{ d, fillRule: options.fillRule || 'nonzero' }], options);
    }

    /**
     * 여러 SVG 경로에 진행률 기반 드로잉 애니메이션을 적용합니다.
     * @param {CanvasRenderingContext2D} ctx 드로잉 대상 컨텍스트
     * @param {Array<string|SVGPathEntry>} entries SVG 개체 또는 문자열 배열
     * @param {SVGAnimatedDrawOptions} [options={}] 애니메이션 옵션
     */
    drawAnimatedPaths(ctx, entries, options = {}) {
        const defaultFillRule = options.fillRule || 'nonzero';
        const normalizedEntries = [];

        for (const rawEntry of entries) {
            const entry = this.#normalizeEntry(rawEntry, defaultFillRule);
            if (entry) {
                normalizedEntries.push(entry);
            }
        }

        if (normalizedEntries.length === 0) {
            return;
        }

        const progress = this.#clampProgress(options.progress ?? 1);
        const mode = options.mode || 'stroke';
        const sequential = options.sequential !== false;
        const fillStart = options.fillStart ?? 0.82;
        const strokeProgress = mode === 'stroke-fill'
            ? this.#getStrokeProgress(progress, fillStart)
            : progress;
        const segments = this.#buildAnimatedSegments(normalizedEntries);

        if (sequential) {
            for (const segment of segments) {
                const segmentProgress = this.#getSegmentProgress(strokeProgress, segment.start, segment.end);
                this.#strokePathProgress(ctx, segment.record, segmentProgress);
            }
        } else {
            for (const segment of segments) {
                this.#strokePathProgress(ctx, segment.record, strokeProgress);
            }
        }

        if (mode !== 'stroke-fill') {
            return;
        }

        const fillAlpha = this.#getFillAlpha(progress, fillStart);
        if (fillAlpha <= 0) {
            return;
        }

        ctx.save();
        ctx.globalAlpha *= fillAlpha;
        this.fillPaths(ctx, normalizedEntries, defaultFillRule);
        ctx.restore();
    }

    /**
     * SVG 파일 경로, URL 또는 마크업 문자열을 이미지로 비동기 로드하고 캐시합니다.
     * @param {string} source SVG 파일 경로, URL 또는 `<svg ...>` 마크업 문자열
     * @returns {Promise<SVGImageRecord>} 로드된 SVG 이미지 레코드
     */
    async loadSvgFile(source) {
        if (typeof source !== 'string' || source.trim() === '') {
            throw new Error('[SVGDrawer] 유효한 SVG 소스 문자열이 필요합니다.');
        }

        if (typeof Image === 'undefined') {
            throw new Error('[SVGDrawer] 현재 환경에서는 Image 객체를 사용할 수 없습니다.');
        }

        const cacheKey = this.#resolveSvgCacheKey(source);
        const cachedRecord = this.#svgImageCache.get(cacheKey);
        if (cachedRecord) {
            return cachedRecord;
        }

        const pendingLoad = this.#svgLoadCache.get(cacheKey);
        if (pendingLoad) {
            return pendingLoad;
        }

        const loadPromise = new Promise((resolve, reject) => {
            let resolved = false;
            let objectUrl = null;

            try {
                const sourceRecord = this.#resolveSvgImageSource(source);
                objectUrl = sourceRecord.objectUrl;

                const image = new Image();
                image.decoding = 'async';
                image.onload = () => {
                    if (resolved) {
                        return;
                    }

                    resolved = true;
                    const width = image.naturalWidth || image.width || 0;
                    const height = image.naturalHeight || image.height || 0;
                    const record = {
                        image,
                        width,
                        height,
                        aspectRatio: width > 0 && height > 0 ? width / height : 1,
                        cacheKey,
                        objectUrl
                    };
                    this.#svgImageCache.set(cacheKey, record);
                    resolve(record);
                };
                image.onerror = () => {
                    if (objectUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
                        URL.revokeObjectURL(objectUrl);
                    }
                    reject(new Error(`[SVGDrawer] SVG 파일을 로드할 수 없습니다: ${cacheKey}`));
                };
                image.src = sourceRecord.imageSource;
            } catch (error) {
                if (objectUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
                    URL.revokeObjectURL(objectUrl);
                }
                reject(error);
            }
        });

        this.#svgLoadCache.set(cacheKey, loadPromise);

        try {
            return await loadPromise;
        } finally {
            this.#svgLoadCache.delete(cacheKey);
        }
    }

    /**
     * 캐시된 SVG 이미지 레코드를 반환합니다.
     * @param {string} source SVG 파일 경로, URL 또는 `<svg ...>` 마크업 문자열
     * @returns {SVGImageRecord|null} 캐시된 SVG 이미지 레코드
     */
    getCachedSvgFile(source) {
        return this.#svgImageCache.get(this.#resolveSvgCacheKey(source)) || null;
    }

    /**
     * 캐시된 SVG 이미지 또는 레코드를 현재 캔버스에 그립니다.
     * @param {CanvasRenderingContext2D} ctx 드로잉 대상 컨텍스트
     * @param {string|SVGImageRecord} source SVG 소스 문자열 또는 로드된 SVG 레코드
     * @param {SVGFileDrawOptions} [options={}] 위치와 크기 지정 옵션
     * @returns {boolean} 캔버스에 SVG가 그려졌는지 여부
     */
    drawLoadedSvgFile(ctx, source, options = {}) {
        const record = typeof source === 'string'
            ? this.getCachedSvgFile(source)
            : source;

        if (!record || typeof ctx?.drawImage !== 'function') {
            return false;
        }

        const x = Number.isFinite(options.x) ? options.x : 0;
        const y = Number.isFinite(options.y) ? options.y : 0;
        const drawSize = this.#resolveSvgDrawSize(record, options.width, options.height);
        if (!drawSize) {
            return false;
        }

        ctx.save();
        ctx.globalAlpha *= this.#clampAlpha(options.alpha ?? 1);
        if (typeof ctx.imageSmoothingEnabled === 'boolean') {
            ctx.imageSmoothingEnabled = options.smoothing !== false;
        }
        ctx.drawImage(record.image, x, y, drawSize.width, drawSize.height);
        ctx.restore();
        return true;
    }

    /**
     * SVG 파일 또는 마크업을 로드한 뒤 현재 캔버스에 즉시 그립니다.
     * @param {CanvasRenderingContext2D} ctx 드로잉 대상 컨텍스트
     * @param {string} source SVG 파일 경로, URL 또는 `<svg ...>` 마크업 문자열
     * @param {SVGFileDrawOptions} [options={}] 위치와 크기 지정 옵션
     * @returns {Promise<boolean>} 캔버스에 SVG가 그려졌는지 여부
     */
    async drawSvgFile(ctx, source, options = {}) {
        const record = await this.loadSvgFile(source);
        return this.drawLoadedSvgFile(ctx, record, options);
    }

    /**
     * 캐시된 SVG 이미지와 임시 Object URL을 해제합니다.
     * @param {string} source SVG 파일 경로, URL 또는 `<svg ...>` 마크업 문자열
     */
    releaseSvgFile(source) {
        const cacheKey = this.#resolveSvgCacheKey(source);
        const record = this.#svgImageCache.get(cacheKey);
        if (!record) {
            return;
        }

        if (record.objectUrl
            && typeof URL !== 'undefined'
            && typeof URL.revokeObjectURL === 'function') {
            URL.revokeObjectURL(record.objectUrl);
        }
        this.#svgImageCache.delete(cacheKey);
        this.#svgLoadCache.delete(cacheKey);
    }
}
