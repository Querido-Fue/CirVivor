import { getSetting } from 'save/save_system.js';

let soundSystemInstance = null;
const DEFAULT_BGM_PATH = './audio/bgm.mp3';

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
        this._unlockEvents = ['pointerdown', 'keydown', 'touchstart'];
        this._unlockAndPlayHandler = this._unlockAndPlay.bind(this);
        this._isUnlockListenerAttached = false;
    }

    /**
     * 사운드 시스템을 초기화하고 BGM 재생을 시작합니다.
     */
    async init() {
        this.bgmAudio = new Audio(DEFAULT_BGM_PATH);
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

    _sanitizeVolume(value) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
            return 100;
        }
        return Math.max(0, Math.min(100, parsed));
    }

    _normalizeVolume(value) {
        return this._sanitizeVolume(value) / 100;
    }

    _syncBgmVolume() {
        if (!this.bgmAudio) return;

        const settingVolume = this._sanitizeVolume(getSetting('bgmVolume'));
        if (this._lastBgmVolume === settingVolume) {
            return;
        }

        this._lastBgmVolume = settingVolume;
        this.bgmAudio.volume = settingVolume / 100;
    }

    _attachUnlockListeners() {
        if (this._isUnlockListenerAttached || typeof window === 'undefined') {
            return;
        }

        this._unlockEvents.forEach((eventName) => {
            window.addEventListener(eventName, this._unlockAndPlayHandler, { once: true });
        });
        this._isUnlockListenerAttached = true;
    }

    _detachUnlockListeners() {
        if (!this._isUnlockListenerAttached || typeof window === 'undefined') {
            return;
        }

        this._unlockEvents.forEach((eventName) => {
            window.removeEventListener(eventName, this._unlockAndPlayHandler);
        });
        this._isUnlockListenerAttached = false;
    }

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
