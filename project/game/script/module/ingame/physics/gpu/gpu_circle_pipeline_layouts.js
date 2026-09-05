import {
    GPU_EFFECT_RUNTIME_ENTRY_POINT
} from './gpu_effect_runtime_shaders.js';
import {
    GPU_FORMATION_RUNTIME_ENTRY_POINT,
    GPU_FORMATION_RUNTIME_STORAGE_PROFILE
} from './gpu_formation_runtime_shaders.js';
import {
    GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT
} from './gpu_atomic_transform_runtime_shaders.js';
import {
    GPU_ROUTE_RUNTIME_STORAGE_PROFILE
} from './gpu_route_runtime_shaders.js';
import {
    COMPUTE_PIPELINE_PROFILE,
    REQUIRED_COMPUTE_STORAGE_BUFFERS_PER_STAGE
} from './gpu_circle_pipeline_profiles.js';

/** Creates immutable layouts/plans without accessing live simulation state. */
export function createGpuCirclePipelineLayouts(device) {
    const stage = globalThis.GPUShaderStage;
    const storageLayoutEntry = (binding, type = 'storage') => ({
        binding,
        visibility: stage.COMPUTE,
        buffer: { type }
    });
    const computeBodiesBaseLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-circle-compute-bodies-base-layout',
        entries: [0, 1, 2, 3].map((binding) => storageLayoutEntry(binding))
    });
    const computeBodiesWithHandlersLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-circle-compute-bodies-with-handlers-layout',
        entries: [
            ...[0, 1, 2, 3].map((binding) => storageLayoutEntry(binding)),
            storageLayoutEntry(4, 'read-only-storage')
        ]
    });
    const computeContactHandlingBodiesLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-circle-compute-contact-handling-bodies-layout',
        entries: [
            storageLayoutEntry(0),
            storageLayoutEntry(1),
            storageLayoutEntry(2),
            storageLayoutEntry(4, 'read-only-storage'),
            storageLayoutEntry(10)
        ]
    });
    const computeMaximumDamageWindowBodiesLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-circle-compute-maximum-damage-window-bodies-layout',
        entries: [
            storageLayoutEntry(0),
            storageLayoutEntry(1),
            storageLayoutEntry(2),
            storageLayoutEntry(4, 'read-only-storage'),
            storageLayoutEntry(10),
            storageLayoutEntry(11)
        ]
    });
    const computeCoreDamageRequestBodiesLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-circle-compute-core-damage-request-bodies-layout',
        entries: [
            storageLayoutEntry(0),
            storageLayoutEntry(1),
            storageLayoutEntry(2),
            storageLayoutEntry(4, 'read-only-storage'),
            storageLayoutEntry(10),
            storageLayoutEntry(11)
        ]
    });
    const computeDirectCoreDamageRequestBodiesLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-circle-compute-direct-core-damage-request-bodies-layout',
        entries: [
            storageLayoutEntry(0),
            storageLayoutEntry(1),
            storageLayoutEntry(2),
            storageLayoutEntry(10),
            storageLayoutEntry(12)
        ]
    });
    const computeEnemyBehaviorBodiesLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-circle-compute-enemy-behavior-bodies-layout',
        entries: [
            storageLayoutEntry(0),
            storageLayoutEntry(1),
            storageLayoutEntry(2),
            storageLayoutEntry(11),
            storageLayoutEntry(13, 'read-only-storage')
        ]
    });
    const computeEnemyChargeImpactBodiesLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-circle-compute-enemy-charge-impact-bodies-layout',
        entries: [
            storageLayoutEntry(0),
            storageLayoutEntry(1),
            storageLayoutEntry(2),
            storageLayoutEntry(11),
            storageLayoutEntry(13, 'read-only-storage'),
            storageLayoutEntry(16)
        ]
    });
    const computeDirectionalDefenseBodiesLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-circle-compute-directional-defense-bodies-layout',
        entries: [
            storageLayoutEntry(0),
            storageLayoutEntry(1),
            storageLayoutEntry(2),
            storageLayoutEntry(3),
            storageLayoutEntry(11),
            storageLayoutEntry(13, 'read-only-storage')
        ]
    });
    const computeAtomicTransformFirstHitBodiesLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-circle-compute-atomic-transform-first-hit-bodies-layout',
        entries: [
            storageLayoutEntry(0),
            storageLayoutEntry(1),
            storageLayoutEntry(2),
            storageLayoutEntry(4, 'read-only-storage'),
            storageLayoutEntry(14),
            storageLayoutEntry(15)
        ]
    });
    const computeWorldFullLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-circle-compute-world-full-layout',
        entries: [
            storageLayoutEntry(0),
            storageLayoutEntry(1),
            storageLayoutEntry(2, 'read-only-storage'),
            storageLayoutEntry(3),
            {
                binding: 4,
                visibility: stage.COMPUTE,
                texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' }
            }
        ]
    });
    const computeWorldGridLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-circle-compute-world-grid-layout',
        entries: [storageLayoutEntry(0), storageLayoutEntry(1)]
    });
    const computeWorldSdfLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-circle-compute-world-sdf-layout',
        entries: [storageLayoutEntry(2, 'read-only-storage')]
    });
    const computeEmptyLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-circle-compute-empty-layout',
        entries: []
    });
    const computeParamsLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-circle-compute-params-layout',
        entries: [{
            binding: 0,
            visibility: stage.COMPUTE,
            buffer: { type: 'uniform' }
        }]
    });
    const computeContactEventsLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-circle-compute-contact-events-layout',
        entries: [storageLayoutEntry(0), storageLayoutEntry(1)]
    });
    const computeAllEventsLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-circle-compute-all-events-layout',
        entries: [0, 1, 2, 3].map((binding) => storageLayoutEntry(binding))
    });
    const computeMaximumDamageWindowEventsLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-circle-compute-maximum-damage-window-events-layout',
        entries: [0, 1, 2].map((binding) => storageLayoutEntry(binding))
    });
    const computeEnemyBehaviorEventsLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-circle-compute-enemy-behavior-events-layout',
        entries: [0, 1, 2].map((binding) => storageLayoutEntry(binding))
    });
    const computeDirectionalDefenseEventsLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-circle-compute-directional-defense-events-layout',
        entries: [0, 1].map((binding) => storageLayoutEntry(binding))
    });
    const computeFixedControlLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-circle-compute-fixed-control-layout',
        entries: [
            storageLayoutEntry(0),
            storageLayoutEntry(1),
            storageLayoutEntry(2),
            storageLayoutEntry(5),
            storageLayoutEntry(6),
            storageLayoutEntry(13, 'read-only-storage')
        ]
    });
    const computeSourceResolveLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-circle-compute-source-resolve-layout',
        entries: [
            storageLayoutEntry(0),
            storageLayoutEntry(1),
            storageLayoutEntry(2),
            storageLayoutEntry(3),
            storageLayoutEntry(5),
            storageLayoutEntry(7),
            storageLayoutEntry(10),
            storageLayoutEntry(11),
            storageLayoutEntry(12)
        ]
    });
    const computeTrackedPoseLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-circle-compute-tracked-pose-layout',
        entries: [
            storageLayoutEntry(0),
            storageLayoutEntry(1),
            storageLayoutEntry(2),
            storageLayoutEntry(3),
            storageLayoutEntry(8, 'read-only-storage'),
            storageLayoutEntry(9)
        ]
    });
    const indirectLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-circle-indirect-layout',
        entries: [
            { binding: 0, visibility: stage.COMPUTE, buffer: { type: 'read-only-storage' } },
            { binding: 1, visibility: stage.COMPUTE, buffer: { type: 'storage' } },
            { binding: 2, visibility: stage.COMPUTE, buffer: { type: 'storage' } },
            { binding: 3, visibility: stage.COMPUTE, buffer: { type: 'storage' } },
            { binding: 4, visibility: stage.COMPUTE, buffer: { type: 'read-only-storage' } }
        ]
    });
    const renderBodyStorageBindings = Object.freeze([
        0, 1, 2, 3, 4, 5, 6, 7, 8
    ]);
    if (renderBodyStorageBindings.length
        !== GPU_FORMATION_RUNTIME_STORAGE_PROFILE.render) {
        throw new RangeError('Formation render storage profile drift');
    }
    const renderBodiesLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-circle-render-bodies-layout',
        entries: renderBodyStorageBindings.map((binding) => ({
            binding,
            visibility: stage.VERTEX,
            buffer: { type: 'read-only-storage' }
        }))
    });
    const renderParamsLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-circle-render-params-layout',
        entries: [{
            binding: 0,
            visibility: stage.VERTEX,
            buffer: { type: 'uniform' }
        }]
    });
    const computeProfileLayouts = {
        [COMPUTE_PIPELINE_PROFILE.PHYSICS]: [
            computeBodiesBaseLayout,
            computeWorldFullLayout,
            computeParamsLayout
        ],
        [COMPUTE_PIPELINE_PROFILE.BODY_CONTACTS]: [
            computeBodiesWithHandlersLayout,
            computeWorldGridLayout,
            computeParamsLayout,
            computeContactEventsLayout
        ],
        [COMPUTE_PIPELINE_PROFILE.WORLD_CONTACTS]: [
            computeBodiesBaseLayout,
            computeWorldSdfLayout,
            computeParamsLayout,
            computeContactEventsLayout
        ],
        [COMPUTE_PIPELINE_PROFILE.CONTACT_HANDLING]: [
            computeContactHandlingBodiesLayout,
            computeEmptyLayout,
            computeParamsLayout,
            computeAllEventsLayout
        ],
        [COMPUTE_PIPELINE_PROFILE.MAXIMUM_DAMAGE_WINDOW]: [
            computeMaximumDamageWindowBodiesLayout,
            computeEmptyLayout,
            computeParamsLayout,
            computeMaximumDamageWindowEventsLayout
        ],
        [COMPUTE_PIPELINE_PROFILE.CORE_DAMAGE_REQUEST]: [
            computeCoreDamageRequestBodiesLayout,
            computeEmptyLayout,
            computeParamsLayout,
            computeMaximumDamageWindowEventsLayout
        ],
        [COMPUTE_PIPELINE_PROFILE.DIRECT_CORE_DAMAGE_REQUEST]: [
            computeDirectCoreDamageRequestBodiesLayout,
            computeEmptyLayout,
            computeParamsLayout,
            computeMaximumDamageWindowEventsLayout
        ],
        [COMPUTE_PIPELINE_PROFILE.FIXED_CONTROL]: [
            computeFixedControlLayout,
            computeEmptyLayout,
            computeParamsLayout
        ],
        [COMPUTE_PIPELINE_PROFILE.SOURCE_RESOLVE]: [
            computeSourceResolveLayout,
            computeEmptyLayout,
            computeParamsLayout
        ],
        [COMPUTE_PIPELINE_PROFILE.ENEMY_BEHAVIOR]: [
            computeEnemyBehaviorBodiesLayout,
            computeWorldSdfLayout,
            computeParamsLayout,
            computeEnemyBehaviorEventsLayout
        ],
        [COMPUTE_PIPELINE_PROFILE.ENEMY_CHARGE_IMPACT]: [
            computeEnemyChargeImpactBodiesLayout,
            computeEmptyLayout,
            computeParamsLayout,
            computeEnemyBehaviorEventsLayout
        ],
        [COMPUTE_PIPELINE_PROFILE.DIRECTIONAL_DEFENSE_CLASSIFIER]: [
            computeDirectionalDefenseBodiesLayout,
            computeEmptyLayout,
            computeParamsLayout,
            computeDirectionalDefenseEventsLayout
        ],
        [COMPUTE_PIPELINE_PROFILE.ATOMIC_TRANSFORM_FIRST_HIT]: [
            computeAtomicTransformFirstHitBodiesLayout,
            computeEmptyLayout,
            computeParamsLayout,
            computeMaximumDamageWindowEventsLayout
        ],
        [COMPUTE_PIPELINE_PROFILE.TRACKED_POSE]: [
            computeTrackedPoseLayout
        ]
    };
    const computePipelineLayouts = Object.fromEntries(
        Object.entries(computeProfileLayouts).map(([profile, bindGroupLayouts]) => [
            profile,
            device.createPipelineLayout({
                label: `cirvivor-gpu-circle-compute-${profile}-pipeline-layout`,
                bindGroupLayouts
            })
        ])
    );
    const indirectPipelineLayout = device.createPipelineLayout({
        label: 'cirvivor-gpu-circle-indirect-pipeline-layout',
        bindGroupLayouts: [indirectLayout]
    });
    const renderPipelineLayout = device.createPipelineLayout({
        label: 'cirvivor-gpu-circle-render-pipeline-layout',
        bindGroupLayouts: [renderBodiesLayout, renderParamsLayout]
    });

    const effectBindingPlan = Object.freeze({
        [GPU_EFFECT_RUNTIME_ENTRY_POINT.RESET_TICK]: [[0, 7, 8], [], true],
        [GPU_EFFECT_RUNTIME_ENTRY_POINT.RETAIN_INSTANCES]: [[2, 8, 9, 10], [], true],
        [GPU_EFFECT_RUNTIME_ENTRY_POINT.SCAN_PULSES]: [
            [1, 2, 6, 7, 8, 11], [0, 1, 2], true
        ],
        [GPU_EFFECT_RUNTIME_ENTRY_POINT.PREFIX_PULSES]: [
            [7, 8, 10, 11, 12], [], true
        ],
        [GPU_EFFECT_RUNTIME_ENTRY_POINT.WRITE_PULSES]: [
            [1, 2, 6, 7, 8, 11], [0, 1, 2], true
        ],
        [GPU_EFFECT_RUNTIME_ENTRY_POINT.MATERIALIZE_BATCH]: [
            [1, 5, 6, 7, 8, 10, 11, 12], [], true
        ],
        [GPU_EFFECT_RUNTIME_ENTRY_POINT.FINISH_TICK]: [[8], [], false],
        [GPU_EFFECT_RUNTIME_ENTRY_POINT.CLEAR_SUMMARIES]: [[0, 2, 5], [], true],
        [GPU_EFFECT_RUNTIME_ENTRY_POINT.ACCUMULATE_SUMMARIES]: [
            [0, 2, 5, 8, 10], [], true
        ],
        [GPU_EFFECT_RUNTIME_ENTRY_POINT.FINALIZE_SUMMARIES]: [[0, 2, 5], [], true],
        [GPU_EFFECT_RUNTIME_ENTRY_POINT.APPLY_REGENERATION]: [[0, 2, 5], [], true],
        [GPU_EFFECT_RUNTIME_ENTRY_POINT.MATERIALIZE_CONTACT_DAMAGE]: [
            [0, 4, 5], [], false
        ],
        [GPU_EFFECT_RUNTIME_ENTRY_POINT.ADVANCE_PENTA_NAVIGATION]: [
            [0, 1, 2, 3, 6], [0, 1, 2, 4, 5, 6], true
        ]
    });
    const effectReadOnlyBodyBindings = new Set([0, 9]);
    const effectWorldStorageBindings = new Set([0, 1, 2, 4]);
    const effectReadOnlyWorldBindings = new Set([1, 4]);
    const effectPipelineLayouts = Object.fromEntries(Object.entries(
        effectBindingPlan
    ).map(([entryPoint, [bodyBindings, worldBindings, usesParams]]) => {
        const storageBindingCount = bodyBindings.length
            + worldBindings.filter((binding) => (
                effectWorldStorageBindings.has(binding)
            )).length;
        if (new Set(bodyBindings).size !== bodyBindings.length
            || new Set(worldBindings).size !== worldBindings.length
            || storageBindingCount > REQUIRED_COMPUTE_STORAGE_BUFFERS_PER_STAGE) {
            throw new RangeError(
                `Effect ${entryPoint} binding plan이 exact/<=9 계약을 위반합니다.`
            );
        }
        const bodyLayout = device.createBindGroupLayout({
            label: `cirvivor-gpu-effect-${entryPoint}-bodies-layout`,
            entries: bodyBindings.map((binding) => storageLayoutEntry(
                binding,
                effectReadOnlyBodyBindings.has(binding)
                    ? 'read-only-storage'
                    : 'storage'
            ))
        });
        const bindGroupLayouts = [bodyLayout];
        if (worldBindings.length > 0 || usesParams) {
            bindGroupLayouts.push(device.createBindGroupLayout({
                label: `cirvivor-gpu-effect-${entryPoint}-world-layout`,
                entries: worldBindings.map((binding) => (
                    effectWorldStorageBindings.has(binding)
                        ? storageLayoutEntry(
                            binding,
                            effectReadOnlyWorldBindings.has(binding)
                                ? 'read-only-storage'
                                : 'storage'
                        )
                        : {
                            binding,
                            visibility: stage.COMPUTE,
                            texture: {
                                sampleType: 'unfilterable-float',
                                viewDimension: '2d-array'
                            }
                        }
                ))
            }));
        }
        if (usesParams) {
            bindGroupLayouts.push(computeParamsLayout);
        }
        return [entryPoint, device.createPipelineLayout({
            label: `cirvivor-gpu-effect-${entryPoint}-pipeline-layout`,
            bindGroupLayouts
        })];
    }));

    const formationBindingPlan = Object.freeze({
        [GPU_FORMATION_RUNTIME_ENTRY_POINT.CLEAR_CANDIDATES]: [
            [7], [], false
        ],
        [GPU_FORMATION_RUNTIME_ENTRY_POINT.SEED_MOTION]: [
            [0, 2, 6, 7, 17, 19], [2], true
        ],
        [GPU_FORMATION_RUNTIME_ENTRY_POINT.SELECT_MOTION]: [
            [0, 1, 2, 6, 7], [0, 1, 4, 6], true
        ],
        [GPU_FORMATION_RUNTIME_ENTRY_POINT.ADVANCE_MOTION]: [
            [0, 1, 2, 6, 7], [4, 6], true
        ],
        [GPU_FORMATION_RUNTIME_ENTRY_POINT.SEED_PREPARE]: [
            [2, 7, 8], [2], false
        ],
        [GPU_FORMATION_RUNTIME_ENTRY_POINT.SELECT_PREPARE]: [
            [1, 2, 6, 7, 8, 10], [0, 1, 4, 6], true
        ],
        [GPU_FORMATION_RUNTIME_ENTRY_POINT.FINALIZE_PREPARE]: [
            [2, 6, 7, 8, 10], [], false
        ],
        [GPU_FORMATION_RUNTIME_ENTRY_POINT.SEAL_PREPARE]: [
            [8], [], false
        ],
        [GPU_FORMATION_RUNTIME_ENTRY_POINT.RESET_TRANSFORM]: [
            [9], [], false
        ],
        [GPU_FORMATION_RUNTIME_ENTRY_POINT.PREFLIGHT_TRANSFORMS]: [
            [1, 2, 6, 7, 9, 10, 18], [6], true
        ],
        [GPU_FORMATION_RUNTIME_ENTRY_POINT.PREFLIGHT_ROUTE_REKEYS]: [
            [2, 6, 9, 17], [], false
        ],
        [GPU_FORMATION_RUNTIME_ENTRY_POINT.PREFLIGHT_EFFECT_REKEYS]: [
            [7, 9, 13, 14], [], false
        ],
        [GPU_FORMATION_RUNTIME_ENTRY_POINT.SEAL_TRANSFORM]: [
            [7, 9], [], false
        ],
        [GPU_FORMATION_RUNTIME_ENTRY_POINT.REKEY_EFFECTS]: [
            [7, 9, 13, 14], [], false
        ],
        [GPU_FORMATION_RUNTIME_ENTRY_POINT.COMMIT_BODIES]: [
            [1, 2, 3, 4, 5, 9], [], false
        ],
        [GPU_FORMATION_RUNTIME_ENTRY_POINT.COMMIT_ROUTE_STATE]: [
            [9, 17], [], false
        ],
        [GPU_FORMATION_RUNTIME_ENTRY_POINT.COMMIT_AUXILIARY]: [
            [6, 7, 9, 10, 11, 12, 15, 16, 18], [], false
        ]
    });
    const formationReadOnlyBodyBindings = new Set([0, 19]);
    const formationWorldStorageBindings = new Set([0, 1, 2, 4]);
    const formationReadOnlyWorldBindings = new Set([1, 4]);
    const formationPipelineLayouts = Object.fromEntries(Object.entries(
        formationBindingPlan
    ).map(([entryPoint, [bodyBindings, worldBindings, usesParams]]) => {
        const storageBindingCount = bodyBindings.length
            + worldBindings.filter((binding) => (
                formationWorldStorageBindings.has(binding)
            )).length;
        const expectedStorageBindingCount
            = GPU_FORMATION_RUNTIME_STORAGE_PROFILE.byEntryPoint[entryPoint];
        if (new Set(bodyBindings).size !== bodyBindings.length
            || new Set(worldBindings).size !== worldBindings.length
            || storageBindingCount > REQUIRED_COMPUTE_STORAGE_BUFFERS_PER_STAGE
            || storageBindingCount !== expectedStorageBindingCount) {
            throw new RangeError(
                `Formation ${entryPoint} binding plan이 exact/<=9 계약을 위반합니다.`
            );
        }
        const bodyLayout = device.createBindGroupLayout({
            label: `cirvivor-gpu-formation-${entryPoint}-bodies-layout`,
            entries: bodyBindings.map((binding) => storageLayoutEntry(
                binding,
                formationReadOnlyBodyBindings.has(binding)
                    ? 'read-only-storage'
                    : 'storage'
            ))
        });
        const bindGroupLayouts = [bodyLayout];
        if (worldBindings.length > 0 || usesParams) {
            bindGroupLayouts.push(device.createBindGroupLayout({
                label: `cirvivor-gpu-formation-${entryPoint}-world-layout`,
                entries: worldBindings.map((binding) => (
                    formationWorldStorageBindings.has(binding)
                        ? storageLayoutEntry(
                            binding,
                            formationReadOnlyWorldBindings.has(binding)
                                ? 'read-only-storage'
                                : 'storage'
                        )
                        : {
                            binding,
                            visibility: stage.COMPUTE,
                            texture: {
                                sampleType: 'unfilterable-float',
                                viewDimension: '2d-array'
                            }
                        }
                ))
            }));
        }
        if (usesParams) {
            bindGroupLayouts.push(computeParamsLayout);
        }
        return [entryPoint, device.createPipelineLayout({
            label: `cirvivor-gpu-formation-${entryPoint}-pipeline-layout`,
            bindGroupLayouts
        })];
    }));

    const atomicTransformBindingPlan = Object.freeze({
        [GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.CLEAR_PREPARE]: [0, 7],
        [GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.PREPARE]: [0, 2, 6, 7, 9],
        [GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.CLEAR_TRANSFORM]: [0, 8],
        [GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.PREFLIGHT_TRANSFORM]: [
            0, 2, 6, 8, 9, 18, 22, 23, 30
        ],
        [GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.PREFLIGHT_EFFECT_REKEYS]: [
            8, 16, 29
        ],
        [GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.SEAL_TRANSFORM]: [8],
        [GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.REKEY_EFFECTS]: [8, 16, 29],
        [GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.COMMIT_BODIES]: [
            1, 2, 3, 8, 17, 18, 19
        ],
        [GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.COMMIT_STATE]: [
            4, 5, 6, 8, 20, 21, 22
        ],
        [GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.COMMIT_AUXILIARY]: [
            8, 10, 11, 12, 13, 23, 24, 25, 26
        ],
        [GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.COMMIT_CONTROL]: [
            8, 14, 15, 27, 28
        ],
        [GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.COMMIT_ROUTE_STATE]: [
            8, 30
        ],
        [GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT.FINALIZE_TRANSFORM]: [8]
    });
    const atomicTransformReadOnlyBindings = new Set([
        0, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28
    ]);
    const atomicTransformPipelineLayouts = Object.fromEntries(
        Object.entries(atomicTransformBindingPlan).map(([
            entryPoint,
            bindings
        ]) => {
            if (new Set(bindings).size !== bindings.length
                || bindings.length
                    > REQUIRED_COMPUTE_STORAGE_BUFFERS_PER_STAGE) {
                throw new RangeError(
                    `AtomicTransform ${entryPoint} storage profile이 <=9를 위반합니다.`
                );
            }
            return [entryPoint, device.createPipelineLayout({
                label: `cirvivor-gpu-atomic-transform-${entryPoint}-layout`,
                bindGroupLayouts: [device.createBindGroupLayout({
                    label: `cirvivor-gpu-atomic-transform-${entryPoint}-bindings`,
                    entries: bindings.map((binding) => storageLayoutEntry(
                        binding,
                        atomicTransformReadOnlyBindings.has(binding)
                            ? 'read-only-storage'
                            : 'storage'
                    ))
                })]
            })];
        })
    );
    const projectileCaptureBodiesLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-projectile-capture-bodies-layout',
        entries: [
            storageLayoutEntry(0, 'read-only-storage'),
            storageLayoutEntry(1),
            storageLayoutEntry(2),
            storageLayoutEntry(3),
            storageLayoutEntry(4),
            storageLayoutEntry(5),
            storageLayoutEntry(6),
            storageLayoutEntry(7),
            storageLayoutEntry(8)
        ]
    });
    const projectileCaptureParamsLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-projectile-capture-params-layout',
        entries: [
            {
                binding: 0,
                visibility: stage.COMPUTE,
                buffer: { type: 'uniform' }
            },
            {
                binding: 1,
                visibility: stage.COMPUTE,
                buffer: { type: 'uniform' }
            }
        ]
    });
    const projectileCapturePipelineLayout = device.createPipelineLayout({
        label: 'cirvivor-gpu-projectile-capture-pipeline-layout',
        bindGroupLayouts: [
            projectileCaptureBodiesLayout,
            projectileCaptureParamsLayout
        ]
    });
    const projectileCaptureReleaseLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-projectile-capture-release-layout',
        entries: [
            storageLayoutEntry(0, 'read-only-storage'),
            storageLayoutEntry(1),
            storageLayoutEntry(2),
            storageLayoutEntry(3),
            storageLayoutEntry(4),
            storageLayoutEntry(5),
            storageLayoutEntry(6)
        ]
    });
    const projectileCaptureReleasePipelineLayout = device.createPipelineLayout({
        label: 'cirvivor-gpu-projectile-capture-release-pipeline-layout',
        bindGroupLayouts: [projectileCaptureReleaseLayout]
    });
    if (GPU_ROUTE_RUNTIME_STORAGE_PROFILE.maximum
        > REQUIRED_COMPUTE_STORAGE_BUFFERS_PER_STAGE) {
        throw new RangeError('RouteRuntime storage profile이 <=9 계약을 위반합니다.');
    }
    const routeRuntimeLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-route-runtime-layout',
        entries: [
            storageLayoutEntry(0, 'read-only-storage'),
            storageLayoutEntry(1),
            storageLayoutEntry(2),
            storageLayoutEntry(3),
            storageLayoutEntry(4, 'read-only-storage'),
            storageLayoutEntry(5),
            storageLayoutEntry(6),
            storageLayoutEntry(7),
            storageLayoutEntry(8),
            {
                binding: 9,
                visibility: stage.COMPUTE,
                buffer: { type: 'uniform' }
            }
        ]
    });
    const routeRuntimePipelineLayout = device.createPipelineLayout({
        label: 'cirvivor-gpu-route-runtime-pipeline-layout',
        bindGroupLayouts: [routeRuntimeLayout]
    });
    const routeRuntimeWaitLayout = device.createBindGroupLayout({
        label: 'cirvivor-gpu-route-runtime-wait-layout',
        entries: [
            storageLayoutEntry(0, 'read-only-storage'),
            storageLayoutEntry(1),
            storageLayoutEntry(2),
            storageLayoutEntry(3),
            {
                binding: 9,
                visibility: stage.COMPUTE,
                buffer: { type: 'uniform' }
            },
            storageLayoutEntry(10)
        ]
    });
    const routeRuntimeWaitPipelineLayout = device.createPipelineLayout({
        label: 'cirvivor-gpu-route-runtime-wait-pipeline-layout',
        bindGroupLayouts: [routeRuntimeWaitLayout]
    });
    return {
        computeBodiesBaseLayout,
        computeBodiesWithHandlersLayout,
        computeContactHandlingBodiesLayout,
        computeMaximumDamageWindowBodiesLayout,
        computeCoreDamageRequestBodiesLayout,
        computeDirectCoreDamageRequestBodiesLayout,
        computeEnemyBehaviorBodiesLayout,
        computeEnemyChargeImpactBodiesLayout,
        computeDirectionalDefenseBodiesLayout,
        computeAtomicTransformFirstHitBodiesLayout,
        computeWorldFullLayout,
        computeWorldGridLayout,
        computeWorldSdfLayout,
        computeEmptyLayout,
        computeParamsLayout,
        computeContactEventsLayout,
        computeAllEventsLayout,
        computeMaximumDamageWindowEventsLayout,
        computeEnemyBehaviorEventsLayout,
        computeDirectionalDefenseEventsLayout,
        computeFixedControlLayout,
        computeSourceResolveLayout,
        computeTrackedPoseLayout,
        indirectLayout,
        renderBodiesLayout,
        renderParamsLayout,
        computePipelineLayouts,
        indirectPipelineLayout,
        renderPipelineLayout,
        effectBindingPlan,
        effectPipelineLayouts,
        formationBindingPlan,
        formationPipelineLayouts,
        atomicTransformBindingPlan,
        atomicTransformPipelineLayouts,
        projectileCaptureBodiesLayout,
        projectileCaptureParamsLayout,
        projectileCapturePipelineLayout,
        projectileCaptureReleaseLayout,
        projectileCaptureReleasePipelineLayout,
        routeRuntimeLayout,
        routeRuntimePipelineLayout,
        routeRuntimeWaitLayout,
        routeRuntimeWaitPipelineLayout
    };
}
