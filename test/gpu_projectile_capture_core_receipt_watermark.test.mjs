import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    GpuCircleBodySimulation
} = await loadGameModule(
    'ingame/physics/gpu/gpu_circle_body_simulation.js'
);

function createSimulationProtocolFixture() {
    const simulation = Object.create(GpuCircleBodySimulation.prototype);
    simulation.sessionGeneration = 1;
    simulation.deviceGeneration = 7;
    simulation.authoritativeEpoch = 11;
    simulation.projectileCaptureCompletedThroughTick = 42;
    simulation.authenticProjectileCaptureCoreImpactReceipts = new WeakSet();
    return simulation;
}

function createReceipt(sourceTick, overrides = {}) {
    return Object.freeze({
        sessionGeneration: 1,
        deviceGeneration: 7,
        authoritativeEpoch: 11,
        sourceTick,
        type: 'contact',
        eventType: 'interaction-enter',
        disposition: 'applied',
        entityId: 101,
        incarnation: 3,
        otherEntityId: 202,
        otherIncarnation: 4,
        ...overrides
    });
}

test('Capture Core receipt는 완료 watermark 이하의 exact 양의 source tick을 허용한다', () => {
    const simulation = createSimulationProtocolFixture();

    assert.equal(
        simulation.registerProjectileCaptureCoreImpactReceipt(
            createReceipt(40)
        ),
        true,
        'generic contact readback이 Capture watermark보다 늦어도 인증되어야 합니다.'
    );
    assert.equal(
        simulation.registerProjectileCaptureCoreImpactReceipt(
            createReceipt(42)
        ),
        true
    );
    assert.equal(
        simulation.registerProjectileCaptureCoreImpactReceipt(
            createReceipt(43)
        ),
        false,
        '아직 완료되지 않은 미래 Capture tick은 거부해야 합니다.'
    );
    assert.equal(
        simulation.registerProjectileCaptureCoreImpactReceipt(
            createReceipt(0)
        ),
        false
    );
    assert.equal(
        simulation.registerProjectileCaptureCoreImpactReceipt(
            createReceipt(41.5)
        ),
        false
    );
    assert.equal(
        simulation.registerProjectileCaptureCoreImpactReceipt(
            createReceipt(40, { authoritativeEpoch: 10 })
        ),
        false
    );
});
