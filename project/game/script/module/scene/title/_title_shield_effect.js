import { renderGL } from 'display/display_system.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { getDelta } from 'game/time_handler.js';
import { getData } from 'data/data_handler.js';
import { colorUtil } from 'util/color_util.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');
const TITLE_SHIELD = TITLE_CONSTANTS.TITLE_SHIELD || Object.freeze({});
const DEFAULT_MAGNETIC_SHIELD_COLORS = Object.freeze({
    shadow: Object.freeze([0.07, 0.04, 0.25]),
    low: Object.freeze([0.60, 0.36, 0.98]),
    high: Object.freeze([0.70, 0.93, 1.0]),
    highlight: Object.freeze([0.96, 0.995, 1.0])
});
const THEME_SHIELD_PATHS = Object.freeze({
    shadow: ['Title', 'Shield', 'Shadow'],
    low: ['Title', 'Shield', 'Low'],
    high: ['Title', 'Shield', 'High'],
    highlight: ['Title', 'Shield', 'Highlight']
});

/**
 * @description 배열 인덱스로 객체 깊은 경로에 접근합니다.
 * @param {string[]} path - 테마 경로입니다.
 * @param {object} [fallback='#000000'] - 기본값입니다.
 * @returns {string|object|null} 경로 값입니다.
 */
function getThemeValue(path, fallback = null) {
    let value = ColorSchemes;
    for (const key of path) {
        value = value?.[key];
        if (!value) {
            return fallback;
        }
    }

    return value;
}

/**
 * 0~1 범위의 색상 벡터를 반환합니다.
 * @param {string} color - css 색상 문자열입니다.
 * @param {Array<number>} fallback - 예비 색상입니다.
 * @returns {Array<number>} 0~1 색상 벡터입니다.
 */
function colorToVec3(color, fallback = Object.freeze([0, 0, 0])) {
    const colorString = typeof color === 'string' ? color.trim() : null;
    if (!colorString) {
        return fallback;
    }

    const parsed = colorUtil().cssToRgb(colorString);
    if (!parsed || !Number.isFinite(parsed.r) || !Number.isFinite(parsed.g) || !Number.isFinite(parsed.b)) {
        return fallback;
    }

    return Object.freeze([
        Math.max(0, Math.min(1, parsed.r / 255)),
        Math.max(0, Math.min(1, parsed.g / 255)),
        Math.max(0, Math.min(1, parsed.b / 255))
    ]);
}

/**
 * 실드 색상 설정을 반환합니다.
 * @returns {{shadow: number[], low: number[], high: number[], highlight: number[]}} 실드 색상 벡터입니다.
 */
function getShieldColors() {
    const shadow = colorToVec3(getThemeValue(THEME_SHIELD_PATHS.shadow), DEFAULT_MAGNETIC_SHIELD_COLORS.shadow);
    const low = colorToVec3(getThemeValue(THEME_SHIELD_PATHS.low), DEFAULT_MAGNETIC_SHIELD_COLORS.low);
    const high = colorToVec3(getThemeValue(THEME_SHIELD_PATHS.high), DEFAULT_MAGNETIC_SHIELD_COLORS.high);
    const highlight = colorToVec3(getThemeValue(THEME_SHIELD_PATHS.highlight), DEFAULT_MAGNETIC_SHIELD_COLORS.highlight);

    return {
        shadow,
        low,
        high,
        highlight
    };
}

/**
 * @class TitleShieldEffect
 * @description 타이틀 원형 실드의 충돌 플래시와 눌림 왜곡 상태를 관리합니다.
 */
export class TitleShieldEffect {
    /**
     * 타이틀 실드 이펙트 상태 컨테이너를 생성합니다.
     */
    constructor() {
        this.centerX = 0;
        this.centerY = 0;
        this.coreRadius = 0;
        this.radius = 0;
        this.time = 0;
        this.impacts = [];
        this.dents = [];
        this.enemyStateMap = new WeakMap();
    }

    /**
     * 실드 레이아웃을 현재 로딩 원형 배치와 동기화합니다.
     * @param {{centerX:number, centerY:number, radius:number}|null} layout - 실드 중심/반경 정보입니다.
     */
    syncLayout(layout) {
        if (!layout) {
            this.centerX = 0;
            this.centerY = 0;
            this.coreRadius = 0;
            this.radius = 0;
            return;
        }

        this.centerX = Number.isFinite(layout.centerX) ? layout.centerX : 0;
        this.centerY = Number.isFinite(layout.centerY) ? layout.centerY : 0;
        this.coreRadius = Number.isFinite(layout.radius) ? Math.max(0, layout.radius) : 0;
        this.radius = this.coreRadius * this.#getShellRadiusMultiplier();
    }

    /**
     * 현재 프레임에 사용 중인 실드 외곽 반경을 반환합니다.
     * @returns {number} 실드 반경입니다.
     */
    getShieldRadius() {
        return this.radius;
    }

    /**
     * 현재 프레임 기준으로 충돌 플래시와 눌림 왜곡 데이터를 갱신합니다.
     * @param {object[]} enemies - 타이틀 화면 적 목록입니다.
     * @param {number} objectOffsetY - 오브젝트 좌표계를 화면 좌표계로 바꾸는 Y 오프셋입니다.
     */
    update(enemies, objectOffsetY) {
        const delta = getDelta();
        if (!Number.isFinite(delta) || delta < 0) {
            return;
        }

        this.time += delta;
        this.#updateImpacts(delta);
        this.dents.length = 0;

        if (!Array.isArray(enemies) || this.radius <= 0) {
            return;
        }

        for (let index = 0; index < enemies.length; index++) {
            const enemy = enemies[index];
            if (!enemy || enemy.active === false) {
                continue;
            }

            this.#registerEnemy(enemy, objectOffsetY, delta);
        }

        this.dents.sort((left, right) => {
            const strengthGap = right.strength - left.strength;
            if (Math.abs(strengthGap) > 0.0001) {
                return strengthGap;
            }

            return right.depth - left.depth;
        });
        if (this.dents.length > this.#getDentMaxCount()) {
            this.dents.length = this.#getDentMaxCount();
        }
    }

    /**
     * 현재 실드 상태를 effect 레이어에 렌더 명령으로 전달합니다.
     */
    draw() {
        if (this.radius <= 0) {
            return;
        }
        const shieldColors = getShieldColors();

        renderGL('effect', {
            effectType: 'magneticShield',
            x: this.centerX,
            y: this.centerY,
            radius: this.radius,
            fieldRadius: this.#getFieldRadius(),
            time: this.time,
            alpha: this.#getBaseAlpha(),
            ringThickness: this.#getRingThickness(),
            glowWidth: this.#getGlowWidth(),
            shadowColor: shieldColors.shadow,
            lowColor: shieldColors.low,
            highColor: shieldColors.high,
            highlightColor: shieldColors.highlight,
            impacts: this.impacts.map((impact) => ({
                angle: impact.angle,
                intensity: impact.intensity,
                width: impact.width,
                progress: impact.age / Math.max(0.0001, impact.duration)
            })),
            dents: this.dents.map((dent) => ({
                angle: dent.angle,
                depth: dent.depth,
                width: dent.width,
                strength: dent.strength
            }))
        });
    }

    /**
     * 내부 상태를 정리합니다.
     */
    destroy() {
        this.impacts.length = 0;
        this.dents.length = 0;
        this.enemyStateMap = new WeakMap();
    }

    /**
     * @private
     * @param {number} delta - 경과 시간입니다.
     */
    #updateImpacts(delta) {
        for (let index = this.impacts.length - 1; index >= 0; index--) {
            const impact = this.impacts[index];
            impact.age += delta;
            if (impact.age < impact.duration) {
                continue;
            }

            this.impacts.splice(index, 1);
        }
    }

    /**
     * @private
     * @param {object} enemy - 평가할 적 인스턴스입니다.
     * @param {number} objectOffsetY - 화면 변환용 오프셋입니다.
     * @param {number} delta - 경과 시간입니다.
     */
    #registerEnemy(enemy, objectOffsetY, delta) {
        const radius = this.#getEnemyScreenRadius(enemy);
        if (!Number.isFinite(radius) || radius <= 0) {
            return;
        }

        const screenX = Number.isFinite(enemy.renderPosition?.x) ? enemy.renderPosition.x : enemy.position?.x;
        const screenYWorld = Number.isFinite(enemy.renderPosition?.y) ? enemy.renderPosition.y : enemy.position?.y;
        const screenY = Number.isFinite(screenYWorld) ? screenYWorld - objectOffsetY : 0;
        const dx = screenX - this.centerX;
        const dy = screenY - this.centerY;
        const distance = Math.sqrt((dx * dx) + (dy * dy));
        if (!Number.isFinite(distance) || distance <= 0.0001) {
            return;
        }

        const angle = Math.atan2(dy, dx);
        const impactBand = this.#getImpactBandPx();
        const contactPadding = this.#getContactPaddingPx();
        const shieldBoundaryDistance = distance - this.radius - radius;
        const contacting = Math.abs(shieldBoundaryDistance) <= (impactBand + contactPadding);
        const state = this.#getEnemyState(enemy);

        const influenceRange = this.#getPressureInfluencePx();
        const targetPressure = this.#calculatePressure(shieldBoundaryDistance, influenceRange, radius);
        const visualInfluenceRange = influenceRange * this.#getVisualTriggerDistanceMultiplier();
        const targetVisualPressure = this.#calculatePressure(shieldBoundaryDistance, visualInfluenceRange, radius);
        const followRate = this.#getPressureFollowRate();
        const lerpFactor = 1 - Math.exp(-delta * followRate);
        state.pressure += (targetPressure - state.pressure) * lerpFactor;
        state.visualPressure += (targetVisualPressure - state.visualPressure) * lerpFactor;

        if (contacting && !state.contacting) {
            this.#pushImpact(enemy, angle, state.pressure, radius);
        }
        state.contacting = contacting;

        if (state.visualPressure <= 0.001) {
            return;
        }

        this.dents.push({
            angle,
            depth: this.#getMaxDepthPx() * state.pressure * state.pressure,
            width: this.#buildAngularWidth(radius),
            strength: state.visualPressure
        });
    }

    /**
     * @private
     * @param {number} shieldBoundaryDistance - 적과 실드 경계 사이 거리입니다.
     * @param {number} influenceRange - 압력이 시작될 영향 범위입니다.
     * @param {number} enemyRadius - 적 반경입니다.
     * @returns {number} 0~1 범위의 정규화된 압력 값입니다.
     */
    #calculatePressure(shieldBoundaryDistance, influenceRange, enemyRadius) {
        return Math.max(
            0,
            Math.min(1, (influenceRange - shieldBoundaryDistance) / Math.max(1, influenceRange + enemyRadius))
        );
    }

    /**
     * @private
     * @param {object} enemy - 충돌한 적 인스턴스입니다.
     * @param {number} angle - 충돌 각도입니다.
     * @param {number} pressure - 현재 압력 값입니다.
     * @param {number} enemyRadius - 적의 화면 반경입니다.
     */
    #pushImpact(enemy, angle, pressure, enemyRadius) {
        const impactSpeed = Math.sqrt(
            Math.pow((Number.isFinite(enemy.speed?.x) ? enemy.speed.x : 0) * (Number.isFinite(enemy.moveSpeed) ? enemy.moveSpeed : 1), 2)
            + Math.pow((Number.isFinite(enemy.speed?.y) ? enemy.speed.y : 0) * (Number.isFinite(enemy.moveSpeed) ? enemy.moveSpeed : 1), 2)
        );
        const speedReference = Math.max(1, Number(TITLE_SHIELD.IMPACT_SPEED_REFERENCE_PX) || 120);
        const speedFactor = Math.max(0, Math.min(1, impactSpeed / speedReference));
        const intensity = Math.max(
            this.#getImpactIntensityMin(),
            Math.min(
                this.#getImpactIntensityMax(),
                this.#getImpactIntensityMin() + (speedFactor * 0.4) + (pressure * 0.45)
            )
        );

        this.impacts.unshift({
            angle,
            intensity,
            width: this.#buildAngularWidth(enemyRadius) * 0.9,
            age: 0,
            duration: this.#getImpactDuration()
        });

        if (this.impacts.length > this.#getImpactMaxCount()) {
            this.impacts.length = this.#getImpactMaxCount();
        }
    }

    /**
     * @private
     * @param {object} enemy - 평가할 적 인스턴스입니다.
     * @returns {{contacting:boolean, pressure:number, visualPressure:number}} 적별 실드 상태입니다.
     */
    #getEnemyState(enemy) {
        let state = this.enemyStateMap.get(enemy);
        if (state) {
            return state;
        }

        state = {
            contacting: false,
            pressure: 0,
            visualPressure: 0
        };
        this.enemyStateMap.set(enemy, state);
        return state;
    }

    /**
     * @private
     * @param {number} enemyRadius - 적 화면 반경입니다.
     * @returns {number} 각도 폭(rad)입니다.
     */
    #buildAngularWidth(enemyRadius) {
        const padding = Number.isFinite(TITLE_SHIELD.ANGULAR_WIDTH_PADDING_PX) ? TITLE_SHIELD.ANGULAR_WIDTH_PADDING_PX : 12;
        const widthScale = Number.isFinite(TITLE_SHIELD.ANGULAR_WIDTH_SCALE) ? TITLE_SHIELD.ANGULAR_WIDTH_SCALE : 1.15;
        const projectedWidth = Math.max(4, enemyRadius + padding);
        const ratio = Math.max(0.02, Math.min(0.98, projectedWidth / Math.max(1, this.radius)));
        return Math.asin(ratio) * widthScale;
    }

    /**
     * @private
     * @param {object} enemy - 적 인스턴스입니다.
     * @returns {number} 화면 기준 근사 반경입니다.
     */
    #getEnemyScreenRadius(enemy) {
        if (!enemy || typeof enemy.getRenderHeightPx !== 'function') {
            return 0;
        }

        const baseHeight = enemy.getRenderHeightPx();
        const renderHeight = baseHeight * (Number.isFinite(enemy.heightScale) ? enemy.heightScale : 1);
        const renderWidth = baseHeight * (Number.isFinite(enemy.aspectRatio) ? enemy.aspectRatio : 1);
        return Math.max(renderWidth, renderHeight) * 0.5;
    }

    /**
     * @private
     * @returns {number} 실드 기본 알파 값입니다.
     */
    #getBaseAlpha() {
        return Number.isFinite(TITLE_SHIELD.BASE_ALPHA) ? TITLE_SHIELD.BASE_ALPHA : 1;
    }

    /**
     * @private
     * @returns {number} 실드 링 두께입니다.
     */
    #getRingThickness() {
        return Number.isFinite(TITLE_SHIELD.RING_THICKNESS_PX) ? TITLE_SHIELD.RING_THICKNESS_PX : 7;
    }

    /**
     * @private
     * @returns {number} 실드 glow 폭입니다.
     */
    #getGlowWidth() {
        return Number.isFinite(TITLE_SHIELD.GLOW_WIDTH_PX) ? TITLE_SHIELD.GLOW_WIDTH_PX : 26;
    }

    /**
     * @private
     * @returns {number} 원 본체 대비 실드 반경 배율입니다.
     */
    #getShellRadiusMultiplier() {
        return Number.isFinite(TITLE_SHIELD.SHELL_RADIUS_MULTIPLIER)
            ? Math.max(1, TITLE_SHIELD.SHELL_RADIUS_MULTIPLIER)
            : 2;
    }

    /**
     * @private
     * @returns {number} 외곽 자기장 필드가 퍼질 최대 반경입니다.
     */
    #getFieldRadius() {
        const multiplier = Number.isFinite(TITLE_SHIELD.FIELD_RADIUS_MULTIPLIER)
            ? TITLE_SHIELD.FIELD_RADIUS_MULTIPLIER
            : 1;
        return Math.max(this.radius, this.radius * Math.max(1, multiplier));
    }

    /**
     * @private
     * @returns {number} 충돌 이벤트 유지 시간입니다.
     */
    #getImpactDuration() {
        return Number.isFinite(TITLE_SHIELD.IMPACT_DURATION_SECONDS) ? TITLE_SHIELD.IMPACT_DURATION_SECONDS : 0.42;
    }

    /**
     * @private
     * @returns {number} 충돌 밴드 두께입니다.
     */
    #getImpactBandPx() {
        return Number.isFinite(TITLE_SHIELD.IMPACT_BAND_PX) ? TITLE_SHIELD.IMPACT_BAND_PX : 18;
    }

    /**
     * @private
     * @returns {number} 접촉 완충 영역입니다.
     */
    #getContactPaddingPx() {
        return Number.isFinite(TITLE_SHIELD.CONTACT_PADDING_PX) ? TITLE_SHIELD.CONTACT_PADDING_PX : 10;
    }

    /**
     * @private
     * @returns {number} 눌림 왜곡 영향 거리입니다.
     */
    #getPressureInfluencePx() {
        return Number.isFinite(TITLE_SHIELD.PRESSURE_INFLUENCE_PX) ? TITLE_SHIELD.PRESSURE_INFLUENCE_PX : 54;
    }

    /**
     * @private
     * @returns {number} 실드 시각 반응이 시작될 거리 배율입니다.
     */
    #getVisualTriggerDistanceMultiplier() {
        return Number.isFinite(TITLE_SHIELD.VISUAL_TRIGGER_DISTANCE_MULTIPLIER)
            ? Math.max(1, TITLE_SHIELD.VISUAL_TRIGGER_DISTANCE_MULTIPLIER)
            : 1.2;
    }

    /**
     * @private
     * @returns {number} 눌림 압력 추종 속도입니다.
     */
    #getPressureFollowRate() {
        return Number.isFinite(TITLE_SHIELD.PRESSURE_FOLLOW_RATE) ? TITLE_SHIELD.PRESSURE_FOLLOW_RATE : 12;
    }

    /**
     * @private
     * @returns {number} 최대 눌림 깊이입니다.
     */
    #getMaxDepthPx() {
        return Number.isFinite(TITLE_SHIELD.PRESSURE_MAX_DEPTH_PX) ? TITLE_SHIELD.PRESSURE_MAX_DEPTH_PX : 18;
    }

    /**
     * @private
     * @returns {number} 최소 충돌 강도입니다.
     */
    #getImpactIntensityMin() {
        return Number.isFinite(TITLE_SHIELD.IMPACT_INTENSITY_MIN) ? TITLE_SHIELD.IMPACT_INTENSITY_MIN : 0.45;
    }

    /**
     * @private
     * @returns {number} 최대 충돌 강도입니다.
     */
    #getImpactIntensityMax() {
        return Number.isFinite(TITLE_SHIELD.IMPACT_INTENSITY_MAX) ? TITLE_SHIELD.IMPACT_INTENSITY_MAX : 1;
    }

    /**
     * @private
     * @returns {number} 최대 impact 개수입니다.
     */
    #getImpactMaxCount() {
        return Number.isFinite(TITLE_SHIELD.IMPACT_MAX_COUNT) ? Math.max(1, TITLE_SHIELD.IMPACT_MAX_COUNT) : 8;
    }

    /**
     * @private
     * @returns {number} 최대 dent 개수입니다.
     */
    #getDentMaxCount() {
        return Number.isFinite(TITLE_SHIELD.DENT_MAX_COUNT) ? Math.max(1, TITLE_SHIELD.DENT_MAX_COUNT) : 6;
    }
}
