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
        this.targetCenterX = 0;
        this.targetCenterY = 0;
        this.targetCoreRadius = 0;
        this.targetRadius = 0;
        this.centerX = 0;
        this.centerY = 0;
        this.coreRadius = 0;
        this.radius = 0;
        this.time = 0;
        this.impacts = [];
        this.dents = [];
        this.dentCandidates = [];
        this.activeDentKeys = [];
        this.enemyStateMap = new WeakMap();
        this.visualLayoutInitialized = false;
    }

    /**
     * 실드 레이아웃을 현재 로딩 원형 배치와 동기화합니다.
     * @param {{centerX:number, centerY:number, radius:number}|null} layout - 실드 중심/반경 정보입니다.
     */
    syncLayout(layout) {
        if (!layout) {
            this.targetCenterX = 0;
            this.targetCenterY = 0;
            this.targetCoreRadius = 0;
            this.targetRadius = 0;
            return;
        }

        this.targetCenterX = Number.isFinite(layout.centerX) ? layout.centerX : 0;
        this.targetCenterY = Number.isFinite(layout.centerY) ? layout.centerY : 0;
        this.targetCoreRadius = Number.isFinite(layout.radius) ? Math.max(0, layout.radius) : 0;
        this.targetRadius = this.targetCoreRadius * this.#getShellRadiusMultiplier();

        if (this.visualLayoutInitialized) {
            return;
        }

        this.centerX = this.targetCenterX;
        this.centerY = this.targetCenterY;
        this.coreRadius = this.targetCoreRadius;
        this.radius = this.targetRadius;
        this.visualLayoutInitialized = true;
    }

    /**
     * 현재 프레임에 사용 중인 실드 외곽 반경을 반환합니다.
     * @returns {number} 실드 반경입니다.
     */
    getShieldRadius() {
        return this.targetRadius;
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
        const visualDelta = this.#getVisualDelta(delta);

        this.time += delta;
        this.#updateImpacts(delta, visualDelta);
        this.#updateVisualLayout(visualDelta);
        this.dents.length = 0;
        this.dentCandidates.length = 0;

        if (!Array.isArray(enemies) || this.radius <= 0) {
            this.activeDentKeys.length = 0;
            return;
        }

        for (let index = 0; index < enemies.length; index++) {
            const enemy = enemies[index];
            if (!enemy || enemy.active === false) {
                continue;
            }
            if (!this.#isShieldReactiveEnemy(enemy)) {
                continue;
            }

            this.#registerEnemy(enemy, objectOffsetY, visualDelta);
        }
        this.#syncVisibleDents();
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
        this.targetCenterX = 0;
        this.targetCenterY = 0;
        this.targetCoreRadius = 0;
        this.targetRadius = 0;
        this.centerX = 0;
        this.centerY = 0;
        this.coreRadius = 0;
        this.radius = 0;
        this.impacts.length = 0;
        this.dents.length = 0;
        this.dentCandidates.length = 0;
        this.activeDentKeys.length = 0;
        this.enemyStateMap = new WeakMap();
        this.visualLayoutInitialized = false;
    }

    /**
     * @private
     * @param {number} delta - 경과 시간입니다.
     */
    #updateImpacts(delta, visualDelta) {
        for (let index = this.impacts.length - 1; index >= 0; index--) {
            const impact = this.impacts[index];
            impact.age += delta;
            if (impact.age < impact.duration) {
                const angleFollowFactor = 1 - Math.exp(-visualDelta * this.#getImpactAngleFollowRate());
                const intensityFollowFactor = 1 - Math.exp(-visualDelta * this.#getImpactIntensityFollowRate());
                const widthFollowFactor = 1 - Math.exp(-visualDelta * this.#getImpactWidthFollowRate());
                impact.angle = this.#lerpAngle(impact.angle, impact.targetAngle, angleFollowFactor);
                impact.intensity += (impact.targetIntensity - impact.intensity) * intensityFollowFactor;
                impact.width += (impact.targetWidth - impact.width) * widthFollowFactor;
                continue;
            }

            this.impacts.splice(index, 1);
        }
    }

    /**
     * @private
     * @param {number} delta - 경과 시간입니다.
     */
    #updateVisualLayout(delta) {
        if (!this.visualLayoutInitialized) {
            return;
        }

        const followRate = this.#getLayoutFollowRate();
        const lerpFactor = 1 - Math.exp(-delta * followRate);
        this.centerX += (this.targetCenterX - this.centerX) * lerpFactor;
        this.centerY += (this.targetCenterY - this.centerY) * lerpFactor;
        this.coreRadius += (this.targetCoreRadius - this.coreRadius) * lerpFactor;
        this.radius += (this.targetRadius - this.radius) * lerpFactor;
    }

    /**
     * @private
     * @param {object} enemy - 평가할 적 인스턴스입니다.
     * @param {number} objectOffsetY - 화면 변환용 오프셋입니다.
     * @param {number} visualDelta - 시각 보간에 사용할 경과 시간입니다.
     */
    #registerEnemy(enemy, objectOffsetY, visualDelta) {
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
        const shieldBoundaryDistance = this.#stabilizeBoundaryDistance(distance - this.radius - radius);
        const state = this.#getEnemyState(enemy);
        const contactRange = impactBand + contactPadding + (
            state.contacting
                ? this.#getContactHysteresisPx()
                : 0
        );
        const contacting = Math.abs(shieldBoundaryDistance) <= contactRange;

        const influenceRange = this.#getPressureInfluencePx();
        const targetPressure = this.#calculatePressure(
            shieldBoundaryDistance,
            influenceRange,
            radius
        );
        const visualInfluenceRange = influenceRange * this.#getVisualTriggerDistanceMultiplier();
        const targetVisualPressure = this.#calculatePressure(
            shieldBoundaryDistance,
            visualInfluenceRange,
            radius
        );
        state.pressure = this.#followScalar(state.pressure, targetPressure, visualDelta);
        state.visualPressure = this.#followScalar(state.visualPressure, targetVisualPressure, visualDelta);
        state.displayAngle = this.#lerpAngle(
            state.displayAngle,
            angle,
            state.angleInitialized
                ? (1 - Math.exp(-visualDelta * this.#getDentAngleFollowRate()))
                : 1
        );
        state.angleInitialized = true;

        if (contacting && !state.contacting) {
            this.#pushImpact(enemy, state.displayAngle, state.pressure, radius);
        }
        state.contacting = contacting;

        if (state.visualPressure <= 0.001) {
            return;
        }

        this.dentCandidates.push({
            key: state,
            angle: state.displayAngle,
            depth: this.#getMaxDepthPx() * state.pressure * state.pressure,
            width: this.#buildAngularWidth(radius),
            strength: state.visualPressure
        });
    }

    /**
     * @private
     * @param {number} shieldBoundaryDistance - 적과 실드 경계 사이 거리입니다.
     * @param {number} outerInfluenceRange - 실드 바깥쪽 영향 범위입니다.
     * @param {number} enemyRadius - 적 반경입니다.
     * @returns {number} 0~1 범위의 정규화된 압력 값입니다.
     */
    #calculatePressure(shieldBoundaryDistance, outerInfluenceRange, enemyRadius) {
        return Math.max(
            0,
            Math.min(1, (outerInfluenceRange - shieldBoundaryDistance) / Math.max(1, outerInfluenceRange + enemyRadius))
        );
    }

    /**
     * @private
     * @param {number} boundaryDistance - 원본 실드 경계 거리입니다.
     * @returns {number} 경계선 0 부근의 흔들림을 제거한 거리입니다.
     */
    #stabilizeBoundaryDistance(boundaryDistance) {
        if (!Number.isFinite(boundaryDistance)) {
            return 0;
        }

        const epsilon = this.#getBoundaryEpsilonPx();
        if (epsilon <= 0 || Math.abs(boundaryDistance) > epsilon) {
            return boundaryDistance;
        }

        return 0;
    }

    /**
     * @private
     * @param {number} currentValue - 현재 값입니다.
     * @param {number} targetValue - 목표 값입니다.
     * @param {number} delta - 경과 시간입니다.
     * @returns {number} 추종 결과 값입니다.
     */
    #followScalar(currentValue, targetValue, delta) {
        const followRate = targetValue >= currentValue
            ? this.#getPressureFollowRate()
            : this.#getPressureReleaseFollowRate();
        const lerpFactor = 1 - Math.exp(-delta * followRate);
        return currentValue + ((targetValue - currentValue) * lerpFactor);
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
        const width = this.#buildAngularWidth(enemyRadius) * 0.9;
        const duration = this.#getImpactDuration();
        const mergeableImpact = this.#findMergeableImpact(angle);
        if (mergeableImpact) {
            this.#retargetImpact(mergeableImpact, angle, intensity, width, duration);
            return;
        }

        if (this.impacts.length < this.#getImpactMaxCount()) {
            this.impacts.unshift(this.#createImpact(angle, intensity, width, duration));
            return;
        }

        const weakestImpact = this.#findWeakestImpact();
        if (!this.#shouldReplaceImpact(weakestImpact, intensity)) {
            return;
        }

        const weakestIndex = this.impacts.indexOf(weakestImpact);
        if (weakestIndex < 0) {
            return;
        }

        this.impacts[weakestIndex] = this.#createImpact(angle, intensity, width, duration);
    }

    /**
     * @private
     * @param {number} angle - impact 각도입니다.
     * @param {number} intensity - impact 강도입니다.
     * @param {number} width - impact 폭입니다.
     * @param {number} duration - impact 유지 시간입니다.
     * @returns {{angle:number, targetAngle:number, intensity:number, targetIntensity:number, width:number, targetWidth:number, age:number, duration:number}} 생성된 impact 상태입니다.
     */
    #createImpact(angle, intensity, width, duration) {
        return {
            angle,
            targetAngle: angle,
            intensity,
            targetIntensity: intensity,
            width,
            targetWidth: width,
            age: 0,
            duration
        };
    }

    /**
     * @private
     * @param {{angle:number, targetAngle:number, intensity:number, targetIntensity:number, width:number, targetWidth:number, age:number, duration:number}|undefined} impact - 갱신할 impact 상태입니다.
     * @param {number} angle - 새 목표 각도입니다.
     * @param {number} intensity - 새 목표 강도입니다.
     * @param {number} width - 새 목표 폭입니다.
     * @param {number} duration - 새 유지 시간입니다.
     */
    #retargetImpact(impact, angle, intensity, width, duration) {
        if (!impact) {
            return;
        }

        impact.targetAngle = angle;
        impact.targetIntensity = Math.max(impact.targetIntensity, intensity);
        impact.targetWidth = Math.max(impact.targetWidth, width);
        impact.intensity = Math.max(impact.intensity, intensity * this.#getImpactImmediateBoostRatio());
        impact.width = Math.max(impact.width, width * this.#getImpactImmediateBoostRatio());
        impact.age = 0;
        impact.duration = Math.max(impact.duration, duration);
    }

    /**
     * @private
     * @param {number} angle - 새 impact의 각도입니다.
     * @returns {{angle:number, targetAngle:number, intensity:number, targetIntensity:number, width:number, targetWidth:number, age:number, duration:number}|null} 병합 가능한 impact입니다.
     */
    #findMergeableImpact(angle) {
        const mergeThreshold = this.#getImpactMergeAngleThreshold();
        let bestImpact = null;
        let bestAngularDistance = Infinity;

        for (let index = 0; index < this.impacts.length; index++) {
            const impact = this.impacts[index];
            if (!impact || impact.age >= impact.duration) {
                continue;
            }

            const angularDistance = Math.abs(this.#getAngularDelta(impact.targetAngle, angle));
            if (angularDistance > mergeThreshold || angularDistance >= bestAngularDistance) {
                continue;
            }

            bestAngularDistance = angularDistance;
            bestImpact = impact;
        }

        return bestImpact;
    }

    /**
     * @private
     * @returns {{angle:number, targetAngle:number, intensity:number, targetIntensity:number, width:number, targetWidth:number, age:number, duration:number}|null} 현재 가장 약한 impact입니다.
     */
    #findWeakestImpact() {
        let weakestImpact = null;
        let weakestScore = Infinity;

        for (let index = 0; index < this.impacts.length; index++) {
            const impact = this.impacts[index];
            if (!impact) {
                continue;
            }

            const remainingLifeRatio = Math.max(0, 1 - (impact.age / Math.max(0.0001, impact.duration)));
            const impactScore = Math.max(impact.intensity, impact.targetIntensity) * remainingLifeRatio;
            if (impactScore >= weakestScore) {
                continue;
            }

            weakestScore = impactScore;
            weakestImpact = impact;
        }

        return weakestImpact;
    }

    /**
     * @private
     * @param {{angle:number, targetAngle:number, intensity:number, targetIntensity:number, width:number, targetWidth:number, age:number, duration:number}|null} currentImpact - 현재 유지 중인 impact입니다.
     * @param {number} newIntensity - 새 impact 강도입니다.
     * @returns {boolean} 교체 여부입니다.
     */
    #shouldReplaceImpact(currentImpact, newIntensity) {
        if (!currentImpact) {
            return true;
        }

        const remainingLifeRatio = Math.max(0, 1 - (currentImpact.age / Math.max(0.0001, currentImpact.duration)));
        const currentScore = Math.max(currentImpact.intensity, currentImpact.targetIntensity) * remainingLifeRatio;
        return newIntensity > (currentScore + this.#getImpactReplacementBias());
    }

    /**
     * @private
     * @param {object} enemy - 평가할 적 인스턴스입니다.
     * @returns {{enemyId:number|null, contacting:boolean, pressure:number, visualPressure:number, displayAngle:number, angleInitialized:boolean}} 적별 실드 상태입니다.
     */
    #getEnemyState(enemy) {
        const enemyId = Number.isInteger(enemy?.id) ? enemy.id : null;
        let state = this.enemyStateMap.get(enemy);
        if (state && state.enemyId === enemyId) {
            return state;
        }

        state = {
            enemyId,
            contacting: false,
            pressure: 0,
            visualPressure: 0,
            displayAngle: 0,
            angleInitialized: false
        };
        this.enemyStateMap.set(enemy, state);
        return state;
    }

    /**
     * @private
     * @param {object} enemy - 평가할 적 인스턴스입니다.
     * @returns {boolean} 실드 자기장 반응 대상 여부입니다.
     */
    #isShieldReactiveEnemy(enemy) {
        const motionScale = Number.isFinite(enemy?._titleParallaxMotionScale)
            ? enemy._titleParallaxMotionScale
            : 1;
        return motionScale > 0;
    }

    /**
     * @private
     * @param {number} currentAngle - 현재 각도입니다.
     * @param {number} targetAngle - 목표 각도입니다.
     * @param {number} factor - 보간 비율입니다.
     * @returns {number} 보간된 각도입니다.
     */
    #lerpAngle(currentAngle, targetAngle, factor) {
        if (!Number.isFinite(currentAngle)) {
            return targetAngle;
        }

        const safeFactor = Math.max(0, Math.min(1, factor));
        if (safeFactor >= 1) {
            return targetAngle;
        }

        const delta = Math.atan2(
            Math.sin(targetAngle - currentAngle),
            Math.cos(targetAngle - currentAngle)
        );
        return currentAngle + (delta * safeFactor);
    }

    /**
     * @private
     * @param {number} angleA - 첫 번째 각도입니다.
     * @param {number} angleB - 두 번째 각도입니다.
     * @returns {number} -PI~PI 범위의 각도 차이입니다.
     */
    #getAngularDelta(angleA, angleB) {
        return Math.atan2(
            Math.sin(angleB - angleA),
            Math.cos(angleB - angleA)
        );
    }

    /**
     * @private
     * 현재 프레임의 dent 후보를 안정적으로 선택해 가시 dent 목록을 구성합니다.
     */
    #syncVisibleDents() {
        const maxDentCount = this.#getDentMaxCount();
        if (maxDentCount <= 0 || this.dentCandidates.length === 0) {
            this.activeDentKeys.length = 0;
            this.dents.length = 0;
            return;
        }
        const sortDentCandidates = (candidates) => candidates.sort(
            (left, right) => this.#compareDentPriority(left, right)
        );

        const retainedCandidates = [];
        const candidateMap = new Map();
        for (let index = 0; index < this.dentCandidates.length; index++) {
            const candidate = this.dentCandidates[index];
            candidateMap.set(candidate.key, candidate);
        }

        for (let index = 0; index < this.activeDentKeys.length; index++) {
            const key = this.activeDentKeys[index];
            const candidate = candidateMap.get(key);
            if (!candidate) {
                continue;
            }
            retainedCandidates.push(candidate);
            candidateMap.delete(key);
        }

        sortDentCandidates(retainedCandidates);
        while (retainedCandidates.length > maxDentCount) {
            retainedCandidates.pop();
        }

        const remainingCandidates = Array.from(candidateMap.values()).sort(
            (left, right) => this.#compareDentPriority(left, right)
        );
        while (retainedCandidates.length < maxDentCount && remainingCandidates.length > 0) {
            retainedCandidates.push(remainingCandidates.shift());
            sortDentCandidates(retainedCandidates);
        }

        while (retainedCandidates.length > 0 && remainingCandidates.length > 0) {
            const weakestRetained = retainedCandidates[retainedCandidates.length - 1];
            const strongestIncoming = remainingCandidates[0];
            if (!this.#shouldPromoteDentCandidate(strongestIncoming, weakestRetained)) {
                break;
            }

            retainedCandidates[retainedCandidates.length - 1] = strongestIncoming;
            remainingCandidates.shift();
            sortDentCandidates(retainedCandidates);
        }

        this.activeDentKeys = retainedCandidates.map((candidate) => candidate.key);
        this.dents.length = 0;
        for (let index = 0; index < retainedCandidates.length; index++) {
            const candidate = retainedCandidates[index];
            this.dents.push({
                angle: candidate.angle,
                depth: candidate.depth,
                width: candidate.width,
                strength: candidate.strength
            });
        }
    }

    /**
     * @private
     * @param {{strength:number, depth:number}} left - 왼쪽 후보입니다.
     * @param {{strength:number, depth:number}} right - 오른쪽 후보입니다.
     * @returns {number} 정렬 비교 결과입니다.
     */
    #compareDentPriority(left, right) {
        const strengthGap = right.strength - left.strength;
        if (Math.abs(strengthGap) > 0.0001) {
            return strengthGap;
        }

        return right.depth - left.depth;
    }

    /**
     * @private
     * @param {{strength:number, depth:number}} incomingCandidate - 새 후보입니다.
     * @param {{strength:number, depth:number}|undefined} retainedCandidate - 유지 중인 후보입니다.
     * @returns {boolean} 교체 여부입니다.
     */
    #shouldPromoteDentCandidate(incomingCandidate, retainedCandidate) {
        if (!retainedCandidate) {
            return true;
        }

        const switchBias = this.#getDentSwitchBias();
        const depthBias = this.#getDentDepthSwitchBias();
        if (incomingCandidate.strength > (retainedCandidate.strength + switchBias)) {
            return true;
        }

        return incomingCandidate.strength > (retainedCandidate.strength - (switchBias * 0.5))
            && incomingCandidate.depth > (retainedCandidate.depth + depthBias);
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
     * @returns {number} 눌림 압력이 줄어들 때의 추종 속도입니다.
     */
    #getPressureReleaseFollowRate() {
        return Number.isFinite(TITLE_SHIELD.PRESSURE_RELEASE_FOLLOW_RATE)
            ? Math.max(0.0001, TITLE_SHIELD.PRESSURE_RELEASE_FOLLOW_RATE)
            : 5.5;
    }

    /**
     * @private
     * @param {number} delta - 원본 프레임 경과 시간입니다.
     * @returns {number} 시각 보간에 사용할 안전한 경과 시간입니다.
     */
    #getVisualDelta(delta) {
        if (!Number.isFinite(delta) || delta <= 0) {
            return 0;
        }

        return Math.min(delta, this.#getVisualDeltaClampSeconds());
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
     * @returns {number} impact 각도 추종 속도입니다.
     */
    #getImpactAngleFollowRate() {
        return Number.isFinite(TITLE_SHIELD.IMPACT_ANGLE_FOLLOW_RATE)
            ? Math.max(0.0001, TITLE_SHIELD.IMPACT_ANGLE_FOLLOW_RATE)
            : 18;
    }

    /**
     * @private
     * @returns {number} impact 강도 추종 속도입니다.
     */
    #getImpactIntensityFollowRate() {
        return Number.isFinite(TITLE_SHIELD.IMPACT_INTENSITY_FOLLOW_RATE)
            ? Math.max(0.0001, TITLE_SHIELD.IMPACT_INTENSITY_FOLLOW_RATE)
            : 24;
    }

    /**
     * @private
     * @returns {number} impact 폭 추종 속도입니다.
     */
    #getImpactWidthFollowRate() {
        return Number.isFinite(TITLE_SHIELD.IMPACT_WIDTH_FOLLOW_RATE)
            ? Math.max(0.0001, TITLE_SHIELD.IMPACT_WIDTH_FOLLOW_RATE)
            : 20;
    }

    /**
     * @private
     * @returns {number} 실드 레이아웃 표시 추종 속도입니다.
     */
    #getLayoutFollowRate() {
        return Number.isFinite(TITLE_SHIELD.LAYOUT_FOLLOW_RATE)
            ? Math.max(0.0001, TITLE_SHIELD.LAYOUT_FOLLOW_RATE)
            : 18;
    }

    /**
     * @private
     * @returns {number} dent 각도 표시 추종 속도입니다.
     */
    #getDentAngleFollowRate() {
        return Number.isFinite(TITLE_SHIELD.DENT_ANGLE_FOLLOW_RATE)
            ? Math.max(0.0001, TITLE_SHIELD.DENT_ANGLE_FOLLOW_RATE)
            : 14;
    }

    /**
     * @private
     * @returns {number} 접촉 상태 유지용 히스테리시스 거리입니다.
     */
    #getContactHysteresisPx() {
        return Number.isFinite(TITLE_SHIELD.CONTACT_HYSTERESIS_PX)
            ? Math.max(0, TITLE_SHIELD.CONTACT_HYSTERESIS_PX)
            : 8;
    }

    /**
     * @private
     * @returns {number} 실드 경계선 일치 구간을 안정화할 epsilon 거리입니다.
     */
    #getBoundaryEpsilonPx() {
        return Number.isFinite(TITLE_SHIELD.BOUNDARY_EPSILON_PX)
            ? Math.max(0, TITLE_SHIELD.BOUNDARY_EPSILON_PX)
            : 4;
    }

    /**
     * @private
     * @returns {number} dent 후보 교체를 위한 최소 우위 값입니다.
     */
    #getDentSwitchBias() {
        return Number.isFinite(TITLE_SHIELD.DENT_SWITCH_BIAS)
            ? Math.max(0, TITLE_SHIELD.DENT_SWITCH_BIAS)
            : 0.08;
    }

    /**
     * @private
     * @returns {number} dent 깊이 기준 후보 교체를 위한 최소 우위 값입니다.
     */
    #getDentDepthSwitchBias() {
        return Number.isFinite(TITLE_SHIELD.DENT_DEPTH_SWITCH_BIAS)
            ? Math.max(0, TITLE_SHIELD.DENT_DEPTH_SWITCH_BIAS)
            : Math.max(1.2, this.#getMaxDepthPx() * 0.12);
    }

    /**
     * @private
     * @returns {number} 시각 보간에 허용할 최대 프레임 델타입니다.
     */
    #getVisualDeltaClampSeconds() {
        return Number.isFinite(TITLE_SHIELD.VISUAL_DELTA_CLAMP_SECONDS)
            ? Math.max(0.0001, TITLE_SHIELD.VISUAL_DELTA_CLAMP_SECONDS)
            : (1 / 30);
    }

    /**
     * @private
     * @returns {number} 최대 impact 개수입니다.
     */
    #getImpactMaxCount() {
        return Number.isFinite(TITLE_SHIELD.IMPACT_MAX_COUNT) ? Math.max(1, TITLE_SHIELD.IMPACT_MAX_COUNT) : 12;
    }

    /**
     * @private
     * @returns {number} impact 병합에 사용할 최대 각도 차이입니다.
     */
    #getImpactMergeAngleThreshold() {
        return Number.isFinite(TITLE_SHIELD.IMPACT_MERGE_ANGLE_RAD)
            ? Math.max(0.0001, TITLE_SHIELD.IMPACT_MERGE_ANGLE_RAD)
            : 0.22;
    }

    /**
     * @private
     * @returns {number} impact 교체를 허용할 최소 강도 우위입니다.
     */
    #getImpactReplacementBias() {
        return Number.isFinite(TITLE_SHIELD.IMPACT_REPLACEMENT_BIAS)
            ? Math.max(0, TITLE_SHIELD.IMPACT_REPLACEMENT_BIAS)
            : 0.12;
    }

    /**
     * @private
     * @returns {number} impact 병합 직후 즉시 반영할 최소 부스트 비율입니다.
     */
    #getImpactImmediateBoostRatio() {
        return Number.isFinite(TITLE_SHIELD.IMPACT_IMMEDIATE_BOOST_RATIO)
            ? Math.max(0, Math.min(1, TITLE_SHIELD.IMPACT_IMMEDIATE_BOOST_RATIO))
            : 0.55;
    }

    /**
     * @private
     * @returns {number} 최대 dent 개수입니다.
     */
    #getDentMaxCount() {
        return Number.isFinite(TITLE_SHIELD.DENT_MAX_COUNT) ? Math.max(1, TITLE_SHIELD.DENT_MAX_COUNT) : 8;
    }
}
