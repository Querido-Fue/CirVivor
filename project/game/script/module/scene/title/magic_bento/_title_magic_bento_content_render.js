import { getData } from 'data/data_handler.js';
import { getLangString } from 'ui/ui_system.js';
import { drawBentoCardIcon } from './_title_magic_bento_icon.js';
import { drawBentoWrappedText, getBentoTypography } from './_title_magic_bento_text.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');
const TITLE_MAGIC_BENTO = TITLE_CONSTANTS.TITLE_MAGIC_BENTO;
const TEXT_CONSTANTS = getData('TEXT_CONSTANTS');

/**
 * 카드 아이콘과 텍스트를 렌더링합니다.
 * @param {CanvasRenderingContext2D} ctx - UI 컨텍스트
 * @param {object} card - 대상 카드
 * @param {object} palette - 카드 팔레트
 * @param {number} uiww - UI 기준 너비입니다.
 */
export function drawBentoCardContent(ctx, card, palette, uiww) {
    const padding = Math.max(16, uiww * TITLE_MAGIC_BENTO.CONTENT_PADDING_UIWW_RATIO);
    const iconSize = Math.min(card.baseWidth, card.baseHeight) * (card.variant === 'compact' ? 0.19 : 0.21);
    const titleText = getLangString(card.titleKey) || '';
    const descriptionText = card.descriptionKey ? (getLangString(card.descriptionKey) || '') : '';
    const iconX = padding;
    const iconY = card.variant === 'compact'
        ? (card.baseHeight - iconSize) * 0.5
        : padding;

    drawBentoCardIcon(ctx, card.icon, iconX, iconY, iconSize, palette.text);

    ctx.save();
    ctx.fillStyle = palette.text;
    ctx.textBaseline = 'top';

    if (card.variant === 'hero') {
        drawBentoHeroCardText(ctx, card, palette, {
            padding,
            titleText,
            descriptionText
        });
        ctx.restore();
        return;
    }

    if (card.variant === 'compact') {
        drawBentoCompactCardText(ctx, card, {
            padding,
            iconSize,
            titleText
        });
        ctx.restore();
        return;
    }

    drawBentoDefaultCardText(ctx, card, palette, {
        padding,
        titleText,
        descriptionText
    });
    ctx.restore();
}

/**
 * 히어로 카드 텍스트를 렌더링합니다.
 * @param {CanvasRenderingContext2D} ctx - UI 컨텍스트
 * @param {object} card - 대상 카드
 * @param {object} palette - 카드 팔레트
 * @param {object} options - 텍스트 렌더 옵션입니다.
 * @param {number} options.padding - 카드 내부 여백입니다.
 * @param {string} options.titleText - 제목 문자열입니다.
 * @param {string} options.descriptionText - 설명 문자열입니다.
 */
function drawBentoHeroCardText(ctx, card, palette, {
    padding,
    titleText,
    descriptionText
}) {
    const titleFont = getBentoTypography(TEXT_CONSTANTS, 'H3_BOLD', 1.18);
    const descriptionFont = getBentoTypography(TEXT_CONSTANTS, 'H6', 1.04);
    const titleY = card.baseHeight - padding - titleFont.size - (descriptionText ? (descriptionFont.size * 1.7) : 0);

    ctx.font = titleFont.font;
    ctx.fillText(titleText, padding, titleY);

    if (descriptionText) {
        ctx.fillStyle = palette.description;
        ctx.font = descriptionFont.font;
        drawBentoWrappedText(
            ctx,
            descriptionText,
            padding,
            titleY + titleFont.size + Math.max(8, descriptionFont.size * 0.28),
            card.baseWidth - (padding * 2),
            descriptionFont.size * 1.35,
            2
        );
    }
}

/**
 * 컴팩트 카드 텍스트를 렌더링합니다.
 * @param {CanvasRenderingContext2D} ctx - UI 컨텍스트
 * @param {object} card - 대상 카드
 * @param {object} options - 텍스트 렌더 옵션입니다.
 * @param {number} options.padding - 카드 내부 여백입니다.
 * @param {number} options.iconSize - 아이콘 크기입니다.
 * @param {string} options.titleText - 제목 문자열입니다.
 */
function drawBentoCompactCardText(ctx, card, {
    padding,
    iconSize,
    titleText
}) {
    const compactFont = getBentoTypography(TEXT_CONSTANTS, 'H5_BOLD', 1.04);
    const titleSize = compactFont.size;
    const compactX = padding + iconSize + Math.max(14, padding * 0.7);

    ctx.font = compactFont.font;
    ctx.fillText(titleText, compactX, (card.baseHeight - titleSize) * 0.5);
}

/**
 * 기본 카드 텍스트를 렌더링합니다.
 * @param {CanvasRenderingContext2D} ctx - UI 컨텍스트
 * @param {object} card - 대상 카드
 * @param {object} palette - 카드 팔레트
 * @param {object} options - 텍스트 렌더 옵션입니다.
 * @param {number} options.padding - 카드 내부 여백입니다.
 * @param {string} options.titleText - 제목 문자열입니다.
 * @param {string} options.descriptionText - 설명 문자열입니다.
 */
function drawBentoDefaultCardText(ctx, card, palette, {
    padding,
    titleText,
    descriptionText
}) {
    const titleFont = getBentoTypography(TEXT_CONSTANTS, 'H4_BOLD', 1.08);
    const descriptionFont = getBentoTypography(TEXT_CONSTANTS, 'H6', 1.12);
    const titleSize = titleFont.size;
    const descriptionSize = descriptionFont.size;
    const contentX = padding;
    const titleY = card.baseHeight - padding - (descriptionText ? (descriptionSize * 2.3) : titleSize);
    const maxWidth = card.baseWidth - (padding * 2);

    ctx.font = titleFont.font;
    ctx.fillText(titleText, contentX, titleY);

    if (descriptionText) {
        ctx.fillStyle = palette.description;
        ctx.font = descriptionFont.font;
        drawBentoWrappedText(ctx, descriptionText, contentX, titleY + titleSize + Math.max(8, descriptionSize * 0.35), maxWidth, descriptionSize * 1.35, 2);
    }
}
