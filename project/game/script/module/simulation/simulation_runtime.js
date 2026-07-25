import { resolveFiniteNumber } from 'util/number_util.js';

const DEFAULT_MOUSE_BUTTON_STATE = Object.freeze(['idle']);
const DEFAULT_FOCUS_LIST = Object.freeze(['ui', 'object']);
const DEFAULT_MOUSE_POSITION = Object.freeze({
    x: 0,
    y: 0
});
const DEFAULT_WHEEL_TOTALS = Object.freeze({
    x: 0,
    y: 0
});
const DEFAULT_VIEWPORT = Object.freeze({
    ww: 0,
    wh: 0,
    objectWH: 0,
    objectOffsetY: 0,
    uiww: 0,
    uiOffsetX: 0
});
const EMPTY_SIMULATION_RECORD = Object.freeze({});

let simulationRuntimeInstance = null;

/**
 * 좌표 객체를 복제합니다.
 * @param {{x?: number, y?: number}|null|undefined} point
 * @returns {{x: number, y: number}}
 */
function clonePoint(point) {
    return {
        x: resolveFiniteNumber(point?.x, DEFAULT_MOUSE_POSITION.x),
        y: resolveFiniteNumber(point?.y, DEFAULT_MOUSE_POSITION.y)
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
 * boolean record를 own enumerable key만 사용해 복제합니다.
 * @param {object|null|undefined} source - 복제할 입력 record입니다.
 * @returns {Record<string, boolean>} 새 boolean record입니다.
 */
function cloneBooleanRecord(source) {
    const result = {};
    if (source && typeof source === 'object') {
        for (const [key, value] of Object.entries(source)) {
            result[key] = value === true;
        }
    }
    return result;
}

/**
 * 입력 스냅샷을 정규화합니다.
 * @param {object} [input={}]
 * @returns {{mousePos: {x: number, y: number}, wheel:{x:number,y:number}, mouseButtons: {left: string[], right: string[], middle: string[]}, focusList: string[], actionStates:Record<string,boolean>, keys: Record<string, boolean>}}
 */
function cloneInputSnapshot(input = {}) {
    return {
        mousePos: clonePoint(input.mousePos),
        wheel: {
            x: resolveFiniteNumber(input.wheel?.x, DEFAULT_WHEEL_TOTALS.x),
            y: resolveFiniteNumber(input.wheel?.y, DEFAULT_WHEEL_TOTALS.y)
        },
        mouseButtons: {
            left: cloneMouseButtonState(input.mouseButtons?.left),
            right: cloneMouseButtonState(input.mouseButtons?.right),
            middle: cloneMouseButtonState(input.mouseButtons?.middle)
        },
        focusList: Array.isArray(input.focusList) ? [...input.focusList] : [...DEFAULT_FOCUS_LIST],
        actionStates: cloneBooleanRecord(input.actionStates),
        keys: cloneBooleanRecord(input.keys)
    };
}

/**
 * 뷰포트 스냅샷을 정규화합니다.
 * @param {object} [viewport={}]
 * @returns {{ww: number, wh: number, objectWH: number, objectOffsetY: number, uiww: number, uiOffsetX: number}}
 */
function cloneViewportSnapshot(viewport = {}) {
    return {
        ww: resolveFiniteNumber(viewport.ww, DEFAULT_VIEWPORT.ww),
        wh: resolveFiniteNumber(viewport.wh, DEFAULT_VIEWPORT.wh),
        objectWH: resolveFiniteNumber(viewport.objectWH, DEFAULT_VIEWPORT.objectWH),
        objectOffsetY: resolveFiniteNumber(viewport.objectOffsetY, DEFAULT_VIEWPORT.objectOffsetY),
        uiww: resolveFiniteNumber(viewport.uiww, DEFAULT_VIEWPORT.uiww),
        uiOffsetX: resolveFiniteNumber(viewport.uiOffsetX, DEFAULT_VIEWPORT.uiOffsetX)
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
 * 대상 배열의 내용을 source 또는 fallback 값으로 제자리 교체합니다.
 * @param {any[]} target - 내용을 교체할 대상 배열입니다.
 * @param {any[]|null|undefined} source - 우선 적용할 원본 배열입니다.
 * @param {any[]} fallback - source가 배열이 아닐 때 적용할 기본 배열입니다.
 * @returns {void}
 */
function replaceSimulationArrayContents(target, source, fallback) {
    target.length = 0;
    const values = Array.isArray(source) ? source : fallback;
    for (let i = 0; i < values.length; i++) {
        target.push(values[i]);
    }
}

/**
 * 뷰포트 스냅샷을 기존 대상 객체에 정규화해 기록합니다.
 * @param {{ww: number, wh: number, objectWH: number, objectOffsetY: number, uiww: number, uiOffsetX: number}} target - 갱신할 뷰포트 객체입니다.
 * @param {object} [viewport={}] - 적용할 뷰포트 스냅샷입니다.
 * @returns {void}
 */
function syncViewportSnapshotInto(target, viewport = {}) {
    target.ww = resolveFiniteNumber(viewport.ww, DEFAULT_VIEWPORT.ww);
    target.wh = resolveFiniteNumber(viewport.wh, DEFAULT_VIEWPORT.wh);
    target.objectWH = resolveFiniteNumber(viewport.objectWH, DEFAULT_VIEWPORT.objectWH);
    target.objectOffsetY = resolveFiniteNumber(viewport.objectOffsetY, DEFAULT_VIEWPORT.objectOffsetY);
    target.uiww = resolveFiniteNumber(viewport.uiww, DEFAULT_VIEWPORT.uiww);
    target.uiOffsetX = resolveFiniteNumber(viewport.uiOffsetX, DEFAULT_VIEWPORT.uiOffsetX);
}

/**
 * 입력 스냅샷을 기존 중첩 컨테이너 identity를 보존하며 동기화합니다.
 * @param {{mousePos: {x: number, y: number}, wheel:{x:number,y:number}, mouseButtons: {left: string[], right: string[], middle: string[]}, focusList: string[], actionStates:Record<string,boolean>, keys: Record<string, boolean>}} target - 갱신할 입력 객체입니다.
 * @param {object} [input={}] - 적용할 입력 스냅샷입니다.
 * @returns {void}
 */
function syncInputSnapshotInto(target, input = {}) {
    target.mousePos.x = resolveFiniteNumber(input.mousePos?.x, DEFAULT_MOUSE_POSITION.x);
    target.mousePos.y = resolveFiniteNumber(input.mousePos?.y, DEFAULT_MOUSE_POSITION.y);
    target.wheel.x = resolveFiniteNumber(input.wheel?.x, DEFAULT_WHEEL_TOTALS.x);
    target.wheel.y = resolveFiniteNumber(input.wheel?.y, DEFAULT_WHEEL_TOTALS.y);
    replaceSimulationArrayContents(target.mouseButtons.left, input.mouseButtons?.left, DEFAULT_MOUSE_BUTTON_STATE);
    replaceSimulationArrayContents(target.mouseButtons.right, input.mouseButtons?.right, DEFAULT_MOUSE_BUTTON_STATE);
    replaceSimulationArrayContents(target.mouseButtons.middle, input.mouseButtons?.middle, DEFAULT_MOUSE_BUTTON_STATE);
    replaceSimulationArrayContents(target.focusList, input.focusList, DEFAULT_FOCUS_LIST);

    syncBooleanRecordInto(target.actionStates, input.actionStates);
    syncBooleanRecordInto(target.keys, input.keys);
}

/**
 * boolean record를 기존 대상 객체에 제자리 동기화합니다.
 * @param {Record<string,boolean>} target - 갱신할 record입니다.
 * @param {object|null|undefined} source - 적용할 원본입니다.
 * @returns {void}
 */
function syncBooleanRecordInto(target, source) {
    const normalizedSource = source && typeof source === 'object'
        ? source
        : EMPTY_SIMULATION_RECORD;
    for (const key in target) {
        if (Object.prototype.hasOwnProperty.call(target, key)
            && !Object.prototype.hasOwnProperty.call(normalizedSource, key)) {
            delete target[key];
        }
    }
    for (const key in normalizedSource) {
        if (Object.prototype.hasOwnProperty.call(normalizedSource, key)) {
            target[key] = normalizedSource[key] === true;
        }
    }
}

/**
 * 설정 스냅샷을 기존 대상 객체에 제자리 동기화합니다.
 * @param {Record<string, any>} target - 갱신할 설정 객체입니다.
 * @param {object} [settings={}] - 적용할 설정 스냅샷입니다.
 * @returns {void}
 */
function syncSettingsSnapshotInto(target, settings = {}) {
    const source = settings && typeof settings === 'object'
        ? settings
        : EMPTY_SIMULATION_RECORD;
    for (const key in target) {
        if (Object.prototype.hasOwnProperty.call(target, key)
            && !Object.prototype.hasOwnProperty.call(source, key)) {
            delete target[key];
        }
    }
    for (const key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
            target[key] = source[key];
        }
    }
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
     * 메인 루프에서 제공한 최상위 그룹만 런타임에 부분 동기화합니다.
     * 생략한 그룹은 이전 상태를 유지합니다. 제공한 그룹은 기존 중첩 컨테이너 identity를 보존하면서
     * 배열을 제자리 교체하고, input actionStates/keys와 settings에서 source에 없는 own key를 삭제합니다.
     * @param {{viewport?: object, input?: object, settings?: object}} [snapshot={}] - 적용할 부분 스냅샷입니다.
     * @returns {void}
     */
    sync(snapshot = {}) {
        if (snapshot.viewport !== undefined) {
            syncViewportSnapshotInto(this.viewport, snapshot.viewport);
        }
        if (snapshot.input !== undefined) {
            syncInputSnapshotInto(this.input, snapshot.input);
        }
        if (snapshot.settings !== undefined) {
            syncSettingsSnapshotInto(this.settings, snapshot.settings);
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
     * @returns {{mousePos: {x: number, y: number}, wheel:{x:number,y:number}, mouseButtons: {left: string[], right: string[], middle: string[]}, focusList: string[], actionStates:Record<string,boolean>, keys: Record<string, boolean>}}
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
     * @returns {{viewport: {ww: number, wh: number, objectWH: number, objectOffsetY: number, uiww: number, uiOffsetX: number}, input: {mousePos: {x: number, y: number}, wheel:{x:number,y:number}, mouseButtons: {left: string[], right: string[], middle: string[]}, focusList: string[], actionStates:Record<string,boolean>, keys: Record<string, boolean>}, settings: Record<string, any>}}
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
 * 제공한 viewport·input·settings 그룹만 기존 시뮬레이션 런타임에 제자리 동기화합니다.
 * 생략한 그룹은 이전 상태를 유지하며, 제공한 input/settings의 누락 key는 제거됩니다.
 * @param {{viewport?: object, input?: object, settings?: object}} [snapshot={}] - 적용할 부분 스냅샷입니다.
 * @returns {SimulationRuntime} 동기화에 사용한 싱글톤 런타임입니다.
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
 * @returns {{viewport: {ww: number, wh: number, objectWH: number, objectOffsetY: number, uiww: number, uiOffsetX: number}, input: {mousePos: {x: number, y: number}, wheel:{x:number,y:number}, mouseButtons: {left: string[], right: string[], middle: string[]}, focusList: string[], actionStates:Record<string,boolean>, keys: Record<string, boolean>}, settings: Record<string, any>}}
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
            return clonePoint(DEFAULT_MOUSE_POSITION);
        }
        if (key === 'x' || key === 'y') {
            return DEFAULT_MOUSE_POSITION[key];
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
 * 현재 시뮬레이션 마우스 좌표를 호출자가 소유한 객체에 복사합니다.
 * hot path에서 중간 좌표 객체를 만들지 않아야 할 때 사용합니다.
 * x, y 순서로 제자리 기록하며 동일한 객체를 반환합니다.
 * @param {{x: number, y: number}} target - 쓰기 가능한 호출자 소유 좌표 객체입니다.
 * @returns {{x: number, y: number}} 전달받은 동일 좌표 객체입니다.
 */
export function copySimulationMousePositionInto(target) {
    const input = simulationRuntimeInstance?.input;
    const point = input ? input.mousePos : DEFAULT_MOUSE_POSITION;
    target.x = resolveFiniteNumber(point?.x, DEFAULT_MOUSE_POSITION.x);
    target.y = resolveFiniteNumber(point?.y, DEFAULT_MOUSE_POSITION.y);
    return target;
}

/**
 * 현재 누적 wheel unit을 호출자가 소유한 객체에 복사합니다.
 * 누적값은 소비하지 않으며 adapter가 직전 스냅샷과의 차이를 계산합니다.
 * @param {{x:number,y:number}} target - 쓰기 가능한 호출자 소유 객체입니다.
 * @returns {{x:number,y:number}} 전달받은 동일 객체입니다.
 */
export function copySimulationWheelTotalsInto(target) {
    const input = simulationRuntimeInstance?.input;
    const wheel = input ? input.wheel : DEFAULT_WHEEL_TOTALS;
    target.x = resolveFiniteNumber(wheel?.x, DEFAULT_WHEEL_TOTALS.x);
    target.y = resolveFiniteNumber(wheel?.y, DEFAULT_WHEEL_TOTALS.y);
    return target;
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
 * 시뮬레이션 입력 스냅샷에서 지정한 의미 action이 눌려 있는지 확인합니다.
 * 물리 KeyboardEvent.code는 이 경계에 도달하지 않습니다.
 * @param {string} actionId - 조회할 의미 action ID입니다.
 * @returns {boolean} 현재 눌림 여부입니다.
 */
export function isSimulationInputActionPressed(actionId) {
    if (typeof actionId !== 'string' || actionId.length === 0) {
        return false;
    }
    const input = simulationRuntimeInstance?.input;
    if (input?.actionStates
        && Object.prototype.hasOwnProperty.call(input.actionStates, actionId)) {
        return input.actionStates[actionId] === true;
    }
    return input?.keys?.[actionId] === true;
}

/**
 * 기존 함수명의 호환 별칭입니다. 입력값은 물리 키가 아니라 의미 action ID로 해석합니다.
 * @param {string} actionId - 조회할 의미 action ID입니다.
 * @returns {boolean} 현재 눌림 여부입니다.
 */
export const isSimulationKeyboardPressed = isSimulationInputActionPressed;

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
