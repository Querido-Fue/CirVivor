import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';
import {
    GPU_TOWER_MERGE_ABI,
    GPU_TOWER_MERGE_ABI_VERSION,
    GPU_TOWER_MERGE_ERROR_FLAG,
    GPU_TOWER_MERGE_MAX_SOURCE_COUNT,
    GPU_TOWER_MERGE_RECORD_ROLE,
    GPU_TOWER_MERGE_STATUS,
    GPU_TOWER_MERGE_STORAGE_PROFILE,
    computeGpuTowerMergeResultFingerprint,
    createGpuTowerMergeHostStorage,
    readGpuTowerMergeResult,
    writeGpuTowerMergeProgram
} from '../script/module/ingame/physics/gpu/gpu_tower_merge_abi.js';
import {
    GPU_TOWER_MERGE_WGSL
} from '../script/module/ingame/physics/gpu/gpu_tower_merge_shaders.js';
import {
    GpuTowerMergeRuntime
} from '../script/module/ingame/physics/gpu/gpu_tower_merge_runtime.js';
import {
    GpuTowerTransactionRuntimeMux
} from '../script/module/ingame/physics/gpu/gpu_tower_transaction_runtime_mux.js';
import {
    GPU_TOWER_GROUP_MEMBER_FLAG,
    computeGpuTowerGroupRosterFingerprint
} from '../script/module/ingame/physics/gpu/gpu_tower_group_abi.js';
import { WorldRegistry } from '../script/module/ingame/object/world_registry.js';

const {
    R6_TOWERS_MERGE_SENTENCE
} = await loadGameModule('data/word/r3_word_catalog_data.js');
const { SentenceCompiler } = await loadGameModule(
    'ingame/word/sentence_compiler.js'
);
const {
    TOWER_GROUP_RECORD_STATE,
    TOWER_MERGE_RESULT,
    TowerGroupState
} = await loadGameModule('ingame/object/tower/tower_group_state.js');
const {
    TOWER_MERGE_LIFECYCLE_DISPOSITION
} = await loadGameModule('ingame/object/tower/tower_group_contract.js');
const { TowerMergeCoordinator } = await loadGameModule(
    'ingame/object/tower/tower_merge_coordinator.js'
);

const OPERATION = new SentenceCompiler().compile(
    R6_TOWERS_MERGE_SENTENCE
);
const PROTOCOL = Object.freeze({
    sessionGeneration: 9,
    deviceGeneration: 4,
    authoritativeEpoch: 12
});
const MEMBER_FLAGS = GPU_TOWER_GROUP_MEMBER_FLAG.TOWER_NOUN
    | GPU_TOWER_GROUP_MEMBER_FLAG.LIVING;

function makeRecords(count, sourceGroupRevision = 3) {
    return Array.from({ length: count }, (_, rank) => Object.freeze({
        slot: rank,
        entityId: 1000 + rank,
        incarnation: 2,
        logicalTowerOrdinal: rank + 1,
        expectedCurrentHpFixedPoint: 1000 - rank,
        sourceShareUnits: rank === count - 1
            ? 1_000_000_000 - Math.floor(1_000_000_000 / count) * (count - 1)
            : Math.floor(1_000_000_000 / count),
        sourceMaxHpFixedPoint: 1000,
        sourcePowerFixedPoint: 100,
        sourceGroupRevision,
        sourceFlags: MEMBER_FLAGS,
        sourceRosterRank: rank,
        role: rank === 0
            ? GPU_TOWER_MERGE_RECORD_ROLE.SURVIVOR
            : GPU_TOWER_MERGE_RECORD_ROLE.CONSUMED,
        targetCurrentHpFixedPoint: rank === 0
            ? count * 1000 - ((count - 1) * count) / 2
            : 0,
        targetShareUnits: rank === 0 ? 1_000_000_000 : 0,
        targetMaxHpFixedPoint: rank === 0 ? count * 1000 : 0,
        targetPowerFixedPoint: rank === 0 ? count * 100 : 0
    }));
}

function rosterFingerprint(records, revision, target = false) {
    const selected = target ? [records[0]] : records;
    return computeGpuTowerGroupRosterFingerprint({
        protocol: PROTOCOL,
        groupRevision: revision,
        members: selected.map((record, rank) => ({
            slot: record.slot,
            entityId: record.entityId,
            incarnation: record.incarnation,
            logicalTowerOrdinal: record.logicalTowerOrdinal,
            shareUnits: target
                ? record.targetShareUnits
                : record.sourceShareUnits,
            maxHpFixedPoint: target
                ? record.targetMaxHpFixedPoint
                : record.sourceMaxHpFixedPoint,
            powerFixedPoint: target
                ? record.targetPowerFixedPoint
                : record.sourcePowerFixedPoint,
            groupRevision: revision,
            flags: MEMBER_FLAGS,
            rosterRank: rank
        }))
    });
}

function writeResultBytes(source) {
    const bytes = new ArrayBuffer(GPU_TOWER_MERGE_ABI.RESULT.STRIDE);
    const view = new DataView(bytes);
    const layout = GPU_TOWER_MERGE_ABI.RESULT;
    const base = {
        abiVersion: GPU_TOWER_MERGE_ABI_VERSION,
        bodyAbiVersion: 9,
        groupAbiVersion: 2,
        status: GPU_TOWER_MERGE_STATUS.COMMITTED,
        errorFlags: 0,
        sessionGeneration: PROTOCOL.sessionGeneration,
        deviceGeneration: PROTOCOL.deviceGeneration,
        authoritativeEpoch: PROTOCOL.authoritativeEpoch,
        sourceTick: 77,
        sourceCount: 2,
        survivorRank: 0,
        validatedCount: 2,
        appliedCount: 2,
        sourceGroupRevision: 3,
        targetGroupRevision: 4,
        sourceRosterFingerprint: 11,
        targetRosterFingerprint: 12,
        planFingerprintLane0: 0x01234567,
        planFingerprintLane1: 0x89abcdef,
        transactionFingerprint: 13,
        sourceIdentityFingerprint: 14,
        survivorEntityId: 1000,
        survivorIncarnation: 2,
        survivorSlot: 0,
        committedCount: 1,
        consumedCount: 1,
        reserved: 0,
        ...source
    };
    for (const [field, value] of [
        ['ABI_VERSION', base.abiVersion],
        ['BODY_ABI_VERSION', base.bodyAbiVersion],
        ['GROUP_ABI_VERSION', base.groupAbiVersion],
        ['STATUS', base.status],
        ['ERROR_FLAGS', base.errorFlags],
        ['SESSION_GENERATION', base.sessionGeneration],
        ['DEVICE_GENERATION', base.deviceGeneration],
        ['AUTHORITATIVE_EPOCH', base.authoritativeEpoch],
        ['SOURCE_TICK', base.sourceTick],
        ['SOURCE_COUNT', base.sourceCount],
        ['SURVIVOR_RANK', base.survivorRank],
        ['VALIDATED_COUNT', base.validatedCount],
        ['APPLIED_COUNT', base.appliedCount],
        ['SOURCE_GROUP_REVISION', base.sourceGroupRevision],
        ['TARGET_GROUP_REVISION', base.targetGroupRevision],
        ['SOURCE_ROSTER_FINGERPRINT', base.sourceRosterFingerprint],
        ['TARGET_ROSTER_FINGERPRINT', base.targetRosterFingerprint],
        ['PLAN_FINGERPRINT_0', base.planFingerprintLane0],
        ['PLAN_FINGERPRINT_1', base.planFingerprintLane1],
        ['TRANSACTION_FINGERPRINT', base.transactionFingerprint],
        ['SOURCE_IDENTITY_FINGERPRINT', base.sourceIdentityFingerprint],
        ['SURVIVOR_ENTITY_ID', base.survivorEntityId],
        ['SURVIVOR_INCARNATION', base.survivorIncarnation],
        ['SURVIVOR_SLOT', base.survivorSlot],
        ['COMMITTED_COUNT', base.committedCount],
        ['CONSUMED_COUNT', base.consumedCount],
        ['RESERVED', base.reserved]
    ]) {
        view.setUint32(layout[field], value, true);
    }
    view.setUint32(
        layout.RESULT_FINGERPRINT,
        computeGpuTowerMergeResultFingerprint(base),
        true
    );
    return bytes;
}

test('Tower merge ABI는 2~256 source와 exact header/record/aggregate를 고정한다', () => {
    assert.equal(GPU_TOWER_MERGE_ABI.PROGRAM.STRIDE, 128);
    assert.equal(GPU_TOWER_MERGE_ABI.RECORD.STRIDE, 80);
    assert.equal(GPU_TOWER_MERGE_ABI.RESULT.STRIDE, 112);
    assert.equal(GPU_TOWER_MERGE_MAX_SOURCE_COUNT, 256);
    assert.equal(GPU_TOWER_MERGE_ABI.PROGRAM.RESERVED_2, 124);
    assert.equal(GPU_TOWER_MERGE_ABI.RECORD.RESERVED_2, 76);
    assert.equal(GPU_TOWER_MERGE_ABI.RESULT.RESERVED, 108);

    for (const count of [2, 64, 256]) {
        const records = makeRecords(count);
        const storage = createGpuTowerMergeHostStorage(256);
        const program = writeGpuTowerMergeProgram(storage, {
            transactionId: `merge-${count}`,
            planFingerprint: '0123456789abcdef',
            sourceTick: 77,
            sourceGroupRevision: 3,
            targetGroupRevision: 4,
            sourceRosterFingerprint: rosterFingerprint(records, 3),
            targetRosterFingerprint: rosterFingerprint(records, 4, true),
            records,
            bodyCapacity: 512,
            protocol: PROTOCOL
        });
        assert.equal(program.sourceCount, count);
        assert.equal(program.records.length, count);
        assert.equal(program.planFingerprint, '0123456789abcdef');
        assert.equal(program.survivorRank, 0);
        assert.notEqual(program.programFingerprint, 0);
        assert.notEqual(program.sourceIdentityFingerprint, 0);
        const view = new DataView(storage.program);
        assert.equal(view.getUint32(
            GPU_TOWER_MERGE_ABI.PROGRAM.SOURCE_COUNT,
            true
        ), count);
        assert.equal(view.getUint32(
            GPU_TOWER_MERGE_ABI.PROGRAM.RESERVED_0,
            true
        ), 0);
    }

    const result = readGpuTowerMergeResult(writeResultBytes());
    assert.equal(result.resultFingerprintValid, true);
    assert.equal(result.planFingerprint, '0123456789abcdef');
    const malformed = writeResultBytes();
    new DataView(malformed).setUint32(
        GPU_TOWER_MERGE_ABI.RESULT.APPLIED_COUNT,
        1,
        true
    );
    assert.equal(readGpuTowerMergeResult(malformed).resultFingerprintValid, false);
});

test('Tower merge shader는 전역 dispatch 5단계와 storage 9 한도를 지킨다', () => {
    for (const entry of [
        'clear_merge',
        'validate_sources',
        'seal_merge',
        'apply_merge',
        'finalize_merge'
    ]) {
        assert.match(GPU_TOWER_MERGE_WGSL, new RegExp(`fn ${entry}\\(`));
    }
    assert.equal(GPU_TOWER_MERGE_WGSL.includes('workgroupBarrier'), false);
    const bindings = [...GPU_TOWER_MERGE_WGSL.matchAll(
        /@group\(0\) @binding\((\d+)\)/g
    )].map((match) => Number(match[1]));
    assert.deepEqual(bindings, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(GPU_TOWER_MERGE_STORAGE_PROFILE.maximumStorageBuffersPerStage, 9);
    assert.ok(GPU_TOWER_MERGE_WGSL.indexOf('fn seal_merge')
        < GPU_TOWER_MERGE_WGSL.indexOf('fn apply_merge'));
    assert.match(
        GPU_TOWER_MERGE_WGSL,
        /atomicAnd\([\s\S]*BODY_FLAG_ALIVE[\s\S]*BODY_FLAG_CONTROLLED_THIS_TICK/
    );
    assert.match(GPU_TOWER_MERGE_WGSL, /roster\.member_count = 1u/);
    assert.match(GPU_TOWER_MERGE_WGSL, /ERROR_APPLY_PARTIAL/);
    assert.equal(GpuTowerMergeRuntime.prototype.getStatus instanceof Function, true);
});

class FakeMuxRuntime {
    constructor() {
        this.envelope = null;
        this.state = null;
        this.calls = [];
    }

    canAccept() { return this.envelope === null; }
    getStagedTransaction() {
        return this.state === 'staged' ? this.envelope : null;
    }
    getStatus() {
        return {
            state: this.state ?? 'ready',
            pendingTransaction: this.envelope,
            pendingReadbackCount: this.state === 'submitted' ? 1 : 0,
            requiresRecovery: false
        };
    }
    encode(_pass, tick) { this.calls.push(['encode', tick]); this.state = 'encoded'; }
    encodeReadback(_encoder, tick) { this.calls.push(['copy', tick]); this.state = 'copied'; }
    markSubmitted(tick) { this.calls.push(['submit', tick]); this.state = 'submitted'; }
    failEncoded(error) { this.calls.push(['fail', error]); }
    retire(reason) {
        this.calls.push(['retire', reason]);
        this.envelope = null;
        this.state = 'idle';
    }
}

test('Tower transaction mux는 creation/merge 중 하나만 같은 fixed hook에 제출한다', () => {
    const creation = new FakeMuxRuntime();
    const merge = new FakeMuxRuntime();
    const mux = new GpuTowerTransactionRuntimeMux(creation, merge);
    merge.envelope = { sourceTick: 19 };
    merge.state = 'staged';
    assert.equal(mux.getStagedTransaction(), merge.envelope);
    mux.encode({}, 19);
    mux.encodeReadback({}, 19);
    mux.markSubmitted(19);
    assert.deepEqual(merge.calls, [
        ['encode', 19],
        ['copy', 19],
        ['submit', 19]
    ]);
    assert.deepEqual(creation.calls, []);
    assert.equal(mux.getStatus().transactionKind, 'merge');

    creation.envelope = { sourceTick: 20 };
    creation.state = 'staged';
    merge.envelope = { sourceTick: 20 };
    merge.state = 'staged';
    assert.throws(() => mux.getStagedTransaction(), /동시에 stage/);
    mux.retire('fixture-retire');
    assert.deepEqual(creation.calls, [['retire', 'fixture-retire']]);
    assert.deepEqual(merge.calls.at(-1), ['retire', 'fixture-retire']);
});

class FakeMergeBackend {
    constructor() {
        this.protocol = PROTOCOL;
        this.available = true;
        this.recovery = false;
        this.staged = null;
        this.completions = [];
        this.finalizations = [];
        this.cleanups = [];
        this.cleanupToken = Object.freeze({});
    }

    canStageTowerMerge() { return this.available && !this.staged; }
    getTowerMergeRuntimeStatus() {
        return {
            state: this.recovery ? 'failed' : 'ready',
            recordCapacity: 256,
            ringRejectedCount: 0,
            requiresRecovery: this.recovery,
            failure: null
        };
    }
    getEventProtocolState() { return this.protocol; }
    stageTowerMergeTransaction(request) {
        this.staged = request;
        return {
            accepted: true,
            sourceTick: request.sourceTick,
            sourceCount: request.plan.sourceCount,
            transactionId: request.plan.transactionId,
            planFingerprint: request.plan.fingerprint,
            recoveryRequired: false
        };
    }
    drainCompletedTowerMergeTransactions(out) {
        out.push(...this.completions);
        this.completions.length = 0;
        return out;
    }
    enqueue(status = 'committed') {
        const { plan, sourceTick } = this.staged;
        this.completions.push(Object.freeze({
            transactionId: plan.transactionId,
            planFingerprint: plan.fingerprint,
            sourceTick,
            submittedTick: sourceTick,
            sourceCount: plan.sourceCount,
            survivorHandle: plan.survivor.exactGpuBinding,
            committed: status === 'committed',
            rejectedSourceChanged: status === 'rejected',
            recoveryRequired: status === 'protocol',
            evidence: Object.freeze({ status }),
            ...this.protocol
        }));
    }
    finalizeTowerMergeTransaction(request) {
        this.finalizations.push(request);
        if (request.committed) {
            return {
                accepted: true,
                committed: true,
                cleanupToken: this.cleanupToken,
                requiresRecovery: false
            };
        }
        this.staged = null;
        return { accepted: true, committed: false, requiresRecovery: false };
    }
    cleanupTowerMergeTransaction(token) {
        assert.equal(token, this.cleanupToken);
        const handles = this.staged.plan.consumed.map(
            ({ exactGpuBinding }) => exactGpuBinding
        );
        this.cleanups.push(...handles);
        this.staged = null;
        return {
            accepted: true,
            cleanedCount: handles.length,
            disposition: TOWER_MERGE_LIFECYCLE_DISPOSITION,
            requiresRecovery: false
        };
    }
    cancelAllTowerMerges() {
        this.staged = null;
        return { requiresRecovery: false };
    }
}

function createCoordinatorFixture(count = 4) {
    const state = new TowerGroupState();
    if (count > 1) {
        const split = state.planCreation({
            transactionId: `fixture-split-${count}`,
            childCount: count - 1
        });
        assert.equal(state.commitCreation(split).accepted, true);
    }
    const registry = new WorldRegistry({ capacity: count + 4 });
    for (const record of state.getTowerRecords()) {
        if (record.state !== TOWER_GROUP_RECORD_STATE.LIVING) continue;
        const handle = registry.reserveEntity({
            kindId: 'tower',
            definitionId: 'the-tower',
            createdAtTick: 0
        });
        assert.equal(registry.activateReserved(handle, {
            logicalTowerOrdinal: record.logicalTowerOrdinal
        }), true);
        state.bindGpuBody(record.logicalTowerId, handle, PROTOCOL);
    }
    const backend = new FakeMergeBackend();
    const coordinator = new TowerMergeCoordinator({
        towerGroupState: state,
        registry,
        backend
    });
    return { state, registry, backend, coordinator };
}

test('Coordinator는 GPU completion 다음 owner boundary에 TOWER_MERGED cleanup과 ledger를 exact 1회 commit한다', () => {
    const { state, registry, backend, coordinator } = createCoordinatorFixture(4);
    const request = {
        transactionId: 'coordinator-merge',
        compiledOperation: OPERATION,
        requestedFixedTick: 41
    };
    const queued = coordinator.requestTowerMerge(request);
    assert.equal(queued.pending, true);
    assert.equal(coordinator.requestTowerMerge(request), queued);
    const staged = coordinator.stageForFixedTick(41);
    assert.equal(staged.staged, true);
    backend.enqueue('committed');
    const receipt = coordinator.observeCompletedAtFixedBoundary(42);
    assert.equal(
        receipt.result,
        TOWER_MERGE_RESULT.COMMITTED,
        JSON.stringify(receipt)
    );
    assert.equal(receipt.disposition, 'TOWER_MERGED');
    assert.equal(receipt.cleanupReceipts.length, 3);
    assert.equal(receipt.cleanupReceipts.every((entry) => (
        entry.disposition === 'TOWER_MERGED'
        && entry.deathEventCount === 0
        && entry.rewardMutationCount === 0
    )), true);
    assert.equal(registry.getActiveCount(), 1);
    assert.equal(state.getTowerRecords().filter((record) => record.alive).length, 1);
    assert.equal(state.getTowerRecords().filter((record) => (
        record.state === TOWER_GROUP_RECORD_STATE.MERGED
    )).length, 3);
    assert.equal(receipt.deathEventCount, 0);
    assert.equal(receipt.lostShareMutationCount, 0);
    assert.equal(receipt.goldMutationCount, 0);
    assert.equal(receipt.rewardMutationCount, 0);
    assert.equal(backend.finalizations.length, 1);
    assert.equal(backend.cleanups.length, 3);
    assert.equal(coordinator.requestTowerMerge(request), receipt);
});

test('source-changed와 ring pressure는 persistent mutation/recovery 없이 reject 또는 retry한다', () => {
    const fixture = createCoordinatorFixture(2);
    const request = {
        transactionId: 'coordinator-reject',
        compiledOperation: OPERATION,
        requestedFixedTick: 51
    };
    fixture.backend.available = false;
    fixture.coordinator.requestTowerMerge(request);
    const deferred = fixture.coordinator.stageForFixedTick(51);
    assert.equal(deferred.pending, true);
    assert.equal(deferred.deferredReason, 'program-capacity');
    assert.equal(fixture.coordinator.requiresRecovery(), false);
    assert.equal(fixture.registry.getActiveCount(), 2);

    fixture.backend.available = true;
    fixture.coordinator.stageForFixedTick(52);
    fixture.backend.enqueue('rejected');
    const rejected = fixture.coordinator.observeCompletedAtFixedBoundary(53);
    assert.equal(rejected.result, TOWER_MERGE_RESULT.REJECTED_SOURCE_CHANGED);
    assert.equal(rejected.recoveryRequired, false);
    assert.equal(fixture.registry.getActiveCount(), 2);
    assert.equal(fixture.state.getTowerRecords().filter((record) => record.alive).length, 2);
});
