import { getData } from 'data/data_handler.js';
import {
    getDisplaySystem,
    getWH,
    getWW,
    measureText,
    render
} from 'display/display_system.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { getDelta } from 'game/time_handler.js';
import { getMouseInput } from 'input/input_system.js';
import { getSetting } from 'save/save_system.js';
import { parseUIData } from 'ui/layout/_positioning_handler.js';

const TEXT_CONSTANTS = getData('TEXT_CONSTANTS');
const TOOLTIP_CONSTANTS = getData('TOOLTIP_CONSTANTS');
const TOOLTIP_FADE_DURATION_SECONDS = 0.2;

/**
 * @class UITooltipSystem
 * @description 마우스 hover에 반응하는 비인터랙티브 툴팁을 단일 2D surface로 렌더링합니다.
 */
export class UITooltipSystem {
    constructor() {
        this.displaySystem = null;
        this.surface = null;
        this.layer = null;
        this.frameToken = 0;
        this.requestFrameToken = -1;
        this.requestContent = null;
        this.requestContentKey = '';
        this.hoverElapsed = 0;
        this.lastRequestFrameToken = -1;
        this.lastRequestContentKey = '';
        this.displayContent = null;
        this.displayContentKey = '';
        this.displayAlpha = 0;
    }

    /**
     * 툴팁용 surface를 초기화합니다.
     * @returns {Promise<void>}
     */
    async init() {
        this.displaySystem = getDisplaySystem();
        if (!this.displaySystem) {
            return;
        }

        this.surface = this.displaySystem.createDynamicSurface({
            type: '2d',
            order: TOOLTIP_CONSTANTS.SURFACE_ORDER,
            includeInComposite: false
        });
        this.layer = this.surface.id;
    }

    /**
     * 현재 프레임에서 받을 툴팁 요청 토큰을 갱신합니다.
     */
    beginFrame() {
        this.frameToken += 1;
        this.requestFrameToken = -1;
        this.requestContent = null;
        this.requestContentKey = '';
    }

    /**
     * 현재 프레임의 툴팁 표시 요청을 등록합니다.
     * @param {string|string[]|object|null|undefined} content - 표시할 툴팁 콘텐츠입니다.
     */
    request(content) {
        const normalizedContent = this._normalizeContent(content);
        if (!normalizedContent) {
            return;
        }

        this.requestContent = normalizedContent;
        this.requestContentKey = this.#buildContentKey(normalizedContent);
        this.requestFrameToken = this.frameToken;
    }

    /**
     * 현재 표시 요청을 초기화합니다.
     */
    clear() {
        this.requestContent = null;
        this.requestContentKey = '';
        this.requestFrameToken = -1;
        this.#resetHoverTracking();
    }

    /**
     * 현재 프레임의 툴팁을 렌더링합니다.
     */
    draw() {
        if (!this.layer) {
            this.#resetHoverTracking();
            this.displayContent = null;
            this.displayContentKey = '';
            this.displayAlpha = 0;
            return;
        }

        const shouldShowTooltip = this.#shouldShowRequestedTooltip();
        if (shouldShowTooltip) {
            if (this.displayContentKey !== this.requestContentKey) {
                this.displayContent = this.requestContent;
                this.displayContentKey = this.requestContentKey;
            }
            this.displayAlpha = Math.min(1, this.displayAlpha + (getDelta() / TOOLTIP_FADE_DURATION_SECONDS));
        } else {
            this.displayAlpha = Math.max(0, this.displayAlpha - (getDelta() / TOOLTIP_FADE_DURATION_SECONDS));
            if (this.displayAlpha <= 0) {
                this.displayContent = null;
                this.displayContentKey = '';
            }
        }

        if (!this.displayContent || this.displayAlpha <= 0) {
            return;
        }

        const layout = this._buildTooltipLayout(this.displayContent);
        if (!layout) {
            return;
        }

        render(this.layer, {
            shape: 'roundRect',
            x: layout.x,
            y: layout.y,
            w: layout.w,
            h: layout.h,
            radius: layout.radius,
            fill: ColorSchemes.Overlay.Panel.Background,
            alpha: this.displayAlpha
        });
        render(this.layer, {
            shape: 'roundRect',
            x: layout.x,
            y: layout.y,
            w: layout.w,
            h: layout.h,
            radius: layout.radius,
            fill: false,
            stroke: TOOLTIP_CONSTANTS.BORDER_COLOR,
            lineWidth: TOOLTIP_CONSTANTS.BORDER_WIDTH,
            alpha: this.displayAlpha
        });

        for (const titleLine of layout.titleLines) {
            render(this.layer, {
                shape: 'text',
                text: titleLine.text,
                x: titleLine.x,
                y: titleLine.y,
                font: titleLine.font,
                fill: titleLine.fill,
                align: 'left',
                baseline: 'top',
                alpha: this.displayAlpha
            });
        }

        for (const bodyLine of layout.bodyLines) {
            render(this.layer, {
                shape: 'text',
                text: bodyLine.text,
                x: bodyLine.x,
                y: bodyLine.y,
                font: bodyLine.font,
                fill: bodyLine.fill,
                align: 'left',
                baseline: 'top',
                alpha: this.displayAlpha
            });
        }
    }

    /**
     * 툴팁 surface를 해제합니다.
     */
    destroy() {
        if (!this.displaySystem || !this.surface?.id) {
            return;
        }

        this.displaySystem.releaseDynamicSurface(this.surface.id);
        this.surface = null;
        this.layer = null;
        this.#resetHoverTracking();
    }

    /**
     * @protected
     * 입력 콘텐츠를 정규화된 툴팁 데이터로 변환합니다.
     * @param {string|string[]|object|null|undefined} content - 원본 콘텐츠입니다.
     * @returns {{title: string, lines: string[], maxWidth: number|null}|null} 정규화 결과입니다.
     */
    _normalizeContent(content) {
        if (content === null || content === undefined || content === false) {
            return null;
        }

        if (typeof content === 'string') {
            const text = content.trim();
            if (!text) {
                return null;
            }
            return {
                title: '',
                lines: [text],
                maxWidth: null
            };
        }

        if (Array.isArray(content)) {
            const lines = content
                .map((line) => `${line ?? ''}`.trim())
                .filter((line) => line.length > 0);
            if (lines.length === 0) {
                return null;
            }
            return {
                title: '',
                lines,
                maxWidth: null
            };
        }

        if (typeof content !== 'object') {
            return null;
        }

        const title = typeof content.title === 'string' ? content.title.trim() : '';
        const explicitLines = Array.isArray(content.lines)
            ? content.lines.map((line) => `${line ?? ''}`.trim()).filter((line) => line.length > 0)
            : [];
        const textLines = typeof content.text === 'string'
            ? content.text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
            : [];
        const lines = [...explicitLines, ...textLines];

        if (!title && lines.length === 0) {
            return null;
        }

        return {
            title,
            lines,
            maxWidth: this.#resolveMaxWidth(content.maxWidth)
        };
    }

    /**
     * @private
     * 현재 설정 기준 툴팁 표시 지연 시간을 반환합니다.
     * @returns {number} 초 단위 지연 시간입니다.
     */
    #getTooltipDelaySeconds() {
        const delaySeconds = Number(getSetting('tooltipDelaySeconds'));
        if (!Number.isFinite(delaySeconds)) {
            return 0.7;
        }

        return Math.max(0, delaySeconds);
    }

    /**
     * @private
     * 현재 프레임 요청이 실제 표시 조건을 만족하는지 판정합니다.
     * @returns {boolean} 툴팁을 보여줄 수 있으면 true입니다.
     */
    #shouldShowRequestedTooltip() {
        if (this.requestFrameToken !== this.frameToken || !this.requestContent) {
            this.#resetHoverTracking();
            return false;
        }

        this.#updateHoverElapsed();
        return this.hoverElapsed >= this.#getTooltipDelaySeconds();
    }

    /**
     * @private
     * 현재 프레임 요청이 직전 프레임과 같은 툴팁인지 판정하고 hover 시간을 갱신합니다.
     */
    #updateHoverElapsed() {
        const isContinuousRequest = this.lastRequestFrameToken === this.frameToken - 1
            && this.lastRequestContentKey === this.requestContentKey;

        this.hoverElapsed = isContinuousRequest
            ? this.hoverElapsed + getDelta()
            : 0;
        this.lastRequestFrameToken = this.frameToken;
        this.lastRequestContentKey = this.requestContentKey;
    }

    /**
     * @private
     * 툴팁 hover 누적 상태를 초기화합니다.
     */
    #resetHoverTracking() {
        this.hoverElapsed = 0;
        this.lastRequestFrameToken = -1;
        this.lastRequestContentKey = '';
    }

    /**
     * @private
     * 동일한 콘텐츠 연속 요청을 판정하기 위한 키를 생성합니다.
     * @param {{title: string, lines: string[], maxWidth: number|null}} content - 정규화된 툴팁 콘텐츠입니다.
     * @returns {string} 비교용 문자열 키입니다.
     */
    #buildContentKey(content) {
        return JSON.stringify([
            content.title,
            content.lines,
            content.maxWidth
        ]);
    }

    /**
     * @private
     * 툴팁의 실제 렌더 레이아웃을 계산합니다.
     * @param {{title: string, lines: string[], maxWidth: number|null}} content - 정규화된 툴팁 콘텐츠입니다.
     * @returns {object|null} 렌더 레이아웃입니다.
     */
    _buildTooltipLayout(content) {
        const uiScale = getSetting('uiScale') / 100 || 1;
        const titleFont = this.#buildFontString(TEXT_CONSTANTS.H6_BOLD.FONT, uiScale);
        const bodyFont = this.#buildFontString(TEXT_CONSTANTS.H6.FONT, uiScale);
        const titleFontSize = this.#getFontSize(TEXT_CONSTANTS.H6_BOLD.FONT, uiScale);
        const bodyFontSize = this.#getFontSize(TEXT_CONSTANTS.H6.FONT, uiScale);
        const titleLineHeight = this.#getLineHeight(TEXT_CONSTANTS.H6_BOLD.FONT, uiScale);
        const bodyLineHeight = this.#getLineHeight(TEXT_CONSTANTS.H6.FONT, uiScale);
        const paddingX = parseUIData(TOOLTIP_CONSTANTS.PADDING_X, uiScale);
        const paddingY = parseUIData(TOOLTIP_CONSTANTS.PADDING_Y, uiScale);
        const titleGap = parseUIData(TOOLTIP_CONSTANTS.TITLE_GAP, uiScale);
        const bodyLineGap = parseUIData(TOOLTIP_CONSTANTS.BODY_LINE_GAP, uiScale);
        const radius = parseUIData(TOOLTIP_CONSTANTS.PANEL_RADIUS, uiScale);
        const offsetX = parseUIData(TOOLTIP_CONSTANTS.OFFSET_X, uiScale);
        const screenMargin = parseUIData(TOOLTIP_CONSTANTS.SCREEN_MARGIN, uiScale);
        const defaultMaxWidth = parseUIData(TOOLTIP_CONSTANTS.MAX_WIDTH, uiScale);
        const maxTextWidth = Math.max(1, content.maxWidth || defaultMaxWidth);
        const titleTexts = content.title
            ? this.#wrapText(content.title, titleFont, maxTextWidth)
            : [];
        const bodyTexts = [];

        for (const line of content.lines) {
            const wrappedLines = this.#wrapText(line, bodyFont, maxTextWidth);
            for (const wrappedLine of wrappedLines) {
                bodyTexts.push(wrappedLine);
                if (bodyTexts.length >= TOOLTIP_CONSTANTS.MAX_LINES) {
                    break;
                }
            }

            if (bodyTexts.length >= TOOLTIP_CONSTANTS.MAX_LINES) {
                break;
            }
        }

        if (titleTexts.length === 0 && bodyTexts.length === 0) {
            return null;
        }

        let contentWidth = 0;
        for (const titleText of titleTexts) {
            contentWidth = Math.max(contentWidth, measureText(titleText, titleFont));
        }
        for (const bodyText of bodyTexts) {
            contentWidth = Math.max(contentWidth, measureText(bodyText, bodyFont));
        }

        const panelWidth = Math.max(1, contentWidth + (paddingX * 2));
        let panelHeight = paddingY * 2;
        if (titleTexts.length > 0) {
            panelHeight += this.#getTextBlockHeight(titleTexts.length, titleFontSize, titleLineHeight);
        }
        if (titleTexts.length > 0 && bodyTexts.length > 0) {
            panelHeight += titleGap;
        }
        if (bodyTexts.length > 0) {
            panelHeight += this.#getTextBlockHeight(bodyTexts.length, bodyFontSize, bodyLineHeight + bodyLineGap);
        }

        const mouseX = getMouseInput('x');
        const mouseY = getMouseInput('y');
        const screenW = getWW();
        const screenH = getWH();
        const x = Math.max(
            screenMargin,
            Math.min((mouseX || 0) + offsetX, screenW - panelWidth - screenMargin)
        );
        const y = Math.max(
            screenMargin,
            Math.min((mouseY || 0) - panelHeight, screenH - panelHeight - screenMargin)
        );

        const titleLines = [];
        const bodyLines = [];
        let cursorY = y + paddingY;

        for (let index = 0; index < titleTexts.length; index += 1) {
            const titleText = titleTexts[index];
            titleLines.push({
                text: titleText,
                x: x + paddingX,
                y: cursorY,
                font: titleFont,
                fill: ColorSchemes.Overlay.Text.Control || ColorSchemes.Title.TextDark
            });
            if (index < titleTexts.length - 1) {
                cursorY += titleLineHeight;
            } else {
                cursorY += titleFontSize;
            }
        }

        if (titleTexts.length > 0 && bodyTexts.length > 0) {
            cursorY += titleGap;
        }

        for (let index = 0; index < bodyTexts.length; index += 1) {
            bodyLines.push({
                text: bodyTexts[index],
                x: x + paddingX,
                y: cursorY,
                font: bodyFont,
                fill: ColorSchemes.Overlay.Text.Item
            });
            if (index < bodyTexts.length - 1) {
                cursorY += bodyLineHeight + bodyLineGap;
            } else {
                cursorY += bodyFontSize;
            }
        }

        return {
            x,
            y,
            w: panelWidth,
            h: panelHeight,
            radius,
            titleLines,
            bodyLines
        };
    }

    /**
     * @private
     * 텍스트 프리셋으로부터 실제 폰트 문자열을 구성합니다.
     * @param {{SIZE: object, WEIGHT: number, FAMILY: string}} fontPreset - 폰트 프리셋입니다.
     * @param {number} uiScale - 현재 UI 스케일입니다.
     * @returns {string} 폰트 문자열입니다.
     */
    #buildFontString(fontPreset, uiScale) {
        const fontSize = parseUIData(fontPreset.SIZE, uiScale);
        return `${fontPreset.WEIGHT} ${fontSize}px ${fontPreset.FAMILY}`;
    }

    /**
     * @private
     * 텍스트 프리셋의 줄 높이를 계산합니다.
     * @param {{SIZE: object}} fontPreset - 폰트 프리셋입니다.
     * @param {number} uiScale - 현재 UI 스케일입니다.
     * @returns {number} 줄 높이입니다.
     */
    #getLineHeight(fontPreset, uiScale) {
        return this.#getFontSize(fontPreset, uiScale) * TOOLTIP_CONSTANTS.LINE_HEIGHT_MULTIPLIER;
    }

    /**
     * @private
     * 텍스트 프리셋의 실제 폰트 크기를 계산합니다.
     * @param {{SIZE: object}} fontPreset - 폰트 프리셋입니다.
     * @param {number} uiScale - 현재 UI 스케일입니다.
     * @returns {number} 폰트 크기입니다.
     */
    #getFontSize(fontPreset, uiScale) {
        return parseUIData(fontPreset.SIZE, uiScale);
    }

    /**
     * @private
     * 여러 줄 텍스트 블록의 실제 렌더 높이를 계산합니다.
     * 마지막 줄 뒤에는 추가 leading을 남기지 않습니다.
     * @param {number} lineCount - 줄 수입니다.
     * @param {number} fontSize - 폰트 크기입니다.
     * @param {number} lineAdvance - 다음 줄 시작점까지의 간격입니다.
     * @returns {number} 텍스트 블록 높이입니다.
     */
    #getTextBlockHeight(lineCount, fontSize, lineAdvance) {
        if (lineCount <= 0) {
            return 0;
        }

        return fontSize + (Math.max(0, lineCount - 1) * lineAdvance);
    }

    /**
     * @private
     * 문자열을 최대 폭 기준으로 줄바꿈합니다.
     * @param {string} text - 원본 문자열입니다.
     * @param {string} font - 측정에 사용할 폰트입니다.
     * @param {number} maxWidth - 허용 최대 폭입니다.
     * @returns {string[]} 줄바꿈된 문자열 배열입니다.
     */
    #wrapText(text, font, maxWidth) {
        const normalizedText = `${text ?? ''}`.replace(/\r/g, '');
        if (!normalizedText) {
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
                if (currentLine && measureText(candidate, font) > maxWidth) {
                    wrappedLines.push(currentLine.trimEnd());
                    currentLine = character.trimStart ? character.trimStart() : character;
                    continue;
                }
                currentLine = candidate;
            }

            if (currentLine.trim().length > 0) {
                wrappedLines.push(currentLine.trimEnd());
            }
        }

        return wrappedLines;
    }

    /**
     * @private
     * 사용자 지정 최대 폭 값을 실제 픽셀 값으로 변환합니다.
     * @param {number|string|object|undefined} maxWidth - 사용자 지정 최대 폭입니다.
     * @returns {number|null} 변환된 최대 폭입니다.
     */
    #resolveMaxWidth(maxWidth) {
        if (maxWidth === null || maxWidth === undefined) {
            return null;
        }

        if (typeof maxWidth === 'number' && Number.isFinite(maxWidth)) {
            return maxWidth;
        }

        const uiScale = getSetting('uiScale') / 100 || 1;
        if (typeof maxWidth === 'string' || typeof maxWidth === 'object') {
            return parseUIData(maxWidth, uiScale);
        }

        return null;
    }
}
