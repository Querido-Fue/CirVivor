import { getWW, getWH, getUIWW, render, shadowOn, shadowOff, getBehindCanvases, getCanvas, setDim } from 'display/display_system.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { animate, remove } from 'animation/animation_system.js';
import { setMouseFocus, getMouseFocus } from 'input/input_system.js';
import { getSetting } from 'save/save_system.js';
import { parseUIData } from 'ui/ui_system.js';
import { releaseUIItem } from 'ui/_ui_pool.js';
import { PositioningHandler } from 'ui/_positioning_handler.js';
import { DEFAULT_OVERLAY_ANIMATION_PRESET, OVERLAY_ANIMATION_PRESETS, getOverlayAnimationPreset } from './_animation_presets.js';

/**
 * @class BaseOverlay
 * @description 게임 내 모든 오버레이(팝업)의 기본 클래스입니다.
 * 공통적인 열기/닫기 애니메이션, 배경 그리기(Glassmorphism) 등을 처리합니다.
 */
export class BaseOverlay {
    /**
     * @param {string} layer - 오버레이가 그려질 레이어 이름
     */
    constructor(layer = 'overlay', animationPreset = DEFAULT_OVERLAY_ANIMATION_PRESET) {
        this.layer = layer;
        this.sourceCanvases = getBehindCanvases(layer);
        this.WW = getWW();
        this.UIWW = getUIWW();
        this.WH = getWH();

        // 지오메트리 변수 초기화
        this.width = 0;
        this.height = 0;
        this.dx = 0;
        this.dy = 0;

        // 인터페이스 스케일 적용
        this.uiScale = getSetting('uiScale') / 100 || 1;
        this.positioningHandler = new PositioningHandler(this, this.uiScale);

        // 애니메이션 처리
        this.animating = false;
        this.animScale = 0.9;
        this.animBlur = 0;
        this.alpha = 0;
        this._animIds = { alpha: -1, scale: -1, blur: -1 };
        this._transitionToken = 0;
        this.animationPreset = animationPreset;
    }

    _calculateGeometry() {
        this.scaledW = this.width * this.uiScale;
        this.scaledH = this.height * this.uiScale;
        this.scaledX = (this.WW - this.scaledW) / 2 + this.dx;
        this.scaledY = (this.WH - this.scaledH) / 2 + this.dy;
    }

    _generateLayout() {
        // 하위 클래스에서 구현
    }

    _onResize() {
        // 하위 클래스에서 구현
    }

    resize() {
        if (this.animating) return;

        this.WW = getWW();
        this.UIWW = getUIWW();
        this.WH = getWH();
        this._onResize();
        this._calculateGeometry();
        this.positioningHandler.resize(this, this.uiScale);
        this._generateLayout();
    }

    _setDimInstant(opacity) {
        const dimId = this.layer === 'overlay'
            ? 'overlaydim'
            : this.layer === 'popup'
                ? 'popupdim'
                : null;

        if (!dimId) {
            setDim(this.layer, opacity);
            return;
        }

        const dim = document.getElementById(dimId);
        if (!dim) {
            setDim(this.layer, opacity);
            return;
        }

        const previousTransition = dim.style.transition;
        dim.style.transition = 'none';
        dim.style.opacity = `${opacity}`;
        void dim.offsetHeight;
        dim.style.transition = previousTransition;
    }

    _cancelOverlayAnimations() {
        for (const key of Object.keys(this._animIds)) {
            const id = this._animIds[key];
            if (id >= 0) {
                remove(id);
            }
            this._animIds[key] = -1;
        }
    }

    setAnimationPreset(name) {
        if (name && OVERLAY_ANIMATION_PRESETS[name]) {
            this.animationPreset = name;
            return;
        }
        if (name && !OVERLAY_ANIMATION_PRESETS[name]) {
            console.warn(`Overlay animation preset not found: ${name}. Fallback to ${DEFAULT_OVERLAY_ANIMATION_PRESET}.`);
        }
        this.animationPreset = DEFAULT_OVERLAY_ANIMATION_PRESET;
    }

    _getAnimationPreset() {
        return getOverlayAnimationPreset(this.animationPreset);
    }

    /**
     * 오버레이를 엽니다.
     */
    open() {
        const preset = this._getAnimationPreset();
        const openPreset = preset.open;
        const dimPreset = preset.dim;
        const token = ++this._transitionToken;
        this._cancelOverlayAnimations();

        this.animating = true;
        this.previousFocus = getMouseFocus();
        setMouseFocus(this.layer);

        // 신규 오픈 시 시작 상태를 명확히 고정합니다.
        this.alpha = openPreset.alpha.from;
        this.animScale = openPreset.scale.from;
        this.animBlur = openPreset.blur.from;

        const canvas = getCanvas(this.layer);
        canvas.style.opacity = `${this.alpha}`;
        canvas.style.transform = `scale(${this.animScale})`;
        canvas.style.filter = `blur(${this.animBlur}px)`;

        if (dimPreset?.openMode === 'instant') this._setDimInstant(ColorSchemes.Overlay.Panel.Dim);
        else setDim(this.layer, ColorSchemes.Overlay.Panel.Dim);

        const alphaAnim = animate(this, {
            variable: 'alpha',
            startValue: 'current',
            endValue: openPreset.alpha.to,
            type: openPreset.alpha.easing,
            duration: openPreset.alpha.duration
        });
        this._animIds.alpha = alphaAnim.id;

        const blurAnim = animate(this, {
            variable: 'animBlur',
            startValue: 'current',
            endValue: openPreset.blur.to,
            type: openPreset.blur.easing,
            duration: openPreset.blur.duration
        });
        this._animIds.blur = blurAnim.id;

        const scaleAnim = animate(this, {
            variable: 'animScale',
            startValue: 'current',
            endValue: openPreset.scale.to,
            type: openPreset.scale.easing,
            duration: openPreset.scale.duration
        });
        this._animIds.scale = scaleAnim.id;

        scaleAnim.promise.then(() => {
            if (token !== this._transitionToken) return;

            this.animating = false;
            this._animIds.alpha = -1;
            this._animIds.blur = -1;
            this._animIds.scale = -1;

            canvas.style.opacity = '1';
            canvas.style.transform = 'scale(1)';
            canvas.style.filter = 'blur(0px)';
        });
    }

    /**
     * 오버레이를 닫습니다.
     */
    close() {
        const preset = this._getAnimationPreset();
        const closePreset = preset.close;
        const dimPreset = preset.dim;
        const token = ++this._transitionToken;
        this._cancelOverlayAnimations();

        this.animating = true;
        if (dimPreset?.closeMode === 'beforeAnimation') {
            setDim(this.layer, 0);
        }

        const alphaAnim = animate(this, {
            variable: 'alpha',
            startValue: 'current',
            endValue: closePreset.alpha.to,
            type: closePreset.alpha.easing,
            duration: closePreset.alpha.duration
        });
        this._animIds.alpha = alphaAnim.id;

        const blurAnim = animate(this, {
            variable: 'animBlur',
            startValue: 'current',
            endValue: closePreset.blur.to,
            type: closePreset.blur.easing,
            duration: closePreset.blur.duration
        });
        this._animIds.blur = blurAnim.id;

        const scaleAnim = animate(this, {
            variable: 'animScale',
            startValue: 'current',
            endValue: closePreset.scale.to,
            type: closePreset.scale.easing,
            duration: closePreset.scale.duration
        });
        this._animIds.scale = scaleAnim.id;

        scaleAnim.promise.then(() => {
            if (token !== this._transitionToken) return;

            const canvas = getCanvas(this.layer);
            canvas.style.opacity = '1';
            canvas.style.transform = 'scale(1)';
            canvas.style.filter = 'blur(0px)';

            if (dimPreset?.closeMode !== 'beforeAnimation') {
                setDim(this.layer, 0);
            }
            setMouseFocus(this.previousFocus || ['ui', 'background']);

            this.alpha = 0;
            this.animScale = 1;
            this.animBlur = 0;
            this._animIds.alpha = -1;
            this._animIds.blur = -1;
            this._animIds.scale = -1;

            this.onCloseComplete();
            this._releaseElements();
            this.animating = false;
        });
    }

    _releaseElements() {
        if (this.staticItems) {
            for (const key in this.staticItems) {
                releaseUIItem(this.staticItems[key].item);
            }
            this.staticItems = null;
        }
        if (this.dynamicItems) {
            for (const key in this.dynamicItems) {
                releaseUIItem(this.dynamicItems[key].item);
            }
            this.dynamicItems = null;
        }
        this._cancelOverlayAnimations();
    }

    onCloseComplete() {
        // 하위 클래스에서 구현
    }

    update() {
        if (this.dynamicItems) {
            for (const key in this.dynamicItems) {
                const item = this.dynamicItems[key].item;
                if (item.update) item.update();
            }
        }
        if (!this.animating) return;

        const canvas = getCanvas(this.layer);
        canvas.style.opacity = this.alpha;
        canvas.style.transform = `scale(${this.animScale})`;
        canvas.style.filter = `blur(${this.animBlur}px)`;
    }

    /**
     * 배경과 기본 프레임을 그립니다.
     */
    draw() {
        if (this.alpha === 0) return;

        // 글래스모피즘 패널
        shadowOn(this.layer, 30, ColorSchemes.Overlay.Panel.Shadow);
        render(this.layer, {
            shape: getSetting('disableTransparency') ? 'roundRect' : 'glassRect',
            x: this.scaledX,
            y: this.scaledY,
            w: this.scaledW,
            h: this.scaledH,
            radius: parseUIData('UI_CONSTANTS.OVERLAY_PANEL_RADIUS', this.uiScale),
            image: this.sourceCanvases,
            blur: 10,
            fill: getSetting('disableTransparency') ? ColorSchemes.Overlay.Panel.Background : ColorSchemes.Overlay.Panel.GlassBackground,
            stroke: getSetting('disableTransparency') ? ColorSchemes.Overlay.Panel.Background : ColorSchemes.Overlay.Panel.GlassBorder,
            lineWidth: 1,
        });
        shadowOff(this.layer);

        if (this.staticItems) {
            for (const key in this.staticItems) {
                render(this.layer, this.staticItems[key].item);
            }
        }
        if (this.dynamicItems) {
            const floatingItems = [];
            for (const key in this.dynamicItems) {
                const item = this.dynamicItems[key].item;
                if (item.draw) item.draw();
                if (typeof item.drawFloating === 'function') floatingItems.push(item);
            }
            for (const item of floatingItems) {
                item.drawFloating();
            }
        }
    }
}
