import { animate, remove } from 'animation/animation_system.js';
import { beginPerformanceSection, endPerformanceSection } from 'debug/debug_system.js';
import { getWH, getUIWW, getWW, render, shadowOff, shadowOn } from 'display/display_system.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { getMouseFocus, setMouseFocus } from 'input/input_system.js';
import { releaseUIItem } from 'ui/_ui_pool.js';
import { PositioningHandler } from 'ui/layout/_positioning_handler.js';
import { getData } from 'data/data_handler.js';
import { getSetting } from 'save/save_system.js';
import { clampNumber } from 'util/number_util.js';
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
import {
    cancelOverlayConnectedPresentation,
    getOverlayConnectedPresentationBackRotationY,
    getOverlayConnectedPresentationRect,
    isOverlayConnectedPresentation,
    setOverlayConnectedPresentationTarget
} from './overlay_connected_presentation.js';

const OVERLAY_PRESENTATION_CONSTANTS = getData('OVERLAY_LAYOUT_CONSTANTS').PRESENTATION;
const OVERLAY_PRESENTATION_OPEN_START_SCALE = OVERLAY_PRESENTATION_CONSTANTS.OPEN_START_SCALE;
const OVERLAY_PRESENTATION_DURATION_SECONDS = OVERLAY_PRESENTATION_CONSTANTS.DURATION_SECONDS;
const OVERLAY_PRESENTATION_CLOSE_END_SCALE = OVERLAY_PRESENTATION_CONSTANTS.CLOSE_END_SCALE;

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
    #presentationAnimationToken;
    #openPresentation;
    #connectedOpenFocusActivated;
    #awaitingOpenFocus;

    /**
     * @param {object} [options={}] - overlay 옵션입니다.
     * @param {number} [options.layer=0] - overlay 정렬 레이어입니다.
     * @param {number} [options.dim=0.32] - overlay dim 강도입니다.
     * @param {boolean} [options.transparent=true] - transparent 사용 여부입니다.
     * @param {boolean} [options.glOverlay=false] - WebGL surface 요청 여부입니다.
     * @param {string} [options.blurUpdateMode='dirty'] - blur 갱신 정책입니다.
     * @param {object} [options.effects={}] - effect registry 옵션입니다.
     */
    constructor(options = {}) {
        this.overlayOptions = {
            layer: Math.max(0, options.layer || 0),
            dim: clampNumber(options.dim === undefined ? 0.32 : options.dim, 0, 1),
            transparent: options.transparent !== false,
            glOverlay: options.glOverlay === true,
            blurUpdateMode: options.blurUpdateMode || 'dirty',
            effects: options.effects || {}
        };

        this.layer = 'ui';
        this.session = null;
        this.alpha = 0;
        this.dimAlpha = 0;
        this.contentScale = OVERLAY_PRESENTATION_OPEN_START_SCALE;
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
        this.#presentationAnimationToken = 0;
        this.#openPresentation = null;
        this.#connectedOpenFocusActivated = false;
        this.#awaitingOpenFocus = false;
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
        this._connectedPresentationRectScratch = { x: 0, y: 0, w: 0, h: 0, radius: 0 };
        this._connectedContentTransformScratch = {
            originXRatio: 0.5,
            originYRatio: 0.5,
            translateXRatio: 0,
            translateYRatio: 0,
            scaleX: 1,
            scaleY: 1,
            rotateY: 0,
            perspectiveRatio: 1
        };
        this._panelInteractionUpdateOptions = {
            overlay: this,
            session: null,
            layer: this.layer,
            alpha: 0,
            panelRegions: this.panelRegions,
            panelInteractionMap: this.#panelInteractionMap
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
            effectTextureCanvas: null
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
            lineWidth: 0
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
     * 카드에서 이어지는 오픈 프레젠테이션을 설정합니다.
     * @param {object|null} presentation - 공유 연결 프레젠테이션 상태입니다.
     */
    setOpenPresentation(presentation) {
        this.#openPresentation = isOverlayConnectedPresentation(presentation)
            ? presentation
            : null;
        this.#connectedOpenFocusActivated = false;
        this.#awaitingOpenFocus = false;
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
        if (!this.#hasConnectedOpenPresentation()) {
            setMouseFocus(this.layer);
        }
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
        if (this.#hasConnectedOpenPresentation() && this.#openPresentation.ready) {
            this.#stopPresentationAnimations();
            this.#setPresentationState(0, 0, 1);
            this.session?.clearContentTransform?.();
            return;
        }

        if (this.#openPresentation) {
            cancelOverlayConnectedPresentation(this.#openPresentation);
            this.session?.clearContentTransform?.();
            this.#openPresentation = null;
            this.#awaitingOpenFocus = true;
            this.#activateOpenFocusWhenAvailable();
        }

        this.#animatePresentation({
            alphaStart: 0,
            alphaEnd: 1,
            dimStart: 0,
            dimEnd: 1,
            scaleStart: OVERLAY_PRESENTATION_OPEN_START_SCALE,
            scaleEnd: 1,
            easingType: 'easeOutExpo',
            duration: OVERLAY_PRESENTATION_DURATION_SECONDS
        });
    }

    /**
     * overlay를 닫습니다.
     */
    close() {
        this.#cancelConnectedOpenPresentation();
        this.#animatePresentation({
            alphaStart: this.alpha,
            alphaEnd: 0,
            dimStart: this.dimAlpha,
            dimEnd: 0,
            scaleStart: this.contentScale,
            scaleEnd: OVERLAY_PRESENTATION_CLOSE_END_SCALE,
            easingType: 'easeInExpo',
            duration: OVERLAY_PRESENTATION_DURATION_SECONDS,
            onComplete: () => {
                setMouseFocus(this.previousFocus || ['ui', 'object']);
                if (typeof this.onCloseComplete === 'function') {
                    this.onCloseComplete();
                }
                if (typeof this.closeHandler === 'function') {
                    this.closeHandler(this);
                }
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
     */
    #setPresentationState(alpha, dimAlpha, contentScale) {
        this.alpha = alpha;
        this.dimAlpha = dimAlpha;
        this.contentScale = contentScale;
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
    }

    /**
     * @private
     * 프레젠테이션 애니메이션 식별자를 초기화합니다.
     */
    #clearPresentationAnimationIds() {
        this.#alphaAnimId = -1;
        this.#dimAnimId = -1;
        this.#scaleAnimId = -1;
    }

    /**
     * @private
     * overlay 진입/종료 프레젠테이션을 애니메이션합니다.
     * @param {object} options - 애니메이션 옵션입니다.
     * @param {number} options.alphaStart - 콘텐츠 알파 시작값입니다.
     * @param {number} options.alphaEnd - 콘텐츠 알파 종료값입니다.
     * @param {number} options.dimStart - dim 알파 시작값입니다.
     * @param {number} options.dimEnd - dim 알파 종료값입니다.
     * @param {number} options.scaleStart - 콘텐츠 배율 시작값입니다.
     * @param {number} options.scaleEnd - 콘텐츠 배율 종료값입니다.
     * @param {string} options.easingType - 애니메이션 easing 타입입니다.
     * @param {number} options.duration - 애니메이션 시간입니다.
     * @param {Function} [options.onComplete] - 완료 콜백입니다.
     */
    #animatePresentation(options) {
        this.#stopPresentationAnimations();
        this.#setPresentationState(options.alphaStart, options.dimStart, options.scaleStart);
        const presentationAnimationToken = this.#presentationAnimationToken;

        const alphaAnimation = animate(this, {
            variable: 'alpha',
            startValue: options.alphaStart,
            endValue: options.alphaEnd,
            type: options.easingType,
            duration: options.duration
        });
        const dimAnimation = animate(this, {
            variable: 'dimAlpha',
            startValue: options.dimStart,
            endValue: options.dimEnd,
            type: options.easingType,
            duration: options.duration
        });
        const scaleAnimation = animate(this, {
            variable: 'contentScale',
            startValue: options.scaleStart,
            endValue: options.scaleEnd,
            type: options.easingType,
            duration: options.duration
        });

        this.#alphaAnimId = alphaAnimation.id;
        this.#dimAnimId = dimAnimation.id;
        this.#scaleAnimId = scaleAnimation.id;

        Promise.all([
            alphaAnimation.promise,
            dimAnimation.promise,
            scaleAnimation.promise
        ]).then(() => {
            if (presentationAnimationToken !== this.#presentationAnimationToken) {
                return;
            }
            this.#clearPresentationAnimationIds();
            this.#setPresentationState(options.alphaEnd, options.dimEnd, options.scaleEnd);
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
        this.#syncConnectedOpenTarget();
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
        this.#syncConnectedOpenPresentation(true);
        if (this.session) {
            const sessionStart = beginPerformanceSection();
            this.session.updateEffects();
            this.#syncPresentationToSession();
            endPerformanceSection(sections.updateSession, sessionStart);
        }

        const interactionStart = beginPerformanceSection();
        this.#updatePanelInteractions();
        endPerformanceSection(sections.updateInteractions, interactionStart);

        if (this.dynamicItems) {
            const dynamicStart = beginPerformanceSection();
            for (const entry of this.dynamicItems) {
                const item = entry.item;
                if (item.update) {
                    item.update();
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
        this.#syncConnectedOpenPresentation(false);
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
        this._releaseElements();
        this.#panelInteractionMap.clear();
        this.#cancelConnectedOpenPresentation();
        this.#stopPresentationAnimations();
    }

    /**
     * 카드 연결 오픈 프레젠테이션이 활성 상태인지 반환합니다.
     * @returns {boolean} 연결 프레젠테이션 활성 여부입니다.
     * @private
     */
    #hasConnectedOpenPresentation() {
        return isOverlayConnectedPresentation(this.#openPresentation)
            && !this.#openPresentation.cancelled;
    }

    /**
     * 현재 overlay geometry를 연결 전환의 목표 영역에 동기화합니다.
     * @private
     */
    #syncConnectedOpenTarget() {
        if (!this.#hasConnectedOpenPresentation()) {
            return;
        }

        const rootPanel = this.getPanelRegion(DEFAULT_OVERLAY_PANEL_ID);
        setOverlayConnectedPresentationTarget(this.#openPresentation, rootPanel || {
            x: this.scaledX,
            y: this.scaledY,
            w: this.scaledW,
            h: this.scaledH,
            radius: 0
        });
    }

    /**
     * 공유 진행률을 실제 overlay surface의 후반부 3D 변환에 반영합니다.
     * @param {boolean} activateFocus - 완료 시 overlay 입력 포커스를 활성화할지 여부입니다.
     * @private
     */
    #syncConnectedOpenPresentation(activateFocus) {
        if (activateFocus && this.#awaitingOpenFocus) {
            const activated = this.#activateOpenFocusWhenAvailable();
            if (activated && this.#openPresentation?.completed) {
                this.#openPresentation = null;
            }
        }

        if (this.#openPresentation?.cancelled) {
            if (activateFocus) {
                this.session?.clearContentTransform?.();
                this.#openPresentation = null;
                this.#connectedOpenFocusActivated = false;
                this.#awaitingOpenFocus = true;
                this.open();
                this.#activateOpenFocusWhenAvailable();
            }
            return;
        }

        if (!this.#hasConnectedOpenPresentation()
            || !this.session
            || !this.#openPresentation.ready) {
            return;
        }

        const presentation = this.#openPresentation;
        if (presentation.progress < presentation.switchProgress) {
            this.#setPresentationState(0, 0, 1);
            this.session.clearContentTransform?.();
            return;
        }

        this.#setPresentationState(1, 1, 1);
        if (presentation.completed) {
            this.session.clearContentTransform?.();
            this.#awaitingOpenFocus = true;
            if (activateFocus && this.#activateOpenFocusWhenAvailable()) {
                this.#openPresentation = null;
            }
            return;
        }

        const currentRect = getOverlayConnectedPresentationRect(
            presentation,
            this._connectedPresentationRectScratch
        );
        const targetRect = presentation.targetRect;
        if (!currentRect || !targetRect || targetRect.w <= 0 || targetRect.h <= 0) {
            return;
        }

        const targetCenterX = targetRect.x + (targetRect.w * 0.5);
        const targetCenterY = targetRect.y + (targetRect.h * 0.5);
        const currentCenterX = currentRect.x + (currentRect.w * 0.5);
        const currentCenterY = currentRect.y + (currentRect.h * 0.5);
        const transform = this._connectedContentTransformScratch;
        transform.originXRatio = targetCenterX / Math.max(1, this.WW);
        transform.originYRatio = targetCenterY / Math.max(1, this.WH);
        transform.translateXRatio = (currentCenterX - targetCenterX) / Math.max(1, this.WW);
        transform.translateYRatio = (currentCenterY - targetCenterY) / Math.max(1, this.WH);
        transform.scaleX = currentRect.w / targetRect.w;
        transform.scaleY = currentRect.h / targetRect.h;
        transform.rotateY = getOverlayConnectedPresentationBackRotationY(presentation);
        transform.perspectiveRatio = presentation.perspective / Math.max(1, this.WW);
        this.session.setContentTransform?.(transform, false);
    }

    /**
     * 진행 중인 카드 연결 오픈 상태를 취소하고 surface 변환을 복원합니다.
     * @private
     */
    #cancelConnectedOpenPresentation() {
        this.#awaitingOpenFocus = false;
        this.#connectedOpenFocusActivated = false;
        if (!this.#openPresentation) {
            return;
        }
        cancelOverlayConnectedPresentation(this.#openPresentation);
        this.session?.clearContentTransform?.();
        this.#openPresentation = null;
    }

    /**
     * 연결 오픈이 완료된 뒤 기존 포커스가 그대로일 때만 overlay 포커스를 활성화합니다.
     * @returns {boolean} 이번 호출에서 포커스가 활성화되었는지 여부입니다.
     * @private
     */
    #activateOpenFocusWhenAvailable() {
        if (!this.#awaitingOpenFocus || this.#connectedOpenFocusActivated) {
            return false;
        }

        const currentFocus = getMouseFocus();
        if (Array.isArray(currentFocus) && currentFocus.includes(this.layer)) {
            this.#connectedOpenFocusActivated = true;
            this.#awaitingOpenFocus = false;
            return true;
        }

        const previousFocus = this.previousFocus;
        const matchesPreviousFocus = Array.isArray(currentFocus)
            && Array.isArray(previousFocus)
            && currentFocus.length === previousFocus.length
            && currentFocus.every((focus, index) => focus === previousFocus[index]);
        if (!matchesPreviousFocus) {
            return false;
        }

        setMouseFocus(this.layer);
        this.#connectedOpenFocusActivated = true;
        this.#awaitingOpenFocus = false;
        return true;
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
     * @private
     * overlay 크기와 중심 좌표를 계산합니다.
     */
    _calculateGeometry() {
        this.scaledW = this.width * this.uiScale;
        this.scaledH = this.height * this.uiScale;
        this.scaledX = ((this.WW - this.scaledW) * 0.5) + this.dx;
        this.scaledY = ((this.WH - this.scaledH) * 0.5) + this.dy;
        this.#rebuildPanelRegions();
    }

    /**
     * @private
     * 화면 크기 변경 시 overlay 크기를 재정의합니다.
     */
    _onResize() {
    }

    /**
     * @private
     * 레이아웃을 생성합니다.
     */
    _generateLayout() {
    }

    /**
     * overlay 패널 정의를 반환합니다.
     * @returns {OverlayPanelDefinition[]} 패널 정의 목록입니다.
     */
    _getPanelDefinitions() {
        return [{ id: DEFAULT_OVERLAY_PANEL_ID }];
    }

    /**
     * 패널 뒤에 추가 장식을 그릴 때 사용하는 훅입니다.
     */
    _drawOverlayDecorations() {
    }

    /**
     * overlay 닫기 직후 호출되는 훅입니다.
     */
    onCloseComplete() {
    }

    /**
     * 런타임 설정 변경을 overlay에 반영합니다. (오버라이드 선택)
     * @param {object} [changedSettings={}] - 변경된 설정 키와 값입니다.
     */
    applyRuntimeSettings(changedSettings = {}) {
        let shouldResize = false;

        if (changedSettings.uiScale !== undefined) {
            this.uiScale = getSetting('uiScale') / 100 || 1;
            this.positioningHandler = new PositioningHandler(this, this.uiScale);
            shouldResize = true;
        }

        if (changedSettings.disableTransparency !== undefined
            && this.session
            && typeof this.session.setDisableTransparency === 'function') {
            this.session.setDisableTransparency(getSetting('disableTransparency'));
            shouldResize = true;
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
        const disableTransparency = getSetting('disableTransparency');
        const defaultFill = disableTransparency
            ? ColorSchemes.Overlay.Panel.Background
            : ColorSchemes.Overlay.Panel.GlassBackground;
        const defaultStroke = disableTransparency
            ? ColorSchemes.Overlay.Panel.Border || ColorSchemes.Overlay.Panel.Background
            : (ColorSchemes.Overlay.Panel.GlassBorder || false);
        const defaultTintColor = ColorSchemes.Overlay.Panel.GlassTint;
        const defaultEdgeColor = ColorSchemes.Overlay.Panel.GlassEdge;
        const defaultTintStrength = ColorSchemes.Overlay.Panel.GlassTintStrength;
        const defaultEdgeStrength = ColorSchemes.Overlay.Panel.GlassEdgeStrength;

        for (const panel of this.panelRegions) {
            if (!panel.visible || panel.w <= 0 || panel.h <= 0) {
                continue;
            }

            const presentedPanel = getOverlayPresentedPanelRegion(panel, this);
            const interactionState = this.#panelInteractionMap.get(panel.id);
            let effectTextureCanvas = null;
            if (interactionState) {
                const effectStart = beginPerformanceSection();
                effectTextureCanvas = this.#buildPanelEffectCanvas(presentedPanel, interactionState);
                endPerformanceSection(sections.drawPanelEffectCanvas, effectStart);
            }
            const usesEffectPipeline = Boolean(this.session.effectLayerId)
                && (this.session.effectiveTransparent
                    || effectTextureCanvas
                    || (interactionState && (Math.abs(interactionState.rotateX) > 0.0001 || Math.abs(interactionState.rotateY) > 0.0001)));

            if (usesEffectPipeline) {
                const glassOptions = this._glassPanelRenderOptions;
                glassOptions.x = presentedPanel.x;
                glassOptions.y = presentedPanel.y;
                glassOptions.w = presentedPanel.w;
                glassOptions.h = presentedPanel.h;
                glassOptions.radius = presentedPanel.radius;
                glassOptions.blur = panel.blur;
                glassOptions.fill = panel.fill === undefined ? defaultFill : panel.fill;
                glassOptions.stroke = panel.stroke === undefined ? defaultStroke : panel.stroke;
                glassOptions.lineWidth = presentedPanel.lineWidth;
                glassOptions.tintColor = panel.tintColor === undefined ? defaultTintColor : panel.tintColor;
                glassOptions.edgeColor = panel.edgeColor === undefined ? defaultEdgeColor : panel.edgeColor;
                glassOptions.tintStrength = panel.tintStrength === undefined ? defaultTintStrength : panel.tintStrength;
                glassOptions.edgeStrength = panel.edgeStrength === undefined ? defaultEdgeStrength : panel.edgeStrength;
                glassOptions.refractionStrength = panel.refractionStrength;
                glassOptions.transformMatrix = interactionState?.transformMatrix;
                glassOptions.perspective = interactionState?.perspective;
                glassOptions.effectTextureCanvas = effectTextureCanvas;
                const glassStart = beginPerformanceSection();
                this.session.renderGlassPanel(glassOptions);
                endPerformanceSection(sections.drawGlassPanel, glassStart);
                continue;
            }

            const flatOptions = this._flatPanelRenderOptions;
            flatOptions.x = presentedPanel.x;
            flatOptions.y = presentedPanel.y;
            flatOptions.w = presentedPanel.w;
            flatOptions.h = presentedPanel.h;
            flatOptions.radius = presentedPanel.radius;
            flatOptions.fill = panel.fill === undefined ? defaultFill : panel.fill;
            flatOptions.stroke = panel.stroke === undefined ? defaultStroke : panel.stroke;
            flatOptions.lineWidth = presentedPanel.lineWidth;
            const flatStart = beginPerformanceSection();
            shadowOn(this.layer, presentedPanel.shadowBlur, panel.shadowColor);
            this.session.renderPanel(flatOptions);
            shadowOff(this.layer);
            endPerformanceSection(sections.drawFlatPanel, flatStart);
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
