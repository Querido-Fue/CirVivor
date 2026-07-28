#pragma once

#include "render/common/pre_shaped_text.h"
#include "render/frontend/debug_telemetry_hud.h"
#include "render/frontend/frame_packet_builder.h"
#include "ui/layout/ui_layout_metrics.h"
#include "ui/title_overlay_content.h"
#include "ui/title_overlay_state_machine.h"
#include "ui/title_ui_controller.h"

#include <cstddef>
#include <cstdint>

namespace cirvivor::render::frontend {

inline constexpr std::int32_t title_effect_surface_layer_order = 10'000;
inline constexpr std::int32_t title_ui_surface_layer_order = 10'001;
inline constexpr std::int32_t title_tooltip_surface_layer_order = 190'000;

struct OverlaySurfaceLayerOrders final {
    std::int32_t dim = 0;
    std::int32_t effect = 0;
    std::int32_t ui = 0;
    std::int32_t floatingEffect = 0;
    std::int32_t floatingUi = 0;

    constexpr bool operator==(const OverlaySurfaceLayerOrders&) const noexcept = default;
};

enum class TitleSceneMissingCapability : std::uint32_t {
    none = 0U,
    preShapedTextResources = 1U << 0U,
    mapSelectContent = 1U << 1U,
    deckContent = 1U << 2U,
    settingContent = 1U << 3U,
    creditsContent = 1U << 4U,
    quickStartContent = 1U << 5U,
    recordsContent = 1U << 6U,
    researchContent = 1U << 7U,
    achievementsContent = 1U << 8U,
    debugOverlayShell = 1U << 9U,
    unsupportedOverlay = 1U << 10U
};

using TitleSceneMissingCapabilities = std::uint32_t;

[[nodiscard]] constexpr TitleSceneMissingCapabilities titleSceneCapabilityBit(
    const TitleSceneMissingCapability capability
) noexcept {
    return static_cast<TitleSceneMissingCapabilities>(capability);
}

[[nodiscard]] constexpr bool titleSceneCapabilityIsMissing(
    const TitleSceneMissingCapabilities capabilities,
    const TitleSceneMissingCapability capability
) noexcept {
    return (capabilities & titleSceneCapabilityBit(capability)) != 0U;
}

struct TitleSceneInput final {
    const ui::UiStateSnapshot& uiState;
    const ui::TitleUiControllerSnapshot& interaction;
    const ui::layout::UiLayoutSnapshot& layout;
    const ui::layout::TitleEntranceRenderState& entrance;
    const ui::layout::ThemeMetrics& theme;
    PreShapedTextResourcesView textResources{};
    UiTextLocale locale = UiTextLocale::korean;
    /** null이면 build 함수가 동일 DTO를 stack-local로 구성하는 test 호환 경로입니다. */
    const ui::TitleOverlayPresentationSet* overlayPresentations = nullptr;
    bool disableTransparency = false;
    /** Debug panel open/close와 독립적인 profiler/pool/hitbox 표시 snapshot입니다. */
    const DebugTelemetryHudInput* debugTelemetry = nullptr;
};

struct TitleSceneConfig final {
    SizeI physicalDisplaySize{1'280, 720};
    RectI physicalWindowBounds{0, 0, 1'280, 720};
    SizeI drawableSize{1'280, 720};
    InsetsI drawableSafeArea{};
    float dpiScale = 1.0F;
    std::uint64_t projectionRevision = 1U;
    /** backdrop content 자체가 바뀔 때만 증가시키는 glass capture revision입니다. */
    std::uint64_t backdropRevision = 1U;
    std::uint64_t frameId = 1U;
    std::uint64_t simulationTick = 0U;
    double presentationTimeSeconds = -1.0;
    float interpolationAlpha = 0.0F;
};

struct TitleSceneCommandStats final {
    std::size_t totalCommands = 0U;
    std::size_t titleShellCommands = 0U;
    std::size_t placeholderGeometryCommands = 0U;
    std::size_t overlayDimCommands = 0U;
    std::size_t overlayPassCommands = 0U;
    std::size_t mapSelectShellCommands = 0U;
    std::size_t exitShellCommands = 0U;
    std::size_t externalLinkShellCommands = 0U;
    std::size_t titleOverlayContentCommands = 0U;
    std::size_t shapedTextCommands = 0U;
    std::size_t resourceBackedCommands = 0U;

    constexpr bool operator==(const TitleSceneCommandStats&) const noexcept = default;
};

struct TitleSceneResult final {
    bool success = false;
    FrameBuildError error = FrameBuildError::none;
    TitleSceneMissingCapabilities missingCapabilities = 0U;
    FramePacketCapacity requiredCapacity{};
    TitleSceneCommandStats commandStats{};
};

/**
 * OverlayManager의 surface 순서를 overflow 없이 계산합니다. closing entry도
 * manager key와 sequence를 유지하므로 동일한 순서 공식을 사용합니다.
 */
[[nodiscard]] bool tryResolveOverlaySurfaceLayerOrders(
    const ui::OverlaySnapshot& overlay,
    OverlaySurfaceLayerOrders& out
) noexcept;

/** FramePacket v2의 command 및 모든 auxiliary storage를 정확히 산출합니다. */
[[nodiscard]] FramePacketCapacity titleSceneCapacity(
    const TitleSceneInput& input
) noexcept;

/** 앱 초기화 시 한 번 reserve할 수 있는 4-overlay supported shell 상한입니다. */
[[nodiscard]] constexpr FramePacketCapacity maximumTitleSceneCapacity() noexcept {
    FramePacketCapacity capacity{};
    capacity.commandCount = 512U;
    capacity.shapeCount = 128U;
    capacity.lineCount = 64U;
    capacity.uiCount = 128U;
    capacity.overlayCount = 20U;
    capacity.gradientCount = 1U;
    capacity.gradientStopCount = ui::layout::title_gradient_color_count;
    capacity.clipCount = 12U;
    capacity.passCount = 16U;
    capacity.glyphRunCount = 128U;
    capacity.glyphInstanceCount = 8'192U;
    return additiveFramePacketCapacity(
        capacity,
        additiveFramePacketCapacity(
            maximumDebugPoolHudCapacity(),
            maximumDebugTopHudCapacity()
        )
    );
}

/** logical layout과 physical/drawable/DPI 정보를 분리해 title viewport를 만듭니다. */
[[nodiscard]] ViewportState makeTitleViewport(
    const ui::layout::UiLayoutSnapshot& layout,
    const TitleSceneConfig& config = {}
) noexcept;

/**
 * 사전 reserve된 packet에 fixed-capacity transaction으로 title shell을 기록합니다.
 * 지원되는 dialog shell과 dim을 기록하며, 아직 없는 본문은 missingCapabilities로 노출합니다.
 */
[[nodiscard]] TitleSceneResult buildTitleScene(
    FramePacket& packet,
    const TitleSceneInput& input,
    const TitleSceneConfig& config = {}
);

} // namespace cirvivor::render::frontend
