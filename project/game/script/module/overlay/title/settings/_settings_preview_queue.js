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
     * 대기 중인 설정이 있는지 확인합니다.
     * @returns {boolean} 반영할 설정이 있으면 true입니다.
     */
    #hasPendingSettings() {
        return Object.keys(this.#pendingSettings).length > 0;
    }

    /**
     * 현재 대기 중인 설정을 꺼내고 큐를 비웁니다.
     * @returns {object} 이번 flush에서 반영할 설정 묶음입니다.
     */
    #drainPendingSettings() {
        const pending = this.#pendingSettings;
        this.#pendingSettings = {};
        return pending;
    }

    /**
     * 대기 중인 설정 묶음을 실제 미리보기와 런타임에 반영합니다.
     * @param {object} pending - 이번 flush에서 반영할 설정 묶음입니다.
     * @returns {Promise<void>}
     */
    async #applyPendingSettings(pending) {
        if (Object.keys(pending).length === 0) {
            return;
        }

        previewSettingBatch(pending);
        await this.#applyRuntimeSettings(pending);
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
                try {
                    await this.#applyPendingSettings(this.#drainPendingSettings());
                } finally {
                    this.#flushPromise = null;
                }

                if (this.#hasPendingSettings()) {
                    await this.queue({});
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

        if (this.#hasPendingSettings()) {
            await this.queue({});
        }
    }
}
