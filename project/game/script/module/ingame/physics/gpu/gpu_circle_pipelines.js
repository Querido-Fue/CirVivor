import {
    GPU_COLLISION_COMPUTE_WGSL,
    GPU_COLLISION_INDIRECT_WGSL,
    GPU_COLLISION_RENDER_WGSL
} from './gpu_collision_shaders.js';
import {
    GPU_EFFECT_RUNTIME_COMPUTE_WGSL,
    GPU_EFFECT_RUNTIME_ENTRY_POINT
} from './gpu_effect_runtime_shaders.js';
import {
    GPU_FORMATION_RUNTIME_COMPUTE_WGSL,
    GPU_FORMATION_RUNTIME_ENTRY_POINT
} from './gpu_formation_runtime_shaders.js';
import {
    GPU_ATOMIC_TRANSFORM_RUNTIME_COMPUTE_WGSL,
    GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT
} from './gpu_atomic_transform_runtime_shaders.js';
import {
    GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT
} from './gpu_projectile_capture_runtime_abi.js';
import {
    GPU_PROJECTILE_CAPTURE_RELEASE_WGSL,
    GPU_PROJECTILE_CAPTURE_RUNTIME_WGSL
} from './gpu_projectile_capture_runtime_shaders.js';
import {
    GPU_ROUTE_RUNTIME_ENTRY_POINT,
    GPU_ROUTE_RUNTIME_WGSL
} from './gpu_route_runtime_shaders.js';
import {
    COMPUTE_ENTRY_POINTS,
    COMPUTE_PIPELINE_PROFILE_BY_ENTRY_POINT
} from './gpu_circle_pipeline_profiles.js';

/** Compiles compute/indirect/render programs for one device and target format. */
export function createGpuCirclePipelines(device, format, layouts) {
    const {
        computePipelineLayouts,
        indirectPipelineLayout,
        renderPipelineLayout,
        effectPipelineLayouts,
        formationPipelineLayouts,
        atomicTransformPipelineLayouts,
        projectileCapturePipelineLayout,
        projectileCaptureReleasePipelineLayout,
        routeRuntimePipelineLayout,
        routeRuntimeWaitPipelineLayout
    } = layouts;
    const computeModule = device.createShaderModule({
        label: 'cirvivor-gpu-circle-compute-shader',
        code: GPU_COLLISION_COMPUTE_WGSL
    });
    const effectModule = device.createShaderModule({
        label: 'cirvivor-gpu-effect-runtime-compute-shader',
        code: GPU_EFFECT_RUNTIME_COMPUTE_WGSL
    });
    const formationModule = device.createShaderModule({
        label: 'cirvivor-gpu-formation-runtime-compute-shader',
        code: GPU_FORMATION_RUNTIME_COMPUTE_WGSL
    });
    const atomicTransformModule = device.createShaderModule({
        label: 'cirvivor-gpu-atomic-transform-runtime-compute-shader',
        code: GPU_ATOMIC_TRANSFORM_RUNTIME_COMPUTE_WGSL
    });
    const projectileCaptureModule = device.createShaderModule({
        label: 'cirvivor-gpu-projectile-capture-runtime-shader',
        code: GPU_PROJECTILE_CAPTURE_RUNTIME_WGSL
    });
    const projectileCaptureReleaseModule = device.createShaderModule({
        label: 'cirvivor-gpu-projectile-capture-release-shader',
        code: GPU_PROJECTILE_CAPTURE_RELEASE_WGSL
    });
    const routeRuntimeModule = device.createShaderModule({
        label: 'cirvivor-gpu-route-runtime-shader',
        code: GPU_ROUTE_RUNTIME_WGSL
    });
    const indirectModule = device.createShaderModule({
        label: 'cirvivor-gpu-circle-indirect-shader',
        code: GPU_COLLISION_INDIRECT_WGSL
    });
    const renderModule = device.createShaderModule({
        label: 'cirvivor-gpu-circle-render-shader',
        code: GPU_COLLISION_RENDER_WGSL
    });
    const compute = Object.fromEntries(COMPUTE_ENTRY_POINTS.map((entryPoint) => {
        const profile = COMPUTE_PIPELINE_PROFILE_BY_ENTRY_POINT[entryPoint];
        return [
            entryPoint,
            device.createComputePipeline({
                label: `cirvivor-gpu-circle-${entryPoint}`,
                layout: computePipelineLayouts[profile],
                compute: { module: computeModule, entryPoint }
            })
        ];
    }));
    const effect = Object.fromEntries(
        Object.values(GPU_EFFECT_RUNTIME_ENTRY_POINT).map((entryPoint) => [
            entryPoint,
            device.createComputePipeline({
                label: `cirvivor-gpu-effect-${entryPoint}`,
                layout: effectPipelineLayouts[entryPoint],
                compute: { module: effectModule, entryPoint }
            })
        ])
    );
    const formation = Object.fromEntries(
        Object.values(GPU_FORMATION_RUNTIME_ENTRY_POINT).map((entryPoint) => [
            entryPoint,
            device.createComputePipeline({
                label: `cirvivor-gpu-formation-${entryPoint}`,
                layout: formationPipelineLayouts[entryPoint],
                compute: { module: formationModule, entryPoint }
            })
        ])
    );
    const atomicTransform = Object.fromEntries(
        Object.values(GPU_ATOMIC_TRANSFORM_RUNTIME_ENTRY_POINT).map((
            entryPoint
        ) => [
            entryPoint,
            device.createComputePipeline({
                label: `cirvivor-gpu-atomic-transform-${entryPoint}`,
                layout: atomicTransformPipelineLayouts[entryPoint],
                compute: {
                    module: atomicTransformModule,
                    entryPoint
                }
            })
        ])
    );
    const projectileCapture = Object.fromEntries(
        Object.values(GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT)
            .filter((entryPoint) => ![
                GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.CLEAR_RELEASES,
                GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.PREFLIGHT_RELEASES,
                GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.SEAL_RELEASES,
                GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.COMMIT_RELEASES,
                GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.FINALIZE_RELEASES
            ].includes(entryPoint))
            .map((entryPoint) => [
                entryPoint,
                device.createComputePipeline({
                    label: `cirvivor-gpu-projectile-capture-${entryPoint}`,
                    layout: projectileCapturePipelineLayout,
                    compute: { module: projectileCaptureModule, entryPoint }
                })
            ])
    );
    const projectileCaptureRelease = Object.fromEntries([
        GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.CLEAR_RELEASES,
        GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.PREFLIGHT_RELEASES,
        GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.SEAL_RELEASES,
        GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.COMMIT_RELEASES,
        GPU_PROJECTILE_CAPTURE_RUNTIME_ENTRY_POINT.FINALIZE_RELEASES
    ].map((entryPoint) => [
        entryPoint,
        device.createComputePipeline({
            label: `cirvivor-gpu-projectile-capture-release-${entryPoint}`,
            layout: projectileCaptureReleasePipelineLayout,
            compute: { module: projectileCaptureReleaseModule, entryPoint }
        })
    ]));
    const routeRuntime = Object.freeze({
        advance: device.createComputePipeline({
            label: 'cirvivor-gpu-route-runtime-advance',
            layout: routeRuntimePipelineLayout,
            compute: {
                module: routeRuntimeModule,
                entryPoint: GPU_ROUTE_RUNTIME_ENTRY_POINT.ADVANCE
            }
        }),
        enforceWait: device.createComputePipeline({
            label: 'cirvivor-gpu-route-runtime-enforce-wait',
            layout: routeRuntimeWaitPipelineLayout,
            compute: {
                module: routeRuntimeModule,
                entryPoint: GPU_ROUTE_RUNTIME_ENTRY_POINT.ENFORCE_WAIT
            }
        }),
        finalize: device.createComputePipeline({
            label: 'cirvivor-gpu-route-runtime-finalize',
            layout: routeRuntimePipelineLayout,
            compute: {
                module: routeRuntimeModule,
                entryPoint: GPU_ROUTE_RUNTIME_ENTRY_POINT.FINALIZE
            }
        })
    });
    const pipelines = {
        compute,
        effect,
        formation,
        atomicTransform,
        projectileCapture,
        projectileCaptureRelease,
        routeRuntime,
        updateIndirectArgs: device.createComputePipeline({
            label: 'cirvivor-gpu-circle-update-indirect-args',
            layout: indirectPipelineLayout,
            compute: { module: indirectModule, entryPoint: 'update_indirect_args' }
        }),
        updateContactIndirectArgs: device.createComputePipeline({
            label: 'cirvivor-gpu-circle-update-contact-indirect-args',
            layout: indirectPipelineLayout,
            compute: {
                module: indirectModule,
                entryPoint: 'update_contact_indirect_args'
            }
        }),
        render: device.createRenderPipeline({
            label: 'cirvivor-gpu-circle-render',
            layout: renderPipelineLayout,
            vertex: { module: renderModule, entryPoint: 'vertex_main' },
            fragment: {
                module: renderModule,
                entryPoint: 'fragment_main',
                targets: [{
                    format,
                    blend: {
                        color: {
                            srcFactor: 'one',
                            dstFactor: 'one-minus-src-alpha',
                            operation: 'add'
                        },
                        alpha: {
                            srcFactor: 'one',
                            dstFactor: 'one-minus-src-alpha',
                            operation: 'add'
                        }
                    }
                }]
            },
            primitive: { topology: 'triangle-list' }
        })
    };
    return pipelines;
}
