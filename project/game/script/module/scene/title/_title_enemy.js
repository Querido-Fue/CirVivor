import { getWW, getWH, getUIWW, renderGL } from 'display/display_system.js';
import { mathUtil } from 'util/math_util.js';
import { animate } from 'animation/animation_system.js';
import { getMouseInput, getMouseFocus } from 'input/input_system.js';
import { getDelta } from 'game/time_handler.js';

/**
 * @class TitleEnemy
 * @description 타이틀 화면 배경에 등장하는 부유물(적) 클래스입니다.
 */
export class TitleEnemy {
    /**
     * @param {TitleBackGround} titleBackGround - 부모 배경 객체
     */
    constructor(titleBackGround) {
        this.titleBackGround = titleBackGround;
        this.active = false; // 풀링을 위한 상태 플래그
        this.WW = getWW();
        this.WH = getWH();
        this.UIWW = getUIWW();

        // 풀링 재사용 시 매 프레임 할당을 줄이기 위한 벡터 캐시
        this.pos = { x: 0, y: 0 };
        this.speed = { x: 0, y: 0 };
        this.speedFromMagnetic = { x: 0, y: 0 };
        this._circlePos = { x: 0, y: 0 };
    }

    /**
     * 객체 초기화 (풀에서 재사용 시 호출)
     * @param {number} x - 초기 X 위치
     * @param {number} y - 초기 Y 위치
     * @param {string} color - 색상
     * @param {number} speedX - X 이동 속도
     * @param {number} speedY - Y 이동 속도
     * @param {string} shape - 도형 모양
     * @param {boolean} playInitAnim - 초기 애니메이션 재생 여부
     */
    init(x, y, color, speedX, speedY, shape, playInitAnim) {
        this.active = true;
        this.pos.x = x;
        this.pos.y = y;
        this.color = color;
        this.shape = shape;
        this.rotation = mathUtil().random(0, 360);
        this.alpha = mathUtil().random(0.2, 0.4);
        this.speed.x = speedX;
        this.speed.y = speedY;
        this.baseRadius = this.UIWW * (0.002 + mathUtil().random(0, 1) * 0.008);
        this.radius = this.baseRadius;
        this.magneticDistance = this.UIWW * 0.04;
        this.magneticStrength = 1;
        this.inScreen = true;
        this.speedFromMagnetic.x = 0;
        this.speedFromMagnetic.y = 0;
        this.speedBoost = 1;

        if (playInitAnim) {
            animate(this, { variable: 'speedBoost', startValue: 'current', endValue: mathUtil().random(20, 70), type: 'linear', duration: 0.001, delay: 0.5 });
            animate(this, { variable: 'speedBoost', startValue: 'current', endValue: 1, type: "easeOutExpo", duration: 1.5, delay: 0.51 });
        }
    }

    resize() {
        const prevUIWW = this.UIWW || 1;
        this.WW = getWW();
        this.WH = getWH();
        this.UIWW = getUIWW();
        const ratio = this.UIWW / Math.max(1, prevUIWW);
        this.baseRadius *= ratio;
        this.radius *= ratio;
        this.magneticDistance *= ratio;
    }

    /**
     * 상태 업데이트
     * @param {{x:number, y:number}|null} logoMagneticPoint - 로고 자석 위치
     */
    update(logoMagneticPoint) {
        const delta = getDelta();

        this.applyMagneticEffect(logoMagneticPoint, delta);

        const speedScale = delta * this.speedBoost;
        this.pos.x += (this.speed.x * speedScale) + (this.speedFromMagnetic.x * delta);
        this.pos.y += (this.speed.y * speedScale) + (this.speedFromMagnetic.y * delta);

        const damping = 1 - (1 - 0.9) * delta * 60;
        this.speedFromMagnetic.x *= damping;
        this.speedFromMagnetic.y *= damping;

        this.checkInScreen();
        if (getMouseFocus().includes("background")) {
            this.magneticStrength = getMouseInput("leftClicking") ? 5 : 2;
            this.magneticDistance = getMouseInput("leftClicking") ? this.UIWW * 0.1 : this.UIWW * 0.05;
        } else {
            this.magneticStrength = 0;
            this.magneticDistance = 0;
        }
    }

    /**
     * 화면에 그리기
     */
    draw() {
        const drawOptions = {
            shape: this.shape,
            x: this.WW * this.pos.x,
            y: this.WH * this.pos.y,
            fill: this.color,
            alpha: this.alpha,
            rotation: this.rotation
        };

        if (this.shape === 'arrow') {
            drawOptions.w = this.radius * 1.5;
            drawOptions.h = this.radius * 1.5;
        } else {
            drawOptions.radius = this.radius;
        }

        renderGL('object', drawOptions);
    }

    /**
     * 화면 내에 있는지 확인하고 active 상태 갱신
     */
    checkInScreen() {
        if (this.pos.x < -0.2 || this.pos.x > 1.2 || this.pos.y < -0.1 || this.pos.y > 1.1) this.inScreen = false;
    }

    /**
     * 자석 효과 적용 (마우스 및 로고)
     * @param {{x:number, y:number}|null} logoMagneticPoint 
     * @param {number} delta
     */
    applyMagneticEffect(logoMagneticPoint, delta) {
        this._circlePos.x = this.pos.x * this.WW;
        this._circlePos.y = this.pos.y * this.WH;

        const mousePos = getMouseInput("pos");
        this._applyMagneticPoint(mousePos, this.magneticStrength, this.magneticDistance, delta);

        if (logoMagneticPoint) {
            this._applyMagneticPoint(logoMagneticPoint, 2, this.UIWW * 0.2, delta);
        }
    }

    /**
     * 단일 자력 포인트의 영향을 계산해 속도 벡터에 반영합니다.
     * @param {{x:number, y:number}} pointPos
     * @param {number} strength
     * @param {number} distanceLimit
     * @param {number} delta
     */
    _applyMagneticPoint(pointPos, strength, distanceLimit, delta) {
        if (!pointPos || strength <= 0 || distanceLimit <= 0) return;

        const dx = this._circlePos.x - pointPos.x;
        const dy = this._circlePos.y - pointPos.y;
        const distSq = dx * dx + dy * dy;
        const limitSq = distanceLimit * distanceLimit;

        if (distSq >= limitSq || distSq === 0) return;

        const distance = Math.sqrt(distSq);
        let strengthFactor = (distanceLimit - distance) / distanceLimit;
        strengthFactor = strengthFactor * strengthFactor * strengthFactor;

        const effectiveMagneticStrength = strength * strengthFactor;
        const invLength = 1 / distance;
        const impulse = effectiveMagneticStrength * delta;

        this.speedFromMagnetic.x += dx * invLength * impulse;
        this.speedFromMagnetic.y += dy * invLength * impulse;
    }
}
