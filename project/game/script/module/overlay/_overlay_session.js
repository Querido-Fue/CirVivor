import { render, renderGL } from 'display/display_system.js';
import { createOverlayEffectState } from './_overlay_effect_registry.js';

/**
 * @class OverlaySession
 * @description overlay 하나에 대응하는 surface 묶음과 blur/effect 상태를 관리합니다.
 */
export class OverlaySession {
    /**
     * @param {object} options - session 생성 옵션입니다.
     * @param {import('display/display_system.js').DisplaySystem} options.displaySystem - DisplaySystem 인스턴스입니다.
     * @param {number} options.layer - overlay 정렬 레이어입니다.
     * @param {number} options.dim - overlay dim 강도입니다.
     * @param {boolean} options.transparent - transparent 요청 여부입니다.
     * @param {boolean} options.glOverlay - WebGL overlay 요청 여부입니다.
     * @param {string} options.blurUpdateMode - blur 갱신 정책입니다.
     * @param {object} options.effects - effect 옵션 맵입니다.
     * @param {number} [options.orderSequence=0] - 동일 layer 충돌 시 내부 정렬에 사용할 시퀀스입니다.
     */
    constructor(options) {
        this.displaySystem = options.displaySystem;
        this.layer = Math.max(0, options.layer || 0);
        this.dim = Math.max(0, Math.min(1, options.dim || 0));
        this.effectiveDim = Math.max(0, Math.min(1, this.dim * 2.2));
        this.transparent = options.transparent === true;
        this.glOverlay = options.glOverlay === true;
        this.blurUpdateMode = options.blurUpdateMode;
        this.effects = options.effects || {};
        this.alpha = 1;
        this.dimAlpha = 1;
        this.contentScale = 1;
        this.contentScaleOriginXRatio = 0.5;
        this.contentScaleOriginYRatio = 0.5;
        this.blurRevision = 1;
        this.closed = false;

        const disableTransparency = options.disableTransparency === true;
        this.effectiveTransparent = this.transparent && !disableTransparency;
        this.needsEffectSurface = this.effectiveTransparent || this.glOverlay || Object.keys(this.effects).length > 0;

        this.orderSequence = Math.max(0, options.orderSequence || 0);
        const baseOrder = (this.layer * 1000) + (this.orderSequence * 10);
        this.sortOrderBase = baseOrder;
        this.dimSurface = this.effectiveDim > 0
            ? this.displaySystem.createDynamicSurface({
                type: '2d',
                order: baseOrder - 1,
                includeInComposite: true,
                compositeOpacityFactor: 0.5
            })
            : null;
        this.effectSurface = this.needsEffectSurface
            ? this.displaySystem.createDynamicSurface({
                type: 'webgl',
                order: baseOrder,
                mode: 'overlay-effect',
                includeInComposite: true
            })
            : null;
        this.uiSurface = this.displaySystem.createDynamicSurface({
            type: '2d',
            order: baseOrder + 1,
            includeInComposite: true
        });

        this.dimLayerId = this.dimSurface?.id || null;
        this.uiLayerId = this.uiSurface.id;
        this.effectLayerId = this.effectSurface?.id || null;
        const effectRegistration = this.#createEffectStates();
        this.effectStates = effectRegistration.list;
        this.effectStateMap = effectRegistration.map;
        this.#syncSurfaceOpacity();
        this.#syncContentScale();
    }

    /**
     * session alpha를 갱신합니다.
     * @param {number} alpha - 적용할 alpha입니다.
     */
    setAlpha(alpha) {
        this.alpha = Math.max(0, Math.min(1, alpha));
        this.#syncSurfaceOpacity();
    }

    /**
     * dim surface 전용 알파를 갱신합니다.
     * @param {number} alpha - 적용할 dim 알파입니다.
     */
    setDimAlpha(alpha) {
        this.dimAlpha = Math.max(0, Math.min(1, alpha));
        this.#syncSurfaceOpacity();
    }

    /**
     * overlay 콘텐츠 surface scale을 갱신합니다.
     * @param {number} scale - 적용할 콘텐츠 배율입니다.
     */
    setContentScale(scale) {
        this.contentScale = Math.max(0.01, Math.min(4, Number.isFinite(scale) ? scale : 1));
        this.#syncContentScale();
    }

    /**
     * overlay 콘텐츠 surface의 scale 원점을 갱신합니다.
     * @param {number} originXRatio - 화면 너비 대비 X 비율입니다.
     * @param {number} originYRatio - 화면 높이 대비 Y 비율입니다.
     */
    setContentScaleOrigin(originXRatio, originYRatio) {
        this.contentScaleOriginXRatio = Math.max(0, Math.min(1, Number.isFinite(originXRatio) ? originXRatio : 0.5));
        this.contentScaleOriginYRatio = Math.max(0, Math.min(1, Number.isFinite(originYRatio) ? originYRatio : 0.5));
        this.#syncContentScale();
    }

    /**
     * 현재 세션의 투명도 비활성화 상태를 즉시 갱신합니다.
     * @param {boolean} disableTransparency - 투명도 비활성화 여부입니다.
     */
    setDisableTransparency(disableTransparency) {
        this.effectiveTransparent = this.transparent && disableTransparency !== true;
        this.needsEffectSurface = this.effectiveTransparent || this.glOverlay || Object.keys(this.effects).length > 0;
        this.invalidateBlur();
    }

    /**
     * overlay 전용 dim surface를 렌더링합니다.
     */
    renderDim() {
        if (!this.dimLayerId || this.dimAlpha <= 0 || this.effectiveDim <= 0) {
            return;
        }

        render(this.dimLayerId, {
            shape: 'rect',
            x: 0,
            y: 0,
            w: this.dimSurface?.canvas?.width || 0,
            h: this.dimSurface?.canvas?.height || 0,
            fill: '#000000',
            alpha: this.effectiveDim * this.dimAlpha
        });
    }

    /**
     * blur 캐시를 무효화합니다.
     */
    invalidateBlur() {
        this.blurRevision += 1;
        if (this.effectLayerId) {
            this.displaySystem.markOverlayEffectDirty(this.effectLayerId);
        }
    }

    /**
     * 등록된 effect 상태를 업데이트합니다.
     */
    updateEffects() {
        for (const effectState of this.effectStates) {
            if (typeof effectState.update === 'function') {
                effectState.update();
            }
        }
    }

    /**
     * 특정 effect가 등록되어 있는지 반환합니다.
     * @param {string} effectName - 조회할 effect 이름입니다.
     * @returns {boolean} 등록 여부입니다.
     */
    hasEffect(effectName) {
        return this.effectStateMap.has(effectName);
    }

    /**
     * 특정 effect 상태를 반환합니다.
     * @param {string} effectName - 조회할 effect 이름입니다.
     * @returns {object|null} effect 상태입니다.
     */
    getEffectState(effectName) {
        return this.effectStateMap.get(effectName) || null;
    }

    /**
     * 특정 effect의 정규화된 옵션을 반환합니다.
     * @param {string} effectName - 조회할 effect 이름입니다.
     * @returns {object|null} 정규화된 옵션입니다.
     */
    getEffectOptions(effectName) {
        return this.effectStateMap.get(effectName)?.options || null;
    }

    /**
     * 현재 overlay 아래쪽 합성 소스를 반환합니다.
     * @returns {Array<{kind: string, canvas?: HTMLCanvasElement, opacity?: number}>} 합성 소스 목록입니다.
     */
    getCompositeSources() {
        const anchorSurfaceId = this.effectLayerId || this.uiLayerId;
        return this.displaySystem.getCompositeSourcesBeforeSurface(anchorSurfaceId);
    }

    /**
     * glass 패널을 effect surface에 렌더링합니다.
     * @param {object} options - 패널 렌더링 옵션입니다.
     */
    renderGlassPanel(options) {
        if (!this.effectLayerId) {
            return;
        }

        const effectRenderOptions = this.#resolveEffectRenderOptions();
        const mergedOptions = {
            ...effectRenderOptions,
            ...options
        };
        const includeOwnSurfaces = mergedOptions.includeOwnSurfaces === true;
        const includeOwnEffectSurface = mergedOptions.includeOwnEffectSurface === true || includeOwnSurfaces;
        const includeOwnUISurface = mergedOptions.includeOwnUISurface === true || includeOwnSurfaces;
        const forceBlurRefresh = mergedOptions.forceBlurRefresh === true || includeOwnEffectSurface || includeOwnUISurface;
        renderGL(this.effectLayerId, {
            shape: 'glassPanel',
            ...mergedOptions,
            blurUpdateMode: this.blurUpdateMode,
            blurRevision: this.blurRevision,
            forceBlurRefresh,
            sourceProvider: () => this.#buildGlassSources({
                includeOwnEffectSurface,
                includeOwnUISurface
            }),
            transformMatrix: mergedOptions.transformMatrix || this.#resolveEffectTransformMatrix()
        });
    }

    /**
     * 2D 패널을 ui surface에 렌더링합니다.
     * @param {object} options - 패널 렌더링 옵션입니다.
     */
    renderPanel(options) {
        render(this.uiLayerId, {
            ...options
        });
    }

    /**
     * session이 사용하는 surface를 반환합니다.
     * @returns {{uiLayerId: string, effectLayerId: string|null}} surface 식별자입니다.
     */
    getLayerIds() {
        return {
            dimLayerId: this.dimLayerId,
            uiLayerId: this.uiLayerId,
            effectLayerId: this.effectLayerId
        };
    }

    /**
     * session을 닫고 동적 surface를 회수합니다.
     */
    release() {
        if (this.closed) {
            return;
        }

        this.closed = true;
        if (this.dimLayerId) {
            this.displaySystem.releaseDynamicSurface(this.dimLayerId);
        }
        if (this.effectLayerId) {
            this.displaySystem.releaseDynamicSurface(this.effectLayerId);
        }
        if (this.uiLayerId) {
            this.displaySystem.releaseDynamicSurface(this.uiLayerId);
        }
    }

    /**
     * @private
     * effect 상태 목록을 생성합니다.
     * @returns {{list: object[], map: Map<string, object>}} 생성된 effect 상태 목록과 맵입니다.
     */
    #createEffectStates() {
        const result = [];
        const effectStateMap = new Map();
        for (const [effectName, effectOptions] of Object.entries(this.effects)) {
            const effectState = createOverlayEffectState(effectName, this, effectOptions);
            if (effectState) {
                result.push(effectState);
                effectStateMap.set(effectName, effectState);
            }
        }
        return {
            list: result,
            map: effectStateMap
        };
    }

    /**
     * @private
     * surface별 최종 표시 알파를 동기화합니다.
     */
    #syncSurfaceOpacity() {
        if (this.dimSurface) {
            this.dimSurface.canvas.style.opacity = '1';
        }
        this.uiSurface.canvas.style.opacity = `${this.alpha}`;
        if (this.effectSurface) {
            this.effectSurface.canvas.style.opacity = `${this.alpha}`;
        }
    }

    /**
     * @private
     * overlay 콘텐츠 surface scale을 동기화합니다.
     */
    #syncContentScale() {
        const transformValue = Math.abs(this.contentScale - 1) <= 0.0001
            ? 'none'
            : `scale(${this.contentScale})`;
        const transformOrigin = `${this.contentScaleOriginXRatio * 100}% ${this.contentScaleOriginYRatio * 100}%`;
        this.uiSurface.canvas.style.transformOrigin = transformOrigin;
        this.uiSurface.canvas.style.transform = transformValue;
        if (this.effectSurface) {
            this.effectSurface.canvas.style.transformOrigin = transformOrigin;
            this.effectSurface.canvas.style.transform = 'none';
        }
    }

    /**
     * @private
     * effect들이 제공하는 transform matrix를 찾습니다.
     * @returns {number[]|null} 사용할 transform matrix입니다.
     */
    #resolveEffectTransformMatrix() {
        for (const effectState of this.effectStates) {
            if (typeof effectState.getTransformMatrix !== 'function') {
                continue;
            }

            const transformMatrix = effectState.getTransformMatrix();
            if (transformMatrix) {
                return transformMatrix;
            }
        }

        return null;
    }

    /**
     * @private
     * effect들이 제공하는 렌더 옵션을 병합합니다.
     * @returns {object} 병합된 렌더 옵션입니다.
     */
    #resolveEffectRenderOptions() {
        const mergedOptions = {};
        for (const effectState of this.effectStates) {
            if (typeof effectState.getRenderOptions !== 'function') {
                continue;
            }

            Object.assign(mergedOptions, effectState.getRenderOptions());
        }

        return mergedOptions;
    }

    /**
     * @private
     * glass 패널이 참조할 소스 목록을 구성합니다.
     * @param {{includeOwnEffectSurface?: boolean, includeOwnUISurface?: boolean}} includeOptions - 현재 session surface 포함 옵션입니다.
     * @returns {Array<{kind: string, canvas?: HTMLCanvasElement, opacity?: number}>} 합성 소스 목록입니다.
     */
    #buildGlassSources(includeOptions = {}) {
        const sources = this.getCompositeSources();
        const includeOwnEffectSurface = includeOptions.includeOwnEffectSurface === true;
        const includeOwnUISurface = includeOptions.includeOwnUISurface === true;

        if (!includeOwnEffectSurface && !includeOwnUISurface) {
            return sources;
        }

        if (includeOwnEffectSurface && this.effectSurface?.canvas) {
            sources.push({
                kind: 'canvas',
                canvas: this.effectSurface.canvas,
                opacity: this.alpha
            });
        }

        if (includeOwnUISurface && this.uiSurface?.canvas) {
            sources.push({
                kind: 'canvas',
                canvas: this.uiSurface.canvas,
                opacity: this.alpha
            });
        }

        return sources;
    }
}
