import { EFFECT_TYPES } from 'display/webgl/_webgl_constants.js';
import { clampFiniteNumber, resolveFiniteNumber } from 'util/number_util.js';

/** magnetic shield presentation command가 보존하는 최대 impact 수입니다. */
export const TITLE_SHIELD_PRESENTATION_MAX_IMPACTS = 12;

/** magnetic shield presentation command가 보존하는 최대 dent 수입니다. */
export const TITLE_SHIELD_PRESENTATION_MAX_DENTS = 16;

const titleShieldRenderCommandSlotCache = new WeakMap();

/**
 * magneticShield effect renderer에 전달할 렌더 명령을 생성합니다.
 * @param {object} state - 실드 렌더 상태입니다.
 * @param {number} state.centerX - 실드 중심 X 좌표입니다.
 * @param {number} state.centerY - 실드 중심 Y 좌표입니다.
 * @param {number} state.radius - 실드 반경입니다.
 * @param {number} state.time - 실드 애니메이션 시간입니다.
 * @param {Array<object>} state.impacts - 충돌 플래시 상태 목록입니다.
 * @param {Array<object>} state.dents - 눌림 왜곡 상태 목록입니다.
 * @param {TitleShieldConfig} state.config - 실드 렌더 설정입니다.
 * @param {object|null} [reusableCommand=null] - 이전 호출에서 반환된 재사용 가능 명령입니다.
 * @returns {object} effect 레이어 렌더 명령입니다.
 */
export function buildTitleShieldRenderCommand({
    centerX,
    centerY,
    radius,
    time,
    impacts,
    dents,
    config
}, reusableCommand = null) {
    const shieldColors = config.getColors();
    const command = reusableCommand && typeof reusableCommand === 'object'
        ? reusableCommand
        : {};
    const slotCache = getTitleShieldRenderCommandSlotCache(command);

    command.effectType = EFFECT_TYPES.MAGNETIC_SHIELD;
    command.x = centerX;
    command.y = centerY;
    command.radius = radius;
    command.fieldRadius = config.getFieldRadius(radius);
    command.time = time;
    command.alpha = config.getBaseAlpha();
    command.ringThickness = config.getRingThickness();
    command.glowWidth = config.getGlowWidth();
    command.shadowColor = shieldColors.shadow;
    command.lowColor = shieldColors.low;
    command.highColor = shieldColors.high;
    command.highlightColor = shieldColors.highlight;
    command.impacts = syncTitleShieldImpactRenderData(
        slotCache.impactSlots,
        slotCache.visibleImpacts,
        impacts
    );
    command.dents = syncTitleShieldDentRenderData(
        slotCache.dentSlots,
        slotCache.visibleDents,
        dents
    );
    return command;
}

/**
 * 내부 impact 상태를 shader 입력 형식으로 변환합니다.
 * @param {Array<object>} impacts - 충돌 플래시 상태 목록입니다.
 * @returns {Array<object>} 렌더러용 impact 목록입니다.
 */
export function buildTitleShieldImpactRenderData(impacts) {
    return impacts.map((impact) => {
        const age = resolveFiniteNumber(Number(impact.age), 0);
        const duration = clampFiniteNumber(Number(impact.duration), 0.0001, Infinity, 0.0001);
        return {
            angle: impact.angle,
            intensity: impact.intensity,
            width: impact.width,
            progress: age / duration
        };
    });
}

/**
 * 내부 dent 상태를 shader 입력 형식으로 변환합니다.
 * @param {Array<object>} dents - 눌림 왜곡 상태 목록입니다.
 * @returns {Array<object>} 렌더러용 dent 목록입니다.
 */
export function buildTitleShieldDentRenderData(dents) {
    return dents.map((dent) => ({
        angle: dent.angle,
        depth: dent.depth,
        width: dent.width,
        strength: dent.strength
    }));
}

/**
 * 명령 identity별 presentation slot cache를 반환합니다.
 * visible 배열의 길이는 매 호출의 실제 개수로 유지하고, slot 객체는 최대치만큼 재사용합니다.
 * @param {object} command - 재사용할 render command입니다.
 * @returns {{impactSlots:Array<object>, dentSlots:Array<object>, visibleImpacts:Array<object>, visibleDents:Array<object>}} slot cache입니다.
 */
function getTitleShieldRenderCommandSlotCache(command) {
    let cache = titleShieldRenderCommandSlotCache.get(command);
    if (cache) {
        return cache;
    }

    cache = {
        impactSlots: Array.from(
            { length: TITLE_SHIELD_PRESENTATION_MAX_IMPACTS },
            () => ({ angle: 0, intensity: 0, width: 0, progress: 0 })
        ),
        dentSlots: Array.from(
            { length: TITLE_SHIELD_PRESENTATION_MAX_DENTS },
            () => ({ angle: 0, depth: 0, width: 0, strength: 0 })
        ),
        visibleImpacts: [],
        visibleDents: []
    };
    titleShieldRenderCommandSlotCache.set(command, cache);
    return cache;
}

/**
 * impact 상태를 고정 presentation slot에 순서대로 복사합니다.
 * @param {Array<object>} slots - 고정 impact slot입니다.
 * @param {Array<object>} output - command에 노출할 live 배열입니다.
 * @param {Array<object>} impacts - 내부 impact 상태입니다.
 * @returns {Array<object>} 실제 impact 개수 길이로 맞춘 live 배열입니다.
 */
function syncTitleShieldImpactRenderData(slots, output, impacts) {
    const source = Array.isArray(impacts) ? impacts : [];
    let writeCount = 0;
    for (let index = 0;
        index < source.length && writeCount < TITLE_SHIELD_PRESENTATION_MAX_IMPACTS;
        index++) {
        const impact = source[index];
        if (!impact) {
            continue;
        }

        const slot = slots[writeCount];
        const age = resolveFiniteNumber(Number(impact.age), 0);
        const duration = clampFiniteNumber(Number(impact.duration), 0.0001, Infinity, 0.0001);
        slot.angle = impact.angle;
        slot.intensity = impact.intensity;
        slot.width = impact.width;
        slot.progress = age / duration;
        output[writeCount] = slot;
        writeCount += 1;
    }
    output.length = writeCount;
    return output;
}

/**
 * dent 상태를 고정 presentation slot에 순서대로 복사합니다.
 * @param {Array<object>} slots - 고정 dent slot입니다.
 * @param {Array<object>} output - command에 노출할 live 배열입니다.
 * @param {Array<object>} dents - 내부 dent 상태입니다.
 * @returns {Array<object>} 실제 dent 개수 길이로 맞춘 live 배열입니다.
 */
function syncTitleShieldDentRenderData(slots, output, dents) {
    const source = Array.isArray(dents) ? dents : [];
    let writeCount = 0;
    for (let index = 0;
        index < source.length && writeCount < TITLE_SHIELD_PRESENTATION_MAX_DENTS;
        index++) {
        const dent = source[index];
        if (!dent) {
            continue;
        }

        const slot = slots[writeCount];
        slot.angle = dent.angle;
        slot.depth = dent.depth;
        slot.width = dent.width;
        slot.strength = dent.strength;
        output[writeCount] = slot;
        writeCount += 1;
    }
    output.length = writeCount;
    return output;
}
