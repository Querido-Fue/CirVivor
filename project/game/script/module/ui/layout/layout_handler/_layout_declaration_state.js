const DEFAULT_LAYOUT_ALIGN = 'left';
const DEFAULT_LAYOUT_VERTICAL_ALIGN = 'top';
const DYNAMIC_UI_ITEM_TYPES = Object.freeze([
    'button',
    'slider',
    'toggle',
    'segment_control',
    'dropdown',
    'progress_bar'
]);
const LAYOUT_METRIC_KEYWORD_ALIASES = Object.freeze({
    fit: 'content',
    content: 'content',
    expand: 'fill',
    fill: 'fill'
});

/**
 * 동적 갱신이 필요한 UI 타입인지 확인합니다.
 * @param {string} type - UI 아이템 타입입니다.
 * @returns {boolean} 동적 아이템 여부입니다.
 */
function isDynamicUIItemType(type) {
    return DYNAMIC_UI_ITEM_TYPES.includes(type);
}

/**
 * 레이아웃 빌더 내부에서 사용하는 기본 아이템 상태를 생성합니다.
 * @param {string} type - UI 아이템 타입입니다.
 * @param {string|null} id - 고유 식별자입니다.
 * @param {object} [overrides={}] - 기본 상태에 병합할 추가 필드입니다.
 * @returns {object} 레이아웃 아이템 상태입니다.
 */
function createLayoutItemState(type, id, overrides = {}) {
    return {
        id: id || crypto.randomUUID(),
        type,
        props: {},
        align: DEFAULT_LAYOUT_ALIGN,
        vAlign: DEFAULT_LAYOUT_VERTICAL_ALIGN,
        dynamic: isDynamicUIItemType(type),
        ...overrides
    };
}

/**
 * 크기 규격 키워드를 내부 표준 단위로 변환합니다.
 * @param {string} unit - 입력 단위 또는 키워드입니다.
 * @returns {string|null} 변환된 단위, 또는 키워드가 아니면 null입니다.
 */
function resolveMetricKeyword(unit) {
    if (!Object.prototype.hasOwnProperty.call(LAYOUT_METRIC_KEYWORD_ALIASES, unit)) {
        return null;
    }
    return LAYOUT_METRIC_KEYWORD_ALIASES[unit];
}

/**
 * 값이 `{ BASE, VALUE }` 형태의 반응형 레이아웃 수치인지 확인합니다.
 * @param {*} value - 검사할 값입니다.
 * @returns {boolean} 레이아웃 수치 객체이면 true입니다.
 */
export function isLayoutMetric(value) {
    return value !== null
        && typeof value === 'object'
        && typeof value.BASE === 'string'
        && Number.isFinite(value.VALUE);
}

/**
 * 크기 지정 인자를 레이아웃 내부 규격으로 정규화합니다.
 * @param {string|{BASE:string,VALUE:number}} unit - 입력 단위, 키워드 또는 토큰입니다.
 * @param {number} [value] - 입력 값입니다.
 * @returns {{unit:string,value:number|undefined}} 정규화된 크기 규격입니다.
 */
export function normalizeMetricSpec(unit, value) {
    if (isLayoutMetric(unit)) {
        return { unit: unit.BASE, value: unit.VALUE };
    }
    const normalizedUnit = resolveMetricKeyword(unit);
    if (normalizedUnit) {
        return { unit: normalizedUnit, value: undefined };
    }
    return { unit, value };
}

/**
 * LayoutHandler의 선언 순서와 현재 편집 문맥을 소유합니다.
 */
export class LayoutDeclarationState {
    #layoutSize;
    #layoutStart;
    #paddingX;
    #items;
    #groupStack;
    #currentItem;
    #parentItem;

    /**
     * 기본 레이아웃 선언 상태를 생성합니다.
     */
    constructor() {
        this.#layoutSize = {
            w: { unit: 'OW', value: 100 },
            h: { unit: 'OH', value: 100 }
        };
        this.#layoutStart = {
            x: { unit: 'OX', value: 0 },
            y: { unit: 'OY', value: 0 }
        };
        this.#paddingX = { unit: 'WW', value: 0 };
        this.#items = [];
        this.#groupStack = [];
        this.#currentItem = null;
        this.#parentItem = null;
    }

    /**
     * 현재 레이아웃 크기 선언입니다.
     * @returns {object} 너비와 높이 규격입니다.
     */
    get layoutSize() {
        return this.#layoutSize;
    }

    /**
     * 현재 레이아웃 시작점 선언입니다.
     * @returns {object} x와 y 규격입니다.
     */
    get layoutStart() {
        return this.#layoutStart;
    }

    /**
     * 현재 수평 패딩 선언입니다.
     * @returns {object} 수평 패딩 규격입니다.
     */
    get paddingX() {
        return this.#paddingX;
    }

    /**
     * 루트에 선언된 레이아웃 항목 목록입니다.
     * @returns {object[]} 루트 항목 목록입니다.
     */
    get items() {
        return this.#items;
    }

    /**
     * 현재 modifier가 적용될 아이템입니다.
     * @returns {object|null} 현재 아이템입니다.
     */
    get currentItem() {
        return this.#currentItem;
    }

    /**
     * 그룹 내부 선언 문맥인지 반환합니다.
     * @returns {boolean} 열린 그룹이 있으면 true입니다.
     */
    get inGroup() {
        return this.#groupStack.length > 0;
    }

    /**
     * 열린 그룹이 남아 있는지 반환합니다.
     * @returns {boolean} 열린 그룹이 있으면 true입니다.
     */
    hasOpenGroups() {
        return this.#groupStack.length > 0;
    }

    /**
     * 레이아웃 전체 크기를 갱신합니다.
     * @param {string} wUnit - 너비 단위입니다.
     * @param {number} wValue - 너비 값입니다.
     * @param {string} hUnit - 높이 단위입니다.
     * @param {number} hValue - 높이 값입니다.
     * @returns {void}
     */
    setLayoutSize(wUnit, wValue, hUnit, hValue) {
        this.#layoutSize = {
            w: { unit: wUnit, value: wValue },
            h: { unit: hUnit, value: hValue }
        };
    }

    /**
     * 레이아웃 시작점을 갱신합니다.
     * @param {string} xUnit - x 단위입니다.
     * @param {number} xValue - x 값입니다.
     * @param {string} yUnit - y 단위입니다.
     * @param {number} yValue - y 값입니다.
     * @returns {void}
     */
    setLayoutStart(xUnit, xValue, yUnit, yValue) {
        this.#layoutStart = {
            x: { unit: xUnit, value: xValue },
            y: { unit: yUnit, value: yValue }
        };
    }

    /**
     * 레이아웃 수평 패딩을 갱신합니다.
     * @param {{unit:string,value:number|undefined}} paddingX - 정규화된 패딩입니다.
     * @returns {void}
     */
    setPaddingX(paddingX) {
        this.#paddingX = paddingX;
    }

    /**
     * 현재 편집 중인 부모 아이템을 선언 목록에 확정합니다.
     * @returns {void}
     */
    commitCurrentItem() {
        if (this.#parentItem) {
            const currentGroup = this.getCurrentGroup();
            if (currentGroup) {
                currentGroup.items.push(this.#parentItem);
            } else {
                this.#items.push(this.#parentItem);
            }
        }
        this.#currentItem = null;
        this.#parentItem = null;
    }

    /**
     * 현재 열려 있는 마지막 그룹을 반환합니다.
     * @returns {object|null} 현재 그룹 상태입니다.
     */
    getCurrentGroup() {
        return this.#groupStack.length > 0
            ? this.#groupStack[this.#groupStack.length - 1]
            : null;
    }

    /**
     * modifier가 적용될 현재 아이템 또는 그룹을 반환합니다.
     * @returns {object|null} 현재 modifier 대상입니다.
     */
    getActiveLayoutTarget() {
        return this.#currentItem || this.getCurrentGroup();
    }

    /**
     * 현재 문맥에 새 UI 아이템 선언을 시작합니다.
     * @param {string} type - UI 아이템 타입입니다.
     * @param {string|null} id - 고유 식별자입니다.
     * @returns {object} 생성한 아이템 상태입니다.
     */
    createItem(type, id) {
        this.commitCurrentItem();
        this.#currentItem = createLayoutItemState(type, id);
        this.#parentItem = this.#currentItem;
        return this.#currentItem;
    }

    /**
     * 현재 부모 아이템에 자식 선언을 추가합니다.
     * @param {string} type - UI 아이템 타입입니다.
     * @param {string|null} id - 고유 식별자입니다.
     * @returns {boolean} 자식을 추가했으면 true입니다.
     */
    createChild(type, id) {
        if (!this.#parentItem) {
            return false;
        }
        if (!this.#parentItem.children) {
            this.#parentItem.children = [];
        }
        const child = createLayoutItemState(type, id);
        this.#parentItem.children.push(child);
        this.#currentItem = child;
        return true;
    }

    /**
     * 현재 문맥에 수평 그룹 선언을 추가하고 그룹을 엽니다.
     * @param {string|null} id - 그룹 식별자입니다.
     * @returns {object} 생성한 그룹 상태입니다.
     */
    createGroup(id) {
        this.commitCurrentItem();
        const group = createLayoutItemState('hbox', id, { items: [] });
        const currentGroup = this.getCurrentGroup();

        if (currentGroup) {
            currentGroup.items.push(group);
        } else {
            this.#items.push(group);
        }
        this.#groupStack.push(group);
        return group;
    }

    /**
     * 현재 그룹의 아이템을 확정하고 그룹을 닫습니다.
     * @returns {void}
     */
    endGroup() {
        this.commitCurrentItem();
        if (this.#groupStack.length > 0) {
            this.#groupStack.pop();
        }
    }
}
