import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadGameModule } from './support/source_module_loader.mjs';

const HANDLER_SOURCE_PATH = fileURLToPath(new URL(
    '../script/module/display/webgl/_webgl_handler.js',
    import.meta.url
));
const ADAPTER_SOURCE_PATH = fileURLToPath(new URL(
    '../script/module/display/webgl/_webgl_layer_renderer.js',
    import.meta.url
));
const handlerSource = await readFile(HANDLER_SOURCE_PATH, 'utf8');
const adapterSource = await readFile(ADAPTER_SOURCE_PATH, 'utf8');
const { WebGLHandler } = await loadGameModule('display/webgl/_webgl_handler.js');
const { flushWebGLLayerRenderer } = await loadGameModule('display/webgl/_webgl_layer_renderer.js');
const { WebGLBatch } = await loadGameModule('display/webgl/_webgl_batch.js');
const { EffectRenderer } = await loadGameModule('display/webgl/_effect_renderer.js');
const { OverlayEffectRenderer } = await loadGameModule('display/webgl/_overlay_effect_renderer.js');

const HANDLER_EXECUTABLE_HASH = '091808e7adbdc37468fe890179d4d52707453b6eda3060336ce213074e986478';
const ADAPTER_EXECUTABLE_HASH = 'f7f1e996145edb655d524338a2b7d5a876e91af1d74a5d408f1d6ac1c607bc27';

function hashExecutableSource(source, expectedJsDocCount) {
    const allJsDocStarts = source.match(/\/\*\*/g) ?? [];
    const standaloneJsDocStarts = source.match(/^[ \t]*\/\*\*/gm) ?? [];
    assert.equal(standaloneJsDocStarts.length, allJsDocStarts.length);
    assert.equal(standaloneJsDocStarts.length, expectedJsDocCount);
    return createHash('sha256')
        .update(source.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\r\n/g, '\n'))
        .digest('hex');
}

function findLeadingJsDoc(source, escapedDeclaration) {
    const match = source.match(
        new RegExp(`/\\*\\*((?:(?!\\*/)[\\s\\S])*)\\*/\\s*${escapedDeclaration}`)
    );
    assert.ok(match, `${escapedDeclaration} 선언 앞 JSDoc을 찾을 수 없습니다.`);
    return match[1];
}

function createRenderer(prototype, label, trace, action = null) {
    const renderer = Object.create(prototype);
    Object.defineProperty(renderer, 'flush', {
        configurable: true,
        value() {
            assert.strictEqual(this, renderer);
            trace.push(label);
            action?.();
            return Object.defineProperty({}, 'then', {
                get() {
                    throw new Error('flush 반환 thenable을 관찰하면 안 됩니다.');
                }
            });
        }
    });
    return renderer;
}

test('flush 실행 소스 해시는 유지되고 JSDoc은 실제 대상·순회·오류 계약을 설명한다', () => {
    assert.equal(hashExecutableSource(handlerSource, 14), HANDLER_EXECUTABLE_HASH);
    assert.equal(hashExecutableSource(adapterSource, 8), ADAPTER_EXECUTABLE_HASH);

    const adapterJsDoc = findLeadingJsDoc(adapterSource, 'export function flushWebGLLayerRenderer');
    assert.match(adapterJsDoc, /WebGLBatch 또는 EffectRenderer/u);
    assert.match(adapterJsDoc, /OverlayEffectRenderer/u);
    assert.match(adapterJsDoc, /instanceof/u);
    assert.match(adapterJsDoc, /판정이 모두 false로 정상 완료/u);
    assert.match(adapterJsDoc, /판정·`flush` 조회·호출 예외/u);
    assert.match(adapterJsDoc, /반환값과 thenable/u);
    assert.match(adapterJsDoc, /@returns \{undefined\}/u);

    const handlerJsDoc = findLeadingJsDoc(handlerSource, 'flushAll\\(\\)');
    assert.match(handlerJsDoc, /layerRenderers/u);
    assert.match(handlerJsDoc, /context-lost/u);
    assert.match(handlerJsDoc, /프레임당 1회 또는 재진입 guard가 없습니다/u);
    assert.match(handlerJsDoc, /프로퍼티 자체 교체/u);
    assert.match(handlerJsDoc, /rollback/u);
    assert.match(handlerJsDoc, /@returns \{undefined\}/u);
});

test('flush adapter와 flushAll은 context-lost를 제외한 지원 renderer만 등록 순서로 호출한다', () => {
    const trace = [];
    const batch = createRenderer(WebGLBatch.prototype, 'batch', trace);
    const effect = createRenderer(EffectRenderer.prototype, 'effect', trace);
    const overlay = Object.create(OverlayEffectRenderer.prototype);
    const unrelated = {};
    for (const renderer of [overlay, unrelated]) {
        Object.defineProperty(renderer, 'flush', {
            get() {
                throw new Error('지원하지 않는 renderer의 flush를 읽으면 안 됩니다.');
            }
        });
    }

    for (const renderer of [null, undefined, false, 0, Symbol('renderer'), overlay, unrelated]) {
        assert.equal(flushWebGLLayerRenderer(renderer), undefined);
    }
    assert.equal(flushWebGLLayerRenderer(batch), undefined);
    assert.equal(flushWebGLLayerRenderer(effect), undefined);
    assert.deepEqual(trace, ['batch', 'effect']);
    assert.equal(flushWebGLLayerRenderer.name, 'flushWebGLLayerRenderer');
    assert.equal(flushWebGLLayerRenderer.length, 1);
    assert.ok(Reflect.construct(flushWebGLLayerRenderer, []) instanceof flushWebGLLayerRenderer);

    const handlerTrace = [];
    const handler = new WebGLHandler();
    handler.layerRenderers.set('batch', createRenderer(WebGLBatch.prototype, 'batch', handlerTrace));
    const lostRenderer = new Proxy({}, {
        getPrototypeOf() {
            throw new Error('context-lost renderer를 판정하면 안 됩니다.');
        }
    });
    handler.layerRenderers.set('lost-effect', lostRenderer);
    handler.layerRenderers.set('effect', createRenderer(EffectRenderer.prototype, 'effect', handlerTrace));
    handler.layerRenderers.set('overlay', Object.create(OverlayEffectRenderer.prototype));
    handler.layerRenderers.set('custom', { flush() { handlerTrace.push('custom'); } });
    handler.contextLostLayers.add('lost-effect');

    assert.equal(handler.flushAll(), undefined);
    assert.deepEqual(handlerTrace, ['batch', 'effect']);
    assert.equal(WebGLHandler.prototype.flushAll.length, 0);
    assert.throws(() => Reflect.construct(WebGLHandler.prototype.flushAll, []), TypeError);
});

test('flushAll은 live Map 변경을 반영하고 flush 오류를 그대로 전파해 뒤 renderer를 중단한다', () => {
    const trace = [];
    const handler = new WebGLHandler();
    const originalMap = handler.layerRenderers;
    const secondLive = createRenderer(WebGLBatch.prototype, 'second-live', trace);
    const fourth = createRenderer(EffectRenderer.prototype, 'fourth', trace);
    const replacement = createRenderer(WebGLBatch.prototype, 'replacement', trace);
    const first = createRenderer(WebGLBatch.prototype, 'first', trace, () => {
        originalMap.set('second', secondLive);
        originalMap.delete('third');
        originalMap.set('fourth', fourth);
        handler.layerRenderers = new Map([['replacement', replacement]]);
    });
    originalMap.set('first', first);
    originalMap.set('second', createRenderer(WebGLBatch.prototype, 'second-stale', trace));
    originalMap.set('third', createRenderer(WebGLBatch.prototype, 'third', trace));

    handler.flushAll();
    assert.deepEqual(trace, ['first', 'second-live', 'fourth']);
    handler.flushAll();
    assert.deepEqual(trace, ['first', 'second-live', 'fourth', 'replacement']);

    const error = Object.freeze({ source: 'flush' });
    const errorTrace = [];
    const errorHandler = new WebGLHandler();
    errorHandler.layerRenderers.set('first', createRenderer(WebGLBatch.prototype, 'first', errorTrace, () => {
        throw error;
    }));
    errorHandler.layerRenderers.set('later', createRenderer(EffectRenderer.prototype, 'later', errorTrace));
    assert.throws(() => errorHandler.flushAll(), (thrown) => thrown === error);
    assert.deepEqual(errorTrace, ['first']);

    const reentryTrace = [];
    const reentryHandler = new WebGLHandler();
    let depth = 0;
    const reentryFirst = Object.create(WebGLBatch.prototype);
    reentryFirst.flush = function flush() {
        assert.strictEqual(this, reentryFirst);
        if (depth > 0) {
            reentryTrace.push('nested:first');
            return;
        }
        reentryTrace.push('outer:first:start');
        depth = 1;
        reentryHandler.flushAll();
        depth = 0;
        reentryTrace.push('outer:first:end');
    };
    const reentrySecond = Object.create(EffectRenderer.prototype);
    reentrySecond.flush = function flush() {
        assert.strictEqual(this, reentrySecond);
        reentryTrace.push(depth > 0 ? 'nested:second' : 'outer:second');
    };
    reentryHandler.layerRenderers.set('first', reentryFirst);
    reentryHandler.layerRenderers.set('second', reentrySecond);
    reentryHandler.flushAll();
    assert.deepEqual(reentryTrace, [
        'outer:first:start',
        'nested:first',
        'nested:second',
        'outer:first:end',
        'outer:second'
    ]);
});
