import { DummyMenuOverlay } from './_dummy_menu_overlay.js';

const ACHIEVEMENTS_OVERLAY_LAYOUT = Object.freeze({
    WIDTH_UIWW_RATIO: 0.54,
    HEIGHT_WH_RATIO: 0.5,
    TITLE_ICON_SCALE_MULTIPLIER: 0.95
});

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
            titleIconId: 'achievements',
            titleIconScaleMultiplier: ACHIEVEMENTS_OVERLAY_LAYOUT.TITLE_ICON_SCALE_MULTIPLIER,
            widthRatio: ACHIEVEMENTS_OVERLAY_LAYOUT.WIDTH_UIWW_RATIO,
            heightRatio: ACHIEVEMENTS_OVERLAY_LAYOUT.HEIGHT_WH_RATIO
        });
    }
}
