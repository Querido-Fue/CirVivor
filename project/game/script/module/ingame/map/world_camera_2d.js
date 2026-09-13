import { CAMERA_ZOOM_LIMITS } from '../contract/camera_control_contract.js';
import { CERAMIC_WORLD_VISUAL } from 'data/theme/ceramic_world_visual_data.js';

/**
 * 유한한 0 이상 크기를 반환합니다.
 * @param {*} value - 원본 값입니다.
 * @returns {number} 안전한 크기입니다.
 */
function normalizeSize(value) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? Math.max(0, numericValue) : 0;
}

/**
 * 값을 유한한 범위로 제한합니다.
 * @param {*} value - 원본 값입니다.
 * @param {number} min - 하한입니다.
 * @param {number} max - 상한입니다.
 * @param {number} fallback - 유효하지 않을 때의 값입니다.
 * @returns {number} 제한된 값입니다.
 */
function clampFinite(value, min, max, fallback) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, numericValue));
}

/**
 * 월드 전체가 viewport 안에 들어오는 균일 배율을 계산합니다.
 * @param {number} worldWidth - 월드 너비입니다.
 * @param {number} worldHeight - 월드 높이입니다.
 * @param {number} viewportWidth - viewport 너비입니다.
 * @param {number} viewportHeight - viewport 높이입니다.
 * @returns {number} contain 배율입니다.
 */
function resolveContainScale(
    worldWidth,
    worldHeight,
    viewportWidth,
    viewportHeight
) {
    if (worldWidth <= 0
        || worldHeight <= 0
        || viewportWidth <= 0
        || viewportHeight <= 0) {
        return 0;
    }
    return Math.min(
        viewportWidth / worldWidth,
        viewportHeight / worldHeight
    );
}

/**
 * @class WorldCamera2D
 * @description contain 배율과 월드 중심 추종을 지원하며 맵 가장자리 밖도 표시하는 직교 projection입니다.
 */
export class WorldCamera2D {
    constructor() {
        this.worldWidth = 0;
        this.worldHeight = 0;
        this.viewportWidth = 0;
        this.viewportHeight = 0;
        this.fitScale = 0;
        this.scale = 0;
        this._zoom = CAMERA_ZOOM_LIMITS.DEFAULT;
        this.offsetX = 0;
        this.offsetY = 0;
        this.projectionRevision = 0;
        this.viewBounds = { left: 0, top: 0, right: 0, bottom: 0 };
        this.viewCenterViewport = { x: 0, y: 0 };
        this.viewCenterWorld = { x: 0, y: 0 };
        this.centerScratch = { x: 0, y: 0 };
        this.depthView = null;
    }

    /**
     * 월드 크기와 초기 viewport를 설정합니다.
     * @param {{width:number,height:number}} worldBounds - 월드 크기입니다.
     * @param {{ww:number,wh:number}} viewport - 실제 표시 viewport입니다.
     * @returns {void}
     */
    init(worldBounds, viewport) {
        this.worldWidth = normalizeSize(worldBounds?.width);
        this.worldHeight = normalizeSize(worldBounds?.height);
        this._zoom = CAMERA_ZOOM_LIMITS.DEFAULT;
        this.scale = 0;
        this.viewCenterWorld.x = this.worldWidth * 0.5;
        this.viewCenterWorld.y = this.worldHeight * 0.5;
        this.resize(viewport);
    }

    /** Opt-in for the production depth renderer; the benchmark keeps its flat projection. */
    enableDepthPresentation() {
        if (this.depthView) return;
        const center = { ...this.viewCenterWorld };
        this.depthView = { uniform: new Float32Array(20), width: 0, height: 0, scale: 0 };
        this.depthView.uniform[15]=1;
        const a = CERAMIC_WORLD_VISUAL.azimuthDegrees * Math.PI / 180;
        const e = CERAMIC_WORLD_VISUAL.elevationDegrees * Math.PI / 180;
        Object.assign(this.depthView, { c: Math.cos(a), s: Math.sin(a), se: Math.sin(e), ce: Math.cos(e) });
        this.resize({ww:this.viewportWidth,wh:this.viewportHeight});
        this.centerOnWorldPoint(center.x, center.y);
    }

    /**
     * viewport 크기를 갱신하되 기존 화면 중심의 월드 위치와 현재 zoom 배율을 유지합니다.
     * 진행 중 zoom은 resize 이후 새 viewport 중앙을 앵커로 계속 진행합니다.
     * @param {{ww:number,wh:number}} viewport - 실제 표시 viewport입니다.
     * @returns {void}
     */
    resize(viewport) {
        if (this.scale > 0) {
            this.viewportToWorld(
                this.viewportWidth * 0.5,
                this.viewportHeight * 0.5,
                this.centerScratch
            );
        } else {
            this.centerScratch.x = this.worldWidth * 0.5;
            this.centerScratch.y = this.worldHeight * 0.5;
        }

        this.viewportWidth = normalizeSize(viewport?.ww);
        this.viewportHeight = normalizeSize(viewport?.wh);
        this.fitScale = resolveContainScale(
            this.worldWidth,
            this.worldHeight,
            this.viewportWidth,
            this.viewportHeight
        );
        if (this.depthView) {
            const {c,s,se}=this.depthView;
            this.fitScale=resolveContainScale(
                Math.abs(c)*this.worldWidth+Math.abs(s)*this.worldHeight,
                (Math.abs(s)*this.worldWidth+Math.abs(c)*this.worldHeight)*se+3,
                this.viewportWidth,this.viewportHeight
            );
        }
        this.scale = this.fitScale * this._zoom;
        this.viewCenterViewport.x = this.viewportWidth * 0.5;
        this.viewCenterViewport.y = this.viewportHeight * 0.5;
        this.viewCenterWorld.x = clampFinite(
            this.centerScratch.x,
            0,
            this.worldWidth,
            this.worldWidth * 0.5
        );
        this.viewCenterWorld.y = clampFinite(
            this.centerScratch.y,
            0,
            this.worldHeight,
            this.worldHeight * 0.5
        );
        this.#rebuildProjection();
    }

    /**
     * 지정한 월드 좌표를 viewport 중앙에 배치합니다.
     * offset을 월드 경계로 제한하지 않아 가장자리에서도 월드 밖을 표시합니다.
     * @param {*} worldX - 중앙에 둘 월드 X입니다.
     * @param {*} worldY - 중앙에 둘 월드 Y입니다.
     * @param {*} [blend=1] - 맵 기하 중심(0)과 target 중심(1) 사이의 보간값입니다.
     * @returns {boolean} projection 중심이 실제로 바뀌었는지 여부입니다.
     */
    centerOnWorldPoint(worldX, worldY, blend = 1) {
        const mapCenterX = this.worldWidth * 0.5;
        const mapCenterY = this.worldHeight * 0.5;
        const targetWorldX = clampFinite(
            worldX,
            0,
            this.worldWidth,
            mapCenterX
        );
        const targetWorldY = clampFinite(
            worldY,
            0,
            this.worldHeight,
            mapCenterY
        );
        const centerBlend = clampFinite(blend, 0, 1, 1);
        const nextWorldX = mapCenterX
            + ((targetWorldX - mapCenterX) * centerBlend);
        const nextWorldY = mapCenterY
            + ((targetWorldY - mapCenterY) * centerBlend);
        const nextViewportX = this.viewportWidth * 0.5;
        const nextViewportY = this.viewportHeight * 0.5;
        if (Object.is(nextWorldX, this.viewCenterWorld.x)
            && Object.is(nextWorldY, this.viewCenterWorld.y)
            && Object.is(nextViewportX, this.viewCenterViewport.x)
            && Object.is(nextViewportY, this.viewCenterViewport.y)) {
            return false;
        }

        this.viewCenterWorld.x = nextWorldX;
        this.viewCenterWorld.y = nextWorldY;
        this.viewCenterViewport.x = nextViewportX;
        this.viewCenterViewport.y = nextViewportY;
        this.#rebuildProjection();
        return true;
    }

    /**
     * 맵의 기하학적 중심을 viewport 중앙에 다시 배치합니다.
     * @returns {boolean} projection 중심이 실제로 바뀌었는지 여부입니다.
     */
    resetViewCenter() {
        return this.centerOnWorldPoint(
            this.worldWidth * 0.5,
            this.worldHeight * 0.5
        );
    }

    /**
     * contain 배율 대비 zoom 배율을 반환합니다.
     * @returns {number} contain 대비 현재 zoom 배율입니다.
     */
    get zoom() {
        return this._zoom;
    }

    /**
     * contain 배율 대비 zoom을 적용하고 현재 월드 중심을 보존합니다.
     * AnimationSystem이 이 속성을 직접 보간할 수 있습니다.
     * @param {*} value - 새 zoom 배율입니다.
     */
    set zoom(value) {
        const nextZoom = clampFinite(
            value,
            CAMERA_ZOOM_LIMITS.MIN,
            CAMERA_ZOOM_LIMITS.MAX,
            this._zoom
        );
        if (Object.is(nextZoom, this._zoom)) {
            return;
        }
        this._zoom = nextZoom;
        this.scale = this.fitScale * this._zoom;
        this.#rebuildProjection();
    }

    /** @returns {number} contain 배율 대비 현재 zoom입니다. */
    getZoom() {
        return this._zoom;
    }

    /** @returns {object} 현재 월드 기준 view bounds입니다. */
    getViewBounds() {
        return this.viewBounds;
    }

    /** @returns {number} projection 변경 revision입니다. */
    getProjectionRevision() {
        return this.projectionRevision;
    }

    /** @returns {number} 한 월드 단위를 렌더 타깃 좌표로 바꾸는 배율입니다. */
    getScale() {
        return this.scale;
    }

    /**
     * 월드 좌표를 실제 표시 viewport 좌표로 변환합니다.
     * @param {*} x - 월드 X입니다.
     * @param {*} y - 월드 Y입니다.
     * @param {object} [out={}] - 재사용 결과 객체입니다.
     * @returns {{x:number,y:number}} 결과 객체입니다.
     */
    worldToViewport(x, y, out = {}) {
        if (this.depthView) {
            const {c,s,se}=this.depthView;
            out.x=this.offsetX+(Number(x)*c-Number(y)*s)*this.scale;
            out.y=this.offsetY+(Number(x)*s+Number(y)*c)*se*this.scale;
            return out;
        }
        out.x = this.offsetX + (Number(x) * this.scale);
        out.y = this.offsetY + (Number(y) * this.scale);
        return out;
    }

    /**
     * 실제 표시 viewport 좌표를 월드 좌표로 역변환합니다.
     * @param {*} x - viewport X입니다.
     * @param {*} y - viewport Y입니다.
     * @param {object} [out={}] - 재사용 결과 객체입니다.
     * @returns {{x:number,y:number}} 결과 객체입니다.
     */
    viewportToWorld(x, y, out = {}) {
        if (this.scale <= 0) {
            out.x = 0;
            out.y = 0;
            return out;
        }
        if (this.depthView) {
            const {c,s,se}=this.depthView;
            const u=(Number(x)-this.offsetX)/this.scale;
            const v=(Number(y)-this.offsetY)/(this.scale*se);
            out.x=c*u+s*v;out.y=-s*u+c*v;
            return out;
        }
        out.x = (Number(x) - this.offsetX) / this.scale;
        out.y = (Number(y) - this.offsetY) / this.scale;
        return out;
    }

    /**
     * 월드 길이를 현재 viewport 길이로 변환합니다.
     * @param {*} length - 월드 길이입니다.
     * @returns {number} viewport 길이입니다.
     */
    worldLengthToViewport(length) {
        const numericLength = Number(length);
        return Number.isFinite(numericLength)
            ? numericLength * this.scale
            : 0;
    }

    /**
     * 원이 현재 object viewport와 겹치는지 확인합니다.
     * @param {number} x - 원 중심 X입니다.
     * @param {number} y - 원 중심 Y입니다.
     * @param {number} radius - 반지름입니다.
     * @returns {boolean} 표시 가능 여부입니다.
     */
    isCircleVisible(x, y, radius) {
        if (this.scale <= 0) {
            return false;
        }
        return x + radius >= this.viewBounds.left
            && x - radius <= this.viewBounds.right
            && y + radius >= this.viewBounds.top
            && y - radius <= this.viewBounds.bottom;
    }

    /**
     * 현재 zoom·앵커에서 offset과 view bounds를 다시 계산합니다.
     * @returns {void}
     * @private
     */
    #rebuildProjection() {
        if (this.depthView && this.scale>0 && this.viewportWidth>0 && this.viewportHeight>0) {
            const d=this.depthView;
            const {c,s,se,ce}=d;
            const cx=this.viewCenterWorld.x,cy=this.viewCenterWorld.y;
            this.offsetX=this.viewCenterViewport.x-(cx*c-cy*s)*this.scale;
            this.offsetY=this.viewCenterViewport.y-(cx*s+cy*c)*se*this.scale;
            const sx=2*this.scale/this.viewportWidth,sy=-2*this.scale/this.viewportHeight;
            const dz=1/(this.worldWidth+this.worldHeight+20);
            d.width=this.viewportWidth;d.height=this.viewportHeight;d.scale=this.scale;
            d.uniform.set([c*sx,-s*sx,0,2*this.offsetX/this.viewportWidth-1,
                s*se*sy,c*se*sy,-ce*sy,1-2*this.offsetY/this.viewportHeight,
                -s*ce*dz,-c*ce*dz,-se*dz,0.5+(s*cx+c*cy)*ce*dz,
                this.viewportWidth,this.viewportHeight,this.scale,d.uniform[15]]);
            const bounds=this.viewBounds;
            bounds.left=Infinity;bounds.top=Infinity;bounds.right=-Infinity;bounds.bottom=-Infinity;
            for(const x of [0,this.viewportWidth])for(const y of [0,this.viewportHeight]) {
                this.viewportToWorld(x,y,this.centerScratch);
                bounds.left=Math.min(bounds.left,this.centerScratch.x);
                bounds.right=Math.max(bounds.right,this.centerScratch.x);
                bounds.top=Math.min(bounds.top,this.centerScratch.y);
                bounds.bottom=Math.max(bounds.bottom,this.centerScratch.y);
            }
            this.projectionRevision++;
            return;
        }
        this.offsetX = this.viewCenterViewport.x
            - (this.viewCenterWorld.x * this.scale);
        this.offsetY = this.viewCenterViewport.y
            - (this.viewCenterWorld.y * this.scale);

        if (this.scale <= 0) {
            this.viewBounds.left = 0;
            this.viewBounds.top = 0;
            this.viewBounds.right = this.worldWidth;
            this.viewBounds.bottom = this.worldHeight;
        } else {
            this.viewBounds.left = Math.max(0, -this.offsetX / this.scale);
            this.viewBounds.top = Math.max(0, -this.offsetY / this.scale);
            this.viewBounds.right = Math.min(
                this.worldWidth,
                (this.viewportWidth - this.offsetX) / this.scale
            );
            this.viewBounds.bottom = Math.min(
                this.worldHeight,
                (this.viewportHeight - this.offsetY) / this.scale
            );
        }
        this.projectionRevision++;
    }
}
