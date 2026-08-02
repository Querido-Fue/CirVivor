import { TitleWebGpuOverlayCoordinator } from './_title_webgpu_overlay_coordinator.js';
import { TitleWebGpuOverlayCutover } from './_title_webgpu_overlay_cutover.js';
import { TitleWebGpuOverlayGraph } from './_title_webgpu_overlay_graph.js';
import { TitleWebGpuOverlayRenderer } from './_title_webgpu_overlay_renderer.js';

// 현재 title steady stack(vignette + main + manager dim/root/floating)을
// compaction 없이 한 번의 final layer pass로 유지합니다.
const DEFAULT_TITLE_OVERLAY_LIVE_STAGE_CAP = 5;

/** WebGPU overlay renderer/graph/cutover/coordinator를 하나의 소유 수명으로 조립합니다. */
export function createTitleWebGpuOverlayPipeline(options = {}) {
    const baseGraph = requireIdentity(options.baseGraph, 'baseGraph');
    const framePort = requireIdentity(options.framePort, 'framePort');
    const blurPort = requireIdentity(options.blurPort, 'blurPort');
    const surfaceProvider = requireFunction(options.surfaceProvider, 'surfaceProvider');
    const blurAlgorithmId = requireNonEmptyString(
        options.blurAlgorithmId,
        'blurAlgorithmId'
    );
    const rendererFactory = options.rendererFactory
        ?? ((dependencies) => new TitleWebGpuOverlayRenderer(dependencies));
    const cutoverFactory = options.cutoverFactory
        ?? ((dependencies) => new TitleWebGpuOverlayCutover(dependencies));
    const graphFactory = options.graphFactory
        ?? ((dependencies) => new TitleWebGpuOverlayGraph(dependencies));
    const coordinatorFactory = options.coordinatorFactory
        ?? ((dependencies) => new TitleWebGpuOverlayCoordinator(dependencies));

    let renderer = null;
    let cutover = null;
    let graph = null;
    try {
        renderer = rendererFactory({ framePort, blurPort });
        if (!renderer || typeof renderer.getPorts !== 'function') {
            throw new TypeError('overlay renderer.getPorts()가 필요합니다.');
        }
        const ports = renderer.getPorts();
        cutover = cutoverFactory({ surfaceProvider });
        graph = graphFactory({
            framePort,
            blurPort,
            blurAlgorithmId,
            maxLiveStages: options.maxLiveStages ?? DEFAULT_TITLE_OVERLAY_LIVE_STAGE_CAP,
            cutoverStatusProvider: () => cutover.getStatus(),
            materializePass: ports.materializePass,
            stagePass: ports.stagePass,
            presentPass: ports.presentPass,
            compactPass: ports.compactPass
        });
        return coordinatorFactory({
            baseGraph,
            graph,
            renderer,
            cutover,
            blurPort,
            blurAlgorithmId
        });
    } catch (error) {
        graph?.destroy?.();
        renderer?.destroy?.();
        cutover?.destroy?.();
        throw error;
    }
}

function requireIdentity(value, label) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
        throw new TypeError(`${label} identity가 필요합니다.`);
    }
    return value;
}

function requireFunction(value, label) {
    if (typeof value !== 'function') {
        throw new TypeError(`${label} 함수가 필요합니다.`);
    }
    return value;
}

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new TypeError(`${label} 문자열이 필요합니다.`);
    }
    return value.trim();
}
