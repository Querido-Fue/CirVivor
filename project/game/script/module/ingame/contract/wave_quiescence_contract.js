import { fingerprintR8Record } from './r8_fingerprint_contract.js';

export const WAVE_QUIESCENCE_PROTOCOL_VERSION = 'r9-wave-quiescence-v1';
export const WAVE_CLEAR_PROOF_VERSION = 'r9-wave-clear-proof-v1';

export const WAVE_CLEAR_PROOF_RESULT_CODE = Object.freeze({
    PROVEN: 'PROVEN',
    NOT_QUIESCENT: 'NOT_QUIESCENT',
    SOURCE_CHANGED: 'SOURCE_CHANGED'
});

export const WAVE_CLEAR_BLOCKER = Object.freeze({
    WAVE_NOT_INITIALIZED: 'WAVE_NOT_INITIALIZED',
    WAVE_COMPLETION_OWNED: 'WAVE_COMPLETION_OWNED',
    WAVE_SPAWN_PENDING: 'WAVE_SPAWN_PENDING',
    HOSTILE_COUNT_INEXACT: 'HOSTILE_COUNT_INEXACT',
    LIVE_HOSTILE_REMAINS: 'LIVE_HOSTILE_REMAINS',
    PENDING_HOSTILE_REMAINS: 'PENDING_HOSTILE_REMAINS',
    HOSTILE_PRODUCER_PENDING: 'HOSTILE_PRODUCER_PENDING',
    EVENT_WATERMARK_INCOMPLETE: 'EVENT_WATERMARK_INCOMPLETE',
    REGISTRY_REVISION_DRIFT: 'REGISTRY_REVISION_DRIFT',
    RUN_NOT_ACTIVE: 'RUN_NOT_ACTIVE',
    RECOVERY_REQUIRED: 'RECOVERY_REQUIRED'
});

const SNAPSHOT_KEYS = Object.freeze([
    'snapshotRevision',
    'fixedTick',
    'protocol',
    'wave',
    'hostile',
    'pending',
    'events',
    'registryRevision',
    'run'
]);
const PROTOCOL_KEYS = Object.freeze([
    'sessionGeneration',
    'deviceGeneration',
    'authoritativeEpoch'
]);
const WAVE_KEYS = Object.freeze([
    'mapId',
    'waveId',
    'waveOrdinal',
    'initialized',
    'totalSpawnCount',
    'queuedSpawnCount',
    'remainingSpawnCount',
    'blockedSpawnCount',
    'allSpawnsQueued',
    'completionOwned'
]);
const HOSTILE_KEYS = Object.freeze([
    'revision',
    'registryRevision',
    'countExact',
    'liveHostileActorCount',
    'pendingHostileActorCount',
    'hostileActorCount'
]);
const PENDING_KEYS = Object.freeze([
    'hostileLifecycleSpawnCount',
    'hostileMaterializationCount',
    'hostileTransitCount',
    'hostileAtomicTransformCount',
    'lifecycleCommandCount',
    'materializationWorkCount',
    'transitActorCount',
    'atomicTransformWorkCount'
]);
const EVENT_KEYS = Object.freeze([
    'lastSubmittedTick',
    'lastCompletedTick',
    'completedThroughTick',
    'deferredBatchCount',
    'protocolFailure'
]);
const RUN_KEYS = Object.freeze([
    'running',
    'defeated',
    'coreDepleted',
    'recoveryRequired'
]);
const SNAPSHOT_METADATA = new WeakMap();
const PROOF_METADATA = new WeakMap();

function requireRecord(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label}은 record여야 합니다.`);
    }
    return value;
}

function materializeKnownRecord(value, expectedKeys, label) {
    const source = requireRecord(value, label);
    const ownKeys = Reflect.ownKeys(source);
    if (ownKeys.some((key) => typeof key !== 'string')
        || ownKeys.length !== expectedKeys.length
        || expectedKeys.some((key) => !ownKeys.includes(key))) {
        throw new RangeError(
            `${label}은 known keys만 가져야 합니다: ${expectedKeys.join(', ')}`
        );
    }
    const materialized = {};
    for (const key of expectedKeys) materialized[key] = source[key];
    return materialized;
}

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

function requireBoolean(value, label) {
    if (typeof value !== 'boolean') {
        throw new TypeError(`${label}은 boolean이어야 합니다.`);
    }
    return value;
}

function requireUint32(value, label, { positive = false } = {}) {
    if (!Number.isSafeInteger(value)
        || value < (positive ? 1 : 0)
        || value > 0xffff_ffff) {
        throw new RangeError(`${label}은 ${positive ? '양의 ' : ''}uint32여야 합니다.`);
    }
    return value;
}

export function createWaveQuiescenceSnapshot(source) {
    const input = materializeKnownRecord(
        source,
        SNAPSHOT_KEYS,
        'WaveQuiescenceSnapshot'
    );
    const protocol = materializeKnownRecord(
        input.protocol,
        PROTOCOL_KEYS,
        'WaveQuiescenceSnapshot.protocol'
    );
    const wave = materializeKnownRecord(
        input.wave,
        WAVE_KEYS,
        'WaveQuiescenceSnapshot.wave'
    );
    const hostile = materializeKnownRecord(
        input.hostile,
        HOSTILE_KEYS,
        'WaveQuiescenceSnapshot.hostile'
    );
    const pending = materializeKnownRecord(
        input.pending,
        PENDING_KEYS,
        'WaveQuiescenceSnapshot.pending'
    );
    const events = materializeKnownRecord(
        input.events,
        EVENT_KEYS,
        'WaveQuiescenceSnapshot.events'
    );
    const run = materializeKnownRecord(
        input.run,
        RUN_KEYS,
        'WaveQuiescenceSnapshot.run'
    );

    const normalizedProtocol = Object.freeze({
        sessionGeneration: requireUint32(
            protocol.sessionGeneration,
            'protocol.sessionGeneration',
            { positive: true }
        ),
        deviceGeneration: requireUint32(
            protocol.deviceGeneration,
            'protocol.deviceGeneration'
        ),
        authoritativeEpoch: requireUint32(
            protocol.authoritativeEpoch,
            'protocol.authoritativeEpoch'
        )
    });
    const normalizedWave = Object.freeze({
        mapId: requireNonEmptyString(wave.mapId, 'wave.mapId'),
        waveId: requireNonEmptyString(wave.waveId, 'wave.waveId'),
        waveOrdinal: requireUint32(
            wave.waveOrdinal,
            'wave.waveOrdinal',
            { positive: true }
        ),
        initialized: requireBoolean(wave.initialized, 'wave.initialized'),
        totalSpawnCount: requireUint32(
            wave.totalSpawnCount,
            'wave.totalSpawnCount'
        ),
        queuedSpawnCount: requireUint32(
            wave.queuedSpawnCount,
            'wave.queuedSpawnCount'
        ),
        remainingSpawnCount: requireUint32(
            wave.remainingSpawnCount,
            'wave.remainingSpawnCount'
        ),
        blockedSpawnCount: requireUint32(
            wave.blockedSpawnCount,
            'wave.blockedSpawnCount'
        ),
        allSpawnsQueued: requireBoolean(
            wave.allSpawnsQueued,
            'wave.allSpawnsQueued'
        ),
        completionOwned: requireBoolean(
            wave.completionOwned,
            'wave.completionOwned'
        )
    });
    if (normalizedWave.queuedSpawnCount + normalizedWave.remainingSpawnCount
        !== normalizedWave.totalSpawnCount) {
        throw new RangeError('wave queued + remaining count가 total과 다릅니다.');
    }
    const normalizedHostile = Object.freeze({
        revision: requireUint32(hostile.revision, 'hostile.revision'),
        registryRevision: requireUint32(
            hostile.registryRevision,
            'hostile.registryRevision'
        ),
        countExact: requireBoolean(hostile.countExact, 'hostile.countExact'),
        liveHostileActorCount: requireUint32(
            hostile.liveHostileActorCount,
            'hostile.liveHostileActorCount'
        ),
        pendingHostileActorCount: requireUint32(
            hostile.pendingHostileActorCount,
            'hostile.pendingHostileActorCount'
        ),
        hostileActorCount: requireUint32(
            hostile.hostileActorCount,
            'hostile.hostileActorCount'
        )
    });
    if (normalizedHostile.liveHostileActorCount
            + normalizedHostile.pendingHostileActorCount
        !== normalizedHostile.hostileActorCount) {
        throw new RangeError('hostile live + pending count가 total과 다릅니다.');
    }
    const normalizedPendingBase = Object.freeze(Object.fromEntries(
        PENDING_KEYS.map((key) => [
            key,
            requireUint32(pending[key], `pending.${key}`)
        ])
    ));
    const hostileProducerCount = normalizedPendingBase
        .hostileLifecycleSpawnCount
        + normalizedPendingBase.hostileMaterializationCount
        + normalizedPendingBase.hostileTransitCount
        + normalizedPendingBase.hostileAtomicTransformCount;
    if (!Number.isSafeInteger(hostileProducerCount)
        || hostileProducerCount > 0xffff_ffff) {
        throw new RangeError('pending hostile producer 합계가 uint32를 벗어났습니다.');
    }
    const normalizedPending = Object.freeze({
        ...normalizedPendingBase,
        hostileProducerCount
    });
    const normalizedEvents = Object.freeze({
        lastSubmittedTick: requireUint32(
            events.lastSubmittedTick,
            'events.lastSubmittedTick'
        ),
        lastCompletedTick: requireUint32(
            events.lastCompletedTick,
            'events.lastCompletedTick'
        ),
        completedThroughTick: requireUint32(
            events.completedThroughTick,
            'events.completedThroughTick'
        ),
        deferredBatchCount: requireUint32(
            events.deferredBatchCount,
            'events.deferredBatchCount'
        ),
        protocolFailure: requireBoolean(
            events.protocolFailure,
            'events.protocolFailure'
        ),
        contiguous: events.protocolFailure === false
            && events.deferredBatchCount === 0
            && events.lastCompletedTick >= events.lastSubmittedTick
    });
    const normalizedRun = Object.freeze({
        running: requireBoolean(run.running, 'run.running'),
        defeated: requireBoolean(run.defeated, 'run.defeated'),
        coreDepleted: requireBoolean(run.coreDepleted, 'run.coreDepleted'),
        recoveryRequired: requireBoolean(
            run.recoveryRequired,
            'run.recoveryRequired'
        )
    });
    const snapshotRevision = requireUint32(
        input.snapshotRevision,
        'snapshotRevision',
        { positive: true }
    );
    const fixedTick = requireUint32(input.fixedTick, 'fixedTick');
    const registryRevision = requireUint32(
        input.registryRevision,
        'registryRevision'
    );
    const fingerprintRecord = {
        protocolVersion: WAVE_QUIESCENCE_PROTOCOL_VERSION,
        snapshotRevision,
        fixedTick,
        protocol: normalizedProtocol,
        wave: normalizedWave,
        hostile: normalizedHostile,
        pending: normalizedPending,
        events: normalizedEvents,
        registryRevision,
        run: normalizedRun
    };
    const snapshotFingerprint = fingerprintR8Record(
        'r9-wave-quiescence-snapshot',
        fingerprintRecord,
        normalizedWave.waveId
    );
    const snapshot = Object.freeze({
        ...fingerprintRecord,
        snapshotFingerprint
    });
    SNAPSHOT_METADATA.set(snapshot, Object.freeze({ snapshotFingerprint }));
    return snapshot;
}

export function getWaveQuiescenceSnapshotFingerprint(snapshot) {
    const metadata = SNAPSHOT_METADATA.get(snapshot);
    if (!metadata) {
        throw new TypeError('normalized WaveQuiescenceSnapshot이 필요합니다.');
    }
    return metadata.snapshotFingerprint;
}

function collectBlockers(snapshot) {
    const blockers = [];
    if (!snapshot.wave.initialized) {
        blockers.push(WAVE_CLEAR_BLOCKER.WAVE_NOT_INITIALIZED);
    }
    if (snapshot.wave.completionOwned) {
        blockers.push(WAVE_CLEAR_BLOCKER.WAVE_COMPLETION_OWNED);
    }
    if (!snapshot.wave.allSpawnsQueued
        || snapshot.wave.remainingSpawnCount !== 0
        || snapshot.wave.blockedSpawnCount !== 0) {
        blockers.push(WAVE_CLEAR_BLOCKER.WAVE_SPAWN_PENDING);
    }
    if (!snapshot.hostile.countExact) {
        blockers.push(WAVE_CLEAR_BLOCKER.HOSTILE_COUNT_INEXACT);
    }
    if (snapshot.hostile.liveHostileActorCount !== 0) {
        blockers.push(WAVE_CLEAR_BLOCKER.LIVE_HOSTILE_REMAINS);
    }
    if (snapshot.hostile.pendingHostileActorCount !== 0) {
        blockers.push(WAVE_CLEAR_BLOCKER.PENDING_HOSTILE_REMAINS);
    }
    if (snapshot.pending.hostileProducerCount !== 0) {
        blockers.push(WAVE_CLEAR_BLOCKER.HOSTILE_PRODUCER_PENDING);
    }
    if (!snapshot.events.contiguous) {
        blockers.push(WAVE_CLEAR_BLOCKER.EVENT_WATERMARK_INCOMPLETE);
    }
    if (snapshot.hostile.registryRevision !== snapshot.registryRevision) {
        blockers.push(WAVE_CLEAR_BLOCKER.REGISTRY_REVISION_DRIFT);
    }
    if (!snapshot.run.running
        || snapshot.run.defeated
        || snapshot.run.coreDepleted) {
        blockers.push(WAVE_CLEAR_BLOCKER.RUN_NOT_ACTIVE);
    }
    if (snapshot.run.recoveryRequired) {
        blockers.push(WAVE_CLEAR_BLOCKER.RECOVERY_REQUIRED);
    }
    return Object.freeze(blockers);
}

export function createWaveClearProof(snapshot) {
    const snapshotFingerprint = getWaveQuiescenceSnapshotFingerprint(snapshot);
    const blockers = collectBlockers(snapshot);
    if (blockers.length > 0) {
        return Object.freeze({
            accepted: false,
            code: WAVE_CLEAR_PROOF_RESULT_CODE.NOT_QUIESCENT,
            snapshotFingerprint,
            blockers,
            proof: null
        });
    }
    const proofRecord = {
        proofVersion: WAVE_CLEAR_PROOF_VERSION,
        proofId: [
            'wave-clear',
            snapshot.protocol.sessionGeneration,
            snapshot.wave.mapId,
            snapshot.wave.waveOrdinal,
            snapshot.wave.waveId,
            snapshot.snapshotRevision
        ].join(':'),
        snapshotFingerprint,
        completionRevision: snapshot.snapshotRevision,
        fixedTick: snapshot.fixedTick,
        sessionGeneration: snapshot.protocol.sessionGeneration,
        deviceGeneration: snapshot.protocol.deviceGeneration,
        authoritativeEpoch: snapshot.protocol.authoritativeEpoch,
        mapId: snapshot.wave.mapId,
        waveId: snapshot.wave.waveId,
        waveOrdinal: snapshot.wave.waveOrdinal,
        trackerRevision: snapshot.hostile.revision,
        registryRevision: snapshot.registryRevision,
        eventCompletedThroughTick: snapshot.events.completedThroughTick
    };
    const proofFingerprint = fingerprintR8Record(
        'r9-wave-clear-proof',
        proofRecord,
        proofRecord.proofId
    );
    const proof = Object.freeze({ ...proofRecord, proofFingerprint });
    PROOF_METADATA.set(proof, Object.freeze({ snapshotFingerprint }));
    return Object.freeze({
        accepted: true,
        code: WAVE_CLEAR_PROOF_RESULT_CODE.PROVEN,
        snapshotFingerprint,
        blockers,
        proof
    });
}

export function validateWaveClearProof(proof, snapshot) {
    const proofMetadata = PROOF_METADATA.get(proof);
    const snapshotFingerprint = getWaveQuiescenceSnapshotFingerprint(snapshot);
    const accepted = proofMetadata !== undefined
        && proofMetadata.snapshotFingerprint === snapshotFingerprint
        && proof.snapshotFingerprint === snapshotFingerprint
        && proof.mapId === snapshot.wave.mapId
        && proof.waveId === snapshot.wave.waveId
        && proof.waveOrdinal === snapshot.wave.waveOrdinal
        && proof.registryRevision === snapshot.registryRevision
        && proof.trackerRevision === snapshot.hostile.revision;
    return Object.freeze({
        accepted,
        code: accepted
            ? WAVE_CLEAR_PROOF_RESULT_CODE.PROVEN
            : WAVE_CLEAR_PROOF_RESULT_CODE.SOURCE_CHANGED
    });
}
