import { BaseOverlay } from 'overlay/_base_overlay.js';

/**
 * @class TitleOverlay
 * @description 타이틀 화면용 overlay 콘텐츠의 공통 베이스입니다.
 */
export class TitleOverlay extends BaseOverlay {
    /**
     * @param {object} titleScene - 타이틀 씬 인스턴스입니다.
     * @param {object} [options={}] - overlay 옵션입니다.
     */
    constructor(titleScene, options = {}) {
        super({
            layer: options.layer === undefined ? 10 : options.layer,
            dim: options.dim === undefined ? 0.28 : options.dim,
            transparent: options.transparent !== false,
            glOverlay: options.glOverlay === true,
            blurUpdateMode: options.blurUpdateMode || 'always',
            effects: options.effects || {}
        });
        this.titleScene = titleScene;
    }
}
