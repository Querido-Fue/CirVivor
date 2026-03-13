import { getData } from 'data/data_handler.js';
import { DummyMenuOverlay } from './_dummy_menu_overlay.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');

/**
 * @class ResearchOverlay
 * @description 연구 카드의 더미 overlay 클래스입니다.
 */
export class ResearchOverlay extends DummyMenuOverlay {
    /**
     * @param {TitleScene} titleScene - 타이틀 씬 인스턴스입니다.
     */
    constructor(titleScene) {
        super(titleScene, {
            titleKey: 'title_overlay_research_title',
            bodyKey: 'title_overlay_research_body',
            widthRatio: TITLE_CONSTANTS.TITLE_OVERLAY.RESEARCH.WIDTH_UIWW_RATIO,
            heightRatio: TITLE_CONSTANTS.TITLE_OVERLAY.RESEARCH.HEIGHT_WH_RATIO
        });
    }
}
