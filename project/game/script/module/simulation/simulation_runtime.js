const DEFAULT_MOUSE_BUTTON_STATE = Object.freeze(['idle']);
const DEFAULT_FOCUS_LIST = Object.freeze(['ui', 'object']);

let simulationRuntimeInstance = null;

/**
 * 숫자 값을 안전하게 정규화합니다.
 * @param {number} value
 * @param {number} [fallback=0]
 * @returns {number}
 */
function normalizeNumber(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
}

/**
 * 좌표 객체를 복제합니다.
 * @param {{x?: number, y?: number}|null|undefined} point
 * @returns {{x: number, y: number}}
 */
function clonePoint(point) {
    return {
        x: normalizeNumber(point?.x, 0),
        y: normalizeNumber(point?.y, 0)
    };
}

/**
 * 버튼 상태 배열을 복제합니다.
 * @param {string[]|null|undefined} state
 * @returns {string[]}
 */
function cloneMouseButtonState(state) {
    return Array.isArray(state) ? [...state] : [...DEFAULT_MOUSE_BUTTON_STATE];
}

/**
 * 입력 스냅샷을 정규화합니다.
 * @param {object} [input={}]
 * @returns {{mousePos: {x: number, y: number}, mouseButtons: {left: string[], right: string[], middle: string[]}, focusList: string[], keys: Record<string, boolean>}}
 */
function cloneInputSnapshot(input = {}) {
    const nextKeys = {};
    if (input.keys && typeof input.keys === 'object') {
        for (const [key, value] of Object.entries(input.keys)) {
            nextKeys[key] = value === true;
        }
    }

    return {
        mousePos: clonePoint(input.mousePos),
        mouseButtons: {
            left: cloneMouseButtonState(input.mouseButtons?.left),
            right: cloneMouseButtonState(input.mouseButtons?.right),
            middle: cloneMouseButtonState(input.mouseButtons?.middle)
        },
        focusList: Array.isArray(input.focusList) ? [...input.focusList] : [...DEFAULT_FOCUS_LIST],
        keys: nextKeys
    };
}

/**
 * 뷰포트 스냅샷을 정규화합니다.
 * @param {object} [viewport={}]
 * @returns {{ww: number, wh: number, objectWH: number, objectOffsetY: number, uiww: number, uiOffsetX: number}}
 */
function cloneViewportSnapshot(viewport = {}) {
    return {
        ww: normalizeNumber(viewport.ww, 0),
        wh: normalizeNumber(viewport.wh, 0),
        objectWH: normalizeNumber(viewport.objectWH, 0),
        objectOffsetY: normalizeNumber(viewport.objectOffsetY, 0),
        uiww: normalizeNumber(viewport.uiww, 0),
        uiOffsetX: normalizeNumber(viewport.uiOffsetX, 0)
    };
}

/**
 * 설정 스냅샷을 복제합니다.
 * @param {object} [settings={}]
 * @returns {Record<string, any>}
 */
function cloneSettingsSnapshot(settings = {}) {
    if (!settings || typeof settings !== 'object') {
        return {};
    }

    return { ...settings };
}

/**
 * @class SimulationRuntime
 * @description 시뮬레이션 경로가 메인 스레드 전용 싱글톤을 직접 읽지 않도록
 * 뷰포트, 입력, 설정 스냅샷을 보관하는 런타임 저장소입니다.
 */
export class SimulationRuntime {
    constructor() {
        simulationRuntimeInstance = this;
        this.viewport = cloneViewportSnapshot();
        this.input = cloneInputSnapshot();
        this.settings = cloneSettingsSnapshot();
    }

    /**
     * 메인 루프에서 전달한 최신 스냅샷으로 런타임을 동기화합니다.
     * @param {{viewport?: object, input?: object, settings?: object}} [snapshot={}]
     */
    sync(snapshot = {}) {
        if (snapshot.viewport !== undefined) {
            this.viewport = cloneViewportSnapshot(snapshot.viewport);
        }
        if (snapshot.input !== undefined) {
            this.input = cloneInputSnapshot(snapshot.input);
        }
        if (snapshot.settings !== undefined) {
            this.settings = cloneSettingsSnapshot(snapshot.settings);
        }
    }

    /**
     * 현재 뷰포트 스냅샷을 복제해 반환합니다.
     * @returns {{ww: number, wh: number, objectWH: number, objectOffsetY: number, uiww: number, uiOffsetX: number}}
     */
    getViewportSnapshot() {
        return cloneViewportSnapshot(this.viewport);
    }

    /**
     * 현재 입력 스냅샷을 복제해 반환합니다.
     * @returns {{mousePos: {x: number, y: number}, mouseButtons: {left: string[], right: string[], middle: string[]}, focusList: string[], keys: Record<string, boolean>}}
     */
    getInputSnapshot() {
        return cloneInputSnapshot(this.input);
    }

    /**
     * 현재 설정 스냅샷을 복제해 반환합니다.
     * @returns {Record<string, any>}
     */
    getSettingsSnapshot() {
        return cloneSettingsSnapshot(this.settings);
    }

    /**
     * 현재 런타임 전체 스냅샷을 복제해 반환합니다.
     * @returns {{viewport: {ww: number, wh: number, objectWH: number, objectOffsetY: number, uiww: number, uiOffsetX: number}, input: {mousePos: {x: number, y: number}, mouseButtons: {left: string[], right: string[], middle: string[]}, focusList: string[], keys: Record<string, boolean>}, settings: Record<string, any>}}
     */
    createSnapshot() {
        return {
            viewport: this.getViewportSnapshot(),
            input: this.getInputSnapshot(),
            settings: this.getSettingsSnapshot()
        };
    }
}

/**
 * 시뮬레이션 런타임 싱글톤을 생성 또는 반환합니다.
 * @returns {SimulationRuntime}
 */
export function ensureSimulationRuntime() {
    if (!simulationRuntimeInstance) {
        new SimulationRuntime();
    }
    return simulationRuntimeInstance;
}

/**
 * 최신 스냅샷으로 시뮬레이션 런타임을 동기화합니다.
 * @param {{viewport?: object, input?: object, settings?: object}} [snapshot={}]
 * @returns {SimulationRuntime}
 */
export function syncSimulationRuntime(snapshot = {}) {
    const runtime = ensureSimulationRuntime();
    runtime.sync(snapshot);
    return runtime;
}

/**
 * 현재 시뮬레이션 런타임 인스턴스를 반환합니다.
 * @returns {SimulationRuntime|null}
 */
export function getSimulationRuntime() {
    return simulationRuntimeInstance;
}

/**
 * 현재 시뮬레이션 런타임 전체 스냅샷을 반환합니다.
 * @returns {{viewport: {ww: number, wh: number, objectWH: number, objectOffsetY: number, uiww: number, uiOffsetX: number}, input: {mousePos: {x: number, y: number}, mouseButtons: {left: string[], right: string[], middle: string[]}, focusList: string[], keys: Record<string, boolean>}, settings: Record<string, any>}}
 */
export function getSimulationRuntimeSnapshot() {
    return ensureSimulationRuntime().createSnapshot();
}

/**
 * 시뮬레이션 기준 화면 너비를 반환합니다.
 * @returns {number}
 */
export const getSimulationWW = () => simulationRuntimeInstance?.viewport?.ww ?? 0;

/**
 * 시뮬레이션 기준 화면 높이를 반환합니다.
 * @returns {number}
 */
export const getSimulationWH = () => simulationRuntimeInstance?.viewport?.wh ?? 0;

/**
 * 시뮬레이션 기준 오브젝트 높이를 반환합니다.
 * @returns {number}
 */
export const getSimulationObjectWH = () => simulationRuntimeInstance?.viewport?.objectWH ?? 0;

/**
 * 시뮬레이션 기준 오브젝트 Y 오프셋을 반환합니다.
 * @returns {number}
 */
export const getSimulationObjectOffsetY = () => simulationRuntimeInstance?.viewport?.objectOffsetY ?? 0;

/**
 * 시뮬레이션 기준 UI 너비를 반환합니다.
 * @returns {number}
 */
export const getSimulationUIWW = () => simulationRuntimeInstance?.viewport?.uiww ?? 0;

/**
 * 시뮬레이션 기준 UI X 오프셋을 반환합니다.
 * @returns {number}
 */
export const getSimulationUIOffsetX = () => simulationRuntimeInstance?.viewport?.uiOffsetX ?? 0;

/**
 * 시뮬레이션 입력 스냅샷에서 마우스 값을 조회합니다.
 * @param {'pos'|'x'|'y'|'left'|'right'|'middle'} key
 * @returns {any}
 */
export function getSimulationMouseInput(key) {
    const input = simulationRuntimeInstance?.input;
    if (!input) {
        if (key === 'pos') {
            return { x: 0, y: 0 };
        }
        if (key === 'x' || key === 'y') {
            return 0;
        }
        return [...DEFAULT_MOUSE_BUTTON_STATE];
    }

    switch (key) {
        case 'pos':
            return clonePoint(input.mousePos);
        case 'x':
            return input.mousePos.x;
        case 'y':
            return input.mousePos.y;
        case 'left':
            return cloneMouseButtonState(input.mouseButtons.left);
        case 'right':
            return cloneMouseButtonState(input.mouseButtons.right);
        case 'middle':
            return cloneMouseButtonState(input.mouseButtons.middle);
        default:
            return null;
    }
}

/**
 * 시뮬레이션 입력 스냅샷에서 특정 버튼 상태를 검사합니다.
 * @param {'left'|'right'|'middle'} button
 * @param {'inactive'|'idle'|'click'|'clicking'|'clicked'} state
 * @returns {boolean}
 */
export function hasSimulationMouseState(button, state) {
    const states = simulationRuntimeInstance?.input?.mouseButtons?.[button];
    if (!Array.isArray(states)) {
        return false;
    }
    return states.includes(state);
}

/**
 * 시뮬레이션 입력 스냅샷에서 누름 계열 상태를 검사합니다.
 * @param {'left'|'right'|'middle'} button
 * @returns {boolean}
 */
export function isSimulationMousePressing(button) {
    return hasSimulationMouseState(button, 'click') || hasSimulationMouseState(button, 'clicking');
}

/**
 * 현재 시뮬레이션 마우스 포커스 목록을 반환합니다.
 * @returns {string[]}
 */
export function getSimulationMouseFocus() {
    const focusList = simulationRuntimeInstance?.input?.focusList;
    return Array.isArray(focusList) ? [...focusList] : [...DEFAULT_FOCUS_LIST];
}

/**
 * 현재 시뮬레이션 설정 값을 반환합니다.
 * @param {string} key
 * @param {any} [fallback=undefined]
 * @returns {any}
 */
export function getSimulationSetting(key, fallback = undefined) {
    if (!simulationRuntimeInstance || typeof key !== 'string' || key.length === 0) {
        return fallback;
    }
    if (Object.prototype.hasOwnProperty.call(simulationRuntimeInstance.settings, key)) {
        return simulationRuntimeInstance.settings[key];
    }
    return fallback;
}
