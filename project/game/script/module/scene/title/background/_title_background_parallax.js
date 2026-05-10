import { clampNumber, resolveFiniteNumber } from 'util/number_util.js';

import { mixTitleEnemyColorWithBackground } from './_title_background_theme.js';

/**
 * 다중 softness 보조 패스를 단일 패스로 압축할 때 보정하는 알파 배율입니다.
 * @type {number}
 */
const TITLE_ENEMY_SOFTNESS_ALPHA_MULTIPLIER = 2.2;

/**
 * 다중 softness 보조 패스를 단일 패스로 압축할 때 보정하는 크기 배율입니다.
 * @type {number}
 */
const TITLE_ENEMY_SOFTNESS_SCALE_EXPANSION = 1.035;

/**
 * 적에 페럴렉스 시각/반응 프로필을 적용합니다.
 * @param {object} enemy - 적용할 적 인스턴스입니다.
 * @param {object} layerProfile - 적용할 레이어 프로필입니다.
 * @param {number} [layerIndex=0] - 레이어 인덱스입니다.
 */
export function applyTitleParallaxVisualProfile(enemy, layerProfile, layerIndex = 0) {
    if (!enemy || !layerProfile) {
        return;
    }

    enemy._titleParallaxLayerIndex = layerIndex;
    enemy._titleParallaxMotionScale = resolveFiniteNumber(layerProfile.MagneticScale, 1);
    enemy._titleParallaxFill = mixTitleEnemyColorWithBackground(layerProfile.ColorMix);
    enemy.fill = enemy._titleParallaxFill;
    enemy.alpha = resolveFiniteNumber(layerProfile.Alpha, 1);
}

/**
 * 페럴렉스 계층에 맞는 적 렌더 패스를 그립니다.
 * @param {object} enemy - 그릴 적 인스턴스입니다.
 * @param {object} layerProfile - 적용할 레이어 프로필입니다.
 */
export function drawTitleParallaxEnemy(enemy, layerProfile) {
    if (!enemy || !layerProfile) {
        return;
    }

    const softnessAlpha = resolveFiniteNumber(layerProfile.SoftnessAlpha, 0);
    const softnessScale = resolveFiniteNumber(layerProfile.SoftnessScale, 1);
    const softnessOffsetPx = resolveFiniteNumber(layerProfile.SoftnessOffsetPx, 0);

    if (softnessAlpha > 0.001 && softnessScale > 1) {
        const blurFill = mixTitleEnemyColorWithBackground(Math.min(1, (layerProfile.ColorMix || 0) + 0.12));
        const blurAlpha = Math.min(1, enemy.alpha * softnessAlpha * TITLE_ENEMY_SOFTNESS_ALPHA_MULTIPLIER);
        enemy.draw({
            fill: blurFill,
            alpha: blurAlpha,
            sizeScale: softnessScale * TITLE_ENEMY_SOFTNESS_SCALE_EXPANSION,
            offsetX: softnessOffsetPx * 0.25,
            offsetY: softnessOffsetPx * 0.25
        });
    }

    enemy.draw({
        fill: enemy._titleParallaxFill || enemy.fill,
        alpha: enemy.alpha
    });
}

/**
 * 현재 적이 속한 페럴렉스 레이어 설정을 반환합니다.
 * @param {object[]} parallaxLayers - 페럴렉스 레이어 설정 목록입니다.
 * @param {number} layerIndex - 조회할 레이어 인덱스입니다.
 * @param {object} titleEnemiesConfig - 타이틀 적 설정입니다.
 * @returns {object} 레이어 프로필입니다.
 */
export function getTitleParallaxLayerProfile(parallaxLayers, layerIndex, titleEnemiesConfig) {
    if (!Array.isArray(parallaxLayers) || parallaxLayers.length === 0) {
        return getTitleDefaultParallaxLayerProfile(titleEnemiesConfig);
    }

    const resolvedIndex = Number.isInteger(layerIndex)
        ? clampNumber(layerIndex, 0, parallaxLayers.length - 1)
        : 0;
    return parallaxLayers[resolvedIndex];
}

/**
 * 페럴렉스 계층이 없을 때 사용할 기본 시각 프로필을 반환합니다.
 * @param {object} titleEnemiesConfig - 타이틀 적 설정입니다.
 * @returns {object} 기본 페럴렉스 프로필입니다.
 */
export function getTitleDefaultParallaxLayerProfile(titleEnemiesConfig) {
    return {
        Id: 'default',
        SizeMin: titleEnemiesConfig.ENEMY_SIZE_MIN,
        SizeMax: Math.min(1, titleEnemiesConfig.ENEMY_SIZE_MAX),
        Alpha: 0.55,
        SpeedScale: 1,
        MagneticScale: 1,
        ColorMix: 0,
        SoftnessScale: 1,
        SoftnessAlpha: 0,
        SoftnessOffsetPx: 0
    };
}
