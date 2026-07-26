#include "core/physics/prepared_contact_scalar.h"

#include <cmath>
#include <limits>
#include <stdexcept>

namespace cirvivor::core {
namespace {

[[nodiscard]] PreparedContactLimits validateLimits(const PreparedContactLimits limits) {
    constexpr std::size_t maximumCount = static_cast<std::size_t>(
        std::numeric_limits<std::int32_t>::max()
    );
    if (limits.maximumBodyCount > maximumCount
        || limits.maximumPartCount > maximumCount
        || limits.maximumPairCount > maximumCount) {
        throw std::length_error("PreparedContactScalar capacity exceeds the WAT i32 range.");
    }
    return limits;
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

[[nodiscard]] bool detectCircleOverlap(
    const double centerAX,
    const double centerAY,
    const double radiusA,
    const double centerBX,
    const double centerBY,
    const double radiusB
) noexcept {
    const double deltaX = centerBX - centerAX;
    const double deltaY = centerBY - centerAY;
    const double radiusSum = radiusA + radiusB;
    const double distanceSquared = (deltaX * deltaX) + (deltaY * deltaY);
    return distanceSquared < (radiusSum * radiusSum);
}

[[nodiscard]] bool detectAggregateOverlap(
    const double centerAX,
    const double centerAY,
    const double radiusA,
    const double centerBX,
    const double centerBY,
    const double radiusB
) noexcept {
    const double deltaX = centerBX - centerAX;
    const double deltaY = centerBY - centerAY;
    const double radiusSum = radiusA + radiusB;
    const double distanceSquared = (deltaX * deltaX) + (deltaY * deltaY);
    if (distanceSquared >= (radiusSum * radiusSum)) {
        return false;
    }

    double distance = std::sqrt(distanceSquared);
    if (!(distance > preparedContactEpsilon)) {
        distance = 0.0;
    }
    const double penetration = radiusSum - distance;
    return std::isfinite(penetration) && penetration > preparedContactEpsilon;
}

[[nodiscard]] bool detectCircleCircle(
    const PreparedContactBody& bodyA,
    const PreparedContactBody& bodyB
) noexcept {
    const double radiusA = bodyA.radius * preparedContactRadiusScale;
    const double radiusB = bodyB.radius * preparedContactRadiusScale;
    if (!isValidCircle(bodyA.centerX, bodyA.centerY, radiusA)
        || !isValidCircle(bodyB.centerX, bodyB.centerY, radiusB)) {
        return false;
    }
    return detectCircleOverlap(
        bodyA.centerX,
        bodyA.centerY,
        radiusA,
        bodyB.centerX,
        bodyB.centerY,
        radiusB
    );
}

[[nodiscard]] bool detectPartsCircle(
    const std::span<const PreparedContactPart> parts,
    const PreparedContactBody& partBody,
    const PreparedContactBody& circleBody
) noexcept {
    const double circleRadius = circleBody.radius * preparedContactRadiusScale;
    if (!isValidCircle(circleBody.centerX, circleBody.centerY, circleRadius)) {
        return false;
    }

    const std::size_t partStart = partBody.partStart;
    const std::size_t partEnd = partStart + partBody.partCount;
    for (std::size_t index = partStart; index < partEnd; ++index) {
        const PreparedContactPart& part = parts[index];
        const double partX = static_cast<double>(part.centerX);
        const double partY = static_cast<double>(part.centerY);
        const double partRadius = static_cast<double>(part.radius)
            * preparedContactRadiusScale;
        if (!isValidCircle(partX, partY, partRadius)) {
            continue;
        }
        if (detectAggregateOverlap(
            partX,
            partY,
            partRadius,
            circleBody.centerX,
            circleBody.centerY,
            circleRadius
        )) {
            return true;
        }
    }
    return false;
}

[[nodiscard]] bool detectPartsParts(
    const std::span<const PreparedContactPart> parts,
    const PreparedContactBody& bodyA,
    const PreparedContactBody& bodyB
) noexcept {
    const std::size_t startA = bodyA.partStart;
    const std::size_t endA = startA + bodyA.partCount;
    const std::size_t startB = bodyB.partStart;
    const std::size_t endB = startB + bodyB.partCount;
    for (std::size_t indexA = startA; indexA < endA; ++indexA) {
        const PreparedContactPart& partA = parts[indexA];
        const double centerAX = static_cast<double>(partA.centerX);
        const double centerAY = static_cast<double>(partA.centerY);
        const double radiusA = static_cast<double>(partA.radius)
            * preparedContactRadiusScale;
        if (!isValidCircle(centerAX, centerAY, radiusA)) {
            continue;
        }

        for (std::size_t indexB = startB; indexB < endB; ++indexB) {
            const PreparedContactPart& partB = parts[indexB];
            const double centerBX = static_cast<double>(partB.centerX);
            const double centerBY = static_cast<double>(partB.centerY);
            const double radiusB = static_cast<double>(partB.radius)
                * preparedContactRadiusScale;
            if (!isValidCircle(centerBX, centerBY, radiusB)) {
                continue;
            }
            if (detectAggregateOverlap(
                centerAX,
                centerAY,
                radiusA,
                centerBX,
                centerBY,
                radiusB
            )) {
                return true;
            }
        }
    }
    return false;
}

[[nodiscard]] bool isPartSpanValid(
    const PreparedContactBody& body,
    const std::size_t partCount
) noexcept {
    const std::size_t start = body.partStart;
    const std::size_t count = body.partCount;
    return start <= partCount && count <= partCount - start;
}

} // namespace

PreparedContactScalar::PreparedContactScalar(const PreparedContactLimits limits)
    : limits_(validateLimits(limits)) {}

PreparedContactLimits PreparedContactScalar::limits() const noexcept {
    return limits_;
}

PreparedContactStatus PreparedContactScalar::scan(
    const std::span<const PreparedContactBody> bodies,
    const std::span<const PreparedContactPart> parts,
    const std::span<const PreparedContactPair> pairs,
    const std::span<std::uint8_t> contactFlags
) const noexcept {
    if (bodies.size() > limits_.maximumBodyCount
        || parts.size() > limits_.maximumPartCount
        || pairs.size() > limits_.maximumPairCount) {
        return PreparedContactStatus::capacityExceeded;
    }
    if (contactFlags.size() < pairs.size()) {
        return PreparedContactStatus::outputTooSmall;
    }

    // Validate the whole batch before publishing any result byte.
    for (const PreparedContactPair& pair : pairs) {
        if (pair.bodyIndexA >= bodies.size()
            || pair.bodyIndexB >= bodies.size()
            || pair.orderedShapeFlags > 3U
            || pair.reserved != 0U) {
            return PreparedContactStatus::invalidPair;
        }
        if ((pair.orderedShapeFlags & 1U) != 0U
            && !isPartSpanValid(bodies[pair.bodyIndexA], parts.size())) {
            return PreparedContactStatus::invalidPartSpan;
        }
        if ((pair.orderedShapeFlags & 2U) != 0U
            && !isPartSpanValid(bodies[pair.bodyIndexB], parts.size())) {
            return PreparedContactStatus::invalidPartSpan;
        }
    }

    for (std::size_t pairIndex = 0; pairIndex < pairs.size(); ++pairIndex) {
        const PreparedContactPair& pair = pairs[pairIndex];
        const PreparedContactBody& bodyA = bodies[pair.bodyIndexA];
        const PreparedContactBody& bodyB = bodies[pair.bodyIndexB];
        bool contact = false;
        switch (pair.orderedShapeFlags) {
        case 0U:
            contact = detectCircleCircle(bodyA, bodyB);
            break;
        case 1U:
            contact = detectPartsCircle(parts, bodyA, bodyB);
            break;
        case 2U:
            contact = detectPartsCircle(parts, bodyB, bodyA);
            break;
        case 3U:
            contact = detectPartsParts(parts, bodyA, bodyB);
            break;
        default:
            break;
        }
        contactFlags[pairIndex] = contact ? 1U : 0U;
    }
    return PreparedContactStatus::ok;
}

} // namespace cirvivor::core
