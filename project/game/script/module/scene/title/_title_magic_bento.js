import { getCanvas, getUIOffsetX, getUIWW, getWH, getWW } from 'display/display_system.js';
import { getData } from 'data/data_handler.js';
import { getMouseInput, hasMouseState } from 'input/input_system.js';
import { getDelta } from 'game/time_handler.js';
import { getLangString } from 'ui/ui_system.js';
import { TITLE_BENTO_CARD_DEFINITIONS } from './_title_magic_bento_data.js';
import { drawBentoCardIcon } from './_title_magic_bento_icon.js';
import { getBentoAccentColor, getBentoCardPalette } from './_title_magic_bento_theme.js';
import {
    clamp,
    damp,
    easeOutExpo,
    lerp
} from './_title_magic_bento_motion.js';
import { drawBentoWrappedText, getBentoTypography } from './_title_magic_bento_text.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');
const TITLE_MAGIC_BENTO = TITLE_CONSTANTS.TITLE_MAGIC_BENTO;
const TITLE_LOADING = TITLE_CONSTANTS.TITLE_LOADING;
const TEXT_CONSTANTS = getData('TEXT_CONSTANTS');

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
        this.groupBounds = this.#calculateGroupBounds();

        const hoveredCardId = this.#resolveHoveredCard(mouseX, mouseY);
        const pointerInsideGroup = this.#isPointInsideGroup(mouseX, mouseY);
        const clickTriggered = hasMouseState('left', 'clicked');

        this.#updateSpotlight(mouseX, mouseY, hoveredCardId !== null || pointerInsideGroup, delta);

        for (const card of this.cards) {
            const isHovered = card.id === hoveredCardId;
            this.#updateCardInteraction(card, mouseX, mouseY, delta, isHovered, clickTriggered);
            this.#updateCardParticles(card, delta, isHovered);
            this.#updateCardRipples(card, delta);
        }

        this.#refreshCardTransforms();
        this.groupBounds = this.#calculateGroupBounds();
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
        this.#drawGlobalSpotlight(ctx);
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
        const baseGroupWidth = clamp(
            this.UIWW * TITLE_MAGIC_BENTO.GROUP_WIDTH_UIWW_RATIO,
            TITLE_MAGIC_BENTO.GROUP_MIN_WIDTH,
            TITLE_MAGIC_BENTO.GROUP_MAX_WIDTH
        );
        const gap = Math.max(TITLE_MAGIC_BENTO.CARD_GAP_MIN, this.UIWW * TITLE_MAGIC_BENTO.CARD_GAP_UIWW_RATIO);
        const baseAvailableWidth = baseGroupWidth - gap;
        const playHeightFactor = 1.12 * (0.68 + 0.2);
        const baseRightWidth = Math.max(
            baseAvailableWidth * 0.42,
            (baseAvailableWidth - (gap * 1.12)) / (1 + playHeightFactor)
        );
        const leftWidth = baseAvailableWidth - baseRightWidth;
        const rightWidth = baseRightWidth * TITLE_MAGIC_BENTO.RIGHT_COLUMN_WIDTH_SCALE;
        const recordsHeight = (baseRightWidth * 0.2) * TITLE_MAGIC_BENTO.RECORDS_HEIGHT_SCALE;
        const quickHeight = Math.max(0, leftWidth - gap - recordsHeight);
        const bottomHeight = baseRightWidth * 0.62;
        const mainHeight = leftWidth;
        const groupWidth = leftWidth + gap + rightWidth;
        const groupHeight = mainHeight + gap + bottomHeight;
        const logoLeftMargin = this.UIWW * TITLE_LOADING.LOGO_FINAL_LEFT_UIWW_RATIO;
        const logoTopMargin = this.WH * TITLE_LOADING.LOGO_FINAL_TOP_WH_RATIO;
        const groupX = this.UIOffsetX + this.UIWW - logoLeftMargin - groupWidth;
        const groupY = this.WH - logoTopMargin - groupHeight;

        const layoutMap = {
            play: {
                x: groupX,
                y: groupY,
                w: leftWidth,
                h: mainHeight
            },
            quick: {
                x: groupX + leftWidth + gap,
                y: groupY,
                w: rightWidth,
                h: quickHeight
            },
            records: {
                x: groupX + leftWidth + gap,
                y: groupY + quickHeight + gap,
                w: rightWidth,
                h: recordsHeight
            },
            deck: {
                x: groupX,
                y: groupY + mainHeight + gap,
                w: leftWidth,
                h: bottomHeight
            },
            research: {
                x: groupX + leftWidth + gap,
                y: groupY + quickHeight + gap + recordsHeight + gap,
                w: rightWidth,
                h: bottomHeight
            }
        };

        for (const card of this.cards) {
            const layout = layoutMap[card.id];
            if (!layout) {
                continue;
            }

            card.baseWidth = layout.w;
            card.baseHeight = layout.h;
            card.finalCenterX = layout.x + (layout.w * 0.5);
            card.finalCenterY = layout.y + (layout.h * 0.5);

            const startOffsetX = this.UIWW * (TITLE_MAGIC_BENTO.ENTRANCE_OFFSET_X_UIWW_RATIO + card.entranceOffsetXRatio);
            const startOffsetY = this.WH * (TITLE_MAGIC_BENTO.ENTRANCE_OFFSET_Y_WH_RATIO + card.entranceOffsetYRatio);
            card.startCenterX = Math.max(this.WW + (layout.w * 0.12), card.finalCenterX + startOffsetX);
            card.startCenterY = card.finalCenterY + startOffsetY;

            for (const particle of card.particles) {
                particle.localX = clamp(particle.localX, 0, layout.w);
                particle.localY = clamp(particle.localY, 0, layout.h);
            }
            for (const ripple of card.ripples) {
                ripple.localX = clamp(ripple.localX, 0, layout.w);
                ripple.localY = clamp(ripple.localY, 0, layout.h);
            }
        }

        this.groupBounds = {
            x: groupX,
            y: groupY,
            w: groupWidth,
            h: groupHeight
        };
        this.spotlightX = groupX + (groupWidth * 0.5);
        this.spotlightY = groupY + (groupHeight * 0.5);
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
        const hoverScaleDelta = TITLE_MAGIC_BENTO.HOVER_SCALE_DELTA;
        const elapsedSinceStart = Math.max(0, this.appearanceElapsed - TITLE_MAGIC_BENTO.APPEAR_START_DELAY_SECONDS);

        for (const card of this.cards) {
            const rawProgress = clamp(
                (elapsedSinceStart - card.entranceDelaySeconds) / Math.max(0.001, card.entranceDurationSeconds),
                0,
                1
            );
            const easedProgress = easeOutExpo(rawProgress);
            const baseScale = lerp(
                TITLE_MAGIC_BENTO.ENTRANCE_START_SCALE + card.entranceScaleOffset,
                1,
                easedProgress
            );
            const currentScale = baseScale * (1 + (card.hoverProgress * hoverScaleDelta));
            const centerX = lerp(card.startCenterX, card.finalCenterX, easedProgress);
            const centerY = lerp(card.startCenterY, card.finalCenterY, easedProgress);
            const width = card.baseWidth * currentScale;
            const height = card.baseHeight * currentScale;

            card.entranceProgress = easedProgress;
            card.currentScale = currentScale;
            card.currentCenterX = centerX;
            card.currentCenterY = centerY;
            card.currentRect = {
                x: centerX - (width * 0.5),
                y: centerY - (height * 0.5),
                w: width,
                h: height
            };
            card.currentAlpha = clamp((rawProgress - 0.08) / 0.42, 0, 1);
        }
    }

    /**
     * 현재 카드들이 차지하는 화면 범위를 계산합니다.
     * @returns {{x:number, y:number, w:number, h:number}} 카드 그룹 바운드
     * @private
     */
    #calculateGroupBounds() {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        for (const card of this.cards) {
            if (card.currentAlpha <= 0.01) {
                continue;
            }
            minX = Math.min(minX, card.currentRect.x);
            minY = Math.min(minY, card.currentRect.y);
            maxX = Math.max(maxX, card.currentRect.x + card.currentRect.w);
            maxY = Math.max(maxY, card.currentRect.y + card.currentRect.h);
        }

        if (!Number.isFinite(minX)) {
            return { x: 0, y: 0, w: 0, h: 0 };
        }

        return {
            x: minX,
            y: minY,
            w: maxX - minX,
            h: maxY - minY
        };
    }

    /**
     * 주어진 점이 현재 카드 그룹 영역 안에 있는지 판정합니다.
     * @param {number} x - 포인터 X 좌표
     * @param {number} y - 포인터 Y 좌표
     * @returns {boolean} 그룹 내부 여부
     * @private
     */
    #isPointInsideGroup(x, y) {
        if (this.groupBounds.w <= 0 || this.groupBounds.h <= 0) {
            return false;
        }

        return x >= this.groupBounds.x
            && x <= this.groupBounds.x + this.groupBounds.w
            && y >= this.groupBounds.y
            && y <= this.groupBounds.y + this.groupBounds.h;
    }

    /**
     * 포인터 아래에 있는 카드를 찾습니다.
     * @param {number} x - 포인터 X 좌표
     * @param {number} y - 포인터 Y 좌표
     * @returns {string|null} 호버된 카드 ID
     * @private
     */
    #resolveHoveredCard(x, y) {
        for (let index = this.cards.length - 1; index >= 0; index--) {
            const card = this.cards[index];
            if (card.currentAlpha < 0.45 || card.entranceProgress < 0.45) {
                continue;
            }
            if (x >= card.currentRect.x
                && x <= card.currentRect.x + card.currentRect.w
                && y >= card.currentRect.y
                && y <= card.currentRect.y + card.currentRect.h) {
                return card.id;
            }
        }

        return null;
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
        const targetOpacity = active && this.appearanceProgress > 0.12 ? 1 : 0;
        const followSpeed = clamp(delta * 18, 0, 1);

        if (active) {
            this.spotlightX = damp(this.spotlightX, mouseX, followSpeed);
            this.spotlightY = damp(this.spotlightY, mouseY, followSpeed);
        }

        this.spotlightOpacity = damp(this.spotlightOpacity, targetOpacity, clamp(delta * 10, 0, 1));
    }

    /**
     * 카드별 호버/틸트 상태와 글로우 강도를 갱신합니다.
     * @param {object} card - 대상 카드
     * @param {number} mouseX - 포인터 X 좌표
     * @param {number} mouseY - 포인터 Y 좌표
     * @param {number} delta - 프레임 델타
     * @param {boolean} isHovered - 현재 호버 여부
     * @param {boolean} clickTriggered - 클릭 리플 트리거 여부
     * @private
     */
    #updateCardInteraction(card, mouseX, mouseY, delta, isHovered, clickTriggered) {
        const cardCenterX = card.currentRect.x + (card.currentRect.w * 0.5);
        const cardCenterY = card.currentRect.y + (card.currentRect.h * 0.5);
        const hoverSpeed = clamp(delta * 10, 0, 1);
        const motionSpeed = clamp(delta * 12, 0, 1);
        const targetHover = isHovered ? 1 : 0;
        const spotlightRadius = Math.max(
            TITLE_MAGIC_BENTO.SPOTLIGHT_RADIUS_MIN,
            this.UIWW * TITLE_MAGIC_BENTO.SPOTLIGHT_RADIUS_UIWW_RATIO
        );

        card.hoverProgress = damp(card.hoverProgress, targetHover, hoverSpeed);

        let targetTiltX = 0;
        let targetTiltY = 0;
        let localMouseX = card.baseWidth * 0.5;
        let localMouseY = card.baseHeight * 0.5;

        if (isHovered) {
            const normalizedX = clamp((mouseX - card.currentRect.x) / Math.max(1, card.currentRect.w), 0, 1);
            const normalizedY = clamp((mouseY - card.currentRect.y) / Math.max(1, card.currentRect.h), 0, 1);
            const centeredX = (normalizedX * 2) - 1;
            const centeredY = (normalizedY * 2) - 1;
            const tiltIntensity = TITLE_MAGIC_BENTO.TILT_INTENSITY;

            localMouseX = normalizedX * card.baseWidth;
            localMouseY = normalizedY * card.baseHeight;
            targetTiltX = centeredY * -TITLE_MAGIC_BENTO.TILT_X_MAX * tiltIntensity;
            targetTiltY = centeredX * TITLE_MAGIC_BENTO.TILT_Y_MAX * tiltIntensity;

            if (clickTriggered && card.entranceProgress > 0.7) {
                this.#spawnRipple(card, localMouseX, localMouseY);
            }
        }

        const distanceToSpotlight = Math.max(
            0,
            Math.hypot(this.spotlightX - cardCenterX, this.spotlightY - cardCenterY) - (Math.max(card.currentRect.w, card.currentRect.h) * 0.35)
        );
        let glowTarget = 0;
        if (this.spotlightOpacity > 0.01) {
            if (distanceToSpotlight <= spotlightRadius * 0.45) {
                glowTarget = 1;
            } else if (distanceToSpotlight <= spotlightRadius) {
                glowTarget = (spotlightRadius - distanceToSpotlight) / (spotlightRadius * 0.55);
            }
        }
        if (isHovered) {
            glowTarget = Math.max(glowTarget, 1);
        }

        card.localMouseX = localMouseX;
        card.localMouseY = localMouseY;
        card.tiltX = damp(card.tiltX, targetTiltX, motionSpeed);
        card.tiltY = damp(card.tiltY, targetTiltY, motionSpeed);
        card.glowIntensity = damp(card.glowIntensity, glowTarget * this.spotlightOpacity, clamp(delta * 14, 0, 1));
    }

    /**
     * 카드에 떠다니는 입자들을 업데이트합니다.
     * @param {object} card - 대상 카드
     * @param {number} delta - 프레임 델타
     * @param {boolean} isHovered - 현재 호버 여부
     * @private
     */
    #updateCardParticles(card, delta, isHovered) {
        const targetCount = TITLE_MAGIC_BENTO.PARTICLE_COUNT;

        if (isHovered && card.currentAlpha > 0.65) {
            card.particleSpawnElapsed += delta;
            while (card.particles.length < targetCount && card.particleSpawnElapsed >= TITLE_MAGIC_BENTO.PARTICLE_SPAWN_INTERVAL) {
                card.particleSpawnElapsed -= TITLE_MAGIC_BENTO.PARTICLE_SPAWN_INTERVAL;
                card.particles.push(this.#createParticle(card));
            }
        } else {
            card.particleSpawnElapsed = 0;
        }

        for (let index = card.particles.length - 1; index >= 0; index--) {
            const particle = card.particles[index];
            particle.age += delta * (isHovered ? 1 : 4);

            if (isHovered && particle.age >= particle.duration) {
                card.particles[index] = this.#createParticle(card);
                continue;
            }

            if (!isHovered && particle.age >= particle.duration) {
                card.particles.splice(index, 1);
            }
        }
    }

    /**
     * 카드 리플 상태를 업데이트합니다.
     * @param {object} card - 대상 카드
     * @param {number} delta - 프레임 델타
     * @private
     */
    #updateCardRipples(card, delta) {
        for (let index = card.ripples.length - 1; index >= 0; index--) {
            const ripple = card.ripples[index];
            ripple.age += delta;
            if (ripple.age >= ripple.duration) {
                card.ripples.splice(index, 1);
            }
        }
    }

    /**
     * 카드에 표시할 입자 객체를 생성합니다.
     * @param {object} card - 대상 카드
     * @returns {object} 입자 상태 객체
     * @private
     */
    #createParticle(card) {
        const padding = Math.max(12, card.baseWidth * 0.08);
        return {
            localX: lerp(padding, Math.max(padding, card.baseWidth - padding), Math.random()),
            localY: lerp(padding, Math.max(padding, card.baseHeight - padding), Math.random()),
            driftX: (Math.random() - 0.5) * 42,
            driftY: (Math.random() - 0.5) * 42,
            orbitRadius: 6 + (Math.random() * 18),
            orbitSpeed: 1.4 + (Math.random() * 1.8),
            phase: Math.random() * Math.PI * 2,
            size: Math.max(TITLE_MAGIC_BENTO.PARTICLE_SIZE_MIN, this.UIWW * TITLE_MAGIC_BENTO.PARTICLE_SIZE_UIWW_RATIO) * (0.55 + (Math.random() * 0.55)),
            duration: lerp(TITLE_MAGIC_BENTO.PARTICLE_DURATION_MIN, TITLE_MAGIC_BENTO.PARTICLE_DURATION_MAX, Math.random()),
            age: Math.random() * TITLE_MAGIC_BENTO.PARTICLE_DURATION_MAX,
            alphaScale: 0.45 + (Math.random() * 0.55)
        };
    }

    /**
     * 카드 클릭 리플을 생성합니다.
     * @param {object} card - 대상 카드
     * @param {number} localX - 카드 내부 X 좌표
     * @param {number} localY - 카드 내부 Y 좌표
     * @private
     */
    #spawnRipple(card, localX, localY) {
        card.ripples.push({
            localX,
            localY,
            age: 0,
            duration: TITLE_MAGIC_BENTO.RIPPLE_DURATION,
            radius: Math.max(card.baseWidth, card.baseHeight) * 0.9
        });
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
     * 카드 영역 전체에 퍼지는 글로벌 스포트라이트를 그립니다.
     * @param {CanvasRenderingContext2D} ctx - UI 컨텍스트
     * @private
     */
    #drawGlobalSpotlight(ctx) {
        if (this.spotlightOpacity <= 0.01 || this.groupBounds.w <= 0 || this.groupBounds.h <= 0) {
            return;
        }

        const radius = Math.max(
            TITLE_MAGIC_BENTO.SPOTLIGHT_RADIUS_MIN,
            this.UIWW * TITLE_MAGIC_BENTO.SPOTLIGHT_RADIUS_UIWW_RATIO
        );
        const gradient = ctx.createRadialGradient(this.spotlightX, this.spotlightY, 0, this.spotlightX, this.spotlightY, radius);

        gradient.addColorStop(0, getBentoAccentColor(0.22 * this.spotlightOpacity));
        gradient.addColorStop(0.2, getBentoAccentColor(0.14 * this.spotlightOpacity));
        gradient.addColorStop(0.4, getBentoAccentColor(0.08 * this.spotlightOpacity));
        gradient.addColorStop(0.72, getBentoAccentColor(0.02 * this.spotlightOpacity));
        gradient.addColorStop(1, getBentoAccentColor(0));

        ctx.save();
        ctx.beginPath();
        ctx.rect(
            this.groupBounds.x - 48,
            this.groupBounds.y - 48,
            this.groupBounds.w + 96,
            this.groupBounds.h + 96
        );
        ctx.clip();
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(this.spotlightX, this.spotlightY, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
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

        this.#drawCardBody(ctx, card, palette, radius);
        this.#drawCardSurfaceGlow(ctx, card, radius);
        this.#drawCardEffects(ctx, card, radius);
        this.#drawCardContent(ctx, card, palette);
        this.#drawCardBorder(ctx, card, palette, radius);

        ctx.restore();
    }

    /**
     * 카드의 기본 몸체와 그림자를 그립니다.
     * @param {CanvasRenderingContext2D} ctx - UI 컨텍스트
     * @param {object} card - 대상 카드
     * @param {object} palette - 카드 팔레트
     * @param {number} radius - 카드 모서리 반경
     * @private
     */
    #drawCardBody(ctx, card, palette, radius) {
        const gradient = ctx.createLinearGradient(0, 0, 0, card.baseHeight);
        gradient.addColorStop(0, palette.topFill);
        gradient.addColorStop(1, palette.bottomFill);

        ctx.save();
        this.#traceRoundRect(ctx, 0, 0, card.baseWidth, card.baseHeight, radius);
        ctx.shadowColor = palette.shadow;
        ctx.shadowBlur = 18 + (card.hoverProgress * 14) + (card.glowIntensity * 16);
        ctx.shadowOffsetY = 10 + (card.hoverProgress * 3);
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.restore();

        ctx.save();
        this.#traceRoundRect(ctx, 0, 0, card.baseWidth, card.baseHeight, radius);
        ctx.clip();
        const overlay = ctx.createLinearGradient(0, 0, card.baseWidth, card.baseHeight);
        overlay.addColorStop(0, palette.overlayTop);
        overlay.addColorStop(1, palette.overlayBottom);
        ctx.fillStyle = overlay;
        ctx.fillRect(0, 0, card.baseWidth, card.baseHeight);
        ctx.restore();
    }

    /**
     * 포인터 위치를 중심으로 카드 내부 발광을 그립니다.
     * @param {CanvasRenderingContext2D} ctx - UI 컨텍스트
     * @param {object} card - 대상 카드
     * @param {number} radius - 카드 모서리 반경
     * @private
     */
    #drawCardSurfaceGlow(ctx, card, radius) {
        if (card.glowIntensity <= 0.01) {
            return;
        }

        const glowRadius = Math.max(card.baseWidth, card.baseHeight) * 0.9;
        const gradient = ctx.createRadialGradient(
            card.localMouseX,
            card.localMouseY,
            0,
            card.localMouseX,
            card.localMouseY,
            glowRadius
        );

        gradient.addColorStop(0, getBentoAccentColor(0.2 * card.glowIntensity));
        gradient.addColorStop(0.28, getBentoAccentColor(0.12 * card.glowIntensity));
        gradient.addColorStop(0.58, getBentoAccentColor(0.05 * card.glowIntensity));
        gradient.addColorStop(1, getBentoAccentColor(0));

        ctx.save();
        this.#traceRoundRect(ctx, 0, 0, card.baseWidth, card.baseHeight, radius);
        ctx.clip();
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, card.baseWidth, card.baseHeight);
        ctx.restore();
    }

    /**
     * 카드 안쪽의 리플과 입자를 렌더링합니다.
     * @param {CanvasRenderingContext2D} ctx - UI 컨텍스트
     * @param {object} card - 대상 카드
     * @param {number} radius - 카드 모서리 반경
     * @private
     */
    #drawCardEffects(ctx, card, radius) {
        if (card.particles.length === 0 && card.ripples.length === 0) {
            return;
        }

        ctx.save();
        this.#traceRoundRect(ctx, 0, 0, card.baseWidth, card.baseHeight, radius);
        ctx.clip();
        this.#drawCardRipples(ctx, card);
        this.#drawCardParticles(ctx, card);
        ctx.restore();
    }

    /**
     * 카드 내부의 클릭 리플을 그립니다.
     * @param {CanvasRenderingContext2D} ctx - UI 컨텍스트
     * @param {object} card - 대상 카드
     * @private
     */
    #drawCardRipples(ctx, card) {
        for (const ripple of card.ripples) {
            const progress = clamp(ripple.age / ripple.duration, 0, 1);
            const radius = ripple.radius * easeOutExpo(progress);
            const gradient = ctx.createRadialGradient(
                ripple.localX,
                ripple.localY,
                0,
                ripple.localX,
                ripple.localY,
                radius
            );
            const alpha = (1 - progress) * 0.36;

            gradient.addColorStop(0, getBentoAccentColor(alpha));
            gradient.addColorStop(0.35, getBentoAccentColor(alpha * 0.55));
            gradient.addColorStop(1, getBentoAccentColor(0));

            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(ripple.localX, ripple.localY, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    /**
     * 카드 내부에 떠다니는 입자를 그립니다.
     * @param {CanvasRenderingContext2D} ctx - UI 컨텍스트
     * @param {object} card - 대상 카드
     * @private
     */
    #drawCardParticles(ctx, card) {
        for (const particle of card.particles) {
            const progress = clamp(particle.age / particle.duration, 0, 1);
            const orbit = particle.phase + (progress * Math.PI * 2 * particle.orbitSpeed);
            const alpha = Math.sin(progress * Math.PI) * 0.9 * particle.alphaScale;
            const x = particle.localX + (Math.cos(orbit) * particle.orbitRadius) + (particle.driftX * progress);
            const y = particle.localY + (Math.sin(orbit) * particle.orbitRadius) + (particle.driftY * progress);

            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            ctx.fillStyle = getBentoAccentColor(alpha);
            ctx.shadowBlur = particle.size * 3.8;
            ctx.shadowColor = getBentoAccentColor(alpha * 0.95);
            ctx.beginPath();
            ctx.arc(x, y, particle.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    /**
     * 카드 아이콘과 텍스트를 렌더링합니다.
     * @param {CanvasRenderingContext2D} ctx - UI 컨텍스트
     * @param {object} card - 대상 카드
     * @param {object} palette - 카드 팔레트
     * @private
     */
    #drawCardContent(ctx, card, palette) {
        const padding = Math.max(16, this.UIWW * TITLE_MAGIC_BENTO.CONTENT_PADDING_UIWW_RATIO);
        const iconSize = Math.min(card.baseWidth, card.baseHeight) * (card.variant === 'compact' ? 0.19 : 0.21);
        const titleText = getLangString(card.titleKey) || '';
        const descriptionText = card.descriptionKey ? (getLangString(card.descriptionKey) || '') : '';
        const iconX = padding;
        const iconY = card.variant === 'compact'
            ? (card.baseHeight - iconSize) * 0.5
            : padding;

        drawBentoCardIcon(ctx, card.icon, iconX, iconY, iconSize, palette.text);

        ctx.save();
        ctx.fillStyle = palette.text;
        ctx.textBaseline = 'top';

        if (card.variant === 'hero') {
            const titleFont = getBentoTypography(TEXT_CONSTANTS, 'H3_BOLD', 1.18);
            const descriptionFont = getBentoTypography(TEXT_CONSTANTS, 'H6', 1.04);
            const titleY = card.baseHeight - padding - titleFont.size - (descriptionText ? (descriptionFont.size * 1.7) : 0);

            ctx.font = titleFont.font;
            ctx.fillText(titleText, padding, titleY);

            if (descriptionText) {
                ctx.fillStyle = palette.description;
                ctx.font = descriptionFont.font;
                drawBentoWrappedText(
                    ctx,
                    descriptionText,
                    padding,
                    titleY + titleFont.size + Math.max(8, descriptionFont.size * 0.28),
                    card.baseWidth - (padding * 2),
                    descriptionFont.size * 1.35,
                    2
                );
            }
            ctx.restore();
            return;
        }

        if (card.variant === 'compact') {
            const compactFont = getBentoTypography(TEXT_CONSTANTS, 'H5_BOLD', 1.04);
            const titleSize = compactFont.size;
            const compactX = padding + iconSize + Math.max(14, padding * 0.7);
            ctx.font = compactFont.font;
            ctx.fillText(titleText, compactX, (card.baseHeight - titleSize) * 0.5);
            ctx.restore();
            return;
        }

        const titleFont = getBentoTypography(TEXT_CONSTANTS, 'H4_BOLD', 1.08);
        const descriptionFont = getBentoTypography(TEXT_CONSTANTS, 'H6', 1.12);
        const titleSize = titleFont.size;
        const descriptionSize = descriptionFont.size;
        const contentX = padding;
        const titleY = card.baseHeight - padding - (descriptionText ? (descriptionSize * 2.3) : titleSize);
        const maxWidth = card.baseWidth - (padding * 2);

        ctx.font = titleFont.font;
        ctx.fillText(titleText, contentX, titleY);

        if (descriptionText) {
            ctx.fillStyle = palette.description;
            ctx.font = descriptionFont.font;
            drawBentoWrappedText(ctx, descriptionText, contentX, titleY + titleSize + Math.max(8, descriptionSize * 0.35), maxWidth, descriptionSize * 1.35, 2);
        }

        ctx.restore();
    }

    /**
     * 카드 외곽선과 액센트 글로우를 그립니다.
     * @param {CanvasRenderingContext2D} ctx - UI 컨텍스트
     * @param {object} card - 대상 카드
     * @param {object} palette - 카드 팔레트
     * @param {number} radius - 카드 모서리 반경
     * @private
     */
    #drawCardBorder(ctx, card, palette, radius) {
        const baseBorderWidth = TITLE_MAGIC_BENTO.BORDER_WIDTH * (1 + (card.hoverProgress * 0.95));

        ctx.save();
        this.#traceRoundRect(ctx, 0, 0, card.baseWidth, card.baseHeight, radius);
        ctx.lineWidth = baseBorderWidth;
        ctx.strokeStyle = palette.border;
        ctx.stroke();
        ctx.restore();

        if (card.hoverProgress > 0.01) {
            ctx.save();
            this.#traceRoundRect(ctx, 0, 0, card.baseWidth, card.baseHeight, radius);
            ctx.lineWidth = baseBorderWidth + (1.2 * card.hoverProgress);
            ctx.strokeStyle = `rgba(255, 255, 255, ${0.16 * card.hoverProgress})`;
            ctx.stroke();
            ctx.restore();
        }

        if (card.glowIntensity <= 0.01) {
            return;
        }

        const glowRadius = Math.max(card.baseWidth, card.baseHeight) * 0.95;
        const borderGradient = ctx.createRadialGradient(
            card.localMouseX,
            card.localMouseY,
            0,
            card.localMouseX,
            card.localMouseY,
            glowRadius
        );

        borderGradient.addColorStop(0, getBentoAccentColor(0.75 * card.glowIntensity));
        borderGradient.addColorStop(0.26, getBentoAccentColor(0.38 * card.glowIntensity));
        borderGradient.addColorStop(0.65, getBentoAccentColor(0.08 * card.glowIntensity));
        borderGradient.addColorStop(1, getBentoAccentColor(0));

        ctx.save();
        this.#traceRoundRect(ctx, 0, 0, card.baseWidth, card.baseHeight, radius);
        ctx.lineWidth = TITLE_MAGIC_BENTO.BORDER_WIDTH * (2.6 + (card.hoverProgress * 1.8));
        ctx.strokeStyle = borderGradient;
        ctx.shadowBlur = 22 + (card.glowIntensity * 18) + (card.hoverProgress * 16);
        ctx.shadowColor = getBentoAccentColor(0.82 * card.glowIntensity);
        ctx.stroke();
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

    /**
     * 카드용 둥근 사각형 경로를 생성합니다.
     * @param {CanvasRenderingContext2D} ctx - UI 컨텍스트
     * @param {number} x - X 좌표
     * @param {number} y - Y 좌표
     * @param {number} width - 너비
     * @param {number} height - 높이
     * @param {number} radius - 모서리 반경
     * @private
     */
    #traceRoundRect(ctx, x, y, width, height, radius) {
        ctx.beginPath();
        ctx.roundRect(x, y, width, height, radius);
    }

}
