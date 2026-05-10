import { render } from 'display/display_system.js';
import { getLangString } from 'ui/ui_system.js';
import { getLoadingTextColor } from './_title_loading_theme.js';
import { clampFiniteNumber, resolveFiniteNumber } from 'util/number_util.js';

/**
 * 현재 로딩 상태에 맞춰 메인 로딩 텍스트와 안내 문구를 렌더링합니다.
 * @param {object} options - 로딩 텍스트 렌더 옵션입니다.
 * @param {number} options.loadingTextAlpha - 메인 로딩 텍스트 알파입니다.
 * @param {number} options.loadingNoticeAlpha - 안내 문구 알파입니다.
 * @param {number} options.loadingTextExitDistance - 텍스트 퇴장 이동 거리입니다.
 * @param {number} options.loadingTextExitProgress - 텍스트 퇴장 진행률입니다.
 * @param {number} options.loadingTextX - 텍스트 중심 X 좌표입니다.
 * @param {number} options.loadingTextY - 메인 텍스트 Y 좌표입니다.
 * @param {string} options.loadingTextFont - 메인 텍스트 폰트입니다.
 * @param {string[]} options.loadingNoticeLines - 안내 문구 줄 목록입니다.
 * @param {number} options.loadingNoticeStartY - 안내 문구 시작 Y 좌표입니다.
 * @param {number} options.loadingNoticeLineHeight - 안내 문구 줄 높이입니다.
 * @param {string} options.loadingNoticeFont - 안내 문구 폰트입니다.
 */
export function drawTitleLoadingText({
    loadingTextAlpha,
    loadingNoticeAlpha,
    loadingTextExitDistance,
    loadingTextExitProgress,
    loadingTextX,
    loadingTextY,
    loadingTextFont,
    loadingNoticeLines,
    loadingNoticeStartY,
    loadingNoticeLineHeight,
    loadingNoticeFont
}) {
    const textAlpha = clampFiniteNumber(Number(loadingTextAlpha), 0, 1, 0);
    const noticeAlpha = clampFiniteNumber(Number(loadingNoticeAlpha), 0, 1, 0);
    if (textAlpha <= 0 && noticeAlpha <= 0) {
        return;
    }

    const fill = getLoadingTextColor();
    const textX = resolveFiniteNumber(Number(loadingTextX), 0);
    const textY = resolveFiniteNumber(Number(loadingTextY), 0);
    const noticeStartY = resolveFiniteNumber(Number(loadingNoticeStartY), textY);
    const translateY = clampFiniteNumber(Number(loadingTextExitDistance), 0, Infinity, 0)
        * clampFiniteNumber(Number(loadingTextExitProgress), 0, 1, 0);
    if (textAlpha > 0) {
        render('ui', {
            shape: 'text',
            text: getLangString('title_loading'),
            x: textX,
            y: textY - translateY,
            font: loadingTextFont,
            fill,
            align: 'center',
            baseline: 'middle',
            alpha: textAlpha
        });
    }

    if (noticeAlpha <= 0) {
        return;
    }

    const noticeLines = Array.isArray(loadingNoticeLines) ? loadingNoticeLines : [];
    const lineHeight = clampFiniteNumber(Number(loadingNoticeLineHeight), 0, Infinity, 0);
    for (let i = 0; i < noticeLines.length; i++) {
        render('ui', {
            shape: 'text',
            text: noticeLines[i],
            x: textX,
            y: noticeStartY + (lineHeight * i),
            font: loadingNoticeFont,
            fill,
            align: 'center',
            baseline: 'middle',
            alpha: noticeAlpha
        });
    }
}
