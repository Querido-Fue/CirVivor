import { animate, remove } from 'animation/animation_system.js';
import { beginPerformanceSection, endPerformanceSection } from 'debug/debug_system.js';
import { getWH, getUIWW, getWW, render, shadowOff, shadowOn } from 'display/display_system.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { getMouseFocus, setMouseFocus } from 'input/input_system.js';
import { releaseUIItem } from 'ui/_ui_pool.js';
import { PositioningHandler } from 'ui/layout/_positioning_handler.js';
import { getSetting } from 'save/save_system.js';
import { clampNumber } from 'util/number_util.js';
import { getOverlayAnimationPreset } from './_animation_presets.js';
import {
    DEFAULT_OVERLAY_PANEL_ID,
    createOverlayPanelMap,
    getOverlayPresentationOrigin,
    getOverlayPresentedPanelRegion,
    resolveOverlayPanelRegion
} from './overlay_panel_region.js';
import { syncOverlayPanelInteractionStates } from './overlay_panel_interaction_state.js';
import { buildOverlayPanelEffectCanvas } from './overlay_panel_effect_canvas.js';
import { updateOverlayPanelInteractions } from './overlay_panel_interaction_update.js';

/**
 * @typedef {object} OverlayPanelMetric
 * @property {string} unit - 좌표 계산에 사용할 단위입니다.
 * @property {number} value - 단위 값입니다.
 */

/**
 * @typedef {object} OverlayPanelDefinition
 * @property {string} [id] - 패널 식별자입니다.
 * @property {number|OverlayPanelMetric|string} [x] - 패널 시작 X 좌표입니다.
 * @property {number|OverlayPanelMetric|string} [y] - 패널 시작 Y 좌표입니다.
 * @property {number|OverlayPanelMetric|string} [w] - 패널 너비입니다.
 * @property {number|OverlayPanelMetric|string} [h] - 패널 높이입니다.
 * @property {number|OverlayPanelMetric|string} [radius] - 반경입니다.
 * @property {number} [blur] - blur 강도입니다.
 * @property {string|object|false} [fill] - 채움 색상입니다.
 * @property {string|object|false} [stroke] - 외곽선 색상입니다.
 * @property {number} [lineWidth] - 외곽선 두께입니다.
 * @property {number} [shadowBlur] - 그림자 블러입니다.
 * @property {string} [shadowColor] - 그림자 색상입니다.
 * @property {string|number[]|Float32Array} [tintColor] - glass tint 색상입니다.
 * @property {string|number[]|Float32Array} [edgeColor] - glass edge 색상입니다.
 * @property {number} [tintStrength] - glass tint 강도입니다.
 * @property {number} [edgeStrength] - glass edge 강도입니다.
 * @property {number} [refractionStrength] - glass refraction 강도입니다.
 * @property {(info: {panel: object, localX: number, localY: number, overlay: BaseOverlay}) => void} [onClick] - 패널 클릭 콜백입니다.
 * @property {boolean} [visible] - 표시 여부입니다.
 */

/**
 * @class BaseOverlay
 * @description 동적 overlay session 위에서 동작하는 공통 overlay 콘텐츠 베이스입니다.
 */
export class BaseOverlay {
    #panelMap;
    #panelInteractionMap;
    #alphaAnimId;
    #dimAnimId;
    #scaleAnimId;
    #blurAnimId;
    #presentationAnimationToken;
    #interactionsLocked;

    /**
     * @param {object} [options={}] - overlay 옵션입니다.
     * @param {number} [options.layer=0] - overlay 정렬 레이어입니다.
     * @param {number} [options.dim=0.32] - overlay dim 강도입니다.
     * @param {boolean} [options.transparent=true] - transparent 사용 여부입니다.
     * @param {boolean} [options.glOverlay=false] - WebGL surface 요청 여부입니다.
     * @param {string} [options.blurUpdateMode='dirty'] - blur 갱신 정책입니다.
     * @param {object} [options.effects={}] - effect registry 옵션입니다.
     * @param {string} [options.animationPreset] - overlay presentation 프리셋 이름입니다.
     * @param {'panels'} [options.titleWebGpuContentBoundsAuthority] - 모든 root UI가 panel bounds 안에 있음을 명시하는 title WebGPU 전용 authority입니다.
     */
    constructor(options = {}) {
        this.overlayOptions = {
            layer: Math.max(0, options.layer || 0),
            dim: clampNumber(options.dim === undefined ? 0.32 : options.dim, 0, 1),
            transparent: options.transparent !== false,
            glOverlay: options.glOverlay === true,
            blurUpdateMode: options.blurUpdateMode || 'dirty',
            effects: options.effects || {},
            titleWebGpuContentBoundsAuthority:
                options.titleWebGpuContentBoundsAuthority === 'panels'
                    ? 'panels'
                    : null
        };

        this.layer = 'ui';
        this.session = null;
        this.presentationAnimation = getOverlayAnimationPreset(options.animationPreset);
        this.alpha = 0;
        this.dimAlpha = 0;
        this.contentScale = this.presentationAnimation.open.scale.from;
        this.contentBlur = this.presentationAnimation.open.blur.from;
        this.width = 0;
        this.height = 0;
        this.dx = 0;
        this.dy = 0;
        this.panelRegions = [];
        this.#panelMap = new Map();
        this.#panelInteractionMap = new Map();
        this.#alphaAnimId = -1;
        this.#dimAnimId = -1;
        this.#scaleAnimId = -1;
        this.#blurAnimId = -1;
        this.#presentationAnimationToken = 0;
        this.#interactionsLocked = false;
        this._performanceSectionPrefix = `overlay.${this.constructor?.name || 'Overlay'}`;
        const performanceSectionPrefix = this._performanceSectionPrefix;
        this._performanceSections = Object.freeze({
            updateTotal: `${performanceSectionPrefix}.update.total`,
            updateSession: `${performanceSectionPrefix}.update.session`,
            updateInteractions: `${performanceSectionPrefix}.update.interactions`,
            updateDynamicItems: `${performanceSectionPrefix}.update.dynamicItems`,
            drawTotal: `${performanceSectionPrefix}.draw.total`,
            drawDim: `${performanceSectionPrefix}.draw.dim`,
            drawPanels: `${performanceSectionPrefix}.draw.panels`,
            drawDecorations: `${performanceSectionPrefix}.draw.decorations`,
            drawStaticItems: `${performanceSectionPrefix}.draw.staticItems`,
            drawDynamicItems: `${performanceSectionPrefix}.draw.dynamicItems`,
            drawFloatingItems: `${performanceSectionPrefix}.draw.floatingItems`,
            drawPanelEffectCanvas: `${performanceSectionPrefix}.draw.panelEffectCanvas`,
            drawGlassPanel: `${performanceSectionPrefix}.draw.glassPanel`,
            drawFlatPanel: `${performanceSectionPrefix}.draw.flatPanel`
        });
        this._floatingItemsScratch = [];
        this._presentationOriginScratch = { x: 0, y: 0 };
        this._panelInteractionUpdateOptions = {
            overlay: this,
            session: null,
            layer: this.layer,
            alpha: 0,
            panelRegions: this.panelRegions,
            panelInteractionMap: this.#panelInteractionMap,
            interactionsEnabled: true
        };
        this._panelEffectOptions = {
            spotlightOptions: null,
            particleOptions: null,
            rippleOptions: null,
            borderOptions: null
        };
        this._glassPanelRenderOptions = {
            x: 0,
            y: 0,
            w: 0,
            h: 0,
            radius: 0,
            blur: 0,
            fill: false,
            stroke: false,
            lineWidth: 0,
            tintColor: null,
            edgeColor: null,
            tintStrength: 0,
            edgeStrength: 0,
            refractionStrength: 0,
            transformMatrix: null,
            perspective: null,
            effectTextureCanvas: null,
            alpha: 1,
            sampleBackdrop: true
        };
        this._flatPanelRenderOptions = {
            shape: 'roundRect',
            x: 0,
            y: 0,
            w: 0,
            h: 0,
            radius: 0,
            fill: false,
            stroke: false,
            lineWidth: 0,
            alpha: 1
        };

        this.uiScale = getSetting('uiScale') / 100 || 1;
        this.WW = getWW();
        this.WH = getWH();
        this.UIWW = getUIWW();
        this.positioningHandler = new PositioningHandler(this, this.uiScale);
    }

    /**
     * overlay 옵션을 반환합니다.
     * @returns {object} session 생성 옵션입니다.
     */
    getSessionOptions() {
        return { ...this.overlayOptions };
    }

    /**
     * @protected
     * 성능 프로파일러에 사용할 overlay 섹션 접두사를 반환합니다.
     * @returns {string} overlay 섹션 접두사입니다.
     */
    _getPerformanceSectionPrefix() {
        return this._performanceSectionPrefix;
    }

    /**
     * overlay session을 연결합니다.
     * @param {import('./_overlay_session.js').OverlaySession} session - 연결할 session입니다.
     */
    attach(session) {
        this.session = session;
        this.layer = session.uiLayerId;
        this.previousFocus = getMouseFocus();
        setMouseFocus(this.layer);
        this.positioningHandler = new PositioningHandler(this, this.uiScale);
        this.resize();
        this.#syncPresentationToSession();
        this.open();
    }

    /**
     * overlay 닫기 완료 콜백을 설정합니다.
     * @param {(overlay: BaseOverlay) => void} closeHandler - 닫기 완료 시 실행할 핸들러입니다.
     */
    setCloseHandler(closeHandler) {
        this.closeHandler = closeHandler;
    }

    /**
     * overlay를 엽니다.
     */
    open() {
        this.#interactionsLocked = false;
        this.#animatePresentationPhase('open');
    }

    /**
     * overlay의 모든 패널과 UI 요소 입력을 잠급니다.
     * 이미 잠긴 경우 false를 반환해 비동기 확인 동작의 중복 실행을 막을 수 있습니다.
     * @returns {boolean} 이번 호출에서 새로 잠갔으면 true입니다.
     */
    lockInteractions() {
        if (this.#interactionsLocked) {
            return false;
        }

        this.#interactionsLocked = true;
        return true;
    }

    /**
     * overlay 입력 잠금 여부를 반환합니다.
     * @returns {boolean} 패널과 UI 요소 입력이 잠겨 있으면 true입니다.
     */
    isInteractionLocked() {
        return this.#interactionsLocked;
    }

    /**
     * overlay를 닫습니다.
     */
    close() {
        this.lockInteractions();
        this.#animatePresentationPhase('close', () => {
            setMouseFocus(this.previousFocus || ['ui', 'object']);
            if (typeof this.onCloseComplete === 'function') {
                this.onCloseComplete();
            }
            if (typeof this.closeHandler === 'function') {
                this.closeHandler(this);
            }
        });
    }

    /**
     * @private
     * overlay의 현재 프레젠테이션 상태를 session에 동기화합니다.
     */
    #syncPresentationToSession() {
        if (!this.session) {
            return;
        }

        const presentationOrigin = getOverlayPresentationOrigin(this, this._presentationOriginScratch);
        this.session.setAlpha(this.alpha);
        this.session.setDimAlpha(this.dimAlpha);
        this.session.setContentScale(this.contentScale);
        this.session.setContentBlur(this.contentBlur);
        if (typeof this.session.setContentScaleOrigin === 'function') {
            this.session.setContentScaleOrigin(
                presentationOrigin.x / Math.max(1, this.WW),
                presentationOrigin.y / Math.max(1, this.WH)
            );
        }
    }

    /**
     * @private
     * 현재 프레젠테이션 값을 한 번에 반영합니다.
     * @param {number} alpha - 콘텐츠 알파값입니다.
     * @param {number} dimAlpha - dim 알파값입니다.
     * @param {number} contentScale - 콘텐츠 배율입니다.
     * @param {number} contentBlur - 콘텐츠 blur 반경입니다.
     */
    #setPresentationState(alpha, dimAlpha, contentScale, contentBlur) {
        this.alpha = alpha;
        this.dimAlpha = dimAlpha;
        this.contentScale = contentScale;
        this.contentBlur = contentBlur;
        this.#syncPresentationToSession();
    }

    /**
     * @private
     * 진행 중인 프레젠테이션 애니메이션을 정리합니다.
     */
    #stopPresentationAnimations() {
        this.#presentationAnimationToken += 1;
        if (this.#alphaAnimId >= 0) {
            remove(this.#alphaAnimId);
            this.#alphaAnimId = -1;
        }
        if (this.#dimAnimId >= 0) {
            remove(this.#dimAnimId);
            this.#dimAnimId = -1;
        }
        if (this.#scaleAnimId >= 0) {
            remove(this.#scaleAnimId);
            this.#scaleAnimId = -1;
        }
        if (this.#blurAnimId >= 0) {
            remove(this.#blurAnimId);
            this.#blurAnimId = -1;
        }
    }

    /**
     * @private
     * 프레젠테이션 애니메이션 식별자를 초기화합니다.
     */
    #clearPresentationAnimationIds() {
        this.#alphaAnimId = -1;
        this.#dimAnimId = -1;
        this.#scaleAnimId = -1;
        this.#blurAnimId = -1;
    }

    /**
     * @private
     * 지정한 open/close 프리셋을 현재 presentation 상태에 적용합니다.
     * @param {'open'|'close'} phase - 실행할 presentation 단계입니다.
     * @param {Function} [onComplete] - 전체 트랙 완료 콜백입니다.
     */
    #animatePresentationPhase(phase, onComplete) {
        const phaseConfig = this.presentationAnimation[phase];
        const isOpening = phase === 'open';
        this.#animatePresentation({
            alphaStart: isOpening ? phaseConfig.alpha.from : this.alpha,
            alphaEnd: phaseConfig.alpha.to,
            alphaEasingType: phaseConfig.alpha.easing,
            alphaDuration: phaseConfig.alpha.duration,
            dimStart: isOpening ? phaseConfig.alpha.from : this.dimAlpha,
            dimEnd: phaseConfig.alpha.to,
            scaleStart: isOpening ? phaseConfig.scale.from : this.contentScale,
            scaleEnd: phaseConfig.scale.to,
            scaleEasingType: phaseConfig.scale.easing,
            scaleDuration: phaseConfig.scale.duration,
            blurStart: isOpening ? phaseConfig.blur.from : this.contentBlur,
            blurEnd: phaseConfig.blur.to,
            blurEasingType: phaseConfig.blur.easing,
            blurDuration: phaseConfig.blur.duration,
            onComplete
        });
    }

    /**
     * @private
     * overlay alpha, scale, blur 트랙을 병렬 실행합니다.
     * @param {object} options - 애니메이션 옵션입니다.
     * @param {number} options.alphaStart - 콘텐츠 알파 시작값입니다.
     * @param {number} options.alphaEnd - 콘텐츠 알파 종료값입니다.
     * @param {string} options.alphaEasingType - alpha/dim easing 타입입니다.
     * @param {number} options.alphaDuration - alpha/dim 시간입니다.
     * @param {number} options.dimStart - dim 알파 시작값입니다.
     * @param {number} options.dimEnd - dim 알파 종료값입니다.
     * @param {number} options.scaleStart - 콘텐츠 배율 시작값입니다.
     * @param {number} options.scaleEnd - 콘텐츠 배율 종료값입니다.
     * @param {string} options.scaleEasingType - scale easing 타입입니다.
     * @param {number} options.scaleDuration - scale 시간입니다.
     * @param {number} options.blurStart - 콘텐츠 blur 시작값입니다.
     * @param {number} options.blurEnd - 콘텐츠 blur 종료값입니다.
     * @param {string} options.blurEasingType - blur easing 타입입니다.
     * @param {number} options.blurDuration - blur 시간입니다.
     * @param {Function} [options.onComplete] - 완료 콜백입니다.
     */
    #animatePresentation(options) {
        this.#stopPresentationAnimations();
        this.#setPresentationState(
            options.alphaStart,
            options.dimStart,
            options.scaleStart,
            options.blurStart
        );
        const presentationAnimationToken = this.#presentationAnimationToken;

        const alphaAnimation = animate(this, {
            variable: 'alpha',
            startValue: options.alphaStart,
            endValue: options.alphaEnd,
            type: options.alphaEasingType,
            duration: options.alphaDuration
        });
        const dimAnimation = animate(this, {
            variable: 'dimAlpha',
            startValue: options.dimStart,
            endValue: options.dimEnd,
            type: options.alphaEasingType,
            duration: options.alphaDuration
        });
        const scaleAnimation = animate(this, {
            variable: 'contentScale',
            startValue: options.scaleStart,
            endValue: options.scaleEnd,
            type: options.scaleEasingType,
            duration: options.scaleDuration
        });
        const blurAnimation = animate(this, {
            variable: 'contentBlur',
            startValue: options.blurStart,
            endValue: options.blurEnd,
            type: options.blurEasingType,
            duration: options.blurDuration
        });

        this.#alphaAnimId = alphaAnimation.id;
        this.#dimAnimId = dimAnimation.id;
        this.#scaleAnimId = scaleAnimation.id;
        this.#blurAnimId = blurAnimation.id;

        Promise.all([
            alphaAnimation.promise,
            dimAnimation.promise,
            scaleAnimation.promise,
            blurAnimation.promise
        ]).then(() => {
            if (presentationAnimationToken !== this.#presentationAnimationToken) {
                return;
            }
            this.#clearPresentationAnimationIds();
            this.#setPresentationState(
                options.alphaEnd,
                options.dimEnd,
                options.scaleEnd,
                options.blurEnd
            );
            if (typeof options.onComplete === 'function') {
                options.onComplete();
            }
        });
    }

    /**
     * overlay 크기와 레이아웃을 갱신합니다.
     */
    resize() {
        this.WW = getWW();
        this.WH = getWH();
        this.UIWW = getUIWW();
        this._onResize();
        this._calculateGeometry();
        this.positioningHandler.resize(this, this.uiScale);
        this._generateLayout();
        this.markBlurDirty();
    }

    /**
     * blur 캐시를 무효화합니다.
     */
    markBlurDirty() {
        if (this.session && this.session.effectiveTransparent) {
            this.session.invalidateBlur();
        }
    }

    /**
     * overlay 업데이트를 수행합니다.
     */
    update() {
        const sections = this._performanceSections;
        const totalStart = beginPerformanceSection();
        if (this.session) {
            const sessionStart = beginPerformanceSection();
            this.session.updateEffects();
            this.#syncPresentationToSession();
            endPerformanceSection(sections.updateSession, sessionStart);
        }

        const interactionStart = beginPerformanceSection();
        this.#updatePanelInteractions();
        endPerformanceSection(sections.updateInteractions, interactionStart);

        if (!this.#interactionsLocked && this.dynamicItems) {
            const dynamicStart = beginPerformanceSection();
            for (const entry of this.dynamicItems) {
                const item = entry.item;
                if (item.update) {
                    item.update();
                }
                if (this.#interactionsLocked) {
                    break;
                }
            }
            endPerformanceSection(sections.updateDynamicItems, dynamicStart);
        }
        endPerformanceSection(sections.updateTotal, totalStart);
    }

    /**
     * overlay를 그립니다.
     */
    draw() {
        const sections = this._performanceSections;
        const totalStart = beginPerformanceSection();
        if (!this.session || (this.alpha <= 0 && this.dimAlpha <= 0)) {
            endPerformanceSection(sections.drawTotal, totalStart);
            return;
        }

        let startTime = beginPerformanceSection();
        this.session.renderDim();
        endPerformanceSection(sections.drawDim, startTime);
        if (this.alpha <= 0) {
            endPerformanceSection(sections.drawTotal, totalStart);
            return;
        }

        startTime = beginPerformanceSection();
        this.#drawPanels();
        endPerformanceSection(sections.drawPanels, startTime);
        startTime = beginPerformanceSection();
        this._drawOverlayDecorations();
        endPerformanceSection(sections.drawDecorations, startTime);

        if (this.staticItems) {
            startTime = beginPerformanceSection();
            for (const entry of this.staticItems) {
                render(this.layer, entry.item);
            }
            endPerformanceSection(sections.drawStaticItems, startTime);
        }

        if (this.dynamicItems) {
            const floatingItems = this._floatingItemsScratch;
            floatingItems.length = 0;
            startTime = beginPerformanceSection();
            for (const entry of this.dynamicItems) {
                const item = entry.item;
                if (item.draw) {
                    item.draw();
                }
                if (typeof item.drawFloating === 'function') {
                    floatingItems.push(item);
                }
            }
            endPerformanceSection(sections.drawDynamicItems, startTime);
            if (floatingItems.length > 0) {
                startTime = beginPerformanceSection();
                for (const item of floatingItems) {
                    item.drawFloating();
                }
                endPerformanceSection(sections.drawFloatingItems, startTime);
            }
            floatingItems.length = 0;
        }
        endPerformanceSection(sections.drawTotal, totalStart);
    }

    /**
     * 현재 overlay dim 강도를 반환합니다.
     * @returns {number} 현재 alpha를 반영한 dim 강도입니다.
     */
    getDimOpacity() {
        return this.overlayOptions.dim * this.dimAlpha;
    }

    /**
     * overlay 종료 시 자원을 정리합니다.
     */
    destroy() {
        this.#interactionsLocked = true;
        this._releaseElements();
        this.#panelInteractionMap.clear();
        this.#stopPresentationAnimations();
    }

    /**
     * 패널 영역을 반환합니다.
     * @param {string|number} [panelKey='root'] - 조회할 패널 키입니다.
     * @returns {object|null} 패널 영역입니다.
     */
    getPanelRegion(panelKey = DEFAULT_OVERLAY_PANEL_ID) {
        if (typeof panelKey === 'number') {
            return this.panelRegions[panelKey] || null;
        }
        return this.#panelMap.get(panelKey) || null;
    }

    /**
     * 패널을 레이아웃 부모처럼 사용하는 컨텍스트를 반환합니다.
     * @param {string|number} [panelKey='root'] - 조회할 패널 키입니다.
     * @returns {object} 레이아웃 부모 컨텍스트입니다.
     */
    getPanelLayoutParent(panelKey = DEFAULT_OVERLAY_PANEL_ID) {
        const panel = this.getPanelRegion(panelKey);
        if (!panel) {
            return this;
        }

        return {
            session: this.session,
            layer: this.layer,
            uiScale: this.uiScale,
            x: panel.x,
            y: panel.y,
            width: panel.w / this.uiScale,
            height: panel.h / this.uiScale,
            scaledX: panel.x,
            scaledY: panel.y,
            scaledW: panel.w,
            scaledH: panel.h
        };
    }

    /**
     * 패널 전용 PositioningHandler를 생성합니다.
     * @param {string|number} [panelKey='root'] - 사용할 패널 키입니다.
     * @returns {PositioningHandler} 패널용 positioning handler입니다.
     */
    createPanelPositioningHandler(panelKey = DEFAULT_OVERLAY_PANEL_ID) {
        return new PositioningHandler(this.getPanelLayoutParent(panelKey), this.uiScale);
    }

    /**
     * @private
     * 패널별 interaction/effect 상태를 매 프레임 갱신합니다.
     */
    #updatePanelInteractions() {
        const options = this._panelInteractionUpdateOptions;
        options.session = this.session;
        options.layer = this.layer;
        options.alpha = this.alpha;
        options.panelRegions = this.panelRegions;
        options.interactionsEnabled = !this.#interactionsLocked;
        updateOverlayPanelInteractions(options);
    }

    /**
     * @private
     * 패널 effect를 그릴 오프스크린 캔버스를 생성하거나 재사용합니다.
     * @param {object} panel - 대상 패널입니다.
     * @param {object} interactionState - 패널 interaction 상태입니다.
     * @returns {HTMLCanvasElement|null} 그려진 effect 캔버스입니다.
     */
    #buildPanelEffectCanvas(panel, interactionState) {
        const options = this._panelEffectOptions;
        options.spotlightOptions = this.session.getEffectOptions('hoverSpotlight');
        options.particleOptions = this.session.getEffectOptions('hoverParticle');
        options.rippleOptions = this.session.getEffectOptions('clickRipple');
        options.borderOptions = this.session.getEffectOptions('hoverBorder');
        return buildOverlayPanelEffectCanvas(panel, interactionState, options);
    }

    /**
     * @protected
     * overlay 크기와 중심 좌표를 계산합니다.
     * @returns {void}
     */
    _calculateGeometry() {
        this.scaledW = this.width * this.uiScale;
        this.scaledH = this.height * this.uiScale;
        this.scaledX = ((this.WW - this.scaledW) * 0.5) + this.dx;
        this.scaledY = ((this.WH - this.scaledH) * 0.5) + this.dy;
        this.#rebuildPanelRegions();
    }

    /**
     * @protected
     * 화면 크기 변경 시 overlay 크기를 재정의합니다.
     * @returns {void}
     */
    _onResize() {
    }

    /**
     * @protected
     * 레이아웃을 생성합니다.
     * @returns {void}
     */
    _generateLayout() {
    }

    /**
     * @protected
     * overlay 패널 정의를 반환합니다.
     * @returns {OverlayPanelDefinition[]} 패널 정의 목록입니다.
     */
    _getPanelDefinitions() {
        return [{ id: DEFAULT_OVERLAY_PANEL_ID }];
    }

    /**
     * @protected
     * 패널 뒤에 추가 장식을 그릴 때 사용하는 훅입니다.
     * @returns {void}
     */
    _drawOverlayDecorations() {
    }

    /**
     * @protected
     * overlay 닫기 직후 호출되는 훅입니다.
     * @returns {void}
     */
    onCloseComplete() {
    }

    /**
     * 런타임 설정 변경을 overlay에 반영합니다. uiScale payload가 유효하면 저장값보다 우선합니다.
     * @param {object} [changedSettings={}] - 변경된 설정 키와 값입니다.
     */
    applyRuntimeSettings(changedSettings = {}) {
        let shouldResize = changedSettings.theme !== undefined
            || changedSettings.language !== undefined;

        if (changedSettings.uiScale !== undefined) {
            const runtimeUiScale = Number(changedSettings.uiScale) / 100;
            const savedUiScale = Number(getSetting('uiScale')) / 100;
            this.uiScale = Number.isFinite(runtimeUiScale) && runtimeUiScale > 0
                ? runtimeUiScale
                : (Number.isFinite(savedUiScale) && savedUiScale > 0 ? savedUiScale : 1);
            this.positioningHandler = new PositioningHandler(this, this.uiScale);
            shouldResize = true;
        }

        if (changedSettings.disableTransparency !== undefined
            && this.session
            && typeof this.session.setDisableTransparency === 'function') {
            this.session.setDisableTransparency(getSetting('disableTransparency'));
        }

        if (shouldResize) {
            this.resize();
        }
    }

    /**
     * @private
     * 현재 overlay에 정의된 패널을 렌더링합니다.
     */
    #drawPanels() {
        const sections = this._performanceSections;
        const glassAlpha = typeof this.session?.getGlassPanelAlpha === 'function'
            ? this.session.getGlassPanelAlpha()
            : (this.session?.effectiveTransparent === true ? 1 : 0);
        const opaqueAlpha = typeof this.session?.getOpaquePanelAlpha === 'function'
            ? this.session.getOpaquePanelAlpha()
            : 1 - glassAlpha;
        const glassDefaultFill = ColorSchemes.Overlay.Panel.GlassBackground;
        const glassDefaultStroke = ColorSchemes.Overlay.Panel.GlassBorder || false;
        const flatDefaultFill = ColorSchemes.Overlay.Panel.Background;
        const flatDefaultStroke = ColorSchemes.Overlay.Panel.Border || flatDefaultFill;
        const defaultTintColor = ColorSchemes.Overlay.Panel.GlassTint;
        const defaultEdgeColor = ColorSchemes.Overlay.Panel.GlassEdge;
        const defaultTintStrength = ColorSchemes.Overlay.Panel.GlassTintStrength;
        const defaultEdgeStrength = ColorSchemes.Overlay.Panel.GlassEdgeStrength;

        for (const panel of this.panelRegions) {
            if (!panel.visible || panel.w <= 0 || panel.h <= 0) {
                continue;
            }

            const interactionState = this.#panelInteractionMap.get(panel.id);
            const canUseEffectPipeline = Boolean(this.session.effectLayerId);
            const contentBoundsPanel = getOverlayPresentedPanelRegion(panel, this);
            if (this.overlayOptions.titleWebGpuContentBoundsAuthority === 'panels') {
                this.session.recordTitleWebGpuPanelContentBounds?.(contentBoundsPanel);
            }
            const effectPanel = canUseEffectPipeline
                ? contentBoundsPanel
                : panel;
            let effectTextureCanvas = null;
            if (interactionState) {
                const effectStart = beginPerformanceSection();
                effectTextureCanvas = this.#buildPanelEffectCanvas(effectPanel, interactionState);
                endPerformanceSection(sections.drawPanelEffectCanvas, effectStart);
            }
            const hasEffectVisual = Boolean(effectTextureCanvas)
                || Boolean(interactionState
                    && (Math.abs(interactionState.rotateX) > 0.0001 || Math.abs(interactionState.rotateY) > 0.0001));
            const shouldRenderGlass = canUseEffectPipeline && glassAlpha > 0;
            const shouldRenderEffectFlat = canUseEffectPipeline && hasEffectVisual && opaqueAlpha > 0;
            const presentedPanel = shouldRenderGlass || shouldRenderEffectFlat ? effectPanel : panel;

            if (shouldRenderGlass || shouldRenderEffectFlat) {
                const glassOptions = this._glassPanelRenderOptions;
                glassOptions.x = presentedPanel.x;
                glassOptions.y = presentedPanel.y;
                glassOptions.w = presentedPanel.w;
                glassOptions.h = presentedPanel.h;
                glassOptions.radius = presentedPanel.radius;
                glassOptions.blur = panel.blur;
                glassOptions.lineWidth = presentedPanel.lineWidth;
                glassOptions.tintColor = panel.tintColor === undefined ? defaultTintColor : panel.tintColor;
                glassOptions.edgeColor = panel.edgeColor === undefined ? defaultEdgeColor : panel.edgeColor;
                glassOptions.tintStrength = panel.tintStrength === undefined ? defaultTintStrength : panel.tintStrength;
                glassOptions.edgeStrength = panel.edgeStrength === undefined ? defaultEdgeStrength : panel.edgeStrength;
                glassOptions.refractionStrength = panel.refractionStrength;
                glassOptions.transformMatrix = interactionState?.transformMatrix;
                glassOptions.perspective = interactionState?.perspective;
                glassOptions.effectTextureCanvas = effectTextureCanvas;

                if (shouldRenderGlass) {
                    glassOptions.fill = panel.fill === undefined ? glassDefaultFill : panel.fill;
                    glassOptions.stroke = panel.stroke === undefined ? glassDefaultStroke : panel.stroke;
                    glassOptions.alpha = glassAlpha;
                    glassOptions.sampleBackdrop = true;
                    const glassStart = beginPerformanceSection();
                    this.session.renderGlassPanel(glassOptions);
                    endPerformanceSection(sections.drawGlassPanel, glassStart);
                }

                if (shouldRenderEffectFlat) {
                    glassOptions.fill = panel.fill === undefined ? flatDefaultFill : panel.fill;
                    glassOptions.stroke = panel.stroke === undefined ? flatDefaultStroke : panel.stroke;
                    glassOptions.alpha = opaqueAlpha;
                    glassOptions.sampleBackdrop = false;
                    const flatEffectStart = beginPerformanceSection();
                    this.session.renderGlassPanel(glassOptions);
                    endPerformanceSection(sections.drawGlassPanel, flatEffectStart);
                }
            }

            if (!shouldRenderEffectFlat && opaqueAlpha > 0) {
                const flatOptions = this._flatPanelRenderOptions;
                flatOptions.x = panel.x;
                flatOptions.y = panel.y;
                flatOptions.w = panel.w;
                flatOptions.h = panel.h;
                flatOptions.radius = panel.radius;
                flatOptions.fill = panel.fill === undefined ? flatDefaultFill : panel.fill;
                flatOptions.stroke = panel.stroke === undefined ? flatDefaultStroke : panel.stroke;
                flatOptions.lineWidth = panel.lineWidth;
                flatOptions.alpha = opaqueAlpha;
                const flatStart = beginPerformanceSection();
                shadowOn(this.layer, panel.shadowBlur, panel.shadowColor);
                this.session.renderPanel(flatOptions);
                shadowOff(this.layer);
                endPerformanceSection(sections.drawFlatPanel, flatStart);
            }
        }
    }

    /**
     * @private
     * 패널 정의를 실제 좌표로 변환합니다.
     */
    #rebuildPanelRegions() {
        const definitions = this._getPanelDefinitions();
        const normalizedDefinitions = Array.isArray(definitions) && definitions.length > 0
            ? definitions
            : [{ id: DEFAULT_OVERLAY_PANEL_ID }];

        this.panelRegions = normalizedDefinitions.map((definition, index) => resolveOverlayPanelRegion(definition, index, this));
        this.#panelMap = createOverlayPanelMap(this.panelRegions);
        syncOverlayPanelInteractionStates(this.panelRegions, this.#panelInteractionMap);
    }

    /**
     * @protected
     * 빌드된 UI 요소를 안전하게 회수합니다.
     * @returns {void}
     */
    _releaseElements() {
        if (this.staticItems) {
            for (const entry of this.staticItems) {
                releaseUIItem(entry.item);
            }
            this.staticItems = null;
        }

        if (this.dynamicItems) {
            for (const entry of this.dynamicItems) {
                releaseUIItem(entry.item);
            }
            this.dynamicItems = null;
        }
    }
}
