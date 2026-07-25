import { render, renderGL } from 'display/display_system.js';
import { animate, remove } from 'animation/animation_system.js';
import { resolveOverlayContentSurfaceStyles } from 'display/webgl/_overlay_render_geometry.js';
import { OVERLAY_RENDER_CONSTANTS } from 'display/webgl/_webgl_constants.js';
import { clampFiniteNumber, clampNumber } from 'util/number_util.js';
import { createOverlayEffectState } from './_overlay_effect_registry.js';

/**
 * @class OverlaySession
 * @description overlay 하나에 대응하는 surface 묶음과 blur/effect 상태를 관리합니다.
 */
export class OverlaySession {
    #dimRenderCommand;
    #glassAnimation = null;
    #glassAnimationToken = 0;

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
        this.effectiveTransparent = OVERLAY_RENDER_CONSTANTS.BACKDROP_SAMPLING_ENABLED === true
            && this.transparent
            && !disableTransparency;
        this.glassMix = this.effectiveTransparent ? 1 : 0;
        this.glassTarget = this.glassMix;
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
        this.floatingEffectSurface = null;
        this.floatingUISurface = null;
        this.floatingEffectLayerId = null;
        this.floatingUILayerId = null;
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
        this.floatingGlassRenderCommand = { shape: 'glassPanel' };
        this.floatingGlassRenderCommandKeys = [];
        this.includeOwnEffectSurface = false;
        this.includeOwnUISurface = false;
        this.glassSourceProvider = () => this.#buildGlassSources();
        this.floatingGlassSourceProvider = () => this.#getFloatingCompositeSources();
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
     * 투명도 설정을 반영하고 기존 패널과 glass 패널을 0.4초 동안 교차 감쇠합니다.
     * 전역 backdrop 정책이 꺼져 있으면 항상 불투명 상태를 유지합니다.
     * @param {boolean} disableTransparency - 투명도 비활성화 여부입니다.
     */
    setDisableTransparency(disableTransparency) {
        const nextGlassTarget = OVERLAY_RENDER_CONSTANTS.BACKDROP_SAMPLING_ENABLED === true
            && this.transparent
            && disableTransparency !== true
            ? 1
            : 0;
        if (this.glassTarget === nextGlassTarget
            && Object.is(this.glassMix, nextGlassTarget)
            && !this.#glassAnimation) {
            return;
        }

        this.glassTarget = nextGlassTarget;
        const animationToken = ++this.#glassAnimationToken;
        if (this.#glassAnimation) {
            remove(this.#glassAnimation.id);
            this.#glassAnimation = null;
        }

        if (nextGlassTarget > 0 || this.glassMix > 0) {
            this.effectiveTransparent = true;
        }
        this.needsEffectSurface = this.effectiveTransparent || this.glOverlay || this.hasRegisteredEffects;
        this.#syncEffectSurfaceAvailability();
        this.invalidateBlur();

        if (Object.is(this.glassMix, nextGlassTarget)) {
            this.#finalizeGlassTransition(nextGlassTarget);
            return;
        }

        const animation = animate(this, {
            variable: 'glassMix',
            startValue: 'current',
            endValue: nextGlassTarget,
            duration: OVERLAY_RENDER_CONSTANTS.GLASS_TRANSITION_DURATION_SECONDS,
            type: OVERLAY_RENDER_CONSTANTS.GLASS_TRANSITION_EASING
        });
        this.#glassAnimation = animation;
        animation.promise.then(() => {
            if (animationToken !== this.#glassAnimationToken || this.#glassAnimation !== animation) {
                return;
            }
            this.#glassAnimation = null;
            this.#finalizeGlassTransition(nextGlassTarget);
        });
    }

    /**
     * 현재 glass 교차 감쇠 비율을 반환합니다.
     * @returns {number} 0은 불투명 패널, 1은 backdrop glass 패널입니다.
     */
    getGlassMix() {
        return clampNumber(this.glassMix, 0, 1);
    }

    /**
     * 현재 glass 패널의 렌더 알파를 반환합니다.
     * 전환 중에는 backdrop을 완전히 유지하고 불투명 전환 완료 뒤에만 제거합니다.
     * @returns {number} glass 패널 렌더 알파입니다.
     */
    getGlassPanelAlpha() {
        return this.effectiveTransparent ? 1 : 0;
    }

    /**
     * 현재 불투명 패널의 렌더 알파를 반환합니다.
     * @returns {number} 불투명 패널 렌더 알파입니다.
     */
    getOpaquePanelAlpha() {
        return 1 - this.getGlassMix();
    }

    /**
     * 현재 프레임의 glass 패널이 하위 WebGL 결과를 샘플링할지 반환합니다.
     * @returns {boolean} 중간 flush가 필요한 경우 true입니다.
     */
    requiresBackdropComposite() {
        return Boolean(this.effectLayerId) && this.getGlassPanelAlpha() > 0 && this.alpha > 0;
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
        if (this.floatingEffectLayerId) {
            this.displaySystem.markOverlayEffectDirty(this.floatingEffectLayerId);
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
        this.#resetGlassRenderCommand(command, this.glassRenderCommandKeys);
        this.#resolveEffectRenderOptions(command, this.glassRenderCommandKeys);
        this.#copyGlassRenderOptions(command, options, this.glassRenderCommandKeys);

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
        command.sampleBackdrop = this.getGlassPanelAlpha() > 0
            && command.sampleBackdrop !== false;
        renderGL(this.effectLayerId, command);
    }

    /**
     * 일반 UI보다 위에 있는 전용 effect surface에 floating glass 패널을 렌더링합니다.
     * source anchor가 기본 UI surface 뒤에 있어 드롭다운 뒤쪽 UI까지 실제로 blur됩니다.
     * @param {object} options - 패널 렌더링 옵션입니다.
     * @returns {boolean} glass 패널을 렌더링했으면 true입니다.
     */
    renderFloatingGlassPanel(options) {
        if (this.getGlassPanelAlpha() <= 0) {
            return false;
        }

        this.#ensureFloatingSurfaces();
        if (!this.floatingEffectLayerId) {
            return false;
        }

        const command = this.floatingGlassRenderCommand;
        this.#resetGlassRenderCommand(command, this.floatingGlassRenderCommandKeys);
        this.#copyGlassRenderOptions(command, options, this.floatingGlassRenderCommandKeys);
        command.shape = 'glassPanel';
        command.blurUpdateMode = this.blurUpdateMode;
        command.blurRevision = this.blurRevision;
        command.sourceProvider = this.floatingGlassSourceProvider;
        command.sampleBackdrop = command.sampleBackdrop !== false;
        renderGL(this.floatingEffectLayerId, command);
        return true;
    }

    /**
     * floating glass 위에 텍스트와 상호작용 피드백을 그릴 2D layer를 반환합니다.
     * @returns {string|null} floating UI layer ID입니다.
     */
    getFloatingUILayerId() {
        this.#ensureFloatingSurfaces();
        return this.floatingUILayerId;
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
     * @returns {{dimLayerId:string|null, uiLayerId:string, effectLayerId:string|null, floatingUILayerId:string|null, floatingEffectLayerId:string|null}} surface 식별자입니다.
     */
    getLayerIds() {
        return {
            dimLayerId: this.dimLayerId,
            uiLayerId: this.uiLayerId,
            effectLayerId: this.effectLayerId,
            floatingUILayerId: this.floatingUILayerId,
            floatingEffectLayerId: this.floatingEffectLayerId
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
        this.#glassAnimationToken += 1;
        if (this.#glassAnimation) {
            remove(this.#glassAnimation.id);
            this.#glassAnimation = null;
        }
        this.#releaseFloatingSurfaces();
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
        if (this.floatingUISurface) {
            this.#setSurfaceOpacity(this.floatingUISurface, this.alpha);
        }
        if (this.floatingEffectSurface) {
            this.#setSurfaceOpacity(this.floatingEffectSurface, this.alpha);
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
        if (this.floatingUISurface) {
            this.floatingUISurface.canvas.style.transformOrigin = surfaceStyles.transformOrigin;
            this.floatingUISurface.canvas.style.transform = surfaceStyles.uiTransform;
            this.floatingUISurface.canvas.style.filter = surfaceStyles.uiFilter;
        }
        if (this.floatingEffectSurface) {
            this.floatingEffectSurface.canvas.style.transformOrigin = surfaceStyles.transformOrigin;
            this.floatingEffectSurface.canvas.style.transform = surfaceStyles.effectTransform;
            this.floatingEffectSurface.canvas.style.filter = surfaceStyles.effectFilter;
        }
    }

    /**
     * glass 전환의 최종 상태와 surface 가용성을 동기화합니다.
     * @param {number} target - 0 또는 1인 glass 목표값입니다.
     * @private
     */
    #finalizeGlassTransition(target) {
        this.glassMix = target;
        this.effectiveTransparent = target > 0;
        this.needsEffectSurface = this.effectiveTransparent || this.glOverlay || this.hasRegisteredEffects;
        this.#syncEffectSurfaceAvailability();
        if (!this.effectiveTransparent) {
            this.#releaseFloatingSurfaces();
        }
        this.invalidateBlur();
    }

    /**
     * 기본 UI 위에 놓이는 floating effect/UI surface 쌍을 지연 생성합니다.
     * @private
     */
    #ensureFloatingSurfaces() {
        if (this.floatingEffectSurface && this.floatingUISurface) {
            return;
        }

        this.#releaseFloatingSurfaces();
        this.floatingEffectSurface = this.displaySystem.createDynamicSurface({
            type: 'webgl',
            order: this.sortOrderBase + 2,
            mode: 'overlay-effect',
            includeInComposite: true
        });
        this.floatingUISurface = this.displaySystem.createDynamicSurface({
            type: '2d',
            order: this.sortOrderBase + 3,
            includeInComposite: true
        });
        this.floatingEffectLayerId = this.floatingEffectSurface.id;
        this.floatingUILayerId = this.floatingUISurface.id;
        this.#syncSurfaceOpacity();
        this.appliedContentScale = Number.NaN;
        this.appliedContentBlur = Number.NaN;
        this.#syncContentPresentation();
    }

    /**
     * floating surface 쌍을 display pool로 반환합니다.
     * @private
     */
    #releaseFloatingSurfaces() {
        if (this.floatingEffectLayerId) {
            this.displaySystem.releaseDynamicSurface(this.floatingEffectLayerId);
        }
        if (this.floatingUILayerId) {
            this.displaySystem.releaseDynamicSurface(this.floatingUILayerId);
        }
        this.floatingEffectSurface = null;
        this.floatingUISurface = null;
        this.floatingEffectLayerId = null;
        this.floatingUILayerId = null;
    }

    /**
     * floating effect surface 아래의 기본 panel과 UI를 포함한 backdrop source를 반환합니다.
     * @returns {{snapshotIdentity:string, sourceRevision:number, sources:Array<object>}} 합성 snapshot입니다.
     * @private
     */
    #getFloatingCompositeSources() {
        return this.floatingEffectLayerId
            ? this.displaySystem.getCompositeSourcesBeforeSurface(this.floatingEffectLayerId)
            : this.displaySystem.getCompositeSourcesBeforeSurface(this.effectLayerId || this.uiLayerId);
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
    #resolveEffectRenderOptions(target, commandKeys = this.glassRenderCommandKeys) {
        for (const effectState of this.effectStates) {
            if (typeof effectState.getRenderOptions !== 'function') {
                continue;
            }

            this.#copyGlassRenderOptions(target, effectState.getRenderOptions(), commandKeys);
        }
    }

    /**
     * 이전 glass 명령의 동적 필드를 비웁니다.
     * @private
     */
    #resetGlassRenderCommand(command = this.glassRenderCommand, commandKeys = this.glassRenderCommandKeys) {
        for (let index = 0; index < commandKeys.length; index++) {
            command[commandKeys[index]] = undefined;
        }
        commandKeys.length = 0;
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
    #copyGlassRenderOptions(target, options, commandKeys = this.glassRenderCommandKeys) {
        if (!options) {
            return;
        }

        for (const key in options) {
            if (!Object.prototype.hasOwnProperty.call(options, key)) {
                continue;
            }
            target[key] = options[key];
            commandKeys.push(key);
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
