#include "core/physics/body_soa.h"
#include "core/physics/tile_collision_solver.h"
#include "core/state_hash/canonical_state_hasher.h"
#include "core/world/tile_map.h"

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <exception>
#include <iostream>
#include <limits>
#include <new>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace allocation_tracking {

thread_local bool enabled = false;
thread_local std::size_t allocationCount = 0;

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
            + " (actual=" + std::to_string(actual)
            + ", expected=" + std::to_string(expected) + ')'
        );
    }
}

#define REQUIRE(expression) require((expression), #expression, __FILE__, __LINE__)
#define REQUIRE_NEAR(actual, expected, tolerance) \
    requireNear((actual), (expected), (tolerance), #actual " ~= " #expected, __FILE__, __LINE__)

class TickAllocationScope final {
public:
    TickAllocationScope() noexcept
        : startCount_(allocation_tracking::allocationCount) {
        allocation_tracking::enabled = true;
    }

    TickAllocationScope(const TickAllocationScope&) = delete;
    TickAllocationScope& operator=(const TickAllocationScope&) = delete;

    ~TickAllocationScope() {
        allocation_tracking::enabled = false;
    }

    [[nodiscard]] std::size_t allocationCount() const noexcept {
        return allocation_tracking::allocationCount - startCount_;
    }

private:
    std::size_t startCount_ = 0;
};

[[nodiscard]] std::array<char, 16> hashHex(const std::uint64_t hash) noexcept {
    constexpr std::array<char, 16> digits{
        '0', '1', '2', '3', '4', '5', '6', '7',
        '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'
    };
    std::array<char, 16> result{};
    for (std::size_t index = 0; index < result.size(); ++index) {
        const std::size_t shift = (result.size() - index - 1U) * 4U;
        result[index] = digits[static_cast<std::size_t>((hash >> shift) & 0x0fU)];
    }
    return result;
}

void appendVector(
    cirvivor::core::CanonicalStateHasher64& hasher,
    const cirvivor::core::Vector2 vector
) {
    hasher.beginObject(2);
    hasher.appendObjectKey("x");
    hasher.appendNumber(vector.x);
    hasher.appendObjectKey("y");
    hasher.appendNumber(vector.y);
    hasher.endObject();
}

[[nodiscard]] std::uint64_t hashStressState(
    const cirvivor::core::BodySoA& bodies,
    const std::vector<std::string>& participantIds,
    const int tick
) {
    cirvivor::core::CanonicalStateHasher64 hasher;
    hasher.beginObject(2);
    hasher.appendObjectKey("participants");
    hasher.beginArray(bodies.size());
    for (std::size_t index = 0; index < bodies.size(); ++index) {
        hasher.beginObject(4);
        hasher.appendObjectKey("participantId");
        hasher.appendString(participantIds[index]);
        hasher.appendObjectKey("position");
        appendVector(hasher, bodies.position(index));
        hasher.appendObjectKey("previousPosition");
        appendVector(hasher, bodies.previousPosition(index));
        hasher.appendObjectKey("velocity");
        appendVector(hasher, bodies.velocity(index));
        hasher.endObject();
    }
    hasher.endArray();
    hasher.appendObjectKey("tick");
    hasher.appendNumber(static_cast<double>(tick));
    hasher.endObject();
    return hasher.value();
}

[[nodiscard]] std::string makeParticipantId(const std::size_t index) {
    std::string result = "movement-circle-";
    result.push_back(static_cast<char>('0' + ((index / 1'000U) % 10U)));
    result.push_back(static_cast<char>('0' + ((index / 100U) % 10U)));
    result.push_back(static_cast<char>('0' + ((index / 10U) % 10U)));
    result.push_back(static_cast<char>('0' + (index % 10U)));
    return result;
}

void testBodySoAMatchesProductionPrimitiveContracts() {
    cirvivor::core::BodySoA bodies(3);
    const auto dynamic = bodies.addBody({
        .type = cirvivor::core::PhysicsBodyType::dynamic,
        .x = 2.0,
        .y = 3.0,
        .mass = 2.0,
        .linearFriction = 0.0,
        .sleepSpeed = 0.0,
        .maxLinearSpeed = 5.0
    });
    const auto kinematic = bodies.addBody({
        .type = cirvivor::core::PhysicsBodyType::kinematic,
        .x = 4.0,
        .y = 5.0
    });
    const auto staticBody = bodies.addBody({
        .type = cirvivor::core::PhysicsBodyType::staticBody
    });
    bodies.seal();

    REQUIRE(bodies.isSealed());
    REQUIRE(bodies.capacity() == 3U);
    REQUIRE_NEAR(bodies.mass(dynamic), 2.0, 0.0);
    REQUIRE_NEAR(bodies.inverseMass(dynamic), 0.5, 0.0);
    REQUIRE(std::isinf(bodies.mass(kinematic)));
    REQUIRE_NEAR(bodies.inverseMass(staticBody), 0.0, 0.0);

    REQUIRE(bodies.beginStep(dynamic));
    REQUIRE(!bodies.beginStep(dynamic));
    REQUIRE(bodies.addAcceleration(dynamic, 3.0, 4.0));
    REQUIRE(bodies.applyForce(dynamic, 2.0, 0.0));
    REQUIRE(bodies.integrate(dynamic, 0.5));
    REQUIRE_NEAR(bodies.velocity(dynamic).x, 2.0, 1.0e-15);
    REQUIRE_NEAR(bodies.velocity(dynamic).y, 2.0, 1.0e-15);
    REQUIRE_NEAR(bodies.position(dynamic).x, 3.0, 1.0e-15);
    REQUIRE_NEAR(bodies.position(dynamic).y, 4.0, 1.0e-15);
    REQUIRE_NEAR(bodies.previousPosition(dynamic).x, 2.0, 0.0);

    bodies.setVelocity(kinematic, 1.0, -2.0);
    REQUIRE(!bodies.addAcceleration(kinematic, 99.0, 99.0));
    REQUIRE(bodies.integrate(kinematic, 0.25));
    REQUIRE_NEAR(bodies.position(kinematic).x, 4.25, 0.0);
    REQUIRE_NEAR(bodies.position(kinematic).y, 4.5, 0.0);
    REQUIRE(!bodies.integrate(staticBody, 0.25));

    bool threw = false;
    try {
        static_cast<void>(bodies.addBody({}));
    } catch (const std::logic_error&) {
        threw = true;
    }
    REQUIRE(threw);
}

void testCorridorEightMapAndTileCorrection() {
    const cirvivor::core::TileMap map = cirvivor::core::TileMap::createCorridorEight();
    REQUIRE(map.rows() == 30);
    REQUIRE(map.columns() == 54);
    REQUIRE(map.spawnRouteWaypoints().size() == 25U);
    REQUIRE(map.isWalkableTile(0, 0));
    REQUIRE(!map.isWalkableTile(0, 6));
    REQUIRE(!map.isWalkableTile(-1, 0));
    REQUIRE_NEAR(map.spawnRouteWaypoints().front().x, 3.0, 0.0);
    REQUIRE_NEAR(map.spawnRouteWaypoints().back().x, 51.0, 0.0);
    REQUIRE_NEAR(map.spawnRouteWaypoints().back().y, 27.0, 0.0);

    cirvivor::core::BodySoA bodies(1);
    const auto body = bodies.addBody({
        .type = cirvivor::core::PhysicsBodyType::dynamic,
        .x = 5.75,
        .y = 3.0,
        .mass = 1.0,
        .maxLinearSpeed = 25.0
    });
    bodies.seal();
    bodies.setVelocity(body, 4.0, 0.0);
    const cirvivor::core::TileCollisionSolver solver;
    const auto stats = solver.resolve(bodies, body, 0.5, map);
    REQUIRE(stats.positionCorrectionCount == 1U);
    REQUIRE(stats.tileProbeCount > 0U);
    REQUIRE_NEAR(bodies.position(body).x, 5.5, 1.0e-15);
    REQUIRE_NEAR(bodies.velocity(body).x, 0.0, 1.0e-15);
}

struct StressSummary final {
    std::uint64_t initialStateHash = 0;
    std::uint64_t recordsDigest = 0;
    std::uint64_t finalStateHash = 0;
    std::size_t tileProbeCount = 0;
    std::size_t positionCorrectionCount = 0;
    std::size_t maximumTileProbesPerResolve = 0;
    std::size_t maximumPositionCorrectionsPerResolve = 0;
    std::size_t maximumTileProbesPerTick = 0;
    std::size_t maximumPositionCorrectionsPerTick = 0;
    std::size_t tickAllocationCount = 0;
    double maximumSpeed = 0.0;
    double p50Milliseconds = 0.0;
    double p95Milliseconds = 0.0;
    double p99Milliseconds = 0.0;
};

[[nodiscard]] StressSummary runMovementCollisionStress() {
    constexpr std::size_t participantCount = 800;
    constexpr int tickCount = 240;
    constexpr double deltaSeconds = 1.0 / 60.0;
    constexpr double acceleration = 78.0;
    constexpr double radius = 0.5;
    constexpr std::array<cirvivor::core::Vector2, 4> directions{{
        {1.0, 0.0}, {0.0, 1.0}, {-1.0, 0.0}, {0.0, -1.0}
    }};

    const cirvivor::core::TileMap map = cirvivor::core::TileMap::createCorridorEight();
    const auto waypoints = map.spawnRouteWaypoints();
    cirvivor::core::BodySoA bodies(participantCount);
    std::vector<std::string> participantIds;
    participantIds.reserve(participantCount);
    for (std::size_t index = 0; index < participantCount; ++index) {
        const cirvivor::core::Vector2 waypoint = waypoints[index % waypoints.size()];
        const std::size_t gridIndex = index / waypoints.size();
        const double columnOffset = static_cast<double>(
            static_cast<int>(gridIndex % 5U) - 2
        ) * 0.75;
        const double rowOffset = static_cast<double>(
            static_cast<int>((gridIndex / 5U) % 5U) - 2
        ) * 0.75;
        const auto bodyIndex = bodies.addBody({
            .type = cirvivor::core::PhysicsBodyType::dynamic,
            .x = waypoint.x + columnOffset,
            .y = waypoint.y + rowOffset,
            .mass = 1.0,
            .linearFriction = 10.0,
            .sleepSpeed = 1.0 / 96.0,
            .maxLinearSpeed = 25.0
        });
        REQUIRE(bodyIndex == index);
        participantIds.push_back(makeParticipantId(index));
    }
    bodies.seal();

    StressSummary summary;
    summary.initialStateHash = hashStressState(bodies, participantIds, -1);
    cirvivor::core::CanonicalStateHasher64 recordsHasher;
    recordsHasher.beginArray(static_cast<std::size_t>(tickCount));
    std::array<double, tickCount> tickMilliseconds{};
    const cirvivor::core::TileCollisionSolver solver;

    for (int tick = 0; tick < tickCount; ++tick) {
        const auto start = std::chrono::steady_clock::now();
        std::size_t tickTileProbes = 0;
        std::size_t tickCorrections = 0;
        std::size_t allocations = 0;
        {
            TickAllocationScope allocationScope;
            const std::size_t movementPhase = static_cast<std::size_t>(tick / 30);
            for (std::size_t index = 0; index < participantCount; ++index) {
                const cirvivor::core::Vector2 direction = directions[
                    (index + movementPhase) % directions.size()
                ];
                static_cast<void>(bodies.beginStep(index));
                static_cast<void>(bodies.addAcceleration(
                    index,
                    direction.x * acceleration,
                    direction.y * acceleration
                ));
                static_cast<void>(bodies.integrate(index, deltaSeconds));
                const auto resolveStats = solver.resolve(bodies, index, radius, map);
                tickTileProbes += resolveStats.tileProbeCount;
                tickCorrections += resolveStats.positionCorrectionCount;
                summary.maximumTileProbesPerResolve = std::max(
                    summary.maximumTileProbesPerResolve,
                    resolveStats.tileProbeCount
                );
                summary.maximumPositionCorrectionsPerResolve = std::max(
                    summary.maximumPositionCorrectionsPerResolve,
                    resolveStats.positionCorrectionCount
                );
                const cirvivor::core::Vector2 velocity = bodies.velocity(index);
                summary.maximumSpeed = std::max(
                    summary.maximumSpeed,
                    std::hypot(velocity.x, velocity.y)
                );
            }
            allocations = allocationScope.allocationCount();
        }
        const auto end = std::chrono::steady_clock::now();
        tickMilliseconds[static_cast<std::size_t>(tick)] =
            std::chrono::duration<double, std::milli>(end - start).count();
        summary.tickAllocationCount += allocations;
        summary.tileProbeCount += tickTileProbes;
        summary.positionCorrectionCount += tickCorrections;
        summary.maximumTileProbesPerTick = std::max(
            summary.maximumTileProbesPerTick,
            tickTileProbes
        );
        summary.maximumPositionCorrectionsPerTick = std::max(
            summary.maximumPositionCorrectionsPerTick,
            tickCorrections
        );

        const std::uint64_t stateHash = hashStressState(bodies, participantIds, tick);
        const std::array<char, 16> stateHashText = hashHex(stateHash);
        recordsHasher.beginObject(4);
        recordsHasher.appendObjectKey("positionCorrectionCount");
        recordsHasher.appendNumber(static_cast<double>(tickCorrections));
        recordsHasher.appendObjectKey("stateHash");
        recordsHasher.appendString({stateHashText.data(), stateHashText.size()});
        recordsHasher.appendObjectKey("tick");
        recordsHasher.appendNumber(static_cast<double>(tick));
        recordsHasher.appendObjectKey("tileProbeCount");
        recordsHasher.appendNumber(static_cast<double>(tickTileProbes));
        recordsHasher.endObject();
        summary.finalStateHash = stateHash;
    }
    recordsHasher.endArray();
    summary.recordsDigest = recordsHasher.value();

    std::sort(tickMilliseconds.begin(), tickMilliseconds.end());
    summary.p50Milliseconds = tickMilliseconds[119];
    summary.p95Milliseconds = tickMilliseconds[227];
    summary.p99Milliseconds = tickMilliseconds[237];
    return summary;
}

void testMovementCollisionStressMatchesJavaScriptOracle() {
    const StressSummary summary = runMovementCollisionStress();
    std::cout
        << "[INFO] stress hashes initial=" << std::hex << summary.initialStateHash
        << " records=" << summary.recordsDigest
        << " final=" << summary.finalStateHash << std::dec
        << " probes=" << summary.tileProbeCount
        << " corrections=" << summary.positionCorrectionCount
        << " max-probes/tick=" << summary.maximumTileProbesPerTick
        << " max-corrections/tick=" << summary.maximumPositionCorrectionsPerTick
        << " allocations=" << summary.tickAllocationCount << '\n';
    REQUIRE(summary.initialStateHash == 0x83ad'f889'c06a'6f90ULL);
    REQUIRE(summary.recordsDigest == 0x0f70'1c9e'a7ae'f6a2ULL);
    REQUIRE(summary.finalStateHash == 0xed12'9825'bfe9'2c12ULL);
    REQUIRE(summary.tileProbeCount == 796'220U);
    REQUIRE(summary.positionCorrectionCount == 7'055U);
    REQUIRE(summary.maximumTileProbesPerResolve == 8U);
    REQUIRE(summary.maximumPositionCorrectionsPerResolve == 1U);
    REQUIRE(summary.maximumTileProbesPerTick == 4'188U);
    REQUIRE(summary.maximumPositionCorrectionsPerTick == 247U);
    REQUIRE(summary.tickAllocationCount == 0U);
    REQUIRE_NEAR(summary.maximumSpeed, 7.747934030995142, 1.0e-12);

    std::cout
        << "[INFO] 800-body tick p50=" << summary.p50Milliseconds
        << " ms p95=" << summary.p95Milliseconds
        << " ms p99=" << summary.p99Milliseconds << " ms\n";
}

struct TestCase final {
    std::string_view name;
    void (*run)();
};

} // namespace

int main() {
    const std::array tests{
        TestCase{"BodySoA production primitive contract", testBodySoAMatchesProductionPrimitiveContracts},
        TestCase{"corridor-eight tile collision", testCorridorEightMapAndTileCorrection},
        TestCase{"800-body JS movement/collision parity", testMovementCollisionStressMatchesJavaScriptOracle}
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
