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

    const paragraphs = text.split('\n');
    let currentY = options.y;

    for (const paragraph of paragraphs) {
        const words = paragraph.split(/\s+/).filter(Boolean);
        if (words.length === 0) {
            currentY += options.lineHeight;
            continue;
        }

        let line = '';
        for (const word of words) {
            const nextLine = line ? `${line} ${word}` : word;
            const metrics = context.measureText(nextLine);
            if (metrics.width > options.maxWidth && line) {
                context.fillText(line, options.x, currentY);
                currentY += options.lineHeight;
                line = word;
            } else {
                line = nextLine;
            }
        }

        if (line) {
            context.fillText(line, options.x, currentY);
            currentY += options.lineHeight;
        }
    }

    context.restore();
}
