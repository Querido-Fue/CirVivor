import {
    WAVE_RUN_STATE
} from 'ingame/contract/wave_run_state_contract.js';

export const R9_WAVE_FLOW_SEMANTIC_SURFACE = Object.freeze({
    HUD_WAVE_ACTIVE: 'hud.wave-active',
    HUD_OVERTIME: 'hud.overtime',
    SHOP_WAVE_NORMAL_CLEAR: 'shop.wave-normal-clear',
    SHOP_WAVE_OVERTIME_CLEAR: 'shop.wave-overtime-clear',
    SHOP_FINAL_WAVE: 'shop.final-wave',
    MAP_CLEAR_READY: 'map-clear-ready'
});

const SHOP_PREVIEW_STATES = new Set([
    WAVE_RUN_STATE.SETTLEMENT_PENDING,
    WAVE_RUN_STATE.SHOP_OPENING,
    WAVE_RUN_STATE.SHOP,
    WAVE_RUN_STATE.NEXT_WAVE_PREPARE
]);

function count(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function formatDamageFixedPoint(value) {
    const damage = count(value);
    return damage === 0 ? '0' : damage.toLocaleString('en-US');
}

function freezePresentation({
    visible,
    primaryText = '',
    secondaryText = '',
    accented = false,
    semanticSurfaces = []
}) {
    const surfaces = Object.freeze(Array.from(new Set(semanticSurfaces)));
    return Object.freeze({
        visible,
        primaryText,
        secondaryText,
        accented,
        primarySemanticSurface: surfaces[0] ?? null,
        semanticSurfaces: surfaces
    });
}

function createCombatPresentation(flow) {
    const wave = `${count(flow.waveOrdinal)}/${count(flow.totalWaveCount)}`;
    if (flow.waveState === WAVE_RUN_STATE.OVERTIME
        || flow.overtimeActive === true) {
        return freezePresentation({
            visible: true,
            primaryText: `WAVE ${wave} · OVERTIME`,
            secondaryText: [
                `HOSTILES ${count(flow.hostileActorCount)}`,
                `NEXT CORE PRESSURE ${count(flow.ticksUntilNextPulse)} TICKS`,
                `DMG ${formatDamageFixedPoint(
                    flow.projectedNextDamageFixedPoint
                )}`
            ].join(' · '),
            accented: true,
            semanticSurfaces: [
                R9_WAVE_FLOW_SEMANTIC_SURFACE.HUD_OVERTIME
            ]
        });
    }
    return freezePresentation({
        visible: true,
        primaryText: `WAVE ${wave}`,
        secondaryText: `TIME ${count(flow.remainingTicks)} · HOSTILES ${count(
            flow.hostileActorCount
        )}`,
        semanticSurfaces: [
            R9_WAVE_FLOW_SEMANTIC_SURFACE.HUD_WAVE_ACTIVE
        ]
    });
}

function createShopPresentation(flow) {
    const preview = flow.shopPreview ?? {};
    const clearType = preview.clearType === 'OVERTIME'
        ? 'OVERTIME'
        : 'NORMAL';
    const finalWave = preview.finalWave === true;
    const surfaces = [
        clearType === 'OVERTIME'
            ? R9_WAVE_FLOW_SEMANTIC_SURFACE.SHOP_WAVE_OVERTIME_CLEAR
            : R9_WAVE_FLOW_SEMANTIC_SURFACE.SHOP_WAVE_NORMAL_CLEAR
    ];
    if (finalWave) {
        surfaces.push(R9_WAVE_FLOW_SEMANTIC_SURFACE.SHOP_FINAL_WAVE);
    }
    const pulseSummary = clearType === 'OVERTIME'
        ? ` · ${count(preview.overtimePulseCount)} PULSES · DMG ${formatDamageFixedPoint(
            preview.overtimeDamageTotalFixedPoint
        )}`
        : '';
    return freezePresentation({
        visible: true,
        primaryText: finalWave
            ? `FINAL WAVE CLEAR · ${clearType}${pulseSummary}`
            : `WAVE ${count(preview.completedWaveOrdinal)} CLEAR · ${clearType}${pulseSummary}`,
        secondaryText: finalWave
            ? 'CONTINUE → MAP CLEAR'
            : `NEXT WAVE ${preview.nextWaveId ?? 'PENDING'}`,
        accented: clearType === 'OVERTIME' || finalWave,
        semanticSurfaces: surfaces
    });
}

/** Renderer가 gameplay authority 없이 소비하는 immutable semantic text model입니다. */
export function createR9WaveFlowPresentation(flow) {
    if (flow?.configured !== true) {
        return freezePresentation({ visible: false });
    }
    if (flow.waveState === WAVE_RUN_STATE.MAP_CLEAR_READY
        || flow.shopPreview?.mapClearReady === true) {
        return freezePresentation({
            visible: true,
            primaryText: 'MAP CLEAR READY',
            secondaryText: `WAVE ${count(flow.waveOrdinal)}/${count(
                flow.totalWaveCount
            )} COMPLETE`,
            accented: true,
            semanticSurfaces: [
                R9_WAVE_FLOW_SEMANTIC_SURFACE.MAP_CLEAR_READY
            ]
        });
    }
    if (SHOP_PREVIEW_STATES.has(flow.waveState)
        && count(flow.shopPreview?.completedWaveOrdinal) > 0) {
        return createShopPresentation(flow);
    }
    return createCombatPresentation(flow);
}
