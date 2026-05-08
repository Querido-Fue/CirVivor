/**
 * magneticShield effect renderer에 전달할 렌더 명령을 생성합니다.
 * @param {object} state - 실드 렌더 상태입니다.
 * @param {number} state.centerX - 실드 중심 X 좌표입니다.
 * @param {number} state.centerY - 실드 중심 Y 좌표입니다.
 * @param {number} state.radius - 실드 반경입니다.
 * @param {number} state.time - 실드 애니메이션 시간입니다.
 * @param {Array<object>} state.impacts - 충돌 플래시 상태 목록입니다.
 * @param {Array<object>} state.dents - 눌림 왜곡 상태 목록입니다.
 * @param {TitleShieldConfig} state.config - 실드 렌더 설정입니다.
 * @returns {object} effect 레이어 렌더 명령입니다.
 */
export function buildTitleShieldRenderCommand({
    centerX,
    centerY,
    radius,
    time,
    impacts,
    dents,
    config
}) {
    const shieldColors = config.getColors();

    return {
        effectType: 'magneticShield',
        x: centerX,
        y: centerY,
        radius,
        fieldRadius: config.getFieldRadius(radius),
        time,
        alpha: config.getBaseAlpha(),
        ringThickness: config.getRingThickness(),
        glowWidth: config.getGlowWidth(),
        shadowColor: shieldColors.shadow,
        lowColor: shieldColors.low,
        highColor: shieldColors.high,
        highlightColor: shieldColors.highlight,
        impacts: buildTitleShieldImpactRenderData(impacts),
        dents: buildTitleShieldDentRenderData(dents)
    };
}

/**
 * 내부 impact 상태를 shader 입력 형식으로 변환합니다.
 * @param {Array<object>} impacts - 충돌 플래시 상태 목록입니다.
 * @returns {Array<object>} 렌더러용 impact 목록입니다.
 */
export function buildTitleShieldImpactRenderData(impacts) {
    return impacts.map((impact) => ({
        angle: impact.angle,
        intensity: impact.intensity,
        width: impact.width,
        progress: impact.age / Math.max(0.0001, impact.duration)
    }));
}

/**
 * 내부 dent 상태를 shader 입력 형식으로 변환합니다.
 * @param {Array<object>} dents - 눌림 왜곡 상태 목록입니다.
 * @returns {Array<object>} 렌더러용 dent 목록입니다.
 */
export function buildTitleShieldDentRenderData(dents) {
    return dents.map((dent) => ({
        angle: dent.angle,
        depth: dent.depth,
        width: dent.width,
        strength: dent.strength
    }));
}
