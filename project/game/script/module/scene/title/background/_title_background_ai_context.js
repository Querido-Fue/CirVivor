import {
    copySimulationMousePositionInto,
    getSimulationMouseFocus,
    getSimulationMouseInput,
    isSimulationMousePressing
} from 'simulation/simulation_runtime.js';
import { clampFiniteNumber } from 'util/number_util.js';

/**
 * 수집된 입력값으로 타이틀 배경 적 AI 컨텍스트를 완성합니다.
 * @param {object} titleConstants - 타이틀 상수 묶음입니다.
 * @param {{centerX:number, centerY:number, radius:number}|null} shieldLayout - 실드 위치 정보입니다.
 * @param {number} shieldRadius - 현재 실드 반경입니다.
 * @param {number} objectOffsetY - 오브젝트 좌표계 Y 오프셋입니다.
 * @param {number} uiww - UI 기준 너비입니다.
 * @param {boolean} objectFocused - 오브젝트 레이어 포커스 여부입니다.
 * @param {{x:number, y:number}|null} mousePosInObject - 오브젝트 좌표계 마우스 위치입니다.
 * @returns {{uiww:number, logoMagneticPoint:{x:number, y:number}|null, logoMagneticDistance:number, objectFocused:boolean, leftPressing:boolean, mousePos:{x:number, y:number}|null}} 타이틀 적 AI 컨텍스트입니다.
 */
function createTitleBackgroundAiContext(
    titleConstants,
    shieldLayout,
    shieldRadius,
    objectOffsetY,
    uiww,
    objectFocused,
    mousePosInObject
) {
    const shieldMagneticPointInObject = shieldLayout
        ? { x: shieldLayout.centerX, y: shieldLayout.centerY + objectOffsetY }
        : null;
    const logoDistanceMultiplier = clampFiniteNumber(
        titleConstants.TITLE_AI.LOGO_DISTANCE_MULTIPLIER,
        1,
        Infinity,
        1
    );

    return {
        uiww,
        logoMagneticPoint: shieldMagneticPointInObject,
        logoMagneticDistance: shieldRadius * logoDistanceMultiplier,
        objectFocused,
        leftPressing: isSimulationMousePressing('left'),
        mousePos: mousePosInObject
    };
}

/**
 * 타이틀 배경 적 AI가 사용할 입력 컨텍스트를 구성합니다.
 * @param {object} options - AI 컨텍스트 구성 옵션입니다.
 * @param {object} options.titleConstants - 타이틀 상수 묶음입니다.
 * @param {{centerX:number, centerY:number, radius:number}|null} options.shieldLayout - 실드 위치 정보입니다.
 * @param {number} options.shieldRadius - 현재 실드 반경입니다.
 * @param {number} options.objectOffsetY - 오브젝트 좌표계 Y 오프셋입니다.
 * @param {number} options.uiww - UI 기준 너비입니다.
 * @returns {{uiww:number, logoMagneticPoint:{x:number, y:number}|null, logoMagneticDistance:number, objectFocused:boolean, leftPressing:boolean, mousePos:{x:number, y:number}|null}} 타이틀 적 AI 컨텍스트입니다.
 */
export function buildTitleBackgroundAiContext({
    titleConstants,
    shieldLayout,
    shieldRadius,
    objectOffsetY,
    uiww
}) {
    const mousePos = getSimulationMouseInput('pos');
    const focus = getSimulationMouseFocus();
    const objectFocused = Array.isArray(focus) && focus.includes('object');
    const mousePosInObject = mousePos
        ? { x: mousePos.x, y: mousePos.y + objectOffsetY }
        : null;
    return createTitleBackgroundAiContext(
        titleConstants,
        shieldLayout,
        shieldRadius,
        objectOffsetY,
        uiww,
        objectFocused,
        mousePosInObject
    );
}

/**
 * 타이틀 fixed hot path용 positional 입력으로 적 AI 컨텍스트를 구성합니다.
 * 공개 options 경로와 결과 계약을 유지하면서 options 및 중간 마우스 좌표 할당을 생략합니다.
 * @param {object} titleConstants - 타이틀 상수 묶음입니다.
 * @param {{centerX:number, centerY:number, radius:number}|null} shieldLayout - 실드 위치 정보입니다.
 * @param {number} shieldRadius - 현재 실드 반경입니다.
 * @param {number} objectOffsetY - 오브젝트 좌표계 Y 오프셋입니다.
 * @param {number} uiww - UI 기준 너비입니다.
 * @returns {{uiww:number, logoMagneticPoint:{x:number, y:number}|null, logoMagneticDistance:number, objectFocused:boolean, leftPressing:boolean, mousePos:{x:number, y:number}}} 타이틀 적 AI 컨텍스트입니다.
 */
export function buildTitleBackgroundAiContextFromSimulation(
    titleConstants,
    shieldLayout,
    shieldRadius,
    objectOffsetY,
    uiww
) {
    const mousePosInObject = { x: 0, y: 0 };
    copySimulationMousePositionInto(mousePosInObject);
    const focus = getSimulationMouseFocus();
    const objectFocused = Array.isArray(focus) && focus.includes('object');
    mousePosInObject.y += objectOffsetY;

    return createTitleBackgroundAiContext(
        titleConstants,
        shieldLayout,
        shieldRadius,
        objectOffsetY,
        uiww,
        objectFocused,
        mousePosInObject
    );
}
