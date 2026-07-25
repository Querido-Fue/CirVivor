import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { loadGameModule } from './support/source_module_loader.mjs';

const {
    INPUT_DISPOSITIONS,
    PLAYER_ACTION_TYPES,
    isPlayerControllable,
    isPlayerControllerable
} = await loadGameModule('ingame/contract/player_controllable_contract.js');
const { InputActionMapper } = await loadGameModule('ingame/input/input_action_mapper.js');
const { GameSystem } = await loadGameModule('ingame/game_system.js');
const { THE_TOWER_DEFAULTS } = await loadGameModule('ingame/object/the_tower.js');

const pressedDirections = new Set(['up', 'right']);
const mapper = new InputActionMapper();
const diagonalMove = mapper.mapMoveAction({
    isPressed(key) {
        return pressedDirections.has(key);
    }
});
assert.equal(diagonalMove.type, PLAYER_ACTION_TYPES.MOVE_VECTOR);
assert.ok(Math.abs(diagonalMove.payload.x - Math.SQRT1_2) < 1e-12);
assert.ok(Math.abs(diagonalMove.payload.y + Math.SQRT1_2) < 1e-12);

pressedDirections.add('left');
const cancelledHorizontalMove = mapper.mapMoveAction({
    isPressed(key) {
        return pressedDirections.has(key);
    }
});
assert.equal(cancelledHorizontalMove.payload.x, 0);
assert.ok(Math.abs(cancelledHorizontalMove.payload.y + 1) < 1e-12);

const keys = Object.create(null);
const viewport = {
    ww: 1000,
    objectWH: 600,
    objectOffsetY: 40
};
const time = {
    fixedDelta: 1 / 60,
    alpha: 0.5
};
const circleDraws = [];
const gameSystem = new GameSystem({
    inputActionSource: {
        isPressed(key) {
            return keys[key] === true;
        }
    },
    timePort: {
        getFixedDelta() {
            return time.fixedDelta;
        },
        getFixedInterpolationAlpha() {
            return time.alpha;
        }
    },
    viewportPort: {
        getSnapshot(out) {
            Object.assign(out, viewport);
            return out;
        }
    },
    worldRenderPort: {
        drawCircle(options) {
            circleDraws.push({ ...options });
        }
    }
});

assert.equal(gameSystem.enter(), true);
assert.equal(gameSystem.enter(), false);

const gameObjectSystem = gameSystem.getObjectSystem();
const tower = gameObjectSystem.getTower();
const [towerController] = gameObjectSystem.getPlayerControllables();
assert.ok(isPlayerControllable(towerController));
assert.ok(isPlayerControllerable(towerController));
assert.equal('hp' in tower, false);
assert.equal('health' in tower, false);
assert.equal(tower.position.x, 500);
assert.equal(tower.position.y, 300);

keys.right = true;
gameSystem.fixedUpdate();
const expectedStep = THE_TOWER_DEFAULTS.MOVE_SPEED * time.fixedDelta;
assert.ok(Math.abs(tower.position.x - (500 + expectedStep)) < 1e-9);
assert.equal(tower.position.y, 300);

gameSystem.update();
assert.ok(Math.abs(tower.renderPosition.x - (500 + (expectedStep * 0.5))) < 1e-9);
assert.equal(tower.renderPosition.y, 300);

gameSystem.draw();
assert.equal(circleDraws.length, 1);
assert.equal(circleDraws[0].layer, 'object');
assert.equal(circleDraws[0].diameter, THE_TOWER_DEFAULTS.RADIUS * 2);
assert.equal(circleDraws[0].fill, '#2785ff');
assert.equal(circleDraws[0].y, 260);

keys.right = false;
keys.left = true;
for (let index = 0; index < 200; index++) {
    gameSystem.fixedUpdate();
}
assert.equal(tower.position.x, THE_TOWER_DEFAULTS.RADIUS);

keys.left = false;
const releasedX = tower.position.x;
gameSystem.fixedUpdate();
assert.equal(tower.position.x, releasedX);

viewport.ww = 1600;
viewport.objectWH = 900;
gameSystem.resize();
assert.equal(tower.position.x, releasedX);
assert.equal(tower.position.y, 300);

viewport.ww = 30;
viewport.objectWH = 40;
gameSystem.resize();
assert.equal(tower.position.x, 15);
assert.equal(tower.position.y, 20);

assert.equal(
    towerController.handlePlayerAction({ type: 'unsupported' }),
    INPUT_DISPOSITIONS.PASS
);
gameSystem.destroy();
gameSystem.destroy();
assert.equal(tower.active, false);
assert.equal(towerController.isControlEnabled(), false);

const keyboardHandlerSource = await readFile(
    new URL('../script/module/input/_keyboard_input_handler.js', import.meta.url),
    'utf8'
);
const windowListeners = new Map();
const documentListeners = new Map();
const keyboardContext = vm.createContext({
    window: {
        addEventListener(type, listener) {
            windowListeners.set(type, listener);
        }
    },
    document: {
        hidden: false,
        addEventListener(type, listener) {
            documentListeners.set(type, listener);
        }
    }
});
const keyboardModule = new vm.SourceTextModule(keyboardHandlerSource, {
    context: keyboardContext,
    identifier: '_keyboard_input_handler.js'
});
await keyboardModule.link(() => {
    throw new Error('KeyboardInputHandler에는 외부 import가 없어야 합니다.');
});
await keyboardModule.evaluate();

const KeyboardInputHandler = keyboardModule.namespace.KeyboardInputHandler;
const keyboard = new KeyboardInputHandler();
for (const [domKey, internalKey] of [
    ['w', 'up'],
    ['A', 'left'],
    ['s', 'down'],
    ['D', 'right']
]) {
    windowListeners.get('keydown')({ key: domKey, repeat: false });
    assert.equal(keyboard.getKeyboardInput(internalKey), true);
    windowListeners.get('keyup')({ key: domKey });
    assert.equal(keyboard.getKeyboardInput(internalKey), false);
}
assert.ok(documentListeners.has('visibilitychange'));

console.log('ingame tower player control contract: ok');
