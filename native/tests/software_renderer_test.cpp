#include "render/frontend/synthetic_test_scene.h"
#include "render/software/software_renderer.h"

#include <array>
#include <cstdint>
#include <exception>
#include <iostream>
#include <stdexcept>
#include <string>
#include <string_view>

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

void requireEqualU64(
    const std::uint64_t actual,
    const std::uint64_t expected,
    const std::string_view expression,
    const std::string_view file,
    const int line
) {
    if (actual != expected) {
        throw TestFailure(
            std::string(file) + ':' + std::to_string(line)
            + " requirement failed: " + std::string(expression)
            + " (actual=" + std::to_string(actual)
            + ", expected=" + std::to_string(expected) + ')'
        );
    }
}

#define REQUIRE(expression) require((expression), #expression, __FILE__, __LINE__)
#define REQUIRE_U64(actual, expected) \
    requireEqualU64((actual), (expected), #actual " == " #expected, __FILE__, __LINE__)

[[nodiscard]] cirvivor::render::CommandHeader makeHeader(
    const cirvivor::render::RenderLayer layer,
    const std::int32_t layerOrder = 0
) noexcept {
    return {
        layer,
        cirvivor::render::CoordinateSpace::logicalUi,
        cirvivor::render::BlendMode::premultipliedAlpha,
        0,
        layerOrder,
        0
    };
}

[[nodiscard]] bool buildV2PlaceholderPacket(cirvivor::render::FramePacket& packet) {
    using namespace cirvivor::render;
    using namespace cirvivor::render::frontend;

    FramePacketBuilder builder(packet, PacketCapacityPolicy::fixedCapacity);
    if (!builder.begin({}, makeSyntheticViewport({}))) {
        return false;
    }
    GradientCommand gradient;
    gradient.header = makeHeader(RenderLayer::background);
    gradient.bounds = {0.0F, 0.0F, 1'920.0F, 1'080.0F};
    gradient.start = {0.0F, 0.0F};
    gradient.end = {1'920.0F, 1'080.0F};
    const std::array stops{
        GradientStop{0.0F, PremultipliedRgba::opaque(0.08F, 0.04F, 0.18F)},
        GradientStop{1.0F, PremultipliedRgba::opaque(0.02F, 0.02F, 0.06F)}
    };
    if (!builder.addGradient(gradient, stops)) {
        return false;
    }

    TexturedMeshCommand mesh;
    mesh.header = makeHeader(RenderLayer::object);
    mesh.textureId = stableResourceId("placeholder/mesh");
    const std::array vertices{
        ProjectiveVertex{{100.0F, 100.0F}, {0.0F, 0.0F}, 1.0F},
        ProjectiveVertex{{400.0F, 100.0F}, {1.0F, 0.0F}, 1.0F},
        ProjectiveVertex{{400.0F, 300.0F}, {1.0F, 1.0F}, 1.0F},
        ProjectiveVertex{{100.0F, 300.0F}, {0.0F, 1.0F}, 1.0F}
    };
    constexpr std::array<std::uint32_t, 6> indices{0, 1, 2, 0, 2, 3};
    if (!builder.addTexturedMesh(mesh, vertices, indices)) {
        return false;
    }

    ClipCommand push;
    push.header = makeHeader(RenderLayer::ui);
    push.bounds = {900.0F, 220.0F, 640.0F, 520.0F};
    if (!builder.addClip(push)) {
        return false;
    }
    GlyphRunCommand run;
    run.header = makeHeader(RenderLayer::ui);
    run.fontId = stableResourceId("placeholder/font");
    run.glyphAtlasId = stableResourceId("placeholder/atlas");
    run.origin = {960.0F, 360.0F};
    run.pixelsPerEm = 48.0F;
    const std::array glyphs{
        GlyphInstance{1, 0, {}, {28.0F, 0.0F}, {}, {0.0F, 0.0F, 0.25F, 0.25F}}
    };
    if (!builder.addGlyphRun(run, glyphs)) {
        return false;
    }
    ClipCommand pop = push;
    pop.operation = ClipOperation::pop;
    pop.bounds = {};
    if (!builder.addClip(pop)) {
        return false;
    }

    PassCommand begin;
    begin.header = makeHeader(RenderLayer::dynamicOverlay, 10);
    begin.sessionId = 0x101U;
    begin.destinationId = 0x201U;
    if (!builder.addPass(begin)) {
        return false;
    }
    PassCommand capture = begin;
    capture.operation = PassOperation::capture;
    capture.sourceAnchorLayer = RenderLayer::ui;
    capture.sourceAnchorSequence = 4;
    capture.sourceBounds = {800.0F, 160.0F, 800.0F, 760.0F};
    capture.destinationBounds = capture.sourceBounds;
    if (!builder.addPass(capture)) {
        return false;
    }
    PassCommand composite = capture;
    composite.operation = PassOperation::composite;
    composite.tintColor = PremultipliedRgba::fromStraight(0.12F, 0.2F, 0.34F, 0.72F);
    if (!builder.addPass(composite)) {
        return false;
    }
    PassCommand end = composite;
    end.operation = PassOperation::endSession;
    if (!builder.addPass(end)) {
        return false;
    }
    return builder.finish();
}

void testSyntheticFramePixelGoldens() {
    using namespace cirvivor::render;
    using namespace cirvivor::render::frontend;
    using namespace cirvivor::render::software;

    SyntheticSceneConfig config;
    config.phaseStep = 37;
    config.effectQuality = EffectQuality::softwareReplacement;
    FramePacket packet(syntheticTestSceneCapacity());
    REQUIRE(buildSyntheticTestScene(
        packet,
        config,
        PacketCapacityPolicy::fixedCapacity
    ).success);

    SoftwareRenderer renderer;
    REQUIRE(renderer.isValid());
    REQUIRE(renderer.internalSize() == SoftwareRenderer::default_internal_size);
    REQUIRE(renderer.render(packet));
    const std::uint64_t defaultHash = renderer.pixelHash();
    REQUIRE(renderer.lastStats().submittedCommands == 25U);
    REQUIRE(renderer.lastStats().renderedCommands == 25U);
    REQUIRE(renderer.lastStats().placeholderCommands == 19U);
    REQUIRE(renderer.lastStats().skippedCommands == 0U);

    REQUIRE(renderer.render(packet));
    const std::uint64_t repeatedHash = renderer.pixelHash();

    REQUIRE(renderer.resize(SoftwareRenderer::reduced_internal_size));
    REQUIRE(renderer.render(packet));
    const std::uint64_t reducedHash = renderer.pixelHash();
    REQUIRE_U64(defaultHash, 0x77fe'ca0d'b768'b39dULL);
    REQUIRE_U64(repeatedHash, defaultHash);
    REQUIRE_U64(reducedHash, 0xe297'e690'c6d9'1e76ULL);
}

void testV2UnsupportedCommandsAreExplicitlyInstrumented() {
    using namespace cirvivor::render;
    using namespace cirvivor::render::software;

    FramePacketCapacity capacity;
    capacity.commandCount = 9;
    capacity.glyphRunCount = 1;
    capacity.glyphInstanceCount = 1;
    capacity.texturedMeshCount = 1;
    capacity.meshVertexCount = 4;
    capacity.meshIndexCount = 6;
    capacity.gradientCount = 1;
    capacity.gradientStopCount = 2;
    capacity.clipCount = 2;
    capacity.passCount = 4;
    FramePacket packet(capacity);
    REQUIRE(buildV2PlaceholderPacket(packet));

    SoftwareRenderer renderer;
    REQUIRE(renderer.render(packet));
    REQUIRE(renderer.lastStats().submittedCommands == 9U);
    REQUIRE(renderer.lastStats().renderedCommands == 9U);
    REQUIRE(renderer.lastStats().placeholderCommands == 9U);
    REQUIRE(renderer.lastStats().skippedCommands == 0U);
}

void testUltrawideViewportGolden() {
    using namespace cirvivor::render;
    using namespace cirvivor::render::frontend;
    using namespace cirvivor::render::software;

    SyntheticSceneConfig config;
    config.physicalDisplaySize = {3'440, 1'440};
    config.physicalWindowBounds = {0, 0, 3'440, 1'440};
    config.drawableSize = {3'440, 1'440};
    config.safeArea = {80, 40, 120, 60};
    config.phaseStep = 37;
    config.effectQuality = EffectQuality::softwareReplacement;

    FramePacket packet(syntheticTestSceneCapacity());
    REQUIRE(buildSyntheticTestScene(
        packet,
        config,
        PacketCapacityPolicy::fixedCapacity
    ).success);
    SoftwareRenderer renderer;
    REQUIRE(renderer.render(packet));
    REQUIRE_U64(renderer.pixelHash(), 0x34f9'5f4e'5868'd1fcULL);
}

void testInvalidInputsPreserveOwnedSurface() {
    using namespace cirvivor::render;
    using namespace cirvivor::render::software;

    SoftwareRenderer renderer;
    REQUIRE(renderer.isValid());
    const SizeI originalSize = renderer.internalSize();
    REQUIRE(!renderer.resize(0, originalSize.height));
    REQUIRE(renderer.lastError() == SoftwareRenderError::invalidDimensions);
    REQUIRE(renderer.internalSize() == originalSize);
    REQUIRE(renderer.isValid());

    FramePacket invalidPacket;
    REQUIRE(!renderer.render(invalidPacket));
    REQUIRE(renderer.lastError() == SoftwareRenderError::invalidFramePacket);
}

struct TestCase final {
    std::string_view name;
    void (*run)();
};

} // namespace

int main() {
    const std::array tests{
        TestCase{"synthetic software pixel goldens", testSyntheticFramePixelGoldens},
        TestCase{"v2 placeholder instrumentation", testV2UnsupportedCommandsAreExplicitlyInstrumented},
        TestCase{"ultrawide software golden", testUltrawideViewportGolden},
        TestCase{"software input validation", testInvalidInputsPreserveOwnedSurface}
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
