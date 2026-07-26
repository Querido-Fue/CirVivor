#pragma once

#include "core/physics/collision_types.h"

#include <cstddef>
#include <cstdint>
#include <span>

namespace cirvivor::core {

inline constexpr double collisionNarrowphaseEpsilon = 1.0e-6;
inline constexpr double collisionEnemyPairRadiusScale = 0.9 * 0.85;
inline constexpr double collisionEnemyProjectileRadiusScale = 1.1 * 0.85;

struct CollisionNarrowphaseBody final {
    CollisionBodyKind kind = CollisionBodyKind::none;
    CollisionBodyShape shape = CollisionBodyShape::none;
    std::uint32_t partStart = 0U;
    std::uint32_t partCount = 0U;

    double centerX = 0.0;
    double centerY = 0.0;
    double radius = 0.0;
    double minX = 0.0;
    double maxX = 0.0;
    double minY = 0.0;
    double maxY = 0.0;
};

struct CollisionNarrowphasePart final {
    float centerX = 0.0F;
    float centerY = 0.0F;
    float radius = 0.0F;
};

struct CollisionNarrowphasePair final {
    std::uint32_t bodyIndexA = 0U;
    std::uint32_t bodyIndexB = 0U;
};

struct CollisionNarrowphaseManifold final {
    bool collided = false;
    double normalX = 0.0;
    double normalY = 0.0;
    double penetration = 0.0;
    double pointX = 0.0;
    double pointY = 0.0;
};

struct CollisionNarrowphaseLimits final {
    std::size_t maximumBodyCount = 0U;
    std::size_t maximumPartCount = 0U;
    std::size_t maximumPairCount = 0U;
};

enum class CollisionNarrowphaseStatus : std::uint8_t {
    ok,
    capacityExceeded,
    outputTooSmall,
    invalidBodyMetadata,
    invalidPartSpan,
    invalidPair
};

// Allocation-free scalar parity path for the production JavaScript generic
// narrowphase. Callers own every fixed-capacity input and output span. detect()
// validates the complete batch before publishing any manifold.
class CollisionNarrowphaseScalar final {
public:
    explicit CollisionNarrowphaseScalar(CollisionNarrowphaseLimits limits);

    [[nodiscard]] CollisionNarrowphaseLimits limits() const noexcept;

    [[nodiscard]] CollisionNarrowphaseStatus detect(
        std::span<const CollisionNarrowphaseBody> bodies,
        std::span<const CollisionNarrowphasePart> parts,
        std::span<const CollisionNarrowphasePair> pairs,
        std::span<CollisionNarrowphaseManifold> manifolds
    ) const noexcept;

private:
    CollisionNarrowphaseLimits limits_;
};

} // namespace cirvivor::core
