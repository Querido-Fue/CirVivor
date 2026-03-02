import { getWW, getWH } from 'display/display_system.js';
import { BUTTON_CONSTANTS } from 'data/ui/button_constants.js';
import { GLOBAL_CONSTANTS } from 'data/global/global_constants.js';
import { UIElementFactory } from 'ui/_ui_element_factory.js';
import { releaseUIItem } from 'ui/_ui_pool.js';
import { UI_CONSTANTS } from 'data/ui/ui_constants.js';

/**
 * @class LayoutHandler
 * @description 게임 UI 컴포넌트의 위치(x, y)를 단위(WW, WH 등) 기반으로 자동 계산해 주는 빌더 패턴 클래스입니다.
 * 화면 크기 갱신 시에는 location.reload() 동작으로 대체하므로 본 클래스에서는 반응형(resize) 갱신은 처리하지 않고 초기 1회 계산만 수행합니다.
 */
export class LayoutHandler {
    /**
     * @param {object} parent - 오버레이 등의 부모 객체 (scaledW, scaledH, x, y 등을 참조)
     */
    constructor(parent) {
        this.parent = parent;
        this.layer = parent.layer || GLOBAL_CONSTANTS.FALLBACK_LAYOUT;
        this.uiScale = parent.uiScale || 1;

        // 기본값: 부모의 전체 크기(OW/OH)와 기준 위치(OX/OY)
        this._layoutSize = { w: { unit: 'OW', value: 100 }, h: { unit: 'OH', value: 100 } };
        this._layoutStart = { x: { unit: 'OX', value: 0 }, y: { unit: 'OY', value: 0 } };
        this._horMargin = { unit: 'WW', value: 0 };

        this._items = [];
        this._groupStack = [];
        this._currentItem = null;
        this._parentItem = null;
    }

    _commitCurrentItem() {
        if (this._parentItem) {
            const currentGroup = this._groupStack.length > 0 ? this._groupStack[this._groupStack.length - 1] : null;
            if (currentGroup) {
                currentGroup.items.push(this._parentItem);
            } else {
                this._items.push(this._parentItem);
            }
        }
        this._currentItem = null;
        this._parentItem = null;
    }

    // --- 레이아웃 기본 설정 영역 ---

    /**
     * 레이아웃의 전체 가상의 크기를 지정합니다.
     * @param {string} wUnit 너비 단위 (예: 'OW', 'WW', 'absolute')
     * @param {number} wValue 너비 값
     * @param {string} hUnit 높이 단위
     * @param {number} hValue 높이 값
     * @returns {LayoutHandler}
     */
    layoutSize(wUnit, wValue, hUnit, hValue) {
        this._layoutSize = { w: { unit: wUnit, value: wValue }, h: { unit: hUnit, value: hValue } };
        return this;
    }

    /**
     * 레이아웃이 시작될 오프셋 좌표를 지정합니다.
     * @param {string} xUnit x 단위 (예: 'OX', 'absolute')
     * @param {number} xValue x 값
     * @param {string} yUnit y 단위
     * @param {number} yValue y 값
     * @returns {LayoutHandler}
     */
    layoutStartPos(xUnit, xValue, yUnit, yValue) {
        this._layoutStart = { x: { unit: xUnit, value: xValue }, y: { unit: yUnit, value: yValue } };
        return this;
    }

    /**
     * 레이아웃의 좌우 여백을 지정합니다.
     * @param {string} unit - 여백 단위 ('WW', 'OW' 등)
     * @param {number} value - 여백 크기
     * @returns {LayoutHandler}
     */
    horMargin(unit, value) {
        this._horMargin = { unit, value };
        return this;
    }



    // --- 아이템 생성 영역 ---

    /**
     * 새로운 UI 아이템을 레이아웃에 추가합니다. 그룹 외부에 사용됩니다.
     * @param {string} type - UI 아이템 타입 (예: 'button', 'text' 등)
     * @param {string} [id=null] - 고유 식별자 ID
     * @returns {LayoutHandler}
     */
    item(type, id = null) {
        if (this._groupStack.length > 0) {
            console.warn(`LayoutHandler: item('${type}')이(가) 그룹 내부에 호출되었습니다. 가독성을 위해 .groupItem()을 사용하세요.`);
        }
        return this._createItem(type, id);
    }

    /**
     * 새로운 UI 아이템을 현재 열려있는 그룹(newItemGroup) 내부에 추가합니다.
     * @param {string} type - UI 아이템 타입
     * @param {string} [id=null] - 고유 식별자 ID
     * @returns {LayoutHandler}
     */
    groupItem(type, id = null) {
        if (this._groupStack.length === 0) {
            console.warn(`LayoutHandler: groupItem('${type}')이(가) 그룹 외부에 호출되었습니다. .item()을 사용하세요.`);
        }
        return this._createItem(type, id);
    }

    /**
     * @private
     * 새로운 UI 아이템 데이터를 내부 속성으로 생성합니다.
     * @param {string} type - UI 아이템 타입
     * @param {string} id - 고유 식별자 ID
     * @returns {LayoutHandler}
     */
    _createItem(type, id) {
        this._commitCurrentItem();
        this._currentItem = {
            id: id || crypto.randomUUID(),
            type,
            props: {},
            align: 'left',
            vAlign: 'top',
            dynamic: ['button', 'slider', 'toggle', 'segment_control', 'progress_bar'].includes(type)
        };
        this._parentItem = this._currentItem;
        return this;
    }

    /** 하단에서부터 위로 누적되는 아이템을 생성합니다. (vAlign: 'bottom' 자동 적용) */
    bottomItem(type, id = null) {
        this.item(type, id);
        this.vAlign('bottom');
        return this;
    }

    /**
     * 현재 아이템의 내부 자식 아이템으로 새로운 UI 요소를 추가합니다.
     * @param {string} type - UI 아이템 타입
     * @param {string} [id=null] - 고유 식별자 ID
     * @returns {LayoutHandler}
     */
    innerItem(type, id = null) {
        if (!this._parentItem) {
            console.warn("LayoutHandler: innerItem은 반드시 item() 호출 이후에 사용되어야 합니다.");
            return this.item(type, id);
        }

        if (!this._parentItem.children) this._parentItem.children = [];
        const child = {
            id: id || crypto.randomUUID(),
            type,
            props: {},
            align: 'left',
            vAlign: 'top',
            dynamic: ['button', 'slider', 'toggle', 'segment_control', 'progress_bar'].includes(type)
        };
        this._parentItem.children.push(child);

        this._currentItem = child; // innerItem을 _currentItem으로 대체하여 modifier가 적용되게 함
        return this;
    }

    /**
     * 상위/수평 정렬을 설정합니다 ('left', 'center', 'right').
     */
    align(type) {
        const target = this._currentItem || (this._groupStack.length > 0 ? this._groupStack[this._groupStack.length - 1] : null);
        if (target) target.align = type;
        return this;
    }

    /**
     * 수직 정렬을 설정합니다 ('top', 'center', 'bottom').
     * groupItem() 또는 groupItemGroup() 내부에서 유효합니다.
     */
    vAlign(type) {
        const inGroup = this._groupStack.length > 0;
        const hasItem = this._currentItem !== null;

        if (!inGroup && type !== 'bottom') {
            console.warn(`LayoutHandler: vAlign('${type}')는 그룹(hbox) 내부에서만 사용할 수 있습니다. 외부 item에서는 무시됩니다.`);
            return this;
        }

        if (hasItem) {
            this._currentItem.vAlign = type;
        } else if (inGroup) {
            this._groupStack[this._groupStack.length - 1].vAlign = type;
        }
        return this;
    }

    // --- 속성(Modifier) 체이닝 영역 ---

    /** 항목의 값(Value)을 지정합니다. margin 아이템 등의 크기를 지정할 때 사용합니다. */
    value(unit, val) {
        if (this._currentItem) {
            this._currentItem.unit = unit;
            this._currentItem.value = val;
        }
        return this;
    }

    /** 프리셋 이름을 지정합니다. (내부 CONSTANTS 참고) */
    stylePreset(preset) {
        if (this._currentItem) this._currentItem.preset = preset;
        return this;
    }

    text(textStr) {
        if (this._currentItem) this._currentItem.props.text = textStr;
        return this;
    }

    buttonText(textStr) {
        if (this._currentItem) this._currentItem.props.text = textStr;
        return this;
    }

    buttonColor(idleOrScheme, hover, text) {
        let _idle, _hover, _text;
        if (typeof idleOrScheme === 'object' && idleOrScheme !== null) {
            _idle = idleOrScheme.Idle || idleOrScheme.idle || idleOrScheme.Inactive || idleOrScheme.inactive;
            _hover = idleOrScheme.Hover || idleOrScheme.hover;
            _text = idleOrScheme.Text || idleOrScheme.text;
        } else {
            _idle = idleOrScheme;
            _hover = hover;
            _text = text;
        }

        if (this._currentItem) {
            if (_text !== undefined) this._currentItem.props.color = _text;
            if (_idle !== undefined) this._currentItem.props.idleColor = _idle;
            if (_hover !== undefined) this._currentItem.props.hoverColor = _hover;
        }
        return this;
    }

    valueRange(min, max) {
        if (this._currentItem) {
            this._currentItem.props.min = min;
            this._currentItem.props.max = max;
        }
        return this;
    }

    onClick(callback) {
        if (this._currentItem) this._currentItem.props.onClick = callback;
        return this;
    }

    /**
     * 현재 아이템을 동적(dynamic) 요소로 설정합니다.
     * @returns {LayoutHandler}
     */
    makeDynamic() {
        if (this._currentItem) this._currentItem.dynamic = true;
        return this;
    }

    radius(unitOrPreset, valueOrKey) {
        if (this._currentItem) {
            this._currentItem.radiusObj = { unit: unitOrPreset, value: valueOrKey };
        }
        return this;
    }

    width(unit, value) {
        const target = this._currentItem || (this._groupStack.length > 0 ? this._groupStack[this._groupStack.length - 1] : null);
        if (target) {
            if (unit === 'auto') target.widthObj = { unit: 'auto', value: undefined };
            else target.widthObj = { unit, value };
        }
        return this;
    }

    height(unit, value) {
        const target = this._currentItem || (this._groupStack.length > 0 ? this._groupStack[this._groupStack.length - 1] : null);
        if (target) {
            if (unit === 'auto') target.heightObj = { unit: 'auto', value: undefined };
            else target.heightObj = { unit, value };
        }
        return this;
    }

    customRenderOrder(orderInt) {
        const target = this._currentItem || (this._groupStack.length > 0 ? this._groupStack[this._groupStack.length - 1] : null);
        if (target) target.customRenderOrder = orderInt;
        return this;
    }

    prop(key, value) {
        if (this._currentItem) this._currentItem.props[key] = value;
        return this;
    }

    // --- 그룹(HBox) 설정 영역 ---

    newItemGroup(id = null) {
        if (this._groupStack.length > 0) {
            console.warn(`LayoutHandler: newItemGroup()이(가) 그룹 내부에 호출되었습니다. 가독성을 위해 .groupItemGroup()을 사용하세요.`);
        }
        return this._createGroup(id);
    }

    groupItemGroup(id = null) {
        if (this._groupStack.length === 0) {
            console.warn(`LayoutHandler: groupItemGroup()이(가) 그룹 외부에 호출되었습니다. .newItemGroup()을 사용하세요.`);
        }
        return this._createGroup(id);
    }

    _createGroup(id) {
        this._commitCurrentItem();
        const group = { id: id || crypto.randomUUID(), type: 'hbox', items: [], props: {}, align: 'left', vAlign: 'top' };

        if (this._groupStack.length > 0) {
            this._groupStack[this._groupStack.length - 1].items.push(group);
        } else {
            this._items.push(group);
        }
        this._groupStack.push(group);
        return this;
    }

    bottomItemGroup(id = null) {
        this.newItemGroup(id);
        this.vAlign('bottom');
        return this;
    }

    justifyContent(type, gapUnit, gapValue) {
        const targetGroup = this._groupStack.length > 0 ? this._groupStack[this._groupStack.length - 1] : null;
        if (targetGroup) {
            targetGroup.justifyContent = type;
            if (gapUnit && gapValue !== undefined) {
                targetGroup.gap = { unit: gapUnit, value: gapValue };
            }
        }
        return this;
    }

    closeGroup() {
        this._commitCurrentItem();
        if (this._groupStack.length > 0) {
            this._groupStack.pop();
        }
        return this;
    }

    // --- 파싱 및 렌더 트리 빌드 영역 ---

    _parseUnit(unit, value, refSize) {
        if (unit === 'parent') {
            return (value / 100) * (refSize || 0);
        }
        let result = 0;
        let maxVal = 0;
        switch (unit) {
            case 'WW': maxVal = getWW(); break;
            case 'WH': maxVal = getWH(); break;
            case 'OW': maxVal = this.parent.scaledW !== undefined ? this.parent.scaledW : (this.parent.width || getWW()); break;
            case 'OH': maxVal = this.parent.scaledH !== undefined ? this.parent.scaledH : (this.parent.height || getWH()); break;
            case 'OX': {
                const base = this.parent.scaledX !== undefined ? this.parent.scaledX : (this.parent.x || 0);
                const w = this.parent.scaledW !== undefined ? this.parent.scaledW : (this.parent.width || getWW());
                return base + (value / 100) * w; // OX, OY는 위치 좌표이므로 uiScale은 단위 변환에서 직접 개입하지 않고 OW/OH 등에 의해 간접 반영됨
            }
            case 'OY': {
                const base = this.parent.scaledY !== undefined ? this.parent.scaledY : (this.parent.y || 0);
                const h = this.parent.scaledH !== undefined ? this.parent.scaledH : (this.parent.height || getWH());
                return base + (value / 100) * h;
            }
            case 'absolute':
                return value * this.uiScale; // 절대 픽셀 값 스케일링
        }

        if (unit === 'WW' || unit === 'WH') {
            // 화면 전체 (Window) 기준 단위는 설정 스케일에 따라 확대/축소
            result = (value / 100) * maxVal * this.uiScale;
        } else {
            // 오버레이 기준 단위는 부모 단계에서 스케일이 반영되므로 추가 배율 곱을 적용하지 않음
            result = (value / 100) * maxVal;
        }

        return result;
    }

    /**
     * 설정된 레이아웃 정보를 바탕으로 실제 좌표를 계산하여 반환합니다.
     * @returns {{ dynamicItems: Object, staticItems: Object, components: Object }}
     */
    build() {
        if (this._groupStack.length > 0) {
            console.warn("LayoutHandler: closeGroup이 모두 호출되지 않은 상태에서 build()가 실행되었습니다. 열려있는 모든 그룹을 강제로 닫습니다.");
            while (this._groupStack.length > 0) {
                this.closeGroup();
            }
        }
        this._commitCurrentItem();

        const allGeneratedItems = [];
        const componentsMap = {};

        const startX = this._parseUnit(this._layoutStart.x.unit, this._layoutStart.x.value, getWW());
        const startY = this._parseUnit(this._layoutStart.y.unit, this._layoutStart.y.value, getWH());
        const layoutW = this._parseUnit(this._layoutSize.w.unit, this._layoutSize.w.value, getWW());
        const layoutH = this._parseUnit(this._layoutSize.h.unit, this._layoutSize.h.value, getWH());

        const horMarginPx = this._parseUnit(this._horMargin.unit, this._horMargin.value, layoutW);
        const innerW = layoutW - (horMarginPx * 2);
        const innerX = startX + horMarginPx;

        let currentY = startY;
        let currentBottomY = startY + layoutH;
        let naturalOrderCounter = { val: 0 };

        for (const item of this._items) {
            const isBottom = item.vAlign === 'bottom';
            const res = this._resolveLayout(item, innerW, layoutH, false);

            let itemX = innerX;
            let itemW = res.isAutoW ? innerW : res.w;

            if (item.align === 'center') itemX = innerX + (innerW / 2) - (itemW / 2);
            else if (item.align === 'right') itemX = innerX + innerW - itemW;

            let finalH = 0;
            if (isBottom) {
                finalH = res.h;
                currentBottomY -= finalH;
                res.finalize(itemX, currentBottomY, itemW, allGeneratedItems, componentsMap, naturalOrderCounter);
            } else {
                finalH = res.h;
                res.finalize(itemX, currentY, itemW, allGeneratedItems, componentsMap, naturalOrderCounter);
                currentY += finalH;
            }
        }

        allGeneratedItems.sort((a, b) => a.orderInt - b.orderInt);

        let currentRank = 0;
        const dynamicRet = {};
        const staticRet = {};
        const orderTracker = new Set();

        for (const gen of allGeneratedItems) {
            if (gen.orderInt !== undefined) {
                if (orderTracker.has(gen.orderInt)) {
                    console.warn(`LayoutHandler 모순 발생: customRenderOrder(${gen.orderInt}) 값이 중복 지정되었습니다. ID: ${gen.id}. 이 순서를 무시하고 후순위로 자동 재배정합니다.`);
                } else {
                    orderTracker.add(gen.orderInt);
                }
            }

            gen.item.renderOrder = currentRank;

            if (gen.dynamic) dynamicRet[currentRank] = gen;
            else staticRet[currentRank] = gen;

            currentRank++;
        }

        return { dynamicItems: dynamicRet, staticItems: staticRet, components: componentsMap };
    }

    _resolveLayout(item, parentW, parentH, isHboxChild) {
        if (item.type === 'spacing' || item.type === 'margin') {
            const val = this._parseUnit(item.unit, item.value, parentH);
            return {
                isAutoW: false, w: 0, h: val,
                finalize: () => { return { h: val }; }
            };
        }

        if (item.type === 'horMargin') {
            if (!isHboxChild) {
                console.warn(`LayoutHandler: horMargin은 groupItem() 내부(hbox child)에서만 사용할 수 있습니다.`);
                return { isAutoW: false, w: 0, h: 0, finalize: () => ({ h: 0 }) };
            }
            if (item.unit === 'expand') {
                return { _vAlign: 'top', isAutoW: true, w: 0, h: 0, finalize: () => ({ h: 0 }) };
            }
            const val = this._parseUnit(item.unit, item.value, parentW);
            return { _vAlign: 'top', isAutoW: false, w: val, h: 0, finalize: () => ({ h: 0 }) };
        }

        if (item.radiusObj && typeof item.props.radius === 'undefined') {
            if (item.radiusObj.unit === 'preset') {
                let key = item.radiusObj.value;
                if (key) key = key.toUpperCase();
                let presetData = UI_CONSTANTS[key];
                if (presetData) {
                    item.props.radius = this._parseUnit(presetData.BASE, presetData.VALUE, parentW);
                } else {
                    item.props.radius = 0;
                }
            } else {
                item.props.radius = this._parseUnit(item.radiusObj.unit, item.radiusObj.value, parentW);
            }
        }

        const isAutoW = item.widthObj && item.widthObj.unit === 'auto';

        let actualW = parentW;
        if (item.widthObj && !isAutoW) {
            actualW = this._parseUnit(item.widthObj.unit, item.widthObj.value, parentW);
        } else if (!item.widthObj && !isAutoW) {
            const presetData = (item.type === 'button' && item.preset) ? (BUTTON_CONSTANTS[item.preset.toUpperCase()] || {}) : {};
            if (item.type === 'button') actualW = this._parseUnit(presetData.WIDTH?.BASE || 'WW', presetData.WIDTH?.VALUE || 10, parentW);
            else if (item.type === 'slider' || item.type === 'line' || item.type === 'progress_bar') actualW = this._parseUnit('WW', 10, parentW);
            else if (item.type === 'toggle') actualW = this._parseUnit('WW', 5, parentW);
            else if (item.type === 'segment_control') actualW = this._parseUnit('WW', 15, parentW);
            else if (item.type === 'text') {
                const dummyEl = this._instantiateElement(item, 0, 0, parentW, parentH, undefined);
                actualW = dummyEl ? (dummyEl.width || 0) : 0;
                if (dummyEl) releaseUIItem(dummyEl);
            } else actualW = 0; // 기본 아이템 타입에서만 사용
        }

        if (item.type === 'hbox') {
            let initialW = parentW;
            if (item.widthObj && !isAutoW) {
                initialW = this._parseUnit(item.widthObj.unit, item.widthObj.value, parentW);
            }

            const childResolvers = [];
            for (const subItem of item.items) {
                const res = this._resolveLayout(subItem, initialW, parentH, true);
                res._vAlign = subItem.vAlign || 'top';
                childResolvers.push(res);
            }

            const measureHBox = (evalW) => {
                let usedW = 0;
                let numAuto = 0;
                for (const res of childResolvers) {
                    if (res.isAutoW) numAuto++;
                    else usedW += res.w;
                }

                const numItems = childResolvers.length;
                let gapPx = item.gap ? this._parseUnit(item.gap.unit, item.gap.value, evalW) : 0;

                let totalGaps = gapPx * Math.max(0, numItems - 1);
                if (item.justifyContent === 'space_around' || item.justifyContent === 'space-around') {
                    totalGaps = gapPx * numItems;
                } else if (item.justifyContent === 'space_evenly' || item.justifyContent === 'space-evenly') {
                    totalGaps = gapPx * (numItems + 1);
                }

                let autoW = 0;
                if (numAuto > 0) {
                    autoW = Math.max(0, (evalW - usedW - totalGaps) / numAuto);
                }

                let maxH = 0;
                for (const res of childResolvers) {
                    if (res.h > maxH) maxH = res.h;
                }
                return { autoW, numAuto, gapPx, usedW, totalGaps, maxH };
            };

            let definedW = parentW;
            if (isAutoW && isHboxChild) {
                definedW = 0;
            } else if (item.widthObj && !isAutoW) {
                definedW = initialW;
            } else if (!isAutoW) {
                const metrics = measureHBox(parentW);
                if (metrics.numAuto === 0) definedW = metrics.usedW + metrics.totalGaps;
                else definedW = parentW;
            }

            const metrics = measureHBox(definedW);

            return {
                isAutoW: isAutoW && isHboxChild,
                w: definedW,
                h: metrics.maxH,
                finalize: (x, y, overrideW, globals, compMap, orderRef) => {
                    const finalW = overrideW !== undefined ? overrideW : definedW;
                    const finalMetrics = measureHBox(finalW);

                    let spacing = finalMetrics.gapPx;
                    let iterX = x;
                    const numItems = childResolvers.length;
                    const numAuto = childResolvers.filter(r => r.isAutoW).length;

                    if (item.justifyContent === 'space_around' || item.justifyContent === 'space-around') {
                        iterX = x + spacing / 2;
                    } else if (item.justifyContent === 'space_evenly' || item.justifyContent === 'space-evenly') {
                        iterX = x + spacing;
                    }

                    if (numAuto === 0) {
                        if ((item.justifyContent === 'space_between' || item.justifyContent === 'space-between') && numItems > 1) {
                            spacing = Math.max(0, finalW - finalMetrics.usedW) / (numItems - 1);
                            iterX = x;
                        } else if ((item.justifyContent === 'space_around' || item.justifyContent === 'space-around') && numItems > 0) {
                            spacing = Math.max(0, finalW - finalMetrics.usedW) / numItems;
                            iterX = x + spacing / 2;
                        } else if ((item.justifyContent === 'space_evenly' || item.justifyContent === 'space-evenly') && numItems > 0) {
                            spacing = Math.max(0, finalW - finalMetrics.usedW) / (numItems + 1);
                            iterX = x + spacing;
                        } else if (item.justifyContent === 'center') {
                            iterX = x + Math.max(0, finalW - (finalMetrics.usedW + finalMetrics.totalGaps)) / 2;
                        } else if (item.justifyContent === 'right') {
                            iterX = x + Math.max(0, finalW - (finalMetrics.usedW + finalMetrics.totalGaps));
                        }
                    }

                    const maxH = finalMetrics.maxH;
                    for (const res of childResolvers) {
                        let finalItemW = res.isAutoW ? finalMetrics.autoW : res.w;
                        let itemY = y;
                        if (res._vAlign === 'center') itemY = y + Math.max(0, maxH - res.h) / 2;
                        else if (res._vAlign === 'bottom') itemY = y + Math.max(0, maxH - res.h);
                        res.finalize(iterX, itemY, finalItemW, globals, compMap, orderRef);
                        iterX += finalItemW + spacing;
                    }
                    return { h: finalMetrics.maxH };
                }
            };
        }

        let evalWForDummy = isAutoW && isHboxChild ? parentW : actualW;
        let dummyEl = this._instantiateElement(item, 0, 0, parentW, parentH, evalWForDummy);
        let elW = dummyEl ? (dummyEl.width || 0) : evalWForDummy;
        let exactH = dummyEl ? (dummyEl.height || 0) : 0;
        const baseElH = exactH; // 버튼 본래 높이 보존 ('parent' 단위 기준점)

        if (dummyEl) releaseUIItem(dummyEl);

        if (item.children && item.children.length > 0) {
            for (const childItem of item.children) {
                const childRes = this._resolveLayout(childItem, elW, baseElH, false);
                exactH += childRes.h;
            }
        }

        return {
            isAutoW: isAutoW && isHboxChild,
            w: elW,
            h: exactH,
            finalize: (x, y, overrideW, globals, compMap, orderRef) => {
                const evalW = overrideW !== undefined ? overrideW : (isAutoW ? parentW : actualW);
                const el = this._instantiateElement(item, x, y, parentW, parentH, evalW);

                if (el) {
                    const finalElW = el.width || 0;
                    let finalX = x;

                    if (item.align === 'center') finalX = x + (evalW / 2) - (finalElW / 2);
                    else if (item.align === 'right') finalX = x + evalW - finalElW;

                    el.x = finalX;

                    globals.push({
                        id: item.id, item: el, dynamic: item.dynamic,
                        orderInt: item.customRenderOrder !== undefined ? item.customRenderOrder : orderRef.val++
                    });
                    compMap[item.id] = el;

                    if (item.children && item.children.length > 0) {
                        let childY = y;
                        for (const childItem of item.children) {
                            const childRes = this._resolveLayout(childItem, finalElW, baseElH, false);
                            let childX = finalX;
                            if (childItem.align === 'center') childX = finalX + (finalElW / 2) - (childRes.w / 2);
                            else if (childItem.align === 'right') childX = finalX + finalElW - childRes.w;

                            childRes.finalize(childX, childY, undefined, globals, compMap, orderRef);
                            childY += childRes.h;
                        }
                    }
                }
                return { h: exactH };
            }
        };
    }

    _instantiateElement(item, x, y, parentW, parentH, forcedW) {
        return UIElementFactory.create(item, x, y, parentW, parentH, forcedW, this);
    }
}
