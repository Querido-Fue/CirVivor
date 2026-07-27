#include "render/frontend/synthetic_test_scene.h"
#include "render/software/software_renderer.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <exception>
#include <iostream>
#include <new>
#include <stdexcept>
#include <string>
#include <string_view>

namespace allocation_tracking {

thread_local bool enabled = false;
thread_local std::size_t allocationCount = 0U;

void recordAllocation() noexcept {
    if (enabled) {
        ++allocationCount;
    }
}

} // namespace allocation_tracking

void* operator new(const std::size_t size) {
    if (void* const memory = std::malloc(size == 0U ? 1U : size)) {
        allocation_tracking::recordAllocation();
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

class AllocationScope final {
public:
    AllocationScope() noexcept
        : previousEnabled_(allocation_tracking::enabled),
          startCount_(allocation_tracking::allocationCount) {
        allocation_tracking::enabled = true;
    }

    AllocationScope(const AllocationScope&) = delete;
    AllocationScope& operator=(const AllocationScope&) = delete;

    ~AllocationScope() {
        allocation_tracking::enabled = previousEnabled_;
    }

    [[nodiscard]] std::size_t allocationCount() const noexcept {
        return allocation_tracking::allocationCount - startCount_;
    }

private:
    bool previousEnabled_ = false;
    std::size_t startCount_ = 0U;
};

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
    const std::int32_t layerOrder = 0,
    const cirvivor::render::CoordinateSpace coordinateSpace =
        cirvivor::render::CoordinateSpace::logicalUi
) noexcept {
    return {
        layer,
        coordinateSpace,
        cirvivor::render::BlendMode::premultipliedAlpha,
        0,
        layerOrder,
        0
    };
}

[[nodiscard]] std::uint32_t pixelAt(
    const cirvivor::render::software::SoftwareRenderer& renderer,
    const int x,
    const int y
) {
    const SDL_Surface* const surface = renderer.surface();
    REQUIRE(surface != nullptr);
    REQUIRE(surface->format == SDL_PIXELFORMAT_ARGB8888);
    REQUIRE(x >= 0 && x < surface->w);
    REQUIRE(y >= 0 && y < surface->h);
    const auto* const bytes = static_cast<const std::byte*>(surface->pixels);
    const auto* const row = reinterpret_cast<const std::uint32_t*>(
        bytes + static_cast<std::ptrdiff_t>(y) * surface->pitch
    );
    return row[x];
}

[[nodiscard]] cirvivor::render::FrameMetadata blackFrameMetadata() noexcept {
    cirvivor::render::FrameMetadata metadata;
    metadata.clearColor = cirvivor::render::PremultipliedRgba::opaque(
        0.0F,
        0.0F,
        0.0F
    );
    return metadata;
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

void testImplementedV2CommandsAreNotPlaceholderInstrumented() {
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

    std::array<std::uint8_t, 64> atlasPixels{};
    atlasPixels.fill(255U);
    const std::array atlasViews{
        Alpha8TextureResourceView{
            stableResourceId("placeholder/atlas"),
            1U,
            8U,
            8U,
            8U,
            atlasPixels
        }
    };
    const RenderResourcesView resources(atlasViews);
    REQUIRE(resources.isValid());

    SoftwareRenderer renderer;
    REQUIRE(!renderer.render(packet));
    REQUIRE(renderer.lastError() == SoftwareRenderError::missingGlyphAtlas);
    REQUIRE(renderer.render(packet, resources));
    REQUIRE(renderer.lastStats().submittedCommands == 9U);
    REQUIRE(renderer.lastStats().renderedCommands == 9U);
    // TexturedMesh와 Pass 4개만 placeholder이고 GlyphRun/Gradient/clip은
    // 실제 software 명령으로 처리한다.
    REQUIRE(renderer.lastStats().placeholderCommands == 5U);
    REQUIRE(renderer.lastStats().skippedCommands == 0U);
}

[[nodiscard]] bool buildGlyphContractPacket(
    cirvivor::render::FramePacket& packet,
    const cirvivor::render::ViewportState& viewport,
    const cirvivor::render::SamplingMode sampling,
    const bool applyClips,
    const std::uint32_t atlasPage = 0U
) {
    using namespace cirvivor::render;
    using namespace cirvivor::render::frontend;

    FrameMetadata metadata;
    metadata.clearColor = PremultipliedRgba::transparent();
    FramePacketBuilder builder(packet, PacketCapacityPolicy::fixedCapacity);
    if (!builder.begin(metadata, viewport)) {
        return false;
    }
    const CommandHeader header = makeHeader(
        RenderLayer::ui,
        0,
        CoordinateSpace::drawablePixels
    );
    ClipCommand clip;
    if (applyClips) {
        clip.header = header;
        clip.bounds = {0.0F, 0.0F, 4.0F, 2.0F};
        if (!builder.addClip(clip)) {
            return false;
        }
    }

    GlyphRunCommand run;
    run.header = header;
    run.fontId = stableResourceId("test/font");
    run.glyphAtlasId = stableResourceId("test/a8-atlas");
    run.origin = {0.0F, 0.0F};
    run.pixelsPerEm = 2.0F;
    run.weight = 400;
    run.color = applyClips
        ? PremultipliedRgba::fromStraight(1.0F, 0.5F, 0.25F, 0.5F)
        : PremultipliedRgba::opaque(1.0F, 0.0F, 0.0F);
    run.transform.elements = {
        2.0F, 0.0F, 0.0F,
        0.0F, 2.0F, 0.0F,
        0.0F, 0.0F, 1.0F
    };
    run.sampling = sampling;
    if (applyClips) {
        run.clipEnabled = 1U;
        run.clipBounds = {1.0F, 0.0F, 1.0F, 2.0F};
    }
    const std::array glyphs{
        GlyphInstance{1U, atlasPage, {}, {}, {}, {0.0F, 0.0F, 1.0F, 1.0F}}
    };
    if (!builder.addGlyphRun(run, glyphs)) {
        return false;
    }
    if (applyClips) {
        clip.operation = ClipOperation::pop;
        clip.bounds = {};
        if (!builder.addClip(clip)) {
            return false;
        }
    }
    return builder.finish();
}

void testGlyphA8SamplingPmaTransformClipAndResources() {
    using namespace cirvivor::render;
    using namespace cirvivor::render::frontend;
    using namespace cirvivor::render::software;

    SyntheticSceneConfig config;
    config.physicalDisplaySize = {4, 4};
    config.physicalWindowBounds = {0, 0, 4, 4};
    config.drawableSize = {4, 4};
    const ViewportState viewport = makeSyntheticViewport(config);
    constexpr ResourceId atlasId = stableResourceId("test/a8-atlas");

    FramePacketCapacity clippedCapacity;
    clippedCapacity.commandCount = 3U;
    clippedCapacity.glyphRunCount = 1U;
    clippedCapacity.glyphInstanceCount = 1U;
    clippedCapacity.clipCount = 2U;
    FramePacket clippedPacket(clippedCapacity);
    REQUIRE(buildGlyphContractPacket(
        clippedPacket,
        viewport,
        SamplingMode::nearest,
        true
    ));
    const std::array<std::uint8_t, 4> clippedAtlasPixels{200U, 64U, 128U, 255U};
    const std::array clippedAtlasViews{
        Alpha8TextureResourceView{atlasId, 3U, 2U, 2U, 2U, clippedAtlasPixels}
    };
    const RenderResourcesView clippedResources(clippedAtlasViews);
    REQUIRE(clippedResources.isValid());

    SoftwareRenderer clippedRenderer({4, 4});
    REQUIRE(clippedRenderer.render(clippedPacket, clippedResources));
    REQUIRE(clippedRenderer.lastStats().renderedCommands == 3U);
    REQUIRE(clippedRenderer.lastStats().placeholderCommands == 0U);
    REQUIRE(clippedRenderer.lastStats().skippedCommands == 0U);
    // Glyph-local clip은 왼쪽 절반을, clip stack은 아래쪽 절반을 제거한다.
    REQUIRE(pixelAt(clippedRenderer, 0, 0) == 0x0000'0000U);
    REQUIRE(pixelAt(clippedRenderer, 2, 0) == 0x2020'1008U);
    REQUIRE(pixelAt(clippedRenderer, 3, 1) == 0x2020'1008U);
    REQUIRE(pixelAt(clippedRenderer, 2, 2) == 0x0000'0000U);

    FramePacketCapacity linearCapacity;
    linearCapacity.commandCount = 1U;
    linearCapacity.glyphRunCount = 1U;
    linearCapacity.glyphInstanceCount = 1U;
    FramePacket linearPacket(linearCapacity);
    REQUIRE(buildGlyphContractPacket(
        linearPacket,
        viewport,
        SamplingMode::linear,
        false
    ));
    const std::array<std::uint8_t, 4> linearAtlasPixels{0U, 64U, 128U, 255U};
    const std::array linearAtlasViews{
        Alpha8TextureResourceView{atlasId, 4U, 2U, 2U, 2U, linearAtlasPixels}
    };
    const RenderResourcesView linearResources(linearAtlasViews);
    SoftwareRenderer linearRenderer({4, 4});
    REQUIRE(linearRenderer.render(linearPacket, linearResources));
    REQUIRE(pixelAt(linearRenderer, 0, 0) == 0x0000'0000U);
    REQUIRE(pixelAt(linearRenderer, 1, 1) == 0x3434'0000U);
    REQUIRE(pixelAt(linearRenderer, 2, 2) == 0xb3b3'0000U);
    REQUIRE(pixelAt(linearRenderer, 3, 3) == 0xffff'0000U);

    bool allRendered = true;
    std::size_t allocations = 0U;
    {
        AllocationScope scope;
        for (std::size_t index = 0U; index < 32U; ++index) {
            allRendered = linearRenderer.render(linearPacket, linearResources)
                && allRendered;
        }
        allocations = scope.allocationCount();
    }
    REQUIRE(allRendered);
    REQUIRE(allocations == 0U);

    const std::array invalidViews{
        Alpha8TextureResourceView{atlasId, 4U, 2U, 2U, 1U, linearAtlasPixels}
    };
    REQUIRE(!linearRenderer.render(linearPacket, RenderResourcesView(invalidViews)));
    REQUIRE(linearRenderer.lastError() == SoftwareRenderError::invalidResources);

    FramePacket invalidReferencePacket(linearCapacity);
    REQUIRE(buildGlyphContractPacket(
        invalidReferencePacket,
        viewport,
        SamplingMode::nearest,
        false,
        1U
    ));
    REQUIRE(!linearRenderer.render(invalidReferencePacket, linearResources));
    REQUIRE(linearRenderer.lastError()
        == SoftwareRenderError::invalidGlyphAtlasReference);
}

[[nodiscard]] bool buildGradientContractPacket(
    cirvivor::render::FramePacket& packet,
    const cirvivor::render::ViewportState& viewport
) {
    using namespace cirvivor::render;
    using namespace cirvivor::render::frontend;

    FramePacketBuilder builder(packet, PacketCapacityPolicy::fixedCapacity);
    if (!builder.begin(blackFrameMetadata(), viewport)) {
        return false;
    }
    const std::array stops{
        GradientStop{0.0F, PremultipliedRgba::opaque(1.0F, 0.0F, 0.0F)},
        GradientStop{1.0F, PremultipliedRgba::opaque(0.0F, 0.0F, 1.0F)}
    };
    for (std::uint32_t row = 0U; row < 3U; ++row) {
        GradientCommand gradient;
        gradient.header = makeHeader(
            RenderLayer::background,
            0,
            CoordinateSpace::drawablePixels
        );
        gradient.spread = static_cast<GradientSpread>(row);
        gradient.bounds = {0.0F, static_cast<float>(row), 12.0F, 1.0F};
        gradient.start = {4.0F, 0.0F};
        gradient.end = {8.0F, 0.0F};
        if (!builder.addGradient(gradient, stops)) {
            return false;
        }
    }

    GradientCommand radial;
    radial.header = makeHeader(
        RenderLayer::background,
        0,
        CoordinateSpace::drawablePixels
    );
    radial.type = GradientType::radial;
    radial.bounds = {0.0F, 3.0F, 8.0F, 8.0F};
    radial.start = {4.0F, 7.0F};
    radial.end = radial.start;
    radial.endRadius = 4.0F;
    if (!builder.addGradient(radial, stops)) {
        return false;
    }

    GradientCommand transformed;
    transformed.header = makeHeader(
        RenderLayer::background,
        0,
        CoordinateSpace::drawablePixels
    );
    transformed.bounds = {0.0F, 0.0F, 4.0F, 2.0F};
    transformed.start = {0.0F, 0.0F};
    transformed.end = {4.0F, 0.0F};
    transformed.transform.elements = {
        1.0F, 0.0F, 8.0F,
        0.0F, 1.0F, 3.0F,
        0.0F, 0.0F, 1.0F
    };
    const std::array translucentStops{
        GradientStop{
            0.0F,
            PremultipliedRgba::fromStraight(1.0F, 0.0F, 0.0F, 0.5F)
        },
        GradientStop{
            1.0F,
            PremultipliedRgba::fromStraight(0.0F, 0.0F, 1.0F, 0.5F)
        }
    };
    if (!builder.addGradient(transformed, translucentStops)) {
        return false;
    }

    GradientCommand hardStop;
    hardStop.header = transformed.header;
    hardStop.bounds = {8.0F, 5.0F, 3.0F, 1.0F};
    hardStop.start = {8.0F, 5.0F};
    hardStop.end = {11.0F, 5.0F};
    const std::array hardStops{
        GradientStop{0.0F, PremultipliedRgba::opaque(1.0F, 0.0F, 0.0F)},
        GradientStop{0.5F, PremultipliedRgba::opaque(1.0F, 0.0F, 0.0F)},
        GradientStop{0.5F, PremultipliedRgba::opaque(0.0F, 0.0F, 1.0F)},
        GradientStop{1.0F, PremultipliedRgba::opaque(0.0F, 1.0F, 0.0F)}
    };
    return builder.addGradient(hardStop, hardStops) && builder.finish();
}

void testGradientTypesSpreadsTransformAndPma() {
    using namespace cirvivor::render;
    using namespace cirvivor::render::frontend;
    using namespace cirvivor::render::software;

    SyntheticSceneConfig config;
    config.physicalDisplaySize = {12, 11};
    config.physicalWindowBounds = {0, 0, 12, 11};
    config.drawableSize = {12, 11};

    FramePacketCapacity capacity;
    capacity.commandCount = 6U;
    capacity.gradientCount = 6U;
    capacity.gradientStopCount = 14U;
    FramePacket packet(capacity);
    REQUIRE(buildGradientContractPacket(packet, makeSyntheticViewport(config)));

    SoftwareRenderer renderer({12, 11});
    REQUIRE(renderer.render(packet));
    REQUIRE(renderer.lastStats().submittedCommands == 6U);
    REQUIRE(renderer.lastStats().renderedCommands == 6U);
    REQUIRE(renderer.lastStats().placeholderCommands == 0U);
    REQUIRE(renderer.lastStats().skippedCommands == 0U);

    REQUIRE(pixelAt(renderer, 0, 0) == 0xffff'0000U);
    REQUIRE(pixelAt(renderer, 10, 0) == 0xff00'00ffU);
    REQUIRE(pixelAt(renderer, 0, 1) == 0xffdf'0020U);
    REQUIRE(pixelAt(renderer, 10, 1) == 0xff60'009fU);
    REQUIRE(pixelAt(renderer, 0, 2) == 0xff20'00dfU);
    REQUIRE(pixelAt(renderer, 10, 2) == 0xff9f'0060U);
    REQUIRE(pixelAt(renderer, 3, 6) == 0xffd2'002dU);
    REQUIRE(pixelAt(renderer, 3, 6) == pixelAt(renderer, 4, 6));
    REQUIRE(pixelAt(renderer, 0, 3) == 0xff00'00ffU);
    REQUIRE(pixelAt(renderer, 8, 3) == 0xff70'0010U);
    REQUIRE(pixelAt(renderer, 7, 3) != pixelAt(renderer, 8, 3));
    REQUIRE(pixelAt(renderer, 8, 5) == 0xffff'0000U);
    REQUIRE(pixelAt(renderer, 9, 5) == 0xff00'00ffU);
    REQUIRE_U64(renderer.pixelHash(), 0x6e75'2eb9'ea99'e6d9ULL);
}

[[nodiscard]] bool buildNestedClipPacket(
    cirvivor::render::FramePacket& packet,
    const cirvivor::render::ViewportState& viewport
) {
    using namespace cirvivor::render;
    using namespace cirvivor::render::frontend;

    FramePacketBuilder builder(packet, PacketCapacityPolicy::fixedCapacity);
    if (!builder.begin(blackFrameMetadata(), viewport)) {
        return false;
    }
    const CommandHeader header = makeHeader(
        RenderLayer::ui,
        0,
        CoordinateSpace::drawablePixels
    );
    ClipCommand outer;
    outer.header = header;
    outer.bounds = {1.0F, 1.0F, 8.0F, 6.0F};
    if (!builder.addClip(outer)) {
        return false;
    }
    ShapeCommand red;
    red.header = header;
    red.bounds = {0.0F, 0.0F, 10.0F, 8.0F};
    red.fill = PremultipliedRgba::opaque(1.0F, 0.0F, 0.0F);
    if (!builder.addShape(red)) {
        return false;
    }

    ClipCommand inner = outer;
    inner.operation = ClipOperation::pushRoundedRect;
    inner.bounds = {0.0F, 0.0F, 4.0F, 4.0F};
    inner.cornerRadius = 2.0F;
    inner.transform.elements = {
        1.0F, 0.0F, 3.0F,
        0.0F, 1.0F, 2.0F,
        0.0F, 0.0F, 1.0F
    };
    if (!builder.addClip(inner)) {
        return false;
    }
    ShapeCommand green = red;
    green.fill = PremultipliedRgba::opaque(0.0F, 1.0F, 0.0F);
    if (!builder.addShape(green)) {
        return false;
    }
    ClipCommand pop = inner;
    pop.operation = ClipOperation::pop;
    pop.antialias = 0U;
    pop.bounds = {};
    pop.cornerRadius = 0.0F;
    if (!builder.addClip(pop)) {
        return false;
    }
    ShapeCommand blue = red;
    blue.bounds = {1.0F, 1.0F, 2.0F, 2.0F};
    blue.fill = PremultipliedRgba::opaque(0.0F, 0.0F, 1.0F);
    if (!builder.addShape(blue) || !builder.addClip(pop)) {
        return false;
    }
    ShapeCommand yellow = red;
    yellow.bounds = {0.0F, 0.0F, 1.0F, 1.0F};
    yellow.fill = PremultipliedRgba::opaque(1.0F, 1.0F, 0.0F);
    return builder.addShape(yellow) && builder.finish();
}

void testNestedClipIntersectionAndPopReset() {
    using namespace cirvivor::render;
    using namespace cirvivor::render::frontend;
    using namespace cirvivor::render::software;

    SyntheticSceneConfig config;
    config.physicalDisplaySize = {10, 8};
    config.physicalWindowBounds = {0, 0, 10, 8};
    config.drawableSize = {10, 8};
    FramePacketCapacity capacity;
    capacity.commandCount = 8U;
    capacity.shapeCount = 4U;
    capacity.clipCount = 4U;
    FramePacket packet(capacity);
    REQUIRE(buildNestedClipPacket(packet, makeSyntheticViewport(config)));

    SoftwareRenderer renderer({10, 8});
    REQUIRE(renderer.render(packet));
    REQUIRE(renderer.lastStats().placeholderCommands == 0U);
    REQUIRE(renderer.lastStats().renderedCommands == 8U);
    REQUIRE(pixelAt(renderer, 0, 0) == 0xffff'ff00U);
    REQUIRE(pixelAt(renderer, 1, 1) == 0xff00'00ffU);
    REQUIRE(pixelAt(renderer, 2, 5) == 0xffff'0000U);
    REQUIRE(pixelAt(renderer, 3, 2) == 0xffff'0000U);
    REQUIRE(pixelAt(renderer, 4, 3) == 0xff00'ff00U);
    REQUIRE(pixelAt(renderer, 9, 7) == 0xff00'0000U);
    REQUIRE_U64(renderer.pixelHash(), 0xfb99'ad6b'7d61'08d1ULL);
}

void testRoundedClipAntialiasPreservesPmaCoverage() {
    using namespace cirvivor::render;
    using namespace cirvivor::render::frontend;
    using namespace cirvivor::render::software;

    SyntheticSceneConfig config;
    config.physicalDisplaySize = {4, 4};
    config.physicalWindowBounds = {0, 0, 4, 4};
    config.drawableSize = {4, 4};
    FramePacketCapacity capacity;
    capacity.commandCount = 3U;
    capacity.shapeCount = 1U;
    capacity.clipCount = 2U;
    FramePacket packet(capacity);
    FrameMetadata metadata;
    metadata.clearColor = PremultipliedRgba::transparent();
    FramePacketBuilder builder(packet, PacketCapacityPolicy::fixedCapacity);
    REQUIRE(builder.begin(metadata, makeSyntheticViewport(config)));
    const CommandHeader header = makeHeader(
        RenderLayer::ui,
        0,
        CoordinateSpace::drawablePixels
    );
    ClipCommand clip;
    clip.header = header;
    clip.operation = ClipOperation::pushRoundedRect;
    clip.antialias = 1U;
    clip.bounds = {0.0F, 0.0F, 4.0F, 4.0F};
    clip.cornerRadius = 2.0F;
    REQUIRE(builder.addClip(clip));
    ShapeCommand shape;
    shape.header = header;
    shape.header.blendMode = BlendMode::opaque;
    shape.bounds = clip.bounds;
    shape.fill = PremultipliedRgba::opaque(1.0F, 1.0F, 1.0F);
    REQUIRE(builder.addShape(shape));
    clip.operation = ClipOperation::pop;
    clip.antialias = 0U;
    clip.bounds = {};
    clip.cornerRadius = 0.0F;
    REQUIRE(builder.addClip(clip));
    REQUIRE(builder.finish());

    SoftwareRenderer renderer({4, 4});
    REQUIRE(renderer.render(packet));
    const std::uint32_t corner = pixelAt(renderer, 0, 0);
    const std::uint32_t cornerAlpha = corner >> 24U;
    REQUIRE(cornerAlpha == 96U);
    REQUIRE(((corner >> 16U) & 0xffU) == cornerAlpha);
    REQUIRE(((corner >> 8U) & 0xffU) == cornerAlpha);
    REQUIRE((corner & 0xffU) == cornerAlpha);
    REQUIRE(pixelAt(renderer, 1, 1) == 0xffff'ffffU);
    REQUIRE_U64(renderer.pixelHash(), 0xa9b3'66a3'1f51'9175ULL);
}

void testPartialClipCoverageInterpolatesOpaqueBlendResult() {
    using namespace cirvivor::render;
    using namespace cirvivor::render::frontend;
    using namespace cirvivor::render::software;

    SyntheticSceneConfig config;
    config.physicalDisplaySize = {4, 4};
    config.physicalWindowBounds = {0, 0, 4, 4};
    config.drawableSize = {4, 4};
    FramePacketCapacity capacity;
    capacity.commandCount = 3U;
    capacity.shapeCount = 1U;
    capacity.clipCount = 2U;
    FramePacket packet(capacity);
    FrameMetadata metadata;
    metadata.clearColor = PremultipliedRgba::opaque(
        32.0F / 255.0F,
        64.0F / 255.0F,
        96.0F / 255.0F
    );
    FramePacketBuilder builder(packet, PacketCapacityPolicy::fixedCapacity);
    REQUIRE(builder.begin(metadata, makeSyntheticViewport(config)));
    const CommandHeader header = makeHeader(
        RenderLayer::ui,
        0,
        CoordinateSpace::drawablePixels
    );
    ClipCommand clip;
    clip.header = header;
    clip.operation = ClipOperation::pushRoundedRect;
    clip.antialias = 1U;
    clip.bounds = {0.0F, 0.0F, 4.0F, 4.0F};
    clip.cornerRadius = 2.0F;
    REQUIRE(builder.addClip(clip));
    ShapeCommand shape;
    shape.header = header;
    shape.header.blendMode = BlendMode::opaque;
    shape.bounds = clip.bounds;
    shape.fill = PremultipliedRgba::fromStraight(1.0F, 0.0F, 0.0F, 0.5F);
    REQUIRE(builder.addShape(shape));
    clip.operation = ClipOperation::pop;
    clip.antialias = 0U;
    clip.bounds = {};
    clip.cornerRadius = 0.0F;
    REQUIRE(builder.addClip(clip));
    REQUIRE(builder.finish());

    SoftwareRenderer renderer({4, 4});
    REQUIRE(renderer.render(packet));
    REQUIRE(pixelAt(renderer, 0, 0) == 0xcf44'283cU);
    REQUIRE(pixelAt(renderer, 1, 1) == 0x8080'0000U);
}

void testHardClipRemainsCenterSampledInsideAaClip() {
    using namespace cirvivor::render;
    using namespace cirvivor::render::frontend;
    using namespace cirvivor::render::software;

    SyntheticSceneConfig config;
    config.physicalDisplaySize = {4, 4};
    config.physicalWindowBounds = {0, 0, 4, 4};
    config.drawableSize = {4, 4};
    FramePacketCapacity capacity;
    capacity.commandCount = 5U;
    capacity.shapeCount = 1U;
    capacity.clipCount = 4U;
    FramePacket packet(capacity);
    FrameMetadata metadata;
    metadata.clearColor = PremultipliedRgba::transparent();
    FramePacketBuilder builder(packet, PacketCapacityPolicy::fixedCapacity);
    REQUIRE(builder.begin(metadata, makeSyntheticViewport(config)));
    const CommandHeader header = makeHeader(
        RenderLayer::ui,
        0,
        CoordinateSpace::drawablePixels
    );
    ClipCommand antialiasedClip;
    antialiasedClip.header = header;
    antialiasedClip.operation = ClipOperation::pushRoundedRect;
    antialiasedClip.antialias = 1U;
    antialiasedClip.bounds = {0.0F, 0.0F, 4.0F, 4.0F};
    antialiasedClip.cornerRadius = 0.0F;
    REQUIRE(builder.addClip(antialiasedClip));
    ClipCommand hardClip;
    hardClip.header = header;
    hardClip.operation = ClipOperation::pushScissor;
    hardClip.antialias = 0U;
    hardClip.bounds = {0.4F, 0.0F, 3.6F, 4.0F};
    REQUIRE(builder.addClip(hardClip));
    ShapeCommand shape;
    shape.header = header;
    shape.header.blendMode = BlendMode::opaque;
    shape.bounds = antialiasedClip.bounds;
    shape.fill = PremultipliedRgba::opaque(1.0F, 1.0F, 1.0F);
    REQUIRE(builder.addShape(shape));
    hardClip.operation = ClipOperation::pop;
    hardClip.bounds = {};
    REQUIRE(builder.addClip(hardClip));
    REQUIRE(builder.addClip(hardClip));
    REQUIRE(builder.finish());

    SoftwareRenderer renderer({4, 4});
    REQUIRE(renderer.render(packet));
    REQUIRE(pixelAt(renderer, 0, 1) == 0xffff'ffffU);
    REQUIRE(pixelAt(renderer, 3, 1) == 0xffff'ffffU);
}

void testHomogeneousScaleEquivalentGradientTransform() {
    using namespace cirvivor::render;
    using namespace cirvivor::render::frontend;
    using namespace cirvivor::render::software;

    SyntheticSceneConfig config;
    config.physicalDisplaySize = {4, 1};
    config.physicalWindowBounds = {0, 0, 4, 1};
    config.drawableSize = {4, 1};
    const ViewportState viewport = makeSyntheticViewport(config);
    FramePacketCapacity capacity;
    capacity.commandCount = 1U;
    capacity.gradientCount = 1U;
    capacity.gradientStopCount = 2U;
    FramePacket identityPacket(capacity);
    FramePacket scaledPacket(capacity);
    const auto buildPacket = [&viewport](
        FramePacket& packet,
        const Mat3F transform
    ) {
        FramePacketBuilder builder(packet, PacketCapacityPolicy::fixedCapacity);
        if (!builder.begin(blackFrameMetadata(), viewport)) {
            return false;
        }
        GradientCommand gradient;
        gradient.header = makeHeader(
            RenderLayer::ui,
            0,
            CoordinateSpace::drawablePixels
        );
        gradient.bounds = {0.0F, 0.0F, 4.0F, 1.0F};
        gradient.start = {0.0F, 0.0F};
        gradient.end = {4.0F, 0.0F};
        gradient.transform = transform;
        const std::array stops{
            GradientStop{0.0F, PremultipliedRgba::opaque(1.0F, 0.0F, 0.0F)},
            GradientStop{1.0F, PremultipliedRgba::opaque(0.0F, 0.0F, 1.0F)}
        };
        return builder.addGradient(gradient, stops) && builder.finish();
    };
    Mat3F scaledTransform;
    scaledTransform.elements = {
        1.0e-5F, 0.0F, 0.0F,
        0.0F, 1.0e-5F, 0.0F,
        0.0F, 0.0F, 1.0e-5F
    };
    REQUIRE(buildPacket(identityPacket, Mat3F{}));
    REQUIRE(buildPacket(scaledPacket, scaledTransform));

    SoftwareRenderer identityRenderer({4, 1});
    SoftwareRenderer scaledRenderer({4, 1});
    REQUIRE(identityRenderer.render(identityPacket));
    REQUIRE(scaledRenderer.render(scaledPacket));
    REQUIRE(scaledRenderer.lastStats().skippedCommands == 0U);
    REQUIRE(pixelAt(scaledRenderer, 0, 0) == 0xffdf'0020U);
    REQUIRE(pixelAt(scaledRenderer, 3, 0) == 0xff20'00dfU);
    REQUIRE(scaledRenderer.pixelHash() == identityRenderer.pixelHash());
}

[[nodiscard]] bool buildDprLetterboxClipPacket(
    cirvivor::render::FramePacket& packet,
    const cirvivor::render::ViewportState& viewport
) {
    using namespace cirvivor::render;
    using namespace cirvivor::render::frontend;

    FramePacketBuilder builder(packet, PacketCapacityPolicy::fixedCapacity);
    if (!builder.begin(blackFrameMetadata(), viewport)) {
        return false;
    }
    const CommandHeader header = makeHeader(RenderLayer::background);
    ClipCommand clip;
    clip.header = header;
    clip.bounds = {0.0F, 0.0F, 960.0F, 1'080.0F};
    if (!builder.addClip(clip)) {
        return false;
    }
    GradientCommand gradient;
    gradient.header = header;
    gradient.bounds = {0.0F, 0.0F, 1'920.0F, 1'080.0F};
    gradient.start = {0.0F, 0.0F};
    gradient.end = {1'920.0F, 0.0F};
    const std::array stops{
        GradientStop{0.0F, PremultipliedRgba::opaque(1.0F, 0.0F, 0.0F)},
        GradientStop{1.0F, PremultipliedRgba::opaque(0.0F, 0.0F, 1.0F)}
    };
    if (!builder.addGradient(gradient, stops)) {
        return false;
    }
    clip.operation = ClipOperation::pop;
    clip.bounds = {};
    return builder.addClip(clip) && builder.finish();
}

void testLogicalClipDprLetterboxAndNoHeapRender() {
    using namespace cirvivor::render;
    using namespace cirvivor::render::frontend;
    using namespace cirvivor::render::software;

    SyntheticSceneConfig config;
    config.physicalDisplaySize = {80, 36};
    config.physicalWindowBounds = {100, 50, 20, 9};
    config.drawableSize = {40, 18};
    config.dpiScale = 2.0F;
    const ViewportState viewport = makeSyntheticViewport(config);
    REQUIRE((viewport.drawable.contentRect == RectI{4, 0, 32, 18}));

    FramePacketCapacity capacity;
    capacity.commandCount = 3U;
    capacity.gradientCount = 1U;
    capacity.gradientStopCount = 2U;
    capacity.clipCount = 2U;
    FramePacket packet(capacity);
    REQUIRE(buildDprLetterboxClipPacket(packet, viewport));
    SoftwareRenderer renderer({20, 9});
    REQUIRE(renderer.render(packet));
    REQUIRE(pixelAt(renderer, 1, 4) == 0xff00'0000U);
    REQUIRE(pixelAt(renderer, 2, 4) == 0xfff7'0008U);
    REQUIRE(pixelAt(renderer, 9, 4) == 0xff87'0078U);
    REQUIRE(pixelAt(renderer, 10, 4) == 0xff00'0000U);
    REQUIRE(pixelAt(renderer, 18, 4) == 0xff00'0000U);

    bool allRendered = true;
    std::size_t allocations = 0U;
    {
        AllocationScope scope;
        for (std::size_t index = 0U; index < 32U; ++index) {
            allRendered = renderer.render(packet) && allRendered;
        }
        allocations = scope.allocationCount();
    }
    REQUIRE(allRendered);
    REQUIRE(allocations == 0U);
    REQUIRE_U64(renderer.pixelHash(), 0xdf05'eeb5'7217'8598ULL);
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
        TestCase{"v2 placeholder instrumentation", testImplementedV2CommandsAreNotPlaceholderInstrumented},
        TestCase{
            "glyph A8 sampling, PMA, transform, clip, and resources",
            testGlyphA8SamplingPmaTransformClipAndResources
        },
        TestCase{"gradient contracts", testGradientTypesSpreadsTransformAndPma},
        TestCase{"nested clip stack", testNestedClipIntersectionAndPopReset},
        TestCase{"rounded clip antialias", testRoundedClipAntialiasPreservesPmaCoverage},
        TestCase{
            "partial clip opaque blend coverage",
            testPartialClipCoverageInterpolatesOpaqueBlendResult
        },
        TestCase{
            "hard clip nested in antialias clip",
            testHardClipRemainsCenterSampledInsideAaClip
        },
        TestCase{
            "homogeneous-scale gradient transform",
            testHomogeneousScaleEquivalentGradientTransform
        },
        TestCase{"DPR letterbox clip and allocation", testLogicalClipDprLetterboxAndNoHeapRender},
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
