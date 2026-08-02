import { clampFiniteNumber } from 'util/number_util.js';

/**
 * 동적 surface 캔버스에 기본 적용할 CSS 클래스입니다.
 */
const DEFAULT_DYNAMIC_CANVAS_CLASS = 'canvas dynamic-canvas';

/**
 * @class CanvasSurfacePool
 * @description 동적 캔버스 surface를 재사용하기 위한 풀입니다.
 */
export class CanvasSurfacePool {
    /**
     * @param {'2d'|'webgl'} type - surface 타입입니다.
     * @param {string} className - 생성할 캔버스에 적용할 CSS 클래스입니다.
     */
    constructor(type, className = DEFAULT_DYNAMIC_CANVAS_CLASS) {
        this.type = type;
        this.className = className;
        this.freeList = [];
        this.createdCount = 0;
    }

    /**
     * freeList의 마지막 엔트리를 가져오며, 비어 있을 때만 새 canvas/context를 만들고 생성 수를 늘립니다.
     * 획득 시 표시 스타일을 복원하고 나머지 canvas/context 상태와 엔트리 identity는 유지합니다.
     * @returns {{canvas: HTMLCanvasElement, context: CanvasRenderingContext2D|WebGLRenderingContext|null}} 획득한 엔트리입니다.
     */
    acquire() {
        const shouldCreate = this.freeList.length === 0;
        const entry = this.freeList.pop() || this.#createEntry();
        if (shouldCreate) {
            this.createdCount += 1;
        }
        entry.canvas.style.display = '';
        entry.canvas.style.visibility = '';
        return entry;
    }

    /**
     * 현재 풀 통계를 반환합니다.
     * @returns {{createdCount: number, availableCount: number}} 생성 수와 대기 수입니다.
     */
    getStats() {
        return {
            createdCount: this.createdCount,
            availableCount: this.freeList.length
        };
    }

    /**
     * 지정한 수만큼 surface 엔트리를 미리 생성해 풀에 채웁니다.
     * @param {number} count - 사전 생성할 엔트리 수입니다.
     */
    warmUp(count) {
        const targetCount = Math.floor(clampFiniteNumber(Number(count), 0, Infinity, 0));
        while (this.freeList.length < targetCount) {
            this.freeList.push(this.#createEntry());
            this.createdCount += 1;
        }
    }

    /**
     * 표시 관련 style·surface id를 초기화한 뒤 동일 엔트리를 freeList에 반환합니다.
     * DOM 분리·handler 해제·pixel/context clear는 수행하지 않으므로 호출자가 먼저 소유 관계를 정리해야 합니다.
     * @param {{canvas: HTMLCanvasElement, context: CanvasRenderingContext2D|WebGLRenderingContext|null}|null|undefined} entry - 반환할 엔트리입니다.
     * @returns {void}
     */
    release(entry) {
        if (!entry || !entry.canvas) {
            return;
        }

        this.#resetEntry(entry);
        this.freeList.push(entry);
    }

    /**
     * @private
     * 새 캔버스 엔트리를 생성합니다.
     * @returns {{canvas: HTMLCanvasElement, context: CanvasRenderingContext2D|WebGLRenderingContext|null}}
     */
    #createEntry() {
        const canvas = document.createElement('canvas');
        canvas.className = this.className;
        canvas.style.pointerEvents = 'none';

        if (this.type === 'webgl') {
            const gl = canvas.getContext('webgl', { alpha: true, preserveDrawingBuffer: false });
            return { canvas, context: gl };
        }

        return { canvas, context: canvas.getContext('2d') };
    }

    /**
     * @private
     * 캔버스를 재사용 가능한 상태로 되돌립니다.
     * @param {{canvas: HTMLCanvasElement, context: CanvasRenderingContext2D|WebGLRenderingContext|null}} entry - 초기화할 엔트리입니다.
     */
    #resetEntry(entry) {
        const { canvas } = entry;
        canvas.style.display = 'none';
        canvas.style.visibility = '';
        canvas.style.opacity = '1';
        canvas.style.transform = 'none';
        canvas.style.transformOrigin = '';
        canvas.style.filter = 'none';
        canvas.style.zIndex = '';
        canvas.dataset.surfaceId = '';
    }
}
