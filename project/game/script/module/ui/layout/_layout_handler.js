import { getData } from 'data/data_handler.js';
import { UIElementFactory } from 'ui/element/_ui_element_factory.js';
import { releaseUIItem } from 'ui/_ui_pool.js';
import { PositioningHandler } from 'ui/layout/_positioning_handler.js';

const BUTTON_CONSTANTS = getData('BUTTON_CONSTANTS');
const GLOBAL_CONSTANTS = getData('GLOBAL_CONSTANTS');
const UI_CONSTANTS = getData('UI_CONSTANTS');

/**
 * @class LayoutHandler
 * @description 게임 UI 컴포넌트의 위치(x, y)를 단위(WW, WH 등) 기반으로 자동 계산해 주는 빌더 패턴 클래스입니다.
 */
export class LayoutHandler {
    #layoutSize;
    #layoutStart;
    #horMargin;
    #items;
    #groupStack;
    #currentItem;
    #parentItem;

    /**
     * @param {object} parent - 오버레이 등의 부모 객체 (scaledW, scaledH, x, y 등을 참조)
     * @param {PositioningHandler|null} positioningHandler - 좌표 계산 핸들러
     */
    constructor(parent, positioningHandler = null) {
        this.parent = parent;
        this.layer = parent.layer || GLOBAL_CONSTANTS.FALLBACK_LAYOUT;
        this.uiScale = parent.uiScale || 1;
        this.positioningHandler = positioningHandler || new PositioningHandler(parent, this.uiScale);
        this.positioningHandler.resize(parent, this.uiScale);

        // 기본값: 부모의 전체 크기(OW/OH)와 기준 위치(OX/OY)
        this.#layoutSize = { w: { unit: 'OW', value: 100 }, h: { unit: 'OH', value: 100 } };
        this.#layoutStart = { x: { unit: 'OX', value: 0 }, y: { unit: 'OY', value: 0 } };
        this.#horMargin = { unit: 'WW', value: 0 };

        this.#items = [];
        this.#groupStack = [];
        this.#currentItem = null;
        this.#parentItem = null;
    }

    /**
         * 부모 요소 또는 화면 크기 변경 시 스케일을 다시 계산합니다.
         * @returns {LayoutHandler}
         */
    resize() {
        this.uiScale = this.parent.uiScale || 1;
        this.positioningHandler.resize(this.parent, this.uiScale);
        return this;
    }

    /**
         * 현재 편집 중인 아이템 등록을 완료하고 렌더 목록/그룹으로 푸시합니다.
         * @private
         */
    #commitCurrentItem() {
        if (this.#parentItem) {
            const currentGroup = this.#groupStack.length > 0 ? this.#groupStack[this.#groupStack.length - 1] : null;
            if (currentGroup) {
                currentGroup.items.push(this.#parentItem);
            } else {
                this.#items.push(this.#parentItem);
            }
        }
        this.#currentItem = null;
        this.#parentItem = null;
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
        this.#layoutSize = { w: { unit: wUnit, value: wValue }, h: { unit: hUnit, value: hValue } };
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
        this.#layoutStart = { x: { unit: xUnit, value: xValue }, y: { unit: yUnit, value: yValue } };
        return this;
    }

    /**
     * 레이아웃의 좌우 여백을 지정합니다.
     * @param {string} unit - 여백 단위 ('WW', 'OW' 등)
     * @param {number} value - 여백 크기
     * @returns {LayoutHandler}
     */
    horMargin(unit, value) {
        this.#horMargin = { unit, value };
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
        if (this.#groupStack.length > 0) {
            console.warn(`LayoutHandler: item('${type}')이(가) 그룹 내부에 호출되었습니다. 가독성을 위해 .groupItem()을 사용하세요.`);
        }
        return this.#createItem(type, id);
    }

    /**
     * 새로운 UI 아이템을 현재 열려있는 그룹(newItemGroup) 내부에 추가합니다.
     * @param {string} type - UI 아이템 타입
     * @param {string} [id=null] - 고유 식별자 ID
     * @returns {LayoutHandler}
     */
    groupItem(type, id = null) {
        if (this.#groupStack.length === 0) {
            console.warn(`LayoutHandler: groupItem('${type}')이(가) 그룹 외부에 호출되었습니다. .item()을 사용하세요.`);
        }
        return this.#createItem(type, id);
    }

    /**
     * @private
     * 새로운 UI 아이템 데이터를 내부 속성으로 생성합니다.
     * @param {string} type - UI 아이템 타입
     * @param {string} id - 고유 식별자 ID
     * @returns {LayoutHandler}
     */
    #createItem(type, id) {
        this.#commitCurrentItem();
        this.#currentItem = {
            id: id || crypto.randomUUID(),
            type,
            props: {},
            align: 'left',
            vAlign: 'top',
            dynamic: ['button', 'slider', 'toggle', 'segment_control', 'dropdown', 'progress_bar'].includes(type)
        };
        this.#parentItem = this.#currentItem;
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
        if (!this.#parentItem) {
            console.warn("LayoutHandler: innerItem은 반드시 item() 호출 이후에 사용되어야 합니다.");
            return this.item(type, id);
        }

        if (!this.#parentItem.children) this.#parentItem.children = [];
        const child = {
            id: id || crypto.randomUUID(),
            type,
            props: {},
            align: 'left',
            vAlign: 'top',
            dynamic: ['button', 'slider', 'toggle', 'segment_control', 'dropdown', 'progress_bar'].includes(type)
        };
        this.#parentItem.children.push(child);

        this.#currentItem = child; // innerItem을 _currentItem으로 대체하여 modifier가 적용되게 함
        return this;
    }

    /**
     * 상위/수평 정렬을 설정합니다 ('left', 'center', 'right').
     */
    align(type) {
        const target = this.#currentItem || (this.#groupStack.length > 0 ? this.#groupStack[this.#groupStack.length - 1] : null);
        if (target) target.align = type;
        return this;
    }

    /**
     * 수직 정렬을 설정합니다 ('top', 'center', 'bottom').
     * groupItem() 또는 groupItemGroup() 내부에서 유효합니다.
     */
    vAlign(type) {
        const inGroup = this.#groupStack.length > 0;
        const hasItem = this.#currentItem !== null;

        if (!inGroup && type !== 'bottom') {
            console.warn(`LayoutHandler: vAlign('${type}')는 그룹(hbox) 내부에서만 사용할 수 있습니다. 외부 item에서는 무시됩니다.`);
            return this;
        }

        if (hasItem) {
            this.#currentItem.vAlign = type;
        } else if (inGroup) {
            this.#groupStack[this.#groupStack.length - 1].vAlign = type;
        }
        return this;
    }

    // --- 속성(Modifier) 체이닝 영역 ---

    /** 항목의 값(Value)을 지정합니다. margin 아이템 등의 크기를 지정할 때 사용합니다. */
    value(unit, val) {
        if (this.#currentItem) {
            this.#currentItem.unit = unit;
            this.#currentItem.value = val;
        }
        return this;
    }

    /** 프리셋 이름을 지정합니다. (내부 CONSTANTS 참고) */
    stylePreset(preset) {
        if (this.#currentItem) this.#currentItem.preset = preset;
        return this;
    }

    text(textStr) {
        if (this.#currentItem) this.#currentItem.props.text = textStr;
        return this;
    }

    buttonText(textStr) {
        if (this.#currentItem) this.#currentItem.props.text = textStr;
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

        if (this.#currentItem) {
            if (_text !== undefined) this.#currentItem.props.color = _text;
            if (_idle !== undefined) this.#currentItem.props.idleColor = _idle;
            if (_hover !== undefined) this.#currentItem.props.hoverColor = _hover;
        }
        return this;
    }

    valueRange(min, max) {
        if (this.#currentItem) {
            this.#currentItem.props.min = min;
            this.#currentItem.props.max = max;
        }
        return this;
    }

    onClick(callback) {
        if (this.#currentItem) this.#currentItem.props.onClick = callback;
        return this;
    }

    /**
     * 현재 아이템을 동적(dynamic) 요소로 설정합니다.
     * @returns {LayoutHandler}
     */
    makeDynamic() {
        if (this.#currentItem) this.#currentItem.dynamic = true;
        return this;
    }

    radius(unitOrPreset, valueOrKey) {
        if (this.#currentItem) {
            this.#currentItem.radiusObj = { unit: unitOrPreset, value: valueOrKey };
        }
        return this;
    }

    width(unit, value) {
        const target = this.#currentItem || (this.#groupStack.length > 0 ? this.#groupStack[this.#groupStack.length - 1] : null);
        if (target) {
            if (unit === 'auto') target.widthObj = { unit: 'auto', value: undefined };
            else target.widthObj = { unit, value };
        }
        return this;
    }

    height(unit, value) {
        const target = this.#currentItem || (this.#groupStack.length > 0 ? this.#groupStack[this.#groupStack.length - 1] : null);
        if (target) {
            if (unit === 'auto') target.heightObj = { unit: 'auto', value: undefined };
            else target.heightObj = { unit, value };
        }
        return this;
    }

    customRenderOrder(orderInt) {
        const target = this.#currentItem || (this.#groupStack.length > 0 ? this.#groupStack[this.#groupStack.length - 1] : null);
        if (target) target.customRenderOrder = orderInt;
        return this;
    }

    prop(key, value) {
        if (this.#currentItem) this.#currentItem.props[key] = value;
        return this;
    }

    // --- 그룹(HBox) 설정 영역 ---

    newItemGroup(id = null) {
        if (this.#groupStack.length > 0) {
            console.warn(`LayoutHandler: newItemGroup()이(가) 그룹 내부에 호출되었습니다. 가독성을 위해 .groupItemGroup()을 사용하세요.`);
        }
        return this.#createGroup(id);
    }

    groupItemGroup(id = null) {
        if (this.#groupStack.length === 0) {
            console.warn(`LayoutHandler: groupItemGroup()이(가) 그룹 외부에 호출되었습니다. .newItemGroup()을 사용하세요.`);
        }
        return this.#createGroup(id);
    }

    #createGroup(id) {
        this.#commitCurrentItem();
        const group = { id: id || crypto.randomUUID(), type: 'hbox', items: [], props: {}, align: 'left', vAlign: 'top' };

        if (this.#groupStack.length > 0) {
            this.#groupStack[this.#groupStack.length - 1].items.push(group);
        } else {
            this.#items.push(group);
        }
        this.#groupStack.push(group);
        return this;
    }

    bottomItemGroup(id = null) {
        this.newItemGroup(id);
        this.vAlign('bottom');
        return this;
    }

    justifyContent(type, gapUnit, gapValue) {
        const targetGroup = this.#groupStack.length > 0 ? this.#groupStack[this.#groupStack.length - 1] : null;
        if (targetGroup) {
            targetGroup.justifyContent = type;
            if (gapUnit && gapValue !== undefined) {
                targetGroup.gap = { unit: gapUnit, value: gapValue };
            }
        }
        return this;
    }

    closeGroup() {
        this.#commitCurrentItem();
        if (this.#groupStack.length > 0) {
            this.#groupStack.pop();
        }
        return this;
    }

    // --- 파싱 및 렌더 트리 빌드 영역 ---

    parseUnit(unit, value, refSize) {
        return this.positioningHandler.parseUnit(unit, value, refSize);
    }

    /**
     * 설정된 레이아웃 정보를 바탕으로 실제 좌표를 계산하여 반환합니다.
     * @returns {{ dynamicItems: Object, staticItems: Object, components: Object }}
     */
    build() {
        this.resize();

        if (this.#groupStack.length > 0) {
            console.warn("LayoutHandler: closeGroup이 모두 호출되지 않은 상태에서 build()가 실행되었습니다. 열려있는 모든 그룹을 강제로 닫습니다.");
            while (this.#groupStack.length > 0) {
                this.closeGroup();
            }
        }
        this.#commitCurrentItem();

        const allGeneratedItems = [];
        const componentsMap = {};

        const frame = this.positioningHandler.resolveLayoutFrame(
            this.#layoutStart,
            this.#layoutSize,
            this.#horMargin
        );
        const startX = frame.startX;
        const startY = frame.startY;
        const layoutH = frame.layoutH;
        const innerW = frame.innerW;
        const innerX = frame.innerX;

        let currentY = startY;
        let currentBottomY = startY + layoutH;
        let naturalOrderCounter = { val: 0 };
        const layoutCtx = {
            globals: allGeneratedItems,
            compMap: componentsMap,
            orderRef: naturalOrderCounter
        };

        for (const item of this.#items) {
            const isBottom = item.vAlign === 'bottom';
            const res = this.#resolveLayout(item, innerW, layoutH, false);

            let itemW = res.isAutoW ? innerW : res.w;
            let itemX = this.positioningHandler.resolveAlignedX(item.align, innerX, innerW, itemW);

            let finalH = 0;
            if (isBottom) {
                finalH = res.h;
                currentBottomY -= finalH;
                res.finalize(itemX, currentBottomY, itemW, layoutCtx);
            } else {
                finalH = res.h;
                res.finalize(itemX, currentY, itemW, layoutCtx);
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

    #resolveLayout(item, parentW, parentH, isHboxChild) {
        if (item.type === 'spacing' || item.type === 'margin') {
            return this.#resolveSpacingLayout(item, parentH);
        }

        if (item.type === 'horMargin') {
            return this.#resolveHorMarginLayout(item, parentW, isHboxChild);
        }

        this.#applyRadius(item, parentW);
        const isAutoW = item.widthObj && item.widthObj.unit === 'auto';

        if (item.type === 'hbox') {
            return this.#resolveHBoxLayout(item, parentW, parentH, isHboxChild, isAutoW);
        }

        const actualW = this.#resolveActualWidth(item, parentW, parentH, isAutoW);
        return this.#resolveElementLayout(item, parentW, parentH, isHboxChild, isAutoW, actualW);
    }

    #resolveSpacingLayout(item, parentH) {
        const val = this.parseUnit(item.unit, item.value, parentH);
        return {
            isAutoW: false,
            w: 0,
            h: val,
            finalize: () => ({ h: val })
        };
    }

    #resolveHorMarginLayout(item, parentW, isHboxChild) {
        if (!isHboxChild) {
            console.warn(`LayoutHandler: horMargin은 groupItem() 내부(hbox child)에서만 사용할 수 있습니다.`);
            return { isAutoW: false, w: 0, h: 0, finalize: () => ({ h: 0 }) };
        }
        if (item.unit === 'expand') {
            return { _vAlign: 'top', isAutoW: true, w: 0, h: 0, finalize: () => ({ h: 0 }) };
        }
        const val = this.parseUnit(item.unit, item.value, parentW);
        return { _vAlign: 'top', isAutoW: false, w: val, h: 0, finalize: () => ({ h: 0 }) };
    }

    #applyRadius(item, parentW) {
        if (!item.radiusObj || typeof item.props.radius !== 'undefined') return;

        if (item.radiusObj.unit === 'preset') {
            let key = item.radiusObj.value;
            if (key) key = key.toUpperCase();
            const presetData = UI_CONSTANTS[key];
            if (presetData) {
                item.props.radius = this.parseUnit(presetData.BASE, presetData.VALUE, parentW);
            } else {
                item.props.radius = 0;
            }
            return;
        }

        item.props.radius = this.parseUnit(item.radiusObj.unit, item.radiusObj.value, parentW);
    }

    #resolveActualWidth(item, parentW, parentH, isAutoW) {
        if (item.widthObj && !isAutoW) {
            return this.parseUnit(item.widthObj.unit, item.widthObj.value, parentW);
        }

        if (item.widthObj || isAutoW) {
            return parentW;
        }

        const presetData = (item.type === 'button' && item.preset)
            ? (BUTTON_CONSTANTS[item.preset.toUpperCase()] || {})
            : {};

        if (item.type === 'button') {
            return this.parseUnit(presetData.WIDTH?.BASE || 'WW', presetData.WIDTH?.VALUE || 10, parentW);
        }
        if (item.type === 'slider' || item.type === 'line' || item.type === 'progress_bar') {
            return this.parseUnit('WW', 10, parentW);
        }
        if (item.type === 'toggle') {
            return this.parseUnit('WW', 5, parentW);
        }
        if (item.type === 'segment_control') {
            return this.parseUnit('WW', 15, parentW);
        }
        if (item.type === 'dropdown') {
            return this.parseUnit('WW', 15, parentW);
        }
        if (item.type === 'text') {
            const dummyEl = this.#instantiateElement(item, 0, 0, parentW, parentH, undefined);
            const textW = dummyEl ? (dummyEl.width || 0) : 0;
            if (dummyEl) releaseUIItem(dummyEl);
            return textW;
        }
        return 0;
    }

    #resolveHBoxLayout(item, parentW, parentH, isHboxChild, isAutoW) {
        let initialW = parentW;
        if (item.widthObj && !isAutoW) {
            initialW = this.parseUnit(item.widthObj.unit, item.widthObj.value, parentW);
        }

        const childResolvers = [];
        for (const subItem of item.items) {
            const res = this.#resolveLayout(subItem, initialW, parentH, true);
            res._vAlign = subItem.vAlign || 'top';
            childResolvers.push(res);
        }

        const justifyContent = this.#normalizeJustifyContent(item.justifyContent);
        let definedW = parentW;
        if (isAutoW && isHboxChild) {
            definedW = 0;
        } else if (item.widthObj && !isAutoW) {
            definedW = initialW;
        } else if (!isAutoW) {
            const metrics = this.#measureHBox(childResolvers, item, parentW, justifyContent);
            definedW = metrics.numAuto === 0 ? (metrics.usedW + metrics.totalGaps) : parentW;
        }

        const metrics = this.#measureHBox(childResolvers, item, definedW, justifyContent);
        return {
            isAutoW: isAutoW && isHboxChild,
            w: definedW,
            h: metrics.maxH,
            finalize: (x, y, overrideW, layoutCtx) => {
                const finalW = overrideW !== undefined ? overrideW : definedW;
                const finalMetrics = this.#measureHBox(childResolvers, item, finalW, justifyContent);
                const flow = this.#resolveHBoxFlow(justifyContent, x, finalW, finalMetrics);

                let iterX = flow.iterX;
                for (const res of childResolvers) {
                    const finalItemW = res.isAutoW ? finalMetrics.autoW : res.w;
                    let itemY = y;
                    if (res._vAlign === 'center') itemY = y + Math.max(0, finalMetrics.maxH - res.h) / 2;
                    else if (res._vAlign === 'bottom') itemY = y + Math.max(0, finalMetrics.maxH - res.h);
                    res.finalize(iterX, itemY, finalItemW, layoutCtx);
                    iterX += finalItemW + flow.spacing;
                }
                return { h: finalMetrics.maxH };
            }
        };
    }

    #measureHBox(childResolvers, item, evalW, justifyContent) {
        let usedW = 0;
        let numAuto = 0;
        let maxH = 0;

        for (const res of childResolvers) {
            if (res.isAutoW) numAuto++;
            else usedW += res.w;
            if (res.h > maxH) maxH = res.h;
        }

        const numItems = childResolvers.length;
        const gapPx = item.gap ? this.parseUnit(item.gap.unit, item.gap.value, evalW) : 0;

        let totalGaps = gapPx * Math.max(0, numItems - 1);
        if (justifyContent === 'space-around') {
            totalGaps = gapPx * numItems;
        } else if (justifyContent === 'space-evenly') {
            totalGaps = gapPx * (numItems + 1);
        }

        let autoW = 0;
        if (numAuto > 0) {
            autoW = Math.max(0, (evalW - usedW - totalGaps) / numAuto);
        }

        return { autoW, numAuto, gapPx, usedW, totalGaps, maxH, numItems };
    }

    #resolveHBoxFlow(justifyContent, startX, finalW, metrics) {
        let spacing = metrics.gapPx;
        let iterX = startX;

        if (justifyContent === 'space-around') {
            iterX = startX + spacing / 2;
        } else if (justifyContent === 'space-evenly') {
            iterX = startX + spacing;
        }

        if (metrics.numAuto > 0) {
            return { spacing, iterX };
        }

        if (justifyContent === 'space-between' && metrics.numItems > 1) {
            spacing = Math.max(0, finalW - metrics.usedW) / (metrics.numItems - 1);
            iterX = startX;
        } else if (justifyContent === 'space-around' && metrics.numItems > 0) {
            spacing = Math.max(0, finalW - metrics.usedW) / metrics.numItems;
            iterX = startX + spacing / 2;
        } else if (justifyContent === 'space-evenly' && metrics.numItems > 0) {
            spacing = Math.max(0, finalW - metrics.usedW) / (metrics.numItems + 1);
            iterX = startX + spacing;
        } else if (justifyContent === 'center') {
            iterX = startX + Math.max(0, finalW - (metrics.usedW + metrics.totalGaps)) / 2;
        } else if (justifyContent === 'right') {
            iterX = startX + Math.max(0, finalW - (metrics.usedW + metrics.totalGaps));
        }

        return { spacing, iterX };
    }

    #normalizeJustifyContent(justifyContent) {
        if (justifyContent === 'space_around') return 'space-around';
        if (justifyContent === 'space_evenly') return 'space-evenly';
        if (justifyContent === 'space_between') return 'space-between';
        return justifyContent;
    }

    #resolveElementLayout(item, parentW, parentH, isHboxChild, isAutoW, actualW) {
        const evalWForDummy = isAutoW && isHboxChild ? parentW : actualW;
        const dummyEl = this.#instantiateElement(item, 0, 0, parentW, parentH, evalWForDummy);
        const elW = dummyEl ? (dummyEl.width || 0) : evalWForDummy;
        let exactH = dummyEl ? (dummyEl.height || 0) : 0;
        const baseElH = exactH; // 버튼 본래 높이 보존 ('parent' 단위 기준점)

        if (dummyEl) releaseUIItem(dummyEl);

        if (item.children && item.children.length > 0) {
            for (const childItem of item.children) {
                const childRes = this.#resolveLayout(childItem, elW, baseElH, false);
                exactH += childRes.h;
            }
        }

        return {
            isAutoW: isAutoW && isHboxChild,
            w: elW,
            h: exactH,
            finalize: (x, y, overrideW, layoutCtx) => {
                const evalW = overrideW !== undefined ? overrideW : (isAutoW ? parentW : actualW);
                const el = this.#instantiateElement(item, x, y, parentW, parentH, evalW);
                if (!el) return { h: exactH };

                const finalElW = el.width || 0;
                let finalX = x;

                if (item.align === 'center') finalX = x + (evalW / 2) - (finalElW / 2);
                else if (item.align === 'right') finalX = x + evalW - finalElW;

                el.x = finalX;

                layoutCtx.globals.push({
                    id: item.id,
                    item: el,
                    dynamic: item.dynamic,
                    orderInt: item.customRenderOrder !== undefined ? item.customRenderOrder : layoutCtx.orderRef.val++
                });
                layoutCtx.compMap[item.id] = el;

                if (item.children && item.children.length > 0) {
                    let childY = y;
                    for (const childItem of item.children) {
                        const childRes = this.#resolveLayout(childItem, finalElW, baseElH, false);
                        let childX = finalX;
                        if (childItem.align === 'center') childX = finalX + (finalElW / 2) - (childRes.w / 2);
                        else if (childItem.align === 'right') childX = finalX + finalElW - childRes.w;

                        childRes.finalize(childX, childY, undefined, layoutCtx);
                        childY += childRes.h;
                    }
                }
                return { h: exactH };
            }
        };
    }

    #instantiateElement(item, x, y, parentW, parentH, forcedW) {
        return UIElementFactory.create(item, x, y, parentW, parentH, forcedW, this);
    }
}
