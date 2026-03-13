import { measureText } from 'display/display_system.js';
import { getData } from 'data/data_handler.js';
import { Icon } from 'ui/element/_icon.js';
import { UIPool } from 'ui/_ui_pool.js';

const TEXT_CONSTANTS = getData('TEXT_CONSTANTS');
const BUTTON_CONSTANTS = getData('BUTTON_CONSTANTS');

/**
 * @class UIElementFactory
 * @description 레이아웃 메타데이터를 실제 UI 요소(버튼, 텍스트, 슬라이더 등)로 변환해 생성합니다.
 */
export class UIElementFactory {
    static _handlers = {
        button: UIElementFactory._createButton,
        text: UIElementFactory._createText,
        slider: UIElementFactory._createSlider,
        toggle: UIElementFactory._createToggle,
        segment_control: UIElementFactory._createSegmentControl,
        dropdown: UIElementFactory._createDropdown,
        line: UIElementFactory._createLine,
        progress_bar: UIElementFactory._createProgressBar
    };

    /**
     * 레이아웃 항목 데이터를 기반으로 실제 요소/객체를 생성합니다.
     * @param {object} item - 팩토리가 생성할 항목의 메타데이터
     * @param {number} x - x 좌표
     * @param {number} y - y 좌표
     * @param {number} parentW - 부모 너비
     * @param {number} parentH - 부모 높이
     * @param {number} forcedW - 강제 너비 (있는 경우)
     * @param {object} layoutHandler - LayoutHandler 인스턴스 (단위 파싱용)
     * @returns {object|null} 생성된 UI 요소
     */
    static create(item, x, y, parentW, parentH, forcedW, layoutHandler) {
        const handler = this._handlers[item.type];
        if (!handler) return null;
        return handler.call(this, item, x, y, parentW, parentH, forcedW, layoutHandler);
    }

    static _createButton(item, x, y, parentW, parentH, forcedW, layoutHandler) {
        const presetData = this._getPresetData(item.preset, BUTTON_CONSTANTS);
        const defaultHeight = layoutHandler.parseUnit(presetData.HEIGHT?.BASE || 'WH', presetData.HEIGHT?.VALUE || 5, parentH);
        const height = this._resolveMetricValue(item.heightObj, {
            layoutHandler,
            parentSize: parentH,
            defaultValue: defaultHeight,
            fillValue: parentH
        });

        const props = {
            parent: layoutHandler.parent,
            layer: layoutHandler.layer,
            x,
            y,
            height,
            onClick: item.props.onClick || (() => { }),
            uiScale: layoutHandler.uiScale,
            ...item.props
        };

        const fontFam = props.font || presetData.FONT?.FAMILY || 'arial';
        const fontWeig = props.fontWeight || presetData.FONT?.WEIGHT || '';
        const fontSiz = props.size || (presetData.FONT
            ? layoutHandler.parseUnit(presetData.FONT.SIZE?.BASE || 'WW', presetData.FONT.SIZE?.VALUE || 1, parentW)
            : 12);

        const align = props.align || presetData.ALIGN || 'center';

        if (presetData.MARGIN) {
            props.margin = layoutHandler.parseUnit(presetData.MARGIN.BASE || 'WW', presetData.MARGIN.VALUE || 0, parentW);
        }
        if (presetData.RADIUS) {
            props.radius = layoutHandler.parseUnit(presetData.RADIUS.BASE || 'WW', presetData.RADIUS.VALUE || 0, parentW);
        }

        this._initializeButtonContentArrays(props);
        const hasIcon = props.iconType && props.iconType !== 'none';
        const hasText = !!props.text;

        if (hasIcon) {
            const icon = new Icon(props.iconType, props.color);
            props.left.push(icon);
        }

        if (hasText) {
            const textElem = UIPool.text_element.get();
            textElem.init({
                parent: layoutHandler.parent,
                layer: layoutHandler.layer,
                text: props.text,
                font: fontFam,
                fontWeight: fontWeig,
                size: fontSiz,
                color: props.color,
                align: hasIcon ? 'right' : align
            });

            if (hasIcon) {
                props.right.push(textElem);
            } else {
                this._pushButtonTextByAlign(props, textElem, align);
            }
        }

        this._cleanupButtonLegacyProps(props);

        const defaultWidth = layoutHandler.parseUnit(presetData.WIDTH?.BASE || 'WW', presetData.WIDTH?.VALUE || 10, parentW);
        const width = forcedW !== undefined
            ? forcedW
            : this._resolveMetricValue(item.widthObj, {
                layoutHandler,
                parentSize: parentW,
                defaultValue: defaultWidth,
                fillValue: parentW,
                contentValue: this._measureButtonContentWidth(props, height)
            });
        props.width = width;

        const btn = UIPool.button.get();
        btn.init(props);
        btn.width = width;
        btn.height = height;
        return btn;
    }

    static _createText(item, x, y, parentW, parentH, _forcedW, layoutHandler) {
        const presetData = this._getPresetData(item.preset, TEXT_CONSTANTS);

        const fontSizePx = layoutHandler.parseUnit(
            presetData.FONT?.SIZE?.BASE || 'WW',
            presetData.FONT?.SIZE?.VALUE || 1,
            parentW
        );
        const fontWeight = presetData.FONT?.WEIGHT || 400;
        const fontFamily = presetData.FONT?.FAMILY || 'Pretendard Variable, arial';
        const fontString = `${fontWeight} ${fontSizePx}px ${this._normalizeFontFamily(fontFamily)}`;

        const textWidth = measureText(item.props.text || '', fontString);

        // 글꼴 속성이 직접 지정된 경우 문자열의 px 값을 높이 계산에 사용
        let resolvedHeight = fontSizePx;
        if (item.props.font) {
            const match = String(item.props.font).match(/(\d+(?:\.\d+)?)px/);
            if (match) resolvedHeight = parseFloat(match[1]);
        }
        resolvedHeight = this._resolveMetricValue(item.heightObj, {
            layoutHandler,
            parentSize: parentH,
            defaultValue: resolvedHeight,
            fillValue: parentH
        });

        const alignVal = item.props.align || 'left';
        const textObj = UIPool.text.get();
        Object.assign(textObj, {
            shape: 'text',
            text: item.props.text || '',
            font: fontString,
            fill: item.props.color || item.props.fill || '#FFFFFF',
            align: alignVal,
            baseline: 'top',
            width: textWidth,
            height: resolvedHeight,
            ...item.props
        });

        this._defineTextXAccessor(textObj, x);
        textObj.y = item.props.y !== undefined ? item.props.y : y;
        if (item.props.x !== undefined) textObj.x = item.props.x;

        return textObj;
    }

    static _createSlider(item, x, y, parentW, parentH, forcedW, layoutHandler) {
        const props = this._createCommonProps(item, x, y, layoutHandler);
        const slider = UIPool.slider.get();
        slider.init(props);

        slider.width = forcedW !== undefined
            ? forcedW
            : this._resolveMetricValue(item.widthObj, {
                layoutHandler,
                parentSize: parentW,
                defaultValue: slider.width || layoutHandler.parseUnit('WW', 10, parentW),
                fillValue: parentW
            });
        slider.height = this._resolveMetricValue(item.heightObj, {
            layoutHandler,
            parentSize: parentH,
            defaultValue: slider.height || layoutHandler.parseUnit('WH', 2, parentH),
            fillValue: parentH
        });

        return slider;
    }

    static _createToggle(item, x, y, parentW, parentH, forcedW, layoutHandler) {
        const props = this._createCommonProps(item, x, y, layoutHandler);
        const toggle = UIPool.toggle.get();
        toggle.init(props);

        toggle.width = forcedW !== undefined
            ? forcedW
            : this._resolveMetricValue(item.widthObj, {
                layoutHandler,
                parentSize: parentW,
                defaultValue: toggle.width || layoutHandler.parseUnit('WW', 5, parentW),
                fillValue: parentW
            });
        toggle.height = this._resolveMetricValue(item.heightObj, {
            layoutHandler,
            parentSize: parentH,
            defaultValue: toggle.height || layoutHandler.parseUnit('WH', 2.5, parentH),
            fillValue: parentH
        });

        return toggle;
    }

    static _createSegmentControl(item, x, y, parentW, parentH, forcedW, layoutHandler) {
        if (item.preset && !item.props.font) {
            const presetData = this._getPresetData(item.preset, TEXT_CONSTANTS);
            item.props.font = this._buildPresetFontString(presetData, 600, parentW, layoutHandler);
        }

        const props = this._createCommonProps(item, x, y, layoutHandler);
        const segment = UIPool.segment_control.get();
        segment.init(props);

        segment.width = forcedW !== undefined
            ? forcedW
            : this._resolveMetricValue(item.widthObj, {
                layoutHandler,
                parentSize: parentW,
                defaultValue: segment.width || layoutHandler.parseUnit('WW', 15, parentW),
                fillValue: parentW
            });
        segment.height = this._resolveMetricValue(item.heightObj, {
            layoutHandler,
            parentSize: parentH,
            defaultValue: segment.height || layoutHandler.parseUnit('WH', 3, parentH),
            fillValue: parentH
        });

        return segment;
    }

    static _createDropdown(item, x, y, parentW, parentH, forcedW, layoutHandler) {
        if (item.preset && !item.props.font) {
            const presetData = this._getPresetData(item.preset, TEXT_CONSTANTS);
            item.props.font = this._buildPresetFontString(presetData, 600, parentW, layoutHandler);
        }

        const width = forcedW !== undefined
            ? forcedW
            : this._resolveMetricValue(item.widthObj, {
                layoutHandler,
                parentSize: parentW,
                defaultValue: layoutHandler.parseUnit('WW', 15, parentW),
                fillValue: parentW
            });
        const height = this._resolveMetricValue(item.heightObj, {
            layoutHandler,
            parentSize: parentH,
            defaultValue: layoutHandler.parseUnit('WH', 3, parentH),
            fillValue: parentH
        });

        const props = this._createCommonProps(item, x, y, layoutHandler);
        props.width = width;
        props.height = height;

        const dropdown = UIPool.dropdown.get();
        dropdown.init(props);

        return dropdown;
    }

    static _createLine(item, x, y, parentW, _parentH, forcedW, layoutHandler) {
        const width = forcedW !== undefined
            ? forcedW
            : this._resolveMetricValue(item.widthObj, {
                layoutHandler,
                parentSize: parentW,
                defaultValue: layoutHandler.parseUnit('WW', 10, parentW),
                fillValue: parentW,
                contentValue: 0
            });

        const lineObj = UIPool.line.get();
        Object.assign(lineObj, {
            shape: 'line',
            stroke: item.props.color || item.props.stroke || item.props.fill || '#FFFFFF',
            lineWidth: item.props.lineWidth || 1,
            width,
            height: item.props.lineWidth || 1,
            ...item.props
        });

        let cx = x;
        let cy = y;
        lineObj.x1 = cx;
        lineObj.y1 = cy;
        lineObj.x2 = cx + width;
        lineObj.y2 = cy;

        Object.defineProperty(lineObj, 'x', {
            get() { return cx; },
            set(val) {
                cx = val;
                this.x1 = val;
                this.x2 = val + this.width;
            },
            enumerable: true,
            configurable: true
        });

        Object.defineProperty(lineObj, 'y', {
            get() { return cy; },
            set(val) {
                cy = val;
                this.y1 = val;
                this.y2 = val;
            },
            enumerable: true,
            configurable: true
        });

        if (item.props.x !== undefined) lineObj.x = item.props.x;
        if (item.props.y !== undefined) lineObj.y = item.props.y;
        return lineObj;
    }

    static _createProgressBar(item, x, y, parentW, parentH, forcedW, layoutHandler) {
        const width = forcedW !== undefined
            ? forcedW
            : this._resolveMetricValue(item.widthObj, {
                layoutHandler,
                parentSize: parentW,
                defaultValue: layoutHandler.parseUnit('WW', 10, parentW),
                fillValue: parentW
            });
        const height = this._resolveMetricValue(item.heightObj, {
            layoutHandler,
            parentSize: parentH,
            defaultValue: layoutHandler.parseUnit('WH', 1, parentH),
            fillValue: parentH
        });

        const props = {
            parent: layoutHandler.parent,
            layer: item.props.layer || layoutHandler.layer || 'ui',
            x,
            y,
            width,
            height,
            ...item.props
        };

        const progressBar = UIPool.progress_bar.get();
        progressBar.init(props);
        progressBar.width = width;
        progressBar.height = height;
        return progressBar;
    }

    static _createCommonProps(item, x, y, layoutHandler) {
        return {
            parent: layoutHandler.parent,
            layer: layoutHandler.layer,
            x,
            y,
            ...item.props
        };
    }

    /**
     * 크기 규격 객체를 실제 수치로 변환합니다.
     * @param {{unit:string, value:number}|undefined} metricObj - 크기 규격 객체
     * @param {object} options - 변환 옵션
     * @returns {number} 계산된 크기
     */
    static _resolveMetricValue(metricObj, options) {
        const {
            layoutHandler,
            parentSize,
            defaultValue,
            fillValue,
            contentValue = defaultValue
        } = options;

        if (!metricObj) return defaultValue;
        if (metricObj.unit === 'content') return contentValue;
        if (metricObj.unit === 'fill') return fillValue;
        return layoutHandler.parseUnit(metricObj.unit, metricObj.value, parentSize);
    }

    /**
     * 버튼 내부 콘텐츠를 모두 감싸는 최소 너비를 계산합니다.
     * @param {object} props - 버튼 초기화 속성
     * @param {number} buttonHeight - 버튼 높이
     * @returns {number} 콘텐츠 기준 최소 너비
     */
    static _measureButtonContentWidth(props, buttonHeight) {
        const margin = props.margin || 0;
        const spacing = props.itemSpacing || 5;
        const leftWidth = this._measureButtonSlotWidth(props.left, buttonHeight, spacing);
        const centerWidth = this._measureButtonSlotWidth(props.center, buttonHeight, spacing);
        const rightWidth = this._measureButtonSlotWidth(props.right, buttonHeight, spacing);
        const edgeWidth = leftWidth + rightWidth;
        return Math.max(
            (margin * 2) + centerWidth,
            (margin * 2) + edgeWidth,
            (margin * 2) + leftWidth,
            (margin * 2) + rightWidth
        );
    }

    /**
     * 버튼 슬롯(left/center/right) 하나의 총 너비를 계산합니다.
     * @param {Array<object>} items - 슬롯 아이템 목록
     * @param {number} buttonHeight - 버튼 높이
     * @param {number} spacing - 슬롯 내부 간격
     * @returns {number} 슬롯 총 너비
     */
    static _measureButtonSlotWidth(items, buttonHeight, spacing) {
        const list = Array.isArray(items) ? items.filter(Boolean) : [];
        if (list.length === 0) return 0;

        let total = 0;
        for (const item of list) {
            total += this._measureButtonItemWidth(item, buttonHeight);
        }

        if (list.length > 1) {
            total += spacing * (list.length - 1);
        }

        return total;
    }

    /**
     * 버튼 내부 단일 아이템의 예상 너비를 계산합니다.
     * @param {object} item - 버튼 내부 아이템
     * @param {number} buttonHeight - 버튼 높이
     * @returns {number} 아이템 예상 너비
     */
    static _measureButtonItemWidth(item, buttonHeight) {
        if (item.width !== undefined && typeof item.width === 'number') {
            return item.width;
        }

        if (item.text !== undefined && item.font && typeof item.size === 'number') {
            const fontString = `${item.fontWeight || ''}${item.size}px ${this._normalizeFontFamily(item.font)}`;
            return measureText(item.text, fontString);
        }

        if (item.constructor?.name === 'Icon' || item.type !== undefined) {
            return buttonHeight * 0.5;
        }

        return 0;
    }

    static _initializeButtonContentArrays(props) {
        if (!props.left) props.left = [];
        if (!props.center) props.center = [];
        if (!props.right) props.right = [];
    }

    static _pushButtonTextByAlign(props, textElem, align) {
        if (align === 'left') props.left.push(textElem);
        else if (align === 'right') props.right.push(textElem);
        else props.center.push(textElem);
    }

    static _cleanupButtonLegacyProps(props) {
        delete props.text;
        delete props.iconType;
        delete props.align;
        delete props.font;
        delete props.fontWeight;
        delete props.size;
    }

    static _defineTextXAccessor(textObj, x) {
        let currentX = x;
        Object.defineProperty(textObj, 'x', {
            get() {
                if (this.align === 'center') return currentX + (this.width / 2);
                if (this.align === 'right') return currentX + this.width;
                return currentX;
            },
            set(val) { currentX = val; },
            enumerable: true,
            configurable: true
        });
    }

    static _getPresetData(preset, constantsObj) {
        if (!preset) return {};
        return constantsObj[preset.toUpperCase()] || {};
    }

    static _buildPresetFontString(presetData, defaultWeight, parentW, layoutHandler) {
        const fontSizePx = layoutHandler.parseUnit(
            presetData.FONT?.SIZE?.BASE || 'WW',
            presetData.FONT?.SIZE?.VALUE || 1,
            parentW
        );
        const fontWeight = presetData.FONT?.WEIGHT || defaultWeight;
        const fontFamily = presetData.FONT?.FAMILY || 'Pretendard Variable, arial';
        return `${fontWeight} ${fontSizePx}px ${this._normalizeFontFamily(fontFamily)}`;
    }

    static _normalizeFontFamily(fontFamily) {
        let familyStr = fontFamily;
        if (!familyStr.includes('"') && !familyStr.includes("'")) {
            const parts = familyStr.split(',');
            familyStr = `"${parts[0].trim()}"${parts[1] ? ',' + parts[1] : ''}`;
        }
        return familyStr;
    }
}
