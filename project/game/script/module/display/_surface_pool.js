/**
 * @class CanvasSurfacePool
 * @description 동적 캔버스 surface를 재사용하기 위한 풀입니다.
 */
export class CanvasSurfacePool {
    /**
     * @param {'2d'|'webgl'} type - surface 타입입니다.
     * @param {string} className - 생성할 캔버스에 적용할 CSS 클래스입니다.
     */
    constructor(type, className = 'canvas dynamic-canvas') {
        this.type = type;
        this.className = className;
        this.freeList = [];
        this.createdCount = 0;
    }

    /**
     * 풀에서 캔버스를 하나 가져오거나 새로 생성합니다.
     * @returns {{canvas: HTMLCanvasElement, context: CanvasRenderingContext2D|WebGLRenderingContext|null}}
     */
    acquire() {
        const shouldCreate = this.freeList.length === 0;
        const entry = this.freeList.pop() || this.#createEntry();
        if (shouldCreate) {
            this.createdCount += 1;
        }
        entry.canvas.style.display = '';
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
        const targetCount = Math.max(0, Math.floor(count));
        while (this.freeList.length < targetCount) {
            this.freeList.push(this.#createEntry());
            this.createdCount += 1;
        }
    }

    /**
     * 사용이 끝난 캔버스를 풀로 반환합니다.
     * @param {{canvas: HTMLCanvasElement, context: CanvasRenderingContext2D|WebGLRenderingContext|null}} entry - 반환할 엔트리입니다.
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
        const { canvas, context } = entry;
        canvas.width = canvas.width;
        canvas.height = canvas.height;
        canvas.style.display = 'none';
        canvas.style.opacity = '1';
        canvas.style.transform = 'none';
        canvas.style.zIndex = '';
        canvas.dataset.surfaceId = '';

        if (!context) {
            return;
        }

        if (this.type === '2d') {
            context.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }

        context.viewport(0, 0, canvas.width, canvas.height);
        context.clearColor(0, 0, 0, 0);
        context.clear(context.COLOR_BUFFER_BIT);
    }
}
