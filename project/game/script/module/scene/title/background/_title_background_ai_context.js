import {
    getSimulationMouseFocus,
    getSimulationMouseInput,
    isSimulationMousePressing
} from 'simulation/simulation_runtime.js';
import { clampFiniteNumber } from 'util/number_util.js';

/**
 * 타이틀 배경 적 AI가 사용할 입력 컨텍스트를 구성합니다.
 * @param {object} options - AI 컨텍스트 구성 옵션입니다.
 * @param {object} options.titleConstants - 타이틀 상수 묶음입니다.
 * @param {{centerX:number, centerY:number, radius:number}|null} options.shieldLayout - 실드 위치 정보입니다.
 * @param {number} options.shieldRadius - 현재 실드 반경입니다.
 * @param {number} options.objectOffsetY - 오브젝트 좌표계 Y 오프셋입니다.
 * @param {number} options.uiww - UI 기준 너비입니다.
 * @returns {object} 타이틀 적 AI 컨텍스트입니다.
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
