import { getBentoAccentColor } from './_title_magic_bento_theme.js';

/**
 * 카드의 기본 몸체와 그림자를 그립니다.
 * @param {CanvasRenderingContext2D} ctx - UI 컨텍스트
 * @param {object} card - 대상 카드
 * @param {object} palette - 카드 팔레트
 * @param {number} radius - 카드 모서리 반경
 */
export function drawBentoCardBody(ctx, card, palette, radius) {
    const gradient = ctx.createLinearGradient(0, 0, 0, card.baseHeight);
    gradient.addColorStop(0, palette.topFill);
    gradient.addColorStop(1, palette.bottomFill);

    ctx.save();
    traceBentoRoundRect(ctx, 0, 0, card.baseWidth, card.baseHeight, radius);
    ctx.shadowColor = palette.shadow;
    ctx.shadowBlur = 18 + (card.hoverProgress * 14) + (card.glowIntensity * 16);
    ctx.shadowOffsetY = 10 + (card.hoverProgress * 3);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.restore();

    ctx.save();
    traceBentoRoundRect(ctx, 0, 0, card.baseWidth, card.baseHeight, radius);
    ctx.clip();
    const overlay = ctx.createLinearGradient(0, 0, card.baseWidth, card.baseHeight);
    overlay.addColorStop(0, palette.overlayTop);
    overlay.addColorStop(1, palette.overlayBottom);
    ctx.fillStyle = overlay;
    ctx.fillRect(0, 0, card.baseWidth, card.baseHeight);
    ctx.restore();
}

/**
 * 포인터 위치를 중심으로 카드 내부 발광을 그립니다.
 * @param {CanvasRenderingContext2D} ctx - UI 컨텍스트
 * @param {object} card - 대상 카드
 * @param {number} radius - 카드 모서리 반경
 */
export function drawBentoCardSurfaceGlow(ctx, card, radius) {
    if (card.glowIntensity <= 0.01) {
        return;
    }

    const glowRadius = Math.max(card.baseWidth, card.baseHeight) * 0.9;
    const gradient = ctx.createRadialGradient(
        card.localMouseX,
        card.localMouseY,
        0,
        card.localMouseX,
        card.localMouseY,
        glowRadius
    );

    gradient.addColorStop(0, getBentoAccentColor(0.2 * card.glowIntensity));
    gradient.addColorStop(0.28, getBentoAccentColor(0.12 * card.glowIntensity));
    gradient.addColorStop(0.58, getBentoAccentColor(0.05 * card.glowIntensity));
    gradient.addColorStop(1, getBentoAccentColor(0));

    ctx.save();
    traceBentoRoundRect(ctx, 0, 0, card.baseWidth, card.baseHeight, radius);
    ctx.clip();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, card.baseWidth, card.baseHeight);
    ctx.restore();
}

/**
 * 카드 외곽선과 액센트 글로우를 그립니다.
 * @param {CanvasRenderingContext2D} ctx - UI 컨텍스트
 * @param {object} card - 대상 카드
 * @param {object} palette - 카드 팔레트
 * @param {number} radius - 카드 모서리 반경
 * @param {object} titleMagicBento - 타이틀 bento 설정입니다.
 */
export function drawBentoCardBorder(ctx, card, palette, radius, titleMagicBento) {
    const baseBorderWidth = titleMagicBento.BORDER_WIDTH * (1 + (card.hoverProgress * 0.95));

    ctx.save();
    traceBentoRoundRect(ctx, 0, 0, card.baseWidth, card.baseHeight, radius);
    ctx.lineWidth = baseBorderWidth;
    ctx.strokeStyle = palette.border;
    ctx.stroke();
    ctx.restore();

    if (card.hoverProgress > 0.01) {
        ctx.save();
        traceBentoRoundRect(ctx, 0, 0, card.baseWidth, card.baseHeight, radius);
        ctx.lineWidth = baseBorderWidth + (1.2 * card.hoverProgress);
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.16 * card.hoverProgress})`;
        ctx.stroke();
        ctx.restore();
    }

    if (card.glowIntensity <= 0.01) {
        return;
    }

    const glowRadius = Math.max(card.baseWidth, card.baseHeight) * 0.95;
    const borderGradient = ctx.createRadialGradient(
        card.localMouseX,
        card.localMouseY,
        0,
        card.localMouseX,
        card.localMouseY,
        glowRadius
    );

    borderGradient.addColorStop(0, getBentoAccentColor(0.75 * card.glowIntensity));
    borderGradient.addColorStop(0.26, getBentoAccentColor(0.38 * card.glowIntensity));
    borderGradient.addColorStop(0.65, getBentoAccentColor(0.08 * card.glowIntensity));
    borderGradient.addColorStop(1, getBentoAccentColor(0));

    ctx.save();
    traceBentoRoundRect(ctx, 0, 0, card.baseWidth, card.baseHeight, radius);
    ctx.lineWidth = titleMagicBento.BORDER_WIDTH * (2.6 + (card.hoverProgress * 1.8));
    ctx.strokeStyle = borderGradient;
    ctx.shadowBlur = 22 + (card.glowIntensity * 18) + (card.hoverProgress * 16);
    ctx.shadowColor = getBentoAccentColor(0.82 * card.glowIntensity);
    ctx.stroke();
    ctx.restore();
}

/**
 * 카드용 둥근 사각형 경로를 생성합니다.
 * @param {CanvasRenderingContext2D} ctx - UI 컨텍스트
 * @param {number} x - X 좌표
 * @param {number} y - Y 좌표
 * @param {number} width - 너비
 * @param {number} height - 높이
 * @param {number} radius - 모서리 반경
 */
function traceBentoRoundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
}
