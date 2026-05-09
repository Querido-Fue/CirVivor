import { ColorSchemes } from 'display/_theme_handler.js';
import { clampFiniteNumber, resolveFiniteNumber } from 'util/number_util.js';

export const DEFAULT_OVERLAY_PANEL_ID = 'root';
const DEFAULT_OVERLAY_PANEL_RADIUS_KEY = 'UI_CONSTANTS.OVERLAY_PANEL_RADIUS';
const PRESENTATION_SCALE_EPSILON = 0.0001;
const DEFAULT_PANEL_BLUR = 0.1;
const DEFAULT_PANEL_LINE_WIDTH = 1;
const DEFAULT_PANEL_SHADOW_BLUR = 24;

/**
 * overlay 축 기준 프레젠테이션 중앙 좌표를 계산합니다.
 * @param {number} position - overlay 축 시작 좌표입니다.
 * @param {number} size - overlay 축 크기입니다.
 * @param {number} fallbackSize - overlay 좌표가 유효하지 않을 때 사용할 화면 축 크기입니다.
 * @returns {number} 축 기준 중앙 좌표입니다.
 */
const resolveOverlayPresentationAxis = (position, size, fallbackSize) => {
    if (Number.isFinite(position) && Number.isFinite(size)) {
        return position + (size * 0.5);
    }

    return fallbackSize * 0.5;
};

/**
 * 기본 overlay 패널 반경을 반환합니다.
 * @param {object} positioningHandler - 단위 파서를 제공하는 positioning handler입니다.
 * @param {number} uiScale - 현재 UI scale입니다.
 * @returns {number} 기본 패널 반경입니다.
 */
const getDefaultOverlayPanelRadius = (positioningHandler, uiScale) => (
    positioningHandler.parseUIData(DEFAULT_OVERLAY_PANEL_RADIUS_KEY, uiScale)
);

/**
 * overlay 프레젠테이션 기준 좌표를 계산합니다.
 * @param {object} overlay - 기준 overlay 인스턴스입니다.
 * @returns {{x:number, y:number}} 프레젠테이션 기준 좌표입니다.
 */
export function getOverlayPresentationOrigin(overlay) {
    return {
        x: resolveOverlayPresentationAxis(overlay.scaledX, overlay.scaledW, overlay.WW),
        y: resolveOverlayPresentationAxis(overlay.scaledY, overlay.scaledH, overlay.WH)
    };
}

/**
 * 프레젠테이션 scale을 반영한 패널 렌더 영역을 반환합니다.
 * @param {object|null} panel - 기준 패널 영역입니다.
 * @param {object} overlay - 현재 overlay 인스턴스입니다.
 * @returns {object|null} scale이 적용된 패널 영역입니다.
 */
export function getOverlayPresentedPanelRegion(panel, overlay) {
    if (!panel) {
        return panel;
    }

    const scale = resolveFiniteNumber(overlay.contentScale, 1);
    if (Math.abs(scale - 1) <= PRESENTATION_SCALE_EPSILON) {
        return panel;
    }

    const presentationOrigin = getOverlayPresentationOrigin(overlay);
    return {
        ...panel,
        x: presentationOrigin.x + ((panel.x - presentationOrigin.x) * scale),
        y: presentationOrigin.y + ((panel.y - presentationOrigin.y) * scale),
        w: panel.w * scale,
        h: panel.h * scale,
        radius: panel.radius * scale,
        lineWidth: panel.lineWidth * scale,
        shadowBlur: panel.shadowBlur * scale
    };
}

/**
 * 패널 metric을 실제 픽셀 값으로 변환합니다.
 * @param {number|object|string|undefined} metric - 변환할 metric입니다.
 * @param {number} fallbackValue - 기본값입니다.
 * @param {number} referenceSize - parent 단위 계산 기준입니다.
 * @param {object} positioningHandler - 단위 파서를 제공하는 positioning handler입니다.
 * @param {number} uiScale - 현재 UI scale입니다.
 * @returns {number} 변환된 값입니다.
 */
export function resolveOverlayPanelMetric(metric, fallbackValue, referenceSize, positioningHandler, uiScale) {
    if (metric === null || metric === undefined) {
        return fallbackValue;
    }
    if (typeof metric === 'number') {
        return resolveFiniteNumber(metric, fallbackValue);
    }
    if (typeof metric === 'string') {
        return resolveFiniteNumber(positioningHandler.parseUIData(metric, uiScale), fallbackValue);
    }
    if (typeof metric === 'object' && metric.unit && metric.value !== undefined) {
        return resolveFiniteNumber(positioningHandler.parseUnit(metric.unit, metric.value, referenceSize), fallbackValue);
    }

    return fallbackValue;
}

/**
 * 패널 반경을 계산합니다.
 * @param {number|object|string|undefined} radius - 반경 정의입니다.
 * @param {number} panelWidth - 패널 너비입니다.
 * @param {object} positioningHandler - 단위 파서를 제공하는 positioning handler입니다.
 * @param {number} uiScale - 현재 UI scale입니다.
 * @returns {number} 계산된 반경입니다.
 */
export function resolveOverlayPanelRadius(radius, panelWidth, positioningHandler, uiScale) {
    const defaultRadius = getDefaultOverlayPanelRadius(positioningHandler, uiScale);
    if (radius === null || radius === undefined) {
        return defaultRadius;
    }
    if (typeof radius === 'number') {
        return resolveFiniteNumber(radius, defaultRadius);
    }
    if (typeof radius === 'string') {
        return resolveFiniteNumber(
            positioningHandler.parseUIData(radius, uiScale),
            defaultRadius
        );
    }
    if (typeof radius === 'object' && radius.unit && radius.value !== undefined) {
        return resolveFiniteNumber(
            positioningHandler.parseUnit(radius.unit, radius.value, panelWidth),
            defaultRadius
        );
    }

    return defaultRadius;
}

/**
 * 단일 패널 정의를 실제 좌표 정보로 변환합니다.
 * @param {object} [definition={}] - 원본 패널 정의입니다.
 * @param {number} [index=0] - 패널 인덱스입니다.
 * @param {object} overlay - 기준 overlay 인스턴스입니다.
 * @returns {object} 정규화된 패널 영역입니다.
 */
export function resolveOverlayPanelRegion(definition = {}, index = 0, overlay) {
    const x = resolveOverlayPanelMetric(definition.x, overlay.scaledX, overlay.scaledW, overlay.positioningHandler, overlay.uiScale);
    const y = resolveOverlayPanelMetric(definition.y, overlay.scaledY, overlay.scaledH, overlay.positioningHandler, overlay.uiScale);
    const w = clampFiniteNumber(
        resolveOverlayPanelMetric(definition.w, overlay.scaledW, overlay.scaledW, overlay.positioningHandler, overlay.uiScale),
        0,
        Infinity,
        0
    );
    const h = clampFiniteNumber(
        resolveOverlayPanelMetric(definition.h, overlay.scaledH, overlay.scaledH, overlay.positioningHandler, overlay.uiScale),
        0,
        Infinity,
        0
    );

    return {
        id: definition.id || `${DEFAULT_OVERLAY_PANEL_ID}_${index}`,
        x,
        y,
        w,
        h,
        radius: resolveOverlayPanelRadius(definition.radius, w, overlay.positioningHandler, overlay.uiScale),
        blur: definition.blur ?? DEFAULT_PANEL_BLUR,
        fill: definition.fill,
        stroke: definition.stroke,
        lineWidth: definition.lineWidth ?? DEFAULT_PANEL_LINE_WIDTH,
        shadowBlur: definition.shadowBlur ?? DEFAULT_PANEL_SHADOW_BLUR,
        shadowColor: definition.shadowColor ?? ColorSchemes.Overlay.Panel.Shadow,
        tintColor: definition.tintColor,
        edgeColor: definition.edgeColor,
        tintStrength: definition.tintStrength,
        edgeStrength: definition.edgeStrength,
        refractionStrength: definition.refractionStrength,
        onClick: definition.onClick,
        visible: definition.visible !== false
    };
}

/**
 * 패널 id 조회 맵을 생성합니다.
 * @param {object[]} panelRegions - 정규화된 패널 영역 목록입니다.
 * @returns {Map<string, object>} 패널 id별 조회 맵입니다.
 */
export function createOverlayPanelMap(panelRegions) {
    return new Map(panelRegions.map((panel) => [panel.id, panel]));
}
