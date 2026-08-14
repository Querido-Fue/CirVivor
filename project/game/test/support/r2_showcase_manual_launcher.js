import {
    BASIC_CIRCLE_ENEMY_DATA
} from 'data/object/enemy/basic_circle_enemy_data.js';
import { THE_CORE_DATA } from 'data/object/core/the_core_data.js';
import {
    R2_ENEMY_SHOWCASE_MAP_DATA
} from 'data/scene/game/r2_enemy_showcase_map_data.js';
import {
    R2_ENEMY_SHOWCASE_WAVES
} from 'data/scene/game/r2_enemy_showcase_wave_data.js';
import {
    PERFORMANCE_SERPENTINE_MAP_DATA
} from 'data/scene/game/performance_serpentine_map_data.js';
import {
    PERFORMANCE_SERPENTINE_SESSION,
    PERFORMANCE_SERPENTINE_WAVE_01_DATA
} from 'data/scene/game/performance_serpentine_wave_data.js';
import { getWebGpuPlatformPort } from 'display/display_system.js';
import { GameScene } from 'scene/game/_game_scene.js';
import { clearSimulationCommands } from 'simulation/simulation_command_queue.js';
import { TileMap } from 'ingame/map/tile_map.js';
import {
    PLAYER_ACTION_TYPES
} from 'ingame/contract/player_controllable_contract.js';
import {
    CAMERA_ZOOM_LIMITS
} from 'ingame/contract/camera_control_contract.js';
import {
    createGpuEnemySpawnIntent
} from 'ingame/object/enemy/gpu_enemy_spawn_adapter.js';
import {
    resolveEnemySpawnStats
} from 'ingame/object/enemy/resolved_enemy_spawn_stats.js';
import { fsPromises, nw, path } from 'util/nw_bridge.js';

const MANUAL_API_VERSION = 1;
const MANUAL_PAUSE_REASON = 'post-r2-s1-manual-showcase';
const APP_INACTIVE_PAUSE_REASON = 'app-inactive';
const ACTION_HISTORY_CAPACITY = 12;
const GAME_READY_TIMEOUT_MS = 30_000;
const STATUS_REFRESH_MS = 200;
const CAPTURE_TIMEOUT_MS = 10_000;
const TEST_POLICY_ID_PREFIX = 'post-r2-s1-manual-authenticated';
const CORE_CONTACT_INGRESS_GAP_TILES = 1 / 128;

const PAUSE_POLICY = Object.freeze({
    keepLoopRunning: true,
    runFixedStep: false,
    runAnimationUpdate: false,
    runInputUpdate: false,
    runUiUpdate: false,
    runOverlayUpdate: false,
    runObjectUpdate: false,
    runSceneUpdate: false,
    runSimulationCommandApply: false,
    pauseBgm: true,
    resetInputOnEnter: true,
    setMouseInactiveOnEnter: false
});

/**
 * Hidden STARTUPINFO로 시작된 지원 runner에서도 NW window를 실제 foreground 후보로
 * 복구합니다. Game.start()는 production activity policy가 document.hasFocus()를 다시
 * 읽게 하므로 app-inactive pause를 직접 지우거나 상태를 합성하지 않습니다.
 */
function requestManualShowcaseForeground(game = null) {
    const appWindow = nw.Window.get();
    appWindow.show();
    appWindow.focus();
    window.focus();
    game?.start?.();
    return document.hasFocus();
}

function waitForGame() {
    const startedAt = performance.now();
    return new Promise((resolve, reject) => {
        const poll = () => {
            const game = window.Game;
            const sceneSystem = game?.systemHandler?.sceneSystem;
            const platformPort = getWebGpuPlatformPort();
            const platformState = platformPort?.getState?.();
            if (sceneSystem?.sceneState === 'title'
                && platformState?.ready === true) {
                resolve(game);
                return;
            }
            if (performance.now() - startedAt >= GAME_READY_TIMEOUT_MS) {
                reject(new Error(
                    'production window.Game/WebGPU platform 초기화 제한시간을 초과했습니다.'
                ));
                return;
            }
            setTimeout(poll, 25);
        };
        poll();
    });
}

function requireWaveNumber(value) {
    const waveNumber = Number(value);
    if (!Number.isInteger(waveNumber)
        || waveNumber < 1
        || waveNumber > R2_ENEMY_SHOWCASE_WAVES.length) {
        throw new RangeError('showcase wave 번호는 1~3이어야 합니다.');
    }
    return waveNumber;
}

function finiteOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function countOrZero(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function freezeAction(action) {
    return Object.freeze({ ...action });
}

function clonePlainDiagnostic(value) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (error) {
        return Object.freeze({
            diagnosticSerializationFailure: String(error?.message ?? error)
        });
    }
}

function findFirstRecoveryCause(snapshot) {
    const endpoint = snapshot?.endpoint ?? {};
    const object = snapshot?.object ?? {};
    const candidates = [
        ['endpoint.events', endpoint.events?.protocolFailure],
        ['endpoint.lifecycle', endpoint.lifecycle?.recoveryRequired === true
            ? endpoint.lifecycle
            : null],
        ['endpoint.fixedCommands', endpoint.fixedCommands?.recoveryRequired === true
            ? endpoint.fixedCommands
            : null],
        ['endpoint.effectCommands', endpoint.effectCommands?.recoveryRequired === true
            ? endpoint.effectCommands
            : null],
        ['endpoint.formationCommands',
            endpoint.formationCommands?.recoveryRequired === true
                ? endpoint.formationCommands
                : null],
        ['endpoint.atomicTransformCommands',
            endpoint.atomicTransformCommands?.recoveryRequired === true
                ? endpoint.atomicTransformCommands
                : null],
        ['endpoint.projectileCapture',
            endpoint.projectileCapture?.requiresRecovery === true
                ? endpoint.projectileCapture
                : null],
        ['endpoint.backend', endpoint.backend?.gpu?.failure
            ?? endpoint.backend?.failure
            ?? null],
        ['hostileAttack', object.hostileAttack?.failure],
        ['coreImpact', object.coreImpact?.cleanupFailure
            ?? object.coreImpact?.failure
            ?? null],
        ['pentagonEffect', object.pentagonEffect?.failure],
        ['formation', object.formation?.failure],
        ['jorang', object.jorang?.failure],
        ['projectileCaptureDirector', object.projectileCapture?.failure],
        ['corkRouteClosure', object.corkRouteClosure?.failure]
    ];
    for (const [domain, detail] of candidates) {
        if (detail !== null && detail !== undefined && detail !== false) {
            return Object.freeze({ domain, detail });
        }
    }
    return Object.freeze({
        domain: 'game-object-system',
        detail: Object.freeze({
            endpointRecoveryRequired: endpoint.recoveryRequired === true,
            directorRecoveryRequired: Object.freeze({
                hostileAttack: object.hostileAttack?.recoveryRequired === true,
                coreImpact: object.coreImpact?.recoveryRequired === true,
                pentagonEffect: object.pentagonEffect?.recoveryRequired === true,
                formation: object.formation?.recoveryRequired === true,
                jorang: object.jorang?.recoveryRequired === true,
                projectileCapture:
                    object.projectileCapture?.recoveryRequired === true,
                corkRouteClosure:
                    object.corkRouteClosure?.recoveryRequired === true
            })
        })
    });
}

function createQaWaveModifiers({ towerContactDamage, coreImpactDamage }) {
    return Object.freeze({
        global: Object.freeze({
            multipliers: Object.freeze({}),
            absolute: Object.freeze({
                towerContactDamage,
                coreImpactDamage
            })
        }),
        byEnemyDefinitionId: Object.freeze({})
    });
}

function createCoreIngressIntent(baseIntent, route, corePosition) {
    const targetWaypointIndex = route.waypoints.length - 1;
    const targetWaypoint = route.waypoints[targetWaypointIndex];
    const previousWaypoint = route.waypoints[targetWaypointIndex - 1];
    const directionX = targetWaypoint.x - previousWaypoint.x;
    const directionY = targetWaypoint.y - previousWaypoint.y;
    const directionLength = Math.hypot(directionX, directionY);
    if (!(directionLength > 0)) {
        throw new Error('Core ingress route의 마지막 두 waypoint가 겹칩니다.');
    }
    const unitX = directionX / directionLength;
    const unitY = directionY / directionLength;
    const separation = baseIntent.radius
        + THE_CORE_DATA.RADIUS_TILES
        + CORE_CONTACT_INGRESS_GAP_TILES;
    return Object.freeze({
        ...baseIntent,
        waypointIndex: targetWaypointIndex,
        position: Object.freeze({
            x: corePosition.x - (unitX * separation),
            y: corePosition.y - (unitY * separation)
        }),
        velocity: Object.freeze({
            x: unitX * baseIntent.flowSpeed,
            y: unitY * baseIntent.flowSpeed
        })
    });
}

function capturePagePng() {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error('NW capturePage 제한시간을 초과했습니다.'));
        }, CAPTURE_TIMEOUT_MS);
        try {
            nw.Window.get().capturePage((data) => {
                clearTimeout(timeoutId);
                try {
                    resolve(typeof data === 'string'
                        ? Buffer.from(data, 'base64')
                        : Buffer.from(data));
                } catch (error) {
                    reject(error);
                }
            }, { format: 'png', datatype: 'buffer' });
        } catch (error) {
            clearTimeout(timeoutId);
            reject(error);
        }
    });
}

function sanitizeCaptureLabel(value) {
    const normalized = String(value ?? '')
        .trim()
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
    return normalized || 'checkpoint';
}

function padIdentifier(value, width) {
    return String(countOrZero(value)).padStart(width, '0');
}

function createPanel() {
    const root = document.createElement('section');
    root.id = 'r2-showcase-manual-root';
    root.dataset.collapsed = 'false';
    root.innerHTML = `
        <div class="r2-manual-title-row">
            <strong>Post-R2 S1 · actual GameScene</strong>
            <button id="r2-manual-toggle-panel" type="button">패널 접기</button>
        </div>
        <div class="r2-manual-collapsible">
            <div class="r2-manual-controls" aria-label="Showcase wave controls">
                <button id="r2-manual-wave-1" type="button">Wave 1</button>
                <button id="r2-manual-wave-2" type="button">Wave 2</button>
                <button id="r2-manual-wave-3" type="button">Wave 3</button>
                <button id="r2-manual-performance" type="button">Map 2 · 10K</button>
                <button id="r2-manual-pause" type="button">Pause</button>
                <button id="r2-manual-resume" type="button">Resume</button>
                <button id="r2-manual-capture" type="button">Screenshot</button>
            </div>
            <div class="r2-manual-controls" aria-label="Camera controls">
                <button id="r2-manual-camera-fit" type="button">Fit Map</button>
                <button id="r2-manual-camera-follow" type="button">Follow Tower/Core</button>
                <button id="r2-manual-camera-zoom-in" type="button">Zoom +</button>
                <button id="r2-manual-camera-zoom-out" type="button">Zoom −</button>
            </div>
            <div class="r2-manual-controls" aria-label="Authenticated gameplay probes">
                <button id="r2-manual-tower-lethal" type="button" data-danger="true">GPU contact → Tower death</button>
                <button id="r2-manual-core-defeat" type="button" data-danger="true">GPU Core impact → DEFEATED</button>
                <button id="r2-manual-safe-exit" type="button">Safe Exit</button>
            </div>
            <p class="r2-manual-note">실제 조작: WASD/방향키 = Tower 이동 · LMB 누르기 = Basic Bullet 발사 · 마우스 휠 = zoom/follow. 패널 버튼 입력은 gameplay 발사/zoom으로 전파되지 않습니다. Follow는 살아 있는 Tower, Tower 사망 뒤에는 Core fallback을 추적합니다.</p>
            <p class="r2-manual-note">위 두 빨간 버튼은 상태를 직접 변경하지 않습니다. canonical C intent를 public GPU lifecycle에 예약하며, QA damage override가 실제 contact/Core-impact 경로에서 검증·적용됩니다. Tower probe는 활성 Maximum Damage Window보다 확실히 큰 요청을 쓰되 실제 감소량은 현재 HP로 clamp됩니다. Core 버튼은 Tower 사망 후에만 활성 동작합니다. Screenshot은 명시적 클릭/API 호출 때만 ignored evidence 폴더에 저장됩니다.</p>
            <pre id="r2-manual-status" aria-live="polite">초기화 중…</pre>
            <pre id="r2-manual-action-log" aria-label="bounded evidence log"></pre>
            <pre id="r2-manual-last-error" aria-live="assertive"></pre>
        </div>`;
    document.body.appendChild(root);
    return root;
}

class R2ShowcaseManualController {
    constructor(game, panel) {
        this.game = game;
        this.sceneSystem = game.systemHandler.sceneSystem;
        this.panel = panel;
        this.currentScene = null;
        this.currentWaveNumber = 0;
        this.currentMapId = null;
        this.currentWaveDefinition = null;
        this.spawnSequence = 1_000_000;
        this.actionSequence = 0;
        this.actions = [];
        this.lastError = null;
        this.statusTimer = null;
        this.captureInFlight = false;
        this.exiting = false;
        this.showcaseReady = false;
        this.firstRecoveryFailure = null;
        this.recoveryFailureCount = 0;
        this.restoreFixedUpdateProbe = null;
        this.titleStartArmed = false;
        this.titleStartRoute = (mapId) => this.#startShowcaseFromTitle(mapId);
        this.originalConsoleWarn = console.warn;
        this.loopWarningCapture = (...args) => {
            if (String(args[0] ?? '').includes('프레임 루프 중 오류')) {
                const error = args.find((value) => value instanceof Error);
                this.lastError = Object.freeze({
                    message: String(error?.stack ?? error ?? args.join(' ')),
                    timestamp: new Date().toISOString()
                });
                this.#renderStatus();
            }
            this.originalConsoleWarn.apply(console, args);
        };
        console.warn = this.loopWarningCapture;
        this.boundBeforeUnload = () => this.destroy();
        this.#bindPanel();
        window.addEventListener('beforeunload', this.boundBeforeUnload, {
            once: true
        });
    }

    start() {
        this.titleStartArmed = true;
        this.sceneSystem.gameStart = this.titleStartRoute;
        this.#setShowcaseControlsEnabled(false);
        this.panel.querySelector('#r2-manual-status').textContent = [
            'Post-R2 S1 showcase 준비 완료',
            '타이틀의 게임 시작 버튼을 누르면 Wave 1로 진입합니다.',
            'production map registry는 변경하지 않습니다.'
        ].join('\n');
        this.#record('showcase-route-armed', '타이틀 gameStart → injection-only Wave 1');
        this.statusTimer = setInterval(() => this.#renderStatus(), STATUS_REFRESH_MS);
        return this;
    }

    selectWave(value) {
        const waveNumber = requireWaveNumber(value);
        this.resume();
        clearSimulationCommands();
        this.#detachRecoveryProbe();
        this.sceneSystem.scene?.destroy?.();

        const tileMap = new TileMap(R2_ENEMY_SHOWCASE_MAP_DATA);
        const waveDefinition = R2_ENEMY_SHOWCASE_WAVES[waveNumber - 1];
        const scene = new GameScene(this.sceneSystem, {
            mapId: R2_ENEMY_SHOWCASE_MAP_DATA.id,
            tileNavigationSource: tileMap,
            enemyWaveEnabled: true,
            gameplayWorldActorsEnabled: true,
            enemyRecoveryEnabled: true,
            waveDefinition
        });
        this.sceneSystem.scene = scene;
        this.sceneSystem.sceneState = 'inGame';
        this.currentScene = scene;
        this.currentWaveNumber = waveNumber;
        this.currentMapId = R2_ENEMY_SHOWCASE_MAP_DATA.id;
        this.currentWaveDefinition = waveDefinition;
        this.firstRecoveryFailure = null;
        this.recoveryFailureCount = 0;
        this.#attachRecoveryProbe(scene);
        this.game.resize();
        this.#record('wave-selected', `Wave ${waveNumber}: ${waveDefinition.waveId}`);
        this.#renderStatus();
        return this.getSnapshot();
    }

    selectPerformanceMap() {
        this.resume();
        clearSimulationCommands();
        this.#detachRecoveryProbe();
        this.sceneSystem.scene?.destroy?.();

        const tileMap = new TileMap(PERFORMANCE_SERPENTINE_MAP_DATA);
        const scene = new GameScene(this.sceneSystem, {
            mapId: PERFORMANCE_SERPENTINE_MAP_DATA.id,
            tileNavigationSource: tileMap,
            enemyWaveEnabled: true,
            gameplayWorldActorsEnabled: true,
            enemyRecoveryEnabled: true,
            towerMaxHp: PERFORMANCE_SERPENTINE_SESSION.towerMaxHp,
            coreMaxIntegrity: PERFORMANCE_SERPENTINE_SESSION.coreMaxIntegrity,
            waveDefinition: PERFORMANCE_SERPENTINE_WAVE_01_DATA
        });
        this.sceneSystem.scene = scene;
        this.sceneSystem.sceneState = 'inGame';
        this.currentScene = scene;
        this.currentWaveNumber = 0;
        this.currentMapId = PERFORMANCE_SERPENTINE_MAP_DATA.id;
        this.currentWaveDefinition = PERFORMANCE_SERPENTINE_WAVE_01_DATA;
        this.firstRecoveryFailure = null;
        this.recoveryFailureCount = 0;
        this.#attachRecoveryProbe(scene);
        this.game.resize();
        this.#record(
            'performance-map-selected',
            `Map 2: ${PERFORMANCE_SERPENTINE_WAVE_01_DATA.waveId}`
        );
        this.#renderStatus();
        return this.getSnapshot();
    }

    pause() {
        const changed = this.game.setPauseReason(
            MANUAL_PAUSE_REASON,
            true,
            PAUSE_POLICY
        );
        if (changed) {
            this.#record('paused', 'fixed/presentation update 정지, render loop 유지');
        }
        this.#renderStatus();
        return changed;
    }

    resume() {
        requestManualShowcaseForeground(this.game);
        const changed = this.game.isPauseReasonActive(MANUAL_PAUSE_REASON)
            ? (this.game.clearPauseReason(MANUAL_PAUSE_REASON), true)
            : false;
        if (changed) {
            this.#record('resumed', 'pause epoch presentation synchronization 완료');
        }
        this.#renderStatus();
        return changed;
    }

    requestTowerLethalContact() {
        const status = this.#getGameSystem().getGameplayStatus();
        if (!status.tower.available || status.tower.alive !== true) {
            throw new Error('살아 있는 GPU Tower가 없어서 lethal contact를 예약하지 않았습니다.');
        }
        const currentHp = finiteOrNull(status.tower.currentHp);
        if (!(currentHp > 0)) {
            throw new Error('현재 Tower HP를 읽을 수 없어 QA damage를 만들지 않았습니다.');
        }
        const damage = currentHp + 1_000_000;
        return this.#requestAuthenticatedEnemyContact({
            targetKind: 'tower',
            towerContactDamage: damage,
            coreImpactDamage: 0
        });
    }

    requestCoreDefeatImpact() {
        const status = this.#getGameSystem().getGameplayStatus();
        if (status.tower.alive !== false) {
            throw new Error('camera Core fallback 검증을 위해 Tower 사망 뒤에 실행해야 합니다.');
        }
        const damage = finiteOrNull(status.core.currentIntegrity);
        if (!(damage > 0)) {
            throw new Error('현재 Core Integrity가 이미 0이거나 읽을 수 없습니다.');
        }
        return this.#requestAuthenticatedEnemyContact({
            targetKind: 'core',
            towerContactDamage: 0,
            coreImpactDamage: damage
        });
    }

    async captureScreenshot(label = `wave-${this.currentWaveNumber}`) {
        if (this.captureInFlight) {
            throw new Error('이전 screenshot 저장이 아직 진행 중입니다.');
        }
        const evidenceDirectory = process.env.CIRVIVOR_R2_SHOWCASE_EVIDENCE_DIR;
        if (typeof evidenceDirectory !== 'string' || evidenceDirectory.length === 0) {
            throw new Error('지원 runner가 evidence directory를 주입하지 않았습니다.');
        }
        this.captureInFlight = true;
        try {
            await new Promise((resolve) => requestAnimationFrame(() => (
                requestAnimationFrame(resolve)
            )));
            await fsPromises.mkdir(evidenceDirectory, { recursive: true });
            const snapshot = this.getSnapshot();
            const nextActionSequence = this.actionSequence + 1;
            const fileName = [
                `wave-${padIdentifier(snapshot.waveNumber, 2)}`,
                `tick-${padIdentifier(snapshot.fixedTick, 8)}`,
                `action-${padIdentifier(nextActionSequence, 4)}`,
                sanitizeCaptureLabel(label)
            ].join('-') + '.png';
            const filePath = path.join(evidenceDirectory, fileName);
            await fsPromises.writeFile(filePath, await capturePagePng());
            this.#record('screenshot-saved', filePath);
            this.#renderStatus();
            return filePath;
        } finally {
            this.captureInFlight = false;
        }
    }

    getSnapshot() {
        const gameSystem = this.#getGameSystem();
        const gameplay = gameSystem.getGameplayStatus();
        const objectSystem = gameSystem.getObjectSystem();
        const jorang = objectSystem.getJorangSplitLineageStatus();
        const capture = objectSystem.getProjectileCaptureStatus();
        const closure = objectSystem.getCorkRouteClosureStatus();
        const endpoint = gameSystem.getGpuSimulationEndpoint().getStatus();
        const platform = getWebGpuPlatformPort()?.getState?.() ?? null;
        const framePolicy = this.game.systemHandler.getFrameExecutionPolicy();
        const pauseReasons = Object.freeze([
            ...this.game.systemHandler.pauseReasons.keys()
        ]);
        const lifecycleCommit = endpoint.lifecycle?.lastCommitResult ?? null;
        const manualPaused = this.game.isPauseReasonActive(MANUAL_PAUSE_REASON);
        const appInactivePaused = this.game.isPauseReasonActive(
            APP_INACTIVE_PAUSE_REASON
        );
        return Object.freeze({
            apiVersion: MANUAL_API_VERSION,
            actualGameScene: this.currentScene instanceof GameScene,
            mapId: this.currentMapId,
            waveNumber: this.currentWaveNumber,
            waveId: this.currentWaveDefinition?.waveId ?? null,
            paused: manualPaused || appInactivePaused,
            manualPaused,
            appInactivePaused,
            windowFocused: document.hasFocus(),
            loopRunning: this.game.running === true,
            framePolicy: Object.freeze({ ...framePolicy }),
            pauseReasons,
            frameTiming: Object.freeze({
                accumulatorSeconds: finiteOrNull(this.game.accumulatorSeconds),
                lastFrameTimestamp: finiteOrNull(this.game.lastFrameTimestamp),
                lastFrameCpuSeconds: finiteOrNull(this.game.lastFrameCpuSeconds)
            }),
            fixedTick: countOrZero(gameplay.fixedTick),
            sessionMode: gameplay.sessionMode,
            recoveryRequired: gameplay.recoveryRequired === true,
            tower: gameplay.tower,
            core: gameplay.core,
            outcome: gameplay.outcome,
            wave: gameplay.wave,
            formation: gameplay.formation,
            jorang: Object.freeze({
                pendingTransformBatchCount: countOrZero(jorang?.pendingTransformBatchCount),
                pendingFirstHitCount: countOrZero(jorang?.pendingFirstHitCount),
                circlePrimeDueCount: countOrZero(jorang?.circlePrimeDueCount),
                lastTriggerEventCount: countOrZero(jorang?.lastTriggerEventCount),
                recoveryRequired: jorang?.recoveryRequired === true
            }),
            capture: Object.freeze({
                capturedProjectileCount: countOrZero(capture?.capturedProjectileCount),
                heldCount: countOrZero(capture?.heldCount),
                releasePendingCount: countOrZero(capture?.releasePendingCount),
                recoveryRequired: capture?.recoveryRequired === true
            }),
            closure: Object.freeze({
                rosterCount: countOrZero(closure?.rosterCount),
                assignedLeaseCount: countOrZero(closure?.assignedLeaseCount),
                closedPathIds: Object.freeze([...(closure?.closedPathIds ?? [])]),
                recoveryRequired: closure?.recoveryRequired === true
            }),
            recovery: Object.freeze({
                ...this.currentScene.getEnemyRecoveryStatus(),
                failureCount: this.recoveryFailureCount,
                firstFailure: this.firstRecoveryFailure
            }),
            endpoint: Object.freeze({
                runtimeState: endpoint.state ?? null,
                activeBodyCount: countOrZero(endpoint.activeCount),
                pendingCommandCount: countOrZero(endpoint.pendingCommandCount),
                recoveryRequired: endpoint.recoveryRequired === true,
                platformStatus: platform?.status ?? null,
                platformReady: platform?.ready === true,
                backendState: endpoint.backend?.state ?? null,
                backendGpuState: endpoint.backend?.gpu?.state ?? null,
                backendFailure: endpoint.backend?.gpu?.failure ?? null,
                lifecyclePendingCount: countOrZero(endpoint.lifecycle?.pendingCount),
                lifecycleLastState: lifecycleCommit?.state ?? null,
                lifecycleRecoveryRequired:
                    endpoint.lifecycle?.recoveryRequired === true,
                lifecycleRejectedReasons: Object.freeze([
                    ...(lifecycleCommit?.rejected ?? [])
                ].map((entry) => entry?.reason ?? null))
            }),
            recentActions: Object.freeze([...this.actions]),
            lastError: this.lastError
        });
    }

    setCameraView(mode) {
        const gameSystem = this.#getGameSystem();
        const camera = gameSystem.getObjectSystem().getWorldViewProjection();
        const controller = gameSystem.getCameraZoomController();
        if (mode === 'fit') {
            controller.handlePlayerAction({
                type: PLAYER_ACTION_TYPES.CAMERA_ZOOM,
                payload: { wheelDelta: 12 }
            });
            camera.zoom = CAMERA_ZOOM_LIMITS.DEFAULT;
            camera.resetViewCenter();
        } else if (mode === 'follow') {
            if (controller.getTargetZoom() <= CAMERA_ZOOM_LIMITS.DEFAULT) {
                controller.handlePlayerAction({
                    type: PLAYER_ACTION_TYPES.CAMERA_ZOOM,
                    payload: { wheelDelta: -7 }
                });
            }
            camera.zoom = controller.getTargetZoom();
            controller.updateFollowTarget();
        } else if (mode === 'zoom-in' || mode === 'zoom-out') {
            controller.handlePlayerAction({
                type: PLAYER_ACTION_TYPES.CAMERA_ZOOM,
                payload: { wheelDelta: mode === 'zoom-in' ? -1 : 1 }
            });
        } else {
            throw new RangeError(`지원하지 않는 camera mode입니다: ${mode}`);
        }
        this.#record('camera-view', mode);
        this.#renderStatus();
        return controller.getTargetZoom();
    }

    safeExit() {
        if (this.exiting) {
            return false;
        }
        this.exiting = true;
        this.#record('safe-exit', 'production Game.close; beforeunload에서 GameScene destroy');
        this.resume();
        this.game.close();
        return true;
    }

    destroy() {
        if (this.statusTimer !== null) {
            clearInterval(this.statusTimer);
            this.statusTimer = null;
        }
        const scene = this.currentScene;
        this.#restoreTitleStartRoute();
        this.#detachRecoveryProbe();
        if (this.sceneSystem.scene === scene) {
            this.sceneSystem.scene = null;
        }
        this.currentScene = null;
        this.currentMapId = null;
        this.currentWaveDefinition = null;
        window.removeEventListener('beforeunload', this.boundBeforeUnload);
        if (console.warn === this.loopWarningCapture) {
            console.warn = this.originalConsoleWarn;
        }
        scene?.destroy?.();
    }

    #getGameSystem() {
        const gameSystem = this.currentScene?.getGameSystem?.();
        if (!gameSystem) {
            throw new Error('활성 showcase GameSystem이 없습니다.');
        }
        return gameSystem;
    }

    #startShowcaseFromTitle(mapId) {
        if (!this.titleStartArmed || this.currentScene) {
            return false;
        }
        this.#restoreTitleStartRoute();
        this.showcaseReady = false;
        this.#setShowcaseControlsEnabled(false);
        this.selectWave(1);
        this.#record(
            'title-game-start-routed',
            `requestedMap=${typeof mapId === 'string' ? mapId : 'default'} → Wave 1`
        );
        this.#renderStatus();
        return true;
    }

    #restoreTitleStartRoute() {
        if (this.sceneSystem.gameStart === this.titleStartRoute) {
            delete this.sceneSystem.gameStart;
        }
        this.titleStartArmed = false;
    }

    #attachRecoveryProbe(scene) {
        const gameSystem = scene.getGameSystem();
        const originalFixedUpdate = gameSystem.fixedUpdate;
        const controller = this;
        function probedFixedUpdate(...args) {
            const beforeFixedTick = gameSystem.getFixedTick();
            const advanced = Reflect.apply(originalFixedUpdate, gameSystem, args);
            if (advanced !== true
                && gameSystem.isEnemySimulationRecoveryRequired()) {
                controller.#captureRecoveryFailure(
                    scene,
                    gameSystem,
                    beforeFixedTick
                );
            }
            return advanced;
        }
        gameSystem.fixedUpdate = probedFixedUpdate;
        this.restoreFixedUpdateProbe = () => {
            if (gameSystem.fixedUpdate === probedFixedUpdate) {
                gameSystem.fixedUpdate = originalFixedUpdate;
            }
        };
    }

    #detachRecoveryProbe() {
        this.restoreFixedUpdateProbe?.();
        this.restoreFixedUpdateProbe = null;
    }

    #captureRecoveryFailure(scene, gameSystem, beforeFixedTick) {
        this.recoveryFailureCount++;
        if (this.firstRecoveryFailure !== null) {
            return;
        }
        const objectSystem = gameSystem.getObjectSystem();
        const diagnostic = clonePlainDiagnostic({
            beforeFixedTick,
            afterFixedTick: gameSystem.getFixedTick(),
            sceneRecovery: scene.getEnemyRecoveryStatus(),
            endpoint: gameSystem.getGpuSimulationEndpoint().getStatus(),
            object: {
                wave: objectSystem.getEnemyWaveStatus(),
                towerCombat: objectSystem.getTowerCombatStatus(),
                hostileAttack: objectSystem.getHostileAttackStatus(),
                coreImpact: objectSystem.getCoreImpactStatus(),
                pentagonEffect: objectSystem.getPentagonEffectStatus(),
                formation: objectSystem.getFormationRuntimeStatus(),
                jorang: objectSystem.getJorangSplitLineageStatus(),
                projectileCapture: objectSystem.getProjectileCaptureStatus(),
                corkRouteClosure: objectSystem.getCorkRouteClosureStatus(),
                terminal: objectSystem.getTerminalStatus(),
                gpuWorldActors: objectSystem.getGpuWorldActorStatus()
            }
        });
        this.firstRecoveryFailure = Object.freeze({
            capturedAt: new Date().toISOString(),
            cause: findFirstRecoveryCause(diagnostic),
            diagnostic
        });
        console.warn(
            'R2 manual showcase first GPU recovery failure:',
            JSON.stringify(this.firstRecoveryFailure)
        );
    }

    #setShowcaseControlsEnabled(enabled) {
        for (const button of this.panel.querySelectorAll('button')) {
            if (button.id !== 'r2-manual-toggle-panel'
                && button.id !== 'r2-manual-safe-exit') {
                button.disabled = !enabled;
            }
        }
    }

    #requestAuthenticatedEnemyContact(options) {
        this.resume();
        const gameSystem = this.#getGameSystem();
        const objectSystem = gameSystem.getObjectSystem();
        const tileMap = objectSystem.getTileMap();
        const route = tileMap.getSpawnRoutes()[0];
        const target = options.targetKind === 'tower'
            ? tileMap.getTowerSpawnPosition()
            : tileMap.getCorePosition();
        const entry = route.waypoints[0];
        const resolvedStats = resolveEnemySpawnStats({
            definition: BASIC_CIRCLE_ENEMY_DATA,
            mapEnemyModifiers: tileMap.getEnemyModifiers(),
            waveEnemyModifiers: createQaWaveModifiers(options)
        });
        const spawnSequence = this.spawnSequence++;
        const baseIntent = createGpuEnemySpawnIntent({
            definition: BASIC_CIRCLE_ENEMY_DATA,
            route,
            spawnSequence,
            laneOffsetTiles: 0,
            initialWorldOffsetTiles: Object.freeze({
                x: target.x - entry.x,
                y: target.y - entry.y
            }),
            waveId: this.currentWaveDefinition.waveId,
            policyId: `${TEST_POLICY_ID_PREFIX}-${options.targetKind}`,
            resolvedStats
        });
        const intent = options.targetKind === 'core'
            ? createCoreIngressIntent(baseIntent, route, target)
            : baseIntent;
        const targetFixedTick = this.currentScene.getNextGpuLifecycleFixedTick();
        const commandId = `${TEST_POLICY_ID_PREFIX}:${options.targetKind}:${spawnSequence}`;
        const receipt = gameSystem.getGpuSimulationEndpoint().requestSpawn(
            intent,
            targetFixedTick,
            commandId
        );
        if (receipt?.accepted !== true) {
            throw new Error(`GPU lifecycle request 거부: ${JSON.stringify(receipt)}`);
        }
        this.#record(
            `${options.targetKind}-contact-queued`,
            `command=${commandId}, tick=${targetFixedTick}, towerDamage=${resolvedStats.towerContactDamage}, coreDamage=${resolvedStats.coreImpactDamage}`
        );
        this.#renderStatus();
        return Object.freeze({
            accepted: true,
            commandId,
            targetFixedTick,
            targetKind: options.targetKind,
            towerContactDamage: resolvedStats.towerContactDamage,
            coreImpactDamage: resolvedStats.coreImpactDamage
        });
    }

    #record(type, message) {
        const entry = freezeAction({
            sequence: ++this.actionSequence,
            type,
            message,
            fixedTick: this.currentScene?.getGameSystem?.().getFixedTick?.() ?? 0,
            timestamp: new Date().toISOString()
        });
        this.actions.push(entry);
        while (this.actions.length > ACTION_HISTORY_CAPACITY) {
            this.actions.shift();
        }
        this.lastError = null;
        return entry;
    }

    #recordError(error) {
        this.lastError = Object.freeze({
            message: String(error?.message ?? error),
            timestamp: new Date().toISOString()
        });
        console.error('R2 manual showcase action failed:', error);
        this.#renderStatus();
    }

    #bindPanel() {
        for (const eventType of ['mousedown', 'mouseup', 'wheel']) {
            this.panel.addEventListener(eventType, (event) => {
                event.stopPropagation();
            });
        }
        const bind = (id, handler) => {
            this.panel.querySelector(`#${id}`).addEventListener('click', () => {
                Promise.resolve()
                    .then(handler)
                    .catch((error) => this.#recordError(error));
            });
        };
        bind('r2-manual-wave-1', () => this.selectWave(1));
        bind('r2-manual-wave-2', () => this.selectWave(2));
        bind('r2-manual-wave-3', () => this.selectWave(3));
        bind('r2-manual-performance', () => this.selectPerformanceMap());
        bind('r2-manual-pause', () => this.pause());
        bind('r2-manual-resume', () => this.resume());
        bind('r2-manual-capture', () => this.captureScreenshot());
        bind('r2-manual-camera-fit', () => this.setCameraView('fit'));
        bind('r2-manual-camera-follow', () => this.setCameraView('follow'));
        bind('r2-manual-camera-zoom-in', () => this.setCameraView('zoom-in'));
        bind('r2-manual-camera-zoom-out', () => this.setCameraView('zoom-out'));
        bind('r2-manual-tower-lethal', () => this.requestTowerLethalContact());
        bind('r2-manual-core-defeat', () => this.requestCoreDefeatImpact());
        bind('r2-manual-safe-exit', () => this.safeExit());
        bind('r2-manual-toggle-panel', () => {
            const collapsed = this.panel.dataset.collapsed !== 'true';
            this.panel.dataset.collapsed = String(collapsed);
            this.panel.querySelector('#r2-manual-toggle-panel').textContent = collapsed
                ? '패널 펼치기'
                : '패널 접기';
        });
    }

    #renderStatus() {
        if (!this.currentScene) {
            return;
        }
        try {
            const status = this.getSnapshot();
            const firstSubmitPending = status.fixedTick === 0
                && status.endpoint.runtimeState === 'gpu-deferred'
                && status.recoveryRequired === false;
            if (!this.showcaseReady
                && status.fixedTick > 0
                && status.endpoint.runtimeState === 'gpu-ready'
                && status.recoveryRequired === false) {
                this.showcaseReady = true;
                this.#setShowcaseControlsEnabled(true);
                this.#record(
                    'showcase-gpu-ready',
                    `first completed fixed tick=${status.fixedTick}`
                );
            }
            const lines = [
                `${status.mapId} · ${status.waveId}`,
                `actualGameScene=${status.actualGameScene} | paused=${status.paused} (manual=${status.manualPaused}, appInactive=${status.appInactivePaused})`,
                `focus=${status.windowFocused} | loop=${status.loopRunning}`,
                `policy fixed=${status.framePolicy.runFixedStep} frame=${status.framePolicy.runFrameTimeUpdate} pauses=[${status.pauseReasons.join(', ')}]`,
                `frame acc=${status.frameTiming.accumulatorSeconds} last=${status.frameTiming.lastFrameTimestamp} cpu=${status.frameTiming.lastFrameCpuSeconds}`,
                `elapsed=${(status.fixedTick / 60).toFixed(1)}s | tick=${status.fixedTick}`,
                `mode=${status.sessionMode} | recovery=${status.recoveryRequired}`,
                `Recovery restarts=${status.recovery.restartCount} failures=${status.recovery.failureCount} first=${status.recovery.firstFailure?.cause?.domain ?? 'none'}`,
                `Tower ${status.tower.state} ${status.tower.currentHp}/${status.tower.maxHp}`,
                `Core ${status.core.currentIntegrity}/${status.core.maxIntegrity}`,
                `Outcome ${status.outcome.state}`,
                `Wave queued=${status.wave.queuedSpawnCount} remaining=${status.wave.remainingSpawnCount}`,
                `GPU bodies=${status.endpoint.activeBodyCount} pending=${status.endpoint.pendingCommandCount} state=${status.endpoint.runtimeState}${firstSubmitPending ? ' (T0 first-submit pending)' : ''}`,
                `GPU platform=${status.endpoint.platformStatus}/${status.endpoint.platformReady} backend=${status.endpoint.backendState}/${status.endpoint.backendGpuState}`,
                `lifecycle pending=${status.endpoint.lifecyclePendingCount} last=${status.endpoint.lifecycleLastState} recovery=${status.endpoint.lifecycleRecoveryRequired} rejected=[${status.endpoint.lifecycleRejectedReasons.join(', ')}]`,
                `H groups=${status.formation.activeGroupCount} hive=${status.formation.activeHiveCount}`,
                `J pending=${status.jorang.pendingTransformBatchCount} C′due=${status.jorang.circlePrimeDueCount}`,
                `R captured=${status.capture.capturedProjectileCount} held=${status.capture.heldCount}`,
                `Z leases=${status.closure.assignedLeaseCount} closed=[${status.closure.closedPathIds.join(', ')}]`
            ];
            this.panel.querySelector('#r2-manual-status').textContent = lines.join('\n');
            this.panel.querySelector('#r2-manual-action-log').textContent = status.recentActions
                .map((entry) => `#${entry.sequence} T${entry.fixedTick} ${entry.type}\n${entry.message}`)
                .join('\n');
            this.panel.querySelector('#r2-manual-last-error').textContent = status.lastError
                ? `ERROR ${status.lastError.timestamp}\n${status.lastError.message}`
                : '';
        } catch (error) {
            this.lastError = Object.freeze({
                message: String(error?.message ?? error),
                timestamp: new Date().toISOString()
            });
        }
    }
}

/**
 * production App 초기화가 끝난 뒤 injection-only R2 showcase GameScene과 수동 패널을 설치합니다.
 * 생산 map/menu registry를 변경하지 않으며 반환 API는 bounded status와 명시적 action만 노출합니다.
 */
export async function installR2ShowcaseManualLauncher() {
    if (window.__R2_SHOWCASE_MANUAL__) {
        return window.__R2_SHOWCASE_MANUAL__;
    }
    const panel = createPanel();
    requestManualShowcaseForeground();
    const game = await waitForGame();
    requestManualShowcaseForeground(game);
    const controller = new R2ShowcaseManualController(game, panel).start();
    const api = Object.freeze({
        apiVersion: MANUAL_API_VERSION,
        selectWave: (waveNumber) => controller.selectWave(waveNumber),
        selectPerformanceMap: () => controller.selectPerformanceMap(),
        pause: () => controller.pause(),
        resume: () => controller.resume(),
        setCameraView: (mode) => controller.setCameraView(mode),
        requestTowerLethalContact: () => controller.requestTowerLethalContact(),
        requestCoreDefeatImpact: () => controller.requestCoreDefeatImpact(),
        captureScreenshot: (label) => controller.captureScreenshot(label),
        getSnapshot: () => controller.getSnapshot(),
        safeExit: () => controller.safeExit()
    });
    Object.defineProperty(window, '__R2_SHOWCASE_MANUAL__', {
        value: api,
        writable: false,
        enumerable: false,
        configurable: false
    });
    return api;
}
