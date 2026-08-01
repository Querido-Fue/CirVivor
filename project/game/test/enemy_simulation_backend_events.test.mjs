import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const { EnemySimulationBackend } = await loadGameModule(
    'ingame/object/enemy/enemy_simulation_backend.js'
);

function attachFakeSimulation(backend, runtimeState) {
    const calls = [];
    const batches = [{
        sourceTick: 5,
        deviceGeneration: 2,
        completedThroughTick: 5,
        events: []
    }];
    backend.simulation = {
        fixedUpdate(delta, sourceTick) {
            calls.push({ type: 'fixedUpdate', delta, sourceTick });
            return true;
        },
        drainCompletedEventBatches(out) {
            calls.push({ type: 'drainCompletedEventBatches' });
            out.push(...batches.splice(0));
            return out;
        },
        getRuntimeState() {
            return runtimeState;
        },
        getStatus() {
            return Object.freeze({
                state: runtimeState,
                events: Object.freeze({ completedThroughTick: 5 })
            });
        },
        getActiveBodyCount() {
            return 0;
        },
        destroy() {
            calls.push({ type: 'destroy' });
        }
    };
    return { calls };
}

for (const [simulationState, backendState] of [
    ['event-backpressure', 'gpu-backpressure'],
    ['event-overflow-degraded', 'gpu-overflow-degraded'],
    ['contact-overflow-degraded', 'gpu-overflow-degraded']
]) {
    test(`${simulationState}는 ${backendState} recovery 상태로 승격된다`, () => {
        const backend = new EnemySimulationBackend();
        const { calls } = attachFakeSimulation(backend, simulationState);

        assert.equal(backend.fixedUpdate(1 / 60, 12), true);
        assert.deepEqual(calls[0], {
            type: 'fixedUpdate',
            delta: 1 / 60,
            sourceTick: 12
        });
        assert.equal(backend.getRuntimeState(), backendState);
        assert.equal(backend.requiresRecovery(), true);
        assert.equal(backend.getStatus().events.completedThroughTick, 5);
        assert.equal(backend.getStatus().gpu.events.completedThroughTick, 5);

        const out = [];
        assert.strictEqual(backend.drainCompletedEventBatches(out), out);
        assert.equal(out.length, 1);
        assert.equal(out[0].sourceTick, 5);
        backend.destroy();
    });
}

test('event API가 없는 legacy simulation은 caller out을 변경하지 않는다', () => {
    const backend = new EnemySimulationBackend();
    backend.simulation = {
        getRuntimeState: () => 'ready',
        getStatus: () => Object.freeze({ state: 'ready' }),
        getActiveBodyCount: () => 0,
        destroy() {}
    };
    const marker = Object.freeze({ marker: true });
    const out = [marker];
    assert.strictEqual(backend.drainCompletedEventBatches(out), out);
    assert.deepEqual(out, [marker]);
    assert.equal(backend.getStatus().events, null);
    backend.destroy();
});
