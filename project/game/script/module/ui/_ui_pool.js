import { ObjectPool } from 'object/_object_pool.js';
import { ButtonElement } from 'ui/element/_button.js';
import { SliderElement } from 'ui/element/_slider.js';
import { ToggleElement } from 'ui/element/_toggle.js';
import { SegmentControlElement } from 'ui/element/_segment_control.js';
import { DropdownElement } from 'ui/element/_dropdown.js';
import { TextElement } from 'ui/element/_text.js';
import { LineElement } from 'ui/element/_line.js';
import { ProgressBarElement } from 'ui/element/_progress_bar.js';

const UI_POOL_WARMUP_COUNT_BY_TYPE = Object.freeze({
    button: 30,
    slider: 10,
    toggle: 10,
    segment_control: 10,
    dropdown: 10,
    text: 50,
    text_element: 50,
    line: 30,
    progress_bar: 30
});

/**
 * 풀 타입 정보를 가진 UI 요소 인스턴스를 생성합니다.
 * @param {Function} ElementClass - 생성할 UI 요소 클래스입니다.
 * @param {string} poolType - UI 풀 타입 키입니다.
 * @returns {object} 생성된 UI 요소입니다.
 */
function _createPooledElement(ElementClass, poolType) {
    const item = new ElementClass({});
    item.__poolType = poolType;
    return item;
}

/**
 * 렌더 커맨드 형태의 단순 UI 풀 객체를 생성합니다.
 * @param {string} shape - 렌더 커맨드 shape 값입니다.
 * @param {string} poolType - UI 풀 타입 키입니다.
 * @returns {object} 생성된 단순 UI 객체입니다.
 */
function _createRawPoolItem(shape, poolType) {
    return { shape, __poolType: poolType };
}

/**
 * 풀에서 재사용할 단순 UI 객체의 동적 속성을 제거합니다.
 * @param {object} item - 초기화할 단순 UI 객체입니다.
 * @returns {void}
 */
function _resetRawPoolItem(item) {
    for (const key of Object.keys(item)) {
        if (key !== 'shape' && key !== '__poolType') {
            delete item[key];
        }
    }
}

/**
 * UI 요소 오브젝트 풀 모음. 각 UI 타입별로 ObjectPool 인스턴스를 관리합니다.
 * @type {Object.<string, ObjectPool>}
 */
export const UIPool = {
    /** @type {ObjectPool} 버튼 엘리먼트 풀 */
    button: new ObjectPool(
        () => _createPooledElement(ButtonElement, 'button'),
        (item) => item.reset(),
        'UI_Button'
    ),
    /** @type {ObjectPool} 슬라이더 엘리먼트 풀 */
    slider: new ObjectPool(
        () => _createPooledElement(SliderElement, 'slider'),
        (item) => item.reset(),
        'UI_Slider'
    ),
    /** @type {ObjectPool} 토글 엘리먼트 풀 */
    toggle: new ObjectPool(
        () => _createPooledElement(ToggleElement, 'toggle'),
        (item) => item.reset(),
        'UI_Toggle'
    ),
    /** @type {ObjectPool} 세그먼트 컨트롤 풀 */
    segment_control: new ObjectPool(
        () => _createPooledElement(SegmentControlElement, 'segment_control'),
        (item) => item.reset(),
        'UI_SegmentControl'
    ),
    /** @type {ObjectPool} 드랍다운 풀 */
    dropdown: new ObjectPool(
        () => _createPooledElement(DropdownElement, 'dropdown'),
        (item) => item.reset(),
        'UI_Dropdown'
    ),
    /** @type {ObjectPool} 텍스트 엘리먼트 풀 */
    text_element: new ObjectPool(
        () => _createPooledElement(TextElement, 'text_element'),
        (item) => item.reset(),
        'UI_TextElement'
    ),
    /** @type {ObjectPool} 라인 엘리먼트 풀 */
    line_element: new ObjectPool(
        () => _createPooledElement(LineElement, 'line_element'),
        (item) => item.reset(),
        'UI_LineElement'
    ),
    /** @type {ObjectPool} 단순 텍스트 풀 (객체 형태) */
    text: new ObjectPool(
        () => _createRawPoolItem('text', 'text'),
        _resetRawPoolItem,
        'UI_RawText'
    ),
    /** @type {ObjectPool} 단순 라인 풀 (객체 형태) */
    line: new ObjectPool(
        () => _createRawPoolItem('line', 'line'),
        _resetRawPoolItem,
        'UI_RawLine'
    ),
    /** @type {ObjectPool} 프로그레스 바 엘리먼트 풀 */
    progress_bar: new ObjectPool(
        () => _createPooledElement(ProgressBarElement, 'progress_bar'),
        (item) => item.reset(),
        'UI_ProgressBar'
    )
};

/**
 * UI 요소의 left→center→right→children 자식을 먼저 재귀 반납한 뒤 현재 요소를 reset·반납합니다.
 * 등록되지 않은 pool type은 무시하며, 처리 중 오류가 나도 앞서 완료된 반납은 되돌리지 않습니다.
 * @param {object|null|undefined} item - 반납할 UI 요소입니다.
 * @returns {void}
 */
export const releaseUIItem = (item) => {
    if (!item) return;
    if (item.__poolType && UIPool[item.__poolType]) {
        const pool = UIPool[item.__poolType];
        if (item.left || item.center || item.right || item.children) {
            // 자식 요소가 있으면 재귀적으로 반납 (예: button 내부 text_element)
            const children = [
                ...(item.left || []),
                ...(item.center || []),
                ...(item.right || []),
                ...(item.children || [])
            ];
            for (const c of children) {
                releaseUIItem(c);
            }
        }
        // 반납 즉시 reset을 적용해, 오버레이 종료 후에도 애니메이션/참조가 남지 않게 합니다.
        if (pool.resetFn) {
            pool.resetFn(item);
        }
        pool.release(item);
    }
};

/**
 * 고정된 type→warmup key 열거 순서대로 현재 POOL_WARMUP 수치만큼 UI 풀을 채웁니다.
 * 중간 오류가 나면 앞서 완료된 풀 변경은 유지하고 이후 풀은 처리하지 않습니다.
 * @returns {void}
 */
export const warmupUIPools = () => {
    for (const [poolType, warmupCount] of Object.entries(UI_POOL_WARMUP_COUNT_BY_TYPE)) {
        UIPool[poolType].warmUp(warmupCount);
    }
};
