#include "render/common/frame_packet_codec.h"
#include "render/frontend/frame_packet_builder.h"
#include "render/frontend/synthetic_test_scene.h"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <string_view>
#include <type_traits>
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

[[nodiscard]] std::uint64_t fnv1a64(const std::vector<std::byte>& bytes) noexcept {
    std::uint64_t value = 0xcbf2'9ce4'8422'2325ULL;
    for (const std::byte byte : bytes) {
        value ^= std::to_integer<std::uint8_t>(byte);
        value *= 0x0000'0100'0000'01b3ULL;
    }
    return value;
}

[[nodiscard]] cirvivor::render::Vec2F transformPoint(
    const cirvivor::render::Mat3F& matrix,
    const cirvivor::render::Vec2F point
) noexcept {
    return {
        matrix.elements[0] * point.x + matrix.elements[1] * point.y
            + matrix.elements[2],
        matrix.elements[3] * point.x + matrix.elements[4] * point.y
            + matrix.elements[5]
    };
}

void testSyntheticPacketCanonicalRoundTrip() {
    using namespace cirvivor::render;
    using namespace cirvivor::render::frontend;

    constexpr FramePacketCapacity expectedSize{
        25,
        6,
        2,
        2,
        5,
        4,
        2,
        4,
        85
    };
    FramePacket packet(syntheticTestSceneCapacity());
    const SyntheticSceneResult build = buildSyntheticTestScene(
        packet,
        {},
        PacketCapacityPolicy::fixedCapacity
    );
    REQUIRE(build.success);
    REQUIRE(build.error == FrameBuildError::none);
    REQUIRE(packet.size() == expectedSize);
    REQUIRE(packet.isStructurallyValid());
    REQUIRE(packet.isRenderOrderValid());

    std::array<bool, 7> commandKinds{};
    for (const CommandRef reference : packet.commandStream()) {
        const auto index = static_cast<std::size_t>(reference.kind);
        REQUIRE(index < commandKinds.size());
        commandKinds[index] = true;
    }
    for (const bool present : commandKinds) {
        REQUIRE(present);
    }
    for (const TextCommand& textRun : packet.textRuns()) {
        REQUIRE(!packet.text(textRun.utf8).empty());
    }

    std::vector<std::byte> encoded;
    REQUIRE(serializeFramePacket(packet, encoded));
    REQUIRE(encoded.size() == 2'862U);
    REQUIRE(fnv1a64(encoded) == 0xbe64'e77f'c11f'c188ULL);

    FramePacket decoded;
    const FramePacketDecodeResult decode = deserializeFramePacket(encoded, decoded);
    REQUIRE(static_cast<bool>(decode));
    REQUIRE(decoded.isStructurallyValid());
    REQUIRE(decoded.isRenderOrderValid());

    std::vector<std::byte> reencoded;
    REQUIRE(serializeFramePacket(decoded, reencoded));
    REQUIRE(reencoded == encoded);
}

void testFixedCapacityReuseAndOrderingGuard() {
    using namespace cirvivor::render;
    using namespace cirvivor::render::frontend;

    FramePacket packet(syntheticTestSceneCapacity());
    REQUIRE(buildSyntheticTestScene(
        packet,
        {},
        PacketCapacityPolicy::fixedCapacity
    ).success);
    const FramePacketCapacity capacity = packet.capacity();
    std::vector<std::byte> first;
    REQUIRE(serializeFramePacket(packet, first));

    REQUIRE(buildSyntheticTestScene(
        packet,
        {},
        PacketCapacityPolicy::fixedCapacity
    ).success);
    REQUIRE(packet.capacity() == capacity);
    std::vector<std::byte> second;
    REQUIRE(serializeFramePacket(packet, second));
    REQUIRE(second == first);

    FramePacket empty;
    const SyntheticSceneResult capacityFailure = buildSyntheticTestScene(
        empty,
        {},
        PacketCapacityPolicy::fixedCapacity
    );
    REQUIRE(!capacityFailure.success);
    REQUIRE(capacityFailure.error == FrameBuildError::capacityExceeded);

    FramePacket ordered({2, 0, 2, 0, 0, 0, 0, 0, 0});
    FramePacketBuilder builder(ordered, PacketCapacityPolicy::fixedCapacity);
    REQUIRE(builder.begin({}, makeSyntheticViewport({})));
    ShapeCommand top;
    top.header.layer = RenderLayer::top;
    REQUIRE(builder.addShape(top));
    ShapeCommand background;
    background.header.layer = RenderLayer::background;
    REQUIRE(!builder.addShape(background));
    REQUIRE(builder.error() == FrameBuildError::renderOrderRegression);
    builder.abort();
}

void testMalformedDecodeDoesNotMutateDestination() {
    using namespace cirvivor::render;
    using namespace cirvivor::render::frontend;

    FramePacket source(syntheticTestSceneCapacity());
    REQUIRE(buildSyntheticTestScene(
        source,
        {},
        PacketCapacityPolicy::fixedCapacity
    ).success);
    std::vector<std::byte> encoded;
    REQUIRE(serializeFramePacket(source, encoded));

    FramePacket destination;
    REQUIRE(static_cast<bool>(deserializeFramePacket(encoded, destination)));
    std::vector<std::byte> destinationBefore;
    REQUIRE(serializeFramePacket(destination, destinationBefore));

    std::vector<std::byte> truncated = encoded;
    truncated.pop_back();
    const FramePacketDecodeResult truncatedResult = deserializeFramePacket(
        truncated,
        destination
    );
    REQUIRE(truncatedResult.error == FramePacketDecodeError::truncated);

    FramePacketDecodeLimits restrictiveLimits;
    restrictiveLimits.maximumCommandCount = 24;
    const FramePacketDecodeResult limitResult = deserializeFramePacket(
        encoded,
        destination,
        restrictiveLimits
    );
    REQUIRE(limitResult.error == FramePacketDecodeError::sizeLimitExceeded);

    std::vector<std::byte> withTrailingByte = encoded;
    withTrailingByte.push_back(std::byte{0});
    const FramePacketDecodeResult trailingResult = deserializeFramePacket(
        withTrailingByte,
        destination
    );
    REQUIRE(trailingResult.error == FramePacketDecodeError::trailingBytes);

    std::vector<std::byte> destinationAfter;
    REQUIRE(serializeFramePacket(destination, destinationAfter));
    REQUIRE(destinationAfter == destinationBefore);
}

void testPremultipliedAlphaAndViewportInverse() {
    using namespace cirvivor::render;
    using namespace cirvivor::render::frontend;

    const PremultipliedRgba color = PremultipliedRgba::fromStraight(
        0.8F,
        0.4F,
        0.2F,
        0.5F
    );
    REQUIRE_NEAR(color.red, 0.4F, 1.0e-6F);
    REQUIRE_NEAR(color.green, 0.2F, 1.0e-6F);
    REQUIRE_NEAR(color.blue, 0.1F, 1.0e-6F);
    REQUIRE_NEAR(color.alpha, 0.5F, 1.0e-6F);

    SyntheticSceneConfig config;
    config.physicalDisplaySize = {3'440, 1'440};
    config.physicalWindowBounds = {0, 0, 3'440, 1'440};
    config.drawableSize = {3'440, 1'440};
    config.safeArea = {80, 40, 120, 60};
    const ViewportState viewport = makeSyntheticViewport(config);
    REQUIRE_NEAR(viewport.world.drawablePixelsPerWorldUnit, 80.0F, 1.0e-6F);
    constexpr RectI expectedContentRect{440, 0, 2'560, 1'440};
    constexpr InsetsI expectedSafeArea{0, 40, 0, 60};
    REQUIRE(viewport.drawable.contentRect == expectedContentRect);
    REQUIRE(viewport.drawable.safeArea == expectedSafeArea);
    REQUIRE_NEAR(viewport.logicalUi.drawablePixelsPerLogicalUnitX, 4.0F / 3.0F, 1.0e-6F);
    REQUIRE_NEAR(viewport.logicalUi.drawablePixelsPerLogicalUnitY, 4.0F / 3.0F, 1.0e-6F);
    REQUIRE_NEAR(viewport.logicalUi.safeArea.left, 0.0F, 1.0e-4F);
    REQUIRE_NEAR(viewport.logicalUi.safeArea.top, 30.0F, 1.0e-4F);
    REQUIRE_NEAR(viewport.logicalUi.safeArea.right, 0.0F, 1.0e-4F);
    REQUIRE_NEAR(viewport.logicalUi.safeArea.bottom, 45.0F, 1.0e-4F);

    constexpr Vec2F worldPoint{7.25F, 12.5F};
    const Vec2F drawablePoint = transformPoint(
        viewport.world.worldToDrawable,
        worldPoint
    );
    const Vec2F restoredPoint = transformPoint(
        viewport.world.drawableToWorld,
        drawablePoint
    );
    REQUIRE_NEAR(restoredPoint.x, worldPoint.x, 1.0e-5F);
    REQUIRE_NEAR(restoredPoint.y, worldPoint.y, 1.0e-5F);
}

void testBuilderFailureIsTransactional() {
    using namespace cirvivor::render;
    using namespace cirvivor::render::frontend;

    static_assert(!std::is_copy_constructible_v<FramePacketBuilder>);
    static_assert(!std::is_copy_assignable_v<FramePacketBuilder>);
    static_assert(!std::is_move_constructible_v<FramePacketBuilder>);
    static_assert(!std::is_move_assignable_v<FramePacketBuilder>);

    FramePacket abandoned;
    {
        FramePacketBuilder builder(abandoned);
        REQUIRE(builder.begin({}, makeSyntheticViewport({})));
        ShapeCommand shape;
        shape.bounds = {8.0F, 12.0F, 24.0F, 16.0F};
        REQUIRE(builder.addShape(shape));
        REQUIRE(abandoned.commandStream().size() == 1U);
    }
    REQUIRE(abandoned.size() == FramePacketCapacity{});

    FramePacket invalidNumeric;
    FramePacketBuilder invalidBuilder(invalidNumeric);
    REQUIRE(invalidBuilder.begin({}, makeSyntheticViewport({})));
    ShapeCommand invalidShape;
    invalidShape.bounds = {8.0F, 12.0F, 24.0F, 16.0F};
    invalidShape.rotationRadians = std::numeric_limits<float>::quiet_NaN();
    REQUIRE(invalidBuilder.addShape(invalidShape));
    REQUIRE(!invalidBuilder.finish());
    REQUIRE(invalidBuilder.error() == FrameBuildError::structurallyInvalid);
    REQUIRE(invalidNumeric.size() == FramePacketCapacity{});

    FramePacket aliasedText;
    FramePacketBuilder textBuilder(aliasedText);
    REQUIRE(textBuilder.begin({}, makeSyntheticViewport({})));
    TextCommand text;
    text.maximumSize = {320.0F, 80.0F};
    text.fontSize = 24.0F;
    text.lineHeight = 28.0F;
    REQUIRE(textBuilder.addText(text, "first"));
    const std::string_view internalText = aliasedText.text(
        aliasedText.textRuns().front().utf8
    );
    REQUIRE(!textBuilder.addText(text, internalText));
    REQUIRE(textBuilder.error() == FrameBuildError::textAliasesPacketStorage);
    REQUIRE(!textBuilder.finish());
    REQUIRE(textBuilder.error() == FrameBuildError::textAliasesPacketStorage);
    REQUIRE(aliasedText.size() == FramePacketCapacity{});

    FramePacket shared;
    FramePacketBuilder first(shared);
    FramePacketBuilder second(shared);
    REQUIRE(first.begin({}, makeSyntheticViewport({})));
    REQUIRE(!second.begin({}, makeSyntheticViewport({})));
    REQUIRE(second.error() == FrameBuildError::packetAlreadyHasBuilder);
    first.abort();
    REQUIRE(second.begin({}, makeSyntheticViewport({})));
    second.abort();
}

void testDecodeRejectsBusyDestination() {
    using namespace cirvivor::render;
    using namespace cirvivor::render::frontend;

    FramePacket source(syntheticTestSceneCapacity());
    REQUIRE(buildSyntheticTestScene(
        source,
        {},
        PacketCapacityPolicy::fixedCapacity
    ).success);
    std::vector<std::byte> encoded;
    REQUIRE(serializeFramePacket(source, encoded));

    FramePacket destination;
    FramePacketBuilder builder(destination);
    REQUIRE(builder.begin({}, makeSyntheticViewport({})));
    const FramePacketDecodeResult busyResult = deserializeFramePacket(
        encoded,
        destination
    );
    REQUIRE(busyResult.error == FramePacketDecodeError::destinationBusy);
    REQUIRE(builder.isBuilding());
    builder.abort();

    REQUIRE(static_cast<bool>(deserializeFramePacket(encoded, destination)));
    REQUIRE(destination.isStructurallyValid());
}

struct TestCase final {
    std::string_view name;
    void (*run)();
};

} // namespace

int main() {
    const std::array tests{
        TestCase{"synthetic canonical round-trip", testSyntheticPacketCanonicalRoundTrip},
        TestCase{"fixed capacity and order", testFixedCapacityReuseAndOrderingGuard},
        TestCase{"malformed decode transaction", testMalformedDecodeDoesNotMutateDestination},
        TestCase{"PMA and viewport inverse", testPremultipliedAlphaAndViewportInverse},
        TestCase{"builder failure transaction", testBuilderFailureIsTransactional},
        TestCase{"busy decode destination", testDecodeRejectsBusyDestination}
    };

    std::size_t passed = 0;
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
