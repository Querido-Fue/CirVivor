export const DEFAULT_FONT_FAMILY = 'SUIT Variable, arial';
const DEFAULT_FONT_SIZE_PX = 12;
const VERTICAL_METRIC_BASELINES = Object.freeze(new Set(['top', 'middle']));
const FONT_SIZE_PATTERN = /(?:^|\s)(\d+(?:\.\d+)?)px(?:\s|\/)/;
const FONT_METRIC_SAMPLE_TEXT = '가';
const MAX_VERTICAL_METRIC_OFFSETS_PER_CONTEXT = 256;
let verticalMetricOffsetCacheByContext = new WeakMap();
let observedFontSet = null;
let observedFontSetStatus = '';

/**
 * 줄바꿈 최대 줄 수 옵션을 안전한 정수로 정규화합니다.
 * @param {number|undefined} maxLines - 최대 줄 수 옵션입니다.
 * @returns {number} 정규화된 최대 줄 수입니다.
 */
function resolveMaxLines(maxLines) {
    if (!Number.isFinite(maxLines)) {
        return Infinity;
    }

    return Math.max(0, Math.floor(maxLines));
}

/**
 * 측정 콜백 결과를 안전한 폭 값으로 정규화합니다.
 * @param {(text: string) => number} measureWidth - 텍스트 폭 측정 콜백입니다.
 * @param {string} text - 측정할 문자열입니다.
 * @returns {number} 정규화된 폭 값입니다.
 */
function getMeasuredWidth(measureWidth, text) {
    const width = measureWidth(text);
    return Number.isFinite(width) ? width : 0;
}

/**
 * Canvas 폰트 문자열에서 공백이 포함된 첫 번째 폰트 패밀리를 따옴표로 감쌉니다.
 * @param {string} [fontFamily=DEFAULT_FONT_FAMILY] - 정규화할 폰트 패밀리 문자열입니다.
 * @returns {string} Canvas 폰트 문자열에 사용할 수 있는 패밀리 문자열입니다.
 */
export function normalizeFontFamily(fontFamily = DEFAULT_FONT_FAMILY) {
    let familyStr = String(fontFamily || DEFAULT_FONT_FAMILY);
    if (!familyStr.includes('"') && !familyStr.includes("'")) {
        const parts = familyStr.split(',');
        const primaryFamily = parts[0].trim();
        const fallbackFamilies = parts.slice(1).map((part) => part.trim()).filter(Boolean);
        const normalizedPrimaryFamily = /\s/.test(primaryFamily)
            ? `"${primaryFamily}"`
            : primaryFamily;
        familyStr = [normalizedPrimaryFamily, ...fallbackFamilies].join(', ');
    }
    return familyStr;
}

/**
 * Canvas 2D에서 사용할 font 속성 문자열을 생성합니다.
 * @param {{weight?: string|number, sizePx?: number, family?: string}} [options={}] - 폰트 문자열 구성 옵션입니다.
 * @returns {string} Canvas font 속성 문자열입니다.
 */
export function createFontString(options = {}) {
    const sizePx = Number.isFinite(options.sizePx) ? options.sizePx : DEFAULT_FONT_SIZE_PX;
    const weight = options.weight !== undefined && options.weight !== null
        ? `${options.weight}`.trim()
        : '';
    const weightPrefix = weight
        ? `${weight} `
        : '';
    return `${weightPrefix}${sizePx}px ${normalizeFontFamily(options.family || DEFAULT_FONT_FAMILY)}`;
}

/**
 * Canvas 기준선을 폰트가 제공하는 세로 메트릭 중심에 맞춥니다.
 * SUIT처럼 글리프 위아래 여백이 같은 폰트는 별도 픽셀 보정 없이
 * 버튼·아이콘과 같은 시각 중심에 놓입니다.
 * @param {CanvasRenderingContext2D} context - 대상 컨텍스트입니다.
 * @param {string|undefined} requestedBaseline - 렌더 명령이 요청한 기준선입니다.
 * @returns {number} 기존 y 좌표에 더할 메트릭 기반 오프셋입니다.
 */
export function getCanvasTextVerticalMetricOffset(context, requestedBaseline) {
    const baseline = requestedBaseline || context.textBaseline || 'alphabetic';
    if (!VERTICAL_METRIC_BASELINES.has(baseline) || typeof context.measureText !== 'function') {
        return 0;
    }

    const font = String(context.font || '');
    const cacheKey = `${font}\u0000${baseline}`;
    const canCache = canCacheVerticalMetricOffset();
    let contextCache = verticalMetricOffsetCacheByContext.get(context);
    if (canCache && contextCache?.has(cacheKey)) {
        return contextCache.get(cacheKey);
    }

    const offset = measureTextVerticalMetricOffset(context, baseline, font);
    if (canCache) {
        if (!contextCache) {
            contextCache = new Map();
            verticalMetricOffsetCacheByContext.set(context, contextCache);
        }
        // Animated sizes and window resizes produce new font strings on a
        // long-lived canvas. Keep a bounded recent working set per context.
        if (contextCache.size >= MAX_VERTICAL_METRIC_OFFSETS_PER_CONTEXT) {
            contextCache.delete(contextCache.keys().next().value);
        }
        contextCache.set(cacheKey, offset);
    }
    return offset;
}

/**
 * 현재 font와 기준선에서 폰트 박스 중심 오프셋을 측정합니다.
 * @param {CanvasRenderingContext2D} context - 측정 컨텍스트입니다.
 * @param {'top'|'middle'} baseline - 계산할 기준선입니다.
 * @param {string} font - 현재 Canvas font 문자열입니다.
 * @returns {number} 측정된 y 오프셋입니다.
 */
function measureTextVerticalMetricOffset(context, baseline, font) {
    const metrics = context.measureText(FONT_METRIC_SAMPLE_TEXT);
    const ascent = Number(metrics?.fontBoundingBoxAscent);
    const descent = Number(metrics?.fontBoundingBoxDescent);
    if (!Number.isFinite(ascent) || !Number.isFinite(descent)) {
        return 0;
    }

    if (baseline === 'middle') {
        return (ascent - descent) * 0.5;
    }

    const fontSizeMatch = font.match(FONT_SIZE_PATTERN);
    const fontSize = Number(fontSizeMatch?.[1]);
    if (!Number.isFinite(fontSize)) {
        return 0;
    }
    return (fontSize + ascent - descent) * 0.5;
}

/**
 * 웹폰트 로딩 상태가 바뀌면 fallback 폰트로 측정된 캐시를 폐기합니다.
 * @returns {boolean} 현재 측정값을 캐시해도 되는지 여부입니다.
 */
function canCacheVerticalMetricOffset() {
    const fontSet = typeof document === 'object' ? document.fonts : null;
    if (!fontSet) {
        return true;
    }

    const fontSetStatus = fontSet.status;
    if (fontSet !== observedFontSet || fontSetStatus !== observedFontSetStatus) {
        verticalMetricOffsetCacheByContext = new WeakMap();
        observedFontSet = fontSet;
        observedFontSetStatus = fontSetStatus;
    }
    return fontSetStatus === 'loaded';
}

/**
 * 공백 단어 단위로 텍스트를 최대 폭에 맞춰 줄바꿈합니다.
 * @param {string} text - 원본 문자열입니다.
 * @param {object} options - 줄바꿈 옵션입니다.
 * @param {number} options.maxWidth - 허용 최대 폭입니다.
 * @param {(text: string) => number} options.measureWidth - 텍스트 폭 측정 콜백입니다.
 * @param {number} [options.maxLines=Infinity] - 반환할 최대 줄 수입니다.
 * @param {boolean} [options.preserveEmptyLines=false] - 빈 문단을 빈 줄로 유지할지 여부입니다.
 * @param {boolean} [options.trimText=false] - 원본 문자열 앞뒤 공백 제거 여부입니다.
 * @returns {string[]} 줄바꿈된 문자열 배열입니다.
 */
export function wrapTextByWords(text, options) {
    const measureWidth = typeof options?.measureWidth === 'function'
        ? options.measureWidth
        : () => 0;
    const maxWidth = Number.isFinite(options?.maxWidth) ? options.maxWidth : Infinity;
    const maxLines = resolveMaxLines(options?.maxLines);
    const sourceText = options?.trimText
        ? `${text ?? ''}`.trim()
        : `${text ?? ''}`;

    if (!sourceText || maxLines <= 0) {
        return [];
    }

    const lines = [];
    const paragraphs = sourceText.replace(/\r/g, '').split('\n');
    for (const paragraph of paragraphs) {
        const words = paragraph.split(/\s+/).filter(Boolean);
        if (words.length === 0) {
            if (options?.preserveEmptyLines) {
                lines.push('');
            }
            if (lines.length >= maxLines) {
                break;
            }
            continue;
        }

        let line = '';
        for (const word of words) {
            const nextLine = line ? `${line} ${word}` : word;
            if (line && getMeasuredWidth(measureWidth, nextLine) > maxWidth) {
                lines.push(line);
                if (lines.length >= maxLines) {
                    break;
                }
                line = word;
                continue;
            }

            line = nextLine;
        }

        if (line && lines.length < maxLines) {
            lines.push(line);
        }
        if (lines.length >= maxLines) {
            break;
        }
    }

    return lines;
}

/**
 * 문자 단위로 텍스트를 최대 폭에 맞춰 줄바꿈합니다.
 * @param {string} text - 원본 문자열입니다.
 * @param {object} options - 줄바꿈 옵션입니다.
 * @param {number} options.maxWidth - 허용 최대 폭입니다.
 * @param {(text: string) => number} options.measureWidth - 텍스트 폭 측정 콜백입니다.
 * @param {number} [options.maxLines=Infinity] - 반환할 최대 줄 수입니다.
 * @returns {string[]} 줄바꿈된 문자열 배열입니다.
 */
export function wrapTextByCharacters(text, options) {
    const measureWidth = typeof options?.measureWidth === 'function'
        ? options.measureWidth
        : () => 0;
    const maxWidth = Number.isFinite(options?.maxWidth) ? options.maxWidth : Infinity;
    const maxLines = resolveMaxLines(options?.maxLines);
    const normalizedText = `${text ?? ''}`.replace(/\r/g, '');

    if (!normalizedText || maxLines <= 0) {
        return [];
    }

    const wrappedLines = [];
    const sourceLines = normalizedText.split('\n');
    for (const sourceLine of sourceLines) {
        if (!sourceLine) {
            continue;
        }

        let currentLine = '';
        const characters = Array.from(sourceLine);
        for (const character of characters) {
            const candidate = currentLine + character;
            if (currentLine && getMeasuredWidth(measureWidth, candidate) > maxWidth) {
                wrappedLines.push(currentLine.trimEnd());
                if (wrappedLines.length >= maxLines) {
                    break;
                }
                currentLine = character.trimStart();
                continue;
            }
            currentLine = candidate;
        }

        if (wrappedLines.length >= maxLines) {
            break;
        }

        if (currentLine.trim().length > 0) {
            wrappedLines.push(currentLine.trimEnd());
        }
        if (wrappedLines.length >= maxLines) {
            break;
        }
    }

    return wrappedLines;
}

/**
 * 텍스트를 최대 폭 안에 들어가도록 말줄임표로 줄입니다.
 * @param {string} text - 원본 문자열입니다.
 * @param {object} options - 말줄임 옵션입니다.
 * @param {number} options.maxWidth - 허용 최대 폭입니다.
 * @param {(text: string) => number} options.measureWidth - 텍스트 폭 측정 콜백입니다.
 * @param {string} [options.ellipsis='...'] - 말줄임표 문자열입니다.
 * @returns {string} 폭 제한에 맞춘 문자열입니다.
 */
export function truncateTextToWidth(text, options) {
    const raw = `${text ?? ''}`;
    const maxWidth = Number.isFinite(options?.maxWidth) ? options.maxWidth : Infinity;
    const measureWidth = typeof options?.measureWidth === 'function'
        ? options.measureWidth
        : () => 0;
    const ellipsis = options?.ellipsis ?? '...';

    if (maxWidth <= 0 || raw.length === 0) {
        return '';
    }

    if (getMeasuredWidth(measureWidth, raw) <= maxWidth) {
        return raw;
    }

    let end = raw.length;
    while (end > 0) {
        const trimmed = `${raw.slice(0, end)}${ellipsis}`;
        if (getMeasuredWidth(measureWidth, trimmed) <= maxWidth) {
            return trimmed;
        }
        end -= 1;
    }

    return ellipsis;
}
