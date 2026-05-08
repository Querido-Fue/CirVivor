import { getCanvas, getUIOffsetX, getUIWW, getWH, getWW } from 'display/display_system.js';
import { getData } from 'data/data_handler.js';
import { getMouseInput, hasMouseState } from 'input/input_system.js';
import { getDelta } from 'game/time_handler.js';
import { TITLE_BENTO_CARD_DEFINITIONS } from './magic_bento/_title_magic_bento_data.js';
import {
    drawBentoCardBody,
    drawBentoCardBorder,
    drawBentoCardSurfaceGlow
} from './magic_bento/_title_magic_bento_card_render.js';
import { drawBentoCardContent } from './magic_bento/_title_magic_bento_content_render.js';
import {
    drawBentoCardEffects,
    drawBentoGlobalSpotlight
} from './magic_bento/_title_magic_bento_effect_render.js';
import {
    updateBentoCardParticles,
    updateBentoCardRipples
} from './magic_bento/_title_magic_bento_effect_state.js';
import { recalculateBentoCardLayout } from './magic_bento/_title_magic_bento_layout.js';
import { getBentoCardPalette } from './magic_bento/_title_magic_bento_theme.js';
import { clamp } from './magic_bento/_title_magic_bento_motion.js';
import {
    calculateBentoVisibleGroupBounds,
    isBentoPointInsideGroup,
    refreshBentoCardTransforms,
    resolveBentoHoveredCard,
    updateBentoCardInteractionState,
    updateBentoSpotlight
} from './magic_bento/_title_magic_bento_state.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');
const TITLE_MAGIC_BENTO = TITLE_CONSTANTS.TITLE_MAGIC_BENTO;
const TITLE_LOADING = TITLE_CONSTANTS.TITLE_LOADING;

/**
 * @class TitleMagicBento
 * @description 타이틀 씬 오른쪽 카드 메뉴의 시각 효과와 등장 연출을 관리합니다.
 */
export class TitleMagicBento {
    #ctx;

    /**
     * @param {TitleScene} titleScene - 타이틀 씬 인스턴스
     */
    constructor(titleScene) {
        this.titleScene = titleScene;
        this.#ctx = null;
        this.WW = getWW();
        this.WH = getWH();
        this.UIWW = getUIWW();
        this.UIOffsetX = getUIOffsetX();
        this.sceneTransitionProgress = 0;
        this.appearanceElapsed = 0;
        this.appearanceProgress = 0;
        this.appearanceStarted = false;
        this.groupBounds = { x: 0, y: 0, w: 0, h: 0 };
        this.spotlightX = this.UIOffsetX + (this.UIWW * 0.5);
        this.spotlightY = this.WH * 0.5;
        this.spotlightOpacity = 0;
        this.cards = TITLE_BENTO_CARD_DEFINITIONS.map((definition) => this.#createCardRuntime(definition));

        this.#recalculateLayout();
        this.#refreshCardTransforms();
    }

    /**
     * 타이틀 씬 축소 전환 진행률을 전달받습니다.
     * @param {number} progress - 0~1 범위 진행률
     */
    setSceneTransitionProgress(progress) {
        this.sceneTransitionProgress = clamp(progress, 0, 1);
    }

    /**
     * 카드 인터랙션 상태와 파티클, 리플 등을 업데이트합니다.
     */
    update() {
        const delta = getDelta();
        if (!Number.isFinite(delta) || delta <= 0) {
            this.#refreshCardTransforms();
            return;
        }

        const mouseX = getMouseInput('x');
        const mouseY = getMouseInput('y');

        this.#updateAppearanceProgress(delta);
        this.#refreshCardTransforms();
        this.groupBounds = calculateBentoVisibleGroupBounds(this.cards);

        const hoveredCardId = resolveBentoHoveredCard(this.cards, mouseX, mouseY);
        const pointerInsideGroup = isBentoPointInsideGroup(this.groupBounds, mouseX, mouseY);
        const clickTriggered = hasMouseState('left', 'clicked');

        this.#updateSpotlight(mouseX, mouseY, hoveredCardId !== null || pointerInsideGroup, delta);

        for (const card of this.cards) {
            const isHovered = card.id === hoveredCardId;
            updateBentoCardInteractionState(card, {
                mouseX,
                mouseY,
                delta,
                isHovered,
                clickTriggered,
                uiww: this.UIWW,
                spotlightX: this.spotlightX,
                spotlightY: this.spotlightY,
                spotlightOpacity: this.spotlightOpacity,
                titleMagicBento: TITLE_MAGIC_BENTO
            });
            updateBentoCardParticles(card, delta, isHovered, TITLE_MAGIC_BENTO, this.UIWW);
            updateBentoCardRipples(card, delta);
        }

        this.#refreshCardTransforms();
        this.groupBounds = calculateBentoVisibleGroupBounds(this.cards);
    }

    /**
     * 타이틀 카드 UI를 렌더링합니다.
     */
    draw() {
        const ctx = this.#getContext();
        if (!ctx) {
            return;
        }

        if (this.appearanceProgress <= 0 && !this.#hasActiveVisualEffects()) {
            return;
        }

        ctx.save();
        drawBentoGlobalSpotlight(ctx, {
            groupBounds: this.groupBounds,
            spotlightOpacity: this.spotlightOpacity,
            spotlightX: this.spotlightX,
            spotlightY: this.spotlightY,
            uiww: this.UIWW,
            titleMagicBento: TITLE_MAGIC_BENTO
        });
        for (const card of this.cards) {
            this.#drawCard(ctx, card);
        }
        ctx.restore();
    }

    /**
     * 화면 크기 변경 시 카드 레이아웃과 내부 좌표를 다시 계산합니다.
     */
    resize() {
        this.WW = getWW();
        this.WH = getWH();
        this.UIWW = getUIWW();
        this.UIOffsetX = getUIOffsetX();
        this.#recalculateLayout();
        this.#refreshCardTransforms();
    }

    /**
     * 내부 파티클/리플 상태와 컨텍스트 참조를 해제합니다.
     */
    destroy() {
        this.#ctx = null;
        this.appearanceElapsed = 0;
        this.appearanceProgress = 0;
        this.appearanceStarted = false;
        for (const card of this.cards) {
            card.particles.length = 0;
            card.ripples.length = 0;
        }
    }

    /**
     * 카드 런타임 상태 객체를 생성합니다.
     * @param {object} definition - 카드 기본 정의
     * @returns {object} 런타임 상태를 포함한 카드 객체
     * @private
     */
    #createCardRuntime(definition) {
        return {
            ...definition,
            baseWidth: 0,
            baseHeight: 0,
            finalCenterX: 0,
            finalCenterY: 0,
            startCenterX: 0,
            startCenterY: 0,
            entranceProgress: 0,
            currentScale: 1,
            currentCenterX: 0,
            currentCenterY: 0,
            currentRect: { x: 0, y: 0, w: 0, h: 0 },
            currentAlpha: 0,
            hoverProgress: 0,
            tiltX: 0,
            tiltY: 0,
            glowIntensity: 0,
            localMouseX: 0,
            localMouseY: 0,
            particleSpawnElapsed: 0,
            particles: [],
            ripples: []
        };
    }

    /**
     * 현재 카드 레이아웃과 등장 시작 좌표를 다시 계산합니다.
     * @private
     */
    #recalculateLayout() {
        const layout = recalculateBentoCardLayout(this.cards, {
            ww: this.WW,
            wh: this.WH,
            uiww: this.UIWW,
            uiOffsetX: this.UIOffsetX
        }, TITLE_MAGIC_BENTO, TITLE_LOADING);

        this.groupBounds = layout.groupBounds;
        this.spotlightX = layout.spotlightX;
        this.spotlightY = layout.spotlightY;
    }

    /**
     * 타이틀 카드의 개별 등장 시간축을 업데이트합니다.
     * 카드 연출이 화면 축소보다 약간 늦게 끝나도록 별도 진행률을 사용합니다.
     * @param {number} delta - 프레임 델타
     * @private
     */
    #updateAppearanceProgress(delta) {
        if (this.sceneTransitionProgress > 0 && !this.appearanceStarted) {
            this.appearanceStarted = true;
        }

        if (!this.appearanceStarted) {
            return;
        }

        this.appearanceElapsed = Math.min(
            TITLE_MAGIC_BENTO.APPEAR_DURATION_SECONDS,
            this.appearanceElapsed + delta
        );
        this.appearanceProgress = clamp(
            (this.appearanceElapsed - TITLE_MAGIC_BENTO.APPEAR_START_DELAY_SECONDS)
                / Math.max(0.001, TITLE_MAGIC_BENTO.APPEAR_DURATION_SECONDS - TITLE_MAGIC_BENTO.APPEAR_START_DELAY_SECONDS),
            0,
            1
        );
    }

    /**
     * 카드의 현재 위치, 크기, 알파값을 갱신합니다.
     * @private
     */
    #refreshCardTransforms() {
        refreshBentoCardTransforms(this.cards, this.appearanceElapsed, TITLE_MAGIC_BENTO);
    }

    /**
     * 스포트라이트 위치와 투명도를 업데이트합니다.
     * @param {number} mouseX - 포인터 X 좌표
     * @param {number} mouseY - 포인터 Y 좌표
     * @param {boolean} active - 스포트라이트 활성화 여부
     * @param {number} delta - 프레임 델타
     * @private
     */
    #updateSpotlight(mouseX, mouseY, active, delta) {
        const spotlight = updateBentoSpotlight({
            mouseX,
            mouseY,
            active,
            delta,
            appearanceProgress: this.appearanceProgress,
            spotlightX: this.spotlightX,
            spotlightY: this.spotlightY,
            spotlightOpacity: this.spotlightOpacity
        });

        this.spotlightX = spotlight.spotlightX;
        this.spotlightY = spotlight.spotlightY;
        this.spotlightOpacity = spotlight.spotlightOpacity;
    }

    /**
     * 활성 시각 효과가 남아 있는지 확인합니다.
     * @returns {boolean} 활성 효과 존재 여부
     * @private
     */
    #hasActiveVisualEffects() {
        return this.cards.some((card) => card.particles.length > 0 || card.ripples.length > 0);
    }

    /**
     * UI 레이어 2D 컨텍스트를 반환합니다.
     * @returns {CanvasRenderingContext2D|null} UI 컨텍스트
     * @private
     */
    #getContext() {
        if (this.#ctx) {
            return this.#ctx;
        }

        const canvas = getCanvas('ui');
        if (!canvas) {
            return null;
        }

        this.#ctx = canvas.getContext('2d');
        return this.#ctx;
    }

    /**
     * 개별 카드를 렌더링합니다.
     * @param {CanvasRenderingContext2D} ctx - UI 컨텍스트
     * @param {object} card - 렌더링할 카드
     * @private
     */
    #drawCard(ctx, card) {
        if (card.currentAlpha <= 0.01 || card.baseWidth <= 0 || card.baseHeight <= 0) {
            return;
        }

        const palette = this.#getCardPalette();
        const drawScale = card.currentScale;
        const radius = Math.max(TITLE_MAGIC_BENTO.CARD_RADIUS_MIN, this.UIWW * TITLE_MAGIC_BENTO.CARD_RADIUS_UIWW_RATIO);
        const normalizedTiltX = card.tiltX / Math.max(1, TITLE_MAGIC_BENTO.TILT_X_MAX);
        const normalizedTiltY = card.tiltY / Math.max(1, TITLE_MAGIC_BENTO.TILT_Y_MAX);
        const tiltSkewY = Math.tan((card.tiltX * Math.PI) / 180) * TITLE_MAGIC_BENTO.TILT_SKEW_FACTOR;
        const tiltSkewX = Math.tan((card.tiltY * Math.PI) / 180) * TITLE_MAGIC_BENTO.TILT_SKEW_FACTOR;
        const tiltScaleX = 1 - (Math.abs(normalizedTiltY) * TITLE_MAGIC_BENTO.TILT_SCALE_REDUCTION);
        const tiltScaleY = 1 - (Math.abs(normalizedTiltX) * TITLE_MAGIC_BENTO.TILT_SCALE_REDUCTION);
        const tiltShiftX = normalizedTiltY * card.baseWidth * 0.012;
        const tiltShiftY = normalizedTiltX * card.baseHeight * 0.012;

        ctx.save();
        ctx.globalAlpha = card.currentAlpha;
        ctx.translate(card.currentCenterX + tiltShiftX, card.currentCenterY + tiltShiftY);
        ctx.transform(drawScale * tiltScaleX, tiltSkewY, tiltSkewX, drawScale * tiltScaleY, 0, 0);
        ctx.translate(-(card.baseWidth * 0.5), -(card.baseHeight * 0.5));

        drawBentoCardBody(ctx, card, palette, radius);
        drawBentoCardSurfaceGlow(ctx, card, radius);
        drawBentoCardEffects(ctx, card, radius);
        drawBentoCardContent(ctx, card, palette, this.UIWW);
        drawBentoCardBorder(ctx, card, palette, radius, TITLE_MAGIC_BENTO);

        ctx.restore();
    }

    /**
     * 카드 팔레트를 현재 테마에 맞춰 계산합니다.
     * @returns {object} 카드 렌더링용 색상 팔레트
     * @private
     */
    #getCardPalette() {
        return getBentoCardPalette();
    }

}
