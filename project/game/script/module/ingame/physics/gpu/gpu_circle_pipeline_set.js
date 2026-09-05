import { createGpuCirclePipelineLayouts } from './gpu_circle_pipeline_layouts.js';
import { createGpuCirclePipelines } from './gpu_circle_pipelines.js';
import { createGpuCircleBindGroups } from './gpu_circle_bind_groups.js';

/** Builds one device/session pipeline set. No entity, tick, or readback ownership. */
export class GpuCirclePipelineSet {
    constructor(device, format, resources) {
        const layouts = createGpuCirclePipelineLayouts(device);
        this.pipelines = createGpuCirclePipelines(device, format, layouts);
        this.bindGroups = createGpuCircleBindGroups(device, resources, layouts, this.pipelines);
    }
}
