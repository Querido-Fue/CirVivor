import { getData } from 'data/data_handler.js';
import { getUIOffsetX, getUIWW, getWH, getWW } from 'display/display_system.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');
const TITLE_CARD_MENU = TITLE_CONSTANTS.TITLE_CARD_MENU;
const TITLE_CARD_MENU_SCALE = 0.848;

/**
 * @typedef {object} TitleMenuCardRect
 * @property {number} x - 카드 좌상단 X 좌표입니다.
 * @property {number} y - 카드 좌상단 Y 좌표입니다.
 * @property {number} w - 카드 너비입니다.
 * @property {number} h - 카드 높이입니다.
 * @property {number} radius - 카드 라운드 반경입니다.
 */

/**
 * @class TitleMenuLayout
 * @description 타이틀 카드 메뉴의 기준 레이아웃을 계산하는 클래스입니다.
 */
export class TitleMenuLayout {
    constructor() {
        this.WW = 0;
        this.WH = 0;
        this.UIWW = 0;
        this.UIOffsetX = 0;
        this.metrics = {};
        this.resize();
    }

    /**
     * 현재 화면 기준 메트릭을 다시 계산합니다.
     * @returns {object} 계산된 메트릭입니다.
     */
    resize() {
        this.WW = getWW();
        this.WH = getWH();
        this.UIWW = getUIWW();
        this.UIOffsetX = getUIOffsetX();
        this.metrics = this._buildMetrics();
        return this.metrics;
    }

    /**
     * 로고 정렬 기준점 정보를 반환합니다.
     * @returns {{x:number, y:number}} 로고 정렬 기준점입니다.
     */
    getLogoAnchor() {
        return {
            x: this.UIOffsetX + (this.UIWW * TITLE_CARD_MENU.LOGO_LEFT_MARGIN_UIWW_RATIO),
            y: this.WH * TITLE_CARD_MENU.LOGO_TOP_MARGIN_WH_RATIO
        };
    }

    /**
     * 카드 정의 목록을 카드 rect 목록으로 변환합니다.
     * @param {Array<{id:string, layoutSlot:string}>} cardDefinitions - 카드 정의 목록입니다.
     * @returns {Map<string, TitleMenuCardRect>} 카드 rect 맵입니다.
     */
    buildCardRects(cardDefinitions) {
        const layoutRects = this._buildSlotRects();
        const result = new Map();

        for (const cardDefinition of cardDefinitions) {
            const layoutRect = layoutRects[cardDefinition.layoutSlot];
            if (!layoutRect) {
                continue;
            }
            result.set(cardDefinition.id, {
                x: layoutRect.x,
                y: layoutRect.y,
                w: layoutRect.w,
                h: layoutRect.h,
                radius: layoutRect.radius
            });
        }

        return result;
    }

    /**
     * 내부 메트릭 정보를 구성합니다.
     * @returns {object} 구성된 메트릭입니다.
     * @private
     */
    _buildMetrics() {
        const gap = this.UIWW * TITLE_CARD_MENU.GRID_GAP_UIWW_RATIO * TITLE_CARD_MENU_SCALE;
        const columnWidth = this.UIWW * TITLE_CARD_MENU.COLUMN_WIDTH_UIWW_RATIO * TITLE_CARD_MENU_SCALE;
        const largeCardHeight = columnWidth * TITLE_CARD_MENU.LARGE_CARD_HEIGHT_TO_WIDTH_RATIO;
        const stackedAreaHeight = Math.max(1, largeCardHeight - gap);
        const quickRatio = TITLE_CARD_MENU.QUICK_START_TO_RECORD_RATIO;
        const quickStartHeight = stackedAreaHeight * (quickRatio / (quickRatio + 1));
        const recordsHeight = stackedAreaHeight - quickStartHeight;
        const radius = Math.max(12, this.WH * TITLE_CARD_MENU.CARD_RADIUS_WH_RATIO);
        const rightColumnX = this.WW - (this.UIWW * TITLE_CARD_MENU.GRID_RIGHT_MARGIN_UIWW_RATIO) - columnWidth;
        const leftColumnX = rightColumnX - gap - columnWidth;
        const groupHeight = largeCardHeight + gap + quickStartHeight;
        const topY = this.WH - (this.WH * TITLE_CARD_MENU.GRID_BOTTOM_MARGIN_WH_RATIO) - groupHeight;

        return {
            gap,
            columnWidth,
            largeCardHeight,
            quickStartHeight,
            recordsHeight,
            radius,
            leftColumnX,
            rightColumnX,
            topY
        };
    }

    /**
     * 슬롯별 rect 정의를 생성합니다.
     * @returns {Record<string, TitleMenuCardRect>} 슬롯 rect 목록입니다.
     * @private
     */
    _buildSlotRects() {
        const metrics = this.metrics;
        const bottomRowY = metrics.topY + metrics.largeCardHeight + metrics.gap;
        const quickStartY = metrics.topY;
        const recordsY = quickStartY + metrics.quickStartHeight + metrics.gap;

        return {
            start: {
                x: metrics.leftColumnX,
                y: metrics.topY,
                w: metrics.columnWidth,
                h: metrics.largeCardHeight,
                radius: metrics.radius
            },
            quick_start: {
                x: metrics.rightColumnX,
                y: quickStartY,
                w: metrics.columnWidth,
                h: metrics.quickStartHeight,
                radius: metrics.radius
            },
            records: {
                x: metrics.rightColumnX,
                y: recordsY,
                w: metrics.columnWidth,
                h: metrics.recordsHeight,
                radius: metrics.radius
            },
            deck: {
                x: metrics.leftColumnX,
                y: bottomRowY,
                w: metrics.columnWidth,
                h: metrics.quickStartHeight,
                radius: metrics.radius
            },
            research: {
                x: metrics.rightColumnX,
                y: bottomRowY,
                w: metrics.columnWidth,
                h: metrics.quickStartHeight,
                radius: metrics.radius
            }
        };
    }
}
