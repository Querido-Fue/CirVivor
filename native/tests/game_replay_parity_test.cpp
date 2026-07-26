#include "core/state_hash/canonical_state_hasher.h"
#include "core/state_hash/state_hasher.h"
#include "game/game_system.h"

#include <algorithm>
#include <array>
#include <bit>
#include <cmath>
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

#define REQUIRE(expression) require((expression), #expression, __FILE__, __LINE__)

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

void appendWorldPosition(
    cirvivor::core::CanonicalStateHasher64& hasher,
    const cirvivor::core::Vector2 position
) {
    hasher.beginObject(4);
    hasher.appendObjectKey("column");
    hasher.appendNumber(std::floor(position.x));
    hasher.appendObjectKey("row");
    hasher.appendNumber(std::floor(position.y));
    hasher.appendObjectKey("x");
    hasher.appendNumber(position.x);
    hasher.appendObjectKey("y");
    hasher.appendNumber(position.y);
    hasher.endObject();
}

[[nodiscard]] std::uint64_t hashStaticWorld(
    const cirvivor::core::TileMap& tileMap
) {
    cirvivor::core::StateHasher64 blockedHasher;
    std::size_t walkableTileCount = 0;
    for (int row = 0; row < tileMap.rows(); ++row) {
        for (int column = 0; column < tileMap.columns(); ++column) {
            const bool walkable = tileMap.isWalkableTile(row, column);
            walkableTileCount += walkable ? 1U : 0U;
            const std::byte blockedByte{static_cast<unsigned char>(walkable ? 0U : 1U)};
            blockedHasher.appendBytes({&blockedByte, 1U});
        }
    }
    const std::array<char, 16> blockedHashText = hashHex(blockedHasher.value());
    const std::span<const cirvivor::core::Vector2> waypoints =
        tileMap.spawnRouteWaypoints();
    const cirvivor::core::Vector2 corePosition = waypoints.back();
    const cirvivor::core::Vector2 towerPosition = waypoints[21];

    cirvivor::core::CanonicalStateHasher64 hasher;
    hasher.beginObject(6);
    hasher.appendObjectKey("corePosition");
    appendWorldPosition(hasher, corePosition);
    hasher.appendObjectKey("mapId");
    hasher.appendString(cirvivor::game::GameSystem::map_id);
    hasher.appendObjectKey("spawnRoutes");
    hasher.beginArray(1);
    hasher.beginObject(5);
    hasher.appendObjectKey("coreAttackPoint");
    appendWorldPosition(hasher, corePosition);
    hasher.appendObjectKey("entryPoint");
    appendWorldPosition(hasher, waypoints.front());
    hasher.appendObjectKey("gateId");
    hasher.appendString("west-gate-01");
    hasher.appendObjectKey("pathId");
    hasher.appendString("west-figure-eight-core");
    hasher.appendObjectKey("waypoints");
    hasher.beginArray(waypoints.size());
    for (const cirvivor::core::Vector2 waypoint : waypoints) {
        appendWorldPosition(hasher, waypoint);
    }
    hasher.endArray();
    hasher.endObject();
    hasher.endArray();
    hasher.appendObjectKey("tileGrid");
    hasher.beginObject(6);
    hasher.appendObjectKey("blockedBytesHash");
    hasher.appendString({blockedHashText.data(), blockedHashText.size()});
    hasher.appendObjectKey("cellSize");
    hasher.appendNumber(tileMap.tileSize());
    hasher.appendObjectKey("cols");
    hasher.appendNumber(static_cast<double>(tileMap.columns()));
    hasher.appendObjectKey("rows");
    hasher.appendNumber(static_cast<double>(tileMap.rows()));
    hasher.appendObjectKey("size");
    hasher.appendNumber(static_cast<double>(tileMap.rows() * tileMap.columns()));
    hasher.appendObjectKey("walkableTileCount");
    hasher.appendNumber(static_cast<double>(walkableTileCount));
    hasher.endObject();
    hasher.appendObjectKey("towerSpawnPosition");
    appendWorldPosition(hasher, towerPosition);
    hasher.appendObjectKey("worldBounds");
    hasher.beginObject(6);
    hasher.appendObjectKey("height");
    hasher.appendNumber(static_cast<double>(tileMap.rows()) * tileMap.tileSize());
    hasher.appendObjectKey("maxX");
    hasher.appendNumber(static_cast<double>(tileMap.columns()) * tileMap.tileSize());
    hasher.appendObjectKey("maxY");
    hasher.appendNumber(static_cast<double>(tileMap.rows()) * tileMap.tileSize());
    hasher.appendObjectKey("minX");
    hasher.appendNumber(0.0);
    hasher.appendObjectKey("minY");
    hasher.appendNumber(0.0);
    hasher.appendObjectKey("width");
    hasher.appendNumber(static_cast<double>(tileMap.columns()) * tileMap.tileSize());
    hasher.endObject();
    hasher.endObject();
    return hasher.value();
}

[[nodiscard]] cirvivor::game::MovementActionState actionsForTick(
    const int tick
) noexcept {
    if (tick < 72) {
        return {.moveRight = true};
    }
    if (tick < 132) {
        return {.moveDown = true};
    }
    if (tick < 192) {
        return {.moveDown = true, .moveLeft = true};
    }
    if (tick < 252) {
        return {.moveUp = true};
    }
    if (tick < 312) {
        return {};
    }
    if (tick < 342) {
        return {.moveUp = true, .moveLeft = true, .moveRight = true};
    }
    if (tick < 402) {
        return {.moveDown = true, .moveRight = true};
    }
    return {};
}

[[nodiscard]] std::uint64_t hashInputActions(
    const cirvivor::game::MovementActionState& actions
) {
    const std::size_t actionCount = static_cast<std::size_t>(actions.moveUp)
        + static_cast<std::size_t>(actions.moveDown)
        + static_cast<std::size_t>(actions.moveLeft)
        + static_cast<std::size_t>(actions.moveRight);
    cirvivor::core::CanonicalStateHasher64 hasher;
    hasher.beginObject(1);
    hasher.appendObjectKey("pressedActions");
    hasher.beginArray(actionCount);
    // JavaScript Array.sort() order for the four ASCII semantic IDs.
    if (actions.moveDown) {
        hasher.appendString("moveDown");
    }
    if (actions.moveLeft) {
        hasher.appendString("moveLeft");
    }
    if (actions.moveRight) {
        hasher.appendString("moveRight");
    }
    if (actions.moveUp) {
        hasher.appendString("moveUp");
    }
    hasher.endArray();
    hasher.endObject();
    return hasher.value();
}

void appendReplayRecord(
    cirvivor::core::CanonicalStateHasher64& recordsHasher,
    const int tick,
    const std::uint64_t inputHash,
    const std::size_t tileCorrectionCount,
    const std::uint64_t stateHash
) {
    constexpr std::string_view emptyEventsHash = "ad313cc744c71c21";
    const std::array<char, 16> inputHashText = hashHex(inputHash);
    const std::array<char, 16> stateHashText = hashHex(stateHash);
    recordsHasher.beginObject(9);
    recordsHasher.appendObjectKey("contactCount");
    recordsHasher.appendNumber(0.0);
    recordsHasher.appendObjectKey("entityCount");
    recordsHasher.appendNumber(2.0);
    recordsHasher.appendObjectKey("eventsHash");
    recordsHasher.appendString(emptyEventsHash);
    recordsHasher.appendObjectKey("inputHash");
    recordsHasher.appendString({inputHashText.data(), inputHashText.size()});
    recordsHasher.appendObjectKey("projectileCount");
    recordsHasher.appendNumber(0.0);
    recordsHasher.appendObjectKey("rngState");
    recordsHasher.appendNull();
    recordsHasher.appendObjectKey("stateHash");
    recordsHasher.appendString({stateHashText.data(), stateHashText.size()});
    recordsHasher.appendObjectKey("tick");
    recordsHasher.appendNumber(static_cast<double>(tick));
    recordsHasher.appendObjectKey("tileCorrectionCount");
    recordsHasher.appendNumber(static_cast<double>(tileCorrectionCount));
    recordsHasher.endObject();
}

struct Checkpoint final {
    int tick = 0;
    std::uint64_t hash = 0;
};

constexpr std::array checkpoints{
    Checkpoint{0, 0xa9ce'c2f7'1fb1'dae6ULL},
    Checkpoint{71, 0xf85a'af5b'249a'd2e6ULL},
    Checkpoint{131, 0xa3ac'1c69'f118'928cULL},
    Checkpoint{191, 0x57df'416f'8f01'f7c8ULL},
    Checkpoint{251, 0xc5d2'37fe'9847'5115ULL},
    Checkpoint{311, 0xb6cd'2980'2594'1b28ULL},
    Checkpoint{341, 0x7f3b'40fe'5282'c847ULL},
    Checkpoint{401, 0x279a'56ce'76cb'dfd9ULL},
    Checkpoint{479, 0x748a'6b36'a921'3900ULL}
};

[[nodiscard]] std::size_t expectedCorrectionCount(const int tick) noexcept {
    return tick == 70 || tick == 71 || tick == 191 || tick == 401 ? 1U : 0U;
}

void testGameSystemReplayMatchesJavaScriptOracle() {
    constexpr int tickCount = 480;
    cirvivor::game::GameSystem gameSystem;

    REQUIRE(hashStaticWorld(gameSystem.tileMap()) == 0xfd31'f3c2'8019'62f7ULL);
    REQUIRE(cirvivor::game::hashFixedState(gameSystem, -1, 0U)
        == 0x9dee'f2f1'2bd1'257dULL);

    cirvivor::core::CanonicalStateHasher64 recordsHasher;
    recordsHasher.beginArray(static_cast<std::size_t>(tickCount));
    std::size_t checkpointIndex = 0;
    std::size_t totalTileCorrectionCount = 0;
    std::size_t tickAllocationCount = 0;
    double maximumTowerSpeed = 0.0;

    for (int tick = 0; tick < tickCount; ++tick) {
        const cirvivor::game::MovementActionState actions = actionsForTick(tick);
        cirvivor::game::FixedUpdateResult result;
        std::uint64_t stateHash = 0;
        std::uint64_t inputHash = 0;
        std::size_t allocations = 0;
        {
            TickAllocationScope allocationScope;
            result = gameSystem.fixedUpdate(actions);
            stateHash = cirvivor::game::hashFixedState(
                gameSystem,
                tick,
                result.tileCorrectionCount
            );
            inputHash = hashInputActions(actions);
            appendReplayRecord(
                recordsHasher,
                tick,
                inputHash,
                result.tileCorrectionCount,
                stateHash
            );
            allocations = allocationScope.allocationCount();
        }

        tickAllocationCount += allocations;
        totalTileCorrectionCount += result.tileCorrectionCount;
        REQUIRE(result.tileCorrectionCount == expectedCorrectionCount(tick));
        const cirvivor::core::Vector2 velocity = gameSystem.bodies().velocity(
            gameSystem.towerBodyIndex()
        );
        maximumTowerSpeed = std::max(
            maximumTowerSpeed,
            std::hypot(velocity.x, velocity.y)
        );
        if (checkpointIndex < checkpoints.size()
            && checkpoints[checkpointIndex].tick == tick) {
            REQUIRE(stateHash == checkpoints[checkpointIndex].hash);
            ++checkpointIndex;
        }
    }
    recordsHasher.endArray();

    REQUIRE(checkpointIndex == checkpoints.size());
    REQUIRE(recordsHasher.value() == 0x11fd'486e'3971'0bf6ULL);
    REQUIRE(totalTileCorrectionCount == 4U);
    REQUIRE(tickAllocationCount == 0U);
    REQUIRE(std::bit_cast<std::uint64_t>(maximumTowerSpeed)
        == 0x401f'3321'aaa7'cf60ULL);
    REQUIRE(cirvivor::game::hashFixedState(gameSystem, 479, 0U)
        == 0x748a'6b36'a921'3900ULL);

    std::cout
        << "[INFO] GameSystem replay records=" << std::hex
        << recordsHasher.value()
        << " final=" << cirvivor::game::hashFixedState(gameSystem, 479, 0U)
        << std::dec
        << " corrections=" << totalTileCorrectionCount
        << " allocations=" << tickAllocationCount << '\n';
}

} // namespace

int main() {
    try {
        testGameSystemReplayMatchesJavaScriptOracle();
        std::cout << "1/1 tests passed\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "[FAIL] GameSystem JS replay parity: " << error.what() << '\n';
        return 1;
    }
}
