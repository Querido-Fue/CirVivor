import { ColorSchemes } from 'display/_theme_handler.js';
import { TitleEnemy } from './_title_enemy.js';
import { ObjectPool } from 'util/_object_pool.js';
import { animate } from 'animation/animation_system.js';
import { getWW, getWH, getUIWW, render, renderGL } from 'display/display_system.js';
import { getDelta } from 'game/time_handler.js';
import { mathUtil } from 'util/math_util.js';
import { TITLE_CONSTANTS } from 'data/title/title_constants.js';

/**
 * @class TitleBackGround
 * @description 타이틀 화면의 배경을 관리하는 클래스입니다. 배경에 떠다니는 도형(TitleEnemy)들을 생성하고 관리합니다.
 */
export class TitleBackGround {
    /**
     * @param {TitleScene} titleScene - 이 배경이 속한 타이틀 씬
     */
    constructor(titleScene) {
        this.titleScene = titleScene;
        this.shapes = TITLE_CONSTANTS.TITLE_ENEMIES.SHAPES;
        this.titleEnemies = [];
        this.enemyPool = new ObjectPool(
            () => new TitleEnemy(this), // 생성
            (enemy) => { enemy.active = false; }, // 초기화 (init에서 처리하므로 선택 사항)
            "TitleEnemy" // 이름
        );
        this.shapesPerSecond = TITLE_CONSTANTS.TITLE_ENEMIES.ENEMY_SPAWN_RATE; // 초당 생성 개수
        this.shapeSpawnCounter = 0;
        this.logoMagneticPoint = null;
        this.WW = getWW();
        this.WH = getWH();
        this.UIWW = getUIWW();

        this.time = 0;
        this.shieldRadius = 0;
        animate(this, { variable: 'shieldRadius', startValue: 0, endValue: this.UIWW * 0.07, type: "easeOutExpo", duration: 1.2, delay: 1 });

        this.init();
    }

    /**
     * 배경 초기화
     */
    init() {
        this.pushShape(TITLE_CONSTANTS.TITLE_ENEMIES.ENEMY_START_COUNT, true);
    }

    resize() {
        const prevUIWW = this.UIWW || 1;
        this.WW = getWW();
        this.WH = getWH();
        this.UIWW = getUIWW();
        const ratio = this.UIWW / Math.max(1, prevUIWW);
        this.shieldRadius *= ratio;

        for (const enemy of this.titleEnemies) {
            if (enemy && typeof enemy.resize === 'function') {
                enemy.resize();
            }
        }
    }

    /**
     * 매 프레임 업데이트
     * @param {{x:number, y:number}|null} logoMagneticPoint - 로고의 자석 효과 지점 (없으면 null)
     */
    update(logoMagneticPoint) {
        this.logoMagneticPoint = logoMagneticPoint;
        const delta = getDelta();
        this.time += delta;

        // 적들 업데이트 및 풀링 관리
        for (let i = this.titleEnemies.length - 1; i >= 0; i--) {
            const c = this.titleEnemies[i];
            if (!c.inScreen) {
                this.enemyPool.release(c);
                this.titleEnemies.splice(i, 1);
                continue;
            }

            c.update(logoMagneticPoint);

            if (logoMagneticPoint) {
                const enemyX = c.pos.x * this.WW;
                const enemyY = c.pos.y * this.WH;
                const dx = enemyX - logoMagneticPoint.x;
                const dy = enemyY - logoMagneticPoint.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (Math.abs(dist - this.shieldRadius) < c.radius) {
                    // 충돌 이펙트 확장 포인트 (현재는 계산만 수행하지 않음)
                }
            }
        }

        if (this.titleEnemies.length < TITLE_CONSTANTS.TITLE_ENEMIES.ENEMY_LIMIT) {
            this.shapeSpawnCounter += this.shapesPerSecond * delta;
            let shapesToSpawn = Math.floor(this.shapeSpawnCounter);

            // 생성 가능한 슬롯 내에서만 생성
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

    draw() {
        renderGL('background', {
            shape: 'rect',
            x: this.WW / 2, y: this.WH / 2,
            w: this.WW, h: this.WH,
            fill: ColorSchemes.Title.Background
        });
        this.titleEnemies.forEach((c) => c.draw());
    }

    /**
     * 도형(적)을 생성하여 배열에 추가
     * @param {number} times - 생성할 개수
     * @param {boolean} init - 초기 생성 여부 (애니메이션 효과 다름)
     */
    pushShape(times, init) {
        for (let i = 0; i < times; i++) {
            const randomShape = this.shapes[Math.floor(mathUtil().random(0, this.shapes.length))];
            const speedX = mathUtil().random(-0.07, -0.02);
            const speedY = mathUtil().random(-0.02, 0.02);

            const enemy = this.enemyPool.get();
            enemy.init(1.1, Math.random(), ColorSchemes.Title.Enemy, speedX, speedY, randomShape, init);
            this.titleEnemies.push(enemy);
        }
    }
}
