import assert from 'node:assert/strict';
import { loadGameModule } from './support/source_module_loader.mjs';

const policyModule = await loadGameModule('simulation/fixed_step_catch_up_policy.js');
const { FixedStepCatchUpPolicy, countWholeFixedSteps } = policyModule;

const policy = new FixedStepCatchUpPolicy();
const fixedStep = 1 / 60;

assert.equal(policy.resolveMaxSteps(0, fixedStep, fixedStep), 2);
assert.equal(policy.resolveMaxSteps(0.016, fixedStep, fixedStep), 1);
assert.equal(policy.isCpuBound(), true);
assert.equal(policy.resolveMaxSteps(0.012, fixedStep, fixedStep), 1);
assert.equal(policy.resolveMaxSteps(0.010, fixedStep, fixedStep), 1);
assert.equal(policy.resolveMaxSteps(0.010, fixedStep, fixedStep), 1);
assert.equal(policy.resolveMaxSteps(0.010, fixedStep, fixedStep), 2);
assert.equal(policy.isCpuBound(), false);

assert.equal(policy.resolveMaxSteps(0.028, 1 / 30, fixedStep), 2);
assert.equal(policy.resolveMaxSteps(0.031, 1 / 30, fixedStep), 1);

policy.reset();
assert.equal(policy.resolveMaxSteps(0, fixedStep, fixedStep), 2);

const normalizedPolicy = new FixedStepCatchUpPolicy({
    normalMaxSteps: 0,
    cpuBoundMaxSteps: 99,
    enterRatio: Number.NaN,
    exitRatio: -1,
    recoveryFrames: 0
});
assert.equal(normalizedPolicy.normalMaxSteps, 2);
assert.equal(normalizedPolicy.cpuBoundMaxSteps, 2);
assert.equal(normalizedPolicy.resolveMaxSteps(0.02, fixedStep, fixedStep), 2);

assert.equal(countWholeFixedSteps(0, fixedStep), 0);
assert.equal(countWholeFixedSteps(fixedStep * 0.99, fixedStep), 0);
assert.equal(countWholeFixedSteps(fixedStep, fixedStep), 1);
assert.equal(countWholeFixedSteps(fixedStep * 5.5, fixedStep), 5);
assert.equal(countWholeFixedSteps(Number.NaN, fixedStep), 0);

console.log('fixed step catch-up policy contract: ok');
