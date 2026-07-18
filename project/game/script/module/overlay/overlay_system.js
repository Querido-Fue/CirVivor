import { getDisplaySystem } from 'display/display_system.js';
import { beginPerformanceSection, endPerformanceSection } from 'debug/debug_system.js';
import { getSetting } from 'save/save_system.js';
import { runtimeTool } from 'util/runtime_tool.js';
import { OverlaySession } from './_overlay_session.js';
import { DebugOverlay } from './_debug_overlay.js';
import { ExitOverlay } from './_exit_overlay.js';
import { ExternalLinkWarningOverlay } from './_external_link_warning_overlay.js';
import { DeckOverlay } from './title/_deck.js';
import { SettingsOverlay } from './title/_settings_overlay.js';
import { CreditsOverlay } from './title/_credits.js';
import { QuickStartOverlay } from './title/_quick_start.js';
import { RecordsOverlay } from './title/_records.js';
import { ResearchOverlay } from './title/_research.js';
import { AchievementsOverlay } from './title/_achievements.js';
import { MapSelectOverlay } from './title/_map_select_overlay.js';

const OVERLAY_MANAGER_KEYS = Object.freeze({
    DEBUG_PANEL: 'debugPanel',
    EXIT_CONFIRM: 'exitConfirm',
    EXTERNAL_LINK_WARNING: 'externalLinkWarning',
    TITLE_MENU: 'titleMenu'
});

const TITLE_OVERLAY_FACTORY_BY_MENU = Object.freeze({
    mapSelect: (titleScene) => new MapSelectOverlay(titleScene),
    deck: (titleScene) => new DeckOverlay(titleScene),
    setting: (titleScene) => new SettingsOverlay(titleScene),
    credits: (titleScene) => new CreditsOverlay(titleScene),
    quickStart: (titleScene) => new QuickStartOverlay(titleScene),
    records: (titleScene) => new RecordsOverlay(titleScene),
    research: (titleScene) => new ResearchOverlay(titleScene),
    achievements: (titleScene) => new AchievementsOverlay(titleScene)
});

function compareOverlayEntries(left, right) {
    if (left.order !== right.order) {
        return left.order - right.order;
    }
    return left.sequence - right.sequence;
}

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
        this.sortedEntries = [];
        this.sortedEntriesDirty = true;
    }

    /**
     * 매니저를 초기화합니다.
     */
    async init() {
        this.displaySystem = getDisplaySystem();
        runtimeTool()?.setExternalURLHandler?.(this.openExternalLinkWarningOverlay.bind(this));
    }

    /**
     * overlay를 업데이트합니다.
     */
    update() {
        const sortedEntries = this.#getSortedEntries();
        if (sortedEntries.length === 0) {
            return;
        }

        const startTime = beginPerformanceSection();
        for (const entry of sortedEntries) {
            entry.controller.update();
        }
        endPerformanceSection('overlay.manager.update', startTime);
    }

    /**
     * overlay를 그립니다.
     */
    draw() {
        const sortedEntries = this.#getSortedEntries();
        if (sortedEntries.length === 0) {
            return;
        }

        const startTime = beginPerformanceSection();
        for (const entry of sortedEntries) {
            entry.controller.draw();
        }
        endPerformanceSection('overlay.manager.draw', startTime);
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
     * 현재 프레임에 하위 WebGL 결과를 glass backdrop으로 샘플링할 overlay가 있는지 반환합니다.
     * @returns {boolean} 중간 WebGL flush가 필요하면 true입니다.
     */
    requiresBackdropComposite() {
        for (const entry of this.entries.values()) {
            if (entry.session?.requiresBackdropComposite?.()) {
                return true;
            }
        }
        return false;
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
     * 디버그 제어 overlay를 엽니다.
     * 같은 패널이 이미 열려 있으면 기존 overlay id를 반환합니다.
     * @param {object} debugSystem - 디버그 표시 상태를 소유한 시스템입니다.
     * @returns {string|null} 생성되거나 이미 열려 있던 overlay id입니다.
     */
    openDebugOverlay(debugSystem) {
        if (this.keyToIdMap.has(OVERLAY_MANAGER_KEYS.DEBUG_PANEL)) {
            return this.keyToIdMap.get(OVERLAY_MANAGER_KEYS.DEBUG_PANEL);
        }
        if (!debugSystem) {
            return null;
        }

        return this.openOverlay(new DebugOverlay(debugSystem), {
            key: OVERLAY_MANAGER_KEYS.DEBUG_PANEL
        });
    }

    /**
     * 현재 열린 디버그 제어 overlay를 닫습니다.
     */
    closeDebugOverlay() {
        this.closeByKey(OVERLAY_MANAGER_KEYS.DEBUG_PANEL);
    }

    /**
     * 종료 확인 overlay를 엽니다.
     * @returns {string|null} 생성된 overlay id입니다.
     */
    openExitOverlay() {
        if (this.keyToIdMap.has(OVERLAY_MANAGER_KEYS.EXIT_CONFIRM)) {
            return this.keyToIdMap.get(OVERLAY_MANAGER_KEYS.EXIT_CONFIRM);
        }

        return this.openOverlay(new ExitOverlay(), {
            key: OVERLAY_MANAGER_KEYS.EXIT_CONFIRM
        });
    }

    /**
     * 외부 링크 열기 확인 overlay를 엽니다.
     * @param {string} url - 열기 확인 대상 URL입니다.
     * @returns {string|null} 생성된 overlay id입니다.
     */
    openExternalLinkWarningOverlay(url) {
        const normalizedURL = typeof url === 'string' ? url.trim() : '';
        if (!normalizedURL) {
            return null;
        }

        if (this.keyToIdMap.has(OVERLAY_MANAGER_KEYS.EXTERNAL_LINK_WARNING)) {
            return this.keyToIdMap.get(OVERLAY_MANAGER_KEYS.EXTERNAL_LINK_WARNING);
        }

        return this.openOverlay(new ExternalLinkWarningOverlay(normalizedURL), {
            key: OVERLAY_MANAGER_KEYS.EXTERNAL_LINK_WARNING
        });
    }

    /**
     * 타이틀 메뉴 overlay를 엽니다.
     * @param {'mapSelect'|'deck'|'setting'|'credits'|'quickStart'|'records'|'research'|'achievements'} menu - 열 메뉴 이름입니다.
     * @param {object} titleScene - 타이틀 씬 인스턴스입니다.
     * @returns {string|null} 생성된 overlay id입니다.
     */
    openTitleOverlay(menu, titleScene) {
        if (this.keyToIdMap.has(OVERLAY_MANAGER_KEYS.TITLE_MENU)) {
            return this.keyToIdMap.get(OVERLAY_MANAGER_KEYS.TITLE_MENU);
        }

        const controller = this.#createTitleOverlay(menu, titleScene);
        if (!controller) {
            return null;
        }

        return this.openOverlay(controller, {
            key: OVERLAY_MANAGER_KEYS.TITLE_MENU
        });
    }

    /**
     * 타이틀 메뉴 overlay를 닫습니다.
     */
    closeTitleOverlay() {
        this.closeByKey(OVERLAY_MANAGER_KEYS.TITLE_MENU);
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
        this.sortedEntriesDirty = true;
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
        this.sortedEntriesDirty = true;

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
        const createOverlay = TITLE_OVERLAY_FACTORY_BY_MENU[menu];
        return typeof createOverlay === 'function' ? createOverlay(titleScene) : null;
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
        if (!this.sortedEntriesDirty) {
            return this.sortedEntries;
        }

        this.sortedEntries.length = 0;
        for (const entry of this.entries.values()) {
            this.sortedEntries.push(entry);
        }
        this.sortedEntries.sort(compareOverlayEntries);
        this.sortedEntriesDirty = false;
        return this.sortedEntries;
    }
}
