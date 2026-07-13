import { getData } from 'data/data_handler.js';
import { SVGDrawer } from 'display/_svg_drawer.js';
import { getDisplaySystem, getUIOffsetX, getWH, getUIWW, getWW } from 'display/display_system.js';
import { getDelta } from 'game/time_handler.js';
import { consumeMouseState, getMouseInput, hasMouseState } from 'input/input_system.js';
import {
    advanceOverlayConnectedPresentation,
    cancelOverlayConnectedPresentation,
    createOverlayConnectedPresentation,
    getOverlayConnectedPresentationFrontContentRect,
    getOverlayConnectedPresentationRect,
    isOverlayConnectedPresentationFrontFace,
    setOverlayConnectedPresentationSource,
    setOverlayConnectedPresentationTarget
} from 'overlay/overlay_connected_presentation.js';
import { getSetting } from 'save/save_system.js';
import { getLangString, requestTooltip } from 'ui/ui_system.js';
import { TitleMenuCard } from './menu/_title_menu_card.js';
import { TitleMenuCardRegistry } from './menu/_title_menu_card_registry.js';
import { renderTitleMenuGlassPanel } from './menu/_title_menu_glass_panel_render.js';
import {
    loadTitleMenuIconSources,
    releaseTitleMenuIconSources
} from './menu/_title_menu_icon_lifecycle.js';
import {
    updateTitleMenuCardProjection,
    updateTitleMenuPaneInteractionState
} from './menu/_title_menu_interaction.js';
import {
    updateTitleMenuCardInteractionStates,
    updateTitleMenuUtilityTileInteractionStates
} from './menu/_title_menu_interaction_state.js';
import { TitleMenuLayout } from './menu/_title_menu_layout.js';
import { clampNumber } from './menu/_title_menu_motion.js';
import {
    createTitleMenuPaneRuntimeState,
    createTitleMenuRuntimeState
} from './menu/_title_menu_runtime_state.js';
import { buildTitleMenuRightPaneLayout } from './menu/_title_menu_pane_layout.js';
import {
    buildTitleMenuCardRenderState,
    buildTitleMenuPaneRenderState,
    buildTitleMenuUtilityTileRenderState,
    advanceTitleMenuCardRevealClock,
    getTitleMenuCardRevealConfig,
    getTitleMenuCardRevealCoreDuration,
    getTitleMenuRevealProgress,
    getTitleMenuUtilityPaneRevealEase
} from './menu/_title_menu_render_state.js';
import { createTitleMenuOverlaySession } from './menu/_title_menu_overlay_session.js';
import { TitleMenuTextureRenderer } from './menu/_title_menu_texture_renderer.js';
import { TitleMenuVersionLabelRenderer } from './menu/_title_menu_version_label_renderer.js';
import {
    createTitleMenuVersionHistoryLinkButton,
    releaseTitleMenuVersionHistoryLinkButton,
    updateTitleMenuVersionHistoryLinkButton
} from './menu/_title_menu_version_link.js';
import {
    getMenuBackdropPaneStyle,
    getMenuEffectColor,
    getMenuPanelStyle,
    getThemeAwareMenuBorderColor,
    getUnifiedOuterPaneStrokeColor
} from './menu/_title_menu_theme.js';
const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');
const GLOBAL_CONSTANTS = getData('GLOBAL_CONSTANTS');
const TITLE_MENU_DATA = getData('TITLE_MENU_DATA');
const TITLE_CARD_MENU = TITLE_CONSTANTS.TITLE_CARD_MENU;
const TITLE_MENU_CARD_REVEAL_ORDER = TITLE_MENU_DATA.CARD_REVEAL_ORDER;
const TITLE_MENU_SECONDARY_ENTRIES = TITLE_MENU_DATA.SECONDARY_ENTRIES;
const TITLE_MENU_CONNECTED_OPEN = TITLE_MENU_DATA.CONNECTED_OPEN;
const TEXT_CONSTANTS = getData('TEXT_CONSTANTS');

/**
 * @class TitleMenu
 * @description 타이틀 화면 우하단 카드 메뉴와 WebGL 카드 효과를 관리하는 클래스입니다.
 */
export class TitleMenu {
    /**
     * @param {TitleScene} titleScene - 타이틀 씬 인스턴스입니다.
     */
    constructor(titleScene) {
        this.TitleScene = titleScene;
        this.WW = getWW();
        this.WH = getWH();
        this.UIWW = getUIWW();
        this.UIOffsetX = getUIOffsetX();
        this.uiScale = this.#getCurrentUiScale();
        this.svgDrawer = new SVGDrawer();
        this.titleMenuIconSources = [];
        this.layout = new TitleMenuLayout(this.uiScale);
        this.cardRegistry = new TitleMenuCardRegistry();
        this.cards = [];
        this.cardStateMap = new Map();
        this.cardRenderMap = new Map();
        this.utilityTileStateMap = new Map();
        this.utilityTileRenderMap = new Map();
        this.pointerEnabled = false;
        this.cardRevealElapsed = 0;
        this.cardRevealStarted = false;
        this.currentPaneLayout = null;
        this.hoveredSecondaryMenuId = null;
        this.pendingActivation = null;
        this.connectedPresentationRect = { x: 0, y: 0, w: 0, h: 0, radius: 0 };
        this.connectedFrontContentRect = { x: 0, y: 0, w: 0, h: 0, radius: 0 };
        this.versionHistoryLinkButton = null;
        this.cardPaneInteractionState = createTitleMenuPaneRuntimeState();
        this.utilityPaneInteractionState = createTitleMenuPaneRuntimeState();
        this.secondaryMenuEntries = TITLE_MENU_SECONDARY_ENTRIES;
        this.session = this.#createSession();
        this.textureRenderer = new TitleMenuTextureRenderer({
            svgDrawer: this.svgDrawer,
            textConstants: TEXT_CONSTANTS,
            titleCardMenu: TITLE_CARD_MENU,
            getSession: () => this.session,
            getEffectColor: this.#getEffectColor.bind(this),
            getUIWW: () => this.UIWW,
            getWH: () => this.WH,
            getUiScale: () => this.uiScale
        });
        this.versionLabelRenderer = new TitleMenuVersionLabelRenderer({
            globalConstants: GLOBAL_CONSTANTS,
            textConstants: TEXT_CONSTANTS
        });
        this.versionHistoryLinkButton = createTitleMenuVersionHistoryLinkButton(this.TitleScene);

        this.#createCards();
        this.#createUtilityTileStates();
        this.#preloadMenuIcons();
        this.#syncLayout();
    }

    /**
     * 카드 메뉴 상태를 갱신합니다.
     */
    update() {
        const delta = getDelta();
        const transitionProgress = this.#getSceneTransitionProgress();
        const revealFinished = this.#updateCardRevealClock(delta, transitionProgress);

        this.pointerEnabled = transitionProgress >= 0.98
            && revealFinished
            && !this.#hasBlockingOverlay()
            && !this.pendingActivation;

        this.#updateRenderStates(transitionProgress);
        const paneLayout = this.currentPaneLayout || this.#getRightPaneLayout();
        this.#updateCardInteractions(delta);
        this.#updateConnectedActivation(delta);
        this.#updateOuterPaneInteractions(delta, paneLayout);
        this.#updateVersionHistoryLinkButton(paneLayout);
    }

    /**
     * 카드 메뉴를 그립니다.
     */
    draw() {
        if (!this.session) {
            return;
        }

        getDisplaySystem()?.webGLHandler?.flushAll();
        const paneLayout = this.currentPaneLayout || this.#getRightPaneLayout();
        const paneRenderState = buildTitleMenuPaneRenderState({
            paneLayout,
            uiww: this.UIWW,
            uiScale: this.uiScale,
            revealCoreDuration: getTitleMenuCardRevealCoreDuration(TITLE_CARD_MENU),
            getRevealProgress: this.#getRevealProgress.bind(this)
        });
        const cardPaneTextureCanvas = this.textureRenderer.buildCardPaneTextureCanvas(
            paneRenderState.cardPane,
            this.cardPaneInteractionState
        );
        const utilityPaneTextureCanvas = this.textureRenderer.buildRightPaneTextureCanvas(
            paneRenderState.utilityPane,
            this.utilityPaneInteractionState
        );
        const backdropPanelStyle = this.#getBackdropPaneStyle();

        renderTitleMenuGlassPanel(this.session, {
            panelRect: paneRenderState.cardPane,
            panelStyle: backdropPanelStyle,
            alpha: paneRenderState.cardPane.alpha,
            effectTextureCanvas: cardPaneTextureCanvas
        });

        renderTitleMenuGlassPanel(this.session, {
            panelRect: paneRenderState.utilityPane,
            panelStyle: backdropPanelStyle,
            alpha: paneRenderState.utilityPane.alpha,
            effectTextureCanvas: utilityPaneTextureCanvas
        });

        const panelStyle = this.#getPanelStyle();
        for (const menuEntry of this.secondaryMenuEntries) {
            if (this.#isPendingActivationSource('utility', menuEntry.id)) {
                continue;
            }
            const renderState = this.utilityTileRenderMap.get(menuEntry.id);
            const runtimeState = this.utilityTileStateMap.get(menuEntry.id);
            if (!renderState || !runtimeState || renderState.alpha <= 0.005) {
                continue;
            }

            const effectTextureCanvas = this.textureRenderer.buildUtilityTileTextureCanvas(
                renderState,
                runtimeState
            );
            renderTitleMenuGlassPanel(this.session, {
                panelRect: renderState.panelRect,
                panelStyle,
                alpha: renderState.alpha,
                transformMatrix: runtimeState.transformMatrix,
                perspective: runtimeState.perspective,
                effectTextureCanvas
            });
        }

        const sortedCards = this.#getSortedCardsForRender();

        for (const card of sortedCards) {
            if (this.#isPendingActivationSource('card', card.cardDefinition.id)) {
                continue;
            }
            const renderState = this.cardRenderMap.get(card.cardDefinition.id);
            const runtimeState = this.cardStateMap.get(card.cardDefinition.id);
            if (!renderState || !runtimeState || renderState.alpha <= 0.005) {
                continue;
            }

            const effectTextureCanvas = this.textureRenderer.buildCardTextureCanvas(
                card,
                runtimeState,
                renderState
            );
            renderTitleMenuGlassPanel(this.session, {
                panelRect: renderState.panelRect,
                panelStyle,
                alpha: renderState.alpha,
                transformMatrix: runtimeState.transformMatrix,
                perspective: runtimeState.perspective,
                effectTextureCanvas
            });
        }

        this.#drawConnectedActivationSource(panelStyle);

        this.versionLabelRenderer?.draw({
            session: this.session,
            paneLayout,
            uiww: this.UIWW,
            wh: this.WH,
            uiOffsetX: this.UIOffsetX,
            uiScale: this.uiScale,
            utilityPaneRevealEase: this.#getUtilityPaneRevealEase(),
            linkButton: this.versionHistoryLinkButton
        });
    }

    /**
     * 화면 크기 변경 시 카드 레이아웃을 다시 계산합니다.
     */
    resize() {
        this.WW = getWW();
        this.WH = getWH();
        this.UIWW = getUIWW();
        this.UIOffsetX = getUIOffsetX();
        this.uiScale = this.#getCurrentUiScale();
        this.layout.resize(this.uiScale);
        this.#syncLayout();
        this.#updateRenderStates(this.#getSceneTransitionProgress());
    }

    /**
     * 런타임 설정 변경을 카드 메뉴에 반영합니다.
     * @param {object} [changedSettings={}] - 변경된 설정 집합입니다.
     */
    applyRuntimeSettings(changedSettings = {}) {
        if (changedSettings.theme !== undefined) {
            this.#refreshMenuIcons();
            this.#syncThemeEffectOptions();
            if (this.pendingActivation) {
                this.pendingActivation.frontFaceTextureCanvas = null;
            }
        }

        if (changedSettings.disableTransparency !== undefined && this.session) {
            this.session.setDisableTransparency(getSetting('disableTransparency'));
        }

        if (changedSettings.uiScale !== undefined) {
            this.resize();
        }
    }

    /**
     * 카드 메뉴가 사용한 리소스를 정리합니다.
     */
    destroy() {
        if (this.pendingActivation?.presentation) {
            cancelOverlayConnectedPresentation(this.pendingActivation.presentation);
        }
        this.pendingActivation = null;
        if (this.session) {
            this.session.release();
            this.session = null;
        }

        if (this.textureRenderer) {
            this.textureRenderer.releaseRuntimeStateTextures(this.cardStateMap.values());
            this.textureRenderer.releaseRuntimeStateTextures(this.utilityTileStateMap.values());
            this.textureRenderer.destroy();
            this.textureRenderer = null;
        }
        if (this.versionLabelRenderer) {
            this.versionLabelRenderer.destroy();
            this.versionLabelRenderer = null;
        }
        if (this.versionHistoryLinkButton) {
            releaseTitleMenuVersionHistoryLinkButton(this.versionHistoryLinkButton);
            this.versionHistoryLinkButton = null;
        }

        releaseTitleMenuIconSources(this.svgDrawer, this.titleMenuIconSources);
        this.titleMenuIconSources = [];

        this.cards.length = 0;
        this.cardStateMap.clear();
        this.cardRenderMap.clear();
        this.utilityTileStateMap.clear();
        this.utilityTileRenderMap.clear();
    }

    /**
     * 카드 세션을 생성합니다.
     * @returns {OverlaySession|null} 생성된 카드 세션입니다.
     * @private
     */
    #createSession() {
        return createTitleMenuOverlaySession(getDisplaySystem());
    }

    /**
     * 저장 설정에서 현재 UI 스케일 배율을 읽어옵니다.
     * @returns {number} 현재 UI 스케일 배율입니다.
     * @private
     */
    #getCurrentUiScale() {
        const uiScale = getSetting('uiScale') / 100;
        return Number.isFinite(uiScale) && uiScale > 0 ? uiScale : 1;
    }

    /**
     * 카드 모델과 런타임 상태를 생성합니다.
     * @private
     */
    #createCards() {
        const cardDefinitions = this.cardRegistry.getAll();
        const orderMap = new Map(TITLE_MENU_CARD_REVEAL_ORDER.map((slotName, index) => [slotName, index]));

        for (const cardDefinition of cardDefinitions) {
            const card = new TitleMenuCard(cardDefinition, null);
            card.animator.setRevealOrder(orderMap.get(cardDefinition.layoutSlot) || 0);
            card.animator.show();
            this.cards.push(card);
            this.cardStateMap.set(cardDefinition.id, createTitleMenuRuntimeState());
        }
    }

    /**
     * 하단 보조 메뉴 타일 상태를 생성합니다.
     * @private
     */
    #createUtilityTileStates() {
        for (const menuEntry of this.secondaryMenuEntries) {
            this.utilityTileStateMap.set(menuEntry.id, createTitleMenuRuntimeState());
        }
    }

    /**
     * 카드와 하단 메뉴 SVG 아이콘을 미리 로드합니다.
     * @private
     */
    #preloadMenuIcons() {
        this.titleMenuIconSources = loadTitleMenuIconSources(
            this.svgDrawer,
            this.cards,
            this.secondaryMenuEntries
        );
    }

    /**
     * 테마 변경 시 메뉴 아이콘 SVG를 새로 로드합니다.
     */
    #refreshMenuIcons() {
        releaseTitleMenuIconSources(this.svgDrawer, this.titleMenuIconSources);
        this.#preloadMenuIcons();
    }

    /**
     * 테마 변경 후 세션에 캐시된 인터랙션 효과 색상을 현재 테마와 동기화합니다.
     * @private
     */
    #syncThemeEffectOptions() {
        const borderOptions = this.session?.getEffectOptions('hoverBorder');
        if (borderOptions) {
            borderOptions.color = getThemeAwareMenuBorderColor();
        }
    }

    /**
     * 카드 레이아웃을 현재 화면 기준으로 동기화합니다.
     * @private
     */
    #syncLayout() {
        const cardRects = this.layout.buildCardRects(this.cardRegistry.getAll());

        for (const card of this.cards) {
            const rect = cardRects.get(card.cardDefinition.id);
            if (!rect) {
                continue;
            }

            card.resize(rect);
            const runtimeState = this.cardStateMap.get(card.cardDefinition.id);
            if (!runtimeState) {
                continue;
            }

            runtimeState.localX = rect.w * 0.5;
            runtimeState.localY = rect.h * 0.5;
            runtimeState.textureCanvas = null;
            runtimeState.textureContext = null;
        }
    }

    /**
     * 카드 렌더 상태를 갱신합니다.
     * @param {number} transitionProgress - 타이틀 전환 진행률입니다.
     * @private
     */
    #updateRenderStates(transitionProgress) {
        const paneLayout = this.#getRightPaneLayout();
        this.currentPaneLayout = paneLayout;
        this.cardRenderMap.clear();
        this.utilityTileRenderMap.clear();
        for (const card of this.cards) {
            this.cardRenderMap.set(
                card.cardDefinition.id,
                buildTitleMenuCardRenderState({
                    card,
                    transitionProgress,
                    groupOffsetX: paneLayout.cardOffsetX,
                    groupOffsetY: paneLayout.cardOffsetY,
                    ww: this.WW,
                    wh: this.WH,
                    uiww: this.UIWW,
                    uiScale: this.uiScale,
                    titleCardMenu: TITLE_CARD_MENU,
                    getRevealConfig: (cardId) => getTitleMenuCardRevealConfig(TITLE_CARD_MENU, cardId),
                    getRevealProgress: this.#getRevealProgress.bind(this)
                })
            );
        }
        for (const [index, menuItem] of paneLayout.secondaryMenuItems.entries()) {
            this.utilityTileRenderMap.set(
                menuItem.id,
                buildTitleMenuUtilityTileRenderState({
                    menuItem,
                    index,
                    uiww: this.UIWW,
                    uiScale: this.uiScale,
                    revealCoreDuration: getTitleMenuCardRevealCoreDuration(TITLE_CARD_MENU),
                    getRevealProgress: this.#getRevealProgress.bind(this)
                })
            );
        }
    }

    /**
     * 카드 상호작용 상태를 갱신합니다.
     * @param {number} delta - 프레임 델타 시간입니다.
     * @private
     */
    #updateCardInteractions(delta) {
        const mouseX = getMouseInput('x');
        const mouseY = getMouseInput('y');
        const hoverTiltOptions = this.session?.getEffectOptions('hoverTilt') || null;
        const spotlightOptions = this.session?.getEffectOptions('hoverSpotlight') || null;
        const rippleOptions = this.session?.getEffectOptions('clickRipple') || null;
        const particleOptions = this.session?.getEffectOptions('hoverParticle') || null;
        const borderOptions = this.session?.getEffectOptions('hoverBorder') || null;
        const clickedThisFrame = this.pointerEnabled && hasMouseState('left', 'clicked');
        const cardInteraction = updateTitleMenuCardInteractionStates({
            cards: this.cards,
            interactiveCards: this.#getCardsForInteraction(),
            cardStateMap: this.cardStateMap,
            cardRenderMap: this.cardRenderMap,
            pointerEnabled: this.pointerEnabled,
            mouseX,
            mouseY,
            delta,
            clickedThisFrame,
            hoverTiltOptions,
            spotlightOptions,
            borderOptions,
            rippleOptions,
            particleOptions
        });

        if (cardInteraction.clickedCard) {
            consumeMouseState('left');
            this.#handleCardClick(cardInteraction.clickedCard);
        }

        const utilityInteraction = updateTitleMenuUtilityTileInteractionStates({
            secondaryMenuEntries: this.secondaryMenuEntries,
            utilityTileStateMap: this.utilityTileStateMap,
            utilityTileRenderMap: this.utilityTileRenderMap,
            isInteractive: !cardInteraction.hoveredCardId && this.pointerEnabled,
            mouseX,
            mouseY,
            delta,
            clickedThisFrame,
            hoverTiltOptions,
            spotlightOptions,
            borderOptions,
            rippleOptions,
            particleOptions
        });

        this.hoveredSecondaryMenuId = utilityInteraction.hoveredMenuItemId;
        const hoveredMenuEntry = utilityInteraction.hoveredMenuEntry;
        if (hoveredMenuEntry?.textKey) {
            requestTooltip(getLangString(hoveredMenuEntry.textKey));
        }

        if (utilityInteraction.clickedMenuEntry) {
            consumeMouseState('left');
            this.#handleSecondaryMenuAction(utilityInteraction.clickedMenuEntry);
        }
    }

    /**
     * 바깥 glass 판넬의 상호작용 상태를 갱신합니다.
     * @param {number} delta - 프레임 델타입니다.
     * @param {object} paneLayout - 렌더 배치 정보입니다.
     * @private
     */
    #updateOuterPaneInteractions(delta, paneLayout) {
        const mouseX = getMouseInput('x');
        const mouseY = getMouseInput('y');
        const spotlightOptions = this.session?.getEffectOptions('hoverSpotlight') || null;
        const borderOptions = this.session?.getEffectOptions('hoverBorder') || null;
        const isInteractive = this.pointerEnabled;

        updateTitleMenuPaneInteractionState({
            paneState: this.cardPaneInteractionState,
            paneRect: paneLayout?.cardPane,
            mouseX,
            mouseY,
            delta,
            isInteractive,
            spotlightOptions,
            borderOptions
        });
        updateTitleMenuPaneInteractionState({
            paneState: this.utilityPaneInteractionState,
            paneRect: paneLayout?.utilityPane,
            mouseX,
            mouseY,
            delta,
            isInteractive: isInteractive && !this.hoveredSecondaryMenuId,
            spotlightOptions,
            borderOptions
        });
    }

    /**
     * 우상단 업데이트 링크 버튼 상태를 현재 배치에 맞춰 갱신합니다.
     * @param {object} paneLayout - 현재 오른쪽 패널 배치 정보입니다.
     * @private
     */
    #updateVersionHistoryLinkButton(paneLayout) {
        if (!this.versionHistoryLinkButton) {
            return;
        }

        const layout = this.versionLabelRenderer?.buildLayout({
            paneLayout,
            uiww: this.UIWW,
            wh: this.WH,
            uiOffsetX: this.UIOffsetX,
            uiScale: this.uiScale,
            utilityPaneRevealEase: this.#getUtilityPaneRevealEase()
        }) || null;
        updateTitleMenuVersionHistoryLinkButton({
            button: this.versionHistoryLinkButton,
            layout,
            pointerEnabled: this.pointerEnabled,
            mouseX: getMouseInput('x'),
            mouseY: getMouseInput('y')
        });
    }

    /**
     * 카드 클릭 액션을 연결 오픈 전환으로 시작합니다.
     * @param {TitleMenuCard} card - 클릭된 카드입니다.
     * @private
     */
    #handleCardClick(card) {
        if (!card?.cardDefinition) {
            return;
        }

        this.#beginConnectedActivation({
            sourceType: 'card',
            sourceId: card.cardDefinition.id,
            sourceModel: card,
            actionType: card.cardDefinition.actionType,
            actionKey: card.cardDefinition.actionKey
        });
    }

    /**
     * 오른쪽 glass 패널과 하단 보조 메뉴 배치를 계산합니다.
     * @returns {object} 오른쪽 패널 배치 정보입니다.
     * @private
     */
    #getRightPaneLayout() {
        return buildTitleMenuRightPaneLayout({
            cards: this.cards,
            secondaryMenuEntries: this.secondaryMenuEntries,
            ww: this.WW,
            wh: this.WH,
            uiww: this.UIWW,
            uiOffsetX: this.UIOffsetX,
            uiScale: this.uiScale,
            titleCardMenu: TITLE_CARD_MENU
        });
    }

    /**
     * 하단 서브 메뉴 pane과 동기화된 등장 이징 값을 반환합니다.
     * @returns {number} 서브 메뉴 등장 이징 값입니다.
     * @private
     */
    #getUtilityPaneRevealEase() {
        const revealCoreDuration = getTitleMenuCardRevealCoreDuration(TITLE_CARD_MENU);
        return getTitleMenuUtilityPaneRevealEase({
            revealCoreDuration,
            getRevealProgress: this.#getRevealProgress.bind(this)
        });
    }

    /**
     * 하단 보조 메뉴 클릭 액션을 연결 오픈 전환으로 시작합니다.
     * @param {object} menuItem - 클릭된 메뉴 항목입니다.
     * @private
     */
    #handleSecondaryMenuAction(menuItem) {
        if (!menuItem) {
            return;
        }

        this.#beginConnectedActivation({
            sourceType: 'utility',
            sourceId: menuItem.id,
            sourceModel: menuItem,
            actionType: menuItem.actionType,
            actionKey: menuItem.actionKey
        });
    }

    /**
     * 카드형 메뉴 요소에서 실제 창 또는 씬으로 이어지는 전환을 준비합니다.
     * @param {object} request - 전환 요청입니다.
     * @private
     */
    #beginConnectedActivation(request) {
        if (this.pendingActivation || !request?.sourceId) {
            return;
        }

        const renderState = request.sourceType === 'utility'
            ? this.utilityTileRenderMap.get(request.sourceId)
            : this.cardRenderMap.get(request.sourceId);
        if (!renderState?.panelRect) {
            return;
        }

        const presentation = createOverlayConnectedPresentation({
            sourceRect: renderState.panelRect,
            durationSeconds: TITLE_MENU_CONNECTED_OPEN.DURATION_SECONDS,
            switchProgress: TITLE_MENU_CONNECTED_OPEN.SWITCH_PROGRESS,
            perspective: TITLE_MENU_CONNECTED_OPEN.PERSPECTIVE
        });
        const activation = {
            ...request,
            presentation,
            overlayId: null,
            frontFaceTextureCanvas: null,
            frontFaceSourceWidth: 0,
            frontFaceSourceHeight: 0
        };
        this.pendingActivation = activation;
        this.pointerEnabled = false;

        if (request.actionType === 'scene') {
            setOverlayConnectedPresentationTarget(
                presentation,
                this.#buildConnectedSceneTargetRect(renderState.panelRect)
            );
            return;
        }

        if (request.actionType === 'overlay') {
            activation.overlayId = this.TitleScene.openTitleOverlay(request.actionKey, {
                presentation
            });
        } else if (request.actionType === 'exit') {
            activation.overlayId = this.TitleScene.openExitOverlay({ presentation });
        }

        if (!activation.overlayId || !presentation.ready) {
            cancelOverlayConnectedPresentation(presentation);
            this.pendingActivation = null;
        }
    }

    /**
     * 현재 연결 오픈 전환의 상태와 카드 앞면 투영을 갱신합니다.
     * @param {number} delta - 가변 프레임 델타 초입니다.
     * @private
     */
    #updateConnectedActivation(delta) {
        const activation = this.pendingActivation;
        if (!activation?.presentation) {
            return;
        }

        if (activation.presentation.cancelled) {
            this.pendingActivation = null;
            return;
        }

        const renderState = activation.sourceType === 'utility'
            ? this.utilityTileRenderMap.get(activation.sourceId)
            : this.cardRenderMap.get(activation.sourceId);
        const runtimeState = activation.sourceType === 'utility'
            ? this.utilityTileStateMap.get(activation.sourceId)
            : this.cardStateMap.get(activation.sourceId);
        if (!renderState?.panelRect || !runtimeState) {
            cancelOverlayConnectedPresentation(activation.presentation);
            this.pendingActivation = null;
            return;
        }

        setOverlayConnectedPresentationSource(activation.presentation, renderState.panelRect);
        if (activation.actionType === 'scene') {
            setOverlayConnectedPresentationTarget(
                activation.presentation,
                this.#buildConnectedSceneTargetRect(renderState.panelRect)
            );
        }

        const completedNow = advanceOverlayConnectedPresentation(activation.presentation, delta);
        const currentRect = getOverlayConnectedPresentationRect(
            activation.presentation,
            this.connectedPresentationRect
        );
        if (currentRect) {
            updateTitleMenuCardProjection(renderState, runtimeState, null, {
                panelRect: currentRect,
                rotateX: 0,
                rotateY: activation.presentation.rotationY,
                perspective: activation.presentation.perspective
            });
        }

        if (!completedNow) {
            return;
        }

        this.pendingActivation = null;
        if (activation.actionType === 'scene') {
            this.TitleScene.gameStart();
        }
    }

    /**
     * 아직 대상 창이 없는 씬 액션에 사용할 중앙 목표 영역을 계산합니다.
     * @param {object} sourceRect - 출발 카드 영역입니다.
     * @returns {{x:number,y:number,w:number,h:number,radius:number}} 목표 영역입니다.
     * @private
     */
    #buildConnectedSceneTargetRect(sourceRect) {
        const width = this.UIWW * TITLE_MENU_CONNECTED_OPEN.SCENE_TARGET_WIDTH_UIWW_RATIO;
        const height = this.WH * TITLE_MENU_CONNECTED_OPEN.SCENE_TARGET_HEIGHT_WH_RATIO;
        return {
            x: (this.WW - width) * 0.5,
            y: (this.WH - height) * 0.5,
            w: width,
            h: height,
            radius: sourceRect?.radius || 0
        };
    }

    /**
     * 지정한 메뉴 요소가 현재 연결 전환의 출발 면인지 반환합니다.
     * @param {'card'|'utility'} sourceType - 출발 요소 종류입니다.
     * @param {string} sourceId - 출발 요소 id입니다.
     * @returns {boolean} 출발 면 여부입니다.
     * @private
     */
    #isPendingActivationSource(sourceType, sourceId) {
        return this.pendingActivation?.sourceType === sourceType
            && this.pendingActivation?.sourceId === sourceId;
    }

    /**
     * 연결 전환의 카드 앞면 또는 씬 전환용 빈 뒷면을 최상단에 그립니다.
     * @param {object} panelStyle - 카드 glass 스타일입니다.
     * @private
     */
    #drawConnectedActivationSource(panelStyle) {
        const activation = this.pendingActivation;
        const presentation = activation?.presentation;
        if (!presentation?.ready) {
            return;
        }

        const showsFrontFace = isOverlayConnectedPresentationFrontFace(presentation);
        if (activation.actionType !== 'scene' && !showsFrontFace) {
            return;
        }

        const renderState = activation.sourceType === 'utility'
            ? this.utilityTileRenderMap.get(activation.sourceId)
            : this.cardRenderMap.get(activation.sourceId);
        const runtimeState = activation.sourceType === 'utility'
            ? this.utilityTileStateMap.get(activation.sourceId)
            : this.cardStateMap.get(activation.sourceId);
        const currentRect = getOverlayConnectedPresentationRect(
            presentation,
            this.connectedPresentationRect
        );
        if (!renderState || !runtimeState || !currentRect) {
            return;
        }

        let effectTextureCanvas = null;
        let effectTextureRect = null;
        if (showsFrontFace) {
            effectTextureRect = getOverlayConnectedPresentationFrontContentRect(
                presentation,
                currentRect,
                this.connectedFrontContentRect
            );
            const sourceWidth = presentation.sourceRect.w;
            const sourceHeight = presentation.sourceRect.h;
            const needsFreshSnapshot = !activation.frontFaceTextureCanvas
                || activation.frontFaceSourceWidth !== sourceWidth
                || activation.frontFaceSourceHeight !== sourceHeight;

            if (needsFreshSnapshot) {
                activation.frontFaceTextureCanvas = activation.sourceType === 'utility'
                    ? this.textureRenderer.buildConnectedUtilityContentTextureCanvas(
                        renderState,
                        runtimeState
                    )
                    : this.textureRenderer.buildConnectedCardContentTextureCanvas(
                        activation.sourceModel,
                        renderState
                    );
                activation.frontFaceSourceWidth = sourceWidth;
                activation.frontFaceSourceHeight = sourceHeight;
            }
            effectTextureCanvas = activation.frontFaceTextureCanvas;
        }

        renderTitleMenuGlassPanel(this.session, {
            panelRect: currentRect,
            panelStyle,
            alpha: renderState.alpha,
            transformMatrix: runtimeState.transformMatrix,
            perspective: runtimeState.perspective,
            effectTextureCanvas,
            effectTextureRect
        });
    }

    /**
     * 외곽 패널을 내부 카드선과 동일한 계열로 보이게 할 스트로크 색상을 반환합니다.
     * @returns {string} 내부 카드선 기준 스트로크 색상입니다.
     * @private
     */
    #getUnifiedOuterPaneStrokeColor() {
        return getUnifiedOuterPaneStrokeColor();
    }

    /**
     * 카드 패널 스타일을 반환합니다.
     * @returns {object} 패널 렌더 옵션입니다.
     * @private
     */
    #getPanelStyle() {
        const disableTransparency = getSetting('disableTransparency') === true;
        return getMenuPanelStyle(disableTransparency);
    }

    /**
     * 오른쪽 보조 glass 패널 스타일을 반환합니다.
     * @returns {object} 패널 렌더 옵션입니다.
     * @private
     */
    #getBackdropPaneStyle() {
        const unifiedStroke = this.#getUnifiedOuterPaneStrokeColor();
        const disableTransparency = getSetting('disableTransparency') === true;
        return getMenuBackdropPaneStyle(disableTransparency, unifiedStroke);
    }

    /**
     * 카드 효과용 RGB 색상을 반환합니다.
     * @returns {{r:number, g:number, b:number}} 효과 RGB 색상입니다.
     * @private
     */
    #getEffectColor() {
        return getMenuEffectColor();
    }

    /**
     * 카드 렌더 순서를 반환합니다.
     * @returns {TitleMenuCard[]} 렌더 순서대로 정렬된 카드 목록입니다.
     * @private
     */
    #getSortedCardsForRender() {
        return [...this.cards].sort((leftCard, rightCard) => {
            return leftCard.animator.getState().revealOrder - rightCard.animator.getState().revealOrder;
        });
    }

    /**
     * 카드 hover 판정 순서를 반환합니다.
     * @returns {TitleMenuCard[]} 상호작용 판정용 카드 목록입니다.
     * @private
     */
    #getCardsForInteraction() {
        return [...this.#getSortedCardsForRender()].reverse();
    }

    /**
     * 현재 활성 overlay가 있는지 반환합니다.
     * @returns {boolean} overlay 활성 여부입니다.
     * @private
     */
    #hasBlockingOverlay() {
        const overlayManager = this.TitleScene?.sceneSystem?.systemHandler?.overlayManager;
        return Boolean(overlayManager && overlayManager.hasAnyOverlay());
    }

    /**
     * 현재 씬 전환 진행률을 반환합니다.
     * @returns {number} 0~1 범위 진행률입니다.
     * @private
     */
    #getSceneTransitionProgress() {
        const rawProgress = this.TitleScene?.loadingSequence?.sceneTransitionProgress;
        return clampNumber(Number.isFinite(rawProgress) ? rawProgress : 0, 0, 1);
    }

    /**
     * 현재 메뉴 등장 시간축에서 지정 구간의 진행률을 계산합니다.
     * @param {number} delaySeconds - 시작 지연 시간입니다.
     * @param {number} durationSeconds - 진행 구간 길이입니다.
     * @returns {number} 0~1 범위 진행률입니다.
     * @private
     */
    #getRevealProgress(delaySeconds, durationSeconds) {
        return getTitleMenuRevealProgress({
            cardRevealElapsed: this.cardRevealElapsed,
            titleCardMenu: TITLE_CARD_MENU,
            delaySeconds,
            durationSeconds
        });
    }

    /**
     * 카드 등장용 독립 시간축을 갱신합니다.
     * @param {number} delta - 프레임 델타 시간입니다.
     * @param {number} transitionProgress - 타이틀 전환 진행률입니다.
     * @returns {boolean} 카드 등장 애니메이션 종료 여부입니다.
     * @private
     */
    #updateCardRevealClock(delta, transitionProgress) {
        const revealClock = advanceTitleMenuCardRevealClock({
            cardRevealStarted: this.cardRevealStarted,
            cardRevealElapsed: this.cardRevealElapsed,
            transitionProgress,
            delta,
            titleCardMenu: TITLE_CARD_MENU
        });
        this.cardRevealStarted = revealClock.cardRevealStarted;
        this.cardRevealElapsed = revealClock.cardRevealElapsed;
        return revealClock.revealFinished;
    }

}
