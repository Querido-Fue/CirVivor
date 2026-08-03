/**
 * 단일 타이틀 메뉴 패널 스타일을 allocation 없이 session에 전달합니다.
 * @param {object} session - overlay session입니다.
 * @param {object} panelRect - 패널 영역입니다.
 * @param {object} style - 패널 스타일입니다.
 * @param {number} alpha - 최종 알파값입니다.
 * @param {DOMMatrix|number[]|null} transformMatrix - 패널 변환입니다.
 * @param {object|null} perspective - 원근 옵션입니다.
 * @param {HTMLCanvasElement|null} effectTextureCanvas - 효과 텍스처입니다.
 * @returns {void}
 */
function renderTitleMenuPanelStyle(
    session,
    panelRect,
    style,
    alpha,
    transformMatrix,
    perspective,
    effectTextureCanvas
) {
    if (!style || alpha <= 0) {
        return;
    }

    session.renderGlassPanel({
        x: panelRect.x,
        y: panelRect.y,
        w: panelRect.w,
        h: panelRect.h,
        radius: panelRect.radius,
        sampleBackdrop: style.sampleBackdrop,
        blur: style.blur,
        fill: style.fill,
        stroke: style.stroke,
        lineWidth: style.lineWidth,
        tintColor: style.tintColor,
        edgeColor: style.edgeColor,
        tintStrength: style.tintStrength,
        edgeStrength: style.edgeStrength,
        refractionStrength: style.refractionStrength,
        alpha,
        transformMatrix,
        perspective,
        effectTextureCanvas
    });
}

/**
 * 타이틀 메뉴 glass panel을 OverlaySession에 전달합니다.
 * @param {object|null} session - 타이틀 메뉴 overlay session입니다.
 * @param {object} options - 패널 렌더 옵션입니다.
 * @param {{x:number, y:number, w:number, h:number, radius:number}} options.panelRect - 렌더할 패널 영역입니다.
 * @param {object} options.panelStyle - glass 패널 스타일 옵션입니다.
 * @param {object} [options.opaquePanelStyle=options.panelStyle] - 불투명 패널 스타일 옵션입니다.
 * @param {number} [options.alpha=1] - 패널 알파값입니다.
 * @param {DOMMatrix|number[]|null} [options.transformMatrix=null] - 패널 변환 행렬입니다.
 * @param {object|null} [options.perspective=null] - 패널 원근 옵션입니다.
 * @param {HTMLCanvasElement|null} [options.effectTextureCanvas=null] - 패널 위에 합성할 효과 텍스처입니다.
 * @returns {void}
 */
export function renderTitleMenuGlassPanel(
    session,
    {
        panelRect,
        panelStyle,
        opaquePanelStyle = panelStyle,
        alpha = 1,
        transformMatrix = null,
        perspective = null,
        effectTextureCanvas = null
    }
) {
    if (!session || !panelRect || !panelStyle) {
        return;
    }

    if (alpha > 0) {
        session.recordTitleWebGpuPanelContentBounds?.(panelRect);
    }

    const glassAlpha = typeof session.getGlassPanelAlpha === 'function'
        ? session.getGlassPanelAlpha()
        : (session.effectiveTransparent === true ? 1 : 0);
    const opaqueAlpha = typeof session.getOpaquePanelAlpha === 'function'
        ? session.getOpaquePanelAlpha()
        : 1 - glassAlpha;
    renderTitleMenuPanelStyle(
        session,
        panelRect,
        panelStyle,
        alpha * glassAlpha,
        transformMatrix,
        perspective,
        effectTextureCanvas
    );
    renderTitleMenuPanelStyle(
        session,
        panelRect,
        opaquePanelStyle,
        alpha * opaqueAlpha,
        transformMatrix,
        perspective,
        effectTextureCanvas
    );
}
