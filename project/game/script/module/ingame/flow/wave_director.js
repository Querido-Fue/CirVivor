import {
    INGAME_ENEMY_DEFINITION_BY_ID
} from 'data/object/enemy/basic_circle_enemy_data.js';
import {
    CORRIDOR_EIGHT_WAVE_01_DATA
} from 'data/scene/game/corridor_eight_wave_01_data.js';
import {
    ENEMY_SPAWN_POLICY,
    normalizeEnemyDefinition
} from '../contract/enemy_profile_contract.js';
import {
    ENEMY_PROFILE_CATALOG
} from 'data/object/enemy/enemy_profile_catalog_data.js';
import {
    assertGpuEnemyDefinitionCapabilities,
    createGpuEnemySpawnIntent
} from '../object/enemy/gpu_enemy_spawn_adapter.js';
import {
    normalizeEnemyModifierSet,
    resolveEnemySpawnStats
} from '../object/enemy/resolved_enemy_spawn_stats.js';
import {
    AUTHORED_WAVE_COMPILE_LIMIT,
    compileAuthoredWaveTimeline
} from './authored_wave_timeline_contract.js';
import {
    normalizeRouteAvailabilitySelectionSnapshot,
    selectOpenRoutePathId
} from '../contract/route_availability_contract.js';

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

function requireNonNegativeSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
        throw new RangeError(`${label}은 0 이상의 안전한 정수여야 합니다.`);
    }
    return number;
}

function requirePositiveSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
        throw new RangeError(`${label}은 양의 안전한 정수여야 합니다.`);
    }
    return number;
}

function snapshotEnemyDefinition(source, label) {
    if (!source || typeof source !== 'object') {
        throw new TypeError(`${label} enemy definition이 필요합니다.`);
    }
    const definition = normalizeEnemyDefinition({
        id: source.id,
        spawnPolicy: source.spawnPolicy,
        shapeDefinitionId: source.shapeDefinitionId,
        physicsProfileId: source.physicsProfileId,
        combatProfileId: source.combatProfileId,
        behaviorProfileId: source.behaviorProfileId,
        routeClosureProfileId: source.routeClosureProfileId,
        effectEmitterProfileId: source.effectEmitterProfileId,
        formationDefinitionId: source.formationDefinitionId,
        atomicTransformProfileId: source.atomicTransformProfileId,
        projectileCaptureProfileId: source.projectileCaptureProfileId,
        capabilityIds: source.capabilityIds,
        render: source.render
    }, ENEMY_PROFILE_CATALOG, label);
    if (definition.spawnPolicy === ENEMY_SPAWN_POLICY.NATURAL) {
        assertGpuEnemyDefinitionCapabilities(definition);
    }
    return definition;
}

/**
 * @class WaveDirector
 * @description fixed tick schedule을 stable GPU enemy spawn command로 변환합니다.
 * 이번 단계는 spawn scheduling까지만 소유하며 arrival/death/completion은 확정하지 않습니다.
 */
export class WaveDirector {
    /**
     * @param {{waveDefinition?:object,enemyDefinitions?:object,fixedTickOffset?:number}} [options={}]
     */
    constructor(options = {}) {
        this.waveDefinition = options.waveDefinition ?? CORRIDOR_EIGHT_WAVE_01_DATA;
        this.enemyDefinitions = options.enemyDefinitions ?? INGAME_ENEMY_DEFINITION_BY_ID;
        this.fixedTickOffset = requireNonNegativeSafeInteger(
            options.fixedTickOffset ?? 0,
            'fixedTickOffset'
        );
        this.schedule = Object.freeze([]);
        this.nextScheduleIndex = 0;
        this.queuedSpawnCount = 0;
        this.blockedEntries = [];
        this.routePathByGroupId = new Map();
        this.routeByPathId = new Map();
        this.routeGraph = null;
        this.lastRouteAvailabilityVersion = null;
        this.lastRouteAvailabilitySnapshot = null;
        this.knownEnemyDefinitionIds = Object.freeze(
            Object.keys(this.enemyDefinitions)
        );
        this.initializedWaveId = null;
        this.initialized = false;
        this.destroyed = false;
    }

    /** 실제 TileMap route와 immutable spawn input만 결정적으로 컴파일합니다. */
    init(tileMap) {
        if (this.initialized || this.destroyed) {
            return false;
        }
        if (!tileMap || typeof tileMap.getSpawnRoutes !== 'function') {
            throw new TypeError('WaveDirector에는 spawn route source가 필요합니다.');
        }
        const definition = this.waveDefinition;
        const waveId = requireNonEmptyString(definition?.waveId, 'waveId');
        const waveMapId = requireNonEmptyString(definition?.mapId, 'wave.mapId');
        if (typeof tileMap.mapId === 'string' && tileMap.mapId !== waveMapId) {
            throw new RangeError(
                `현재 map과 WaveDefinition mapId가 다릅니다: ${tileMap.mapId}/${waveMapId}`
            );
        }
        const mapEnemyModifiers = normalizeEnemyModifierSet(
            typeof tileMap.getEnemyModifiers === 'function'
                ? tileMap.getEnemyModifiers()
                : undefined,
            {
                label: 'mapEnemyModifiers',
                knownDefinitionIds: this.knownEnemyDefinitionIds
            }
        );
        const waveEnemyModifiers = normalizeEnemyModifierSet(
            definition.enemyModifiers,
            {
                label: 'waveEnemyModifiers',
                knownDefinitionIds: this.knownEnemyDefinitionIds
            }
        );

        const schedule = compileAuthoredWaveTimeline({
            waveId,
            timeline: definition.timeline,
            fixedTickOffset: this.fixedTickOffset,
            tileMap,
            resolveEnemyDefinition: (definitionId, label) => {
                const source = this.enemyDefinitions[definitionId];
                if (!source) {
                    throw new RangeError(
                        `등록되지 않은 enemy definition입니다: ${definitionId}`
                    );
                }
                return snapshotEnemyDefinition(source, label);
            }
        });
        this.schedule = Object.freeze(schedule.map((entry) => {
            return Object.freeze({
                ...entry,
                mapEnemyModifiers,
                waveEnemyModifiers
            });
        }));
        const spawnRoutes = tileMap.getSpawnRoutes();
        this.routeByPathId = new Map();
        for (const route of spawnRoutes) {
            if (this.routeByPathId.has(route.pathId)) {
                throw new RangeError(`WaveDirector pathId가 중복되었습니다: ${route.pathId}`);
            }
            this.routeByPathId.set(route.pathId, route);
        }
        this.routeGraph = typeof tileMap.getRouteGraph === 'function'
            ? tileMap.getRouteGraph()
            : null;
        this.nextScheduleIndex = 0;
        this.queuedSpawnCount = 0;
        this.blockedEntries = [];
        this.routePathByGroupId.clear();
        this.lastRouteAvailabilityVersion = null;
        this.lastRouteAvailabilitySnapshot = null;
        this.initializedWaveId = waveId;
        this.initialized = true;
        return true;
    }

    /**
     * 해당 proposed fixed tick의 spawn만 command owner에 보냅니다.
     * @returns {number} 새로 queue한 command 수입니다.
     */
    queueSpawnsForFixedTick(
        fixedTick,
        commandOwner,
        routeAvailabilitySnapshot = null
    ) {
        if (!this.initialized || this.destroyed) {
            return 0;
        }
        const tick = requirePositiveSafeInteger(fixedTick, 'fixedTick');
        if (!commandOwner || typeof commandOwner.requestSpawnBatch !== 'function') {
            throw new TypeError(
                'WaveDirector에는 atomic enemy requestSpawnBatch() sink가 필요합니다.'
            );
        }
        const entries = [...this.blockedEntries];
        let nextScheduleIndex = this.nextScheduleIndex;
        while (nextScheduleIndex < this.schedule.length) {
            const entry = this.schedule[nextScheduleIndex];
            if (entry.targetFixedTick > tick) {
                break;
            }
            entries.push(entry);
            nextScheduleIndex++;
        }
        if (entries.length === 0) {
            return 0;
        }
        entries.sort((left, right) => (
            left.targetFixedTick - right.targetFixedTick
            || left.spawnSequence - right.spawnSequence
        ));

        const requiresRouteAvailability = entries.some(
            (entry) => entry.routeSetId !== null
        );
        const normalizedAvailability = requiresRouteAvailability
            ? normalizeRouteAvailabilitySelectionSnapshot(
                routeAvailabilitySnapshot,
                this.routeGraph,
                'WaveDirector.routeAvailabilitySnapshot'
            )
            : null;
        if (normalizedAvailability && this.lastRouteAvailabilitySnapshot) {
            const previous = this.lastRouteAvailabilitySnapshot;
            if (normalizedAvailability.graphContentKey
                    !== previous.graphContentKey) {
                throw new RangeError(
                    'WaveDirector route availability graph content key가 바뀌었습니다.'
                );
            }
            if (normalizedAvailability.availabilityVersion
                    < previous.availabilityVersion) {
                throw new RangeError(
                    'WaveDirector route availability version이 회귀했습니다.'
                );
            }
            if (normalizedAvailability.availabilityVersion
                    === previous.availabilityVersion
                && (normalizedAvailability.closedPathIds.length
                        !== previous.closedPathIds.length
                    || normalizedAvailability.closedPathIds.some(
                        (pathId, index) => pathId
                            !== previous.closedPathIds[index]
                    ))) {
                throw new RangeError(
                    'WaveDirector same-version route availability snapshot이 충돌합니다.'
                );
            }
        }
        const closedPathIds = new Set(
            normalizedAvailability?.closedPathIds ?? []
        );
        const readyEntries = [];
        const blockedEntries = [];
        const selectedPathByCurrentGroup = new Map();
        const nextRoutePathByGroupId = new Map(this.routePathByGroupId);
        for (const entry of entries) {
            let route = entry.route;
            if (entry.routeSetId !== null) {
                let selectedPathId = entry.preserveGroupRoute
                    ? nextRoutePathByGroupId.get(entry.groupId) ?? null
                    : selectedPathByCurrentGroup.get(entry.groupId) ?? null;
                if (selectedPathId === null) {
                    selectedPathId = selectOpenRoutePathId(
                        this.routeGraph,
                        entry.routeSetId,
                        normalizedAvailability
                    );
                    if (selectedPathId !== null) {
                        selectedPathByCurrentGroup.set(
                            entry.groupId,
                            selectedPathId
                        );
                        if (entry.preserveGroupRoute) {
                            nextRoutePathByGroupId.set(
                                entry.groupId,
                                selectedPathId
                            );
                        }
                    }
                }
                if (selectedPathId === null || closedPathIds.has(selectedPathId)) {
                    blockedEntries.push(entry);
                    continue;
                }
                route = this.routeByPathId.get(selectedPathId) ?? null;
                if (!route || !entry.routeCandidatePathIds.includes(selectedPathId)) {
                    throw new RangeError(
                        `WaveDirector selected route가 schedule binding과 다릅니다: ${selectedPathId}`
                    );
                }
            }
            readyEntries.push(Object.freeze({ entry, route }));
        }
        if (blockedEntries.length
            > AUTHORED_WAVE_COMPILE_LIMIT.MAXIMUM_TOTAL_SPAWN_COUNT) {
            throw new RangeError('WaveDirector blocked spawn backlog capacity를 초과했습니다.');
        }
        const nextRouteAvailabilityVersion
            = normalizedAvailability?.availabilityVersion
                ?? this.lastRouteAvailabilityVersion;
        if (readyEntries.length === 0) {
            this.nextScheduleIndex = nextScheduleIndex;
            this.blockedEntries = blockedEntries;
            this.routePathByGroupId = nextRoutePathByGroupId;
            this.lastRouteAvailabilityVersion = nextRouteAvailabilityVersion;
            this.lastRouteAvailabilitySnapshot = normalizedAvailability
                ?? this.lastRouteAvailabilitySnapshot;
            return 0;
        }

        const requests = Object.freeze(readyEntries.map(({ entry, route }) => {
            // Profile base와 immutable map/wave input을 이 queue boundary에서 정확히 한 번
            // resolve한 뒤 intent를 만듭니다. init은 resolved numeric stat을 저장하지 않습니다.
            const resolvedStats = resolveEnemySpawnStats({
                definition: entry.definition,
                mapEnemyModifiers: entry.mapEnemyModifiers,
                waveEnemyModifiers: entry.waveEnemyModifiers,
                knownDefinitionIds: this.knownEnemyDefinitionIds
            });
            const intent = createGpuEnemySpawnIntent({
                definition: entry.definition,
                route,
                routeSetId: entry.routeSetId,
                routeAvailabilityVersion:
                    normalizedAvailability?.availabilityVersion ?? 1,
                routeGraphContentKey:
                    normalizedAvailability?.graphContentKey ?? null,
                spawnSequence: entry.spawnSequence,
                laneOffsetTiles: entry.laneOffsetTiles,
                initialWorldOffsetTiles: entry.initialWorldOffsetByPathId === null
                    ? entry.initialWorldOffsetTiles
                    : entry.initialWorldOffsetByPathId[route.pathId],
                waveId: entry.waveId,
                policyId: entry.policyId,
                formationProvenance: entry.formationProvenance,
                resolvedStats
            });
            return Object.freeze({
                intent,
                targetFixedTick: tick,
                commandId: entry.commandId
            });
        }));
        const result = commandOwner.requestSpawnBatch(requests);
        if (result?.accepted !== true
            || result.requestedCount !== requests.length
            || result.queuedCount !== requests.length) {
            throw new Error(
                `WaveDirector atomic spawn batch queue 실패: tick=${tick}, count=${requests.length}`
            );
        }
        this.nextScheduleIndex = nextScheduleIndex;
        this.blockedEntries = blockedEntries;
        this.routePathByGroupId = nextRoutePathByGroupId;
        this.lastRouteAvailabilityVersion = nextRouteAvailabilityVersion;
        this.lastRouteAvailabilitySnapshot = normalizedAvailability
            ?? this.lastRouteAvailabilitySnapshot;
        this.queuedSpawnCount += readyEntries.length;
        return readyEntries.length;
    }

    /**
     * exact-idle GPU route epoch 교체 뒤 구 epoch의 selection cache만 폐기합니다.
     * blocked authored schedule/spawnSequence backlog는 새 all-open epoch에서 그대로
     * 재평가되어야 하므로 nextScheduleIndex/blockedEntries는 건드리지 않습니다.
     */
    canResetRouteAvailabilityBinding(snapshot) {
        if (!this.initialized || this.destroyed || this.routeGraph === null) {
            return false;
        }
        try {
            const normalized = normalizeRouteAvailabilitySelectionSnapshot(
                snapshot,
                this.routeGraph,
                'WaveDirector.resetRouteAvailabilityBinding'
            );
            return normalized.availabilityVersion === 1
                && normalized.closedPathIds.length === 0
                && (this.lastRouteAvailabilitySnapshot === null
                    || normalized.graphContentKey
                        === this.lastRouteAvailabilitySnapshot.graphContentKey);
        } catch {
            return false;
        }
    }

    resetRouteAvailabilityBinding(snapshot) {
        if (!this.canResetRouteAvailabilityBinding(snapshot)) {
            return false;
        }
        this.routePathByGroupId.clear();
        this.lastRouteAvailabilityVersion = null;
        this.lastRouteAvailabilitySnapshot = null;
        return true;
    }

    getStatus() {
        return Object.freeze({
            waveId: this.initializedWaveId,
            initialized: this.initialized,
            totalSpawnCount: this.schedule.length,
            queuedSpawnCount: this.queuedSpawnCount,
            blockedSpawnCount: this.blockedEntries.length,
            remainingSpawnCount: this.schedule.length - this.queuedSpawnCount,
            allSpawnsQueued: this.initialized
                && this.nextScheduleIndex >= this.schedule.length
                && this.blockedEntries.length === 0,
            completionOwned: false,
            fixedTickOffset: this.fixedTickOffset,
            routeAvailabilityVersion: this.lastRouteAvailabilityVersion
        });
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.schedule = Object.freeze([]);
        this.nextScheduleIndex = 0;
        this.queuedSpawnCount = 0;
        this.blockedEntries = [];
        this.routePathByGroupId.clear();
        this.routeByPathId.clear();
        this.routeGraph = null;
        this.lastRouteAvailabilityVersion = null;
        this.lastRouteAvailabilitySnapshot = null;
        this.initialized = false;
    }
}
