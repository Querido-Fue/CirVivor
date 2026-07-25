import { DummyMenuOverlay } from './_dummy_menu_overlay.js';

const RESEARCH_OVERLAY_LAYOUT = Object.freeze({
    WIDTH_UIWW_RATIO: 0.54,
    HEIGHT_WH_RATIO: 0.5,
    TITLE_ICON_SCALE_MULTIPLIER: 0.9
});

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
            titleIconId: 'research',
            titleIconScaleMultiplier: RESEARCH_OVERLAY_LAYOUT.TITLE_ICON_SCALE_MULTIPLIER,
            widthRatio: RESEARCH_OVERLAY_LAYOUT.WIDTH_UIWW_RATIO,
            heightRatio: RESEARCH_OVERLAY_LAYOUT.HEIGHT_WH_RATIO
        });
    }
}
