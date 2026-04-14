import { ColorSchemes } from 'display/_theme_handler.js';
import { renderGL } from 'display/display_system.js';
import { getFixedDelta, getFixedInterpolationAlpha } from 'game/time_handler.js';
import { mathUtil } from 'util/math_util.js';
import { colorUtil } from 'util/color_util.js';
import { getData } from 'data/data_handler.js';
import { getObjectSystem } from 'object/object_system.js';
import { titleAI } from 'object/enemy/ai/_title_ai.js';
import { TitleShieldEffect } from './_title_shield_effect.js';
import {
    getSimulationMouseFocus,
    getSimulationMouseInput,
    getSimulationObjectOffsetY,
    getSimulationObjectWH,
    getSimulationUIWW,
    getSimulationWH,
    getSimulationWW,
    isSimulationMousePressing
} from 'simulation/simulation_runtime.js';

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
        this.layerSpawnCounters = [];
        this.initialBurstElapsedSeconds = [];
        this.initialBurstRemainingCounts = [];
        this.shieldLayout = null;
        this.enemySpawnEnabled = false;
        this.WW = getSimulationWW();
        this.WH = getSimulationWH();
        this.objectWH = getSimulationObjectWH();
        this.objectOffsetY = getSimulationObjectOffsetY();
        this.UIWW = getSimulationUIWW();
        this.shieldRadius = 0;
        this.shieldEffect = new TitleShieldEffect();

        this.init();
    }

    /**
         * 타이틀 적 스폰 카운터를 초기화합니다.
         */
    init() {
        this.shapeSpawnCounter = 0;
        this.#ensureLayerSpawnCounters();
        this.layerSpawnCounters.fill(0);
        this.#ensureInitialBurstState();
        this.initialBurstElapsedSeconds.fill(0);
        this.#resetInitialBurstRemainingCounts();
    }

    /**
         * 윈도우 리사이즈 시 기존에 생성된 타이틀 적들의 크기 및 위치 비율 재계산 수행
         */
    resize() {
        const prevWW = this.WW || 1;
        const prevObjectWH = this.objectWH || 1;
        const prevUIWW = this.UIWW || 1;

        this.WW = getSimulationWW();
        this.WH = getSimulationWH();
        this.objectWH = getSimulationObjectWH();
        this.objectOffsetY = getSimulationObjectOffsetY();
        this.UIWW = getSimulationUIWW();

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

        const mousePos = getSimulationMouseInput('pos');
        const focus = getSimulationMouseFocus();
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
            leftPressing: isSimulationMousePressing('left'),
            mousePos: mousePosInObject
        };

        for (let i = this.titleEnemies.length - 1; i >= 0; i--) {
            const enemy = this.titleEnemies[i];
            if (!enemy || !enemy.active) continue;
            enemy.beginFixedStep();
            enemy.fixedUpdate(delta, aiContext);
        }

        this.#updateInitialBurstCollisionGrace(delta);
        this.#resolveTitleEnemyCollisions(delta);
        if (!this.enemySpawnEnabled) {
            return;
        }

        const hasParallaxLayers = Array.isArray(TITLE_PARALLAX_LAYERS) && TITLE_PARALLAX_LAYERS.length > 0;
        const spawnedCount = hasParallaxLayers
            ? (this.#hasPendingInitialBurst()
                ? this.#spawnInitialBurstEnemies(delta)
                : this.#spawnParallaxLayerEnemies(delta))
            : this.#spawnDefaultEnemies(delta);
        if (spawnedCount > 0) {
            this.#resolveTitleEnemyCollisions(delta);
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
     * @param {number[]|null} [layerCounts=null] 계층별 현재 적 수 캐시입니다.
     * @param {number|null} [preferredLayerIndex=null] 우선적으로 생성할 페럴랙스 계층 인덱스입니다.
     * @param {'standard'|'initialBurst'} [spawnMode='standard'] 생성 방식입니다.
     * @param {{burstSpawnStartIndex?: number, burstTargetCount?: number}|null} [spawnOptions=null] 초기 버스트 보조 옵션입니다.
     * @returns {number} 실제로 생성된 적 수입니다.
     */
    pushShape(times, layerCounts = null, preferredLayerIndex = null, spawnMode = 'standard', spawnOptions = null) {
        if (!this.objectSystem) {
            this.objectSystem = getObjectSystem();
        }
        if (!this.objectSystem || this.enemyTypes.length === 0) return 0;

        const resolvedLayerCounts = Array.isArray(layerCounts)
            && layerCounts.length === TITLE_PARALLAX_LAYERS.length
            ? layerCounts
            : null;
        let spawnedCount = 0;

        for (let i = 0; i < times; i++) {
            const type = this.enemyTypes[Math.floor(mathUtil().random(0, this.enemyTypes.length))];
            const burstSpawnStartIndex = Number.isFinite(spawnOptions?.burstSpawnStartIndex)
                ? Math.max(0, Math.floor(spawnOptions.burstSpawnStartIndex))
                : 0;
            const spawn = this.#buildSpawnData(
                resolvedLayerCounts,
                preferredLayerIndex,
                spawnMode,
                spawnMode === 'initialBurst'
                    ? {
                        burstSpawnIndex: burstSpawnStartIndex + i,
                        burstTargetCount: Number.isFinite(spawnOptions?.burstTargetCount)
                            ? Math.max(1, Math.floor(spawnOptions.burstTargetCount))
                            : 1
                    }
                    : null
            );
            if (!spawn) {
                break;
            }
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
            if (spawn.baseSpeed) {
                enemy._titleBaseSpeed.x = spawn.baseSpeed.x;
                enemy._titleBaseSpeed.y = spawn.baseSpeed.y;
            }
            enemy._titleCollisionGraceRemaining = spawnMode === 'initialBurst'
                ? this.#getInitialBurstCollisionGraceSeconds()
                : 0;
            if (spawn.burstVelocity) {
                enemy._titleBurstVel.x = spawn.burstVelocity.x;
                enemy._titleBurstVel.y = spawn.burstVelocity.y;
                enemy._titleBurstDecayRate = Number.isFinite(spawn.burstDecayRate)
                    ? Math.max(0, spawn.burstDecayRate)
                    : enemy._titleBurstDecayRate;
            } else {
                enemy._titleBurstVel.x = 0;
                enemy._titleBurstVel.y = 0;
                enemy._titleBurstDecayRate = 0;
            }
            this.#applyParallaxVisualProfile(enemy, layerProfile, spawn.layerIndex);
            this.titleEnemies.push(enemy);
            spawnedCount += 1;
            if (resolvedLayerCounts && resolvedLayerCounts.length > 0 && Number.isInteger(spawn.layerIndex)) {
                resolvedLayerCounts[spawn.layerIndex] += 1;
            }
        }

        return spawnedCount;
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
     * @param {number[]|null} [layerCounts=null] 계층별 현재 적 수 캐시입니다.
     * @param {number|null} [preferredLayerIndex=null] 우선적으로 생성할 페럴랙스 계층 인덱스입니다.
     * @param {'standard'|'initialBurst'} [spawnMode='standard'] 생성 방식입니다.
     * @param {{burstSpawnIndex?: number, burstTargetCount?: number}|null} [spawnOptions=null] 초기 버스트 보조 옵션입니다.
     * @returns {object|null} 위치 및 속도 데이터입니다.
     * @private
     */
    #buildSpawnData(layerCounts = null, preferredLayerIndex = null, spawnMode = 'standard', spawnOptions = null) {
        const cullRatio = TITLE_CONSTANTS.TITLE_ENEMIES.ENEMY_CULL_OUTSIDE_RATIO;
        const marginY = this.objectWH * cullRatio;
        const marginX = this.WW * cullRatio;
        const layerData = this.#pickParallaxLayer(layerCounts, preferredLayerIndex);
        if (!layerData) {
            return null;
        }
        const isInitialBurst = spawnMode === 'initialBurst';
        const spawnX = isInitialBurst
            ? this.#getInitialBurstSpawnX(marginX)
            : this.#getStandardSpawnX(marginX);
        const baseAxisSpeed = this.UIWW * mathUtil().random(
            TITLE_CONSTANTS.TITLE_ENEMIES.AXIS_SPEED_MIN_RATIO,
            TITLE_CONSTANTS.TITLE_ENEMIES.AXIS_SPEED_MAX_RATIO
        ) * layerData.profile.SpeedScale * (
            Number.isFinite(TITLE_CONSTANTS.TITLE_ENEMIES.AXIS_SPEED_LEFT_MULTIPLIER)
                ? TITLE_CONSTANTS.TITLE_ENEMIES.AXIS_SPEED_LEFT_MULTIPLIER
                : 1
        );
        const baseDriftSpeed = this.UIWW * mathUtil().random(
            TITLE_CONSTANTS.TITLE_ENEMIES.DRIFT_SPEED_MIN_RATIO,
            TITLE_CONSTANTS.TITLE_ENEMIES.DRIFT_SPEED_MAX_RATIO
        ) * layerData.profile.SpeedScale;
        const initialAxisSpeed = isInitialBurst
            ? this.#getInitialBurstAxisSpeed(baseAxisSpeed, layerData.profile)
            : baseAxisSpeed;
        const initialDriftSpeed = isInitialBurst
            ? this.#getInitialBurstDriftSpeed(baseDriftSpeed)
            : baseDriftSpeed;
        const spawnY = isInitialBurst
            ? this.#getInitialBurstSpawnY(
                spawnOptions?.burstSpawnIndex,
                spawnOptions?.burstTargetCount
            )
            : mathUtil().random(-marginY, this.objectWH + marginY);

        return {
            layerIndex: layerData.index,
            layerProfile: layerData.profile,
            position: {
                x: spawnX,
                y: spawnY
            },
            speed: { x: -initialAxisSpeed, y: initialDriftSpeed },
            baseSpeed: { x: -baseAxisSpeed, y: baseDriftSpeed },
            burstVelocity: isInitialBurst
                ? {
                    x: -(initialAxisSpeed - baseAxisSpeed),
                    y: initialDriftSpeed - baseDriftSpeed
                }
                : null,
            burstDecayRate: isInitialBurst
                ? TITLE_CONSTANTS.TITLE_AI.BURST_VELOCITY_EASEOUT_EXPO_RATE
                : 0
        };
    }

    /**
     * 일반 유지 스폰의 기본 x 좌표를 반환합니다.
     * @param {number} marginX - 컬링 마진 x값입니다.
     * @returns {number} 스폰 x 좌표입니다.
     * @private
     */
    #getStandardSpawnX(marginX) {
        const spawnXByRatio = this.WW * TITLE_CONSTANTS.TITLE_ENEMIES.ENEMY_SPAWN_X_RATIO;
        return Math.max(
            this.WW,
            Math.min(spawnXByRatio, (this.WW + marginX) - TITLE_ENEMY_SPAWN_CULL_GUARD_PX)
        );
    }

    /**
     * 초기 버스트 스폰의 x 좌표를 반환합니다.
     * @param {number} marginX - 컬링 마진 x값입니다.
     * @returns {number} 스폰 x 좌표입니다.
     * @private
     */
    #getInitialBurstSpawnX(marginX) {
        const maxSpawnX = Math.min(
            this.WW + marginX - TITLE_ENEMY_SPAWN_CULL_GUARD_PX,
            this.WW * TITLE_CONSTANTS.TITLE_ENEMIES.INITIAL_BURST_SPAWN_X_MAX_RATIO
        );
        const minSpawnX = Math.max(
            this.WW,
            Math.min(
                maxSpawnX,
                this.WW * TITLE_CONSTANTS.TITLE_ENEMIES.INITIAL_BURST_SPAWN_X_MIN_RATIO
            )
        );
        return mathUtil().random(minSpawnX, maxSpawnX);
    }

    /**
     * 초기 버스트 스폰의 y 좌표를 반환합니다.
     * @param {number} [burstSpawnIndex=0] - 현재 초기 버스트 누적 스폰 인덱스입니다.
     * @param {number} [burstTargetCount=1] - 초기 버스트 전체 목표 수량입니다.
     * @returns {number} 스폰 y 좌표입니다.
     * @private
     */
    #getInitialBurstSpawnY(burstSpawnIndex = 0, burstTargetCount = 1) {
        const minY = this.objectWH * TITLE_CONSTANTS.TITLE_ENEMIES.SPAWN_Y_MIN_RATIO;
        const maxY = this.objectWH * TITLE_CONSTANTS.TITLE_ENEMIES.SPAWN_Y_MAX_RATIO;
        const totalRange = Math.max(1, maxY - minY);
        const safeTargetCount = Number.isFinite(burstTargetCount)
            ? Math.max(1, Math.floor(burstTargetCount))
            : 1;
        const sequentialIndex = Number.isFinite(burstSpawnIndex)
            ? Math.max(0, Math.floor(burstSpawnIndex)) % safeTargetCount
            : 0;
        const slotIndex = ((sequentialIndex * 37) + 17) % safeTargetCount;
        const slotHeight = totalRange / safeTargetCount;
        const slotCenter = minY + ((slotIndex + 0.5) * slotHeight);
        const jitterRatio = Number.isFinite(TITLE_CONSTANTS.TITLE_ENEMIES.INITIAL_BURST_Y_JITTER_RATIO)
            ? Math.max(0, Math.min(1, TITLE_CONSTANTS.TITLE_ENEMIES.INITIAL_BURST_Y_JITTER_RATIO))
            : 0.78;
        const jitterAmplitude = slotHeight * 0.5 * jitterRatio;
        return Math.max(minY, Math.min(maxY, slotCenter + mathUtil().random(-jitterAmplitude, jitterAmplitude)));
    }

    /**
     * 초기 버스트용 수평 속도를 계산합니다.
     * @param {number} baseAxisSpeed - 정상 상태 기준 수평 속도입니다.
     * @param {object} layerProfile - 현재 계층 프로필입니다.
     * @returns {number} 초기 버스트 수평 속도입니다.
     * @private
     */
    #getInitialBurstAxisSpeed(baseAxisSpeed, layerProfile) {
        const speedScale = Number.isFinite(layerProfile?.SpeedScale) ? layerProfile.SpeedScale : 1;
        const compensationMin = Number.isFinite(TITLE_CONSTANTS.TITLE_ENEMIES.INITIAL_BURST_LAYER_COMPENSATION_MIN)
            ? Math.max(0.01, TITLE_CONSTANTS.TITLE_ENEMIES.INITIAL_BURST_LAYER_COMPENSATION_MIN)
            : 0.4;
        const layerCompensation = 1 / Math.max(compensationMin, Math.sqrt(Math.max(0, speedScale)));
        const burstMultiplier = mathUtil().random(
            TITLE_CONSTANTS.TITLE_ENEMIES.INITIAL_BURST_AXIS_SPEED_MIN_MULTIPLIER,
            TITLE_CONSTANTS.TITLE_ENEMIES.INITIAL_BURST_AXIS_SPEED_MAX_MULTIPLIER
        );
        return baseAxisSpeed * burstMultiplier * layerCompensation;
    }

    /**
     * 초기 버스트용 수직 속도를 계산합니다.
     * @param {number} baseDriftSpeed - 정상 상태 기준 수직 속도입니다.
     * @returns {number} 초기 버스트 수직 속도입니다.
     * @private
     */
    #getInitialBurstDriftSpeed(baseDriftSpeed) {
        const driftMultiplier = mathUtil().random(
            TITLE_CONSTANTS.TITLE_ENEMIES.INITIAL_BURST_DRIFT_SPEED_MIN_MULTIPLIER,
            TITLE_CONSTANTS.TITLE_ENEMIES.INITIAL_BURST_DRIFT_SPEED_MAX_MULTIPLIER
        );
        return baseDriftSpeed * driftMultiplier;
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
            this.objectSystem.resolveEnemyCollisions(
                this.titleEnemies.filter((enemy) => this.#isCollisionResolvableTitleEnemy(enemy)),
                { delta }
            );
            return;
        }

        for (let layerIndex = 0; layerIndex < TITLE_PARALLAX_LAYERS.length; layerIndex++) {
            const layerEnemies = this.titleEnemies.filter(
                (enemy) => this.#isCollisionResolvableTitleEnemy(enemy)
                    && enemy._titleParallaxLayerIndex === layerIndex
            );
            if (layerEnemies.length <= 1) {
                continue;
            }
            this.objectSystem.resolveEnemyCollisions(layerEnemies, { delta });
        }
    }

    /**
     * 초기 버스트 충돌 유예 시간을 감소시킵니다.
     * @param {number} delta - 고정 틱 델타입니다.
     * @private
     */
    #updateInitialBurstCollisionGrace(delta) {
        if (!(Number.isFinite(delta) && delta > 0)) {
            return;
        }

        for (let index = 0; index < this.titleEnemies.length; index++) {
            const enemy = this.titleEnemies[index];
            if (!enemy?.active) {
                continue;
            }

            if (!Number.isFinite(enemy._titleCollisionGraceRemaining) || enemy._titleCollisionGraceRemaining <= 0) {
                enemy._titleCollisionGraceRemaining = 0;
                continue;
            }

            enemy._titleCollisionGraceRemaining = Math.max(0, enemy._titleCollisionGraceRemaining - delta);
        }
    }

    /**
     * 현재 적이 충돌 해소 대상인지 반환합니다.
     * @param {object} enemy - 판정할 적 인스턴스입니다.
     * @returns {boolean} 충돌 해소 대상 여부입니다.
     * @private
     */
    #isCollisionResolvableTitleEnemy(enemy) {
        return Boolean(enemy?.active)
            && !(Number.isFinite(enemy._titleCollisionGraceRemaining) && enemy._titleCollisionGraceRemaining > 0);
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
     * @param {number[]|null} [layerCounts=null] 계층별 현재 적 수 캐시입니다.
     * @param {number|null} [preferredLayerIndex=null] 우선적으로 생성할 페럴랙스 계층 인덱스입니다.
     * @returns {{index:number, profile:object}|null} 레이어 인덱스와 설정값입니다.
     * @private
     */
    #pickParallaxLayer(layerCounts = null, preferredLayerIndex = null) {
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

        const perLayerLimit = this.#getPerLayerEnemyLimit();
        const resolvedPreferredLayerIndex = Number.isInteger(preferredLayerIndex)
            ? Math.max(0, Math.min(TITLE_PARALLAX_LAYERS.length - 1, preferredLayerIndex))
            : null;
        if (resolvedPreferredLayerIndex !== null) {
            const layerCount = Array.isArray(layerCounts) ? layerCounts[resolvedPreferredLayerIndex] : 0;
            if (layerCount >= perLayerLimit) {
                return null;
            }
            return {
                index: resolvedPreferredLayerIndex,
                profile: TITLE_PARALLAX_LAYERS[resolvedPreferredLayerIndex]
            };
        }

        const availableLayerIndexes = [];
        for (let layerIndex = 0; layerIndex < TITLE_PARALLAX_LAYERS.length; layerIndex++) {
            const layerCount = Array.isArray(layerCounts) ? layerCounts[layerIndex] : 0;
            if (layerCount < perLayerLimit) {
                availableLayerIndexes.push(layerIndex);
            }
        }
        if (availableLayerIndexes.length === 0) {
            return null;
        }

        const randomIndex = Math.floor(mathUtil().random(0, availableLayerIndexes.length));
        const layerIndex = availableLayerIndexes[randomIndex];
        return {
            index: layerIndex,
            profile: TITLE_PARALLAX_LAYERS[layerIndex]
        };
    }

    /**
     * 페럴랙스 계층별 누적 스폰 카운터 배열을 현재 계층 수에 맞게 초기화합니다.
     * @private
     */
    #ensureLayerSpawnCounters() {
        const layerCount = Array.isArray(TITLE_PARALLAX_LAYERS) ? TITLE_PARALLAX_LAYERS.length : 0;
        if (Array.isArray(this.layerSpawnCounters) && this.layerSpawnCounters.length === layerCount) {
            return;
        }
        this.layerSpawnCounters = new Array(layerCount).fill(0);
    }

    /**
     * 초기 버스트 스폰 상태 배열을 현재 계층 수에 맞게 초기화합니다.
     * @private
     */
    #ensureInitialBurstState() {
        const layerCount = Array.isArray(TITLE_PARALLAX_LAYERS) ? TITLE_PARALLAX_LAYERS.length : 0;
        if (!Array.isArray(this.initialBurstElapsedSeconds) || this.initialBurstElapsedSeconds.length !== layerCount) {
            this.initialBurstElapsedSeconds = new Array(layerCount).fill(0);
        }
        if (!Array.isArray(this.initialBurstRemainingCounts) || this.initialBurstRemainingCounts.length !== layerCount) {
            this.initialBurstRemainingCounts = new Array(layerCount).fill(0);
        }
    }

    /**
     * 계층별 초기 버스트 남은 수량을 목표값으로 초기화합니다.
     * @private
     */
    #resetInitialBurstRemainingCounts() {
        this.#ensureInitialBurstState();
        const burstTargetCount = this.#getInitialBurstTargetCount();
        for (let layerIndex = 0; layerIndex < this.initialBurstRemainingCounts.length; layerIndex++) {
            this.initialBurstElapsedSeconds[layerIndex] = 0;
            this.initialBurstRemainingCounts[layerIndex] = burstTargetCount;
        }
    }

    /**
     * 아직 초기 버스트로 생성해야 할 적이 남아 있는지 판별합니다.
     * @returns {boolean} 초기 버스트 진행 여부입니다.
     * @private
     */
    #hasPendingInitialBurst() {
        this.#ensureInitialBurstState();
        for (let layerIndex = 0; layerIndex < this.initialBurstRemainingCounts.length; layerIndex++) {
            if ((this.initialBurstRemainingCounts[layerIndex] || 0) > 0) {
                return true;
            }
        }
        return false;
    }

    /**
     * 초기 버스트 스폰을 수행합니다.
     * @param {number} delta - 고정 틱 델타입니다.
     * @returns {number} 실제로 생성된 적 수입니다.
     * @private
     */
    #spawnInitialBurstEnemies(delta) {
        this.#ensureInitialBurstState();

        const layerCounts = this.#countParallaxLayerEnemies();
        let totalSpawnedCount = 0;

        for (let layerIndex = 0; layerIndex < this.initialBurstRemainingCounts.length; layerIndex++) {
            const remainingCount = Number.isFinite(this.initialBurstRemainingCounts[layerIndex])
                ? this.initialBurstRemainingCounts[layerIndex]
                : 0;
            const burstTargetCount = this.#getInitialBurstTargetCount();
            const burstDuration = this.#getInitialBurstDurationSeconds();
            const previousElapsedSeconds = Number.isFinite(this.initialBurstElapsedSeconds[layerIndex])
                ? this.initialBurstElapsedSeconds[layerIndex]
                : 0;
            const nextElapsedSeconds = Math.min(burstDuration, previousElapsedSeconds + delta);
            if (remainingCount <= 0) {
                this.initialBurstElapsedSeconds[layerIndex] = burstDuration;
                continue;
            }

            if (!(burstTargetCount > 0) || !(burstDuration > 0)) {
                continue;
            }

            const spawnedCountSoFar = burstTargetCount - remainingCount;
            const desiredSpawnedCount = this.#getInitialBurstDesiredSpawnCount(
                nextElapsedSeconds,
                burstTargetCount,
                burstDuration
            );
            let shapesToSpawn = desiredSpawnedCount - spawnedCountSoFar;
            if (shapesToSpawn <= 0) {
                this.initialBurstElapsedSeconds[layerIndex] = nextElapsedSeconds;
                continue;
            }
            const maxSpawnPerStep = this.#getInitialBurstMaxSpawnPerStep();
            if (maxSpawnPerStep > 0) {
                shapesToSpawn = Math.min(shapesToSpawn, maxSpawnPerStep);
            }
            if (shapesToSpawn > remainingCount) {
                shapesToSpawn = remainingCount;
            }

            const spawnedCount = this.pushShape(
                shapesToSpawn,
                layerCounts,
                layerIndex,
                'initialBurst',
                {
                    burstSpawnStartIndex: spawnedCountSoFar,
                    burstTargetCount
                }
            );
            this.initialBurstElapsedSeconds[layerIndex] = nextElapsedSeconds;
            if (spawnedCount <= 0) {
                continue;
            }

            this.initialBurstRemainingCounts[layerIndex] -= spawnedCount;
            totalSpawnedCount += spawnedCount;
        }

        return totalSpawnedCount;
    }

    /**
     * 페럴랙스 계층별 목표 점유율을 기준으로 독립 스폰을 수행합니다.
     * @param {number} delta - 고정 틱 델타입니다.
     * @returns {number} 실제로 생성된 적 수입니다.
     * @private
     */
    #spawnParallaxLayerEnemies(delta) {
        this.#ensureLayerSpawnCounters();

        const targetCount = this.#getTargetLayerEnemyCount();
        if (targetCount <= 0) {
            return 0;
        }

        const layerCounts = this.#countParallaxLayerEnemies();
        let totalSpawnedCount = 0;

        for (let layerIndex = 0; layerIndex < TITLE_PARALLAX_LAYERS.length; layerIndex++) {
            const currentCount = Number.isFinite(layerCounts[layerIndex]) ? layerCounts[layerIndex] : 0;
            if (currentCount >= targetCount) {
                this.layerSpawnCounters[layerIndex] = 0;
                continue;
            }

            const layerSpawnRate = this.#getLayerSpawnRate(layerIndex);
            if (!(layerSpawnRate > 0)) {
                continue;
            }

            this.layerSpawnCounters[layerIndex] += layerSpawnRate * delta;
            let shapesToSpawn = Math.floor(this.layerSpawnCounters[layerIndex]);
            const availableSlots = targetCount - currentCount;
            if (shapesToSpawn > availableSlots) {
                shapesToSpawn = availableSlots;
            }
            if (shapesToSpawn <= 0) {
                continue;
            }

            const spawnedCount = this.pushShape(shapesToSpawn, layerCounts, layerIndex);
            if (spawnedCount <= 0) {
                continue;
            }

            this.layerSpawnCounters[layerIndex] -= spawnedCount;
            totalSpawnedCount += spawnedCount;
        }

        return totalSpawnedCount;
    }

    /**
     * 페럴랙스 미사용 구성에서 기존 전역 스폰 정책을 유지합니다.
     * @param {number} delta - 고정 틱 델타입니다.
     * @returns {number} 실제로 생성된 적 수입니다.
     * @private
     */
    #spawnDefaultEnemies(delta) {
        const totalEnemyLimit = TITLE_CONSTANTS.TITLE_ENEMIES.ENEMY_LIMIT;
        if (!Number.isFinite(totalEnemyLimit) || totalEnemyLimit <= 0) {
            return 0;
        }

        const activeEnemyCount = this.#getActiveTitleEnemyCount();
        if (activeEnemyCount >= totalEnemyLimit) {
            return 0;
        }

        this.shapeSpawnCounter += this.shapesPerSecond * delta;
        let shapesToSpawn = Math.floor(this.shapeSpawnCounter);
        const availableSlots = totalEnemyLimit - activeEnemyCount;
        if (shapesToSpawn > availableSlots) {
            shapesToSpawn = availableSlots;
        }
        if (shapesToSpawn <= 0) {
            return 0;
        }

        const spawnedCount = this.pushShape(shapesToSpawn);
        this.shapeSpawnCounter -= spawnedCount;
        return spawnedCount;
    }

    /**
     * 계층별 활성 타이틀 적 수를 반환합니다.
     * @returns {number[]} 계층 인덱스별 적 수 배열입니다.
     * @private
     */
    #countParallaxLayerEnemies() {
        if (!Array.isArray(TITLE_PARALLAX_LAYERS) || TITLE_PARALLAX_LAYERS.length === 0) {
            return [];
        }

        const counts = new Array(TITLE_PARALLAX_LAYERS.length).fill(0);
        for (let i = 0; i < this.titleEnemies.length; i++) {
            const enemy = this.titleEnemies[i];
            if (!enemy?.active) {
                continue;
            }
            const layerIndex = Number.isInteger(enemy._titleParallaxLayerIndex)
                ? Math.max(0, Math.min(TITLE_PARALLAX_LAYERS.length - 1, enemy._titleParallaxLayerIndex))
                : 0;
            counts[layerIndex] += 1;
        }

        return counts;
    }

    /**
     * 현재 활성화된 타이틀 적 수를 반환합니다.
     * @returns {number} 활성 적 수입니다.
     * @private
     */
    #getActiveTitleEnemyCount() {
        let count = 0;
        for (let i = 0; i < this.titleEnemies.length; i++) {
            if (this.titleEnemies[i]?.active) {
                count += 1;
            }
        }
        return count;
    }

    /**
     * 계층별 최대 적 수 제한을 반환합니다.
     * @returns {number} 계층별 최대 적 수입니다.
     * @private
     */
    #getPerLayerEnemyLimit() {
        const limit = TITLE_CONSTANTS.TITLE_ENEMIES.ENEMY_LIMIT_PER_LAYER;
        if (Number.isFinite(limit) && limit > 0) {
            return Math.floor(limit);
        }

        const fallbackLimit = TITLE_CONSTANTS.TITLE_ENEMIES.ENEMY_LIMIT;
        return Number.isFinite(fallbackLimit) && fallbackLimit > 0
            ? Math.floor(fallbackLimit)
            : 0;
    }

    /**
     * 계층별 목표 점유율 비율을 반환합니다.
     * @returns {number} 0~1 범위의 목표 점유율 비율입니다.
     * @private
     */
    #getTargetLayerOccupancyRatio() {
        const ratio = TITLE_CONSTANTS.TITLE_ENEMIES.ENEMY_TARGET_OCCUPANCY_RATIO;
        if (Number.isFinite(ratio)) {
            return Math.max(0, Math.min(1, ratio));
        }

        return 1;
    }

    /**
     * 초기 버스트 목표 점유율 비율을 반환합니다.
     * @returns {number} 0~1 범위의 초기 버스트 점유율 비율입니다.
     * @private
     */
    #getInitialBurstFillRatio() {
        const ratio = TITLE_CONSTANTS.TITLE_ENEMIES.INITIAL_BURST_FILL_RATIO;
        if (Number.isFinite(ratio)) {
            return Math.max(0, Math.min(1, ratio));
        }

        return 0;
    }

    /**
     * 계층별 목표 적 수를 반환합니다.
     * @returns {number} 계층별 목표 적 수입니다.
     * @private
     */
    #getTargetLayerEnemyCount() {
        const perLayerLimit = this.#getPerLayerEnemyLimit();
        if (perLayerLimit <= 0) {
            return 0;
        }

        const targetCount = Math.round(perLayerLimit * this.#getTargetLayerOccupancyRatio());
        return Math.max(0, Math.min(perLayerLimit, targetCount));
    }

    /**
     * 계층별 초기 버스트 목표 적 수를 반환합니다.
     * @returns {number} 계층별 초기 버스트 목표 적 수입니다.
     * @private
     */
    #getInitialBurstTargetCount() {
        const perLayerLimit = this.#getPerLayerEnemyLimit();
        if (perLayerLimit <= 0) {
            return 0;
        }

        const burstCount = Math.round(perLayerLimit * this.#getInitialBurstFillRatio());
        return Math.max(0, Math.min(perLayerLimit, burstCount));
    }

    /**
     * 초기 버스트 전체 지속 시간을 반환합니다.
     * @returns {number} 초기 버스트 지속 시간(초)입니다.
     * @private
     */
    #getInitialBurstDurationSeconds() {
        const burstDuration = TITLE_CONSTANTS.TITLE_ENEMIES.INITIAL_BURST_DURATION_SECONDS;
        if (Number.isFinite(burstDuration) && burstDuration > 0) {
            return burstDuration;
        }

        return 0;
    }

    /**
     * 초기 버스트 적에게 적용할 충돌 유예 시간을 반환합니다.
     * @returns {number} 충돌 유예 시간(초)입니다.
     * @private
     */
    #getInitialBurstCollisionGraceSeconds() {
        const collisionGraceSeconds = TITLE_CONSTANTS.TITLE_ENEMIES.INITIAL_BURST_COLLISION_GRACE_SECONDS;
        if (Number.isFinite(collisionGraceSeconds) && collisionGraceSeconds > 0) {
            return collisionGraceSeconds;
        }

        return 0;
    }

    /**
     * 초기 버스트 한 틱당 최대 스폰 수를 반환합니다.
     * 첫 프레임 과밀로 인한 우측 정체를 완화합니다.
     * @returns {number} 한 틱당 최대 스폰 수입니다.
     * @private
     */
    #getInitialBurstMaxSpawnPerStep() {
        const maxSpawnPerStep = TITLE_CONSTANTS.TITLE_ENEMIES.INITIAL_BURST_MAX_SPAWN_PER_STEP;
        if (Number.isFinite(maxSpawnPerStep) && maxSpawnPerStep > 0) {
            return Math.max(1, Math.floor(maxSpawnPerStep));
        }

        return 0;
    }

    /**
     * 초기 버스트 누적 스폰 비율을 easeOutExpo 형태로 반환합니다.
     * @param {number} progress - 0~1 범위의 진행률입니다.
     * @returns {number} 누적 스폰 비율입니다.
     * @private
     */
    #getInitialBurstSpawnProgress(progress) {
        const clampedProgress = Number.isFinite(progress)
            ? Math.max(0, Math.min(1, progress))
            : 0;
        if (clampedProgress >= 1) {
            return 1;
        }

        const expoPower = Number.isFinite(TITLE_CONSTANTS.TITLE_ENEMIES.INITIAL_BURST_SPAWN_EASEOUT_EXPO_POWER)
            ? Math.max(1, TITLE_CONSTANTS.TITLE_ENEMIES.INITIAL_BURST_SPAWN_EASEOUT_EXPO_POWER)
            : 10;
        return 1 - Math.pow(2, -(expoPower * clampedProgress));
    }

    /**
     * 현재 초기 버스트 시점에서 누적되어야 할 목표 생성 수를 반환합니다.
     * @param {number} elapsedSeconds - 현재까지 지난 시간(초)입니다.
     * @param {number} burstTargetCount - 계층별 초기 버스트 목표 적 수입니다.
     * @param {number} burstDuration - 초기 버스트 전체 지속 시간(초)입니다.
     * @returns {number} 누적 목표 생성 수입니다.
     * @private
     */
    #getInitialBurstDesiredSpawnCount(elapsedSeconds, burstTargetCount, burstDuration) {
        if (!(Number.isFinite(burstTargetCount) && burstTargetCount > 0)) {
            return 0;
        }
        if (!(Number.isFinite(burstDuration) && burstDuration > 0)) {
            return burstTargetCount;
        }

        const progress = elapsedSeconds / burstDuration;
        const easedProgress = this.#getInitialBurstSpawnProgress(progress);
        return Math.min(
            burstTargetCount,
            Math.max(0, Math.round(burstTargetCount * easedProgress))
        );
    }

    /**
     * 특정 계층의 평균 수평 이동속도를 픽셀/초 단위로 반환합니다.
     * @param {number} layerIndex - 조회할 계층 인덱스입니다.
     * @returns {number} 평균 수평 이동속도(px/s)입니다.
     * @private
     */
    #getLayerAverageAxisSpeedPx(layerIndex) {
        const layerProfile = this.#getParallaxLayerProfile(layerIndex);
        const minRatio = TITLE_CONSTANTS.TITLE_ENEMIES.AXIS_SPEED_MIN_RATIO;
        const maxRatio = TITLE_CONSTANTS.TITLE_ENEMIES.AXIS_SPEED_MAX_RATIO;
        const leftMultiplier = Number.isFinite(TITLE_CONSTANTS.TITLE_ENEMIES.AXIS_SPEED_LEFT_MULTIPLIER)
            ? TITLE_CONSTANTS.TITLE_ENEMIES.AXIS_SPEED_LEFT_MULTIPLIER
            : 1;
        const averageRatio = (minRatio + maxRatio) * 0.5;
        const speedScale = Number.isFinite(layerProfile.SpeedScale) ? layerProfile.SpeedScale : 1;
        const averageSpeedPx = this.UIWW * averageRatio * speedScale * leftMultiplier;
        return Number.isFinite(averageSpeedPx) ? Math.max(0, averageSpeedPx) : 0;
    }

    /**
     * 타이틀 적이 좌측 컬링 지점까지 이동해야 하는 평균 수평 거리를 반환합니다.
     * @returns {number} 수평 이동 거리(px)입니다.
     * @private
     */
    #getHorizontalTravelDistancePx() {
        const cullRatio = TITLE_CONSTANTS.TITLE_ENEMIES.ENEMY_CULL_OUTSIDE_RATIO;
        const marginX = this.WW * cullRatio;
        const spawnXByRatio = this.WW * TITLE_CONSTANTS.TITLE_ENEMIES.ENEMY_SPAWN_X_RATIO;
        const spawnX = Math.min(spawnXByRatio, (this.WW + marginX) - TITLE_ENEMY_SPAWN_CULL_GUARD_PX);
        return Math.max(0, spawnX + marginX);
    }

    /**
     * 특정 계층의 목표 유지 스폰 레이트를 반환합니다.
     * @param {number} layerIndex - 조회할 계층 인덱스입니다.
     * @returns {number} 초당 스폰 수입니다.
     * @private
     */
    #getLayerSpawnRate(layerIndex) {
        const targetCount = this.#getTargetLayerEnemyCount();
        if (targetCount <= 0) {
            return 0;
        }

        const averageAxisSpeedPx = this.#getLayerAverageAxisSpeedPx(layerIndex);
        if (!(averageAxisSpeedPx > 0)) {
            return 0;
        }

        const travelDistancePx = this.#getHorizontalTravelDistancePx();
        if (!(travelDistancePx > 0)) {
            return 0;
        }

        const travelSeconds = travelDistancePx / averageAxisSpeedPx;
        if (!(travelSeconds > 0)) {
            return 0;
        }

        return targetCount / travelSeconds;
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
