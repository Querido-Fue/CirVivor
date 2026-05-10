import { clampFiniteNumber } from 'util/number_util.js';
import { randomRange } from 'util/random_util.js';

const TWO_PI = Math.PI * 2;

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
    const padding = clampFiniteNumber(card.baseWidth * 0.08, 12, Infinity, 12);
    const maxLocalX = clampFiniteNumber(card.baseWidth - padding, padding, Infinity, padding);
    const maxLocalY = clampFiniteNumber(card.baseHeight - padding, padding, Infinity, padding);
    const baseParticleSize = clampFiniteNumber(
        uiww * titleMagicBento.PARTICLE_SIZE_UIWW_RATIO,
        titleMagicBento.PARTICLE_SIZE_MIN,
        Infinity,
        titleMagicBento.PARTICLE_SIZE_MIN
    );
    return {
        localX: randomRange(padding, maxLocalX),
        localY: randomRange(padding, maxLocalY),
        driftX: randomRange(-21, 21),
        driftY: randomRange(-21, 21),
        orbitRadius: randomRange(6, 24),
        orbitSpeed: randomRange(1.4, 3.2),
        phase: randomRange(0, TWO_PI),
        size: baseParticleSize * randomRange(0.55, 1.1),
        duration: randomRange(titleMagicBento.PARTICLE_DURATION_MIN, titleMagicBento.PARTICLE_DURATION_MAX),
        age: randomRange(0, titleMagicBento.PARTICLE_DURATION_MAX),
        alphaScale: randomRange(0.45, 1)
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
    const baseWidth = clampFiniteNumber(Number(card.baseWidth), 0, Infinity, 0);
    const baseHeight = clampFiniteNumber(Number(card.baseHeight), 0, Infinity, 0);
    card.ripples.push({
        localX,
        localY,
        age: 0,
        duration: titleMagicBento.RIPPLE_DURATION,
        radius: Math.max(baseWidth, baseHeight) * 0.9
    });
}
