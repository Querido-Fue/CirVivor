/** 모든 hostile ranged source가 공유하는 명시적 fixed-tick start budget입니다. */
export const HOSTILE_ATTACK_RUNTIME_DATA = Object.freeze({
    MAXIMUM_STARTS_PER_FIXED_TICK: 4,
    PRIORITY_CONTROL_REFRESH_INTERVAL_TICKS: 30,
    MAXIMUM_PRIORITY_CONTROL_REFRESHES_PER_FIXED_TICK: 64
});
