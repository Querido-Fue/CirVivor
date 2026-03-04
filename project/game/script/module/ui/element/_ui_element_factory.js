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

        const width = forcedW !== undefined
            ? forcedW
            : (item.widthObj
                ? layoutHandler._parseUnit(item.widthObj.unit, item.widthObj.value, parentW)
                : layoutHandler._parseUnit(presetData.WIDTH?.BASE || 'WW', presetData.WIDTH?.VALUE || 10, parentW));

        const height = item.heightObj
            ? layoutHandler._parseUnit(item.heightObj.unit, item.heightObj.value, parentH)
            : layoutHandler._parseUnit(presetData.HEIGHT?.BASE || 'WH', presetData.HEIGHT?.VALUE || 5, parentH);

        const props = {
            parent: layoutHandler.parent,
            layer: layoutHandler.layer,
            x,
            y,
            width,
            height,
            onClick: item.props.onClick || (() => { }),
            uiScale: layoutHandler.uiScale,
            ...item.props
        };

        const fontFam = props.font || presetData.FONT?.FAMILY || 'arial';
        const fontWeig = props.fontWeight || presetData.FONT?.WEIGHT || '';
        const fontSiz = props.size || (presetData.FONT
            ? layoutHandler._parseUnit(presetData.FONT.SIZE?.BASE || 'WW', presetData.FONT.SIZE?.VALUE || 1, parentW)
            : 12);

        const align = props.align || presetData.ALIGN || 'center';

        if (presetData.MARGIN) {
            props.margin = layoutHandler._parseUnit(presetData.MARGIN.BASE || 'WW', presetData.MARGIN.VALUE || 0, parentW);
        }
        if (presetData.RADIUS) {
            props.radius = layoutHandler._parseUnit(presetData.RADIUS.BASE || 'WW', presetData.RADIUS.VALUE || 0, parentW);
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

        const btn = UIPool.button.get();
        btn.init(props);
        btn.width = width;
        btn.height = height;
        return btn;
    }

    static _createText(item, x, y, parentW, _parentH, _forcedW, layoutHandler) {
        const presetData = this._getPresetData(item.preset, TEXT_CONSTANTS);

        const fontSizePx = layoutHandler._parseUnit(
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
            : (slider.width || layoutHandler._parseUnit('WW', 10, parentW));
        slider.height = item.heightObj
            ? layoutHandler._parseUnit(item.heightObj.unit, item.heightObj.value, parentH)
            : (slider.height || layoutHandler._parseUnit('WH', 2, parentH));

        return slider;
    }

    static _createToggle(item, x, y, parentW, parentH, forcedW, layoutHandler) {
        const props = this._createCommonProps(item, x, y, layoutHandler);
        const toggle = UIPool.toggle.get();
        toggle.init(props);

        toggle.width = forcedW !== undefined
            ? forcedW
            : (toggle.width || layoutHandler._parseUnit('WW', 5, parentW));
        toggle.height = item.heightObj
            ? layoutHandler._parseUnit(item.heightObj.unit, item.heightObj.value, parentH)
            : (toggle.height || layoutHandler._parseUnit('WH', 2.5, parentH));

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
            : (segment.width || layoutHandler._parseUnit('WW', 15, parentW));
        segment.height = item.heightObj
            ? layoutHandler._parseUnit(item.heightObj.unit, item.heightObj.value, parentH)
            : (segment.height || layoutHandler._parseUnit('WH', 3, parentH));

        return segment;
    }

    static _createDropdown(item, x, y, parentW, parentH, forcedW, layoutHandler) {
        if (item.preset && !item.props.font) {
            const presetData = this._getPresetData(item.preset, TEXT_CONSTANTS);
            item.props.font = this._buildPresetFontString(presetData, 600, parentW, layoutHandler);
        }

        const width = forcedW !== undefined
            ? forcedW
            : layoutHandler._parseUnit('WW', 15, parentW);
        const height = item.heightObj
            ? layoutHandler._parseUnit(item.heightObj.unit, item.heightObj.value, parentH)
            : layoutHandler._parseUnit('WH', 3, parentH);

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
            : (item.widthObj
                ? layoutHandler._parseUnit(item.widthObj.unit, item.widthObj.value, parentW)
                : layoutHandler._parseUnit('WW', 10, parentW));

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
            : (item.widthObj
                ? layoutHandler._parseUnit(item.widthObj.unit, item.widthObj.value, parentW)
                : layoutHandler._parseUnit('WW', 10, parentW));
        const height = item.heightObj
            ? layoutHandler._parseUnit(item.heightObj.unit, item.heightObj.value, parentH)
            : layoutHandler._parseUnit('WH', 1, parentH);

        const props = {
            parent: layoutHandler.parent,
            layer: item.props.layer || layoutHandler.layer || 'overlay',
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
        const fontSizePx = layoutHandler._parseUnit(
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
