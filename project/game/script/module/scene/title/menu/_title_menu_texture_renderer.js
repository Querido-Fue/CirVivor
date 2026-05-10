import { resolveFiniteNumber } from 'util/number_util.js';
import {
    drawTitleMenuCardFrontfaceContent,
    drawTitleMenuUtilityTileContent
} from './_title_menu_content_render.js';
import {
    drawTitleMenuCardBorder,
    drawTitleMenuCardParticles,
    drawTitleMenuCardRipples,
    drawTitleMenuCardSpotlight
} from './_title_menu_effect_render.js';
import {
    hasTitleMenuDynamicTextureState
} from './_title_menu_effect_state.js';
import {
    beginTitleMenuTextureClip,
    ensureTitleMenuTextureCanvas
} from './_title_menu_texture_canvas.js';
import {
    buildTitleMenuCardStaticTextureSignature,
    buildTitleMenuUtilityTileStaticTextureSignature
} from './_title_menu_texture_signature.js';

/**
 * @class TitleMenuTextureRenderer
 * @description 타이틀 메뉴의 offscreen 텍스처 빌드와 텍스처 리소스 정리를 담당합니다.
 */
export class TitleMenuTextureRenderer {
    /**
     * @param {object} options - 텍스처 렌더러 의존성입니다.
     * @param {import('display/_svg_drawer.js').SVGDrawer} options.svgDrawer - SVG 캐시 드로어입니다.
     * @param {object} options.textConstants - 텍스트 상수입니다.
     * @param {object} options.titleCardMenu - 타이틀 카드 메뉴 상수입니다.
     * @param {Function} options.getSession - 현재 overlay session 반환 함수입니다.
     * @param {Function} options.getEffectColor - 효과 색상 반환 함수입니다.
     * @param {Function} options.getUIWW - UI 기준 너비 반환 함수입니다.
     * @param {Function} options.getWH - 화면 높이 반환 함수입니다.
     * @param {Function} options.getUiScale - UI 스케일 반환 함수입니다.
     */
    constructor({
        svgDrawer,
        textConstants,
        titleCardMenu,
        getSession,
        getEffectColor,
        getUIWW,
        getWH,
        getUiScale
    }) {
        this.svgDrawer = svgDrawer;
        this.textConstants = textConstants;
        this.titleCardMenu = titleCardMenu;
        this.getSession = getSession;
        this.getEffectColor = getEffectColor;
        this.getUIWW = getUIWW;
        this.getWH = getWH;
        this.getUiScale = getUiScale;
        this.textureRevisionCounter = 0;
        this.paneTextureCanvas = null;
        this.paneTextureContext = null;
        this.cardPaneTextureCanvas = null;
        this.cardPaneTextureContext = null;
    }

    /**
     * 카드 외곽 pane용 텍스처 캔버스를 구성합니다.
     * @param {object} cardPaneRect - 카드 pane 영역입니다.
     * @param {object} paneState - 카드 pane 상호작용 상태입니다.
     * @returns {HTMLCanvasElement|null} 생성된 패널 텍스처 캔버스입니다.
     */
    buildCardPaneTextureCanvas(cardPaneRect, paneState) {
        return this._buildPaneTextureCanvas({
            panelRect: cardPaneRect,
            paneState,
            canvasKey: 'cardPaneTextureCanvas',
            contextKey: 'cardPaneTextureContext'
        });
    }

    /**
     * 오른쪽 utility glass 패널용 텍스처 캔버스를 구성합니다.
     * @param {object} utilityPane - 유틸리티 판넬 영역입니다.
     * @param {object} paneState - 유틸리티 판넬 상호작용 상태입니다.
     * @returns {HTMLCanvasElement|null} 생성된 패널 텍스처 캔버스입니다.
     */
    buildRightPaneTextureCanvas(utilityPane, paneState) {
        return this._buildPaneTextureCanvas({
            panelRect: utilityPane,
            paneState,
            canvasKey: 'paneTextureCanvas',
            contextKey: 'paneTextureContext'
        });
    }

    /**
     * 하단 보조 메뉴 타일용 텍스처 캔버스를 구성합니다.
     * @param {object} renderState - 타일 렌더 상태입니다.
     * @param {object} runtimeState - 타일 런타임 상태입니다.
     * @returns {HTMLCanvasElement|null} 생성된 타일 텍스처 캔버스입니다.
     */
    buildUtilityTileTextureCanvas(renderState, runtimeState) {
        if (!hasTitleMenuDynamicTextureState(runtimeState)) {
            return this._getStaticUtilityTileTextureCanvas(renderState, runtimeState);
        }

        const panelRect = renderState.panelRect;
        const { canvas, context, width, height } = ensureTitleMenuTextureCanvas(
            runtimeState,
            'textureCanvas',
            'textureContext',
            panelRect.w,
            panelRect.h
        );
        beginTitleMenuTextureClip(context, width, height, panelRect);

        this._drawCardBackgroundEffects(context, runtimeState, renderState);
        drawTitleMenuUtilityTileContent({
            context,
            svgDrawer: this.svgDrawer,
            renderState,
            hovered: runtimeState.hovered,
            titleCardMenu: this.titleCardMenu,
            uiScale: this._getUiScale()
        });
        this._drawCardForegroundEffects(context, runtimeState, renderState);
        context.restore();
        this._markTextureCanvasUpdated(canvas);
        return canvas;
    }

    /**
     * 카드 콘텐츠와 인터랙션 효과를 담은 텍스처 캔버스를 구성합니다.
     * @param {TitleMenuCard} card - 대상 카드입니다.
     * @param {object} runtimeState - 카드 런타임 상태입니다.
     * @param {object} renderState - 카드 렌더 상태입니다.
     * @returns {HTMLCanvasElement|null} 생성된 텍스처 캔버스입니다.
     */
    buildCardTextureCanvas(card, runtimeState, renderState) {
        if (!hasTitleMenuDynamicTextureState(runtimeState, renderState)) {
            return this._getStaticCardTextureCanvas(card, runtimeState, renderState);
        }

        const panelRect = renderState.panelRect;
        const { canvas, context, width, height } = ensureTitleMenuTextureCanvas(
            runtimeState,
            'textureCanvas',
            'textureContext',
            panelRect.w,
            panelRect.h
        );
        beginTitleMenuTextureClip(context, width, height, panelRect);

        this._drawCardBackgroundEffects(context, runtimeState, renderState);
        drawTitleMenuCardFrontfaceContent({
            context,
            svgDrawer: this.svgDrawer,
            card,
            renderState,
            textConstants: this.textConstants,
            uiww: this._getUIWW(),
            uiScale: this._getUiScale()
        });
        this._drawCardForegroundEffects(context, runtimeState, renderState);
        context.restore();
        this._markTextureCanvasUpdated(canvas);
        return canvas;
    }

    /**
     * 런타임 상태가 소유한 텍스처 캔버스들을 해제합니다.
     * @param {Iterable<object>} runtimeStates - 텍스처 상태 목록입니다.
     * @returns {void}
     */
    releaseRuntimeStateTextures(runtimeStates) {
        for (const runtimeState of runtimeStates) {
            this._releaseTextureCanvas(runtimeState, 'textureCanvas', 'textureContext');
            this._releaseTextureCanvas(runtimeState, 'staticTextureCanvas', 'staticTextureContext');
        }
    }

    /**
     * 렌더러가 소유한 패널 텍스처 리소스를 해제합니다.
     * @returns {void}
     */
    destroy() {
        this._releaseTextureCanvas(this, 'paneTextureCanvas', 'paneTextureContext');
        this._releaseTextureCanvas(this, 'cardPaneTextureCanvas', 'cardPaneTextureContext');
        this.textureRevisionCounter = 0;
    }

    /**
     * pane 상호작용 효과 텍스처를 구성합니다.
     * @param {object} options - pane 텍스처 옵션입니다.
     * @returns {HTMLCanvasElement|null} 생성된 pane 텍스처입니다.
     * @private
     */
    _buildPaneTextureCanvas({
        panelRect,
        paneState,
        canvasKey,
        contextKey
    }) {
        if (
            !panelRect
            || !paneState
            || (
                paneState.spotlightAlpha <= 0.005
                && paneState.borderAlpha <= 0.005
            )
        ) {
            return null;
        }

        const { canvas, context, width, height } = ensureTitleMenuTextureCanvas(
            this,
            canvasKey,
            contextKey,
            panelRect.w,
            panelRect.h
        );
        beginTitleMenuTextureClip(context, width, height, panelRect);

        this._drawPaneForegroundEffects(context, paneState, panelRect);
        context.restore();
        this._markTextureCanvasUpdated(canvas);
        return canvas;
    }

    /**
     * 카드의 정적 앞면 텍스처를 반환합니다.
     * @param {TitleMenuCard} card - 대상 카드입니다.
     * @param {object} runtimeState - 카드 런타임 상태입니다.
     * @param {object} renderState - 카드 렌더 상태입니다.
     * @returns {HTMLCanvasElement|null} 정적 카드 텍스처입니다.
     * @private
     */
    _getStaticCardTextureCanvas(card, runtimeState, renderState) {
        const panelRect = renderState?.panelRect;
        if (!runtimeState || !panelRect) {
            return null;
        }

        const canvasWidth = Math.max(1, Math.ceil(panelRect.w));
        const canvasHeight = Math.max(1, Math.ceil(panelRect.h));
        const signature = buildTitleMenuCardStaticTextureSignature({
            card,
            renderState,
            uiww: this._getUIWW(),
            wh: this._getWH(),
            uiScale: this._getUiScale(),
            textConstants: this.textConstants,
            svgDrawer: this.svgDrawer
        });

        const currentStaticCanvas = runtimeState.staticTextureCanvas;
        const sizeChanged = !currentStaticCanvas
            || currentStaticCanvas.width !== canvasWidth
            || currentStaticCanvas.height !== canvasHeight;
        if (!sizeChanged && runtimeState.staticTextureSignature === signature) {
            return currentStaticCanvas;
        }

        const { canvas, context, width, height } = ensureTitleMenuTextureCanvas(
            runtimeState,
            'staticTextureCanvas',
            'staticTextureContext',
            canvasWidth,
            canvasHeight
        );

        beginTitleMenuTextureClip(context, width, height, panelRect);
        drawTitleMenuCardFrontfaceContent({
            context,
            svgDrawer: this.svgDrawer,
            card,
            renderState: {
                ...renderState,
                hoverProgress: 0
            },
            textConstants: this.textConstants,
            uiww: this._getUIWW(),
            uiScale: this._getUiScale()
        });
        context.restore();

        runtimeState.staticTextureSignature = signature;
        this._markTextureCanvasUpdated(canvas);
        return canvas;
    }

    /**
     * 유틸리티 타일의 정적 텍스처를 반환합니다.
     * @param {object} renderState - 타일 렌더 상태입니다.
     * @param {object} runtimeState - 타일 런타임 상태입니다.
     * @returns {HTMLCanvasElement|null} 정적 타일 텍스처입니다.
     * @private
     */
    _getStaticUtilityTileTextureCanvas(renderState, runtimeState) {
        const panelRect = renderState?.panelRect;
        if (!runtimeState || !panelRect) {
            return null;
        }

        const canvasWidth = Math.max(1, Math.ceil(panelRect.w));
        const canvasHeight = Math.max(1, Math.ceil(panelRect.h));
        const signature = buildTitleMenuUtilityTileStaticTextureSignature({
            renderState,
            runtimeState,
            uiww: this._getUIWW(),
            wh: this._getWH(),
            uiScale: this._getUiScale(),
            svgDrawer: this.svgDrawer
        });

        const currentStaticCanvas = runtimeState.staticTextureCanvas;
        const sizeChanged = !currentStaticCanvas
            || currentStaticCanvas.width !== canvasWidth
            || currentStaticCanvas.height !== canvasHeight;
        if (!sizeChanged && runtimeState.staticTextureSignature === signature) {
            return currentStaticCanvas;
        }

        const { canvas, context, width, height } = ensureTitleMenuTextureCanvas(
            runtimeState,
            'staticTextureCanvas',
            'staticTextureContext',
            canvasWidth,
            canvasHeight
        );

        beginTitleMenuTextureClip(context, width, height, panelRect);
        drawTitleMenuUtilityTileContent({
            context,
            svgDrawer: this.svgDrawer,
            renderState,
            hovered: runtimeState.hovered,
            titleCardMenu: this.titleCardMenu,
            uiScale: this._getUiScale()
        });
        context.restore();

        runtimeState.staticTextureSignature = signature;
        this._markTextureCanvasUpdated(canvas);
        return canvas;
    }

    /**
     * 패널 앞면 상호작용 효과를 렌더합니다.
     * @param {CanvasRenderingContext2D} context - 렌더 대상 컨텍스트입니다.
     * @param {object} paneState - 판넬 상호작용 상태입니다.
     * @param {object} panelRect - 판넬 rect입니다.
     * @private
     */
    _drawPaneForegroundEffects(context, paneState, panelRect) {
        const session = this._getSession();
        const spotlightOptions = session?.getEffectOptions('hoverSpotlight');
        const borderOptions = session?.getEffectOptions('hoverBorder');
        const effectColor = this._getEffectColor();

        if (spotlightOptions && paneState.spotlightAlpha > 0.005) {
            drawTitleMenuCardSpotlight(context, paneState, spotlightOptions, effectColor);
        }

        if (borderOptions && paneState.borderAlpha > 0.005) {
            drawTitleMenuCardBorder(context, paneState, { panelRect }, borderOptions, effectColor);
        }
    }

    /**
     * 카드 콘텐츠 아래에 깔리는 인터랙션 효과를 그립니다.
     * @param {CanvasRenderingContext2D} context - 대상 컨텍스트입니다.
     * @param {object} runtimeState - 카드 런타임 상태입니다.
     * @param {object} renderState - 카드 렌더 상태입니다.
     * @private
     */
    _drawCardBackgroundEffects(context, runtimeState, renderState) {
        if (runtimeState.particles.length <= 0 || runtimeState.particleAlpha <= 0.005) {
            return;
        }

        drawTitleMenuCardParticles(context, renderState, runtimeState, this._getEffectColor());
    }

    /**
     * 카드 전용 인터랙션 효과를 그립니다.
     * @param {CanvasRenderingContext2D} context - 대상 컨텍스트입니다.
     * @param {object} runtimeState - 카드 런타임 상태입니다.
     * @param {object} renderState - 카드 렌더 상태입니다.
     * @private
     */
    _drawCardForegroundEffects(context, runtimeState, renderState) {
        const session = this._getSession();
        const effectColor = this._getEffectColor();
        const spotlightOptions = session?.getEffectOptions('hoverSpotlight');
        const borderOptions = session?.getEffectOptions('hoverBorder');

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
     * 캔버스 텍스처 revision을 증가시켜 WebGL 업로드 캐시에 변경을 알립니다.
     * @param {HTMLCanvasElement|null} canvas - 갱신된 텍스처 캔버스입니다.
     * @private
     */
    _markTextureCanvasUpdated(canvas) {
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
     * 대상 객체에 저장된 캔버스/컨텍스트 참조를 해제합니다.
     * @param {object} target - 캔버스 필드를 가진 객체입니다.
     * @param {string} canvasKey - 캔버스 필드 이름입니다.
     * @param {string} contextKey - 컨텍스트 필드 이름입니다.
     * @private
     */
    _releaseTextureCanvas(target, canvasKey, contextKey) {
        if (!target) {
            return;
        }

        if (target[canvasKey]) {
            target[canvasKey].width = 0;
            target[canvasKey].height = 0;
        }
        target[canvasKey] = null;
        target[contextKey] = null;
    }

    /**
     * 현재 overlay session을 반환합니다.
     * @returns {object|null} 현재 session입니다.
     * @private
     */
    _getSession() {
        return typeof this.getSession === 'function' ? this.getSession() : null;
    }

    /**
     * 현재 효과 색상을 반환합니다.
     * @returns {{r:number, g:number, b:number}} 효과 색상입니다.
     * @private
     */
    _getEffectColor() {
        return typeof this.getEffectColor === 'function'
            ? this.getEffectColor()
            : { r: 255, g: 255, b: 255 };
    }

    /**
     * 현재 UI 기준 너비를 반환합니다.
     * @returns {number} UI 기준 너비입니다.
     * @private
     */
    _getUIWW() {
        return typeof this.getUIWW === 'function' ? this.getUIWW() : 0;
    }

    /**
     * 현재 화면 높이를 반환합니다.
     * @returns {number} 화면 높이입니다.
     * @private
     */
    _getWH() {
        return typeof this.getWH === 'function' ? this.getWH() : 0;
    }

    /**
     * 현재 UI 스케일을 반환합니다.
     * @returns {number} UI 스케일 배율입니다.
     * @private
     */
    _getUiScale() {
        const uiScale = typeof this.getUiScale === 'function' ? this.getUiScale() : 1;
        const safeUiScale = resolveFiniteNumber(uiScale, 1);
        return safeUiScale > 0 ? safeUiScale : 1;
    }
}
