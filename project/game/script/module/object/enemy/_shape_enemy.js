import { getObjectOffsetY, renderGL } from 'display/display_system.js';
import { BaseEnemy } from './_base_enemy.js';
import {
    ENEMY_ASPECT_RATIO,
    ENEMY_HEIGHT_SCALE
} from 'data/object/enemy/enemy_catalog_data.js';
import { TITLE_AI_CONSTANTS } from 'scene/title/_title_runtime_constants.js';
import { colorUtil } from 'util/color_util.js';
import { normalizeDegrees } from 'util/math_util.js';
import { clamp01 } from 'util/number_util.js';
import { drawEnemyCollisionDebugCircles } from './_enemy_collision_debug.js';
import { getEnemyShapeKey } from './_enemy_shape_assets.js';

const DEFAULT_ENEMY_FILL = '#ff6c6c';
const DEFAULT_ENEMY_ALPHA = 1;
const DEFAULT_ENEMY_ROTATION = 0;
const HEADING_TRACK_TYPES = new Set(['triangle', 'arrow', 'rhom']);
const HEADING_TURN_MAX_DEG_PER_SEC = 90;
const HEADING_TURN_DAMP_START_DEG = 45;
const HEADING_TURN_SNAP_EPSILON_DEG = 0.15;
const HEADING_FORWARD_OFFSET_DEG = 90;
const HEADING_MIN_SPEED_SQ = 36;
const HEADING_SYMMETRY_STEP_BY_TYPE = Object.freeze({
    triangle: 120,
    rhom: 180
});
const FULL_TURN_DEG = 360;
const DEGREES_TO_RADIANS = Math.PI / 180;
const RADIANS_TO_DEGREES = 180 / Math.PI;
const TITLE_AI_ID = TITLE_AI_CONSTANTS.ID;
const EMPTY_DRAW_OPTIONS = Object.freeze({});

/**
 * 타이틀 씬 적인지 판별합니다.
 * @param {object} enemy
 * @returns {boolean}
 */
function isTitleSceneEnemy(enemy) {
    return typeof enemy?.ai?.id === 'string' && enemy.ai.id === TITLE_AI_ID;
}

/**
 * 비타이틀 적 색상을 완전 불투명 문자열로 정규화합니다.
 * @param {string} fill
 * @returns {string}
 */
function normalizeOpaqueEnemyFill(fill) {
    if (typeof fill !== 'string' || fill.length === 0) {
        return DEFAULT_ENEMY_FILL;
    }

    const parsed = colorUtil().cssToRgb(fill);
    return colorUtil().rgbToString(parsed.r, parsed.g, parsed.b, 1);
}
/**
 * @class ShapeEnemy
 * @description WebGL 도형 아틀라스를 사용하는 적 공통 구현입니다.
 */
export class ShapeEnemy extends BaseEnemy {
    #rotationCacheDeg;
    #rotationCos;
    #rotationSin;
    #renderOptions;
    #collisionDebugOptions;

    /**
     * @param {string} shapeType
     */
    constructor(shapeType) {
        super();
        this.shapeType = shapeType;
        this.aspectRatio = ENEMY_ASPECT_RATIO[shapeType] ?? 1;
        this.heightScale = ENEMY_HEIGHT_SCALE[shapeType] ?? 1;
        this.shapeKey = getEnemyShapeKey(shapeType);
        this.fill = DEFAULT_ENEMY_FILL;
        this.alpha = DEFAULT_ENEMY_ALPHA;
        this.rotation = DEFAULT_ENEMY_ROTATION;
        this.snapRenderTransform();
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
        this.#collisionDebugOptions = {
            enemyType: this.type,
            width: 0,
            height: 0,
            rotationRadians: 0,
            renderX: 0,
            renderY: 0
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
        this.fill = isTitleSceneEnemy(this)
            ? (data.fill ?? this.fill ?? DEFAULT_ENEMY_FILL)
            : normalizeOpaqueEnemyFill(data.fill ?? this.fill ?? DEFAULT_ENEMY_FILL);
        this.alpha = isTitleSceneEnemy(this)
            ? (data.alpha ?? DEFAULT_ENEMY_ALPHA)
            : 1;
        this.rotation = data.rotation ?? DEFAULT_ENEMY_ROTATION;
        this.snapRenderTransform();
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
        this.fill = DEFAULT_ENEMY_FILL;
        this.alpha = DEFAULT_ENEMY_ALPHA;
        this.rotation = DEFAULT_ENEMY_ROTATION;
        this.snapRenderTransform();
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

        const rotation = Number.isFinite(this.renderRotation) ? this.renderRotation : 0;
        if (!force && this.#rotationCacheDeg === rotation) return;

        this.#rotationCacheDeg = rotation;
        this.#renderOptions.rotation = rotation;

        if (rotation === 0) {
            this.#rotationCos = 1;
            this.#rotationSin = 0;
        } else {
            const rad = rotation * DEGREES_TO_RADIANS;
            this.#rotationCos = Math.cos(rad);
            this.#rotationSin = Math.sin(rad);
        }

        this.#renderOptions.rotationCos = this.#rotationCos;
        this.#renderOptions.rotationSin = this.#rotationSin;
    }

    /**
     * @private
     * @param {number} fromDeg
     * @param {number} toDeg
     * @returns {number}
     */
    #shortestAngleDelta(fromDeg, toDeg) {
        return normalizeDegrees(toDeg - fromDeg);
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
        const symmetryStep = HEADING_SYMMETRY_STEP_BY_TYPE[type] ?? FULL_TURN_DEG;

        if (symmetryStep >= FULL_TURN_DEG) {
            return this.#shortestAngleDelta(currentDeg, targetDeg);
        }

        const turns = Math.floor(FULL_TURN_DEG / symmetryStep);
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

        const targetDeg = (Math.atan2(velY, velX) * RADIANS_TO_DEGREES) + HEADING_FORWARD_OFFSET_DEG;
        const currentDeg = Number.isFinite(this.rotation) ? this.rotation : 0;
        const deltaDeg = this.#headingDeltaWithSymmetry(currentDeg, targetDeg);
        const absDelta = Math.abs(deltaDeg);
        if (absDelta <= HEADING_TURN_SNAP_EPSILON_DEG) {
            this.rotation = currentDeg + deltaDeg;
            return;
        }

        // 목표 각도에 가까워질수록 회전 속도를 감쇠합니다.
        const dampRatio = clamp01(absDelta / HEADING_TURN_DAMP_START_DEG);
        const speedScale = dampRatio * dampRatio * (3 - (2 * dampRatio)); // smoothstep(0~1)
        const turnSpeed = HEADING_TURN_MAX_DEG_PER_SEC * speedScale;
        const maxStep = turnSpeed * delta;
        const step = Math.min(absDelta, maxStep);
        this.rotation = currentDeg + (Math.sign(deltaDeg) * step);
    }

    /**
     * 활성 적의 fixed-step을 `AI → 축 저항 복구 → 속도 → 위치 → 각운동 → heading` 순서로 갱신합니다.
     * 렌더 보간과 합체 표시 오프셋은 이 물리 갱신 경계에서 다루지 않습니다.
     * @param {number} delta - 초 단위 fixed delta입니다.
     * @param {object|null} [aiContext=null] AI가 참조할 고정 틱 환경 데이터입니다.
     * @returns {void}
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
     * 현재 보간 transform과 합체 표시 오프셋을 최종 렌더 상태로 기록합니다.
     * 레거시 WebGL draw와 다른 presentation backend가 같은 계산 경계를 공유하도록
     * 호출자가 제공한 컨테이너를 덮어쓰며 새 객체를 만들지 않습니다.
     * @param {object} out - 렌더 상태를 기록할 재사용 컨테이너입니다.
     * @param {{fill?: string, alpha?: number, sizeScale?: number, offsetX?: number, offsetY?: number}} [overrideOptions={}] - 임시 렌더 오버라이드입니다.
     * @returns {boolean} 활성 적의 상태를 기록했는지 여부입니다.
     */
    writePresentationState(out, overrideOptions = EMPTY_DRAW_OPTIONS) {
        if (!this.active || !out || typeof out !== 'object') return false;
        this.#syncRotationCache();

        const sizeScale = Number.isFinite(overrideOptions.sizeScale) ? overrideOptions.sizeScale : 1;
        const offsetX = Number.isFinite(overrideOptions.offsetX) ? overrideOptions.offsetX : 0;
        const offsetY = Number.isFinite(overrideOptions.offsetY) ? overrideOptions.offsetY : 0;
        const mergeOffsetX = (Number.isFinite(this.mergePullOffset?.x) ? this.mergePullOffset.x : 0)
            + (Number.isFinite(this.mergeSettleOffset?.x) ? this.mergeSettleOffset.x : 0);
        const mergeOffsetY = (Number.isFinite(this.mergePullOffset?.y) ? this.mergePullOffset.y : 0)
            + (Number.isFinite(this.mergeSettleOffset?.y) ? this.mergeSettleOffset.y : 0);
        const baseH = this.getRenderHeightPx() * sizeScale;
        const h = baseH * this.heightScale;

        out.shape = this.shapeKey;
        out.x = this.renderPosition.x + offsetX + mergeOffsetX;
        out.y = (this.renderPosition.y - getObjectOffsetY()) + offsetY + mergeOffsetY;
        out.w = baseH * this.aspectRatio;
        out.h = h;
        out.fill = overrideOptions.fill ?? this.fill;
        out.alpha = overrideOptions.alpha ?? this.alpha;
        out.rotation = this.#rotationCacheDeg;
        out.rotationCos = this.#rotationCos;
        out.rotationSin = this.#rotationSin;
        return true;
    }

    /**
         * 디스플레이 시스템의 WebGL 레이어를 통해 스프라이트를 렌더링합니다.
         * @param {{layer?: string, fill?: string, alpha?: number, sizeScale?: number, offsetX?: number, offsetY?: number}} [overrideOptions={}] - 임시 렌더 오버라이드 값입니다.
         */
    draw(overrideOptions = EMPTY_DRAW_OPTIONS) {
        const options = this.#renderOptions;
        if (!this.writePresentationState(options, overrideOptions)) return;
        renderGL(overrideOptions.layer || 'object', options);
        const debugOptions = this.#collisionDebugOptions;
        debugOptions.enemyType = this.type ?? this.shapeType;
        debugOptions.width = options.w;
        debugOptions.height = options.h;
        debugOptions.rotationRadians = (Number.isFinite(options.rotation) ? options.rotation : 0) * DEGREES_TO_RADIANS;
        debugOptions.renderX = options.x;
        debugOptions.renderY = options.y;
        drawEnemyCollisionDebugCircles(debugOptions);
    }
}
