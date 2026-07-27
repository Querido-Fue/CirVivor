#include "render/common/frame_packet_codec.h"
#include "render/frontend/frame_packet_builder.h"
#include "render/frontend/synthetic_test_scene.h"
#include "render/gles/gles_ui_placeholder.h"

#include <array>
#include <cstddef>
#include <exception>
#include <iostream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace {

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

#define REQUIRE(expression) require((expression), #expression, __FILE__, __LINE__)

[[nodiscard]] cirvivor::render::UiCommand makeUiCommand() noexcept {
    using namespace cirvivor::render;

    UiCommand command;
    command.header.layer = RenderLayer::ui;
    command.header.coordinateSpace = CoordinateSpace::logicalUi;
    command.bounds = {180.0F, 120.0F, 420.0F, 64.0F};
    command.cornerRadius = 12.0F;
    command.borderWidth = 2.0F;
    return command;
}

[[nodiscard]] cirvivor::render::FramePacket buildPacket(
    const cirvivor::render::UiCommand command
) {
    using namespace cirvivor::render;
    using namespace cirvivor::render::frontend;

    FramePacketCapacity capacity;
    capacity.commandCount = 1U;
    capacity.uiCount = 1U;
    FramePacket packet(capacity);
    FramePacketBuilder builder(packet, PacketCapacityPolicy::fixedCapacity);
    REQUIRE(builder.begin({}, makeSyntheticViewport({})));
    REQUIRE(builder.addUi(command));
    REQUIRE(builder.finish());
    REQUIRE(packet.isStructurallyValid());
    REQUIRE(packet.isRenderOrderValid());
    return packet;
}

void requireBalancedStats(const cirvivor::render::gles::GlesRenderStats& stats) {
    REQUIRE(
        stats.submittedCommands
        == stats.renderedCommands + stats.skippedCommands + stats.noOpCommands
    );
}

void testTransparentUiRoundTripRemainsNoOp() {
    using namespace cirvivor::render;
    using namespace cirvivor::render::gles;
    using namespace cirvivor::render::gles::detail;

    const FramePacket packet = buildPacket(makeUiCommand());
    REQUIRE(packet.ui().size() == 1U);
    const UiPlaceholderPaint sourcePaint = selectUiPlaceholderPaint(packet.ui().front());
    REQUIRE(!sourcePaint.shouldDraw);
    REQUIRE(sourcePaint.color == PremultipliedRgba::transparent());

    std::vector<std::byte> encoded;
    REQUIRE(serializeFramePacket(packet, encoded));
    FramePacket decoded;
    REQUIRE(static_cast<bool>(deserializeFramePacket(encoded, decoded)));
    REQUIRE(decoded.ui().size() == 1U);
    REQUIRE(decoded.ui().front().backgroundColor == PremultipliedRgba::transparent());
    REQUIRE(decoded.ui().front().borderColor == PremultipliedRgba::transparent());
    REQUIRE(decoded.ui().front().accentColor == PremultipliedRgba::transparent());
    REQUIRE(!selectUiPlaceholderPaint(decoded.ui().front()).shouldDraw);

    GlesRenderStats stats;
    stats.submittedCommands = 1U;
    bool drawCalled = false;
    dispatchUiPlaceholder(
        decoded.ui().front(),
        stats,
        [&drawCalled](const PremultipliedRgba) noexcept {
            drawCalled = true;
            return GeometryOutcome::drawn;
        }
    );
    REQUIRE(!drawCalled);
    REQUIRE(stats.noOpCommands == 1U);
    REQUIRE(stats.renderedCommands == 0U);
    REQUIRE(stats.skippedCommands == 0U);
    REQUIRE(stats.placeholderCommands == 0U);
    REQUIRE(stats.supportedShapeCommands == 0U);
    requireBalancedStats(stats);
}

void testVisibleUiPaintPriorityPreservesPmaColor() {
    using namespace cirvivor::render;
    using namespace cirvivor::render::gles::detail;

    UiCommand command = makeUiCommand();
    const PremultipliedRgba border = PremultipliedRgba::fromStraight(
        0.8F,
        0.4F,
        0.2F,
        0.25F
    );
    const PremultipliedRgba accent = PremultipliedRgba::fromStraight(
        0.2F,
        0.6F,
        1.0F,
        0.5F
    );
    const PremultipliedRgba background = PremultipliedRgba::fromStraight(
        0.1F,
        0.2F,
        0.3F,
        0.75F
    );

    command.borderColor = border;
    UiPlaceholderPaint paint = selectUiPlaceholderPaint(buildPacket(command).ui().front());
    REQUIRE(paint.shouldDraw);
    REQUIRE(paint.color == border);

    command.accentColor = accent;
    paint = selectUiPlaceholderPaint(buildPacket(command).ui().front());
    REQUIRE(paint.shouldDraw);
    REQUIRE(paint.color == accent);

    command.backgroundColor = background;
    paint = selectUiPlaceholderPaint(buildPacket(command).ui().front());
    REQUIRE(paint.shouldDraw);
    REQUIRE(paint.color == background);
    REQUIRE(paint.color.red == background.red);
    REQUIRE(paint.color.green == background.green);
    REQUIRE(paint.color.blue == background.blue);
    REQUIRE(paint.color.alpha == background.alpha);
}

void testVisibleUiDispatchRecordsRenderedPlaceholder() {
    using namespace cirvivor::render;
    using namespace cirvivor::render::gles;
    using namespace cirvivor::render::gles::detail;

    UiCommand command = makeUiCommand();
    command.backgroundColor = PremultipliedRgba::fromStraight(
        0.2F,
        0.6F,
        1.0F,
        0.5F
    );
    const FramePacket packet = buildPacket(command);
    GlesRenderStats stats;
    stats.submittedCommands = 1U;
    PremultipliedRgba received = PremultipliedRgba::transparent();
    dispatchUiPlaceholder(
        packet.ui().front(),
        stats,
        [&received](const PremultipliedRgba color) noexcept {
            received = color;
            return GeometryOutcome::drawn;
        }
    );

    REQUIRE(received == command.backgroundColor);
    REQUIRE(stats.renderedCommands == 1U);
    REQUIRE(stats.skippedCommands == 0U);
    REQUIRE(stats.noOpCommands == 0U);
    REQUIRE(stats.placeholderCommands == 1U);
    REQUIRE(stats.supportedShapeCommands == 0U);
    requireBalancedStats(stats);
}

void testVisibleUiDispatchRecordsSkippedPlaceholder() {
    using namespace cirvivor::render;
    using namespace cirvivor::render::gles;
    using namespace cirvivor::render::gles::detail;

    UiCommand command = makeUiCommand();
    command.borderColor = PremultipliedRgba::fromStraight(
        1.0F,
        0.5F,
        0.1F,
        0.4F
    );
    const FramePacket packet = buildPacket(command);
    GlesRenderStats stats;
    stats.submittedCommands = 1U;
    dispatchUiPlaceholder(
        packet.ui().front(),
        stats,
        [](const PremultipliedRgba) noexcept {
            return GeometryOutcome::skipped;
        }
    );

    REQUIRE(stats.renderedCommands == 0U);
    REQUIRE(stats.skippedCommands == 1U);
    REQUIRE(stats.noOpCommands == 0U);
    REQUIRE(stats.placeholderCommands == 1U);
    REQUIRE(stats.supportedShapeCommands == 0U);
    requireBalancedStats(stats);
}

struct TestCase final {
    std::string_view name;
    void (*run)();
};

} // namespace

int main() {
    const std::array tests{
        TestCase{"transparent UI is a round-trip no-op", testTransparentUiRoundTripRemainsNoOp},
        TestCase{"visible UI preserves PMA paint priority", testVisibleUiPaintPriorityPreservesPmaColor},
        TestCase{"visible UI records rendered placeholder", testVisibleUiDispatchRecordsRenderedPlaceholder},
        TestCase{"visible UI records skipped placeholder", testVisibleUiDispatchRecordsSkippedPlaceholder}
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
