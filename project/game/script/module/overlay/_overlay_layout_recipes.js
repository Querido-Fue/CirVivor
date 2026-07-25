import { ColorSchemes } from 'display/_theme_handler.js';
import { UI_SPACING } from 'ui/layout/layout_tokens.js';
import { BUTTON_STYLE } from 'ui/style/component_styles.js';
import { TYPOGRAPHY } from 'ui/style/typography.js';

/**
 * 타이틀 계열 오버레이의 공통 제목과 구분선을 추가합니다.
 * 본문 시작 간격과 화면별 배치는 호출부가 계속 소유합니다.
 * @param {import('ui/layout/_layout_handler.js').LayoutHandler} handler - 레이아웃 핸들러입니다.
 * @param {object} options - 제목 레시피 옵션입니다.
 * @param {string} options.title - 표시할 제목입니다.
 * @param {string} [options.titleId='title_text'] - 제목 컴포넌트 ID입니다.
 * @param {string} [options.dividerId='divider_line'] - 구분선 컴포넌트 ID입니다.
 * @param {number} [options.dividerLineWidth=1] - 구분선 두께입니다.
 * @returns {import('ui/layout/_layout_handler.js').LayoutHandler} 같은 레이아웃 핸들러입니다.
 */
export function addOverlayPageHeader(handler, {
    title,
    titleId = 'title_text',
    dividerId = 'divider_line',
    dividerLineWidth = 1
}) {
    return handler
        .paddingX(UI_SPACING.OVERLAY_PAGE_PADDING_X)
        .space(UI_SPACING.OVERLAY_TITLE_TOP)
        .item('text', titleId)
        .textStyle(TYPOGRAPHY.H1)
        .text(title)
        .fill(ColorSchemes.Title.TextDark)
        .space(UI_SPACING.OVERLAY_TITLE_DIVIDER_GAP)
        .item('line', dividerId)
        .width('fill')
        .stroke(ColorSchemes.Overlay.Panel.Divider)
        .lineWidth(dividerLineWidth)
        .align('center');
}

/**
 * 타이틀 계열 오버레이의 공통 단일 닫기 버튼 푸터를 추가합니다.
 * 확인 아이콘 적용 여부와 버튼 색상은 호출부가 계속 소유합니다.
 * @param {import('ui/layout/_layout_handler.js').LayoutHandler} handler - 레이아웃 핸들러입니다.
 * @param {object} options - 닫기 버튼 옵션입니다.
 * @param {string} options.id - 버튼 컴포넌트 ID입니다.
 * @param {string} options.text - 버튼 표시 문구입니다.
 * @param {Function} options.onClick - 버튼 클릭 콜백입니다.
 * @returns {import('ui/layout/_layout_handler.js').LayoutHandler} 같은 레이아웃 핸들러입니다.
 */
export function addOverlayCloseFooter(handler, { id, text, onClick }) {
    return handler
        .bottomSpace(UI_SPACING.OVERLAY_FOOTER_BOTTOM)
        .bottomItem('button', id)
        .buttonStyle(BUTTON_STYLE.OVERLAY_INTERACT)
        .buttonText(text)
        .onClick(onClick)
        .align('right');
}

/**
 * 섹션 제목과 뒤쪽 확장 구분선으로 이루어진 공통 행을 추가합니다.
 * @param {import('ui/layout/_layout_handler.js').LayoutHandler} handler - 레이아웃 핸들러입니다.
 * @param {object} options - 섹션 헤더 옵션입니다.
 * @param {string} options.text - 섹션 제목입니다.
 * @param {number} [options.gapWW=1] - 제목과 구분선 사이 WW 간격입니다.
 * @param {number} [options.widthPercent=100] - parent 기준 행 너비 비율입니다.
 * @returns {import('ui/layout/_layout_handler.js').LayoutHandler} 같은 레이아웃 핸들러입니다.
 */
export function addOverlaySectionHeader(handler, {
    text,
    gapWW = 1,
    widthPercent = 100
}) {
    return handler
        .group()
        .justifyContent('space-between', 'WW', gapWW)
        .width('parent', widthPercent)
        .align('center')
        .item('text')
        .text(text)
        .textStyle(TYPOGRAPHY.H3)
        .fill(ColorSchemes.Overlay.Text.Section)
        .vAlign('center')
        .item('line')
        .width('fill')
        .stroke(ColorSchemes.Overlay.Panel.Divider)
        .lineWidth(1)
        .vAlign('center')
        .endGroup();
}

/**
 * 고정 라벨 영역과 오른쪽 control 영역으로 이루어진 설정 필드 행을 시작합니다.
 * control을 추가한 뒤 반드시 `endOverlayFieldRow()`로 닫아야 합니다.
 * @param {import('ui/layout/_layout_handler.js').LayoutHandler} handler - 레이아웃 핸들러입니다.
 * @param {object} options - 필드 행 옵션입니다.
 * @param {string} options.label - 표시할 라벨입니다.
 * @param {string|null} [options.labelId=null] - 라벨 컴포넌트 ID입니다.
 * @param {number} options.rowWidthPercent - parent 기준 전체 행 너비 비율입니다.
 * @param {number} options.labelWidthPercent - parent 기준 라벨 영역 너비 비율입니다.
 * @param {number} options.controlGapWW - control 영역 내부 WW 간격입니다.
 * @returns {import('ui/layout/_layout_handler.js').LayoutHandler} 같은 레이아웃 핸들러입니다.
 */
export function beginOverlayFieldRow(handler, {
    label,
    labelId = null,
    rowWidthPercent,
    labelWidthPercent,
    controlGapWW
}) {
    return handler
        .group()
        .justifyContent('left', 'WW', 0)
        .width('parent', rowWidthPercent)
        .align('center')
        .group()
        .justifyContent('left', 'WW', 0)
        .width('parent', labelWidthPercent)
        .vAlign('center')
        .item('text', labelId)
        .text(label)
        .textStyle(TYPOGRAPHY.LABEL)
        .fill(ColorSchemes.Overlay.Text.Item)
        .vAlign('center')
        .endGroup()
        .spacer()
        .group()
        .justifyContent('right', 'WW', controlGapWW)
        .vAlign('center');
}

/**
 * 열린 설정 필드 행을 닫고 선택적 설명과 다음 행 간격을 추가합니다.
 * @param {import('ui/layout/_layout_handler.js').LayoutHandler} handler - 레이아웃 핸들러입니다.
 * @param {object} options - 필드 행 하단 옵션입니다.
 * @param {string|null} [options.description=null] - 표시할 설명입니다.
 * @param {number} options.descriptionTopSpaceOH - 설명 위 OH 간격입니다.
 * @param {number} options.descriptionWidthPercent - parent 기준 설명 행 너비 비율입니다.
 * @param {number} options.descriptionAlpha - 설명 불투명도입니다.
 * @param {number} options.bottomSpaceOH - 다음 필드까지의 OH 간격입니다.
 * @returns {import('ui/layout/_layout_handler.js').LayoutHandler} 같은 레이아웃 핸들러입니다.
 */
export function endOverlayFieldRow(handler, {
    description = null,
    descriptionTopSpaceOH,
    descriptionWidthPercent,
    descriptionAlpha,
    bottomSpaceOH
}) {
    handler.endGroup().endGroup();
    if (description === null || description === undefined) {
        return handler.space('OH', bottomSpaceOH);
    }

    return handler
        .space('OH', descriptionTopSpaceOH)
        .group()
        .justifyContent('left', 'WW', 0)
        .width('parent', descriptionWidthPercent)
        .align('center')
        .item('text')
        .text(description)
        .textStyle(TYPOGRAPHY.SETTINGS_DESCRIPTION)
        .fill(ColorSchemes.Overlay.Text.Item)
        .prop('alpha', descriptionAlpha)
        .endGroup()
        .space('OH', bottomSpaceOH);
}
