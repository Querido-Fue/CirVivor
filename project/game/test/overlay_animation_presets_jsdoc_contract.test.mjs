import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadGameModule } from './support/source_module_loader.mjs';

const PRESET_SOURCE_URL = new URL(
    '../script/module/overlay/_animation_presets.js',
    import.meta.url
);
const EXPECTED_RUNTIME_SOURCE_SHA256 = '69f9153afc6f0a811dba8afacb3494ad2ccd220638ddc3b6813315be6e76468b';

const presetSource = await readFile(PRESET_SOURCE_URL, 'utf8');
const presetModule = await loadGameModule('overlay/_animation_presets.js');

function stripStandaloneJSDoc(source) {
    const matches = [...source.matchAll(/\/\*\*[\s\S]*?\*\//g)];
    assert.equal(matches.length, 3, '예상하지 못한 JSDoc 추가/삭제를 검출해야 합니다.');

    for (const match of matches) {
        const start = match.index;
        const end = start + match[0].length;
        const lineStart = source.lastIndexOf('\n', start - 1) + 1;
        const lineEndIndex = source.indexOf('\n', end);
        const lineEnd = lineEndIndex === -1 ? source.length : lineEndIndex;
        assert.equal(source.slice(lineStart, start), '', 'JSDoc은 독립된 줄에서 시작해야 합니다.');
        assert.equal(source.slice(end, lineEnd), '', 'JSDoc 뒤에는 실행 코드가 없어야 합니다.');
    }

    return source.replace(/\/\*\*[\s\S]*?\*\//g, '');
}

function runtimeSourceHash(source) {
    return createHash('sha256').update(stripStandaloneJSDoc(source)).digest('hex');
}

test('resolver JSDoc은 실제 직접 조회 및 두 번의 키 변환 계약을 설명한다', () => {
    const resolverDeclaration = 'export const getOverlayAnimationPreset';
    const declarationIndex = presetSource.indexOf(resolverDeclaration);
    assert.notEqual(declarationIndex, -1);

    const commentStart = presetSource.lastIndexOf('/**', declarationIndex);
    const commentEnd = presetSource.indexOf('*/', commentStart);
    assert.notEqual(commentStart, -1);
    assert.ok(commentEnd > commentStart);

    const jsdoc = presetSource.slice(commentStart, commentEnd + 2);
    assert.match(jsdoc, /truthy인 이름으로 프리셋 프로퍼티를 직접 조회/);
    assert.match(jsdoc, /own-key\/type 검증이 없고 성공한 키를 다시 조회/);
    assert.match(jsdoc, /상속 키·키 변환·예외·두 조회 사이 결과를 그대로 보존/);
    assert.match(jsdoc, /@param \{\*\} name/);
    assert.match(jsdoc, /@returns \{\*\}/);
});

test('JSDoc을 제외한 actual production source는 바이트 단위로 동일하다', () => {
    assert.equal(runtimeSourceHash(presetSource), EXPECTED_RUNTIME_SOURCE_SHA256);
});

test('overlay 구현 모듈이 세 production export와 preset 값을 직접 소유한다', () => {
    assert.doesNotMatch(presetSource, /data\/data_handler\.js/);
    assert.match(presetSource, /export const DEFAULT_OVERLAY_ANIMATION_PRESET/);
    assert.match(presetSource, /export const OVERLAY_ANIMATION_PRESETS/);
    assert.match(presetSource, /export const getOverlayAnimationPreset/);

    const table = presetModule.OVERLAY_ANIMATION_PRESETS;
    assert.equal(presetModule.DEFAULT_OVERLAY_ANIMATION_PRESET, 'uiAnimation');
    assert.deepEqual(Object.keys(table), ['uiAnimation', 'softFocus', 'snapZoom']);
    assert.equal(Object.isFrozen(table), true);
    assert.deepEqual({ ...table.uiAnimation.open.alpha }, {
        from: 0, to: 1, duration: 0.5, easing: 'easeOutExpo'
    });
    assert.deepEqual({ ...table.softFocus.close.blur }, {
        to: 6, duration: 0.22, easing: 'easeInCubic'
    });
    assert.deepEqual({ ...table.snapZoom.open.scale }, {
        from: 0.92, to: 1, duration: 0.2, easing: 'easeOutExpo'
    });
});

test('유효 키와 표준 falsy fallback은 정확한 preset identity를 보존한다', () => {
    const table = presetModule.OVERLAY_ANIMATION_PRESETS;
    const resolve = presetModule.getOverlayAnimationPreset;
    const defaultPreset = table[presetModule.DEFAULT_OVERLAY_ANIMATION_PRESET];

    for (const key of ['uiAnimation', 'softFocus', 'snapZoom']) {
        assert.strictEqual(resolve(key), table[key], key);
    }

    for (const value of [undefined, null, false, 0, -0, 0n, Number.NaN, '']) {
        assert.strictEqual(resolve(value), defaultPreset, String(value));
    }
});

test('truthy 미등록 키와 boxed string의 production coercion을 보존한다', () => {
    const table = presetModule.OVERLAY_ANIMATION_PRESETS;
    const resolve = presetModule.getOverlayAnimationPreset;
    const defaultPreset = table[presetModule.DEFAULT_OVERLAY_ANIMATION_PRESET];

    for (const value of ['missing', 1, true, Symbol('missing')]) {
        assert.strictEqual(resolve(value), defaultPreset, String(value));
    }
    assert.strictEqual(resolve(new String('softFocus')), table.softFocus);
});

test('own-key 검증이 없는 상속 프로퍼티 반환을 정확히 보존한다', () => {
    const table = presetModule.OVERLAY_ANIMATION_PRESETS;
    const resolve = presetModule.getOverlayAnimationPreset;

    for (const key of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
        assert.strictEqual(resolve(key), table[key], key);
    }
});

test('성공 경로는 키를 두 번 변환하고 두 번째 조회 결과를 반환한다', () => {
    const table = presetModule.OVERLAY_ANIMATION_PRESETS;
    const resolve = presetModule.getOverlayAnimationPreset;
    let conversionCount = 0;
    const alternatingKey = {
        [Symbol.toPrimitive]() {
            conversionCount += 1;
            return conversionCount === 1 ? 'softFocus' : 'snapZoom';
        }
    };

    assert.strictEqual(resolve(alternatingKey), table.snapZoom);
    assert.equal(conversionCount, 2);
});

test('첫 조회만 성공하면 두 번째 미등록 조회의 undefined도 그대로 반환한다', () => {
    const resolve = presetModule.getOverlayAnimationPreset;
    let conversionCount = 0;
    const disappearingKey = {
        [Symbol.toPrimitive]() {
            conversionCount += 1;
            return conversionCount === 1 ? 'softFocus' : 'missing';
        }
    };

    assert.strictEqual(resolve(disappearingKey), undefined);
    assert.equal(conversionCount, 2);
});

test('첫 조회가 실패하면 키 변환은 한 번뿐이고 기본 preset을 반환한다', () => {
    const table = presetModule.OVERLAY_ANIMATION_PRESETS;
    const resolve = presetModule.getOverlayAnimationPreset;
    const defaultPreset = table[presetModule.DEFAULT_OVERLAY_ANIMATION_PRESET];
    let conversionCount = 0;
    const missingKey = {
        [Symbol.toPrimitive]() {
            conversionCount += 1;
            return 'missing';
        }
    };

    assert.strictEqual(resolve(missingKey), defaultPreset);
    assert.equal(conversionCount, 1);
});

test('첫 번째와 두 번째 키 변환 예외를 같은 identity로 전파한다', () => {
    const resolve = presetModule.getOverlayAnimationPreset;
    const firstError = new Error('first conversion');
    assert.throws(
        () => resolve({ [Symbol.toPrimitive]() { throw firstError; } }),
        (error) => error === firstError
    );

    const secondError = new Error('second conversion');
    let conversionCount = 0;
    assert.throws(
        () => resolve({
            [Symbol.toPrimitive]() {
                conversionCount += 1;
                if (conversionCount === 2) throw secondError;
                return 'uiAnimation';
            }
        }),
        (error) => error === secondError
    );
    assert.equal(conversionCount, 2);
});

test('primitive 변환 메서드가 없는 null-prototype 키의 TypeError를 전파한다', () => {
    assert.throws(
        () => presetModule.getOverlayAnimationPreset(Object.create(null)),
        (error) => error?.name === 'TypeError'
            && error?.message === 'Cannot convert object to primitive value'
    );
});
