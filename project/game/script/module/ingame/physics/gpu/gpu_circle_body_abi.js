import {
    GAMEPLAY_DAMAGE_POLICY_ID,
    GAMEPLAY_DAMAGE_RESOLUTION_POLICY_ID,
    normalizeGameplayDamagePolicyId,
    normalizeGameplayDamageResolutionPolicyId,
    normalizeGameplayTeamId
} from '../../contract/gameplay_team_contract.js';
import {
    ENEMY_ORBIT_SLOT_CAPACITY
} from '../../contract/enemy_orbit_directional_defense_contract.js';
import {
    FORMATION_COORDINATE_SYSTEM_CODE
} from '../../contract/enemy_formation_contract.js';

const UINT8_MAX = 0xff;
const UINT16_MAX = 0xffff;
const INT32_MIN = -0x80000000;
const INT32_MAX = 0x7fffffff;
const UINT32_MAX = 0xffffffff;
const LITTLE_ENDIAN = true;

/**
 * 원본 std430 16/32-byte stride를 유지한 flow/collision host ABI입니다.
 * 숫자는 WGSL 구조체와 DataView packer가 공유하는 단일 offset 권위입니다.
 */
export const GPU_CIRCLE_BODY_ABI = Object.freeze({
    COUNTS: Object.freeze({
        STRIDE: 16,
        BODY_COUNT: 0,
        ADDITION_COUNT: 4,
        REMOVAL_COUNT: 8,
        ABI_VERSION: 12
    }),
    PHYSICS: Object.freeze({
        STRIDE: 32,
        POSITION_X: 0,
        POSITION_Y: 4,
        VELOCITY_X: 8,
        VELOCITY_Y: 12,
        RADIUS: 16,
        INVERSE_MASS: 20,
        PHYSICAL_META: 24,
        INTERACTION_META: 28
    }),
    SIMULATION: Object.freeze({
        STRIDE: 32,
        LIFETIME: 0,
        HEALTH: 4,
        GAMEPLAY_META: 8,
        FLAGS: 12,
        FLOW_FIELD_INDEX: 16,
        FLOW_SPEED: 20,
        ENTITY_ID: 24,
        // 원본 simulation record의 마지막 reserved word를 stable incarnation으로 사용합니다.
        INCARNATION: 28,
        RESERVED_INCARNATION: 28
    }),
    TEMPORARY: Object.freeze({
        STRIDE: 32,
        PREVIOUS_X: 0,
        PREVIOUS_Y: 4,
        PREDICTED_X: 8,
        PREDICTED_Y: 12,
        DELTA_X: 16,
        DELTA_Y: 20,
        GRID_INDEX: 24,
        PREVIOUS_FLOW_FIELD_INDEX: 28
    }),
    GRID_BODY: Object.freeze({
        STRIDE: 32,
        PREDICTED_X: 0,
        PREDICTED_Y: 4,
        PHYSICAL_META: 8,
        FLAGS: 12,
        INVERSE_MASS: 16,
        RADIUS: 20,
        BODY_ID: 24,
        INTERACTION_META: 28
    }),
    CONTACT_HANDLER: Object.freeze({
        STRIDE: 32,
        DAMAGE_SELF: 0,
        DAMAGE_OTHER: 4,
        DAMAGE_FALLOFF: 8,
        FIRE_TIMER: 12,
        FLAGS: 16,
        CHAINING: 20,
        DAMAGE_REPORT_ID: 24,
        SLOW_TIMER: 28
    }),
    /**
     * Contact handler/effect record와 분리된 generic per-body combat state입니다.
     * direct Core impact base damage는 기존 첫 reserved word를 재사용합니다.
     */
    COMBAT_STATE: Object.freeze({
        STRIDE: 40,
        TARGET_INTERACTION_LAYER_MASK: 0,
        MAXIMUM_DAMAGE_WINDOW_DURATION_FIXED_TICKS: 4,
        PEAK_FINAL_DAMAGE_FIXED_POINT: 8,
        EXPIRES_AT_FIXED_TICK: 12,
        PEAK_SOURCE_ENTITY_ID: 16,
        PEAK_SOURCE_INCARNATION: 20,
        DIRECT_CORE_DAMAGE_FIXED_POINT: 24,
        // 이전 ABI consumer가 offset lookup을 유지할 수 있는 layout alias입니다.
        RESERVED_0: 24,
        RESERVED_1: 28,
        RESERVED_2: 32,
        RESERVED_3: 36
    }),
    /**
     * J/C' 전용 atomic-transform persistent side-plane입니다. Contact/Combat/
     * EnemyBehavior와 분리해 기존 program ABI를 이동시키지 않습니다.
     */
    ATOMIC_TRANSFORM_STATE: Object.freeze({
        STRIDE: 48,
        PROGRAM_ID: 0,
        PHASE: 4,
        ENTITY_ID: 8,
        INCARNATION: 12,
        DUE_FIXED_TICK: 16,
        LINEAGE_ROOT_ENTITY_ID: 20,
        LINEAGE_ROOT_INCARNATION: 24,
        BRANCH_INDEX: 28,
        BOUNTY_BUDGET: 32,
        TRIGGER_SOURCE_TICK: 36,
        TRIGGER_SEQUENCE: 40,
        COMMAND_GENERATION: 44
    }),
    /** first-hit deterministic arbitration에만 쓰는 매 tick transient plane입니다. */
    ATOMIC_TRANSFORM_CANDIDATE: Object.freeze({
        STRIDE: 16,
        SOURCE_ENTITY_ID: 0,
        CONTACT_INDEX: 4,
        MATCH_COUNT: 8,
        STATUS: 12
    }),
    /**
     * R/projectile가 양측 exact handle을 보존하는 persistent capture side-plane입니다.
     * session/device/epoch generation은 per-tick runtime header가 소유합니다.
     */
    PROJECTILE_CAPTURE_STATE: Object.freeze({
        STRIDE: 48,
        ROLE_PHASE_PROFILE_POLICY: 0,
        SELF_ENTITY_ID: 4,
        SELF_INCARNATION: 8,
        PEER_BODY_SLOT: 12,
        PEER_ENTITY_ID: 16,
        PEER_INCARNATION: 20,
        CAPTURED_AT_FIXED_TICK: 24,
        RELEASE_DUE_FIXED_TICK: 28,
        CAPTURE_SEQUENCE: 32,
        CAPTURED_SPEED: 36,
        FACING_X: 40,
        FACING_Y: 44
    }),
    /** one-slot mutual-min arbitration의 per-body transient peer record입니다. */
    PROJECTILE_CAPTURE_CANDIDATE: Object.freeze({
        STRIDE: 16,
        DISTANCE_SQUARED_BITS: 0,
        PEER_ENTITY_ID: 4,
        PEER_INCARNATION: 8,
        STATUS: 12
    }),
    /**
     * Enemy behavior 전용 mutable/config side-plane입니다. CombatState reserved와
     * 분리하며 program 0인 slot은 전체 zero record를 유지합니다.
     */
    ENEMY_BEHAVIOR_STATE: Object.freeze({
        STRIDE: 80,
        PROGRAM_ID: 0,
        STATE: 4,
        STATE_ENTERED_FIXED_TICK: 8,
        STATE_EXPIRES_AT_FIXED_TICK: 12,
        TARGET_SLOT: 16,
        TARGET_ENTITY_ID: 20,
        TARGET_INCARNATION: 24,
        FLAGS: 28,
        CHARGE_DIRECTION_X: 32,
        CHARGE_DIRECTION_Y: 36,
        WINDUP_RANGE: 40,
        CHARGE_SPEED: 44,
        RECOIL_IMPULSE: 48,
        WINDUP_TICKS: 52,
        CHARGE_MAX_TICKS: 56,
        RECOIL_TICKS: 60,
        RECOVER_TICKS: 64,
        TELEGRAPH_STYLE_CODE: 68,
        TELEGRAPH_COLOR_RGBA8: 72,
        TELEGRAPH_RADIUS_SCALE: 76
    }),
    /**
     * presentation 전용 32-byte storage layout입니다. 물리/시뮬레이션 ABI와
     * 분리되지만 host writer와 render WGSL이 이 offset을 함께 사용합니다.
     */
    RENDER_STYLE: Object.freeze({
        STRIDE: 32,
        COLOR_RED: 0,
        COLOR_GREEN: 4,
        COLOR_BLUE: 8,
        COLOR_ALPHA: 12,
        RADIUS_SCALE: 16,
        VISIBLE: 20,
        SHAPE_CODE: 24,
        RESERVED: 28
    }),
    APPLIED_EVENT: Object.freeze({
        STRIDE: 32,
        SUBJECT_ENTITY_ID: 0,
        SUBJECT_INCARNATION: 4,
        OTHER_ENTITY_ID: 8,
        OTHER_INCARNATION: 12,
        VALUE_FIXED_POINT: 16,
        EVENT_META: 20,
        WORLD_POSITION_X: 24,
        WORLD_POSITION_Y: 28
    }),
    DEATH_EVENT: Object.freeze({
        STRIDE: 16,
        ENTITY_ID: 0,
        INCARNATION: 4,
        BODY_ID: 8,
        REASON_FLAGS: 12
    })
});

/** Host buffer header와 모든 WGSL module이 공유하는 session 단위 ABI version입니다. */
export const GPU_CIRCLE_BODY_ABI_VERSION = 8;

/**
 * GPU circle body presentation의 분석형 silhouette 코드입니다.
 * 0은 일반 body/projectile의 기존 circle presentation 호환값입니다.
 */
export const GPU_CIRCLE_BODY_RENDER_SHAPE = Object.freeze({
    CIRCLE: 0,
    SQUARE: 1,
    TRIANGLE: 2,
    ARROW: 3,
    PENTA: 4,
    HEXA: 5,
    GEN: 6,
    RHOM: 7,
    OCTA: 8,
    RING: 9,
    JORANG: 10,
    CORK: 11
});

export const GPU_CIRCLE_BODY_SIMULATION_FLAG = Object.freeze({
    ALIVE: 1 << 0,
    USE_FLOW: 1 << 1,
    COUNT_AS_KILL: 1 << 2,
    EXPLODE_ON_DEATH: 1 << 3,
    GOLDEN: 1 << 4,
    PROJECTILE_CAPTURED: 1 << 5,
    INTERACTION_ENTER_ONLY: 1 << 8,
    INTERACTION_CONTINUOUS: 1 << 9,
    CONTROLLED_THIS_TICK: 1 << 16,
    EXTERNAL_MOTION_OWNER_THIS_TICK: 1 << 17
});

export const GPU_CIRCLE_BODY_META = Object.freeze({
    FIELD_MASK: UINT16_MAX,
    BODY_LAYER_SHIFT: 0,
    COLLISION_MASK_SHIFT: 16,
    INTERACTION_LAYER_SHIFT: 0,
    INTERACTION_MASK_SHIFT: 16,
    SIMULATION_FLAGS_SHIFT: 0,
    ALIVE_FLAG: GPU_CIRCLE_BODY_SIMULATION_FLAG.ALIVE,
    USE_FLOW_FLAG: GPU_CIRCLE_BODY_SIMULATION_FLAG.USE_FLOW,
    COUNT_AS_KILL_FLAG: GPU_CIRCLE_BODY_SIMULATION_FLAG.COUNT_AS_KILL,
    EXPLODE_ON_DEATH_FLAG: GPU_CIRCLE_BODY_SIMULATION_FLAG.EXPLODE_ON_DEATH,
    GOLDEN_FLAG: GPU_CIRCLE_BODY_SIMULATION_FLAG.GOLDEN,
    PROJECTILE_CAPTURED_FLAG:
        GPU_CIRCLE_BODY_SIMULATION_FLAG.PROJECTILE_CAPTURED,
    IS_GOLDEN_FLAG: GPU_CIRCLE_BODY_SIMULATION_FLAG.GOLDEN,
    ALIVE_BIT: GPU_CIRCLE_BODY_SIMULATION_FLAG.ALIVE,
    USE_FLOW_BIT: GPU_CIRCLE_BODY_SIMULATION_FLAG.USE_FLOW,
    COUNT_AS_KILL_BIT: GPU_CIRCLE_BODY_SIMULATION_FLAG.COUNT_AS_KILL,
    EXPLODE_ON_DEATH_BIT: GPU_CIRCLE_BODY_SIMULATION_FLAG.EXPLODE_ON_DEATH,
    GOLDEN_BIT: GPU_CIRCLE_BODY_SIMULATION_FLAG.GOLDEN,
    PROJECTILE_CAPTURED_BIT:
        GPU_CIRCLE_BODY_SIMULATION_FLAG.PROJECTILE_CAPTURED
});

export const GPU_PROJECTILE_CAPTURE_ROLE = Object.freeze({
    NONE: 0,
    CAPTOR: 1,
    PROJECTILE: 2
});

export const GPU_PROJECTILE_CAPTURE_PHASE = Object.freeze({
    IDLE: 0,
    HELD: 1,
    RELEASE_PREPARED: 2,
    TOMBSTONED: 3
});

export const GPU_PROJECTILE_CAPTURE_POLICY_CODE = Object.freeze({
    NOT_CAPTURABLE: 0,
    CAPTURABLE: 1
});

export const GPU_PROJECTILE_CAPTURE_STATE_META = Object.freeze({
    ROLE_SHIFT: 0,
    ROLE_MASK: 0x00000003,
    PHASE_SHIFT: 2,
    PHASE_MASK: 0x0000000c,
    PROFILE_SHIFT: 4,
    PROFILE_MASK: 0x00000ff0,
    POLICY_SHIFT: 12,
    POLICY_MASK: 0x00003000,
    FLAGS_SHIFT: 16,
    FLAGS_MASK: 0xffff0000
});

/** BodySimulation +8의 team/damage-policy packed gameplay word입니다. */
export const GPU_CIRCLE_BODY_GAMEPLAY_META = Object.freeze({
    TEAM_SHIFT: 0,
    TEAM_MASK: UINT8_MAX,
    DAMAGE_POLICY_SHIFT: 8,
    DAMAGE_POLICY_MASK: UINT8_MAX,
    DAMAGE_RESOLUTION_POLICY_SHIFT: 16,
    DAMAGE_RESOLUTION_POLICY_MASK: UINT8_MAX,
    RESERVED_MASK: 0xff000000
});

/**
 * 추출한 GPU collision protocol의 layer bit입니다.
 * legacy CPU CollisionHandler의 숫자와 호환되는 값이 아니므로 서로 섞지 않습니다.
 */
export const GPU_CIRCLE_BODY_LAYER = Object.freeze({
    ENEMY: 1 << 0,
    PROJECTILE: 1 << 1,
    EXPLOSION: 1 << 2,
    EFFECT: 1 << 3,
    FLAME: 1 << 4,
    GRENADE: 1 << 5,
    KINEMATIC_OBSTACLE: 1 << 6,
    LAYER_7: 1 << 6,
    TERRAIN: 1 << 7,
    // Core interaction acceptance capability입니다. gameplay noun은 kindId/definitionId에 남고
    // 이 bit는 physical bodyLayer/collisionMask에 사용하지 않습니다.
    CORE_PROXY: 1 << 8,
    // Team/kind/physical obstacle과 분리된 player actor damage-candidate capability입니다.
    PLAYER_DAMAGEABLE: 1 << 9,
    // Z route closure가 완전히 확장된 뒤에만 활성화하는 물리 blocker capability입니다.
    ROUTE_BLOCKER: 1 << 10
});

/** Gameplay interaction target-layer vocabulary의 명시적인 public 이름입니다. */
export const GPU_CIRCLE_BODY_INTERACTION_LAYER = GPU_CIRCLE_BODY_LAYER;

/** 기존 enemy-only import 이름을 유지하는 호환 alias입니다. */
export const GPU_CIRCLE_BODY_COLLISION_LAYER = GPU_CIRCLE_BODY_LAYER;

export const GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG = Object.freeze({
    KILL_IF_OTHER_TERRAIN: 1 << 0,
    CLOSEST_ONLY: 1 << 1,
    SLOW: 1 << 2,
    INTERACTION_ENTER_ONLY: 1 << 3,
    INTERACTION_CONTINUOUS: 1 << 4,
    /** Typed CPU Core damage request를 만드는 hostile projectile handler입니다. */
    CORE_DAMAGE_REQUEST: 1 << 5
});

export const GPU_CIRCLE_APPLIED_EVENT_TYPE = Object.freeze({
    DAMAGE_APPLIED: 1,
    INTERACTION_ENTER: 2,
    INTERACTION_CONTINUOUS: 3,
    ENEMY_CHARGE_WINDUP_STARTED: 4,
    ENEMY_CHARGE_CONTACT_RECOIL_STARTED: 5,
    CORE_DAMAGE_REQUEST: 6,
    ROUTE_ASSIGNED: 7,
    ROUTE_CLOSED: 8,
    ROUTE_REOPENED: 9,
    ROUTE_CLEANED: 10
});

export const GPU_CIRCLE_APPLIED_EVENT_META = Object.freeze({
    TYPE_MASK: UINT8_MAX,
    FLAGS_MASK: 0xffffff00
});

export const GPU_CIRCLE_APPLIED_EVENT_FLAG = Object.freeze({
    TARGET_DIED: 1 << 8,
    TERRAIN_KILL: 1 << 9,
    ENTER_POLICY: 1 << 10,
    CONTINUOUS_POLICY: 1 << 11,
    TERRAIN_CONTACT: 1 << 12,
    /** Maximum Damage Window winner; value 0은 억제된 valid winner의 actual HP delta입니다. */
    MAXIMUM_DAMAGE_WINDOW: 1 << 13,
    /** Directional flat defense가 이 valid hit의 final damage를 줄였습니다. */
    DIRECTIONAL_DEFENSE: 1 << 14,
    /** J의 첫 valid damaging hit가 budget을 소비하고 damage 0으로 split을 arm했습니다. */
    ATOMIC_TRANSFORM_TRIGGER_FIRST_HIT: 1 << 15
});

/** 독립 atomic-transform side-plane의 append-only program vocabulary입니다. */
export const GPU_CIRCLE_ATOMIC_TRANSFORM_PROGRAM = Object.freeze({
    NONE: 0,
    J_SPLIT_FIRST_HIT: 1,
    C_PRIME_DELAYED_RECOMBINE: 2
});

/** Program-discriminated per-body phase입니다. */
export const GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE = Object.freeze({
    NONE: 0,
    ARMED: 1,
    SPLIT_PENDING: 2,
    CHILD_DELAYED: 3,
    TRANSFORM_ARMED: 4
});

export const GPU_CIRCLE_ATOMIC_TRANSFORM_CANDIDATE_STATUS = Object.freeze({
    OK: 0,
    SELECTED_RANK_BASE: 1,
    DUPLICATE_EXACT_CONTACT: 1 << 8,
    EVENT_CAPACITY_EXCEEDED: 1 << 9,
    SOURCE_BUDGET_RESERVATION_FAILED: 1 << 10,
    PHASE_COMPARE_EXCHANGE_FAILED: 1 << 11
});

export const GPU_CIRCLE_BODY_FIXED_POINT = Object.freeze({
    HEALTH_SCALE: 100
});

export const GPU_CIRCLE_BODY_LIFETIME = Object.freeze({
    IMMORTAL: -1
});

/** GPU behavior side-plane의 append-only basic behavior program vocabulary입니다. */
export const GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM = Object.freeze({
    NONE: 0,
    ARROW_TOWER_CHARGE: 1,
    /** GPU-selected Rhom projectile의 exact target/core damage runtime state입니다. */
    SELECTED_TARGET_PROJECTILE: 2,
    /** Exact Tower 중심의 tidal-locked eight-slot orbit입니다. */
    OCTAGON_TOWER_ORBIT: 3
});

export const GPU_CIRCLE_ENEMY_BEHAVIOR_STATE = Object.freeze({
    NONE: 0,
    SEEK_TOWER: 1,
    WINDUP: 2,
    CHARGE: 3,
    CONTACT_RECOIL: 4,
    RECOVER: 5,
    CORE_FALLBACK: 6,
    ORBIT_TOWER: 7
});

export const GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG = Object.freeze({
    TARGET_VALID: 1 << 0,
    TELEGRAPH_PENDING: 1 << 1,
    RECOIL_PENDING: 1 << 2,
    SELECTED_TARGET_VALID: 1 << 3,
    SELECTED_TARGET_CORE: 1 << 4,
    SELECTED_TARGET_TOWER: 1 << 5,
    DIRECTIONAL_DEFENSE_ACTIVE: 1 << 6
});

/**
 * 80-byte behavior side-plane의 program 3 overlay입니다. 기존 Arrow/program 2
 * byte를 이동하지 않으며 facing +32/+36은 orbit/render/defense의 단일 권위입니다.
 */
export const GPU_CIRCLE_OCTAGON_ORBIT_STATE_ABI = Object.freeze({
    STRIDE: GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.STRIDE,
    PROGRAM_ID: GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.PROGRAM_ID,
    STATE: GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.STATE,
    STATE_ENTERED_FIXED_TICK:
        GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.STATE_ENTERED_FIXED_TICK,
    STATE_EXPIRES_AT_FIXED_TICK:
        GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.STATE_EXPIRES_AT_FIXED_TICK,
    TARGET_SLOT: GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.TARGET_SLOT,
    TARGET_ENTITY_ID: GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.TARGET_ENTITY_ID,
    TARGET_INCARNATION:
        GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.TARGET_INCARNATION,
    FLAGS: GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.FLAGS,
    FACING_X: GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.CHARGE_DIRECTION_X,
    FACING_Y: GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.CHARGE_DIRECTION_Y,
    ORBIT_RADIUS_TILES: GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.WINDUP_RANGE,
    RESERVED_FLOAT_0: GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.CHARGE_SPEED,
    RESERVED_FLOAT_1: GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.RECOIL_IMPULSE,
    COORDINATE_SYSTEM_CODE: GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.WINDUP_TICKS,
    ORBIT_SLOT_INDEX: GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.CHARGE_MAX_TICKS,
    ORBIT_SLOT_CAPACITY: GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.RECOIL_TICKS,
    ANGULAR_STEP_Q32: GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.RECOVER_TICKS,
    FLAT_REDUCTION_FIXED_POINT:
        GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.TELEGRAPH_STYLE_CODE,
    FACET_CONFIG: GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.TELEGRAPH_COLOR_RGBA8,
    ARMORED_FACET_COUNT_SHIFT: 0,
    TOTAL_FACET_COUNT_SHIFT: 16,
    FACET_COUNT_MASK: UINT16_MAX,
    RESERVED_FLOAT_2:
        GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.TELEGRAPH_RADIUS_SCALE
});

/**
 * 80-byte side-plane의 program 2 전용 명명입니다. 기존 Arrow layout을 이동하지
 * 않고 동일 byte를 program-discriminated storage로 사용합니다.
 */
export const GPU_CIRCLE_SELECTED_TARGET_PROJECTILE_STATE_ABI = Object.freeze({
    STRIDE: GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.STRIDE,
    PROGRAM_ID: GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.PROGRAM_ID,
    SELECTED_TARGET_KIND: GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.STATE,
    SELECTION_SOURCE_TICK:
        GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.STATE_ENTERED_FIXED_TICK,
    SELECTION_SEQUENCE:
        GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.STATE_EXPIRES_AT_FIXED_TICK,
    TARGET_SLOT: GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.TARGET_SLOT,
    TARGET_ENTITY_ID: GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.TARGET_ENTITY_ID,
    TARGET_INCARNATION:
        GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.TARGET_INCARNATION,
    FLAGS: GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.FLAGS,
    ATTACK_FINGERPRINT:
        GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.CHARGE_DIRECTION_X,
    CORE_DAMAGE_FIXED_POINT:
        GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.WINDUP_RANGE
});

export const GPU_CIRCLE_BODY_FLOW = Object.freeze({
    INVALID_FIELD_INDEX: UINT32_MAX,
    MAX_FIELD_COUNT: 256
});

export const GPU_CIRCLE_BODY_IDENTITY = Object.freeze({
    INVALID_COMPONENT: UINT32_MAX
});

/**
 * 양의 정수 capacity를 검증합니다.
 * @param {*} capacity - 검사할 capacity입니다.
 * @returns {number} 검증된 capacity입니다.
 */
function requireCapacity(capacity) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0 || capacity > UINT32_MAX) {
        throw new RangeError('GPU circle body capacity는 1 이상 uint32 범위의 정수여야 합니다.');
    }
    return capacity;
}

/**
 * storage slot index를 검증합니다.
 * @param {*} index - 검사할 index입니다.
 * @param {number} capacity - storage capacity입니다.
 * @returns {number} 검증된 index입니다.
 */
function requireSlotIndex(index, capacity) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= capacity) {
        throw new RangeError(`GPU circle body index가 capacity를 벗어났습니다: ${index}/${capacity}`);
    }
    return index;
}

/**
 * 유한한 Float32 값을 검증하고 반올림합니다.
 * @param {*} value - 검사할 값입니다.
 * @param {string} fieldName - 오류에 표시할 필드명입니다.
 * @returns {number} Float32 값입니다.
 */
function requireFloat32(value, fieldName) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) {
        throw new TypeError(`${fieldName}은(는) 유한한 숫자여야 합니다.`);
    }
    const rounded = Math.fround(numberValue);
    if (!Number.isFinite(rounded)) {
        throw new RangeError(`${fieldName}은(는) Float32 범위를 벗어났습니다.`);
    }
    return rounded;
}

/**
 * 0 이상 Float32 값을 검증합니다.
 * @param {*} value - 검사할 값입니다.
 * @param {string} fieldName - 오류에 표시할 필드명입니다.
 * @returns {number} Float32 값입니다.
 */
function requireNonNegativeFloat32(value, fieldName) {
    const numberValue = requireFloat32(value, fieldName);
    if (numberValue < 0) {
        throw new RangeError(`${fieldName}은(는) 0 이상이어야 합니다.`);
    }
    return numberValue;
}

/**
 * 유한 수명을 Float32로 정규화합니다. -1은 immortal sentinel이고 그 외 값은 0 이상입니다.
 * @param {*} value - 초 단위 수명입니다.
 * @param {string} [fieldName='lifetime'] - 오류에 표시할 필드명입니다.
 * @returns {number} -1 또는 0 이상 Float32 값입니다.
 */
export function normalizeGpuCircleBodyLifetime(
    value = GPU_CIRCLE_BODY_LIFETIME.IMMORTAL,
    fieldName = 'lifetime'
) {
    const lifetime = requireFloat32(value, fieldName);
    if (lifetime !== GPU_CIRCLE_BODY_LIFETIME.IMMORTAL && lifetime < 0) {
        throw new RangeError(`${fieldName}은(는) -1(immortal) 또는 0 이상이어야 합니다.`);
    }
    return lifetime;
}

/**
 * signed int32 값을 검증합니다.
 * @param {*} value - 검사할 값입니다.
 * @param {string} fieldName - 오류에 표시할 필드명입니다.
 * @returns {number} int32 값입니다.
 */
function requireInt32(value, fieldName) {
    const numberValue = Number(value);
    if (!Number.isSafeInteger(numberValue)
        || numberValue < INT32_MIN
        || numberValue > INT32_MAX) {
        throw new RangeError(`${fieldName}은(는) int32 범위의 정수여야 합니다.`);
    }
    return numberValue;
}

/**
 * gameplay health/damage 값을 shader atomic용 signed fixed-point int32로 변환합니다.
 * WGSL의 `i32(f32(value) * f32(scale))`와 동일하게 입력과 곱셈 결과를 각각
 * Float32로 반올림한 뒤 0 방향으로 절삭합니다.
 * @param {*} value - 변환할 gameplay 값입니다.
 * @param {*} [scale=100] - 양의 정수 scale입니다.
 * @returns {number} int32 fixed-point 값입니다.
 */
export function encodeGpuCircleBodyFixedPoint(
    value,
    scale = GPU_CIRCLE_BODY_FIXED_POINT.HEALTH_SCALE
) {
    const numberValue = Number(value);
    const scaleValue = Number(scale);
    if (!Number.isFinite(numberValue)) {
        throw new TypeError('fixed-point value는 유한한 숫자여야 합니다.');
    }
    if (!Number.isSafeInteger(scaleValue) || scaleValue <= 0) {
        throw new RangeError('fixed-point scale은 양의 안전한 정수여야 합니다.');
    }
    const floatValue = Math.fround(numberValue);
    const floatScale = Math.fround(scaleValue);
    const scaledFloat = Math.fround(floatValue * floatScale);
    return requireInt32(Math.trunc(scaledFloat), 'fixedPoint');
}

/**
 * shader atomic fixed-point int32를 gameplay 숫자로 복원합니다.
 * @param {*} value - int32 fixed-point 값입니다.
 * @param {*} [scale=100] - encode에 사용한 scale입니다.
 * @returns {number} gameplay 값입니다.
 */
export function decodeGpuCircleBodyFixedPoint(
    value,
    scale = GPU_CIRCLE_BODY_FIXED_POINT.HEALTH_SCALE
) {
    const fixedPoint = requireInt32(value, 'fixedPoint');
    const scaleValue = Number(scale);
    if (!Number.isSafeInteger(scaleValue) || scaleValue <= 0) {
        throw new RangeError('fixed-point scale은 양의 안전한 정수여야 합니다.');
    }
    return fixedPoint / scaleValue;
}

function compareMaximumDamageWindowCandidates(left, right) {
    if (left.finalDamageFixedPoint !== right.finalDamageFixedPoint) {
        return right.finalDamageFixedPoint - left.finalDamageFixedPoint;
    }
    if (left.sourceEntityId !== right.sourceEntityId) {
        return left.sourceEntityId - right.sourceEntityId;
    }
    return left.sourceIncarnation - right.sourceIncarnation;
}

/**
 * GPU commit과 동일한 Maximum Damage Window host oracle입니다. 입력 candidates는 이미
 * raw→source modifier→mitigation→final damage를 통과한 유효 후보만 허용합니다.
 */
export function resolveGpuCircleBodyMaximumDamageWindow(options = {}) {
    const fixedTick = requireUint32(options.fixedTick, 'fixedTick');
    const duration = normalizeGpuCircleBodyMaximumDamageWindowDurationTicks(
        options.maximumDamageWindowDurationTicks,
        'maximumDamageWindowDurationTicks'
    );
    if (duration === 0) {
        throw new RangeError('Maximum Damage Window duration은 1 이상이어야 합니다.');
    }
    let peakFinalDamageFixedPoint = requireInt32(
        options.peakFinalDamageFixedPoint ?? 0,
        'peakFinalDamageFixedPoint'
    );
    if (peakFinalDamageFixedPoint < 0) {
        throw new RangeError('peakFinalDamageFixedPoint는 0 이상이어야 합니다.');
    }
    let expiresAtFixedTick = requireUint32(
        options.expiresAtFixedTick ?? 0,
        'expiresAtFixedTick'
    );
    let peakSourceEntityId = requireUint32(
        options.peakSourceEntityId ?? GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT,
        'peakSourceEntityId'
    );
    let peakSourceIncarnation = requireUint32(
        options.peakSourceIncarnation ?? GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT,
        'peakSourceIncarnation'
    );
    if ((peakSourceEntityId === GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT)
        !== (peakSourceIncarnation === GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT)) {
        throw new RangeError('peak source identity는 모두 valid 또는 모두 invalid여야 합니다.');
    }
    const candidates = options.candidates ?? [];
    if (!Array.isArray(candidates)) {
        throw new TypeError('Maximum Damage Window candidates는 배열이어야 합니다.');
    }
    const validCandidates = candidates.map((candidate, index) => {
        if (!candidate || typeof candidate !== 'object') {
            throw new TypeError(`candidates[${index}]는 객체여야 합니다.`);
        }
        const finalDamageFixedPoint = requireInt32(
            candidate.finalDamageFixedPoint,
            `candidates[${index}].finalDamageFixedPoint`
        );
        if (finalDamageFixedPoint <= 0) {
            throw new RangeError(
                `candidates[${index}].finalDamageFixedPoint는 양의 int32여야 합니다.`
            );
        }
        const sourceEntityId = requireUint32(
            candidate.sourceEntityId,
            `candidates[${index}].sourceEntityId`
        );
        const sourceIncarnation = requireUint32(
            candidate.sourceIncarnation,
            `candidates[${index}].sourceIncarnation`
        );
        if (sourceEntityId === GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT
            || sourceIncarnation === GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT) {
            throw new RangeError(`candidates[${index}] source identity는 valid여야 합니다.`);
        }
        return { finalDamageFixedPoint, sourceEntityId, sourceIncarnation };
    });
    let currentHealthFixedPoint = requireInt32(
        options.currentHealthFixedPoint ?? INT32_MAX,
        'currentHealthFixedPoint'
    );
    if (currentHealthFixedPoint < 0) {
        throw new RangeError('currentHealthFixedPoint는 0 이상이어야 합니다.');
    }

    // T >= expires이면 candidate 유무와 무관하게 stale peak/provenance를 clear합니다.
    if (fixedTick >= expiresAtFixedTick) {
        peakFinalDamageFixedPoint = 0;
        expiresAtFixedTick = 0;
        peakSourceEntityId = GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT;
        peakSourceIncarnation = GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT;
    }
    if (validCandidates.length === 0) {
        return Object.freeze({
            appliedDamageFixedPoint: 0,
            remainingHealthFixedPoint: currentHealthFixedPoint,
            peakFinalDamageFixedPoint,
            expiresAtFixedTick,
            peakSourceEntityId,
            peakSourceIncarnation,
            candidate: null,
            damageAppliedEvent: null
        });
    }
    validCandidates.sort(compareMaximumDamageWindowCandidates);
    const candidate = validCandidates[0];
    const active = expiresAtFixedTick !== 0 && fixedTick < expiresAtFixedTick;
    const resetsWindow = !active
        || candidate.finalDamageFixedPoint > peakFinalDamageFixedPoint;
    if (resetsWindow && fixedTick > UINT32_MAX - duration) {
        throw new RangeError('Maximum Damage Window expiry가 uint32 tick 범위를 초과합니다.');
    }
    if (currentHealthFixedPoint === 0) {
        return Object.freeze({
            appliedDamageFixedPoint: 0,
            remainingHealthFixedPoint: 0,
            peakFinalDamageFixedPoint,
            expiresAtFixedTick,
            peakSourceEntityId,
            peakSourceIncarnation,
            candidate: Object.freeze({ ...candidate }),
            damageAppliedEvent: null
        });
    }
    if (active && candidate.finalDamageFixedPoint <= peakFinalDamageFixedPoint) {
        return Object.freeze({
            appliedDamageFixedPoint: 0,
            remainingHealthFixedPoint: currentHealthFixedPoint,
            peakFinalDamageFixedPoint,
            expiresAtFixedTick,
            peakSourceEntityId,
            peakSourceIncarnation,
            candidate: Object.freeze({ ...candidate }),
            damageAppliedEvent: Object.freeze({
                valueFixedPoint: 0,
                sourceEntityId: candidate.sourceEntityId,
                sourceIncarnation: candidate.sourceIncarnation
            })
        });
    }
    const requestedDamageFixedPoint = active
        ? candidate.finalDamageFixedPoint - peakFinalDamageFixedPoint
        : candidate.finalDamageFixedPoint;
    const appliedDamageFixedPoint = Math.min(
        requestedDamageFixedPoint,
        currentHealthFixedPoint
    );
    currentHealthFixedPoint -= appliedDamageFixedPoint;
    return Object.freeze({
        appliedDamageFixedPoint,
        remainingHealthFixedPoint: currentHealthFixedPoint,
        peakFinalDamageFixedPoint: candidate.finalDamageFixedPoint,
        // inactive winner와 active higher peak 모두 그 tick부터 새 window를 엽니다.
        expiresAtFixedTick: fixedTick + duration,
        peakSourceEntityId: candidate.sourceEntityId,
        peakSourceIncarnation: candidate.sourceIncarnation,
        candidate: Object.freeze({ ...candidate }),
        damageAppliedEvent: Object.freeze({
            valueFixedPoint: appliedDamageFixedPoint,
            sourceEntityId: candidate.sourceEntityId,
            sourceIncarnation: candidate.sourceIncarnation
        })
    });
}

/**
 * uint8 값을 검증합니다.
 * @param {*} value - 검사할 값입니다.
 * @param {string} fieldName - 오류에 표시할 필드명입니다.
 * @returns {number} uint8 값입니다.
 */
function requireUint8(value, fieldName) {
    if (!Number.isInteger(value) || value < 0 || value > UINT8_MAX) {
        throw new RangeError(`${fieldName}은(는) uint8 범위의 정수여야 합니다.`);
    }
    return value;
}

/**
 * uint16 collision/interaction capability 값을 검증합니다.
 * @param {*} value - 검사할 값입니다.
 * @param {string} fieldName - 오류에 표시할 필드명입니다.
 * @returns {number} uint16 값입니다.
 */
function requireUint16(value, fieldName) {
    if (!Number.isInteger(value) || value < 0 || value > UINT16_MAX) {
        throw new RangeError(`${fieldName}은(는) uint16 범위의 정수여야 합니다.`);
    }
    return value;
}

/**
 * uint32 값을 검증합니다.
 * @param {*} value - 검사할 값입니다.
 * @param {string} fieldName - 오류에 표시할 필드명입니다.
 * @returns {number} uint32 값입니다.
 */
function requireUint32(value, fieldName) {
    if (!Number.isSafeInteger(value) || value < 0 || value > UINT32_MAX) {
        throw new RangeError(`${fieldName}은(는) uint32 범위의 정수여야 합니다.`);
    }
    return value >>> 0;
}

/**
 * render style의 지원 silhouette code를 검증합니다.
 * @param {*} value - uint32 presentation code입니다.
 * @param {string} [fieldName='renderStyle.shapeCode'] - 오류 표기 이름입니다.
 * @returns {number} 검증된 shape code입니다.
 */
export function normalizeGpuCircleBodyRenderShapeCode(
    value = GPU_CIRCLE_BODY_RENDER_SHAPE.CIRCLE,
    fieldName = 'renderStyle.shapeCode'
) {
    const shapeCode = requireUint32(value, fieldName);
    switch (shapeCode) {
        case GPU_CIRCLE_BODY_RENDER_SHAPE.CIRCLE:
        case GPU_CIRCLE_BODY_RENDER_SHAPE.SQUARE:
        case GPU_CIRCLE_BODY_RENDER_SHAPE.TRIANGLE:
        case GPU_CIRCLE_BODY_RENDER_SHAPE.ARROW:
        case GPU_CIRCLE_BODY_RENDER_SHAPE.PENTA:
        case GPU_CIRCLE_BODY_RENDER_SHAPE.HEXA:
        case GPU_CIRCLE_BODY_RENDER_SHAPE.GEN:
        case GPU_CIRCLE_BODY_RENDER_SHAPE.RHOM:
        case GPU_CIRCLE_BODY_RENDER_SHAPE.OCTA:
        case GPU_CIRCLE_BODY_RENDER_SHAPE.RING:
        case GPU_CIRCLE_BODY_RENDER_SHAPE.JORANG:
        case GPU_CIRCLE_BODY_RENDER_SHAPE.CORK:
            return shapeCode;
        default:
            throw new RangeError(`${fieldName}에 지원하지 않는 shape code가 있습니다: ${shapeCode}`);
    }
}

/**
 * physical meta의 body layer/collision mask를 pack합니다.
 * @param {*} bodyLayer - low 16-bit physical layer입니다.
 * @param {*} collisionMask - high 16-bit physical acceptance mask입니다.
 * @returns {number} packed uint32 meta입니다.
 */
export function packGpuCirclePhysicsMeta(bodyLayer, collisionMask) {
    const layer = requireUint16(bodyLayer, 'bodyLayer');
    const collision = requireUint16(collisionMask, 'collisionMask');
    return (layer | (collision << GPU_CIRCLE_BODY_META.COLLISION_MASK_SHIFT)) >>> 0;
}

/**
 * physics meta를 collision-only 필드로 unpack합니다.
 * @param {*} meta - packed uint32 meta입니다.
 * @returns {{bodyLayer:number,collisionMask:number}} unpack 결과입니다.
 */
export function unpackGpuCirclePhysicsMeta(meta) {
    const packed = requireUint32(meta, 'physicsMeta');
    return {
        bodyLayer: packed & UINT16_MAX,
        collisionMask:
            (packed >>> GPU_CIRCLE_BODY_META.COLLISION_MASK_SHIFT) & UINT16_MAX
    };
}

/**
 * interaction meta의 layer/mask를 pack합니다.
 * @param {*} interactionLayer - low 16-bit gameplay interaction layer입니다.
 * @param {*} interactionMask - high 16-bit reciprocal acceptance mask입니다.
 * @returns {number} packed uint32 meta입니다.
 */
export function packGpuCircleInteractionMeta(interactionLayer, interactionMask) {
    const layer = requireUint16(interactionLayer, 'interactionLayer');
    const mask = requireUint16(interactionMask, 'interactionMask');
    return (layer | (mask << GPU_CIRCLE_BODY_META.INTERACTION_MASK_SHIFT)) >>> 0;
}

/** @param {*} meta - packed interaction meta입니다. */
export function unpackGpuCircleInteractionMeta(meta) {
    const packed = requireUint32(meta, 'interactionMeta');
    return {
        interactionLayer: packed & UINT16_MAX,
        interactionMask:
            (packed >>> GPU_CIRCLE_BODY_META.INTERACTION_MASK_SHIFT) & UINT16_MAX
    };
}

/** gameplay team과 damage policy를 BodySimulation +8 uint32 word로 pack합니다. */
export function packGpuCircleGameplayMeta(
    teamId,
    damagePolicyId = GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX,
    damageResolutionPolicyId = GAMEPLAY_DAMAGE_RESOLUTION_POLICY_ID.DIRECT
) {
    const team = normalizeGameplayTeamId(teamId, 'teamId');
    const damagePolicy = normalizeGameplayDamagePolicyId(
        damagePolicyId,
        'damagePolicyId'
    );
    const damageResolutionPolicy = normalizeGameplayDamageResolutionPolicyId(
        damageResolutionPolicyId,
        'damageResolutionPolicyId'
    );
    return ((team << GPU_CIRCLE_BODY_GAMEPLAY_META.TEAM_SHIFT)
        | (damagePolicy << GPU_CIRCLE_BODY_GAMEPLAY_META.DAMAGE_POLICY_SHIFT)
        | (damageResolutionPolicy
            << GPU_CIRCLE_BODY_GAMEPLAY_META.DAMAGE_RESOLUTION_POLICY_SHIFT)) >>> 0;
}

/** BodySimulation +8 gameplay word를 검증하고 unpack합니다. */
export function unpackGpuCircleGameplayMeta(meta) {
    const packed = requireUint32(meta, 'gameplayMeta');
    if ((packed & GPU_CIRCLE_BODY_GAMEPLAY_META.RESERVED_MASK) !== 0) {
        throw new RangeError('gameplayMeta reserved bit는 0이어야 합니다.');
    }
    const teamId = normalizeGameplayTeamId(
        (packed >>> GPU_CIRCLE_BODY_GAMEPLAY_META.TEAM_SHIFT)
            & GPU_CIRCLE_BODY_GAMEPLAY_META.TEAM_MASK,
        'gameplayMeta.teamId'
    );
    const damagePolicyId = normalizeGameplayDamagePolicyId(
        (packed >>> GPU_CIRCLE_BODY_GAMEPLAY_META.DAMAGE_POLICY_SHIFT)
            & GPU_CIRCLE_BODY_GAMEPLAY_META.DAMAGE_POLICY_MASK,
        'gameplayMeta.damagePolicyId'
    );
    const damageResolutionPolicyId = normalizeGameplayDamageResolutionPolicyId(
        (packed >>> GPU_CIRCLE_BODY_GAMEPLAY_META.DAMAGE_RESOLUTION_POLICY_SHIFT)
            & GPU_CIRCLE_BODY_GAMEPLAY_META.DAMAGE_RESOLUTION_POLICY_MASK,
        'gameplayMeta.damageResolutionPolicyId'
    );
    return { teamId, damagePolicyId, damageResolutionPolicyId };
}

/**
 * simulation plane +12에 저장할 flags-only uint32를 pack합니다.
 * @param {*} [flags] - simulation flags입니다.
 * @returns {number} flags uint32입니다.
 */
export function packGpuCircleSimulationMeta(
    flags = GPU_CIRCLE_BODY_META.ALIVE_FLAG
) {
    return requireUint32(flags, 'simulationFlags');
}

/**
 * simulation meta를 collision-only 필드로 unpack합니다.
 * @param {*} meta - packed uint32 meta입니다.
 * @returns {{flags:number,alive:boolean,useFlow:boolean,countAsKill:boolean,explodeOnDeath:boolean,golden:boolean}} unpack 결과입니다.
 */
export function unpackGpuCircleSimulationMeta(meta) {
    const packed = requireUint32(meta, 'simulationMeta');
    const flags = packed;
    return {
        flags,
        alive: (flags & GPU_CIRCLE_BODY_META.ALIVE_FLAG) === GPU_CIRCLE_BODY_META.ALIVE_FLAG,
        useFlow: (flags & GPU_CIRCLE_BODY_META.USE_FLOW_FLAG)
            === GPU_CIRCLE_BODY_META.USE_FLOW_FLAG,
        countAsKill: (flags & GPU_CIRCLE_BODY_META.COUNT_AS_KILL_FLAG)
            === GPU_CIRCLE_BODY_META.COUNT_AS_KILL_FLAG,
        explodeOnDeath: (flags & GPU_CIRCLE_BODY_META.EXPLODE_ON_DEATH_FLAG)
            === GPU_CIRCLE_BODY_META.EXPLODE_ON_DEATH_FLAG,
        golden: (flags & GPU_CIRCLE_BODY_META.GOLDEN_FLAG)
            === GPU_CIRCLE_BODY_META.GOLDEN_FLAG,
        projectileCaptured:
            (flags & GPU_CIRCLE_BODY_META.PROJECTILE_CAPTURED_FLAG)
                === GPU_CIRCLE_BODY_META.PROJECTILE_CAPTURED_FLAG
    };
}

/** 48-byte capture state word 0의 append-only packed contract입니다. */
export function packGpuProjectileCaptureStateMeta({
    role = GPU_PROJECTILE_CAPTURE_ROLE.NONE,
    phase = GPU_PROJECTILE_CAPTURE_PHASE.IDLE,
    profileCode = 0,
    policyCode = GPU_PROJECTILE_CAPTURE_POLICY_CODE.NOT_CAPTURABLE,
    flags = 0
} = {}) {
    const safeRole = requireUint8(role, 'projectileCaptureState.role');
    const safePhase = requireUint8(phase, 'projectileCaptureState.phase');
    const safeProfile = requireUint8(
        profileCode,
        'projectileCaptureState.profileCode'
    );
    const safePolicy = requireUint8(
        policyCode,
        'projectileCaptureState.policyCode'
    );
    const safeFlags = requireUint16(flags, 'projectileCaptureState.flags');
    if (!Object.values(GPU_PROJECTILE_CAPTURE_ROLE).includes(safeRole)
        || !Object.values(GPU_PROJECTILE_CAPTURE_PHASE).includes(safePhase)
        || !Object.values(GPU_PROJECTILE_CAPTURE_POLICY_CODE).includes(
            safePolicy
        )) {
        throw new RangeError('projectile capture state meta enum이 유효하지 않습니다.');
    }
    return ((safeRole << GPU_PROJECTILE_CAPTURE_STATE_META.ROLE_SHIFT)
        | (safePhase << GPU_PROJECTILE_CAPTURE_STATE_META.PHASE_SHIFT)
        | (safeProfile << GPU_PROJECTILE_CAPTURE_STATE_META.PROFILE_SHIFT)
        | (safePolicy << GPU_PROJECTILE_CAPTURE_STATE_META.POLICY_SHIFT)
        | (safeFlags << GPU_PROJECTILE_CAPTURE_STATE_META.FLAGS_SHIFT)) >>> 0;
}

export function unpackGpuProjectileCaptureStateMeta(value) {
    const packed = requireUint32(value, 'projectileCaptureState.meta');
    return Object.freeze({
        role: (packed & GPU_PROJECTILE_CAPTURE_STATE_META.ROLE_MASK)
            >>> GPU_PROJECTILE_CAPTURE_STATE_META.ROLE_SHIFT,
        phase: (packed & GPU_PROJECTILE_CAPTURE_STATE_META.PHASE_MASK)
            >>> GPU_PROJECTILE_CAPTURE_STATE_META.PHASE_SHIFT,
        profileCode: (packed & GPU_PROJECTILE_CAPTURE_STATE_META.PROFILE_MASK)
            >>> GPU_PROJECTILE_CAPTURE_STATE_META.PROFILE_SHIFT,
        policyCode: (packed & GPU_PROJECTILE_CAPTURE_STATE_META.POLICY_MASK)
            >>> GPU_PROJECTILE_CAPTURE_STATE_META.POLICY_SHIFT,
        flags: (packed & GPU_PROJECTILE_CAPTURE_STATE_META.FLAGS_MASK)
            >>> GPU_PROJECTILE_CAPTURE_STATE_META.FLAGS_SHIFT
    });
}

/**
 * lifecycle/low-level public ingress에서만 legacy metadata alias를 V4로 승격합니다.
 * 반환값에는 legacy 이름이 절대 포함되지 않습니다.
 */
export function normalizeGpuCircleBodyMetadata(source, options = {}) {
    if (!source || typeof source !== 'object') {
        throw new TypeError('GPU circle body metadata source가 필요합니다.');
    }
    const has = (name) => Object.prototype.hasOwnProperty.call(source, name)
        && source[name] !== undefined
        && source[name] !== null;
    const hasLegacyLayer = has('layerMask');
    const hasLegacySensor = has('sensorMask');
    const legacyLayer = hasLegacyLayer
        ? requireUint16(source.layerMask, 'layerMask')
        : undefined;
    const legacyInteractionMask = hasLegacySensor
        ? requireUint16(source.sensorMask, 'sensorMask')
        : undefined;
    if (!has('bodyLayer') && !hasLegacyLayer) {
        throw new TypeError('bodyLayer 또는 legacy layerMask가 필요합니다.');
    }
    if (!has('interactionLayer') && !hasLegacyLayer) {
        throw new TypeError('interactionLayer 또는 legacy layerMask가 필요합니다.');
    }
    if (!has('collisionMask')) {
        throw new TypeError('collisionMask가 필요합니다.');
    }
    if (!has('interactionMask') && !hasLegacySensor && !hasLegacyLayer) {
        throw new TypeError('interactionMask 또는 legacy sensorMask가 필요합니다.');
    }
    const bodyLayer = requireUint16(
        has('bodyLayer') ? source.bodyLayer : legacyLayer,
        'bodyLayer'
    );
    const interactionLayer = requireUint16(
        has('interactionLayer') ? source.interactionLayer : legacyLayer,
        'interactionLayer'
    );
    const collisionMask = requireUint16(source.collisionMask, 'collisionMask');
    const interactionMask = requireUint16(
        has('interactionMask')
            ? source.interactionMask
            : (hasLegacyLayer || hasLegacySensor)
                // V1 contact는 source sensorMask와 target collisionMask를
                // 결합했습니다. legacy-only 입력에서는 두 capability를
                // 합쳐야 reciprocal V2 interaction이 동작 호환됩니다.
                ? (legacyInteractionMask ?? 0) | collisionMask
                : 0,
        'interactionMask'
    );
    if (legacyLayer !== undefined && bodyLayer !== legacyLayer) {
        throw new RangeError('bodyLayer와 layerMask alias가 일치해야 합니다.');
    }
    if (legacyLayer !== undefined && interactionLayer !== legacyLayer) {
        throw new RangeError('interactionLayer와 layerMask alias가 일치해야 합니다.');
    }
    if (has('interactionMask')
        && legacyInteractionMask !== undefined
        && interactionMask !== legacyInteractionMask) {
        throw new RangeError('interactionMask와 sensorMask alias가 일치해야 합니다.');
    }
    if (options.requireNonZeroLayers === true
        && (bodyLayer === 0 || interactionLayer === 0)) {
        throw new RangeError('bodyLayer와 interactionLayer는 하나 이상의 bit가 필요합니다.');
    }
    return Object.freeze({
        bodyLayer,
        collisionMask,
        interactionLayer,
        interactionMask
    });
}

export function packGpuCircleAppliedEventMeta(type, flags = 0) {
    const eventType = requireUint8(type, 'appliedEvent.type');
    if (!Object.values(GPU_CIRCLE_APPLIED_EVENT_TYPE).includes(eventType)) {
        throw new RangeError(`지원하지 않는 applied event type입니다: ${eventType}`);
    }
    const eventFlags = requireUint32(flags, 'appliedEvent.flags');
    if ((eventFlags & GPU_CIRCLE_APPLIED_EVENT_META.TYPE_MASK) !== 0) {
        throw new RangeError('applied event flags는 type low byte를 침범할 수 없습니다.');
    }
    return (eventType | eventFlags) >>> 0;
}

export function unpackGpuCircleAppliedEventMeta(meta) {
    const packed = requireUint32(meta, 'appliedEventMeta');
    return {
        type: packed & GPU_CIRCLE_APPLIED_EVENT_META.TYPE_MASK,
        flags: packed & GPU_CIRCLE_APPLIED_EVENT_META.FLAGS_MASK
    };
}

/**
 * collision-only ABI storage를 생성합니다.
 * @param {*} capacity - 최대 body 수입니다.
 * 반환 buffer들은 GPU 업로드 전 CPU 권위 mirror입니다.
 * @returns {{capacity:number,countsBuffer:ArrayBuffer,physicsBuffer:ArrayBuffer,simulationBuffer:ArrayBuffer,temporaryBuffer:ArrayBuffer,contactHandlerBuffer:ArrayBuffer,combatStateBuffer:ArrayBuffer,atomicTransformStateBuffer:ArrayBuffer,projectileCaptureStateBuffer:ArrayBuffer,projectileCaptureCandidateBuffer:ArrayBuffer,enemyBehaviorStateBuffer:ArrayBuffer}}
 * 생성된 CPU mirror storage입니다.
 */
export function createGpuCircleBodyAbiStorage(capacity) {
    const safeCapacity = requireCapacity(capacity);
    const storage = {
        capacity: safeCapacity,
        countsBuffer: new ArrayBuffer(GPU_CIRCLE_BODY_ABI.COUNTS.STRIDE),
        physicsBuffer: new ArrayBuffer(GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE * safeCapacity),
        simulationBuffer: new ArrayBuffer(
            GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE * safeCapacity
        ),
        temporaryBuffer: new ArrayBuffer(
            GPU_CIRCLE_BODY_ABI.TEMPORARY.STRIDE * safeCapacity
        ),
        contactHandlerBuffer: new ArrayBuffer(
            GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.STRIDE * safeCapacity
        ),
        combatStateBuffer: new ArrayBuffer(
            GPU_CIRCLE_BODY_ABI.COMBAT_STATE.STRIDE * safeCapacity
        ),
        atomicTransformStateBuffer: new ArrayBuffer(
            GPU_CIRCLE_BODY_ABI.ATOMIC_TRANSFORM_STATE.STRIDE * safeCapacity
        ),
        projectileCaptureStateBuffer: new ArrayBuffer(
            GPU_CIRCLE_BODY_ABI.PROJECTILE_CAPTURE_STATE.STRIDE * safeCapacity
        ),
        projectileCaptureCandidateBuffer: new ArrayBuffer(
            GPU_CIRCLE_BODY_ABI.PROJECTILE_CAPTURE_CANDIDATE.STRIDE
                * safeCapacity
        ),
        enemyBehaviorStateBuffer: new ArrayBuffer(
            GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.STRIDE * safeCapacity
        )
    };
    new DataView(storage.countsBuffer).setUint32(
        GPU_CIRCLE_BODY_ABI.COUNTS.ABI_VERSION,
        GPU_CIRCLE_BODY_ABI_VERSION,
        LITTLE_ENDIAN
    );
    return storage;
}

/**
 * 생성된 ABI storage 계약을 검증합니다.
 * @param {*} storage - 검사할 storage입니다.
 * @returns {number} storage capacity입니다.
 */
function requireStorage(storage) {
    if (!storage || typeof storage !== 'object') {
        throw new TypeError('GPU circle body storage가 필요합니다.');
    }
    const capacity = requireCapacity(storage.capacity);
    if (!(storage.countsBuffer instanceof ArrayBuffer)
        || storage.countsBuffer.byteLength !== GPU_CIRCLE_BODY_ABI.COUNTS.STRIDE
        || !(storage.physicsBuffer instanceof ArrayBuffer)
        || storage.physicsBuffer.byteLength !== GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE * capacity
        || !(storage.simulationBuffer instanceof ArrayBuffer)
        || storage.simulationBuffer.byteLength
            !== GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE * capacity
        || !(storage.temporaryBuffer instanceof ArrayBuffer)
        || storage.temporaryBuffer.byteLength
            !== GPU_CIRCLE_BODY_ABI.TEMPORARY.STRIDE * capacity
        || !(storage.contactHandlerBuffer instanceof ArrayBuffer)
        || storage.contactHandlerBuffer.byteLength
            !== GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.STRIDE * capacity
        || !(storage.combatStateBuffer instanceof ArrayBuffer)
        || storage.combatStateBuffer.byteLength
            !== GPU_CIRCLE_BODY_ABI.COMBAT_STATE.STRIDE * capacity
        || !(storage.atomicTransformStateBuffer instanceof ArrayBuffer)
        || storage.atomicTransformStateBuffer.byteLength
            !== GPU_CIRCLE_BODY_ABI.ATOMIC_TRANSFORM_STATE.STRIDE * capacity
        || !(storage.projectileCaptureStateBuffer instanceof ArrayBuffer)
        || storage.projectileCaptureStateBuffer.byteLength
            !== GPU_CIRCLE_BODY_ABI.PROJECTILE_CAPTURE_STATE.STRIDE * capacity
        || !(storage.projectileCaptureCandidateBuffer instanceof ArrayBuffer)
        || storage.projectileCaptureCandidateBuffer.byteLength
            !== GPU_CIRCLE_BODY_ABI.PROJECTILE_CAPTURE_CANDIDATE.STRIDE
                * capacity
        || !(storage.enemyBehaviorStateBuffer instanceof ArrayBuffer)
        || storage.enemyBehaviorStateBuffer.byteLength
            !== GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE.STRIDE * capacity) {
        throw new TypeError('GPU circle body storage의 buffer 크기 또는 타입이 ABI와 다릅니다.');
    }
    return capacity;
}

/**
 * CPU mirror header가 현재 ABI와 정확히 일치하는지 검증합니다. 불일치 storage는
 * 제자리 migration/repair하지 않고 caller가 session을 재생성하도록 실패합니다.
 */
export function assertGpuCircleBodyAbiVersion(storage) {
    requireStorage(storage);
    const actual = new DataView(storage.countsBuffer).getUint32(
        GPU_CIRCLE_BODY_ABI.COUNTS.ABI_VERSION,
        LITTLE_ENDIAN
    );
    if (actual !== GPU_CIRCLE_BODY_ABI_VERSION) {
        throw new RangeError(
            `GPU circle body ABI version mismatch: expected=${GPU_CIRCLE_BODY_ABI_VERSION}, actual=${actual}`
        );
    }
    return actual;
}

/**
 * counts 구조체를 씁니다.
 * @param {*} storage - ABI storage입니다.
 * @param {*} counts - 쓸 count 값입니다.
 * @returns {void}
 */
export function writeGpuCircleBodyCounts(storage, counts) {
    const capacity = requireStorage(storage);
    assertGpuCircleBodyAbiVersion(storage);
    if (!counts || typeof counts !== 'object') {
        throw new TypeError('counts 객체가 필요합니다.');
    }
    const bodyCount = requireUint32(counts.bodyCount ?? 0, 'bodyCount');
    if (bodyCount > capacity) {
        throw new RangeError(`bodyCount가 capacity를 초과했습니다: ${bodyCount}/${capacity}`);
    }
    const view = new DataView(storage.countsBuffer);
    view.setUint32(GPU_CIRCLE_BODY_ABI.COUNTS.BODY_COUNT, bodyCount, LITTLE_ENDIAN);
    view.setUint32(
        GPU_CIRCLE_BODY_ABI.COUNTS.ADDITION_COUNT,
        requireUint32(counts.additionCount ?? 0, 'additionCount'),
        LITTLE_ENDIAN
    );
    view.setUint32(
        GPU_CIRCLE_BODY_ABI.COUNTS.REMOVAL_COUNT,
        requireUint32(counts.removalCount ?? 0, 'removalCount'),
        LITTLE_ENDIAN
    );
    view.setUint32(
        GPU_CIRCLE_BODY_ABI.COUNTS.ABI_VERSION,
        GPU_CIRCLE_BODY_ABI_VERSION,
        LITTLE_ENDIAN
    );
}

/**
 * counts 구조체를 읽습니다.
 * @param {*} storage - ABI storage입니다.
 * @returns {{bodyCount:number,additionCount:number,removalCount:number,abiVersion:number}} count 값입니다.
 */
export function readGpuCircleBodyCounts(storage) {
    requireStorage(storage);
    const view = new DataView(storage.countsBuffer);
    return {
        bodyCount: view.getUint32(GPU_CIRCLE_BODY_ABI.COUNTS.BODY_COUNT, LITTLE_ENDIAN),
        additionCount: view.getUint32(GPU_CIRCLE_BODY_ABI.COUNTS.ADDITION_COUNT, LITTLE_ENDIAN),
        removalCount: view.getUint32(GPU_CIRCLE_BODY_ABI.COUNTS.REMOVAL_COUNT, LITTLE_ENDIAN),
        abiVersion: view.getUint32(
            GPU_CIRCLE_BODY_ABI.COUNTS.ABI_VERSION,
            LITTLE_ENDIAN
        )
    };
}

/**
 * spawn 입력에서 위치 성분을 읽고 검증합니다.
 * @param {*} spawn - spawn 입력입니다.
 * @param {'x'|'y'} axis - 읽을 축입니다.
 * @returns {number} Float32 위치입니다.
 */
function readSpawnPosition(spawn, axis) {
    const value = spawn.position?.[axis] ?? spawn[axis];
    return requireFloat32(value, `position.${axis}`);
}

/**
 * spawn 입력에서 속도 성분을 읽고 검증합니다.
 * @param {*} spawn - spawn 입력입니다.
 * @param {'x'|'y'} axis - 읽을 축입니다.
 * @returns {number} Float32 속도입니다.
 */
function readSpawnVelocity(spawn, axis) {
    const flatName = axis === 'x' ? 'velocityX' : 'velocityY';
    const value = spawn.velocity?.[axis] ?? spawn[flatName] ?? 0;
    return requireFloat32(value, `velocity.${axis}`);
}

/**
 * V1 sensor producer의 implicit enter-only 의미를 public ingress에서만
 * 명시적 V2 handler policy로 승격합니다.
 * @param {*} spawn - contactHandler와 optional legacy sensorMask를 가진 spawn입니다.
 * @returns {object} canonical contact handler입니다.
 */
export function normalizeGpuCircleBodyContactHandler(spawn) {
    const handler = spawn.contactHandler ?? {};
    if (!handler || typeof handler !== 'object') {
        throw new TypeError('contactHandler는 객체여야 합니다.');
    }
    const authoredFlags = requireUint32(handler.flags ?? 0, 'contactHandler.flags');
    const hasInteractionPolicy = (authoredFlags & (
        GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_ENTER_ONLY
        | GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_CONTINUOUS
    )) !== 0;
    const legacySensorMask = spawn.sensorMask;
    if (!hasInteractionPolicy
        && legacySensorMask !== undefined
        && legacySensorMask !== null
        && requireUint16(legacySensorMask, 'sensorMask') !== 0) {
        return Object.freeze({
            ...handler,
            flags: authoredFlags
                | GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_ENTER_ONLY
        });
    }
    return handler;
}

function resolveSpawnSimulationFlags(spawn, useFlow, contactHandler) {
    let flags = spawn.simulationFlags === undefined
        ? (spawn.alive === false ? 0 : GPU_CIRCLE_BODY_SIMULATION_FLAG.ALIVE)
        : requireUint32(spawn.simulationFlags, 'simulationFlags');
    if (useFlow) {
        flags |= GPU_CIRCLE_BODY_SIMULATION_FLAG.USE_FLOW;
    }
    if (spawn.countAsKill === true) {
        flags |= GPU_CIRCLE_BODY_SIMULATION_FLAG.COUNT_AS_KILL;
    }
    if (spawn.explodeOnDeath === true) {
        flags |= GPU_CIRCLE_BODY_SIMULATION_FLAG.EXPLODE_ON_DEATH;
    }
    if (spawn.golden === true || spawn.isGolden === true) {
        flags |= GPU_CIRCLE_BODY_SIMULATION_FLAG.GOLDEN;
    }
    const handlerFlags = requireUint32(
        contactHandler.flags ?? 0,
        'contactHandler.flags'
    );
    if ((handlerFlags & GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_ENTER_ONLY) !== 0) {
        flags |= GPU_CIRCLE_BODY_SIMULATION_FLAG.INTERACTION_ENTER_ONLY;
    }
    if ((handlerFlags & GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_CONTINUOUS) !== 0) {
        flags |= GPU_CIRCLE_BODY_SIMULATION_FLAG.INTERACTION_CONTINUOUS;
    }
    return flags;
}

function assertOptionalFlagMatches(spawn, fieldNames, flags, flag, label) {
    let expected;
    for (const fieldName of fieldNames) {
        if (typeof spawn[fieldName] === 'boolean') {
            expected = spawn[fieldName];
            break;
        }
    }
    if (expected === undefined) {
        return;
    }
    const enabled = (flags & flag) === flag;
    if (enabled !== expected) {
        throw new RangeError(`simulationMeta의 ${label} flag와 입력이 일치해야 합니다.`);
    }
}

/**
 * spawn metadata를 V6 physical/interaction/gameplay/simulation word로 검증합니다.
 * @param {*} spawn - spawn 입력입니다.
 * @returns {{physicsMeta:number,interactionMeta:number,simulationMeta:number,metadata:object}} packed meta입니다.
 */
function resolveSpawnMeta(spawn, useFlow, contactHandler) {
    const metadata = normalizeGpuCircleBodyMetadata(spawn);
    const physicsMeta = spawn.physicsMeta === undefined
        ? packGpuCirclePhysicsMeta(
            metadata.bodyLayer,
            metadata.collisionMask
        )
        : requireUint32(spawn.physicsMeta, 'physicsMeta');
    const interactionMeta = spawn.interactionMeta === undefined
        ? packGpuCircleInteractionMeta(
            metadata.interactionLayer,
            metadata.interactionMask
        )
        : requireUint32(spawn.interactionMeta, 'interactionMeta');
    if (Object.prototype.hasOwnProperty.call(spawn, 'timer')) {
        throw new TypeError('Body ABI v4에서는 timer 대신 gameplayMeta/teamId를 사용합니다.');
    }
    const teamId = normalizeGameplayTeamId(spawn.teamId, 'teamId');
    const damagePolicyId = normalizeGameplayDamagePolicyId(
        spawn.damagePolicyId ?? GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX,
        'damagePolicyId'
    );
    const damageResolutionPolicyId = normalizeGameplayDamageResolutionPolicyId(
        spawn.damageResolutionPolicyId
            ?? GAMEPLAY_DAMAGE_RESOLUTION_POLICY_ID.DIRECT,
        'damageResolutionPolicyId'
    );
    const gameplayMeta = spawn.gameplayMeta === undefined
        ? packGpuCircleGameplayMeta(
            teamId,
            damagePolicyId,
            damageResolutionPolicyId
        )
        : requireUint32(spawn.gameplayMeta, 'gameplayMeta');
    const simulationMeta = spawn.simulationMeta === undefined
        ? packGpuCircleSimulationMeta(resolveSpawnSimulationFlags(
            spawn,
            useFlow,
            contactHandler
        ))
        : requireUint32(spawn.simulationMeta, 'simulationMeta');
    const unpackedPhysics = unpackGpuCirclePhysicsMeta(physicsMeta);
    if (unpackedPhysics.bodyLayer !== metadata.bodyLayer
        || unpackedPhysics.collisionMask !== metadata.collisionMask) {
        throw new RangeError('physicsMeta와 canonical physical metadata가 일치해야 합니다.');
    }
    const unpackedInteraction = unpackGpuCircleInteractionMeta(interactionMeta);
    if (unpackedInteraction.interactionLayer !== metadata.interactionLayer
        || unpackedInteraction.interactionMask !== metadata.interactionMask) {
        throw new RangeError(
            'interactionMeta와 canonical interaction metadata가 일치해야 합니다.'
        );
    }
    const unpackedGameplay = unpackGpuCircleGameplayMeta(gameplayMeta);
    if (unpackedGameplay.teamId !== teamId
        || unpackedGameplay.damagePolicyId !== damagePolicyId
        || unpackedGameplay.damageResolutionPolicyId !== damageResolutionPolicyId) {
        throw new RangeError(
            'gameplayMeta와 canonical team/damage resolution policy metadata가 일치해야 합니다.'
        );
    }
    const simulationFlags = unpackGpuCircleSimulationMeta(simulationMeta).flags;
    const handlerFlags = requireUint32(
        contactHandler.flags ?? 0,
        'contactHandler.flags'
    );
    const expectedEnterPolicy = (
        handlerFlags & GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_ENTER_ONLY
    ) !== 0;
    const expectedContinuousPolicy = (
        handlerFlags & GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_CONTINUOUS
    ) !== 0;
    if (((simulationFlags & GPU_CIRCLE_BODY_SIMULATION_FLAG.INTERACTION_ENTER_ONLY) !== 0)
            !== expectedEnterPolicy
        || ((simulationFlags
            & GPU_CIRCLE_BODY_SIMULATION_FLAG.INTERACTION_CONTINUOUS) !== 0)
            !== expectedContinuousPolicy) {
        throw new RangeError(
            'simulationMeta의 interaction policy mirror와 contactHandler.flags가 일치해야 합니다.'
        );
    }
    const metaIsAlive = (simulationFlags & GPU_CIRCLE_BODY_META.ALIVE_FLAG) !== 0;
    const spawnIsAlive = spawn.alive !== false;
    if (metaIsAlive !== spawnIsAlive) {
        throw new RangeError('simulationMeta의 ALIVE flag와 alive 입력이 일치해야 합니다.');
    }
    const metaUsesFlow = (simulationFlags & GPU_CIRCLE_BODY_META.USE_FLOW_FLAG) !== 0;
    if (metaUsesFlow !== useFlow) {
        throw new RangeError('simulationMeta의 USE_FLOW flag와 flow 입력이 일치해야 합니다.');
    }
    assertOptionalFlagMatches(
        spawn,
        ['countAsKill'],
        simulationFlags,
        GPU_CIRCLE_BODY_SIMULATION_FLAG.COUNT_AS_KILL,
        'COUNT_AS_KILL'
    );
    assertOptionalFlagMatches(
        spawn,
        ['explodeOnDeath'],
        simulationFlags,
        GPU_CIRCLE_BODY_SIMULATION_FLAG.EXPLODE_ON_DEATH,
        'EXPLODE_ON_DEATH'
    );
    assertOptionalFlagMatches(
        spawn,
        ['golden', 'isGolden'],
        simulationFlags,
        GPU_CIRCLE_BODY_SIMULATION_FLAG.GOLDEN,
        'GOLDEN'
    );
    return {
        physicsMeta,
        interactionMeta,
        gameplayMeta,
        simulationMeta,
        metadata,
        damageResolutionPolicyId
    };
}

/**
 * spawn의 선택적 flow-field 조향 값을 검증합니다.
 * @param {*} spawn - spawn 입력입니다.
 * @returns {{useFlow:boolean,flowFieldIndex:number,flowSpeed:number}} 조향 값입니다.
 */
function resolveSpawnFlow(spawn) {
    const hasFieldIndex = spawn.flowFieldIndex !== undefined
        && spawn.flowFieldIndex !== null;
    const useFlow = spawn.useFlow === true || hasFieldIndex;
    if (!useFlow) {
        return {
            useFlow: false,
            flowFieldIndex: GPU_CIRCLE_BODY_FLOW.INVALID_FIELD_INDEX,
            flowSpeed: 0
        };
    }
    const flowFieldIndex = requireUint32(spawn.flowFieldIndex, 'flowFieldIndex');
    if (flowFieldIndex === GPU_CIRCLE_BODY_FLOW.INVALID_FIELD_INDEX) {
        throw new RangeError('flowFieldIndex는 INVALID_FIELD_INDEX일 수 없습니다.');
    }
    return {
        useFlow: true,
        flowFieldIndex,
        flowSpeed: requireNonNegativeFloat32(
            spawn.flowSpeed ?? spawn.maxSpeed,
            'flowSpeed'
        )
    };
}

function resolveSpawnIdentity(spawn) {
    const entityIdValue = spawn.entityId ?? spawn.handle?.entityId;
    const incarnationValue = spawn.incarnation ?? spawn.handle?.incarnation;
    const hasEntityId = entityIdValue !== undefined && entityIdValue !== null;
    const hasIncarnation = incarnationValue !== undefined && incarnationValue !== null;
    if (!hasEntityId && !hasIncarnation) {
        return {
            entityId: GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT,
            incarnation: GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT
        };
    }
    if (!hasEntityId || !hasIncarnation) {
        throw new TypeError('spawn identity에는 entityId와 incarnation이 모두 필요합니다.');
    }
    const entityId = requireUint32(entityIdValue, 'entityId');
    const incarnation = requireUint32(incarnationValue, 'incarnation');
    if (entityId === GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT
        || incarnation === GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT) {
        throw new RangeError('entityId/incarnation은 reserved invalid sentinel일 수 없습니다.');
    }
    return { entityId, incarnation };
}

function resolveSpawnHealthFixedPoint(spawn) {
    if (spawn.healthFixedPoint !== undefined) {
        const healthFixedPoint = requireInt32(
            spawn.healthFixedPoint,
            'healthFixedPoint'
        );
        if (healthFixedPoint < 0) {
            throw new RangeError('spawn healthFixedPoint는 0 이상이어야 합니다.');
        }
        return healthFixedPoint;
    }
    const health = requireNonNegativeFloat32(
        spawn.health ?? (spawn.alive === false ? 0 : 1),
        'health'
    );
    return encodeGpuCircleBodyFixedPoint(health);
}

function readContactHandlerValue(handler, camelName, sourceName, fallback = 0) {
    return handler?.[camelName] ?? handler?.[sourceName] ?? fallback;
}

function requireNonNegativeContactDamage(value, fieldName) {
    const damage = requireNonNegativeFloat32(value, fieldName);
    // WGSL은 contact damage를 atomic health와 같은 ×100 i32 단위로 변환합니다.
    // shader 변환 범위를 넘는 authored 값은 GPU에 보내기 전에 거부합니다.
    encodeGpuCircleBodyFixedPoint(damage);
    return damage;
}

/**
 * contact handler 한 slot을 원본 32-byte layout으로 완전히 씁니다.
 * @param {*} storage - ABI CPU mirror storage입니다.
 * @param {*} index - 쓸 body slot입니다.
 * @param {*} [handler={}] - damage/status/contact 정책입니다.
 * @returns {number} 쓴 slot index입니다.
 */
export function writeGpuCircleContactHandler(storage, index, handler = {}) {
    const capacity = requireStorage(storage);
    assertGpuCircleBodyAbiVersion(storage);
    const slot = requireSlotIndex(index, capacity);
    if (!handler || typeof handler !== 'object') {
        throw new TypeError('contactHandler는 객체여야 합니다.');
    }
    const flags = requireUint32(handler.flags ?? 0, 'contactHandler.flags');
    const interactionPolicy = flags & (
        GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_ENTER_ONLY
        | GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_CONTINUOUS
    );
    if (interactionPolicy === (
        GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_ENTER_ONLY
        | GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_CONTINUOUS
    )) {
        throw new RangeError(
            'contactHandler는 enter-only와 continuous policy를 동시에 가질 수 없습니다.'
        );
    }
    if ((flags & GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.CORE_DAMAGE_REQUEST) !== 0) {
        const required = GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.CLOSEST_ONLY
            | GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_ENTER_ONLY;
        if ((flags & required) !== required
            || (flags
                & GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_CONTINUOUS) !== 0) {
            throw new RangeError(
                'CORE_DAMAGE_REQUEST handler는 closest enter-only policy여야 합니다.'
            );
        }
    }
    const offset = slot * GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.STRIDE;
    const view = new DataView(storage.contactHandlerBuffer);
    view.setFloat32(
        offset + GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.DAMAGE_SELF,
        requireNonNegativeContactDamage(
            readContactHandlerValue(handler, 'damageSelf', 'damage_self'),
            'contactHandler.damageSelf'
        ),
        LITTLE_ENDIAN
    );
    view.setFloat32(
        offset + GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.DAMAGE_OTHER,
        requireNonNegativeContactDamage(
            readContactHandlerValue(handler, 'damageOther', 'damage_other'),
            'contactHandler.damageOther'
        ),
        LITTLE_ENDIAN
    );
    view.setFloat32(
        offset + GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.DAMAGE_FALLOFF,
        requireNonNegativeFloat32(
            readContactHandlerValue(handler, 'damageFalloff', 'damage_falloff'),
            'contactHandler.damageFalloff'
        ),
        LITTLE_ENDIAN
    );
    view.setFloat32(
        offset + GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.FIRE_TIMER,
        requireNonNegativeFloat32(
            readContactHandlerValue(handler, 'fireTimer', 'fire_timer'),
            'contactHandler.fireTimer'
        ),
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.FLAGS,
        flags,
        LITTLE_ENDIAN
    );
    view.setInt32(
        offset + GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.CHAINING,
        requireInt32(handler.chaining ?? 0, 'contactHandler.chaining'),
        LITTLE_ENDIAN
    );
    view.setInt32(
        offset + GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.DAMAGE_REPORT_ID,
        requireInt32(
            readContactHandlerValue(handler, 'damageReportId', 'damage_report_id', -1),
            'contactHandler.damageReportId'
        ),
        LITTLE_ENDIAN
    );
    view.setFloat32(
        offset + GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.SLOW_TIMER,
        requireNonNegativeFloat32(
            readContactHandlerValue(handler, 'slowTimer', 'slow_timer'),
            'contactHandler.slowTimer'
        ),
        LITTLE_ENDIAN
    );
    return slot;
}

/**
 * contact handler 한 slot을 읽습니다.
 * @param {*} storage - ABI CPU mirror storage입니다.
 * @param {*} index - 읽을 body slot입니다.
 * @returns {object} contact handler snapshot입니다.
 */
export function readGpuCircleContactHandler(storage, index) {
    const capacity = requireStorage(storage);
    assertGpuCircleBodyAbiVersion(storage);
    const slot = requireSlotIndex(index, capacity);
    const offset = slot * GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.STRIDE;
    const view = new DataView(storage.contactHandlerBuffer);
    const combatOffset = slot * GPU_CIRCLE_BODY_ABI.COMBAT_STATE.STRIDE;
    const combatView = new DataView(storage.combatStateBuffer);
    return {
        damageSelf: view.getFloat32(
            offset + GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.DAMAGE_SELF,
            LITTLE_ENDIAN
        ),
        damageOther: view.getFloat32(
            offset + GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.DAMAGE_OTHER,
            LITTLE_ENDIAN
        ),
        damageFalloff: view.getFloat32(
            offset + GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.DAMAGE_FALLOFF,
            LITTLE_ENDIAN
        ),
        fireTimer: view.getFloat32(
            offset + GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.FIRE_TIMER,
            LITTLE_ENDIAN
        ),
        flags: view.getUint32(
            offset + GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.FLAGS,
            LITTLE_ENDIAN
        ),
        chaining: view.getInt32(
            offset + GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.CHAINING,
            LITTLE_ENDIAN
        ),
        damageReportId: view.getInt32(
            offset + GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.DAMAGE_REPORT_ID,
            LITTLE_ENDIAN
        ),
        slowTimer: view.getFloat32(
            offset + GPU_CIRCLE_BODY_ABI.CONTACT_HANDLER.SLOW_TIMER,
            LITTLE_ENDIAN
        ),
        targetInteractionLayerMask: combatView.getUint32(
            combatOffset
                + GPU_CIRCLE_BODY_ABI.COMBAT_STATE.TARGET_INTERACTION_LAYER_MASK,
            LITTLE_ENDIAN
        )
    };
}

/** Maximum Damage Window duration의 fixed tick uint32 계약을 검증합니다. */
export function normalizeGpuCircleBodyMaximumDamageWindowDurationTicks(
    value = 0,
    fieldName = 'maximumDamageWindowDurationTicks'
) {
    return requireUint32(value, fieldName);
}

function resolveSpawnCombatState(
    spawn,
    contactHandler,
    metadata,
    damageResolutionPolicyId
) {
    const targetInteractionLayerMask = requireUint16(
        readContactHandlerValue(
            contactHandler,
            'targetInteractionLayerMask',
            'target_interaction_layer_mask',
            metadata.interactionMask
        ),
        'contactHandler.targetInteractionLayerMask'
    );
    if ((targetInteractionLayerMask & ~metadata.interactionMask) !== 0) {
        throw new RangeError(
            'contactHandler.targetInteractionLayerMask는 interactionMask의 부분집합이어야 합니다.'
        );
    }
    const maximumDamageWindowDurationTicks
        = normalizeGpuCircleBodyMaximumDamageWindowDurationTicks(
            spawn.maximumDamageWindowDurationTicks ?? 0
        );
    if (damageResolutionPolicyId
            === GAMEPLAY_DAMAGE_RESOLUTION_POLICY_ID.MAXIMUM_DAMAGE_WINDOW
        && maximumDamageWindowDurationTicks === 0) {
        throw new RangeError(
            'MAXIMUM_DAMAGE_WINDOW resolution에는 양의 maximumDamageWindowDurationTicks가 필요합니다.'
        );
    }
    if (damageResolutionPolicyId === GAMEPLAY_DAMAGE_RESOLUTION_POLICY_ID.DIRECT
        && maximumDamageWindowDurationTicks !== 0) {
        throw new RangeError(
            'DIRECT resolution에는 maximumDamageWindowDurationTicks 0이 필요합니다.'
        );
    }
    const authoredDirectCoreDamage = spawn.directCoreImpactDamage
        ?? spawn.coreImpactDamage
        ?? 0;
    const encodedDirectCoreDamage = encodeGpuCircleBodyFixedPoint(
        authoredDirectCoreDamage
    );
    const directCoreDamageFixedPoint = requireInt32(
        spawn.directCoreDamageFixedPoint ?? encodedDirectCoreDamage,
        'directCoreDamageFixedPoint'
    );
    if (directCoreDamageFixedPoint < 0
        || (spawn.directCoreDamageFixedPoint !== undefined
            && directCoreDamageFixedPoint !== encodedDirectCoreDamage)) {
        throw new RangeError(
            'direct Core damage fixed-point는 authored coreImpactDamage와 같은 0 이상 값이어야 합니다.'
        );
    }
    return {
        targetInteractionLayerMask,
        maximumDamageWindowDurationTicks,
        directCoreDamageFixedPoint
    };
}

/**
 * generic combat-state side-plane 한 slot을 씁니다. Spawn/recovery path는 항상
 * peak/expiry transient를 0으로 재초기화합니다.
 */
export function writeGpuCircleBodyCombatState(storage, index, state = {}) {
    const capacity = requireStorage(storage);
    assertGpuCircleBodyAbiVersion(storage);
    const slot = requireSlotIndex(index, capacity);
    const offset = slot * GPU_CIRCLE_BODY_ABI.COMBAT_STATE.STRIDE;
    const view = new DataView(storage.combatStateBuffer);
    const targetInteractionLayerMask = requireUint16(
        state.targetInteractionLayerMask ?? 0,
        'combatState.targetInteractionLayerMask'
    );
    const maximumDamageWindowDurationTicks
        = normalizeGpuCircleBodyMaximumDamageWindowDurationTicks(
            state.maximumDamageWindowDurationTicks ?? 0,
            'combatState.maximumDamageWindowDurationTicks'
        );
    const peakFinalDamageFixedPoint = requireInt32(
        state.peakFinalDamageFixedPoint ?? 0,
        'combatState.peakFinalDamageFixedPoint'
    );
    if (peakFinalDamageFixedPoint < 0) {
        throw new RangeError('combatState.peakFinalDamageFixedPoint는 0 이상이어야 합니다.');
    }
    const expiresAtFixedTick = requireUint32(
        state.expiresAtFixedTick ?? 0,
        'combatState.expiresAtFixedTick'
    );
    const peakSourceEntityId = requireUint32(
        state.peakSourceEntityId ?? GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT,
        'combatState.peakSourceEntityId'
    );
    const peakSourceIncarnation = requireUint32(
        state.peakSourceIncarnation ?? GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT,
        'combatState.peakSourceIncarnation'
    );
    if ((peakSourceEntityId === GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT)
        !== (peakSourceIncarnation === GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT)) {
        throw new RangeError('combatState peak source identity는 모두 valid 또는 모두 invalid여야 합니다.');
    }
    const directCoreDamageFixedPoint = requireInt32(
        state.directCoreDamageFixedPoint ?? 0,
        'combatState.directCoreDamageFixedPoint'
    );
    if (directCoreDamageFixedPoint < 0) {
        throw new RangeError('combatState.directCoreDamageFixedPoint는 0 이상이어야 합니다.');
    }
    view.setUint32(
        offset + GPU_CIRCLE_BODY_ABI.COMBAT_STATE.TARGET_INTERACTION_LAYER_MASK,
        targetInteractionLayerMask,
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset
            + GPU_CIRCLE_BODY_ABI.COMBAT_STATE
                .MAXIMUM_DAMAGE_WINDOW_DURATION_FIXED_TICKS,
        maximumDamageWindowDurationTicks,
        LITTLE_ENDIAN
    );
    view.setInt32(
        offset + GPU_CIRCLE_BODY_ABI.COMBAT_STATE.PEAK_FINAL_DAMAGE_FIXED_POINT,
        peakFinalDamageFixedPoint,
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + GPU_CIRCLE_BODY_ABI.COMBAT_STATE.EXPIRES_AT_FIXED_TICK,
        expiresAtFixedTick,
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + GPU_CIRCLE_BODY_ABI.COMBAT_STATE.PEAK_SOURCE_ENTITY_ID,
        peakSourceEntityId,
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + GPU_CIRCLE_BODY_ABI.COMBAT_STATE.PEAK_SOURCE_INCARNATION,
        peakSourceIncarnation,
        LITTLE_ENDIAN
    );
    view.setInt32(
        offset + GPU_CIRCLE_BODY_ABI.COMBAT_STATE.DIRECT_CORE_DAMAGE_FIXED_POINT,
        directCoreDamageFixedPoint,
        LITTLE_ENDIAN
    );
    for (const reservedOffset of [
        GPU_CIRCLE_BODY_ABI.COMBAT_STATE.RESERVED_1,
        GPU_CIRCLE_BODY_ABI.COMBAT_STATE.RESERVED_2,
        GPU_CIRCLE_BODY_ABI.COMBAT_STATE.RESERVED_3
    ]) {
        view.setUint32(offset + reservedOffset, 0, LITTLE_ENDIAN);
    }
    return slot;
}

/** generic combat-state side-plane 한 slot을 읽습니다. */
export function readGpuCircleBodyCombatState(storage, index) {
    const capacity = requireStorage(storage);
    assertGpuCircleBodyAbiVersion(storage);
    const slot = requireSlotIndex(index, capacity);
    const offset = slot * GPU_CIRCLE_BODY_ABI.COMBAT_STATE.STRIDE;
    const view = new DataView(storage.combatStateBuffer);
    return {
        targetInteractionLayerMask: view.getUint32(
            offset + GPU_CIRCLE_BODY_ABI.COMBAT_STATE.TARGET_INTERACTION_LAYER_MASK,
            LITTLE_ENDIAN
        ),
        maximumDamageWindowDurationTicks: view.getUint32(
            offset
                + GPU_CIRCLE_BODY_ABI.COMBAT_STATE
                    .MAXIMUM_DAMAGE_WINDOW_DURATION_FIXED_TICKS,
            LITTLE_ENDIAN
        ),
        peakFinalDamageFixedPoint: view.getInt32(
            offset + GPU_CIRCLE_BODY_ABI.COMBAT_STATE.PEAK_FINAL_DAMAGE_FIXED_POINT,
            LITTLE_ENDIAN
        ),
        expiresAtFixedTick: view.getUint32(
            offset + GPU_CIRCLE_BODY_ABI.COMBAT_STATE.EXPIRES_AT_FIXED_TICK,
            LITTLE_ENDIAN
        ),
        peakSourceEntityId: view.getUint32(
            offset + GPU_CIRCLE_BODY_ABI.COMBAT_STATE.PEAK_SOURCE_ENTITY_ID,
            LITTLE_ENDIAN
        ),
        peakSourceIncarnation: view.getUint32(
            offset + GPU_CIRCLE_BODY_ABI.COMBAT_STATE.PEAK_SOURCE_INCARNATION,
            LITTLE_ENDIAN
        ),
        directCoreDamageFixedPoint: view.getInt32(
            offset + GPU_CIRCLE_BODY_ABI.COMBAT_STATE.DIRECT_CORE_DAMAGE_FIXED_POINT,
            LITTLE_ENDIAN
        )
    };
}

/** persistent projectile-capture state 한 slot을 씁니다. */
export function writeGpuProjectileCaptureState(storage, index, source = {}) {
    const capacity = requireStorage(storage);
    assertGpuCircleBodyAbiVersion(storage);
    const slot = requireSlotIndex(index, capacity);
    const layout = GPU_CIRCLE_BODY_ABI.PROJECTILE_CAPTURE_STATE;
    const offset = slot * layout.STRIDE;
    const view = new DataView(storage.projectileCaptureStateBuffer);
    const selfEntityId = requireUint32(
        source.selfEntityId ?? GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT,
        'projectileCaptureState.selfEntityId'
    );
    const selfIncarnation = requireUint32(
        source.selfIncarnation ?? 0,
        'projectileCaptureState.selfIncarnation'
    );
    const peerBodySlot = requireUint32(
        source.peerBodySlot ?? GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT,
        'projectileCaptureState.peerBodySlot'
    );
    const peerEntityId = requireUint32(
        source.peerEntityId ?? GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT,
        'projectileCaptureState.peerEntityId'
    );
    const peerIncarnation = requireUint32(
        source.peerIncarnation ?? GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT,
        'projectileCaptureState.peerIncarnation'
    );
    const identityInvalid = GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT;
    const selfIsTombstone = selfEntityId === identityInvalid
        && selfIncarnation === 0;
    const selfIsLive = selfEntityId > 0
        && selfEntityId !== identityInvalid
        && selfIncarnation > 0
        && selfIncarnation !== identityInvalid;
    if ((!selfIsTombstone && !selfIsLive)
        || (peerEntityId === identityInvalid)
            !== (peerIncarnation === GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT)
        || (peerEntityId === GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT)
            !== (peerBodySlot === GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT)) {
        throw new RangeError('projectile capture state identity pair가 불완전합니다.');
    }
    const meta = unpackGpuProjectileCaptureStateMeta(
        packGpuProjectileCaptureStateMeta(source)
    );
    const capturedAtFixedTick = requireUint32(
        source.capturedAtFixedTick ?? 0,
        'projectileCaptureState.capturedAtFixedTick'
    );
    const releaseDueFixedTick = requireUint32(
        source.releaseDueFixedTick ?? 0,
        'projectileCaptureState.releaseDueFixedTick'
    );
    const captureSequence = requireUint32(
        source.captureSequence ?? 0,
        'projectileCaptureState.captureSequence'
    );
    const capturedSpeed = requireFloat32(
        source.capturedSpeed ?? 0,
        'projectileCaptureState.capturedSpeed'
    );
    const facingX = requireFloat32(
        source.facingX ?? 0,
        'projectileCaptureState.facingX'
    );
    const facingY = requireFloat32(
        source.facingY ?? 0,
        'projectileCaptureState.facingY'
    );
    const peerInvalid = peerBodySlot === GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT;
    const activeCapturePhase = meta.phase === GPU_PROJECTILE_CAPTURE_PHASE.HELD
        || meta.phase === GPU_PROJECTILE_CAPTURE_PHASE.RELEASE_PREPARED;
    const facingLength = Math.hypot(facingX, facingY);
    const hasAuthenticCaptureEvidence = !peerInvalid
        && capturedAtFixedTick > 0
        && releaseDueFixedTick > capturedAtFixedTick
        && captureSequence > 0
        && captureSequence !== GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT
        && capturedSpeed > 0
        && Number.isFinite(facingLength)
        && Math.abs(facingLength - 1) <= 1e-4;
    if ((!selfIsLive
            && !(meta.role === GPU_PROJECTILE_CAPTURE_ROLE.NONE
                && selfIsTombstone))
        || meta.flags !== 0
        || (meta.role === GPU_PROJECTILE_CAPTURE_ROLE.NONE
            && (meta.phase !== GPU_PROJECTILE_CAPTURE_PHASE.IDLE
                || meta.profileCode !== 0
                || meta.policyCode
                    !== GPU_PROJECTILE_CAPTURE_POLICY_CODE.NOT_CAPTURABLE
                || !peerInvalid
                || capturedAtFixedTick !== 0
                || releaseDueFixedTick !== 0
                || captureSequence !== 0
                || capturedSpeed !== 0
                || facingX !== 0
                || facingY !== 0))
        || (meta.role === GPU_PROJECTILE_CAPTURE_ROLE.CAPTOR
            && (meta.profileCode === 0
                || meta.policyCode
                    !== GPU_PROJECTILE_CAPTURE_POLICY_CODE.NOT_CAPTURABLE
                || (activeCapturePhase && !hasAuthenticCaptureEvidence)
                || (meta.phase === GPU_PROJECTILE_CAPTURE_PHASE.IDLE
                    && (!peerInvalid
                        || !Number.isFinite(facingLength)
                        || Math.abs(facingLength - 1) > 1e-4))
                || meta.phase === GPU_PROJECTILE_CAPTURE_PHASE.TOMBSTONED))
        || (meta.role === GPU_PROJECTILE_CAPTURE_ROLE.PROJECTILE
            && (meta.profileCode !== 0
                || (activeCapturePhase && !hasAuthenticCaptureEvidence)
                || (meta.phase === GPU_PROJECTILE_CAPTURE_PHASE.IDLE
                    && (!peerInvalid || facingX !== 0 || facingY !== 0))
                || (meta.phase === GPU_PROJECTILE_CAPTURE_PHASE.TOMBSTONED
                    && (!peerInvalid
                        || captureSequence === 0
                        || captureSequence
                            === GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT))))
        || (activeCapturePhase
            && meta.role !== GPU_PROJECTILE_CAPTURE_ROLE.CAPTOR
            && meta.role !== GPU_PROJECTILE_CAPTURE_ROLE.PROJECTILE)) {
        throw new RangeError(
            'projectile capture state role/phase/profile/policy invariant가 유효하지 않습니다.'
        );
    }
    view.setUint32(
        offset + layout.ROLE_PHASE_PROFILE_POLICY,
        packGpuProjectileCaptureStateMeta(meta),
        LITTLE_ENDIAN
    );
    view.setUint32(offset + layout.SELF_ENTITY_ID, selfEntityId, LITTLE_ENDIAN);
    view.setUint32(
        offset + layout.SELF_INCARNATION,
        selfIncarnation,
        LITTLE_ENDIAN
    );
    view.setUint32(offset + layout.PEER_BODY_SLOT, peerBodySlot, LITTLE_ENDIAN);
    view.setUint32(offset + layout.PEER_ENTITY_ID, peerEntityId, LITTLE_ENDIAN);
    view.setUint32(
        offset + layout.PEER_INCARNATION,
        peerIncarnation,
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + layout.CAPTURED_AT_FIXED_TICK,
        capturedAtFixedTick,
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + layout.RELEASE_DUE_FIXED_TICK,
        releaseDueFixedTick,
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + layout.CAPTURE_SEQUENCE,
        captureSequence,
        LITTLE_ENDIAN
    );
    view.setFloat32(
        offset + layout.CAPTURED_SPEED,
        capturedSpeed,
        LITTLE_ENDIAN
    );
    view.setFloat32(
        offset + layout.FACING_X,
        facingX,
        LITTLE_ENDIAN
    );
    view.setFloat32(
        offset + layout.FACING_Y,
        facingY,
        LITTLE_ENDIAN
    );
    return slot;
}

export function readGpuProjectileCaptureState(storage, index) {
    const capacity = requireStorage(storage);
    assertGpuCircleBodyAbiVersion(storage);
    const slot = requireSlotIndex(index, capacity);
    const layout = GPU_CIRCLE_BODY_ABI.PROJECTILE_CAPTURE_STATE;
    const offset = slot * layout.STRIDE;
    const view = new DataView(storage.projectileCaptureStateBuffer);
    return Object.freeze({
        ...unpackGpuProjectileCaptureStateMeta(view.getUint32(
            offset + layout.ROLE_PHASE_PROFILE_POLICY,
            LITTLE_ENDIAN
        )),
        selfEntityId: view.getUint32(offset + layout.SELF_ENTITY_ID, LITTLE_ENDIAN),
        selfIncarnation: view.getUint32(
            offset + layout.SELF_INCARNATION,
            LITTLE_ENDIAN
        ),
        peerBodySlot: view.getUint32(offset + layout.PEER_BODY_SLOT, LITTLE_ENDIAN),
        peerEntityId: view.getUint32(offset + layout.PEER_ENTITY_ID, LITTLE_ENDIAN),
        peerIncarnation: view.getUint32(
            offset + layout.PEER_INCARNATION,
            LITTLE_ENDIAN
        ),
        capturedAtFixedTick: view.getUint32(
            offset + layout.CAPTURED_AT_FIXED_TICK,
            LITTLE_ENDIAN
        ),
        releaseDueFixedTick: view.getUint32(
            offset + layout.RELEASE_DUE_FIXED_TICK,
            LITTLE_ENDIAN
        ),
        captureSequence: view.getUint32(
            offset + layout.CAPTURE_SEQUENCE,
            LITTLE_ENDIAN
        ),
        capturedSpeed: view.getFloat32(
            offset + layout.CAPTURED_SPEED,
            LITTLE_ENDIAN
        ),
        facingX: view.getFloat32(offset + layout.FACING_X, LITTLE_ENDIAN),
        facingY: view.getFloat32(offset + layout.FACING_Y, LITTLE_ENDIAN)
    });
}

export function writeGpuProjectileCaptureCandidate(
    storage,
    index,
    source = {}
) {
    const capacity = requireStorage(storage);
    assertGpuCircleBodyAbiVersion(storage);
    const slot = requireSlotIndex(index, capacity);
    const layout = GPU_CIRCLE_BODY_ABI.PROJECTILE_CAPTURE_CANDIDATE;
    const offset = slot * layout.STRIDE;
    const view = new DataView(storage.projectileCaptureCandidateBuffer);
    const distanceSquaredBits = source.distanceSquaredBits === undefined
        ? 0x7f800000
        : requireUint32(
            source.distanceSquaredBits,
            'projectileCaptureCandidate.distanceSquaredBits'
        );
    view.setUint32(
        offset + layout.DISTANCE_SQUARED_BITS,
        distanceSquaredBits,
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + layout.PEER_ENTITY_ID,
        requireUint32(
            source.peerEntityId ?? GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT,
            'projectileCaptureCandidate.peerEntityId'
        ),
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + layout.PEER_INCARNATION,
        requireUint32(
            source.peerIncarnation ?? GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT,
            'projectileCaptureCandidate.peerIncarnation'
        ),
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + layout.STATUS,
        requireUint32(source.status ?? 0, 'projectileCaptureCandidate.status'),
        LITTLE_ENDIAN
    );
    return slot;
}

function normalizeAtomicTransformIdentityPair(
    entityIdValue,
    incarnationValue,
    label,
    allowInvalid = true
) {
    const entityId = requireUint32(
        entityIdValue ?? GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT,
        `${label}.entityId`
    );
    const incarnation = requireUint32(
        incarnationValue ?? GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT,
        `${label}.incarnation`
    );
    const invalid = entityId === GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT;
    if (invalid !== (incarnation === GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT)
        || (!allowInvalid && invalid)
        || (!invalid && (entityId === 0 || incarnation === 0))) {
        throw new RangeError(`${label}는 exact pair이거나 둘 다 invalid여야 합니다.`);
    }
    return { entityId, incarnation };
}

const ATOMIC_TRANSFORM_STATE_INPUT_KEYS = new Set([
    'programId',
    'phase',
    'entityId',
    'incarnation',
    'dueFixedTick',
    'transformAtTick',
    'lineageRootEntityId',
    'lineageRootIncarnation',
    'branchIndex',
    'bountyBudget',
    'triggerSourceTick',
    'triggerSequence',
    'commandGeneration'
]);

/** J/C' atomic-transform persistent side-plane 한 slot을 완전히 씁니다. */
export function writeGpuCircleAtomicTransformState(storage, index, source = {}) {
    const capacity = requireStorage(storage);
    assertGpuCircleBodyAbiVersion(storage);
    const slot = requireSlotIndex(index, capacity);
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new TypeError('atomicTransformState는 객체여야 합니다.');
    }
    const descriptors = Object.getOwnPropertyDescriptors(source);
    const snapshot = Object.create(null);
    for (const key of Reflect.ownKeys(descriptors)) {
        if (typeof key !== 'string'
            || !ATOMIC_TRANSFORM_STATE_INPUT_KEYS.has(key)) {
            throw new RangeError(`atomicTransformState에 알 수 없는 필드가 있습니다: ${key}`);
        }
        const descriptor = descriptors[key];
        if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
            throw new TypeError(`atomicTransformState.${key}는 data property여야 합니다.`);
        }
        snapshot[key] = descriptor.value;
    }
    source = snapshot;
    const abi = GPU_CIRCLE_BODY_ABI.ATOMIC_TRANSFORM_STATE;
    const programId = requireUint32(
        source.programId ?? GPU_CIRCLE_ATOMIC_TRANSFORM_PROGRAM.NONE,
        'atomicTransformState.programId'
    );
    if (!Object.values(GPU_CIRCLE_ATOMIC_TRANSFORM_PROGRAM).includes(programId)) {
        throw new RangeError(`지원하지 않는 atomic transform program입니다: ${programId}`);
    }
    const phase = requireUint32(
        source.phase ?? GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.NONE,
        'atomicTransformState.phase'
    );
    if (!Object.values(GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE).includes(phase)) {
        throw new RangeError(`지원하지 않는 atomic transform phase입니다: ${phase}`);
    }
    if ((programId === GPU_CIRCLE_ATOMIC_TRANSFORM_PROGRAM.NONE)
        !== (phase === GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.NONE)) {
        throw new RangeError('atomic transform NONE program/phase는 함께 사용해야 합니다.');
    }
    const bodyIdentity = normalizeAtomicTransformIdentityPair(
        source.entityId,
        source.incarnation,
        'atomicTransformState.bodyIdentity',
        programId === GPU_CIRCLE_ATOMIC_TRANSFORM_PROGRAM.NONE
    );
    const lineageRoot = normalizeAtomicTransformIdentityPair(
        source.lineageRootEntityId,
        source.lineageRootIncarnation,
        'atomicTransformState.lineageRoot',
        programId === GPU_CIRCLE_ATOMIC_TRANSFORM_PROGRAM.NONE
    );
    if (source.dueFixedTick !== undefined
        && source.transformAtTick !== undefined
        && source.dueFixedTick !== source.transformAtTick) {
        throw new RangeError('atomicTransformState due/transform tick alias가 다릅니다.');
    }
    const dueFixedTick = requireUint32(
        source.dueFixedTick ?? source.transformAtTick ?? 0,
        'atomicTransformState.dueFixedTick'
    );
    const branchIndex = requireUint32(
        source.branchIndex ?? 0,
        'atomicTransformState.branchIndex'
    );
    const bountyBudget = requireUint32(
        source.bountyBudget ?? 0,
        'atomicTransformState.bountyBudget'
    );
    const triggerSourceTick = requireUint32(
        source.triggerSourceTick ?? 0,
        'atomicTransformState.triggerSourceTick'
    );
    const triggerSequence = requireUint32(
        source.triggerSequence ?? 0,
        'atomicTransformState.triggerSequence'
    );
    const commandGeneration = requireUint32(
        source.commandGeneration ?? 0,
        'atomicTransformState.commandGeneration'
    );
    if (programId === GPU_CIRCLE_ATOMIC_TRANSFORM_PROGRAM.NONE) {
        if (bodyIdentity.entityId !== GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT
            || lineageRoot.entityId !== GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT
            || phase !== GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.NONE
            || dueFixedTick !== 0
            || branchIndex !== 0
            || bountyBudget !== 0
            || triggerSourceTick !== 0
            || triggerSequence !== 0
            || commandGeneration !== 0) {
            throw new RangeError('NONE atomic transform state는 exact zero/invalid record여야 합니다.');
        }
    } else if (programId
            === GPU_CIRCLE_ATOMIC_TRANSFORM_PROGRAM.J_SPLIT_FIRST_HIT) {
        if (phase !== GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.ARMED
            && phase !== GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.SPLIT_PENDING) {
            throw new RangeError('J atomic transform phase가 올바르지 않습니다.');
        }
        if (dueFixedTick !== 0 || branchIndex > 1 || commandGeneration === 0
            || commandGeneration === GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT
            || (phase === GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.ARMED
                && (triggerSourceTick !== 0 || triggerSequence !== 0))
            || (phase === GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.SPLIT_PENDING
                && (triggerSourceTick === 0
                    || triggerSourceTick
                        === GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT
                    || triggerSequence
                        === GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT))) {
            throw new RangeError('J atomic transform state 조합이 올바르지 않습니다.');
        }
    } else if (programId
            === GPU_CIRCLE_ATOMIC_TRANSFORM_PROGRAM.C_PRIME_DELAYED_RECOMBINE) {
        if (phase !== GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE.CHILD_DELAYED
            || dueFixedTick === 0
            || dueFixedTick === GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT
            || branchIndex > 1
            || triggerSourceTick !== 0
            || triggerSequence !== 0
            || commandGeneration === 0
            || commandGeneration
                === GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT) {
            throw new RangeError('C prime atomic transform state 조합이 올바르지 않습니다.');
        }
    }
    const values = [
        [abi.PROGRAM_ID, programId],
        [abi.PHASE, phase],
        [abi.ENTITY_ID, bodyIdentity.entityId],
        [abi.INCARNATION, bodyIdentity.incarnation],
        [abi.DUE_FIXED_TICK, dueFixedTick],
        [abi.LINEAGE_ROOT_ENTITY_ID, lineageRoot.entityId],
        [abi.LINEAGE_ROOT_INCARNATION, lineageRoot.incarnation],
        [abi.BRANCH_INDEX, branchIndex],
        [abi.BOUNTY_BUDGET, bountyBudget],
        [abi.TRIGGER_SOURCE_TICK, triggerSourceTick],
        [abi.TRIGGER_SEQUENCE, triggerSequence],
        [abi.COMMAND_GENERATION, commandGeneration]
    ];
    const view = new DataView(storage.atomicTransformStateBuffer);
    const offset = slot * abi.STRIDE;
    for (const [fieldOffset, value] of values) {
        view.setUint32(offset + fieldOffset, value, LITTLE_ENDIAN);
    }
    return slot;
}

/** J/C' atomic-transform persistent side-plane 한 slot을 읽습니다. */
export function readGpuCircleAtomicTransformState(storage, index) {
    const capacity = requireStorage(storage);
    assertGpuCircleBodyAbiVersion(storage);
    const slot = requireSlotIndex(index, capacity);
    const abi = GPU_CIRCLE_BODY_ABI.ATOMIC_TRANSFORM_STATE;
    const view = new DataView(storage.atomicTransformStateBuffer);
    const offset = slot * abi.STRIDE;
    const read = (fieldOffset) => view.getUint32(offset + fieldOffset, LITTLE_ENDIAN);
    return Object.freeze({
        programId: read(abi.PROGRAM_ID),
        phase: read(abi.PHASE),
        entityId: read(abi.ENTITY_ID),
        incarnation: read(abi.INCARNATION),
        dueFixedTick: read(abi.DUE_FIXED_TICK),
        lineageRootEntityId: read(abi.LINEAGE_ROOT_ENTITY_ID),
        lineageRootIncarnation: read(abi.LINEAGE_ROOT_INCARNATION),
        branchIndex: read(abi.BRANCH_INDEX),
        bountyBudget: read(abi.BOUNTY_BUDGET),
        triggerSourceTick: read(abi.TRIGGER_SOURCE_TICK),
        triggerSequence: read(abi.TRIGGER_SEQUENCE),
        commandGeneration: read(abi.COMMAND_GENERATION)
    });
}

const ENEMY_BEHAVIOR_INPUT_KEYS = new Set([
    'programId',
    'coreDamageFixedPoint',
    'coordinateSystemCode',
    'orbitRadiusTiles',
    'angularStepQ32',
    'orbitSlotIndex',
    'orbitSlotCapacity',
    'flatReductionFixedPoint',
    'armoredFacetCount',
    'totalFacetCount',
    'windupTicks',
    'windupRangeTiles',
    'chargeSpeedTilesPerSecond',
    'chargeMaxTicks',
    'recoilImpulseTilesPerSecond',
    'recoilTicks',
    'recoverTicks',
    'telegraphStyleCode',
    'telegraphColorRgba',
    'telegraphRadiusScale'
]);

function requirePositiveUint32(value, fieldName) {
    const number = requireUint32(value, fieldName);
    if (number === 0) {
        throw new RangeError(`${fieldName}은(는) 양의 uint32여야 합니다.`);
    }
    return number;
}

function packEnemyBehaviorColorRgba8(source, fieldName) {
    if ((!Array.isArray(source) && !ArrayBuffer.isView(source))
        || source.length !== 4) {
        throw new TypeError(`${fieldName}은(는) 네 성분 배열이어야 합니다.`);
    }
    let packed = 0;
    for (let index = 0; index < 4; index++) {
        const component = requireFloat32(source[index], `${fieldName}[${index}]`);
        if (component < 0 || component > 1) {
            throw new RangeError(`${fieldName}[${index}]는 0~1 범위여야 합니다.`);
        }
        packed |= Math.round(component * UINT8_MAX) << (index * 8);
    }
    return packed >>> 0;
}

/**
 * Enemy behavior side-plane 한 slot을 spawn/replacement 권위로 씁니다. Runtime
 * target/window/direction은 authored input을 받지 않고 항상 초기 상태로 재설정합니다.
 */
export function writeGpuCircleEnemyBehaviorState(storage, index, source = {}) {
    const capacity = requireStorage(storage);
    assertGpuCircleBodyAbiVersion(storage);
    const slot = requireSlotIndex(index, capacity);
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new TypeError('enemyBehaviorState는 객체여야 합니다.');
    }
    for (const key of Object.keys(source)) {
        if (!ENEMY_BEHAVIOR_INPUT_KEYS.has(key)) {
            throw new RangeError(`enemyBehaviorState에 알 수 없는 필드가 있습니다: ${key}`);
        }
    }
    const abi = GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE;
    const offset = slot * abi.STRIDE;
    new Uint8Array(storage.enemyBehaviorStateBuffer, offset, abi.STRIDE).fill(0);
    const programId = requireUint32(
        source.programId ?? GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.NONE,
        'enemyBehaviorState.programId'
    );
    if (programId === GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.NONE) {
        if (Object.keys(source).some((key) => key !== 'programId')) {
            throw new RangeError('NONE enemy behavior에는 config 필드를 사용할 수 없습니다.');
        }
        return slot;
    }
    const view = new DataView(storage.enemyBehaviorStateBuffer);
    if (programId
        === GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.SELECTED_TARGET_PROJECTILE) {
        const allowedKeys = new Set(['programId', 'coreDamageFixedPoint']);
        for (const key of Object.keys(source)) {
            if (!allowedKeys.has(key)) {
                throw new RangeError(
                    `SELECTED_TARGET_PROJECTILE에 사용할 수 없는 config입니다: ${key}`
                );
            }
        }
        const selectedAbi = GPU_CIRCLE_SELECTED_TARGET_PROJECTILE_STATE_ABI;
        const coreDamageFixedPoint = requireInt32(
            source.coreDamageFixedPoint,
            'enemyBehaviorState.coreDamageFixedPoint'
        );
        if (coreDamageFixedPoint <= 0) {
            throw new RangeError(
                'enemyBehaviorState.coreDamageFixedPoint는 양의 int32여야 합니다.'
            );
        }
        view.setUint32(offset + selectedAbi.PROGRAM_ID, programId, LITTLE_ENDIAN);
        view.setUint32(
            offset + selectedAbi.TARGET_SLOT,
            GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT,
            LITTLE_ENDIAN
        );
        view.setUint32(
            offset + selectedAbi.TARGET_ENTITY_ID,
            GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT,
            LITTLE_ENDIAN
        );
        view.setUint32(
            offset + selectedAbi.TARGET_INCARNATION,
            GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT,
            LITTLE_ENDIAN
        );
        view.setInt32(
            offset + selectedAbi.CORE_DAMAGE_FIXED_POINT,
            coreDamageFixedPoint,
            LITTLE_ENDIAN
        );
        return slot;
    }
    if (programId === GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.OCTAGON_TOWER_ORBIT) {
        const allowedKeys = new Set([
            'programId',
            'coordinateSystemCode',
            'orbitRadiusTiles',
            'angularStepQ32',
            'orbitSlotIndex',
            'orbitSlotCapacity',
            'flatReductionFixedPoint',
            'armoredFacetCount',
            'totalFacetCount'
        ]);
        for (const key of Object.keys(source)) {
            if (!allowedKeys.has(key)) {
                throw new RangeError(
                    `OCTAGON_TOWER_ORBIT에 사용할 수 없는 config입니다: ${key}`
                );
            }
        }
        const orbitAbi = GPU_CIRCLE_OCTAGON_ORBIT_STATE_ABI;
        const coordinateSystemCode = requirePositiveUint32(
            source.coordinateSystemCode,
            'enemyBehaviorState.coordinateSystemCode'
        );
        if (coordinateSystemCode !== FORMATION_COORDINATE_SYSTEM_CODE.RING_SLOTS) {
            throw new RangeError(
                'enemyBehaviorState.coordinateSystemCode는 exact RING_SLOTS여야 합니다.'
            );
        }
        const orbitRadiusTiles = requireNonNegativeFloat32(
            source.orbitRadiusTiles,
            'enemyBehaviorState.orbitRadiusTiles'
        );
        if (orbitRadiusTiles <= 0) {
            throw new RangeError('enemyBehaviorState.orbitRadiusTiles는 양수여야 합니다.');
        }
        const angularStepQ32 = requirePositiveUint32(
            source.angularStepQ32,
            'enemyBehaviorState.angularStepQ32'
        );
        const orbitSlotCapacity = requirePositiveUint32(
            source.orbitSlotCapacity,
            'enemyBehaviorState.orbitSlotCapacity'
        );
        if (orbitSlotCapacity !== ENEMY_ORBIT_SLOT_CAPACITY) {
            throw new RangeError(
                `enemyBehaviorState.orbitSlotCapacity는 exact ${ENEMY_ORBIT_SLOT_CAPACITY}이어야 합니다.`
            );
        }
        const orbitSlotIndex = requireUint32(
            source.orbitSlotIndex,
            'enemyBehaviorState.orbitSlotIndex'
        );
        if (orbitSlotIndex >= orbitSlotCapacity) {
            throw new RangeError(
                'enemyBehaviorState.orbitSlotIndex는 materialized 0..7이어야 합니다.'
            );
        }
        const flatReductionFixedPoint = requireInt32(
            source.flatReductionFixedPoint,
            'enemyBehaviorState.flatReductionFixedPoint'
        );
        if (flatReductionFixedPoint <= 0) {
            throw new RangeError(
                'enemyBehaviorState.flatReductionFixedPoint는 양의 int32여야 합니다.'
            );
        }
        const armoredFacetCount = requireUint16(
            source.armoredFacetCount,
            'enemyBehaviorState.armoredFacetCount'
        );
        const totalFacetCount = requireUint16(
            source.totalFacetCount,
            'enemyBehaviorState.totalFacetCount'
        );
        if (armoredFacetCount !== 3
            || totalFacetCount !== ENEMY_ORBIT_SLOT_CAPACITY) {
            throw new RangeError(
                'OCTAGON_TOWER_ORBIT directional defense는 exact 3/8 facet이어야 합니다.'
            );
        }
        const facetConfig = (
            armoredFacetCount
            | (totalFacetCount << orbitAbi.TOTAL_FACET_COUNT_SHIFT)
        ) >>> 0;
        view.setUint32(offset + orbitAbi.PROGRAM_ID, programId, LITTLE_ENDIAN);
        view.setUint32(
            offset + orbitAbi.STATE,
            GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.SEEK_TOWER,
            LITTLE_ENDIAN
        );
        for (const targetField of [
            orbitAbi.TARGET_SLOT,
            orbitAbi.TARGET_ENTITY_ID,
            orbitAbi.TARGET_INCARNATION
        ]) {
            view.setUint32(
                offset + targetField,
                GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT,
                LITTLE_ENDIAN
            );
        }
        view.setFloat32(
            offset + orbitAbi.ORBIT_RADIUS_TILES,
            orbitRadiusTiles,
            LITTLE_ENDIAN
        );
        view.setUint32(
            offset + orbitAbi.COORDINATE_SYSTEM_CODE,
            coordinateSystemCode,
            LITTLE_ENDIAN
        );
        view.setUint32(
            offset + orbitAbi.ORBIT_SLOT_INDEX,
            orbitSlotIndex,
            LITTLE_ENDIAN
        );
        view.setUint32(
            offset + orbitAbi.ORBIT_SLOT_CAPACITY,
            orbitSlotCapacity,
            LITTLE_ENDIAN
        );
        view.setUint32(
            offset + orbitAbi.ANGULAR_STEP_Q32,
            angularStepQ32,
            LITTLE_ENDIAN
        );
        view.setInt32(
            offset + orbitAbi.FLAT_REDUCTION_FIXED_POINT,
            flatReductionFixedPoint,
            LITTLE_ENDIAN
        );
        view.setUint32(offset + orbitAbi.FACET_CONFIG, facetConfig, LITTLE_ENDIAN);
        return slot;
    }
    if (programId !== GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.ARROW_TOWER_CHARGE) {
        throw new RangeError(`지원하지 않는 enemy behavior program입니다: ${programId}`);
    }
    const allowedArrowKeys = new Set([
        'programId',
        'windupTicks',
        'windupRangeTiles',
        'chargeSpeedTilesPerSecond',
        'chargeMaxTicks',
        'recoilImpulseTilesPerSecond',
        'recoilTicks',
        'recoverTicks',
        'telegraphStyleCode',
        'telegraphColorRgba',
        'telegraphRadiusScale'
    ]);
    for (const key of Object.keys(source)) {
        if (!allowedArrowKeys.has(key)) {
            throw new RangeError(
                `ARROW_TOWER_CHARGE에 사용할 수 없는 config입니다: ${key}`
            );
        }
    }
    view.setUint32(offset + abi.PROGRAM_ID, programId, LITTLE_ENDIAN);
    view.setUint32(
        offset + abi.STATE,
        GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.SEEK_TOWER,
        LITTLE_ENDIAN
    );
    view.setFloat32(
        offset + abi.WINDUP_RANGE,
        requireNonNegativeFloat32(
            source.windupRangeTiles,
            'enemyBehaviorState.windupRangeTiles'
        ),
        LITTLE_ENDIAN
    );
    if (view.getFloat32(offset + abi.WINDUP_RANGE, LITTLE_ENDIAN) <= 0) {
        throw new RangeError('enemyBehaviorState.windupRangeTiles는 양수여야 합니다.');
    }
    view.setFloat32(
        offset + abi.CHARGE_SPEED,
        requireNonNegativeFloat32(
            source.chargeSpeedTilesPerSecond,
            'enemyBehaviorState.chargeSpeedTilesPerSecond'
        ),
        LITTLE_ENDIAN
    );
    if (view.getFloat32(offset + abi.CHARGE_SPEED, LITTLE_ENDIAN) <= 0) {
        throw new RangeError('enemyBehaviorState.chargeSpeedTilesPerSecond는 양수여야 합니다.');
    }
    view.setFloat32(
        offset + abi.RECOIL_IMPULSE,
        requireNonNegativeFloat32(
            source.recoilImpulseTilesPerSecond,
            'enemyBehaviorState.recoilImpulseTilesPerSecond'
        ),
        LITTLE_ENDIAN
    );
    if (view.getFloat32(offset + abi.RECOIL_IMPULSE, LITTLE_ENDIAN) <= 0) {
        throw new RangeError('enemyBehaviorState.recoilImpulseTilesPerSecond는 양수여야 합니다.');
    }
    view.setUint32(
        offset + abi.WINDUP_TICKS,
        requirePositiveUint32(source.windupTicks, 'enemyBehaviorState.windupTicks'),
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + abi.CHARGE_MAX_TICKS,
        requirePositiveUint32(source.chargeMaxTicks, 'enemyBehaviorState.chargeMaxTicks'),
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + abi.RECOIL_TICKS,
        requirePositiveUint32(source.recoilTicks, 'enemyBehaviorState.recoilTicks'),
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + abi.RECOVER_TICKS,
        requirePositiveUint32(source.recoverTicks, 'enemyBehaviorState.recoverTicks'),
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + abi.TELEGRAPH_STYLE_CODE,
        requirePositiveUint32(
            source.telegraphStyleCode,
            'enemyBehaviorState.telegraphStyleCode'
        ),
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + abi.TELEGRAPH_COLOR_RGBA8,
        packEnemyBehaviorColorRgba8(
            source.telegraphColorRgba,
            'enemyBehaviorState.telegraphColorRgba'
        ),
        LITTLE_ENDIAN
    );
    const telegraphRadiusScale = requireNonNegativeFloat32(
        source.telegraphRadiusScale,
        'enemyBehaviorState.telegraphRadiusScale'
    );
    if (telegraphRadiusScale <= 0) {
        throw new RangeError('enemyBehaviorState.telegraphRadiusScale은 양수여야 합니다.');
    }
    view.setFloat32(
        offset + abi.TELEGRAPH_RADIUS_SCALE,
        telegraphRadiusScale,
        LITTLE_ENDIAN
    );
    return slot;
}

/** Enemy behavior side-plane 한 slot의 host snapshot입니다. */
export function readGpuCircleEnemyBehaviorState(storage, index) {
    const capacity = requireStorage(storage);
    assertGpuCircleBodyAbiVersion(storage);
    const slot = requireSlotIndex(index, capacity);
    const abi = GPU_CIRCLE_BODY_ABI.ENEMY_BEHAVIOR_STATE;
    const offset = slot * abi.STRIDE;
    const view = new DataView(storage.enemyBehaviorStateBuffer);
    const programId = view.getUint32(offset + abi.PROGRAM_ID, LITTLE_ENDIAN);
    if (programId
        === GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.SELECTED_TARGET_PROJECTILE) {
        const selectedAbi = GPU_CIRCLE_SELECTED_TARGET_PROJECTILE_STATE_ABI;
        return {
            programId,
            selectedTargetKind: view.getUint32(
                offset + selectedAbi.SELECTED_TARGET_KIND,
                LITTLE_ENDIAN
            ),
            selectionSourceTick: view.getUint32(
                offset + selectedAbi.SELECTION_SOURCE_TICK,
                LITTLE_ENDIAN
            ),
            selectionSequence: view.getUint32(
                offset + selectedAbi.SELECTION_SEQUENCE,
                LITTLE_ENDIAN
            ),
            targetSlot: view.getUint32(
                offset + selectedAbi.TARGET_SLOT,
                LITTLE_ENDIAN
            ),
            targetEntityId: view.getUint32(
                offset + selectedAbi.TARGET_ENTITY_ID,
                LITTLE_ENDIAN
            ),
            targetIncarnation: view.getUint32(
                offset + selectedAbi.TARGET_INCARNATION,
                LITTLE_ENDIAN
            ),
            flags: view.getUint32(offset + selectedAbi.FLAGS, LITTLE_ENDIAN),
            attackFingerprint: view.getUint32(
                offset + selectedAbi.ATTACK_FINGERPRINT,
                LITTLE_ENDIAN
            ),
            coreDamageFixedPoint: view.getInt32(
                offset + selectedAbi.CORE_DAMAGE_FIXED_POINT,
                LITTLE_ENDIAN
            )
        };
    }
    if (programId === GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.OCTAGON_TOWER_ORBIT) {
        const orbitAbi = GPU_CIRCLE_OCTAGON_ORBIT_STATE_ABI;
        const facetConfig = view.getUint32(
            offset + orbitAbi.FACET_CONFIG,
            LITTLE_ENDIAN
        );
        return {
            programId,
            state: view.getUint32(offset + orbitAbi.STATE, LITTLE_ENDIAN),
            stateEnteredFixedTick: view.getUint32(
                offset + orbitAbi.STATE_ENTERED_FIXED_TICK,
                LITTLE_ENDIAN
            ),
            stateExpiresAtFixedTick: view.getUint32(
                offset + orbitAbi.STATE_EXPIRES_AT_FIXED_TICK,
                LITTLE_ENDIAN
            ),
            targetSlot: view.getUint32(offset + orbitAbi.TARGET_SLOT, LITTLE_ENDIAN),
            targetEntityId: view.getUint32(
                offset + orbitAbi.TARGET_ENTITY_ID,
                LITTLE_ENDIAN
            ),
            targetIncarnation: view.getUint32(
                offset + orbitAbi.TARGET_INCARNATION,
                LITTLE_ENDIAN
            ),
            flags: view.getUint32(offset + orbitAbi.FLAGS, LITTLE_ENDIAN),
            facing: Object.freeze({
                x: view.getFloat32(offset + orbitAbi.FACING_X, LITTLE_ENDIAN),
                y: view.getFloat32(offset + orbitAbi.FACING_Y, LITTLE_ENDIAN)
            }),
            orbitRadiusTiles: view.getFloat32(
                offset + orbitAbi.ORBIT_RADIUS_TILES,
                LITTLE_ENDIAN
            ),
            coordinateSystemCode: view.getUint32(
                offset + orbitAbi.COORDINATE_SYSTEM_CODE,
                LITTLE_ENDIAN
            ),
            orbitSlotIndex: view.getUint32(
                offset + orbitAbi.ORBIT_SLOT_INDEX,
                LITTLE_ENDIAN
            ),
            orbitSlotCapacity: view.getUint32(
                offset + orbitAbi.ORBIT_SLOT_CAPACITY,
                LITTLE_ENDIAN
            ),
            angularStepQ32: view.getUint32(
                offset + orbitAbi.ANGULAR_STEP_Q32,
                LITTLE_ENDIAN
            ),
            flatReductionFixedPoint: view.getInt32(
                offset + orbitAbi.FLAT_REDUCTION_FIXED_POINT,
                LITTLE_ENDIAN
            ),
            armoredFacetCount: (
                facetConfig >>> orbitAbi.ARMORED_FACET_COUNT_SHIFT
            ) & orbitAbi.FACET_COUNT_MASK,
            totalFacetCount: (
                facetConfig >>> orbitAbi.TOTAL_FACET_COUNT_SHIFT
            ) & orbitAbi.FACET_COUNT_MASK
        };
    }
    const packedColor = view.getUint32(
        offset + abi.TELEGRAPH_COLOR_RGBA8,
        LITTLE_ENDIAN
    );
    return {
        programId,
        state: view.getUint32(offset + abi.STATE, LITTLE_ENDIAN),
        stateEnteredFixedTick: view.getUint32(
            offset + abi.STATE_ENTERED_FIXED_TICK,
            LITTLE_ENDIAN
        ),
        stateExpiresAtFixedTick: view.getUint32(
            offset + abi.STATE_EXPIRES_AT_FIXED_TICK,
            LITTLE_ENDIAN
        ),
        targetSlot: view.getUint32(offset + abi.TARGET_SLOT, LITTLE_ENDIAN),
        targetEntityId: view.getUint32(offset + abi.TARGET_ENTITY_ID, LITTLE_ENDIAN),
        targetIncarnation: view.getUint32(
            offset + abi.TARGET_INCARNATION,
            LITTLE_ENDIAN
        ),
        flags: view.getUint32(offset + abi.FLAGS, LITTLE_ENDIAN),
        chargeDirection: {
            x: view.getFloat32(offset + abi.CHARGE_DIRECTION_X, LITTLE_ENDIAN),
            y: view.getFloat32(offset + abi.CHARGE_DIRECTION_Y, LITTLE_ENDIAN)
        },
        windupRangeTiles: view.getFloat32(offset + abi.WINDUP_RANGE, LITTLE_ENDIAN),
        chargeSpeedTilesPerSecond: view.getFloat32(
            offset + abi.CHARGE_SPEED,
            LITTLE_ENDIAN
        ),
        recoilImpulseTilesPerSecond: view.getFloat32(
            offset + abi.RECOIL_IMPULSE,
            LITTLE_ENDIAN
        ),
        windupTicks: view.getUint32(offset + abi.WINDUP_TICKS, LITTLE_ENDIAN),
        chargeMaxTicks: view.getUint32(offset + abi.CHARGE_MAX_TICKS, LITTLE_ENDIAN),
        recoilTicks: view.getUint32(offset + abi.RECOIL_TICKS, LITTLE_ENDIAN),
        recoverTicks: view.getUint32(offset + abi.RECOVER_TICKS, LITTLE_ENDIAN),
        telegraphStyleCode: view.getUint32(
            offset + abi.TELEGRAPH_STYLE_CODE,
            LITTLE_ENDIAN
        ),
        telegraphColorRgba8: packedColor,
        telegraphColorRgba: Object.freeze([0, 1, 2, 3].map(
            (component) => ((packedColor >>> (component * 8)) & UINT8_MAX) / UINT8_MAX
        )),
        telegraphRadiusScale: view.getFloat32(
            offset + abi.TELEGRAPH_RADIUS_SCALE,
            LITTLE_ENDIAN
        )
    };
}

/**
 * spawn을 지정 slot에 완전히 씁니다. 재사용 slot의 임시 상태도 모두 초기화합니다.
 * @param {*} storage - ABI storage입니다.
 * @param {*} index - 쓸 body slot입니다.
 * @param {*} spawn - collision-only spawn 값입니다.
 * @returns {number} 쓴 slot index입니다.
 */
export function writeGpuCircleBodySpawn(storage, index, spawn) {
    const capacity = requireStorage(storage);
    assertGpuCircleBodyAbiVersion(storage);
    const slot = requireSlotIndex(index, capacity);
    if (!spawn || typeof spawn !== 'object') {
        throw new TypeError('spawn 객체가 필요합니다.');
    }

    const positionX = readSpawnPosition(spawn, 'x');
    const positionY = readSpawnPosition(spawn, 'y');
    const velocityX = readSpawnVelocity(spawn, 'x');
    const velocityY = readSpawnVelocity(spawn, 'y');
    const radius = requireNonNegativeFloat32(spawn.radius, 'radius');
    const inverseMass = requireNonNegativeFloat32(
        spawn.inverseMass ?? spawn.invMass,
        'inverseMass'
    );
    const { useFlow, flowFieldIndex, flowSpeed } = resolveSpawnFlow(spawn);
    const { entityId, incarnation } = resolveSpawnIdentity(spawn);
    const contactHandler = normalizeGpuCircleBodyContactHandler(spawn);
    const {
        physicsMeta,
        interactionMeta,
        gameplayMeta,
        simulationMeta,
        metadata,
        damageResolutionPolicyId
    } = resolveSpawnMeta(
        spawn,
        useFlow,
        contactHandler
    );
    const lifetime = normalizeGpuCircleBodyLifetime(
        spawn.lifetime ?? GPU_CIRCLE_BODY_LIFETIME.IMMORTAL
    );
    const healthFixedPoint = resolveSpawnHealthFixedPoint(spawn);
    const combatState = resolveSpawnCombatState(
        spawn,
        contactHandler,
        metadata,
        damageResolutionPolicyId
    );
    const physicsOffset = slot * GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE;
    const simulationOffset = slot * GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE;
    const temporaryOffset = slot * GPU_CIRCLE_BODY_ABI.TEMPORARY.STRIDE;
    const physicsView = new DataView(storage.physicsBuffer);
    const simulationView = new DataView(storage.simulationBuffer);
    const temporaryView = new DataView(storage.temporaryBuffer);

    physicsView.setFloat32(
        physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.POSITION_X,
        positionX,
        LITTLE_ENDIAN
    );
    physicsView.setFloat32(
        physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.POSITION_Y,
        positionY,
        LITTLE_ENDIAN
    );
    physicsView.setFloat32(
        physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.VELOCITY_X,
        velocityX,
        LITTLE_ENDIAN
    );
    physicsView.setFloat32(
        physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.VELOCITY_Y,
        velocityY,
        LITTLE_ENDIAN
    );
    physicsView.setFloat32(
        physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.RADIUS,
        radius,
        LITTLE_ENDIAN
    );
    physicsView.setFloat32(
        physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.INVERSE_MASS,
        inverseMass,
        LITTLE_ENDIAN
    );
    physicsView.setUint32(
        physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.PHYSICAL_META,
        physicsMeta,
        LITTLE_ENDIAN
    );
    physicsView.setUint32(
        physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.INTERACTION_META,
        interactionMeta,
        LITTLE_ENDIAN
    );

    simulationView.setFloat32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.LIFETIME,
        lifetime,
        LITTLE_ENDIAN
    );
    simulationView.setInt32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.HEALTH,
        healthFixedPoint,
        LITTLE_ENDIAN
    );
    simulationView.setUint32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.GAMEPLAY_META,
        gameplayMeta,
        LITTLE_ENDIAN
    );
    simulationView.setUint32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.FLAGS,
        simulationMeta,
        LITTLE_ENDIAN
    );
    simulationView.setUint32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.FLOW_FIELD_INDEX,
        flowFieldIndex,
        LITTLE_ENDIAN
    );
    simulationView.setFloat32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.FLOW_SPEED,
        flowSpeed,
        LITTLE_ENDIAN
    );
    simulationView.setUint32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.ENTITY_ID,
        entityId,
        LITTLE_ENDIAN
    );
    simulationView.setUint32(
        simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.INCARNATION,
        incarnation,
        LITTLE_ENDIAN
    );

    temporaryView.setFloat32(
        temporaryOffset + GPU_CIRCLE_BODY_ABI.TEMPORARY.PREVIOUS_X,
        positionX,
        LITTLE_ENDIAN
    );
    temporaryView.setFloat32(
        temporaryOffset + GPU_CIRCLE_BODY_ABI.TEMPORARY.PREVIOUS_Y,
        positionY,
        LITTLE_ENDIAN
    );
    temporaryView.setFloat32(
        temporaryOffset + GPU_CIRCLE_BODY_ABI.TEMPORARY.PREDICTED_X,
        positionX,
        LITTLE_ENDIAN
    );
    temporaryView.setFloat32(
        temporaryOffset + GPU_CIRCLE_BODY_ABI.TEMPORARY.PREDICTED_Y,
        positionY,
        LITTLE_ENDIAN
    );
    temporaryView.setFloat32(
        temporaryOffset + GPU_CIRCLE_BODY_ABI.TEMPORARY.DELTA_X,
        0,
        LITTLE_ENDIAN
    );
    temporaryView.setFloat32(
        temporaryOffset + GPU_CIRCLE_BODY_ABI.TEMPORARY.DELTA_Y,
        0,
        LITTLE_ENDIAN
    );
    temporaryView.setInt32(
        temporaryOffset + GPU_CIRCLE_BODY_ABI.TEMPORARY.GRID_INDEX,
        -1,
        LITTLE_ENDIAN
    );
    temporaryView.setUint32(
        temporaryOffset + GPU_CIRCLE_BODY_ABI.TEMPORARY.PREVIOUS_FLOW_FIELD_INDEX,
        flowFieldIndex,
        LITTLE_ENDIAN
    );
    writeGpuCircleContactHandler(storage, slot, contactHandler);
    writeGpuCircleBodyCombatState(storage, slot, combatState);
    writeGpuCircleAtomicTransformState(storage, slot, {
        ...(spawn.atomicTransformState ?? {}),
        entityId: spawn.atomicTransformState?.programId
                === GPU_CIRCLE_ATOMIC_TRANSFORM_PROGRAM.NONE
            || spawn.atomicTransformState?.programId === undefined
            ? undefined
            : entityId,
        incarnation: spawn.atomicTransformState?.programId
                === GPU_CIRCLE_ATOMIC_TRANSFORM_PROGRAM.NONE
            || spawn.atomicTransformState?.programId === undefined
            ? undefined
            : incarnation
    });
    const captureSource = spawn.projectileCaptureState ?? {};
    const captureRole = captureSource.role ?? GPU_PROJECTILE_CAPTURE_ROLE.NONE;
    const velocityLength = Math.hypot(velocityX, velocityY);
    writeGpuProjectileCaptureState(storage, slot, {
        ...captureSource,
        role: captureRole,
        phase: captureSource.phase ?? GPU_PROJECTILE_CAPTURE_PHASE.IDLE,
        selfEntityId: entityId,
        selfIncarnation: captureRole === GPU_PROJECTILE_CAPTURE_ROLE.NONE
                && entityId === GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT
                && incarnation === GPU_CIRCLE_BODY_IDENTITY.INVALID_COMPONENT
            ? 0
            : incarnation,
        facingX: captureSource.facingX
            ?? (captureRole === GPU_PROJECTILE_CAPTURE_ROLE.CAPTOR
                && velocityLength > 0
                ? Math.fround(velocityX / velocityLength)
                : 0),
        facingY: captureSource.facingY
            ?? (captureRole === GPU_PROJECTILE_CAPTURE_ROLE.CAPTOR
                && velocityLength > 0
                ? Math.fround(velocityY / velocityLength)
                : 0)
    });
    writeGpuProjectileCaptureCandidate(storage, slot);
    writeGpuCircleEnemyBehaviorState(
        storage,
        slot,
        spawn.enemyBehaviorState ?? {}
    );
    return slot;
}

/**
 * 현재 body count 뒤에 spawn을 append합니다. capacity 초과는 쓰기 전에 거부합니다.
 * @param {*} storage - ABI storage입니다.
 * @param {*} spawn - collision-only spawn 값입니다.
 * @returns {number} 추가된 slot index입니다.
 */
export function appendGpuCircleBodySpawn(storage, spawn) {
    const capacity = requireStorage(storage);
    const counts = readGpuCircleBodyCounts(storage);
    if (counts.bodyCount >= capacity) {
        throw new RangeError(`GPU circle body capacity가 가득 찼습니다: ${capacity}`);
    }
    const slot = writeGpuCircleBodySpawn(storage, counts.bodyCount, spawn);
    writeGpuCircleBodyCounts(storage, {
        ...counts,
        bodyCount: counts.bodyCount + 1
    });
    return slot;
}

/**
 * body slot의 host ABI 값을 읽습니다.
 * @param {*} storage - ABI storage입니다.
 * @param {*} index - 읽을 slot입니다.
 * @returns {*} unpack된 collision-only body입니다.
 */
export function readGpuCircleBody(storage, index) {
    const capacity = requireStorage(storage);
    assertGpuCircleBodyAbiVersion(storage);
    const slot = requireSlotIndex(index, capacity);
    const physicsOffset = slot * GPU_CIRCLE_BODY_ABI.PHYSICS.STRIDE;
    const simulationOffset = slot * GPU_CIRCLE_BODY_ABI.SIMULATION.STRIDE;
    const temporaryOffset = slot * GPU_CIRCLE_BODY_ABI.TEMPORARY.STRIDE;
    const physicsView = new DataView(storage.physicsBuffer);
    const simulationView = new DataView(storage.simulationBuffer);
    const temporaryView = new DataView(storage.temporaryBuffer);
    return {
        index: slot,
        position: {
            x: physicsView.getFloat32(
                physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.POSITION_X,
                LITTLE_ENDIAN
            ),
            y: physicsView.getFloat32(
                physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.POSITION_Y,
                LITTLE_ENDIAN
            )
        },
        velocity: {
            x: physicsView.getFloat32(
                physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.VELOCITY_X,
                LITTLE_ENDIAN
            ),
            y: physicsView.getFloat32(
                physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.VELOCITY_Y,
                LITTLE_ENDIAN
            )
        },
        radius: physicsView.getFloat32(
            physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.RADIUS,
            LITTLE_ENDIAN
        ),
        inverseMass: physicsView.getFloat32(
            physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.INVERSE_MASS,
            LITTLE_ENDIAN
        ),
        physicsMeta: physicsView.getUint32(
            physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.PHYSICAL_META,
            LITTLE_ENDIAN
        ),
        interactionMeta: physicsView.getUint32(
            physicsOffset + GPU_CIRCLE_BODY_ABI.PHYSICS.INTERACTION_META,
            LITTLE_ENDIAN
        ),
        lifetime: simulationView.getFloat32(
            simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.LIFETIME,
            LITTLE_ENDIAN
        ),
        healthFixedPoint: simulationView.getInt32(
            simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.HEALTH,
            LITTLE_ENDIAN
        ),
        health: decodeGpuCircleBodyFixedPoint(simulationView.getInt32(
            simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.HEALTH,
            LITTLE_ENDIAN
        )),
        gameplayMeta: simulationView.getUint32(
            simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.GAMEPLAY_META,
            LITTLE_ENDIAN
        ),
        ...unpackGpuCircleGameplayMeta(simulationView.getUint32(
            simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.GAMEPLAY_META,
            LITTLE_ENDIAN
        )),
        simulationMeta: simulationView.getUint32(
            simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.FLAGS,
            LITTLE_ENDIAN
        ),
        flowFieldIndex: simulationView.getUint32(
            simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.FLOW_FIELD_INDEX,
            LITTLE_ENDIAN
        ),
        flowSpeed: simulationView.getFloat32(
            simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.FLOW_SPEED,
            LITTLE_ENDIAN
        ),
        entityId: simulationView.getUint32(
            simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.ENTITY_ID,
            LITTLE_ENDIAN
        ),
        incarnation: simulationView.getUint32(
            simulationOffset + GPU_CIRCLE_BODY_ABI.SIMULATION.INCARNATION,
            LITTLE_ENDIAN
        ),
        previousPosition: {
            x: temporaryView.getFloat32(
                temporaryOffset + GPU_CIRCLE_BODY_ABI.TEMPORARY.PREVIOUS_X,
                LITTLE_ENDIAN
            ),
            y: temporaryView.getFloat32(
                temporaryOffset + GPU_CIRCLE_BODY_ABI.TEMPORARY.PREVIOUS_Y,
                LITTLE_ENDIAN
            )
        },
        predictedPosition: {
            x: temporaryView.getFloat32(
                temporaryOffset + GPU_CIRCLE_BODY_ABI.TEMPORARY.PREDICTED_X,
                LITTLE_ENDIAN
            ),
            y: temporaryView.getFloat32(
                temporaryOffset + GPU_CIRCLE_BODY_ABI.TEMPORARY.PREDICTED_Y,
                LITTLE_ENDIAN
            )
        },
        positionDelta: {
            x: temporaryView.getFloat32(
                temporaryOffset + GPU_CIRCLE_BODY_ABI.TEMPORARY.DELTA_X,
                LITTLE_ENDIAN
            ),
            y: temporaryView.getFloat32(
                temporaryOffset + GPU_CIRCLE_BODY_ABI.TEMPORARY.DELTA_Y,
                LITTLE_ENDIAN
            )
        },
        gridIndex: temporaryView.getInt32(
            temporaryOffset + GPU_CIRCLE_BODY_ABI.TEMPORARY.GRID_INDEX,
            LITTLE_ENDIAN
        ),
        previousFlowFieldIndex: temporaryView.getUint32(
            temporaryOffset + GPU_CIRCLE_BODY_ABI.TEMPORARY.PREVIOUS_FLOW_FIELD_INDEX,
            LITTLE_ENDIAN
        ),
        contactHandler: readGpuCircleContactHandler(storage, slot),
        combatState: readGpuCircleBodyCombatState(storage, slot),
        atomicTransformState: readGpuCircleAtomicTransformState(storage, slot),
        projectileCaptureState: readGpuProjectileCaptureState(storage, slot),
        enemyBehaviorState: readGpuCircleEnemyBehaviorState(storage, slot)
    };
}

/**
 * 독립 GridBody ArrayBuffer를 생성합니다.
 * @param {*} capacity - grid entry capacity입니다.
 * @returns {ArrayBuffer} GridBody storage입니다.
 */
export function createGpuCircleGridBodyBuffer(capacity) {
    return new ArrayBuffer(GPU_CIRCLE_BODY_ABI.GRID_BODY.STRIDE * requireCapacity(capacity));
}

/**
 * GridBody entry를 std430 layout으로 씁니다.
 * @param {ArrayBuffer} buffer - GridBody buffer입니다.
 * @param {*} capacity - entry capacity입니다.
 * @param {*} index - 쓸 entry입니다.
 * @param {*} body - grid snapshot 값입니다.
 * @returns {void}
 */
export function writeGpuCircleGridBody(buffer, capacity, index, body) {
    const safeCapacity = requireCapacity(capacity);
    const slot = requireSlotIndex(index, safeCapacity);
    if (!(buffer instanceof ArrayBuffer)
        || buffer.byteLength !== safeCapacity * GPU_CIRCLE_BODY_ABI.GRID_BODY.STRIDE) {
        throw new TypeError('GridBody buffer 크기가 ABI/capacity와 다릅니다.');
    }
    if (!body || typeof body !== 'object') {
        throw new TypeError('GridBody 값이 필요합니다.');
    }
    const view = new DataView(buffer);
    const offset = slot * GPU_CIRCLE_BODY_ABI.GRID_BODY.STRIDE;
    view.setFloat32(
        offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.PREDICTED_X,
        requireFloat32(body.predictedPosition?.x ?? body.x, 'predictedPosition.x'),
        LITTLE_ENDIAN
    );
    view.setFloat32(
        offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.PREDICTED_Y,
        requireFloat32(body.predictedPosition?.y ?? body.y, 'predictedPosition.y'),
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.PHYSICAL_META,
        requireUint32(body.physicsMeta, 'physicsMeta'),
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.FLAGS,
        requireUint32(body.simulationMeta, 'simulationMeta'),
        LITTLE_ENDIAN
    );
    view.setFloat32(
        offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.INVERSE_MASS,
        requireNonNegativeFloat32(body.inverseMass, 'inverseMass'),
        LITTLE_ENDIAN
    );
    view.setFloat32(
        offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.RADIUS,
        requireNonNegativeFloat32(body.radius, 'radius'),
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.BODY_ID,
        requireUint32(body.bodyId, 'bodyId'),
        LITTLE_ENDIAN
    );
    view.setUint32(
        offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.INTERACTION_META,
        requireUint32(body.interactionMeta, 'interactionMeta'),
        LITTLE_ENDIAN
    );
}

/**
 * GridBody entry를 읽습니다.
 * @param {ArrayBuffer} buffer - GridBody buffer입니다.
 * @param {*} capacity - entry capacity입니다.
 * @param {*} index - 읽을 entry입니다.
 * @returns {*} unpack된 GridBody입니다.
 */
export function readGpuCircleGridBody(buffer, capacity, index) {
    const safeCapacity = requireCapacity(capacity);
    const slot = requireSlotIndex(index, safeCapacity);
    if (!(buffer instanceof ArrayBuffer)
        || buffer.byteLength !== safeCapacity * GPU_CIRCLE_BODY_ABI.GRID_BODY.STRIDE) {
        throw new TypeError('GridBody buffer 크기가 ABI/capacity와 다릅니다.');
    }
    const view = new DataView(buffer);
    const offset = slot * GPU_CIRCLE_BODY_ABI.GRID_BODY.STRIDE;
    return {
        predictedPosition: {
            x: view.getFloat32(
                offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.PREDICTED_X,
                LITTLE_ENDIAN
            ),
            y: view.getFloat32(
                offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.PREDICTED_Y,
                LITTLE_ENDIAN
            )
        },
        physicsMeta: view.getUint32(
            offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.PHYSICAL_META,
            LITTLE_ENDIAN
        ),
        simulationMeta: view.getUint32(
            offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.FLAGS,
            LITTLE_ENDIAN
        ),
        inverseMass: view.getFloat32(
            offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.INVERSE_MASS,
            LITTLE_ENDIAN
        ),
        radius: view.getFloat32(
            offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.RADIUS,
            LITTLE_ENDIAN
        ),
        bodyId: view.getUint32(
            offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.BODY_ID,
            LITTLE_ENDIAN
        ),
        interactionMeta: view.getUint32(
            offset + GPU_CIRCLE_BODY_ABI.GRID_BODY.INTERACTION_META,
            LITTLE_ENDIAN
        )
    };
}
