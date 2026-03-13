import { ColorSchemes } from 'display/_theme_handler.js';
import { getWW, getWH, getObjectWH, getObjectOffsetY, getUIWW, renderGL } from 'display/display_system.js';
import { getFixedDelta, getFixedInterpolationAlpha } from 'game/time_handler.js';
import { mathUtil } from 'util/math_util.js';
import { colorUtil } from 'util/color_util.js';
import { getMouseFocus, getMouseInput, isMousePressing } from 'input/input_system.js';
import { getData } from 'data/data_handler.js';
import { getObjectSystem } from 'object/object_system.js';
import { titleAI } from 'object/enemy/ai/_title_ai.js';
import { TitleShieldEffect } from './_title_shield_effect.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');
const ENEMY_SHAPE_TYPES = getData('ENEMY_SHAPE_TYPES');
const TITLE_ENEMY_SPAWN_CULL_GUARD_PX = 0.5;
const TITLE_PARALLAX_LAYERS = TITLE_CONSTANTS.TITLE_ENEMIES.PARALLAX_LAYERS || [];

/**
 * 로고/배경에서 사용할 기본 적 색상을 반환합니다.
 * @returns {string} 적 기본 색상
 */
function getTitleEnemyColor() {
    return ColorSchemes?.Title?.Enemy
        || ColorSchemes?.Title?.TextDark
        || ColorSchemes?.Title?.Button?.Text
        || ColorSchemes?.Title?.Menu?.Foreground
        || ColorSchemes?.Background;
}

/**
 * 배경에서 사용할 기본 색상을 반환합니다.
 * @returns {string} 배경 기본 색상
 */
function getTitleBackgroundColor() {
    return ColorSchemes?.Title?.Background
        || ColorSchemes?.Background;
}

/**
 * @class TitleBackGround
 * @description 타이틀 화면 배경을 관리하며, 오브젝트 적을 랜덤 스폰/업데이트/렌더링합니다.
 */
export class TitleBackGround {
    /**
     * @param {TitleScene} titleScene
     * @param {{drawBackgroundFill?: boolean}} [options={}] - 타이틀 배경 렌더 옵션입니다.
     */
    constructor(titleScene, options = {}) {
        this.titleScene = titleScene;
        this.drawBackgroundFill = options.drawBackgroundFill !== false;
        this.objectSystem = getObjectSystem();
        const excludedTypes = TITLE_CONSTANTS.TITLE_ENEMIES.ENEMY_EXCLUDED_TYPES || [];
        this.enemyTypes = ENEMY_SHAPE_TYPES.filter((type) => !excludedTypes.includes(type));
        if (this.enemyTypes.length === 0) {
            this.enemyTypes = ENEMY_SHAPE_TYPES;
        }
        this.titleEnemies = [];

        this.shapesPerSecond = TITLE_CONSTANTS.TITLE_ENEMIES.ENEMY_SPAWN_RATE;
        this.shapeSpawnCounter = 0;
        this.shieldLayout = null;
        this.enemySpawnEnabled = false;
        this.WW = getWW();
        this.WH = getWH();
        this.objectWH = getObjectWH();
        this.objectOffsetY = getObjectOffsetY();
        this.UIWW = getUIWW();
        this.shieldRadius = 0;
        this.shieldEffect = new TitleShieldEffect();

        this.init();
    }

    /**
         * 타이틀 적 스폰 카운터를 초기화합니다.
         */
    init() {
        this.shapeSpawnCounter = 0;
    }

    /**
         * 윈도우 리사이즈 시 기존에 생성된 타이틀 적들의 크기 및 위치 비율 재계산 수행
         */
    resize() {
        const prevWW = this.WW || 1;
        const prevObjectWH = this.objectWH || 1;
        const prevUIWW = this.UIWW || 1;

        this.WW = getWW();
        this.WH = getWH();
        this.objectWH = getObjectWH();
        this.objectOffsetY = getObjectOffsetY();
        this.UIWW = getUIWW();

        const ratioX = this.WW / Math.max(1, prevWW);
        const ratioY = this.objectWH / Math.max(1, prevObjectWH);

        for (const enemy of this.titleEnemies) {
            enemy.position.x *= ratioX;
            enemy.position.y *= ratioY;
            enemy.prevPosition.x = enemy.position.x;
            enemy.prevPosition.y = enemy.position.y;
            enemy.renderPosition.x = enemy.position.x;
            enemy.renderPosition.y = enemy.position.y;
            enemy.speed.x *= ratioX;
            enemy.speed.y *= ratioY;
            enemy.resizeAI({
                ratioX,
                ratioY,
                ratioUI: this.UIWW / Math.max(1, prevUIWW),
                ww: this.WW,
                wh: this.WH,
                uiww: this.UIWW
            });
        }
    }

    /**
     * @param {{centerX:number, centerY:number, radius:number}|null} shieldLayout - 적과 실드가 공유할 중심/반경 정보입니다.
     * @param {boolean} [enemySpawnEnabled=false] - 신규 적 스폰 허용 여부입니다.
     */
    update(shieldLayout, enemySpawnEnabled = false) {
        this.shieldLayout = shieldLayout;
        this.enemySpawnEnabled = enemySpawnEnabled === true;
        this.shieldEffect.syncLayout(shieldLayout);
        this.shieldRadius = this.shieldEffect ? this.shieldEffect.getShieldRadius() : 0;
        const alpha = getFixedInterpolationAlpha();

        for (let i = this.titleEnemies.length - 1; i >= 0; i--) {
            const enemy = this.titleEnemies[i];
            if (!enemy || !enemy.active) {
                this.#releaseEnemyAt(i);
                continue;
            }

            enemy.interpolatePosition(alpha);
            if (enemy.isOutsideScreen(this.WW, this.objectWH, TITLE_CONSTANTS.TITLE_ENEMIES.ENEMY_CULL_OUTSIDE_RATIO)) {
                this.#releaseEnemyAt(i);
            }
        }

        this.shieldEffect.update(this.titleEnemies, this.objectOffsetY);
    }

    /**
     * 고정 틱에서 타이틀 적의 이동/스폰/충돌을 처리합니다.
     */
    fixedUpdate() {
        const delta = getFixedDelta();
        if (!Number.isFinite(delta) || delta <= 0) return;

        const mousePos = getMouseInput('pos');
        const focus = getMouseFocus();
        const objectFocused = Array.isArray(focus) && focus.includes('object');
        const mousePosInObject = mousePos
            ? { x: mousePos.x, y: mousePos.y + this.objectOffsetY }
            : null;
        const shieldMagneticPointInObject = this.shieldLayout
            ? { x: this.shieldLayout.centerX, y: this.shieldLayout.centerY + this.objectOffsetY }
            : null;

        const aiContext = {
            uiww: this.UIWW,
            logoMagneticPoint: shieldMagneticPointInObject,
            logoMagneticDistance: this.shieldRadius * (
                Number.isFinite(TITLE_CONSTANTS.TITLE_AI.LOGO_DISTANCE_MULTIPLIER)
                    ? Math.max(1, TITLE_CONSTANTS.TITLE_AI.LOGO_DISTANCE_MULTIPLIER)
                    : 1
            ),
            objectFocused,
            leftPressing: isMousePressing('left'),
            mousePos: mousePosInObject
        };

        for (let i = this.titleEnemies.length - 1; i >= 0; i--) {
            const enemy = this.titleEnemies[i];
            if (!enemy || !enemy.active) continue;
            enemy.beginFixedStep();
            enemy.fixedUpdate(delta, aiContext);
        }

        this.#resolveTitleEnemyCollisions(delta);

        if (this.enemySpawnEnabled && this.titleEnemies.length < TITLE_CONSTANTS.TITLE_ENEMIES.ENEMY_LIMIT) {
            this.shapeSpawnCounter += this.shapesPerSecond * delta;
            let shapesToSpawn = Math.floor(this.shapeSpawnCounter);

            const availableSlots = TITLE_CONSTANTS.TITLE_ENEMIES.ENEMY_LIMIT - this.titleEnemies.length;
            if (shapesToSpawn > availableSlots) {
                shapesToSpawn = availableSlots;
            }

            if (shapesToSpawn > 0) {
                this.pushShape(shapesToSpawn);
                this.shapeSpawnCounter -= shapesToSpawn;
                this.#resolveTitleEnemyCollisions(delta);
            }
        }
    }

    /**
         * 타이틀 백그라운드와 적 요소를 렌더링
         */
    draw() {
        if (this.drawBackgroundFill) {
            renderGL('background', {
                shape: 'rect',
                x: this.WW / 2,
                y: this.WH / 2,
                w: this.WW,
                h: this.WH,
                fill: ColorSchemes.Title.Background
            });
        }

        if (!Array.isArray(TITLE_PARALLAX_LAYERS) || TITLE_PARALLAX_LAYERS.length === 0) {
            for (let i = 0; i < this.titleEnemies.length; i++) {
                this.titleEnemies[i].draw();
            }
            this.shieldEffect.draw();
            return;
        }

        for (let layerIndex = 0; layerIndex < TITLE_PARALLAX_LAYERS.length; layerIndex++) {
            for (let i = 0; i < this.titleEnemies.length; i++) {
                const enemy = this.titleEnemies[i];
                if (!enemy || enemy._titleParallaxLayerIndex !== layerIndex) {
                    continue;
                }
                this.#drawParallaxEnemy(enemy, TITLE_PARALLAX_LAYERS[layerIndex]);
            }
        }

        this.shieldEffect.draw();
    }

    /**
     * 현재 테마 색상에 맞춰 배경 적의 채움 색상을 갱신합니다.
     */
    applyTheme() {
        for (const enemy of this.titleEnemies) {
            if (!enemy) {
                continue;
            }
            this.#applyParallaxVisualProfile(
                enemy,
                this.#getParallaxLayerProfile(enemy._titleParallaxLayerIndex)
            );
        }
    }

    /**
         * 지정 횟수만큼 타이틀 적 형상을 배열에 추가합니다.
         * @param {number} times 스폰 횟수
         */
    pushShape(times) {
        if (!this.objectSystem) {
            this.objectSystem = getObjectSystem();
        }
        if (!this.objectSystem || this.enemyTypes.length === 0) return;

        for (let i = 0; i < times; i++) {
            const type = this.enemyTypes[Math.floor(mathUtil().random(0, this.enemyTypes.length))];
            const spawn = this.#buildSpawnData();
            const layerProfile = spawn.layerProfile;
            const enemy = this.objectSystem.acquireEnemy(type, {
                type,
                hp: 1,
                maxHp: 1,
                atk: 1,
                moveSpeed: 1,
                accSpeed: 0,
                size: mathUtil().random(layerProfile.SizeMin, layerProfile.SizeMax),
                position: spawn.position,
                speed: spawn.speed,
                acc: { x: 0, y: 0 },
                ai: titleAI,
                fill: ColorSchemes.Title.Enemy,
                alpha: layerProfile.Alpha,
                rotation: mathUtil().random(0, 360)
            });
            if (!enemy) continue;
            this.#applyParallaxVisualProfile(enemy, layerProfile, spawn.layerIndex);
            this.titleEnemies.push(enemy);
        }
    }

    /**
         * 배열 내 특정 인덱스의 적을 풀에 반환 및 리스트에서 제거합니다.
         * @param {number} index
         * @private
         */
    #releaseEnemyAt(index) {
        const enemy = this.titleEnemies[index];
        if (!enemy) return;

        if (this.objectSystem && typeof this.objectSystem.releaseEnemyToPool === 'function') {
            this.objectSystem.releaseEnemyToPool(enemy);
        } else if (enemy && typeof enemy.release === 'function') {
            enemy.release();
        }

        const lastIndex = this.titleEnemies.length - 1;
        if (index !== lastIndex) {
            this.titleEnemies[index] = this.titleEnemies[lastIndex];
        }
        this.titleEnemies.pop();
    }

    /**
         * 타이틀 배경을 소멸시키며 모든 적을 풀로 강제 반환합니다.
         */
    destroy() {
        if (this.shieldEffect) {
            this.shieldEffect.destroy();
            this.shieldEffect = null;
        }
        this.shieldLayout = null;
        this.shieldRadius = 0;
        for (let i = this.titleEnemies.length - 1; i >= 0; i--) {
            this.#releaseEnemyAt(i);
        }
    }

    /**
     * 적 생성 데이터 구조(위치, 속도 비율 등)를 반환합니다.
         * @returns {object} 위치 및 속도 데이터
         * @private
         */
    #buildSpawnData() {
        const cullRatio = TITLE_CONSTANTS.TITLE_ENEMIES.ENEMY_CULL_OUTSIDE_RATIO;
        const marginY = this.objectWH * cullRatio;
        const marginX = this.WW * cullRatio;
        const spawnXByRatio = this.WW * TITLE_CONSTANTS.TITLE_ENEMIES.ENEMY_SPAWN_X_RATIO;
        const spawnX = Math.min(spawnXByRatio, (this.WW + marginX) - TITLE_ENEMY_SPAWN_CULL_GUARD_PX);
        const layerData = this.#pickParallaxLayer();
        const axisSpeed = this.UIWW * mathUtil().random(
            TITLE_CONSTANTS.TITLE_ENEMIES.AXIS_SPEED_MIN_RATIO,
            TITLE_CONSTANTS.TITLE_ENEMIES.AXIS_SPEED_MAX_RATIO
        ) * layerData.profile.SpeedScale;
        const driftSpeed = this.UIWW * mathUtil().random(
            TITLE_CONSTANTS.TITLE_ENEMIES.DRIFT_SPEED_MIN_RATIO,
            TITLE_CONSTANTS.TITLE_ENEMIES.DRIFT_SPEED_MAX_RATIO
        ) * layerData.profile.SpeedScale;
        const spawnY = mathUtil().random(-marginY, this.objectWH + marginY);

        return {
            layerIndex: layerData.index,
            layerProfile: layerData.profile,
            position: {
                x: spawnX,
                y: spawnY
            },
            speed: { x: -axisSpeed, y: driftSpeed }
        };
    }

    /**
     * 같은 페럴렉스 계층끼리만 충돌을 해소합니다.
     * @param {number} delta - 고정 틱 델타입니다.
     * @private
     */
    #resolveTitleEnemyCollisions(delta) {
        if (!this.objectSystem || typeof this.objectSystem.resolveEnemyCollisions !== 'function') {
            return;
        }

        if (!Array.isArray(TITLE_PARALLAX_LAYERS) || TITLE_PARALLAX_LAYERS.length === 0) {
            this.objectSystem.resolveEnemyCollisions(this.titleEnemies, { delta });
            return;
        }

        for (let layerIndex = 0; layerIndex < TITLE_PARALLAX_LAYERS.length; layerIndex++) {
            const layerEnemies = this.titleEnemies.filter(
                (enemy) => enemy && enemy.active && enemy._titleParallaxLayerIndex === layerIndex
            );
            if (layerEnemies.length <= 1) {
                continue;
            }
            this.objectSystem.resolveEnemyCollisions(layerEnemies, { delta });
        }
    }

    /**
     * 적에 페럴렉스 시각/반응 프로필을 적용합니다.
     * @param {object} enemy - 적용할 적 인스턴스입니다.
     * @param {object} layerProfile - 적용할 레이어 프로필입니다.
     * @param {number} [layerIndex=0] - 레이어 인덱스입니다.
     * @private
     */
    #applyParallaxVisualProfile(enemy, layerProfile, layerIndex = 0) {
        if (!enemy || !layerProfile) {
            return;
        }

        enemy._titleParallaxLayerIndex = layerIndex;
        enemy._titleParallaxMotionScale = Number.isFinite(layerProfile.MagneticScale)
            ? layerProfile.MagneticScale
            : 1;
        enemy._titleParallaxFill = this.#mixEnemyColorWithBackground(layerProfile.ColorMix);
        enemy.fill = enemy._titleParallaxFill;
        enemy.alpha = Number.isFinite(layerProfile.Alpha) ? layerProfile.Alpha : 1;
    }

    /**
     * 페럴렉스 계층에 맞는 적 렌더 패스를 그립니다.
     * @param {object} enemy - 그릴 적 인스턴스입니다.
     * @param {object} layerProfile - 적용할 레이어 프로필입니다.
     * @private
     */
    #drawParallaxEnemy(enemy, layerProfile) {
        if (!enemy || !layerProfile) {
            return;
        }

        const softnessAlpha = Number.isFinite(layerProfile.SoftnessAlpha) ? layerProfile.SoftnessAlpha : 0;
        const softnessScale = Number.isFinite(layerProfile.SoftnessScale) ? layerProfile.SoftnessScale : 1;
        const softnessOffsetPx = Number.isFinite(layerProfile.SoftnessOffsetPx) ? layerProfile.SoftnessOffsetPx : 0;

        if (softnessAlpha > 0.001 && softnessScale > 1) {
            const blurFill = this.#mixEnemyColorWithBackground(Math.min(1, (layerProfile.ColorMix || 0) + 0.12));
            const blurAlpha = enemy.alpha * softnessAlpha;
            enemy.draw({
                fill: blurFill,
                alpha: blurAlpha,
                sizeScale: softnessScale,
                offsetX: -softnessOffsetPx,
                offsetY: 0
            });
            enemy.draw({
                fill: blurFill,
                alpha: blurAlpha,
                sizeScale: softnessScale,
                offsetX: softnessOffsetPx,
                offsetY: 0
            });
            enemy.draw({
                fill: blurFill,
                alpha: blurAlpha,
                sizeScale: softnessScale,
                offsetX: 0,
                offsetY: -softnessOffsetPx
            });
            enemy.draw({
                fill: blurFill,
                alpha: blurAlpha,
                sizeScale: softnessScale,
                offsetX: 0,
                offsetY: softnessOffsetPx
            });
            enemy.draw({
                fill: blurFill,
                alpha: blurAlpha * 0.85,
                sizeScale: softnessScale * 1.02
            });
        }

        enemy.draw({
            fill: enemy._titleParallaxFill || enemy.fill,
            alpha: enemy.alpha
        });
    }

    /**
     * 사용할 페럴렉스 레이어를 하나 고릅니다.
     * @returns {{index:number, profile:object}} 레이어 인덱스와 설정값입니다.
     * @private
     */
    #pickParallaxLayer() {
        if (!Array.isArray(TITLE_PARALLAX_LAYERS) || TITLE_PARALLAX_LAYERS.length === 0) {
            return {
                index: 0,
                profile: {
                    Id: 'default',
                    SizeMin: TITLE_CONSTANTS.TITLE_ENEMIES.ENEMY_SIZE_MIN,
                    SizeMax: Math.min(1, TITLE_CONSTANTS.TITLE_ENEMIES.ENEMY_SIZE_MAX),
                    Alpha: 0.55,
                    SpeedScale: 1
                }
            };
        }

        const layerIndex = Math.floor(mathUtil().random(0, TITLE_PARALLAX_LAYERS.length));
        return {
            index: layerIndex,
            profile: TITLE_PARALLAX_LAYERS[layerIndex]
        };
    }

    /**
     * 적 색상과 배경색을 RGB 기준으로 섞어 거리감을 만듭니다.
     * @param {number} mixRatio - 배경색으로 섞을 비율입니다.
     * @returns {string} 혼합된 RGBA 문자열입니다.
     * @private
     */
    #mixEnemyColorWithBackground(mixRatio) {
        const ratio = Number.isFinite(mixRatio) ? Math.max(0, Math.min(1, mixRatio)) : 0;
        const util = colorUtil();
        const enemyColor = util.cssToRgb(getTitleEnemyColor());
        const backgroundColor = util.cssToRgb(getTitleBackgroundColor());
        if (!enemyColor || !backgroundColor) {
            return 'transparent';
        }
        const r = enemyColor.r + ((backgroundColor.r - enemyColor.r) * ratio);
        const g = enemyColor.g + ((backgroundColor.g - enemyColor.g) * ratio);
        const b = enemyColor.b + ((backgroundColor.b - enemyColor.b) * ratio);
        return util.rgbToString(r, g, b, 1);
    }

    /**
     * 현재 적이 속한 페럴렉스 레이어 설정을 반환합니다.
     * @param {number} layerIndex - 조회할 레이어 인덱스입니다.
     * @returns {object} 레이어 프로필입니다.
     * @private
     */
    #getParallaxLayerProfile(layerIndex) {
        if (!Array.isArray(TITLE_PARALLAX_LAYERS) || TITLE_PARALLAX_LAYERS.length === 0) {
            return {
                Id: 'default',
                Alpha: 1,
                MagneticScale: 1,
                ColorMix: 0,
                SoftnessScale: 1,
                SoftnessAlpha: 0,
                SoftnessOffsetPx: 0
            };
        }

        const resolvedIndex = Number.isInteger(layerIndex)
            ? Math.max(0, Math.min(TITLE_PARALLAX_LAYERS.length - 1, layerIndex))
            : 0;
        return TITLE_PARALLAX_LAYERS[resolvedIndex];
    }

}
