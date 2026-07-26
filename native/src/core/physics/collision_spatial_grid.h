#pragma once

#include "core/physics/collision_types.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <span>
#include <vector>

namespace cirvivor::core {

struct CollisionSpatialGridCapacity final {
    std::size_t bodyCapacity = 0U;
    std::size_t cellCapacity = 0U;
    std::size_t membershipCapacity = 0U;
    std::size_t hashSlotCount = 0U;
};

struct CollisionSpatialGridBuildResult final {
    CollisionBuildStatus status = CollisionBuildStatus::invalidInput;
    std::size_t bodyCount = 0U;
    std::size_t gridBodyCount = 0U;
    std::size_t cellCount = 0U;
    std::size_t membershipCount = 0U;
    std::int32_t cellSize = 0;
};

// Fixed-capacity broadphase grid. A build writes the inactive bank and only
// publishes it after both count and fill passes succeed, so capacity errors do
// not expose a partial grid.
class CollisionSpatialGrid final {
public:
    static constexpr std::size_t noCell = static_cast<std::size_t>(-1);

    explicit CollisionSpatialGrid(CollisionSpatialGridCapacity capacity);

    [[nodiscard]] CollisionSpatialGridBuildResult buildDefault(
        std::span<const CollisionPreparedBody> bodies,
        std::span<const float> broad,
        std::size_t gridBodyCount
    ) noexcept;

    [[nodiscard]] const CollisionSpatialGridBuildResult& activeBuild() const noexcept;
    [[nodiscard]] std::size_t findCell(std::int64_t key) const noexcept;
    [[nodiscard]] std::int64_t cellKey(std::size_t cellIndex) const noexcept;
    [[nodiscard]] std::span<const std::int32_t> cellBodies(
        std::size_t cellIndex
    ) const noexcept;
    [[nodiscard]] const CollisionSpatialGridCapacity& capacity() const noexcept;

private:
    struct Bank final {
        std::vector<std::int64_t> cellKeys;
        std::vector<std::size_t> cellOffsets;
        std::vector<std::size_t> cellCounts;
        std::vector<std::size_t> cellWriteCursors;
        std::vector<std::int32_t> memberships;
        std::vector<std::int64_t> hashKeys;
        std::vector<std::size_t> hashCellIndices;
        std::vector<std::uint8_t> hashOccupied;
        CollisionSpatialGridBuildResult result;
    };

    [[nodiscard]] std::size_t findCellInBank(
        const Bank& bank,
        std::int64_t key
    ) const noexcept;
    [[nodiscard]] bool findOrInsertCell(
        Bank& bank,
        std::int64_t key,
        std::size_t& cellCount,
        std::size_t& cellIndex
    ) const noexcept;

    CollisionSpatialGridCapacity capacity_;
    std::array<Bank, 2> banks_;
    std::size_t activeBankIndex_ = 0U;
    bool hasActiveBuild_ = false;
    CollisionSpatialGridBuildResult emptyResult_{};
};

} // namespace cirvivor::core
