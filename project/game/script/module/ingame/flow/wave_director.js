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
    compileAuthoredWaveTimeline
} from './authored_wave_timeline_contract.js';

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
        effectEmitterProfileId: source.effectEmitterProfileId,
        formationDefinitionId: source.formationDefinitionId,
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
        this.schedule = Object.freeze(schedule.map((entry) => Object.freeze({
            ...entry,
            mapEnemyModifiers,
            waveEnemyModifiers
        })));
        this.nextScheduleIndex = 0;
        this.initializedWaveId = waveId;
        this.initialized = true;
        return true;
    }

    /**
     * 해당 proposed fixed tick의 spawn만 command owner에 보냅니다.
     * @returns {number} 새로 queue한 command 수입니다.
     */
    queueSpawnsForFixedTick(fixedTick, commandOwner) {
        if (!this.initialized || this.destroyed) {
            return 0;
        }
        const tick = requirePositiveSafeInteger(fixedTick, 'fixedTick');
        if (!commandOwner || typeof commandOwner.requestSpawnBatch !== 'function') {
            throw new TypeError(
                'WaveDirector에는 atomic enemy requestSpawnBatch() sink가 필요합니다.'
            );
        }
        const next = this.schedule[this.nextScheduleIndex];
        if (next && next.targetFixedTick < tick) {
            throw new RangeError(`WaveDirector fixed tick이 schedule을 건너뛰었습니다: ${tick}`);
        }
        const entries = [];
        let scheduleIndex = this.nextScheduleIndex;
        while (scheduleIndex < this.schedule.length) {
            const entry = this.schedule[scheduleIndex];
            if (entry.targetFixedTick !== tick) {
                break;
            }
            entries.push(entry);
            scheduleIndex++;
        }
        if (entries.length === 0) {
            return 0;
        }
        const requests = Object.freeze(entries.map((entry) => {
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
                route: entry.route,
                spawnSequence: entry.spawnSequence,
                laneOffsetTiles: entry.laneOffsetTiles,
                initialWorldOffsetTiles: entry.initialWorldOffsetTiles,
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
        this.nextScheduleIndex += entries.length;
        return entries.length;
    }

    getStatus() {
        return Object.freeze({
            waveId: this.initializedWaveId,
            initialized: this.initialized,
            totalSpawnCount: this.schedule.length,
            queuedSpawnCount: this.nextScheduleIndex,
            remainingSpawnCount: this.schedule.length - this.nextScheduleIndex,
            allSpawnsQueued: this.initialized && this.nextScheduleIndex >= this.schedule.length,
            completionOwned: false,
            fixedTickOffset: this.fixedTickOffset
        });
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.schedule = Object.freeze([]);
        this.nextScheduleIndex = 0;
        this.initialized = false;
    }
}
