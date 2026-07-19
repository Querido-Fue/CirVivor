import { getData } from 'data/data_handler.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { render } from 'display/display_system.js';
import {
    isResolvedGameMapFloorCell,
    resolveGameMapDefinition
} from 'scene/game/map/game_map_grid.js';
import { LayoutHandler } from 'ui/layout/_layout_handler.js';
import { getLangString } from 'ui/ui_system.js';
import { applyOverlayConfirmButtonIcon } from '../_overlay_confirm_icon.js';
import { TitleOverlay } from './_title_overlay.js';

const GAME_MAP_DATA = getData('GAME_MAP_DATA');
const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');
const MAP_SELECT = TITLE_CONSTANTS.TITLE_OVERLAY.MAP_SELECT;
const MAP_SELECT_LAYOUT = MAP_SELECT.LAYOUT;
const MAP_PREVIEW = MAP_SELECT.PREVIEW;
const MAP_PREVIEW_ITEM_ID = 'map_select_preview';

/**
 * 맵 미리보기에 사용할 현재 테마 색상을 반환합니다.
 * @returns {{floor:string, grid:string, background:string, selectedStroke:string}} 미리보기 색상입니다.
 */
function getMapPreviewColors() {
    const mapColors = ColorSchemes.Game?.Map;
    return {
        floor: mapColors?.Floor || ColorSchemes.Cursor.Active,
        grid: mapColors?.Grid || ColorSchemes.Overlay.Panel.Divider,
        background: mapColors?.PreviewBackground || ColorSchemes.Overlay.Control.Inactive,
        selectedStroke: mapColors?.SelectedStroke || ColorSchemes.Cursor.Active
    };
}

/**
 * @class MapSelectOverlay
 * @description 등록된 게임 맵을 미리 보고 시작 맵을 확정하는 타이틀 오버레이입니다.
 */
export class MapSelectOverlay extends TitleOverlay {
    /**
     * @param {import('scene/title/_title_scene.js').TitleScene} titleScene - 타이틀 씬 인스턴스입니다.
     */
    constructor(titleScene) {
        super(titleScene);
        this.selectedMapId = resolveGameMapDefinition(GAME_MAP_DATA.DEFAULT_MAP_ID)?.id
            ?? GAME_MAP_DATA.MAPS[0]?.id
            ?? null;
        this.startRequested = false;
        this.previewItem = null;
    }

    /**
     * @override
     * 맵 선택 오버레이 크기를 현재 화면에 맞춰 갱신합니다.
     */
    _onResize() {
        this.width = this.UIWW * MAP_SELECT.WIDTH_UIWW_RATIO;
        this.height = this.WH * MAP_SELECT.HEIGHT_WH_RATIO;
    }

    /**
     * @override
     * 맵 정보와 취소·시작 버튼 레이아웃을 생성합니다.
     */
    _generateLayout() {
        this._releaseElements();
        this.previewItem = null;

        const selectedMap = this.#getSelectedMap();
        const previewColors = getMapPreviewColors();
        const handler = new LayoutHandler(this, this.positioningHandler)
            .paddingX('WW', MAP_SELECT_LAYOUT.PADDING_X_WW)
            .space('WH', MAP_SELECT_LAYOUT.TITLE_TOP_SPACE_WH)
            .item('text', 'title_text')
            .stylePreset('h1')
            .text(getLangString('title_map_select_title'))
            .fill(ColorSchemes.Title.TextDark)
            .space('WH', MAP_SELECT_LAYOUT.DIVIDER_TOP_SPACE_WH)
            .item('line', 'map_select_divider')
            .width('fill')
            .stroke(ColorSchemes.Overlay.Panel.Divider)
            .lineWidth(MAP_PREVIEW.GRID_LINE_WIDTH_ABSOLUTE)
            .align('center')
            .space('WH', MAP_SELECT_LAYOUT.CONTENT_TOP_SPACE_WH)
            .group('map_select_header')
            .justifyContent('space-between', 'WW', MAP_SELECT_LAYOUT.HEADER_GAP_WW)
            .width('fill')
            .item('text', 'map_select_name')
            .stylePreset('h3')
            .text(selectedMap ? getLangString(selectedMap.nameKey) : '')
            .fill(ColorSchemes.Title.TextDark)
            .vAlign('center')
            .spacer()
            .item('text', 'map_select_selected_label')
            .stylePreset('h5')
            .text(getLangString('title_map_select_selected'))
            .fill(previewColors.selectedStroke)
            .vAlign('center')
            .endGroup()
            .space('WH', MAP_SELECT_LAYOUT.PREVIEW_TOP_SPACE_WH)
            .item('button', MAP_PREVIEW_ITEM_ID)
            .width('fill')
            .height('WH', MAP_SELECT_LAYOUT.PREVIEW_HEIGHT_WH)
            .buttonText('')
            .prop('alpha', 0)
            .onClick(() => this.#selectMap(selectedMap?.id))
            .space('WH', MAP_SELECT_LAYOUT.DESCRIPTION_TOP_SPACE_WH)
            .item('text', 'map_select_description')
            .stylePreset('h5')
            .text(selectedMap ? getLangString(selectedMap.descriptionKey) : '')
            .fill(ColorSchemes.Overlay.Text.Item)
            .bottomSpace('WH', MAP_SELECT_LAYOUT.FOOTER_BOTTOM_SPACE_WH)
            .bottomGroup('map_select_actions')
            .justifyContent('right', 'WW', MAP_SELECT_LAYOUT.BUTTON_GAP_WW)
            .align('right')
            .item('button', 'map_select_cancel')
            .stylePreset('overlay_interact_button')
            .buttonText(getLangString('title_map_select_cancel'))
            .buttonColor(ColorSchemes.Overlay.Button.Cancel)
            .icon('deny')
            .onClick(this.close.bind(this))
            .item('button', 'map_select_start')
            .stylePreset('overlay_interact_button')
            .buttonText(getLangString('title_map_select_start'))
            .onClick(this.#startGame.bind(this));

        applyOverlayConfirmButtonIcon(handler);
        handler.endGroup();

        const buildResult = handler.build();
        this.staticItems = buildResult.staticItems;
        this.dynamicItems = buildResult.dynamicItems;
        this.previewItem = buildResult.components[MAP_PREVIEW_ITEM_ID] || null;
    }

    /**
     * @override
     * 선택한 맵의 타일을 동일한 행·열 그리드로 미리보기 렌더링합니다.
     */
    _drawOverlayDecorations() {
        const selectedMap = this.#getSelectedMap();
        const previewItem = this.previewItem;
        if (!selectedMap || !previewItem || previewItem.width <= 0 || previewItem.height <= 0) {
            return;
        }

        const colors = getMapPreviewColors();
        const inset = this.positioningHandler.parseUnit('WH', MAP_PREVIEW.CONTENT_INSET_WH);
        const radius = this.positioningHandler.parseUnit('WH', MAP_PREVIEW.CORNER_RADIUS_WH);
        const gridLineWidth = this.positioningHandler.parseUnit(
            'absolute',
            MAP_PREVIEW.GRID_LINE_WIDTH_ABSOLUTE
        );
        const selectedLineWidth = this.positioningHandler.parseUnit(
            'absolute',
            MAP_PREVIEW.SELECTED_LINE_WIDTH_ABSOLUTE
        );

        render(this.layer, {
            shape: 'roundRect',
            x: previewItem.x,
            y: previewItem.y,
            w: previewItem.width,
            h: previewItem.height,
            radius,
            fill: colors.background,
            stroke: colors.selectedStroke,
            lineWidth: selectedLineWidth
        });

        const availableWidth = Math.max(0, previewItem.width - (inset * 2));
        const availableHeight = Math.max(0, previewItem.height - (inset * 2));
        const cellSize = Math.min(
            availableWidth / selectedMap.columns,
            availableHeight / selectedMap.rows
        );
        if (!Number.isFinite(cellSize) || cellSize <= 0) {
            return;
        }

        const gridWidth = cellSize * selectedMap.columns;
        const gridHeight = cellSize * selectedMap.rows;
        const gridX = previewItem.x + ((previewItem.width - gridWidth) * 0.5);
        const gridY = previewItem.y + ((previewItem.height - gridHeight) * 0.5);

        for (let row = 0; row < selectedMap.rows; row++) {
            for (let column = 0; column < selectedMap.columns; column++) {
                if (!isResolvedGameMapFloorCell(selectedMap, row, column)) {
                    continue;
                }
                render(this.layer, {
                    shape: 'rect',
                    x: gridX + (column * cellSize),
                    y: gridY + (row * cellSize),
                    w: cellSize,
                    h: cellSize,
                    fill: colors.floor
                });
            }
        }

        for (let column = 0; column <= selectedMap.columns; column++) {
            const x = gridX + (column * cellSize);
            render(this.layer, {
                shape: 'line',
                x1: x,
                y1: gridY,
                x2: x,
                y2: gridY + gridHeight,
                stroke: colors.grid,
                lineWidth: gridLineWidth
            });
        }

        for (let row = 0; row <= selectedMap.rows; row++) {
            const y = gridY + (row * cellSize);
            render(this.layer, {
                shape: 'line',
                x1: gridX,
                y1: y,
                x2: gridX + gridWidth,
                y2: y,
                stroke: colors.grid,
                lineWidth: gridLineWidth
            });
        }
    }

    /**
     * 현재 선택 ID에 해당하는 등록 맵을 반환합니다.
     * @returns {object|null} 선택된 맵 정의입니다.
     */
    #getSelectedMap() {
        return resolveGameMapDefinition(this.selectedMapId);
    }

    /**
     * 유효한 맵을 선택하고 레이아웃 표시를 갱신합니다.
     * @param {string|null|undefined} mapId - 선택할 맵 ID입니다.
     */
    #selectMap(mapId) {
        const selectedMap = resolveGameMapDefinition(mapId);
        if (!selectedMap || selectedMap.id === this.selectedMapId) {
            return;
        }

        this.selectedMapId = selectedMap.id;
        this.resize();
    }

    /**
     * 선택한 맵으로 게임 시작을 한 번만 요청합니다.
     */
    #startGame() {
        const selectedMap = this.#getSelectedMap();
        if (this.startRequested || !selectedMap) {
            return;
        }

        this.startRequested = true;
        this.titleScene.gameStart(selectedMap.id);
    }

    /**
     * @override
     * 언어·테마 변경 시 텍스트와 미리보기 스타일을 다시 생성합니다.
     * @param {object} [changedSettings={}] - 변경된 설정 키와 값입니다.
     */
    applyRuntimeSettings(changedSettings = {}) {
        super.applyRuntimeSettings(changedSettings);
        const baseAlreadyResized = changedSettings.uiScale !== undefined
            || changedSettings.disableTransparency !== undefined;
        if (!baseAlreadyResized
            && (changedSettings.language !== undefined || changedSettings.theme !== undefined)) {
            this.resize();
        }
    }
}
