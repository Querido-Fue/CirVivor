import { ExitOverlay } from './_exit_overlay.js';
import { CollectionOverlay } from './title/_collection.js';
import { SettingsOverlay } from './title/_settings.js';
import { CreditsOverlay } from './title/_credits.js';
import { getData } from 'data/data_handler.js';

const DEFAULT_OVERLAY_ANIMATION_PRESET = getData('DEFAULT_OVERLAY_ANIMATION_PRESET');
const OVERLAY_ANIMATION_PRESETS = getData('OVERLAY_ANIMATION_PRESETS');

let overlaySystemInstance = null;

/**
 * @class OverlaySystem
 * @description 게임 내 오버레이(팝업)를 관리하는 시스템입니다.
 * 일반 메뉴 오버레이와 종료 확인 팝업을 독립적으로 관리합니다.
 */
export class OverlaySystem {
    constructor() {
        overlaySystemInstance = this;
        this.activeOverlay = null;
        this.exitConfirmOverlay = null;
        this.animationPreset = DEFAULT_OVERLAY_ANIMATION_PRESET;
    }

    async init() {
        // 추가 초기화가 필요하다면 여기에 작성합니다.
    }

    /**
     * 활성화된 오버레이를 업데이트합니다.
     */
    update() {
        if (this.activeOverlay) {
            this.activeOverlay.update();
        }
        if (this.exitConfirmOverlay) {
            this.exitConfirmOverlay.update();
        }
    }

    /**
     * 활성화된 오버레이를 화면에 그립니다.
     */
    draw() {
        if (this.activeOverlay) {
            this.activeOverlay.draw();
        }
        if (this.exitConfirmOverlay) {
            this.exitConfirmOverlay.draw();
        }
    }

    /**
         * 화면 크기 변동 시, 활성화된 오버레이의 레이아웃을 다시 계산하도록 지시합니다.
         */
    resize() {
        if (this.activeOverlay && typeof this.activeOverlay.resize === 'function') {
            this.activeOverlay.resize();
        }
        if (this.exitConfirmOverlay && typeof this.exitConfirmOverlay.resize === 'function') {
            this.exitConfirmOverlay.resize();
        }
    }

    /**
     * 종료 확인 오버레이를 표시합니다. 이미 열려 있으면 업데이트하지 않습니다.
     */
    showExitConfirmation() {
        if (this.exitConfirmOverlay) return;

        this.exitConfirmOverlay = new ExitOverlay();
        this.exitConfirmOverlay.setAnimationPreset(this.animationPreset);
        this.exitConfirmOverlay.onCloseComplete = () => {
            this.exitConfirmOverlay = null;
        };
        this.exitConfirmOverlay.open();
    }

    /**
     * 메뉴 이름에 해당하는 오버레이를 엽니다.
     * @param {string} menu - 메뉴 이름 ('collection', 'setting', 'credits')
     * @param {object} titleScene - 타이틀 씨닉 확장용 레퍼런스
     */
    menuOpen(menu, titleScene) {
        if (this.activeOverlay) return;
        switch (menu) {
            case "collection":
                this.activeOverlay = new CollectionOverlay(titleScene);
                break;
            case "setting":
                this.activeOverlay = new SettingsOverlay(titleScene);
                break;
            case "credits":
                this.activeOverlay = new CreditsOverlay(titleScene);
                break;
            default:
                console.warn(`메뉴 열림 처리 중 오류가 발생했습니다. ${menu} 메뉴가 없습니다.`);
                return;
        }
        this.activeOverlay.setAnimationPreset(this.animationPreset);
        this.activeOverlay.onCloseComplete = () => {
            this.activeOverlay = null;
        };
        this.activeOverlay.open();
    }

    /**
     * 현재 활성화된 오버레이를 닫습니다.
     */
    menuClose() {
        if (!this.activeOverlay) return;
        this.activeOverlay.close();
    }

    /**
     * 현재 활성 오버레이 존재 여부를 반환합니다.
     * @returns {boolean} 오버레이 활성 여부
     */
    hasOverlay() {
        return this.activeOverlay !== null;
    }

    /**
         * 전역 오버레이 오프닝/클로징 애니메이션 프리셋을 설정하고, 현재 활성화된 오버레이에 반영합니다.
         * @param {string} presetName 애니메이션 프리셋 식별자
         */
    setAnimationPreset(presetName) {
        this.animationPreset = presetName || DEFAULT_OVERLAY_ANIMATION_PRESET;
        if (this.activeOverlay) {
            this.activeOverlay.setAnimationPreset(this.animationPreset);
        }
        if (this.exitConfirmOverlay) {
            this.exitConfirmOverlay.setAnimationPreset(this.animationPreset);
        }
    }
}

/**
 * 종료 확인 오버레이 팝업을 표시합니다.
 */
export const showExitConfirmation = () => {
    if (overlaySystemInstance) {
        overlaySystemInstance.showExitConfirmation();
    }
}

/**
 * 주어진 메뉴 이름에 해당하는 타이틀 오버레이를 엽니다.
 * @param {string} menu - 메뉴 이름 ('collection', 'setting', 'credits')
 * @param {object} titleScene - 타이틀 씬 참조
 */
export const titleMenuOpen = (menu, titleScene) => {
    if (overlaySystemInstance) {
        overlaySystemInstance.menuOpen(menu, titleScene);
    }
}

/**
 * 현재 열려있는 타이틀 오버레이를 닫습니다.
 */
export const titleMenuClose = () => {
    if (overlaySystemInstance) {
        overlaySystemInstance.menuClose();
    }
}

/**
 * 현재 활성화된 오버레이가 있는지 여부를 확인합니다.
 * @returns {boolean} 오버레이 활성화 여부
 */
export const hasMenuOverlay = () => {
    return overlaySystemInstance ? overlaySystemInstance.hasOverlay() : false;
}

/**
 * 오버레이 애니메이션 프리셋을 설정합니다.
 * 다음에 열리는 오버레이와 현재 열린 오버레이에 즉시 적용됩니다.
 * @param {string} presetName - 프리셋 이름 (예: uiAnimation)
 */
export const setOverlayAnimationPreset = (presetName) => {
    if (overlaySystemInstance) {
        overlaySystemInstance.setAnimationPreset(presetName);
    }
}

/**
 * 사용 가능한 오버레이 애니메이션 프리셋 이름 목록을 반환합니다.
 * @returns {string[]} 프리셋 이름 배열
 */
export const getOverlayAnimationPresetNames = () => Object.keys(OVERLAY_ANIMATION_PRESETS);
