import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGameModule } from './support/source_module_loader.mjs';

const { NextWaveProgression } = await loadGameModule(
    'ingame/flow/next_wave_progression.js'
);

function createHarness() {
    const state = {
        ready: true,
        safe: true,
        tileMap: { mapId: 'progression-map' },
        waveOrdinal: 1,
        fixedTickOffset: 20,
        waveStatus: { waveId: 'wave-1' },
        ingressSealed: true,
        candidateFailure: false,
        created: 0,
        cancelled: 0,
        installed: 0,
        opened: 0
    };
    const identity = Object.freeze({
        sessionGeneration: 7, deviceGeneration: 8, authoritativeEpoch: 9
    });
    const progression = new NextWaveProgression({
        getPreparationContext: () => state,
        captureSafeBoundary: () => ({
            accepted: state.safe,
            routeAvailability: { allOpen: true },
            hostile: { countExact: true, hostileActorCount: 0 }
        }),
        createWaveDirector({ waveDefinition, fixedTickOffset }) {
            state.created++;
            let initialized = false;
            return {
                init(tileMap) {
                    assert.strictEqual(tileMap, state.tileMap);
                    initialized = !state.candidateFailure;
                    return initialized;
                },
                getStatus: () => ({
                    initialized, waveId: waveDefinition.waveId, fixedTickOffset,
                    queuedSpawnCount: 0, routeAvailabilityVersion: null
                }),
                destroy() { state.cancelled++; }
            };
        },
        installPreparedWave(candidate, { waveOrdinal }) {
            assert.equal(candidate.getStatus().initialized, true);
            const oldWaveId = state.waveStatus.waveId;
            state.installed++;
            state.waveStatus = candidate.getStatus();
            state.waveOrdinal = waveOrdinal;
            state.ingressSealed = true;
            return oldWaveId;
        },
        getWaveStatus: () => state.waveStatus,
        captureEndpointIdentity: () => identity,
        openGameplayIngress() {
            state.opened++;
            state.ingressSealed = false;
        }
    });
    const request = (id = `wave-${state.waveOrdinal + 1}`) => ({
        transactionId: id,
        planFingerprint: 123,
        waveOrdinal: state.waveOrdinal + 1,
        fixedTickOffset: state.fixedTickOffset,
        waveDefinition: {
            mapId: state.tileMap.mapId,
            waveId: `wave-${state.waveOrdinal + 1}`
        }
    });
    return { progression, state, identity, request };
}

test('next Wave retry preserves the old world and opens ingress only after exact activation', () => {
    const { progression, state, identity, request } = createHarness();
    const next = request();
    state.safe = false;
    assert.equal(progression.prepare(next).code, 'DEFERRED_UNSAFE_BOUNDARY');
    assert.equal(state.created, 0);
    state.safe = true;
    state.candidateFailure = true;
    const rejected = progression.prepare(next);
    assert.equal(rejected.code, 'DIRECTOR_INIT_FAILED');
    assert.equal(rejected.oldWavePreserved, true);
    assert.equal(state.cancelled, 1);
    assert.equal(state.installed, 0);
    assert.equal(state.waveStatus.waveId, 'wave-1');
    assert.equal(progression.prepare({ ...next, planFingerprint: 124 }).code,
        'TRANSACTION_CONFLICT');

    state.candidateFailure = false;
    const prepared = progression.prepare(next);
    assert.equal(prepared.code, 'PREPARED');
    assert.strictEqual(prepared.endpointIdentity, identity);
    assert.equal(prepared.earliestSpawnFixedTick, 21);
    assert.equal(state.installed, 1);
    assert.equal(state.opened, 0);
    assert.equal(state.ingressSealed, true);
    assert.strictEqual(progression.prepare(next), prepared);
    assert.equal(progression.prepare(request()).code, 'WRONG_PHASE');
    assert.equal(state.created, 2);
    assert.equal(progression.activate({ ...next, planFingerprint: 124 }).code,
        'TRANSACTION_CONFLICT');
    state.safe = false;
    assert.equal(progression.activate(next).code, 'DEFERRED_UNSAFE_BOUNDARY');
    assert.equal(state.opened, 0);
    state.safe = true;
    const activated = progression.activate(next);
    assert.equal(activated.code, 'ACTIVATED');
    assert.strictEqual(activated.endpointIdentity, identity);
    assert.strictEqual(progression.activate(next), activated);
    assert.equal(state.installed, 1);
    assert.equal(state.opened, 1);
});

test('next Wave history stays bounded across repeated waves and destruction retires every request', () => {
    const { progression, state, request } = createHarness();
    let first;
    let last;
    let lastActivation;
    for (let index = 0; index < 70; index++) {
        const next = request();
        first ??= next;
        assert.equal(progression.prepare(next).code, 'PREPARED');
        lastActivation = progression.activate(next);
        assert.equal(lastActivation.code, 'ACTIVATED');
        last = next;
        state.fixedTickOffset++;
        state.ingressSealed = true;
        assert.equal(progression.getStatus(true).rememberedTransactionCount,
            Math.min(index + 1, 32));
    }
    assert.equal(state.installed, 70);
    assert.equal(state.opened, 70);
    assert.strictEqual(progression.activate(last), lastActivation);
    assert.equal(progression.prepare(first).code, 'SOURCE_CHANGED');
    assert.equal(state.installed, 70);
    progression.destroy();
    progression.destroy();
    const status = progression.getStatus(true);
    assert.equal(status.rememberedTransactionCount, 0);
    assert.equal(status.prepared, false);
    assert.equal(progression.prepare(last).code, 'DESTROYED');
    assert.equal(progression.activate(last).code, 'DESTROYED');
    assert.equal(state.installed, 70);
    assert.equal(state.opened, 70);
});
