import { BaseUIElement } from "./_base_element.js";
import { render, shadowOn, shadowOff } from "display/display_system.js";
import { getMouseInput, getMouseFocus } from "input/input_system.js";
import { animate } from "animation/animation_system.js";
import { ColorSchemes } from "display/_theme_handler.js";
import { DropdownElement } from "./_dropdown.js";
/**
 * @class SegmentControlElement
 * @description 여러 옵션 중 하나를 선택하는 세그먼트 컨트롤 UI입니다.
 * @param {object} properties - 속성
 * @param {object[]} properties.items - 옵션 배열 [{label: 'Text', value: 1}, ...]
 * @param {any} properties.value - 초기 값
 * @param {Function} properties.onChange - 변경 시 콜백 (value) => {}
 * @param {number} properties.width - 전체 너비
 * @param {number} properties.height - 전체 높이
 */
export class SegmentControlElement extends BaseUIElement {
    #value;
    constructor(properties) {
        super(properties);
        this.init(properties);
    }

    /**
         * @override
         */
    init(properties) {
        super.init(properties);
        if (!properties) return;
        this.items = properties.items || [];
        this.onChange = properties.onChange || (() => { });

        this.width = properties.width || 200;
        this.height = properties.height || 40;
        this.radius = properties.radius || 8;


        this.backgroundColor = properties.backgroundColor || ColorSchemes.Overlay.Segment.Background;
        this.thumbColor = properties.thumbColor || ColorSchemes.Overlay.Segment.Thumb;
        this.textColorActive = properties.textColorActive || ColorSchemes.Overlay.Segment.TextActive;
        this.textColorInactive = properties.textColorInactive || ColorSchemes.Overlay.Segment.TextInactive;

        this.font = properties.font || `600 ${this.height * 0.55}px "Pretendard Variable", arial`;


        this.#value = null;
        this.selectedIndex = 0;

        this.selectionProgress = 0;

        this.clickAble = true;
        this.hoverScaleMultiplier = 1.05;
        this.pressScaleMultiplier = 1.05;

        if (properties.value !== undefined) {
            this.value = properties.value;
            this.selectionProgress = this.selectedIndex;
        }
    }

    /**
         * @override
         */
    reset() {
        super.reset();
        this.onChange = () => { };
    }

    get value() { return this.#value; }

    set value(val) {
        if (this.#value === val) return;
        this.#value = val;

        const newIndex = this.items.findIndex(item => item.value === val);
        if (newIndex !== -1) {
            this.selectedIndex = newIndex;

            if (this.visible && Math.abs(this.selectionProgress - this.selectedIndex) > 0.01) {
                animate(this, {
                    variable: 'selectionProgress',
                    startValue: this.selectionProgress,
                    endValue: this.selectedIndex,
                    type: 'easeOutExpo',
                    duration: 0.3
                });
            } else {
                this.selectionProgress = this.selectedIndex;
            }
        }
    }

    /**
         * @override
         */
    update() {
        if (!this.visible) return;

        this.padding = this.height * 0.1;
        this.segmentWidth = (this.width - (this.padding * 2)) / this.items.length;
        this.thumbHeight = this.height - (this.padding * 2);

        const mx = getMouseInput("x");
        const my = getMouseInput("y");
        if (DropdownElement.isPointerBlockedFor(mx, my, this.layer, this.id)) {
            this._handleInteractionState(false, false);
            return;
        }

        let isOver = false;

        if (getMouseFocus().includes(this.layer) && this.clickAble) {
            isOver = mx >= this.x && mx <= this.x + this.width && my >= this.y && my <= this.y + this.height;

            if (isOver && getMouseInput("leftClicked")) {
                const relativeX = mx - this.x - this.padding;
                let clickedIndex = Math.floor(relativeX / this.segmentWidth);

                if (clickedIndex < 0) clickedIndex = 0;
                if (clickedIndex >= this.items.length) clickedIndex = this.items.length - 1;

                if (this.selectedIndex !== clickedIndex) {
                    this.selectedIndex = clickedIndex;
                    this.value = this.items[clickedIndex].value;
                    this.onChange(this.value);
                }
            }
        }

        const isLeftClicking = getMouseInput("leftClicking");

        // 기본 UI 요소의 공통 상호작용 처리 호출
        this._handleInteractionState(isOver, isLeftClicking);
    }

    /**
         * @override
         */
    draw() {
        if (!this.visible) return;

        // 스케일 적용 (중심점 기준 축소/확대가 아니라 top-left 부터 시작하는 LayoutHandler 룰에 맞춤)
        const scale = this.scale;

        const cx = this.x + this.width / 2;
        const cy = this.y + this.height / 2;

        const w = this.width * scale;
        const h = this.height * scale;

        // 버튼이 가운데로 모이도록 cx, cy를 기준으로 다시 x,y 계산
        const scaledX = cx - w / 2;
        const scaledY = cy - h / 2;

        const scaledPadding = this.padding * scale;
        const scaledSegW = (w - (scaledPadding * 2)) / this.items.length;

        const thumbInset = scaledSegW * 0.03;
        const thumbXOffset = scaledPadding + (scaledSegW * this.selectionProgress) + thumbInset;

        render(this.layer, {
            shape: 'roundRect',
            x: scaledX + w * 0.01, // 양 끝 부분 약간 잘라내기
            y: scaledY,
            w: w * 0.98,
            h: h,
            radius: this.radius * scale,
            fill: this.backgroundColor,
            alpha: this.alpha
        });

        for (let i = 1; i < this.items.length; i++) {
            const divX = scaledX + scaledPadding + (scaledSegW * i);
            const divY1 = scaledY + h * 0.25;
            const divY2 = scaledY + h * 0.75;
            render(this.layer, {
                shape: 'line',
                x1: divX, y1: divY1,
                x2: divX, y2: divY2,
                stroke: this.textColorInactive,
                lineWidth: 1 * scale,
                alpha: this.alpha * 0.3
            });
        }
        shadowOn(this.layer, 4 * scale, 'rgba(0,0,0,0.3)');
        render(this.layer, {
            shape: 'roundRect',
            x: scaledX + thumbXOffset,
            y: scaledY + scaledPadding,
            w: scaledSegW - (thumbInset * 2),
            h: h - (scaledPadding * 2),
            radius: (this.radius - 2) * scale,
            fill: this.thumbColor,
            alpha: this.alpha,
        });
        shadowOff(this.layer);

        for (let i = 0; i < this.items.length; i++) {
            const item = this.items[i];
            const itemX = scaledX + scaledPadding + (scaledSegW * i) + (scaledSegW / 2);
            const itemY = scaledY + h / 2;

            const isSelected = i === this.selectedIndex;
            const color = isSelected ? this.textColorActive : this.textColorInactive;

            const fontToUse = this.font || `600 ${this.height * 0.55}px "Pretendard Variable", arial`;

            render(this.layer, {
                shape: 'text',
                text: item.label,
                x: itemX,
                y: itemY,
                font: fontToUse,
                fill: color,
                align: 'center',
                baseline: 'middle',
                alpha: this.alpha
            });
        }
    }
}
