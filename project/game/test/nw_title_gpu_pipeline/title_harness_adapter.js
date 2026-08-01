import {
    getCanvasOffsetX,
    getCanvasOffsetY,
    getScaleRatio
} from 'display/display_system.js';

const EXTERNAL_LINK_URL = 'https://example.com/cirvivor-title-gpu-harness';

/**
 * 현재 production title 상태를 public object graph에서 읽습니다.
 * @param {object} game - production App입니다.
 * @returns {object} title 상태입니다.
 */
export function getTitleRuntimeState(game) {
    const sceneSystem = game?.systemHandler?.sceneSystem || null;
    const scene = sceneSystem?.scene || null;
    const presentation = scene?.presentation || null;
    const content = presentation?.content || null;
    const titleMenu = content?.titleMenu || null;
    return {
        sceneSystem,
        scene,
        presentation,
        content,
        titleMenu,
        sceneState: sceneSystem?.sceneState || null,
        introStarted: content?.introStarted === true,
        handoffReady: content?.isTitleSceneHandoffReady?.() === true,
        transitionProgress: Number.isFinite(content?.sceneTransitionProgress)
            ? content.sceneTransitionProgress
            : null,
        menuReady: sceneSystem?.sceneState === 'title'
            && titleMenu?.pointerEnabled === true
    };
}

/**
 * overlay ID에 해당하는 manager entry를 반환합니다.
 * @param {object} manager - OverlayManager입니다.
 * @param {string|null} overlayId - overlay ID입니다.
 * @returns {object|null} entry입니다.
 */
export function getOverlayEntry(manager, overlayId) {
    return overlayId ? manager?.entries?.get(overlayId) || null : null;
}

/**
 * 실제 ExternalLinkWarningOverlay API를 호출합니다.
 * @param {object} game - production App입니다.
 * @returns {object} 생성되거나 재사용된 entry입니다.
 */
export function openExternalLinkWarning(game) {
    const manager = game?.systemHandler?.overlayManager;
    const overlayId = manager?.openExternalLinkWarningOverlay?.(EXTERNAL_LINK_URL);
    const entry = getOverlayEntry(manager, overlayId);
    if (!entry) {
        throw new Error('ExternalLinkWarningOverlay를 열지 못했습니다.');
    }
    return entry;
}

/**
 * 반복 transition에서 동일 production controller/session을 재사용하도록 자동 release만 가로챕니다.
 * @param {object} entry - overlay entry입니다.
 * @returns {object} 같은 entry입니다.
 */
export function pinOverlayForCycles(entry) {
    if (!entry || entry.__titleGpuPinned === true) {
        return entry;
    }
    entry.__titleGpuPinned = true;
    entry.__titleGpuCloseGeneration = 0;
    entry.controller.setCloseHandler(() => {
        entry.__titleGpuCloseGeneration += 1;
    });
    return entry;
}

/**
 * pinned overlay를 manager와 display surface에서 명시적으로 회수합니다.
 * @param {object} game - production App입니다.
 * @param {object|null} entry - 회수할 entry입니다.
 * @returns {void}
 */
export function releasePinnedOverlay(game, entry) {
    if (!entry) {
        return;
    }
    const manager = game?.systemHandler?.overlayManager;
    entry.controller?.destroy?.();
    entry.session?.release?.();
    manager?.entries?.delete(entry.id);
    if (entry.key && manager?.keyToIdMap?.get(entry.key) === entry.id) {
        manager.keyToIdMap.delete(entry.key);
    }
    if (manager) {
        manager.sortedEntriesDirty = true;
    }
}

/**
 * overlay의 모든 panel backdrop blur 값을 갱신합니다.
 * @param {object} entry - overlay entry입니다.
 * @param {number} sigma - 적용할 sigma/radius입니다.
 * @returns {number} 적용값입니다.
 */
export function setPanelBlurSigma(entry, sigma) {
    const value = Math.max(0, Number.isFinite(sigma) ? sigma : 0);
    for (const panel of entry?.controller?.panelRegions || []) {
        panel.blur = value;
    }
    entry?.session?.invalidateBlur?.();
    return value;
}

/**
 * 실제 title scene API로 SettingsOverlay를 엽니다.
 * @param {object} game - production App입니다.
 * @returns {object} settings entry입니다.
 */
export function openSettingsOverlay(game) {
    const state = getTitleRuntimeState(game);
    const overlayId = state.scene?.openTitleOverlay?.('setting');
    const manager = game?.systemHandler?.overlayManager;
    const entry = getOverlayEntry(manager, overlayId);
    if (!entry) {
        throw new Error('SettingsOverlay를 열지 못했습니다.');
    }
    return entry;
}

/**
 * game logical 좌표를 DOM client 좌표로 변환합니다.
 * @param {number} x - logical X입니다.
 * @param {number} y - logical Y입니다.
 * @returns {{x:number,y:number}} client 좌표입니다.
 */
function toClientPoint(x, y) {
    const scale = Number(getScaleRatio()) || 1;
    return {
        x: (x / scale) + (Number(getCanvasOffsetX()) || 0),
        y: (y / scale) + (Number(getCanvasOffsetY()) || 0)
    };
}

/**
 * production mouse handler가 소비할 DOM mouse event를 보냅니다.
 * @param {string} type - mouse event type입니다.
 * @param {{x:number,y:number}} point - client 좌표입니다.
 * @returns {void}
 */
function dispatchMouse(type, point) {
    window.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: type === 'mousedown' ? 1 : 0,
        clientX: point.x,
        clientY: point.y
    }));
}

/**
 * SettingsOverlay의 실제 windowMode dropdown을 production 입력 경로로 엽니다.
 * @param {object} entry - SettingsOverlay entry입니다.
 * @param {(metadata?:object) => Promise<object>} nextFrame - 하네스 frame 함수입니다.
 * @returns {Promise<object>} 열린 DropdownElement입니다.
 */
export async function openWindowModeDropdownThroughInput(entry, nextFrame) {
    const dropdown = entry?.controller?.settingComponents?.control_windowMode;
    if (!dropdown) {
        throw new Error('SettingsOverlay control_windowMode dropdown을 찾지 못했습니다.');
    }
    const point = toClientPoint(
        dropdown.x + (dropdown.width * 0.5),
        dropdown.y + (dropdown.height * 0.5)
    );
    dispatchMouse('mousemove', point);
    await nextFrame({ collect: false, phase: 'dropdown-move' });
    dispatchMouse('mousedown', point);
    await nextFrame({ collect: false, phase: 'dropdown-down' });
    dispatchMouse('mouseup', point);
    await nextFrame({ collect: false, phase: 'dropdown-up' });
    await nextFrame({ collect: false, phase: 'dropdown-open' });
    if (!dropdown.isOpen) {
        throw new Error('windowMode dropdown이 production 입력을 통해 열리지 않았습니다.');
    }
    return dropdown;
}

/**
 * overlay/session/surface 상태를 직렬화합니다.
 * @param {object} game - production App입니다.
 * @returns {object} overlay stack입니다.
 */
export function snapshotOverlayStack(game) {
    const manager = game?.systemHandler?.overlayManager;
    const entries = [];
    for (const entry of manager?.entries?.values?.() || []) {
        entries.push({
            id: entry.id,
            key: entry.key,
            order: entry.order,
            controller: entry.controller?.constructor?.name || null,
            alpha: entry.controller?.alpha ?? null,
            dimAlpha: entry.controller?.dimAlpha ?? null,
            contentScale: entry.controller?.contentScale ?? null,
            contentBlur: entry.controller?.contentBlur ?? null,
            panelBlur: (entry.controller?.panelRegions || []).map((panel) => panel.blur),
            layers: entry.session?.getLayerIds?.() || null
        });
    }
    entries.sort((left, right) => (left.order - right.order) || left.id.localeCompare(right.id));
    return entries;
}
