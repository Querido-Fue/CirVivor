import { previewSettingBatch } from 'save/save_system.js';
import { expandCompositeSettings } from './_settings_state.js';

/**
 * 설정 미리보기 반영을 마이크로태스크 단위로 합쳐 실행합니다.
 */
export class SettingsPreviewQueue {
    #pendingSettings;
    #flushPromise;
    #applyRuntimeSettings;

    /**
     * @param {{applyRuntimeSettings: function(object): Promise<void>|void}} options - 큐 실행 옵션입니다.
     */
    constructor(options) {
        this.#pendingSettings = {};
        this.#flushPromise = null;
        this.#applyRuntimeSettings = typeof options?.applyRuntimeSettings === 'function'
            ? options.applyRuntimeSettings
            : async () => {};
    }

    /**
     * 미리보기 설정을 다음 마이크로태스크에 합쳐 반영합니다.
     * @param {object} changedSettings - 반영할 설정 키와 값입니다.
     * @returns {Promise<void>}
     */
    queue(changedSettings) {
        Object.assign(this.#pendingSettings, expandCompositeSettings(changedSettings));

        if (!this.#flushPromise) {
            this.#flushPromise = Promise.resolve().then(async () => {
                const pending = this.#pendingSettings;
                this.#pendingSettings = {};

                if (Object.keys(pending).length > 0) {
                    previewSettingBatch(pending);
                    await this.#applyRuntimeSettings(pending);
                }

                this.#flushPromise = null;
                if (Object.keys(this.#pendingSettings).length > 0) {
                    return this.queue({});
                }
            });
        }

        return this.#flushPromise;
    }

    /**
     * 대기 중인 미리보기 반영 작업을 모두 끝낼 때까지 기다립니다.
     * @returns {Promise<void>}
     */
    async flush() {
        while (this.#flushPromise) {
            await this.#flushPromise;
        }

        if (Object.keys(this.#pendingSettings).length > 0) {
            await this.queue({});
        }
    }
}
