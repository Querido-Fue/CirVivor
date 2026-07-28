#pragma once

#include "debug/debug_performance_tracker.h"
#include "render/common/pre_shaped_text.h"
#include "render/frontend/frame_packet_builder.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <type_traits>

namespace cirvivor::render::frontend {

inline constexpr std::size_t maximum_debug_pool_usage_count = 3U;
inline constexpr std::size_t maximum_debug_hitbox_circle_count = 32U;
inline constexpr std::size_t maximum_debug_numeric_token_glyph_count = 64U;
inline constexpr std::size_t maximum_debug_static_text_glyph_count = 256U;

inline constexpr std::int32_t debug_pool_hud_layer_order = 180'000;
inline constexpr std::int32_t debug_hitbox_layer_order = -200;
inline constexpr std::int32_t debug_frame_hud_layer_order = -100;

enum class DebugPoolKind : std::uint8_t {
    physicsBodies,
    frameCommands,
    glyphAtlas,
    count
};

struct DebugPoolUsage final {
    DebugPoolKind kind = DebugPoolKind::physicsBodies;
    std::uint64_t active = 0U;
    std::uint64_t allocated = 0U;
    std::uint64_t capacity = 0U;

    constexpr bool operator==(const DebugPoolUsage&) const noexcept = default;
};

struct DebugHitboxCircle final {
    Vec2F center{};
    float radius = 0.0F;
    float strokeWidth = 0.0F;
    PremultipliedRgba color = PremultipliedRgba::transparent();

    constexpr bool operator==(const DebugHitboxCircle&) const noexcept = default;
};

/**
 * Debug runtime과 scene이 채우고 HUD composer가 한 frame 동안만 빌려 쓰는
 * 고정 용량 값 snapshot입니다. panel의 open/close 상태와는 독립적입니다.
 */
struct DebugTelemetryHudInput final {
    bool showFrameTime = false;
    bool showPoolInfo = false;
    bool showHitboxes = false;
    debug::DebugPerformanceSnapshot performance{};
    std::array<DebugPoolUsage, maximum_debug_pool_usage_count> pools{};
    std::uint8_t poolCount = 0U;
    std::array<DebugHitboxCircle, maximum_debug_hitbox_circle_count> hitboxes{};
    std::uint8_t hitboxCount = 0U;
    PreShapedTextResourcesView textResources{};
    UiTextLocale locale = UiTextLocale::korean;
};

/** 최대 3개 pool panel의 구조 및 보조 저장소 상한입니다. */
[[nodiscard]] constexpr FramePacketCapacity maximumDebugPoolHudCapacity() noexcept {
    FramePacketCapacity capacity{};
    capacity.commandCount = 7U; // panel + (label + numeric token) * 3
    capacity.uiCount = 1U;
    capacity.glyphRunCount = 6U;
    capacity.glyphInstanceCount = 1'024U;
    return capacity;
}

/** 최대 32개 circle과 5-section frame profiler panel의 상한입니다. */
[[nodiscard]] constexpr FramePacketCapacity maximumDebugTopHudCapacity() noexcept {
    FramePacketCapacity capacity{};
    capacity.commandCount = 44U; // 32 circles + panel/header + 5 * 2 rows
    capacity.shapeCount = maximum_debug_hitbox_circle_count;
    capacity.uiCount = 1U;
    capacity.glyphRunCount = 11U;
    capacity.glyphInstanceCount = 2'048U;
    return capacity;
}

/**
 * 활성 flag가 없으면 빈 text resource도 valid no-op입니다. text HUD가 활성화되면
 * resource/locale를, world hitbox만 활성화되면 geometry DTO만 선검증합니다.
 */
[[nodiscard]] bool debugTelemetryHudInputIsValid(
    const DebugTelemetryHudInput& input
) noexcept;

/** 현재 표시할 pool 행의 정확한 순수 증분 capacity입니다. */
[[nodiscard]] FramePacketCapacity debugPoolHudCapacity(
    const DebugTelemetryHudInput& input
) noexcept;

/** 현재 표시할 hitbox와 frame profiler의 정확한 순수 증분 capacity입니다. */
[[nodiscard]] FramePacketCapacity debugTopHudCapacity(
    const DebugTelemetryHudInput& input
) noexcept;

/** overlay보다 먼저 호출해 logical UI 좌하단 pool HUD를 기록합니다. */
[[nodiscard]] bool addDebugPoolHud(
    FramePacketBuilder& builder,
    const DebugTelemetryHudInput& input
);

/** overlay 뒤에 호출해 world hitbox와 logical UI 좌상단 profiler를 기록합니다. */
[[nodiscard]] bool addDebugTopHud(
    FramePacketBuilder& builder,
    const DebugTelemetryHudInput& input
);

static_assert(std::is_trivially_copyable_v<DebugPoolUsage>);
static_assert(std::is_trivially_copyable_v<DebugHitboxCircle>);
static_assert(std::is_trivially_copyable_v<DebugTelemetryHudInput>);
static_assert(std::is_standard_layout_v<DebugPoolUsage>);
static_assert(std::is_standard_layout_v<DebugHitboxCircle>);
static_assert(std::is_standard_layout_v<DebugTelemetryHudInput>);

} // namespace cirvivor::render::frontend
