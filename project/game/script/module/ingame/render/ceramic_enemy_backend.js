import { EnemySimulationBackend } from '../object/enemy/enemy_simulation_backend.js';
import { CeramicWorldRenderer } from './ceramic_world_renderer.js';

/** Backend lifecycle owns the renderer, including safe-wave replacement and teardown. */
export class CeramicEnemyBackend extends EnemySimulationBackend {
    init(tileMap) {
        this.ceramicTileMap=tileMap;
        return super.init(tileMap);
    }

    draw(camera) {
        if(!camera.depthView)return super.draw(camera);
        const composer=this.webGpuPlatformPort?.getFrameComposer?.();
        if(!composer?.isFrameActive())return false;
        if(!this.ceramicRenderer) {
            this.ceramicRenderer=new CeramicWorldRenderer(this.webGpuPlatformPort,composer,camera.depthView,this.ceramicTileMap);
        }
        this.getRuntimeState();
        if(this.requiresBlockingRecovery())return false;
        return this.ceramicRenderer.draw(this.simulation);
    }

    destroy() {
        this.ceramicRenderer?.destroy();this.ceramicRenderer=null;this.ceramicTileMap=null;
        super.destroy();
    }
}
