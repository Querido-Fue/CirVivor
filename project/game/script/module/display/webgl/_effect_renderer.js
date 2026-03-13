import {
    compileShader,
    createProgram,
    FULLSCREEN_VERTEX_SHADER,
    MAGNETIC_SHIELD_FRAGMENT_SHADER,
    MAGNETIC_SHIELD_MAX_DENTS,
    MAGNETIC_SHIELD_MAX_IMPACTS
} from './_shader_utils.js';

/**
 * @class MagneticShieldEffectPass
 * @description 마그네틱 실드 전용 풀스크린 패스를 렌더링합니다.
 */
class MagneticShieldEffectPass {
    /**
     * @param {WebGLRenderingContext} gl - 대상 WebGL 컨텍스트입니다.
     */
    constructor(gl) {
        this.gl = gl;
        this.programInfo = this.#createProgramInfo();
        this.fullscreenBuffer = this.#createFullscreenBuffer();
        this.impactBuffer = new Float32Array(MAGNETIC_SHIELD_MAX_IMPACTS * 4);
        this.dentBuffer = new Float32Array(MAGNETIC_SHIELD_MAX_DENTS * 4);
    }

    /**
     * 마그네틱 실드 명령 하나를 렌더링합니다.
     * @param {object} command - 렌더링 명령입니다.
     * @param {number} width - 현재 surface 너비입니다.
     * @param {number} height - 현재 surface 높이입니다.
     */
    draw(command, width, height) {
        if (!command || !Number.isFinite(command.radius) || command.radius <= 0) {
            return;
        }

        const gl = this.gl;
        const renderWidth = Math.max(1, gl.drawingBufferWidth || width);
        const renderHeight = Math.max(1, gl.drawingBufferHeight || height);
        const centerX = Number.isFinite(command.x) ? command.x : 0;
        const centerY = Number.isFinite(command.y) ? command.y : 0;
        const alpha = Number.isFinite(command.alpha) ? Math.max(0, Math.min(1, command.alpha)) : 1;
        const ringThickness = Number.isFinite(command.ringThickness)
            ? Math.max(1, command.ringThickness)
            : 6;
        const glowWidth = Number.isFinite(command.glowWidth)
            ? Math.max(1, command.glowWidth)
            : 24;
        const fieldRadius = Number.isFinite(command.fieldRadius)
            ? Math.max(command.radius, command.fieldRadius)
            : command.radius;
        const impacts = Array.isArray(command.impacts) ? command.impacts : [];
        const dents = Array.isArray(command.dents) ? command.dents : [];
        const impactCount = this.#writeImpacts(impacts);
        const dentCount = this.#writeDents(dents);

        gl.useProgram(this.programInfo.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.fullscreenBuffer);
        gl.enableVertexAttribArray(this.programInfo.attributes.a_position);
        gl.vertexAttribPointer(this.programInfo.attributes.a_position, 2, gl.FLOAT, false, 0, 0);

        gl.uniform2f(this.programInfo.uniforms.u_resolution, renderWidth, renderHeight);
        gl.uniform2f(this.programInfo.uniforms.u_center, centerX, centerY);
        gl.uniform1f(this.programInfo.uniforms.u_radius, command.radius);
        gl.uniform1f(this.programInfo.uniforms.u_fieldRadius, fieldRadius);
        gl.uniform1f(this.programInfo.uniforms.u_time, Number.isFinite(command.time) ? command.time : 0);
        gl.uniform1f(this.programInfo.uniforms.u_alpha, alpha);
        gl.uniform1f(this.programInfo.uniforms.u_ringThickness, ringThickness);
        gl.uniform1f(this.programInfo.uniforms.u_glowWidth, glowWidth);
        gl.uniform3fv(this.programInfo.uniforms.u_shadowColor, command.shadowColor || [0.07, 0.04, 0.25]);
        gl.uniform3fv(this.programInfo.uniforms.u_lowColor, command.lowColor || [0.60, 0.36, 0.98]);
        gl.uniform3fv(this.programInfo.uniforms.u_highColor, command.highColor || [0.70, 0.93, 1.0]);
        gl.uniform3fv(this.programInfo.uniforms.u_highlightColor, command.highlightColor || [0.96, 0.995, 1.0]);
        gl.uniform1i(this.programInfo.uniforms.u_impactCount, impactCount);
        gl.uniform4fv(this.programInfo.uniforms.u_impacts, this.impactBuffer);
        gl.uniform1i(this.programInfo.uniforms.u_dentCount, dentCount);
        gl.uniform4fv(this.programInfo.uniforms.u_dents, this.dentBuffer);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    /**
     * GL 리소스를 해제합니다.
     */
    destroy() {
        if (this.fullscreenBuffer) {
            this.gl.deleteBuffer(this.fullscreenBuffer);
            this.fullscreenBuffer = null;
        }

        if (this.programInfo?.program) {
            this.gl.deleteProgram(this.programInfo.program);
            this.programInfo = null;
        }
    }

    /**
     * @private
     * @returns {{program: WebGLProgram, uniforms: Object.<string, WebGLUniformLocation>, attributes: Object.<string, number>}}
     */
    #createProgramInfo() {
        const gl = this.gl;
        const vertexShader = compileShader(gl, FULLSCREEN_VERTEX_SHADER, gl.VERTEX_SHADER);
        const fragmentShader = compileShader(gl, MAGNETIC_SHIELD_FRAGMENT_SHADER, gl.FRAGMENT_SHADER);
        const program = createProgram(gl, vertexShader, fragmentShader);

        return {
            program,
            uniforms: {
                u_resolution: gl.getUniformLocation(program, 'u_resolution'),
                u_center: gl.getUniformLocation(program, 'u_center'),
                u_radius: gl.getUniformLocation(program, 'u_radius'),
                u_fieldRadius: gl.getUniformLocation(program, 'u_fieldRadius'),
                u_time: gl.getUniformLocation(program, 'u_time'),
                u_alpha: gl.getUniformLocation(program, 'u_alpha'),
                u_ringThickness: gl.getUniformLocation(program, 'u_ringThickness'),
                u_glowWidth: gl.getUniformLocation(program, 'u_glowWidth'),
                u_shadowColor: gl.getUniformLocation(program, 'u_shadowColor'),
                u_lowColor: gl.getUniformLocation(program, 'u_lowColor'),
                u_highColor: gl.getUniformLocation(program, 'u_highColor'),
                u_highlightColor: gl.getUniformLocation(program, 'u_highlightColor'),
                u_impactCount: gl.getUniformLocation(program, 'u_impactCount'),
                u_impacts: gl.getUniformLocation(program, 'u_impacts[0]'),
                u_dentCount: gl.getUniformLocation(program, 'u_dentCount'),
                u_dents: gl.getUniformLocation(program, 'u_dents[0]')
            },
            attributes: {
                a_position: gl.getAttribLocation(program, 'a_position')
            }
        };
    }

    /**
     * @private
     * @returns {WebGLBuffer} 풀스크린 쿼드 버퍼입니다.
     */
    #createFullscreenBuffer() {
        const gl = this.gl;
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1,
            1, -1,
            -1, 1,
            1, 1
        ]), gl.STATIC_DRAW);
        return buffer;
    }

    /**
     * @private
     * @param {Array<{angle:number, intensity:number, width:number, progress:number}>} impacts - 충돌 이벤트 배열입니다.
     * @returns {number} 실제 업로드된 개수입니다.
     */
    #writeImpacts(impacts) {
        this.impactBuffer.fill(0);

        let writeCount = 0;
        for (let index = 0; index < impacts.length && writeCount < MAGNETIC_SHIELD_MAX_IMPACTS; index++) {
            const impact = impacts[index];
            if (!impact) {
                continue;
            }

            const offset = writeCount * 4;
            this.impactBuffer[offset] = Number.isFinite(impact.angle) ? impact.angle : 0;
            this.impactBuffer[offset + 1] = Number.isFinite(impact.intensity) ? impact.intensity : 0;
            this.impactBuffer[offset + 2] = Number.isFinite(impact.width) ? impact.width : 0.12;
            this.impactBuffer[offset + 3] = Number.isFinite(impact.progress) ? impact.progress : 0;
            writeCount += 1;
        }

        return writeCount;
    }

    /**
     * @private
     * @param {Array<{angle:number, depth:number, width:number, strength:number}>} dents - 눌림 왜곡 배열입니다.
     * @returns {number} 실제 업로드된 개수입니다.
     */
    #writeDents(dents) {
        this.dentBuffer.fill(0);

        let writeCount = 0;
        for (let index = 0; index < dents.length && writeCount < MAGNETIC_SHIELD_MAX_DENTS; index++) {
            const dent = dents[index];
            if (!dent) {
                continue;
            }

            const offset = writeCount * 4;
            this.dentBuffer[offset] = Number.isFinite(dent.angle) ? dent.angle : 0;
            this.dentBuffer[offset + 1] = Number.isFinite(dent.depth) ? dent.depth : 0;
            this.dentBuffer[offset + 2] = Number.isFinite(dent.width) ? dent.width : 0.18;
            this.dentBuffer[offset + 3] = Number.isFinite(dent.strength) ? dent.strength : 0;
            writeCount += 1;
        }

        return writeCount;
    }
}

/**
 * @class EffectRenderer
 * @description effect 레이어의 커스텀 WebGL 이펙트 명령을 큐잉/플러시합니다.
 */
export class EffectRenderer {
    /**
     * @param {WebGLRenderingContext} gl - 대상 WebGL 컨텍스트입니다.
     */
    constructor(gl) {
        this.gl = gl;
        this.width = 0;
        this.height = 0;
        this.commands = [];
        this.effectPasses = new Map([
            ['magneticShield', new MagneticShieldEffectPass(gl)]
        ]);
    }

    /**
     * 렌더 타깃 크기를 갱신합니다.
     * @param {number} width - 새 너비입니다.
     * @param {number} height - 새 높이입니다.
     */
    resize(width, height) {
        this.width = Math.max(1, Math.floor(width));
        this.height = Math.max(1, Math.floor(height));
    }

    /**
     * 프레임 시작 시 큐를 초기화합니다.
     * @param {number} width - 현재 surface 너비입니다.
     * @param {number} height - 현재 surface 높이입니다.
     */
    beginFrame(width, height) {
        this.resize(width, height);
        this.width = Math.max(1, this.gl.drawingBufferWidth || this.width);
        this.height = Math.max(1, this.gl.drawingBufferHeight || this.height);
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
        this.gl.viewport(0, 0, this.width, this.height);
        this.commands.length = 0;
    }

    /**
     * 이펙트 명령을 큐에 적재합니다.
     * @param {object} command - effect 렌더링 명령입니다.
     */
    render(command) {
        if (!command) {
            return;
        }

        this.commands.push(command);
    }

    /**
     * 큐에 쌓인 이펙트 명령을 순서대로 실행합니다.
     */
    flush() {
        if (this.commands.length === 0 || this.width <= 0 || this.height <= 0) {
            this.commands.length = 0;
            return;
        }

        for (let index = 0; index < this.commands.length; index++) {
            const command = this.commands[index];
            const effectType = command.effectType || command.shape;
            const effectPass = this.effectPasses.get(effectType);
            if (!effectPass || typeof effectPass.draw !== 'function') {
                continue;
            }

            effectPass.draw(command, this.width, this.height);
        }

        this.commands.length = 0;
    }

    /**
     * GL 리소스를 해제합니다.
     */
    destroy() {
        for (const effectPass of this.effectPasses.values()) {
            effectPass.destroy();
        }
        this.effectPasses.clear();
        this.commands.length = 0;
    }
}
