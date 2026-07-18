import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadGameModule } from './support/source_module_loader.mjs';

const { TITLE_LOADING_CIRCLE_FRAGMENT_SHADER } = await loadGameModule(
    'display/webgl/_shader_utils.js'
);
const { TITLE_CONSTANTS } = await loadGameModule(
    'data/scene/title/title_constants.js'
);
const { buildTitleSceneTransitionSegments } = await loadGameModule(
    'scene/title/loading/_title_scene_transition_segments.js'
);
const { MixedAnimation } = await loadGameModule(
    'animation/_mixed_animation.js'
);

const sequenceSource = await readFile(
    new URL('../script/module/scene/title/_title_loading_sequence.js', import.meta.url),
    'utf8'
);
assert.match(sequenceSource, /this\.#showTitleLogo\(\);/);
assert.match(sequenceSource, /variable: 'introBlur'/);
assert.match(sequenceSource, /type: TITLE_LOADING\.INTRO_BLUR_EASING/);
assert.match(sequenceSource, /duration: TITLE_LOADING\.INTRO_BLUR_DURATION/);
assert.doesNotMatch(
    sequenceSource,
    /buildTitleLoadingSchedule|drawTitleLoadingText|DebugSkipLoading|loadingProgress|loadingNotice|setTimeout/
);

const centerCircleSource = await readFile(
    new URL('../script/module/scene/title/_title_center_circle.js', import.meta.url),
    'utf8'
);
assert.doesNotMatch(centerCircleSource, /setProgress|wavePhase|secondaryWavePhase/);
assert.match(centerCircleSource, /`blur\(\$\{blur\}px\)`/);
assert.match(centerCircleSource, /effectCanvas\.style\.filter = 'none'/);

const circleEffectPassSource = await readFile(
    new URL('../script/module/display/webgl/_title_loading_circle_effect_pass.js', import.meta.url),
    'utf8'
);
assert.doesNotMatch(
    circleEffectPassSource,
    /command\.progress|command\.wavePhase|u_wavePhase|u_secondaryWavePhase|u_surfaceColor/
);

assert.match(TITLE_LOADING_CIRCLE_FRAGMENT_SHADER, /float fillMask = circleMask;/);
assert.doesNotMatch(
    TITLE_LOADING_CIRCLE_FRAGMENT_SHADER,
    /u_progress|u_wavePhase|u_secondaryWavePhase|surfaceY|surfaceLine|u_surfaceColor/
);

assert.equal('COMPLETE_PROGRESS' in TITLE_CONSTANTS.TITLE_LOADING, false);
assert.equal('STEP_ANIM_DURATION' in TITLE_CONSTANTS.TITLE_LOADING, false);
assert.equal('TEXT_FADE_DURATION' in TITLE_CONSTANTS.TITLE_LOADING, false);
assert.equal(TITLE_CONSTANTS.TITLE_LOADING.INTRO_BLUR_START_PX, 10);
assert.equal(TITLE_CONSTANTS.TITLE_LOADING.INTRO_BLUR_DURATION, 0.6);
assert.equal(TITLE_CONSTANTS.TITLE_LOADING.INTRO_BLUR_EASING, 'easeOutExpo');
assert.equal(TITLE_CONSTANTS.TITLE_LOADING.SCENE_TRANSITION_TRIGGER_PROGRESS, 1);
assert.equal(TITLE_CONSTANTS.TITLE_LOADING.SCENE_TRANSITION_MOTION.ACCEL.DURATION, 0.3);
assert.equal(TITLE_CONSTANTS.TITLE_LOADING.SCENE_TRANSITION_MOTION.ACCEL.EASING, 'easeInExpo');
assert.equal(TITLE_CONSTANTS.TITLE_LOADING.SCENE_TRANSITION_MOTION.CRUISE.DURATION, 0.2);
assert.equal(TITLE_CONSTANTS.TITLE_LOADING.SCENE_TRANSITION_MOTION.CRUISE.EASING, 'linear');
assert.equal(TITLE_CONSTANTS.TITLE_LOADING.SCENE_TRANSITION_MOTION.DECEL.DURATION, 1.5);
assert.equal(TITLE_CONSTANTS.TITLE_LOADING.SCENE_TRANSITION_MOTION.DECEL.EASING, 'easeOutExpo');
assert.equal('ENEMY_SPAWN_READY_LEAD_SECONDS' in TITLE_CONSTANTS.TITLE_LOADING, false);
assert.match(sequenceSource, /animateMixed\(this,/);
assert.match(sequenceSource, /animateMixed\(this\.centerCircle,/);
assert.match(sequenceSource, /buildTitleSceneTransitionSegments/);
assert.doesNotMatch(sequenceSource, /sceneTransitionTimelineProgress/);
assert.match(
    sequenceSource,
    /this\.sceneTransitionProgress >= this\.enemySpawnReadyProgress/
);
assert.match(
    sequenceSource,
    /this\.enemySpawnReadyProgress = transitionSegments\[0\]\?\.endValue \?\? 0;/
);
assert.doesNotMatch(sequenceSource, /getEnemySpawnReadyProgressThreshold|clamp01/);

const transitionSegments = buildTitleSceneTransitionSegments({
    startValue: 0,
    endValue: 1,
    motion: TITLE_CONSTANTS.TITLE_LOADING.SCENE_TRANSITION_MOTION
});
assert.equal(transitionSegments.length, 3);
assert.equal(transitionSegments[0].delay, 0);
assert.equal(transitionSegments[1].delay, 0.3);
assert.equal(transitionSegments[2].delay, 0.5);
assert.equal(
    transitionSegments[2].delay + transitionSegments[2].duration,
    2
);

const expoBoundarySlope = 10 * Math.LN2;
const accelBoundaryVelocity = (transitionSegments[0].endValue - transitionSegments[0].startValue)
    * expoBoundarySlope / transitionSegments[0].duration;
const cruiseVelocity = (transitionSegments[1].endValue - transitionSegments[1].startValue)
    / transitionSegments[1].duration;
const decelBoundaryVelocity = (transitionSegments[2].endValue - transitionSegments[2].startValue)
    * expoBoundarySlope / transitionSegments[2].duration;
assert.ok(Math.abs(accelBoundaryVelocity - cruiseVelocity) < 1e-10);
assert.ok(Math.abs(cruiseVelocity - decelBoundaryVelocity) < 1e-10);

const transitionOwner = { progress: 0 };
const transitionAnimation = new MixedAnimation();
transitionAnimation.init(0, transitionOwner, 'progress', transitionSegments);
transitionAnimation.update(0.3);
assert.ok(Math.abs(transitionOwner.progress - transitionSegments[0].endValue) < 1e-10);
transitionAnimation.update(0.2);
assert.ok(Math.abs(transitionOwner.progress - transitionSegments[1].endValue) < 1e-10);
transitionAnimation.update(1.5);
assert.ok(Math.abs(transitionOwner.progress - 1) < 1e-10);

for (const languageFile of ['_korean.js', '_english.js']) {
    const languageSource = await readFile(
        new URL(`../script/module/ui/lang/${languageFile}`, import.meta.url),
        'utf8'
    );
    assert.doesNotMatch(languageSource, /title_loading_notice|"title_loading"/);
}

console.log('title intro sequence contract: ok');
