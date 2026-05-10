import { renderGL } from 'display/display_system.js';
import { drawTitleParallaxEnemy } from './_title_background_parallax.js';
import { getTitleBackgroundColor } from './_title_background_theme.js';
import { clampFiniteNumber } from 'util/number_util.js';

/**
 * 타이틀 배경 채움과 배경 적, 실드 효과를 렌더링합니다.
 * @param {object} options - 렌더 옵션입니다.
 * @param {boolean} options.drawBackgroundFill - 배경 채움 렌더 여부입니다.
 * @param {number} options.ww - 화면 너비입니다.
 * @param {number} options.wh - 화면 높이입니다.
 * @param {object[]} options.titleEnemies - 타이틀 배경 적 목록입니다.
 * @param {object[]} options.parallaxLayers - 페럴랙스 계층 설정 목록입니다.
 * @param {TitleShieldEffect|null} options.shieldEffect - 실드 효과 인스턴스입니다.
 */
export function drawTitleBackgroundScene({
    drawBackgroundFill,
    ww,
    wh,
    titleEnemies,
    parallaxLayers,
    shieldEffect
}) {
    const safeWidth = clampFiniteNumber(Number(ww), 0, Infinity, 0);
    const safeHeight = clampFiniteNumber(Number(wh), 0, Infinity, 0);
    const enemies = Array.isArray(titleEnemies) ? titleEnemies : [];
    const layers = Array.isArray(parallaxLayers) ? parallaxLayers : [];

    if (drawBackgroundFill && safeWidth > 0 && safeHeight > 0) {
        renderGL('background', {
            shape: 'rect',
            x: safeWidth / 2,
            y: safeHeight / 2,
            w: safeWidth,
            h: safeHeight,
            fill: getTitleBackgroundColor()
        });
    }

    if (layers.length === 0) {
        for (let i = 0; i < enemies.length; i++) {
            const enemy = enemies[i];
            if (!enemy || typeof enemy.draw !== 'function') {
                continue;
            }
            enemy.draw();
        }
        shieldEffect?.draw();
        return;
    }

    for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
        for (let i = 0; i < enemies.length; i++) {
            const enemy = enemies[i];
            if (!enemy || enemy._titleParallaxLayerIndex !== layerIndex) {
                continue;
            }
            drawTitleParallaxEnemy(enemy, layers[layerIndex]);
        }
    }

    shieldEffect?.draw();
}
