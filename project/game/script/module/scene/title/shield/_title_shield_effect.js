import { renderGL } from 'display/display_system.js';
import { getDelta } from 'game/time_handler.js';
import { clamp01, easeOutExpo, lerpNumber } from 'util/number_util.js';
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
 * 실드 dent 후보를 강도, 깊이 내림차순으로 비교합니다.
 * @param {{strength:number, depth:number}} left - 왼쪽 후보입니다.
 * @param {{strength:number, depth:number}} right - 오른쪽 후보입니다.
 * @returns {number} 정렬 비교 결과입니다.
 */
function compareTitleShieldDentPriority(left, right) {
    const strengthGap = right.strength - left.strength;
    if (Math.abs(strengthGap) > 0.0001) {
        return strengthGap;
    }

    return right.depth - left.depth;
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
        this.dentCandidateMap = new Map();
        this.retainedDentCandidates = [];
        this.remainingDentCandidates = [];
        this.dentRenderStatePool = [];
        this.dentRenderStateMap = new Map();
        this.enemyStateMap = new WeakMap();
        this.visualLayoutInitialized = false;
        this.config = new TitleShieldConfig();
        this.presentationCommand = null;
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
     * 타이틀 적 AI의 로고 자력 거리 계산에 사용할 목표 실드 외곽 반경을 반환합니다.
     * 시각 보간 중인 `radius`가 아니라 최신 레이아웃에서 계산한 `targetRadius`입니다.
     * @returns {number} 목표 실드 외곽 반경입니다.
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
        this.dentCandidateMap.clear();
        this.retainedDentCandidates.length = 0;
        this.remainingDentCandidates.length = 0;

        if (!Array.isArray(enemies) || this.radius <= 0) {
            this.#syncVisibleDents(delta);
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
        this.#syncVisibleDents(delta);
    }

    /**
     * 현재 실드 상태를 effect 레이어에 렌더 명령으로 전달합니다.
     */
    draw() {
        const command = this.getPresentationCommand();
        if (!command) {
            return;
        }

        renderGL('effect', command);
    }

    /**
     * WebGL과 WebGPU title presentation이 공유할 현재 magnetic shield 명령을 반환합니다.
     * 명령, impact 배열, dent 배열과 각 항목 identity를 재사용하며 상태 authority는 이 effect에 남깁니다.
     * @returns {object|null} 반경이 유효하면 재사용된 presentation 명령, 아니면 null입니다.
     */
    getPresentationCommand() {
        if (this.radius <= 0) {
            return null;
        }

        this.presentationCommand = buildTitleShieldRenderCommand({
            centerX: this.centerX,
            centerY: this.centerY,
            radius: this.radius,
            time: this.time,
            impacts: this.impacts,
            dents: this.dents,
            config: this.config
        }, this.presentationCommand);
        return this.presentationCommand;
    }

    /**
     * 레이아웃과 impact·dent 추적 상태를 비우고 적별 WeakMap을 교체합니다.
     * 누적 `time`과 현재 `config` 참조는 유지합니다.
     * @returns {void}
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
        this.dentCandidateMap.clear();
        this.retainedDentCandidates.length = 0;
        this.remainingDentCandidates.length = 0;
        this.dentRenderStatePool.length = 0;
        this.dentRenderStateMap.clear();
        this.enemyStateMap = new WeakMap();
        this.visualLayoutInitialized = false;
        this.presentationCommand = null;
    }

    /**
     * 원본 델타로 impact 수명과 만료를 처리하고 보정된 시각 델타로 목표 각도·강도·폭을 추종합니다.
     * @private
     * @param {number} delta - impact 수명에 누적할 실제 프레임 델타입니다.
     * @param {number} visualDelta - 각도·강도·폭 추종에 사용할 보정된 시각 델타입니다.
     * @returns {void}
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
     * @param {number} delta - 레이아웃 추종에 사용할 설정 보정 시각 델타입니다.
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

        const dentCandidate = state.dentCandidate;
        dentCandidate.angle = state.displayAngle;
        dentCandidate.depth = this.config.getMaxDepthPx() * state.pressure * state.pressure;
        dentCandidate.width = this.#buildAngularWidth(radius);
        dentCandidate.strength = state.visualPressure;
        this.dentCandidates.push(dentCandidate);
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
     * @returns {{enemyId:number|null, contacting:boolean, pressure:number, visualPressure:number, displayAngle:number, angleInitialized:boolean, dentCandidate:object}} 적별 실드 상태입니다.
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
            angleInitialized: false,
            dentCandidate: null
        };
        state.dentCandidate = {
            key: state,
            angle: 0,
            depth: 0,
            width: 0,
            strength: 0
        };
        this.enemyStateMap.set(enemy, state);
        return state;
    }

    /**
     * @private
     * 현재 프레임의 dent 후보를 안정적으로 선택해 가시 dent 목록을 구성합니다.
     * @param {number} delta - dent 추적 전환 시간에 누적할 실제 프레임 델타입니다.
     * @returns {void}
     */
    #syncVisibleDents(delta) {
        const maxDentCount = this.config.getDentMaxCount();
        const retainedCandidates = this.retainedDentCandidates;
        const remainingCandidates = this.remainingDentCandidates;
        const candidateMap = this.dentCandidateMap;
        if (maxDentCount <= 0 || this.dentCandidates.length === 0) {
            this.activeDentKeys.length = 0;
            this.#syncDentRenderStates(retainedCandidates, delta);
            return;
        }

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

        retainedCandidates.sort(compareTitleShieldDentPriority);
        while (retainedCandidates.length > maxDentCount) {
            retainedCandidates.pop();
        }

        for (const candidate of candidateMap.values()) {
            remainingCandidates.push(candidate);
        }
        remainingCandidates.sort(compareTitleShieldDentPriority);
        while (retainedCandidates.length < maxDentCount && remainingCandidates.length > 0) {
            retainedCandidates.push(remainingCandidates.shift());
            retainedCandidates.sort(compareTitleShieldDentPriority);
        }

        while (retainedCandidates.length > 0 && remainingCandidates.length > 0) {
            const weakestRetained = retainedCandidates[retainedCandidates.length - 1];
            const strongestIncoming = remainingCandidates[0];
            if (!this.#shouldPromoteDentCandidate(strongestIncoming, weakestRetained)) {
                break;
            }

            retainedCandidates[retainedCandidates.length - 1] = strongestIncoming;
            remainingCandidates.shift();
            retainedCandidates.sort(compareTitleShieldDentPriority);
        }

        this.activeDentKeys.length = retainedCandidates.length;
        for (let index = 0; index < retainedCandidates.length; index++) {
            this.activeDentKeys[index] = retainedCandidates[index].key;
        }

        this.#syncDentRenderStates(retainedCandidates, delta);
    }

    /**
     * 선택된 dent 후보를 기존 렌더 슬롯에 연결하고 대상 전환·해제를 애니메이션합니다.
     * @private
     * @param {Array<object>} candidates - 현재 선택된 dent 후보입니다.
     * @param {number} delta - 전환 시간에 누적할 실제 프레임 델타입니다.
     * @returns {void}
     */
    #syncDentRenderStates(candidates, delta) {
        const renderStatePool = this.dentRenderStatePool;
        for (let index = 0; index < renderStatePool.length; index++) {
            renderStatePool[index].targetCandidate = null;
            renderStatePool[index].replacementReserved = false;
        }

        for (let index = 0; index < candidates.length; index++) {
            const candidate = candidates[index];
            const renderState = this.dentRenderStateMap.get(candidate.key);
            if (!renderState) {
                continue;
            }

            renderState.targetCandidate = candidate;
            if (renderState.releasing) {
                this.#beginDentRenderTransition(renderState, false);
            }
        }

        for (let index = 0; index < candidates.length; index++) {
            const candidate = candidates[index];
            if (this.dentRenderStateMap.has(candidate.key)) {
                continue;
            }

            const renderState = this.#acquireDentRenderState(
                candidate,
                this.config.getDentRenderMaxCount()
            );
            if (!renderState) {
                continue;
            }

            if (renderState.key === null) {
                renderState.angle = candidate.angle;
                renderState.depth = 0;
                renderState.width = candidate.width;
                renderState.strength = 0;
            } else {
                this.dentRenderStateMap.delete(renderState.key);
            }

            renderState.key = candidate.key;
            renderState.targetCandidate = candidate;
            this.dentRenderStateMap.set(candidate.key, renderState);
            this.#beginDentRenderTransition(renderState, false);
        }

        this.dents.length = 0;
        for (let index = 0; index < renderStatePool.length; index++) {
            const renderState = renderStatePool[index];
            if (!renderState.targetCandidate && renderState.key !== null && !renderState.releasing) {
                this.#beginDentRenderTransition(renderState, true);
            }

            this.#updateDentRenderTransition(renderState, delta);
            if (renderState.key !== null) {
                this.dents.push(renderState);
            }
        }
    }

    /**
     * 새 후보와 기존 슬롯의 각도 차이가 임계값 미만이면 해당 슬롯을 재사용합니다.
     * 임계값 이상이면 기존 슬롯은 해제용으로 남기고 별도 슬롯에서 신규 dent를 시작합니다.
     * @private
     * @param {object} candidate - 새 dent 후보입니다.
     * @param {number} maxRenderDentCount - 해제 중인 dent를 포함한 최대 렌더 슬롯 수입니다.
     * @returns {object|null} 재사용할 렌더 상태입니다.
     */
    #acquireDentRenderState(candidate, maxRenderDentCount) {
        let inactiveRenderState = null;
        let closestRenderState = null;
        let closestAngularDistance = Infinity;
        let weakestReleasingState = null;
        for (let index = 0; index < this.dentRenderStatePool.length; index++) {
            const renderState = this.dentRenderStatePool[index];
            if (renderState.key === null) {
                inactiveRenderState ??= renderState;
                continue;
            }
            if (renderState.targetCandidate || renderState.replacementReserved) {
                continue;
            }

            if (renderState.releasing
                && (!weakestReleasingState || renderState.strength < weakestReleasingState.strength)) {
                weakestReleasingState = renderState;
            }

            const angularDistance = Math.abs(getShieldAngularDelta(renderState.angle, candidate.angle));
            if (angularDistance >= closestAngularDistance) {
                continue;
            }

            closestAngularDistance = angularDistance;
            closestRenderState = renderState;
        }

        const crossfadeThreshold = this.config.getDentCrossfadeAngleThreshold();
        const thresholdTolerance = Number.EPSILON * Math.max(1, crossfadeThreshold) * 8;
        if (closestRenderState && (closestAngularDistance + thresholdTolerance) < crossfadeThreshold) {
            return closestRenderState;
        }

        if (closestRenderState) {
            closestRenderState.replacementReserved = true;
        }
        if (inactiveRenderState) {
            return inactiveRenderState;
        }
        if (this.dentRenderStatePool.length < maxRenderDentCount) {
            const renderState = this.#createDentRenderState();
            this.dentRenderStatePool.push(renderState);
            return renderState;
        }

        const fallbackRenderState = weakestReleasingState || closestRenderState;
        if (fallbackRenderState) {
            this.#deactivateDentRenderState(fallbackRenderState);
        }
        return fallbackRenderState;
    }

    /**
     * dent 렌더 슬롯의 초기 상태를 생성합니다.
     * @private
     * @returns {object} 생성된 렌더 상태입니다.
     */
    #createDentRenderState() {
        return {
            key: null,
            targetCandidate: null,
            angle: 0,
            depth: 0,
            width: 0,
            strength: 0,
            startAngle: 0,
            startDepth: 0,
            startWidth: 0,
            startStrength: 0,
            transitionAge: 0,
            transitioning: false,
            releasing: false,
            replacementReserved: false
        };
    }

    /**
     * 현재 표시값을 시작점으로 dent 렌더 슬롯의 easeOutExpo 전환을 시작합니다.
     * @private
     * @param {object} renderState - 갱신할 dent 렌더 상태입니다.
     * @param {boolean} releasing - 추적 해제 전환인지 여부입니다.
     * @returns {void}
     */
    #beginDentRenderTransition(renderState, releasing) {
        renderState.startAngle = renderState.angle;
        renderState.startDepth = renderState.depth;
        renderState.startWidth = renderState.width;
        renderState.startStrength = renderState.strength;
        renderState.transitionAge = 0;
        renderState.transitioning = true;
        renderState.releasing = releasing;
    }

    /**
     * dent 슬롯의 진행 중인 전환을 갱신하고 해제가 끝난 슬롯을 비활성화합니다.
     * @private
     * @param {object} renderState - 갱신할 dent 렌더 상태입니다.
     * @param {number} delta - 전환 시간에 누적할 실제 프레임 델타입니다.
     * @returns {void}
     */
    #updateDentRenderTransition(renderState, delta) {
        if (renderState.key === null) {
            return;
        }

        const candidate = renderState.targetCandidate;
        if (!renderState.transitioning) {
            if (candidate) {
                this.#copyDentCandidate(renderState, candidate);
            }
            return;
        }

        renderState.transitionAge += Math.max(0, delta);
        const duration = this.config.getDentTransitionDuration();
        const progress = clamp01(renderState.transitionAge / duration);
        const easedProgress = easeOutExpo(progress);
        if (renderState.releasing || !candidate) {
            renderState.depth = lerpNumber(renderState.startDepth, 0, easedProgress);
            renderState.strength = lerpNumber(renderState.startStrength, 0, easedProgress);
        } else {
            renderState.angle = lerpShieldAngle(renderState.startAngle, candidate.angle, easedProgress);
            renderState.depth = lerpNumber(renderState.startDepth, candidate.depth, easedProgress);
            renderState.width = lerpNumber(renderState.startWidth, candidate.width, easedProgress);
            renderState.strength = lerpNumber(renderState.startStrength, candidate.strength, easedProgress);
        }

        if (progress < 1) {
            return;
        }

        renderState.transitioning = false;
        if (!renderState.releasing && candidate) {
            this.#copyDentCandidate(renderState, candidate);
            return;
        }

        this.#deactivateDentRenderState(renderState);
    }

    /**
     * dent 렌더 슬롯의 키와 전환 상태를 정리해 재사용 가능한 상태로 만듭니다.
     * @private
     * @param {object} renderState - 비활성화할 dent 렌더 상태입니다.
     * @returns {void}
     */
    #deactivateDentRenderState(renderState) {
        this.dentRenderStateMap.delete(renderState.key);
        renderState.key = null;
        renderState.targetCandidate = null;
        renderState.depth = 0;
        renderState.strength = 0;
        renderState.transitionAge = 0;
        renderState.transitioning = false;
        renderState.releasing = false;
        renderState.replacementReserved = false;
    }

    /**
     * 선택 후보의 현재 값을 dent 렌더 슬롯에 복사합니다.
     * @private
     * @param {object} renderState - 갱신할 dent 렌더 상태입니다.
     * @param {object} candidate - 복사할 dent 후보입니다.
     * @returns {void}
     */
    #copyDentCandidate(renderState, candidate) {
        renderState.angle = candidate.angle;
        renderState.depth = candidate.depth;
        renderState.width = candidate.width;
        renderState.strength = candidate.strength;
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
