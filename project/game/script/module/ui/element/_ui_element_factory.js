import { measureText } from 'display/display_system.js';
import { Icon } from 'ui/element/_icon.js';
import { UIPool } from 'ui/_ui_pool.js';
import { resolveButtonStyle } from 'ui/style/_component_style_resolver.js';
import { resolveTypography } from 'ui/style/_typography_resolver.js';
import { createFontString } from 'util/font_util.js';

const NO_ICON_TYPE = 'none';
const DEFAULT_BUTTON_ALIGN = 'center';
const DEFAULT_TEXT_ALIGN = 'left';
const DEFAULT_TEXT_FILL = '#FFFFFF';
const DEFAULT_LINE_STROKE = '#FFFFFF';
const DEFAULT_LINE_WIDTH = 1;
const ICON_BUTTON_TEXT_ALIGN = 'right';
const FORBIDDEN_TYPOGRAPHY_PROP_KEYS = Object.freeze([
    'font',
    'fontSize',
    'fontWeight',
    'fontFamily',
    'size',
    'valueFont'
]);

/**
 * @class UIElementFactory
 * @description 레이아웃 메타데이터를 실제 UI 요소(버튼, 텍스트, 슬라이더 등)로 변환해 생성합니다.
 */
export class UIElementFactory {
    /**
     * 레이아웃 타입별 생성 함수 매핑입니다.
     * @type {Readonly<Record<string, Function>>}
     */
    static _handlers = Object.freeze({
        button: UIElementFactory._createButton,
        text: UIElementFactory._createText,
        slider: UIElementFactory._createSlider,
        toggle: UIElementFactory._createToggle,
        segment_control: UIElementFactory._createSegmentControl,
        dropdown: UIElementFactory._createDropdown,
        line: UIElementFactory._createLine,
        progress_bar: UIElementFactory._createProgressBar
    });

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
        this._assertNoRawTypographyProps(item);
        const handler = this._handlers[item.type];
        if (!handler) return null;
        return handler.call(this, item, x, y, parentW, parentH, forcedW, layoutHandler);
    }

    /**
     * 버튼 UI 요소를 생성합니다.
     * @param {object} item - 버튼 레이아웃 항목입니다.
     * @param {number} x - x 좌표입니다.
     * @param {number} y - y 좌표입니다.
     * @param {number} parentW - 부모 너비입니다.
     * @param {number} parentH - 부모 높이입니다.
     * @param {number|undefined} forcedW - 강제 너비입니다.
     * @param {object} layoutHandler - 레이아웃 핸들러입니다.
     * @returns {object} 버튼 요소입니다.
     */
    static _createButton(item, x, y, parentW, parentH, forcedW, layoutHandler) {
        const buttonStyle = item.buttonStyle
            ? resolveButtonStyle(
                item.buttonStyle,
                (metric) => layoutHandler.parseUnit(metric.BASE, metric.VALUE, parentW)
            )
            : null;
        const defaultHeight = buttonStyle?.height
            ?? layoutHandler.parseUnit('WH', 5, parentH);
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

        const align = props.align || buttonStyle?.align || DEFAULT_BUTTON_ALIGN;
        const typographyToken = item.textStyle || buttonStyle?.typography;
        const typography = props.text
            ? this._resolveTypography(typographyToken, parentW, layoutHandler)
            : null;

        if (buttonStyle) {
            props.margin = buttonStyle.margin;
            props.radius = buttonStyle.radius;
            if (!props.iconType && buttonStyle.iconType) {
                props.iconType = buttonStyle.iconType;
            }
        }

        this._initializeButtonContentArrays(props);
        const hasIcon = props.iconType && props.iconType !== NO_ICON_TYPE;
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
                font: typography.family,
                fontWeight: typography.weight,
                size: typography.size,
                color: props.color,
                align: hasIcon ? ICON_BUTTON_TEXT_ALIGN : align
            });

            if (hasIcon) {
                props.right.push(textElem);
            } else {
                this._pushButtonTextByAlign(props, textElem, align);
            }
        }

        this._cleanupButtonLegacyProps(props);

        const defaultWidth = buttonStyle?.width
            ?? layoutHandler.parseUnit('WW', 10, parentW);
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

    /**
     * 텍스트 렌더 커맨드 객체를 생성합니다.
     * @param {object} item - 텍스트 레이아웃 항목입니다.
     * @param {number} x - x 좌표입니다.
     * @param {number} y - y 좌표입니다.
     * @param {number} parentW - 부모 너비입니다.
     * @param {number} parentH - 부모 높이입니다.
     * @param {number|undefined} _forcedW - 텍스트에서 사용하지 않는 강제 너비입니다.
     * @param {object} layoutHandler - 레이아웃 핸들러입니다.
     * @returns {object} 텍스트 렌더 커맨드 객체입니다.
     */
    static _createText(item, x, y, parentW, parentH, _forcedW, layoutHandler) {
        const typography = this._resolveTypography(item.textStyle, parentW, layoutHandler);
        const textWidth = measureText(item.props.text || '', typography.font);
        const resolvedHeight = this._resolveMetricValue(item.heightObj, {
            layoutHandler,
            parentSize: parentH,
            defaultValue: typography.size,
            fillValue: parentH
        });

        const alignVal = item.props.align || DEFAULT_TEXT_ALIGN;
        const textObj = UIPool.text.get();
        Object.assign(textObj, {
            ...item.props,
            shape: 'text',
            text: item.props.text || '',
            font: typography.font,
            fill: item.props.color || item.props.fill || DEFAULT_TEXT_FILL,
            align: alignVal,
            baseline: 'top',
            width: textWidth,
            height: resolvedHeight
        });

        this._defineTextXAccessor(textObj, x);
        textObj.y = item.props.y !== undefined ? item.props.y : y;
        if (item.props.x !== undefined) textObj.x = item.props.x;

        return textObj;
    }

    /**
     * 슬라이더 UI 요소를 생성합니다.
     * @param {object} item - 슬라이더 레이아웃 항목입니다.
     * @param {number} x - x 좌표입니다.
     * @param {number} y - y 좌표입니다.
     * @param {number} parentW - 부모 너비입니다.
     * @param {number} parentH - 부모 높이입니다.
     * @param {number|undefined} forcedW - 강제 너비입니다.
     * @param {object} layoutHandler - 레이아웃 핸들러입니다.
     * @returns {object} 슬라이더 요소입니다.
     */
    static _createSlider(item, x, y, parentW, parentH, forcedW, layoutHandler) {
        const props = this._createCommonProps(item, x, y, layoutHandler);
        props.valueFont = this._resolveTypography(
            item.valueTextStyle,
            parentW,
            layoutHandler
        ).font;
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

    /**
     * 토글 UI 요소를 생성합니다.
     * @param {object} item - 토글 레이아웃 항목입니다.
     * @param {number} x - x 좌표입니다.
     * @param {number} y - y 좌표입니다.
     * @param {number} parentW - 부모 너비입니다.
     * @param {number} parentH - 부모 높이입니다.
     * @param {number|undefined} forcedW - 강제 너비입니다.
     * @param {object} layoutHandler - 레이아웃 핸들러입니다.
     * @returns {object} 토글 요소입니다.
     */
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

    /**
     * 세그먼트 컨트롤 UI 요소를 생성합니다.
     * @param {object} item - 세그먼트 컨트롤 레이아웃 항목입니다.
     * @param {number} x - x 좌표입니다.
     * @param {number} y - y 좌표입니다.
     * @param {number} parentW - 부모 너비입니다.
     * @param {number} parentH - 부모 높이입니다.
     * @param {number|undefined} forcedW - 강제 너비입니다.
     * @param {object} layoutHandler - 레이아웃 핸들러입니다.
     * @returns {object} 세그먼트 컨트롤 요소입니다.
     */
    static _createSegmentControl(item, x, y, parentW, parentH, forcedW, layoutHandler) {
        const props = this._createCommonProps(item, x, y, layoutHandler);
        props.font = this._resolveTypography(item.textStyle, parentW, layoutHandler).font;
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

    /**
     * 드롭다운 UI 요소를 생성합니다.
     * @param {object} item - 드롭다운 레이아웃 항목입니다.
     * @param {number} x - x 좌표입니다.
     * @param {number} y - y 좌표입니다.
     * @param {number} parentW - 부모 너비입니다.
     * @param {number} parentH - 부모 높이입니다.
     * @param {number|undefined} forcedW - 강제 너비입니다.
     * @param {object} layoutHandler - 레이아웃 핸들러입니다.
     * @returns {object} 드롭다운 요소입니다.
     */
    static _createDropdown(item, x, y, parentW, parentH, forcedW, layoutHandler) {
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
        props.font = this._resolveTypography(item.textStyle, parentW, layoutHandler).font;
        props.width = width;
        props.height = height;

        const dropdown = UIPool.dropdown.get();
        dropdown.init(props);

        return dropdown;
    }

    /**
     * 라인 렌더 커맨드 객체를 생성합니다.
     * @param {object} item - 라인 레이아웃 항목입니다.
     * @param {number} x - x 좌표입니다.
     * @param {number} y - y 좌표입니다.
     * @param {number} parentW - 부모 너비입니다.
     * @param {number} _parentH - 라인에서 사용하지 않는 부모 높이입니다.
     * @param {number|undefined} forcedW - 강제 너비입니다.
     * @param {object} layoutHandler - 레이아웃 핸들러입니다.
     * @returns {object} 라인 렌더 커맨드 객체입니다.
     */
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
            stroke: item.props.color || item.props.stroke || item.props.fill || DEFAULT_LINE_STROKE,
            lineWidth: item.props.lineWidth || DEFAULT_LINE_WIDTH,
            width,
            height: item.props.lineWidth || DEFAULT_LINE_WIDTH,
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

    /**
     * 프로그레스 바 UI 요소를 생성합니다.
     * @param {object} item - 프로그레스 바 레이아웃 항목입니다.
     * @param {number} x - x 좌표입니다.
     * @param {number} y - y 좌표입니다.
     * @param {number} parentW - 부모 너비입니다.
     * @param {number} parentH - 부모 높이입니다.
     * @param {number|undefined} forcedW - 강제 너비입니다.
     * @param {object} layoutHandler - 레이아웃 핸들러입니다.
     * @returns {object} 프로그레스 바 요소입니다.
     */
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

    /**
     * UI 요소 생성에 공통으로 전달할 속성을 구성합니다.
     * @param {object} item - 레이아웃 항목입니다.
     * @param {number} x - x 좌표입니다.
     * @param {number} y - y 좌표입니다.
     * @param {object} layoutHandler - 레이아웃 핸들러입니다.
     * @returns {object} 공통 속성 객체입니다.
     */
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
     * 레이아웃 메타데이터가 저수준 폰트 속성으로 의미 토큰 계약을 우회하지 않는지 확인합니다.
     * @param {object} item - 검사할 레이아웃 아이템입니다.
     * @returns {void}
     */
    static _assertNoRawTypographyProps(item) {
        for (const key of FORBIDDEN_TYPOGRAPHY_PROP_KEYS) {
            if (Object.prototype.hasOwnProperty.call(item?.props || {}, key)) {
                throw new TypeError(`UIElementFactory는 raw typography prop "${key}"를 허용하지 않습니다.`);
            }
        }
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
            const fontString = createFontString({
                weight: item.fontWeight || '',
                sizePx: item.size,
                family: item.font
            });
            return measureText(item.text, fontString);
        }

        if (item.constructor?.name === 'Icon' || item.type !== undefined) {
            return buttonHeight * 0.5;
        }

        return 0;
    }

    /**
     * 버튼 슬롯 배열을 초기화합니다.
     * @param {object} props - 버튼 속성 객체입니다.
     */
    static _initializeButtonContentArrays(props) {
        if (!props.left) props.left = [];
        if (!props.center) props.center = [];
        if (!props.right) props.right = [];
    }

    /**
     * 버튼 텍스트 요소를 정렬 기준 슬롯에 넣습니다.
     * @param {object} props - 버튼 속성 객체입니다.
     * @param {object} textElem - 텍스트 요소입니다.
     * @param {string} align - 정렬 기준입니다.
     */
    static _pushButtonTextByAlign(props, textElem, align) {
        if (align === 'left') props.left.push(textElem);
        else if (align === 'right') props.right.push(textElem);
        else props.center.push(textElem);
    }

    /**
     * 버튼 init에 직접 넘기지 않을 레거시 속성을 제거합니다.
     * @param {object} props - 버튼 속성 객체입니다.
     */
    static _cleanupButtonLegacyProps(props) {
        delete props.text;
        delete props.iconType;
        delete props.align;
        delete props.font;
        delete props.fontWeight;
        delete props.size;
    }

    /**
     * 텍스트 객체의 align 기준 x 접근자를 정의합니다.
     * @param {object} textObj - 텍스트 렌더 커맨드 객체입니다.
     * @param {number} x - 기준 x 좌표입니다.
     */
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

    /**
     * 승인된 타이포그래피 토큰을 현재 레이아웃 기준 메트릭으로 변환합니다.
     * @param {object} token - `TYPOGRAPHY` 토큰입니다.
     * @param {number} parentW - 현재 레이아웃 부모 너비입니다.
     * @param {object} layoutHandler - 단위 변환을 소유한 레이아웃 핸들러입니다.
     * @returns {{font:string,size:number,lineHeight:number,weight:number,family:string}} 타이포그래피 메트릭입니다.
     */
    static _resolveTypography(token, parentW, layoutHandler) {
        return resolveTypography(token, {
            uiScale: layoutHandler.uiScale,
            resolveMetric: (metric) => layoutHandler.parseUnit(
                metric.BASE,
                metric.VALUE,
                parentW
            )
        });
    }
}
