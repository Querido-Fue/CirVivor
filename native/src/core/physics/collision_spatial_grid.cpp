#include "core/physics/collision_spatial_grid.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <stdexcept>

namespace cirvivor::core {
namespace {

struct CellRange final {
    std::int64_t minX = 0;
    std::int64_t maxX = 0;
    std::int64_t minY = 0;
    std::int64_t maxY = 0;
};

[[nodiscard]] CollisionSpatialGridBuildResult failureResult(
    const CollisionBuildStatus status
) noexcept {
    CollisionSpatialGridBuildResult result;
    result.status = status;
    return result;
}

[[nodiscard]] bool checkedAdd(
    const std::int64_t left,
    const std::int64_t right,
    std::int64_t& output
) noexcept {
    if ((right > 0 && left > std::numeric_limits<std::int64_t>::max() - right)
        || (right < 0 && left < std::numeric_limits<std::int64_t>::min() - right)) {
        return false;
    }
    output = left + right;
    return true;
}

[[nodiscard]] bool checkedMultiply(
    const std::int64_t left,
    const std::int64_t right,
    std::int64_t& output
) noexcept {
    if (left == 0 || right == 0) {
        output = 0;
        return true;
    }
    if ((left == -1 && right == std::numeric_limits<std::int64_t>::min())
        || (right == -1 && left == std::numeric_limits<std::int64_t>::min())) {
        return false;
    }
    if (left > 0) {
        if ((right > 0 && left > std::numeric_limits<std::int64_t>::max() / right)
            || (right < 0 && right < std::numeric_limits<std::int64_t>::min() / left)) {
            return false;
        }
    } else if ((right > 0 && left < std::numeric_limits<std::int64_t>::min() / right)
        || (right < 0 && left < std::numeric_limits<std::int64_t>::max() / right)) {
        return false;
    }
    output = left * right;
    return true;
}

[[nodiscard]] bool collisionCellKey(
    const std::int64_t cellX,
    const std::int64_t cellY,
    std::int64_t& key
) noexcept {
    std::int64_t shiftedX = 0;
    std::int64_t shiftedY = 0;
    std::int64_t scaledX = 0;
    return checkedAdd(cellX, collisionGridCellKeyOffset, shiftedX)
        && checkedAdd(cellY, collisionGridCellKeyOffset, shiftedY)
        && checkedMultiply(shiftedX, collisionGridCellKeyStride, scaledX)
        && checkedAdd(scaledX, shiftedY, key);
}

[[nodiscard]] bool cellCoordinate(
    const float bound,
    const std::int32_t cellSize,
    std::int64_t& output
) noexcept {
    if (!std::isfinite(bound) || cellSize <= 0) {
        return false;
    }
    const double coordinate = std::floor(
        static_cast<double>(bound) / static_cast<double>(cellSize)
    );
    if (!std::isfinite(coordinate)
        || coordinate < static_cast<double>(std::numeric_limits<std::int64_t>::min())
        || coordinate > static_cast<double>(std::numeric_limits<std::int64_t>::max())) {
        return false;
    }
    output = static_cast<std::int64_t>(coordinate);
    return true;
}

[[nodiscard]] bool readCellRange(
    const std::span<const float> broad,
    const std::size_t bodyIndex,
    const std::int32_t cellSize,
    CellRange& range
) noexcept {
    const std::size_t offset = bodyIndex * collisionBroadStride;
    return cellCoordinate(broad[offset], cellSize, range.minX)
        && cellCoordinate(broad[offset + 1U], cellSize, range.maxX)
        && cellCoordinate(broad[offset + 2U], cellSize, range.minY)
        && cellCoordinate(broad[offset + 3U], cellSize, range.maxY)
        && range.minX <= range.maxX
        && range.minY <= range.maxY;
}

[[nodiscard]] bool nextCoordinate(
    std::int64_t& coordinate,
    const std::int64_t maximum
) noexcept {
    if (coordinate == maximum) {
        return false;
    }
    ++coordinate;
    return true;
}

[[nodiscard]] std::uint64_t hashCellKey(const std::int64_t key) noexcept {
    std::uint64_t value = static_cast<std::uint64_t>(key);
    value ^= value >> 33U;
    value *= 0xff51'afd7'ed55'8ccdULL;
    value ^= value >> 33U;
    value *= 0xc4ce'b9fe'1a85'ec53ULL;
    value ^= value >> 33U;
    return value;
}

[[nodiscard]] bool estimateDefaultCellSize(
    const std::span<const CollisionPreparedBody> bodies,
    const std::size_t gridBodyCount,
    std::int32_t& cellSize
) noexcept {
    double radiusSum = 0.0;
    std::size_t radiusCount = 0U;
    for (std::size_t index = 0; index < gridBodyCount; ++index) {
        const double radius = bodies[index].boundRadius;
        if (!std::isfinite(radius) || radius <= 0.0) {
            continue;
        }
        radiusSum += radius;
        ++radiusCount;
    }
    if (!std::isfinite(radiusSum)) {
        return false;
    }

    const double averageRadius = radiusCount > 0U
        ? radiusSum / static_cast<double>(radiusCount)
        : 12.0;
    const double rawCellSize = std::floor(averageRadius * 2.4);
    if (!std::isfinite(rawCellSize)) {
        return false;
    }
    cellSize = static_cast<std::int32_t>(std::clamp(rawCellSize, 20.0, 280.0));
    return true;
}

} // namespace

CollisionSpatialGrid::CollisionSpatialGrid(const CollisionSpatialGridCapacity capacity)
    : capacity_(capacity) {
    if (capacity_.bodyCapacity == 0U
        || capacity_.cellCapacity == 0U
        || capacity_.membershipCapacity == 0U
        || capacity_.hashSlotCount < capacity_.cellCapacity) {
        throw std::invalid_argument("Collision spatial grid capacities are invalid.");
    }

    for (Bank& bank : banks_) {
        bank.cellKeys.resize(capacity_.cellCapacity);
        bank.cellOffsets.resize(capacity_.cellCapacity);
        bank.cellCounts.resize(capacity_.cellCapacity);
        bank.cellWriteCursors.resize(capacity_.cellCapacity);
        bank.memberships.resize(capacity_.membershipCapacity);
        bank.hashKeys.resize(capacity_.hashSlotCount);
        bank.hashCellIndices.resize(capacity_.hashSlotCount);
        bank.hashOccupied.resize(capacity_.hashSlotCount);
    }
}

CollisionSpatialGridBuildResult CollisionSpatialGrid::buildDefault(
    const std::span<const CollisionPreparedBody> bodies,
    const std::span<const float> broad,
    const std::size_t gridBodyCount
) noexcept {
    if (bodies.size() > capacity_.bodyCapacity
        || gridBodyCount > bodies.size()
        || bodies.size() > std::numeric_limits<std::size_t>::max() / collisionBroadStride
        || broad.size() < bodies.size() * collisionBroadStride) {
        return failureResult(CollisionBuildStatus::invalidInput);
    }

    std::int32_t cellSize = 0;
    if (!estimateDefaultCellSize(bodies, gridBodyCount, cellSize)) {
        return failureResult(CollisionBuildStatus::invalidInput);
    }

    const std::size_t stagingIndex = hasActiveBuild_ ? (activeBankIndex_ ^ 1U) : activeBankIndex_;
    Bank& staging = banks_[stagingIndex];
    std::fill(staging.hashOccupied.begin(), staging.hashOccupied.end(), std::uint8_t{0});

    std::size_t cellCount = 0U;
    std::size_t membershipCount = 0U;
    for (std::size_t bodyIndex = 0; bodyIndex < gridBodyCount; ++bodyIndex) {
        CellRange range;
        if (!readCellRange(broad, bodyIndex, cellSize, range)) {
            return failureResult(CollisionBuildStatus::invalidInput);
        }

        std::int64_t cellX = range.minX;
        while (true) {
            std::int64_t cellY = range.minY;
            while (true) {
                if (membershipCount >= capacity_.membershipCapacity) {
                    return failureResult(CollisionBuildStatus::capacityExceeded);
                }
                std::int64_t key = 0;
                if (!collisionCellKey(cellX, cellY, key)) {
                    return failureResult(CollisionBuildStatus::invalidInput);
                }
                std::size_t cellIndex = 0U;
                if (!findOrInsertCell(staging, key, cellCount, cellIndex)) {
                    return failureResult(CollisionBuildStatus::capacityExceeded);
                }
                ++staging.cellCounts[cellIndex];
                ++membershipCount;
                if (!nextCoordinate(cellY, range.maxY)) {
                    break;
                }
            }
            if (!nextCoordinate(cellX, range.maxX)) {
                break;
            }
        }
    }

    std::size_t offset = 0U;
    for (std::size_t cellIndex = 0; cellIndex < cellCount; ++cellIndex) {
        staging.cellOffsets[cellIndex] = offset;
        staging.cellWriteCursors[cellIndex] = 0U;
        offset += staging.cellCounts[cellIndex];
    }

    for (std::size_t bodyIndex = 0; bodyIndex < gridBodyCount; ++bodyIndex) {
        CellRange range;
        static_cast<void>(readCellRange(broad, bodyIndex, cellSize, range));
        std::int64_t cellX = range.minX;
        while (true) {
            std::int64_t cellY = range.minY;
            while (true) {
                std::int64_t key = 0;
                static_cast<void>(collisionCellKey(cellX, cellY, key));
                const std::size_t cellIndex = findCellInBank(staging, key);
                const std::size_t writeIndex = staging.cellOffsets[cellIndex]
                    + staging.cellWriteCursors[cellIndex];
                staging.memberships[writeIndex] = static_cast<std::int32_t>(bodyIndex);
                ++staging.cellWriteCursors[cellIndex];
                if (!nextCoordinate(cellY, range.maxY)) {
                    break;
                }
            }
            if (!nextCoordinate(cellX, range.maxX)) {
                break;
            }
        }
    }

    staging.result = {
        .status = CollisionBuildStatus::ok,
        .bodyCount = bodies.size(),
        .gridBodyCount = gridBodyCount,
        .cellCount = cellCount,
        .membershipCount = membershipCount,
        .cellSize = cellSize
    };
    activeBankIndex_ = stagingIndex;
    hasActiveBuild_ = true;
    return staging.result;
}

const CollisionSpatialGridBuildResult& CollisionSpatialGrid::activeBuild() const noexcept {
    return hasActiveBuild_ ? banks_[activeBankIndex_].result : emptyResult_;
}

std::size_t CollisionSpatialGrid::findCell(const std::int64_t key) const noexcept {
    if (!hasActiveBuild_) {
        return noCell;
    }
    return findCellInBank(banks_[activeBankIndex_], key);
}

std::int64_t CollisionSpatialGrid::cellKey(const std::size_t cellIndex) const noexcept {
    const Bank& active = banks_[activeBankIndex_];
    if (!hasActiveBuild_ || cellIndex >= active.result.cellCount) {
        return 0;
    }
    return active.cellKeys[cellIndex];
}

std::span<const std::int32_t> CollisionSpatialGrid::cellBodies(
    const std::size_t cellIndex
) const noexcept {
    const Bank& active = banks_[activeBankIndex_];
    if (!hasActiveBuild_ || cellIndex >= active.result.cellCount) {
        return {};
    }
    return std::span<const std::int32_t>(active.memberships)
        .subspan(active.cellOffsets[cellIndex], active.cellCounts[cellIndex]);
}

const CollisionSpatialGridCapacity& CollisionSpatialGrid::capacity() const noexcept {
    return capacity_;
}

std::size_t CollisionSpatialGrid::findCellInBank(
    const Bank& bank,
    const std::int64_t key
) const noexcept {
    const std::size_t slotCount = capacity_.hashSlotCount;
    const std::size_t start = static_cast<std::size_t>(
        hashCellKey(key) % static_cast<std::uint64_t>(slotCount)
    );
    for (std::size_t probe = 0; probe < slotCount; ++probe) {
        const std::size_t slot = (start + probe) % slotCount;
        if (bank.hashOccupied[slot] == 0U) {
            return noCell;
        }
        if (bank.hashKeys[slot] == key) {
            return bank.hashCellIndices[slot];
        }
    }
    return noCell;
}

bool CollisionSpatialGrid::findOrInsertCell(
    Bank& bank,
    const std::int64_t key,
    std::size_t& cellCount,
    std::size_t& cellIndex
) const noexcept {
    const std::size_t slotCount = capacity_.hashSlotCount;
    const std::size_t start = static_cast<std::size_t>(
        hashCellKey(key) % static_cast<std::uint64_t>(slotCount)
    );
    for (std::size_t probe = 0; probe < slotCount; ++probe) {
        const std::size_t slot = (start + probe) % slotCount;
        if (bank.hashOccupied[slot] != 0U) {
            if (bank.hashKeys[slot] == key) {
                cellIndex = bank.hashCellIndices[slot];
                return true;
            }
            continue;
        }
        if (cellCount >= capacity_.cellCapacity) {
            return false;
        }
        cellIndex = cellCount;
        ++cellCount;
        bank.cellKeys[cellIndex] = key;
        bank.cellCounts[cellIndex] = 0U;
        bank.hashOccupied[slot] = 1U;
        bank.hashKeys[slot] = key;
        bank.hashCellIndices[slot] = cellIndex;
        return true;
    }
    return false;
}

} // namespace cirvivor::core
