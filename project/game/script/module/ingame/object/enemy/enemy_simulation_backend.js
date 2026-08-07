import {
    GPU_BODY_PRESENTATION_PROFILE
} from '../../physics/gpu/gpu_body_presentation_clock.js';
import { GpuCircleBodySimulation } from '../../physics/gpu/gpu_circle_body_simulation.js';
import {
    createGpuSignedDistanceField
} from '../../physics/gpu/gpu_signed_distance_field.js';
import {
    createRouteFlowFieldAtlas
} from '../../navigation/route_flow_field_atlas.js';

const SOURCE_GRID_TO_SDF_CELL_RATIO = 12 / 8;
const SOURCE_WORLD_UNIT_TO_SDF_CELL_RATIO = 1 / 8;
const DEFAULT_BODY_CAPACITY = 16384;
const TERMINAL_WEBGPU_PLATFORM_STATUSES = new Set([
    'unsupported',
    'destroyed'
]);

function classifyUnavailablePlatformState(platformPort) {
    if (!platformPort) {
        return 'gpu-terminal-unavailable';
    }
    try {
        const platformStatus = platformPort.getState?.()?.status;
        return TERMINAL_WEBGPU_PLATFORM_STATUSES.has(platformStatus)
            ? 'gpu-terminal-unavailable'
            : 'gpu-unavailable';
    } catch {
        return 'gpu-failed';
    }
}

function requirePositiveSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
        throw new RangeError(`${label}은 양의 안전한 정수여야 합니다.`);
    }
    return number;
}

/**
 * @class EnemySimulationBackend
 * @description 현재 TileMap/flow-field 좌표계를 보존하며 GPU collision/presentation 세션을 소유합니다.
 */
export class EnemySimulationBackend {
    /**
     * @param {{webGpuPlatformPort?:object|null}} [dependencies={}] - 엔진 adapter 의존성입니다.
     * @param {{capacity?:number,presentationProfile?:string}} [options={}] - session 설정입니다.
     */
    constructor(dependencies = {}, options = {}) {
        this.webGpuPlatformPort = dependencies.webGpuPlatformPort ?? null;
        this.capacity = options.capacity ?? DEFAULT_BODY_CAPACITY;
        this.presentationProfile = options.presentationProfile
            ?? GPU_BODY_PRESENTATION_PROFILE.REFERENCE_CLOCK_EXTRAPOLATION;
        this.controlCommandCapacity = options.controlCommandCapacity;
        this.spawnProgramCapacity = options.spawnProgramCapacity;
        this.sessionGeneration = requirePositiveSafeInteger(
            options.sessionGeneration ?? 1,
            'sessionGeneration'
        );
        this.navigationGrid = null;
        this.signedDistanceField = null;
        this.flowFieldAtlas = null;
        this.flowRouteByPathId = new Map();
        this.simulation = null;
        this.state = 'idle';
        this.initialized = false;
        this.destroyed = false;
    }

    /**
     * 맵 topology에서 SDF를 한 번 만들고 첫 non-empty spawn까지 GPU 자원 생성을 미룹니다.
     * @param {object} tileMap - 현재 ITileNavigationSource입니다.
     * @returns {boolean} 이미 GPU backend가 준비된 경우에만 true입니다.
     */
    init(tileMap) {
        if (this.initialized || this.destroyed) {
            return this.state === 'gpu-ready';
        }
        if (!tileMap
            || typeof tileMap.getNavigationGrid !== 'function'
            || typeof tileMap.getWorldBounds !== 'function') {
            throw new TypeError('EnemySimulationBackend에는 TileMap navigation source가 필요합니다.');
        }
        this.navigationGrid = tileMap.getNavigationGrid();
        this.signedDistanceField = createGpuSignedDistanceField(this.navigationGrid);
        if (typeof tileMap.getSpawnRoutes === 'function') {
            this.flowFieldAtlas = createRouteFlowFieldAtlas(tileMap);
            for (const route of this.flowFieldAtlas.routes) {
                this.flowRouteByPathId.set(route.pathId, route);
            }
        }
        this.initialized = true;

        if (!this.webGpuPlatformPort) {
            this.state = classifyUnavailablePlatformState(null);
            return false;
        }
        const worldBounds = tileMap.getWorldBounds();
        const collisionCellSize = this.navigationGrid.cellSize
            * SOURCE_GRID_TO_SDF_CELL_RATIO;
        this.simulation = new GpuCircleBodySimulation(this.webGpuPlatformPort, {
            capacity: this.capacity,
            worldSize: {
                x: worldBounds.width,
                y: worldBounds.height
            },
            gridCellSize: {
                x: collisionCellSize,
                y: collisionCellSize
            },
            maxBodiesPerCell: 64,
            solverIterations: 6,
            sdf: this.signedDistanceField,
            flowFieldAtlas: this.flowFieldAtlas,
            sourceWorldUnitScale: this.navigationGrid.cellSize
                * SOURCE_WORLD_UNIT_TO_SDF_CELL_RATIO,
            presentationProfile: this.presentationProfile,
            controlCommandCapacity: this.controlCommandCapacity,
            spawnProgramCapacity: this.spawnProgramCapacity,
            sessionGeneration: this.sessionGeneration
        });
        this.state = 'gpu-deferred';
        return false;
    }

    /**
     * 세션 진입/authoritative rebuild에만 사용하는 dense body 교체 경계입니다.
     * live spawn/despawn은 아래 stable-slot API를 fixed command 경계에서 사용합니다.
     * @param {object[]} bodies - collision body spawn 목록입니다.
     * @returns {object} accepted/rejected 결과입니다.
     */
    replaceBodies(bodies) {
        if (!Array.isArray(bodies)) {
            throw new TypeError('enemy simulation body 목록은 배열이어야 합니다.');
        }
        if (!this.simulation) {
            return Object.freeze({
                accepted: 0,
                rejected: bodies.length,
                capacity: this.capacity,
                reason: 'gpu-unavailable'
            });
        }
        const resolvedBodies = bodies.map((body, index) => this.#resolveBodyFlow(body, index));
        const result = this.simulation.replaceBodies(resolvedBodies);
        this.#syncState();
        return result;
    }

    /**
     * 기존 GPU body 상태를 재생성하지 않고 stable slot에 적을 추가합니다.
     * 실제 gameplay caller는 다음 fixed-step command commit 경계에서만 호출해야 합니다.
     * @param {object[]} bodies - entityId/incarnation과 route 정보를 가진 spawn batch입니다.
     * @returns {object} accepted/rejected 결과입니다.
     */
    spawnBodies(bodies) {
        if (!Array.isArray(bodies)) {
            throw new TypeError('enemy spawn batch는 배열이어야 합니다.');
        }
        if (!this.simulation) {
            return Object.freeze({
                accepted: 0,
                rejected: bodies.length,
                capacity: this.capacity,
                reason: 'gpu-unavailable'
            });
        }
        const resolvedBodies = bodies.map((body, index) => this.#resolveBodyFlow(body, index));
        const result = this.simulation.spawnBodies(resolvedBodies);
        this.#syncState();
        return result;
    }

    /**
     * entityId/incarnation이 일치하는 적만 tombstone 처리합니다.
     * 실제 gameplay caller는 다음 fixed-step command commit 경계에서만 호출해야 합니다.
     * @param {object[]} handles - stable enemy handle batch입니다.
     * @returns {object} removed/rejected 결과입니다.
     */
    despawnBodies(handles) {
        if (!Array.isArray(handles)) {
            throw new TypeError('enemy despawn batch는 배열이어야 합니다.');
        }
        if (!this.simulation) {
            return Object.freeze({
                removed: 0,
                rejected: handles.length,
                capacity: this.capacity,
                reason: 'gpu-unavailable'
            });
        }
        const result = this.simulation.despawnBodies(handles);
        this.#syncState();
        return result;
    }

    /** @param {object} handle - entityId/incarnation handle입니다. */
    hasBody(handle) {
        return this.simulation?.hasBody(handle) ?? false;
    }

    canControlBody(handle) {
        return this.simulation?.canControlBody?.(handle) ?? false;
    }

    /** Generic control + source-relative spawn plan을 한 fixed submit용으로 staging합니다. */
    stageFixedPrograms(plan = {}) {
        if (!this.simulation) {
            const count = (plan.controls?.length ?? 0)
                + (plan.sourceRelativeSpawns?.length ?? 0);
            return Object.freeze({
                accepted: 0,
                rejected: count,
                reason: 'gpu-unavailable'
            });
        }
        const sourceRelativeSpawns = (plan.sourceRelativeSpawns ?? []).map(
            (entry, index) => ({
                ...entry,
                destinationSpawn: this.#resolveBodyFlow(
                    entry.destinationSpawn,
                    index
                )
            })
        );
        const result = this.simulation.stageFixedPrograms({
            ...plan,
            sourceRelativeSpawns
        });
        this.#syncState();
        return result;
    }

    drainCompletedSpawnProgramBatches(out = []) {
        if (!Array.isArray(out)) {
            throw new TypeError('SpawnProgram 완료 출력은 배열이어야 합니다.');
        }
        return this.simulation?.drainCompletedSpawnProgramBatches?.(out) ?? out;
    }

    hasPendingSpawnProgramThroughTick(sourceTick) {
        return this.simulation?.hasPendingSpawnProgramThroughTick?.(sourceTick) ?? false;
    }

    configureTrackedBody(handle = null) {
        return this.simulation?.configureTrackedBody?.(handle)
            ?? Object.freeze({ accepted: false, reason: 'gpu-unavailable' });
    }

    getObservedTrackedPose() {
        return this.simulation?.getObservedTrackedPose?.()
            ?? this.simulation?.getLatestTrackedPose?.()
            ?? null;
    }

    /** @deprecated generic observed 명칭의 compatibility alias입니다. */
    getLatestTrackedPose() {
        return this.getObservedTrackedPose();
    }

    /**
     * @param {number} delta - 초 단위 fixed delta입니다.
     * @param {number} [sourceTick] - 이 submit을 소유하는 권위 fixed tick입니다.
     */
    fixedUpdate(delta, sourceTick) {
        if (!this.simulation) {
            return false;
        }
        const submitted = this.simulation.fixedUpdate(delta, sourceTick);
        this.#syncState();
        return submitted;
    }

    /**
     * 완료된 GPU event readback batch를 제출 순서대로 caller 배열에 이동합니다.
     * 구형 injected simulation에는 event API가 없을 수 있으므로 빈 결과로 호환합니다.
     * @param {object[]} [out=[]] - batch 출력 배열입니다.
     * @returns {object[]} 동일 out입니다.
     */
    drainCompletedEventBatches(out = []) {
        if (!Array.isArray(out)) {
            throw new TypeError('GPU 완료 event batch 출력은 배열이어야 합니다.');
        }
        if (typeof this.simulation?.drainCompletedEventBatches !== 'function') {
            return out;
        }
        const drained = this.simulation.drainCompletedEventBatches(out);
        return Array.isArray(drained) ? drained : out;
    }

    /** @param {object} frame - frame delta/fixed alpha 표현 입력입니다. */
    updatePresentation(frame) {
        return this.simulation?.updatePresentation(frame) ?? null;
    }

    /** pause/resume 경계에서 남은 GPU render prediction을 제거합니다. */
    synchronizePresentation() {
        this.simulation?.synchronizePresentation();
    }

    /** @param {object} camera - 현재 WorldCamera2D입니다. */
    draw(camera) {
        if (!this.simulation) {
            return false;
        }
        const submitted = this.simulation.draw(camera);
        this.#syncState();
        return submitted;
    }

    /** @returns {object|null} map setup에서 생성한 immutable SDF snapshot입니다. */
    getSignedDistanceField() {
        return this.signedDistanceField;
    }

    /** @returns {object|null} 기존 JS/WASM 방향 plane으로 만든 route-stage atlas입니다. */
    getFlowFieldAtlas() {
        return this.flowFieldAtlas;
    }

    /** @returns {object} backend 진단 snapshot입니다. */
    getStatus() {
        if (!this.destroyed) {
            this.#syncState();
        }
        const gpu = this.simulation?.getStatus() ?? null;
        return Object.freeze({
            state: this.state,
            initialized: this.initialized,
            navigationSize: this.navigationGrid?.size ?? 0,
            flowFieldCount: this.flowFieldAtlas?.fieldCount ?? 0,
            events: gpu?.events ?? null,
            gpu
        });
    }

    /** Facade event envelope 검증용 현재 session/device/epoch 상태입니다. */
    getEventProtocolState() {
        return this.simulation?.getEventProtocolState?.() ?? Object.freeze({
            sessionGeneration: this.sessionGeneration,
            deviceGeneration: -1,
            authoritativeEpoch: 0,
            submittedTickCount: 0
        });
    }

    /** @returns {string} 할당 없는 backend runtime state입니다. */
    getRuntimeState() {
        if (!this.destroyed) {
            this.#syncState();
        }
        return this.state;
    }

    /** @returns {number} stable GPU enemy slot의 session 상한입니다. */
    getCapacity() {
        return this.capacity;
    }

    /** @returns {boolean} 현재 활성 GPU 적이 하나 이상 있는지 여부입니다. */
    hasActiveBodies() {
        return (this.simulation?.getActiveBodyCount() ?? 0) > 0;
    }

    /** @returns {boolean} 상위 session이 spawn/진행을 멈추고 복구해야 하는 상태입니다. */
    requiresRecovery() {
        if (!this.destroyed) {
            this.#syncState();
        }
        return this.state === 'gpu-requires-rebuild'
            || this.state === 'gpu-overflow-degraded'
            || this.state === 'gpu-backpressure'
            || this.state === 'gpu-terminal-unavailable'
            || this.state === 'gpu-failed';
    }

    /** 반복 호출 가능한 session teardown입니다. */
    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.simulation?.destroy();
        this.simulation = null;
        this.signedDistanceField = null;
        this.flowFieldAtlas = null;
        this.flowRouteByPathId.clear();
        this.navigationGrid = null;
        this.initialized = false;
        this.state = 'destroyed';
    }

    #syncState() {
        const gpuState = this.simulation?.getRuntimeState();
        switch (gpuState) {
            case 'ready':
                this.state = 'gpu-ready';
                break;
            case 'idle':
                this.state = 'gpu-deferred';
                break;
            case 'requires-rebuild':
                this.state = 'gpu-requires-rebuild';
                break;
            case 'overflow-degraded':
                this.state = 'gpu-overflow-degraded';
                break;
            case 'telemetry-backpressure':
            case 'event-backpressure':
                this.state = 'gpu-backpressure';
                break;
            case 'event-overflow-degraded':
            case 'contact-overflow-degraded':
            case 'failed':
                this.state = gpuState === 'failed'
                    ? 'gpu-failed'
                    : 'gpu-overflow-degraded';
                break;
            default:
                this.state = classifyUnavailablePlatformState(this.webGpuPlatformPort);
                break;
        }
    }

    #resolveBodyFlow(body, bodyIndex) {
        if (!body || typeof body !== 'object') {
            throw new TypeError(`enemy simulation body가 객체가 아닙니다: index=${bodyIndex}`);
        }
        if (body.pathId === undefined || body.pathId === null) {
            return body;
        }
        const route = this.flowRouteByPathId.get(body.pathId);
        if (!route) {
            throw new RangeError(`등록되지 않은 enemy pathId입니다: ${String(body.pathId)}`);
        }
        const waypointIndex = body.waypointIndex ?? route.firstTargetWaypointIndex;
        if (!Number.isInteger(waypointIndex)) {
            throw new TypeError(`enemy waypointIndex는 정수여야 합니다: index=${bodyIndex}`);
        }
        const routeFieldOffset = waypointIndex - route.firstTargetWaypointIndex;
        if (routeFieldOffset < 0 || routeFieldOffset >= route.fieldCount) {
            throw new RangeError(
                `enemy waypointIndex가 route field 범위를 벗어났습니다: ${route.pathId}/${waypointIndex}`
            );
        }
        return {
            ...body,
            useFlow: true,
            flowFieldIndex: route.firstFieldIndex + routeFieldOffset,
            flowSpeed: body.flowSpeed ?? body.maxSpeed
        };
    }
}
