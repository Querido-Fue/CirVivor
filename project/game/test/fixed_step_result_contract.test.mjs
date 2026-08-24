import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    FIXED_STEP_RESULT,
    normalizeFixedStepResult
} = await loadGameModule('simulation/fixed_step_result_contract.js');

test('fixed-step result는 pause/backpressure를 분리하고 legacy boolean을 보존한다', () => {
    assert.equal(normalizeFixedStepResult(true), FIXED_STEP_RESULT.COMPLETED);
    assert.equal(
        normalizeFixedStepResult(undefined),
        FIXED_STEP_RESULT.COMPLETED
    );
    assert.equal(
        normalizeFixedStepResult(false),
        FIXED_STEP_RESULT.DEFERRED_BACKPRESSURE
    );
    for (const result of Object.values(FIXED_STEP_RESULT)) {
        assert.equal(normalizeFixedStepResult(result), result);
    }
    assert.throws(() => normalizeFixedStepResult('PAUSED'), /알려지지 않은/u);
});
