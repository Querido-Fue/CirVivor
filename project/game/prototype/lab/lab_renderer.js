import { CeramicWorldRenderer } from '../../script/module/ingame/render/ceramic_world_renderer.js';
export class LabRenderer extends CeramicWorldRenderer {
    constructor(platform,composer,camera,tileMap) {
        super(platform,composer,camera,tileMap,{ownsFrame:true});
    }
}
