import { getSetting } from 'save/save_system.js';
import { getData } from 'data/data_handler.js';

const SOUND_CONSTANTS = getData('SOUND_CONSTANTS');

let soundSystemInstance = null;

/**
 * @class SoundSystem
 * @description 배경음(BGM) 리소스 초기화, 재생, 볼륨 반영을 담당합니다.
 */
export class SoundSystem {
    constructor() {
        soundSystemInstance = this;
        this.bgmAudio = null;
        this._lastBgmVolume = null;
        this._pendingAutoplay = false;
        this._unlockEvents = [...SOUND_CONSTANTS.BGM.UNLOCK_EVENTS];
        this._unlockAndPlayHandler = this._unlockAndPlay.bind(this);
        this._isUnlockListenerAttached = false;
    }

    /**
     * 사운드 시스템을 초기화하고 BGM 재생을 시작합니다.
     */
    async init() {
        this.bgmAudio = new Audio(SOUND_CONSTANTS.BGM.PATH);
        this.bgmAudio.loop = true;
        this.bgmAudio.preload = 'auto';
        this._syncBgmVolume();
        await this.playBgm();
    }

    /**
     * 설정값 변경 시 BGM 볼륨을 동기화합니다.
     */
    update() {
        this._syncBgmVolume();
    }

    /**
     * 사운드 정보를 그립니다.
     */
    draw() {
    }

    /**
     * BGM 재생을 시도합니다.
     */
    async playBgm() {
        if (!this.bgmAudio) return;

        try {
            await this.bgmAudio.play();
            this._pendingAutoplay = false;
            this._detachUnlockListeners();
        } catch (e) {
            this._pendingAutoplay = true;
            this._attachUnlockListeners();
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
        this.bgmAudio.pause();
        this.bgmAudio.currentTime = 0;
    }

    /**
     * BGM 볼륨(0~100)을 즉시 반영합니다.
     * @param {number} volume
     */
    setBgmVolume(volume) {
        if (!this.bgmAudio) return;
        const normalized = this._normalizeVolume(volume);
        this._lastBgmVolume = this._sanitizeVolume(volume);
        this.bgmAudio.volume = normalized;
    }

    /**
         * @private
         * 입력된 볼륨 값이 유효한 숫자인지 확인하고 0 ~ 100 범위로 보정합니다.
         * @param {number|string} value 검사할 볼륨 수치
         * @returns {number} 안전하게 정규화된 0~100 사이 볼륨값
         */
    _sanitizeVolume(value) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
            return SOUND_CONSTANTS.BGM.DEFAULT_VOLUME;
        }
        return Math.max(0, Math.min(SOUND_CONSTANTS.BGM.DEFAULT_VOLUME, parsed));
    }

    /**
         * @private
         * Audio 요소에 대입할 수 있는 0.0 ~ 1.0 실수 스케일로 변환합니다.
         * @param {number|string} value 변경할 볼륨(0~100)
         * @returns {number} Audio API용 볼륨 계수
         */
    _normalizeVolume(value) {
        return this._sanitizeVolume(value) / SOUND_CONSTANTS.BGM.DEFAULT_VOLUME;
    }

    /**
         * @private
         * 설정(save_system)의 현재 볼륨 값을 확인하여 브라우저 Audio 객체에 동기화합니다.
         */
    _syncBgmVolume() {
        if (!this.bgmAudio) return;

        const settingVolume = this._sanitizeVolume(getSetting('bgmVolume'));
        if (this._lastBgmVolume === settingVolume) {
            return;
        }

        this._lastBgmVolume = settingVolume;
        this.bgmAudio.volume = settingVolume / SOUND_CONSTANTS.BGM.DEFAULT_VOLUME;
    }

    /**
         * @private
         * 브라우저 오디오 자동재생(Autoplay) 정책에 의해 막혔을 때, 사용자 첫 상호작용 후 재생되도록 이벤트를 겁니다.
         */
    _attachUnlockListeners() {
        if (this._isUnlockListenerAttached || typeof window === 'undefined') {
            return;
        }

        this._unlockEvents.forEach((eventName) => {
            window.addEventListener(eventName, this._unlockAndPlayHandler, { once: true });
        });
        this._isUnlockListenerAttached = true;
    }

    /**
         * @private
         * 오디오 잠금 해제 이벤트 리스너를 정리/제거합니다.
         */
    _detachUnlockListeners() {
        if (!this._isUnlockListenerAttached || typeof window === 'undefined') {
            return;
        }

        this._unlockEvents.forEach((eventName) => {
            window.removeEventListener(eventName, this._unlockAndPlayHandler);
        });
        this._isUnlockListenerAttached = false;
    }

    /**
         * @private
         * 사용자 상호작용 후 브라우저 오디오 재생 제한이 풀리면 대기중인 BGM을 틀어줍니다.
         */
    async _unlockAndPlay() {
        this._detachUnlockListeners();
        if (!this._pendingAutoplay) return;
        await this.playBgm();
    }
}

/**
 * 싱글톤 사운드 시스템 인스턴스를 반환합니다.
 * @returns {SoundSystem|null}
 */
export const getSoundSystemInstance = () => soundSystemInstance;

/**
 * BGM 재생을 요청합니다.
 */
export const playBgm = () => soundSystemInstance?.playBgm();

/**
 * BGM 정지를 요청합니다.
 */
export const stopBgm = () => soundSystemInstance?.stopBgm();

/**
 * BGM 볼륨 변경을 요청합니다.
 * @param {number} volume - 0~100
 */
export const setBgmVolume = (volume) => soundSystemInstance?.setBgmVolume(volume);
