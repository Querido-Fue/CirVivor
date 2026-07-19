import { getData } from 'data/data_handler.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { getMouseFocus, setMouseFocus } from 'input/input_system.js';
import { LayoutHandler } from 'ui/layout/_layout_handler.js';
import { runtimeTool } from 'util/runtime_tool.js';
import { BaseOverlay } from './_base_overlay.js';

const DEBUG_OVERLAY = getData('DEBUG_CONSTANTS').DEBUG_OVERLAY;
const DEBUG_CONTROL_ROWS = Object.freeze([
    Object.freeze({ key: 'frameTime', label: '프레임타임 보이기' }),
    Object.freeze({ key: 'poolInfo', label: '풀 정보 보이기' }),
    Object.freeze({ key: 'hitboxes', label: '히트박스 보이기' }),
    Object.freeze({ key: 'animationDebug', label: '애니메이션 디버그' })
]);

/**
 * @class DebugOverlay
 * @description 디버그 표시와 애니메이션 프레임 제어 옵션을 제공하는 전역 overlay입니다.
 */
export class DebugOverlay extends BaseOverlay {
    /**
     * @param {*} debugSystem - 디버그 제어 상태를 소유한 시스템입니다. falsy 값은 `null`로 저장합니다.
     */
    constructor(debugSystem) {
        super({
            layer: DEBUG_OVERLAY.LAYER,
            dim: DEBUG_OVERLAY.DIM_ALPHA,
            transparent: true,
            blurUpdateMode: 'always'
        });

        this.debugSystem = debugSystem || null;
    }

    /**
     * @override
     * 디버그 패널 크기를 현재 화면에 비례해 계산합니다.
     */
    _onResize() {
        this.width = this.UIWW * DEBUG_OVERLAY.WIDTH_UIWW_RATIO;
        this.height = this.WH * DEBUG_OVERLAY.HEIGHT_WH_RATIO;
    }

    /**
     * animation frame이 정지 상태이면 presentation origin 재계산 없이 로컬 값을
     * alpha→dim→scale→blur 순서로 즉시 설정하고, 연결된 session의 optional setter도
     * 같은 순서로 호출합니다. 정지 상태가 아니면 공통 overlay open을 호출합니다.
     * @returns {void}
     * @throws {*} 상태 조회, session setter 또는 공통 open 오류를 부분 상태 그대로 전파합니다.
     */
    open() {
        if (!this.debugSystem?.isAnimationFramePaused?.()) {
            super.open();
            return;
        }

        this.alpha = 1;
        this.dimAlpha = 1;
        this.contentScale = 1;
        this.contentBlur = 0;
        this.session?.setAlpha?.(1);
        this.session?.setDimAlpha?.(1);
        this.session?.setContentScale?.(1);
        this.session?.setContentBlur?.(0);
    }

    /**
     * 먼저 현재 focus의 overlay layer 포함 여부를 읽고 animation frame 정지 여부를
     * 조회합니다. focus를 보유하면서 정지되지 않은 경우에만 공통 close animation을
     * 호출합니다. 그 외에는 presentation과 session을 alpha→dim→scale→blur 순서로
     * 즉시 닫고, focus를 보유한 경우에만 이전 focus를 복원한 뒤 호출 가능한
     * `onCloseComplete`를 동기 호출합니다. `closeHandler`는 먼저 `null`로 만든 뒤
     * Promise microtask에서 한 번 호출하므로 즉시 close를 반복해도 같은 handler를
     * 다시 예약하지 않습니다.
     * @returns {void}
     * @throws {*} focus·상태 조회, session setter, focus 복원, 동기 완료 훅 또는 microtask 예약 오류를 부분 상태 그대로 전파합니다.
     */
    close() {
        const hasOwnFocus = getMouseFocus().includes(this.layer);
        if (!this.debugSystem?.isAnimationFramePaused?.() && hasOwnFocus) {
            super.close();
            return;
        }

        this.alpha = 0;
        this.dimAlpha = 0;
        this.contentScale = 1;
        this.contentBlur = 0;
        this.session?.setAlpha?.(0);
        this.session?.setDimAlpha?.(0);
        this.session?.setContentScale?.(1);
        this.session?.setContentBlur?.(0);
        if (hasOwnFocus) {
            setMouseFocus(this.previousFocus || ['ui', 'object']);
        }
        if (typeof this.onCloseComplete === 'function') {
            this.onCloseComplete();
        }
        if (typeof this.closeHandler === 'function') {
            const closeHandler = this.closeHandler;
            this.closeHandler = null;
            Promise.resolve().then(() => {
                closeHandler(this);
            });
        }
    }

    /**
     * @override
     * 디버그 표시 토글과 도구 버튼 레이아웃을 생성합니다.
     */
    _generateLayout() {
        this._releaseElements();
        const controlState = this.#getControlState();
        const handler = new LayoutHandler(this, this.positioningHandler)
            .paddingX('WW', DEBUG_OVERLAY.PADDING_X_WW)
            .space('WH', DEBUG_OVERLAY.TOP_SPACE_WH)
            .item('text', 'debug_overlay_title')
            .stylePreset('h2')
            .text('디버그 패널')
            .fill(ColorSchemes.Title.TextDark)
            .space('WH', DEBUG_OVERLAY.TITLE_DIVIDER_TOP_SPACE_WH)
            .item('line', 'debug_overlay_divider')
            .width('fill')
            .stroke(ColorSchemes.Overlay.Panel.Divider)
            .lineWidth(1)
            .space('WH', DEBUG_OVERLAY.TITLE_DIVIDER_BOTTOM_SPACE_WH);

        DEBUG_CONTROL_ROWS.forEach((control, index) => {
            handler
                .group(`debug_control_row_${control.key}`)
                .justifyContent('space-between', 'WW', DEBUG_OVERLAY.ROW_CONTROL_GAP_WW)
                .width('parent', 100)
                .align('center')
                .item('text', `debug_control_label_${control.key}`)
                .text(control.label)
                .stylePreset('h5_bold')
                .fill(ColorSchemes.Overlay.Text.Item)
                .vAlign('center')
                .spacer()
                .item('toggle', `debug_control_${control.key}`)
                .width('WW', DEBUG_OVERLAY.TOGGLE_WIDTH_WW)
                .height('WH', DEBUG_OVERLAY.TOGGLE_HEIGHT_WH)
                .setValue(controlState[control.key] === true)
                .onChange((value) => {
                    this.debugSystem?.setControlOption?.(control.key, value === true);
                })
                .vAlign('center')
                .endGroup();

            if (index < DEBUG_CONTROL_ROWS.length - 1) {
                handler.space('WH', DEBUG_OVERLAY.ROW_GAP_WH);
            }
        });

        handler
            .space('WH', DEBUG_OVERLAY.HINT_TOP_SPACE_WH)
            .item('text', 'animation_debug_hint')
            .stylePreset('settings_desc')
            .text('/ : 업데이트 정지·재개   . : 정지 상태에서 1프레임 실행')
            .fill(ColorSchemes.Overlay.Text.Item)
            .bottomSpace('WH', DEBUG_OVERLAY.FOOTER_BOTTOM_SPACE_WH)
            .bottomGroup('debug_overlay_footer')
            .justifyContent('right', 'WW', DEBUG_OVERLAY.FOOTER_BUTTON_GAP_WW)
            .align('right')
            .item('button', 'open_devtools_btn')
            .stylePreset('overlay_interact_button')
            .buttonText('DevTools 열기')
            .buttonColor(ColorSchemes.Overlay.Button.Link)
            .icon('arrow')
            .onClick(() => {
                runtimeTool()?.openDebugWindow?.();
            })
            .item('button', 'close_debug_overlay_btn')
            .stylePreset('overlay_interact_button')
            .buttonText('닫기')
            .buttonColor(ColorSchemes.Overlay.Button.Cancel)
            .icon('deny')
            .onClick(this.close.bind(this))
            .endGroup();

        const buildResult = handler.build();
        this.dynamicItems = buildResult.dynamicItems;
        this.staticItems = buildResult.staticItems;
    }

    /**
     * 디버그 시스템의 현재 패널 제어 상태를 안전하게 반환합니다.
     * @returns {{frameTime?:boolean, poolInfo?:boolean, hitboxes?:boolean, animationDebug?:boolean}}
     * @private
     */
    #getControlState() {
        const state = this.debugSystem?.getControlState?.();
        return state && typeof state === 'object' ? state : {};
    }
}
