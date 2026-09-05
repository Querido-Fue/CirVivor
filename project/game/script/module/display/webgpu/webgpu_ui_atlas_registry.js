const TEXTURE_USAGE_COPY_DST = 0x02;
const TEXTURE_USAGE_TEXTURE_BINDING = 0x04;
const TEXTURE_USAGE_RENDER_ATTACHMENT = 0x10;
const DEFAULT_FORMAT = 'rgba8unorm';
const DEFAULT_MAX_ENTRIES = 8;

/**
 * Canvas/OffscreenCanvas 기반 UI bitmap을 device-generation별 texture slot으로 유지합니다.
 * source revision 또는 실제 크기가 바뀐 프레임에만 외부 이미지를 업로드하며 command 제출은 소유하지 않습니다.
 */
export class WebGpuUiAtlasRegistry {
    /**
     * @param {{maxEntries?:number,allowFrameOverflow?:boolean}} [options={}] - 유지할 source slot 상한입니다.
     */
    constructor(options = {}) {
        this.maxEntries = requirePositiveSafeInteger(
            options.maxEntries ?? DEFAULT_MAX_ENTRIES,
            'maxEntries'
        );
        this.allowFrameOverflow = options.allowFrameOverflow === true;
        this.entries = new Map();
        this.retiredEntries = new Set();
        this.device = null;
        this.deviceGeneration = null;
        this.lastFrameId = null;
        this.activeFrameId = null;
        this.frameSerial = 0;
        this.frameActive = false;
        this.accessSerial = 0;
        this.destroyed = false;
        this.allocationCount = 0;
        this.uploadCount = 0;
        this.uploadedPixelCount = 0;
        this.cacheHitCount = 0;
        this.evictionCount = 0;
        this.destroyCount = 0;
        this.generationChangeCount = 0;
        this.overflowAllocationCount = 0;
        this.deferredDestroyCount = 0;
        this.peakTextureCount = 0;
    }

    /**
     * allowFrameOverflow registry의 제출 대기 구간을 엽니다. 이 구간에서 참조한
     * texture는 exact source 재사용만 허용하고 LRU/resize 폐기는 endFrame까지 미룹니다.
     */
    beginFrame(contextValue) {
        if (this.destroyed) {
            throw new Error('destroy된 WebGPU UI atlas registry는 다시 시작할 수 없습니다.');
        }
        if (this.frameActive) {
            throw new Error('WebGPU UI atlas registry frame이 이미 열려 있습니다.');
        }
        const context = requireFrameContext(contextValue);
        this.#acceptFrameContext(context);
        this.frameSerial += 1;
        this.frameActive = true;
        this.activeFrameId = context.frameId;
        return this.getDiagnostics();
    }

    /**
     * queue submit 또는 frame abort 뒤 호출해 지연된 resize/LRU texture를 폐기하고
     * live source slot을 maxEntries까지 trim합니다.
     */
    endFrame() {
        if (this.destroyed) {
            throw new Error('destroy된 WebGPU UI atlas registry는 사용할 수 없습니다.');
        }
        if (!this.frameActive) {
            throw new Error('WebGPU UI atlas registry frame이 열려 있지 않습니다.');
        }
        for (const entry of Array.from(this.retiredEntries)) {
            this.#destroyEntry(entry);
        }
        while (this.entries.size > this.maxEntries) {
            const oldest = this.#findOldestEntry(false);
            if (!oldest) break;
            this.#destroyEntry(oldest);
            this.evictionCount += 1;
        }
        this.frameActive = false;
        this.activeFrameId = null;
        return this.getDiagnostics();
    }

    /**
     * source bitmap을 필요한 경우 업로드하고 sample 가능한 고정 slot packet을 반환합니다.
     * capacity는 실제 bitmap보다 크게 미리 잡아 animation 중 작은 resize의 재할당을 피할 수 있습니다.
     * @param {object} input - frame/source identity와 texture 설정입니다.
     * @returns {Readonly<object>} texture/view, 실제 크기와 UV scale을 포함한 packet입니다.
     */
    getOrUpload(input = {}) {
        if (this.destroyed) {
            throw new Error('destroy된 WebGPU UI atlas registry는 사용할 수 없습니다.');
        }
        const context = requireFrameContext(input.context);
        if (this.allowFrameOverflow) {
            if (!this.frameActive) {
                throw new Error('WebGPU UI atlas registry frame이 열려 있지 않습니다.');
            }
            if (context.frameId !== this.activeFrameId) {
                throw new Error('WebGPU UI atlas registry active frame drift입니다.');
            }
            if (context.device !== this.device
                || context.deviceGeneration !== this.deviceGeneration) {
                throw new Error('WebGPU UI atlas registry active device drift입니다.');
            }
        }
        this.#acceptFrameContext(context);
        const source = requireExternalImageSource(input.source);
        const revision = requireNonNegativeSafeInteger(input.revision, 'revision');
        const sourceWidth = requirePositiveSafeInteger(
            input.width ?? source.width,
            'source width'
        );
        const sourceHeight = requirePositiveSafeInteger(
            input.height ?? source.height,
            'source height'
        );
        const capacityWidth = Math.max(
            sourceWidth,
            normalizeOptionalCapacity(input.capacityWidth, sourceWidth, 'capacityWidth')
        );
        const capacityHeight = Math.max(
            sourceHeight,
            normalizeOptionalCapacity(input.capacityHeight, sourceHeight, 'capacityHeight')
        );
        const format = requireFormat(input.format ?? DEFAULT_FORMAT);

        let entry = this.entries.get(source) ?? null;
        // 제출 대기 중인 draw는 업로드 당시의 내용을 읽어야 합니다. 같은 frame에
        // 다시 업로드하면 queue copy가 모든 draw보다 먼저 실행되므로 slot을 분리합니다.
        const pendingContentChanges = entry
            && this.frameActive
            && this.allowFrameOverflow
            && entry.lastAccessFrameSerial === this.frameSerial
            && (entry.revision !== revision
                || entry.sourceWidth !== sourceWidth
                || entry.sourceHeight !== sourceHeight);
        const allocationRequired = !entry
            || pendingContentChanges
            || entry.format !== format
            || entry.capacityWidth < capacityWidth
            || entry.capacityHeight < capacityHeight;
        if (allocationRequired) {
            const nextEntry = this.#createEntry({
                source,
                format,
                capacityWidth: entry
                    ? Math.max(capacityWidth, entry.capacityWidth)
                    : capacityWidth,
                capacityHeight: entry
                    ? Math.max(capacityHeight, entry.capacityHeight)
                    : capacityHeight
            });
            if (entry) {
                this.#retireOrDestroyEntry(entry);
            } else {
                this.#trimForInsertion();
            }
            this.entries.set(source, nextEntry);
            entry = nextEntry;
            if (this.entries.size > this.maxEntries) {
                this.overflowAllocationCount += 1;
            }
            this.peakTextureCount = Math.max(
                this.peakTextureCount,
                this.entries.size + this.retiredEntries.size
            );
        }

        entry.lastAccessSerial = ++this.accessSerial;
        entry.lastAccessFrameSerial = this.frameSerial;
        const uploadRequired = entry.revision !== revision
            || entry.sourceWidth !== sourceWidth
            || entry.sourceHeight !== sourceHeight;
        if (!uploadRequired) {
            this.cacheHitCount += 1;
            return entry.packet;
        }

        context.device.queue.copyExternalImageToTexture(
            {
                source,
                origin: { x: 0, y: 0 },
                flipY: false
            },
            {
                texture: entry.texture,
                origin: { x: 0, y: 0, z: 0 },
                colorSpace: 'srgb',
                premultipliedAlpha: true
            },
            {
                width: sourceWidth,
                height: sourceHeight,
                depthOrArrayLayers: 1
            }
        );
        entry.revision = revision;
        entry.sourceWidth = sourceWidth;
        entry.sourceHeight = sourceHeight;
        entry.packet = Object.freeze({
            texture: entry.texture,
            view: entry.view,
            source,
            revision,
            width: sourceWidth,
            height: sourceHeight,
            capacityWidth: entry.capacityWidth,
            capacityHeight: entry.capacityHeight,
            uvScaleX: sourceWidth / entry.capacityWidth,
            uvScaleY: sourceHeight / entry.capacityHeight,
            format,
            uploadedFrameId: context.frameId,
            deviceGeneration: context.deviceGeneration,
            alphaMode: 'premultiplied',
            colorSpace: 'srgb-compat'
        });
        this.uploadCount += 1;
        this.uploadedPixelCount += sourceWidth * sourceHeight;
        return entry.packet;
    }

    /** @returns {Readonly<object>} cache/upload 진단 snapshot입니다. */
    getDiagnostics() {
        return Object.freeze({
            destroyed: this.destroyed,
            deviceGeneration: this.deviceGeneration,
            lastFrameId: this.lastFrameId,
            activeFrameId: this.activeFrameId,
            frameActive: this.frameActive,
            entryCount: this.entries.size,
            retiredEntryCount: this.retiredEntries.size,
            textureCount: this.entries.size + this.retiredEntries.size,
            maxEntries: this.maxEntries,
            allowFrameOverflow: this.allowFrameOverflow,
            allocationCount: this.allocationCount,
            uploadCount: this.uploadCount,
            uploadedPixelCount: this.uploadedPixelCount,
            cacheHitCount: this.cacheHitCount,
            evictionCount: this.evictionCount,
            destroyCount: this.destroyCount,
            generationChangeCount: this.generationChangeCount,
            overflowAllocationCount: this.overflowAllocationCount,
            deferredDestroyCount: this.deferredDestroyCount,
            peakTextureCount: this.peakTextureCount
        });
    }

    /** 모든 generation-owned texture를 idempotent하게 폐기합니다. */
    destroy() {
        if (this.destroyed) {
            return false;
        }
        this.#destroyAllEntries();
        this.device = null;
        this.deviceGeneration = null;
        this.lastFrameId = null;
        this.activeFrameId = null;
        this.frameActive = false;
        this.destroyed = true;
        return true;
    }

    #acceptFrameContext(context) {
        const generation = context.deviceGeneration;
        if (this.deviceGeneration !== null && generation < this.deviceGeneration) {
            throw new Error('stale WebGPU UI atlas device generation입니다.');
        }
        if (this.deviceGeneration === null || generation > this.deviceGeneration) {
            if (this.deviceGeneration !== null) {
                this.generationChangeCount += 1;
                this.#destroyAllEntries();
            }
            this.device = context.device;
            this.deviceGeneration = generation;
            this.lastFrameId = null;
        } else if (context.device !== this.device) {
            throw new Error('device generation 변경 없는 WebGPU UI atlas device drift입니다.');
        }
        if (this.lastFrameId !== null && context.frameId < this.lastFrameId) {
            throw new Error('stale WebGPU UI atlas frame입니다.');
        }
        this.lastFrameId = context.frameId;
    }

    #createEntry({ source, format, capacityWidth, capacityHeight }) {
        const texture = this.device.createTexture({
            label: 'title-ui-atlas-slot',
            size: {
                width: capacityWidth,
                height: capacityHeight,
                depthOrArrayLayers: 1
            },
            mipLevelCount: 1,
            sampleCount: 1,
            dimension: '2d',
            format,
            // Chromium/Dawn의 copyExternalImageToTexture destination 계약은
            // COPY_DST와 RENDER_ATTACHMENT를 함께 요구합니다.
            usage: TEXTURE_USAGE_COPY_DST
                | TEXTURE_USAGE_TEXTURE_BINDING
                | TEXTURE_USAGE_RENDER_ATTACHMENT
        });
        let view;
        try {
            view = texture.createView({ dimension: '2d' });
        } catch (error) {
            texture.destroy?.();
            this.destroyCount += 1;
            throw error;
        }
        this.allocationCount += 1;
        return {
            source,
            texture,
            view,
            format,
            capacityWidth,
            capacityHeight,
            sourceWidth: 0,
            sourceHeight: 0,
            revision: -1,
            packet: null,
            lastAccessSerial: ++this.accessSerial,
            lastAccessFrameSerial: this.frameSerial,
            destroyed: false
        };
    }

    #trimForInsertion() {
        while (this.entries.size >= this.maxEntries) {
            const oldest = this.#findOldestEntry(this.allowFrameOverflow);
            if (!oldest) {
                return;
            }
            this.#destroyEntry(oldest);
            this.evictionCount += 1;
        }
    }

    #findOldestEntry(protectCurrentFrame) {
        let oldest = null;
        for (const entry of this.entries.values()) {
            if (protectCurrentFrame
                && this.frameActive
                && entry.lastAccessFrameSerial === this.frameSerial) {
                continue;
            }
            if (!oldest || entry.lastAccessSerial < oldest.lastAccessSerial) {
                oldest = entry;
            }
        }
        return oldest;
    }

    #retireOrDestroyEntry(entry) {
        if (this.allowFrameOverflow
            && this.frameActive
            && entry.lastAccessFrameSerial === this.frameSerial) {
            if (this.entries.get(entry.source) === entry) {
                this.entries.delete(entry.source);
            }
            this.retiredEntries.add(entry);
            this.deferredDestroyCount += 1;
            return;
        }
        this.#destroyEntry(entry);
    }

    #destroyAllEntries() {
        for (const entry of Array.from(this.entries.values())) {
            this.#destroyEntry(entry);
        }
        for (const entry of Array.from(this.retiredEntries)) {
            this.#destroyEntry(entry);
        }
        this.entries.clear();
        this.retiredEntries.clear();
    }

    #destroyEntry(entry) {
        if (!entry || entry.destroyed) {
            return;
        }
        entry.destroyed = true;
        if (this.entries.get(entry.source) === entry) {
            this.entries.delete(entry.source);
        }
        this.retiredEntries.delete(entry);
        try {
            entry.texture.destroy();
        } catch {
            // teardown은 best-effort지만 논리 소유권은 즉시 제거합니다.
        }
        this.destroyCount += 1;
    }
}

function requireFrameContext(context) {
    const device = context?.device;
    if ((!device || (typeof device !== 'object' && typeof device !== 'function'))
        || typeof device.createTexture !== 'function'
        || typeof device.queue?.copyExternalImageToTexture !== 'function') {
        throw new TypeError('WebGPU UI atlas에는 texture/copy queue를 가진 frame device가 필요합니다.');
    }
    return Object.freeze({
        device,
        deviceGeneration: requireNonNegativeSafeInteger(
            context.deviceGeneration,
            'deviceGeneration'
        ),
        frameId: requireNonNegativeSafeInteger(context.frameId, 'frameId')
    });
}

function requireExternalImageSource(source) {
    if (!source || (typeof source !== 'object' && typeof source !== 'function')) {
        throw new TypeError('WebGPU UI atlas source identity가 필요합니다.');
    }
    return source;
}

function normalizeOptionalCapacity(value, fallback, name) {
    return value === undefined ? fallback : requirePositiveSafeInteger(value, name);
}

function requirePositiveSafeInteger(value, name) {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name}은 양의 안전한 정수여야 합니다.`);
    }
    return value;
}

function requireNonNegativeSafeInteger(value, name) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${name}은 0 이상의 안전한 정수여야 합니다.`);
    }
    return value;
}

function requireFormat(value) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new TypeError('WebGPU UI atlas format이 필요합니다.');
    }
    return value.trim();
}
