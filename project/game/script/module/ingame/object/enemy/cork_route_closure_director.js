import {
    ROUTE_AVAILABILITY_ABI_VERSION,
    ROUTE_AVAILABILITY_MAX_CORK_ROSTER,
    createAllOpenRouteAvailabilitySelectionSnapshot,
    normalizeRouteAvailabilitySelectionSnapshot
} from '../../contract/route_availability_contract.js';

const UINT32_SENTINEL = 0xffffffff;
const REPLAY_HISTORY_CAPACITY = 32;
const COMPLETION_RECORD_CAPACITY = 32;

function requirePositiveUint32(value, label) {
    if (!Number.isSafeInteger(value) || value <= 0 || value >= UINT32_SENTINEL) {
        throw new RangeError(`${label}은 positive non-sentinel uint32여야 합니다.`);
    }
    return value;
}

function requireUint32(value, label) {
    if (!Number.isSafeInteger(value) || value < 0 || value > UINT32_SENTINEL) {
        throw new RangeError(`${label}은 uint32여야 합니다.`);
    }
    return value;
}

function requireNonSentinelUint32(value, label) {
    const normalized = requireUint32(value, label);
    if (normalized === UINT32_SENTINEL) {
        throw new RangeError(`${label}은 reserved sentinel이 아니어야 합니다.`);
    }
    return normalized;
}

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

function normalizeHandle(source, label) {
    return Object.freeze({
        entityId: requirePositiveUint32(source?.entityId, `${label}.entityId`),
        incarnation: requirePositiveUint32(
            source?.incarnation,
            `${label}.incarnation`
        )
    });
}

function handleKey(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

function sameHandle(left, right) {
    return left?.entityId === right?.entityId
        && left?.incarnation === right?.incarnation;
}

function isDenseArray(source) {
    for (let index = 0; index < source.length; index++) {
        if (!Object.prototype.hasOwnProperty.call(source, index)) {
            return false;
        }
    }
    return true;
}

function createCompletionReplaySignature(snapshot) {
    const snapshotRecord = (record) => Object.freeze([
        record?.ownerHandle?.entityId,
        record?.ownerHandle?.incarnation,
        record?.routeSetId,
        record?.pathId,
        record?.closureId,
        record?.leaseGeneration,
        record?.sourceTick,
        record?.availabilityVersion
    ]);
    return JSON.stringify([
        snapshot.completedThroughTick,
        snapshot.availabilityVersion,
        snapshot.closedPathIds,
        snapshot.assignments.map(snapshotRecord),
        snapshot.closures.map(snapshotRecord),
        snapshot.reopens.map(snapshotRecord),
        snapshot.cleanups.map(snapshotRecord)
    ]);
}

function snapshotRouteGraph(routeGraph) {
    if (!routeGraph
        || !Array.isArray(routeGraph.routeSets)
        || !Array.isArray(routeGraph.closures)) {
        throw new TypeError('CorkRouteClosureDirector에는 normalized routeGraph가 필요합니다.');
    }
    return routeGraph;
}

function createGraphLookup(routeGraph) {
    const routeSetById = new Map();
    const routeSetIdByPathId = new Map();
    for (const routeSet of routeGraph.routeSets) {
        routeSetById.set(routeSet.id, routeSet);
        for (const candidate of routeSet.candidates) {
            if (routeSetIdByPathId.has(candidate.pathId)) {
                throw new RangeError(
                    `Cork route path는 하나의 routeSet에만 속해야 합니다: ${candidate.pathId}`
                );
            }
            routeSetIdByPathId.set(candidate.pathId, routeSet.id);
        }
    }
    const closureById = new Map();
    for (const closure of routeGraph.closures) {
        if (closureById.has(closure.id)) {
            throw new RangeError(`Cork closure ID가 중복되었습니다: ${closure.id}`);
        }
        closureById.set(closure.id, closure);
    }
    return Object.freeze({ routeSetById, routeSetIdByPathId, closureById });
}

/**
 * GPU RouteRuntime의 authenticated assignment/close/reopen/cleanup completion을
 * host availability/terminal mirror로만 유지합니다. Command 권위는 소유하지 않습니다.
 */
export class CorkRouteClosureDirector {
    constructor(options = {}) {
        this.routeGraph = snapshotRouteGraph(options.routeGraph);
        this.graphLookup = createGraphLookup(this.routeGraph);
        const graphContentKey = requireNonEmptyString(
            options.graphContentKey,
            'graphContentKey'
        );
        const sessionGeneration = requirePositiveUint32(
            options.sessionGeneration,
            'sessionGeneration'
        );
        const deviceGeneration = requireNonSentinelUint32(
            options.deviceGeneration,
            'deviceGeneration'
        );
        const authoritativeEpoch = requireNonSentinelUint32(
            options.authoritativeEpoch,
            'authoritativeEpoch'
        );
        this.graphContentKey = graphContentKey;
        this.sessionGeneration = sessionGeneration;
        this.deviceGeneration = deviceGeneration;
        this.authoritativeEpoch = authoritativeEpoch;
        this.capacity = options.capacity === undefined
            ? ROUTE_AVAILABILITY_MAX_CORK_ROSTER
            : requirePositiveUint32(options.capacity, 'capacity');
        if (this.capacity !== ROUTE_AVAILABILITY_MAX_CORK_ROSTER) {
            throw new RangeError(
                `Cork route roster capacity는 exact ${ROUTE_AVAILABILITY_MAX_CORK_ROSTER}이어야 합니다.`
            );
        }
        this.rosterByHandleKey = new Map();
        this.pendingAssignmentByHandleKey = new Map();
        this.pendingCleanupByHandleKey = new Map();
        this.completedFingerprintBySourceTick = new Map();
        this.lastLeaseGenerationByClosureId = new Map();
        this.availabilitySnapshot
            = createAllOpenRouteAvailabilitySelectionSnapshot(
                this.graphContentKey,
                1
            );
        this.lastSourceTick = 0;
        this.completedThroughTick = 0;
        this.lastFixedCommitTick = 0;
        this.lastLifecycleCommitTick = 0;
        this.pending = false;
        this.recoveryRequired = false;
        this.failure = null;
        this.ingressOpen = true;
        this.terminal = null;
        this.destroyed = false;
        if (options.runtimeStatus) {
            this.observeRuntimeStatus(options.runtimeStatus);
        }
    }

    observeCompletedPrograms(snapshot) {
        if (this.destroyed || !snapshot || typeof snapshot !== 'object') {
            return this.#fail('route-completion-snapshot-contract');
        }
        if (snapshot.protocolFailure) {
            return this.#fail(
                snapshot.protocolFailure.code ?? 'route-completion-protocol-failure'
            );
        }
        try {
            this.#assertAuthenticatedHeader(snapshot, 'routeCompletion');
            if (!Array.isArray(snapshot.assignments)
                || !Array.isArray(snapshot.closures)
                || !Array.isArray(snapshot.reopens)
                || !Array.isArray(snapshot.cleanups)) {
                throw new TypeError('route completion typed arrays가 필요합니다.');
            }
            const completionArrays = [
                snapshot.assignments,
                snapshot.closures,
                snapshot.reopens,
                snapshot.cleanups
            ];
            if (completionArrays.some((records) => !isDenseArray(records))) {
                throw new TypeError('route completion typed arrays는 dense여야 합니다.');
            }
            const sourceTick = requireNonSentinelUint32(
                snapshot.sourceTick,
                'routeCompletion.sourceTick'
            );
            const completedThroughTick = requireNonSentinelUint32(
                snapshot.completedThroughTick,
                'routeCompletion.completedThroughTick'
            );
            const batchIdFingerprint = requireNonSentinelUint32(
                snapshot.batchIdFingerprint,
                'routeCompletion.batchIdFingerprint'
            );
            if (snapshot.availabilityVersion
                < this.availabilitySnapshot.availabilityVersion) {
                throw new RangeError(
                    'route completion availability version이 회귀했습니다.'
                );
            }
            if (snapshot.pending !== false
                || requireUint32(snapshot.status, 'routeCompletion.status') !== 0
                || requireUint32(
                    snapshot.errorFlags,
                    'routeCompletion.errorFlags'
                ) !== 0
                || sourceTick > completedThroughTick) {
                throw new RangeError('route completion success header가 올바르지 않습니다.');
            }
            const recordCount = snapshot.assignments.length
                + snapshot.closures.length
                + snapshot.reopens.length
                + snapshot.cleanups.length;
            if (recordCount > COMPLETION_RECORD_CAPACITY) {
                throw new RangeError('route completion record capacity를 초과했습니다.');
            }
            if (sourceTick === 0 || batchIdFingerprint === 0) {
                if (recordCount !== 0
                    || sourceTick !== 0
                    || batchIdFingerprint !== 0) {
                    throw new RangeError(
                        'idle route completion은 source/fingerprint/records가 모두 0이어야 합니다.'
                    );
                }
            } else {
                const replaySignature = createCompletionReplaySignature(snapshot);
                const knownReplay = this.completedFingerprintBySourceTick.get(
                    sourceTick
                );
                if (knownReplay !== undefined) {
                    if (knownReplay.batchIdFingerprint !== batchIdFingerprint
                        || knownReplay.signature !== replaySignature) {
                        throw new RangeError(
                            'route completion replay proof가 exact snapshot과 충돌합니다.'
                        );
                    }
                    return Object.freeze({
                        accepted: true,
                        replayed: true,
                        recordCount,
                        availabilityVersion:
                            this.availabilitySnapshot.availabilityVersion
                    });
                }
                if (sourceTick < this.lastSourceTick) {
                    throw new RangeError('route completion source tick이 회귀했습니다.');
                }
            }
            const availabilityMutationCount = snapshot.assignments.length
                + snapshot.closures.length
                + snapshot.reopens.length;
            const expectedAvailabilityVersion
                = this.availabilitySnapshot.availabilityVersion
                    + availabilityMutationCount;
            if (expectedAvailabilityVersion >= UINT32_SENTINEL
                || snapshot.availabilityVersion
                    !== expectedAvailabilityVersion) {
                throw new RangeError(
                    'route completion availability version delta가 action cardinality와 다릅니다.'
                );
            }

            const nextRoster = new Map(this.rosterByHandleKey);
            const nextPendingAssignments = new Map(
                this.pendingAssignmentByHandleKey
            );
            const nextPendingCleanups = new Map(this.pendingCleanupByHandleKey);
            const nextLastLeaseGenerationByClosureId = new Map(
                this.lastLeaseGenerationByClosureId
            );
            const seenByAction = new Map();
            const actionsByHandleKey = new Map();
            const mutationAvailabilityVersions = new Set();
            const normalizeRecord = (record, action, index) => {
                const label = `${action}[${index}]`;
                const ownerHandle = normalizeHandle(record?.ownerHandle, `${label}.ownerHandle`);
                const key = handleKey(ownerHandle);
                let seen = seenByAction.get(action);
                if (!seen) {
                    seen = new Set();
                    seenByAction.set(action, seen);
                }
                if (seen.has(key)) {
                    throw new RangeError(`${action} completion owner가 중복되었습니다.`);
                }
                seen.add(key);
                let actions = actionsByHandleKey.get(key);
                if (!actions) {
                    actions = new Set();
                    actionsByHandleKey.set(key, actions);
                }
                actions.add(action);
                const routeSetId = requireNonEmptyString(
                    record.routeSetId,
                    `${label}.routeSetId`
                );
                const pathId = requireNonEmptyString(record.pathId, `${label}.pathId`);
                const closureId = requireNonEmptyString(
                    record.closureId,
                    `${label}.closureId`
                );
                const closure = this.graphLookup.closureById.get(closureId);
                if (!this.graphLookup.routeSetById.has(routeSetId)
                    || this.graphLookup.routeSetIdByPathId.get(pathId) !== routeSetId
                    || closure?.pathId !== pathId) {
                    throw new RangeError(`${label} route/closure identity가 graph와 다릅니다.`);
                }
                const leaseGeneration = requirePositiveUint32(
                    record.leaseGeneration,
                    `${label}.leaseGeneration`
                );
                if (requireUint32(record.sourceTick, `${label}.sourceTick`)
                    !== sourceTick) {
                    throw new RangeError(`${label}.sourceTick이 header와 다릅니다.`);
                }
                const availabilityVersion = requirePositiveUint32(
                    record.availabilityVersion,
                    `${label}.availabilityVersion`
                );
                if (availabilityVersion > snapshot.availabilityVersion) {
                    throw new RangeError(`${label}.availabilityVersion이 header를 앞섭니다.`);
                }
                if (action !== 'cleanups') {
                    if (availabilityVersion
                            <= this.availabilitySnapshot.availabilityVersion
                        || mutationAvailabilityVersions.has(availabilityVersion)) {
                        throw new RangeError(
                            `${label}.availabilityVersion이 mutation 순번과 다릅니다.`
                        );
                    }
                    mutationAvailabilityVersions.add(availabilityVersion);
                } else if (availabilityVersion
                    < this.availabilitySnapshot.availabilityVersion) {
                    throw new RangeError(
                        `${label}.availabilityVersion이 cleanup base보다 과거입니다.`
                    );
                }
                return Object.freeze({
                    ownerHandle,
                    key,
                    routeSetId,
                    pathId,
                    closureId,
                    leaseGeneration,
                    availabilityVersion,
                    sourceTick
                });
            };

            snapshot.assignments.forEach((record, index) => {
                const normalized = normalizeRecord(record, 'assignments', index);
                const pendingHandle = nextPendingAssignments.get(
                    normalized.key
                );
                if (nextRoster.has(normalized.key)
                    || !sameHandle(pendingHandle, normalized.ownerHandle)) {
                    throw new RangeError(
                        'route assignment owner가 lifecycle spawn roster와 다릅니다.'
                    );
                }
                const lastLeaseGeneration
                    = nextLastLeaseGenerationByClosureId.get(
                        normalized.closureId
                    );
                if (lastLeaseGeneration !== undefined
                    && normalized.leaseGeneration <= lastLeaseGeneration) {
                    throw new RangeError(
                        'route assignment lease generation이 closure ABA history를 전진하지 않았습니다.'
                    );
                }
                nextLastLeaseGenerationByClosureId.set(
                    normalized.closureId,
                    normalized.leaseGeneration
                );
                nextRoster.set(normalized.key, Object.freeze({
                    ...normalized,
                    closed: false,
                    reopened: false
                }));
                nextPendingAssignments.delete(normalized.key);
            });
            snapshot.closures.forEach((record, index) => {
                const normalized = normalizeRecord(record, 'closures', index);
                const current = nextRoster.get(normalized.key);
                this.#assertSameLease(current, normalized, 'closure');
                if (current.closed || current.reopened) {
                    throw new RangeError('route closure가 중복 적용되었습니다.');
                }
                nextRoster.set(normalized.key, Object.freeze({
                    ...current,
                    availabilityVersion: normalized.availabilityVersion,
                    sourceTick,
                    closed: true,
                    reopened: false
                }));
            });
            snapshot.reopens.forEach((record, index) => {
                const normalized = normalizeRecord(record, 'reopens', index);
                const current = nextRoster.get(normalized.key)
                    ?? nextPendingCleanups.get(normalized.key);
                this.#assertSameLease(current, normalized, 'reopen');
                if (current.reopened) {
                    throw new RangeError('route reopen은 active lease에 한 번만 가능합니다.');
                }
                const reopened = Object.freeze({
                    ...current,
                    availabilityVersion: normalized.availabilityVersion,
                    sourceTick,
                    closed: false,
                    reopened: true
                });
                if (nextPendingCleanups.has(normalized.key)) {
                    nextPendingCleanups.set(normalized.key, reopened);
                } else {
                    nextRoster.set(normalized.key, reopened);
                }
            });
            snapshot.cleanups.forEach((record, index) => {
                const normalized = normalizeRecord(record, 'cleanups', index);
                const current = nextPendingCleanups.get(
                    normalized.key
                );
                this.#assertSameLease(current, normalized, 'cleanup');
                if (current.closed && !current.reopened) {
                    throw new RangeError('closed route owner cleanup 전에 reopen이 필요합니다.');
                }
                nextPendingCleanups.delete(normalized.key);
            });
            for (const actions of actionsByHandleKey.values()) {
                if (actions.size > 1
                    && !(actions.size === 2
                        && actions.has('reopens')
                        && actions.has('cleanups'))) {
                    throw new RangeError(
                        '한 route owner의 same-snapshot action 조합이 canonical하지 않습니다.'
                    );
                }
            }
            for (let availabilityVersion
                    = this.availabilitySnapshot.availabilityVersion + 1;
                availabilityVersion <= snapshot.availabilityVersion;
                availabilityVersion++) {
                if (!mutationAvailabilityVersions.has(availabilityVersion)) {
                    throw new RangeError(
                        'route completion mutation availability version이 연속적이지 않습니다.'
                    );
                }
            }
            if (nextRoster.size + nextPendingAssignments.size > this.capacity) {
                throw new RangeError('Cork route completion roster capacity를 초과했습니다.');
            }
            const nextAvailability = normalizeRouteAvailabilitySelectionSnapshot(
                {
                    graphContentKey: snapshot.graphContentKey,
                    availabilityVersion: snapshot.availabilityVersion,
                    closedPathIds: snapshot.closedPathIds
                },
                this.routeGraph,
                'routeCompletion.availability'
            );
            const derivedClosedPaths = new Set();
            const activeLeaseOwnerByClosureId = new Map();
            const activeEntries = [
                ...nextRoster.values(),
                ...nextPendingCleanups.values()
            ];
            for (const entry of activeEntries) {
                if (!entry.reopened) {
                    if (activeLeaseOwnerByClosureId.has(entry.closureId)) {
                        throw new RangeError(
                            'route closure exact active lease owner가 중복되었습니다.'
                        );
                    }
                    activeLeaseOwnerByClosureId.set(entry.closureId, entry.ownerHandle);
                }
                if (entry.closed && !entry.reopened) {
                    if (derivedClosedPaths.has(entry.pathId)) {
                        throw new RangeError('closed path exact owner가 중복되었습니다.');
                    }
                    derivedClosedPaths.add(entry.pathId);
                }
            }
            if (derivedClosedPaths.size !== nextAvailability.closedPathIds.length
                || nextAvailability.closedPathIds.some(
                    (pathId) => !derivedClosedPaths.has(pathId)
                )) {
                throw new RangeError('route completion roster와 closedPathIds가 다릅니다.');
            }

            this.rosterByHandleKey = nextRoster;
            this.pendingAssignmentByHandleKey = nextPendingAssignments;
            this.pendingCleanupByHandleKey = nextPendingCleanups;
            this.lastLeaseGenerationByClosureId
                = nextLastLeaseGenerationByClosureId;
            this.availabilitySnapshot = nextAvailability;
            this.pending = snapshot.pending === true;
            this.completedThroughTick = Math.max(
                this.completedThroughTick,
                completedThroughTick
            );
            if (sourceTick > 0) {
                this.lastSourceTick = sourceTick;
                this.completedFingerprintBySourceTick.set(
                    sourceTick,
                    Object.freeze({
                        batchIdFingerprint,
                        signature: createCompletionReplaySignature(snapshot)
                    })
                );
                while (this.completedFingerprintBySourceTick.size
                    > REPLAY_HISTORY_CAPACITY) {
                    const oldest = this.completedFingerprintBySourceTick.keys().next().value;
                    this.completedFingerprintBySourceTick.delete(oldest);
                }
            }
            this.#refreshTerminalSeal();
            return Object.freeze({
                accepted: true,
                replayed: false,
                recordCount,
                rosterCount: this.rosterByHandleKey.size,
                availabilityVersion: this.availabilitySnapshot.availabilityVersion
            });
        } catch (error) {
            return this.#fail('route-completion-validation', error?.message);
        }
    }

    observeRuntimeStatus(status) {
        if (this.destroyed || !status || typeof status !== 'object') {
            return this.#fail('route-runtime-status-contract');
        }
        try {
            this.#assertAuthenticatedHeader(status, 'routeRuntimeStatus');
            if (status.requiresRecovery === true || status.failure) {
                throw new RangeError('route runtime status가 recovery를 요구합니다.');
            }
            const availability = normalizeRouteAvailabilitySelectionSnapshot(
                status,
                this.routeGraph,
                'routeRuntimeStatus.availability'
            );
            if (availability.availabilityVersion
                    !== this.availabilitySnapshot.availabilityVersion
                || availability.closedPathIds.length
                    !== this.availabilitySnapshot.closedPathIds.length
                || availability.closedPathIds.some(
                    (pathId, index) => (
                        pathId !== this.availabilitySnapshot.closedPathIds[index]
                    )
                )) {
                throw new RangeError(
                    'route runtime availability가 authenticated completion mirror와 다릅니다.'
                );
            }
            const rosterCount = requireUint32(
                status.rosterCount,
                'routeRuntimeStatus.rosterCount'
            );
            const stagedCount = requireUint32(
                status.stagedCount,
                'routeRuntimeStatus.stagedCount'
            );
            const pendingReadbackCount = requireUint32(
                status.pendingReadbackCount,
                'routeRuntimeStatus.pendingReadbackCount'
            );
            const leaseCount = requireUint32(
                status.leaseCount,
                'routeRuntimeStatus.leaseCount'
            );
            if (status.capacity !== this.capacity
                || typeof status.commitRequested !== 'boolean'
                || typeof status.ingressOpen !== 'boolean'
                || rosterCount > this.capacity
                || rosterCount !== this.#getLogicalRosterCount()
                || leaseCount !== this.rosterByHandleKey.size
                    + this.pendingCleanupByHandleKey.size) {
                throw new RangeError('route runtime/Director roster cardinality가 다릅니다.');
            }
            this.availabilitySnapshot = availability;
            this.pending = stagedCount > 0
                || status.commitRequested === true
                || pendingReadbackCount > 0;
            this.completedThroughTick = Math.max(
                this.completedThroughTick,
                requireUint32(
                    status.completedThroughTick,
                    'routeRuntimeStatus.completedThroughTick'
                )
            );
            this.#refreshTerminalSeal();
            return this.getStatus();
        } catch (error) {
            return this.#fail('route-runtime-status-validation', error?.message);
        }
    }

    observeFixedCommit(commit, fixedTick) {
        try {
            const tick = requirePositiveUint32(fixedTick, 'fixedTick');
            if (!commit || commit.fixedTick !== tick || tick < this.lastFixedCommitTick) {
                throw new RangeError('route fixed commit contract가 다릅니다.');
            }
            this.lastFixedCommitTick = tick;
            this.#refreshTerminalSeal();
            return this.getStatus();
        } catch (error) {
            return this.#fail('route-fixed-commit-validation', error?.message);
        }
    }

    observeLifecycle(commit, fixedTick = commit?.fixedTick) {
        try {
            const tick = requirePositiveUint32(fixedTick, 'fixedTick');
            if (!commit
                || commit.fixedTick !== tick
                || tick < this.lastLifecycleCommitTick) {
                throw new RangeError('route lifecycle commit contract가 다릅니다.');
            }
            const routeLifecycle = commit.routeLifecycle;
            if (!Array.isArray(routeLifecycle)) {
                throw new TypeError('route lifecycle result array가 필요합니다.');
            }
            const entries = routeLifecycle.filter((entry) => (
                entry?.targetFixedTick === tick
            ));
            if (entries.length !== routeLifecycle.length) {
                throw new RangeError('route lifecycle result fixed tick이 다릅니다.');
            }
            if ((entries.length === 0) !== (commit.routeRuntimeBinding === null)) {
                throw new RangeError(
                    'route lifecycle delta와 runtime binding cardinality가 다릅니다.'
                );
            }
            if (entries.length > 0) {
                this.#observeLifecycleDelta(entries, commit.routeRuntimeBinding);
            }
            this.lastLifecycleCommitTick = tick;
            this.#refreshTerminalSeal();
            return this.getStatus();
        } catch (error) {
            return this.#fail('route-lifecycle-validation', error?.message);
        }
    }

    closeForTerminal(finalFixedTick, reason = 'run-defeated') {
        if (this.destroyed) {
            return null;
        }
        const tick = requirePositiveUint32(finalFixedTick, 'finalFixedTick');
        this.ingressOpen = false;
        this.terminal = Object.freeze({
            finalFixedTick: tick,
            reason: typeof reason === 'string' && reason.length > 0
                ? reason
                : 'run-defeated',
            fixedCommitObserved: this.lastFixedCommitTick === tick,
            lifecycleObserved: this.lastLifecycleCommitTick === tick,
            rosterSealed: false
        });
        this.#refreshTerminalSeal();
        return this.terminal;
    }

    resetGpuBinding(options = {}) {
        if (this.destroyed
            || this.recoveryRequired
            || this.terminal !== null
            || this.pending
            || this.rosterByHandleKey.size !== 0
            || this.pendingAssignmentByHandleKey.size !== 0
            || this.pendingCleanupByHandleKey.size !== 0
            || this.availabilitySnapshot.closedPathIds.length !== 0) {
            return false;
        }
        const graphContentKey = requireNonEmptyString(
            options.graphContentKey,
            'graphContentKey'
        );
        const sessionGeneration = requirePositiveUint32(
            options.sessionGeneration,
            'sessionGeneration'
        );
        const deviceGeneration = requireNonSentinelUint32(
            options.deviceGeneration,
            'deviceGeneration'
        );
        const authoritativeEpoch = requireNonSentinelUint32(
            options.authoritativeEpoch,
            'authoritativeEpoch'
        );
        const availabilityVersion = options.availabilityVersion === undefined
            ? 1
            : requirePositiveUint32(
                options.availabilityVersion,
                'availabilityVersion'
            );
        const tupleStrictlyAdvanced = deviceGeneration > this.deviceGeneration
            || (deviceGeneration === this.deviceGeneration
                && authoritativeEpoch > this.authoritativeEpoch);
        if (graphContentKey !== this.graphContentKey
            || sessionGeneration !== this.sessionGeneration
            || !tupleStrictlyAdvanced) {
            return false;
        }
        this.deviceGeneration = deviceGeneration;
        this.authoritativeEpoch = authoritativeEpoch;
        this.completedFingerprintBySourceTick.clear();
        this.lastLeaseGenerationByClosureId.clear();
        this.availabilitySnapshot
            = createAllOpenRouteAvailabilitySelectionSnapshot(
                graphContentKey,
                availabilityVersion
            );
        this.lastSourceTick = 0;
        this.completedThroughTick = 0;
        this.lastFixedCommitTick = 0;
        this.lastLifecycleCommitTick = 0;
        return true;
    }

    getAvailabilitySnapshot() {
        return this.availabilitySnapshot;
    }

    requiresRecovery() {
        return !this.destroyed && this.recoveryRequired;
    }

    getStatus() {
        return Object.freeze({
            graphContentKey: this.graphContentKey,
            sessionGeneration: this.sessionGeneration,
            deviceGeneration: this.deviceGeneration,
            authoritativeEpoch: this.authoritativeEpoch,
            availabilityVersion: this.availabilitySnapshot.availabilityVersion,
            closedPathIds: this.availabilitySnapshot.closedPathIds,
            rosterCount: this.#getLogicalRosterCount(),
            assignedLeaseCount: this.rosterByHandleKey.size,
            pendingAssignmentCount: this.pendingAssignmentByHandleKey.size,
            pendingCleanupCount: this.pendingCleanupByHandleKey.size,
            capacity: this.capacity,
            pending: this.pending,
            lastSourceTick: this.lastSourceTick,
            completedThroughTick: this.completedThroughTick,
            lastFixedCommitTick: this.lastFixedCommitTick,
            lastLifecycleCommitTick: this.lastLifecycleCommitTick,
            ingressOpen: this.ingressOpen,
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
        this.rosterByHandleKey.clear();
        this.pendingAssignmentByHandleKey.clear();
        this.pendingCleanupByHandleKey.clear();
        this.completedFingerprintBySourceTick.clear();
        this.lastLeaseGenerationByClosureId.clear();
        this.routeGraph = null;
        this.graphLookup = null;
        this.terminal = null;
    }

    #assertAuthenticatedHeader(snapshot, label) {
        if (snapshot.abiVersion !== ROUTE_AVAILABILITY_ABI_VERSION
            || requirePositiveUint32(
                snapshot.sessionGeneration,
                `${label}.sessionGeneration`
            ) !== this.sessionGeneration
            || requireNonSentinelUint32(
                snapshot.deviceGeneration,
                `${label}.deviceGeneration`
            ) !== this.deviceGeneration
            || requireNonSentinelUint32(
                snapshot.authoritativeEpoch,
                `${label}.authoritativeEpoch`
            ) !== this.authoritativeEpoch
            || requireNonEmptyString(
                snapshot.graphContentKey,
                `${label}.graphContentKey`
            ) !== this.graphContentKey) {
            throw new RangeError(`${label} authenticated tuple/content key가 다릅니다.`);
        }
        requirePositiveUint32(
            snapshot.availabilityVersion,
            `${label}.availabilityVersion`
        );
    }

    #assertSameLease(current, candidate, label) {
        if (!current
            || !sameHandle(current.ownerHandle, candidate.ownerHandle)
            || current.routeSetId !== candidate.routeSetId
            || current.pathId !== candidate.pathId
            || current.closureId !== candidate.closureId
            || current.leaseGeneration !== candidate.leaseGeneration) {
            throw new RangeError(`${label} completion exact lease가 roster와 다릅니다.`);
        }
    }

    #observeLifecycleDelta(entries, binding) {
        this.#assertAuthenticatedBinding(binding, 'routeRuntimeBinding');
        if (binding.availabilityVersion
            !== this.availabilitySnapshot.availabilityVersion) {
            throw new RangeError(
                'route lifecycle은 availability version을 직접 바꿀 수 없습니다.'
            );
        }
        const nextRoster = new Map(this.rosterByHandleKey);
        const nextPendingAssignments = new Map(
            this.pendingAssignmentByHandleKey
        );
        const nextPendingCleanups = new Map(this.pendingCleanupByHandleKey);
        const seen = new Set();
        for (let index = 0; index < entries.length; index++) {
            const entry = entries[index];
            const handle = normalizeHandle(
                entry?.handle,
                `routeLifecycle[${index}].handle`
            );
            const key = handleKey(handle);
            if (seen.has(key)) {
                throw new RangeError('한 lifecycle 결과에 route owner가 중복되었습니다.');
            }
            seen.add(key);
            requirePositiveUint32(
                entry.commandIdFingerprint,
                `routeLifecycle[${index}].commandIdFingerprint`
            );
            requirePositiveUint32(
                entry.batchIdFingerprint,
                `routeLifecycle[${index}].batchIdFingerprint`
            );
            if (typeof entry.commandId !== 'string' || entry.commandId.length === 0) {
                throw new TypeError(`routeLifecycle[${index}].commandId가 필요합니다.`);
            }
            if (entry.action === 'spawn') {
                if (nextRoster.has(key)
                    || nextPendingAssignments.has(key)
                    || nextPendingCleanups.has(key)) {
                    throw new RangeError('route spawn owner identity가 이미 사용 중입니다.');
                }
                nextPendingAssignments.set(key, handle);
                continue;
            }
            if (entry.action !== 'cleanup') {
                throw new RangeError('알 수 없는 route lifecycle action입니다.');
            }
            const current = nextRoster.get(key);
            const pendingAssignment = nextPendingAssignments.get(key);
            if (nextPendingCleanups.has(key)
                || (current === undefined && pendingAssignment === undefined)
                || (current !== undefined
                    && !sameHandle(current.ownerHandle, handle))
                || (pendingAssignment !== undefined
                    && !sameHandle(pendingAssignment, handle))
                || (current !== undefined && pendingAssignment !== undefined)) {
                throw new RangeError(
                    'route cleanup은 exact active lease만 허용합니다.'
                );
            }
            if (current) {
                nextRoster.delete(key);
                nextPendingCleanups.set(key, current);
            } else {
                // SELECT_ROUTE duplicate-wait owner는 아직 GPU lease/action이 없으므로
                // authenticated lifecycle cleanup 자체가 exact no-op publication proof입니다.
                nextPendingAssignments.delete(key);
            }
        }
        const logicalRosterCount = nextRoster.size
            + nextPendingAssignments.size;
        if (logicalRosterCount !== binding.rosterCount
            || logicalRosterCount > this.capacity) {
            throw new RangeError('route lifecycle roster delta가 runtime binding과 다릅니다.');
        }
        this.rosterByHandleKey = nextRoster;
        this.pendingAssignmentByHandleKey = nextPendingAssignments;
        this.pendingCleanupByHandleKey = nextPendingCleanups;
        this.sessionGeneration = binding.sessionGeneration;
        this.deviceGeneration = binding.deviceGeneration;
        this.authoritativeEpoch = binding.authoritativeEpoch;
    }

    #assertAuthenticatedBinding(binding, label) {
        if (!binding || typeof binding !== 'object' || Array.isArray(binding)
            || binding.abiVersion !== ROUTE_AVAILABILITY_ABI_VERSION
            || requirePositiveUint32(
                binding.sessionGeneration,
                `${label}.sessionGeneration`
            ) !== this.sessionGeneration
            || requireNonEmptyString(
                binding.graphContentKey,
                `${label}.graphContentKey`
            ) !== this.graphContentKey) {
            throw new RangeError(`${label} tuple/content key가 다릅니다.`);
        }
        const nextDeviceGeneration = requireNonSentinelUint32(
            binding.deviceGeneration,
            `${label}.deviceGeneration`
        );
        const nextAuthoritativeEpoch = requireNonSentinelUint32(
            binding.authoritativeEpoch,
            `${label}.authoritativeEpoch`
        );
        if (nextDeviceGeneration !== this.deviceGeneration
            || nextAuthoritativeEpoch !== this.authoritativeEpoch) {
            throw new RangeError(`${label} device/epoch tuple이 현재 binding과 다릅니다.`);
        }
        requirePositiveUint32(
            binding.availabilityVersion,
            `${label}.availabilityVersion`
        );
        const rosterCount = requireUint32(
            binding.rosterCount,
            `${label}.rosterCount`
        );
        if (rosterCount > this.capacity) {
            throw new RangeError(`${label}.rosterCount가 capacity를 초과했습니다.`);
        }
    }

    #getLogicalRosterCount() {
        return this.rosterByHandleKey.size
            + this.pendingAssignmentByHandleKey.size;
    }

    #refreshTerminalSeal() {
        if (!this.terminal) {
            return;
        }
        const fixedCommitObserved = this.lastFixedCommitTick
            === this.terminal.finalFixedTick;
        const lifecycleObserved = this.lastLifecycleCommitTick
            === this.terminal.finalFixedTick;
        const rosterSealed = fixedCommitObserved
            && lifecycleObserved
            && !this.pending
            && this.rosterByHandleKey.size === 0
            && this.pendingAssignmentByHandleKey.size === 0
            && this.pendingCleanupByHandleKey.size === 0
            && this.availabilitySnapshot.closedPathIds.length === 0
            && this.completedThroughTick >= this.terminal.finalFixedTick;
        this.terminal = Object.freeze({
            ...this.terminal,
            fixedCommitObserved,
            lifecycleObserved,
            rosterSealed
        });
    }

    #fail(code, message = null) {
        this.recoveryRequired = true;
        this.failure = Object.freeze({
            code,
            ...(typeof message === 'string' && message.length > 0
                ? { message }
                : null)
        });
        return Object.freeze({
            accepted: false,
            reason: code,
            recoveryRequired: true
        });
    }
}
