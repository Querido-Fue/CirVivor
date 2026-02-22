import { BaseOverlay } from 'ui/overlay/base_overlay.js';
import { getLangString } from 'ui/_ui_system.js';
import { setMouseFocus } from 'input/_input_system.js';

/**
 * @class TitleOverlay
 * @description 타이틀 화면의 공통 팝업(오버레이) 클래스입니다. BaseOverlay를 상속받습니다.
 * @param {TitleScene} titleScene - 타이틀 씬 인스턴스
 */
export class TitleOverlay extends BaseOverlay {
    constructor(titleScene, layer = 'overlay') {
        super(layer);
        this.titleScene = titleScene;
    }

    onCloseComplete() {
        this.titleScene.menuClose();
    }
}
