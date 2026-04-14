import { animate, remove } from 'animation/animation_system.js';
import { getData } from 'data/data_handler.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { colorUtil } from 'util/color_util.js';
import { getUIOffsetX, getUIWW, getWH, render } from 'display/display_system.js';
import { getDelta } from 'game/time_handler.js';
import { getSetting } from 'save/save_system.js';
import { getLangString } from 'ui/ui_system.js';
import { parseUIData } from 'ui/layout/_positioning_handler.js';
import { UIPool, releaseUIItem } from 'ui/_ui_pool.js';
import { TitleCenterCircle } from './_title_center_circle.js';
import { TitleLogo } from './_title_logo.js';
import { TitleMenu } from './_title_menu.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');
const TEXT_CONSTANTS = getData('TEXT_CONSTANTS');
const TITLE_LOADING = TITLE_CONSTANTS.TITLE_LOADING;
const TITLE_LOGO_ASPECT_RATIO = 589.45 / 1178.8;
const DEBUG_SKIP_LOADING_LABEL = '로딩 스킵';

/**
 * 로딩 화면 텍스트에 사용할 기본 색상을 반환합니다.
 * @returns {string} 로딩 텍스트 색상
 */
function getLoadingTextColor() {
    return ColorSchemes?.Title?.Loading?.Text
        || ColorSchemes?.Title?.TextDark
        || ColorSchemes?.Title?.Button?.Text
        || ColorSchemes?.Title?.Menu?.Foreground;
}

/**
 * 로딩 액센트 색상을 반환합니다.
 * @returns {string} 로딩 액센트 색상
 */
function getLoadingAccentColor() {
    return ColorSchemes?.Title?.Loading?.Accent
        || ColorSchemes?.Title?.Menu?.Accent
        || ColorSchemes?.Cursor?.Active
        || ColorSchemes?.Title?.Menu?.Foreground
        || ColorSchemes?.Title?.TextDark;
}

/**
 * rgba 형식 문자열에서 rgb 값으로 변환 후 알파를 붙여 반환합니다.
 * @param {string} color - css 색상 문자열
 * @param {number} alpha - 알파 값
 * @returns {string} rgba 문자열
 */
function toAccentRgba(color, alpha) {
    const safeAlpha = Number.isFinite(alpha) ? alpha : 1;
    const parsed = colorUtil().cssToRgb(color);
    if (!parsed) {
        const fallback = colorUtil().cssToRgb(getLoadingTextColor());
        if (!fallback) {
            return 'transparent';
        }
        return `rgba(${fallback.r}, ${fallback.g}, ${fallback.b}, ${safeAlpha})`;
    }
    return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${safeAlpha})`;
}

/**
 * 로딩 skip 버튼의 기본 색상을 반환합니다.
 * @returns {{text:string, idleColor:string, hoverColor:string}} skip 버튼 색상
 */
function getLoadingSkipButtonStyle() {
    const accent = getLoadingAccentColor();
    const skipButton = ColorSchemes?.Title?.Loading?.SkipButton;
    return {
        text: skipButton?.Text || getLoadingTextColor(),
        idleColor: skipButton?.Idle || toAccentRgba(accent, 0.12),
        hoverColor: skipButton?.Hover || toAccentRgba(accent, 0.22)
    };
}

/**
 * @class TitleLoadingSequence
 * @description 타이틀 화면의 로딩 진행, 텍스트, 로고와 메뉴 전환을 관리합니다.
 */
export class TitleLoadingSequence {
    /**
     * @param {TitleScene} titleScene - 타이틀 씬 인스턴스
     */
    constructor(titleScene) {
        this.titleScene = titleScene;
        this.WH = getWH();
        this.UIWW = getUIWW();
        this.UIOffsetX = getUIOffsetX();
        this.loadingProgress = 0;
        this.loadingTextAlpha = TITLE_LOADING.TEXT_ALPHA;
        this.loadingTextExitProgress = 0;
        this.loadingNoticeAlpha = TITLE_LOADING.TEXT_ALPHA;
        this.loadingElapsed = 0;
        this.loadingStepIndex = 0;
        this.loadingTextFontSize = 0;
        this.loadingTextFont = '';
        this.loadingTextX = 0;
        this.loadingTextY = 0;
        this.loadingNoticeFontSize = 0;
        this.loadingNoticeFont = '';
        this.loadingNoticeLineHeight = 0;
        this.loadingNoticeStartY = 0;
        this.loadingNoticeLines = [];
        this.loadingTextBlockBottomY = 0;
        this.loadingTextExitDistance = 0;
        this.loadingSegmentEndTimes = [];
        this.loadingSegmentTargetProgresses = [];
        this.loadingFinished = false;
        this.destroyed = false;
        this.loadingLogoTimeoutId = null;
        this.loadingProgressAnimId = -1;
        this.loadingTextAlphaAnimId = -1;
        this.loadingTextTranslateAnimId = -1;
        this.loadingNoticeFadeAnimId = -1;
        this.loadingNoticeFadeStarted = false;
        this.loadingGlowCompensationAnimId = -1;
        this.sceneTransitionProgress = 0;
        this.sceneTransitionStarted = false;
        this.sceneTransitionAnimId = -1;
        this.centerCircle = new TitleCenterCircle();
        this.titleLogo = null;
        this.titleMenu = null;
        this.debugSkipLoadingButton = null;

        this.#recalculateLayout();
        this.#createDebugSkipLoadingButton();
        this.#startLoading();
    }

    /**
     * 로딩 진행률, 중앙 원, 로고와 메뉴 상태를 갱신합니다.
     */
    update() {
        this.#updateLoadingProgress();
        this.centerCircle.setProgress(this.loadingProgress);
        this.centerCircle.update();

        if (this.titleLogo) {
            this.titleLogo.update();
            this.#updateLoadingNoticeFade();
            this.#updateSceneTransition();
            this.#updateLoadingVisualPlacement();
            this.#updateLogoPlacement();
        } else {
            this.#updateLoadingVisualPlacement();
        }
        if (this.titleMenu) {
            this.titleMenu.update();
        }
        if (this.debugSkipLoadingButton && this.#shouldShowDebugSkipButton()) {
            this.debugSkipLoadingButton.update();
        }
    }

    /**
     * 로딩 관련 UI를 그립니다.
     */
    draw() {
        this.centerCircle.draw();
        if (this.titleLogo) {
            this.titleLogo.draw();
        }
        if (this.titleMenu) {
            this.titleMenu.draw();
        }
        this.#drawLoadingText();
        if (this.debugSkipLoadingButton && this.#shouldShowDebugSkipButton()) {
            this.debugSkipLoadingButton.draw();
        }
    }

    /**
     * 화면 크기 변경에 맞춰 로딩 시퀀스 배치를 다시 계산합니다.
     */
    resize() {
        this.WH = getWH();
        this.UIWW = getUIWW();
        this.UIOffsetX = getUIOffsetX();
        this.centerCircle.resize();
        this.#updateLoadingVisualPlacement();
        if (this.titleLogo) {
            this.titleLogo.resize();
            this.#updateLogoPlacement();
        }
        if (this.titleMenu) {
            this.titleMenu.resize();
        }
        this.#recalculateLayout();
        this.#layoutDebugSkipLoadingButton();
    }

    /**
     * 로딩 시퀀스가 생성한 리소스를 정리합니다.
     */
    destroy() {
        this.destroyed = true;
        remove(this.loadingProgressAnimId);
        remove(this.loadingTextAlphaAnimId);
        remove(this.loadingTextTranslateAnimId);
        remove(this.loadingNoticeFadeAnimId);
        remove(this.loadingGlowCompensationAnimId);
        remove(this.sceneTransitionAnimId);
        this.#clearLoadingLogoTimeout();

        if (this.centerCircle) {
            this.centerCircle.destroy();
            this.centerCircle = null;
        }
        if (this.titleLogo) {
            this.titleLogo.destroy();
            this.titleLogo = null;
        }
        if (this.titleMenu) {
            this.titleMenu.destroy();
            this.titleMenu = null;
        }
        if (this.debugSkipLoadingButton) {
            releaseUIItem(this.debugSkipLoadingButton);
            this.debugSkipLoadingButton = null;
        }
    }

    /**
     * 현재 설정 변경을 로딩 시퀀스 UI에 반영합니다.
     * @param {object} [changedSettings={}] - 변경된 설정 키와 값입니다.
     */
    applyRuntimeSettings(changedSettings = {}) {
        if (changedSettings.debugMode === true) {
            this.#createDebugSkipLoadingButton();
            this.#layoutDebugSkipLoadingButton();
        } else if (changedSettings.debugMode === false && this.debugSkipLoadingButton) {
            releaseUIItem(this.debugSkipLoadingButton);
            this.debugSkipLoadingButton = null;
        }

        if (changedSettings.theme !== undefined) {
            this.#applyDebugSkipButtonStyle();
            if (this.titleLogo && typeof this.titleLogo.setColor === 'function') {
                this.titleLogo.setColor(ColorSchemes?.Title?.TextDark);
            }
            this.#layoutDebugSkipLoadingButton();
        }

        if ((changedSettings.theme !== undefined
            || changedSettings.language !== undefined
            || changedSettings.disableTransparency !== undefined)
            && this.titleMenu
            && typeof this.titleMenu.applyRuntimeSettings === 'function') {
            this.titleMenu.applyRuntimeSettings(changedSettings);
        }

        if (changedSettings.language !== undefined) {
            this.#recalculateLayout();
            this.#layoutDebugSkipLoadingButton();
        }
    }

    /**
     * 타이틀 배경 실드가 따라갈 중심/반경 정보를 반환합니다.
     * @returns {{centerX:number, centerY:number, radius:number}|null} 실드 레이아웃입니다.
     */
    getEnemyShieldLayout() {
        return this.centerCircle?.getCircleLayout?.() || null;
    }

    /**
     * 타이틀 배경 적이 끌려갈 자석점 좌표를 반환합니다.
     * @returns {{x:number, y:number}|null} 자석점 좌표입니다.
     */
    getEnemyMagneticPoint() {
        const circleLayout = this.getEnemyShieldLayout();
        if (!circleLayout) {
            return null;
        }

        return {
            x: circleLayout.centerX,
            y: circleLayout.centerY
        };
    }

    /**
     * 타이틀 배경 적 스폰을 시작해도 되는지 반환합니다.
     * @returns {boolean} 로고 이동 애니메이션 완료 여부입니다.
     */
    isEnemySpawnReady() {
        return this.sceneTransitionStarted === true
            && this.sceneTransitionProgress >= this.#getEnemySpawnReadyProgressThreshold();
    }

    /**
     * 적 스폰을 허용할 전환 진행률 기준을 반환합니다.
     * 전환 종료 시점보다 일정 시간만큼 앞당겨 스폰을 시작합니다.
     * @returns {number} 0~1 범위의 전환 진행률 기준값입니다.
     * @private
     */
    #getEnemySpawnReadyProgressThreshold() {
        const transitionDuration = Number.isFinite(TITLE_LOADING.SCENE_TRANSITION_DURATION)
            && TITLE_LOADING.SCENE_TRANSITION_DURATION > 0
            ? TITLE_LOADING.SCENE_TRANSITION_DURATION
            : 1;
        const spawnLeadSeconds = Number.isFinite(TITLE_LOADING.ENEMY_SPAWN_READY_LEAD_SECONDS)
            ? Math.max(0, TITLE_LOADING.ENEMY_SPAWN_READY_LEAD_SECONDS)
            : 0;
        return Math.max(0, Math.min(1, 1 - (spawnLeadSeconds / transitionDuration)));
    }

    /**
     * 랜덤 체크포인트 기반 로딩 스케줄을 준비합니다.
     * @private
     */
    #startLoading() {
        const loadingSchedule = this.#buildLoadingSchedule();
        this.loadingSegmentEndTimes = [];
        this.loadingSegmentTargetProgresses = [];

        for (let i = 0; i < loadingSchedule.length; i++) {
            this.loadingSegmentTargetProgresses.push(loadingSchedule[i].targetProgress);
            this.loadingSegmentEndTimes.push(loadingSchedule[i].endTime);
        }
    }

    /**
     * 경과 시간에 따라 다음 로딩 단계 진입 여부를 판단합니다.
     * @private
     */
    #updateLoadingProgress() {
        if (this.loadingFinished) {
            return;
        }

        const delta = getDelta();
        if (!Number.isFinite(delta) || delta <= 0) {
            return;
        }

        this.loadingElapsed += delta;
        while (
            this.loadingStepIndex < this.loadingSegmentEndTimes.length
            && this.loadingElapsed >= this.loadingSegmentEndTimes[this.loadingStepIndex]
        ) {
            this.loadingStepIndex += 1;
            this.#animateLoadingStep(this.loadingStepIndex);
        }
    }

    /**
     * 현재 단계에 맞는 목표 진행률로 부드럽게 이동시킵니다.
     * @param {number} stepIndex - 도달한 로딩 단계
     * @private
     */
    #animateLoadingStep(stepIndex) {
        if (this.loadingProgressAnimId >= 0) {
            remove(this.loadingProgressAnimId);
        }

        const isFinalStep = stepIndex >= this.loadingSegmentEndTimes.length;
        const targetProgress = this.loadingSegmentTargetProgresses[stepIndex - 1] ?? TITLE_LOADING.COMPLETE_PROGRESS;
        const progressAnim = animate(this, {
            variable: 'loadingProgress',
            startValue: 'current',
            endValue: targetProgress,
            duration: TITLE_LOADING.STEP_ANIM_DURATION,
            type: 'easeOutExpo'
        });
        this.loadingProgressAnimId = progressAnim.id;

        if (isFinalStep) {
            progressAnim.promise.then(() => {
                if (this.destroyed) {
                    return;
                }
                this.#finishLoading();
            });
        }
    }

    /**
     * 가짜 로딩 체크포인트를 생성합니다.
     * @returns {Array<{targetProgress:number, endTime:number}>} 목표 진행률과 도달 시간 리스트입니다.
     * @private
     */
    #buildLoadingSchedule() {
        return [
            {
                targetProgress: this.#getRandomValueInRange(0.2, 0.4),
                endTime: this.#getRandomValueInRange(0.6, 1)
            },
            {
                targetProgress: this.#getRandomValueInRange(0.7, 0.85),
                endTime: this.#getRandomValueInRange(1.4, 1.8)
            },
            {
                targetProgress: TITLE_LOADING.COMPLETE_PROGRESS,
                endTime: this.#getRandomValueInRange(2.2, 2.5)
            }
        ];
    }

    /**
     * 주어진 범위 안에서 랜덤 실수 값을 반환합니다.
     * @param {number} min - 최소값입니다.
     * @param {number} max - 최대값입니다.
     * @returns {number} 랜덤으로 선택된 값입니다.
     * @private
     */
    #getRandomValueInRange(min, max) {
        return min + (Math.random() * (max - min));
    }

    /**
     * 로딩 완료 후 메인 텍스트만 사라지도록 fade out과 위 이동 애니메이션을 실행합니다.
     * @param {{showLogoDelayMs?: number, animateTextExit?: boolean}} [options] - 완료 연출 옵션입니다.
     * @private
     */
    #finishLoading(options = {}) {
        if (this.loadingFinished) {
            return;
        }

        const showLogoDelayMs = Number.isFinite(options.showLogoDelayMs) ? options.showLogoDelayMs : 500;
        const animateTextExit = options.animateTextExit !== false;
        this.loadingFinished = true;
        this.#scheduleTitleLogo(showLogoDelayMs);

        if (!animateTextExit) {
            remove(this.loadingTextAlphaAnimId);
            remove(this.loadingTextTranslateAnimId);
            this.loadingTextAlphaAnimId = -1;
            this.loadingTextTranslateAnimId = -1;
            this.loadingTextAlpha = 0;
            this.loadingTextExitProgress = 1;
            return;
        }

        this.loadingTextAlphaAnimId = animate(this, {
            variable: 'loadingTextAlpha',
            startValue: 'current',
            endValue: 0,
            type: 'easeInExpo',
            duration: TITLE_LOADING.TEXT_FADE_DURATION
        }).id;
        this.loadingTextTranslateAnimId = animate(this, {
            variable: 'loadingTextExitProgress',
            startValue: 'current',
            endValue: 1,
            type: 'easeInExpo',
            duration: TITLE_LOADING.TEXT_FADE_DURATION
        }).id;
    }

    /**
     * 디버그 모드에서 가짜 로딩을 즉시 건너뜁니다.
     * @private
     */
    #skipLoadingForDebug() {
        if (!this.#shouldShowDebugSkipButton()) {
            return;
        }

        remove(this.loadingProgressAnimId);
        this.loadingProgressAnimId = -1;
        this.loadingProgress = TITLE_LOADING.COMPLETE_PROGRESS;
        this.loadingElapsed = this.loadingSegmentEndTimes[this.loadingSegmentEndTimes.length - 1] ?? 0;
        this.loadingStepIndex = this.loadingSegmentEndTimes.length;
        this.centerCircle.setProgress(this.loadingProgress);
        this.#finishLoading({
            showLogoDelayMs: 0,
            animateTextExit: false
        });
    }

    /**
     * 로딩 완료 후 로고를 생성하고 현재 원형 로딩 UI 왼쪽에 배치합니다.
     * @private
     */
    #showTitleLogo() {
        const createdLogo = !this.titleLogo;
        const createdMenu = !this.titleMenu;

        if (createdLogo) {
            this.titleLogo = new TitleLogo(this.titleScene);
            this.titleLogo.play(ColorSchemes?.Title?.TextDark);
        }
        if (createdMenu) {
            this.titleMenu = new TitleMenu(this.titleScene);
        }

        if (createdLogo || createdMenu) {
            this.resize();
            return;
        }

        this.#updateLogoPlacement();
    }

    /**
     * 로고 표시 타이머를 설정합니다.
     * @param {number} delayMs - 로고를 표시하기 전 대기 시간입니다.
     * @private
     */
    #scheduleTitleLogo(delayMs) {
        this.#clearLoadingLogoTimeout();
        this.loadingLogoTimeoutId = window.setTimeout(() => {
            this.loadingLogoTimeoutId = null;
            if (this.destroyed) {
                return;
            }
            this.#showTitleLogo();
        }, Math.max(0, delayMs));
    }

    /**
     * 예약된 로고 표시 타이머를 정리합니다.
     * @private
     */
    #clearLoadingLogoTimeout() {
        if (this.loadingLogoTimeoutId === null) {
            return;
        }

        window.clearTimeout(this.loadingLogoTimeoutId);
        this.loadingLogoTimeoutId = null;
    }

    /**
     * 로고 드로잉 재생률이 기준을 넘으면 축소 및 이동 전환을 시작합니다.
     * @private
     */
    #updateSceneTransition() {
        if (!this.titleLogo || this.sceneTransitionStarted) {
            return;
        }

        if (this.titleLogo.getPlaybackProgress() < TITLE_LOADING.SCENE_TRANSITION_TRIGGER_PROGRESS) {
            return;
        }

        this.sceneTransitionStarted = true;
        this.sceneTransitionAnimId = animate(this, {
            variable: 'sceneTransitionProgress',
            startValue: 0,
            endValue: 1,
            type: 'easeInOutExpo',
            duration: TITLE_LOADING.SCENE_TRANSITION_DURATION
        }).id;
        this.loadingGlowCompensationAnimId = animate(this.centerCircle, {
            variable: 'glowCompensationScale',
            startValue: 'current',
            endValue: TITLE_LOADING.GLOW_COMPENSATION_SCALE,
            type: 'easeInOutExpo',
            duration: TITLE_LOADING.SCENE_TRANSITION_DURATION
        }).id;
    }

    /**
     * 원/로고 전환 시작 전 지정된 시점에 맞춰 팁 문구 페이드아웃을 시작합니다.
     * @private
     */
    #updateLoadingNoticeFade() {
        if (!this.titleLogo || this.loadingNoticeFadeStarted || this.loadingNoticeAlpha <= 0) {
            return;
        }

        const fadeLeadTime = Number.isFinite(TITLE_LOADING.NOTICE_FADE_LEAD_TIME)
            ? TITLE_LOADING.NOTICE_FADE_LEAD_TIME
            : 1;
        const fadeDuration = Number.isFinite(TITLE_LOADING.NOTICE_FADE_DURATION)
            ? TITLE_LOADING.NOTICE_FADE_DURATION
            : 0.5;
        const fadeEndLeadTime = Math.max(0, fadeLeadTime - fadeDuration);
        const remainingTime = this.titleLogo.getRemainingTimeToProgress(
            TITLE_LOADING.SCENE_TRANSITION_TRIGGER_PROGRESS
        );

        if (remainingTime > fadeLeadTime) {
            return;
        }

        const availableFadeDuration = Math.min(
            fadeDuration,
            Math.max(0, remainingTime - fadeEndLeadTime)
        );
        this.#startLoadingNoticeFade(availableFadeDuration);
    }

    /**
     * 로딩 팁 문구의 페이드아웃을 시작합니다.
     * @param {number} duration - 페이드아웃 지속 시간입니다.
     * @private
     */
    #startLoadingNoticeFade(duration) {
        if (this.loadingNoticeFadeStarted) {
            return;
        }

        this.loadingNoticeFadeStarted = true;
        remove(this.loadingNoticeFadeAnimId);
        this.loadingNoticeFadeAnimId = -1;

        if (!Number.isFinite(duration) || duration <= 0) {
            this.loadingNoticeAlpha = 0;
            return;
        }

        this.loadingNoticeFadeAnimId = animate(this, {
            variable: 'loadingNoticeAlpha',
            startValue: 'current',
            endValue: 0,
            type: 'easeInExpo',
            duration
        }).id;
    }

    /**
     * 원형 로딩 UI 위치를 기준으로 로고 배치를 다시 계산합니다.
     * @private
     */
    #updateLogoPlacement() {
        if (!this.titleLogo || !this.centerCircle) {
            return;
        }

        const circleLayout = this.centerCircle.getCircleLayout();
        const horizontalGap = Math.max(18, this.WH * 0.025);
        const leftPadding = Math.max(18, this.UIWW * 0.02);
        const availableWidth = Math.max(
            64,
            (circleLayout.centerX - circleLayout.radius) - (this.UIOffsetX + leftPadding + horizontalGap)
        );
        const preferredWidth = Math.min(this.UIWW * 0.28, circleLayout.radius * 3.15) * 0.8;
        const logoWidth = Math.min(preferredWidth, availableWidth);
        const logoX = Math.max(
            this.UIOffsetX + leftPadding,
            (circleLayout.centerX - circleLayout.radius) - horizontalGap - logoWidth
        );
        const finalLogoWidth = this.UIWW * TITLE_LOADING.LOGO_FINAL_WIDTH_UIWW_RATIO * 0.8;
        const finalLogoX = this.UIOffsetX + (this.UIWW * TITLE_LOADING.LOGO_FINAL_LEFT_UIWW_RATIO);
        const finalLogoCenterY = this.WH * (TITLE_LOADING.LOGO_FINAL_CENTER_Y_RATIO || 0.5);
        const transition = this.sceneTransitionProgress;
        const blendedWidth = logoWidth + ((finalLogoWidth - logoWidth) * transition);
        const blendedX = logoX + ((finalLogoX - logoX) * transition);
        const blendedCenterY = circleLayout.centerY + ((finalLogoCenterY - circleLayout.centerY) * transition);

        this.titleLogo.setPlacement({
            x: blendedX,
            width: blendedWidth,
            centerY: blendedCenterY
        });
    }

    /**
     * 전환 진행률에 맞춰 중앙 원을 최종 위치로 이동시키고 크기는 유지합니다.
     * @private
     */
    #updateLoadingVisualPlacement() {
        if (!this.centerCircle) {
            return;
        }

        this.centerCircle.setVisualScale(TITLE_LOADING.MINI_CIRCLE_SCALE || 1);
        this.centerCircle.setPlacementProgress(this.sceneTransitionProgress);
    }

    /**
     * 디버그 전용 로딩 스킵 버튼을 생성합니다.
     * @private
     */
    #createDebugSkipLoadingButton() {
        if (this.debugSkipLoadingButton || !getSetting('debugMode')) {
            return;
        }

        const buttonText = UIPool.text_element.get();
        buttonText.init({
            parent: this.titleScene,
            layer: 'ui',
            text: DEBUG_SKIP_LOADING_LABEL,
            font: 'Pretendard Variable',
            fontWeight: '700',
            size: Math.max(12, this.WH * 0.0145),
            color: getLoadingSkipButtonStyle().text,
            align: 'center'
        });

        const skipButtonStyle = getLoadingSkipButtonStyle();
        this.debugSkipLoadingButton = UIPool.button.get();
        this.debugSkipLoadingButton.init({
            parent: this.titleScene,
            onClick: this.#skipLoadingForDebug.bind(this),
            onHover: null,
            layer: 'ui',
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            idleColor: skipButtonStyle.idleColor,
            hoverColor: skipButtonStyle.hoverColor,
            center: [buttonText],
            alpha: 1,
            margin: Math.max(12, this.UIWW * 0.012),
            radius: Math.max(12, this.WH * 0.018)
        });
        this.debugSkipLoadingButton.idleColor = skipButtonStyle.idleColor;
        this.debugSkipLoadingButton.hoverColor = skipButtonStyle.hoverColor;
        this.#layoutDebugSkipLoadingButton();
    }

    /**
     * 디버그 전용 로딩 스킵 버튼의 배치를 현재 화면에 맞춥니다.
     * @private
     */
    #layoutDebugSkipLoadingButton() {
        if (!this.debugSkipLoadingButton) {
            return;
        }

        const buttonWidth = Math.max(120, this.UIWW * 0.12);
        const buttonHeight = Math.max(34, this.WH * 0.048);
        this.debugSkipLoadingButton.width = buttonWidth;
        this.debugSkipLoadingButton.height = buttonHeight;
        this.debugSkipLoadingButton.x = this.loadingTextX - (buttonWidth * 0.5);
        this.debugSkipLoadingButton.y = this.loadingTextBlockBottomY + Math.max(20, this.WH * 0.028);
        this.debugSkipLoadingButton.margin = Math.max(12, this.UIWW * 0.012);
        this.debugSkipLoadingButton.radius = Math.max(12, this.WH * 0.018);

        const buttonText = this.debugSkipLoadingButton.center[0];
        if (buttonText) {
            buttonText.size = Math.max(12, this.WH * 0.0145);
            buttonText.color = getLoadingSkipButtonStyle().text;
        }

        this.debugSkipLoadingButton.idleColor = getLoadingSkipButtonStyle().idleColor;
        this.debugSkipLoadingButton.hoverColor = getLoadingSkipButtonStyle().hoverColor;
    }

    /**
     * 디버그 스킵 버튼의 테마 색상을 최신값으로 적용합니다.
     * @private
     */
    #applyDebugSkipButtonStyle() {
        if (!this.debugSkipLoadingButton) {
            return;
        }

        const skipButtonStyle = getLoadingSkipButtonStyle();
        const buttonText = this.debugSkipLoadingButton.center?.[0];
        if (buttonText) {
            buttonText.color = skipButtonStyle.text;
        }
        this.debugSkipLoadingButton.idleColor = skipButtonStyle.idleColor;
        this.debugSkipLoadingButton.hoverColor = skipButtonStyle.hoverColor;
    }

    /**
     * 현재 프레임에서 디버그 스킵 버튼을 보여줄지 반환합니다.
     * @returns {boolean} 표시 여부입니다.
     * @private
     */
    #shouldShowDebugSkipButton() {
        return Boolean(this.debugSkipLoadingButton) && !this.loadingFinished && !this.titleLogo;
    }

    /**
     * 현재 상태에 맞는 메인 로딩 텍스트와 팁 문구를 그립니다.
     * @private
     */
    #drawLoadingText() {
        if (this.loadingTextAlpha <= 0 && this.loadingNoticeAlpha <= 0) {
            return;
        }

        const translateY = this.loadingTextExitDistance * this.loadingTextExitProgress;
        if (this.loadingTextAlpha > 0) {
            render('ui', {
                shape: 'text',
                text: getLangString('title_loading'),
                x: this.loadingTextX,
                y: this.loadingTextY - translateY,
                font: this.loadingTextFont,
                fill: getLoadingTextColor(),
                align: 'center',
                baseline: 'middle',
                alpha: this.loadingTextAlpha
            });
        }

        if (this.loadingNoticeAlpha <= 0) {
            return;
        }

        for (let i = 0; i < this.loadingNoticeLines.length; i++) {
            render('ui', {
                shape: 'text',
                text: this.loadingNoticeLines[i],
                x: this.loadingTextX,
                y: this.loadingNoticeStartY + (this.loadingNoticeLineHeight * i),
                font: this.loadingNoticeFont,
                fill: getLoadingTextColor(),
                align: 'center',
                baseline: 'middle',
                alpha: this.loadingNoticeAlpha
            });
        }
    }

    /**
     * 현재 화면 기준으로 텍스트 배치 정보를 다시 계산합니다.
     * @private
     */
    #recalculateLayout() {
        const textAnchor = this.centerCircle.getTextAnchor();
        const titleFontSize = this.#getTextPresetFontSize('H5');
        const noticeFontSize = this.#getTextPresetFontSize('H6');
        const noticeGap = Math.max(10, this.WH * 0.014);

        this.loadingTextX = textAnchor.x;
        this.loadingTextY = textAnchor.y;
        this.loadingTextFontSize = titleFontSize;
        this.loadingTextFont = this.#getTextPresetFont('H5');
        this.loadingNoticeFontSize = noticeFontSize;
        this.loadingNoticeFont = this.#getTextPresetFont('H6');
        this.loadingNoticeLines = this.#getLoadingNoticeLines();
        this.loadingNoticeLineHeight = Math.max(this.loadingNoticeFontSize * 1.45, this.WH * 0.018);
        this.loadingNoticeStartY = this.loadingTextY + (this.loadingTextFontSize * 0.5) + noticeGap + (this.loadingNoticeFontSize * 0.5);
        this.loadingTextBlockBottomY = this.loadingNoticeLines.length > 0
            ? this.loadingNoticeStartY + (this.loadingNoticeLineHeight * (this.loadingNoticeLines.length - 1)) + (this.loadingNoticeFontSize * 0.5)
            : this.loadingTextY + (this.loadingTextFontSize * 0.5);
        this.loadingTextExitDistance = Math.max(10, this.WH * TITLE_LOADING.TEXT_EXIT_DISTANCE_RATIO);
    }

    /**
     * 로딩 안내 문구를 줄 단위 배열로 반환합니다.
     * @returns {string[]} 렌더링할 안내 문구 줄 목록입니다.
     * @private
     */
    #getLoadingNoticeLines() {
        return String(getLangString('title_loading_notice') || '')
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
    }

    /**
     * 지정한 텍스트 프리셋의 폰트 크기를 픽셀 단위로 반환합니다.
     * @param {string} presetKey - 조회할 텍스트 프리셋 키입니다.
     * @returns {number} 프리셋에서 계산된 폰트 크기입니다.
     * @private
     */
    #getTextPresetFontSize(presetKey) {
        const fallback = TEXT_CONSTANTS.H6;
        const preset = TEXT_CONSTANTS[presetKey] || fallback;
        const fontData = preset.FONT || fallback.FONT;
        return Math.max(8, parseUIData(fontData.SIZE));
    }

    /**
     * 지정한 텍스트 프리셋을 캔버스용 폰트 문자열로 변환합니다.
     * @param {string} presetKey - 조회할 텍스트 프리셋 키입니다.
     * @returns {string} 캔버스 렌더링에 사용할 폰트 문자열입니다.
     * @private
     */
    #getTextPresetFont(presetKey) {
        const fallback = TEXT_CONSTANTS.H6;
        const preset = TEXT_CONSTANTS[presetKey] || fallback;
        const fontData = preset.FONT || fallback.FONT;
        const weight = fontData.WEIGHT || 400;
        const family = this.#normalizeFontFamily(fontData.FAMILY || 'Pretendard Variable, arial');
        return `${weight} ${this.#getTextPresetFontSize(presetKey)}px ${family}`;
    }

    /**
     * 캔버스 렌더링용 폰트 패밀리 문자열을 정규화합니다.
     * @param {string} fontFamily - 원본 폰트 패밀리 문자열입니다.
     * @returns {string} 따옴표가 보정된 폰트 패밀리 문자열입니다.
     * @private
     */
    #normalizeFontFamily(fontFamily) {
        let familyStr = fontFamily;
        if (!familyStr.includes('"') && !familyStr.includes("'")) {
            const parts = familyStr.split(',');
            familyStr = `"${parts[0].trim()}"${parts[1] ? `,${parts[1]}` : ''}`;
        }
        return familyStr;
    }
}
