import { Vector2 } from 'util/vector2.js';
import { getWW, getWH, render, renderGL } from 'display/_display_system.js';
import { mathUtil } from 'util/math_util.js';
import { animate } from 'animation/_animation_system.js';
import { getMouseInput, getMouseFocus } from 'input/_input_system.js';
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
    }

    /**
     * 객체 초기화 (풀에서 재사용 시 호출)
     * @param {number} x - 초기 X 위치
     * @param {number} y - 초기 Y 위치
     * @param {string} color - 색상
     * @param {Vector2} speed - 이동 속도
     * @param {string} shape - 도형 모양
     * @param {boolean} playInitAnim - 초기 애니메이션 재생 여부
     */
    init(x, y, color, speed, shape, playInitAnim) {
        this.active = true;
        this.pos = new Vector2(x, y);
        this.color = color;
        this.shape = shape;
        this.rotation = mathUtil().random(0, 360);
        this.alpha = mathUtil().random(0.2, 0.4);
        this.speed = speed;
        this.baseRadius = this.WW * (0.002 + mathUtil().random(0, 1) * 0.008);
        this.radius = this.baseRadius;
        this.magneticDistance = this.WW * 0.04;
        this.magneticStrength = 1;
        this.inScreen = true;
        this.speedFromMagnetic = new Vector2(0, 0);
        this.speedBoost = 1;

        if (playInitAnim) {
            animate(this, { variable: 'speedBoost', startValue: 'current', endValue: mathUtil().random(20, 70), type: 'linear', duration: 0.001, delay: 0.5 });
            animate(this, { variable: 'speedBoost', startValue: 'current', endValue: 1, type: "easeOutExpo", duration: 1.5, delay: 0.51 });
        }
    }

    /**
     * 상태 업데이트
     * @param {Vector2} logoMagneticPoint - 로고 자석 위치
     */
    update(logoMagneticPoint) {
        const delta = getDelta();

        this.applyMagneticEffect(logoMagneticPoint);
        this.pos = this.pos.add(this.speed.mul(delta * this.speedBoost)).add(this.speedFromMagnetic.mul(delta));
        this.speedFromMagnetic = this.speedFromMagnetic.mul(1 - (1 - 0.9) * delta * 60);

        this.checkInScreen();
        if (getMouseFocus().includes("background")) {
            this.magneticStrength = getMouseInput("leftClicking") ? 5 : 2;
            this.magneticDistance = getMouseInput("leftClicking") ? this.WW * 0.1 : this.WW * 0.05;
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
     * @param {Vector2} logoMagneticPoint 
     */
    applyMagneticEffect(logoMagneticPoint) {
        const magneticPoints = [
            { pos: getMouseInput("pos"), strength: this.magneticStrength, distance: this.magneticDistance },
        ];
        if (logoMagneticPoint) {
            magneticPoints.push({ pos: logoMagneticPoint, strength: 2, distance: this.WW * 0.2 });
        }

        const circlePos = new Vector2(this.pos.x * this.WW, this.pos.y * this.WH);
        const delta = getDelta();

        magneticPoints.forEach(point => {
            const distance = circlePos.sub(point.pos).getLength();

            if (distance < point.distance) {
                let strengthFactor = Math.max(0, point.distance - distance) / point.distance;
                strengthFactor = Math.pow(strengthFactor, 3);
                const effectiveMagneticStrength = point.strength * strengthFactor;
                const direction = circlePos.sub(point.pos).normalize();
                this.speedFromMagnetic = this.speedFromMagnetic.add(direction.mul(effectiveMagneticStrength * delta));
            }
        });
    }
}
