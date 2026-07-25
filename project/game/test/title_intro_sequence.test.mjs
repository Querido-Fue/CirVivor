import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadGameModule } from './support/source_module_loader.mjs';

const { TITLE_LOADING_CIRCLE_FRAGMENT_SHADER } = await loadGameModule(
    'display/webgl/_shader_utils.js'
);
const { TITLE_LOADING_CONSTANTS: TITLE_LOADING } = await loadGameModule(
    'scene/title/_title_runtime_constants.js'
);
const { buildTitleSceneTransitionSegments } = await loadGameModule(
    'scene/title/loading/_title_scene_transition_segments.js'
);
const { advanceTitleIntroDelay } = await loadGameModule(
    'scene/title/loading/_title_intro_delay.js'
);
const { MixedAnimation } = await loadGameModule(
    'animation/_mixed_animation.js'
);

const sequenceSource = await readFile(
    new URL('../script/module/scene/title/_title_loading_sequence.js', import.meta.url),
    'utf8'
);
const titleSceneIntroSource = await readFile(
    new URL('../script/module/scene/title/_title_scene_intro_sequence.js', import.meta.url),
    'utf8'
);
assert.match(sequenceSource, /this\.#showTitleLogo\(\);/);
assert.match(sequenceSource, /advanceTitleIntroDelay\(/);
assert.match(sequenceSource, /TITLE_LOADING\.INTRO_START_DELAY_SECONDS/);
assert.match(sequenceSource, /if \(delayState\.ready\) \{\s*this\.#startIntro\(\);/);
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

assert.equal('COMPLETE_PROGRESS' in TITLE_LOADING, false);
assert.equal('STEP_ANIM_DURATION' in TITLE_LOADING, false);
assert.equal('TEXT_FADE_DURATION' in TITLE_LOADING, false);
assert.equal(TITLE_LOADING.INTRO_BLUR_START_PX, 10);
assert.equal(TITLE_LOADING.INTRO_START_DELAY_SECONDS, 1.5);
assert.equal(TITLE_LOADING.INTRO_BLUR_DURATION, 0.6);
assert.equal(TITLE_LOADING.INTRO_BLUR_EASING, 'easeOutExpo');

let introDelayState = advanceTitleIntroDelay(0, 0, 1.5);
assert.equal(introDelayState.elapsed, 0);
assert.equal(introDelayState.ready, false);
introDelayState = advanceTitleIntroDelay(0, 1.49, 1.5);
assert.equal(introDelayState.elapsed, 1.49);
assert.equal(introDelayState.ready, false);
introDelayState = advanceTitleIntroDelay(1.49, 0.01, 1.5);
assert.equal(introDelayState.elapsed, 1.5);
assert.equal(introDelayState.ready, true);
introDelayState = advanceTitleIntroDelay(1.4, 0.5, 1.5);
assert.equal(introDelayState.elapsed, 1.5);
assert.equal(introDelayState.ready, true);
assert.equal(advanceTitleIntroDelay(0.4, Number.NaN, 1.5).elapsed, 0.4);
assert.equal(advanceTitleIntroDelay(0.4, -1, 1.5).elapsed, 0.4);
assert.equal(TITLE_LOADING.SCENE_TRANSITION_TRIGGER_PROGRESS, 1);
assert.equal(TITLE_LOADING.SCENE_TRANSITION_MOTION.ACCEL.DURATION, 0.3);
assert.equal(TITLE_LOADING.SCENE_TRANSITION_MOTION.ACCEL.EASING, 'easeInExpo');
assert.equal(TITLE_LOADING.SCENE_TRANSITION_MOTION.CRUISE.DURATION, 0.2);
assert.equal(TITLE_LOADING.SCENE_TRANSITION_MOTION.CRUISE.EASING, 'linear');
assert.equal(TITLE_LOADING.SCENE_TRANSITION_MOTION.DECEL.DURATION, 1.5);
assert.equal(TITLE_LOADING.SCENE_TRANSITION_MOTION.DECEL.EASING, 'easeOutExpo');
assert.equal('ENEMY_SPAWN_READY_LEAD_SECONDS' in TITLE_LOADING, false);
assert.doesNotMatch(sequenceSource, /animateMixed|buildTitleSceneTransitionSegments/);
assert.match(sequenceSource, /isTitleSceneHandoffReady\(\)/);
assert.match(sequenceSource, /releaseTitleIntroAssets\(\)/);
assert.match(sequenceSource, /isEnemySpawnReady\(\) \{\s*return false;/);
assert.match(titleSceneIntroSource, /animateMixed\(this,/);
assert.match(titleSceneIntroSource, /animateMixed\(this\.centerCircle,/);
assert.match(titleSceneIntroSource, /buildTitleSceneTransitionSegments/);
assert.doesNotMatch(titleSceneIntroSource, /sceneTransitionTimelineProgress/);
assert.match(
    titleSceneIntroSource,
    /this\.sceneTransitionProgress >= this\.enemySpawnReadyProgress/
);
assert.match(
    titleSceneIntroSource,
    /this\.enemySpawnReadyProgress = transitionSegments\[0\]\?\.endValue \?\? 0;/
);
assert.doesNotMatch(titleSceneIntroSource, /getEnemySpawnReadyProgressThreshold|clamp01/);

const transitionSegments = buildTitleSceneTransitionSegments({
    startValue: 0,
    endValue: 1,
    motion: TITLE_LOADING.SCENE_TRANSITION_MOTION
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

for (const languageFile of ['korean.js', 'english.js']) {
    const languageSource = await readFile(
        new URL(`../script/data/localization/${languageFile}`, import.meta.url),
        'utf8'
    );
    assert.doesNotMatch(languageSource, /title_loading_notice|"title_loading"/);
}

console.log('title intro sequence contract: ok');
