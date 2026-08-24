import { fingerprintR8Record } from './r8_fingerprint_contract.js';
import {
    AUTHORED_FORMATION_SPAWN_MODE,
    AUTHORED_WAVE_FIXED_TICKS_PER_SECOND,
    AUTHORED_WAVE_TIMELINE_COMMAND_TYPE
} from '../flow/authored_wave_timeline_contract.js';
import {
    getWaveResolutionProfileFingerprint
} from './wave_resolution_contract.js';
import {
    WAVE_RUN_FINAL_CONTINUE_RESULT
} from './wave_run_state_contract.js';

const PLAN_KEYS = Object.freeze([
    'planId',
    'mapId',
    'waves',
    'shopAfterEveryWave',
    'finalContinueResult'
]);
const WAVE_ENTRY_KEYS = Object.freeze([
    'waveOrdinal',
    'waveDefinition',
    'resolutionProfileId'
]);
const PLAN_METADATA = new WeakMap();

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
    for (const key of expectedKeys) {
        materialized[key] = source[key];
    }
    return materialized;
}

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

function requirePositiveSafeInteger(value, label) {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${label}은 양의 안전한 정수여야 합니다.`);
    }
    return value;
}

function checkedAdd(left, right, label) {
    const total = left + right;
    if (!Number.isSafeInteger(total) || total > 0xffff_ffff) {
        throw new RangeError(`${label}이 uint32 범위를 벗어났습니다.`);
    }
    return total;
}

function durationSecondsToTicks(durationSeconds, label) {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        throw new RangeError(`${label}은 양수여야 합니다.`);
    }
    const ticks = durationSeconds * AUTHORED_WAVE_FIXED_TICKS_PER_SECOND;
    if (!Number.isSafeInteger(ticks) || ticks <= 0) {
        throw new RangeError(`${label}은 60Hz fixed tick으로 정확히 표현되어야 합니다.`);
    }
    return ticks;
}

function requireDataProperty(record, key, label) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError(`${label}.${key}은 data property여야 합니다.`);
    }
    return descriptor.value;
}

function assertDeepFrozenData(value, label, ancestors = new Set()) {
    if (!value || typeof value !== 'object') return;
    if (!Object.isFrozen(value)) {
        throw new TypeError(`${label}은 deep-frozen data여야 합니다.`);
    }
    if (ancestors.has(value)) {
        throw new RangeError(`${label}에는 순환 참조를 사용할 수 없습니다.`);
    }
    ancestors.add(value);
    for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string') {
            throw new RangeError(`${label}에는 symbol key를 사용할 수 없습니다.`);
        }
        if (key === 'length') continue;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
            throw new TypeError(`${label}.${key}은 frozen data property여야 합니다.`);
        }
        assertDeepFrozenData(descriptor.value, `${label}.${key}`, ancestors);
    }
    ancestors.delete(value);
}

export function measureAuthoredWaveScheduleDurationTicks(waveDefinition) {
    const definition = requireRecord(waveDefinition, 'waveDefinition');
    const timeline = requireDataProperty(definition, 'timeline', 'waveDefinition');
    if (!Array.isArray(timeline) || timeline.length === 0) {
        throw new TypeError('waveDefinition.timeline은 비어 있지 않은 배열이어야 합니다.');
    }
    let cursorTick = 1;
    for (let index = 0; index < timeline.length; index++) {
        const entry = requireRecord(timeline[index], `timeline[${index}]`);
        const type = requireDataProperty(entry, 'type', `timeline[${index}]`);
        let durationTicks;
        if (type === AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.WAIT
            || type === AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_FOR_DURATION) {
            durationTicks = durationSecondsToTicks(
                requireDataProperty(entry, 'durationSeconds', `timeline[${index}]`),
                `timeline[${index}].durationSeconds`
            );
        } else if (type === AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_GROUP) {
            durationTicks = 1;
        } else if (type === AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_FORMATION) {
            const formation = requireRecord(
                requireDataProperty(entry, 'formation', `timeline[${index}]`),
                `timeline[${index}].formation`
            );
            const layout = requireDataProperty(
                formation,
                'layout',
                `timeline[${index}].formation`
            );
            if (!Array.isArray(layout) || layout.length === 0) {
                throw new TypeError(`timeline[${index}].formation.layout이 필요합니다.`);
            }
            const spawnMode = requireDataProperty(
                formation,
                'spawnMode',
                `timeline[${index}].formation`
            );
            const rowDelayTicks = requireDataProperty(
                formation,
                'rowDelayTicks',
                `timeline[${index}].formation`
            );
            if (!Number.isSafeInteger(rowDelayTicks) || rowDelayTicks < 0) {
                throw new RangeError(
                    `timeline[${index}].formation.rowDelayTicks가 유효하지 않습니다.`
                );
            }
            durationTicks = spawnMode
                === AUTHORED_FORMATION_SPAWN_MODE.SEQUENTIAL_ROWS
                ? ((layout.length - 1) * rowDelayTicks) + 1
                : 1;
        } else {
            throw new RangeError(`timeline[${index}].type이 알려진 command가 아닙니다.`);
        }
        cursorTick = checkedAdd(cursorTick, durationTicks, 'authored schedule cursor');
    }
    return cursorTick - 1;
}

export function createWaveRunPlan(source, options = {}) {
    const plan = materializeKnownRecord(source, PLAN_KEYS, 'WaveRunPlan');
    const planId = requireNonEmptyString(plan.planId, 'planId');
    const mapId = requireNonEmptyString(plan.mapId, 'mapId');
    if (!Array.isArray(plan.waves) || plan.waves.length === 0) {
        throw new TypeError('WaveRunPlan.waves는 비어 있지 않은 배열이어야 합니다.');
    }
    if (plan.shopAfterEveryWave !== true) {
        throw new RangeError('shopAfterEveryWave는 true여야 합니다.');
    }
    if (plan.finalContinueResult !== WAVE_RUN_FINAL_CONTINUE_RESULT.MAP_CLEAR_READY) {
        throw new RangeError('finalContinueResult는 MAP_CLEAR_READY여야 합니다.');
    }
    const resolutionProfileById = requireRecord(
        options.resolutionProfileById,
        'resolutionProfileById'
    );
    const waveIds = new Set();
    const waves = [];
    const waveMetadata = [];
    for (let index = 0; index < plan.waves.length; index++) {
        const label = `WaveRunPlan.waves[${index}]`;
        const entry = materializeKnownRecord(plan.waves[index], WAVE_ENTRY_KEYS, label);
        const waveOrdinal = requirePositiveSafeInteger(
            entry.waveOrdinal,
            `${label}.waveOrdinal`
        );
        if (waveOrdinal !== index + 1) {
            throw new RangeError(`${label}.waveOrdinal은 1..N contiguous여야 합니다.`);
        }
        const waveDefinition = requireRecord(
            entry.waveDefinition,
            `${label}.waveDefinition`
        );
        assertDeepFrozenData(waveDefinition, `${label}.waveDefinition`);
        const waveId = requireNonEmptyString(
            requireDataProperty(waveDefinition, 'waveId', `${label}.waveDefinition`),
            `${label}.waveDefinition.waveId`
        );
        const waveMapId = requireNonEmptyString(
            requireDataProperty(waveDefinition, 'mapId', `${label}.waveDefinition`),
            `${label}.waveDefinition.mapId`
        );
        if (waveMapId !== mapId) {
            throw new RangeError(`${label}의 wave.mapId가 plan.mapId와 다릅니다.`);
        }
        if (waveIds.has(waveId)) {
            throw new RangeError(`waveId가 plan 안에서 중복되었습니다: ${waveId}`);
        }
        waveIds.add(waveId);
        const resolutionProfileId = requireNonEmptyString(
            entry.resolutionProfileId,
            `${label}.resolutionProfileId`
        );
        const profileDescriptor = Object.getOwnPropertyDescriptor(
            resolutionProfileById,
            resolutionProfileId
        );
        if (!profileDescriptor || !Object.hasOwn(profileDescriptor, 'value')) {
            throw new RangeError(`${label}의 resolution profile을 찾을 수 없습니다.`);
        }
        const resolutionProfile = profileDescriptor.value;
        const resolutionProfileFingerprint
            = getWaveResolutionProfileFingerprint(resolutionProfile);
        const scheduleDurationTicks
            = measureAuthoredWaveScheduleDurationTicks(waveDefinition);
        if (scheduleDurationTicks > resolutionProfile.combatDurationTicks) {
            throw new RangeError(
                `${label} authored schedule(${scheduleDurationTicks})이 `
                + `combat duration(${resolutionProfile.combatDurationTicks})을 초과합니다.`
            );
        }
        if (resolutionProfile.settlement.openShop !== true) {
            throw new RangeError(`${label}은 Wave 후 Shop을 열어야 합니다.`);
        }
        const normalizedEntry = Object.freeze({
            waveOrdinal,
            waveDefinition,
            resolutionProfileId
        });
        waves.push(normalizedEntry);
        waveMetadata.push(Object.freeze({
            waveId,
            mapId: waveMapId,
            scheduleDurationTicks,
            resolutionProfile,
            resolutionProfileFingerprint
        }));
    }
    const normalized = Object.freeze({
        planId,
        mapId,
        waves: Object.freeze(waves),
        shopAfterEveryWave: true,
        finalContinueResult: WAVE_RUN_FINAL_CONTINUE_RESULT.MAP_CLEAR_READY
    });
    const fingerprint = fingerprintR8Record('r9-wave-run-plan', {
        planId,
        mapId,
        waves: waveMetadata.map((metadata, index) => ({
            waveOrdinal: index + 1,
            waveId: metadata.waveId,
            resolutionProfileId: waves[index].resolutionProfileId,
            resolutionProfileFingerprint: metadata.resolutionProfileFingerprint,
            scheduleDurationTicks: metadata.scheduleDurationTicks
        })),
        shopAfterEveryWave: true,
        finalContinueResult: WAVE_RUN_FINAL_CONTINUE_RESULT.MAP_CLEAR_READY
    }, planId);
    PLAN_METADATA.set(normalized, Object.freeze({
        fingerprint,
        waves: Object.freeze(waveMetadata)
    }));
    return normalized;
}

export function getWaveRunPlanFingerprint(plan) {
    const metadata = PLAN_METADATA.get(plan);
    if (!metadata) throw new TypeError('normalized WaveRunPlan이 필요합니다.');
    return metadata.fingerprint;
}

export function getWaveRunPlanWaveMetadata(plan, waveOrdinal) {
    const metadata = PLAN_METADATA.get(plan);
    if (!metadata) throw new TypeError('normalized WaveRunPlan이 필요합니다.');
    if (!Number.isSafeInteger(waveOrdinal)
        || waveOrdinal < 1
        || waveOrdinal > metadata.waves.length) {
        throw new RangeError('waveOrdinal이 plan 범위를 벗어났습니다.');
    }
    return metadata.waves[waveOrdinal - 1];
}

export function createWaveRunPlanCatalog(plans) {
    if (!Array.isArray(plans) || plans.length === 0) {
        throw new TypeError('WaveRunPlan catalog는 비어 있지 않아야 합니다.');
    }
    const catalog = [];
    const byId = Object.create(null);
    for (const plan of plans) {
        getWaveRunPlanFingerprint(plan);
        if (Object.hasOwn(byId, plan.planId)) {
            throw new RangeError(`planId가 중복되었습니다: ${plan.planId}`);
        }
        byId[plan.planId] = plan;
        catalog.push(plan);
    }
    return Object.freeze({
        plans: Object.freeze(catalog),
        byId: Object.freeze(byId)
    });
}
