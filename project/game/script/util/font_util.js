const DEFAULT_FONT_FAMILY = 'Pretendard Variable, arial';
const DEFAULT_FONT_WEIGHT = 400;
const DEFAULT_FONT_SIZE_PX = 12;

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
 * 텍스트 프리셋 데이터에서 Canvas font 속성 문자열을 생성합니다.
 * @param {object} presetData - 텍스트 프리셋 데이터입니다.
 * @param {object} [options={}] - 프리셋 해석 옵션입니다.
 * @param {object} [options.fallbackData] - 프리셋 누락 시 사용할 폴백 데이터입니다.
 * @param {string|number} [options.defaultWeight=DEFAULT_FONT_WEIGHT] - 기본 폰트 두께입니다.
 * @param {string} [options.defaultFamily=DEFAULT_FONT_FAMILY] - 기본 폰트 패밀리입니다.
 * @param {(sizeData: object) => number} [options.resolveSizePx] - SIZE 데이터를 실제 픽셀 값으로 변환하는 함수입니다.
 * @returns {string} Canvas font 속성 문자열입니다.
 */
export function createFontStringFromPreset(presetData, options = {}) {
    const fallbackFontData = options.fallbackData?.FONT || {};
    const fontData = presetData?.FONT || fallbackFontData;
    const sizeData = fontData.SIZE || fallbackFontData.SIZE || {};
    const sizePx = typeof options.resolveSizePx === 'function'
        ? options.resolveSizePx(sizeData)
        : (Number.isFinite(sizeData.VALUE) ? sizeData.VALUE : DEFAULT_FONT_SIZE_PX);

    return createFontString({
        sizePx,
        weight: fontData.WEIGHT || fallbackFontData.WEIGHT || options.defaultWeight || DEFAULT_FONT_WEIGHT,
        family: fontData.FAMILY || fallbackFontData.FAMILY || options.defaultFamily || DEFAULT_FONT_FAMILY
    });
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
