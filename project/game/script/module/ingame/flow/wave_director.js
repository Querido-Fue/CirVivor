import {
    INGAME_ENEMY_DEFINITION_BY_ID
} from 'data/object/enemy/basic_circle_enemy_data.js';
import {
    CORRIDOR_EIGHT_WAVE_01_DATA
} from 'data/scene/game/corridor_eight_wave_01_data.js';
import { createGpuEnemySpawnIntent } from '../object/enemy/gpu_enemy_spawn_adapter.js';

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

function requirePositiveSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
        throw new RangeError(`${label}은 양의 안전한 정수여야 합니다.`);
    }
    return number;
}

function requireNonNegativeSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
        throw new RangeError(`${label}은 0 이상의 안전한 정수여야 합니다.`);
    }
    return number;
}

function requireFiniteOffsets(source, label) {
    if (!Array.isArray(source) || source.length === 0) {
        throw new TypeError(`${label}은 하나 이상의 lane offset 배열이어야 합니다.`);
    }
    return Object.freeze(source.map((value, index) => {
        const number = Number(value);
        if (!Number.isFinite(number)) {
            throw new TypeError(`${label}[${index}]는 유한 숫자여야 합니다.`);
        }
        return number;
    }));
}

function resolveEnemyDefinitionCycle(group, definitions, label) {
    const fallbackId = requireNonEmptyString(
        group?.enemyDefinitionId,
        `${label}.enemyDefinitionId`
    );
    const fallbackDefinition = definitions[fallbackId];
    if (!fallbackDefinition) {
        throw new RangeError(`등록되지 않은 enemy definition입니다: ${fallbackId}`);
    }
    const source = group?.enemyDefinitionIds;
    const definitionIds = source === undefined
        ? null
        : source;
    if (definitionIds === null) {
        return Object.freeze([fallbackDefinition]);
    }
    if (!Array.isArray(definitionIds) || definitionIds.length === 0) {
        throw new TypeError(`${label}.enemyDefinitionIds는 하나 이상의 ID 배열이어야 합니다.`);
    }
    return Object.freeze(definitionIds.map((value, index) => {
        const definitionId = requireNonEmptyString(
            value,
            `${label}.enemyDefinitionIds[${index}]`
        );
        const definition = definitions[definitionId];
        if (!definition) {
            throw new RangeError(`등록되지 않은 enemy definition입니다: ${definitionId}`);
        }
        return definition;
    }));
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
        this.initialized = false;
        this.destroyed = false;
    }

    /** 실제 TileMap route를 검증하고 모든 spawn record를 결정적으로 컴파일합니다. */
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
        if (!Array.isArray(definition?.phases) || definition.phases.length === 0) {
            throw new TypeError('WaveDefinition에는 하나 이상의 phase가 필요합니다.');
        }
        const routeByGateId = new Map();
        for (const route of tileMap.getSpawnRoutes()) {
            const gateId = requireNonEmptyString(route?.gateId, 'route.gateId');
            if (routeByGateId.has(gateId)) {
                throw new RangeError(`중복 Gate route입니다: ${gateId}`);
            }
            routeByGateId.set(gateId, route);
        }

        const schedule = [];
        let spawnSequence = 0;
        for (let phaseIndex = 0; phaseIndex < definition.phases.length; phaseIndex++) {
            const phase = definition.phases[phaseIndex];
            const startTick = requirePositiveSafeInteger(
                phase?.startTick,
                `phases[${phaseIndex}].startTick`
            );
            const durationTicks = requirePositiveSafeInteger(
                phase?.durationTicks,
                `phases[${phaseIndex}].durationTicks`
            );
            if (!Array.isArray(phase?.spawnGroups) || phase.spawnGroups.length === 0) {
                throw new TypeError(`phases[${phaseIndex}]에는 spawnGroup이 필요합니다.`);
            }
            for (let groupIndex = 0; groupIndex < phase.spawnGroups.length; groupIndex++) {
                const group = phase.spawnGroups[groupIndex];
                const groupLabel = `phases[${phaseIndex}].spawnGroups[${groupIndex}]`;
                const enemyDefinitionCycle = resolveEnemyDefinitionCycle(
                    group,
                    this.enemyDefinitions,
                    groupLabel
                );
                const gateId = requireNonEmptyString(
                    group?.gateId,
                    `spawnGroups[${groupIndex}].gateId`
                );
                const route = routeByGateId.get(gateId);
                if (!route) {
                    throw new RangeError(`현재 map에 없는 enemy Gate입니다: ${gateId}`);
                }
                if (group.pathChoicePolicy !== 'fixed-route') {
                    throw new RangeError(`지원하지 않는 pathChoicePolicy입니다: ${group.pathChoicePolicy}`);
                }
                const policyId = requireNonEmptyString(
                    group.policyId,
                    `spawnGroups[${groupIndex}].policyId`
                );
                const count = requirePositiveSafeInteger(
                    group.count,
                    `spawnGroups[${groupIndex}].count`
                );
                const intervalTicks = requirePositiveSafeInteger(
                    group.intervalTicks,
                    `spawnGroups[${groupIndex}].intervalTicks`
                );
                const laneOffsets = requireFiniteOffsets(
                    group.laneOffsetsTiles,
                    `spawnGroups[${groupIndex}].laneOffsetsTiles`
                );
                const lastSpawnTick = startTick + ((count - 1) * intervalTicks);
                if (lastSpawnTick >= startTick + durationTicks) {
                    throw new RangeError(
                        `spawnGroup schedule이 phase duration을 벗어납니다: ${phaseIndex}/${groupIndex}`
                    );
                }
                for (let spawnIndex = 0; spawnIndex < count; spawnIndex++) {
                    const localFixedTick = startTick + (spawnIndex * intervalTicks);
                    const targetFixedTick = this.fixedTickOffset + localFixedTick;
                    if (!Number.isSafeInteger(targetFixedTick)) {
                        throw new RangeError('wave targetFixedTick이 안전한 정수 범위를 벗어났습니다.');
                    }
                    const commandId = `${waveId}:${phaseIndex}:${groupIndex}:${spawnIndex}`;
                    const enemyDefinition = enemyDefinitionCycle[
                        spawnIndex % enemyDefinitionCycle.length
                    ];
                    schedule.push(Object.freeze({
                        commandId,
                        targetFixedTick,
                        intent: createGpuEnemySpawnIntent({
                            definition: enemyDefinition,
                            route,
                            spawnSequence,
                            laneOffsetTiles: laneOffsets[spawnIndex % laneOffsets.length],
                            waveId,
                            policyId
                        })
                    }));
                    spawnSequence++;
                }
            }
        }
        schedule.sort((left, right) => (
            left.targetFixedTick - right.targetFixedTick
            || left.intent.spawnSequence - right.intent.spawnSequence
        ));
        this.schedule = Object.freeze(schedule);
        this.nextScheduleIndex = 0;
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
        if (!commandOwner || typeof commandOwner.requestSpawn !== 'function') {
            throw new TypeError('WaveDirector에는 enemy spawn command sink가 필요합니다.');
        }
        const next = this.schedule[this.nextScheduleIndex];
        if (next && next.targetFixedTick < tick) {
            throw new RangeError(`WaveDirector fixed tick이 schedule을 건너뛰었습니다: ${tick}`);
        }
        let queued = 0;
        while (this.nextScheduleIndex < this.schedule.length) {
            const entry = this.schedule[this.nextScheduleIndex];
            if (entry.targetFixedTick !== tick) {
                break;
            }
            const result = commandOwner.requestSpawn(
                entry.intent,
                tick,
                entry.commandId
            );
            if (!result?.accepted) {
                throw new Error(`WaveDirector spawn command queue 실패: ${entry.commandId}`);
            }
            this.nextScheduleIndex++;
            queued++;
        }
        return queued;
    }

    getStatus() {
        return Object.freeze({
            waveId: this.waveDefinition?.waveId ?? null,
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
