import { clamp, easeOutExpo } from './_title_magic_bento_motion.js';
import { getBentoAccentColor } from './_title_magic_bento_theme.js';

/**
 * 카드 영역 전체에 퍼지는 글로벌 스포트라이트를 그립니다.
 * @param {CanvasRenderingContext2D} ctx - UI 컨텍스트
 * @param {object} options - 스포트라이트 렌더 옵션입니다.
 * @param {{x:number, y:number, w:number, h:number}} options.groupBounds - 카드 그룹 바운드입니다.
 * @param {number} options.spotlightOpacity - 스포트라이트 투명도입니다.
 * @param {number} options.spotlightX - 스포트라이트 X 좌표입니다.
 * @param {number} options.spotlightY - 스포트라이트 Y 좌표입니다.
 * @param {number} options.uiww - UI 기준 너비입니다.
 * @param {object} options.titleMagicBento - 타이틀 bento 설정입니다.
 */
export function drawBentoGlobalSpotlight(ctx, {
    groupBounds,
    spotlightOpacity,
    spotlightX,
    spotlightY,
    uiww,
    titleMagicBento
}) {
    if (spotlightOpacity <= 0.01 || groupBounds.w <= 0 || groupBounds.h <= 0) {
        return;
    }

    const radius = Math.max(
        titleMagicBento.SPOTLIGHT_RADIUS_MIN,
        uiww * titleMagicBento.SPOTLIGHT_RADIUS_UIWW_RATIO
    );
    const gradient = ctx.createRadialGradient(spotlightX, spotlightY, 0, spotlightX, spotlightY, radius);

    gradient.addColorStop(0, getBentoAccentColor(0.22 * spotlightOpacity));
    gradient.addColorStop(0.2, getBentoAccentColor(0.14 * spotlightOpacity));
    gradient.addColorStop(0.4, getBentoAccentColor(0.08 * spotlightOpacity));
    gradient.addColorStop(0.72, getBentoAccentColor(0.02 * spotlightOpacity));
    gradient.addColorStop(1, getBentoAccentColor(0));

    ctx.save();
    ctx.beginPath();
    ctx.rect(
        groupBounds.x - 48,
        groupBounds.y - 48,
        groupBounds.w + 96,
        groupBounds.h + 96
    );
    ctx.clip();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(spotlightX, spotlightY, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

/**
 * 카드 안쪽의 리플과 입자를 렌더링합니다.
 * @param {CanvasRenderingContext2D} ctx - UI 컨텍스트
 * @param {object} card - 대상 카드
 * @param {number} radius - 카드 모서리 반경
 */
export function drawBentoCardEffects(ctx, card, radius) {
    if (card.particles.length === 0 && card.ripples.length === 0) {
        return;
    }

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0, 0, card.baseWidth, card.baseHeight, radius);
    ctx.clip();
    drawBentoCardRipples(ctx, card);
    drawBentoCardParticles(ctx, card);
    ctx.restore();
}

/**
 * 카드 내부의 클릭 리플을 그립니다.
 * @param {CanvasRenderingContext2D} ctx - UI 컨텍스트
 * @param {object} card - 대상 카드
 */
export function drawBentoCardRipples(ctx, card) {
    for (const ripple of card.ripples) {
        const progress = clamp(ripple.age / ripple.duration, 0, 1);
        const radius = ripple.radius * easeOutExpo(progress);
        const gradient = ctx.createRadialGradient(
            ripple.localX,
            ripple.localY,
            0,
            ripple.localX,
            ripple.localY,
            radius
        );
        const alpha = (1 - progress) * 0.36;

        gradient.addColorStop(0, getBentoAccentColor(alpha));
        gradient.addColorStop(0.35, getBentoAccentColor(alpha * 0.55));
        gradient.addColorStop(1, getBentoAccentColor(0));

        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(ripple.localX, ripple.localY, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

/**
 * 카드 내부에 떠다니는 입자를 그립니다.
 * @param {CanvasRenderingContext2D} ctx - UI 컨텍스트
 * @param {object} card - 대상 카드
 */
export function drawBentoCardParticles(ctx, card) {
    for (const particle of card.particles) {
        const progress = clamp(particle.age / particle.duration, 0, 1);
        const orbit = particle.phase + (progress * Math.PI * 2 * particle.orbitSpeed);
        const alpha = Math.sin(progress * Math.PI) * 0.9 * particle.alphaScale;
        const x = particle.localX + (Math.cos(orbit) * particle.orbitRadius) + (particle.driftX * progress);
        const y = particle.localY + (Math.sin(orbit) * particle.orbitRadius) + (particle.driftY * progress);

        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = getBentoAccentColor(alpha);
        ctx.shadowBlur = particle.size * 3.8;
        ctx.shadowColor = getBentoAccentColor(alpha * 0.95);
        ctx.beginPath();
        ctx.arc(x, y, particle.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}
