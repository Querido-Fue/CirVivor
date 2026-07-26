#pragma once

#include "core/physics/collision_spatial_grid.h"
#include "core/physics/collision_types.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <span>
#include <vector>

namespace cirvivor::core {

struct CollisionCandidateBuilderCapacity final {
    std::size_t bodyCapacity = 0U;
    std::size_t priorityPairCapacity = 0U;
    std::size_t normalPairCapacity = 0U;
    std::size_t fairnessCapacity = 0U;
};

struct CollisionCandidateFairness final {
    std::int32_t low = -1;
    std::int32_t enemyId = -1;
    std::uint32_t visitLimit = 0U;
    std::size_t cellCount = 0U;
    std::uint32_t cellScanToken = 0U;
    std::size_t cellStart = 0U;
    std::uint32_t bucketScanToken = 0U;

    [[nodiscard]] friend constexpr bool operator==(
        const CollisionCandidateFairness&,
        const CollisionCandidateFairness&
    ) noexcept = default;
};

struct CollisionCandidateCounters final {
    std::uint32_t guaranteedPairCount = 0U;
    std::uint32_t priorityAdmissionCount = 0U;
    std::uint32_t predictiveAdmissionCount = 0U;
    std::uint32_t admissionBudgetSkipCount = 0U;
    std::uint32_t candidateVisitCount = 0U;
    std::uint32_t scanTruncateCount = 0U;
    std::uint32_t bucketPairCount = 0U;
    std::uint32_t duplicatePairSkipCount = 0U;
    std::uint32_t ruleRejectCount = 0U;
    std::uint32_t candidatePairCount = 0U;

    [[nodiscard]] friend constexpr bool operator==(
        const CollisionCandidateCounters&,
        const CollisionCandidateCounters&
    ) noexcept = default;
};

struct CollisionCandidateBuildResult final {
    CollisionBuildStatus status = CollisionBuildStatus::invalidInput;
    std::uint32_t candidateScanEpoch = 0U;
    std::uint32_t nextCandidateScanEpoch = 0U;
    std::uint32_t cellScanToken = 0U;
    std::size_t bodyCount = 0U;
    std::size_t enemyBodyCount = 0U;
    std::size_t priorityPairCount = 0U;
    std::size_t normalPairCount = 0U;
    std::size_t fairnessCount = 0U;
    CollisionCandidateCounters counters{};
};

// Exact-order legacy candidate admission over a prepared default grid. Output
// is double-buffered so invalid input and capacity failures are transactional.
class CollisionCandidateBuilder final {
public:
    explicit CollisionCandidateBuilder(CollisionCandidateBuilderCapacity capacity);

    [[nodiscard]] CollisionCandidateBuildResult build(
        std::span<const CollisionPreparedBody> bodies,
        const CollisionCandidatePlanes& planes,
        std::size_t enemyBodyCount,
        const CollisionSpatialGrid& grid,
        std::uint32_t candidateScanEpoch
    ) noexcept;

    [[nodiscard]] const CollisionCandidateBuildResult& activeBuild() const noexcept;
    [[nodiscard]] std::span<const CollisionCandidatePair> priorityPairs() const noexcept;
    [[nodiscard]] std::span<const CollisionCandidatePair> normalPairs() const noexcept;
    [[nodiscard]] std::span<const CollisionCandidateFairness> fairness() const noexcept;
    [[nodiscard]] const CollisionCandidateBuilderCapacity& capacity() const noexcept;

private:
    struct Bank final {
        std::vector<CollisionCandidatePair> priorityPairs;
        std::vector<CollisionCandidatePair> normalPairs;
        std::vector<CollisionCandidateFairness> fairness;
        CollisionCandidateBuildResult result;
    };

    [[nodiscard]] bool appendPriority(
        Bank& bank,
        std::size_t& count,
        std::int32_t low,
        std::int32_t high
    ) const noexcept;
    [[nodiscard]] bool appendNormal(
        Bank& bank,
        std::size_t& count,
        std::int32_t low,
        std::int32_t high
    ) const noexcept;

    CollisionCandidateBuilderCapacity capacity_;
    std::array<Bank, 2> banks_;
    std::vector<std::uint32_t> seenHighStamps_;
    std::vector<std::uint32_t> queryMarks_;
    std::vector<std::int32_t> queryCandidates_;
    std::size_t activeBankIndex_ = 0U;
    bool hasActiveBuild_ = false;
    CollisionCandidateBuildResult emptyResult_{};
};

} // namespace cirvivor::core
