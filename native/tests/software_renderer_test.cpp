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
