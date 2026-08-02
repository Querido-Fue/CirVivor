import {
    createTitleWebGpuOverlayRectToQuadHomography,
    resolveTitleWebGpuOverlayGlassVisualHalo,
    resolveTitleWebGpuOverlayProjectedQuad,
    resolveTitleWebGpuOverlayProjectedScissor
} from './_title_webgpu_overlay_projection.js';

const ROI_ALIGNMENT = 16;
const HALO_BUCKET = 8;
const ROI_UNION_AREA_RATIO = 1.35;
const DEFAULT_SIGMA_HALO_MULTIPLIER = 3;
const DEFAULT_SIGMA_HALO_PADDING = 2;

/**
 * OverlaySession 의미 snapshot과 analytic vignette를 overlay graph record로 변환합니다.
 * GPU resource 생성이나 command 제출은 하지 않습니다.
 */
export function recordTitleWebGpuOverlayFrame(options = {}) {
    const graph = requireGraph(options.graph);
    const frameId = requireNonNegativeInteger(options.frameId, 'frameId');
    const width = requirePositiveInteger(options.width, 'width');
    const height = requirePositiveInteger(options.height, 'height');
    const blurAlgorithmId = requireNonEmptyString(
        options.blurAlgorithmId,
        'blurAlgorithmId'
    );
    const blurPort = options.blurPort ?? null;
    const claimedSurfaceIds = new Set();
    const recordedStageIds = [];
    let glassPanelCount = 0;
    let uiSurfaceCount = 0;
    let dimNodeCount = 0;

    const vignettePacket = options.vignettePacket ?? null;
    const vignetteColor = normalizeVignetteColor(vignettePacket);
    if (graph.recordVignette({
        id: 'title:vignette',
        order: 50,
        bounds: { x: 0, y: 0, width, height },
        payload: {
            analyticNodes: [Object.freeze({
                kind: 'vignette',
                color: vignetteColor,
                opacity: vignettePacket?.visible === false ? 0 : 1,
                edgeWidth: positiveFiniteOr(vignettePacket?.edgeWidth, 1),
                cornerRadius: nonNegativeFiniteOr(vignettePacket?.cornerRadius, 0)
            })]
        }
    }) !== true) {
        throw new Error('title WebGPU vignette record가 거부되었습니다.');
    }
    recordedStageIds.push('title:vignette');

    const counters = {
        glassPanelCount: 0,
        uiSurfaceCount: 0,
        dimNodeCount: 0
    };
    const mainSnapshot = options.mainSnapshot ?? null;
    if (mainSnapshot) {
        assertSnapshotFrame(mainSnapshot, frameId);
        recordSessionSnapshot({
            graph,
            snapshot: mainSnapshot,
            stageMethod: 'recordTitleMenu',
            width,
            height,
            blurAlgorithmId,
            blurPort,
            claimedSurfaceIds,
            recordedStageIds,
            counters,
            // Title menu는 version label처럼 panel 밖 UI를 가질 수 있으므로
            // 명시적인 content authority가 생기기 전까지 full-screen을 유지합니다.
            allowPanelContentRoi: false
        });
    }

    const managerSnapshots = Array.isArray(options.managerSnapshots)
        ? options.managerSnapshots
        : [];
    for (const snapshot of managerSnapshots) {
        assertSnapshotFrame(snapshot, frameId);
        recordSessionSnapshot({
            graph,
            snapshot,
            // manager overlay의 dim/root/floating은 실제 DOM order로 서로 interleave되어야
            // 하므로 같은 stage rank 안에서 numeric order로 정렬합니다.
            stageMethod: 'recordRoot',
            width,
            height,
            blurAlgorithmId,
            blurPort,
            claimedSurfaceIds,
            recordedStageIds,
            counters,
            // manager stage라도 snapshot에 명시적 panel-content authority가 있을 때만
            // ROI를 허용합니다. 일반/custom overlay는 계속 full-screen입니다.
            allowPanelContentRoi: true
        });
    }

    const unclaimedSurfaceIds = [];
    const dynamicSurfaces = Array.isArray(options.dynamicSurfaces)
        ? options.dynamicSurfaces
        : [];
    for (const surface of dynamicSurfaces) {
        const surfaceId = normalizeOptionalId(surface?.id);
        if (!surfaceId || claimedSurfaceIds.has(surfaceId)) continue;
        if (surface?.isEmpty === true) {
            claimedSurfaceIds.add(surfaceId);
            continue;
        }
        const uiSurface = toUiSurface(surface, null, width, height);
        if (!uiSurface) {
            unclaimedSurfaceIds.push(surfaceId);
            continue;
        }
        const stageId = `title:dynamic:${surfaceId}`;
        if (graph.recordTooltip({
            id: stageId,
            order: finiteOr(surface.order, 0),
            bounds: { x: 0, y: 0, width, height },
            payload: { uiSurfaces: [uiSurface] }
        }) !== true) {
            throw new Error(`title WebGPU dynamic surface record가 거부되었습니다: ${surfaceId}`);
        }
        claimedSurfaceIds.add(surfaceId);
        recordedStageIds.push(stageId);
        counters.uiSurfaceCount += 1;
    }

    glassPanelCount += counters.glassPanelCount;
    uiSurfaceCount += counters.uiSurfaceCount;
    dimNodeCount += counters.dimNodeCount;
    return Object.freeze({
        complete: unclaimedSurfaceIds.length === 0,
        frameId,
        recordedStageCount: recordedStageIds.length,
        recordedStageIds: Object.freeze(recordedStageIds),
        claimedSurfaceIds: Object.freeze(Array.from(claimedSurfaceIds)),
        unclaimedSurfaceIds: Object.freeze(unclaimedSurfaceIds),
        glassPanelCount,
        uiSurfaceCount,
        dimNodeCount
    });
}

function recordSessionSnapshot(options) {
    const {
        graph,
        snapshot,
        stageMethod,
        width,
        height,
        blurAlgorithmId,
        blurPort,
        claimedSurfaceIds,
        recordedStageIds,
        counters,
        allowPanelContentRoi
    } = options;
    const record = graph[stageMethod].bind(graph);
    const sessionId = requireNonEmptyString(snapshot.sessionIdentity, 'sessionIdentity');
    const fullBounds = { x: 0, y: 0, width, height };

    claimSnapshotSurface(snapshot.dim?.surface, claimedSurfaceIds);
    claimSnapshotSurface(snapshot.root?.effectSurface, claimedSurfaceIds);
    claimSnapshotSurface(snapshot.root?.uiSurface, claimedSurfaceIds);
    claimSnapshotSurface(snapshot.floating?.effectSurface, claimedSurfaceIds);
    claimSnapshotSurface(snapshot.floating?.uiSurface, claimedSurfaceIds);

    const dimNodes = buildDimNodes(snapshot);
    if (dimNodes.length > 0) {
        const stageId = `${sessionId}:dim`;
        if (record({
            id: stageId,
            order: finiteOr(snapshot.dim?.order, snapshot.sortOrderBase - 1),
            bounds: fullBounds,
            payload: { analyticNodes: dimNodes }
        }) !== true) {
            throw new Error(`title WebGPU dim stage가 거부되었습니다: ${stageId}`);
        }
        recordedStageIds.push(stageId);
        counters.dimNodeCount += dimNodes.length;
    }

    for (const [suffix, stage] of [
        ['root', snapshot.root],
        ['floating', snapshot.floating]
    ]) {
        const stageResult = buildSurfaceStage({
            stage,
            presentation: snapshot.presentation,
            width,
            height,
            blurAlgorithmId,
            blurPort,
            allowPanelContentRoi
        });
        if (!stageResult) continue;
        const stageId = `${sessionId}:${suffix}`;
        if (record({
            id: stageId,
            order: finiteOr(stage?.order, snapshot.sortOrderBase),
            bounds: fullBounds,
            backdropBlurs: stageResult.backdropBlurs,
            contentBlurs: stageResult.contentBlurs,
            payload: stageResult.payload
        }) !== true) {
            throw new Error(`title WebGPU overlay stage가 거부되었습니다: ${stageId}`);
        }
        recordedStageIds.push(stageId);
        counters.glassPanelCount += stageResult.glassPanelCount;
        counters.uiSurfaceCount += stageResult.uiSurfaceCount;
    }
}

function buildDimNodes(snapshot) {
    if (!snapshot.dim) return [];
    const commands = Array.isArray(snapshot.dim.commands) ? snapshot.dim.commands : [];
    if (commands.length === 0) {
        const alpha = clamp01(
            finiteOr(snapshot.presentation?.effectiveDim, 0)
            * finiteOr(snapshot.presentation?.dimAlpha, 1)
        );
        return alpha > 0
            ? [Object.freeze({ kind: 'dim', color: [0, 0, 0, alpha], opacity: 1 })]
            : [];
    }
    return commands
        .map((command) => clamp01(finiteOr(command?.alpha, 0)))
        .filter((alpha) => alpha > 0)
        .map((alpha) => Object.freeze({
            kind: 'dim',
            color: Object.freeze([0, 0, 0, alpha]),
            // command alpha가 최종 표시값입니다. legacy capture용 surface opacity를
            // 다시 곱하면 dim transition이 이중 감쇠됩니다.
            opacity: 1
        }));
}

function buildSurfaceStage({
    stage,
    presentation,
    width,
    height,
    blurAlgorithmId,
    blurPort,
    allowPanelContentRoi
}) {
    if (!stage) return null;
    const commands = Array.isArray(stage.glassCommands) ? stage.glassCommands : [];
    const effectOpacity = clamp01(finiteOr(stage.effectSurface?.opacity, 1));
    const { requests, panelEntries } = buildBackdropGroups({
        commands,
        width,
        height,
        blurAlgorithmId,
        blurPort,
        effectOpacity
    });
    const uiSurfaces = [];
    const ui = toUiSurface(stage.uiSurface, presentation, width, height);
    if (ui) uiSurfaces.push(ui);

    // 의미 command가 없는 custom WebGL effect surface는 정확성 우선 fallback upload로 보존합니다.
    if (commands.length === 0) {
        const effect = toUiSurface(stage.effectSurface, presentation, width, height, false);
        if (effect) uiSurfaces.unshift(effect);
    }
    if (panelEntries.length === 0 && uiSurfaces.length === 0) return null;

    const contentSigma = nonNegativeFiniteOr(presentation?.contentBlur, 0);
    const trustedContent = allowPanelContentRoi === true
        ? buildTrustedPanelContentBounds(
            stage.contentBoundsAuthority,
            commands,
            width,
            height
        )
        : Object.freeze({
            bounds: null,
            reason: 'panel-content-roi-disabled'
        });
    const contentBlurRequest = contentSigma > 0.0001
        ? createContentBlurRequest({
            contentSigma,
            trustedContentBounds: trustedContent.bounds,
            trustedContentReason: trustedContent.reason,
            width,
            height,
            blurAlgorithmId,
            blurPort
        })
        : null;
    const contentBlurs = contentBlurRequest
        ? Object.freeze([contentBlurRequest])
        : Object.freeze([]);
    return {
        backdropBlurs: requests,
        contentBlurs,
        payload: Object.freeze({
            glassPanels: panelEntries,
            uiSurfaces: Object.freeze(uiSurfaces),
            bounds: Object.freeze({ x: 0, y: 0, width, height })
        }),
        glassPanelCount: panelEntries.length,
        uiSurfaceCount: uiSurfaces.length
    };
}

function createContentBlurRequest({
    contentSigma,
    trustedContentBounds,
    trustedContentReason,
    width,
    height,
    blurAlgorithmId,
    blurPort
}) {
    const algorithmHalo = resolveContentBlurAlgorithmHalo({
        blurPort,
        blurAlgorithmId,
        sigma: contentSigma
    });
    // Gaussian subpixel identity처럼 factory가 support=0을 증명하면 blur 결과가
    // source와 동일하므로 request와 ROI crop pass를 모두 생략합니다.
    if (algorithmHalo.value === 0) {
        return null;
    }
    if (!trustedContentBounds || algorithmHalo.value === null) {
        return Object.freeze({
            sigma: contentSigma,
            bounds: Object.freeze({ x: 0, y: 0, width, height }),
            halo: Object.freeze({ left: 0, top: 0, right: 0, bottom: 0 }),
            contentRoi: Object.freeze({
                mode: 'full-screen',
                reason: trustedContentReason
                    ?? algorithmHalo.reason
                    ?? 'content-roi-untrusted'
            })
        });
    }
    const gaussianFallback = Math.ceil(
        (contentSigma * DEFAULT_SIGMA_HALO_MULTIPLIER)
            + DEFAULT_SIGMA_HALO_PADDING
    );
    const requiredHalo = Math.ceil(
        Math.max(gaussianFallback, Math.ceil(algorithmHalo.value)) / HALO_BUCKET
    ) * HALO_BUCKET;
    return Object.freeze({
        sigma: contentSigma,
        bounds: Object.freeze({ ...trustedContentBounds }),
        halo: Object.freeze(buildAlignedHalo(
            trustedContentBounds,
            requiredHalo,
            width,
            height
        )),
        contentRoi: Object.freeze({ mode: 'panel', reason: null })
    });
}

function resolveContentBlurAlgorithmHalo({ blurPort, blurAlgorithmId, sigma }) {
    if (typeof blurPort?.getRequiredHalo !== 'function') {
        return Object.freeze({
            value: null,
            reason: 'algorithm-halo-resolver-missing'
        });
    }
    let algorithmHalo;
    try {
        algorithmHalo = blurPort.getRequiredHalo({
            algorithmId: blurAlgorithmId,
            sigma
        });
    } catch {
        return Object.freeze({
            value: null,
            reason: 'algorithm-halo-resolver-threw'
        });
    }
    if (!Number.isFinite(algorithmHalo) || algorithmHalo < 0) {
        return Object.freeze({
            value: null,
            reason: 'algorithm-halo-invalid'
        });
    }
    return Object.freeze({ value: Math.ceil(algorithmHalo), reason: null });
}

/**
 * 명시적으로 opt-in한 panel-bounded overlay의 captured bounds와 semantic glass
 * envelope를 합칩니다. 어느 한쪽이라도 증명하지 못하면 전체 화면 fallback입니다.
 */
function buildTrustedPanelContentBounds(authority, commands, width, height) {
    if (!authority || typeof authority !== 'object') {
        return Object.freeze({
            bounds: null,
            reason: 'explicit-content-authority-missing'
        });
    }
    if (authority.kind !== 'panel-content-bounds-v1'
        || authority.space !== 'presented-screen') {
        return Object.freeze({
            bounds: null,
            reason: 'explicit-content-authority-invalid'
        });
    }
    if (!Array.isArray(authority.bounds) || authority.bounds.length === 0) {
        return Object.freeze({
            bounds: null,
            reason: 'explicit-content-bounds-empty'
        });
    }

    let result = null;
    for (const entry of authority.bounds) {
        const bounds = resolveExplicitPanelContentBounds(entry, width, height);
        if (!bounds) {
            return Object.freeze({
                bounds: null,
                reason: 'explicit-content-bounds-invalid'
            });
        }
        result = result ? unionBounds(result, bounds) : bounds;
    }

    const quadScratch = new Float64Array(8);
    const homographyScratch = new Float64Array(9);
    for (const panel of commands) {
        const panelX = finiteOr(panel?.x, 0);
        const panelY = finiteOr(panel?.y, 0);
        const panelWidth = positiveFiniteOr(panel?.w, 0);
        const panelHeight = positiveFiniteOr(panel?.h, 0);
        if (!resolveTitleWebGpuOverlayProjectedQuad(
            panel,
            panelX,
            panelY,
            panelWidth,
            panelHeight,
            quadScratch
        )) {
            return Object.freeze({
                bounds: null,
                reason: 'glass-panel-projection-invalid'
            });
        }
        if (!createTitleWebGpuOverlayRectToQuadHomography(
            panelWidth,
            panelHeight,
            quadScratch,
            homographyScratch
        )) {
            return Object.freeze({
                bounds: null,
                reason: 'glass-panel-homography-invalid'
            });
        }
        const visualHalo = resolveTitleWebGpuOverlayGlassVisualHalo(panel, {
            // recording은 CSS color alpha를 해석하지 않으므로 그림자를 항상
            // 포함해 glass pass보다 작아질 수 없는 envelope를 만듭니다.
            shadowVisible: true
        });
        const bounds = resolveTitleWebGpuOverlayProjectedScissor(
            homographyScratch,
            panelWidth,
            panelHeight,
            visualHalo,
            width,
            height
        );
        if (!bounds) {
            return Object.freeze({
                bounds: null,
                reason: 'glass-panel-scissor-empty'
            });
        }
        result = result ? unionBounds(result, bounds) : bounds;
    }
    return Object.freeze({
        bounds: Object.freeze({ ...result }),
        reason: null
    });
}

function resolveExplicitPanelContentBounds(entry, width, height) {
    const x = Number(entry?.x);
    const y = Number(entry?.y);
    const entryWidth = Number(entry?.width);
    const entryHeight = Number(entry?.height);
    const lineWidth = nonNegativeFiniteOr(entry?.lineWidth, Number.NaN);
    const shadowBlur = nonNegativeFiniteOr(entry?.shadowBlur, Number.NaN);
    const shadowOffsetX = finiteOr(entry?.shadowOffsetX, Number.NaN);
    const shadowOffsetY = finiteOr(entry?.shadowOffsetY, Number.NaN);
    if (![x, y, entryWidth, entryHeight, lineWidth, shadowBlur,
        shadowOffsetX, shadowOffsetY].every(Number.isFinite)
        || entryWidth <= 0
        || entryHeight <= 0) {
        return null;
    }
    const baseHalo = Math.ceil((lineWidth * 0.5) + (shadowBlur * 3) + 2);
    const left = Math.max(0, Math.floor(x - baseHalo - Math.max(0, -shadowOffsetX)));
    const top = Math.max(0, Math.floor(y - baseHalo - Math.max(0, -shadowOffsetY)));
    const right = Math.min(
        width,
        Math.ceil(x + entryWidth + baseHalo + Math.max(0, shadowOffsetX))
    );
    const bottom = Math.min(
        height,
        Math.ceil(y + entryHeight + baseHalo + Math.max(0, shadowOffsetY))
    );
    if (right <= left || bottom <= top) return null;
    return { x: left, y: top, width: right - left, height: bottom - top };
}

function buildBackdropGroups({
    commands,
    width,
    height,
    blurAlgorithmId,
    blurPort,
    effectOpacity
}) {
    const groups = [];
    const entries = [];
    const projectedQuadScratch = new Float64Array(8);
    for (const panel of commands) {
        let groupIndex = null;
        if (panel?.sampleBackdrop !== false) {
            const bounds = getPanelBounds(panel, width, height, projectedQuadScratch);
            if (bounds) {
                const sigma = nonNegativeFiniteOr(panel.blur, 0);
                const requiredHalo = resolveRequiredHalo({
                    blurPort,
                    blurAlgorithmId,
                    sigma,
                    refractionStrength: panel.refractionStrength
                });
                groupIndex = findOrCreateBackdropGroup(
                    groups,
                    bounds,
                    sigma,
                    requiredHalo
                );
            }
        }
        entries.push(Object.freeze({
            panel,
            backdropIndex: groupIndex,
            opacity: effectOpacity
        }));
    }
    const requests = groups.map((group) => Object.freeze({
        sigma: group.sigma,
        bounds: Object.freeze({ ...group.bounds }),
        halo: Object.freeze(buildAlignedHalo(group.bounds, group.requiredHalo, width, height))
    }));
    return {
        requests: Object.freeze(requests),
        panelEntries: Object.freeze(entries)
    };
}

function findOrCreateBackdropGroup(groups, bounds, sigma, requiredHalo) {
    for (let index = 0; index < groups.length; index++) {
        const group = groups[index];
        if (!Object.is(group.sigma, sigma)) continue;
        const union = unionBounds(group.bounds, bounds);
        const unionArea = union.width * union.height;
        if (unionArea <= (group.areaSum + (bounds.width * bounds.height))
            * ROI_UNION_AREA_RATIO) {
            group.bounds = union;
            group.areaSum += bounds.width * bounds.height;
            group.requiredHalo = Math.max(group.requiredHalo, requiredHalo);
            return index;
        }
    }
    groups.push({
        sigma,
        bounds,
        areaSum: bounds.width * bounds.height,
        requiredHalo
    });
    return groups.length - 1;
}

function resolveRequiredHalo({ blurPort, blurAlgorithmId, sigma, refractionStrength }) {
    let blurHalo = Math.ceil((sigma * DEFAULT_SIGMA_HALO_MULTIPLIER)
        + DEFAULT_SIGMA_HALO_PADDING);
    if (typeof blurPort?.getRequiredHalo === 'function') {
        try {
            const required = blurPort.getRequiredHalo({
                algorithmId: blurAlgorithmId,
                sigma
            });
            if (Number.isFinite(required) && required >= 0) {
                blurHalo = Math.max(blurHalo, Math.ceil(required));
            }
        } catch {
            // optional preflight 실패는 보수적 sigma fallback으로 격리합니다.
        }
    }
    const refractionHalo = Math.ceil(Math.abs(finiteOr(refractionStrength, 0)) + 2);
    return Math.ceil(Math.max(blurHalo, refractionHalo) / HALO_BUCKET) * HALO_BUCKET;
}

function getPanelBounds(panel, width, height, projectedQuadScratch) {
    const panelX = finiteOr(panel?.x, 0);
    const panelY = finiteOr(panel?.y, 0);
    const panelWidth = positiveFiniteOr(panel?.w, 0);
    const panelHeight = positiveFiniteOr(panel?.h, 0);
    if (!resolveTitleWebGpuOverlayProjectedQuad(
        panel,
        panelX,
        panelY,
        panelWidth,
        panelHeight,
        projectedQuadScratch
    )) {
        return null;
    }

    let left = Number.POSITIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < 4; index++) {
        const x = projectedQuadScratch[index * 2];
        const y = projectedQuadScratch[(index * 2) + 1];
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
    }
    left = Math.max(0, Math.floor(left));
    top = Math.max(0, Math.floor(top));
    right = Math.min(width, Math.ceil(right));
    bottom = Math.min(height, Math.ceil(bottom));
    if (right <= left || bottom <= top) return null;
    return { x: left, y: top, width: right - left, height: bottom - top };
}

function buildAlignedHalo(bounds, requiredHalo, width, height) {
    const left = Math.max(0, Math.floor((bounds.x - requiredHalo) / ROI_ALIGNMENT)
        * ROI_ALIGNMENT);
    const top = Math.max(0, Math.floor((bounds.y - requiredHalo) / ROI_ALIGNMENT)
        * ROI_ALIGNMENT);
    const right = Math.min(
        width,
        Math.ceil((bounds.x + bounds.width + requiredHalo) / ROI_ALIGNMENT)
            * ROI_ALIGNMENT
    );
    const bottom = Math.min(
        height,
        Math.ceil((bounds.y + bounds.height + requiredHalo) / ROI_ALIGNMENT)
            * ROI_ALIGNMENT
    );
    return {
        left: bounds.x - left,
        top: bounds.y - top,
        right: right - (bounds.x + bounds.width),
        bottom: bottom - (bounds.y + bounds.height)
    };
}

function toUiSurface(surface, presentation, width, height, applyScale = true) {
    if (!surface?.canvas
        || surface.isEmpty === true
        || !Number.isSafeInteger(surface.contentRevision)
        || surface.contentRevision < 0) {
        return null;
    }
    const sourceWidth = requirePositiveInteger(
        surface.width ?? surface.canvas.width,
        `${surface.id ?? 'surface'} width`
    );
    const sourceHeight = requirePositiveInteger(
        surface.height ?? surface.canvas.height,
        `${surface.id ?? 'surface'} height`
    );
    const styleOpacity = Number.parseFloat(surface.canvas?.style?.opacity);
    const surfaceOpacity = Number.isFinite(surface.opacity)
        ? surface.opacity
        : (Number.isFinite(surface.appliedCompositeOpacity)
            ? surface.appliedCompositeOpacity
            : (Number.isFinite(styleOpacity) ? styleOpacity : 1));
    return Object.freeze({
        canvas: surface.canvas,
        revision: surface.contentRevision,
        width: sourceWidth,
        height: sourceHeight,
        bounds: Object.freeze({ x: 0, y: 0, width, height }),
        opacity: clamp01(surfaceOpacity),
        contentScale: applyScale
            ? positiveFiniteOr(presentation?.contentScale, 1)
            : 1,
        contentOrigin: Object.freeze({
            x: applyScale ? clamp01(finiteOr(presentation?.contentOrigin?.x, 0.5)) : 0.5,
            y: applyScale ? clamp01(finiteOr(presentation?.contentOrigin?.y, 0.5)) : 0.5
        })
    });
}

function claimSnapshotSurface(surface, claimedSurfaceIds) {
    const id = normalizeOptionalId(surface?.id);
    if (id) claimedSurfaceIds.add(id);
}

function assertSnapshotFrame(snapshot, frameId) {
    if (snapshot?.frameId !== frameId) {
        throw new Error(
            `stale title overlay snapshot입니다: ${String(snapshot?.frameId)} != ${frameId}`
        );
    }
}

function normalizeVignetteColor(packet) {
    const source = packet?.color;
    if ((Array.isArray(source) || ArrayBuffer.isView(source)) && source.length === 4) {
        return Object.freeze(Array.from(source, (value) => clamp01(finiteOr(value, 0))));
    }
    return Object.freeze([0, 0, 0, 0]);
}

function unionBounds(left, right) {
    const x = Math.min(left.x, right.x);
    const y = Math.min(left.y, right.y);
    const maxX = Math.max(left.x + left.width, right.x + right.width);
    const maxY = Math.max(left.y + left.height, right.y + right.height);
    return { x, y, width: maxX - x, height: maxY - y };
}

function requireGraph(graph) {
    for (const method of ['recordVignette', 'recordTitleMenu', 'recordRoot', 'recordTooltip']) {
        if (typeof graph?.[method] !== 'function') {
            throw new TypeError(`title overlay graph.${method}()가 필요합니다.`);
        }
    }
    return graph;
}

function normalizeOptionalId(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requireNonEmptyString(value, name) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new TypeError(`${name} 문자열이 필요합니다.`);
    }
    return value.trim();
}

function requirePositiveInteger(value, name) {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name}은 양의 안전한 정수여야 합니다.`);
    }
    return value;
}

function requireNonNegativeInteger(value, name) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${name}은 0 이상의 안전한 정수여야 합니다.`);
    }
    return value;
}

function finiteOr(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
}

function positiveFiniteOr(value, fallback) {
    const number = finiteOr(value, fallback);
    return number > 0 ? number : fallback;
}

function nonNegativeFiniteOr(value, fallback) {
    const number = finiteOr(value, fallback);
    return number >= 0 ? number : fallback;
}

function clamp01(value) {
    return Math.max(0, Math.min(1, finiteOr(value, 0)));
}
