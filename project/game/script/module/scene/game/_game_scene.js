import { ColorSchemes } from 'display/_theme_handler.js';
import { getObjectOffsetY, getObjectWH, getWH, getWW, render, renderGL } from 'display/display_system.js';
import { getMouseInput, hasMouseState } from 'input/input_system.js';
import { getData } from 'data/data_handler.js';
import { BaseScene } from 'scene/_base_scene.js';
import { getObjectSystem } from 'object/object_system.js';
import { tempAI } from 'object/enemy/ai/_temp_ai.js';
import { Player } from 'object/player/_player.js';
import { BaseProj } from 'object/proj/_base_proj.js';
import { BaseWall } from 'object/wall/_base_wall.js';

const ENEMY_SHAPE_TYPES = getData('ENEMY_SHAPE_TYPES');
const BUTTON_RADIUS = 10;
const BENCHMARK_WALL_HEIGHT_RATIO = 0.5;
const BENCHMARK_WALL_THICKNESS_RATIO = 0.008;
const BENCHMARK_BOX_SIZE_RATIO = 0.05;
const BENCHMARK_PROJECTILE_SIZE_RATIO = 0.03;
const BENCHMARK_PROJECTILE_TRAVEL_SECONDS = 2;
const PROJECTILE_CULL_MARGIN_RATIO = 0.2;
const BENCHMARK_ENEMY_SPEED_MULTIPLIER = 2.5;

const clamp01 = (value) => Math.max(0, Math.min(1, value));

const pointInRect = (x, y, rect) => (
    x >= rect.x &&
    x <= rect.x + rect.w &&
    y >= rect.y &&
    y <= rect.y + rect.h
);

const rectCircleOverlap = (rect, x, y, radius) => {
    const closestX = Math.max(rect.minX, Math.min(x, rect.maxX));
    const closestY = Math.max(rect.minY, Math.min(y, rect.maxY));
    const dx = x - closestX;
    const dy = y - closestY;
    return ((dx * dx) + (dy * dy)) <= (radius * radius);
};

/**
 * @class GameScene
 * @description 충돌/AI 성능 측정을 위한 벤치마크 씬입니다.
 */
export class GameScene extends BaseScene {
    /**
     * @param {object} sceneHandler
     * @param {object} app
     */
    constructor(sceneHandler, app) {
        super(sceneHandler, app);

        this.objectSystem = getObjectSystem();
        this.enemyTypes = Array.isArray(ENEMY_SHAPE_TYPES) && ENEMY_SHAPE_TYPES.length > 0
            ? ENEMY_SHAPE_TYPES
            : ['square'];

        this.projectiles = [];
        this.staticWalls = [];
        this.boxWalls = [];
        this.buttons = [];
        this.collisionStats = {
            collisionCheckCount: 0,
            aabbPassCount: 0,
            aabbRejectCount: 0,
            circlePassCount: 0,
            circleRejectCount: 0,
            polygonChecks: 0,
        };

        this.wallIdCounter = 1;
        this.projIdCounter = 1;
        this.#syncViewport();
        this.#resetBenchmarkWorld();
        this.#buildButtons();
    }

    /**
     * @private
     */
    #syncViewport() {
        this.WW = getWW();
        this.WH = getWH();
        this.objectWH = getObjectWH();
        this.objectOffsetY = getObjectOffsetY();
    }

    /**
     * @private
     */
    #resetBenchmarkWorld() {
        if (!this.objectSystem) return;

        this.objectSystem.showcaseEnabled = false;
        this.objectSystem.clearEnemies();
        this.projectiles.length = 0;
        this.staticWalls.length = 0;
        this.boxWalls.length = 0;
        this.wallIdCounter = 1;

        this.player = new Player().init({
            id: 1,
            radius: this.objectWH * 0.02,
            position: {
                x: this.WW * 0.5,
                y: this.objectWH * 0.5
            },
            speed: { x: 0, y: 0 },
            weight: 999999
        });

        const wallThickness = Math.max(8, this.WW * BENCHMARK_WALL_THICKNESS_RATIO);
        const wallHeight = this.objectWH * BENCHMARK_WALL_HEIGHT_RATIO;
        const wallY = this.objectWH * 0.5;

        this.staticWalls.push(this.#createWall(this.WW * 0.25, wallY, wallThickness, wallHeight));
        this.staticWalls.push(this.#createWall(this.WW * 0.75, wallY, wallThickness, wallHeight));

        for (let i = 0; i < 3; i++) {
            this.spawnRandomBox();
        }

        this.objectSystem.setPlayers([this.player]);
        this.objectSystem.setProjectiles(this.projectiles);
        this.objectSystem.setItems([]);
        this.#syncWalls();
    }

    /**
     * @private
     * @param {number} x
     * @param {number} y
     * @param {number} w
     * @param {number} h
     * @returns {BaseWall}
     */
    #createWall(x, y, w, h) {
        return new BaseWall().init({
            id: this.wallIdCounter++,
            x,
            y,
            w,
            h,
            origin: 'center'
        });
    }

    /**
     * @private
     */
    #syncWalls() {
        if (!this.objectSystem) return;
        this.objectSystem.setWalls([...this.staticWalls, ...this.boxWalls]);
    }

    /**
     * @private
     */
    #buildButtons() {
        const btnW = Math.max(160, this.WW * 0.13);
        const btnH = Math.max(38, this.WH * 0.052);
        const gap = Math.max(10, btnH * 0.24);
        const x = this.WW * 0.03;
        const y = this.WH * 0.08;

        this.buttons = [
            {
                id: 'spawnEnemy100',
                label: 'Spawn 100 Enemies',
                x,
                y,
                w: btnW,
                h: btnH,
                onClick: () => this.spawnEnemies(100)
            },
            {
                id: 'spawnBox',
                label: 'Spawn Box',
                x,
                y: y + btnH + gap,
                w: btnW,
                h: btnH,
                onClick: () => this.spawnRandomBox()
            },
            {
                id: 'spawnProjectile10',
                label: 'Spawn 10 Projectiles',
                x,
                y: y + ((btnH + gap) * 2),
                w: btnW,
                h: btnH,
                onClick: () => this.spawnProjectileBurst()
            }
        ];
    }

    /**
     * @private
     * @param {number} min
     * @param {number} max
     * @returns {number}
     */
    #random(min, max) {
        return (Math.random() * (max - min)) + min;
    }

    /**
     * @private
     * @param {number} min
     * @param {number} max
     * @returns {number}
     */
    #randomInt(min, max) {
        return Math.floor(this.#random(min, max + 1));
    }

    /**
     * @private
     * @param {number} x
     * @param {number} y
     * @param {number} radius
     * @returns {boolean}
     */
    #isPointBlockedByWall(x, y, radius) {
        const allWalls = [...this.staticWalls, ...this.boxWalls];
        for (let i = 0; i < allWalls.length; i++) {
            const wall = allWalls[i];
            if (!wall || wall.active === false) continue;
            const halfW = wall.w * 0.5;
            const halfH = wall.h * 0.5;
            const rect = {
                minX: wall.x - halfW,
                maxX: wall.x + halfW,
                minY: wall.y - halfH,
                maxY: wall.y + halfH
            };
            if (rectCircleOverlap(rect, x, y, radius)) return true;
        }
        return false;
    }

    /**
     * @private
     * @returns {{x:number, y:number}}
     */
    #randomEnemySpawnPosition() {
        const margin = this.objectWH * 0.07;
        const side = this.#randomInt(0, 3);

        if (side === 0) {
            return { x: this.#random(margin, this.WW - margin), y: margin };
        }
        if (side === 1) {
            return { x: this.#random(margin, this.WW - margin), y: this.objectWH - margin };
        }
        if (side === 2) {
            return { x: margin, y: this.#random(margin, this.objectWH - margin) };
        }
        return { x: this.WW - margin, y: this.#random(margin, this.objectWH - margin) };
    }

    /**
     * 적 100마리 스폰 버튼 액션
     * @param {number} [count=100]
     */
    spawnEnemies(count = 100) {
        if (!this.objectSystem) return;
        const fill = ColorSchemes?.Title?.Enemy || '#ff6c6c';

        for (let i = 0; i < count; i++) {
            const type = this.enemyTypes[this.#randomInt(0, this.enemyTypes.length - 1)];
            const spawnPos = this.#randomEnemySpawnPosition();
            const angle = this.#random(0, Math.PI * 2);
            const speedMag = this.#random(20, 64);

            this.objectSystem.spawnEnemy(type, {
                type,
                hp: 1,
                maxHp: 1,
                atk: 1,
                moveSpeed: this.#random(0.85, 1.2) * BENCHMARK_ENEMY_SPEED_MULTIPLIER,
                accSpeed: 0,
                size: 1.5,
                projectileHitsToKill: 3,
                position: spawnPos,
                speed: {
                    x: Math.cos(angle) * speedMag,
                    y: Math.sin(angle) * speedMag
                },
                acc: { x: 0, y: 0 },
                ai: tempAI,
                fill,
                alpha: this.#random(0.7, 1),
                rotation: this.#random(0, 360)
            });
        }
    }

    /**
     * 맵 임의 위치에 정사각형 박스를 추가합니다.
     * @returns {BaseWall|null}
     */
    spawnRandomBox() {
        const size = this.objectWH * BENCHMARK_BOX_SIZE_RATIO;
        const radius = (size * Math.SQRT2) * 0.5;
        const margin = Math.max(size * 0.55, this.objectWH * 0.03);
        const minX = margin;
        const maxX = Math.max(minX, this.WW - margin);
        const minY = margin;
        const maxY = Math.max(minY, this.objectWH - margin);

        for (let tries = 0; tries < 36; tries++) {
            const x = this.#random(minX, maxX);
            const y = this.#random(minY, maxY);
            if (this.#isPointBlockedByWall(x, y, radius)) continue;

            if (this.player && this.player.position) {
                const dx = x - this.player.position.x;
                const dy = y - this.player.position.y;
                const keepout = Math.max(this.player.radius + radius + (this.objectWH * 0.04), 8);
                if (((dx * dx) + (dy * dy)) < (keepout * keepout)) continue;
            }

            const wall = this.#createWall(x, y, size, size);
            this.boxWalls.push(wall);
            this.#syncWalls();
            return wall;
        }

        return null;
    }

    /**
     * y축 랜덤 위치에서 좌->우 고속 투사체 10개를 생성합니다.
     */
    spawnProjectileBurst() {
        const diameter = this.objectWH * BENCHMARK_PROJECTILE_SIZE_RATIO;
        const radius = diameter * 0.5;
        const startX = -this.WW * 0.1;
        const endX = this.WW * 1.1;
        const speedX = (endX - startX) / Math.max(0.016, BENCHMARK_PROJECTILE_TRAVEL_SECONDS);

        for (let i = 0; i < 10; i++) {
            const y = this.#random(radius, Math.max(radius, this.objectWH - radius));
            const projectile = new BaseProj().init({
                id: this.projIdCounter++,
                radius,
                weight: 0.07,
                impactForce: 1,
                piercing: true,
                position: { x: startX, y },
                speed: { x: speedX, y: 0 }
            });
            projectile.clearHitHistory();
            this.projectiles.push(projectile);
        }
    }

    /**
     * @override
     */
    update() {
        const mousePos = getMouseInput('pos');
        const clicked = hasMouseState('left', 'clicked');
        if (clicked && mousePos) {
            for (let i = 0; i < this.buttons.length; i++) {
                const button = this.buttons[i];
                if (pointInRect(mousePos.x, mousePos.y, button)) {
                    button.onClick();
                    break;
                }
            }
        }

        const cullMinX = -this.WW * PROJECTILE_CULL_MARGIN_RATIO;
        const cullMaxX = this.WW * (1 + PROJECTILE_CULL_MARGIN_RATIO);
        const cullMinY = -this.objectWH * PROJECTILE_CULL_MARGIN_RATIO;
        const cullMaxY = this.objectWH * (1 + PROJECTILE_CULL_MARGIN_RATIO);
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const projectile = this.projectiles[i];
            if (!projectile || projectile.active === false) {
                this.projectiles.splice(i, 1);
                continue;
            }

            const x = projectile.position.x;
            const y = projectile.position.y;
            if (x < cullMinX || x > cullMaxX || y < cullMinY || y > cullMaxY) {
                this.projectiles.splice(i, 1);
            }
        }

        if (this.objectSystem && typeof this.objectSystem.getCollisionStats === 'function') {
            this.collisionStats = this.objectSystem.getCollisionStats();
        }
    }

    /**
     * @override
     */
    fixedUpdate() {
        // 벤치마크 씬의 고정 물리 루프는 ObjectSystem에서 처리됩니다.
    }

    /**
     * @override
     */
    resize() {
        this.#syncViewport();
        this.#resetBenchmarkWorld();
        this.#buildButtons();
    }

    /**
     * 씬 종료 시 객체 참조를 정리합니다.
     */
    destroy() {
        if (!this.objectSystem) return;
        this.objectSystem.setPlayers([]);
        this.objectSystem.setProjectiles([]);
        this.objectSystem.setItems([]);
        this.objectSystem.setWalls([]);
        this.objectSystem.clearEnemies();
    }

    /**
     * @private
     */
    #drawWorldObjects() {
        const offsetY = this.objectOffsetY;

        for (let i = 0; i < this.staticWalls.length; i++) {
            const wall = this.staticWalls[i];
            renderGL('object', {
                shape: 'rect',
                x: wall.x,
                y: wall.y - offsetY,
                w: wall.w,
                h: wall.h,
                fill: 'rgba(120, 136, 156, 0.9)'
            });
        }

        for (let i = 0; i < this.boxWalls.length; i++) {
            const box = this.boxWalls[i];
            renderGL('object', {
                shape: 'rect',
                x: box.x,
                y: box.y - offsetY,
                w: box.w,
                h: box.h,
                fill: 'rgba(182, 201, 214, 0.9)'
            });
        }

        if (this.player) {
            const diameter = this.player.radius * 2;
            renderGL('object', {
                shape: 'circle',
                x: this.player.position.x,
                y: this.player.position.y - offsetY,
                w: diameter,
                h: diameter,
                fill: '#4fa3ff',
                alpha: 0.95
            });
        }

        for (let i = 0; i < this.projectiles.length; i++) {
            const projectile = this.projectiles[i];
            if (!projectile || projectile.active === false) continue;
            const d = projectile.radius * 2;
            renderGL('object', {
                shape: 'circle',
                x: projectile.position.x,
                y: projectile.position.y - offsetY,
                w: d,
                h: d,
                fill: '#ffc857',
                alpha: 0.95
            });
        }
    }

    /**
     * @private
     */
    #drawButtons() {
        const mousePos = getMouseInput('pos');
        const fontSize = Math.max(11, this.WW * 0.0092);

        for (let i = 0; i < this.buttons.length; i++) {
            const button = this.buttons[i];
            const hovering = mousePos ? pointInRect(mousePos.x, mousePos.y, button) : false;
            const hoverBlend = clamp01(hovering ? 1 : 0);
            const fillAlpha = 0.74 + (hoverBlend * 0.12);

            render('ui', {
                shape: 'roundRect',
                x: button.x,
                y: button.y,
                w: button.w,
                h: button.h,
                radius: BUTTON_RADIUS,
                fill: `rgba(26, 32, 40, ${fillAlpha})`
            });
            render('ui', {
                shape: 'roundRect',
                x: button.x,
                y: button.y,
                w: button.w,
                h: button.h,
                radius: BUTTON_RADIUS,
                fill: false,
                stroke: 'rgba(255, 255, 255, 0.55)',
                lineWidth: 1
            });
            render('ui', {
                shape: 'text',
                text: button.label,
                x: button.x + (button.w * 0.5),
                y: button.y + (button.h * 0.54),
                font: `500 ${fontSize}px "Pretendard Variable"`,
                fill: '#f5f8ff',
                align: 'center',
                baseline: 'middle'
            });
        }
    }

    /**
     * @private
     */
    #drawHud() {
        const titleFont = Math.max(14, this.WW * 0.0105);
        const enemyCount = this.objectSystem && typeof this.objectSystem.getEnemies === 'function'
            ? this.objectSystem.getEnemies().length
            : 0;
        render('ui', {
            shape: 'text',
            text: 'Benchmark Scene',
            x: this.WW * 0.03,
            y: this.WH * 0.04,
            font: `500 ${titleFont}px "Pretendard Variable"`,
            fill: ColorSchemes.Game.Font,
            align: 'left',
            baseline: 'middle'
        });

        const statsFont = Math.max(10, this.WW * 0.0075);
        const statsX = this.WW * 0.985;
        const statsY = this.WH * 0.96;
        render('ui', {
            shape: 'text',
            text: `enemy count: ${enemyCount}`,
            x: statsX,
            y: statsY,
            font: `400 ${statsFont}px "Pretendard Variable"`,
            fill: ColorSchemes.Game.Font,
            align: 'right',
            baseline: 'bottom',
            alpha: 0.9
        });
        render('ui', {
            shape: 'text',
            text: `Collision check count: ${this.collisionStats.collisionCheckCount}`,
            x: statsX,
            y: statsY - (statsFont * 5.12),
            font: `400 ${statsFont}px "Pretendard Variable"`,
            fill: ColorSchemes.Game.Font,
            align: 'right',
            baseline: 'bottom',
            alpha: 0.9
        });
        render('ui', {
            shape: 'text',
            text: `AABB pass: ${this.collisionStats.aabbPassCount} | reject: ${this.collisionStats.aabbRejectCount}`,
            x: statsX,
            y: statsY - (statsFont * 3.84),
            font: `400 ${statsFont}px "Pretendard Variable"`,
            fill: ColorSchemes.Game.Font,
            align: 'right',
            baseline: 'bottom',
            alpha: 0.9
        });
        render('ui', {
            shape: 'text',
            text: `Circle pass: ${this.collisionStats.circlePassCount} | reject: ${this.collisionStats.circleRejectCount}`,
            x: statsX,
            y: statsY - (statsFont * 2.56),
            font: `400 ${statsFont}px "Pretendard Variable"`,
            fill: ColorSchemes.Game.Font,
            align: 'right',
            baseline: 'bottom',
            alpha: 0.9
        });
        render('ui', {
            shape: 'text',
            text: `polygon check: ${this.collisionStats.polygonChecks}`,
            x: statsX,
            y: statsY - (statsFont * 1.28),
            font: `400 ${statsFont}px "Pretendard Variable"`,
            fill: ColorSchemes.Game.Font,
            align: 'right',
            baseline: 'bottom',
            alpha: 0.9
        });
    }

    /**
     * @override
     */
    draw() {
        this.#drawWorldObjects();
        this.#drawButtons();
        this.#drawHud();
    }
}
