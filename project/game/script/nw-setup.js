try {
    require('nw.gui').Window.get().on('close', function () {
        if (window.Game) {
            window.Game.tryClose();
        } else {
            this.close(true);
        }
    });
} catch (e) {
    alert("This game is not runnable in browsers.\n이 게임은 브라우저 상에서 실행할 수 없습니다.");
}
