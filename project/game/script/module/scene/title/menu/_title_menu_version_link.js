import { getData } from 'data/data_handler.js';
import { consumeMouseState, hasMouseState } from 'input/input_system.js';
import { UIPool, releaseUIItem } from 'ui/_ui_pool.js';
import { formatRgba } from 'util/color_util.js';
import { clampFiniteNumber, resolveFiniteNumber } from 'util/number_util.js';
import { runtimeTool } from 'util/runtime_tool.js';

const TITLE_LINK_DATA = getData('TITLE_LINK_DATA');
/** 업데이트 링크 버튼의 시각 요소를 숨기는 투명 색상입니다. */
const TRANSPARENT_BUTTON_COLOR = formatRgba(0, 0, 0, 0);

/**
 * 우상단 업데이트 링크 상호작용에 사용할 투명 버튼을 생성합니다.
 * @param {object} parent - 버튼이 소속될 UI 부모입니다.
 * @returns {import('ui/element/_button.js').ButtonElement} 생성된 버튼입니다.
 */
export function createTitleMenuVersionHistoryLinkButton(parent) {
    const button = UIPool.button.get();
    button.init({
        parent,
        onClick: _handleTitleMenuVersionHistoryLinkClick,
        onHover: null,
        layer: 'ui',
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        idleColor: TRANSPARENT_BUTTON_COLOR,
        hoverColor: TRANSPARENT_BUTTON_COLOR,
        center: [],
        alpha: 1,
        margin: 0,
        radius: 0
    });
    button.hoverScaleMultiplier = 1;
    button.pressScaleMultiplier = 1;
    return button;
}

/**
 * 업데이트 링크 버튼을 UI 풀에 반환합니다.
 * @param {import('ui/element/_button.js').ButtonElement|null} button - 반환할 버튼입니다.
 * @returns {void}
 */
export function releaseTitleMenuVersionHistoryLinkButton(button) {
    if (button) {
        releaseUIItem(button);
    }
}

/**
 * 우상단 업데이트 링크 버튼 상태를 현재 배치와 포인터에 맞춰 갱신합니다.
 * @param {object} options - 버튼 상태 갱신 옵션입니다.
 * @param {import('ui/element/_button.js').ButtonElement|null} options.button - 업데이트 링크 버튼입니다.
 * @param {object|null} options.layout - 버전 정보 블록 렌더 레이아웃입니다.
 * @param {boolean} options.pointerEnabled - 포인터 상호작용 가능 여부입니다.
 * @param {number} options.mouseX - 현재 마우스 X 좌표입니다.
 * @param {number} options.mouseY - 현재 마우스 Y 좌표입니다.
 * @returns {void}
 */
export function updateTitleMenuVersionHistoryLinkButton({
    button,
    layout,
    pointerEnabled,
    mouseX,
    mouseY
}) {
    if (!button) {
        return;
    }

    layoutTitleMenuVersionHistoryLinkButton(button, layout, pointerEnabled);
    const isHovered = pointerEnabled
        && button.width > 0
        && button.height > 0
        && Number.isFinite(mouseX)
        && Number.isFinite(mouseY)
        && mouseX >= button.x
        && mouseX <= button.x + button.width
        && mouseY >= button.y
        && mouseY <= button.y + button.height;
    const isLeftPressing = hasMouseState('left', 'click') || hasMouseState('left', 'clicking');

    button._handleInteractionState(isHovered, isLeftPressing, button.onHover);

    if (isHovered && hasMouseState('left', 'clicked')) {
        button.onClick();
    }
}

/**
 * 우상단 업데이트 링크 버튼 배치를 현재 렌더 레이아웃에 맞춥니다.
 * @param {import('ui/element/_button.js').ButtonElement} button - 업데이트 링크 버튼입니다.
 * @param {object|null} layout - 버전 정보 블록 렌더 레이아웃입니다.
 * @param {boolean} pointerEnabled - 포인터 상호작용 가능 여부입니다.
 * @returns {void}
 */
export function layoutTitleMenuVersionHistoryLinkButton(button, layout, pointerEnabled) {
    const linkBounds = layout?.linkBounds || null;
    button.x = resolveFiniteNumber(Number(linkBounds?.x), 0);
    button.y = resolveFiniteNumber(Number(linkBounds?.y), 0);
    button.width = pointerEnabled && linkBounds
        ? clampFiniteNumber(Number(linkBounds.w), 0, Infinity, 0)
        : 0;
    button.height = pointerEnabled && linkBounds
        ? clampFiniteNumber(Number(linkBounds.h), 0, Infinity, 0)
        : 0;
    button.radius = 0;
}

/**
 * 업데이트 링크 좌측의 화살표 아이콘을 그립니다.
 * @param {import('overlay/_overlay_session.js').OverlaySession|null} session - 렌더 대상 오버레이 세션입니다.
 * @param {object} layout - 버전 정보 블록 렌더 레이아웃입니다.
 * @param {string} strokeColor - 화살표 선 색상입니다.
 * @param {number} shadowBlur - 그림자 블러 값입니다.
 * @param {string} shadowColor - 그림자 색상입니다.
 * @returns {void}
 */
export function drawTitleMenuVersionHistoryLinkArrow(session, layout, strokeColor, shadowBlur, shadowColor) {
    const iconSize = clampFiniteNumber(Number(layout?.linkIconSize), 0, Infinity, 0);
    if (!session || iconSize <= 0) {
        return;
    }

    const x = resolveFiniteNumber(Number(layout.linkIconX), 0);
    const y = resolveFiniteNumber(Number(layout.linkIconY), 0);
    const centerX = x + (iconSize * 0.5);
    const centerY = y + (iconSize * 0.5);
    const halfSpan = iconSize * 0.308;
    const headLength = halfSpan * 0.88;
    const lineWidth = clampFiniteNumber(iconSize * 0.1, 1, Infinity, 1);
    const commonOptions = {
        shape: 'line',
        stroke: strokeColor,
        alpha: layout.alpha,
        lineWidth,
        lineCap: 'round',
        shadowBlur,
        shadowColor
    };

    session.renderPanel({
        ...commonOptions,
        x1: centerX - halfSpan,
        y1: centerY,
        x2: centerX + halfSpan,
        y2: centerY
    });
    session.renderPanel({
        ...commonOptions,
        x1: centerX + halfSpan - headLength,
        y1: centerY - headLength,
        x2: centerX + halfSpan,
        y2: centerY
    });
    session.renderPanel({
        ...commonOptions,
        x1: centerX + halfSpan - headLength,
        y1: centerY + headLength,
        x2: centerX + halfSpan,
        y2: centerY
    });
}

/**
 * 업데이트 내역 버튼 클릭을 처리합니다.
 * @returns {void}
 */
function _handleTitleMenuVersionHistoryLinkClick() {
    if (!consumeMouseState('left')) {
        return;
    }

    _openTitleMenuVersionHistoryLink();
}

/**
 * 업데이트 내역 링크를 외부 브라우저에서 엽니다.
 * @returns {void}
 */
function _openTitleMenuVersionHistoryLink() {
    const url = String(TITLE_LINK_DATA.UPDATE_HISTORY_URL || '').trim();
    if (!url) {
        return;
    }

    runtimeTool()?.openURL?.(url);
}
