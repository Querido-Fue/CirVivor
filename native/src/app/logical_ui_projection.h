#pragma once

#include <type_traits>

namespace cirvivor::app {

struct LogicalUiProjectionPoint final {
    double x = 0.0;
    double y = 0.0;

    constexpr bool operator==(const LogicalUiProjectionPoint&) const noexcept = default;
};

struct LogicalUiProjectionSize final {
    double width = 0.0;
    double height = 0.0;

    constexpr bool operator==(const LogicalUiProjectionSize&) const noexcept = default;
};

struct LogicalUiProjectionRect final {
    double x = 0.0;
    double y = 0.0;
    double width = 0.0;
    double height = 0.0;

    constexpr bool operator==(const LogicalUiProjectionRect&) const noexcept = default;
};

/**
 * SDL이나 render 계층 타입에 의존하지 않는 pointer 투영 입력입니다.
 * drawableContentRect는 drawable 픽셀 공간, logicalContentRect는 논리 UI 공간입니다.
 * drawablePixelsPerLogicalUnitX/Y는 renderer가 실제 uniform에 기록한 배율입니다.
 */
struct LogicalUiProjection final {
    LogicalUiProjectionSize windowSize{};
    LogicalUiProjectionSize drawableSize{};
    LogicalUiProjectionRect drawableContentRect{};
    LogicalUiProjectionRect logicalContentRect{};
    double drawablePixelsPerLogicalUnitX = 0.0;
    double drawablePixelsPerLogicalUnitY = 0.0;

    constexpr bool operator==(const LogicalUiProjection&) const noexcept = default;
};

/**
 * window 좌표를 drawable 픽셀과 content rect를 거쳐 논리 UI 좌표로 변환합니다.
 * 레터박스 밖의 좌표도 clamp하지 않습니다. 실패 시 out을 변경하지 않습니다.
 */
[[nodiscard]] bool tryProjectWindowPointToLogicalUi(
    LogicalUiProjectionPoint windowPoint,
    const LogicalUiProjection& projection,
    LogicalUiProjectionPoint& out
) noexcept;

static_assert(std::is_trivially_copyable_v<LogicalUiProjectionPoint>);
static_assert(std::is_standard_layout_v<LogicalUiProjectionPoint>);
static_assert(std::is_trivially_copyable_v<LogicalUiProjectionSize>);
static_assert(std::is_standard_layout_v<LogicalUiProjectionSize>);
static_assert(std::is_trivially_copyable_v<LogicalUiProjectionRect>);
static_assert(std::is_standard_layout_v<LogicalUiProjectionRect>);
static_assert(std::is_trivially_copyable_v<LogicalUiProjection>);
static_assert(std::is_standard_layout_v<LogicalUiProjection>);

} // namespace cirvivor::app
