const CONNECTED_FRONT_GLASS_BLUR = 0.1;

/**
 * 연결 전환 앞면에만 동적 glass backdrop 스타일을 적용합니다.
 * @param {object|null} panelStyle - 기본 카드 패널 스타일입니다.
 * @param {boolean} showsFrontFace - 현재 앞면 표시 여부입니다.
 * @param {boolean} glassEnabled - 투명 glass 사용 가능 여부입니다.
 * @returns {object|null} 연결 전환 앞면용 패널 스타일입니다.
 */
export function resolveTitleMenuConnectedFrontPanelStyle(panelStyle, showsFrontFace, glassEnabled) {
    if (!panelStyle || showsFrontFace !== true || glassEnabled !== true) {
        return panelStyle;
    }

    return {
        ...panelStyle,
        sampleBackdrop: true,
        blur: Math.max(
            CONNECTED_FRONT_GLASS_BLUR,
            Number.isFinite(panelStyle.blur) ? panelStyle.blur : 0
        )
    };
}

/**
 * 타이틀 메뉴 glass panel을 OverlaySession에 전달합니다.
 * @param {object|null} session - 타이틀 메뉴 overlay session입니다.
 * @param {object} options - 패널 렌더 옵션입니다.
 * @param {{x:number, y:number, w:number, h:number, radius:number}} options.panelRect - 렌더할 패널 영역입니다.
 * @param {object} options.panelStyle - 패널 스타일 옵션입니다.
 * @param {number} [options.alpha=1] - 패널 알파값입니다.
 * @param {DOMMatrix|number[]|null} [options.transformMatrix=null] - 패널 변환 행렬입니다.
 * @param {object|null} [options.perspective=null] - 패널 원근 옵션입니다.
 * @param {HTMLCanvasElement|null} [options.effectTextureCanvas=null] - 패널 위에 합성할 효과 텍스처입니다.
 * @param {object|null} [options.effectTextureRect=null] - 효과 텍스처를 고정할 절대 화면 영역입니다.
 * @returns {void}
 */
export function renderTitleMenuGlassPanel(
    session,
    {
        panelRect,
        panelStyle,
        alpha = 1,
        transformMatrix = null,
        perspective = null,
        effectTextureCanvas = null,
        effectTextureRect = null
    }
) {
    if (!session || !panelRect || !panelStyle) {
        return;
    }

    session.renderGlassPanel({
        x: panelRect.x,
        y: panelRect.y,
        w: panelRect.w,
        h: panelRect.h,
        radius: panelRect.radius,
        sampleBackdrop: panelStyle.sampleBackdrop,
        blur: panelStyle.blur,
        fill: panelStyle.fill,
        stroke: panelStyle.stroke,
        lineWidth: panelStyle.lineWidth,
        tintColor: panelStyle.tintColor,
        edgeColor: panelStyle.edgeColor,
        tintStrength: panelStyle.tintStrength,
        edgeStrength: panelStyle.edgeStrength,
        refractionStrength: panelStyle.refractionStrength,
        alpha,
        transformMatrix,
        perspective,
        effectTextureCanvas,
        effectTextureRect
    });
}
