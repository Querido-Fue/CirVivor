import { shadowOn, shadowOff } from 'display/_display_system.js';

export class BaseUIElement {
    constructor(properties) {
        this.id = Date.now().toString(36) + Math.random().toString(36).substr(2);

        this.parent = properties.parent || null;
        this.layer = properties.layer || 'main';
        this.x = properties.x || 0;
        this.y = properties.y || 0;
        this.alpha = properties.alpha === undefined ? 1 : properties.alpha;
        this.shadow = properties.shadow || null;
        this.visible = true;
    }

    update() {
        // 하위 클래스에서 오버라이드
    }

    draw() {
        // 하위 클래스에서 오버라이드
    }

    destroy() {
    }
}
