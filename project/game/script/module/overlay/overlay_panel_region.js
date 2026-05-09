import { ColorSchemes } from 'display/_theme_handler.js';

export const DEFAULT_OVERLAY_PANEL_ID = 'root';

/**
 * overlay 프레젠테이션 기준 좌표를 계산합니다.
 * @param {object} overlay - 기준 overlay 인스턴스입니다.
 * @returns {{x:number, y:number}} 프레젠테이션 기준 좌표입니다.
 */
export function getOverlayPresentationOrigin(overlay) {
    return {
        x: Number.isFinite(overlay.scaledX) && Number.isFinite(overlay.scaledW)
            ? overlay.scaledX + (overlay.scaledW * 0.5)
            : overlay.WW * 0.5,
        y: Number.isFinite(overlay.scaledY) && Number.isFinite(overlay.scaledH)
            ? overlay.scaledY + (overlay.scaledH * 0.5)
            : overlay.WH * 0.5
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

    const scale = Number.isFinite(overlay.contentScale) ? overlay.contentScale : 1;
    if (Math.abs(scale - 1) <= 0.0001) {
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
        return metric;
    }
    if (typeof metric === 'string') {
        return positioningHandler.parseUIData(metric, uiScale);
    }
    if (typeof metric === 'object' && metric.unit && metric.value !== undefined) {
        return positioningHandler.parseUnit(metric.unit, metric.value, referenceSize);
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
    if (radius === null || radius === undefined) {
        return positioningHandler.parseUIData('UI_CONSTANTS.OVERLAY_PANEL_RADIUS', uiScale);
    }
    if (typeof radius === 'number') {
        return radius;
    }
    if (typeof radius === 'string') {
        return positioningHandler.parseUIData(radius, uiScale);
    }
    if (typeof radius === 'object' && radius.unit && radius.value !== undefined) {
        return positioningHandler.parseUnit(radius.unit, radius.value, panelWidth);
    }

    return positioningHandler.parseUIData('UI_CONSTANTS.OVERLAY_PANEL_RADIUS', uiScale);
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
    const w = Math.max(0, resolveOverlayPanelMetric(definition.w, overlay.scaledW, overlay.scaledW, overlay.positioningHandler, overlay.uiScale));
    const h = Math.max(0, resolveOverlayPanelMetric(definition.h, overlay.scaledH, overlay.scaledH, overlay.positioningHandler, overlay.uiScale));

    return {
        id: definition.id || `${DEFAULT_OVERLAY_PANEL_ID}_${index}`,
        x,
        y,
        w,
        h,
        radius: resolveOverlayPanelRadius(definition.radius, w, overlay.positioningHandler, overlay.uiScale),
        blur: definition.blur ?? 0.1,
        fill: definition.fill,
        stroke: definition.stroke,
        lineWidth: definition.lineWidth ?? 1,
        shadowBlur: definition.shadowBlur ?? 24,
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
