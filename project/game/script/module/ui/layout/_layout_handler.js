import { PositioningHandler } from 'ui/layout/_positioning_handler.js';
import {
    isLayoutMetric,
    LayoutDeclarationState,
    normalizeMetricSpec
} from './layout_handler/_layout_declaration_state.js';
import { LayoutCompiler } from './layout_handler/_layout_compiler.js';
import {
    assertAllowedPropKey,
    assertButtonStyleAssignment,
    assertTextStyleAssignment,
    assertValueTextStyleAssignment
} from './layout_handler/_semantic_style_contract.js';

const DEFAULT_LAYOUT_LAYER = 'ui';
const DEFAULT_SPACER_UNIT = 'fill';

/**
 * @class LayoutHandler
 * @description 게임 UI 선언을 fluent API로 수집하고 compiler에 전달하는 facade입니다.
 */
export class LayoutHandler {
    #declarationState;

    /**
     * @param {object} parent - 오버레이 등의 부모 객체입니다.
     * @param {PositioningHandler|null} positioningHandler - 좌표 계산 핸들러입니다.
     */
    constructor(parent, positioningHandler = null) {
        this.parent = parent;
        this.layer = parent.layer || DEFAULT_LAYOUT_LAYER;
        this.uiScale = parent.uiScale || 1;
        this.positioningHandler = positioningHandler
            || new PositioningHandler(parent, this.uiScale);
        this.positioningHandler.resize(parent, this.uiScale);
        this.#declarationState = new LayoutDeclarationState();
    }

    /**
     * 부모 요소 또는 화면 크기 변경 시 스케일을 다시 계산합니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    resize() {
        this.uiScale = this.parent.uiScale || 1;
        this.positioningHandler.resize(this.parent, this.uiScale);
        return this;
    }

    /**
     * 현재 편집 중인 아이템 선언을 확정합니다.
     * @returns {void}
     * @private
     */
    #commitCurrentItem() {
        this.#declarationState.commitCurrentItem();
    }

    /**
     * 현재 열려 있는 마지막 그룹을 반환합니다.
     * @returns {object|null} 현재 그룹 상태입니다.
     * @private
     */
    #getCurrentGroup() {
        return this.#declarationState.getCurrentGroup();
    }

    /**
     * modifier가 적용될 현재 아이템 또는 그룹을 반환합니다.
     * @returns {object|null} 현재 modifier 대상입니다.
     * @private
     */
    #getActiveLayoutTarget() {
        return this.#declarationState.getActiveLayoutTarget();
    }

    /**
     * 현재 modifier가 적용될 아이템을 반환합니다.
     * @returns {object|null} 현재 아이템입니다.
     * @private
     */
    get #currentItem() {
        return this.#declarationState.currentItem;
    }

    /**
     * 크기 지정 인자를 내부 규격으로 정규화합니다.
     * @param {string|{BASE:string,VALUE:number}} unit - 단위, 키워드 또는 토큰입니다.
     * @param {number} [value] - 입력 값입니다.
     * @returns {{unit:string,value:number|undefined}} 정규화된 규격입니다.
     * @private
     */
    #normalizeMetricSpec(unit, value) {
        return normalizeMetricSpec(unit, value);
    }

    /**
     * 레이아웃의 전체 가상 크기를 지정합니다.
     * @param {string} wUnit - 너비 단위입니다.
     * @param {number} wValue - 너비 값입니다.
     * @param {string} hUnit - 높이 단위입니다.
     * @param {number} hValue - 높이 값입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    layoutSize(wUnit, wValue, hUnit, hValue) {
        this.#declarationState.setLayoutSize(
            wUnit,
            wValue,
            hUnit,
            hValue
        );
        return this;
    }

    /**
     * 레이아웃 시작 오프셋을 지정합니다.
     * @param {string} xUnit - x 단위입니다.
     * @param {number} xValue - x 값입니다.
     * @param {string} yUnit - y 단위입니다.
     * @param {number} yValue - y 값입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    layoutStartPos(xUnit, xValue, yUnit, yValue) {
        this.#declarationState.setLayoutStart(
            xUnit,
            xValue,
            yUnit,
            yValue
        );
        return this;
    }

    /**
     * 레이아웃 내부 좌우 패딩을 지정합니다.
     * @param {string|{BASE:string,VALUE:number}} unit - 패딩 단위 또는 토큰입니다.
     * @param {number} [value] - 패딩 값입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    paddingX(unit, value) {
        this.#declarationState.setPaddingX(
            this.#normalizeMetricSpec(unit, value)
        );
        return this;
    }

    /**
     * 현재 문맥에 새 UI 아이템을 추가합니다.
     * @param {string} type - UI 아이템 타입입니다.
     * @param {string|null} [id=null] - 고유 식별자입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    item(type, id = null) {
        return this.#createItem(type, id);
    }

    /**
     * 새 UI 아이템 선언을 시작합니다.
     * @param {string} type - UI 아이템 타입입니다.
     * @param {string|null} id - 고유 식별자입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     * @private
     */
    #createItem(type, id) {
        this.#declarationState.createItem(type, id);
        return this;
    }

    /**
     * 하단에서부터 위로 누적되는 아이템을 추가합니다.
     * @param {string} type - UI 아이템 타입입니다.
     * @param {string|null} [id=null] - 고유 식별자입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    bottomItem(type, id = null) {
        this.item(type, id);
        this.vAlign('bottom');
        return this;
    }

    /**
     * 현재 부모 아이템에 자식 아이템을 추가합니다.
     * @param {string} type - UI 아이템 타입입니다.
     * @param {string|null} [id=null] - 고유 식별자입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    child(type, id = null) {
        if (!this.#declarationState.createChild(type, id)) {
            console.warn("LayoutHandler: child()는 반드시 item() 호출 이후에 사용되어야 합니다.");
            return this.item(type, id);
        }
        return this;
    }

    /**
     * 현재 아이템 내부에 세로 공간을 추가합니다.
     * @param {string|{BASE:string,VALUE:number}} unit - 간격 단위 또는 토큰입니다.
     * @param {number} [value] - 간격 값입니다.
     * @param {string|null} [id=null] - 고유 식별자입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    childSpace(unit, value, id = null) {
        return this.child('spacing', id).value(unit, value);
    }

    /**
     * 현재 문맥에 세로 공간을 추가합니다.
     * @param {string|{BASE:string,VALUE:number}} unit - 간격 단위 또는 토큰입니다.
     * @param {number} [value] - 간격 값입니다.
     * @param {string|null} [id=null] - 고유 식별자입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    space(unit, value, id = null) {
        return this.item('spacing', id).value(unit, value);
    }

    /**
     * 하단 누적 영역에 세로 공간을 추가합니다.
     * @param {string|{BASE:string,VALUE:number}} unit - 간격 단위 또는 토큰입니다.
     * @param {number} [value] - 간격 값입니다.
     * @param {string|null} [id=null] - 고유 식별자입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    bottomSpace(unit, value, id = null) {
        return this.bottomItem('spacing', id).value(unit, value);
    }

    /**
     * 현재 그룹 안에 수평 여백 또는 확장 스페이서를 추가합니다.
     * @param {string} [unit='fill'] - 폭 단위입니다.
     * @param {number} [value] - 고정 폭 값입니다.
     * @param {string|null} [id=null] - 고유 식별자입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    spacer(unit = DEFAULT_SPACER_UNIT, value, id = null) {
        return this.item('spacer', id).value(unit, value);
    }

    /**
     * 수평 정렬을 지정합니다.
     * @param {string} type - left, center, right 중 하나입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    align(type) {
        const target = this.#getActiveLayoutTarget();
        if (target) {
            target.align = type;
            if (target.type === 'text' && target.props.align === undefined) {
                target.props.align = type;
            }
        }
        return this;
    }

    /**
     * 수직 정렬을 지정합니다.
     * @param {string} type - top, center, bottom 중 하나입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    vAlign(type) {
        const inGroup = this.#declarationState.inGroup;
        const hasItem = this.#currentItem !== null;

        if (!inGroup && type !== 'bottom') {
            console.warn(`LayoutHandler: vAlign('${type}')는 그룹(hbox) 내부에서만 사용할 수 있습니다. 외부 item에서는 무시됩니다.`);
            return this;
        }

        if (hasItem) {
            this.#currentItem.vAlign = type;
        } else if (inGroup) {
            this.#getCurrentGroup().vAlign = type;
        }
        return this;
    }

    /**
     * 현재 아이템의 단위 기반 값을 지정합니다.
     * @param {string|{BASE:string,VALUE:number}} unit - 값 단위 또는 토큰입니다.
     * @param {number} [val] - 값입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    value(unit, val) {
        if (this.#currentItem) {
            const metric = this.#normalizeMetricSpec(unit, val);
            this.#currentItem.unit = metric.unit;
            this.#currentItem.value = metric.value;
        }
        return this;
    }

    /**
     * 승인된 타이포그래피 토큰을 지정합니다.
     * @param {object} token - TYPOGRAPHY 토큰입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    textStyle(token) {
        const currentItem = this.#currentItem;
        assertTextStyleAssignment(currentItem, token);
        if (currentItem) {
            currentItem.textStyle = token;
        }
        return this;
    }

    /**
     * slider 값 표시의 승인된 타이포그래피 토큰을 지정합니다.
     * @param {object} token - TYPOGRAPHY 토큰입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    valueTextStyle(token) {
        const currentItem = this.#currentItem;
        assertValueTextStyleAssignment(currentItem, token);
        if (currentItem) {
            currentItem.valueTextStyle = token;
        }
        return this;
    }

    /**
     * button의 승인된 컴포넌트 스타일 토큰을 지정합니다.
     * @param {object} token - BUTTON_STYLE 토큰입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    buttonStyle(token) {
        const currentItem = this.#currentItem;
        assertButtonStyleAssignment(currentItem, token);
        if (currentItem) {
            currentItem.buttonStyle = token;
        }
        return this;
    }

    /**
     * 텍스트 값을 지정합니다.
     * @param {string} textStr - 텍스트 문자열입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    text(textStr) {
        if (this.#currentItem) {
            this.#currentItem.props.text = textStr;
        }
        return this;
    }

    /**
     * 버튼 텍스트를 지정합니다.
     * @param {string} textStr - 버튼 텍스트입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    buttonText(textStr) {
        if (this.#currentItem) {
            this.#currentItem.props.text = textStr;
        }
        return this;
    }

    /**
     * 버튼의 idle, hover, text 색상을 지정합니다.
     * @param {object|string} idleOrScheme - 색상 스킴 또는 idle 색상입니다.
     * @param {string|object} [hover] - hover 색상입니다.
     * @param {string|object} [text] - 텍스트 색상입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    buttonColor(idleOrScheme, hover, text) {
        let idleColor;
        let hoverColor;
        let textColor;
        if (typeof idleOrScheme === 'object' && idleOrScheme !== null) {
            idleColor = idleOrScheme.Idle
                || idleOrScheme.idle
                || idleOrScheme.Inactive
                || idleOrScheme.inactive;
            hoverColor = idleOrScheme.Hover || idleOrScheme.hover;
            textColor = idleOrScheme.Text || idleOrScheme.text;
        } else {
            idleColor = idleOrScheme;
            hoverColor = hover;
            textColor = text;
        }

        if (this.#currentItem) {
            if (textColor !== undefined) {
                this.#currentItem.props.color = textColor;
            }
            if (idleColor !== undefined) {
                this.#currentItem.props.idleColor = idleColor;
            }
            if (hoverColor !== undefined) {
                this.#currentItem.props.hoverColor = hoverColor;
            }
        }
        return this;
    }

    /**
     * 값 기반 컨트롤의 최솟값과 최댓값을 지정합니다.
     * @param {number} min - 최소값입니다.
     * @param {number} max - 최대값입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    valueRange(min, max) {
        if (this.#currentItem) {
            this.#currentItem.props.min = min;
            this.#currentItem.props.max = max;
        }
        return this;
    }

    /**
     * 클릭 콜백을 지정합니다.
     * @param {Function} callback - 클릭 콜백입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    onClick(callback) {
        if (this.#currentItem) {
            this.#currentItem.props.onClick = callback;
        }
        return this;
    }

    /**
     * 호버 콜백을 지정합니다.
     * @param {Function} callback - 호버 콜백입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    onHover(callback) {
        if (this.#currentItem) {
            this.#currentItem.props.onHover = callback;
        }
        return this;
    }

    /**
     * hover 툴팁 콘텐츠를 지정합니다.
     * @param {string|string[]|object|Function} content - 툴팁 콘텐츠입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    tooltip(content) {
        if (this.#currentItem) {
            this.#currentItem.props.tooltip = content;
        }
        return this;
    }

    /**
     * 변경 콜백을 지정합니다.
     * @param {Function} callback - 변경 콜백입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    onChange(callback) {
        if (this.#currentItem) {
            this.#currentItem.props.onChange = callback;
        }
        return this;
    }

    /**
     * 변경 확정 콜백을 지정합니다.
     * @param {Function} callback - 확정 콜백입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    onCommit(callback) {
        if (this.#currentItem) {
            this.#currentItem.props.onCommit = callback;
        }
        return this;
    }

    /**
     * 컨트롤 값을 지정합니다.
     * @param {*} value - 현재 값입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    setValue(value) {
        if (this.#currentItem) {
            this.#currentItem.props.value = value;
        }
        return this;
    }

    /**
     * 선택 목록을 지정합니다.
     * @param {Array} items - 옵션 목록입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    items(items) {
        if (this.#currentItem) {
            this.#currentItem.props.items = items;
        }
        return this;
    }

    /**
     * 현재 아이템을 동적 요소로 설정합니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    makeDynamic() {
        if (this.#currentItem) {
            this.#currentItem.dynamic = true;
        }
        return this;
    }

    /**
     * 현재 아이템의 모서리 반경을 지정합니다.
     * @param {string|{BASE:string,VALUE:number}} unitOrPreset - 단위 또는 토큰입니다.
     * @param {number} [valueOrKey] - 단위 값입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    radius(unitOrPreset, valueOrKey) {
        if (this.#currentItem) {
            this.#currentItem.radiusObj = this.#normalizeMetricSpec(
                unitOrPreset,
                valueOrKey
            );
        }
        return this;
    }

    /**
     * 가로 크기 규칙을 지정합니다.
     * @param {string|{BASE:string,VALUE:number}} unit - 단위 또는 토큰입니다.
     * @param {number} [value] - 단위 값입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    width(unit, value) {
        const target = this.#getActiveLayoutTarget();
        if (target) {
            target.widthObj = this.#normalizeMetricSpec(unit, value);
        }
        return this;
    }

    /**
     * 세로 크기 규칙을 지정합니다.
     * @param {string|{BASE:string,VALUE:number}} unit - 단위 또는 토큰입니다.
     * @param {number} [value] - 단위 값입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    height(unit, value) {
        const target = this.#getActiveLayoutTarget();
        if (target) {
            target.heightObj = this.#normalizeMetricSpec(unit, value);
        }
        return this;
    }

    /**
     * 렌더 순서를 명시적으로 지정합니다.
     * @param {number} orderInt - 렌더 순서 정수입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    customRenderOrder(orderInt) {
        const target = this.#getActiveLayoutTarget();
        if (target) {
            target.customRenderOrder = orderInt;
        }
        return this;
    }

    /**
     * 현재 아이템의 임의 props 값을 지정합니다.
     * @param {string} key - props 키입니다.
     * @param {*} value - props 값입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    prop(key, value) {
        assertAllowedPropKey(key);
        if (this.#currentItem) {
            this.#currentItem.props[key] = value;
        }
        return this;
    }

    /**
     * 텍스트 또는 콘텐츠의 드로우 정렬을 지정합니다.
     * @param {'left'|'center'|'right'} type - 콘텐츠 정렬입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    contentAlign(type) {
        if (this.#currentItem) {
            this.#currentItem.props.align = type;
        }
        return this;
    }

    /**
     * 텍스트 드로우 정렬을 지정합니다.
     * @param {'left'|'center'|'right'} type - 텍스트 정렬입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    textAlign(type) {
        return this.contentAlign(type);
    }

    /**
     * 아이콘 타입을 지정합니다.
     * @param {string} type - 아이콘 타입입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    icon(type) {
        if (this.#currentItem) {
            this.#currentItem.props.iconType = type;
        }
        return this;
    }

    /**
     * 채움 색상을 지정합니다.
     * @param {string|object} color - 채움 색상입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    fill(color) {
        if (this.#currentItem) {
            this.#currentItem.props.fill = color;
        }
        return this;
    }

    /**
     * 선 색상을 지정합니다.
     * @param {string|object} color - 선 색상입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    stroke(color) {
        if (this.#currentItem) {
            this.#currentItem.props.stroke = color;
        }
        return this;
    }

    /**
     * 선 두께를 지정합니다.
     * @param {number} width - 선 두께입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    lineWidth(width) {
        if (this.#currentItem) {
            this.#currentItem.props.lineWidth = width;
        }
        return this;
    }

    /**
     * 현재 문맥에 새 수평 그룹을 추가합니다.
     * @param {string|null} [id=null] - 그룹 식별자입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    group(id = null) {
        return this.#createGroup(id);
    }

    /**
     * 수평 그룹 선언을 시작합니다.
     * @param {string|null} id - 그룹 식별자입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     * @private
     */
    #createGroup(id) {
        this.#declarationState.createGroup(id);
        return this;
    }

    /**
     * 하단 정렬 그룹을 추가합니다.
     * @param {string|null} [id=null] - 그룹 식별자입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    bottomGroup(id = null) {
        this.group(id);
        this.vAlign('bottom');
        return this;
    }

    /**
     * 현재 그룹의 수평 배치 방식과 gap을 지정합니다.
     * @param {string} type - 배치 방식입니다.
     * @param {string|{BASE:string,VALUE:number}} [gapUnit] - gap 단위 또는 토큰입니다.
     * @param {number} [gapValue] - gap 값입니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    justifyContent(type, gapUnit, gapValue) {
        const targetGroup = this.#getCurrentGroup();
        if (targetGroup) {
            targetGroup.justifyContent = type;
            if (
                isLayoutMetric(gapUnit)
                || (gapUnit && gapValue !== undefined)
            ) {
                targetGroup.gap = this.#normalizeMetricSpec(
                    gapUnit,
                    gapValue
                );
            }
        }
        return this;
    }

    /**
     * 현재 열려 있는 그룹을 닫습니다.
     * @returns {LayoutHandler} 현재 facade입니다.
     */
    endGroup() {
        this.#declarationState.endGroup();
        return this;
    }

    /**
     * 레이아웃 단위와 값을 픽셀 값으로 변환합니다.
     * @param {string} unit - 레이아웃 단위입니다.
     * @param {number} value - 단위 값입니다.
     * @param {number} refSize - parent 단위 계산 기준 크기입니다.
     * @returns {number} 변환된 픽셀 값입니다.
     */
    parseUnit(unit, value, refSize) {
        return this.positioningHandler.parseUnit(unit, value, refSize);
    }

    /**
     * 선언된 레이아웃을 실제 UI 요소와 렌더 목록으로 컴파일합니다.
     * @returns {{dynamicItems:Array,staticItems:Array,components:Object}} 빌드 결과입니다.
     */
    build() {
        this.resize();

        if (this.#declarationState.hasOpenGroups()) {
            console.warn("LayoutHandler: endGroup()이 모두 호출되지 않은 상태에서 build()가 실행되었습니다. 열려있는 모든 그룹을 강제로 닫습니다.");
            while (this.#declarationState.hasOpenGroups()) {
                this.endGroup();
            }
        }
        this.#commitCurrentItem();

        const compiler = new LayoutCompiler(this);
        return compiler.compile({
            layoutStart: this.#declarationState.layoutStart,
            layoutSize: this.#declarationState.layoutSize,
            paddingX: this.#declarationState.paddingX,
            items: this.#declarationState.items
        });
    }
}
