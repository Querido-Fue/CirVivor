import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SCRIPT_ROOT = fileURLToPath(new URL('../script/', import.meta.url));
const CONTROLLER_PATH = path.join(SCRIPT_ROOT, 'module', 'debug', '_animation_debug_controller.js');
const OVERLAY_PATH = path.join(SCRIPT_ROOT, 'module', 'overlay', '_debug_overlay.js');
const [controllerSource, overlaySource] = await Promise.all([
    readFile(CONTROLLER_PATH, 'utf8'),
    readFile(OVERLAY_PATH, 'utf8')
]);

function hashExecutableSource(source) {
    const executableSource = source
        .replace(/^[ \t]*\/\*\*[\s\S]*?\*\/[ \t]*(?:\r?\n|$)/gm, '')
        .replace(/\r\n/g, '\n');
    return createHash('sha256').update(executableSource).digest('hex');
}

function findLeadingJsDoc(source, declaration) {
    const match = source.match(new RegExp(`/\\*\\*((?:(?!\\*/)[\\s\\S])*)\\*/\\s*${declaration}`));
    assert.ok(match, `${declaration} 앞 JSDoc을 찾을 수 없습니다.`);
    return match[1];
}

function createSyntheticModule(context, identifier, exports) {
    return new vm.SyntheticModule(Object.keys(exports), function initialize() {
        for (const [name, value] of Object.entries(exports)) {
            this.setExport(name, value);
        }
    }, { context, identifier });
}

test('JSDoc만 바뀌며 실제 순서 계약을 명시한다', () => {
    assert.equal(hashExecutableSource(controllerSource), '56afb8c50ec2f08de235f0860c38c5b0456ad14acd35c1dfec611ebccdc687ef');
    assert.equal(hashExecutableSource(overlaySource), '473612f3177ce87a2fa5e53ed7bd2368871e5aeb6c23e2dc44cf655e8f65d9d9');

    const frameDoc = findLeadingJsDoc(controllerSource, 'prepareFrame\\(consumePress\\)');
    assert.match(frameDoc, /`debugPause`, `debugStep`을 이 순서로/);
    assert.match(frameDoc, /공유되는 동결 객체/);
    assert.match(frameDoc, /@throws \{\*\}/);

    const openDoc = findLeadingJsDoc(overlaySource, 'open\\(\\)');
    const closeDoc = findLeadingJsDoc(overlaySource, 'close\\(\\)');
    assert.match(openDoc, /alpha→dim→scale→blur/);
    assert.match(closeDoc, /focus를 보유하면서 정지되지 않은 경우에만/);
    assert.match(closeDoc, /공통 close animation/);
    assert.match(closeDoc, /Promise microtask/);
});

test('frame control은 두 입력을 선소비하고 공유 결과와 오류 identity를 보존한다', async () => {
    const context = vm.createContext({});
    const module = new vm.SourceTextModule(controllerSource, { context, identifier: CONTROLLER_PATH });
    await module.link(() => { throw new Error('예상하지 않은 import입니다.'); });
    await module.evaluate();
    const { AnimationDebugController } = module.namespace;
    const controller = new AnimationDebugController();
    const calls = [];
    const firstRunning = controller.prepareFrame((action) => {
        calls.push(action);
        return true;
    });
    const secondRunning = controller.prepareFrame(null);
    assert.deepEqual(calls, ['debugPause', 'debugStep']);
    assert.strictEqual(firstRunning, secondRunning);
    assert.equal(Object.isFrozen(firstRunning), true);
    assert.equal(controller.isPaused(), false);

    controller.setEnabled(true);
    const token = new Error('step');
    assert.throws(() => controller.prepareFrame((action) => {
        if (action === 'debugStep') {
            throw token;
        }
        return true;
    }), (error) => error === token);
    assert.equal(controller.isPaused(), false, '두 소비 완료 전에는 pause를 토글하지 않습니다.');
    controller.setEnabled(1);
    assert.equal(controller.isEnabled(), false);
});

async function createOverlayHarness() {
    const trace = [];
    const state = { focus: ['ui'], paused: true };
    const context = vm.createContext({});
    class BaseOverlay {
        constructor(options) {
            this.overlayOptions = options;
            this.layer = 'ui';
            this.session = null;
        }
        open() { trace.push('base.open'); }
        close() { trace.push('base.close'); }
        _releaseElements() {}
    }
    class LayoutHandler {}
    const modules = new Map([
        ['data/data_handler.js', createSyntheticModule(context, 'data/data_handler.js', {
            getData: () => ({ DEBUG_OVERLAY: { LAYER: 0, DIM_ALPHA: 0 } })
        })],
        ['display/_theme_handler.js', createSyntheticModule(context, 'display/_theme_handler.js', { ColorSchemes: {} })],
        ['input/input_system.js', createSyntheticModule(context, 'input/input_system.js', {
            getMouseFocus: () => { trace.push('focus.get'); return state.focus; },
            setMouseFocus: (focus) => { trace.push('focus.set'); state.focus = focus; }
        })],
        ['ui/layout/_layout_handler.js', createSyntheticModule(context, 'ui/layout/_layout_handler.js', { LayoutHandler })],
        ['util/runtime_tool.js', createSyntheticModule(context, 'util/runtime_tool.js', { runtimeTool: () => null })],
        ['./_base_overlay.js', createSyntheticModule(context, './_base_overlay.js', { BaseOverlay })]
    ]);
    const module = new vm.SourceTextModule(overlaySource, { context, identifier: OVERLAY_PATH });
    await module.link((specifier) => modules.get(specifier));
    await module.evaluate();
    return { DebugOverlay: module.namespace.DebugOverlay, state, trace };
}

test('debug overlay immediate close는 focus와 microtask 순서를 보존한다', async () => {
    const { DebugOverlay, state, trace } = await createOverlayHarness();
    const debugSystem = {
        isAnimationFramePaused() {
            trace.push('paused.get');
            return state.paused;
        }
    };
    const overlay = new DebugOverlay(debugSystem);
    overlay.previousFocus = ['object'];
    overlay.session = Object.fromEntries(['Alpha', 'DimAlpha', 'ContentScale', 'ContentBlur'].map((name) => [
        `set${name}`,
        () => trace.push(`session.${name}`)
    ]));
    overlay.onCloseComplete = () => trace.push('complete');
    overlay.closeHandler = (value) => trace.push(value === overlay ? 'handler' : 'wrong-handler');

    overlay.close();
    assert.deepEqual(trace, [
        'focus.get', 'paused.get', 'session.Alpha', 'session.DimAlpha',
        'session.ContentScale', 'session.ContentBlur', 'focus.set', 'complete'
    ]);
    assert.equal(overlay.closeHandler, null);
    await Promise.resolve();
    assert.equal(trace.at(-1), 'handler');

    trace.length = 0;
    state.focus = ['ui'];
    state.paused = false;
    new DebugOverlay(debugSystem).close();
    assert.deepEqual(trace, ['focus.get', 'paused.get', 'base.close']);

    trace.length = 0;
    state.focus = ['object'];
    const unfocused = new DebugOverlay(debugSystem);
    unfocused.onCloseComplete = () => trace.push('complete');
    unfocused.close();
    assert.deepEqual(trace, ['focus.get', 'paused.get', 'complete']);
});
