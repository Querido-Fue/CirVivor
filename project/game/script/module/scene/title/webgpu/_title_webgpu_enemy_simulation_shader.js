import {
    TITLE_WEBGPU_SHIELD_INTERACTION_MAX_DENTS,
    TITLE_WEBGPU_SHIELD_INTERACTION_MAX_IMPACTS
} from './_title_webgpu_shield_interaction_abi.js';

export const TITLE_WEBGPU_ENEMY_SIMULATION_CAPACITY = 420;
export const TITLE_WEBGPU_ENEMY_SIMULATION_LAYER_CAPACITY = 140;
export const TITLE_WEBGPU_ENEMY_SIMULATION_LAYER_COUNT = 3;
export const TITLE_WEBGPU_ENEMY_SIMULATION_WORKGROUP_SIZE = 64;
export const TITLE_WEBGPU_ENEMY_SIMULATION_COLLISION_WORKGROUP_SIZE = 160;
export const TITLE_WEBGPU_ENEMY_SIMULATION_RECORD_COUNT = 840;
export const TITLE_WEBGPU_ENEMY_SIMULATION_BODY_BYTES = 128;
export const TITLE_WEBGPU_ENEMY_SIMULATION_SPAWN_FLOATS = 24;
export const TITLE_WEBGPU_ENEMY_SIMULATION_SPAWN_BYTES = 96;
export const TITLE_WEBGPU_ENEMY_SIMULATION_FIXED_FLOATS = 16;
export const TITLE_WEBGPU_ENEMY_SIMULATION_FIXED_BYTES = 64;
export const TITLE_WEBGPU_ENEMY_SIMULATION_ACTIVE_DENT_COUNT = 8;

/**
 * 420-slot title body state를 compute에서 갱신하고 기존 32-byte enemy record 및
 * 464-byte shield interaction ABI로 투영하는 WGSL입니다.
 */
export const TITLE_WEBGPU_ENEMY_SIMULATION_SHADER = `
    const BODY_CAPACITY: u32 = ${TITLE_WEBGPU_ENEMY_SIMULATION_CAPACITY}u;
    const LAYER_CAPACITY: u32 = ${TITLE_WEBGPU_ENEMY_SIMULATION_LAYER_CAPACITY}u;
    const LAYER_COUNT: u32 = ${TITLE_WEBGPU_ENEMY_SIMULATION_LAYER_COUNT}u;
    const RECORD_COUNT: u32 = ${TITLE_WEBGPU_ENEMY_SIMULATION_RECORD_COUNT}u;
    const MAX_IMPACTS: u32 = ${TITLE_WEBGPU_SHIELD_INTERACTION_MAX_IMPACTS}u;
    const MAX_DENTS: u32 = ${TITLE_WEBGPU_SHIELD_INTERACTION_MAX_DENTS}u;
    const MAX_ACTIVE_DENTS: u32 = ${TITLE_WEBGPU_ENEMY_SIMULATION_ACTIVE_DENT_COUNT}u;
    const PI: f32 = 3.141592653589793;
    const HALF_PI: f32 = 1.5707963267948966;

    struct BodyState {
        positionPrevious: vec4<f32>,
        velocityBase: vec4<f32>,
        magneticBurst: vec4<f32>,
        sizeRotation: vec4<f32>,
        visual: vec4<f32>,
        metadata: vec4<u32>,
        response: vec4<f32>,
        shield: vec4<f32>,
    };

    struct SpawnCommand {
        positionSpeed: vec4<f32>,
        baseBurstX: vec4<f32>,
        burstRotation: vec4<f32>,
        visual: vec4<f32>,
        metadata: vec4<u32>,
        response: vec4<f32>,
    };

    struct FixedParameters {
        timingAndMouse: vec4<f32>,
        points: vec4<f32>,
        logoAndFlags: vec4<f32>,
        viewport: vec4<f32>,
    };

    struct PresentationRecord {
        positionAndSize: vec4<f32>,
        rotationAlphaStyle: vec4<f32>,
    };

    struct ShieldInteractions {
        counts: array<atomic<u32>, 4>,
        impacts: array<vec4<f32>, ${TITLE_WEBGPU_SHIELD_INTERACTION_MAX_IMPACTS}>,
        dents: array<vec4<f32>, ${TITLE_WEBGPU_SHIELD_INTERACTION_MAX_DENTS}>,
    };

    @group(0) @binding(0) var<storage, read_write> bodies: array<BodyState>;
    @group(0) @binding(1) var<storage, read> spawnCommands: array<SpawnCommand>;
    @group(0) @binding(2) var<uniform> spawnControl: vec4<u32>;
    @group(0) @binding(3) var<uniform> resizeParameters: vec4<f32>;
    @group(0) @binding(4) var<uniform> fixedParameters: FixedParameters;
    @group(0) @binding(5) var<storage, read_write> corrections: array<vec4<f32>>;
    @group(0) @binding(6) var<storage, read_write> presentationRecords: array<PresentationRecord>;
    @group(0) @binding(7) var<uniform> presentationParameters: vec4<f32>;
    @group(0) @binding(8) var<storage, read_write> shieldInteractions: ShieldInteractions;
    @group(0) @binding(9) var<uniform> shieldParameters: array<vec4<f32>, 2>;
    @group(0) @binding(10) var<storage, read_write> shieldWinnerKeys: array<atomic<u32>, 8>;
    var<workgroup> collisionBodyCache: array<vec4<f32>, ${TITLE_WEBGPU_ENEMY_SIMULATION_LAYER_CAPACITY}>;
    var<workgroup> collisionCorrectionCache: array<vec2<f32>, ${TITLE_WEBGPU_ENEMY_SIMULATION_LAYER_CAPACITY}>;
    var<workgroup> collisionCorrectionX: array<atomic<i32>, ${TITLE_WEBGPU_ENEMY_SIMULATION_LAYER_CAPACITY}>;
    var<workgroup> collisionCorrectionY: array<atomic<i32>, ${TITLE_WEBGPU_ENEMY_SIMULATION_LAYER_CAPACITY}>;
    var<workgroup> collisionContactCount: array<atomic<u32>, ${TITLE_WEBGPU_ENEMY_SIMULATION_LAYER_CAPACITY}>;
    var<workgroup> collisionGridHeads: array<atomic<i32>, 144>;
    var<workgroup> collisionGridNext: array<i32, ${TITLE_WEBGPU_ENEMY_SIMULATION_LAYER_CAPACITY}>;
    var<workgroup> collisionMaxRadiusBits: atomic<u32>;

    fn layer_softness_scale(layer: u32) -> f32 {
        return select(select(1.14 * 1.035, 1.06 * 1.035, layer == 1u), 1.02 * 1.035, layer == 2u);
    }

    fn layer_softness_alpha(layer: u32) -> f32 {
        return select(select(0.16 * 2.2, 0.08 * 2.2, layer == 1u), 0.03 * 2.2, layer == 2u);
    }

    fn layer_softness_offset(layer: u32) -> f32 {
        return select(select(1.4 * 0.25, 0.7 * 0.25, layer == 1u), 0.2 * 0.25, layer == 2u);
    }

    fn wrap_angle(value: f32) -> f32 {
        return value - (floor((value + PI) / (2.0 * PI)) * (2.0 * PI));
    }

    fn fast_smoothing_factor(value: f32) -> f32 {
        let x = clamp(value, 0.0, 0.5);
        let x2 = x * x;
        return x - (0.5 * x2) + ((x2 * x) / 6.0) - ((x2 * x2) / 24.0);
    }

    fn fast_asin_unit(value: f32) -> f32 {
        let x = clamp(value, 0.0, 1.0);
        let polynomial = 1.5707288
            + (x * (-0.2121144 + (x * (0.0742610 - (x * 0.0187293)))));
        return HALF_PI - (sqrt(max(0.0, 1.0 - x)) * polynomial);
    }

    fn fast_atan2(y: f32, x: f32) -> f32 {
        let absoluteX = abs(x);
        let absoluteY = abs(y);
        let maximum = max(absoluteX, absoluteY);
        if (maximum <= 0.00000001) {
            return 0.0;
        }
        let ratio = min(absoluteX, absoluteY) / maximum;
        let ratioSquared = ratio * ratio;
        var angle = (((-0.0464964749 * ratioSquared + 0.15931422)
            * ratioSquared - 0.327622764) * ratioSquared * ratio) + ratio;
        if (absoluteY > absoluteX) {
            angle = HALF_PI - angle;
        }
        if (x < 0.0) {
            angle = PI - angle;
        }
        return select(angle, -angle, y < 0.0);
    }

    fn heading_delta(shape: u32, current: f32, targetAngle: f32) -> f32 {
        var best = wrap_angle(targetAngle - current);
        var symmetry = 2.0 * PI;
        if (shape == 1u) {
            symmetry = (2.0 * PI) / 3.0;
        } else if (shape == 5u) {
            symmetry = PI;
        }
        if (symmetry < (2.0 * PI)) {
            let turns = u32(round((2.0 * PI) / symmetry));
            for (var index: u32 = 1u; index < turns; index += 1u) {
                let candidate = wrap_angle((targetAngle + (f32(index) * symmetry)) - current);
                if (abs(candidate) < abs(best)) {
                    best = candidate;
                }
            }
        }
        return best;
    }

    fn magnetic_impulse(
        position: vec2<f32>,
        point: vec2<f32>,
        strength: f32,
        distanceLimit: f32,
        delta: f32,
        motionScale: f32
    ) -> vec2<f32> {
        let offset = position - point;
        let distanceSquared = dot(offset, offset);
        let limitSquared = distanceLimit * distanceLimit;
        if (strength <= 0.0 || distanceLimit <= 0.0 || distanceSquared <= 0.000001 || distanceSquared >= limitSquared) {
            return vec2<f32>(0.0);
        }
        let distance = sqrt(distanceSquared);
        let normalized = (distanceLimit - distance) / distanceLimit;
        let falloff = normalized * normalized * normalized;
        return (offset / distance) * strength * falloff * motionScale * delta * 1400.0;
    }

    fn release_title_shield_slot(bodyIndex: u32, slotCode: u32) {
        if (slotCode == 0u || slotCode > MAX_ACTIVE_DENTS) {
            return;
        }
        let slotIndex = slotCode - 1u;
        let ownerCode = bodyIndex + 1u;
        if (atomicLoad(&shieldWinnerKeys[slotIndex]) == ownerCode) {
            atomicStore(&shieldWinnerKeys[slotIndex], 0u);
        }
    }

    fn update_fixed_shield_state(
        inputBody: BodyState,
        bodyIndex: u32,
        position: vec2<f32>,
        delta: f32
    ) -> BodyState {
        var body = inputBody;
        var slotCode = u32(clamp(body.shield.w, 0.0, f32(MAX_ACTIVE_DENTS)));
        if (body.response.x <= 0.0 || fixedParameters.logoAndFlags.w <= 0.5) {
            release_title_shield_slot(bodyIndex, slotCode);
            body.response = vec4<f32>(body.response.xy, 0.0, 0.0);
            body.shield = vec4<f32>(0.0);
            return body;
        }
        let radius = max(0.0, fixedParameters.logoAndFlags.y / 2.25);
        if (radius <= 0.0) {
            release_title_shield_slot(bodyIndex, slotCode);
            body.response = vec4<f32>(body.response.xy, 0.0, 0.0);
            body.shield = vec4<f32>(0.0);
            return body;
        }
        let offset = position - fixedParameters.points.zw;
        let distanceSquared = dot(offset, offset);
        if (distanceSquared <= 0.00000001) {
            release_title_shield_slot(bodyIndex, slotCode);
            body.response = vec4<f32>(body.response.xy, 0.0, 0.0);
            body.shield = vec4<f32>(0.0);
            return body;
        }
        let enemyRadius = max(body.visual.x, body.visual.y) * 0.5;
        let maxRelevantDistance = radius + enemyRadius + 64.8;
        if (distanceSquared > (maxRelevantDistance * maxRelevantDistance)
            && body.response.z <= 0.001
            && body.response.w <= 0.001
            && body.shield.x <= 0.5
            && body.shield.z >= 0.0
            && slotCode == 0u) {
            return body;
        }
        let distance = sqrt(distanceSquared);
        var boundary = distance - radius - enemyRadius;
        if (abs(boundary) <= 4.0) {
            boundary = 0.0;
        }
        let wasContacting = body.shield.x > 0.5;
        let contactRange = 28.0 + select(0.0, 8.0, wasContacting);
        let contacting = abs(boundary) <= contactRange;
        let targetPressure = clamp((54.0 - boundary) / max(1.0, 54.0 + enemyRadius), 0.0, 1.0);
        let targetVisual = clamp((64.8 - boundary) / max(1.0, 64.8 + enemyRadius), 0.0, 1.0);
        let angle = fast_atan2(offset.y, offset.x);
        var shieldAngle = body.shield.y;
        let angleInitialized = abs(body.shield.z) > 0.5;
        if (!angleInitialized) {
            shieldAngle = angle;
        } else {
            let visualDelta = min(delta, 1.0 / 30.0);
            shieldAngle += wrap_angle(angle - shieldAngle)
                * fast_smoothing_factor(visualDelta * 14.0);
        }
        let impactPending = body.shield.z < -0.5 || (contacting && !wasContacting);
        let encodedAngleState = select(1.0, -1.0, impactPending);

        let needsPersistentSlot = contacting || targetVisual > 0.0 || body.response.w > 0.001;
        if (slotCode == 0u && needsPersistentSlot) {
            let ownerCode = bodyIndex + 1u;
            for (var slotIndex: u32 = 0u; slotIndex < MAX_ACTIVE_DENTS; slotIndex += 1u) {
                if (atomicLoad(&shieldWinnerKeys[slotIndex]) != 0u) {
                    continue;
                }
                let result = atomicCompareExchangeWeak(
                    &shieldWinnerKeys[slotIndex],
                    0u,
                    ownerCode
                );
                if (result.exchanged || result.old_value == ownerCode) {
                    slotCode = slotIndex + 1u;
                    break;
                }
            }
        }
        if (slotCode == 0u) {
            body.response = vec4<f32>(body.response.xy, 0.0, 0.0);
            body.shield = vec4<f32>(
                select(0.0, 1.0, contacting),
                shieldAngle,
                encodedAngleState,
                0.0
            );
            return body;
        }
        let pressureRate = select(5.5, 12.0, targetPressure >= body.response.z);
        let visualRate = select(5.5, 12.0, targetVisual >= body.response.w);
        let visualDelta = min(delta, 1.0 / 30.0);
        let pressure = body.response.z
            + ((targetPressure - body.response.z)
                * fast_smoothing_factor(visualDelta * pressureRate));
        let visualStrength = body.response.w
            + ((targetVisual - body.response.w)
                * fast_smoothing_factor(visualDelta * visualRate));
        if (visualStrength <= 0.001
            && targetVisual <= 0.0
            && !contacting
            && slotCode > 0u) {
            release_title_shield_slot(bodyIndex, slotCode);
            slotCode = 0u;
        }
        body.response = vec4<f32>(body.response.xy, pressure, visualStrength);
        body.shield = vec4<f32>(
            select(0.0, 1.0, contacting),
            shieldAngle,
            encodedAngleState,
            f32(slotCode)
        );
        return body;
    }

    @compute @workgroup_size(1)
    fn spawn_title_bodies() {
        let commandCount = min(spawnControl.x, BODY_CAPACITY);
        let targetPerLayer = min(spawnControl.y, LAYER_CAPACITY);
        for (var commandIndex: u32 = 0u; commandIndex < commandCount; commandIndex += 1u) {
            let command = spawnCommands[spawnControl.z + commandIndex];
            let layer = min(command.metadata.x, LAYER_COUNT - 1u);
            let partitionStart = layer * LAYER_CAPACITY;
            var activeCount: u32 = 0u;
            var freeSlot: u32 = BODY_CAPACITY;
            for (var localIndex: u32 = 0u; localIndex < LAYER_CAPACITY; localIndex += 1u) {
                let slot = partitionStart + localIndex;
                if (bodies[slot].metadata.x != 0u) {
                    activeCount += 1u;
                } else if (freeSlot == BODY_CAPACITY) {
                    freeSlot = slot;
                }
            }
            if (activeCount >= targetPerLayer || freeSlot >= BODY_CAPACITY) {
                continue;
            }

            var body: BodyState;
            body.positionPrevious = vec4<f32>(
                command.positionSpeed.xy,
                command.positionSpeed.xy
            );
            body.velocityBase = vec4<f32>(
                command.positionSpeed.zw,
                command.baseBurstX.xy
            );
            body.magneticBurst = vec4<f32>(
                0.0,
                0.0,
                command.baseBurstX.zw
            );
            body.sizeRotation = vec4<f32>(
                command.response.y,
                command.burstRotation.y,
                command.burstRotation.z,
                command.burstRotation.w
            );
            body.visual = command.visual;
            body.metadata = vec4<u32>(
                1u,
                layer,
                min(command.metadata.y, 6u),
                command.metadata.z
            );
            body.response = vec4<f32>(command.response.x, command.burstRotation.x, 0.0, 0.0);
            body.shield = vec4<f32>(0.0);
            bodies[freeSlot] = body;
        }
    }

    @compute @workgroup_size(${TITLE_WEBGPU_ENEMY_SIMULATION_WORKGROUP_SIZE})
    fn resize_title_bodies(@builtin(global_invocation_id) globalId: vec3<u32>) {
        let index = globalId.x;
        if (index >= BODY_CAPACITY || bodies[index].metadata.x == 0u) {
            return;
        }
        var body = bodies[index];
        let ratio = max(resizeParameters.xy, vec2<f32>(0.0001));
        body.positionPrevious = vec4<f32>(
            body.positionPrevious.xy * ratio,
            body.positionPrevious.zw * ratio
        );
        body.velocityBase = vec4<f32>(
            body.velocityBase.xy * ratio,
            body.velocityBase.zw * ratio
        );
        body.magneticBurst = vec4<f32>(
            body.magneticBurst.xy * ratio,
            body.magneticBurst.zw * ratio
        );
        body.visual = vec4<f32>(
            body.visual.x * ratio.y,
            body.visual.y * ratio.y,
            body.visual.z,
            body.visual.w * ratio.y
        );
        bodies[index] = body;
    }

    fn integrate_body_state(inputBody: BodyState, bodyIndex: u32) -> BodyState {
        var body = inputBody;
        let delta = max(0.0, fixedParameters.timingAndMouse.x);
        var position = body.positionPrevious.xy;

        var magneticVelocity = body.magneticBurst.xy;
        if (fixedParameters.logoAndFlags.z > 0.5) {
            magneticVelocity += magnetic_impulse(
                position,
                fixedParameters.points.xy,
                fixedParameters.timingAndMouse.z,
                fixedParameters.timingAndMouse.w,
                delta,
                body.response.x
            );
        }
        if (fixedParameters.logoAndFlags.w > 0.5) {
            magneticVelocity += magnetic_impulse(
                position,
                fixedParameters.points.zw,
                fixedParameters.logoAndFlags.x,
                fixedParameters.logoAndFlags.y,
                delta,
                body.response.x
            );
        }

        let baseVelocity = body.velocityBase.zw;
        let burstVelocity = body.magneticBurst.zw;
        var targetVelocity = baseVelocity + burstVelocity + magneticVelocity;
        let baseMagnitude = length(baseVelocity);
        let burstInfluence = clamp(length(burstVelocity) / max(1.0, baseMagnitude), 0.0, 1.0);
        let speedCap = baseMagnitude * mix(1.7, 15.0, burstInfluence);
        let targetMagnitude = length(targetVelocity);
        if (speedCap > 0.0 && targetMagnitude > speedCap) {
            let overflow = (targetMagnitude - speedCap) * exp2(-(12.0 * delta));
            targetVelocity *= (speedCap + overflow) / targetMagnitude;
        }
        let response = 6.0 * mix(1.0, 3.5, burstInfluence);
        var velocity = body.velocityBase.xy;
        velocity += (targetVelocity - velocity) * response * delta;
        position += velocity * delta;

        magneticVelocity *= max(0.0, 1.0 - (delta * 6.0));
        let burstDecayRate = max(0.0, body.response.y);
        let decayedBurst = burstVelocity * exp2(-(burstDecayRate * delta));
        let nextBurst = vec2<f32>(
            select(decayedBurst.x, 0.0, abs(decayedBurst.x) < 0.01),
            select(decayedBurst.y, 0.0, abs(decayedBurst.y) < 0.01)
        );

        let shape = body.metadata.z;
        var rotation = body.sizeRotation.y + (body.sizeRotation.z * delta);
        if ((shape == 1u || shape == 2u || shape == 5u) && dot(velocity, velocity) >= 36.0) {
            let targetAngle = atan2(velocity.y, velocity.x) + HALF_PI;
            let angleDelta = heading_delta(shape, rotation, targetAngle);
            let damp = smoothstep(0.0, PI * 0.25, abs(angleDelta));
            let maxStep = (PI * 0.5) * damp * delta;
            rotation += clamp(angleDelta, -maxStep, maxStep);
        }

        body.positionPrevious = vec4<f32>(position, body.positionPrevious.xy);
        body.velocityBase = vec4<f32>(velocity, body.velocityBase.zw);
        body.magneticBurst = vec4<f32>(magneticVelocity, nextBurst);
        body.sizeRotation = vec4<f32>(
            body.sizeRotation.x,
            rotation,
            body.sizeRotation.z,
            max(0.0, body.sizeRotation.w - delta)
        );
        body = update_fixed_shield_state(body, bodyIndex, position, delta);

        let width = max(1.0, fixedParameters.viewport.x);
        let height = max(1.0, fixedParameters.viewport.y);
        let cullRatio = max(0.0, fixedParameters.viewport.z);
        let outside = position.x < -(width * cullRatio)
            || position.x > width * (1.0 + cullRatio)
            || position.y < -(height * cullRatio)
            || position.y > height * (1.0 + cullRatio);
        if (outside) {
            release_title_shield_slot(bodyIndex, u32(body.shield.w));
            body.metadata = vec4<u32>(0u, body.metadata.yzw);
            body.shield = vec4<f32>(0.0);
        }
        return body;
    }

    @compute @workgroup_size(${TITLE_WEBGPU_ENEMY_SIMULATION_WORKGROUP_SIZE})
    fn integrate_title_bodies(@builtin(global_invocation_id) globalId: vec3<u32>) {
        let index = globalId.x;
        if (index >= BODY_CAPACITY || bodies[index].metadata.x == 0u) {
            return;
        }
        bodies[index] = integrate_body_state(bodies[index], index);
    }

    fn calculate_cached_collision_correction(localIndex: u32, partitionStart: u32) -> vec2<f32> {
        let index = partitionStart + localIndex;
        let cachedBody = collisionBodyCache[localIndex];
        if (cachedBody.w <= 0.5) {
            return vec2<f32>(0.0);
        }
        let position = cachedBody.xy;
        let radius = cachedBody.z;
        var correction = vec2<f32>(0.0);
        var contacts: u32 = 0u;
        for (var otherLocalIndex: u32 = 0u; otherLocalIndex < LAYER_CAPACITY; otherLocalIndex += 1u) {
            if (otherLocalIndex == localIndex) {
                continue;
            }
            let other = collisionBodyCache[otherLocalIndex];
            if (other.w <= 0.5) {
                continue;
            }
            let otherIndex = partitionStart + otherLocalIndex;
            var offset = position - other.xy;
            var distanceSquared = dot(offset, offset);
            let combinedRadius = radius + other.z;
            if (distanceSquared >= combinedRadius * combinedRadius) {
                continue;
            }
            if (distanceSquared <= 0.000001) {
                let angle = f32((index * 37u + otherIndex * 17u) % 6283u) * 0.001;
                offset = vec2<f32>(cos(angle), sin(angle));
                distanceSquared = 1.0;
            }
            let distance = sqrt(distanceSquared);
            let penetration = max(0.0, combinedRadius - distance - 0.8);
            if (penetration <= 0.0) {
                continue;
            }
            correction += (offset / distance) * penetration * 0.275;
            contacts += 1u;
        }
        let correctionLength = length(correction);
        let maxCorrection = max(2.2, radius * 0.16) * min(2.4, 1.0 + (f32(contacts) * 0.06));
        if (correctionLength > maxCorrection && correctionLength > 0.000001) {
            correction *= maxCorrection / correctionLength;
        }
        return correction;
    }

    fn collision_layer_for_workgroup(workgroupIndex: u32) -> u32 {
        if (fixedParameters.viewport.w > 0.5) {
            return workgroupIndex;
        }
        let layerMask = u32(max(0.0, fixedParameters.logoAndFlags.z));
        var selectedLayer = 0u;
        var selectedRank = 0u;
        for (var candidateLayer: u32 = 0u; candidateLayer < LAYER_COUNT; candidateLayer += 1u) {
            if ((layerMask & (1u << candidateLayer)) == 0u) {
                continue;
            }
            if (selectedRank == workgroupIndex) {
                selectedLayer = candidateLayer;
                break;
            }
            selectedRank += 1u;
        }
        return selectedLayer;
    }

    @compute @workgroup_size(${TITLE_WEBGPU_ENEMY_SIMULATION_COLLISION_WORKGROUP_SIZE})
    fn accumulate_title_collisions(
        @builtin(local_invocation_index) localIndex: u32,
        @builtin(workgroup_id) workgroupId: vec3<u32>
    ) {
        let layer = workgroupId.x;
        let partitionStart = layer * LAYER_CAPACITY;
        if (localIndex < LAYER_CAPACITY) {
            let loadIndex = partitionStart + localIndex;
            let loadBody = bodies[loadIndex];
            let collisionActive = loadBody.metadata.x != 0u && loadBody.sizeRotation.w <= 0.0;
            collisionBodyCache[localIndex] = vec4<f32>(
                loadBody.positionPrevious.xy,
                max(0.5, loadBody.visual.w),
                select(0.0, 1.0, collisionActive)
            );
            corrections[loadIndex] = vec4<f32>(0.0);
        }
        workgroupBarrier();
        if (localIndex >= LAYER_CAPACITY) {
            return;
        }

        let index = partitionStart + localIndex;
        corrections[index] = vec4<f32>(
            calculate_cached_collision_correction(localIndex, partitionStart),
            0.0,
            0.0
        );
    }

    @compute @workgroup_size(${TITLE_WEBGPU_ENEMY_SIMULATION_WORKGROUP_SIZE})
    fn apply_title_collisions(@builtin(global_invocation_id) globalId: vec3<u32>) {
        let index = globalId.x;
        if (index >= BODY_CAPACITY || bodies[index].metadata.x == 0u) {
            return;
        }
        var body = bodies[index];
        body.positionPrevious = vec4<f32>(
            body.positionPrevious.xy + corrections[index].xy,
            body.positionPrevious.zw
        );
        bodies[index] = body;
    }

    @compute @workgroup_size(${TITLE_WEBGPU_ENEMY_SIMULATION_COLLISION_WORKGROUP_SIZE})
    fn simulate_title_layers(
        @builtin(local_invocation_index) localIndex: u32,
        @builtin(workgroup_id) workgroupId: vec3<u32>
    ) {
        let layer = collision_layer_for_workgroup(workgroupId.x);
        let partitionStart = layer * LAYER_CAPACITY;
        let index = partitionStart + localIndex;
        if (localIndex < LAYER_CAPACITY) {
            var body = bodies[index];
            if (body.metadata.x != 0u && fixedParameters.viewport.w > 0.5) {
                body = integrate_body_state(body, index);
                bodies[index] = body;
            }
            let collisionActive = body.metadata.x != 0u && body.sizeRotation.w <= 0.0;
            collisionBodyCache[localIndex] = vec4<f32>(
                body.positionPrevious.xy,
                max(0.5, body.visual.w),
                select(0.0, 1.0, collisionActive)
            );
        }
        workgroupBarrier();

        for (var collisionPass: u32 = 0u; collisionPass < 1u; collisionPass += 1u) {
            if (localIndex < 144u) {
                atomicStore(&collisionGridHeads[localIndex], -1);
            }
            if (localIndex == 0u) {
                atomicStore(&collisionMaxRadiusBits, 0u);
            }
            if (localIndex < LAYER_CAPACITY) {
                atomicStore(&collisionCorrectionX[localIndex], 0);
                atomicStore(&collisionCorrectionY[localIndex], 0);
                atomicStore(&collisionContactCount[localIndex], 0u);
                collisionGridNext[localIndex] = -1;
            }
            workgroupBarrier();

            if (localIndex < LAYER_CAPACITY && collisionBodyCache[localIndex].w > 0.5) {
                atomicMax(
                    &collisionMaxRadiusBits,
                    bitcast<u32>(collisionBodyCache[localIndex].z)
                );
            }
            workgroupBarrier();

            let viewportSize = max(fixedParameters.viewport.xy, vec2<f32>(1.0));
            let cullRatio = max(0.0, fixedParameters.viewport.z);
            let domainMin = -(viewportSize * cullRatio);
            let domainSize = viewportSize * (1.0 + (2.0 * cullRatio));
            let maxRadius = bitcast<f32>(atomicLoad(&collisionMaxRadiusBits));
            let cellSize = max(
                max(1.0, maxRadius * 2.0),
                max(domainSize.x / 16.0, domainSize.y / 9.0)
            );
            let columnCount = max(1u, min(16u, u32(ceil(domainSize.x / cellSize))));
            let rowCount = max(1u, min(9u, u32(ceil(domainSize.y / cellSize))));
            if (localIndex < LAYER_CAPACITY && collisionBodyCache[localIndex].w > 0.5) {
                let position = collisionBodyCache[localIndex].xy;
                let cellX = u32(clamp(
                    floor((position.x - domainMin.x) / cellSize),
                    0.0,
                    f32(columnCount - 1u)
                ));
                let cellY = u32(clamp(
                    floor((position.y - domainMin.y) / cellSize),
                    0.0,
                    f32(rowCount - 1u)
                ));
                let cellIndex = (cellY * columnCount) + cellX;
                collisionGridNext[localIndex] = atomicExchange(
                    &collisionGridHeads[cellIndex],
                    i32(localIndex)
                );
            }
            workgroupBarrier();

            if (localIndex < LAYER_CAPACITY && collisionBodyCache[localIndex].w > 0.5) {
                let firstBody = collisionBodyCache[localIndex];
                let cellX = i32(clamp(
                    floor((firstBody.x - domainMin.x) / cellSize),
                    0.0,
                    f32(columnCount - 1u)
                ));
                let cellY = i32(clamp(
                    floor((firstBody.y - domainMin.y) / cellSize),
                    0.0,
                    f32(rowCount - 1u)
                ));
                for (var yOffset: i32 = -1; yOffset <= 1; yOffset += 1) {
                    let neighborY = cellY + yOffset;
                    if (neighborY < 0 || neighborY >= i32(rowCount)) {
                        continue;
                    }
                    for (var xOffset: i32 = -1; xOffset <= 1; xOffset += 1) {
                        let neighborX = cellX + xOffset;
                        if (neighborX < 0 || neighborX >= i32(columnCount)) {
                            continue;
                        }
                        let neighborCell = (u32(neighborY) * columnCount) + u32(neighborX);
                        var otherCursor = atomicLoad(&collisionGridHeads[neighborCell]);
                        while (otherCursor >= 0) {
                            let secondIndex = u32(otherCursor);
                            otherCursor = collisionGridNext[secondIndex];
                            if (secondIndex <= localIndex) {
                                continue;
                            }
                            let secondBody = collisionBodyCache[secondIndex];
                            var offset = firstBody.xy - secondBody.xy;
                            var distanceSquared = dot(offset, offset);
                            let combinedRadius = firstBody.z + secondBody.z;
                            if (distanceSquared >= combinedRadius * combinedRadius) {
                                continue;
                            }
                            if (distanceSquared <= 0.000001) {
                                let firstGlobal = partitionStart + localIndex;
                                let secondGlobal = partitionStart + secondIndex;
                                let angle = f32((firstGlobal * 37u + secondGlobal * 17u) % 6283u) * 0.001;
                                offset = vec2<f32>(cos(angle), sin(angle));
                                distanceSquared = 1.0;
                            }
                            let distance = sqrt(distanceSquared);
                            let penetration = max(0.0, combinedRadius - distance - 0.8);
                            if (penetration <= 0.0) {
                                continue;
                            }
                            let pairCorrection = (offset / distance) * penetration * 0.4;
                            let quantizedCorrection = vec2<i32>(round(pairCorrection * 4096.0));
                            atomicAdd(&collisionCorrectionX[localIndex], quantizedCorrection.x);
                            atomicAdd(&collisionCorrectionY[localIndex], quantizedCorrection.y);
                            atomicAdd(&collisionCorrectionX[secondIndex], -quantizedCorrection.x);
                            atomicAdd(&collisionCorrectionY[secondIndex], -quantizedCorrection.y);
                            atomicAdd(&collisionContactCount[localIndex], 1u);
                            atomicAdd(&collisionContactCount[secondIndex], 1u);
                        }
                    }
                }
            }
            workgroupBarrier();

            if (localIndex < LAYER_CAPACITY) {
                let cachedBody = collisionBodyCache[localIndex];
                var correction = vec2<f32>(
                    f32(atomicLoad(&collisionCorrectionX[localIndex])),
                    f32(atomicLoad(&collisionCorrectionY[localIndex]))
                ) / 4096.0;
                let contacts = atomicLoad(&collisionContactCount[localIndex]);
                let correctionLength = length(correction);
                let maxCorrection = max(2.2, cachedBody.z * 0.16)
                    * min(2.4, 1.0 + (f32(contacts) * 0.06));
                if (correctionLength > maxCorrection && correctionLength > 0.000001) {
                    correction *= maxCorrection / correctionLength;
                }
                collisionCorrectionCache[localIndex] = correction;
            }
            workgroupBarrier();

            if (localIndex < LAYER_CAPACITY) {
                let cachedBody = collisionBodyCache[localIndex];
                collisionBodyCache[localIndex] = vec4<f32>(
                    cachedBody.xy + collisionCorrectionCache[localIndex],
                    cachedBody.zw
                );
            }
            workgroupBarrier();
        }

        if (localIndex < LAYER_CAPACITY && collisionBodyCache[localIndex].w > 0.5) {
            var body = bodies[index];
            body.positionPrevious = vec4<f32>(
                collisionBodyCache[localIndex].xy,
                body.positionPrevious.zw
            );
            bodies[index] = body;
        }
    }

    fn try_append_title_shield_impact(inputBody: BodyState) -> bool {
        let layer = min(inputBody.metadata.y, LAYER_COUNT - 1u);
        if (inputBody.metadata.x == 0u
            || inputBody.response.x <= 0.0
            || layer == 0u
            || inputBody.shield.z >= -0.5) {
            return false;
        }

        let radius = max(1.0, shieldParameters[0].z);
        let enemyRadius = max(inputBody.visual.x, inputBody.visual.y) * 0.5;
        let angularWidth = fast_asin_unit(clamp(
            (enemyRadius + 12.0) / radius,
            0.02,
            0.98
        )) * 1.15;
        let speedFactor = clamp(length(inputBody.velocityBase.xy) / 120.0, 0.0, 1.0);
        let intensity = clamp(
            0.2 + (speedFactor * 0.4) + (inputBody.response.z * 0.45),
            0.2,
            0.52
        );
        for (var attempt: u32 = 0u; attempt < 16u; attempt += 1u) {
            let currentCount = atomicLoad(&shieldInteractions.counts[0]);
            if (currentCount >= MAX_IMPACTS) {
                return false;
            }
            let result = atomicCompareExchangeWeak(
                &shieldInteractions.counts[0],
                currentCount,
                currentCount + 1u
            );
            if (result.exchanged) {
                shieldInteractions.impacts[currentCount] = vec4<f32>(
                    inputBody.shield.y,
                    intensity,
                    angularWidth * 0.9,
                    0.0
                );
                return true;
            }
        }
        return false;
    }

    @compute @workgroup_size(8)
    fn clear_title_shield_frame(@builtin(local_invocation_index) localIndex: u32) {
        shieldInteractions.dents[localIndex] = vec4<f32>(0.0);
        if (localIndex == 0u) {
            let frameDelta = max(0.0, shieldParameters[0].w);
            let impactDuration = max(0.0001, shieldParameters[1].w);
            let previousImpactCount = min(
                atomicLoad(&shieldInteractions.counts[0]),
                MAX_IMPACTS
            );
            var impactCount: u32 = 0u;
            for (var impactIndex: u32 = 0u; impactIndex < previousImpactCount; impactIndex += 1u) {
                let previousImpact = shieldInteractions.impacts[impactIndex];
                let agedImpact = vec4<f32>(
                    previousImpact.xyz,
                    previousImpact.w + (frameDelta / impactDuration)
                );
                if (agedImpact.w < 1.0) {
                    shieldInteractions.impacts[impactCount] = agedImpact;
                    impactCount += 1u;
                }
            }
            atomicStore(&shieldInteractions.counts[0], impactCount);
            atomicStore(&shieldInteractions.counts[1], MAX_ACTIVE_DENTS);
            atomicStore(&shieldInteractions.counts[2], 0u);
            atomicStore(&shieldInteractions.counts[3], 0u);
        }
        workgroupBarrier();
        let ownerCode = atomicLoad(&shieldWinnerKeys[localIndex]);
        if (ownerCode > 0u && ownerCode <= BODY_CAPACITY) {
            let bodyIndex = ownerCode - 1u;
            let body = bodies[bodyIndex];
            let slotMatches = u32(clamp(
                body.shield.w,
                0.0,
                f32(MAX_ACTIVE_DENTS)
            )) == localIndex + 1u;
            if (body.metadata.x != 0u && body.response.x > 0.0 && slotMatches) {
                collect_title_shield_body(bodyIndex, body);
            } else if (atomicLoad(&shieldWinnerKeys[localIndex]) == ownerCode) {
                atomicStore(&shieldWinnerKeys[localIndex], 0u);
            }
        } else if (ownerCode > BODY_CAPACITY) {
            atomicStore(&shieldWinnerKeys[localIndex], 0u);
        }
    }

    @compute @workgroup_size(${TITLE_WEBGPU_ENEMY_SIMULATION_WORKGROUP_SIZE})
    fn write_title_presentation(@builtin(global_invocation_id) globalId: vec3<u32>) {
        let bodyIndex = globalId.x;
        if (bodyIndex >= BODY_CAPACITY) {
            return;
        }
        let softnessRecordIndex = bodyIndex * 2u;
        let normalRecordIndex = softnessRecordIndex + 1u;
        var body = bodies[bodyIndex];
        if (body.metadata.x == 0u) {
            presentationRecords[softnessRecordIndex].positionAndSize = vec4<f32>(0.0);
            presentationRecords[softnessRecordIndex].rotationAlphaStyle = vec4<f32>(1.0, 0.0, 0.0, 0.0);
            presentationRecords[normalRecordIndex].positionAndSize = vec4<f32>(0.0);
            presentationRecords[normalRecordIndex].rotationAlphaStyle = vec4<f32>(1.0, 0.0, 0.0, 0.0);
            return;
        }
        if (body.shield.z < -0.5 && body.shield.w < 0.5
            && try_append_title_shield_impact(body)) {
            body.shield = vec4<f32>(body.shield.xy, abs(body.shield.z), body.shield.w);
            bodies[bodyIndex] = body;
        }
        let layer = min(body.metadata.y, LAYER_COUNT - 1u);
        let alpha = clamp(presentationParameters.w, 0.0, 1.0);
        var position = mix(body.positionPrevious.zw, body.positionPrevious.xy, alpha);
        position.y -= presentationParameters.z;
        let rotation = body.sizeRotation.y;
        let rotationCos = cos(rotation);
        let rotationSin = sin(rotation);
        let style = body.metadata.z | (layer << 4u);
        let softnessScale = layer_softness_scale(layer);
        let softnessOffset = layer_softness_offset(layer);
        presentationRecords[softnessRecordIndex].positionAndSize = vec4<f32>(
            position + vec2<f32>(softnessOffset),
            body.visual.xy * softnessScale
        );
        presentationRecords[softnessRecordIndex].rotationAlphaStyle = vec4<f32>(
            rotationCos,
            rotationSin,
            min(1.0, body.visual.z * layer_softness_alpha(layer)),
            f32(style | 8u)
        );
        presentationRecords[normalRecordIndex].positionAndSize = vec4<f32>(
            position,
            body.visual.xy
        );
        presentationRecords[normalRecordIndex].rotationAlphaStyle = vec4<f32>(
            rotationCos,
            rotationSin,
            body.visual.z,
            f32(style)
        );
    }

    fn collect_title_shield_body(bodyIndex: u32, inputBody: BodyState) {
        var body = inputBody;
        let layer = min(body.metadata.y, LAYER_COUNT - 1u);
        let visualStrength = body.response.w;
        let slotCode = u32(clamp(body.shield.w, 0.0, f32(MAX_ACTIVE_DENTS)));
        let impactPending = body.shield.z < -0.5;
        if (body.metadata.x == 0u
            || body.response.x <= 0.0
            || layer == 0u
            || slotCode == 0u) {
            return;
        }

        let radius = max(1.0, shieldParameters[0].z);
        let enemyRadius = max(body.visual.x, body.visual.y) * 0.5;
        let angularWidth = fast_asin_unit(clamp(
            (enemyRadius + 12.0) / radius,
            0.02,
            0.98
        )) * 1.15;
        if (impactPending && try_append_title_shield_impact(body)) {
            body.shield = vec4<f32>(body.shield.xy, abs(body.shield.z), body.shield.w);
            bodies[bodyIndex] = body;
        }

        if (visualStrength > 0.001) {
            shieldInteractions.dents[slotCode - 1u] = vec4<f32>(
                body.shield.y,
                18.0 * body.response.z * body.response.z,
                angularWidth,
                visualStrength
            );
        }
    }

`;
