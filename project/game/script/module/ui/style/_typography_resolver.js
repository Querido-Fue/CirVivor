import { createFontString } from 'util/font_util.js';
import {
    TYPOGRAPHY,
    getTypographyTokenName,
    isTypographyToken
} from './typography.js';

const DEFAULT_FONT_FAMILY = 'Pretendard Variable, arial';
const TITLE_CARD_FLUID_POLICY = 'title-card-fluid';
const DEFAULT_UI_SCALE = 1;

/**
 * 타이포그래피 정의에서 사용하는 반응형 크기 값을 생성합니다.
 * @param {string} base - 크기 기준 단위입니다.
 * @param {number} value - 단위 기준 비율 값입니다.
 * @returns {{BASE:string, VALUE:number}} 동결된 크기 값입니다.
 */
function createMetric(base, value) {
    return Object.freeze({ BASE: base, VALUE: value });
}

/**
 * 일반 타이포그래피 정의를 생성합니다.
 * @param {number} sizeValue - WW 기준 크기입니다.
 * @param {number} weight - 폰트 굵기입니다.
 * @param {number} [lineHeight=1] - 폰트 크기 대비 줄 높이입니다.
 * @returns {object} 동결된 타이포그래피 정의입니다.
 */
function createDefinition(sizeValue, weight, lineHeight = 1) {
    return Object.freeze({
        size: createMetric('WW', sizeValue),
        weight,
        family: DEFAULT_FONT_FAMILY,
        lineHeight
    });
}

/**
 * 컨테이너 크기에 반응하는 타이포그래피 정의를 생성합니다.
 * @param {string} policy - 내부 크기 결정 정책입니다.
 * @param {number} weight - 폰트 굵기입니다.
 * @param {number} lineHeight - 폰트 크기 대비 줄 높이입니다.
 * @returns {object} 동결된 타이포그래피 정의입니다.
 */
function createFluidDefinition(policy, weight, lineHeight) {
    return Object.freeze({
        policy,
        weight,
        family: DEFAULT_FONT_FAMILY,
        lineHeight
    });
}

const TYPOGRAPHY_DEFINITIONS = new Map([
    [TYPOGRAPHY.H1, createDefinition(2, 700)],
    [TYPOGRAPHY.H2, createDefinition(1.6, 600)],
    [TYPOGRAPHY.H3, createDefinition(1.3, 400)],
    [TYPOGRAPHY.H4, createDefinition(1.1, 300)],
    [TYPOGRAPHY.H5, createDefinition(1, 300)],
    [TYPOGRAPHY.H6, createDefinition(0.85, 300)],
    [TYPOGRAPHY.PROGRESS_VALUE, createDefinition(1.1, 700)],
    [TYPOGRAPHY.LABEL, createDefinition(1, 700)],
    [TYPOGRAPHY.CONTROL, createDefinition(0.85, 700)],
    [TYPOGRAPHY.SETTINGS_DESCRIPTION, createDefinition(0.9, 300)],
    [TYPOGRAPHY.SLIDER_VALUE, createDefinition(0.9, 400)],
    [TYPOGRAPHY.BUTTON_PRIMARY, createDefinition(1, 600)],
    [TYPOGRAPHY.BUTTON_LINK, createDefinition(0.8, 500)],
    [TYPOGRAPHY.LINK_PREVIEW, createDefinition(1, 700)],
    [TYPOGRAPHY.DISPLAY_ICON, createDefinition(4, 400)],
    [TYPOGRAPHY.TOOLTIP_TITLE, createDefinition(0.85, 700, 1.35)],
    [TYPOGRAPHY.TOOLTIP_BODY, createDefinition(0.85, 300, 1.35)],
    [TYPOGRAPHY.CARD_TITLE, createFluidDefinition(TITLE_CARD_FLUID_POLICY, 700, 1.06)],
    [TYPOGRAPHY.CARD_DESCRIPTION, createDefinition(0.85, 500, 1.32)],
    [TYPOGRAPHY.BENTO_HERO_TITLE, createDefinition(1.534, 700)],
    [TYPOGRAPHY.BENTO_HERO_DESCRIPTION, createDefinition(0.884, 300, 1.35)],
    [TYPOGRAPHY.BENTO_COMPACT_TITLE, createDefinition(1.04, 700)],
    [TYPOGRAPHY.BENTO_CARD_TITLE, createDefinition(1.188, 700)],
    [TYPOGRAPHY.BENTO_CARD_DESCRIPTION, createDefinition(0.952, 300, 1.35)]
]);

/**
 * uiScale 값을 안전한 양수 배율로 정규화합니다.
 * @param {number} uiScale - 원본 UI 배율입니다.
 * @returns {number} 정규화된 UI 배율입니다.
 */
function normalizeUiScale(uiScale) {
    return Number.isFinite(uiScale) && uiScale > 0
        ? uiScale
        : DEFAULT_UI_SCALE;
}

/**
 * 일반 반응형 크기 정의를 실제 픽셀 값으로 변환합니다.
 * @param {{BASE:string, VALUE:number}} metric - 변환할 크기 정의입니다.
 * @param {object} options - resolver 옵션입니다.
 * @returns {number} 픽셀 크기입니다.
 */
function resolveMetric(metric, options) {
    if (typeof options.resolveMetric === 'function') {
        return options.resolveMetric(metric);
    }

    const uiScale = normalizeUiScale(options.uiScale);
    if (metric.BASE === 'WW') {
        return (metric.VALUE / 100) * (Number.isFinite(options.uiWidth) ? options.uiWidth : 0) * uiScale;
    }
    if (metric.BASE === 'WH') {
        return (metric.VALUE / 100) * (Number.isFinite(options.uiHeight) ? options.uiHeight : 0) * uiScale;
    }
    if (metric.BASE === 'absolute') {
        return metric.VALUE * uiScale;
    }

    throw new RangeError(`지원하지 않는 타이포그래피 크기 단위입니다: ${metric.BASE}`);
}

/**
 * 타이틀 카드의 기존 반응형 제목 크기 정책을 중앙에서 계산합니다.
 * @param {object} options - resolver 옵션입니다.
 * @returns {number} 픽셀 크기입니다.
 */
function resolveTitleCardFontSize(options) {
    const uiScale = normalizeUiScale(options.uiScale);
    const width = Number.isFinite(options.containerWidth) ? Math.max(0, options.containerWidth) : 0;
    const height = Number.isFinite(options.containerHeight) ? Math.max(0, options.containerHeight) : 0;
    const panelRatio = height > width * 0.7 ? 0.095 : 0.08;
    const compactHorizontalSize = options.variant === 'compact-horizontal'
        ? height * 0.28
        : 0;

    return Math.max(16 * uiScale, width * panelRatio, compactHorizontalSize);
}

/**
 * 정의에 맞는 실제 폰트 크기를 계산합니다.
 * @param {object} definition - 내부 타이포그래피 정의입니다.
 * @param {object} options - resolver 옵션입니다.
 * @returns {number} 픽셀 크기입니다.
 */
function resolveFontSize(definition, options) {
    if (definition.policy === TITLE_CARD_FLUID_POLICY) {
        return resolveTitleCardFontSize(options);
    }
    return resolveMetric(definition.size, options);
}

/**
 * 승인된 타이포그래피 토큰을 Canvas 렌더링 메트릭으로 변환합니다.
 * feature 코드에서는 토큰만 전달하고, 실제 수치 접근은 지정된 레이아웃·렌더 adapter로 제한합니다.
 * @param {object} token - `TYPOGRAPHY`의 토큰입니다.
 * @param {object} [options={}] - 크기 해석 문맥입니다.
 * @param {(metric: object) => number} [options.resolveMetric] - 반응형 크기를 픽셀로 바꾸는 함수입니다.
 * @param {number} [options.uiWidth=0] - WW 계산용 UI 기준 너비입니다.
 * @param {number} [options.uiHeight=0] - WH 계산용 UI 기준 높이입니다.
 * @param {number} [options.uiScale=1] - UI 배율입니다.
 * @param {number} [options.containerWidth=0] - fluid 정책용 컨테이너 너비입니다.
 * @param {number} [options.containerHeight=0] - fluid 정책용 컨테이너 높이입니다.
 * @param {string} [options.variant] - fluid 정책 변형입니다.
 * @returns {{token:object,name:string,font:string,size:number,lineHeight:number,weight:number,family:string}} 동결된 메트릭입니다.
 */
export function resolveTypography(token, options = {}) {
    if (!isTypographyToken(token)) {
        throw new TypeError('resolveTypography()에는 TYPOGRAPHY 토큰만 전달할 수 있습니다.');
    }

    const definition = TYPOGRAPHY_DEFINITIONS.get(token);
    if (!definition) {
        throw new RangeError(`정의되지 않은 타이포그래피 토큰입니다: ${getTypographyTokenName(token)}`);
    }

    const size = resolveFontSize(definition, options);
    if (!Number.isFinite(size) || size <= 0) {
        throw new RangeError(`${getTypographyTokenName(token)} 타이포그래피 크기는 양의 유한수여야 합니다.`);
    }

    const lineHeight = size * definition.lineHeight;
    return Object.freeze({
        token,
        name: getTypographyTokenName(token),
        font: createFontString({
            weight: definition.weight,
            sizePx: size,
            family: definition.family
        }),
        size,
        lineHeight,
        weight: definition.weight,
        family: definition.family
    });
}
