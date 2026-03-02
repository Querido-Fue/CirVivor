import { nw, isNwRuntime } from './util/nw_bridge.js';

if (isNwRuntime()) {
    try {
        nw.Window.get().on('close', function () {
            if (window.Game) {
                window.Game.tryClose();
            } else {
                this.close(true);
            }
        });
    } catch (e) {
        console.warn('NW.js close hook init failed:', e);
    }
}
