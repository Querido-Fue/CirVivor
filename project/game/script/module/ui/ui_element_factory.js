import { measureText, render } from 'display/_display_system.js';
import { ButtonElement } from 'ui/element/button.js';
import { SliderElement } from 'ui/element/slider.js';
import { ToggleElement } from 'ui/element/toggle.js';
import { SegmentControlElement } from 'ui/element/segment_control.js';
import { TEXT_CONSTANTS } from 'data/ui/text_constants.js';
import { BUTTON_CONSTANTS } from 'data/ui/button_constants.js';

export class UIElementFactory {
    static _handlers = {
        'button': (item, x, y, parentW, parentH, forcedW, layoutHandler) => {
            let presetData = {};
            if (item.preset) {
                const presetKey = item.preset.toUpperCase();
                presetData = BUTTON_CONSTANTS[presetKey] || {};
            }

            let width = forcedW !== undefined ? forcedW : (item.widthObj ? layoutHandler._parseUnit(item.widthObj.unit, item.widthObj.value, parentW) : layoutHandler._parseUnit(presetData.WIDTH?.BASE || 'WW', presetData.WIDTH?.VALUE || 10, parentW));
            const height = item.heightObj ? layoutHandler._parseUnit(item.heightObj.unit, item.heightObj.value, parentH) : layoutHandler._parseUnit(presetData.HEIGHT?.BASE || 'WH', presetData.HEIGHT?.VALUE || 5, parentH);

            const props = {
                parent: layoutHandler.parent,
                layer: layoutHandler.layer,
                x: x,
                y: y,
                width: width,
                height: height,
                text: item.props.text || '',
                onClick: item.props.onClick || (() => { }),
                uiScale: layoutHandler.uiScale,
                ...item.props
            };

            if (presetData.FONT) {
                props.font = presetData.FONT.FAMILY;
                props.fontWeight = presetData.FONT.WEIGHT;
                props.size = layoutHandler._parseUnit(presetData.FONT.SIZE?.BASE || 'WW', presetData.FONT.SIZE?.VALUE || 1, parentW);
            }

            if (presetData.ALIGN) {
                props.align = presetData.ALIGN;
            }
            if (presetData.MARGIN) {
                props.margin = layoutHandler._parseUnit(presetData.MARGIN.BASE || 'WW', presetData.MARGIN.VALUE || 0, parentW);
            }
            if (presetData.RADIUS) {
                props.radius = layoutHandler._parseUnit(presetData.RADIUS.BASE || 'WW', presetData.RADIUS.VALUE || 0, parentW);
            }

            const btn = new ButtonElement(props);
            btn.width = width;
            btn.height = height;
            return btn;
        },

        'text': (item, x, y, parentW, parentH, forcedW, layoutHandler) => {
            let presetData = {};
            if (item.preset) {
                const presetKey = item.preset.toUpperCase();
                presetData = TEXT_CONSTANTS[presetKey] || {};
            }

            const fontSizePx = layoutHandler._parseUnit(presetData.FONT?.SIZE?.BASE || 'WW', presetData.FONT?.SIZE?.VALUE || 1, parentW);
            const fontWeight = presetData.FONT?.WEIGHT || 400;
            const fontFamily = presetData.FONT?.FAMILY || "Pretendard Variable, arial";

            let familyStr = fontFamily;
            if (!familyStr.includes('"') && !familyStr.includes("'")) {
                const parts = familyStr.split(',');
                familyStr = `"${parts[0].trim()}"${parts[1] ? ',' + parts[1] : ''}`;
            }
            const fontString = `${fontWeight} ${fontSizePx}px ${familyStr}`;

            const textWidth = measureText(item.props.text || '', fontString);

            // item.props.font가 직접 지정된 경우, 해당 font 문자열에서 px 값을 파싱하여 height로 사용
            let resolvedHeight = fontSizePx;
            if (item.props.font) {
                const match = String(item.props.font).match(/(\d+(?:\.\d+)?)px/);
                if (match) resolvedHeight = parseFloat(match[1]);
            }

            let alignVal = item.props.align || 'left';
            const textObj = {
                shape: 'text',
                text: item.props.text || '',
                font: fontString,
                fill: item.props.color || item.props.fill || '#FFFFFF',
                align: alignVal,
                baseline: 'top',
                width: textWidth,
                height: resolvedHeight,
                ...item.props
            };

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
            textObj.y = item.props.y !== undefined ? item.props.y : y;
            if (item.props.x !== undefined) textObj.x = item.props.x;

            return textObj;
        },

        'slider': (item, x, y, parentW, parentH, forcedW, layoutHandler) => {
            const props = {
                parent: layoutHandler.parent,
                layer: layoutHandler.layer,
                x: x,
                y: y,
                ...item.props
            };
            const slider = new SliderElement(props);
            slider.width = forcedW !== undefined ? forcedW : (slider.width || layoutHandler._parseUnit('WW', 10, parentW));
            slider.height = item.heightObj ? layoutHandler._parseUnit(item.heightObj.unit, item.heightObj.value, parentH) : (slider.height || layoutHandler._parseUnit('WH', 2, parentH));
            return slider;
        },

        'toggle': (item, x, y, parentW, parentH, forcedW, layoutHandler) => {
            const props = { parent: layoutHandler.parent, layer: layoutHandler.layer, x: x, y: y, ...item.props };
            const toggle = new ToggleElement(props);
            toggle.width = forcedW !== undefined ? forcedW : (toggle.width || layoutHandler._parseUnit('WW', 5, parentW));
            toggle.height = item.heightObj ? layoutHandler._parseUnit(item.heightObj.unit, item.heightObj.value, parentH) : (toggle.height || layoutHandler._parseUnit('WH', 2.5, parentH));
            return toggle;
        },

        'segment_control': (item, x, y, parentW, parentH, forcedW, layoutHandler) => {
            if (item.preset && !item.props.font) {
                const presetKey = item.preset.toUpperCase();
                const presetData = TEXT_CONSTANTS[presetKey] || {};
                const fontSizePx = layoutHandler._parseUnit(presetData.FONT?.SIZE?.BASE || 'WW', presetData.FONT?.SIZE?.VALUE || 1, parentW);
                const fontWeight = presetData.FONT?.WEIGHT || 600;
                const fontFamily = presetData.FONT?.FAMILY || "Pretendard Variable, arial";
                let familyStr = fontFamily;
                if (!familyStr.includes('"') && !familyStr.includes("'")) {
                    const parts = familyStr.split(',');
                    familyStr = `"${parts[0].trim()}"${parts[1] ? ',' + parts[1] : ''}`;
                }
                item.props.font = `${fontWeight} ${fontSizePx}px ${familyStr}`;
            }
            const props = { parent: layoutHandler.parent, layer: layoutHandler.layer, x: x, y: y, ...item.props };
            const segment = new SegmentControlElement(props);
            segment.width = forcedW !== undefined ? forcedW : (segment.width || layoutHandler._parseUnit('WW', 15, parentW));
            segment.height = item.heightObj ? layoutHandler._parseUnit(item.heightObj.unit, item.heightObj.value, parentH) : (segment.height || layoutHandler._parseUnit('WH', 3, parentH));
            return segment;
        },

        'line': (item, x, y, parentW, parentH, forcedW, layoutHandler) => {
            let width = forcedW !== undefined ? forcedW : (item.widthObj ? layoutHandler._parseUnit(item.widthObj.unit, item.widthObj.value, parentW) : layoutHandler._parseUnit('WW', 10, parentW));

            const lineObj = {
                shape: 'line',
                stroke: item.props.color || item.props.stroke || item.props.fill || '#FFFFFF',
                lineWidth: item.props.lineWidth || 1,
                width: width,
                height: item.props.lineWidth || 1,
                ...item.props
            };

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
        },

        'progress_bar': (item, x, y, parentW, parentH, forcedW, layoutHandler) => {
            let width = forcedW !== undefined ? forcedW : (item.widthObj ? layoutHandler._parseUnit(item.widthObj.unit, item.widthObj.value, parentW) : layoutHandler._parseUnit('WW', 10, parentW));
            const height = item.heightObj ? layoutHandler._parseUnit(item.heightObj.unit, item.heightObj.value, parentH) : layoutHandler._parseUnit('WH', 1, parentH);

            const progressObj = {
                shape: 'custom',
                x: x,
                y: y,
                width: width,
                height: height,
                percent: item.props.percent || 0,
                baseColor: item.props.baseColor || '#444444',
                fillColor: item.props.fillColor || '#FFFFFF',
                layer: item.props.layer || layoutHandler.layer || 'overlay',
                ...item.props,
                draw: function () {
                    const radius = this.height / 2;
                    const fillW = this.width * (this.percent / 100);

                    render(this.layer, {
                        shape: 'roundRect',
                        x: this.x,
                        y: this.y,
                        w: this.width,
                        h: this.height,
                        radius: radius,
                        fill: this.baseColor
                    });

                    if (fillW > 0) {
                        render(this.layer, {
                            shape: 'roundRect',
                            x: this.x,
                            y: this.y,
                            w: fillW,
                            h: this.height,
                            radius: radius,
                            fill: this.fillColor
                        });
                    }
                }
            };
            return progressObj;
        }
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
        if (handler) {
            return handler(item, x, y, parentW, parentH, forcedW, layoutHandler);
        }

        return null;
    }
}
