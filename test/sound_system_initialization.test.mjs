import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const soundSystemSource = await readFile(
    new URL('../project/game/script/module/sound/sound_system.js', import.meta.url),
    'utf8'
);

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function createSyntheticModule(context, identifier, exports) {
    return new vm.SyntheticModule(
        Object.keys(exports),
        function initializeSyntheticModule() {
            for (const [name, value] of Object.entries(exports)) {
                this.setExport(name, value);
            }
        },
        { context, identifier }
    );
}

async function loadSoundSystem({
    play,
    addEventListener = () => {},
    removeEventListener = () => {},
    consoleObject = console,
    settingVolume = 65
} = {}) {
    const audioInstances = [];
    class AudioStub {
        constructor(source) {
            this.source = source;
            this.loop = false;
            this.preload = '';
            this.volume = 1;
            this.paused = true;
            this.currentTime = 0;
            audioInstances.push(this);
        }

        play() {
            return play?.call(this);
        }

        pause() {
            this.paused = true;
        }
    }

    const context = vm.createContext({
        Audio: AudioStub,
        console: consoleObject,
        window: { addEventListener, removeEventListener }
    });
    const dependencies = new Map([
        ['save/save_system.js', createSyntheticModule(context, 'save_system.js', {
            getSetting: () => settingVolume
        })],
        ['data/sound/bgm_resource_data.js', createSyntheticModule(context, 'bgm_resource_data.js', {
            BGM_RESOURCE_DATA: Object.freeze({ PATH: './audio/title.mp3' })
        })],
        ['util/number_util.js', createSyntheticModule(context, 'number_util.js', {
            clampFiniteNumber(value, minimum, maximum, fallback) {
                return Number.isFinite(value)
                    ? Math.min(maximum, Math.max(minimum, value))
                    : fallback;
            }
        })]
    ]);
    const module = new vm.SourceTextModule(soundSystemSource, {
        context,
        identifier: 'sound_system.js'
    });
    await module.link((specifier) => {
        const dependency = dependencies.get(specifier);
        if (!dependency) {
            throw new Error(`지원하지 않는 SoundSystem import입니다: ${specifier}`);
        }
        return dependency;
    });
    await module.evaluate();
    return {
        SoundSystem: module.namespace.SoundSystem,
        audioInstances
    };
}

test('SoundSystem.init은 Audio.play가 pending이어도 전체 초기화를 막지 않는다', async () => {
    let resolvePlay;
    const pendingPlay = new Promise((resolve) => {
        resolvePlay = resolve;
    });
    const { SoundSystem, audioInstances } = await loadSoundSystem({
        play: () => pendingPlay
    });
    const soundSystem = new SoundSystem();

    const outcome = await Promise.race([
        soundSystem.init().then(() => 'initialized'),
        new Promise((resolve) => setImmediate(() => resolve('blocked')))
    ]);

    assert.equal(outcome, 'initialized');
    assert.equal(audioInstances.length, 1);
    assert.equal(audioInstances[0].source, './audio/title.mp3');
    assert.equal(audioInstances[0].loop, true);
    assert.equal(audioInstances[0].preload, 'auto');
    assert.equal(audioInstances[0].volume, 0.65);
    resolvePlay();
});

test('초기 재생의 unlock listener 오류는 init을 거부하지 않고 경고로 흡수한다', async () => {
    const playError = new Error('autoplay blocked');
    const listenerError = new Error('listener unavailable');
    const warnings = [];
    const consoleObject = {
        ...console,
        warn(...args) {
            warnings.push(args);
        }
    };
    const { SoundSystem } = await loadSoundSystem({
        play: () => Promise.reject(playError),
        addEventListener: () => {
            throw listenerError;
        },
        consoleObject
    });
    const soundSystem = new SoundSystem();

    assert.equal(await soundSystem.init(), undefined);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(warnings.length, 1);
    assert.match(warnings[0][0], /초기 BGM 재생 요청/);
    assert.equal(warnings[0][1], listenerError);
});

test('pending 재생이 suspend 중 거부되면 listener 대신 복귀 재생을 예약한다', async () => {
    const firstPlay = createDeferred();
    const addedEvents = [];
    let playCount = 0;
    const { SoundSystem } = await loadSoundSystem({
        play() {
            playCount++;
            return playCount === 1 ? firstPlay.promise : Promise.resolve();
        },
        addEventListener: (eventName) => addedEvents.push(eventName)
    });
    const soundSystem = new SoundSystem();

    await soundSystem.init();
    soundSystem.setRuntimeSuspended(true);
    firstPlay.reject(new Error('late autoplay rejection'));
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(addedEvents, []);
    assert.equal(playCount, 1);
    soundSystem.setRuntimeSuspended(false);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(playCount, 2);
});

test('pending 재생이 suspend 중 성공해도 즉시 pause하고 복귀 시 다시 재생한다', async () => {
    const firstPlay = createDeferred();
    let playCount = 0;
    const { SoundSystem, audioInstances } = await loadSoundSystem({
        play() {
            playCount++;
            if (playCount === 1) {
                return firstPlay.promise.then(() => {
                    this.paused = false;
                });
            }
            this.paused = false;
            return Promise.resolve();
        }
    });
    const soundSystem = new SoundSystem();

    await soundSystem.init();
    soundSystem.setRuntimeSuspended(true);
    firstPlay.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(audioInstances[0].paused, true);
    assert.equal(playCount, 1);
    soundSystem.setRuntimeSuspended(false);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(playCount, 2);
    assert.equal(audioInstances[0].paused, false);
});

test('stop 이후 이전 pending 재생이 거부되어도 autoplay listener를 되살리지 않는다', async () => {
    const firstPlay = createDeferred();
    const addedEvents = [];
    let playCount = 0;
    const { SoundSystem, audioInstances } = await loadSoundSystem({
        play() {
            playCount++;
            return firstPlay.promise;
        },
        addEventListener: (eventName) => addedEvents.push(eventName)
    });
    const soundSystem = new SoundSystem();

    await soundSystem.init();
    soundSystem.stopBgm();
    firstPlay.reject(new Error('late rejection after stop'));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(playCount, 1);
    assert.deepEqual(addedEvents, []);
    assert.equal(audioInstances[0].paused, true);
    assert.equal(audioInstances[0].currentTime, 0);
});

test('stop 이후 이전 pending 재생이 성공해도 Audio를 다시 즉시 정지한다', async () => {
    const firstPlay = createDeferred();
    const addedEvents = [];
    const { SoundSystem, audioInstances } = await loadSoundSystem({
        play() {
            return firstPlay.promise.then(() => {
                this.paused = false;
                this.currentTime = 12;
            });
        },
        addEventListener: (eventName) => addedEvents.push(eventName)
    });
    const soundSystem = new SoundSystem();

    await soundSystem.init();
    soundSystem.stopBgm();
    firstPlay.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(addedEvents, []);
    assert.equal(audioInstances[0].paused, true);
    assert.equal(audioInstances[0].currentTime, 0);
});

test('이전 재생의 늦은 성공은 더 최신 요청이 있어도 suspend 상태를 넘지 못한다', async () => {
    const firstPlay = createDeferred();
    let playCount = 0;
    const { SoundSystem, audioInstances } = await loadSoundSystem({
        play() {
            playCount++;
            return firstPlay.promise.then(() => {
                this.paused = false;
            });
        }
    });
    const soundSystem = new SoundSystem();

    await soundSystem.init();
    soundSystem.stopBgm();
    soundSystem.setRuntimeSuspended(true);
    await soundSystem.playBgm();
    firstPlay.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(playCount, 1);
    assert.equal(audioInstances[0].paused, true);
});
