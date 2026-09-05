import { readFile } from 'node:fs/promises';

// Contract checks span the dispatch owner and its resource-only setup modules.
export async function readGpuCircleImplementationSource() {
    const files = [
        'gpu_circle_body_simulation.js',
        'gpu_circle_pipeline_profiles.js',
        'gpu_circle_pipeline_layouts.js',
        'gpu_circle_pipelines.js',
        'gpu_circle_bind_groups.js'
    ];
    const sources = await Promise.all(files.map((file) => readFile(new URL(
        `../../project/game/script/module/ingame/physics/gpu/${file}`,
        import.meta.url
    ), 'utf8')));
    return sources.join('\n');
}
