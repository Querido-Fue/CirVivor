/** Prototype presentation projection. x/y remain the game's authored world units. */
export class LabCamera {
    constructor(bounds) {
        this.bounds = bounds;
        this.azimuth = -35;
        this.elevation = 48;
        this.zoom = 1;
        this.width = 1;
        this.height = 1;
        this.uniform = new Float32Array(20);
        this.resize(1, 1);
    }

    resize(width, height) {
        this.width = Math.max(1, width);
        this.height = Math.max(1, height);
        this.rebuild();
    }

    rebuild() {
        const a = this.azimuth * Math.PI / 180;
        const e = this.elevation * Math.PI / 180;
        this.c = Math.cos(a);
        this.s = Math.sin(a);
        this.se = Math.sin(e);
        this.ce = Math.cos(e);
        this.cx = this.bounds.width / 2;
        this.cy = this.bounds.height / 2;
        const spanX = Math.abs(this.c) * this.bounds.width + Math.abs(this.s) * this.bounds.height;
        const spanY = (Math.abs(this.s) * this.bounds.width + Math.abs(this.c) * this.bounds.height) * this.se;
        this.scale = Math.min(this.width * 0.78 / spanX, this.height * 0.72 / (spanY + 3)) * this.zoom;
        this.ox = this.width * 0.48;
        this.oy = this.height * 0.51;
        // Row vectors, shared verbatim with WGSL; depth decreases toward camera.
        const sx = 2 * this.scale / this.width;
        const sy = -2 * this.scale / this.height;
        const depthScale = 1 / (this.bounds.width + this.bounds.height + 20);
        this.uniform.set([
            this.c * sx, -this.s * sx, 0, this.ox / this.width * 2 - 1 - (this.c * this.cx - this.s * this.cy) * sx,
            this.s * this.se * sy, this.c * this.se * sy, -this.ce * sy,
            1 - this.oy / this.height * 2 - (this.s * this.cx + this.c * this.cy) * this.se * sy,
            -this.s * this.ce * depthScale, -this.c * this.ce * depthScale, -this.se * depthScale,
            0.5 + (this.s * this.cx + this.c * this.cy) * this.ce * depthScale,
            this.width, this.height, this.scale, 1,
            0, 0, 0, 0
        ]);
    }

    project(x, y, z = 0, out = {}) {
        out.x = this.ox + ((x - this.cx) * this.c - (y - this.cy) * this.s) * this.scale;
        out.y = this.oy + (((x - this.cx) * this.s + (y - this.cy) * this.c) * this.se - z * this.ce) * this.scale;
        return out;
    }

    unproject(x, y, out = {}) {
        const u = (x - this.ox) / this.scale;
        const v = (y - this.oy) / (this.scale * this.se);
        out.x = this.cx + this.c * u + this.s * v;
        out.y = this.cy - this.s * u + this.c * v;
        return out;
    }
}
