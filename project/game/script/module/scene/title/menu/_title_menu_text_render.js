import { wrapTextByWords } from 'util/font_util.js';

/** @type {WeakMap<CanvasRenderingContext2D, Map<string, Array<{font:string, maxWidth:number, lines:string[]}>>>} */
let wrappedTextCacheByContext = new WeakMap();
const MAX_WRAPPED_TEXT_VARIANTS_PER_TEXT = 8;
let observedFontSet = null;
let observedFontSetStatus = '';

/**
 * 폭 제한에 맞춰 텍스트를 줄바꿈해 그립니다.
 * @param {CanvasRenderingContext2D} context - 대상 컨텍스트입니다.
 * @param {object} options - 텍스트 렌더 옵션입니다.
 * @returns {void} 텍스트를 렌더링만 합니다.
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

    const lines = _getWrappedTitleMenuTextLines(context, text, options.font, options.maxWidth);
    let currentY = options.y;

    for (const line of lines) {
        if (line) {
            context.fillText(line, options.x, currentY);
        }
        currentY += options.lineHeight;
    }

    context.restore();
}

/**
 * 같은 Canvas context·문자열·폰트·폭의 줄바꿈 결과를 재사용합니다.
 * @param {CanvasRenderingContext2D} context - 텍스트 폭을 측정할 컨텍스트입니다.
 * @param {string} text - 앞뒤 공백이 제거된 텍스트입니다.
 * @param {string} font - 현재 Canvas font 문자열입니다.
 * @param {number} maxWidth - 한 줄의 최대 폭입니다.
 * @returns {string[]} 줄바꿈된 문자열 목록입니다.
 */
function _getWrappedTitleMenuTextLines(context, text, font, maxWidth) {
    if (!_canReuseWrappedTitleMenuText()) {
        return _wrapTitleMenuTextLines(context, text, maxWidth);
    }

    let contextCache = wrappedTextCacheByContext.get(context);
    if (!contextCache) {
        contextCache = new Map();
        wrappedTextCacheByContext.set(context, contextCache);
    }

    let textEntries = contextCache.get(text);
    if (!textEntries) {
        textEntries = [];
        contextCache.set(text, textEntries);
    }

    for (let index = 0; index < textEntries.length; index++) {
        const entry = textEntries[index];
        if (entry.font === font && entry.maxWidth === maxWidth) {
            return entry.lines;
        }
    }

    const lines = _wrapTitleMenuTextLines(context, text, maxWidth);
    if (textEntries.length >= MAX_WRAPPED_TEXT_VARIANTS_PER_TEXT) {
        textEntries.shift();
    }
    textEntries.push({ font, maxWidth, lines });
    return lines;
}

/**
 * 웹폰트 로딩 상태가 바뀌면 이전 폭 측정 결과를 폐기합니다.
 * @returns {boolean} 현재 줄바꿈 결과를 캐시해도 되는지 여부입니다.
 */
function _canReuseWrappedTitleMenuText() {
    const fontSet = typeof document === 'object' ? document.fonts : null;
    if (!fontSet) {
        return true;
    }

    const fontSetStatus = fontSet.status;
    if (fontSet !== observedFontSet || fontSetStatus !== observedFontSetStatus) {
        wrappedTextCacheByContext = new WeakMap();
        observedFontSet = fontSet;
        observedFontSetStatus = fontSetStatus;
    }
    return fontSetStatus === 'loaded';
}

/**
 * 공용 단어 줄바꿈 로직으로 텍스트 줄 목록을 계산합니다.
 * @param {CanvasRenderingContext2D} context - 텍스트 폭을 측정할 컨텍스트입니다.
 * @param {string} text - 줄바꿈할 텍스트입니다.
 * @param {number} maxWidth - 한 줄의 최대 폭입니다.
 * @returns {string[]} 줄바꿈된 문자열 목록입니다.
 */
function _wrapTitleMenuTextLines(context, text, maxWidth) {
    return wrapTextByWords(text, {
        maxWidth,
        measureWidth: (line) => context.measureText(line).width,
        preserveEmptyLines: true,
        trimText: true
    });
}
