#include "render/frontend/title_scene.h"
#include "render/text/title_text_catalog.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <exception>
#include <iostream>
#include <limits>
#include <new>
#include <span>
#include <stdexcept>
#include <string>
#include <string_view>

namespace allocation_probe {

thread_local bool enabled = false;
thread_local std::size_t count = 0U;

} // namespace allocation_probe

void* operator new(const std::size_t size) {
    if (allocation_probe::enabled) {
        ++allocation_probe::count;
    }
    if (void* const memory = std::malloc(size == 0U ? 1U : size)) {
        return memory;
    }
    throw std::bad_alloc();
}

void* operator new[](const std::size_t size) {
    return ::operator new(size);
}

void operator delete(void* const memory) noexcept {
    std::free(memory);
}

void operator delete[](void* const memory) noexcept {
    ::operator delete(memory);
}

void operator delete(void* const memory, const std::size_t) noexcept {
    ::operator delete(memory);
}

void operator delete[](void* const memory, const std::size_t) noexcept {
    ::operator delete(memory);
}

namespace {

using cirvivor::render::CommandHeader;
using cirvivor::render::CommandKind;
using cirvivor::render::CommandRef;
using cirvivor::render::BlendMode;
using cirvivor::render::CoordinateSpace;
using cirvivor::render::FrameMetadata;
using cirvivor::render::FramePacket;
using cirvivor::render::FramePacketCapacity;
using cirvivor::render::LineCap;
using cirvivor::render::OverlayOperation;
using cirvivor::render::PassOperation;
using cirvivor::render::PremultipliedRgba;
using cirvivor::render::RectF;
using cirvivor::render::RenderLayer;
using cirvivor::render::UiStateFlag;
using cirvivor::render::UiCommand;
using cirvivor::render::UiPrimitive;
using cirvivor::render::uiStateBits;
using cirvivor::render::frontend::FrameBuildError;
using cirvivor::render::frontend::FramePacketBuilder;
using cirvivor::render::frontend::OverlaySurfaceLayerOrders;
using cirvivor::render::frontend::PacketCapacityPolicy;
using cirvivor::render::frontend::TitleSceneConfig;
using cirvivor::render::frontend::TitleSceneInput;
using cirvivor::render::frontend::TitleSceneMissingCapability;
using cirvivor::render::frontend::buildTitleScene;
using cirvivor::render::frontend::maximumTitleSceneCapacity;
using cirvivor::render::frontend::titleSceneCapabilityIsMissing;
using cirvivor::render::frontend::titleSceneCapacity;
using cirvivor::render::frontend::title_effect_surface_layer_order;
using cirvivor::render::frontend::title_tooltip_surface_layer_order;
using cirvivor::render::frontend::title_ui_surface_layer_order;
using cirvivor::render::frontend::tryResolveOverlaySurfaceLayerOrders;
using cirvivor::ui::OverlayKind;
using cirvivor::ui::TitleOverlayStateMachine;
using cirvivor::ui::TitleUiControllerSnapshot;
using cirvivor::ui::TitleUiTarget;
using cirvivor::ui::UiAction;
using cirvivor::ui::UiActionStatus;
using cirvivor::ui::UiStateSnapshot;
using cirvivor::ui::layout::LayoutInput;
using cirvivor::ui::layout::LogicalSafeAreaInsets;
using cirvivor::ui::layout::OverlayDialogRenderMetrics;
using cirvivor::ui::layout::TitleEntranceRenderState;
using cirvivor::ui::layout::UiLayoutMetrics;
using cirvivor::ui::layout::UiLayoutSnapshot;
using cirvivor::ui::layout::darkThemeMetrics;
using cirvivor::ui::layout::trySampleTitleEntrance;
using cirvivor::ui::layout::tryResolveOverlayDialogRenderMetrics;

class TestFailure final : public std::runtime_error {
public:
    using std::runtime_error::runtime_error;
};

void require(
    const bool condition,
    const std::string_view expression,
    const std::string_view file,
    const int line
) {
    if (!condition) {
        throw TestFailure(
            std::string(file) + ':' + std::to_string(line)
            + " requirement failed: " + std::string(expression)
        );
    }
}

void requireNear(
    const double actual,
    const double expected,
    const double tolerance,
    const std::string_view expression,
    const std::string_view file,
    const int line
) {
    if (!std::isfinite(actual) || std::abs(actual - expected) > tolerance) {
        throw TestFailure(
            std::string(file) + ':' + std::to_string(line)
            + " requirement failed: " + std::string(expression)
        );
    }
}

#define REQUIRE(expression) require((expression), #expression, __FILE__, __LINE__)
#define REQUIRE_NEAR(actual, expected, tolerance) \
    requireNear((actual), (expected), (tolerance), #actual " ~= " #expected, __FILE__, __LINE__)

[[nodiscard]] UiLayoutSnapshot buildLayout(
    const double width,
    const double height,
    const LogicalSafeAreaInsets safeArea = {},
    const double uiScale = 1.0,
    const bool hasVersionHistoryLink = true
) {
    UiLayoutMetrics metrics;
    REQUIRE(metrics.tryUpdate({
        width,
        height,
        uiScale,
        hasVersionHistoryLink,
        safeArea
    }));
    return metrics.snapshot();
}

[[nodiscard]] TitleEntranceRenderState buildEntrance(
    const UiLayoutSnapshot& layout,
    const double elapsedSeconds
) {
    TitleEntranceRenderState entrance{};
    REQUIRE(trySampleTitleEntrance(layout, elapsedSeconds, entrance));
    return entrance;
}

void advanceInSteps(
    TitleOverlayStateMachine& state,
    const double totalSeconds
) noexcept {
    double remaining = totalSeconds;
    while (remaining > 1.0e-12) {
        const double step = std::min(remaining, 0.05);
        state.advance(step);
        remaining -= step;
    }
}

[[nodiscard]] TitleOverlayStateMachine interactiveState() {
    TitleOverlayStateMachine state;
    advanceInSteps(
        state,
        TitleOverlayStateMachine::intro_delay_seconds
            + TitleOverlayStateMachine::logo_playback_seconds
            + TitleOverlayStateMachine::scene_transition_seconds
    );
    REQUIRE(state.snapshot().titleInputEnabled);
    return state;
}

[[nodiscard]] TitleUiControllerSnapshot idleInteraction() noexcept {
    constexpr std::array targets{
        TitleUiTarget::cardStart,
        TitleUiTarget::cardQuickStart,
        TitleUiTarget::cardRecords,
        TitleUiTarget::cardDeck,
        TitleUiTarget::cardResearch,
        TitleUiTarget::utilitySetting,
        TitleUiTarget::utilityCredits,
        TitleUiTarget::utilityAchievements,
        TitleUiTarget::utilityExit,
        TitleUiTarget::versionHistoryLink,
        TitleUiTarget::overlayCancel,
        TitleUiTarget::overlayConfirm
    };
    TitleUiControllerSnapshot result{};
    for (std::size_t index = 0U; index < targets.size(); ++index) {
        result.targets[index].target = targets[index];
    }
    return result;
}

struct SyntheticTitleTextResources final {
    static constexpr std::uint64_t generation = 19U;
    static constexpr cirvivor::render::ResourceId fontId =
        cirvivor::render::stableResourceId("test/title-font");
    static constexpr cirvivor::render::ResourceId atlasId =
        cirvivor::render::stableResourceId("test/title-a8-atlas");

    std::array<std::uint8_t, 1> atlasPixels{255U};
    std::array<cirvivor::render::GlyphInstance,
        cirvivor::render::text::title_text_catalog.size()> glyphs{};
    std::array<cirvivor::render::PreShapedTextRunView,
        cirvivor::render::text::title_text_catalog.size()> runs{};
    std::array<cirvivor::render::Alpha8TextureResourceView, 1> resources{};

    SyntheticTitleTextResources() noexcept {
        for (std::size_t index = 0U; index < runs.size(); ++index) {
            const auto& entry = cirvivor::render::text::title_text_catalog[index];
            glyphs[index] = {
                static_cast<std::uint32_t>(index + 1U),
                0U,
                {0.0F, -48.0F},
                {32.0F, 0.0F},
                {},
                {0.0F, 0.0F, 1.0F, 1.0F}
            };
            runs[index] = {
                cirvivor::render::text::titleTextKey(
                    entry.semantic,
                    cirvivor::render::UiTextLocale::korean
                ),
                fontId,
                atlasId,
                64U,
                32.0F,
                48.0F,
                16.0F,
                std::span<const cirvivor::render::GlyphInstance>(&glyphs[index], 1U)
            };
        }
        resources[0] = {
            atlasId,
            generation,
            1U,
            1U,
            1U,
            atlasPixels
        };
    }

    [[nodiscard]] cirvivor::render::PreShapedTextResourcesView view(
        const std::size_t runCount = cirvivor::render::text::title_text_catalog.size()
    ) const noexcept {
        const std::size_t boundedCount = std::min(runCount, runs.size());
        return {
            generation,
            std::span<const cirvivor::render::PreShapedTextRunView>(
                runs.data(),
                boundedCount
            ),
            cirvivor::render::RenderResourcesView(resources)
        };
    }
};

[[nodiscard]] bool capacityContains(
    const FramePacketCapacity outer,
    const FramePacketCapacity inner
) noexcept {
    return inner.commandCount <= outer.commandCount
        && inner.spriteCount <= outer.spriteCount
        && inner.shapeCount <= outer.shapeCount
        && inner.lineCount <= outer.lineCount
        && inner.textCount <= outer.textCount
        && inner.effectCount <= outer.effectCount
        && inner.uiCount <= outer.uiCount
        && inner.overlayCount <= outer.overlayCount
        && inner.utf8ByteCount <= outer.utf8ByteCount
        && inner.glyphRunCount <= outer.glyphRunCount
        && inner.glyphInstanceCount <= outer.glyphInstanceCount
        && inner.texturedMeshCount <= outer.texturedMeshCount
        && inner.meshVertexCount <= outer.meshVertexCount
        && inner.meshIndexCount <= outer.meshIndexCount
        && inner.gradientCount <= outer.gradientCount
        && inner.gradientStopCount <= outer.gradientStopCount
        && inner.clipCount <= outer.clipCount
        && inner.passCount <= outer.passCount;
}

[[nodiscard]] const CommandHeader* commandHeader(
    const FramePacket& packet,
    const CommandRef reference
) noexcept {
    const std::size_t index = reference.index;
    switch (reference.kind) {
    case CommandKind::sprite:
        return index < packet.sprites().size() ? &packet.sprites()[index].header : nullptr;
    case CommandKind::shape:
        return index < packet.shapes().size() ? &packet.shapes()[index].header : nullptr;
    case CommandKind::line:
        return index < packet.lines().size() ? &packet.lines()[index].header : nullptr;
    case CommandKind::text:
        return index < packet.textRuns().size() ? &packet.textRuns()[index].header : nullptr;
    case CommandKind::effect:
        return index < packet.effects().size() ? &packet.effects()[index].header : nullptr;
    case CommandKind::ui:
        return index < packet.ui().size() ? &packet.ui()[index].header : nullptr;
    case CommandKind::overlay:
        return index < packet.overlays().size() ? &packet.overlays()[index].header : nullptr;
    case CommandKind::glyphRun:
        return index < packet.glyphRuns().size() ? &packet.glyphRuns()[index].header : nullptr;
    case CommandKind::texturedMesh:
        return index < packet.texturedMeshes().size()
            ? &packet.texturedMeshes()[index].header
            : nullptr;
    case CommandKind::gradient:
        return index < packet.gradients().size() ? &packet.gradients()[index].header : nullptr;
    case CommandKind::clip:
        return index < packet.clips().size() ? &packet.clips()[index].header : nullptr;
    case CommandKind::pass:
        return index < packet.passes().size() ? &packet.passes()[index].header : nullptr;
    }
    return nullptr;
}

[[nodiscard]] const CommandHeader* headerAtSequence(
    const FramePacket& packet,
    const std::uint32_t sequence
) noexcept {
    if (sequence >= packet.commandStream().size()) {
        return nullptr;
    }
    return commandHeader(packet, packet.commandStream()[sequence]);
}

[[nodiscard]] bool rectInside(
    const RectF inner,
    const cirvivor::ui::layout::RoundedRectD outer
) noexcept {
    constexpr double epsilon = 1.0e-4;
    return static_cast<double>(inner.x) + epsilon >= outer.x
        && static_cast<double>(inner.y) + epsilon >= outer.y
        && static_cast<double>(inner.x + inner.width) <= outer.x + outer.width + epsilon
        && static_cast<double>(inner.y + inner.height) <= outer.y + outer.height + epsilon;
}

void testSurfaceOrderFormulaAndOverflowTransaction() {
    cirvivor::ui::OverlaySnapshot overlay{};
    overlay.kind = OverlayKind::externalLinkWarning;
    overlay.layer = 15;
    overlay.sequence = 2U;
    OverlaySurfaceLayerOrders orders{};
    REQUIRE(tryResolveOverlaySurfaceLayerOrders(overlay, orders));
    REQUIRE(orders.dim == 15'019);
    REQUIRE(orders.effect == 15'020);
    REQUIRE(orders.ui == 15'021);
    REQUIRE(orders.floatingEffect == 15'022);
    REQUIRE(orders.floatingUi == 15'023);
    REQUIRE(title_effect_surface_layer_order == 10'000);
    REQUIRE(title_ui_surface_layer_order == 10'001);
    REQUIRE(title_tooltip_surface_layer_order == 190'000);

    const OverlaySurfaceLayerOrders before = orders;
    overlay.sequence = std::numeric_limits<std::uint32_t>::max();
    REQUIRE(!tryResolveOverlaySurfaceLayerOrders(overlay, orders));
    REQUIRE(orders == before);
}

void testSettledTitleBuildUsesExactV2CapacityAndExplicitPlaceholders() {
    const UiLayoutSnapshot layout = buildLayout(1'280.0, 720.0);
    const TitleEntranceRenderState entrance = buildEntrance(layout, 2.0);
    const UiStateSnapshot uiState = interactiveState().snapshot();
    const TitleUiControllerSnapshot interaction = idleInteraction();
    const TitleSceneInput input{
        uiState,
        interaction,
        layout,
        entrance,
        darkThemeMetrics()
    };

    FramePacketCapacity expected{};
    expected.commandCount = 27U;
    expected.shapeCount = 3U;
    expected.lineCount = 3U;
    expected.uiCount = 16U;
    expected.gradientCount = 1U;
    expected.gradientStopCount = 5U;
    expected.clipCount = 4U;
    REQUIRE(titleSceneCapacity(input) == expected);
    REQUIRE(capacityContains(maximumTitleSceneCapacity(), expected));

    FramePacket packet(expected);
    const auto result = buildTitleScene(packet, input);
    REQUIRE(result.success);
    REQUIRE(result.error == FrameBuildError::none);
    REQUIRE(result.requiredCapacity == expected);
    REQUIRE(packet.size() == expected);
    REQUIRE(packet.isStructurallyValid());
    REQUIRE(packet.isRenderOrderValid());
    REQUIRE(titleSceneCapabilityIsMissing(
        result.missingCapabilities,
        TitleSceneMissingCapability::preShapedTextResources
    ));
    REQUIRE(result.commandStats.totalCommands == 27U);
    REQUIRE(result.commandStats.titleShellCommands == 27U);
    REQUIRE(result.commandStats.placeholderGeometryCommands == 7U);
    REQUIRE(result.commandStats.titleOverlayContentCommands == 0U);
    REQUIRE(result.commandStats.shapedTextCommands == 0U);
    REQUIRE(result.commandStats.resourceBackedCommands == 0U);
    REQUIRE(packet.textRuns().empty());
    REQUIRE(packet.glyphRuns().empty());
    REQUIRE(packet.texturedMeshes().empty());
    REQUIRE(packet.gradients()[0].bounds == (RectF{0.0F, 0.0F, 1'280.0F, 720.0F}));
    REQUIRE(packet.gradientStops().size() == 5U);
    REQUIRE_NEAR(packet.gradientStops().front().offset, 0.0, 1.0e-7);
    REQUIRE_NEAR(packet.gradientStops().back().offset, 1.0, 1.0e-7);
    for (const auto& shape : packet.shapes()) {
        REQUIRE(shape.header.layer == RenderLayer::effect);
        REQUIRE(shape.header.layerOrder == title_effect_surface_layer_order);
    }
    for (const auto& command : packet.ui()) {
        REQUIRE(command.header.layer == RenderLayer::ui);
        REQUIRE(command.header.layerOrder == title_ui_surface_layer_order);
    }
    REQUIRE(packet.ui().back().bounds == (RectF{
        1'174.53888F,
        158.093305F,
        80.74112F,
        20.8F
    }));
    REQUIRE(packet.ui().back().backgroundColor
        == PremultipliedRgba::transparent());
    REQUIRE(packet.ui().back().borderColor
        == PremultipliedRgba::transparent());
    REQUIRE(packet.ui().back().accentColor
        == PremultipliedRgba::transparent());
    REQUIRE(packet.lines().size() == 3U);
    REQUIRE(packet.lines()[0].cap == LineCap::round);
    REQUIRE_NEAR(packet.lines()[0].start.x, 1'182.87458304, 1.0e-4);
    REQUIRE_NEAR(packet.lines()[0].start.y, 168.493305263158, 1.0e-4);
    REQUIRE_NEAR(packet.lines()[0].end.x, 1'190.36829696, 1.0e-4);
    REQUIRE_NEAR(packet.lines()[0].end.y, 168.493305263158, 1.0e-4);
    REQUIRE_NEAR(packet.lines()[0].width, 1.216512, 1.0e-6);
    REQUIRE_NEAR(packet.lines()[0].color.alpha, 0.42, 1.0e-6);
    REQUIRE_NEAR(packet.lines()[1].start.x, 1'187.0710628352, 1.0e-4);
    REQUIRE_NEAR(packet.lines()[1].start.y, 165.196071138358, 1.0e-4);
    REQUIRE_NEAR(packet.lines()[2].start.y, 171.790539387958, 1.0e-4);

    const UiLayoutSnapshot noLinkLayout = buildLayout(
        1'280.0,
        720.0,
        {},
        1.0,
        false
    );
    const TitleEntranceRenderState noLinkEntrance = buildEntrance(
        noLinkLayout,
        2.0
    );
    const TitleSceneInput noLinkInput{
        uiState,
        interaction,
        noLinkLayout,
        noLinkEntrance,
        darkThemeMetrics()
    };
    FramePacketCapacity withoutLink{};
    withoutLink.commandCount = 23U;
    withoutLink.shapeCount = 3U;
    withoutLink.uiCount = 15U;
    withoutLink.gradientCount = 1U;
    withoutLink.gradientStopCount = 5U;
    withoutLink.clipCount = 4U;
    REQUIRE(titleSceneCapacity(noLinkInput) == withoutLink);
    FramePacket noLinkPacket(withoutLink);
    REQUIRE(buildTitleScene(noLinkPacket, noLinkInput).success);
    REQUIRE(noLinkPacket.lines().empty());
}

void testMidEntranceUsesSampledCardAndLogoGeometry() {
    const UiLayoutSnapshot layout = buildLayout(1'280.0, 720.0);
    const TitleEntranceRenderState midEntrance = buildEntrance(layout, 0.45);
    const TitleEntranceRenderState settledEntrance = buildEntrance(layout, 2.0);
    TitleOverlayStateMachine midState;
    advanceInSteps(
        midState,
        TitleOverlayStateMachine::intro_delay_seconds
            + TitleOverlayStateMachine::logo_playback_seconds
            + 0.45
    );
    const UiStateSnapshot midUiState = midState.snapshot();
    const UiStateSnapshot settledUiState = interactiveState().snapshot();
    const TitleUiControllerSnapshot interaction = idleInteraction();
    const TitleSceneInput midInput{
        midUiState,
        interaction,
        layout,
        midEntrance,
        darkThemeMetrics()
    };
    const TitleSceneInput settledInput{
        settledUiState,
        interaction,
        layout,
        settledEntrance,
        darkThemeMetrics()
    };
    const FramePacketCapacity capacity = titleSceneCapacity(midInput);
    FramePacket midPacket(capacity);
    FramePacket settledPacket(capacity);
    REQUIRE(buildTitleScene(midPacket, midInput).success);
    REQUIRE(buildTitleScene(settledPacket, settledInput).success);

    const RectF midFirstCard = midPacket.ui()[2].bounds;
    REQUIRE_NEAR(midFirstCard.x, midEntrance.cards[0].panelRect.x, 1.0e-4);
    REQUIRE_NEAR(midFirstCard.y, midEntrance.cards[0].panelRect.y, 1.0e-4);
    REQUIRE_NEAR(midPacket.ui()[2].value, midEntrance.cards[0].revealProgress, 1.0e-6);
    REQUIRE(
        std::abs(midFirstCard.x - settledPacket.ui()[2].bounds.x) > 1.0e-3F
        || std::abs(midPacket.shapes()[1].bounds.x - settledPacket.shapes()[1].bounds.x)
            > 1.0e-3F
    );
    REQUIRE(midPacket.isRenderOrderValid());
}

void testDpr2ViewportKeepsLogicalLayoutAndDrawableMappingSeparate() {
    const LogicalSafeAreaInsets logicalSafeArea{20.0, 10.0, 30.0, 15.0};
    const UiLayoutSnapshot layout = buildLayout(
        1'280.0,
        720.0,
        logicalSafeArea
    );
    TitleSceneConfig config{};
    config.physicalDisplaySize = {2'560, 1'440};
    config.physicalWindowBounds = {0, 0, 1'280, 720};
    config.drawableSize = {2'560, 1'440};
    config.drawableSafeArea = {40, 20, 60, 30};
    config.dpiScale = 2.0F;
    config.projectionRevision = 91U;
    config.frameId = 72U;
    config.simulationTick = 33U;
    config.presentationTimeSeconds = 7.25;
    config.interpolationAlpha = 0.5F;

    const auto viewport = cirvivor::render::frontend::makeTitleViewport(
        layout,
        config
    );
    REQUIRE(viewport.drawable.size == config.drawableSize);
    REQUIRE(
        viewport.drawable.contentRect
        == (cirvivor::render::RectI{0, 0, 2'560, 1'440})
    );
    REQUIRE(viewport.drawable.safeArea == config.drawableSafeArea);
    REQUIRE_NEAR(viewport.logicalUi.size.width, 1'280.0, 1.0e-6);
    REQUIRE_NEAR(viewport.logicalUi.size.height, 720.0, 1.0e-6);
    REQUIRE_NEAR(viewport.logicalUi.drawablePixelsPerLogicalUnitX, 2.0, 1.0e-6);
    REQUIRE_NEAR(viewport.logicalUi.drawablePixelsPerLogicalUnitY, 2.0, 1.0e-6);
    REQUIRE_NEAR(viewport.logicalUi.safeArea.left, 20.0, 1.0e-6);
    REQUIRE_NEAR(viewport.logicalUi.safeArea.bottom, 15.0, 1.0e-6);
    REQUIRE(viewport.world.projectionRevision == 91U);

    TitleSceneConfig squareConfig{};
    squareConfig.physicalDisplaySize = {1'000, 1'000};
    squareConfig.physicalWindowBounds = {0, 0, 1'000, 1'000};
    squareConfig.drawableSize = {1'000, 1'000};
    const auto squareViewport = cirvivor::render::frontend::makeTitleViewport(
        layout,
        squareConfig
    );
    REQUIRE(
        squareViewport.drawable.contentRect
        == (cirvivor::render::RectI{0, 219, 1'000, 562})
    );
    const double squareScale = static_cast<double>(
        squareViewport.logicalUi.drawablePixelsPerLogicalUnitX
    );
    REQUIRE_NEAR(
        squareViewport.logicalUi.drawablePixelsPerLogicalUnitY,
        squareScale,
        1.0e-7
    );
    REQUIRE(squareScale * layout.viewport.ww <= 1'000.0);
    REQUIRE(squareScale * layout.viewport.wh <= 562.0);
    REQUIRE(
        static_cast<double>(squareViewport.world.worldToDrawable.elements[5])
            + squareScale * layout.viewport.wh
        <= 781.0
    );

    const TitleEntranceRenderState entrance = buildEntrance(layout, 2.0);
    const UiStateSnapshot uiState = interactiveState().snapshot();
    const TitleUiControllerSnapshot interaction = idleInteraction();
    const TitleSceneInput input{
        uiState,
        interaction,
        layout,
        entrance,
        darkThemeMetrics()
    };
    FramePacket packet(titleSceneCapacity(input));
    const auto result = buildTitleScene(packet, input, config);
    REQUIRE(result.success);
    REQUIRE(packet.viewport() == viewport);
    REQUIRE(packet.metadata().frameId == 72U);
    REQUIRE(packet.metadata().simulationTick == 33U);
    REQUIRE_NEAR(packet.metadata().presentationTimeSeconds, 7.25, 1.0e-12);
    REQUIRE_NEAR(packet.metadata().interpolationAlpha, 0.5, 1.0e-7);
}

void testUltrawideAndSafeAreaKeepShellInsideAuthoritativeLayout() {
    const LogicalSafeAreaInsets safeArea{120.0, 48.0, 160.0, 64.0};
    const UiLayoutSnapshot layout = buildLayout(
        3'440.0,
        1'440.0,
        safeArea,
        1.25
    );
    const TitleEntranceRenderState entrance = buildEntrance(layout, 2.0);
    const UiStateSnapshot uiState = interactiveState().snapshot();
    const TitleUiControllerSnapshot interaction = idleInteraction();
    const TitleSceneInput input{
        uiState,
        interaction,
        layout,
        entrance,
        darkThemeMetrics()
    };
    FramePacket packet(titleSceneCapacity(input));
    TitleSceneConfig config{};
    config.physicalDisplaySize = {3'440, 1'440};
    config.physicalWindowBounds = {0, 0, 3'440, 1'440};
    config.drawableSize = {3'440, 1'440};
    config.drawableSafeArea = {120, 48, 160, 64};
    REQUIRE(buildTitleScene(packet, input, config).success);
    REQUIRE(
        packet.gradients()[0].bounds
        == (RectF{0.0F, 0.0F, 3'440.0F, 1'440.0F})
    );
    REQUIRE(rectInside(packet.ui()[0].bounds, layout.viewport.safeAreaRect));
    REQUIRE(rectInside(packet.ui()[1].bounds, layout.viewport.safeAreaRect));
    REQUIRE(packet.viewport().drawable.safeArea == config.drawableSafeArea);
    REQUIRE(packet.isRenderOrderValid());
}

void testNestedExternalSequenceTwoUsesExactPassAnchorAndNoGenericTitleContent() {
    const UiLayoutSnapshot layout = buildLayout(1'280.0, 720.0);
    const TitleEntranceRenderState entrance = buildEntrance(layout, 2.0);
    TitleOverlayStateMachine state = interactiveState();
    const auto credits = state.apply(UiAction::openTitle(OverlayKind::credits));
    const auto external = state.apply(
        UiAction::openExternalLink("https://jukchang.com")
    );
    REQUIRE(credits.status == UiActionStatus::applied);
    REQUIRE(external.status == UiActionStatus::applied);
    REQUIRE(credits.overlaySequence == 1U);
    REQUIRE(external.overlaySequence == 2U);
    advanceInSteps(state, TitleOverlayStateMachine::overlay_transition_seconds);
    const UiStateSnapshot uiState = state.snapshot();
    const TitleUiControllerSnapshot interaction = idleInteraction();
    const TitleSceneInput input{
        uiState,
        interaction,
        layout,
        entrance,
        darkThemeMetrics()
    };

    FramePacketCapacity expected{};
    expected.commandCount = 45U;
    expected.shapeCount = 3U;
    expected.lineCount = 3U;
    expected.uiCount = 20U;
    expected.overlayCount = 8U;
    expected.gradientCount = 1U;
    expected.gradientStopCount = 5U;
    expected.clipCount = 6U;
    expected.passCount = 4U;
    REQUIRE(titleSceneCapacity(input) == expected);
    FramePacket packet(expected);
    const auto result = buildTitleScene(packet, input);
    REQUIRE(result.success);
    REQUIRE(titleSceneCapabilityIsMissing(
        result.missingCapabilities,
        TitleSceneMissingCapability::creditsContent
    ));
    REQUIRE(result.commandStats.overlayDimCommands == 6U);
    REQUIRE(result.commandStats.overlayPassCommands == 4U);
    REQUIRE(result.commandStats.externalLinkShellCommands == 12U);
    REQUIRE(result.commandStats.titleOverlayContentCommands == 0U);
    REQUIRE(packet.ui().size() == 20U);
    REQUIRE(packet.overlays().size() == 8U);
    for (std::size_t index = 0U; index < 3U; ++index) {
        REQUIRE(packet.overlays()[index].header.layerOrder == 10'009);
    }
    for (std::size_t index = 3U; index < 6U; ++index) {
        REQUIRE(packet.overlays()[index].header.layerOrder == 15'019);
    }
    REQUIRE(packet.overlays()[6].header.layerOrder == 15'021);
    REQUIRE(packet.overlays()[7].header.layerOrder == 15'021);
    REQUIRE(packet.passes().size() == 4U);
    REQUIRE(packet.passes()[1].operation == PassOperation::capture);
    const auto& capture = packet.passes()[1];
    REQUIRE(capture.header.layerOrder == 15'020);
    REQUIRE(capture.sourceAnchorLayer == RenderLayer::dynamicOverlay);
    REQUIRE(capture.sourceAnchorLayerOrder == 15'019);
    const CommandHeader* const anchor = headerAtSequence(
        packet,
        capture.sourceAnchorSequence
    );
    REQUIRE(anchor != nullptr);
    REQUIRE(anchor->sequence == capture.sourceAnchorSequence);
    REQUIRE(anchor->layer == capture.sourceAnchorLayer);
    REQUIRE(anchor->layerOrder == capture.sourceAnchorLayerOrder);
    const CommandRef anchorReference = packet.commandStream()[
        capture.sourceAnchorSequence
    ];
    REQUIRE(anchorReference.kind == CommandKind::overlay);
    REQUIRE(
        packet.overlays()[anchorReference.index].operation
        == cirvivor::render::OverlayOperation::endSession
    );
    REQUIRE(packet.clips()[4].header.layerOrder == 15'021);
    REQUIRE(packet.clips()[5].header.layerOrder == 15'021);
    REQUIRE(packet.isRenderOrderValid());
}

void testOverlayButtonsUseSharedGeometryInteractionAndBackdropRevision() {
    const UiLayoutSnapshot layout = buildLayout(1'280.0, 720.0);
    const TitleEntranceRenderState entrance = buildEntrance(layout, 2.0);
    const auto theme = darkThemeMetrics();
    TitleOverlayStateMachine state = interactiveState();
    const auto opened = state.apply(
        UiAction::openExternalLink("https://jukchang.com/history")
    );
    REQUIRE(opened.accepted());
    advanceInSteps(state, TitleOverlayStateMachine::overlay_transition_seconds);
    const UiStateSnapshot uiState = state.snapshot();
    REQUIRE(uiState.overlayCount == 1U);
    REQUIRE(uiState.overlays[0].acceptsInput);

    const TitleUiControllerSnapshot idle = idleInteraction();
    TitleUiControllerSnapshot confirmHovered = idle;
    confirmHovered.overlaySequence = opened.overlaySequence;
    for (auto& target : confirmHovered.targets) {
        if (target.target == TitleUiTarget::overlayConfirm) {
            target.hovered = true;
        }
    }
    const TitleSceneInput idleInput{uiState, idle, layout, entrance, theme};
    const TitleSceneInput hoveredInput{
        uiState,
        confirmHovered,
        layout,
        entrance,
        theme
    };
    const FramePacketCapacity capacity = titleSceneCapacity(idleInput);
    REQUIRE(capacity.commandCount == 42U);
    REQUIRE(capacity.lineCount == 3U);
    REQUIRE(capacity.uiCount == 20U);
    FramePacket idlePacket(capacity);
    FramePacket hoveredPacket(capacity);
    TitleSceneConfig config{};
    config.backdropRevision = 77U;
    REQUIRE(buildTitleScene(idlePacket, idleInput, config).success);
    REQUIRE(buildTitleScene(hoveredPacket, hoveredInput, config).success);

    OverlayDialogRenderMetrics dialog{};
    REQUIRE(tryResolveOverlayDialogRenderMetrics(
        layout.overlays.externalLinkWarning,
        layout.overlayPage,
        uiState.overlays[0].contentScale,
        dialog
    ));
    constexpr std::size_t baseUiCount = 16U;
    const std::size_t cancelIndex = baseUiCount + 1U;
    const std::size_t confirmIndex = baseUiCount + 2U;
    REQUIRE(idlePacket.ui()[cancelIndex].bounds == (RectF{
        static_cast<float>(dialog.cancelButtonRect.x),
        static_cast<float>(dialog.cancelButtonRect.y),
        static_cast<float>(dialog.cancelButtonRect.width),
        static_cast<float>(dialog.cancelButtonRect.height)
    }));
    REQUIRE(idlePacket.ui()[confirmIndex].bounds == (RectF{
        static_cast<float>(dialog.confirmButtonRect.x),
        static_cast<float>(dialog.confirmButtonRect.y),
        static_cast<float>(dialog.confirmButtonRect.width),
        static_cast<float>(dialog.confirmButtonRect.height)
    }));
    std::size_t changedUiCount = 0U;
    for (std::size_t index = 0U; index < idlePacket.ui().size(); ++index) {
        if (hoveredPacket.ui()[index] != idlePacket.ui()[index]) {
            ++changedUiCount;
            REQUIRE(index == confirmIndex);
        }
    }
    REQUIRE(changedUiCount == 1U);
    REQUIRE(
        hoveredPacket.ui()[confirmIndex].stateFlags
        == uiStateBits(UiStateFlag::hovered)
    );
    REQUIRE(hoveredPacket.ui()[confirmIndex].backgroundColor
        != idlePacket.ui()[confirmIndex].backgroundColor);
    REQUIRE(hoveredPacket.ui()[cancelIndex] == idlePacket.ui()[cancelIndex]);

    REQUIRE(idlePacket.passes().size() == 4U);
    for (const auto& pass : idlePacket.passes()) {
        REQUIRE(pass.sourceRevision == config.backdropRevision);
    }
    std::size_t dimCount = 0U;
    for (const auto& overlay : idlePacket.overlays()) {
        if (overlay.operation == OverlayOperation::dim) {
            ++dimCount;
            REQUIRE(overlay.sourceRevision == config.backdropRevision);
        }
    }
    REQUIRE(dimCount == 1U);

    TitleOverlayStateMachine advancingState = interactiveState();
    REQUIRE(advancingState.apply(
        UiAction::openExternalLink("https://jukchang.com/history")
    ).accepted());
    const UiStateSnapshot beforeAdvance = advancingState.snapshot();
    const TitleSceneInput beforeAdvanceInput{
        beforeAdvance,
        idle,
        layout,
        entrance,
        theme
    };
    FramePacket beforeAdvancePacket(titleSceneCapacity(beforeAdvanceInput));
    REQUIRE(buildTitleScene(
        beforeAdvancePacket,
        beforeAdvanceInput,
        config
    ).success);
    advancingState.advance(0.1);
    const UiStateSnapshot afterAdvance = advancingState.snapshot();
    REQUIRE(afterAdvance.revision != beforeAdvance.revision);
    const TitleSceneInput afterAdvanceInput{
        afterAdvance,
        idle,
        layout,
        entrance,
        theme
    };
    FramePacket afterAdvancePacket(titleSceneCapacity(afterAdvanceInput));
    REQUIRE(buildTitleScene(
        afterAdvancePacket,
        afterAdvanceInput,
        config
    ).success);
    for (const auto& pass : afterAdvancePacket.passes()) {
        REQUIRE(pass.sourceRevision == 77U);
    }
    for (const auto& overlay : afterAdvancePacket.overlays()) {
        if (overlay.operation == OverlayOperation::dim) {
            REQUIRE(overlay.sourceRevision == 77U);
        }
    }

    TitleSceneConfig changedConfig = config;
    changedConfig.backdropRevision = 78U;
    FramePacket changedPacket(titleSceneCapacity(afterAdvanceInput));
    REQUIRE(buildTitleScene(
        changedPacket,
        afterAdvanceInput,
        changedConfig
    ).success);
    for (const auto& pass : changedPacket.passes()) {
        REQUIRE(pass.sourceRevision == 78U);
    }
    for (const auto& overlay : changedPacket.overlays()) {
        if (overlay.operation == OverlayOperation::dim) {
            REQUIRE(overlay.sourceRevision == 78U);
        }
    }

    REQUIRE(state.apply(UiAction::lockTop()).accepted());
    const UiStateSnapshot lockedState = state.snapshot();
    TitleUiControllerSnapshot staleLockedInteraction = confirmHovered;
    for (auto& target : staleLockedInteraction.targets) {
        if (target.target == TitleUiTarget::overlayCancel) {
            target.hovered = true;
            target.pressed = true;
        } else if (target.target == TitleUiTarget::overlayConfirm) {
            target.pressed = true;
        }
    }
    const TitleSceneInput lockedInput{
        lockedState,
        staleLockedInteraction,
        layout,
        entrance,
        theme
    };
    FramePacket lockedPacket(titleSceneCapacity(lockedInput));
    REQUIRE(buildTitleScene(lockedPacket, lockedInput, config).success);
    REQUIRE(
        lockedPacket.ui()[cancelIndex].stateFlags
        == uiStateBits(UiStateFlag::disabled)
    );
    REQUIRE(
        lockedPacket.ui()[confirmIndex].stateFlags
        == uiStateBits(UiStateFlag::disabled)
    );
    REQUIRE(lockedPacket.ui()[cancelIndex].backgroundColor
        == idlePacket.ui()[cancelIndex].backgroundColor);
    REQUIRE(lockedPacket.ui()[confirmIndex].backgroundColor
        == idlePacket.ui()[confirmIndex].backgroundColor);
    REQUIRE(lockedPacket.ui()[confirmIndex].backgroundColor
        != hoveredPacket.ui()[confirmIndex].backgroundColor);
}

void testExitShellAndInsufficientFixedCapacityAreTransactional() {
    const UiLayoutSnapshot layout = buildLayout(1'280.0, 720.0);
    const TitleEntranceRenderState entrance = buildEntrance(layout, 2.0);
    TitleOverlayStateMachine state = interactiveState();
    REQUIRE(state.apply(UiAction::openExit()).status == UiActionStatus::applied);
    advanceInSteps(state, TitleOverlayStateMachine::overlay_transition_seconds);
    const UiStateSnapshot uiState = state.snapshot();
    const TitleUiControllerSnapshot interaction = idleInteraction();
    const TitleSceneInput input{
        uiState,
        interaction,
        layout,
        entrance,
        darkThemeMetrics()
    };
    const FramePacketCapacity exact = titleSceneCapacity(input);
    REQUIRE(exact.commandCount == 41U);
    REQUIRE(exact.lineCount == 3U);
    REQUIRE(exact.uiCount == 19U);
    REQUIRE(exact.overlayCount == 5U);
    REQUIRE(exact.passCount == 4U);
    REQUIRE(exact.clipCount == 6U);

    FramePacket exactPacket(exact);
    const auto exactResult = buildTitleScene(exactPacket, input);
    REQUIRE(exactResult.success);
    REQUIRE(exactResult.commandStats.exitShellCommands == 11U);
    REQUIRE(exactPacket.isRenderOrderValid());

    FramePacketCapacity insufficient = exact;
    --insufficient.gradientStopCount;
    FramePacket insufficientPacket(insufficient);
    const auto failed = buildTitleScene(insufficientPacket, input);
    REQUIRE(!failed.success);
    REQUIRE(failed.error == FrameBuildError::capacityExceeded);
    REQUIRE(insufficientPacket.size() == FramePacketCapacity{});
    REQUIRE(failed.requiredCapacity == exact);
}

void testMapSelectRendersDialogShellWhileQuickStartRemainsDimOnly() {
    const UiLayoutSnapshot layout = buildLayout(1'280.0, 720.0);
    const TitleEntranceRenderState entrance = buildEntrance(layout, 2.0);
    const TitleUiControllerSnapshot interaction = idleInteraction();

    TitleOverlayStateMachine mapState = interactiveState();
    REQUIRE(mapState.apply(
        UiAction::openTitle(OverlayKind::mapSelect)
    ).accepted());
    advanceInSteps(mapState, TitleOverlayStateMachine::overlay_transition_seconds);
    const UiStateSnapshot mapUiState = mapState.snapshot();
    const TitleSceneInput mapInput{
        mapUiState,
        interaction,
        layout,
        entrance,
        darkThemeMetrics()
    };
    const FramePacketCapacity mapCapacity = titleSceneCapacity(mapInput);
    REQUIRE(mapCapacity.commandCount == 41U);
    REQUIRE(mapCapacity.uiCount == 19U);
    REQUIRE(mapCapacity.overlayCount == 5U);
    REQUIRE(mapCapacity.clipCount == 6U);
    REQUIRE(mapCapacity.passCount == 4U);
    FramePacket mapPacket(mapCapacity);
    const auto mapResult = buildTitleScene(mapPacket, mapInput);
    REQUIRE(mapResult.success);
    REQUIRE(mapResult.commandStats.mapSelectShellCommands == 11U);
    REQUIRE(mapResult.commandStats.exitShellCommands == 0U);
    REQUIRE(mapResult.commandStats.externalLinkShellCommands == 0U);
    REQUIRE(titleSceneCapabilityIsMissing(
        mapResult.missingCapabilities,
        TitleSceneMissingCapability::mapSelectContent
    ));
    REQUIRE(mapPacket.isRenderOrderValid());

    OverlayDialogRenderMetrics dialog{};
    REQUIRE(tryResolveOverlayDialogRenderMetrics(
        layout.overlays.mapSelect,
        layout.overlayPage,
        mapUiState.overlays[0].contentScale,
        dialog
    ));
    constexpr std::size_t baseUiCount = 16U;
    REQUIRE(mapPacket.ui()[baseUiCount].bounds == (RectF{
        static_cast<float>(dialog.panelRect.x),
        static_cast<float>(dialog.panelRect.y),
        static_cast<float>(dialog.panelRect.width),
        static_cast<float>(dialog.panelRect.height)
    }));
    REQUIRE(mapPacket.ui()[baseUiCount + 1U].bounds == (RectF{
        static_cast<float>(dialog.cancelButtonRect.x),
        static_cast<float>(dialog.cancelButtonRect.y),
        static_cast<float>(dialog.cancelButtonRect.width),
        static_cast<float>(dialog.cancelButtonRect.height)
    }));
    REQUIRE(mapPacket.ui()[baseUiCount + 2U].bounds == (RectF{
        static_cast<float>(dialog.confirmButtonRect.x),
        static_cast<float>(dialog.confirmButtonRect.y),
        static_cast<float>(dialog.confirmButtonRect.width),
        static_cast<float>(dialog.confirmButtonRect.height)
    }));

    TitleOverlayStateMachine quickState = interactiveState();
    REQUIRE(quickState.apply(
        UiAction::openTitle(OverlayKind::quickStart)
    ).accepted());
    advanceInSteps(quickState, TitleOverlayStateMachine::overlay_transition_seconds);
    const UiStateSnapshot quickUiState = quickState.snapshot();
    const TitleSceneInput quickInput{
        quickUiState,
        interaction,
        layout,
        entrance,
        darkThemeMetrics()
    };
    const FramePacketCapacity quickCapacity = titleSceneCapacity(quickInput);
    REQUIRE(quickCapacity.commandCount == 30U);
    REQUIRE(quickCapacity.uiCount == 16U);
    REQUIRE(quickCapacity.overlayCount == 3U);
    REQUIRE(quickCapacity.clipCount == 4U);
    REQUIRE(quickCapacity.passCount == 0U);
    FramePacket quickPacket(quickCapacity);
    const auto quickResult = buildTitleScene(quickPacket, quickInput);
    REQUIRE(quickResult.success);
    REQUIRE(quickResult.commandStats.mapSelectShellCommands == 0U);
    REQUIRE(titleSceneCapabilityIsMissing(
        quickResult.missingCapabilities,
        TitleSceneMissingCapability::quickStartContent
    ));
}

void testActiveBuilderTransactionIsPreserved() {
    const UiLayoutSnapshot layout = buildLayout(1'280.0, 720.0);
    const TitleEntranceRenderState entrance = buildEntrance(layout, 2.0);
    const UiStateSnapshot uiState = interactiveState().snapshot();
    const TitleUiControllerSnapshot interaction = idleInteraction();
    const auto theme = darkThemeMetrics();
    const TitleSceneInput input{
        uiState,
        interaction,
        layout,
        entrance,
        theme
    };
    const FramePacketCapacity capacity = titleSceneCapacity(input);
    FramePacket packet(capacity);
    FramePacketBuilder owner(packet, PacketCapacityPolicy::fixedCapacity);
    FrameMetadata metadata{};
    REQUIRE(owner.begin(
        metadata,
        cirvivor::render::frontend::makeTitleViewport(layout)
    ));

    UiCommand first{};
    first.header = {
        RenderLayer::ui,
        CoordinateSpace::logicalUi,
        BlendMode::premultipliedAlpha,
        0U,
        title_ui_surface_layer_order,
        0U
    };
    first.primitive = UiPrimitive::button;
    first.elementId = 0x101U;
    first.bounds = {1.0F, 2.0F, 30.0F, 40.0F};
    REQUIRE(owner.addUi(first));
    REQUIRE(owner.nextSequence() == 1U);
    const FramePacketCapacity beforeSize = packet.size();
    const UiCommand beforeCommand = packet.ui().front();

    const auto rejected = buildTitleScene(packet, input);
    REQUIRE(!rejected.success);
    REQUIRE(rejected.error == FrameBuildError::packetAlreadyHasBuilder);
    REQUIRE(rejected.requiredCapacity == capacity);
    REQUIRE(owner.isBuilding());
    REQUIRE(owner.nextSequence() == 1U);
    REQUIRE(packet.size() == beforeSize);
    REQUIRE(packet.ui().front() == beforeCommand);

    UiCommand second = first;
    second.elementId = 0x102U;
    second.bounds.x = 40.0F;
    REQUIRE(owner.addUi(second));
    REQUIRE(owner.nextSequence() == 2U);
    REQUIRE(owner.finish());
    REQUIRE(packet.ui().size() == 2U);
    REQUIRE(packet.isStructurallyValid());
    REQUIRE(packet.isRenderOrderValid());
}

void testInteractionTargetsChangeOnlyTheirShellAndRejectInvalidTables() {
    const UiLayoutSnapshot layout = buildLayout(1'280.0, 720.0);
    const TitleEntranceRenderState entrance = buildEntrance(layout, 2.0);
    const UiStateSnapshot uiState = interactiveState().snapshot();
    const auto theme = darkThemeMetrics();
    const TitleUiControllerSnapshot idle = idleInteraction();
    const TitleSceneInput idleInput{uiState, idle, layout, entrance, theme};
    const FramePacketCapacity capacity = titleSceneCapacity(idleInput);

    TitleUiControllerSnapshot hovered = idle;
    std::swap(hovered.targets.front(), hovered.targets.back());
    for (auto& target : hovered.targets) {
        if (target.target == TitleUiTarget::cardDeck) {
            target.hovered = true;
        }
    }
    const TitleSceneInput hoveredInput{
        uiState,
        hovered,
        layout,
        entrance,
        theme
    };

    TitleUiControllerSnapshot pressed = idle;
    for (auto& target : pressed.targets) {
        if (target.target == TitleUiTarget::utilityCredits) {
            target.hovered = true;
            target.pressed = true;
        }
    }
    const TitleSceneInput pressedInput{
        uiState,
        pressed,
        layout,
        entrance,
        theme
    };

    TitleUiControllerSnapshot linkHovered = idle;
    for (auto& target : linkHovered.targets) {
        if (target.target == TitleUiTarget::versionHistoryLink) {
            target.hovered = true;
        }
    }
    const TitleSceneInput linkHoveredInput{
        uiState,
        linkHovered,
        layout,
        entrance,
        theme
    };

    REQUIRE(titleSceneCapacity(hoveredInput) == capacity);
    REQUIRE(titleSceneCapacity(pressedInput) == capacity);
    REQUIRE(titleSceneCapacity(linkHoveredInput) == capacity);
    FramePacket idlePacket(capacity);
    FramePacket hoveredPacket(capacity);
    FramePacket pressedPacket(capacity);
    FramePacket linkHoveredPacket(capacity);
    REQUIRE(buildTitleScene(idlePacket, idleInput).success);
    const auto hoveredResult = buildTitleScene(hoveredPacket, hoveredInput);
    const auto pressedResult = buildTitleScene(pressedPacket, pressedInput);
    const auto linkHoveredResult = buildTitleScene(
        linkHoveredPacket,
        linkHoveredInput
    );
    REQUIRE(hoveredResult.success);
    REQUIRE(pressedResult.success);
    REQUIRE(linkHoveredResult.success);
    REQUIRE(hoveredPacket.size() == capacity);
    REQUIRE(pressedPacket.size() == capacity);
    REQUIRE(linkHoveredPacket.size() == capacity);
    REQUIRE(hoveredPacket.commandStream().size() == idlePacket.commandStream().size());
    REQUIRE(pressedPacket.commandStream().size() == idlePacket.commandStream().size());
    for (std::size_t index = 0U; index < idlePacket.commandStream().size(); ++index) {
        REQUIRE(hoveredPacket.commandStream()[index] == idlePacket.commandStream()[index]);
        REQUIRE(pressedPacket.commandStream()[index] == idlePacket.commandStream()[index]);
        REQUIRE(linkHoveredPacket.commandStream()[index]
            == idlePacket.commandStream()[index]);
    }

    constexpr std::size_t deckCardIndex = 3U;
    const std::size_t deckUiIndex = 2U + deckCardIndex;
    std::size_t hoveredChanges = 0U;
    std::size_t pressedChanges = 0U;
    std::size_t hoveredChangedIndex = 0U;
    std::size_t pressedChangedIndex = 0U;
    for (std::size_t index = 0U; index < idlePacket.ui().size(); ++index) {
        if (hoveredPacket.ui()[index] != idlePacket.ui()[index]) {
            ++hoveredChanges;
            hoveredChangedIndex = index;
        }
        if (pressedPacket.ui()[index] != idlePacket.ui()[index]) {
            ++pressedChanges;
            pressedChangedIndex = index;
        }
    }
    REQUIRE(hoveredChanges == 1U);
    REQUIRE(hoveredChangedIndex == deckUiIndex);
    REQUIRE(
        hoveredPacket.ui()[deckUiIndex].stateFlags
        == uiStateBits(UiStateFlag::hovered)
    );
    REQUIRE(
        hoveredPacket.ui()[deckUiIndex].backgroundColor
        != idlePacket.ui()[deckUiIndex].backgroundColor
    );
    REQUIRE_NEAR(
        hoveredPacket.ui()[deckUiIndex].backgroundColor.alpha,
        theme.titleButtonHover[0].color.alpha * entrance.cards[deckCardIndex].alpha,
        1.0e-6
    );

    constexpr std::size_t creditsTileIndex = 1U;
    const std::size_t creditsUiIndex = 2U
        + entrance.cards.size()
        + creditsTileIndex;
    REQUIRE(pressedChanges == 1U);
    REQUIRE(pressedChangedIndex == creditsUiIndex);
    REQUIRE(
        pressedPacket.ui()[creditsUiIndex].stateFlags
        == (uiStateBits(UiStateFlag::hovered) | uiStateBits(UiStateFlag::pressed))
    );
    REQUIRE_NEAR(
        pressedPacket.ui()[creditsUiIndex].backgroundColor.alpha,
        theme.titleButtonHover[1].color.alpha
            * entrance.utilityTiles[creditsTileIndex].alpha,
        1.0e-6
    );
    REQUIRE(hoveredResult.commandStats.shapedTextCommands == 0U);
    REQUIRE(hoveredResult.commandStats.resourceBackedCommands == 0U);
    REQUIRE(titleSceneCapabilityIsMissing(
        hoveredResult.missingCapabilities,
        TitleSceneMissingCapability::preShapedTextResources
    ));

    const std::size_t linkUiIndex = idlePacket.ui().size() - 1U;
    std::size_t linkUiChanges = 0U;
    for (std::size_t index = 0U; index < idlePacket.ui().size(); ++index) {
        if (linkHoveredPacket.ui()[index] != idlePacket.ui()[index]) {
            ++linkUiChanges;
            REQUIRE(index == linkUiIndex);
        }
    }
    REQUIRE(linkUiChanges == 1U);
    REQUIRE(
        linkHoveredPacket.ui()[linkUiIndex].stateFlags
        == uiStateBits(UiStateFlag::hovered)
    );
    REQUIRE(linkHoveredPacket.ui()[linkUiIndex].backgroundColor
        == PremultipliedRgba::transparent());
    REQUIRE(linkHoveredPacket.lines().size() == 3U);
    for (std::size_t index = 0U; index < idlePacket.lines().size(); ++index) {
        REQUIRE(linkHoveredPacket.lines()[index].start
            == idlePacket.lines()[index].start);
        REQUIRE(linkHoveredPacket.lines()[index].end
            == idlePacket.lines()[index].end);
        REQUIRE(linkHoveredPacket.lines()[index].width
            == idlePacket.lines()[index].width);
        REQUIRE(linkHoveredPacket.lines()[index].cap
            == idlePacket.lines()[index].cap);
        REQUIRE(linkHoveredPacket.lines()[index].color
            != idlePacket.lines()[index].color);
        REQUIRE_NEAR(
            linkHoveredPacket.lines()[index].color.alpha,
            1.0,
            1.0e-6
        );
    }

    TitleUiControllerSnapshot duplicate = idle;
    duplicate.targets[1].target = duplicate.targets[0].target;
    const TitleSceneInput duplicateInput{
        uiState,
        duplicate,
        layout,
        entrance,
        theme
    };
    FramePacket rejectedPacket(capacity);
    REQUIRE(buildTitleScene(rejectedPacket, idleInput).success);
    const auto duplicateResult = buildTitleScene(rejectedPacket, duplicateInput);
    REQUIRE(!duplicateResult.success);
    REQUIRE(duplicateResult.error == FrameBuildError::structurallyInvalid);
    REQUIRE(duplicateResult.requiredCapacity == capacity);
    REQUIRE(rejectedPacket.size() == FramePacketCapacity{});

    TitleUiControllerSnapshot invalid = idle;
    invalid.targets[0].target = TitleUiTarget::none;
    const TitleSceneInput invalidInput{
        uiState,
        invalid,
        layout,
        entrance,
        theme
    };
    const auto invalidResult = buildTitleScene(rejectedPacket, invalidInput);
    REQUIRE(!invalidResult.success);
    REQUIRE(invalidResult.error == FrameBuildError::structurallyInvalid);
    REQUIRE(invalidResult.requiredCapacity == capacity);
    REQUIRE(rejectedPacket.size() == FramePacketCapacity{});
}

void testMaximumCapacityContainsFourKeyStateAndRepeatedBuildAllocatesNothing() {
    const UiLayoutSnapshot layout = buildLayout(1'280.0, 720.0);
    const TitleEntranceRenderState entrance = buildEntrance(layout, 2.0);
    TitleOverlayStateMachine state = interactiveState();
    REQUIRE(state.apply(UiAction::openTitle(OverlayKind::records)).accepted());
    REQUIRE(state.apply(
        UiAction::openExternalLink("https://jukchang.com")
    ).accepted());
    REQUIRE(state.apply(UiAction::openDebug()).accepted());
    REQUIRE(state.apply(UiAction::openExit()).accepted());
    advanceInSteps(state, TitleOverlayStateMachine::overlay_transition_seconds);
    const UiStateSnapshot uiState = state.snapshot();
    const TitleUiControllerSnapshot interaction = idleInteraction();
    const TitleSceneInput input{
        uiState,
        interaction,
        layout,
        entrance,
        darkThemeMetrics()
    };
    const FramePacketCapacity required = titleSceneCapacity(input);
    const FramePacketCapacity maximum = maximumTitleSceneCapacity();
    REQUIRE(capacityContains(maximum, required));
    REQUIRE(maximum.commandCount == 119U);
    REQUIRE(maximum.lineCount == 3U);
    REQUIRE(maximum.uiCount == 32U);
    REQUIRE(maximum.overlayCount == 20U);
    REQUIRE(maximum.clipCount == 12U);
    REQUIRE(maximum.passCount == 16U);
    REQUIRE(maximum.glyphRunCount == 32U);
    REQUIRE(maximum.glyphInstanceCount == 1'024U);

    FramePacket packet(maximum);
    allocation_probe::count = 0U;
    allocation_probe::enabled = true;
    const auto first = buildTitleScene(packet, input);
    const auto second = buildTitleScene(packet, input);
    const std::size_t allocations = allocation_probe::count;
    allocation_probe::enabled = false;

    REQUIRE(first.success);
    REQUIRE(second.success);
    REQUIRE(allocations == 0U);
    REQUIRE(packet.size() == required);
    REQUIRE(packet.isRenderOrderValid());
    REQUIRE(titleSceneCapabilityIsMissing(
        second.missingCapabilities,
        TitleSceneMissingCapability::recordsContent
    ));
    REQUIRE(titleSceneCapabilityIsMissing(
        second.missingCapabilities,
        TitleSceneMissingCapability::debugOverlayShell
    ));
    REQUIRE(second.commandStats.titleOverlayContentCommands == 0U);
}

void testResourceBackedTitleOverlayPartialAndResponsiveText() {
    using cirvivor::render::UiTextLocale;
    using cirvivor::ui::layout::TypographyRole;

    const SyntheticTitleTextResources text;
    REQUIRE(text.view().isValid());
    const UiLayoutSnapshot layout = buildLayout(1'280.0, 720.0);
    const TitleEntranceRenderState entrance = buildEntrance(layout, 2.0);
    const UiStateSnapshot uiState = interactiveState().snapshot();
    const TitleUiControllerSnapshot interaction = idleInteraction();
    const TitleSceneInput baseInput{
        uiState,
        interaction,
        layout,
        entrance,
        darkThemeMetrics(),
        text.view(),
        UiTextLocale::korean
    };
    const FramePacketCapacity baseCapacity = titleSceneCapacity(baseInput);
    REQUIRE(baseCapacity.commandCount == 37U);
    REQUIRE(baseCapacity.glyphRunCount == 10U);
    REQUIRE(baseCapacity.glyphInstanceCount == 10U);
    FramePacket basePacket(baseCapacity);
    const auto baseResult = buildTitleScene(basePacket, baseInput);
    REQUIRE(baseResult.success);
    REQUIRE(!titleSceneCapabilityIsMissing(
        baseResult.missingCapabilities,
        TitleSceneMissingCapability::preShapedTextResources
    ));
    REQUIRE(baseResult.commandStats.shapedTextCommands == 10U);
    REQUIRE(baseResult.commandStats.resourceBackedCommands == 10U);
    REQUIRE(basePacket.glyphRuns().size() == 10U);
    REQUIRE(basePacket.glyphInstances().size() == 10U);
    for (const auto& run : basePacket.glyphRuns()) {
        REQUIRE(run.fontId == SyntheticTitleTextResources::fontId);
        REQUIRE(run.glyphAtlasId == SyntheticTitleTextResources::atlasId);
        REQUIRE(run.glyphs.count == 1U);
        REQUIRE(run.sampling == cirvivor::render::SamplingMode::linear);
        REQUIRE_NEAR(run.transform.elements[0], run.pixelsPerEm / 64.0F, 1.0e-7);
        REQUIRE_NEAR(run.transform.elements[4], run.pixelsPerEm / 64.0F, 1.0e-7);
    }
    REQUIRE_NEAR(basePacket.glyphRuns()[0].pixelsPerEm, 16.0, 1.0e-6);
    REQUIRE_NEAR(
        basePacket.glyphRuns()[0].pixelsPerEm,
        entrance.cards[0].titleTypography.size,
        1.0e-6
    );
    REQUIRE_NEAR(
        basePacket.glyphRuns()[2].pixelsPerEm,
        entrance.cards[1].descriptionTypography.size,
        1.0e-6
    );
    const double versionSize = layout.typography[
        static_cast<std::size_t>(TypographyRole::h5)
    ].size;
    const double labelSize = layout.typography[
        static_cast<std::size_t>(TypographyRole::label)
    ].size;
    REQUIRE_NEAR(basePacket.glyphRuns()[8].pixelsPerEm, versionSize, 1.0e-6);
    REQUIRE_NEAR(basePacket.glyphRuns()[9].pixelsPerEm, labelSize, 1.0e-6);
    REQUIRE_NEAR(
        basePacket.glyphRuns()[8].origin.x,
        entrance.versionHistoryLink.textAnchor.x - (32.0 * versionSize / 64.0),
        1.0e-4
    );
    REQUIRE_NEAR(
        basePacket.glyphRuns()[8].origin.y,
        layout.title.versionLabelTop + (48.0 * versionSize / 64.0),
        1.0e-4
    );

    allocation_probe::count = 0U;
    allocation_probe::enabled = true;
    const auto repeatedBaseResult = buildTitleScene(basePacket, baseInput);
    const std::size_t resourceBackedAllocations = allocation_probe::count;
    allocation_probe::enabled = false;
    REQUIRE(repeatedBaseResult.success);
    REQUIRE(resourceBackedAllocations == 0U);

    // prefix 13에는 versionLabel까지 있지만 versionHistoryLink는 없다. 유효한
    // partial table도 요구 run이 빠지면 packet을 부분 제출하지 않는다.
    const auto partialView = text.view(13U);
    REQUIRE(partialView.isValid());
    const TitleSceneInput partialInput{
        uiState,
        interaction,
        layout,
        entrance,
        darkThemeMetrics(),
        partialView,
        UiTextLocale::korean
    };
    const FramePacketCapacity partialCapacity = titleSceneCapacity(partialInput);
    REQUIRE(partialCapacity.glyphRunCount == 9U);
    FramePacket partialPacket(partialCapacity);
    const auto partialResult = buildTitleScene(partialPacket, partialInput);
    REQUIRE(!partialResult.success);
    REQUIRE(partialResult.error == FrameBuildError::structurallyInvalid);
    REQUIRE(titleSceneCapabilityIsMissing(
        partialResult.missingCapabilities,
        TitleSceneMissingCapability::preShapedTextResources
    ));
    REQUIRE(partialPacket.size() == FramePacketCapacity{});

    const UiLayoutSnapshot responsiveLayout = buildLayout(
        2'560.0,
        1'440.0,
        {},
        1.5
    );
    const TitleEntranceRenderState responsiveEntrance = buildEntrance(
        responsiveLayout,
        2.0
    );
    const TitleSceneInput responsiveInput{
        uiState,
        interaction,
        responsiveLayout,
        responsiveEntrance,
        darkThemeMetrics(),
        text.view(),
        UiTextLocale::korean
    };
    FramePacket responsivePacket(titleSceneCapacity(responsiveInput));
    REQUIRE(buildTitleScene(responsivePacket, responsiveInput).success);
    REQUIRE(responsivePacket.glyphRuns().size() == 10U);
    REQUIRE_NEAR(
        responsivePacket.glyphRuns()[0].pixelsPerEm,
        responsiveEntrance.cards[0].titleTypography.size,
        1.0e-5
    );
    REQUIRE(responsivePacket.glyphRuns()[0].pixelsPerEm
        > basePacket.glyphRuns()[0].pixelsPerEm);
    REQUIRE_NEAR(
        responsivePacket.glyphRuns()[0].transform.elements[0],
        responsivePacket.glyphRuns()[0].pixelsPerEm / 64.0F,
        1.0e-7
    );

    const auto verifyOverlay = [&](TitleOverlayStateMachine& state,
                                   const std::size_t expectedGlyphRuns,
                                   const bool expectMapContentMissing) {
        advanceInSteps(state, TitleOverlayStateMachine::overlay_transition_seconds);
        const UiStateSnapshot overlayUiState = state.snapshot();
        const TitleSceneInput overlayInput{
            overlayUiState,
            interaction,
            layout,
            entrance,
            darkThemeMetrics(),
            text.view(),
            UiTextLocale::korean
        };
        FramePacket overlayPacket(titleSceneCapacity(overlayInput));
        const auto overlayResult = buildTitleScene(overlayPacket, overlayInput);
        REQUIRE(overlayResult.success);
        REQUIRE(overlayPacket.glyphRuns().size() == expectedGlyphRuns);
        REQUIRE(overlayResult.commandStats.shapedTextCommands == expectedGlyphRuns);
        REQUIRE(overlayResult.commandStats.resourceBackedCommands == expectedGlyphRuns);
        REQUIRE(!titleSceneCapabilityIsMissing(
            overlayResult.missingCapabilities,
            TitleSceneMissingCapability::preShapedTextResources
        ));
        REQUIRE(titleSceneCapabilityIsMissing(
            overlayResult.missingCapabilities,
            TitleSceneMissingCapability::mapSelectContent
        ) == expectMapContentMissing);
        REQUIRE(overlayPacket.isRenderOrderValid());
        return overlayPacket.glyphRuns().back().pixelsPerEm;
    };

    TitleOverlayStateMachine mapState = interactiveState();
    REQUIRE(mapState.apply(UiAction::openTitle(OverlayKind::mapSelect)).accepted());
    const float mapConfirmSize = verifyOverlay(mapState, 16U, true);
    REQUIRE_NEAR(mapConfirmSize, labelSize, 1.0e-6);

    TitleOverlayStateMachine exitState = interactiveState();
    REQUIRE(exitState.apply(UiAction::openExit()).accepted());
    const float exitConfirmSize = verifyOverlay(exitState, 14U, false);
    REQUIRE_NEAR(exitConfirmSize, labelSize, 1.0e-6);

    for (const auto& mapping :
         cirvivor::render::text::title_external_url_text_catalog) {
        TitleOverlayStateMachine externalState = interactiveState();
        REQUIRE(externalState.apply(
            UiAction::openExternalLink(mapping.url)
        ).accepted());
        REQUIRE(externalState.snapshot().overlays[0].externalUrl.view() == mapping.url);
        const float externalConfirmSize = verifyOverlay(externalState, 15U, false);
        REQUIRE_NEAR(externalConfirmSize, labelSize, 1.0e-6);
    }

    constexpr std::string_view unknownUrl = "https://example.com/runtime-path";
    TitleOverlayStateMachine unknownExternalState = interactiveState();
    REQUIRE(unknownExternalState.apply(
        UiAction::openExternalLink(unknownUrl)
    ).accepted());
    advanceInSteps(
        unknownExternalState,
        TitleOverlayStateMachine::overlay_transition_seconds
    );
    const UiStateSnapshot unknownExternalUiState = unknownExternalState.snapshot();
    REQUIRE(unknownExternalUiState.overlays[0].externalUrl.view() == unknownUrl);
    const TitleSceneInput unknownExternalInput{
        unknownExternalUiState,
        interaction,
        layout,
        entrance,
        darkThemeMetrics(),
        text.view(),
        UiTextLocale::korean
    };
    const FramePacketCapacity unknownExternalCapacity = titleSceneCapacity(
        unknownExternalInput
    );
    REQUIRE(unknownExternalCapacity.glyphRunCount == 14U);
    FramePacket unknownExternalPacket(unknownExternalCapacity);
    const auto unknownExternalResult = buildTitleScene(
        unknownExternalPacket,
        unknownExternalInput
    );
    REQUIRE(unknownExternalResult.success);
    REQUIRE(unknownExternalPacket.glyphRuns().size() == 14U);
    REQUIRE(unknownExternalResult.commandStats.externalLinkShellCommands == 12U);
    REQUIRE(unknownExternalPacket.ui().size() == 20U);
    REQUIRE(titleSceneCapabilityIsMissing(
        unknownExternalResult.missingCapabilities,
        TitleSceneMissingCapability::preShapedTextResources
    ));
    REQUIRE(!titleSceneCapabilityIsMissing(
        unknownExternalResult.missingCapabilities,
        TitleSceneMissingCapability::mapSelectContent
    ));
    REQUIRE_NEAR(
        unknownExternalPacket.glyphRuns().back().pixelsPerEm,
        labelSize,
        1.0e-6
    );
    REQUIRE(unknownExternalPacket.isRenderOrderValid());
}

struct TestCase final {
    std::string_view name;
    void (*run)();
};

} // namespace

int main() {
    const std::array tests{
        TestCase{"surface order formula", testSurfaceOrderFormulaAndOverflowTransaction},
        TestCase{
            "settled exact v2 capacity",
            testSettledTitleBuildUsesExactV2CapacityAndExplicitPlaceholders
        },
        TestCase{"mid entrance geometry", testMidEntranceUsesSampledCardAndLogoGeometry},
        TestCase{
            "DPR2 viewport mapping",
            testDpr2ViewportKeepsLogicalLayoutAndDrawableMappingSeparate
        },
        TestCase{"ultrawide safe area", testUltrawideAndSafeAreaKeepShellInsideAuthoritativeLayout},
        TestCase{
            "nested external pass anchor",
            testNestedExternalSequenceTwoUsesExactPassAnchorAndNoGenericTitleContent
        },
        TestCase{
            "overlay controls and backdrop revision",
            testOverlayButtonsUseSharedGeometryInteractionAndBackdropRevision
        },
        TestCase{
            "exit fixed transaction",
            testExitShellAndInsufficientFixedCapacityAreTransactional
        },
        TestCase{
            "active builder preservation",
            testActiveBuilderTransactionIsPreserved
        },
        TestCase{
            "map select shell and quick start dummy",
            testMapSelectRendersDialogShellWhileQuickStartRemainsDimOnly
        },
        TestCase{
            "interaction target mapping",
            testInteractionTargetsChangeOnlyTheirShellAndRejectInvalidTables
        },
        TestCase{
            "maximum capacity zero allocation",
            testMaximumCapacityContainsFourKeyStateAndRepeatedBuildAllocatesNothing
        },
        TestCase{
            "resource-backed title, overlays, partial, and responsive text",
            testResourceBackedTitleOverlayPartialAndResponsiveText
        }
    };

    std::size_t passed = 0U;
    for (const TestCase& test : tests) {
        try {
            test.run();
            ++passed;
            std::cout << "[PASS] " << test.name << '\n';
        } catch (const std::exception& error) {
            allocation_probe::enabled = false;
            std::cerr << "[FAIL] " << test.name << ": " << error.what() << '\n';
            return 1;
        }
    }
    std::cout << passed << '/' << tests.size() << " tests passed\n";
    return 0;
}
