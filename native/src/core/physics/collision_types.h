#pragma once

#include <cstddef>
#include <cstdint>
#include <limits>
#include <span>

namespace cirvivor::core {

inline constexpr std::size_t collisionBroadStride = 14U;
inline constexpr std::size_t collisionCandidateSweepStride = 8U;
inline constexpr std::int64_t collisionGridCellKeyOffset = 4096;
inline constexpr std::int64_t collisionGridCellKeyStride = 8192;

enum class CollisionBuildStatus : std::uint8_t {
    ok,
    invalidInput,
    capacityExceeded
};

enum class CollisionBodyKind : std::uint8_t {
    none = 0,
    enemy = 1,
    player = 2,
    wall = 3,
    projectile = 4,
    item = 5
};

enum class CollisionBodyShape : std::uint8_t {
    none = 0,
    circle = 1,
    circleParts = 2,
    rect = 3
};

inline constexpr double collisionMissingScalar =
    std::numeric_limits<double>::quiet_NaN();

// Collision geometry and relation bounds prepared before the default solve.
// This is intentionally independent from BodySoA: the legacy body builder owns
// these values, while broadphase only consumes the frozen snapshot.
struct CollisionPreparedBody final {
    std::int32_t id = -1;
    std::int32_t referenceToken = -1;
    CollisionBodyKind kind = CollisionBodyKind::none;
    CollisionBodyShape shape = CollisionBodyShape::none;
    bool hasReference = false;
    bool hexaHive = false;
    std::uint32_t circlePartCount = 0U;

    double x = collisionMissingScalar;
    double y = collisionMissingScalar;
    double centerX = collisionMissingScalar;
    double centerY = collisionMissingScalar;
    double minX = collisionMissingScalar;
    double maxX = collisionMissingScalar;
    double minY = collisionMissingScalar;
    double maxY = collisionMissingScalar;
    double sweepMinX = collisionMissingScalar;
    double sweepMaxX = collisionMissingScalar;
    double sweepMinY = collisionMissingScalar;
    double sweepMaxY = collisionMissingScalar;
    double enemyPairMinX = collisionMissingScalar;
    double enemyPairMaxX = collisionMissingScalar;
    double enemyPairMinY = collisionMissingScalar;
    double enemyPairMaxY = collisionMissingScalar;
    double projectileMinX = collisionMissingScalar;
    double projectileMaxX = collisionMissingScalar;
    double projectileMinY = collisionMissingScalar;
    double projectileMaxY = collisionMissingScalar;
    double radius = collisionMissingScalar;
    double boundRadius = collisionMissingScalar;
    double broadRadius = collisionMissingScalar;
    double enemyPairBroadRadius = collisionMissingScalar;
    double projectileBroadRadius = collisionMissingScalar;
    double resolveRadius = collisionMissingScalar;
};

struct CollisionCandidatePlanes final {
    std::span<const float> broad;
    std::span<const double> candidateSweep;
    std::span<const std::uint8_t> candidateSweepValidity;
    std::span<const std::uint8_t> bodyKind;
    std::span<const std::uint8_t> bodyShape;
};

struct CollisionCandidatePair final {
    std::int32_t low = -1;
    std::int32_t high = -1;

    [[nodiscard]] friend constexpr bool operator==(
        const CollisionCandidatePair&,
        const CollisionCandidatePair&
    ) noexcept = default;
};

} // namespace cirvivor::core
