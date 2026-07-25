import { DummyMenuOverlay } from './_dummy_menu_overlay.js';

const RECORDS_OVERLAY_LAYOUT = Object.freeze({
    WIDTH_UIWW_RATIO: 0.5,
    HEIGHT_WH_RATIO: 0.42,
    TITLE_ICON_SCALE_MULTIPLIER: 0.75
});

/**
 * @class RecordsOverlay
 * @description 기록 및 리더보드 카드의 더미 overlay 클래스입니다.
 */
export class RecordsOverlay extends DummyMenuOverlay {
    /**
     * @param {TitleScene} titleScene - 타이틀 씬 인스턴스입니다.
     */
    constructor(titleScene) {
        super(titleScene, {
            titleKey: 'title_overlay_records_title',
            bodyKey: 'title_overlay_records_body',
            titleIconId: 'records',
            titleIconScaleMultiplier: RECORDS_OVERLAY_LAYOUT.TITLE_ICON_SCALE_MULTIPLIER,
            widthRatio: RECORDS_OVERLAY_LAYOUT.WIDTH_UIWW_RATIO,
            heightRatio: RECORDS_OVERLAY_LAYOUT.HEIGHT_WH_RATIO
        });
    }
}
