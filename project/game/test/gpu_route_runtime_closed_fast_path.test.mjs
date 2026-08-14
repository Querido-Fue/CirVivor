import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL(
    '../script/module/ingame/physics/gpu/gpu_circle_body_simulation.js',
    import.meta.url
), 'utf8');

test('closed Cork steady state는 Cork를 때릴 player projectile이 없을 때 readback 없이 완료된다', () => {
    assert.match(
        source,
        /this\.routeRuntimeProjectileThreatBodyCount = 0;/u
    );
    assert.match(
        source,
        /const interaction = unpackGpuCircleInteractionMeta\(interactionMeta\);[\s\S]*?const physics = unpackGpuCirclePhysicsMeta\(physicalMeta\);[\s\S]*?physics\.bodyLayer[\s\S]*?=== GPU_CIRCLE_BODY_COLLISION_LAYER\.PROJECTILE[\s\S]*?interaction\.interactionMask[\s\S]*?& GPU_CIRCLE_BODY_COLLISION_LAYER\.ENEMY[\s\S]*?routeRuntimeProjectileThreatBodyCount\+\+;/u
    );
    assert.match(
        source,
        /const canPublishEmptyRouteRuntimeCompletion[\s\S]*?!terminalFinalSubmit[\s\S]*?this\.routeRuntimeRosterCount > 0[\s\S]*?this\.routeRuntimeProjectileThreatBodyCount === 0[\s\S]*?stagedRouteCleanup === null[\s\S]*?closedPathIds\.length[\s\S]*?=== this\.routeRuntimeRosterCount/u
    );
    assert.match(
        source,
        /const needsRouteRuntimeReadback[\s\S]*?!canPublishEmptyRouteRuntimeCompletion/u
    );
    assert.match(
        source,
        /projectileThreatBodyCount:[\s\S]*?closedSteadyState,[\s\S]*?readbackBypassEligible,[\s\S]*?completedReadbackBypassSourceTick,/u
    );
    assert.match(
        source,
        /#publishEmptyRouteRuntimeCompletion\([\s\S]*?completedThroughTick: sourceTick[\s\S]*?readbackBypassed: true[\s\S]*?lastEventCount: 0[\s\S]*?completed: true[\s\S]*?this\.routeRuntimeCompletedThroughTick = sourceTick/u
    );
    assert.match(
        source,
        /#beginRouteRuntimeReadback\([\s\S]*?readbackBypassed: false,[\s\S]*?lastEventCount,/u
    );
});
