import { previewSettingBatch } from 'save/save_system.js';
import { expandCompositeSettings } from './_settings_state.js';

/**
 * 설정 메모리 미리보기와 런타임 반영을 마이크로태스크 단위로 합쳐 실행합니다.
 * 이 큐 자체는 파일 I/O를 수행하지 않지만 메모리 값은 이후 저장 호출에서 기록될 수 있습니다.
 */
export class SettingsPreviewQueue {
    #pendingSettings;
    #flushPromise;
    #applyRuntimeSettings;

    /**
     * @param {{applyRuntimeSettings?: (settings: Record<string, *>) => Promise<void>|void}} [options] - 큐 실행 옵션입니다.
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
     * @returns {Record<string, *>} 이번 flush에서 반영할 설정 묶음입니다.
     */
    #drainPendingSettings() {
        const pending = this.#pendingSettings;
        this.#pendingSettings = {};
        return pending;
    }

    /**
     * 대기 묶음을 설정 메모리에 먼저 반영한 뒤 런타임 콜백을 기다립니다.
     * `theme`은 메모리 미리보기 단계에서 즉시 적용됩니다. 이 경로 자체는 파일을 쓰지 않지만
     * 메모리 값은 이후 저장 호출에서 기록될 수 있습니다.
     * @param {Record<string, *>} pending - 이번 flush에서 반영할 설정 묶음입니다.
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
     * 미리보기 설정을 다음 마이크로태스크의 대기 묶음에 합쳐 반영합니다.
     * 아직 drain되지 않은 같은 묶음에서 동일 키가 반복되면 마지막 값이 사용됩니다.
     * 이 큐 자체는 파일 I/O를 수행하지 않습니다.
     * @param {Record<string, *>} changedSettings - 반영할 설정 키와 값입니다.
     * @returns {Promise<void>} 해당 호출이 속한 연속 미리보기 반영이 끝나면 이행됩니다.
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
