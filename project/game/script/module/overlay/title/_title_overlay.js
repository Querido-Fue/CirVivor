import { getData } from 'data/data_handler.js';
import { render } from 'display/display_system.js';
import { SVGDrawer } from 'display/_svg_drawer.js';
import { BaseOverlay } from 'overlay/_base_overlay.js';
import { getTitleMenuIconSource } from 'scene/title/menu/_title_menu_icon.js';

const TEXT_CONSTANTS = getData('TEXT_CONSTANTS');
const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');
const TITLE_ICON_LAYOUT = TITLE_CONSTANTS.TITLE_OVERLAY.TITLE_ICON;
const DEFAULT_TITLE_ICON_ASPECT_RATIO = 1;
const TITLE_ICON_ANCHOR_ITEM_IDS = Object.freeze([
    'title_text',
    'dummy_overlay_title'
]);

/**
 * SVG 숫자 속성을 파싱합니다.
 * @param {string} svgSource - SVG 원문입니다.
 * @param {string} attributeName - 조회할 속성 이름입니다.
 * @returns {number} 파싱된 숫자입니다.
 */
const parseSvgNumericAttribute = (svgSource, attributeName) => {
    const match = svgSource.match(new RegExp(`${attributeName}="([\\d.]+)"`, 'i'));
    return Number.parseFloat(match?.[1]);
};

/**
 * 너비/높이 값에서 양수 종횡비를 계산합니다.
 * @param {number} width - 원본 너비입니다.
 * @param {number} height - 원본 높이입니다.
 * @returns {number|null} 계산된 종횡비입니다.
 */
const getPositiveAspectRatio = (width, height) => {
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
        return width / height;
    }

    return null;
};

/**
 * 제목 아이콘의 기준이 되는 텍스트 항목을 찾습니다.
 * @param {Array<{id:string, item:object}>} staticItems - overlay 정적 항목 목록입니다.
 * @returns {{id:string, item:object}|undefined} 제목 기준 항목입니다.
 */
const findTitleIconAnchorEntry = (staticItems) => (
    staticItems.find((entry) => TITLE_ICON_ANCHOR_ITEM_IDS.includes(entry.id))
);

/**
 * @class TitleOverlay
 * @description 타이틀 화면용 overlay 콘텐츠의 공통 베이스입니다.
 */
export class TitleOverlay extends BaseOverlay {
    /**
     * @param {object} titleScene - 타이틀 씬 인스턴스입니다.
     * @param {object} [options={}] - overlay 옵션입니다.
     */
    constructor(titleScene, options = {}) {
        super({
            layer: options.layer === undefined ? 10 : options.layer,
            dim: options.dim === undefined ? 0.28 : options.dim,
            transparent: options.transparent !== false,
            glOverlay: options.glOverlay === true,
            blurUpdateMode: options.blurUpdateMode || 'always',
            effects: options.effects || {}
        });
        this.titleScene = titleScene;
        this._titleIconId = typeof options.titleIconId === 'string' ? options.titleIconId : null;
        this._titleIconScaleMultiplier = Number.isFinite(options.titleIconScaleMultiplier)
            ? options.titleIconScaleMultiplier
            : TITLE_ICON_LAYOUT.DEFAULT_SCALE_MULTIPLIER;
        this._titleIconDrawer = this._titleIconId ? new SVGDrawer() : null;
        this._titleIconSource = null;
        this._titleIconRect = null;

        this._refreshTitleIconSource();
    }

    /**
     * @override
     * 공통 타이틀 아이콘과 제목 행 보정을 레이아웃 생성 직후 적용합니다.
     */
    resize() {
        super.resize();
        this._applyTitleIconLayout();
    }

    /**
     * 제목 아이콘 소스를 현재 테마 기준으로 갱신하고 필요 시 미리 로드합니다.
     */
    _refreshTitleIconSource() {
        if (!this._titleIconDrawer) {
            this._titleIconSource = null;
            return;
        }

        const nextIconSource = this._titleIconId
            ? getTitleMenuIconSource(this._titleIconId)
            : null;

        if (nextIconSource === this._titleIconSource) {
            return;
        }

        if (this._titleIconSource) {
            this._titleIconDrawer.releaseSvgFile(this._titleIconSource);
        }

        this._titleIconSource = nextIconSource;
        if (this._titleIconSource) {
            const loadingIconSource = this._titleIconSource;
            void this._titleIconDrawer.loadSvgFile(loadingIconSource)
                .then(() => {
                    if (this._titleIconSource !== loadingIconSource) {
                        this._titleIconDrawer.releaseSvgFile(loadingIconSource);
                    }
                })
                .catch(() => { });
        }
    }

    /**
     * 제목 왼쪽에 배치할 아이콘 렌더 영역을 계산합니다.
     * @param {object} titleItem - 제목 텍스트 UI 항목입니다.
     * @param {number} aspectRatio - 아이콘의 종횡비입니다.
     * @returns {{x:number, y:number, w:number, h:number}|null} 렌더 영역입니다.
     */
    _getTitleIconRect(titleItem, aspectRatio = 1) {
        if (!titleItem) {
            return null;
        }
        const safeAspectRatio = Number.isFinite(aspectRatio) && aspectRatio > 0
            ? aspectRatio
            : DEFAULT_TITLE_ICON_ASPECT_RATIO;
        const iconGap = this.positioningHandler.parseUIData(TITLE_ICON_LAYOUT.GAP, this.uiScale);
        const titleFontSize = Number.isFinite(titleItem.height) && titleItem.height > 0
            ? titleItem.height
            : this.positioningHandler.parseUIData(TEXT_CONSTANTS.H1.FONT.SIZE, this.uiScale);
        const iconGapTotal = iconGap * TITLE_ICON_LAYOUT.GAP_MULTIPLIER;
        const maxIconHeight = Math.max(
            0,
            titleFontSize
            * TITLE_ICON_LAYOUT.MAX_HEIGHT_RATIO
            * TITLE_ICON_LAYOUT.SCALE_MULTIPLIER
            * this._titleIconScaleMultiplier
        );

        let iconWidth = maxIconHeight * safeAspectRatio;
        let iconHeight = iconWidth / safeAspectRatio;

        return {
            x: titleItem.x,
            y: titleItem.y + ((titleFontSize - iconHeight) * 0.5),
            w: iconWidth,
            h: iconHeight,
            totalOffsetX: iconWidth + iconGapTotal
        };
    }

    /**
     * 현재 타이틀 아이콘 SVG 소스의 종횡비를 계산합니다.
     * @returns {number} 계산된 종횡비입니다.
     */
    _getTitleIconAspectRatio() {
        if (typeof this._titleIconSource !== 'string' || this._titleIconSource.length === 0) {
            return DEFAULT_TITLE_ICON_ASPECT_RATIO;
        }

        const viewBoxMatch = this._titleIconSource.match(/viewBox="[^"]*\s([\d.]+)\s([\d.]+)"/i);
        if (viewBoxMatch) {
            const viewBoxWidth = Number.parseFloat(viewBoxMatch[1]);
            const viewBoxHeight = Number.parseFloat(viewBoxMatch[2]);
            const viewBoxAspectRatio = getPositiveAspectRatio(viewBoxWidth, viewBoxHeight);
            if (viewBoxAspectRatio !== null) {
                return viewBoxAspectRatio;
            }
        }

        return getPositiveAspectRatio(
            parseSvgNumericAttribute(this._titleIconSource, 'width'),
            parseSvgNumericAttribute(this._titleIconSource, 'height')
        ) ?? DEFAULT_TITLE_ICON_ASPECT_RATIO;
    }

    /**
     * 제목 아이콘 위치와 제목 텍스트 오프셋을 현재 레이아웃에 반영합니다.
     */
    _applyTitleIconLayout() {
        this._titleIconRect = null;

        if (!this._titleIconId || !Array.isArray(this.staticItems)) {
            return;
        }

        const titleEntry = findTitleIconAnchorEntry(this.staticItems);
        if (!titleEntry?.item) {
            return;
        }

        const iconRect = this._getTitleIconRect(titleEntry.item, this._getTitleIconAspectRatio());
        if (!iconRect) {
            return;
        }

        titleEntry.item.x += iconRect.totalOffsetX;
        this._titleIconRect = {
            x: iconRect.x,
            y: iconRect.y,
            w: iconRect.w,
            h: iconRect.h
        };
    }

    /**
     * @override
     * 제목 왼쪽 여백에 대응하는 메뉴 아이콘을 그립니다.
     */
    _drawOverlayDecorations() {
        if (!this._titleIconDrawer || !this._titleIconSource) {
            return;
        }

        const iconRecord = this._titleIconDrawer.getCachedSvgFile(this._titleIconSource);
        if (!iconRecord?.image) {
            return;
        }

        const iconRect = this._titleIconRect;
        if (!iconRect || iconRect.w <= 0 || iconRect.h <= 0) {
            return;
        }

        render(this.layer, {
            shape: 'image',
            x: iconRect.x,
            y: iconRect.y,
            w: iconRect.w,
            h: iconRect.h,
            image: iconRecord.image
        });
    }

    /**
     * @override
     * 런타임 설정 변경 시 제목 아이콘 색상 소스를 다시 동기화합니다.
     * @param {object} [changedSettings={}] - 변경된 설정 키와 값입니다.
     */
    applyRuntimeSettings(changedSettings = {}) {
        super.applyRuntimeSettings(changedSettings);

        if (changedSettings.theme !== undefined) {
            this._refreshTitleIconSource();
        }
    }

    /**
     * @override
     * 제목 아이콘 캐시를 정리한 뒤 overlay를 파기합니다.
     */
    destroy() {
        if (this._titleIconDrawer && this._titleIconSource) {
            this._titleIconDrawer.releaseSvgFile(this._titleIconSource);
            this._titleIconSource = null;
        }

        super.destroy();
    }
}
