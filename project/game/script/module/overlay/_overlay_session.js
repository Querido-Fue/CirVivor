import { render, renderGL } from 'display/display_system.js';
import { resolveOverlayContentSurfaceStyles } from 'display/webgl/_overlay_render_geometry.js';
import { clampFiniteNumber, clampNumber } from 'util/number_util.js';
import { createOverlayEffectState } from './_overlay_effect_registry.js';

/**
 * @class OverlaySession
 * @description overlay 하나에 대응하는 surface 묶음과 blur/effect 상태를 관리합니다.
 */
export class OverlaySession {
    #dimRenderCommand;

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
        this.dim = clampFiniteNumber(options.dim, 0, 1, 0);
        this.effectiveDim = clampNumber(this.dim * 2.2, 0, 1);
        this.transparent = options.transparent === true;
        this.glOverlay = options.glOverlay === true;
        this.blurUpdateMode = options.blurUpdateMode;
        this.effects = options.effects || {};
        this.alpha = 1;
        this.dimAlpha = 1;
        this.contentScale = 1;
        this.contentBlur = 0;
        this.contentScaleOriginXRatio = 0.5;
        this.contentScaleOriginYRatio = 0.5;
        this.contentSurfaceStylesScratch = {
            transformOrigin: '',
            uiTransform: 'none',
            effectTransform: 'none',
            uiFilter: 'none',
            effectFilter: 'none'
        };
        this.appliedContentScale = Number.NaN;
        this.appliedContentBlur = Number.NaN;
        this.appliedContentScaleOriginXRatio = Number.NaN;
        this.appliedContentScaleOriginYRatio = Number.NaN;
        this.blurRevision = 1;
        this.closed = false;
        this.hasRegisteredEffects = Object.keys(this.effects).length > 0;

        const disableTransparency = options.disableTransparency === true;
        this.effectiveTransparent = this.transparent && !disableTransparency;
        this.needsEffectSurface = this.effectiveTransparent || this.glOverlay || this.hasRegisteredEffects;

        this.orderSequence = Math.max(0, options.orderSequence || 0);
        const baseOrder = (this.layer * 1000) + (this.orderSequence * 10);
        this.sortOrderBase = baseOrder;
        this.dimSurface = this.effectiveDim > 0
            ? this.displaySystem.createDynamicSurface({
                type: '2d',
                order: baseOrder - 1,
                includeInComposite: true,
                compositeOpacityFactor: 0.5,
                compositeKind: 'solid'
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
        this.#dimRenderCommand = {
            shape: 'rect',
            x: 0,
            y: 0,
            w: 0,
            h: 0,
            fill: '#000000',
            alpha: 0
        };
        this.glassRenderCommand = { shape: 'glassPanel' };
        this.glassRenderCommandKeys = [];
        this.includeOwnEffectSurface = false;
        this.includeOwnUISurface = false;
        this.glassSourceProvider = () => this.#buildGlassSources();
        this.glassSourceSnapshot = {
            snapshotIdentity: `overlay-session:${this.orderSequence}:custom:0`,
            sourceRevision: 0,
            sources: []
        };
        this.glassSnapshotIdentities = [
            `overlay-session:${this.orderSequence}:custom:0`,
            `overlay-session:${this.orderSequence}:custom:1`,
            `overlay-session:${this.orderSequence}:custom:2`,
            `overlay-session:${this.orderSequence}:custom:3`
        ];
        this.ownEffectCompositeSource = { kind: 'canvas', canvas: null, opacity: 1, revision: 0 };
        this.ownUICompositeSource = { kind: 'canvas', canvas: null, opacity: 1, revision: 0 };
        const effectRegistration = this.#createEffectStates();
        this.effectStates = effectRegistration.list;
        this.effectStateMap = effectRegistration.map;
        this.#syncSurfaceOpacity();
        this.#syncContentPresentation();
    }

    /**
     * session alpha를 갱신합니다.
     * @param {number} alpha - 적용할 alpha입니다.
     */
    setAlpha(alpha) {
        this.alpha = clampNumber(alpha, 0, 1);
        this.#syncSurfaceOpacity();
    }

    /**
     * dim surface 전용 알파를 갱신합니다.
     * @param {number} alpha - 적용할 dim 알파입니다.
     */
    setDimAlpha(alpha) {
        this.dimAlpha = clampNumber(alpha, 0, 1);
        this.#syncSurfaceOpacity();
    }

    /**
     * overlay 콘텐츠 surface scale을 갱신합니다.
     * @param {number} scale - 적용할 콘텐츠 배율입니다.
     */
    setContentScale(scale) {
        this.contentScale = clampFiniteNumber(scale, 0.01, 4, 1);
        this.#syncContentPresentation();
    }

    /**
     * overlay 콘텐츠 surface의 CSS blur를 갱신합니다.
     * @param {number} blur - 적용할 blur 반경(px)입니다.
     */
    setContentBlur(blur) {
        this.contentBlur = clampFiniteNumber(blur, 0, 100, 0);
        this.#syncContentPresentation();
    }

    /**
     * overlay 콘텐츠 surface의 scale 원점을 갱신합니다.
     * @param {number} originXRatio - 화면 너비 대비 X 비율입니다.
     * @param {number} originYRatio - 화면 높이 대비 Y 비율입니다.
     */
    setContentScaleOrigin(originXRatio, originYRatio) {
        this.contentScaleOriginXRatio = clampFiniteNumber(originXRatio, 0, 1, 0.5);
        this.contentScaleOriginYRatio = clampFiniteNumber(originYRatio, 0, 1, 0.5);
        this.#syncContentPresentation();
    }

    /**
     * 현재 세션의 투명도 비활성화 상태를 즉시 갱신합니다.
     * @param {boolean} disableTransparency - 투명도 비활성화 여부입니다.
     */
    setDisableTransparency(disableTransparency) {
        this.effectiveTransparent = this.transparent && disableTransparency !== true;
        this.needsEffectSurface = this.effectiveTransparent || this.glOverlay || this.hasRegisteredEffects;
        this.#syncEffectSurfaceAvailability();
        this.invalidateBlur();
    }

    /**
     * 현재 프레임의 glass 패널이 하위 WebGL 결과를 샘플링할지 반환합니다.
     * @returns {boolean} 중간 flush가 필요한 경우 true입니다.
     */
    requiresBackdropComposite() {
        return Boolean(this.effectLayerId) && this.effectiveTransparent && this.alpha > 0;
    }

    /**
     * overlay 전용 dim surface를 렌더링합니다.
     */
    renderDim() {
        if (!this.dimLayerId || this.dimAlpha <= 0 || this.effectiveDim <= 0) {
            return;
        }

        this.displaySystem.setSurfaceCompositeSolidOpacity(
            this.dimLayerId,
            this.effectiveDim * this.dimAlpha
        );

        const dimLayerId = this.dimLayerId;
        const command = this.#dimRenderCommand;
        command.shape = 'rect';
        command.x = 0;
        command.y = 0;
        command.w = this.dimSurface?.canvas?.width || 0;
        command.h = this.dimSurface?.canvas?.height || 0;
        command.fill = '#000000';
        command.alpha = this.effectiveDim * this.dimAlpha;
        render(dimLayerId, command);
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
     * @returns {{snapshotIdentity: string, sourceRevision: number, sources: Array<{kind: string, canvas?: HTMLCanvasElement, opacity?: number, revision?: number}>}} 합성 snapshot입니다.
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

        const command = this.glassRenderCommand;
        this.#resetGlassRenderCommand();
        this.#resolveEffectRenderOptions(command);
        this.#copyGlassRenderOptions(command, options);

        const includeOwnSurfaces = command.includeOwnSurfaces === true;
        this.includeOwnEffectSurface = command.includeOwnEffectSurface === true || includeOwnSurfaces;
        this.includeOwnUISurface = command.includeOwnUISurface === true || includeOwnSurfaces;
        command.shape = 'glassPanel';
        command.blurUpdateMode = this.blurUpdateMode;
        command.blurRevision = this.blurRevision;
        command.forceBlurRefresh = command.forceBlurRefresh === true
            || this.includeOwnEffectSurface
            || this.includeOwnUISurface;
        command.sourceProvider = this.glassSourceProvider;
        this.#applyEffectTransform(command);
        command.sampleBackdrop = command.sampleBackdrop === undefined
            ? this.effectiveTransparent
            : command.sampleBackdrop;
        renderGL(this.effectLayerId, command);
    }

    /**
     * 2D 패널을 ui surface에 렌더링합니다.
     * @param {object} options - 패널 렌더링 옵션입니다.
     */
    renderPanel(options) {
        render(this.uiLayerId, options);
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
            this.#setSurfaceOpacity(this.dimSurface, 1);
        }
        this.#setSurfaceOpacity(this.uiSurface, this.alpha);
        if (this.effectSurface) {
            this.#setSurfaceOpacity(this.effectSurface, this.alpha);
        }
    }

    /**
     * surface CSS opacity를 실제 변경 시에만 반영하고 합성 revision을 갱신합니다.
     * @param {object} surface - 대상 display surface입니다.
     * @param {number} opacity - 적용할 opacity입니다.
     * @private
     */
    #setSurfaceOpacity(surface, opacity) {
        if (!surface?.canvas) {
            return;
        }

        if (surface.appliedCompositeOpacity === opacity) {
            return;
        }
        surface.appliedCompositeOpacity = opacity;
        const nextOpacity = `${opacity}`;
        surface.canvas.style.opacity = nextOpacity;
        this.displaySystem.markSurfaceCompositeChanged(surface.id);
    }

    /**
     * @private
     * overlay 콘텐츠 surface의 scale과 blur를 동기화합니다.
     */
    #syncContentPresentation() {
        if (this.appliedContentScale === this.contentScale
            && this.appliedContentBlur === this.contentBlur
            && this.appliedContentScaleOriginXRatio === this.contentScaleOriginXRatio
            && this.appliedContentScaleOriginYRatio === this.contentScaleOriginYRatio) {
            return;
        }

        this.appliedContentScale = this.contentScale;
        this.appliedContentBlur = this.contentBlur;
        this.appliedContentScaleOriginXRatio = this.contentScaleOriginXRatio;
        this.appliedContentScaleOriginYRatio = this.contentScaleOriginYRatio;

        const surfaceStyles = resolveOverlayContentSurfaceStyles(
            this.contentScale,
            this.contentScaleOriginXRatio,
            this.contentScaleOriginYRatio,
            this.contentBlur,
            this.contentSurfaceStylesScratch
        );
        this.uiSurface.canvas.style.transformOrigin = surfaceStyles.transformOrigin;
        this.uiSurface.canvas.style.transform = surfaceStyles.uiTransform;
        this.uiSurface.canvas.style.filter = surfaceStyles.uiFilter;
        if (this.effectSurface) {
            this.effectSurface.canvas.style.transformOrigin = surfaceStyles.transformOrigin;
            this.effectSurface.canvas.style.transform = surfaceStyles.effectTransform;
            this.effectSurface.canvas.style.filter = surfaceStyles.effectFilter;
        }
    }

    /**
     * 런타임 transparency 설정에 맞춰 effect surface를 생성하거나 회수합니다.
     * @private
     */
    #syncEffectSurfaceAvailability() {
        if (this.needsEffectSurface && !this.effectSurface) {
            this.effectSurface = this.displaySystem.createDynamicSurface({
                type: 'webgl',
                order: this.sortOrderBase,
                mode: 'overlay-effect',
                includeInComposite: true
            });
            this.effectLayerId = this.effectSurface.id;
            this.#syncSurfaceOpacity();
            this.appliedContentScale = Number.NaN;
            this.appliedContentBlur = Number.NaN;
            this.#syncContentPresentation();
            return;
        }

        if (!this.needsEffectSurface && this.effectSurface) {
            this.displaySystem.releaseDynamicSurface(this.effectSurface.id);
            this.effectSurface = null;
            this.effectLayerId = null;
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
     * command 또는 등록 effect가 제공하는 WebGL 변환을 적용합니다.
     * @param {object} command - 현재 glass 렌더 명령입니다.
     * @private
     */
    #applyEffectTransform(command) {
        command.transformMatrix = command.transformMatrix || this.#resolveEffectTransformMatrix();
    }

    /**
     * effect들이 제공하는 렌더 옵션을 재사용 명령에 병합합니다.
     * @param {object} target - 옵션을 기록할 명령입니다.
     * @private
     */
    #resolveEffectRenderOptions(target) {
        for (const effectState of this.effectStates) {
            if (typeof effectState.getRenderOptions !== 'function') {
                continue;
            }

            this.#copyGlassRenderOptions(target, effectState.getRenderOptions());
        }
    }

    /**
     * 이전 glass 명령의 동적 필드를 비웁니다.
     * @private
     */
    #resetGlassRenderCommand() {
        const command = this.glassRenderCommand;
        for (let index = 0; index < this.glassRenderCommandKeys.length; index++) {
            command[this.glassRenderCommandKeys[index]] = undefined;
        }
        this.glassRenderCommandKeys.length = 0;
        command.forceBlurRefresh = undefined;
        command.transformMatrix = undefined;
        command.sampleBackdrop = undefined;
        command.includeOwnSurfaces = undefined;
        command.includeOwnEffectSurface = undefined;
        command.includeOwnUISurface = undefined;
    }

    /**
     * 렌더 옵션을 재사용 glass 명령에 복사합니다.
     * @param {object} target - 대상 명령입니다.
     * @param {object|null|undefined} options - 복사할 옵션입니다.
     * @private
     */
    #copyGlassRenderOptions(target, options) {
        if (!options) {
            return;
        }

        for (const key in options) {
            if (!Object.prototype.hasOwnProperty.call(options, key)) {
                continue;
            }
            target[key] = options[key];
            this.glassRenderCommandKeys.push(key);
        }
    }

    /**
     * glass 패널이 참조할 source snapshot을 구성합니다.
     * @returns {{snapshotIdentity: string, sourceRevision: number, sources: Array<{kind: string, canvas?: HTMLCanvasElement, opacity?: number, revision?: number}>}} 합성 snapshot입니다.
     * @private
     */
    #buildGlassSources() {
        const baseSnapshot = this.getCompositeSources();
        if (!this.includeOwnEffectSurface && !this.includeOwnUISurface) {
            return baseSnapshot;
        }

        const snapshot = this.glassSourceSnapshot;
        const sources = snapshot.sources;
        sources.length = 0;
        for (let index = 0; index < baseSnapshot.sources.length; index++) {
            sources.push(baseSnapshot.sources[index]);
        }

        const identityIndex = (this.includeOwnEffectSurface ? 1 : 0)
            | (this.includeOwnUISurface ? 2 : 0);
        snapshot.snapshotIdentity = this.glassSnapshotIdentities[identityIndex];
        snapshot.sourceRevision = baseSnapshot.sourceRevision;

        if (this.includeOwnEffectSurface && this.effectSurface?.canvas && !this.effectSurface.isEmpty) {
            this.ownEffectCompositeSource.canvas = this.effectSurface.canvas;
            this.ownEffectCompositeSource.opacity = this.alpha;
            this.ownEffectCompositeSource.revision = this.effectSurface.contentRevision;
            sources.push(this.ownEffectCompositeSource);
        }

        if (this.includeOwnUISurface && this.uiSurface?.canvas && !this.uiSurface.isEmpty) {
            this.ownUICompositeSource.canvas = this.uiSurface.canvas;
            this.ownUICompositeSource.opacity = this.alpha;
            this.ownUICompositeSource.revision = this.uiSurface.contentRevision;
            sources.push(this.ownUICompositeSource);
        }

        return snapshot;
    }
}
