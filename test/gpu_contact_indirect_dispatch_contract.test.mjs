import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const { GPU_COLLISION_INDIRECT_WGSL } = await loadGameModule(
    'ingame/physics/gpu/gpu_collision_shaders.js'
);
const simulationSource = await readFile(new URL(
    '../project/game/script/module/ingame/physics/gpu/gpu_circle_body_simulation.js',
    import.meta.url
), 'utf8');

test('contact hot path는 예약 capacity가 아니라 실제 GPU contact_count로 dispatch한다', () => {
    assert.match(
        GPU_COLLISION_INDIRECT_WGSL,
        /struct DispatchArgsBuffer \{\s*bodies: DispatchArgs,\s*contacts: DispatchArgs,\s*\}/
    );
    assert.match(
        GPU_COLLISION_INDIRECT_WGSL,
        /fn update_contact_indirect_args\(\)[\s\S]*?arrayLength\(&contacts\.values\)[\s\S]*?atomicLoad\(&contact_state\.contact_count\)[\s\S]*?dispatch_args\.contacts\.x = \(contact_count \+ 255u\) \/ 256u;/
    );
    assert.match(
        simulationSource,
        /const CONTACT_DISPATCH_INDIRECT_BYTE_OFFSET = 12;[\s\S]*?const DISPATCH_INDIRECT_BYTE_SIZE = 24;/
    );

    const contactStart = simulationSource.indexOf(
        "this.#dispatchBodies(pass, 'generate_world_contacts');"
    );
    const contactEnd = simulationSource.indexOf(
        'if (this.routeRuntimeTopology.enabled) {',
        contactStart
    );
    assert.ok(contactStart >= 0 && contactEnd > contactStart);
    const contactHotPath = simulationSource.slice(contactStart, contactEnd);
    assert.match(
        contactHotPath,
        /updateContactIndirectArgs[\s\S]*?#dispatchContacts\(pass\)/
    );
    assert.equal(
        (contactHotPath.match(/#dispatchContacts\(pass\)/g) ?? []).length,
        16
    );
    assert.doesNotMatch(
        contactHotPath,
        /dispatchWorkgroups\(Math\.ceil\([\s\S]{0,80}contactCapacity/
    );
});
