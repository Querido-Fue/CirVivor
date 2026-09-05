/**
 * Owns buffers/textures until an initialization transaction publishes them.
 * Register each allocation immediately, including resources inside object/array initializers.
 * After commit, the receiving runtime owns normal retirement.
 */
export class GpuResourceAllocation {
    #device;
    #resources = [];

    constructor(device) {
        this.#device = device;
    }

    createBuffer(label, size, usage) {
        const buffer = this.#device.createBuffer({ label, size, usage });
        this.#resources.push(buffer);
        return buffer;
    }

    createTexture(descriptor) {
        const texture = this.#device.createTexture(descriptor);
        this.#resources.push(texture);
        return texture;
    }

    commit() {
        this.#resources.length = 0;
    }

    rollback() {
        while (this.#resources.length > 0) {
            const resource = this.#resources.pop();
            try {
                resource.destroy();
            } catch {
                // Continue retiring other allocations after device loss.
            }
        }
    }
}
