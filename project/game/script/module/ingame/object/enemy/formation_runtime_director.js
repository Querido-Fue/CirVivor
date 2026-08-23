import {
    ENEMY_LIFECYCLE_DISPOSITION_ID
} from '../../contract/enemy_lifecycle_disposition_contract.js';
import {
    ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID,
    normalizeEnemyAtomicTransformTopologyId
} from '../../contract/enemy_atomic_transform_contract.js';
import {
    acceptsFormationRouteProgress,
    compareFormationJoinCandidates,
    createFormationLineageHash
} from '../../contract/enemy_formation_contract.js';
import {
    BASIC_HEXA_ENEMY_DEFINITION_ID,
    BASIC_HEXA_GROUP_ENEMY_DEFINITION_ID,
    BASIC_HEXA_HIVE_ENEMY_DEFINITION_ID,
    mergeBasicHexaHealthCenti
} from 'data/object/enemy/basic_hexa_enemy_data.js';
import {
    normalizeGpuPrivateHexaTransformDestinationIntent
} from '../gpu_spawn_intent.js';

const LINEAGE_CAPACITY = 6;
const INVALID_U32 = 0xffffffff;
const DEFAULT_PREPARE_CADENCE_TICKS = 4;
const FORMATION_DEFINITION_IDS = new Set([
    BASIC_HEXA_ENEMY_DEFINITION_ID,
    BASIC_HEXA_GROUP_ENEMY_DEFINITION_ID,
    BASIC_HEXA_HIVE_ENEMY_DEFINITION_ID
]);
const PRIVILEGED_TRANSFORM_DISPOSITIONS = new Set([
    ENEMY_LIFECYCLE_DISPOSITION_ID.MERGE_CONSUMED,
    ENEMY_LIFECYCLE_DISPOSITION_ID.TRANSFORM_CONSUMED
]);
const ATOMIC_TRANSFORM_OWNER = Object.freeze({
    FORMATION: 'formation',
    JORANG_LINEAGE: 'jorang-lineage'
});

function requirePositiveSafeInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0 || number > maximum) {
        throw new RangeError(`${label}은 1..${maximum} 범위의 안전한 정수여야 합니다.`);
    }
    return number;
}

function requireNonNegativeSafeInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0 || number > maximum) {
        throw new RangeError(`${label}은 0..${maximum} 범위의 안전한 정수여야 합니다.`);
    }
    return number;
}

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

function normalizeHandle(source, label) {
    return Object.freeze({
        entityId: requirePositiveSafeInteger(
            source?.entityId,
            `${label}.entityId`,
            INVALID_U32 - 1
        ),
        incarnation: requirePositiveSafeInteger(
            source?.incarnation,
            `${label}.incarnation`,
            INVALID_U32 - 1
        )
    });
}

function compareHandles(left, right) {
    return left.entityId - right.entityId
        || left.incarnation - right.incarnation;
}

function handleKey(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

function sameHandle(left, right) {
    return left.entityId === right.entityId
        && left.incarnation === right.incarnation;
}

function collectAtomicTransformProofs(entries) {
    const proofsByParent = new Map();
    for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        const parentCommandId = requireNonEmptyString(
            entry?.commandId,
            `atomicTransforms[${index}].commandId`
        );
        const topologyId = normalizeEnemyAtomicTransformTopologyId(
            entry?.topologyId,
            `atomicTransforms[${index}].topologyId`
        );
        const owner = topologyId
            === ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.MANY_TO_ONE
            ? ATOMIC_TRANSFORM_OWNER.FORMATION
            : ATOMIC_TRANSFORM_OWNER.JORANG_LINEAGE;
        const known = proofsByParent.get(parentCommandId);
        if (known && known.owner !== owner) {
            throw new RangeError(
                'atomic transform parent가 여러 runtime domain을 혼합했습니다.'
            );
        }
        proofsByParent.set(parentCommandId, Object.freeze({
            owner,
            count: (known?.count ?? 0) + 1
        }));
    }
    return proofsByParent;
}

function popcount6(mask) {
    let value = mask & 0x3f;
    let count = 0;
    while (value !== 0) {
        count += value & 1;
        value >>>= 1;
    }
    return count;
}

function assertCommandPort(source) {
    for (const method of [
        'requestPrepareBatch',
        'requestPreparedTransformBatch',
        'discardPreparedBatch'
    ]) {
        if (typeof source?.[method] !== 'function') {
            throw new TypeError(`Formation command port.${method}()가 필요합니다.`);
        }
    }
    return source;
}

function assertRegistry(source) {
    for (const method of ['has', 'copyEntityView']) {
        if (typeof source?.[method] !== 'function') {
            throw new TypeError(`Formation registry.${method}()가 필요합니다.`);
        }
    }
    return source;
}

/**
 * H/HX exact group roster와 consumed lineage를 bounded SoA로 소유합니다.
 * authored formationGroupId는 provenance일 뿐 runtime identity/merge key로 사용하지 않습니다.
 */
export class FormationRuntimeDirector {
    constructor(options = {}) {
        this.registry = assertRegistry(options.registry);
        this.commandPort = assertCommandPort(options.formationCommandPort);
        this.sessionGeneration = requirePositiveSafeInteger(
            options.sessionGeneration,
            'sessionGeneration'
        );
        this.capacity = requirePositiveSafeInteger(options.capacity, 'capacity');
        this.maximumPrepareRecordsPerFixedTick = requirePositiveSafeInteger(
            options.maximumPrepareRecordsPerFixedTick
                ?? Math.min(this.capacity, 256),
            'maximumPrepareRecordsPerFixedTick',
            this.capacity
        );
        if (this.maximumPrepareRecordsPerFixedTick < 2) {
            throw new RangeError(
                'maximumPrepareRecordsPerFixedTick은 Formation pair를 위해 2 이상이어야 합니다.'
            );
        }
        this.prepareCadenceTicks = requirePositiveSafeInteger(
            options.prepareCadenceTicks ?? DEFAULT_PREPARE_CADENCE_TICKS,
            'prepareCadenceTicks'
        );
        this.entityIds = new Uint32Array(this.capacity);
        this.incarnations = new Uint32Array(this.capacity);
        this.definitionCodes = new Uint32Array(this.capacity);
        this.coordinateSystemCodes = new Uint32Array(this.capacity);
        this.policyCodes = new Uint32Array(this.capacity);
        this.memberCounts = new Uint8Array(this.capacity);
        this.occupiedSlotMasks = new Uint8Array(this.capacity);
        this.rotationSteps = new Uint8Array(this.capacity);
        this.generations = new Uint32Array(this.capacity);
        this.lineageHashes = new Uint32Array(this.capacity);
        this.prepareSequences = new Uint32Array(this.capacity);
        this.lineageEntityIds = new Uint32Array(this.capacity * LINEAGE_CAPACITY);
        this.lineageIncarnations = new Uint32Array(this.capacity * LINEAGE_CAPACITY);
        this.indexByHandleKey = new Map();
        this.activeCount = 0;
        this.activeHiveCount = 0;
        this.pendingTransformsByParent = new Map();
        this.completedPrepareFingerprintByTick = new Map();
        this.observedLifecycleCommits = new WeakSet();
        this.lastLifecycleCommitTick = 0;
        this.lastObservedFixedTick = 0;
        this.lastPreparedSourceTick = 0;
        this.lastPrepareStageTick = 0;
        this.lastPrepareStageResult = null;
        this.nextPrepareCursor = 0;
        this.recoveryRequired = false;
        this.failure = null;
        this.ingressOpen = true;
        this.terminal = null;
        this.destroyed = false;
    }

    observeLifecycle(commit, fixedTick = commit?.fixedTick) {
        if (this.destroyed) {
            return this.getStatus();
        }
        const tick = requirePositiveSafeInteger(fixedTick, 'fixedTick');
        if (!commit || typeof commit !== 'object' || commit.fixedTick !== tick) {
            return this.#fail('lifecycle-contract');
        }
        if (this.observedLifecycleCommits.has(commit)) {
            return this.getStatus();
        }
        if (tick < this.lastObservedFixedTick
            || (this.lastLifecycleCommitTick !== 0
                && tick <= this.lastLifecycleCommitTick)) {
            return this.#fail('lifecycle-tick-regression');
        }
        if (!Array.isArray(commit.spawned)
            || !Array.isArray(commit.despawned)
            || !Array.isArray(commit.rejected)
            || !Array.isArray(commit.atomicTransforms)
            || commit.recoveryRequired === true) {
            return this.#fail('lifecycle-result-contract');
        }
        const removals = new Map();
        const additions = [];
        const completedParents = new Set();
        try {
            const atomicTransformProofs = collectAtomicTransformProofs(
                commit.atomicTransforms
            );
            const spawnedByParent = new Map();
            const despawnedByParent = new Map();
            const rejectedParents = new Set();
            for (const entry of commit.rejected) {
                if (typeof entry?.commandId === 'string') {
                    rejectedParents.add(entry.commandId);
                }
            }
            for (const entry of commit.spawned) {
                if (entry?.transform === true) {
                    const parent = requireNonEmptyString(
                        entry.parentCommandId,
                        'spawned.parentCommandId'
                    );
                    const proof = atomicTransformProofs.get(parent);
                    if (proof?.owner
                            === ATOMIC_TRANSFORM_OWNER.JORANG_LINEAGE) {
                        const topologyId = normalizeEnemyAtomicTransformTopologyId(
                            entry.topologyId,
                            'spawned.topologyId'
                        );
                        if (topologyId
                            === ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.MANY_TO_ONE) {
                            throw new RangeError(
                                'J lineage spawn이 Formation topology를 노출했습니다.'
                            );
                        }
                        continue;
                    }
                    if (proof?.owner !== ATOMIC_TRANSFORM_OWNER.FORMATION) {
                        throw new RangeError(
                            'transform spawn의 atomic proof가 없습니다.'
                        );
                    }
                    if (!this.pendingTransformsByParent.has(parent)) {
                        throw new RangeError('unknown transform spawn parent입니다.');
                    }
                    if (entry.topologyId !== undefined
                        && normalizeEnemyAtomicTransformTopologyId(
                            entry.topologyId,
                            'spawned.topologyId'
                        ) !== ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.MANY_TO_ONE) {
                        throw new RangeError(
                            'Formation spawn topology가 다릅니다.'
                        );
                    }
                    const list = spawnedByParent.get(parent) ?? [];
                    list.push(entry);
                    spawnedByParent.set(parent, list);
                }
            }
            for (const entry of commit.despawned) {
                if (entry?.parentCommandId !== undefined) {
                    const parent = requireNonEmptyString(
                        entry.parentCommandId,
                        'despawned.parentCommandId'
                    );
                    const proof = atomicTransformProofs.get(parent);
                    if (proof?.owner
                            === ATOMIC_TRANSFORM_OWNER.JORANG_LINEAGE) {
                        if (entry.reason !== 'atomic-transform'
                            || PRIVILEGED_TRANSFORM_DISPOSITIONS.has(
                                entry.disposition
                            )) {
                            throw new RangeError(
                                'J lineage despawn provenance가 다릅니다.'
                            );
                        }
                        continue;
                    }
                    if (proof?.owner !== ATOMIC_TRANSFORM_OWNER.FORMATION) {
                        throw new RangeError(
                            'transform despawn의 atomic proof가 없습니다.'
                        );
                    }
                    if (!this.pendingTransformsByParent.has(parent)) {
                        throw new RangeError('unknown transform despawn parent입니다.');
                    }
                    const list = despawnedByParent.get(parent) ?? [];
                    list.push(entry);
                    despawnedByParent.set(parent, list);
                }
            }

            for (const [parentCommandId, pending] of this.pendingTransformsByParent) {
                const spawned = spawnedByParent.get(parentCommandId) ?? [];
                const despawned = despawnedByParent.get(parentCommandId) ?? [];
                if (rejectedParents.has(parentCommandId)) {
                    if (spawned.length !== 0
                        || despawned.length !== 0
                        || atomicTransformProofs.has(parentCommandId)) {
                        throw new RangeError(
                            'rejected transform가 commit proof/mutation을 함께 노출했습니다.'
                        );
                    }
                    completedParents.add(parentCommandId);
                    continue;
                }
                if (spawned.length === 0 && despawned.length === 0) {
                    if (atomicTransformProofs.get(parentCommandId)?.owner
                        === ATOMIC_TRANSFORM_OWNER.FORMATION) {
                        throw new RangeError(
                            'Formation atomic proof에 lifecycle child가 없습니다.'
                        );
                    }
                    continue;
                }
                const expectedRecords = [
                    ...pending.recordsByDestinationKey.values()
                ];
                const proof = atomicTransformProofs.get(parentCommandId);
                if (proof?.owner !== ATOMIC_TRANSFORM_OWNER.FORMATION
                    || proof.count !== expectedRecords.length) {
                    throw new RangeError(
                        'Formation atomic proof cardinality가 다릅니다.'
                    );
                }
                if (spawned.length !== expectedRecords.length
                    || despawned.length !== expectedRecords.length * 2) {
                    throw new RangeError('transform lifecycle cardinality가 다릅니다.');
                }
                const consumedSpawnIds = new Set();
                const consumedDespawnIds = new Set();
                for (const record of expectedRecords) {
                    const childIds = Object.freeze({
                        spawn: `${parentCommandId}:transform:${record.transformIndex}:spawn`,
                        sourceA: `${parentCommandId}:transform:${record.transformIndex}:source:0`,
                        sourceB: `${parentCommandId}:transform:${record.transformIndex}:source:1`
                    });
                    const spawn = spawned.find((entry) => (
                        entry.commandId === childIds.spawn
                        && sameHandle(entry.handle, record.destinationHandle)
                    ));
                    if (!spawn || consumedSpawnIds.has(spawn.commandId)) {
                        throw new RangeError('transform spawn child provenance가 다릅니다.');
                    }
                    consumedSpawnIds.add(spawn.commandId);
                    const sourceEntries = record.sourceHandles.map((sourceHandle, index) => {
                        const commandId = index === 0
                            ? childIds.sourceA
                            : childIds.sourceB;
                        const entry = despawned.find((candidate) => (
                            candidate.commandId === commandId
                            && sameHandle(candidate.handle, sourceHandle)
                        ));
                        if (!entry
                            || consumedDespawnIds.has(commandId)
                            || entry.reason !== 'formation-transform'
                            || entry.disposition !== record.disposition
                            || entry.bountyEligible !== false
                            || !sameHandle(
                                entry.transformedInto,
                                record.destinationHandle
                            )) {
                            throw new RangeError(
                                'transform source child provenance가 다릅니다.'
                            );
                        }
                        consumedDespawnIds.add(commandId);
                        return entry;
                    });
                    for (const entry of sourceEntries) {
                        const handle = normalizeHandle(entry.handle, 'transformSource');
                        const key = handleKey(handle);
                        if (!this.indexByHandleKey.has(key)) {
                            throw new RangeError(
                                'transform source가 live Formation roster에 없습니다.'
                            );
                        }
                        removals.set(key, handle);
                    }
                    const destinationView = this.registry.copyEntityView(
                        record.destinationHandle,
                        {}
                    );
                    const normalizedDestination = this.#normalizeViewRecord(
                        destinationView,
                        record.lineage
                    );
                    this.#assertDestinationDescriptor(
                        normalizedDestination,
                        record.destinationDescriptor
                    );
                    additions.push(normalizedDestination);
                }
                if (consumedSpawnIds.size !== spawned.length
                    || consumedDespawnIds.size !== despawned.length) {
                    throw new RangeError('transform lifecycle에 extra child가 있습니다.');
                }
                completedParents.add(parentCommandId);
            }

            for (const [parentCommandId, proof] of atomicTransformProofs) {
                if (proof.owner === ATOMIC_TRANSFORM_OWNER.FORMATION
                    && !this.pendingTransformsByParent.has(parentCommandId)) {
                    throw new RangeError(
                        'unknown Formation atomic transform parent입니다.'
                    );
                }
            }
            for (const entry of commit.despawned) {
                if (entry.parentCommandId !== undefined) {
                    continue;
                }
                if (PRIVILEGED_TRANSFORM_DISPOSITIONS.has(entry.disposition)) {
                    throw new RangeError('raw transform disposition이 노출되었습니다.');
                }
                const handle = normalizeHandle(entry.handle, 'despawned.handle');
                const key = handleKey(handle);
                if (this.indexByHandleKey.has(key)) {
                    removals.set(key, handle);
                }
            }
            for (const entry of commit.spawned) {
                if (entry.transform === true) {
                    continue;
                }
                const handle = normalizeHandle(entry.handle, 'spawned.handle');
                const view = this.registry.copyEntityView(handle, {});
                if (!view || !FORMATION_DEFINITION_IDS.has(view.definitionId)) {
                    continue;
                }
                if (view.definitionId !== BASIC_HEXA_ENEMY_DEFINITION_ID) {
                    throw new RangeError('private Hexa natural spawn이 노출되었습니다.');
                }
                additions.push(this.#normalizeViewRecord(view, [handle]));
            }

            const survivingKeys = new Set(this.indexByHandleKey.keys());
            for (const key of removals.keys()) {
                survivingKeys.delete(key);
            }
            for (const record of additions) {
                const key = handleKey(record.handle);
                if (survivingKeys.has(key)) {
                    throw new RangeError('Formation destination identity가 충돌합니다.');
                }
                survivingKeys.add(key);
            }
            if (survivingKeys.size > this.capacity) {
                throw new RangeError('Formation roster capacity를 초과했습니다.');
            }
        } catch (error) {
            return this.#fail('lifecycle-preflight', error?.message);
        }

        for (const handle of removals.values()) {
            this.#removeHandle(handle);
        }
        for (const record of additions) {
            this.#appendNormalizedView(record);
        }
        for (const parentCommandId of completedParents) {
            this.pendingTransformsByParent.delete(parentCommandId);
        }
        this.observedLifecycleCommits.add(commit);
        this.lastLifecycleCommitTick = tick;
        this.lastObservedFixedTick = tick;
        if (this.terminal?.finalFixedTick === tick) {
            const rosterSealed = this.pendingTransformsByParent.size === 0
                && this.#isRosterRegistryExact();
            this.terminal = Object.freeze({
                ...this.terminal,
                lifecycleObserved: true,
                rosterSealed
            });
            if (!rosterSealed) {
                return this.#fail('terminal-formation-roster-mismatch');
            }
        }
        return this.getStatus();
    }

    observeCompletedPreparations(snapshot) {
        if (this.destroyed || !snapshot || typeof snapshot !== 'object') {
            return this.#fail('prepare-snapshot-contract');
        }
        if (snapshot.protocolFailure) {
            return this.#fail(
                snapshot.protocolFailure.code ?? 'prepare-protocol-failure'
            );
        }
        if (snapshot.stale === true || snapshot.batchIdFingerprint === 0) {
            return Object.freeze({ accepted: true, stale: true, transformCount: 0 });
        }
        const sourceTick = requirePositiveSafeInteger(
            snapshot.sourceTick,
            'sourceTick'
        );
        const targetFixedTick = requirePositiveSafeInteger(
            snapshot.targetFixedTick,
            'targetFixedTick'
        );
        if (targetFixedTick !== sourceTick + 1) {
            return this.#fail('prepare-publication-deadline');
        }
        if (!Array.isArray(snapshot.pairs)) {
            return this.#fail('prepare-pair-contract');
        }
        const snapshotReplayKey = JSON.stringify({
            batchIdFingerprint: snapshot.batchIdFingerprint,
            sourceTick,
            targetFixedTick,
            pairs: snapshot.pairs
        });
        const knownFingerprint = this.completedPrepareFingerprintByTick.get(
            sourceTick
        );
        if (knownFingerprint !== undefined) {
            if (knownFingerprint === snapshotReplayKey) {
                return Object.freeze({
                    accepted: true,
                    replayed: true,
                    stale: false,
                    transformCount: 0
                });
            }
            return this.#fail('prepare-snapshot-replay-conflict');
        }
        if (sourceTick <= this.lastPreparedSourceTick) {
            return this.#fail('prepare-source-tick-regression');
        }
        if (snapshot.pairs.length === 0) {
            const discarded = this.commandPort.discardPreparedBatch({
                batchIdFingerprint: snapshot.batchIdFingerprint
            });
            if (discarded?.accepted !== true) {
                return discarded?.requiresRecovery === true
                    ? this.#fail(
                        'prepare-discard',
                        discarded.reason ?? 'prepare-discard-rejected'
                    )
                    : discarded;
            }
            this.completedPrepareFingerprintByTick.set(
                sourceTick,
                snapshotReplayKey
            );
            this.lastPreparedSourceTick = sourceTick;
            return Object.freeze({ accepted: true, stale: false, transformCount: 0 });
        }
        const records = [];
        const pendingRecords = [];
        const claimedSources = new Set();
        try {
            for (let pairIndex = 0; pairIndex < snapshot.pairs.length; pairIndex++) {
                const pair = snapshot.pairs[pairIndex];
                const leftHandle = normalizeHandle({
                    entityId: pair.left.sourceEntityId,
                    incarnation: pair.left.sourceIncarnation
                }, `pairs[${pairIndex}].left`);
                const rightHandle = normalizeHandle({
                    entityId: pair.right.sourceEntityId,
                    incarnation: pair.right.sourceIncarnation
                }, `pairs[${pairIndex}].right`);
                const sourceHandles = [leftHandle, rightHandle].sort(compareHandles);
                for (const handle of sourceHandles) {
                    const key = handleKey(handle);
                    if (claimedSources.has(key)) {
                        throw new RangeError('prepare pair source가 중복되었습니다.');
                    }
                    claimedSources.add(key);
                }
                const leftIndex = this.indexByHandleKey.get(handleKey(leftHandle));
                const rightIndex = this.indexByHandleKey.get(handleKey(rightHandle));
                if (leftIndex === undefined || rightIndex === undefined) {
                    throw new RangeError('prepare pair source가 live Formation roster에 없습니다.');
                }
                this.#assertPreparedState(pair.left, leftIndex, 'left');
                this.#assertPreparedState(pair.right, rightIndex, 'right');
                const sourceLineageByKey = new Map([
                    [handleKey(leftHandle), this.#copyLineage(leftIndex)],
                    [handleKey(rightHandle), this.#copyLineage(rightIndex)]
                ]);
                const sourceLineages = sourceHandles.map((handle) => (
                    Object.freeze(sourceLineageByKey.get(handleKey(handle)))
                ));
                const lineage = sourceLineages.flat().sort(compareHandles);
                if (lineage.length !== pair.left.destinationMemberCount
                    || lineage.length > LINEAGE_CAPACITY) {
                    throw new RangeError('destination memberCount와 exact lineage가 다릅니다.');
                }
                for (let index = 1; index < lineage.length; index++) {
                    if (sameHandle(lineage[index - 1], lineage[index])) {
                        throw new RangeError('destination exact lineage가 중복되었습니다.');
                    }
                }
                const hp = mergeBasicHexaHealthCenti({
                    sourceACurrentHealthCenti: pair.left.currentHealthCenti,
                    sourceAMaxHealthCenti: pair.left.maxHealthCenti,
                    sourceBCurrentHealthCenti: pair.right.currentHealthCenti,
                    sourceBMaxHealthCenti: pair.right.maxHealthCenti
                });
                if (hp.currentHealthCenti
                        !== pair.left.expectedMergedCurrentHealthCenti
                    || hp.maxHealthCenti
                        !== pair.left.expectedMergedMaxHealthCenti) {
                    throw new RangeError('GPU/host merged centi-HP가 일치하지 않습니다.');
                }
                const generation = Math.max(
                    pair.left.generation,
                    pair.right.generation
                ) + 1;
                if (!Number.isSafeInteger(generation)
                    || generation >= INVALID_U32) {
                    throw new RangeError('Formation generation 공간이 고갈되었습니다.');
                }
                const lineageHash = createFormationLineageHash(lineage);
                const destinationDescriptor
                    = normalizeGpuPrivateHexaTransformDestinationIntent({
                        memberCount: lineage.length,
                        currentHealthCenti: hp.currentHealthCenti,
                        maxHealthCenti: hp.maxHealthCenti,
                        formationOccupiedSlotMask:
                            pair.left.destinationOccupiedSlotMask,
                        formationRotationStep:
                            pair.left.destinationRotationStep,
                        formationGeneration: generation,
                        formationLineageHash: lineageHash
                    });
                const disposition = lineage.length === LINEAGE_CAPACITY
                    ? ENEMY_LIFECYCLE_DISPOSITION_ID.TRANSFORM_CONSUMED
                    : ENEMY_LIFECYCLE_DISPOSITION_ID.MERGE_CONSUMED;
                records.push(Object.freeze({
                    sourceHandles: Object.freeze(sourceHandles),
                    sourceLineages: Object.freeze(sourceLineages),
                    destinationDescriptor,
                    disposition
                }));
                const destinationHandle = Object.freeze({
                    entityId: sourceHandles[0].entityId,
                    incarnation: sourceHandles[0].incarnation + 1
                });
                pendingRecords.push({
                    destinationHandle,
                    destinationDescriptor,
                    lineage: Object.freeze(lineage),
                    sourceHandles: Object.freeze(sourceHandles),
                    disposition,
                    transformIndex: pairIndex,
                    observed: false
                });
            }
        } catch (error) {
            return this.#fail('prepare-pair-validation', error?.message);
        }
        const parentCommandId = [
            'formation-transform',
            this.sessionGeneration,
            sourceTick,
            snapshot.batchIdFingerprint
        ].join(':');
        if (this.pendingTransformsByParent.has(parentCommandId)) {
            return this.#fail('transform-parent-command-collision');
        }
        const receipt = this.commandPort.requestPreparedTransformBatch({
            commandId: parentCommandId,
            batchIdFingerprint: snapshot.batchIdFingerprint,
            targetFixedTick,
            records
        });
        if (receipt?.accepted !== true) {
            if (receipt?.requiresRecovery === true) {
                return this.#fail(
                    'transform-request',
                    receipt.reason ?? 'transform-request-rejected'
                );
            }
            return receipt;
        }
        if (receipt.commandId !== parentCommandId) {
            return this.#fail('transform-command-id-mismatch');
        }
        const recordsByDestinationKey = new Map();
        for (const pending of pendingRecords) {
            recordsByDestinationKey.set(
                handleKey(pending.destinationHandle),
                pending
            );
        }
        this.pendingTransformsByParent.set(parentCommandId, Object.freeze({
            targetFixedTick,
            recordsByDestinationKey
        }));
        this.completedPrepareFingerprintByTick.set(
            sourceTick,
            snapshotReplayKey
        );
        while (this.completedPrepareFingerprintByTick.size > this.capacity) {
            const oldest = this.completedPrepareFingerprintByTick.keys().next().value;
            this.completedPrepareFingerprintByTick.delete(oldest);
        }
        this.lastPreparedSourceTick = sourceTick;
        return Object.freeze({
            accepted: true,
            stale: false,
            transformCount: records.length,
            commandId: parentCommandId
        });
    }

    stageForFixedTick({ targetFixedTick } = {}) {
        if (this.destroyed || !this.ingressOpen || this.recoveryRequired) {
            return Object.freeze({
                accepted: false,
                reason: this.terminal ? 'formation-terminal-closed' : 'formation-unavailable'
            });
        }
        const tick = requirePositiveSafeInteger(targetFixedTick, 'targetFixedTick');
        if (tick < this.lastPrepareStageTick) {
            return this.#fail('prepare-stage-tick-regression');
        }
        if (tick === this.lastPrepareStageTick
            && this.lastPrepareStageResult !== null) {
            return Object.freeze({
                ...this.lastPrepareStageResult,
                replayed: true
            });
        }
        if ((tick % this.prepareCadenceTicks) !== 0) {
            const result = Object.freeze({
                accepted: true,
                targetFixedTick: tick,
                stagedCount: 0,
                cadenceDeferred: true,
                replayed: false
            });
            this.lastPrepareStageTick = tick;
            this.lastPrepareStageResult = result;
            return result;
        }
        const indices = [];
        for (let index = 0; index < this.activeCount; index++) {
            if (this.memberCounts[index] < LINEAGE_CAPACITY) {
                indices.push(index);
            }
        }
        if (indices.length < 2) {
            const result = Object.freeze({
                accepted: true,
                targetFixedTick: tick,
                stagedCount: 0,
                replayed: false
            });
            this.lastPrepareStageTick = tick;
            this.lastPrepareStageResult = result;
            return result;
        }
        indices.sort((left, right) => (
            this.entityIds[left] - this.entityIds[right]
            || this.incarnations[left] - this.incarnations[right]
        ));
        const batchSize = Math.min(
            indices.length,
            this.maximumPrepareRecordsPerFixedTick
        );
        const startCursor = indices.length <= batchSize
            ? 0
            : this.nextPrepareCursor % indices.length;
        const selectedIndices = Array.from({ length: batchSize }, (_, offset) => (
            indices[(startCursor + offset) % indices.length]
        ));
        const sequencePlan = selectedIndices.map((index) => {
            if (this.prepareSequences[index] === 0xffffffff) {
                throw new RangeError('Formation prepare sequence 공간이 고갈되었습니다.');
            }
            const prepareSequence = this.prepareSequences[index];
            return Object.freeze({
                index,
                nextPrepareSequence: prepareSequence + 1,
                sourceHandle: Object.freeze({
                    entityId: this.entityIds[index],
                    incarnation: this.incarnations[index]
                }),
                prepareSequence
            });
        });
        const records = sequencePlan.map(({ sourceHandle, prepareSequence }) => (
            Object.freeze({ sourceHandle, prepareSequence })
        ));
        const receipt = this.commandPort.requestPrepareBatch({
            targetFixedTick: tick,
            records
        });
        if (receipt?.accepted !== true && receipt?.requiresRecovery === true) {
            return this.#fail(
                'prepare-request',
                receipt.reason ?? 'prepare-request-rejected'
            );
        }
        if (receipt?.accepted === true && receipt.replayed !== true) {
            for (const plan of sequencePlan) {
                this.prepareSequences[plan.index] = plan.nextPrepareSequence;
            }
            this.nextPrepareCursor = indices.length <= batchSize
                ? 0
                : (startCursor + Math.max(1, batchSize - 1))
                    % indices.length;
        }
        if (receipt?.accepted === true) {
            this.lastPrepareStageTick = tick;
            this.lastPrepareStageResult = receipt;
        }
        return receipt;
    }

    observeFixedCommit(commit, fixedTick) {
        const tick = requirePositiveSafeInteger(fixedTick, 'fixedTick');
        if (!commit || commit.fixedTick !== tick) {
            return this.#fail('fixed-commit-contract');
        }
        if (this.terminal?.finalFixedTick === tick) {
            this.terminal = Object.freeze({
                ...this.terminal,
                fixedCommitObserved: true
            });
        }
        return this.getStatus();
    }

    getMemberCount(groupHandle) {
        const index = this.indexByHandleKey.get(
            handleKey(normalizeHandle(groupHandle, 'groupHandle'))
        );
        return index === undefined ? 0 : this.memberCounts[index];
    }

    hasExactMember(groupHandle, memberHandle) {
        const index = this.indexByHandleKey.get(
            handleKey(normalizeHandle(groupHandle, 'groupHandle'))
        );
        if (index === undefined) {
            return false;
        }
        const member = normalizeHandle(memberHandle, 'memberHandle');
        const offset = index * LINEAGE_CAPACITY;
        for (let memberIndex = 0;
            memberIndex < this.memberCounts[index];
            memberIndex++) {
            if (this.lineageEntityIds[offset + memberIndex] === member.entityId
                && this.lineageIncarnations[offset + memberIndex]
                    === member.incarnation) {
                return true;
            }
        }
        return false;
    }

    copyExactMemberHandleAt(groupHandle, memberIndex, out = {}) {
        const index = this.indexByHandleKey.get(
            handleKey(normalizeHandle(groupHandle, 'groupHandle'))
        );
        const position = Number(memberIndex);
        if (index === undefined
            || !Number.isSafeInteger(position)
            || position < 0
            || position >= this.memberCounts[index]) {
            return null;
        }
        const offset = (index * LINEAGE_CAPACITY) + position;
        out.entityId = this.lineageEntityIds[offset];
        out.incarnation = this.lineageIncarnations[offset];
        return out;
    }

    acceptsRouteProgress(
        currentStage,
        currentCost,
        candidateStage,
        candidateCost
    ) {
        return acceptsFormationRouteProgress(
            currentStage,
            currentCost,
            candidateStage,
            candidateCost
        );
    }

    compareJoinCandidates(left, right) {
        return compareFormationJoinCandidates(left, right);
    }

    preflightTransform(snapshot) {
        return this.observeCompletedPreparations(snapshot);
    }

    commitPreflightedTransform(commit, fixedTick) {
        return this.observeLifecycle(commit, fixedTick);
    }

    cancelPreflightedTransform(parentCommandId) {
        const id = typeof parentCommandId === 'string' ? parentCommandId : '';
        return id.length > 0 && this.pendingTransformsByParent.delete(id);
    }

    closeForTerminal(finalFixedTick, reason = 'run-defeated') {
        if (this.destroyed) {
            return null;
        }
        const tick = requirePositiveSafeInteger(finalFixedTick, 'finalFixedTick');
        this.ingressOpen = false;
        this.pendingTransformsByParent.clear();
        this.completedPrepareFingerprintByTick.clear();
        this.terminal = Object.freeze({
            finalFixedTick: tick,
            reason: typeof reason === 'string' && reason.length > 0
                ? reason
                : 'run-defeated',
            fixedCommitObserved: false,
            lifecycleObserved: false,
            rosterSealed: false
        });
        return this.terminal;
    }

    resetGpuBinding(registry, formationCommandPort, sessionGeneration) {
        if (this.destroyed) {
            return false;
        }
        this.registry = assertRegistry(registry);
        this.commandPort = assertCommandPort(formationCommandPort);
        this.sessionGeneration = requirePositiveSafeInteger(
            sessionGeneration,
            'sessionGeneration'
        );
        this.#clearRoster();
        this.pendingTransformsByParent.clear();
        this.completedPrepareFingerprintByTick.clear();
        this.observedLifecycleCommits = new WeakSet();
        this.lastLifecycleCommitTick = 0;
        this.lastObservedFixedTick = 0;
        this.lastPreparedSourceTick = 0;
        this.lastPrepareStageTick = 0;
        this.lastPrepareStageResult = null;
        this.nextPrepareCursor = 0;
        this.recoveryRequired = false;
        this.failure = null;
        this.ingressOpen = true;
        this.terminal = null;
        return true;
    }

    requiresRecovery() {
        return !this.destroyed && this.recoveryRequired;
    }

    getStatus() {
        let totalMemberCount = 0;
        for (let index = 0; index < this.activeCount; index++) {
            totalMemberCount += this.memberCounts[index];
        }
        return Object.freeze({
            activeGroupCount: this.activeCount,
            activeHiveCount: this.activeHiveCount,
            totalOriginalMemberCount: totalMemberCount,
            pendingTransformBatchCount: this.pendingTransformsByParent.size,
            lastObservedFixedTick: this.lastObservedFixedTick,
            lastPreparedSourceTick: this.lastPreparedSourceTick,
            lastPrepareStageTick: this.lastPrepareStageTick,
            maximumPrepareRecordsPerFixedTick:
                this.maximumPrepareRecordsPerFixedTick,
            prepareCadenceTicks: this.prepareCadenceTicks,
            nextPrepareCursor: this.nextPrepareCursor,
            hiveHealthBarPolicy: 'hx-separate-health-bar',
            recoveryRequired: this.recoveryRequired,
            failure: this.failure,
            terminal: this.terminal,
            destroyed: this.destroyed
        });
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.#clearRoster();
        this.pendingTransformsByParent.clear();
        this.completedPrepareFingerprintByTick.clear();
        this.registry = null;
        this.commandPort = null;
        this.terminal = null;
    }

    #normalizeViewRecord(view, lineage) {
        if (!view || typeof view !== 'object'
            || !FORMATION_DEFINITION_IDS.has(view.definitionId)) {
            throw new TypeError('active Formation registry view가 필요합니다.');
        }
        const handle = normalizeHandle(view, 'formationView');
        const metadata = view.metadata;
        if (!metadata || typeof metadata !== 'object') {
            throw new TypeError('formationView.metadata가 필요합니다.');
        }
        const memberCount = requirePositiveSafeInteger(
            metadata?.formationMemberCount,
            'metadata.formationMemberCount',
            LINEAGE_CAPACITY
        );
        if (!Array.isArray(lineage) || lineage.length !== memberCount) {
            throw new RangeError('Formation memberCount와 exact lineage가 다릅니다.');
        }
        const normalizedLineage = lineage.map((member, index) => (
            normalizeHandle(member, `lineage[${index}]`)
        )).sort(compareHandles);
        for (let index = 1; index < normalizedLineage.length; index++) {
            if (sameHandle(normalizedLineage[index - 1], normalizedLineage[index])) {
                throw new RangeError('Formation exact lineage가 중복되었습니다.');
            }
        }
        const lineageHash = createFormationLineageHash(normalizedLineage);
        const definitionCode = requirePositiveSafeInteger(
            metadata.formationDefinitionCode,
            'metadata.formationDefinitionCode',
            INVALID_U32 - 1
        );
        const coordinateSystemCode = requirePositiveSafeInteger(
            metadata.formationCoordinateSystemCode,
            'metadata.formationCoordinateSystemCode',
            INVALID_U32 - 1
        );
        const policyCode = requirePositiveSafeInteger(
            metadata.formationPolicyCode,
            'metadata.formationPolicyCode',
            INVALID_U32 - 1
        );
        const occupiedSlotMask = requireNonNegativeSafeInteger(
            metadata.formationOccupiedSlotMask,
            'metadata.formationOccupiedSlotMask',
            0x3f
        );
        const rotationStep = requireNonNegativeSafeInteger(
            metadata.formationRotationStep,
            'metadata.formationRotationStep',
            5
        );
        const generation = requirePositiveSafeInteger(
            metadata.formationGeneration,
            'metadata.formationGeneration',
            INVALID_U32 - 1
        );
        if (lineageHash !== metadata.formationLineageHash
            || popcount6(occupiedSlotMask) !== memberCount
            || metadata.formationFlags !== 1
            || (view.definitionId === BASIC_HEXA_ENEMY_DEFINITION_ID
                && (memberCount !== 1 || generation !== 1))
            || (view.definitionId === BASIC_HEXA_GROUP_ENEMY_DEFINITION_ID
                && (memberCount < 2
                    || memberCount >= LINEAGE_CAPACITY
                    || generation <= 1))
            || (view.definitionId === BASIC_HEXA_HIVE_ENEMY_DEFINITION_ID
                && (memberCount !== LINEAGE_CAPACITY || generation <= 1))) {
            throw new RangeError('Formation registry state가 canonical roster와 다릅니다.');
        }
        return Object.freeze({
            handle,
            definitionId: view.definitionId,
            definitionCode,
            coordinateSystemCode,
            policyCode,
            memberCount,
            occupiedSlotMask,
            rotationStep,
            generation,
            lineageHash,
            lineage: Object.freeze(normalizedLineage)
        });
    }

    #appendNormalizedView(record) {
        if (this.activeCount >= this.capacity) {
            throw new RangeError('Formation roster capacity를 초과했습니다.');
        }
        const key = handleKey(record.handle);
        if (this.indexByHandleKey.has(key)) {
            throw new RangeError('Formation roster exact handle이 중복되었습니다.');
        }
        const index = this.activeCount++;
        this.entityIds[index] = record.handle.entityId;
        this.incarnations[index] = record.handle.incarnation;
        this.definitionCodes[index] = record.definitionCode;
        this.coordinateSystemCodes[index] = record.coordinateSystemCode;
        this.policyCodes[index] = record.policyCode;
        this.memberCounts[index] = record.memberCount;
        this.occupiedSlotMasks[index] = record.occupiedSlotMask;
        this.rotationSteps[index] = record.rotationStep;
        this.generations[index] = record.generation;
        this.lineageHashes[index] = record.lineageHash;
        this.prepareSequences[index] = 0;
        const offset = index * LINEAGE_CAPACITY;
        for (let memberIndex = 0;
            memberIndex < record.memberCount;
            memberIndex++) {
            this.lineageEntityIds[offset + memberIndex]
                = record.lineage[memberIndex].entityId;
            this.lineageIncarnations[offset + memberIndex]
                = record.lineage[memberIndex].incarnation;
        }
        this.indexByHandleKey.set(key, index);
        if (record.memberCount === LINEAGE_CAPACITY) {
            this.activeHiveCount++;
        }
    }

    #assertDestinationDescriptor(record, descriptor) {
        if (!descriptor
            || record.memberCount !== descriptor.memberCount
            || record.occupiedSlotMask
                !== descriptor.formationOccupiedSlotMask
            || record.rotationStep !== descriptor.formationRotationStep
            || record.generation !== descriptor.formationGeneration
            || record.lineageHash !== descriptor.formationLineageHash) {
            throw new RangeError(
                'committed destination Formation state가 prepared descriptor와 다릅니다.'
            );
        }
    }

    #isRosterRegistryExact() {
        for (let index = 0; index < this.activeCount; index++) {
            const handle = {
                entityId: this.entityIds[index],
                incarnation: this.incarnations[index]
            };
            if (!this.registry.has(handle)) {
                return false;
            }
            try {
                const view = this.registry.copyEntityView(handle, {});
                const normalized = this.#normalizeViewRecord(
                    view,
                    this.#copyLineage(index)
                );
                if (normalized.definitionCode !== this.definitionCodes[index]
                    || normalized.coordinateSystemCode
                        !== this.coordinateSystemCodes[index]
                    || normalized.policyCode !== this.policyCodes[index]
                    || normalized.memberCount !== this.memberCounts[index]
                    || normalized.occupiedSlotMask
                        !== this.occupiedSlotMasks[index]
                    || normalized.rotationStep !== this.rotationSteps[index]
                    || normalized.generation !== this.generations[index]
                    || normalized.lineageHash !== this.lineageHashes[index]) {
                    return false;
                }
            } catch {
                return false;
            }
        }
        return true;
    }

    #removeHandle(handle) {
        const key = handleKey(handle);
        const index = this.indexByHandleKey.get(key);
        if (index === undefined) {
            return false;
        }
        if (this.memberCounts[index] === LINEAGE_CAPACITY) {
            this.activeHiveCount--;
        }
        const lastIndex = this.activeCount - 1;
        this.indexByHandleKey.delete(key);
        if (index !== lastIndex) {
            const oldLastKey = `${this.entityIds[lastIndex]}:${this.incarnations[lastIndex]}`;
            for (const array of [
                this.entityIds,
                this.incarnations,
                this.definitionCodes,
                this.coordinateSystemCodes,
                this.policyCodes,
                this.memberCounts,
                this.occupiedSlotMasks,
                this.rotationSteps,
                this.generations,
                this.lineageHashes,
                this.prepareSequences
            ]) {
                array[index] = array[lastIndex];
            }
            const destinationOffset = index * LINEAGE_CAPACITY;
            const sourceOffset = lastIndex * LINEAGE_CAPACITY;
            for (let memberIndex = 0;
                memberIndex < LINEAGE_CAPACITY;
                memberIndex++) {
                this.lineageEntityIds[destinationOffset + memberIndex]
                    = this.lineageEntityIds[sourceOffset + memberIndex];
                this.lineageIncarnations[destinationOffset + memberIndex]
                    = this.lineageIncarnations[sourceOffset + memberIndex];
            }
            this.indexByHandleKey.delete(oldLastKey);
            this.indexByHandleKey.set(
                `${this.entityIds[index]}:${this.incarnations[index]}`,
                index
            );
        }
        this.activeCount--;
        return true;
    }

    #copyLineage(index) {
        const result = [];
        const offset = index * LINEAGE_CAPACITY;
        for (let memberIndex = 0;
            memberIndex < this.memberCounts[index];
            memberIndex++) {
            result.push(Object.freeze({
                entityId: this.lineageEntityIds[offset + memberIndex],
                incarnation: this.lineageIncarnations[offset + memberIndex]
            }));
        }
        return result;
    }

    #assertPreparedState(result, index, label) {
        if (result.memberCount !== this.memberCounts[index]
            || result.occupiedSlotMask !== this.occupiedSlotMasks[index]
            || result.rotationStep !== this.rotationSteps[index]
            || result.generation !== this.generations[index]
            || result.lineageHash !== this.lineageHashes[index]
            || result.definitionCode !== this.definitionCodes[index]
            || result.coordinateSystemCode !== this.coordinateSystemCodes[index]
            || result.policyCode !== this.policyCodes[index]) {
            throw new RangeError(`${label} prepared Formation state가 SoA roster와 다릅니다.`);
        }
    }

    #clearRoster() {
        this.activeCount = 0;
        this.activeHiveCount = 0;
        this.indexByHandleKey.clear();
        this.entityIds.fill(0);
        this.incarnations.fill(0);
        this.definitionCodes.fill(0);
        this.coordinateSystemCodes.fill(0);
        this.policyCodes.fill(0);
        this.memberCounts.fill(0);
        this.occupiedSlotMasks.fill(0);
        this.rotationSteps.fill(0);
        this.generations.fill(0);
        this.lineageHashes.fill(0);
        this.prepareSequences.fill(0);
        this.nextPrepareCursor = 0;
        this.lineageEntityIds.fill(0);
        this.lineageIncarnations.fill(0);
    }

    #fail(code, detail = null) {
        this.recoveryRequired = true;
        this.failure = Object.freeze({
            code,
            detail: detail === null ? null : String(detail)
        });
        return this.getStatus();
    }
}
