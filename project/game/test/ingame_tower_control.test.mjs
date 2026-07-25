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
const {
    isCollidable2D,
    isCircleCollidable2D
} = await loadGameModule('ingame/contract/collidable_contract.js');
const {
    isCoreIntegrity
} = await loadGameModule('ingame/contract/core_integrity_contract.js');
const {
    CAMERA_ZOOM_LIMITS,
    isCameraControl2D,
    isCameraFollowTarget2D
} = await loadGameModule('ingame/contract/camera_control_contract.js');
const {
    PHYSICS_BODY_TYPES,
    isPhysicsBody2D,
    isPhysicsBodyOwner
} = await loadGameModule('ingame/contract/physics_body_contract.js');
const { InputActionMapper } = await loadGameModule('ingame/input/input_action_mapper.js');
const { INPUT_ACTION_IDS } = await loadGameModule(
    'input/_input_binding_constants.js'
);
const { GameSystem } = await loadGameModule('ingame/game_system.js');
const { PhysicsBody2D } = await loadGameModule('ingame/physics/physics_body_2d.js');
const { THE_TOWER_DATA } = await loadGameModule(
    'data/object/tower/the_tower_data.js'
);
const { THE_CORE_DATA } = await loadGameModule(
    'data/object/core/the_core_data.js'
);
const { TILE_WORLD_SIZE } = await loadGameModule(
    'ingame/map/tile_map.js'
);

/**
 * 부동소수점 projection 좌표를 허용 오차로 비교합니다.
 * @param {{x:number,y:number}} actual - 실제 좌표입니다.
 * @param {{x:number,y:number}} expected - 기대 좌표입니다.
 * @param {number} [epsilon=1e-9] - 허용 오차입니다.
 * @returns {void}
 */
function assertPointNearlyEqual(actual, expected, epsilon = 1e-9) {
    assert.ok(Math.abs(actual.x - expected.x) <= epsilon);
    assert.ok(Math.abs(actual.y - expected.y) <= epsilon);
}

const pressedDirections = new Set([
    INPUT_ACTION_IDS.MOVE_UP,
    INPUT_ACTION_IDS.MOVE_RIGHT
]);
const mapper = new InputActionMapper();
const diagonalMove = mapper.mapMoveAction({
    isPressed(key) {
        return pressedDirections.has(key);
    }
});
assert.equal(diagonalMove.type, PLAYER_ACTION_TYPES.MOVE_VECTOR);
assert.ok(Math.abs(diagonalMove.payload.x - Math.SQRT1_2) < 1e-12);
assert.ok(Math.abs(diagonalMove.payload.y + Math.SQRT1_2) < 1e-12);

pressedDirections.add(INPUT_ACTION_IDS.MOVE_LEFT);
const cancelledHorizontalMove = mapper.mapMoveAction({
    isPressed(key) {
        return pressedDirections.has(key);
    }
});
assert.equal(cancelledHorizontalMove.payload.x, 0);
assert.ok(Math.abs(cancelledHorizontalMove.payload.y + 1) < 1e-12);

const contractBody = new PhysicsBody2D({
    physicsBodyId: 'contract-body',
    mass: 2,
    linearFriction: 0,
    maxLinearSpeed: 100
});
assert.ok(isPhysicsBody2D(contractBody));
assert.ok(isPhysicsBodyOwner({
    getPhysicsBody() {
        return contractBody;
    }
}));
assert.equal(contractBody.getBodyType(), PHYSICS_BODY_TYPES.DYNAMIC);
assert.equal(contractBody.getMass(), 2);
assert.equal(contractBody.getInverseMass(), 0.5);
assert.equal(contractBody.beginStep(), true);
assert.equal(contractBody.applyImpulse(10, 0), true);
assert.equal(contractBody.applyForce(4, 0), true);
assert.equal(contractBody.integrate(0.5), true);
assert.equal(contractBody.getVelocity().x, 6);
assert.equal(contractBody.getPosition().x, 3);
assert.equal(contractBody.getPreviousPosition().x, 0);
assert.equal(contractBody.applyPositionCorrection(2, -1), true);
assert.equal(contractBody.getPosition().x, 5);
assert.equal(contractBody.getPosition().y, -1);
assert.equal(contractBody.getPreviousPosition().x, 0);

const keys = Object.create(null);
const viewport = {
    ww: 2560,
    wh: 1440
};
const time = {
    fixedDelta: 1 / 60,
    alpha: 0.5
};
const circleDraws = [];
const squareInstanceDraws = [];
const wheelTotals = { x: 0, y: 0 };
const cameraAnimations = [];
let nextCameraAnimationId = 1;
const gameSystem = new GameSystem({
    inputActionSource: {
        isPressed(key) {
            return keys[key] === true;
        },
        getWheelTotals(out) {
            Object.assign(out, wheelTotals);
            return out;
        }
    },
    animationPort: {
        animate(owner, properties) {
            const record = {
                owner,
                properties: { ...properties },
                retargets: [],
                active: true
            };
            const handle = {
                id: nextCameraAnimationId++,
                promise: Promise.resolve(),
                retarget(nextProperties) {
                    if (!record.active) return false;
                    record.retargets.push({ ...nextProperties });
                    record.properties = { ...record.properties, ...nextProperties };
                    return true;
                },
                remove() {
                    record.active = false;
                },
                isActive() {
                    return record.active;
                }
            };
            record.handle = handle;
            cameraAnimations.push(record);
            return handle;
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
        },
        drawSquareInstances(options) {
            squareInstanceDraws.push({
                ...options,
                centers: options.centers.map((center) => ({ ...center }))
            });
        }
    }
});

assert.equal(gameSystem.enter(), true);
assert.equal(gameSystem.enter(), false);

const gameObjectSystem = gameSystem.getObjectSystem();
const tower = gameObjectSystem.getTower();
const core = gameObjectSystem.getCore();
const tileMap = gameObjectSystem.getTileMap();
const [towerController] = gameObjectSystem.getPlayerControllables();
const towerPhysicsBody = tower.getPhysicsBody();
const corePhysicsBody = core.getPhysicsBody();
const towerCollider = tower.getCollider();
const coreIntegrity = gameSystem.getCoreIntegrity();
const cameraZoomController = gameSystem.getCameraZoomController();
const worldProjection = gameObjectSystem.getWorldViewProjection();
assert.ok(isPlayerControllable(towerController));
assert.ok(isPlayerControllerable(towerController));
assert.ok(isPlayerControllable(cameraZoomController));
assert.ok(isCameraControl2D(worldProjection));
assert.ok(isCameraFollowTarget2D(tower));
assert.strictEqual(gameObjectSystem.getCameraFollowTarget(), tower);
assert.ok(isPhysicsBodyOwner(tower));
assert.ok(isPhysicsBody2D(towerPhysicsBody));
assert.ok(isPhysicsBody2D(corePhysicsBody));
assert.ok(isCollidable2D(towerCollider));
assert.ok(isCircleCollidable2D(towerCollider));
assert.ok(isCollidable2D(core.getCollider()));
assert.ok(isCoreIntegrity(coreIntegrity));
assert.strictEqual(core.getCoreIntegrity(), coreIntegrity);
assert.strictEqual(gameObjectSystem.getPhysicsBodies()[0], towerPhysicsBody);
assert.strictEqual(gameObjectSystem.getPhysicsBodies()[1], corePhysicsBody);
assert.strictEqual(gameObjectSystem.getCollidables()[0], towerCollider);
assert.equal('hp' in tower, false);
assert.equal('health' in tower, false);
assert.equal(coreIntegrity.getMaxIntegrity(), THE_CORE_DATA.MAX_INTEGRITY);
assert.equal(coreIntegrity.getCurrentIntegrity(), 100);
assert.equal(coreIntegrity.applyIntegrityDamage(30), 30);
assert.equal(coreIntegrity.getCurrentIntegrity(), 70);
assert.equal(coreIntegrity.restoreIntegrity(30), 30);
assert.equal(coreIntegrity.getCurrentIntegrity(), 100);
assert.equal(tileMap.getNavigationGrid().cellSize, TILE_WORLD_SIZE);
assert.equal(tileMap.getNavigationGrid().cols, 54);
assert.equal(tileMap.getNavigationGrid().rows, 30);
assert.equal(gameObjectSystem.getEnemySpawnRoutes().length, 1);
assert.equal(tower.position.x, tileMap.getTowerSpawnPosition().x);
assert.equal(tower.position.y, tileMap.getTowerSpawnPosition().y);
assert.equal(core.position.x, tileMap.getCorePosition().x);
assert.equal(core.position.y, tileMap.getCorePosition().y);

keys[INPUT_ACTION_IDS.MOVE_RIGHT] = true;
const initialTowerX = tower.position.x;
const initialTowerY = tower.position.y;
gameSystem.fixedUpdate();
const frictionDecay = Math.exp(
    -THE_TOWER_DATA.LINEAR_FRICTION_PER_SECOND * time.fixedDelta
);
const expectedVelocity = (
    THE_TOWER_DATA.CONTROL_ACCELERATION_TILES_PER_SECOND_SQUARED
    / THE_TOWER_DATA.LINEAR_FRICTION_PER_SECOND
) * (1 - frictionDecay);
const expectedStep = expectedVelocity * time.fixedDelta;
assert.ok(Math.abs(towerPhysicsBody.getVelocity().x - expectedVelocity) < 1e-9);
assert.ok(Math.abs(tower.position.x - (initialTowerX + expectedStep)) < 1e-9);
assert.equal(tower.position.y, initialTowerY);

gameSystem.update();
assert.ok(
    Math.abs(tower.renderPosition.x - (initialTowerX + (expectedStep * 0.5))) < 1e-9
);
assert.equal(tower.renderPosition.y, initialTowerY);

gameSystem.draw();
assert.equal(squareInstanceDraws.length, 1);
assert.ok(squareInstanceDraws[0].centers.length > 0);
assert.equal(squareInstanceDraws[0].layer, 'background');
const projectedTileSize = worldProjection.worldLengthToViewport(TILE_WORLD_SIZE);
assert.equal(
    squareInstanceDraws[0].size,
    projectedTileSize * (1 - (1 / 24))
);
assert.equal(circleDraws.length, 2);
const coreDraw = circleDraws.find(({ fill }) => fill === '#ffb52e');
const towerDraw = circleDraws.find(({ fill }) => fill === '#2785ff');
assert.ok(coreDraw);
assert.ok(towerDraw);
assert.equal(towerDraw.layer, 'object');
assert.equal(
    towerDraw.diameter,
    worldProjection.worldLengthToViewport(THE_TOWER_DATA.RADIUS_TILES * 2)
);
const projectedTowerPosition = worldProjection.worldToViewport(
    tower.renderPosition.x,
    tower.renderPosition.y,
    {}
);
assert.equal(towerDraw.x, projectedTowerPosition.x);
assert.equal(towerDraw.y, projectedTowerPosition.y);

const firstAcceleratedVelocity = towerPhysicsBody.getVelocity().x;
for (let index = 0; index < 60; index++) {
    gameSystem.fixedUpdate();
}
assert.ok(towerPhysicsBody.getVelocity().x > firstAcceleratedVelocity);
assert.ok(
    Math.abs(
        towerPhysicsBody.getVelocity().x
        - THE_TOWER_DATA.MOVE_SPEED_TILES_PER_SECOND
    ) < 0.02
);

keys[INPUT_ACTION_IDS.MOVE_RIGHT] = false;
const coastingStartX = tower.position.x;
const coastingStartVelocity = towerPhysicsBody.getVelocity().x;
gameSystem.fixedUpdate();
assert.ok(tower.position.x > coastingStartX);
assert.ok(towerPhysicsBody.getVelocity().x > 0);
assert.ok(towerPhysicsBody.getVelocity().x < coastingStartVelocity);
assert.ok(
    Math.abs(
        towerPhysicsBody.getVelocity().x - (coastingStartVelocity * frictionDecay)
    ) < 1e-9
);

for (let index = 0; index < 100; index++) {
    gameSystem.fixedUpdate();
}
assert.equal(towerPhysicsBody.getVelocity().x, 0);
const frictionStoppedX = tower.position.x;
gameSystem.fixedUpdate();
assert.equal(tower.position.x, frictionStoppedX);

assert.equal(towerPhysicsBody.applyImpulse(-2.5, 0), true);
assert.equal(towerPhysicsBody.getVelocity().x, -2.5);
const recoilStartX = tower.position.x;
gameSystem.fixedUpdate();
assert.ok(tower.position.x < recoilStartX);
assert.ok(towerPhysicsBody.getVelocity().x < 0);
assert.ok(towerPhysicsBody.getVelocity().x > -2.5);

for (let index = 0; index < 100; index++) {
    gameSystem.fixedUpdate();
}
assert.equal(towerPhysicsBody.getVelocity().x, 0);

const correctionStartX = tower.position.x;
const correctionPreviousX = tower.previousPosition.x;
assert.equal(towerPhysicsBody.applyPositionCorrection(0.125, 0), true);
assert.equal(tower.position.x, correctionStartX + 0.125);
assert.equal(tower.previousPosition.x, correctionPreviousX);

keys[INPUT_ACTION_IDS.MOVE_LEFT] = true;
for (let index = 0; index < 1500; index++) {
    gameSystem.fixedUpdate();
}
const centerTile = tileMap.worldToTile(tower.position.x, tower.position.y, {});
let firstWalkableColumn = 0;
while (!tileMap.isWalkableTile(centerTile.row, firstWalkableColumn)) {
    firstWalkableColumn++;
}
const expectedLeftBoundary = (firstWalkableColumn * TILE_WORLD_SIZE)
    + THE_TOWER_DATA.RADIUS_TILES;
assert.equal(tower.position.x, expectedLeftBoundary);
assert.equal(towerPhysicsBody.getVelocity().x, 0);

keys[INPUT_ACTION_IDS.MOVE_LEFT] = false;
const releasedX = tower.position.x;
gameSystem.fixedUpdate();
assert.equal(tower.position.x, releasedX);

viewport.ww = 1280;
viewport.wh = 720;
gameSystem.resize();
assert.equal(tower.position.x, releasedX);
assert.equal(tower.position.y, initialTowerY);
gameSystem.draw();
const resizedTowerDraw = circleDraws
    .slice(-2)
    .find(({ fill }) => fill === '#2785ff');
assert.ok(resizedTowerDraw);
assert.equal(resizedTowerDraw.diameter, towerDraw.diameter * 0.5);

viewport.ww = 30;
viewport.wh = 40;
gameSystem.resize();
assert.equal(tower.position.x, releasedX);
assert.equal(tower.position.y, initialTowerY);

viewport.ww = 1280;
viewport.wh = 720;
gameSystem.resize();
assert.equal(worldProjection.getZoom(), CAMERA_ZOOM_LIMITS.DEFAULT);
assert.equal(CAMERA_ZOOM_LIMITS.DEFAULT, 0.7);
assertPointNearlyEqual(
    worldProjection.worldToViewport(27, 15, {}),
    { x: 640, y: 360 }
);

wheelTotals.y = -1;
gameSystem.update();
assert.equal(cameraAnimations.length, 1);
assert.equal(cameraAnimations[0].properties.variable, 'zoom');
assert.equal(cameraAnimations[0].properties.duration, 0.4);
assert.equal(cameraAnimations[0].properties.type, 'easeOutExpo');
assert.ok(
    Math.abs(
        cameraZoomController.getTargetZoom()
        - (CAMERA_ZOOM_LIMITS.DEFAULT * 1.16)
    ) < 1e-12
);

worldProjection.zoom = 0.76;
gameSystem.update();
assertPointNearlyEqual(
    worldProjection.worldToViewport(
        tower.renderPosition.x,
        tower.renderPosition.y,
        {}
    ),
    { x: 640, y: 360 }
);
assert.ok(worldProjection.viewportToWorld(0, 360, {}).x < 0);

const followStartRenderX = tower.renderPosition.x;
assert.equal(towerPhysicsBody.applyPositionCorrection(1, 0), true);
gameSystem.update();
assert.ok(tower.renderPosition.x > followStartRenderX);
assertPointNearlyEqual(
    worldProjection.worldToViewport(
        tower.renderPosition.x,
        tower.renderPosition.y,
        {}
    ),
    { x: 640, y: 360 }
);

wheelTotals.y = -2;
gameSystem.update();
assert.equal(cameraAnimations.length, 1);
assert.equal(cameraAnimations[0].retargets.length, 1);
assert.ok(
    Math.abs(
        cameraZoomController.getTargetZoom()
        - (CAMERA_ZOOM_LIMITS.DEFAULT * (1.16 ** 2))
    ) < 1e-12
);
gameSystem.update();
assert.equal(cameraAnimations[0].retargets.length, 1);

wheelTotals.y = 0;
gameSystem.update();
assert.equal(cameraAnimations[0].retargets.length, 2);
assert.equal(
    cameraZoomController.getTargetZoom(),
    CAMERA_ZOOM_LIMITS.DEFAULT
);
worldProjection.zoom = CAMERA_ZOOM_LIMITS.DEFAULT;
gameSystem.update();
assertPointNearlyEqual(
    worldProjection.worldToViewport(27, 15, {}),
    { x: 640, y: 360 }
);
assert.ok(worldProjection.viewportToWorld(0, 0, {}).x < 0);

assert.equal(
    towerController.handlePlayerAction({ type: 'unsupported' }),
    INPUT_DISPOSITIONS.PASS
);
gameSystem.destroy();
gameSystem.destroy();
assert.equal(tower.active, false);
assert.equal(core.active, false);
assert.equal(towerController.isControlEnabled(), false);
assert.equal(cameraZoomController.isControlEnabled(), false);
assert.equal(cameraAnimations[0].active, false);
assert.equal(towerPhysicsBody.isPhysicsEnabled(), false);
assert.equal(corePhysicsBody.isPhysicsEnabled(), false);
assert.equal(towerCollider.isCollisionEnabled(), false);
contractBody.destroy();

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
for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) {
    windowListeners.get('keydown')({ code, repeat: false });
    assert.equal(keyboard.getKeyboardInput(code), true);
    windowListeners.get('keyup')({ code });
    assert.equal(keyboard.getKeyboardInput(code), false);
}
windowListeners.get('keydown')({ key: 'w', repeat: false });
assert.equal(keyboard.getKeyboardInput('KeyW'), false);
assert.ok(documentListeners.has('visibilitychange'));

console.log('ingame tower player control contract: ok');
