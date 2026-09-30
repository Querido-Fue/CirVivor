import { tuningGlsl, TITLE_TUNING_VEC4_COUNT } from '../_title_shader_settings.js';
/**
 * 셰이더를 컴파일합니다.
 * @param {WebGLRenderingContext} gl - 대상 WebGL 컨텍스트입니다.
 * @param {string} source - GLSL 소스입니다.
 * @param {number} type - 셰이더 타입입니다.
 * @returns {WebGLShader|null} 컴파일된 셰이더입니다.
 */
export function compileShader(gl, source, type) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    let compiled = false;
    try {
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        compiled = Boolean(gl.getShaderParameter(shader, gl.COMPILE_STATUS));
        if (!compiled) {
            console.error('셰이더 코드 컴파일 실패: ' + gl.getShaderInfoLog(shader));
        }
        return compiled ? shader : null;
    } finally {
        if (!compiled) gl.deleteShader(shader);
    }
}

/**
 * 프로그램을 생성하고 링크합니다.
 * @param {WebGLRenderingContext} gl - 대상 WebGL 컨텍스트입니다.
 * @param {WebGLShader} vertexShader - 버텍스 셰이더입니다.
 * @param {WebGLShader} fragmentShader - 프래그먼트 셰이더입니다.
 * @returns {WebGLProgram|null} 링크된 프로그램입니다.
 */
export function createProgram(gl, vertexShader, fragmentShader) {
    if (!vertexShader || !fragmentShader) return null;
    const program = gl.createProgram();
    if (!program) return null;
    let linked = false;
    try {
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);
        linked = Boolean(gl.getProgramParameter(program, gl.LINK_STATUS));
        if (!linked) {
            console.error('셰이더 프로그램 링크 실패: ' + gl.getProgramInfoLog(program));
        }
        return linked ? program : null;
    } finally {
        if (!linked) gl.deleteProgram(program);
    }
}

/** Compiles and links source strings, releasing both temporary shader objects. */
export function createProgramFromSources(gl, vertexSource, fragmentSource) {
    const vertexShader = compileShader(gl, vertexSource, gl.VERTEX_SHADER);
    if (!vertexShader) return null;
    let fragmentShader = null;
    try {
        fragmentShader = compileShader(gl, fragmentSource, gl.FRAGMENT_SHADER);
        return createProgram(gl, vertexShader, fragmentShader);
    } finally {
        gl.deleteShader(vertexShader);
        if (fragmentShader) gl.deleteShader(fragmentShader);
    }
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
 * 타이틀 중앙 원의 glow와 glass highlight를 렌더링하는 프래그먼트 셰이더입니다.
 */
export const TITLE_LOADING_CIRCLE_FRAGMENT_SHADER = `
    precision highp float;

    varying vec2 v_uv;
    uniform vec4 u_tuning[${TITLE_TUNING_VEC4_COUNT}];

    uniform vec2 u_resolution;
    uniform vec2 u_center;
    uniform float u_radius;
    uniform float u_outlineWidth;
    uniform float u_time;
    uniform float u_alpha;
    uniform float u_glowStrength;
    uniform float u_glassStrength;
    uniform float u_brightnessBoost;
    uniform sampler2D u_backdropBlurTexture;
    uniform float u_hasBackdropBlurTexture;
    uniform float u_bodyRadiusExpandOutlineRatio;
    uniform float u_backdropBlurStrength;
    uniform float u_backdropRefractionStrength;
    uniform vec3 u_baseColor;
    uniform vec3 u_deepColor;
    uniform vec3 u_rimColor;
    uniform vec3 u_highlightColor;

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
        return exp(-dot(rotated, rotated) * ${tuningGlsl("highlightFalloff")});
    }


    // Six fixed depth samples inside the analytic sphere. No scene/environment reflection.
    float orbHash(float n) {
        float p = fract(n * 0.1031);
        p *= p + 33.33;
        return fract(p * (p + p));
    }
    float orbNoise(vec3 p) {
        vec3 cell = floor(p);
        vec3 f = fract(p);
        vec3 w = f * f * (vec3(3.0) - 2.0 * f);
        float n = dot(cell, vec3(1.0, 57.0, 113.0));
        return mix(
            mix(mix(orbHash(n), orbHash(n + 1.0), w.x),
                mix(orbHash(n + 57.0), orbHash(n + 58.0), w.x), w.y),
            mix(mix(orbHash(n + 113.0), orbHash(n + 114.0), w.x),
                mix(orbHash(n + 170.0), orbHash(n + 171.0), w.x), w.y), w.z);
    }
    vec4 orbVolume(vec2 uv, float depth, float phase) {
        vec3 drift = vec3(sin(phase), cos(phase), sin(phase + 1.2)) * ${tuningGlsl("volumeMotion")};
        vec3 emitted = vec3(0.0);
        float transmission = 1.0;
        float stepLength = depth / 3.0;
        vec3 blue = vec3(${tuningGlsl("coreRed")}, ${tuningGlsl("coreGreen")}, ${tuningGlsl("coreBlue")});
        vec3 violet = u_tuning[${TITLE_TUNING_VEC4_COUNT - 4}].xyz;
        for (int sampleIndex = 0; sampleIndex < 6; sampleIndex++) {
            float z = depth * (1.0 - (float(sampleIndex) + 0.5) / 3.0);
            vec3 p = vec3(uv * (0.88 + 0.12 * z), z);
            vec3 q = p * ${tuningGlsl("volumeScale")} + drift + vec3(4.3, 1.7, 8.2);
            float warp = 0.5 + 0.5 * sin(dot(q, vec3(0.7, 0.9, 0.6)) + sin(q.z));
            float clouds = orbNoise(q + vec3(warp * ${tuningGlsl("volumeWarp")}));
            float density = mix(0.65, smoothstep(0.24, 0.78, clouds * 0.85 + warp * 0.15), ${tuningGlsl("volumeTexture")});
            float opacity = 1.0 - exp(-density * ${tuningGlsl("volumeDensity")} * stepLength);
            vec2 source = (p.xy - vec2(${tuningGlsl("coreX")}, ${tuningGlsl("coreY")})) / vec2(${tuningGlsl("coreWidth")}, ${tuningGlsl("coreHeight")});
            float blueLight = exp(-dot(source, source) * 2.0 - (z - 0.2) * (z - 0.2) * 1.6);
            float purpleLight = pow(clamp(0.5 + 0.5 * p.x, 0.0, 1.0), 2.0) * 0.3;
            vec3 lightColor = blue * blueLight * ${tuningGlsl("coreIntensity")} * ${tuningGlsl("volumeEmission")}
                + violet * purpleLight;
            emitted += transmission * opacity * lightColor;
            transmission *= exp(-density * ${tuningGlsl("volumeAbsorption")} * stepLength);
        }
        return vec4(emitted, transmission);
    }

    void main() {
        vec2 fragCoord = vec2(v_uv.x * u_resolution.x, (1.0 - v_uv.y) * u_resolution.y);
        float radius = max(1.0, u_radius);
        float bodyRadius = radius + (max(0.0, u_bodyRadiusExpandOutlineRatio) * max(1.0, u_outlineWidth));
        vec2 local = fragCoord - u_center;
        vec2 normalized = local / bodyRadius;
        float distanceFromCenter = length(local);
        float edgeSoftness = ${tuningGlsl("edgeSoftness")};
        float circleMask = 1.0 - smoothstep(bodyRadius - edgeSoftness, bodyRadius + edgeSoftness, distanceFromCenter);
        float outsideDistance = max(distanceFromCenter - radius, 0.0);
        float fillMask = circleMask;
        float angle = atan(normalized.y, normalized.x);
        float backlightDirection = mix(${tuningGlsl("backlightAmbient")}, 1.0,
            pow(saturate(0.5 + 0.5 * cos(angle - ${tuningGlsl("backlightAngle")})), ${tuningGlsl("backlightFocus")}));

        // Match the WebGPU aura, including its ROI fade and wrapped phase.
        // One configurable cycle: easeInOutSine rise, then easeInOutSine fall.
        // The caller advances time from 0 to 2 PI over the complete cycle.
        float pulseBeat = 0.5 - 0.5 * cos(u_time);
        float pulseSpread = ${tuningGlsl("pulseSize")} + pulseBeat * ${tuningGlsl("pulseSizeAmount")};
        float auraDistance = outsideDistance / (radius * pulseSpread);
        float auraFlow = 0.5 + 0.5 * sin(
            angle * ${tuningGlsl("auraFlowCount")} + u_time + sin(angle * ${tuningGlsl("auraWarpCount")} - u_time) * ${tuningGlsl("auraWarp")}
        );
        float auraWidth = ${tuningGlsl("auraWidth")} + auraFlow * ${tuningGlsl("auraWidthFlow")};
        float auraHalo = exp(-pow(auraDistance / auraWidth, 2.0));
        float auraCore = exp(-pow(auraDistance / ${tuningGlsl("auraCoreWidth")}, 2.0));
        float auraFade = 1.0 - smoothstep(${tuningGlsl("auraFadeStart")}, ${tuningGlsl("auraFadeEnd")}, auraDistance);
        float solarHalo = exp(-pow(auraDistance / ${tuningGlsl("solarWidth")}, 2.0));
        float solarSpokes = pow(0.5 + 0.5 * sin(
            angle * ${tuningGlsl("solarCount")} + sin(u_time) * ${tuningGlsl("solarRotation")}
        ), ${tuningGlsl("solarSharpness")});
        float solarGlare = solarHalo * ${tuningGlsl("solarIntensity")} + solarSpokes
            * exp(-pow(auraDistance / ${tuningGlsl("solarLength")}, 2.0)) * ${tuningGlsl("solarRayIntensity")};
        float glowPulse = ${tuningGlsl("pulseBase")} + pulseBeat * ${tuningGlsl("pulseAmount")};
        float glowAlpha = (auraHalo * ${tuningGlsl("auraIntensity")} + auraCore * ${tuningGlsl("auraCoreIntensity")} + solarGlare)
            * auraFade * (1.0 - circleMask) * u_glowStrength * glowPulse
            * mix(1.0, backlightDirection, ${tuningGlsl("glowDirectionality")});
        vec3 glowColor = mix(
            u_tuning[${TITLE_TUNING_VEC4_COUNT - 4}].xyz,
            u_tuning[${TITLE_TUNING_VEC4_COUNT - 3}].xyz,
            solarHalo * ${tuningGlsl("solarColorMix")} + auraCore * ${tuningGlsl("coreColorMix")}
        );

        // Outside the glass rim only the glare contributes.
        if (distanceFromCenter > bodyRadius + max(u_outlineWidth, edgeSoftness) * 4.0) {
            float glareAlpha = saturate(glowAlpha * u_alpha);
            if (glareAlpha <= 0.001) { discard; }
            gl_FragColor = vec4(min(glowColor * glowAlpha * u_alpha, vec3(glareAlpha)), glareAlpha);
            return;
        }


        vec3 normal = vec3(normalized, sqrt(max(0.0, 1.0 - dot(normalized, normalized))));
        vec3 lightDirection = normalize(vec3(${tuningGlsl("lightX")}, ${tuningGlsl("lightY")}, ${tuningGlsl("lightZ")}));
        float light = saturate(dot(normal, lightDirection));
        float upperLight = saturate(-normalized.y);
        float lowerDepth = saturate((normalized.y + ${tuningGlsl("lowerOffset")}) * ${tuningGlsl("lowerScale")});
        float sphericalDepth = smoothstep(${tuningGlsl("depthStart")}, 1.0, distanceFromCenter / bodyRadius);
        vec3 bodyColor = u_baseColor * (${tuningGlsl("bodyAmbient")} + (normal.z * ${tuningGlsl("bodyNormal")}) + (light * ${tuningGlsl("bodyLight")}));
        bodyColor = mix(bodyColor, u_deepColor, (lowerDepth * ${tuningGlsl("lowerDepth")}) + (sphericalDepth * ${tuningGlsl("sphereDepth")}));

        float broadTopSheen = pow(upperLight, ${tuningGlsl("sheenPower")}) * ${tuningGlsl("sheenIntensity")} * u_glassStrength;
        float compactHighlight = ellipseMask(normalized, vec2(${tuningGlsl("highlightX")}, ${tuningGlsl("highlightY")}), vec2(${tuningGlsl("highlightWidth")}, ${tuningGlsl("highlightHeight")}), ${tuningGlsl("highlightRotation")})
            * ${tuningGlsl("highlightIntensity")}
            * u_glassStrength;
        float edgeGlint = pow(saturate(1.0 - abs(distanceFromCenter - (radius * ${tuningGlsl("glintPosition")})) / max(1.0, radius * ${tuningGlsl("glintWidth")})), ${tuningGlsl("glintSharpness")})
            * pow(upperLight, ${tuningGlsl("glintTop")})
            * ${tuningGlsl("glintIntensity")}
            * u_glassStrength;
        vec3 fillColor = bodyColor;
        fillColor = min(
            vec3(1.0),
            (fillColor * (1.0 + saturate(u_brightnessBoost))) + (u_highlightColor * saturate(u_brightnessBoost) * ${tuningGlsl("brightnessHighlight")})
        );
        vec2 screenUv = gl_FragCoord.xy / max(u_resolution, vec2(1.0));
        vec2 refractionOffset = vec2(normalized.x, -normalized.y) * u_backdropRefractionStrength / max(u_resolution, vec2(1.0));
        vec3 backdropBlurColor = texture2D(u_backdropBlurTexture, screenUv + refractionOffset).rgb;
        float backdropBlend = u_hasBackdropBlurTexture
            * saturate(u_backdropBlurStrength)
            * fillMask
            * (${tuningGlsl("backdropBase")} + (upperLight * ${tuningGlsl("backdropTop")}));
        fillColor = mix(fillColor, backdropBlurColor, backdropBlend);

        // Local emission is independent of the violet body tint and backdrop opacity.
        vec4 volume = orbVolume(normalized, normal.z, u_time);
        fillColor = fillColor * volume.a + volume.rgb;
        // Front-shell wisps remain visible over the depth-integrated emission.
        float veil = orbNoise(normal * ${tuningGlsl("volumeScale")} + vec3(2.7, 8.1, 3.4));
        float veilDetail = orbNoise(normal * ${tuningGlsl("volumeScale")} * 2.1 + vec3(7.0));
        float veilMask = smoothstep(0.3, 0.72, veil * 0.8 + veilDetail * 0.2)
            * ${tuningGlsl("volumeTexture")} * normal.z;
        fillColor *= 1.0 - veilMask * 0.3;
        fillColor += u_tuning[${TITLE_TUNING_VEC4_COUNT - 4}].xyz
            * veilMask * (0.06 + 0.14 * backlightDirection);
        float coatDepth = max(1.0 - length(normalized), 0.0) / ${tuningGlsl("coatThickness")};
        float coatOcclusion = exp(-pow(coatDepth - 1.0, 2.0) * 2.0)
            * (1.0 - backlightDirection) * ${tuningGlsl("coatShadow")};
        fillColor *= 1.0 - coatOcclusion;

        // Match the sphere-local reflected aura without widening the outer glow.
        float backlightGradient = pow(smoothstep(
            1.0 - ${tuningGlsl("backlightWidth")}, 1.0,
            saturate(distanceFromCenter / bodyRadius)
        ), ${tuningGlsl("backlightFalloff")});
        vec3 backlightColor = mix(
            u_tuning[${TITLE_TUNING_VEC4_COUNT - 4}].xyz,
            backdropBlurColor, ${tuningGlsl("backlightBackdropMix")} * u_hasBackdropBlurTexture
        );
        fillColor = mix(fillColor, backlightColor,
            backlightGradient * ${tuningGlsl("backlightIntensity")} * backlightDirection);
        float backlightRim = exp(-pow(max(1.0 - length(normalized), 0.0)
            / ${tuningGlsl("backlightRimWidth")}, 2.0)) * backlightDirection;
        fillColor += mix(backlightColor, u_tuning[${TITLE_TUNING_VEC4_COUNT - 3}].xyz, backlightDirection)
            * backlightRim * ${tuningGlsl("backlightEmission")};
        float fresnel = pow(1.0 - normal.z, ${tuningGlsl("fresnelPower")});
        float coatTexture = mix(1.0, 0.65 + 0.7 * orbNoise(normal * 5.0 + vec3(4.0)), ${tuningGlsl("volumeTexture")});
        float caustic = exp(-pow(coatDepth - 0.45, 2.0) * 3.0) * backlightDirection * coatTexture;
        fillColor += backlightColor * (fresnel * ${tuningGlsl("fresnelIntensity")} * (0.2 + backlightDirection)
            + caustic * ${tuningGlsl("coatCaustic")});
        // Surface reflection stays clear even when the glass transmits the backdrop.
        float surfaceSheen = ellipseMask(normalized,
            vec2(${tuningGlsl("surfaceSheenX")}, ${tuningGlsl("surfaceSheenY")}),
            vec2(${tuningGlsl("surfaceSheenWidth")}, ${tuningGlsl("surfaceSheenHeight")}),
            ${tuningGlsl("surfaceSheenRotation")}) * ${tuningGlsl("surfaceSheenIntensity")} * u_glassStrength;
        fillColor += u_highlightColor * (broadTopSheen + compactHighlight + edgeGlint + surfaceSheen);

        float outlineDistance = abs(distanceFromCenter - radius);
        float outlineSoftness = max(0.42, edgeSoftness * ${tuningGlsl("outlineSoftness")});
        float outlineCore = 1.0 - smoothstep(
            max(0.24, u_outlineWidth * ${tuningGlsl("outlineWidth")}),
            max(0.42, u_outlineWidth * ${tuningGlsl("outlineWidth")}) + outlineSoftness,
            outlineDistance
        );
        float innerRim = exp(-pow(max(radius - distanceFromCenter, 0.0) / max(1.0, u_outlineWidth * ${tuningGlsl("innerRimWidth")}), 2.0))
            * circleMask
            * ${tuningGlsl("innerRimIntensity")};
        float rimLight = pow(saturate(cos(angle + ${tuningGlsl("rimAngle")}) * 0.5 + 0.5), ${tuningGlsl("rimSharpness")});
        vec3 rimBaseColor = mix(u_deepColor, u_baseColor, ${tuningGlsl("rimBaseMix")});
        vec3 rimColor = mix(rimBaseColor, u_highlightColor, rimLight * ${tuningGlsl("rimLight")});
        float outlineAlpha = outlineCore * ${tuningGlsl("outlineAlpha")};


        float fillAlpha = fillMask;
        vec3 premultipliedColor = (fillColor * fillAlpha)
            + (rimColor * (outlineAlpha + innerRim))
            + (glowColor * glowAlpha);
        float alpha = saturate(fillAlpha + outlineAlpha + innerRim + glowAlpha);
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
    uniform vec4 u_textureRect;
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

        vec2 textureLocal = v_panelLocal - u_textureRect.xy;
        if (textureLocal.x < 0.0
            || textureLocal.y < 0.0
            || textureLocal.x > u_textureRect.z
            || textureLocal.y > u_textureRect.w) {
            discard;
        }

        vec2 uv = textureLocal / max(u_textureRect.zw, vec2(1.0));
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
export const MAGNETIC_SHIELD_MAX_DENTS = 16;

/**
 * 마그네틱 실드 림/충돌/눌림 왜곡을 렌더링하는 프래그먼트 셰이더입니다.
 */
export const MAGNETIC_SHIELD_FRAGMENT_SHADER = `
    precision highp float;

    varying vec2 v_uv;
    uniform vec4 u_tuning[${TITLE_TUNING_VEC4_COUNT}];

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

    float crispRay(float delta, float width) {
        float normalized = abs(delta) / max(0.0001, width * ${tuningGlsl("rayForegroundWidth")});
        float softness = ${tuningGlsl("rayForegroundSoftness")};
        return 1.0 - smoothstep(1.0 - softness, 1.0 + softness, normalized);
    }

    void main() {
        vec2 fragCoord = vec2(v_uv.x * u_resolution.x, (1.0 - v_uv.y) * u_resolution.y);
        vec2 toPixel = fragCoord - u_center;
        float distanceFromCenter = length(toPixel);
        float angle = atan(toPixel.y, toPixel.x);

        float dentOffset = 0.0;
        float dentField = 0.0;
        float rayActivity = 0.0;
        float foregroundRayActivity = 0.0;

        for (int index = 0; index < ${MAGNETIC_SHIELD_MAX_DENTS}; index++) {
            if (index >= u_dentCount) {
                continue;
            }

            vec4 dent = u_dents[index];
            float dentMask = gaussian(angularDelta(angle, dent.x), dent.z) * dent.w;
            dentOffset += dent.y * dentMask;
            dentField = max(dentField, dentMask);
            rayActivity = max(rayActivity,
                gaussian(angularDelta(angle, dent.x), dent.z * ${tuningGlsl("dentRayWidth")}) * dent.w);
            foregroundRayActivity = max(foregroundRayActivity,
                crispRay(angularDelta(angle, dent.x), dent.z * ${tuningGlsl("dentRayWidth")}) * dent.w);
        }

        float shellWave = sin((angle * ${tuningGlsl("shellCount")}) - (u_time * ${tuningGlsl("shellSpeed")}) + (sin((angle * ${tuningGlsl("shellWarpCount")}) + (u_time * ${tuningGlsl("shellWarpSpeed")})) * ${tuningGlsl("shellWarp")}));
        float shellRipple = shellWave * (1.0 + (dentField * ${tuningGlsl("shellDent")})) * ${tuningGlsl("shellAmplitude")};
        float shieldRadius = max(1.0, u_radius - dentOffset + shellRipple);
        float fieldRadius = max(shieldRadius, u_fieldRadius);
        float fieldRange = max(1.0, fieldRadius - shieldRadius);
        float ringDistance = abs(distanceFromCenter - shieldRadius);
        float ringCore = exp(-pow(ringDistance / max(1.0, u_ringThickness), 2.0));
        float outerGlow = exp(-pow(max(distanceFromCenter - shieldRadius, 0.0) / max(1.0, u_glowWidth), 2.0));
        float innerGlow = exp(-pow(max(shieldRadius - distanceFromCenter, 0.0) / max(1.0, u_glowWidth * ${tuningGlsl("innerWidth")}), 2.0)) * ${tuningGlsl("innerStrength")};

        float angleLight = 0.5 + (0.5 * cos(angle + ${tuningGlsl("angleLight")}));
        float ringNoise = 0.5 + (0.5 * sin((angle * ${tuningGlsl("ringNoiseCount")}) - (u_time * ${tuningGlsl("ringNoiseSpeed")}) + (sin((angle * ${tuningGlsl("ringWarpCount")}) + (u_time * ${tuningGlsl("ringWarpSpeed")})) * ${tuningGlsl("ringWarp")})));
        float shimmer = mix(0.92, 1.08, angleLight) * mix(0.96, 1.04, ringNoise);

        vec3 shadowColor = u_shadowColor;
        vec3 lowColor = u_lowColor;
        vec3 highColor = u_highColor;
        vec3 highlightColor = u_highlightColor;

        vec3 baseColor = mix(lowColor, highColor, angleLight);
        baseColor = mix(baseColor, highlightColor, pow(angleLight, ${tuningGlsl("ringHighlightPower")}) * ${tuningGlsl("ringHighlight")});
        vec3 ringColor = mix(shadowColor, baseColor, saturate(ringCore + (outerGlow * ${tuningGlsl("ringColorMix")})));
        float fieldSignedDistance = distanceFromCenter - shieldRadius;
        float fieldDistance = max(fieldSignedDistance, 0.0);
        float fieldFade = 1.0 - smoothstep(0.0, fieldRange, fieldDistance);
        float fieldTransition = max(1.0, u_ringThickness * ${tuningGlsl("fieldTransition")});
        float fieldMask = smoothstep(-fieldTransition * ${tuningGlsl("fieldInner")}, fieldTransition, fieldSignedDistance);
        float fieldNoise = 0.55 + (0.45 * sin((angle * ${tuningGlsl("fieldNoiseCount")}) - (u_time * ${tuningGlsl("fieldNoiseSpeed")}) + (ringNoise * ${tuningGlsl("fieldNoiseWarp")})));
        float fieldVeil = pow(fieldFade, ${tuningGlsl("fieldVeilFalloff")});
        float fieldBloom = exp(-pow(fieldDistance / max(1.0, fieldRange * ${tuningGlsl("fieldBloomWidth")}), ${tuningGlsl("fieldBloomFalloff")}));
        float fieldAlpha = ((fieldVeil * ${tuningGlsl("fieldVeil")}) + (fieldBloom * ${tuningGlsl("fieldBloom")})) * fieldMask * mix(0.82, 1.12, fieldNoise);
        vec3 fieldColor = mix(shadowColor, baseColor, ${tuningGlsl("fieldBaseColor")});
        fieldColor = mix(fieldColor, highColor, fieldBloom * ${tuningGlsl("fieldHighColor")});
        fieldColor = mix(fieldColor, highlightColor, pow(fieldFade, ${tuningGlsl("fieldHighlightFalloff")}) * ${tuningGlsl("fieldHighlight")});

        float impactAlpha = 0.0;
        vec3 impactColor = vec3(0.0);
        float impactActivity = 0.0;

        for (int index = 0; index < ${MAGNETIC_SHIELD_MAX_IMPACTS}; index++) {
            if (index >= u_impactCount) {
                continue;
            }

            vec4 impact = u_impacts[index];
            float progress = saturate(impact.w);
            float fade = pow(1.0 - progress, ${tuningGlsl("impactFade")});
            float rayAttack = ${tuningGlsl("rayAttack")};
            float rayRise = 0.5 - 0.5 * cos(saturate(progress / rayAttack) * 3.141592653589793);
            float rayRelease = 0.5 + 0.5 * cos(saturate((progress - rayAttack) / (1.0 - rayAttack)) * 3.141592653589793);
            float rayEnvelope = rayRise * pow(rayRelease, ${tuningGlsl("impactFade")});
            float angularMask = gaussian(angularDelta(angle, impact.x), impact.z);
            float radialCenter = shieldRadius + mix(${tuningGlsl("impactStart")}, ${tuningGlsl("impactEnd")}, progress);
            float radialMask = gaussian(distanceFromCenter - radialCenter, (u_ringThickness * ${tuningGlsl("impactWidth")}) + ${tuningGlsl("impactBlur")});
            float flare = angularMask * radialMask * impact.y * fade * ${tuningGlsl("impactIntensity")};
            impactAlpha += flare;
            impactActivity = max(impactActivity, angularMask * impact.y * fade);
            rayActivity = max(rayActivity,
                gaussian(angularDelta(angle, impact.x), impact.z * ${tuningGlsl("impactRayWidth")}) * impact.y * rayEnvelope);
            foregroundRayActivity = max(foregroundRayActivity,
                crispRay(angularDelta(angle, impact.x), impact.z * ${tuningGlsl("impactRayWidth")}) * impact.y * rayEnvelope);
            impactColor += mix(highColor, highlightColor, ${tuningGlsl("impactColor")}) * flare;
        }

        float approachActivity = saturate(dentField * ${tuningGlsl("approachGain")});
        float localActivity = saturate(max(approachActivity, impactActivity * ${tuningGlsl("impactGain")}));
        float activityNoise = 0.88 + (0.12 * sin((angle * ${tuningGlsl("activityCount")}) + (u_time * ${tuningGlsl("activitySpeed")}) + (shellWave * ${tuningGlsl("activityWarp")})));
        float baseAlpha = ((ringCore * ${tuningGlsl("ringIntensity")}) + (outerGlow * ${tuningGlsl("outerIntensity")}) + (innerGlow * ${tuningGlsl("innerIntensity")})) * shimmer;
        baseAlpha *= localActivity * activityNoise;
        baseAlpha += approachActivity * outerGlow * ${tuningGlsl("approachGlow")};
        fieldAlpha *= max(approachActivity, impactActivity * ${tuningGlsl("fieldImpactGain")});
        fieldAlpha *= ${tuningGlsl("fieldIntensity")};
        // Match the WebGPU sharp foreground ray over the soft background veil.
        float rayDistance = max(distanceFromCenter - u_radius * ${tuningGlsl("rayStart")}, 0.0);
        float rayFalloff = gaussian(rayDistance, fieldRange * ${tuningGlsl("rayLength")});
        float rayMask = smoothstep(u_radius * ${tuningGlsl("rayMaskStart")}, u_radius * ${tuningGlsl("rayMaskEnd")}, distanceFromCenter);
        float rayAlpha = saturate(rayActivity) * rayFalloff * rayMask * fieldFade * ${tuningGlsl("rayIntensity")} * ${tuningGlsl("rayBackgroundIntensity")};
        vec3 rayColor = mix(u_tuning[${TITLE_TUNING_VEC4_COUNT - 2}].xyz, u_tuning[${TITLE_TUNING_VEC4_COUNT - 1}].xyz, rayFalloff);
        float foregroundFalloff = gaussian(rayDistance, fieldRange * ${tuningGlsl("rayLength")} * ${tuningGlsl("rayForegroundLength")});
        float foregroundAlpha = saturate(saturate(foregroundRayActivity) * foregroundFalloff * rayMask * fieldFade
            * ${tuningGlsl("rayIntensity")} * ${tuningGlsl("rayForegroundIntensity")});
        vec3 foregroundColor = mix(rayColor, vec3(1.0), ${tuningGlsl("rayForegroundHighlight")});
        vec3 backgroundColor = (fieldColor * fieldAlpha) + (ringColor * baseAlpha) + impactColor + rayColor * rayAlpha;
        float backgroundAlpha = saturate(fieldAlpha + baseAlpha + (impactAlpha * ${tuningGlsl("impactAlpha")}) + rayAlpha);
        vec3 color = foregroundColor * foregroundAlpha + min(backgroundColor, vec3(backgroundAlpha)) * (1.0 - foregroundAlpha);
        float alpha = (foregroundAlpha + backgroundAlpha * (1.0 - foregroundAlpha)) * u_alpha;
        vec3 premultipliedColor = min(color * u_alpha, vec3(alpha));

        gl_FragColor = vec4(premultipliedColor, alpha);
    }
`;

/**
 * 육각형 적 합체 경계면의 빛 번짐을 렌더링하는 프래그먼트 셰이더입니다.
 */
export const HEXA_MERGE_BOUNDARY_FRAGMENT_SHADER = `
    precision highp float;

    varying vec2 v_uv;

    uniform vec2 u_resolution;
    uniform vec2 u_start;
    uniform vec2 u_end;
    uniform float u_lineWidth;
    uniform float u_glowWidth;
    uniform float u_progress;
    uniform float u_time;
    uniform float u_alpha;
    uniform vec3 u_coreColor;
    uniform vec3 u_glowColor;
    uniform vec3 u_highlightColor;

    float saturate(float value) {
        return clamp(value, 0.0, 1.0);
    }

    void main() {
        vec2 fragCoord = vec2(v_uv.x * u_resolution.x, (1.0 - v_uv.y) * u_resolution.y);
        vec2 segment = u_end - u_start;
        float segmentLengthSq = max(dot(segment, segment), 0.0001);
        float along = saturate(dot(fragCoord - u_start, segment) / segmentLengthSq);
        vec2 closest = u_start + (segment * along);
        float distanceToLine = length(fragCoord - closest);
        float progress = saturate(u_progress);
        float coreWidth = max(1.6, u_lineWidth);
        float glowWidth = max(coreWidth + 1.5, u_glowWidth);
        float core = exp(-pow(distanceToLine / coreWidth, 2.0));
        float glow = exp(-pow(distanceToLine / glowWidth, 2.35));
        float edgeFade = smoothstep(0.0, 0.08, along) * (1.0 - smoothstep(0.92, 1.0, along));
        float pulse = 0.90 + (0.10 * sin((along * 17.0) - (u_time * 7.2) + (progress * 4.2)));
        float spark = pow(max(0.0, sin((along * 29.0) + (u_time * 11.0))), 16.0) * progress;
        float progressFade = 0.35 + (0.65 * smoothstep(0.0, 0.12, progress));

        vec3 color = (u_glowColor * glow * 0.14)
            + (u_coreColor * core * 2.0)
            + (u_highlightColor * (core * 0.36 + spark * 0.2));
        float alpha = ((glow * 0.28) + (core * 1.12) + (spark * 0.18))
            * edgeFade
            * progressFade
            * pulse
            * u_alpha;
        alpha = saturate(alpha);

        if (alpha <= 0.001) {
            discard;
        }

        vec3 premultipliedColor = min(color * u_alpha * edgeFade * progressFade, vec3(alpha));
        gl_FragColor = vec4(premultipliedColor, alpha);
    }
`;
