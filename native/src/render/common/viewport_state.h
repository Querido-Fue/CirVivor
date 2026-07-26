#pragma once

#include "render/common/render_command.h"

#include <cstdint>
#include <type_traits>

namespace cirvivor::render {

/**
 * OS가 보고하는 물리 픽셀 공간입니다. 창 위치와 모니터 크기는 swapchain drawable
 * 크기와 독립적으로 보존합니다.
 */
struct PhysicalPixelViewport final {
    SizeI displaySize;
    RectI windowBounds;
    float dpiScale = 1.0F;

    constexpr bool operator==(const PhysicalPixelViewport&) const noexcept = default;
};

/**
 * 실제 렌더 타깃의 drawable 픽셀 공간입니다. contentRect는 16:9 letterbox를 제외한
 * 표시 영역이고 safeArea는 contentRect 경계 기준의 drawable 픽셀 inset입니다.
 */
struct DrawablePixelViewport final {
    SizeI size;
    RectI contentRect;
    InsetsI safeArea;
    SizeI worldRenderTargetSize;
    float worldRenderScale = 1.0F;

    constexpr bool operator==(const DrawablePixelViewport&) const noexcept = default;
};

/**
 * 16:9 기준 UI를 표현하는 논리 공간입니다. X/Y는 동일한 drawable 배율을 사용하며
 * drawable contentRect의 offset은 backend projection에 적용됩니다.
 */
struct LogicalUiViewport final {
    SizeF size;
    RectF contentRect;
    InsetsF safeArea;
    float drawablePixelsPerLogicalUnitX = 1.0F;
    float drawablePixelsPerLogicalUnitY = 1.0F;
    float uiScale = 1.0F;

    constexpr bool operator==(const LogicalUiViewport&) const noexcept = default;
};

/**
 * 타일 기반 gameplay 좌표를 drawable 픽셀로 투영하는 월드 공간입니다. resize는
 * 이 투영과 revision만 바꾸며 simulation의 위치나 collider를 재스케일하지 않습니다.
 */
struct WorldViewport final {
    RectF visibleBounds;
    Mat3F worldToDrawable;
    Mat3F drawableToWorld;
    float drawablePixelsPerWorldUnit = 1.0F;
    std::uint64_t projectionRevision = 0;

    constexpr bool operator==(const WorldViewport&) const noexcept = default;
};

struct ViewportState final {
    PhysicalPixelViewport physical;
    DrawablePixelViewport drawable;
    LogicalUiViewport logicalUi;
    WorldViewport world;

    constexpr bool operator==(const ViewportState&) const noexcept = default;
};

static_assert(std::is_trivially_copyable_v<PhysicalPixelViewport>);
static_assert(std::is_trivially_copyable_v<DrawablePixelViewport>);
static_assert(std::is_trivially_copyable_v<LogicalUiViewport>);
static_assert(std::is_trivially_copyable_v<WorldViewport>);
static_assert(std::is_trivially_copyable_v<ViewportState>);

} // namespace cirvivor::render
