import { clampFiniteNumber } from 'util/number_util.js';

/**
 * 논리 패널 크기보다 작지 않은 텍스처 raster 크기를 계산합니다.
 * @param {{w:number,h:number}|null|undefined} panelRect - 콘텐츠의 논리 패널 영역입니다.
 * @param {{width?:number,height?:number}|null} [preferredSize=null] - 선명도를 위해 확보할 선호 backing 크기입니다.
 * @returns {{width:number,height:number}} 정수 backing 크기입니다.
 */
export function resolveTitleMenuTextureRasterSize(panelRect, preferredSize = null) {
    const logicalWidth = clampFiniteNumber(panelRect?.w, 1, Infinity, 1);
    const logicalHeight = clampFiniteNumber(panelRect?.h, 1, Infinity, 1);
    const preferredWidth = clampFiniteNumber(
        preferredSize?.width,
        logicalWidth,
        Infinity,
        logicalWidth
    );
    const preferredHeight = clampFiniteNumber(
        preferredSize?.height,
        logicalHeight,
        Infinity,
        logicalHeight
    );

    return {
        width: Math.ceil(preferredWidth),
        height: Math.ceil(preferredHeight)
    };
}

/**
 * 타이틀 메뉴 텍스처용 캔버스와 2D 컨텍스트를 확보하고 크기를 동기화합니다.
 * @param {object} target - 캔버스/컨텍스트를 보관할 객체입니다.
 * @param {string} canvasKey - 캔버스 필드 이름입니다.
 * @param {string} contextKey - 컨텍스트 필드 이름입니다.
 * @param {number} width - 필요한 캔버스 너비입니다.
 * @param {number} height - 필요한 캔버스 높이입니다.
 * @returns {{canvas:HTMLCanvasElement, context:CanvasRenderingContext2D, width:number, height:number}} 캔버스와 컨텍스트입니다.
 */
export function ensureTitleMenuTextureCanvas(target, canvasKey, contextKey, width, height) {
    const canvasWidth = Math.ceil(clampFiniteNumber(width, 1, Infinity, 1));
    const canvasHeight = Math.ceil(clampFiniteNumber(height, 1, Infinity, 1));

    if (!target[canvasKey] || !target[contextKey]) {
        target[canvasKey] = document.createElement('canvas');
        target[contextKey] = target[canvasKey].getContext('2d');
    }

    const canvas = target[canvasKey];
    if (canvas.width !== canvasWidth) {
        canvas.width = canvasWidth;
    }
    if (canvas.height !== canvasHeight) {
        canvas.height = canvasHeight;
    }

    return {
        canvas,
        context: target[contextKey],
        width: canvasWidth,
        height: canvasHeight
    };
}

/**
 * 타이틀 메뉴 텍스처 컨텍스트를 비우고 panel rect 기준 clip을 시작합니다.
 * 호출자는 렌더 후 context.restore()를 호출해야 합니다.
 * @param {CanvasRenderingContext2D} context - 렌더 대상 컨텍스트입니다.
 * @param {number} canvasWidth - 캔버스 너비입니다.
 * @param {number} canvasHeight - 캔버스 높이입니다.
 * @param {object} panelRect - clip에 사용할 패널 rect입니다.
 */
export function beginTitleMenuTextureClip(context, canvasWidth, canvasHeight, panelRect) {
    const logicalWidth = clampFiniteNumber(panelRect?.w, 1, Infinity, 1);
    const logicalHeight = clampFiniteNumber(panelRect?.h, 1, Infinity, 1);
    const rasterScaleX = canvasWidth / logicalWidth;
    const rasterScaleY = canvasHeight / logicalHeight;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvasWidth, canvasHeight);
    context.save();
    context.setTransform(rasterScaleX, 0, 0, -rasterScaleY, 0, canvasHeight);
    context.beginPath();
    context.roundRect(0, 0, logicalWidth, logicalHeight, panelRect.radius);
    context.clip();
}
