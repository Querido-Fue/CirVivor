import { THE_CORE_DATA } from 'data/object/core/the_core_data.js';
import { InputActionMapper } from './input/input_action_mapper.js';
import { CameraZoomController } from './input/camera_zoom_controller.js';
import { PlayerControlRouter } from './input/player_control_router.js';
import {
    GameObjectSystem,
    NEXT_WAVE_PROGRESSION_RESULT_CODE
} from './object/game_object_system.js';
import { TowerCombatRoster } from './object/tower/tower_combat_roster.js';
import { TowerGroupState } from './object/tower/tower_group_state.js';
import { CoreIntegrity } from './state/core_integrity.js';
import { RunOutcome } from './state/run_outcome.js';
import { RunCommerceState } from './state/run_commerce_state.js';
import {
    SHOP_OPEN_SOURCE_KIND,
    SHOP_PHASE_RESULT_CODE,
    SHOP_RUNTIME_PHASE,
    ShopPhaseCoordinator
} from './flow/shop_phase_coordinator.js';
import { WaveRunCoordinator } from './flow/wave_run_coordinator.js';
import {
    CoreOvertimePressureDirector,
    calculateCoreOvertimeDamageFixedPoint
} from './flow/core_overtime_pressure_director.js';
import {
    R9_CURRENT_WAVE_TRANSIENT_REARM_LIMITATION,
    auditR9RecoveryContinuity,
    createR9RecoveryContinuitySnapshot
} from './flow/r9_recovery_continuity_contract.js';
import {
    WAVE_SETTLEMENT_RESULT_CODE,
    WAVE_SETTLEMENT_STAGE,
    WaveSettlementCoordinator,
    createWaveSettlementTransactionId
} from './flow/wave_settlement_coordinator.js';
import { ShopUiCommandExecutor } from './flow/shop_ui_command_executor.js';
import { SentenceBoardState } from './word/sentence_board_state.js';
import { SentenceSlotController } from './word/sentence_slot_controller.js';
import { WordShopSession } from './word/word_shop_session.js';
import { WordSystem } from './word/word_system.js';
import {
    SHOP_RUNTIME_CONFIGURATION_MODE,
    normalizeShopRuntimeConfiguration
} from './contract/shop_runtime_configuration_contract.js';
import {
    getWaveRunPlanFingerprint,
    getWaveRunPlanWaveMetadata
} from './contract/wave_run_plan_contract.js';
import {
    WAVE_RUN_RESULT_CODE,
    WAVE_RUN_STATE
} from './contract/wave_run_state_contract.js';
import {
    createWaveClearProof
} from './contract/wave_quiescence_contract.js';
import {
    SENTENCE_RUNTIME_PHASE
} from './contract/word_sentence_contract.js';
import {
    FIXED_STEP_RESULT
} from 'simulation/fixed_step_result_contract.js';
import {
    GAME_WORLD_SESSION_MODE,
    selectGameWorldSessionMode
} from './game_world_session_mode.js';

const R9_COMBAT_CLOCK_STATES = new Set([
    WAVE_RUN_STATE.WAVE_ACTIVE,
    WAVE_RUN_STATE.DEADLINE_SPAWN_DRAIN,
    WAVE_RUN_STATE.OVERTIME
]);

const R9_DISABLED_SHOP_PREVIEW = Object.freeze({
    completedWaveOrdinal: 0,
    completedWaveId: null,
    clearType: null,
    overtimePulseCount: 0,
    overtimeDamageTotalFixedPoint: 0,
    nextWaveId: null,
    finalWave: false,
    mapClearReady: false
});

const R9_DISABLED_WAVE_FLOW_STATUS = Object.freeze({
    configured: false,
    waveOrdinal: 0,
    totalWaveCount: 0,
    waveId: null,
    waveState: WAVE_RUN_STATE.INACTIVE,
    elapsedTicks: 0,
    remainingTicks: 0,
    deadlineReached: false,
    hostileActorCount: 0,
    siegeWeight: 0,
    overtimeActive: false,
    overtimePulseOrdinal: 0,
    ticksUntilNextPulse: 0,
    projectedNextDamageFixedPoint: 0,
    settlementCode: null,
    resolutionProfileId: null,
    perEnemyUiObjectCount: 0,
    shopPreview: R9_DISABLED_SHOP_PREVIEW,
    pausePolicy: Object.freeze({
        clockSource: 'COMPLETED_FIXED_TICK_ONLY',
        pauseAdvanceTicks: 0,
        resumeCatchUpTicks: 0
    }),
    recovery: Object.freeze({
        restartCount: 0,
        automaticRestartCount: 0,
        lastCode: null,
        continuityPreserved: null,
        restartStormDetected: false,
        transientRearmLimitation:
            R9_CURRENT_WAVE_TRANSIENT_REARM_LIMITATION
    })
});

function normalizeDiagnosticCount(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function normalizeDiagnosticValue(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
}

function createTowerDiagnosticStatus(status) {
    if (!status || status.destroyed === true) {
        return Object.freeze({
            available: false,
            state: 'N/A',
            alive: null,
            currentHp: null,
            maxHp: null,
            livingTowerCount: null
        });
    }
    const alive = status.alive === true;
    return Object.freeze({
        available: true,
        state: alive ? 'ALIVE' : 'DEAD',
        alive,
        currentHp: normalizeDiagnosticValue(status.currentHp),
        maxHp: normalizeDiagnosticValue(status.maxHp),
        livingTowerCount: normalizeDiagnosticCount(status.livingTowerCount)
    });
}

function createCoreDiagnosticStatus(coreIntegrity) {
    if (!coreIntegrity) {
        return Object.freeze({
            available: false,
            currentIntegrity: null,
            maxIntegrity: null,
            depleted: null
        });
    }
    return Object.freeze({
        available: true,
        currentIntegrity: normalizeDiagnosticValue(
            coreIntegrity.getCurrentIntegrity()
        ),
        maxIntegrity: normalizeDiagnosticValue(
            coreIntegrity.getMaxIntegrity()
        ),
        depleted: coreIntegrity.isDepleted() === true
    });
}

function createModifierDiagnosticStatus(wordStatus, towerStatus) {
    const outcome = wordStatus?.lastExecutionOutcome ?? null;
    return Object.freeze({
        modifierSetFingerprint: normalizeDiagnosticCount(
            outcome?.modifierSetFingerprint
        ),
        modifierStackCount: normalizeDiagnosticCount(
            outcome?.modifierStackCount
        ),
        copiesPerSubject: outcome
            ? Math.max(1, normalizeDiagnosticCount(outcome.copiesPerSubject))
            : 1,
        effectiveGeneratedCount: normalizeDiagnosticCount(
            outcome?.effectiveGeneratedCount ?? outcome?.generatedCount
        ),
        resultingTowerCount: normalizeDiagnosticCount(
            towerStatus?.livingTowerCount
        ),
        lastModifierOutcome: outcome?.lastModifierOutcome
            ?? outcome?.code ?? null
    });
}

function createRunOutcomeDiagnosticStatus(runOutcome) {
    if (!runOutcome) {
        return Object.freeze({
            available: false,
            state: null,
            running: null,
            defeated: null,
            runFailedFact: null
        });
    }
    const status = runOutcome.getStatus();
    return Object.freeze({
        available: true,
        state: status.state,
        running: status.running === true,
        defeated: status.defeated === true,
        runFailedFact: status.runFailedFact
    });
}

function createHostileAttackDiagnosticStatus(status) {
    const telemetry = status?.telemetry ?? null;
    return Object.freeze({
        available: status !== null && status !== undefined,
        registeredArcherCount: normalizeDiagnosticCount(
            status?.activeArcherCount
        ),
        pendingShotCount: normalizeDiagnosticCount(status?.pendingShotCount),
        requestAttempts: normalizeDiagnosticCount(
            telemetry?.requestAttempts ?? status?.shotStartAttemptCount
        ),
        requestAccepted: normalizeDiagnosticCount(
            telemetry?.requestAccepted ?? status?.shotRequestAcceptedCount
        ),
        fixedAccepted: normalizeDiagnosticCount(telemetry?.fixedAccepted),
        completedResolved: normalizeDiagnosticCount(
            telemetry?.completedResolved ?? status?.shotResolvedCount
        ),
        completedSourceInvalid: normalizeDiagnosticCount(
            telemetry?.completedSourceInvalid
        ),
        completedTargetInvalid: normalizeDiagnosticCount(
            telemetry?.completedTargetInvalid
        ),
        noTargetTicks: normalizeDiagnosticCount(telemetry?.noTargetTicks),
        recoveryRequired: status?.recoveryRequired === true
    });
}

function createWaveDiagnosticStatus(status) {
    return Object.freeze({
        available: status !== null && status !== undefined,
        totalSpawnCount: normalizeDiagnosticCount(status?.totalSpawnCount),
        queuedSpawnCount: normalizeDiagnosticCount(status?.queuedSpawnCount),
        blockedSpawnCount: normalizeDiagnosticCount(status?.blockedSpawnCount),
        remainingSpawnCount: normalizeDiagnosticCount(
            status?.remainingSpawnCount
        ),
        allSpawnsQueued: status?.allSpawnsQueued === true
    });
}

function createPentagonEffectDiagnosticStatus(status) {
    return Object.freeze({
        available: status !== null && status !== undefined,
        activeEmitterCount: normalizeDiagnosticCount(
            status?.activeEmitterCount
        ),
        pendingPulseCount: normalizeDiagnosticCount(status?.pendingPulseCount),
        pendingBatchCount: normalizeDiagnosticCount(status?.pendingBatchCount),
        pendingStaleCompletionCount: normalizeDiagnosticCount(
            status?.pendingStaleCompletionCount
        ),
        lastCompletedSourceTick: normalizeDiagnosticCount(
            status?.lastCompletedSourceTick
        ),
        recoveryRequired: status?.recoveryRequired === true,
        terminalFinalFixedTick: normalizeDiagnosticCount(
            status?.terminal?.finalFixedTick
        ),
        terminalFixedCommitObserved:
            status?.terminal?.fixedCommitObserved === true,
        terminalLifecycleObserved: status?.terminal?.lifecycleObserved === true,
        terminalRosterSealed: status?.terminal?.rosterSealed === true
    });
}

function createFormationDiagnosticStatus(status) {
    return Object.freeze({
        available: status !== null && status !== undefined,
        activeGroupCount: normalizeDiagnosticCount(status?.activeGroupCount),
        activeHiveCount: normalizeDiagnosticCount(status?.activeHiveCount),
        totalOriginalMemberCount: normalizeDiagnosticCount(
            status?.totalOriginalMemberCount
        ),
        pendingTransformBatchCount: normalizeDiagnosticCount(
            status?.pendingTransformBatchCount
        ),
        hiveHealthBarPolicy: status?.hiveHealthBarPolicy ?? null,
        recoveryRequired: status?.recoveryRequired === true
    });
}

/**
 * @class GameSystem
 * @description 한 인게임 세션의 현재 최소 구현을 소유하고 입력·오브젝트 실행 순서를 조정합니다.
 */
export class GameSystem {
    /**
     * @param {object} dependencies - 엔진 adapter로부터 주입된 의존성입니다.
     * @param {{isPressed:(actionId:string)=>boolean,getPointerPosition:(out:{x:number,y:number})=>{x:number,y:number},isPrimaryPointerPressed:()=>boolean,getWheelTotals:(out:object)=>object}} dependencies.inputActionSource - 의미 입력 소스입니다.
     * @param {{animate:(owner:object,properties:{animationCategory:string})=>object}} dependencies.animationPort - 카테고리 포함 속성을 받는 표현 애니메이션 포트입니다.
     * @param {{getDelta?:()=>number,getFixedDelta:()=>number,getFixedInterpolationAlpha:()=>number}} dependencies.timePort - 시간 포트입니다.
     * @param {{getSnapshot:(out?:object)=>object}} dependencies.viewportPort - 표시 뷰포트 포트입니다.
     * @param {{update?:(status:object,viewport:object,frameDelta:number)=>boolean,draw?:(status:object,viewport:object)=>boolean,drainCommands?:()=>object[],destroy?:()=>void,createSession?:(options:object)=>object}} [dependencies.gameplayStatusRenderPort] - read-only gameplay status 표현 포트 또는 session factory입니다.
     * @param {{drawCircle:(options:object)=>void,drawSquareInstances:(options:object)=>void}} dependencies.worldRenderPort - 월드 렌더 포트입니다.
     * @param {{mapId?:string|null,tileNavigationSource?:object|null,enemyWaveEnabled?:boolean,gameplayWorldActorsEnabled?:boolean,waveDefinition?:object,enemyPresentationProfile?:string,initialCameraZoom?:number,towerMaxHp?:number,coreMaxIntegrity?:number,initialGold?:number,wordSystemOptions?:object,r8ShopOptions?:object,productionRunIdentity?:object,r9WaveRunPlan?:object,r9WaveResolutionProfile?:object}} [options={}] - 세션 시작 옵션입니다.
     */
    constructor(dependencies, options = {}) {
        if (!dependencies?.inputActionSource
            || typeof dependencies.inputActionSource.isPressed !== 'function'
            || typeof dependencies.inputActionSource.getPointerPosition !== 'function'
            || typeof dependencies.inputActionSource.isPrimaryPointerPressed !== 'function'
            || typeof dependencies.inputActionSource.getWheelTotals !== 'function'
            || typeof dependencies?.animationPort?.animate !== 'function'
            || typeof dependencies?.timePort?.getFixedDelta !== 'function'
            || typeof dependencies?.timePort?.getFixedInterpolationAlpha !== 'function'
            || typeof dependencies?.viewportPort?.getSnapshot !== 'function'
            || typeof dependencies?.worldRenderPort?.drawCircle !== 'function'
            || typeof dependencies?.worldRenderPort?.drawSquareInstances !== 'function') {
            throw new TypeError('GameSystem 필수 dependency port가 누락되었습니다.');
        }

        this.dependencies = dependencies;
        const gameplayStatusRenderPort = dependencies.gameplayStatusRenderPort;
        this.gameplayStatusRendererOwned = (
            typeof gameplayStatusRenderPort?.createSession === 'function'
        );
        this.gameplayStatusRenderer = (
            this.gameplayStatusRendererOwned
            ? gameplayStatusRenderPort.createSession({
                inputSource: dependencies.inputActionSource,
                animationPort: dependencies.animationPort,
                settingsSource: dependencies.uiSettingsSource
            })
            : gameplayStatusRenderPort ?? null
        );
        this.inputActionMapper = new InputActionMapper();
        this.playerControlRouter = new PlayerControlRouter();
        this.wordSystem = new WordSystem(options.wordSystemOptions);
        this.sentenceSlotController = new SentenceSlotController(this.wordSystem);
        this.shopRuntimeConfiguration = normalizeShopRuntimeConfiguration(
            options.r8ShopOptions
        );
        this.productionRunIdentity = options.productionRunIdentity ?? null;
        if (this.productionRunIdentity !== null
            && (this.shopRuntimeConfiguration.mode
                    !== SHOP_RUNTIME_CONFIGURATION_MODE.PRODUCTION
                || this.productionRunIdentity.runSessionId
                    !== this.shopRuntimeConfiguration.runSessionId
                || this.productionRunIdentity.runSeed
                    !== this.shopRuntimeConfiguration.runSeed
                || this.productionRunIdentity.unlockedPoolFingerprint
                    !== this.shopRuntimeConfiguration
                        .unlockedPoolFingerprint)) {
            throw new RangeError(
                'ProductionRunIdentity와 production Shop config가 다릅니다.'
            );
        }
        this.runCommerceState = new RunCommerceState({
            runSessionId: this.shopRuntimeConfiguration.runSessionId
                ?? 'run.shop.disabled',
            initialGold: options.initialGold ?? 0
        });
        this.wordInventory = this.runCommerceState.inventory;
        // Existing bounty/GameObjectSystem port 이름을 append-only alias로 유지합니다.
        this.goldLedger = this.runCommerceState;
        this.sentenceBoard = new SentenceBoardState({
            inventory: this.wordInventory,
            wordSystem: this.wordSystem,
            initialLoadout:
                this.shopRuntimeConfiguration.initialLoadout ?? undefined
        });
        this.wordShopSession = new WordShopSession({
            commerceState: this.runCommerceState,
            runtimeMode: this.shopRuntimeConfiguration.mode,
            runSeed: this.shopRuntimeConfiguration.runSeed,
            unlockedWordDefinitionIds:
                this.shopRuntimeConfiguration.unlockedWordDefinitionIds,
            unlockedPoolFingerprint:
                this.shopRuntimeConfiguration.unlockedPoolFingerprint,
            allowEconomicallyRedundantOffers:
                this.shopRuntimeConfiguration
                    .allowEconomicallyRedundantOffers
        });
        this.shopPhaseCoordinator = new ShopPhaseCoordinator({
            wordSystem: this.wordSystem,
            shopSession: this.wordShopSession,
            sentenceBoard: this.sentenceBoard,
            commerceState: this.runCommerceState,
            safeBoundaryPort: Object.freeze({
                getSnapshot: () => this.#createShopSafeBoundarySnapshot()
            }),
            presentationPort: Object.freeze({
                synchronize: () => this.synchronizePresentation()
            }),
            shopRuntimeMode: this.shopRuntimeConfiguration.mode,
            shopConfigured: this.shopRuntimeConfiguration.configured
        });
        this.shopUiCommandExecutor = new ShopUiCommandExecutor({
            shopSession: this.wordShopSession,
            sentenceBoard: this.sentenceBoard,
            phaseCoordinator: this.shopPhaseCoordinator
        });
        this.r8QaAutoOpen = this.shopRuntimeConfiguration.mode
            === SHOP_RUNTIME_CONFIGURATION_MODE.QA
            && this.shopRuntimeConfiguration.autoOpen === true;
        this.r8QaOpenSourceId = this.shopRuntimeConfiguration.sourceId
            ?? 'launcher.--r8-qa';
        this.coreIntegrity = new CoreIntegrity({
            maxIntegrity: options.coreMaxIntegrity
                ?? THE_CORE_DATA.MAX_INTEGRITY
        });
        this.runOutcome = new RunOutcome();
        this.r9WaveRunPlan = options.r9WaveRunPlan ?? null;
        this.r9Configured = this.r9WaveRunPlan !== null;
        this.r9PlanFingerprint = this.r9Configured
            ? getWaveRunPlanFingerprint(this.r9WaveRunPlan)
            : 0;
        const firstWaveMetadata = this.r9Configured
            ? getWaveRunPlanWaveMetadata(this.r9WaveRunPlan, 1)
            : null;
        this.r9WaveResolutionProfile = this.r9Configured
            ? options.r9WaveResolutionProfile
                ?? firstWaveMetadata.resolutionProfile
            : null;
        if (this.r9Configured
            && this.r9WaveResolutionProfile?.profileId
                !== this.r9WaveRunPlan.waves[0].resolutionProfileId) {
            throw new RangeError(
                'R9 initial WaveResolutionProfile이 plan과 다릅니다.'
            );
        }
        this.r9RunSessionId = this.r9Configured
            ? options.r9RunSessionId
                ?? this.shopRuntimeConfiguration.runSessionId
            : null;
        if (this.r9Configured
            && (typeof this.r9RunSessionId !== 'string'
                || this.r9RunSessionId.trim().length === 0)) {
            throw new TypeError('R9 runSessionId가 필요합니다.');
        }
        if (this.r9Configured
            && options.mapId !== undefined
            && options.mapId !== this.r9WaveRunPlan.mapId) {
            throw new RangeError('R9 plan의 map identity가 시작 옵션과 다릅니다.');
        }
        if (this.r9Configured
            && options.waveDefinition !== undefined
            && options.waveDefinition
                !== this.r9WaveRunPlan.waves[0].waveDefinition) {
            throw new RangeError('R9 plan의 Wave identity가 시작 옵션과 다릅니다.');
        }
        this.waveRunCoordinator = this.r9Configured
            ? new WaveRunCoordinator({
                plan: this.r9WaveRunPlan,
                runSessionId: this.r9RunSessionId
            })
            : null;
        this.coreOvertimePressureDirector = this.r9Configured
            ? new CoreOvertimePressureDirector({
                coreIntegrity: this.coreIntegrity,
                runOutcome: this.runOutcome,
                waveRunCoordinator: this.waveRunCoordinator
            })
            : null;
        this.r9WarmExposureApproved
            = options.r9WarmExposureApproved === true;
        this.waveSettlementCoordinator = this.r9Configured
            ? new WaveSettlementCoordinator({
                waveRunCoordinator: this.waveRunCoordinator,
                commerceState: this.runCommerceState,
                shopPhaseCoordinator: this.shopPhaseCoordinator,
                coreIntegrity: this.coreIntegrity,
                runOutcome: this.runOutcome,
                overtimePressureDirector:
                    this.coreOvertimePressureDirector,
                warmExposureGate: Object.freeze({
                    isApproved: () => this.r9WarmExposureApproved
                }),
                qaRuntimeAuthorized:
                    options.r9QaRuntimeAuthorized === true
            })
            : null;
        this.initialCameraZoom = options.initialCameraZoom;
        this.towerMaxHp = options.towerMaxHp;
        this.objectSystemOptions = Object.freeze({
            mapId: options.mapId,
            tileNavigationSource: options.tileNavigationSource,
            coreIntegrity: this.coreIntegrity,
            runOutcome: this.runOutcome,
            enemyWaveEnabled: options.enemyWaveEnabled,
            gameplayWorldActorsEnabled: options.gameplayWorldActorsEnabled,
            waveDefinition: this.r9Configured
                ? this.r9WaveRunPlan.waves[0].waveDefinition
                : options.waveDefinition,
            waveOrdinal: this.r9Configured ? 1 : undefined,
            enemyPresentationProfile: options.enemyPresentationProfile,
            wordSystem: this.wordSystem,
            goldLedger: this.goldLedger
        });
        this.objectSystem = null;
        this.towerGroupState = null;
        this.towerCombatRoster = null;
        this.sessionMode = null;
        this.cameraZoomController = null;
        this.registrationTokens = [];
        this.viewportSnapshot = {
            ww: 0,
            wh: 0,
            uiww: 0,
            uiOffsetX: 0,
            uiScale: 1
        };
        this.frameGameplayStatusSnapshot = null;
        this.fixedTick = 0;
        this.fixedStepBatchBoundaryRevision = 0;
        this.shopPointerReleaseRequired = false;
        this.shopMovementReleaseRequired = false;
        this.r9RuntimeActive = false;
        this.r9PendingShopCloseReceipt = null;
        this.r9ProgressionFailure = null;
        this.r9LastClockReceipt = null;
        this.r9LastSettlementReceipt = null;
        this.r9LastContinueReceipt = null;
        this.r9RecoveryRestartCount = 0;
        this.r9LastRecoveryContinuityReceipt = null;
        this.entered = false;
        this.destroyed = false;
    }

    /**
     * 월드를 생성하고 오브젝트의 IPlayerControllable 컴포넌트를 라우터에 등록합니다.
     * @returns {boolean} 최초 진입을 수행했는지 여부입니다.
     */
    enter() {
        if (this.entered || this.destroyed) {
            return false;
        }
        const sessionMode = selectGameWorldSessionMode(
            this.dependencies.webGpuPlatformPort
        );
        Object.defineProperty(this, 'sessionMode', {
            value: sessionMode,
            writable: false,
            configurable: false,
            enumerable: true
        });
        this.towerGroupState = sessionMode === GAME_WORLD_SESSION_MODE.GPU_WORLD
            ? new TowerGroupState(
                this.towerMaxHp === undefined
                    ? undefined
                    : { maxHp: this.towerMaxHp }
            )
            : null;
        this.towerCombatRoster = this.towerGroupState
            ? new TowerCombatRoster({
                towerGroupState: this.towerGroupState
            })
            : null;
        this.objectSystem = new GameObjectSystem(this.dependencies, {
            ...this.objectSystemOptions,
            sessionMode,
            towerCombatRoster: this.towerCombatRoster,
            waveQuiescenceEvaluator: this.r9Configured
                && sessionMode === GAME_WORLD_SESSION_MODE.GPU_WORLD
                ? this.waveRunCoordinator
                : null,
            coreOvertimePressureDirector: this.r9Configured
                && sessionMode === GAME_WORLD_SESSION_MODE.GPU_WORLD
                ? this.coreOvertimePressureDirector
                : null
        });
        this.#syncViewportSnapshot();
        this.objectSystem.init(this.viewportSnapshot);
        if (this.initialCameraZoom !== undefined) {
            this.objectSystem.getWorldViewProjection().zoom
                = this.initialCameraZoom;
        }
        this.cameraZoomController = new CameraZoomController(
            this.objectSystem.getWorldViewProjection(),
            this.dependencies.animationPort,
            this.objectSystem.getCameraFollowTarget()
        );

        const controllables = this.objectSystem.getPlayerControllables();
        this.registrationTokens.push(
            this.playerControlRouter.register(this.sentenceSlotController)
        );
        for (let index = 0; index < controllables.length; index++) {
            this.registrationTokens.push(this.playerControlRouter.register(controllables[index]));
        }
        this.registrationTokens.push(
            this.playerControlRouter.register(this.cameraZoomController)
        );
        this.inputActionMapper.primeWheelBaseline(
            this.dependencies.inputActionSource
        );
        this.r9RuntimeActive = this.r9Configured
            && sessionMode === GAME_WORLD_SESSION_MODE.GPU_WORLD;
        if (this.r9RuntimeActive) this.#startR9Run();
        this.entered = true;
        if (this.r8QaAutoOpen && !this.r9RuntimeActive) {
            this.requestShopOpen({
                sourceKind: SHOP_OPEN_SOURCE_KIND.QA_EXPLICIT,
                sourceId: this.r8QaOpenSourceId,
                settlementOrdinal: 1,
                transactionId: 'shop-open.r8.qa:1',
                minimumFixedTick: this.fixedTick + 1
            });
        }
        return true;
    }

    /**
     * 같은 fixed input snapshot에서 이동·primary pointer 의미 입력을 순서대로 전달한 뒤
     * 오브젝트 fixed-step을 실행합니다.
     * @returns {boolean} GPU 적과 플레이어가 같은 fixed tick을 완료했는지 여부입니다.
     */
    fixedUpdate() {
        if (!this.entered || this.destroyed) {
            return false;
        }
        if (this.r9ProgressionFailure !== null
            || this.#isR9MapClearReady()) {
            return FIXED_STEP_RESULT.INTENTIONAL_PAUSE;
        }
        let suppressGameplayInput = false;
        const shopPhase = this.shopPhaseCoordinator.getPhase();
        if (this.r9RuntimeActive
            && this.r9PendingShopCloseReceipt !== null
            && shopPhase === SHOP_RUNTIME_PHASE.COMBAT) {
            if (this.#progressR9ClosedShopBoundary()) {
                return FIXED_STEP_RESULT.COMPLETED;
            }
            if (this.isGpuWorldRecoveryRequired()) {
                return FIXED_STEP_RESULT.DEFERRED_BACKPRESSURE;
            }
            return this.#needsR9PausedTechnicalBoundary()
                ? this.#advanceR9PausedTechnicalBoundary()
                : FIXED_STEP_RESULT.DEFERRED_BACKPRESSURE;
        }
        if (shopPhase === SHOP_RUNTIME_PHASE.SHOP) {
            if (this.r9RuntimeActive
                && this.isGpuWorldRecoveryRequired()) {
                return FIXED_STEP_RESULT.DEFERRED_BACKPRESSURE;
            }
            if (this.r9RuntimeActive
                && this.#needsR9PausedTechnicalBoundary()) {
                return this.#advanceR9PausedTechnicalBoundary();
            }
            return FIXED_STEP_RESULT.INTENTIONAL_PAUSE;
        }
        if (shopPhase === SHOP_RUNTIME_PHASE.SHOP_CLOSING) {
            const closeReceipt = this.shopPhaseCoordinator.progressClosing();
            if (this.shopPhaseCoordinator.getPhase() !== shopPhase) {
                this.fixedStepBatchBoundaryRevision++;
                if (this.r9RuntimeActive
                    && closeReceipt.accepted === true
                    && closeReceipt.code === SHOP_PHASE_RESULT_CODE.CLOSED) {
                    this.r9PendingShopCloseReceipt
                        = this.#captureR9PendingShopClose(closeReceipt);
                    return this.#progressR9ClosedShopBoundary()
                        ? FIXED_STEP_RESULT.COMPLETED
                        : FIXED_STEP_RESULT.DEFERRED_BACKPRESSURE;
                }
                return FIXED_STEP_RESULT.COMPLETED;
            }
            return FIXED_STEP_RESULT.DEFERRED_BACKPRESSURE;
        } else if (shopPhase === SHOP_RUNTIME_PHASE.SHOP_OPENING) {
            this.shopPhaseCoordinator.progressOpening();
            if (this.shopPhaseCoordinator.getPhase() !== shopPhase) {
                if (this.r9RuntimeActive) {
                    const settlementReceipt = this.waveSettlementCoordinator
                        .observeShopOpening();
                    this.r9LastSettlementReceipt = settlementReceipt;
                    if (settlementReceipt.accepted !== true
                        || settlementReceipt.code
                            !== WAVE_SETTLEMENT_RESULT_CODE.OPENED) {
                        this.#recordR9ProgressionFailure(
                            'shop-open-observation',
                            settlementReceipt
                        );
                    }
                }
                this.fixedStepBatchBoundaryRevision++;
                return FIXED_STEP_RESULT.COMPLETED;
            }
            suppressGameplayInput = this.shopPhaseCoordinator.getPhase()
                === SHOP_RUNTIME_PHASE.SHOP_OPENING;
        }
        const proposedFixedTick = this.fixedTick + 1;
        // Terminal run은 input semantics를 새 gameplay request로 materialize하지 않습니다.
        // GameObjectSystem은 마지막 cleanup submit 또는 sealed no-op만 수행합니다.
        // 이미 defeat가 확정된 호출은 성공 no-op이어도 session fixed tick을 전진시키지
        // 않아 finalization boundary의 authoritative snapshot을 보존합니다.
        if (this.runOutcome.isDefeated()) {
            return this.objectSystem.fixedUpdate(
                this.dependencies.timePort.getFixedDelta(),
                proposedFixedTick
            );
        }
        this.wordSystem.beginFixedTick(proposedFixedTick);
        if (!suppressGameplayInput) {
            const moveAction = this.inputActionMapper.mapMoveAction(
                this.dependencies.inputActionSource
            );
            if (this.shopMovementReleaseRequired) {
                if (moveAction.payload.x === 0 && moveAction.payload.y === 0) {
                    this.shopMovementReleaseRequired = false;
                } else {
                    moveAction.payload.x = 0;
                    moveAction.payload.y = 0;
                }
            }
            const primaryPointerFireAction = this.inputActionMapper
                .mapPrimaryPointerFireAction(
                    this.dependencies.inputActionSource
                );
            if (this.shopPointerReleaseRequired) {
                if (primaryPointerFireAction.payload.pressed !== true) {
                    this.shopPointerReleaseRequired = false;
                }
                primaryPointerFireAction.payload.pressed = false;
            }
            this.playerControlRouter.dispatch(moveAction);
            this.playerControlRouter.dispatch(primaryPointerFireAction);
            const skillEdgeActions = this.inputActionMapper.mapSkillEdgeActions(
                this.dependencies.inputActionSource
            );
            for (let index = 0; index < skillEdgeActions.length; index++) {
                this.playerControlRouter.dispatch(skillEdgeActions[index]);
            }
        } else {
            this.#synchronizeSuppressedShopInput();
        }
        const advanced = this.objectSystem.fixedUpdate(
            this.dependencies.timePort.getFixedDelta(),
            proposedFixedTick
        );
        if (advanced) {
            this.fixedTick = proposedFixedTick;
            if (this.r9RuntimeActive) {
                this.#observeR9CompletedGameplayBoundary(
                    proposedFixedTick
                );
            }
        }
        return advanced;
    }

    /**
     * 현재 보간 계수로 표현 좌표만 갱신합니다.
     * @returns {void}
     */
    update() {
        if (!this.entered || this.destroyed) {
            return;
        }
        const shopPhase = this.shopPhaseCoordinator.getPhase();
        const r9Paused = this.r9ProgressionFailure !== null
            || this.#isR9MapClearReady()
            || this.r9PendingShopCloseReceipt !== null;
        if (shopPhase === SHOP_RUNTIME_PHASE.COMBAT && !r9Paused) {
            const cameraZoomAction = this.inputActionMapper.mapCameraZoomAction(
                this.dependencies.inputActionSource
            );
            if (cameraZoomAction) {
                this.playerControlRouter.dispatch(cameraZoomAction);
            }
        } else {
            this.#synchronizeSuppressedShopInput();
        }
        const frameDelta = typeof this.dependencies.timePort.getDelta === 'function'
            ? this.dependencies.timePort.getDelta()
            : 0;
        const worldPresentationPaused = shopPhase === SHOP_RUNTIME_PHASE.SHOP
            || r9Paused;
        this.objectSystem.update(
            worldPresentationPaused
                ? 1
                : this.dependencies.timePort.getFixedInterpolationAlpha(),
            worldPresentationPaused ? 0 : frameDelta,
            this.dependencies.timePort.getFixedDelta()
        );
        this.cameraZoomController.updateFollowTarget();
        const statusRenderer = this.gameplayStatusRenderer;
        if (statusRenderer) {
            const gameplayStatus = this.getGameplayStatus();
            this.frameGameplayStatusSnapshot = gameplayStatus;
            statusRenderer.update?.(
                gameplayStatus,
                this.viewportSnapshot,
                frameDelta
            );
            const shopUiCommands = statusRenderer.drainCommands?.() ?? [];
            this.handleShopUiCommands(shopUiCommands);
            if (shopUiCommands.length > 0) {
                this.frameGameplayStatusSnapshot = null;
            }
        } else {
            this.frameGameplayStatusSnapshot = null;
        }
    }

    /**
     * 월드 렌더 명령을 제출합니다.
     * @returns {void}
     */
    draw() {
        if (!this.entered || this.destroyed) {
            return;
        }
        this.objectSystem.draw();
        const statusRenderer = this.gameplayStatusRenderer;
        if (statusRenderer) {
            const gameplayStatus = this.frameGameplayStatusSnapshot
                ?? this.getGameplayStatus();
            this.frameGameplayStatusSnapshot = null;
            statusRenderer.draw?.(gameplayStatus, this.viewportSnapshot);
        } else {
            this.frameGameplayStatusSnapshot = null;
        }
    }

    /**
     * map·Core·Tower 합성 없이 GPU 적 layer만 오브젝트 소유자에게 위임합니다.
     * @returns {boolean} GPU draw 제출 여부입니다.
     */
    drawEnemySimulation() {
        if (!this.entered || this.destroyed) {
            return false;
        }
        return this.objectSystem.drawEnemySimulation();
    }

    /**
     * 현재 월드를 초기화하지 않고 뷰포트 경계만 동기화합니다.
     * @returns {void}
     */
    resize() {
        if (!this.entered || this.destroyed) {
            return;
        }
        this.#syncViewportSnapshot();
        this.objectSystem.resize(this.viewportSnapshot);
    }

    /**
     * 현재 단계에서 아직 지원하지 않는 외부 시뮬레이션 command를 안전하게 무시합니다.
     * @param {object[]} [commands=[]] - 전달된 command 목록입니다.
     * @returns {object[]} 현재는 항상 빈 처리 결과입니다.
     */
    handleCommands(commands = []) {
        void commands;
        return [];
    }

    /** Shop overlay semantic command를 CPU run-domain authority에서 실행합니다. */
    handleShopUiCommands(commands = []) {
        if (!this.entered || this.destroyed || !this.shopUiCommandExecutor) {
            return Object.freeze([]);
        }
        return this.shopUiCommandExecutor.executeAll(commands);
    }

    /**
     * 테스트·디버그용으로 현재 오브젝트 시스템 참조를 반환합니다.
     * @returns {GameObjectSystem} 세션 오브젝트 시스템입니다.
     */
    getObjectSystem() {
        return this.objectSystem;
    }

    /** @returns {string|null} enter에서 고정한 world authority mode입니다. */
    getSessionMode() {
        return this.sessionMode;
    }

    /**
     * gameplay adapter가 mixed-body GPU lifecycle request와 상태를 연결할 공개 endpoint입니다.
     * commit/tick/presentation/draw는 이 GameSystem의 실행 경로가 소유합니다.
     * @returns {import('./object/enemy/gpu_enemy_simulation_endpoint.js').GpuSimulationEndpoint}
     */
    getGpuSimulationEndpoint() {
        return this.objectSystem.getGpuSimulationEndpoint();
    }

    /** @returns {import('./object/enemy/gpu_enemy_simulation_endpoint.js').GpuSimulationEndpoint} 기존 enemy API 호환 alias입니다. */
    getEnemySimulationEndpoint() {
        return this.getGpuSimulationEndpoint();
    }

    /**
     * 세션 생존 자원인 ICoreIntegrity를 반환합니다.
     * @returns {CoreIntegrity} Core Integrity component입니다.
     */
    getCoreIntegrity() {
        return this.coreIntegrity;
    }

    /** @returns {RunOutcome} GameSystem CPU run-domain의 단방향 outcome component입니다. */
    getRunOutcome() {
        return this.runOutcome;
    }

    /** CPU run-domain의 typed Word/Sentence owner입니다. */
    getWordSystem() {
        return this.wordSystem;
    }

    /** 테스트·개발 loadout이 사용하는 5개 immutable runtime slot view입니다. */
    getAbilitySlotViews() {
        return this.wordSystem?.getSlotViews() ?? Object.freeze([]);
    }

    /** 입력 edge와 PRIMARY compatibility를 검증할 bounded controller status입니다. */
    getSentenceSlotController() {
        return this.sentenceSlotController;
    }

    /**
     * HUD·테스트가 읽을 수 있는 불변 GPU Tower combat snapshot입니다.
     * CPU fallback의 Tower HP 정책은 아직 OPEN이므로 해당 mode에서는 null입니다.
     * @returns {object|null} GPU_WORLD의 bounded Tower combat status입니다.
     */
    getTowerCombatStatus() {
        return this.towerCombatRoster?.getStatus() ?? null;
    }

    /** CPU run-domain이 소유하는 canonical TowerGroupState입니다. */
    getTowerGroupState() {
        return this.towerGroupState;
    }

    /** Sentence/cooldown을 우회하지 않고 별도 technical API로만 Tower를 생성합니다. */
    requestTowerCreation(request) {
        if (!this.entered || this.destroyed || this.runOutcome.isDefeated()) {
            return Object.freeze({
                accepted: false,
                result: 'REJECTED_SOURCE_CHANGED',
                reason: 'GAME_SESSION_NOT_RUNNING',
                recoveryRequired: false,
                createdCount: 0,
                handles: Object.freeze([])
            });
        }
        return this.objectSystem.requestTowerCreation(request);
    }

    getTowerCreationStatus() {
        return this.objectSystem?.getTowerCreationStatus?.() ?? null;
    }

    /** GPU_WORLD의 lifecycle 기반 hostile attack producer 상태입니다. */
    getHostileAttackStatus() {
        return this.objectSystem?.getHostileAttackStatus() ?? null;
    }

    /** GPU_WORLD Pentagon Effect capability의 bounded scalar 상태입니다. */
    getPentagonEffectStatus() {
        return this.objectSystem?.getPentagonEffectStatus() ?? null;
    }

    /** GPU_WORLD H/HX Formation capability의 bounded scalar 상태입니다. */
    getFormationRuntimeStatus() {
        return this.objectSystem?.getFormationRuntimeStatus() ?? null;
    }

    getAbilityRuntimeStatus() {
        return this.objectSystem?.getAbilityRuntimeStatus() ?? null;
    }

    getActorPayloadMaterializerStatus() {
        return this.objectSystem?.getActorPayloadMaterializerStatus() ?? null;
    }

    getTowerMergeStatus() {
        return this.objectSystem?.getTowerMergeStatus?.() ?? null;
    }

    getGpuRecoveryStatus() {
        return this.objectSystem?.getGpuRecoveryStatus?.() ?? null;
    }

    /** CPU run-domain Gold+Inventory authority입니다. */
    getRunCommerceState() {
        return this.runCommerceState;
    }

    getWordInventory() {
        return this.wordInventory;
    }

    getSentenceBoard() {
        return this.sentenceBoard;
    }

    getWordShopSession() {
        return this.wordShopSession;
    }

    getShopPhaseCoordinator() {
        return this.shopPhaseCoordinator;
    }

    /** 현재 세션의 immutable Shop runtime identity/configuration입니다. */
    getShopRuntimeConfiguration() {
        return this.shopRuntimeConfiguration;
    }

    getShopPhaseStatus() {
        return this.shopPhaseCoordinator?.getStatus() ?? null;
    }

    getShopUiCommandStatus() {
        return this.shopUiCommandExecutor?.getStatus() ?? null;
    }

    getWaveRunStatus() {
        return this.waveRunCoordinator?.getStatus() ?? null;
    }

    getWaveSettlementStatus() {
        return this.waveSettlementCoordinator?.getStatus() ?? null;
    }

    getNextWaveProgressionStatus() {
        return Object.freeze({
            configured: this.r9Configured,
            active: this.r9RuntimeActive,
            pendingShopClose:
                this.r9PendingShopCloseReceipt !== null,
            failure: this.r9ProgressionFailure,
            objectSystem:
                this.objectSystem?.getNextWaveProgressionStatus?.() ?? null,
            mapClearReady: this.#isR9MapClearReady(),
            recovery: Object.freeze({
                restartCount: this.r9RecoveryRestartCount,
                automaticRestartCount: 0,
                lastReceipt: this.r9LastRecoveryContinuityReceipt,
                restartStormDetected: false,
                transientRearmLimitation:
                    R9_CURRENT_WAVE_TRANSIENT_REARM_LIMITATION
            })
        });
    }

    /** Ordinary production route가 주입한 immutable run identity입니다. */
    getProductionRunIdentity() {
        return this.productionRunIdentity;
    }

    /** 현재 plan의 첫 Wave에 명시적으로 주입된 production/QA profile입니다. */
    getR9WaveResolutionProfile() {
        return this.r9WaveResolutionProfile;
    }

    /** HUD/Shop이 읽는 bounded R9 aggregate이며 per-enemy object를 포함하지 않습니다. */
    getWaveFlowStatus() {
        return this.#createR9WaveFlowStatus();
    }

    requestShopOpen(source) {
        return this.shopPhaseCoordinator.requestOpen(source);
    }

    requestShopContinue(source) {
        return this.shopPhaseCoordinator.requestContinue(source);
    }

    getGoldLedger() {
        return this.goldLedger;
    }

    getGold() {
        return this.goldLedger?.getBalance() ?? 0;
    }

    getGoldStatus() {
        return this.runCommerceState?.getGoldStatus() ?? null;
    }

    getBountyRewardStatus() {
        return this.objectSystem?.getBountyRewardStatus() ?? null;
    }

    getHostileParticipationStatus() {
        return this.objectSystem?.getHostileParticipationStatus() ?? null;
    }

    /**
     * HUD·manual QA가 raw GPU readback 없이 읽는 bounded scalar snapshot입니다.
     * Tower는 committed roster mirror, Core는 run-domain CoreIntegrity가 authority입니다.
     * @returns {Readonly<object>} 중첩 값까지 동결된 gameplay status입니다.
     */
    getGameplayStatus() {
        const hostileAttackStatus = this.getHostileAttackStatus();
        const towerStatus = createTowerDiagnosticStatus(
            this.getTowerCombatStatus()
        );
        const wordStatus = this.wordSystem?.getStatusView() ?? null;
        return Object.freeze({
            fixedTick: this.fixedTick,
            sessionMode: this.sessionMode,
            recoveryRequired: this.isGpuWorldRecoveryRequired(),
            tower: towerStatus,
            towerCreation: this.getTowerCreationStatus(),
            core: createCoreDiagnosticStatus(this.coreIntegrity),
            outcome: createRunOutcomeDiagnosticStatus(this.runOutcome),
            terminal: this.objectSystem?.getTerminalStatus?.() ?? null,
            hostileAttack: createHostileAttackDiagnosticStatus(
                hostileAttackStatus
            ),
            pentagonEffect: createPentagonEffectDiagnosticStatus(
                this.getPentagonEffectStatus()
            ),
            formation: createFormationDiagnosticStatus(
                this.getFormationRuntimeStatus()
            ),
            abilities: this.getAbilityRuntimeStatus(),
            actorPayloads: this.getActorPayloadMaterializerStatus(),
            gold: this.getGold(),
            commerce: this.runCommerceState?.getStatus() ?? null,
            inventory: this.wordInventory?.getStatus() ?? null,
            sentenceBoard: this.sentenceBoard?.getStatus() ?? null,
            shop: this.wordShopSession?.getStatus() ?? null,
            shopPhase: this.getShopPhaseStatus(),
            shopUi: this.getShopUiCommandStatus(),
            waveRun: this.waveRunCoordinator?.getSettlementView?.() ?? null,
            waveFlow: this.getWaveFlowStatus(),
            waveProgression: this.getNextWaveProgressionStatus(),
            bounty: this.getBountyRewardStatus(),
            hostiles: this.getHostileParticipationStatus(),
            words: wordStatus,
            modifiers: createModifierDiagnosticStatus(
                wordStatus,
                towerStatus
            ),
            wave: createWaveDiagnosticStatus(
                this.objectSystem?.getEnemyWaveStatus?.() ?? null
            )
        });
    }

    /** @returns {number} 세션 전체가 완료한 fixed tick입니다. */
    getFixedTick() {
        return this.fixedTick;
    }

    /** fixed pipeline 진입 전 SHOP intentional pause를 게시합니다. */
    getFixedStepDisposition() {
        const shopPhase = this.shopPhaseCoordinator?.getPhase();
        if (this.r9RuntimeActive
            && shopPhase === SHOP_RUNTIME_PHASE.SHOP
            && (this.isGpuWorldRecoveryRequired()
                || this.#needsR9PausedTechnicalBoundary())) {
            return FIXED_STEP_RESULT.COMPLETED;
        }
        return this.r9ProgressionFailure !== null
            || this.#isR9MapClearReady()
            || shopPhase === SHOP_RUNTIME_PHASE.SHOP
            ? FIXED_STEP_RESULT.INTENTIONAL_PAUSE
            : FIXED_STEP_RESULT.COMPLETED;
    }

    /** SHOP opening/closing 경계 뒤 같은 frame catch-up을 끊는 단조 revision입니다. */
    getFixedStepBatchBoundaryRevision() {
        return this.fixedStepBatchBoundaryRevision;
    }

    /**
     * gameplay adapter가 새 GPU spawn/despawn을 예약할 수 있는 가장 이른 fixed tick입니다.
     * @returns {number} 현재 열린 다음 GPU lifecycle 경계입니다.
     */
    getNextGpuLifecycleFixedTick() {
        return this.objectSystem.getNextGpuLifecycleFixedTick();
    }

    /** @returns {number} 기존 enemy lifecycle tick API 호환 alias입니다. */
    getNextEnemyLifecycleFixedTick() {
        return this.getNextGpuLifecycleFixedTick();
    }

    /**
     * 테스트·디버그용으로 카메라 의미 입력 제어기를 반환합니다.
     * @returns {CameraZoomController|null} 진입 후 생성된 카메라 zoom 제어기입니다.
     */
    getCameraZoomController() {
        return this.cameraZoomController;
    }

    /** pause/resume 경계에서 GPU 적 표현 clock의 남은 예측 시간을 제거합니다. */
    synchronizePresentation() {
        this.objectSystem.synchronizeEnemyPresentation();
    }

    /** @returns {boolean} 현재 wave를 안전 경계에서 재시작해야 하는 hard GPU failure 여부입니다. */
    isEnemySimulationRecoveryRequired() {
        return this.objectSystem?.isEnemySimulationRecoveryRequired() ?? false;
    }

    /** @returns {boolean} canonical GPU world recovery 상태입니다. */
    isGpuWorldRecoveryRequired() {
        return this.isEnemySimulationRecoveryRequired();
    }

    /** CPU domain을 유지한 채 restartable GPU world만 safe boundary에서 교체합니다. */
    restartGpuWorldAtSafeWaveBoundary() {
        if (!this.entered || this.destroyed || this.runOutcome.isDefeated()) {
            return false;
        }
        const before = this.r9RuntimeActive
            ? this.#captureR9RecoveryContinuitySnapshot()
            : null;
        const restarted = this.objectSystem.restartGpuWorldAtSafeWaveBoundary();
        if (!restarted || before === null) return restarted;
        const after = this.#captureR9RecoveryContinuitySnapshot();
        const audit = auditR9RecoveryContinuity(before, after);
        this.r9RecoveryRestartCount++;
        this.r9LastRecoveryContinuityReceipt = Object.freeze({
            ...audit,
            restartOrdinal: this.r9RecoveryRestartCount
        });
        if (audit.preserved !== true) {
            this.#recordR9ProgressionFailure(
                'gpu-recovery-cpu-continuity',
                audit
            );
        }
        return true;
    }

    /** 기존 enemy 명칭 호환 alias입니다. */
    restartEnemyGpuWorldAtSafeWaveBoundary() {
        return this.restartGpuWorldAtSafeWaveBoundary();
    }

    /**
     * 입력 등록과 세션 오브젝트를 역순으로 정리합니다.
     * 반복 호출해도 안전합니다.
     * @returns {void}
     */
    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        for (let index = this.registrationTokens.length - 1; index >= 0; index--) {
            this.registrationTokens[index].dispose();
        }
        this.registrationTokens.length = 0;
        this.playerControlRouter.destroy();
        this.sentenceSlotController?.destroy();
        this.sentenceSlotController = null;
        if (this.gameplayStatusRendererOwned) {
            this.gameplayStatusRenderer?.destroy?.();
        }
        this.gameplayStatusRenderer = null;
        this.gameplayStatusRendererOwned = false;
        this.cameraZoomController?.destroy();
        this.cameraZoomController = null;
        this.objectSystem?.destroy();
        this.objectSystem = null;
        this.waveSettlementCoordinator?.destroy();
        this.waveSettlementCoordinator = null;
        this.coreOvertimePressureDirector?.destroy();
        this.coreOvertimePressureDirector = null;
        this.waveRunCoordinator?.destroy();
        this.waveRunCoordinator = null;
        this.towerCombatRoster?.destroy();
        this.towerCombatRoster = null;
        this.towerGroupState?.destroy();
        this.towerGroupState = null;
        this.runOutcome.destroy();
        this.shopUiCommandExecutor?.destroy();
        this.shopUiCommandExecutor = null;
        this.shopPhaseCoordinator?.destroy();
        this.shopPhaseCoordinator = null;
        this.wordShopSession?.destroy();
        this.wordShopSession = null;
        this.sentenceBoard?.destroy();
        this.sentenceBoard = null;
        this.runCommerceState?.destroy();
        this.runCommerceState = null;
        this.wordInventory = null;
        this.goldLedger = null;
        this.wordSystem?.destroy();
        this.wordSystem = null;
        this.frameGameplayStatusSnapshot = null;
        this.fixedTick = 0;
        this.shopPointerReleaseRequired = false;
        this.shopMovementReleaseRequired = false;
        this.r9RuntimeActive = false;
        this.r9PendingShopCloseReceipt = null;
        this.r9ProgressionFailure = null;
        this.r9LastClockReceipt = null;
        this.r9LastSettlementReceipt = null;
        this.r9LastContinueReceipt = null;
        this.r9RecoveryRestartCount = 0;
        this.r9LastRecoveryContinuityReceipt = null;
        this.productionRunIdentity = null;
        this.r9WaveResolutionProfile = null;
        this.entered = false;
    }

    /**
     * viewport port의 값을 재사용 snapshot에 기록합니다.
     * @returns {void}
     * @private
     */
    #syncViewportSnapshot() {
        const snapshot = this.dependencies.viewportPort.getSnapshot(this.viewportSnapshot);
        if (snapshot && snapshot !== this.viewportSnapshot) {
            this.viewportSnapshot.ww = snapshot.ww;
            this.viewportSnapshot.wh = snapshot.wh;
            this.viewportSnapshot.uiww = snapshot.uiww;
            this.viewportSnapshot.uiOffsetX = snapshot.uiOffsetX;
            this.viewportSnapshot.uiScale = snapshot.uiScale;
        }
    }

    #createShopSafeBoundarySnapshot() {
        const wordStatus = this.wordSystem?.getStatusView() ?? null;
        const ability = this.getAbilityRuntimeStatus();
        const creation = this.getTowerCreationStatus();
        const merge = this.getTowerMergeStatus();
        const actor = this.getActorPayloadMaterializerStatus();
        const recovery = this.getGpuRecoveryStatus();
        const wave = this.objectSystem?.getEnemyWaveStatus?.() ?? null;
        return Object.freeze({
            fixedTick: this.fixedTick,
            wordActivationCount: wordStatus?.pendingActivationCount ?? 0,
            abilityExecutionCount:
                (ability?.deferredActivationCount ?? 0)
                + (ability?.inFlightCount ?? 0)
                + (ability?.readySnapshotCount ?? 0)
                + (ability?.readyTowerMergeSnapshotCount ?? 0),
            towerCreationPendingCount:
                (creation?.queuedTransaction ? 1 : 0)
                + (creation?.pendingTransaction ? 1 : 0)
                + (creation?.pendingActorPayloadTerminalReceiptCount ?? 0),
            towerMergePendingCount: merge?.pending ? 1 : 0,
            actorMaterializationPendingCount: actor?.inFlightCount ?? 0,
            actorTransitActiveCount:
                actor?.telemetry?.transitActiveCount ?? 0,
            commercePendingCount:
                this.runCommerceState?.getStatus().pendingTransactionCount
                ?? 0,
            endpointPendingFixedTick: recovery?.pendingFixedTick ?? 0,
            wavePendingSpawnCount: wave
                ? (wave.remainingSpawnCount ?? 0)
                    + (wave.blockedSpawnCount ?? 0)
                : 0,
            endpointRecoveryRequired: this.isGpuWorldRecoveryRequired(),
            recoveryProbationState: recovery?.probation?.state ?? null,
            runDefeated: this.runOutcome.isDefeated()
        });
    }

    #createR9WaveFlowStatus() {
        if (!this.r9Configured || !this.waveRunCoordinator) {
            return R9_DISABLED_WAVE_FLOW_STATUS;
        }
        const settlementView = this.waveRunCoordinator.getSettlementView();
        const wave = settlementView;
        const pressureView = this.waveRunCoordinator.getOvertimePressureView();
        const pressure = this.coreOvertimePressureDirector?.getStatus() ?? null;
        const settlement = this.waveSettlementCoordinator?.getStatus() ?? null;
        const hostile = this.getHostileParticipationStatus();
        const hostileActorCount = normalizeDiagnosticCount(
            hostile?.hostileActorCount
        );
        const siegeWeightValue = Number(hostile?.siegeWeight);
        const siegeWeight = Number.isFinite(siegeWeightValue)
                && siegeWeightValue >= 0
            ? siegeWeightValue
            : 0;
        const overtimeActive = wave.state === WAVE_RUN_STATE.OVERTIME;
        const ticksUntilNextPulse = overtimeActive
            && (pressure?.nextPulseFixedTick ?? 0) > 0
            ? Math.max(0, pressure.nextPulseFixedTick - this.fixedTick)
            : 0;
        let projectedNextDamageFixedPoint = 0;
        if (overtimeActive && hostileActorCount > 0
            && pressureView.resolutionProfile?.overtime) {
            try {
                projectedNextDamageFixedPoint
                    = calculateCoreOvertimeDamageFixedPoint(
                        siegeWeight,
                        pressureView.resolutionProfile.overtime
                    );
            } catch {
                projectedNextDamageFixedPoint = 0;
            }
        }
        const settlementReceipt = settlement?.settlementReceipt ?? null;
        const nextProgression = settlementReceipt?.nextProgression
            ?? settlementView.nextProgression;
        const finalWave = nextProgression?.type
            === WAVE_RUN_STATE.MAP_CLEAR_READY;
        const shopPreview = Object.freeze({
            completedWaveOrdinal: settlementReceipt?.waveOrdinal ?? 0,
            completedWaveId: settlementReceipt?.waveId ?? null,
            clearType: settlementReceipt?.clearType
                ?? settlement?.clearType ?? null,
            overtimePulseCount: normalizeDiagnosticCount(
                settlementReceipt?.overtimePulseCount
            ),
            overtimeDamageTotalFixedPoint: normalizeDiagnosticCount(
                settlementReceipt?.overtimeDamageTotalFixedPoint
            ),
            nextWaveId: nextProgression?.type === 'NEXT_WAVE'
                ? nextProgression.waveId
                : null,
            finalWave,
            mapClearReady: wave.state === WAVE_RUN_STATE.MAP_CLEAR_READY
        });
        return Object.freeze({
            configured: true,
            waveOrdinal: wave.waveOrdinal,
            totalWaveCount: wave.waveCount,
            waveId: wave.waveId,
            waveState: wave.state,
            elapsedTicks: wave.elapsedCombatTicks,
            remainingTicks: Math.max(
                0,
                wave.combatDurationTicks - wave.elapsedCombatTicks
            ),
            deadlineReached: wave.deadlineReached === true,
            hostileActorCount,
            siegeWeight,
            overtimeActive,
            overtimePulseOrdinal: normalizeDiagnosticCount(
                pressure?.overtimePulseOrdinal
            ),
            ticksUntilNextPulse,
            projectedNextDamageFixedPoint,
            settlementCode: this.r9LastSettlementReceipt?.code
                ?? settlement?.lastReceipt?.code ?? null,
            resolutionProfileId: wave.resolutionProfileId,
            perEnemyUiObjectCount: 0,
            shopPreview,
            pausePolicy: Object.freeze({
                clockSource: 'COMPLETED_FIXED_TICK_ONLY',
                pauseAdvanceTicks: 0,
                resumeCatchUpTicks: 0
            }),
            recovery: Object.freeze({
                restartCount: this.r9RecoveryRestartCount,
                automaticRestartCount: 0,
                lastCode: this.r9LastRecoveryContinuityReceipt?.code ?? null,
                continuityPreserved:
                    this.r9LastRecoveryContinuityReceipt?.preserved ?? null,
                restartStormDetected: false,
                transientRearmLimitation:
                    R9_CURRENT_WAVE_TRANSIENT_REARM_LIMITATION
            })
        });
    }

    #captureR9RecoveryContinuitySnapshot() {
        const wave = this.waveRunCoordinator.getStatus();
        const pressure = this.coreOvertimePressureDirector.getStatus();
        const settlement = this.waveSettlementCoordinator.getStatus();
        const shopPhase = this.shopPhaseCoordinator.getStatus();
        const shop = this.wordShopSession.getStatus();
        const commerce = this.runCommerceState.getStatus();
        const board = this.sentenceBoard.getStatus();
        const words = this.wordSystem.getStatusView();
        const outcome = this.runOutcome.getStatus();
        return createR9RecoveryContinuitySnapshot({
            fixedTick: this.fixedTick,
            wave: {
                state: wave.state,
                waveOrdinal: wave.currentWaveOrdinal,
                waveId: wave.currentWaveId,
                elapsedCombatTicks: wave.elapsedCombatTicks,
                deadlineReached: wave.deadlineReached,
                overtimeStarted: wave.overtimeStarted,
                completionRevision: wave.completionRevision,
                factRevision: wave.factRevision
            },
            pressure,
            settlement,
            shopPhase,
            shop,
            commerce,
            board,
            words,
            core: {
                currentIntegrity: this.coreIntegrity.getCurrentIntegrity(),
                maxIntegrity: this.coreIntegrity.getMaxIntegrity(),
                runOutcomeState: outcome.state
            },
            progression: {
                pendingShopClose:
                    this.r9PendingShopCloseReceipt !== null,
                pendingNextWaveOrdinal:
                    this.r9PendingShopCloseReceipt?.nextWaveOrdinal ?? 0,
                pendingNextTransactionId:
                    this.r9PendingShopCloseReceipt?.nextTransactionId ?? null
            }
        });
    }

    #startR9Run() {
        const plan = this.r9WaveRunPlan;
        const startReceipt = this.waveRunCoordinator.startPlan({
            transactionId: `r9-run:${this.r9RunSessionId}:start`,
            runSessionId: this.r9RunSessionId,
            planId: plan.planId,
            planFingerprint: this.r9PlanFingerprint
        });
        if (startReceipt.accepted !== true) {
            throw new Error(`R9 plan start 실패: ${startReceipt.code}`);
        }
        const first = plan.waves[0].waveDefinition;
        const beginReceipt = this.waveRunCoordinator.beginWave({
            transactionId: `r9-run:${this.r9RunSessionId}:wave:1:begin`,
            runSessionId: this.r9RunSessionId,
            planId: plan.planId,
            waveOrdinal: 1,
            waveId: first.waveId,
            startingFixedTick: this.fixedTick
        });
        if (beginReceipt.accepted !== true) {
            throw new Error(`R9 Wave 1 begin 실패: ${beginReceipt.code}`);
        }
    }

    #observeR9CompletedGameplayBoundary(completedFixedTick) {
        const status = this.waveRunCoordinator.getStatus();
        if (R9_COMBAT_CLOCK_STATES.has(status.state)) {
            const receipt = this.waveRunCoordinator.observeClockTick({
                transactionId: [
                    'r9-clock',
                    this.r9RunSessionId,
                    status.currentWaveOrdinal,
                    status.elapsedCombatTicks + 1
                ].join(':'),
                runSessionId: this.r9RunSessionId,
                planId: this.r9WaveRunPlan.planId,
                waveOrdinal: status.currentWaveOrdinal,
                waveId: status.currentWaveId,
                proposedElapsedCombatTicks:
                    status.elapsedCombatTicks + 1,
                completedFixedTick,
                completed: true,
                intentionalPause: false
            });
            this.r9LastClockReceipt = receipt;
            if (receipt.accepted !== true
                && receipt.code !== WAVE_RUN_RESULT_CODE.DEFERRED) {
                this.#recordR9ProgressionFailure('combat-clock', receipt);
                return;
            }
        }
        this.#commitR9SettlementIfReady(completedFixedTick);
    }

    #commitR9SettlementIfReady(fixedTick) {
        const view = this.waveRunCoordinator.getSettlementView();
        if (view.state !== WAVE_RUN_STATE.CLEAR_CANDIDATE) return;
        const snapshot = this.objectSystem
            .getWaveQuiescenceStatus().lastSnapshot;
        let proofResult;
        try {
            proofResult = createWaveClearProof(snapshot);
        } catch (error) {
            this.#recordR9ProgressionFailure(
                'clear-proof-publication',
                Object.freeze({ code: String(error?.message ?? error) })
            );
            return;
        }
        if (proofResult.accepted !== true || !proofResult.proof) {
            this.#recordR9ProgressionFailure(
                'clear-proof-publication',
                proofResult
            );
            return;
        }
        const transactionId = createWaveSettlementTransactionId({
            runSessionId: view.runSessionId,
            mapId: view.mapId,
            waveOrdinal: view.waveOrdinal,
            waveId: view.waveId,
            completionRevision: proofResult.proof.completionRevision
        });
        const receipt = this.waveSettlementCoordinator.commitSettlement({
            transactionId,
            quiescenceSnapshot: snapshot,
            fixedTick,
            expectedCommerceRevision: this.runCommerceState.getRevision(),
            waveStatistics: Object.freeze({})
        });
        this.r9LastSettlementReceipt = receipt;
        if (receipt.accepted !== true
            || (receipt.code !== WAVE_SETTLEMENT_RESULT_CODE.OPEN_REQUESTED
                && receipt.code
                    !== WAVE_SETTLEMENT_RESULT_CODE.OPEN_DEFERRED
                && receipt.code !== WAVE_SETTLEMENT_RESULT_CODE.OPENED)) {
            this.#recordR9ProgressionFailure('wave-settlement', receipt);
        }
    }

    #progressR9ClosedShopBoundary() {
        const pending = this.r9PendingShopCloseReceipt;
        if (!pending) return true;
        const closeReceipt = pending.receipt;
        const view = pending.sourceView;
        const nextWaveOrdinal = pending.nextWaveOrdinal;
        const nextTransactionId = pending.nextTransactionId;
        const preparedStatus = this.objectSystem
            .getNextWaveProgressionStatus();
        const matchingPrepared = nextTransactionId !== null
            && preparedStatus.transactionId === nextTransactionId
            && preparedStatus.waveOrdinal === nextWaveOrdinal;
        const blockers = this.#collectR9ClosedShopBlockers({
            view,
            closeReceipt,
            matchingPrepared
        });
        if (blockers.length !== 0) return false;

        if (nextWaveOrdinal > 0) {
            const nextEntry = this.r9WaveRunPlan.waves[
                nextWaveOrdinal - 1
            ];
            const prepareReceipt = this.objectSystem.prepareNextWave({
                transactionId: nextTransactionId,
                waveDefinition: nextEntry.waveDefinition,
                waveOrdinal: nextWaveOrdinal,
                fixedTickOffset: matchingPrepared
                    ? preparedStatus.fixedTickOffset
                    : this.fixedTick,
                planFingerprint: this.r9PlanFingerprint
            });
            if (prepareReceipt.accepted !== true) {
                if (prepareReceipt.code
                        === NEXT_WAVE_PROGRESSION_RESULT_CODE
                            .DEFERRED_UNSAFE_BOUNDARY
                    || prepareReceipt.code
                        === NEXT_WAVE_PROGRESSION_RESULT_CODE
                            .DIRECTOR_INIT_FAILED) {
                    return false;
                }
                this.#recordR9ProgressionFailure(
                    'next-wave-director-prepare',
                    prepareReceipt
                );
                return false;
            }
        }

        const continueReceipt = this.waveRunCoordinator.observeShopContinue({
            transactionId: `${closeReceipt.transactionId}:r9-observe`,
            runSessionId: view.runSessionId,
            planId: view.planId,
            waveOrdinal: view.waveOrdinal,
            waveId: view.waveId,
            continueReceiptId: closeReceipt.transactionId,
            completionRevision: view.completionRevision,
            authentic: true
        });
        this.r9LastContinueReceipt = continueReceipt;
        if (continueReceipt.accepted !== true) {
            this.#recordR9ProgressionFailure(
                'authentic-shop-continue',
                continueReceipt
            );
            return false;
        }
        if (nextWaveOrdinal === 0) {
            if (continueReceipt.state !== WAVE_RUN_STATE.MAP_CLEAR_READY
                || this.wordSystem.setRuntimePhase(
                    SENTENCE_RUNTIME_PHASE.PAUSE
                ) !== true) {
                this.#recordR9ProgressionFailure(
                    'map-clear-ready',
                    continueReceipt
                );
                return false;
            }
            this.r9PendingShopCloseReceipt = null;
            this.synchronizePresentation();
            return true;
        }

        const current = this.r9WaveRunPlan.waves[view.waveOrdinal - 1];
        const nextEntry = this.r9WaveRunPlan.waves[nextWaveOrdinal - 1];
        const prepareRunReceipt = this.waveRunCoordinator.prepareNextWave({
            transactionId: `${nextTransactionId}:wave-run-prepare`,
            runSessionId: view.runSessionId,
            planId: view.planId,
            planFingerprint: this.r9PlanFingerprint,
            completedWaveOrdinal: view.waveOrdinal,
            completedWaveId: current.waveDefinition.waveId,
            nextWaveOrdinal,
            nextWaveId: nextEntry.waveDefinition.waveId,
            completionRevision: view.completionRevision
        });
        if (prepareRunReceipt.accepted !== true) {
            this.#recordR9ProgressionFailure(
                'next-wave-run-prepare',
                prepareRunReceipt
            );
            return false;
        }
        const beginReceipt = this.waveRunCoordinator.beginWave({
            transactionId: `${nextTransactionId}:begin`,
            runSessionId: view.runSessionId,
            planId: view.planId,
            waveOrdinal: nextWaveOrdinal,
            waveId: nextEntry.waveDefinition.waveId,
            startingFixedTick: this.fixedTick
        });
        if (beginReceipt.accepted !== true) {
            this.#recordR9ProgressionFailure(
                'next-wave-begin',
                beginReceipt
            );
            return false;
        }
        const activationReceipt = this.objectSystem.activatePreparedNextWave({
            transactionId: nextTransactionId,
            planFingerprint: this.r9PlanFingerprint
        });
        if (activationReceipt.accepted !== true) {
            if (activationReceipt.code
                    === NEXT_WAVE_PROGRESSION_RESULT_CODE
                        .DEFERRED_UNSAFE_BOUNDARY) {
                return false;
            }
            this.#recordR9ProgressionFailure(
                'next-wave-activation',
                activationReceipt
            );
            return false;
        }
        this.r9PendingShopCloseReceipt = null;
        return true;
    }

    #captureR9PendingShopClose(closeReceipt) {
        const sourceView = this.waveRunCoordinator.getSettlementView();
        const nextWaveOrdinal = sourceView.nextProgression?.type
                === 'NEXT_WAVE'
            ? sourceView.nextProgression.waveOrdinal
            : 0;
        const nextTransactionId = nextWaveOrdinal > 0
            ? [
                'r9-next-wave',
                this.r9RunSessionId,
                nextWaveOrdinal,
                sourceView.completionRevision
            ].join(':')
            : null;
        return Object.freeze({
            receipt: closeReceipt,
            sourceView,
            nextWaveOrdinal,
            nextTransactionId
        });
    }

    #collectR9ClosedShopBlockers({
        view,
        closeReceipt,
        matchingPrepared
    }) {
        const blockers = [];
        const board = this.sentenceBoard.getStatus();
        const commerce = this.runCommerceState.getStatus();
        const shop = this.wordShopSession.getStatus();
        const settlement = this.waveSettlementCoordinator.getStatus();
        const hostile = this.getHostileParticipationStatus();
        const wave = this.objectSystem.getEnemyWaveStatus();
        if (closeReceipt.accepted !== true
            || closeReceipt.code !== SHOP_PHASE_RESULT_CODE.CLOSED
            || this.shopPhaseCoordinator.getPhase()
                !== SHOP_RUNTIME_PHASE.COMBAT
            || shop.active !== false) {
            blockers.push('SHOP_NOT_AUTHENTICALLY_CLOSED');
        }
        if (board.draftSlots !== null) blockers.push('BOARD_DRAFT_PENDING');
        if (commerce.pendingTransactionCount !== 0) {
            blockers.push('COMMERCE_PENDING');
        }
        if (settlement.activeStage !== WAVE_SETTLEMENT_STAGE.OPENED
            || settlement.settlementOrdinal !== view.waveOrdinal
            || settlement.settlementReceipt === null) {
            blockers.push('SETTLEMENT_NOT_COMMITTED');
        }
        if (hostile?.countExact !== true
            || hostile.hostileActorCount !== 0
            || hostile.pendingHostileActorCount !== 0) {
            blockers.push('HOSTILE_NOT_EXACT_ZERO');
        }
        if (!matchingPrepared
            && (wave?.allSpawnsQueued !== true
                || wave.remainingSpawnCount !== 0
                || wave.blockedSpawnCount !== 0)) {
            blockers.push('OLD_WAVE_PENDING');
        }
        if (this.isGpuWorldRecoveryRequired()) {
            blockers.push('ENDPOINT_RECOVERY');
        }
        return blockers;
    }

    #isR9MapClearReady() {
        return this.r9RuntimeActive
            && this.waveRunCoordinator?.getSettlementView?.().state
                === WAVE_RUN_STATE.MAP_CLEAR_READY;
    }

    #needsR9PausedTechnicalBoundary() {
        const recovery = this.getGpuRecoveryStatus();
        return recovery?.probation?.state === 'PENDING'
            || (recovery?.pendingFixedTick ?? 0) !== 0;
    }

    #advanceR9PausedTechnicalBoundary() {
        const proposedFixedTick = this.fixedTick + 1;
        const advanced = this.objectSystem.fixedUpdate(
            this.dependencies.timePort.getFixedDelta(),
            proposedFixedTick
        );
        if (advanced === true) this.fixedTick = proposedFixedTick;
        return advanced === true
            ? FIXED_STEP_RESULT.COMPLETED
            : FIXED_STEP_RESULT.DEFERRED_BACKPRESSURE;
    }

    #recordR9ProgressionFailure(stage, detail) {
        this.r9ProgressionFailure ??= Object.freeze({
            stage,
            code: detail?.code ?? 'R9_PROGRESSION_FAILURE',
            transactionId: detail?.transactionId ?? null
        });
    }

    /** SHOP에서 읽은 held 입력이 COMBAT command로 새어 나가지 않게 edge/baseline만 동기화합니다. */
    #synchronizeSuppressedShopInput() {
        const moveAction = this.inputActionMapper.mapMoveAction(
            this.dependencies.inputActionSource
        );
        if (moveAction.payload.x !== 0 || moveAction.payload.y !== 0) {
            this.shopMovementReleaseRequired = true;
        }
        const pointerAction = this.inputActionMapper.mapPrimaryPointerFireAction(
            this.dependencies.inputActionSource
        );
        if (pointerAction.payload.pressed === true) {
            this.shopPointerReleaseRequired = true;
        }
        this.inputActionMapper.mapSkillEdgeActions(
            this.dependencies.inputActionSource
        );
        this.inputActionMapper.primeWheelBaseline(
            this.dependencies.inputActionSource
        );
    }
}
