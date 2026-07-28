#include "render/frontend/debug_telemetry_hud.h"

#include "render/text/title_text_catalog.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
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

using cirvivor::debug::DebugPerformanceSection;
using cirvivor::debug::DebugPerformanceSectionSnapshot;
using cirvivor::render::BlendMode;
using cirvivor::render::CommandHeader;
using cirvivor::render::CommandKind;
using cirvivor::render::CommandRef;
using cirvivor::render::CoordinateSpace;
using cirvivor::render::FrameMetadata;
using cirvivor::render::FramePacket;
using cirvivor::render::FramePacketCapacity;
using cirvivor::render::GlyphInstance;
using cirvivor::render::PremultipliedRgba;
using cirvivor::render::RenderLayer;
using cirvivor::render::ShapeCommand;
using cirvivor::render::ShapeType;
using cirvivor::render::UiTextLocale;
using cirvivor::render::UiTextSemanticId;
using cirvivor::render::ViewportState;
using cirvivor::render::frontend::DebugHitboxCircle;
using cirvivor::render::frontend::DebugPoolKind;
using cirvivor::render::frontend::DebugPoolUsage;
using cirvivor::render::frontend::DebugTelemetryHudInput;
using cirvivor::render::frontend::FrameBuildError;
using cirvivor::render::frontend::FramePacketBuilder;
using cirvivor::render::frontend::PacketCapacityPolicy;
using cirvivor::render::frontend::addDebugPoolHud;
using cirvivor::render::frontend::addDebugTopHud;
using cirvivor::render::frontend::debugPoolHudCapacity;
using cirvivor::render::frontend::debugTelemetryHudInputIsValid;
using cirvivor::render::frontend::debugTopHudCapacity;
using cirvivor::render::frontend::debug_frame_hud_layer_order;
using cirvivor::render::frontend::debug_hitbox_layer_order;
using cirvivor::render::frontend::debug_pool_hud_layer_order;
using cirvivor::render::frontend::maximumDebugPoolHudCapacity;
using cirvivor::render::frontend::maximumDebugTopHudCapacity;

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
    const float actual,
    const float expected,
    const float tolerance,
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

class AllocationScope final {
public:
    AllocationScope() noexcept : start_(allocation_probe::count) {
        allocation_probe::enabled = true;
    }

    AllocationScope(const AllocationScope&) = delete;
    AllocationScope& operator=(const AllocationScope&) = delete;

    ~AllocationScope() {
        allocation_probe::enabled = false;
    }

    [[nodiscard]] std::size_t count() const noexcept {
        return allocation_probe::count - start_;
    }

private:
    std::size_t start_ = 0U;
};

constexpr std::array telemetry_semantics{
    UiTextSemanticId::debugProfilerHeader,
    UiTextSemanticId::debugProfilerFrameCpu,
    UiTextSemanticId::debugProfilerUpdateBuild,
    UiTextSemanticId::debugProfilerFixedUpdate,
    UiTextSemanticId::debugProfilerSceneBuild,
    UiTextSemanticId::debugProfilerRenderCall,
    UiTextSemanticId::debugPoolPhysicsBodies,
    UiTextSemanticId::debugPoolFrameCommands,
    UiTextSemanticId::debugPoolGlyphAtlas,
    UiTextSemanticId::debugTelemetryDigit0,
    UiTextSemanticId::debugTelemetryDigit1,
    UiTextSemanticId::debugTelemetryDigit2,
    UiTextSemanticId::debugTelemetryDigit3,
    UiTextSemanticId::debugTelemetryDigit4,
    UiTextSemanticId::debugTelemetryDigit5,
    UiTextSemanticId::debugTelemetryDigit6,
    UiTextSemanticId::debugTelemetryDigit7,
    UiTextSemanticId::debugTelemetryDigit8,
    UiTextSemanticId::debugTelemetryDigit9,
    UiTextSemanticId::debugTelemetryDecimalPoint,
    UiTextSemanticId::debugTelemetrySlash,
    UiTextSemanticId::debugTelemetryDash
};

struct TelemetryTextResources final {
    static constexpr std::uint64_t generation = 83U;
    static constexpr cirvivor::render::ResourceId font_id =
        cirvivor::render::stableResourceId("test/debug-telemetry-font");
    static constexpr cirvivor::render::ResourceId atlas_id =
        cirvivor::render::stableResourceId("test/debug-telemetry-atlas");

    std::array<std::uint8_t, 1U> pixels{255U};
    std::array<GlyphInstance, telemetry_semantics.size()> glyphs{};
    std::array<
        cirvivor::render::PreShapedTextRunView,
        telemetry_semantics.size()
    > runs{};
    std::array<cirvivor::render::Alpha8TextureResourceView, 1U> resources{};

    TelemetryTextResources() noexcept {
        for (std::size_t index = 0U; index < telemetry_semantics.size(); ++index) {
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
                    telemetry_semantics[index],
                    UiTextLocale::korean
                ),
                font_id,
                atlas_id,
                64U,
                32.0F,
                48.0F,
                16.0F,
                std::span<const GlyphInstance>(&glyphs[index], 1U)
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
        const std::size_t count = telemetry_semantics.size()
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

    [[nodiscard]] static std::uint32_t glyphId(
        const UiTextSemanticId semantic
    ) noexcept {
        for (std::size_t index = 0U; index < telemetry_semantics.size(); ++index) {
            if (telemetry_semantics[index] == semantic) {
                return static_cast<std::uint32_t>(index + 1U);
            }
        }
        return 0U;
    }
};

[[nodiscard]] ViewportState validViewport() noexcept {
    ViewportState viewport{};
    viewport.physical.displaySize = {1'280, 720};
    viewport.physical.windowBounds = {0, 0, 1'280, 720};
    viewport.physical.dpiScale = 1.0F;
    viewport.drawable.size = {1'280, 720};
    viewport.drawable.contentRect = {0, 0, 1'280, 720};
    viewport.drawable.worldRenderTargetSize = {1'280, 720};
    viewport.drawable.worldRenderScale = 1.0F;
    viewport.logicalUi.size = {1'280.0F, 720.0F};
    viewport.logicalUi.contentRect = {0.0F, 0.0F, 1'280.0F, 720.0F};
    viewport.logicalUi.drawablePixelsPerLogicalUnitX = 1.0F;
    viewport.logicalUi.drawablePixelsPerLogicalUnitY = 1.0F;
    viewport.logicalUi.uiScale = 1.0F;
    viewport.world.visibleBounds = {0.0F, 0.0F, 64.0F, 36.0F};
    viewport.world.drawablePixelsPerWorldUnit = 20.0F;
    viewport.world.projectionRevision = 1U;
    return viewport;
}

void setSection(
    DebugTelemetryHudInput& input,
    const DebugPerformanceSection section,
    const double average,
    const double last,
    const double maximum,
    const std::size_t sampleCount = 4U
) noexcept {
    input.performance.sections[static_cast<std::size_t>(section)] = {
        sampleCount,
        average,
        last,
        maximum,
        true
    };
}

[[nodiscard]] DebugTelemetryHudInput completeInput(
    const TelemetryTextResources& text
) noexcept {
    DebugTelemetryHudInput input{};
    input.showFrameTime = true;
    input.showPoolInfo = true;
    input.showHitboxes = true;
    input.performance.enabled = true;
    setSection(input, DebugPerformanceSection::frameCpu, 4.0, 5.0, 6.0);
    setSection(input, DebugPerformanceSection::updateBuild, 0.005, 0.004, 0.006);
    setSection(input, DebugPerformanceSection::fixedUpdate, 1.5, 1.25, 2.0);
    setSection(input, DebugPerformanceSection::sceneBuild, 3.0, 3.5, 4.0);
    setSection(input, DebugPerformanceSection::renderCall, 2.0, 2.5, 3.0);
    input.pools[0] = {DebugPoolKind::physicsBodies, 2U, 2U, 2U};
    input.pools[1] = {DebugPoolKind::frameCommands, 27U, 512U, 1'024U};
    input.pools[2] = {DebugPoolKind::glyphAtlas, 80U, 100U, 2'048U};
    input.poolCount = 3U;
    input.hitboxes[0] = {
        {45.0F, 15.0F},
        0.5F,
        0.08F,
        PremultipliedRgba::fromStraight(1.0F, 0.38F, 0.38F, 0.95F)
    };
    input.hitboxes[1] = {
        {51.0F, 27.0F},
        0.5F,
        0.08F,
        PremultipliedRgba::fromStraight(0.25F, 0.94F, 1.0F, 0.95F)
    };
    input.hitboxCount = 2U;
    input.textResources = text.view();
    input.locale = UiTextLocale::korean;
    return input;
}

[[nodiscard]] const CommandHeader* commandHeader(
    const FramePacket& packet,
    const CommandRef reference
) noexcept {
    const std::size_t index = reference.index;
    switch (reference.kind) {
    case CommandKind::sprite:
        return index < packet.sprites().size()
            ? &packet.sprites()[index].header
            : nullptr;
    case CommandKind::shape:
        return index < packet.shapes().size()
            ? &packet.shapes()[index].header
            : nullptr;
    case CommandKind::line:
        return index < packet.lines().size()
            ? &packet.lines()[index].header
            : nullptr;
    case CommandKind::text:
        return index < packet.textRuns().size()
            ? &packet.textRuns()[index].header
            : nullptr;
    case CommandKind::effect:
        return index < packet.effects().size()
            ? &packet.effects()[index].header
            : nullptr;
    case CommandKind::ui:
        return index < packet.ui().size() ? &packet.ui()[index].header : nullptr;
    case CommandKind::overlay:
        return index < packet.overlays().size()
            ? &packet.overlays()[index].header
            : nullptr;
    case CommandKind::glyphRun:
        return index < packet.glyphRuns().size()
            ? &packet.glyphRuns()[index].header
            : nullptr;
    case CommandKind::texturedMesh:
        return index < packet.texturedMeshes().size()
            ? &packet.texturedMeshes()[index].header
            : nullptr;
    case CommandKind::gradient:
        return index < packet.gradients().size()
            ? &packet.gradients()[index].header
            : nullptr;
    case CommandKind::clip:
        return index < packet.clips().size()
            ? &packet.clips()[index].header
            : nullptr;
    case CommandKind::pass:
        return index < packet.passes().size()
            ? &packet.passes()[index].header
            : nullptr;
    }
    return nullptr;
}

[[nodiscard]] bool capacityContains(
    const FramePacketCapacity& outer,
    const FramePacketCapacity& inner
) noexcept {
    return inner.commandCount <= outer.commandCount
        && inner.shapeCount <= outer.shapeCount
        && inner.uiCount <= outer.uiCount
        && inner.glyphRunCount <= outer.glyphRunCount
        && inner.glyphInstanceCount <= outer.glyphInstanceCount;
}

void testAllFlagsOffIsValidZeroNoOpWithoutText() {
    const DebugTelemetryHudInput input{};
    REQUIRE(debugTelemetryHudInputIsValid(input));
    REQUIRE(debugPoolHudCapacity(input) == FramePacketCapacity{});
    REQUIRE(debugTopHudCapacity(input) == FramePacketCapacity{});

    FramePacket packet;
    FramePacketBuilder builder(packet, PacketCapacityPolicy::fixedCapacity);
    REQUIRE(builder.begin(FrameMetadata{}, validViewport()));
    REQUIRE(addDebugPoolHud(builder, input));
    REQUIRE(addDebugTopHud(builder, input));
    REQUIRE(builder.nextSequence() == 0U);
    REQUIRE(builder.finish());
    REQUIRE(packet.size() == FramePacketCapacity{});
}

void testHitboxesOnlyDoesNotRequireTextResources() {
    DebugTelemetryHudInput input{};
    input.showHitboxes = true;
    input.hitboxes[0] = {
        {8.0F, 4.0F},
        0.5F,
        0.08F,
        PremultipliedRgba::fromStraight(0.25F, 0.94F, 1.0F, 0.95F)
    };
    input.hitboxCount = 1U;
    REQUIRE(debugTelemetryHudInputIsValid(input));
    FramePacketCapacity expected{};
    expected.commandCount = 1U;
    expected.shapeCount = 1U;
    REQUIRE(debugTopHudCapacity(input) == expected);

    FramePacket packet(expected);
    FramePacketBuilder builder(packet, PacketCapacityPolicy::fixedCapacity);
    REQUIRE(builder.begin(FrameMetadata{}, validViewport()));
    REQUIRE(addDebugTopHud(builder, input));
    REQUIRE(builder.finish());
    REQUIRE(packet.size() == expected);
    REQUIRE(packet.shapes()[0].header.coordinateSpace == CoordinateSpace::world);
    REQUIRE(packet.isRenderOrderValid());
}

void testPoolExactCapacityAndNumericAssembly() {
    const TelemetryTextResources text;
    DebugTelemetryHudInput input = completeInput(text);
    input.showFrameTime = false;
    input.showHitboxes = false;
    const FramePacketCapacity exact = debugPoolHudCapacity(input);
    FramePacketCapacity expected{};
    expected.commandCount = 7U;
    expected.uiCount = 1U;
    expected.glyphRunCount = 6U;
    expected.glyphInstanceCount = 30U;
    REQUIRE(exact == expected);
    REQUIRE(capacityContains(maximumDebugPoolHudCapacity(), exact));

    FramePacket packet(exact);
    FramePacketBuilder builder(packet, PacketCapacityPolicy::fixedCapacity);
    REQUIRE(builder.begin(FrameMetadata{}, validViewport()));
    REQUIRE(addDebugPoolHud(builder, input));
    REQUIRE(builder.finish());
    REQUIRE(packet.size() == exact);
    REQUIRE(packet.ui().size() == 1U);
    REQUIRE(packet.ui()[0].header.layer == RenderLayer::ui);
    REQUIRE(packet.ui()[0].header.layerOrder == debug_pool_hud_layer_order);
    REQUIRE_NEAR(packet.ui()[0].backgroundColor.alpha, 0.70F, 1.0e-6F);
    REQUIRE(packet.glyphRuns().size() == 6U);
    for (const auto& run : packet.glyphRuns()) {
        REQUIRE(run.header.layer == RenderLayer::ui);
        REQUIRE(run.header.coordinateSpace == CoordinateSpace::logicalUi);
        REQUIRE(run.header.layerOrder == debug_pool_hud_layer_order);
    }

    const auto& firstToken = packet.glyphRuns()[1];
    REQUIRE(firstToken.glyphs.count == 5U);
    const auto tokenGlyphs = packet.glyphInstances().subspan(
        firstToken.glyphs.offset,
        firstToken.glyphs.count
    );
    REQUIRE(tokenGlyphs[0].glyphIndex == TelemetryTextResources::glyphId(
        UiTextSemanticId::debugTelemetryDigit2
    ));
    REQUIRE(tokenGlyphs[1].glyphIndex == TelemetryTextResources::glyphId(
        UiTextSemanticId::debugTelemetrySlash
    ));
    REQUIRE(tokenGlyphs[1].position.x > tokenGlyphs[0].position.x);
    REQUIRE(packet.isStructurallyValid());
    REQUIRE(packet.isRenderOrderValid());
}

void testTopExactCapacitySortsRowsAndDrawsHitboxesFirst() {
    const TelemetryTextResources text;
    DebugTelemetryHudInput input = completeInput(text);
    input.showPoolInfo = false;
    const FramePacketCapacity exact = debugTopHudCapacity(input);
    FramePacketCapacity expected{};
    expected.commandCount = 12U;
    expected.shapeCount = 2U;
    expected.uiCount = 1U;
    expected.glyphRunCount = 9U;
    expected.glyphInstanceCount = 61U;
    REQUIRE(exact == expected);
    REQUIRE(capacityContains(maximumDebugTopHudCapacity(), exact));

    FramePacket packet(exact);
    FramePacketBuilder builder(packet, PacketCapacityPolicy::fixedCapacity);
    REQUIRE(builder.begin(FrameMetadata{}, validViewport()));
    REQUIRE(addDebugTopHud(builder, input));
    REQUIRE(builder.finish());
    REQUIRE(packet.size() == exact);
    REQUIRE(packet.commandStream().size() == 12U);
    for (std::size_t index = 0U; index < 2U; ++index) {
        REQUIRE(packet.commandStream()[index].kind == CommandKind::shape);
        const ShapeCommand& circle = packet.shapes()[index];
        REQUIRE(circle.shape == ShapeType::circle);
        REQUIRE(circle.fillEnabled == 0U);
        REQUIRE(circle.strokeEnabled == 1U);
        REQUIRE(circle.header.layer == RenderLayer::top);
        REQUIRE(circle.header.coordinateSpace == CoordinateSpace::world);
        REQUIRE(circle.header.layerOrder == debug_hitbox_layer_order);
    }
    REQUIRE_NEAR(packet.shapes()[0].bounds.x, 44.5F, 1.0e-6F);
    REQUIRE_NEAR(packet.shapes()[0].bounds.y, 14.5F, 1.0e-6F);
    REQUIRE_NEAR(packet.shapes()[0].bounds.width, 1.0F, 1.0e-6F);

    REQUIRE(packet.commandStream()[2].kind == CommandKind::ui);
    REQUIRE(packet.ui()[0].header.layer == RenderLayer::top);
    REQUIRE(packet.ui()[0].header.layerOrder == debug_frame_hud_layer_order);
    REQUIRE_NEAR(packet.ui()[0].backgroundColor.alpha, 0.78F, 1.0e-6F);
    for (std::size_t index = 2U; index < packet.commandStream().size(); ++index) {
        const CommandHeader* const header = commandHeader(
            packet,
            packet.commandStream()[index]
        );
        REQUIRE(header != nullptr);
        REQUIRE(header->layer == RenderLayer::top);
        REQUIRE(header->layerOrder == debug_frame_hud_layer_order);
    }

    REQUIRE(packet.glyphRuns().size() == 9U);
    REQUIRE(packet.glyphInstances()[packet.glyphRuns()[1].glyphs.offset].glyphIndex
        == TelemetryTextResources::glyphId(
            UiTextSemanticId::debugProfilerFrameCpu
        ));
    REQUIRE(packet.glyphInstances()[packet.glyphRuns()[3].glyphs.offset].glyphIndex
        == TelemetryTextResources::glyphId(
            UiTextSemanticId::debugProfilerSceneBuild
        ));
    REQUIRE(packet.glyphInstances()[packet.glyphRuns()[5].glyphs.offset].glyphIndex
        == TelemetryTextResources::glyphId(
            UiTextSemanticId::debugProfilerRenderCall
        ));
    REQUIRE(packet.glyphInstances()[packet.glyphRuns()[7].glyphs.offset].glyphIndex
        == TelemetryTextResources::glyphId(
            UiTextSemanticId::debugProfilerFixedUpdate
        ));
    REQUIRE(packet.glyphRuns()[2].glyphs.count == 14U);
    REQUIRE(packet.isStructurallyValid());
    REQUIRE(packet.isRenderOrderValid());
}

void testInvalidDtoAndViewportFailBeforeMutation() {
    const TelemetryTextResources text;
    DebugTelemetryHudInput invalid = completeInput(text);
    invalid.showFrameTime = false;
    invalid.showPoolInfo = false;
    invalid.hitboxes[0].radius = 0.0F;
    REQUIRE(!debugTelemetryHudInputIsValid(invalid));
    REQUIRE(debugTopHudCapacity(invalid) == FramePacketCapacity{});

    FramePacketCapacity storage = maximumDebugTopHudCapacity();
    ++storage.commandCount;
    ++storage.shapeCount;
    FramePacket packet(storage);
    FramePacketBuilder builder(packet, PacketCapacityPolicy::fixedCapacity);
    REQUIRE(builder.begin(FrameMetadata{}, validViewport()));
    ShapeCommand marker{};
    marker.header = {
        RenderLayer::background,
        CoordinateSpace::world,
        BlendMode::premultipliedAlpha,
        0U,
        0,
        0U
    };
    marker.bounds = {0.0F, 0.0F, 1.0F, 1.0F};
    REQUIRE(builder.addShape(marker));
    const FramePacketCapacity before = packet.size();
    REQUIRE(!addDebugTopHud(builder, invalid));
    REQUIRE(builder.error() == FrameBuildError::none);
    REQUIRE(packet.size() == before);
    REQUIRE(builder.finish());

    DebugTelemetryHudInput missingText = completeInput(text);
    missingText.textResources = text.view(telemetry_semantics.size() - 1U);
    REQUIRE(!debugTelemetryHudInputIsValid(missingText));

    DebugTelemetryHudInput duplicatePool = completeInput(text);
    duplicatePool.pools[1].kind = DebugPoolKind::physicsBodies;
    REQUIRE(!debugTelemetryHudInputIsValid(duplicatePool));

    DebugTelemetryHudInput valid = completeInput(text);
    valid.showPoolInfo = false;
    valid.showHitboxes = false;
    ViewportState invalidViewport = validViewport();
    invalidViewport.logicalUi.contentRect.width = 0.0F;
    FramePacket viewportPacket(debugTopHudCapacity(valid));
    FramePacketBuilder viewportBuilder(
        viewportPacket,
        PacketCapacityPolicy::fixedCapacity
    );
    REQUIRE(viewportBuilder.begin(FrameMetadata{}, invalidViewport));
    REQUIRE(!addDebugTopHud(viewportBuilder, valid));
    REQUIRE(viewportBuilder.error() == FrameBuildError::none);
    REQUIRE(viewportBuilder.nextSequence() == 0U);
    viewportBuilder.abort();
    REQUIRE(viewportPacket.size() == FramePacketCapacity{});
}

void testFixedCapacityOneGlyphShortFailsAndCallerCanAbort() {
    const TelemetryTextResources text;
    DebugTelemetryHudInput input = completeInput(text);
    input.showPoolInfo = false;
    FramePacketCapacity insufficient = debugTopHudCapacity(input);
    REQUIRE(insufficient.glyphInstanceCount > 0U);
    --insufficient.glyphInstanceCount;

    FramePacket packet(insufficient);
    FramePacketBuilder builder(packet, PacketCapacityPolicy::fixedCapacity);
    REQUIRE(builder.begin(FrameMetadata{}, validViewport()));
    REQUIRE(!addDebugTopHud(builder, input));
    REQUIRE(builder.error() == FrameBuildError::capacityExceeded);
    REQUIRE(packet.size() != FramePacketCapacity{});
    builder.abort();
    REQUIRE(packet.size() == FramePacketCapacity{});
}

void testCombinedFixedBuildDoesNotAllocate() {
    const TelemetryTextResources text;
    const DebugTelemetryHudInput input = completeInput(text);
    const FramePacketCapacity exact = cirvivor::render::additiveFramePacketCapacity(
        debugPoolHudCapacity(input),
        debugTopHudCapacity(input)
    );
    FramePacket packet(exact);
    std::size_t allocations = 0U;
    {
        AllocationScope scope;
        FramePacketBuilder builder(packet, PacketCapacityPolicy::fixedCapacity);
        REQUIRE(builder.begin(FrameMetadata{}, validViewport()));
        REQUIRE(addDebugPoolHud(builder, input));
        REQUIRE(addDebugTopHud(builder, input));
        REQUIRE(builder.finish());
        allocations = scope.count();
    }
    REQUIRE(allocations == 0U);
    REQUIRE(packet.size() == exact);
    REQUIRE(packet.isRenderOrderValid());
}

struct TestCase final {
    std::string_view name;
    void (*run)();
};

} // namespace

int main() {
    const std::array tests{
        TestCase{"all flags off valid no-op", testAllFlagsOffIsValidZeroNoOpWithoutText},
        TestCase{"hitboxes only without text", testHitboxesOnlyDoesNotRequireTextResources},
        TestCase{"pool exact capacity", testPoolExactCapacityAndNumericAssembly},
        TestCase{"top exact order and sorting", testTopExactCapacitySortsRowsAndDrawsHitboxesFirst},
        TestCase{"invalid preflight", testInvalidDtoAndViewportFailBeforeMutation},
        TestCase{"fixed capacity one short", testFixedCapacityOneGlyphShortFailsAndCallerCanAbort},
        TestCase{"combined zero allocation", testCombinedFixedBuildDoesNotAllocate}
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
