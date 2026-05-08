import { parseUIData } from 'ui/ui_system.js';

/**
 * 설명 문구를 여러 줄로 그립니다.
 * @param {CanvasRenderingContext2D} ctx - UI 컨텍스트
 * @param {string} text - 출력할 문구
 * @param {number} x - 시작 X 좌표
 * @param {number} y - 시작 Y 좌표
 * @param {number} maxWidth - 최대 줄 너비
 * @param {number} lineHeight - 줄 간격
 * @param {number} maxLines - 최대 줄 수
 */
export function drawBentoWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
    const words = String(text || '').split(' ');
    const lines = [];
    let currentLine = '';

    for (const word of words) {
        const nextLine = currentLine ? `${currentLine} ${word}` : word;
        if (ctx.measureText(nextLine).width <= maxWidth || currentLine.length === 0) {
            currentLine = nextLine;
            continue;
        }

        lines.push(currentLine);
        currentLine = word;
        if (lines.length >= maxLines) {
            break;
        }
    }

    if (currentLine && lines.length < maxLines) {
        lines.push(currentLine);
    }

    for (let index = 0; index < lines.length; index++) {
        ctx.fillText(lines[index], x, y + (lineHeight * index));
    }
}

/**
 * 공용 타이포그래피 프리셋으로부터 카드용 폰트를 계산합니다.
 * @param {object} textConstants - 텍스트 상수입니다.
 * @param {string} presetKey - TEXT_CONSTANTS 프리셋 키
 * @param {number} [sizeMultiplier=1] - 크기 배율
 * @returns {{size:number, font:string}} 계산된 폰트 정보
 */
export function getBentoTypography(textConstants, presetKey, sizeMultiplier = 1) {
    const preset = textConstants[presetKey] || textConstants.H5;
    const size = parseUIData(preset.FONT.SIZE) * sizeMultiplier;
    const family = preset.FONT.FAMILY.split(',')[0].trim();

    return {
        size,
        font: `${preset.FONT.WEIGHT} ${size}px "${family}"`
    };
}
