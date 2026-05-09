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
    const canvasWidth = Math.max(1, Math.ceil(width));
    const canvasHeight = Math.max(1, Math.ceil(height));

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
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvasWidth, canvasHeight);
    context.save();
    context.setTransform(1, 0, 0, -1, 0, canvasHeight);
    context.beginPath();
    context.roundRect(0, 0, panelRect.w, panelRect.h, panelRect.radius);
    context.clip();
}
