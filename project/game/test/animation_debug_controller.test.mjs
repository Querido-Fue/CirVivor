import assert from 'node:assert/strict';
import { loadGameModule } from './support/source_module_loader.mjs';

const { AnimationDebugController } = await loadGameModule('debug/_animation_debug_controller.js');

function createPressConsumer(...actions) {
    const pending = new Set(actions);
    return (action) => pending.delete(action);
}

const controller = new AnimationDebugController();

assert.equal(controller.prepareFrame(createPressConsumer('debugPause')).mode, 'running');
assert.equal(controller.isPaused(), false);

controller.setEnabled(true);
assert.equal(controller.prepareFrame(createPressConsumer()).mode, 'running');
assert.equal(controller.prepareFrame(createPressConsumer('debugPause')).mode, 'paused');
assert.equal(controller.isPaused(), true);

assert.equal(controller.prepareFrame(createPressConsumer('debugStep')).mode, 'step');
assert.equal(controller.isPaused(), true);
assert.equal(controller.prepareFrame(createPressConsumer()).mode, 'paused');

assert.equal(controller.prepareFrame(createPressConsumer('debugPause', 'debugStep')).mode, 'running');
assert.equal(controller.isPaused(), false);

controller.prepareFrame(createPressConsumer('debugPause'));
assert.equal(controller.isPaused(), true);
controller.setEnabled(false);
assert.equal(controller.isPaused(), false);
assert.equal(controller.prepareFrame(createPressConsumer()).mode, 'running');

console.log('animation debug controller tests passed');
