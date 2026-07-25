import { parseUIData } from 'ui/ui_system.js';
import { resolveTypography } from 'ui/style/_typography_resolver.js';
import { wrapTextByWords } from 'util/font_util.js';

/**
 * 설명 문구를 여러 줄로 그립니다.
 * @param {CanvasRenderingContext2D} ctx - UI 컨텍스트
 * @param {string} text - 출력할 문구
 * @param {number} x - 시작 X 좌표
 * @param {number} y - 시작 Y 좌표
 * @param {number} maxWidth - 최대 줄 너비
 * @param {number} lineHeight - 줄 간격
 * @param {number} maxLines - 최대 줄 수
 * @returns {void}
 */
export function drawBentoWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
    const lines = wrapTextByWords(text, {
        maxWidth,
        maxLines,
        measureWidth: (line) => ctx.measureText(line).width
    });

    for (let index = 0; index < lines.length; index++) {
        ctx.fillText(lines[index], x, y + (lineHeight * index));
    }
}

/**
 * 승인된 역할 토큰을 Magic Bento 카드용 렌더 메트릭으로 변환합니다.
 * @param {object} token - `TYPOGRAPHY`에서 발급한 타이포그래피 토큰입니다.
 * @returns {{size:number,lineHeight:number,font:string}} 계산된 폰트 정보입니다.
 */
export function resolveBentoTypography(token) {
    return resolveTypography(token, {
        resolveMetric: parseUIData
    });
}
