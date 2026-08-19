import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';
import {
    GPU_TOWER_CREATION_ABI,
    GPU_TOWER_CREATION_ABI_VERSION,
    GPU_TOWER_CREATION_MODE,
    GPU_TOWER_CREATION_RECORD_KIND,
    GPU_TOWER_CREATION_STATUS,
    GPU_TOWER_CREATION_STORAGE_PROFILE,
    computeGpuTowerCreationResultFingerprint,
    computeGpuTowerCreationRecordFingerprint,
    createGpuTowerCreationHostStorage,
    writeGpuTowerCreationProgram
} from '../script/module/ingame/physics/gpu/gpu_tower_creation_abi.js';
import {
    GPU_TOWER_CREATION_ACTOR_ACTION_WGSL,
    GPU_TOWER_CREATION_WGSL
} from '../script/module/ingame/physics/gpu/gpu_tower_creation_shaders.js';
import {
    GpuTowerCreationRuntime
} from '../script/module/ingame/physics/gpu/gpu_tower_creation_runtime.js';
import {
    GPU_TOWER_GROUP_MEMBER_FLAG,
    computeGpuTowerGroupRosterFingerprint
} from '../script/module/ingame/physics/gpu/gpu_tower_group_abi.js';
import {
    GpuTowerGroupRuntime
} from '../script/module/ingame/physics/gpu/gpu_tower_group_runtime.js';
import { WorldRegistry } from '../script/module/ingame/object/world_registry.js';
import {
    THE_TOWER_RUNTIME_DATA
} from '../script/data/object/tower/the_tower_data.js';

const { TowerCreationCoordinator } = await loadGameModule(
    'ingame/object/tower/tower_creation_coordinator.js'
);
const { EnemySimulationBackend } = await loadGameModule(
    'ingame/object/enemy/enemy_simulation_backend.js'
);
const {
    PRIMARY_TOWER_LOGICAL_ID,
    TOWER_CREATION_RESULT,
    TowerGroupState
} = await loadGameModule('ingame/object/tower/tower_group_state.js');

const PROTOCOL = Object.freeze({
    sessionGeneration: 7,
    deviceGeneration: 3,
    authoritativeEpoch: 11
});

function descriptor(index) {
    return Object.freeze({
        position: Object.freeze({ x: index + 0.25, y: index * -2 })
    });
}

class FakeTowerCreationBackend {
    constructor(options = {}) {
        this.protocol = PROTOCOL;
        this.recordCapacity = options.recordCapacity ?? 256;
        this.groupCapacity = options.groupCapacity ?? 256;
        this.bodyCapacity = options.bodyCapacity ?? 256;
        this.ringAvailable = options.ringAvailable ?? true;
        this.recoveryRequired = false;
        this.preleases = new Map();
        this.staged = null;
        this.completions = [];
        this.lastPrelease = null;
        this.lastStage = null;
        this.finalizations = [];
    }

    canStageTowerCreation() {
        return this.ringAvailable
            && !this.recoveryRequired
            && this.staged === null;
    }

    getTowerCreationRuntimeStatus() {
        return Object.freeze({
            state: this.recoveryRequired ? 'failed' : 'ready',
            recordCapacity: this.recordCapacity,
            towerCapacity: Math.min(this.recordCapacity, this.groupCapacity),
            productionTowerCapacity:
                THE_TOWER_RUNTIME_DATA.PRODUCTION_TOWER_CAPACITY,
            requiresRecovery: this.recoveryRequired
        });
    }

    getTowerGroupRuntimeStatus() {
        return Object.freeze({ capacity: this.groupCapacity });
    }

    getAvailableTowerCreationBodyCapacity() {
        return this.bodyCapacity;
    }

    getEventProtocolState() {
        return this.protocol;
    }

    preleaseTowerCreationBodies(request) {
        if (request.handles.length > this.bodyCapacity) {
            return Object.freeze({
                accepted: false,
                reason: 'tower-creation-body-capacity',
                requiresRecovery: false
            });
        }
        const token = Object.freeze({});
        const prelease = Object.freeze({ ...request, token });
        this.preleases.set(token, prelease);
        this.lastPrelease = prelease;
        this.bodyCapacity -= request.handles.length;
        return Object.freeze({
            accepted: true,
            token,
            handles: Object.freeze([...request.handles]),
            slots: Object.freeze(request.handles.map((_, index) => index + 1)),
            requiresRecovery: false
        });
    }

    cancelTowerCreationBodyPrelease(token) {
        const prelease = this.preleases.get(token);
        if (!prelease) {
            return Object.freeze({
                accepted: false,
                cancelledCount: 0,
                requiresRecovery: false
            });
        }
        this.preleases.delete(token);
        this.bodyCapacity += prelease.handles.length;
        return Object.freeze({
            accepted: true,
            cancelledCount: prelease.handles.length,
            requiresRecovery: false
        });
    }

    stageTowerCreationTransaction(request) {
        if (!this.ringAvailable || this.staged) {
            return Object.freeze({
                accepted: false,
                reason: 'tower-creation-result-ring-capacity',
                recoveryRequired: false
            });
        }
        this.staged = request;
        this.lastStage = request;
        return Object.freeze({
            accepted: true,
            transactionId: request.plan.transactionId,
            transactionFingerprint: request.transactionFingerprint,
            sourceTick: request.sourceTick,
            recordCount: request.plan.existing.length
                + request.plan.children.length,
            childCount: request.plan.children.length,
            targetGroupRevision: request.plan.targetGroupRevision,
            targetRosterFingerprint: 99,
            recoveryRequired: false
        });
    }

    drainCompletedTowerCreationTransactions(out = []) {
        out.push(...this.completions);
        this.completions.length = 0;
        return out;
    }

    finalizeTowerCreationTransaction(request) {
        const prelease = this.preleases.get(request.preleaseToken);
        this.finalizations.push(request);
        if (!prelease) {
            return Object.freeze({
                accepted: false,
                committed: false,
                requiresRecovery: false
            });
        }
        this.preleases.delete(request.preleaseToken);
        if (!request.committed) this.bodyCapacity += prelease.handles.length;
        this.staged = null;
        return Object.freeze({
            accepted: true,
            committed: request.committed === true,
            finalizedCount: prelease.handles.length,
            handles: request.committed ? prelease.handles : Object.freeze([]),
            requiresRecovery: request.recoveryRequired === true
        });
    }

    cancelAllTowerCreations(reason = 'cancelled') {
        let cancelled = 0;
        for (const prelease of this.preleases.values()) {
            cancelled += prelease.handles.length;
        }
        this.bodyCapacity += cancelled;
        this.preleases.clear();
        const submitted = this.staged !== null;
        this.staged = null;
        return Object.freeze({
            cancelledPreleaseCount: cancelled,
            reason,
            requiresRecovery: submitted
        });
    }

    completeCommitted(evidence = {}) {
        this.#complete({
            result: GPU_TOWER_CREATION_STATUS.COMMITTED,
            committed: true,
            rejectedSourceChanged: false,
            evidence
        });
    }

    completeRejected(evidence = {}) {
        this.#complete({
            result: GPU_TOWER_CREATION_STATUS.REJECTED_SOURCE_CHANGED,
            committed: false,
            rejectedSourceChanged: true,
            evidence
        });
    }

    #complete(source) {
        const request = this.staged;
        if (!request) throw new Error('staged Tower creation이 없습니다.');
        this.completions.push(Object.freeze({
            transactionId: request.plan.transactionId,
            transactionFingerprint: request.transactionFingerprint,
            sourceTick: request.sourceTick,
            submittedTick: request.sourceTick,
            childCount: request.plan.children.length,
            protocolFailure: false,
            recoveryRequired: false,
            ...source,
            ...this.protocol
        }));
    }
}

function createFixture(options = {}) {
    const registry = new WorldRegistry({
        capacity: options.registryCapacity ?? 256
    });
    const state = new TowerGroupState();
    const primaryHandle = registry.reserveEntity({
        kindId: 'tower',
        definitionId: 'the-tower',
        createdAtTick: 0
    });
    assert.ok(primaryHandle);
    assert.equal(registry.activateReserved(primaryHandle, {
        logicalTowerOrdinal: 1
    }), true);
    state.bindGpuBody(PRIMARY_TOWER_LOGICAL_ID, primaryHandle, PROTOCOL);
    const backend = new FakeTowerCreationBackend(options);
    const coordinator = new TowerCreationCoordinator({
        towerGroupState: state,
        registry,
        backend,
        historyCapacity: options.historyCapacity
    });
    return { registry, state, backend, coordinator, primaryHandle };
}

function requestChildren(coordinator, transactionId, childCount, tick = 5) {
    return coordinator.requestTowerCreation({
        transactionId,
        childCount,
        childSpawnDescriptors: Array.from(
            { length: childCount },
            (_, index) => descriptor(index)
        ),
        requestedFixedTick: tick
    });
}

function damagePrimary(state, handle, damageFixedPoint = 1200) {
    state.commitCompletedEvents({
        events: [{
            type: 'contact',
            eventType: 'damage-applied',
            disposition: 'applied',
            entityId: 900,
            incarnation: 1,
            other: handle,
            ...PROTOCOL,
            sourceTick: 1,
            sequence: 0,
            key: 'tower-creation-damage',
            damageFixedPoint,
            reason: null
        }]
    });
}

test('30/30 및 18/30의 1→2는 인증된 다음 경계에서만 Registry/ledger를 함께 publish한다', () => {
    for (const damaged of [false, true]) {
        const fixture = createFixture();
        if (damaged) damagePrimary(
            fixture.state,
            fixture.primaryHandle
        );
        const id = damaged ? 'create-18-to-two' : 'create-30-to-two';
        assert.equal(requestChildren(fixture.coordinator, id, 1).accepted, true);
        const staged = fixture.coordinator.stageForFixedTick(5);
        assert.equal(staged.staged, true);
        assert.equal(fixture.registry.getStatus().reservedCount, 1);
        assert.equal(fixture.state.getStatus().livingTowerCount, 1);
        assert.equal(
            fixture.coordinator.observeCompletedAtFixedBoundary(6).pending,
            true
        );

        fixture.backend.completeCommitted({ path: damaged ? '18/30' : '30/30' });
        const completion = fixture.coordinator
            .observeCompletedAtFixedBoundary(6);
        assert.equal(completion.result, TOWER_CREATION_RESULT.COMMITTED);
        assert.equal(completion.createdCount, 1);
        assert.equal(fixture.registry.getStatus().activeCount, 2);
        assert.equal(fixture.registry.getStatus().reservedCount, 0);
        const records = fixture.state.getTowerRecords();
        assert.equal(records.length, 2);
        assert.equal(records.every((record) => record.exactGpuBinding), true);
        assert.equal(records.reduce(
            (sum, record) => sum + record.currentHpFixedPoint,
            0
        ), damaged ? 1800 : 3000);
        assert.equal(fixture.state.auditInvariants().valid, true);
    }
});

test('1→100 creation은 숨은 count cap 없이 99개 child reservation과 metadata를 commit한다', () => {
    const fixture = createFixture({
        registryCapacity: 120,
        recordCapacity: 120,
        groupCapacity: 120,
        bodyCapacity: 120
    });
    assert.equal(requestChildren(
        fixture.coordinator,
        'create-one-to-one-hundred',
        99,
        7
    ).accepted, true);
    assert.equal(fixture.coordinator.stageForFixedTick(7).recordCount, 100);
    assert.equal(fixture.registry.getStatus().reservedCount, 99);
    fixture.backend.completeCommitted();
    const completion = fixture.coordinator.observeCompletedAtFixedBoundary(8);
    assert.equal(completion.createdCount, 99);
    assert.equal(fixture.state.getStatus().livingTowerCount, 100);
    assert.equal(fixture.registry.getStatus().activeCount, 100);
    assert.equal(fixture.coordinator.getStatus().reservationHighWater, 99);
});

test('Share/HP/Power와 child ability metadata는 같은 exact plan에서 유도된다', () => {
    const fixture = createFixture();
    requestChildren(fixture.coordinator, 'metadata-plan', 1, 9);
    fixture.coordinator.stageForFixedTick(9);
    const child = fixture.backend.lastStage.plan.children[0];
    const intent = fixture.backend.lastPrelease.spawnIntents[0];
    const metadata = fixture.backend.lastStage.childAbilityMetadata[0];
    assert.equal(intent.shareUnits, child.shareUnits);
    assert.equal(intent.currentHpFixedPoint, child.currentHpFixedPoint);
    assert.equal(intent.maxHpFixedPoint, child.maxHpFixedPoint);
    assert.equal(intent.powerFixedPoint, child.powerFixedPoint);
    assert.equal(metadata.powerFixedPoint, child.powerFixedPoint);
    assert.equal(intent.alive, true, 'backend가 GPU publication 전 false로 override합니다.');
});

test('heterogeneous N→N+K도 exact source 집합의 합계와 모든 destination binding을 보존한다', () => {
    const fixture = createFixture();
    requestChildren(fixture.coordinator, 'heterogeneous-seed', 2, 4);
    fixture.coordinator.stageForFixedTick(4);
    fixture.backend.completeCommitted();
    const seeded = fixture.coordinator.observeCompletedAtFixedBoundary(5);
    assert.equal(seeded.createdCount, 2);

    const victim = seeded.handles[1];
    fixture.state.commitCompletedEvents({
        events: [{
            type: 'contact',
            eventType: 'damage-applied',
            disposition: 'applied',
            entityId: 901,
            incarnation: 1,
            other: victim,
            ...PROTOCOL,
            sourceTick: 5,
            sequence: 0,
            key: 'heterogeneous-child-damage',
            damageFixedPoint: 200,
            reason: null
        }]
    });
    const beforeTotal = fixture.state.getTowerRecords().reduce(
        (sum, record) => sum + record.currentHpFixedPoint,
        0
    );
    requestChildren(fixture.coordinator, 'heterogeneous-expand', 3, 6);
    const staged = fixture.coordinator.stageForFixedTick(6);
    assert.equal(staged.recordCount, 6);
    fixture.backend.completeCommitted();
    const expanded = fixture.coordinator.observeCompletedAtFixedBoundary(7);
    assert.equal(expanded.createdCount, 3);
    const records = fixture.state.getTowerRecords();
    assert.equal(records.length, 6);
    assert.equal(records.every((record) => record.exactGpuBinding), true);
    assert.equal(records.reduce(
        (sum, record) => sum + record.currentHpFixedPoint,
        0
    ), beforeTotal);
    assert.equal(fixture.state.auditInvariants().valid, true);
});

test('Registry/body/group/program 중 하나라도 한 자리 부족하면 public mutation은 0이다', () => {
    for (const options of [
        { registryCapacity: 2 },
        { bodyCapacity: 1 },
        { groupCapacity: 2 },
        { recordCapacity: 2 },
        { ringAvailable: false }
    ]) {
        const fixture = createFixture(options);
        requestChildren(
            fixture.coordinator,
            `capacity-${JSON.stringify(options)}`,
            2,
            11
        );
        const result = fixture.coordinator.stageForFixedTick(11);
        assert.equal(result.result, TOWER_CREATION_RESULT.REJECTED_CAPACITY);
        assert.equal(fixture.registry.getStatus().reservedCount, 0);
        assert.equal(fixture.registry.getStatus().activeCount, 1);
        assert.equal(fixture.state.getTowerRecords().length, 1);
        assert.equal(fixture.state.getStatus().pendingCreation, null);
    }
});

test('low-current-HP preview reason은 technical runtime reason과 같고 reservation 전 거절된다', () => {
    const rejected = createFixture();
    damagePrimary(rejected.state, rejected.primaryHandle, 2999);
    const preview = rejected.coordinator.previewTowerCreation({ childCount: 1 });
    assert.equal(
        preview.result,
        TOWER_CREATION_RESULT.REJECTED_NON_VIABLE_CURRENT_HP
    );
    requestChildren(rejected.coordinator, 'technical-current-hp-0.01', 1, 15);
    const runtime = rejected.coordinator.stageForFixedTick(15);
    assert.equal(runtime.reason, preview.reason);
    assert.equal(rejected.registry.getStatus().reservedCount, 0);
    assert.equal(rejected.backend.preleases.size, 0);
    assert.equal(runtime.recoveryRequired, false);

    const allowed = createFixture();
    damagePrimary(allowed.state, allowed.primaryHandle, 2998);
    const allowedPreview = allowed.coordinator.previewTowerCreation({
        childCount: 1
    });
    assert.equal(allowedPreview.executionEnabled, true);
    requestChildren(allowed.coordinator, 'technical-current-hp-0.02', 1, 16);
    assert.equal(allowed.coordinator.stageForFixedTick(16).staged, true);
    assert.deepEqual(
        [
            ...allowed.backend.lastStage.plan.existing,
            ...allowed.backend.lastStage.plan.children
        ].map((record) => record.currentHpFixedPoint),
        [1, 1]
    );
    allowed.backend.completeCommitted();
    assert.equal(
        allowed.coordinator.observeCompletedAtFixedBoundary(17).result,
        TOWER_CREATION_RESULT.COMMITTED
    );
});

test('production Tower capacity 256은 exact accept, 257은 reservation 없이 atomic reject한다', () => {
    const exact = createFixture({
        registryCapacity: 300,
        recordCapacity: 256,
        groupCapacity: 256,
        bodyCapacity: 300
    });
    const receipt = requestChildren(
        exact.coordinator,
        'capacity-exact-256',
        255,
        17
    );
    assert.equal(
        receipt.capacity.productionTowerCapacity,
        THE_TOWER_RUNTIME_DATA.PRODUCTION_TOWER_CAPACITY
    );
    assert.equal(receipt.capacity.requiredTowerCount, 256);
    assert.equal(exact.coordinator.stageForFixedTick(17).recordCount, 256);
    exact.backend.completeCommitted();
    assert.equal(
        exact.coordinator.observeCompletedAtFixedBoundary(18).createdCount,
        255
    );

    const overflow = createFixture({
        registryCapacity: 300,
        recordCapacity: 256,
        groupCapacity: 256,
        bodyCapacity: 300
    });
    requestChildren(
        overflow.coordinator,
        'capacity-overflow-257',
        256,
        19
    );
    const rejected = overflow.coordinator.stageForFixedTick(19);
    assert.equal(rejected.result, TOWER_CREATION_RESULT.REJECTED_CAPACITY);
    assert.equal(rejected.reason, 'TOWER_CAPACITY');
    assert.equal(overflow.registry.getStatus().reservedCount, 0);
    assert.equal(overflow.backend.preleases.size, 0);
    assert.equal(overflow.state.getTowerRecords().length, 1);
});

test('backend 기본값은 production 256이고 1,000은 명시적 runtime fixture override다', () => {
    const production = new EnemySimulationBackend({}, { capacity: 1_000 });
    const productionStatus = production.getTowerCreationRuntimeStatus();
    assert.equal(
        productionStatus.productionTowerCapacity,
        THE_TOWER_RUNTIME_DATA.PRODUCTION_TOWER_CAPACITY
    );
    assert.equal(productionStatus.towerCapacity, 256);
    assert.equal(productionStatus.recordCapacity, 256);
    assert.equal(
        production.getTowerGroupRuntimeStatus().capacity,
        1_000,
        'group runtime capacity는 stable body-slot address 범위입니다.'
    );
    production.destroy();

    const control = new EnemySimulationBackend({}, {
        capacity: 1_000,
        towerGroupMemberCapacity: 1_000
    });
    const controlStatus = control.getTowerCreationRuntimeStatus();
    assert.equal(controlStatus.productionTowerCapacity, 256);
    assert.equal(controlStatus.towerCapacity, 1_000);
    assert.equal(controlStatus.productionCapacityOverridden, true);
    assert.equal(control.getTowerGroupRuntimeStatus().capacity, 1_000);
    control.destroy();
});

test('HP drift/source death/destination ABA는 GPU source-changed 결과로 전량 rollback된다', () => {
    for (const reason of ['hp-drift', 'source-death', 'destination-aba']) {
        const fixture = createFixture();
        requestChildren(fixture.coordinator, `reject-${reason}`, 2, 13);
        fixture.coordinator.stageForFixedTick(13);
        fixture.backend.completeRejected({ reason });
        const result = fixture.coordinator.observeCompletedAtFixedBoundary(14);
        assert.equal(
            result.result,
            TOWER_CREATION_RESULT.REJECTED_SOURCE_CHANGED
        );
        assert.equal(fixture.registry.getStatus().reservedCount, 0);
        assert.equal(fixture.registry.getStatus().activeCount, 1);
        assert.equal(fixture.state.getTowerRecords().length, 1);
        assert.equal(fixture.backend.preleases.size, 0);
    }
});

test('middle descriptor accessor/sparse array는 plan·reservation 전에 fail-closed 거절된다', () => {
    const fixture = createFixture();
    let reads = 0;
    const malformed = { position: { x: 1, y: 2 } };
    Object.defineProperty(malformed, 'payload', {
        enumerable: true,
        get() {
            reads++;
            return 'forbidden';
        }
    });
    const rejected = fixture.coordinator.requestTowerCreation({
        transactionId: 'malformed-middle',
        childCount: 3,
        childSpawnDescriptors: [descriptor(0), malformed, descriptor(2)],
        requestedFixedTick: 3
    });
    assert.equal(rejected.result, TOWER_CREATION_RESULT.REJECTED_DESCRIPTOR);
    assert.equal(reads, 0);
    assert.equal(fixture.registry.getStatus().reservedCount, 0);
    assert.equal(fixture.state.getStatus().pendingCreation, null);

    const sparse = new Array(2);
    sparse[0] = descriptor(0);
    const sparseResult = fixture.coordinator.requestTowerCreation({
        transactionId: 'sparse-descriptors',
        childCount: 2,
        childSpawnDescriptors: sparse,
        requestedFixedTick: 3
    });
    assert.equal(sparseResult.result, TOWER_CREATION_RESULT.REJECTED_DESCRIPTOR);
});

test('future tick은 defer되고 놓친 tick과 duplicate transaction은 재실행되지 않는다', () => {
    const fixture = createFixture();
    requestChildren(fixture.coordinator, 'future-create', 1, 20);
    assert.equal(fixture.coordinator.stageForFixedTick(19).deferred, true);
    const missed = fixture.coordinator.stageForFixedTick(21);
    assert.equal(missed.result, TOWER_CREATION_RESULT.REJECTED_SOURCE_CHANGED);
    assert.equal(fixture.registry.getStatus().reservedCount, 0);
    const duplicate = requestChildren(
        fixture.coordinator,
        'future-create',
        1,
        22
    );
    assert.equal(duplicate.result, TOWER_CREATION_RESULT.PROTOCOL_FAILURE);
});

test('same fingerprint replay는 queued/pending/COMMITTED receipt를 그대로 반환한다', () => {
    const fixture = createFixture();
    const queued = requestChildren(
        fixture.coordinator,
        'idempotent-commit',
        1,
        23
    );
    assert.strictEqual(
        requestChildren(fixture.coordinator, 'idempotent-commit', 1, 23),
        queued
    );
    assert.equal(fixture.registry.getStatus().reservedCount, 0);

    const pending = fixture.coordinator.stageForFixedTick(23);
    assert.strictEqual(
        requestChildren(fixture.coordinator, 'idempotent-commit', 1, 23),
        pending
    );
    assert.equal(fixture.registry.getStatus().reservedCount, 1);
    assert.equal(fixture.coordinator.getStatus().stagedCount, 1);

    fixture.backend.completeCommitted({ replay: 'committed' });
    const completed = fixture.coordinator.observeCompletedAtFixedBoundary(24);
    assert.strictEqual(
        requestChildren(fixture.coordinator, 'idempotent-commit', 1, 23),
        completed
    );
    assert.equal(fixture.registry.getStatus().activeCount, 2);
    assert.equal(fixture.state.getStatus().livingTowerCount, 2);
    assert.equal(fixture.coordinator.getStatus().committedCount, 1);
    assert.equal(fixture.coordinator.getStatus().replayedCount, 3);
});

test('ordinary rejection replay도 기존 receipt를 반환하고 새 reservation을 만들지 않는다', () => {
    const fixture = createFixture();
    requestChildren(fixture.coordinator, 'idempotent-rejection', 2, 25);
    fixture.coordinator.stageForFixedTick(25);
    fixture.backend.completeRejected({ replay: 'ordinary-rejection' });
    const rejected = fixture.coordinator.observeCompletedAtFixedBoundary(26);
    const replay = requestChildren(
        fixture.coordinator,
        'idempotent-rejection',
        2,
        25
    );
    assert.strictEqual(replay, rejected);
    assert.equal(replay.result, TOWER_CREATION_RESULT.REJECTED_SOURCE_CHANGED);
    assert.equal(fixture.registry.getStatus().reservedCount, 0);
    assert.equal(fixture.registry.getStatus().activeCount, 1);
    assert.equal(fixture.backend.preleases.size, 0);
    assert.equal(fixture.coordinator.getStatus().rejectedCount, 1);
});

test('same ID의 childCount/descriptor/requested tick 변경은 fingerprint protocol failure다', () => {
    const alterations = [
        (coordinator, id) => requestChildren(coordinator, id, 2, 27),
        (coordinator, id) => coordinator.requestTowerCreation({
            transactionId: id,
            childCount: 1,
            childSpawnDescriptors: [{ position: { x: 99, y: -2 } }],
            requestedFixedTick: 27
        }),
        (coordinator, id) => requestChildren(coordinator, id, 1, 28)
    ];
    for (let index = 0; index < alterations.length; index++) {
        const fixture = createFixture();
        const id = `fingerprint-mismatch-${index}`;
        const original = requestChildren(fixture.coordinator, id, 1, 27);
        const mismatch = alterations[index](fixture.coordinator, id);
        assert.equal(mismatch.result, TOWER_CREATION_RESULT.PROTOCOL_FAILURE);
        assert.equal(
            mismatch.reason,
            'TRANSACTION_FINGERPRINT_MISMATCH'
        );
        assert.notEqual(
            mismatch.requestFingerprint,
            mismatch.expectedRequestFingerprint
        );
        assert.strictEqual(
            requestChildren(fixture.coordinator, id, 1, 27),
            original
        );
        assert.equal(fixture.registry.getStatus().reservedCount, 0);
        assert.equal(fixture.coordinator.requiresRecovery(), false);
        assert.equal(fixture.coordinator.getStatus().replayMismatchCount, 1);
    }
});

test('completed receipt history는 bounded eviction 경계에서 가장 오래된 receipt만 제거한다', () => {
    const fixture = createFixture({ historyCapacity: 2 });
    const rejectMissedTick = (id, requestedTick) => {
        requestChildren(fixture.coordinator, id, 1, requestedTick);
        return fixture.coordinator.stageForFixedTick(requestedTick + 1);
    };
    const first = rejectMissedTick('history-first', 30);
    const second = rejectMissedTick('history-second', 32);
    assert.strictEqual(
        requestChildren(fixture.coordinator, 'history-first', 1, 30),
        first
    );
    const third = rejectMissedTick('history-third', 34);
    assert.equal(third.result, TOWER_CREATION_RESULT.REJECTED_SOURCE_CHANGED);
    assert.equal(fixture.coordinator.getStatus().historyCount, 2);
    assert.strictEqual(
        requestChildren(fixture.coordinator, 'history-second', 1, 32),
        second
    );

    const afterEviction = requestChildren(
        fixture.coordinator,
        'history-first',
        1,
        30
    );
    assert.notStrictEqual(afterEviction, first);
    assert.equal(afterEviction.accepted, true);
    assert.equal(fixture.coordinator.getStatus().historyCount, 2);
    assert.equal(fixture.coordinator.getStatus().activeTransactionCount, 1);
});

function installFakeWebGpuGlobals() {
    const previous = {
        GPUBufferUsage: globalThis.GPUBufferUsage,
        GPUShaderStage: globalThis.GPUShaderStage,
        GPUMapMode: globalThis.GPUMapMode
    };
    globalThis.GPUBufferUsage = Object.freeze({
        STORAGE: 1 << 0,
        COPY_SRC: 1 << 1,
        COPY_DST: 1 << 2,
        UNIFORM: 1 << 3,
        MAP_READ: 1 << 4
    });
    globalThis.GPUShaderStage = Object.freeze({ COMPUTE: 1 });
    globalThis.GPUMapMode = Object.freeze({ READ: 1 });
    return () => {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete globalThis[key];
            else globalThis[key] = value;
        }
    };
}

class FakeBuffer {
    constructor(descriptor) {
        this.label = descriptor.label;
        this.size = descriptor.size;
        this.data = new ArrayBuffer(descriptor.size);
        this.mapResolvers = [];
        this.destroyed = false;
    }

    mapAsync() {
        return new Promise((resolve) => this.mapResolvers.push(resolve));
    }

    resolveMap() {
        this.mapResolvers.shift()?.();
    }

    getMappedRange() {
        return this.data;
    }

    unmap() {}

    destroy() {
        this.destroyed = true;
    }
}

class FakeDevice {
    constructor() {
        this.limits = {
            maxBufferSize: 1 << 24,
            maxStorageBufferBindingSize: 1 << 24,
            maxStorageBuffersPerShaderStage: 9
        };
        this.queue = {
            writeBuffer: (
                target,
                targetOffset,
                source,
                sourceOffset = 0,
                size = undefined
            ) => {
                const bytes = ArrayBuffer.isView(source)
                    ? new Uint8Array(
                        source.buffer,
                        source.byteOffset,
                        source.byteLength
                    )
                    : new Uint8Array(source);
                const length = size ?? (bytes.byteLength - sourceOffset);
                new Uint8Array(target.data, targetOffset, length).set(
                    bytes.subarray(sourceOffset, sourceOffset + length)
                );
            },
            submit() {}
        };
    }

    createBuffer(descriptor) {
        return new FakeBuffer(descriptor);
    }

    createBindGroupLayout(descriptor) { return descriptor; }
    createPipelineLayout(descriptor) { return descriptor; }
    createShaderModule(descriptor) { return descriptor; }
    createBindGroup(descriptor) { return descriptor; }

    createComputePipeline(descriptor) {
        return Object.freeze({
            label: descriptor.label,
            entryPoint: descriptor.compute.entryPoint
        });
    }
}

function gpuResources(device, capacity = 4) {
    const buffer = (label, size) => device.createBuffer({
        label,
        size,
        usage: 0
    });
    return {
        counts: buffer('counts', 16),
        physics: buffer('physics', capacity * 32),
        simulation: buffer('simulation', capacity * 32),
        abilityMetadata: buffer('ability-metadata', capacity * 48),
        actorTransit: buffer('actor-transit', capacity * 160),
        members: buffer('members', capacity * 40),
        roster: buffer('roster', 32 + capacity * 4),
        bodyControlStates: buffer('body-control', capacity * 64)
    };
}

function creationRecords() {
    return [
        {
            kind: GPU_TOWER_CREATION_RECORD_KIND.EXISTING,
            slot: 0,
            entityId: 10,
            incarnation: 1,
            logicalTowerOrdinal: 1,
            sourceCurrentHpFixedPoint: 3000,
            targetCurrentHpFixedPoint: 1500,
            sourceShareUnits: 1_000_000_000,
            targetShareUnits: 500_000_000,
            sourceMaxHpFixedPoint: 3000,
            targetMaxHpFixedPoint: 1500,
            sourcePowerFixedPoint: 1000,
            targetPowerFixedPoint: 500,
            sourceGroupRevision: 1,
            targetGroupRevision: 2,
            rosterRank: 0
        },
        {
            kind: GPU_TOWER_CREATION_RECORD_KIND.CHILD,
            slot: 1,
            entityId: 11,
            incarnation: 1,
            logicalTowerOrdinal: 2,
            sourceCurrentHpFixedPoint: 0,
            targetCurrentHpFixedPoint: 1500,
            sourceShareUnits: 0,
            targetShareUnits: 500_000_000,
            sourceMaxHpFixedPoint: 0,
            targetMaxHpFixedPoint: 1500,
            sourcePowerFixedPoint: 0,
            targetPowerFixedPoint: 500,
            sourceGroupRevision: 0,
            targetGroupRevision: 2,
            rosterRank: 1
        }
    ];
}

function creationRosterFingerprints(records) {
    const flags = GPU_TOWER_GROUP_MEMBER_FLAG.TOWER_NOUN
        | GPU_TOWER_GROUP_MEMBER_FLAG.LIVING;
    const toMember = (record, target) => ({
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
        groupRevision: target ? 2 : 1,
        flags,
        rosterRank: record.rosterRank
    });
    return Object.freeze({
        source: computeGpuTowerGroupRosterFingerprint({
            protocol: PROTOCOL,
            groupRevision: 1,
            members: records
                .filter((record) => (
                    record.kind === GPU_TOWER_CREATION_RECORD_KIND.EXISTING
                ))
                .map((record) => toMember(record, false))
        }),
        target: computeGpuTowerGroupRosterFingerprint({
            protocol: PROTOCOL,
            groupRevision: 2,
            members: records.map((record) => toMember(record, true))
        })
    });
}

function writeCommittedResult(runtime, staged) {
    const result = {
        status: GPU_TOWER_CREATION_STATUS.COMMITTED,
        errorFlags: 0,
        ...PROTOCOL,
        sourceTick: staged.sourceTick,
        transactionFingerprint: staged.transactionFingerprint,
        recordCount: staged.recordCount,
        validatedCount: staged.recordCount,
        appliedCount: staged.recordCount,
        createdCount: staged.childCount,
        sourceGroupRevision: 1,
        targetGroupRevision: staged.targetGroupRevision,
        targetRosterFingerprint: staged.targetRosterFingerprint,
        mode: GPU_TOWER_CREATION_MODE.CPU_EXPLICIT_DESCRIPTORS,
        executionOrdinal: 0,
        commandFingerprint: 0,
        snapshotFingerprint: 0,
        placementFingerprint: 0,
        actorActionProfileFingerprint: 0,
        metadataCommitCount: 0,
        metadataCommitFingerprint: 0
    };
    const view = new DataView(runtime.buffers.result.data);
    const abi = GPU_TOWER_CREATION_ABI.RESULT;
    const fields = [
        [abi.ABI_VERSION, GPU_TOWER_CREATION_ABI_VERSION],
        [abi.STATUS, result.status],
        [abi.ERROR_FLAGS, result.errorFlags],
        [abi.SESSION_GENERATION, result.sessionGeneration],
        [abi.DEVICE_GENERATION, result.deviceGeneration],
        [abi.AUTHORITATIVE_EPOCH, result.authoritativeEpoch],
        [abi.SOURCE_TICK, result.sourceTick],
        [abi.TRANSACTION_FINGERPRINT, result.transactionFingerprint],
        [abi.RECORD_COUNT, result.recordCount],
        [abi.VALIDATED_COUNT, result.validatedCount],
        [abi.APPLIED_COUNT, result.appliedCount],
        [abi.CREATED_COUNT, result.createdCount],
        [abi.SOURCE_GROUP_REVISION, result.sourceGroupRevision],
        [abi.TARGET_GROUP_REVISION, result.targetGroupRevision],
        [abi.TARGET_ROSTER_FINGERPRINT, result.targetRosterFingerprint],
        [abi.MODE, result.mode],
        [abi.EXECUTION_ORDINAL, result.executionOrdinal],
        [abi.COMMAND_FINGERPRINT, result.commandFingerprint],
        [abi.SNAPSHOT_FINGERPRINT, result.snapshotFingerprint],
        [abi.PLACEMENT_FINGERPRINT, result.placementFingerprint],
        [abi.ACTOR_ACTION_PROFILE_FINGERPRINT,
            result.actorActionProfileFingerprint],
        [abi.METADATA_COMMIT_COUNT, result.metadataCommitCount],
        [abi.METADATA_COMMIT_FINGERPRINT,
            result.metadataCommitFingerprint],
        [abi.RESULT_FINGERPRINT,
            computeGpuTowerCreationResultFingerprint(result)]
    ];
    for (const [offset, value] of fields) {
        view.setUint32(offset, value, true);
    }
}

async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
}

test('creation ABI/runtime은 main pass 6단계와 bounded 결과 ring만 사용한다', async () => {
    const restore = installFakeWebGpuGlobals();
    const device = new FakeDevice();
    const resources = gpuResources(device);
    const runtime = new GpuTowerCreationRuntime({
        bodyCapacity: 4,
        recordCapacity: 4,
        readbackSlotCount: 1
    });
    try {
        runtime.initialize(device, resources, PROTOCOL);
        const records = creationRecords();
        const fingerprints = creationRosterFingerprints(records);
        const staged = runtime.stage({
            transactionId: 'runtime-commit',
            transactionFingerprint: 12345,
            sourceTick: 8,
            sourceGroupRevision: 1,
            targetGroupRevision: 2,
            sourceRosterFingerprint: fingerprints.source,
            targetRosterFingerprint: fingerprints.target,
            existingCount: 1,
            childCount: 1,
            towerDefinitionCode: 777,
            records,
            protocol: PROTOCOL
        });
        assert.equal(staged.accepted, true);
        const entries = [];
        runtime.encode({
            setPipeline(pipeline) { entries.push(pipeline.entryPoint); },
            setBindGroup() {},
            dispatchWorkgroups() {}
        }, 8);
        assert.deepEqual(entries, [
            'clear_creation',
            'validate_creation',
            'seal_creation',
            'apply_creation',
            'publish_creation_children',
            'finalize_creation'
        ]);
        writeCommittedResult(runtime, staged);
        runtime.encodeReadback({
            copyBufferToBuffer(source, sourceOffset, target, targetOffset, size) {
                new Uint8Array(target.data, targetOffset, size).set(
                    new Uint8Array(source.data, sourceOffset, size)
                );
            }
        }, 8);
        runtime.markSubmitted(8);
        runtime.readbackSlots[0].buffer.resolveMap();
        await flushMicrotasks();
        const [completion] = runtime.drainCompleted([]);
        assert.equal(completion.committed, true);
        assert.equal(completion.recoveryRequired, false);
        assert.equal(runtime.getStatus().fullBodyReadbackCount, 0);
        assert.equal(
            runtime.getStatus().resultReadbackBytes,
            GPU_TOWER_CREATION_ABI.RESULT.STRIDE
        );
    } finally {
        runtime.destroy();
        restore();
    }
});

test('ActorAction Tower creation은 placement identity와 metadata pass를 ALIVE 전에 결합한다', () => {
    const restore = installFakeWebGpuGlobals();
    const device = new FakeDevice();
    const resources = gpuResources(device);
    const runtime = new GpuTowerCreationRuntime({
        bodyCapacity: 4,
        recordCapacity: 4,
        readbackSlotCount: 1
    });
    try {
        runtime.initialize(device, resources, PROTOCOL);
        const records = creationRecords();
        const fingerprints = creationRosterFingerprints(records);
        const placementBuffer = device.createBuffer({
            label: 'actor-action-placement-output',
            size: 320,
            usage: 0
        });
        const actorAction = Object.freeze({
            placementAbiVersion: 1,
            executionOrdinal: 7,
            commandFingerprint: 101,
            snapshotFingerprint: 102,
            destinationFingerprint: 103,
            placementFingerprint: 104,
            actorActionProfileFingerprint: 105,
            sourceAbilityCode: 106,
            sourceExecutionFingerprint: 107,
            actionCode: 1,
            payloadCode: 2,
            creationOriginCode: 2,
            visibleFromExecutionOrdinal: 8,
            snapshotSourceTick: 11
        });
        const staged = runtime.stage({
            transactionId: 'runtime-actor-action',
            transactionFingerprint: 54321,
            sourceTick: 12,
            sourceGroupRevision: 1,
            targetGroupRevision: 2,
            sourceRosterFingerprint: fingerprints.source,
            targetRosterFingerprint: fingerprints.target,
            existingCount: 1,
            childCount: 1,
            towerDefinitionCode: 777,
            records,
            protocol: PROTOCOL,
            mode: GPU_TOWER_CREATION_MODE.GPU_SUBJECT_ACTOR_ACTION,
            actorAction,
            actorActionPlacementBinding: Object.freeze({
                abiVersion: 1,
                buffer: placementBuffer,
                aggregateByteOffset: 0,
                byteLength: 320,
                subjectCount: 1,
                executionOrdinal: actorAction.executionOrdinal,
                commandFingerprint: actorAction.commandFingerprint,
                snapshotFingerprint: actorAction.snapshotFingerprint,
                destinationFingerprint: actorAction.destinationFingerprint,
                placementFingerprint: actorAction.placementFingerprint,
                actorActionProfileFingerprint:
                    actorAction.actorActionProfileFingerprint,
                snapshotSourceTick: actorAction.snapshotSourceTick
            })
        });
        assert.equal(staged.accepted, true);
        assert.equal(
            staged.actorActionProfileFingerprint,
            actorAction.actorActionProfileFingerprint
        );
        const entries = [];
        runtime.encode({
            setPipeline(pipeline) { entries.push(pipeline.entryPoint); },
            setBindGroup() {},
            dispatchWorkgroups() {}
        }, 12);
        assert.deepEqual(entries, [
            'clear_creation',
            'validate_creation',
            'validate_actor_action_placement',
            'seal_creation',
            'apply_creation',
            'apply_actor_action_placement',
            'seal_actor_action_metadata',
            'publish_creation_children',
            'finalize_creation'
        ]);
    } finally {
        runtime.destroy();
        restore();
    }
});

test('pending roster transition command은 성공 target과 거절 source fingerprint를 같은 tick에 인증한다', () => {
    const restore = installFakeWebGpuGlobals();
    const device = new FakeDevice();
    const resources = gpuResources(device);
    const runtime = new GpuTowerGroupRuntime({ capacity: 4 });
    const member = (slot, entityId, ordinal) => ({
        slot,
        entityId,
        incarnation: 1,
        logicalTowerOrdinal: ordinal,
        shareUnits: ordinal === 1 ? 1_000_000_000 : 500_000_000,
        maxHpFixedPoint: 3000,
        powerFixedPoint: 1000,
        flags: GPU_TOWER_GROUP_MEMBER_FLAG.TOWER_NOUN
            | GPU_TOWER_GROUP_MEMBER_FLAG.LIVING
    });
    try {
        runtime.initialize(device, resources, PROTOCOL);
        const source = runtime.synchronizeRoster({
            protocol: PROTOCOL,
            groupRevision: 1,
            members: [member(0, 10, 1)]
        });
        const transition = runtime.prepareRosterTransition({
            transactionId: 'same-tick-control',
            protocol: PROTOCOL,
            groupRevision: 2,
            members: [
                { ...member(0, 10, 1), shareUnits: 500_000_000 },
                member(1, 11, 2)
            ]
        });
        const command = runtime.stageCommand({
            protocol: PROTOCOL,
            sourceTick: 9,
            moveIntent: { x: 1, y: 0 },
            aimWorldPoint: { x: 4, y: 5 }
        });
        assert.equal(command.groupRevision, transition.target.groupRevision);
        assert.equal(command.rosterFingerprint, transition.target.fingerprint);
        assert.equal(command.fallbackGroupRevision, source.groupRevision);
        assert.equal(command.fallbackRosterFingerprint, source.fingerprint);
        assert.equal(
            runtime.finalizeRosterTransition('same-tick-control', true).accepted,
            true
        );
    } finally {
        runtime.destroy();
        restore();
    }
});

test('creation shader/ABI는 <=9 storage, validate-before-apply, child ALIVE-last를 고정한다', () => {
    assert.deepEqual(GPU_TOWER_CREATION_STORAGE_PROFILE, {
        validateStorageBuffersPerStage: 9,
        applyStorageBuffersPerStage: 9,
        actorActionStorageBuffersPerStage: 9,
        maximumStorageBuffersPerStage: 9
    });
    for (const entry of [
        'clear_creation',
        'validate_creation',
        'seal_creation',
        'apply_creation',
        'publish_creation_children',
        'finalize_creation'
    ]) {
        assert.match(GPU_TOWER_CREATION_WGSL, new RegExp(`fn ${entry}\\b`));
    }
    assert.equal(
        new Set([...GPU_TOWER_CREATION_WGSL.matchAll(
            /@binding\((\d+)\)/g
        )].map((match) => Number(match[1]))).size,
        9
    );
    const validateIndex = GPU_TOWER_CREATION_WGSL.indexOf('fn validate_creation');
    const applyIndex = GPU_TOWER_CREATION_WGSL.indexOf('fn apply_creation');
    const aliveIndex = GPU_TOWER_CREATION_WGSL.indexOf(
        'fn publish_creation_children'
    );
    const finalizeIndex = GPU_TOWER_CREATION_WGSL.indexOf('fn finalize_creation');
    assert.ok(validateIndex >= 0 && applyIndex > validateIndex);
    assert.ok(aliveIndex > applyIndex && finalizeIndex > aliveIndex);
    assert.match(GPU_TOWER_CREATION_WGSL, /BODY_FLAG_ALIVE/);
    assert.equal(
        new Set([...GPU_TOWER_CREATION_ACTOR_ACTION_WGSL.matchAll(
            /@binding\((\d+)\)/g
        )].map((match) => Number(match[1]))).size,
        9
    );

    const storage = createGpuTowerCreationHostStorage(2);
    const records = creationRecords();
    const fingerprints = creationRosterFingerprints(records);
    const program = writeGpuTowerCreationProgram(storage, {
        transactionFingerprint: 42,
        sourceTick: 3,
        sourceGroupRevision: 1,
        targetGroupRevision: 2,
        sourceRosterFingerprint: fingerprints.source,
        targetRosterFingerprint: fingerprints.target,
        existingCount: 1,
        childCount: 1,
        bodyCapacity: 2,
        rosterCapacity: 2,
        towerDefinitionCode: 77,
        records,
        protocol: PROTOCOL
    });
    assert.equal(program.recordCount, 2);
    assert.equal(program.childCount, 1);
    assert.equal(
        program.recordFingerprint,
        computeGpuTowerCreationRecordFingerprint(program.records)
    );
    const tamperedRecords = program.records.map((record, index) => (
        index === 1
            ? { ...record, targetCurrentHpFixedPoint: 1499 }
            : record
    ));
    assert.notEqual(
        computeGpuTowerCreationRecordFingerprint(tamperedRecords),
        program.recordFingerprint
    );

    const simulationSource = readFileSync(new URL(
        '../script/module/ingame/physics/gpu/gpu_circle_body_simulation.js',
        import.meta.url
    ), 'utf8');
    const creationIndex = simulationSource.indexOf(
        'this.towerCreationRuntime.encode(pass, requestedSourceTick)'
    );
    const groupIndex = simulationSource.indexOf(
        'this.towerGroupControlRuntime.encodeControl(',
        creationIndex
    );
    assert.ok(creationIndex >= 0 && groupIndex > creationIndex);
});
