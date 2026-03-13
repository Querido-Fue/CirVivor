import { getData } from 'data/data_handler.js';
import { DummyMenuOverlay } from './_dummy_menu_overlay.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');

/**
 * @class AchievementsOverlay
 * @description 도전과제 메뉴의 더미 overlay 클래스입니다.
 */
export class AchievementsOverlay extends DummyMenuOverlay {
    /**
     * @param {TitleScene} titleScene - 타이틀 씬 인스턴스입니다.
     */
    constructor(titleScene) {
        super(titleScene, {
            titleKey: 'title_overlay_achievements_title',
            bodyKey: 'title_overlay_achievements_body',
            widthRatio: TITLE_CONSTANTS.TITLE_OVERLAY.ACHIEVEMENTS.WIDTH_UIWW_RATIO,
            heightRatio: TITLE_CONSTANTS.TITLE_OVERLAY.ACHIEVEMENTS.HEIGHT_WH_RATIO
        });
    }
}
