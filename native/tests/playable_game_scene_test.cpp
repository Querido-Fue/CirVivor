#include "game/game_system.h"
#include "render/frontend/playable_game_scene.h"

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
thread_local std::size_t count = 0;

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
    std::size_t start_ = 0;
};

template<typename T>
[[nodiscard]] bool spansEqual(
    const std::span<const T> first,
    const std::span<const T> second
) noexcept {
    return first.size() == second.size()
        && std::equal(first.begin(), first.end(), second.begin());
}

[[nodiscard]] float centerX(const cirvivor::render::ShapeCommand& shape) noexcept {
    return shape.bounds.x + shape.bounds.width * 0.5F;
}

void testCompactPlayableCommandContract() {
    using namespace cirvivor::render;
    using namespace cirvivor::render::frontend;

    cirvivor::game::GameSystem gameSystem;
    constexpr FramePacketCapacity expectedCapacity{
        94,
        0,
        70,
        24,
        0,
        0,
        0,
        0,
        0
    };
    const FramePacketCapacity capacity = playableGameSceneCapacity(gameSystem);
    REQUIRE(capacity == expectedCapacity);
    REQUIRE(capacity.commandCount <= 150U);

    FramePacket packet(capacity);
    const PlayableGameSceneResult result = buildPlayableGameScene(
        packet,
        gameSystem,
        {},
        PacketCapacityPolicy::fixedCapacity
    );
    REQUIRE(result.success);
    REQUIRE(result.error == FrameBuildError::none);
    REQUIRE(packet.size() == expectedCapacity);
    REQUIRE(packet.isStructurallyValid());
    REQUIRE(packet.isRenderOrderValid());

    REQUIRE(packet.sprites().empty());
    REQUIRE(packet.textRuns().empty());
    REQUIRE(packet.effects().empty());
    REQUIRE(packet.ui().empty());
    REQUIRE(packet.overlays().empty());
    REQUIRE(packet.utf8Bytes().empty());
    REQUIRE(packet.shapes().front().header.coordinateSpace == CoordinateSpace::drawablePixels);
    REQUIRE(packet.shapes()[1].header.coordinateSpace == CoordinateSpace::world);
    REQUIRE(packet.shapes()[packet.shapes().size() - 2U].shape == ShapeType::roundedRectangle);
    REQUIRE(packet.shapes().back().shape == ShapeType::circle);
    REQUIRE(packet.lines().front().header.coordinateSpace == CoordinateSpace::world);
}

void testStableFixedCapacityBuildHasNoAllocations() {
    using namespace cirvivor::render;
    using namespace cirvivor::render::frontend;

    cirvivor::game::GameSystem gameSystem;
    PlayableGameSceneConfig config;
    config.frameId = 41;
    config.simulationTick = 73;
    config.presentationTimeSeconds = 1.25;
    config.interpolationAlpha = 0.375F;
    config.safeArea = {12, 18, 24, 30};

    FramePacket packet(playableGameSceneCapacity(gameSystem));
    REQUIRE(buildPlayableGameScene(
        packet,
        gameSystem,
        config,
        PacketCapacityPolicy::fixedCapacity
    ).success);
    const FramePacket snapshot = packet;
    const FramePacketCapacity reservedCapacity = packet.capacity();

    std::size_t allocations = 0;
    {
        AllocationScope allocationScope;
        for (int iteration = 0; iteration < 120; ++iteration) {
            const PlayableGameSceneResult result = buildPlayableGameScene(
                packet,
                gameSystem,
                config,
                PacketCapacityPolicy::fixedCapacity
            );
            REQUIRE(result.success);
        }
        allocations = allocationScope.count();
    }

    REQUIRE(allocations == 0U);
    REQUIRE(packet.capacity() == reservedCapacity);
    REQUIRE(packet.metadata() == snapshot.metadata());
    REQUIRE(packet.viewport() == snapshot.viewport());
    REQUIRE(spansEqual(packet.commandStream(), snapshot.commandStream()));
    REQUIRE(spansEqual(packet.shapes(), snapshot.shapes()));
    REQUIRE(spansEqual(packet.lines(), snapshot.lines()));
}

void testFixedCapacityFailureClearsPartialPacket() {
    using namespace cirvivor::render;
    using namespace cirvivor::render::frontend;

    cirvivor::game::GameSystem gameSystem;
    FramePacketCapacity insufficient = playableGameSceneCapacity(gameSystem);
    --insufficient.shapeCount;
    FramePacket packet(insufficient);
    const PlayableGameSceneResult result = buildPlayableGameScene(
        packet,
        gameSystem,
        {},
        PacketCapacityPolicy::fixedCapacity
    );
    REQUIRE(!result.success);
    REQUIRE(result.error == FrameBuildError::capacityExceeded);
    REQUIRE(packet.size() == FramePacketCapacity{});

    FramePacket empty;
    const PlayableGameSceneResult emptyResult = buildPlayableGameScene(
        empty,
        gameSystem,
        {},
        PacketCapacityPolicy::fixedCapacity
    );
    REQUIRE(!emptyResult.success);
    REQUIRE(emptyResult.error == FrameBuildError::capacityExceeded);
    REQUIRE(empty.size() == FramePacketCapacity{});
}

void testViewportAndInterpolatedTowerCoordinates() {
    using namespace cirvivor::render;
    using namespace cirvivor::render::frontend;

    cirvivor::game::GameSystem gameSystem;
    PlayableGameSceneConfig wide;
    wide.physicalDisplaySize = {3'440, 1'440};
    wide.physicalWindowBounds = {20, 30, 1'720, 720};
    wide.drawableSize = {3'440, 1'440};
    wide.safeArea = {80, 40, 120, 60};
    wide.dpiScale = 2.0F;
    wide.worldRenderScale = 0.75F;
    wide.projectionRevision = 17;
    const ViewportState wideViewport = makePlayableGameViewport(gameSystem, wide);
    REQUIRE(wideViewport.physical.dpiScale == 2.0F);
    REQUIRE(wideViewport.drawable.contentRect == (RectI{440, 0, 2'560, 1'440}));
    REQUIRE(wideViewport.drawable.safeArea == (InsetsI{0, 40, 0, 60}));
    REQUIRE(wideViewport.drawable.worldRenderTargetSize == (SizeI{2'580, 1'080}));
    REQUIRE_NEAR(wideViewport.logicalUi.safeArea.top, 30.0F, 1.0e-4F);
    REQUIRE_NEAR(wideViewport.logicalUi.safeArea.bottom, 45.0F, 1.0e-4F);
    REQUIRE_NEAR(wideViewport.world.drawablePixelsPerWorldUnit, 33.6F, 1.0e-4F);
    REQUIRE(wideViewport.world.projectionRevision == 17U);

    PlayableGameSceneConfig compact;
    compact.drawableSize = {960, 540};
    compact.physicalDisplaySize = compact.drawableSize;
    compact.physicalWindowBounds = {0, 0, 960, 540};
    const ViewportState compactViewport = makePlayableGameViewport(gameSystem, compact);
    REQUIRE(compactViewport.world.drawablePixelsPerWorldUnit
        < wideViewport.world.drawablePixelsPerWorldUnit);

    REQUIRE(gameSystem.fixedUpdate({.moveRight = true}).tileProbeCount > 0U);
    FramePacket previousPacket(playableGameSceneCapacity(gameSystem));
    FramePacket currentPacket(playableGameSceneCapacity(gameSystem));
    PlayableGameSceneConfig previousConfig = compact;
    previousConfig.interpolationAlpha = 0.0F;
    PlayableGameSceneConfig currentConfig = compact;
    currentConfig.interpolationAlpha = 1.0F;
    REQUIRE(buildPlayableGameScene(
        previousPacket,
        gameSystem,
        previousConfig,
        PacketCapacityPolicy::fixedCapacity
    ).success);
    REQUIRE(buildPlayableGameScene(
        currentPacket,
        gameSystem,
        currentConfig,
        PacketCapacityPolicy::fixedCapacity
    ).success);

    const ShapeCommand& previousCore = previousPacket.shapes()[previousPacket.shapes().size() - 2U];
    const ShapeCommand& currentCore = currentPacket.shapes()[currentPacket.shapes().size() - 2U];
    const ShapeCommand& previousTower = previousPacket.shapes().back();
    const ShapeCommand& currentTower = currentPacket.shapes().back();
    REQUIRE(previousCore.bounds == currentCore.bounds);
    REQUIRE_NEAR(centerX(previousTower), 45.0F, 1.0e-5F);
    REQUIRE(centerX(currentTower) > centerX(previousTower));

    PlayableGameSceneConfig followedPrevious = previousConfig;
    followedPrevious.cameraZoom = 1.2F;
    PlayableGameSceneConfig followedCurrent = currentConfig;
    followedCurrent.cameraZoom = 1.2F;
    const ViewportState previousFollowViewport = makePlayableGameViewport(
        gameSystem,
        followedPrevious
    );
    const ViewportState currentFollowViewport = makePlayableGameViewport(
        gameSystem,
        followedCurrent
    );
    REQUIRE(currentFollowViewport.world.worldToDrawable.elements[2]
        < previousFollowViewport.world.worldToDrawable.elements[2]);

    PlayableGameSceneConfig clamped = compact;
    clamped.interpolationAlpha = 2.0F;
    clamped.presentationTimeSeconds = std::numeric_limits<double>::quiet_NaN();
    clamped.simulationTick = 10;
    FramePacket clampedPacket(playableGameSceneCapacity(gameSystem));
    REQUIRE(buildPlayableGameScene(
        clampedPacket,
        gameSystem,
        clamped,
        PacketCapacityPolicy::fixedCapacity
    ).success);
    REQUIRE(clampedPacket.metadata().interpolationAlpha == 1.0F);
    REQUIRE(clampedPacket.metadata().presentationTimeSeconds > 0.0);
}

struct TestCase final {
    std::string_view name;
    void (*run)();
};

} // namespace

int main() {
    const std::array tests{
        TestCase{"compact playable command contract", testCompactPlayableCommandContract},
        TestCase{"stable fixed-capacity build", testStableFixedCapacityBuildHasNoAllocations},
        TestCase{"capacity failure transaction", testFixedCapacityFailureClearsPartialPacket},
        TestCase{"viewport and interpolation", testViewportAndInterpolatedTowerCoordinates}
    };

    std::size_t passed = 0;
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
