import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { loadGameModule } from './source_module_loader.mjs';

const DEFAULT_REPLAY_FIXTURE_URL = new URL(
    '../fixtures/sdl_porting/game_system_replay_v1.json',
    import.meta.url
);
const DEFAULT_BASELINE_FIXTURE_URL = new URL(
    '../fixtures/sdl_porting/game_system_state_hashes_v1.json',
    import.meta.url
);
const BASELINE_SCHEMA_VERSION = 1;
const HASH_ALGORITHM = 'fnv1a64-utf8';
const CANONICAL_ENCODING = 'cirvivor-canonical-v1-f64be';
const FNV_OFFSET_BASIS_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const UINT64_MASK = 0xffffffffffffffffn;
const MAX_REPLAY_TICKS = 100000;
const FLOAT64_BUFFER = new ArrayBuffer(8);
const FLOAT64_VIEW = new DataView(FLOAT64_BUFFER);

/**
 * UTF-8 byte 길이를 포함한 문자열 토큰을 만듭니다.
 * @param {string} value - 인코딩할 문자열입니다.
 * @returns {string} canonical 문자열 토큰입니다.
 */
function encodeCanonicalString(value) {
    return `S${Buffer.byteLength(value, 'utf8')}:${value};`;
}

/**
 * JavaScript Number의 IEEE-754 binary64 bit pattern을 big-endian 16진수로 만듭니다.
 * @param {number} value - 인코딩할 유한 숫자입니다.
 * @returns {string} 16자리 소문자 16진수입니다.
 */
function encodeFloat64Bits(value) {
    FLOAT64_VIEW.setFloat64(0, value, false);
    let result = '';
    for (let index = 0; index < 8; index++) {
        result += FLOAT64_VIEW.getUint8(index).toString(16).padStart(2, '0');
    }
    return result;
}

/**
 * 지원하는 JSON 값의 key 순서와 숫자 bit pattern을 고정한 문자열을 만듭니다.
 * @param {*} value - canonicalize할 값입니다.
 * @returns {string} 언어 간 state hash 입력 문자열입니다.
 */
export function canonicalizeBaselineValue(value) {
    if (value === null) {
        return 'N;';
    }
    if (typeof value === 'boolean') {
        return value ? 'B1;' : 'B0;';
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new TypeError('baseline hash에는 유한한 숫자만 사용할 수 있습니다.');
        }
        return `F${encodeFloat64Bits(value)};`;
    }
    if (typeof value === 'string') {
        return encodeCanonicalString(value);
    }
    if (Array.isArray(value)) {
        let result = `A${value.length}[`;
        for (let index = 0; index < value.length; index++) {
            result += canonicalizeBaselineValue(value[index]);
        }
        return `${result}];`;
    }
    if (value && typeof value === 'object') {
        const keys = Object.keys(value).sort();
        let result = `O${keys.length}{`;
        for (let index = 0; index < keys.length; index++) {
            const key = keys[index];
            result += encodeCanonicalString(key);
            result += canonicalizeBaselineValue(value[key]);
        }
        return `${result}};`;
    }
    throw new TypeError(`baseline hash가 지원하지 않는 값입니다: ${typeof value}`);
}

/**
 * UTF-8 문자열을 FNV-1a 64-bit로 해시합니다.
 * @param {string} value - 해시할 canonical 문자열입니다.
 * @returns {string} 16자리 소문자 16진수입니다.
 */
function hashUtf8String(value) {
    const bytes = Buffer.from(value, 'utf8');
    let hash = FNV_OFFSET_BASIS_64;
    for (let index = 0; index < bytes.length; index++) {
        hash ^= BigInt(bytes[index]);
        hash = (hash * FNV_PRIME_64) & UINT64_MASK;
    }
    return hash.toString(16).padStart(16, '0');
}

/**
 * JSON 호환 값을 baseline hash로 변환합니다.
 * @param {*} value - 해시할 값입니다.
 * @returns {string} 16자리 FNV-1a 64-bit hash입니다.
 */
export function hashBaselineValue(value) {
    return hashUtf8String(canonicalizeBaselineValue(value));
}

/**
 * byte 배열을 FNV-1a 64-bit로 해시합니다.
 * @param {Uint8Array} bytes - 해시할 byte 배열입니다.
 * @returns {string} 16자리 FNV-1a 64-bit hash입니다.
 */
function hashBytes(bytes) {
    let hash = FNV_OFFSET_BASIS_64;
    for (let index = 0; index < bytes.length; index++) {
        hash ^= BigInt(bytes[index]);
        hash = (hash * FNV_PRIME_64) & UINT64_MASK;
    }
    return hash.toString(16).padStart(16, '0');
}

/**
 * fixture JSON을 읽습니다.
 * @param {URL|string} fixtureUrl - 읽을 JSON URL 또는 경로입니다.
 * @returns {Promise<object>} 파싱한 fixture입니다.
 */
export async function readReplayFixture(fixtureUrl = DEFAULT_REPLAY_FIXTURE_URL) {
    return JSON.parse(await readFile(fixtureUrl, 'utf8'));
}

/**
 * replay source fixture의 fixed tick과 의미 action 계약을 검증합니다.
 * @param {object} fixture - 검증할 replay fixture입니다.
 * @param {Readonly<Record<string,string>>} inputActionIds - 현재 게임 의미 action ID입니다.
 * @returns {void}
 */
function assertReplayFixture(fixture, inputActionIds) {
    if (fixture?.schemaVersion !== BASELINE_SCHEMA_VERSION
        || typeof fixture?.fixtureId !== 'string'
        || fixture.fixtureId.length === 0
        || typeof fixture?.mapId !== 'string'
        || fixture.mapId.length === 0) {
        throw new TypeError('SDL replay fixture의 schemaVersion·fixtureId·mapId가 필요합니다.');
    }

    const fixedHz = Number(fixture.fixedStep?.hz);
    const fixedDeltaSeconds = Number(fixture.fixedStep?.deltaSeconds);
    const tickCount = Number(fixture.fixedStep?.tickCount);
    if (fixedHz !== 60
        || !Number.isFinite(fixedDeltaSeconds)
        || Math.abs(fixedDeltaSeconds - (1 / fixedHz)) > Number.EPSILON
        || !Number.isInteger(tickCount)
        || tickCount <= 0
        || tickCount > MAX_REPLAY_TICKS) {
        throw new RangeError('SDL replay fixture는 60Hz와 유효한 tickCount를 사용해야 합니다.');
    }

    const viewportWidth = Number(fixture.viewport?.ww);
    const viewportHeight = Number(fixture.viewport?.wh);
    if (!Number.isFinite(viewportWidth)
        || viewportWidth <= 0
        || !Number.isFinite(viewportHeight)
        || viewportHeight <= 0) {
        throw new RangeError('SDL replay fixture viewport는 양의 유한 크기여야 합니다.');
    }

    const supportedActions = new Set([
        inputActionIds.MOVE_UP,
        inputActionIds.MOVE_DOWN,
        inputActionIds.MOVE_LEFT,
        inputActionIds.MOVE_RIGHT
    ]);
    const timeline = fixture.inputTimeline;
    if (!Array.isArray(timeline)
        || timeline.length === 0
        || timeline[0]?.tick !== 0) {
        throw new TypeError('inputTimeline은 tick 0에서 시작해야 합니다.');
    }

    let previousTick = -1;
    for (let index = 0; index < timeline.length; index++) {
        const entry = timeline[index];
        if (!Number.isInteger(entry?.tick)
            || entry.tick <= previousTick
            || entry.tick < 0
            || entry.tick >= tickCount
            || !Array.isArray(entry.pressedActions)) {
            throw new TypeError(`inputTimeline[${index}]의 tick/action 계약이 유효하지 않습니다.`);
        }
        previousTick = entry.tick;
        const uniqueActions = new Set(entry.pressedActions);
        if (uniqueActions.size !== entry.pressedActions.length
            || entry.pressedActions.some((actionId) => !supportedActions.has(actionId))) {
            throw new TypeError(`inputTimeline[${index}]에 지원하지 않거나 중복된 action이 있습니다.`);
        }
    }

    if (!Array.isArray(fixture.checkpointTicks)
        || fixture.checkpointTicks.length === 0) {
        throw new TypeError('하나 이상의 checkpointTicks가 필요합니다.');
    }
    let previousCheckpoint = -1;
    for (let index = 0; index < fixture.checkpointTicks.length; index++) {
        const tick = fixture.checkpointTicks[index];
        if (!Number.isInteger(tick)
            || tick <= previousCheckpoint
            || tick < 0
            || tick >= tickCount) {
            throw new TypeError('checkpointTicks는 범위 안에서 오름차순이어야 합니다.');
        }
        previousCheckpoint = tick;
    }
    if (previousCheckpoint !== tickCount - 1) {
        throw new TypeError('마지막 fixed tick은 반드시 checkpoint여야 합니다.');
    }
}

/**
 * 현재 타일 맵의 native 이식용 정적 snapshot을 만듭니다.
 * @param {object} tileMap - 현재 ITileNavigationSource입니다.
 * @returns {object} 정적 월드 snapshot입니다.
 */
function createStaticWorldSnapshot(tileMap) {
    const grid = tileMap.getNavigationGrid();
    let walkableTileCount = 0;
    for (let index = 0; index < grid.blocked.length; index++) {
        walkableTileCount += grid.blocked[index] === 0 ? 1 : 0;
    }

    return {
        mapId: tileMap.mapId,
        tileGrid: {
            cols: grid.cols,
            rows: grid.rows,
            size: grid.size,
            cellSize: grid.cellSize,
            walkableTileCount,
            blockedBytesHash: hashBytes(grid.blocked)
        },
        worldBounds: { ...tileMap.getWorldBounds() },
        towerSpawnPosition: { ...tileMap.getTowerSpawnPosition() },
        corePosition: { ...tileMap.getCorePosition() },
        spawnRoutes: Array.from(tileMap.getSpawnRoutes(), (route) => ({
            gateId: route.gateId,
            pathId: route.pathId,
            entryPoint: { ...route.entryPoint },
            coreAttackPoint: { ...route.coreAttackPoint },
            waypoints: Array.from(route.waypoints, (waypoint) => ({ ...waypoint }))
        }))
    };
}

/**
 * IPhysicsBody2D의 fixed 권위 상태를 복사합니다.
 * @param {object} body - 복사할 물리 바디입니다.
 * @returns {object} 물리 상태 snapshot입니다.
 */
function createPhysicsBodySnapshot(body) {
    const inverseMass = body.getInverseMass();
    return {
        physicsBodyId: body.physicsBodyId,
        bodyType: body.getBodyType(),
        enabled: body.isPhysicsEnabled(),
        mass: inverseMass === 0 ? null : body.getMass(),
        inverseMass,
        position: { ...body.getPosition() },
        previousPosition: { ...body.getPreviousPosition() },
        velocity: { ...body.getVelocity() }
    };
}

/**
 * ICollidable2D의 형상과 filter 상태를 복사합니다.
 * @param {object} collider - 복사할 collider입니다.
 * @returns {object} collider snapshot입니다.
 */
function createColliderSnapshot(collider) {
    return {
        colliderId: collider.colliderId,
        shape: collider.getShapeType(),
        enabled: collider.isCollisionEnabled(),
        radius: collider.getRadius(),
        collisionLayer: collider.getCollisionLayer(),
        collisionMask: collider.getCollisionMask()
    };
}

/**
 * fixed tick 뒤 Tower/Core와 파생 count를 native 비교용 snapshot으로 만듭니다.
 * @param {object} objectSystem - 현재 GameObjectSystem입니다.
 * @param {object} coreIntegrity - 현재 CoreIntegrity입니다.
 * @param {number} tick - 완료한 0-based fixed tick입니다.
 * @param {string} staticWorldHash - 정적 맵 계약 hash입니다.
 * @param {number} tileCorrectionCount - 이번 tick 위치 보정 횟수입니다.
 * @returns {object} authoritative fixed state입니다.
 */
function createFixedStateSnapshot(
    objectSystem,
    coreIntegrity,
    tick,
    staticWorldHash,
    tileCorrectionCount
) {
    const tower = objectSystem.getTower();
    const core = objectSystem.getCore();
    const entities = [
        {
            id: core.id,
            kind: core.kind,
            active: core.active,
            radius: core.radius,
            physics: createPhysicsBodySnapshot(core.getPhysicsBody()),
            collider: createColliderSnapshot(core.getCollider()),
            integrity: {
                current: coreIntegrity.getCurrentIntegrity(),
                maximum: coreIntegrity.getMaxIntegrity(),
                depleted: coreIntegrity.isDepleted()
            }
        },
        {
            id: tower.id,
            kind: tower.kind,
            active: tower.active,
            radius: tower.radius,
            moveIntent: { ...tower.moveIntent },
            physics: createPhysicsBodySnapshot(tower.getPhysicsBody()),
            collider: createColliderSnapshot(tower.getCollider())
        }
    ];
    entities.sort((left, right) => left.id.localeCompare(right.id));

    return {
        tick,
        staticWorldHash,
        counts: {
            entityCount: entities.filter((entity) => entity.active).length,
            physicsBodyCount: objectSystem.getPhysicsBodies().length,
            colliderCount: objectSystem.getCollidables().length,
            projectileCount: 0,
            contactCount: 0,
            committedEventCount: 0,
            tileCorrectionCount
        },
        entities
    };
}

/**
 * GameSystem에 주입할 결정적 headless port 묶음을 만듭니다.
 * @param {object} fixture - replay fixture입니다.
 * @returns {{dependencies:object,setPressedActions:(actions:string[])=>void}} port와 입력 setter입니다.
 */
function createHeadlessDependencies(fixture) {
    const pressedActions = new Set();
    const wheelTotals = { x: 0, y: 0 };
    const viewport = {
        ww: fixture.viewport.ww,
        wh: fixture.viewport.wh
    };
    return {
        dependencies: {
            inputActionSource: {
                isPressed(actionId) {
                    return pressedActions.has(actionId);
                },
                getWheelTotals(out) {
                    out.x = wheelTotals.x;
                    out.y = wheelTotals.y;
                    return out;
                }
            },
            animationPort: {
                animate() {
                    throw new Error('fixed-only baseline에서 animation을 실행할 수 없습니다.');
                }
            },
            timePort: {
                getFixedDelta() {
                    return fixture.fixedStep.deltaSeconds;
                },
                getFixedInterpolationAlpha() {
                    return 0;
                }
            },
            viewportPort: {
                getSnapshot(out) {
                    out.ww = viewport.ww;
                    out.wh = viewport.wh;
                    return out;
                }
            },
            worldRenderPort: {
                drawCircle() {},
                drawSquareInstances() {}
            }
        },
        setPressedActions(actions) {
            pressedActions.clear();
            for (let index = 0; index < actions.length; index++) {
                pressedActions.add(actions[index]);
            }
        }
    };
}

/**
 * 현재 JavaScript GameSystem으로 replay를 실행하고 tick별 state hash baseline을 만듭니다.
 * @param {object} fixture - source replay fixture입니다.
 * @returns {Promise<object>} native C++ 비교용 baseline입니다.
 */
export async function exportGameSystemBaseline(fixture) {
    const [{ GameSystem }, { INPUT_ACTION_IDS }] = await Promise.all([
        loadGameModule('ingame/game_system.js'),
        loadGameModule('input/_input_binding_constants.js')
    ]);
    assertReplayFixture(fixture, INPUT_ACTION_IDS);

    const harness = createHeadlessDependencies(fixture);
    const gameSystem = new GameSystem(harness.dependencies, {
        mapId: fixture.mapId
    });
    if (gameSystem.enter() !== true) {
        throw new Error('baseline GameSystem 세션에 진입하지 못했습니다.');
    }

    const objectSystem = gameSystem.getObjectSystem();
    const coreIntegrity = gameSystem.getCoreIntegrity();
    const staticWorld = createStaticWorldSnapshot(objectSystem.getTileMap());
    if (staticWorld.mapId !== fixture.mapId) {
        gameSystem.destroy();
        throw new Error(
            `replay mapId가 등록된 production 맵과 일치하지 않습니다: ${fixture.mapId}`
        );
    }
    const staticWorldHash = hashBaselineValue(staticWorld);
    const emptyEventsHash = hashBaselineValue([]);
    const records = [];
    const checkpoints = [];
    let totalTileCorrectionCount = 0;
    let maximumTowerSpeed = 0;
    let timelineIndex = 0;
    let activeActions = fixture.inputTimeline[0].pressedActions;
    const checkpointSet = new Set(fixture.checkpointTicks);

    const collisionResolver = objectSystem.tileCollisionResolver;
    const originalResolve = collisionResolver.resolve.bind(collisionResolver);
    let tileCorrectionCount = 0;
    collisionResolver.resolve = (collider) => {
        tileCorrectionCount = originalResolve(collider);
        return tileCorrectionCount;
    };

    const initialState = createFixedStateSnapshot(
        objectSystem,
        coreIntegrity,
        -1,
        staticWorldHash,
        0
    );
    const initialStateHash = hashBaselineValue(initialState);

    try {
        for (let tick = 0; tick < fixture.fixedStep.tickCount; tick++) {
            if (timelineIndex + 1 < fixture.inputTimeline.length
                && fixture.inputTimeline[timelineIndex + 1].tick === tick) {
                timelineIndex++;
                activeActions = fixture.inputTimeline[timelineIndex].pressedActions;
            }
            harness.setPressedActions(activeActions);
            tileCorrectionCount = 0;
            gameSystem.fixedUpdate();

            const state = createFixedStateSnapshot(
                objectSystem,
                coreIntegrity,
                tick,
                staticWorldHash,
                tileCorrectionCount
            );
            const inputHash = hashBaselineValue({
                pressedActions: [...activeActions].sort()
            });
            const stateHash = hashBaselineValue(state);
            records.push({
                tick,
                inputHash,
                rngState: null,
                entityCount: state.counts.entityCount,
                projectileCount: state.counts.projectileCount,
                contactCount: state.counts.contactCount,
                tileCorrectionCount,
                stateHash,
                eventsHash: emptyEventsHash
            });
            totalTileCorrectionCount += tileCorrectionCount;
            const towerVelocity = objectSystem.getTower().getPhysicsBody().getVelocity();
            maximumTowerSpeed = Math.max(
                maximumTowerSpeed,
                Math.hypot(towerVelocity.x, towerVelocity.y)
            );
            if (checkpointSet.has(tick)) {
                checkpoints.push({
                    tick,
                    inputActions: [...activeActions],
                    stateHash,
                    state
                });
            }
        }
    } finally {
        gameSystem.destroy();
    }

    return {
        schemaVersion: BASELINE_SCHEMA_VERSION,
        fixtureId: fixture.fixtureId,
        oracle: {
            runtime: 'javascript-game-system',
            contractVersion: 1,
            hashAlgorithm: HASH_ALGORITHM,
            canonicalEncoding: CANONICAL_ENCODING,
            authoritativeScope: [
                'map identity and navigation contract',
                'Tower and Core entity/component state',
                'executed 60Hz fixed ticks',
                'semantic movement actions',
                'tile collision position corrections'
            ],
            excludedPresentationState: [
                'viewport dimensions',
                'render interpolation position',
                'camera zoom and follow projection',
                'animation time'
            ],
            unavailableCapabilities: [
                'deterministic RNG state',
                'projectiles',
                'general contact stream',
                'committed gameplay event stream'
            ]
        },
        replay: {
            mapId: fixture.mapId,
            fixedStep: { ...fixture.fixedStep },
            viewport: { ...fixture.viewport },
            inputTimeline: fixture.inputTimeline.map((entry) => ({
                tick: entry.tick,
                pressedActions: [...entry.pressedActions]
            }))
        },
        staticWorld,
        staticWorldHash,
        initialStateHash,
        initialState,
        records,
        checkpoints,
        summary: {
            tickCount: records.length,
            totalTileCorrectionCount,
            maximumTowerSpeed,
            finalStateHash: records.at(-1).stateHash
        }
    };
}

/**
 * 기본 source fixture를 실행합니다.
 * @returns {Promise<object>} 생성한 baseline입니다.
 */
export async function exportDefaultGameSystemBaseline() {
    return exportGameSystemBaseline(await readReplayFixture());
}

/**
 * 저장된 baseline이 현재 JavaScript oracle 결과와 같은지 확인합니다.
 * @returns {Promise<object>} 검증된 현재 baseline입니다.
 */
export async function checkDefaultGameSystemBaseline() {
    const [actual, expected] = await Promise.all([
        exportDefaultGameSystemBaseline(),
        readReplayFixture(DEFAULT_BASELINE_FIXTURE_URL)
    ]);
    if (!isDeepStrictEqual(actual, expected)) {
        throw new Error(
            'SDL GameSystem baseline이 현재 oracle과 다릅니다. '
            + '`npm run baseline:sdl:update`로 의도한 변경을 검토해 갱신하세요.'
        );
    }
    return actual;
}

/**
 * CLI 모드로 baseline을 확인·갱신·출력합니다.
 * @returns {Promise<void>}
 */
async function runCli() {
    const args = new Set(process.argv.slice(2));
    const baseline = await exportDefaultGameSystemBaseline();
    if (args.has('--update')) {
        await writeFile(
            DEFAULT_BASELINE_FIXTURE_URL,
            `${JSON.stringify(baseline, null, 2)}\n`,
            'utf8'
        );
        console.log(
            `SDL GameSystem baseline updated: ${baseline.records.length} ticks, `
            + `${baseline.summary.totalTileCorrectionCount} tile corrections`
        );
        return;
    }
    if (args.has('--stdout')) {
        process.stdout.write(`${JSON.stringify(baseline, null, 2)}\n`);
        return;
    }

    const expected = await readReplayFixture(DEFAULT_BASELINE_FIXTURE_URL);
    if (!isDeepStrictEqual(baseline, expected)) {
        throw new Error(
            'SDL GameSystem baseline check failed. '
            + '`npm run baseline:sdl:update`로 의도한 변경을 검토해 갱신하세요.'
        );
    }
    console.log(
        `SDL GameSystem baseline ok: ${baseline.records.length} ticks, `
        + `${baseline.summary.finalStateHash}`
    );
}

const isMainModule = process.argv[1]
    && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMainModule) {
    await runCli();
}
