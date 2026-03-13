import { nw } from './util/nw_bridge.js';

try {
    nw.Window.get().on('close', function () {
        if (window.Game) {
            if (typeof window.Game.shouldForceCloseWindow === 'function' && window.Game.shouldForceCloseWindow()) {
                this.close(true);
                return;
            }

            if (typeof window.Game.tryClose === 'function' && window.Game.tryClose()) {
                return;
            }
        }

        if (!window.Game) {
            this.close(true);
            return;
        }

        this.close(true);
    });
} catch (e) {
    console.warn('NW.js close hook init failed:', e);
}
