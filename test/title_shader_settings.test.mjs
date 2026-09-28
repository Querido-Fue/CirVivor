import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGameModule } from './support/source_module_loader.mjs';

const settings = await loadGameModule('display/_title_shader_settings.js');
const color = await loadGameModule('util/color_util.js');
const center = await loadGameModule('scene/title/webgpu/_title_webgpu_center_circle_pass.js');
const shield = await loadGameModule('scene/title/webgpu/_title_webgpu_shield_pass.js');
const gl = await loadGameModule('display/webgl/_shader_utils.js');

test('모든 설정은 유효한 범위와 고유 ABI 슬롯을 가지며 비유한 값은 거부한다', () => {
    assert.ok(settings.TITLE_SHADER_SETTINGS.length >= 60);
    const ids = new Set();
    for (const item of settings.TITLE_SHADER_SETTINGS) {
        assert.ok(!ids.has(item.id)); ids.add(item.id);
        assert.ok(item.min < item.max && item.step > 0);
        assert.ok(item.defaultValue >= item.min && item.defaultValue <= item.max);
        settings.setTitleShaderSetting(item.id, Infinity);
        assert.equal(settings.getTitleShaderSetting(item.id), item.defaultValue);
        settings.setTitleShaderSetting(item.id, item.min - 100);
        assert.equal(settings.getTitleShaderSetting(item.id), item.min);
        settings.setTitleShaderSetting(item.id, item.max + 100);
        assert.equal(settings.getTitleShaderSetting(item.id), item.max);
    }
    settings.resetTitleShaderSettings();
    assert.equal(settings.getTitleShaderSetting('pulsePeriod'), 8);
    assert.equal(settings.setTitleShaderSetting('__proto__', 1), false);
});

test('아우라·레이 수식의 모든 가변 슬롯을 두 렌더러가 동일하게 소비한다', () => {
    const wgsl = center.TITLE_WEBGPU_CENTER_CIRCLE_SHADER + shield.TITLE_WEBGPU_SHIELD_SHADER;
    const glsl = gl.TITLE_LOADING_CIRCLE_FRAGMENT_SHADER + gl.MAGNETIC_SHIELD_FRAGMENT_SHADER;
    const refs = (source, prefix) => [...source.matchAll(new RegExp(prefix + '\\[(\\d+)\\]\\.([xyzw])(?![xyzw])', 'g'))]
        .map(match => Number(match[1]) * 4 + 'xyzw'.indexOf(match[2])).sort((a, b) => a - b);
    assert.deepEqual([...new Set(refs(wgsl, 'parameters\\.tuning'))], [...new Set(refs(glsl, 'u_tuning'))]);
    const before = Array.from(settings.getTitleShaderUniforms());
    settings.setTitleShaderSetting('solarIntensity', 6);
    const after = settings.getTitleShaderUniforms();
    const index = settings.TITLE_SHADER_SETTINGS.find(item => item.id === 'solarIntensity').index;
    assert.equal(after[index], 6);
    assert.deepEqual(Array.from(after).filter((_, i) => i !== index), before.filter((_, i) => i !== index));
    settings.resetTitleShaderSettings();
});

test('HSL은 원래 색상을 보존하고 색조를 순환하며 수정 시에만 색상 캐시를 바꾼다', () => {
    const original = [0.72, 0.36, 0.96];
    const hsl = color.rgbToHsl(original);
    color.hslToRgb(...hsl).forEach((value, i) => assert.ok(Math.abs(value - original[i]) < 1e-10));
    assert.strictEqual(settings.tuneTitleShaderColor(original, 'aura'), original);
    settings.setTitleShaderSetting('auraHue', 90);
    const changed = settings.tuneTitleShaderColor(original, 'aura');
    assert.notDeepEqual(changed, original);
    assert.strictEqual(settings.tuneTitleShaderColor(original, 'aura'), changed);
    settings.setTitleShaderSetting('auraSaturation', 0);
    const gray = settings.tuneTitleShaderColor(original, 'aura');
    assert.equal(gray[0], gray[1]); assert.equal(gray[1], gray[2]);
    settings.resetTitleShaderSettings();
});

test('저장한 전체 설정은 새 런타임에 복원되며 초기화 결과도 저장된다', async () => {
    let stored;
    settings.initializeTitleShaderSettings({}, async snapshot => { stored = JSON.stringify(snapshot); });
    settings.setTitleShaderSetting('pulsePeriod', 11);
    settings.setTitleShaderSetting('auraHue', -18);
    settings.setTitleShaderSetting('backlightIntensity', 0.47);
    assert.equal(stored, undefined, '드래그 미리보기에는 파일 쓰기가 없어야 한다');
    await settings.saveTitleShaderSettings();
    const freshLoader = await import('./support/source_module_loader.mjs?title-shader-restart');
    const restarted = await freshLoader.loadGameModule('display/_title_shader_settings.js');
    restarted.initializeTitleShaderSettings(JSON.parse(stored), async snapshot => { stored = JSON.stringify(snapshot); });
    assert.equal(restarted.getTitleShaderSetting('pulsePeriod'), 11);
    assert.equal(restarted.getTitleShaderSetting('auraHue'), -18);
    assert.equal(restarted.getTitleShaderSetting('backlightIntensity'), 0.47);
    assert.equal(Object.keys(JSON.parse(stored)).length, settings.TITLE_SHADER_SETTINGS.length);
    restarted.resetTitleShaderSettings();
    await restarted.saveTitleShaderSettings();
    assert.equal(JSON.parse(stored).pulsePeriod, 8);
    assert.equal(JSON.parse(stored).backlightIntensity, 0.32);
    settings.initializeTitleShaderSettings({}, null);
});

test('오래되거나 잘못된 저장값은 카탈로그 범위와 기본값으로 복원된다', () => {
    settings.initializeTitleShaderSettings({ pulsePeriod: 999, auraHue: null, glowStrength: 'invalid', removed: 4 }, null);
    assert.equal(settings.getTitleShaderSetting('pulsePeriod'), 30);
    assert.equal(settings.getTitleShaderSetting('auraHue'), 0);
    assert.equal(settings.getTitleShaderSetting('glowStrength'), 0.12);
    assert.equal(settings.getTitleShaderSetting('backlightWidth'), 0.24);
    assert.equal(settings.getTitleShaderSetting('removed'), undefined);
    settings.initializeTitleShaderSettings({}, null);
});

test('저장 실패 후에도 최신 스냅샷을 다시 저장할 수 있다', async () => {
    let fail = true;
    let stored;
    settings.initializeTitleShaderSettings({}, async snapshot => {
        if (fail) throw new Error('disk unavailable');
        stored = snapshot;
    });
    settings.setTitleShaderSetting('pulsePeriod', 9);
    await assert.rejects(settings.saveTitleShaderSettings(), /disk unavailable/);
    fail = false;
    settings.setTitleShaderSetting('pulsePeriod', 12);
    await settings.saveTitleShaderSettings();
    assert.equal(stored.pulsePeriod, 12);
    settings.initializeTitleShaderSettings({}, null);
});
