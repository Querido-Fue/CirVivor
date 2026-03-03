import { ObjectPool } from 'util/_object_pool.js';
import { ButtonElement } from 'ui/element/_button.js';
import { SliderElement } from 'ui/element/_slider.js';
import { ToggleElement } from 'ui/element/_toggle.js';
import { SegmentControlElement } from 'ui/element/_segment_control.js';
import { DropdownElement } from 'ui/element/_dropdown.js';
import { TextElement } from 'ui/element/_text.js';
import { LineElement } from 'ui/element/_line.js';
import { ProgressBarElement } from 'ui/element/_progress_bar.js';
import { GLOBAL_CONSTANTS } from 'data/global/global_constants.js';

/**
 * UI 요소 오브젝트 풀 모음. 각 UI 타입별로 ObjectPool 인스턴스를 관리합니다.
 * @type {Object.<string, ObjectPool>}
 */
export const UIPool = {
    /** @type {ObjectPool} 버튼 엘리먼트 풀 */
    button: new ObjectPool(
        () => { const o = new ButtonElement({}); o.__poolType = 'button'; return o; },
        (item) => item.reset(),
        "UI_Button"
    ),
    /** @type {ObjectPool} 슬라이더 엘리먼트 풀 */
    slider: new ObjectPool(
        () => { const o = new SliderElement({}); o.__poolType = 'slider'; return o; },
        (item) => item.reset(),
        "UI_Slider"
    ),
    /** @type {ObjectPool} 토글 엘리먼트 풀 */
    toggle: new ObjectPool(
        () => { const o = new ToggleElement({}); o.__poolType = 'toggle'; return o; },
        (item) => item.reset(),
        "UI_Toggle"
    ),
    /** @type {ObjectPool} 세그먼트 컨트롤 풀 */
    segment_control: new ObjectPool(
        () => { const o = new SegmentControlElement({}); o.__poolType = 'segment_control'; return o; },
        (item) => item.reset(),
        "UI_SegmentControl"
    ),
    /** @type {ObjectPool} 드랍다운 풀 */
    dropdown: new ObjectPool(
        () => { const o = new DropdownElement({}); o.__poolType = 'dropdown'; return o; },
        (item) => item.reset(),
        "UI_Dropdown"
    ),
    /** @type {ObjectPool} 텍스트 엘리먼트 풀 */
    text_element: new ObjectPool(
        () => { const o = new TextElement({}); o.__poolType = 'text_element'; return o; },
        (item) => item.reset(),
        "UI_TextElement"
    ),
    /** @type {ObjectPool} 라인 엘리먼트 풀 */
    line_element: new ObjectPool(
        () => { const o = new LineElement({}); o.__poolType = 'line_element'; return o; },
        (item) => item.reset(),
        "UI_LineElement"
    ),
    /** @type {ObjectPool} 단순 텍스트 풀 (객체 형태) */
    text: new ObjectPool(
        () => ({ shape: 'text', __poolType: 'text' }),
        (item) => {
            for (let key in item) {
                if (key !== 'shape' && key !== '__poolType') delete item[key];
            }
        },
        "UI_RawText"
    ),
    /** @type {ObjectPool} 단순 라인 풀 (객체 형태) */
    line: new ObjectPool(
        () => ({ shape: 'line', __poolType: 'line' }),
        (item) => {
            for (let key in item) {
                if (key !== 'shape' && key !== '__poolType') delete item[key];
            }
        },
        "UI_RawLine"
    ),
    /** @type {ObjectPool} 프로그레스 바 엘리먼트 풀 */
    progress_bar: new ObjectPool(
        () => { const o = new ProgressBarElement({}); o.__poolType = 'progress_bar'; return o; },
        (item) => item.reset(),
        "UI_ProgressBar"
    )
};

/**
 * UI 요소를 해당 오브젝트 풀에 반납합니다. 자식 요소가 있으면 재귀적으로 반납합니다.
 * @param {object} item - 반납할 UI 요소
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
 * 설정된 POOL_WARMUP 수치만큼 UI 요소를 사전 생성하여 풀에 채웁니다. (프레임 드랍 방지)
 */
export const warmupUIPools = () => {
    UIPool.button.warmUp(GLOBAL_CONSTANTS.POOL_WARMUP.BUTTON);
    UIPool.slider.warmUp(GLOBAL_CONSTANTS.POOL_WARMUP.SLIDER);
    UIPool.toggle.warmUp(GLOBAL_CONSTANTS.POOL_WARMUP.TOGGLE);
    UIPool.segment_control.warmUp(GLOBAL_CONSTANTS.POOL_WARMUP.SEGMENT_CONTROL);
    UIPool.dropdown.warmUp(GLOBAL_CONSTANTS.POOL_WARMUP.DROPDOWN);
    UIPool.text.warmUp(GLOBAL_CONSTANTS.POOL_WARMUP.TEXT);
    UIPool.text_element.warmUp(GLOBAL_CONSTANTS.POOL_WARMUP.TEXT);
    UIPool.line.warmUp(GLOBAL_CONSTANTS.POOL_WARMUP.LINE);
    UIPool.progress_bar.warmUp(GLOBAL_CONSTANTS.POOL_WARMUP.LINE);
};

