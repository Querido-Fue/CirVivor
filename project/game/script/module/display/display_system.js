import { ScreenHandler } from './_screen_handler.js';
import { DrawHandler2D } from './_draw_handler_2d.js';
import { WebGLHandler } from './webgl/_webgl_handler.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { colorUtil } from 'util/color_util.js';
import { ThemeHandler, setTheme } from 'display/_theme_handler.js';
import { getSetting } from 'save/save_system.js';
import { CanvasSurfacePool } from './_surface_pool.js';
import { VignetteRenderer } from './_vignette_renderer.js';
import { ThemeTransitionController } from './_theme_transition_controller.js';
import {
    compareDisplaySurfaceDescriptors,
    createDisplaySurfaceDescriptor,
    DISPLAY_WEBGL_RENDER_MODES,
    resolveDisplayWebGLLayerName,
    usesNativeDisplay2DResolution
} from './display_surface_descriptor.js';

let displaySystemInstance = null;

/**
 * @typedef {object} DisplaySurfaceDescriptor
 * @property {string} id - surface 식별자입니다.
 * @property {'2d'|'webgl'} type - surface 타입입니다.
 * @property {'batch'|'overlay-effect'|'effect'} mode - WebGL 모드 또는 기본 모드입니다.
 * @property {HTMLCanvasElement} canvas - DOM 캔버스입니다.
 * @property {CanvasRenderingContext2D|WebGLRenderingContext|null} context - 연결된 컨텍스트입니다.
 * @property {number} order - 표시 순서입니다.
 * @property {boolean} dynamic - 동적 surface 여부입니다.
 * @property {boolean} persistent - 프레임 초기화에서 제외할 정적 surface 여부입니다.
 * @property {boolean} includeInComposite - blur 캡처 포함 여부입니다.
 * @property {number} compositeOpacityFactor - blur 캡처 시 적용할 opacity 배율입니다.
 * @property {'canvas'|'solid'|'skip'} compositeKind - backdrop 합성 방식입니다.
 * @property {number} contentRevision - 마지막 내용 변경 revision입니다.
 * @property {number} compositeStateRevision - opacity 등 합성 상태 변경 revision입니다.
 * @property {number} drawCountThisFrame - 현재 프레임 draw 호출 수입니다.
 * @property {boolean} wasNonEmptyLastFrame - 이전 프레임 내용 존재 여부입니다.
 * @property {boolean} isEmpty - 현재 surface가 투명한지 여부입니다.
 */

/**
 * @class DisplaySystem
 * @description 정적 레이어와 동적 surface를 함께 관리하는 디스플레이 시스템입니다.
 */
export class DisplaySystem {
    constructor() {
        displaySystemInstance = this;
        this.screenHandler = new ScreenHandler();
        this.drawHandler = new DrawHandler2D();
        this.webGLHandler = new WebGLHandler();
        this.themeHandler = new ThemeHandler();

        this.surfaceMap = new Map();
        this.staticSurfaceIds = [];
        this.dynamicSurfaceIds = [];
        this.dynamicSequence = 0;
        this.sortedSurfaceDescriptors = [];
        this.surfaceOrderDirty = true;
        this.contentRevisionSerial = 0;
        this.dynamic2DPool = new CanvasSurfacePool('2d');
        this.dynamicWebGLPool = new CanvasSurfacePool('webgl');
        this.vignetteRenderer = new VignetteRenderer();
        this.themeTransitionController = null;
    }

    /**
     * `themeHandler.init()` Promise가 이행된 뒤 저장 테마를 적용하고 overlay host를 조회한 다음
     * `background`, `object`, `effect`, `texteffect`, `ui`, `vignette`, `top` surface를 해당 순서로 등록합니다.
     * `ColorSchemes.Background`의 첫 조건 조회가 truthy이면 변환 인수로 다시 live 조회해 총 두 번
     * 읽으며, 변환 결과의 `r`, `g`, `b`를 차례로 숫자 변환해 255로 나눌 뿐 clamp하지 않습니다.
     * `screenHandler.init()` Promise가 이행된 뒤 그 시점의 `surfaceMap.values()` live iterator로
     * backing store를 동기화합니다. 마지막 `resize()`는 live receiver로 동기 호출하고 그 반환값은
     * 기다리지 않고 그대로 버리는 방식입니다.
     *
     * 매 호출마다 새 Promise와 초기화 순회를 만들며, 중복 실행을 막는 재진입 guard가 없습니다.
     * 실패 시 rollback하지 않으므로 이미 적용된 등록·동기화 등의 부분 상태는 유지됩니다.
     * 속성 접근·호출의 throw, 하위 Promise 거부, thenable의 첫 reject 사유와 첫 resolve/reject 콜백
     * 호출 전에 난 throw는 호출 시점의 동기 throw가 아니며, 반환 Promise가 같은 사유(identity)로
     * 거부됩니다. thenable이 resolve/reject 콜백을 처음 호출한 뒤에는 adopted 값이
     * pending이어도 추가 resolve/reject 결과와 throw를 무시합니다.
     *
     * @returns {Promise<void>} 초기화가 끝나면 `undefined`로 이행하고, 처리 중 오류가 나면 거부되는 Promise입니다.
     */
    async init() {
        await this.themeHandler.init();
        setTheme(getSetting('theme'));

        this.overlayLayerHost = document.getElementById('overlaylayerhost');

        this.#registerStaticSurface('background', 'background', 'webgl', {
            alpha: false,
            mode: DISPLAY_WEBGL_RENDER_MODES.BATCH
        });
        this.#registerStaticSurface('object', 'object', 'webgl', {
            alpha: true,
            mode: DISPLAY_WEBGL_RENDER_MODES.BATCH
        });
        this.#registerStaticSurface('effect', 'effect', 'webgl', {
            alpha: true,
            mode: DISPLAY_WEBGL_RENDER_MODES.EFFECT
        });
        this.#registerStaticSurface('texteffect', 'texteffect', '2d');
        this.#registerStaticSurface('ui', 'ui', '2d');
        this.#registerStaticSurface('vignette', 'vignette', '2d', {
            order: 50,
            includeInComposite: false,
            persistent: true
        });
        this.#registerStaticSurface('top', 'top', '2d', { includeInComposite: false });

        if (ColorSchemes.Background) {
            const rgb = colorUtil().cssToRgb(ColorSchemes.Background);
            this.webGLHandler.setBackgroundColor(rgb.r / 255, rgb.g / 255, rgb.b / 255);
        }

        await this.screenHandler.init();

        for (const descriptor of this.surfaceMap.values()) {
            this.#syncSurfaceBackingStore(descriptor);
        }

        this.resize();
    }

    /**
     * AnimationSystem 준비 뒤 런타임 테마 전환 controller를 한 번 생성합니다.
     * @returns {void}
     */
    initializeThemeTransition() {
        if (this.themeTransitionController) {
            return;
        }

        this.themeTransitionController = new ThemeTransitionController({
            render: (layer, command) => this.drawHandler.render(layer, command),
            getWidth: () => this.screenHandler.width,
            getHeight: () => this.screenHandler.height
        });
    }

    /**
     * 동적 surface를 생성합니다.
     * @param {{type: '2d'|'webgl', order: number, mode?: 'batch'|'overlay-effect'|'effect', includeInComposite?: boolean, compositeOpacityFactor?: number, compositeKind?: 'canvas'|'solid'|'skip'}} options - 생성 옵션입니다.
     * @returns {DisplaySurfaceDescriptor} 생성된 surface descriptor입니다.
     */
    createDynamicSurface(options) {
        const type = options.type === 'webgl' ? 'webgl' : '2d';
        const mode = options.mode || (type === 'webgl'
            ? DISPLAY_WEBGL_RENDER_MODES.OVERLAY_EFFECT
            : DISPLAY_WEBGL_RENDER_MODES.BATCH);
        const pool = type === 'webgl' ? this.dynamicWebGLPool : this.dynamic2DPool;
        const entry = pool.acquire();
        const surfaceId = `dynamic:${type}:${++this.dynamicSequence}`;

        entry.canvas.dataset.surfaceId = surfaceId;

        const descriptor = createDisplaySurfaceDescriptor({
            id: surfaceId,
            type,
            mode,
            canvas: entry.canvas,
            context: entry.context,
            order: options.order,
            sequence: this.dynamicSequence,
            dynamic: true,
            persistent: false,
            includeInComposite: options.includeInComposite !== false,
            compositeOpacityFactor: options.compositeOpacityFactor,
            compositeKind: options.compositeKind
        });

        this.surfaceMap.set(surfaceId, descriptor);
        this.dynamicSurfaceIds.push(surfaceId);
        this.surfaceOrderDirty = true;
        this.#advanceContentRevision(descriptor);
        this.#syncSurfaceBackingStore(descriptor);
        this.#registerDescriptor(descriptor);
        this.#syncSurfaceCoordinateTransform(descriptor);
        this.#applyCanvasStyle(descriptor);
        this.#syncDynamicHostOrder();
        return descriptor;
    }

    /**
     * 등록된 동적 surface를 handler→registry/list→DOM 순서로 분리한 뒤 타입별 풀에 반환합니다.
     * 미등록·정적 surface는 무시하며, 풀 반환 뒤 canvas/context의 소유권은 해당 풀로 이전됩니다.
     * 처리 중 오류가 나도 앞서 완료된 등록 해제·revision 변경은 되돌리지 않습니다.
     * @param {string} surfaceId - 회수할 surface 식별자입니다.
     * @returns {void}
     */
    releaseDynamicSurface(surfaceId) {
        const descriptor = this.surfaceMap.get(surfaceId);
        if (!descriptor || !descriptor.dynamic) {
            return;
        }

        this.#unregisterDescriptor(descriptor);
        this.surfaceMap.delete(surfaceId);
        const dynamicIndex = this.dynamicSurfaceIds.indexOf(surfaceId);
        if (dynamicIndex >= 0) {
            this.dynamicSurfaceIds.splice(dynamicIndex, 1);
        }
        this.surfaceOrderDirty = true;
        this.#advanceContentRevision();

        if (descriptor.canvas.parentNode === this.overlayLayerHost) {
            this.overlayLayerHost.removeChild(descriptor.canvas);
        }

        const pool = descriptor.type === 'webgl' ? this.dynamicWebGLPool : this.dynamic2DPool;
        pool.release({ canvas: descriptor.canvas, context: descriptor.context });
    }

    /**
     * surface descriptor를 반환합니다.
     * @param {string} surfaceId - 조회할 surface 식별자입니다.
     * @returns {DisplaySurfaceDescriptor|null} 조회 결과입니다.
     */
    getSurface(surfaceId) {
        return this.surfaceMap.get(surfaceId) || null;
    }

    /**
     * 현재 등록된 모든 캔버스를 순서대로 반환합니다.
     * @returns {HTMLCanvasElement[]} 캔버스 목록입니다.
     */
    getAllCanvases() {
        return this.#getSortedSurfaceDescriptors()
            .map((descriptor) => descriptor.canvas);
    }

    /**
     * 동적 캔버스 풀 사용 현황을 반환합니다.
     * @returns {{twoD: {activeCount: number, createdCount: number, availableCount: number}, webgl: {activeCount: number, createdCount: number, availableCount: number}}} 캔버스 풀 통계입니다.
     */
    getCanvasPoolStats() {
        let active2DCount = 0;
        let activeWebGLCount = 0;

        for (const descriptor of this.surfaceMap.values()) {
            if (!descriptor.dynamic) {
                continue;
            }

            if (descriptor.type === 'webgl') {
                activeWebGLCount += 1;
                continue;
            }

            active2DCount += 1;
        }

        const twoDStats = this.dynamic2DPool.getStats();
        const webGLStats = this.dynamicWebGLPool.getStats();

        return {
            twoD: {
                activeCount: active2DCount,
                createdCount: twoDStats.createdCount,
                availableCount: twoDStats.availableCount
            },
            webgl: {
                activeCount: activeWebGLCount,
                createdCount: webGLStats.createdCount,
                availableCount: webGLStats.availableCount
            }
        };
    }

    /**
     * 동적 캔버스 풀을 미리 워밍업합니다.
     * @param {number} twoDCount - 2D surface 풀 사전 생성 개수입니다.
     * @param {number} webGLCount - WebGL surface 풀 사전 생성 개수입니다.
     */
    warmupCanvasPools(twoDCount, webGLCount) {
        this.dynamic2DPool.warmUp(twoDCount);
        this.dynamicWebGLPool.warmUp(webGLCount);
    }

    /**
     * 특정 surface보다 아래에 있는 합성 소스를 반환합니다.
     * @param {string} surfaceId - 기준 surface 식별자입니다.
     * @returns {{snapshotIdentity: string, sourceRevision: number, sources: Array<{kind: string, canvas?: HTMLCanvasElement, opacity?: number, revision?: number}>}} 합성 snapshot입니다.
     */
    getCompositeSourcesBeforeSurface(surfaceId) {
        const target = this.surfaceMap.get(surfaceId);
        if (!target) {
            return DisplaySystem.EMPTY_COMPOSITE_SNAPSHOT;
        }

        const snapshot = target.compositeSnapshot;
        const sources = snapshot.sources;
        sources.length = 0;
        let sourceCount = 0;
        let snapshotChanged = false;
        for (const descriptor of this.#getSortedSurfaceDescriptors()) {
            if (!shouldIncludeDisplayCompositeSource(descriptor, target) || descriptor.isEmpty) {
                continue;
            }

            const source = updateDisplayCompositeSource(descriptor);
            if (source) {
                sources.push(source);
                const sampledContentRevision = descriptor.compositeKind === 'solid'
                    ? 0
                    : descriptor.contentRevision;
                if (snapshot.sourceDescriptors[sourceCount] !== descriptor
                    || snapshot.sourceContentRevisions[sourceCount] !== sampledContentRevision
                    || snapshot.sourceCompositeRevisions[sourceCount] !== descriptor.compositeStateRevision
                    || snapshot.sourceOpacities[sourceCount] !== source.opacity
                    || snapshot.sourceKinds[sourceCount] !== source.kind) {
                    snapshotChanged = true;
                }
                snapshot.sourceDescriptors[sourceCount] = descriptor;
                snapshot.sourceContentRevisions[sourceCount] = sampledContentRevision;
                snapshot.sourceCompositeRevisions[sourceCount] = descriptor.compositeStateRevision;
                snapshot.sourceOpacities[sourceCount] = source.opacity;
                snapshot.sourceKinds[sourceCount] = source.kind;
                sourceCount += 1;
            }
        }

        if (snapshot.sourceDescriptors.length !== sourceCount) {
            snapshotChanged = true;
            snapshot.sourceDescriptors.length = sourceCount;
            snapshot.sourceContentRevisions.length = sourceCount;
            snapshot.sourceCompositeRevisions.length = sourceCount;
            snapshot.sourceOpacities.length = sourceCount;
            snapshot.sourceKinds.length = sourceCount;
        }
        if (snapshotChanged) {
            snapshot.sourceRevision += 1;
            if (snapshot.sourceRevision >= Number.MAX_SAFE_INTEGER) {
                snapshot.sourceRevision = 1;
            }
        }
        return snapshot;
    }

    /**
     * 분석적으로 합성할 단색 surface의 현재 opacity를 갱신합니다.
     * @param {string} surfaceId - 대상 surface 식별자입니다.
     * @param {number} opacity - surface 자체의 단색 opacity입니다.
     */
    setSurfaceCompositeSolidOpacity(surfaceId, opacity) {
        const descriptor = this.surfaceMap.get(surfaceId);
        if (!descriptor || descriptor.compositeKind !== 'solid') {
            return;
        }

        const nextOpacity = Math.max(0, Math.min(1, Number.isFinite(opacity) ? opacity : 0));
        if (descriptor.compositeSolidOpacity === nextOpacity) {
            return;
        }

        descriptor.compositeSolidOpacity = nextOpacity;
        descriptor.compositeStateRevision += 1;
    }

    /**
     * CSS opacity처럼 canvas draw 외부에서 바뀐 합성 상태를 기록합니다.
     * @param {string} surfaceId - 변경된 surface 식별자입니다.
     */
    markSurfaceCompositeChanged(surfaceId) {
        const descriptor = this.surfaceMap.get(surfaceId);
        if (descriptor) {
            descriptor.compositeStateRevision += 1;
        }
    }

    /**
     * canvas draw 외부에서 실제 픽셀 내용이 바뀐 surface를 기록합니다.
     * @param {string} surfaceId - 변경된 surface 식별자입니다.
     */
    markSurfaceContentChanged(surfaceId) {
        const descriptor = this.surfaceMap.get(surfaceId);
        if (descriptor) {
            this.#advanceContentRevision(descriptor);
        }
    }

    /**
     * render()/renderGL()을 우회한 직접 canvas draw를 기록합니다.
     * 현재 프레임의 첫 draw에서만 픽셀 revision을 전진시키고 surface를 non-empty로 표시합니다.
     * @param {string} surfaceId - 직접 그린 surface 식별자입니다.
     * @returns {boolean} 등록된 surface를 기록했으면 true입니다.
     */
    markSurfaceDirectDraw(surfaceId) {
        const descriptor = this.surfaceMap.get(surfaceId);
        if (!descriptor) {
            return false;
        }

        this.#markSurfaceDrawn(descriptor);
        return true;
    }

    /**
     * 핸들러를 우회한 직접 canvas clear 결과를 기록합니다.
     * @param {string} surfaceId - 직접 초기화한 surface 식별자입니다.
     * @param {boolean} [remainsNonEmpty=false] - clear가 불투명 내용을 남기면 true입니다.
     * @returns {boolean} 등록된 surface를 기록했으면 true입니다.
     */
    markSurfaceDirectClear(surfaceId, remainsNonEmpty = false) {
        const descriptor = this.surfaceMap.get(surfaceId);
        if (!descriptor) {
            return false;
        }

        const wasNonEmpty = descriptor.isEmpty !== true;
        descriptor.drawCountThisFrame = 0;
        descriptor.isEmpty = remainsNonEmpty !== true;
        if (wasNonEmpty || remainsNonEmpty === true) {
            this.#advanceContentRevision(descriptor);
        }
        return true;
    }

    /**
     * overlay effect blur 캐시를 무효화합니다.
     * @param {string} surfaceId - 대상 effect surface 식별자입니다.
     */
    markOverlayEffectDirty(surfaceId) {
        this.webGLHandler.markDirty(surfaceId);
    }

    /**
     * 화면 크기 변경을 반영합니다.
     */
    resize() {
        const renderTargetChanged = this.screenHandler.resize();

        if (renderTargetChanged) {
            for (const descriptor of this.surfaceMap.values()) {
                this.#syncSurfaceBackingStore(descriptor);
            }
        }

        for (const descriptor of this.surfaceMap.values()) {
            this.#applyCanvasStyle(descriptor);
        }

        if (this.overlayLayerHost) {
            Object.assign(this.overlayLayerHost.style, {
                left: `${this.screenHandler.cssLeft}px`,
                top: `${this.screenHandler.cssTop}px`,
                width: `${this.screenHandler.cssWidth}px`,
                height: `${this.screenHandler.cssHeight}px`
            });
        }

        if (this.webGLHandler) {
            this.webGLHandler.resize(this.screenHandler.width, this.screenHandler.height);
        }

        if (this.vignetteRenderer) {
            this.vignetteRenderer.resize(
                this.screenHandler.width,
                this.screenHandler.height
            );
        }
    }

    /**
     * 현재 프레임의 비네팅 레이어를 렌더링합니다.
     */
    drawVignettes() {
        if (!this.vignetteRenderer) {
            return;
        }

        this.vignetteRenderer.draw(this.drawHandler);
    }

    /**
     * 활성 런타임 테마 전환을 최상단 surface에 그립니다.
     * @returns {void}
     */
    drawThemeTransition() {
        this.themeTransitionController?.draw();
    }

    /**
     * @private
     * 정적 surface를 등록합니다.
     * @param {string} surfaceId - 등록할 식별자입니다.
     * @param {string} domId - 연결할 DOM id입니다.
     * @param {'2d'|'webgl'} type - surface 타입입니다.
     * @param {{alpha?: boolean, mode?: 'batch'|'overlay-effect'|'effect', includeInComposite?: boolean, compositeOpacityFactor?: number, order?: number, persistent?: boolean}} [options] - 옵션입니다.
     */
    #registerStaticSurface(surfaceId, domId, type, options = {}) {
        const canvas = document.getElementById(domId);
        const context = type === 'webgl'
            ? canvas.getContext('webgl', { alpha: options.alpha !== false, preserveDrawingBuffer: false })
            : canvas.getContext('2d');

        const descriptor = createDisplaySurfaceDescriptor({
            id: surfaceId,
            type,
            mode: options.mode || DISPLAY_WEBGL_RENDER_MODES.BATCH,
            canvas,
            context,
            order: options.order,
            dynamic: false,
            persistent: options.persistent === true,
            includeInComposite: options.includeInComposite !== false,
            compositeOpacityFactor: options.compositeOpacityFactor
        });

        this.surfaceMap.set(surfaceId, descriptor);
        this.staticSurfaceIds.push(surfaceId);
        this.surfaceOrderDirty = true;
        this.#advanceContentRevision(descriptor);
        this.#registerDescriptor(descriptor);
    }

    /**
     * @private
     * descriptor를 각 핸들러에 등록합니다.
     * @param {DisplaySurfaceDescriptor} descriptor - 등록할 descriptor입니다.
     */
    #registerDescriptor(descriptor) {
        if (descriptor.type === '2d') {
            this.drawHandler.registerLayer(descriptor.id, descriptor.context, {
                persistent: descriptor.persistent === true,
                onDraw: () => this.#markSurfaceDrawn(descriptor),
                onFrameClear: () => this.#beginSurfaceFrame(descriptor, false)
            });
            return;
        }

        this.webGLHandler.registerLayer(descriptor.id, descriptor.context, {
            mode: descriptor.mode,
            onDraw: () => this.#markSurfaceDrawn(descriptor),
            onFrameClear: (nonEmpty) => this.#beginSurfaceFrame(descriptor, nonEmpty === true),
            onContextLost: () => this.#handleSurfaceContextLost(descriptor),
            onContextRestored: () => this.#handleSurfaceContextRestored(descriptor)
        });
    }

    /**
     * @private
     * surface의 backing store 크기를 현재 렌더/표시 해상도에 맞춥니다.
     * @param {DisplaySurfaceDescriptor} descriptor - 동기화할 surface descriptor입니다.
     */
    #syncSurfaceBackingStore(descriptor) {
        if (!descriptor?.canvas) {
            return;
        }

        const width = usesNativeDisplay2DResolution(descriptor)
            ? this.screenHandler.baseWidth
            : this.screenHandler.width;
        const height = usesNativeDisplay2DResolution(descriptor)
            ? this.screenHandler.baseHeight
            : this.screenHandler.height;
        const nextWidth = Math.max(1, width);
        const nextHeight = Math.max(1, height);
        const widthChanged = descriptor.canvas.width !== nextWidth;
        const heightChanged = descriptor.canvas.height !== nextHeight;

        if (widthChanged) {
            descriptor.canvas.width = nextWidth;
        }
        if (heightChanged) {
            descriptor.canvas.height = nextHeight;
        }
        if (descriptor.forceBackingReset && !widthChanged && !heightChanged) {
            descriptor.canvas.width = nextWidth;
        }
        descriptor.forceBackingReset = false;
        this.#syncSurfaceCoordinateTransform(descriptor);
    }

    /**
     * @private
     * 네이티브 2D surface가 기존 렌더 좌표계를 그대로 쓰도록 컨텍스트 transform을 맞춥니다.
     * @param {DisplaySurfaceDescriptor} descriptor - 동기화할 surface descriptor입니다.
     */
    #syncSurfaceCoordinateTransform(descriptor) {
        if (descriptor?.type !== '2d' || !this.drawHandler) {
            return;
        }

        const scaleX = usesNativeDisplay2DResolution(descriptor)
            ? this.screenHandler.baseWidth / Math.max(1, this.screenHandler.width)
            : 1;
        const scaleY = usesNativeDisplay2DResolution(descriptor)
            ? this.screenHandler.baseHeight / Math.max(1, this.screenHandler.height)
            : 1;
        this.drawHandler.setLayerTransform(descriptor.id, scaleX, scaleY);
    }

    /**
     * @private
     * descriptor를 각 핸들러에서 해제합니다.
     * @param {DisplaySurfaceDescriptor} descriptor - 해제할 descriptor입니다.
     */
    #unregisterDescriptor(descriptor) {
        if (descriptor.type === '2d') {
            this.drawHandler.unregisterLayer(descriptor.id);
            return;
        }

        this.webGLHandler.unregisterLayer(descriptor.id);
    }

    /**
     * @private
     * 캔버스 CSS 스타일을 현재 화면 상태에 맞춥니다.
     * @param {DisplaySurfaceDescriptor} descriptor - 스타일을 적용할 surface descriptor입니다.
     */
    #applyCanvasStyle(descriptor) {
        const canvas = descriptor.canvas;
        const left = descriptor.dynamic ? 0 : this.screenHandler.cssLeft;
        const top = descriptor.dynamic ? 0 : this.screenHandler.cssTop;

        Object.assign(canvas.style, {
            width: `${this.screenHandler.cssWidth}px`,
            height: `${this.screenHandler.cssHeight}px`,
            left: `${left}px`,
            top: `${top}px`,
            position: 'absolute'
        });
    }

    /**
     * @private
     * 동적 host 내부의 DOM 순서를 surface order와 맞춥니다.
     */
    #syncDynamicHostOrder() {
        if (!this.overlayLayerHost) {
            return;
        }

        for (const descriptor of this.#getSortedSurfaceDescriptors()) {
            if (!descriptor.dynamic) {
                continue;
            }
            descriptor.canvas.style.zIndex = `${descriptor.order}`;
            this.overlayLayerHost.appendChild(descriptor.canvas);
        }
    }

    /**
     * @private
     * 순서 기준으로 정렬된 descriptor 목록을 반환합니다.
     * @returns {DisplaySurfaceDescriptor[]} 정렬된 descriptor 목록입니다.
     */
    #getSortedSurfaceDescriptors() {
        if (!this.surfaceOrderDirty) {
            return this.sortedSurfaceDescriptors;
        }

        this.sortedSurfaceDescriptors.length = 0;
        for (const descriptor of this.surfaceMap.values()) {
            this.sortedSurfaceDescriptors.push(descriptor);
        }
        this.sortedSurfaceDescriptors.sort(compareDisplaySurfaceDescriptors);
        this.surfaceOrderDirty = false;
        return this.sortedSurfaceDescriptors;
    }

    /**
     * 프레임 clear 뒤 surface의 empty 상태를 기록합니다.
     * @param {DisplaySurfaceDescriptor} descriptor - 대상 descriptor입니다.
     * @param {boolean} remainsNonEmpty - clear 자체가 불투명 내용을 남기는지 여부입니다.
     * @private
     */
    #beginSurfaceFrame(descriptor, remainsNonEmpty) {
        const wasNonEmpty = descriptor.isEmpty !== true;
        descriptor.wasNonEmptyLastFrame = wasNonEmpty;
        descriptor.drawCountThisFrame = 0;
        descriptor.isEmpty = remainsNonEmpty !== true;

        if (wasNonEmpty !== remainsNonEmpty) {
            this.#advanceContentRevision(descriptor);
        }
    }

    /**
     * 현재 프레임의 첫 draw를 surface 내용 변경으로 기록합니다.
     * @param {DisplaySurfaceDescriptor} descriptor - 대상 descriptor입니다.
     * @private
     */
    #markSurfaceDrawn(descriptor) {
        descriptor.drawCountThisFrame += 1;
        descriptor.isEmpty = false;
        if (descriptor.drawCountThisFrame === 1) {
            this.#advanceContentRevision(descriptor);
        }
    }

    /**
     * context loss로 표시 내용이 사라진 surface 상태를 기록합니다.
     * @param {DisplaySurfaceDescriptor} descriptor - 대상 descriptor입니다.
     * @private
     */
    #handleSurfaceContextLost(descriptor) {
        descriptor.wasNonEmptyLastFrame = descriptor.isEmpty !== true;
        descriptor.drawCountThisFrame = 0;
        descriptor.isEmpty = true;
        this.#advanceContentRevision(descriptor);
    }

    /**
     * context restore 뒤 새 GPU 자원이 사용되도록 합성 revision을 갱신합니다.
     * @param {DisplaySurfaceDescriptor} descriptor - 대상 descriptor입니다.
     * @private
     */
    #handleSurfaceContextRestored(descriptor) {
        descriptor.drawCountThisFrame = 0;
        descriptor.isEmpty = true;
        this.#advanceContentRevision(descriptor);
    }

    /**
     * 전역 content serial과 선택한 surface의 픽셀 revision을 전진시킵니다.
     * @param {DisplaySurfaceDescriptor} [descriptor] - 직접 변경된 descriptor입니다.
     * @private
     */
    #advanceContentRevision(descriptor) {
        this.contentRevisionSerial += 1;
        if (this.contentRevisionSerial >= Number.MAX_SAFE_INTEGER) {
            this.contentRevisionSerial = 1;
            for (const surface of this.surfaceMap.values()) {
                surface.contentRevision = 1;
            }
        }
        if (descriptor) {
            descriptor.contentRevision = this.contentRevisionSerial;
        }
    }
}

DisplaySystem.EMPTY_COMPOSITE_SNAPSHOT = Object.freeze({
    snapshotIdentity: 'empty',
    sourceRevision: 0,
    sources: Object.freeze([])
});

/**
 * 현재 DisplaySystem 인스턴스를 반환합니다.
 * @returns {DisplaySystem|null} DisplaySystem 인스턴스입니다.
 */
export const getDisplaySystem = () => displaySystemInstance;

/**
 * 화면 너비를 반환합니다.
 * @returns {number} 내부 렌더 해상도 너비입니다.
 */
export const getWW = () => displaySystemInstance.screenHandler.width;

/**
 * 화면 높이를 반환합니다.
 * @returns {number} 내부 렌더 해상도 높이입니다.
 */
export const getWH = () => displaySystemInstance.screenHandler.height;

/**
 * 오브젝트 기준 높이를 반환합니다.
 * @returns {number} 오브젝트 기준 높이입니다.
 */
export const getObjectWH = () => displaySystemInstance.screenHandler.objectHeight;

/**
 * 오브젝트 Y 오프셋을 반환합니다.
 * @returns {number} 오브젝트 오프셋입니다.
 */
export const getObjectOffsetY = () => displaySystemInstance.screenHandler.objectOffsetY;

/**
 * UI 기준 너비를 반환합니다.
 * @returns {number} UI 기준 너비입니다.
 */
export const getUIWW = () => displaySystemInstance.screenHandler.uiWidth;

/**
 * UI 기준 X 오프셋을 반환합니다.
 * @returns {number} UI 기준 X 오프셋입니다.
 */
export const getUIOffsetX = () => displaySystemInstance.screenHandler.uiOffsetX;

/**
 * 기본 렌더 너비를 반환합니다.
 * @returns {number} 기본 렌더 너비입니다.
 */
export const getBaseWW = () => displaySystemInstance.screenHandler.baseWidth;

/**
 * 기본 렌더 높이를 반환합니다.
 * @returns {number} 기본 렌더 높이입니다.
 */
export const getBaseWH = () => displaySystemInstance.screenHandler.baseHeight;

/**
 * 화면 스케일 비율을 반환합니다.
 * @returns {number} 내부 해상도 대비 CSS 해상도 비율입니다.
 */
export const getScaleRatio = () => displaySystemInstance.screenHandler.scaleRatio;

/**
 * 캔버스 CSS X 오프셋 원시값을 반환합니다.
 * 마우스 입력처럼 X/Y 값을 스칼라로 소비하는 핫패스에서 객체 할당을 피할 때 사용합니다.
 * @returns {number} 캔버스 X 오프셋입니다.
 */
export const getCanvasOffsetX = () => displaySystemInstance.screenHandler.cssLeft;

/**
 * 캔버스 CSS Y 오프셋 원시값을 반환합니다.
 * 마우스 입력처럼 X/Y 값을 스칼라로 소비하는 핫패스에서 객체 할당을 피할 때 사용합니다.
 * @returns {number} 캔버스 Y 오프셋입니다.
 */
export const getCanvasOffsetY = () => displaySystemInstance.screenHandler.cssTop;

/**
 * 캔버스 CSS 오프셋을 반환합니다.
 * 호출할 때마다 새 일반 객체를 반환하며, 객체가 필요 없는 핫패스는 축별 accessor를 사용합니다.
 * @returns {{x: number, y: number}} 캔버스 오프셋입니다.
 */
export const getCanvasOffset = () => ({
    x: displaySystemInstance.screenHandler.cssLeft,
    y: displaySystemInstance.screenHandler.cssTop
});

/**
 * 특정 레이어에 2D 렌더 명령을 실행합니다.
 * @param {string} layerName - 대상 레이어 식별자입니다.
 * @param {object} options - 렌더링 옵션입니다.
 * @returns {void}
 */
export const render = (layerName, options) => displaySystemInstance.drawHandler.render(layerName, options);

/**
 * 특정 레이어에 WebGL 렌더 명령을 실행합니다.
 * @param {string} layerName - 대상 레이어 식별자입니다.
 * @param {object} options - 렌더링 옵션입니다.
 * @returns {void}
 */
export const renderGL = (layerName, options) => {
    const targetLayer = resolveDisplayWebGLLayerName(layerName);
    displaySystemInstance.webGLHandler.render(targetLayer, options);
};

/**
 * 동일 WebGL shape/style을 사용하는 local center 목록을 bulk batch 경로로 렌더링합니다.
 * @param {string} layerName - 대상 레이어 식별자입니다.
 * @param {object} options - 공통 shape 렌더 옵션입니다.
 * @param {Array<{x:number, y:number}>} localCenters - 원점 기준 local center 목록입니다.
 * @param {number} originX - 월드 원점 X 좌표입니다.
 * @param {number} originY - 월드 원점 Y 좌표입니다.
 * @param {number} localScale - local center 좌표 배율입니다.
 * @param {*} [cacheKey=null] - canonical immutable instance 입력에 사용할 명시적 prepared vertex 캐시 키입니다.
 * @returns {number} renderer에 전달한 instance 수입니다.
 */
export const renderGLShapeInstances = (
    layerName,
    options,
    localCenters,
    originX,
    originY,
    localScale,
    cacheKey = null
) => {
    const targetLayer = resolveDisplayWebGLLayerName(layerName);
    return displaySystemInstance.webGLHandler.renderShapeInstances(
        targetLayer,
        options,
        localCenters,
        originX,
        originY,
        localScale,
        cacheKey
    );
};

/**
 * 레이어의 지속 그림자를 켭니다.
 * @param {string} layerName - 레이어 식별자입니다.
 * @param {number} blur - 그림자 블러입니다.
 * @param {string} color - 그림자 색상입니다.
 * @returns {void}
 */
export const shadowOn = (layerName, blur, color) => displaySystemInstance.drawHandler.shadowOn(layerName, blur, color);

/**
 * 레이어의 지속 그림자를 끕니다.
 * @param {string} layerName - 레이어 식별자입니다.
 * @returns {void}
 */
export const shadowOff = (layerName) => displaySystemInstance.drawHandler.shadowOff(layerName);

/**
 * 배경 색상을 변경합니다.
 * @param {number} r - red 채널입니다.
 * @param {number} g - green 채널입니다.
 * @param {number} b - blue 채널입니다.
 * @returns {void}
 */
export const setBackgroundColor = (r, g, b) => {
    displaySystemInstance.webGLHandler.setBackgroundColor(r, g, b);
    displaySystemInstance.markSurfaceContentChanged('background');
};

/**
 * 텍스트 너비를 측정합니다.
 * @param {string} text - 측정할 문자열입니다.
 * @param {string} font - 사용할 폰트입니다.
 * @returns {number} 측정된 너비입니다.
 */
export const measureText = (text, font) => displaySystemInstance.drawHandler.measureText(text, font);

/**
 * 캔버스 요소를 반환합니다.
 * @param {string} layerName - 조회할 레이어 식별자입니다.
 * @returns {HTMLCanvasElement|null} 해당 레이어의 캔버스입니다.
 */
export const getCanvas = (layerName) => displaySystemInstance.surfaceMap.get(layerName)?.canvas || null;

/**
 * 동적 캔버스 풀 통계를 반환합니다.
 * @returns {{twoD: {activeCount: number, createdCount: number, availableCount: number}, webgl: {activeCount: number, createdCount: number, availableCount: number}}} 캔버스 풀 통계입니다.
 */
export const getCanvasPoolStats = () => displaySystemInstance
    ? displaySystemInstance.getCanvasPoolStats()
    : {
        twoD: { activeCount: 0, createdCount: 0, availableCount: 0 },
        webgl: { activeCount: 0, createdCount: 0, availableCount: 0 }
    };

/**
 * 합성 캡처 소스에 포함할 surface인지 판정합니다.
 * @param {DisplaySurfaceDescriptor} descriptor - 후보 surface descriptor입니다.
 * @param {DisplaySurfaceDescriptor} target - 기준 surface descriptor입니다.
 * @returns {boolean} 합성 소스로 포함하면 true입니다.
 */
function shouldIncludeDisplayCompositeSource(descriptor, target) {
    if (!descriptor.includeInComposite || descriptor.compositeKind === 'skip' || descriptor.id === target.id) {
        return false;
    }
    if (!descriptor.dynamic && descriptor.id === 'top') {
        return false;
    }
    if (descriptor.dynamic && descriptor.order >= target.order) {
        return false;
    }

    return !descriptor.dynamic || descriptor.order < target.order;
}

/**
 * descriptor가 보유한 합성 source 레코드를 현재 상태로 갱신합니다.
 * @param {DisplaySurfaceDescriptor} descriptor - 합성할 surface descriptor입니다.
 * @returns {{kind: string, canvas?: HTMLCanvasElement, opacity: number, revision: number}|null} 합성 소스입니다.
 */
function updateDisplayCompositeSource(descriptor) {
    const source = descriptor.compositeSource;
    if (!source || descriptor.compositeKind === 'skip') {
        return null;
    }

    source.kind = descriptor.compositeKind === 'solid' ? 'dim' : 'canvas';
    source.canvas = descriptor.compositeKind === 'solid' ? undefined : descriptor.canvas;
    source.opacity = descriptor.compositeKind === 'solid'
        ? descriptor.compositeSolidOpacity * getDisplayCompositeSourceOpacity(descriptor)
        : getDisplayCompositeSourceOpacity(descriptor);
    source.revision = descriptor.compositeKind === 'solid'
        ? descriptor.compositeStateRevision
        : descriptor.contentRevision;
    return source;
}

/**
 * 합성 캡처에 적용할 source opacity를 계산합니다.
 * @param {DisplaySurfaceDescriptor} descriptor - 합성할 surface descriptor입니다.
 * @returns {number} 합성 opacity입니다.
 */
function getDisplayCompositeSourceOpacity(descriptor) {
    const surfaceOpacity = descriptor.dynamic
        ? Number.parseFloat(descriptor.canvas.style.opacity || '1')
        : 1;
    return surfaceOpacity * descriptor.compositeOpacityFactor;
}
