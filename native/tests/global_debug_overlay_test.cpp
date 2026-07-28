#include "render/frontend/global_debug_overlay.h"

#include "game/game_system.h"
#include "render/frontend/playable_game_scene.h"
#include "render/frontend/synthetic_test_scene.h"
#include "render/frontend/title_scene.h"
#include "render/text/title_text_catalog.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <iostream>
#include <limits>
#include <span>
#include <stdexcept>
#include <string>
#include <string_view>

namespace {

using cirvivor::render::BlendMode;
using cirvivor::render::ClipOperation;
using cirvivor::render::CommandHeader;
using cirvivor::render::CommandKind;
using cirvivor::render::CommandRef;
using cirvivor::render::CoordinateSpace;
using cirvivor::render::FrameMetadata;
using cirvivor::render::FramePacket;
using cirvivor::render::FramePacketCapacity;
using cirvivor::render::OverlayOperation;
using cirvivor::render::PassOperation;
using cirvivor::render::PremultipliedRgba;
using cirvivor::render::RenderLayer;
using cirvivor::render::UiCommand;
using cirvivor::render::UiPrimitive;
using cirvivor::render::UiTextLocale;
using cirvivor::render::UiTextSemanticId;
using cirvivor::render::frontend::FrameBuildError;
using cirvivor::render::frontend::FramePacketBuilder;
using cirvivor::render::frontend::GlobalDebugOverlayInput;
using cirvivor::render::frontend::PacketCapacityPolicy;
using cirvivor::render::frontend::addGlobalDebugOverlay;
using cirvivor::render::frontend::globalDebugOverlayCapacity;
using cirvivor::render::frontend::makeTitleViewport;
using cirvivor::render::frontend::maximumGlobalDebugOverlayCapacity;
using cirvivor::render::frontend::PlayableGameSceneConfig;
using cirvivor::render::frontend::SyntheticSceneConfig;
using cirvivor::render::frontend::TitleSceneInput;
using cirvivor::ui::OverlayKind;
using cirvivor::ui::TitleOverlayPresentationSet;
using cirvivor::ui::TitleOverlayStateMachine;
using cirvivor::ui::TitleUiControllerSnapshot;
using cirvivor::ui::TitleUiTarget;
using cirvivor::ui::UiAction;
using cirvivor::ui::UiStateSnapshot;
using cirvivor::ui::layout::LayoutInput;
using cirvivor::ui::layout::ThemeColor;
using cirvivor::ui::layout::TitleEntranceRenderState;
using cirvivor::ui::layout::UiLayoutMetrics;
using cirvivor::ui::layout::UiLayoutSnapshot;
using cirvivor::ui::layout::darkThemeMetrics;

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

constexpr std::array debug_semantics{
    UiTextSemanticId::debugTitle,
    UiTextSemanticId::debugFrameTime,
    UiTextSemanticId::debugPoolInfo,
    UiTextSemanticId::debugHitboxes,
    UiTextSemanticId::debugAnimation,
    UiTextSemanticId::debugHint,
    UiTextSemanticId::debugDevTools,
    UiTextSemanticId::debugClose
};

struct DebugTextResources final {
    static constexpr std::uint64_t generation = 31U;
    static constexpr cirvivor::render::ResourceId font_id =
        cirvivor::render::stableResourceId("test/global-debug-font");
    static constexpr cirvivor::render::ResourceId atlas_id =
        cirvivor::render::stableResourceId("test/global-debug-atlas");

    std::array<std::uint8_t, 1> pixels{255U};
    std::array<cirvivor::render::GlyphInstance, debug_semantics.size()> glyphs{};
    std::array<cirvivor::render::PreShapedTextRunView, debug_semantics.size()> runs{};
    std::array<cirvivor::render::Alpha8TextureResourceView, 1> resources{};

    DebugTextResources() noexcept {
        for (std::size_t index = 0U; index < runs.size(); ++index) {
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
                    debug_semantics[index],
                    UiTextLocale::korean
                ),
                font_id,
                atlas_id,
                64U,
                32.0F,
                48.0F,
                16.0F,
                std::span<const cirvivor::render::GlyphInstance>(
                    &glyphs[index],
                    1U
                )
            };
        }
        resources[0] = {
            atlas_id,
            generation,
            1U,
            1U,
            1U,
            pixels
        };
    }

    [[nodiscard]] cirvivor::render::PreShapedTextResourcesView view(
        const std::size_t count = debug_semantics.size()
    ) const noexcept {
        return {
            generation,
            std::span<const cirvivor::render::PreShapedTextRunView>(
                runs.data(),
                std::min(count, runs.size())
            ),
            cirvivor::render::RenderResourcesView(resources)
        };
    }
};

struct FullTitleTextResources final {
    static constexpr std::uint64_t generation = 37U;
    static constexpr cirvivor::render::ResourceId font_id =
        cirvivor::render::stableResourceId("test/global-debug-full-title-font");
    static constexpr cirvivor::render::ResourceId atlas_id =
        cirvivor::render::stableResourceId("test/global-debug-full-title-atlas");

    std::array<std::uint8_t, 1> pixels{255U};
    std::array<
        cirvivor::render::GlyphInstance,
        cirvivor::render::text::title_text_catalog.size()
    > glyphs{};
    std::array<
        cirvivor::render::PreShapedTextRunView,
        cirvivor::render::text::title_text_catalog.size()
    > runs{};
    std::array<cirvivor::render::Alpha8TextureResourceView, 1> resources{};

    FullTitleTextResources() noexcept {
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
                    UiTextLocale::korean
                ),
                font_id,
                atlas_id,
                64U,
                32.0F,
                48.0F,
                16.0F,
                std::span<const cirvivor::render::GlyphInstance>(
                    &glyphs[index],
                    1U
                )
            };
        }
        resources[0] = {
            atlas_id,
            generation,
            1U,
            1U,
            1U,
            pixels
        };
    }

    [[nodiscard]] cirvivor::render::PreShapedTextResourcesView view() const noexcept {
        return {
            generation,
            std::span<const cirvivor::render::PreShapedTextRunView>(runs),
            cirvivor::render::RenderResourcesView(resources)
        };
    }
};

[[nodiscard]] UiLayoutSnapshot buildLayout(
    const double width = 1'280.0,
    const double height = 720.0
) {
    UiLayoutMetrics metrics;
    REQUIRE(metrics.tryUpdate(LayoutInput{width, height, 1.0, true, {}}));
    return metrics.snapshot();
}

[[nodiscard]] TitleEntranceRenderState buildEntrance(
    const UiLayoutSnapshot& layout
) {
    TitleEntranceRenderState entrance{};
    REQUIRE(cirvivor::ui::layout::trySampleTitleEntrance(
        layout,
        2.0,
        entrance
    ));
    return entrance;
}

void advanceInSteps(
    TitleOverlayStateMachine& state,
    const double seconds
) noexcept {
    double remaining = seconds;
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

struct DebugState final {
    UiStateSnapshot uiState{};
    TitleOverlayPresentationSet presentations{};
    std::uint32_t debugSequence = 0U;
};

[[nodiscard]] DebugState buildDebugState(
    const UiLayoutSnapshot& layout,
    const bool includeNonDebugOverlay
) {
    TitleOverlayStateMachine state = interactiveState();
    if (includeNonDebugOverlay) {
        REQUIRE(state.apply(UiAction::openTitle(OverlayKind::credits)).accepted());
    }
    const auto opened = state.apply(UiAction::openDebug());
    REQUIRE(opened.accepted());
    advanceInSteps(state, TitleOverlayStateMachine::overlay_transition_seconds);

    DebugState result{};
    result.uiState = state.snapshot();
    result.debugSequence = opened.overlaySequence;
    REQUIRE(cirvivor::ui::tryBuildTitleOverlayPresentationSet(
        result.uiState,
        layout,
        result.presentations
    ));
    return result;
}

[[nodiscard]] const cirvivor::ui::OverlaySnapshot* debugOverlay(
    const UiStateSnapshot& state
) noexcept {
    for (std::size_t index = 0U; index < state.overlayCount; ++index) {
        if (state.overlays[index].kind == OverlayKind::debug) {
            return &state.overlays[index];
        }
    }
    return nullptr;
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

[[nodiscard]] PremultipliedRgba renderThemeColor(
    const ThemeColor color,
    const double alphaScale
) noexcept {
    constexpr float byte_scale = 1.0F / 255.0F;
    const float alpha = static_cast<float>(std::clamp(
        color.alpha * alphaScale,
        0.0,
        1.0
    ));
    return PremultipliedRgba::fromStraight(
        static_cast<float>(color.red) * byte_scale,
        static_cast<float>(color.green) * byte_scale,
        static_cast<float>(color.blue) * byte_scale,
        alpha
    );
}

[[nodiscard]] cirvivor::render::StableElementId expectedSessionId(
    const std::string_view baseName,
    const std::uint32_t sequence
) noexcept {
    const auto base = cirvivor::render::stableResourceId(baseName);
    auto value = base
        ^ (static_cast<cirvivor::render::StableElementId>(sequence)
            * 0x9e37'79b9'7f4a'7c15ULL);
    if (value == 0U) {
        value = base == 0U ? 1U : base;
    }
    return value;
}

[[nodiscard]] cirvivor::render::StableElementId expectedContentId(
    const std::string_view baseName,
    const std::uint32_t sequence,
    const std::uint32_t local = 0U
) noexcept {
    return cirvivor::render::stableResourceId(baseName)
        ^ (static_cast<cirvivor::render::StableElementId>(sequence) << 32U)
        ^ static_cast<cirvivor::render::StableElementId>(local + 1U);
}

[[nodiscard]] bool capacityContains(
    const FramePacketCapacity& outer,
    const FramePacketCapacity& inner
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

void testNoDebugIsExactZeroAndBuilderNoOp() {
    const UiLayoutSnapshot layout = buildLayout();
    TitleOverlayStateMachine state = interactiveState();
    REQUIRE(state.apply(UiAction::openTitle(OverlayKind::credits)).accepted());
    advanceInSteps(state, TitleOverlayStateMachine::overlay_transition_seconds);
    const UiStateSnapshot uiState = state.snapshot();
    TitleOverlayPresentationSet presentations{};
    REQUIRE(cirvivor::ui::tryBuildTitleOverlayPresentationSet(
        uiState,
        layout,
        presentations
    ));
    const TitleUiControllerSnapshot interaction = idleInteraction();
    const GlobalDebugOverlayInput input{
        uiState,
        interaction,
        layout,
        darkThemeMetrics(),
        presentations
    };
    REQUIRE(globalDebugOverlayCapacity(input) == FramePacketCapacity{});

    FramePacket packet;
    FramePacketBuilder builder(packet, PacketCapacityPolicy::fixedCapacity);
    REQUIRE(builder.begin(FrameMetadata{}, makeTitleViewport(layout)));
    REQUIRE(addGlobalDebugOverlay(builder, input));
    REQUIRE(builder.nextSequence() == 0U);
    REQUIRE(builder.finish());
    REQUIRE(packet.size() == FramePacketCapacity{});
    REQUIRE(packet.isRenderOrderValid());
}

void testGlassCapacityOrderSessionsAndPacketValidation() {
    const DebugTextResources text;
    const UiLayoutSnapshot layout = buildLayout();
    const DebugState state = buildDebugState(layout, true);
    const TitleUiControllerSnapshot interaction = idleInteraction();
    const auto& theme = darkThemeMetrics();
    const GlobalDebugOverlayInput input{
        state.uiState,
        interaction,
        layout,
        theme,
        state.presentations,
        text.view(),
        UiTextLocale::korean,
        false,
        77U
    };
    FramePacketCapacity expected{};
    expected.commandCount = 27U;
    expected.shapeCount = 1U;
    expected.uiCount = 7U;
    expected.overlayCount = 5U;
    expected.glyphRunCount = 8U;
    expected.glyphInstanceCount = 8U;
    expected.clipCount = 2U;
    expected.passCount = 4U;
    REQUIRE(globalDebugOverlayCapacity(input) == expected);
    REQUIRE(capacityContains(maximumGlobalDebugOverlayCapacity(), expected));

    FramePacket packet(expected);
    FramePacketBuilder builder(packet, PacketCapacityPolicy::fixedCapacity);
    REQUIRE(builder.begin(FrameMetadata{}, makeTitleViewport(layout)));
    REQUIRE(addGlobalDebugOverlay(builder, input));
    REQUIRE(builder.finish());
    REQUIRE(packet.size() == expected);
    REQUIRE(packet.isStructurallyValid());
    REQUIRE(packet.isRenderOrderValid());

    const auto* const overlay = debugOverlay(state.uiState);
    REQUIRE(overlay != nullptr);
    REQUIRE(overlay->sequence == state.debugSequence);
    const std::int32_t baseOrder = static_cast<std::int32_t>(overlay->layer) * 1'000
        + static_cast<std::int32_t>(overlay->sequence) * 10;
    const std::array expectedKinds{
        CommandKind::overlay,
        CommandKind::overlay,
        CommandKind::overlay,
        CommandKind::pass,
        CommandKind::pass,
        CommandKind::pass,
        CommandKind::pass,
        CommandKind::overlay,
        CommandKind::clip,
        CommandKind::ui,
        CommandKind::shape,
        CommandKind::ui,
        CommandKind::ui,
        CommandKind::ui,
        CommandKind::ui,
        CommandKind::ui,
        CommandKind::ui,
        CommandKind::glyphRun,
        CommandKind::glyphRun,
        CommandKind::glyphRun,
        CommandKind::glyphRun,
        CommandKind::glyphRun,
        CommandKind::glyphRun,
        CommandKind::glyphRun,
        CommandKind::glyphRun,
        CommandKind::clip,
        CommandKind::overlay
    };
    REQUIRE(packet.commandStream().size() == expectedKinds.size());
    for (std::size_t index = 0U; index < expectedKinds.size(); ++index) {
        REQUIRE(packet.commandStream()[index].kind == expectedKinds[index]);
        const CommandHeader* const header = commandHeader(
            packet,
            packet.commandStream()[index]
        );
        REQUIRE(header != nullptr);
        REQUIRE(header->sequence == index);
        REQUIRE(header->layer == RenderLayer::dynamicOverlay);
        const std::int32_t expectedOrder = index < 3U
            ? baseOrder - 1
            : index < 7U
                ? baseOrder
                : baseOrder + 1;
        REQUIRE(header->layerOrder == expectedOrder);
    }

    REQUIRE(packet.overlays()[0].operation == OverlayOperation::beginSession);
    REQUIRE(packet.overlays()[1].operation == OverlayOperation::dim);
    REQUIRE(packet.overlays()[2].operation == OverlayOperation::endSession);
    REQUIRE(packet.overlays()[3].operation == OverlayOperation::beginSession);
    REQUIRE(packet.overlays()[4].operation == OverlayOperation::endSession);
    REQUIRE(packet.overlays()[0].sessionId == expectedSessionId(
        "title.overlay.dim",
        overlay->sequence
    ));
    REQUIRE(packet.overlays()[3].sessionId == expectedSessionId(
        "title.overlay.ui",
        overlay->sequence
    ));
    REQUIRE_NEAR(packet.overlays()[1].opacity, 0.16, 1.0e-7);
    REQUIRE(packet.overlays()[1].sourceRevision == 77U);

    for (std::size_t index = 0U; index < packet.passes().size(); ++index) {
        REQUIRE(packet.passes()[index].operation
            == static_cast<PassOperation>(index));
        REQUIRE(packet.passes()[index].sessionId == expectedSessionId(
            "title.overlay.effect",
            overlay->sequence
        ));
        REQUIRE(packet.passes()[index].destinationId == expectedSessionId(
            "title.overlay.effect.destination",
            overlay->sequence
        ));
        REQUIRE(packet.passes()[index].sourceRevision == 77U);
    }
    REQUIRE(packet.passes()[1].sourceAnchorSequence == 2U);
    REQUIRE(packet.passes()[1].sourceAnchorLayer == RenderLayer::dynamicOverlay);
    REQUIRE(packet.passes()[1].sourceAnchorLayerOrder == baseOrder - 1);

    REQUIRE(packet.clips()[0].operation == ClipOperation::pushRoundedRect);
    REQUIRE(packet.clips()[0].antialias == 1U);
    REQUIRE(packet.clips()[1].operation == ClipOperation::pop);
    REQUIRE(packet.ui()[0].primitive == UiPrimitive::panel);
    REQUIRE(packet.ui()[0].elementId == expectedContentId(
        "title.overlay.content.panel",
        overlay->sequence
    ));
    for (std::size_t index = 0U; index < 6U; ++index) {
        REQUIRE(packet.ui()[index + 1U].elementId == expectedContentId(
            "title.overlay.content.control",
            overlay->sequence,
            static_cast<std::uint32_t>(index)
        ));
    }
    for (std::size_t index = 0U; index < packet.glyphInstances().size(); ++index) {
        REQUIRE(packet.glyphInstances()[index].glyphIndex == index + 1U);
    }
}

void testOpaqueCapacityRemovesPassAndUsesPanelTokens() {
    const DebugTextResources text;
    const UiLayoutSnapshot layout = buildLayout();
    const DebugState state = buildDebugState(layout, false);
    const TitleUiControllerSnapshot interaction = idleInteraction();
    const auto& theme = darkThemeMetrics();
    const GlobalDebugOverlayInput input{
        state.uiState,
        interaction,
        layout,
        theme,
        state.presentations,
        text.view(),
        UiTextLocale::korean,
        true,
        91U
    };
    const FramePacketCapacity exact = globalDebugOverlayCapacity(input);
    REQUIRE(exact.commandCount == 23U);
    REQUIRE(exact.shapeCount == 1U);
    REQUIRE(exact.uiCount == 7U);
    REQUIRE(exact.overlayCount == 5U);
    REQUIRE(exact.glyphRunCount == 8U);
    REQUIRE(exact.glyphInstanceCount == 8U);
    REQUIRE(exact.clipCount == 2U);
    REQUIRE(exact.passCount == 0U);

    FramePacket packet(exact);
    FramePacketBuilder builder(packet, PacketCapacityPolicy::fixedCapacity);
    REQUIRE(builder.begin(FrameMetadata{}, makeTitleViewport(layout)));
    REQUIRE(addGlobalDebugOverlay(builder, input));
    REQUIRE(builder.finish());
    REQUIRE(packet.size() == exact);
    REQUIRE(packet.passes().empty());
    REQUIRE(packet.commandStream()[3].kind == CommandKind::overlay);
    REQUIRE(packet.commandStream()[4].kind == CommandKind::clip);
    REQUIRE(packet.ui()[0].backgroundColor == renderThemeColor(
        theme.overlayPanelBackground,
        state.uiState.overlays[0].alpha
    ));
    REQUIRE(packet.ui()[0].borderColor == renderThemeColor(
        theme.overlayPanelBorder,
        state.uiState.overlays[0].alpha
    ));
    REQUIRE(packet.isRenderOrderValid());
}

void testMissingTextAndInvalidDtoFailBeforeMutation() {
    const DebugTextResources text;
    const UiLayoutSnapshot layout = buildLayout();
    const DebugState state = buildDebugState(layout, false);
    const TitleUiControllerSnapshot interaction = idleInteraction();
    const GlobalDebugOverlayInput missingText{
        state.uiState,
        interaction,
        layout,
        darkThemeMetrics(),
        state.presentations,
        text.view(debug_semantics.size() - 1U)
    };
    REQUIRE(globalDebugOverlayCapacity(missingText) == FramePacketCapacity{});

    FramePacketCapacity storage = maximumGlobalDebugOverlayCapacity();
    storage.commandCount += 2U;
    storage.uiCount += 2U;
    FramePacket packet(storage);
    FramePacketBuilder builder(packet, PacketCapacityPolicy::fixedCapacity);
    REQUIRE(builder.begin(FrameMetadata{}, makeTitleViewport(layout)));
    UiCommand marker{};
    marker.header = {
        RenderLayer::ui,
        CoordinateSpace::logicalUi,
        BlendMode::premultipliedAlpha,
        0U,
        10U,
        0U
    };
    marker.primitive = UiPrimitive::custom;
    marker.elementId = 101U;
    marker.bounds = {1.0F, 2.0F, 3.0F, 4.0F};
    REQUIRE(builder.addUi(marker));
    const FramePacketCapacity before = packet.size();
    REQUIRE(!addGlobalDebugOverlay(builder, missingText));
    REQUIRE(builder.error() == FrameBuildError::none);
    REQUIRE(packet.size() == before);
    marker.elementId = 102U;
    REQUIRE(builder.addUi(marker));
    REQUIRE(builder.finish());
    REQUIRE(packet.ui().size() == 2U);
    REQUIRE(packet.isRenderOrderValid());

    TitleOverlayPresentationSet stale = state.presentations;
    ++stale.stateRevision;
    const GlobalDebugOverlayInput staleInput{
        state.uiState,
        interaction,
        layout,
        darkThemeMetrics(),
        stale,
        text.view()
    };
    REQUIRE(globalDebugOverlayCapacity(staleInput) == FramePacketCapacity{});
    FramePacket stalePacket(maximumGlobalDebugOverlayCapacity());
    FramePacketBuilder staleBuilder(
        stalePacket,
        PacketCapacityPolicy::fixedCapacity
    );
    REQUIRE(staleBuilder.begin(FrameMetadata{}, makeTitleViewport(layout)));
    REQUIRE(!addGlobalDebugOverlay(staleBuilder, staleInput));
    REQUIRE(staleBuilder.nextSequence() == 0U);
    REQUIRE(staleBuilder.finish());
}

void testFixedCapacityFailureRollsBackWithCallerTransaction() {
    const DebugTextResources text;
    const UiLayoutSnapshot layout = buildLayout();
    const DebugState state = buildDebugState(layout, false);
    const TitleUiControllerSnapshot interaction = idleInteraction();
    const GlobalDebugOverlayInput input{
        state.uiState,
        interaction,
        layout,
        darkThemeMetrics(),
        state.presentations,
        text.view()
    };
    FramePacketCapacity insufficient = globalDebugOverlayCapacity(input);
    REQUIRE(insufficient.glyphInstanceCount == 8U);
    --insufficient.glyphInstanceCount;

    FramePacket packet(insufficient);
    FramePacketBuilder builder(packet, PacketCapacityPolicy::fixedCapacity);
    REQUIRE(builder.begin(FrameMetadata{}, makeTitleViewport(layout)));
    REQUIRE(!addGlobalDebugOverlay(builder, input));
    REQUIRE(builder.error() == FrameBuildError::capacityExceeded);
    REQUIRE(packet.size() != FramePacketCapacity{});
    builder.abort();
    REQUIRE(packet.size() == FramePacketCapacity{});
    REQUIRE(!builder.isBuilding());
}

void testPlayableSceneComposesDebugAfterLetterboxAtExactCapacity() {
    const DebugTextResources text;
    const UiLayoutSnapshot layout = buildLayout(1'920.0, 1'080.0);
    const DebugState state = buildDebugState(layout, false);
    const TitleUiControllerSnapshot interaction = idleInteraction();
    const auto& theme = darkThemeMetrics();
    const GlobalDebugOverlayInput input{
        state.uiState,
        interaction,
        layout,
        theme,
        state.presentations,
        text.view(),
        UiTextLocale::korean,
        false,
        101U
    };

    cirvivor::game::GameSystem gameSystem;
    PlayableGameSceneConfig config;
    config.physicalDisplaySize = {1'200, 1'000};
    config.physicalWindowBounds = {0, 0, 1'200, 1'000};
    config.drawableSize = {1'200, 1'000};
    config.widescreenSupport = true;

    const FramePacketCapacity base =
        cirvivor::render::frontend::playableGameSceneCapacity(gameSystem, config);
    const FramePacketCapacity debug = globalDebugOverlayCapacity(input);
    const FramePacketCapacity combined =
        cirvivor::render::frontend::playableGameSceneCapacity(
            gameSystem,
            config,
            &input
        );
    REQUIRE(combined == cirvivor::render::additiveFramePacketCapacity(base, debug));
    REQUIRE(base.commandCount >= 2U);

    FramePacket packet(combined);
    const auto result = cirvivor::render::frontend::buildPlayableGameScene(
        packet,
        gameSystem,
        config,
        PacketCapacityPolicy::fixedCapacity,
        &input
    );
    REQUIRE(result.success);
    REQUIRE(result.error == FrameBuildError::none);
    REQUIRE(packet.size() == combined);
    REQUIRE(packet.isStructurallyValid());
    REQUIRE(packet.isRenderOrderValid());

    const auto commands = packet.commandStream();
    REQUIRE(commands.size() == combined.commandCount);
    for (std::size_t index = base.commandCount - 2U;
         index < base.commandCount;
         ++index) {
        const CommandHeader* const mask = commandHeader(packet, commands[index]);
        REQUIRE(commands[index].kind == CommandKind::shape);
        REQUIRE(mask != nullptr);
        REQUIRE(mask->layer == RenderLayer::ui);
        REQUIRE(mask->coordinateSpace == CoordinateSpace::drawablePixels);
        REQUIRE(mask->blendMode == BlendMode::opaque);
        REQUIRE(mask->layerOrder == std::numeric_limits<std::int32_t>::min());
    }
    const CommandHeader* const firstDebug = commandHeader(
        packet,
        commands[base.commandCount]
    );
    REQUIRE(firstDebug != nullptr);
    REQUIRE(firstDebug->layer == RenderLayer::dynamicOverlay);
    REQUIRE(firstDebug->sequence == base.commandCount);
}

void testPlayableUltrawideDimCoversFullDrawableAtEveryDpi() {
    const DebugTextResources text;
    const UiLayoutSnapshot layout = buildLayout(1'920.0, 1'080.0);
    const DebugState state = buildDebugState(layout, false);
    const TitleUiControllerSnapshot interaction = idleInteraction();
    const GlobalDebugOverlayInput input{
        state.uiState,
        interaction,
        layout,
        darkThemeMetrics(),
        state.presentations,
        text.view(),
        UiTextLocale::korean,
        false,
        151U
    };
    cirvivor::game::GameSystem gameSystem;

    const auto requireFullDrawableDim = [&](const int pixelScale) {
        PlayableGameSceneConfig config;
        config.physicalDisplaySize = {2'560, 1'080};
        config.physicalWindowBounds = {0, 0, 2'560, 1'080};
        config.drawableSize = {2'560 * pixelScale, 1'080 * pixelScale};
        config.dpiScale = static_cast<float>(pixelScale);
        config.widescreenSupport = true;

        const FramePacketCapacity exact =
            cirvivor::render::frontend::playableGameSceneCapacity(
                gameSystem,
                config,
                &input
            );
        FramePacket packet(exact);
        const auto result = cirvivor::render::frontend::buildPlayableGameScene(
            packet,
            gameSystem,
            config,
            PacketCapacityPolicy::fixedCapacity,
            &input
        );
        REQUIRE(result.success);
        REQUIRE(packet.isRenderOrderValid());
        REQUIRE(packet.overlays().size() >= 2U);
        const auto& dim = packet.overlays()[1];
        REQUIRE(dim.operation == OverlayOperation::dim);
        REQUIRE(dim.header.coordinateSpace == CoordinateSpace::logicalUi);
        REQUIRE_NEAR(dim.destinationBounds.x, -320.0, 1.0e-4);
        REQUIRE_NEAR(dim.destinationBounds.y, 0.0, 1.0e-4);
        REQUIRE_NEAR(dim.destinationBounds.width, 2'560.0, 1.0e-4);
        REQUIRE_NEAR(dim.destinationBounds.height, 1'080.0, 1.0e-4);

        const auto viewport = packet.viewport();
        REQUIRE_NEAR(
            static_cast<double>(viewport.drawable.contentRect.x)
                + static_cast<double>(dim.destinationBounds.x)
                    * viewport.logicalUi.drawablePixelsPerLogicalUnitX,
            0.0,
            1.0e-3
        );
        REQUIRE_NEAR(
            static_cast<double>(viewport.drawable.contentRect.x)
                + static_cast<double>(
                    dim.destinationBounds.x + dim.destinationBounds.width
                ) * viewport.logicalUi.drawablePixelsPerLogicalUnitX,
            static_cast<double>(config.drawableSize.width),
            1.0e-3
        );
        REQUIRE(packet.clips().size() == 2U);
        REQUIRE(packet.clips()[0].bounds.x >= 0.0F);
        REQUIRE(packet.clips()[0].bounds.x + packet.clips()[0].bounds.width
            <= 1'920.0F);
    };

    requireFullDrawableDim(1);
    requireFullDrawableDim(2);
}

void testSyntheticSceneComposesDebugBetweenExistingOverlayAndTop() {
    const DebugTextResources text;
    const UiLayoutSnapshot layout = buildLayout(1'920.0, 1'080.0);
    const DebugState state = buildDebugState(layout, false);
    const TitleUiControllerSnapshot interaction = idleInteraction();
    const GlobalDebugOverlayInput input{
        state.uiState,
        interaction,
        layout,
        darkThemeMetrics(),
        state.presentations,
        text.view(),
        UiTextLocale::korean,
        false,
        109U
    };

    const FramePacketCapacity base =
        cirvivor::render::frontend::syntheticTestSceneCapacity();
    const FramePacketCapacity debug = globalDebugOverlayCapacity(input);
    const FramePacketCapacity combined =
        cirvivor::render::frontend::syntheticTestSceneCapacity(input);
    REQUIRE(combined == cirvivor::render::additiveFramePacketCapacity(base, debug));

    FramePacket basePacket(base);
    REQUIRE(cirvivor::render::frontend::buildSyntheticTestScene(
        basePacket,
        SyntheticSceneConfig{},
        PacketCapacityPolicy::fixedCapacity
    ).success);
    const FramePacketCapacity expectedSize =
        cirvivor::render::additiveFramePacketCapacity(basePacket.size(), debug);

    FramePacket packet(combined);
    const auto result = cirvivor::render::frontend::buildSyntheticTestScene(
        packet,
        SyntheticSceneConfig{},
        PacketCapacityPolicy::fixedCapacity,
        &input
    );
    REQUIRE(result.success);
    REQUIRE(result.error == FrameBuildError::none);
    REQUIRE(packet.capacity() == combined);
    REQUIRE(packet.size() == expectedSize);
    REQUIRE(packet.isStructurallyValid());
    REQUIRE(packet.isRenderOrderValid());
    REQUIRE(packet.overlays().size() == base.overlayCount + debug.overlayCount);
    REQUIRE(base.overlayCount == 4U);

    const auto& existingEnd = packet.overlays()[base.overlayCount - 1U];
    const auto& debugBegin = packet.overlays()[base.overlayCount];
    const auto& debugEnd = packet.overlays().back();
    REQUIRE(existingEnd.operation == OverlayOperation::endSession);
    REQUIRE(existingEnd.sessionId == cirvivor::render::stableResourceId(
        "synthetic/overlay/session"
    ));
    REQUIRE(debugBegin.operation == OverlayOperation::beginSession);
    REQUIRE(debugBegin.sessionId == expectedSessionId(
        "title.overlay.dim",
        state.debugSequence
    ));
    REQUIRE(debugEnd.operation == OverlayOperation::endSession);
    REQUIRE(existingEnd.header.sequence + 1U == debugBegin.header.sequence);

    const auto commands = packet.commandStream();
    REQUIRE(commands.size() >= 2U);
    const CommandHeader* const topBorder = commandHeader(
        packet,
        commands[commands.size() - 2U]
    );
    const CommandHeader* const topLabel = commandHeader(packet, commands.back());
    REQUIRE(topBorder != nullptr);
    REQUIRE(topLabel != nullptr);
    REQUIRE(topBorder->layer == RenderLayer::top);
    REQUIRE(topLabel->layer == RenderLayer::top);
    REQUIRE(debugEnd.header.sequence + 1U == topBorder->sequence);
    REQUIRE(topBorder->sequence + 1U == topLabel->sequence);
}

void testCombinedSceneCapacityShortfallRollsBackWholePacket() {
    const DebugTextResources text;
    const UiLayoutSnapshot layout = buildLayout(1'920.0, 1'080.0);
    const DebugState state = buildDebugState(layout, false);
    const TitleUiControllerSnapshot interaction = idleInteraction();
    const GlobalDebugOverlayInput input{
        state.uiState,
        interaction,
        layout,
        darkThemeMetrics(),
        state.presentations,
        text.view()
    };

    cirvivor::game::GameSystem gameSystem;
    PlayableGameSceneConfig playableConfig;
    playableConfig.physicalDisplaySize = {1'200, 1'000};
    playableConfig.physicalWindowBounds = {0, 0, 1'200, 1'000};
    playableConfig.drawableSize = {1'200, 1'000};
    FramePacketCapacity playableInsufficient =
        cirvivor::render::frontend::playableGameSceneCapacity(
            gameSystem,
            playableConfig,
            &input
        );
    REQUIRE(playableInsufficient.commandCount > 0U);
    --playableInsufficient.commandCount;
    FramePacket playablePacket(playableInsufficient);
    const auto playableResult =
        cirvivor::render::frontend::buildPlayableGameScene(
            playablePacket,
            gameSystem,
            playableConfig,
            PacketCapacityPolicy::fixedCapacity,
            &input
        );
    REQUIRE(!playableResult.success);
    REQUIRE(playableResult.error == FrameBuildError::capacityExceeded);
    REQUIRE(playablePacket.size() == FramePacketCapacity{});

    FramePacketCapacity syntheticInsufficient =
        cirvivor::render::frontend::syntheticTestSceneCapacity(input);
    REQUIRE(syntheticInsufficient.commandCount > 0U);
    --syntheticInsufficient.commandCount;
    FramePacket syntheticPacket(syntheticInsufficient);
    const auto syntheticResult =
        cirvivor::render::frontend::buildSyntheticTestScene(
            syntheticPacket,
            SyntheticSceneConfig{},
            PacketCapacityPolicy::fixedCapacity,
            &input
        );
    REQUIRE(!syntheticResult.success);
    REQUIRE(syntheticResult.error == FrameBuildError::capacityExceeded);
    REQUIRE(syntheticPacket.size() == FramePacketCapacity{});
}

void testTitleDebugSliceMatchesStandaloneComposer() {
    const FullTitleTextResources text;
    const UiLayoutSnapshot layout = buildLayout();
    const TitleEntranceRenderState entrance = buildEntrance(layout);
    const DebugState debugState = buildDebugState(layout, false);
    const TitleUiControllerSnapshot interaction = idleInteraction();
    const auto& theme = darkThemeMetrics();

    TitleOverlayStateMachine baseStateMachine = interactiveState();
    const UiStateSnapshot baseState = baseStateMachine.snapshot();
    TitleOverlayPresentationSet basePresentations{};
    REQUIRE(cirvivor::ui::tryBuildTitleOverlayPresentationSet(
        baseState,
        layout,
        basePresentations
    ));
    const TitleSceneInput baseInput{
        baseState,
        interaction,
        layout,
        entrance,
        theme,
        text.view(),
        UiTextLocale::korean,
        &basePresentations
    };
    const TitleSceneInput titleInput{
        debugState.uiState,
        interaction,
        layout,
        entrance,
        theme,
        text.view(),
        UiTextLocale::korean,
        &debugState.presentations
    };
    constexpr std::uint64_t backdrop_revision = 127U;
    const GlobalDebugOverlayInput composerInput{
        debugState.uiState,
        interaction,
        layout,
        theme,
        debugState.presentations,
        text.view(),
        UiTextLocale::korean,
        false,
        backdrop_revision
    };

    cirvivor::render::frontend::TitleSceneConfig config;
    config.backdropRevision = backdrop_revision;
    const FramePacketCapacity baseCapacity = titleSceneCapacity(baseInput);
    const FramePacketCapacity debugCapacity = globalDebugOverlayCapacity(
        composerInput
    );
    const FramePacketCapacity titleCapacity = titleSceneCapacity(titleInput);
    REQUIRE(titleCapacity == cirvivor::render::additiveFramePacketCapacity(
        baseCapacity,
        debugCapacity
    ));

    FramePacket titlePacket(titleCapacity);
    const auto titleResult = cirvivor::render::frontend::buildTitleScene(
        titlePacket,
        titleInput,
        config
    );
    REQUIRE(titleResult.success);
    REQUIRE(titlePacket.size() == titleCapacity);
    REQUIRE(titlePacket.isRenderOrderValid());

    FramePacket composerPacket(debugCapacity);
    FramePacketBuilder builder(composerPacket, PacketCapacityPolicy::fixedCapacity);
    REQUIRE(builder.begin(FrameMetadata{}, makeTitleViewport(layout, config)));
    REQUIRE(addGlobalDebugOverlay(builder, composerInput));
    REQUIRE(builder.finish());
    REQUIRE(composerPacket.size() == debugCapacity);

    std::size_t firstDynamic = titlePacket.commandStream().size();
    std::size_t dynamicCount = 0U;
    for (std::size_t index = 0U;
         index < titlePacket.commandStream().size();
         ++index) {
        const CommandHeader* const header = commandHeader(
            titlePacket,
            titlePacket.commandStream()[index]
        );
        REQUIRE(header != nullptr);
        if (header->layer != RenderLayer::dynamicOverlay) {
            continue;
        }
        if (firstDynamic == titlePacket.commandStream().size()) {
            firstDynamic = index;
        }
        REQUIRE(index == firstDynamic + dynamicCount);
        ++dynamicCount;
    }
    REQUIRE(dynamicCount == composerPacket.commandStream().size());

    for (std::size_t index = 0U; index < dynamicCount; ++index) {
        const CommandRef titleReference =
            titlePacket.commandStream()[firstDynamic + index];
        const CommandRef composerReference = composerPacket.commandStream()[index];
        REQUIRE(titleReference.kind == composerReference.kind);
        const CommandHeader* const titleHeader = commandHeader(
            titlePacket,
            titleReference
        );
        const CommandHeader* const composerHeader = commandHeader(
            composerPacket,
            composerReference
        );
        REQUIRE(titleHeader != nullptr);
        REQUIRE(composerHeader != nullptr);
        REQUIRE(titleHeader->sequence
            == composerHeader->sequence + firstDynamic);
        CommandHeader normalizedTitleHeader = *titleHeader;
        normalizedTitleHeader.sequence = composerHeader->sequence;
        REQUIRE(normalizedTitleHeader == *composerHeader);
    }

    REQUIRE(titlePacket.overlays().size() == composerPacket.overlays().size());
    for (std::size_t index = 0U; index < composerPacket.overlays().size(); ++index) {
        REQUIRE(titlePacket.overlays()[index].operation
            == composerPacket.overlays()[index].operation);
        REQUIRE(titlePacket.overlays()[index].sessionId
            == composerPacket.overlays()[index].sessionId);
    }
    REQUIRE(titlePacket.passes().size() == composerPacket.passes().size());
    for (std::size_t index = 0U; index < composerPacket.passes().size(); ++index) {
        REQUIRE(titlePacket.passes()[index].sessionId
            == composerPacket.passes()[index].sessionId);
        REQUIRE(titlePacket.passes()[index].destinationId
            == composerPacket.passes()[index].destinationId);
    }
}

void testDuplicateDebugIsRejectedInsteadOfComposedTwice() {
    const DebugTextResources text;
    const UiLayoutSnapshot layout = buildLayout();
    DebugState state = buildDebugState(layout, false);
    REQUIRE(state.uiState.overlayCount == 1U);
    state.uiState.overlays[1] = state.uiState.overlays[0];
    state.uiState.overlayCount = 2U;
    const TitleUiControllerSnapshot interaction = idleInteraction();
    const GlobalDebugOverlayInput input{
        state.uiState,
        interaction,
        layout,
        darkThemeMetrics(),
        state.presentations,
        text.view()
    };
    REQUIRE(globalDebugOverlayCapacity(input) == FramePacketCapacity{});
    FramePacket packet(maximumGlobalDebugOverlayCapacity());
    FramePacketBuilder builder(packet, PacketCapacityPolicy::fixedCapacity);
    REQUIRE(builder.begin(FrameMetadata{}, makeTitleViewport(layout)));
    REQUIRE(!addGlobalDebugOverlay(builder, input));
    REQUIRE(builder.nextSequence() == 0U);
    REQUIRE(builder.finish());
}

struct TestCase final {
    std::string_view name;
    void (*run)();
};

} // namespace

int main() {
    const std::array tests{
        TestCase{"no debug zero no-op", testNoDebugIsExactZeroAndBuilderNoOp},
        TestCase{
            "glass exact capacity and order",
            testGlassCapacityOrderSessionsAndPacketValidation
        },
        TestCase{
            "opaque exact capacity",
            testOpaqueCapacityRemovesPassAndUsesPanelTokens
        },
        TestCase{
            "preflight transactional failure",
            testMissingTextAndInvalidDtoFailBeforeMutation
        },
        TestCase{
            "fixed capacity caller rollback",
            testFixedCapacityFailureRollsBackWithCallerTransaction
        },
        TestCase{
            "playable debug composition boundary",
            testPlayableSceneComposesDebugAfterLetterboxAtExactCapacity
        },
        TestCase{
            "playable ultrawide full drawable dim",
            testPlayableUltrawideDimCoversFullDrawableAtEveryDpi
        },
        TestCase{
            "synthetic debug composition boundary",
            testSyntheticSceneComposesDebugBetweenExistingOverlayAndTop
        },
        TestCase{
            "combined scene capacity rollback",
            testCombinedSceneCapacityShortfallRollsBackWholePacket
        },
        TestCase{
            "title debug standalone parity",
            testTitleDebugSliceMatchesStandaloneComposer
        },
        TestCase{
            "duplicate debug rejected",
            testDuplicateDebugIsRejectedInsteadOfComposedTwice
        }
    };

    std::size_t passed = 0U;
    for (const TestCase& test : tests) {
        try {
            test.run();
            ++passed;
            std::cout << "[PASS] " << test.name << '\n';
        } catch (const std::exception& error) {
            std::cerr << "[FAIL] " << test.name << ": " << error.what() << '\n';
            return 1;
        }
    }
    std::cout << passed << '/' << tests.size() << " tests passed\n";
    return 0;
}
