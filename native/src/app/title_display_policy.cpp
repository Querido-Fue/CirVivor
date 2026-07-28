#include "app/title_display_policy.h"

#include <algorithm>
#include <cmath>

namespace cirvivor::app {
namespace {

constexpr double game_aspect_ratio = 16.0 / 9.0;

[[nodiscard]] bool finiteNonNegative(const double value) noexcept {
    return std::isfinite(value) && value >= 0.0;
}

[[nodiscard]] bool validWindowSafeArea(
    const double width,
    const double height,
    const ui::layout::LogicalSafeAreaInsets& safeArea
) noexcept {
    return finiteNonNegative(safeArea.left)
        && finiteNonNegative(safeArea.top)
        && finiteNonNegative(safeArea.right)
        && finiteNonNegative(safeArea.bottom)
        && safeArea.left < width
        && safeArea.right < width - safeArea.left
        && safeArea.top < height
        && safeArea.bottom < height - safeArea.top;
}

[[nodiscard]] double insetInsideContent(
    const double outerInset,
    const double letterboxInset,
    const double maximum
) noexcept {
    return std::clamp(outerInset - letterboxInset, 0.0, maximum);
}

[[nodiscard]] bool validResolvedArea(const TitleDisplayArea& area) noexcept {
    const auto& safeArea = area.logicalSafeArea;
    return std::isfinite(area.windowOrigin.x)
        && std::isfinite(area.windowOrigin.y)
        && std::isfinite(area.logicalWidth)
        && std::isfinite(area.logicalHeight)
        && area.windowOrigin.x >= 0.0
        && area.windowOrigin.y >= 0.0
        && area.logicalWidth >= 1.0
        && area.logicalHeight >= 1.0
        && validWindowSafeArea(
            area.logicalWidth,
            area.logicalHeight,
            safeArea
        );
}

} // namespace

bool tryResolveTitleDisplayArea(
    const double windowWidth,
    const double windowHeight,
    const ui::layout::LogicalSafeAreaInsets windowSafeArea,
    const bool widescreenSupport,
    TitleDisplayArea& out
) noexcept {
    if (!std::isfinite(windowWidth)
        || !std::isfinite(windowHeight)
        || windowWidth < 1.0
        || windowHeight < 1.0
        || !validWindowSafeArea(windowWidth, windowHeight, windowSafeArea)) {
        return false;
    }

    TitleDisplayArea candidate{};
    const bool wideEnough = windowWidth / windowHeight >= game_aspect_ratio;
    if (widescreenSupport && wideEnough) {
        candidate.logicalWidth = windowWidth;
        candidate.logicalHeight = windowHeight;
        candidate.usesFullWindow = true;
    } else if (!wideEnough) {
        candidate.logicalWidth = windowWidth;
        candidate.logicalHeight = std::min(
            windowHeight,
            windowWidth / game_aspect_ratio
        );
        candidate.windowOrigin.y = (
            windowHeight - candidate.logicalHeight
        ) * 0.5;
    } else {
        candidate.logicalWidth = std::min(
            windowWidth,
            windowHeight * game_aspect_ratio
        );
        candidate.logicalHeight = windowHeight;
        candidate.windowOrigin.x = (
            windowWidth - candidate.logicalWidth
        ) * 0.5;
    }

    if (!std::isfinite(candidate.logicalWidth)
        || !std::isfinite(candidate.logicalHeight)
        || candidate.logicalWidth < 1.0
        || candidate.logicalHeight < 1.0) {
        return false;
    }

    const double rightLetterbox = windowWidth
        - candidate.windowOrigin.x - candidate.logicalWidth;
    const double bottomLetterbox = windowHeight
        - candidate.windowOrigin.y - candidate.logicalHeight;
    candidate.logicalSafeArea.left = insetInsideContent(
        windowSafeArea.left,
        candidate.windowOrigin.x,
        candidate.logicalWidth
    );
    candidate.logicalSafeArea.right = insetInsideContent(
        windowSafeArea.right,
        rightLetterbox,
        candidate.logicalWidth - candidate.logicalSafeArea.left
    );
    candidate.logicalSafeArea.top = insetInsideContent(
        windowSafeArea.top,
        candidate.windowOrigin.y,
        candidate.logicalHeight
    );
    candidate.logicalSafeArea.bottom = insetInsideContent(
        windowSafeArea.bottom,
        bottomLetterbox,
        candidate.logicalHeight - candidate.logicalSafeArea.top
    );
    if (!validResolvedArea(candidate)) {
        return false;
    }

    out = candidate;
    return true;
}

ui::layout::PointD titleLocalPoint(
    const ui::layout::PointD windowPoint,
    const TitleDisplayArea& area
) noexcept {
    return {
        windowPoint.x - area.windowOrigin.x,
        windowPoint.y - area.windowOrigin.y
    };
}

} // namespace cirvivor::app
