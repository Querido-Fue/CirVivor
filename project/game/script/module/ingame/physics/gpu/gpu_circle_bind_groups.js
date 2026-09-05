import {
    COMPUTE_PIPELINE_PROFILE
} from './gpu_circle_pipeline_profiles.js';

/** Binds the session resource planes to the exact pipeline layouts. */
export function createGpuCircleBindGroups(device, { buffers: resourceBuffers, flowTexture, flowIntegrationTexture }, layouts, pipelines) {
    const {
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
        effectBindingPlan,
        formationBindingPlan,
        atomicTransformBindingPlan,
        projectileCaptureBodiesLayout,
        projectileCaptureParamsLayout,
        projectileCaptureReleaseLayout,
        routeRuntimeLayout,
        routeRuntimeWaitLayout
    } = layouts;
    const { effect, formation, atomicTransform } = pipelines;
    const resource = (buffer) => ({ buffer });
    const effectCommonBodyBuffers = {
        0: resourceBuffers.counts,
        1: resourceBuffers.physics,
        2: resourceBuffers.simulation,
        3: resourceBuffers.temporary,
        4: resourceBuffers.contactHandlers,
        5: resourceBuffers.effectSummaries,
        6: resourceBuffers.effectEmitterStates,
        7: resourceBuffers.effectPulseProgram,
        8: resourceBuffers.effectPoolState,
        11: resourceBuffers.effectCandidates,
        12: resourceBuffers.effectEvents
    };
    const effectWorldBuffers = {
        0: resourceBuffers.gridCounts,
        1: resourceBuffers.gridBodies,
        2: resourceBuffers.gridOverflow,
        4: resourceBuffers.sdf,
        5: flowTexture.createView({ dimension: '2d-array' }),
        6: flowIntegrationTexture.createView({ dimension: '2d-array' })
    };
    const createEffectBindGroupsForPool = (poolIndex) => {
        const input = poolIndex === 0
            ? resourceBuffers.effectInstancesA
            : resourceBuffers.effectInstancesB;
        const output = poolIndex === 0
            ? resourceBuffers.effectInstancesB
            : resourceBuffers.effectInstancesA;
        const bodyBuffers = {
            ...effectCommonBodyBuffers,
            9: input,
            10: output
        };
        return Object.fromEntries(Object.entries(effectBindingPlan).map(([
            entryPoint,
            [bodyBindings, worldBindings, usesParams]
        ]) => {
            const pipeline = effect[entryPoint];
            const groups = [];
            groups.push(device.createBindGroup({
                label: `cirvivor-gpu-effect-${entryPoint}-bodies-${poolIndex}`,
                layout: pipeline.getBindGroupLayout(0),
                entries: bodyBindings.map((binding) => ({
                    binding,
                    resource: resource(bodyBuffers[binding])
                }))
            }));
            if (worldBindings.length > 0 || usesParams) {
                groups.push(device.createBindGroup({
                    label: `cirvivor-gpu-effect-${entryPoint}-world-${poolIndex}`,
                    layout: pipeline.getBindGroupLayout(1),
                    entries: worldBindings.map((binding) => ({
                        binding,
                        resource: binding === 5 || binding === 6
                            ? effectWorldBuffers[binding]
                            : resource(effectWorldBuffers[binding])
                    }))
                }));
            }
            if (usesParams) {
                groups.push(device.createBindGroup({
                    label: `cirvivor-gpu-effect-${entryPoint}-params-${poolIndex}`,
                    layout: pipeline.getBindGroupLayout(2),
                    entries: [{
                        binding: 0,
                        resource: resource(resourceBuffers.computeParams)
                    }]
                }));
            }
            return [entryPoint, groups];
        }));
    };
    const effectByPool = [
        createEffectBindGroupsForPool(0),
        createEffectBindGroupsForPool(1)
    ];
    const formationCommonBodyBuffers = {
        0: resourceBuffers.counts,
        1: resourceBuffers.physics,
        2: resourceBuffers.simulation,
        3: resourceBuffers.temporary,
        4: resourceBuffers.contactHandlers,
        5: resourceBuffers.combatStates,
        6: resourceBuffers.formationStates,
        7: resourceBuffers.formationCandidates,
        8: resourceBuffers.formationPrepareProgram,
        9: resourceBuffers.formationTransformProgram,
        10: resourceBuffers.effectSummaries,
        11: resourceBuffers.effectEmitterStates,
        12: resourceBuffers.renderStyles,
        14: resourceBuffers.effectPoolState,
        15: resourceBuffers.enemyBehaviorStates,
        16: resourceBuffers.bodyControlStates,
        17: resourceBuffers.routeRuntimeStates,
        18: resourceBuffers.projectileCaptureStates,
        19: resourceBuffers.routeRuntimeTopology
    };
    const formationWorldBuffers = {
        0: resourceBuffers.gridCounts,
        1: resourceBuffers.gridBodies,
        2: resourceBuffers.gridOverflow,
        4: resourceBuffers.sdf,
        6: flowIntegrationTexture.createView({ dimension: '2d-array' })
    };
    const createFormationBindGroupsForPool = (poolIndex) => {
        const bodyBuffers = {
            ...formationCommonBodyBuffers,
            13: poolIndex === 0
                ? resourceBuffers.effectInstancesA
                : resourceBuffers.effectInstancesB
        };
        return Object.fromEntries(Object.entries(formationBindingPlan).map(([
            entryPoint,
            [bodyBindings, worldBindings, usesParams]
        ]) => {
            const pipeline = formation[entryPoint];
            const groups = [device.createBindGroup({
                label: `cirvivor-gpu-formation-${entryPoint}-bodies-${poolIndex}`,
                layout: pipeline.getBindGroupLayout(0),
                entries: bodyBindings.map((binding) => ({
                    binding,
                    resource: resource(bodyBuffers[binding])
                }))
            })];
            if (worldBindings.length > 0 || usesParams) {
                groups.push(device.createBindGroup({
                    label: `cirvivor-gpu-formation-${entryPoint}-world-${poolIndex}`,
                    layout: pipeline.getBindGroupLayout(1),
                    entries: worldBindings.map((binding) => ({
                        binding,
                        resource: binding === 6
                            ? formationWorldBuffers[binding]
                            : resource(formationWorldBuffers[binding])
                    }))
                }));
            }
            if (usesParams) {
                groups.push(device.createBindGroup({
                    label: `cirvivor-gpu-formation-${entryPoint}-params-${poolIndex}`,
                    layout: pipeline.getBindGroupLayout(2),
                    entries: [{
                        binding: 0,
                        resource: resource(resourceBuffers.computeParams)
                    }]
                }));
            }
            return [entryPoint, groups];
        }));
    };
    const formationByPool = [
        createFormationBindGroupsForPool(0),
        createFormationBindGroupsForPool(1)
    ];
    const atomicTransformCommonBuffers = {
        0: resourceBuffers.counts,
        1: resourceBuffers.physics,
        2: resourceBuffers.simulation,
        3: resourceBuffers.temporary,
        4: resourceBuffers.contactHandlers,
        5: resourceBuffers.combatStates,
        6: resourceBuffers.atomicTransformStates,
        7: resourceBuffers.atomicTransformPrepareProgram,
        8: resourceBuffers.atomicTransformProgram,
        9: resourceBuffers.effectSummaries,
        10: resourceBuffers.effectSummaries,
        11: resourceBuffers.effectEmitterStates,
        12: resourceBuffers.formationStates,
        13: resourceBuffers.renderStyles,
        14: resourceBuffers.enemyBehaviorStates,
        15: resourceBuffers.bodyControlStates,
        17: resourceBuffers.atomicTransformTemplatePhysics,
        18: resourceBuffers.atomicTransformTemplateSimulation,
        19: resourceBuffers.atomicTransformTemplateTemporary,
        20: resourceBuffers.atomicTransformTemplateContactHandlers,
        21: resourceBuffers.atomicTransformTemplateCombatStates,
        22: resourceBuffers.atomicTransformTemplateStates,
        23: resourceBuffers.atomicTransformTemplateEffectSummaries,
        24: resourceBuffers.atomicTransformTemplateEffectEmitters,
        25: resourceBuffers.atomicTransformTemplateFormationStates,
        26: resourceBuffers.atomicTransformTemplateRenderStyles,
        27: resourceBuffers.atomicTransformTemplateEnemyBehaviorStates,
        28: resourceBuffers.atomicTransformTemplateBodyControlStates,
        29: resourceBuffers.effectPoolState,
        30: resourceBuffers.routeRuntimeStates
    };
    const createAtomicTransformBindGroupsForPool = (poolIndex) => {
        const buffers = {
            ...atomicTransformCommonBuffers,
            16: poolIndex === 0
                ? resourceBuffers.effectInstancesA
                : resourceBuffers.effectInstancesB
        };
        return Object.fromEntries(Object.entries(
            atomicTransformBindingPlan
        ).map(([entryPoint, bindings]) => [
            entryPoint,
            device.createBindGroup({
                label: `cirvivor-gpu-atomic-transform-${entryPoint}-${poolIndex}`,
                layout: atomicTransform[entryPoint].getBindGroupLayout(0),
                entries: bindings.map((binding) => ({
                    binding,
                    resource: resource(buffers[binding])
                }))
            })
        ]));
    };
    const atomicTransformByPool = [
        createAtomicTransformBindGroupsForPool(0),
        createAtomicTransformBindGroupsForPool(1)
    ];
    const computeBodiesBase = device.createBindGroup({
        label: 'cirvivor-gpu-circle-compute-bodies-base',
        layout: computeBodiesBaseLayout,
        entries: [
            { binding: 0, resource: resource(resourceBuffers.counts) },
            { binding: 1, resource: resource(resourceBuffers.physics) },
            { binding: 2, resource: resource(resourceBuffers.simulation) },
            { binding: 3, resource: resource(resourceBuffers.temporary) }
        ]
    });
    const computeBodiesWithHandlers = device.createBindGroup({
        label: 'cirvivor-gpu-circle-compute-bodies-with-handlers',
        layout: computeBodiesWithHandlersLayout,
        entries: [
            { binding: 0, resource: resource(resourceBuffers.counts) },
            { binding: 1, resource: resource(resourceBuffers.physics) },
            { binding: 2, resource: resource(resourceBuffers.simulation) },
            { binding: 3, resource: resource(resourceBuffers.temporary) },
            { binding: 4, resource: resource(resourceBuffers.contactHandlers) }
        ]
    });
    const computeContactHandlingBodies = device.createBindGroup({
        label: 'cirvivor-gpu-circle-compute-contact-handling-bodies',
        layout: computeContactHandlingBodiesLayout,
        entries: [
            { binding: 0, resource: resource(resourceBuffers.counts) },
            { binding: 1, resource: resource(resourceBuffers.physics) },
            { binding: 2, resource: resource(resourceBuffers.simulation) },
            { binding: 4, resource: resource(resourceBuffers.contactHandlers) },
            { binding: 10, resource: resource(resourceBuffers.combatStates) }
        ]
    });
    const computeMaximumDamageWindowBodies = device.createBindGroup({
        label: 'cirvivor-gpu-circle-compute-maximum-damage-window-bodies',
        layout: computeMaximumDamageWindowBodiesLayout,
        entries: [
            { binding: 0, resource: resource(resourceBuffers.counts) },
            { binding: 1, resource: resource(resourceBuffers.physics) },
            { binding: 2, resource: resource(resourceBuffers.simulation) },
            { binding: 4, resource: resource(resourceBuffers.contactHandlers) },
            { binding: 10, resource: resource(resourceBuffers.combatStates) },
            { binding: 11, resource: resource(resourceBuffers.enemyBehaviorStates) }
        ]
    });
    const computeCoreDamageRequestBodies = device.createBindGroup({
        label: 'cirvivor-gpu-circle-compute-core-damage-request-bodies',
        layout: computeCoreDamageRequestBodiesLayout,
        entries: [
            { binding: 0, resource: resource(resourceBuffers.counts) },
            { binding: 1, resource: resource(resourceBuffers.physics) },
            { binding: 2, resource: resource(resourceBuffers.simulation) },
            { binding: 4, resource: resource(resourceBuffers.contactHandlers) },
            { binding: 10, resource: resource(resourceBuffers.combatStates) },
            { binding: 11, resource: resource(resourceBuffers.enemyBehaviorStates) }
        ]
    });
    const computeDirectCoreDamageRequestBodies = device.createBindGroup({
        label: 'cirvivor-gpu-circle-compute-direct-core-damage-request-bodies',
        layout: computeDirectCoreDamageRequestBodiesLayout,
        entries: [
            { binding: 0, resource: resource(resourceBuffers.counts) },
            { binding: 1, resource: resource(resourceBuffers.physics) },
            { binding: 2, resource: resource(resourceBuffers.simulation) },
            { binding: 10, resource: resource(resourceBuffers.combatStates) },
            { binding: 12, resource: resource(resourceBuffers.effectSummaries) }
        ]
    });
    const computeEnemyBehaviorBodies = device.createBindGroup({
        label: 'cirvivor-gpu-circle-compute-enemy-behavior-bodies',
        layout: computeEnemyBehaviorBodiesLayout,
        entries: [
            { binding: 0, resource: resource(resourceBuffers.counts) },
            { binding: 1, resource: resource(resourceBuffers.physics) },
            { binding: 2, resource: resource(resourceBuffers.simulation) },
            { binding: 11, resource: resource(resourceBuffers.enemyBehaviorStates) },
            {
                binding: 13,
                resource: resource(resourceBuffers.towerTargetQueryResults)
            }
        ]
    });
    const computeEnemyChargeImpactBodies = device.createBindGroup({
        label: 'cirvivor-gpu-circle-compute-enemy-charge-impact-bodies',
        layout: computeEnemyChargeImpactBodiesLayout,
        entries: [
            { binding: 0, resource: resource(resourceBuffers.counts) },
            { binding: 1, resource: resource(resourceBuffers.physics) },
            { binding: 2, resource: resource(resourceBuffers.simulation) },
            { binding: 11, resource: resource(resourceBuffers.enemyBehaviorStates) },
            {
                binding: 13,
                resource: resource(resourceBuffers.towerTargetQueryResults)
            },
            { binding: 16, resource: resource(resourceBuffers.enemyChargeImpacts) }
        ]
    });
    const computeDirectionalDefenseBodies = device.createBindGroup({
        label: 'cirvivor-gpu-circle-compute-directional-defense-bodies',
        layout: computeDirectionalDefenseBodiesLayout,
        entries: [
            { binding: 0, resource: resource(resourceBuffers.counts) },
            { binding: 1, resource: resource(resourceBuffers.physics) },
            { binding: 2, resource: resource(resourceBuffers.simulation) },
            { binding: 3, resource: resource(resourceBuffers.temporary) },
            { binding: 11, resource: resource(resourceBuffers.enemyBehaviorStates) },
            {
                binding: 13,
                resource: resource(resourceBuffers.towerTargetQueryResults)
            }
        ]
    });
    const computeAtomicTransformFirstHitBodies = device.createBindGroup({
        label: 'cirvivor-gpu-circle-compute-atomic-transform-first-hit-bodies',
        layout: computeAtomicTransformFirstHitBodiesLayout,
        entries: [
            { binding: 0, resource: resource(resourceBuffers.counts) },
            { binding: 1, resource: resource(resourceBuffers.physics) },
            { binding: 2, resource: resource(resourceBuffers.simulation) },
            { binding: 4, resource: resource(resourceBuffers.contactHandlers) },
            { binding: 14, resource: resource(resourceBuffers.atomicTransformStates) },
            { binding: 15, resource: resource(resourceBuffers.atomicTransformCandidates) }
        ]
    });
    const computeWorldFull = device.createBindGroup({
        label: 'cirvivor-gpu-circle-compute-world-full',
        layout: computeWorldFullLayout,
        entries: [
            { binding: 0, resource: resource(resourceBuffers.gridCounts) },
            { binding: 1, resource: resource(resourceBuffers.gridBodies) },
            { binding: 2, resource: resource(resourceBuffers.sdf) },
            { binding: 3, resource: resource(resourceBuffers.gridOverflow) },
            {
                binding: 4,
                resource: flowTexture.createView({ dimension: '2d-array' })
            }
        ]
    });
    const computeWorldGrid = device.createBindGroup({
        label: 'cirvivor-gpu-circle-compute-world-grid',
        layout: computeWorldGridLayout,
        entries: [
            { binding: 0, resource: resource(resourceBuffers.gridCounts) },
            { binding: 1, resource: resource(resourceBuffers.gridBodies) }
        ]
    });
    const computeWorldSdf = device.createBindGroup({
        label: 'cirvivor-gpu-circle-compute-world-sdf',
        layout: computeWorldSdfLayout,
        entries: [{ binding: 2, resource: resource(resourceBuffers.sdf) }]
    });
    const computeEmpty = device.createBindGroup({
        label: 'cirvivor-gpu-circle-compute-empty',
        layout: computeEmptyLayout,
        entries: []
    });
    const computeParams = device.createBindGroup({
        label: 'cirvivor-gpu-circle-compute-params',
        layout: computeParamsLayout,
        entries: [{ binding: 0, resource: resource(resourceBuffers.computeParams) }]
    });
    const computeContactEvents = device.createBindGroup({
        label: 'cirvivor-gpu-circle-compute-contact-events',
        layout: computeContactEventsLayout,
        entries: [
            { binding: 0, resource: resource(resourceBuffers.contactState) },
            { binding: 1, resource: resource(resourceBuffers.contacts) }
        ]
    });
    const computeAllEvents = device.createBindGroup({
        label: 'cirvivor-gpu-circle-compute-all-events',
        layout: computeAllEventsLayout,
        entries: [
            { binding: 0, resource: resource(resourceBuffers.contactState) },
            { binding: 1, resource: resource(resourceBuffers.contacts) },
            { binding: 2, resource: resource(resourceBuffers.appliedEvents) },
            { binding: 3, resource: resource(resourceBuffers.deathEvents) }
        ]
    });
    const computeMaximumDamageWindowEvents = device.createBindGroup({
        label: 'cirvivor-gpu-circle-compute-maximum-damage-window-events',
        layout: computeMaximumDamageWindowEventsLayout,
        entries: [
            { binding: 0, resource: resource(resourceBuffers.contactState) },
            { binding: 1, resource: resource(resourceBuffers.contacts) },
            { binding: 2, resource: resource(resourceBuffers.appliedEvents) }
        ]
    });
    const computeEnemyBehaviorEvents = device.createBindGroup({
        label: 'cirvivor-gpu-circle-compute-enemy-behavior-events',
        layout: computeEnemyBehaviorEventsLayout,
        entries: [
            { binding: 0, resource: resource(resourceBuffers.contactState) },
            { binding: 1, resource: resource(resourceBuffers.contacts) },
            { binding: 2, resource: resource(resourceBuffers.appliedEvents) }
        ]
    });
    const computeDirectionalDefenseEvents = device.createBindGroup({
        label: 'cirvivor-gpu-circle-compute-directional-defense-events',
        layout: computeDirectionalDefenseEventsLayout,
        entries: [
            { binding: 0, resource: resource(resourceBuffers.contactState) },
            { binding: 1, resource: resource(resourceBuffers.contacts) }
        ]
    });
    const computeFixedControl = device.createBindGroup({
        label: 'cirvivor-gpu-circle-compute-fixed-control',
        layout: computeFixedControlLayout,
        entries: [
            { binding: 0, resource: resource(resourceBuffers.counts) },
            { binding: 1, resource: resource(resourceBuffers.physics) },
            { binding: 2, resource: resource(resourceBuffers.simulation) },
            { binding: 5, resource: resource(resourceBuffers.bodyControlStates) },
            { binding: 6, resource: resource(resourceBuffers.bodyControlProgram) },
            {
                binding: 13,
                resource: resource(resourceBuffers.towerTargetQueryResults)
            }
        ]
    });
    const computeSourceResolve = device.createBindGroup({
        label: 'cirvivor-gpu-circle-compute-source-resolve',
        layout: computeSourceResolveLayout,
        entries: [
            { binding: 0, resource: resource(resourceBuffers.counts) },
            { binding: 1, resource: resource(resourceBuffers.physics) },
            { binding: 2, resource: resource(resourceBuffers.simulation) },
            { binding: 3, resource: resource(resourceBuffers.temporary) },
            { binding: 5, resource: resource(resourceBuffers.bodyControlStates) },
            { binding: 7, resource: resource(resourceBuffers.spawnProgram) },
            { binding: 10, resource: resource(resourceBuffers.combatStates) },
            { binding: 11, resource: resource(resourceBuffers.enemyBehaviorStates) },
            { binding: 12, resource: resource(resourceBuffers.effectSummaries) }
        ]
    });
    const computeTrackedPose = device.createBindGroup({
        label: 'cirvivor-gpu-circle-compute-tracked-pose',
        layout: computeTrackedPoseLayout,
        entries: [
            { binding: 0, resource: resource(resourceBuffers.counts) },
            { binding: 1, resource: resource(resourceBuffers.physics) },
            { binding: 2, resource: resource(resourceBuffers.simulation) },
            { binding: 3, resource: resource(resourceBuffers.temporary) },
            { binding: 8, resource: resource(resourceBuffers.trackedPoseConfig) },
            { binding: 9, resource: resource(resourceBuffers.trackedPoseOutput) }
        ]
    });
    const projectileCaptureBodies = device.createBindGroup({
        label: 'cirvivor-gpu-projectile-capture-bodies',
        layout: projectileCaptureBodiesLayout,
        entries: [
            { binding: 0, resource: resource(resourceBuffers.counts) },
            { binding: 1, resource: resource(resourceBuffers.physics) },
            { binding: 2, resource: resource(resourceBuffers.simulation) },
            { binding: 3, resource: resource(resourceBuffers.temporary) },
            { binding: 4, resource: resource(resourceBuffers.contactState) },
            { binding: 5, resource: resource(resourceBuffers.contacts) },
            { binding: 6, resource: resource(resourceBuffers.projectileCaptureStates) },
            { binding: 7, resource: resource(resourceBuffers.projectileCaptureCandidates) },
            { binding: 8, resource: resource(resourceBuffers.projectileCaptureRuntime) }
        ]
    });
    const projectileCaptureParams = device.createBindGroup({
        label: 'cirvivor-gpu-projectile-capture-params',
        layout: projectileCaptureParamsLayout,
        entries: [
            { binding: 0, resource: resource(resourceBuffers.projectileCaptureParams) },
            {
                binding: 1,
                resource: resource(resourceBuffers.projectileCaptureTargetConfig)
            }
        ]
    });
    const projectileCaptureReleaseBindGroup = device.createBindGroup({
        label: 'cirvivor-gpu-projectile-capture-release',
        layout: projectileCaptureReleaseLayout,
        entries: [
            { binding: 0, resource: resource(resourceBuffers.counts) },
            { binding: 1, resource: resource(resourceBuffers.physics) },
            { binding: 2, resource: resource(resourceBuffers.simulation) },
            { binding: 3, resource: resource(resourceBuffers.temporary) },
            { binding: 4, resource: resource(resourceBuffers.combatStates) },
            { binding: 5, resource: resource(resourceBuffers.projectileCaptureStates) },
            {
                binding: 6,
                resource: resource(resourceBuffers.projectileCaptureReleaseProgram)
            }
        ]
    });
    const routeRuntimeBindGroup = device.createBindGroup({
        label: 'cirvivor-gpu-route-runtime',
        layout: routeRuntimeLayout,
        entries: [
            { binding: 0, resource: resource(resourceBuffers.counts) },
            { binding: 1, resource: resource(resourceBuffers.physics) },
            { binding: 2, resource: resource(resourceBuffers.simulation) },
            { binding: 3, resource: resource(resourceBuffers.routeRuntimeStates) },
            { binding: 4, resource: resource(resourceBuffers.routeRuntimeTopology) },
            { binding: 5, resource: resource(resourceBuffers.routeAvailability) },
            { binding: 6, resource: resource(resourceBuffers.routeCleanupProgram) },
            { binding: 7, resource: resource(resourceBuffers.contactState) },
            { binding: 8, resource: resource(resourceBuffers.appliedEvents) },
            { binding: 9, resource: resource(resourceBuffers.routeRuntimeParams) }
        ]
    });
    const routeRuntimeWaitBindGroup = device.createBindGroup({
        label: 'cirvivor-gpu-route-runtime-wait',
        layout: routeRuntimeWaitLayout,
        entries: [
            { binding: 0, resource: resource(resourceBuffers.counts) },
            { binding: 1, resource: resource(resourceBuffers.physics) },
            { binding: 2, resource: resource(resourceBuffers.simulation) },
            { binding: 3, resource: resource(resourceBuffers.routeRuntimeStates) },
            { binding: 9, resource: resource(resourceBuffers.routeRuntimeParams) },
            { binding: 10, resource: resource(resourceBuffers.temporary) }
        ]
    });
    const bindGroups = {
        effectByPool,
        formationByPool,
        atomicTransformByPool,
        projectileCapture: [projectileCaptureBodies, projectileCaptureParams],
        projectileCaptureRelease: projectileCaptureReleaseBindGroup,
        routeRuntime: routeRuntimeBindGroup,
        routeRuntimeWait: routeRuntimeWaitBindGroup,
        computeProfiles: {
            [COMPUTE_PIPELINE_PROFILE.PHYSICS]: [
                computeBodiesBase,
                computeWorldFull,
                computeParams
            ],
            [COMPUTE_PIPELINE_PROFILE.BODY_CONTACTS]: [
                computeBodiesWithHandlers,
                computeWorldGrid,
                computeParams,
                computeContactEvents
            ],
            [COMPUTE_PIPELINE_PROFILE.WORLD_CONTACTS]: [
                computeBodiesBase,
                computeWorldSdf,
                computeParams,
                computeContactEvents
            ],
            [COMPUTE_PIPELINE_PROFILE.CONTACT_HANDLING]: [
                computeContactHandlingBodies,
                computeEmpty,
                computeParams,
                computeAllEvents
            ],
            [COMPUTE_PIPELINE_PROFILE.MAXIMUM_DAMAGE_WINDOW]: [
                computeMaximumDamageWindowBodies,
                computeEmpty,
                computeParams,
                computeMaximumDamageWindowEvents
            ],
            [COMPUTE_PIPELINE_PROFILE.CORE_DAMAGE_REQUEST]: [
                computeCoreDamageRequestBodies,
                computeEmpty,
                computeParams,
                computeMaximumDamageWindowEvents
            ],
            [COMPUTE_PIPELINE_PROFILE.DIRECT_CORE_DAMAGE_REQUEST]: [
                computeDirectCoreDamageRequestBodies,
                computeEmpty,
                computeParams,
                computeMaximumDamageWindowEvents
            ],
            [COMPUTE_PIPELINE_PROFILE.FIXED_CONTROL]: [
                computeFixedControl,
                computeEmpty,
                computeParams
            ],
            [COMPUTE_PIPELINE_PROFILE.SOURCE_RESOLVE]: [
                computeSourceResolve,
                computeEmpty,
                computeParams
            ],
            [COMPUTE_PIPELINE_PROFILE.ENEMY_BEHAVIOR]: [
                computeEnemyBehaviorBodies,
                computeWorldSdf,
                computeParams,
                computeEnemyBehaviorEvents
            ],
            [COMPUTE_PIPELINE_PROFILE.ENEMY_CHARGE_IMPACT]: [
                computeEnemyChargeImpactBodies,
                computeEmpty,
                computeParams,
                computeEnemyBehaviorEvents
            ],
            [COMPUTE_PIPELINE_PROFILE.DIRECTIONAL_DEFENSE_CLASSIFIER]: [
                computeDirectionalDefenseBodies,
                computeEmpty,
                computeParams,
                computeDirectionalDefenseEvents
            ],
            [COMPUTE_PIPELINE_PROFILE.ATOMIC_TRANSFORM_FIRST_HIT]: [
                computeAtomicTransformFirstHitBodies,
                computeEmpty,
                computeParams,
                computeMaximumDamageWindowEvents
            ],
            [COMPUTE_PIPELINE_PROFILE.TRACKED_POSE]: [
                computeTrackedPose
            ]
        },
        indirect: device.createBindGroup({
            label: 'cirvivor-gpu-circle-indirect',
            layout: indirectLayout,
            entries: [
                { binding: 0, resource: resource(resourceBuffers.counts) },
                { binding: 1, resource: resource(resourceBuffers.dispatchIndirect) },
                { binding: 2, resource: resource(resourceBuffers.drawIndirect) },
                { binding: 3, resource: resource(resourceBuffers.contactState) },
                { binding: 4, resource: resource(resourceBuffers.contacts) }
            ]
        }),
        renderBodies: device.createBindGroup({
            label: 'cirvivor-gpu-circle-render-bodies',
            layout: renderBodiesLayout,
            entries: [
                { binding: 0, resource: resource(resourceBuffers.counts) },
                { binding: 1, resource: resource(resourceBuffers.physics) },
                { binding: 2, resource: resource(resourceBuffers.temporary) },
                { binding: 3, resource: resource(resourceBuffers.renderStyles) },
                { binding: 4, resource: resource(resourceBuffers.simulation) },
                { binding: 5, resource: resource(resourceBuffers.enemyBehaviorStates) },
                { binding: 6, resource: resource(resourceBuffers.effectSummaries) },
                { binding: 7, resource: resource(resourceBuffers.formationStates) },
                {
                    binding: 8,
                    resource: resource(resourceBuffers.projectileCaptureStates)
                }
            ]
        }),
        renderParams: device.createBindGroup({
            label: 'cirvivor-gpu-circle-render-params',
            layout: renderParamsLayout,
            entries: [{ binding: 0, resource: resource(resourceBuffers.renderParams) }]
        })
    };
    return bindGroups;
}
