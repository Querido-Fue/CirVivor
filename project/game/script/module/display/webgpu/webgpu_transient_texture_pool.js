const DEFAULT_MAX_TEXTURES = 32;
const DEFAULT_MAX_IDLE_FRAMES = 2;
const TEXTURE_DIMENSIONS = new Set(['1d', '2d', '3d']);
const TEXTURE_VIEW_DIMENSIONS = new Set([
    '1d',
    '2d',
    '2d-array',
    'cube',
    'cube-array',
    '3d'
]);

/**
 * 같은 WebGPU device generation 안에서 transient texture/view를 프레임 단위로 재사용합니다.
 * texture 생성·view 생성·texture 폐기만 담당하며 command encoding이나 제출은 소유하지 않습니다.
 */
export class WebGpuTransientTexturePool {
    /**
     * @param {{maxTextures?:number,maxIdleFrames?:number,allowFrameOverflow?:boolean}} [options={}] - 풀 제한입니다.
     */
    constructor(options = {}) {
        this.maxTextures = requirePositiveInteger(
            options.maxTextures ?? DEFAULT_MAX_TEXTURES,
            'maxTextures'
        );
        this.maxIdleFrames = requireNonNegativeInteger(
            options.maxIdleFrames ?? DEFAULT_MAX_IDLE_FRAMES,
            'maxIdleFrames'
        );
        this.allowFrameOverflow = options.allowFrameOverflow === true;
        this.device = null;
        this.deviceGeneration = null;
        this.frameId = null;
        this.frameSerial = 0;
        this.frameActive = false;
        this.destroyed = false;
        this.nextEntryId = 0;
        this.nextLeaseId = 0;
        this.entries = new Set();
        this.idleEntriesByKey = new Map();
        this.activeLeases = new Map();
        this.frameDiagnostics = createFrameDiagnostics();
    }

    /**
     * 새 프레임을 열고 device/generation drift가 있으면 이전 texture를 모두 폐기합니다.
     * @param {{device:GPUDevice,deviceGeneration:number,frameId:number}} frame - 프레임 identity입니다.
     * @returns {object} 현재 진단 snapshot입니다.
     */
    beginFrame(frame) {
        if (this.destroyed) {
            throw new Error('destroy된 WebGPU transient texture pool은 다시 시작할 수 없습니다.');
        }
        if (this.frameActive) {
            throw new Error('WebGPU transient texture pool frame이 이미 열려 있습니다.');
        }
        const device = frame?.device;
        if ((!device || (typeof device !== 'object' && typeof device !== 'function'))
            || typeof device.createTexture !== 'function') {
            throw new TypeError('beginFrame에는 createTexture를 제공하는 WebGPU device가 필요합니다.');
        }
        const deviceGeneration = requireNonNegativeInteger(
            frame?.deviceGeneration,
            'deviceGeneration'
        );
        const frameId = requireNonNegativeInteger(frame?.frameId, 'frameId');
        const deviceDrifted = this.device !== null
            && (this.device !== device || this.deviceGeneration !== deviceGeneration);

        this.frameSerial += 1;
        this.frameId = frameId;
        this.frameDiagnostics = createFrameDiagnostics();
        if (deviceDrifted) {
            this.#destroyAllEntries();
        }
        this.frameDiagnostics.peakTextureCount = this.entries.size;
        this.device = device;
        this.deviceGeneration = deviceGeneration;
        this.frameActive = true;
        return this.getDiagnostics();
    }

    /**
     * exact descriptor가 같은 idle texture/view를 재사용하거나 새 lease를 할당합니다.
     * @param {object} descriptor - texture와 view의 exact descriptor입니다.
     * @returns {object} 현재 프레임에만 유효한 immutable lease입니다.
     */
    acquire(descriptor) {
        this.#requireActiveFrame();
        const normalizedDescriptor = normalizeTextureDescriptor(descriptor);
        const key = createTextureDescriptorKey(normalizedDescriptor);
        let entry = this.#takeReusableEntry(key);

        if (entry) {
            this.frameDiagnostics.reuseCount += 1;
        } else {
            this.#trimForAllocation();
            if (this.entries.size >= this.maxTextures && !this.allowFrameOverflow) {
                throw new RangeError(
                    `WebGPU transient texture pool capacity를 초과했습니다: ${this.maxTextures}`
                );
            }
            entry = this.#createEntry(key, normalizedDescriptor);
            this.frameDiagnostics.allocationCount += 1;
            if (this.entries.size > this.maxTextures) {
                this.frameDiagnostics.overflowAllocationCount += 1;
            }
            this.frameDiagnostics.peakTextureCount = Math.max(
                this.frameDiagnostics.peakTextureCount,
                this.entries.size
            );
        }

        entry.lastUsedFrameSerial = this.frameSerial;
        const lease = Object.freeze({
            id: ++this.nextLeaseId,
            texture: entry.texture,
            view: entry.view,
            descriptor: entry.descriptor,
            key: entry.key,
            device: this.device,
            deviceGeneration: this.deviceGeneration,
            frameId: this.frameId
        });
        entry.lease = lease;
        this.activeLeases.set(lease, entry);
        return lease;
    }

    /**
     * 현재 프레임이 소유한 lease만 idle 목록으로 돌려보냅니다.
     * stale, double, foreign release는 상태를 바꾸지 않고 false를 반환합니다.
     * @param {object} lease - acquire가 반환한 lease identity입니다.
     * @returns {boolean} 정상 release 여부입니다.
     */
    release(lease) {
        if (!this.frameActive) {
            this.frameDiagnostics.invalidReleaseCount += 1;
            return false;
        }
        const entry = this.activeLeases.get(lease);
        if (!entry
            || entry.lease !== lease
            || entry.device !== this.device
            || entry.deviceGeneration !== this.deviceGeneration) {
            this.frameDiagnostics.invalidReleaseCount += 1;
            return false;
        }

        this.activeLeases.delete(lease);
        entry.lease = null;
        entry.lastUsedFrameSerial = this.frameSerial;
        this.#addIdleEntry(entry);
        return true;
    }

    /**
     * 반환되지 않은 lease를 강제 회수하고 idle/capacity 제한을 적용해 프레임을 닫습니다.
     * @returns {object} 닫힌 프레임의 진단 snapshot입니다.
     */
    endFrame() {
        this.#requireActiveFrame();
        for (const [lease, entry] of Array.from(this.activeLeases.entries())) {
            this.activeLeases.delete(lease);
            entry.lease = null;
            entry.lastUsedFrameSerial = this.frameSerial;
            this.#addIdleEntry(entry);
            this.frameDiagnostics.forcedReleaseCount += 1;
        }

        this.#trimExpiredIdleEntries();
        this.#trimExcessIdleEntries();
        this.frameActive = false;
        return this.getDiagnostics();
    }

    /**
     * 현재 또는 마지막 프레임의 할당·재사용·강제 회수·폐기 진단을 반환합니다.
     * @returns {object} immutable 진단 snapshot입니다.
     */
    getDiagnostics() {
        return Object.freeze({
            destroyed: this.destroyed,
            frameActive: this.frameActive,
            frameId: this.frameId,
            deviceGeneration: this.deviceGeneration,
            maxTextures: this.maxTextures,
            maxIdleFrames: this.maxIdleFrames,
            allowFrameOverflow: this.allowFrameOverflow,
            textureCount: this.entries.size,
            idleTextureCount: this.entries.size - this.activeLeases.size,
            leasedTextureCount: this.activeLeases.size,
            allocationCount: this.frameDiagnostics.allocationCount,
            overflowAllocationCount: this.frameDiagnostics.overflowAllocationCount,
            peakTextureCount: this.frameDiagnostics.peakTextureCount,
            reuseCount: this.frameDiagnostics.reuseCount,
            forcedReleaseCount: this.frameDiagnostics.forcedReleaseCount,
            destroyCount: this.frameDiagnostics.destroyCount,
            invalidReleaseCount: this.frameDiagnostics.invalidReleaseCount
        });
    }

    /**
     * 모든 texture를 한 번만 폐기하고 이후 사용을 막습니다.
     * @returns {boolean} 이번 호출이 최초 destroy이면 true입니다.
     */
    destroy() {
        if (this.destroyed) {
            return false;
        }
        this.#destroyAllEntries();
        this.activeLeases.clear();
        this.idleEntriesByKey.clear();
        this.device = null;
        this.deviceGeneration = null;
        this.frameActive = false;
        this.destroyed = true;
        return true;
    }

    #requireActiveFrame() {
        if (this.destroyed) {
            throw new Error('destroy된 WebGPU transient texture pool은 사용할 수 없습니다.');
        }
        if (!this.frameActive) {
            throw new Error('WebGPU transient texture pool frame이 열려 있지 않습니다.');
        }
    }

    #createEntry(key, descriptor) {
        const texture = this.device.createTexture({
            size: {
                width: descriptor.width,
                height: descriptor.height,
                depthOrArrayLayers: descriptor.depthOrArrayLayers
            },
            mipLevelCount: descriptor.mipLevelCount,
            sampleCount: descriptor.sampleCount,
            dimension: descriptor.dimension,
            format: descriptor.format,
            usage: descriptor.usage
        });
        let view;
        try {
            view = texture.createView({ dimension: descriptor.viewDimension });
        } catch (error) {
            try {
                texture.destroy();
            } catch {
                // createView 실패 뒤 texture 폐기는 best-effort입니다.
            }
            this.frameDiagnostics.destroyCount += 1;
            throw error;
        }

        const entry = {
            id: ++this.nextEntryId,
            key,
            descriptor,
            texture,
            view,
            device: this.device,
            deviceGeneration: this.deviceGeneration,
            lastUsedFrameSerial: this.frameSerial,
            lease: null,
            destroyed: false
        };
        this.entries.add(entry);
        return entry;
    }

    #takeReusableEntry(key) {
        const entries = this.idleEntriesByKey.get(key);
        while (entries?.length > 0) {
            const entry = entries.pop();
            if (entries.length === 0) {
                this.idleEntriesByKey.delete(key);
            }
            if (!entry.destroyed
                && entry.device === this.device
                && entry.deviceGeneration === this.deviceGeneration) {
                return entry;
            }
            this.#destroyEntry(entry);
        }
        return null;
    }

    #addIdleEntry(entry) {
        let entries = this.idleEntriesByKey.get(entry.key);
        if (!entries) {
            entries = [];
            this.idleEntriesByKey.set(entry.key, entries);
        }
        entries.push(entry);
    }

    #removeIdleEntry(entry) {
        const entries = this.idleEntriesByKey.get(entry.key);
        if (!entries) {
            return;
        }
        const index = entries.indexOf(entry);
        if (index >= 0) {
            entries.splice(index, 1);
        }
        if (entries.length === 0) {
            this.idleEntriesByKey.delete(entry.key);
        }
    }

    #trimForAllocation() {
        while (this.entries.size >= this.maxTextures) {
            const entry = this.#findOldestIdleEntry(
                this.allowFrameOverflow ? this.frameSerial : null
            );
            if (!entry) {
                return;
            }
            this.#destroyEntry(entry);
        }
    }

    #trimExpiredIdleEntries() {
        for (const entry of Array.from(this.entries)) {
            if (entry.lease !== null) {
                continue;
            }
            const idleFrameCount = this.frameSerial - entry.lastUsedFrameSerial;
            if (idleFrameCount > this.maxIdleFrames) {
                this.#destroyEntry(entry);
            }
        }
    }

    #trimExcessIdleEntries() {
        while (this.entries.size > this.maxTextures) {
            const entry = this.#findOldestIdleEntry();
            if (!entry) {
                return;
            }
            this.#destroyEntry(entry);
        }
    }

    #findOldestIdleEntry(protectedFrameSerial = null) {
        let oldest = null;
        for (const entry of this.entries) {
            if (entry.lease !== null
                || entry.lastUsedFrameSerial === protectedFrameSerial) {
                continue;
            }
            if (!oldest
                || entry.lastUsedFrameSerial < oldest.lastUsedFrameSerial
                || (entry.lastUsedFrameSerial === oldest.lastUsedFrameSerial
                    && entry.id < oldest.id)) {
                oldest = entry;
            }
        }
        return oldest;
    }

    #destroyAllEntries() {
        for (const entry of Array.from(this.entries)) {
            this.#destroyEntry(entry);
        }
        this.activeLeases.clear();
        this.idleEntriesByKey.clear();
    }

    #destroyEntry(entry) {
        if (!entry || entry.destroyed) {
            return;
        }
        if (entry.lease !== null) {
            this.activeLeases.delete(entry.lease);
            entry.lease = null;
        } else {
            this.#removeIdleEntry(entry);
        }
        this.entries.delete(entry);
        entry.destroyed = true;
        try {
            entry.texture.destroy();
        } catch {
            // GPU resource teardown은 best-effort이지만 논리 소유권은 즉시 제거합니다.
        }
        this.frameDiagnostics.destroyCount += 1;
    }
}

function normalizeTextureDescriptor(descriptor) {
    if (!descriptor || typeof descriptor !== 'object') {
        throw new TypeError('WebGPU transient texture descriptor가 필요합니다.');
    }
    const dimension = descriptor.dimension;
    if (!TEXTURE_DIMENSIONS.has(dimension)) {
        throw new TypeError(`지원하지 않는 WebGPU texture dimension입니다: ${String(dimension)}`);
    }
    const viewDimension = descriptor.viewDimension;
    if (!TEXTURE_VIEW_DIMENSIONS.has(viewDimension)) {
        throw new TypeError(
            `지원하지 않는 WebGPU texture view dimension입니다: ${String(viewDimension)}`
        );
    }
    if (typeof descriptor.format !== 'string' || descriptor.format.length === 0) {
        throw new TypeError('WebGPU transient texture format은 비어 있지 않은 문자열이어야 합니다.');
    }
    return Object.freeze({
        width: requirePositiveInteger(descriptor.width, 'width'),
        height: requirePositiveInteger(descriptor.height, 'height'),
        depthOrArrayLayers: requirePositiveInteger(
            descriptor.depthOrArrayLayers,
            'depthOrArrayLayers'
        ),
        mipLevelCount: requirePositiveInteger(descriptor.mipLevelCount, 'mipLevelCount'),
        sampleCount: requirePositiveInteger(descriptor.sampleCount, 'sampleCount'),
        dimension,
        format: descriptor.format,
        usage: requirePositiveInteger(descriptor.usage, 'usage'),
        viewDimension
    });
}

function createTextureDescriptorKey(descriptor) {
    return JSON.stringify([
        descriptor.width,
        descriptor.height,
        descriptor.depthOrArrayLayers,
        descriptor.mipLevelCount,
        descriptor.sampleCount,
        descriptor.dimension,
        descriptor.format,
        descriptor.usage,
        descriptor.viewDimension
    ]);
}

function requirePositiveInteger(value, name) {
    if (!Number.isInteger(value) || value <= 0) {
        throw new RangeError(`${name}은 양의 정수여야 합니다.`);
    }
    return value;
}

function requireNonNegativeInteger(value, name) {
    if (!Number.isInteger(value) || value < 0) {
        throw new RangeError(`${name}은 0 이상의 정수여야 합니다.`);
    }
    return value;
}

function createFrameDiagnostics() {
    return {
        allocationCount: 0,
        overflowAllocationCount: 0,
        peakTextureCount: 0,
        reuseCount: 0,
        forcedReleaseCount: 0,
        destroyCount: 0,
        invalidReleaseCount: 0
    };
}
