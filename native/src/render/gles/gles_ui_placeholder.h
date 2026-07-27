#pragma once

#include "render/common/render_command.h"
#include "render/gles/gles_backend.h"

#include <cstdint>

namespace cirvivor::render::gles::detail {

enum class GeometryOutcome : std::uint8_t {
    drawn = 0,
    skipped = 1
};

struct UiPlaceholderPaint final {
    bool shouldDraw = false;
    PremultipliedRgba color = PremultipliedRgba::transparent();

    constexpr bool operator==(const UiPlaceholderPaint&) const noexcept = default;
};

/**
 * GLES 단색 UI placeholder가 사용할 첫 실제 paint를 고릅니다. 세 paint가 모두
 * 완전 투명이면 진단색을 만들지 않고 의도적인 no-op으로 분류합니다.
 */
[[nodiscard]] constexpr UiPlaceholderPaint selectUiPlaceholderPaint(
    const UiCommand& command
) noexcept {
    if (command.backgroundColor.alpha > 0.0F) {
        return {true, command.backgroundColor};
    }
    if (command.accentColor.alpha > 0.0F) {
        return {true, command.accentColor};
    }
    if (command.borderColor.alpha > 0.0F) {
        return {true, command.borderColor};
    }
    return {};
}

/** GLES 명령 하나의 결과를 중복 진단 축을 포함한 frame 통계에 기록합니다. */
constexpr void recordCommandOutcome(
    GlesRenderStats& stats,
    const GeometryOutcome outcome,
    const bool placeholder,
    const bool supportedShape
) noexcept {
    if (placeholder) {
        ++stats.placeholderCommands;
    }
    if (supportedShape) {
        ++stats.supportedShapeCommands;
    }
    if (outcome == GeometryOutcome::drawn) {
        ++stats.renderedCommands;
    } else {
        ++stats.skippedCommands;
    }
}

/**
 * UI placeholder의 paint 선택, no-op 판정, draw 결과 통계 기록을 한 경로로 묶습니다.
 * Draw는 선택된 PMA 색을 받아 GeometryOutcome을 반환해야 합니다.
 */
template <typename Draw>
void dispatchUiPlaceholder(
    const UiCommand& command,
    GlesRenderStats& stats,
    Draw&& draw
) noexcept {
    const UiPlaceholderPaint paint = selectUiPlaceholderPaint(command);
    if (!paint.shouldDraw) {
        ++stats.noOpCommands;
        return;
    }
    recordCommandOutcome(stats, draw(paint.color), true, false);
}

} // namespace cirvivor::render::gles::detail
