export const TITLE_WEBGPU_BASE_CHECKPOINT_ID = 'title:overlay:0';
export const TITLE_WEBGPU_CENTER_BACKDROP_ID = 'title:center-backdrop';

/** frame-local immutable texture checkpoint와 seal-after-write 계약을 관리합니다. */
export class TitleWebGpuCheckpointRegistry {
    constructor() {
        this.frameId = null;
        this.deviceGeneration = null;
        this.device = null;
        this.active = false;
        this.checkpoints = new Map();
        this.sealedTextures = new WeakSet();
        this.revision = 0;
        this.sealCount = 0;
        this.rejectCount = 0;
    }

    /** @param {object} context - composer frame identity입니다. */
    beginFrame(context) {
        if (this.active) {
            this.rejectCount += 1;
            return false;
        }
        const normalized = requireFrameContext(context);
        if (this.deviceGeneration !== null
            && normalized.deviceGeneration < this.deviceGeneration) {
            this.rejectCount += 1;
            return false;
        }
        if (this.deviceGeneration === normalized.deviceGeneration
            && this.device !== null
            && this.device !== normalized.device) {
            this.rejectCount += 1;
            return false;
        }
        this.frameId = normalized.frameId;
        this.deviceGeneration = normalized.deviceGeneration;
        this.device = normalized.device;
        this.active = true;
        this.checkpoints.clear();
        this.sealedTextures = new WeakSet();
        return true;
    }

    /**
     * 완성된 texture를 checkpoint ID로 한 번 seal합니다.
     * @param {string} id - checkpoint ID입니다.
     * @param {object} resource - texture/view와 크기 metadata입니다.
     * @returns {Readonly<object>} frame-local descriptor입니다.
     */
    seal(id, resource = {}) {
        this.#requireActive();
        const checkpointId = requireId(id);
        if (this.checkpoints.has(checkpointId)) {
            this.rejectCount += 1;
            throw new Error(`이미 seal된 title WebGPU checkpoint입니다: ${checkpointId}`);
        }
        const texture = requireIdentity(resource.texture, 'checkpoint texture');
        const view = requireIdentity(resource.view, 'checkpoint view');
        if (this.sealedTextures.has(texture)) {
            this.rejectCount += 1;
            throw new Error('같은 title WebGPU texture를 두 checkpoint로 seal할 수 없습니다.');
        }
        const width = requirePositiveInteger(resource.width, 'checkpoint width');
        const height = requirePositiveInteger(resource.height, 'checkpoint height');
        const format = requireFormat(resource.format);
        this.revision = this.revision >= Number.MAX_SAFE_INTEGER
            ? 1
            : this.revision + 1;
        const descriptor = Object.freeze({
            id: checkpointId,
            frameId: this.frameId,
            deviceGeneration: this.deviceGeneration,
            texture,
            view,
            width,
            height,
            format,
            revision: this.revision,
            colorSpace: resource.colorSpace ?? 'srgb-compat',
            alphaMode: resource.alphaMode ?? 'premultiplied',
            lifetime: 'frame'
        });
        this.checkpoints.set(checkpointId, descriptor);
        this.sealedTextures.add(texture);
        this.sealCount += 1;
        return descriptor;
    }

    /** 현재 frame/generation과 일치하는 checkpoint만 반환합니다. */
    get(id, context = null) {
        if (!this.active) {
            return null;
        }
        if (context) {
            let frameId;
            let deviceGeneration;
            let device;
            try {
                frameId = context.frameId;
                deviceGeneration = context.deviceGeneration;
                device = context.device;
            } catch {
                return null;
            }
            if (frameId !== this.frameId
                || deviceGeneration !== this.deviceGeneration
                || device !== this.device) {
                return null;
            }
        }
        return this.checkpoints.get(id) ?? null;
    }

    /** seal된 texture에 대한 후속 write를 graph가 encode 전에 차단하도록 검증합니다. */
    assertWritable(texture) {
        this.#requireActive();
        requireIdentity(texture, 'writable texture');
        if (this.sealedTextures.has(texture)) {
            this.rejectCount += 1;
            throw new Error('seal 이후 title WebGPU checkpoint texture write는 금지됩니다.');
        }
        return true;
    }

    /** commit/abort 공통 frame-local 참조 정리입니다. */
    endFrame() {
        if (!this.active) {
            return false;
        }
        this.active = false;
        this.checkpoints.clear();
        this.sealedTextures = new WeakSet();
        return true;
    }

    getDiagnostics() {
        return Object.freeze({
            active: this.active,
            frameId: this.frameId,
            deviceGeneration: this.deviceGeneration,
            checkpointCount: this.checkpoints.size,
            revision: this.revision,
            sealCount: this.sealCount,
            rejectCount: this.rejectCount
        });
    }

    #requireActive() {
        if (!this.active) {
            this.rejectCount += 1;
            throw new Error('title WebGPU checkpoint frame이 열려 있지 않습니다.');
        }
    }
}

function requireFrameContext(context) {
    return {
        frameId: requireNonNegativeInteger(context?.frameId, 'frameId'),
        deviceGeneration: requireNonNegativeInteger(
            context?.deviceGeneration,
            'deviceGeneration'
        ),
        device: requireIdentity(context?.device, 'device')
    };
}

function requireId(value) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new TypeError('title WebGPU checkpoint ID가 필요합니다.');
    }
    return value.trim();
}

function requireIdentity(value, name) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
        throw new TypeError(`${name} identity가 필요합니다.`);
    }
    return value;
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

function requireFormat(value) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new TypeError('title WebGPU checkpoint format이 필요합니다.');
    }
    return value.trim();
}
