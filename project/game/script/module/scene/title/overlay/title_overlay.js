import { BaseOverlay } from 'ui/overlay/base_overlay.js';
import { ButtonElement } from 'ui/element/button.js';
import { ColorSchemes } from 'display/theme_handler.js';
import { animate } from 'animation/_animation_system.js';
import { getLangString } from 'ui/_ui_system.js';
import { setMouseFocus } from 'input/_input_system.js';

/**
 * @class TitleOverlay
 * @description 타이틀 화면의 공통 팝업(오버레이) 클래스입니다. BaseOverlay를 상속받습니다.
 * @param {TitleScene} TitleScene - 타이틀 씬 인스턴스
 * @param {string} titleKey - 제목 언어 키
 */
export class TitleOverlay extends BaseOverlay {
    constructor(TitleScene, titleKey, layer = 'overlay') {
        super(layer);
        this.TitleScene = TitleScene;
        this.title = getLangString(titleKey);

        // 닫기 버튼 생성 (BaseOverlay에 closeButton 필드가 있음)
        const btnHeight = this.WH * 0.08;
        const btnWidth = this.width * 0.5;
        this.closeButton = new ButtonElement({
            parent: this,
            onClick: this.close.bind(this),
            layer: this.layer,
            x: this.x + (this.width - btnWidth) / 2,
            y: this.y + this.height - btnHeight - this.WH * 0.02,
            width: btnWidth,
            height: btnHeight,
            text: getLangString("title_menu_close"),
            font: "arial",
            size: this.WW * 0.015,
            idleColor: 'rgba(0,0,0,0)',
            hoverColor: ColorSchemes.Overlay.Control.Hover,
            enableHoverGradient: false,
            color: ColorSchemes.Title.TextDark,
        });

        this.open();
    }

    // BaseOverlay.open() 사용

    close() {
        // TitleScene 애니메이션 추가 실행
        animate(this.TitleScene, { variable: 'menuOpenAnimation', startValue: 1, endValue: 0, type: "linear", duration: 0.2 });
        super.close();
    }

    onCloseComplete() {
        setMouseFocus('ui');
        this.destroy();

        // TitleScene 상태 업데이트
        if (this.TitleScene) {
            this.TitleScene.menu = null;
            this.TitleScene.menuOpened = false;
            this.TitleScene.menuOpenAnimationInit = false;
        }
    }

    // BaseOverlay.update() 사용 (closeButton update 포함됨)
    // BaseOverlay.draw() 사용 (배경, 제목, 닫기 버튼 그리기 포함됨)
    // 추가적인 그리기 로직이 필요한 자식 클래스는 draw()를 오버라이드하고 super.draw() 호출
}
