import { ColorSchemes } from 'display/_theme_handler.js';
import { animate } from 'animation/animation_system.js';
import { getWW, getWH, getUIWW, renderGL } from 'display/display_system.js';
import { getDelta } from 'game/time_handler.js';
import { mathUtil } from 'util/math_util.js';
import { getData } from 'data/data_handler.js';
import { getObjectSystem } from 'object/object_system.js';
import { titleAI } from 'object/enemy/ai/_title_ai.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');
const ENEMY_SHAPE_TYPES = getData('ENEMY_SHAPE_TYPES');

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
         * 초기 시작 시점 타이틀 적 객체들을 최초 스폰합니다.
         */
    init() {
        this.pushShape(TITLE_CONSTANTS.TITLE_ENEMIES.ENEMY_START_COUNT, true);
    }

    /**
         * 윈도우 리사이즈 시 기존에 생성된 타이틀 적들의 크기 및 위치 비율 재계산 수행
         */
    resize() {
        const prevWW = this.WW || 1;
        const prevWH = this.WH || 1;
        const prevUIWW = this.UIWW || 1;

        this.WW = getWW();
        this.WH = getWH();
        this.UIWW = getUIWW();

        const ratioX = this.WW / Math.max(1, prevWW);
        const ratioY = this.WH / Math.max(1, prevWH);
        const ratioUI = this.UIWW / Math.max(1, prevUIWW);
        this.shieldRadius *= ratioUI;

        for (const enemy of this.titleEnemies) {
            enemy.position.x *= ratioX;
            enemy.position.y *= ratioY;
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
        const delta = getDelta();
        this.time += delta;

        const aiContext = {
            uiww: this.UIWW,
            logoMagneticPoint: this.logoMagneticPoint
        };

        for (let i = this.titleEnemies.length - 1; i >= 0; i--) {
            const enemy = this.titleEnemies[i];
            enemy.update(delta, aiContext);

            if (enemy.isOutsideScreen(this.WW, this.WH, TITLE_CONSTANTS.TITLE_ENEMIES.ENEMY_CULL_OUTSIDE_RATIO)) {
                this._releaseEnemyAt(i);
            }
        }

        if (this.titleEnemies.length < TITLE_CONSTANTS.TITLE_ENEMIES.ENEMY_LIMIT) {
            this.shapeSpawnCounter += this.shapesPerSecond * delta;
            let shapesToSpawn = Math.floor(this.shapeSpawnCounter);

            const availableSlots = TITLE_CONSTANTS.TITLE_ENEMIES.ENEMY_LIMIT - this.titleEnemies.length;
            if (shapesToSpawn > availableSlots) {
                shapesToSpawn = availableSlots;
            }

            if (shapesToSpawn > 0) {
                this.pushShape(shapesToSpawn, false);
                this.shapeSpawnCounter -= shapesToSpawn;
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

        for (const enemy of this.titleEnemies) {
            enemy.draw();
        }
    }

    /**
         * 지정 횟수만큼 타이틀 적 형상을 배열에 추가, 초기 등장 애니메이션 옵션 제공
         * @param {number} times 스폰 횟수
         * @param {boolean} playInitAnim 초기 등장 연출 실행 여부
         */
    pushShape(times, playInitAnim) {
        if (!this.objectSystem) {
            this.objectSystem = getObjectSystem();
        }
        if (!this.objectSystem || this.enemyTypes.length === 0) return;

        for (let i = 0; i < times; i++) {
            const type = this.enemyTypes[Math.floor(mathUtil().random(0, this.enemyTypes.length))];
            const spawn = this._buildSpawnData({ lockYInScreen: playInitAnim });
            const startSpeed = playInitAnim ? { x: spawn.speed.x, y: 0 } : spawn.speed;
            const enemy = this.objectSystem.acquireEnemy(type, {
                id: `title_enemy_${type}_${this.time.toFixed(3)}_${i}`,
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
                speed: startSpeed,
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
            enemy._spawnBoost = 1;
            enemy._titleIntroActive = false;

            if (playInitAnim) {
                const targetX = this._buildIntroTargetX();
                const duration = mathUtil().random(
                    TITLE_CONSTANTS.TITLE_ENEMIES.INTRO.MIN_DURATION,
                    TITLE_CONSTANTS.TITLE_ENEMIES.INTRO.MAX_DURATION
                );
                const delay = mathUtil().random(0, TITLE_CONSTANTS.TITLE_ENEMIES.INTRO.MAX_DELAY);
                enemy._titleIntroActive = true;
                enemy._titleIntroOffsetX = 0;
                enemy._titleIntroPrevOffsetX = 0;
                const enemyId = enemy.id;
                const introEndOffsetX = targetX - (enemy.position.x + (enemy.speed.x * (delay + duration)));

                const animX = animate(enemy, {
                    variable: '_titleIntroOffsetX',
                    startValue: 0,
                    endValue: introEndOffsetX,
                    type: 'easeOutExpo',
                    duration,
                    delay: 0.5
                });

                animX.promise.then(() => {
                    if (!enemy.active || enemy.id !== enemyId) return;
                    enemy._titleIntroActive = false;
                    enemy._titleIntroPrevOffsetX = enemy._titleIntroOffsetX;
                });
            }

            this.titleEnemies.push(enemy);
        }
    }

    /**
         * 배열 내 특정 인덱스의 적을 풀에 반환 및 리스트에서 제거합니다.
         * @param {number} index
         * @private
         */
    _releaseEnemyAt(index) {
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
            this._releaseEnemyAt(i);
        }
    }

    /**
         * 적 생성 데이터 구조(위치, 속도 비율 등)를 반환합니다.
         * @param {object} [options]
         * @param {boolean} [options.lockYInScreen=false] 스폰 시 화면 내부 Y 위치 고정 여부
         * @returns {object} 위치 및 속도 데이터
         * @private
         */
    _buildSpawnData({ lockYInScreen = false } = {}) {
        const marginY = this.WH * TITLE_CONSTANTS.TITLE_ENEMIES.ENEMY_CULL_OUTSIDE_RATIO;
        const axisSpeed = this.UIWW * mathUtil().random(
            TITLE_CONSTANTS.TITLE_ENEMIES.AXIS_SPEED_MIN_RATIO,
            TITLE_CONSTANTS.TITLE_ENEMIES.AXIS_SPEED_MAX_RATIO
        );
        const driftSpeed = this.UIWW * mathUtil().random(
            TITLE_CONSTANTS.TITLE_ENEMIES.DRIFT_SPEED_MIN_RATIO,
            TITLE_CONSTANTS.TITLE_ENEMIES.DRIFT_SPEED_MAX_RATIO
        );
        const spawnY = lockYInScreen
            ? mathUtil().random(
                this.WH * TITLE_CONSTANTS.TITLE_ENEMIES.SPAWN_Y_MIN_RATIO,
                this.WH * TITLE_CONSTANTS.TITLE_ENEMIES.SPAWN_Y_MAX_RATIO
            )
            : mathUtil().random(-marginY, this.WH + marginY);

        return {
            position: {
                x: this.WW * TITLE_CONSTANTS.TITLE_ENEMIES.ENEMY_SPAWN_X_RATIO,
                y: spawnY
            },
            speed: { x: -axisSpeed, y: driftSpeed }
        };
    }

    /**
         * 최초 등장 애니메이션의 목표 X 좌표(등장 멈춤 점)를 계산
         * @returns {number} 
         * @private
         */
    _buildIntroTargetX() {
        return mathUtil().random(
            this.WW * TITLE_CONSTANTS.TITLE_ENEMIES.INTRO.TARGET_X_MIN_RATIO,
            this.WW * TITLE_CONSTANTS.TITLE_ENEMIES.INTRO.TARGET_X_MAX_RATIO
        );
    }
}
