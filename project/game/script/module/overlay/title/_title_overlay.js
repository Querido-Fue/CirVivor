import { BaseOverlay } from 'overlay/_base_overlay.js';
import { titleMenuClose } from 'overlay/overlay_system.js';

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

    /**
         * @override
         * 타이틀 전용 오버레이가 완전히 닫힐 때 시스템 트리거를 호출합니다.
         */
    onCloseComplete() {
        titleMenuClose();
    }
}
