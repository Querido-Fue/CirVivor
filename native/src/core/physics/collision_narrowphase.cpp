#include "core/physics/collision_narrowphase.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>

namespace cirvivor::core {
namespace {

inline constexpr double multiContactNormalDiversityScale = 0.9;
inline constexpr double multiContactPenetrationMultiplierMaximum = 1.85;
inline constexpr std::size_t multiContactDiversitySampleCap = 3U;

[[nodiscard]] CollisionNarrowphaseLimits validateLimits(
    const CollisionNarrowphaseLimits limits
) {
    constexpr std::size_t maximumCount = static_cast<std::size_t>(
        std::numeric_limits<std::int32_t>::max()
    );
    if (limits.maximumBodyCount > maximumCount
        || limits.maximumPartCount > maximumCount
        || limits.maximumPairCount > maximumCount) {
        throw std::length_error(
            "CollisionNarrowphaseScalar capacity exceeds the JavaScript i32 bridge range."
        );
    }
    return limits;
}

[[nodiscard]] bool isValidKind(const CollisionBodyKind kind) noexcept {
    switch (kind) {
    case CollisionBodyKind::none:
    case CollisionBodyKind::enemy:
    case CollisionBodyKind::player:
    case CollisionBodyKind::wall:
    case CollisionBodyKind::projectile:
    case CollisionBodyKind::item:
        return true;
    }
    return false;
}

[[nodiscard]] bool isValidShape(const CollisionBodyShape shape) noexcept {
    switch (shape) {
    case CollisionBodyShape::circle:
    case CollisionBodyShape::circleParts:
    case CollisionBodyShape::rect:
        return true;
    case CollisionBodyShape::none:
        return false;
    }
    return false;
}

[[nodiscard]] bool isPartSpanValid(
    const CollisionNarrowphaseBody& body,
    const std::size_t partCount
) noexcept {
    const std::size_t start = body.partStart;
    const std::size_t count = body.partCount;
    return start <= partCount && count <= partCount - start;
}

// ECMAScript Math.min/Math.max distinguish signed zero. Inputs at these call
// sites are finite, so only the equal-zero rule differs from std::min/max.
[[nodiscard]] double jsMinimum(const double left, const double right) noexcept {
    if (left < right) {
        return left;
    }
    if (right < left) {
        return right;
    }
    if (left == 0.0 && right == 0.0) {
        return std::signbit(left) || std::signbit(right) ? -0.0 : 0.0;
    }
    return left;
}

[[nodiscard]] double jsMaximum(const double left, const double right) noexcept {
    if (left > right) {
        return left;
    }
    if (right > left) {
        return right;
    }
    if (left == 0.0 && right == 0.0) {
        return !std::signbit(left) || !std::signbit(right) ? 0.0 : -0.0;
    }
    return left;
}

[[nodiscard]] double finiteOrZero(const double value) noexcept {
    return std::isfinite(value) ? value : 0.0;
}

[[nodiscard]] double collisionRadiusScale(
    const CollisionNarrowphaseBody& body,
    const CollisionNarrowphaseBody& other
) noexcept {
    if (body.kind != CollisionBodyKind::enemy) {
        return 1.0;
    }
    if (other.kind == CollisionBodyKind::projectile) {
        return collisionEnemyProjectileRadiusScale;
    }
    if (other.kind == CollisionBodyKind::enemy) {
        return collisionEnemyPairRadiusScale;
    }
    return 1.0;
}

[[nodiscard]] bool isValidCircle(
    const double centerX,
    const double centerY,
    const double radius
) noexcept {
    return std::isfinite(centerX)
        && std::isfinite(centerY)
        && std::isfinite(radius)
        && radius > 0.0;
}

void writeManifold(
    CollisionNarrowphaseManifold& output,
    const double normalX,
    const double normalY,
    const double penetration,
    const double pointX,
    const double pointY
) noexcept {
    output.collided = true;
    output.normalX = normalX;
    output.normalY = normalY;
    output.penetration = penetration;
    output.pointX = pointX;
    output.pointY = pointY;
}

[[nodiscard]] bool writeCircleOverlapFromDelta(
    const double centerAX,
    const double centerAY,
    const double radiusA,
    const double radiusB,
    const double deltaX,
    const double deltaY,
    const double distanceSquared,
    const double fallbackNormalX,
    const double fallbackNormalY,
    CollisionNarrowphaseManifold& output
) noexcept {
    const double radiusSum = radiusA + radiusB;
    const double radiusSumSquared = radiusSum * radiusSum;
    if (distanceSquared >= radiusSumSquared) {
        return false;
    }

    double distance = std::sqrt(distanceSquared);
    double normalX = 1.0;
    double normalY = 0.0;
    if (distance > collisionNarrowphaseEpsilon) {
        normalX = deltaX / distance;
        normalY = deltaY / distance;
    } else {
        const double fallbackLength = std::hypot(fallbackNormalX, fallbackNormalY);
        if (fallbackLength > collisionNarrowphaseEpsilon) {
            normalX = fallbackNormalX / fallbackLength;
            normalY = fallbackNormalY / fallbackLength;
        }
        distance = 0.0;
    }

    const double penetration = radiusSum - distance;
    const double pointX = centerAX + (normalX * radiusA);
    const double pointY = centerAY + (normalY * radiusA);
    writeManifold(output, normalX, normalY, penetration, pointX, pointY);
    return true;
}

[[nodiscard]] bool writeCircleOverlap(
    const double centerAX,
    const double centerAY,
    const double radiusA,
    const double centerBX,
    const double centerBY,
    const double radiusB,
    const double fallbackNormalX,
    const double fallbackNormalY,
    CollisionNarrowphaseManifold& output
) noexcept {
    if (!isValidCircle(centerAX, centerAY, radiusA)
        || !isValidCircle(centerBX, centerBY, radiusB)) {
        return false;
    }
    const double deltaX = centerBX - centerAX;
    const double deltaY = centerBY - centerAY;
    const double deltaXSquared = deltaX * deltaX;
    const double deltaYSquared = deltaY * deltaY;
    const double distanceSquared = deltaXSquared + deltaYSquared;
    return writeCircleOverlapFromDelta(
        centerAX,
        centerAY,
        radiusA,
        radiusB,
        deltaX,
        deltaY,
        distanceSquared,
        fallbackNormalX,
        fallbackNormalY,
        output
    );
}

[[nodiscard]] bool writeCircleRectOverlap(
    const double circleX,
    const double circleY,
    const double radius,
    const CollisionNarrowphaseBody& rect,
    CollisionNarrowphaseManifold& output
) noexcept {
    if (!isValidCircle(circleX, circleY, radius)) {
        return false;
    }

    const double minX = finiteOrZero(rect.minX);
    const double maxX = finiteOrZero(rect.maxX);
    const double minY = finiteOrZero(rect.minY);
    const double maxY = finiteOrZero(rect.maxY);
    const double closestX = jsMaximum(minX, jsMinimum(maxX, circleX));
    const double closestY = jsMaximum(minY, jsMinimum(maxY, circleY));
    const double deltaX = closestX - circleX;
    const double deltaY = closestY - circleY;
    const double deltaXSquared = deltaX * deltaX;
    const double deltaYSquared = deltaY * deltaY;
    const double distanceSquared = deltaXSquared + deltaYSquared;
    const double radiusSquared = radius * radius;
    if (distanceSquared >= radiusSquared) {
        return false;
    }

    if (distanceSquared > collisionNarrowphaseEpsilon) {
        const double distance = std::sqrt(distanceSquared);
        writeManifold(
            output,
            deltaX / distance,
            deltaY / distance,
            radius - distance,
            closestX,
            closestY
        );
        return true;
    }

    const double leftDistance = jsMaximum(0.0, circleX - minX);
    const double rightDistance = jsMaximum(0.0, maxX - circleX);
    const double topDistance = jsMaximum(0.0, circleY - minY);
    const double bottomDistance = jsMaximum(0.0, maxY - circleY);
    const double horizontalMinimum = jsMinimum(leftDistance, rightDistance);
    const double verticalMinimum = jsMinimum(topDistance, bottomDistance);
    const double minimumDistance = jsMinimum(horizontalMinimum, verticalMinimum);
    double normalX = 1.0;
    double normalY = 0.0;
    double pointX = minX;
    double pointY = circleY;

    if (minimumDistance == rightDistance) {
        normalX = -1.0;
        pointX = maxX;
    } else if (minimumDistance == topDistance) {
        normalX = 0.0;
        normalY = 1.0;
        pointX = circleX;
        pointY = minY;
    } else if (minimumDistance == bottomDistance) {
        normalX = 0.0;
        normalY = -1.0;
        pointX = circleX;
        pointY = maxY;
    }

    writeManifold(
        output,
        normalX,
        normalY,
        radius + minimumDistance,
        pointX,
        pointY
    );
    return true;
}

struct ContactAggregate final {
    bool hasBest = false;
    std::size_t contactCount = 0U;
    double normalSumX = 0.0;
    double normalSumY = 0.0;
    double pointSumX = 0.0;
    double pointSumY = 0.0;
    double penetrationSum = 0.0;
    double maximumPenetration = 0.0;
    CollisionNarrowphaseManifold best{};
};

void recordAggregateContact(
    ContactAggregate& aggregate,
    const CollisionNarrowphaseManifold& manifold
) noexcept {
    const double penetration = std::isfinite(manifold.penetration)
        ? manifold.penetration
        : 0.0;
    if (penetration <= collisionNarrowphaseEpsilon) {
        return;
    }

    ++aggregate.contactCount;
    aggregate.normalSumX += manifold.normalX * penetration;
    aggregate.normalSumY += manifold.normalY * penetration;
    aggregate.pointSumX += manifold.pointX * penetration;
    aggregate.pointSumY += manifold.pointY * penetration;
    aggregate.penetrationSum += penetration;
    if (penetration > aggregate.maximumPenetration) {
        aggregate.maximumPenetration = penetration;
    }
    if (!aggregate.hasBest || manifold.penetration > aggregate.best.penetration) {
        aggregate.best = manifold;
        aggregate.hasBest = true;
    }
}

[[nodiscard]] bool finishAggregate(
    ContactAggregate& aggregate,
    CollisionNarrowphaseManifold& output
) noexcept {
    if (!aggregate.hasBest) {
        return false;
    }
    if (aggregate.contactCount <= 1U) {
        output = aggregate.best;
        return true;
    }

    const double normalLength = std::hypot(
        aggregate.normalSumX,
        aggregate.normalSumY
    );
    if (normalLength <= collisionNarrowphaseEpsilon
        || aggregate.penetrationSum <= collisionNarrowphaseEpsilon) {
        output = aggregate.best;
        return true;
    }

    const double alignment = jsMinimum(
        1.0,
        normalLength / aggregate.penetrationSum
    );
    const double diversity = jsMaximum(0.0, 1.0 - alignment);
    const std::size_t sampleCount = std::min(
        aggregate.contactCount - 1U,
        multiContactDiversitySampleCap
    );
    const double diversitySamples = diversity * static_cast<double>(sampleCount);
    const double diversityScale = diversitySamples * multiContactNormalDiversityScale;
    const double multiplier = jsMinimum(
        multiContactPenetrationMultiplierMaximum,
        1.0 + diversityScale
    );
    const double pointWeight = jsMaximum(
        collisionNarrowphaseEpsilon,
        aggregate.penetrationSum
    );

    aggregate.best.normalX = aggregate.normalSumX / normalLength;
    aggregate.best.normalY = aggregate.normalSumY / normalLength;
    aggregate.best.penetration = jsMaximum(
        aggregate.best.penetration,
        aggregate.maximumPenetration * multiplier
    );
    aggregate.best.pointX = aggregate.pointSumX / pointWeight;
    aggregate.best.pointY = aggregate.pointSumY / pointWeight;
    output = aggregate.best;
    return true;
}

[[nodiscard]] bool detectCircleCircle(
    const CollisionNarrowphaseBody& bodyA,
    const CollisionNarrowphaseBody& bodyB,
    CollisionNarrowphaseManifold& output
) noexcept {
    const double radiusA = bodyA.radius * collisionRadiusScale(bodyA, bodyB);
    const double radiusB = bodyB.radius * collisionRadiusScale(bodyB, bodyA);
    const double fallbackX = bodyB.centerX - bodyA.centerX;
    const double fallbackY = bodyB.centerY - bodyA.centerY;
    return writeCircleOverlap(
        bodyA.centerX,
        bodyA.centerY,
        radiusA,
        bodyB.centerX,
        bodyB.centerY,
        radiusB,
        fallbackX,
        fallbackY,
        output
    );
}

[[nodiscard]] bool detectPartsCircle(
    const std::span<const CollisionNarrowphasePart> parts,
    const CollisionNarrowphaseBody& partBody,
    const CollisionNarrowphaseBody& circleBody,
    CollisionNarrowphaseManifold& output
) noexcept {
    const double partScale = collisionRadiusScale(partBody, circleBody);
    const double circleScale = collisionRadiusScale(circleBody, partBody);
    const double circleRadius = circleBody.radius * circleScale;
    if (!isValidCircle(circleBody.centerX, circleBody.centerY, circleRadius)) {
        return false;
    }

    ContactAggregate aggregate;
    const double fallbackX = circleBody.centerX - partBody.centerX;
    const double fallbackY = circleBody.centerY - partBody.centerY;
    const std::size_t partEnd = static_cast<std::size_t>(partBody.partStart)
        + static_cast<std::size_t>(partBody.partCount);
    for (std::size_t index = partBody.partStart; index < partEnd; ++index) {
        const CollisionNarrowphasePart& part = parts[index];
        const double centerX = static_cast<double>(part.centerX);
        const double centerY = static_cast<double>(part.centerY);
        const double radius = static_cast<double>(part.radius) * partScale;
        if (!isValidCircle(centerX, centerY, radius)) {
            continue;
        }

        const double deltaX = circleBody.centerX - centerX;
        const double deltaY = circleBody.centerY - centerY;
        const double radiusSum = radius + circleRadius;
        const double deltaXSquared = deltaX * deltaX;
        const double deltaYSquared = deltaY * deltaY;
        const double distanceSquared = deltaXSquared + deltaYSquared;
        const double radiusSumSquared = radiusSum * radiusSum;
        if (distanceSquared >= radiusSumSquared) {
            continue;
        }

        CollisionNarrowphaseManifold candidate;
        if (writeCircleOverlapFromDelta(
            centerX,
            centerY,
            radius,
            circleRadius,
            deltaX,
            deltaY,
            distanceSquared,
            fallbackX,
            fallbackY,
            candidate
        )) {
            recordAggregateContact(aggregate, candidate);
        }
    }
    return finishAggregate(aggregate, output);
}

[[nodiscard]] bool detectPartsParts(
    const std::span<const CollisionNarrowphasePart> parts,
    const CollisionNarrowphaseBody& bodyA,
    const CollisionNarrowphaseBody& bodyB,
    CollisionNarrowphaseManifold& output
) noexcept {
    const double scaleA = collisionRadiusScale(bodyA, bodyB);
    const double scaleB = collisionRadiusScale(bodyB, bodyA);
    const double fallbackX = bodyB.centerX - bodyA.centerX;
    const double fallbackY = bodyB.centerY - bodyA.centerY;
    const std::size_t endA = static_cast<std::size_t>(bodyA.partStart)
        + static_cast<std::size_t>(bodyA.partCount);
    const std::size_t endB = static_cast<std::size_t>(bodyB.partStart)
        + static_cast<std::size_t>(bodyB.partCount);
    ContactAggregate aggregate;

    for (std::size_t indexA = bodyA.partStart; indexA < endA; ++indexA) {
        const CollisionNarrowphasePart& partA = parts[indexA];
        const double centerAX = static_cast<double>(partA.centerX);
        const double centerAY = static_cast<double>(partA.centerY);
        const double radiusA = static_cast<double>(partA.radius) * scaleA;
        if (!isValidCircle(centerAX, centerAY, radiusA)) {
            continue;
        }

        for (std::size_t indexB = bodyB.partStart; indexB < endB; ++indexB) {
            const CollisionNarrowphasePart& partB = parts[indexB];
            const double centerBX = static_cast<double>(partB.centerX);
            const double centerBY = static_cast<double>(partB.centerY);
            const double radiusB = static_cast<double>(partB.radius) * scaleB;
            if (!isValidCircle(centerBX, centerBY, radiusB)) {
                continue;
            }

            const double deltaX = centerBX - centerAX;
            const double deltaY = centerBY - centerAY;
            const double radiusSum = radiusA + radiusB;
            const double deltaXSquared = deltaX * deltaX;
            const double deltaYSquared = deltaY * deltaY;
            const double distanceSquared = deltaXSquared + deltaYSquared;
            const double radiusSumSquared = radiusSum * radiusSum;
            if (distanceSquared >= radiusSumSquared) {
                continue;
            }

            CollisionNarrowphaseManifold candidate;
            if (writeCircleOverlapFromDelta(
                centerAX,
                centerAY,
                radiusA,
                radiusB,
                deltaX,
                deltaY,
                distanceSquared,
                fallbackX,
                fallbackY,
                candidate
            )) {
                recordAggregateContact(aggregate, candidate);
            }
        }
    }
    return finishAggregate(aggregate, output);
}

[[nodiscard]] bool detectCircleRect(
    const CollisionNarrowphaseBody& circle,
    const CollisionNarrowphaseBody& rect,
    CollisionNarrowphaseManifold& output
) noexcept {
    const double radius = circle.radius * collisionRadiusScale(circle, rect);
    return writeCircleRectOverlap(
        circle.centerX,
        circle.centerY,
        radius,
        rect,
        output
    );
}

[[nodiscard]] bool detectPartsRect(
    const std::span<const CollisionNarrowphasePart> parts,
    const CollisionNarrowphaseBody& partBody,
    const CollisionNarrowphaseBody& rectBody,
    CollisionNarrowphaseManifold& output
) noexcept {
    const double partScale = collisionRadiusScale(partBody, rectBody);
    const double rectMinX = finiteOrZero(rectBody.minX);
    const double rectMaxX = finiteOrZero(rectBody.maxX);
    const double rectMinY = finiteOrZero(rectBody.minY);
    const double rectMaxY = finiteOrZero(rectBody.maxY);
    const std::size_t partEnd = static_cast<std::size_t>(partBody.partStart)
        + static_cast<std::size_t>(partBody.partCount);
    ContactAggregate aggregate;

    for (std::size_t index = partBody.partStart; index < partEnd; ++index) {
        const CollisionNarrowphasePart& part = parts[index];
        const double circleX = static_cast<double>(part.centerX);
        const double circleY = static_cast<double>(part.centerY);
        const double radius = static_cast<double>(part.radius) * partScale;
        if (!isValidCircle(circleX, circleY, radius)) {
            continue;
        }
        if (circleX + radius <= rectMinX
            || circleX - radius >= rectMaxX
            || circleY + radius <= rectMinY
            || circleY - radius >= rectMaxY) {
            continue;
        }

        CollisionNarrowphaseManifold candidate;
        if (writeCircleRectOverlap(circleX, circleY, radius, rectBody, candidate)) {
            recordAggregateContact(aggregate, candidate);
        }
    }
    return finishAggregate(aggregate, output);
}

void invertNormal(CollisionNarrowphaseManifold& manifold) noexcept {
    manifold.normalX = -manifold.normalX;
    manifold.normalY = -manifold.normalY;
}

[[nodiscard]] CollisionNarrowphaseManifold detectPair(
    const std::span<const CollisionNarrowphasePart> parts,
    const CollisionNarrowphaseBody& bodyA,
    const CollisionNarrowphaseBody& bodyB
) noexcept {
    CollisionNarrowphaseManifold output;
    bool collided = false;

    if (bodyA.shape == CollisionBodyShape::circle
        && bodyB.shape == CollisionBodyShape::circle) {
        collided = detectCircleCircle(bodyA, bodyB, output);
    } else if (bodyA.shape == CollisionBodyShape::circleParts
        && bodyB.shape == CollisionBodyShape::circleParts) {
        collided = detectPartsParts(parts, bodyA, bodyB, output);
    } else if (bodyA.shape == CollisionBodyShape::circleParts
        && bodyB.shape == CollisionBodyShape::circle) {
        collided = detectPartsCircle(parts, bodyA, bodyB, output);
    } else if (bodyA.shape == CollisionBodyShape::circle
        && bodyB.shape == CollisionBodyShape::circleParts) {
        collided = detectPartsCircle(parts, bodyB, bodyA, output);
        if (collided) {
            invertNormal(output);
        }
    } else if (bodyA.shape == CollisionBodyShape::circle
        && bodyB.shape == CollisionBodyShape::rect) {
        collided = detectCircleRect(bodyA, bodyB, output);
    } else if (bodyA.shape == CollisionBodyShape::rect
        && bodyB.shape == CollisionBodyShape::circle) {
        collided = detectCircleRect(bodyB, bodyA, output);
        if (collided) {
            invertNormal(output);
        }
    } else if (bodyA.shape == CollisionBodyShape::circleParts
        && bodyB.shape == CollisionBodyShape::rect) {
        collided = detectPartsRect(parts, bodyA, bodyB, output);
    } else if (bodyA.shape == CollisionBodyShape::rect
        && bodyB.shape == CollisionBodyShape::circleParts) {
        collided = detectPartsRect(parts, bodyB, bodyA, output);
        if (collided) {
            invertNormal(output);
        }
    }

    output.collided = collided;
    return output;
}

} // namespace

CollisionNarrowphaseScalar::CollisionNarrowphaseScalar(
    const CollisionNarrowphaseLimits limits
)
    : limits_(validateLimits(limits)) {}

CollisionNarrowphaseLimits CollisionNarrowphaseScalar::limits() const noexcept {
    return limits_;
}

CollisionNarrowphaseStatus CollisionNarrowphaseScalar::detect(
    const std::span<const CollisionNarrowphaseBody> bodies,
    const std::span<const CollisionNarrowphasePart> parts,
    const std::span<const CollisionNarrowphasePair> pairs,
    const std::span<CollisionNarrowphaseManifold> manifolds
) const noexcept {
    if (bodies.size() > limits_.maximumBodyCount
        || parts.size() > limits_.maximumPartCount
        || pairs.size() > limits_.maximumPairCount) {
        return CollisionNarrowphaseStatus::capacityExceeded;
    }
    if (manifolds.size() < pairs.size()) {
        return CollisionNarrowphaseStatus::outputTooSmall;
    }

    // Validate the complete batch before publishing the first manifold.
    for (const CollisionNarrowphaseBody& body : bodies) {
        if (!isValidKind(body.kind) || !isValidShape(body.shape)) {
            return CollisionNarrowphaseStatus::invalidBodyMetadata;
        }
        if (body.shape == CollisionBodyShape::circleParts
            && !isPartSpanValid(body, parts.size())) {
            return CollisionNarrowphaseStatus::invalidPartSpan;
        }
    }
    for (const CollisionNarrowphasePair& pair : pairs) {
        if (pair.bodyIndexA >= bodies.size() || pair.bodyIndexB >= bodies.size()) {
            return CollisionNarrowphaseStatus::invalidPair;
        }
    }

    for (std::size_t pairIndex = 0; pairIndex < pairs.size(); ++pairIndex) {
        const CollisionNarrowphasePair& pair = pairs[pairIndex];
        manifolds[pairIndex] = detectPair(
            parts,
            bodies[pair.bodyIndexA],
            bodies[pair.bodyIndexB]
        );
    }
    return CollisionNarrowphaseStatus::ok;
}

} // namespace cirvivor::core
