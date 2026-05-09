import { renderGL } from 'display/display_system.js';
import { getDelta } from 'game/time_handler.js';
import { clamp01 } from 'util/number_util.js';
import { TitleShieldConfig } from './_title_shield_config.js';
import { buildTitleShieldRenderCommand } from './_title_shield_render_command.js';
import {
    calculateShieldPressure,
    getEnemyScreenRadius,
    getShieldAngularDelta,
    isShieldReactiveEnemy,
    lerpShieldAngle,
    stabilizeShieldBoundaryDistance
} from './_title_shield_geometry.js';

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
        this.config = new TitleShieldConfig();
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
        this.targetRadius = this.targetCoreRadius * this.config.getShellRadiusMultiplier();

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
        const visualDelta = this.config.getVisualDelta(delta);

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
            if (!isShieldReactiveEnemy(enemy)) {
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

        renderGL('effect', buildTitleShieldRenderCommand({
            centerX: this.centerX,
            centerY: this.centerY,
            radius: this.radius,
            time: this.time,
            impacts: this.impacts,
            dents: this.dents,
            config: this.config
        }));
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
                const angleFollowFactor = 1 - Math.exp(-visualDelta * this.config.getImpactAngleFollowRate());
                const intensityFollowFactor = 1 - Math.exp(-visualDelta * this.config.getImpactIntensityFollowRate());
                const widthFollowFactor = 1 - Math.exp(-visualDelta * this.config.getImpactWidthFollowRate());
                impact.angle = lerpShieldAngle(impact.angle, impact.targetAngle, angleFollowFactor);
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

        const followRate = this.config.getLayoutFollowRate();
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
        const radius = getEnemyScreenRadius(enemy);
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
        const impactBand = this.config.getImpactBandPx();
        const contactPadding = this.config.getContactPaddingPx();
        const shieldBoundaryDistance = stabilizeShieldBoundaryDistance(
            distance - this.radius - radius,
            this.config.getBoundaryEpsilonPx()
        );
        const state = this.#getEnemyState(enemy);
        const contactRange = impactBand + contactPadding + (
            state.contacting
                ? this.config.getContactHysteresisPx()
                : 0
        );
        const contacting = Math.abs(shieldBoundaryDistance) <= contactRange;

        const influenceRange = this.config.getPressureInfluencePx();
        const targetPressure = calculateShieldPressure(
            shieldBoundaryDistance,
            influenceRange,
            radius
        );
        const visualInfluenceRange = influenceRange * this.config.getVisualTriggerDistanceMultiplier();
        const targetVisualPressure = calculateShieldPressure(
            shieldBoundaryDistance,
            visualInfluenceRange,
            radius
        );
        state.pressure = this.#followScalar(state.pressure, targetPressure, visualDelta);
        state.visualPressure = this.#followScalar(state.visualPressure, targetVisualPressure, visualDelta);
        state.displayAngle = lerpShieldAngle(
            state.displayAngle,
            angle,
            state.angleInitialized
                ? (1 - Math.exp(-visualDelta * this.config.getDentAngleFollowRate()))
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
            depth: this.config.getMaxDepthPx() * state.pressure * state.pressure,
            width: this.#buildAngularWidth(radius),
            strength: state.visualPressure
        });
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
            ? this.config.getPressureFollowRate()
            : this.config.getPressureReleaseFollowRate();
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
        const speedReference = this.config.getImpactSpeedReferencePx();
        const speedFactor = clamp01(impactSpeed / speedReference);
        const intensity = Math.max(
            this.config.getImpactIntensityMin(),
            Math.min(
                this.config.getImpactIntensityMax(),
                this.config.getImpactIntensityMin() + (speedFactor * 0.4) + (pressure * 0.45)
            )
        );
        const width = this.#buildAngularWidth(enemyRadius) * 0.9;
        const duration = this.config.getImpactDuration();
        const mergeableImpact = this.#findMergeableImpact(angle);
        if (mergeableImpact) {
            this.#retargetImpact(mergeableImpact, angle, intensity, width, duration);
            return;
        }

        if (this.impacts.length < this.config.getImpactMaxCount()) {
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
        impact.intensity = Math.max(impact.intensity, intensity * this.config.getImpactImmediateBoostRatio());
        impact.width = Math.max(impact.width, width * this.config.getImpactImmediateBoostRatio());
        impact.age = 0;
        impact.duration = Math.max(impact.duration, duration);
    }

    /**
     * @private
     * @param {number} angle - 새 impact의 각도입니다.
     * @returns {{angle:number, targetAngle:number, intensity:number, targetIntensity:number, width:number, targetWidth:number, age:number, duration:number}|null} 병합 가능한 impact입니다.
     */
    #findMergeableImpact(angle) {
        const mergeThreshold = this.config.getImpactMergeAngleThreshold();
        let bestImpact = null;
        let bestAngularDistance = Infinity;

        for (let index = 0; index < this.impacts.length; index++) {
            const impact = this.impacts[index];
            if (!impact || impact.age >= impact.duration) {
                continue;
            }

            const angularDistance = Math.abs(getShieldAngularDelta(impact.targetAngle, angle));
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
        return newIntensity > (currentScore + this.config.getImpactReplacementBias());
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
     * 현재 프레임의 dent 후보를 안정적으로 선택해 가시 dent 목록을 구성합니다.
     */
    #syncVisibleDents() {
        const maxDentCount = this.config.getDentMaxCount();
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

        const switchBias = this.config.getDentSwitchBias();
        const depthBias = this.config.getDentDepthSwitchBias();
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
        return this.config.buildAngularWidth(enemyRadius, this.radius);
    }

}
