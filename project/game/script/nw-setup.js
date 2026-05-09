import { nw } from './util/nw_bridge.js';

/**
 * NW.js 창 닫기 요청을 게임 종료 확인 흐름에 연결합니다.
 */
function handleWindowClose() {
    const game = window.Game;
    if (!game) {
        this.close(true);
        return;
    }

    if (typeof game.shouldForceCloseWindow === 'function' && game.shouldForceCloseWindow()) {
        this.close(true);
        return;
    }

    if (typeof game.tryClose === 'function' && game.tryClose()) {
        return;
    }

    this.close(true);
}

try {
    nw.Window.get().on('close', handleWindowClose);
} catch (e) {
    console.warn('NW.js close hook init failed:', e);
}
