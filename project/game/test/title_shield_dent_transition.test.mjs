import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const [effectSource, configSource, titleConstantsSource, shaderUtilsSource] = await Promise.all([
    readFile(new URL('../script/module/scene/title/shield/_title_shield_effect.js', import.meta.url), 'utf8'),
    readFile(new URL('../script/module/scene/title/shield/_title_shield_config.js', import.meta.url), 'utf8'),
    readFile(new URL('../script/data/scene/title/title_constants.js', import.meta.url), 'utf8'),
    readFile(new URL('../script/module/display/webgl/_shader_utils.js', import.meta.url), 'utf8')
]);

let frameDelta = 0;
let lastRenderCommand = null;

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

function easeOutExpo(progress) {
    const clamped = clamp01(progress);
    if (clamped <= 0) return 0;
    if (clamped >= 1) return 1;
    return 1 - Math.pow(2, -10 * clamped);
}

function lerpNumber(startValue, endValue, progress) {
    return startValue + ((endValue - startValue) * progress);
}

function getShieldAngularDelta(angleA, angleB) {
    return Math.atan2(Math.sin(angleB - angleA), Math.cos(angleB - angleA));
}

function lerpShieldAngle(currentAngle, targetAngle, factor) {
    return currentAngle + (getShieldAngularDelta(currentAngle, targetAngle) * clamp01(factor));
}

class StubTitleShieldConfig {
    getShellRadiusMultiplier() { return 1; }
    getVisualDelta(delta) { return delta; }
    getLayoutFollowRate() { return 100000; }
    getImpactAngleFollowRate() { return 1; }
    getImpactIntensityFollowRate() { return 1; }
    getImpactWidthFollowRate() { return 1; }
    getImpactBandPx() { return 0; }
    getContactPaddingPx() { return 0; }
    getBoundaryEpsilonPx() { return 0; }
    getContactHysteresisPx() { return 0; }
    getPressureInfluencePx() { return 1; }
    getVisualTriggerDistanceMultiplier() { return 1; }
    getPressureFollowRate() { return 100000; }
    getPressureReleaseFollowRate() { return 100000; }
    getDentAngleFollowRate() { return 100000; }
    getMaxDepthPx() { return 10; }
    getDentMaxCount() { return 1; }
    getDentRenderMaxCount() { return 2; }
    getDentSwitchBias() { return 0; }
    getDentDepthSwitchBias() { return 0; }
    getDentTransitionDuration() { return 0.3; }
    getDentCrossfadeAngleThreshold() { return 10 * (Math.PI / 180); }
    buildAngularWidth() { return 0.2; }
}

function createSyntheticModule(context, exports) {
    return new vm.SyntheticModule(Object.keys(exports), function initialize() {
        for (const [name, value] of Object.entries(exports)) {
            this.setExport(name, value);
        }
    }, { context });
}

const context = vm.createContext({ console });
const effectModule = new vm.SourceTextModule(effectSource, {
    context,
    identifier: '_title_shield_effect.js'
});
const dependencies = new Map([
    ['display/display_system.js', createSyntheticModule(context, {
        renderGL(layer, command) {
            lastRenderCommand = {
                layer,
                command: {
                    ...command,
                    dents: command.dents.map((dent) => ({ ...dent }))
                }
            };
        }
    })],
    ['game/time_handler.js', createSyntheticModule(context, {
        getDelta: () => frameDelta
    })],
    ['util/number_util.js', createSyntheticModule(context, {
        clamp01,
        easeOutExpo,
        lerpNumber
    })],
    ['./_title_shield_config.js', createSyntheticModule(context, {
        TitleShieldConfig: StubTitleShieldConfig
    })],
    ['./_title_shield_render_command.js', createSyntheticModule(context, {
        buildTitleShieldRenderCommand: (state) => state
    })],
    ['./_title_shield_geometry.js', createSyntheticModule(context, {
        calculateShieldPressure: () => 1,
        getEnemyScreenRadius: (enemy) => enemy.radius,
        getShieldAngularDelta,
        isShieldReactiveEnemy: () => true,
        lerpShieldAngle,
        stabilizeShieldBoundaryDistance: (distance) => distance
    })]
]);
await effectModule.link((specifier) => dependencies.get(specifier));
await effectModule.evaluate();

const { TitleShieldEffect } = effectModule.namespace;
const effect = new TitleShieldEffect();
const createEnemy = (id, angle) => ({
    id,
    active: true,
    radius: 10,
    renderPosition: {
        x: Math.cos(angle) * 200,
        y: Math.sin(angle) * 200
    }
});
const angleA = 0;
const angleB = Math.PI * 0.5;
const angleC = angleB + (5 * (Math.PI / 180));
const angleD = angleC + (10 * (Math.PI / 180));
const enemyA = createEnemy(1, angleA);
const enemyB = createEnemy(2, angleB);
const enemyC = createEnemy(3, angleC);
const enemyD = createEnemy(4, angleD);

effect.syncLayout({ centerX: 0, centerY: 0, radius: 100 });
frameDelta = 0.3;
effect.update([enemyA], 0);
effect.draw();
assert.equal(lastRenderCommand.command.dents.length, 1);
assert.equal(lastRenderCommand.command.dents[0].angle, angleA);
const initialStrength = lastRenderCommand.command.dents[0].strength;

frameDelta = 0.01;
effect.update([enemyB], 0);
effect.draw();
assert.equal(lastRenderCommand.command.dents.length, 2);
const wideSwitchDents = lastRenderCommand.command.dents.slice().sort((left, right) => left.angle - right.angle);
const wideSwitchAngles = wideSwitchDents.map((dent) => dent.angle);
assert.ok(Math.abs(wideSwitchAngles[0] - angleA) < 1e-10);
assert.ok(Math.abs(wideSwitchAngles[1] - angleB) < 1e-10);
const wideSwitchProgress = easeOutExpo(frameDelta / 0.3);
assert.ok(Math.abs(wideSwitchDents[0].strength - (initialStrength * (1 - wideSwitchProgress))) < 1e-10);
assert.ok(Math.abs(wideSwitchDents[1].strength - wideSwitchProgress) < 1e-10);
assert.ok(
    !lastRenderCommand.command.dents.some((dent) => dent.angle > angleA && dent.angle < angleB),
    '10도 이상 떨어진 대상 전환은 중간 각도로 레이를 회전시키지 않아야 합니다.'
);

frameDelta = 0.29;
effect.update([enemyB], 0);
effect.draw();
assert.equal(lastRenderCommand.command.dents.length, 1);
assert.ok(Math.abs(lastRenderCommand.command.dents[0].angle - angleB) < 1e-10);

frameDelta = 0.01;
effect.update([enemyC], 0);
effect.draw();
const switchProgress = easeOutExpo(frameDelta / 0.3);
assert.equal(lastRenderCommand.command.dents.length, 1);
assert.ok(
    Math.abs(lastRenderCommand.command.dents[0].angle - lerpShieldAngle(angleB, angleC, switchProgress)) < 1e-10,
    '10도 미만의 대상 전환은 기존 레이의 짧은 각도 보간을 유지해야 합니다.'
);

frameDelta = 0.29;
effect.update([enemyC], 0);
effect.draw();
assert.ok(Math.abs(lastRenderCommand.command.dents[0].angle - angleC) < 1e-10);

frameDelta = 0.01;
effect.update([enemyD], 0);
effect.draw();
assert.equal(lastRenderCommand.command.dents.length, 2);
const thresholdSwitchAngles = lastRenderCommand.command.dents.map((dent) => dent.angle).sort((left, right) => left - right);
assert.ok(Math.abs(thresholdSwitchAngles[0] - angleC) < 1e-10);
assert.ok(Math.abs(thresholdSwitchAngles[1] - angleD) < 1e-10);

frameDelta = 0.29;
effect.update([enemyD], 0);
effect.draw();
assert.equal(lastRenderCommand.command.dents.length, 1);
assert.ok(Math.abs(lastRenderCommand.command.dents[0].angle - angleD) < 1e-10);
const strengthBeforeRelease = lastRenderCommand.command.dents[0].strength;

frameDelta = 0.15;
effect.update([], 0);
effect.draw();
assert.equal(lastRenderCommand.command.dents.length, 1);
assert.ok(
    Math.abs(lastRenderCommand.command.dents[0].strength - (strengthBeforeRelease * (1 - easeOutExpo(0.5)))) < 1e-10,
    '추적 해제 중에는 easeOutExpo 진행률로 dent 강도가 사라져야 합니다.'
);

frameDelta = 0.15;
effect.update([], 0);
effect.draw();
assert.equal(lastRenderCommand.command.dents.length, 0);

assert.match(titleConstantsSource, /DENT_TRANSITION_DURATION_SECONDS:\s*0\.3/);
assert.match(titleConstantsSource, /DENT_CROSSFADE_ANGLE_DEGREES:\s*10/);
assert.match(titleConstantsSource, /DENT_RENDER_MAX_COUNT:\s*16/);
assert.match(configSource, /getDentTransitionDuration\(\)[\s\S]*?DENT_TRANSITION_DURATION_SECONDS/);
assert.match(configSource, /getDentCrossfadeAngleThreshold\(\)[\s\S]*?DENT_CROSSFADE_ANGLE_DEGREES/);
assert.match(shaderUtilsSource, /MAGNETIC_SHIELD_MAX_DENTS\s*=\s*16/);

console.log('title shield dent transition: ok');
