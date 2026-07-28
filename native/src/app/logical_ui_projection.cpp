#include "app/logical_ui_projection.h"

#include <cmath>

namespace cirvivor::app {
namespace {

[[nodiscard]] bool finitePoint(const LogicalUiProjectionPoint point) noexcept {
    return std::isfinite(point.x) && std::isfinite(point.y);
}

[[nodiscard]] bool finitePositiveSize(const LogicalUiProjectionSize size) noexcept {
    return std::isfinite(size.width)
        && std::isfinite(size.height)
        && size.width > 0.0
        && size.height > 0.0;
}

[[nodiscard]] bool finitePositive(const double value) noexcept {
    return std::isfinite(value) && value > 0.0;
}

[[nodiscard]] bool finitePositiveRect(const LogicalUiProjectionRect rect) noexcept {
    return std::isfinite(rect.x)
        && std::isfinite(rect.y)
        && std::isfinite(rect.width)
        && std::isfinite(rect.height)
        && rect.width > 0.0
        && rect.height > 0.0;
}

[[nodiscard]] bool containedInDrawable(
    const LogicalUiProjectionRect rect,
    const LogicalUiProjectionSize drawableSize
) noexcept {
    return finitePositiveRect(rect)
        && finitePositiveSize(drawableSize)
        && rect.x >= 0.0
        && rect.y >= 0.0
        && rect.x <= drawableSize.width
        && rect.y <= drawableSize.height
        && rect.width <= drawableSize.width - rect.x
        && rect.height <= drawableSize.height - rect.y;
}

} // namespace

bool tryProjectWindowPointToLogicalUi(
    const LogicalUiProjectionPoint windowPoint,
    const LogicalUiProjection& projection,
    LogicalUiProjectionPoint& out
) noexcept {
    if (!finitePoint(windowPoint)
        || !finitePositiveSize(projection.windowSize)
        || !containedInDrawable(
            projection.drawableContentRect,
            projection.drawableSize
        )
        || !finitePositiveRect(projection.logicalContentRect)
        || !finitePositive(projection.drawablePixelsPerLogicalUnitX)
        || !finitePositive(projection.drawablePixelsPerLogicalUnitY)) {
        return false;
    }

    const double drawableScaleX = projection.drawableSize.width
        / projection.windowSize.width;
    const double drawableScaleY = projection.drawableSize.height
        / projection.windowSize.height;
    if (!std::isfinite(drawableScaleX)
        || !std::isfinite(drawableScaleY)) {
        return false;
    }

    const LogicalUiProjectionPoint drawablePoint{
        windowPoint.x * drawableScaleX,
        windowPoint.y * drawableScaleY
    };
    const LogicalUiProjectionPoint candidate{
        projection.logicalContentRect.x
            + (drawablePoint.x - projection.drawableContentRect.x)
                / projection.drawablePixelsPerLogicalUnitX,
        projection.logicalContentRect.y
            + (drawablePoint.y - projection.drawableContentRect.y)
                / projection.drawablePixelsPerLogicalUnitY
    };
    if (!finitePoint(drawablePoint) || !finitePoint(candidate)) {
        return false;
    }

    out = candidate;
    return true;
}

} // namespace cirvivor::app
