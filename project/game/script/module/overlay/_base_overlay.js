import { animate, remove } from 'animation/animation_system.js';
import { measurePerformanceSection } from 'debug/debug_system.js';
import { getWH, getUIWW, getWW, render, shadowOff, shadowOn } from 'display/display_system.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { getMouseFocus, getMouseInput, hasMouseState, setMouseFocus } from 'input/input_system.js';
import { releaseUIItem } from 'ui/_ui_pool.js';
import { PositioningHandler } from 'ui/layout/_positioning_handler.js';
import { getSetting } from 'save/save_system.js';
import { getDelta } from 'game/time_handler.js';
import {
    createRectToQuadHomography,
    createTiltMatrix,
    getDeltaLerpFactor,
    invertMat3,
    isPointInsideQuad,
    isPointInsideRoundedRect,
    lerpNumber,
    mapScreenPointToPanelLocal,
    projectPanelQuad
} from './_panel_effect_math.js';
import {
    DEFAULT_OVERLAY_PANEL_ID,
    createOverlayPanelMap,
    getOverlayPresentationOrigin,
    getOverlayPresentedPanelRegion,
    resolveOverlayPanelRegion
} from './overlay_panel_region.js';
import { syncOverlayPanelInteractionStates } from './overlay_panel_interaction_state.js';
import { buildOverlayPanelEffectCanvas } from './overlay_panel_effect_canvas.js';

const OVERLAY_PRESENTATION_OPEN_START_SCALE = 1.1;
const OVERLAY_PRESENTATION_DURATION_SECONDS = 0.4;
const OVERLAY_PRESENTATION_CLOSE_END_SCALE = 0.85;

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
            dim: Math.max(0, Math.min(1, options.dim === undefined ? 0.32 : options.dim)),
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
        return `overlay.${this.constructor?.name || 'Overlay'}`;
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

        const presentationOrigin = getOverlayPresentationOrigin(this);
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
        const performanceSectionPrefix = this._getPerformanceSectionPrefix();
        measurePerformanceSection(`${performanceSectionPrefix}.update.total`, () => {
            if (this.session) {
                measurePerformanceSection(`${performanceSectionPrefix}.update.session`, () => {
                    this.session.updateEffects();
                    this.#syncPresentationToSession();
                });
            }

            measurePerformanceSection(`${performanceSectionPrefix}.update.interactions`, () => {
                this.#updatePanelInteractions();
            });

            if (!this.dynamicItems) {
                return;
            }

            measurePerformanceSection(`${performanceSectionPrefix}.update.dynamicItems`, () => {
                for (const entry of this.dynamicItems) {
                    const item = entry.item;
                    if (item.update) {
                        item.update();
                    }
                }
            });
        });
    }

    /**
     * overlay를 그립니다.
     */
    draw() {
        const performanceSectionPrefix = this._getPerformanceSectionPrefix();
        measurePerformanceSection(`${performanceSectionPrefix}.draw.total`, () => {
            if (!this.session || (this.alpha <= 0 && this.dimAlpha <= 0)) {
                return;
            }

            measurePerformanceSection(`${performanceSectionPrefix}.draw.dim`, () => {
                this.session.renderDim();
            });
            if (this.alpha <= 0) {
                return;
            }

            measurePerformanceSection(`${performanceSectionPrefix}.draw.panels`, () => {
                this.#drawPanels(performanceSectionPrefix);
            });
            measurePerformanceSection(`${performanceSectionPrefix}.draw.decorations`, () => {
                this._drawOverlayDecorations();
            });

            if (this.staticItems) {
                measurePerformanceSection(`${performanceSectionPrefix}.draw.staticItems`, () => {
                    for (const entry of this.staticItems) {
                        render(this.layer, entry.item);
                    }
                });
            }

            if (!this.dynamicItems) {
                return;
            }

            const floatingItems = [];
            measurePerformanceSection(`${performanceSectionPrefix}.draw.dynamicItems`, () => {
                for (const entry of this.dynamicItems) {
                    const item = entry.item;
                    if (item.draw) {
                        item.draw();
                    }
                    if (typeof item.drawFloating === 'function') {
                        floatingItems.push(item);
                    }
                }
            });

            if (floatingItems.length > 0) {
                measurePerformanceSection(`${performanceSectionPrefix}.draw.floatingItems`, () => {
                    for (const item of floatingItems) {
                        item.drawFloating();
                    }
                });
            }
        });
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
        if (!this.session || this.panelRegions.length === 0) {
            return;
        }

        const delta = getDelta();
        const mouseX = getMouseInput('x');
        const mouseY = getMouseInput('y');
        const leftClicked = hasMouseState('left', 'clicked');
        const hasLayerFocus = getMouseFocus().includes(this.layer);
        const tiltOptions = this.session.getEffectOptions('hoverTilt');
        const spotlightOptions = this.session.getEffectOptions('hoverSpotlight');
        const rippleOptions = this.session.getEffectOptions('clickRipple');
        const particleOptions = this.session.getEffectOptions('hoverParticle');
        const borderOptions = this.session.getEffectOptions('hoverBorder');

        for (const panel of this.panelRegions) {
            const interactionState = this.#panelInteractionMap.get(panel.id);
            if (!interactionState) {
                continue;
            }

            const presentedPanel = getOverlayPresentedPanelRegion(panel, this);
            const isInteractive = Boolean(panel.onClick || tiltOptions || spotlightOptions || rippleOptions || particleOptions || borderOptions);
            if (!presentedPanel.visible || presentedPanel.w <= 0 || presentedPanel.h <= 0 || !isInteractive || this.alpha <= 0) {
                this.#resetPanelInteractionTargets(
                    presentedPanel,
                    interactionState,
                    delta,
                    tiltOptions,
                    spotlightOptions,
                    particleOptions,
                    borderOptions
                );
                continue;
            }

            this.#updatePanelProjection(presentedPanel, interactionState, tiltOptions);

            const pointerInfo = hasLayerFocus
                ? this.#resolvePanelPointerInfo(presentedPanel, interactionState, mouseX, mouseY)
                : null;

            interactionState.hovered = pointerInfo?.hovered === true;
            if (interactionState.hovered && pointerInfo?.localPoint) {
                interactionState.localX = pointerInfo.localPoint.x;
                interactionState.localY = pointerInfo.localPoint.y;
                interactionState.normalizedX = Math.max(-1, Math.min(1, ((interactionState.localX / Math.max(1, presentedPanel.w)) * 2) - 1));
                interactionState.normalizedY = Math.max(-1, Math.min(1, ((interactionState.localY / Math.max(1, presentedPanel.h)) * 2) - 1));
            }

            if (leftClicked && interactionState.hovered) {
                this.#handlePanelClick(presentedPanel, interactionState, rippleOptions);
            }

            this.#updateTiltState(presentedPanel, interactionState, tiltOptions, delta);
            this.#updatePanelProjection(presentedPanel, interactionState, tiltOptions);
            this.#updateSpotlightState(interactionState, spotlightOptions, delta);
            this.#updateBorderState(interactionState, borderOptions, delta);
            this.#updateParticleState(presentedPanel, interactionState, particleOptions, delta);
            this.#updateRippleState(interactionState, delta);
            interactionState.wasHovered = interactionState.hovered;
        }
    }

    /**
     * @private
     * 패널 hover/click 상태가 비활성일 때 effect 상태를 원점으로 복귀시킵니다.
     * @param {object} panel - 대상 패널입니다.
     * @param {object} interactionState - 패널 interaction 상태입니다.
     * @param {number} delta - 프레임 델타입니다.
     * @param {object|null} tiltOptions - tilt 옵션입니다.
     * @param {object|null} spotlightOptions - spotlight 옵션입니다.
     * @param {object|null} particleOptions - particle 옵션입니다.
     */
    #resetPanelInteractionTargets(panel, interactionState, delta, tiltOptions, spotlightOptions, particleOptions, borderOptions) {
        interactionState.hovered = false;
        this.#updateTiltState(panel, interactionState, tiltOptions, delta);
        this.#updatePanelProjection(panel, interactionState, tiltOptions);
        this.#updateSpotlightState(interactionState, spotlightOptions, delta);
        this.#updateBorderState(interactionState, borderOptions, delta);
        this.#updateParticleState(panel, interactionState, particleOptions, delta);
        this.#updateRippleState(interactionState, delta);
        interactionState.wasHovered = false;
    }

    /**
     * @private
     * 현재 패널의 투영 사각형과 역호모그래피를 계산합니다.
     * @param {object} panel - 대상 패널입니다.
     * @param {object} interactionState - 패널 interaction 상태입니다.
     * @param {object|null} tiltOptions - tilt 옵션입니다.
     */
    #updatePanelProjection(panel, interactionState, tiltOptions) {
        interactionState.perspective = tiltOptions?.perspective || 1000;
        interactionState.transformMatrix = createTiltMatrix(interactionState.rotateX, interactionState.rotateY);
        interactionState.projectedQuad = projectPanelQuad(panel, interactionState.transformMatrix, interactionState.perspective);
        const homography = createRectToQuadHomography(panel.w, panel.h, interactionState.projectedQuad);
        interactionState.inverseHomography = homography ? invertMat3(homography) : null;
    }

    /**
     * @private
     * 화면 좌표가 패널 내부인지 판정하고 로컬 좌표를 계산합니다.
     * @param {object} panel - 대상 패널입니다.
     * @param {object} interactionState - 패널 interaction 상태입니다.
     * @param {number} mouseX - 현재 마우스 X 좌표입니다.
     * @param {number} mouseY - 현재 마우스 Y 좌표입니다.
     * @returns {{hovered: boolean, localPoint: {x:number, y:number}|null}} 판정 결과입니다.
     */
    #resolvePanelPointerInfo(panel, interactionState, mouseX, mouseY) {
        if (!Number.isFinite(mouseX) || !Number.isFinite(mouseY)) {
            return { hovered: false, localPoint: null };
        }

        const projectedQuad = interactionState.projectedQuad;
        if (!isPointInsideQuad(mouseX, mouseY, projectedQuad)) {
            return { hovered: false, localPoint: null };
        }

        const localPoint = mapScreenPointToPanelLocal(mouseX, mouseY, interactionState.inverseHomography)
            || { x: mouseX - panel.x, y: mouseY - panel.y };
        const hovered = isPointInsideRoundedRect(localPoint.x, localPoint.y, panel.w, panel.h, panel.radius);

        return {
            hovered,
            localPoint
        };
    }

    /**
     * @private
     * tilt effect 상태를 갱신합니다.
     * @param {object} panel - 대상 패널입니다.
     * @param {object} interactionState - 패널 interaction 상태입니다.
     * @param {object|null} tiltOptions - tilt 옵션입니다.
     * @param {number} delta - 프레임 델타입니다.
     */
    #updateTiltState(panel, interactionState, tiltOptions, delta) {
        if (!tiltOptions) {
            interactionState.rotateX = 0;
            interactionState.rotateY = 0;
            interactionState.targetRotateX = 0;
            interactionState.targetRotateY = 0;
            return;
        }

        const maxAngle = (tiltOptions.maxAngleDeg * Math.PI) / 180;
        interactionState.targetRotateX = interactionState.hovered ? (-interactionState.normalizedY * maxAngle) : 0;
        interactionState.targetRotateY = interactionState.hovered ? (interactionState.normalizedX * maxAngle) : 0;

        const lerpFactor = getDeltaLerpFactor(tiltOptions.smoothing, delta);
        interactionState.rotateX = lerpNumber(interactionState.rotateX, interactionState.targetRotateX, lerpFactor);
        interactionState.rotateY = lerpNumber(interactionState.rotateY, interactionState.targetRotateY, lerpFactor);

        if (!interactionState.hovered && Math.abs(interactionState.rotateX) < 0.0001 && Math.abs(interactionState.rotateY) < 0.0001) {
            interactionState.rotateX = 0;
            interactionState.rotateY = 0;
        }
    }

    /**
     * @private
     * spotlight fade 값을 갱신합니다.
     * @param {object} interactionState - 패널 interaction 상태입니다.
     * @param {object|null} spotlightOptions - spotlight 옵션입니다.
     * @param {number} delta - 프레임 델타입니다.
     */
    #updateSpotlightState(interactionState, spotlightOptions, delta) {
        if (!spotlightOptions) {
            interactionState.spotlightAlpha = 0;
            return;
        }

        const lerpFactor = getDeltaLerpFactor(spotlightOptions.smoothing, delta);
        interactionState.spotlightAlpha = lerpNumber(
            interactionState.spotlightAlpha,
            interactionState.hovered ? spotlightOptions.opacity : 0,
            lerpFactor
        );
    }

    /**
     * hover border fade 값을 갱신합니다.
     * @param {object} interactionState - 패널 interaction 상태입니다.
     * @param {object|null} borderOptions - hoverBorder 옵션입니다.
     * @param {number} delta - 프레임 델타입니다.
     */
    #updateBorderState(interactionState, borderOptions, delta) {
        if (!borderOptions) {
            interactionState.borderAlpha = 0;
            return;
        }

        interactionState.borderAlpha = lerpNumber(
            interactionState.borderAlpha,
            interactionState.hovered ? borderOptions.opacity : 0,
            getDeltaLerpFactor(borderOptions.smoothing, delta)
        );
    }

    /**
     * @private
     * hover particle 상태를 갱신합니다.
     * @param {object} panel - 대상 패널입니다.
     * @param {object} interactionState - 패널 interaction 상태입니다.
     * @param {object|null} particleOptions - particle 옵션입니다.
     * @param {number} delta - 프레임 델타입니다.
     */
    #updateParticleState(panel, interactionState, particleOptions, delta) {
        if (!particleOptions) {
            interactionState.particles = [];
            interactionState.particleAlpha = 0;
            return;
        }

        if (!interactionState.wasHovered && interactionState.hovered) {
            interactionState.hoverElapsed = 0;
            interactionState.particles = this.#createPanelParticles(panel, particleOptions);
        }

        if (interactionState.hovered) {
            interactionState.hoverElapsed += delta;
        }

        interactionState.particleAlpha = lerpNumber(
            interactionState.particleAlpha,
            interactionState.hovered ? 1 : 0,
            getDeltaLerpFactor(0.22, delta)
        );

        if (!interactionState.hovered && interactionState.particleAlpha <= 0.01) {
            interactionState.particles = [];
            return;
        }

        for (const particle of interactionState.particles) {
            particle.elapsed += delta;
            if (particle.elapsed < particle.spawnDelay) {
                particle.visible = false;
                continue;
            }

            particle.visible = true;
            const cycleTime = particle.elapsed - particle.spawnDelay;
            const travelProgress = 0.5 - (0.5 * Math.cos((cycleTime / particle.duration) * Math.PI));
            particle.currentX = lerpNumber(particle.originX, particle.targetX, travelProgress);
            particle.currentY = lerpNumber(particle.originY, particle.targetY, travelProgress);
            particle.scale = Math.min(1, cycleTime / 0.3);
            particle.opacity = (0.65 + (0.35 * Math.sin((cycleTime / 1.5) * Math.PI))) * interactionState.particleAlpha;

            if (cycleTime >= particle.duration) {
                this.#resetPanelParticle(particle, panel, particleOptions);
            }
        }
    }

    /**
     * @private
     * click ripple 상태를 갱신합니다.
     * @param {object} interactionState - 패널 interaction 상태입니다.
     * @param {number} delta - 프레임 델타입니다.
     */
    #updateRippleState(interactionState, delta) {
        interactionState.ripples = interactionState.ripples.filter((ripple) => {
            ripple.elapsed += delta;
            return ripple.elapsed < ripple.duration;
        });
    }

    /**
     * @private
     * 패널 클릭을 처리하고 ripple/onClick을 실행합니다.
     * @param {object} panel - 대상 패널입니다.
     * @param {object} interactionState - 패널 interaction 상태입니다.
     * @param {object|null} rippleOptions - ripple 옵션입니다.
     */
    #handlePanelClick(panel, interactionState, rippleOptions) {
        if (rippleOptions) {
            interactionState.ripples.push({
                x: interactionState.localX,
                y: interactionState.localY,
                maxDistance: Math.max(
                    Math.hypot(interactionState.localX, interactionState.localY),
                    Math.hypot(interactionState.localX - panel.w, interactionState.localY),
                    Math.hypot(interactionState.localX, interactionState.localY - panel.h),
                    Math.hypot(interactionState.localX - panel.w, interactionState.localY - panel.h)
                ),
                elapsed: 0,
                duration: rippleOptions.duration
            });
        }

        if (typeof panel.onClick === 'function') {
            panel.onClick({
                panel,
                localX: interactionState.localX,
                localY: interactionState.localY,
                overlay: this
            });
        }
    }

    /**
     * @private
     * hover particle 기본 상태를 생성합니다.
     * @param {object} panel - 대상 패널입니다.
     * @param {object} particleOptions - particle 옵션입니다.
     * @returns {object[]} 생성된 particle 배열입니다.
     */
    #createPanelParticles(panel, particleOptions) {
        return Array.from({ length: particleOptions.count }, (_value, index) => {
            const particle = {
                elapsed: 0,
                opacity: 0,
                originX: 0,
                originY: 0,
                targetX: 0,
                targetY: 0,
                currentX: 0,
                currentY: 0,
                scale: 0,
                spawnDelay: index * particleOptions.spawnInterval,
                duration: particleOptions.minDuration,
                visible: false
            };
            this.#resetPanelParticle(particle, panel, particleOptions);
            particle.elapsed = 0;
            return particle;
        });
    }

    /**
     * @private
     * particle의 이동 경로를 재설정합니다.
     * @param {object} particle - 재설정할 particle입니다.
     * @param {object} panel - 대상 패널입니다.
     * @param {object} particleOptions - particle 옵션입니다.
     */
    #resetPanelParticle(particle, panel, particleOptions) {
        particle.originX = (Math.random() - 0.5) * panel.w;
        particle.originY = (Math.random() - 0.5) * panel.h;
        particle.targetX = particle.originX + ((Math.random() - 0.5) * particleOptions.driftDistance);
        particle.targetY = particle.originY + ((Math.random() - 0.5) * particleOptions.driftDistance);
        particle.currentX = particle.originX;
        particle.currentY = particle.originY;
        particle.duration = particleOptions.minDuration + (Math.random() * Math.max(0, particleOptions.maxDuration - particleOptions.minDuration));
        particle.elapsed = particle.spawnDelay;
    }

    /**
     * @private
     * 패널 effect를 그릴 오프스크린 캔버스를 생성하거나 재사용합니다.
     * @param {object} panel - 대상 패널입니다.
     * @param {object} interactionState - 패널 interaction 상태입니다.
     * @returns {HTMLCanvasElement|null} 그려진 effect 캔버스입니다.
     */
    #buildPanelEffectCanvas(panel, interactionState) {
        return buildOverlayPanelEffectCanvas(panel, interactionState, {
            spotlightOptions: this.session.getEffectOptions('hoverSpotlight'),
            particleOptions: this.session.getEffectOptions('hoverParticle'),
            rippleOptions: this.session.getEffectOptions('clickRipple'),
            borderOptions: this.session.getEffectOptions('hoverBorder')
        });
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
    #drawPanels(performanceSectionPrefix = this._getPerformanceSectionPrefix()) {
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
            const effectTextureCanvas = interactionState
                ? measurePerformanceSection(`${performanceSectionPrefix}.draw.panelEffectCanvas`, () => {
                    return this.#buildPanelEffectCanvas(presentedPanel, interactionState);
                })
                : null;
            const usesEffectPipeline = Boolean(this.session.effectLayerId)
                && (this.session.effectiveTransparent
                    || effectTextureCanvas
                    || (interactionState && (Math.abs(interactionState.rotateX) > 0.0001 || Math.abs(interactionState.rotateY) > 0.0001)));

            if (usesEffectPipeline) {
                measurePerformanceSection(`${performanceSectionPrefix}.draw.glassPanel`, () => {
                    this.session.renderGlassPanel({
                        x: presentedPanel.x,
                        y: presentedPanel.y,
                        w: presentedPanel.w,
                        h: presentedPanel.h,
                        radius: presentedPanel.radius,
                        blur: panel.blur,
                        fill: panel.fill === undefined ? defaultFill : panel.fill,
                        stroke: panel.stroke === undefined ? defaultStroke : panel.stroke,
                        lineWidth: presentedPanel.lineWidth,
                        tintColor: panel.tintColor === undefined ? defaultTintColor : panel.tintColor,
                        edgeColor: panel.edgeColor === undefined ? defaultEdgeColor : panel.edgeColor,
                        tintStrength: panel.tintStrength === undefined ? defaultTintStrength : panel.tintStrength,
                        edgeStrength: panel.edgeStrength === undefined ? defaultEdgeStrength : panel.edgeStrength,
                        refractionStrength: panel.refractionStrength,
                        transformMatrix: interactionState?.transformMatrix,
                        perspective: interactionState?.perspective,
                        effectTextureCanvas
                    });
                });
                continue;
            }

            measurePerformanceSection(`${performanceSectionPrefix}.draw.flatPanel`, () => {
                shadowOn(this.layer, presentedPanel.shadowBlur, panel.shadowColor);
                this.session.renderPanel({
                    shape: 'roundRect',
                    x: presentedPanel.x,
                    y: presentedPanel.y,
                    w: presentedPanel.w,
                    h: presentedPanel.h,
                    radius: presentedPanel.radius,
                    fill: panel.fill === undefined ? defaultFill : panel.fill,
                    stroke: panel.stroke === undefined ? defaultStroke : panel.stroke,
                    lineWidth: presentedPanel.lineWidth
                });
                shadowOff(this.layer);
            });
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
