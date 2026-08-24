import { ColorSchemes } from 'display/_theme_handler.js';
import { render } from 'display/display_system.js';
import { releaseUIItem } from 'ui/_ui_pool.js';
import { LayoutHandler } from 'ui/layout/_layout_handler.js';
import { PositioningHandler } from 'ui/layout/_positioning_handler.js';
import { TYPOGRAPHY } from 'ui/style/typography.js';
import {
    createShopOverlayRenderer
} from '../shop/shop_overlay_renderer.js';
import {
    createR9WaveFlowPresentation
} from './r9_wave_flow_presentation_model.js';

const STATUS_LAYER = 'ui';
const STATUS_X_PARENT_PERCENT = 3;
const STATUS_Y_PARENT_PERCENT = 4;
const STATUS_LAYOUT_WIDTH_PARENT_PERCENT = 94;
const STATUS_LAYOUT_HEIGHT_PARENT_PERCENT = 20;
const STATUS_FIRST_LINE_HEIGHT_UIWW_PERCENT = 1.0625;
const TOWER_STATUS_COMPONENT_ID = 'game_scene_tower_status';
const CORE_STATUS_COMPONENT_ID = 'game_scene_core_status';
const WAVE_PRIMARY_COMPONENT_ID = 'game_scene_wave_primary_status';
const WAVE_SECONDARY_COMPONENT_ID = 'game_scene_wave_secondary_status';

function normalizePositiveNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeFiniteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function formatStatusValue(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return 'N/A';
    }
    if (Number.isInteger(number)) {
        return String(number);
    }
    return number.toFixed(2).replace(/\.?0+$/u, '');
}

function createTowerStatusText(status) {
    const tower = status?.tower;
    const hasCombatStatus = tower?.available === true
        && tower.currentHp !== null
        && tower.maxHp !== null
        && Number.isFinite(Number(tower.currentHp))
        && Number.isFinite(Number(tower.maxHp))
        && (tower.state === 'ALIVE' || tower.state === 'DEAD');
    const base = hasCombatStatus
        ? `TOWER  ${formatStatusValue(tower.currentHp)} / ${formatStatusValue(tower.maxHp)}  ${tower.state}`
        : 'TOWER  N/A';
    return status?.recoveryRequired === true
        ? `${base}  · RECOVERY`
        : base;
}

function createCoreStatusText(status) {
    const core = status?.core;
    if (core?.available !== true
        || core.currentIntegrity === null
        || core.maxIntegrity === null
        || !Number.isFinite(Number(core.currentIntegrity))
        || !Number.isFinite(Number(core.maxIntegrity))) {
        return 'CORE   N/A';
    }
    return `CORE   ${formatStatusValue(core.currentIntegrity)} / ${formatStatusValue(core.maxIntegrity)}`;
}

/**
 * @class GameSceneStatusRenderer
 * @description 한 GameSystem의 pooled UI presentation만 소유하고 gameplay authority는 보관하지 않습니다.
 */
export class GameSceneStatusRenderer {
    constructor(options = {}) {
        this.layoutParent = {
            layer: STATUS_LAYER,
            uiScale: 1,
            scaledX: 0,
            scaledY: 0,
            scaledW: 0,
            scaledH: 0
        };
        this.layoutViewport = {
            ww: 0,
            wh: 0,
            uiww: 0,
            uiOffsetX: 0,
            uiScale: 0
        };
        this.staticItems = null;
        this.dynamicItems = null;
        this.towerCommand = null;
        this.coreCommand = null;
        this.wavePrimaryCommand = null;
        this.waveSecondaryCommand = null;
        this.waveFlowPresentationStatus = null;
        this.shopOverlayRenderer = createShopOverlayRenderer({
            inputSource: options.inputSource,
            animationPort: options.animationPort,
            settingsSource: options.settingsSource
        });
        this.destroyed = false;
    }

    /** SHOP presentation input을 variable frame에서만 갱신합니다. */
    update(status, viewport = {}, frameDelta = 0) {
        if (this.destroyed) return false;
        return this.shopOverlayRenderer.update(status, viewport, frameDelta);
    }

    /**
     * GameSystem의 bounded gameplay snapshot을 canonical UI layout으로 표시합니다.
     * @param {object|null} status - GameSystem.getGameplayStatus() 결과입니다.
     * @param {{ww?:number,wh?:number,uiww?:number,uiOffsetX?:number,uiScale?:number}} [viewport={}] - 현재 UI viewport snapshot입니다.
     * @returns {boolean} bounded aggregate status를 제출했는지 여부입니다.
     */
    draw(status, viewport = {}) {
        if (this.destroyed) {
            return false;
        }
        const normalizedViewport = this.#normalizeViewport(viewport);
        if (!normalizedViewport) {
            return false;
        }
        if (this.#hasViewportChanged(normalizedViewport)) {
            this.#rebuildLayout(normalizedViewport);
        }

        const fill = ColorSchemes.Game?.Font ?? null;
        this.towerCommand.text = createTowerStatusText(status);
        this.towerCommand.fill = fill;
        this.coreCommand.text = createCoreStatusText(status);
        this.coreCommand.fill = fill;
        const wavePresentation = createR9WaveFlowPresentation(
            status?.waveFlow
        );
        this.waveFlowPresentationStatus = wavePresentation;
        const waveFill = wavePresentation.accented
            ? ColorSchemes.Title?.Menu?.Accent ?? fill
            : fill;
        this.wavePrimaryCommand.text = wavePresentation.primaryText;
        this.wavePrimaryCommand.fill = waveFill;
        this.waveSecondaryCommand.text = wavePresentation.secondaryText;
        this.waveSecondaryCommand.fill = waveFill;

        for (let index = 0; index < 2; index++) {
            render(STATUS_LAYER, this.staticItems[index].item);
        }
        this.shopOverlayRenderer.draw(status, normalizedViewport);
        if (wavePresentation.visible) {
            render(STATUS_LAYER, this.wavePrimaryCommand);
            render(STATUS_LAYER, this.waveSecondaryCommand);
        }
        return true;
    }

    /** UI가 생성한 immutable semantic command를 GameSystem에 인계합니다. */
    drainCommands() {
        return this.destroyed
            ? Object.freeze([])
            : this.shopOverlayRenderer.drainCommands();
    }

    getShopOverlayStatus() {
        return this.shopOverlayRenderer?.getStatus?.() ?? null;
    }

    /** Golden/manual QA가 읽는 마지막 immutable semantic surface 상태입니다. */
    getWaveFlowPresentationStatus() {
        return this.waveFlowPresentationStatus;
    }

    /** pooled UI command를 반납합니다. 반복 호출해도 안전합니다. */
    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.shopOverlayRenderer?.destroy?.();
        this.shopOverlayRenderer = null;
        this.waveFlowPresentationStatus = null;
        this.#releaseLayout();
    }

    #normalizeViewport(viewport) {
        const ww = normalizePositiveNumber(viewport.ww);
        const wh = normalizePositiveNumber(viewport.wh);
        if (ww <= 0 || wh <= 0) {
            return null;
        }
        const uiww = normalizePositiveNumber(viewport.uiww, ww);
        return {
            ww,
            wh,
            uiww,
            uiOffsetX: normalizeFiniteNumber(
                viewport.uiOffsetX,
                (ww - uiww) * 0.5
            ),
            uiScale: normalizePositiveNumber(viewport.uiScale, 1)
        };
    }

    #hasViewportChanged(viewport) {
        return !this.staticItems
            || viewport.ww !== this.layoutViewport.ww
            || viewport.wh !== this.layoutViewport.wh
            || viewport.uiww !== this.layoutViewport.uiww
            || viewport.uiOffsetX !== this.layoutViewport.uiOffsetX
            || viewport.uiScale !== this.layoutViewport.uiScale;
    }

    #rebuildLayout(viewport) {
        this.#releaseLayout();
        Object.assign(this.layoutViewport, viewport);
        Object.assign(this.layoutParent, {
            uiScale: viewport.uiScale,
            scaledX: viewport.uiOffsetX,
            scaledY: 0,
            scaledW: viewport.uiww,
            scaledH: viewport.wh
        });

        const positioningHandler = new PositioningHandler(
            this.layoutParent,
            viewport.uiScale
        );
        const buildResult = new LayoutHandler(
            this.layoutParent,
            positioningHandler
        )
            .layoutStartPos(
                'OX',
                STATUS_X_PARENT_PERCENT,
                'OY',
                STATUS_Y_PARENT_PERCENT
            )
            .layoutSize(
                'OW',
                STATUS_LAYOUT_WIDTH_PARENT_PERCENT,
                'OH',
                STATUS_LAYOUT_HEIGHT_PARENT_PERCENT
            )
            .item('text', TOWER_STATUS_COMPONENT_ID)
            .textStyle(TYPOGRAPHY.CONTROL)
            .text('TOWER  N/A')
            .fill(ColorSchemes.Game?.Font ?? null)
            .height('WW', STATUS_FIRST_LINE_HEIGHT_UIWW_PERCENT)
            .item('text', CORE_STATUS_COMPONENT_ID)
            .textStyle(TYPOGRAPHY.CONTROL)
            .text('CORE   N/A')
            .fill(ColorSchemes.Game?.Font ?? null)
            .item('text', WAVE_PRIMARY_COMPONENT_ID)
            .textStyle(TYPOGRAPHY.CONTROL)
            .text('')
            .fill(ColorSchemes.Game?.Font ?? null)
            .item('text', WAVE_SECONDARY_COMPONENT_ID)
            .textStyle(TYPOGRAPHY.CONTROL)
            .text('')
            .fill(ColorSchemes.Game?.Font ?? null)
            .build();

        this.staticItems = buildResult.staticItems;
        this.dynamicItems = buildResult.dynamicItems;
        this.towerCommand = buildResult.components[TOWER_STATUS_COMPONENT_ID];
        this.coreCommand = buildResult.components[CORE_STATUS_COMPONENT_ID];
        this.wavePrimaryCommand
            = buildResult.components[WAVE_PRIMARY_COMPONENT_ID];
        this.waveSecondaryCommand
            = buildResult.components[WAVE_SECONDARY_COMPONENT_ID];
    }

    #releaseLayout() {
        for (const entry of this.staticItems ?? []) {
            releaseUIItem(entry.item);
        }
        for (const entry of this.dynamicItems ?? []) {
            releaseUIItem(entry.item);
        }
        this.staticItems = null;
        this.dynamicItems = null;
        this.towerCommand = null;
        this.coreCommand = null;
        this.wavePrimaryCommand = null;
        this.waveSecondaryCommand = null;
    }
}

/** @returns {GameSceneStatusRenderer} 새 GameSystem presentation session입니다. */
export function createGameSceneStatusRenderer(options = {}) {
    return new GameSceneStatusRenderer(options);
}
