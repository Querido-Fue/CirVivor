#include "render/common/frame_packet_codec.h"
#include "render/frontend/frame_packet_builder.h"
#include "render/frontend/synthetic_test_scene.h"
#include "render/sdl_gpu/sdl_gpu_geometry.h"

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

struct WireMigrationRecord final {
    std::uint16_t schemaVersion = 0;
    std::size_t wireByteCount = 0;
    std::uint64_t fnv1a64 = 0;
};

// v1은 재직렬화 대상이 아니라 마이그레이션 기록이다. 구 decoder가 읽던 synthetic
// fixture의 canonical byte 수/hash를 보존하고 v2 decoder는 버전을 명시적으로 거부한다.
constexpr WireMigrationRecord v1SyntheticWireRecord{
    1,
    2'862U,
    0xbe64'e77f'c11f'c188ULL
};

constexpr WireMigrationRecord v2SyntheticWireRecord{
    2,
    2'898U,
    0x73c9'f4cc'45c2'd5dbULL
};

constexpr WireMigrationRecord v2FeatureWireRecord{
    2,
    1'809U,
    0xdc42'ba9a'8b97'777bULL
};

constexpr cirvivor::render::FramePacketCapacity v2FeatureCapacity{
    9,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    1,
    2,
    1,
    4,
    6,
    1,
    3,
    2,
    4
};

[[nodiscard]] cirvivor::render::CommandHeader makeHeader(
    const cirvivor::render::RenderLayer layer,
    const cirvivor::render::CoordinateSpace space,
    const std::int32_t layerOrder = 0
) noexcept {
    return {
        layer,
        space,
        cirvivor::render::BlendMode::premultipliedAlpha,
        0,
        layerOrder,
        0
    };
}

[[nodiscard]] bool buildV2FeaturePacket(cirvivor::render::FramePacket& packet) {
    using namespace cirvivor::render;
    using namespace cirvivor::render::frontend;

    FrameMetadata metadata;
    metadata.frameId = 42;
    metadata.simulationTick = 240;
    metadata.presentationTimeSeconds = 4.0;
    metadata.interpolationAlpha = 0.25F;
    metadata.clearColor = PremultipliedRgba::opaque(0.02F, 0.03F, 0.08F);

    FramePacketBuilder builder(packet, PacketCapacityPolicy::fixedCapacity);
    if (!builder.begin(metadata, makeSyntheticViewport({}))) {
        return false;
    }

    GradientCommand gradient;
    gradient.header = makeHeader(RenderLayer::background, CoordinateSpace::logicalUi);
    gradient.type = GradientType::radial;
    gradient.bounds = {0.0F, 0.0F, 1'920.0F, 1'080.0F};
    gradient.start = {760.0F, 420.0F};
    gradient.end = {1'260.0F, 680.0F};
    gradient.startRadius = 40.0F;
    gradient.endRadius = 1'240.0F;
    const std::array gradientStops{
        GradientStop{0.0F, PremultipliedRgba::opaque(0.08F, 0.04F, 0.18F)},
        GradientStop{0.55F, PremultipliedRgba::opaque(0.12F, 0.07F, 0.24F)},
        GradientStop{1.0F, PremultipliedRgba::opaque(0.025F, 0.02F, 0.06F)}
    };
    if (!builder.addGradient(gradient, gradientStops)) {
        return false;
    }

    TexturedMeshCommand mesh;
    mesh.header = makeHeader(RenderLayer::object, CoordinateSpace::logicalUi);
    mesh.textureId = stableResourceId("title/logo/vector-atlas");
    mesh.tint = PremultipliedRgba::fromStraight(0.72F, 0.88F, 1.0F, 0.94F);
    const std::array meshVertices{
        ProjectiveVertex{{220.0F, 300.0F}, {0.0F, 0.0F}, 1.0F},
        ProjectiveVertex{{980.0F, 280.0F}, {1.0F, 0.0F}, 0.92F},
        ProjectiveVertex{{960.0F, 640.0F}, {1.0F, 1.0F}, 0.88F},
        ProjectiveVertex{{240.0F, 660.0F}, {0.0F, 1.0F}, 1.0F}
    };
    constexpr std::array<std::uint32_t, 6> meshIndices{0, 1, 2, 0, 2, 3};
    if (!builder.addTexturedMesh(mesh, meshVertices, meshIndices)) {
        return false;
    }

    ClipCommand pushClip;
    pushClip.header = makeHeader(RenderLayer::ui, CoordinateSpace::logicalUi);
    pushClip.operation = ClipOperation::pushRoundedRect;
    pushClip.antialias = 1;
    pushClip.bounds = {1'160.0F, 250.0F, 560.0F, 620.0F};
    pushClip.cornerRadius = 42.0F;
    if (!builder.addClip(pushClip)) {
        return false;
    }

    GlyphRunCommand glyphRun;
    glyphRun.header = makeHeader(RenderLayer::ui, CoordinateSpace::logicalUi);
    glyphRun.fontId = stableResourceId("font/pretendard-variable");
    glyphRun.glyphAtlasId = stableResourceId("font/pretendard-variable/atlas");
    glyphRun.origin = {1'248.0F, 412.0F};
    glyphRun.pixelsPerEm = 48.0F;
    glyphRun.weight = 640;
    glyphRun.variationCoordinates = {0.64F, 0.0F, 0.0F, 0.0F};
    glyphRun.color = PremultipliedRgba::opaque(0.92F, 0.97F, 1.0F);
    glyphRun.clipEnabled = 1;
    glyphRun.clipBounds = pushClip.bounds;
    const std::array glyphs{
        GlyphInstance{
            0x120U,
            0,
            {0.0F, 0.0F},
            {31.5F, 0.0F},
            {1.0F, -2.0F},
            {0.0F, 0.0F, 0.125F, 0.25F}
        },
        GlyphInstance{
            0x121U,
            1,
            {31.5F, 0.0F},
            {29.0F, 0.0F},
            {0.5F, -1.5F},
            {0.125F, 0.0F, 0.125F, 0.25F}
        }
    };
    if (!builder.addGlyphRun(glyphRun, glyphs)) {
        return false;
    }

    ClipCommand popClip = pushClip;
    popClip.operation = ClipOperation::pop;
    popClip.antialias = 0;
    popClip.bounds = {};
    popClip.cornerRadius = 0.0F;
    if (!builder.addClip(popClip)) {
        return false;
    }

    constexpr StableElementId passSession = 0x501U;
    constexpr StableElementId passDestination = 0x601U;
    PassCommand beginPass;
    beginPass.header = makeHeader(
        RenderLayer::dynamicOverlay,
        CoordinateSpace::logicalUi,
        20
    );
    beginPass.operation = PassOperation::beginSession;
    beginPass.sessionId = passSession;
    beginPass.destinationId = passDestination;
    if (!builder.addPass(beginPass)) {
        return false;
    }

    PassCommand capture = beginPass;
    capture.operation = PassOperation::capture;
    capture.sourceAnchorLayer = RenderLayer::ui;
    capture.sourceAnchorLayerOrder = 0;
    capture.sourceAnchorSequence = 4;
    capture.sourceRevision = metadata.frameId;
    capture.sourceBounds = {1'080.0F, 180.0F, 720.0F, 760.0F};
    capture.destinationBounds = capture.sourceBounds;
    if (!builder.addPass(capture)) {
        return false;
    }

    PassCommand composite = capture;
    composite.operation = PassOperation::composite;
    composite.opacity = 0.96F;
    composite.scale = {0.98F, 0.98F};
    composite.contentBlurRadius = 8.0F;
    composite.glassBlurRadius = 18.0F;
    composite.refractionStrength = 0.015F;
    composite.edgeStrength = 0.55F;
    composite.tintColor = PremultipliedRgba::fromStraight(0.12F, 0.18F, 0.28F, 0.72F);
    composite.edgeColor = PremultipliedRgba::fromStraight(0.68F, 0.9F, 1.0F, 0.55F);
    composite.shadowColor = PremultipliedRgba::fromStraight(0.0F, 0.0F, 0.0F, 0.18F);
    if (!builder.addPass(composite)) {
        return false;
    }

    PassCommand endPass = composite;
    endPass.operation = PassOperation::endSession;
    if (!builder.addPass(endPass)) {
        return false;
    }
    return builder.finish();
}

void writeU32LittleEndian(
    std::vector<std::byte>& bytes,
    const std::size_t offset,
    const std::uint32_t value
) {
    REQUIRE(offset <= bytes.size());
    REQUIRE(bytes.size() - offset >= 4U);
    for (std::uint32_t shift = 0; shift < 32U; shift += 8U) {
        bytes[offset + shift / 8U] = static_cast<std::byte>((value >> shift) & 0xffU);
    }
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
    REQUIRE(FramePacket::schema_version == v2SyntheticWireRecord.schemaVersion);
    REQUIRE(encoded.size() == v2SyntheticWireRecord.wireByteCount);
    REQUIRE(fnv1a64(encoded) == v2SyntheticWireRecord.fnv1a64);

    FramePacket decoded;
    const FramePacketDecodeResult decode = deserializeFramePacket(encoded, decoded);
    REQUIRE(static_cast<bool>(decode));
    REQUIRE(decoded.isStructurallyValid());
    REQUIRE(decoded.isRenderOrderValid());

    std::vector<std::byte> reencoded;
    REQUIRE(serializeFramePacket(decoded, reencoded));
    REQUIRE(reencoded == encoded);
}

void testV2FeaturePacketCanonicalRoundTrip() {
    using namespace cirvivor::render;

    FramePacket packet(v2FeatureCapacity);
    REQUIRE(buildV2FeaturePacket(packet));
    REQUIRE(packet.size() == v2FeatureCapacity);
    REQUIRE(packet.isStructurallyValid());
    REQUIRE(packet.isRenderOrderValid());
    REQUIRE(packet.glyphRuns().size() == 1U);
    REQUIRE(packet.glyphInstances().size() == 2U);
    REQUIRE(packet.texturedMeshes().size() == 1U);
    REQUIRE(packet.meshVertices().size() == 4U);
    REQUIRE(packet.meshIndices().size() == 6U);
    REQUIRE(packet.gradients().size() == 1U);
    REQUIRE(packet.gradientStops().size() == 3U);
    REQUIRE(packet.clips().size() == 2U);
    REQUIRE(packet.passes().size() == 4U);

    std::array<bool, 5> v2Kinds{};
    for (const CommandRef reference : packet.commandStream()) {
        const auto kind = static_cast<std::uint8_t>(reference.kind);
        if (kind >= static_cast<std::uint8_t>(CommandKind::glyphRun)
            && kind <= static_cast<std::uint8_t>(CommandKind::pass)) {
            v2Kinds[static_cast<std::size_t>(
                kind - static_cast<std::uint8_t>(CommandKind::glyphRun)
            )] = true;
        }
    }
    for (const bool present : v2Kinds) {
        REQUIRE(present);
    }

    std::vector<std::byte> encoded;
    REQUIRE(serializeFramePacket(packet, encoded));
    REQUIRE(FramePacket::schema_version == v2FeatureWireRecord.schemaVersion);
    REQUIRE(encoded.size() == v2FeatureWireRecord.wireByteCount);
    REQUIRE(fnv1a64(encoded) == v2FeatureWireRecord.fnv1a64);

    const FramePacketCapacity reservedCapacity = packet.capacity();
    REQUIRE(buildV2FeaturePacket(packet));
    REQUIRE(packet.capacity() == reservedCapacity);
    std::vector<std::byte> repeated;
    REQUIRE(serializeFramePacket(packet, repeated));
    REQUIRE(repeated == encoded);

    FramePacket decoded;
    const FramePacketDecodeResult result = deserializeFramePacket(encoded, decoded);
    REQUIRE(static_cast<bool>(result));
    REQUIRE(decoded.size() == v2FeatureCapacity);
    REQUIRE(decoded.isRenderOrderValid());

    std::vector<std::byte> reencoded;
    REQUIRE(serializeFramePacket(decoded, reencoded));
    REQUIRE(reencoded == encoded);
}

void testV1MigrationRecordAndSchemaGate() {
    using namespace cirvivor::render;
    using namespace cirvivor::render::frontend;

    static_assert(static_cast<std::uint8_t>(CommandKind::sprite) == 0U);
    static_assert(static_cast<std::uint8_t>(CommandKind::shape) == 1U);
    static_assert(static_cast<std::uint8_t>(CommandKind::line) == 2U);
    static_assert(static_cast<std::uint8_t>(CommandKind::text) == 3U);
    static_assert(static_cast<std::uint8_t>(CommandKind::effect) == 4U);
    static_assert(static_cast<std::uint8_t>(CommandKind::ui) == 5U);
    static_assert(static_cast<std::uint8_t>(CommandKind::overlay) == 6U);
    static_assert(v1SyntheticWireRecord.schemaVersion == 1U);
    static_assert(v1SyntheticWireRecord.wireByteCount == 2'862U);
    static_assert(v1SyntheticWireRecord.fnv1a64 == 0xbe64'e77f'c11f'c188ULL);

    FramePacket source(syntheticTestSceneCapacity());
    REQUIRE(buildSyntheticTestScene(
        source,
        {},
        PacketCapacityPolicy::fixedCapacity
    ).success);
    std::vector<std::byte> encoded;
    REQUIRE(serializeFramePacket(source, encoded));
    encoded[4] = std::byte{1};
    encoded[5] = std::byte{0};

    FramePacket destination(v2FeatureCapacity);
    REQUIRE(buildV2FeaturePacket(destination));
    std::vector<std::byte> before;
    REQUIRE(serializeFramePacket(destination, before));
    const FramePacketDecodeResult result = deserializeFramePacket(encoded, destination);
    REQUIRE(result.error == FramePacketDecodeError::unsupportedSchemaVersion);
    std::vector<std::byte> after;
    REQUIRE(serializeFramePacket(destination, after));
    REQUIRE(after == before);
}

void testV2MalformedRangesAndLimitsAreTransactional() {
    using namespace cirvivor::render;

    FramePacket source(v2FeatureCapacity);
    REQUIRE(buildV2FeaturePacket(source));
    std::vector<std::byte> encoded;
    REQUIRE(serializeFramePacket(source, encoded));

    FramePacket destination(v2FeatureCapacity);
    REQUIRE(buildV2FeaturePacket(destination));
    std::vector<std::byte> before;
    REQUIRE(serializeFramePacket(destination, before));

    constexpr std::size_t fixedBytes = 356U;
    constexpr std::size_t commandReferenceBytes = 9U * 5U;
    constexpr std::size_t glyphRangeCountOffset = fixedBytes
        + commandReferenceBytes + 12U + 8U + 8U + 4U;
    std::vector<std::byte> invalidGlyphRange = encoded;
    writeU32LittleEndian(invalidGlyphRange, glyphRangeCountOffset, 3U);
    REQUIRE(
        deserializeFramePacket(invalidGlyphRange, destination).error
        == FramePacketDecodeError::invalidPacket
    );

    constexpr std::size_t firstMeshIndexOffset = fixedBytes
        + commandReferenceBytes
        + 140U
        + 2U * 48U
        + 92U
        + 4U * 20U;
    std::vector<std::byte> invalidMeshIndex = encoded;
    writeU32LittleEndian(invalidMeshIndex, firstMeshIndexOffset, 4U);
    REQUIRE(
        deserializeFramePacket(invalidMeshIndex, destination).error
        == FramePacketDecodeError::invalidPacket
    );

    std::vector<std::byte> invalidKind = encoded;
    invalidKind[fixedBytes] = std::byte{0xff};
    REQUIRE(
        deserializeFramePacket(invalidKind, destination).error
        == FramePacketDecodeError::invalidPacket
    );

    FramePacketDecodeLimits glyphLimit;
    glyphLimit.maximumGlyphInstanceCount = 1;
    REQUIRE(
        deserializeFramePacket(encoded, destination, glyphLimit).error
        == FramePacketDecodeError::sizeLimitExceeded
    );

    std::vector<std::byte> truncated = encoded;
    truncated.pop_back();
    REQUIRE(
        deserializeFramePacket(truncated, destination).error
        == FramePacketDecodeError::truncated
    );
    std::vector<std::byte> trailing = encoded;
    trailing.push_back(std::byte{0});
    REQUIRE(
        deserializeFramePacket(trailing, destination).error
        == FramePacketDecodeError::trailingBytes
    );

    std::vector<std::byte> after;
    REQUIRE(serializeFramePacket(destination, after));
    REQUIRE(after == before);
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

void testUtf8SliceBoundariesAndOverlappingSlices() {
    using namespace cirvivor::render;
    using namespace cirvivor::render::frontend;

    FramePacketCapacity capacity;
    capacity.commandCount = 1;
    capacity.textCount = 1;
    capacity.utf8ByteCount = 5;
    FramePacket source(capacity);
    FramePacketBuilder builder(source, PacketCapacityPolicy::fixedCapacity);
    REQUIRE(builder.begin({}, makeSyntheticViewport({})));
    TextCommand command;
    const std::string utf8{"A\xe2\x82\xac" "B"};
    REQUIRE(utf8.size() == 5U);
    REQUIRE(builder.addText(command, utf8));
    REQUIRE(builder.finish());

    std::vector<std::byte> encoded;
    REQUIRE(serializeFramePacket(source, encoded));
    constexpr std::size_t fixedBytes = 356U;
    constexpr std::size_t commandReferenceBytes = 5U;
    constexpr std::size_t textSliceOffset = fixedBytes
        + commandReferenceBytes + 12U + 8U;

    std::vector<std::byte> exactCodePoint = encoded;
    writeU32LittleEndian(exactCodePoint, textSliceOffset, 1U);
    writeU32LittleEndian(exactCodePoint, textSliceOffset + 4U, 3U);
    FramePacket exactDecoded;
    REQUIRE(static_cast<bool>(deserializeFramePacket(exactCodePoint, exactDecoded)));
    REQUIRE(exactDecoded.text(exactDecoded.textRuns().front().utf8).size() == 3U);

    std::vector<std::byte> emptyInsideCodePoint = encoded;
    writeU32LittleEndian(emptyInsideCodePoint, textSliceOffset, 2U);
    writeU32LittleEndian(emptyInsideCodePoint, textSliceOffset + 4U, 0U);
    FramePacket emptyDecoded;
    REQUIRE(static_cast<bool>(deserializeFramePacket(emptyInsideCodePoint, emptyDecoded)));
    REQUIRE(emptyDecoded.text(emptyDecoded.textRuns().front().utf8).empty());

    std::vector<std::byte> invalidStart = encoded;
    writeU32LittleEndian(invalidStart, textSliceOffset, 2U);
    writeU32LittleEndian(invalidStart, textSliceOffset + 4U, 1U);
    FramePacket invalidDestination;
    REQUIRE(
        deserializeFramePacket(invalidStart, invalidDestination).error
        == FramePacketDecodeError::invalidPacket
    );

    std::vector<std::byte> invalidEnd = encoded;
    writeU32LittleEndian(invalidEnd, textSliceOffset, 1U);
    writeU32LittleEndian(invalidEnd, textSliceOffset + 4U, 1U);
    REQUIRE(
        deserializeFramePacket(invalidEnd, invalidDestination).error
        == FramePacketDecodeError::invalidPacket
    );

    FramePacket overlappingSource(syntheticTestSceneCapacity());
    REQUIRE(buildSyntheticTestScene(
        overlappingSource,
        {},
        PacketCapacityPolicy::fixedCapacity
    ).success);
    std::vector<std::byte> overlappingWire;
    REQUIRE(serializeFramePacket(overlappingSource, overlappingWire));
    constexpr std::size_t syntheticCommandReferences = 25U * 5U;
    constexpr std::size_t syntheticTextBlock = fixedBytes
        + syntheticCommandReferences
        + 6U * 84U
        + 2U * 76U
        + 2U * 52U;
    for (std::size_t index = 0; index < 5U; ++index) {
        const std::size_t slice = syntheticTextBlock + index * 76U + 12U + 8U;
        writeU32LittleEndian(overlappingWire, slice, 0U);
        writeU32LittleEndian(overlappingWire, slice + 4U, 85U);
    }
    FramePacket overlappingDecoded;
    REQUIRE(static_cast<bool>(deserializeFramePacket(overlappingWire, overlappingDecoded)));
    for (const TextCommand& text : overlappingDecoded.textRuns()) {
        REQUIRE(text.utf8.byteOffset == 0U);
        REQUIRE(text.utf8.byteLength == 85U);
    }
}

void testDecodeLimitLegacyAggregatePrefix() {
    using namespace cirvivor::render;
    using namespace cirvivor::render::frontend;

    constexpr FramePacketDecodeLimits legacyPrefix{101U, 102U, 103U, 104U, 105U};
    static_assert(legacyPrefix.maximumCommandCount == 101U);
    static_assert(legacyPrefix.maximumCommandsPerKind == 102U);
    static_assert(legacyPrefix.maximumUtf8ByteCount == 103U);
    static_assert(legacyPrefix.maximumWireByteCount == 104U);
    static_assert(legacyPrefix.maximumDecodedByteCount == 105U);
    static_assert(legacyPrefix.maximumGlyphInstanceCount == 1U * 1'024U * 1'024U);
    static_assert(legacyPrefix.maximumMeshVertexCount == 1U * 1'024U * 1'024U);
    static_assert(legacyPrefix.maximumMeshIndexCount == 3U * 1'024U * 1'024U);
    static_assert(legacyPrefix.maximumGradientStopCount == 256U * 1'024U);

    REQUIRE(legacyPrefix.maximumWireByteCount == 104U);
    REQUIRE(legacyPrefix.maximumDecodedByteCount == 105U);
    FramePacket source(syntheticTestSceneCapacity());
    REQUIRE(buildSyntheticTestScene(
        source,
        {},
        PacketCapacityPolicy::fixedCapacity
    ).success);
    std::vector<std::byte> encoded;
    REQUIRE(serializeFramePacket(source, encoded));
    FramePacket destination;
    REQUIRE(
        deserializeFramePacket(encoded, destination, legacyPrefix).error
        == FramePacketDecodeError::sizeLimitExceeded
    );
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

void testV2FixedCapacityAndStorageAliasAreTransactional() {
    using namespace cirvivor::render;
    using namespace cirvivor::render::frontend;

    FramePacketCapacity insufficientCapacity = v2FeatureCapacity;
    insufficientCapacity.glyphInstanceCount = 1;
    FramePacket insufficient(insufficientCapacity);
    FramePacketBuilder insufficientBuilder(
        insufficient,
        PacketCapacityPolicy::fixedCapacity
    );
    REQUIRE(insufficientBuilder.begin({}, makeSyntheticViewport({})));
    GlyphRunCommand run;
    run.fontId = stableResourceId("font/test");
    run.glyphAtlasId = stableResourceId("font/test/atlas");
    run.pixelsPerEm = 24.0F;
    const std::array glyphs{
        GlyphInstance{1, 0, {}, {12.0F, 0.0F}, {}, {0.0F, 0.0F, 0.25F, 0.25F}},
        GlyphInstance{2, 0, {12.0F, 0.0F}, {12.0F, 0.0F}, {}, {0.25F, 0.0F, 0.25F, 0.25F}}
    };
    REQUIRE(!insufficientBuilder.addGlyphRun(run, glyphs));
    REQUIRE(insufficientBuilder.error() == FrameBuildError::capacityExceeded);
    REQUIRE(!insufficientBuilder.finish());
    REQUIRE(insufficient.size() == FramePacketCapacity{});

    FramePacket aliased({2, 0, 0, 0, 0, 0, 0, 0, 0, 2, 4});
    FramePacketBuilder aliasBuilder(aliased, PacketCapacityPolicy::fixedCapacity);
    REQUIRE(aliasBuilder.begin({}, makeSyntheticViewport({})));
    REQUIRE(aliasBuilder.addGlyphRun(run, glyphs));
    const std::span<const GlyphInstance> internalGlyphs = aliased.glyphInstances();
    REQUIRE(!aliasBuilder.addGlyphRun(run, internalGlyphs));
    REQUIRE(aliasBuilder.error() == FrameBuildError::storageAliasesPacketStorage);
    REQUIRE(!aliasBuilder.finish());
    REQUIRE(aliased.size() == FramePacketCapacity{});
}

void testClipStackUnderflowAndUnclosedAreRejected() {
    using namespace cirvivor::render;
    using namespace cirvivor::render::frontend;

    FramePacketCapacity capacity;
    capacity.commandCount = 1;
    capacity.clipCount = 1;

    FramePacket underflow(capacity);
    FramePacketBuilder underflowBuilder(underflow, PacketCapacityPolicy::fixedCapacity);
    REQUIRE(underflowBuilder.begin({}, makeSyntheticViewport({})));
    ClipCommand pop;
    pop.operation = ClipOperation::pop;
    REQUIRE(underflowBuilder.addClip(pop));
    REQUIRE(!underflowBuilder.finish());
    REQUIRE(underflowBuilder.error() == FrameBuildError::structurallyInvalid);
    REQUIRE(underflow.size() == FramePacketCapacity{});

    FramePacket unclosed(capacity);
    FramePacketBuilder unclosedBuilder(unclosed, PacketCapacityPolicy::fixedCapacity);
    REQUIRE(unclosedBuilder.begin({}, makeSyntheticViewport({})));
    ClipCommand push;
    push.operation = ClipOperation::pushScissor;
    push.bounds = {0.0F, 0.0F, 64.0F, 64.0F};
    REQUIRE(unclosedBuilder.addClip(push));
    REQUIRE(!unclosedBuilder.finish());
    REQUIRE(unclosedBuilder.error() == FrameBuildError::structurallyInvalid);
    REQUIRE(unclosed.size() == FramePacketCapacity{});
}

void testPassDependencyCycleAndOpenPassLayerEscapeAreRejected() {
    using namespace cirvivor::render;
    using namespace cirvivor::render::frontend;

    FramePacketCapacity cycleCapacity;
    cycleCapacity.commandCount = 9;
    cycleCapacity.shapeCount = 1;
    cycleCapacity.passCount = 8;
    FramePacket cycle(cycleCapacity);
    FramePacketBuilder cycleBuilder(cycle, PacketCapacityPolicy::fixedCapacity);
    REQUIRE(cycleBuilder.begin({}, makeSyntheticViewport({})));
    ShapeCommand background;
    background.bounds = {0.0F, 0.0F, 32.0F, 32.0F};
    REQUIRE(cycleBuilder.addShape(background));

    PassCommand passA;
    passA.header = makeHeader(RenderLayer::dynamicOverlay, CoordinateSpace::logicalUi, 10);
    passA.operation = PassOperation::beginSession;
    passA.sessionId = 0xa1U;
    passA.destinationId = 0xd1U;
    REQUIRE(cycleBuilder.addPass(passA));

    PassCommand passB = passA;
    passB.operation = PassOperation::beginSession;
    passB.sessionId = 0xb1U;
    passB.destinationId = 0xe1U;
    REQUIRE(cycleBuilder.addPass(passB));

    PassCommand captureB = passB;
    captureB.operation = PassOperation::capture;
    captureB.sourceSessionId = passA.sessionId;
    captureB.sourceAnchorLayer = RenderLayer::dynamicOverlay;
    captureB.sourceAnchorLayerOrder = 10;
    captureB.sourceAnchorSequence = 1;
    REQUIRE(cycleBuilder.addPass(captureB));
    PassCommand compositeB = captureB;
    compositeB.operation = PassOperation::composite;
    REQUIRE(cycleBuilder.addPass(compositeB));
    PassCommand endB = compositeB;
    endB.operation = PassOperation::endSession;
    REQUIRE(cycleBuilder.addPass(endB));

    PassCommand captureA = passA;
    captureA.operation = PassOperation::capture;
    captureA.sourceSessionId = passB.sessionId;
    captureA.sourceAnchorLayer = RenderLayer::dynamicOverlay;
    captureA.sourceAnchorLayerOrder = 10;
    captureA.sourceAnchorSequence = 5;
    REQUIRE(cycleBuilder.addPass(captureA));
    PassCommand compositeA = captureA;
    compositeA.operation = PassOperation::composite;
    REQUIRE(cycleBuilder.addPass(compositeA));
    PassCommand endA = compositeA;
    endA.operation = PassOperation::endSession;
    REQUIRE(cycleBuilder.addPass(endA));
    REQUIRE(!cycleBuilder.finish());
    REQUIRE(cycleBuilder.error() == FrameBuildError::structurallyInvalid);
    REQUIRE(cycle.size() == FramePacketCapacity{});

    FramePacketCapacity escapeCapacity;
    escapeCapacity.commandCount = 5;
    escapeCapacity.shapeCount = 2;
    escapeCapacity.passCount = 3;
    FramePacket escape(escapeCapacity);
    FramePacketBuilder escapeBuilder(escape, PacketCapacityPolicy::fixedCapacity);
    REQUIRE(escapeBuilder.begin({}, makeSyntheticViewport({})));
    REQUIRE(escapeBuilder.addShape(background));
    REQUIRE(escapeBuilder.addPass(passA));
    PassCommand capture = passA;
    capture.operation = PassOperation::capture;
    capture.sourceAnchorSequence = 0;
    REQUIRE(escapeBuilder.addPass(capture));
    PassCommand composite = capture;
    composite.operation = PassOperation::composite;
    REQUIRE(escapeBuilder.addPass(composite));
    ShapeCommand top = background;
    top.header.layer = RenderLayer::top;
    REQUIRE(escapeBuilder.addShape(top));
    REQUIRE(!escapeBuilder.finish());
    REQUIRE(escapeBuilder.error() == FrameBuildError::structurallyInvalid);
    REQUIRE(escape.size() == FramePacketCapacity{});
}

void testPassCaptureAnchorMatchesExactSourceAndCompositeAvailability() {
    using namespace cirvivor::render;
    using namespace cirvivor::render::frontend;

    FramePacketCapacity mismatchCapacity;
    mismatchCapacity.commandCount = 5;
    mismatchCapacity.shapeCount = 1;
    mismatchCapacity.passCount = 4;
    FramePacket mismatch(mismatchCapacity);
    FramePacketBuilder mismatchBuilder(mismatch, PacketCapacityPolicy::fixedCapacity);
    REQUIRE(mismatchBuilder.begin({}, makeSyntheticViewport({})));
    ShapeCommand background;
    background.bounds = {0.0F, 0.0F, 32.0F, 32.0F};
    REQUIRE(mismatchBuilder.addShape(background));

    PassCommand begin;
    begin.header = makeHeader(RenderLayer::dynamicOverlay, CoordinateSpace::logicalUi, 10);
    begin.operation = PassOperation::beginSession;
    begin.sessionId = 0x101U;
    begin.destinationId = 0x201U;
    REQUIRE(mismatchBuilder.addPass(begin));
    PassCommand mismatchedCapture = begin;
    mismatchedCapture.operation = PassOperation::capture;
    mismatchedCapture.sourceAnchorLayer = RenderLayer::ui;
    mismatchedCapture.sourceAnchorLayerOrder = 0;
    mismatchedCapture.sourceAnchorSequence = 0;
    REQUIRE(mismatchBuilder.addPass(mismatchedCapture));
    PassCommand mismatchedComposite = mismatchedCapture;
    mismatchedComposite.operation = PassOperation::composite;
    REQUIRE(mismatchBuilder.addPass(mismatchedComposite));
    PassCommand mismatchedEnd = mismatchedComposite;
    mismatchedEnd.operation = PassOperation::endSession;
    REQUIRE(mismatchBuilder.addPass(mismatchedEnd));
    REQUIRE(!mismatchBuilder.finish());
    REQUIRE(mismatchBuilder.error() == FrameBuildError::structurallyInvalid);

    const auto dependentPassBuildSucceeds = [](const std::uint32_t sourceAnchorSequence) {
        FramePacketCapacity capacity;
        capacity.commandCount = 9;
        capacity.shapeCount = 1;
        capacity.passCount = 8;
        FramePacket packet(capacity);
        FramePacketBuilder builder(packet, PacketCapacityPolicy::fixedCapacity);
        if (!builder.begin({}, makeSyntheticViewport({}))) {
            return false;
        }

        ShapeCommand sourceBackground;
        sourceBackground.bounds = {0.0F, 0.0F, 32.0F, 32.0F};
        if (!builder.addShape(sourceBackground)) {
            return false;
        }

        PassCommand sourceBegin;
        sourceBegin.header = makeHeader(
            RenderLayer::dynamicOverlay,
            CoordinateSpace::logicalUi,
            10
        );
        sourceBegin.operation = PassOperation::beginSession;
        sourceBegin.sessionId = 0x301U;
        sourceBegin.destinationId = 0x401U;
        if (!builder.addPass(sourceBegin)) {
            return false;
        }
        PassCommand sourceCapture = sourceBegin;
        sourceCapture.operation = PassOperation::capture;
        sourceCapture.sourceAnchorLayer = RenderLayer::background;
        sourceCapture.sourceAnchorLayerOrder = 0;
        sourceCapture.sourceAnchorSequence = 0;
        if (!builder.addPass(sourceCapture)) {
            return false;
        }
        PassCommand sourceComposite = sourceCapture;
        sourceComposite.operation = PassOperation::composite;
        if (!builder.addPass(sourceComposite)) {
            return false;
        }
        PassCommand sourceEnd = sourceComposite;
        sourceEnd.operation = PassOperation::endSession;
        if (!builder.addPass(sourceEnd)) {
            return false;
        }

        PassCommand dependentBegin = sourceBegin;
        dependentBegin.operation = PassOperation::beginSession;
        dependentBegin.sessionId = 0x501U;
        dependentBegin.destinationId = 0x601U;
        if (!builder.addPass(dependentBegin)) {
            return false;
        }
        PassCommand dependentCapture = dependentBegin;
        dependentCapture.operation = PassOperation::capture;
        dependentCapture.sourceSessionId = sourceBegin.sessionId;
        dependentCapture.sourceAnchorLayer = RenderLayer::dynamicOverlay;
        dependentCapture.sourceAnchorLayerOrder = 10;
        dependentCapture.sourceAnchorSequence = sourceAnchorSequence;
        if (!builder.addPass(dependentCapture)) {
            return false;
        }
        PassCommand dependentComposite = dependentCapture;
        dependentComposite.operation = PassOperation::composite;
        if (!builder.addPass(dependentComposite)) {
            return false;
        }
        PassCommand dependentEnd = dependentComposite;
        dependentEnd.operation = PassOperation::endSession;
        return builder.addPass(dependentEnd) && builder.finish();
    };

    REQUIRE(!dependentPassBuildSucceeds(1U));
    REQUIRE(dependentPassBuildSucceeds(3U));
}

void testSdlGpuNonFiniteDerivedPlaceholderBoundsFallback() {
    using namespace cirvivor::render;
    using namespace cirvivor::render::frontend;

    FramePacketCapacity capacity;
    capacity.commandCount = 2;
    capacity.glyphRunCount = 1;
    capacity.glyphInstanceCount = 2;
    capacity.texturedMeshCount = 1;
    capacity.meshVertexCount = 4;
    capacity.meshIndexCount = 6;
    FramePacket packet(capacity);
    FramePacketBuilder builder(packet, PacketCapacityPolicy::fixedCapacity);
    REQUIRE(builder.begin({}, makeSyntheticViewport({})));

    GlyphRunCommand glyphRun;
    glyphRun.header = makeHeader(RenderLayer::background, CoordinateSpace::logicalUi);
    glyphRun.fontId = stableResourceId("font/extreme");
    glyphRun.glyphAtlasId = stableResourceId("font/extreme/atlas");
    glyphRun.pixelsPerEm = std::numeric_limits<float>::max();
    const std::array glyphs{
        GlyphInstance{1, 0, {}, {}, {}, {0.0F, 0.0F, 0.25F, 0.25F}},
        GlyphInstance{2, 0, {}, {}, {}, {0.25F, 0.0F, 0.25F, 0.25F}}
    };
    REQUIRE(builder.addGlyphRun(glyphRun, glyphs));

    const float lowest = -std::numeric_limits<float>::max();
    const float highest = std::numeric_limits<float>::max();
    TexturedMeshCommand mesh;
    mesh.header = makeHeader(RenderLayer::background, CoordinateSpace::logicalUi);
    mesh.textureId = stableResourceId("mesh/extreme");
    const std::array vertices{
        ProjectiveVertex{{lowest, lowest}, {0.0F, 0.0F}, 1.0F},
        ProjectiveVertex{{highest, lowest}, {1.0F, 0.0F}, 1.0F},
        ProjectiveVertex{{highest, highest}, {1.0F, 1.0F}, 1.0F},
        ProjectiveVertex{{lowest, highest}, {0.0F, 1.0F}, 1.0F}
    };
    constexpr std::array<std::uint32_t, 6> indices{0, 1, 2, 0, 2, 3};
    REQUIRE(builder.addTexturedMesh(mesh, vertices, indices));
    REQUIRE(builder.finish());

    cirvivor::render::sdl_gpu::detail::FrameGeometry geometry(256U, 8U);
    const cirvivor::render::sdl_gpu::detail::GeometryBuildResult result =
        cirvivor::render::sdl_gpu::detail::buildFrameGeometry(packet, geometry);
    REQUIRE(result.error == cirvivor::render::sdl_gpu::detail::GeometryBuildError::none);
    REQUIRE(result.stats.renderedCommands == 2U);
    REQUIRE(result.stats.placeholderCommands == 2U);
    REQUIRE(result.stats.generatedVertices > 0U);
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
        TestCase{"v2 feature canonical round-trip", testV2FeaturePacketCanonicalRoundTrip},
        TestCase{"v1 migration record", testV1MigrationRecordAndSchemaGate},
        TestCase{"v2 malformed ranges", testV2MalformedRangesAndLimitsAreTransactional},
        TestCase{"fixed capacity and order", testFixedCapacityReuseAndOrderingGuard},
        TestCase{"malformed decode transaction", testMalformedDecodeDoesNotMutateDestination},
        TestCase{"UTF-8 slice boundaries and overlap", testUtf8SliceBoundariesAndOverlappingSlices},
        TestCase{"legacy decode limit aggregate prefix", testDecodeLimitLegacyAggregatePrefix},
        TestCase{"PMA and viewport inverse", testPremultipliedAlphaAndViewportInverse},
        TestCase{"builder failure transaction", testBuilderFailureIsTransactional},
        TestCase{"v2 capacity and alias transaction", testV2FixedCapacityAndStorageAliasAreTransactional},
        TestCase{"clip stack validation", testClipStackUnderflowAndUnclosedAreRejected},
        TestCase{"pass dependency and layer validation", testPassDependencyCycleAndOpenPassLayerEscapeAreRejected},
        TestCase{"pass exact capture anchor", testPassCaptureAnchorMatchesExactSourceAndCompositeAvailability},
        TestCase{"SDL GPU non-finite placeholder fallback", testSdlGpuNonFiniteDerivedPlaceholderBoundsFallback},
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
