import { getData } from 'data/data_handler.js';
import { SVGDrawer } from 'display/_svg_drawer.js';
import { getDisplaySystem, getUIOffsetX, getWH, getUIWW, getWW } from 'display/display_system.js';
import { getDelta } from 'game/time_handler.js';
import { consumeMouseState, getMouseInput, hasMouseState } from 'input/input_system.js';
import { OverlaySession } from 'overlay/_overlay_session.js';
import {
    createRectToQuadHomography,
    createRotationXMatrix,
    createRotationYMatrix,
    getDeltaLerpFactor,
    invertMat3,
    isPointInsideQuad,
    isPointInsideRoundedRect,
    lerpNumber,
    mapScreenPointToPanelLocal,
    multiplyMat4,
    projectPanelQuad
} from 'overlay/_panel_effect_math.js';
import { getSetting } from 'save/save_system.js';
import { getLangString, requestTooltip } from 'ui/ui_system.js';
import { UIPool, releaseUIItem } from 'ui/_ui_pool.js';
import { runtimeTool } from 'util/runtime_tool.js';
import { TitleMenuCard } from './menu/_title_menu_card.js';
import { TitleMenuCardRegistry } from './menu/_title_menu_card_registry.js';
import {
    TITLE_MENU_CARD_REVEAL_ORDER,
    TITLE_MENU_SECONDARY_ENTRIES
} from './menu/_title_menu_config.js';
import {
    drawTitleMenuCardBorder,
    drawTitleMenuCardParticles,
    drawTitleMenuCardRipples,
    drawTitleMenuCardSpotlight
} from './menu/_title_menu_effect_render.js';
import {
    hasTitleMenuDynamicTextureState,
    pushTitleMenuRipple,
    updateTitleMenuBorderState,
    updateTitleMenuParticleState,
    updateTitleMenuRippleState,
    updateTitleMenuSpotlightState,
    updateTitleMenuTiltState
} from './menu/_title_menu_effect_state.js';
import {
    drawTitleMenuCardIcon,
    drawTitleMenuIcon,
    drawTitleMenuPlaceholderIcon,
    getTitleMenuCardIconMetrics,
    getTitleMenuUtilityTileIconMetrics
} from './menu/_title_menu_icon_render.js';
import { getTitleMenuIconSource } from './menu/_title_menu_icon.js';
import { TitleMenuLayout } from './menu/_title_menu_layout.js';
import { clampNumber, easeOutCubic, easeOutExpo, lerpValue } from './menu/_title_menu_motion.js';
import {
    createTitleMenuPaneRuntimeState,
    createTitleMenuRuntimeState
} from './menu/_title_menu_runtime_state.js';
import {
    getTitleMenuTextPresetFont,
    getTitleMenuTextPresetFontSize
} from './menu/_title_menu_text_layout.js';
import { drawTitleMenuWrappedText } from './menu/_title_menu_text_render.js';
import {
    buildTitleMenuVersionLabelLayout,
    getTitleMenuGameVersionText,
    getTitleMenuVersionHistoryLinkText
} from './menu/_title_menu_version_label.js';
import {
    buildMenuStaticTextureThemeSignature,
    getMenuBackdropPaneStyle,
    getMenuCardDescriptionColor,
    getMenuCardTitleColor,
    getMenuEffectColor,
    getMenuOpacity,
    getMenuPanelStyle,
    getThemeAwareMenuBorderColor,
    getUnifiedOuterPaneStrokeColor,
    menuForegroundWithAlpha
} from './menu/_title_menu_theme.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');
const GLOBAL_CONSTANTS = getData('GLOBAL_CONSTANTS');
const TITLE_LINK_DATA = getData('TITLE_LINK_DATA');
const TITLE_CARD_MENU = TITLE_CONSTANTS.TITLE_CARD_MENU;
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
        this.svgDrawer = new SVGDrawer();
        this.titleMenuIconSources = [];
        this.layout = new TitleMenuLayout();
        this.cardRegistry = new TitleMenuCardRegistry(titleScene);
        this.cards = [];
        this.cardStateMap = new Map();
        this.cardRenderMap = new Map();
        this.utilityTileStateMap = new Map();
        this.utilityTileRenderMap = new Map();
        this.textureRevisionCounter = 0;
        this.pointerEnabled = false;
        this.cardRevealElapsed = 0;
        this.cardRevealStarted = false;
        this.currentPaneLayout = null;
        this.hoveredSecondaryMenuId = null;
        this.versionHistoryLinkButton = null;
        this.paneTextureCanvas = null;
        this.paneTextureContext = null;
        this.cardPaneTextureCanvas = null;
        this.cardPaneTextureContext = null;
        this.versionLabelMeasureCanvas = null;
        this.versionLabelMeasureContext = null;
        this.cardPaneInteractionState = createTitleMenuPaneRuntimeState();
        this.utilityPaneInteractionState = createTitleMenuPaneRuntimeState();
        this.secondaryMenuEntries = TITLE_MENU_SECONDARY_ENTRIES;
        this.session = this.#createSession();
        this.versionHistoryLinkButton = this.#createVersionHistoryLinkButton();

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
            && !this.#hasBlockingOverlay();

        this.#updateRenderStates(transitionProgress);
        const paneLayout = this.currentPaneLayout || this.#getRightPaneLayout();
        this.#updateCardInteractions(delta);
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
        const paneRenderState = this.#buildPaneRenderState(paneLayout);
        const cardPaneTextureCanvas = this.#buildCardPaneTextureCanvas(paneRenderState.cardPane);
        const utilityPaneTextureCanvas = this.#buildRightPaneTextureCanvas(
            paneRenderState.utilityPane,
            this.utilityPaneInteractionState
        );
        const backdropPanelStyle = this.#getBackdropPaneStyle();

        this.session.renderGlassPanel({
            x: paneRenderState.cardPane.x,
            y: paneRenderState.cardPane.y,
            w: paneRenderState.cardPane.w,
            h: paneRenderState.cardPane.h,
            radius: paneRenderState.cardPane.radius,
            sampleBackdrop: backdropPanelStyle.sampleBackdrop,
            blur: backdropPanelStyle.blur,
            fill: backdropPanelStyle.fill,
            stroke: backdropPanelStyle.stroke,
            lineWidth: backdropPanelStyle.lineWidth,
            tintColor: backdropPanelStyle.tintColor,
            edgeColor: backdropPanelStyle.edgeColor,
            tintStrength: backdropPanelStyle.tintStrength,
            edgeStrength: backdropPanelStyle.edgeStrength,
            refractionStrength: backdropPanelStyle.refractionStrength,
            alpha: paneRenderState.cardPane.alpha,
            effectTextureCanvas: cardPaneTextureCanvas
        });

        this.session.renderGlassPanel({
            x: paneRenderState.utilityPane.x,
            y: paneRenderState.utilityPane.y,
            w: paneRenderState.utilityPane.w,
            h: paneRenderState.utilityPane.h,
            radius: paneRenderState.utilityPane.radius,
            sampleBackdrop: backdropPanelStyle.sampleBackdrop,
            blur: backdropPanelStyle.blur,
            fill: backdropPanelStyle.fill,
            stroke: backdropPanelStyle.stroke,
            lineWidth: backdropPanelStyle.lineWidth,
            tintColor: backdropPanelStyle.tintColor,
            edgeColor: backdropPanelStyle.edgeColor,
            tintStrength: backdropPanelStyle.tintStrength,
            edgeStrength: backdropPanelStyle.edgeStrength,
            refractionStrength: backdropPanelStyle.refractionStrength,
            alpha: paneRenderState.utilityPane.alpha,
            effectTextureCanvas: utilityPaneTextureCanvas
        });

        for (const menuEntry of this.secondaryMenuEntries) {
            const renderState = this.utilityTileRenderMap.get(menuEntry.id);
            const runtimeState = this.utilityTileStateMap.get(menuEntry.id);
            if (!renderState || !runtimeState || renderState.alpha <= 0.005) {
                continue;
            }

            const panelStyle = this.#getPanelStyle();
            const effectTextureCanvas = this.#buildUtilityTileTextureCanvas(renderState, runtimeState);
            const panelRect = renderState.panelRect;

            this.session.renderGlassPanel({
                x: panelRect.x,
                y: panelRect.y,
                w: panelRect.w,
                h: panelRect.h,
                radius: panelRect.radius,
                sampleBackdrop: panelStyle.sampleBackdrop,
                blur: panelStyle.blur,
                fill: panelStyle.fill,
                stroke: panelStyle.stroke,
                lineWidth: panelStyle.lineWidth,
                tintColor: panelStyle.tintColor,
                edgeColor: panelStyle.edgeColor,
                tintStrength: panelStyle.tintStrength,
                edgeStrength: panelStyle.edgeStrength,
                refractionStrength: panelStyle.refractionStrength,
                alpha: renderState.alpha,
                transformMatrix: runtimeState.transformMatrix,
                perspective: runtimeState.perspective,
                effectTextureCanvas
            });
        }

        const sortedCards = this.#getSortedCardsForRender();

        for (const card of sortedCards) {
            const renderState = this.cardRenderMap.get(card.cardDefinition.id);
            const runtimeState = this.cardStateMap.get(card.cardDefinition.id);
            if (!renderState || !runtimeState || renderState.alpha <= 0.005) {
                continue;
            }

            const panelStyle = this.#getPanelStyle();
            const effectTextureCanvas = this.#buildCardTextureCanvas(card, runtimeState, renderState);
            const panelRect = renderState.panelRect;

            this.session.renderGlassPanel({
                x: panelRect.x,
                y: panelRect.y,
                w: panelRect.w,
                h: panelRect.h,
                radius: panelRect.radius,
                sampleBackdrop: panelStyle.sampleBackdrop,
                blur: panelStyle.blur,
                fill: panelStyle.fill,
                stroke: panelStyle.stroke,
                lineWidth: panelStyle.lineWidth,
                tintColor: panelStyle.tintColor,
                edgeColor: panelStyle.edgeColor,
                tintStrength: panelStyle.tintStrength,
                edgeStrength: panelStyle.edgeStrength,
                refractionStrength: panelStyle.refractionStrength,
                alpha: renderState.alpha,
                transformMatrix: runtimeState.transformMatrix,
                perspective: runtimeState.perspective,
                effectTextureCanvas
            });
        }

        this.#drawGameVersionLabel(paneLayout);
    }

    /**
     * 화면 크기 변경 시 카드 레이아웃을 다시 계산합니다.
     */
    resize() {
        this.WW = getWW();
        this.WH = getWH();
        this.UIWW = getUIWW();
        this.UIOffsetX = getUIOffsetX();
        this.layout.resize();
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
        }

        if (changedSettings.disableTransparency !== undefined && this.session) {
            this.session.setDisableTransparency(getSetting('disableTransparency'));
        }
    }

    /**
     * 카드 메뉴가 사용한 리소스를 정리합니다.
     */
    destroy() {
        if (this.session) {
            this.session.release();
            this.session = null;
        }

        for (const runtimeState of this.cardStateMap.values()) {
            if (runtimeState.textureCanvas) {
                runtimeState.textureCanvas.width = 0;
                runtimeState.textureCanvas.height = 0;
            }
            if (runtimeState.staticTextureCanvas) {
                runtimeState.staticTextureCanvas.width = 0;
                runtimeState.staticTextureCanvas.height = 0;
            }
        }
        for (const runtimeState of this.utilityTileStateMap.values()) {
            if (runtimeState.textureCanvas) {
                runtimeState.textureCanvas.width = 0;
                runtimeState.textureCanvas.height = 0;
            }
            if (runtimeState.staticTextureCanvas) {
                runtimeState.staticTextureCanvas.width = 0;
                runtimeState.staticTextureCanvas.height = 0;
            }
        }
        if (this.paneTextureCanvas) {
            this.paneTextureCanvas.width = 0;
            this.paneTextureCanvas.height = 0;
            this.paneTextureContext = null;
        }
        if (this.cardPaneTextureCanvas) {
            this.cardPaneTextureCanvas.width = 0;
            this.cardPaneTextureCanvas.height = 0;
            this.cardPaneTextureContext = null;
        }
        if (this.versionLabelMeasureCanvas) {
            this.versionLabelMeasureCanvas.width = 0;
            this.versionLabelMeasureCanvas.height = 0;
            this.versionLabelMeasureCanvas = null;
            this.versionLabelMeasureContext = null;
        }
        if (this.versionHistoryLinkButton) {
            releaseUIItem(this.versionHistoryLinkButton);
            this.versionHistoryLinkButton = null;
        }

        this.titleMenuIconSources.forEach((iconSource) => {
            this.svgDrawer.releaseSvgFile(iconSource);
        });
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
        const displaySystem = getDisplaySystem();
        if (!displaySystem) {
            return null;
        }

        return new OverlaySession({
            displaySystem,
            layer: 10,
            dim: 0,
            transparent: true,
            glOverlay: true,
            blurUpdateMode: 'always',
            disableTransparency: getSetting('disableTransparency'),
            orderSequence: 1,
            effects: {
                hoverTilt: {
                    maxAngleDeg: 6,
                    smoothing: 0.18,
                    perspective: 1180
                },
                hoverSpotlight: {
                    radius: 280,
                    opacity: 0.8,
                    smoothing: 0.2
                },
                hoverBorder: {
                    radius: 280,
                    color: getThemeAwareMenuBorderColor(),
                    opacity: 0.75,
                    width: 1.2,
                    hoverWidth: 2.4,
                    falloff: 80,
                    smoothing: 0.2
                },
                clickRipple: {
                    duration: 0.8
                },
                hoverParticle: {
                    count: 12,
                    spawnInterval: 0.08,
                    driftDistance: 84,
                    minDuration: 1.8,
                    maxDuration: 3.2
                }
            }
        });
    }

    /**
     * 우상단 업데이트 링크 상호작용에 사용할 투명 버튼을 생성합니다.
     * @returns {import('ui/element/_button.js').ButtonElement} 생성된 버튼입니다.
     * @private
     */
    #createVersionHistoryLinkButton() {
        const button = UIPool.button.get();
        button.init({
            parent: this.TitleScene,
            onClick: this.#handleVersionHistoryLinkClick.bind(this),
            onHover: null,
            layer: 'ui',
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            idleColor: 'rgba(0, 0, 0, 0)',
            hoverColor: 'rgba(0, 0, 0, 0)',
            center: [],
            alpha: 1,
            margin: 0,
            radius: 0
        });
        button.hoverScaleMultiplier = 1;
        button.pressScaleMultiplier = 1;
        return button;
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
        const nextSources = [];
        const iconIds = new Set([
            ...this.cards.map((card) => card.cardDefinition.id),
            ...this.secondaryMenuEntries.map((menuEntry) => menuEntry.id)
        ]);

        for (const iconId of iconIds) {
            const iconSource = getTitleMenuIconSource(iconId);
            if (!iconSource) {
                continue;
            }
            nextSources.push(iconSource);

            void this.svgDrawer.loadSvgFile(iconSource)
                .catch(() => {});
        }

        this.titleMenuIconSources = nextSources;
    }

    /**
     * 테마 변경 시 메뉴 아이콘 SVG를 새로 로드합니다.
     */
    #refreshMenuIcons() {
        this.titleMenuIconSources.forEach((iconSource) => {
            this.svgDrawer.releaseSvgFile(iconSource);
        });
        this.titleMenuIconSources = [];
        this.#preloadMenuIcons();
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
                this.#buildCardRenderState(card, transitionProgress, paneLayout.cardOffsetX, paneLayout.cardOffsetY)
            );
        }
        for (const [index, menuItem] of paneLayout.secondaryMenuItems.entries()) {
            this.utilityTileRenderMap.set(
                menuItem.id,
                this.#buildUtilityTileRenderState(menuItem, index)
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
        let hoveredCardId = null;
        let hoveredPointerInfo = null;

        const interactiveCards = this.#getCardsForInteraction();
        for (const card of interactiveCards) {
            const runtimeState = this.cardStateMap.get(card.cardDefinition.id);
            const renderState = this.cardRenderMap.get(card.cardDefinition.id);
            if (!runtimeState || !renderState || renderState.alpha <= 0.75) {
                continue;
            }

            this.#updateCardProjection(renderState, runtimeState);
            const pointerInfo = this.#resolveCardPointerInfo(renderState, runtimeState, mouseX, mouseY);
            if (pointerInfo?.hovered) {
                hoveredCardId = card.cardDefinition.id;
                hoveredPointerInfo = pointerInfo;
                break;
            }
        }

        for (const card of this.cards) {
            const runtimeState = this.cardStateMap.get(card.cardDefinition.id);
            const renderState = this.cardRenderMap.get(card.cardDefinition.id);
            if (!runtimeState || !renderState) {
                continue;
            }

            const isHovered = this.pointerEnabled && hoveredCardId === card.cardDefinition.id;
            runtimeState.hovered = isHovered;
            if (isHovered && hoveredPointerInfo?.localPoint) {
                runtimeState.localX = hoveredPointerInfo.localPoint.x;
                runtimeState.localY = hoveredPointerInfo.localPoint.y;
                runtimeState.normalizedX = clampNumber(((runtimeState.localX / Math.max(1, renderState.panelRect.w)) * 2) - 1, -1, 1);
                runtimeState.normalizedY = clampNumber(((runtimeState.localY / Math.max(1, renderState.panelRect.h)) * 2) - 1, -1, 1);
            }

            card.setHovered(isHovered);
            if (clickedThisFrame && isHovered) {
                if (rippleOptions) {
                    pushTitleMenuRipple(renderState, runtimeState, rippleOptions);
                }
                consumeMouseState('left');
                this.#handleCardClick(card);
            }

            updateTitleMenuTiltState(renderState, runtimeState, delta, hoverTiltOptions);
            this.#updateCardProjection(renderState, runtimeState);
            updateTitleMenuSpotlightState(runtimeState, delta, spotlightOptions);
            updateTitleMenuBorderState(runtimeState, delta, borderOptions);
            updateTitleMenuParticleState(renderState, runtimeState, delta, particleOptions);
            updateTitleMenuRippleState(runtimeState, delta);
            runtimeState.wasHovered = runtimeState.hovered;
            card.update(delta);
        }

        this.#updateUtilityTileInteractions(
            delta,
            mouseX,
            mouseY,
            clickedThisFrame,
            !hoveredCardId && this.pointerEnabled,
            hoverTiltOptions,
            spotlightOptions,
            borderOptions,
            rippleOptions,
            particleOptions
        );
    }

    /**
     * 하단 보조 메뉴 타일 상호작용 상태를 갱신합니다.
     * @param {number} delta - 프레임 델타 시간입니다.
     * @param {number} mouseX - 현재 마우스 X 좌표입니다.
     * @param {number} mouseY - 현재 마우스 Y 좌표입니다.
     * @param {boolean} clickedThisFrame - 이번 프레임 클릭 여부입니다.
     * @param {boolean} isInteractive - 상호작용 가능 여부입니다.
     * @param {object|null} hoverTiltOptions - hover tilt 옵션입니다.
     * @param {object|null} spotlightOptions - spotlight 옵션입니다.
     * @param {object|null} borderOptions - border 옵션입니다.
     * @param {object|null} rippleOptions - ripple 옵션입니다.
     * @param {object|null} particleOptions - particle 옵션입니다.
     * @private
     */
    #updateUtilityTileInteractions(
        delta,
        mouseX,
        mouseY,
        clickedThisFrame,
        isInteractive,
        hoverTiltOptions,
        spotlightOptions,
        borderOptions,
        rippleOptions,
        particleOptions
    ) {
        let hoveredMenuItemId = null;
        let hoveredPointerInfo = null;

        if (isInteractive) {
            const interactiveItems = [...this.secondaryMenuEntries].reverse();
            for (const menuEntry of interactiveItems) {
                const runtimeState = this.utilityTileStateMap.get(menuEntry.id);
                const renderState = this.utilityTileRenderMap.get(menuEntry.id);
                if (!runtimeState || !renderState || renderState.alpha <= 0.75) {
                    continue;
                }

                this.#updateCardProjection(renderState, runtimeState);
                const pointerInfo = this.#resolveCardPointerInfo(renderState, runtimeState, mouseX, mouseY);
                if (pointerInfo?.hovered) {
                    hoveredMenuItemId = menuEntry.id;
                    hoveredPointerInfo = pointerInfo;
                    break;
                }
            }
        }

        this.hoveredSecondaryMenuId = hoveredMenuItemId;
        const hoveredMenuEntry = hoveredMenuItemId
            ? (this.secondaryMenuEntries.find((menuEntry) => menuEntry.id === hoveredMenuItemId) || null)
            : null;
        if (hoveredMenuEntry?.textKey) {
            requestTooltip(getLangString(hoveredMenuEntry.textKey));
        }

        for (const menuEntry of this.secondaryMenuEntries) {
            const runtimeState = this.utilityTileStateMap.get(menuEntry.id);
            const renderState = this.utilityTileRenderMap.get(menuEntry.id);
            if (!runtimeState || !renderState) {
                continue;
            }

            const isHovered = hoveredMenuItemId === menuEntry.id;
            runtimeState.hovered = isHovered;
            if (isHovered && hoveredPointerInfo?.localPoint) {
                runtimeState.localX = hoveredPointerInfo.localPoint.x;
                runtimeState.localY = hoveredPointerInfo.localPoint.y;
                runtimeState.normalizedX = clampNumber(((runtimeState.localX / Math.max(1, renderState.panelRect.w)) * 2) - 1, -1, 1);
                runtimeState.normalizedY = clampNumber(((runtimeState.localY / Math.max(1, renderState.panelRect.h)) * 2) - 1, -1, 1);
            }

            updateTitleMenuTiltState(renderState, runtimeState, delta, hoverTiltOptions);
            this.#updateCardProjection(renderState, runtimeState);
            updateTitleMenuSpotlightState(runtimeState, delta, spotlightOptions);
            updateTitleMenuBorderState(runtimeState, delta, borderOptions);
            updateTitleMenuParticleState(renderState, runtimeState, delta, particleOptions);
            updateTitleMenuRippleState(runtimeState, delta);

            if (clickedThisFrame && isHovered && rippleOptions) {
                pushTitleMenuRipple(renderState, runtimeState, rippleOptions);
            }

            runtimeState.wasHovered = runtimeState.hovered;
        }

        if (clickedThisFrame && hoveredMenuItemId) {
            consumeMouseState('left');
            this.#handleSecondaryMenuAction(hoveredMenuEntry);
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

        this.#updatePaneInteractionState(
            this.cardPaneInteractionState,
            paneLayout?.cardPane,
            mouseX,
            mouseY,
            delta,
            isInteractive,
            spotlightOptions,
            borderOptions
        );
        this.#updatePaneInteractionState(
            this.utilityPaneInteractionState,
            paneLayout?.utilityPane,
            mouseX,
            mouseY,
            delta,
            isInteractive && !this.hoveredSecondaryMenuId,
            spotlightOptions,
            borderOptions
        );
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

        const layout = this.#buildVersionLabelLayout(paneLayout);
        this.#layoutVersionHistoryLinkButton(layout);
        const button = this.versionHistoryLinkButton;
        const mouseX = getMouseInput('x');
        const mouseY = getMouseInput('y');
        const isHovered = this.pointerEnabled
            && button.width > 0
            && button.height > 0
            && Number.isFinite(mouseX)
            && Number.isFinite(mouseY)
            && mouseX >= button.x
            && mouseX <= button.x + button.width
            && mouseY >= button.y
            && mouseY <= button.y + button.height;
        const isLeftPressing = hasMouseState('left', 'click') || hasMouseState('left', 'clicking');

        button._handleInteractionState(isHovered, isLeftPressing, button.onHover);

        if (isHovered && hasMouseState('left', 'clicked')) {
            button.onClick();
        }
    }

    /**
     * 우상단 업데이트 링크 버튼 배치를 현재 렌더 레이아웃에 맞춥니다.
     * @param {object|null} layout - 버전 정보 블록 렌더 레이아웃입니다.
     * @private
     */
    #layoutVersionHistoryLinkButton(layout) {
        if (!this.versionHistoryLinkButton) {
            return;
        }

        const button = this.versionHistoryLinkButton;
        const linkBounds = layout?.linkBounds || null;
        button.x = linkBounds?.x || 0;
        button.y = linkBounds?.y || 0;
        button.width = this.pointerEnabled && linkBounds ? linkBounds.w : 0;
        button.height = this.pointerEnabled && linkBounds ? linkBounds.h : 0;
        button.radius = 0;
    }

    /**
     * pane 상호작용 단위를 갱신합니다.
     * @param {object} paneState - pane 상호작용 상태입니다.
     * @param {object} paneRect - pane 영역입니다.
     * @param {number} mouseX - 마우스 X 좌표입니다.
     * @param {number} mouseY - 마우스 Y 좌표입니다.
     * @param {number} delta - 프레임 델타입니다.
     * @param {boolean} isInteractive - 상호작용 가능 여부입니다.
     * @param {object|null} spotlightOptions - hoverSpotlight 옵션입니다.
     * @param {object|null} borderOptions - hoverBorder 옵션입니다.
     * @private
     */
    #updatePaneInteractionState(
        paneState,
        paneRect,
        mouseX,
        mouseY,
        delta,
        isInteractive,
        spotlightOptions,
        borderOptions
    ) {
        if (!paneState || !paneRect) {
            return;
        }

        if (!isInteractive) {
            paneState.hovered = false;
            paneState.spotlightAlpha = lerpNumber(
                paneState.spotlightAlpha,
                0,
                getDeltaLerpFactor(0.24, delta)
            );
            paneState.borderAlpha = lerpNumber(
                paneState.borderAlpha,
                0,
                getDeltaLerpFactor(0.24, delta)
            );
            paneState.wasHovered = false;
            return;
        }

        const pointerInfo = this.#resolvePanePointerInfo(paneRect, mouseX, mouseY);
        paneState.hovered = pointerInfo.hovered;

        if (pointerInfo.hovered && pointerInfo.localPoint) {
            paneState.localX = pointerInfo.localPoint.x;
            paneState.localY = pointerInfo.localPoint.y;
        }

        if (!spotlightOptions) {
            paneState.spotlightAlpha = lerpNumber(
                paneState.spotlightAlpha,
                0,
                getDeltaLerpFactor(0.24, delta)
            );
        } else {
            paneState.spotlightAlpha = lerpNumber(
                paneState.spotlightAlpha,
                paneState.hovered ? spotlightOptions.opacity : 0,
                getDeltaLerpFactor(spotlightOptions.smoothing, delta)
            );
        }

        if (!borderOptions) {
            paneState.borderAlpha = lerpNumber(
                paneState.borderAlpha,
                0,
                getDeltaLerpFactor(0.24, delta)
            );
        } else {
            paneState.borderAlpha = lerpNumber(
                paneState.borderAlpha,
                paneState.hovered ? borderOptions.opacity : 0,
                getDeltaLerpFactor(borderOptions.smoothing, delta)
            );
        }

        paneState.wasHovered = paneState.hovered;
    }

    /**
     * pane 내부 hover 판정을 계산합니다.
     * @param {object} paneRect - pane 영역입니다.
     * @param {number} mouseX - 마우스 X 좌표입니다.
     * @param {number} mouseY - 마우스 Y 좌표입니다.
     * @returns {{hovered:boolean, localPoint:{x:number, y:number}|null}} 판정 결과입니다.
     * @private
     */
    #resolvePanePointerInfo(paneRect, mouseX, mouseY) {
        if (!Number.isFinite(mouseX) || !Number.isFinite(mouseY)) {
            return {
                hovered: false,
                localPoint: null
            };
        }

        if (
            mouseX < paneRect.x
            || mouseX > paneRect.x + paneRect.w
            || mouseY < paneRect.y
            || mouseY > paneRect.y + paneRect.h
        ) {
            return {
                hovered: false,
                localPoint: null
            };
        }

        const localPoint = {
            x: mouseX - paneRect.x,
            y: mouseY - paneRect.y
        };

        const hovered = isPointInsideRoundedRect(
            localPoint.x,
            localPoint.y,
            paneRect.w,
            paneRect.h,
            paneRect.radius
        );

        if (!hovered) {
            return {
                hovered: false,
                localPoint: null
            };
        }

        return {
            hovered,
            localPoint
        };
    }

    /**
     * 카드 클릭 액션을 즉시 실행합니다.
     * @param {TitleMenuCard} card - 클릭된 카드입니다.
     * @private
     */
    #handleCardClick(card) {
        if (!card?.cardDefinition) {
            return;
        }

        if (card.cardDefinition.actionType === 'scene') {
            this.TitleScene.gameStart();
            return;
        }

        if (card.cardDefinition.actionType === 'overlay') {
            this.TitleScene.openTitleOverlay(card.cardDefinition.actionKey);
        }
    }

    /**
     * 카드 현재 렌더 상태를 계산합니다.
     * @param {TitleMenuCard} card - 대상 카드입니다.
     * @param {number} transitionProgress - 타이틀 전환 진행률입니다.
     * @returns {object} 계산된 렌더 상태입니다.
     * @private
     */
    #buildCardRenderState(card, transitionProgress, groupOffsetX = 0, groupOffsetY = 0) {
        const layoutRect = card.layoutRect;
        const animationState = card.animator.getState();
        if (!layoutRect) {
            return {
                alpha: 0,
                hoverProgress: 0,
                panelRect: {
                    x: 0,
                    y: 0,
                    w: 0,
                    h: 0,
                    radius: 0
                }
            };
        }

        const revealConfig = this.#getCardRevealConfig(card.cardDefinition.id);
        const revealProgress = this.#getRevealProgress(revealConfig.delaySeconds, revealConfig.durationSeconds);
        const revealEase = easeOutExpo(revealProgress);
        const motionEase = easeOutExpo(revealProgress);
        const transitionEase = easeOutExpo(transitionProgress);
        const worldScale = lerpValue(TITLE_CARD_MENU.ENTRANCE_START_SCALE, 1, transitionEase);
        const entryScale = lerpValue(1 + revealConfig.scaleOffset, 1, revealEase);
        const hoverProgress = easeOutCubic(animationState.hoverProgress || 0);
        const finalCenterX = layoutRect.x + groupOffsetX + (layoutRect.w * 0.5);
        const finalCenterY = layoutRect.y + groupOffsetY + (layoutRect.h * 0.5);
        const screenCenterX = this.WW * 0.5;
        const screenCenterY = this.WH * 0.5;
        const width = layoutRect.w * worldScale * entryScale;
        const height = layoutRect.h * worldScale * entryScale;
        const baseCenterX = screenCenterX + ((finalCenterX - screenCenterX) * worldScale);
        const baseCenterY = screenCenterY + ((finalCenterY - screenCenterY) * worldScale);
        const startOffsetX = this.UIWW * (TITLE_CARD_MENU.ENTRANCE_OFFSET_X_UIWW_RATIO + revealConfig.offsetXRatio);
        const offscreenStartX = Math.max(this.WW + (layoutRect.w * 0.12), finalCenterX + startOffsetX);
        const offscreenStartY = baseCenterY;
        const centerX = lerpValue(offscreenStartX, baseCenterX, motionEase);
        const centerY = lerpValue(offscreenStartY, baseCenterY, motionEase);
        const radius = Math.max(12, Math.min(width, height) * 0.08);

        return {
            revealProgress,
            revealEase,
            alpha: clampNumber(clampNumber((revealProgress - 0.08) / 0.42, 0, 1), 0, 1),
            hoverProgress,
            panelRect: {
                x: centerX - (width * 0.5),
                y: centerY - (height * 0.5),
                w: width,
                h: height,
                radius
            }
        };
    }

    /**
     * 하단 보조 메뉴 타일의 렌더 상태를 계산합니다.
     * @param {object} menuItem - 대상 보조 메뉴 항목입니다.
     * @param {number} index - 항목 순서입니다.
     * @returns {object} 계산된 타일 렌더 상태입니다.
     * @private
     */
    #buildUtilityTileRenderState(menuItem, index) {
        const revealCoreDuration = this.#getCardRevealCoreDuration();
        const utilityPaneProgress = this.#getRevealProgress(
            Math.min(0.16, revealCoreDuration * 0.18),
            Math.max(0.24, revealCoreDuration * 0.44)
        );
        const utilityPaneEase = easeOutCubic(utilityPaneProgress);
        const secondaryBaseDelay = Math.min(0.24, revealCoreDuration * 0.26);
        const secondaryStepDelay = Math.min(0.05, revealCoreDuration * 0.08);
        const secondaryDuration = Math.max(0.22, revealCoreDuration * 0.32);
        const itemProgress = this.#getRevealProgress(
            secondaryBaseDelay + (secondaryStepDelay * index),
            secondaryDuration
        );
        const itemEase = easeOutCubic(itemProgress);
        const paneTranslateX = (1 - utilityPaneEase) * (this.UIWW * 0.026);
        const translateX = paneTranslateX + ((1 - itemEase) * Math.min(this.UIWW * 0.014, menuItem.w * 0.28));

        return {
            ...menuItem,
            alpha: itemEase,
            translateX,
            translateY: 0,
            panelRect: {
                x: menuItem.x + translateX,
                y: menuItem.y,
                w: menuItem.w,
                h: menuItem.h,
                radius: menuItem.radius
            }
        };
    }

    /**
     * 현재 카드의 투영 상태를 갱신합니다.
     * @param {object} renderState - 카드 렌더 상태입니다.
     * @param {object} runtimeState - 카드 런타임 상태입니다.
     * @private
     */
    #updateCardProjection(renderState, runtimeState) {
        const hoverTiltOptions = this.session?.getEffectOptions('hoverTilt');
        const perspectiveBase = hoverTiltOptions?.perspective || 1180;
        runtimeState.perspective = perspectiveBase;

        runtimeState.transformMatrix = multiplyMat4(
            createRotationYMatrix(runtimeState.rotateY),
            createRotationXMatrix(runtimeState.rotateX)
        );
        runtimeState.projectedQuad = projectPanelQuad(renderState.panelRect, runtimeState.transformMatrix, runtimeState.perspective);

        const homography = createRectToQuadHomography(
            renderState.panelRect.w,
            renderState.panelRect.h,
            runtimeState.projectedQuad
        );
        runtimeState.inverseHomography = homography ? invertMat3(homography) : null;
    }

    /**
     * 화면 좌표가 현재 카드 내부에 있는지 판정합니다.
     * @param {object} renderState - 카드 렌더 상태입니다.
     * @param {object} runtimeState - 카드 런타임 상태입니다.
     * @param {number} mouseX - 현재 마우스 X 좌표입니다.
     * @param {number} mouseY - 현재 마우스 Y 좌표입니다.
     * @returns {{hovered:boolean, localPoint:{x:number, y:number}|null}} 판정 결과입니다.
     * @private
     */
    #resolveCardPointerInfo(renderState, runtimeState, mouseX, mouseY) {
        if (!Number.isFinite(mouseX) || !Number.isFinite(mouseY) || !runtimeState.projectedQuad) {
            return {
                hovered: false,
                localPoint: null
            };
        }

        if (!isPointInsideQuad(mouseX, mouseY, runtimeState.projectedQuad)) {
            return {
                hovered: false,
                localPoint: null
            };
        }

        const localPoint = mapScreenPointToPanelLocal(mouseX, mouseY, runtimeState.inverseHomography)
            || {
                x: mouseX - renderState.panelRect.x,
                y: mouseY - renderState.panelRect.y
            };
        const hovered = isPointInsideRoundedRect(
            localPoint.x,
            localPoint.y,
            renderState.panelRect.w,
            renderState.panelRect.h,
            renderState.panelRect.radius
        );

        return {
            hovered,
            localPoint
        };
    }

    /**
     * 오른쪽 glass 패널과 하단 보조 메뉴 배치를 계산합니다.
     * @returns {object} 오른쪽 패널 배치 정보입니다.
     * @private
     */
    #getRightPaneLayout() {
        const layoutRects = this.cards
            .map((card) => card.layoutRect)
            .filter(Boolean);

        if (layoutRects.length <= 0) {
            const fallbackLeft = this.UIOffsetX + (this.UIWW * 0.62);
            const fallbackWidth = this.UIWW * 0.26;
            const fallbackCardHeight = this.WH * 0.36;
            const fallbackVerticalPadding = Math.max(18, this.WH * 0.022);
            const fallbackSidePadding = fallbackVerticalPadding;
            const fallbackRight = fallbackLeft + fallbackWidth;
            const fallbackVerticalLayout = this.#resolveRightPaneVerticalLayout(fallbackCardHeight);
            const fallbackShiftY = this.#resolveMainMenuVerticalShift(
                fallbackVerticalLayout.cardPaneTop,
                fallbackCardHeight
            );
            const fallbackUtilityLayout = this.#translateUtilityPaneLayout(
                this.#buildUtilityPaneLayout(
                    fallbackRight,
                    fallbackWidth,
                    fallbackVerticalLayout.utilityPaneTop,
                    fallbackSidePadding,
                    fallbackVerticalPadding
                ),
                fallbackShiftY
            );
            const fallbackCardPaneTop = fallbackVerticalLayout.cardPaneTop + fallbackShiftY;

            return {
                cardPane: {
                    x: fallbackLeft,
                    y: fallbackCardPaneTop,
                    w: fallbackWidth,
                    h: fallbackCardHeight,
                    radius: Math.max(18, Math.min(fallbackWidth, fallbackCardHeight) * 0.06)
                },
                utilityPane: fallbackUtilityLayout.utilityPane,
                cardOffsetX: 0,
                cardOffsetY: 0,
                secondaryMenuItems: fallbackUtilityLayout.secondaryMenuItems
            };
        }

        let groupMinX = Infinity;
        let groupMinY = Infinity;
        let groupMaxX = -Infinity;
        let groupMaxY = -Infinity;

        for (const rect of layoutRects) {
            groupMinX = Math.min(groupMinX, rect.x);
            groupMinY = Math.min(groupMinY, rect.y);
            groupMaxX = Math.max(groupMaxX, rect.x + rect.w);
            groupMaxY = Math.max(groupMaxY, rect.y + rect.h);
        }

        const groupHeight = groupMaxY - groupMinY;
        const groupWidth = groupMaxX - groupMinX;
        const verticalPadding = Math.max(24, this.WH * 0.026);
        const sidePadding = verticalPadding;
        const rightOuterGap = Math.max(28, this.UIWW * 0.024);
        const paneRight = this.UIOffsetX + this.UIWW - rightOuterGap;
        const paneLeft = paneRight - groupWidth - (sidePadding * 2);
        const paneWidth = groupWidth + (sidePadding * 2);
        const cardContentHeight = groupHeight;
        const cardPaneHeight = Math.max(1, cardContentHeight + (verticalPadding * 2));
        const verticalLayout = this.#resolveRightPaneVerticalLayout(cardPaneHeight);
        const paneShiftY = this.#resolveMainMenuVerticalShift(
            verticalLayout.cardPaneTop,
            cardPaneHeight
        );
        const cardPaneTop = verticalLayout.cardPaneTop + paneShiftY;
        const cardPaneBottom = cardPaneTop + cardPaneHeight;
        const cardOffsetX = (paneLeft + sidePadding) - groupMinX;
        const cardOffsetY = (cardPaneTop + verticalPadding) - groupMinY;
        const utilityPaneLayout = this.#translateUtilityPaneLayout(
            this.#buildUtilityPaneLayout(
                paneRight,
                paneWidth,
                verticalLayout.utilityPaneTop,
                sidePadding,
                verticalPadding
            ),
            paneShiftY
        );

        return {
            cardPane: {
                x: paneLeft,
                y: cardPaneTop,
                w: paneWidth,
                h: Math.max(1, cardPaneBottom - cardPaneTop),
                radius: Math.max(18, Math.min(paneWidth, Math.max(1, cardPaneBottom - cardPaneTop)) * 0.06)
            },
            utilityPane: utilityPaneLayout.utilityPane,
            cardOffsetX,
            cardOffsetY,
            secondaryMenuItems: utilityPaneLayout.secondaryMenuItems
        };
    }

    /**
     * 주 메뉴 pane을 화면 높이 중앙에 맞추기 위한 이동값을 계산합니다.
     * @param {number} cardPaneTop - 기존 주 메뉴 pane 상단 위치입니다.
     * @param {number} cardPaneHeight - 주 메뉴 pane 높이입니다.
     * @returns {number} 주 메뉴와 서브 메뉴에 공통 적용할 Y 이동값입니다.
     * @private
     */
    #resolveMainMenuVerticalShift(cardPaneTop, cardPaneHeight) {
        const resolvedHeight = Math.max(1, cardPaneHeight);
        const centeredCardPaneTop = (this.WH - resolvedHeight) * 0.5;
        return centeredCardPaneTop - cardPaneTop;
    }

    /**
     * 하단 서브 메뉴 레이아웃 전체를 지정한 Y 값만큼 이동합니다.
     * @param {{utilityPane:object, secondaryMenuItems:object[]}} utilityPaneLayout - 이동할 서브 메뉴 배치입니다.
     * @param {number} shiftY - 적용할 Y 이동값입니다.
     * @returns {{utilityPane:object, secondaryMenuItems:object[]}} 이동이 반영된 서브 메뉴 배치입니다.
     * @private
     */
    #translateUtilityPaneLayout(utilityPaneLayout, shiftY) {
        return {
            utilityPane: {
                ...utilityPaneLayout.utilityPane,
                y: utilityPaneLayout.utilityPane.y + shiftY
            },
            secondaryMenuItems: utilityPaneLayout.secondaryMenuItems.map((menuItem) => ({
                ...menuItem,
                y: menuItem.y + shiftY
            }))
        };
    }

    /**
     * 오른쪽 상단/하단 글래스 패널의 세로 배치를 계산합니다.
     * @param {number} cardPaneHeight - 상단 카드 패널 높이입니다.
     * @returns {{cardPaneTop:number, utilityPaneTop:number}} 계산된 세로 배치 정보입니다.
     * @private
     */
    #resolveRightPaneVerticalLayout(cardPaneHeight) {
        const paneGroupShiftY = Math.max(10, this.WH * 0.014);
        const cardPaneTop = (this.WH * 0.22) + paneGroupShiftY;
        const cardPaneBottom = cardPaneTop + Math.max(1, cardPaneHeight);
        const shiftedUtilityPaneTop = (this.WH * TITLE_CARD_MENU.UTILITY_PANE_TOP_WH_RATIO) + paneGroupShiftY;
        const gapReduction = Math.max(10, this.WH * 0.012);
        const minimumPaneGap = Math.max(18, this.WH * 0.02);
        const basePaneGap = Math.max(0, shiftedUtilityPaneTop - cardPaneBottom);
        const resolvedPaneGap = Math.max(minimumPaneGap, basePaneGap - gapReduction);

        return {
            cardPaneTop,
            utilityPaneTop: cardPaneBottom + resolvedPaneGap
        };
    }

    /**
     * 하단 보조 메뉴 타일 패널과 아이템 배치를 계산합니다.
     * @param {number} paneRight - 패널 끝 X 좌표입니다.
     * @param {number} paneWidth - 패널 너비입니다.
     * @param {number} paneTop - 패널 시작 Y 좌표입니다.
     * @param {number} sidePadding - 좌우 패딩입니다.
     * @param {number} verticalPadding - 상하 패딩입니다.
     * @returns {{utilityPane:object, secondaryMenuItems:object[]}} 계산된 하단 패널 레이아웃입니다.
     * @private
     */
    #buildUtilityPaneLayout(paneRight, paneWidth, paneTop, sidePadding, verticalPadding) {
        const entryCount = Math.max(1, this.secondaryMenuEntries.length);
        const tileGap = Math.max(10, this.UIWW * TITLE_CARD_MENU.UTILITY_TILE_GAP_UIWW_RATIO);
        const baseContentWidth = Math.max(1, paneWidth - (sidePadding * 2));
        const targetTileSize = Math.max(
            1,
            this.UIWW * TITLE_CARD_MENU.UTILITY_TILE_TARGET_SIZE_UIWW_RATIO
        );
        const baseTileSize = Math.max(
            1,
            Math.min(
                targetTileSize,
                (baseContentWidth - (tileGap * Math.max(0, entryCount - 1))) / entryCount
            )
        );
        const maxPaneWidth = Math.max(1, paneRight - this.UIOffsetX);
        const maxTileSize = Math.max(
            1,
            (
                maxPaneWidth
                - (sidePadding * 2)
                - (tileGap * Math.max(0, entryCount - 1))
            ) / entryCount
        );
        const preferredTileSize = Math.max(1, baseTileSize * TITLE_CARD_MENU.UTILITY_TILE_SCALE);
        const tileSize = Math.min(preferredTileSize, maxTileSize);
        const utilityPaneWidth = (tileSize * entryCount)
            + (tileGap * Math.max(0, entryCount - 1))
            + (sidePadding * 2);
        const utilityPaneX = paneRight - utilityPaneWidth;
        const contentWidth = Math.max(1, utilityPaneWidth - (sidePadding * 2));
        const utilityPaneHeight = Math.max(1, tileSize + (verticalPadding * 2));
        const utilityPane = {
            x: utilityPaneX,
            y: paneTop,
            w: utilityPaneWidth,
            h: utilityPaneHeight,
            radius: Math.max(18, Math.min(utilityPaneWidth, utilityPaneHeight) * 0.08)
        };
        const tileRowWidth = (tileSize * entryCount) + (tileGap * Math.max(0, entryCount - 1));
        const startX = utilityPaneX + sidePadding + Math.max(0, (contentWidth - tileRowWidth) * 0.5);
        const tileY = paneTop + ((utilityPaneHeight - tileSize) * 0.5);
        const secondaryMenuItems = this.secondaryMenuEntries.map((entry, index) => ({
            ...entry,
            x: startX + (index * (tileSize + tileGap)),
            y: tileY,
            w: tileSize,
            h: tileSize,
            radius: Math.max(8, tileSize * TITLE_CARD_MENU.UTILITY_TILE_CORNER_RADIUS_RATIO),
            placeholderSize: Math.max(12, tileSize * TITLE_CARD_MENU.UTILITY_TILE_PLACEHOLDER_SCALE)
        }));

        return {
            utilityPane,
            secondaryMenuItems
        };
    }

    /**
     * 현재 카드 등장 시간축을 기준으로 오른쪽 패널 렌더 상태를 계산합니다.
     * @param {object} paneLayout - 최종 패널 배치 정보입니다.
     * @returns {{cardPane:object, utilityPane:object}} 렌더용 패널 상태입니다.
     * @private
     */
    #buildPaneRenderState(paneLayout) {
        const revealCoreDuration = this.#getCardRevealCoreDuration();
        const cardPaneProgress = this.#getRevealProgress(0, Math.max(0.28, revealCoreDuration * 0.54));
        const cardPaneEase = easeOutCubic(cardPaneProgress);
        const utilityPaneEase = this.#getUtilityPaneRevealEase();

        return {
            cardPane: this.#createPaneRenderRect(
                paneLayout.cardPane,
                cardPaneEase,
                this.UIWW * 0.032,
                0
            ),
            utilityPane: this.#createPaneRenderRect(
                paneLayout.utilityPane,
                utilityPaneEase,
                this.UIWW * 0.026,
                0
            )
        };
    }

    /**
     * 하단 서브 메뉴 pane과 동기화된 등장 이징 값을 반환합니다.
     * @returns {number} 서브 메뉴 등장 이징 값입니다.
     * @private
     */
    #getUtilityPaneRevealEase() {
        const revealCoreDuration = this.#getCardRevealCoreDuration();
        const utilityPaneProgress = this.#getRevealProgress(
            Math.min(0.16, revealCoreDuration * 0.18),
            Math.max(0.24, revealCoreDuration * 0.44)
        );

        return easeOutCubic(utilityPaneProgress);
    }

    /**
     * 하단 보조 메뉴 클릭 액션을 실행합니다.
     * @param {object} menuItem - 클릭된 메뉴 항목입니다.
     * @private
     */
    #handleSecondaryMenuAction(menuItem) {
        if (!menuItem) {
            return;
        }

        if (menuItem.actionType === 'overlay') {
            this.TitleScene.openTitleOverlay(menuItem.actionKey);
            return;
        }

        if (menuItem.actionType === 'exit') {
            this.TitleScene?.sceneSystem?.systemHandler?.overlayManager?.openExitOverlay?.();
        }
    }

    /**
     * 카드 외곽 pane용 텍스처 캔버스를 구성합니다.
     * @param {object} cardPaneRect - 카드 pane 영역입니다.
     * @returns {HTMLCanvasElement|null} 생성된 패널 텍스처 캔버스입니다.
     * @private
     */
    #buildCardPaneTextureCanvas(cardPaneRect) {
        if (
            !cardPaneRect
            || this.cardPaneInteractionState.spotlightAlpha <= 0.005
            && this.cardPaneInteractionState.borderAlpha <= 0.005
        ) {
            return null;
        }

        if (!this.cardPaneTextureCanvas || !this.cardPaneTextureContext) {
            this.cardPaneTextureCanvas = document.createElement('canvas');
            this.cardPaneTextureContext = this.cardPaneTextureCanvas.getContext('2d');
        }

        const canvasWidth = Math.max(1, Math.ceil(cardPaneRect.w));
        const canvasHeight = Math.max(1, Math.ceil(cardPaneRect.h));

        if (this.cardPaneTextureCanvas.width !== canvasWidth) {
            this.cardPaneTextureCanvas.width = canvasWidth;
        }
        if (this.cardPaneTextureCanvas.height !== canvasHeight) {
            this.cardPaneTextureCanvas.height = canvasHeight;
        }

        const context = this.cardPaneTextureContext;
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvasWidth, canvasHeight);
        context.save();
        context.setTransform(1, 0, 0, -1, 0, canvasHeight);
        context.beginPath();
        context.roundRect(0, 0, cardPaneRect.w, cardPaneRect.h, cardPaneRect.radius);
        context.clip();

        this.#drawPaneForegroundEffects(context, this.cardPaneInteractionState, cardPaneRect);
        context.restore();
        this.#markTextureCanvasUpdated(this.cardPaneTextureCanvas);
        return this.cardPaneTextureCanvas;
    }

    /**
     * 오른쪽 utility glass 패널용 텍스처 캔버스를 구성합니다.
     * @param {object} utilityPane - 유틸리티 판넬 영역입니다.
     * @param {object} paneInteractionState - 유틸리티 판넬 상호작용 상태입니다.
     * @returns {HTMLCanvasElement|null} 생성된 패널 텍스처 캔버스입니다.
     * @private
     */
    #buildRightPaneTextureCanvas(
        utilityPane,
        paneInteractionState = this.utilityPaneInteractionState
    ) {
        if (
            !utilityPane
            || !paneInteractionState
            || (
                paneInteractionState.spotlightAlpha <= 0.005
                && paneInteractionState.borderAlpha <= 0.005
            )
        ) {
            return null;
        }

        const canvasWidth = Math.max(1, Math.ceil(utilityPane.w));
        const canvasHeight = Math.max(1, Math.ceil(utilityPane.h));

        if (!this.paneTextureCanvas || !this.paneTextureContext) {
            this.paneTextureCanvas = document.createElement('canvas');
            this.paneTextureContext = this.paneTextureCanvas.getContext('2d');
        }

        if (this.paneTextureCanvas.width !== canvasWidth) {
            this.paneTextureCanvas.width = canvasWidth;
        }
        if (this.paneTextureCanvas.height !== canvasHeight) {
            this.paneTextureCanvas.height = canvasHeight;
        }

        const context = this.paneTextureContext;
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvasWidth, canvasHeight);
        context.save();
        context.setTransform(1, 0, 0, -1, 0, canvasHeight);
        context.beginPath();
        context.roundRect(0, 0, utilityPane.w, utilityPane.h, utilityPane.radius);
        context.clip();

        this.#drawPaneForegroundEffects(context, paneInteractionState, utilityPane);
        context.restore();
        this.#markTextureCanvasUpdated(this.paneTextureCanvas);
        return this.paneTextureCanvas;
    }

    /**
     * 하단 보조 메뉴 타일용 텍스처 캔버스를 구성합니다.
     * @param {object} renderState - 타일 렌더 상태입니다.
     * @param {object} runtimeState - 타일 런타임 상태입니다.
     * @returns {HTMLCanvasElement|null} 생성된 타일 텍스처 캔버스입니다.
     * @private
     */
    #buildUtilityTileTextureCanvas(renderState, runtimeState) {
        if (!hasTitleMenuDynamicTextureState(runtimeState)) {
            return this.#getStaticUtilityTileTextureCanvas(renderState, runtimeState);
        }

        const panelRect = renderState.panelRect;
        const canvasWidth = Math.max(1, Math.ceil(panelRect.w));
        const canvasHeight = Math.max(1, Math.ceil(panelRect.h));

        if (!runtimeState.textureCanvas || !runtimeState.textureContext) {
            runtimeState.textureCanvas = document.createElement('canvas');
            runtimeState.textureContext = runtimeState.textureCanvas.getContext('2d');
        }

        if (runtimeState.textureCanvas.width !== canvasWidth) {
            runtimeState.textureCanvas.width = canvasWidth;
        }
        if (runtimeState.textureCanvas.height !== canvasHeight) {
            runtimeState.textureCanvas.height = canvasHeight;
        }

        const context = runtimeState.textureContext;
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvasWidth, canvasHeight);
        context.save();
        context.setTransform(1, 0, 0, -1, 0, canvasHeight);
        context.beginPath();
        context.roundRect(0, 0, panelRect.w, panelRect.h, panelRect.radius);
        context.clip();

        this.#drawCardBackgroundEffects(context, runtimeState, renderState);
        this.#drawUtilityTileContent(context, renderState, runtimeState.hovered);
        this.#drawCardForegroundEffects(context, runtimeState, renderState);
        context.restore();
        this.#markTextureCanvasUpdated(runtimeState.textureCanvas);
        return runtimeState.textureCanvas;
    }

    /**
     * 하단 보조 메뉴 타일 콘텐츠를 그립니다.
     * @param {CanvasRenderingContext2D} context - 대상 컨텍스트입니다.
     * @param {object} renderState - 타일 렌더 상태입니다.
     * @param {boolean} hovered - hover 여부입니다.
     * @private
     */
    #drawUtilityTileContent(context, renderState, hovered) {
        const panelRect = renderState.panelRect;
        const placeholderSize = Number.isFinite(renderState.placeholderSize)
            ? renderState.placeholderSize
            : Math.max(12, Math.min(panelRect.w, panelRect.h) * TITLE_CARD_MENU.UTILITY_TILE_PLACEHOLDER_SCALE);
        const iconMetrics = getTitleMenuUtilityTileIconMetrics(panelRect, placeholderSize);
        const placeholderAlpha = hovered ? 1 : getMenuOpacity('Placeholder', 0.92);
        const placeholderRadius = Math.max(4, placeholderSize * TITLE_CARD_MENU.UTILITY_TILE_PLACEHOLDER_RADIUS_RATIO);

        this.#drawInnerEdges(context, panelRect, hovered ? 0.16 : 0);
        if (drawTitleMenuIcon(context, this.svgDrawer, renderState.id, iconMetrics, placeholderAlpha)) {
            return;
        }

        drawTitleMenuPlaceholderIcon(context, iconMetrics, placeholderAlpha, placeholderRadius);
    }

    /**
     * 패널 앞면 상호작용 효과를 렌더합니다.
     * @param {CanvasRenderingContext2D} context - 렌더 대상 컨텍스트입니다.
     * @param {object} paneState - 판넬 상호작용 상태입니다.
     * @param {object} panelRect - 판넬 rect입니다.
     * @private
     */
    #drawPaneForegroundEffects(context, paneState, panelRect) {
        const spotlightOptions = this.session?.getEffectOptions('hoverSpotlight');
        const borderOptions = this.session?.getEffectOptions('hoverBorder');
        const effectColor = this.#getEffectColor();

        if (spotlightOptions && paneState.spotlightAlpha > 0.005) {
            drawTitleMenuCardSpotlight(context, paneState, spotlightOptions, effectColor);
        }

        if (borderOptions && paneState.borderAlpha > 0.005) {
            drawTitleMenuCardBorder(context, paneState, { panelRect }, borderOptions, effectColor);
        }
    }

    /**
     * 카드 콘텐츠와 인터랙션 효과를 담은 텍스처 캔버스를 구성합니다.
     * @param {TitleMenuCard} card - 대상 카드입니다.
     * @param {object} runtimeState - 카드 런타임 상태입니다.
     * @param {object} renderState - 카드 렌더 상태입니다.
     * @returns {HTMLCanvasElement|null} 생성된 텍스처 캔버스입니다.
     * @private
     */
    #buildCardTextureCanvas(card, runtimeState, renderState) {
        if (!hasTitleMenuDynamicTextureState(runtimeState, renderState)) {
            return this.#getStaticCardTextureCanvas(card, runtimeState, renderState);
        }

        const panelRect = renderState.panelRect;
        const canvasWidth = Math.max(1, Math.ceil(panelRect.w));
        const canvasHeight = Math.max(1, Math.ceil(panelRect.h));

        if (!runtimeState.textureCanvas || !runtimeState.textureContext) {
            runtimeState.textureCanvas = document.createElement('canvas');
            runtimeState.textureContext = runtimeState.textureCanvas.getContext('2d');
        }

        if (runtimeState.textureCanvas.width !== canvasWidth) {
            runtimeState.textureCanvas.width = canvasWidth;
        }
        if (runtimeState.textureCanvas.height !== canvasHeight) {
            runtimeState.textureCanvas.height = canvasHeight;
        }

        const context = runtimeState.textureContext;
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvasWidth, canvasHeight);
        context.save();
        context.setTransform(1, 0, 0, -1, 0, canvasHeight);
        context.beginPath();
        context.roundRect(0, 0, panelRect.w, panelRect.h, panelRect.radius);
        context.clip();

        this.#drawCardBackgroundEffects(context, runtimeState, renderState);
        this.#drawFrontfaceContent(context, card, renderState);
        this.#drawCardForegroundEffects(context, runtimeState, renderState);
        context.restore();
        this.#markTextureCanvasUpdated(runtimeState.textureCanvas);
        return runtimeState.textureCanvas;
    }

    /**
     * 카드의 정적 앞면 텍스처를 반환합니다.
     * @param {TitleMenuCard} card - 대상 카드입니다.
     * @param {object} runtimeState - 카드 런타임 상태입니다.
     * @param {object} renderState - 카드 렌더 상태입니다.
     * @returns {HTMLCanvasElement|null} 정적 카드 텍스처입니다.
     * @private
     */
    #getStaticCardTextureCanvas(card, runtimeState, renderState) {
        const panelRect = renderState?.panelRect;
        if (!runtimeState || !panelRect) {
            return null;
        }

        const canvasWidth = Math.max(1, Math.ceil(panelRect.w));
        const canvasHeight = Math.max(1, Math.ceil(panelRect.h));
        const signature = this.#buildCardStaticTextureSignature(card, renderState);

        if (!runtimeState.staticTextureCanvas || !runtimeState.staticTextureContext) {
            runtimeState.staticTextureCanvas = document.createElement('canvas');
            runtimeState.staticTextureContext = runtimeState.staticTextureCanvas.getContext('2d');
        }

        const canvas = runtimeState.staticTextureCanvas;
        const sizeChanged = canvas.width !== canvasWidth || canvas.height !== canvasHeight;
        if (!sizeChanged && runtimeState.staticTextureSignature === signature) {
            return canvas;
        }

        if (canvas.width !== canvasWidth) {
            canvas.width = canvasWidth;
        }
        if (canvas.height !== canvasHeight) {
            canvas.height = canvasHeight;
        }

        const context = runtimeState.staticTextureContext;
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvasWidth, canvasHeight);
        context.save();
        context.setTransform(1, 0, 0, -1, 0, canvasHeight);
        context.beginPath();
        context.roundRect(0, 0, panelRect.w, panelRect.h, panelRect.radius);
        context.clip();
        this.#drawFrontfaceContent(context, card, {
            ...renderState,
            hoverProgress: 0
        });
        context.restore();

        runtimeState.staticTextureSignature = signature;
        this.#markTextureCanvasUpdated(canvas);
        return canvas;
    }

    /**
     * 유틸리티 타일의 정적 텍스처를 반환합니다.
     * @param {object} renderState - 타일 렌더 상태입니다.
     * @param {object} runtimeState - 타일 런타임 상태입니다.
     * @returns {HTMLCanvasElement|null} 정적 타일 텍스처입니다.
     * @private
     */
    #getStaticUtilityTileTextureCanvas(renderState, runtimeState) {
        const panelRect = renderState?.panelRect;
        if (!runtimeState || !panelRect) {
            return null;
        }

        const canvasWidth = Math.max(1, Math.ceil(panelRect.w));
        const canvasHeight = Math.max(1, Math.ceil(panelRect.h));
        const signature = this.#buildUtilityTileStaticTextureSignature(renderState, runtimeState);

        if (!runtimeState.staticTextureCanvas || !runtimeState.staticTextureContext) {
            runtimeState.staticTextureCanvas = document.createElement('canvas');
            runtimeState.staticTextureContext = runtimeState.staticTextureCanvas.getContext('2d');
        }

        const canvas = runtimeState.staticTextureCanvas;
        const sizeChanged = canvas.width !== canvasWidth || canvas.height !== canvasHeight;
        if (!sizeChanged && runtimeState.staticTextureSignature === signature) {
            return canvas;
        }

        if (canvas.width !== canvasWidth) {
            canvas.width = canvasWidth;
        }
        if (canvas.height !== canvasHeight) {
            canvas.height = canvasHeight;
        }

        const context = runtimeState.staticTextureContext;
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvasWidth, canvasHeight);
        context.save();
        context.setTransform(1, 0, 0, -1, 0, canvasHeight);
        context.beginPath();
        context.roundRect(0, 0, panelRect.w, panelRect.h, panelRect.radius);
        context.clip();
        this.#drawUtilityTileContent(context, renderState, runtimeState.hovered);
        context.restore();

        runtimeState.staticTextureSignature = signature;
        this.#markTextureCanvasUpdated(canvas);
        return canvas;
    }

    /**
     * 카드 정적 텍스처 캐시 식별자를 생성합니다.
     * @param {TitleMenuCard} card - 대상 카드입니다.
     * @param {object} renderState - 카드 렌더 상태입니다.
     * @returns {string} 캐시 식별자입니다.
     * @private
     */
    #buildCardStaticTextureSignature(card, renderState) {
        const panelRect = renderState.panelRect;
        const title = getLangString(card.cardDefinition.titleKey);
        const description = card.cardDefinition.descriptionKey ? getLangString(card.cardDefinition.descriptionKey) : '';

        return [
            'card',
            card.cardDefinition.id,
            Math.ceil(panelRect.w),
            Math.ceil(panelRect.h),
            Math.ceil(panelRect.radius),
            title,
            description,
            Math.round(this.UIWW),
            Math.round(this.WH),
            getTitleMenuTextPresetFontSize(TEXT_CONSTANTS, this.UIWW, 'H6'),
            this.#getStaticTextureThemeSignature(),
            this.#getIconTextureSignature(card.cardDefinition.id)
        ].join('|');
    }

    /**
     * 유틸리티 타일 정적 텍스처 캐시 식별자를 생성합니다.
     * @param {object} renderState - 타일 렌더 상태입니다.
     * @param {object} runtimeState - 타일 런타임 상태입니다.
     * @returns {string} 캐시 식별자입니다.
     * @private
     */
    #buildUtilityTileStaticTextureSignature(renderState, runtimeState) {
        const panelRect = renderState.panelRect;
        return [
            'utility',
            renderState.id,
            Math.ceil(panelRect.w),
            Math.ceil(panelRect.h),
            Math.ceil(panelRect.radius),
            Number(runtimeState.hovered === true),
            Math.ceil(renderState.placeholderSize || 0),
            Math.round(this.UIWW),
            Math.round(this.WH),
            this.#getStaticTextureThemeSignature(),
            this.#getIconTextureSignature(renderState.id)
        ].join('|');
    }

    /**
     * 정적 텍스처에 영향을 주는 테마 값을 문자열로 묶습니다.
     * @returns {string} 테마 캐시 식별자입니다.
     * @private
     */
    #getStaticTextureThemeSignature() {
        return buildMenuStaticTextureThemeSignature();
    }

    /**
     * 아이콘 로딩 상태를 정적 텍스처 캐시에 반영할 식별자로 변환합니다.
     * @param {string} iconId - 아이콘 식별자입니다.
     * @returns {string} 아이콘 캐시 식별자입니다.
     * @private
     */
    #getIconTextureSignature(iconId) {
        const iconSource = getTitleMenuIconSource(iconId) || '';
        const iconRecord = iconSource ? this.svgDrawer.getCachedSvgFile(iconSource) : null;
        return [
            iconSource,
            Number(Boolean(iconRecord?.image)),
            Number.isFinite(iconRecord?.aspectRatio) ? iconRecord.aspectRatio : 0
        ].join(':');
    }

    /**
     * 캔버스 텍스처 revision을 증가시켜 WebGL 업로드 캐시에 변경을 알립니다.
     * @param {HTMLCanvasElement|null} canvas - 갱신된 텍스처 캔버스입니다.
     * @private
     */
    #markTextureCanvasUpdated(canvas) {
        if (!canvas) {
            return;
        }

        this.textureRevisionCounter += 1;
        if (this.textureRevisionCounter >= Number.MAX_SAFE_INTEGER) {
            this.textureRevisionCounter = 1;
        }
        canvas.__overlayTextureRevision = this.textureRevisionCounter;
    }

    /**
     * 카드 콘텐츠 아래에 깔리는 인터랙션 효과를 그립니다.
     * @param {CanvasRenderingContext2D} context - 대상 컨텍스트입니다.
     * @param {object} runtimeState - 카드 런타임 상태입니다.
     * @param {object} renderState - 카드 렌더 상태입니다.
     * @private
     */
    #drawCardBackgroundEffects(context, runtimeState, renderState) {
        if (runtimeState.particles.length <= 0 || runtimeState.particleAlpha <= 0.005) {
            return;
        }

        drawTitleMenuCardParticles(context, renderState, runtimeState, this.#getEffectColor());
    }

    /**
     * 카드 앞면 콘텐츠를 그립니다.
     * @param {CanvasRenderingContext2D} context - 대상 컨텍스트입니다.
     * @param {TitleMenuCard} card - 대상 카드입니다.
     * @param {object} renderState - 카드 렌더 상태입니다.
     * @private
     */
    #drawFrontfaceContent(context, card, renderState) {
        const panelRect = renderState.panelRect;
        const inset = Math.max(16, panelRect.w * 0.08);
        const title = getLangString(card.cardDefinition.titleKey);
        const description = card.cardDefinition.descriptionKey ? getLangString(card.cardDefinition.descriptionKey) : '';
        const isCompactHorizontalCard = card.cardDefinition.id === 'records';
        const iconMetrics = getTitleMenuCardIconMetrics(card.cardDefinition.id, panelRect, inset);
        const titleFontSize = Math.max(
            16,
            panelRect.w * (panelRect.h > panelRect.w * 0.7 ? 0.095 : 0.08),
            isCompactHorizontalCard ? panelRect.h * 0.28 : 0
        );
        const descriptionFontSize = getTitleMenuTextPresetFontSize(TEXT_CONSTANTS, this.UIWW, 'H6');
        const descriptionLineHeight = descriptionFontSize * 1.32;
        const titleLineHeight = titleFontSize * 1.06;
        const bottomPadding = inset * 0.8;
        const descriptionY = panelRect.h - bottomPadding - descriptionLineHeight;
        const titleY = description
            ? descriptionY - (descriptionLineHeight * 0.4928) - titleLineHeight
            : panelRect.h - bottomPadding - titleLineHeight;

        drawTitleMenuCardIcon(context, this.svgDrawer, card.cardDefinition.id, iconMetrics);
        this.#drawInnerEdges(context, panelRect, renderState.hoverProgress || 0);

        if (isCompactHorizontalCard) {
            const titleX = iconMetrics.x + iconMetrics.w + Math.max(14, panelRect.w * 0.06);
            drawTitleMenuWrappedText(context, {
                text: title,
                x: titleX,
                y: (panelRect.h - titleLineHeight) * 0.5,
                maxWidth: panelRect.w - titleX - inset,
                lineHeight: titleLineHeight,
                font: `700 ${titleFontSize}px "Pretendard Variable", arial`,
                fillStyle: getMenuCardTitleColor(),
                align: 'left'
            });
            return;
        }

        drawTitleMenuWrappedText(context, {
            text: title,
            x: inset,
            y: titleY,
            maxWidth: panelRect.w - (inset * 2),
            lineHeight: titleLineHeight,
            font: `700 ${titleFontSize}px "Pretendard Variable", arial`,
            fillStyle: getMenuCardTitleColor(),
            align: 'left'
        });

        if (description) {
            drawTitleMenuWrappedText(context, {
                text: description,
                x: inset,
                y: descriptionY,
                maxWidth: panelRect.w - (inset * 2),
                lineHeight: descriptionLineHeight,
                font: `500 ${descriptionFontSize}px "Pretendard Variable", arial`,
                fillStyle: getMenuCardDescriptionColor(),
                align: 'left'
            });
        }
    }

    /**
     * 카드 내부 장식선을 그립니다.
     * @param {CanvasRenderingContext2D} context - 대상 컨텍스트입니다.
     * @param {{w:number, h:number}} panelRect - 카드 패널 영역입니다.
     * @param {number} emphasisProgress - 카드 강조 진행률입니다.
     * @private
     */
    #drawInnerEdges(context, panelRect, emphasisProgress) {
        context.save();
        context.strokeStyle = menuForegroundWithAlpha(
            getMenuOpacity('CardInnerLine', 0.08)
            + (emphasisProgress * getMenuOpacity('CardInnerLineFocusDelta', 0.08))
        );
        context.lineWidth = 1;
        context.beginPath();
        context.roundRect(1.5, 1.5, panelRect.w - 3, panelRect.h - 3, Math.max(8, panelRect.radius - 3));
        context.stroke();
        context.restore();
    }

    /**
     * 카드 전용 인터랙션 효과를 그립니다.
     * @param {CanvasRenderingContext2D} context - 대상 컨텍스트입니다.
     * @param {object} runtimeState - 카드 런타임 상태입니다.
     * @param {object} renderState - 카드 렌더 상태입니다.
     * @private
     */
    #drawCardForegroundEffects(context, runtimeState, renderState) {
        const effectColor = this.#getEffectColor();
        const spotlightOptions = this.session?.getEffectOptions('hoverSpotlight');
        const borderOptions = this.session?.getEffectOptions('hoverBorder');

        if (spotlightOptions && runtimeState.spotlightAlpha > 0.005) {
            drawTitleMenuCardSpotlight(context, runtimeState, spotlightOptions, effectColor);
        }

        if (borderOptions && runtimeState.borderAlpha > 0.005) {
            drawTitleMenuCardBorder(context, runtimeState, renderState, borderOptions, effectColor);
        }

        if (runtimeState.ripples.length > 0) {
            drawTitleMenuCardRipples(context, runtimeState, effectColor);
        }
    }

    /**
     * 우상단에 현재 게임 버전 라벨을 렌더링합니다.
     * @param {object} [paneLayout=null] - 현재 오른쪽 패널 배치 정보입니다.
     * @private
     */
    #drawGameVersionLabel(paneLayout = null) {
        if (!this.session) {
            return;
        }

        const layout = this.#buildVersionLabelLayout(paneLayout);
        if (!layout || layout.alpha <= 0.005) {
            return;
        }
        const linkHoverValue = clampNumber(this.versionHistoryLinkButton?.hoverValue || 0, 0, 1);
        const linkColor = menuForegroundWithAlpha(lerpNumber(0.42, 1, linkHoverValue));
        const textShadowBlur = Math.max(4, this.WH * 0.008);
        const textShadowColor = menuForegroundWithAlpha(0.08);

        this.session.renderPanel({
            shape: 'text',
            text: layout.versionText,
            x: layout.versionX,
            y: layout.versionY,
            font: layout.versionFont,
            fill: menuForegroundWithAlpha(0.42),
            align: 'right',
            baseline: 'top',
            alpha: layout.alpha,
            shadowBlur: textShadowBlur,
            shadowColor: textShadowColor
        });

        if (!layout.linkText) {
            return;
        }

        this.#drawVersionHistoryLinkArrow(layout, linkColor, textShadowBlur, textShadowColor);

        this.session.renderPanel({
            shape: 'text',
            text: layout.linkText,
            x: layout.linkTextX,
            y: layout.linkY,
            font: layout.linkFont,
            fill: linkColor,
            align: 'right',
            baseline: 'top',
            alpha: layout.alpha,
            shadowBlur: textShadowBlur,
            shadowColor: textShadowColor
        });
    }

    /**
     * 버전 정보 블록의 텍스트, 폰트, hitbox를 계산합니다.
     * @param {object} [paneLayout=null] - 현재 오른쪽 패널 배치 정보입니다.
     * @returns {object|null} 버전 정보 블록 렌더 레이아웃입니다.
     * @private
     */
    #buildVersionLabelLayout(paneLayout = null) {
        const versionText = getTitleMenuGameVersionText(GLOBAL_CONSTANTS);
        if (!versionText) {
            return null;
        }

        const versionFontSize = getTitleMenuTextPresetFontSize(TEXT_CONSTANTS, this.UIWW, 'H5');
        const linkFontSize = getTitleMenuTextPresetFontSize(TEXT_CONSTANTS, this.UIWW, 'H5_BOLD');
        const versionFont = getTitleMenuTextPresetFont(TEXT_CONSTANTS, this.UIWW, 'H5');
        const linkFont = getTitleMenuTextPresetFont(TEXT_CONSTANTS, this.UIWW, 'H5_BOLD');
        const linkText = getTitleMenuVersionHistoryLinkText();
        const linkTextWidth = linkText ? this.#measureTextWidth(linkText, linkFont) : 0;

        return buildTitleMenuVersionLabelLayout({
            paneLayout,
            uiww: this.UIWW,
            wh: this.WH,
            uiOffsetX: this.UIOffsetX,
            utilityPaneRevealEase: this.#getUtilityPaneRevealEase(),
            versionText,
            versionFont,
            versionFontSize,
            linkText,
            linkFont,
            linkFontSize,
            linkTextWidth
        });
    }

    /**
     * 업데이트 링크 좌측의 화살표 아이콘을 그립니다.
     * @param {object} layout - 버전 정보 블록 렌더 레이아웃입니다.
     * @param {string} strokeColor - 화살표 선 색상입니다.
     * @param {number} shadowBlur - 그림자 블러 값입니다.
     * @param {string} shadowColor - 그림자 색상입니다.
     * @private
     */
    #drawVersionHistoryLinkArrow(layout, strokeColor, shadowBlur, shadowColor) {
        const iconSize = Number(layout?.linkIconSize) || 0;
        if (!this.session || iconSize <= 0) {
            return;
        }

        const x = Number(layout.linkIconX) || 0;
        const y = Number(layout.linkIconY) || 0;
        const centerX = x + (iconSize * 0.5);
        const centerY = y + (iconSize * 0.5);
        const halfSpan = iconSize * 0.308;
        const headLength = halfSpan * 0.88;
        const lineWidth = Math.max(1, iconSize * 0.1);
        const commonOptions = {
            shape: 'line',
            stroke: strokeColor,
            alpha: layout.alpha,
            lineWidth,
            lineCap: 'round',
            shadowBlur,
            shadowColor
        };

        this.session.renderPanel({
            ...commonOptions,
            x1: centerX - halfSpan,
            y1: centerY,
            x2: centerX + halfSpan,
            y2: centerY
        });
        this.session.renderPanel({
            ...commonOptions,
            x1: centerX + halfSpan - headLength,
            y1: centerY - headLength,
            x2: centerX + halfSpan,
            y2: centerY
        });
        this.session.renderPanel({
            ...commonOptions,
            x1: centerX + halfSpan - headLength,
            y1: centerY + headLength,
            x2: centerX + halfSpan,
            y2: centerY
        });
    }

    /**
     * 업데이트 내역 링크를 외부 브라우저에서 엽니다.
     * @private
     */
    #openVersionHistoryLink() {
        const url = String(TITLE_LINK_DATA.UPDATE_HISTORY_URL || '').trim();
        if (!url) {
            return;
        }

        runtimeTool()?.openURL?.(url);
    }

    /**
     * 업데이트 내역 버튼 클릭을 처리합니다.
     * @private
     */
    #handleVersionHistoryLinkClick() {
        if (!consumeMouseState('left')) {
            return;
        }

        this.#openVersionHistoryLink();
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
     * 지정한 폰트 기준 텍스트 폭을 측정합니다.
     * @param {string} text - 측정할 텍스트입니다.
     * @param {string} font - 캔버스 폰트 문자열입니다.
     * @returns {number} 측정된 텍스트 폭입니다.
     * @private
     */
    #measureTextWidth(text, font) {
        const context = this.#getVersionLabelMeasureContext();
        if (!context) {
            return Math.max(1, String(text || '').length * getTitleMenuTextPresetFontSize(TEXT_CONSTANTS, this.UIWW, 'H6') * 0.6);
        }

        context.save();
        context.font = font;
        const measuredWidth = context.measureText(String(text || '')).width;
        context.restore();
        return measuredWidth;
    }

    /**
     * 버전 라벨 텍스트 측정에 사용할 2D 컨텍스트를 반환합니다.
     * @returns {CanvasRenderingContext2D|null} 텍스트 측정용 컨텍스트입니다.
     * @private
     */
    #getVersionLabelMeasureContext() {
        if (this.versionLabelMeasureContext) {
            return this.versionLabelMeasureContext;
        }

        if (typeof document === 'undefined') {
            return null;
        }

        this.versionLabelMeasureCanvas = document.createElement('canvas');
        this.versionLabelMeasureContext = this.versionLabelMeasureCanvas.getContext('2d');
        return this.versionLabelMeasureContext;
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
     * 카드 등장 시작 지연을 제외한 실제 메뉴 등장 경과 시간을 반환합니다.
     * @returns {number} 시작 지연이 제외된 경과 시간입니다.
     * @private
     */
    #getRevealClockElapsed() {
        return Math.max(0, this.cardRevealElapsed - TITLE_CARD_MENU.APPEAR_START_DELAY_SECONDS);
    }

    /**
     * 카드와 패널이 공유하는 실제 등장 구간 길이를 반환합니다.
     * @returns {number} 등장 애니메이션 핵심 구간 길이입니다.
     * @private
     */
    #getCardRevealCoreDuration() {
        return Math.max(0.001, this.#getCardRevealTotalDuration() - TITLE_CARD_MENU.APPEAR_START_DELAY_SECONDS);
    }

    /**
     * 현재 메뉴 등장 시간축에서 지정 구간의 진행률을 계산합니다.
     * @param {number} delaySeconds - 시작 지연 시간입니다.
     * @param {number} durationSeconds - 진행 구간 길이입니다.
     * @returns {number} 0~1 범위 진행률입니다.
     * @private
     */
    #getRevealProgress(delaySeconds, durationSeconds) {
        const safeDelay = Number.isFinite(delaySeconds) ? delaySeconds : 0;
        const safeDuration = Math.max(0.001, Number.isFinite(durationSeconds) ? durationSeconds : 0);
        return clampNumber((this.#getRevealClockElapsed() - safeDelay) / safeDuration, 0, 1);
    }

    /**
     * 카드 등장용 독립 시간축을 갱신합니다.
     * @param {number} delta - 프레임 델타 시간입니다.
     * @param {number} transitionProgress - 타이틀 전환 진행률입니다.
     * @returns {boolean} 카드 등장 애니메이션 종료 여부입니다.
     * @private
     */
    #updateCardRevealClock(delta, transitionProgress) {
        if (!this.cardRevealStarted && transitionProgress > 0) {
            this.cardRevealStarted = true;
        }

        if (!this.cardRevealStarted) {
            return false;
        }

        const totalDuration = this.#getCardRevealTotalDuration();
        this.cardRevealElapsed = Math.min(totalDuration, this.cardRevealElapsed + Math.max(0, delta));
        return this.cardRevealElapsed >= totalDuration - 0.0001;
    }

    /**
     * 카드 등장 전체 소요 시간을 반환합니다.
     * @returns {number} 카드 등장 전체 소요 시간입니다.
     * @private
     */
    #getCardRevealTotalDuration() {
        const revealConfigs = Object.values(TITLE_CARD_MENU.REVEAL_CONFIGS || {});
        const revealMaxDuration = revealConfigs.reduce((maxDuration, revealConfig) => {
            const delaySeconds = Number.isFinite(revealConfig?.delaySeconds) ? revealConfig.delaySeconds : 0;
            const durationSeconds = Number.isFinite(revealConfig?.durationSeconds) ? revealConfig.durationSeconds : 0;
            return Math.max(maxDuration, delaySeconds + durationSeconds);
        }, 0);

        return Math.max(
            TITLE_CARD_MENU.APPEAR_DURATION_SECONDS,
            TITLE_CARD_MENU.APPEAR_START_DELAY_SECONDS + revealMaxDuration
        );
    }

    /**
     * 카드 식별자에 맞는 등장 설정을 반환합니다.
     * @param {string} cardId - 카드 식별자입니다.
     * @returns {{delaySeconds:number, durationSeconds:number, offsetXRatio:number, offsetYRatio:number, scaleOffset:number}} 카드 등장 설정입니다.
     * @private
     */
    #getCardRevealConfig(cardId) {
        return TITLE_CARD_MENU.REVEAL_CONFIGS[cardId] || TITLE_CARD_MENU.REVEAL_CONFIGS.start;
    }

    /**
     * 최종 패널 rect를 현재 등장 진행률에 맞는 렌더 rect로 변환합니다.
     * @param {{x:number, y:number, w:number, h:number, radius:number}} layoutRect - 최종 패널 rect입니다.
     * @param {number} revealEase - 패널 등장 이징 결과입니다.
     * @param {number} offsetX - 등장 전 X축 오프셋입니다.
     * @param {number} offsetY - 등장 전 Y축 오프셋입니다.
     * @returns {{x:number, y:number, w:number, h:number, radius:number, alpha:number}} 렌더용 rect입니다.
     * @private
     */
    #createPaneRenderRect(layoutRect, revealEase, offsetX, offsetY) {
        const clampedEase = clampNumber(revealEase, 0, 1);
        return {
            x: layoutRect.x + ((1 - clampedEase) * offsetX),
            y: layoutRect.y + ((1 - clampedEase) * offsetY),
            w: layoutRect.w,
            h: layoutRect.h,
            radius: layoutRect.radius,
            alpha: clampedEase
        };
    }

}
