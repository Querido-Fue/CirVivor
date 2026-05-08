import { lerp } from './_title_magic_bento_motion.js';

/**
 * 카드에 떠다니는 입자들을 업데이트합니다.
 * @param {object} card - 대상 카드
 * @param {number} delta - 프레임 델타
 * @param {boolean} isHovered - 현재 호버 여부
 * @param {object} titleMagicBento - 타이틀 bento 설정입니다.
 * @param {number} uiww - UI 기준 너비입니다.
 */
export function updateBentoCardParticles(card, delta, isHovered, titleMagicBento, uiww) {
    const targetCount = titleMagicBento.PARTICLE_COUNT;

    if (isHovered && card.currentAlpha > 0.65) {
        card.particleSpawnElapsed += delta;
        while (card.particles.length < targetCount && card.particleSpawnElapsed >= titleMagicBento.PARTICLE_SPAWN_INTERVAL) {
            card.particleSpawnElapsed -= titleMagicBento.PARTICLE_SPAWN_INTERVAL;
            card.particles.push(createBentoCardParticle(card, titleMagicBento, uiww));
        }
    } else {
        card.particleSpawnElapsed = 0;
    }

    for (let index = card.particles.length - 1; index >= 0; index--) {
        const particle = card.particles[index];
        particle.age += delta * (isHovered ? 1 : 4);

        if (isHovered && particle.age >= particle.duration) {
            card.particles[index] = createBentoCardParticle(card, titleMagicBento, uiww);
            continue;
        }

        if (!isHovered && particle.age >= particle.duration) {
            card.particles.splice(index, 1);
        }
    }
}

/**
 * 카드 리플 상태를 업데이트합니다.
 * @param {object} card - 대상 카드
 * @param {number} delta - 프레임 델타
 */
export function updateBentoCardRipples(card, delta) {
    for (let index = card.ripples.length - 1; index >= 0; index--) {
        const ripple = card.ripples[index];
        ripple.age += delta;
        if (ripple.age >= ripple.duration) {
            card.ripples.splice(index, 1);
        }
    }
}

/**
 * 카드에 표시할 입자 객체를 생성합니다.
 * @param {object} card - 대상 카드
 * @param {object} titleMagicBento - 타이틀 bento 설정입니다.
 * @param {number} uiww - UI 기준 너비입니다.
 * @returns {object} 입자 상태 객체
 */
export function createBentoCardParticle(card, titleMagicBento, uiww) {
    const padding = Math.max(12, card.baseWidth * 0.08);
    return {
        localX: lerp(padding, Math.max(padding, card.baseWidth - padding), Math.random()),
        localY: lerp(padding, Math.max(padding, card.baseHeight - padding), Math.random()),
        driftX: (Math.random() - 0.5) * 42,
        driftY: (Math.random() - 0.5) * 42,
        orbitRadius: 6 + (Math.random() * 18),
        orbitSpeed: 1.4 + (Math.random() * 1.8),
        phase: Math.random() * Math.PI * 2,
        size: Math.max(titleMagicBento.PARTICLE_SIZE_MIN, uiww * titleMagicBento.PARTICLE_SIZE_UIWW_RATIO) * (0.55 + (Math.random() * 0.55)),
        duration: lerp(titleMagicBento.PARTICLE_DURATION_MIN, titleMagicBento.PARTICLE_DURATION_MAX, Math.random()),
        age: Math.random() * titleMagicBento.PARTICLE_DURATION_MAX,
        alphaScale: 0.45 + (Math.random() * 0.55)
    };
}

/**
 * 카드 클릭 리플을 생성합니다.
 * @param {object} card - 대상 카드
 * @param {number} localX - 카드 내부 X 좌표
 * @param {number} localY - 카드 내부 Y 좌표
 * @param {object} titleMagicBento - 타이틀 bento 설정입니다.
 */
export function spawnBentoCardRipple(card, localX, localY, titleMagicBento) {
    card.ripples.push({
        localX,
        localY,
        age: 0,
        duration: titleMagicBento.RIPPLE_DURATION,
        radius: Math.max(card.baseWidth, card.baseHeight) * 0.9
    });
}
