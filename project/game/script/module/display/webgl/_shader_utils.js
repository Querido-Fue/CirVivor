/**
 * 셰이더를 컴파일합니다.
 * @param {WebGLRenderingContext} gl - 대상 WebGL 컨텍스트입니다.
 * @param {string} source - GLSL 소스입니다.
 * @param {number} type - 셰이더 타입입니다.
 * @returns {WebGLShader|null} 컴파일된 셰이더입니다.
 */
export function compileShader(gl, source, type) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('셰이더 코드 컴파일 실패: ' + gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }

    return shader;
}

/**
 * 프로그램을 생성하고 링크합니다.
 * @param {WebGLRenderingContext} gl - 대상 WebGL 컨텍스트입니다.
 * @param {WebGLShader} vertexShader - 버텍스 셰이더입니다.
 * @param {WebGLShader} fragmentShader - 프래그먼트 셰이더입니다.
 * @returns {WebGLProgram|null} 링크된 프로그램입니다.
 */
export function createProgram(gl, vertexShader, fragmentShader) {
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('셰이더 프로그램 링크 실패: ' + gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        return null;
    }

    return program;
}

/**
 * 풀스크린 샘플링에 사용하는 공통 버텍스 셰이더입니다.
 */
export const FULLSCREEN_VERTEX_SHADER = `
    attribute vec2 a_position;
    varying vec2 v_uv;

    void main() {
        v_uv = (a_position + 1.0) * 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
    }
`;

/**
 * 타이틀 로딩 원형 UI의 fill, wave, glow, glass highlight를 렌더링하는 프래그먼트 셰이더입니다.
 */
export const TITLE_LOADING_CIRCLE_FRAGMENT_SHADER = `
    precision highp float;

    varying vec2 v_uv;

    uniform vec2 u_resolution;
    uniform vec2 u_center;
    uniform float u_radius;
    uniform float u_progress;
    uniform float u_outlineWidth;
    uniform float u_wavePhase;
    uniform float u_secondaryWavePhase;
    uniform float u_time;
    uniform float u_alpha;
    uniform float u_glowStrength;
    uniform float u_glassStrength;
    uniform vec3 u_baseColor;
    uniform vec3 u_deepColor;
    uniform vec3 u_rimColor;
    uniform vec3 u_highlightColor;
    uniform vec3 u_surfaceColor;

    const float PI = 3.141592653589793;

    float saturate(float value) {
        return clamp(value, 0.0, 1.0);
    }

    float ellipseMask(vec2 position, vec2 center, vec2 radius, float rotation) {
        float sine = sin(rotation);
        float cosine = cos(rotation);
        vec2 offset = position - center;
        vec2 rotated = vec2(
            (offset.x * cosine) - (offset.y * sine),
            (offset.x * sine) + (offset.y * cosine)
        ) / max(radius, vec2(0.0001));
        return exp(-dot(rotated, rotated) * 2.25);
    }

    void main() {
        vec2 fragCoord = vec2(v_uv.x * u_resolution.x, (1.0 - v_uv.y) * u_resolution.y);
        float radius = max(1.0, u_radius);
        vec2 local = fragCoord - u_center;
        vec2 normalized = local / radius;
        float distanceFromCenter = length(local);
        float edgeSoftness = 1.35;
        float circleMask = 1.0 - smoothstep(radius - edgeSoftness, radius + edgeSoftness, distanceFromCenter);
        float outsideDistance = max(distanceFromCenter - radius, 0.0);
        float progress = saturate(u_progress);

        float fillHeight = radius * 2.0 * progress;
        float waveAmplitude = progress >= 0.999
            ? 0.0
            : min(radius * 0.052, max(1.25, fillHeight * 0.14));
        float xProgress = saturate((local.x + radius) / (radius * 2.0));
        float wave = (sin((xProgress * PI * 2.2) + u_wavePhase) * waveAmplitude)
            + (sin((xProgress * PI * 5.2) - u_secondaryWavePhase) * waveAmplitude * 0.26);
        float surfaceY = radius - fillHeight + wave;
        float fillMask = progress >= 0.999
            ? circleMask
            : circleMask * smoothstep(surfaceY - edgeSoftness, surfaceY + edgeSoftness, local.y);
        fillMask *= smoothstep(0.0, 0.025, progress);

        vec3 normal = vec3(normalized, sqrt(max(0.0, 1.0 - dot(normalized, normalized))));
        vec3 lightDirection = normalize(vec3(-0.45, -0.68, 0.58));
        float light = saturate(dot(normal, lightDirection));
        float upperLight = saturate(-normalized.y);
        float lowerDepth = saturate((normalized.y + 0.15) * 0.82);
        float sphericalDepth = smoothstep(0.18, 1.0, distanceFromCenter / radius);
        vec3 bodyColor = u_baseColor * (0.76 + (normal.z * 0.22) + (light * 0.16));
        bodyColor = mix(bodyColor, u_deepColor, (lowerDepth * 0.26) + (sphericalDepth * 0.08));

        float broadTopSheen = pow(upperLight, 3.0) * 0.09 * u_glassStrength;
        float compactHighlight = ellipseMask(normalized, vec2(-0.25, -0.56), vec2(0.42, 0.095), -0.34)
            * 0.19
            * u_glassStrength;
        float edgeGlint = pow(saturate(1.0 - abs(distanceFromCenter - (radius * 0.86)) / max(1.0, radius * 0.16)), 2.4)
            * pow(upperLight, 4.5)
            * 0.12
            * u_glassStrength;
        vec3 fillColor = bodyColor + (u_highlightColor * (broadTopSheen + compactHighlight + edgeGlint));

        float surfaceLine = progress > 0.025 && progress < 0.995
            ? exp(-pow((local.y - surfaceY) / max(1.0, radius * 0.011), 2.0)) * circleMask
            : 0.0;
        float surfaceAlpha = surfaceLine * 0.34;

        float outlineDistance = abs(distanceFromCenter - radius);
        float outlineCore = 1.0 - smoothstep(
            max(0.5, u_outlineWidth * 0.42),
            max(1.0, u_outlineWidth * 0.42) + edgeSoftness,
            outlineDistance
        );
        float innerRim = exp(-pow(max(radius - distanceFromCenter, 0.0) / max(1.0, u_outlineWidth * 4.0), 2.0))
            * circleMask
            * 0.08;
        float angle = atan(normalized.y, normalized.x);
        float rimLight = pow(saturate(cos(angle + 2.18) * 0.5 + 0.5), 3.0);
        vec3 rimBaseColor = mix(u_deepColor, u_baseColor, 0.58);
        vec3 rimColor = mix(rimBaseColor, u_highlightColor, rimLight * 0.16);
        float outlineAlpha = outlineCore * 0.36;

        float glowPulse = 0.94 + (sin(u_time) * 0.06);
        float glowAlpha = exp(-pow(outsideDistance / max(1.0, radius * 0.42), 2.0))
            * (1.0 - circleMask)
            * u_glowStrength
            * glowPulse;
        vec3 glowColor = mix(u_deepColor, u_baseColor, 0.48);

        float fillAlpha = fillMask;
        vec3 premultipliedColor = (fillColor * fillAlpha)
            + (u_surfaceColor * surfaceAlpha)
            + (rimColor * (outlineAlpha + innerRim))
            + (glowColor * glowAlpha);
        float alpha = saturate(fillAlpha + surfaceAlpha + outlineAlpha + innerRim + glowAlpha);
        alpha = saturate(alpha * u_alpha);
        premultipliedColor *= u_alpha;

        if (alpha <= 0.001) {
            discard;
        }

        premultipliedColor = min(premultipliedColor, vec3(alpha));
        gl_FragColor = vec4(premultipliedColor, alpha);
    }
`;

/**
 * premultiplied alpha 기준 캔버스 텍스처를 opacity와 함께 합성하는 프래그먼트 셰이더입니다.
 */
export const COMPOSITE_TEXTURE_FRAGMENT_SHADER = `
    precision mediump float;

    varying vec2 v_uv;

    uniform sampler2D u_texture;
    uniform float u_opacity;

    void main() {
        vec4 color = texture2D(u_texture, v_uv);
        gl_FragColor = vec4(color.rgb * u_opacity, color.a * u_opacity);
    }
`;

/**
 * 단색 오버레이를 합성하는 프래그먼트 셰이더입니다.
 */
export const SOLID_COLOR_FRAGMENT_SHADER = `
    precision mediump float;

    uniform vec4 u_color;

    void main() {
        gl_FragColor = vec4(u_color.rgb * u_color.a, u_color.a);
    }
`;

/**
 * 오버레이 카드 렌더링에 사용하는 버텍스 셰이더입니다.
 */
export const GLASS_PANEL_VERTEX_SHADER = `
    precision highp float;

    attribute vec2 a_unit;

    uniform vec4 u_drawRect;
    uniform vec4 u_panelRect;
    uniform vec2 u_resolution;
    uniform mat4 u_transform;
    uniform float u_perspective;

    varying vec2 v_panelLocal;
    varying vec2 v_panelSize;

    void main() {
        vec2 drawPosition = u_drawRect.xy + (a_unit * u_drawRect.zw);
        vec2 center = u_panelRect.xy + (u_panelRect.zw * 0.5);

        vec4 localPosition = vec4(drawPosition - center, 0.0, 1.0);
        vec4 transformed = u_transform * localPosition;
        float perspectiveScale = u_perspective / max(1.0, u_perspective - transformed.z);
        vec2 projectedPosition = (transformed.xy * perspectiveScale) + center;

        vec2 zeroToOne = projectedPosition / u_resolution;
        vec2 clipSpace = (zeroToOne * 2.0) - 1.0;
        float clipW = max(0.0001, 1.0 / perspectiveScale);
        gl_Position = vec4(clipSpace * vec2(1.0, -1.0) * clipW, 0.0, clipW);

        v_panelLocal = drawPosition - u_panelRect.xy;
        v_panelSize = u_panelRect.zw;
    }
`;

/**
 * 스프라이트 배치 렌더링용 기본 버텍스 셰이더입니다.
 */
export const DEFAULT_VERTEX_SHADER = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    attribute vec4 a_color;

    uniform vec2 u_resolution;

    varying vec2 v_texCoord;
    varying vec4 v_color;

    void main() {
        vec2 zeroToOne = a_position / u_resolution;
        vec2 zeroToTwo = zeroToOne * 2.0;
        vec2 clipSpace = zeroToTwo - 1.0;

        gl_Position = vec4(clipSpace * vec2(1.0, -1.0), 0.0, 1.0);
        v_texCoord = a_texCoord;
        v_color = a_color;
    }
`;

/**
 * 스프라이트 배치 렌더링용 기본 프래그먼트 셰이더입니다.
 */
export const DEFAULT_FRAGMENT_SHADER = `
    precision mediump float;

    varying vec2 v_texCoord;
    varying vec4 v_color;

    uniform sampler2D u_image;

    void main() {
        vec4 textureColor = texture2D(u_image, v_texCoord);
        vec4 finalColor = textureColor * v_color;
        gl_FragColor = vec4(finalColor.rgb * finalColor.a, finalColor.a);
    }
`;

/**
 * Kawase downsample 전용 프래그먼트 셰이더입니다.
 */
export const KAWASE_DOWNSAMPLE_FRAGMENT_SHADER = `
    precision mediump float;

    varying vec2 v_uv;

    uniform sampler2D u_texture;
    uniform vec2 u_texelSize;
    uniform float u_offset;

    void main() {
        vec2 offset = u_texelSize * u_offset;
        vec4 color = texture2D(u_texture, v_uv) * 0.25;
        color += texture2D(u_texture, v_uv + vec2(offset.x, offset.y)) * 0.1875;
        color += texture2D(u_texture, v_uv + vec2(-offset.x, offset.y)) * 0.1875;
        color += texture2D(u_texture, v_uv + vec2(offset.x, -offset.y)) * 0.1875;
        color += texture2D(u_texture, v_uv + vec2(-offset.x, -offset.y)) * 0.1875;
        gl_FragColor = color;
    }
`;

/**
 * Kawase upsample 전용 프래그먼트 셰이더입니다.
 */
export const KAWASE_UPSAMPLE_FRAGMENT_SHADER = `
    precision mediump float;

    varying vec2 v_uv;

    uniform sampler2D u_texture;
    uniform vec2 u_texelSize;
    uniform float u_offset;

    void main() {
        vec2 offset = u_texelSize * u_offset;
        vec4 color = texture2D(u_texture, v_uv) * 0.4;
        color += texture2D(u_texture, v_uv + vec2(offset.x, 0.0)) * 0.15;
        color += texture2D(u_texture, v_uv + vec2(-offset.x, 0.0)) * 0.15;
        color += texture2D(u_texture, v_uv + vec2(0.0, offset.y)) * 0.15;
        color += texture2D(u_texture, v_uv + vec2(0.0, -offset.y)) * 0.15;
        gl_FragColor = color;
    }
`;

/**
 * screen-space blur 샘플링 기반 glass 패널 프래그먼트 셰이더입니다.
 */
export const GLASS_PANEL_FRAGMENT_SHADER = `
    precision highp float;

    varying vec2 v_panelLocal;
    varying vec2 v_panelSize;

    uniform sampler2D u_blurTexture;
    uniform vec2 u_resolution;
    uniform float u_radius;
    uniform float u_alpha;
    uniform float u_lineWidth;
    uniform vec4 u_fillColor;
    uniform vec4 u_strokeColor;
    uniform vec4 u_tintColor;
    uniform float u_tintStrength;
    uniform vec4 u_edgeColor;
    uniform float u_edgeStrength;
    uniform float u_refractionStrength;

    float roundedRectSdf(vec2 position, vec2 size, float radius) {
        vec2 centered = position - (size * 0.5);
        vec2 q = abs(centered) - ((size * 0.5) - vec2(radius));
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
    }

    void main() {
        float sdf = roundedRectSdf(v_panelLocal, v_panelSize, u_radius);
        float baseMask = 1.0 - smoothstep(0.0, 1.5, sdf);
        if (baseMask <= 0.0) {
            discard;
        }

        vec2 screenUv = gl_FragCoord.xy / u_resolution;
        vec2 centeredUv = (v_panelLocal / max(v_panelSize, vec2(1.0))) - 0.5;
        vec2 refractOffset = centeredUv * (u_refractionStrength / u_resolution);

        vec4 blurColor = texture2D(u_blurTexture, screenUv + refractOffset);
        vec3 glassColor = blurColor.rgb;
        float fillBlend = mix(min(u_fillColor.a, 0.24), 1.0, step(0.999, u_fillColor.a));
        float tintBlend = clamp(u_tintStrength * u_tintColor.a, 0.0, 1.0);
        glassColor = mix(glassColor, u_fillColor.rgb, fillBlend);
        glassColor = mix(glassColor, u_tintColor.rgb, tintBlend);

        float insideDistance = max(0.0, -sdf);
        float innerMask = 1.0 - smoothstep(0.0, 1.5, sdf);
        float edgeFactor = innerMask * (1.0 - smoothstep(0.0, max(1.0, u_lineWidth * 1.5), insideDistance));
        float strokeFactor = innerMask * (1.0 - smoothstep(u_lineWidth, u_lineWidth + 1.0, insideDistance));
        float highlight = pow(1.0 - abs(centeredUv.y), 3.0) * 0.35;

        vec3 edgeLighting = u_edgeColor.rgb * edgeFactor * u_edgeStrength;
        vec3 topHighlight = u_edgeColor.rgb * highlight * u_edgeStrength * 0.4;
        vec4 fillColor = vec4(glassColor + edgeLighting + topHighlight, max(blurColor.a, u_fillColor.a));

        vec4 strokeColor = u_strokeColor * strokeFactor;
        vec4 finalColor = mix(fillColor, strokeColor, strokeColor.a);
        finalColor.a = max(max(blurColor.a, u_fillColor.a), strokeColor.a) * baseMask * u_alpha;

        gl_FragColor = vec4(finalColor.rgb * finalColor.a, finalColor.a);
    }
`;

/**
 * 패널 외곽에 부드러운 shadow를 그리는 프래그먼트 셰이더입니다.
 */
export const SHADOW_PANEL_FRAGMENT_SHADER = `
    precision highp float;

    varying vec2 v_panelLocal;
    varying vec2 v_panelSize;

    uniform float u_radius;
    uniform float u_alpha;
    uniform float u_shadowRadius;
    uniform vec2 u_shadowOffset;
    uniform vec4 u_shadowColor;

    float roundedRectSdf(vec2 position, vec2 size, float radius) {
        vec2 centered = position - (size * 0.5);
        vec2 q = abs(centered) - ((size * 0.5) - vec2(radius));
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
    }

    void main() {
        float shadowSdf = roundedRectSdf(v_panelLocal - u_shadowOffset, v_panelSize, u_radius);
        float panelSdf = roundedRectSdf(v_panelLocal, v_panelSize, u_radius);
        float shadowMask = 1.0 - smoothstep(-u_shadowRadius * 0.2, max(1.0, u_shadowRadius), shadowSdf);
        float panelMask = 1.0 - smoothstep(-1.0, 1.0, panelSdf);
        float shadowAlpha = shadowMask * (1.0 - panelMask) * u_shadowColor.a * u_alpha;
        if (shadowAlpha <= 0.001) {
            discard;
        }

        gl_FragColor = vec4(u_shadowColor.rgb * shadowAlpha, shadowAlpha);
    }
`;

/**
 * 패널 내부 텍스처를 동일한 기하 변형으로 합성하는 프래그먼트 셰이더입니다.
 */
export const PANEL_TEXTURE_FRAGMENT_SHADER = `
    precision highp float;

    varying vec2 v_panelLocal;
    varying vec2 v_panelSize;

    uniform sampler2D u_texture;
    uniform float u_radius;
    uniform float u_alpha;

    float roundedRectSdf(vec2 position, vec2 size, float radius) {
        vec2 centered = position - (size * 0.5);
        vec2 q = abs(centered) - ((size * 0.5) - vec2(radius));
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
    }

    void main() {
        float sdf = roundedRectSdf(v_panelLocal, v_panelSize, u_radius);
        float baseMask = 1.0 - smoothstep(0.0, 1.5, sdf);
        if (baseMask <= 0.0) {
            discard;
        }

        vec2 uv = v_panelLocal / max(v_panelSize, vec2(1.0));
        vec4 color = texture2D(u_texture, uv);
        float alpha = color.a * u_alpha * baseMask;
        gl_FragColor = vec4(color.rgb * u_alpha * baseMask, alpha);
    }
`;

/**
 * 마그네틱 실드 셰이더가 동시에 처리할 최대 충돌 수입니다.
 */
export const MAGNETIC_SHIELD_MAX_IMPACTS = 12;

/**
 * 마그네틱 실드 셰이더가 동시에 처리할 최대 왜곡 수입니다.
 */
export const MAGNETIC_SHIELD_MAX_DENTS = 8;

/**
 * 마그네틱 실드 림/충돌/눌림 왜곡을 렌더링하는 프래그먼트 셰이더입니다.
 */
export const MAGNETIC_SHIELD_FRAGMENT_SHADER = `
    precision highp float;

    varying vec2 v_uv;

    uniform vec2 u_resolution;
    uniform vec2 u_center;
    uniform float u_radius;
    uniform float u_fieldRadius;
    uniform float u_time;
    uniform float u_alpha;
    uniform float u_ringThickness;
    uniform float u_glowWidth;
    uniform vec3 u_shadowColor;
    uniform vec3 u_lowColor;
    uniform vec3 u_highColor;
    uniform vec3 u_highlightColor;
    uniform int u_impactCount;
    uniform vec4 u_impacts[${MAGNETIC_SHIELD_MAX_IMPACTS}];
    uniform int u_dentCount;
    uniform vec4 u_dents[${MAGNETIC_SHIELD_MAX_DENTS}];

    float saturate(float value) {
        return clamp(value, 0.0, 1.0);
    }

    float gaussian(float value, float sigma) {
        float safeSigma = max(0.0001, sigma);
        float normalized = value / safeSigma;
        return exp(-(normalized * normalized));
    }

    float angularDelta(float angleA, float angleB) {
        return atan(sin(angleA - angleB), cos(angleA - angleB));
    }

    void main() {
        vec2 fragCoord = vec2(v_uv.x * u_resolution.x, (1.0 - v_uv.y) * u_resolution.y);
        vec2 toPixel = fragCoord - u_center;
        float distanceFromCenter = length(toPixel);
        float angle = atan(toPixel.y, toPixel.x);

        float dentOffset = 0.0;
        float dentField = 0.0;

        for (int index = 0; index < ${MAGNETIC_SHIELD_MAX_DENTS}; index++) {
            if (index >= u_dentCount) {
                continue;
            }

            vec4 dent = u_dents[index];
            float dentMask = gaussian(angularDelta(angle, dent.x), dent.z) * dent.w;
            dentOffset += dent.y * dentMask;
            dentField = max(dentField, dentMask);
        }

        float shellWave = sin((angle * 7.5) - (u_time * 2.4) + (sin((angle * 3.4) + (u_time * 1.45)) * 0.7));
        float shellRipple = shellWave * (1.0 + (dentField * 1.35)) * 1.4;
        float shieldRadius = max(1.0, u_radius - dentOffset + shellRipple);
        float fieldRadius = max(shieldRadius, u_fieldRadius);
        float fieldRange = max(1.0, fieldRadius - shieldRadius);
        float ringDistance = abs(distanceFromCenter - shieldRadius);
        float ringCore = exp(-pow(ringDistance / max(1.0, u_ringThickness), 2.0));
        float outerGlow = exp(-pow(max(distanceFromCenter - shieldRadius, 0.0) / max(1.0, u_glowWidth), 2.0));
        float innerGlow = exp(-pow(max(shieldRadius - distanceFromCenter, 0.0) / max(1.0, u_glowWidth * 0.42), 2.0)) * 0.16;

        float angleLight = 0.5 + (0.5 * cos(angle + 0.85));
        float ringNoise = 0.5 + (0.5 * sin((angle * 5.0) - (u_time * 1.7) + (sin((angle * 3.0) + (u_time * 0.9)) * 0.4)));
        float shimmer = mix(0.92, 1.08, angleLight) * mix(0.96, 1.04, ringNoise);

        vec3 shadowColor = u_shadowColor;
        vec3 lowColor = u_lowColor;
        vec3 highColor = u_highColor;
        vec3 highlightColor = u_highlightColor;

        vec3 baseColor = mix(lowColor, highColor, angleLight);
        baseColor = mix(baseColor, highlightColor, pow(angleLight, 6.0) * 0.55);
        vec3 ringColor = mix(shadowColor, baseColor, saturate(ringCore + (outerGlow * 0.7)));
        float fieldSignedDistance = distanceFromCenter - shieldRadius;
        float fieldDistance = max(fieldSignedDistance, 0.0);
        float fieldFade = 1.0 - smoothstep(0.0, fieldRange, fieldDistance);
        float fieldTransition = max(1.0, u_ringThickness * 2.4);
        float fieldMask = smoothstep(-fieldTransition * 0.35, fieldTransition, fieldSignedDistance);
        float fieldNoise = 0.55 + (0.45 * sin((angle * 2.2) - (u_time * 0.65) + (ringNoise * 1.8)));
        float fieldVeil = pow(fieldFade, 1.18);
        float fieldBloom = exp(-pow(fieldDistance / max(1.0, fieldRange * 0.34), 1.28));
        float fieldAlpha = ((fieldVeil * 0.32) + (fieldBloom * 0.06)) * fieldMask * mix(0.82, 1.12, fieldNoise);
        vec3 fieldColor = mix(shadowColor, baseColor, 0.88);
        fieldColor = mix(fieldColor, highColor, fieldBloom * 0.065);
        fieldColor = mix(fieldColor, highlightColor, pow(fieldFade, 2.2) * 0.18);

        float impactAlpha = 0.0;
        vec3 impactColor = vec3(0.0);
        float impactActivity = 0.0;

        for (int index = 0; index < ${MAGNETIC_SHIELD_MAX_IMPACTS}; index++) {
            if (index >= u_impactCount) {
                continue;
            }

            vec4 impact = u_impacts[index];
            float progress = saturate(impact.w);
            float fade = pow(1.0 - progress, 1.4);
            float angularMask = gaussian(angularDelta(angle, impact.x), impact.z);
            float radialCenter = shieldRadius + mix(-1.0, 8.0, progress);
            float radialMask = gaussian(distanceFromCenter - radialCenter, (u_ringThickness * 2.2) + 5.0);
            float flare = angularMask * radialMask * impact.y * fade * 0.72;
            impactAlpha += flare;
            impactActivity = max(impactActivity, angularMask * impact.y * fade);
            impactColor += mix(highColor, highlightColor, 0.58) * flare;
        }

        float approachActivity = saturate(dentField * 1.2);
        float localActivity = saturate(max(approachActivity, impactActivity * 0.92));
        float activityNoise = 0.88 + (0.12 * sin((angle * 4.0) + (u_time * 3.1) + (shellWave * 0.7)));
        float baseAlpha = ((ringCore * 0.82) + (outerGlow * 0.18) + (innerGlow * 0.05)) * shimmer;
        baseAlpha *= localActivity * activityNoise;
        baseAlpha += approachActivity * outerGlow * 0.08;
        fieldAlpha *= max(approachActivity, impactActivity * 0.55);
        vec3 color = (fieldColor * fieldAlpha) + (ringColor * baseAlpha) + impactColor;
        float alpha = saturate(fieldAlpha + baseAlpha + (impactAlpha * 0.85)) * u_alpha;
        vec3 premultipliedColor = min(color * u_alpha, vec3(alpha));

        gl_FragColor = vec4(premultipliedColor, alpha);
    }
`;
