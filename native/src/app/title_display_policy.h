#pragma once

#include "ui/layout/ui_layout_metrics.h"

#include <type_traits>

namespace cirvivor::app {

/**
 * SDL window 좌표 안에서 title canvas가 차지하는 content-local 논리 영역입니다.
 * 레터박스 원점은 pointer 변환에, 크기와 safe area는 title layout에 공유합니다.
 */
struct TitleDisplayArea final {
    ui::layout::PointD windowOrigin{};
    double logicalWidth = 0.0;
    double logicalHeight = 0.0;
    ui::layout::LogicalSafeAreaInsets logicalSafeArea{};
    /** widescreen 설정으로 16:9 contain 대신 전체 window를 선택했음을 나타냅니다. */
    bool usesFullWindow = false;

    constexpr bool operator==(const TitleDisplayArea&) const noexcept = default;
};

/**
 * JS ScreenHandler의 16:9 contain/full-ultrawide 정책을 해석합니다.
 * 실패 시 out을 변경하지 않습니다.
 */
[[nodiscard]] bool tryResolveTitleDisplayArea(
    double windowWidth,
    double windowHeight,
    ui::layout::LogicalSafeAreaInsets windowSafeArea,
    bool widescreenSupport,
    TitleDisplayArea& out
) noexcept;

/** window 좌표를 clamp하지 않고 title content-local 좌표로 옮깁니다. */
[[nodiscard]] ui::layout::PointD titleLocalPoint(
    ui::layout::PointD windowPoint,
    const TitleDisplayArea& area
) noexcept;

static_assert(std::is_trivially_copyable_v<TitleDisplayArea>);
static_assert(std::is_standard_layout_v<TitleDisplayArea>);

} // namespace cirvivor::app
