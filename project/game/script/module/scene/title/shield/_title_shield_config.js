import { ColorSchemes } from 'display/_theme_handler.js';
import { getData } from 'data/data_handler.js';
import { colorUtil } from 'util/color_util.js';
import { clamp01, clampNumber } from 'util/number_util.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');
const DEFAULT_TITLE_SHIELD_CONFIG = TITLE_CONSTANTS.TITLE_SHIELD || Object.freeze({});
const DEFAULT_MAGNETIC_SHIELD_COLORS = DEFAULT_TITLE_SHIELD_CONFIG.MAGNETIC_SHIELD_COLORS;
const THEME_SHIELD_PATHS = Object.freeze({
    shadow: Object.freeze(['Title', 'Shield', 'Shadow']),
    low: Object.freeze(['Title', 'Shield', 'Low']),
    high: Object.freeze(['Title', 'Shield', 'High']),
    highlight: Object.freeze(['Title', 'Shield', 'Highlight'])
});

/**
 * @class TitleShieldConfig
 * @description 타이틀 실드 이펙트의 테마 색상과 수치 설정을 해석합니다.
 */
export class TitleShieldConfig {
    /**
     * @param {object} [config=DEFAULT_TITLE_SHIELD_CONFIG] - 타이틀 실드 설정 객체입니다.
     */
    constructor(config = DEFAULT_TITLE_SHIELD_CONFIG) {
        this.config = config || Object.freeze({});
    }

    /**
     * 실드 색상 설정을 반환합니다.
     * @returns {{shadow: number[], low: number[], high: number[], highlight: number[]}} 실드 색상 벡터입니다.
     */
    getColors() {
        const shadow = this.#colorToVec3(this.#getThemeValue(THEME_SHIELD_PATHS.shadow), DEFAULT_MAGNETIC_SHIELD_COLORS.shadow);
        const low = this.#colorToVec3(this.#getThemeValue(THEME_SHIELD_PATHS.low), DEFAULT_MAGNETIC_SHIELD_COLORS.low);
        const high = this.#colorToVec3(this.#getThemeValue(THEME_SHIELD_PATHS.high), DEFAULT_MAGNETIC_SHIELD_COLORS.high);
        const highlight = this.#colorToVec3(this.#getThemeValue(THEME_SHIELD_PATHS.highlight), DEFAULT_MAGNETIC_SHIELD_COLORS.highlight);

        return {
            shadow,
            low,
            high,
            highlight
        };
    }

    /**
     * @returns {number} 실드 기본 알파 값입니다.
     */
    getBaseAlpha() {
        return Number.isFinite(this.config.BASE_ALPHA) ? this.config.BASE_ALPHA : 1;
    }

    /**
     * @returns {number} 실드 링 두께입니다.
     */
    getRingThickness() {
        return Number.isFinite(this.config.RING_THICKNESS_PX) ? this.config.RING_THICKNESS_PX : 7;
    }

    /**
     * @returns {number} 실드 glow 폭입니다.
     */
    getGlowWidth() {
        return Number.isFinite(this.config.GLOW_WIDTH_PX) ? this.config.GLOW_WIDTH_PX : 26;
    }

    /**
     * @returns {number} 원 본체 대비 실드 반경 배율입니다.
     */
    getShellRadiusMultiplier() {
        return Number.isFinite(this.config.SHELL_RADIUS_MULTIPLIER)
            ? Math.max(1, this.config.SHELL_RADIUS_MULTIPLIER)
            : 2;
    }

    /**
     * 외곽 자기장 필드가 퍼질 최대 반경을 계산합니다.
     * @param {number} radius - 현재 실드 반경입니다.
     * @returns {number} field 반경입니다.
     */
    getFieldRadius(radius) {
        const multiplier = Number.isFinite(this.config.FIELD_RADIUS_MULTIPLIER)
            ? this.config.FIELD_RADIUS_MULTIPLIER
            : 1;
        return Math.max(radius, radius * Math.max(1, multiplier));
    }

    /**
     * @returns {number} 충돌 이벤트 유지 시간입니다.
     */
    getImpactDuration() {
        return Number.isFinite(this.config.IMPACT_DURATION_SECONDS) ? this.config.IMPACT_DURATION_SECONDS : 0.42;
    }

    /**
     * @returns {number} 충돌 밴드 두께입니다.
     */
    getImpactBandPx() {
        return Number.isFinite(this.config.IMPACT_BAND_PX) ? this.config.IMPACT_BAND_PX : 18;
    }

    /**
     * @returns {number} 접촉 완충 영역입니다.
     */
    getContactPaddingPx() {
        return Number.isFinite(this.config.CONTACT_PADDING_PX) ? this.config.CONTACT_PADDING_PX : 10;
    }

    /**
     * @returns {number} 눌림 왜곡 영향 거리입니다.
     */
    getPressureInfluencePx() {
        return Number.isFinite(this.config.PRESSURE_INFLUENCE_PX) ? this.config.PRESSURE_INFLUENCE_PX : 54;
    }

    /**
     * @returns {number} 실드 시각 반응이 시작될 거리 배율입니다.
     */
    getVisualTriggerDistanceMultiplier() {
        return Number.isFinite(this.config.VISUAL_TRIGGER_DISTANCE_MULTIPLIER)
            ? Math.max(1, this.config.VISUAL_TRIGGER_DISTANCE_MULTIPLIER)
            : 1.2;
    }

    /**
     * @returns {number} 눌림 압력 추종 속도입니다.
     */
    getPressureFollowRate() {
        return Number.isFinite(this.config.PRESSURE_FOLLOW_RATE) ? this.config.PRESSURE_FOLLOW_RATE : 12;
    }

    /**
     * @returns {number} 눌림 압력이 줄어들 때의 추종 속도입니다.
     */
    getPressureReleaseFollowRate() {
        return Number.isFinite(this.config.PRESSURE_RELEASE_FOLLOW_RATE)
            ? Math.max(0.0001, this.config.PRESSURE_RELEASE_FOLLOW_RATE)
            : 5.5;
    }

    /**
     * 시각 보간에 사용할 안전한 경과 시간을 반환합니다.
     * @param {number} delta - 원본 프레임 경과 시간입니다.
     * @returns {number} 시각 보간용 경과 시간입니다.
     */
    getVisualDelta(delta) {
        if (!Number.isFinite(delta) || delta <= 0) {
            return 0;
        }

        return Math.min(delta, this.getVisualDeltaClampSeconds());
    }

    /**
     * @returns {number} 최대 눌림 깊이입니다.
     */
    getMaxDepthPx() {
        return Number.isFinite(this.config.PRESSURE_MAX_DEPTH_PX) ? this.config.PRESSURE_MAX_DEPTH_PX : 18;
    }

    /**
     * @returns {number} 최소 충돌 강도입니다.
     */
    getImpactIntensityMin() {
        return Number.isFinite(this.config.IMPACT_INTENSITY_MIN) ? this.config.IMPACT_INTENSITY_MIN : 0.45;
    }

    /**
     * @returns {number} 최대 충돌 강도입니다.
     */
    getImpactIntensityMax() {
        return Number.isFinite(this.config.IMPACT_INTENSITY_MAX) ? this.config.IMPACT_INTENSITY_MAX : 1;
    }

    /**
     * @returns {number} impact 각도 추종 속도입니다.
     */
    getImpactAngleFollowRate() {
        return Number.isFinite(this.config.IMPACT_ANGLE_FOLLOW_RATE)
            ? Math.max(0.0001, this.config.IMPACT_ANGLE_FOLLOW_RATE)
            : 18;
    }

    /**
     * @returns {number} impact 강도 추종 속도입니다.
     */
    getImpactIntensityFollowRate() {
        return Number.isFinite(this.config.IMPACT_INTENSITY_FOLLOW_RATE)
            ? Math.max(0.0001, this.config.IMPACT_INTENSITY_FOLLOW_RATE)
            : 24;
    }

    /**
     * @returns {number} impact 폭 추종 속도입니다.
     */
    getImpactWidthFollowRate() {
        return Number.isFinite(this.config.IMPACT_WIDTH_FOLLOW_RATE)
            ? Math.max(0.0001, this.config.IMPACT_WIDTH_FOLLOW_RATE)
            : 20;
    }

    /**
     * @returns {number} 실드 레이아웃 표시 추종 속도입니다.
     */
    getLayoutFollowRate() {
        return Number.isFinite(this.config.LAYOUT_FOLLOW_RATE)
            ? Math.max(0.0001, this.config.LAYOUT_FOLLOW_RATE)
            : 18;
    }

    /**
     * @returns {number} dent 각도 표시 추종 속도입니다.
     */
    getDentAngleFollowRate() {
        return Number.isFinite(this.config.DENT_ANGLE_FOLLOW_RATE)
            ? Math.max(0.0001, this.config.DENT_ANGLE_FOLLOW_RATE)
            : 14;
    }

    /**
     * @returns {number} 접촉 상태 유지용 히스테리시스 거리입니다.
     */
    getContactHysteresisPx() {
        return Number.isFinite(this.config.CONTACT_HYSTERESIS_PX)
            ? Math.max(0, this.config.CONTACT_HYSTERESIS_PX)
            : 8;
    }

    /**
     * @returns {number} 실드 경계선 일치 구간을 안정화할 epsilon 거리입니다.
     */
    getBoundaryEpsilonPx() {
        return Number.isFinite(this.config.BOUNDARY_EPSILON_PX)
            ? Math.max(0, this.config.BOUNDARY_EPSILON_PX)
            : 4;
    }

    /**
     * @returns {number} dent 후보 교체를 위한 최소 우위 값입니다.
     */
    getDentSwitchBias() {
        return Number.isFinite(this.config.DENT_SWITCH_BIAS)
            ? Math.max(0, this.config.DENT_SWITCH_BIAS)
            : 0.08;
    }

    /**
     * @returns {number} dent 깊이 기준 후보 교체를 위한 최소 우위 값입니다.
     */
    getDentDepthSwitchBias() {
        return Number.isFinite(this.config.DENT_DEPTH_SWITCH_BIAS)
            ? Math.max(0, this.config.DENT_DEPTH_SWITCH_BIAS)
            : Math.max(1.2, this.getMaxDepthPx() * 0.12);
    }

    /**
     * @returns {number} 시각 보간에 허용할 최대 프레임 델타입니다.
     */
    getVisualDeltaClampSeconds() {
        return Number.isFinite(this.config.VISUAL_DELTA_CLAMP_SECONDS)
            ? Math.max(0.0001, this.config.VISUAL_DELTA_CLAMP_SECONDS)
            : (1 / 30);
    }

    /**
     * @returns {number} 최대 impact 개수입니다.
     */
    getImpactMaxCount() {
        return Number.isFinite(this.config.IMPACT_MAX_COUNT) ? Math.max(1, this.config.IMPACT_MAX_COUNT) : 12;
    }

    /**
     * @returns {number} impact 병합에 사용할 최대 각도 차이입니다.
     */
    getImpactMergeAngleThreshold() {
        return Number.isFinite(this.config.IMPACT_MERGE_ANGLE_RAD)
            ? Math.max(0.0001, this.config.IMPACT_MERGE_ANGLE_RAD)
            : 0.22;
    }

    /**
     * @returns {number} impact 교체를 허용할 최소 강도 우위입니다.
     */
    getImpactReplacementBias() {
        return Number.isFinite(this.config.IMPACT_REPLACEMENT_BIAS)
            ? Math.max(0, this.config.IMPACT_REPLACEMENT_BIAS)
            : 0.12;
    }

    /**
     * @returns {number} impact 병합 직후 즉시 반영할 최소 부스트 비율입니다.
     */
    getImpactImmediateBoostRatio() {
        return Number.isFinite(this.config.IMPACT_IMMEDIATE_BOOST_RATIO)
            ? clamp01(this.config.IMPACT_IMMEDIATE_BOOST_RATIO)
            : 0.55;
    }

    /**
     * @returns {number} 최대 dent 개수입니다.
     */
    getDentMaxCount() {
        return Number.isFinite(this.config.DENT_MAX_COUNT) ? Math.max(1, this.config.DENT_MAX_COUNT) : 8;
    }

    /**
     * @returns {number} 충돌 속도 기준값입니다.
     */
    getImpactSpeedReferencePx() {
        return Math.max(1, Number(this.config.IMPACT_SPEED_REFERENCE_PX) || 120);
    }

    /**
     * 적 반경과 실드 반경을 기반으로 각도 폭을 계산합니다.
     * @param {number} enemyRadius - 적 화면 반경입니다.
     * @param {number} shieldRadius - 현재 실드 반경입니다.
     * @returns {number} 각도 폭(rad)입니다.
     */
    buildAngularWidth(enemyRadius, shieldRadius) {
        const padding = Number.isFinite(this.config.ANGULAR_WIDTH_PADDING_PX) ? this.config.ANGULAR_WIDTH_PADDING_PX : 12;
        const widthScale = Number.isFinite(this.config.ANGULAR_WIDTH_SCALE) ? this.config.ANGULAR_WIDTH_SCALE : 1.15;
        const projectedWidth = Math.max(4, enemyRadius + padding);
        const ratio = clampNumber(projectedWidth / Math.max(1, shieldRadius), 0.02, 0.98);
        return Math.asin(ratio) * widthScale;
    }

    /**
     * @private
     * 배열 인덱스로 객체 깊은 경로에 접근합니다.
     * @param {string[]} path - 테마 경로입니다.
     * @param {object} [fallback=null] - 기본값입니다.
     * @returns {string|object|null} 경로 값입니다.
     */
    #getThemeValue(path, fallback = null) {
        let value = ColorSchemes;
        for (const key of path) {
            value = value?.[key];
            if (!value) {
                return fallback;
            }
        }

        return value;
    }

    /**
     * @private
     * 0~1 범위의 색상 벡터를 반환합니다.
     * @param {string} color - css 색상 문자열입니다.
     * @param {Array<number>} fallback - 예비 색상입니다.
     * @returns {Array<number>} 0~1 색상 벡터입니다.
     */
    #colorToVec3(color, fallback = Object.freeze([0, 0, 0])) {
        const colorString = typeof color === 'string' ? color.trim() : null;
        if (!colorString) {
            return fallback;
        }

        const parsed = colorUtil().cssToRgb(colorString);
        if (!parsed || !Number.isFinite(parsed.r) || !Number.isFinite(parsed.g) || !Number.isFinite(parsed.b)) {
            return fallback;
        }

        return Object.freeze([
            clamp01(parsed.r / 255),
            clamp01(parsed.g / 255),
            clamp01(parsed.b / 255)
        ]);
    }
}
