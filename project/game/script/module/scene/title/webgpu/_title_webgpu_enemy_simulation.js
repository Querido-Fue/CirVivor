import {
    TITLE_CPU_ENEMY_PRESENTATION_MAX_RECORDS,
    TITLE_CPU_ENEMY_PRESENTATION_RECORD_BYTES,
    TITLE_CPU_ENEMY_PRESENTATION_RECORD_FLOATS,
    TITLE_CPU_ENEMY_STYLE_TYPES
} from './_title_cpu_enemy_presentation_adapter.js';
import { TITLE_WEBGPU_SHIELD_INTERACTION_ABI } from './_title_webgpu_shield_interaction_abi.js';
import {
    TITLE_WEBGPU_ENEMY_SIMULATION_BODY_BYTES,
    TITLE_WEBGPU_ENEMY_SIMULATION_CAPACITY,
    TITLE_WEBGPU_ENEMY_SIMULATION_FIXED_BYTES,
    TITLE_WEBGPU_ENEMY_SIMULATION_FIXED_FLOATS,
    TITLE_WEBGPU_ENEMY_SIMULATION_LAYER_CAPACITY,
    TITLE_WEBGPU_ENEMY_SIMULATION_LAYER_COUNT,
    TITLE_WEBGPU_ENEMY_SIMULATION_RECORD_COUNT,
    TITLE_WEBGPU_ENEMY_SIMULATION_SHADER,
    TITLE_WEBGPU_ENEMY_SIMULATION_SPAWN_BYTES,
    TITLE_WEBGPU_ENEMY_SIMULATION_SPAWN_FLOATS,
    TITLE_WEBGPU_ENEMY_SIMULATION_WORKGROUP_SIZE
} from './_title_webgpu_enemy_simulation_shader.js';

const BUFFER_USAGE_COPY_SRC = 0x04;
const BUFFER_USAGE_COPY_DST = 0x08;
const BUFFER_USAGE_UNIFORM = 0x40;
const BUFFER_USAGE_STORAGE = 0x80;
const MAX_PENDING_FIXED_STEPS = 8;
const MAX_PENDING_SPAWN_BATCHES = MAX_PENDING_FIXED_STEPS + 1;
const MAX_PENDING_RESIZE_BATCHES = MAX_PENDING_FIXED_STEPS;
const UNIFORM_SLOT_BYTES = 256;
const COLLISION_PASS_COUNT = 1;
const PRESENTATION_RECORD_BUFFER_BYTES = TITLE_WEBGPU_ENEMY_SIMULATION_RECORD_COUNT
    * TITLE_CPU_ENEMY_PRESENTATION_RECORD_BYTES;
const CORRECTION_BUFFER_BYTES = TITLE_WEBGPU_ENEMY_SIMULATION_CAPACITY * 16;
const BODY_BUFFER_BYTES = TITLE_WEBGPU_ENEMY_SIMULATION_CAPACITY
    * TITLE_WEBGPU_ENEMY_SIMULATION_BODY_BYTES;
const SPAWN_BUFFER_BYTES = TITLE_WEBGPU_ENEMY_SIMULATION_CAPACITY
    * TITLE_WEBGPU_ENEMY_SIMULATION_SPAWN_BYTES;
const DEG_TO_RAD = Math.PI / 180;
const DISPATCH_BODY_COUNT = Math.ceil(
    TITLE_WEBGPU_ENEMY_SIMULATION_CAPACITY / TITLE_WEBGPU_ENEMY_SIMULATION_WORKGROUP_SIZE
);
const DISPATCH_RECORD_COUNT = Math.ceil(
    TITLE_WEBGPU_ENEMY_SIMULATION_CAPACITY / TITLE_WEBGPU_ENEMY_SIMULATION_WORKGROUP_SIZE
);
const DISPATCH_COLLISION_LAYER_COUNT = TITLE_WEBGPU_ENEMY_SIMULATION_LAYER_COUNT;

const PIPELINE_ENTRIES = Object.freeze({
    spawn: 'spawn_title_bodies',
    resize: 'resize_title_bodies',
    integrate: 'simulate_title_layers',
    collision: 'accumulate_title_collisions',
    applyCollision: 'apply_title_collisions',
    presentation: 'write_title_presentation',
    shieldClear: 'clear_title_shield_frame'
});

/**
 * 타이틀 장식 적의 GPU-authoritative fixed simulation owner입니다.
 * composer가 준 encoder에만 command를 기록하며 submit/readback/swapchain을 소유하지 않습니다.
 */
export class TitleWebGpuEnemySimulation {
    constructor({
        capacity = TITLE_WEBGPU_ENEMY_SIMULATION_CAPACITY,
        layerCapacity = TITLE_WEBGPU_ENEMY_SIMULATION_LAYER_CAPACITY,
        layerProfiles = [],
        targetPerLayer = 126
    } = {}) {
        if (capacity !== TITLE_WEBGPU_ENEMY_SIMULATION_CAPACITY
            || layerCapacity !== TITLE_WEBGPU_ENEMY_SIMULATION_LAYER_CAPACITY) {
            throw new RangeError('title GPU simulation capacity ABI는 420/140으로 고정됩니다.');
        }
        if (Array.isArray(layerProfiles)
            && layerProfiles.length > 0
            && layerProfiles.length !== TITLE_WEBGPU_ENEMY_SIMULATION_LAYER_COUNT) {
            throw new RangeError('title GPU simulation은 far/mid/near 3개 layer가 필요합니다.');
        }

        this.capacity = capacity;
        this.layerCapacity = layerCapacity;
        this.targetPerLayer = clampInteger(targetPerLayer, 1, layerCapacity, 126);
        this.pendingSpawns = [];
        this.pendingFixedSteps = [];
        this.pendingJournal = [];
        this.pendingResizeX = 1;
        this.pendingResizeY = 1;
        this.resizeRevision = 0;
        this.presentationState = {
            width: 1,
            height: 1,
            objectOffsetY: 0,
            interpolationAlpha: 1,
            frameDelta: 1 / 60,
            shieldCenterX: 0,
            shieldCenterY: 0,
            shieldRadius: 0
        };
        this.nextIncarnation = 1;
        this.queueOverflowed = false;
        this.failedClosed = false;
        this.lastFailureReason = null;
        this.destroyed = false;
        this.destroyPending = false;
        this.device = null;
        this.deviceGeneration = null;
        this.resources = null;
        this.activeFrame = null;
        this.lastEncodedFrameId = null;
        this.lastCommittedFrameId = null;
        this.encodeCount = 0;
        this.commitCount = 0;
        this.abortCount = 0;
        this.spawnQueuedCount = 0;
        this.fixedQueuedCount = 0;
        this.cleanupFailureCount = 0;

        this.spawnUploadBytes = new ArrayBuffer(SPAWN_BUFFER_BYTES);
        this.spawnUploadFloats = new Float32Array(this.spawnUploadBytes);
        this.spawnUploadUints = new Uint32Array(this.spawnUploadBytes);
        this.spawnControls = Array.from(
            { length: MAX_PENDING_SPAWN_BATCHES },
            () => new Uint32Array(4)
        );
        this.resizeUniforms = Array.from(
            { length: MAX_PENDING_RESIZE_BATCHES },
            () => new Float32Array(4)
        );
        this.fixedUniforms = Array.from(
            { length: MAX_PENDING_FIXED_STEPS },
            () => new Float32Array(TITLE_WEBGPU_ENEMY_SIMULATION_FIXED_FLOATS)
        );
        this.presentationUniform = new Float32Array(4);
        this.shieldUniform = new Float32Array(8);
        this.collisionOnlyUniform = new Float32Array(TITLE_WEBGPU_ENEMY_SIMULATION_FIXED_FLOATS);
        this.presentationSource = Object.seal({
            gpuSourceBuffer: null,
            byteOffset: 0,
            byteLength: PRESENTATION_RECORD_BUFFER_BYTES,
            frameId: null,
            deviceGeneration: null,
            revision: 0
        });
        this.shieldInteractionSource = Object.seal({
            gpuSourceBuffer: null,
            byteOffset: 0,
            byteLength: TITLE_WEBGPU_SHIELD_INTERACTION_ABI.BYTE_SIZE,
            impactCountByteOffset: TITLE_WEBGPU_SHIELD_INTERACTION_ABI.HEADER_BYTE_OFFSET,
            dentCountByteOffset: TITLE_WEBGPU_SHIELD_INTERACTION_ABI.HEADER_BYTE_OFFSET + 4,
            frameId: null,
            deviceGeneration: null,
            generation: null,
            revision: 0
        });
        this.presentationPacket = Object.seal({
            gpuSourceBuffer: null,
            records: null,
            recordCount: TITLE_WEBGPU_ENEMY_SIMULATION_RECORD_COUNT,
            usedByteLength: PRESENTATION_RECORD_BUFFER_BYTES,
            recordStrideFloats: TITLE_CPU_ENEMY_PRESENTATION_RECORD_FLOATS,
            recordStrideBytes: TITLE_CPU_ENEMY_PRESENTATION_RECORD_BYTES,
            maxRecordCount: TITLE_CPU_ENEMY_PRESENTATION_MAX_RECORDS,
            layerCount: TITLE_WEBGPU_ENEMY_SIMULATION_LAYER_COUNT,
            overflowed: false,
            droppedRecordCount: 0,
            unsupportedRecordCount: 0,
            frameId: null,
            deviceGeneration: null,
            revision: 0
        });
        this.encodeOutput = Object.seal({
            presentationPacket: this.presentationPacket,
            presentationSource: this.presentationSource,
            shieldInteractionBuffer: null,
            shieldInteractionSource: this.shieldInteractionSource,
            frameId: null,
            deviceGeneration: null,
            revision: 0
        });
    }

    /** fixed-boundary spawn intent를 bounded host queue에 복사합니다. */
    queueSpawn(intent = {}) {
        if (this.destroyed || this.pendingSpawns.length >= this.capacity) {
            this.queueOverflowed = this.pendingSpawns.length >= this.capacity;
            return null;
        }
        const layerIndex = clampInteger(
            intent.layerIndex,
            0,
            TITLE_WEBGPU_ENEMY_SIMULATION_LAYER_COUNT - 1,
            0
        );
        const shapeCode = resolveShapeCode(intent.shapeType, intent.styleCode);
        if (shapeCode < 0) {
            return null;
        }
        const width = positiveFinite(intent.width ?? intent.size, 1);
        const height = positiveFinite(intent.height ?? intent.size, width);
        const incarnation = this.#nextIncarnation();
        const spawn = {
            layerIndex,
            shapeCode,
            incarnation,
            positionX: finite(intent.position?.x, 0),
            positionY: finite(intent.position?.y, 0),
            speedX: finite(intent.speed?.x, 0),
            speedY: finite(intent.speed?.y, 0),
            baseSpeedX: finite(intent.baseSpeed?.x, finite(intent.speed?.x, 0)),
            baseSpeedY: finite(intent.baseSpeed?.y, finite(intent.speed?.y, 0)),
            burstX: finite(intent.burstVelocity?.x, 0),
            burstY: finite(intent.burstVelocity?.y, 0),
            burstDecayRate: Math.max(0, finite(intent.burstDecayRate, 0)),
            rotationRadians: Number.isFinite(intent.rotationRadians)
                ? intent.rotationRadians
                : finite(intent.rotation, 0) * DEG_TO_RAD,
            angularVelocityRadians: Number.isFinite(intent.angularVelocityRadians)
                ? intent.angularVelocityRadians
                : finite(intent.angularVelocity ?? intent.rotationSpeed, 0) * DEG_TO_RAD,
            collisionGrace: Math.max(0, finite(intent.collisionGrace, 0)),
            width,
            height,
            alpha: clamp(finite(intent.alpha, 1), 0, 1),
            collisionRadius: positiveFinite(intent.collisionRadius, Math.max(width, height) * 0.42),
            magneticScale: Math.max(0, finite(intent.magneticScale, 1)),
            size: positiveFinite(intent.size, 1),
            viewportWidth: this.presentationState.width,
            viewportHeight: this.presentationState.height
        };
        this.pendingSpawns.push(spawn);
        this.pendingJournal.push({ kind: 'spawn', spawn });
        this.spawnQueuedCount += 1;
        return Object.freeze({ slotIndex: null, layerIndex, incarnation });
    }

    /** 한 fixed tick의 입력을 값 snapshot으로 bounded queue에 보관합니다. */
    queueFixedStep(delta, aiContext = {}) {
        if (this.destroyed) return false;
        if (this.pendingFixedSteps.length >= MAX_PENDING_FIXED_STEPS) {
            this.queueOverflowed = true;
            return false;
        }
        const stepDelta = finite(delta, 0);
        if (!(stepDelta > 0)) return false;
        const fixedStep = {
            delta: stepDelta,
            uiww: Math.max(0, finite(aiContext?.uiww, 0)),
            objectFocused: aiContext?.objectFocused === true,
            leftPressing: aiContext?.leftPressing === true,
            mouseX: finite(aiContext?.mousePos?.x, 0),
            mouseY: finite(aiContext?.mousePos?.y, 0),
            hasMouse: Boolean(aiContext?.mousePos),
            logoX: finite(aiContext?.logoMagneticPoint?.x, 0),
            logoY: finite(aiContext?.logoMagneticPoint?.y, 0),
            hasLogo: Boolean(aiContext?.logoMagneticPoint),
            logoDistance: Math.max(0, finite(aiContext?.logoMagneticDistance, 0)),
            viewportWidth: this.presentationState.width,
            viewportHeight: this.presentationState.height
        };
        this.pendingFixedSteps.push(fixedStep);
        this.pendingJournal.push({ kind: 'fixed', fixedStep });
        this.fixedQueuedCount += 1;
        return true;
    }

    /** variable-frame 보간/viewport/shield input을 allocation 없이 갱신합니다. */
    setPresentationState(state = {}) {
        if (this.destroyed) return false;
        const target = this.presentationState;
        target.width = positiveFinite(state.width ?? state.ww, target.width);
        target.height = positiveFinite(state.height ?? state.objectWH, target.height);
        target.objectOffsetY = finite(state.objectOffsetY, target.objectOffsetY);
        target.interpolationAlpha = clamp(finite(
            state.interpolationAlpha ?? state.fixedInterpolationAlpha,
            target.interpolationAlpha
        ), 0, 1);
        target.frameDelta = clamp(finite(state.frameDelta, target.frameDelta), 0, 0.1);
        const shield = state.shieldLayout;
        target.shieldCenterX = finite(shield?.centerX ?? shield?.x, 0);
        target.shieldCenterY = finite(shield?.centerY ?? shield?.y, 0);
        target.shieldRadius = Math.max(0, finite(shield?.radius, 0));
        return true;
    }

    /** resize 비율을 commit까지 누적하고 이후 fixed/spawn이 사용할 viewport epoch를 전환합니다. */
    queueResize(ratioX, ratioY, nextViewport = null) {
        if (this.destroyed) return false;
        const resolvedRatioX = positiveFinite(ratioX, 1);
        const resolvedRatioY = positiveFinite(ratioY, 1);
        this.presentationState.width = positiveFinite(
            nextViewport?.width,
            this.presentationState.width * resolvedRatioX
        );
        this.presentationState.height = positiveFinite(
            nextViewport?.height,
            this.presentationState.height * resolvedRatioY
        );
        this.pendingResizeX *= resolvedRatioX;
        this.pendingResizeY *= resolvedRatioY;
        this.resizeRevision += 1;
        const lastIndex = this.pendingJournal.length - 1;
        const lastOperation = this.pendingJournal[lastIndex] ?? null;
        const activeJournalCount = this.activeFrame?.journalCount ?? 0;
        if (lastOperation?.kind === 'resize' && lastIndex >= activeJournalCount) {
            lastOperation.ratioX *= resolvedRatioX;
            lastOperation.ratioY *= resolvedRatioY;
        } else {
            this.pendingJournal.push({
                kind: 'resize',
                ratioX: resolvedRatioX,
                ratioY: resolvedRatioY
            });
        }
        return true;
    }

    /** composer context의 단일 encoder에 simulation→presentation→shield를 순서대로 기록합니다. */
    encode(context) {
        this.#assertContext(context);
        if (this.activeFrame) {
            throw new Error('title GPU simulation frame이 이미 encode 중입니다.');
        }
        this.#ensureGeneration(context.device, context.deviceGeneration);
        if (this.lastEncodedFrameId !== null && context.frameId <= this.lastEncodedFrameId) {
            throw new Error('stale title GPU simulation frame입니다.');
        }

        const spawnCount = this.pendingSpawns.length;
        const fixedCount = this.pendingFixedSteps.length;
        const journalCount = this.pendingJournal.length;
        const resizeRevision = this.resizeRevision;
        const framePlan = this.#buildFramePlan(journalCount);
        this.#uploadFrameInputs(context.device, framePlan);

        const resources = this.resources;
        const pass = context.encoder.beginComputePass({
            label: `title-webgpu-enemy-simulation:${context.frameId}`
        });
        for (const operation of framePlan.operations) {
            if (operation.kind === 'resize') {
                encodeDispatch(
                    pass,
                    resources.pipelines.resize,
                    resources.bindGroups.resize[operation.batchIndex],
                    DISPATCH_BODY_COUNT
                );
            } else if (operation.kind === 'fixed') {
                encodeDispatch(
                    pass,
                    resources.pipelines.integrate,
                    resources.bindGroups.fixed[operation.batchIndex],
                    DISPATCH_COLLISION_LAYER_COUNT
                );
            } else {
                encodeDispatch(
                    pass,
                    resources.pipelines.spawn,
                    resources.bindGroups.spawn[operation.batchIndex],
                    1
                );
                encodeDispatch(
                    pass,
                    resources.pipelines.integrate,
                    resources.bindGroups.collisionOnly[operation.batchIndex],
                    operation.collisionLayerCount
                );
            }
        }
        encodeDispatch(
            pass,
            resources.pipelines.shieldClear,
            resources.bindGroups.shieldClear,
            1
        );
        encodeDispatch(
            pass,
            resources.pipelines.presentation,
            resources.bindGroups.presentation,
            DISPATCH_RECORD_COUNT
        );
        pass.end();

        this.activeFrame = {
            frameId: context.frameId,
            spawnCount,
            fixedCount,
            journalCount,
            resizeRevision,
            resizeX: this.pendingResizeX,
            resizeY: this.pendingResizeY
        };
        const stagedRevision = this.commitCount + 1;
        this.presentationPacket.frameId = context.frameId;
        this.presentationPacket.deviceGeneration = context.deviceGeneration;
        this.presentationPacket.revision = stagedRevision;
        stampGpuSourceIdentity(
            this.presentationSource,
            context.frameId,
            context.deviceGeneration,
            stagedRevision
        );
        stampGpuSourceIdentity(
            this.shieldInteractionSource,
            context.frameId,
            context.deviceGeneration,
            stagedRevision
        );
        this.shieldInteractionSource.generation = context.deviceGeneration;
        this.encodeOutput.frameId = context.frameId;
        this.encodeOutput.deviceGeneration = context.deviceGeneration;
        this.encodeOutput.revision = stagedRevision;
        this.lastEncodedFrameId = context.frameId;
        this.encodeCount += 1;
        return this.encodeOutput;
    }

    /** composer submit/abort 결과에 맞춰 host queue를 원자적으로 consume하거나 보존합니다. */
    finishFrame(outcome, frameId) {
        const frame = this.activeFrame;
        if (!frame || frame.frameId !== frameId) {
            throw new Error('title GPU simulation frame completion identity가 일치하지 않습니다.');
        }
        if (outcome === 'committed') {
            this.pendingSpawns.splice(0, frame.spawnCount);
            this.pendingFixedSteps.splice(0, frame.fixedCount);
            this.pendingJournal.splice(0, frame.journalCount);
            if (this.resizeRevision === frame.resizeRevision) {
                this.pendingResizeX = 1;
                this.pendingResizeY = 1;
            } else {
                this.pendingResizeX /= frame.resizeX;
                this.pendingResizeY /= frame.resizeY;
            }
            this.lastCommittedFrameId = frameId;
            this.commitCount += 1;
        } else if (outcome === 'aborted') {
            this.abortCount += 1;
        } else {
            throw new TypeError('title GPU simulation outcome은 committed 또는 aborted여야 합니다.');
        }
        this.activeFrame = null;
        if (this.destroyPending) {
            this.#releaseResources();
        }
        return true;
    }

    getShieldInteractionSource() {
        if (!this.resources) return null;
        return this.shieldInteractionSource;
    }

    getDiagnostics() {
        return Object.freeze({
            destroyed: this.destroyed,
            destroyPending: this.destroyPending,
            deviceGeneration: this.deviceGeneration,
            pendingSpawnCount: this.pendingSpawns.length,
            pendingFixedStepCount: this.pendingFixedSteps.length,
            pendingJournalCount: this.pendingJournal.length,
            queueOverflowed: this.queueOverflowed,
            failedClosed: this.failedClosed,
            lastFailureReason: this.lastFailureReason,
            activeFrameId: this.activeFrame?.frameId ?? null,
            lastEncodedFrameId: this.lastEncodedFrameId,
            lastCommittedFrameId: this.lastCommittedFrameId,
            encodeCount: this.encodeCount,
            commitCount: this.commitCount,
            abortCount: this.abortCount,
            spawnQueuedCount: this.spawnQueuedCount,
            fixedQueuedCount: this.fixedQueuedCount,
            collisionPassCount: COLLISION_PASS_COUNT,
            cleanupFailureCount: this.cleanupFailureCount,
            normalReadbackCount: 0,
            ownsSubmit: false
        });
    }

    destroy() {
        if (this.destroyed) return false;
        this.destroyed = true;
        this.pendingSpawns.length = 0;
        this.pendingFixedSteps.length = 0;
        this.pendingJournal.length = 0;
        if (this.activeFrame) {
            this.destroyPending = true;
            return true;
        }
        this.#releaseResources();
        return true;
    }

    #buildFramePlan(journalCount) {
        const operations = [];
        let fixedBatchIndex = 0;
        let resizeBatchIndex = 0;
        let spawnBatchIndex = 0;
        let spawnStart = 0;
        for (let journalIndex = 0; journalIndex < journalCount; journalIndex++) {
            const source = this.pendingJournal[journalIndex];
            if (source.kind === 'fixed') {
                if (fixedBatchIndex >= MAX_PENDING_FIXED_STEPS) {
                    throw new Error('title GPU simulation fixed journal batch가 overflow되었습니다.');
                }
                operations.push({
                    kind: 'fixed',
                    batchIndex: fixedBatchIndex,
                    fixedStep: source.fixedStep
                });
                fixedBatchIndex += 1;
                continue;
            }
            if (source.kind === 'resize') {
                if (resizeBatchIndex >= MAX_PENDING_RESIZE_BATCHES) {
                    throw new Error('title GPU simulation resize journal batch가 overflow되었습니다.');
                }
                operations.push({
                    kind: 'resize',
                    batchIndex: resizeBatchIndex,
                    ratioX: source.ratioX,
                    ratioY: source.ratioY
                });
                resizeBatchIndex += 1;
                continue;
            }

            const previous = operations[operations.length - 1];
            const layerMask = 1 << source.spawn.layerIndex;
            if (previous?.kind === 'spawn') {
                previous.count += 1;
                previous.layerMask |= layerMask;
                previous.collisionLayerCount = countLayerMaskBits(previous.layerMask);
            } else {
                if (spawnBatchIndex >= MAX_PENDING_SPAWN_BATCHES) {
                    throw new Error('title GPU simulation spawn journal batch가 overflow되었습니다.');
                }
                operations.push({
                    kind: 'spawn',
                    batchIndex: spawnBatchIndex,
                    start: spawnStart,
                    count: 1,
                    layerMask,
                    collisionLayerCount: 1,
                    viewportWidth: source.spawn.viewportWidth,
                    viewportHeight: source.spawn.viewportHeight
                });
                spawnBatchIndex += 1;
            }
            spawnStart += 1;
        }
        return {
            operations,
            spawnCount: spawnStart,
            fixedCount: fixedBatchIndex,
            resizeCount: resizeBatchIndex,
            spawnBatchCount: spawnBatchIndex
        };
    }

    #uploadFrameInputs(device, framePlan) {
        const resources = this.resources;
        if (framePlan.spawnCount > 0) {
            this.#packSpawns(framePlan.spawnCount);
            device.queue.writeBuffer(
                resources.spawnBuffer,
                0,
                this.spawnUploadFloats,
                0,
                framePlan.spawnCount * TITLE_WEBGPU_ENEMY_SIMULATION_SPAWN_FLOATS
            );
        }
        for (const operation of framePlan.operations) {
            if (operation.kind === 'fixed') {
                const target = this.fixedUniforms[operation.batchIndex];
                this.#packFixedStep(operation.fixedStep, target);
                device.queue.writeBuffer(
                    resources.fixedUniformBuffers[operation.batchIndex],
                    0,
                    target
                );
            } else if (operation.kind === 'resize') {
                const target = this.resizeUniforms[operation.batchIndex];
                target[0] = operation.ratioX;
                target[1] = operation.ratioY;
                target[2] = 0;
                target[3] = 0;
                device.queue.writeBuffer(
                    resources.resizeUniformBuffer,
                    operation.batchIndex * UNIFORM_SLOT_BYTES,
                    target
                );
            } else {
                const target = this.spawnControls[operation.batchIndex];
                target[0] = operation.count;
                target[1] = this.targetPerLayer;
                target[2] = operation.start;
                target[3] = 0;
                device.queue.writeBuffer(
                    resources.spawnControlBuffer,
                    operation.batchIndex * UNIFORM_SLOT_BYTES,
                    target
                );
                this.#packCollisionOnlyStep(operation, this.collisionOnlyUniform);
                device.queue.writeBuffer(
                    resources.collisionOnlyUniformBuffer,
                    operation.batchIndex * UNIFORM_SLOT_BYTES,
                    this.collisionOnlyUniform
                );
            }
        }

        const presentation = this.presentationState;
        this.presentationUniform[0] = presentation.width;
        this.presentationUniform[1] = presentation.height;
        this.presentationUniform[2] = presentation.objectOffsetY;
        this.presentationUniform[3] = presentation.interpolationAlpha;
        device.queue.writeBuffer(resources.presentationUniformBuffer, 0, this.presentationUniform);
        this.shieldUniform[0] = presentation.shieldCenterX;
        this.shieldUniform[1] = presentation.shieldCenterY;
        this.shieldUniform[2] = presentation.shieldRadius;
        this.shieldUniform[3] = presentation.frameDelta;
        this.shieldUniform[4] = presentation.interpolationAlpha;
        this.shieldUniform[5] = presentation.objectOffsetY;
        this.shieldUniform[6] = presentation.height;
        this.shieldUniform[7] = 3;
        device.queue.writeBuffer(resources.shieldUniformBuffer, 0, this.shieldUniform);
    }

    #packSpawns(spawnCount) {
        const floats = this.spawnUploadFloats;
        const uints = this.spawnUploadUints;
        for (let index = 0; index < spawnCount; index++) {
            const spawn = this.pendingSpawns[index];
            const offset = index * TITLE_WEBGPU_ENEMY_SIMULATION_SPAWN_FLOATS;
            floats[offset] = spawn.positionX;
            floats[offset + 1] = spawn.positionY;
            floats[offset + 2] = spawn.speedX;
            floats[offset + 3] = spawn.speedY;
            floats[offset + 4] = spawn.baseSpeedX;
            floats[offset + 5] = spawn.baseSpeedY;
            floats[offset + 6] = spawn.burstX;
            floats[offset + 7] = spawn.burstY;
            floats[offset + 8] = spawn.burstDecayRate;
            floats[offset + 9] = spawn.rotationRadians;
            floats[offset + 10] = spawn.angularVelocityRadians;
            floats[offset + 11] = spawn.collisionGrace;
            floats[offset + 12] = spawn.width;
            floats[offset + 13] = spawn.height;
            floats[offset + 14] = spawn.alpha;
            floats[offset + 15] = spawn.collisionRadius;
            uints[offset + 16] = spawn.layerIndex;
            uints[offset + 17] = spawn.shapeCode;
            uints[offset + 18] = spawn.incarnation;
            uints[offset + 19] = 1;
            floats[offset + 20] = spawn.magneticScale;
            floats[offset + 21] = spawn.size;
            floats[offset + 22] = 0;
            floats[offset + 23] = 0;
        }
    }

    #packFixedStep(step, target) {
        const mouseStrength = step.objectFocused
            ? (step.leftPressing ? 5 : 2)
            : 0;
        const mouseDistance = step.objectFocused
            ? step.uiww * (step.leftPressing ? 0.1 : 0.05)
            : 0;
        target[0] = step.delta;
        target[1] = step.uiww;
        target[2] = mouseStrength;
        target[3] = mouseDistance;
        target[4] = step.mouseX;
        target[5] = step.mouseY;
        target[6] = step.logoX;
        target[7] = step.logoY;
        target[8] = 4;
        target[9] = step.logoDistance;
        target[10] = step.hasMouse && step.objectFocused ? 1 : 0;
        target[11] = step.hasLogo ? 1 : 0;
        target[12] = step.viewportWidth;
        target[13] = step.viewportHeight;
        target[14] = 0.1;
        target[15] = 1;
    }

    #packCollisionOnlyStep(operation, target) {
        target.fill(0);
        target[12] = operation.viewportWidth;
        target[13] = operation.viewportHeight;
        target[14] = 0.1;
        target[15] = 0;
        target[10] = operation.layerMask;
    }

    #ensureGeneration(device, deviceGeneration) {
        if (this.deviceGeneration !== null) {
            if (deviceGeneration < this.deviceGeneration) {
                throw this.#latchFailure('stale title GPU simulation device generation입니다.');
            }
            if (deviceGeneration === this.deviceGeneration) {
                if (device !== this.device) {
                    throw this.#latchFailure('generation 변경 없는 title GPU simulation device drift입니다.');
                }
                return;
            }
            throw this.#latchFailure(
                'title GPU simulation device generation 변경에는 CPU epoch fallback이 필요합니다.'
            );
        }
        let resources;
        try {
            resources = this.#createResources(device);
        } catch (error) {
            this.failedClosed = true;
            this.lastFailureReason = `resource-create-failed:${error?.message ?? String(error)}`;
            throw error;
        }
        this.device = device;
        this.deviceGeneration = deviceGeneration;
        this.resources = resources;
        this.presentationPacket.gpuSourceBuffer = this.resources.presentationBuffer;
        this.presentationSource.gpuSourceBuffer = this.resources.presentationBuffer;
        this.encodeOutput.shieldInteractionBuffer = this.resources.shieldInteractionBuffer;
        this.shieldInteractionSource.gpuSourceBuffer = this.resources.shieldInteractionBuffer;
    }

    #createResources(device) {
        const createdBuffers = [];
        const createOwnedBuffer = (label, size, usage) => {
            const buffer = createBuffer(device, label, size, usage);
            createdBuffers.push(buffer);
            return buffer;
        };
        try {
        const buffers = {
            bodyBuffer: createOwnedBuffer('title-gpu-sim-bodies', BODY_BUFFER_BYTES, BUFFER_USAGE_STORAGE),
            spawnBuffer: createOwnedBuffer(
                'title-gpu-sim-spawns',
                SPAWN_BUFFER_BYTES,
                BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST
            ),
            spawnControlBuffer: createOwnedBuffer(
                'title-gpu-sim-spawn-control',
                MAX_PENDING_SPAWN_BATCHES * UNIFORM_SLOT_BYTES,
                BUFFER_USAGE_UNIFORM | BUFFER_USAGE_COPY_DST
            ),
            resizeUniformBuffer: createOwnedBuffer(
                'title-gpu-sim-resize',
                MAX_PENDING_RESIZE_BATCHES * UNIFORM_SLOT_BYTES,
                BUFFER_USAGE_UNIFORM | BUFFER_USAGE_COPY_DST
            ),
            collisionOnlyUniformBuffer: createOwnedBuffer(
                'title-gpu-sim-collision-only',
                MAX_PENDING_SPAWN_BATCHES * UNIFORM_SLOT_BYTES,
                BUFFER_USAGE_UNIFORM | BUFFER_USAGE_COPY_DST
            ),
            correctionBuffer: createOwnedBuffer('title-gpu-sim-corrections', CORRECTION_BUFFER_BYTES, BUFFER_USAGE_STORAGE),
            presentationBuffer: createOwnedBuffer(
                'title-gpu-sim-presentation',
                PRESENTATION_RECORD_BUFFER_BYTES,
                BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_SRC
            ),
            presentationUniformBuffer: createOwnedBuffer('title-gpu-sim-presentation-uniform', 16, BUFFER_USAGE_UNIFORM | BUFFER_USAGE_COPY_DST),
            shieldInteractionBuffer: createOwnedBuffer(
                'title-gpu-sim-shield-interactions',
                TITLE_WEBGPU_SHIELD_INTERACTION_ABI.BYTE_SIZE,
                BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_SRC
            ),
            shieldWinnerBuffer: createOwnedBuffer(
                'title-gpu-sim-shield-winners',
                32,
                BUFFER_USAGE_STORAGE
            ),
            shieldUniformBuffer: createOwnedBuffer('title-gpu-sim-shield-uniform', 32, BUFFER_USAGE_UNIFORM | BUFFER_USAGE_COPY_DST),
            fixedUniformBuffers: Array.from(
                { length: MAX_PENDING_FIXED_STEPS },
                (_, index) => createOwnedBuffer(
                    `title-gpu-sim-fixed:${index}`,
                    TITLE_WEBGPU_ENEMY_SIMULATION_FIXED_BYTES,
                    BUFFER_USAGE_UNIFORM | BUFFER_USAGE_COPY_DST
                )
            )
        };
        const shaderModule = device.createShaderModule({
            label: 'title-webgpu-enemy-simulation-shader',
            code: TITLE_WEBGPU_ENEMY_SIMULATION_SHADER
        });
        const pipelines = {};
        for (const [name, entryPoint] of Object.entries(PIPELINE_ENTRIES)) {
            pipelines[name] = device.createComputePipeline({
                label: `title-webgpu-enemy-simulation-pipeline:${name}`,
                layout: 'auto',
                compute: { module: shaderModule, entryPoint }
            });
        }
        const bindGroups = {
            spawn: Array.from(
                { length: MAX_PENDING_SPAWN_BATCHES },
                (_, index) => createBindGroup(device, pipelines.spawn, [
                    [0, buffers.bodyBuffer],
                    [1, buffers.spawnBuffer],
                    [2, buffers.spawnControlBuffer, index * UNIFORM_SLOT_BYTES, 16]
                ])
            ),
            resize: Array.from(
                { length: MAX_PENDING_RESIZE_BATCHES },
                (_, index) => createBindGroup(device, pipelines.resize, [
                    [0, buffers.bodyBuffer],
                    [3, buffers.resizeUniformBuffer, index * UNIFORM_SLOT_BYTES, 16]
                ])
            ),
            fixed: buffers.fixedUniformBuffers.map((buffer) => createBindGroup(
                device,
                pipelines.integrate,
                [[0, buffers.bodyBuffer], [4, buffer], [10, buffers.shieldWinnerBuffer]]
            )),
            collisionOnly: Array.from(
                { length: MAX_PENDING_SPAWN_BATCHES },
                (_, index) => createBindGroup(device, pipelines.integrate, [
                    [0, buffers.bodyBuffer],
                    [4, buffers.collisionOnlyUniformBuffer, index * UNIFORM_SLOT_BYTES, 64],
                    [10, buffers.shieldWinnerBuffer]
                ])
            ),
            collision: createBindGroup(device, pipelines.collision, [
                [0, buffers.bodyBuffer],
                [5, buffers.correctionBuffer]
            ]),
            applyCollision: createBindGroup(device, pipelines.applyCollision, [
                [0, buffers.bodyBuffer],
                [5, buffers.correctionBuffer]
            ]),
            presentation: createBindGroup(device, pipelines.presentation, [
                [0, buffers.bodyBuffer],
                [6, buffers.presentationBuffer],
                [7, buffers.presentationUniformBuffer],
                [8, buffers.shieldInteractionBuffer],
                [9, buffers.shieldUniformBuffer]
            ]),
            shieldClear: createBindGroup(device, pipelines.shieldClear, [
                [0, buffers.bodyBuffer],
                [8, buffers.shieldInteractionBuffer],
                [9, buffers.shieldUniformBuffer],
                [10, buffers.shieldWinnerBuffer]
            ])
        };
        return { ...buffers, shaderModule, pipelines, bindGroups };
        } catch (error) {
            for (const buffer of createdBuffers) {
                try {
                    buffer?.destroy?.();
                } catch {
                    this.cleanupFailureCount += 1;
                }
            }
            throw error;
        }
    }

    #releaseResources() {
        const resources = this.resources;
        if (resources) {
            for (const resource of [
                resources.bodyBuffer,
                resources.spawnBuffer,
                resources.spawnControlBuffer,
                resources.resizeUniformBuffer,
                resources.collisionOnlyUniformBuffer,
                resources.correctionBuffer,
                resources.presentationBuffer,
                resources.presentationUniformBuffer,
                resources.shieldInteractionBuffer,
                resources.shieldWinnerBuffer,
                resources.shieldUniformBuffer,
                ...resources.fixedUniformBuffers
            ]) {
                try {
                    resource?.destroy?.();
                } catch {
                    this.cleanupFailureCount += 1;
                }
            }
        }
        this.resources = null;
        this.presentationPacket.gpuSourceBuffer = null;
        this.presentationPacket.frameId = null;
        this.presentationPacket.deviceGeneration = null;
        this.presentationPacket.revision = this.commitCount;
        clearGpuSourceIdentity(this.presentationSource, this.commitCount);
        this.presentationSource.gpuSourceBuffer = null;
        this.encodeOutput.shieldInteractionBuffer = null;
        clearGpuSourceIdentity(this.shieldInteractionSource, this.commitCount);
        this.shieldInteractionSource.gpuSourceBuffer = null;
        this.shieldInteractionSource.generation = null;
        this.encodeOutput.frameId = null;
        this.encodeOutput.deviceGeneration = null;
        this.encodeOutput.revision = this.commitCount;
        this.device = null;
        this.deviceGeneration = null;
        this.destroyPending = false;
    }

    #assertContext(context) {
        if (this.destroyed) {
            throw new Error('destroy된 title GPU simulation은 encode할 수 없습니다.');
        }
        if (this.failedClosed) {
            throw new Error(`fail-closed title GPU simulation입니다: ${this.lastFailureReason}`);
        }
        for (const methodName of [
            'createBuffer',
            'createShaderModule',
            'createComputePipeline',
            'createBindGroup'
        ]) {
            if (typeof context?.device?.[methodName] !== 'function') {
                throw new TypeError(`title GPU simulation device.${methodName}()가 필요합니다.`);
            }
        }
        if (typeof context?.device?.queue?.writeBuffer !== 'function') {
            throw new TypeError('title GPU simulation device.queue.writeBuffer()가 필요합니다.');
        }
        if (!Number.isSafeInteger(context?.deviceGeneration) || context.deviceGeneration < 0) {
            throw new RangeError('title GPU simulation deviceGeneration이 필요합니다.');
        }
        if (!Number.isSafeInteger(context?.frameId) || context.frameId < 0) {
            throw new RangeError('title GPU simulation frameId가 필요합니다.');
        }
        if (typeof context?.encoder?.beginComputePass !== 'function') {
            throw new TypeError('title GPU simulation에는 composer encoder가 필요합니다.');
        }
    }

    #nextIncarnation() {
        const value = this.nextIncarnation;
        this.nextIncarnation = value >= 0xffffffff ? 1 : value + 1;
        return value;
    }

    #latchFailure(reason) {
        this.failedClosed = true;
        this.lastFailureReason = reason;
        return new Error(reason);
    }
}

function createBuffer(device, label, size, usage) {
    return device.createBuffer({ label, size, usage });
}

function createBindGroup(device, pipeline, bindings) {
    return device.createBindGroup({
        label: `${pipeline.label ?? 'title-gpu-sim'}:bind-group`,
        layout: pipeline.getBindGroupLayout(0),
        entries: bindings.map(([binding, buffer, offset = 0, size = undefined]) => ({
            binding,
            resource: size === undefined
                ? { buffer, offset }
                : { buffer, offset, size }
        }))
    });
}

function encodeDispatch(pass, pipeline, bindGroup, workgroupCount) {
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupCount);
}

function resolveShapeCode(shapeType, styleCode) {
    if (Number.isInteger(styleCode)) {
        const shapeCode = styleCode & 0x7;
        return shapeCode < TITLE_CPU_ENEMY_STYLE_TYPES.length ? shapeCode : -1;
    }
    return TITLE_CPU_ENEMY_STYLE_TYPES.indexOf(shapeType);
}

function finite(value, fallback) {
    return Number.isFinite(value) ? Number(value) : fallback;
}

function positiveFinite(value, fallback) {
    return Number.isFinite(value) && value > 0 ? Number(value) : fallback;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function clampInteger(value, min, max, fallback) {
    return Number.isInteger(value) ? clamp(value, min, max) : fallback;
}

function countLayerMaskBits(mask) {
    let value = mask >>> 0;
    let count = 0;
    while (value !== 0) {
        value &= value - 1;
        count += 1;
    }
    return count;
}

function stampGpuSourceIdentity(source, frameId, deviceGeneration, revision) {
    source.frameId = frameId;
    source.deviceGeneration = deviceGeneration;
    source.revision = revision;
}

function clearGpuSourceIdentity(source, revision) {
    source.frameId = null;
    source.deviceGeneration = null;
    source.revision = revision;
}
