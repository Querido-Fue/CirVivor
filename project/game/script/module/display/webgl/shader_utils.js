/**
 * 셰이더 소스를 컴파일합니다.
 * @param {WebGLRenderingContext} gl 
 * @param {string} source 
 * @param {number} type 
 * @returns {WebGLShader|null}
 */
export function compileShader(gl, source, type) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('An error occurred compiling the shaders: ' + gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

/**
 * 셰이더 프로그램을 생성하고 링크합니다.
 * @param {WebGLRenderingContext} gl 
 * @param {WebGLShader} vertexShader 
 * @param {WebGLShader} fragmentShader 
 * @returns {WebGLProgram|null}
 */
export function createProgram(gl, vertexShader, fragmentShader) {
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Unable to initialize the shader program: ' + gl.getProgramInfoLog(program));
        return null;
    }
    return program;
}

/**
 * 기본 버텍스 셰이더 소스
 */
export const DEFAULT_VERTEX_SHADER = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    attribute vec4 a_color;
    
    uniform vec2 u_resolution;
    
    varying vec2 v_texCoord;
    varying vec4 v_color;
    
    void main() {
        // 픽셀 좌표를 0.0에서 1.0 사이로 변환
        vec2 zeroToOne = a_position / u_resolution;
        
        // 0.0->1.0을 0.0->2.0으로 변환
        vec2 zeroToTwo = zeroToOne * 2.0;
        
        // 0.0->2.0을 -1.0->+1.0으로 변환 (클립 공간)
        vec2 clipSpace = zeroToTwo - 1.0;
        
        // y축 반전 (캔버스는 좌상이 0,0이지만 WebGL은 좌하가 0,0)
        gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
        
        v_texCoord = a_texCoord;
        v_color = a_color;
    }
`;

export const DEFAULT_FRAGMENT_SHADER = `
    precision mediump float;
    
    varying vec2 v_texCoord;
    varying vec4 v_color;
    
    uniform sampler2D u_image;
    
    void main() {
        vec4 texColor = texture2D(u_image, v_texCoord);
        vec4 finalColor = texColor * v_color;
        gl_FragColor = vec4(finalColor.rgb * finalColor.a, finalColor.a);
    }
`;
