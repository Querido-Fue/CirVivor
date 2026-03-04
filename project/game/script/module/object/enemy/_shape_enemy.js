import { renderGL } from 'display/display_system.js';
import { getDelta } from 'game/time_handler.js';
import { BaseEnemy } from './_base_enemy.js';
import { getData } from 'data/data_handler.js';

const ENEMY_ASPECT_RATIO = getData('ENEMY_ASPECT_RATIO');
const ENEMY_HEIGHT_SCALE = getData('ENEMY_HEIGHT_SCALE');
const getEnemyShapeKey = getData('getEnemyShapeKey');
const ENEMY_CONSTANTS = getData('ENEMY_CONSTANTS');

/**
 * @class ShapeEnemy
 * @description WebGL 도형 아틀라스를 사용하는 적 공통 구현입니다.
 */
export class ShapeEnemy extends BaseEnemy {
    /**
     * @param {string} shapeType
     */
    constructor(shapeType) {
        super();
        this.shapeType = shapeType;
        this.aspectRatio = ENEMY_ASPECT_RATIO[shapeType] ?? 1;
        this.heightScale = ENEMY_HEIGHT_SCALE[shapeType] ?? 1;
        this.fill = ENEMY_CONSTANTS.DEFAULT_STYLE.FILL;
        this.alpha = ENEMY_CONSTANTS.DEFAULT_STYLE.ALPHA;
        this.rotation = ENEMY_CONSTANTS.DEFAULT_STYLE.ROTATION;
    }

    /**
         * 풀에서 가져올 때 초기화합니다. 색상/투명도 등을 갱신합니다.
         * @param {object} [data={}] 
         * @returns {ShapeEnemy}
         */
    init(data = {}) {
        super.init(data);
        this.type = data.type ?? this.shapeType;
        this.fill = data.fill ?? this.fill ?? ENEMY_CONSTANTS.DEFAULT_STYLE.FILL;
        this.alpha = data.alpha ?? ENEMY_CONSTANTS.DEFAULT_STYLE.ALPHA;
        this.rotation = data.rotation ?? ENEMY_CONSTANTS.DEFAULT_STYLE.ROTATION;
        return this;
    }

    /**
         * 풀에 반환되거나 재생성 시 초기 상태 템플릿으로 엎어씁니다.
         */
    reset() {
        super.reset();
        this.fill = ENEMY_CONSTANTS.DEFAULT_STYLE.FILL;
        this.alpha = ENEMY_CONSTANTS.DEFAULT_STYLE.ALPHA;
        this.rotation = ENEMY_CONSTANTS.DEFAULT_STYLE.ROTATION;
    }

    /**
         * AI의 결과에 따라 가속 및 물리 기본 이동을 처리합니다.
         * @param {number} [delta] 델타타임 (밀리초 등)
         * @param {object} [aiContext=null] 환경 데이터
         */
    update(delta = getDelta(), aiContext = null) {
        if (!this.active) return;

        const aiResult = this.runAI(delta, aiContext);
        const skipAcceleration = aiResult?.skipAcceleration === true;
        const skipDefaultMovement = aiResult?.skipDefaultMovement === true || aiResult?.skipDefaultMotion === true;

        if (!skipAcceleration) {
            this.speed.x += this.acc.x * this.accSpeed * delta;
            this.speed.y += this.acc.y * this.accSpeed * delta;
        }

        if (!skipDefaultMovement) {
            this.position.x += this.speed.x * this.moveSpeed * delta;
            this.position.y += this.speed.y * this.moveSpeed * delta;
        }
    }

    /**
         * 디스플레이 시스템의 WebGL 오브젝트 레이어를 통해 스프라이트를 렌더링합니다.
         */
    draw() {
        if (!this.active) return;

        const baseH = this.getRenderHeightPx();
        const h = baseH * this.heightScale;
        const w = baseH * this.aspectRatio;
        renderGL('object', {
            shape: getEnemyShapeKey(this.shapeType),
            x: this.position.x,
            y: this.position.y,
            w,
            h,
            fill: this.fill,
            alpha: this.alpha,
            rotation: this.rotation
        });
    }
}
