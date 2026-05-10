import { wrapTextByWords } from 'util/font_util.js';

/**
 * 폭 제한에 맞춰 텍스트를 줄바꿈해 그립니다.
 * @param {CanvasRenderingContext2D} context - 대상 컨텍스트입니다.
 * @param {object} options - 텍스트 렌더 옵션입니다.
 */
export function drawTitleMenuWrappedText(context, options) {
    const text = String(options.text || '').trim();
    if (!text) {
        return;
    }

    context.save();
    context.font = options.font;
    context.fillStyle = options.fillStyle;
    context.textAlign = options.align || 'left';
    context.textBaseline = 'top';

    const lines = wrapTextByWords(text, {
        maxWidth: options.maxWidth,
        measureWidth: (line) => context.measureText(line).width,
        preserveEmptyLines: true,
        trimText: true
    });
    let currentY = options.y;

    for (const line of lines) {
        if (line) {
            context.fillText(line, options.x, currentY);
        }
        currentY += options.lineHeight;
    }

    context.restore();
}
