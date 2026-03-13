import { getObjectOffsetY, renderGL } from 'display/display_system.js';
import { BaseEnemy } from './_base_enemy.js';
import { getData } from 'data/data_handler.js';

const ENEMY_ASPECT_RATIO = getData('ENEMY_ASPECT_RATIO');
const ENEMY_HEIGHT_SCALE = getData('ENEMY_HEIGHT_SCALE');
const getEnemyShapeKey = getData('getEnemyShapeKey');
const ENEMY_CONSTANTS = getData('ENEMY_CONSTANTS');
const HEADING_TRACK_TYPES = new Set(['triangle', 'arrow', 'rhom']);
const HEADING_TURN_MAX_DEG_PER_SEC = 90;
const HEADING_TURN_DAMP_START_DEG = 45;
const HEADING_TURN_SNAP_EPSILON_DEG = 0.15;
const HEADING_FORWARD_OFFSET_DEG = 90;
const HEADING_MIN_SPEED_SQ = 36; // 6px/s 미만은 정지로 간주

/**
 * @class ShapeEnemy
 * @description WebGL 도형 아틀라스를 사용하는 적 공통 구현입니다.
 */
export class ShapeEnemy extends BaseEnemy {
    #rotationCacheDeg;
    #rotationCos;
    #rotationSin;
    #renderOptions;

    /**
     * @param {string} shapeType
     */
    constructor(shapeType) {
        super();
        this.shapeType = shapeType;
        this.aspectRatio = ENEMY_ASPECT_RATIO[shapeType] ?? 1;
        this.heightScale = ENEMY_HEIGHT_SCALE[shapeType] ?? 1;
        this.shapeKey = getEnemyShapeKey(shapeType);
        this.fill = ENEMY_CONSTANTS.DEFAULT_STYLE.FILL;
        this.alpha = ENEMY_CONSTANTS.DEFAULT_STYLE.ALPHA;
        this.rotation = ENEMY_CONSTANTS.DEFAULT_STYLE.ROTATION;
        this.#rotationCacheDeg = Number.NaN;
        this.#rotationCos = 1;
        this.#rotationSin = 0;
        this.#renderOptions = {
            shape: this.shapeKey,
            x: 0,
            y: 0,
            w: 0,
            h: 0,
            fill: this.fill,
            alpha: this.alpha,
            rotation: this.rotation,
            rotationCos: this.#rotationCos,
            rotationSin: this.#rotationSin
        };
        this.#syncRotationCache(true);
    }

    /**
         * 풀에서 가져올 때 초기화합니다. 색상/투명도 등을 갱신합니다.
         * @param {object} [data={}] 
         * @returns {ShapeEnemy}
         */
    init(data = {}) {
        super.init(data);
        this.type = data.type ?? this.shapeType;
        this.shapeKey = getEnemyShapeKey(this.type);
        this.fill = data.fill ?? this.fill ?? ENEMY_CONSTANTS.DEFAULT_STYLE.FILL;
        this.alpha = data.alpha ?? ENEMY_CONSTANTS.DEFAULT_STYLE.ALPHA;
        this.rotation = data.rotation ?? ENEMY_CONSTANTS.DEFAULT_STYLE.ROTATION;
        this.#renderOptions.shape = this.shapeKey;
        this.#renderOptions.fill = this.fill;
        this.#renderOptions.alpha = this.alpha;
        this.#syncRotationCache(true);
        return this;
    }

    /**
         * 풀에 반환되거나 재생성 시 초기 상태 템플릿으로 엎어씁니다.
         */
    reset() {
        super.reset();
        const shapeType = this.shapeType ?? this.type ?? 'square';
        this.shapeKey = getEnemyShapeKey(shapeType);
        this.fill = ENEMY_CONSTANTS.DEFAULT_STYLE.FILL;
        this.alpha = ENEMY_CONSTANTS.DEFAULT_STYLE.ALPHA;
        this.rotation = ENEMY_CONSTANTS.DEFAULT_STYLE.ROTATION;
        if (!(#renderOptions in this) || !this.#renderOptions) return;
        this.#renderOptions.shape = this.shapeKey;
        this.#renderOptions.fill = this.fill;
        this.#renderOptions.alpha = this.alpha;
        this.#syncRotationCache(true);
    }

    /**
         * 회전값이 바뀐 경우에만 삼각함수 캐시를 갱신합니다.
         * @param {boolean} [force=false] 강제 갱신 여부
         * @private
         */
    #syncRotationCache(force = false) {
        if (!this.#renderOptions) return;

        const rotation = Number.isFinite(this.rotation) ? this.rotation : 0;
        if (!force && this.#rotationCacheDeg === rotation) return;

        this.#rotationCacheDeg = rotation;
        this.#renderOptions.rotation = rotation;

        if (rotation === 0) {
            this.#rotationCos = 1;
            this.#rotationSin = 0;
        } else {
            const rad = rotation * (Math.PI / 180);
            this.#rotationCos = Math.cos(rad);
            this.#rotationSin = Math.sin(rad);
        }

        this.#renderOptions.rotationCos = this.#rotationCos;
        this.#renderOptions.rotationSin = this.#rotationSin;
    }

    /**
     * @private
     * @param {number} angle
     * @returns {number}
     */
    #normalizeAngle(angle) {
        if (!Number.isFinite(angle)) return 0;
        let out = angle % 360;
        if (out > 180) out -= 360;
        if (out < -180) out += 360;
        return out;
    }

    /**
     * @private
     * @param {number} fromDeg
     * @param {number} toDeg
     * @returns {number}
     */
    #shortestAngleDelta(fromDeg, toDeg) {
        return this.#normalizeAngle(toDeg - fromDeg);
    }

    /**
     * 도형 대칭성을 고려해 가장 짧은 회전 델타를 구합니다.
     * triangle: 120도 대칭, rhom: 180도 대칭
     * @private
     * @param {number} currentDeg
     * @param {number} targetDeg
     * @returns {number}
     */
    #headingDeltaWithSymmetry(currentDeg, targetDeg) {
        const type = this.type ?? this.shapeType;
        let symmetryStep = 360;
        if (type === 'triangle') symmetryStep = 120;
        if (type === 'rhom') symmetryStep = 180;

        if (symmetryStep >= 360) {
            return this.#shortestAngleDelta(currentDeg, targetDeg);
        }

        const turns = Math.floor(360 / symmetryStep);
        let bestDelta = this.#shortestAngleDelta(currentDeg, targetDeg);
        for (let i = 1; i < turns; i++) {
            const candidate = targetDeg + (symmetryStep * i);
            const candidateDelta = this.#shortestAngleDelta(currentDeg, candidate);
            if (Math.abs(candidateDelta) < Math.abs(bestDelta)) {
                bestDelta = candidateDelta;
            }
        }
        return bestDelta;
    }

    /**
     * 삼각형/화살표/마름모 계열의 머리를 이동 방향으로 서서히 회전시킵니다.
     * @private
     * @param {number} delta
     */
    #updateHeadingRotation(delta) {
        const type = this.type ?? this.shapeType;
        if (!HEADING_TRACK_TYPES.has(type)) return;

        const velX = this.speed.x * this.moveSpeed;
        const velY = this.speed.y * this.moveSpeed;
        const speedSq = (velX * velX) + (velY * velY);
        if (speedSq < HEADING_MIN_SPEED_SQ) return;

        const targetDeg = (Math.atan2(velY, velX) * (180 / Math.PI)) + HEADING_FORWARD_OFFSET_DEG;
        const currentDeg = Number.isFinite(this.rotation) ? this.rotation : 0;
        const deltaDeg = this.#headingDeltaWithSymmetry(currentDeg, targetDeg);
        const absDelta = Math.abs(deltaDeg);
        if (absDelta <= HEADING_TURN_SNAP_EPSILON_DEG) {
            this.rotation = targetDeg;
            return;
        }

        // 목표 각도에 가까워질수록 회전 속도를 감쇠합니다.
        const dampRatio = Math.max(0, Math.min(1, absDelta / HEADING_TURN_DAMP_START_DEG));
        const speedScale = dampRatio * dampRatio * (3 - (2 * dampRatio)); // smoothstep(0~1)
        const turnSpeed = HEADING_TURN_MAX_DEG_PER_SEC * speedScale;
        const maxStep = turnSpeed * delta;
        const step = Math.min(absDelta, maxStep);
        this.rotation = currentDeg + (Math.sign(deltaDeg) * step);
    }

    /**
         * AI의 결과에 따라 가속 및 물리 기본 이동을 처리합니다.
         * @param {number} [delta] 델타타임 (밀리초 등)
         * @param {object} [aiContext=null] 환경 데이터
         */
    fixedUpdate(delta, aiContext = null) {
        if (!this.active) return;

        this.runAIFixed(delta, aiContext);
        this.recoverAxisResistance(delta);

        this.speed.x += this.acc.x * this.accSpeed * delta;
        this.speed.y += this.acc.y * this.accSpeed * delta;

        this.position.x += this.speed.x * this.axisResistanceX * this.moveSpeed * delta;
        this.position.y += this.speed.y * this.axisResistanceY * this.moveSpeed * delta;

        this.updateAngularMotion(delta);
        this.#updateHeadingRotation(delta);
    }

    /**
         * 디스플레이 시스템의 WebGL 레이어를 통해 스프라이트를 렌더링합니다.
         * @param {{layer?: string, fill?: string, alpha?: number, sizeScale?: number, offsetX?: number, offsetY?: number}} [overrideOptions={}] - 임시 렌더 오버라이드 값입니다.
         */
    draw(overrideOptions = {}) {
        if (!this.active) return;
        this.#syncRotationCache();

        const sizeScale = Number.isFinite(overrideOptions.sizeScale) ? overrideOptions.sizeScale : 1;
        const offsetX = Number.isFinite(overrideOptions.offsetX) ? overrideOptions.offsetX : 0;
        const offsetY = Number.isFinite(overrideOptions.offsetY) ? overrideOptions.offsetY : 0;
        const baseH = this.getRenderHeightPx() * sizeScale;
        const h = baseH * this.heightScale;
        const w = baseH * this.aspectRatio;
        const options = this.#renderOptions;
        options.x = this.renderPosition.x + offsetX;
        options.y = (this.renderPosition.y - getObjectOffsetY()) + offsetY;
        options.w = w;
        options.h = h;
        options.fill = overrideOptions.fill ?? this.fill;
        options.alpha = overrideOptions.alpha ?? this.alpha;
        renderGL(overrideOptions.layer || 'object', options);
    }
}
