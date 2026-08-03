const DEFAULT_LEGACY_SURFACE_IDS = Object.freeze([
    'background',
    'object',
    'effect',
    'texteffect',
    'ui',
    'vignette'
]);

const CUTOVER_STATE = Object.freeze({
    ARMED: 'armed',
    ACTIVE: 'active',
    FALLBACK_PENDING: 'fallback-pending',
    DESTROYED: 'destroyed'
});

// Canvas는 dynamic surface pool에서 재사용될 수 있으므로 instance-local snapshot만으로는
// stale cutover의 복구를 막을 수 없습니다. 가장 최근 owner epoch를 canvas 수명에 묶습니다.
const CANVAS_CUTOVER_LEASES = new WeakMap();
let nextOwnerEpoch = 0;

/**
 * Full-scene title WebGPU presentation과 legacy DOM surface visibility의 원자적
 * cutover를 관리합니다. GPU command나 scene draw 자체는 소유하지 않습니다.
 */
export class TitleWebGpuOverlayCutover {
    /**
     * @param {object} options - cutover 의존성입니다.
     * @param {Function} options.surfaceProvider - 현재 surface descriptor 배열을 반환합니다.
     * @param {object|Function} [options.ownerToken] - stale owner 복구를 막는 identity입니다.
     * @param {string[]} [options.legacySurfaceIds] - full cutover에서 숨길 정적 surface ID입니다.
     * @param {string} [options.webGpuSurfaceId='gpu-object'] - full scene을 표시할 WebGPU surface ID입니다.
     * @param {string} [options.topSurfaceId='top'] - 계속 표시할 제어 surface ID입니다.
     */
    constructor(options = {}) {
        if (typeof options.surfaceProvider !== 'function') {
            throw new TypeError('title WebGPU cutover surfaceProvider가 필요합니다.');
        }
        this.surfaceProvider = options.surfaceProvider;
        this.ownerToken = requireIdentity(
            options.ownerToken ?? Object.freeze({ kind: 'title-webgpu-cutover-owner' }),
            'cutover ownerToken'
        );
        this.ownerEpoch = allocateOwnerEpoch();
        this.legacySurfaceIds = new Set(
            normalizeSurfaceIdList(options.legacySurfaceIds ?? DEFAULT_LEGACY_SURFACE_IDS)
        );
        this.webGpuSurfaceId = normalizeSurfaceId(
            options.webGpuSurfaceId ?? 'gpu-object',
            'webGpuSurfaceId'
        );
        this.topSurfaceId = normalizeSurfaceId(
            options.topSurfaceId ?? 'top',
            'topSurfaceId'
        );
        if (this.legacySurfaceIds.has(this.webGpuSurfaceId)
            || this.legacySurfaceIds.has(this.topSurfaceId)
            || this.webGpuSurfaceId === this.topSurfaceId) {
            throw new Error('title WebGPU cutover surface 역할이 충돌합니다.');
        }

        this.state = CUTOVER_STATE.ARMED;
        this.destroyed = false;
        this.fallbackReason = null;
        this.lastCommittedFrameId = null;
        this.lastCommittedDeviceGeneration = null;
        this.lastRestoreReason = null;
        this.surfaceSnapshots = new Map();
        this.topSurfaceSnapshot = null;
        this.counters = {
            activationCount: 0,
            fallbackCount: 0,
            restoreCount: 0,
            synchronizeCount: 0,
            hiddenSurfaceCount: 0,
            neutralizedSurfaceCount: 0,
            rejectedCommitCount: 0,
            staleOwnerRejectCount: 0,
            providerFailureCount: 0,
            styleFailureCount: 0,
            destroyCount: 0
        };
    }

    /** 현재 presentation owner identity를 반환합니다. */
    getOwnerToken() {
        return this.ownerToken;
    }

    /**
     * scene draw 전에 fallback 복구 또는 active surface 동기화를 수행합니다.
     * @returns {{legacyDrawRequired:boolean, fullCutoverActive:boolean, fallbackRecovered:boolean, fallbackRedrawPending:boolean}}
     */
    beginFrame(ownerToken = this.ownerToken) {
        if (!this.#acceptOwner(ownerToken) || this.destroyed) {
            return createBeginFrameResult(true, false, false, false);
        }

        let fallbackRecovered = false;
        let fallbackRedrawPending = false;
        let activeQualified = false;
        if (this.state === CUTOVER_STATE.FALLBACK_PENDING) {
            fallbackRedrawPending = true;
            try {
                // 마지막 정상 GPU 화면을 계속 표시한 채 새 dynamic surface까지 숨기고,
                // 이번 프레임에 legacy backing을 완전히 다시 채웁니다.
                this.#synchronizeActiveSurfaces();
            } catch (error) {
                this.fallbackReason = `fallback-synchronize-failed:${error?.message ?? String(error)}`;
            }
        } else if (this.state === CUTOVER_STATE.ACTIVE) {
            try {
                const inspection = this.#synchronizeActiveSurfaces();
                activeQualified = inspection.cutoverQualified;
            } catch (error) {
                this.#enterFallback(
                    `cutover-synchronize-failed:${error?.message ?? String(error)}`
                );
                fallbackRedrawPending = true;
            }
        } else if (this.state === CUTOVER_STATE.ARMED) {
            try {
                this.#synchronizeArmedWebGpuSurface();
            } catch (error) {
                this.fallbackReason = `armed-webgpu-hide-failed:${error?.message ?? String(error)}`;
            }
        }

        const fullCutoverActive = this.state === CUTOVER_STATE.ACTIVE && activeQualified;
        return createBeginFrameResult(
            !fullCutoverActive,
            fullCutoverActive,
            fallbackRecovered,
            fallbackRedrawPending
        );
    }

    /**
     * composer commit callback에서만 full cutover를 활성화합니다.
     * @param {object} receipt - 같은 frame의 full-scene graph 사전 receipt입니다.
     * @returns {Readonly<object>} 활성화 뒤 qualification 상태입니다.
     */
    commitFrame(receipt, ownerToken = this.ownerToken) {
        if (!this.#acceptOwner(ownerToken) || this.destroyed) {
            return this.getStatus();
        }
        if (this.state === CUTOVER_STATE.FALLBACK_PENDING) {
            this.counters.rejectedCommitCount += 1;
            return this.getStatus();
        }

        const receiptOrder = compareReceiptToLastCommit(
            receipt,
            this.lastCommittedDeviceGeneration,
            this.lastCommittedFrameId
        );
        if (!isQualifyingCommittedReceipt(receipt)) {
            this.counters.rejectedCommitCount += 1;
            const receiptOrderUnorderable = Number.isNaN(receiptOrder);
            if (this.state === CUTOVER_STATE.ACTIVE
                && (receiptOrderUnorderable || receiptOrder > 0)) {
                this.#enterFallback(
                    receiptOrderUnorderable
                        ? 'invalid-unorderable-receipt'
                        : `invalid-newer-receipt:${receipt.deviceGeneration}:${receipt.frameId}`
                );
            }
            return this.getStatus();
        }
        if (receiptOrder < 0) {
            this.counters.rejectedCommitCount += 1;
            return this.getStatus();
        }
        if (receiptOrder === 0) {
            return this.getStatus();
        }

        const activatesFromArmed = this.state === CUTOVER_STATE.ARMED;
        try {
            const inspection = this.#synchronizeActiveSurfaces();
            if (!inspection.cutoverQualified) {
                throw new Error('cutover surface 사후조건이 충족되지 않았습니다.');
            }
        } catch (error) {
            this.#enterFallback(
                `cutover-activation-failed:${error?.message ?? String(error)}`
            );
            return this.getStatus();
        }

        this.state = CUTOVER_STATE.ACTIVE;
        this.fallbackReason = null;
        this.lastCommittedFrameId = receipt.frameId;
        this.lastCommittedDeviceGeneration = receipt.deviceGeneration;
        if (activatesFromArmed) {
            this.counters.activationCount += 1;
        }
        return this.getStatus();
    }

    /** active WebGPU frame abort를 기록합니다. Legacy surface는 다음 draw 직전에 복구합니다. */
    abortFrame(reason = 'composer-aborted', ownerToken = this.ownerToken) {
        if (!this.#acceptOwner(ownerToken) || this.destroyed) {
            return false;
        }
        if (this.state !== CUTOVER_STATE.ACTIVE) {
            return false;
        }
        this.#enterFallback(normalizeReason(reason));
        return true;
    }

    /**
     * 숨겨진 legacy backing의 전체 draw와 최종 flush가 끝난 경계에서만 fallback을 표시합니다.
     * @returns {boolean} legacy visible/WebGPU hidden 상태로 안전하게 전환했으면 true입니다.
     */
    completeFallbackRedraw(
        reason = 'fallback-redraw-complete',
        ownerToken = this.ownerToken
    ) {
        if (!this.#acceptOwner(ownerToken)
            || this.destroyed
            || this.state !== CUTOVER_STATE.FALLBACK_PENDING) {
            return false;
        }
        return this.#recoverFallback(normalizeReason(reason));
    }

    /** device loss/scene handoff처럼 즉시 원복이 필요한 경계에서 호출합니다. */
    restoreNow(reason = 'explicit-restore', ownerToken = this.ownerToken) {
        if (!this.#acceptOwner(ownerToken) || this.destroyed) {
            return false;
        }
        const normalizedReason = normalizeReason(reason);
        const restoration = this.#restoreSurfaces(normalizedReason, {
            preserveWebGpuHidden: true
        });
        if (restoration.complete) {
            this.state = CUTOVER_STATE.ARMED;
            this.fallbackReason = null;
        } else {
            this.#enterFallback(`restore-failed:${normalizedReason}`);
        }
        return restoration.restored;
    }

    /** active 중 늦게 생성된 dynamic surface도 같은 cutover에 포함합니다. */
    synchronize(ownerToken = this.ownerToken) {
        if (!this.#acceptOwner(ownerToken)
            || this.destroyed
            || this.state !== CUTOVER_STATE.ACTIVE) {
            return false;
        }
        try {
            return this.#synchronizeActiveSurfaces().cutoverQualified;
        } catch (error) {
            this.#enterFallback(
                `cutover-synchronize-failed:${error?.message ?? String(error)}`
            );
            return false;
        }
    }

    /** receipt qualification이 사용할 현재 cutover snapshot입니다. */
    getStatus() {
        const topology = analyzeSurfaceTopology(
            this.#readSurfaces(false),
            this.legacySurfaceIds,
            this.webGpuSurfaceId,
            this.topSurfaceId
        );
        const inspection = inspectCutoverSurfaces(
            topology,
            this.ownerToken,
            this.ownerEpoch,
            this.topSurfaceSnapshot
        );
        return Object.freeze({
            state: this.state,
            destroyed: this.destroyed,
            ownerEpoch: this.ownerEpoch,
            fullCutoverActive: this.state === CUTOVER_STATE.ACTIVE
                && inspection.cutoverQualified,
            fallbackPending: this.state === CUTOVER_STATE.FALLBACK_PENDING,
            fallbackReason: this.fallbackReason,
            legacyVisibleSurfaceCount: inspection.legacyVisibleSurfaceCount,
            hiddenLegacySurfaceCount: inspection.hiddenLegacySurfaceCount,
            requiredLegacySurfaceCount: inspection.requiredLegacySurfaceCount,
            presentLegacySurfaceCount: inspection.presentLegacySurfaceCount,
            missingLegacySurfaceIds: inspection.missingLegacySurfaceIds,
            webGpuSurfacePresent: inspection.webGpuSurfacePresent,
            webGpuSurfaceVisible: inspection.webGpuSurfaceVisible,
            topControlSurfacePresent: inspection.topControlSurfacePresent,
            topControlSurfacePreserved: inspection.topControlSurfacePreserved,
            surfaceTopologyQualified: inspection.surfaceTopologyQualified,
            cssPresentationNeutralized: inspection.cssPresentationNeutralized,
            trackedSurfaceCount: this.surfaceSnapshots.size,
            lastCommittedFrameId: this.lastCommittedFrameId,
            lastCommittedDeviceGeneration: this.lastCommittedDeviceGeneration,
            lastRestoreReason: this.lastRestoreReason,
            counters: Object.freeze({ ...this.counters })
        });
    }

    /** owner가 일치할 때만 visibility를 복구하고 idempotent하게 종료합니다. */
    destroy(ownerToken = this.ownerToken) {
        if (this.destroyed) {
            return false;
        }
        if (!this.#acceptOwner(ownerToken)) {
            return false;
        }
        this.#restoreSurfaces('destroy');
        this.destroyed = true;
        this.state = CUTOVER_STATE.DESTROYED;
        this.counters.destroyCount += 1;
        return true;
    }

    #acceptOwner(ownerToken) {
        if (ownerToken === this.ownerToken) {
            return true;
        }
        this.counters.staleOwnerRejectCount += 1;
        return false;
    }

    #readSurfaces(throwOnFailure = true) {
        try {
            const surfaces = this.surfaceProvider();
            if (!Array.isArray(surfaces)) {
                throw new TypeError('surfaceProvider는 배열을 반환해야 합니다.');
            }
            return surfaces;
        } catch (error) {
            this.counters.providerFailureCount += 1;
            if (throwOnFailure) throw error;
            return [];
        }
    }

    #enterFallback(reason) {
        if (this.state !== CUTOVER_STATE.FALLBACK_PENDING) {
            this.counters.fallbackCount += 1;
        }
        this.state = CUTOVER_STATE.FALLBACK_PENDING;
        this.fallbackReason = normalizeReason(reason);
    }

    #recoverFallback(reason) {
        const restoration = this.#restoreSurfaces(reason, {
            preserveWebGpuHidden: true
        });
        if (!restoration.complete) {
            return false;
        }
        this.state = CUTOVER_STATE.ARMED;
        this.fallbackReason = null;
        return true;
    }

    /** legacy presentation 중 candidate WebGPU surface만 숨기고 원본 visibility를 보관합니다. */
    #synchronizeArmedWebGpuSurface() {
        const surfaces = this.#readSurfaces(true)
            .map(normalizeSurfaceDescriptor)
            .filter(Boolean);
        return this.#hideWebGpuSurface(surfaces);
    }

    /** 이미 읽은 topology에서 candidate WebGPU surface의 lease와 hidden 상태를 확보합니다. */
    #hideWebGpuSurface(surfaces) {
        const matches = surfaces.filter((surface) => surface.id === this.webGpuSurfaceId);
        if (matches.length !== 1) {
            throw new Error(`armed WebGPU surface count=${matches.length}`);
        }
        const surface = matches[0];
        if (surfaces.some((candidate) => (
            candidate !== surface && candidate.canvas === surface.canvas
        ))) {
            throw new Error('armed WebGPU surface가 다른 surface와 canvas identity를 공유합니다.');
        }
        this.#assertCanvasLeasesClaimable([surface]);
        this.#claimCanvasLease(surface, 'webgpu');
        try {
            if (surface.canvas.style.visibility !== 'hidden') {
                surface.canvas.style.visibility = 'hidden';
            }
        } catch (error) {
            this.counters.styleFailureCount += 1;
            throw error;
        }
        return surface;
    }

    #synchronizeActiveSurfaces() {
        this.counters.synchronizeCount += 1;
        const topology = analyzeSurfaceTopology(
            this.#readSurfaces(true),
            this.legacySurfaceIds,
            this.webGpuSurfaceId,
            this.topSurfaceId
        );
        if (!topology.qualified) {
            throw new Error(describeTopologyFailure(topology));
        }

        const topSurface = topology.topSurface;
        if (this.topSurfaceSnapshot
            && this.topSurfaceSnapshot.canvas !== topSurface.canvas) {
            throw new Error('top control surface identity가 active 중 변경되었습니다.');
        }
        const topStyleBefore = createStyleSnapshot(topSurface.canvas.style);

        this.#assertCanvasLeasesClaimable(topology.managedSurfaces);
        const managedLeases = [];
        for (const surface of topology.managedSurfaces) {
            const role = surface.id === this.webGpuSurfaceId ? 'webgpu' : 'legacy';
            const claim = this.#claimCanvasLease(surface, role);
            managedLeases.push({ surface, role, lease: claim.lease });
            if (claim.created && surface.dynamic && role === 'legacy') {
                // 필드명은 호환을 유지하되, 값은 CSS neutralization이 아니라
                // visibility-only presentation ownership 획득 횟수입니다.
                this.counters.neutralizedSurfaceCount += 1;
            }
        }

        const visibilityMutations = [];
        const topSurfaceSnapshotBefore = this.topSurfaceSnapshot;
        try {
            for (const { surface, role } of managedLeases) {
                const desiredVisibility = role === 'webgpu' ? 'visible' : 'hidden';
                if (surface.canvas.style.visibility !== desiredVisibility) {
                    visibilityMutations.push({
                        canvas: surface.canvas,
                        visibility: surface.canvas.style.visibility
                    });
                    try {
                        surface.canvas.style.visibility = desiredVisibility;
                    } catch (error) {
                        this.counters.styleFailureCount += 1;
                        throw error;
                    }
                    if (role === 'legacy') {
                        this.counters.hiddenSurfaceCount += 1;
                    }
                }
            }

            if (!styleSnapshotEquals(topSurface.canvas.style, topStyleBefore)) {
                throw new Error('top control surface style이 cutover 중 변경되었습니다.');
            }
            this.topSurfaceSnapshot ??= Object.freeze({
                id: topSurface.id,
                canvas: topSurface.canvas
            });

            const inspection = inspectCutoverSurfaces(
                topology,
                this.ownerToken,
                this.ownerEpoch,
                this.topSurfaceSnapshot
            );
            if (!inspection.cutoverQualified) {
                throw new Error(describeInspectionFailure(inspection));
            }
            return inspection;
        } catch (error) {
            rollbackVisibilityMutations(visibilityMutations, this.counters);
            this.topSurfaceSnapshot = topSurfaceSnapshotBefore;
            throw error;
        }
    }

    #assertCanvasLeasesClaimable(surfaces) {
        for (const surface of surfaces) {
            const lease = CANVAS_CUTOVER_LEASES.get(surface.canvas);
            if (!lease) continue;
            if (lease.ownerEpoch > this.ownerEpoch
                || (lease.ownerEpoch === this.ownerEpoch
                    && lease.ownerToken !== this.ownerToken)) {
                throw new Error(
                    `surface lease가 newer owner에 속합니다: ${surface.id}`
                );
            }
        }
    }

    #claimCanvasLease(surface, role) {
        const { id, canvas } = surface;
        const currentLease = CANVAS_CUTOVER_LEASES.get(canvas);
        if (currentLease
            && currentLease.ownerEpoch === this.ownerEpoch
            && currentLease.ownerToken === this.ownerToken
            && currentLease.id === id
            && currentLease.role === role
            && currentLease.released !== true) {
            this.surfaceSnapshots.set(canvas, currentLease);
            return { lease: currentLease, created: false };
        }

        const transfersActiveIdentity = currentLease
            && currentLease.released !== true
            && currentLease.id === id
            && currentLease.canvas === canvas;
        const lease = Object.freeze({
            ownerToken: this.ownerToken,
            ownerEpoch: this.ownerEpoch,
            id,
            canvas,
            role,
            originalVisibility: transfersActiveIdentity
                ? currentLease.originalVisibility
                : normalizeVisibility(canvas.style.visibility),
            released: false
        });
        CANVAS_CUTOVER_LEASES.set(canvas, lease);
        this.surfaceSnapshots.set(canvas, lease);
        return { lease, created: true };
    }

    #restoreSurfaces(reason, { preserveWebGpuHidden = false } = {}) {
        const normalizedReason = normalizeReason(reason);
        this.lastRestoreReason = normalizedReason;
        if (this.surfaceSnapshots.size === 0 && !preserveWebGpuHidden) {
            this.topSurfaceSnapshot = null;
            return { restored: false, complete: true };
        }

        let currentSurfaces;
        try {
            currentSurfaces = this.#readSurfaces(true)
                .map(normalizeSurfaceDescriptor)
                .filter(Boolean);
        } catch {
            return { restored: false, complete: false };
        }

        const visibilityMutations = [];
        if (preserveWebGpuHidden) {
            const currentWebGpuMatches = currentSurfaces.filter(
                (surface) => surface.id === this.webGpuSurfaceId
            );
            if (currentWebGpuMatches.length > 1) {
                return { restored: false, complete: false };
            }
            if (currentWebGpuMatches.length === 1
                && currentSurfaces.some((surface) => (
                    surface !== currentWebGpuMatches[0]
                    && surface.canvas === currentWebGpuMatches[0].canvas
                ))) {
                return { restored: false, complete: false };
            }

            const trackedWebGpuLeases = [...this.surfaceSnapshots.values()].filter(
                (lease) => lease.role === 'webgpu'
                    && lease.ownerEpoch === this.ownerEpoch
                    && lease.ownerToken === this.ownerToken
                    && CANVAS_CUTOVER_LEASES.get(lease.canvas) === lease
            );
            const candidateCanvases = new Set([
                ...currentWebGpuMatches.map((surface) => surface.canvas),
                ...trackedWebGpuLeases.map((lease) => lease.canvas)
            ]);
            try {
                // legacy를 노출하기 전에 candidate를 먼저 숨깁니다. 같은 surface snapshot을
                // 사용하고, provider에서 사라진 경우에도 소유 중인 tracked canvas를 숨깁니다.
                if (currentWebGpuMatches.length === 1) {
                    this.#assertCanvasLeasesClaimable(currentWebGpuMatches);
                    this.#claimCanvasLease(currentWebGpuMatches[0], 'webgpu');
                }
                for (const candidateCanvas of candidateCanvases) {
                    if (candidateCanvas.style.visibility !== 'hidden') {
                        visibilityMutations.push({
                            canvas: candidateCanvas,
                            visibility: candidateCanvas.style.visibility
                        });
                        candidateCanvas.style.visibility = 'hidden';
                    }
                }
            } catch {
                this.counters.styleFailureCount += 1;
                rollbackVisibilityMutations(visibilityMutations, this.counters);
                return { restored: false, complete: false };
            }
        }

        let restored = false;
        const leasesToRelease = [];
        for (const [canvas, lease] of [...this.surfaceSnapshots]) {
            const currentLease = CANVAS_CUTOVER_LEASES.get(canvas);
            if (currentLease !== lease
                || lease.ownerEpoch !== this.ownerEpoch
                || lease.ownerToken !== this.ownerToken) {
                this.surfaceSnapshots.delete(canvas);
                continue;
            }

            if (preserveWebGpuHidden && lease.role === 'webgpu') {
                continue;
            }

            const descriptorIdentityMatches = currentSurfaces.some(
                (surface) => surface.id === lease.id && surface.canvas === canvas
            );
            if (!descriptorIdentityMatches) {
                leasesToRelease.push({ canvas, lease });
                continue;
            }

            try {
                if (canvas.style.visibility !== lease.originalVisibility) {
                    visibilityMutations.push({
                        canvas,
                        visibility: canvas.style.visibility
                    });
                    canvas.style.visibility = lease.originalVisibility;
                    restored = true;
                }
            } catch {
                this.counters.styleFailureCount += 1;
                rollbackVisibilityMutations(visibilityMutations, this.counters);
                return { restored: false, complete: false };
            }
            leasesToRelease.push({ canvas, lease });
        }

        for (const { canvas, lease } of leasesToRelease) {
            CANVAS_CUTOVER_LEASES.set(canvas, createReleasedLease(lease));
            this.surfaceSnapshots.delete(canvas);
        }
        this.topSurfaceSnapshot = null;
        if (restored) {
            this.counters.restoreCount += 1;
        }
        return { restored, complete: true };
    }
}

export const TITLE_WEBGPU_OVERLAY_CUTOVER_STATE = CUTOVER_STATE;

function isQualifyingCommittedReceipt(receipt) {
    return Boolean(receipt)
        && receipt.committed === true
        && receipt.baseCheckpointConsumed === true
        && receipt.vignetteIncluded === true
        && receipt.fullScenePresented === true
        && receipt.finalCanvasPassCount === 1
        && isValidReceiptIdentity(receipt);
}

function isValidReceiptIdentity(receipt) {
    return Number.isSafeInteger(receipt?.frameId)
        && receipt.frameId >= 0
        && Number.isSafeInteger(receipt?.deviceGeneration)
        && receipt.deviceGeneration >= 0;
}

function compareReceiptToLastCommit(receipt, lastGeneration, lastFrameId) {
    if (!Number.isSafeInteger(receipt?.deviceGeneration)
        || receipt.deviceGeneration < 0) {
        return Number.NaN;
    }
    if (lastGeneration === null || lastFrameId === null) {
        return isValidReceiptIdentity(receipt) ? 1 : Number.NaN;
    }
    if (receipt.deviceGeneration !== lastGeneration) {
        return receipt.deviceGeneration > lastGeneration ? 1 : -1;
    }
    if (!Number.isSafeInteger(receipt?.frameId) || receipt.frameId < 0) {
        return Number.NaN;
    }
    if (receipt.frameId === lastFrameId) return 0;
    return receipt.frameId > lastFrameId ? 1 : -1;
}

function normalizeSurfaceDescriptor(descriptor) {
    const id = typeof descriptor?.id === 'string' ? descriptor.id.trim() : '';
    const canvas = descriptor?.canvas;
    if (!id || !canvas?.style) return null;
    return {
        id,
        canvas,
        dynamic: descriptor.dynamic === true
            || descriptor.group === 'dynamic'
            || id.startsWith('dynamic:')
    };
}

function analyzeSurfaceTopology(
    surfaces,
    legacySurfaceIds,
    webGpuSurfaceId,
    topSurfaceId
) {
    const normalizedSurfaces = surfaces
        .map(normalizeSurfaceDescriptor)
        .filter(Boolean);
    const surfacesById = new Map();
    const seenCanvases = new Set();
    let duplicateCanvasIdentity = false;
    for (const surface of normalizedSurfaces) {
        const matches = surfacesById.get(surface.id) ?? [];
        matches.push(surface);
        surfacesById.set(surface.id, matches);
        if (seenCanvases.has(surface.canvas)) {
            duplicateCanvasIdentity = true;
        }
        seenCanvases.add(surface.canvas);
    }

    const missingLegacySurfaceIds = [];
    let duplicateRequiredSurfaceId = false;
    for (const id of legacySurfaceIds) {
        const matches = surfacesById.get(id) ?? [];
        if (matches.length === 0) missingLegacySurfaceIds.push(id);
        if (matches.length > 1) duplicateRequiredSurfaceId = true;
    }
    const webGpuMatches = surfacesById.get(webGpuSurfaceId) ?? [];
    const topMatches = surfacesById.get(topSurfaceId) ?? [];
    const webGpuSurface = webGpuMatches.length === 1 ? webGpuMatches[0] : null;
    const topSurface = topMatches.length === 1 ? topMatches[0] : null;
    const managedSurfaces = normalizedSurfaces.filter((surface) => (
        surface.id === webGpuSurfaceId
        || legacySurfaceIds.has(surface.id)
        || (surface.dynamic
            && surface.id !== topSurfaceId
            && surface.id !== webGpuSurfaceId)
    ));
    const qualified = missingLegacySurfaceIds.length === 0
        && !duplicateRequiredSurfaceId
        && webGpuMatches.length === 1
        && topMatches.length === 1
        && !duplicateCanvasIdentity;

    return {
        normalizedSurfaces,
        managedSurfaces,
        requiredLegacySurfaceCount: legacySurfaceIds.size,
        presentLegacySurfaceCount: legacySurfaceIds.size - missingLegacySurfaceIds.length,
        missingLegacySurfaceIds,
        duplicateRequiredSurfaceId,
        duplicateCanvasIdentity,
        webGpuSurface,
        webGpuMatchCount: webGpuMatches.length,
        topSurface,
        topMatchCount: topMatches.length,
        qualified
    };
}

function inspectCutoverSurfaces(topology, ownerToken, ownerEpoch, topSurfaceSnapshot) {
    let legacyVisibleSurfaceCount = 0;
    let hiddenLegacySurfaceCount = 0;
    let cssPresentationNeutralized = true;
    for (const surface of topology.managedSurfaces) {
        if (surface === topology.webGpuSurface) continue;
        const hiddenByCutover = surface.canvas.style.visibility === 'hidden';
        if (hiddenByCutover) {
            hiddenLegacySurfaceCount += 1;
        } else {
            legacyVisibleSurfaceCount += 1;
        }
        const lease = CANVAS_CUTOVER_LEASES.get(surface.canvas);
        if (!isActiveLeaseOwnedBy(lease, surface, ownerToken, ownerEpoch, 'legacy')) {
            cssPresentationNeutralized = false;
        }
    }

    const webGpuSurfacePresent = Boolean(topology.webGpuSurface);
    const webGpuLease = topology.webGpuSurface
        ? CANVAS_CUTOVER_LEASES.get(topology.webGpuSurface.canvas)
        : null;
    const webGpuSurfaceVisible = webGpuSurfacePresent
        && topology.webGpuSurface.canvas.style.visibility === 'visible'
        && isSurfaceVisible(topology.webGpuSurface.canvas.style);
    const webGpuPresentationOwned = webGpuSurfacePresent
        && isActiveLeaseOwnedBy(
            webGpuLease,
            topology.webGpuSurface,
            ownerToken,
            ownerEpoch,
            'webgpu'
        );
    const topControlSurfacePresent = Boolean(topology.topSurface);
    const topControlSurfacePreserved = topControlSurfacePresent
        && Boolean(topSurfaceSnapshot)
        && topSurfaceSnapshot.id === topology.topSurface.id
        && topSurfaceSnapshot.canvas === topology.topSurface.canvas;
    const cutoverQualified = topology.qualified
        && legacyVisibleSurfaceCount === 0
        && webGpuSurfaceVisible
        && webGpuPresentationOwned
        && topControlSurfacePreserved
        && cssPresentationNeutralized;

    return {
        cutoverQualified,
        surfaceTopologyQualified: topology.qualified,
        legacyVisibleSurfaceCount,
        hiddenLegacySurfaceCount,
        requiredLegacySurfaceCount: topology.requiredLegacySurfaceCount,
        presentLegacySurfaceCount: topology.presentLegacySurfaceCount,
        missingLegacySurfaceIds: Object.freeze([...topology.missingLegacySurfaceIds]),
        webGpuSurfacePresent,
        webGpuSurfaceVisible,
        topControlSurfacePresent,
        topControlSurfacePreserved,
        cssPresentationNeutralized
    };
}

function isActiveLeaseOwnedBy(lease, surface, ownerToken, ownerEpoch, role) {
    return Boolean(lease)
        && lease.released !== true
        && lease.ownerToken === ownerToken
        && lease.ownerEpoch === ownerEpoch
        && lease.id === surface.id
        && lease.canvas === surface.canvas
        && lease.role === role;
}

function isSurfaceVisible(style) {
    const opacity = Number.parseFloat(style.opacity);
    return style.visibility !== 'hidden'
        && style.visibility !== 'collapse'
        && style.display !== 'none'
        && (!Number.isFinite(opacity) || opacity > 0);
}

function createStyleSnapshot(style) {
    return Object.freeze({
        visibility: normalizeVisibility(style.visibility),
        display: style.display ?? '',
        opacity: style.opacity ?? '',
        transform: style.transform ?? '',
        transformOrigin: style.transformOrigin ?? '',
        filter: style.filter ?? ''
    });
}

function styleSnapshotEquals(style, snapshot) {
    return Boolean(style && snapshot)
        && normalizeVisibility(style.visibility) === snapshot.visibility
        && (style.display ?? '') === snapshot.display
        && (style.opacity ?? '') === snapshot.opacity
        && (style.transform ?? '') === snapshot.transform
        && (style.transformOrigin ?? '') === snapshot.transformOrigin
        && (style.filter ?? '') === snapshot.filter;
}

function createReleasedLease(lease) {
    return Object.freeze({
        ...lease,
        released: true
    });
}

function rollbackVisibilityMutations(mutations, counters) {
    for (let index = mutations.length - 1; index >= 0; index--) {
        const mutation = mutations[index];
        try {
            mutation.canvas.style.visibility = mutation.visibility;
        } catch {
            counters.styleFailureCount += 1;
        }
    }
}

function createBeginFrameResult(
    legacyDrawRequired,
    fullCutoverActive,
    fallbackRecovered,
    fallbackRedrawPending
) {
    return Object.freeze({
        legacyDrawRequired,
        fullCutoverActive,
        fallbackRecovered,
        ...(fallbackRedrawPending ? { fallbackRedrawPending: true } : {})
    });
}

function describeTopologyFailure(topology) {
    const reasons = [];
    if (topology.missingLegacySurfaceIds.length > 0) {
        reasons.push(`missing legacy=${topology.missingLegacySurfaceIds.join(',')}`);
    }
    if (topology.webGpuMatchCount !== 1) {
        reasons.push(`webgpu count=${topology.webGpuMatchCount}`);
    }
    if (topology.topMatchCount !== 1) {
        reasons.push(`top count=${topology.topMatchCount}`);
    }
    if (topology.duplicateRequiredSurfaceId) {
        reasons.push('duplicate required legacy id');
    }
    if (topology.duplicateCanvasIdentity) {
        reasons.push('duplicate canvas identity');
    }
    return `cutover surface topology가 불완전합니다: ${reasons.join('; ')}`;
}

function describeInspectionFailure(inspection) {
    const reasons = [];
    if (inspection.legacyVisibleSurfaceCount > 0) reasons.push('legacy visibility');
    if (!inspection.webGpuSurfaceVisible) reasons.push('webgpu visibility');
    if (!inspection.topControlSurfacePreserved) reasons.push('top preservation');
    if (!inspection.cssPresentationNeutralized) reasons.push('visibility ownership');
    return `cutover surface 사후조건이 불완전합니다: ${reasons.join('; ')}`;
}

function allocateOwnerEpoch() {
    nextOwnerEpoch += 1;
    if (!Number.isSafeInteger(nextOwnerEpoch)) {
        throw new RangeError('title WebGPU cutover owner epoch 범위를 초과했습니다.');
    }
    return nextOwnerEpoch;
}

function normalizeSurfaceIdList(value) {
    if (!Array.isArray(value) || value.length === 0) {
        throw new TypeError('legacySurfaceIds는 비어 있지 않은 배열이어야 합니다.');
    }
    return value.map((id) => normalizeSurfaceId(id, 'legacySurfaceIds entry'));
}

function normalizeSurfaceId(value, label) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new TypeError(`${label}가 필요합니다.`);
    }
    return value.trim();
}

function normalizeVisibility(value) {
    return value ?? '';
}

function normalizeReason(value) {
    return typeof value === 'string' && value.trim() !== ''
        ? value.trim()
        : 'unspecified';
}

function requireIdentity(value, label) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
        throw new TypeError(`${label} identity가 필요합니다.`);
    }
    return value;
}
