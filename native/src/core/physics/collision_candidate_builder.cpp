#include "core/physics/collision_candidate_builder.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <stdexcept>

namespace cirvivor::core {
namespace {

constexpr std::uint32_t currentCandidateLimit = 12U;
constexpr std::uint32_t predictiveCandidateLimit = 2U;
constexpr std::uint32_t candidateVisitLimit = 32U;
constexpr std::uint32_t anchorCandidateMultiplier = 2U;
constexpr double candidateSweepPadScale = 4.625;
constexpr double collisionEpsilon = 1.0e-6;

struct CellRange final {
    std::int64_t minX = 0;
    std::int64_t maxX = 0;
    std::int64_t minY = 0;
    std::int64_t maxY = 0;
};

[[nodiscard]] CollisionCandidateBuildResult failureResult(
    const CollisionBuildStatus status,
    const std::uint32_t scanEpoch
) noexcept {
    CollisionCandidateBuildResult result;
    result.status = status;
    result.candidateScanEpoch = scanEpoch;
    result.nextCandidateScanEpoch = scanEpoch;
    result.cellScanToken = scanEpoch;
    return result;
}

[[nodiscard]] bool cellCoordinate(
    const double bound,
    const std::int32_t cellSize,
    std::int64_t& output
) noexcept {
    if (!std::isfinite(bound) || cellSize <= 0) {
        return false;
    }
    const double coordinate = std::floor(bound / static_cast<double>(cellSize));
    if (!std::isfinite(coordinate)
        || coordinate < static_cast<double>(std::numeric_limits<std::int32_t>::min())
        || coordinate > static_cast<double>(std::numeric_limits<std::int32_t>::max())) {
        return false;
    }
    output = static_cast<std::int64_t>(coordinate);
    return true;
}

[[nodiscard]] bool readBroadCellRange(
    const std::span<const float> broad,
    const std::size_t bodyIndex,
    const std::int32_t cellSize,
    CellRange& range
) noexcept {
    const std::size_t offset = bodyIndex * collisionBroadStride;
    return cellCoordinate(static_cast<double>(broad[offset]), cellSize, range.minX)
        && cellCoordinate(static_cast<double>(broad[offset + 1U]), cellSize, range.maxX)
        && cellCoordinate(static_cast<double>(broad[offset + 2U]), cellSize, range.minY)
        && cellCoordinate(static_cast<double>(broad[offset + 3U]), cellSize, range.maxY)
        && range.minX <= range.maxX
        && range.minY <= range.maxY;
}

[[nodiscard]] bool readBodyCellRange(
    const CollisionPreparedBody& body,
    const std::int32_t cellSize,
    CellRange& range
) noexcept {
    return cellCoordinate(body.minX, cellSize, range.minX)
        && cellCoordinate(body.maxX, cellSize, range.maxX)
        && cellCoordinate(body.minY, cellSize, range.minY)
        && cellCoordinate(body.maxY, cellSize, range.maxY)
        && range.minX <= range.maxX
        && range.minY <= range.maxY;
}

[[nodiscard]] bool cellDimensions(
    const CellRange& range,
    std::size_t& width,
    std::size_t& height,
    std::size_t& count
) noexcept {
    const std::uint64_t width64 = static_cast<std::uint64_t>(range.maxX - range.minX) + 1U;
    const std::uint64_t height64 = static_cast<std::uint64_t>(range.maxY - range.minY) + 1U;
    if (width64 > static_cast<std::uint64_t>(std::numeric_limits<std::size_t>::max())
        || height64 > static_cast<std::uint64_t>(std::numeric_limits<std::size_t>::max())) {
        return false;
    }
    width = static_cast<std::size_t>(width64);
    height = static_cast<std::size_t>(height64);
    if (height != 0U && width > std::numeric_limits<std::size_t>::max() / height) {
        return false;
    }
    count = width * height;
    return count > 0U;
}

[[nodiscard]] std::int64_t cellKey(
    const std::int64_t cellX,
    const std::int64_t cellY
) noexcept {
    return ((cellX + collisionGridCellKeyOffset) * collisionGridCellKeyStride)
        + (cellY + collisionGridCellKeyOffset);
}

[[nodiscard]] bool isEnemy(const CollisionPreparedBody& body) noexcept {
    return body.kind == CollisionBodyKind::enemy;
}

[[nodiscard]] bool isCircle(const CollisionPreparedBody& body) noexcept {
    return body.shape == CollisionBodyShape::circle;
}

[[nodiscard]] bool isHexaHiveWallBody(const CollisionPreparedBody& body) noexcept {
    return isEnemy(body) && body.hexaHive && body.circlePartCount >= 2U;
}

[[nodiscard]] bool isAnchorPair(
    const CollisionPreparedBody& bodyA,
    const CollisionPreparedBody& bodyB
) noexcept {
    const bool anchorA = isHexaHiveWallBody(bodyA);
    const bool anchorB = isHexaHiveWallBody(bodyB);
    return (anchorA && isEnemy(bodyB) && !anchorB)
        || (anchorB && isEnemy(bodyA) && !anchorA);
}

[[nodiscard]] bool areSameEntity(
    const CollisionPreparedBody& bodyA,
    const CollisionPreparedBody& bodyB
) noexcept {
    if (bodyA.hasReference
        && bodyB.hasReference
        && bodyA.referenceToken == bodyB.referenceToken) {
        return true;
    }
    return isEnemy(bodyA)
        && isEnemy(bodyB)
        && bodyA.id >= 0
        && bodyA.id == bodyB.id;
}

[[nodiscard]] bool hasCollisionPassRule(
    const CollisionPreparedBody& bodyA,
    const CollisionPreparedBody& bodyB
) noexcept {
    if (areSameEntity(bodyA, bodyB)) {
        return false;
    }
    const CollisionBodyKind kindA = bodyA.kind;
    const CollisionBodyKind kindB = bodyB.kind;
    if (kindA == CollisionBodyKind::enemy && kindB == CollisionBodyKind::enemy) {
        return true;
    }
    if ((kindA == CollisionBodyKind::enemy && kindB == CollisionBodyKind::player)
        || (kindA == CollisionBodyKind::player && kindB == CollisionBodyKind::enemy)
        || (kindA == CollisionBodyKind::enemy && kindB == CollisionBodyKind::projectile)
        || (kindA == CollisionBodyKind::projectile && kindB == CollisionBodyKind::enemy)) {
        return true;
    }
    if ((kindA == CollisionBodyKind::enemy && kindB == CollisionBodyKind::item)
        || (kindA == CollisionBodyKind::item && kindB == CollisionBodyKind::enemy)) {
        return false;
    }
    if (kindA == CollisionBodyKind::player && kindB == CollisionBodyKind::player) {
        return true;
    }
    if ((kindA == CollisionBodyKind::player && kindB == CollisionBodyKind::projectile)
        || (kindA == CollisionBodyKind::projectile && kindB == CollisionBodyKind::player)
        || (kindA == CollisionBodyKind::player && kindB == CollisionBodyKind::item)
        || (kindA == CollisionBodyKind::item && kindB == CollisionBodyKind::player)
        || (kindA == CollisionBodyKind::projectile && kindB == CollisionBodyKind::projectile)
        || (kindA == CollisionBodyKind::item && kindB == CollisionBodyKind::item)) {
        return true;
    }
    if ((kindA == CollisionBodyKind::projectile && kindB == CollisionBodyKind::item)
        || (kindA == CollisionBodyKind::item && kindB == CollisionBodyKind::projectile)) {
        return false;
    }
    if (kindA == CollisionBodyKind::wall) {
        return kindB != CollisionBodyKind::wall;
    }
    if (kindB == CollisionBodyKind::wall) {
        return kindA != CollisionBodyKind::wall;
    }
    return false;
}

[[nodiscard]] double finiteOr(const double value, const double fallback) noexcept {
    return std::isfinite(value) ? value : fallback;
}

struct Aabb final {
    double minX = 0.0;
    double maxX = 0.0;
    double minY = 0.0;
    double maxY = 0.0;
};

[[nodiscard]] Aabb relationAabb(
    const CollisionPreparedBody& body,
    const CollisionPreparedBody& other
) noexcept {
    Aabb result{body.minX, body.maxX, body.minY, body.maxY};
    if (isEnemy(body) && isEnemy(other)) {
        result.minX = finiteOr(body.enemyPairMinX, result.minX);
        result.maxX = finiteOr(body.enemyPairMaxX, result.maxX);
        result.minY = finiteOr(body.enemyPairMinY, result.minY);
        result.maxY = finiteOr(body.enemyPairMaxY, result.maxY);
    } else if (isEnemy(body) && other.kind == CollisionBodyKind::projectile) {
        result.minX = finiteOr(body.projectileMinX, result.minX);
        result.maxX = finiteOr(body.projectileMaxX, result.maxX);
        result.minY = finiteOr(body.projectileMinY, result.minY);
        result.maxY = finiteOr(body.projectileMaxY, result.maxY);
    }
    return result;
}

[[nodiscard]] bool aabbsOverlap(const Aabb& bodyA, const Aabb& bodyB) noexcept {
    return bodyA.minX <= bodyB.maxX
        && bodyA.maxX >= bodyB.minX
        && bodyA.minY <= bodyB.maxY
        && bodyA.maxY >= bodyB.minY;
}

[[nodiscard]] bool currentAabbsOverlap(
    const CollisionPreparedBody& bodyA,
    const CollisionPreparedBody& bodyB
) noexcept {
    return aabbsOverlap(relationAabb(bodyA, bodyB), relationAabb(bodyB, bodyA));
}

[[nodiscard]] double centerCoordinate(
    const double center,
    const double fallback
) noexcept {
    return std::isfinite(center) ? center : fallback;
}

[[nodiscard]] double relationRadius(
    const CollisionPreparedBody& body,
    const CollisionPreparedBody& other
) noexcept {
    if (isEnemy(body) && isEnemy(other) && std::isfinite(body.enemyPairBroadRadius)) {
        return body.enemyPairBroadRadius;
    }
    if (isEnemy(body)
        && other.kind == CollisionBodyKind::projectile
        && std::isfinite(body.projectileBroadRadius)) {
        return body.projectileBroadRadius;
    }
    if (isCircle(body) && std::isfinite(body.radius)) {
        return body.radius;
    }
    return std::isfinite(body.broadRadius) ? body.broadRadius : body.boundRadius;
}

[[nodiscard]] bool broadCirclesOverlap(
    const CollisionPreparedBody& bodyA,
    const CollisionPreparedBody& bodyB
) noexcept {
    const double ax = centerCoordinate(bodyA.centerX, bodyA.x);
    const double ay = centerCoordinate(bodyA.centerY, bodyA.y);
    const double bx = centerCoordinate(bodyB.centerX, bodyB.x);
    const double by = centerCoordinate(bodyB.centerY, bodyB.y);
    if (!std::isfinite(ax) || !std::isfinite(ay)
        || !std::isfinite(bx) || !std::isfinite(by)) {
        return true;
    }
    const double radiusA = relationRadius(bodyA, bodyB);
    const double radiusB = relationRadius(bodyB, bodyA);
    if (!std::isfinite(radiusA) || radiusA <= 0.0
        || !std::isfinite(radiusB) || radiusB <= 0.0) {
        return true;
    }
    const double radiusSum = radiusA + radiusB + collisionEpsilon;
    const double deltaX = bx - ax;
    const double deltaY = by - ay;
    return ((deltaX * deltaX) + (deltaY * deltaY)) <= (radiusSum * radiusSum);
}

[[nodiscard]] double sweepBound(
    const bool useEnemyPairBound,
    const double baseValue,
    const double relationValue,
    const double sweepValue,
    const bool useMinimum
) noexcept {
    const double selectedBase = useEnemyPairBound && std::isfinite(relationValue)
        ? relationValue
        : baseValue;
    const double selectedSweep = std::isfinite(sweepValue) ? sweepValue : selectedBase;
    const double expanded = selectedBase
        + ((selectedSweep - selectedBase) * candidateSweepPadScale);
    return useMinimum
        ? std::min(selectedBase, expanded)
        : std::max(selectedBase, expanded);
}

[[nodiscard]] Aabb candidateSweepAabb(
    const CollisionPreparedBody& body,
    const bool useEnemyPairBound
) noexcept {
    return {
        sweepBound(useEnemyPairBound, body.minX, body.enemyPairMinX, body.sweepMinX, true),
        sweepBound(useEnemyPairBound, body.maxX, body.enemyPairMaxX, body.sweepMaxX, false),
        sweepBound(useEnemyPairBound, body.minY, body.enemyPairMinY, body.sweepMinY, true),
        sweepBound(useEnemyPairBound, body.maxY, body.enemyPairMaxY, body.sweepMaxY, false)
    };
}

[[nodiscard]] bool candidateSweepAabbsOverlap(
    const CollisionPreparedBody& bodyA,
    const CollisionPreparedBody& bodyB
) noexcept {
    const bool enemyPair = isEnemy(bodyA) && isEnemy(bodyB);
    return aabbsOverlap(
        candidateSweepAabb(bodyA, enemyPair),
        candidateSweepAabb(bodyB, enemyPair)
    );
}

[[nodiscard]] double candidateSweepPad(const CollisionPreparedBody& body) noexcept {
    const double left = std::isfinite(body.sweepMinX) && std::isfinite(body.minX)
        ? std::max(0.0, body.minX - body.sweepMinX)
        : 0.0;
    const double right = std::isfinite(body.sweepMaxX) && std::isfinite(body.maxX)
        ? std::max(0.0, body.sweepMaxX - body.maxX)
        : 0.0;
    const double top = std::isfinite(body.sweepMinY) && std::isfinite(body.minY)
        ? std::max(0.0, body.minY - body.sweepMinY)
        : 0.0;
    const double bottom = std::isfinite(body.sweepMaxY) && std::isfinite(body.maxY)
        ? std::max(0.0, body.sweepMaxY - body.maxY)
        : 0.0;
    return std::max(std::max(left, right), std::max(top, bottom)) * candidateSweepPadScale;
}

[[nodiscard]] bool candidateSweepCirclesOverlap(
    const CollisionPreparedBody& bodyA,
    const CollisionPreparedBody& bodyB
) noexcept {
    const double ax = centerCoordinate(bodyA.centerX, bodyA.x);
    const double ay = centerCoordinate(bodyA.centerY, bodyA.y);
    const double bx = centerCoordinate(bodyB.centerX, bodyB.x);
    const double by = centerCoordinate(bodyB.centerY, bodyB.y);
    const double radiusA = relationRadius(bodyA, bodyB);
    const double radiusB = relationRadius(bodyB, bodyA);
    if (!std::isfinite(ax) || !std::isfinite(ay)
        || !std::isfinite(bx) || !std::isfinite(by)
        || !std::isfinite(radiusA) || radiusA <= 0.0
        || !std::isfinite(radiusB) || radiusB <= 0.0) {
        return true;
    }
    const double radiusSum = radiusA
        + radiusB
        + candidateSweepPad(bodyA)
        + candidateSweepPad(bodyB)
        + collisionEpsilon;
    const double deltaX = bx - ax;
    const double deltaY = by - ay;
    return ((deltaX * deltaX) + (deltaY * deltaY)) <= (radiusSum * radiusSum);
}

[[nodiscard]] bool typedCandidateOverlap(
    const CollisionCandidatePlanes& planes,
    const std::size_t low,
    const std::size_t high,
    const double minAX,
    const double maxAX,
    const double minAY,
    const double maxAY,
    const double centerAX,
    const double centerAY,
    const double radiusA,
    const double padA,
    bool& usesBroadCircle
) noexcept {
    const std::size_t offsetB = high * collisionCandidateSweepStride;
    if (!(minAX <= planes.candidateSweep[offsetB + 1U]
        && maxAX >= planes.candidateSweep[offsetB]
        && minAY <= planes.candidateSweep[offsetB + 3U]
        && maxAY >= planes.candidateSweep[offsetB + 2U])) {
        return false;
    }
    usesBroadCircle = planes.bodyShape[low]
            != static_cast<std::uint8_t>(CollisionBodyShape::circle)
        || planes.bodyShape[high]
            != static_cast<std::uint8_t>(CollisionBodyShape::circle);
    if (!usesBroadCircle) {
        return true;
    }
    const double deltaX = planes.candidateSweep[offsetB + 4U] - centerAX;
    const double deltaY = planes.candidateSweep[offsetB + 5U] - centerAY;
    const double radiusSum = radiusA
        + planes.candidateSweep[offsetB + 6U]
        + padA
        + planes.candidateSweep[offsetB + 7U]
        + collisionEpsilon;
    return ((deltaX * deltaX) + (deltaY * deltaY)) <= (radiusSum * radiusSum);
}

[[nodiscard]] bool shouldAdmit(
    const std::uint32_t priorityCount,
    const std::uint32_t predictiveCount,
    const bool priority,
    const bool anchor
) noexcept {
    const std::uint32_t baseLimit = priority
        ? currentCandidateLimit
        : predictiveCandidateLimit;
    const std::uint32_t limit = anchor ? baseLimit * anchorCandidateMultiplier : baseLimit;
    return (priority ? priorityCount : predictiveCount) < limit;
}

[[nodiscard]] bool validatePlanes(
    const CollisionCandidatePlanes& planes,
    const std::size_t bodyCount
) noexcept {
    if (bodyCount > std::numeric_limits<std::size_t>::max() / collisionBroadStride
        || bodyCount > std::numeric_limits<std::size_t>::max() / collisionCandidateSweepStride) {
        return false;
    }
    return planes.broad.size() >= bodyCount * collisionBroadStride
        && planes.candidateSweep.size() >= bodyCount * collisionCandidateSweepStride
        && planes.candidateSweepValidity.size() >= bodyCount
        && planes.bodyKind.size() >= bodyCount
        && planes.bodyShape.size() >= bodyCount;
}

} // namespace

CollisionCandidateBuilder::CollisionCandidateBuilder(
    const CollisionCandidateBuilderCapacity capacity
) : capacity_(capacity),
    seenHighStamps_(capacity.bodyCapacity),
    queryMarks_(capacity.bodyCapacity),
    queryCandidates_(capacity.bodyCapacity) {
    if (capacity_.bodyCapacity == 0U
        || capacity_.priorityPairCapacity == 0U
        || capacity_.normalPairCapacity == 0U
        || capacity_.fairnessCapacity == 0U
        || capacity_.bodyCapacity > static_cast<std::size_t>(std::numeric_limits<std::int32_t>::max())) {
        throw std::invalid_argument("Collision candidate builder capacities are invalid.");
    }
    for (Bank& bank : banks_) {
        bank.priorityPairs.resize(capacity_.priorityPairCapacity);
        bank.normalPairs.resize(capacity_.normalPairCapacity);
        bank.fairness.resize(capacity_.fairnessCapacity);
    }
}

CollisionCandidateBuildResult CollisionCandidateBuilder::build(
    const std::span<const CollisionPreparedBody> bodies,
    const CollisionCandidatePlanes& planes,
    const std::size_t enemyBodyCount,
    const CollisionSpatialGrid& grid,
    const std::uint32_t candidateScanEpoch
) noexcept {
    const CollisionSpatialGridBuildResult& gridBuild = grid.activeBuild();
    if (bodies.size() > capacity_.bodyCapacity
        || enemyBodyCount > bodies.size()
        || !validatePlanes(planes, bodies.size())
        || gridBuild.status != CollisionBuildStatus::ok
        || gridBuild.bodyCount != bodies.size()
        || gridBuild.gridBodyCount != enemyBodyCount
        || gridBuild.cellSize <= 0) {
        return failureResult(CollisionBuildStatus::invalidInput, candidateScanEpoch);
    }

    const std::size_t stagingIndex = hasActiveBuild_ ? (activeBankIndex_ ^ 1U) : activeBankIndex_;
    Bank& staging = banks_[stagingIndex];
    std::fill(seenHighStamps_.begin(), seenHighStamps_.end(), std::uint32_t{0});
    std::fill(queryMarks_.begin(), queryMarks_.end(), std::uint32_t{0});
    std::uint32_t seenStamp = 0U;
    std::uint32_t queryStamp = 0U;
    std::size_t priorityPairCount = 0U;
    std::size_t normalPairCount = 0U;
    std::size_t fairnessCount = 0U;
    CollisionCandidateCounters counters;

    if (bodies.size() < 2U) {
        staging.result = {
            .status = CollisionBuildStatus::ok,
            .candidateScanEpoch = candidateScanEpoch,
            .nextCandidateScanEpoch = candidateScanEpoch,
            .cellScanToken = candidateScanEpoch,
            .bodyCount = bodies.size(),
            .enemyBodyCount = enemyBodyCount
        };
        activeBankIndex_ = stagingIndex;
        hasActiveBuild_ = true;
        return staging.result;
    }

    for (std::size_t low = 0U; low + 1U < enemyBodyCount; ++low) {
        if (fairnessCount >= capacity_.fairnessCapacity) {
            return failureResult(CollisionBuildStatus::capacityExceeded, candidateScanEpoch);
        }
        ++seenStamp;
        if (seenStamp == 0U) {
            std::fill(seenHighStamps_.begin(), seenHighStamps_.end(), std::uint32_t{0});
            seenStamp = 1U;
        }

        const CollisionPreparedBody& bodyA = bodies[low];
        const bool comparableId = bodyA.id >= 0;
        const std::size_t candidateOffsetA = low * collisionCandidateSweepStride;
        const bool hasCandidateSweepA = planes.candidateSweepValidity[low] == 1U
            && planes.bodyKind[low] == static_cast<std::uint8_t>(CollisionBodyKind::enemy);
        const double candidateMinAX = planes.candidateSweep[candidateOffsetA];
        const double candidateMaxAX = planes.candidateSweep[candidateOffsetA + 1U];
        const double candidateMinAY = planes.candidateSweep[candidateOffsetA + 2U];
        const double candidateMaxAY = planes.candidateSweep[candidateOffsetA + 3U];
        const double candidateCenterAX = planes.candidateSweep[candidateOffsetA + 4U];
        const double candidateCenterAY = planes.candidateSweep[candidateOffsetA + 5U];
        const double candidateRadiusA = planes.candidateSweep[candidateOffsetA + 6U];
        const double candidatePadA = planes.candidateSweep[candidateOffsetA + 7U];
        std::uint32_t lowPriorityCount = 0U;
        std::uint32_t lowPredictiveCount = 0U;
        std::uint32_t lowVisitCount = 0U;
        const std::uint32_t visitLimit = isHexaHiveWallBody(bodyA)
            ? candidateVisitLimit * anchorCandidateMultiplier
            : candidateVisitLimit;

        CellRange range;
        std::size_t cellWidth = 0U;
        std::size_t cellHeight = 0U;
        std::size_t cellCount = 0U;
        if (!readBroadCellRange(planes.broad, low, gridBuild.cellSize, range)
            || !cellDimensions(range, cellWidth, cellHeight, cellCount)) {
            return failureResult(CollisionBuildStatus::invalidInput, candidateScanEpoch);
        }
        static_cast<void>(cellWidth);
        const std::uint32_t cellScanToken = candidateScanEpoch + static_cast<std::uint32_t>(low);
        const std::size_t cellStart = static_cast<std::size_t>(cellScanToken) % cellCount;
        const std::uint32_t bucketPageEpoch = static_cast<std::uint32_t>(
            static_cast<std::size_t>(cellScanToken) / cellCount
        );
        const std::uint32_t bucketScanToken = bucketPageEpoch * visitLimit;
        staging.fairness[fairnessCount] = {
            .low = static_cast<std::int32_t>(low),
            .enemyId = bodyA.id,
            .visitLimit = visitLimit,
            .cellCount = cellCount,
            .cellScanToken = cellScanToken,
            .cellStart = cellStart,
            .bucketScanToken = bucketScanToken
        };
        ++fairnessCount;

        bool truncated = false;
        for (std::size_t cellOffset = 0U; cellOffset < cellCount && !truncated; ++cellOffset) {
            const std::size_t rotatedCellIndex = (cellStart + cellOffset) % cellCount;
            const std::int64_t cellX = range.minX
                + static_cast<std::int64_t>(rotatedCellIndex / cellHeight);
            const std::int64_t cellY = range.minY
                + static_cast<std::int64_t>(rotatedCellIndex % cellHeight);
            const std::size_t gridCellIndex = grid.findCell(cellKey(cellX, cellY));
            if (gridCellIndex == CollisionSpatialGrid::noCell) {
                continue;
            }
            const std::span<const std::int32_t> bucket = grid.cellBodies(gridCellIndex);
            if (bucket.empty()) {
                continue;
            }
            const std::size_t bucketStart = (
                static_cast<std::uint64_t>(bucketScanToken)
                + static_cast<std::uint64_t>(low)
                + static_cast<std::uint64_t>(rotatedCellIndex)
            ) % bucket.size();
            for (std::size_t bucketOffset = 0U; bucketOffset < bucket.size(); ++bucketOffset) {
                const std::size_t bucketIndex = (bucketStart + bucketOffset) % bucket.size();
                const std::int32_t highValue = bucket[bucketIndex];
                if (highValue <= static_cast<std::int32_t>(low)) {
                    continue;
                }
                ++counters.bucketPairCount;
                const std::size_t high = static_cast<std::size_t>(highValue);
                if (seenHighStamps_[high] == seenStamp) {
                    ++counters.duplicatePairSkipCount;
                    continue;
                }
                if (lowVisitCount >= visitLimit) {
                    ++counters.scanTruncateCount;
                    truncated = true;
                    break;
                }
                seenHighStamps_[high] = seenStamp;
                ++lowVisitCount;
                ++counters.candidateVisitCount;

                const CollisionPreparedBody& bodyB = bodies[high];
                if ((bodyA.hasReference
                        && bodyB.hasReference
                        && bodyA.referenceToken == bodyB.referenceToken)
                    || (comparableId && bodyA.id == bodyB.id)) {
                    ++counters.ruleRejectCount;
                    continue;
                }

                const bool hasCandidateSweepB = planes.candidateSweepValidity[high] == 1U
                    && planes.bodyKind[high]
                        == static_cast<std::uint8_t>(CollisionBodyKind::enemy);
                bool usesBroadCircle = false;
                bool overlaps = false;
                if (hasCandidateSweepA && hasCandidateSweepB) {
                    overlaps = typedCandidateOverlap(
                        planes,
                        low,
                        high,
                        candidateMinAX,
                        candidateMaxAX,
                        candidateMinAY,
                        candidateMaxAY,
                        candidateCenterAX,
                        candidateCenterAY,
                        candidateRadiusA,
                        candidatePadA,
                        usesBroadCircle
                    );
                } else {
                    overlaps = candidateSweepAabbsOverlap(bodyA, bodyB);
                    usesBroadCircle = !isCircle(bodyA) || !isCircle(bodyB);
                    if (overlaps && usesBroadCircle) {
                        overlaps = candidateSweepCirclesOverlap(bodyA, bodyB);
                    }
                }
                if (!overlaps) {
                    continue;
                }

                const bool anchor = isAnchorPair(bodyA, bodyB);
                const bool currentOverlap = currentAabbsOverlap(bodyA, bodyB)
                    && (!usesBroadCircle || broadCirclesOverlap(bodyA, bodyB));
                const bool priority = currentOverlap || anchor;
                if (!shouldAdmit(
                    lowPriorityCount,
                    lowPredictiveCount,
                    priority,
                    anchor
                )) {
                    ++counters.admissionBudgetSkipCount;
                    continue;
                }
                if (priority) {
                    ++lowPriorityCount;
                    ++counters.priorityAdmissionCount;
                    if (!appendPriority(
                        staging,
                        priorityPairCount,
                        static_cast<std::int32_t>(low),
                        highValue
                    )) {
                        return failureResult(CollisionBuildStatus::capacityExceeded, candidateScanEpoch);
                    }
                } else {
                    ++lowPredictiveCount;
                    ++counters.predictiveAdmissionCount;
                    if (!appendNormal(
                        staging,
                        normalPairCount,
                        static_cast<std::int32_t>(low),
                        highValue
                    )) {
                        return failureResult(CollisionBuildStatus::capacityExceeded, candidateScanEpoch);
                    }
                }
                ++counters.candidatePairCount;
            }
        }
    }

    for (std::size_t high = enemyBodyCount; high < bodies.size(); ++high) {
        ++queryStamp;
        if (queryStamp == 0U) {
            std::fill(queryMarks_.begin(), queryMarks_.end(), std::uint32_t{0});
            queryStamp = 1U;
        }
        std::size_t queryCount = 0U;
        CellRange range;
        if (!readBodyCellRange(bodies[high], gridBuild.cellSize, range)) {
            return failureResult(CollisionBuildStatus::invalidInput, candidateScanEpoch);
        }
        std::int64_t cellX = range.minX;
        while (true) {
            std::int64_t cellY = range.minY;
            while (true) {
                const std::size_t gridCellIndex = grid.findCell(cellKey(cellX, cellY));
                if (gridCellIndex != CollisionSpatialGrid::noCell) {
                    for (const std::int32_t candidate : grid.cellBodies(gridCellIndex)) {
                        if (candidate < 0
                            || static_cast<std::size_t>(candidate) >= enemyBodyCount) {
                            continue;
                        }
                        const std::size_t candidateIndex = static_cast<std::size_t>(candidate);
                        if (queryMarks_[candidateIndex] == queryStamp) {
                            continue;
                        }
                        queryMarks_[candidateIndex] = queryStamp;
                        queryCandidates_[queryCount] = candidate;
                        ++queryCount;
                    }
                }
                if (cellY == range.maxY) {
                    break;
                }
                ++cellY;
            }
            if (cellX == range.maxX) {
                break;
            }
            ++cellX;
        }

        for (std::size_t candidateIndex = 0U; candidateIndex < queryCount; ++candidateIndex) {
            const std::int32_t lowValue = queryCandidates_[candidateIndex];
            const std::size_t low = static_cast<std::size_t>(lowValue);
            const CollisionPreparedBody& bodyA = bodies[low];
            const CollisionPreparedBody& bodyB = bodies[high];
            if (!hasCollisionPassRule(bodyA, bodyB)
                || !candidateSweepAabbsOverlap(bodyA, bodyB)
                || ((!isCircle(bodyA) || !isCircle(bodyB))
                    && !candidateSweepCirclesOverlap(bodyA, bodyB))) {
                continue;
            }
            if (!appendPriority(
                staging,
                priorityPairCount,
                lowValue,
                static_cast<std::int32_t>(high)
            )) {
                return failureResult(CollisionBuildStatus::capacityExceeded, candidateScanEpoch);
            }
            ++counters.guaranteedPairCount;
        }
    }

    for (std::size_t low = enemyBodyCount; low + 1U < bodies.size(); ++low) {
        for (std::size_t high = low + 1U; high < bodies.size(); ++high) {
            const CollisionPreparedBody& bodyA = bodies[low];
            const CollisionPreparedBody& bodyB = bodies[high];
            if (!hasCollisionPassRule(bodyA, bodyB)
                || !candidateSweepAabbsOverlap(bodyA, bodyB)
                || ((!isCircle(bodyA) || !isCircle(bodyB))
                    && !candidateSweepCirclesOverlap(bodyA, bodyB))) {
                continue;
            }
            if (!appendPriority(
                staging,
                priorityPairCount,
                static_cast<std::int32_t>(low),
                static_cast<std::int32_t>(high)
            )) {
                return failureResult(CollisionBuildStatus::capacityExceeded, candidateScanEpoch);
            }
            ++counters.guaranteedPairCount;
        }
    }

    staging.result = {
        .status = CollisionBuildStatus::ok,
        .candidateScanEpoch = candidateScanEpoch,
        .nextCandidateScanEpoch = candidateScanEpoch + 1U,
        .cellScanToken = candidateScanEpoch,
        .bodyCount = bodies.size(),
        .enemyBodyCount = enemyBodyCount,
        .priorityPairCount = priorityPairCount,
        .normalPairCount = normalPairCount,
        .fairnessCount = fairnessCount,
        .counters = counters
    };
    activeBankIndex_ = stagingIndex;
    hasActiveBuild_ = true;
    return staging.result;
}

const CollisionCandidateBuildResult& CollisionCandidateBuilder::activeBuild() const noexcept {
    return hasActiveBuild_ ? banks_[activeBankIndex_].result : emptyResult_;
}

std::span<const CollisionCandidatePair> CollisionCandidateBuilder::priorityPairs() const noexcept {
    if (!hasActiveBuild_) {
        return {};
    }
    const Bank& active = banks_[activeBankIndex_];
    return std::span<const CollisionCandidatePair>(active.priorityPairs)
        .first(active.result.priorityPairCount);
}

std::span<const CollisionCandidatePair> CollisionCandidateBuilder::normalPairs() const noexcept {
    if (!hasActiveBuild_) {
        return {};
    }
    const Bank& active = banks_[activeBankIndex_];
    return std::span<const CollisionCandidatePair>(active.normalPairs)
        .first(active.result.normalPairCount);
}

std::span<const CollisionCandidateFairness> CollisionCandidateBuilder::fairness() const noexcept {
    if (!hasActiveBuild_) {
        return {};
    }
    const Bank& active = banks_[activeBankIndex_];
    return std::span<const CollisionCandidateFairness>(active.fairness)
        .first(active.result.fairnessCount);
}

const CollisionCandidateBuilderCapacity& CollisionCandidateBuilder::capacity() const noexcept {
    return capacity_;
}

bool CollisionCandidateBuilder::appendPriority(
    Bank& bank,
    std::size_t& count,
    const std::int32_t low,
    const std::int32_t high
) const noexcept {
    if (count >= capacity_.priorityPairCapacity) {
        return false;
    }
    bank.priorityPairs[count] = {low, high};
    ++count;
    return true;
}

bool CollisionCandidateBuilder::appendNormal(
    Bank& bank,
    std::size_t& count,
    const std::int32_t low,
    const std::int32_t high
) const noexcept {
    if (count >= capacity_.normalPairCapacity) {
        return false;
    }
    bank.normalPairs[count] = {low, high};
    ++count;
    return true;
}

} // namespace cirvivor::core
