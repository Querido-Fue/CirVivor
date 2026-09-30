import { TITLE_LOADING_CONSTANTS } from 'scene/title/_title_runtime_constants.js';
import { rgbToHsl, hslToRgb } from 'util/color_util.js';
import { WEBGPU_GAUSSIAN_BLUR_CONSTANTS } from './webgpu/webgpu_gaussian_blur_algorithm.js';

const circleDefaults = TITLE_LOADING_CONSTANTS.CIRCLE_SHADER;

// One catalog owns slider ranges, defaults and the appended GPU uniform layout.
// Numerical guards, sample coordinates and collision-buffer limits are not artistic controls.
export const TITLE_SHADER_SETTINGS = Object.freeze([
    ["pulsePeriod","기본","펄스 주기 (초)",8,1,30,0.1],
    ["alpha","기본","원 불투명도",circleDefaults.ALPHA,0,1,0.01],
    ["glowStrength","기본","글로우 강도",circleDefaults.GLOW_STRENGTH,0,1,0.01],
    ["glassStrength","기본","유리 반사 강도",circleDefaults.GLASS_STRENGTH,0,2,0.01],
    ["brightnessBoost","기본","원 밝기",circleDefaults.BRIGHTNESS_BOOST,0,1,0.01],
    ["bodyExpand","기본","외곽 확장",circleDefaults.BODY_RADIUS_EXPAND_OUTLINE_RATIO,0,2,0.01],
    ["backdropBlur","기본","배경 블러",circleDefaults.BACKDROP_BLUR,0,WEBGPU_GAUSSIAN_BLUR_CONSTANTS.MAX_SOURCE_SIGMA,0.01],
    ["backdropBlend","기본","배경 혼합",circleDefaults.BACKDROP_BLUR_STRENGTH,0,1,0.01],
    ["refraction","기본","굴절 강도",circleDefaults.BACKDROP_REFRACTION_STRENGTH,0,20,0.01],
    ["outlineScale","기본","테두리 두께 배율",1,0.25,4,0.01],
    ["shieldAlpha","기본","충돌 불투명도 배율",1,0,2,0.01],
    ["shieldRing","기본","충돌 링 두께 배율",1,0.25,3,0.01],
    ["shieldGlow","기본","충돌 블러 폭 배율",1,0.1,3,0.01],
    ["shieldSpeed","기본","충돌 노이즈 속도 배율",1,0,3,0.01],
    ["pulseSize","펄스","기본 광원 크기",0.96,0.5,1.5,0.01],
    ["pulseSizeAmount","펄스","크기 변화량",0.15,0,0.5,0.01],
    ["pulseBase","펄스","기본 밝기",0.62,0,2,0.01],
    ["pulseAmount","펄스","밝기 변화량",0.26,0,2,0.01],
    ["auraFlowCount","아우라","물결 수",3,1,12,1],
    ["auraWarpCount","아우라","보조 물결 수",2,1,12,1],
    ["auraWarp","아우라","물결 왜곡",1,0,2,0.01],
    ["auraWidth","아우라","블러 폭",0.32,0.02,0.8,0.01],
    ["auraWidthFlow","아우라","폭 변화량",0.06,0,0.3,0.01],
    ["auraCoreWidth","아우라","코어 폭",0.1,0.01,0.5,0.01],
    ["auraFadeStart","아우라","감쇠 시작",0.7,0.05,0.9,0.01],
    ["auraFadeEnd","아우라","감쇠 끝",1.25,1,2,0.01],
    ["auraIntensity","아우라","아우라 강도",2.2,0,3,0.01],
    ["auraCoreIntensity","아우라","코어 강도",0.15,0,2,0.01],
    ["solarWidth","태양 글레어","헤일로 폭",0.5,0.02,1,0.01],
    ["solarCount","태양 글레어","광선 수",5,1,20,1],
    ["solarRotation","태양 글레어","광선 흔들림",0.18,0,1,0.01],
    ["solarSharpness","태양 글레어","광선 선명도",6,1,24,0.1],
    ["solarIntensity","태양 글레어","헤일로 강도",4.6,0,8,0.01],
    ["solarLength","태양 글레어","광선 길이",0.55,0.03,1.5,0.01],
    ["solarRayIntensity","태양 글레어","광선 강도",0.35,0,3,0.01],
    ["solarColorMix","태양 글레어","헤일로 하이라이트 혼합",0.65,0,1,0.01],
    ["coreColorMix","태양 글레어","코어 하이라이트 혼합",0.15,0,1,0.01],
    ["edgeSoftness","유리 조명","가장자리 부드러움",1.2,0.1,4,0.01],
    ["lightX","유리 조명","조명 방향 X",0.15,-1,1,0.01],
    ["lightY","유리 조명","조명 방향 Y",-0.71,-1,1,0.01],
    ["lightZ","유리 조명","조명 방향 Z",0.58,0.05,1,0.01],
    ["lowerOffset","유리 조명","하단 음영 위치",0.15,-0.5,0.5,0.01],
    ["lowerScale","유리 조명","하단 음영 범위",0.82,0,2,0.01],
    ["depthStart","유리 조명","구면 음영 시작",0.18,0,0.9,0.01],
    ["bodyAmbient","유리 조명","주변광",0.56,0,2,0.01],
    ["bodyNormal","유리 조명","구면 밝기",0.22,0,1,0.01],
    ["bodyLight","유리 조명","직접광",0.27,0,1,0.01],
    ["lowerDepth","유리 조명","하단 음영 강도",0.62,0,1,0.01],
    ["sphereDepth","유리 조명","구면 음영 강도",0.16,0,1,0.01],
    ["sheenPower","유리 반사","상단 반사 선명도",3,0.5,12,0.1],
    ["sheenIntensity","유리 반사","상단 반사 강도",0.09,0,1,0.01],
    ["highlightX","유리 반사","하이라이트 X",-0.55,-1,1,0.01],
    ["highlightY","유리 반사","하이라이트 Y",-0.62,-1,1,0.01],
    ["highlightWidth","유리 반사","하이라이트 가로 폭",0.12,0.02,1,0.01],
    ["highlightHeight","유리 반사","하이라이트 세로 폭",0.035,0.005,0.5,0.005],
    ["highlightRotation","유리 반사","하이라이트 회전",0.85,-3.14,3.14,0.01],
    ["highlightIntensity","유리 반사","하이라이트 강도",1.35,0,2,0.01],
    ["highlightFalloff","유리 반사","하이라이트 감쇠",2.25,0.2,8,0.01],
    ["glintPosition","유리 반사","림 반사 위치",0.81,0.2,1,0.01],
    ["glintWidth","유리 반사","림 반사 폭",0.16,0.01,0.5,0.01],
    ["glintSharpness","유리 반사","림 반사 선명도",1.8,0.5,10,0.1],
    ["glintTop","유리 반사","림 반사 상단 집중",2,0.5,12,0.1],
    ["glintIntensity","유리 반사","림 반사 강도",0.12,0,1,0.01],
    ["brightnessHighlight","유리 반사","밝기 하이라이트 혼합",0.18,0,1,0.01],
    ["backdropBase","유리 반사","배경 기본 혼합",0.72,0,1,0.01],
    ["backdropTop","유리 반사","배경 상단 혼합",0.18,0,1,0.01],
    ["outlineSoftness","테두리","테두리 블러 배율",0.39,0.05,2,0.01],
    ["outlineWidth","테두리","테두리 코어 폭",0.18,0.01,1,0.01],
    ["innerRimWidth","테두리","내부 림 폭",4,0.1,8,0.1],
    ["innerRimIntensity","테두리","내부 림 강도",0.04,0,1,0.01],
    ["rimAngle","테두리","림 조명 각도",2.18,-3.14,3.14,0.01],
    ["rimSharpness","테두리","림 조명 선명도",3,0.5,12,0.1],
    ["rimBaseMix","테두리","림 바탕색 혼합",0.42,0,1,0.01],
    ["rimLight","테두리","림 조명 강도",0.16,0,1,0.01],
    ["outlineAlpha","테두리","테두리 불투명도",0.04,0,1,0.01],
    ["dentRayWidth","충돌 레이","접근 레이 폭",1.1,0.1,4,0.01],
    ["impactRayWidth","충돌 레이","충돌 레이 폭",1.3,0.1,4,0.01],
    ["rayStart","충돌 레이","레이 시작 위치",1.2,0.1,1.2,0.01],
    ["rayLength","충돌 레이","레이 길이",0.23,0.02,0.8,0.01],
    ["rayMaskStart","충돌 레이","레이 내측 감쇠",0.65,0.1,0.7,0.01],
    ["rayMaskEnd","충돌 레이","레이 외측 감쇠",0.85,0.75,1.2,0.01],
    ["rayIntensity","충돌 레이","레이 강도",0.85,0,3,0.01],
    ["shellCount","충돌 링","물결 수",7.5,1,20,0.1],
    ["shellSpeed","충돌 링","물결 속도",2.4,0,8,0.1],
    ["shellWarpCount","충돌 링","보조 물결 수",3.4,1,15,0.1],
    ["shellWarpSpeed","충돌 링","보조 물결 속도",1.45,0,5,0.01],
    ["shellWarp","충돌 링","물결 왜곡",0.7,0,2,0.01],
    ["shellDent","충돌 링","접근 물결 증폭",1.35,0,4,0.01],
    ["shellAmplitude","충돌 링","물결 높이",0.2,0,5,0.01],
    ["innerWidth","충돌 링","내측 블러 폭",0.42,0.05,1,0.01],
    ["innerStrength","충돌 링","내측 블러 강도",0.05,0,1,0.01],
    ["angleLight","충돌 링","조명 각도",0.85,-3.14,3.14,0.01],
    ["ringNoiseCount","충돌 링","노이즈 수",5,1,20,1],
    ["ringNoiseSpeed","충돌 링","노이즈 속도",1.7,0,6,0.01],
    ["ringWarpCount","충돌 링","보조 노이즈 수",3,1,12,1],
    ["ringWarpSpeed","충돌 링","보조 노이즈 속도",0.9,0,6,0.01],
    ["ringWarp","충돌 링","노이즈 왜곡",0.4,0,2,0.01],
    ["ringHighlightPower","충돌 링","반사 선명도",6,0.5,16,0.1],
    ["ringHighlight","충돌 링","반사 강도",0.55,0,1,0.01],
    ["ringColorMix","충돌 링","블러 색상 혼합",0.7,0,1,0.01],
    ["fieldTransition","충돌 산란","경계 폭",2.4,0.1,6,0.01],
    ["fieldInner","충돌 산란","내측 경계",0.35,0,1,0.01],
    ["fieldNoiseCount","충돌 산란","노이즈 수",2.2,0.1,10,0.01],
    ["fieldNoiseSpeed","충돌 산란","노이즈 속도",0.65,0,5,0.01],
    ["fieldNoiseWarp","충돌 산란","노이즈 왜곡",1.8,0,5,0.01],
    ["fieldVeilFalloff","충돌 산란","베일 감쇠",1.18,0.1,5,0.01],
    ["fieldBloomWidth","충돌 산란","블룸 폭",0.34,0.02,1,0.01],
    ["fieldBloomFalloff","충돌 산란","블룸 감쇠",1.28,0.1,5,0.01],
    ["fieldVeil","충돌 산란","베일 강도",0.32,0,2,0.01],
    ["fieldBloom","충돌 산란","블룸 강도",1.15,0,2,0.01],
    ["fieldBaseColor","충돌 산란","기본색 혼합",0.88,0,1,0.01],
    ["fieldHighColor","충돌 산란","밝은색 혼합",0.065,0,1,0.005],
    ["fieldHighlightFalloff","충돌 산란","하이라이트 감쇠",2.2,0.1,6,0.01],
    ["fieldHighlight","충돌 산란","하이라이트 강도",0.18,0,1,0.01],
    ["impactFade","충돌 플래시","시간 감쇠",1.4,0.1,5,0.01],
    ["impactStart","충돌 플래시","시작 반경 오프셋",-1,-10,10,0.01],
    ["impactEnd","충돌 플래시","끝 반경 오프셋",8,0,30,0.01],
    ["impactWidth","충돌 플래시","플래시 폭 배율",2.2,0.1,6,0.01],
    ["impactBlur","충돌 플래시","플래시 블러",4.99,0,20,0.01],
    ["impactIntensity","충돌 플래시","플래시 강도",0.72,0,3,0.01],
    ["impactColor","충돌 플래시","하이라이트 혼합",0.58,0,1,0.01],
    ["approachGain","충돌 활동","접근 증폭",1.2,0,4,0.01],
    ["impactGain","충돌 활동","충돌 증폭",0.92,0,3,0.01],
    ["activityCount","충돌 활동","활동 노이즈 수",4,1,12,1],
    ["activitySpeed","충돌 활동","활동 노이즈 속도",3.1,0,10,0.01],
    ["activityWarp","충돌 활동","활동 노이즈 왜곡",0.7,0,2,0.01],
    ["ringIntensity","충돌 활동","링 강도",0.1,0,2,0.01],
    ["outerIntensity","충돌 활동","외측 글로우 강도",0.12,0,2,0.01],
    ["innerIntensity","충돌 활동","내측 글로우 강도",0.05,0,2,0.01],
    ["approachGlow","충돌 활동","접근 글로우 강도",0.08,0,2,0.01],
    ["fieldImpactGain","충돌 활동","충돌 산란 증폭",0.55,0,2,0.01],
    ["fieldIntensity","충돌 활동","산란 전체 강도",0.08,0,1,0.01],
    ["impactAlpha","충돌 활동","플래시 불투명도",0.85,0,2,0.01],
    ["auraHue","아우라 색상","색상 이동 (H)",0,-180,180,1],
    ["auraSaturation","아우라 색상","채도 배율 (S)",1,0,3,0.01],
    ["auraLightness","아우라 색상","명도 이동 (L)",0,-1,1,0.01],
    ["rayHue","레이 색상","색상 이동 (H)",0,-180,180,1],
    ["raySaturation","레이 색상","채도 배율 (S)",1,0,3,0.01],
    ["rayLightness","레이 색상","명도 이동 (L)",-0.15,-1,1,0.01],
    ["circleHue","원 색상","색상 이동 (H)",42,-180,180,1],
    ["circleSaturation","원 색상","채도 배율 (S)",0.55,0,3,0.01],
    ["circleLightness","원 색상","명도 이동 (L)",-0.15,-1,1,0.01],
    ["shieldHue","충돌 링 색상","색상 이동 (H)",79,-180,180,1],
    ["shieldSaturation","충돌 링 색상","채도 배율 (S)",1,0,3,0.01],
    ["shieldLightness","충돌 링 색상","명도 이동 (L)",0,-1,1,0.01],
    ["backlightIntensity","보라색 역광","역광 강도",0.78,0,1,0.01],
    ["backlightWidth","보라색 역광","안쪽 그라데이션 폭",0.55,0.01,1,0.01],
    ["backlightFalloff","보라색 역광","그라데이션 감쇠",1.1,0.2,6,0.01],
    ["backlightBackdropMix","보라색 역광","배경색 반영",0.2,0,1,0.01],
    ["rayBackgroundIntensity","충돌 레이 레이어","뒤쪽 레이 강도",0.45,0,1,0.01],
    ["rayForegroundIntensity","충돌 레이 레이어","앞쪽 레이 강도",0.2,0,3,0.01],
    ["rayForegroundWidth","충돌 레이 레이어","앞쪽 레이 폭",0.55,0.05,1,0.01],
    ["rayForegroundSoftness","충돌 레이 레이어","앞쪽 가장자리 부드러움",0.2,0.02,0.5,0.01],
    ["rayForegroundLength","충돌 레이 레이어","앞쪽 레이 길이 배율",0.7,0.25,2,0.01],
    ["rayForegroundHighlight","충돌 레이 레이어","앞쪽 밝은색 혼합",0.7,0,1,0.01],
    ["rayAttack","충돌 레이 레이어","점등 시간 비율",0.1,0.02,0.5,0.01],
    ["coreIntensity","내부 발광","푸른 내부광 강도",0.75,0,2,0.01],
    ["coreX","내부 발광","광원 위치 X",-0.22,-1,1,0.01],
    ["coreY","내부 발광","광원 위치 Y",-0.35,-1,1,0.01],
    ["coreWidth","내부 발광","광원 가로 폭",0.75,0.05,1.5,0.01],
    ["coreHeight","내부 발광","광원 세로 폭",0.68,0.05,1.5,0.01],
    ["coreRed","내부 발광","빨강",0.26,0,1,0.01],
    ["coreGreen","내부 발광","초록",0.64,0,1,0.01],
    ["coreBlue","내부 발광","파랑",1,0,1,0.01],
    ["backlightAngle","보라색 역광","역광 방향",0.2,-3.14,3.14,0.01],
    ["backlightFocus","보라색 역광","방향 집중도",3.2,0.5,8,0.1],
    ["backlightAmbient","보라색 역광","반대편 빛 비율",0.08,0,1,0.01],
    ["backlightEmission","보라색 역광","가장자리 발광",1.15,0,2,0.01],
    ["backlightRimWidth","보라색 역광","발광 림 폭",0.045,0.005,0.3,0.005],
    ["glowDirectionality","아우라","역광 방향 반영",0.6,0,1,0.01],
    ["surfaceSheenX","넓은 반사광","위치 X",-0.23,-1,1,0.01],
    ["surfaceSheenY","넓은 반사광","위치 Y",-0.44,-1,1,0.01],
    ["surfaceSheenWidth","넓은 반사광","가로 폭",0.62,0.02,1,0.01],
    ["surfaceSheenHeight","넓은 반사광","세로 폭",0.13,0.01,0.5,0.01],
    ["surfaceSheenRotation","넓은 반사광","회전",-0.35,-3.14,3.14,0.01],
    ["surfaceSheenIntensity","넓은 반사광","강도",0.24,0,1,0.01],
    ["volumeDensity","유리 내부","안개 밀도",2,0,4,0.01],
    ["volumeTexture","유리 내부","내부 결 대비",0.68,0,1,0.01],
    ["volumeScale","유리 내부","내부 결 크기",3.9,1,8,0.1],
    ["volumeWarp","유리 내부","내부 결 왜곡",0.45,0,1,0.01],
    ["volumeMotion","유리 내부","내부 움직임",0.12,0,0.5,0.01],
    ["volumeEmission","유리 내부","깊이 발광",1.7,0,4,0.01],
    ["volumeAbsorption","유리 내부","깊이 흡수",1.1,0,3,0.01],
    ["fresnelPower","유리 코팅","가장자리 반사 감쇠",2.8,0.5,8,0.1],
    ["fresnelIntensity","유리 코팅","가장자리 반사 강도",0.38,0,1,0.01],
    ["coatThickness","유리 코팅","유리 두께",0.13,0.02,0.4,0.01],
    ["coatShadow","유리 코팅","유리 내부 음영",0.32,0,1,0.01],
    ["coatCaustic","유리 코팅","가장자리 집광",0.42,0,1,0.01],
].map(([id, group, label, defaultValue, min, max, step], index) =>
    Object.freeze({ id, group, label, defaultValue, min, max, step, index })));
const byId = new Map(TITLE_SHADER_SETTINGS.map(setting => [setting.id, setting]));
// Apply the approved glass/aura art direction once to pre-preset saves. Later slider edits win.
export const TITLE_SHADER_PRESET_VERSION = 2;
const GLASS_PRESET_IDS = Object.freeze([
    'glowStrength', 'glassStrength', 'brightnessBoost', 'backdropBlur', 'backdropBlend', 'refraction',
    'pulseSizeAmount', 'pulseBase', 'pulseAmount', 'auraWidth', 'auraIntensity',
    'solarWidth', 'solarIntensity', 'solarRayIntensity', 'bodyAmbient', 'bodyNormal', 'lowerDepth',
    'highlightX', 'highlightY', 'highlightWidth', 'highlightHeight', 'highlightRotation', 'highlightIntensity',
    'outlineAlpha', 'circleHue', 'circleSaturation', 'circleLightness',
    'backlightIntensity', 'backlightWidth', 'backlightFalloff', 'backlightBackdropMix',
    'rayBackgroundIntensity', 'rayForegroundIntensity', 'rayForegroundWidth',
    'rayForegroundSoftness', 'rayForegroundLength', 'rayForegroundHighlight'
]);
const values = Object.fromEntries(TITLE_SHADER_SETTINGS.map(s => [s.id, s.defaultValue]));
const paletteOffset = Math.ceil(TITLE_SHADER_SETTINGS.length / 4) * 4;
export const TITLE_TUNING_VEC4_COUNT = paletteOffset / 4 + 4;
const uniformValues = new Float32Array(TITLE_TUNING_VEC4_COUNT * 4);
let revision = 0;
let uploadedRevision = -1;
const colorCache = new WeakMap();
const lightColors = [[.72, .36, .96], [.98, .76, 1], [.76, .40, 1], [1, .86, 1]];
let persistSettings = null;
let savedRevision = 0;
let pendingSave = Promise.resolve();

/** SaveSystem supplies the existing settings repository; rendering never owns file I/O. */
export function initializeTitleShaderSettings(saved, persist) {
    resetTitleShaderSettings();
    const savedPreset = Number.isSafeInteger(saved?.__presetVersion) ? saved.__presetVersion : 0;
    const needsPreset = savedPreset < TITLE_SHADER_PRESET_VERSION;
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        for (const setting of TITLE_SHADER_SETTINGS) {
            if (Object.hasOwn(saved, setting.id)) setTitleShaderSetting(setting.id, saved[setting.id]);
        }
        if (savedPreset < 1) {
            for (const id of GLASS_PRESET_IDS) setTitleShaderSetting(id, byId.get(id).defaultValue);
        }
        // Volume revision only retints the internal blue; keep all v1 user lighting edits.
        if (savedPreset < 2) setTitleShaderSetting('coreGreen', byId.get('coreGreen').defaultValue);
    }
    persistSettings = persist;
    savedRevision = needsPreset ? revision - 1 : revision;
}

/** Save raw committed slider values, and flush any last preview during app shutdown. */
export function saveTitleShaderSettings() {
    if (!persistSettings || revision === savedRevision) return pendingSave;
    const snapshot = { ...values, __presetVersion: TITLE_SHADER_PRESET_VERSION };
    const snapshotRevision = revision;
    const persist = persistSettings;
    pendingSave = pendingSave.catch(() => {}).then(() => persist(snapshot)).then(() => {
        savedRevision = snapshotRevision;
    });
    return pendingSave;
}

export function getTitleShaderSetting(id) { return values[id]; }
export function setTitleShaderSetting(id, value) {
    const setting = byId.get(id);
    if (!setting || !Number.isFinite(value)) return false;
    const clamped = Math.max(setting.min, Math.min(setting.max, value));
    const quantized = Number((setting.min + Math.round((clamped - setting.min) / setting.step) * setting.step).toFixed(6));
    const next = Math.max(setting.min, Math.min(setting.max, quantized));
    if (values[id] === next) return false;
    values[id] = next;
    revision++;
    return true;
}
export function resetTitleShaderSettings() {
    for (const setting of TITLE_SHADER_SETTINGS) values[setting.id] = setting.defaultValue;
    revision++;
}

/** Preserve theme color identity until either its source or tuning changes. */
export function tuneTitleShaderColor(source, prefix) {
    const hue = values[prefix + 'Hue'];
    const saturation = values[prefix + 'Saturation'];
    const lightness = values[prefix + 'Lightness'];
    if (hue === 0 && saturation === 1 && lightness === 0) return source;
    let entries = colorCache.get(source);
    if (!entries) { entries = new Map(); colorCache.set(source, entries); }
    let entry = entries.get(prefix);
    if (entry?.revision === revision) return entry.color;
    const [h, s, l] = rgbToHsl(source);
    entry = { revision, color: hslToRgb(h + hue, s * saturation, l + lightness) };
    entries.set(prefix, entry);
    return entry.color;
}

/** Called by both backends; no allocations or color conversion on unchanged frames. */
export function getTitleShaderUniforms() {
    if (uploadedRevision !== revision) {
        for (const setting of TITLE_SHADER_SETTINGS) uniformValues[setting.index] = values[setting.id];
        for (let i = 0; i < lightColors.length; i++) {
            uniformValues.set(tuneTitleShaderColor(lightColors[i], i < 2 ? 'aura' : 'ray'), paletteOffset + i * 4);
        }
        uploadedRevision = revision;
    }
    return uniformValues;
}
function uniformReference(id, prefix) {
    const setting = byId.get(id);
    if (!setting) throw new Error('Unknown title shader setting: ' + id);
    return prefix + '[' + Math.floor(setting.index / 4) + '].' + 'xyzw'[setting.index % 4];
}
export function tuningWgsl(id) { return uniformReference(id, 'parameters.tuning'); }
export function tuningGlsl(id) { return uniformReference(id, 'u_tuning'); }
