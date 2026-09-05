import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGameModule } from './support/source_module_loader.mjs';

const { createProgramFromSources } = await loadGameModule('display/webgl/_shader_utils.js');
const { MagneticShieldEffectPass } = await loadGameModule('display/webgl/_magnetic_shield_effect_pass.js');
const { HexaMergeBoundaryEffectPass } = await loadGameModule('display/webgl/_hexa_merge_boundary_effect_pass.js');
const { TitleLoadingCircleEffectPass } = await loadGameModule('display/webgl/_title_loading_circle_effect_pass.js');
const { buildCircleScissorRect, buildEffectScissorRect, applyScissorRect } = await loadGameModule('display/webgl/_fullscreen_pass.js');

function createGl(failure) {
    const resources = [];
    const allocate = kind => {
        if (failure === `${kind}-allocation`) return null;
        const resource = { kind, deleted: false };
        resources.push(resource);
        return resource;
    };
    const release = resource => { resource.deleted = true; };
    return {
        resources,
        VERTEX_SHADER: 'vertex', FRAGMENT_SHADER: 'fragment',
        createShader: allocate, deleteShader: release,
        shaderSource: shader => assert.ok(shader),
        compileShader: shader => {
            if (failure === `${shader.kind}-compile`) throw new Error(failure);
        },
        getShaderParameter: () => true,
        createProgram: () => allocate('program'), deleteProgram: release,
        attachShader: (program, shader) => { assert.ok(program); assert.ok(shader); },
        linkProgram: () => { if (failure === 'link') throw new Error(failure); },
        getProgramParameter: () => true,
        getUniformLocation: () => 1, getAttribLocation: () => 0,
        createBuffer: () => allocate('buffer'), deleteBuffer: release,
        bindBuffer() {}, bufferData() {},
        useProgram: () => assert.fail('unavailable/destroyed effect must not draw')
    };
}

test('WebGL compilation releases partial resources on allocation or compile/link failure', () => {
    for (const failure of ['vertex-allocation', 'fragment-allocation', 'program-allocation', 'vertex-compile', 'fragment-compile', 'link']) {
        const gl = createGl(failure);
        if (failure.endsWith('allocation')) {
            assert.equal(createProgramFromSources(gl, 'vertex', 'fragment'), null);
        } else {
            assert.throws(() => createProgramFromSources(gl, 'vertex', 'fragment'), { message: failure });
        }
        assert.ok(gl.resources.every(resource => resource.deleted), failure);
    }
});

test('linked WebGL program retains only its program and releases temporary shaders', () => {
    const gl = createGl();
    const program = createProgramFromSources(gl, 'vertex', 'fragment');
    assert.equal(program.deleted, false);
    assert.ok(gl.resources.filter(resource => resource !== program).every(resource => resource.deleted));
});

test('effect passes skip draw after allocation failure or destroy and release all resources', () => {
    for (const Pass of [MagneticShieldEffectPass, HexaMergeBoundaryEffectPass, TitleLoadingCircleEffectPass]) {
        for (const failure of ['fragment-allocation', 'buffer-allocation', null]) {
            const gl = createGl(failure);
            const pass = new Pass(gl);
            const command = { radius: 10, x: 20, y: 20, x1: 10, y1: 10, x2: 20, y2: 20 };
            if (failure) assert.doesNotThrow(() => pass.draw(command, 100, 100));
            pass.destroy();
            assert.doesNotThrow(() => pass.draw(command, 100, 100));
            pass.destroy();
            assert.ok(gl.resources.every(resource => resource.deleted), `${Pass.name}: ${failure}`);
        }
    }
});

test('fullscreen scissor clips fractional and offscreen bounds and converts the Y origin', () => {
    assert.deepEqual(buildCircleScissorRect(2.25, 97, 5, 100, 100), { x: 0, y: 92, w: 8, h: 8 });
    assert.equal(buildCircleScissorRect(-20, 50, 5, 100, 100), null);
    assert.equal(buildCircleScissorRect(10, 10, Infinity, 100, 100), null);
    assert.deepEqual(buildEffectScissorRect(70.5, 40, 10, 20, 2, 100, 100), { x: 8, y: 18, w: 65, h: 24 });
    let scissor;
    applyScissorRect({ enable() {}, scissor: (...args) => { scissor = args; } }, { x: 8, y: 18, w: 65, h: 24 }, 100);
    assert.deepEqual(scissor, [8, 58, 65, 24]);
});
