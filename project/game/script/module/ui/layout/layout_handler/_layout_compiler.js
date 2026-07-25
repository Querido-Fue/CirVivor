import { UIElementFactory } from 'ui/element/_ui_element_factory.js';
import { releaseUIItem } from 'ui/_ui_pool.js';
import { resolveButtonStyle } from 'ui/style/_component_style_resolver.js';
import {
    isApprovedButtonStyleToken,
    validateStyleContract
} from './_semantic_style_contract.js';

const DEFAULT_LAYOUT_ALIGN = 'left';
const LAYOUT_JUSTIFY_CONTENT_TYPES = Object.freeze([
    DEFAULT_LAYOUT_ALIGN,
    'center',
    'right',
    'space-between',
    'space-around',
    'space-evenly'
]);

/**
 * 선언된 레이아웃 트리를 실제 UI 요소와 좌표로 컴파일합니다.
 * HBox 측정과 배치, dummy 요소 수명, 렌더 순서를 한 경계에서 관리합니다.
 */
export class LayoutCompiler {
    #layoutHandler;

    /**
     * @param {object} layoutHandler - factory에 전달할 원래 LayoutHandler facade입니다.
     */
    constructor(layoutHandler) {
        this.#layoutHandler = layoutHandler;
    }

    /**
     * 선언 상태를 실제 렌더 목록과 컴포넌트 맵으로 컴파일합니다.
     * @param {object} declaration - 확정된 레이아웃 선언입니다.
     * @param {object} declaration.layoutStart - 레이아웃 시작점 규격입니다.
     * @param {object} declaration.layoutSize - 레이아웃 크기 규격입니다.
     * @param {object} declaration.paddingX - 수평 패딩 규격입니다.
     * @param {object[]} declaration.items - 루트 레이아웃 아이템입니다.
     * @returns {{dynamicItems:Array,staticItems:Array,components:Object}} 컴파일 결과입니다.
     */
    compile({ layoutStart, layoutSize, paddingX, items }) {
        const allGeneratedItems = [];
        const componentsMap = {};
        const frame = this.#layoutHandler.positioningHandler.resolveLayoutFrame(
            layoutStart,
            layoutSize,
            paddingX
        );
        const startX = frame.startX;
        const startY = frame.startY;
        const layoutH = frame.layoutH;
        const innerW = frame.innerW;
        const innerX = frame.innerX;

        let currentY = startY;
        let currentBottomY = startY + layoutH;
        const layoutCtx = {
            globals: allGeneratedItems,
            compMap: componentsMap,
            orderRef: { val: 0 }
        };

        for (const item of items) {
            const isBottom = item.vAlign === 'bottom';
            const res = this.#resolveLayout(item, innerW, layoutH, false);
            const itemW = res.isFlexibleW ? innerW : res.w;
            const itemX = this.#layoutHandler.positioningHandler.resolveAlignedX(
                item.align,
                innerX,
                innerW,
                itemW
            );

            if (isBottom) {
                currentBottomY -= res.h;
                res.finalize(itemX, currentBottomY, itemW, layoutCtx);
            } else {
                res.finalize(itemX, currentY, itemW, layoutCtx);
                currentY += res.h;
            }
        }

        allGeneratedItems.sort((a, b) => a.orderInt - b.orderInt);

        const dynamicItems = [];
        const staticItems = [];
        const orderTracker = new Set();

        for (let currentRank = 0; currentRank < allGeneratedItems.length; currentRank++) {
            const generated = allGeneratedItems[currentRank];
            if (generated.orderInt !== undefined) {
                if (orderTracker.has(generated.orderInt)) {
                    console.warn(`LayoutHandler 모순 발생: customRenderOrder(${generated.orderInt}) 값이 중복 지정되었습니다. ID: ${generated.id}. 이 순서를 무시하고 후순위로 자동 재배정합니다.`);
                } else {
                    orderTracker.add(generated.orderInt);
                }
            }

            generated.item.renderOrder = currentRank;
            if (generated.dynamic) {
                dynamicItems.push(generated);
            } else {
                staticItems.push(generated);
            }
        }

        return {
            dynamicItems,
            staticItems,
            components: componentsMap
        };
    }

    /**
     * 레이아웃 단위와 값을 facade의 공개 parser로 변환합니다.
     * @param {string} unit - 레이아웃 단위입니다.
     * @param {number} value - 단위 값입니다.
     * @param {number} refSize - parent 단위 계산 기준 크기입니다.
     * @returns {number} 변환된 픽셀 값입니다.
     */
    #parseUnit(unit, value, refSize) {
        return this.#layoutHandler.parseUnit(unit, value, refSize);
    }

    /**
     * 아이템 타입에 맞는 레이아웃 resolver를 생성합니다.
     * @param {object} item - 레이아웃 아이템 상태입니다.
     * @param {number} parentW - 부모 너비입니다.
     * @param {number} parentH - 부모 높이입니다.
     * @param {boolean} isHboxChild - hbox 내부 자식 여부입니다.
     * @returns {object} 크기와 finalize 함수를 가진 resolver입니다.
     */
    #resolveLayout(item, parentW, parentH, isHboxChild) {
        if (item.type === 'spacing' || item.type === 'margin') {
            return this.#resolveSpacingLayout(item, parentH);
        }

        if (item.type === 'spacer') {
            return this.#resolveSpacerLayout(item, parentW, isHboxChild);
        }

        validateStyleContract(item);
        this.#applyRadius(item, parentW);
        const widthMode = item.widthObj?.unit || null;

        if (item.type === 'hbox') {
            return this.#resolveHBoxLayout(
                item,
                parentW,
                parentH,
                isHboxChild,
                widthMode
            );
        }

        const actualW = this.#resolveActualWidth(
            item,
            parentW,
            parentH,
            widthMode
        );
        return this.#resolveElementLayout(
            item,
            parentW,
            parentH,
            isHboxChild,
            widthMode,
            actualW
        );
    }

    /**
     * 세로 spacing/margin 아이템의 resolver를 생성합니다.
     * @param {object} item - spacing 아이템 상태입니다.
     * @param {number} parentH - 부모 높이입니다.
     * @returns {object} spacing resolver입니다.
     */
    #resolveSpacingLayout(item, parentH) {
        const value = this.#parseUnit(item.unit, item.value, parentH);
        return {
            isFlexibleW: false,
            w: 0,
            h: value,
            finalize: () => ({ h: value })
        };
    }

    /**
     * hbox 내부 spacer 아이템의 resolver를 생성합니다.
     * @param {object} item - spacer 아이템 상태입니다.
     * @param {number} parentW - 부모 너비입니다.
     * @param {boolean} isHboxChild - hbox 내부 자식 여부입니다.
     * @returns {object} spacer resolver입니다.
     */
    #resolveSpacerLayout(item, parentW, isHboxChild) {
        if (!isHboxChild) {
            console.warn("LayoutHandler: spacer()는 그룹 내부에서만 사용할 수 있습니다.");
            return {
                isFlexibleW: false,
                w: 0,
                h: 0,
                finalize: () => ({ h: 0 })
            };
        }
        if (item.unit === 'fill') {
            return {
                _vAlign: 'top',
                isFlexibleW: true,
                w: 0,
                h: 0,
                finalize: () => ({ h: 0 })
            };
        }
        const value = this.#parseUnit(item.unit, item.value, parentW);
        return {
            _vAlign: 'top',
            isFlexibleW: false,
            w: value,
            h: 0,
            finalize: () => ({ h: 0 })
        };
    }

    /**
     * 아이템의 radius 지정값을 실제 픽셀 props로 반영합니다.
     * @param {object} item - 레이아웃 아이템 상태입니다.
     * @param {number} parentW - radius 계산 기준 너비입니다.
     * @returns {void}
     */
    #applyRadius(item, parentW) {
        if (!item.radiusObj) {
            return;
        }
        item.props.radius = this.#parseUnit(
            item.radiusObj.unit,
            item.radiusObj.value,
            parentW
        );
    }

    /**
     * 아이템의 최종 너비를 타입, 컴포넌트 스타일, width 규칙에 따라 계산합니다.
     * @param {object} item - 레이아웃 아이템 상태입니다.
     * @param {number} parentW - 부모 너비입니다.
     * @param {number} parentH - 부모 높이입니다.
     * @param {string|null} widthMode - width 규칙입니다.
     * @returns {number} 계산된 아이템 너비입니다.
     */
    #resolveActualWidth(item, parentW, parentH, widthMode) {
        if (widthMode && widthMode !== 'fill' && widthMode !== 'content') {
            return this.#parseUnit(
                item.widthObj.unit,
                item.widthObj.value,
                parentW
            );
        }

        if (widthMode === 'fill') {
            return parentW;
        }

        if (widthMode === 'content') {
            const dummyElement = this.#instantiateElement(
                item,
                0,
                0,
                parentW,
                parentH,
                undefined
            );
            const contentW = dummyElement ? (dummyElement.width || 0) : 0;
            if (dummyElement) {
                releaseUIItem(dummyElement);
            }
            return contentW;
        }

        if (item.type === 'button') {
            if (isApprovedButtonStyleToken(item.buttonStyle)) {
                return resolveButtonStyle(
                    item.buttonStyle,
                    (metric) => this.#parseUnit(
                        metric.BASE,
                        metric.VALUE,
                        parentW
                    )
                ).width;
            }
            return this.#parseUnit('WW', 10, parentW);
        }
        if (
            item.type === 'slider'
            || item.type === 'line'
            || item.type === 'progress_bar'
        ) {
            return this.#parseUnit('WW', 10, parentW);
        }
        if (item.type === 'toggle') {
            return this.#parseUnit('WW', 5, parentW);
        }
        if (item.type === 'segment_control' || item.type === 'dropdown') {
            return this.#parseUnit('WW', 15, parentW);
        }
        if (item.type === 'text') {
            const dummyElement = this.#instantiateElement(
                item,
                0,
                0,
                parentW,
                parentH,
                undefined
            );
            const textW = dummyElement ? (dummyElement.width || 0) : 0;
            if (dummyElement) {
                releaseUIItem(dummyElement);
            }
            return textW;
        }
        return 0;
    }

    /**
     * hbox 그룹의 크기와 자식 배치 finalize 함수를 계산합니다.
     * @param {object} item - hbox 아이템 상태입니다.
     * @param {number} parentW - 부모 너비입니다.
     * @param {number} parentH - 부모 높이입니다.
     * @param {boolean} isHboxChild - 상위 hbox 내부 자식 여부입니다.
     * @param {string|null} widthMode - width 규칙입니다.
     * @returns {object} hbox resolver입니다.
     */
    #resolveHBoxLayout(item, parentW, parentH, isHboxChild, widthMode) {
        const isFillW = widthMode === 'fill';
        const isContentW = widthMode === 'content';
        let initialW = parentW;
        if (item.widthObj && !isFillW && !isContentW) {
            initialW = this.#parseUnit(
                item.widthObj.unit,
                item.widthObj.value,
                parentW
            );
        }

        const childResolvers = [];
        for (const subItem of item.items) {
            const resolver = this.#resolveLayout(
                subItem,
                initialW,
                parentH,
                true
            );
            resolver._vAlign = subItem.vAlign || 'top';
            childResolvers.push(resolver);
        }

        const justifyContent = this.#normalizeJustifyContent(
            item.justifyContent
        );
        let definedW = parentW;
        if (isFillW && isHboxChild) {
            definedW = 0;
        } else if (isFillW) {
            definedW = parentW;
        } else if (item.widthObj && !isFillW && !isContentW) {
            definedW = initialW;
        } else {
            const metrics = this.#measureHBox(
                childResolvers,
                item,
                parentW,
                justifyContent
            );
            definedW = metrics.numFlexible === 0
                ? metrics.usedW + metrics.totalGaps
                : parentW;
        }

        const metrics = this.#measureHBox(
            childResolvers,
            item,
            definedW,
            justifyContent
        );
        return {
            isFlexibleW: isFillW && isHboxChild,
            w: definedW,
            h: metrics.maxH,
            finalize: (x, y, overrideW, layoutCtx) => {
                const finalW = overrideW !== undefined ? overrideW : definedW;
                const finalMetrics = this.#measureHBox(
                    childResolvers,
                    item,
                    finalW,
                    justifyContent
                );
                const flow = this.#resolveHBoxFlow(
                    justifyContent,
                    x,
                    finalW,
                    finalMetrics
                );

                let iterX = flow.iterX;
                for (const resolver of childResolvers) {
                    const finalItemW = resolver.isFlexibleW
                        ? finalMetrics.flexibleW
                        : resolver.w;
                    let itemY = y;
                    if (resolver._vAlign === 'center') {
                        itemY = y + Math.max(
                            0,
                            finalMetrics.maxH - resolver.h
                        ) / 2;
                    } else if (resolver._vAlign === 'bottom') {
                        itemY = y + Math.max(
                            0,
                            finalMetrics.maxH - resolver.h
                        );
                    }
                    resolver.finalize(
                        iterX,
                        itemY,
                        finalItemW,
                        layoutCtx
                    );
                    iterX += finalItemW + flow.spacing;
                }
                return { h: finalMetrics.maxH };
            }
        };
    }

    /**
     * hbox 자식 resolver 목록의 폭, 높이, gap 메트릭을 계산합니다.
     * @param {object[]} childResolvers - 자식 resolver 목록입니다.
     * @param {object} item - hbox 아이템 상태입니다.
     * @param {number} evalW - 메트릭 계산 기준 너비입니다.
     * @param {string} justifyContent - 정규화된 수평 배치 방식입니다.
     * @returns {object} hbox 메트릭입니다.
     */
    #measureHBox(childResolvers, item, evalW, justifyContent) {
        let usedW = 0;
        let numFlexible = 0;
        let maxH = 0;

        for (const resolver of childResolvers) {
            if (resolver.isFlexibleW) {
                numFlexible++;
            } else {
                usedW += resolver.w;
            }
            if (resolver.h > maxH) {
                maxH = resolver.h;
            }
        }

        const numItems = childResolvers.length;
        const gapPx = item.gap
            ? this.#parseUnit(item.gap.unit, item.gap.value, evalW)
            : 0;
        let totalGaps = gapPx * Math.max(0, numItems - 1);
        if (justifyContent === 'space-around') {
            totalGaps = gapPx * numItems;
        } else if (justifyContent === 'space-evenly') {
            totalGaps = gapPx * (numItems + 1);
        }

        let flexibleW = 0;
        if (numFlexible > 0) {
            flexibleW = Math.max(
                0,
                (evalW - usedW - totalGaps) / numFlexible
            );
        }

        return {
            flexibleW,
            numFlexible,
            gapPx,
            usedW,
            totalGaps,
            maxH,
            numItems
        };
    }

    /**
     * hbox의 시작 X와 아이템 간 spacing을 계산합니다.
     * @param {string} justifyContent - 정규화된 수평 배치 방식입니다.
     * @param {number} startX - hbox 시작 X입니다.
     * @param {number} finalW - hbox 최종 너비입니다.
     * @param {object} metrics - hbox 메트릭입니다.
     * @returns {{spacing:number,iterX:number}} 배치 흐름 정보입니다.
     */
    #resolveHBoxFlow(justifyContent, startX, finalW, metrics) {
        let spacing = metrics.gapPx;
        let iterX = startX;

        if (justifyContent === 'space-around') {
            iterX = startX + spacing / 2;
        } else if (justifyContent === 'space-evenly') {
            iterX = startX + spacing;
        }

        if (metrics.numFlexible > 0) {
            return { spacing, iterX };
        }

        if (justifyContent === 'space-between' && metrics.numItems > 1) {
            spacing = Math.max(0, finalW - metrics.usedW)
                / (metrics.numItems - 1);
            iterX = startX;
        } else if (
            justifyContent === 'space-around'
            && metrics.numItems > 0
        ) {
            spacing = Math.max(0, finalW - metrics.usedW) / metrics.numItems;
            iterX = startX + spacing / 2;
        } else if (
            justifyContent === 'space-evenly'
            && metrics.numItems > 0
        ) {
            spacing = Math.max(0, finalW - metrics.usedW)
                / (metrics.numItems + 1);
            iterX = startX + spacing;
        } else if (justifyContent === 'center') {
            iterX = startX + Math.max(
                0,
                finalW - (metrics.usedW + metrics.totalGaps)
            ) / 2;
        } else if (justifyContent === 'right') {
            iterX = startX + Math.max(
                0,
                finalW - (metrics.usedW + metrics.totalGaps)
            );
        }

        return { spacing, iterX };
    }

    /**
     * hbox 수평 배치 방식을 지원 값으로 정규화합니다.
     * @param {string|undefined} justifyContent - 입력 배치 방식입니다.
     * @returns {string} 정규화된 배치 방식입니다.
     */
    #normalizeJustifyContent(justifyContent) {
        return LAYOUT_JUSTIFY_CONTENT_TYPES.includes(justifyContent)
            ? justifyContent
            : DEFAULT_LAYOUT_ALIGN;
    }

    /**
     * 일반 UI 요소의 크기와 자식 배치 finalize 함수를 계산합니다.
     * @param {object} item - 레이아웃 아이템 상태입니다.
     * @param {number} parentW - 부모 너비입니다.
     * @param {number} parentH - 부모 높이입니다.
     * @param {boolean} isHboxChild - hbox 내부 자식 여부입니다.
     * @param {string|null} widthMode - width 규칙입니다.
     * @param {number} actualW - 기본 계산 너비입니다.
     * @returns {object} 요소 resolver입니다.
     */
    #resolveElementLayout(
        item,
        parentW,
        parentH,
        isHboxChild,
        widthMode,
        actualW
    ) {
        const isFillW = widthMode === 'fill';
        const evalWForDummy = isFillW && isHboxChild ? parentW : actualW;
        const dummyElement = this.#instantiateElement(
            item,
            0,
            0,
            parentW,
            parentH,
            evalWForDummy
        );
        const elementW = dummyElement
            ? (dummyElement.width || 0)
            : evalWForDummy;
        let exactH = dummyElement ? (dummyElement.height || 0) : 0;
        const baseElementH = exactH;

        if (dummyElement) {
            releaseUIItem(dummyElement);
        }

        if (item.children && item.children.length > 0) {
            for (const childItem of item.children) {
                const childResolver = this.#resolveLayout(
                    childItem,
                    elementW,
                    baseElementH,
                    false
                );
                exactH += childResolver.h;
            }
        }

        return {
            isFlexibleW: isFillW && isHboxChild,
            w: elementW,
            h: exactH,
            finalize: (x, y, overrideW, layoutCtx) => {
                const evalW = overrideW !== undefined
                    ? overrideW
                    : (isFillW ? parentW : actualW);
                const element = this.#instantiateElement(
                    item,
                    x,
                    y,
                    parentW,
                    parentH,
                    evalW
                );
                if (!element) {
                    return { h: exactH };
                }

                const finalElementW = element.width || 0;
                let finalX = x;
                if (item.align === 'center') {
                    finalX = x + (evalW / 2) - (finalElementW / 2);
                } else if (item.align === 'right') {
                    finalX = x + evalW - finalElementW;
                }
                element.x = finalX;

                layoutCtx.globals.push({
                    id: item.id,
                    item: element,
                    dynamic: item.dynamic,
                    orderInt: item.customRenderOrder !== undefined
                        ? item.customRenderOrder
                        : layoutCtx.orderRef.val++
                });
                layoutCtx.compMap[item.id] = element;

                if (item.children && item.children.length > 0) {
                    let childY = y;
                    for (const childItem of item.children) {
                        const childResolver = this.#resolveLayout(
                            childItem,
                            finalElementW,
                            baseElementH,
                            false
                        );
                        let childX = finalX;
                        if (childItem.align === 'center') {
                            childX = finalX
                                + (finalElementW / 2)
                                - (childResolver.w / 2);
                        } else if (childItem.align === 'right') {
                            childX = finalX
                                + finalElementW
                                - childResolver.w;
                        }

                        childResolver.finalize(
                            childX,
                            childY,
                            undefined,
                            layoutCtx
                        );
                        childY += childResolver.h;
                    }
                }
                return { h: exactH };
            }
        };
    }

    /**
     * UI 요소 팩토리로 실제 요소 인스턴스를 생성합니다.
     * 일곱 번째 인수에는 compiler가 아닌 원래 facade를 전달합니다.
     * @param {object} item - 레이아웃 아이템 상태입니다.
     * @param {number} x - 생성 X 좌표입니다.
     * @param {number} y - 생성 Y 좌표입니다.
     * @param {number} parentW - 부모 너비입니다.
     * @param {number} parentH - 부모 높이입니다.
     * @param {number|undefined} forcedW - 강제 너비입니다.
     * @returns {object|null} 생성된 UI 요소입니다.
     */
    #instantiateElement(item, x, y, parentW, parentH, forcedW) {
        return UIElementFactory.create(
            item,
            x,
            y,
            parentW,
            parentH,
            forcedW,
            this.#layoutHandler
        );
    }
}
