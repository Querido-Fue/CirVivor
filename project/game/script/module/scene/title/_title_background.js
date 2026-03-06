import { ColorSchemes } from 'display/_theme_handler.js';
import { animate } from 'animation/animation_system.js';
import { getWW, getWH, getObjectWH, getObjectOffsetY, getUIWW, renderGL } from 'display/display_system.js';
import { getFixedDelta, getFixedInterpolationAlpha } from 'game/time_handler.js';
import { mathUtil } from 'util/math_util.js';
import { getMouseFocus, getMouseInput, isMousePressing } from 'input/input_system.js';
import { getData } from 'data/data_handler.js';
import { getObjectSystem } from 'object/object_system.js';
import { titleAI } from 'object/enemy/ai/_title_ai.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');
const ENEMY_SHAPE_TYPES = getData('ENEMY_SHAPE_TYPES');
const TITLE_ENEMY_SPAWN_CULL_GUARD_PX = 0.5;

/**
 * @class TitleBackGround
 * @description 타이틀 화면 배경을 관리하며, 오브젝트 적을 랜덤 스폰/업데이트/렌더링합니다.
 */
export class TitleBackGround {
    /**
     * @param {TitleScene} titleScene
     */
    constructor(titleScene) {
        this.titleScene = titleScene;
        this.objectSystem = getObjectSystem();
        const excludedTypes = TITLE_CONSTANTS.TITLE_ENEMIES.ENEMY_EXCLUDED_TYPES || [];
        this.enemyTypes = ENEMY_SHAPE_TYPES.filter((type) => !excludedTypes.includes(type));
        if (this.enemyTypes.length === 0) {
            this.enemyTypes = ENEMY_SHAPE_TYPES;
        }
        this.titleEnemies = [];

        this.shapesPerSecond = TITLE_CONSTANTS.TITLE_ENEMIES.ENEMY_SPAWN_RATE;
        this.shapeSpawnCounter = 0;
        this.logoMagneticPoint = null;
        this.WW = getWW();
        this.WH = getWH();
        this.objectWH = getObjectWH();
        this.objectOffsetY = getObjectOffsetY();
        this.UIWW = getUIWW();

        this.time = 0;
        this.shieldRadius = 0;
        animate(this, {
            variable: 'shieldRadius',
            startValue: 0,
            endValue: this.UIWW * TITLE_CONSTANTS.TITLE_ENEMIES.SHIELD_RADIUS_RATIO,
            type: 'easeOutExpo',
            duration: TITLE_CONSTANTS.TITLE_ENEMIES.SHIELD_ANIM_DURATION,
            delay: TITLE_CONSTANTS.TITLE_ENEMIES.SHIELD_ANIM_DELAY
        });

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
        const ratioUI = this.UIWW / Math.max(1, prevUIWW);
        this.shieldRadius *= ratioUI;

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
                ratioUI,
                ww: this.WW,
                wh: this.WH,
                uiww: this.UIWW
            });
        }
    }

    /**
     * @param {{x:number, y:number}|null} logoMagneticPoint
     */
    update(logoMagneticPoint) {
        this.logoMagneticPoint = logoMagneticPoint;
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
    }

    /**
     * 고정 틱에서 타이틀 적의 이동/스폰/충돌을 처리합니다.
     */
    fixedUpdate() {
        const delta = getFixedDelta();
        if (!Number.isFinite(delta) || delta <= 0) return;

        this.time += delta;
        const mousePos = getMouseInput('pos');
        const focus = getMouseFocus();
        const objectFocused = Array.isArray(focus) && focus.includes('object');
        const mousePosInObject = mousePos
            ? { x: mousePos.x, y: mousePos.y + this.objectOffsetY }
            : null;
        const logoMagneticPointInObject = this.logoMagneticPoint
            ? { x: this.logoMagneticPoint.x, y: this.logoMagneticPoint.y + this.objectOffsetY }
            : null;

        const aiContext = {
            uiww: this.UIWW,
            logoMagneticPoint: logoMagneticPointInObject,
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

        if (this.objectSystem && typeof this.objectSystem.resolveEnemyCollisions === 'function') {
            this.objectSystem.resolveEnemyCollisions(this.titleEnemies, { delta });
        }

        if (this.titleEnemies.length < TITLE_CONSTANTS.TITLE_ENEMIES.ENEMY_LIMIT) {
            this.shapeSpawnCounter += this.shapesPerSecond * delta;
            let shapesToSpawn = Math.floor(this.shapeSpawnCounter);

            const availableSlots = TITLE_CONSTANTS.TITLE_ENEMIES.ENEMY_LIMIT - this.titleEnemies.length;
            if (shapesToSpawn > availableSlots) {
                shapesToSpawn = availableSlots;
            }

            if (shapesToSpawn > 0) {
                this.pushShape(shapesToSpawn);
                this.shapeSpawnCounter -= shapesToSpawn;
                if (this.objectSystem && typeof this.objectSystem.resolveEnemyCollisions === 'function') {
                    this.objectSystem.resolveEnemyCollisions(this.titleEnemies, { delta });
                }
            }
        }
    }

    /**
         * 타이틀 백그라운드와 적 요소를 렌더링
         */
    draw() {
        renderGL('background', {
            shape: 'rect',
            x: this.WW / 2,
            y: this.WH / 2,
            w: this.WW,
            h: this.WH,
            fill: ColorSchemes.Title.Background
        });

        for (let i = 0; i < this.titleEnemies.length; i++) {
            this.titleEnemies[i].draw();
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
            const enemy = this.objectSystem.acquireEnemy(type, {
                type,
                hp: 1,
                maxHp: 1,
                atk: 1,
                moveSpeed: 1,
                accSpeed: 0,
                size: mathUtil().random(
                    TITLE_CONSTANTS.TITLE_ENEMIES.ENEMY_SIZE_MIN,
                    TITLE_CONSTANTS.TITLE_ENEMIES.ENEMY_SIZE_MAX
                ),
                position: spawn.position,
                speed: spawn.speed,
                acc: { x: 0, y: 0 },
                ai: titleAI,
                fill: ColorSchemes.Title.Enemy,
                alpha: mathUtil().random(
                    TITLE_CONSTANTS.TITLE_ENEMIES.ENEMY_ALPHA_MIN,
                    TITLE_CONSTANTS.TITLE_ENEMIES.ENEMY_ALPHA_MAX
                ),
                rotation: mathUtil().random(0, 360)
            });
            if (!enemy) continue;
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
        const axisSpeed = this.UIWW * mathUtil().random(
            TITLE_CONSTANTS.TITLE_ENEMIES.AXIS_SPEED_MIN_RATIO,
            TITLE_CONSTANTS.TITLE_ENEMIES.AXIS_SPEED_MAX_RATIO
        );
        const driftSpeed = this.UIWW * mathUtil().random(
            TITLE_CONSTANTS.TITLE_ENEMIES.DRIFT_SPEED_MIN_RATIO,
            TITLE_CONSTANTS.TITLE_ENEMIES.DRIFT_SPEED_MAX_RATIO
        );
        const spawnY = mathUtil().random(-marginY, this.objectWH + marginY);

        return {
            position: {
                x: spawnX,
                y: spawnY
            },
            speed: { x: -axisSpeed, y: driftSpeed }
        };
    }

}
