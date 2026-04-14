import { getData } from 'data/data_handler.js';
import { DummyMenuOverlay } from './_dummy_menu_overlay.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');

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
            titleIconScaleMultiplier: TITLE_CONSTANTS.TITLE_OVERLAY.RECORDS.TITLE_ICON_SCALE_MULTIPLIER,
            widthRatio: TITLE_CONSTANTS.TITLE_OVERLAY.RECORDS.WIDTH_UIWW_RATIO,
            heightRatio: TITLE_CONSTANTS.TITLE_OVERLAY.RECORDS.HEIGHT_WH_RATIO
        });
    }
}
