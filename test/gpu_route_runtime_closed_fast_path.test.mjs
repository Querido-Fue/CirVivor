import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const simulationSource = await readFile(new URL(
    '../project/game/script/module/ingame/physics/gpu/gpu_circle_body_simulation.js',
    import.meta.url
), 'utf8');
const routeRuntimeShaderSource = await readFile(new URL(
    '../project/game/script/module/ingame/physics/gpu/gpu_route_runtime_shaders.js',
    import.meta.url
), 'utf8');

test('closed Cork steady state는 player projectile 유무와 무관하게 readback 없이 완료된다', () => {
    assert.match(
        simulationSource,
        /this\.routeRuntimeProjectileThreatBodyCount = 0;/u
    );
    assert.match(
        simulationSource,
        /const interaction = unpackGpuCircleInteractionMeta\(interactionMeta\);[\s\S]*?const physics = unpackGpuCirclePhysicsMeta\(physicalMeta\);[\s\S]*?physics\.bodyLayer[\s\S]*?=== GPU_CIRCLE_BODY_COLLISION_LAYER\.PROJECTILE[\s\S]*?interaction\.interactionMask[\s\S]*?& GPU_CIRCLE_BODY_COLLISION_LAYER\.ENEMY[\s\S]*?routeRuntimeProjectileThreatBodyCount\+\+;/u
    );
    const statusGate = simulationSource.match(
        /const readbackBypassEligible = this\.routeRuntimeTopology\.enabled[\s\S]*?terminal\?\.state !== 'armed';/u
    )?.[0] ?? '';
    assert.notEqual(statusGate, '');
    assert.match(statusGate, /&& closedSteadyState/u);
    assert.doesNotMatch(
        statusGate,
        /routeRuntimeProjectileThreatBodyCount/u
    );
    const submitGate = simulationSource.match(
        /const canPublishEmptyRouteRuntimeCompletion[\s\S]*?routeAvailabilitySnapshot\.closedPathIds\.length[\s\S]*?=== this\.routeRuntimeRosterCount;/u
    )?.[0] ?? '';
    assert.notEqual(submitGate, '');
    assert.match(
        submitGate,
        /!terminalFinalSubmit[\s\S]*?this\.routeRuntimeRosterCount > 0[\s\S]*?stagedRouteCleanup === null/u
    );
    assert.doesNotMatch(
        submitGate,
        /routeRuntimeProjectileThreatBodyCount/u
    );
    assert.match(
        simulationSource,
        /const needsRouteRuntimeReadback[\s\S]*?!canPublishEmptyRouteRuntimeCompletion/u
    );
    assert.match(
        simulationSource,
        /projectileThreatBodyCount:[\s\S]*?closedSteadyState,[\s\S]*?readbackBypassEligible,[\s\S]*?completedReadbackBypassSourceTick,/u
    );
    assert.match(
        simulationSource,
        /#publishEmptyRouteRuntimeCompletion\([\s\S]*?completedThroughTick: sourceTick[\s\S]*?readbackBypassed: true[\s\S]*?lastEventCount: 0[\s\S]*?completed: true[\s\S]*?this\.routeRuntimeCompletedThroughTick = sourceTick/u
    );
    assert.match(
        simulationSource,
        /#beginRouteRuntimeReadback\([\s\S]*?readbackBypassed: false,[\s\S]*?lastEventCount,/u
    );
    assert.doesNotMatch(routeRuntimeShaderSource, /var exact_alive/u);
    assert.match(
        routeRuntimeShaderSource,
        /let cleanup_count = cleanup_program\.record_count;[\s\S]*?if \(virtual_state\[closure_index\] != AVAILABILITY_OPEN\)[\s\S]*?ACTION_REOPENED[\s\S]*?ACTION_CLEANED[\s\S]*?virtual_owner_slot\[closure_index\] = INVALID;/u
    );
});
