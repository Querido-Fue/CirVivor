import { DummyMenuOverlay } from './_dummy_menu_overlay.js';

const QUICK_START_OVERLAY_LAYOUT = Object.freeze({
    WIDTH_UIWW_RATIO: 0.42,
    HEIGHT_WH_RATIO: 0.34
});

/**
 * @class QuickStartOverlay
 * @description 빠른 시작 카드의 더미 overlay 클래스입니다.
 */
export class QuickStartOverlay extends DummyMenuOverlay {
    /**
     * @param {TitleScene} titleScene - 타이틀 씬 인스턴스입니다.
     */
    constructor(titleScene) {
        super(titleScene, {
            titleKey: 'title_overlay_quick_start_title',
            bodyKey: 'title_overlay_quick_start_body',
            widthRatio: QUICK_START_OVERLAY_LAYOUT.WIDTH_UIWW_RATIO,
            heightRatio: QUICK_START_OVERLAY_LAYOUT.HEIGHT_WH_RATIO
        });
    }
}
