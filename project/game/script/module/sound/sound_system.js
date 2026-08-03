import { getSetting } from 'save/save_system.js';
import { BGM_RESOURCE_DATA } from 'data/sound/bgm_resource_data.js';
import { clampFiniteNumber } from 'util/number_util.js';

const BGM_UNLOCK_EVENTS = Object.freeze(['pointerdown', 'keydown', 'touchstart']);
const BGM_VOLUME_MAX = 100;

let soundSystemInstance = null;

/**
 * @class SoundSystem
 * @description 배경음(BGM) 리소스 초기화, 재생, 볼륨 반영을 담당합니다.
 */
export class SoundSystem {
    #lastBgmVolume;
    #pendingAutoplay;
    #unlockEvents;
    #unlockAndPlayHandler;
    #isUnlockListenerAttached;
    #runtimeSuspended;
    #resumePlaybackAfterRuntimeSuspend;
    #playRequestEpoch;
    #explicitStopRequested;

    constructor() {
        soundSystemInstance = this;
        this.bgmAudio = null;
        this.#lastBgmVolume = null;
        this.#pendingAutoplay = false;
        this.#unlockEvents = [...BGM_UNLOCK_EVENTS];
        this.#unlockAndPlayHandler = this.#unlockAndPlay.bind(this);
        this.#isUnlockListenerAttached = false;
        this.#runtimeSuspended = false;
        this.#resumePlaybackAfterRuntimeSuspend = false;
        this.#playRequestEpoch = 0;
        this.#explicitStopRequested = false;
    }

    /**
     * 사운드 시스템을 초기화하고 BGM 재생을 비동기로 요청합니다.
     * 브라우저의 `Audio.play()` Promise는 오디오 백엔드가 준비되지 않으면 장시간 pending일 수 있으므로,
     * 선택 기능인 BGM 재생 완료가 전체 게임 초기화를 막지 않게 합니다.
     * @returns {Promise<void>} Audio 객체와 볼륨 설정이 끝나면 즉시 이행합니다.
     */
    async init() {
        this.bgmAudio = new Audio(BGM_RESOURCE_DATA.PATH);
        this.bgmAudio.loop = true;
        this.bgmAudio.preload = 'auto';
        this.#syncBgmVolume();
        void this.playBgm().catch((error) => {
            console.warn('초기 BGM 재생 요청을 완료하지 못했습니다.', error);
        });
    }

    /**
     * 설정값 변경 시 BGM 볼륨을 동기화합니다.
     */
    update() {
        this.#syncBgmVolume();
    }

    /**
     * 사운드 정보를 그립니다.
     */
    draw() {
    }

    /**
     * BGM 재생을 시도하고 재생 요청 처리가 끝나면 이행합니다.
     * Audio가 없으면 즉시 이행하고, 런타임 정지 중에는 autoplay·resume 대기 상태만 기록합니다.
     * `Audio.play()`의 동기 오류나 Promise 거부는 잠금 해제 재시도 상태로 전환해 흡수하지만,
     * unlock listener 설치·해제 자체의 오류는 반환 Promise를 거부할 수 있습니다.
     * @returns {Promise<void>}
     */
    async playBgm() {
        if (!this.bgmAudio) return;
        const requestEpoch = ++this.#playRequestEpoch;
        this.#explicitStopRequested = false;
        if (this.#runtimeSuspended) {
            this.#pendingAutoplay = true;
            this.#resumePlaybackAfterRuntimeSuspend = true;
            return;
        }

        try {
            await this.bgmAudio.play();
            if (requestEpoch !== this.#playRequestEpoch) {
                if (this.#explicitStopRequested) {
                    this.pauseBgm();
                    this.bgmAudio.currentTime = 0;
                } else if (this.#runtimeSuspended) {
                    this.pauseBgm();
                }
                return;
            }
            if (this.#runtimeSuspended) {
                this.#pendingAutoplay = true;
                this.#resumePlaybackAfterRuntimeSuspend = true;
                this.pauseBgm();
                this.#detachUnlockListeners();
                return;
            }
            this.#pendingAutoplay = false;
            this.#detachUnlockListeners();
        } catch (e) {
            if (requestEpoch !== this.#playRequestEpoch) {
                if (this.#explicitStopRequested) {
                    this.pauseBgm();
                    this.bgmAudio.currentTime = 0;
                }
                return;
            }
            this.#pendingAutoplay = true;
            if (this.#runtimeSuspended) {
                this.#resumePlaybackAfterRuntimeSuspend = true;
                this.#detachUnlockListeners();
                return;
            }
            this.#attachUnlockListeners();
        }
    }

    /**
     * BGM을 일시정지합니다.
     */
    pauseBgm() {
        if (!this.bgmAudio) return;
        this.bgmAudio.pause();
    }

    /**
     * BGM을 정지하고 재생 위치를 처음으로 되돌립니다.
     */
    stopBgm() {
        if (!this.bgmAudio) return;
        this.#playRequestEpoch++;
        this.#explicitStopRequested = true;
        this.#pendingAutoplay = false;
        this.#resumePlaybackAfterRuntimeSuspend = false;
        this.bgmAudio.pause();
        this.bgmAudio.currentTime = 0;
        this.#detachUnlockListeners();
    }

    /**
     * 런타임 일시정지 상태를 반영하여 BGM 재생을 멈추거나 재개합니다.
     * 창 비활성화와 향후 인게임 일시정지 메뉴가 공통으로 사용할 수 있습니다.
     * @param {boolean} isSuspended - 런타임 정지 여부입니다.
     */
    setRuntimeSuspended(isSuspended) {
        const nextSuspended = isSuspended === true;
        if (this.#runtimeSuspended === nextSuspended) {
            return;
        }

        this.#runtimeSuspended = nextSuspended;
        if (nextSuspended) {
            this.#resumePlaybackAfterRuntimeSuspend = this.#pendingAutoplay
                || Boolean(this.bgmAudio && this.bgmAudio.paused === false);
            this.pauseBgm();
            return;
        }

        const shouldResumePlayback = this.#resumePlaybackAfterRuntimeSuspend;
        this.#resumePlaybackAfterRuntimeSuspend = false;
        if (shouldResumePlayback) {
            void this.playBgm();
        }
    }

    /**
     * BGM 볼륨(0~100)을 즉시 반영합니다.
     * @param {number} volume
     */
    setBgmVolume(volume) {
        if (!this.bgmAudio) return;
        const normalized = this.#normalizeVolume(volume);
        this.#lastBgmVolume = this.#sanitizeVolume(volume);
        this.bgmAudio.volume = normalized;
    }

    /**
     * 입력된 볼륨 값이 유효한 숫자인지 확인하고 0~100 범위로 보정합니다.
     * @param {number|string} value - 검사할 볼륨 수치입니다.
     * @returns {number} 안전하게 정규화된 0~100 사이 볼륨값입니다.
     * @private
     */
    #sanitizeVolume(value) {
        return clampFiniteNumber(
            Number(value),
            0,
            BGM_VOLUME_MAX,
            BGM_VOLUME_MAX
        );
    }

    /**
     * Audio 요소에 대입할 수 있는 0.0~1.0 실수 스케일로 변환합니다.
     * @param {number|string} value - 변경할 볼륨입니다.
     * @returns {number} Audio API용 볼륨 계수입니다.
     * @private
     */
    #normalizeVolume(value) {
        return this.#sanitizeVolume(value) / BGM_VOLUME_MAX;
    }

    /**
     * 설정(save_system)의 현재 볼륨 값을 확인하여 브라우저 Audio 객체에 동기화합니다.
     * @private
     */
    #syncBgmVolume() {
        if (!this.bgmAudio) return;

        const settingVolume = this.#sanitizeVolume(getSetting('bgmVolume'));
        if (this.#lastBgmVolume === settingVolume) {
            return;
        }

        this.#lastBgmVolume = settingVolume;
        this.bgmAudio.volume = settingVolume / BGM_VOLUME_MAX;
    }

    /**
     * 브라우저 오디오 자동재생 정책에 의해 막혔을 때 사용자 첫 상호작용 후 재생되도록 이벤트를 겁니다.
     * @private
     */
    #attachUnlockListeners() {
        if (this.#isUnlockListenerAttached || typeof window === 'undefined') {
            return;
        }

        this.#unlockEvents.forEach((eventName) => {
            window.addEventListener(eventName, this.#unlockAndPlayHandler, { once: true });
        });
        this.#isUnlockListenerAttached = true;
    }

    /**
     * 오디오 잠금 해제 이벤트 리스너를 정리/제거합니다.
     * @private
     */
    #detachUnlockListeners() {
        if (!this.#isUnlockListenerAttached || typeof window === 'undefined') {
            return;
        }

        this.#unlockEvents.forEach((eventName) => {
            window.removeEventListener(eventName, this.#unlockAndPlayHandler);
        });
        this.#isUnlockListenerAttached = false;
    }

    /**
     * 사용자 상호작용 후 브라우저 오디오 재생 제한이 풀리면 대기 중인 BGM을 틀어줍니다.
     * @private
     */
    async #unlockAndPlay() {
        this.#detachUnlockListeners();
        if (!this.#pendingAutoplay) return;
        await this.playBgm();
    }
}

/**
 * 싱글톤 사운드 시스템 인스턴스를 반환합니다.
 * @returns {SoundSystem|null}
 */
export const getSoundSystemInstance = () => soundSystemInstance;

/**
 * 생성된 사운드 시스템에 BGM 재생을 요청합니다.
 * @returns {Promise<void>|undefined} 인스턴스 생성 전에는 undefined, 이후에는 `SoundSystem.playBgm()`의 원본 Promise입니다.
 */
export const playBgm = () => soundSystemInstance?.playBgm();

/**
 * BGM 정지를 요청합니다.
 * @returns {void}
 */
export const stopBgm = () => soundSystemInstance?.stopBgm();

/**
 * BGM 볼륨 변경을 요청합니다.
 * @param {number} volume - 0~100
 * @returns {void}
 */
export const setBgmVolume = (volume) => soundSystemInstance?.setBgmVolume(volume);
