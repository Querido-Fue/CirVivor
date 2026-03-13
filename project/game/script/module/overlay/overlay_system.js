import { getDisplaySystem } from 'display/display_system.js';
import { getSetting } from 'save/save_system.js';
import { OverlaySession } from './_overlay_session.js';
import { ExitOverlay } from './_exit_overlay.js';
import { DeckOverlay } from './title/_deck.js';
import { SettingsOverlay } from './title/_settings.js';
import { CreditsOverlay } from './title/_credits.js';
import { QuickStartOverlay } from './title/_quick_start.js';
import { RecordsOverlay } from './title/_records.js';
import { ResearchOverlay } from './title/_research.js';
import { AchievementsOverlay } from './title/_achievements.js';

/**
 * @class OverlayManager
 * @description 동적 surface 기반 overlay session을 생성하고 수명주기를 관리합니다.
 */
export class OverlayManager {
    constructor() {
        this.displaySystem = null;
        this.entries = new Map();
        this.keyToIdMap = new Map();
        this.sequence = 0;
    }

    /**
     * 매니저를 초기화합니다.
     */
    async init() {
        this.displaySystem = getDisplaySystem();
    }

    /**
     * overlay를 업데이트합니다.
     */
    update() {
        for (const entry of this.#getSortedEntries()) {
            entry.controller.update();
        }
    }

    /**
     * overlay를 그립니다.
     */
    draw() {
        for (const entry of this.#getSortedEntries()) {
            entry.controller.draw();
        }
    }

    /**
     * overlay 레이아웃을 다시 계산합니다.
     */
    resize() {
        for (const entry of this.entries.values()) {
            entry.controller.resize();
        }
        this.#invalidateAboveOrder(-1);
    }

    /**
     * 활성 overlay들에 런타임 설정 변경을 전달합니다.
     * @param {object} [changedSettings={}] - 변경된 설정 키와 값입니다.
     */
    applyRuntimeSettings(changedSettings = {}) {
        for (const entry of this.entries.values()) {
            if (typeof entry.controller.applyRuntimeSettings === 'function') {
                entry.controller.applyRuntimeSettings(changedSettings);
            }
        }
        this.#invalidateAboveOrder(-1);
    }

    /**
     * 활성 overlay가 하나라도 있는지 반환합니다.
     * @returns {boolean} 활성 overlay 존재 여부입니다.
     */
    hasAnyOverlay() {
        return this.entries.size > 0;
    }

    /**
     * key 기반 overlay를 닫습니다.
     * @param {string} key - 닫을 overlay key입니다.
     */
    closeByKey(key) {
        const overlayId = this.keyToIdMap.get(key);
        if (!overlayId) {
            return;
        }

        this.closeOverlay(overlayId);
    }

    /**
     * id 기반 overlay를 닫습니다.
     * @param {string} overlayId - 닫을 overlay id입니다.
     */
    closeOverlay(overlayId) {
        const entry = this.entries.get(overlayId);
        if (!entry) {
            return;
        }

        entry.controller.close();
    }

    /**
     * 종료 확인 overlay를 엽니다.
     * @returns {string|null} 생성된 overlay id입니다.
     */
    openExitOverlay() {
        if (this.keyToIdMap.has('exitConfirm')) {
            return this.keyToIdMap.get('exitConfirm');
        }

        return this.openOverlay(new ExitOverlay(), { key: 'exitConfirm' });
    }

    /**
     * 타이틀 메뉴 overlay를 엽니다.
     * @param {'deck'|'setting'|'credits'|'quickStart'|'records'|'research'|'achievements'} menu - 열 메뉴 이름입니다.
     * @param {object} titleScene - 타이틀 씬 인스턴스입니다.
     * @returns {string|null} 생성된 overlay id입니다.
     */
    openTitleOverlay(menu, titleScene) {
        if (this.keyToIdMap.has('titleMenu')) {
            return this.keyToIdMap.get('titleMenu');
        }

        const controller = this.#createTitleOverlay(menu, titleScene);
        if (!controller) {
            return null;
        }

        return this.openOverlay(controller, { key: 'titleMenu' });
    }

    /**
     * 타이틀 메뉴 overlay를 닫습니다.
     */
    closeTitleOverlay() {
        this.closeByKey('titleMenu');
    }

    /**
     * 일반 overlay를 엽니다.
     * @param {import('./_base_overlay.js').BaseOverlay} controller - 열 overlay 컨트롤러입니다.
     * @param {{key?: string}} [options={}] - 등록 옵션입니다.
     * @returns {string|null} 생성된 overlay id입니다.
     */
    openOverlay(controller, options = {}) {
        if (!controller) {
            return null;
        }

        if (!this.displaySystem) {
            this.displaySystem = getDisplaySystem();
        }
        if (!this.displaySystem) {
            return null;
        }

        const overlayId = `overlay:${++this.sequence}`;
        const session = new OverlaySession({
            ...controller.getSessionOptions(),
            displaySystem: this.displaySystem,
            disableTransparency: getSetting('disableTransparency'),
            orderSequence: this.sequence
        });

        controller.setCloseHandler(() => {
            this.#releaseOverlay(overlayId);
        });
        controller.attach(session);

        const entry = {
            id: overlayId,
            key: options.key || null,
            order: session.layer,
            sequence: this.sequence,
            controller,
            session
        };

        this.entries.set(overlayId, entry);
        if (entry.key) {
            this.keyToIdMap.set(entry.key, overlayId);
        }

        this.#invalidateAboveOrder(session.sortOrderBase);
        return overlayId;
    }

    /**
     * @private
     * overlay를 내부 맵에서 제거하고 surface를 회수합니다.
     * @param {string} overlayId - 제거할 overlay id입니다.
     */
    #releaseOverlay(overlayId) {
        const entry = this.entries.get(overlayId);
        if (!entry) {
            return;
        }

        const releasedOrder = entry.session.sortOrderBase;
        entry.controller.destroy();
        entry.session.release();
        this.entries.delete(overlayId);

        if (entry.key) {
            this.keyToIdMap.delete(entry.key);
        }

        this.#invalidateAboveOrder(releasedOrder);
    }

    /**
     * @private
     * 타이틀 메뉴 이름에 맞는 overlay를 생성합니다.
     * @param {string} menu - 열 메뉴 이름입니다.
     * @param {object} titleScene - 타이틀 씬 인스턴스입니다.
     * @returns {object|null} 생성된 overlay 컨트롤러입니다.
     */
    #createTitleOverlay(menu, titleScene) {
        switch (menu) {
            case 'deck':
                return new DeckOverlay(titleScene);
            case 'setting':
                return new SettingsOverlay(titleScene);
            case 'credits':
                return new CreditsOverlay(titleScene);
            case 'quickStart':
                return new QuickStartOverlay(titleScene);
            case 'records':
                return new RecordsOverlay(titleScene);
            case 'research':
                return new ResearchOverlay(titleScene);
            case 'achievements':
                return new AchievementsOverlay(titleScene);
            default:
                return null;
        }
    }

    /**
     * @private
     * 특정 정렬 순서 위쪽 overlay의 blur 캐시를 무효화합니다.
     * @param {number} order - 기준 정렬 순서입니다.
     */
    #invalidateAboveOrder(order) {
        for (const entry of this.entries.values()) {
            if (entry.session.sortOrderBase > order) {
                entry.session.invalidateBlur();
            }
        }
    }

    /**
     * @private
     * 표시 순서대로 정렬된 entry 목록을 반환합니다.
     * @returns {Array<{order: number, sequence: number, controller: object}>} 정렬된 entry 목록입니다.
     */
    #getSortedEntries() {
        return Array.from(this.entries.values()).sort((left, right) => {
            if (left.order !== right.order) {
                return left.order - right.order;
            }
            return left.sequence - right.sequence;
        });
    }
}
